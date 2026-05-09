"use client";

import { AlertCircle, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface DependencyBadgeProps {
  /** Bead IDs that this task depends on (blockers) */
  deps?: string[];
  /** Bead IDs that depend on this task (this task blocks them) */
  blockers?: string[];
  /**
   * Whether this task is currently blocked by unresolved dependencies.
   * The parent decides this — typically by calling `isBlocked(bead, allBeads)`
   * from `@/lib/bead-utils` so that closed deps don't count as blocking.
   *
   * If omitted, the badge falls back to the legacy heuristic
   * (`deps.length > 0`) which over-reports blocked status. New call sites
   * should always pass this prop explicitly.
   */
  isBlocked?: boolean;
  /** Callback when clicking on a dependency to navigate */
  onNavigate?: (beadId: string) => void;
}

/**
 * Shows blocked/blocking status with tooltip
 * Red badge if this task is blocked (has unresolved deps)
 * Orange badge if this task blocks others
 */
export function DependencyBadge({ deps, blockers, isBlocked: isBlockedProp, onNavigate }: DependencyBadgeProps) {
  // Handle null values from data (default params only work for undefined)
  const safeDeps = deps ?? [];
  const safeBlockers = blockers ?? [];
  // Parent decides blocked state when isBlocked prop is provided.
  // Fallback to legacy heuristic only when the prop is omitted (backwards-compat).
  const isBlocked = isBlockedProp ?? safeDeps.length > 0;
  const isBlocking = safeBlockers.length > 0;

  if (!isBlocked && !isBlocking) {
    return null;
  }

  // Show blocked status with priority
  if (isBlocked) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="destructive"
              className="text-[10px] px-1.5 py-0 cursor-help"
            >
              <Lock className="h-3 w-3 mr-0.5" aria-hidden="true" />
              BLOCKED
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold">Blocked by:</p>
              {safeDeps.map((depId) => (
                <button
                  key={depId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.(depId);
                  }}
                  aria-label={`Navigate to blocker ${depId}`}
                  className="block text-left hover:underline w-full"
                >
                  {depId}
                </button>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Show blocking status
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className={cn(
              "text-[10px] px-1.5 py-0 cursor-help",
              "bg-blocked-accent text-white hover:bg-blocked-accent/80 border-transparent"
            )}
          >
            <AlertCircle className="h-3 w-3 mr-0.5" aria-hidden="true" />
            BLOCKING
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">Blocking:</p>
            {safeBlockers.map((blockerId) => (
              <button
                key={blockerId}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate?.(blockerId);
                }}
                aria-label={`Navigate to blocked task ${blockerId}`}
                className="block text-left hover:underline w-full"
              >
                {blockerId}
              </button>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
