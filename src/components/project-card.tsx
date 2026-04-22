"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { AlertTriangle, Archive, ArchiveRestore, Code, FolderOpen, Loader2, Settings } from "lucide-react";

import { ProjectSettingsDialog } from "@/components/project-settings-dialog";
import { StatusDonut } from "@/components/status-donut";
import { TagPicker } from "@/components/tag-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoiuiCard } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import * as api from "@/lib/api";
import type { Tag } from "@/lib/db";
import { deriveBeadPrefix } from "@/lib/utils";
import type { BeadCounts } from "@/types";

/**
 * Converts kebab-case, snake_case, camelCase to Title Case with spaces
 */
function formatProjectName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')  // Replace hyphens and underscores with spaces
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // Add space before capitals in camelCase
    .replace(/\b\w/g, c => c.toUpperCase());  // Capitalize first letter of each word
}

/**
 * Returns the OS-appropriate file manager name
 */
function getFileManagerName(): string {
  if (typeof navigator === "undefined") return "File Manager";
  const platform = navigator.platform?.toLowerCase() ?? "";
  if (platform.startsWith("win")) return "Explorer";
  if (platform.startsWith("mac")) return "Finder";
  return "Files";
}

interface ProjectCardProps {
  id: string;
  name: string;
  path: string;
  localPath?: string;
  tags: Tag[];
  beadCounts?: BeadCounts;
  /**
   * True once `beadCounts` reflects either cached or freshly-fetched
   * data. When false, the card renders a dashed placeholder donut so
   * the user never sees misleading zeros on first paint.
   */
  countsLoaded?: boolean;
  dataSource?: string;
  beadError?: string;
  archivedAt?: string;
  onTagsChange?: (tags: Tag[]) => void;
  onUpdated?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
}

export function ProjectCard({
  id,
  name,
  path,
  localPath,
  tags,
  beadCounts = { open: 0, in_progress: 0, inreview: 0, closed: 0 },
  countsLoaded = true,
  dataSource,
  beadError,
  archivedAt,
  onTagsChange,
  onUpdated,
  onArchive,
  onUnarchive,
  onDelete,
}: ProjectCardProps) {
  const router = useRouter();
  const [isOpening, setIsOpening] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { toast } = useToast();

  // For dolt projects, use localPath for filesystem operations; for regular projects use path
  const isDolt = path.startsWith("dolt://");
  const fsPath = isDolt ? localPath : path;

  const handleOpenExternal = async (target: 'vscode' | 'cursor' | 'finder', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fsPath) return;
    setIsOpening(target);

    try {
      await api.fs.openExternal(fsPath, target);
      toast({
        title: "Opening project",
        description: target === 'finder'
          ? `Opening in ${getFileManagerName()}...`
          : `Opening in ${target === 'vscode' ? 'VS Code' : 'Cursor'}...`,
      });
    } catch (err) {
      console.error("Error opening project:", err);
      toast({
        title: "Failed to open",
        description: err instanceof Error ? err.message : "Could not open the project. Make sure the application is installed.",
        variant: "destructive",
      });
    } finally {
      setIsOpening(null);
    }
  };

  const handleCardClick = () => {
    router.push(`/project?id=${id}`);
  };

  return (
    <>
    <RoiuiCard
      className={`cursor-pointer flex flex-col min-h-[155px]${archivedAt ? ' opacity-50' : ''}`}
      onClick={handleCardClick}
      role="link"
      tabIndex={0}
      aria-label={`View ${formatProjectName(name)} project`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      {/* Top row: Donut left, Tags right */}
      <div className="flex items-start justify-between">
        {beadError ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-warning" style={{ width: 36, height: 36 }}>
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">{beadError}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <StatusDonut beadCounts={beadCounts} size={36} countsLoaded={countsLoaded} />
        )}
        <div
          className="flex flex-wrap items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              size="sm"
              style={{
                backgroundColor: `${tag.color}20`,
                color: tag.color,
                borderColor: tag.color,
              }}
            >
              {tag.name}
            </Badge>
          ))}
          {onTagsChange && (
            <TagPicker
              projectId={id}
              projectTags={tags}
              onTagsChange={onTagsChange}
            />
          )}
        </div>
      </div>

      {/* Middle: Title (grows to fill space) */}
      <div className="flex-1 flex items-center">
        <h3 className="text-xl font-medium text-balance font-project-name">
          {formatProjectName(name)}
        </h3>
      </div>

      {/* Bottom row: Path left, actions right */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <p className="text-sm text-t-muted truncate min-w-0" title={path}>
            {path}
          </p>
          {archivedAt && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] font-medium text-t-muted">
              <Archive className="h-3 w-3" aria-hidden="true" />
              Archived
            </span>
          )}
          {!archivedAt && dataSource === 'jsonl' && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    role="note"
                    tabIndex={0}
                    aria-label={`Old beads format — migrate with bd init --prefix ${deriveBeadPrefix(path, name)}`}
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    Old format — migrate
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="space-y-1">
                    <p className="text-xs">
                      This project uses the old JSONL beads format. Run this in the project directory to migrate to Dolt:
                    </p>
                    <code className="block rounded bg-black/30 px-1.5 py-1 font-mono text-[11px]">
                      bd init --prefix {deriveBeadPrefix(path, name)}
                    </code>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!archivedAt && dataSource && dataSource !== 'jsonl' && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] font-medium text-t-muted">
              {dataSource === 'dolt-project' ? 'Dolt (project)' :
               dataSource === 'dolt-central' ? 'Dolt (central)' :
               dataSource === 'dolt-direct' ? 'Dolt (direct)' :
               dataSource === 'cli' ? 'CLI' : dataSource}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {archivedAt ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onUnarchive?.(); }}
              aria-label="Restore project"
            >
              <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
              Restore
            </Button>
          ) : (
            <>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      mode="icon"
                      className="shrink-0"
                      aria-label="Project settings"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettingsOpen(true);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Project settings</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {fsPath && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <DropdownMenu>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          mode="icon"
                          className="shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          aria-label="Open in external application"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Open in editor or file manager</p>
                    </TooltipContent>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => handleOpenExternal('vscode', e)}
                        disabled={isOpening !== null}
                      >
                        {isOpening === 'vscode' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Code className="h-4 w-4" aria-hidden="true" />
                        )}
                        VS Code
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => handleOpenExternal('cursor', e)}
                        disabled={isOpening !== null}
                      >
                        {isOpening === 'cursor' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Code className="h-4 w-4" aria-hidden="true" />
                        )}
                        Cursor
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => handleOpenExternal('finder', e)}
                        disabled={isOpening !== null}
                      >
                        {isOpening === 'finder' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <FolderOpen className="h-4 w-4" aria-hidden="true" />
                        )}
                        {getFileManagerName()}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Tooltip>
              </TooltipProvider>
            )}
            </>
          )}
        </div>
      </div>

    </RoiuiCard>
    <ProjectSettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      projectId={id}
      projectName={name}
      projectPath={path}
      projectLocalPath={localPath}
      archivedAt={archivedAt}
      onUpdated={onUpdated ?? (() => {})}
      onArchive={onArchive}
      onDelete={onDelete}
    />
    </>
  );
}
