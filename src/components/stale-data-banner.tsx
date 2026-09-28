"use client";

import { useState } from "react";

import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

import { formatShortDate } from "@/lib/bead-utils";
import type { StaleSource } from "@/lib/beads-parser";

export interface StaleDataBannerProps {
  stale: StaleSource;
}

/**
 * Warning above the kanban columns while the board shows an old copy from
 * issues.jsonl because bd failed. bd's own error text is collapsed by default.
 */
export function StaleDataBanner({ stale }: StaleDataBannerProps) {
  const [showReason, setShowReason] = useState(false);
  const copy = stale.modifiedAt
    ? `an old copy from ${formatShortDate(stale.modifiedAt)}`
    : "an old copy";

  return (
    <div
      role="status"
      className="rounded-md border border-blocked-accent/30 bg-blocked-accent/15 px-3 py-2 text-sm text-blocked-accent"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">
          Showing {copy} — bd can&apos;t open the database. Changes are disabled until it recovers.
        </span>
        <button
          type="button"
          onClick={() => setShowReason((prev) => !prev)}
          aria-expanded={showReason}
          className="flex items-center gap-1 rounded text-xs underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showReason
            ? <ChevronDown className="size-3.5" aria-hidden="true" />
            : <ChevronRight className="size-3.5" aria-hidden="true" />}
          {showReason ? "Hide reason" : "Show reason"}
        </button>
      </div>
      {showReason && (
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-t-secondary">
          {stale.reason}
        </pre>
      )}
    </div>
  );
}
