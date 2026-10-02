// Audit C38: the repo had no test CI and no committed test harness. These
// checks pin the wiring so it cannot silently disappear again.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, FIXTURE_DIR } = require('../helpers/fixtures');

const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('package.json: private, no runtime deps, the three test scripts', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined, 'the site ships without npm dependencies');
  assert.match(pkg.scripts.test, /TZ=America\/New_York node --test .*tests\/unit\/\*\.test\.js/);
  assert.match(pkg.scripts.test, /node test-gate\.js/);
  assert.equal(pkg.scripts['test:e2e'], 'node tests/e2e/run.js');
  assert.match(pkg.scripts['test:py'], /unittest discover -s scripts -p 'test_\*\.py'/);
});

test('CI workflow runs unit, python and e2e on push / PR / dispatch', () => {
  const yml = read('.github/workflows/ci.yml');
  for (const trigger of ['push:', 'pull_request:', 'workflow_dispatch:']) assert.ok(yml.includes(trigger), trigger);
  assert.match(yml, /paths-ignore:\s*\n\s*- ['"]?data\/\*\*/, 'bot data commits must not trigger CI');
  assert.match(yml, /cancel-in-progress: true/);
  assert.match(yml, /node-version: ['"]?22/);
  assert.match(yml, /python-version: ['"]?3\.12/);
  assert.match(yml, /run: npm test\b/);
  assert.match(yml, /run: npm run test:py\b/);
  assert.match(yml, /npm i --no-save playwright@1\.56\.1/);
  assert.match(yml, /npx playwright install --with-deps chromium/);
  assert.match(yml, /run: npm run test:e2e\b/);
  assert.match(yml, /if: always\(\)\s*\n\s*uses: actions\/upload-artifact@v4[\s\S]*path: tests\/e2e\/artifacts\//);
});

test('.gitignore keeps installs, e2e artifacts and bytecode out of git', () => {
  const lines = read('.gitignore').split('\n').map(s => s.trim());
  for (const entry of ['node_modules/', 'tests/e2e/artifacts/', '__pycache__/']) assert.ok(lines.includes(entry), entry);
});

test('fixtures stay small (< 1.5 MB total)', () => {
  let total = 0;
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else total += fs.statSync(p).size;
    }
  };
  walk(FIXTURE_DIR);
  assert.ok(total < 1.5 * 1024 * 1024, `tests/fixtures is ${(total / 1024).toFixed(0)} KB`);
});

test('every e2e scenario honours the runner contract', () => {
  const dir = path.join(REPO_ROOT, 'tests', 'e2e', 'scenarios');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const s = require(path.join(dir, f));
    assert.equal(typeof s.name, 'string', `${f}: name`);
    assert.equal(typeof s.run, 'function', `${f}: run()`);
    if (s.options !== undefined) assert.equal(typeof s.options, 'object', `${f}: options`);
  }
});
