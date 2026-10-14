// Audit C48, static half (no browser): the surf-log rating sliders the Log tab
// borrows from index.html must have labels. The browser half (computed
// colours day and night, tap-target sizes, named controls) is the e2e
// scenario preview-clean-a11y.js; the old Win95 sheets whose grey tokens this
// file also checked are gone.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../helpers/load-app');

const read = f => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

test('every range input in index.html has a label', () => {
  const html = read('index.html');
  const ranges = [...html.matchAll(/<input[^>]*type="range"[^>]*>/g)].map(m => m[0]);
  assert.ok(ranges.length >= 3);
  for (const tag of ranges) {
    const id = (tag.match(/\sid="([^"]+)"/) || [])[1];
    const named = /\saria-label(ledby)?="[^"]+"/.test(tag) || new RegExp(`<label[^>]*\\sfor="${id}"`).test(html);
    assert.ok(named, `#${id} has no <label for>, aria-label or aria-labelledby`);
  }
});
