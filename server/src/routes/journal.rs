//! In-memory copy of a project's beads, kept fresh through the `bd events`
//! journal.
//!
//! Embedded Dolt projects cannot answer `bd sql`, so every `/api/beads` read
//! used to end in a full `bd export`. When the project has the events journal
//! turned on, the server instead reads everything once (the baseline) and then
//! only asks `bd events tail --since N` for what changed.

use serde::Deserialize;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

use super::beads::{Bead, Comment, LegacyDependency, RawDependencies};

/// One line of `bd events tail --json`.
#[derive(Debug, Deserialize)]
pub(crate) struct JournalRecord {
    pub seq: i64,
    pub op: String,
    pub issue_id: String,
    /// Full issue state after the change; `null` on delete. Carries neither
    /// comments nor dependencies.
    #[serde(default)]
    pub issue: Option<Bead>,
    #[serde(default)]
    pub dep: Option<JournalDep>,
    #[serde(default)]
    pub comment: Option<JournalComment>,
}

/// The `dep` part of a `dep_add` / `dep_remove` record.
#[derive(Debug, Deserialize)]
pub(crate) struct JournalDep {
    pub kind: String,
    pub target: String,
}

/// The `comment` part of a `comment` record.
#[derive(Debug, Deserialize)]
pub(crate) struct JournalComment {
    #[serde(deserialize_with = "super::beads::deserialize_comment_id")]
    pub id: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub created_at: String,
}

/// A project's beads as `bd list --json --all` returns them, with comments
/// attached and dependencies not yet post-processed.
#[derive(Debug, Default)]
pub(crate) struct ProjectCopy {
    beads: Vec<Bead>,
}

impl ProjectCopy {
    pub fn new(beads: Vec<Bead>) -> Self {
        Self { beads }
    }

    pub fn beads(&self) -> &[Bead] {
        &self.beads
    }

    /// Number of comments across all beads.
    pub fn comment_total(&self) -> usize {
        self.beads
            .iter()
            .map(|b| b.comments.as_ref().map_or(0, |c| c.len()))
            .sum()
    }

    /// Applies one journal record to the copy.
    ///
    /// Every record except `delete` carries the issue state after the change,
    /// so that is applied first; the op then adds what the state leaves out
    /// (links and comments).
    pub fn apply(&mut self, record: JournalRecord) {
        if record.op == "delete" {
            self.remove(&record.issue_id);
            return;
        }
        if let Some(issue) = record.issue {
            self.upsert(issue);
        }
        match record.op.as_str() {
            "dep_add" | "dep_remove" => self.apply_dep(&record.op, &record.issue_id, record.dep),
            "comment" => self.add_comment(&record.issue_id, record.comment),
            _ => {}
        }
    }

    fn position(&self, id: &str) -> Option<usize> {
        self.beads.iter().position(|b| b.id == id)
    }

    /// Replaces a bead's fields, keeping what the journal never sends:
    /// comments, dependencies and the parent.
    fn upsert(&mut self, mut issue: Bead) {
        let Some(pos) = self.position(&issue.id) else {
            self.beads.push(issue);
            return;
        };
        let old = &mut self.beads[pos];
        issue.comments = old.comments.take();
        issue.dependencies = old.dependencies.take();
        if issue.parent_id.is_none() {
            issue.parent_id = old.parent_id.take();
        }
        *old = issue;
    }

    fn remove(&mut self, id: &str) {
        self.beads.retain(|b| b.id != id);
        // bd sends dep_remove rows before a delete; this only guards against
        // a link that slipped through, so no bead points at a missing one.
        for bead in &mut self.beads {
            remove_link(bead, id);
        }
    }

    fn apply_dep(&mut self, op: &str, issue_id: &str, dep: Option<JournalDep>) {
        let (Some(dep), Some(pos)) = (dep, self.position(issue_id)) else {
            tracing::debug!(
                issue_id,
                op,
                "journal link record without dep or bead, skipped"
            );
            return;
        };
        let bead = &mut self.beads[pos];
        remove_link(bead, &dep.target);
        if op == "dep_remove" {
            return;
        }
        if dep.kind == "parent-child" {
            bead.parent_id = Some(dep.target.clone());
        }
        edit_links(bead, |links| {
            links.push(LegacyDependency {
                depends_on_id: dep.target,
                dep_type: dep.kind,
            })
        });
    }

    fn add_comment(&mut self, issue_id: &str, comment: Option<JournalComment>) {
        let (Some(comment), Some(pos)) = (comment, self.position(issue_id)) else {
            tracing::debug!(
                issue_id,
                "journal comment record without comment or bead, skipped"
            );
            return;
        };
        let comments = self.beads[pos].comments.get_or_insert_with(Vec::new);
        if comments.iter().any(|c| c.id == comment.id) {
            return;
        }
        comments.push(Comment {
            id: comment.id,
            issue_id: issue_id.to_string(),
            author: comment.author,
            text: comment.text,
            created_at: comment.created_at,
        });
    }
}

/// Drops the bead's link to `target` (bd keeps at most one link per pair) and
/// clears the parent when that link was it.
fn remove_link(bead: &mut Bead, target: &str) {
    if bead.parent_id.as_deref() == Some(target) {
        bead.parent_id = None;
    }
    if bead.dependencies.is_some() {
        edit_links(bead, |links| links.retain(|l| l.depends_on_id != target));
    }
}

/// Edits a bead's links in the `bd list` shape (`depends_on_id` + `type`),
/// converting the flat-id shape of older bd versions on the way.
fn edit_links(bead: &mut Bead, edit: impl FnOnce(&mut Vec<LegacyDependency>)) {
    let mut links = match bead.dependencies.take() {
        Some(RawDependencies::Legacy(links)) => links,
        Some(RawDependencies::StringIds(ids)) => ids
            .into_iter()
            .map(|id| LegacyDependency {
                depends_on_id: id,
                dep_type: "blocks".to_string(),
            })
            .collect(),
        None => Vec::new(),
    };
    edit(&mut links);
    if !links.is_empty() {
        bead.dependencies = Some(RawDependencies::Legacy(links));
    }
}

/// Returns `true` when the events journal is on for the project.
///
/// The check is required: with the journal off, `bd events tail` prints
/// nothing and exits 0, which would look like "no changes" forever.
pub fn journal_enabled(project_path: &Path) -> bool {
    let env = std::env::var("BD_EVENTS_JOURNAL").ok();
    let config = std::fs::read_to_string(project_path.join(".beads").join("config.yaml")).ok();
    journal_flag(env.as_deref(), config.as_deref())
}

/// The env var `BD_EVENTS_JOURNAL`, when set, wins over the `events-journal`
/// key in `.beads/config.yaml`.
fn journal_flag(env: Option<&str>, config_yaml: Option<&str>) -> bool {
    if let Some(value) = env {
        return is_truthy(value);
    }
    let Some(yaml) = config_yaml.and_then(|c| serde_yaml::from_str::<serde_yaml::Value>(c).ok())
    else {
        return false;
    };
    match yaml.get("events-journal") {
        Some(serde_yaml::Value::Bool(on)) => *on,
        Some(serde_yaml::Value::String(s)) => is_truthy(s),
        _ => false,
    }
}

fn is_truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

/// Reads the head seq out of an `events_journal_truncated` error.
fn truncated_head(text: &str) -> Option<i64> {
    let value: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    if value.get("code")?.as_str()? != "events_journal_truncated" {
        return None;
    }
    value.get("head")?.as_i64()
}

/// Reads made with an anchor ask for `--since anchor-1`, so the first record
/// must be the one seen last time. Returns the records after it, or `None`
/// when it is missing — the journal was replaced and its numbers mean
/// something else now.
fn strip_anchor(mut records: Vec<JournalRecord>, anchor: i64) -> Option<Vec<JournalRecord>> {
    if anchor <= 0 {
        return Some(records);
    }
    if records.first().map(|r| r.seq) != Some(anchor) {
        return None;
    }
    records.remove(0);
    Some(records)
}

// ---------------------------------------------------------------------------
// Reading `bd events tail`
// ---------------------------------------------------------------------------

/// A catch-up read: normally a handful of records since the last poll.
const TAIL_TIMEOUT: Duration = Duration::from_secs(30);
/// A scan for the head seq may read the whole retained journal: ~2 s per 10k
/// records measured with bd 1.3.0, and bd keeps up to 100k by default.
const HEAD_SCAN_TIMEOUT: Duration = Duration::from_secs(180);
/// Keep at most this much of the non-record output (the error JSON is ~250 B).
const OTHER_OUTPUT_LIMIT: usize = 64 * 1024;

enum TailEnd {
    Done,
    Truncated { head: i64 },
}

/// Runs `bd events tail --since N --json` and hands each record line to
/// `on_record` as it arrives, so a large journal is never held in memory.
///
/// The truncation error comes as JSON on stdout with exit code 1, so stdout
/// is kept on failure too (unlike `run_bd`, which only reports stderr).
async fn stream_tail(
    project_path: &Path,
    since: i64,
    limit: Duration,
    mut on_record: impl FnMut(&str) -> Result<(), String>,
) -> Result<TailEnd, String> {
    let bd = super::find_bd().ok_or_else(|| "bd CLI not found".to_string())?;
    let since = since.to_string();
    let mut child = Command::new(bd)
        .args(["events", "tail", "--since", &since, "--json"])
        .current_dir(project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to run bd events tail: {}", e))?;
    let stdout = child.stdout.take().ok_or("bd events tail: no stdout")?;
    let mut stderr = child.stderr.take().ok_or("bd events tail: no stderr")?;

    let work = async {
        let read_err = async {
            // Only used as text for an error message; a read failure just
            // leaves it shorter.
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text).await;
            text
        };
        let (other, err_text) = tokio::join!(read_lines(stdout, &mut on_record), read_err);
        let status = child
            .wait()
            .await
            .map_err(|e| format!("bd events tail: {}", e))?;
        Ok::<_, String>((other?, err_text, status))
    };
    let (other, err_text, status) = tokio::time::timeout(limit, work)
        .await
        .map_err(|_| format!("bd events tail timed out after {}s", limit.as_secs()))??;

    if status.success() {
        return Ok(TailEnd::Done);
    }
    match truncated_head(&other) {
        Some(head) => Ok(TailEnd::Truncated { head }),
        None => Err(format!(
            "bd events tail exited with {}: {}{}",
            status,
            other.trim(),
            err_text.trim()
        )),
    }
}

/// Feeds record lines to `on_record`; returns the other stdout lines.
///
/// After the first bad record the rest is still read (and dropped), so bd
/// never blocks on a full pipe while we wait for it to exit.
async fn read_lines(
    stdout: tokio::process::ChildStdout,
    on_record: &mut impl FnMut(&str) -> Result<(), String>,
) -> Result<String, String> {
    let mut lines = BufReader::new(stdout).lines();
    let mut other = String::new();
    let mut failure = None;
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("bd events tail: {}", e))?
    {
        if !line.starts_with("{\"seq\":") {
            if other.len() < OTHER_OUTPUT_LIMIT {
                other.push_str(&line);
                other.push('\n');
            }
        } else if failure.is_none() {
            failure = on_record(&line).err();
        }
    }
    failure.map_or(Ok(other), Err)
}

enum Fetch {
    Records(Vec<JournalRecord>),
    /// The records we need were pruned, or the journal was replaced.
    Lost(String),
}

/// Reads the records after `seq`. With `anchored`, also checks that record
/// `seq` itself is still there (see [`strip_anchor`]).
async fn fetch_after(project_path: &Path, seq: i64, anchored: bool) -> Result<Fetch, String> {
    let anchor = if anchored { seq } else { 0 };
    let since = if anchor > 0 { seq - 1 } else { seq };
    let mut records = Vec::new();
    let end = stream_tail(project_path, since, TAIL_TIMEOUT, |line| {
        let record = serde_json::from_str::<JournalRecord>(line)
            .map_err(|e| format!("Bad journal record: {}", e))?;
        records.push(record);
        Ok(())
    })
    .await?;
    if let TailEnd::Truncated { head } = end {
        return Ok(Fetch::Lost(format!(
            "journal truncated below {} (head {})",
            since, head
        )));
    }
    Ok(match strip_anchor(records, anchor) {
        Some(records) => Fetch::Records(records),
        None => Fetch::Lost(format!("journal record {} is gone", anchor)),
    })
}

#[derive(Deserialize)]
struct SeqOnly {
    seq: i64,
}

/// Finds the highest seq in the journal. There is no direct command for it:
/// `--since` past the head just prints nothing. With a previous seq as a
/// hint only the records after it are read; otherwise the whole retained
/// journal is (or the truncation error reports the head).
async fn find_head(project_path: &Path, hint: i64) -> Result<i64, String> {
    if hint > 0 {
        if let Some(head) = scan_head(project_path, hint - 1, Some(hint)).await? {
            return Ok(head);
        }
    }
    Ok(scan_head(project_path, 0, None).await?.unwrap_or(0))
}

/// Returns the last seq after `since` (or `since` when there is none), or
/// `None` when the first record is not `expect_first`.
async fn scan_head(
    project_path: &Path,
    since: i64,
    expect_first: Option<i64>,
) -> Result<Option<i64>, String> {
    let (mut first, mut last) = (None, None);
    let end = stream_tail(project_path, since, HEAD_SCAN_TIMEOUT, |line| {
        let seq = serde_json::from_str::<SeqOnly>(line)
            .map_err(|e| format!("Bad journal record: {}", e))?
            .seq;
        first.get_or_insert(seq);
        last = Some(seq);
        Ok(())
    })
    .await?;
    if let TailEnd::Truncated { head } = end {
        return Ok(Some(head));
    }
    if expect_first.is_some() && first != expect_first {
        return Ok(None);
    }
    Ok(Some(last.unwrap_or(since)))
}

// ---------------------------------------------------------------------------
// Per-project cache
// ---------------------------------------------------------------------------

/// Safety net: re-read everything this often. `bd dolt pull` is not
/// journaled, and a replaced database starts its numbers over.
const REBASELINE_AFTER: Duration = Duration::from_secs(10 * 60);

struct CachedProject {
    copy: ProjectCopy,
    seq: i64,
    baseline_at: Instant,
    /// When the last refresh started; a request that arrived before it can
    /// reuse the copy instead of calling bd again.
    refreshed_at: Instant,
}

type Slot = Arc<tokio::sync::Mutex<Option<CachedProject>>>;

/// Journal-backed copies of filesystem projects, one per project path.
///
/// Each project has its own async lock, so at most one bd call per project
/// runs at a time; parallel requests wait and reuse the fresh copy.
#[derive(Default)]
pub struct JournalCache {
    slots: std::sync::Mutex<HashMap<PathBuf, Slot>>,
}

/// Beads (dependencies not yet post-processed) plus the comment total.
pub type JournalRead = (Vec<Bead>, usize);

impl JournalCache {
    fn slot(&self, project_path: &Path) -> Slot {
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        slots.entry(project_path.to_path_buf()).or_default().clone()
    }

    /// Drops the project's copy. Called when the journal is off: changes made
    /// meanwhile are not journaled, so an old copy must not be resumed later.
    pub fn forget(&self, project_path: &Path) {
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        if slots.remove(project_path).is_some() {
            tracing::info!(project = %project_path.display(), "events journal is off, dropped the in-memory copy");
        }
    }

    /// Returns the project's beads, catching up with the journal first.
    /// `full` forces a complete re-read.
    ///
    /// Dropping this future mid-way is safe: a catch-up changes the copy only
    /// after the whole tail is read, and a full read runs in its own task
    /// (see [`store_detached`]).
    pub async fn read(&self, project_path: &Path, full: bool) -> Result<JournalRead, String> {
        let arrived = Instant::now();
        let mut guard = self.slot(project_path).lock_owned().await;

        if let Some(cached) = guard.as_mut() {
            let stale = full || cached.baseline_at.elapsed() >= REBASELINE_AFTER;
            if !stale {
                if cached.refreshed_at >= arrived {
                    return Ok(snapshot(cached));
                }
                if catch_up(project_path, cached).await? {
                    return Ok(snapshot(cached));
                }
            }
        }

        let hint = guard.as_ref().map_or(0, |c| c.seq);
        let path = project_path.to_path_buf();
        let work = async move { baseline(&path, hint).await };
        store_detached(guard, project_path.to_path_buf(), work).await
    }
}

type SlotGuard = tokio::sync::OwnedMutexGuard<Option<CachedProject>>;

/// Runs a full read in a task of its own, which keeps the project's lock and
/// stores the fresh copy in the slot itself.
///
/// A full read of a large project takes 10-25 s. When the page gives up on
/// the request, axum drops this future — but not the task, so the read still
/// finishes and the next request gets the copy instead of starting over.
/// A panic in the task arrives here as an error; the old copy stays.
async fn store_detached<F>(
    mut guard: SlotGuard,
    project_path: PathBuf,
    work: F,
) -> Result<JournalRead, String>
where
    F: Future<Output = Result<CachedProject, String>> + Send + 'static,
{
    let (reply, answer) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let outcome = work.await.map(|fresh| {
            let read = snapshot(&fresh);
            *guard = Some(fresh);
            read
        });
        drop(guard);
        if let Err(outcome) = reply.send(outcome) {
            report_unclaimed(&project_path, outcome);
        }
    });
    answer
        .await
        .map_err(|_| "journal baseline task stopped unexpectedly".to_string())?
}

/// Logs the result of a full read whose request is gone: nobody else will.
fn report_unclaimed(project_path: &Path, outcome: Result<JournalRead, String>) {
    match outcome {
        Ok((beads, _)) => tracing::info!(
            project = %project_path.display(),
            beads = beads.len(),
            "journal baseline finished after its request was gone, copy kept"
        ),
        Err(error) => tracing::warn!(
            project = %project_path.display(),
            error,
            "journal baseline failed after its request was gone"
        ),
    }
}

fn snapshot(cached: &CachedProject) -> JournalRead {
    (cached.copy.beads().to_vec(), cached.copy.comment_total())
}

/// Applies new records to the copy. Returns `false` when the journal can no
/// longer be followed and a full re-read is needed.
async fn catch_up(project_path: &Path, cached: &mut CachedProject) -> Result<bool, String> {
    let started = Instant::now();
    let records = match fetch_after(project_path, cached.seq, true).await? {
        Fetch::Records(records) => records,
        Fetch::Lost(reason) => {
            tracing::info!(project = %project_path.display(), reason, "journal catch-up lost its place, re-reading everything");
            return Ok(false);
        }
    };
    let count = records.len();
    apply_all(&mut cached.copy, &mut cached.seq, records);
    cached.refreshed_at = started;
    if count > 0 {
        tracing::info!(project = %project_path.display(), records = count, seq = cached.seq, "journal catch-up applied");
    } else {
        tracing::debug!(project = %project_path.display(), seq = cached.seq, "journal catch-up: no changes");
    }
    Ok(true)
}

fn apply_all(copy: &mut ProjectCopy, seq: &mut i64, records: Vec<JournalRecord>) {
    for record in records {
        *seq = record.seq;
        copy.apply(record);
    }
}

/// Full read: find the head, read everything through the bd CLI, then apply
/// the records written in the meantime.
async fn baseline(project_path: &Path, hint: i64) -> Result<CachedProject, String> {
    let started = Instant::now();
    tracing::info!(project = %project_path.display(), "journal baseline started");

    let head = find_head(project_path, hint).await?;
    let (beads, _) = super::beads::read_beads_from_cli(project_path, None).await?;
    let mut copy = ProjectCopy::new(beads);
    let mut seq = head;
    let records = match fetch_after(project_path, head, false).await? {
        Fetch::Records(records) => records,
        Fetch::Lost(reason) => {
            return Err(format!("journal moved during the baseline: {}", reason))
        }
    };
    apply_all(&mut copy, &mut seq, records);

    tracing::info!(
        project = %project_path.display(),
        duration_ms = started.elapsed().as_millis() as u64,
        beads = copy.beads().len(),
        comments = copy.comment_total(),
        seq,
        "journal baseline finished"
    );
    Ok(CachedProject {
        copy,
        seq,
        baseline_at: started,
        refreshed_at: started,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(line: &str) -> JournalRecord {
        serde_json::from_str(line).expect("valid journal record")
    }

    fn bead(json: &str) -> Bead {
        serde_json::from_str(json).expect("valid bead")
    }

    fn find<'a>(copy: &'a ProjectCopy, id: &str) -> &'a Bead {
        copy.beads()
            .iter()
            .find(|b| b.id == id)
            .expect("bead present")
    }

    fn dep_pairs(bead: &Bead) -> Vec<(String, String)> {
        match &bead.dependencies {
            Some(RawDependencies::Legacy(deps)) => deps
                .iter()
                .map(|d| (d.depends_on_id.clone(), d.dep_type.clone()))
                .collect(),
            Some(RawDependencies::StringIds(ids)) => ids
                .iter()
                .map(|id| (id.clone(), "blocks".to_string()))
                .collect(),
            None => Vec::new(),
        }
    }

    /// Shape of `bd list --json --all` in bd 1.3.0 for a child with a blocker.
    fn listed_child() -> Bead {
        bead(
            r#"{"id":"t-1.1","title":"Child","status":"open","priority":2,
            "dependencies":[
              {"issue_id":"t-1.1","depends_on_id":"t-1","type":"parent-child","metadata":"{}"},
              {"issue_id":"t-1.1","depends_on_id":"t-2","type":"blocks","metadata":"{}"}],
            "parent":"t-1",
            "comments":[{"id":"c-1","issue_id":"t-1.1","author":"a","text":"hi","created_at":"2026-09-28T00:00:00Z"}]}"#,
        )
    }

    #[test]
    fn create_adds_a_bead() {
        let mut copy = ProjectCopy::default();
        copy.apply(record(
            r#"{"seq":1,"op":"create","issue_id":"t-1","actor":"a",
            "issue":{"id":"t-1","title":"Epic","status":"open","priority":2,"issue_type":"epic"}}"#,
        ));
        assert_eq!(copy.beads().len(), 1);
        assert_eq!(find(&copy, "t-1").title, "Epic");
    }

    #[test]
    fn update_replaces_fields_and_keeps_comments_deps_and_parent() {
        let mut copy = ProjectCopy::new(vec![listed_child()]);
        copy.apply(record(
            r#"{"seq":5,"op":"update","issue_id":"t-1.1","actor":"a",
            "issue":{"id":"t-1.1","title":"Renamed","status":"in_progress","priority":1}}"#,
        ));
        let b = find(&copy, "t-1.1");
        assert_eq!(b.title, "Renamed");
        assert_eq!(b.status, "in_progress");
        assert_eq!(b.priority, Some(1));
        assert_eq!(b.comments.as_ref().map(|c| c.len()), Some(1));
        assert_eq!(b.parent_id.as_deref(), Some("t-1"));
        assert_eq!(dep_pairs(b).len(), 2);
    }

    #[test]
    fn close_updates_status_and_close_fields() {
        let mut copy = ProjectCopy::new(vec![listed_child()]);
        copy.apply(record(
            r#"{"seq":6,"op":"close","issue_id":"t-1.1","actor":"a",
            "issue":{"id":"t-1.1","title":"Child","status":"closed",
            "closed_at":"2026-09-28T10:00:00Z","close_reason":"done"}}"#,
        ));
        let b = find(&copy, "t-1.1");
        assert_eq!(b.status, "closed");
        assert_eq!(b.close_reason.as_deref(), Some("done"));
        assert_eq!(b.comments.as_ref().map(|c| c.len()), Some(1));
    }

    #[test]
    fn update_for_unknown_bead_inserts_it() {
        // Close/claim may emit updates without an actor for other beads whose
        // blocked state changed; they must simply be applied.
        let mut copy = ProjectCopy::default();
        copy.apply(record(
            r#"{"seq":7,"op":"update","issue_id":"t-9",
            "issue":{"id":"t-9","title":"Other","status":"open","is_blocked":true}}"#,
        ));
        assert_eq!(find(&copy, "t-9").title, "Other");
    }

    #[test]
    fn missing_is_blocked_is_accepted() {
        let mut copy = ProjectCopy::new(vec![listed_child()]);
        copy.apply(record(
            r#"{"seq":8,"op":"update","issue_id":"t-1.1","actor":"a",
            "issue":{"id":"t-1.1","title":"Child","status":"open","is_blocked":true}}"#,
        ));
        copy.apply(record(
            r#"{"seq":9,"op":"update","issue_id":"t-1.1",
            "issue":{"id":"t-1.1","title":"Unblocked","status":"open"}}"#,
        ));
        assert_eq!(find(&copy, "t-1.1").title, "Unblocked");
    }

    #[test]
    fn delete_removes_the_bead_and_links_to_it() {
        let blocker = bead(r#"{"id":"t-2","title":"Blocker","status":"open"}"#);
        let mut copy = ProjectCopy::new(vec![listed_child(), blocker]);
        copy.apply(record(
            r#"{"seq":10,"op":"delete","issue_id":"t-2","actor":"a","issue":null}"#,
        ));
        assert!(copy.beads().iter().all(|b| b.id != "t-2"));
        let pairs = dep_pairs(find(&copy, "t-1.1"));
        assert_eq!(pairs, vec![("t-1".to_string(), "parent-child".to_string())]);
    }

    #[test]
    fn dep_add_blocking_is_an_upsert() {
        let mut copy = ProjectCopy::new(vec![bead(r#"{"id":"t-3","title":"T","status":"open"}"#)]);
        let line = r#"{"seq":11,"op":"dep_add","issue_id":"t-3","actor":"a",
            "issue":{"id":"t-3","title":"T","status":"open","is_blocked":true},
            "dep":{"kind":"blocks","target":"t-2","metadata":"{}"}}"#;
        copy.apply(record(line));
        copy.apply(record(line));
        let pairs = dep_pairs(find(&copy, "t-3"));
        assert_eq!(pairs, vec![("t-2".to_string(), "blocks".to_string())]);
        assert_eq!(find(&copy, "t-3").parent_id, None);
    }

    #[test]
    fn dep_add_parent_child_sets_parent() {
        let mut copy = ProjectCopy::new(vec![bead(r#"{"id":"t-3","title":"T","status":"open"}"#)]);
        copy.apply(record(
            r#"{"seq":12,"op":"dep_add","issue_id":"t-3","actor":"a",
            "issue":{"id":"t-3","title":"T","status":"open"},
            "dep":{"kind":"parent-child","target":"t-1","metadata":"{}"}}"#,
        ));
        let b = find(&copy, "t-3");
        assert_eq!(b.parent_id.as_deref(), Some("t-1"));
        assert_eq!(
            dep_pairs(b),
            vec![("t-1".to_string(), "parent-child".to_string())]
        );
    }

    #[test]
    fn dep_remove_drops_the_link_and_clears_parent() {
        let mut copy = ProjectCopy::new(vec![listed_child()]);
        copy.apply(record(
            r#"{"seq":13,"op":"dep_remove","issue_id":"t-1.1","actor":"a",
            "issue":{"id":"t-1.1","title":"Child","status":"open"},
            "dep":{"kind":"parent-child","target":"t-1","metadata":"{}"}}"#,
        ));
        let b = find(&copy, "t-1.1");
        assert_eq!(b.parent_id, None);
        assert_eq!(
            dep_pairs(b),
            vec![("t-2".to_string(), "blocks".to_string())]
        );

        copy.apply(record(
            r#"{"seq":14,"op":"dep_remove","issue_id":"t-1.1","actor":"a",
            "issue":{"id":"t-1.1","title":"Child","status":"open"},
            "dep":{"kind":"blocks","target":"t-2","metadata":"{}"}}"#,
        ));
        assert!(dep_pairs(find(&copy, "t-1.1")).is_empty());
    }

    #[test]
    fn comment_is_added_once_per_id() {
        let mut copy = ProjectCopy::new(vec![listed_child()]);
        let line = r#"{"seq":15,"op":"comment","issue_id":"t-1.1","actor":"b",
            "issue":{"id":"t-1.1","title":"Child","status":"open"},
            "comment":{"id":"c-2","author":"b","text":"second","created_at":"2026-09-28T01:00:00Z","source":"structured"}}"#;
        copy.apply(record(line));
        copy.apply(record(line));
        let comments = find(&copy, "t-1.1").comments.clone().unwrap_or_default();
        let ids: Vec<&str> = comments.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["c-1", "c-2"]);
        assert_eq!(comments[1].issue_id, "t-1.1");
        assert_eq!(comments[1].text, "second");
    }

    #[test]
    fn journal_flag_reads_env_before_config() {
        let on = "events-journal: true\n";
        assert!(journal_flag(Some("1"), None));
        assert!(journal_flag(Some("true"), None));
        assert!(!journal_flag(Some("0"), Some(on)));
        assert!(journal_flag(None, Some(on)));
        assert!(journal_flag(None, Some("events-journal: \"true\"\n")));
        assert!(!journal_flag(None, Some("events-journal: false\n")));
        assert!(!journal_flag(None, Some("sync-branch: main\n")));
        assert!(!journal_flag(None, Some(": : not yaml [")));
        assert!(!journal_flag(None, None));
    }

    #[test]
    fn truncated_error_gives_head() {
        // bd 1.3.0 prints this on stdout and exits with 1.
        let text = r#"{
  "code": "events_journal_truncated",
  "error": "events journal truncated: checkpoint 0 is below the retained window [7..9]",
  "floor": 7,
  "head": 9,
  "schema_version": 1,
  "since": 0
}"#;
        assert_eq!(truncated_head(text), Some(9));
        assert_eq!(truncated_head(r#"{"code":"other","head":3}"#), None);
        assert_eq!(truncated_head("Error: something else"), None);
    }

    #[test]
    fn anchor_record_is_checked_and_dropped() {
        let recs = |seqs: &[i64]| -> Vec<JournalRecord> {
            seqs.iter()
                .map(|s| record(&format!(r#"{{"seq":{s},"op":"update","issue_id":"t-1"}}"#)))
                .collect()
        };
        let seqs = |r: Vec<JournalRecord>| r.iter().map(|r| r.seq).collect::<Vec<_>>();
        assert_eq!(strip_anchor(recs(&[1, 2]), 0).map(seqs), Some(vec![1, 2]));
        assert_eq!(
            strip_anchor(recs(&[5, 6, 7]), 5).map(seqs),
            Some(vec![6, 7])
        );
        assert_eq!(strip_anchor(recs(&[5]), 5).map(seqs), Some(vec![]));
        // The journal was replaced: the record we last saw is not there.
        assert!(strip_anchor(recs(&[]), 5).is_none());
        assert!(strip_anchor(recs(&[6, 7]), 5).is_none());
    }

    #[test]
    fn forget_drops_only_that_project() {
        let cache = JournalCache::default();
        let (a, b) = (Path::new("/p/a"), Path::new("/p/b"));
        let slot_a = cache.slot(a);
        cache.slot(b);
        cache.forget(a);
        assert!(!Arc::ptr_eq(&slot_a, &cache.slot(a)), "a gets a fresh slot");
        assert_eq!(cache.slots.lock().unwrap().len(), 2);
        cache.forget(Path::new("/p/unknown"));
        assert_eq!(cache.slots.lock().unwrap().len(), 2);
    }

    fn cached_with(ids: &[&str]) -> CachedProject {
        let beads = ids
            .iter()
            .map(|id| bead(&format!(r#"{{"id":"{id}","title":"T","status":"open"}}"#)))
            .collect();
        CachedProject {
            copy: ProjectCopy::new(beads),
            seq: 1,
            baseline_at: Instant::now(),
            refreshed_at: Instant::now(),
        }
    }

    fn stored_ids(slot: &Option<CachedProject>) -> Vec<String> {
        slot.as_ref()
            .map(|c| c.copy.beads().iter().map(|b| b.id.clone()).collect())
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn dropped_request_does_not_cancel_the_baseline() {
        let slot: Slot = Arc::default();
        let (finish, finished) = tokio::sync::oneshot::channel::<()>();
        let work = async move {
            let _ = finished.await;
            Ok(cached_with(&["t-1", "t-2"]))
        };
        let guard = slot.clone().lock_owned().await;
        let request = store_detached(guard, PathBuf::from("/p/a"), work);

        // The page gives up while bd is still reading: the request is dropped.
        let gave_up = tokio::time::timeout(Duration::from_millis(50), request).await;
        assert!(gave_up.is_err(), "the baseline was still running");

        finish.send(()).expect("baseline still waiting");
        let stored = tokio::time::timeout(Duration::from_secs(5), slot.lock())
            .await
            .expect("the baseline task releases the lock");
        assert_eq!(stored_ids(&stored), vec!["t-1", "t-2"]);
    }

    #[tokio::test]
    async fn waiting_request_gets_the_baseline_result() {
        let slot: Slot = Arc::default();
        let guard = slot.clone().lock_owned().await;
        let work = async { Ok(cached_with(&["t-1"])) };
        let (beads, comments) = store_detached(guard, PathBuf::from("/p/a"), work)
            .await
            .expect("baseline succeeds");
        assert_eq!(beads.len(), 1);
        assert_eq!(comments, 0);
        assert_eq!(stored_ids(&*slot.lock().await), vec!["t-1"]);
    }

    #[tokio::test]
    async fn failed_or_panicking_baseline_keeps_the_old_copy() {
        let slot: Slot = Arc::new(tokio::sync::Mutex::new(Some(cached_with(&["old"]))));

        let guard = slot.clone().lock_owned().await;
        let failed = store_detached(guard, PathBuf::from("/p/a"), async {
            Err("bd failed".to_string())
        })
        .await;
        assert_eq!(failed.err().as_deref(), Some("bd failed"));
        assert_eq!(stored_ids(&*slot.lock().await), vec!["old"]);

        let guard = slot.clone().lock_owned().await;
        let panicked = store_detached(guard, PathBuf::from("/p/a"), async {
            panic!("baseline bug");
        })
        .await;
        assert!(panicked.is_err(), "a panic becomes an error, not a crash");
        assert_eq!(stored_ids(&*slot.lock().await), vec!["old"]);
    }

    #[test]
    fn comment_matching_a_baseline_comment_is_not_duplicated() {
        let mut copy = ProjectCopy::new(vec![listed_child()]);
        copy.apply(record(
            r#"{"seq":16,"op":"comment","issue_id":"t-1.1","actor":"a",
            "issue":{"id":"t-1.1","title":"Child","status":"open"},
            "comment":{"id":"c-1","author":"a","text":"hi","created_at":"2026-09-28T00:00:00Z"}}"#,
        ));
        assert_eq!(
            find(&copy, "t-1.1").comments.as_ref().map(|c| c.len()),
            Some(1)
        );
    }
}
