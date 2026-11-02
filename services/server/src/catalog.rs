//! Optional catalog browsing. No MusicBrainz request is on search/playback's critical path.
use crate::{
    Shared,
    db::{self, id, text},
    error::{ApiError, Result},
    library, media,
};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

async fn fetch(s: &Shared, path: &str, params: &[(&str, &str)]) -> Result<Value> {
    let key = format!("mb:{path}:{params:?}");
    if let Some(r)=db::optional(&s.db,"SELECT payload_json FROM catalog_cache_entries WHERE cache_key=? AND cached_at>datetime('now','-7 days')",vec![json!(key)]).await?&& let Ok(v)=serde_json::from_str(text(&r,"payload_json")){return Ok(v);}
    let mut gate = s.catalog_gate.lock().await;
    let elapsed = gate.elapsed();
    if elapsed < Duration::from_secs(1) {
        tokio::time::sleep(Duration::from_secs(1) - elapsed).await;
    }
    let res = s
        .http
        .get(format!("https://musicbrainz.org/ws/2/{path}"))
        .query(params)
        .query(&[("fmt", "json")])
        .header(
            "User-Agent",
            "Tuneflow/0.4.0 (personal music library client)",
        )
        .timeout(Duration::from_secs(10))
        .send()
        .await?;
    *gate = Instant::now();
    drop(gate);
    let v: Value = res.error_for_status()?.json().await?;
    db::exec(&s.db,"INSERT INTO catalog_cache_entries(cache_key,payload_json) VALUES(?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,cached_at=CURRENT_TIMESTAMP",vec![json!(key),json!(v.to_string())]).await?;
    Ok(v)
}
fn valid(id: &str) -> Result<()> {
    uuid::Uuid::parse_str(id).map_err(|_| ApiError::bad("Invalid catalog ID"))?;
    Ok(())
}
pub async fn artist(s: &Shared, mbid: &str) -> Result<Value> {
    valid(mbid)?;
    let artist = fetch(s, &format!("artist/{mbid}"), &[]).await?;
    let p = fetch(
        s,
        "release-group",
        &[
            ("artist", mbid),
            ("limit", "100"),
            ("inc", "artist-credits"),
        ],
    )
    .await?;
    let mut albums = vec![];
    let mut eps = vec![];
    let mut singles = vec![];
    for rg in p["release-groups"].as_array().into_iter().flatten() {
        let rgid = text(rg, "id");
        let release_type = text(rg, "primary-type");
        let v = json!({"mbid":rgid,"title":rg["title"],"release_type":release_type,"release_date":rg["first-release-date"],"cover_url":format!("https://coverartarchive.org/release-group/{rgid}/front-500"),"track_count":null});
        match release_type {
            "Album" => albums.push(v),
            "EP" => eps.push(v),
            "Single" => singles.push(v),
            _ => {}
        }
    }
    Ok(
        json!({"mbid":mbid,"name":artist["name"],"type":artist["type"],"disambiguation":artist["disambiguation"],"image_url":null,"albums":albums,"eps":eps,"singles":singles}),
    )
}
pub async fn album(s: &Shared, u: &Value, mbid: &str, resolve: bool) -> Result<Value> {
    valid(mbid)?;
    // Artist cards refer to release groups; prefer an official release from that group.
    let release = fetch(
        s,
        &format!("release/{mbid}"),
        &[("inc", "recordings+artist-credits+release-groups")],
    )
    .await;
    let release = match release {
        Ok(v) => v,
        Err(_) => {
            let p = fetch(
                s,
                "release",
                &[
                    ("release-group", mbid),
                    ("status", "official"),
                    ("limit", "1"),
                ],
            )
            .await?;
            let rid = p["releases"][0]["id"]
                .as_str()
                .ok_or_else(ApiError::missing)?;
            fetch(
                s,
                &format!("release/{rid}"),
                &[("inc", "recordings+artist-credits+release-groups")],
            )
            .await?
        }
    };
    let artist = release["artist-credit"][0]["name"].as_str().unwrap_or("");
    let mut tracks = vec![];
    for medium in release["media"].as_array().into_iter().flatten() {
        for t in medium["tracks"].as_array().into_iter().flatten() {
            let recording = &t["recording"];
            let title = t["title"]
                .as_str()
                .or(recording["title"].as_str())
                .unwrap_or("");
            let local=db::optional(&s.db,"SELECT * FROM library_tracks WHERE user_id=? AND lower(title)=lower(?) AND lower(artist)=lower(?) LIMIT 1",vec![json!(id(u)),json!(title),json!(artist)]).await?;
            let mut v = json!({"position":tracks.len()+1,"title":title,"recording_mbid":recording["id"],"duration_ms":t["length"],"artist_name":artist,"resolved":false,"video_id":null,"duration_sec":t["length"].as_i64().map(|v|v/1000)});
            if let Some(local) = local {
                let track = library::track_from_row(s, u, &local)?;
                v["video_id"] = track["video_id"].clone();
                v["thumbnail_url"] = track["thumbnail_url"].clone();
                v["resolved"] = json!(true);
            } else if resolve {
                let hits = media::search(s, &format!("{artist} {title} official audio"), 5)
                    .await
                    .unwrap_or_default();
                let normal = |v: &str| {
                    v.to_lowercase()
                        .chars()
                        .filter(|c| c.is_alphanumeric())
                        .collect::<String>()
                };
                let wanted = normal(title);
                let wanted_artist = normal(artist);
                if let Some(hit) = hits.iter().find(|h| {
                    let title = normal(text(h, "title"));
                    let artist = normal(text(h, "artist"));
                    title.contains(&wanted)
                        && (!wanted_artist.is_empty()
                            && (artist.contains(&wanted_artist) || title.contains(&wanted_artist)))
                        && t["length"]
                            .as_i64()
                            .zip(h["duration_sec"].as_i64())
                            .is_none_or(|(ms, secs)| (ms / 1000 - secs).abs() < 20)
                }) {
                    v["video_id"] = hit["video_id"].clone();
                    v["thumbnail_url"] = hit["thumbnail_url"].clone();
                    v["resolved"] = json!(true);
                }
            }
            tracks.push(v);
        }
    }
    let rid = text(&release, "id");
    Ok(
        json!({"mbid":mbid,"title":release["title"],"artist_name":artist,"artist_mbid":release["artist-credit"][0]["artist"]["id"],"release_date":release["date"],"release_type":release["release-group"]["primary-type"],"cover_url":format!("https://coverartarchive.org/release/{rid}/front-500"),"tracks":tracks}),
    )
}
