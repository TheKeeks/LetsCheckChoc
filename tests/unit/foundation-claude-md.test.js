// Audit C40: CLAUDE.md is the entry point for every Claude Code web session.
// These checks keep it from rotting: commands must exist, grep anchors must
// still land in the code, referenced files must exist, and the invariants it
// states must match CONFIG.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, REPO_ROOT } = require('../helpers/load-app');

const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const claudeMd = () => read('CLAUDE.md');

test('CLAUDE.md exists and stays a quick read (~120–160 lines)', () => {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'CLAUDE.md')), 'CLAUDE.md missing');
  const lines = claudeMd().split('\n').length;
  assert.ok(lines >= 80 && lines <= 180, `CLAUDE.md is ${lines} lines`);
});

test('every npm command CLAUDE.md mentions is a real package.json script', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const cmds = [...claudeMd().matchAll(/\bnpm (?:run ([\w:-]+)|(test)\b)/g)].map(m => m[1] || m[2]);
  assert.ok(cmds.length >= 3);
  for (const c of cmds) assert.ok(scripts[c], `CLAUDE.md mentions "npm ${c}" but package.json has no such script`);
});

test('module-map grep anchors still exist in app.js / kiosk.js', () => {
  const src = read('app.js') + '\n' + read('kiosk.js');
  const anchors = [...claudeMd().matchAll(/`(\/\/ [^`]+)`/g)].map(m => m[1]);
  assert.ok(anchors.length >= 20, 'expected the module map to list its anchors, found ' + anchors.length);
  for (const a of anchors) assert.ok(src.includes(a), `anchor not found in app.js/kiosk.js: ${a}`);
});

test('files and directories CLAUDE.md names exist', () => {
  const tokens = [...claudeMd().matchAll(/`([\w./-]+\.(?:js|py|md|json|yml|rules|html|css|jpg)|[\w-]+\/(?:[\w./-]*\/)?)`/g)].map(m => m[1]);
  assert.ok(tokens.length >= 15);
  for (const t of tokens) {
    if (t.startsWith('/opt/') || t.includes('<')) continue;   // environment paths
    assert.ok(fs.existsSync(path.join(REPO_ROOT, t)), `CLAUDE.md references missing path: ${t}`);
  }
});

test('stated invariants match the code', () => {
  const md = claudeMd();
  const c = loadApp().get('CONFIG').chocomount;
  assert.match(md, new RegExp(`${c.swellWindowMin}–${c.swellWindowMax}°`), 'swell window in CLAUDE.md must match CONFIG');
  assert.match(md, /America\/New_York/);
  assert.match(md, new RegExp(String(c.forecastLat).replace('.', '\\.')), 'forecast point latitude');
  assert.match(md, /pasted into the Firebase console/i);
  assert.match(md, /CHOCOMOUNT_KNOWLEDGE\.md/);
});
