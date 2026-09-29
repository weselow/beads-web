//! GET/POST /api/projects/journal — the bd events journal switch of a project.
//!
//! Turning it on or off is `bd config set events-journal true|false`, which
//! writes `.beads/config.yaml`. That setting applies to every bd command run in
//! the project, agents included, not only to beads-web.

use axum::{extract::Query, http::StatusCode, Extension, Json};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use super::beads::DOLT_PATH_PREFIX;
use super::journal::{journal_enabled, JournalCache};
use super::validate_path_security;

type JsonResponse = (StatusCode, Json<serde_json::Value>);

/// When set, this variable wins over `.beads/config.yaml` (see
/// `journal::journal_enabled`), so the switch cannot change anything.
const ENV_VAR: &str = "BD_EVENTS_JOURNAL";

/// Query parameters for GET /api/projects/journal.
#[derive(Debug, Deserialize)]
pub struct JournalParams {
    pub path: String,
}

/// Request body for POST /api/projects/journal.
#[derive(Debug, Deserialize)]
pub struct JournalToggle {
    pub path: String,
    pub enabled: bool,
}

/// What the switch needs from outside: the environment, bd and the in-memory
/// copies. Tests swap in a fake so they never run the real bd.
trait JournalBackend {
    fn forced_by_env(&self) -> bool;
    async fn run_bd(&self, args: &[&str], cwd: &Path) -> Result<String, String>;
    fn forget(&self, project: &Path);
}

/// The real outside world: the server's environment, bd on PATH and the
/// journal copies `/api/beads` keeps.
struct ServerBackend(Arc<JournalCache>);

impl JournalBackend for ServerBackend {
    fn forced_by_env(&self) -> bool {
        env_forces_journal()
    }

    async fn run_bd(&self, args: &[&str], cwd: &Path) -> Result<String, String> {
        super::beads::run_bd(args, cwd).await
    }

    fn forget(&self, project: &Path) {
        self.0.forget(project);
    }
}

fn env_forces_journal() -> bool {
    std::env::var_os(ENV_VAR).is_some()
}

/// GET /api/projects/journal?path=... → `{enabled, forced_by_env}`
pub async fn get_journal(Query(params): Query<JournalParams>) -> JsonResponse {
    journal_status(&params.path, env_forces_journal())
}

/// POST /api/projects/journal `{path, enabled}` → `{enabled, forced_by_env}`
pub async fn set_journal(
    Extension(cache): Extension<Arc<JournalCache>>,
    Json(req): Json<JournalToggle>,
) -> JsonResponse {
    let started = Instant::now();
    let (code, body) = toggle(&ServerBackend(cache), &req).await;
    let duration_ms = started.elapsed().as_millis() as u64;
    if code.is_success() {
        tracing::info!(path = %req.path, enabled = req.enabled, status = code.as_u16(), duration_ms, "events journal switched");
    } else {
        let error = body.0["error"].as_str().unwrap_or_default();
        tracing::warn!(path = %req.path, enabled = req.enabled, status = code.as_u16(), duration_ms, error, "events journal switch failed");
    }
    (code, body)
}

fn config_args(enabled: bool) -> [&'static str; 4] {
    let value = if enabled { "true" } else { "false" };
    ["config", "set", "events-journal", value]
}

fn error(code: StatusCode, message: impl Into<String>) -> JsonResponse {
    (code, Json(serde_json::json!({ "error": message.into() })))
}

fn state(enabled: bool, forced_by_env: bool) -> JsonResponse {
    let body = serde_json::json!({ "enabled": enabled, "forced_by_env": forced_by_env });
    (StatusCode::OK, Json(body))
}

/// The project folder, spelled the way `/api/beads` spells it — that
/// spelling is the key of the in-memory copy.
fn project_dir(raw_path: &str) -> Result<PathBuf, JsonResponse> {
    let path = raw_path.replace('\\', "/");
    if path.starts_with(DOLT_PATH_PREFIX) {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "dolt:// projects are read from a Dolt server; the events journal applies only to projects read through bd",
        ));
    }
    let dir = PathBuf::from(path);
    validate_path_security(&dir).map_err(|e| error(StatusCode::FORBIDDEN, e))?;
    if !dir.join(".beads").is_dir() {
        return Err(error(
            StatusCode::NOT_FOUND,
            "No .beads directory found at the specified path",
        ));
    }
    Ok(dir)
}

fn journal_status(raw_path: &str, forced_by_env: bool) -> JsonResponse {
    match project_dir(raw_path) {
        Ok(dir) => state(journal_enabled(&dir), forced_by_env),
        Err(response) => response,
    }
}

async fn toggle<B: JournalBackend>(backend: &B, req: &JournalToggle) -> JsonResponse {
    let dir = match project_dir(&req.path) {
        Ok(dir) => dir,
        Err(response) => return response,
    };
    if backend.forced_by_env() {
        return error(
            StatusCode::CONFLICT,
            format!("The events journal is set by the {ENV_VAR} environment variable of the beads-web server; change it there"),
        );
    }
    if let Err(e) = backend.run_bd(&config_args(req.enabled), &dir).await {
        return error(StatusCode::INTERNAL_SERVER_ERROR, format!("bd config set failed: {e}"));
    }
    if !req.enabled {
        // Changes made from now on are not journaled; an old copy must not
        // be resumed if the journal is turned back on.
        backend.forget(&dir);
    }
    let now = journal_enabled(&dir);
    if now != req.enabled {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("bd accepted the change, but .beads/config.yaml still says events-journal: {now}"),
        );
    }
    state(now, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// A project folder inside the home folder: on Unix,
    /// validate_path_security refuses anything outside it, and tempdir()
    /// lands in /tmp.
    fn project(config: Option<&str>) -> tempfile::TempDir {
        let home = directories::UserDirs::new().unwrap().home_dir().to_path_buf();
        let dir = tempfile::tempdir_in(home).unwrap();
        std::fs::create_dir(dir.path().join(".beads")).unwrap();
        if let Some(text) = config {
            std::fs::write(dir.path().join(".beads").join("config.yaml"), text).unwrap();
        }
        dir
    }

    fn path_of(dir: &tempfile::TempDir) -> String {
        dir.path().to_string_lossy().replace('\\', "/")
    }

    #[derive(Default)]
    struct FakeBackend {
        forced: bool,
        fail: Option<String>,
        /// Write `.beads/config.yaml` the way `bd config set` does.
        writes_config: bool,
        calls: Mutex<Vec<(Vec<String>, PathBuf)>>,
        forgotten: Mutex<Vec<PathBuf>>,
    }

    impl JournalBackend for FakeBackend {
        fn forced_by_env(&self) -> bool {
            self.forced
        }

        async fn run_bd(&self, args: &[&str], cwd: &Path) -> Result<String, String> {
            let owned = args.iter().map(|a| a.to_string()).collect();
            self.calls.lock().unwrap().push((owned, cwd.to_path_buf()));
            if let Some(e) = &self.fail {
                return Err(e.clone());
            }
            if self.writes_config {
                let text = format!("events-journal: {}\n", args[3]);
                std::fs::write(cwd.join(".beads").join("config.yaml"), text).unwrap();
            }
            Ok(String::new())
        }

        fn forget(&self, project: &Path) {
            self.forgotten.lock().unwrap().push(project.to_path_buf());
        }
    }

    fn working_bd() -> FakeBackend {
        FakeBackend { writes_config: true, ..Default::default() }
    }

    fn request(path: &str, enabled: bool) -> JournalToggle {
        JournalToggle { path: path.to_string(), enabled }
    }

    // ── building the bd call ─────────────────────────────────────────────

    #[test]
    fn turning_on_sets_the_key_to_true() {
        assert_eq!(config_args(true), ["config", "set", "events-journal", "true"]);
    }

    #[test]
    fn turning_off_sets_the_key_to_false() {
        assert_eq!(config_args(false), ["config", "set", "events-journal", "false"]);
    }

    // ── GET ──────────────────────────────────────────────────────────────

    #[test]
    fn get_reads_the_flag_from_config_yaml() {
        let dir = project(Some("events-journal: true\n"));
        let (code, Json(body)) = journal_status(&path_of(&dir), false);
        assert_eq!(code, StatusCode::OK);
        assert_eq!(body, serde_json::json!({"enabled": true, "forced_by_env": false}));
    }

    #[test]
    fn get_without_the_key_is_off() {
        let dir = project(None);
        let (code, Json(body)) = journal_status(&path_of(&dir), false);
        assert_eq!(code, StatusCode::OK);
        assert_eq!(body["enabled"], false);
    }

    #[test]
    fn get_reports_the_env_override() {
        let dir = project(None);
        let (_, Json(body)) = journal_status(&path_of(&dir), true);
        assert_eq!(body["forced_by_env"], true);
    }

    #[test]
    fn get_refuses_a_dolt_path() {
        let (code, _) = journal_status("dolt://beads_x", false);
        assert_eq!(code, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn get_refuses_an_unresolvable_path() {
        let (code, _) = journal_status("Z:/no/such/parent/at/all/project", false);
        assert_eq!(code, StatusCode::FORBIDDEN);
    }

    #[test]
    fn get_without_beads_folder_is_not_found() {
        let home = directories::UserDirs::new().unwrap().home_dir().to_path_buf();
        let dir = tempfile::tempdir_in(home).unwrap();
        let (code, _) = journal_status(&path_of(&dir), false);
        assert_eq!(code, StatusCode::NOT_FOUND);
    }

    // ── POST ─────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn turning_on_runs_bd_in_the_project_and_keeps_the_copy() {
        let dir = project(None);
        let bd = working_bd();
        let (code, Json(body)) = toggle(&bd, &request(&path_of(&dir), true)).await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!(body, serde_json::json!({"enabled": true, "forced_by_env": false}));
        let calls = bd.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, ["config", "set", "events-journal", "true"]);
        assert_eq!(calls[0].1, PathBuf::from(path_of(&dir)));
        assert!(bd.forgotten.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn turning_off_forgets_the_in_memory_copy() {
        let dir = project(Some("events-journal: true\n"));
        let bd = working_bd();
        let (code, Json(body)) = toggle(&bd, &request(&path_of(&dir), false)).await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!(body["enabled"], false);
        assert_eq!(bd.calls.lock().unwrap()[0].0[3], "false");
        // The same key /api/beads uses for the copy.
        assert_eq!(*bd.forgotten.lock().unwrap(), [PathBuf::from(path_of(&dir))]);
    }

    #[tokio::test]
    async fn forced_by_env_is_refused_without_running_bd() {
        let dir = project(None);
        let bd = FakeBackend { forced: true, ..working_bd() };
        let (code, Json(body)) = toggle(&bd, &request(&path_of(&dir), true)).await;
        assert_eq!(code, StatusCode::CONFLICT);
        assert!(body["error"].as_str().unwrap().contains("BD_EVENTS_JOURNAL"));
        assert!(bd.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_failed_bd_call_is_reported_and_forgets_nothing() {
        let dir = project(Some("events-journal: true\n"));
        let bd = FakeBackend { fail: Some("boom".into()), ..Default::default() };
        let (code, Json(body)) = toggle(&bd, &request(&path_of(&dir), false)).await;
        assert_eq!(code, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(body["error"].as_str().unwrap().contains("boom"));
        assert!(bd.forgotten.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn bd_success_without_the_config_change_is_an_error() {
        let dir = project(None);
        let bd = FakeBackend::default();
        let (code, Json(body)) = toggle(&bd, &request(&path_of(&dir), true)).await;
        assert_eq!(code, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(body["error"].as_str().unwrap().contains("config.yaml"));
    }

    #[tokio::test]
    async fn post_refuses_a_dolt_path() {
        let bd = working_bd();
        let (code, _) = toggle(&bd, &request("dolt://beads_x", true)).await;
        assert_eq!(code, StatusCode::BAD_REQUEST);
        assert!(bd.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn post_refuses_an_unresolvable_path() {
        let bd = working_bd();
        let (code, _) = toggle(&bd, &request("Z:/no/such/parent/at/all/project", true)).await;
        assert_eq!(code, StatusCode::FORBIDDEN);
        assert!(bd.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn post_without_beads_folder_is_not_found() {
        let home = directories::UserDirs::new().unwrap().home_dir().to_path_buf();
        let dir = tempfile::tempdir_in(home).unwrap();
        let bd = working_bd();
        let (code, _) = toggle(&bd, &request(&path_of(&dir), true)).await;
        assert_eq!(code, StatusCode::NOT_FOUND);
        assert!(bd.calls.lock().unwrap().is_empty());
    }

    /// Only Windows paths come with backslashes; on Unix one is a file name
    /// character.
    #[cfg(windows)]
    #[tokio::test]
    async fn backslashes_in_the_path_are_accepted() {
        let dir = project(None);
        let bd = working_bd();
        let windows_style = path_of(&dir).replace('/', "\\");
        let (code, _) = toggle(&bd, &request(&windows_style, true)).await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!(bd.calls.lock().unwrap()[0].1, PathBuf::from(path_of(&dir)));
    }
}
