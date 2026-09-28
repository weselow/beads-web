/**
 * Bead counts by status for a project
 */
export interface BeadCounts {
  open: number;
  in_progress: number;
  inreview: number;
  closed: number;
}

/**
 * Cached per-project bead counts served by `GET /api/projects`.
 *
 * Populated by the backend after any successful `/api/beads` read and
 * used by the home page to render donut charts immediately on first
 * paint, before fresh counts finish loading.
 */
export interface CachedCounts extends BeadCounts {
  /** Source that produced these cached counts (e.g. 'dolt-direct', 'jsonl'). */
  dataSource?: string | null;
  /** ISO-8601 timestamp of when the cache row was last refreshed. */
  updatedAt: string;
}

/**
 * Project stored in local SQLite
 */
export interface Project {
  id: string;
  name: string;
  path: string;
  localPath?: string;
  tags: Tag[];
  lastOpened: string;
  createdAt: string;
  archivedAt?: string;
  beadCounts?: BeadCounts;
  dataSource?: string;
  beadError?: string;
  /**
   * Cached counts payload from the server. Present on responses from
   * `GET /api/projects` when a cache row exists, `null` for brand-new
   * projects that have never been read yet. Consumed by `useProjects`
   * to seed `beadCounts` on initial render for instant donut paint.
   */
  cachedCounts?: CachedCounts | null;
  /**
   * True once counts on this project have been seeded from either the
   * server cache OR an in-memory previous load. False while we are
   * showing an empty placeholder donut awaiting the first fetch.
   */
  countsLoaded?: boolean;
}

/**
 * Tag stored in local SQLite
 */
export interface Tag {
  id: string;
  name: string;
  color: string;
}

/**
 * Group a bd status belongs to. bd 1.3.0 gives every status one of these.
 */
export type StatusCategory = 'active' | 'wip' | 'done' | 'frozen';

/**
 * One status of a project, from `GET /api/statuses`: bd's built-in statuses
 * plus the project's own from `status.custom`.
 */
export interface StatusInfo {
  name: string;
  category: StatusCategory;
  builtin: boolean;
}


/**
 * Badge on a card that sits in a column other than its own status.
 */
export interface StatusBadgeInfo {
  /** Label shown on the badge */
  label: string;
  /** Tailwind color classes for the badge */
  variant: 'warning' | 'muted' | 'info';
}

/**
 * Bead from .beads/issues.jsonl
 */
export interface Bead {
  id: string;
  title: string;
  description?: string;
  /** The status bd holds, e.g. `blocked` or a project's own `inreview`. */
  status: string;
  priority: number;
  issue_type: string;
  owner: string;
  created_at: string;
  updated_at: string;
  comments: Comment[];
  // Epic support fields
  parent_id?: string;         // ID of parent epic (for child tasks)
  children?: string[];        // IDs of child tasks (for epics)
  design?: string;            // Inline design notes (bd --design)
  notes?: string;             // Supplementary notes (bd --notes)
  close_reason?: string;      // Reason set when closing (bd close --reason)
  deps?: string[];            // Dependency IDs (blocking this task)
  blockers?: string[];        // COMPUTED: Tasks this blocks (derived from deps relationships)
  relates_to?: string[];      // Bead IDs with relates-to links (bidirectional "see also")
  // Set on a copy of the bead when it is shown in a column other than its status
  _statusBadge?: StatusBadgeInfo;
}

/**
 * Comment from .beads/issues.jsonl
 */
export interface Comment {
  id: number | string;
  issue_id: string;
  author: string;
  text: string;
  created_at: string;
}

/**
 * One column of the board: a status of the project with the beads shown in it
 * (see src/lib/board-columns.ts).
 */
export interface BoardColumn {
  status: string;
  title: string;
  /** Group of the status; sets the column's colour. */
  category: StatusCategory;
  /** Drawn as a narrow strip: empty, and not one of open, in_progress, closed. */
  collapsed: boolean;
  beads: Bead[];
}

/**
 * GitHub PR info (legacy - for backward compatibility)
 * @deprecated Use PRInfo from the PR Status Types section instead
 */
export interface LegacyPRInfo {
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  statusCheckRollup: { state: 'SUCCESS' | 'FAILURE' | 'PENDING' } | null;
}

/**
 * Epic progress metrics (computed from children)
 */
export interface EpicProgress {
  total: number;       // Total number of child tasks
  completed: number;   // Number of children with status 'closed'
  inProgress: number;  // Number of children with status 'in_progress'
  blocked: number;     // Number of children with unresolved dependencies
}

/**
 * Epic-specific bead type
 */
export interface Epic extends Bead {
  issue_type: 'epic';
  children: string[];     // Epics always have children (required, not optional)
  progress?: EpicProgress; // Computed progress metrics
}

// ============================================================================
// Worktree Types
// ============================================================================

/**
 * Worktree status from GET /api/git/worktree-status
 */
export interface WorktreeStatus {
  /** Whether the worktree exists */
  exists: boolean;
  /** Path to the worktree (null if doesn't exist) */
  worktree_path: string | null;
  /** Branch name (null if doesn't exist) */
  branch: string | null;
  /** Number of commits ahead of main */
  ahead: number;
  /** Number of commits behind main */
  behind: number;
  /** Whether there are uncommitted changes */
  dirty: boolean;
  /** Last modification time of the worktree (ISO 8601 string) */
  last_modified: string | null;
}

/**
 * Worktree entry from GET /api/git/worktrees list
 */
export interface WorktreeEntry {
  /** Path to the worktree */
  path: string;
  /** Branch name */
  branch: string;
  /** Extracted bead ID (if matches bd-{ID} pattern) */
  bead_id?: string;
}

// ============================================================================
// PR Status Types
// ============================================================================

/**
 * CI checks status for a PR
 */
export interface PRChecks {
  /** Total number of checks */
  total: number;
  /** Number of passed checks */
  passed: number;
  /** Number of failed checks */
  failed: number;
  /** Number of pending checks */
  pending: number;
  /** Overall status */
  status: 'success' | 'failure' | 'pending';
}

/**
 * GitHub API rate limit information
 */
export interface RateLimit {
  /** Remaining API calls */
  remaining: number;
  /** Total limit */
  limit: number;
  /** Reset time (ISO 8601 string) */
  reset_at: string;
}

/**
 * PR state type
 */
export type PRState = 'open' | 'merged' | 'closed';

/**
 * PR information
 */
export interface PRInfo {
  /** PR number */
  number: number;
  /** PR URL */
  url: string;
  /** PR state */
  state: PRState;
  /** CI checks status */
  checks: PRChecks;
  /** Whether the PR is mergeable */
  mergeable: boolean;
}

/**
 * PR status response from GET /api/git/pr-status
 */
export interface PRStatus {
  /** Whether the repo has a remote */
  has_remote: boolean;
  /** Whether the branch has been pushed */
  branch_pushed: boolean;
  /** PR information (null if no PR exists) */
  pr: PRInfo | null;
  /** Rate limit information */
  rate_limit: RateLimit;
}

// ============================================================================
// PR Files Types
// ============================================================================

/**
 * File status from GitHub API for PR file changes
 */
export type PRFileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';

/**
 * A single file entry in a PR's changed files list
 */
export interface PRFileEntry {
  filename: string;
  status: PRFileStatus;
  additions: number;
  deletions: number;
  changes: number;
}

/**
 * Response from GET /api/git/pr-files
 */
export interface PRFilesResponse {
  files: PRFileEntry[];
  total_additions: number;
  total_deletions: number;
  total_files: number;
}

// ============================================================================
// Memory Types
// ============================================================================

/**
 * A single memory entry from bd memories
 */
export interface MemoryEntry {
  key: string;
  content: string;
}

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Model names the panel offers as switchable options.
 *
 * An agent file may hold any other value ("inherit", "opusplan", a full model
 * id, or nothing at all) — see {@link Agent.model}.
 */
export type AgentModel = "opus" | "sonnet" | "haiku";

/**
 * Value of the `tools:` field as it reaches the client.
 *
 * The server normalises it to `"*"` (all tools) or an array of tool names, and
 * sends `null` when the field is absent — which also means "all tools".
 * A different string may still arrive from an older server build, so callers
 * must cope with any string.
 */
export type AgentToolsValue = string[] | string | null;

/**
 * An agent definition from .claude/agents/*.md
 */
export interface Agent {
  /** Filename of the agent markdown file (e.g. "reviewer.md") */
  filename: string;
  /** Display name of the agent */
  name: string;
  /**
   * Model written in the agent file, verbatim. Usually one of
   * {@link AgentModel}, but "inherit", "opusplan", a full model id and an
   * empty string (field absent) are all legitimate.
   */
  model: string;
  /** Description of the agent's role */
  description: string;
  /** Allowed tools: a list, "*" for all tools, or null when the field is absent */
  tools?: AgentToolsValue;
  /** Optional nickname for the agent */
  nickname: string | null;
}
