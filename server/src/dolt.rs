//! Dolt database connection manager.
//!
//! Provides direct MySQL connection to Dolt for reading beads data,
//! with database discovery via `SHOW DATABASES`.

use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts, Row};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::TcpStream;
use tracing::{info, warn};

use crate::routes::beads::{Bead, Comment};

/// Default Dolt server connection parameters (configured by bd CLI).
const DOLT_HOST: &str = "127.0.0.1";
const DOLT_PORT: u16 = 3307;
const DOLT_USER: &str = "root";

/// Errors from Dolt operations.
#[derive(Debug, thiserror::Error)]
pub enum DoltError {
    #[error("MySQL connection failed: {0}")]
    ConnectionFailed(String),

    #[error("SQL query failed: {0}")]
    QueryFailed(String),

    #[error("Database not found: {0}")]
    DatabaseNotFound(String),
}

/// Manages the connection pool and operations against a Dolt MySQL server.
pub struct DoltManager {
    pool: Pool,
    available: AtomicBool,
}

impl Default for DoltManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DoltManager {
    /// Creates a new DoltManager with a connection pool to Dolt.
    pub fn new() -> Self {
        let pool_opts = PoolOpts::default()
            .with_constraints(PoolConstraints::new(0, 4).unwrap());

        let opts: Opts = OptsBuilder::default()
            .ip_or_hostname(DOLT_HOST)
            .tcp_port(DOLT_PORT)
            .user(Some(DOLT_USER))
            .pool_opts(pool_opts)
            .into();

        Self {
            pool: Pool::new(opts),
            available: AtomicBool::new(false),
        }
    }

    /// Checks if Dolt server is reachable via TCP.
    pub async fn check_server(&self) -> bool {
        let reachable = TcpStream::connect((DOLT_HOST, DOLT_PORT)).await.is_ok();
        self.available.store(reachable, Ordering::Relaxed);
        reachable
    }

    /// Returns cached availability (set by `check_server`).
    pub fn is_available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }

    /// Discovers all beads databases via `SHOW DATABASES`.
    /// Returns database names that start with `beads_`.
    pub async fn discover_databases(&self) -> Result<Vec<DoltDatabase>, DoltError> {
        let mut conn = self.pool.get_conn().await
            .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;

        let rows: Vec<Row> = conn.query("SHOW DATABASES").await
            .map_err(|e| DoltError::QueryFailed(e.to_string()))?;

        let mut databases = Vec::new();
        for row in rows {
            let name: String = row.get(0).unwrap_or_default();
            if name.starts_with("beads_") {
                let project_name = name.strip_prefix("beads_")
                    .unwrap_or(&name)
                    .to_string();
                databases.push(DoltDatabase { name, project_name });
            }
        }

        self.available.store(true, Ordering::Relaxed);
        Ok(databases)
    }

    /// Reads beads (issues + comments + dependencies) from a specific Dolt database.
    pub async fn read_beads(&self, db_name: &str) -> Result<Vec<Bead>, DoltError> {
        let mut conn = self.pool.get_conn().await
            .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;
        let beads = read_beads_from_conn(&mut conn, db_name).await?;
        self.available.store(true, Ordering::Relaxed);
        info!("Read {} beads from Dolt SQL (db: {})", beads.len(), db_name);
        Ok(beads)
    }

    /// Reads the `status.custom` config value of a database on the central
    /// Dolt server; `None` when the project has no own statuses.
    pub async fn read_status_custom(&self, db_name: &str) -> Result<Option<String>, DoltError> {
        let mut conn = self.pool.get_conn().await
            .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;
        let value = query_status_custom(&mut conn, db_name).await?;
        self.available.store(true, Ordering::Relaxed);
        Ok(value)
    }

    /// Creates a new bead in a Dolt database and commits the change.
    ///
    /// The issue row and the parent link are written inside one SQL
    /// transaction, so a failing link cannot leave a parented bead behind
    /// without its parent. The Dolt commit follows the SQL commit.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_bead(
        &self,
        db_name: &str,
        id: &str,
        title: &str,
        description: Option<&str>,
        issue_type: &str,
        priority: i32,
        parent_id: Option<&str>,
    ) -> Result<(), DoltError> {
        let mut conn = self.pool.get_conn().await
            .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        // Schema introspection happens before the transaction: these are reads,
        // and `USE` below would implicitly commit an open transaction anyway.
        let extra_cols = issue_extra_columns(&mut conn, db_name).await;
        let issue_query = build_issue_insert(db_name, &extra_cols);
        let dep_query = match parent_id {
            Some(_) => {
                let schema = dependency_schema(&mut conn, db_name).await?;
                Some(build_dependency_insert(db_name, &schema))
            }
            None => None,
        };

        // DOLT_COMMIT needs the database selected, and `USE` implicitly commits
        // whatever transaction is open — so it has to run first.
        let use_query = format!("USE `{}`", db_name);
        conn.query_drop(&use_query).await
            .map_err(|e| DoltError::QueryFailed(format!("use_db: {}", e)))?;

        conn.query_drop("START TRANSACTION").await
            .map_err(|e| DoltError::QueryFailed(format!("begin: {}", e)))?;

        // Both rows have to land together. A committed issue whose parent link
        // failed is an orphan that nothing else cleans up.
        let written = async {
            conn.exec_drop(
                &issue_query,
                mysql_async::params! {
                    "id" => id,
                    "title" => title,
                    "desc" => description,
                    "priority" => priority,
                    "type" => issue_type,
                    "now" => &now,
                },
            ).await.map_err(|e| DoltError::QueryFailed(format!("insert: {}", e)))?;

            if let (Some(dep_query), Some(parent)) = (&dep_query, parent_id) {
                conn.exec_drop(
                    dep_query,
                    mysql_async::params! {
                        "child" => id,
                        "parent" => parent,
                        "dep_id" => uuid::Uuid::new_v4().to_string(),
                    },
                ).await.map_err(|e| DoltError::QueryFailed(format!("dependency: {}", e)))?;
            }

            conn.query_drop("COMMIT").await
                .map_err(|e| DoltError::QueryFailed(format!("commit: {}", e)))?;

            Ok::<(), DoltError>(())
        }.await;

        if let Err(e) = written {
            if let Err(rollback_err) = conn.query_drop("ROLLBACK").await {
                warn!(
                    "Rollback after a failed create of {} did not go through (db: {}): {}",
                    id, db_name, rollback_err
                );
            }
            warn!("Failed to create bead {} in Dolt (db: {}): {}", id, db_name, e);
            return Err(e);
        }

        let commit_query = format!(
            "CALL DOLT_COMMIT('-Am', 'web-ui: create {}')", id
        );
        conn.query_drop(&commit_query).await
            .map_err(|e| DoltError::QueryFailed(format!("dolt_commit: {}", e)))?;

        info!("Created bead {} in Dolt (db: {})", id, db_name);
        Ok(())
    }

    /// Updates a bead's fields in a Dolt database and commits the change.
    pub async fn update_bead(
        &self,
        db_name: &str,
        id: &str,
        update: &BeadUpdate<'_>,
    ) -> Result<(), DoltError> {
        let (mut sets, mut params) = update_sets(update);

        if sets.is_empty() {
            return Ok(());
        }

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        sets.push("updated_at = :now".to_string());
        params.push((b"now".to_vec(), now.into()));
        params.push((b"id".to_vec(), id.into()));

        let mut conn = self.pool.get_conn().await
            .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;

        let query = format!(
            "UPDATE `{}`.issues SET {} WHERE id = :id",
            db_name,
            sets.join(", ")
        );
        conn.exec_drop(&query, mysql_async::Params::Named(params.into_iter().collect()))
            .await
            .map_err(|e| DoltError::QueryFailed(format!("update: {}", e)))?;

        // Dolt commit — must USE the database first
        let use_query = format!("USE `{}`", db_name);
        conn.query_drop(&use_query).await
            .map_err(|e| DoltError::QueryFailed(format!("use_db: {}", e)))?;
        let commit_query = format!(
            "CALL DOLT_COMMIT('-Am', 'web-ui: update {}')", id
        );
        conn.query_drop(&commit_query).await
            .map_err(|e| DoltError::QueryFailed(format!("dolt_commit: {}", e)))?;

        info!("Updated bead {} in Dolt (db: {})", id, db_name);
        Ok(())
    }

}

/// Fields to change on one bead over SQL; `None` leaves a field alone.
#[derive(Debug, Default)]
pub struct BeadUpdate<'a> {
    pub title: Option<&'a str>,
    pub description: Option<&'a str>,
    pub status: Option<&'a str>,
    pub issue_type: Option<&'a str>,
    pub priority: Option<i32>,
    /// `Some(Some(t))` defers until `t` (`YYYY-MM-DD HH:MM:SS`, UTC),
    /// `Some(None)` clears the date.
    pub defer_until: Option<Option<String>>,
}

type NamedParams = Vec<(Vec<u8>, mysql_async::Value)>;

/// `SET` clauses and their named parameters for [`BeadUpdate`].
fn update_sets(update: &BeadUpdate<'_>) -> (Vec<String>, NamedParams) {
    let mut sets = Vec::new();
    let mut params: NamedParams = Vec::new();
    let fields: [(&str, &str, Option<mysql_async::Value>); 5] = [
        ("title", "title", update.title.map(Into::into)),
        ("description", "desc", update.description.map(Into::into)),
        ("status", "status", update.status.map(Into::into)),
        ("issue_type", "issue_type", update.issue_type.map(Into::into)),
        ("priority", "priority", update.priority.map(Into::into)),
    ];
    for (column, name, value) in fields {
        if let Some(value) = value {
            sets.push(format!("{} = :{}", column, name));
            params.push((name.as_bytes().to_vec(), value));
        }
    }
    push_defer_sets(update, &mut sets, &mut params);
    (sets, params)
}

/// Adds the defer date the way `bd update --defer` does it: setting a date
/// moves the bead to `deferred`, clearing it reopens a deferred bead. An
/// explicit status in the same update wins.
fn push_defer_sets(update: &BeadUpdate<'_>, sets: &mut Vec<String>, params: &mut NamedParams) {
    let Some(defer) = &update.defer_until else { return };
    match defer {
        Some(until) => {
            sets.push("defer_until = :defer_until".to_string());
            params.push((b"defer_until".to_vec(), until.as_str().into()));
        }
        None => sets.push("defer_until = NULL".to_string()),
    }
    if update.status.is_none() {
        let status = match defer {
            Some(_) => "status = 'deferred'",
            None => "status = CASE WHEN status = 'deferred' THEN 'open' ELSE status END",
        };
        sets.push(status.to_string());
    }
}

/// Turns the page's defer value into what the `defer_until` column takes:
/// empty clears it, `YYYY-MM-DD` means midnight UTC, RFC 3339 is converted
/// to UTC. Words bd understands (`tomorrow`, `+1w`) are refused — SQL has
/// no parser for them.
pub fn sql_defer_value(value: &str) -> Result<Option<String>, String> {
    const SQL_FORMAT: &str = "%Y-%m-%d %H:%M:%S";
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Ok(Some(date.and_time(chrono::NaiveTime::MIN).format(SQL_FORMAT).to_string()));
    }
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|t| Some(t.with_timezone(&chrono::Utc).format(SQL_FORMAT).to_string()))
        .map_err(|_| format!("Defer date must be YYYY-MM-DD or RFC 3339, got '{}'", value))
}

/// Builds a small connection pool to a per-project Dolt server.
fn port_pool(port: u16) -> Pool {
    let pool_opts = PoolOpts::default()
        .with_constraints(PoolConstraints::new(0, 2).unwrap());

    let opts: Opts = OptsBuilder::default()
        .ip_or_hostname(DOLT_HOST)
        .tcp_port(port)
        .user(Some(DOLT_USER))
        .pool_opts(pool_opts)
        .into();

    Pool::new(opts)
}

/// SQL that reads the project's own statuses (`bd config set status.custom`).
fn status_custom_query(db_name: &str) -> String {
    format!(
        "SELECT `value` FROM `{}`.`config` WHERE `key` = 'status.custom'",
        db_name.replace('`', "``")
    )
}

/// Reads the `status.custom` config value; `None` when the project has none.
async fn query_status_custom(
    conn: &mut mysql_async::Conn,
    db_name: &str,
) -> Result<Option<String>, DoltError> {
    conn.query_first::<Option<String>, _>(status_custom_query(db_name))
        .await
        .map(Option::flatten)
        .map_err(|e| DoltError::QueryFailed(e.to_string()))
}

/// Reads `status.custom` from a Dolt server on a specific port.
/// Creates a temporary connection pool to the given port, reads, then drops it.
pub async fn read_status_custom_on_port(port: u16, db_name: &str) -> Result<Option<String>, DoltError> {
    let pool = port_pool(port);
    let mut conn = pool.get_conn().await
        .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;

    let result = query_status_custom(&mut conn, db_name).await;

    drop(conn);
    if let Err(e) = pool.disconnect().await {
        tracing::warn!("Failed to disconnect temporary pool (port {}): {}", port, e);
    }
    result
}

/// Reads beads from a Dolt server on a specific port.
/// Creates a temporary connection pool to the given port, reads data, then drops it.
pub async fn read_beads_on_port(port: u16, db_name: &str) -> Result<Vec<Bead>, DoltError> {
    let pool = port_pool(port);
    let mut conn = pool.get_conn().await
        .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;

    let result = read_beads_from_conn(&mut conn, db_name).await;

    drop(conn);
    if let Err(e) = pool.disconnect().await {
        tracing::warn!("Failed to disconnect temporary pool (port {}): {}", port, e);
    }

    let beads = result?;
    info!("Read {} beads from per-project Dolt SQL (port: {}, db: {})", beads.len(), port, db_name);
    Ok(beads)
}

/// Discover the beads database name by connecting to a Dolt server and looking
/// for a database that has an `issues` table.
pub async fn discover_database_on_port(port: u16) -> Result<String, DoltError> {
    let pool = port_pool(port);
    let mut conn = pool.get_conn().await
        .map_err(|e| DoltError::ConnectionFailed(e.to_string()))?;

    // Get all databases, excluding system ones
    let rows: Vec<Row> = conn.query("SHOW DATABASES").await
        .map_err(|e| DoltError::QueryFailed(e.to_string()))?;

    let system_dbs = ["information_schema", "mysql", "dolt_cluster"];
    let mut db_names: Vec<String> = Vec::new();
    for row in rows {
        let db: String = row.get(0).unwrap_or_default();
        if !system_dbs.contains(&db.as_str()) {
            db_names.push(db);
        }
    }

    // Try each database — look for one with an `issues` table
    for db_name in &db_names {
        let query = format!(
            "SELECT COUNT(*) FROM `{}`.`issues` LIMIT 1",
            db_name.replace('`', "``")
        );
        match conn.query_first::<i64, _>(&query).await {
            Ok(Some(_)) => {
                tracing::info!("Discovered beads database '{}' on port {}", db_name, port);
                drop(conn);
                let _ = pool.disconnect().await;
                return Ok(db_name.clone());
            }
            _ => continue,
        }
    }

    drop(conn);
    let _ = pool.disconnect().await;
    Err(DoltError::DatabaseNotFound(format!(
        "No database with issues table found on port {}",
        port
    )))
}

/// Shared logic for reading beads from a Dolt MySQL connection.
///
/// Reads issues, comments, and dependencies from the given database,
/// then merges them into a single `Vec<Bead>`.
async fn read_beads_from_conn(
    conn: &mut mysql_async::Conn,
    db_name: &str,
) -> Result<Vec<Bead>, DoltError> {
    // Check database exists
    let db_exists: Option<Row> = conn.exec_first(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = :db",
        mysql_async::params! { "db" => db_name },
    ).await.map_err(|e| DoltError::QueryFailed(e.to_string()))?;

    if db_exists.is_none() {
        return Err(DoltError::DatabaseNotFound(db_name.to_string()));
    }

    let beads = query_issues(conn, db_name).await?;
    let mut beads = merge_comments(conn, db_name, beads).await?;
    merge_dependencies(conn, db_name, &mut beads).await?;
    Ok(beads)
}

/// Helper to safely get nullable string columns from a MySQL row.
fn get_opt_str(row: &Row, col: &str) -> Option<String> {
    row.get::<Option<String>, _>(col).flatten()
}

fn get_str(row: &Row, col: &str) -> String {
    get_opt_str(row, col).unwrap_or_default()
}

/// Whether the `issues` table has a column. Older bd schemas lack some
/// (`defer_until`); a failed check counts as "no" so the read goes on.
async fn issues_has_column(conn: &mut mysql_async::Conn, db_name: &str, column: &str) -> bool {
    let found = conn.exec_first::<String, _, _>(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'issues' AND COLUMN_NAME = :col",
        mysql_async::params! { "db" => db_name, "col" => column },
    ).await;
    match found {
        Ok(found) => found.is_some(),
        Err(e) => {
            warn!("Column check for issues.{} failed (db: {}): {}", column, db_name, e);
            false
        }
    }
}

/// The `SELECT` for [`query_issues`]; without a `defer_until` column the
/// field comes back as NULL instead of failing the whole read.
fn issues_query(db_name: &str, has_defer_until: bool) -> String {
    let defer_until = if has_defer_until {
        "DATE_FORMAT(defer_until, '%Y-%m-%dT%H:%i:%sZ') AS defer_until"
    } else {
        "NULL AS defer_until"
    };
    format!(
        "SELECT id, title, description, `design`, notes, status, priority, issue_type, \
         owner, assignee, \
         DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, \
         created_by, \
         DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at, \
         DATE_FORMAT(closed_at, '%Y-%m-%dT%H:%i:%sZ') AS closed_at, \
         close_reason, {} \
         FROM `{}`.issues",
        defer_until, db_name
    )
}

/// Queries issues from a Dolt database.
async fn query_issues(conn: &mut mysql_async::Conn, db_name: &str) -> Result<Vec<Bead>, DoltError> {
    let has_defer_until = issues_has_column(conn, db_name, "defer_until").await;
    let query = issues_query(db_name, has_defer_until);
    let rows: Vec<Row> = conn.query(&query).await
        .map_err(|e| DoltError::QueryFailed(format!("issues: {}", e)))?;

    Ok(rows.iter().map(|row| Bead {
        id: get_str(row, "id"),
        title: get_str(row, "title"),
        description: get_opt_str(row, "description"),
        status: get_opt_str(row, "status").unwrap_or_else(|| "open".to_string()),
        priority: row.get::<Option<i32>, _>("priority").flatten(),
        issue_type: get_opt_str(row, "issue_type"),
        owner: get_opt_str(row, "owner"),
        created_at: get_opt_str(row, "created_at"),
        created_by: get_opt_str(row, "created_by"),
        updated_at: get_opt_str(row, "updated_at"),
        closed_at: get_opt_str(row, "closed_at"),
        close_reason: get_opt_str(row, "close_reason"),
        defer_until: get_opt_str(row, "defer_until"),
        design: get_opt_str(row, "design"),
        notes: get_opt_str(row, "notes"),
        parent_id: None, children: None, deps: None,
        relates_to: None, comments: None, dependencies: None,
    }).collect())
}

/// Queries comments and merges them into beads.
async fn merge_comments(
    conn: &mut mysql_async::Conn,
    db_name: &str,
    mut beads: Vec<Bead>,
) -> Result<Vec<Bead>, DoltError> {
    let query = format!(
        "SELECT id, issue_id, author, text, \
         DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at \
         FROM `{}`.comments ORDER BY issue_id, id",
        db_name
    );
    let rows: Vec<Row> = conn.query(&query).await
        .map_err(|e| DoltError::QueryFailed(format!("comments: {}", e)))?;

    let mut map: HashMap<String, Vec<Comment>> = HashMap::new();
    for row in &rows {
        let issue_id = get_str(row, "issue_id");
        map.entry(issue_id.clone()).or_default().push(Comment {
            id: get_str(row, "id"),
            issue_id,
            author: get_str(row, "author"),
            text: get_str(row, "text"),
            created_at: get_str(row, "created_at"),
        });
    }
    for bead in &mut beads {
        if let Some(comments) = map.remove(&bead.id) {
            bead.comments = Some(comments);
        }
    }
    Ok(beads)
}

/// Layout of the `dependencies` table, which differs across bd versions.
///
/// bd 1.1.0 migrated the schema, so the shipped binary has to cope with both:
/// - bd 1.0.x: `depends_on_id NOT NULL`, primary key `(issue_id, depends_on_id)`.
/// - bd 1.1.x: `depends_on_id` split into nullable `depends_on_issue_id` /
///   `depends_on_wisp_id` / `depends_on_external` (exactly one is set), plus a
///   `char(36)` `id` primary key with no default.
struct DependencySchema {
    /// Column holding the dependency target issue.
    depends_on: String,
    /// Whether the table has the bd 1.1.x `id` primary key.
    has_id: bool,
}

/// Lists the `issues` columns that are NOT NULL without a default.
///
/// bd adds columns between releases; anything required that this build does not
/// know about gets an empty string in the insert instead of failing the write.
/// A failed introspection query degrades to "no extra columns" — the insert
/// then reports the real problem itself.
async fn issue_extra_columns(conn: &mut mysql_async::Conn, db_name: &str) -> Vec<String> {
    let schema_query = "SELECT COLUMN_NAME FROM information_schema.COLUMNS          WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'issues'          AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL          AND COLUMN_NAME NOT IN ('id', 'title', 'description', 'status', 'priority',          'issue_type', 'owner', 'created_at', 'updated_at')".to_string();

    conn.exec_map(
        schema_query,
        mysql_async::params! { "db" => db_name },
        |col_name: String| col_name,
    ).await.unwrap_or_default()
}

/// Builds the `INSERT` that creates an issue row.
///
/// `extra_cols` comes from [`issue_extra_columns`] and is filled with empty
/// strings; the rest are named parameters bound by the caller.
fn build_issue_insert(db_name: &str, extra_cols: &[String]) -> String {
    let mut columns = vec![
        "id", "title", "description", "status", "priority",
        "issue_type", "owner", "created_at", "updated_at",
    ];
    let mut values = vec![
        ":id", ":title", ":desc", "'open'", ":priority",
        ":type", "'web-ui'", ":now", ":now",
    ];

    for col in extra_cols {
        columns.push(col.as_str());
        values.push("''");
    }

    format_insert(db_name, "issues", &columns, &values)
}

/// Builds the `INSERT` that links a new issue to its parent.
fn build_dependency_insert(db_name: &str, schema: &DependencySchema) -> String {
    // `created_by` is NOT NULL with no default in both schemas.
    let mut columns = vec!["issue_id", schema.depends_on.as_str(), "type", "created_by"];
    let mut values = vec![":child", ":parent", "'parent-child'", "'web-ui'"];

    // bd 1.1.x keys the table on a char(36) `id` with no default, so an omitted
    // id would collide on the second insert. bd 1.0.x has no such column.
    if schema.has_id {
        columns.push("id");
        values.push(":dep_id");
    }

    format_insert(db_name, "dependencies", &columns, &values)
}

/// Assembles `INSERT INTO \`db\`.table (cols) VALUES (vals)` with quoted columns.
fn format_insert(db_name: &str, table: &str, columns: &[&str], values: &[&str]) -> String {
    format!(
        "INSERT INTO `{}`.{} ({}) VALUES ({})",
        db_name,
        table,
        columns.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", "),
        values.join(", "),
    )
}

/// Detects the `dependencies` table layout from the live schema.
///
/// A plain rename would break users still on bd 1.0.x, so the column names are
/// resolved at runtime instead of hardcoded.
async fn dependency_schema(
    conn: &mut mysql_async::Conn,
    db_name: &str,
) -> Result<DependencySchema, DoltError> {
    let cols: Vec<String> = conn.exec_map(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'dependencies'",
        mysql_async::params! { "db" => db_name },
        |col_name: String| col_name,
    ).await.map_err(|e| DoltError::QueryFailed(format!("dependencies schema: {}", e)))?;

    // Prefer the bd 1.1.x name if both are somehow present.
    let depends_on = ["depends_on_issue_id", "depends_on_id"]
        .into_iter()
        .find(|candidate| cols.iter().any(|got| got == candidate))
        .ok_or_else(|| DoltError::QueryFailed(format!(
            "dependencies: neither `depends_on_issue_id` (bd 1.1.x) nor \
             `depends_on_id` (bd 1.0.x) found in `{}`",
            db_name
        )))?
        .to_string();

    Ok(DependencySchema {
        has_id: cols.iter().any(|c| c == "id"),
        depends_on,
    })
}

/// Queries dependencies and merges parent/blocking/related into beads.
async fn merge_dependencies(
    conn: &mut mysql_async::Conn,
    db_name: &str,
    beads: &mut [Bead],
) -> Result<(), DoltError> {
    let schema = dependency_schema(conn, db_name).await?;
    let query = format!(
        "SELECT issue_id, `{}` AS depends_on, `type` FROM `{}`.dependencies",
        schema.depends_on, db_name
    );
    let rows: Vec<Row> = conn.query(&query).await
        .map_err(|e| DoltError::QueryFailed(format!("dependencies: {}", e)))?;

    let mut parent_map: HashMap<String, String> = HashMap::new();
    let mut blocking_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut related_map: HashMap<String, Vec<String>> = HashMap::new();

    for row in &rows {
        let issue_id = get_str(row, "issue_id");
        let depends_on = get_str(row, "depends_on");
        // On bd 1.1.x a row may instead target a wisp or an external ref, leaving
        // depends_on_issue_id NULL — there is no bead on the board to link to.
        if depends_on.is_empty() {
            continue;
        }
        match get_str(row, "type").as_str() {
            "parent-child" | "parent" => { parent_map.insert(issue_id, depends_on); }
            "relates-to" | "related" => { related_map.entry(issue_id).or_default().push(depends_on); }
            _ => { blocking_map.entry(issue_id).or_default().push(depends_on); }
        }
    }

    for bead in beads.iter_mut() {
        if let Some(pid) = parent_map.remove(&bead.id) { bead.parent_id = Some(pid); }
        if let Some(b) = blocking_map.remove(&bead.id) { bead.deps = Some(b); }
        if let Some(r) = related_map.remove(&bead.id) { bead.relates_to = Some(r); }
    }
    Ok(())
}

/// A discovered Dolt database.
#[derive(Debug, serde::Serialize)]
pub struct DoltDatabase {
    /// Full database name (e.g. `beads_ai-photo-factory`)
    pub name: String,
    /// Derived project name (e.g. `ai-photo-factory`)
    pub project_name: String,
}

/// Metadata from `.beads/metadata.json`.
#[derive(Debug, Deserialize)]
struct BeadsMetadata {
    #[serde(default)]
    backend: Option<String>,
    #[serde(default)]
    dolt_database: Option<String>,
}

/// Config from `.beads/config.yaml`.
#[derive(Debug, Deserialize)]
struct BeadsConfig {
    #[serde(default, rename = "issue-prefix")]
    issue_prefix: Option<String>,
}

/// Resolves the Dolt database name for a project path.
///
/// Checks `.beads/metadata.json` → `dolt_database` field first,
/// then falls back to `beads_` + issue-prefix from config.yaml.
/// Returns `None` if the project doesn't use Dolt backend.
pub fn database_name_for_project(project_path: &Path) -> Option<String> {
    // Try metadata.json first
    let metadata_path = project_path.join(".beads").join("metadata.json");
    if let Ok(contents) = std::fs::read_to_string(&metadata_path) {
        if let Ok(meta) = serde_json::from_str::<BeadsMetadata>(&contents) {
            // Only use Dolt if backend is explicitly "dolt"
            if meta.backend.as_deref() != Some("dolt") {
                return None;
            }
            if let Some(db_name) = meta.dolt_database {
                if !db_name.is_empty() {
                    return Some(db_name);
                }
            }
        }
    }

    // Fallback: beads_ + issue-prefix from config.yaml
    let config_path = project_path.join(".beads").join("config.yaml");
    if let Ok(contents) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_yaml::from_str::<BeadsConfig>(&contents) {
            if let Some(prefix) = config.issue_prefix {
                if !prefix.is_empty() {
                    return Some(format!("beads_{}", prefix));
                }
            }
        }
    }

    // Last resort: derive from directory name
    project_path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| format!("beads_{}", name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // ── status.custom query ─────────────────────────────────────────────

    #[test]
    fn status_custom_query_quotes_names() {
        assert_eq!(
            status_custom_query("beads_x"),
            "SELECT `value` FROM `beads_x`.`config` WHERE `key` = 'status.custom'"
        );
    }

    #[test]
    fn status_custom_query_escapes_backticks_in_db_name() {
        assert!(status_custom_query("a`b").starts_with("SELECT `value` FROM `a``b`.`config`"));
    }

    // ── database_name_for_project tests ─────────────────────────────────

    #[test]
    fn test_db_name_from_metadata_json() {
        // When metadata.json has backend=dolt and dolt_database set, use it
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("my-project");
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("metadata.json"),
            r#"{"backend": "dolt", "dolt_database": "beads_custom_name"}"#,
        )
        .unwrap();

        assert_eq!(
            database_name_for_project(&project),
            Some("beads_custom_name".to_string())
        );
    }

    #[test]
    fn test_db_name_non_dolt_backend_returns_none() {
        // When backend is not "dolt", return None even if dolt_database is set
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("my-project");
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("metadata.json"),
            r#"{"backend": "jsonl", "dolt_database": "beads_something"}"#,
        )
        .unwrap();

        assert_eq!(database_name_for_project(&project), None);
    }

    #[test]
    fn test_db_name_dolt_backend_empty_db_name_falls_through() {
        // backend=dolt but dolt_database is empty -> fall through to config.yaml
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("my-project");
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("metadata.json"),
            r#"{"backend": "dolt", "dolt_database": ""}"#,
        )
        .unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "issue-prefix: cool-project\n",
        )
        .unwrap();

        assert_eq!(
            database_name_for_project(&project),
            Some("beads_cool-project".to_string())
        );
    }

    #[test]
    fn test_db_name_from_config_yaml_issue_prefix() {
        // No metadata.json, but config.yaml has issue-prefix
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("my-project");
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "issue-prefix: ai-photo-factory\n",
        )
        .unwrap();

        assert_eq!(
            database_name_for_project(&project),
            Some("beads_ai-photo-factory".to_string())
        );
    }

    #[test]
    fn test_db_name_from_directory_name_fallback() {
        // No metadata.json, no config.yaml -> derive from directory name
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("awesome-app");
        std::fs::create_dir_all(&project).unwrap();

        assert_eq!(
            database_name_for_project(&project),
            Some("beads_awesome-app".to_string())
        );
    }

    #[test]
    fn test_db_name_empty_issue_prefix_falls_through() {
        // config.yaml with empty issue-prefix -> fall through to directory name
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("fallback-dir");
        let beads_dir = project.join(".beads");
        std::fs::create_dir_all(&beads_dir).unwrap();
        std::fs::write(
            beads_dir.join("config.yaml"),
            "issue-prefix: \"\"\n",
        )
        .unwrap();

        assert_eq!(
            database_name_for_project(&project),
            Some("beads_fallback-dir".to_string())
        );
    }

    #[test]
    fn test_db_name_root_path_returns_none() {
        // Root path has no file_name() -> returns None
        let root = PathBuf::from("/");
        // Root path: file_name() returns None on Unix-style roots
        // On Windows this may differ, so we test the logic directly
        if root.file_name().is_none() {
            assert_eq!(database_name_for_project(&root), None);
        }
    }

    // ── DoltDatabase serialization test ─────────────────────────────────

    #[test]
    fn test_dolt_database_serializes_correctly() {
        let db = DoltDatabase {
            name: "beads_ai-photo-factory".to_string(),
            project_name: "ai-photo-factory".to_string(),
        };

        let json = serde_json::to_string(&db).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["name"], "beads_ai-photo-factory");
        assert_eq!(parsed["project_name"], "ai-photo-factory");
    }

    #[test]
    fn test_dolt_database_serializes_both_fields() {
        let db = DoltDatabase {
            name: "beads_test".to_string(),
            project_name: "test".to_string(),
        };

        let json = serde_json::to_string(&db).unwrap();
        // Verify both fields are present
        assert!(json.contains("\"name\""));
        assert!(json.contains("\"project_name\""));
        // Verify no extra fields
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let obj = parsed.as_object().unwrap();
        assert_eq!(obj.len(), 2);
    }
    // ── create_bead statement builders ──────────────────────────────────

    #[test]
    fn test_issue_insert_has_the_base_columns() {
        let query = build_issue_insert("beads_demo", &[]);

        assert!(query.starts_with("INSERT INTO `beads_demo`.issues ("));
        for col in ["id", "title", "description", "status", "priority",
                    "issue_type", "owner", "created_at", "updated_at"] {
            assert!(query.contains(&format!("`{}`", col)), "missing column {} in {}", col, query);
        }
        // A new bead always starts open, and the web UI owns the row.
        assert!(query.contains("'open'"));
        assert!(query.contains("'web-ui'"));
    }

    #[test]
    fn test_issue_insert_fills_extra_not_null_columns_with_empty_strings() {
        // Columns the live schema reports as NOT NULL without a default get an
        // empty value so the insert does not fail on a schema we have not seen.
        let extra = vec!["created_by".to_string(), "source_repo".to_string()];
        let query = build_issue_insert("beads_demo", &extra);

        assert!(query.contains("`created_by`"));
        assert!(query.contains("`source_repo`"));
        // Nine placeholders/literals for the base columns, plus one '' each.
        assert_eq!(query.matches("''").count(), 2);
    }

    #[test]
    fn test_dependency_insert_uses_the_resolved_target_column() {
        // bd 1.1.x renamed depends_on_id -> depends_on_issue_id.
        let schema = DependencySchema {
            depends_on: "depends_on_issue_id".to_string(),
            has_id: false,
        };
        let query = build_dependency_insert("beads_demo", &schema);

        assert!(query.starts_with("INSERT INTO `beads_demo`.dependencies ("));
        assert!(query.contains("`depends_on_issue_id`"));
        assert!(!query.contains("depends_on_id`"));
        assert!(query.contains("'parent-child'"));
        // No `id` column in bd 1.0.x, so no placeholder for it either.
        assert!(!query.contains(":dep_id"));
    }

    #[test]
    fn test_dependency_insert_supplies_an_id_when_the_schema_has_one() {
        // bd 1.1.x keys the table on a char(36) id with no default: without a
        // value the second insert of a session collides on the primary key.
        let schema = DependencySchema {
            depends_on: "depends_on_issue_id".to_string(),
            has_id: true,
        };
        let query = build_dependency_insert("beads_demo", &schema);

        assert!(query.contains("`id`"));
        assert!(query.contains(":dep_id"));
    }

    // ── defer date: reading ─────────────────────────────────────────────

    #[test]
    fn test_issues_query_reads_defer_until_when_the_column_exists() {
        let query = issues_query("beads_demo", true);
        assert!(query.contains("DATE_FORMAT(defer_until, '%Y-%m-%dT%H:%i:%sZ') AS defer_until"));
        assert!(query.contains("FROM `beads_demo`.issues"));
    }

    #[test]
    fn test_issues_query_without_the_column_selects_null() {
        // Old schemas have no defer_until: selecting it would fail the whole read.
        let query = issues_query("beads_demo", false);
        assert!(query.contains("NULL AS defer_until"));
        assert!(!query.contains("DATE_FORMAT(defer_until"));
    }

    // ── defer date: writing ─────────────────────────────────────────────

    #[test]
    fn test_sql_defer_value_empty_clears() {
        assert_eq!(sql_defer_value("  "), Ok(None));
    }

    #[test]
    fn test_sql_defer_value_accepts_a_date() {
        assert_eq!(sql_defer_value("2026-10-10"), Ok(Some("2026-10-10 00:00:00".to_string())));
    }

    #[test]
    fn test_sql_defer_value_accepts_rfc3339_in_utc() {
        assert_eq!(
            sql_defer_value("2026-10-10T00:00:00+04:00"),
            Ok(Some("2026-10-09 20:00:00".to_string()))
        );
    }

    #[test]
    fn test_sql_defer_value_rejects_words() {
        // bd understands "+1w" or "tomorrow"; SQL does not, so say so up front.
        assert!(sql_defer_value("tomorrow").is_err());
    }

    fn set_clauses(update: &BeadUpdate<'_>) -> Vec<String> {
        update_sets(update).0
    }

    #[test]
    fn test_update_sets_defer_moves_the_bead_to_deferred() {
        let update = BeadUpdate { defer_until: Some(Some("2026-10-10 00:00:00".into())), ..Default::default() };
        let sets = set_clauses(&update);
        assert!(sets.contains(&"defer_until = :defer_until".to_string()));
        assert!(sets.contains(&"status = 'deferred'".to_string()));
    }

    #[test]
    fn test_update_sets_clearing_defer_reopens_a_deferred_bead() {
        let update = BeadUpdate { defer_until: Some(None), ..Default::default() };
        let sets = set_clauses(&update);
        assert!(sets.contains(&"defer_until = NULL".to_string()));
        assert!(sets.contains(&"status = CASE WHEN status = 'deferred' THEN 'open' ELSE status END".to_string()));
    }

    #[test]
    fn test_update_sets_explicit_status_wins_over_defer() {
        let update = BeadUpdate {
            status: Some("open"),
            issue_type: Some("epic"),
            defer_until: Some(None),
            ..Default::default()
        };
        let sets = set_clauses(&update);
        assert_eq!(sets, vec!["status = :status", "issue_type = :issue_type", "defer_until = NULL"]);
    }

    #[test]
    fn test_update_sets_without_defer_do_not_touch_it() {
        let update = BeadUpdate { title: Some("T"), ..Default::default() };
        assert_eq!(set_clauses(&update), vec!["title = :title"]);
    }
}
