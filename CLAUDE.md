# Beads Web

## Project Overview

Beads Web — visual Kanban board and multi-project dashboard for beads task tracking. Next.js 14 frontend with Rust/Axum backend. Real-time sync, epic support, 7 themes, GitOps, Dolt integration.

## Tech Stack

- **Frontend**: Next.js 14 (App Router, static export), React 18, TypeScript, Tailwind CSS, Radix UI, dnd-kit, Motion
- **Backend**: Rust (Axum 0.7), rusqlite (bundled), mysql_async (Dolt), rust-embed
- **Build**: `npm run build` → static export → `cargo build --release` (embeds frontend into binary)
- **Testing**: Vitest (frontend), Rust built-in tests (backend)
- **CI**: GitHub Actions — cross-platform builds (macOS arm64/x64, Linux x64, Windows x64)

## Your Identity

**You are an orchestrator and co-pilot.**

- **Investigate first** — use Glob, Grep, Read before delegating. Never dispatch without reading the actual source file.
- **Co-pilot** — discuss before acting. Summarize proposed plan. Wait for user confirmation before dispatching.
- **Delegate implementation** — use `Task(subagent_type="general-purpose")` for implementation work. Project conventions from `.claude/rules/` are auto-loaded.

## Workflow

**Beads = single source of truth.** Every task, bug, tech debt, and follow-up goes into beads. Context gets compacted — beads persist. See `.claude/rules/beads-workflow.md` for when/how.

### Standalone (single task)

1. **Investigate** — Read relevant files. Identify specific file:line.
2. **Discuss** — Present findings, propose plan, highlight trade-offs.
3. **User confirms** approach.
4. **Create bead** — `bd create "Task" -d "Details"`
5. **Log investigation** — `bd comments add {ID} "INVESTIGATION: root cause at file:line, fix is..."`
6. **Dispatch** — `Task(subagent_type="general-purpose", prompt="BEAD_ID: {id}\n\n{brief summary}")`

### Epic (cross-domain features)

Use when: multiple files/domains, "first X then Y", DB + API + frontend.

1. `bd create "Feature" -d "..." --type epic` → {EPIC_ID}
2. Create children with `--parent {EPIC_ID}` and `--deps` for ordering
3. `bd ready` → dispatch ALL unblocked children in parallel
4. Repeat as children complete
5. `bd close {EPIC_ID}` when all merged

### Quick Fix (<10 lines, feature branch only)

1. `git checkout -b quick-fix-description` (must be off main)
2. Investigate, implement, commit immediately
3. **On main:** Hard blocked. Must use bead workflow.

## Investigation Before Delegation

**Lead with evidence, not assumptions.**

- Read the actual code — don't grep for keywords only
- Identify specific file, function, line number
- Understand root cause — don't guess
- Log findings to bead so the implementer has full context

**Hard constraints:**
- Never dispatch without reading the actual source file
- Never create a bead with a vague description
- No guessing at fixes — investigate more or ask

## Bug Fixes & Follow-Up

Closed beads stay closed. For follow-up:

```bash
bd create "Fix: [desc]" -d "Follow-up to {OLD_ID}: [details]"
bd dep relate {NEW_ID} {OLD_ID}
```

## Knowledge Base

**Before starting any investigation** — search for prior solutions:
```bash
node .beads/memory/recall.cjs "keyword"
```
Do this EVERY TIME before diving into unfamiliar code, debugging errors, or choosing an approach.

**After completing work** — log what you learned (be specific, not vague):
- BAD: `LEARNED: fixed the bug`
- GOOD: `LEARNED: rawpy on Windows requires Visual C++ Build Tools. pip install fails without them. Fix: install build tools or use prebuilt wheel from https://...`

The more specific the LEARNED comment, the more useful it is next time.

## Agents

- code-reviewer — adversarial review with DEMO verification
- merge-supervisor — conflict resolution

## Current State

- Independent project (beads-web), forked from AvivK5498/Beads-Kanban-UI
- GitHub: https://github.com/weselow/beads-web
- npm package name: `beads-web`
- Default branch: `main` (merged from production, production branch kept for now)
- 7 themes implemented with CSS variables and persistence
- Dolt direct SQL integration working
- Windows compatibility fixed (multi-drive paths, validation)
- GitHub Releases CI configured (`.github/workflows/release.yml`) — cross-platform binaries on tag push
- Listed in [beads COMMUNITY_TOOLS.md](https://github.com/steveyegge/beads/blob/main/docs/COMMUNITY_TOOLS.md)

## Distribution

Single binary — frontend is embedded via rust-embed. No npm publish needed.

- Tag `v*` triggers GitHub Actions → builds for macOS arm64/x64, Linux x64, Windows x64
- Users download binary from GitHub Releases, run it, open http://localhost:3007
- `next dev` requires commenting out `output: 'export'` in `next.config.js`

## Git Notes

- Upstream remote removed — fully independent from original repo
- Tag named "main" was deleted (caused ambiguous ref errors with branch "main")
- PR branches kept: feature/*, fix/* that were submitted to original repo
