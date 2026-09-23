/**
 * Stamp the saved theme before first paint, so a dark-mode visitor never gets a
 * white flash. Kept as its own file rather than an inline block so the page can
 * ship a Content-Security-Policy that forbids inline script outright.
 */
try {
  var saved = localStorage.getItem('openbook.theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
} catch (e) {
  /* private mode, or storage blocked — the media query still applies */
}
