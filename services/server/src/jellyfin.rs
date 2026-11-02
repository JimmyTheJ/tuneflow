use crate::{
    Shared,
    db::{self, id, required, text},
    error::{ApiError, Result},
};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, OsRng, rand_core::RngCore},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::time::Duration;

fn allowed(s: &Shared, base: &str) -> bool {
    s.config
        .jellyfin_url
        .as_deref()
        .is_some_and(|v| v.trim_end_matches('/') == base)
        || s.config
            .jellyfin_allowed_urls
            .iter()
            .any(|v| v.trim_end_matches('/') == base)
}

fn seal(s: &Shared, token: &str) -> Result<String> {
    let key = Sha256::digest(s.config.jwt_secret.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), token.as_bytes())
        .map_err(|_| ApiError::upstream("Could not store Jellyfin connection"))?;
    Ok(STANDARD.encode([nonce.to_vec(), encrypted].concat()))
}
pub fn unseal(s: &Shared, v: &str) -> Result<String> {
    let data = STANDARD
        .decode(v)
        .map_err(|_| ApiError::upstream("Jellyfin connection needs relinking"))?;
    if data.len() < 12 {
        return Err(ApiError::upstream("Invalid Jellyfin connection"));
    }
    let key = Sha256::digest(s.config.jwt_secret.as_bytes());
    let c = Aes256Gcm::new_from_slice(&key).unwrap();
    let bytes = c
        .decrypt(Nonce::from_slice(&data[..12]), &data[12..])
        .map_err(|_| ApiError::upstream("Jellyfin connection needs relinking"))?;
    String::from_utf8(bytes).map_err(|_| ApiError::upstream("Invalid Jellyfin connection"))
}
pub async fn connection(s: &Shared, u: &Value) -> Result<Value> {
    let c = db::optional(
        &s.db,
        "SELECT * FROM jellyfin_connections WHERE user_id=?",
        vec![json!(id(u))],
    )
    .await?
    .ok_or_else(|| ApiError::bad("Link your Jellyfin account in Settings"))?;
    if !allowed(s, text(&c, "server_url")) {
        return Err(ApiError::forbidden(
            "Jellyfin server is not allowed by this Tuneflow server",
        ));
    }
    Ok(c)
}
pub async fn status(s: &Shared, u: &Value) -> Result<Value> {
    let c=db::optional(&s.db,"SELECT server_url,display_name,synced_at,sync_error FROM jellyfin_connections WHERE user_id=?",vec![json!(id(u))]).await?;
    let count = db::one(
        &s.db,
        "SELECT count(*) AS n FROM library_tracks WHERE user_id=?",
        vec![json!(id(u))],
    )
    .await?;
    Ok(
        json!({"linked":c.is_some(),"connection":c,"track_count":count["n"],"default_server_url":s.config.jellyfin_url}),
    )
}
pub async fn link(s: &Shared, u: &Value, b: &Value) -> Result<Value> {
    let base = if text(b, "server_url").is_empty() {
        s.config.jellyfin_url.clone().unwrap_or_default()
    } else {
        required(b, "server_url", 2000)?
    };
    let mut url =
        url::Url::parse(&base).map_err(|_| ApiError::bad("Enter a valid Jellyfin server URL"))?;
    if !["https", "http"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(ApiError::bad(
            "Jellyfin URL must use HTTP or HTTPS without credentials",
        ));
    }
    url.set_query(None);
    url.set_fragment(None);
    let base = url.as_str().trim_end_matches('/').to_string();
    if !allowed(s, &base) {
        return Err(ApiError::forbidden(
            "Jellyfin server is not allowed by this Tuneflow server",
        ));
    }
    let res=s.http.post(format!("{base}/Users/AuthenticateByName")).header("X-Emby-Authorization",format!("MediaBrowser Client=\"Tuneflow\", Device=\"Tuneflow server\", DeviceId=\"tuneflow-{}\", Version=\"0.4.0\"",id(u))).json(&json!({"Username":required(b,"username",200)?,"Pw":text(b,"password")})).timeout(Duration::from_secs(12)).send().await?;
    if !res.status().is_success() {
        return Err(ApiError::bad(
            "Jellyfin sign-in failed; check the server and credentials",
        ));
    }
    let payload: Value = res.json().await?;
    let token = required(&payload, "AccessToken", 4096)?;
    let remote = required(&payload["User"], "Id", 64)?;
    let encrypted = seal(s, &token)?;
    let name = text(&payload["User"], "Name");
    let mut tx = s.db.begin().await?;
    // Changing the linked account invalidates that user's previous index atomically.
    sqlx::query("DELETE FROM library_tracks WHERE user_id=?")
        .bind(id(u))
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO jellyfin_connections(user_id,server_url,remote_user_id,token_ciphertext,display_name) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET server_url=excluded.server_url,remote_user_id=excluded.remote_user_id,token_ciphertext=excluded.token_ciphertext,display_name=excluded.display_name,synced_at=NULL,sync_error=NULL").bind(id(u)).bind(base).bind(remote).bind(encrypted).bind(name).execute(&mut *tx).await?;
    tx.commit().await?;
    status(s, u).await
}
pub fn request(s: &Shared, c: &Value, path: &str) -> Result<reqwest::RequestBuilder> {
    Ok(s.http
        .get(format!("{}{path}", text(c, "server_url")))
        .header("X-Emby-Token", unseal(s, text(c, "token_ciphertext"))?))
}
pub async fn item(s: &Shared, u: &Value, item: &str) -> Result<Value> {
    if item.len() != 32 || !item.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::bad("Invalid library item"));
    }
    let c = connection(s, u).await?;
    let r = request(
        s,
        &c,
        &format!("/Users/{}/Items/{item}", text(&c, "remote_user_id")),
    )?
    .timeout(Duration::from_secs(8))
    .send()
    .await?;
    if !r.status().is_success() {
        return Err(ApiError::forbidden(
            "This item is unavailable to your Jellyfin account",
        ));
    }
    let v: Value = r.json().await?;
    if text(&v, "Type") != "Audio" {
        return Err(ApiError::bad("This item is not an audio track"));
    }
    Ok(v)
}
pub async fn sync(s: &Shared, u: &Value) -> Result<Value> {
    let _permit = s
        .sync_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| ApiError::upstream("Server shutting down"))?;
    let c = connection(s, u).await?;
    let generation = uuid::Uuid::new_v4().to_string();
    let mut tracks = vec![];
    let mut offset = 0;
    loop {
        let r = request(s, &c, "/Items")?
            .query(&[
                ("UserId", text(&c, "remote_user_id")),
                ("IncludeItemTypes", "Audio"),
                ("Recursive", "true"),
                ("Fields", "MediaSources,ProviderIds,ParentId,OfficialRating"),
                ("StartIndex", &offset.to_string()),
                ("Limit", "200"),
            ])
            .timeout(Duration::from_secs(20))
            .send()
            .await?
            .error_for_status()?;
        let p: Value = r.json().await?;
        let items = p["Items"]
            .as_array()
            .ok_or_else(|| ApiError::upstream("Invalid Jellyfin library response"))?;
        if items.is_empty() {
            break;
        }
        for t in items {
            if text(t, "Id").len() == 32 {
                tracks.push(t.clone());
            }
        }
        offset += items.len();
        if offset >= p["TotalRecordCount"].as_u64().unwrap_or(offset as u64) as usize {
            break;
        }
        if offset > 1_000_000 {
            return Err(ApiError::bad("Library exceeds indexing limit"));
        }
    }
    let mut tx = s.db.begin().await?;
    // Ensure a link wasn't replaced while the old account was being indexed.
    let current: Option<String> =
        sqlx::query_scalar("SELECT token_ciphertext FROM jellyfin_connections WHERE user_id=?")
            .bind(id(u))
            .fetch_optional(&mut *tx)
            .await?;
    if current.as_deref() != Some(text(&c, "token_ciphertext")) {
        return Err(ApiError::bad(
            "Jellyfin account changed during synchronization",
        ));
    }
    for t in &tracks {
        let artists = t["Artists"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let image = if t["ImageTags"]["Primary"].is_string() {
            text(t, "Id")
        } else {
            text(t, "AlbumId")
        };
        let explicit = matches!(text(t, "OfficialRating"), "Explicit" | "R" | "NC-17");
        sqlx::query("INSERT INTO library_tracks(user_id,item_id,title,artist,album,album_id,duration_sec,container,image_id,explicit,recording_mbid,generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,album_id=excluded.album_id,duration_sec=excluded.duration_sec,container=excluded.container,image_id=excluded.image_id,explicit=excluded.explicit,recording_mbid=excluded.recording_mbid,generation=excluded.generation").bind(id(u)).bind(text(t,"Id")).bind(text(t,"Name")).bind(artists).bind(text(t,"Album")).bind(text(t,"AlbumId")).bind(t["RunTimeTicks"].as_i64().map(|v|v/10_000_000)).bind(text(t,"Container")).bind(image).bind(explicit).bind(text(&t["ProviderIds"],"MusicBrainzTrack")).bind(&generation).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM library_tracks WHERE user_id=? AND generation<>?")
        .bind(id(u))
        .bind(generation)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE jellyfin_connections SET synced_at=CURRENT_TIMESTAMP,sync_error=NULL WHERE user_id=?").bind(id(u)).execute(&mut *tx).await?;
    tx.commit().await?;
    status(s, u).await
}
pub async fn unlink(s: &Shared, u: &Value) -> Result<()> {
    let c = db::optional(
        &s.db,
        "SELECT * FROM jellyfin_connections WHERE user_id=?",
        vec![json!(id(u))],
    )
    .await?
    .ok_or_else(|| ApiError::bad("Link your Jellyfin account in Settings"))?;
    if allowed(s, text(&c, "server_url"))
        && let Ok(token) = unseal(s, text(&c, "token_ciphertext"))
    {
        let _ = s
            .http
            .post(format!("{}/Sessions/Logout", text(&c, "server_url")))
            .header("X-Emby-Token", token)
            .timeout(Duration::from_secs(3))
            .send()
            .await;
    }
    let mut tx = s.db.begin().await?;
    sqlx::query("DELETE FROM library_tracks WHERE user_id=?")
        .bind(id(u))
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM jellyfin_connections WHERE user_id=?")
        .bind(id(u))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
