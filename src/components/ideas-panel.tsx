"use client";

import { useState } from "react";

import { ChevronRight, Lightbulb } from "lucide-react";

import { IdeaCapture } from "@/components/idea-capture";
import { IdeaRow } from "@/components/idea-row";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIdeaActions } from "@/hooks/use-idea-actions";
import type { IdeaActions } from "@/hooks/use-idea-actions";
import { splitIdeas } from "@/lib/ideas";
import { cn } from "@/lib/utils";
import type { Bead, StatusInfo } from "@/types";

export interface IdeasPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every bead of the project; the panel picks the stories. */
  beads: readonly Bead[];
  /** The project's statuses, to leave out done stories. */
  statuses: readonly StatusInfo[];
  /** Project path the beads API takes (a folder or dolt://). */
  projectPath: string;
  /** Project folder bd runs in; empty for a dolt-only project. */
  fsPath: string;
  /** Dolt-only project: no folder, so Dismiss (bd close) is off. */
  isDoltOnly: boolean;
  /** Board shows an old copy: capture and actions are off. */
  readOnly: boolean;
  /** Open the bead's detail panel. */
  onOpenBead: (bead: Bead) => void;
  /** Re-read the board after a change. */
  onChanged: () => void;
}

interface ListProps {
  now: Date;
  actions: IdeaActions;
  readOnly: boolean;
  canDismiss: boolean;
  onOpen: (bead: Bead) => void;
}

function IdeaList({ beads, deferred, ...rest }: ListProps & { beads: Bead[]; deferred: boolean }) {
  return (
    <ul className="space-y-2">
      {beads.map((bead) => (
        <IdeaRow key={bead.id} bead={bead} deferred={deferred} {...rest} />
      ))}
    </ul>
  );
}

/** Deferred ideas, folded away until asked for. */
function DeferredSection({ beads, ...rest }: ListProps & { beads: Bead[] }) {
  const [expanded, setExpanded] = useState(false);
  if (beads.length === 0) return null;
  return (
    <section className="mt-4">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-sm font-medium text-t-tertiary hover:text-t-secondary rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} aria-hidden="true" />
        Deferred ({beads.length})
      </button>
      {expanded && (
        <div className="mt-2">
          <IdeaList beads={beads} deferred {...rest} />
        </div>
      )}
    </section>
  );
}

function IdeasHeader({ active, deferred }: { active: number; deferred: number }) {
  return (
    <SheetHeader className="space-y-1">
      <SheetTitle className="flex items-center gap-2 text-t-primary">
        <Lightbulb className="size-5" aria-hidden="true" />
        Ideas
      </SheetTitle>
      <SheetDescription className="text-t-muted">
        {active} {active === 1 ? "idea" : "ideas"}
        {deferred > 0 && `, ${deferred} deferred`}
      </SheetDescription>
    </SheetHeader>
  );
}

function EmptyIdeas() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Lightbulb className="size-8 text-t-faint mb-3" aria-hidden="true" />
      <p className="text-sm text-t-muted">No ideas yet</p>
      <p className="text-xs text-t-faint mt-1">Write one above — it is saved as a story, off the board.</p>
    </div>
  );
}

/**
 * Ideas panel: stories kept next to the board, not on it. Capture a thought in
 * one line, then promote it to work, defer it, or dismiss it.
 */
export function IdeasPanel(props: IdeasPanelProps) {
  const { open, onOpenChange, beads, statuses, projectPath, fsPath, isDoltOnly, readOnly, onOpenBead, onChanged } = props;
  const actions = useIdeaActions({ projectPath, fsPath, onChanged });
  // Recomputed on every render: a pass over the beads is cheap, and an idea
  // whose defer date has passed returns to the main list on the next render.
  const now = new Date();
  const { active, deferred } = splitIdeas(beads, statuses, now);
  const listProps: ListProps = { now, actions, readOnly, canDismiss: !isDoltOnly && !!fsPath, onOpen: onOpenBead };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg md:max-w-xl bg-surface-base border-b-default flex flex-col">
        <IdeasHeader active={active.length} deferred={deferred.length} />
        <IdeaCapture projectPath={projectPath} readOnly={readOnly} onCreated={onChanged} />

        <ScrollArea className="flex-1 mt-3 -mx-6 px-6">
          <div className="pb-4">
            {active.length === 0 && deferred.length === 0 ? (
              <EmptyIdeas />
            ) : (
              <IdeaList beads={active} deferred={false} {...listProps} />
            )}
            <DeferredSection beads={deferred} {...listProps} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
