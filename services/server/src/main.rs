use tuneflow_server::{App, Config, router};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tuneflow_server=info,tower_http=info".into()),
        )
        .init();
    let data_dir = std::env::var("TUNEFLOW_DATA_DIR")
        .unwrap_or_else(|_| "data".into())
        .into();
    let secret = std::env::var("JWT_SECRET").unwrap_or_default();
    anyhow::ensure!(
        secret.len() >= 32 && !secret.starts_with("change-me"),
        "Set JWT_SECRET to a private value of at least 32 bytes"
    );
    let jellyfin_url = std::env::var("JELLYFIN_URL").ok().filter(|v| !v.is_empty());
    let jellyfin_allowed_urls = std::env::var("JELLYFIN_ALLOWED_URLS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .collect();
    let app = App::open(Config {
        data_dir,
        jwt_secret: secret,
        youtube_bin: std::env::var("YTDLP_BIN").unwrap_or_else(|_| "yt-dlp".into()),
        jellyfin_url,
        jellyfin_allowed_urls,
    })
    .await?;
    tuneflow_server::extras::maintenance(app.clone());
    let bind = std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8000".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(address=%bind,"Rust server listening");
    axum::serve(listener, router(app))
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("install SIGTERM handler");
                tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
            }
            #[cfg(not(unix))]
            {
                tokio::signal::ctrl_c().await.ok();
            }
        })
        .await?;
    Ok(())
}
