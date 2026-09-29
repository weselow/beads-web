"use client";

import { cn } from "@/lib/utils";

export interface ToggleSwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "onClick" | "role"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Small on/off switch; name it with aria-label or a label next to it. */
export function ToggleSwitch({ checked, onCheckedChange, className, ...props }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-b-strong transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-t-tertiary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-t-primary" : "bg-surface-overlay",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-surface-base shadow transition-transform",
          checked ? "translate-x-3" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
