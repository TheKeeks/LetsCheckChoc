// ════════════════════════════════════════════════════════════════════
// CLEAN — ?preview=clean · loader (owner: Core)
// ────────────────────────────────────────────────────────────────────
// index.html writes <script src="previews/clean/theme.js"> after
// kiosk.js, while the page is still parsing, so these writes land
// right here and run in order: core.js first (window.CLEAN, the shell,
// the app hooks), then one file per part. Each part is its own file so
// a broken part never takes the others (or the app) down with it.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var files = ['core', 'forecast', 'log', 'model', 'tv'];
  for (var i = 0; i < files.length; i++) {
    document.write('<script src="previews/clean/' + files[i] + '.js"><\/script>');
  }
})();
