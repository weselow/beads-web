"use client";

import { useCallback, useMemo } from "react";

import { toast } from "@/hooks/use-toast";
import * as api from "@/lib/api";
import { closeBead } from "@/lib/cli";

/** Types a story can become when it goes to work. */
export type PromoteType = "epic" | "feature" | "task";

export interface IdeaActions {
  /** Change the type, open it and drop any defer date — one update. */
  promote: (id: string, type: PromoteType) => Promise<boolean>;
  /** Defer until a local `YYYY-MM-DD` day. */
  defer: (id: string, date: string) => Promise<boolean>;
  /** Clear the defer date, back to the main list. */
  restore: (id: string) => Promise<boolean>;
  /** Close with an optional reason. Needs the project folder: bd runs there. */
  dismiss: (id: string, reason: string) => Promise<boolean>;
}

interface IdeaActionsOptions {
  /** Project path the beads API takes (a folder or dolt://). */
  projectPath: string;
  /** Project folder bd runs in; empty for a dolt-only project. */
  fsPath: string;
  /** Called after a change went through, to re-read the board. */
  onChanged: () => void;
}

/**
 * Writes behind the Ideas panel's buttons. A failure is logged and shown as a
 * toast; the result says whether the change went through.
 */
export function useIdeaActions({ projectPath, fsPath, onChanged }: IdeaActionsOptions): IdeaActions {
  const run = useCallback(
    async (action: string, id: string, work: () => Promise<unknown>) => {
      try {
        await work();
        onChanged();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("Idea action failed", { action, id, projectPath, message });
        toast({ variant: "destructive", title: `Failed to ${action} idea`, description: message });
        return false;
      }
    },
    [onChanged, projectPath]
  );

  return useMemo(() => {
    const update = (id: string, fields: { issue_type?: string; status?: string; defer?: string }) =>
      api.beads.update({ path: projectPath, id, ...fields });
    return {
      promote: (id, type) => run("promote", id, () => update(id, { issue_type: type, status: "open", defer: "" })),
      defer: (id, date) => run("defer", id, () => update(id, { defer: date })),
      restore: (id) => run("restore", id, () => update(id, { defer: "" })),
      dismiss: (id, reason) => run("dismiss", id, () => closeBead(id, fsPath, reason)),
    };
  }, [run, projectPath, fsPath]);
}
