"use client";

import { useState, useEffect } from "react";

import { Check, Palette } from "lucide-react";

import { cn } from "@/lib/utils";
import { THEMES, getSavedTheme, applyTheme, type ThemeDefinition } from "@/lib/themes";

/**
 * Theme preview swatch — shows 4 color dots representing the theme palette
 */
function ThemePreview({ theme, isActive }: { theme: ThemeDefinition; isActive: boolean }) {
  return (
    <div
      className="relative flex items-center gap-1 rounded-md p-1"
      style={{ backgroundColor: theme.preview.bg }}
    >
      <div className="size-3 rounded-sm" style={{ backgroundColor: theme.preview.surface }} />
      <div className="size-3 rounded-sm" style={{ backgroundColor: theme.preview.accent }} />
      <div
        className="size-1.5 rounded-full absolute -top-0.5 -right-0.5"
        style={{ backgroundColor: theme.preview.text }}
      />
      {isActive && (
        <Check className="size-3 absolute -bottom-0.5 -right-0.5 text-t-primary" />
      )}
    </div>
  );
}

/**
 * Theme switcher component — grid of theme cards
 * Persists selection to localStorage and applies via data-theme attribute
 */
export function ThemeSwitcher() {
  const [activeTheme, setActiveTheme] = useState("default");

  useEffect(() => {
    setActiveTheme(getSavedTheme());
  }, []);

  const handleSelect = (themeId: string) => {
    applyTheme(themeId);
    setActiveTheme(themeId);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-t-muted">
        <Palette className="size-3.5" aria-hidden="true" />
        <span>Select a theme</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {THEMES.map((theme) => {
          const isActive = theme.id === activeTheme;
          return (
            <button
              key={theme.id}
              onClick={() => handleSelect(theme.id)}
              aria-pressed={isActive}
              aria-label={`Apply ${theme.name} theme`}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                "hover:bg-surface-overlay/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base",
                isActive
                  ? "border-info bg-info/5"
                  : "border-b-default"
              )}
            >
              <ThemePreview theme={theme} isActive={isActive} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "text-sm font-medium",
                    isActive ? "text-t-primary" : "text-t-secondary"
                  )}>
                    {theme.name}
                  </span>
                  <span className={cn(
                    "text-[10px] uppercase tracking-wide px-1 py-0.5 rounded",
                    theme.mode === 'dark'
                      ? "bg-surface-overlay text-t-muted"
                      : "bg-warning/10 text-warning"
                  )}>
                    {theme.mode}
                  </span>
                </div>
                <p className="text-xs text-t-muted truncate">
                  {theme.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
