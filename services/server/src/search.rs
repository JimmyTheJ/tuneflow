use crate::{
    Params, Shared,
    db::{self, text},
    defaults,
    error::{ApiError, Result},
};
use serde_json::{Value, json};

pub async fn options(s: &Shared, u: &Value, q: &Params, child: Option<&Value>) -> Result<Value> {
    let mut out = defaults();
    if let Some(h) = db::optional(
        &s.db,
        "SELECT search_defaults_json FROM households WHERE id=?",
        vec![u["household_id"].clone()],
    )
    .await?
        && let Ok(Value::Object(saved)) =
            serde_json::from_str::<Value>(text(&h, "search_defaults_json"))
    {
        for (k, v) in saved {
            if out.get(&k).is_some() {
                out[k] = v;
            }
        }
    }
    let locked = child.is_some_and(|c| c["search_locked"] == true);
    if !locked {
        for (key, field) in [
            ("limit", "results_per_page"),
            ("max_per_song", "max_per_song"),
        ] {
            if let Some(raw) = q.get(key) {
                let n = raw
                    .parse::<i64>()
                    .map_err(|_| ApiError::bad("Invalid search limit"))?;
                if !(0..=50).contains(&n) || (key == "limit" && n == 0) {
                    return Err(ApiError::bad(
                        "Search limits must be 1–50; max_per_song=0 means unlimited",
                    ));
                }
                out[field] = if key == "max_per_song" && n == 0 {
                    Value::Null
                } else {
                    json!(n)
                };
            }
        }
        for key in ["hide_covers", "hide_loops"] {
            if let Some(v) = q.get(key) {
                out[key] = match v.as_str() {
                    "true" => json!(true),
                    "false" => json!(false),
                    _ => return Err(ApiError::bad("Invalid search filter")),
                };
            }
        }
        if let Some(v) = q.get("version_preference") {
            if !["auto", "studio", "live", "any"].contains(&v.as_str()) {
                return Err(ApiError::bad("Unknown recording preference"));
            }
            out["version_preference"] = json!(v);
        }
    }
    if let Some(c) = child {
        if let Some(ceiling) = c["search_max_versions_ceiling"].as_i64() {
            out["max_per_song"] = json!(
                out["max_per_song"]
                    .as_i64()
                    .unwrap_or(ceiling)
                    .min(ceiling)
                    .max(1)
            );
        }
        if c["search_force_clean"] == true {
            out["hide_covers"] = json!(true);
            out["hide_loops"] = json!(true);
            out["version_preference"] = json!("studio");
        }
    }
    Ok(out)
}
fn words(v: &str) -> Vec<String> {
    v.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .collect()
}
pub fn rank(mut results: Vec<Value>, query: &str, options: &Value) -> Vec<Value> {
    let query_words = words(query);
    results.retain(|r| {
        let w = words(text(r, "source_title"));
        let title = words(text(r, "title"));
        !(options["hide_covers"] == true
            && w.iter()
                .chain(title.iter())
                .any(|w| matches!(w.as_str(), "cover" | "karaoke" | "tribute")))
            && !(options["hide_loops"] == true
                && w.iter()
                    .chain(title.iter())
                    .any(|w| matches!(w.as_str(), "loop" | "hours" | "compilation" | "megamix")))
    });
    results.sort_by_cached_key(|r| {
        let artist = text(r, "artist").to_lowercase();
        let title = text(r, "title").to_lowercase();
        let source = text(r, "source_title").to_lowercase();
        let combined = format!("{artist} {title} {source}");
        let live =
            source.contains("(live") || source.contains("live at") || source.contains("live from");
        let mut score = query_words
            .iter()
            .filter(|word| combined.contains(word.as_str()))
            .count() as i64
            * 5;
        if artist.ends_with("- topic") {
            score += 8;
        }
        if source.contains("official audio") {
            score += 6;
        } else if source.contains("official") {
            score += 3;
        }
        if live && options["version_preference"] == "studio" {
            score -= 10;
        }
        if live && options["version_preference"] == "live" {
            score += 10;
        }
        if source.contains("cover") || source.contains("karaoke") {
            score -= 8;
        }
        if r["duration_sec"].as_i64().is_some_and(|d| d > 1200) {
            score -= 6;
        }
        std::cmp::Reverse(score)
    });
    results
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranks_official_recordings_and_honors_filters() {
        let results = vec![
            json!({"video_id":"a","title":"Song cover","source_title":"Artist Song cover","artist":"Someone"}),
            json!({"video_id":"b","title":"Song","source_title":"Artist Song Official Audio","artist":"Artist - Topic"}),
        ];
        let mut o = defaults();
        o["hide_covers"] = json!(true);
        let result = rank(results, "Artist Song", &o);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["video_id"], "b");
    }
}
