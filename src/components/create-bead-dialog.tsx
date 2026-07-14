"use client";

import { useState, useCallback } from "react";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as api from "@/lib/api";
import { ISSUE_TYPES } from "@/lib/issue-types";
import { cn } from "@/lib/utils";

const PRIORITIES = [
  { value: "0", label: "P0 — Critical" },
  { value: "1", label: "P1 — High" },
  { value: "2", label: "P2 — Medium" },
  { value: "3", label: "P3 — Low" },
  { value: "4", label: "P4 — Backlog" },
];

interface CreateBeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  onCreated: () => void;
  /** Parent bead ID — when set, creates a subtask */
  parentId?: string;
}

export function CreateBeadDialog({
  open,
  onOpenChange,
  projectPath,
  onCreated,
  parentId,
}: CreateBeadDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("task");
  const [priority, setPriority] = useState("2");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setIssueType("task");
    setPriority("2");
    setError(null);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  }, [onOpenChange, resetForm]);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await api.beads.create({
        path: projectPath,
        title: trimmed,
        description: description.trim() || undefined,
        issue_type: parentId ? "task" : issueType,
        priority: parseInt(priority, 10),
        parent_id: parentId,
      });

      handleOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bead");
    } finally {
      setIsSubmitting(false);
    }
  }, [title, description, issueType, priority, projectPath, parentId, handleOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl w-[90vw] bg-surface-raised border-b-default">
        <DialogHeader>
          <DialogTitle className="text-t-primary">{parentId ? "New Subtask" : "New Bead"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Title */}
          <div className="grid gap-1.5">
            <label htmlFor="bead-title" className="text-sm font-medium text-t-secondary">
              Title
            </label>
            <Input
              id="bead-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="bg-surface-overlay/50 border-b-strong text-t-primary placeholder:text-t-muted"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isSubmitting) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <label htmlFor="bead-desc" className="text-sm font-medium text-t-secondary">
              Description
            </label>
            <textarea
              id="bead-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              rows={8}
              className="flex w-full rounded-md border border-b-strong bg-surface-overlay/50 px-3 py-2 text-sm text-t-primary placeholder:text-t-muted ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
            />
          </div>

          {/* Type and Priority row */}
          <div className={parentId ? "" : "grid grid-cols-2 gap-3"}>
            {!parentId && (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-t-secondary">Type</label>
                <Select value={issueType} onValueChange={setIssueType}>
                  <SelectTrigger className="bg-surface-overlay/50 border-b-strong text-t-primary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-surface-raised border-b-default">
                    {ISSUE_TYPES.map((t) => {
                      const Icon = t.icon;
                      return (
                        <SelectItem key={t.value} value={t.value} className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary">
                          <span className="flex items-center gap-2">
                            <Icon className={cn("size-3.5 shrink-0", t.colorClass)} aria-hidden="true" />
                            {t.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-t-secondary">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="bg-surface-overlay/50 border-b-strong text-t-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface-raised border-b-default">
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
            className="text-t-secondary"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim()}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
