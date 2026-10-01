// The upstream canary (scripts/canary.py) must probe the exact requests the
// page makes: if app.js changes a query and the canary does not, a broken
// request could pass the canary while the site fails. Loads the main page
// on the fixtures, then checks every canary URL against the requests seen.
'use strict';

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

    // The browser can only reach NDBC through a CORS-proxy wrapper, so
    // match those by the decoded target URL.
    const requested = url => ctx.requests.some(r => r.url === url ||
      (url.startsWith('https://www.ndbc.noaa.gov/') && decodeURIComponent(r.url).endsWith(url)));
    const deadline = Date.now() + 30000;   // the spectral fetch comes last
    while (!Object.values(urls).every(requested) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    for (const [key, url] of Object.entries(urls)) {
      assert.ok(requested(url), `${key}: the page never requested\n  ${url}\nIt requested:\n  ` +
        ctx.requests.map(r => r.url).filter(u => u.startsWith(url.split('?')[0])).join('\n  '));
    }
    log(`${Object.keys(urls).length} canary probes match page requests`);
  }
};
