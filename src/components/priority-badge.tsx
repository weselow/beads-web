import { cn } from "@/lib/utils";

/** Colours for P0, P1, P2; lower priorities get no mark. */
const PRIORITY_CLASSES = [
  "bg-danger/15 text-danger",
  "bg-blocked-accent/15 text-blocked-accent",
  "bg-surface-overlay text-t-muted",
];

/** Small P0–P2 mark, as on the cards; nothing for P3 and below. */
export function PriorityBadge({ priority, className }: { priority?: number; className?: string }) {
  if (priority === undefined || priority < 0 || priority >= PRIORITY_CLASSES.length) return null;
  return (
    <span className={cn("theme-badge text-[10px] font-medium px-1.5 py-0.5", PRIORITY_CLASSES[priority], className)}>
      P{priority}
    </span>
  );
}
