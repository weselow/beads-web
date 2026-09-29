//! POST /api/beads/comment — adds a comment to a bead.
//!
//! A `dolt://` project has no folder to run bd in, so the comment goes in
//! over SQL; a project folder goes through `bd comment`.

use axum::{extract::Extension, http::StatusCode, Json};
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;

use super::beads::{run_bd, DOLT_PATH_PREFIX};
use super::close::{ensure_dolt_running, error_reply, sql_error_reply, Reply};
use super::validate_path_security;
use crate::dolt::DoltManager;

/// Request body for adding a comment.
#[derive(Debug, Deserialize)]
pub struct CommentRequest {
    /// Project folder or `dolt://dbname`
    pub path: String,
    /// Bead ID to comment on
    pub id: String,
    /// Comment text, stored as sent
    pub text: String,
}

/// Arguments for `bd comment`. `--` ends the flags, so an id or a text
/// starting with `-` is never read as a flag.
fn build_comment_args<'a>(id: &'a str, text: &'a str) -> Vec<&'a str> {
    vec!["comment", "--", id, text]
}

/// Adds the comment to a bead of a `dolt://` project over SQL.
async fn comment_over_sql(dolt_manager: &DoltManager, db_name: &str, id: &str, text: &str) -> Result<(), Reply> {
    ensure_dolt_running(dolt_manager).await?;
    dolt_manager.add_comment(db_name, id, text).await.map_err(sql_error_reply)
}

/// Adds the comment with `bd comment`, run in the project folder.
async fn comment_with_bd(folder: &str, id: &str, text: &str) -> Result<(), Reply> {
    let project_path = Path::new(folder);
    validate_path_security(project_path).map_err(|e| error_reply(StatusCode::FORBIDDEN, e))?;
    run_bd(&build_comment_args(id, text), project_path)
        .await
        .map(|_| ())
        .map_err(|e| error_reply(StatusCode::INTERNAL_SERVER_ERROR, e.trim()))
}

/// What is wrong with the request before anything runs, if anything.
fn request_problem(req: &CommentRequest) -> Option<&'static str> {
    if req.id.trim().is_empty() {
        return Some("Bead ID is required");
    }
    req.text.trim().is_empty().then_some("Comment text is required")
}

/// POST /api/beads/comment
///
/// Adds a comment: over SQL for `dolt://` paths, with `bd comment` for
/// project folders.
pub async fn add_comment_handler(
    Extension(dolt_manager): Extension<Arc<DoltManager>>,
    Json(req): Json<CommentRequest>,
) -> Reply {
    if let Some(problem) = request_problem(&req) {
        return error_reply(StatusCode::BAD_REQUEST, problem);
    }
    let (via, result) = match req.path.strip_prefix(DOLT_PATH_PREFIX) {
        Some(db_name) => ("dolt", comment_over_sql(&dolt_manager, db_name, &req.id, &req.text).await),
        None => ("bd", comment_with_bd(&req.path, &req.id, &req.text).await),
    };
    match result {
        Ok(()) => {
            tracing::info!(bead = %req.id, path = %req.path, via, text_chars = req.text.chars().count(), "comment added");
            (StatusCode::OK, Json(serde_json::json!({ "success": true })))
        }
        Err((code, Json(body))) => {
            tracing::warn!(bead = %req.id, path = %req.path, via, status = %code, error = %body["error"], "adding a comment failed");
            (code, Json(body))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str, id: &str, text: &str) -> CommentRequest {
        CommentRequest { path: path.to_string(), id: id.to_string(), text: text.to_string() }
    }

    async fn call(req: CommentRequest) -> Reply {
        add_comment_handler(Extension(Arc::new(DoltManager::new())), Json(req)).await
    }

    #[test]
    fn comment_args_end_flags_before_the_id_and_the_text() {
        // bd 1.3.0 reads `-starts with dash` as unknown flags without `--`.
        assert_eq!(
            build_comment_args("x-1", "-starts with dash; \"quoted\""),
            vec!["comment", "--", "x-1", "-starts with dash; \"quoted\""]
        );
    }

    #[tokio::test]
    async fn empty_id_is_refused() {
        for id in ["", "   "] {
            let (code, Json(body)) = call(request("dolt://beads_x", id, "hi")).await;
            assert_eq!(code, StatusCode::BAD_REQUEST);
            assert_eq!(body["error"], "Bead ID is required");
        }
    }

    #[tokio::test]
    async fn blank_text_is_refused() {
        for text in ["", " \n\t "] {
            let (code, Json(body)) = call(request("dolt://beads_x", "x-1", text)).await;
            assert_eq!(code, StatusCode::BAD_REQUEST);
            assert_eq!(body["error"], "Comment text is required");
        }
    }

    #[tokio::test]
    async fn a_folder_that_fails_the_path_check_is_refused_before_bd_runs() {
        let missing = std::env::temp_dir().join("beads-web-no-such-dir-3zm").join("project");
        let (code, _) = call(request(&missing.to_string_lossy(), "x-1", "hi")).await;
        assert_eq!(code, StatusCode::FORBIDDEN);
    }
}
