"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { CalendarClock, ChevronDown, Rocket } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PromoteType } from "@/hooks/use-idea-actions";
import type { DeferPreset } from "@/lib/ideas";
import { getIssueTypeMeta } from "@/lib/issue-types";
import { cn } from "@/lib/utils";

const PROMOTE_TYPES: readonly PromoteType[] = ["epic", "feature", "task"];
const DEFER_PRESETS: readonly { value: DeferPreset; label: string }[] = [
  { value: "week", label: "In a week" },
  { value: "month", label: "In a month" },
];
const MENU_ITEM_CLASS = "text-t-secondary focus:bg-surface-overlay focus:text-t-primary gap-2";

/** Small row button; stays hoverable when disabled so its title still shows. */
export const ActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function ActionButton({ className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "h-7 px-2 inline-flex items-center gap-1 rounded text-xs font-medium text-t-tertiary bg-surface-overlay/50 hover:text-t-primary hover:bg-surface-overlay transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-t-tertiary",
          className
        )}
        {...props}
      />
    );
  }
);

interface MenuProps {
  disabled: boolean;
  title?: string;
}

/** Promote: the story becomes an epic, a feature or a task. */
export function PromoteMenu({ disabled, title, onPick }: MenuProps & { onPick: (type: PromoteType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton disabled={disabled} title={title} aria-label="Promote">
          <Rocket className="size-3.5" aria-hidden="true" />
          Promote
          <ChevronDown className="size-3" aria-hidden="true" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-surface-raised border-b-default">
        {PROMOTE_TYPES.map((type) => {
          const meta = getIssueTypeMeta(type);
          const Icon = meta.icon;
          return (
            <DropdownMenuItem key={type} onSelect={() => onPick(type)} className={MENU_ITEM_CLASS}>
              <Icon className={cn("size-3.5", meta.colorClass)} aria-hidden="true" />
              {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DeferMenuProps extends MenuProps {
  onPreset: (preset: DeferPreset) => void;
  onPickDate: () => void;
}

/** Defer: a week, a month, or a picked day. */
export function DeferMenu({ disabled, title, onPreset, onPickDate }: DeferMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton disabled={disabled} title={title} aria-label="Defer">
          <CalendarClock className="size-3.5" aria-hidden="true" />
          Defer
          <ChevronDown className="size-3" aria-hidden="true" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-surface-raised border-b-default">
        {DEFER_PRESETS.map(({ value, label }) => (
          <DropdownMenuItem key={value} onSelect={() => onPreset(value)} className={MENU_ITEM_CLASS}>
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-surface-overlay" />
        <DropdownMenuItem onSelect={onPickDate} className={MENU_ITEM_CLASS}>
          Pick a date…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
