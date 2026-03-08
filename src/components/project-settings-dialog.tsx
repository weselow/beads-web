"use client";

import { useState, useEffect } from "react";

import { Folder, FolderSearch, Loader2 } from "lucide-react";

import { FolderBrowser } from "@/components/folder-browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { updateProject } from "@/lib/db";

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectLocalPath?: string;
  onUpdated: () => void;
}

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectPath,
  projectLocalPath,
  onUpdated,
}: ProjectSettingsDialogProps) {
  const [name, setName] = useState(projectName);
  const [path, setPath] = useState(projectPath);
  const [localPath, setLocalPath] = useState(projectLocalPath || "");
  const [browsing, setBrowsing] = useState<"path" | "localPath" | null>(null);
  const [browserPath, setBrowserPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const { toast } = useToast();

  const isDolt = projectPath.startsWith("dolt://");

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setName(projectName);
      setPath(projectPath);
      setLocalPath(projectLocalPath || "");
      setBrowsing(null);
      setPathError(null);
    }
  }, [open, projectName, projectPath, projectLocalPath]);

  const handleBrowseSelect = (selectedPath: string) => {
    if (browsing === "localPath") {
      setLocalPath(selectedPath);
    } else {
      setPath(selectedPath);
    }
    setBrowsing(null);
    setPathError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    const trimmedLocalPath = localPath.trim();

    if (!trimmedName) {
      toast({
        title: "Invalid name",
        description: "Project name cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    // Nothing changed
    const nameChanged = trimmedName !== projectName;
    const pathChanged = !isDolt && trimmedPath !== projectPath;
    const localPathChanged = trimmedLocalPath !== (projectLocalPath || "");

    if (!nameChanged && !pathChanged && !localPathChanged) {
      onOpenChange(false);
      return;
    }

    setIsSubmitting(true);

    try {
      await updateProject({
        id: projectId,
        ...(nameChanged && { name: trimmedName }),
        ...(pathChanged && { path: trimmedPath }),
        ...(localPathChanged && { localPath: trimmedLocalPath || undefined }),
      });

      toast({
        title: "Project updated",
        description: "Settings saved successfully.",
      });

      onOpenChange(false);
      onUpdated();
    } catch (err) {
      console.error("Error updating project:", err);
      toast({
        title: "Error",
        description: "Failed to update project settings.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderPathField = (
    label: string,
    id: string,
    value: string,
    onChange: (v: string) => void,
    browsingKey: "path" | "localPath",
    placeholder: string,
    hint?: string,
  ) => (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-t-secondary">
        {label}
      </label>
      {browsing === browsingKey ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-t-muted">Browse Folders</span>
            <button
              type="button"
              onClick={() => setBrowsing(null)}
              className="text-xs text-t-muted hover:text-t-secondary transition-colors"
            >
              Type path instead
            </button>
          </div>
          <FolderBrowser
            currentPath={browserPath}
            onPathChange={setBrowserPath}
            onSelectPath={(p) => handleBrowseSelect(p)}
          />
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Folder className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-t-muted" aria-hidden="true" />
              <Input
                id={id}
                value={value}
                onChange={(e) => {
                  onChange(e.target.value);
                  setPathError(null);
                }}
                placeholder={placeholder}
                className="pl-10"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => {
                setBrowserPath(value || "");
                setBrowsing(browsingKey);
              }}
              title="Browse folders"
            >
              <FolderSearch className="size-4" />
            </Button>
          </div>
          {pathError && browsingKey === "path" && (
            <p className="text-sm text-danger">{pathError}</p>
          )}
          {hint && <p className="text-xs text-t-muted">{hint}</p>}
        </>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={browsing ? "sm:max-w-lg" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            Update project name and folder path.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <label htmlFor="settings-name" className="text-sm font-medium text-t-secondary">
                Project Name
              </label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                autoFocus
              />
            </div>

            {/* Dolt source (read-only) */}
            {isDolt && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-t-secondary">Dolt Source</label>
                <p className="truncate rounded-md bg-surface-overlay px-3 py-2 text-sm text-t-tertiary">
                  {projectPath}
                </p>
              </div>
            )}

            {/* Path for filesystem projects */}
            {!isDolt && renderPathField(
              "Project Path",
              "settings-path",
              path,
              setPath,
              "path",
              "/path/to/your/project",
            )}

            {/* Local folder for dolt projects */}
            {isDolt && renderPathField(
              "Local Folder",
              "settings-local-path",
              localPath,
              setLocalPath,
              "localPath",
              "/path/to/your/project",
              !localPath ? "Set a folder path to enable Memory, Agents, and bd CLI." : undefined,
            )}
          </div>

          {!browsing && (
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting || !name.trim()}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
