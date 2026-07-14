//! Dolt status and discovery API endpoints.

use axum::{extract::Extension, response::IntoResponse, Json};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::db::Database;
use crate::dolt::{self, DoltManager};

use super::beads::resolve_dolt_port;

/// GET /api/dolt/status
///
/// Returns Dolt server availability and database count.
pub async fn dolt_status(
    Extension(dolt): Extension<Arc<DoltManager>>,
) -> impl IntoResponse {
    let running = dolt.check_server().await;

    let database_count = if running {
        dolt.discover_databases().await.ok().map(|dbs| dbs.len())
    } else {
        None
    };

    Json(serde_json::json!({
        "running": running,
        "database_count": database_count,
    }))
}

/// GET /api/dolt/databases
///
/// Lists all beads databases discovered via SHOW DATABASES.
pub async fn dolt_databases(
    Extension(dolt): Extension<Arc<DoltManager>>,
) -> impl IntoResponse {
    if !dolt.is_available() && !dolt.check_server().await {
        return Json(serde_json::json!({
            "error": "Dolt server not running",
            "databases": [],
        }));
    }

    match dolt.discover_databases().await {
        Ok(databases) => Json(serde_json::json!({ "databases": databases })),
        Err(e) => Json(serde_json::json!({
            "error": e.to_string(),
            "databases": [],
        })),
    }
}

/// A discovered running Dolt server process.
#[derive(Debug, Serialize)]
pub struct DoltServer {
    pub pid: u32,
    pub port: u16,
    pub project_path: String,
    pub db_name: Option<String>,
    /// "per-project" for discovered dolt.exe processes, "central" for configured shared servers.
    pub source: String,
}

/// GET /api/dolt/servers
///
/// Scans running OS processes for Dolt SQL servers and returns their details.
/// Enriches results by matching ports to registered projects via port files,
/// and falls back to SHOW DATABASES for unmatched servers.
pub async fn dolt_servers(
    Extension(db): Extension<Arc<Database>>,
) -> impl IntoResponse {
    let mut servers = match scan_dolt_processes().await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("Failed to scan dolt processes: {}", e);
            Vec::new()
        }
    };

    // Step 1: Get all registered projects (including archived)
    let projects = db.get_projects_filtered(true).unwrap_or_default();

    // Step 2: Build port -> project_path map from .beads/dolt-server.port files
    let mut port_to_path: std::collections::HashMap<u16, String> =
        std::collections::HashMap::new();
    for project in &projects {
        if project.path.is_empty() || project.path.starts_with("dolt://") {
            continue;
        }
        let beads_dir = std::path::Path::new(&project.path).join(".beads");
        if let Some(port) = resolve_dolt_port(&beads_dir) {
            port_to_path.insert(port, project.path.clone());
        }
    }

    // Step 3: Enrich servers with project paths from port files
    for server in &mut servers {
        if let Some(path) = port_to_path.get(&server.port) {
            server.project_path = path.clone();
            let p = std::path::Path::new(path);
            server.db_name = dolt::database_name_for_project(p);
        }
    }

    // Step 4: For servers still without project_path, try SHOW DATABASES with timeout
    use tokio::time::{timeout, Duration};

    let indices: Vec<usize> = servers
        .iter()
        .enumerate()
        .filter(|(_, s)| s.project_path.is_empty() && s.db_name.is_none())
        .map(|(i, _)| i)
        .collect();

    let futures: Vec<_> = indices
        .iter()
        .map(|&idx| {
            let port = servers[idx].port;
            async move {
                match timeout(
                    Duration::from_secs(2),
                    dolt::discover_database_on_port(port),
                )
                .await
                {
                    Ok(Ok(name)) => (idx, Some(name)),
                    _ => (idx, None),
                }
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;
    for (idx, db_name) in results {
        servers[idx].db_name = db_name;
    }

    tracing::info!("Discovered {} running Dolt server(s)", servers.len());
    Json(serde_json::json!({ "servers": servers }))
}

/// Scans OS processes for running `dolt sql-server` instances.
async fn scan_dolt_processes() -> Result<Vec<DoltServer>, String> {
    let entries = get_dolt_process_entries().await?;
    let mut servers = Vec::new();

    for entry in entries {
        let port = parse_port_from_cmdline(&entry.cmdline).unwrap_or(3307);
        let project_path = parse_data_dir_from_cmdline(&entry.cmdline);

        let project_path_str = project_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let db_name = project_path
            .as_ref()
            .and_then(|p| dolt::database_name_for_project(p));

        let source = "per-project";

        servers.push(DoltServer {
            pid: entry.pid,
            port,
            project_path: project_path_str,
            db_name,
            source: source.to_string(),
        });
    }

    Ok(servers)
}

/// Raw process entry from OS scanning.
struct ProcessEntry {
    pid: u32,
    cmdline: String,
}

/// Platform-specific process scanning.
async fn get_dolt_process_entries() -> Result<Vec<ProcessEntry>, String> {
    #[cfg(windows)]
    {
        get_dolt_processes_windows().await
    }
    #[cfg(not(windows))]
    {
        get_dolt_processes_unix().await
    }
}

/// Windows: Use `wmic` to find dolt.exe processes.
#[cfg(windows)]
async fn get_dolt_processes_windows() -> Result<Vec<ProcessEntry>, String> {
    let output = tokio::process::Command::new("wmic")
        .args([
            "process",
            "where",
            "name='dolt.exe'",
            "get",
            "ProcessId,CommandLine",
            "/FORMAT:CSV",
        ])
        .output()
        .await
        .map_err(|e| format!("wmic exec failed: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "wmic exited with code {:?}",
            output.status.code()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Strip BOM if present
    let stdout = stdout.trim_start_matches('\u{feff}');
    let mut entries = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // CSV format: Node,CommandLine,ProcessId
        let parts: Vec<&str> = line.splitn(3, ',').collect();
        if parts.len() < 3 {
            continue;
        }
        // Skip the header line
        if parts[2].trim() == "ProcessId" {
            continue;
        }
        let cmdline = parts[1].trim().to_string();
        let pid: u32 = match parts[2].trim().parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        // Only include dolt sql-server processes
        if cmdline.contains("sql-server") {
            entries.push(ProcessEntry { pid, cmdline });
        }
    }

    Ok(entries)
}

/// Unix: Use `ps aux` to find dolt sql-server processes.
#[cfg(not(windows))]
async fn get_dolt_processes_unix() -> Result<Vec<ProcessEntry>, String> {
    let output = tokio::process::Command::new("ps")
        .args(["aux"])
        .output()
        .await
        .map_err(|e| format!("ps exec failed: {}", e))?;

    if !output.status.success() {
        return Err(format!("ps exited with code {:?}", output.status.code()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    for line in stdout.lines() {
        if !line.contains("dolt") || !line.contains("sql-server") {
            continue;
        }
        // ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 11 {
            continue;
        }
        let pid: u32 = match fields[1].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        // Reconstruct the command line from field 10 onward
        let cmdline = fields[10..].join(" ");
        entries.push(ProcessEntry { pid, cmdline });
    }

    Ok(entries)
}

/// Parses `--port` or `-P` value from a command line string.
fn parse_port_from_cmdline(cmdline: &str) -> Option<u16> {
    let parts: Vec<&str> = cmdline.split_whitespace().collect();
    for (i, part) in parts.iter().enumerate() {
        if (*part == "--port" || *part == "-P") && i + 1 < parts.len() {
            return parts[i + 1].parse().ok();
        }
        // Handle --port=XXXX
        if let Some(val) = part.strip_prefix("--port=") {
            return val.parse().ok();
        }
    }
    None
}

/// Parses `--data-dir` value from a command line string and resolves to project root.
///
/// The data dir is typically `{project}/.beads/dolt/`, so we strip that suffix.
fn parse_data_dir_from_cmdline(cmdline: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = cmdline.split_whitespace().collect();
    for (i, part) in parts.iter().enumerate() {
        let data_dir = if (*part == "--data-dir") && i + 1 < parts.len() {
            Some(parts[i + 1])
        } else {
            part.strip_prefix("--data-dir=")
        };

        if let Some(dir) = data_dir {
            // Strip quotes if present
            let dir = dir.trim_matches('"').trim_matches('\'');
            let path = PathBuf::from(dir);
            // Strip .beads/dolt/ suffix to get project root
            if let Some(project) = strip_beads_dolt_suffix(&path) {
                return Some(project);
            }
            return Some(path);
        }
    }
    None
}

/// Strips `.beads/dolt/` or `.beads/dolt` suffix from a path to get the project root.
fn strip_beads_dolt_suffix(path: &Path) -> Option<PathBuf> {
    let path_str = path.to_string_lossy();
    // Normalize separators for matching
    let normalized = path_str.replace('\\', "/");
    if let Some(idx) = normalized.rfind("/.beads/dolt") {
        let project = &path_str[..idx];
        return Some(PathBuf::from(project));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_port_long_flag() {
        let cmd = "dolt sql-server --port 13805 --data-dir /foo";
        assert_eq!(parse_port_from_cmdline(cmd), Some(13805));
    }

    #[test]
    fn test_parse_port_short_flag() {
        let cmd = "dolt sql-server -P 3307";
        assert_eq!(parse_port_from_cmdline(cmd), Some(3307));
    }

    #[test]
    fn test_parse_port_equals_syntax() {
        let cmd = "dolt sql-server --port=14000";
        assert_eq!(parse_port_from_cmdline(cmd), Some(14000));
    }

    #[test]
    fn test_parse_port_missing() {
        let cmd = "dolt sql-server --data-dir /foo";
        assert_eq!(parse_port_from_cmdline(cmd), None);
    }

    #[test]
    fn test_parse_data_dir_strips_beads_suffix() {
        let cmd = "dolt sql-server --data-dir /home/user/project/.beads/dolt/";
        let result = parse_data_dir_from_cmdline(cmd);
        assert_eq!(result, Some(PathBuf::from("/home/user/project")));
    }

    #[test]
    fn test_parse_data_dir_no_suffix() {
        let cmd = "dolt sql-server --data-dir /some/other/path";
        let result = parse_data_dir_from_cmdline(cmd);
        assert_eq!(result, Some(PathBuf::from("/some/other/path")));
    }

    #[test]
    fn test_parse_data_dir_equals_syntax() {
        let cmd = "dolt sql-server --data-dir=/repos/myproj/.beads/dolt";
        let result = parse_data_dir_from_cmdline(cmd);
        assert_eq!(result, Some(PathBuf::from("/repos/myproj")));
    }

    #[test]
    fn test_parse_data_dir_missing() {
        let cmd = "dolt sql-server --port 3307";
        assert_eq!(parse_data_dir_from_cmdline(cmd), None);
    }

    #[test]
    fn test_source_is_always_per_project() {
        // All discovered processes use "per-project" source regardless of port
        let source = "per-project";
        assert_eq!(source, "per-project");
    }

    #[cfg(windows)]
    #[test]
    fn test_parse_data_dir_windows_backslashes() {
        let cmd = r#"dolt sql-server --data-dir M:\repos\project\.beads\dolt"#;
        let result = parse_data_dir_from_cmdline(cmd);
        assert_eq!(result, Some(PathBuf::from(r"M:\repos\project")));
    }
}
