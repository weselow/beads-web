# Changelog — Beads Web (fork of Beads-Kanban-UI)

All notable changes from the original [Beads-Kanban-UI](https://github.com/AvivK5498/Beads-Kanban-UI).

## Added

- **7 visual themes** — Default Dark, Glassmorphism, Neo-Brutalist, Linear Minimal, Soft Light, Notion Warm, and GitHub Clean. Each theme defines semantic CSS variables, a card layout variant (standard, compact-row, or property-tags), and a dark/light mode. Themes persist to localStorage so the user's choice survives page reloads. An inline `<script>` in the root layout applies the saved theme before first paint to prevent a flash of the wrong theme. **Why:** The original had a single hardcoded dark appearance; different users and contexts (demos, daylight work) benefit from distinct visual styles.

- **Theme switcher UI component** — A dropdown accessible from the toolbar that shows live color previews for each theme and applies selection instantly. Dispatches a `theme-change` CustomEvent so all components re-render consistently. **Why:** Needed a discoverable, zero-config way to switch themes without editing code or config files.

- **Inline editing for bead fields** — Title, description, and notes can be edited by clicking directly on the text in the bead detail panel. Fields toggle between display and input mode without opening a separate dialog. Changes are saved via the `bd` CLI on blur or Enter. **Why:** Reduces friction — the original required opening a full edit form to change a single field.

- **Click-to-copy bead IDs** — Clicking a bead's ID badge copies the full ID to the clipboard with a brief visual confirmation. **Why:** Bead IDs are frequently referenced in CLI commands (`bd show`, `bd comments add`); manual selection was error-prone.

- **Dolt direct SQL integration** — A new `dolt://` project prefix and backend route (`server/src/routes/dolt.rs`) lets the UI connect to a running Dolt SQL server via `mysql_async`. Beads are read directly from SQL tables without needing a filesystem path or the `bd` CLI. The backend falls back through three strategies: Dolt SQL, `bd` CLI, then raw JSONL. **Why:** Enables browsing beads in remote or shared Dolt databases that have no local checkout.

- **One-click project discovery from Dolt databases** — The home page queries Dolt for available databases and shows an "Add" button next to each. Clicking it creates a `dolt://`-prefixed project entry in SQLite automatically. **Why:** Manually typing Dolt connection strings was tedious and error-prone; discovery makes it instant.

- **Windows multi-drive path support and validation** — `validate_path_security` in the Rust backend now accepts paths on any Windows drive letter (e.g., `M:\`, `D:\`), not just the system drive. Also handles inaccessible system directories gracefully when scanning for `.beads` folders. **Why:** The original assumed Unix-style paths or a single Windows drive, which broke on development machines with repos on secondary drives.

- **File browser dialog for adding projects** — A modal file browser (`server/src/routes/fs.rs` + frontend dialog) lets users navigate the filesystem to select a project directory, instead of typing or pasting a path. **Why:** Reduces onboarding friction and path typos, especially on Windows where paths are long and backslash-heavy.

- **Component decomposition** — `bead-detail` and `epic-card` were extracted from monolithic files into focused, single-responsibility components. **Why:** The original bead detail component exceeded 400 lines and mixed display, editing, and side-effect logic, making it hard to extend or test.

- **Vitest test setup** — Frontend unit tests using Vitest were introduced alongside the component decomposition (inline editing, click-to-copy, epic card logic). **Why:** No frontend test framework existed in the original; Vitest provides fast, TypeScript-native testing without additional build config.

- **Drag-and-drop status updates on kanban board** — Beads can be dragged between kanban columns to change status, powered by `@dnd-kit`. The drop triggers a `bd update --status` call. **Why:** The original required opening a bead and manually changing its status field; drag-and-drop is the standard kanban interaction pattern.

## Changed

- **Refactored CSS from hardcoded colors to semantic CSS variables** — All hardcoded hex/rgb values across kanban core, secondary components, pages, and dialogs were replaced with CSS custom properties (`--surface-base`, `--t-primary`, `--border-default`, etc.). The `dark` class is no longer hardcoded on `<html>`. **Why:** Prerequisite for the theme system — themes override variables, not individual selectors. Also improves maintainability by centralizing the color palette.

- **Improved epic card layout with progress bars** — Epic cards now show a visual progress bar indicating child task completion percentage, plus a collapsible list of child beads with their statuses. **Why:** The original epic card showed minimal information; progress visibility helps prioritization at a glance.

- **Updated `bd` CLI command format compatibility** — Adapted to new `bd` CLI output format for dependencies, parent, and related fields. Added serde field aliases in the Rust backend and updated the JSONL parser to handle both old and new field names. **Why:** The upstream `bd` CLI changed its JSON output schema; the UI needed to stay compatible without breaking existing data.

## Removed

- **Old npm publishing scripts** — Removed `prepublishOnly`, `postpublish`, and related npm lifecycle scripts from `package.json`. **Why:** This fork is deployed as a compiled Rust binary, not published to npm.

- **IDE history artifacts (`.history/`)** — Removed tracked `.history/` directory containing VS Code local history files. **Why:** IDE-specific artifacts should not be in version control; they bloat the repo and cause merge noise.

- **Playwright test screenshots (`.playwright-mcp/`)** — Removed committed Playwright MCP screenshot artifacts. **Why:** Test screenshots are generated outputs, not source files; they belong in CI artifacts or `.gitignore`.

- **Agentform experimental files** — Removed `agentform` PR reviewer configuration files that were added experimentally. **Why:** The project uses its own code-reviewer agent workflow instead of agentform.

## Infrastructure

- **Cleaned up 60+ stale remote branches** — Pruned and deleted obsolete feature, fix, and experiment branches from the remote. **Why:** Branch clutter made `git branch -r` unusable and confused tooling that lists branches.

- **Moved `.designs/` to `docs/designs/`** — Relocated design mockup assets from a dotfile directory to `docs/designs/`. **Why:** Dotfile directories are hidden by default in file browsers and IDEs, making designs hard to discover. `docs/` is the conventional location.

- **Standardized screenshots directory** — Renamed screenshot directories to lowercase and consolidated them under `docs/`. **Why:** Mixed casing (`Screenshots/` vs `screenshots/`) caused path issues on case-sensitive filesystems (Linux CI).

- **Updated GitHub Actions release workflow** — Renamed release artifacts to use `beads-web` instead of `beads-kanban-ui`, and fixed version input ordering (`inputs.version` before `github.ref_name`). **Why:** The fork was renamed to Beads Web; artifact names and version resolution needed to match.
