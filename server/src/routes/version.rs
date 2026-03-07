//! Version check route handlers.
//!
//! Checks GitHub Releases for newer versions and caches the result.

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

/// Current version compiled into the binary.
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// GitHub repository for release checks.
const GITHUB_REPO: &str = "weselow/beads-web";

/// Cache duration in seconds (1 hour).
const CACHE_TTL_SECS: u64 = 3600;

/// Cached version check result.
#[derive(Clone)]
pub(crate) struct CachedCheck {
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
}

/// Minimal GitHub release response.
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
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

    VersionCheckResponse {
        current: CURRENT_VERSION.to_string(),
        latest: Some(latest_version),
        update_available,
        download_url: Some(release.html_url),
        release_notes: release.body.map(|b| {
            if b.len() > 500 {
                format!("{}…", &b[..500])
            } else {
                b
            }
        }),
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
    }
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
}
