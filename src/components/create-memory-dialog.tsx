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

interface CreateMemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (content: string, key?: string) => Promise<void>;
}

export function CreateMemoryDialog({
  open,
  onOpenChange,
  onCreate,
}: CreateMemoryDialogProps) {
  const [key, setKey] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setKey("");
    setContent("");
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetForm();
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm]
  );

  const handleSubmit = useCallback(async () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setError("Content is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onCreate(trimmedContent, key.trim() || undefined);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
    } finally {
      setIsSubmitting(false);
    }
  }, [content, key, onCreate, handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg bg-surface-raised border-b-default">
        <DialogHeader>
          <DialogTitle className="text-t-primary">Remember</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label htmlFor="memory-key" className="text-sm font-medium text-t-secondary">
              Key <span className="text-t-faint font-normal">(optional)</span>
            </label>
            <Input
              id="memory-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="(auto-generated if blank)"
              className="bg-surface-overlay/50 border-b-strong text-t-primary placeholder:text-t-muted font-mono text-sm"
            />
            <p className="text-xs text-t-faint">
              Use the same key later to update in place
            </p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="memory-content" className="text-sm font-medium text-t-secondary">
              Content
            </label>
            <textarea
              id="memory-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What should be remembered?"
              rows={5}
              autoFocus
              className="flex w-full rounded-md border border-b-strong bg-surface-overlay/50 px-3 py-2 text-sm text-t-primary placeholder:text-t-muted ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
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
            disabled={isSubmitting || !content.trim()}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
