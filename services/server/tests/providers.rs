use axum::{
    Json, Router,
    body::{Body, Bytes, to_bytes},
    extract::{Path, Query, State},
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
    async fn redirected_audio(
        Path(expected_method): Path<String>,
        Query(q): Query<HashMap<String, String>>,
        method: Method,
        h: HeaderMap,
    ) -> Response {
        assert_eq!(method.as_str(), expected_method);
        assert_eq!(q.get("signature").map(String::as_str), Some("fixture"));
        assert_eq!(h["user-agent"], "Extractor fixture");
        assert_eq!(h["referer"], "https://www.youtube.com/");
        assert_eq!(h["range"], "bytes=2-5");
        audio(h).await
    }
    let app = Router::new()
        .route("/Users/AuthenticateByName", post(signin))
        .route("/Items", get(items))
        .route("/Users/{uid}/Items/{id}", get(item))
        .route("/Audio/{id}/stream", get(audio))
        .route("/source", get(audio))
        .route(
            "/redirect/{method}",
            get(|Path(method): Path<String>| async move {
                (
                    StatusCode::FOUND,
                    [("location", format!("/redirect-next/{method}"))],
                )
            }),
        )
        .route(
            "/redirect-next/{method}",
            get(|Path(method): Path<String>| async move {
                (
                    StatusCode::TEMPORARY_REDIRECT,
                    [(
                        "location",
                        format!("/redirected-source/{method}?signature=fixture"),
                    )],
                )
            }),
        )
        .route("/redirected-source/{method}", get(redirected_audio))
        .route(
            "/redirect-loop",
            get(|| async {
                (
                    StatusCode::FOUND,
                    [("location", "/redirect-loop?signature=private")],
                )
            }),
        )
        .route("/rejected", get(|| async { StatusCode::TOO_MANY_REQUESTS }))
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
async fn artists_search_and_album_groups_work_without_jellyfin_album_ids() {
    let (_dir, s, u) = app(None).await;
    for (item, artist, album) in [
        ("alpha-1", "Alpha", "First"),
        ("alpha-2", "Alpha", "Second"),
        ("beta-1", "Beta", "Other"),
    ] {
        db::exec(
            &s.db,
            "INSERT INTO library_tracks(user_id,item_id,title,artist,album,album_id,generation) VALUES(1,?,?,?,?,NULL,'test')",
            vec![json!(item), json!(item), json!(artist), json!(album)],
        )
        .await
        .unwrap();
    }
    db::exec(
        &s.db,
        "INSERT INTO library_tracks(user_id,item_id,title,artist,album,album_id,album_artist,generation) VALUES(1,'collab','Collab','Alpha, Beta','Together',NULL,'Alpha/Beta','test')",
        vec![],
    )
    .await
    .unwrap();
    db::exec(
        &s.db,
        "INSERT INTO library_tracks(user_id,item_id,title,artist,album,album_id,album_artist,generation) VALUES(1,'slash-band','Band','AC/DC','Live',NULL,'AC/DC','test')",
        vec![],
    )
    .await
    .unwrap();
    let artists = library::handle(
        &s,
        &u,
        "library/artists",
        &HashMap::from([("q".into(), "alpha".into())]),
        &Method::GET,
        json!({}),
    )
    .await
    .unwrap();
    let artists: Value =
        serde_json::from_slice(&to_bytes(artists.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(artists.as_array().unwrap().len(), 1);
    assert_eq!(artists[0]["name"], "Alpha");
    assert_eq!(artists[0]["album_count"], 3);
    let band = library::handle(
        &s,
        &u,
        "library/artists",
        &HashMap::from([("q".into(), "AC/DC".into())]),
        &Method::GET,
        json!({}),
    )
    .await
    .unwrap();
    let band: Value =
        serde_json::from_slice(&to_bytes(band.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(band[0]["name"], "AC/DC");
    let albums = library::handle(
        &s,
        &u,
        "library/albums",
        &HashMap::from([("artist".into(), "Alpha".into())]),
        &Method::GET,
        json!({}),
    )
    .await
    .unwrap();
    let albums: Value =
        serde_json::from_slice(&to_bytes(albums.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(albums.as_array().unwrap().len(), 3);
    let beta_albums = library::handle(
        &s,
        &u,
        "library/albums",
        &HashMap::from([("artist".into(), "Beta".into())]),
        &Method::GET,
        json!({}),
    )
    .await
    .unwrap();
    let beta_albums: Value =
        serde_json::from_slice(&to_bytes(beta_albums.into_body(), usize::MAX).await.unwrap())
            .unwrap();
    assert_eq!(beta_albums.as_array().unwrap().len(), 2);
    let album_id = albums[0]["id"].as_str().unwrap();
    assert!(album_id.starts_with("name:"));
    let tracks = library::handle(
        &s,
        &u,
        "library/tracks",
        &HashMap::from([("album_id".into(), album_id.into())]),
        &Method::GET,
        json!({}),
    )
    .await
    .unwrap();
    let tracks: Value =
        serde_json::from_slice(&to_bytes(tracks.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(tracks.as_array().unwrap().len(), 1);
    assert_eq!(tracks[0]["album_id"], album_id);
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
async fn youtube_proxy_reports_provider_status() {
    let (base, _mock, upstream) = fixture().await;
    let (_dir, s, u) = app(None).await;
    s.streams.insert("audio:abcdefghijk".into(), json!({"video_id":"abcdefghijk","title":"Song","artist":"Artist","upstream_url":format!("{base}/rejected")})).await;
    let error = media::serve(
        &s,
        &u,
        "music/audio/abcdefghijk",
        &HashMap::new(),
        &HeaderMap::new(),
        Method::GET,
    )
    .await
    .unwrap_err();
    assert_eq!(error.0, StatusCode::BAD_GATEWAY);
    assert!(error.1.contains("429"));
    upstream.abort();
}
#[tokio::test]
async fn youtube_proxy_follows_cdn_redirects_with_seeking_and_extractor_headers() {
    let (base, _mock, upstream) = fixture().await;
    let (_dir, s, u) = app(None).await;
    // First redirect crosses to another origin, as YouTube CDN redirects can.
    let destination = base.clone();
    let redirector = Router::new().route(
        "/{method}",
        get(move |Path(method): Path<String>| {
            let destination = destination.clone();
            async move {
                (
                    StatusCode::FOUND,
                    [("location", format!("{destination}/redirect/{method}"))],
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let redirect_base = format!("http://{}", listener.local_addr().unwrap());
    let redirect_task =
        tokio::spawn(async move { axum::serve(listener, redirector).await.unwrap() });
    for kind in ["audio", "video"] {
        for method in [Method::GET, Method::HEAD] {
            s.streams.insert(format!("{kind}:abcdefghijk"), json!({
                "video_id":"abcdefghijk", "title":"Song", "artist":"Artist",
                "upstream_url":format!("{redirect_base}/{method}"),
                "upstream_headers":{"User-Agent":"Extractor fixture", "Referer":"https://www.youtube.com/"}
            })).await;
            let mut headers = HeaderMap::new();
            headers.insert("range", "bytes=2-5".parse().unwrap());
            let response = media::serve(
                &s,
                &u,
                &format!("music/{kind}/abcdefghijk"),
                &HashMap::new(),
                &headers,
                method.clone(),
            )
            .await
            .unwrap();
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(response.headers()["content-range"], "bytes 2-5/10");
            assert_eq!(response.headers()["content-type"], "audio/flac");
            let body = to_bytes(response.into_body(), 100).await.unwrap();
            assert_eq!(
                body.as_ref(),
                if method == Method::HEAD {
                    &b""[..]
                } else {
                    &b"2345"[..]
                }
            );
        }
    }
    // Jellyfin and other requests still enforce the separate no-redirect policy.
    assert_eq!(
        s.http
            .get(format!("{base}/redirect/GET"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FOUND
    );
    redirect_task.abort();
    upstream.abort();
}
#[tokio::test]
async fn youtube_proxy_bounds_redirect_loops_without_exposing_signed_urls() {
    let (base, _mock, upstream) = fixture().await;
    let (_dir, s, u) = app(None).await;
    s.streams
        .insert(
            "audio:abcdefghijk".into(),
            json!({
                "video_id":"abcdefghijk", "title":"Song", "artist":"Artist",
                "upstream_url":format!("{base}/redirect-loop?signature=private")
            }),
        )
        .await;
    let error = tokio::time::timeout(
        Duration::from_secs(3),
        media::serve(
            &s,
            &u,
            "music/audio/abcdefghijk",
            &HashMap::new(),
            &HeaderMap::new(),
            Method::GET,
        ),
    )
    .await
    .expect("redirect loop must terminate")
    .unwrap_err();
    assert_eq!(error.0, StatusCode::BAD_GATEWAY);
    assert_eq!(error.1, "Media provider request failed");
    upstream.abort();
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

#[test]
fn youtube_track_exposes_upload_metadata_without_private_stream_urls() {
    let track = media::track(&json!({
        "id":"abcdefghijk", "track":"Song", "title":"Full video title",
        "artist":"Singer", "uploader":"Uploader", "channel_id":"UCfixture",
        "url":"https://private.example/stream?token=secret"
    }))
    .unwrap();
    assert_eq!(track["source_title"], "Full video title");
    assert_eq!(track["uploader"], "Uploader");
    assert_eq!(track["channel_id"], "UCfixture");
    assert!(track.get("url").is_none());
}

#[tokio::test]
async fn library_initial_groups_count_names_and_lazy_pages_independently() {
    let (_dir, s, u) = app(None).await;
    for (index, artist, album) in [
        (1, "Alpha", "Zebra"),
        (2, "Alpha", "Zebra"),
        (3, "Another", "Apple"),
        (4, "alpha two", "Apricot"),
        (5, "2Pac", "2 Albums"),
        (6, "3 Doors Down", "3 Albums"),
        (7, "!Special", "!Album"),
        (8, "Édith", "Éclair"),
        (9, "Beta", "A %_ album"),
        (10, "  Spaced", "  Spaced album"),
    ] {
        db::exec(&s.db, "INSERT INTO library_tracks(user_id,item_id,title,artist,album,generation) VALUES(1,?,'Unrelated track title',?,?,'initials')",
            vec![json!(format!("initial-{index}")), json!(artist), json!(album)]).await.unwrap();
    }
    // A second user's entries must not change the counts or lazy pages.
    db::exec(
        &s.db,
        "INSERT INTO users(id,username,display_name,password_hash,household_id) VALUES(2,'other','Other','unused',1)",
        vec![],
    )
    .await
    .unwrap();
    db::exec(&s.db, "INSERT INTO library_tracks(user_id,item_id,title,artist,album,generation) VALUES(2,'private','Song','Another private artist','Another private album','initials')", vec![]).await.unwrap();
    async fn query(s: &Shared, u: &Value, section: &str, params: &[(&str, &str)]) -> Value {
        let params = params
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let response = library::handle(
            s,
            u,
            &format!("library/{section}"),
            &params,
            &Method::GET,
            json!({}),
        )
        .await
        .unwrap();
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
    }
    for (section, expected_a, expected_total) in [("artists", 3, 9), ("albums", 3, 9)] {
        let index = query(&s, &u, section, &[("group_by", "initial")]).await;
        assert_eq!(index["grouping"], "initial");
        let counts = index["groups"].as_array().unwrap();
        let count = |letter: &str| {
            counts.iter().find(|g| g["initial"] == letter).unwrap()["count"]
                .as_i64()
                .unwrap()
        };
        assert_eq!(count("A"), expected_a);
        assert_eq!(count("#"), 2);
        assert_eq!(count("2"), 1);
        assert_eq!(count("3"), 1);
        assert_eq!(
            counts
                .iter()
                .map(|g| g["count"].as_i64().unwrap())
                .sum::<i64>(),
            expected_total
        );
        assert!(counts.iter().all(|g| g.get("thumbnail_url").is_none()));
        let first = query(&s, &u, section, &[("initial", "a"), ("limit", "2")]).await;
        let next = query(
            &s,
            &u,
            section,
            &[("initial", "A"), ("limit", "2"), ("offset", "2")],
        )
        .await;
        assert_eq!(first.as_array().unwrap().len(), 2);
        assert_eq!(next.as_array().unwrap().len(), 1);
        assert_ne!(first[0]["id"], next[0]["id"]);
        assert_ne!(first[1]["id"], next[0]["id"]);
        let special = query(&s, &u, section, &[("initial", "#")]).await;
        assert_eq!(special.as_array().unwrap().len(), 2);
        let spaced = query(&s, &u, section, &[("initial", "S")]).await;
        assert_eq!(spaced.as_array().unwrap().len(), 1);
        let absent = query(&s, &u, section, &[("initial", "Q")]).await;
        assert!(absent.as_array().unwrap().is_empty());
    }
    let albums = query(&s, &u, "albums", &[("initial", "A")]).await;
    assert_eq!(albums[0]["title"], "A %_ album");
    assert_eq!(albums[1]["title"], "Apple");
    assert_eq!(albums[2]["title"], "Apricot");
    // Album grouping uses its title, even when its artist starts with a different letter.
    let zebra = query(&s, &u, "albums", &[("initial", "Z")]).await;
    assert_eq!(zebra[0]["title"], "Zebra");
    assert_eq!(zebra[0]["track_count"], 2);
    let filtered = query(&s, &u, "albums", &[("group_by", "initial"), ("q", "%_")]).await;
    assert_eq!(filtered["groups"], json!([{"initial":"A","count":1}]));
    let artist_filter = query(
        &s,
        &u,
        "albums",
        &[("group_by", "initial"), ("artist", "Alpha")],
    )
    .await;
    assert_eq!(artist_filter["groups"], json!([{"initial":"Z","count":1}]));
    let invalid = HashMap::from([("initial".into(), "AB".into())]);
    let error = library::handle(&s, &u, "library/artists", &invalid, &Method::GET, json!({}))
        .await
        .unwrap_err();
    assert_eq!(error.0, StatusCode::BAD_REQUEST);
}
