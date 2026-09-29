/**
 * Readiness bars: the share of done children and its colour. Shared by the
 * epic card and the tree view.
 */

/** Whole percent of done out of total; 0 when there is nothing to count. */
export function percentDone(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** Colour class for the filled part of a Progress bar, by percentage. */
export function getProgressIndicatorClass(percentage: number): string {
  if (percentage === 100) return "[&>*]:bg-progress-100";
  if (percentage >= 75) return "[&>*]:bg-progress-75";
  if (percentage >= 50) return "[&>*]:bg-progress-50";
  if (percentage >= 25) return "[&>*]:bg-progress-25";
  return "[&>*]:bg-progress-0";
}
