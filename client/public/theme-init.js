/*
 * Slydr anti-FOUC theme initialiser — spec §6.3.
 *
 * Runs as a PARSER-BLOCKING classic script in <head>, before first paint, so
 * the page never flashes the wrong theme. It is a separate same-origin file
 * rather than an inline <script> because the HTML document is served with the
 * spec §3.4 policy `script-src 'self'`, which blocks inline scripts. A
 * same-origin file satisfies that policy with no relaxation, no nonce and no
 * hash to keep in sync. Do not inline this. See tasks/T021.
 *
 * Contract with styles/tokens.css:
 *   data-theme absent  -> follow the OS (prefers-color-scheme)
 *   data-theme="light" -> force light, even on a dark OS
 *   data-theme="dark"  -> force dark, even on a light OS
 *
 * Keep this logic in sync with client/src/state/theme.ts.
 */
(function () {
  'use strict';
  var KEY = 'slydr.theme';
  var root = document.documentElement;

  var stored = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch (_err) {
    /* Storage disabled (private mode, blocked site data). Follow the OS. */
    stored = null;
  }

  if (stored === 'light' || stored === 'dark') {
    root.setAttribute('data-theme', stored);
    return;
  }

  /*
   * No valid override. Leave data-theme off entirely so the CSS
   * prefers-color-scheme block owns the decision. Setting the attribute to the
   * current OS value here would freeze the theme at load time and break the
   * live OS-change behaviour required by §6.3.
   */
  root.removeAttribute('data-theme');
})();
