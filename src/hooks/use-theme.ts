"use client";

import { useSyncExternalStore } from "react";

import { getSavedTheme, getTheme, THEME_STORAGE_KEY, type CardLayout, type ThemeDefinition } from "@/lib/themes";

/**
 * Subscribe to theme changes via storage events and custom events.
 * Fires when applyTheme() is called or localStorage changes from another tab.
 */
const themeListeners = new Set<() => void>();

function subscribeToTheme(callback: () => void) {
  themeListeners.add(callback);

  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) callback();
  };
  const onCustom = () => callback();

  window.addEventListener("storage", onStorage);
  window.addEventListener("theme-change", onCustom);

  return () => {
    themeListeners.delete(callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("theme-change", onCustom);
  };
}

function getThemeSnapshot(): string {
  return getSavedTheme();
}

function getServerSnapshot(): string {
  return "default";
}

/**
 * Hook to get the current active theme and card layout.
 * Re-renders when theme changes.
 */
export function useTheme(): { theme: ThemeDefinition; layout: CardLayout; themeId: string } {
  const themeId = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerSnapshot);
  const theme = getTheme(themeId);

  return {
    theme,
    layout: theme.layout,
    themeId,
  };
}
