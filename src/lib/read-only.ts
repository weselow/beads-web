/**
 * Tooltip for every write control while the board shows an old copy from
 * issues.jsonl: writes go through bd, which is exactly what is failing.
 */
export const READ_ONLY_HINT = "Disabled: bd can't open the database, so changes can't be saved";

/**
 * The shared Button turns pointer events off when disabled, which also hides
 * its `title` tooltip. Turn them back on so the hint shows on hover.
 */
export const READ_ONLY_BUTTON_CLASS = "disabled:pointer-events-auto disabled:cursor-not-allowed";
