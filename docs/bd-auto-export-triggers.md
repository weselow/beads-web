# bd auto-export: when does JSONL update?

Research note for `server/src/routes/watch.rs`. Applies to bd v1.0.2 (`a3f834b3`) on Windows.

## TL;DR

`bd` auto-export is a post-write hook, throttled to at most one write to `.beads/issues.jsonl` per 60 seconds. Inside that window, subsequent writes are **silently skipped** — there is no background timer that flushes pending state once the throttle expires. A single isolated write followed by idle leaves JSONL stale until the next external write arrives. A file watcher on `.beads/issues.jsonl` is therefore a **fast-path signal only**, not a guaranteed real-time one. The existing 15 s polling in `src/hooks/use-beads.ts` must stay.

## Configuration

From `bd help config`:

| Key               | Default         | Meaning                                                  |
|-------------------|-----------------|----------------------------------------------------------|
| `export.auto`     | `true`          | Enable/disable auto-export                               |
| `export.path`     | `issues.jsonl`  | Output filename, relative to `.beads/`                   |
| `export.interval` | `60s`           | Minimum time between exports (silent skip if too soon)   |
| `export.git-add`  | `true`          | Auto-stage the export file after write                   |

From the help text: *"Writes `.beads/issues.jsonl` after every write command (throttled). Enabled by default. Useful for viewers (bv) and git-based sync."*

## Write commands that trigger export

Verified in `/tmp/bd-export-test` (embedded Dolt mode). Each command was executed at least 60 s after the previous export so the throttle was idle; JSONL mtime advance was confirmed.

| Command                                   | Triggers export? | Notes                                                 |
|-------------------------------------------|------------------|-------------------------------------------------------|
| `bd create --title=... -d=...`            | yes              |                                                       |
| `bd update <id> --status <s>`             | yes              |                                                       |
| `bd update <id> --title=...`              | yes              |                                                       |
| `bd close <id>`                           | yes              |                                                       |
| `bd comments add <id> "..."`              | yes              |                                                       |
| `bd remember "..."`                       | yes              |                                                       |
| `bd dep add <id> <blocker>`               | yes              |                                                       |
| `bd sql <DML>`                            | n/a here         | Not supported in embedded mode; reported to trigger in server mode |

Auto-export is a bd-core post-write hook, not tied to a storage backend, so server-mode behavior should match embedded-mode behavior aside from `bd sql` availability.

## The 60 s throttle (the gotcha)

The throttle is a "skip if last export < `export.interval` ago" guard — nothing more.

**Burst test.** Three `bd comments add` calls back-to-back at `t=0s`, `t=2s`, `t=4s`:

- Burst 1 (`t=0s`): JSONL mtime advanced (1776859264 → 1776859341).
- Burst 2 (`t=2s`): mtime unchanged.
- Burst 3 (`t=4s`): mtime unchanged.
- Idle for 65 s after the burst: mtime **still unchanged**.
- `grep -c "burst" .beads/issues.jsonl` → `1`, not `3`.

Only the **next write after the throttle expires** flushes the accumulated state. In the meantime, bursts 2 and 3 exist in Dolt but are invisible to anyone tailing the JSONL.

**Idle test.** After a write, 65 s of pure idle → JSONL mtime does not change on its own (1776858800 → 1776858800). The subsequent write (e.g. `bd update`) then triggers an export as expected (→ 1776858886).

Implication: there is no background flush thread. "Throttle expired" is a passive state; only a write event advances the file.

## Impact on `server/src/routes/watch.rs`

The server's SSE file watcher tracks changes under a project's filesystem path. For bd-backed projects it relies on `.beads/issues.jsonl` being touched after each write.

Given the behavior above:

- The watcher fires **only when an export actually lands on disk**, i.e. the first write after the throttle clears. All subsequent writes inside the same 60 s window are invisible to the watcher.
- Bursty workloads (rapid edits from the UI, scripted bulk updates) surface one event, then go quiet. The UI would show the first mutation and miss the rest until the next post-throttle write.
- Pure `dolt://` projects have no filesystem path at all, so the watcher is unusable by design. This is already gated upstream via `validate_path_security` and the `dolt://` prefix guards.
- Filesystem-backed Dolt and plain bd projects still benefit from the watcher for the "first write" fast path — it is useful, just not sufficient.

Conclusion: the watcher is an opportunistic low-latency signal on top of polling, not a replacement for polling.

## Recommendation

- **Keep** the 15 s polling in `src/hooks/use-beads.ts:204` as the correctness floor. Do not switch to watcher-only.
- **Keep** the SSE watcher as a fast path for the isolated-write case; it does not hurt and it shortens latency when it does fire.
- **Short term:** status quo. No code changes required.
- **Long term:** consider requesting one of the following upstream in bd:
  - A timer-driven flush that fires when the throttle expires even without a write.
  - A `bd flush` / `bd export` command we can invoke from the server on a schedule to force the JSONL to converge.

## Follow-up candidates (not filed here)

The orchestrator may decide whether to create beads for any of these:

- Tune polling interval per project kind: keep 15 s (or lower) uniformly, or reserve tight polling for pure `dolt://` projects with no filesystem path. The current 15 s applies uniformly and is fine as a default.
- File an upstream issue with beads requesting a throttle-flush timer or an explicit `bd flush` command, so JSONL consumers are guaranteed to converge within `export.interval` even without new writes.
