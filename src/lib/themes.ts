/**
 * Theme definitions for the theme switcher.
 * Each theme maps to a `data-theme` attribute value on <html>.
 * CSS variable overrides are in src/app/themes.css.
 */

/** Card layout variants that themes can use */
export type CardLayout = 'standard' | 'compact-row' | 'property-tags';

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  layout: CardLayout;
  preview: {
    bg: string;
    surface: string;
    text: string;
    accent: string;
  };
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'default',
    name: 'Default Dark',
    description: 'The original dark theme',
    mode: 'dark',
    layout: 'standard',
    preview: { bg: '#0a0a0a', surface: '#18181b', text: '#f5f5f5', accent: '#3b82f6' },
  },
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    description: 'Frosted glass, blue & purple accents',
    mode: 'dark',
    layout: 'standard',
    preview: { bg: '#0a0a1a', surface: '#1a1a2e', text: '#e2e8f0', accent: '#a78bfa' },
  },
  {
    id: 'neo-brutalist',
    name: 'Neo-Brutalist',
    description: 'Thick borders, neon green, monospace',
    mode: 'dark',
    layout: 'standard',
    preview: { bg: '#111111', surface: '#1a1a1a', text: '#f0f0f0', accent: '#00ff88' },
  },
  {
    id: 'linear-minimal',
    name: 'Linear Minimal',
    description: 'Ultra-minimal, monochrome with subtle accents',
    mode: 'dark',
    layout: 'compact-row',
    preview: { bg: '#0c0c0e', surface: '#121215', text: '#d4d4d8', accent: '#6d28d9' },
  },
  {
    id: 'soft-light',
    name: 'Soft Light',
    description: 'Light background, soft shadows, pastels',
    mode: 'light',
    layout: 'standard',
    preview: { bg: '#f8f9fb', surface: '#ffffff', text: '#1f2937', accent: '#8b5cf6' },
  },
  {
    id: 'notion-warm',
    name: 'Notion Warm',
    description: 'Warm neutrals, Notion-style tags',
    mode: 'light',
    layout: 'property-tags',
    preview: { bg: '#faf9f7', surface: '#ffffff', text: '#37352f', accent: '#6940a5' },
  },
  {
    id: 'github-clean',
    name: 'GitHub Clean',
    description: 'GitHub Projects-inspired, clean borders',
    mode: 'light',
    layout: 'property-tags',
    preview: { bg: '#f6f8fa', surface: '#ffffff', text: '#1f2328', accent: '#0969da' },
  },
];

/** Storage key for persisted theme */
export const THEME_STORAGE_KEY = 'beads-theme';

/** Get the saved theme ID from localStorage */
export function getSavedTheme(): string {
  if (typeof window === 'undefined') return 'default';
  return localStorage.getItem(THEME_STORAGE_KEY) || 'default';
}

/** Get a theme definition by ID */
export function getTheme(themeId: string): ThemeDefinition {
  return THEMES.find(t => t.id === themeId) || THEMES[0];
}

/** Get the current theme's card layout */
export function getActiveLayout(): CardLayout {
  return getTheme(getSavedTheme()).layout;
}

/** Apply a theme by setting data-theme on <html> and toggling dark class */
export function applyTheme(themeId: string): void {
  const theme = THEMES.find(t => t.id === themeId);
  if (!theme) return;

  const html = document.documentElement;

  if (themeId === 'default') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', themeId);
  }

  // Toggle dark/light class for shadcn compatibility
  if (theme.mode === 'dark') {
    html.classList.add('dark');
    html.classList.remove('light');
  } else {
    html.classList.remove('dark');
    html.classList.add('light');
  }

  localStorage.setItem(THEME_STORAGE_KEY, themeId);

  // Notify useTheme() subscribers
  window.dispatchEvent(new CustomEvent('theme-change'));
}
