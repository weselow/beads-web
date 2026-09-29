//! Route handlers for the beads-server API.
//!
//! This module contains all HTTP route handlers.
//! Additional handlers will be added as API endpoints are implemented.

pub mod agents;
pub mod beads;
pub mod cli;
pub mod dolt;
pub mod fs;
pub mod git;
pub mod journal;
pub mod journal_setting;
pub mod memory;
pub mod projects;
pub mod statuses;
pub mod version;
pub mod watch;
pub mod worktree;

pub use projects::project_routes;
pub use watch::watch_beads;

use axum::{response::IntoResponse, Json};
use directories::UserDirs;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Health check response structure.
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

/// Health check endpoint handler.
///
/// Returns a JSON response indicating the server is running.
pub async fn health() -> impl IntoResponse {
    Json(HealthResponse { status: "ok" })
}

/// Cached path to the `bd` CLI binary.
///
/// Resolved once at first use and cached for the process lifetime.
/// Searches PATH first, then common install locations.
static BD_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Builds the list of well-known `bd` install locations to probe after PATH.
///
/// The binary name carries an `.exe` suffix on Windows for every candidate —
/// the official installers write `bd.exe`, so a suffix-less path never matches.
fn bd_candidates() -> Vec<PathBuf> {
    let bd_bin = if cfg!(windows) { "bd.exe" } else { "bd" };
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Official Windows installer (install.ps1) target — probed before $HOME
    // locations because it is the documented Windows install path.
    if cfg!(windows) {
        if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_appdata).join("Programs").join("bd").join(bd_bin));
        }
    }

    if let Some(home) = UserDirs::new().map(|d| d.home_dir().to_path_buf()) {
        candidates.push(home.join(".cargo").join("bin").join(bd_bin));
        candidates.push(home.join(".local").join("bin").join(bd_bin));
        candidates.push(home.join(".beads").join("bin").join(bd_bin));
        // `go install` default location
        candidates.push(home.join("go").join("bin").join(bd_bin));
    }

    if !cfg!(windows) {
        candidates.push(PathBuf::from("/usr/local/bin/bd"));
        // Homebrew on Apple Silicon
        candidates.push(PathBuf::from("/opt/homebrew/bin/bd"));
    }

    candidates
}

/// Returns the path to the `bd` CLI binary, or `None` if not found.
///
/// Search order:
/// 1. `bd` in PATH (via `which`/`where`)
/// 2. `%LOCALAPPDATA%\Programs\bd\bd.exe` (Windows — official `install.ps1` target)
/// 3. `~/.cargo/bin/bd`
/// 4. `~/.local/bin/bd`
/// 5. `~/.beads/bin/bd`
/// 6. `~/go/bin/bd` (`go install`)
/// 7. `/usr/local/bin/bd`, `/opt/homebrew/bin/bd` (unix only)
///
/// The binary name gets an `.exe` suffix on Windows for every candidate.
pub fn find_bd() -> Option<&'static PathBuf> {
    BD_PATH.get_or_init(|| {
        // Try PATH first
        if let Ok(output) = std::process::Command::new(if cfg!(windows) { "where" } else { "which" })
            .arg("bd")
            .output()
        {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout);
                let path = PathBuf::from(path_str.trim().lines().next().unwrap_or("").trim());
                if path.exists() {
                    tracing::info!("Found bd CLI in PATH: {}", path.display());
                    return Some(path);
                }
            }
        }

        // Search common locations
        let candidates = bd_candidates();

        for candidate in &candidates {
            if candidate.exists() {
                tracing::info!("Found bd CLI at: {}", candidate.display());
                return Some(candidate.clone());
            }
        }

        tracing::warn!(
            "bd CLI not found. Searched PATH and: {}. \
             Install bd (https://github.com/gastownhall/beads) or add it to PATH. \
             Note: the installer edits PATH, so restart beads-web after installing.",
            candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
        );
        None
    }).as_ref()
}

/// Validates that a path is safe to access.
///
/// # Security
///
/// This function ensures that:
/// - The path can be canonicalized (no path traversal attacks)
/// - On Windows: the path is on a local drive (not a UNC network path)
/// - On Unix: the path is within the user's home directory
///
/// # Returns
///
/// - `Ok(())` if the path is valid and within allowed directories
/// - `Err(String)` with an error message if validation fails
pub fn validate_path_security(path: &Path) -> Result<(), String> {
    // Reject dolt:// virtual paths — these are not filesystem paths
    if path.to_string_lossy().starts_with("dolt://") {
        return Err("dolt:// paths cannot be used for filesystem operations".to_string());
    }

    // Canonicalize paths for comparison (resolves symlinks and ..)
    let canonical_path = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // If path doesn't exist yet, check the parent
            if let Some(parent) = path.parent() {
                match parent.canonicalize() {
                    Ok(p) => p.join(path.file_name().unwrap_or_default()),
                    Err(_) => return Err("Invalid path".to_string()),
                }
            } else {
                return Err("Invalid path".to_string());
            }
        }
    };

    // On Windows, allow any local drive but block UNC network paths.
    // On Unix, restrict to the user's home directory.
    if cfg!(windows) {
        let path_str = canonical_path.to_string_lossy();
        // Windows canonicalize produces \\?\C:\... (extended-length path prefix).
        // Strip that prefix before checking for actual UNC paths.
        let normalized = path_str
            .strip_prefix("\\\\?\\")
            .unwrap_or(&path_str);
        // Real UNC paths: \\server\share or \\?\UNC\server\share
        if normalized.starts_with("\\\\") || normalized.starts_with("UNC\\") {
            return Err("Access denied: network (UNC) paths are not allowed".to_string());
        }
        // Must start with a drive letter like C:\
        if !normalized.starts_with(|c: char| c.is_ascii_alphabetic()) {
            return Err("Access denied: invalid path".to_string());
        }
    } else {
        let user_dirs = match UserDirs::new() {
            Some(u) => u,
            None => return Err("Could not determine user directories".to_string()),
        };

        let home_dir = user_dirs.home_dir();

        let canonical_home = match home_dir.canonicalize() {
            Ok(h) => h,
            Err(_) => return Err("Could not canonicalize home directory".to_string()),
        };

        if !canonical_path.starts_with(&canonical_home) {
            return Err("Access denied: path must be within home directory".to_string());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_validate_home_path() {
        if let Some(user_dirs) = UserDirs::new() {
            let test_path = user_dirs.home_dir().join("test");
            // This might fail if test doesn't exist, but the parent check should work
            let result = validate_path_security(&test_path);
            // Should either succeed or fail with "Invalid path" (if test doesn't exist)
            assert!(result.is_ok() || result.unwrap_err().contains("Invalid"));
        }
    }

    #[test]
    fn test_bd_candidates_use_platform_binary_name() {
        let candidates = bd_candidates();
        assert!(!candidates.is_empty(), "expected at least the $HOME candidates");

        let expected = if cfg!(windows) { "bd.exe" } else { "bd" };
        for candidate in &candidates {
            let name = candidate.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            assert_eq!(name, expected, "wrong binary name in {}", candidate.display());
        }
    }

    #[test]
    fn test_bd_candidates_cover_installer_locations() {
        let candidates: Vec<String> = bd_candidates()
            .iter()
            .map(|p| p.display().to_string().replace('\\', "/"))
            .collect();
        let has = |needle: &str| candidates.iter().any(|c| c.contains(needle));

        // `go install` target — both platforms
        assert!(has("go/bin/bd"), "missing go/bin candidate: {candidates:?}");

        if cfg!(windows) {
            // Official install.ps1 target
            assert!(has("Programs/bd/bd.exe"), "missing LOCALAPPDATA candidate: {candidates:?}");
        } else {
            assert!(has("/usr/local/bin/bd"), "missing /usr/local/bin candidate: {candidates:?}");
            assert!(has("/opt/homebrew/bin/bd"), "missing homebrew candidate: {candidates:?}");
        }
    }

    #[test]
    fn test_reject_unsafe_paths() {
        if cfg!(windows) {
            // UNC paths should be rejected
            let result = validate_path_security(&PathBuf::from("\\\\server\\share\\file"));
            assert!(result.is_err());
            let err_msg = result.unwrap_err();
            assert!(err_msg.contains("denied") || err_msg.contains("Invalid") || err_msg.contains("network"));
        } else {
            // Unix: paths outside home should be rejected
            let result = validate_path_security(&PathBuf::from("/etc/passwd"));
            assert!(result.is_err());
            let err_msg = result.unwrap_err();
            assert!(err_msg.contains("denied") || err_msg.contains("Invalid"));
        }
    }
}
