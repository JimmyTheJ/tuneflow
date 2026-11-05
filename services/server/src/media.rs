use crate::{
    Params, Shared, auth,
    db::{self, id, text},
    error::{ApiError, Result},
    jellyfin,
};
use axum::{
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tokio::{io::AsyncWriteExt, process::Command};

pub fn youtube_id(v: &str) -> bool {
    v.len() == 11
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
pub fn track(e: &Value) -> Option<Value> {
    let vid = text(e, "id");
    if !youtube_id(vid) {
        return None;
    }
    Some(
        json!({"id":format!("youtube:{vid}"),"video_id":vid,"source":"youtube","title":e["track"].as_str().or(e["title"].as_str()).unwrap_or(vid),"artist":e["artist"].as_str().or(e["uploader"].as_str()).or(e["channel"].as_str()),"duration_sec":e["duration"].as_f64().map(|v|v as i64),"thumbnail_url":format!("https://i.ytimg.com/vi/{vid}/hqdefault.jpg"),"source_title":e["title"],"channel_id":e["channel_id"]}),
    )
}
pub async fn extract(s: &Shared, args: Vec<String>, seconds: u64) -> Result<Value> {
    tokio::time::timeout(Duration::from_secs(seconds), async {
        let _permit = s
            .extractor_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ApiError::upstream("Server shutting down"))?;
        let out = Command::new(&s.config.youtube_bin)
            .args([
                "--ignore-config",
                "--no-warnings",
                "--no-progress",
                "--no-check-formats",
                "--socket-timeout",
                "5",
                "--retries",
                "0",
                "--extractor-retries",
                "0",
                "--js-runtimes",
                "deno",
                "--js-runtimes",
                "node",
            ])
            .args(args)
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|_| {
                ApiError::upstream(
                    "YouTube extractor unavailable; install yt-dlp and its JavaScript runtime",
                )
            })?;
        if !out.status.success() {
            tracing::warn!(code=?out.status.code(),"YouTube extractor failed");
            return Err(ApiError::upstream("YouTube could not provide this track"));
        }
        serde_json::from_slice(&out.stdout)
            .map_err(|_| ApiError::upstream("Invalid YouTube extractor response"))
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::GATEWAY_TIMEOUT,
            "YouTube lookup timed out".into(),
        )
    })?
}
pub async fn search(s: &Shared, query: &str, limit: i64) -> Result<Vec<Value>> {
    let key = format!("youtube:{}:{limit}", query.trim().to_lowercase());
    let s2 = s.clone();
    let query = query.to_string();
    let p = s
        .searches
        .try_get_with(key, async move {
            let p = extract(
                &s2,
                vec![
                    "--flat-playlist".into(),
                    "--dump-single-json".into(),
                    "--".into(),
                    format!("ytsearch{limit}:{query}"),
                ],
                10,
            )
            .await?;
            Ok::<Value, ApiError>(p)
        })
        .await
        .map_err(|e| (*e).clone())?;
    Ok(p["entries"]
        .as_array()
        .map(|a| a.iter().filter_map(track).collect())
        .unwrap_or_default())
}
pub async fn resolve(s: &Shared, vid: &str, video: bool) -> Result<Value> {
    if !youtube_id(vid) {
        return Err(ApiError::bad("Invalid YouTube ID"));
    }
    let key = format!("{}:{vid}", if video { "video" } else { "audio" });
    if let Some(error) = s.failures.get(&key).await {
        return Err(error);
    }
    let failure_key = key.clone();
    let s2 = s.clone();
    let vid = vid.to_owned();
    let started = Instant::now();
    let result = s
        .streams
        .try_get_with(key, async move {
            let selector = if video {
                "best[ext=mp4][height<=720]/best[height<=720]"
            } else {
                "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
            };
            let p = extract(
                &s2,
                vec![
                    "--no-playlist".into(),
                    "--dump-single-json".into(),
                    "-f".into(),
                    selector.into(),
                    "--".into(),
                    format!("https://www.youtube.com/watch?v={vid}"),
                ],
                12,
            )
            .await?;
            let mut t = track(&p)
                .ok_or_else(|| ApiError::upstream("YouTube returned an invalid recording"))?;
            t["upstream_url"] = p["url"].clone();
            t["upstream_headers"] = p["http_headers"].clone();
            if !t["upstream_url"].is_string() {
                return Err(ApiError::upstream("No playable audio available"));
            }
            t["mime_type"] = json!(match text(&p, "ext") {
                "m4a" => "audio/mp4",
                "mp4" => "video/mp4",
                "webm" if video => "video/webm",
                "webm" => "audio/webm",
                "opus" => "audio/ogg",
                _ => "application/octet-stream",
            });
            Ok::<Value, ApiError>(t)
        })
        .await
        .map_err(|e| (*e).clone());
    if let Err(e) = &result {
        s.failures.insert(failure_key, e.clone()).await;
    }
    s.metrics.resolves.fetch_add(1, Ordering::Relaxed);
    s.metrics
        .resolve_ms
        .fetch_add(started.elapsed().as_millis() as u64, Ordering::Relaxed);
    result
}
pub async fn stream_info(s: &Shared, u: &Value, vid: &str) -> Result<Value> {
    let mut t = if let Some(item) = vid.strip_prefix("jf_") {
        let row = db::one(
            &s.db,
            "SELECT * FROM library_tracks WHERE user_id=? AND item_id=?",
            vec![json!(id(u)), json!(item)],
        )
        .await?;
        crate::library::track_from_row(s, u, &row)?
    } else if let Some(entry) = db::optional(
        &s.db,
        "SELECT * FROM audio_cache_entries WHERE video_id=?",
        vec![json!(vid)],
    )
    .await?
    {
        if tokio::fs::try_exists(text(&entry, "file_path"))
            .await
            .unwrap_or(false)
        {
            json!({"video_id":vid,"title":entry["title"],"artist":entry["artist"],"duration_sec":entry["duration_sec"],"thumbnail_url":entry["thumbnail_url"],"mime_type":entry["mime_type"],"source":"youtube"})
        } else {
            resolve(s, vid, false).await?
        }
    } else {
        resolve(s, vid, false).await?
    };
    auth::enforce(s, u, Some(&t), false).await?;
    let ticket = auth::token(s, id(u), Some(vid.into()))?;
    t["audio_url"] = json!(format!("/api/music/audio/{vid}?token={ticket}"));
    t["playable_video_id"] = json!(vid);
    t["has_video"] = json!(!vid.starts_with("jf_"));
    if !vid.starts_with("jf_") {
        t["video_url"] = json!(format!("/api/music/video/{vid}?token={ticket}"));
    }
    t.as_object_mut().unwrap().remove("upstream_url");
    t.as_object_mut().unwrap().remove("upstream_headers");
    Ok(t)
}
pub async fn serve(
    s: &Shared,
    u: &Value,
    path: &str,
    q: &Params,
    h: &HeaderMap,
    method: Method,
) -> Result<Response> {
    let vid = path.rsplit('/').next().unwrap_or("");
    let image = path.starts_with("library/images/");
    let video = path.starts_with("music/video/");
    auth::enforce(s, u, None, false).await?;
    if let Some(item) = vid.strip_prefix("jf_") {
        let row = db::one(
            &s.db,
            "SELECT * FROM library_tracks WHERE user_id=? AND item_id=?",
            vec![json!(id(u)), json!(item)],
        )
        .await?;
        let track = crate::library::track_from_row(s, u, &row)?;
        auth::enforce(s, u, Some(&track), false).await?;
        // Re-check live authorization; cached metadata never grants access to removed items.
        jellyfin::item(s, u, item).await?;
        let c = jellyfin::connection(s, u).await?;
        let endpoint = if image {
            format!("/Items/{}/Images/Primary", text(&row, "image_id"))
        } else {
            format!("/Audio/{item}/stream")
        };
        let mut request = jellyfin::request(s, &c, &endpoint)?;
        if image {
            request = request.query(&[("MaxWidth", "512")]);
        } else {
            request = request.query(&[("Static", "true"), ("UserId", text(&c, "remote_user_id"))]);
        }
        if let Some(range) = h.get("range") {
            request = request.header("Range", range);
        }
        if method == Method::HEAD {
            request = s
                .http
                .head(format!("{}{}", text(&c, "server_url"), endpoint))
                .header("Authorization", jellyfin::authorization(s, &c)?)
                .query(&[("Static", "true"), ("UserId", text(&c, "remote_user_id"))]);
        }
        return proxy(s, request.send().await?, None, false).await;
    }
    if !youtube_id(vid) || image {
        return Err(ApiError::bad("Invalid media ID"));
    }
    let entry = db::optional(
        &s.db,
        "SELECT * FROM audio_cache_entries WHERE video_id=?",
        vec![json!(vid)],
    )
    .await?;
    if !video
        && let Some(e) = entry
        && tokio::fs::try_exists(text(&e, "file_path"))
            .await
            .unwrap_or(false)
    {
        auth::enforce(s, u, Some(&e), false).await?;
        let req = Request::builder()
            .method(method)
            .uri("/")
            .body(Body::empty())
            .unwrap();
        let (mut parts, body) = req.into_parts();
        parts.headers = h.clone();
        let req = Request::from_parts(parts, body);
        let r = tower_http::services::ServeFile::new(text(&e, "file_path"))
            .try_call(req)
            .await
            .map_err(|_| ApiError::upstream("Cannot read cached track"))?;
        let mut r = r.map(Body::new).into_response();
        if let Ok(mime) = text(&e, "mime_type").parse() {
            r.headers_mut().insert("content-type", mime);
        }
        return Ok(r);
    }
    let t = resolve(s, vid, video).await?;
    auth::enforce(s, u, Some(&t), false).await?;
    let mut req = s.http.request(
        if method == Method::HEAD {
            reqwest::Method::HEAD
        } else {
            reqwest::Method::GET
        },
        text(&t, "upstream_url"),
    );
    if let Some(headers) = t["upstream_headers"].as_object() {
        for (k, v) in headers {
            if let Some(v) = v.as_str()
                && !matches!(
                    k.to_ascii_lowercase().as_str(),
                    "host" | "content-length" | "range"
                )
            {
                req = req.header(k, v);
            }
        }
    }
    if let Some(range) = h.get("range") {
        req = req.header("Range", range);
    }
    let response = req.send().await?;
    if matches!(response.status().as_u16(), 401 | 403 | 410) {
        let forbidden = response.status().as_u16() == 403;
        s.streams
            .invalidate(&format!("{}:{vid}", if video { "video" } else { "audio" }))
            .await;
        return Err(ApiError::upstream(if forbidden {
            "YouTube rejected this stream (403). The server may need an updated yt-dlp or a PO token provider"
        } else {
            "YouTube stream expired; retry playback"
        }));
    }
    let settings = db::one(&s.db, "SELECT * FROM system_settings WHERE id=1", vec![]).await?;
    let cache = !video
        && method != Method::HEAD
        && settings["cache_enabled"] == true
        && settings["cache_retention_days"] != 0;
    let _ = q;
    proxy(s, response, Some(t), cache).await
}
async fn proxy(
    s: &Shared,
    up: reqwest::Response,
    track: Option<Value>,
    cache: bool,
) -> Result<Response> {
    let status = up.status();
    if !status.is_success() && status.as_u16() != 416 {
        return Err(ApiError::upstream("Media provider rejected playback"));
    }
    let mut response = Response::builder()
        .status(status.as_u16())
        .header("Cache-Control", "private, no-store");
    for name in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
    ] {
        if let Some(v) = up.headers().get(name) {
            response = response.header(name, v);
        }
    }
    let full_range = up
        .headers()
        .get("content-range")
        .and_then(|h| h.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes 0-"))
        .and_then(|value| value.split_once('/'))
        .is_some_and(|(end, total)| {
            end.parse::<u64>()
                .ok()
                .zip(total.parse::<u64>().ok())
                .is_some_and(|(end, total)| end.checked_add(1) == Some(total))
        });
    if !cache || !(status.as_u16() == 200 || status.as_u16() == 206 && full_range) {
        return Ok(response.body(Body::from_stream(up.bytes_stream())).unwrap());
    }
    let mut t = track.unwrap();
    if let Some(mime) = up
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
    {
        t["mime_type"] = json!(mime);
    }
    let s = s.clone();
    let (send, recv) =
        tokio::sync::mpsc::channel::<std::result::Result<axum::body::Bytes, std::io::Error>>(4);
    tokio::spawn(async move {
        let dir = s.config.data_dir.join("audio_cache");
        let _ = tokio::fs::create_dir_all(&dir).await;
        let tmp = dir.join(format!("{}.part", uuid::Uuid::new_v4()));
        let final_path = dir.join(format!("{}.media", text(&t, "video_id")));
        let mut file = tokio::fs::File::create(&tmp).await.ok();
        let mut bytes = 0u64;
        let mut complete = true;
        let mut stream = up.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(chunk) => {
                    bytes += chunk.len() as u64;
                    if bytes <= 128 * 1024 * 1024 {
                        if let Some(f) = file.as_mut()
                            && f.write_all(&chunk).await.is_err()
                        {
                            file = None;
                        }
                    } else {
                        file = None;
                    }
                    if send.send(Ok(chunk)).await.is_err() {
                        complete = false;
                        break;
                    }
                }
                Err(_) => {
                    complete = false;
                    let _ = send
                        .send(Err(std::io::Error::other("Media stream interrupted")))
                        .await;
                    break;
                }
            }
        }
        if let Some(mut f) = file
            && f.flush().await.is_ok()
            && complete
            && bytes > 0
        {
            drop(f);
            if tokio::fs::rename(&tmp, &final_path).await.is_ok() {
                let _=db::exec(&s.db,"INSERT INTO audio_cache_entries(video_id,file_path,file_size_bytes,mime_type,title,artist,thumbnail_url,duration_sec,has_video) VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(video_id) DO UPDATE SET file_path=excluded.file_path,file_size_bytes=excluded.file_size_bytes,mime_type=excluded.mime_type",vec![t["video_id"].clone(),json!(final_path.to_string_lossy()),json!(bytes),t["mime_type"].clone(),t["title"].clone(),t["artist"].clone(),t["thumbnail_url"].clone(),t["duration_sec"].clone()]).await;
            }
        }
        let _ = tokio::fs::remove_file(tmp).await;
    });
    let body = futures_util::stream::unfold(recv, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    });
    Ok(response.body(Body::from_stream(body)).unwrap())
}
