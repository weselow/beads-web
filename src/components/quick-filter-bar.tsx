'use client';

import * as React from 'react';

import { Search, X, ArrowUpDown, SlidersHorizontal, BrainCircuit, Bot, AlertTriangle, Plus, Shapes } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { ISSUE_TYPES, getIssueTypeMeta } from '@/lib/issue-types';
import type { IssueTypeFilter } from '@/lib/issue-types';
import { cn } from '@/lib/utils';
import type { BeadStatus } from '@/types';

type TypeFilter = IssueTypeFilter;
type SortField = 'ticket_number' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface QuickFilterBarProps {
  /** Issue type filter: all, epics, or tasks */
  typeFilter: TypeFilter;
  /** Callback when type filter changes */
  onTypeFilterChange: (type: TypeFilter) => void;
  /** Whether to show only today's active items */
  todayOnly: boolean;
  /** Callback when today's active toggle changes */
  onTodayOnlyChange: (value: boolean) => void;
  /** Field to sort by */
  sortField: SortField;
  /** Sort direction */
  sortDirection: SortDirection;
  /** Callback when sort changes */
  onSortChange: (field: SortField, direction: SortDirection) => void;
  /** Search query */
  search: string;
  /** Callback when search changes */
  onSearchChange: (value: string) => void;
  /** Ref for the search input (keyboard navigation) */
  searchInputRef?: React.RefObject<HTMLInputElement>;
  /** Active status filters */
  statuses: BeadStatus[];
  /** Callback when status filter toggles */
  onStatusToggle: (status: BeadStatus) => void;
  /** Active owner filters */
  owners: string[];
  /** Callback when owner filter toggles */
  onOwnerToggle: (owner: string) => void;
  /** List of available owners */
  availableOwners: string[];
  /** Callback to clear all filters */
  onClearFilters: () => void;
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Whether the memory panel is open */
  isMemoryOpen?: boolean;
  /** Callback to toggle memory panel */
  onMemoryToggle?: () => void;
  /** Whether the agents panel is open */
  isAgentsOpen?: boolean;
  /** Callback to toggle agents panel */
  onAgentsToggle?: () => void;
  /** Whether the project has a filesystem path (not dolt-only) */
  hasProjectPath?: boolean;
  /** Count of beads with truly unknown statuses */
  unknownStatusCount?: number;
  /** List of unknown status names for tooltip */
  unknownStatusNames?: string[];
  /** Callback when "New" button is clicked */
  onNewBead?: () => void;
}

const SORT_OPTIONS: { value: string; label: string; field: SortField; direction: SortDirection }[] = [
  { value: 'ticket_number_desc', label: 'Ticket # (Newest)', field: 'ticket_number', direction: 'desc' },
  { value: 'ticket_number_asc', label: 'Ticket # (Oldest)', field: 'ticket_number', direction: 'asc' },
  { value: 'created_at_desc', label: 'Updated (Newest)', field: 'created_at', direction: 'desc' },
  { value: 'created_at_asc', label: 'Updated (Oldest)', field: 'created_at', direction: 'asc' },
];

const STATUS_OPTIONS: { value: BeadStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'inreview', label: 'In Review' },
  { value: 'closed', label: 'Closed' },
];

/**
 * QuickFilterBar provides quick access to common filter and sort operations
 * for the kanban board. Displays below the header as a horizontal bar.
 */
export function QuickFilterBar({
  typeFilter,
  onTypeFilterChange,
  todayOnly,
  onTodayOnlyChange,
  sortField,
  sortDirection,
  onSortChange,
  search,
  onSearchChange,
  searchInputRef,
  statuses,
  onStatusToggle,
  owners,
  onOwnerToggle,
  availableOwners,
  onClearFilters,
  hasActiveFilters,
  isMemoryOpen,
  onMemoryToggle,
  isAgentsOpen,
  onAgentsToggle,
  hasProjectPath = true,
  unknownStatusCount = 0,
  unknownStatusNames = [],
  onNewBead,
}: QuickFilterBarProps) {
  const currentSortValue = `${sortField}_${sortDirection}`;

  // Active issue-type filter metadata for the type dropdown trigger
  const activeType = typeFilter === 'all' ? null : getIssueTypeMeta(typeFilter);
  const TypeTriggerIcon = activeType?.icon ?? Shapes;

  const handleSortOptionSelect = (value: string) => {
    const option = SORT_OPTIONS.find((opt) => opt.value === value);
    if (option) {
      onSortChange(option.field, option.direction);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Quick filters"
      className="flex items-center gap-3 rounded-xl bg-surface-raised/80 backdrop-blur border border-b-default px-3 py-2"
    >
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-t-muted" aria-hidden="true" />
        <Input
          ref={searchInputRef}
          type="text"
          aria-label="Search beads"
          placeholder="Search… (/)"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 pr-8 w-[180px] h-8 bg-surface-overlay/50 border-b-strong text-t-primary placeholder:text-t-muted"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-0 top-1/2 -translate-y-1/2 size-11 flex items-center justify-center text-t-muted hover:text-t-secondary"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* New Bead Button */}
      {onNewBead && (
        <Button
          size="sm"
          onClick={onNewBead}
          className="h-8 px-3 gap-1.5 bg-success text-white hover:bg-success/85 font-medium shadow-sm"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </Button>
      )}

      {/* Type Filter Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-3 gap-1.5 bg-surface-overlay/50 text-sm font-medium',
              activeType ? 'text-t-primary' : 'text-t-tertiary hover:text-t-secondary'
            )}
            aria-label="Filter by issue type"
          >
            <TypeTriggerIcon className={cn('size-4 shrink-0', activeType?.colorClass)} aria-hidden="true" />
            {activeType ? activeType.label : 'All types'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-surface-raised border-b-default">
          <DropdownMenuCheckboxItem
            checked={typeFilter === 'all'}
            onCheckedChange={() => onTypeFilterChange('all')}
            className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary"
          >
            All types
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator className="bg-surface-overlay" />
          {ISSUE_TYPES.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={typeFilter === option.value}
                onCheckedChange={() => onTypeFilterChange(option.value)}
                className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary"
              >
                <span className="flex items-center gap-2">
                  <Icon className={cn('size-3.5 shrink-0', option.colorClass)} aria-hidden="true" />
                  {option.label}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Today's Active Toggle - styled to match tabs */}
      <button
        type="button"
        onClick={() => onTodayOnlyChange(!todayOnly)}
        aria-pressed={todayOnly}
        className={cn(
          'h-8 px-3 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
          todayOnly
            ? 'bg-epic/20 text-epic'
            : 'bg-surface-overlay/50 text-t-tertiary hover:text-t-secondary'
        )}
      >
        Today
      </button>

      {/* Memory Toggle */}
      {onMemoryToggle && (
        <button
          type="button"
          onClick={hasProjectPath ? onMemoryToggle : undefined}
          disabled={!hasProjectPath}
          aria-pressed={isMemoryOpen}
          title={hasProjectPath ? undefined : 'Requires project folder path'}
          className={cn(
            'h-8 px-3 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
            !hasProjectPath
              ? 'bg-surface-overlay/30 text-t-faint cursor-not-allowed'
              : isMemoryOpen
                ? 'bg-epic/20 text-epic'
                : 'bg-surface-overlay/50 text-t-tertiary hover:text-t-secondary'
          )}
        >
          <BrainCircuit className="size-4" aria-hidden="true" />
          Memory
        </button>
      )}

      {/* Agents Toggle */}
      {onAgentsToggle && (
        <button
          type="button"
          onClick={hasProjectPath ? onAgentsToggle : undefined}
          disabled={!hasProjectPath}
          aria-pressed={isAgentsOpen}
          title={hasProjectPath ? undefined : 'Requires project folder path'}
          className={cn(
            'h-8 px-3 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
            !hasProjectPath
              ? 'bg-surface-overlay/30 text-t-faint cursor-not-allowed'
              : isAgentsOpen
                ? 'bg-blocked-accent/20 text-blocked-accent'
                : 'bg-surface-overlay/50 text-t-tertiary hover:text-t-secondary'
          )}
        >
          <Bot className="size-4" aria-hidden="true" />
          Agents
        </button>
      )}

      {/* Unknown status warning indicator */}
      {unknownStatusCount > 0 && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="status"
                className="flex items-center gap-1.5 h-8 px-2.5 text-sm font-medium rounded-md bg-blocked-accent/15 text-blocked-accent border border-blocked-accent/30"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                <span className="tabular-nums">{unknownStatusCount}</span>
                <span className="sr-only">
                  {unknownStatusCount === 1 ? 'bead has an' : 'beads have'} unknown {unknownStatusCount === 1 ? 'status' : 'statuses'}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="font-medium">
                {unknownStatusCount} {unknownStatusCount === 1 ? 'bead has an' : 'beads have'} unknown {unknownStatusCount === 1 ? 'status' : 'statuses'}
              </p>
              <p className="text-primary-foreground/70 mt-1">
                {unknownStatusNames.length > 0
                  ? `Unknown: ${unknownStatusNames.join(', ')}`
                  : 'Mapped to Open column'}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Spacer to push sort and filter to the right */}
      <div className="flex-1" />

      {/* Sort Icon Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-t-tertiary hover:text-t-primary"
            aria-label="Sort options"
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-surface-raised border-b-default">
          <DropdownMenuLabel className="text-t-tertiary">Sort by</DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-surface-overlay" />
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={currentSortValue === option.value}
              onCheckedChange={() => handleSortOptionSelect(option.value)}
              className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary"
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Filter Icon Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-2',
              hasActiveFilters ? 'text-epic' : 'text-t-tertiary hover:text-t-primary'
            )}
            aria-label="Filter options"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {hasActiveFilters && <span className="ml-1 text-xs" aria-hidden="true">•</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-surface-raised border-b-default">
          <DropdownMenuLabel className="text-t-tertiary">Status</DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-surface-overlay" />
          {STATUS_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={statuses.includes(option.value)}
              onCheckedChange={() => onStatusToggle(option.value)}
              className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary"
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}

          {availableOwners.length > 0 && (
            <>
              <DropdownMenuSeparator className="bg-surface-overlay" />
              <DropdownMenuLabel className="text-t-tertiary">Owner</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-surface-overlay" />
              {availableOwners.map((owner) => (
                <DropdownMenuCheckboxItem
                  key={owner}
                  checked={owners.includes(owner)}
                  onCheckedChange={() => onOwnerToggle(owner)}
                  className="text-t-secondary focus:bg-surface-overlay focus:text-t-primary"
                >
                  {owner}
                </DropdownMenuCheckboxItem>
              ))}
            </>
          )}

          {hasActiveFilters && (
            <>
              <DropdownMenuSeparator className="bg-surface-overlay" />
              <DropdownMenuItem
                onClick={onClearFilters}
                className="text-danger focus:bg-surface-overlay focus:text-danger"
              >
                Clear filters
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type { QuickFilterBarProps, TypeFilter, SortField, SortDirection };
