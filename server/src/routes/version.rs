//! Version check route handlers.
//!
//! Checks GitHub Releases for newer versions and caches the result.
//! Also provides auto-update functionality via ephemeral updater scripts.

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

/// Current version compiled into the binary.
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// GitHub repository for release checks.
const GITHUB_REPO: &str = "weselow/beads-web";

/// Cache duration in seconds (1 hour).
const CACHE_TTL_SECS: u64 = 3600;

/// Cached version check result.
#[derive(Clone)]
pub struct CachedCheck {
    result: VersionCheckResponse,
    fetched_at: std::time::Instant,
}

/// Shared cache for version check results.
pub type VersionCache = Arc<RwLock<Option<CachedCheck>>>;

/// Creates a new empty version cache.
pub fn new_cache() -> VersionCache {
    Arc::new(RwLock::new(None))
}

/// Response from the version check endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct VersionCheckResponse {
    /// Current running version
    pub current: String,
    /// Latest available version (None if check failed)
    pub latest: Option<String>,
    /// Whether an update is available
    pub update_available: bool,
    /// Download URL for the latest release
    pub download_url: Option<String>,
    /// Release notes (first 500 chars)
    pub release_notes: Option<String>,
    /// Direct download URL for the platform-specific binary asset
    pub asset_url: Option<String>,
}

/// Minimal GitHub release response.
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Option<Vec<GitHubAsset>>,
}

/// GitHub release asset.
#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// GET /api/version/check
///
/// Returns current version and checks if a newer release exists on GitHub.
/// Caches the result for 1 hour to avoid rate limiting.
pub async fn version_check(
    axum::extract::Extension(cache): axum::extract::Extension<VersionCache>,
) -> impl IntoResponse {
    // Check cache
    {
        let cached = cache.read().await;
        if let Some(ref entry) = *cached {
            if entry.fetched_at.elapsed().as_secs() < CACHE_TTL_SECS {
                return (StatusCode::OK, Json(entry.result.clone()));
            }
        }
    }

    // Fetch from GitHub
    let result = check_github_release().await;

    // Update cache
    {
        let mut cached = cache.write().await;
        *cached = Some(CachedCheck {
            result: result.clone(),
            fetched_at: std::time::Instant::now(),
        });
    }

    (StatusCode::OK, Json(result))
}

/// Fetches the latest release from GitHub and compares versions.
async fn check_github_release() -> VersionCheckResponse {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let client = match reqwest::Client::builder()
        .user_agent("beads-web")
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return fallback_response(),
    };

    let response = match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            info!("GitHub API returned status {}", r.status());
            return fallback_response();
        }
        Err(e) => {
            info!("GitHub release check failed: {}", e);
            return fallback_response();
        }
    };

    let release: GitHubRelease = match response.json().await {
        Ok(r) => r,
        Err(_) => return fallback_response(),
    };

    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let update_available = is_newer(&latest_version, CURRENT_VERSION);

    if update_available {
        info!(
            "Update available: {} -> {}",
            CURRENT_VERSION, latest_version
        );
    }

    let asset_url = release.assets.as_ref().and_then(|assets| {
        let target = current_platform_asset();
        assets
            .iter()
            .find(|a| a.name == target)
            .map(|a| a.browser_download_url.clone())
    });

    VersionCheckResponse {
        current: CURRENT_VERSION.to_string(),
        latest: Some(latest_version),
        update_available,
        download_url: Some(release.html_url),
        release_notes: release.body.map(|b| {
            if b.len() > 500 {
                let mut end = 500;
                while !b.is_char_boundary(end) && end > 0 {
                    end -= 1;
                }
                format!("{}…", &b[..end])
            } else {
                b
            }
        }),
        asset_url,
    }
}

/// Compares two semver strings. Returns true if `latest` > `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.')
            .filter_map(|p| p.parse::<u32>().ok())
            .collect()
    };
    let l = parse(latest);
    let c = parse(current);
    l > c
}

/// Fallback when GitHub API is unreachable.
fn fallback_response() -> VersionCheckResponse {
    VersionCheckResponse {
        current: CURRENT_VERSION.to_string(),
        latest: None,
        update_available: false,
        download_url: None,
        release_notes: None,
        asset_url: None,
    }
}

/// Returns the platform-specific binary asset name used in GitHub Releases.
///
/// Matches the naming convention from `.github/workflows/release.yml`:
/// - `beads-web-darwin-arm64` (macOS ARM)
/// - `beads-web-darwin-x64` (macOS Intel)
/// - `beads-web-linux-x64` (Linux)
/// - `beads-web-win-x64.exe` (Windows)
fn current_platform_asset() -> String {
    if cfg!(target_os = "windows") {
        "beads-web-win-x64.exe".to_string()
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "beads-web-darwin-arm64".to_string()
        } else {
            "beads-web-darwin-x64".to_string()
        }
    } else {
        "beads-web-linux-x64".to_string()
    }
}

/// POST /api/update
///
/// Downloads the latest release binary and creates an ephemeral updater script.
/// The server exits after spawning the updater, which replaces the binary and restarts.
pub async fn perform_update(
    axum::extract::Extension(cache): axum::extract::Extension<VersionCache>,
) -> impl IntoResponse {
    // 1. Get latest release info (use cache if fresh, otherwise re-fetch)
    let check = {
        let cached = cache.read().await;
        if let Some(ref entry) = *cached {
            if entry.fetched_at.elapsed().as_secs() < CACHE_TTL_SECS {
                entry.result.clone()
            } else {
                drop(cached);
                check_github_release().await
            }
        } else {
            drop(cached);
            check_github_release().await
        }
    };

    if !check.update_available {
        return (
            StatusCode::OK,
            Json(serde_json::json!({"status": "up_to_date"})),
        );
    }

    let asset_url = match check.asset_url {
        Some(url) => url,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(
                    serde_json::json!({"error": "No binary available for this platform"}),
                ),
            )
        }
    };

    // 2. Determine paths
    let current_exe = match std::env::current_exe() {
        Ok(p) => match p.canonicalize() {
            Ok(c) => c,
            Err(_) => p,
        },
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": format!("Cannot determine executable path: {}", e)}),
                ),
            )
        }
    };
    let current_dir = match current_exe.parent() {
        Some(d) => d,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Cannot determine executable directory"})),
            )
        }
    };

    let new_binary_name = if cfg!(windows) {
        "beads-server-new.exe"
    } else {
        "beads-server-new"
    };
    let new_binary = current_dir.join(new_binary_name);

    info!("Downloading update from: {}", asset_url);

    // 3. Download new binary
    let client = match reqwest::Client::builder()
        .user_agent("beads-web")
        .timeout(std::time::Duration::from_secs(300))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("HTTP client error: {}", e)})),
            )
        }
    };

    let response = match client.get(&asset_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(
                    serde_json::json!({"error": format!("Download failed: HTTP {}", r.status())}),
                ),
            )
        }
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("Download failed: {}", e)})),
            )
        }
    };

    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": format!("Failed to read download: {}", e)}),
                ),
            )
        }
    };

    // 4. Write new binary to disk
    if let Err(e) = std::fs::write(&new_binary, &bytes) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to write binary: {}", e)})),
        );
    }

    info!(
        "Downloaded update: {} bytes -> {}",
        bytes.len(),
        new_binary.display()
    );

    // 5. Generate and spawn updater script
    let port = std::env::var("PORT").unwrap_or_else(|_| "3008".to_string());
    let pid = std::process::id();

    let script_result = if cfg!(windows) {
        generate_windows_update_script(current_dir, &current_exe, &new_binary, pid, &port)
    } else {
        generate_unix_update_script(current_dir, &current_exe, &new_binary, pid, &port)
    };

    match script_result {
        Ok(script_path) => {
            info!("Spawning updater script: {}", script_path.display());

            let spawn_result = if cfg!(windows) {
                std::process::Command::new("cmd")
                    .args(["/C", "start", "/B", "", script_path.to_str().unwrap_or("")])
                    .spawn()
            } else {
                std::process::Command::new("sh")
                    .arg(&script_path)
                    .spawn()
            };

            if let Err(e) = spawn_result {
                warn!("Failed to spawn updater: {}", e);
                // Clean up
                let _ = std::fs::remove_file(&new_binary);
                let _ = std::fs::remove_file(&script_path);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({"error": format!("Failed to spawn updater: {}", e)}),
                    ),
                );
            }

            // Schedule server exit after 2 seconds to allow response to be sent
            tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                info!("Exiting for update...");
                std::process::exit(0);
            });

            (
                StatusCode::OK,
                Json(
                    serde_json::json!({"status": "updating", "message": "Server will restart shortly"}),
                ),
            )
        }
        Err(e) => {
            let _ = std::fs::remove_file(&new_binary);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": format!("Failed to create update script: {}", e)}),
                ),
            )
        }
    }
}

/// Generates a Unix shell script that replaces the binary and restarts the server.
fn generate_unix_update_script(
    dir: &Path,
    current_exe: &Path,
    new_binary: &Path,
    pid: u32,
    port: &str,
) -> Result<PathBuf, String> {
    let script_path = dir.join("beads-update.sh");
    let exe_name = current_exe
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid executable name")?;
    let new_name = new_binary
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid new binary name")?;

    let content = format!(
        r#"#!/bin/sh
# beads-web auto-updater (self-deleting)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
PID={pid}
PORT={port}

# Wait for old server to exit
echo "Waiting for server (PID $PID) to exit..."
while kill -0 $PID 2>/dev/null; do sleep 0.5; done

# Replace binary
mv "{exe_name}" "{exe_name}.old" 2>/dev/null
mv "{new_name}" "{exe_name}"
chmod +x "{exe_name}"

# Start new server
PORT=$PORT ./{exe_name} &
NEW_PID=$!

# Health check: poll once per second for up to 30 attempts.
# The new server needs ~3-4s to bind its port (a ~2s Dolt-detection
# timeout at startup dominates), so a single check would lose the race.
healthy=0
i=0
while [ $i -lt 30 ]; do
    curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1 && {{ healthy=1; break; }}
    sleep 1
    i=$((i+1))
done

if [ $healthy -eq 1 ]; then
    echo "Update successful! New server running (PID $NEW_PID)"
    rm -f "{exe_name}.old"
else
    echo "Health check failed, rolling back..."
    kill $NEW_PID 2>/dev/null
    sleep 1
    mv "{exe_name}" "{new_name}" 2>/dev/null
    mv "{exe_name}.old" "{exe_name}" 2>/dev/null
    PORT=$PORT ./{exe_name} &
fi

# Self-delete
rm -f "$SCRIPT_DIR/beads-update.sh"
"#
    );

    std::fs::write(&script_path, content).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }

    Ok(script_path)
}

/// Generates a Windows batch script that replaces the binary and restarts the server.
fn generate_windows_update_script(
    dir: &Path,
    current_exe: &Path,
    new_binary: &Path,
    pid: u32,
    port: &str,
) -> Result<PathBuf, String> {
    let script_path = dir.join("beads-update.bat");
    let exe_name = current_exe
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid executable name")?;
    let new_name = new_binary
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid new binary name")?;

    let content = format!(
        r#"@echo off
rem beads-web auto-updater (self-deleting)
cd /d "%~dp0"
set PID={pid}
set PORT={port}

echo Waiting for server (PID %PID%) to exit...
:wait_loop
tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)

echo Replacing binary...
if exist "{exe_name}.old" del /f "{exe_name}.old"
rename "{exe_name}" "{exe_name}.old"
rename "{new_name}" "{exe_name}"

echo Starting new server...
set PORT=%PORT%
start /B "" "{exe_name}"

rem Health check: poll once per second for up to 30 attempts.
rem The new server needs ~3-4s to bind its port (a ~2s Dolt-detection
rem timeout at startup dominates), so a single check would lose the race.
set /a tries=0
:health_loop
timeout /t 1 /nobreak >nul
curl -sf "http://localhost:%PORT%/api/health" >nul 2>&1
if %errorlevel% equ 0 goto health_ok
set /a tries+=1
if %tries% lss 30 goto health_loop

echo Health check failed, rolling back...
taskkill /F /IM "{exe_name}" 2>nul
del /f "{exe_name}" 2>nul
rename "{exe_name}.old" "{exe_name}"
set PORT=%PORT%
start /B "" "{exe_name}"
goto cleanup

:health_ok
echo Update successful!
del /f "{exe_name}.old" 2>nul

:cleanup
rem Self-delete
(goto) 2>nul & del /f "%~f0"
"#
    );

    std::fs::write(&script_path, content).map_err(|e| e.to_string())?;
    Ok(script_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer() {
        assert!(is_newer("0.4.0", "0.3.1"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(!is_newer("0.3.1", "0.3.1"));
        assert!(!is_newer("0.3.0", "0.3.1"));
        assert!(is_newer("0.3.2", "0.3.1"));
    }

    // ── fallback_response tests ─────────────────────────────────────────

    #[test]
    fn test_fallback_response_returns_current_version() {
        let resp = fallback_response();
        assert_eq!(resp.current, CURRENT_VERSION);
    }

    #[test]
    fn test_fallback_response_has_no_latest() {
        let resp = fallback_response();
        assert!(resp.latest.is_none());
    }

    #[test]
    fn test_fallback_response_no_update_available() {
        let resp = fallback_response();
        assert!(!resp.update_available);
    }

    #[test]
    fn test_fallback_response_no_download_url() {
        let resp = fallback_response();
        assert!(resp.download_url.is_none());
    }

    #[test]
    fn test_fallback_response_no_release_notes() {
        let resp = fallback_response();
        assert!(resp.release_notes.is_none());
    }

    // ── is_newer edge cases ─────────────────────────────────────────────

    #[test]
    fn test_is_newer_empty_strings() {
        // Both empty -> equal, not newer
        assert!(!is_newer("", ""));
    }

    #[test]
    fn test_is_newer_latest_empty() {
        // Empty latest vs valid current -> not newer
        assert!(!is_newer("", "1.0.0"));
    }

    #[test]
    fn test_is_newer_current_empty() {
        // Valid latest vs empty current -> newer
        assert!(is_newer("1.0.0", ""));
    }

    #[test]
    fn test_is_newer_single_digit_versions() {
        assert!(is_newer("2", "1"));
        assert!(!is_newer("1", "2"));
        assert!(!is_newer("1", "1"));
    }

    #[test]
    fn test_is_newer_different_length_versions() {
        // "1.0.1" vs "1.0" — 1.0.1 > 1.0 because [1,0,1] > [1,0]
        assert!(is_newer("1.0.1", "1.0"));
        // "1.0" vs "1.0.1" — not newer
        assert!(!is_newer("1.0", "1.0.1"));
    }

    #[test]
    fn test_is_newer_non_numeric_parts_ignored() {
        // Non-numeric parts are filtered out by parse::<u32>().ok()
        // "1.2.beta" parses as [1, 2], "1.2.3" parses as [1, 2, 3]
        assert!(!is_newer("1.2.beta", "1.2.3"));
    }

    #[test]
    fn test_is_newer_major_version_bump() {
        assert!(is_newer("2.0.0", "1.99.99"));
    }

    // ── updater script generation (health-check poll loop) ──────────────

    #[test]
    fn test_windows_update_script_uses_poll_loop() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let current_exe = dir.path().join("beads-web.exe");
        let new_binary = dir.path().join("beads-server-new.exe");

        let script_path =
            generate_windows_update_script(dir.path(), &current_exe, &new_binary, 4242, "3008")
                .expect("generate windows script");
        let content = std::fs::read_to_string(&script_path).expect("read windows script");

        // Poll loop present.
        assert!(
            content.contains(":health_loop"),
            "windows script must contain a :health_loop label, got:\n{content}"
        );
        assert!(
            content.contains("if %tries% lss 30"),
            "windows script must retry up to 30 times, got:\n{content}"
        );
        assert!(
            content.contains(":health_ok"),
            "windows script must have a :health_ok success branch, got:\n{content}"
        );
        // Old single-shot pattern (fixed 3s sleep then one check) must be gone.
        assert!(
            !content.contains("timeout /t 3 /nobreak"),
            "windows script must NOT use the old fixed 3s sleep, got:\n{content}"
        );
    }

    #[test]
    fn test_unix_update_script_uses_poll_loop() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let current_exe = dir.path().join("beads-web");
        let new_binary = dir.path().join("beads-server-new");

        let script_path =
            generate_unix_update_script(dir.path(), &current_exe, &new_binary, 4242, "3008")
                .expect("generate unix script");
        let content = std::fs::read_to_string(&script_path).expect("read unix script");

        // Poll loop present.
        assert!(
            content.contains("while [ $i -lt 30 ]"),
            "unix script must poll up to 30 times, got:\n{content}"
        );
        assert!(
            content.contains("healthy=1"),
            "unix script must set a healthy flag on success, got:\n{content}"
        );
        // Old single-shot pattern (fixed `sleep 3` then one check) must be gone.
        assert!(
            !content.contains("\nsleep 3\n"),
            "unix script must NOT use the old fixed `sleep 3`, got:\n{content}"
        );
    }
}
