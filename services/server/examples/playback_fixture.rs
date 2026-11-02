//! Local, synthetic audio fixture for native-device tests. Never uses a real library.
use axum::{
    Json, Router,
    body::Body,
    extract::Path,
    http::Request,
    response::IntoResponse,
    routing::{get, post},
};
use serde_json::json;
use tuneflow_server::{App, Config, auth, db, jellyfin};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dir = std::env::temp_dir().join("tuneflow-playback-fixture");
    tokio::fs::create_dir_all(&dir).await?;
    let wav = dir.join("tone.wav");
    let samples = 8000_u32 * 45;
    let bytes = samples * 2;
    let mut audio = Vec::new();
    audio.extend_from_slice(b"RIFF");
    audio.extend_from_slice(&(36 + bytes).to_le_bytes());
    audio.extend_from_slice(b"WAVEfmt ");
    audio.extend_from_slice(&16_u32.to_le_bytes());
    audio.extend_from_slice(&1_u16.to_le_bytes());
    audio.extend_from_slice(&1_u16.to_le_bytes());
    audio.extend_from_slice(&8000_u32.to_le_bytes());
    audio.extend_from_slice(&16000_u32.to_le_bytes());
    audio.extend_from_slice(&2_u16.to_le_bytes());
    audio.extend_from_slice(&16_u16.to_le_bytes());
    audio.extend_from_slice(b"data");
    audio.extend_from_slice(&bytes.to_le_bytes());
    for i in 0..samples {
        let sample = ((i as f64 * 440. * std::f64::consts::TAU / 8000.).sin() * 1000.) as i16;
        audio.extend_from_slice(&sample.to_le_bytes());
    }
    tokio::fs::write(&wav, audio).await?;
    let file = wav.clone();
    let upstream=Router::new().route("/Users/AuthenticateByName",post(||async{Json(json!({"AccessToken":"fixture-only","User":{"Id":"cccccccccccccccccccccccccccccccc","Name":"Fixture"}}))}))
 .route("/Items",get(||async{Json(json!({"TotalRecordCount":2,"Items":[{"Id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Name":"Fixture One","Artists":["Tuneflow tests"],"Album":"Native playback tests","AlbumId":"dddddddddddddddddddddddddddddddd","Container":"wav","RunTimeTicks":450000000,"Type":"Audio"},{"Id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Name":"Fixture Two","Artists":["Tuneflow tests"],"Album":"Native playback tests","AlbumId":"dddddddddddddddddddddddddddddddd","Container":"wav","RunTimeTicks":450000000,"Type":"Audio"}]}))}))
 .route("/Users/{uid}/Items/{id}",get(||async{Json(json!({"Type":"Audio"}))}))
 .route("/Audio/{id}/stream",get(move|Path(_):Path<String>,request:Request<Body>|{let file=file.clone();async move{tower_http::services::ServeFile::new(file).try_call(request).await.unwrap().into_response()}}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let base = format!("http://{}", listener.local_addr()?);
    tokio::spawn(async move {
        axum::serve(listener, upstream).await.unwrap();
    });
    let s = App::open(Config {
        data_dir: dir,
        jwt_secret: "fixture-only-not-for-production-secret".into(),
        youtube_bin: "missing".into(),
        jellyfin_url: Some(base.clone()),
    })
    .await?;
    let hash = bcrypt::hash("fixture-password", 4)?;
    db::exec(&s.db,"INSERT INTO users(id,username,display_name,password_hash,household_id,is_root_admin,is_active) VALUES(1,'fixture','Fixture',?,1,1,1) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash",vec![json!(hash)]).await.map_err(|e|anyhow::anyhow!(e.1))?;
    let u = auth::user(&s, 1).await.map_err(|e| anyhow::anyhow!(e.1))?;
    jellyfin::link(
        &s,
        &u,
        &json!({"server_url":base,"username":"fixture","password":"unused"}),
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.1))?;
    jellyfin::sync(&s, &u)
        .await
        .map_err(|e| anyhow::anyhow!(e.1))?;
    println!("Synthetic playback fixture listening on 127.0.0.1:18010");
    axum::serve(
        tokio::net::TcpListener::bind("127.0.0.1:18010").await?,
        tuneflow_server::router(s),
    )
    .await?;
    Ok(())
}
