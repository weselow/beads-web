"use client";

import { useState, useCallback } from "react";

import {
  BrainCircuit,
  Pencil,
  Plus,
  Trash2,
  Search,
  MoreVertical,
  X,
  Loader2,
} from "lucide-react";

import { CreateMemoryDialog } from "@/components/create-memory-dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogClose,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useMemory } from "@/hooks/use-memory";
import type { MemoryEntry } from "@/types";

export interface MemoryPanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Absolute path to the project root */
  projectPath: string;
}

/**
 * Memory Panel - slide-out Sheet for browsing and managing bd memory entries
 */
export function MemoryPanel({ open, onOpenChange, projectPath }: MemoryPanelProps) {
  const {
    entries,
    isLoading,
    error,
    search,
    setSearch,
    filteredEntries,
    createEntry,
    editEntry,
    deleteEntry,
  } = useMemory(projectPath);

  // Create dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Edit dialog state
  const [editingEntry, setEditingEntry] = useState<MemoryEntry | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirmation state
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleEditOpen = useCallback((entry: MemoryEntry) => {
    setEditingEntry(entry);
    setEditContent(entry.content);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingEntry) return;
    setIsSaving(true);
    try {
      await editEntry(editingEntry.key, editContent);
      setEditingEntry(null);
    } catch {
      // Error is logged in hook
    } finally {
      setIsSaving(false);
    }
  }, [editingEntry, editContent, editEntry]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingKey) return;
    setIsDeleting(true);
    try {
      await deleteEntry(deletingKey);
      setDeletingKey(null);
    } catch {
      // Error is logged in hook
    } finally {
      setIsDeleting(false);
    }
  }, [deletingKey, deleteEntry]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg md:max-w-xl bg-surface-base border-b-default flex flex-col"
        >
          <SheetHeader className="space-y-1">
            <SheetTitle className="flex items-center gap-2 text-t-primary">
              <BrainCircuit className="size-5" aria-hidden="true" />
              Memory
            </SheetTitle>
            <SheetDescription className="text-t-muted">
              {isLoading ? "Loading..." : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
            </SheetDescription>
          </SheetHeader>

          {/* Search input */}
          <div className="relative mt-4">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-t-muted"
              aria-hidden="true"
            />
            <Input
              type="text"
              aria-label="Search memories"
              placeholder="Search memories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-8 h-8 bg-surface-overlay/50 border-b-strong text-t-primary placeholder:text-t-muted"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-0 top-1/2 -translate-y-1/2 size-11 flex items-center justify-center text-t-muted hover:text-t-secondary"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Add Memory button */}
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="mt-2 w-full flex items-center justify-center gap-1.5 h-8 rounded border border-b-strong bg-surface-overlay/50 text-sm text-t-secondary hover:text-t-primary hover:bg-surface-overlay transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add Memory
          </button>

          {/* Entries list */}
          <ScrollArea className="flex-1 mt-3 -mx-6 px-6">
            <div className="space-y-2 pb-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-5 text-t-muted animate-spin" aria-hidden="true" />
                  <span className="sr-only">Loading memory entries</span>
                </div>
              ) : error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-center"
                >
                  <p className="text-sm text-danger">Failed to load memory entries</p>
                  <p className="text-xs text-danger/60 mt-1">{error.message}</p>
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <BrainCircuit className="size-8 text-t-faint mb-3" aria-hidden="true" />
                  <p className="text-sm text-t-muted">
                    {search ? "No entries match your search" : "No memory entries yet"}
                  </p>
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="mt-2 text-xs text-t-muted hover:text-t-secondary underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                filteredEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="rounded-lg border border-b-default bg-surface-raised/50 p-3 space-y-1.5 overflow-hidden"
                  >
                    {/* Key badge + actions row */}
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs font-mono text-t-muted bg-surface-overlay px-1.5 py-0.5 rounded truncate max-w-[calc(100%-2rem)]">
                        {entry.key}
                      </code>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="size-6 flex items-center justify-center rounded text-t-muted hover:text-t-secondary hover:bg-surface-overlay transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
                            aria-label="Entry actions"
                          >
                            <MoreVertical className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-surface-raised border-b-default"
                        >
                          <DropdownMenuItem
                            onClick={() => handleEditOpen(entry)}
                            className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary gap-2"
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-surface-overlay" />
                          <DropdownMenuItem
                            onClick={() => setDeletingKey(entry.key)}
                            className="text-danger focus:bg-surface-overlay focus:text-danger gap-2"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Content */}
                    <p className="text-sm text-t-secondary line-clamp-3 text-pretty">
                      {entry.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Create Dialog */}
      <CreateMemoryDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={createEntry}
      />

      {/* Edit Dialog */}
      <AlertDialog
        open={!!editingEntry}
        onOpenChange={(isOpen) => !isOpen && setEditingEntry(null)}
      >
        <AlertDialogContent className="bg-surface-raised border-b-default">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-t-primary">
              Edit Memory Entry
            </AlertDialogTitle>
            <AlertDialogDescription className="text-t-muted">
              <code className="font-mono text-xs">{editingEntry?.key}</code>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <label
              htmlFor="edit-content"
              className="text-sm font-medium text-t-secondary"
            >
              Content
            </label>
            <textarea
              id="edit-content"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-32 rounded-md border border-b-strong bg-surface-overlay/50 px-3 py-2 text-sm text-t-primary placeholder:text-t-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button onClick={handleEditSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="size-4 animate-spin mr-1.5" aria-hidden="true" />
              ) : null}
              Save
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingKey}
        onOpenChange={(isOpen) => !isOpen && setDeletingKey(null)}
      >
        <AlertDialogContent className="bg-surface-raised border-b-default">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-t-primary">
              Delete Memory Entry
            </AlertDialogTitle>
            <AlertDialogDescription className="text-t-tertiary">
              This will permanently delete this memory entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="size-4 animate-spin mr-1.5" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4 mr-1.5" aria-hidden="true" />
              )}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
