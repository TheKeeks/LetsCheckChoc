// The e2e runner pins the files the bots rewrite (tests/e2e/run.js PINNED_FILES) to fixtures, so the
// browser scenarios don't drift as the buoy bot (every 2 h) and the history bot (every day) commit. Each
// pinned fixture must exist, and the gzipped history must unzip to what the page reads: the constants
// research/hist.js declares, ending on the day the scenarios were written against.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, fixturePath } = require('../helpers/fixtures');
const { PINNED_FILES, pinned } = require('../e2e/run.js');

test('every pinned file has its fixture, served under the same kind of name', () => {
  for (const [url, fixture] of Object.entries(PINNED_FILES)) {
    assert.ok(fs.existsSync(fixturePath(fixture)), `${url} → tests/fixtures/${fixture} is missing`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, url)), `${url} is not a file in the repo`);
    assert.equal(path.extname(fixture.replace(/\.gz$/, '')), path.extname(url), `${url} and its fixture are the same kind of file`);
  }
});

test('the pinned history unzips to the page\'s constants, through 5 Oct 2026', () => {
  const js = pinned('/research/hist.js').toString();
  for (const name of ['DATA', 'WILDSTATS', 'DAYS2', 'TRAINS', 'BENT', 'WIND', 'SESSPAIRS']) {
    assert.match(js, new RegExp(`(^|\\n)const ${name}=`), name);
  }
  const days2 = JSON.parse(js.match(/\nconst DAYS2=(.*);\n/)[1]);
  assert.equal(Object.keys(days2).sort().pop(), '2026-10-05');
});
