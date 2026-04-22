//! Project and Tag REST API routes
//!
//! Provides CRUD endpoints for projects, tags, and project-tag relationships.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db::{
    CachedCounts, CreateProjectInput, CreateTagInput, Database, DbError, ProjectTagInput,
    ProjectWithTags, Tag, UpdateProjectInput,
};

/// Application state containing the database
pub type AppState = Arc<Database>;

/// Error response structure
#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// Success response structure for operations that don't return data
#[derive(Serialize)]
pub struct SuccessResponse {
    pub success: bool,
}

impl DbError {
    fn status_code(&self) -> StatusCode {
        match self {
            DbError::ProjectNotFound(_) | DbError::TagNotFound(_) => StatusCode::NOT_FOUND,
            DbError::Sqlite(_) | DbError::PathError => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

fn db_error_response(err: DbError) -> (StatusCode, Json<ErrorResponse>) {
    let status = err.status_code();
    (
        status,
        Json(ErrorResponse {
            error: err.to_string(),
        }),
    )
}

// ===== Project Routes =====

/// Query parameters for listing projects
#[derive(Deserialize)]
pub struct ListProjectsParams {
    pub include_archived: Option<bool>,
}

/// A project list entry — `ProjectWithTags` flattened with the cached
/// bead counts attached. The `cachedCounts` field is `null` until
/// `/api/beads` has been called for the project at least once.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWithTagsAndCounts {
    #[serde(flatten)]
    pub project: ProjectWithTags,
    pub cached_counts: Option<CachedCounts>,
}

/// GET /api/projects - List all projects with their tags and cached bead counts
pub async fn list_projects(
    State(db): State<AppState>,
    Query(params): Query<ListProjectsParams>,
) -> Result<Json<Vec<ProjectWithTagsAndCounts>>, (StatusCode, Json<ErrorResponse>)> {
    let include_archived = params.include_archived.unwrap_or(false);
    let mut projects = db.get_projects_with_tags_filtered(include_archived).map_err(db_error_response)?;
    // Normalize Windows backslashes in paths for consistent frontend behavior
    for p in &mut projects {
        p.path = p.path.replace('\\', "/");
        if let Some(ref lp) = p.local_path {
            p.local_path = Some(lp.replace('\\', "/"));
        }
    }

    let mut result = Vec::with_capacity(projects.len());
    for project in projects {
        // Cache reads are best-effort — log and fall back to None on error
        // so a single corrupt row can't block the whole projects list.
        let cached_counts = match db.get_cached_counts(&project.id) {
            Ok(counts) => counts,
            Err(e) => {
                tracing::warn!(
                    "Failed to read cached counts for project {}: {}",
                    project.id,
                    e
                );
                None
            }
        };
        result.push(ProjectWithTagsAndCounts {
            project,
            cached_counts,
        });
    }

    Ok(Json(result))
}

/// POST /api/projects - Create a new project
pub async fn create_project(
    State(db): State<AppState>,
    Json(input): Json<CreateProjectInput>,
) -> Result<(StatusCode, Json<ProjectWithTags>), (StatusCode, Json<ErrorResponse>)> {
    let project = db.create_project(input).map_err(db_error_response)?;

    // Return project with empty tags array
    let project_with_tags = ProjectWithTags {
        id: project.id,
        name: project.name,
        path: project.path,
        local_path: project.local_path,
        tags: vec![],
        last_opened: project.last_opened,
        created_at: project.created_at,
        archived_at: project.archived_at,
    };

    Ok((StatusCode::CREATED, Json(project_with_tags)))
}

/// PATCH /api/projects/:id - Update a project
pub async fn update_project(
    State(db): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateProjectInput>,
) -> Result<Json<ProjectWithTags>, (StatusCode, Json<ErrorResponse>)> {
    let project = db.update_project(&id, input).map_err(db_error_response)?;
    let tags = db.get_project_tags(&id).map_err(db_error_response)?;

    Ok(Json(ProjectWithTags {
        id: project.id,
        name: project.name,
        path: project.path,
        local_path: project.local_path,
        tags,
        last_opened: project.last_opened,
        created_at: project.created_at,
        archived_at: project.archived_at,
    }))
}

/// DELETE /api/projects/:id - Delete a project
pub async fn delete_project(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    db.delete_project(&id).map_err(db_error_response)?;
    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/projects/:id/archive - Archive a project
pub async fn archive_project(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    db.archive_project(&id).map_err(db_error_response)?;
    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/projects/:id/unarchive - Unarchive a project
pub async fn unarchive_project(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    db.unarchive_project(&id).map_err(db_error_response)?;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Tag Routes =====

/// GET /api/tags - List all tags
pub async fn list_tags(
    State(db): State<AppState>,
) -> Result<Json<Vec<Tag>>, (StatusCode, Json<ErrorResponse>)> {
    db.get_tags().map(Json).map_err(db_error_response)
}

/// POST /api/tags - Create a new tag
pub async fn create_tag(
    State(db): State<AppState>,
    Json(input): Json<CreateTagInput>,
) -> Result<(StatusCode, Json<Tag>), (StatusCode, Json<ErrorResponse>)> {
    let tag = db.create_tag(input).map_err(db_error_response)?;
    Ok((StatusCode::CREATED, Json(tag)))
}

/// DELETE /api/tags/:id - Delete a tag
pub async fn delete_tag(
    State(db): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    db.delete_tag(&id).map_err(db_error_response)?;
    Ok(StatusCode::NO_CONTENT)
}

// ===== Project-Tag Relationship Routes =====

/// POST /api/project-tags - Add a tag to a project
pub async fn add_project_tag(
    State(db): State<AppState>,
    Json(input): Json<ProjectTagInput>,
) -> Result<(StatusCode, Json<SuccessResponse>), (StatusCode, Json<ErrorResponse>)> {
    db.add_tag_to_project(&input.project_id, &input.tag_id)
        .map_err(db_error_response)?;
    Ok((StatusCode::CREATED, Json(SuccessResponse { success: true })))
}

/// DELETE /api/project-tags/:project_id/:tag_id - Remove a tag from a project
pub async fn remove_project_tag(
    State(db): State<AppState>,
    Path((project_id, tag_id)): Path<(String, String)>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    db.remove_tag_from_project(&project_id, &tag_id)
        .map_err(db_error_response)?;
    Ok(Json(SuccessResponse { success: true }))
}

/// Creates the project/tag router with all routes
pub fn project_routes() -> axum::Router<AppState> {
    use axum::routing::{delete, get, patch, post};

    axum::Router::new()
        // Project routes
        .route("/projects", get(list_projects).post(create_project))
        .route(
            "/projects/:id",
            patch(update_project).delete(delete_project),
        )
        .route("/projects/:id/archive", patch(archive_project))
        .route("/projects/:id/unarchive", patch(unarchive_project))
        // Tag routes
        .route("/tags", get(list_tags).post(create_tag))
        .route("/tags/:id", delete(delete_tag))
        // Project-tag relationship routes
        .route("/project-tags", post(add_project_tag))
        .route("/project-tags/:project_id/:tag_id", delete(remove_project_tag))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_project_with_tags() -> ProjectWithTags {
        ProjectWithTags {
            id: "proj-1".to_string(),
            name: "Sample".to_string(),
            path: "/sample".to_string(),
            local_path: None,
            tags: vec![],
            last_opened: "2026-04-22T10:00:00Z".to_string(),
            created_at: "2026-04-22T09:00:00Z".to_string(),
            archived_at: None,
        }
    }

    #[test]
    fn test_project_with_counts_serializes_camel_case_and_flattens() {
        let entry = ProjectWithTagsAndCounts {
            project: make_project_with_tags(),
            cached_counts: Some(CachedCounts {
                open: 3,
                in_progress: 1,
                inreview: 0,
                closed: 2,
                data_source: Some("cli".to_string()),
                updated_at: "2026-04-22T10:00:00Z".to_string(),
            }),
        };
        let json = serde_json::to_string(&entry).unwrap();

        // Flattened fields preserve ProjectWithTags' camelCase rename
        assert!(json.contains("\"lastOpened\":\"2026-04-22T10:00:00Z\""));
        assert!(json.contains("\"createdAt\":\"2026-04-22T09:00:00Z\""));
        assert!(json.contains("\"localPath\":null"));
        assert!(json.contains("\"archivedAt\":null"));

        // cachedCounts wrapper is camelCase
        assert!(json.contains("\"cachedCounts\":{"));
        // CachedCounts inner fields are camelCase
        assert!(json.contains("\"inProgress\":1"));
        assert!(json.contains("\"dataSource\":\"cli\""));
        assert!(json.contains("\"updatedAt\":\"2026-04-22T10:00:00Z\""));
        // No snake_case leaks
        assert!(!json.contains("\"in_progress\""));
        assert!(!json.contains("\"data_source\""));
        assert!(!json.contains("\"cached_counts\""));
    }

    #[test]
    fn test_project_with_counts_serializes_null_when_no_cache() {
        let entry = ProjectWithTagsAndCounts {
            project: make_project_with_tags(),
            cached_counts: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"cachedCounts\":null"));
    }
}
