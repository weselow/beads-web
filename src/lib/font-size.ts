export const FONT_SIZE_STORAGE_KEY = "beads-font-size";
export const DEFAULT_FONT_SIZE = 16;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 24;

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}

export function applyFontSize(value: number): void {
  document.documentElement.style.setProperty("--app-font-size", `${clampFontSize(value)}px`);
}
