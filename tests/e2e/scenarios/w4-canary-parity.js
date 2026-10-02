// The upstream canary (scripts/canary.py) must probe the exact requests the
// site depends on: if app.js changes a query and the canary does not, a
// broken request could pass the canary while the site fails. Loads the main
// page on the fixtures and checks the Open-Meteo / CO-OPS probes against the
// requests seen. The browser no longer calls NDBC (the CORS proxies are dead;
// Choc reads the pipeline's data/buoy.json), so the NDBC probes must instead
// match the files scripts/fetch_buoy.py downloads.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

module.exports = {
  name: 'canary probes the same upstream requests the page makes',
  options: { viewport: { width: 1280, height: 900 } },
  async run({ ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitForLoad();

    // FIXTURE_NOW is 2026-10-01 11:00 EDT, so the page's CO-OPS begin_date is 20261001.
    const urls = JSON.parse(execFileSync('python3',
      [path.join(REPO_ROOT, 'scripts', 'canary.py'), '--print-urls', '--date', '2026-10-01'], { encoding: 'utf8' }));
    assert.deepEqual(Object.keys(urls).sort(),
      ['marine', 'ndbc-data_spec', 'ndbc-txt', 'tides-6min', 'tides-hilo', 'wind']);

    const ndbcKeys = Object.keys(urls).filter(k => k.startsWith('ndbc-'));
    const pageKeys = Object.keys(urls).filter(k => !k.startsWith('ndbc-'));

    // NDBC: the pipeline builds f"{NDBC_BASE}{BUOY_ID}.{ext}".
    const pipeline = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'fetch_buoy.py'), 'utf8');
    const base = (pipeline.match(/^NDBC_BASE = "([^"]+)"/m) || [])[1];
    const buoy = (pipeline.match(/^BUOY_ID = "([^"]+)"/m) || [])[1];
    assert.ok(base && buoy, 'fetch_buoy.py defines NDBC_BASE and BUOY_ID');
    for (const key of ndbcKeys) {
      const ext = key.slice('ndbc-'.length);
      assert.equal(urls[key], `${base}${buoy}.${ext}`, `${key}: canary URL must match the pipeline's`);
      assert.ok(new RegExp(`["'.]${ext}["']`).test(pipeline), `${key}: fetch_buoy.py downloads .${ext}`);
    }
    assert.equal(ctx.requests.filter(r => r.url.includes('ndbc.noaa.gov')).length, 0,
      'the page itself never requests NDBC');

    const requested = url => ctx.requests.some(r => r.url === url);
    for (const key of pageKeys) {
      assert.ok(requested(urls[key]), `${key}: the page never requested\n  ${urls[key]}\nIt requested:\n  ` +
        ctx.requests.map(r => r.url).filter(u => u.startsWith(urls[key].split('?')[0])).join('\n  '));
    }
    log(`${pageKeys.length} canary probes match page requests; ${ndbcKeys.length} match the pipeline`);
  }
};
