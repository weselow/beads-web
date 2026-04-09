"use client";

import { useDroppable } from "@dnd-kit/core";

import { PackageOpen } from "lucide-react";

import { BeadCard } from "@/components/bead-card";
import { EpicCard } from "@/components/epic-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Bead, BeadStatus, Epic } from "@/types";

/**
 * Get the CSS color value for a column's accent (used as --column-accent)
 */
function getColumnAccentColor(status: BeadStatus): string {
  switch (status) {
    case "open": return "hsl(var(--status-open))";
    case "in_progress": return "hsl(var(--status-progress))";
    case "inreview": return "hsl(var(--status-review))";
    case "closed": return "hsl(var(--status-closed))";
    default: return "hsl(var(--text-muted))";
  }
}

export interface KanbanColumnProps {
  status: BeadStatus;
  title: string;
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
}

/**
 * Get accent border class for column header based on status
 */
function getColumnAccentBorder(status: BeadStatus): string {
  switch (status) {
    case "open":
      return "border-t-2 border-t-status-open/60";
    case "in_progress":
      return "border-t-2 border-t-status-progress/60";
    case "inreview":
      return "border-t-2 border-t-status-review/60";
    case "closed":
      return "border-t-2 border-t-status-closed/60";
    default:
      return "border-t-2 border-t-t-muted/60";
  }
}

/**
 * Get header text color based on status
 */
function getHeaderTextColor(status: BeadStatus): string {
  switch (status) {
    case "open":
      return "text-status-open";
    case "in_progress":
      return "text-status-progress";
    case "inreview":
      return "text-status-review";
    case "closed":
      return "text-status-closed";
    default:
      return "text-t-tertiary";
  }
}

/**
 * Get badge color class for count badge based on status (dark theme)
 */
function getBadgeVariant(status: BeadStatus): string {
  switch (status) {
    case "open":
      return "bg-status-open/20 text-status-open border-status-open/30 hover:bg-status-open/20";
    case "in_progress":
      return "bg-status-progress/20 text-status-progress border-status-progress/30 hover:bg-status-progress/20";
    case "inreview":
      return "bg-status-review/20 text-status-review border-status-review/30 hover:bg-status-review/20";
    case "closed":
      return "bg-status-closed/20 text-status-closed border-status-closed/30 hover:bg-status-closed/20";
    default:
      return "bg-t-muted/20 text-t-tertiary border-t-muted/30 hover:bg-t-muted/20";
  }
}

/**
 * Type guard to check if a bead is an epic
 */
function isEpic(bead: Bead): bead is Epic {
  return bead.issue_type === 'epic';
}

/**
 * Reusable Kanban column component with header, count badge, and scrollable bead list
 * Renders EpicCard for epics and BeadCard for standalone tasks
 */
export function KanbanColumn({
  status,
  title,
  beads,
  allBeads,
  selectedBeadId,
  ticketNumbers,
  onSelectBead,
  onChildClick,
  onNavigateToDependency,
  projectPath,
  onUpdate,
}: KanbanColumnProps) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setDropRef}
      className={cn(
        "flex flex-col h-full min-h-0 theme-column",
        "bg-surface-raised/30 border border-b-default/50",
        isOver && "ring-2 ring-inset ring-primary/30"
      )}
      style={{ '--column-accent': getColumnAccentColor(status) } as React.CSSProperties}
    >
      {/* Column Header - fixed height with colored accent border */}
      <div className={cn(
        "flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-b-default/50 brutalist-column-header",
        getColumnAccentBorder(status)
      )}>
        <h2 className={cn("font-semibold text-sm column-title-text", getHeaderTextColor(status))}>{title}</h2>
        <Badge
          variant="secondary"
          className={cn("text-xs px-2 py-0.5 column-count-badge", getBadgeVariant(status))}
        >
          {beads.length}
        </Badge>
      </div>

      {/* Scrollable Bead List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="space-y-3">
          {beads.map((bead) => {
            // Render EpicCard for epics, BeadCard for standalone tasks
            if (isEpic(bead)) {
              return (
                <EpicCard
                  key={bead.id}
                  epic={bead}
                  allBeads={allBeads}
                  ticketNumber={ticketNumbers?.get(bead.id)}
                  isSelected={selectedBeadId === bead.id}
                  onSelect={onSelectBead}
                  onChildClick={onChildClick ?? onSelectBead}
                  onNavigateToDependency={onNavigateToDependency}
                  projectPath={projectPath}
                  onUpdate={onUpdate}
                />
              );
            }

            return (
              <BeadCard
                key={bead.id}
                bead={bead}
                ticketNumber={ticketNumbers?.get(bead.id)}
                isSelected={selectedBeadId === bead.id}
                onSelect={onSelectBead}
              />
            );
          })}
          {beads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-b-strong/50 rounded-lg">
              <PackageOpen className="size-8 text-t-muted mb-2" aria-hidden="true" />
              <span className="text-t-muted text-sm">No beads</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
