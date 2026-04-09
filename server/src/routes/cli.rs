//! CLI route handlers for executing bd commands.
//!
//! Provides a secure endpoint for executing whitelisted bd CLI commands.

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;

use super::validate_path_security;

/// Whitelisted bd subcommands that are allowed to be executed.
const ALLOWED_COMMANDS: &[&str] = &["list", "show", "comments", "update", "close", "create", "ready", "epic", "config", "delete"];

/// Request body for the bd command endpoint.
#[derive(Deserialize)]
pub struct BdCommandRequest {
    /// Arguments to pass to the bd command.
    pub args: Vec<String>,
    /// Optional working directory for command execution.
    pub cwd: Option<String>,
}

/// Response body for the bd command endpoint.
#[derive(Serialize)]
pub struct BdCommandResponse {
    /// Standard output from the command.
    pub stdout: String,
    /// Standard error from the command.
    pub stderr: String,
    /// Exit code from the command.
    pub code: i32,
}

/// Execute a bd command with the provided arguments.
///
/// # Security
///
/// - Only whitelisted subcommands are allowed
/// - Working directory is validated to exist
/// - Command execution has a 30-second timeout
///
/// # Endpoint
///
/// `POST /api/bd/command`
pub async fn bd_command(Json(req): Json<BdCommandRequest>) -> impl IntoResponse {
    // Validate that we have at least one argument (the subcommand)
    if req.args.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "No arguments provided. Expected a bd subcommand."
            })),
        )
            .into_response();
    }

    // Check if the subcommand is whitelisted
    let subcommand = &req.args[0];
    if !ALLOWED_COMMANDS.contains(&subcommand.as_str()) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": format!(
                    "Command '{}' is not allowed. Allowed commands: {:?}",
                    subcommand, ALLOWED_COMMANDS
                )
            })),
        )
            .into_response();
    }

    // Validate and set working directory
    let cwd = if let Some(ref dir) = req.cwd {
        let path = Path::new(dir);
        if let Err(e) = validate_path_security(path) {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": e }))).into_response();
        }
        if !path.exists() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Working directory does not exist: {}", dir)
                })),
            )
                .into_response();
        }
        if !path.is_dir() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Path is not a directory: {}", dir)
                })),
            )
                .into_response();
        }
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_else(|_| Path::new(".").to_path_buf())
    };

    // Build and execute the command with timeout
    let bd_path = match super::find_bd() {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "bd CLI not found. Install beads (https://github.com/steveyegge/beads) or add bd to PATH."
                })),
            ).into_response();
        }
    };
    let mut cmd = Command::new(bd_path);
    cmd.args(&req.args).current_dir(&cwd);

    let result = tokio::time::timeout(Duration::from_secs(30), cmd.output()).await;

    match result {
        Ok(Ok(output)) => {
            let response = BdCommandResponse {
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                code: output.status.code().unwrap_or(-1),
            };
            Json(response).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to execute command: {}", e)
            })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(serde_json::json!({
                "error": "Command timed out after 30 seconds"
            })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allowed_commands_contains_expected() {
        assert!(ALLOWED_COMMANDS.contains(&"list"));
        assert!(ALLOWED_COMMANDS.contains(&"show"));
        assert!(ALLOWED_COMMANDS.contains(&"comments"));
        assert!(ALLOWED_COMMANDS.contains(&"config"));
        assert!(ALLOWED_COMMANDS.contains(&"update"));
        assert!(ALLOWED_COMMANDS.contains(&"close"));
        assert!(ALLOWED_COMMANDS.contains(&"create"));
        assert!(ALLOWED_COMMANDS.contains(&"delete"));
    }

    #[test]
    fn test_disallowed_commands() {
        assert!(!ALLOWED_COMMANDS.contains(&"rm"));
        assert!(!ALLOWED_COMMANDS.contains(&"exec"));
    }
}
