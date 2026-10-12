// Package the existing buildless app for a separate private preview host.
// GitHub Pages still serves the repository root with no build step.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'dist');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest);
const files = fs.readdirSync(root).filter(name => /\.(html|js|css|webmanifest)$/.test(name) && name !== 'test-gate.js');
const dirs = ['previews', 'map', 'research', 'bracelet', 'data', 'icons', 'fonts', 'vendor', 'project/assets'];
for (const name of files.concat(dirs)) {
  const source = path.join(root, name);
  if (!fs.existsSync(source)) continue;
  fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
  fs.cpSync(source, path.join(dest, name), { recursive: true });
}
console.log('Static branch preview prepared in dist/');
