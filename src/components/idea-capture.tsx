"use client";

import { useState } from "react";
import type { KeyboardEvent } from "react";

import { Loader2, Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import * as api from "@/lib/api";
import { READ_ONLY_HINT } from "@/lib/read-only";

interface IdeaCaptureProps {
  /** Project path the beads API takes (a folder or dolt://). */
  projectPath: string;
  /** Board shows an old copy: nothing can be written. */
  readOnly: boolean;
  /** Called after the story is created, to re-read the board. */
  onCreated: () => void;
}

/**
 * One-line capture at the top of the Ideas panel: type a thought, press Enter,
 * and it becomes a story. The description can be written later. While saving
 * the field is locked, not disabled, so focus stays for the next idea.
 */
export function IdeaCapture({ projectPath, readOnly, onCreated }: IdeaCaptureProps) {
  const { title, setTitle, isSaving, error, handleKeyDown } = useIdeaCapture(projectPath, onCreated);
  return (
    <div className="mt-4 space-y-1.5">
      <div className="relative">
        <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-t-muted" aria-hidden="true" />
        <Input
          type="text"
          aria-label="New idea"
          // Focused on mount, before the panel would put focus on its close button.
          autoFocus
          placeholder="Write an idea and press Enter…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={readOnly}
          readOnly={isSaving}
          title={readOnly ? READ_ONLY_HINT : undefined}
          className="pl-8 pr-8 h-9 bg-surface-overlay/50 border-b-strong text-t-primary placeholder:text-t-muted disabled:cursor-not-allowed"
        />
        {isSaving && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-t-muted animate-spin" aria-hidden="true" />
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          Could not save the idea: {error}
        </p>
      )}
    </div>
  );
}

/** Create a story; returns the error message, or null when it went through. */
async function createStory(projectPath: string, title: string): Promise<string | null> {
  try {
    await api.beads.create({ path: projectPath, title, issue_type: "story" });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to create idea", { projectPath, message });
    return message;
  }
}

/** Text of the capture field and the create call behind Enter; a failure keeps the text. */
function useIdeaCapture(projectPath: string, onCreated: () => void) {
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (text: string) => {
    setIsSaving(true);
    const failure = await createStory(projectPath, text);
    setIsSaving(false);
    setError(failure);
    if (failure !== null) return;
    setTitle("");
    onCreated();
  };

  // Enter saves; not while an input method is still composing a character.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const text = title.trim();
    if (text && !isSaving) void save(text);
  };

  return { title, setTitle, isSaving, error, handleKeyDown };
}
