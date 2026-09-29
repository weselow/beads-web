"use client";

import { formatDistanceToNow } from "date-fns";
import { Hourglass, MessageSquare } from "lucide-react";

import { IdeaActions } from "@/components/idea-actions";
import type { IdeaActions as Actions } from "@/hooks/use-idea-actions";
import { formatShortDate, truncate } from "@/lib/bead-utils";
import { STALE_IDEA_DAYS, isStaleIdea } from "@/lib/ideas";
import type { Bead } from "@/types";

interface IdeaRowProps {
  bead: Bead;
  /** The idea sits in the Deferred block. */
  deferred: boolean;
  now: Date;
  actions: Actions;
  readOnly: boolean;
  onOpen: (bead: Bead) => void;
}

function ageOf(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return "";
  return created > now ? "just now" : formatDistanceToNow(created, { addSuffix: true });
}

/** Age, comment count and, for a deferred idea, the day it comes back. */
function IdeaMeta({ bead, deferred, now }: Pick<IdeaRowProps, "bead" | "deferred" | "now">) {
  const comments = bead.comments?.length ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-t-muted">
      <span>{ageOf(bead.created_at, now)}</span>
      {comments > 0 && (
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" aria-hidden="true" />
          {comments} {comments === 1 ? "comment" : "comments"}
        </span>
      )}
      {deferred && bead.defer_until && <span>Back {formatShortDate(bead.defer_until)}</span>}
    </div>
  );
}

function StaleMark() {
  return (
    <span
      title={`Waiting for more than ${STALE_IDEA_DAYS} days`}
      className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-t-muted bg-surface-overlay"
    >
      <Hourglass className="size-3" aria-hidden="true" />
      Stale
    </span>
  );
}

/** One idea: title that opens the bead, a few facts, the start of the description, actions. */
export function IdeaRow({ bead, deferred, now, actions, readOnly, onOpen }: IdeaRowProps) {
  const stale = isStaleIdea(bead, now);
  return (
    <li className="rounded-lg border border-b-default bg-surface-raised/50 p-3 space-y-1.5 overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen(bead)}
          className="text-left text-sm font-medium text-t-primary hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {bead.title}
        </button>
        {stale && <StaleMark />}
      </div>
      <IdeaMeta bead={bead} deferred={deferred} now={now} />
      {bead.description && (
        <p className="text-xs text-t-tertiary line-clamp-2 whitespace-pre-line">{truncate(bead.description, 240)}</p>
      )}
      <div className="pt-1">
        <IdeaActions id={bead.id} deferred={deferred} actions={actions} readOnly={readOnly} />
      </div>
    </li>
  );
}
