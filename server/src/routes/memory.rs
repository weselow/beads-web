//! Memory API route handlers backed by the `bd` CLI.
//!
//! Delegates all storage to `bd remember` / `bd forget` / `bd memories`,
//! which is the canonical memory store for beads projects.

use axum::{
    extract::Query,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

use super::{find_bd, validate_path_security};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A single memory entry as stored by `bd remember`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryEntry {
    pub key: String,
    pub content: String,
}

/// Query parameters for GET /api/memory.
#[derive(Debug, Deserialize)]
pub struct MemoryParams {
    pub path: String,
}

/// Request body for PUT /api/memory.
#[derive(Debug, Deserialize)]
pub struct UpdateMemoryRequest {
    pub path: String,
    /// Key for the entry. Empty string means bd auto-generates one.
    pub key: String,
    pub content: String,
}

/// Request body for DELETE /api/memory.
#[derive(Debug, Deserialize)]
pub struct DeleteMemoryRequest {
    pub path: String,
    pub key: String,
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/// Spawn `bd -C <project_path> <args...>` and return stdout on success.
///
/// On non-zero exit returns `(400, stderr)`.
/// On spawn failure or missing binary returns `(500, message)`.
async fn run_bd(project_path: &Path, args: &[&str]) -> Result<String, (StatusCode, String)> {
    let bd = find_bd().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "bd CLI not found; install beads and ensure bd is in PATH".to_string(),
        )
    })?;

    let output = Command::new(bd)
        .arg("-C")
        .arg(project_path)
        .args(args)
        .output()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to spawn bd: {e}"),
            )
        })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err((
            StatusCode::BAD_REQUEST,
            if msg.is_empty() {
                format!("bd exited with status {}", output.status)
            } else {
                msg
            },
        ))
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/memory?path={project_path}
///
/// Lists all memories stored by `bd remember` in the given project.
pub async fn list_memory(Query(params): Query<MemoryParams>) -> impl IntoResponse {
    let project_path = PathBuf::from(&params.path);

    if let Err(e) = validate_path_security(&project_path) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response();
    }

    let stdout = match run_bd(&project_path, &["memories", "--json"]).await {
        Ok(s) => s,
        Err((code, msg)) => {
            return (code, Json(serde_json::json!({ "error": msg }))).into_response();
        }
    };

    // `bd memories --json` returns a flat object: {"schema_version":1,"key":"content",...}
    let map: serde_json::Map<String, serde_json::Value> =
        match serde_json::from_str(stdout.trim()) {
            Ok(m) => m,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Failed to parse bd output: {e}") })),
                )
                    .into_response();
            }
        };

    let entries: Vec<MemoryEntry> = map
        .into_iter()
        .filter_map(|(k, v)| {
            if k == "schema_version" {
                return None;
            }
            v.as_str().map(|s| MemoryEntry {
                key: k,
                content: s.to_string(),
            })
        })
        .collect();

    (StatusCode::OK, Json(entries)).into_response()
}

/// PUT /api/memory
///
/// Upsert a memory entry via `bd remember`. If `key` is empty, bd
/// auto-generates one (returned key will be empty in the response; the
/// frontend should re-fetch to get the new key).
pub async fn update_memory(Json(payload): Json<UpdateMemoryRequest>) -> impl IntoResponse {
    let project_path = PathBuf::from(&payload.path);

    if let Err(e) = validate_path_security(&project_path) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response();
    }

    let result = if payload.key.is_empty() {
        run_bd(&project_path, &["remember", &payload.content]).await
    } else {
        run_bd(
            &project_path,
            &["remember", &payload.content, "--key", &payload.key],
        )
        .await
    };

    if let Err((code, msg)) = result {
        return (code, Json(serde_json::json!({ "error": msg }))).into_response();
    }

    (
        StatusCode::OK,
        Json(MemoryEntry {
            key: payload.key,
            content: payload.content,
        }),
    )
        .into_response()
}

/// DELETE /api/memory
///
/// Permanently delete a memory entry via `bd forget`.
pub async fn delete_memory(Json(payload): Json<DeleteMemoryRequest>) -> impl IntoResponse {
    let project_path = PathBuf::from(&payload.path);

    if let Err(e) = validate_path_security(&project_path) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response();
    }

    if let Err((code, msg)) = run_bd(&project_path, &["forget", &payload.key]).await {
        return (code, Json(serde_json::json!({ "error": msg }))).into_response();
    }

    (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
}
