"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { journal, type JournalState } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Read sources that go through bd — the only ones the journal affects. */
const BD_SOURCES = new Set(["cli", "cli-journal"]);
/** Read sources that query the Dolt SQL server directly, bypassing bd. */
const SQL_SOURCES = new Set(["dolt-direct", "dolt-project", "dolt-central"]);

const DIRECT_SQL_HINT =
  "Read straight from the Dolt SQL server; the bd events journal is not used for this project.";

const AFFECTS_ALL = "Affects every bd command in this project, agents included.";
const FORCED =
  "Set by the BD_EVENTS_JOURNAL environment variable of the beads-web server; change it there.";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Tooltip text: the current state, what it means, and who it affects. */
export function journalHint(state: JournalState | null, loadError: string | null): string {
  if (loadError) return `bd events journal: state unknown (${loadError})`;
  if (!state) return "bd events journal: checking…";
  const meaning = state.enabled
    ? "on — changes are read from the journal (fast polling)"
    : "off — every poll re-reads all tasks through bd";
  const parts = [`bd events journal: ${meaning}.`, AFFECTS_ALL];
  if (state.forced_by_env) parts.push(FORCED);
  return parts.join(" ");
}

/** Reads the journal state, and switches it on request. */
function useJournalState(projectPath: string, onChanged?: () => void) {
  const [state, setState] = useState<JournalState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    setState(null);
    setLoadError(null);
    journal
      .get(projectPath)
      .then((s) => { if (!cancelled) setState(s); })
      .catch((err) => { if (!cancelled) setLoadError(errorText(err)); });
    return () => { cancelled = true; };
  }, [projectPath]);

  const toggle = useCallback(async (enabled: boolean) => {
    setSaving(true);
    try {
      setState(await journal.set(projectPath, enabled));
      onChanged?.();
    } catch (err) {
      toast({
        title: "Could not switch the events journal",
        description: errorText(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [projectPath, onChanged, toast]);

  return { state, loadError, saving, toggle };
}

interface JournalSwitchProps {
  /** Project path as /api/beads gets it. */
  projectPath: string;
  /** `source` of the last /api/beads answer; null before the first one. */
  source: string | null | undefined;
  /** Called after the journal was switched, to re-read the board. */
  onChanged?: () => void;
  className?: string;
}

/** Pale label shown in place of the switch when the project is read over SQL. */
function DirectSqlLabel({ className }: { className?: string }) {
  const hintId = useId();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-describedby={hintId}
            className={cn("shrink-0 text-xs text-t-muted", className)}
          >
            Direct SQL
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{DIRECT_SQL_HINT}</TooltipContent>
      </Tooltip>
      <span id={hintId} className="sr-only">{DIRECT_SQL_HINT}</span>
    </TooltipProvider>
  );
}

/**
 * Header slot for the bd events journal: the switch for projects read through
 * bd, a "Direct SQL" label for projects read from the Dolt SQL server, and
 * nothing for issues.jsonl or before the first read.
 */
export function JournalSwitch({ source, className, ...rest }: JournalSwitchProps) {
  if (!source) return null;
  if (SQL_SOURCES.has(source)) return <DirectSqlLabel className={className} />;
  if (BD_SOURCES.has(source)) return <BdJournalSwitch {...rest} className={className} />;
  return null;
}

/** The switch itself; mounted only for projects read through bd. */
function BdJournalSwitch({ projectPath, onChanged, className }: Omit<JournalSwitchProps, "source">) {
  const { state, loadError, saving, toggle } = useJournalState(projectPath, onChanged);
  const hintId = useId();
  const on = state?.enabled ?? false;
  const disabled = !state || state.forced_by_env || saving;
  const hint = journalHint(state, loadError);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs text-t-muted", className)}>
            <ToggleSwitch
              checked={on}
              onCheckedChange={(next) => void toggle(next)}
              aria-label="Events journal"
              aria-describedby={hintId}
              disabled={disabled}
            />
            <span aria-hidden="true">Journal</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{hint}</TooltipContent>
      </Tooltip>
      <span id={hintId} className="sr-only">{hint}</span>
    </TooltipProvider>
  );
}
