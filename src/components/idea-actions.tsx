"use client";

import { useState } from "react";

import { Undo2, X } from "lucide-react";

import { DeferDateForm, DismissForm } from "@/components/idea-action-forms";
import { ActionButton, DeferMenu, PromoteMenu } from "@/components/idea-action-menus";
import type { IdeaActions as Actions, PromoteType } from "@/hooks/use-idea-actions";
import { deferDate } from "@/lib/ideas";
import type { DeferPreset } from "@/lib/ideas";
import { READ_ONLY_HINT } from "@/lib/read-only";

const NO_FOLDER_HINT = "Requires project folder path";

interface IdeaActionsProps {
  id: string;
  /** The idea sits in the Deferred block: Restore replaces Defer. */
  deferred: boolean;
  actions: Actions;
  /** Board shows an old copy: every action is off. */
  readOnly: boolean;
  /** Dismiss runs bd in the project folder; a dolt-only project has none. */
  canDismiss: boolean;
}

/** Promote / Defer (or Restore) / Dismiss under one idea, with their inline forms. */
export function IdeaActions({ id, deferred, actions, readOnly, canDismiss }: IdeaActionsProps) {
  const [form, setForm] = useState<"date" | "dismiss" | null>(null);
  const [busy, setBusy] = useState(false);
  // The form closes only when the write went through; on failure it stays for another try.
  const act = async (work: () => Promise<boolean>) => {
    setBusy(true);
    const done = await work();
    setBusy(false);
    if (done) setForm(null);
  };
  const handlers: ActionHandlers = {
    restore: () => void act(() => actions.restore(id)),
    promote: (type) => void act(() => actions.promote(id, type)),
    defer: (preset) => void act(() => actions.defer(id, deferDate(preset, new Date()))),
    pickDate: () => setForm("date"),
    dismiss: () => setForm("dismiss"),
  };
  const close = () => setForm(null);
  return (
    <div>
      <ActionBar deferred={deferred} busy={busy} readOnly={readOnly} canDismiss={canDismiss} handlers={handlers} />
      {form === "date" && <DeferDateForm busy={busy} onCancel={close} onSubmit={(date) => act(() => actions.defer(id, date))} />}
      {form === "dismiss" && (
        <DismissForm busy={busy} onCancel={close} onSubmit={(reason) => act(() => actions.dismiss(id, reason))} />
      )}
    </div>
  );
}

interface ActionHandlers {
  restore: () => void;
  promote: (type: PromoteType) => void;
  defer: (preset: DeferPreset) => void;
  pickDate: () => void;
  dismiss: () => void;
}

interface ActionBarProps {
  deferred: boolean;
  busy: boolean;
  readOnly: boolean;
  canDismiss: boolean;
  handlers: ActionHandlers;
}

/** The row of buttons; each says why when it is off. */
function ActionBar({ deferred, busy, readOnly, canDismiss, handlers }: ActionBarProps) {
  const off = readOnly || busy;
  const hint = readOnly ? READ_ONLY_HINT : undefined;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {deferred && (
        <ActionButton disabled={off} title={hint} onClick={handlers.restore}>
          <Undo2 className="size-3.5" aria-hidden="true" />
          Restore
        </ActionButton>
      )}
      <PromoteMenu disabled={off} title={hint} onPick={handlers.promote} />
      {!deferred && <DeferMenu disabled={off} title={hint} onPreset={handlers.defer} onPickDate={handlers.pickDate} />}
      <ActionButton
        disabled={off || !canDismiss}
        title={hint ?? (canDismiss ? undefined : NO_FOLDER_HINT)}
        onClick={handlers.dismiss}
        className="hover:text-danger"
      >
        <X className="size-3.5" aria-hidden="true" />
        Dismiss
      </ActionButton>
    </div>
  );
}
