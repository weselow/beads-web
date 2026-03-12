//! Project and Tag REST API routes
//!
//! Provides CRUD endpoints for projects, tags, and project-tag relationships.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use std::sync::Arc;

use crate::db::{
    CreateProjectInput, CreateTagInput, Database, DbError, ProjectTagInput, ProjectWithTags, Tag,
    UpdateProjectInput,
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

/// GET /api/projects - List all projects with their tags
pub async fn list_projects(
    State(db): State<AppState>,
) -> Result<Json<Vec<ProjectWithTags>>, (StatusCode, Json<ErrorResponse>)> {
    let mut projects = db.get_projects_with_tags().map_err(db_error_response)?;
    // Normalize Windows backslashes in paths for consistent frontend behavior
    for p in &mut projects {
        p.path = p.path.replace('\\', "/");
        if let Some(ref lp) = p.local_path {
            p.local_path = Some(lp.replace('\\', "/"));
        }
    }
    Ok(Json(projects))
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
        // Tag routes
        .route("/tags", get(list_tags).post(create_tag))
        .route("/tags/:id", delete(delete_tag))
        // Project-tag relationship routes
        .route("/project-tags", post(add_project_tag))
        .route("/project-tags/:project_id/:tag_id", delete(remove_project_tag))
}
