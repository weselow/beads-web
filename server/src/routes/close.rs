//! POST /api/beads/close — closes a bead, with an optional reason.
//!
//! A `dolt://` project has no folder to run bd in, so it is closed over SQL;
//! a project folder goes through `bd close`.

use axum::{extract::Extension, http::StatusCode, Json};
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;

use super::beads::{run_bd, DOLT_PATH_PREFIX};
use super::validate_path_security;
use crate::dolt::{self, DoltError, DoltManager};

/// Request body for closing a bead.
#[derive(Debug, Deserialize)]
pub struct CloseBeadRequest {
    /// Project folder or `dolt://dbname`
    pub path: String,
    /// Bead ID to close
    pub id: String,
    /// Why it is closed; empty or blank means no reason.
    pub reason: Option<String>,
}

/// Status code and JSON body sent back to the page.
pub(super) type Reply = (StatusCode, Json<serde_json::Value>);

pub(super) fn error_reply(code: StatusCode, message: impl Into<String>) -> Reply {
    (code, Json(serde_json::json!({ "error": message.into() })))
}

/// The reason, when it has any text at all.
fn given_reason(reason: Option<&str>) -> Option<&str> {
    reason.filter(|r| !r.trim().is_empty())
}

/// Arguments for `bd close`; the reason is glued to its flag, so a reason
/// starting with `-` is never read as a flag.
fn build_close_args(id: &str, reason: Option<&str>) -> Vec<String> {
    let mut args = vec!["close".to_string(), id.to_string()];
    if let Some(reason) = reason {
        args.push(format!("--reason={}", reason));
    }
    args
}

/// The page's answer for a failed SQL write.
pub(super) fn sql_error_reply(e: DoltError) -> Reply {
    let code = match e {
        DoltError::BeadNotFound(_) => StatusCode::NOT_FOUND,
        DoltError::ConnectionFailed(_) => StatusCode::SERVICE_UNAVAILABLE,
        DoltError::QueryFailed(_) | DoltError::DatabaseNotFound(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    error_reply(code, e.to_string())
}

/// 503 when the central Dolt server cannot be reached.
pub(super) async fn ensure_dolt_running(dolt_manager: &DoltManager) -> Result<(), Reply> {
    if dolt_manager.is_available() || dolt_manager.check_server().await {
        return Ok(());
    }
    Err(error_reply(StatusCode::SERVICE_UNAVAILABLE, "Dolt server is not running"))
}

/// Closes a bead of a `dolt://` project over SQL.
async fn close_over_sql(
    dolt_manager: &DoltManager,
    db_name: &str,
    id: &str,
    reason: Option<&str>,
) -> Result<(), Reply> {
    ensure_dolt_running(dolt_manager).await?;
    dolt_manager
        .close_bead(db_name, id, dolt::sql_close_reason(reason))
        .await
        .map_err(sql_error_reply)
}

/// Closes a bead with `bd close`, run in the project folder.
async fn close_with_bd(folder: &str, id: &str, reason: Option<&str>) -> Result<(), Reply> {
    let project_path = Path::new(folder);
    validate_path_security(project_path).map_err(|e| error_reply(StatusCode::FORBIDDEN, e))?;
    let args = build_close_args(id, reason);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    run_bd(&args, project_path)
        .await
        .map(|_| ())
        .map_err(|e| error_reply(StatusCode::INTERNAL_SERVER_ERROR, e.trim()))
}

/// POST /api/beads/close
///
/// Closes a bead with an optional reason: over SQL for `dolt://` paths,
/// with `bd close` for project folders.
pub async fn close_bead_handler(
    Extension(dolt_manager): Extension<Arc<DoltManager>>,
    Json(req): Json<CloseBeadRequest>,
) -> Reply {
    if req.id.trim().is_empty() {
        return error_reply(StatusCode::BAD_REQUEST, "Bead ID is required");
    }
    let reason = given_reason(req.reason.as_deref());
    let (via, result) = match req.path.strip_prefix(DOLT_PATH_PREFIX) {
        Some(db_name) => ("dolt", close_over_sql(&dolt_manager, db_name, &req.id, reason).await),
        None => ("bd", close_with_bd(&req.path, &req.id, reason).await),
    };
    match result {
        Ok(()) => {
            tracing::info!(bead = %req.id, path = %req.path, via, has_reason = reason.is_some(), "bead closed");
            (StatusCode::OK, Json(serde_json::json!({ "success": true })))
        }
        Err((code, Json(body))) => {
            tracing::warn!(bead = %req.id, path = %req.path, via, status = %code, error = %body["error"], "closing a bead failed");
            (code, Json(body))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str, id: &str) -> CloseBeadRequest {
        CloseBeadRequest { path: path.to_string(), id: id.to_string(), reason: None }
    }

    async fn call(req: CloseBeadRequest) -> Reply {
        close_bead_handler(Extension(Arc::new(DoltManager::new())), Json(req)).await
    }

    #[test]
    fn blank_reason_means_none() {
        assert_eq!(given_reason(None), None);
        assert_eq!(given_reason(Some("")), None);
        assert_eq!(given_reason(Some("  \t ")), None);
        assert_eq!(given_reason(Some(" dup ")), Some(" dup "));
    }

    #[test]
    fn close_args_without_a_reason() {
        assert_eq!(build_close_args("x-1", None), vec!["close", "x-1"]);
    }

    #[test]
    fn close_args_glue_the_reason_to_the_flag() {
        assert_eq!(
            build_close_args("x-1", Some("-not needed; \"really\"")),
            vec!["close", "x-1", "--reason=-not needed; \"really\""]
        );
    }

    #[tokio::test]
    async fn empty_id_is_refused() {
        for id in ["", "   "] {
            let (code, Json(body)) = call(request("dolt://beads_x", id)).await;
            assert_eq!(code, StatusCode::BAD_REQUEST);
            assert_eq!(body["error"], "Bead ID is required");
        }
    }

    #[tokio::test]
    async fn a_folder_that_fails_the_path_check_is_refused_before_bd_runs() {
        let missing = std::env::temp_dir().join("beads-web-no-such-dir-c0d").join("project");
        let (code, _) = call(request(&missing.to_string_lossy(), "x-1")).await;
        assert_eq!(code, StatusCode::FORBIDDEN);
    }

    #[test]
    fn missing_bead_is_404_and_other_sql_errors_keep_their_codes() {
        let code = |e: DoltError| sql_error_reply(e).0;
        assert_eq!(code(DoltError::BeadNotFound("x-1".into())), StatusCode::NOT_FOUND);
        assert_eq!(code(DoltError::ConnectionFailed("down".into())), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(code(DoltError::QueryFailed("bad".into())), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
