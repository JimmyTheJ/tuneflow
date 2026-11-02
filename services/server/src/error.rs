use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug, Clone)]
pub struct ApiError(pub StatusCode, pub String);
pub type Result<T> = std::result::Result<T, ApiError>;
impl ApiError {
    pub fn bad(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self(StatusCode::FORBIDDEN, message.into())
    }
    pub fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "Not found".into())
    }
    pub fn upstream(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_GATEWAY, message.into())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"detail":self.1}))).into_response()
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        if let sqlx::Error::Database(ref d) = e
            && d.is_unique_violation()
        {
            return Self(StatusCode::CONFLICT, "This record already exists".into());
        }
        tracing::error!(error=%e,"database operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database operation failed".into(),
        )
    }
}
impl From<reqwest::Error> for ApiError {
    fn from(e: reqwest::Error) -> Self {
        // Do not expose upstream URLs: Jellyfin and yt-dlp URLs can contain credentials.
        tracing::warn!(timeout=e.is_timeout(),status=?e.status(),"upstream request failed");
        Self::upstream(if e.is_timeout() {
            "Media provider timed out"
        } else {
            "Media provider request failed"
        })
    }
}
impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        tracing::error!(error=%e,"file operation failed");
        Self::upstream("Media file operation failed")
    }
}
