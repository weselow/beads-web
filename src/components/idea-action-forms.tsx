"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { addDays } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDateString } from "@/lib/ideas";

interface ActionFormProps {
  /** A write is in flight: the buttons wait. */
  busy: boolean;
  onCancel: () => void;
}

const INPUT_CLASS = "h-8 bg-surface-overlay/50 border-b-strong text-t-primary placeholder:text-t-muted";

interface InlineFormProps extends ActionFormProps {
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  /** Red submit button, for a closing action. */
  danger?: boolean;
  children: ReactNode;
}

/** Frame shared by the inline forms under an idea: fields, then submit and Cancel. */
function InlineForm(props: InlineFormProps) {
  const { busy, onCancel, onSubmit, submitLabel, submitDisabled = false, danger = false, children } = props;
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && !submitDisabled) onSubmit();
  };
  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-wrap items-center gap-2">
      {children}
      <Button
        type="submit"
        size="sm"
        disabled={busy || submitDisabled}
        className={danger ? "h-8 bg-danger text-white hover:bg-danger/85" : "h-8"}
      >
        {submitLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** Pick the day a deferred idea comes back; from tomorrow on. */
export function DeferDateForm({ busy, onCancel, onSubmit }: ActionFormProps & { onSubmit: (date: string) => void }) {
  const [date, setDate] = useState("");
  return (
    <InlineForm
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => onSubmit(date)}
      submitLabel="Defer idea"
      submitDisabled={!date}
    >
      <Input
        type="date"
        aria-label="Defer until"
        value={date}
        min={localDateString(addDays(new Date(), 1))}
        onChange={(e) => setDate(e.target.value)}
        className={`${INPUT_CLASS} w-auto`}
        autoFocus
      />
    </InlineForm>
  );
}

/** Close the idea; the reason is optional and kept by bd as close_reason. */
export function DismissForm({ busy, onCancel, onSubmit }: ActionFormProps & { onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <InlineForm busy={busy} onCancel={onCancel} onSubmit={() => onSubmit(reason.trim())} submitLabel="Dismiss idea" danger>
      <Input
        type="text"
        aria-label="Reason (optional)"
        placeholder="Why not? (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={`${INPUT_CLASS} flex-1 min-w-[12rem]`}
        autoFocus
      />
    </InlineForm>
  );
}
