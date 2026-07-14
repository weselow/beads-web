<div align="center">

# BEADS WEB

**Visual command center for beads task tracking.**

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

<br>

![Beads Web — Kanban Board](screenshots/kanban-main.png)

<br>

[Why](#why) · [Origin](#origin) · [Features](#features) · [Themes](#themes) · [Installation](#installation) · [Development](#development) · [FAQ](#faq) · [Troubleshooting](docs/troubleshooting/README.md)

**[Русская версия](README-ru.md)**

</div>

---

## Why

Beads CLI is powerful for task tracking, but:
- No visual overview of task status across columns
- No drag-and-drop to move tasks between states
- No way to see epic progress at a glance
- No visual diff between blocked, ready, and in-progress

Beads Web gives you a real-time Kanban board, multi-project dashboard, and git operations — without leaving the browser.

## Origin

Inspired by [Beads-Kanban-UI](https://github.com/AvivK5498/Beads-Kanban-UI) by Aviv Kaplan. The original author appears to have stopped development — PRs go unreviewed for months.

This fork has diverged significantly: 84 files changed, ~9500 lines added.

<details>
<summary>What changed (summary)</summary>

- 11 visual themes with persistence and flash prevention
- Inline editing for bead fields (click to edit title, description, notes)
- Click-to-copy bead IDs
- Dolt direct SQL integration (no filesystem needed)
- One-click project discovery from Dolt databases
- Windows multi-drive path support
- File browser for adding projects
- Decomposed components (bead-detail, epic-card, etc.)
- Vitest test setup
- Full component decomposition and refactoring
- Drag-and-drop status updates

</details>

Full changelog with rationale: [docs/changelog.md](docs/changelog.md)

## Features

- **Multi-project dashboard** — all projects in one place with status donut charts
- **Kanban board** — Open → In Progress → In Review → Closed with drag-to-update
- **Epic support** — group tasks with visual progress bars, view subtasks
- **GitOps** — create, view, and merge PRs from the board. CI status, merge conflicts, auto-close
- **Memory panel** — browse, search, edit knowledge base entries
- **11 themes** — Default Dark, Glassmorphism, Neo-Brutalist, Linear Minimal, Soft Light, Notion Warm, GitHub Clean, plus Catppuccin Latte, Frappe, Macchiato, and Mocha
- **Dolt integration** — connect to Dolt databases directly, no filesystem path needed
- **Real-time sync** — SSE file watcher for local projects, polling for Dolt

## Themes

Soft Light theme is shown in the main screenshot above.

<details>
<summary>See all included themes</summary>

**Default Dark**
![Default Dark](screenshots/kanban-default.png)

**Glassmorphism**
![Glassmorphism](screenshots/kanban-glassmorphism.png)

**Neo-Brutalist**
![Neo-Brutalist](screenshots/kanban-neo-brutalist.png)

**Linear Minimal**
![Linear Minimal](screenshots/kanban-linear-minimal.png)

**Notion Warm**
![Notion Warm](screenshots/kanban-notion-warm.png)

**GitHub Clean**
![GitHub Clean](screenshots/kanban-github-clean.png)

**Catppuccin**
Latte, Frappe, Macchiato, and Mocha are available from the theme switcher.

</details>

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS, Radix UI, dnd-kit
- **Backend**: Rust (Axum), SQLite, Dolt SQL
- **Build**: Static export embedded into Rust binary via rust-embed

## Installation

### Prerequisites

- [Beads CLI](https://github.com/steveyegge/beads) (`bd`) installed and available in PATH

### Download

Download the binary for your platform from [GitHub Releases](https://github.com/weselow/beads-web/releases/latest):

| Platform | File |
|----------|------|
| Windows x64 | `beads-web-win-x64.exe` |
| macOS Apple Silicon | `beads-web-darwin-arm64` |
| macOS Intel | `beads-web-darwin-x64` |
| Linux x64 | `beads-web-linux-x64` |

Each release also ships a `SHA256SUMS.txt` to verify your download.

### Package managers

**Scoop (Windows):**

```powershell
scoop bucket add beads-web https://github.com/weselow/beads-web
scoop install beads-web
```

Update later with `scoop update beads-web`.

**Nix (macOS / Linux / WSL):**

```bash
nix run github:weselow/beads-web
```

**Homebrew (macOS / Linux):**

```bash
brew install weselow/beads-web/beads-web
```

**winget (Windows):**

```powershell
winget install weselow.beads-web
```

### Run

```bash
# macOS/Linux — make executable, then run
chmod +x beads-web-*
./beads-web-darwin-arm64

# Windows
beads-web-win-x64.exe
```

Open http://localhost:3008. The frontend is embedded in the binary — no Node.js or Rust needed.

## Development

Prerequisites: Node.js 20+, [Rust toolchain](https://rustup.rs/), and the [Beads CLI](https://github.com/steveyegge/beads) (`bd`) in PATH.

```bash
git clone https://github.com/weselow/beads-web.git
cd beads-web
npm install
```

There are two workflows: **Dev Mode** (frontend hot-reload) and **Build from Source** (release binary).

### Dev Mode (frontend hot-reload)

The Next.js dev server (port 3007) serves the frontend with hot-reload; the Rust backend (port 3008) serves the API. They talk cross-origin — CORS is open on the backend.

1. **Point the frontend at the backend:**

   ```bash
   cp .env.local.example .env.local   # sets NEXT_PUBLIC_BACKEND_URL=http://localhost:3008
   ```

2. **Generate the `out/` folder once** (with `output: 'export'` still enabled). The Rust server embeds `out/` via rust-embed, so it must exist before you build the backend:

   ```bash
   npm run build
   ```

3. **Then** comment out `output: 'export'` in `next.config.js` — `next dev` is incompatible with static export.

4. **Run both servers** in separate terminals:

   ```bash
   npm run dev              # Terminal 1 — frontend on http://localhost:3007
   cd server && cargo run   # Terminal 2 — backend/API on http://localhost:3008
   ```

5. Open **http://localhost:3007**. Frontend edits hot-reload; API requests go to the backend on :3008.

> The `.env.local` / `NEXT_PUBLIC_BACKEND_URL` step is **dev-only**. Remove it (or leave it unset) for a release build, where frontend and backend share one origin.

### Build from Source (release binary)

Produces the same self-contained binary that CI publishes to [Releases](https://github.com/weselow/beads-web/releases/latest) — the frontend is embedded, so no Node.js or Rust is needed at runtime.

```bash
npm install
# keep `output: 'export'` enabled in next.config.js (the default)
npm run build                 # static export → out/
cd server
cargo build --release         # binary → server/target/release/beads-server (.exe on Windows)
```

Run the binary and open **http://localhost:3008**:

```bash
./server/target/release/beads-server
```

## FAQ

**Q: Do I need Dolt?**
A: No. Beads Web works with local filesystem projects using `bd` CLI. Dolt adds direct SQL access and remote database support.

**Q: How do I add a project?**
A: Click "Add Project" on the dashboard. Browse to your project folder or enter a `dolt://` URL.

## Credits

- [Beads-Kanban-UI](https://github.com/AvivK5498/Beads-Kanban-UI) by Aviv Kaplan — original project
- [beads](https://github.com/steveyegge/beads) by Steve Yegge — git-native task tracking
- [Claude Protocol](https://github.com/weselow/claude-protocol) — orchestration framework (works great together)

## License

MIT
