//! File watcher SSE endpoint for real-time file change notifications.
//!
//! Provides Server-Sent Events for monitoring changes to beads issue files.

use axum::{
    extract::Query,
    response::sse::{Event, Sse},
};
use futures::stream::Stream;
use notify::{
    event::ModifyKind, Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, path::PathBuf, time::Duration};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, warn};

use super::beads::resolve_issues_path;
use super::validate_path_security;

/// Query parameters for the watch endpoint.
#[derive(Debug, Deserialize)]
pub struct WatchParams {
    /// The project path to watch for changes.
    pub path: String,
}

/// File change event sent to clients.
#[derive(Debug, Serialize)]
pub struct FileChangeEvent {
    /// The path of the changed file.
    pub path: String,
    /// The type of change (modified, created, removed).
    #[serde(rename = "type")]
    pub change_type: String,
}

/// SSE endpoint for watching beads file changes.
///
/// Monitors the `.beads/issues.jsonl` file in the specified project path
/// and sends SSE events when changes are detected.
///
/// # Query Parameters
///
/// - `path`: The project directory path to monitor
///
/// # Returns
///
/// A Server-Sent Events stream of file change notifications.
pub async fn watch_beads(
    Query(params): Query<WatchParams>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let project_path = PathBuf::from(&params.path);

    // Reject dolt:// paths — no filesystem to watch
    if let Err(e) = validate_path_security(&project_path) {
        warn!("Watch rejected for invalid path: {}", e);
        let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(1);
        drop(tx); // Close immediately
        return Sse::new(ReceiverStream::new(rx));
    }

    let beads_file = resolve_issues_path(&project_path);

    info!("Starting file watcher for: {:?}", beads_file);

    // Create channel for events with buffer for debouncing
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(100);

    // Spawn the watcher task
    tokio::spawn(async move {
        if let Err(e) = run_watcher(beads_file, tx).await {
            error!("File watcher error: {}", e);
        }
    });

    let stream = ReceiverStream::new(rx);
    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text("ping"),
    )
}

/// Runs the file watcher and sends events through the channel.
async fn run_watcher(
    beads_file: PathBuf,
    tx: mpsc::Sender<Result<Event, Infallible>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create a channel for notify events
    let (notify_tx, mut notify_rx) = mpsc::channel(100);

    // Create the watcher
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                // Only forward relevant events
                let _ = notify_tx.blocking_send(event);
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(100)),
    )?;

    // Watch the parent directory (.beads) since the file might not exist yet
    let watch_path = beads_file
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| beads_file.clone());

    // Create the .beads directory if it doesn't exist
    if !watch_path.exists() {
        warn!(
            "Watch path does not exist, waiting for creation: {:?}",
            watch_path
        );
    }

    // Try to watch the path, or watch parent if it doesn't exist
    let actual_watch_path = if watch_path.exists() {
        watch_path.clone()
    } else if let Some(parent) = watch_path.parent() {
        if parent.exists() {
            parent.to_path_buf()
        } else {
            error!("Neither watch path nor parent exists: {:?}", watch_path);
            return Ok(());
        }
    } else {
        error!("No valid path to watch: {:?}", watch_path);
        return Ok(());
    };

    watcher.watch(&actual_watch_path, RecursiveMode::Recursive)?;
    info!("File watcher active on: {:?}", actual_watch_path);

    // Send initial connection event
    let connect_event = Event::default().data(
        serde_json::to_string(&FileChangeEvent {
            path: beads_file.to_string_lossy().to_string(),
            change_type: "connected".to_string(),
        })
        .unwrap_or_default(),
    );
    let _ = tx.send(Ok(connect_event)).await;

    // Debounce state
    let mut last_event_time = std::time::Instant::now();
    let debounce_duration = Duration::from_millis(100);

    // Process events
    while let Some(event) = notify_rx.recv().await {
        // Check if the event is for our target file
        let is_relevant = event.paths.iter().any(|p| {
            p.ends_with("issues.jsonl")
                || p.ends_with(".beads")
                || p == &beads_file
        });

        if !is_relevant {
            continue;
        }

        // Debounce rapid changes
        let now = std::time::Instant::now();
        if now.duration_since(last_event_time) < debounce_duration {
            continue;
        }
        last_event_time = now;

        // Determine event type
        let change_type = match event.kind {
            EventKind::Create(_) => "created",
            EventKind::Modify(ModifyKind::Data(_)) => "modified",
            EventKind::Modify(_) => "modified",
            EventKind::Remove(_) => "removed",
            _ => continue, // Ignore other events
        };

        let file_event = FileChangeEvent {
            path: beads_file.to_string_lossy().to_string(),
            change_type: change_type.to_string(),
        };

        info!("File change detected: {:?}", file_event);

        let sse_event = Event::default()
            .data(serde_json::to_string(&file_event).unwrap_or_default());

        // If send fails, client disconnected
        if tx.send(Ok(sse_event)).await.is_err() {
            info!("Client disconnected, stopping watcher");
            break;
        }
    }

    // Watcher is automatically dropped and cleaned up here
    info!("File watcher stopped");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_change_event_serialization() {
        let event = FileChangeEvent {
            path: "/test/path".to_string(),
            change_type: "modified".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"path\":\"/test/path\""));
        assert!(json.contains("\"type\":\"modified\""));
    }

    #[test]
    fn test_watch_params_deserialization() {
        let params: WatchParams =
            serde_json::from_str(r#"{"path": "/test/project"}"#).unwrap();
        assert_eq!(params.path, "/test/project");
    }
}
