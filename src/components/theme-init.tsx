/**
 * Inline script injected into <head> to apply saved theme BEFORE React hydration.
 * Prevents flash of wrong theme on page load.
 *
 * Uses dangerouslySetInnerHTML because this must execute as raw JS in <script>.
 * The code is fully self-contained with no external dependencies.
 */
export function ThemeInitScript() {
  const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('beads-theme');
    if (t && t !== 'default') {
      document.documentElement.setAttribute('data-theme', t);
    }
    var lightThemes = ['soft-light', 'notion-warm', 'github-clean', 'catppuccin-latte'];
    if (t && lightThemes.indexOf(t) !== -1) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    var fs = localStorage.getItem('beads-font-size');
    var parsed = fs ? Number(fs) : NaN;
    if (Number.isFinite(parsed)) {
      var clamped = Math.min(24, Math.max(12, Math.round(parsed)));
      document.documentElement.style.setProperty('--app-font-size', clamped + 'px');
    }
  } catch(e) {}
})();
`;

  return (
    <script dangerouslySetInnerHTML={{ __html: themeScript }} />
  );
}
