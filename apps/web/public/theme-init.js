// Runs before first paint to avoid a flash of the wrong theme.
// Keep in sync with src/app/theme.ts (resolveTheme). Storage may be blocked, so every access is guarded.
(function () {
  var theme = 'dark';
  try {
    var stored = window.localStorage.getItem('ms-theme');
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      theme = 'light';
    }
  } catch {
    // Storage unavailable: fall back to the dark default.
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
