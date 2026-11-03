use axum::{
    Json, Router,
    body::{Body, Bytes, to_bytes},
    extract::{Query, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tuneflow_server::{App, Config, Shared, auth, db, jellyfin, library, media};

#[derive(Default)]
struct Mock {
    fail_page: AtomicBool,
    revoked: AtomicBool,
}
async fn fixture() -> (String, Arc<Mock>, tokio::task::JoinHandle<()>) {
    let state = Arc::new(Mock::default());
    async fn signin(h: HeaderMap) -> Response {
        if !h
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.starts_with("MediaBrowser Client=\"Tuneflow\"")
                    && v.contains("DeviceId=\"tuneflow-1\"")
            })
        {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        Json(
            json!({"AccessToken":"private-jellyfin-token","User":{"Id":"cccccccccccccccccccccccccccccccc","Name":"Listener"}}),
        ).into_response()
    }
    async fn items(
        State(s): State<Arc<Mock>>,
        Query(q): Query<HashMap<String, String>>,
        h: HeaderMap,
    ) -> Response {
        if h.get("Authorization").and_then(|v| v.to_str().ok())
            != Some("MediaBrowser Token=\"private-jellyfin-token\"")
        {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        let page = q.get("StartIndex").is_some_and(|v| v != "0");
        if page && s.fail_page.load(Ordering::Relaxed) {
            return StatusCode::BAD_GATEWAY.into_response();
        }
        let id = if page {
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        } else {
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        };
        Json(json!({"TotalRecordCount":2,"Items":[{"Id":id,"Name":if page{"Second Song"}else{"First Song"},"Artists":["Artist"],"AlbumArtist":"Listener","Album":"Album","AlbumId":"dddddddddddddddddddddddddddddddd","ParentIndexNumber":1,"IndexNumber":if page{1}else{2},"Container":"flac","RunTimeTicks":1800000000_i64,"Type":"Audio"}]})).into_response()
    }
    async fn item(State(s): State<Arc<Mock>>) -> Response {
        if s.revoked.load(Ordering::Relaxed) {
            return StatusCode::FORBIDDEN.into_response();
        }
        Json(json!({"Type":"Audio"})).into_response()
    }
    async fn audio(h: HeaderMap) -> Response {
        if let Some(range) = h.get("range")
            && range == "bytes=2-5"
        {
            return (
                StatusCode::PARTIAL_CONTENT,
                [
                    ("content-range", "bytes 2-5/10"),
                    ("content-type", "audio/flac"),
                    ("accept-ranges", "bytes"),
                ],
                "2345",
            )
                .into_response();
        }
        let stream = futures_util::stream::unfold(0, |i| async move {
            if i == 0 {
                Some((Ok::<_, std::io::Error>(Bytes::from_static(b"01234")), 1))
            } else if i == 1 {
                tokio::time::sleep(Duration::from_millis(1200)).await;
                Some((Ok(Bytes::from_static(b"56789")), 2))
            } else {
                None
            }
        });
        Response::builder()
            .header("content-type", "audio/flac")
            .header("content-length", "10")
            .body(Body::from_stream(stream))
            .unwrap()
    }
    let app = Router::new()
        .route("/Users/AuthenticateByName", post(signin))
        .route("/Items", get(items))
        .route("/Users/{uid}/Items/{id}", get(item))
        .route("/Audio/{id}/stream", get(audio))
        .route("/source", get(audio))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (base, state, task)
}
async fn app(allowed_jellyfin_url: Option<&str>) -> (tempfile::TempDir, Shared, Value) {
    let dir = tempfile::tempdir().unwrap();
    let s = App::open(Config {
        data_dir: dir.path().into(),
        jwt_secret: "tests-with-at-least-thirty-two-secret-bytes".into(),
        youtube_bin: "missing".into(),
        jellyfin_url: None,
        jellyfin_allowed_urls: allowed_jellyfin_url
            .into_iter()
            .map(str::to_owned)
            .collect(),
    })
    .await
    .unwrap();
    db::exec(&s.db,"INSERT INTO users(id,username,display_name,password_hash,household_id,is_root_admin) VALUES(1,'test','Test','unused',1,1)",vec![]).await.unwrap();
    let u = auth::user(&s, 1).await.unwrap();
    (dir, s, u)
}
#[tokio::test]
async fn existing_library_tracks_gain_sort_columns_without_losing_rows() {
    let dir = tempfile::tempdir().unwrap();
    let database = dir.path().join("tuneflow.db");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&database)
        .create_if_missing(true);
    let pool = sqlx::SqlitePool::connect_with(options).await.unwrap();
    sqlx::query("CREATE TABLE library_tracks(user_id INTEGER NOT NULL,item_id TEXT NOT NULL,title TEXT NOT NULL,artist TEXT,album TEXT,album_id TEXT,duration_sec INTEGER,container TEXT,image_id TEXT,explicit INTEGER NOT NULL DEFAULT 0,recording_mbid TEXT,generation TEXT NOT NULL,PRIMARY KEY(user_id,item_id))")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO library_tracks(user_id,item_id,title,generation) VALUES(1,'existing','Saved song','old')")
        .execute(&pool).await.unwrap();
    pool.close().await;
    let server = App::open(Config {
        data_dir: dir.path().into(),
        jwt_secret: "tests-with-at-least-thirty-two-secret-bytes".into(),
        youtube_bin: "missing".into(),
        jellyfin_url: None,
        jellyfin_allowed_urls: vec![],
    })
    .await
    .unwrap();
    let row = db::one(&server.db, "SELECT title,album_artist,disc_number,track_number FROM library_tracks WHERE item_id='existing'", vec![]).await.unwrap();
    assert_eq!(row["title"], "Saved song");
    assert!(row["album_artist"].is_null());
    assert!(row["track_number"].is_null());
}
#[tokio::test]
async fn jellyfin_link_rejects_unapproved_server_before_network_request() {
    let (base, _mock, upstream) = fixture().await;
    let (_dir, s, u) = app(None).await;
    let error = jellyfin::link(
        &s,
        &u,
        &json!({"server_url":base,"username":"listener","password":"password"}),
    )
    .await
    .unwrap_err();
    assert_eq!(error.0, StatusCode::FORBIDDEN);
    upstream.abort();
}
#[tokio::test]
async fn jellyfin_sync_is_private_atomic_and_searchable() {
    let (base, mock, upstream) = fixture().await;
    let (_dir, s, u) = app(Some(&base)).await;
    jellyfin::link(
        &s,
        &u,
        &json!({"server_url":base,"username":"listener","password":"password"}),
    )
    .await
    .unwrap();
    let c = jellyfin::connection(&s, &u).await.unwrap();
    assert_ne!(c["token_ciphertext"], "private-jellyfin-token");
    assert!(
        !jellyfin::status(&s, &u)
            .await
            .unwrap()
            .to_string()
            .contains("private-jellyfin-token")
    );
    let synced = jellyfin::sync(&s, &u).await.unwrap();
    assert_eq!(synced["track_count"], 2);
    let query = HashMap::from([(
        "album_id".to_string(),
        "dddddddddddddddddddddddddddddddd".to_string(),
    )]);
    let response = library::handle(&s, &u, "library/tracks", &query, &Method::GET, json!({}))
        .await
        .unwrap();
    let ordered: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(ordered[0]["title"], "Second Song");
    assert_eq!(ordered[0]["track_number"], 1);
    assert_eq!(ordered[0]["disc_number"], 1);
    let query = HashMap::from([("artist".to_string(), "Listener".to_string())]);
    let response = library::handle(&s, &u, "library/albums", &query, &Method::GET, json!({}))
        .await
        .unwrap();
    let albums: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(albums[0]["title"], "Album");
    let query = HashMap::from([("q".to_string(), "listen".to_string())]);
    let response = library::handle(&s, &u, "library/artists", &query, &Method::GET, json!({}))
        .await
        .unwrap();
    let artists: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(artists[0]["name"], "Listener");
    assert_eq!(artists[0]["album_count"], 1);
    assert_eq!(
        db::all(
            &s.db,
            "SELECT rowid FROM library_fts WHERE library_fts MATCH '\"First\"*'",
            vec![]
        )
        .await
        .unwrap()
        .len(),
        1
    );
    mock.fail_page.store(true, Ordering::Relaxed);
    assert!(jellyfin::sync(&s, &u).await.is_err());
    assert_eq!(jellyfin::status(&s, &u).await.unwrap()["track_count"], 2);
    let info = media::stream_info(&s, &u, "jf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        .await
        .unwrap();
    assert!(!info.to_string().contains("private-jellyfin-token"));
    assert!(!info.to_string().contains(&base));
    mock.revoked.store(true, Ordering::Relaxed);
    let res = media::serve(
        &s,
        &u,
        "music/audio/jf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        &HashMap::new(),
        &HeaderMap::new(),
        axum::http::Method::GET,
    )
    .await;
    assert_eq!(res.unwrap_err().0, StatusCode::FORBIDDEN);
    upstream.abort();
}
#[tokio::test]
async fn youtube_proxy_starts_before_download_finishes_and_saves_only_completed_audio() {
    let (base, _mock, upstream) = fixture().await;
    let (_dir, s, u) = app(None).await;
    s.streams.insert("audio:abcdefghijk".into(),json!({"video_id":"abcdefghijk","title":"Song","artist":"Artist","mime_type":"audio/flac","upstream_url":format!("{base}/source")})).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = tuneflow_server::router(s.clone());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let start = Instant::now();
    let response = reqwest::Client::new()
        .get(format!("http://{addr}/api/music/audio/abcdefghijk"))
        .bearer_auth(auth::token(&s, 1, None).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let mut bytes = response.bytes_stream();
    let first = bytes.next().await.unwrap().unwrap();
    assert!(
        start.elapsed() < Duration::from_millis(900),
        "startup took {:?}",
        start.elapsed()
    );
    assert_eq!(&first[..], b"01234");
    assert!(
        db::optional(
            &s.db,
            "SELECT * FROM audio_cache_entries WHERE video_id='abcdefghijk'",
            vec![]
        )
        .await
        .unwrap()
        .is_none()
    );
    assert_eq!(&bytes.next().await.unwrap().unwrap()[..], b"56789");
    while bytes.next().await.is_some() {}
    for _ in 0..30 {
        if db::optional(
            &s.db,
            "SELECT * FROM audio_cache_entries WHERE video_id='abcdefghijk'",
            vec![],
        )
        .await
        .unwrap()
        .is_some()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let cached = db::one(
        &s.db,
        "SELECT * FROM audio_cache_entries WHERE video_id='abcdefghijk'",
        vec![],
    )
    .await
    .unwrap();
    assert_eq!(cached["file_size_bytes"], 10);
    task.abort();
    upstream.abort();
    let _ = u;
}
#[tokio::test]
async fn jellyfin_forwards_seeking_ranges() {
    let (base, _mock, upstream) = fixture().await;
    let (_dir, s, u) = app(Some(&base)).await;
    jellyfin::link(
        &s,
        &u,
        &json!({"server_url":base,"username":"listener","password":"password"}),
    )
    .await
    .unwrap();
    jellyfin::sync(&s, &u).await.unwrap();
    let mut headers = HeaderMap::new();
    headers.insert("range", "bytes=2-5".parse().unwrap());
    let response = media::serve(
        &s,
        &u,
        "music/audio/jf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        &HashMap::new(),
        &headers,
        axum::http::Method::GET,
    )
    .await
    .unwrap();
    assert_eq!(response.status(), 206);
    assert_eq!(response.headers()["content-range"], "bytes 2-5/10");
    use http_body_util::BodyExt;
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "2345"
    );
    upstream.abort();
}
#[cfg(unix)]
#[tokio::test]
async fn simultaneous_playback_requests_extract_only_once() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, s, _u) = app(None).await;
    let script = dir.path().join("extractor");
    let counter = dir.path().join("count");
    std::fs::write(&script,format!("#!/usr/bin/python\nimport json,time\nwith open({:?},'a') as f:f.write('1\\n')\ntime.sleep(0.2)\nprint(json.dumps({{'id':'abcdefghijk','title':'Song','url':'https://example.com/audio','ext':'m4a'}}))\n",counter.to_string_lossy())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let s2 = App::open(Config {
        data_dir: dir.path().to_owned(),
        jwt_secret: s.config.jwt_secret.clone(),
        youtube_bin: script.to_string_lossy().into(),
        jellyfin_url: None,
        jellyfin_allowed_urls: vec![],
    })
    .await
    .unwrap();
    let mut tasks = vec![];
    for _ in 0..8 {
        let s = s2.clone();
        tasks.push(tokio::spawn(async move {
            media::resolve(&s, "abcdefghijk", false).await
        }));
    }
    for task in tasks {
        assert!(task.await.unwrap().is_ok());
    }
    assert_eq!(std::fs::read_to_string(counter).unwrap().lines().count(), 1);
}
