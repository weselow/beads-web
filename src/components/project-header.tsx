"use client";

import { ArrowLeft, EllipsisVertical } from "lucide-react";

import { JournalSwitch } from "@/components/journal-switch";
import { Button } from "@/components/ui/button";
import { isBlocked } from "@/lib/bead-utils";
import type { HeaderVariant } from "@/lib/themes";
import type { Bead, StatusInfo } from "@/types";

export interface ProjectHeaderProps {
  variant: HeaderVariant;
  projectName: string;
  projectPath: string;
  /** `source` of the last /api/beads answer, for the journal switch */
  beadsSource: string | null | undefined;
  onJournalChanged: () => void;
  onOpenSettings: () => void;
  beads: Bead[];
  statuses: readonly StatusInfo[];
}

/** Terminal header of the neo-brutalist theme: name plus a line of counts */
function TerminalHeader({ projectName, projectPath, beadsSource, onJournalChanged, beads, statuses }: ProjectHeaderProps) {
  const epics = beads.filter((b) => b.issue_type === "epic").length;
  const blocked = beads.filter((b) => isBlocked(b, beads, statuses)).length;
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 terminal-header">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="min-w-0 font-mono text-xl font-bold tracking-wide truncate">
          <a href="/" className="hover:opacity-80">&gt;</a>{" "}
          <span className="uppercase">{projectName}_</span>
        </h1>
        <JournalSwitch projectPath={projectPath} source={beadsSource} onChanged={onJournalChanged} className="font-mono uppercase" />
      </div>
      <span className="shrink-0 font-mono text-xs text-t-muted uppercase tracking-widest">
        {beads.length} beads // {epics} epics // {blocked} blocked
      </span>
    </div>
  );
}

/** Standard header: back link, name, journal switch and project settings */
function StandardHeader({ projectName, projectPath, beadsSource, onJournalChanged, onOpenSettings }: ProjectHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <Button variant="ghost" size="icon" className="shrink-0" asChild>
        <a href="/">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back to projects</span>
        </a>
      </Button>
      <h1 className="min-w-0 text-lg font-semibold truncate">{projectName}</h1>
      <JournalSwitch projectPath={projectPath} source={beadsSource} onChanged={onJournalChanged} />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Project settings"
        onClick={onOpenSettings}
      >
        <EllipsisVertical className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** The project page header, drawn the way the theme asks */
export function ProjectHeader(props: ProjectHeaderProps) {
  return props.variant === "terminal" ? <TerminalHeader {...props} /> : <StandardHeader {...props} />;
}
