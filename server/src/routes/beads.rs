//! Beads API route handlers.
//!
//! Provides endpoints for reading and modifying beads from .beads/issues.jsonl files.

use axum::{
    extract::Query,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::validate_path_security;

/// Resolves the correct path to `issues.jsonl` for a project.
///
/// When a project has `sync-branch` set in `.beads/config.yaml`, the canonical
/// JSONL file lives at `.git/beads-worktrees/<branch>/.beads/issues.jsonl`
/// instead of the default `.beads/issues.jsonl`.
///
/// # Fallback behavior
///
/// Returns the default `.beads/issues.jsonl` path when:
/// - No `.beads/config.yaml` exists
/// - The YAML is malformed or cannot be parsed
/// - `sync-branch` is not set, empty, or commented out
/// - The resolved worktree directory does not exist
pub fn resolve_issues_path(project_path: &Path) -> PathBuf {
    let config_path = project_path.join(".beads").join("config.yaml");
    let default_path = project_path.join(".beads").join("issues.jsonl");

    let config_contents = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return default_path,
    };

    let yaml: serde_yaml::Value = match serde_yaml::from_str(&config_contents) {
        Ok(v) => v,
        Err(_) => return default_path,
    };

    let branch = match yaml.get("sync-branch").and_then(|v| v.as_str()) {
        Some(b) if !b.trim().is_empty() => b.trim().to_string(),
        _ => return default_path,
    };

    let worktree_dir = project_path
        .join(".git")
        .join("beads-worktrees")
        .join(&branch);

    if !worktree_dir.exists() {
        return default_path;
    }

    worktree_dir.join(".beads").join("issues.jsonl")
}

/// Query parameters for the beads endpoint.
#[derive(Debug, Deserialize)]
pub struct BeadsParams {
    /// The project path containing .beads/issues.jsonl
    pub path: String,
}

/// A dependency relationship in the JSONL file (old format).
///
/// Old `bd` versions stored dependencies as:
/// ```json
/// "dependencies": [{"depends_on_id":"parent-1", "type":"parent-child"}]
/// ```
#[derive(Debug, Deserialize, Clone)]
struct LegacyDependency {
    depends_on_id: String,
    #[serde(rename = "type")]
    dep_type: String,
}

/// A single bead/issue from the JSONL file.
///
/// Supports both old and new `bd` CLI formats:
/// - **Old**: `dependencies` as array of objects with `depends_on_id` and `type`
/// - **New**: `parent` (string), `dependencies` as array of string IDs, `related` as array of strings
#[derive(Debug, Serialize, Deserialize)]
pub struct Bead {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    pub status: String,
    #[serde(default)]
    pub priority: Option<i32>,
    #[serde(default)]
    pub issue_type: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default, alias = "closedAt")]
    pub closed_at: Option<String>,
    #[serde(default)]
    pub close_reason: Option<String>,
    #[serde(default)]
    pub comments: Option<Vec<Comment>>,
    #[serde(default, alias = "parent")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub children: Option<Vec<String>>,
    #[serde(default, alias = "design")]
    pub design_doc: Option<String>,
    #[serde(default)]
    pub deps: Option<Vec<String>>,
    #[serde(default, alias = "related")]
    pub relates_to: Option<Vec<String>>,
    /// Raw dependencies field — accepts both old (array of objects) and new (array of strings) formats.
    #[serde(default, skip_serializing, deserialize_with = "deserialize_dependencies")]
    dependencies: Option<RawDependencies>,
}

/// Parsed dependencies in either old or new format.
#[derive(Debug, Clone)]
enum RawDependencies {
    /// Old format: array of `{depends_on_id, type}` objects
    Legacy(Vec<LegacyDependency>),
    /// New format: flat array of string IDs (blocking deps)
    StringIds(Vec<String>),
}

/// Custom deserializer that handles both old and new dependency formats.
fn deserialize_dependencies<'de, D>(deserializer: D) -> Result<Option<RawDependencies>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    let arr = match value {
        Some(serde_json::Value::Array(a)) => a,
        Some(serde_json::Value::Null) | None => return Ok(None),
        _ => return Err(serde::de::Error::custom("expected array or null for dependencies")),
    };

    if arr.is_empty() {
        return Ok(None);
    }

    // Check first element to distinguish formats
    if arr[0].is_string() {
        // New format: ["id1", "id2"]
        let ids: Vec<String> = serde_json::from_value(serde_json::Value::Array(arr))
            .map_err(serde::de::Error::custom)?;
        Ok(Some(RawDependencies::StringIds(ids)))
    } else {
        // Old format: [{depends_on_id, type}, ...]
        let deps: Vec<LegacyDependency> = serde_json::from_value(serde_json::Value::Array(arr))
            .map_err(serde::de::Error::custom)?;
        Ok(Some(RawDependencies::Legacy(deps)))
    }
}

/// A comment on a bead.
#[derive(Debug, Serialize, Deserialize)]
pub struct Comment {
    pub id: i64,
    pub issue_id: String,
    pub author: String,
    pub text: String,
    pub created_at: String,
}

/// GET /api/beads?path=/path/to/project
///
/// Reads the .beads/issues.jsonl file from the specified project path
/// and returns an array of beads.
pub async fn read_beads(Query(params): Query<BeadsParams>) -> impl IntoResponse {
    let project_path = PathBuf::from(&params.path);

    // Security: Validate path is within allowed directories
    if let Err(e) = validate_path_security(&project_path) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": e })),
        );
    }

    let issues_path = resolve_issues_path(&project_path);

    // Check if the file exists
    if !issues_path.exists() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "No .beads/issues.jsonl found at the specified path" })),
        );
    }

    // Read the file contents
    let contents = match std::fs::read_to_string(&issues_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to read file: {}", e) })),
            );
        }
    };

    // Parse JSONL (each line is a JSON object)
    let mut beads = Vec::new();
    for (line_num, line) in contents.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<Bead>(line) {
            Ok(bead) => beads.push(bead),
            Err(e) => {
                tracing::warn!(
                    "Failed to parse bead at line {}: {} - {}",
                    line_num + 1,
                    e,
                    line
                );
                // Continue parsing other lines - graceful handling of malformed lines
            }
        }
    }

    // Post-process: Transform dependencies into parent_id, deps, relates_to, and children
    // Build a map of parent_id -> Vec<child_id>
    let mut parent_to_children: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    // First pass: Extract relationships from dependencies (both old and new format)
    for bead in &mut beads {
        if let Some(raw_deps) = bead.dependencies.take() {
            match raw_deps {
                RawDependencies::Legacy(legacy_deps) => {
                    // Old format: extract parent-child, relates-to, and blocking deps
                    let mut blocking = Vec::new();
                    let mut related = Vec::new();
                    for dep in &legacy_deps {
                        match dep.dep_type.as_str() {
                            "parent-child" => {
                                bead.parent_id = Some(dep.depends_on_id.clone());
                                parent_to_children
                                    .entry(dep.depends_on_id.clone())
                                    .or_default()
                                    .push(bead.id.clone());
                            }
                            "relates-to" => {
                                related.push(dep.depends_on_id.clone());
                            }
                            _ => {
                                blocking.push(dep.depends_on_id.clone());
                            }
                        }
                    }
                    if !blocking.is_empty() && bead.deps.is_none() {
                        bead.deps = Some(blocking);
                    }
                    if !related.is_empty() && bead.relates_to.is_none() {
                        bead.relates_to = Some(related);
                    }
                }
                RawDependencies::StringIds(ids) => {
                    // New format: dependencies are blocking deps (parent comes from `parent` field)
                    if !ids.is_empty() && bead.deps.is_none() {
                        bead.deps = Some(ids);
                    }
                }
            }
        }

        // Record parent-child from `parent` field (new format, already deserialized via alias)
        if let Some(parent_id) = &bead.parent_id {
            parent_to_children
                .entry(parent_id.clone())
                .or_default()
                .push(bead.id.clone());
        }
    }

    // Deduplicate parent_to_children entries (in case both old dependencies and parent field set)
    for children in parent_to_children.values_mut() {
        children.sort();
        children.dedup();
    }

    // Second pass: Infer parent-child from ID patterns (e.g., "64n.1" -> parent "64n")
    // This matches how the bd CLI infers relationships when parent_id is not set
    // Collect existing bead IDs first to avoid borrow issues
    let bead_ids: std::collections::HashSet<String> =
        beads.iter().map(|b| b.id.clone()).collect();

    // Collect inferred relationships: (child_id, parent_id)
    let inferred: Vec<(String, String)> = beads
        .iter()
        .filter_map(|bead| {
            // Only infer if parent_id is not already set
            if bead.parent_id.is_some() {
                return None;
            }
            // Check if ID contains a dot (indicating potential child)
            let dot_pos = bead.id.rfind('.')?;
            let potential_parent = &bead.id[..dot_pos];
            // Only infer if the parent exists
            if bead_ids.contains(potential_parent) {
                Some((bead.id.clone(), potential_parent.to_string()))
            } else {
                None
            }
        })
        .collect();

    // Apply inferred relationships
    for (child_id, inferred_parent_id) in &inferred {
        // Set parent_id on the child bead
        if let Some(bead) = beads.iter_mut().find(|b| &b.id == child_id) {
            bead.parent_id = Some(inferred_parent_id.clone());
        }
        // Record in parent_to_children map
        parent_to_children
            .entry(inferred_parent_id.clone())
            .or_default()
            .push(child_id.clone());
    }

    // Third pass: Set children on parent beads
    for bead in &mut beads {
        if let Some(children) = parent_to_children.get(&bead.id) {
            bead.children = Some(children.clone());
        }
    }

    (StatusCode::OK, Json(serde_json::json!({ "beads": beads })))
}

/// Request body for adding a comment to a bead.
#[derive(Debug, Deserialize)]
pub struct AddCommentRequest {
    /// The project path containing .beads/issues.jsonl
    pub path: String,
    /// The ID of the bead to add a comment to
    pub bead_id: String,
    /// The comment text
    pub text: String,
    /// The author of the comment (e.g., email address)
    pub author: String,
}

/// Response for the add comment endpoint.
#[derive(Debug, Serialize)]
pub struct AddCommentResponse {
    pub success: bool,
    pub bead: Option<Bead>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// POST /api/beads/comment
///
/// Adds a comment to a specific bead in the .beads/issues.jsonl file.
pub async fn add_comment(Json(payload): Json<AddCommentRequest>) -> impl IntoResponse {
    let project_path = PathBuf::from(&payload.path);

    // Security: Validate path is within allowed directories
    if let Err(e) = validate_path_security(&project_path) {
        return (
            StatusCode::FORBIDDEN,
            Json(AddCommentResponse {
                success: false,
                bead: None,
                error: Some(e),
            }),
        );
    }

    let issues_path = resolve_issues_path(&project_path);

    // Check if the file exists
    if !issues_path.exists() {
        return (
            StatusCode::NOT_FOUND,
            Json(AddCommentResponse {
                success: false,
                bead: None,
                error: Some("No .beads/issues.jsonl found at the specified path".to_string()),
            }),
        );
    }

    // Read the file contents
    let contents = match std::fs::read_to_string(&issues_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AddCommentResponse {
                    success: false,
                    bead: None,
                    error: Some(format!("Failed to read file: {}", e)),
                }),
            );
        }
    };

    // Parse JSONL and find the target bead
    let mut beads: Vec<Bead> = Vec::new();
    let mut found_bead_index: Option<usize> = None;
    let mut max_comment_id: i64 = 0;

    for (line_num, line) in contents.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<Bead>(line) {
            Ok(bead) => {
                // Track the maximum comment ID across all beads
                if let Some(comments) = &bead.comments {
                    for comment in comments {
                        if comment.id > max_comment_id {
                            max_comment_id = comment.id;
                        }
                    }
                }

                if bead.id == payload.bead_id {
                    found_bead_index = Some(beads.len());
                }
                beads.push(bead);
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to parse bead at line {}: {} - {}",
                    line_num + 1,
                    e,
                    line
                );
                // Continue parsing other lines - graceful handling of malformed lines
            }
        }
    }

    // Check if the bead was found
    let bead_index = match found_bead_index {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(AddCommentResponse {
                    success: false,
                    bead: None,
                    error: Some(format!("Bead with id '{}' not found", payload.bead_id)),
                }),
            );
        }
    };

    // Create the new comment
    let new_comment = Comment {
        id: max_comment_id + 1,
        issue_id: payload.bead_id.clone(),
        author: payload.author,
        text: payload.text,
        created_at: Utc::now().to_rfc3339(),
    };

    // Add the comment to the bead
    let bead = &mut beads[bead_index];
    match &mut bead.comments {
        Some(comments) => comments.push(new_comment),
        None => bead.comments = Some(vec![new_comment]),
    }

    // Write the updated beads back to the file
    let file = match std::fs::File::create(&issues_path) {
        Ok(f) => f,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AddCommentResponse {
                    success: false,
                    bead: None,
                    error: Some(format!("Failed to open file for writing: {}", e)),
                }),
            );
        }
    };

    let mut writer = std::io::BufWriter::new(file);
    for bead in &beads {
        match serde_json::to_string(bead) {
            Ok(json_line) => {
                if let Err(e) = writeln!(writer, "{}", json_line) {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(AddCommentResponse {
                            success: false,
                            bead: None,
                            error: Some(format!("Failed to write to file: {}", e)),
                        }),
                    );
                }
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(AddCommentResponse {
                        success: false,
                        bead: None,
                        error: Some(format!("Failed to serialize bead: {}", e)),
                    }),
                );
            }
        }
    }

    if let Err(e) = writer.flush() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AddCommentResponse {
                success: false,
                bead: None,
                error: Some(format!("Failed to flush file: {}", e)),
            }),
        );
    }

    // Return the updated bead
    let updated_bead = beads.swap_remove(bead_index);
    (
        StatusCode::OK,
        Json(AddCommentResponse {
            success: true,
            bead: Some(updated_bead),
            error: None,
        }),
    )
}

/// Computes the appropriate status for an epic based on its children's statuses.
///
/// State machine:
/// - Any child `in_progress` -> Epic `in_progress`
/// - All children `inreview` OR `closed` (with at least one `inreview`) -> Epic `inreview`
/// - All children `open` -> Epic `open`
/// - Note: We don't auto-close epics - user must close manually
fn compute_epic_status_from_children(child_statuses: &[&str]) -> Option<&'static str> {
    if child_statuses.is_empty() {
        return None;
    }

    // Check if any child is in_progress
    if child_statuses.contains(&"in_progress") {
        return Some("in_progress");
    }

    // Check if all children are either inreview or closed
    let all_inreview_or_closed = child_statuses
        .iter()
        .all(|s| *s == "inreview" || *s == "closed");

    if all_inreview_or_closed {
        return Some("inreview");
    }

    // Check if all children are open
    if child_statuses.iter().all(|s| *s == "open") {
        return Some("open");
    }

    // Mixed state (some open, some closed, no in_progress or inreview)
    // Don't change the epic status
    None
}

/// Recomputes and updates epic statuses based on their children's statuses.
///
/// This function reads the issues.jsonl file, finds all epics with children,
/// computes the appropriate status for each epic based on its children,
/// and writes back the file if any epic status changed.
///
/// # Arguments
///
/// * `issues_path` - Path to the .beads/issues.jsonl file
///
/// # Returns
///
/// * `Ok(Vec<String>)` - List of epic IDs that were updated
/// * `Err(String)` - Error message if something went wrong
pub fn recompute_epic_statuses(issues_path: &Path) -> Result<Vec<String>, String> {
    // Read the file contents
    let contents = std::fs::read_to_string(issues_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Parse JSONL into beads
    let mut beads: Vec<Bead> = Vec::new();
    for (line_num, line) in contents.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<Bead>(line) {
            Ok(bead) => beads.push(bead),
            Err(e) => {
                tracing::warn!(
                    "Failed to parse bead at line {}: {} - {}",
                    line_num + 1,
                    e,
                    line
                );
            }
        }
    }

    // Build parent-child relationships
    // parent_id -> Vec<child_id>
    let mut parent_to_children: HashMap<String, Vec<String>> = HashMap::new();

    // First pass: Extract from explicit dependencies and parent field
    for bead in &mut beads {
        if let Some(RawDependencies::Legacy(legacy_deps)) = bead.dependencies.take() {
            for dep in &legacy_deps {
                if dep.dep_type == "parent-child" {
                    bead.parent_id = Some(dep.depends_on_id.clone());
                    parent_to_children
                        .entry(dep.depends_on_id.clone())
                        .or_default()
                        .push(bead.id.clone());
                }
            }
        }

        // Record parent-child from `parent` field (new format)
        if let Some(parent_id) = &bead.parent_id {
            let children = parent_to_children.entry(parent_id.clone()).or_default();
            if !children.contains(&bead.id) {
                children.push(bead.id.clone());
            }
        }
    }

    // Second pass: Infer parent-child from ID patterns (e.g., "64n.1" -> parent "64n")
    // This matches how the bd CLI infers relationships when parent_id is not set
    let bead_ids: std::collections::HashSet<String> =
        beads.iter().map(|b| b.id.clone()).collect();

    for bead in &beads {
        // Only infer if not already in parent_to_children
        if bead.parent_id.is_none() && bead.id.contains('.') {
            if let Some(dot_pos) = bead.id.rfind('.') {
                let potential_parent = &bead.id[..dot_pos];
                // Only infer if parent exists and not already recorded
                if bead_ids.contains(potential_parent) {
                    let children = parent_to_children
                        .entry(potential_parent.to_string())
                        .or_default();
                    if !children.contains(&bead.id) {
                        children.push(bead.id.clone());
                    }
                }
            }
        }
    }

    // Build a map of bead_id -> status for quick lookup (owned strings to avoid borrow issues)
    let status_map: HashMap<String, String> = beads
        .iter()
        .map(|b| (b.id.clone(), b.status.clone()))
        .collect();

    // First pass: find which epics need updates
    let mut epic_updates: Vec<(String, String)> = Vec::new();

    for bead in &beads {
        // Only process epics
        if bead.issue_type.as_deref() != Some("epic") {
            continue;
        }

        // Skip closed epics - don't auto-reopen them
        if bead.status == "closed" {
            continue;
        }

        // Get children for this epic
        let children = match parent_to_children.get(&bead.id) {
            Some(c) => c,
            None => continue, // No children, skip
        };

        // Collect child statuses
        let child_statuses: Vec<&str> = children
            .iter()
            .filter_map(|child_id| status_map.get(child_id).map(String::as_str))
            .collect();

        // Compute the new status
        if let Some(new_status) = compute_epic_status_from_children(&child_statuses) {
            if bead.status != new_status {
                epic_updates.push((bead.id.clone(), new_status.to_string()));
            }
        }
    }

    // Second pass: apply updates
    let mut updated_epic_ids: Vec<String> = Vec::new();

    for (epic_id, new_status) in &epic_updates {
        for bead in &mut beads {
            if &bead.id == epic_id {
                tracing::info!(
                    "Updating epic {} status from {} to {}",
                    bead.id,
                    bead.status,
                    new_status
                );
                bead.status = new_status.clone();
                bead.updated_at = Some(Utc::now().to_rfc3339());
                updated_epic_ids.push(bead.id.clone());
                break;
            }
        }
    }

    // Write back if any epic was updated
    if !updated_epic_ids.is_empty() {
        let file = std::fs::File::create(issues_path)
            .map_err(|e| format!("Failed to open file for writing: {}", e))?;

        let mut writer = std::io::BufWriter::new(file);
        for bead in &beads {
            let json_line = serde_json::to_string(bead)
                .map_err(|e| format!("Failed to serialize bead: {}", e))?;
            writeln!(writer, "{}", json_line)
                .map_err(|e| format!("Failed to write to file: {}", e))?;
        }
        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {}", e))?;
    }

    Ok(updated_epic_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bead() {
        let json = r#"{"id":"test-123","title":"Test Bead","status":"open","priority":2}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert_eq!(bead.id, "test-123");
        assert_eq!(bead.title, "Test Bead");
        assert_eq!(bead.status, "open");
        assert_eq!(bead.priority, Some(2));
    }

    #[test]
    fn test_parse_bead_with_comments() {
        let json = r#"{"id":"test-456","title":"With Comments","status":"closed","comments":[{"id":1,"issue_id":"test-456","author":"user","text":"A comment","created_at":"2026-01-01T00:00:00Z"}]}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert_eq!(bead.comments.as_ref().unwrap().len(), 1);
        assert_eq!(bead.comments.as_ref().unwrap()[0].text, "A comment");
    }

    #[test]
    fn test_parse_bead_with_design_field() {
        // Test that alias "design" works
        let json = r#"{"id":"test-789","title":"With Design","status":"open","design":"path/to/design.md"}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert_eq!(bead.design_doc, Some("path/to/design.md".to_string()));
    }

    #[test]
    fn test_parse_bead_with_design_doc_field() {
        // Test that original "design_doc" still works
        let json = r#"{"id":"test-790","title":"With Design Doc","status":"open","design_doc":"path/to/design2.md"}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert_eq!(bead.design_doc, Some("path/to/design2.md".to_string()));
    }

    #[test]
    fn test_compute_epic_status_any_in_progress() {
        // Any child in_progress -> Epic in_progress
        let statuses = vec!["open", "in_progress", "closed"];
        assert_eq!(
            compute_epic_status_from_children(&statuses),
            Some("in_progress")
        );
    }

    #[test]
    fn test_compute_epic_status_all_open() {
        // All children open -> Epic open
        let statuses = vec!["open", "open", "open"];
        assert_eq!(compute_epic_status_from_children(&statuses), Some("open"));
    }

    #[test]
    fn test_compute_epic_status_all_inreview_or_closed_with_inreview() {
        // All children inreview or closed (with at least one inreview) -> Epic inreview
        let statuses = vec!["inreview", "closed", "inreview"];
        assert_eq!(
            compute_epic_status_from_children(&statuses),
            Some("inreview")
        );
    }

    #[test]
    fn test_compute_epic_status_all_closed() {
        // All children closed -> Epic should be inreview (ready for final review)
        let statuses = vec!["closed", "closed"];
        assert_eq!(compute_epic_status_from_children(&statuses), Some("inreview"));
    }

    #[test]
    fn test_compute_epic_status_mixed_open_closed() {
        // Mixed open and closed (no in_progress or inreview) -> No change
        let statuses = vec!["open", "closed"];
        assert_eq!(compute_epic_status_from_children(&statuses), None);
    }

    #[test]
    fn test_compute_epic_status_empty() {
        // No children -> No change
        let statuses: Vec<&str> = vec![];
        assert_eq!(compute_epic_status_from_children(&statuses), None);
    }

    #[test]
    fn test_compute_epic_status_single_in_progress() {
        let statuses = vec!["in_progress"];
        assert_eq!(
            compute_epic_status_from_children(&statuses),
            Some("in_progress")
        );
    }

    #[test]
    fn test_compute_epic_status_single_inreview() {
        let statuses = vec!["inreview"];
        assert_eq!(
            compute_epic_status_from_children(&statuses),
            Some("inreview")
        );
    }

    #[test]
    fn test_infer_parent_from_id_pattern() {
        // Test the ID pattern inference logic
        // Bead "64n.1" should be inferred as child of "64n" if parent exists
        let bead_id = "64n.1";
        let dot_pos = bead_id.rfind('.');
        assert!(dot_pos.is_some());
        let parent_id = &bead_id[..dot_pos.unwrap()];
        assert_eq!(parent_id, "64n");
    }

    #[test]
    fn test_infer_parent_multiple_dots() {
        // Test that we extract the correct parent when ID has multiple dots
        // Bead "prefix.64n.1" should have parent "prefix.64n"
        let bead_id = "prefix.64n.1";
        let dot_pos = bead_id.rfind('.');
        assert!(dot_pos.is_some());
        let parent_id = &bead_id[..dot_pos.unwrap()];
        assert_eq!(parent_id, "prefix.64n");
    }

    #[test]
    fn test_no_inference_without_dot() {
        // Bead without dot should not have inferred parent
        let bead_id = "simple-id";
        let dot_pos = bead_id.rfind('.');
        assert!(dot_pos.is_none());
    }

    #[test]
    fn test_parse_old_format_dependencies() {
        // Old format: dependencies as array of objects
        let json = r#"{"id":"bead-a","title":"Bead A","status":"open","dependencies":[{"issue_id":"bead-a","depends_on_id":"bead-b","type":"relates-to","created_at":"2026-01-27T00:00:00Z","created_by":"user"},{"issue_id":"bead-a","depends_on_id":"bead-c","type":"parent-child","created_at":"2026-01-27T00:00:00Z","created_by":"user"}]}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert!(bead.dependencies.is_some());
        if let Some(RawDependencies::Legacy(deps)) = &bead.dependencies {
            assert_eq!(deps.len(), 2);
            assert_eq!(deps[0].dep_type, "relates-to");
            assert_eq!(deps[0].depends_on_id, "bead-b");
            assert_eq!(deps[1].dep_type, "parent-child");
        } else {
            panic!("Expected Legacy dependencies");
        }
    }

    #[test]
    fn test_parse_new_format_dependencies() {
        // New format: dependencies as array of strings
        let json = r#"{"id":"task-71","title":"New Task","status":"open","parent":"epic-65","dependencies":["task-67"],"related":["task-35"]}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        // parent field should be deserialized into parent_id
        assert_eq!(bead.parent_id, Some("epic-65".to_string()));
        // related field should be deserialized into relates_to
        assert_eq!(bead.relates_to, Some(vec!["task-35".to_string()]));
        // dependencies should be parsed as StringIds
        if let Some(RawDependencies::StringIds(ids)) = &bead.dependencies {
            assert_eq!(ids, &vec!["task-67".to_string()]);
        } else {
            panic!("Expected StringIds dependencies");
        }
    }

    #[test]
    fn test_parse_new_format_closed_at_camel_case() {
        // New format uses closedAt instead of closed_at
        let json = r#"{"id":"task-67","title":"Done","status":"closed","closedAt":"2026-02-28T12:53:27.963Z"}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert_eq!(bead.closed_at, Some("2026-02-28T12:53:27.963Z".to_string()));
    }

    #[test]
    fn test_parse_empty_dependencies_array() {
        // Empty dependencies array should parse as None
        let json = r#"{"id":"task-1","title":"No deps","status":"open","dependencies":[]}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert!(bead.dependencies.is_none());
    }

    #[test]
    fn test_parse_no_dependencies_field() {
        // Missing dependencies field should parse fine
        let json = r#"{"id":"task-2","title":"Simple","status":"open"}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert!(bead.dependencies.is_none());
    }

    #[test]
    fn test_relates_to_serialized_in_json() {
        // Test that relates_to is included in serialized JSON output
        // (unlike dependencies which has skip_serializing)
        let bead = Bead {
            id: "bead-s".to_string(),
            title: "Serialization Test".to_string(),
            description: None,
            status: "open".to_string(),
            priority: None,
            issue_type: None,
            owner: None,
            created_at: None,
            created_by: None,
            updated_at: None,
            closed_at: None,
            close_reason: None,
            comments: None,
            parent_id: None,
            children: None,
            design_doc: None,
            deps: None,
            relates_to: Some(vec!["bead-r1".to_string(), "bead-r2".to_string()]),
            dependencies: None,
        };

        let json = serde_json::to_string(&bead).unwrap();

        // relates_to SHOULD be serialized
        assert!(json.contains("relates_to"));
        assert!(json.contains("bead-r1"));
        assert!(json.contains("bead-r2"));

        // dependencies should NOT be serialized (skip_serializing)
        assert!(!json.contains("dependencies"));
    }

    #[test]
    fn test_parse_real_new_format_line() {
        // Real line from updated bd CLI
        let json = r#"{"id":"ai-photo-factory-71","title":"Миграция лендинга","description":"Описание задачи","status":"open","priority":2,"issue_type":"task","owner":"user@email.com","created_at":"2026-02-28T11:30:26.430Z","created_by":"weselow","updated_at":"2026-02-28T11:30:26.430Z","parent":"ai-photo-factory-65","dependencies":["ai-photo-factory-67"]}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert_eq!(bead.id, "ai-photo-factory-71");
        assert_eq!(bead.parent_id, Some("ai-photo-factory-65".to_string()));
        if let Some(RawDependencies::StringIds(ids)) = &bead.dependencies {
            assert_eq!(ids, &vec!["ai-photo-factory-67".to_string()]);
        } else {
            panic!("Expected StringIds dependencies");
        }
    }

    #[test]
    fn test_parse_new_format_with_related() {
        // New format with related field
        let json = r#"{"id":"task-75","title":"Post-processing","status":"open","parent":"epic-65","dependencies":["task-66"],"related":["task-35"]}"#;
        let bead: Bead = serde_json::from_str(json).unwrap();
        assert_eq!(bead.relates_to, Some(vec!["task-35".to_string()]));
        assert_eq!(bead.parent_id, Some("epic-65".to_string()));
    }

    // ── resolve_issues_path tests ──────────────────────────────────────

    #[test]
    fn test_resolve_no_config_file() {
        // When .beads/config.yaml does not exist, fall back to default
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        std::fs::create_dir_all(project.join(".beads")).unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_empty_config_file() {
        // Empty config file -> default path
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(beads_dir.join("config.yaml"), "").unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_commented_out_sync_branch() {
        // sync-branch is commented out -> default path
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "# sync-branch: \"beads-sync\"\n",
        )
        .unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_valid_sync_branch() {
        // Valid sync-branch with existing worktree dir -> sync path
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();

        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "sync-branch: \"beads-sync\"\n",
        )
        .unwrap();

        // Create the worktree directory
        let worktree_beads = project
            .join(".git")
            .join("beads-worktrees")
            .join("beads-sync")
            .join(".beads");
        std::fs::create_dir_all(&worktree_beads).unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, worktree_beads.join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_malformed_yaml() {
        // Malformed YAML -> default path
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "sync-branch: [invalid: yaml: {{\n",
        )
        .unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_worktree_dir_missing() {
        // sync-branch set but worktree directory does not exist -> default
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "sync-branch: \"nonexistent-branch\"\n",
        )
        .unwrap();
        // Do NOT create .git/beads-worktrees/nonexistent-branch

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_spaces_in_branch_name() {
        // Branch name with spaces (unusual but valid YAML string)
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "sync-branch: \"my branch\"\n",
        )
        .unwrap();

        let worktree_dir = project
            .join(".git")
            .join("beads-worktrees")
            .join("my branch");
        std::fs::create_dir_all(&worktree_dir).unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(
            result,
            worktree_dir.join(".beads").join("issues.jsonl")
        );
    }

    #[test]
    fn test_resolve_empty_string_sync_branch() {
        // sync-branch set to empty string -> default path
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "sync-branch: \"\"\n",
        )
        .unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_sync_branch_without_quotes() {
        // YAML allows unquoted strings
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "sync-branch: beads-sync\n",
        )
        .unwrap();

        let worktree_beads = project
            .join(".git")
            .join("beads-worktrees")
            .join("beads-sync")
            .join(".beads");
        std::fs::create_dir_all(&worktree_beads).unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, worktree_beads.join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_sync_branch_with_other_keys() {
        // Config has other keys alongside sync-branch
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "issue-prefix: myproject\nsync-branch: beads-sync\nno-db: true\n",
        )
        .unwrap();

        let worktree_beads = project
            .join(".git")
            .join("beads-worktrees")
            .join("beads-sync")
            .join(".beads");
        std::fs::create_dir_all(&worktree_beads).unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, worktree_beads.join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_sync_branch_null_value() {
        // sync-branch set to YAML null -> default path
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "sync-branch: null\n",
        )
        .unwrap();

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }

    #[test]
    fn test_resolve_no_beads_dir() {
        // No .beads directory at all -> default path (read fails gracefully)
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        // Do NOT create .beads/

        let result = resolve_issues_path(project);
        assert_eq!(result, project.join(".beads").join("issues.jsonl"));
    }
}
