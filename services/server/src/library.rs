use crate::{
    Params, Shared, auth,
    db::{self, id, text},
    error::{ApiError, Result},
    jellyfin, media, number,
};
use axum::{
    Json,
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

pub fn track_from_row(s: &Shared, u: &Value, r: &Value) -> Result<Value> {
    let vid = format!("jf_{}", text(r, "item_id"));
    let ticket = auth::token(s, id(u), Some(vid.clone()))?;
    Ok(
        json!({"id":format!("jellyfin:{}",text(r,"item_id")),"video_id":vid,"source":"jellyfin","title":r["title"],"artist":r["artist"],"album":r["album"],"album_id":r["album_id"],"album_artist":r["album_artist"],"disc_number":r["disc_number"],"track_number":r["track_number"],"duration_sec":r["duration_sec"],"explicit":r["explicit"],"recording_mbid":r["recording_mbid"],"thumbnail_url":format!("/api/library/images/{vid}?token={ticket}"),"mime_type":match text(r,"container"){"flac"=>"audio/flac","mp3"=>"audio/mpeg","m4a"|"mp4"=>"audio/mp4","ogg"|"opus"=>"audio/ogg","wav"=>"audio/wav",_=>"application/octet-stream"}}),
    )
}
async fn tracks(s: &Shared, u: &Value, q: &Params) -> Result<Vec<Value>> {
    let query = q.get("q").map(|v| v.trim()).unwrap_or("");
    let terms = query
        .split_whitespace()
        .take(16)
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut args = vec![json!(id(u))];
    let search = if terms.is_empty() {
        String::new()
    } else {
        args.push(json!(terms));
        " AND rowid IN (SELECT rowid FROM library_fts WHERE library_fts MATCH ?)".into()
    };
    args.extend([
        json!(q.get("album_id").cloned().unwrap_or_default()),
        json!(q.get("album_id").cloned().unwrap_or_default()),
        json!(q.get("artist").cloned().unwrap_or_default()),
        json!(q.get("artist").cloned().unwrap_or_default()),
        json!(number(q, "limit", 100, 1, 500)),
        json!(number(q, "offset", 0, 0, 1_000_000)),
    ]);
    let rows=db::all(&s.db,&format!("SELECT * FROM library_tracks WHERE user_id=?{search} AND (?='' OR album_id=?) AND (?='' OR COALESCE(NULLIF(album_artist,''),NULLIF(artist,''),'Unknown artist')=?) ORDER BY COALESCE(NULLIF(album_artist,''),artist) COLLATE NOCASE,album COLLATE NOCASE,COALESCE(disc_number,1),COALESCE(track_number,1000000),title COLLATE NOCASE LIMIT ? OFFSET ?"),args).await?;
    let c = auth::child_settings(s, u).await?;
    rows.iter()
        .map(|r| {
            let mut t = track_from_row(s, u, r)?;
            if let Some(c) = &c {
                t["blocked_reason"] = json!(auth::blocked(c, &t));
            }
            Ok(t)
        })
        .collect()
}
async fn groups(s: &Shared, u: &Value, q: &Params, albums: bool) -> Result<Value> {
    let query = q.get("q").map(|v| v.trim()).unwrap_or("");
    let artist = q.get("artist").map(|v| v.as_str()).unwrap_or("");
    let artist_name = "COALESCE(NULLIF(album_artist,''),NULLIF(artist,''),'Unknown artist')";
    let (sql, args) = if albums {
        (
            format!(
                "SELECT album_id AS id,MAX(album) AS title,MAX({artist_name}) AS artist,count(*) AS track_count,min(item_id) AS item_id FROM library_tracks WHERE user_id=? AND album_id IS NOT NULL AND album_id<>'' AND album IS NOT NULL AND album<>'' AND (?='' OR {artist_name}=?) AND (?='' OR instr(lower(album || ' ' || {artist_name}),lower(?))>0) GROUP BY album_id ORDER BY artist COLLATE NOCASE,title COLLATE NOCASE LIMIT ? OFFSET ?"
            ),
            vec![
                json!(id(u)),
                json!(artist),
                json!(artist),
                json!(query),
                json!(query),
                json!(number(q, "limit", 100, 1, 500)),
                json!(number(q, "offset", 0, 0, 1_000_000)),
            ],
        )
    } else {
        (
            format!(
                "SELECT {artist_name} AS id,{artist_name} AS name,count(*) AS track_count,count(DISTINCT NULLIF(album_id,'')) AS album_count,min(item_id) AS item_id FROM library_tracks WHERE user_id=? AND (?='' OR instr(lower({artist_name}),lower(?))>0) GROUP BY {artist_name} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?"
            ),
            vec![
                json!(id(u)),
                json!(query),
                json!(query),
                json!(number(q, "limit", 100, 1, 500)),
                json!(number(q, "offset", 0, 0, 1_000_000)),
            ],
        )
    };
    let mut rows = db::all(&s.db, &sql, args).await?;
    for r in &mut rows {
        let t = track_from_row(s, u, r)?;
        r["thumbnail_url"] = t["thumbnail_url"].clone();
    }
    Ok(json!(rows))
}
pub async fn handle(
    s: &Shared,
    u: &Value,
    path: &str,
    q: &Params,
    m: &Method,
    b: Value,
) -> Result<Response> {
    if path.starts_with("music/") || path.starts_with("library/") {
        auth::enforce(s, u, None, false).await?;
    }
    let v = match (m.as_str(), path) {
        ("GET", "jellyfin") | ("GET", "jellyfin/status") => jellyfin::status(s, u).await?,
        ("POST", "jellyfin") | ("POST", "jellyfin/link") => {
            auth::budget(s, format!("jellyfin-link:{}", id(u)), 20).await?;
            jellyfin::link(s, u, &b).await?
        }
        ("DELETE", "jellyfin") => {
            jellyfin::unlink(s, u).await?;
            return Ok(StatusCode::NO_CONTENT.into_response());
        }
        ("POST", "jellyfin/sync") => {
            auth::budget(s, format!("library-sync:{}", id(u)), 20).await?;
            // Return immediately; playback and navigation never wait on a complete scan.
            let state = s.clone();
            let user = u.clone();
            tokio::spawn(async move {
                if let Err(e) = jellyfin::sync(&state, &user).await {
                    let _ = db::exec(
                        &state.db,
                        "UPDATE jellyfin_connections SET sync_error=? WHERE user_id=?",
                        vec![json!(e.1), json!(id(&user))],
                    )
                    .await;
                }
            });
            return Ok((StatusCode::ACCEPTED, Json(json!({"status":"queued"}))).into_response());
        }
        ("GET", "library/tracks") => {
            auth::enforce(s, u, None, false).await?;
            json!(tracks(s, u, q).await?)
        }
        ("GET", "library/albums") => {
            auth::enforce(s, u, None, false).await?;
            groups(s, u, q, true).await?
        }
        ("GET", "library/artists") => {
            auth::enforce(s, u, None, false).await?;
            groups(s, u, q, false).await?
        }
        ("GET", "music/search") | ("GET", "library/search") => {
            let needle = q.get("q").map(|v| v.trim()).unwrap_or("");
            if needle.is_empty() || needle.len() > 300 {
                return Err(ApiError::bad("Enter a search of 1–300 bytes"));
            }
            let c = auth::enforce(s, u, None, true).await?;
            let youtube = q.get("source").is_some_and(|v| v == "youtube");
            let options = crate::search::options(s, u, q, c.as_ref()).await?;
            let limit = options["results_per_page"]
                .as_i64()
                .unwrap_or(20)
                .clamp(1, 50);
            if youtube {
                auth::budget(s, format!("youtube-search:{}", id(u)), 120).await?;
            }
            let results = if youtube {
                media::search(s, needle, limit).await?
            } else {
                tracks(s, u, q).await?
            };
            let mut results = crate::search::rank(results, needle, &options);
            results.truncate(limit as usize);
            let mut grouped = vec![];
            for mut t in results {
                if let Some(c) = &c {
                    t["blocked_reason"] = json!(auth::blocked(c, &t));
                }
                grouped.push(json!({"group_key":t["video_id"],"primary":t,"alternates":[],"total_versions":1}));
            }
            json!({"groups":grouped,"artists":[],"next_page":null,"effective_options":options,"explanation":{"messages":[if youtube{"YouTube discovery"}else{"Your Jellyfin library"}]},"search_advanced_hidden":c.as_ref().is_some_and(|v|v["search_advanced_hidden"]==true)})
        }
        ("POST", "music/prepare") => {
            auth::enforce(s, u, None, false).await?;
            let ids = b["video_ids"]
                .as_array()
                .ok_or_else(|| ApiError::bad("video_ids required"))?;
            for vid in ids.iter().take(2).filter_map(Value::as_str) {
                let s = s.clone();
                let u = u.clone();
                let vid = vid.to_string();
                tokio::spawn(async move {
                    let _ = media::stream_info(&s, &u, &vid).await;
                });
            }
            json!({"status":"queued"})
        }
        _ => {
            if m != Method::GET && !(m == Method::POST && path.ends_with("/resolve")) {
                return Err(ApiError::missing());
            }
            if let Some(vid) = path.strip_prefix("music/stream/") {
                media::stream_info(s, u, vid).await?
            } else if let Some(album) = path.strip_prefix("library/albums/") {
                let mut q = q.clone();
                q.insert("album_id".into(), album.into());
                json!({"tracks":tracks(s,u,&q).await?})
            } else if let Some(artist) = path.strip_prefix("music/artists/") {
                let streaming = artist.ends_with("/stream");
                let artist = artist.trim_end_matches("/stream");
                let v = crate::catalog::artist(s, artist).await?;
                if streaming {
                    let lines = format!(
                        "{}\n{}\n",
                        json!({"event":"profile","data":v}),
                        json!({"event":"chunk","data":{"albums":v["albums"],"eps":v["eps"],"singles":v["singles"]}})
                    );
                    return Ok(([("content-type", "application/x-ndjson")], lines).into_response());
                }
                v
            } else if let Some(album) = path.strip_prefix("music/albums/") {
                if !album.starts_with("jf_") {
                    let resolve = album.ends_with("/resolve");
                    let v =
                        crate::catalog::album(s, u, album.trim_end_matches("/resolve"), resolve)
                            .await?;
                    return Ok(Json(v).into_response());
                }
                let album = album.trim_end_matches("/resolve").trim_start_matches("jf_");
                let mut q = q.clone();
                q.insert("album_id".into(), album.into());
                let ts = tracks(s, u, &q).await?;
                let title = ts
                    .first()
                    .map(|v| v["album"].clone())
                    .unwrap_or(json!("Album"));
                let artist = ts.first().map(|v| v["artist"].clone()).unwrap_or(json!(""));
                json!({"mbid":format!("jf_{album}"),"title":title,"artist_name":artist,"tracks":ts.into_iter().enumerate().map(|(i,mut t)|{t["position"]=json!(i+1);t["resolved"]=json!(true);t["artist_name"]=t["artist"].clone();t}).collect::<Vec<_>>()})
            } else {
                return Err(ApiError::missing());
            }
        }
    };
    Ok(Json(v).into_response())
}
