#!/usr/bin/env bash
set -uo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PORT="${PORT:-3008}"
BASE_URL="http://localhost:${PORT}"
SERVER_BIN="/app/server/target/release/beads-server"
PASSED=0
FAILED=0
SERVER_PID=""
PROJECT_DIR=""
DOLT_PID=""

# ── Helpers ────────────────────────────────────────────────────────────────────

cleanup() {
    if [[ -n "$SERVER_PID" ]]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [[ -n "$DOLT_PID" ]]; then
        kill "$DOLT_PID" 2>/dev/null || true
        wait "$DOLT_PID" 2>/dev/null || true
    fi
    if [[ -n "$PROJECT_DIR" && -d "$PROJECT_DIR" ]]; then
        rm -rf "$PROJECT_DIR"
    fi
}
trap cleanup EXIT

pass() {
    local name="$1"
    PASSED=$((PASSED + 1))
    echo "  PASS: $name"
}

fail() {
    local name="$1"
    shift
    FAILED=$((FAILED + 1))
    echo "  FAIL: $name — $*"
}

# assert_status TEST_NAME ACTUAL EXPECTED
assert_status() {
    local name="$1" actual="$2" expected="$3"
    if [[ "$actual" == "$expected" ]]; then
        pass "$name"
    else
        fail "$name" "expected HTTP $expected, got $actual"
    fi
}

# parse_json INPUT — extracts JSON from bd output that may contain warnings before the JSON
parse_json() {
    python3 -c "
import sys, json
raw = sys.stdin.read()
idx = raw.find('[')
ib = raw.find('{')
if idx < 0 or (ib >= 0 and ib < idx):
    idx = ib
if idx < 0:
    print('{}')
else:
    print(raw[idx:])
"
}

# ── Setup: create a temporary git repo with beads ─────────────────────────────

echo "=== Setting up test project ==="
PROJECT_DIR="$HOME/beads-integration-test-$$"
mkdir -p "$PROJECT_DIR"
echo "  Project dir: $PROJECT_DIR"

cd "$PROJECT_DIR"
git init
git config user.email "test@test.com"
git config user.name "Test"
echo "test" > README.md
git add -A
git commit -m "init"

# Start a dolt sql-server manually on a fixed port
DOLT_PORT=13307
mkdir -p "$PROJECT_DIR/.beads/dolt"
cd "$PROJECT_DIR/.beads/dolt"
dolt init
cd "$PROJECT_DIR"

dolt sql-server --host 127.0.0.1 --port $DOLT_PORT --data-dir "$PROJECT_DIR/.beads/dolt" &
DOLT_PID=$!
sleep 3

# Verify dolt server is running
if ! kill -0 "$DOLT_PID" 2>/dev/null; then
    echo "FATAL: Dolt server failed to start"
    exit 1
fi
echo "  Dolt server running on port $DOLT_PORT (PID $DOLT_PID)"

# Write port file so beads-server can find the dolt server
echo "$DOLT_PORT" > "$PROJECT_DIR/.beads/dolt-server.port"

# Initialize beads with the running dolt server
export BEADS_DOLT_SERVER_PORT=$DOLT_PORT
if ! bd init --skip-agents 2>/dev/null; then
    bd init 2>/dev/null || true
fi

# Create test beads
echo "  Creating test beads..."
BD_OUT1=$(bd create --title="Test task one" --type=task 2>&1) || true
sleep 1
BD_OUT2=$(bd create --title="Test bug two" --type=bug 2>&1) || true
sleep 1
BD_OUT3=$(bd create --title="Test epic three" --type=epic 2>&1) || true
sleep 1

# Extract bead IDs
extract_bead_id() {
    echo "$1" | python3 -c "
import sys, re
text = sys.stdin.read()
m = re.search(r'Created issue:\s*(\S+)', text)
if m:
    bead_id = re.sub(r'[\s—:]+$', '', m.group(1))
    print(bead_id)
else:
    print('')
"
}
BEAD_ID1=$(extract_bead_id "$BD_OUT1")
BEAD_ID2=$(extract_bead_id "$BD_OUT2")
BEAD_ID3=$(extract_bead_id "$BD_OUT3")
echo "  Created beads: [$BEAD_ID1] [$BEAD_ID2] [$BEAD_ID3]"

# Verify beads exist
BD_LIST=$(bd list --json 2>&1 | parse_json)
BEAD_COUNT=$(echo "$BD_LIST" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "  Beads in project: $BEAD_COUNT"

# ── Start server ──────────────────────────────────────────────────────────────

echo "=== Starting beads-server on port $PORT ==="

PORT="$PORT" "$SERVER_BIN" &
SERVER_PID=$!
sleep 2

# Verify server is running
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "FATAL: Server failed to start"
    exit 1
fi
echo "  Server running (PID $SERVER_PID)"

# ── Tests ─────────────────────────────────────────────────────────────────────

echo ""
echo "=== Running integration tests ==="

# Test 1: GET /api/beads — returns 200, has beads array >= 3
test_1_get_beads() {
    local name="GET /api/beads returns 200 with >= 3 beads"
    local status body
    status=$(curl -s -o /tmp/t1.json -w "%{http_code}" "${BASE_URL}/api/beads?path=${PROJECT_DIR}")
    if [[ "$status" != "200" ]]; then
        fail "$name" "expected HTTP 200, got $status"
        return
    fi
    local result
    result=$(python3 -c "
import json, sys
with open('/tmp/t1.json') as f:
    data = json.load(f)
beads = data.get('beads', [])
if len(beads) < 3:
    print('FAIL: expected >= 3 beads, got', len(beads), file=sys.stderr)
    sys.exit(1)
for b in beads:
    for field in ('id', 'title', 'status'):
        if field not in b:
            print(f'FAIL: bead missing field: {field}', file=sys.stderr)
            sys.exit(1)
" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "$result"
    fi
}

# Test 2: GET /api/beads?updated_after=2099-01-01 — returns 200
# Note: updated_after filtering only works at CLI tier; SQL tier (Tier 0) returns all beads
test_2_future_date() {
    local name="GET /api/beads with future updated_after returns 200"
    local status
    status=$(curl -s -o /tmp/t2.json -w "%{http_code}" \
        "${BASE_URL}/api/beads?path=${PROJECT_DIR}&updated_after=2099-01-01T00:00:00Z")
    assert_status "$name" "$status" "200"
}

# Test 3: GET /api/beads?updated_after=2020-01-01 — returns >= 3
test_3_past_date() {
    local name="GET /api/beads with past updated_after returns >= 3 beads"
    local status
    status=$(curl -s -o /tmp/t3.json -w "%{http_code}" \
        "${BASE_URL}/api/beads?path=${PROJECT_DIR}&updated_after=2020-01-01T00:00:00Z")
    if [[ "$status" != "200" ]]; then
        fail "$name" "expected HTTP 200, got $status"
        return
    fi
    local result
    result=$(python3 -c "
import json, sys
with open('/tmp/t3.json') as f:
    data = json.load(f)
beads = data.get('beads', [])
if len(beads) < 3:
    print(f'expected >= 3 beads, got {len(beads)}', file=sys.stderr)
    sys.exit(1)
" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "$result"
    fi
}

# Test 4: POST /api/beads/create with title+path — returns 201 with id
test_4_create_bead() {
    local name="POST /api/beads/create returns 201 with id"
    local status
    status=$(curl -s -o /tmp/t4.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/beads/create" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"title\":\"Integration test bead\"}")
    if [[ "$status" != "201" ]]; then
        fail "$name" "expected HTTP 201, got $status"
        return
    fi
    python3 -c "
import json, sys
with open('/tmp/t4.json') as f:
    data = json.load(f)
if 'id' not in data or not data['id']:
    print('missing id in response', file=sys.stderr)
    sys.exit(1)
" 2>&1
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "validation failed"
    fi
}

# Test 5: POST /api/beads/create with empty title — returns 400
test_5_create_empty_title() {
    local name="POST /api/beads/create with empty title returns 400"
    local status
    status=$(curl -s -o /tmp/t5.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/beads/create" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"title\":\"\"}")
    assert_status "$name" "$status" "400"
}

# Test 6: Created bead appears in subsequent GET
test_6_created_bead_visible() {
    local name="Created bead appears in subsequent GET"
    sleep 1
    local status
    status=$(curl -s -o /tmp/t6.json -w "%{http_code}" "${BASE_URL}/api/beads?path=${PROJECT_DIR}")
    if [[ "$status" != "200" ]]; then
        fail "$name" "expected HTTP 200, got $status"
        return
    fi
    local result
    result=$(python3 -c "
import json, sys
with open('/tmp/t6.json') as f:
    data = json.load(f)
beads = data.get('beads', [])
titles = [b.get('title','') for b in beads]
if 'Integration test bead' not in titles:
    print(f'created bead not found in list, titles: {titles}', file=sys.stderr)
    sys.exit(1)
" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "$result"
    fi
}

# Extract clean bead ID from create response (handles bd stdout in id field)
get_created_bead_id() {
    python3 -c "
import json, re, sys
raw = json.load(open('/tmp/t4.json')).get('id', '')
m = re.search(r'Created issue:\s*(\S+)', raw)
if m:
    print(re.sub(r'[\s—:]+$', '', m.group(1)))
elif raw.strip():
    # Try to extract last word that looks like a bead ID
    parts = raw.strip().split()
    print(parts[-1] if parts else '')
else:
    print('')
" 2>/dev/null || echo ""
}

# Test 7: PATCH /api/beads/update status to in_progress — returns 200
test_7_update_status() {
    local name="PATCH /api/beads/update status returns 200"
    local bead_id
    bead_id=$(get_created_bead_id)
    if [[ -z "$bead_id" ]]; then
        fail "$name" "no bead ID from test 4"
        return
    fi
    local status
    status=$(curl -s -o /tmp/t7.json -w "%{http_code}" \
        -X PATCH "${BASE_URL}/api/beads/update" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"id\":\"${bead_id}\",\"status\":\"in_progress\"}")
    if [[ "$status" != "200" ]]; then
        local body
        body=$(cat /tmp/t7.json 2>/dev/null || echo "no body")
        fail "$name" "expected HTTP 200, got $status — $body"
        return
    fi
    pass "$name"
}

# Test 8: Updated status reflected in subsequent GET
test_8_status_reflected() {
    local name="Updated status reflected in subsequent GET"
    sleep 1
    local bead_id
    bead_id=$(get_created_bead_id)
    if [[ -z "$bead_id" ]]; then
        fail "$name" "no bead ID from test 4"
        return
    fi
    local status
    status=$(curl -s -o /tmp/t8.json -w "%{http_code}" "${BASE_URL}/api/beads?path=${PROJECT_DIR}")
    if [[ "$status" != "200" ]]; then
        fail "$name" "expected HTTP 200, got $status"
        return
    fi
    local result
    result=$(python3 -c "
import json, sys
bead_id = '${bead_id}'
with open('/tmp/t8.json') as f:
    data = json.load(f)
beads = data.get('beads', [])
found = [b for b in beads if b.get('id') == bead_id]
if not found:
    print(f'bead {bead_id} not found', file=sys.stderr)
    sys.exit(1)
if found[0].get('status') != 'in_progress':
    print(f'expected in_progress, got {found[0].get(\"status\")}', file=sys.stderr)
    sys.exit(1)
" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "$result"
    fi
}

# Test 9: GET /api/beads with non-existent path — returns 404
test_9_nonexistent_path() {
    local name="GET /api/beads with non-existent path returns 404"
    local status
    status=$(curl -s -o /tmp/t9.json -w "%{http_code}" \
        "${BASE_URL}/api/beads?path=/root/nonexistent-project-path-12345")
    # Server returns 403 (path security) or 404 (not found) depending on validation
    if [[ "$status" == "404" || "$status" == "403" ]]; then
        pass "$name"
    else
        fail "$name" "expected HTTP 404 or 403, got $status"
    fi
}

# Test 10: GET /api/beads with path missing .beads — returns 404
test_10_missing_beads_dir() {
    local name="GET /api/beads with path missing .beads returns 404"
    local tmpdir="$HOME/no-beads-test-$$"
    mkdir -p "$tmpdir"
    local status
    status=$(curl -s -o /tmp/t10.json -w "%{http_code}" \
        "${BASE_URL}/api/beads?path=${tmpdir}")
    rm -rf "$tmpdir"
    assert_status "$name" "$status" "404"
}

# Test 11: Add comment to a bead
test_11_add_comment() {
    local name="POST /api/bd/command — add comment"
    local bead_id
    bead_id=$(get_created_bead_id)
    if [[ -z "$bead_id" ]]; then
        fail "$name" "no bead ID"
        return
    fi
    local status
    status=$(curl -s -o /tmp/t11.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/bd/command" \
        -H "Content-Type: application/json" \
        -d "{\"cwd\":\"${PROJECT_DIR}\",\"args\":[\"comments\",\"add\",\"${bead_id}\",\"Test comment from integration\"]}")
    if [[ "$status" == "200" || "$status" == "201" ]]; then
        pass "$name"
    else
        local body=$(cat /tmp/t11.json 2>/dev/null || echo "no body")
        fail "$name" "expected HTTP 200/201, got $status — $body"
    fi
}

# Test 12: Comment appears in bead data
test_12_comment_visible() {
    local name="Comment visible in bead data"
    sleep 1
    local bead_id
    bead_id=$(get_created_bead_id)
    local status
    status=$(curl -s -o /tmp/t12.json -w "%{http_code}" "${BASE_URL}/api/beads?path=${PROJECT_DIR}")
    if [[ "$status" != "200" ]]; then
        fail "$name" "expected HTTP 200, got $status"
        return
    fi
    local result
    result=$(python3 -c "
import json, sys
bead_id = '${bead_id}'
with open('/tmp/t12.json') as f:
    data = json.load(f)
beads = data.get('beads', [])
bead = next((b for b in beads if b.get('id') == bead_id), None)
if not bead:
    print(f'bead {bead_id} not found', file=sys.stderr)
    sys.exit(1)
comments = bead.get('comments') or []
if not any('Test comment from integration' in c.get('text','') for c in comments):
    print(f'comment not found in bead, comments: {comments}', file=sys.stderr)
    sys.exit(1)
" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "$result"
    fi
}

# Test 13: Update title
test_13_update_title() {
    local name="PATCH /api/beads/update title"
    local bead_id
    bead_id=$(get_created_bead_id)
    if [[ -z "$bead_id" ]]; then
        fail "$name" "no bead ID"
        return
    fi
    local status
    status=$(curl -s -o /tmp/t13.json -w "%{http_code}" \
        -X PATCH "${BASE_URL}/api/beads/update" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"id\":\"${bead_id}\",\"title\":\"Updated title via API\"}")
    if [[ "$status" != "200" ]]; then
        local body=$(cat /tmp/t13.json 2>/dev/null || echo "no body")
        fail "$name" "expected HTTP 200, got $status — $body"
        return
    fi
    # Verify title changed
    sleep 1
    curl -s -o /tmp/t13b.json "${BASE_URL}/api/beads?path=${PROJECT_DIR}"
    local result
    result=$(python3 -c "
import json, sys
bead_id = '${bead_id}'
with open('/tmp/t13b.json') as f:
    data = json.load(f)
bead = next((b for b in data.get('beads',[]) if b.get('id') == bead_id), None)
if not bead:
    print('bead not found', file=sys.stderr)
    sys.exit(1)
if bead.get('title') != 'Updated title via API':
    print(f'title not updated: {bead.get(\"title\")}', file=sys.stderr)
    sys.exit(1)
" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "$result"
    fi
}

# Test 14: Close a bead
test_14_close_bead() {
    local name="Close bead via bd command"
    if [[ -z "$BEAD_ID2" ]]; then
        fail "$name" "no BEAD_ID2"
        return
    fi
    local status
    status=$(curl -s -o /tmp/t14.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/bd/command" \
        -H "Content-Type: application/json" \
        -d "{\"cwd\":\"${PROJECT_DIR}\",\"args\":[\"close\",\"${BEAD_ID2}\"]}")
    if [[ "$status" == "200" || "$status" == "201" ]]; then
        pass "$name"
    else
        local body=$(cat /tmp/t14.json 2>/dev/null || echo "no body")
        fail "$name" "expected HTTP 200/201, got $status — $body"
    fi
}

# Test 15: GET /api/projects returns list
test_15_list_projects() {
    local name="GET /api/projects returns project list"
    local status
    status=$(curl -s -o /tmp/t15.json -w "%{http_code}" "${BASE_URL}/api/projects")
    assert_status "$name" "$status" "200"
}

# Test 16: POST /api/projects — add project
test_16_add_project() {
    local name="POST /api/projects adds project"
    local status
    status=$(curl -s -o /tmp/t16.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/projects" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"Integration Test Project\",\"path\":\"${PROJECT_DIR}\"}")
    if [[ "$status" == "200" || "$status" == "201" ]]; then
        pass "$name"
    else
        local body=$(cat /tmp/t16.json 2>/dev/null || echo "no body")
        fail "$name" "expected HTTP 200/201, got $status — $body"
    fi
}

# Test 17: Archive project
test_17_archive_project() {
    local name="PATCH archive project"
    # Get project ID from the add response
    local project_id
    project_id=$(python3 -c "import json; print(json.load(open('/tmp/t16.json')).get('id',''))" 2>/dev/null || echo "")
    if [[ -z "$project_id" ]]; then
        fail "$name" "no project ID from test 16"
        return
    fi
    local status
    status=$(curl -s -o /tmp/t17.json -w "%{http_code}" \
        -X PATCH "${BASE_URL}/api/projects/${project_id}/archive")
    if [[ "$status" == "200" || "$status" == "204" ]]; then
        pass "$name"
    else
        fail "$name" "expected HTTP 200 or 204, got $status"
    fi
}

# Test 18: Archived project hidden from default list
test_18_archived_hidden() {
    local name="Archived project hidden from default list"
    local status
    status=$(curl -s -o /tmp/t18.json -w "%{http_code}" "${BASE_URL}/api/projects")
    if [[ "$status" != "200" ]]; then
        fail "$name" "expected HTTP 200, got $status"
        return
    fi
    local result
    result=$(python3 -c "
import json, sys
with open('/tmp/t18.json') as f:
    projects = json.load(f)
names = [p.get('name','') for p in projects]
if 'Integration Test Project' in names:
    print('archived project still visible', file=sys.stderr)
    sys.exit(1)
" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "$name"
    else
        fail "$name" "$result"
    fi
}

# Test 19: Unarchive project
test_19_unarchive_project() {
    local name="PATCH unarchive project"
    local project_id
    project_id=$(python3 -c "import json; print(json.load(open('/tmp/t16.json')).get('id',''))" 2>/dev/null || echo "")
    if [[ -z "$project_id" ]]; then
        fail "$name" "no project ID"
        return
    fi
    local status
    status=$(curl -s -o /tmp/t19.json -w "%{http_code}" \
        -X PATCH "${BASE_URL}/api/projects/${project_id}/unarchive")
    if [[ "$status" == "200" || "$status" == "204" ]]; then
        pass "$name"
    else
        fail "$name" "expected HTTP 200 or 204, got $status"
    fi
}

# Test 20: Epic with children
test_20_epic_with_children() {
    local name="Epic with child tasks"
    # Create epic
    local epic_status
    epic_status=$(curl -s -o /tmp/t20_epic.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/beads/create" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"title\":\"Test Epic Parent\",\"issue_type\":\"epic\"}")
    if [[ "$epic_status" != "201" ]]; then
        fail "$name" "epic create failed with $epic_status"
        return
    fi
    # Get epic ID
    local epic_id
    epic_id=$(python3 -c "
import json, re
raw = json.load(open('/tmp/t20_epic.json')).get('id','')
m = re.search(r'Created issue:\s*(\S+)', raw)
if m:
    print(re.sub(r'[\s—:]+$', '', m.group(1)))
elif raw.strip():
    print(raw.strip().split()[-1])
else:
    print('')
" 2>/dev/null || echo "")
    if [[ -z "$epic_id" ]]; then
        fail "$name" "no epic ID"
        return
    fi
    # Create child
    local child_status
    child_status=$(curl -s -o /tmp/t20_child.json -w "%{http_code}" \
        -X POST "${BASE_URL}/api/beads/create" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"title\":\"Child of epic\",\"parent_id\":\"${epic_id}\"}")
    if [[ "$child_status" != "201" ]]; then
        fail "$name" "child create failed with $child_status"
        return
    fi
    pass "$name"
}

# Test 21: Memory round-trip — PUT (create), GET, PUT (update), DELETE
test_21_memory_round_trip() {
    local name="Memory round-trip via /api/memory"

    # PUT create
    local s
    s=$(curl -s -o /tmp/t21a.json -w "%{http_code}" \
        -X PUT "${BASE_URL}/api/memory" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"key\":\"int-test\",\"content\":\"hello\"}")
    if [[ "$s" != "200" ]]; then
        fail "$name" "PUT create expected 200, got $s"
        return
    fi

    # GET — entry appears with content "hello"
    s=$(curl -s -o /tmp/t21b.json -w "%{http_code}" "${BASE_URL}/api/memory?path=${PROJECT_DIR}")
    if [[ "$s" != "200" ]]; then
        fail "$name" "GET expected 200, got $s"
        return
    fi
    if ! python3 -c "
import json,sys
d = json.load(open('/tmp/t21b.json'))
e = next((x for x in d if x.get('key')=='int-test'), None)
if not e or e.get('content') != 'hello': sys.exit(1)
" 2>/dev/null; then
        fail "$name" "create not visible in list"
        return
    fi

    # PUT update — same key, new content
    s=$(curl -s -o /tmp/t21c.json -w "%{http_code}" \
        -X PUT "${BASE_URL}/api/memory" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"key\":\"int-test\",\"content\":\"updated\"}")
    if [[ "$s" != "200" ]]; then
        fail "$name" "PUT update expected 200, got $s"
        return
    fi

    # GET — content reflects update
    curl -s -o /tmp/t21d.json "${BASE_URL}/api/memory?path=${PROJECT_DIR}"
    if ! python3 -c "
import json,sys
d = json.load(open('/tmp/t21d.json'))
e = next((x for x in d if x.get('key')=='int-test'), None)
if not e or e.get('content') != 'updated': sys.exit(1)
" 2>/dev/null; then
        fail "$name" "update not reflected in list"
        return
    fi

    # DELETE
    s=$(curl -s -o /tmp/t21e.json -w "%{http_code}" \
        -X DELETE "${BASE_URL}/api/memory" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"${PROJECT_DIR}\",\"key\":\"int-test\"}")
    if [[ "$s" != "200" ]]; then
        fail "$name" "DELETE expected 200, got $s"
        return
    fi

    # GET — entry gone
    curl -s -o /tmp/t21f.json "${BASE_URL}/api/memory?path=${PROJECT_DIR}"
    if ! python3 -c "
import json,sys
d = json.load(open('/tmp/t21f.json'))
if any(x.get('key')=='int-test' for x in d): sys.exit(1)
" 2>/dev/null; then
        fail "$name" "entry still visible after delete"
        return
    fi

    pass "$name"
}

# ── Run all tests ─────────────────────────────────────────────────────────────

test_1_get_beads
test_2_future_date
test_3_past_date
test_4_create_bead
test_5_create_empty_title
test_6_created_bead_visible
test_7_update_status
test_8_status_reflected
test_9_nonexistent_path
test_10_missing_beads_dir
test_11_add_comment
test_12_comment_visible
test_13_update_title
test_14_close_bead
test_15_list_projects
test_16_add_project
test_17_archive_project
test_18_archived_hidden
test_19_unarchive_project
test_20_epic_with_children
test_21_memory_round_trip

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "=== Results ==="
TOTAL=$((PASSED + FAILED))
echo "  $PASSED passed, $FAILED failed (out of $TOTAL)"

if [[ "$FAILED" -gt 0 ]]; then
    exit 1
fi
echo "  All tests passed!"
exit 0
