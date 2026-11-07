pub mod auth;
pub mod catalog;
pub mod db;
pub mod error;
pub mod extras;
pub mod jellyfin;
pub mod library;
pub mod management;
pub mod media;
pub mod search;

use crate::error::{ApiError, Result};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

#[derive(Clone)]
pub struct Config {
    pub data_dir: PathBuf,
    pub jwt_secret: String,
    pub youtube_bin: String,
    pub jellyfin_url: Option<String>,
    pub jellyfin_allowed_urls: Vec<String>,
}
#[derive(Default)]
pub struct Metrics {
    pub requests: AtomicU64,
    pub failures: AtomicU64,
    pub resolve_ms: AtomicU64,
    pub resolves: AtomicU64,
}
pub struct App {
    pub db: SqlitePool,
    pub http: reqwest::Client,
    pub youtube_http: reqwest::Client,
    pub config: Config,
    pub failures: moka::future::Cache<String, ApiError>,
    pub streams: moka::future::Cache<String, Value>,
    pub searches: moka::future::Cache<String, Value>,
    pub extractor_slots: Arc<Semaphore>,
    pub sync_slots: Arc<Semaphore>,
    pub catalog_gate: Mutex<Instant>,
    pub limits: Mutex<HashMap<String, (Instant, u32)>>,
    pub metrics: Metrics,
}
pub type Shared = Arc<App>;
pub type Params = HashMap<String, String>;
impl App {
    pub async fn open(config: Config) -> anyhow::Result<Shared> {
        tokio::fs::create_dir_all(&config.data_dir).await?;
        let opts = SqliteConnectOptions::new()
            .filename(config.data_dir.join("tuneflow.db"))
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(10));
        let db = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(opts)
            .await?;
        let indexed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='library_fts')",
        )
        .fetch_one(&db)
        .await?;
        sqlx::raw_sql(include_str!("../schema.sql"))
            .execute(&db)
            .await?;
        if !indexed {
            sqlx::query("INSERT INTO library_fts(library_fts) VALUES('rebuild')")
                .execute(&db)
                .await?;
        }
        db::migrate_defaults(&db, &config.data_dir)
            .await
            .map_err(|e| anyhow::anyhow!("{}", e.1))?;
        db::init(&db)
            .await
            .map_err(|e| anyhow::anyhow!("{}", e.1))?;
        Ok(Arc::new(Self {
            db,
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .read_timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("Tuneflow/0.4.0")
                .build()?,
            // YouTube CDNs redirect media between hosts. Keep this separate from
            // the client used for Jellyfin's explicitly authorized server URLs.
            youtube_http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .read_timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::limited(5))
                // Retain yt-dlp's Referer rather than replacing it with a signed CDN URL.
                .referer(false)
                .user_agent("Tuneflow/0.4.0")
                .build()?,
            config,
            failures: moka::future::Cache::builder()
                .max_capacity(256)
                .time_to_live(Duration::from_secs(10))
                .build(),
            streams: moka::future::Cache::builder()
                .max_capacity(512)
                .time_to_live(Duration::from_secs(180))
                .build(),
            searches: moka::future::Cache::builder()
                .max_capacity(256)
                .time_to_live(Duration::from_secs(120))
                .build(),
            extractor_slots: Arc::new(Semaphore::new(3)),
            sync_slots: Arc::new(Semaphore::new(1)),
            catalog_gate: Mutex::new(Instant::now() - Duration::from_secs(1)),
            limits: Mutex::new(HashMap::new()),
            metrics: Metrics::default(),
        }))
    }
}
pub fn router(app: Shared) -> Router {
    let mut router = Router::new().route("/health",get(||async{Json(json!({"status":"ok","service":"tuneflow-api","version":"0.4.0","implementation":"rust"}))})).route("/api/{*path}",get(endpoint).post(endpoint).put(endpoint).patch(endpoint).delete(endpoint).head(endpoint)).layer(DefaultBodyLimit::max(1024*1024));
    if let Ok(origins) = std::env::var("CORS_ORIGINS") {
        let allowed = origins
            .split(',')
            .filter(|s| !s.trim().is_empty() && s.trim() != "*")
            .filter_map(|s| s.trim().parse().ok())
            .collect::<Vec<axum::http::HeaderValue>>();
        if !allowed.is_empty() {
            router = router.layer(
                CorsLayer::new()
                    .allow_origin(allowed)
                    .allow_methods(Any)
                    .allow_headers(Any),
            );
        }
    }
    router
        .layer(TraceLayer::new_for_http().make_span_with(
            |request: &axum::http::Request<axum::body::Body>| {
                tracing::info_span!("request", method = %request.method(), path = %request.uri().path())
            },
        ))
        .with_state(app)
}
async fn endpoint(
    State(s): State<Shared>,
    Path(path): Path<String>,
    Query(q): Query<Params>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let started = Instant::now();
    s.metrics.requests.fetch_add(1, Ordering::Relaxed);
    let result = dispatch(s.clone(), &path, q, method, headers, body).await;
    let response = match result {
        Ok(r) => r,
        Err(e) => {
            s.metrics.failures.fetch_add(1, Ordering::Relaxed);
            e.into_response()
        }
    };
    tracing::info!(path=%path,status=response.status().as_u16(),elapsed_ms=started.elapsed().as_millis(),"request completed");
    response
}
async fn dispatch(
    s: Shared,
    path: &str,
    q: Params,
    method: Method,
    h: HeaderMap,
    body: Bytes,
) -> Result<Response> {
    let b: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).map_err(|_| ApiError::bad("Invalid JSON body"))?
    };
    if path == "auth/setup-status" {
        return Ok(Json(json!({"needs_setup":db::one(&s.db,"SELECT count(*) AS n FROM users",vec![]).await?["n"]==0})).into_response());
    }
    if path == "auth/setup" && method == Method::POST {
        return auth::setup(&s, b, &h).await;
    }
    if path == "auth/login" && method == Method::POST {
        return auth::login(&s, b, &h).await;
    }
    if let Some(slug) = path.strip_prefix("households/public/")
        && method == Method::GET
    {
        return Ok(Json(
            db::one(
                &s.db,
                "SELECT slug,name FROM households WHERE slug=?",
                vec![json!(slug)],
            )
            .await?,
        )
        .into_response());
    }
    let user = auth::authenticate(&s, &h, &q, path).await?;
    if path.starts_with("music/audio/")
        || path.starts_with("music/video/")
        || path.starts_with("library/images/")
    {
        return media::serve(&s, &user, path, &q, &h, method).await;
    }
    if path.starts_with("music/") || path.starts_with("library/") || path.starts_with("jellyfin") {
        return library::handle(&s, &user, path, &q, &method, b).await;
    }
    let value = if path.starts_with("auth/") {
        auth::handle(&s, &user, path, &method, b, &h).await?
    } else if path.starts_with("playlists")
        || path.starts_with("likes")
        || path.starts_with("history")
    {
        management::personal(&s, &user, path, &q, &method, b).await?
    } else if path.starts_with("users")
        || path.starts_with("households")
        || path.starts_with("role-profiles")
        || path.starts_with("parental")
    {
        management::household(&s, &user, path, &q, &method, b).await?
    } else {
        extras::handle(&s, &user, path, &q, &method, b).await?
    };
    if value.is_null() {
        Ok(StatusCode::NO_CONTENT.into_response())
    } else {
        Ok(Json(value).into_response())
    }
}
pub fn number(q: &Params, key: &str, default: i64, min: i64, max: i64) -> i64 {
    q.get(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
        .clamp(min, max)
}
pub fn defaults() -> Value {
    json!({"max_per_song":3,"hide_covers":false,"hide_loops":false,"results_per_page":20,"version_preference":"auto","play_on_select":"all_results"})
}
