//! Database module for beads-server
//!
//! Provides SQLite storage for projects, tags, and their relationships.
//! Uses rusqlite with Arc<Mutex<>> for thread-safe access from Axum handlers.

use chrono::Utc;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

/// Database error types
#[derive(Error, Debug)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Project not found: {0}")]
    ProjectNotFound(String),
    #[error("Tag not found: {0}")]
    TagNotFound(String),
    #[error("Database path error")]
    PathError,
}

impl Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// A project stored in the local database
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub local_path: Option<String>,
    pub last_opened: String,
    pub created_at: String,
}

/// A project with its associated tags
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWithTags {
    pub id: String,
    pub name: String,
    pub path: String,
    pub local_path: Option<String>,
    pub tags: Vec<Tag>,
    pub last_opened: String,
    pub created_at: String,
}

/// A tag stored in the local database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// Input for creating a new project
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub local_path: Option<String>,
}

/// Input for updating a project
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub path: Option<String>,
    pub local_path: Option<String>,
}

/// Input for creating a new tag
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagInput {
    pub name: String,
    pub color: String,
}

/// Input for adding a tag to a project
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTagInput {
    pub project_id: String,
    pub tag_id: String,
}

/// Thread-safe database wrapper
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Creates a new database connection and initializes the schema
    ///
    /// # Errors
    ///
    /// Returns an error if the database cannot be opened or schema creation fails
    pub fn new() -> Result<Self, DbError> {
        let db_path = Self::get_db_path()?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| DbError::PathError)?;
        }

        let conn = Connection::open(&db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    /// Creates an in-memory database for testing
    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    /// Gets the database file path in the app data directory
    fn get_db_path() -> Result<PathBuf, DbError> {
        let proj_dirs =
            directories::ProjectDirs::from("com", "beads", "kanban-ui").ok_or(DbError::PathError)?;
        Ok(proj_dirs.data_dir().join("settings.db"))
    }

    /// Initializes the database schema and runs pending migrations
    fn init_schema(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();

        // Base schema (v0 — initial tables)
        conn.execute_batch(
            r"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                last_opened TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_tags (
                project_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                PRIMARY KEY (project_id, tag_id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_projects_last_opened ON projects(last_opened DESC);
            CREATE INDEX IF NOT EXISTS idx_project_tags_project ON project_tags(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_tags_tag ON project_tags(tag_id);

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            ",
        )?;

        // Run pending migrations
        Self::run_migrations(&conn)?;

        Ok(())
    }

    /// Runs all pending migrations in order
    fn run_migrations(conn: &Connection) -> Result<(), DbError> {
        let current_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let migrations: Vec<(i64, &str)> = vec![
            (1, "ALTER TABLE projects ADD COLUMN local_path TEXT"),
        ];

        let now = Utc::now().to_rfc3339();
        for (version, sql) in migrations {
            if version > current_version {
                conn.execute_batch(sql)?;
                conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                    params![version, now],
                )?;
                tracing::info!("Applied migration v{}", version);
            }
        }

        Ok(())
    }

    // ===== Project CRUD =====

    /// Gets all projects with their tags, ordered by last opened
    pub fn get_projects_with_tags(&self) -> Result<Vec<ProjectWithTags>, DbError> {
        let projects = self.get_projects()?;
        let mut result = Vec::with_capacity(projects.len());

        for project in projects {
            let tags = self.get_project_tags(&project.id)?;
            result.push(ProjectWithTags {
                id: project.id,
                name: project.name,
                path: project.path,
                local_path: project.local_path,
                tags,
                last_opened: project.last_opened,
                created_at: project.created_at,
            });
        }

        Ok(result)
    }

    /// Gets all projects, ordered by last opened
    pub fn get_projects(&self) -> Result<Vec<Project>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, local_path, last_opened, created_at FROM projects ORDER BY last_opened DESC",
        )?;

        let projects = stmt
            .query_map([], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    local_path: row.get(3)?,
                    last_opened: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(projects)
    }

    /// Creates a new project
    pub fn create_project(&self, input: CreateProjectInput) -> Result<Project, DbError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, path, local_path, last_opened, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.name, input.path, input.local_path, now, now],
        )?;

        Ok(Project {
            id,
            name: input.name,
            path: input.path,
            local_path: input.local_path,
            last_opened: now.clone(),
            created_at: now,
        })
    }

    /// Updates an existing project
    pub fn update_project(&self, id: &str, input: UpdateProjectInput) -> Result<Project, DbError> {
        let conn = self.conn.lock().unwrap();

        // Check if project exists
        let exists: bool = conn
            .query_row("SELECT 1 FROM projects WHERE id = ?1", params![id], |_| {
                Ok(true)
            })
            .unwrap_or(false);

        if !exists {
            return Err(DbError::ProjectNotFound(id.to_string()));
        }

        // Update fields if provided
        if let Some(ref name) = input.name {
            conn.execute(
                "UPDATE projects SET name = ?1 WHERE id = ?2",
                params![name, id],
            )?;
        }

        if let Some(ref path) = input.path {
            conn.execute(
                "UPDATE projects SET path = ?1 WHERE id = ?2",
                params![path, id],
            )?;
        }

        if let Some(ref local_path) = input.local_path {
            conn.execute(
                "UPDATE projects SET local_path = ?1 WHERE id = ?2",
                params![local_path, id],
            )?;
        }

        // Update last_opened
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE projects SET last_opened = ?1 WHERE id = ?2",
            params![now, id],
        )?;

        // Fetch and return updated project
        let project = conn.query_row(
            "SELECT id, name, path, local_path, last_opened, created_at FROM projects WHERE id = ?1",
            params![id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    local_path: row.get(3)?,
                    last_opened: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )?;

        Ok(project)
    }

    /// Deletes a project by ID
    pub fn delete_project(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;

        if rows == 0 {
            return Err(DbError::ProjectNotFound(id.to_string()));
        }

        Ok(())
    }

    // ===== Tag CRUD =====

    /// Gets all tags
    pub fn get_tags(&self) -> Result<Vec<Tag>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name")?;

        let tags = stmt
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tags)
    }

    /// Creates a new tag
    pub fn create_tag(&self, input: CreateTagInput) -> Result<Tag, DbError> {
        let id = Uuid::new_v4().to_string();

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)",
            params![id, input.name, input.color],
        )?;

        Ok(Tag {
            id,
            name: input.name,
            color: input.color,
        })
    }

    /// Deletes a tag by ID
    pub fn delete_tag(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;

        if rows == 0 {
            return Err(DbError::TagNotFound(id.to_string()));
        }

        Ok(())
    }

    // ===== Project-Tag Relationships =====

    /// Gets all tags for a project
    pub fn get_project_tags(&self, project_id: &str) -> Result<Vec<Tag>, DbError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color FROM tags t
             INNER JOIN project_tags pt ON t.id = pt.tag_id
             WHERE pt.project_id = ?1
             ORDER BY t.name",
        )?;

        let tags = stmt
            .query_map(params![project_id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tags)
    }

    /// Adds a tag to a project
    pub fn add_tag_to_project(&self, project_id: &str, tag_id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();

        // Verify project exists
        let project_exists: bool = conn
            .query_row(
                "SELECT 1 FROM projects WHERE id = ?1",
                params![project_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !project_exists {
            return Err(DbError::ProjectNotFound(project_id.to_string()));
        }

        // Verify tag exists
        let tag_exists: bool = conn
            .query_row("SELECT 1 FROM tags WHERE id = ?1", params![tag_id], |_| {
                Ok(true)
            })
            .unwrap_or(false);

        if !tag_exists {
            return Err(DbError::TagNotFound(tag_id.to_string()));
        }

        // Insert relationship (ignore if already exists)
        conn.execute(
            "INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?1, ?2)",
            params![project_id, tag_id],
        )?;

        Ok(())
    }

    /// Removes a tag from a project
    pub fn remove_tag_from_project(&self, project_id: &str, tag_id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM project_tags WHERE project_id = ?1 AND tag_id = ?2",
            params![project_id, tag_id],
        )?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_get_project() {
        let db = Database::new_in_memory().unwrap();

        let project = db
            .create_project(CreateProjectInput {
                name: "Test Project".to_string(),
                path: "/path/to/project".to_string(),
                local_path: None,
            })
            .unwrap();

        assert_eq!(project.name, "Test Project");
        assert_eq!(project.path, "/path/to/project");

        let projects = db.get_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, project.id);
    }

    #[test]
    fn test_update_project() {
        let db = Database::new_in_memory().unwrap();

        let project = db
            .create_project(CreateProjectInput {
                name: "Original".to_string(),
                path: "/path".to_string(),
                local_path: None,
            })
            .unwrap();

        let updated = db
            .update_project(
                &project.id,
                UpdateProjectInput {
                    name: Some("Updated".to_string()),
                    path: None,
                    local_path: None,
                },
            )
            .unwrap();

        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.path, "/path");
    }

    #[test]
    fn test_delete_project() {
        let db = Database::new_in_memory().unwrap();

        let project = db
            .create_project(CreateProjectInput {
                name: "To Delete".to_string(),
                path: "/delete/me".to_string(),
                local_path: None,
            })
            .unwrap();

        db.delete_project(&project.id).unwrap();

        let projects = db.get_projects().unwrap();
        assert!(projects.is_empty());
    }

    #[test]
    fn test_create_and_get_tag() {
        let db = Database::new_in_memory().unwrap();

        let tag = db
            .create_tag(CreateTagInput {
                name: "Frontend".to_string(),
                color: "#3b82f6".to_string(),
            })
            .unwrap();

        assert_eq!(tag.name, "Frontend");
        assert_eq!(tag.color, "#3b82f6");

        let tags = db.get_tags().unwrap();
        assert_eq!(tags.len(), 1);
    }

    #[test]
    fn test_project_tag_relationship() {
        let db = Database::new_in_memory().unwrap();

        let project = db
            .create_project(CreateProjectInput {
                name: "Project".to_string(),
                path: "/project".to_string(),
                local_path: None,
            })
            .unwrap();

        let tag = db
            .create_tag(CreateTagInput {
                name: "Urgent".to_string(),
                color: "#ef4444".to_string(),
            })
            .unwrap();

        db.add_tag_to_project(&project.id, &tag.id).unwrap();

        let project_tags = db.get_project_tags(&project.id).unwrap();
        assert_eq!(project_tags.len(), 1);
        assert_eq!(project_tags[0].id, tag.id);

        db.remove_tag_from_project(&project.id, &tag.id).unwrap();

        let project_tags = db.get_project_tags(&project.id).unwrap();
        assert!(project_tags.is_empty());
    }

    #[test]
    fn test_get_projects_with_tags() {
        let db = Database::new_in_memory().unwrap();

        let project = db
            .create_project(CreateProjectInput {
                name: "Test".to_string(),
                path: "/test".to_string(),
                local_path: None,
            })
            .unwrap();

        let tag = db
            .create_tag(CreateTagInput {
                name: "Tag1".to_string(),
                color: "#000".to_string(),
            })
            .unwrap();

        db.add_tag_to_project(&project.id, &tag.id).unwrap();

        let projects = db.get_projects_with_tags().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].tags.len(), 1);
        assert_eq!(projects[0].tags[0].name, "Tag1");
    }
}
