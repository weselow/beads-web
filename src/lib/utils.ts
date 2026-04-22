import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind class names, resolving any conflicts.
 *
 * @param inputs - An array of class names to merge.
 * @returns A string of merged and optimized class names.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Check if a project path is a Dolt-only project (no filesystem).
 * Dolt-only projects use the `dolt://` prefix convention.
 */
export function isDoltProject(path: string | null | undefined): boolean {
  return !!path && path.startsWith("dolt://");
}

/**
 * Derive a `bd init --prefix <slug>` slug from a project path (or name fallback).
 *
 * Rules:
 *  - If `path` is a `dolt://` URL or empty, fall back to `name`.
 *  - Otherwise take the last path segment (splitting on both `/` and `\`).
 *  - Lowercase, replace any non-alphanumeric run with a single dash, trim dashes.
 */
export function deriveBeadPrefix(path: string, name: string): string {
  const isDolt = path.startsWith("dolt://");
  const lastSegment = path.split(/[\\/]/).filter(Boolean).pop();
  const base = !path || isDolt ? name : (lastSegment ?? name);
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
