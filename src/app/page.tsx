"use client";

import { useMemo, useState } from "react";



import { Plus, Github, Search, X } from "lucide-react";

import { AddProjectDialog } from "@/components/add-project-dialog";
import { ProjectCard } from "@/components/project-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/hooks/use-projects";
import { useToast } from "@/hooks/use-toast";

export default function ProjectsPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const { projects, isLoading, error, addProject, updateProjectTags } = useProjects();
  const { toast } = useToast();

  // Get all unique tags across projects
  const allTags = useMemo(() => {
    const tagMap = new Map<string, { id: string; name: string; color: string }>();
    projects.forEach((project) => {
      project.tags.forEach((tag) => {
        if (!tagMap.has(tag.id)) {
          tagMap.set(tag.id, tag);
        }
      });
    });
    return Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  // Filter projects by search query and selected tags (AND logic)
  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      // Search filter - match name or path
      const searchLower = searchQuery.toLowerCase().trim();
      const matchesSearch = searchLower === "" ||
        project.name.toLowerCase().includes(searchLower) ||
        project.path.toLowerCase().includes(searchLower);

      // Tag filter - AND logic: project must have ALL selected tags
      const matchesTags = selectedTagIds.length === 0 ||
        selectedTagIds.every((tagId) =>
          project.tags.some((tag) => tag.id === tagId)
        );

      return matchesSearch && matchesTags;
    });
  }, [projects, searchQuery, selectedTagIds]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedTagIds([]);
  };

  const hasActiveFilters = searchQuery.trim() !== "" || selectedTagIds.length > 0;

  const handleAddProject = async (input: { name: string; path: string }) => {
    // Check for duplicate
    const isDuplicate = projects.some(p => p.path === input.path);
    if (isDuplicate) {
      toast({
        title: "Project already exists",
        description: "This project is already in your dashboard.",
        variant: "destructive",
      });
      throw new Error("Project already exists"); // Let the dialog know it failed
    }
    await addProject(input);
  };


  return (
    <div className="flex min-h-dvh flex-col bg-surface-base">
      {/* Hero Section - pushed down with padding */}
      <main className="flex flex-col items-center px-6 pt-32">
        {/* Centered Heading with Space Grotesk */}
        <h1 className="mb-4 text-center text-balance font-heading text-4xl font-bold tracking-tight text-t-primary sm:text-5xl">
          Manage Your Beads Projects
        </h1>
        <p className="text-center text-t-tertiary text-sm mb-8">
          Highly recommended to use with the{" "}
          <a
            href="https://github.com/weselow/claude-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="text-info hover:text-info underline"
          >
            Beads Orchestration Skill
          </a>
        </p>

        <div className="w-full max-w-[1200px]">
          {/* Add Project Dropdown */}
          <div className="mb-6 flex justify-end">
            <Button variant="mono" size="md" onClick={() => setIsAddDialogOpen(true)}>
              <Plus aria-hidden="true" />
              Add Project
            </Button>
          </div>

          {/* Search and Filter Bar */}
          {projects.length > 0 && (
            <div className="mb-6 space-y-3">
              {/* Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-t-muted" aria-hidden="true" />
                <Input
                  type="search"
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-surface-raised/50 border-b-strong"
                  aria-label="Search projects"
                />
              </div>

              {/* Tag Filter Chips */}
              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-t-muted">Filter by tag:</span>
                  {allTags.map((tag) => {
                    const isSelected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className="transition-opacity"
                        aria-pressed={isSelected}
                        aria-label={`Filter by ${tag.name}`}
                      >
                        <Badge
                          variant={isSelected ? "primary" : "outline"}
                          size="sm"
                          style={
                            isSelected
                              ? {
                                  backgroundColor: tag.color,
                                  color: "#fff",
                                  borderColor: tag.color,
                                }
                              : {
                                  backgroundColor: `${tag.color}10`,
                                  color: tag.color,
                                  borderColor: `${tag.color}50`,
                                }
                          }
                        >
                          {tag.name}
                        </Badge>
                      </button>
                    );
                  })}
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="ml-2 flex items-center gap-1 text-xs text-t-muted hover:text-t-secondary transition-colors"
                      aria-label="Clear all filters"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Results count when filtering */}
              {hasActiveFilters && (
                <p className="text-xs text-t-muted">
                  Showing {filteredProjects.length} of {projects.length} project{projects.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          )}

          {isLoading ? (
            <div role="status" aria-label="Loading projects" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-b-default bg-surface-raised/70 p-4">
                  <div className="mb-3 flex gap-1.5">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-5 w-12" />
                  </div>
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-2 h-4 w-48" />
                  <Skeleton className="mt-4 h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div role="alert" className="rounded-lg border border-danger/50 bg-danger/70 p-6 text-center">
              <p className="text-danger">Error loading projects: {error.message}</p>
              <p className="mt-2 text-sm text-danger">
                Make sure the Tauri backend is running.
              </p>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-dashed border-b-strong bg-surface-raised/70 p-6 text-center text-t-tertiary">
                {hasActiveFilters ? (
                  <>
                    <p>No matching projects</p>
                    <p className="mt-1 text-sm text-t-muted">Try adjusting your search or filters</p>
                  </>
                ) : (
                  <>
                    <p>No projects yet</p>
                    <p className="mt-1 text-sm text-t-muted">Click the Add Project button above to get started</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  id={project.id}
                  name={project.name}
                  path={project.path}
                  localPath={project.localPath}
                  tags={project.tags}
                  beadCounts={project.beadCounts}
                  onTagsChange={(tags) => updateProjectTags(project.id, tags)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-b-default py-3">
        <div className="mx-auto flex max-w-[1200px] items-center justify-center gap-4 px-6">
          <a
            href="https://github.com/weselow/claude-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-t-muted transition-colors hover:text-t-secondary"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            <span>Beads Kanban UI</span>
          </a>
          <span className="text-t-faint" aria-hidden="true">·</span>
          <a
            href="https://github.com/steveyegge/beads"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-t-muted transition-colors hover:text-t-secondary"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            <span>Beads CLI</span>
          </a>
        </div>
      </footer>

      {/* Add Project Dialog */}
      <AddProjectDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onAddProject={handleAddProject}
        existingProjectNames={projects.map((p) => p.name)}
      />

    </div>
  );
}
