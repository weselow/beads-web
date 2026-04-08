#!/usr/bin/env bash
set -euo pipefail

DOLT_PORT="${DOLT_PORT:-3307}"
BEADS_WEB_PORT="${BEADS_WEB_PORT:-3007}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)  # P3: always absolute

# P2: 1-second timeout prevents hanging on half-open ports
if ! nc -z -w 1 localhost "$DOLT_PORT" 2>/dev/null; then
  echo "Error: Dolt server not reachable on port $DOLT_PORT. Run: bd dolt start" >&2
  exit 1
fi

BEADS_WEB_BIN="${BEADS_WEB_BIN:-$SCRIPT_DIR/server/target/release/beads-web}"

# P1: check binary exists before exec
if [[ ! -x "$BEADS_WEB_BIN" ]]; then
  echo "Error: beads-web binary not found at $BEADS_WEB_BIN" >&2
  echo "  Build it with: cd $SCRIPT_DIR/server && cargo build --release" >&2
  exit 1
fi

echo "Dolt OK on port $DOLT_PORT. Starting beads-web..."
echo "Dashboard: http://localhost:$BEADS_WEB_PORT"

# P4: export so the server process can read it
export BEADS_WEB_PORT
exec "$BEADS_WEB_BIN"
