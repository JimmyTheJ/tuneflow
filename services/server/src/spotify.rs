//! Best-effort public Spotify playlist metadata import. Never fetches Spotify audio.
use crate::{
    Shared, auth,
    db::{self, id, text},
    error::{ApiError, Result},
    library, media,
};
use serde_json::{Value, json};
use std::time::Duration;
use url::Url;

pub const PUBLIC_NOTICE: &str = "Imported the tracks visible in Spotify's public playlist view. Spotify may omit tracks, especially in long playlists; compare the count with the original.";
const MAX_PAGE: usize = 8 * 1024 * 1024;

fn valid_id(value: &str) -> bool {
    value.len() == 22 && value.bytes().all(|c| c.is_ascii_alphanumeric())
}
pub fn playlist_id(raw: &str) -> Option<String> {
    if let Some(value) = raw.trim().strip_prefix("spotify:playlist:") {
        return valid_id(value).then(|| value.to_owned());
    }
    let url = Url::parse(raw.trim()).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("open.spotify.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let mut parts = url
        .path_segments()?
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    if parts.first().is_some_and(|p| p.starts_with("intl-")) {
        parts.remove(0);
    }
    if parts.first() == Some(&"embed") {
        parts.remove(0);
    }
    (parts.len() == 2 && parts[0] == "playlist" && valid_id(parts[1])).then(|| parts[1].to_owned())
}
fn short_link(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("spotify.link")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .path()
            .trim_start_matches('/')
            .bytes()
            .all(|c| c.is_ascii_alphanumeric())
        && (1..=100).contains(&url.path().trim_start_matches('/').len())
}
pub fn valid_link(raw: &str) -> bool {
    playlist_id(raw).is_some() || Url::parse(raw.trim()).is_ok_and(|u| short_link(&u))
}
async fn resolve_link(s: &Shared, raw: &str) -> Result<String> {
    if let Some(pid) = playlist_id(raw) {
        return Ok(pid);
    }
    let url = Url::parse(raw).map_err(|_| ApiError::bad("Use a Spotify playlist link"))?;
    if !short_link(&url) {
        return Err(ApiError::bad("Use a Spotify playlist link"));
    }
    let response = s
        .http
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await?;
    let destination = response.headers().get(reqwest::header::LOCATION).and_then(|h| h.to_str().ok())
        .and_then(playlist_id).ok_or_else(|| ApiError::bad("This Spotify short link could not be opened. In Spotify, use Share → Copy link for the playlist."))?;
    Ok(destination)
}

pub struct Playlist {
    pub name: String,
    pub tracks: Vec<Value>,
}
pub fn parse_embed(html: &str, pid: &str) -> Result<Playlist> {
    let failure = || {
        ApiError::upstream(
            "Spotify did not expose this playlist's tracks. It may be private, unavailable, or its public page has changed. Try another public playlist link.",
        )
    };
    let marker = html
        .find("id=\"__NEXT_DATA__\"")
        .or_else(|| html.find("id='__NEXT_DATA__'"))
        .ok_or_else(failure)?;
    let body = html[marker..]
        .split_once('>')
        .and_then(|(_, tail)| tail.split_once("</script>").map(|(body, _)| body))
        .ok_or_else(failure)?;
    let data: Value = serde_json::from_str(body).map_err(|_| failure())?;
    let entity = &data["props"]["pageProps"]["state"]["data"]["entity"];
    if entity["type"] != "playlist" || entity["id"] != pid {
        return Err(failure());
    }
    let entries = entity["trackList"].as_array().ok_or_else(failure)?;
    if entries.is_empty() {
        return Err(ApiError::bad(
            "Spotify returned no visible songs. This playlist may be empty, private, or unavailable.",
        ));
    }
    if entries.len() > 5000 {
        return Err(ApiError::bad("Playlist exceeds 5000 tracks"));
    }
    let artwork = entity["coverArt"]["sources"][0]["url"].clone();
    let mut tracks = Vec::with_capacity(entries.len());
    for entry in entries {
        let spotify_id = text(entry, "uri")
            .strip_prefix("spotify:track:")
            .filter(|v| valid_id(v));
        // Retain unplayable/unsupported entries in their original positions for review.
        let title = entry["title"]
            .as_str()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or("Unavailable Spotify entry");
        tracks.push(
            json!({"video_id":null,"title":title,"artist":entry["subtitle"].as_str().unwrap_or(""),
            "duration_sec":entry["duration"].as_i64().map(|v|v/1000),"thumbnail_url":artwork,
            "source_spotify_id":spotify_id,"source_title":title,"source_artist":entry["subtitle"],
            "source_duration_ms":entry["duration"],"explicit":entry["isExplicit"],
            "match_status":"unmatched"}),
        );
    }
    Ok(Playlist {
        name: entity["name"]
            .as_str()
            .or(entity["title"].as_str())
            .unwrap_or("Imported Spotify playlist")
            .into(),
        tracks,
    })
}
pub async fn fetch(s: &Shared, raw: &str) -> Result<Playlist> {
    let pid = resolve_link(s, raw).await?;
    let response = s
        .http
        .get(format!("https://open.spotify.com/embed/playlist/{pid}"))
        .timeout(Duration::from_secs(25))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(ApiError::upstream(format!(
            "Spotify could not open this public playlist (HTTP {}). Try another public playlist link.",
            response.status().as_u16()
        )));
    }
    let html = read_page(response).await?;
    parse_embed(&html, &pid)
}
async fn read_page(mut response: reqwest::Response) -> Result<String> {
    if response
        .content_length()
        .is_some_and(|len| len > MAX_PAGE as u64)
    {
        return Err(ApiError::upstream("Spotify playlist page is too large"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > MAX_PAGE {
            return Err(ApiError::upstream("Spotify playlist page is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| ApiError::upstream("Invalid Spotify playlist page"))
}
fn normalized(raw: &str) -> String {
    raw.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
fn duration_matches(source: &Value, candidate: &Value) -> bool {
    match (
        source["duration_sec"].as_i64(),
        candidate["duration_sec"].as_i64(),
    ) {
        (Some(a), Some(b)) if a > 0 && b > 0 => (a - b).abs() <= 5.max(a / 50),
        _ => false,
    }
}
fn artist_matches(source: &str, candidate: &str) -> bool {
    let candidate = normalized(candidate);
    source.split(',').any(|artist| {
        let artist = normalized(artist);
        !artist.is_empty() && candidate == artist
    })
}
pub fn confident_youtube(source: &Value, candidate: &Value) -> bool {
    let title = normalized(text(source, "title"));
    let upload = normalized(&format!(
        "{} {}",
        text(candidate, "title"),
        text(candidate, "source_title")
    ));
    let combined = normalized(&format!("{} {}", text(candidate, "artist"), upload));
    let padded = format!(" {upload} ");
    !title.is_empty()
        && padded.contains(&format!(" {title} "))
        && duration_matches(source, candidate)
        && text(source, "artist").split(',').any(|artist| {
            let artist = normalized(artist);
            !artist.is_empty() && format!(" {combined} ").contains(&format!(" {artist} "))
        })
        && [
            "cover",
            "karaoke",
            "tribute",
            "live",
            "remix",
            "sped",
            "slowed",
            "instrumental",
            "reaction",
            "nightcore",
        ]
        .iter()
        .all(|word| {
            !upload.split_whitespace().any(|w| w == *word)
                || title.split_whitespace().any(|w| w == *word)
        })
}
fn matched(source: &Value, candidate: &Value) -> Value {
    let mut track = source.clone();
    for field in ["video_id", "thumbnail_url", "duration_sec"] {
        track[field] = candidate[field].clone();
    }
    track["match_status"] = json!("matched");
    track
}
/// All matches stay within the importing user's library. Uncertain results remain visible.
pub async fn match_tracks(
    s: &Shared,
    u: &Value,
    jid: i64,
    source: Vec<Value>,
    youtube: bool,
) -> Result<Vec<Value>> {
    let locals = db::all(
        &s.db,
        "SELECT * FROM library_tracks WHERE user_id=?",
        vec![json!(id(u))],
    )
    .await?;
    let mut tracks = Vec::with_capacity(source.len());
    let total = source.len();
    let mut youtube_failures = 0;
    for (index, original) in source.into_iter().enumerate() {
        let mut chosen = original.clone();
        if !original["source_spotify_id"].is_null()
            && auth::enforce(s, u, Some(&original), false).await.is_ok()
        {
            let candidates = locals
                .iter()
                .filter(|t| {
                    normalized(text(t, "title")) == normalized(text(&original, "title"))
                        && artist_matches(text(&original, "artist"), text(t, "artist"))
                        && duration_matches(&original, t)
                })
                .collect::<Vec<_>>();
            if candidates.len() == 1 {
                chosen = matched(&original, &library::track_from_row(s, u, candidates[0])?);
            } else if youtube
                && youtube_failures < 3
                && auth::enforce(s, u, None, true).await.is_ok()
                && auth::budget(s, format!("spotify-match:{}", id(u)), 600)
                    .await
                    .is_ok()
            {
                let query = format!("{} {}", text(&original, "artist"), text(&original, "title"));
                match media::search(s, &query, 5).await {
                    Ok(results) => {
                        let results = crate::search::rank(
                            results,
                            &query,
                            &json!({"hide_covers":true,"hide_loops":true,"version_preference":"studio"}),
                        );
                        if let Some(candidate) =
                            results.iter().find(|t| confident_youtube(&original, t))
                            && auth::enforce(s, u, Some(candidate), false).await.is_ok()
                        {
                            chosen = matched(&original, candidate);
                        }
                    }
                    Err(_) => youtube_failures += 1,
                }
            }
        }
        tracks.push(chosen);
        db::exec(&s.db,"UPDATE import_jobs SET progress_done=?,progress_total=?,message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            vec![json!(index+1),json!(total),json!(format!("Matching songs · {}/{}",index+1,total)),json!(jid)]).await?;
    }
    Ok(tracks)
}

#[cfg(test)]
mod tests {
    use super::*;
    const PID: &str = "0123456789abcdefghijkl";
    #[test]
    fn accepts_shared_localized_and_embed_links_but_rejects_other_resources_and_hosts() {
        for link in [
            format!("https://open.spotify.com/playlist/{PID}?si=abc"),
            format!("https://open.spotify.com/intl-de/playlist/{PID}"),
            format!("https://open.spotify.com/embed/playlist/{PID}"),
            format!("spotify:playlist:{PID}"),
        ] {
            assert_eq!(playlist_id(&link).as_deref(), Some(PID));
        }
        for link in [
            "https://evil.test/playlist/0123456789abcdefghijkl",
            "http://open.spotify.com/playlist/0123456789abcdefghijkl",
            "https://open.spotify.com:8443/playlist/0123456789abcdefghijkl",
            "https://open.spotify.com/track/0123456789abcdefghijkl",
            "https://open.spotify.com/playlist/",
            "https://spotify.link/abc/def",
        ] {
            assert!(!valid_link(link), "{link}");
        }
        assert!(valid_link("https://spotify.link/Abc123"));
    }
    #[test]
    fn embed_preserves_order_duplicates_missing_entries_and_original_metadata() {
        let entry = json!({"uri":"spotify:track:abcdefghijkl0123456789","title":"Song & café","subtitle":"Artist, Guest","duration":180500,"isExplicit":false});
        let entity = json!({"type":"playlist","id":PID,"name":"Friends mix","trackList":[entry.clone(),entry,{"title":"Unavailable"}]});
        let html = format!(
            "<script id=\"__NEXT_DATA__\" type=\"application/json\">{}</script>",
            json!({"props":{"pageProps":{"state":{"data":{"entity":entity}}}}})
        );
        let p = parse_embed(&html, PID).unwrap();
        assert_eq!(p.name, "Friends mix");
        assert_eq!(p.tracks.len(), 3);
        assert_eq!(p.tracks[0]["title"], "Song & café");
        assert_eq!(p.tracks[0]["source_duration_ms"], 180500);
        assert_eq!(p.tracks[0], p.tracks[1]);
        assert!(p.tracks[2]["video_id"].is_null());
        assert!(parse_embed(&html, "abcdefghijkl0123456789").is_err());
        assert!(parse_embed("<html>Sign in</html>", PID).is_err());
    }
    #[test]
    fn youtube_matching_requires_title_artist_duration_and_correct_version() {
        let source = json!({"title":"Some Song","artist":"The Artist","duration_sec":180});
        let candidate = json!({"title":"The Artist - Some Song (Official Audio)","artist":"The Artist - Topic","duration_sec":181});
        assert!(confident_youtube(&source, &candidate));
        for change in [
            json!({"title":"The Artist - Some Song cover","duration_sec":180}),
            json!({"title":"The Artist - Some Song live","duration_sec":180}),
            json!({"title":"Someone Else - Some Song","duration_sec":180}),
            json!({"title":"The Artist - Some Song","duration_sec":280}),
        ] {
            assert!(!confident_youtube(&source, &change));
        }
    }
}
