use crate::{
    Params, Shared, auth,
    db::{self, id, required, text},
    defaults,
    error::{ApiError, Result},
    number,
};
use axum::http::Method;
use serde_json::{Value, json};

pub async fn patch(
    s: &Shared,
    table: &str,
    key: &str,
    keyval: Value,
    b: &Value,
    allowed: &[&str],
) -> Result<()> {
    // Table and column names are exclusively static caller-owned allowlists.
    for field in allowed {
        if let Some(v) = b.get(*field) {
            db::exec(
                &s.db,
                &format!("UPDATE {table} SET {field}=? WHERE {key}=?"),
                vec![v.clone(), keyval.clone()],
            )
            .await?;
        }
    }
    Ok(())
}
fn family_admin(u: &Value) -> bool {
    u["is_root_admin"] == true
        || u["role_profiles"]
            .as_array()
            .is_some_and(|roles| roles.iter().any(|r| r["slug"] == "household_admin"))
}
fn can_manage(u: &Value, p: &Value) -> bool {
    p["user_id"] == u["id"]
        || (p["visibility"] == "household"
            && !u["household_id"].is_null()
            && p["household_id"] == u["household_id"]
            && family_admin(u))
}
async fn playlist(s: &Shared, u: &Value, pid: i64, write: bool, deleted: bool) -> Result<Value> {
    let p=db::one(&s.db,"SELECT p.*,u.display_name AS owner_display_name,u.household_id FROM playlists p JOIN users u ON u.id=p.user_id WHERE p.id=?",vec![json!(pid)]).await?;
    if !deleted && !p["deleted_at"].is_null() {
        return Err(ApiError::missing());
    }
    let own = p["user_id"] == u["id"];
    if write && !can_manage(u, &p) {
        return Err(ApiError::forbidden(
            "Only the owner or a family administrator can change this playlist",
        ));
    }
    if !own
        && !(p["visibility"] == "household"
            && p["household_id"] == u["household_id"]
            && !u["household_id"].is_null())
    {
        return Err(ApiError::missing());
    }
    Ok(p)
}
async fn playlist_read(s: &Shared, u: &Value, mut p: Value, detail: bool) -> Result<Value> {
    let pid = id(&p);
    let ts = db::all(
        &s.db,
        "SELECT t.*,u.display_name AS added_by_display_name FROM playlist_tracks t LEFT JOIN users u ON u.id=t.added_by_user_id WHERE t.playlist_id=? ORDER BY t.position,t.id",
        vec![json!(pid)],
    )
    .await?;
    p["owner_id"] = p["user_id"].clone();
    p["is_owner"] = json!(p["user_id"] == u["id"]);
    p["can_manage"] = json!(can_manage(u, &p));
    p["track_count"] = json!(ts.len());
    p["match_summary"] = json!({"matched":ts.iter().filter(|t|t["match_status"]=="matched").count(),"unmatched":ts.iter().filter(|t|t["match_status"]=="unmatched").count(),"pending":ts.iter().filter(|t|t["match_status"]=="pending").count()});
    if detail {
        p["tracks"] = json!(ts);
    }
    Ok(p)
}
fn visibility(b: &Value) -> Result<String> {
    let v = b["visibility"].as_str().unwrap_or("private");
    if !["private", "household"].contains(&v) {
        return Err(ApiError::bad("Invalid visibility"));
    }
    Ok(v.into())
}
fn track_body(b: &Value) -> Result<()> {
    required(b, "title", 500)?;
    let v = required(b, "video_id", 100)?;
    if !crate::media::youtube_id(&v)
        && !(v.starts_with("jf_") && v.len() == 35 && v[3..].bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(ApiError::bad("Invalid track ID"));
    }
    Ok(())
}
async fn add_track(s: &Shared, u: &Value, pid: i64, b: &Value) -> Result<Value> {
    track_body(b)?;
    let pos = db::one(
        &s.db,
        "SELECT coalesce(max(position),-1)+1 n FROM playlist_tracks WHERE playlist_id=?",
        vec![json!(pid)],
    )
    .await?["n"]
        .clone();
    let tid=db::exec(&s.db,"INSERT INTO playlist_tracks(playlist_id,video_id,title,artist,thumbnail_url,duration_sec,position,match_status,added_by_user_id) VALUES(?,?,?,?,?,?,?,'matched',?)",vec![json!(pid),b["video_id"].clone(),b["title"].clone(),b["artist"].clone(),b["thumbnail_url"].clone(),b["duration_sec"].clone(),pos,json!(id(u))]).await?;
    db::exec(
        &s.db,
        "UPDATE playlists SET updated_at=CURRENT_TIMESTAMP WHERE id=?",
        vec![json!(pid)],
    )
    .await?;
    db::one(
        &s.db,
        "SELECT * FROM playlist_tracks WHERE id=?",
        vec![json!(tid)],
    )
    .await
}
pub async fn personal(
    s: &Shared,
    u: &Value,
    path: &str,
    q: &Params,
    m: &Method,
    b: Value,
) -> Result<Value> {
    let parts = path.split('/').collect::<Vec<_>>();
    let uid = json!(id(u));
    match (m.as_str(),parts.as_slice()){
 ("GET",["history"])=>Ok(json!(db::all(&s.db,"SELECT * FROM play_history WHERE user_id=? ORDER BY played_at DESC,id DESC LIMIT ?",vec![uid,json!(number(q,"limit",50,1,200))]).await?)),
 ("POST",["history"])=>{
 track_body(&b)?;record_history(s,u,&b).await},
 ("GET",["likes"])=>Ok(json!(db::all(&s.db,"SELECT * FROM likes WHERE user_id=? ORDER BY liked_at DESC,id DESC",vec![uid]).await?)),
 ("POST",["likes"])=>{track_body(&b)?;let lid=db::exec(&s.db,"INSERT INTO likes(user_id,video_id,title,artist,thumbnail_url,duration_sec) VALUES(?,?,?,?,?,?)",vec![uid,b["video_id"].clone(),b["title"].clone(),b["artist"].clone(),b["thumbnail_url"].clone(),b["duration_sec"].clone()]).await?;db::one(&s.db,"SELECT * FROM likes WHERE id=?",vec![json!(lid)]).await},
 ("DELETE",["likes",vid])=>{db::exec(&s.db,"DELETE FROM likes WHERE user_id=? AND video_id=?",vec![uid,json!(vid)]).await?;Ok(Value::Null)},
 ("GET",["playlists"])=>{
 let rows=if q.get("scope").is_some_and(|v|v=="household"){db::all(&s.db,"SELECT p.*,u.display_name AS owner_display_name,u.household_id FROM playlists p JOIN users u ON u.id=p.user_id WHERE u.household_id=? AND p.visibility='household' AND p.deleted_at IS NULL ORDER BY p.updated_at DESC",vec![u["household_id"].clone()]).await?}else{db::all(&s.db,"SELECT p.*,u.display_name AS owner_display_name,u.household_id FROM playlists p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC",vec![uid]).await?};
 let mut out=vec![];for p in rows{out.push(playlist_read(s,u,p,false).await?);}Ok(json!(out))},
 ("POST",["playlists"])=>{let pid=db::exec(&s.db,"INSERT INTO playlists(user_id,name,description,visibility,source_type) VALUES(?,?,?,?,'manual')",vec![uid,json!(required(&b,"name",200)?),b["description"].clone(),json!(visibility(&b)?)]).await?;playlist_read(s,u,playlist(s,u,pid,false,false).await?,false).await},
 ("GET",["playlists","deleted"])=>{let rows=db::all(&s.db,"SELECT p.*,u.display_name AS owner_display_name,u.username AS owner_username,p.user_id AS owner_id FROM playlists p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NOT NULL AND (p.user_id=? OR ?=1) ORDER BY p.deleted_at DESC",vec![uid,u["is_root_admin"].clone()]).await?;let mut out=vec![];for p in rows{out.push(playlist_read(s,u,p,false).await?);}Ok(json!(out))},
 (_, ["playlists",pid,rest @ ..])=>{
 let pid=pid.parse::<i64>().map_err(|_|ApiError::missing())?;
 let write=m!=Method::GET&&rest!=["copy"];let deleted=rest==["restore"];let p=playlist(s,u,pid,write,deleted).await?;
 match (m.as_str(),rest){
 ("GET",[])=>playlist_read(s,u,p,true).await,
 ("PATCH",[])=>{if b.get("name").is_some(){required(&b,"name",200)?;}
 if b.get("visibility").is_some(){visibility(&b)?;}
 // Taking a family playlist private makes it personal to the acting administrator.
 if b["visibility"]=="private" && p["user_id"]!=u["id"] {
 db::exec(&s.db,"UPDATE playlists SET user_id=? WHERE id=?",vec![uid.clone(),json!(pid)]).await?;
 }
 patch(s,"playlists","id",json!(pid),&b,&["name","description","visibility"]).await?;playlist_read(s,u,playlist(s,u,pid,false,false).await?,false).await},
 ("DELETE",[])=>{db::exec(&s.db,"UPDATE playlists SET deleted_at=CURRENT_TIMESTAMP,deleted_by_user_id=? WHERE id=?",vec![uid,json!(pid)]).await?;Ok(Value::Null)},
 ("POST",["restore"])=>{db::exec(&s.db,"UPDATE playlists SET deleted_at=NULL,deleted_by_user_id=NULL WHERE id=?",vec![json!(pid)]).await?;playlist_read(s,u,playlist(s,u,pid,false,false).await?,false).await},
 ("POST",["copy"])=>{let copy=db::exec(&s.db,"INSERT INTO playlists(user_id,name,description,visibility,source_type) VALUES(?,?,?,'private','manual')",vec![uid,json!(format!("{} (copy)",text(&p,"name"))),p["description"].clone()]).await?;db::exec(&s.db,"INSERT INTO playlist_tracks(playlist_id,video_id,title,artist,thumbnail_url,duration_sec,position,match_status,added_by_user_id) SELECT ?,video_id,title,artist,thumbnail_url,duration_sec,position,match_status,? FROM playlist_tracks WHERE playlist_id=?",vec![json!(copy),json!(id(u)),json!(pid)]).await?;playlist_read(s,u,playlist(s,u,copy,false,false).await?,false).await},
 ("POST",["tracks"])=>add_track(s,u,pid,&b).await,
 ("PATCH",["tracks",tid])=>{
 track_body(&b)?;let tid=tid.parse::<i64>().map_err(|_|ApiError::missing())?;
 db::one(&s.db,"SELECT id FROM playlist_tracks WHERE playlist_id=? AND id=?",vec![json!(pid),json!(tid)]).await?;
 db::exec(&s.db,"UPDATE playlist_tracks SET video_id=?,thumbnail_url=?,duration_sec=?,match_status='matched',match_score=100 WHERE playlist_id=? AND id=?",vec![b["video_id"].clone(),b["thumbnail_url"].clone(),b["duration_sec"].clone(),json!(pid),json!(tid)]).await?;
 db::one(&s.db,"SELECT * FROM playlist_tracks WHERE playlist_id=? AND id=?",vec![json!(pid),json!(tid)]).await},
 ("DELETE",["tracks",tid])=>{db::exec(&s.db,"DELETE FROM playlist_tracks WHERE playlist_id=? AND id=?",vec![json!(pid),json!(tid.parse::<i64>().map_err(|_|ApiError::missing())?)]).await?;Ok(Value::Null)},
 ("POST",["tracks","reorder"])=>{
 let ids=b["track_ids"].as_array().ok_or_else(||ApiError::bad("track_ids required"))?;let existing=db::all(&s.db,"SELECT id FROM playlist_tracks WHERE playlist_id=?",vec![json!(pid)]).await?;
 let mut sorted=ids.iter().filter_map(Value::as_i64).collect::<Vec<_>>();sorted.sort();let mut want=existing.iter().map(id).collect::<Vec<_>>();want.sort();if sorted!=want{return Err(ApiError::bad("Track order must contain every playlist track exactly once"));}
 let mut tx=s.db.begin().await?;for(pos,tid)in ids.iter().enumerate(){sqlx::query("UPDATE playlist_tracks SET position=? WHERE id=? AND playlist_id=?").bind(pos as i64).bind(tid.as_i64()).bind(pid).execute(&mut *tx).await?;}tx.commit().await?;
 Ok(json!(db::all(&s.db,"SELECT * FROM playlist_tracks WHERE playlist_id=? ORDER BY position",vec![json!(pid)]).await?))},
 _=>Err(ApiError::missing())}
 },_=>Err(ApiError::missing())
 }
}
async fn managed(s: &Shared, u: &Value, uid: i64) -> Result<Value> {
    auth::require(u, "manage_household_members")?;
    let target = db::one(&s.db, "SELECT * FROM users WHERE id=?", vec![json!(uid)]).await?;
    auth::same(u, &target)?;
    if target["is_root_admin"] == true && uid != id(u) {
        return Err(ApiError::forbidden("Cannot modify root administrator"));
    }
    Ok(target)
}
async fn assign_profiles(
    s: &Shared,
    u: &Value,
    uid: i64,
    household: Value,
    ids: &Value,
) -> Result<()> {
    let ids = ids
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or_else(|| ApiError::bad("At least one role profile required"))?;
    let mut profiles = vec![];
    for pid in ids {
        let r=db::one(&s.db,"SELECT * FROM role_profiles WHERE id=? AND (is_global=1 OR owner_household_id=? OR is_public=1)",vec![pid.clone(),household.clone()]).await?;
        if r["permissions"].as_array().is_some_and(|ps| {
            ps.iter()
                .filter_map(Value::as_str)
                .any(|p| !auth::has(u, p))
        }) {
            return Err(ApiError::forbidden(
                "Cannot grant permissions you do not have",
            ));
        }
        profiles.push(r);
    }
    let mut tx = s.db.begin().await?;
    sqlx::query("DELETE FROM user_role_assignments WHERE user_id=?")
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    for r in profiles {
        sqlx::query(
            "INSERT OR IGNORE INTO user_role_assignments(user_id,role_profile_id) VALUES(?,?)",
        )
        .bind(uid)
        .bind(id(&r))
        .execute(&mut *tx)
        .await?;
        if r["permissions"]
            .as_array()
            .is_some_and(|a| a.contains(&json!("subject_to_parental_controls")))
        {
            sqlx::query("INSERT OR IGNORE INTO parental_settings(child_user_id,block_explicit,search_enabled,allowed_start_hour,allowed_end_hour,blocked_keywords,blocked_video_ids,search_advanced_hidden,search_locked,search_force_clean) VALUES(?,1,1,0,23,'[]','[]',0,0,0)").bind(uid).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}
fn slug(b: &Value, key: &str) -> Result<String> {
    let v = required(b, key, 80)?.to_lowercase();
    if !v
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(ApiError::bad(
            "Use letters, numbers and hyphens in household slug",
        ));
    }
    Ok(v)
}
async fn household_read(s: &Shared, hid: Value) -> Result<Value> {
    db::one(&s.db,"SELECT h.*,(SELECT count(*) FROM users u WHERE u.household_id=h.id AND u.deleted_at IS NULL) AS member_count FROM households h WHERE h.id=?",vec![hid]).await
}
async fn public_user(s: &Shared, uid: i64) -> Result<Value> {
    let raw = db::one(
        &s.db,
        "SELECT is_active,deleted_at FROM users WHERE id=?",
        vec![json!(uid)],
    )
    .await?;
    if raw["is_active"] == true && raw["deleted_at"].is_null() {
        return auth::user(s, uid).await;
    }
    let mut v=db::one(&s.db,"SELECT u.id,u.username,u.display_name,u.household_id,u.is_root_admin,u.is_active,u.deleted_at,u.created_at,h.name household_name,h.slug household_slug FROM users u LEFT JOIN households h ON h.id=u.household_id WHERE u.id=?",vec![json!(uid)]).await?;
    v["role_profiles"]=json!(db::all(&s.db,"SELECT r.* FROM role_profiles r JOIN user_role_assignments a ON a.role_profile_id=r.id WHERE a.user_id=?",vec![json!(uid)]).await?);
    v["permissions"] = json!([]);
    Ok(v)
}
pub async fn household(
    s: &Shared,
    u: &Value,
    path: &str,
    q: &Params,
    m: &Method,
    b: Value,
) -> Result<Value> {
    let p = path.split('/').collect::<Vec<_>>();
    let uid = json!(id(u));
    let hid = u["household_id"].clone();
    let _ = q;
    match (m.as_str(), p.as_slice()) {
        ("GET", ["households"]) => {
            auth::require(u, "manage_households")?;
            Ok(json!(db::all(&s.db,"SELECT h.*,(SELECT count(*) FROM users u WHERE u.household_id=h.id AND u.deleted_at IS NULL) AS member_count FROM households h WHERE h.is_system=0 ORDER BY h.name",vec![]).await?))
        }
        ("POST", ["households"]) => {
            auth::require(u, "manage_households")?;
            let name = required(&b, "name", 120)?;
            let slug = slug(&b, "slug")?;
            if slug == "system" {
                return Err(ApiError::bad("Reserved household slug"));
            }
            let hash = auth::password_hash(required(&b, "admin_password", 72)?).await?;
            let mut tx = s.db.begin().await?;
            let h=sqlx::query("INSERT INTO households(name,slug,is_system,search_defaults_json) VALUES(?,?,0,'{}')").bind(name).bind(slug).execute(&mut *tx).await?.last_insert_rowid();
            let member=sqlx::query("INSERT INTO users(username,display_name,password_hash,household_id,is_root_admin,is_active) VALUES(?,?,?,?,0,1)").bind(required(&b,"admin_username",80)?.to_lowercase()).bind(required(&b,"admin_display_name",120)?).bind(hash).bind(h).execute(&mut *tx).await?.last_insert_rowid();
            sqlx::query("INSERT INTO user_role_assignments(user_id,role_profile_id) SELECT ?,id FROM role_profiles WHERE slug='household_admin' AND is_global=1").bind(member).execute(&mut *tx).await?;
            tx.commit().await?;
            household_read(s, json!(h)).await
        }
        ("GET", ["households", "mine"]) => household_read(s, hid).await,
        ("PATCH", ["households", "mine"]) => {
            auth::require(u, "manage_role_profiles")?;
            let h = household_read(s, hid.clone()).await?;
            if h["is_system"] == true {
                return Err(ApiError::forbidden("System household cannot be changed"));
            }
            db::exec(
                &s.db,
                "UPDATE households SET slug=? WHERE id=?",
                vec![json!(slug(&b, "slug")?), hid.clone()],
            )
            .await?;
            household_read(s, hid).await
        }
        (_, ["households", "mine", "search-settings"]) => {
            let h = household_read(s, hid.clone()).await?;
            let mut opts = defaults();
            let saved: Value =
                serde_json::from_str(text(&h, "search_defaults_json")).unwrap_or(json!({}));
            merge(&mut opts, &saved);
            if m == Method::PATCH {
                if !auth::has(u, "manage_parental_controls")
                    && !auth::has(u, "manage_role_profiles")
                {
                    return Err(ApiError::forbidden(
                        "Household management permission required",
                    ));
                }
                merge(&mut opts, &b["search_defaults"]);
                db::exec(
                    &s.db,
                    "UPDATE households SET search_defaults_json=? WHERE id=?",
                    vec![json!(opts.to_string()), hid],
                )
                .await?;
            } else if m != Method::GET {
                return Err(ApiError::missing());
            }
            Ok(json!({"search_defaults":opts}))
        }
        ("GET", ["households", h, "members"]) => {
            auth::require(u, "manage_household_members")?;
            let h = h.parse::<i64>().map_err(|_| ApiError::missing())?;
            if u["is_root_admin"] != true && hid != h {
                return Err(ApiError::forbidden("Cross-household access denied"));
            }
            let rows = db::all(
                &s.db,
                "SELECT id FROM users WHERE household_id=? AND deleted_at IS NULL",
                vec![json!(h)],
            )
            .await?;
            let mut out = vec![];
            for r in rows {
                out.push(public_user(s, id(&r)).await?);
            }
            Ok(json!(out))
        }
        ("GET", ["users"]) | ("GET", ["users", "deleted"]) => {
            auth::require(u, "manage_household_members")?;
            let deleted = p.len() > 1;
            if deleted {
                auth::require(u, "system_admin")?;
            }
            let rows=db::all(&s.db,if deleted{"SELECT id FROM users WHERE deleted_at IS NOT NULL"}else{"SELECT id FROM users WHERE deleted_at IS NULL AND is_root_admin=0 AND (household_id=? OR ?=1)"},if deleted{vec![]}else{vec![hid,u["is_root_admin"].clone()]}).await?;
            let mut out = vec![];
            for r in rows {
                out.push(public_user(s, id(&r)).await?);
            }
            Ok(json!(out))
        }
        ("POST", ["users"]) => {
            auth::require(u, "manage_household_members")?;
            let h = household_read(s, hid.clone()).await?;
            if h["is_system"] == true {
                return Err(ApiError::forbidden(
                    "Create members from a household administrator account",
                ));
            }
            let hash = auth::password_hash(required(&b, "password", 72)?).await?;
            let member=db::exec(&s.db,"INSERT INTO users(username,display_name,password_hash,household_id,is_root_admin,is_active) VALUES(?,?,?,?,0,1)",vec![json!(required(&b,"username",80)?.to_lowercase()),json!(required(&b,"display_name",120)?),json!(hash),hid.clone()]).await?;
            if let Err(e) = assign_profiles(s, u, member, hid, &b["role_profile_ids"]).await {
                db::exec(&s.db, "DELETE FROM users WHERE id=?", vec![json!(member)]).await?;
                return Err(e);
            }
            public_user(s, member).await
        }
        (_, ["users", "me", "channel-pins", rest @ ..]) => {
            if rest.is_empty() {
                if m == Method::GET {
                    return Ok(json!(
                        db::all(
                            &s.db,
                            "SELECT * FROM user_channel_pins WHERE user_id=?",
                            vec![uid]
                        )
                        .await?
                    ));
                }
                if m != Method::PUT {
                    return Err(ApiError::missing());
                }
                let artist = required(&b, "artist_key", 200)?.to_lowercase();
                let channel = required(&b, "channel_name", 300)?;
                db::exec(&s.db,"INSERT INTO user_channel_pins(user_id,artist_key,channel_name) VALUES(?,?,?) ON CONFLICT(user_id,artist_key) DO UPDATE SET channel_name=excluded.channel_name",vec![uid.clone(),json!(artist),json!(channel)]).await?;
                db::one(
                    &s.db,
                    "SELECT * FROM user_channel_pins WHERE user_id=? AND artist_key=?",
                    vec![uid, json!(artist)],
                )
                .await
            } else if m == Method::DELETE {
                db::exec(
                    &s.db,
                    "DELETE FROM user_channel_pins WHERE user_id=? AND artist_key=?",
                    vec![uid, json!(rest[0])],
                )
                .await?;
                Ok(Value::Null)
            } else {
                Err(ApiError::missing())
            }
        }
        (_, ["users", member, rest @ ..]) => {
            let member = member.parse::<i64>().map_err(|_| ApiError::missing())?;
            let target = managed(s, u, member).await?;
            match (m.as_str(), rest) {
                ("PATCH", []) => {
                    if b.get("is_active").is_some()
                        && (member == id(u) || target["is_root_admin"] == true)
                    {
                        return Err(ApiError::forbidden("Cannot disable this account"));
                    }
                    if b.get("display_name").is_some() {
                        required(&b, "display_name", 120)?;
                    }
                    if let Some(profiles) = b.get("role_profile_ids") {
                        if member == id(u) && u["is_root_admin"] != true {
                            return Err(ApiError::forbidden("Cannot change your own roles"));
                        }
                        assign_profiles(s, u, member, target["household_id"].clone(), profiles)
                            .await?;
                    }
                    patch(
                        s,
                        "users",
                        "id",
                        json!(member),
                        &b,
                        &["display_name", "is_active"],
                    )
                    .await?;
                    public_user(s, member).await
                }
                ("POST", ["reset-password"]) => {
                    let hash = auth::password_hash(required(&b, "password", 72)?).await?;
                    db::exec(
                        &s.db,
                        "UPDATE users SET password_hash=? WHERE id=?",
                        vec![json!(hash), json!(member)],
                    )
                    .await?;
                    Ok(Value::Null)
                }
                ("DELETE", []) => {
                    auth::require(u, "system_admin")?;
                    if member == id(u) || target["is_root_admin"] == true {
                        return Err(ApiError::forbidden("Cannot delete this account"));
                    }
                    db::exec(
                        &s.db,
                        "UPDATE users SET deleted_at=CURRENT_TIMESTAMP,is_active=0 WHERE id=?",
                        vec![json!(member)],
                    )
                    .await?;
                    public_user(s, member).await
                }
                ("POST", ["restore"]) => {
                    auth::require(u, "system_admin")?;
                    db::exec(
                        &s.db,
                        "UPDATE users SET deleted_at=NULL,is_active=1 WHERE id=?",
                        vec![json!(member)],
                    )
                    .await?;
                    public_user(s, member).await
                }
                ("DELETE", ["permanent"]) => {
                    auth::require(u, "system_admin")?;
                    if target["deleted_at"].is_null() || target["is_root_admin"] == true {
                        return Err(ApiError::forbidden("Account must be soft deleted first"));
                    }
                    db::exec(&s.db, "DELETE FROM users WHERE id=?", vec![json!(member)]).await?;
                    Ok(Value::Null)
                }
                _ => Err(ApiError::missing()),
            }
        }
        (_, ["role-profiles", rest @ ..]) => roles(s, u, rest, m, b).await,
        (_, ["parental", rest @ ..]) => parental(s, u, rest, m, b).await,
        _ => Err(ApiError::missing()),
    }
}
fn merge(to: &mut Value, from: &Value) {
    if let Some(map) = from.as_object() {
        for (k, v) in map {
            if to.get(k).is_some() {
                to[k] = v.clone();
            }
        }
    }
}
async fn roles(s: &Shared, u: &Value, rest: &[&str], m: &Method, b: Value) -> Result<Value> {
    if rest.is_empty() && m == Method::GET {
        let mut rows=db::all(&s.db,"SELECT r.*,h.name AS owner_household_name FROM role_profiles r JOIN households h ON h.id=r.owner_household_id WHERE r.is_global=1 OR r.is_public=1 OR r.owner_household_id=?",vec![u["household_id"].clone()]).await?;
        for r in &mut rows {
            r["is_editable"] = json!(
                r["is_global"] != true
                    && (u["is_root_admin"] == true || r["owner_household_id"] == u["household_id"])
            );
        }
        return Ok(json!(rows));
    }
    auth::require(u, "manage_role_profiles")?;
    let name = required(&b, "name", 120)?;
    if let Some(ps) = b.get("permissions") {
        let ps = ps
            .as_array()
            .ok_or_else(|| ApiError::bad("permissions must be an array"))?;
        for p in ps {
            let p = p
                .as_str()
                .ok_or_else(|| ApiError::bad("Invalid permission"))?;
            if ["system_admin", "manage_households"].contains(&p) || !auth::has(u, p) {
                return Err(ApiError::forbidden("Cannot grant these permissions"));
            }
        }
    }
    let rid = if rest.is_empty() && m == Method::POST {
        db::exec(&s.db,"INSERT INTO role_profiles(name,owner_household_id,is_global,is_public,permissions) VALUES(?,?,0,?,?)",vec![json!(name),u["household_id"].clone(),b.get("is_public").cloned().unwrap_or(json!(false)),json!(b.get("permissions").cloned().unwrap_or(json!([])).to_string())]).await?
    } else if rest.len() == 1 && m == Method::PATCH {
        let rid = rest[0].parse::<i64>().map_err(|_| ApiError::missing())?;
        let r = db::one(
            &s.db,
            "SELECT * FROM role_profiles WHERE id=?",
            vec![json!(rid)],
        )
        .await?;
        if r["is_global"] == true
            || (u["is_root_admin"] != true && r["owner_household_id"] != u["household_id"])
        {
            return Err(ApiError::forbidden("Cannot edit this role"));
        }
        patch(
            s,
            "role_profiles",
            "id",
            json!(rid),
            &b,
            &["name", "is_public", "permissions"],
        )
        .await?;
        rid
    } else {
        return Err(ApiError::missing());
    };
    let mut r=db::one(&s.db,"SELECT r.*,h.name owner_household_name FROM role_profiles r JOIN households h ON h.id=r.owner_household_id WHERE r.id=?",vec![json!(rid)]).await?;
    r["is_editable"] = json!(true);
    Ok(r)
}
async fn parental(s: &Shared, u: &Value, rest: &[&str], m: &Method, b: Value) -> Result<Value> {
    if rest == ["me", "settings"] && m == Method::GET {
        return auth::child_settings(s, u)
            .await?
            .ok_or_else(ApiError::missing);
    }
    auth::require(u, "manage_parental_controls")?;
    if rest == ["children"] && m == Method::GET {
        let rows=db::all(&s.db,"SELECT p.* FROM parental_settings p JOIN users u ON u.id=p.child_user_id WHERE u.deleted_at IS NULL AND (u.household_id=? OR ?=1)",vec![u["household_id"].clone(),u["is_root_admin"].clone()]).await?;
        let mut out = vec![];
        for r in rows {
            out.push(json!({"user":public_user(s,r["child_user_id"].as_i64().unwrap()).await?,"settings":r}));
        }
        return Ok(json!(out));
    }
    if rest.len() != 2 {
        return Err(ApiError::missing());
    }
    let child = rest[0].parse::<i64>().map_err(|_| ApiError::missing())?;
    let target = db::one(&s.db, "SELECT * FROM users WHERE id=?", vec![json!(child)]).await?;
    auth::same(u, &target)?;
    match (m.as_str(), rest[1]) {
        ("GET", "settings") => {
            db::one(
                &s.db,
                "SELECT * FROM parental_settings WHERE child_user_id=?",
                vec![json!(child)],
            )
            .await
        }
        ("PUT", "settings") => {
            for key in ["allowed_start_hour", "allowed_end_hour"] {
                if let Some(v) = b.get(key)
                    && !v.as_i64().is_some_and(|v| (0..=23).contains(&v))
                {
                    return Err(ApiError::bad("Listening hours must be 0–23"));
                }
            }
            if b["max_daily_minutes"].as_i64().is_some_and(|v| v < 0) {
                return Err(ApiError::bad("Daily minutes cannot be negative"));
            }
            for key in ["blocked_keywords", "blocked_video_ids"] {
                if let Some(v) = b.get(key)
                    && !v.as_array().is_some_and(|a| a.iter().all(Value::is_string))
                {
                    return Err(ApiError::bad("Blocked entries must be a list of strings"));
                }
            }
            patch(
                s,
                "parental_settings",
                "child_user_id",
                json!(child),
                &b,
                &[
                    "block_explicit",
                    "search_enabled",
                    "max_daily_minutes",
                    "allowed_start_hour",
                    "allowed_end_hour",
                    "blocked_keywords",
                    "blocked_video_ids",
                    "search_advanced_hidden",
                    "search_locked",
                    "search_max_versions_ceiling",
                    "search_force_clean",
                ],
            )
            .await?;
            db::one(
                &s.db,
                "SELECT * FROM parental_settings WHERE child_user_id=?",
                vec![json!(child)],
            )
            .await
        }
        ("GET", "history") => Ok(json!(
            db::all(
                &s.db,
                "SELECT * FROM play_history WHERE user_id=? ORDER BY played_at DESC LIMIT 200",
                vec![json!(child)]
            )
            .await?
        )),
        ("GET", "usage") => {
            let c = db::one(
                &s.db,
                "SELECT * FROM parental_settings WHERE child_user_id=?",
                vec![json!(child)],
            )
            .await?;
            let seconds=db::one(&s.db,"SELECT coalesce(sum(listened_sec),0) n FROM play_history WHERE user_id=? AND played_at>=date('now')",vec![json!(child)]).await?["n"].as_i64().unwrap_or(0);
            let minutes = seconds as f64 / 60.;
            Ok(
                json!({"child_user_id":child,"listened_minutes_today":minutes,"max_daily_minutes":c["max_daily_minutes"],"remaining_minutes":c["max_daily_minutes"].as_f64().map(|v|(v-minutes).max(0.))}),
            )
        }
        _ => Err(ApiError::missing()),
    }
}

async fn record_history(s: &Shared, u: &Value, b: &Value) -> Result<Value> {
    let listened = b["listened_sec"].as_i64().unwrap_or(0).clamp(0, 86400);
    let session = text(b, "session_id");
    if session.len() > 80 {
        return Err(ApiError::bad("Invalid listening session"));
    }
    let mut tx = s.db.begin().await?;
    let previous: Option<i64> = if session.is_empty() {
        None
    } else {
        sqlx::query_scalar(
            "SELECT history_id FROM listening_sessions WHERE user_id=? AND session_id=?",
        )
        .bind(id(u))
        .bind(session)
        .fetch_optional(&mut *tx)
        .await?
    };
    let before: i64 = if let Some(hid) = previous {
        sqlx::query_scalar(
            "SELECT coalesce(listened_sec,0) FROM play_history WHERE id=? AND user_id=?",
        )
        .bind(hid)
        .bind(id(u))
        .fetch_one(&mut *tx)
        .await?
    } else {
        0
    };
    let hid = if let Some(hid) = previous {
        sqlx::query("UPDATE play_history SET listened_sec=max(coalesce(listened_sec,0),?) WHERE id=? AND user_id=?").bind(listened).bind(hid).bind(id(u)).execute(&mut *tx).await?;
        hid
    } else {
        let hid=sqlx::query("INSERT INTO play_history(user_id,video_id,title,artist,thumbnail_url,duration_sec,listened_sec) VALUES(?,?,?,?,?,?,?)").bind(id(u)).bind(text(b,"video_id")).bind(text(b,"title")).bind(b["artist"].as_str()).bind(b["thumbnail_url"].as_str()).bind(b["duration_sec"].as_i64()).bind(listened).execute(&mut *tx).await?.last_insert_rowid();
        if !session.is_empty() {
            sqlx::query(
                "INSERT INTO listening_sessions(user_id,session_id,history_id) VALUES(?,?,?)",
            )
            .bind(id(u))
            .bind(session)
            .bind(hid)
            .execute(&mut *tx)
            .await?;
        }
        hid
    };
    tx.commit().await?;
    let threshold = b["duration_sec"]
        .as_i64()
        .map(|v| (v / 2).clamp(1, 240))
        .unwrap_or(30);
    if before < threshold && listened >= threshold {
        crate::extras::schedule_scrobble(s, u, b, listened);
    }
    db::one(
        &s.db,
        "SELECT * FROM play_history WHERE id=?",
        vec![json!(hid)],
    )
    .await
}
