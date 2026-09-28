"use client";

import { PackageOpen } from "lucide-react";

import { BeadCard } from "@/components/bead-card";
import { EpicCard } from "@/components/epic-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Bead, Epic, StatusCategory } from "@/types";

export interface ColumnColors {
  /** CSS colour for --column-accent, which some themes paint cards with */
  accent: string;
  /** Top border of the header */
  border: string;
  /** Column title */
  text: string;
  /** Count badge */
  badge: string;
}

/**
 * Colours by status group, from the theme's existing variables: active as
 * open, wip as in progress, done as closed, frozen muted. Full class names,
 * so Tailwind finds them.
 */
const COLUMN_COLORS: Record<StatusCategory, ColumnColors> = {
  active: {
    accent: "hsl(var(--status-open))",
    border: "border-t-2 border-t-status-open/60",
    text: "text-status-open",
    badge: "bg-status-open/20 text-status-open border-status-open/30 hover:bg-status-open/20",
  },
  wip: {
    accent: "hsl(var(--status-progress))",
    border: "border-t-2 border-t-status-progress/60",
    text: "text-status-progress",
    badge: "bg-status-progress/20 text-status-progress border-status-progress/30 hover:bg-status-progress/20",
  },
  done: {
    accent: "hsl(var(--status-closed))",
    border: "border-t-2 border-t-status-closed/60",
    text: "text-status-closed",
    badge: "bg-status-closed/20 text-status-closed border-status-closed/30 hover:bg-status-closed/20",
  },
  frozen: {
    accent: "hsl(var(--text-muted))",
    border: "border-t-2 border-t-t-muted/60",
    text: "text-t-tertiary",
    badge: "bg-t-muted/20 text-t-tertiary border-t-muted/30 hover:bg-t-muted/20",
  },
};

export function getColumnColors(category: StatusCategory): ColumnColors {
  return COLUMN_COLORS[category];
}

export interface KanbanColumnProps {
  status: string;
  title: string;
  /** Group of the status; sets the column's colour */
  category: StatusCategory;
  /** Draw as a narrow strip with the name only (an empty column) */
  collapsed?: boolean;
  beads: Bead[];
  /** All beads for resolving epic children */
  allBeads: Bead[];
  selectedBeadId?: string | null;
  ticketNumbers?: Map<string, number>;
  onSelectBead: (bead: Bead) => void;
  onChildClick?: (child: Bead) => void;
  onNavigateToDependency?: (beadId: string) => void;
  /** Project root path for fetching design docs */
  projectPath?: string;
  /** Callback after data changes (to refresh board) */
  onUpdate?: () => void;
  /** Board shows an old copy from issues.jsonl: writes are disabled */
  readOnly?: boolean;
}

/**
 * Type guard to check if a bead is an epic
 */
function isEpic(bead: Bead): bead is Epic {
  return bead.issue_type === 'epic';
}

type BeadListProps = Omit<KanbanColumnProps, "status" | "title" | "category" | "collapsed">;

type ColumnCardProps = Omit<BeadListProps, "beads"> & { bead: Bead };

/**
 * One card of a column: EpicCard for an epic, BeadCard for the rest
 */
function ColumnCard({ bead, ticketNumbers, selectedBeadId, onSelectBead, onChildClick, readOnly = false, ...rest }: ColumnCardProps) {
  const common = {
    allBeads: rest.allBeads,
    ticketNumber: ticketNumbers?.get(bead.id),
    isSelected: selectedBeadId === bead.id,
    onSelect: onSelectBead,
  };
  if (!isEpic(bead)) return <BeadCard bead={bead} {...common} />;
  return (
    <EpicCard
      epic={bead}
      {...common}
      onChildClick={onChildClick ?? onSelectBead}
      onNavigateToDependency={rest.onNavigateToDependency}
      projectPath={rest.projectPath}
      onUpdate={rest.onUpdate}
      readOnly={readOnly}
    />
  );
}

/**
 * Scrollable list of a column's cards, or a placeholder when it has none
 */
function BeadList({ beads, ...cardProps }: BeadListProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <div className="space-y-3">
        {beads.map((bead) => <ColumnCard key={bead.id} bead={bead} {...cardProps} />)}
        {beads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-b-strong/50 rounded-lg">
            <PackageOpen className="size-8 text-t-muted mb-2" aria-hidden="true" />
            <span className="text-t-muted text-sm">No beads</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * An empty column shrunk to a narrow strip: the name reads top to bottom
 */
function CollapsedColumn({ title, colors }: { title: string; colors: ColumnColors }) {
  return (
    <section
      aria-label={`${title}, no beads`}
      title={`${title}: no beads`}
      data-collapsed="true"
      className={cn(
        "flex flex-col items-center gap-2 w-10 flex-none py-3 theme-column",
        "bg-surface-raised/30 border border-b-default/50",
        colors.border
      )}
      style={{ '--column-accent': colors.accent } as React.CSSProperties}
    >
      <Badge variant="secondary" className={cn("text-xs px-1.5 py-0.5 column-count-badge", colors.badge)}>
        0
      </Badge>
      <span className={cn("font-semibold text-sm column-title-text [writing-mode:vertical-rl]", colors.text)}>
        {title}
      </span>
    </section>
  );
}

/**
 * Kanban column with header, count badge and scrollable bead list, coloured
 * by its status group. An empty column other than open, in progress and
 * closed is drawn collapsed.
 */
export function KanbanColumn({ status, title, category, collapsed = false, ...listProps }: KanbanColumnProps) {
  const colors = getColumnColors(category);
  if (collapsed) return <CollapsedColumn title={title} colors={colors} />;
  return (
    <section
      aria-label={title}
      data-status={status}
      className={cn(
        "flex flex-col min-h-0 min-w-64 flex-1 basis-0 theme-column",
        "bg-surface-raised/30 border border-b-default/50"
      )}
      style={{ '--column-accent': colors.accent } as React.CSSProperties}
    >
      {/* Column Header - fixed height with colored accent border */}
      <div className={cn(
        "flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-b-default/50 brutalist-column-header",
        colors.border
      )}>
        <h2 className={cn("font-semibold text-sm column-title-text", colors.text)}>{title}</h2>
        <Badge
          variant="secondary"
          className={cn("text-xs px-2 py-0.5 column-count-badge", colors.badge)}
        >
          {listProps.beads.length}
        </Badge>
      </div>
      <BeadList {...listProps} />
    </section>
  );
}
