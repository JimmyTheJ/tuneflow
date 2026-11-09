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
    let album_id = if text(r, "album_id").is_empty() && !text(r, "album").is_empty() {
        let artist = if !text(r, "album_artist").is_empty() {
            text(r, "album_artist")
        } else if !text(r, "artist").is_empty() {
            text(r, "artist")
        } else {
            "Unknown artist"
        };
        format!("name:{}", json!([artist, text(r, "album")]))
    } else {
        text(r, "album_id").to_string()
    };
    Ok(
        json!({"id":format!("jellyfin:{}",text(r,"item_id")),"video_id":vid,"source":"jellyfin","title":r["title"],"artist":r["artist"],"album":r["album"],"album_id":album_id,"album_artist":r["album_artist"],"disc_number":r["disc_number"],"track_number":r["track_number"],"duration_sec":r["duration_sec"],"explicit":r["explicit"],"recording_mbid":r["recording_mbid"],"thumbnail_url":format!("/api/library/images/{vid}?token={ticket}"),"mime_type":match text(r,"container"){"flac"=>"audio/flac","mp3"=>"audio/mpeg","m4a"|"mp4"=>"audio/mp4","ogg"|"opus"=>"audio/ogg","wav"=>"audio/wav",_=>"application/octet-stream"}}),
    )
}
fn track_selection(u: &Value, q: &Params) -> Result<(String, Vec<Value>)> {
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
    let artist_name = "COALESCE(NULLIF(album_artist,''),NULLIF(artist,''),'Unknown artist')";
    let mut sql = format!("SELECT * FROM library_tracks WHERE user_id=?{search}");
    if let Some(album_id) = q.get("album_id").filter(|value| !value.is_empty()) {
        if let Some(encoded) = album_id.strip_prefix("name:") {
            let (artist, album): (String, String) = serde_json::from_str(encoded)
                .map_err(|_| ApiError::bad("Invalid album identifier"))?;
            sql.push_str(&format!(
                " AND COALESCE(album_id,'')='' AND {artist_name}=? AND album=?"
            ));
            args.extend([json!(artist), json!(album)]);
        } else {
            sql.push_str(" AND album_id=?");
            args.push(json!(album_id));
        }
    }
    if let Some(artist) = q.get("artist").filter(|value| !value.is_empty()) {
        // Jellyfin often uses slash-separated album artists for collaborations.
        // Match a complete participant, so 2Pac also sees 2Pac/50 Cent albums.
        sql.push_str(&format!(" AND instr(lower('/' || replace(replace({artist_name}, ' / ', '/'), '/ ', '/') || '/'), lower('/' || ? || '/'))>0"));
        args.push(json!(artist));
    }
    Ok((sql, args))
}
fn initial_bucket(name: &str) -> String {
    let first = format!("substr(upper(trim({name})),1,1)");
    format!(
        "CASE WHEN {first} BETWEEN 'A' AND 'Z' OR {first} BETWEEN '0' AND '9' THEN {first} ELSE '#' END"
    )
}
fn initial_order() -> &'static str {
    "CASE WHEN initial BETWEEN 'A' AND 'Z' THEN 0 WHEN initial BETWEEN '0' AND '9' THEN 1 ELSE 2 END,initial"
}
fn apply_initial(
    sql: &mut String,
    args: &mut Vec<Value>,
    q: &Params,
    bucket: &str,
    join: &str,
) -> Result<()> {
    if let Some(initial) = q.get("initial") {
        let initial = initial.to_ascii_uppercase();
        if initial.len() != 1
            || !initial
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'#')
        {
            return Err(ApiError::bad("Initial must be A–Z, 0–9 or #"));
        }
        sql.push_str(&format!(" {join} {bucket}=?"));
        args.push(json!(initial));
    }
    Ok(())
}
async fn track_index(s: &Shared, u: &Value, q: &Params) -> Result<Value> {
    let (sql, args) = track_selection(u, q)?;
    let bucket = initial_bucket("title");
    let rows = db::all(&s.db, &format!("SELECT {bucket} AS initial,count(*) AS count FROM ({sql}) GROUP BY initial ORDER BY {}", initial_order()), args).await?;
    Ok(json!({"grouping":"initial","groups":rows}))
}
async fn tracks(s: &Shared, u: &Value, q: &Params) -> Result<Vec<Value>> {
    let (mut sql, mut args) = track_selection(u, q)?;
    apply_initial(&mut sql, &mut args, q, &initial_bucket("title"), "AND")?;
    let artist_name = "COALESCE(NULLIF(album_artist,''),NULLIF(artist,''),'Unknown artist')";
    if q.contains_key("initial") {
        sql.push_str(" ORDER BY title COLLATE NOCASE,artist COLLATE NOCASE,album COLLATE NOCASE,item_id LIMIT ? OFFSET ?");
    } else {
        sql.push_str(&format!(" ORDER BY {artist_name} COLLATE NOCASE,album COLLATE NOCASE,COALESCE(disc_number,1),COALESCE(track_number,1000000),title COLLATE NOCASE,item_id LIMIT ? OFFSET ?"));
    }
    args.extend([
        json!(number(q, "limit", 100, 1, 500)),
        json!(number(q, "offset", 0, 0, 1_000_000)),
    ]);
    let rows = db::all(&s.db, &sql, args).await?;
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
    let artist_name = "COALESCE(NULLIF(library_tracks.album_artist,''),NULLIF(library_tracks.artist,''),'Unknown artist')";
    let lead_artist = format!(
        "CASE WHEN instr({artist_name},'/')>0 AND EXISTS(SELECT 1 FROM library_tracks AS standalone WHERE standalone.user_id=library_tracks.user_id AND lower(COALESCE(NULLIF(standalone.album_artist,''),NULLIF(standalone.artist,''),'Unknown artist'))=lower(trim(substr({artist_name},1,instr({artist_name},'/')-1)))) THEN trim(substr({artist_name},1,instr({artist_name},'/')-1)) ELSE {artist_name} END"
    );
    let mut args = vec![json!(id(u))];
    let mut sql = if albums {
        format!(
            "SELECT COALESCE(NULLIF(album_id,''),'name:' || json_array({artist_name},album)) AS id,MAX(album) AS title,MAX({artist_name}) AS artist,count(*) AS track_count,min(item_id) AS item_id FROM library_tracks WHERE user_id=? AND album IS NOT NULL AND album<>''"
        )
    } else {
        format!(
            "SELECT {lead_artist} AS id,{lead_artist} AS name,count(*) AS track_count,count(DISTINCT CASE WHEN album IS NOT NULL AND album<>'' THEN COALESCE(NULLIF(album_id,''),'name:' || json_array({artist_name},album)) END) AS album_count,min(item_id) AS item_id FROM library_tracks WHERE user_id=?"
        )
    };
    if albums && !artist.is_empty() {
        sql.push_str(&format!(" AND instr(lower('/' || replace(replace({artist_name}, ' / ', '/'), '/ ', '/') || '/'), lower('/' || ? || '/'))>0"));
        args.push(json!(artist));
    }
    if !query.is_empty() {
        let filter = if albums {
            format!(" AND instr(lower(album || ' ' || {artist_name}),lower(?))>0")
        } else {
            format!(" AND instr(lower({lead_artist}),lower(?))>0")
        };
        sql.push_str(&filter);
        args.push(json!(query));
    }
    sql.push_str(if albums {
        " GROUP BY id"
    } else {
        " GROUP BY name"
    });
    // Filter the grouped display name, not a track title or an album's artist.
    let display_name = if albums { "title" } else { "name" };
    let bucket = initial_bucket(display_name);
    let grouped = format!("SELECT * FROM ({sql}) AS library_groups");
    if q.get("group_by").is_some_and(|value| value == "initial") {
        let counts = db::all(&s.db, &format!("SELECT {bucket} AS initial,count(*) AS count FROM ({grouped}) GROUP BY initial ORDER BY {}", initial_order()), args).await?;
        return Ok(json!({"grouping":"initial","groups":counts}));
    }
    sql = grouped;
    apply_initial(&mut sql, &mut args, q, &bucket, "WHERE")?;
    sql.push_str(if albums && q.contains_key("initial") {
        " ORDER BY title COLLATE NOCASE,artist COLLATE NOCASE,id"
    } else if albums {
        " ORDER BY artist COLLATE NOCASE,title COLLATE NOCASE,id"
    } else {
        " ORDER BY name COLLATE NOCASE,id"
    });
    sql.push_str(" LIMIT ? OFFSET ?");
    args.extend([
        json!(number(q, "limit", 100, 1, 500)),
        json!(number(q, "offset", 0, 0, 1_000_000)),
    ]);
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
            if q.get("group_by").is_some_and(|v| v == "initial") {
                track_index(s, u, q).await?
            } else {
                json!(tracks(s, u, q).await?)
            }
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
