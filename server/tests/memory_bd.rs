//! Integration tests for the bd-backed memory API.
//!
//! Requires `bd` CLI to be on PATH. If not found, the test prints a note and
//! returns early so CI environments without bd don't fail.

use std::time::{SystemTime, UNIX_EPOCH};

fn unique_tmp_dir() -> std::path::PathBuf {
    // Must be under $HOME because validate_path_security restricts to home dir.
    // macOS $TMPDIR is /var/folders/... which is outside home.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join(format!(".tmp_memory_bd_test_{}", nanos))
}

/// Spin up the axum router on a random port and return the base URL.
async fn start_test_server() -> String {
    use axum::{routing::get, Router};

    // We need to import from the server crate — but since this is an integration
    // test we call the server binary's logic. However the server crate doesn't
    // expose a `build_router` fn. The simplest approach is to construct a minimal
    // router in-test that wires the same handlers.
    let app = Router::new().route(
        "/api/memory",
        get(beads_server::routes::memory::list_memory)
            .put(beads_server::routes::memory::update_memory)
            .delete(beads_server::routes::memory::delete_memory),
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://127.0.0.1:{}", port)
}

#[tokio::test]
async fn test_memory_bd_round_trip() {
    // 1. Create tmp dir
    let tmp = unique_tmp_dir();
    std::fs::create_dir_all(&tmp).unwrap();
    let tmp_str = tmp.to_str().unwrap().to_string();

    // 2. git init then bd init — skip if either tool is missing or fails
    let git_init = std::process::Command::new("git")
        .args(["init", &tmp_str])
        .output();

    match git_init {
        Ok(o) if o.status.success() => {}
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            println!("git init failed: {stderr}, skipping test");
            let _ = std::fs::remove_dir_all(&tmp);
            return;
        }
        Err(e) => {
            println!("git not on PATH ({e}), skipping memory_bd integration test");
            let _ = std::fs::remove_dir_all(&tmp);
            return;
        }
    }

    // bd init must run with cwd=tmp (it doesn't support -C for init)
    let init_result = std::process::Command::new("bd")
        .arg("init")
        .current_dir(&tmp)
        .output();

    let init_output = match init_result {
        Ok(o) => o,
        Err(e) => {
            println!("bd not on PATH ({e}), skipping memory_bd integration test");
            let _ = std::fs::remove_dir_all(&tmp);
            return;
        }
    };

    if !init_output.status.success() {
        let stderr = String::from_utf8_lossy(&init_output.stderr);
        println!("bd init failed: {stderr}, skipping test");
        let _ = std::fs::remove_dir_all(&tmp);
        return;
    }

    // 3. Start test server
    let base = start_test_server().await;
    let client = reqwest::Client::new();

    // -- List → empty --
    let resp = client
        .get(format!("{}/api/memory?path={}", base, &tmp_str))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "list should return 200");
    let entries: Vec<serde_json::Value> = resp.json().await.unwrap();
    assert!(
        entries.is_empty(),
        "expected empty list, got: {entries:?}"
    );

    // -- Update: create test-key --
    let resp = client
        .put(format!("{}/api/memory", base))
        .json(&serde_json::json!({
            "path": &tmp_str,
            "key": "test-key",
            "content": "hello"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "update (create) should return 200");

    // -- List → contains test-key with content "hello" --
    let resp = client
        .get(format!("{}/api/memory?path={}", base, &tmp_str))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let entries: Vec<serde_json::Value> = resp.json().await.unwrap();
    assert_eq!(entries.len(), 1, "expected 1 entry, got: {entries:?}");
    assert_eq!(entries[0]["key"], "test-key");
    assert_eq!(entries[0]["content"], "hello");

    // -- Update: overwrite test-key with "updated" --
    let resp = client
        .put(format!("{}/api/memory", base))
        .json(&serde_json::json!({
            "path": &tmp_str,
            "key": "test-key",
            "content": "updated"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "update (overwrite) should return 200");

    // -- List → content is "updated" --
    let resp = client
        .get(format!("{}/api/memory?path={}", base, &tmp_str))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let entries: Vec<serde_json::Value> = resp.json().await.unwrap();
    assert_eq!(entries.len(), 1, "expected 1 entry after update");
    assert_eq!(entries[0]["content"], "updated");

    // -- Delete test-key --
    let resp = client
        .delete(format!("{}/api/memory", base))
        .json(&serde_json::json!({
            "path": &tmp_str,
            "key": "test-key"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "delete should return 200");
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["success"], true);

    // -- List → empty again --
    let resp = client
        .get(format!("{}/api/memory?path={}", base, &tmp_str))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let entries: Vec<serde_json::Value> = resp.json().await.unwrap();
    assert!(entries.is_empty(), "expected empty after delete, got: {entries:?}");

    // 5. Cleanup
    let _ = std::fs::remove_dir_all(&tmp);
}
