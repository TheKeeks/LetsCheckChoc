// Audit C26/C29: the real rules tests need Java + the Firebase emulators
// (tests/rules/rules.test.js, run by .github/workflows/rules.yml and
// `npm run test:rules`). This file pins that wiring, and does a quick
// static read of the rules so `npm test` alone (no Java) still catches
// the ownership checks or the image allowlist being dropped.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../helpers/load-app');

const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
// Rules source without // comments (the disabled C28 template is commented out).
const code = rel => read(rel).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

test('firebase.json points the emulators at the repo rules files', () => {
  const fb = JSON.parse(read('firebase.json'));
  assert.equal(fb.firestore.rules, 'firestore.rules');
  assert.equal(fb.storage.rules, 'storage.rules');
  assert.ok(fb.emulators.firestore.port && fb.emulators.storage.port);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'tests/rules/rules.test.js')));
});

test('npm run test:rules and the rules workflow run the emulator suite', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:rules'], /^firebase emulators:exec --only firestore,storage --project demo-[\w-]+ "node tests\/rules\/rules\.test\.js"$/);
  assert.equal(pkg.dependencies, undefined, 'emulator packages are installed --no-save, never as deps');
  const yml = read('.github/workflows/rules.yml');
  assert.match(yml, /actions\/setup-java@v4[\s\S]*java-version: ['"]?21/);
  assert.match(yml, /node-version: ['"]?22/);
  assert.match(yml, /npm i --no-save firebase-tools@[\d.]+ @firebase\/rules-unit-testing@[\d.]+ firebase@[\d.]+/);
  assert.match(yml, /run: npm run test:rules\b/);
  for (const trigger of ['pull_request:', 'workflow_dispatch:']) assert.ok(yml.includes(trigger), trigger);
});

test('firestore.rules: update needs the stored AND the incoming owner; delete needs the stored owner', () => {
  const src = code('firestore.rules');
  const rule = verb => (src.match(new RegExp('allow ' + verb + ':([\\s\\S]*?);')) || [])[1] || '';
  assert.match(rule('create'), /request\.resource\.data\.userId == request\.auth\.uid/);
  assert.match(rule('update'), /resource\.data\.userId == request\.auth\.uid[\s\S]*request\.resource\.data\.userId == request\.auth\.uid/);
  assert.match(rule('delete'), /resource\.data\.userId == request\.auth\.uid/);
  assert.doesNotMatch(src, /allow\s+create,\s*update/, 'create and update must not share one rule again');
  assert.match(src, /createdAt == request\.time/);
  assert.doesNotMatch(src, /token\.email in/, 'the C28 crew allowlist stays a commented template until the owner supplies emails');
  assert.match(read('firestore.rules'), /\/\/ function crew\(\)/, 'C28 template kept for the owner');
});

test('storage.rules: own folder, app-shaped path, image allowlist without SVG', () => {
  const src = code('storage.rules');
  assert.match(src, /request\.auth\.uid == userId/);
  const ct = (src.match(/contentType\.matches\('([^']+)'\)/) || [])[1];
  assert.equal(ct, 'image/(jpeg|png|webp|heic|heif|gif)');
  assert.match(src, /filename\.matches\('\[0-9\]\+_\[0-9\]\+\[\.\]jpg'\)/);
  assert.match(src, /request\.resource\.size < 10 \* 1024 \* 1024/);
});
