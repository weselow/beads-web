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
    pub archived_at: Option<String>,
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
    pub archived_at: Option<String>,
}

/// A tag stored in the local database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// Bead counts by status group: every bd status belongs to one of four.
///
/// Computed in one place (`statuses::count_by_group`) for both the
/// `/api/beads` response and the cache below.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupCounts {
    pub active: i64,
    pub wip: i64,
    pub frozen: i64,
    pub done: i64,
}

/// Counts by four exact status names — the columns beads-web 0.13 and older
/// read. Still written so a rollback to 0.13 finds fresh numbers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LegacyCounts {
    pub open: i64,
    pub in_progress: i64,
    pub inreview: i64,
    pub closed: i64,
}

/// Cached per-project bead counts by status group.
///
/// Populated on every complete `/api/beads` read and consumed by
/// `/api/projects` so the home page can render donut charts without
/// waiting on a full beads fetch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedCounts {
    #[serde(flatten)]
    pub groups: GroupCounts,
    pub data_source: Option<String>,
    pub updated_at: String,
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

        // Enable foreign key enforcement so ON DELETE CASCADE works.
        // SQLite defaults foreign_keys=OFF per connection.
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

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
            (2, "ALTER TABLE projects ADD COLUMN archived_at TEXT"),
            (
                3,
                "CREATE TABLE IF NOT EXISTS project_bead_counts (
                    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
                    open INTEGER NOT NULL DEFAULT 0,
                    in_progress INTEGER NOT NULL DEFAULT 0,
                    inreview INTEGER NOT NULL DEFAULT 0,
                    closed INTEGER NOT NULL DEFAULT 0,
                    data_source TEXT,
                    updated_at TEXT NOT NULL
                )",
            ),
            // Groups next to the old per-status columns, which 0.13 still reads.
            // No default: a row written before this or by 0.13 has unknown
            // groups (NULL), not zero ones.
            (
                4,
                "ALTER TABLE project_bead_counts ADD COLUMN active INTEGER;
                 ALTER TABLE project_bead_counts ADD COLUMN wip INTEGER;
                 ALTER TABLE project_bead_counts ADD COLUMN frozen INTEGER;
                 ALTER TABLE project_bead_counts ADD COLUMN done INTEGER;",
            ),
        ];

        let now = Utc::now().to_rfc3339();
        for (version, sql) in migrations {
            if version > current_version {
                // One transaction: a migration of several statements either
                // lands whole with its version row or not at all.
                let tx = conn.unchecked_transaction()?;
                tx.execute_batch(sql)?;
                tx.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                    params![version, now],
                )?;
                tx.commit()?;
                tracing::info!("Applied migration v{}", version);
            }
        }

        Ok(())
    }

    // ===== Project CRUD =====

    /// Gets projects with their tags, optionally including archived
    pub fn get_projects_with_tags_filtered(&self, include_archived: bool) -> Result<Vec<ProjectWithTags>, DbError> {
        let projects = self.get_projects_filtered(include_archived)?;
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
                archived_at: project.archived_at,
            });
        }

        Ok(result)
    }

    /// Gets projects, optionally including archived
    pub fn get_projects_filtered(&self, include_archived: bool) -> Result<Vec<Project>, DbError> {
        let conn = self.conn.lock().unwrap();
        let sql = if include_archived {
            "SELECT id, name, path, local_path, last_opened, created_at, archived_at FROM projects ORDER BY last_opened DESC"
        } else {
            "SELECT id, name, path, local_path, last_opened, created_at, archived_at FROM projects WHERE archived_at IS NULL ORDER BY last_opened DESC"
        };
        let mut stmt = conn.prepare(sql)?;

        let projects = stmt
            .query_map([], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    local_path: row.get(3)?,
                    last_opened: row.get(4)?,
                    created_at: row.get(5)?,
                    archived_at: row.get(6)?,
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
            archived_at: None,
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
            "SELECT id, name, path, local_path, last_opened, created_at, archived_at FROM projects WHERE id = ?1",
            params![id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    local_path: row.get(3)?,
                    last_opened: row.get(4)?,
                    created_at: row.get(5)?,
                    archived_at: row.get(6)?,
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

    /// Archives a project by setting archived_at timestamp
    pub fn archive_project(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE projects SET archived_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        if rows == 0 {
            return Err(DbError::ProjectNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Unarchives a project by clearing archived_at
    pub fn unarchive_project(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "UPDATE projects SET archived_at = NULL WHERE id = ?1",
            params![id],
        )?;
        if rows == 0 {
            return Err(DbError::ProjectNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Updates `last_opened` to current time without touching any other field. Returns ProjectNotFound when no row matches.
    pub fn touch_project(&self, id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE projects SET last_opened = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        if rows == 0 {
            return Err(DbError::ProjectNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Looks up a project by its `path` column.
    ///
    /// Returns `Ok(None)` when no project matches (not an error — the caller
    /// may be handling a `dolt://` path or a path unknown to the local DB).
    ///
    /// On Windows the `projects` table may hold paths with backslashes while
    /// the `/api/beads` handler normalizes incoming paths to forward slashes,
    /// so we match both the exact path and the backslash-swapped variant.
    pub fn get_project_by_path(&self, path: &str) -> Result<Option<Project>, DbError> {
        let conn = self.conn.lock().unwrap();
        let alt_path = path.replace('/', "\\");
        let row = conn.query_row(
            "SELECT id, name, path, local_path, last_opened, created_at, archived_at
             FROM projects WHERE path = ?1 OR path = ?2",
            params![path, alt_path],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    local_path: row.get(3)?,
                    last_opened: row.get(4)?,
                    created_at: row.get(5)?,
                    archived_at: row.get(6)?,
                })
            },
        );

        match row {
            Ok(project) => Ok(Some(project)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    // ===== Cached bead counts =====

    /// Reads the cached group counts for a project.
    ///
    /// Returns `Ok(None)` when no cache row exists yet (e.g. the project was
    /// just created and `/api/beads` has not been called for it), or when the
    /// row holds no groups — written before the upgrade or by 0.13.
    pub fn get_cached_counts(&self, project_id: &str) -> Result<Option<CachedCounts>, DbError> {
        let conn = self.conn.lock().unwrap();
        let row = conn.query_row(
            "SELECT active, wip, frozen, done, data_source, updated_at
             FROM project_bead_counts WHERE project_id = ?1",
            params![project_id],
            |row| {
                let groups = (row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?);
                Ok((groups, row.get(4)?, row.get(5)?))
            },
        );

        match row {
            Ok(((Some(active), Some(wip), Some(frozen), Some(done)), data_source, updated_at)) => {
                let groups = GroupCounts { active, wip, frozen, done };
                Ok(Some(CachedCounts { groups, data_source, updated_at }))
            }
            Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    /// Upserts cached bead counts for a project: the groups, plus the old
    /// per-status columns for a rollback to 0.13.
    ///
    /// Inserts a new row if none exists, otherwise replaces all fields.
    /// Caller is expected to populate `updated_at` with a fresh timestamp.
    pub fn upsert_cached_counts(
        &self,
        project_id: &str,
        counts: &CachedCounts,
        legacy: &LegacyCounts,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock().unwrap();
        let g = &counts.groups;
        conn.execute(
            "INSERT INTO project_bead_counts
                (project_id, open, in_progress, inreview, closed,
                 active, wip, frozen, done, data_source, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(project_id) DO UPDATE SET
                open = excluded.open, in_progress = excluded.in_progress,
                inreview = excluded.inreview, closed = excluded.closed,
                active = excluded.active, wip = excluded.wip,
                frozen = excluded.frozen, done = excluded.done,
                data_source = excluded.data_source, updated_at = excluded.updated_at",
            params![
                project_id,
                legacy.open, legacy.in_progress, legacy.inreview, legacy.closed,
                g.active, g.wip, g.frozen, g.done,
                counts.data_source, counts.updated_at,
            ],
        )?;
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

        let projects = db.get_projects_filtered(false).unwrap();
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

        let projects = db.get_projects_filtered(false).unwrap();
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
    fn test_archive_unarchive_project() {
        let db = Database::new_in_memory().unwrap();
        let project = db
            .create_project(CreateProjectInput {
                name: "Archivable".to_string(),
                path: "/archive/me".to_string(),
                local_path: None,
            })
            .unwrap();

        // Initially visible
        let projects = db.get_projects_filtered(false).unwrap();
        assert_eq!(projects.len(), 1);

        // Archive it
        db.archive_project(&project.id).unwrap();
        let active = db.get_projects_filtered(false).unwrap();
        assert!(active.is_empty());
        let all = db.get_projects_filtered(true).unwrap();
        assert_eq!(all.len(), 1);
        assert!(all[0].archived_at.is_some());

        // Unarchive it
        db.unarchive_project(&project.id).unwrap();
        let active = db.get_projects_filtered(false).unwrap();
        assert_eq!(active.len(), 1);
        assert!(active[0].archived_at.is_none());
    }

    #[test]
    fn test_touch_project_updates_last_opened() {
        let db = Database::new_in_memory().unwrap();
        let project = db
            .create_project(CreateProjectInput {
                name: "Touchable".to_string(),
                path: "/touch/me".to_string(),
                local_path: None,
            })
            .unwrap();

        let original = project.last_opened.clone();
        // Sleep so the RFC3339 timestamp is guaranteed to differ on fast machines
        std::thread::sleep(std::time::Duration::from_millis(20));

        db.touch_project(&project.id).unwrap();

        let projects = db.get_projects_filtered(false).unwrap();
        let touched = projects
            .iter()
            .find(|p| p.id == project.id)
            .expect("project should still exist after touch");

        // last_opened bumped (RFC3339 string compare is monotonic for same TZ)
        assert_ne!(touched.last_opened, original);
        assert!(
            touched.last_opened.as_str() > original.as_str(),
            "expected new last_opened ({}) > original ({})",
            touched.last_opened,
            original
        );
        // Other fields untouched
        assert_eq!(touched.name, project.name);
        assert_eq!(touched.path, project.path);
    }

    #[test]
    fn test_touch_project_not_found() {
        let db = Database::new_in_memory().unwrap();
        let result = db.touch_project("does-not-exist-uuid");
        assert!(matches!(result, Err(DbError::ProjectNotFound(_))));
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

        let projects = db.get_projects_with_tags_filtered(false).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].tags.len(), 1);
        assert_eq!(projects[0].tags[0].name, "Tag1");
    }

    // ── get_project_by_path ──────────────────────────────────────────

    #[test]
    fn test_get_project_by_path_found() {
        let db = Database::new_in_memory().unwrap();
        let created = db
            .create_project(CreateProjectInput {
                name: "Lookup".to_string(),
                path: "/lookup/by/path".to_string(),
                local_path: None,
            })
            .unwrap();

        let found = db.get_project_by_path("/lookup/by/path").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, created.id);
    }

    #[test]
    fn test_get_project_by_path_not_found() {
        let db = Database::new_in_memory().unwrap();
        let found = db.get_project_by_path("/does/not/exist").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn test_get_project_by_path_matches_windows_backslash_variant() {
        // Project created with backslashes (as Windows frontends might send)
        // should still match when the caller passes the forward-slash variant
        // that `/api/beads` normalizes to before looking up.
        let db = Database::new_in_memory().unwrap();
        let created = db
            .create_project(CreateProjectInput {
                name: "Win".to_string(),
                path: "M:\\repos\\win\\project".to_string(),
                local_path: None,
            })
            .unwrap();

        let found = db.get_project_by_path("M:/repos/win/project").unwrap();
        assert!(found.is_some(), "forward-slash lookup should match backslash-stored path");
        assert_eq!(found.unwrap().id, created.id);
    }

    // ── cached bead counts ──────────────────────────────────────────

    fn column_names(db: &Database, table: &str) -> Vec<String> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
        let names = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap();
        names.collect::<SqliteResult<Vec<_>>>().unwrap()
    }

    fn groups(active: i64, wip: i64, frozen: i64, done: i64) -> GroupCounts {
        GroupCounts { active, wip, frozen, done }
    }

    fn cached(groups: GroupCounts, source: &str, at: &str) -> CachedCounts {
        CachedCounts { groups, data_source: Some(source.to_string()), updated_at: at.to_string() }
    }

    fn legacy(open: i64, in_progress: i64, inreview: i64, closed: i64) -> LegacyCounts {
        LegacyCounts { open, in_progress, inreview, closed }
    }

    fn make_project(db: &Database, path: &str) -> Project {
        let input = CreateProjectInput { name: path.to_string(), path: path.to_string(), local_path: None };
        db.create_project(input).unwrap()
    }

    /// Schema as 0.13 left it: migrations 1-3 applied, one counts row.
    fn database_at_v3() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
                 last_opened TEXT NOT NULL, created_at TEXT NOT NULL, local_path TEXT, archived_at TEXT);
             CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
             INSERT INTO schema_migrations VALUES (1, 'x'), (2, 'x'), (3, 'x');
             CREATE TABLE project_bead_counts (
                 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
                 open INTEGER NOT NULL DEFAULT 0, in_progress INTEGER NOT NULL DEFAULT 0,
                 inreview INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0,
                 data_source TEXT, updated_at TEXT NOT NULL);
             INSERT INTO projects VALUES ('p1', 'Old', '/old', 'x', 'x', NULL, NULL);
             INSERT INTO project_bead_counts VALUES ('p1', 4, 2, 1, 9, 'cli', '2026-09-01T00:00:00Z');",
        )
        .unwrap();
        let db = Database { conn: Mutex::new(conn) };
        db.init_schema().unwrap();
        db
    }

    #[test]
    fn test_counts_table_has_group_columns_and_keeps_old_ones() {
        let db = Database::new_in_memory().unwrap();
        let columns = column_names(&db, "project_bead_counts");
        for name in ["open", "in_progress", "inreview", "closed", "active", "wip", "frozen", "done"] {
            assert!(columns.iter().any(|c| c == name), "missing column {name}: {columns:?}");
        }
    }

    #[test]
    fn test_upgrade_from_v3_keeps_old_rows_and_columns() {
        let db = database_at_v3();
        let conn = db.conn.lock().unwrap();
        let old: (i64, i64, i64, i64) = conn
            .query_row(
                "SELECT open, in_progress, inreview, closed FROM project_bead_counts WHERE project_id = 'p1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(old, (4, 2, 1, 9));
    }

    #[test]
    fn test_a_row_without_groups_is_not_served_as_counts() {
        // Written before the upgrade: the groups are unknown, not zero.
        let db = database_at_v3();
        assert!(db.get_cached_counts("p1").unwrap().is_none());
    }

    #[test]
    fn test_old_version_can_still_write_and_read_after_upgrade() {
        // The statements 0.13 runs, word for word.
        let db = database_at_v3();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO project_bead_counts
                (project_id, open, in_progress, inreview, closed, data_source, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(project_id) DO UPDATE SET
                open = excluded.open, in_progress = excluded.in_progress,
                inreview = excluded.inreview, closed = excluded.closed,
                data_source = excluded.data_source, updated_at = excluded.updated_at",
            params!["p1", 1, 1, 1, 1, "cli", "2026-09-02T00:00:00Z"],
        )
        .unwrap();
        let open: i64 = conn
            .query_row(
                "SELECT open, in_progress, inreview, closed, data_source, updated_at
                 FROM project_bead_counts WHERE project_id = ?1",
                params!["p1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(open, 1);
    }

    #[test]
    fn test_upsert_fills_old_columns_for_rollback() {
        let db = Database::new_in_memory().unwrap();
        let project = make_project(&db, "/legacy");
        let counts = cached(groups(5, 2, 1, 7), "cli", "2026-09-29T10:00:00Z");
        db.upsert_cached_counts(&project.id, &counts, &legacy(3, 1, 1, 7)).unwrap();
        let conn = db.conn.lock().unwrap();
        let old: (i64, i64, i64, i64) = conn
            .query_row(
                "SELECT open, in_progress, inreview, closed FROM project_bead_counts WHERE project_id = ?1",
                params![project.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(old, (3, 1, 1, 7));
    }

    #[test]
    fn test_cached_counts_serialize_groups_in_camel_case() {
        let json = serde_json::to_value(cached(groups(1, 2, 3, 4), "cli", "t")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"active": 1, "wip": 2, "frozen": 3, "done": 4, "dataSource": "cli", "updatedAt": "t"})
        );
    }

    #[test]
    fn test_cached_counts_insert_and_get() {
        let db = Database::new_in_memory().unwrap();
        let project = make_project(&db, "/counts");

        // Initially no cache row
        assert!(db.get_cached_counts(&project.id).unwrap().is_none());

        let counts = cached(groups(3, 1, 2, 7), "cli", "2026-04-22T10:00:00Z");
        db.upsert_cached_counts(&project.id, &counts, &legacy(3, 1, 0, 7)).unwrap();

        let fetched = db.get_cached_counts(&project.id).unwrap().unwrap();
        assert_eq!(fetched.groups, groups(3, 1, 2, 7));
        assert_eq!(fetched.data_source.as_deref(), Some("cli"));
        assert_eq!(fetched.updated_at, "2026-04-22T10:00:00Z");
    }

    #[test]
    fn test_cached_counts_upsert_replaces_existing() {
        let db = Database::new_in_memory().unwrap();
        let project = make_project(&db, "/upsert");

        let first = cached(groups(10, 2, 0, 0), "jsonl", "2026-04-22T10:00:00Z");
        db.upsert_cached_counts(&project.id, &first, &legacy(10, 2, 1, 0)).unwrap();
        let second = cached(groups(8, 5, 1, 5), "dolt-direct", "2026-04-22T11:00:00Z");
        db.upsert_cached_counts(&project.id, &second, &legacy(8, 3, 2, 5)).unwrap();

        let fetched = db.get_cached_counts(&project.id).unwrap().unwrap();
        assert_eq!(fetched.groups, groups(8, 5, 1, 5));
        assert_eq!(fetched.data_source.as_deref(), Some("dolt-direct"));
        assert_eq!(fetched.updated_at, "2026-04-22T11:00:00Z");

        // Still only one row for this project
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_bead_counts WHERE project_id = ?1",
                params![project.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_cached_counts_cascade_on_project_delete() {
        let db = Database::new_in_memory().unwrap();
        let project = make_project(&db, "/cascade");
        let counts = cached(groups(1, 0, 0, 0), "cli", "2026-04-22T10:00:00Z");
        db.upsert_cached_counts(&project.id, &counts, &legacy(1, 0, 0, 0)).unwrap();

        assert!(db.get_cached_counts(&project.id).unwrap().is_some());

        db.delete_project(&project.id).unwrap();

        // Cache row should be removed by ON DELETE CASCADE
        assert!(db.get_cached_counts(&project.id).unwrap().is_none());
    }
}
