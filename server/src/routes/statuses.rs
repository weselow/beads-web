//! Project status list: `GET /api/statuses?path=...`.
//!
//! bd knows seven built-in statuses and lets a project add its own through
//! `status.custom`. Each status belongs to one of four groups (categories):
//! `active`, `wip`, `done`, `frozen`.

use axum::{
    extract::{Extension, Query},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::beads::{self, DOLT_PATH_PREFIX};
use super::validate_path_security;
use crate::dolt::{self, DoltManager};

/// How long a project's status list is served from memory before bd is asked
/// again. A bd call in an embedded project takes one to two seconds.
pub const STATUS_CACHE_TTL: Duration = Duration::from_secs(180);

/// One status of a project, as the API returns it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StatusInfo {
    pub name: String,
    /// Always one of `active`, `wip`, `done`, `frozen`.
    pub category: &'static str,
    pub builtin: bool,
}

/// A status list plus where it came from.
#[derive(Debug, Clone)]
pub struct LoadedStatuses {
    pub statuses: Vec<StatusInfo>,
    pub source: &'static str,
}

/// bd's built-in statuses in the order bd 1.3.0 lists them, with their groups.
/// Served as they are when bd is too old for `bd statuses --json` or fails.
const BUILTIN_STATUSES: [(&str, &str); 7] = [
    ("open", "active"),
    ("in_progress", "wip"),
    ("blocked", "wip"),
    ("deferred", "frozen"),
    ("closed", "done"),
    ("pinned", "frozen"),
    ("hooked", "wip"),
];

/// Maps a group name from bd to one of the four the API promises.
///
/// An own status without a group (`unspecified`, empty) counts as `wip`: it
/// is usually a step between open and closed, such as a review, and
/// `bd ready` does not offer it, so it is not `active`.
fn normalize_category(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "active" => "active",
        "done" => "done",
        "frozen" => "frozen",
        _ => "wip",
    }
}

fn builtin_statuses() -> Vec<StatusInfo> {
    BUILTIN_STATUSES
        .iter()
        .map(|(name, category)| StatusInfo { name: name.to_string(), category, builtin: true })
        .collect()
}

/// Appends own statuses after the list, skipping names already in it.
fn append_custom(list: &mut Vec<StatusInfo>, custom: impl IntoIterator<Item = StatusInfo>) {
    for status in custom {
        if !list.iter().any(|s| s.name == status.name) {
            list.push(status);
        }
    }
}

#[derive(Deserialize)]
struct BdStatus {
    name: String,
    #[serde(default)]
    category: String,
}

#[derive(Deserialize)]
struct BdStatusesJson {
    built_in_statuses: Vec<BdStatus>,
    #[serde(default)]
    custom_statuses: Option<Vec<BdStatus>>,
}

fn from_bd(status: BdStatus, builtin: bool) -> StatusInfo {
    StatusInfo { name: status.name, category: normalize_category(&status.category), builtin }
}

/// Parses `bd statuses --json`. bd may print warnings before the JSON.
fn parse_bd_statuses(output: &str) -> Result<Vec<StatusInfo>, String> {
    let start = output
        .find('{')
        .ok_or_else(|| format!("no JSON in bd statuses output: {}", &output[..output.len().min(200)]))?;
    let parsed: BdStatusesJson = serde_json::from_str(&output[start..])
        .map_err(|e| format!("unexpected bd statuses JSON: {e}"))?;
    let mut list: Vec<StatusInfo> =
        parsed.built_in_statuses.into_iter().map(|s| from_bd(s, true)).collect();
    let custom = parsed.custom_statuses.unwrap_or_default();
    append_custom(&mut list, custom.into_iter().map(|s| from_bd(s, false)));
    Ok(list)
}

/// Parses the `status.custom` config value: `name` or `name:category`,
/// separated by commas.
fn parse_status_custom(value: &str) -> Vec<StatusInfo> {
    value
        .split(',')
        .filter_map(|part| {
            let (name, category) = part.split_once(':').unwrap_or((part, ""));
            let name = name.trim();
            (!name.is_empty()).then(|| StatusInfo {
                name: name.to_string(),
                category: normalize_category(category),
                builtin: false,
            })
        })
        .collect()
}

/// Built-in statuses followed by the project's own from `status.custom`.
fn statuses_with_custom(custom: Option<&str>) -> Vec<StatusInfo> {
    let mut list = builtin_statuses();
    append_custom(&mut list, parse_status_custom(custom.unwrap_or_default()));
    list
}

/// Status lists kept in memory, one per project path.
#[derive(Default)]
pub struct StatusCache {
    entries: std::sync::Mutex<HashMap<String, (Instant, LoadedStatuses)>>,
}

impl StatusCache {
    /// The project's list, if it was stored less than [`STATUS_CACHE_TTL`] ago.
    pub fn get(&self, key: &str) -> Option<LoadedStatuses> {
        self.get_at(key, Instant::now())
    }

    pub fn put(&self, key: &str, loaded: LoadedStatuses) {
        self.put_at(key, loaded, Instant::now());
    }

    fn get_at(&self, key: &str, now: Instant) -> Option<LoadedStatuses> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let (stored_at, loaded) = entries.get(key)?;
        if now.saturating_duration_since(*stored_at) < STATUS_CACHE_TTL {
            return Some(loaded.clone());
        }
        entries.remove(key);
        None
    }

    fn put_at(&self, key: &str, loaded: LoadedStatuses, at: Instant) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.insert(key.to_string(), (at, loaded));
    }
}

/// Source name of the built-in list served when bd and SQL both failed.
const SOURCE_FALLBACK: &str = "fallback";

/// Stores a list read from bd or SQL. A fallback list is not stored, so the
/// next request tries bd again instead of hiding the project's own statuses.
fn remember(cache: &StatusCache, key: &str, loaded: &LoadedStatuses) {
    if loaded.source != SOURCE_FALLBACK {
        cache.put(key, loaded.clone());
    }
}

fn fallback() -> LoadedStatuses {
    LoadedStatuses { statuses: builtin_statuses(), source: SOURCE_FALLBACK }
}

/// `dolt://` project on the central Dolt server: built-ins plus
/// `status.custom` read over SQL.
async fn load_from_central(dolt_manager: &DoltManager, db_name: &str) -> LoadedStatuses {
    if !dolt_manager.is_available() && !dolt_manager.check_server().await {
        tracing::warn!(db = %db_name, "Dolt server is not running, serving built-in statuses");
        return fallback();
    }
    match dolt_manager.read_status_custom(db_name).await {
        Ok(custom) => LoadedStatuses {
            statuses: statuses_with_custom(custom.as_deref()),
            source: "dolt-direct",
        },
        Err(e) => {
            tracing::warn!(db = %db_name, error = %e, "status.custom SQL read failed, serving built-in statuses");
            fallback()
        }
    }
}

/// Filesystem project: the project's own Dolt server over SQL when it is
/// running (tier 0), otherwise `bd statuses --json`, otherwise the built-ins.
async fn load_from_project(project_path: &Path) -> LoadedStatuses {
    if let Some((port, db_name)) = beads::live_project_dolt(project_path).await {
        match dolt::read_status_custom_on_port(port, &db_name).await {
            Ok(custom) => {
                return LoadedStatuses {
                    statuses: statuses_with_custom(custom.as_deref()),
                    source: "dolt-project",
                }
            }
            Err(e) => tracing::warn!(port, db = %db_name, error = %e, "status.custom SQL read failed, trying bd CLI"),
        }
    }
    let read = beads::run_bd(&["statuses", "--json"], project_path).await;
    match read.and_then(|output| parse_bd_statuses(&output)) {
        Ok(statuses) => LoadedStatuses { statuses, source: "cli" },
        Err(e) => {
            tracing::warn!(project = %project_path.display(), error = %e, "bd statuses failed, serving built-in statuses");
            fallback()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct StatusesParams {
    pub path: String,
}

type JsonResponse = (StatusCode, Json<serde_json::Value>);

fn error_response(code: StatusCode, message: &str) -> JsonResponse {
    (code, Json(serde_json::json!({ "error": message })))
}

/// Same checks as `/api/beads`: an allowed path with a `.beads` folder.
fn check_project_dir(project_path: &Path) -> Result<(), JsonResponse> {
    validate_path_security(project_path).map_err(|e| error_response(StatusCode::FORBIDDEN, &e))?;
    if !project_path.join(".beads").exists() {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "No .beads directory found at the specified path",
        ));
    }
    Ok(())
}

fn ok_response(loaded: &LoadedStatuses) -> JsonResponse {
    let body = serde_json::json!({ "statuses": loaded.statuses, "source": loaded.source });
    (StatusCode::OK, Json(body))
}

/// GET /api/statuses?path=/path/to/project
/// GET /api/statuses?path=dolt://beads_dbname
///
/// The project's statuses: bd's built-ins in bd's order, then the project's
/// own. Each has `name`, `category` (active|wip|done|frozen) and `builtin`.
/// Kept in memory per project for [`STATUS_CACHE_TTL`].
pub async fn read_statuses(
    Extension(dolt_manager): Extension<Arc<DoltManager>>,
    Extension(cache): Extension<Arc<StatusCache>>,
    Query(params): Query<StatusesParams>,
) -> JsonResponse {
    let path = params.path.replace('\\', "/");
    let dolt_db = path.strip_prefix(DOLT_PATH_PREFIX);
    if dolt_db.is_none() {
        if let Err(response) = check_project_dir(Path::new(&path)) {
            return response;
        }
    }
    if let Some(hit) = cache.get(&path) {
        tracing::debug!(project = %path, source = hit.source, "statuses served from memory");
        return ok_response(&hit);
    }
    let started = Instant::now();
    let loaded = match dolt_db {
        Some(db_name) => load_from_central(&dolt_manager, db_name).await,
        None => load_from_project(Path::new(&path)).await,
    };
    tracing::info!(
        project = %path,
        source = loaded.source,
        count = loaded.statuses.len(),
        duration_ms = started.elapsed().as_millis() as u64,
        "read project statuses"
    );
    remember(&cache, &path, &loaded);
    ok_response(&loaded)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `bd statuses --json` from bd 1.3.0 in a project without own statuses.
    const BD_BUILTIN_ONLY: &str = r#"{
  "built_in_statuses": [
    {"category": "active", "description": "Available to work (default)", "icon": "○", "name": "open"},
    {"category": "wip", "description": "Actively being worked on", "icon": "◐", "name": "in_progress"},
    {"category": "wip", "description": "Blocked by a dependency", "icon": "●", "name": "blocked"},
    {"category": "frozen", "description": "Deliberately put on ice for later", "icon": "❄", "name": "deferred"},
    {"category": "done", "description": "Completed", "icon": "✓", "name": "closed"},
    {"category": "frozen", "description": "Persistent, stays open indefinitely", "icon": "📌", "name": "pinned"},
    {"category": "wip", "description": "Attached to an agent's hook", "icon": "◇", "name": "hooked"}
  ],
  "schema_version": 1
}"#;

    fn status(name: &str, category: &'static str, builtin: bool) -> StatusInfo {
        StatusInfo { name: name.to_string(), category, builtin }
    }

    fn expected_builtins() -> Vec<StatusInfo> {
        vec![
            status("open", "active", true),
            status("in_progress", "wip", true),
            status("blocked", "wip", true),
            status("deferred", "frozen", true),
            status("closed", "done", true),
            status("pinned", "frozen", true),
            status("hooked", "wip", true),
        ]
    }

    fn with_custom_json(custom: &str) -> String {
        BD_BUILTIN_ONLY.replace(
            "\"schema_version\": 1",
            &format!("\"custom_statuses\": {custom},\n  \"schema_version\": 1"),
        )
    }

    // ── categories ───────────────────────────────────────────────────────

    #[test]
    fn known_categories_pass_through() {
        for c in ["active", "wip", "done", "frozen"] {
            assert_eq!(normalize_category(c), c);
        }
    }

    #[test]
    fn category_is_case_and_space_insensitive() {
        assert_eq!(normalize_category(" Done "), "done");
        assert_eq!(normalize_category("FROZEN"), "frozen");
    }

    #[test]
    fn unspecified_empty_or_unknown_category_is_wip() {
        assert_eq!(normalize_category("unspecified"), "wip");
        assert_eq!(normalize_category(""), "wip");
        assert_eq!(normalize_category("something-new"), "wip");
    }

    // ── built-in fallback list ───────────────────────────────────────────

    #[test]
    fn builtin_fallback_matches_bd_1_3_order_and_groups() {
        assert_eq!(builtin_statuses(), expected_builtins());
    }

    // ── bd statuses --json ───────────────────────────────────────────────

    #[test]
    fn bd_json_without_custom_key_gives_builtins_only() {
        assert_eq!(parse_bd_statuses(BD_BUILTIN_ONLY).unwrap(), expected_builtins());
    }

    #[test]
    fn bd_json_custom_statuses_follow_builtins() {
        let json = with_custom_json(
            r#"[{"category": "unspecified", "name": "inreview"}, {"category": "done", "name": "shipped"}]"#,
        );
        let mut expected = expected_builtins();
        expected.push(status("inreview", "wip", false));
        expected.push(status("shipped", "done", false));
        assert_eq!(parse_bd_statuses(&json).unwrap(), expected);
    }

    #[test]
    fn bd_json_custom_without_category_is_wip() {
        let json = with_custom_json(r#"[{"name": "qa"}]"#);
        let parsed = parse_bd_statuses(&json).unwrap();
        assert_eq!(parsed.last(), Some(&status("qa", "wip", false)));
    }

    #[test]
    fn bd_json_after_warning_lines_still_parses() {
        let output = format!("warning: something odd\nnote: migrated\n{BD_BUILTIN_ONLY}");
        assert_eq!(parse_bd_statuses(&output).unwrap(), expected_builtins());
    }

    #[test]
    fn bd_output_without_json_is_an_error() {
        assert!(parse_bd_statuses("Error: unknown command \"statuses\"").is_err());
    }

    #[test]
    fn bd_json_without_builtins_is_an_error() {
        assert!(parse_bd_statuses(r#"{"schema_version": 1}"#).is_err());
    }

    // ── status.custom ────────────────────────────────────────────────────

    #[test]
    fn status_custom_bare_name_is_wip() {
        assert_eq!(parse_status_custom("inreview"), vec![status("inreview", "wip", false)]);
    }

    #[test]
    fn status_custom_name_with_category() {
        assert_eq!(
            parse_status_custom("review:wip, qa:active ,shipped:done,ice:frozen"),
            vec![
                status("review", "wip", false),
                status("qa", "active", false),
                status("shipped", "done", false),
                status("ice", "frozen", false),
            ]
        );
    }

    #[test]
    fn status_custom_mixed_forms_and_unknown_category() {
        assert_eq!(
            parse_status_custom(" inreview , triage:unspecified,x:bogus"),
            vec![
                status("inreview", "wip", false),
                status("triage", "wip", false),
                status("x", "wip", false),
            ]
        );
    }

    #[test]
    fn status_custom_empty_parts_are_skipped() {
        assert!(parse_status_custom("").is_empty());
        assert!(parse_status_custom(" , ,").is_empty());
        assert!(parse_status_custom(":done").is_empty());
    }

    #[test]
    fn builtins_plus_custom_keeps_order_and_drops_duplicates() {
        let mut expected = expected_builtins();
        expected.push(status("inreview", "wip", false));
        assert_eq!(statuses_with_custom(Some("open:done,inreview,inreview:done")), expected);
    }

    #[test]
    fn builtins_plus_no_custom_is_builtins() {
        assert_eq!(statuses_with_custom(None), expected_builtins());
        assert_eq!(statuses_with_custom(Some("")), expected_builtins());
    }

    // ── memory ───────────────────────────────────────────────────────────

    fn loaded(source: &'static str) -> LoadedStatuses {
        LoadedStatuses { statuses: expected_builtins(), source }
    }

    #[test]
    fn cache_serves_a_fresh_entry() {
        let cache = StatusCache::default();
        let t0 = Instant::now();
        cache.put_at("M:/p", loaded("cli"), t0);
        let hit = cache.get_at("M:/p", t0 + STATUS_CACHE_TTL - Duration::from_secs(1)).unwrap();
        assert_eq!(hit.source, "cli");
        assert_eq!(hit.statuses, expected_builtins());
    }

    #[test]
    fn cache_drops_an_expired_entry() {
        let cache = StatusCache::default();
        let t0 = Instant::now();
        cache.put_at("M:/p", loaded("cli"), t0);
        assert!(cache.get_at("M:/p", t0 + STATUS_CACHE_TTL).is_none());
        // Gone for good, not only hidden.
        assert!(cache.get_at("M:/p", t0).is_none());
    }

    #[test]
    fn cache_keeps_projects_apart() {
        let cache = StatusCache::default();
        let t0 = Instant::now();
        cache.put_at("M:/a", loaded("cli"), t0);
        assert!(cache.get_at("M:/b", t0).is_none());
    }

    #[test]
    fn cache_put_replaces_the_entry() {
        let cache = StatusCache::default();
        let t0 = Instant::now();
        cache.put_at("M:/p", loaded("cli"), t0);
        cache.put_at("M:/p", loaded("dolt-project"), t0 + Duration::from_secs(5));
        assert_eq!(cache.get_at("M:/p", t0 + Duration::from_secs(6)).unwrap().source, "dolt-project");
    }

    #[test]
    fn a_fallback_list_is_not_remembered() {
        let cache = StatusCache::default();
        remember(&cache, "M:/p", &loaded(SOURCE_FALLBACK));
        assert!(cache.get("M:/p").is_none());
    }

    #[test]
    fn a_list_read_from_bd_is_remembered() {
        let cache = StatusCache::default();
        remember(&cache, "M:/p", &loaded("cli"));
        assert_eq!(cache.get("M:/p").unwrap().source, "cli");
    }

    // ── handler ──────────────────────────────────────────────────────────

    async fn call(path: &str) -> JsonResponse {
        read_statuses(
            Extension(Arc::new(DoltManager::new())),
            Extension(Arc::new(StatusCache::default())),
            Query(StatusesParams { path: path.to_string() }),
        )
        .await
    }

    #[tokio::test]
    async fn folder_without_beads_is_not_found() {
        // Inside the home folder: on Unix, validate_path_security refuses
        // anything outside it, and tempdir() lands in /tmp.
        let home = directories::UserDirs::new().unwrap().home_dir().to_path_buf();
        let tmp = tempfile::tempdir_in(home).unwrap();
        let (code, Json(body)) = call(&tmp.path().to_string_lossy()).await;
        assert_eq!(code, StatusCode::NOT_FOUND);
        assert!(body["error"].as_str().unwrap().contains(".beads"));
    }

    #[tokio::test]
    async fn unresolvable_path_is_forbidden() {
        let (code, _) = call("Z:/no/such/parent/at/all/project").await;
        assert_eq!(code, StatusCode::FORBIDDEN);
    }

    #[test]
    fn api_shape_is_name_category_builtin() {
        let json = serde_json::to_value(status("inreview", "wip", false)).unwrap();
        assert_eq!(json, serde_json::json!({"name": "inreview", "category": "wip", "builtin": false}));
    }
}
