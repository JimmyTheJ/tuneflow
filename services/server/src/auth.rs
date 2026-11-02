use crate::{
    Params, Shared,
    db::{self, id, required, text},
    error::{ApiError, Result},
};
use axum::{
    Json,
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::{Timelike, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: i64,
    #[serde(default)]
    media: Option<String>,
}
pub fn token(s: &Shared, uid: i64, media: Option<String>) -> Result<String> {
    let life = if media.is_some() { 3600 } else { 7 * 86400 };
    encode(
        &Header::default(),
        &Claims {
            sub: uid.to_string(),
            exp: Utc::now().timestamp() + life,
            media,
        },
        &EncodingKey::from_secret(s.config.jwt_secret.as_bytes()),
    )
    .map_err(|_| ApiError::upstream("Could not create session"))
}
pub async fn authenticate(s: &Shared, h: &HeaderMap, q: &Params, path: &str) -> Result<Value> {
    let t = h
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| q.get("token").map(String::as_str))
        .ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "Sign in required".into()))?;
    let c = decode::<Claims>(
        t,
        &DecodingKey::from_secret(s.config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError(StatusCode::UNAUTHORIZED, "Session expired".into()))?
    .claims;
    if let Some(media) = c.media
        && ![
            format!("music/audio/{media}"),
            format!("music/video/{media}"),
            format!("library/images/{media}"),
        ]
        .contains(&path.to_string())
    {
        return Err(ApiError::forbidden(
            "Media token cannot access this endpoint",
        ));
    }
    let uid = c
        .sub
        .parse::<i64>()
        .map_err(|_| ApiError(StatusCode::UNAUTHORIZED, "Invalid session".into()))?;
    user(s, uid).await
}
pub async fn user(s: &Shared, uid: i64) -> Result<Value> {
    let mut u=db::one(&s.db,"SELECT u.*,h.name AS household_name,h.slug AS household_slug FROM users u LEFT JOIN households h ON h.id=u.household_id WHERE u.id=? AND u.is_active=1 AND u.deleted_at IS NULL",vec![json!(uid)]).await.map_err(|_|ApiError(StatusCode::UNAUTHORIZED,"Account unavailable".into()))?;
    let profiles=db::all(&s.db,"SELECT r.* FROM role_profiles r JOIN user_role_assignments a ON a.role_profile_id=r.id WHERE a.user_id=?",vec![json!(uid)]).await?;
    let mut permissions = vec![];
    for r in &profiles {
        if let Some(ps) = r["permissions"].as_array() {
            for p in ps {
                if !permissions.contains(p) {
                    permissions.push(p.clone());
                }
            }
        }
    }
    if u["is_root_admin"] == true {
        permissions = vec![
            json!("system_admin"),
            json!("manage_households"),
            json!("manage_household_members"),
            json!("manage_parental_controls"),
            json!("manage_role_profiles"),
            json!("set_parent_pin"),
        ];
    }
    u["permissions"] = json!(permissions);
    u["role_profiles"] = json!(profiles);
    u.as_object_mut().unwrap().remove("password_hash");
    u.as_object_mut().unwrap().remove("parent_pin_hash");
    Ok(u)
}
pub fn has(u: &Value, p: &str) -> bool {
    u["is_root_admin"] == true
        || u["permissions"]
            .as_array()
            .is_some_and(|ps| ps.iter().any(|v| v == p))
}
pub fn require(u: &Value, p: &str) -> Result<()> {
    if has(u, p) {
        Ok(())
    } else {
        Err(ApiError::forbidden("Permission required"))
    }
}
pub fn same(actor: &Value, target: &Value) -> Result<()> {
    if actor["is_root_admin"] == true
        || (!actor["household_id"].is_null() && actor["household_id"] == target["household_id"])
    {
        Ok(())
    } else {
        Err(ApiError::forbidden("Cross-household access denied"))
    }
}
pub async fn password_hash(password: String) -> Result<String> {
    if password.len() < 8 || password.len() > 72 {
        return Err(ApiError::bad("Passwords must contain 8–72 bytes"));
    }
    tokio::task::spawn_blocking(move || bcrypt::hash(password, bcrypt::DEFAULT_COST))
        .await
        .map_err(|_| ApiError::upstream("Password hashing failed"))?
        .map_err(|_| ApiError::bad("Invalid password"))
}
async fn verify(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || bcrypt::verify(password, &hash).unwrap_or(false))
        .await
        .unwrap_or(false)
}
pub async fn budget(s: &Shared, key: String, limit: u32) -> Result<()> {
    let mut l = s.limits.lock().await;
    l.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(900));
    let e = l.entry(key).or_insert((Instant::now(), 0));
    if e.1 >= limit {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts; try later".into(),
        ));
    }
    e.1 += 1;
    Ok(())
}
pub async fn setup(s: &Shared, b: Value, _h: &HeaderMap) -> Result<Response> {
    budget(s, "setup".into(), 5).await?;
    let username = required(&b, "username", 80)?.to_lowercase();
    let name = required(&b, "display_name", 120)?;
    let hash = password_hash(required(&b, "password", 72)?).await?;
    let mut tx = s.db.begin().await?;
    // A single INSERT SELECT is the setup gate, including concurrent requests.
    let r=sqlx::query("INSERT INTO users(username,display_name,password_hash,household_id,is_root_admin,is_active) SELECT ?,?,?,(SELECT id FROM households WHERE is_system=1 LIMIT 1),1,1 WHERE NOT EXISTS(SELECT 1 FROM users)").bind(username).bind(name).bind(hash).execute(&mut *tx).await?;
    if r.rows_affected() != 1 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Server already set up".into(),
        ));
    }
    tx.commit().await?;
    let uid = r.last_insert_rowid();
    Ok((StatusCode::CREATED,Json(json!({"access_token":token(s,uid,None)?,"token_type":"bearer","user":user(s,uid).await?}))).into_response())
}
pub async fn login(s: &Shared, b: Value, _h: &HeaderMap) -> Result<Response> {
    let username = required(&b, "username", 80)?.to_lowercase();
    let household = text(&b, "household_slug").to_lowercase();
    budget(s, format!("login:{household}:{username}"), 10).await?;
    let row=db::optional(&s.db,"SELECT u.* FROM users u JOIN households h ON h.id=u.household_id WHERE u.username=? AND h.slug=?",vec![json!(username),json!(household)]).await?;
    let valid = if let Some(ref r) = row {
        verify(
            text(&b, "password").to_string(),
            text(r, "password_hash").to_string(),
        )
        .await
    } else {
        verify(
            text(&b, "password").to_string(),
            "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYbHhY3Z1m6TO9Ys2lxGLB9x4vpF/C3e".into(),
        )
        .await;
        false
    };
    if !valid {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid household, username, or password".into(),
        ));
    }
    let uid = id(&row.unwrap());
    let u = user(s, uid).await?;
    s.limits
        .lock()
        .await
        .remove(&format!("login:{household}:{username}"));
    Ok(
        Json(json!({"access_token":token(s,uid,None)?,"token_type":"bearer","user":u}))
            .into_response(),
    )
}
pub async fn handle(
    s: &Shared,
    u: &Value,
    path: &str,
    m: &Method,
    b: Value,
    _h: &HeaderMap,
) -> Result<Value> {
    match path {
        "auth/me" => Ok(u.clone()),
        "auth/parent-pin/status" => {
            require(u, "set_parent_pin")?;
            let r = db::one(
                &s.db,
                "SELECT parent_pin_hash FROM users WHERE id=?",
                vec![json!(id(u))],
            )
            .await?;
            Ok(json!({"has_pin":!r["parent_pin_hash"].is_null()}))
        }
        "auth/parent-pin" if m == Method::PUT => {
            require(u, "set_parent_pin")?;
            let pin = required(&b, "pin", 12)?;
            if pin.len() < 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
                return Err(ApiError::bad("PIN must contain 4–12 digits"));
            }
            let hash = tokio::task::spawn_blocking(move || bcrypt::hash(pin, bcrypt::DEFAULT_COST))
                .await
                .unwrap()
                .map_err(|_| ApiError::bad("Invalid PIN"))?;
            db::exec(
                &s.db,
                "UPDATE users SET parent_pin_hash=? WHERE id=?",
                vec![json!(hash), json!(id(u))],
            )
            .await?;
            Ok(Value::Null)
        }
        "auth/parent-pin/enforced" | "auth/verify-parent-pin" => {
            let members=db::all(&s.db,"SELECT id,parent_pin_hash FROM users WHERE household_id=? AND parent_pin_hash IS NOT NULL AND is_active=1 AND deleted_at IS NULL",vec![u["household_id"].clone()]).await?;
            let mut enforced = false;
            let mut valid = false;
            if path.ends_with("verify-parent-pin") {
                budget(s, format!("pin:{}", id(u)), 10).await?;
            }
            for r in members {
                let member = user(s, id(&r)).await?;
                if has(&member, "set_parent_pin") {
                    enforced = true;
                    if path.ends_with("verify-parent-pin")
                        && verify(text(&b, "pin").into(), text(&r, "parent_pin_hash").into()).await
                    {
                        valid = true;
                    }
                }
            }
            Ok(if path.ends_with("enforced") {
                json!({"enforced":enforced&&u["is_root_admin"]!=true})
            } else {
                json!({"valid":valid})
            })
        }
        _ => Err(ApiError::missing()),
    }
}
pub async fn child_settings(s: &Shared, u: &Value) -> Result<Option<Value>> {
    if u["is_root_admin"] == true || !has(u, "subject_to_parental_controls") {
        return Ok(None);
    }
    db::optional(
        &s.db,
        "SELECT * FROM parental_settings WHERE child_user_id=?",
        vec![json!(id(u))],
    )
    .await
}
pub async fn enforce(
    s: &Shared,
    u: &Value,
    track: Option<&Value>,
    search: bool,
) -> Result<Option<Value>> {
    let Some(c) = child_settings(s, u).await? else {
        return Ok(None);
    };
    let h = Utc::now().hour() as i64;
    let start = c["allowed_start_hour"].as_i64().unwrap_or(0);
    let end = c["allowed_end_hour"].as_i64().unwrap_or(23);
    if !(if start <= end {
        h >= start && h <= end
    } else {
        h >= start || h <= end
    }) {
        return Err(ApiError::forbidden("Listening is not allowed at this time"));
    }
    if search && c["search_enabled"] == false {
        return Err(ApiError::forbidden("Search is disabled for this account"));
    }
    if let Some(max) = c["max_daily_minutes"].as_i64() {
        let used=db::one(&s.db,"SELECT coalesce(sum(listened_sec),0) n FROM play_history WHERE user_id=? AND played_at>=date('now')",vec![json!(id(u))]).await?["n"].as_i64().unwrap_or(0);
        if used >= max * 60 {
            return Err(ApiError::forbidden("Daily listening limit reached"));
        }
    }
    if let Some(t) = track
        && let Some(reason) = blocked(&c, t)
    {
        return Err(ApiError::forbidden(reason));
    }
    Ok(Some(c))
}
pub fn blocked(c: &Value, t: &Value) -> Option<String> {
    if c["blocked_video_ids"]
        .as_array()
        .is_some_and(|a| a.contains(&t["video_id"]))
    {
        return Some("Track blocked".into());
    }
    let words = format!("{} {}", text(t, "title"), text(t, "artist")).to_lowercase();
    if c["blocked_keywords"].as_array().is_some_and(|a| {
        a.iter()
            .filter_map(Value::as_str)
            .any(|k| !k.is_empty() && words.contains(&k.to_lowercase()))
    }) {
        return Some("Blocked keyword".into());
    }
    if c["block_explicit"] == true
        && (t["explicit"] == true
            || ["explicit", "fuck", "shit", "bitch"]
                .iter()
                .any(|w| words.split(|c: char| !c.is_alphanumeric()).any(|t| t == *w)))
    {
        return Some("Explicit content blocked".into());
    }
    None
}
