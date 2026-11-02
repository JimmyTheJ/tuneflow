use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;
use tuneflow_server::{App, Config, Shared, db, router};

async fn test_app() -> (TempDir, Shared, Router) {
    let dir = tempfile::tempdir().unwrap();
    let s = App::open(Config {
        data_dir: dir.path().to_owned(),
        jwt_secret: "test-secret-of-at-least-thirty-two-bytes".into(),
        youtube_bin: "/nonexistent/tuneflow-ytdlp".into(),
        jellyfin_url: None,
        jellyfin_allowed_urls: vec![],
    })
    .await
    .unwrap();
    let app = router(s.clone());
    (dir, s, app)
}
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    b: Value,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if !token.is_empty() {
        req = req.header("authorization", format!("Bearer {token}"));
    }
    let res = app
        .clone()
        .oneshot(req.body(Body::from(b.to_string())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn setup(app: &Router) -> String {
    let (status, b) = request(
        app,
        "POST",
        "/api/auth/setup",
        "",
        json!({"username":"root","password":"password123","display_name":"Root"}),
    )
    .await;
    assert_eq!(status, 201, "{b}");
    b["access_token"].as_str().unwrap().into()
}
async fn household(app: &Router, root: &str, slug: &str) -> String {
    let(status,b)=request(app,"POST","/api/households",root,json!({"name":slug,"slug":slug,"admin_username":"parent","admin_password":"password123","admin_display_name":"Parent"})).await;
    assert_eq!(status, 200, "{b}");
    let (status, b) = request(
        app,
        "POST",
        "/api/auth/login",
        "",
        json!({"household_slug":slug,"username":"parent","password":"password123"}),
    )
    .await;
    assert_eq!(status, 200, "{b}");
    b["access_token"].as_str().unwrap().into()
}
#[tokio::test]
async fn setup_login_and_legacy_bcrypt_work() {
    let (_d, _s, app) = test_app().await;
    let root = setup(&app).await;
    let (status, b) = request(&app, "GET", "/api/auth/me", &root, json!({})).await;
    assert_eq!(status, 200);
    assert_eq!(b["is_root_admin"], true);
    assert!(b.get("password_hash").is_none());
    assert!(b.get("parent_pin_hash").is_none());
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/auth/setup",
            "",
            json!({"username":"x","password":"password123","display_name":"X"})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/auth/login",
            "",
            json!({"household_slug":"system","username":"root","password":"wrong"})
        )
        .await
        .0,
        401
    );
}
#[tokio::test]
async fn playlists_roles_and_households_are_isolated() {
    let (_d, s, app) = test_app().await;
    let root = setup(&app).await;
    let a = household(&app, &root, "family-a").await;
    let b = household(&app, &root, "family-b").await;
    let (_, p) = request(
        &app,
        "POST",
        "/api/playlists",
        &a,
        json!({"name":"Mix","visibility":"household"}),
    )
    .await;
    let pid = p["id"].as_i64().unwrap();
    assert_eq!(
        request(&app, "GET", &format!("/api/playlists/{pid}"), &b, json!({}))
            .await
            .0,
        404
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/role-profiles",
            &a,
            json!({"name":"Evil","permissions":["system_admin"]})
        )
        .await
        .0,
        403
    );
    let (_, track) = request(
        &app,
        "POST",
        &format!("/api/playlists/{pid}/tracks"),
        &a,
        json!({"video_id":"abcdefghijk","title":"Song","artist":"Artist"}),
    )
    .await;
    assert!(track["id"].is_i64(), "{track}");
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/api/playlists/{pid}/tracks/reorder"),
            &a,
            json!({"track_ids":[]})
        )
        .await
        .0,
        400
    );
    let users = db::all(&s.db, "SELECT id FROM users WHERE is_root_admin=0", vec![])
        .await
        .unwrap();
    assert_eq!(users.len(), 2);
}
#[tokio::test]
async fn library_search_never_calls_youtube_and_media_tokens_are_scoped() {
    let (_d, s, app) = test_app().await;
    let root = setup(&app).await;
    db::exec(&s.db,"INSERT INTO library_tracks(user_id,item_id,title,artist,album,album_id,generation) VALUES(1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','Song','Artist','Album','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','x')",vec![]).await.unwrap();
    let (status, b) = request(&app, "GET", "/api/music/search?q=Song", &root, json!({})).await;
    assert_eq!(status, 200, "{b}");
    assert_eq!(b["groups"][0]["primary"]["source"], "jellyfin");
    let (status, stream) = request(
        &app,
        "GET",
        "/api/music/stream/jf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        &root,
        json!({}),
    )
    .await;
    assert_eq!(status, 200, "{stream}");
    assert!(!stream.to_string().contains("token_ciphertext"));
    let media_url = stream["audio_url"].as_str().unwrap();
    let token = media_url.split("token=").nth(1).unwrap();
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/users?token={token}"),
            "",
            json!({})
        )
        .await
        .0,
        401
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/music/audio/zzzzzzzzzzz?token={token}"),
            "",
            json!({})
        )
        .await
        .0,
        403
    );
    let user = db::one(&s.db, "SELECT * FROM users WHERE id=1", vec![])
        .await
        .unwrap();
    let _ = user;
}
#[tokio::test]
async fn cached_audio_supports_ranges_and_does_not_require_extractor() {
    let (d, s, app) = test_app().await;
    let root = setup(&app).await;
    let audio = d.path().join("audio_cache");
    tokio::fs::create_dir_all(&audio).await.unwrap();
    let file = audio.join("abcdefghijk.media");
    tokio::fs::write(&file, b"0123456789").await.unwrap();
    db::exec(&s.db,"INSERT INTO audio_cache_entries(video_id,file_path,file_size_bytes,mime_type,title) VALUES('abcdefghijk',?,10,'audio/mp4','Song')",vec![json!(file.to_string_lossy())]).await.unwrap();
    let req = Request::builder()
        .uri("/api/music/audio/abcdefghijk")
        .header("authorization", format!("Bearer {root}"))
        .header("range", "bytes=2-5")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), 206);
    assert_eq!(res.headers()["content-range"], "bytes 2-5/10");
    assert_eq!(res.into_body().collect().await.unwrap().to_bytes(), "2345");
}
#[tokio::test]
async fn legacy_database_defaults_are_migrated_without_losing_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let dbpath = dir.path().join("tuneflow.db");
    let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", dbpath.display()))
        .await
        .unwrap();
    let schema = include_str!("../schema.sql")
        .lines()
        .map(|line| {
            if let Some((before, after)) = line.split_once(" DEFAULT ")
                && !after.starts_with("CURRENT_TIMESTAMP")
            {
                return format!("{before}{}", if line.ends_with(',') { "," } else { "" });
            }
            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");
    sqlx::raw_sql(&schema).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO households(id,name,slug,is_system,search_defaults_json) VALUES(1,'System','system',1,'{}')").execute(&pool).await.unwrap();
    let hash = bcrypt::hash("password123", 4).unwrap();
    sqlx::query("INSERT INTO users(id,username,display_name,password_hash,household_id,is_root_admin,is_active) VALUES(42,'legacy','Legacy',?,1,1,1)").bind(hash).execute(&pool).await.unwrap();
    pool.close().await;
    let s = App::open(Config {
        data_dir: dir.path().to_owned(),
        jwt_secret: "test-secret-of-at-least-thirty-two-bytes".into(),
        youtube_bin: "missing".into(),
        jellyfin_url: None,
        jellyfin_allowed_urls: vec![],
    })
    .await
    .unwrap();
    let app = router(s.clone());
    let (status, b) = request(
        &app,
        "POST",
        "/api/auth/login",
        "",
        json!({"household_slug":"system","username":"legacy","password":"password123"}),
    )
    .await;
    assert_eq!(status, 200, "{b}");
    assert_eq!(b["user"]["id"], 42);
    let token = b["access_token"].as_str().unwrap();
    let (status, b) = request(
        &app,
        "POST",
        "/api/playlists",
        token,
        json!({"name":"New playlist"}),
    )
    .await;
    assert_eq!(status, 200, "{b}");
    assert!(std::fs::read_dir(dir.path()).unwrap().any(|e| {
        e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("tuneflow-before-rust-")
    }));
    assert!(
        db::all(&s.db, "PRAGMA foreign_key_check", vec![])
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn listening_progress_is_idempotent_and_does_not_duplicate_history() {
    let (_d, _s, app) = test_app().await;
    let root = setup(&app).await;
    let mut b = json!({"video_id":"abcdefghijk","title":"Song","artist":"Artist","duration_sec":180,"session_id":"native-playback-1","listened_sec":30});
    let (status, first) = request(&app, "POST", "/api/history", &root, b.clone()).await;
    assert_eq!(status, 200, "{first}");
    b["listened_sec"] = json!(60);
    let (_, second) = request(&app, "POST", "/api/history", &root, b.clone()).await;
    assert_eq!(first["id"], second["id"]);
    assert_eq!(second["listened_sec"], 60);
    b["listened_sec"] = json!(30);
    let (_, third) = request(&app, "POST", "/api/history", &root, b).await;
    assert_eq!(third["listened_sec"], 60);
    let (_, history) = request(&app, "GET", "/api/history", &root, json!({})).await;
    assert_eq!(history.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn cache_delete_returns_purge_result_for_web_client() {
    let (_d, _s, app) = test_app().await;
    let root = setup(&app).await;
    let (status, result) = request(&app, "DELETE", "/api/admin/cache", &root, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["deleted_entries"], 0);
    assert_eq!(result["freed_bytes"], 0);
}

#[tokio::test]
async fn login_tokens_are_not_accepted_in_query_strings() {
    let (_d, _s, app) = test_app().await;
    let root = setup(&app).await;
    let (status, _) = request(
        &app,
        "GET",
        &format!("/api/auth/me?token={root}"),
        "",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = request(
        &app,
        "GET",
        &format!("/api/library/images/jf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?token={root}"),
        "",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
