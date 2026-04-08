#!/usr/bin/env bats
# Requires bats-core >= 1.5 for dolt_up() helper pattern

SCRIPT="$BATS_TEST_DIRNAME/../start.sh"
STUBS="$BATS_TEST_DIRNAME/stubs"

setup() {
  # Default: Dolt NOT running
  export PATH="$STUBS/dolt-down:$PATH"
  # Stub beads-web binary (no-op)
  export BEADS_WEB_BIN="$STUBS/beads-web-bin"
}

dolt_up() { PATH="$STUBS/dolt-up:$PATH" "$@"; }

# --- Dolt unreachable ---

@test "exits non-zero when Dolt is not reachable" {
  run bash "$SCRIPT"
  [ "$status" -ne 0 ]
}

@test "prints error message when Dolt is not reachable" {
  run bash "$SCRIPT"
  [[ "$output" == *"Dolt"* ]]
}

@test "error message includes the configured port" {
  DOLT_PORT=3399 run bash "$SCRIPT"
  [[ "$output" == *"3399"* ]]
}

@test "nc stub is invoked with the configured port" {
  DOLT_PORT=3399 run bash "$SCRIPT"
  # dolt-down/nc echoes sentinel + args to stderr, captured in $output by bats
  [[ "$output" == *"nc-stub args:"*"3399"* ]]
}

# --- Binary missing ---

@test "exits non-zero when beads-web binary is missing" {
  BEADS_WEB_BIN="/nonexistent/beads-web" dolt_up run bash "$SCRIPT"
  [ "$status" -ne 0 ]
}

@test "prints build hint when beads-web binary is missing" {
  BEADS_WEB_BIN="/nonexistent/beads-web" dolt_up run bash "$SCRIPT"
  [[ "$output" == *"cargo build"* ]]
}

# --- Dolt reachable ---

@test "exits zero when Dolt is reachable" {
  dolt_up run bash "$SCRIPT"
  [ "$status" -eq 0 ]
}

@test "prints dashboard URL when Dolt is reachable" {
  dolt_up run bash "$SCRIPT"
  [[ "$output" == *"http://localhost:3007"* ]]
}

@test "dashboard URL reflects BEADS_WEB_PORT env var" {
  BEADS_WEB_PORT=4000 dolt_up run bash "$SCRIPT"
  [[ "$output" == *"http://localhost:4000"* ]]
}
