use crate::error::{ApiError, Result};
use serde_json::{Map, Value, json};
use sqlx::{
    Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef,
    query::Query,
    sqlite::{SqliteArguments, SqliteRow},
};

fn query(sql: &str, args: Vec<Value>) -> Query<'_, Sqlite, SqliteArguments<'_>> {
    let mut q = sqlx::query(sql);
    for a in args {
        q = match a {
            Value::Null => q.bind(None::<String>),
            Value::Bool(v) => q.bind(v),
            Value::Number(n) => {
                if let Some(v) = n.as_i64() {
                    q.bind(v)
                } else {
                    q.bind(n.as_f64().unwrap_or(0.0))
                }
            }
            Value::String(v) => q.bind(v),
            v => q.bind(v.to_string()),
        };
    }
    q
}
pub async fn all(db: &SqlitePool, sql: &str, args: Vec<Value>) -> Result<Vec<Value>> {
    Ok(query(sql, args)
        .fetch_all(db)
        .await?
        .iter()
        .map(value)
        .collect())
}
pub async fn one(db: &SqlitePool, sql: &str, args: Vec<Value>) -> Result<Value> {
    all(db, sql, args)
        .await?
        .into_iter()
        .next()
        .ok_or_else(ApiError::missing)
}
pub async fn optional(db: &SqlitePool, sql: &str, args: Vec<Value>) -> Result<Option<Value>> {
    Ok(all(db, sql, args).await?.into_iter().next())
}
pub async fn exec(db: &SqlitePool, sql: &str, args: Vec<Value>) -> Result<i64> {
    Ok(query(sql, args).execute(db).await?.last_insert_rowid())
}
pub fn value(row: &SqliteRow) -> Value {
    let mut m = Map::new();
    for col in row.columns() {
        let name = col.name();
        let raw = row.try_get_raw(name).ok();
        let kind = raw.as_ref().map(|v| v.type_info());
        let mut v = match kind.as_ref().map(|v| v.name()).unwrap_or("NULL") {
            "INTEGER" | "BOOLEAN" => row
                .try_get::<Option<i64>, _>(name)
                .ok()
                .flatten()
                .map_or(Value::Null, |v| json!(v)),
            "REAL" => row
                .try_get::<Option<f64>, _>(name)
                .ok()
                .flatten()
                .map_or(Value::Null, |v| json!(v)),
            _ => row
                .try_get::<Option<String>, _>(name)
                .ok()
                .flatten()
                .map_or(Value::Null, Value::String),
        };
        if matches!(
            name,
            "is_root_admin"
                | "is_active"
                | "is_system"
                | "is_global"
                | "is_public"
                | "block_explicit"
                | "search_enabled"
                | "search_advanced_hidden"
                | "search_locked"
                | "search_force_clean"
                | "cache_enabled"
                | "has_video"
                | "scrobbling_enabled"
                | "is_default"
                | "explicit"
        ) && !v.is_null()
        {
            v = json!(v.as_i64().unwrap_or(0) != 0);
        }
        if matches!(
            name,
            "permissions" | "blocked_keywords" | "blocked_video_ids" | "bands"
        ) && let Some(s) = v.as_str()
        {
            v = serde_json::from_str(s).unwrap_or(json!([]));
        }
        m.insert(name.into(), v);
    }
    Value::Object(m)
}
pub async fn init(db: &SqlitePool) -> Result<()> {
    sqlx::raw_sql(include_str!("../schema.sql"))
        .execute(db)
        .await?;
    let columns = all(db, "PRAGMA table_info(library_tracks)", vec![]).await?;
    for (name, definition) in [
        ("album_artist", "TEXT"),
        ("disc_number", "INTEGER"),
        ("track_number", "INTEGER"),
    ] {
        if !columns.iter().any(|column| text(column, "name") == name) {
            sqlx::query(&format!(
                "ALTER TABLE library_tracks ADD COLUMN {name} {definition}"
            ))
            .execute(db)
            .await?;
        }
    }
    // Keep artist and album paging fast after album_artist was added to older databases.
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_library_browse_artist ON library_tracks(user_id,COALESCE(NULLIF(album_artist,''),NULLIF(artist,''),'Unknown artist'),album COLLATE NOCASE,disc_number,track_number)")
        .execute(db)
        .await?;
    exec(db,"INSERT OR IGNORE INTO households (id,name,slug,is_system,search_defaults_json) VALUES (1,'System','system',1,'{}')",vec![]).await?;
    let system = one(
        db,
        "SELECT id FROM households WHERE is_system=1 LIMIT 1",
        vec![],
    )
    .await?["id"]
        .clone();
    for (slug, name, permissions) in [
        (
            "parent",
            "Parent",
            json!([
                "manage_household_members",
                "manage_parental_controls",
                "set_parent_pin"
            ]),
        ),
        ("adult", "Adult", json!([])),
        ("child", "Child", json!(["subject_to_parental_controls"])),
        (
            "household_admin",
            "Household Administrator",
            json!([
                "manage_household_members",
                "manage_parental_controls",
                "manage_role_profiles",
                "set_parent_pin"
            ]),
        ),
    ] {
        exec(db,"INSERT INTO role_profiles(name,slug,owner_household_id,is_global,is_public,permissions) SELECT ?,?,?,1,1,? WHERE NOT EXISTS(SELECT 1 FROM role_profiles WHERE slug=? AND is_global=1)",vec![json!(name),json!(slug),system.clone(),permissions,json!(slug)]).await?;
    }
    exec(db,"INSERT OR IGNORE INTO system_settings(id,cache_enabled,cache_refresh_days,cache_cleanup_interval_hours,catalog_cache_retention_days,playlist_retention_days) VALUES(1,1,180,24,7,90)",vec![]).await?;
    Ok(())
}
pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn id(v: &Value) -> i64 {
    v["id"].as_i64().unwrap_or(0)
}
pub fn required(v: &Value, key: &str, max: usize) -> Result<String> {
    let s = text(v, key).trim();
    if s.is_empty() || s.len() > max {
        Err(ApiError::bad(format!("{key} must contain 1–{max} bytes")))
    } else {
        Ok(s.to_owned())
    }
}

/// SQLAlchemy applied many defaults in Python, rather than in SQLite. Rebuild only
/// tables that need SQL defaults so new Rust inserts work with existing databases.
/// Preserve all rows/IDs and retain a complete pre-migration SQLite backup.
pub async fn migrate_defaults(db: &SqlitePool, data_dir: &std::path::Path) -> Result<()> {
    use sqlx::Acquire;
    let mut plans = Vec::new();
    for statement in include_str!("../schema.sql").split(';') {
        let Some(at) = statement.find("CREATE TABLE IF NOT EXISTS ") else {
            continue;
        };
        let ddl = &statement[at..];
        let name = ddl
            .trim_start_matches("CREATE TABLE IF NOT EXISTS ")
            .split_whitespace()
            .next()
            .unwrap();
        if matches!(name, "jellyfin_connections" | "library_tracks") {
            continue;
        }
        let existing = all(db, &format!("PRAGMA table_info({name})"), vec![]).await?;
        if existing.is_empty() {
            continue;
        }
        let expected = ddl
            .lines()
            .skip(1)
            .filter_map(|line| {
                let line = line.trim();
                let column = line.split_whitespace().next()?;
                if column == ")" || column.starts_with("UNIQUE") {
                    None
                } else {
                    Some((column.to_string(), line.contains(" DEFAULT ")))
                }
            })
            .collect::<Vec<_>>();
        if existing
            .iter()
            .any(|r| !expected.iter().any(|(n, _)| r["name"] == n.as_str()))
        {
            return Err(ApiError::bad(format!(
                "Table {name} has unknown columns; refusing an unsafe migration"
            )));
        }
        let needs = expected.iter().any(|(n, default)| {
            existing
                .iter()
                .find(|r| r["name"] == n.as_str())
                .is_none_or(|r| *default && r["dflt_value"].is_null())
        });
        if needs {
            plans.push((
                name.to_string(),
                ddl.to_string(),
                existing
                    .iter()
                    .filter_map(|v| v["name"].as_str())
                    .collect::<Vec<_>>()
                    .join(","),
            ));
        }
    }
    if plans.is_empty() {
        return Ok(());
    }
    let backup = data_dir.join(format!(
        "tuneflow-before-rust-{}.db",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%f")
    ));
    sqlx::query("VACUUM INTO ?")
        .bind(backup.to_string_lossy().as_ref())
        .execute(db)
        .await?;
    let mut conn = db.acquire().await?;
    sqlx::query("PRAGMA foreign_keys=OFF")
        .execute(&mut *conn)
        .await?;
    sqlx::query("PRAGMA legacy_alter_table=ON")
        .execute(&mut *conn)
        .await?;
    let result: Result<()> = async {
        let mut tx = conn.begin().await?;
        for (name, ddl, columns) in plans {
            let temporary = format!("_tuneflow_new_{name}");
            let ddl = ddl.replacen(
                &format!("CREATE TABLE IF NOT EXISTS {name}"),
                &format!("CREATE TABLE {temporary}"),
                1,
            );
            sqlx::query(&ddl).execute(&mut *tx).await?;
            sqlx::query(&format!(
                "INSERT INTO {temporary}({columns}) SELECT {columns} FROM {name}"
            ))
            .execute(&mut *tx)
            .await?;
            sqlx::query(&format!("DROP TABLE {name}"))
                .execute(&mut *tx)
                .await?;
            sqlx::query(&format!("ALTER TABLE {temporary} RENAME TO {name}"))
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    .await;
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&mut *conn)
        .await?;
    sqlx::query("PRAGMA legacy_alter_table=OFF")
        .execute(&mut *conn)
        .await?;
    result?;
    sqlx::raw_sql(include_str!("../schema.sql"))
        .execute(db)
        .await?;
    if !all(db, "PRAGMA foreign_key_check", vec![])
        .await?
        .is_empty()
    {
        return Err(ApiError::bad(
            "Migration foreign-key validation failed; pre-migration backup was retained",
        ));
    }
    tracing::info!(backup=%backup.display(),"SQLite defaults migrated; original database backed up");
    Ok(())
}
