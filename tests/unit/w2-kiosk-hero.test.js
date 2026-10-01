// Choc TV day cards (audit C20): the big hero reading must be the swell
// train that reaches the reef. CHOCOMOUNT_KNOWLEDGE.md: "When the primary
// swell is out of window but the secondary is in window, the secondary
// becomes the de facto primary at the spot." The kiosk used to headline
// Open-Meteo's primary partition whatever its direction.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixtureJSON } = require('../helpers/load-app');

// Per local day (2026-10-01 = TODAY): [primary H ft, T s, dir°], [secondary …].
const DAYS = {
  '2026-10-01': [[3.0, 10, 135], [1.0, 6, 200]],   // control: in-window primary, out-of-window secondary
  '2026-10-02': [[2.0, 5, 191], [1.0, 9, 122]],    // the audit's Saturday: S wind swell vs SE groundswell
  '2026-10-03': [[2.0, 7, 162], [1.5, 11, 140]],   // primary on the edge, still more in-window energy
  '2026-10-04': [[2.0, 7, 175], [1.5, 11, 130]],   // primary leaking (align 0.43): secondary wins on energy
  '2026-10-05': [[2.0, 8, 200], [1.0, 9, 205]],    // nothing in the window
  '2026-10-06': [[2.0, 9, 140], null]              // no secondary partition
};

function syntheticMarine() {
  const h = {
    time: [], swell_wave_height: [], swell_wave_period: [], swell_wave_direction: [],
    secondary_swell_wave_height: [], secondary_swell_wave_period: [], secondary_swell_wave_direction: []
  };
  for (let i = 0; i < 168; i++) {
    const d = new Date(2026, 9, 1, i);
    const pad = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    h.time.push(`${day}T${pad(d.getHours())}:00`);
    const [p, s] = DAYS[day] || DAYS['2026-10-01'];
    h.swell_wave_height.push(p[0]); h.swell_wave_period.push(p[1]); h.swell_wave_direction.push(p[2]);
    h.secondary_swell_wave_height.push(s ? s[0] : null);
    h.secondary_swell_wave_period.push(s ? s[1] : null);
    h.secondary_swell_wave_direction.push(s ? s[2] : null);
  }
  return { hourly: h };
}

function kioskWith(isChoc) {
  const app = loadApp({ kiosk: true });
  const S = app.get('STATE');
  S.isChocomount = isChoc;
  S.forecastData = {
    marine: syntheticMarine(),
    wind: readFixtureJSON('open-meteo/wind.json'),
    tideHiLo: readFixtureJSON('coops/hilo-240h.json').predictions
  };
  return app;
}

const brief = b => b && { max: b.max, period: b.period, dir: Math.round(b.dir), cls: b.cls };

test('day hero = the train with more in-window energy (out-of-window primary swaps with in-window secondary)', () => {
  const app = kioskWith(true);
  const days = app.clone('[0, 1, 2, 3, 4, 5].map(kioskDaySummary)');
  assert.deepEqual(days.map(d => d.label), ['TODAY', 'TOMORROW', 'SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY']);

  // TOMORROW: 2 ft @ 5 s from 191° is blocked; the 1 ft @ 9 s SE groundswell is Choc's swell.
  assert.deepEqual(brief(days[1].primary), { max: 1, period: 9, dir: 122, cls: 'dir-in' });
  assert.deepEqual(brief(days[1].secondary), { max: 2, period: 5, dir: 191, cls: 'dir-out' });

  // Control: an in-window primary keeps its slot.
  assert.deepEqual(brief(days[0].primary), { max: 3, period: 10, dir: 135, cls: 'dir-in' });
  assert.deepEqual(brief(days[0].secondary), { max: 1, period: 6, dir: 200, cls: 'dir-out' });

  // Ranked by energy (alignment × H²), not a hard gate: 162° on the edge
  // (align 0.87 × 4) still beats 1.5 ft in window (2.25) …
  assert.deepEqual(brief(days[2].primary), { max: 2, period: 7, dir: 162, cls: 'dir-edge' });
  // … while 175° (align 0.43 × 4 = 1.73) loses to it.
  assert.deepEqual(brief(days[3].primary), { max: 2, period: 11, dir: 130, cls: 'dir-in' });
  assert.equal(days[3].secondary.dir, 175);

  // Nothing in window: no swap, both trains flagged.
  assert.equal(Math.round(days[4].primary.dir), 200);
  assert.equal(days[4].primary.cls, 'dir-out');
  assert.equal(days[4].secondary.cls, 'dir-out');
  // No secondary partition: the primary stays, the slot stays empty.
  assert.equal(Math.round(days[5].primary.dir), 140);
  assert.equal(days[5].secondary, null);
});

test('day card marks out-of-window trains OUT OF WINDOW and dims them; in-window hero is untagged', () => {
  const app = kioskWith(true);
  const html = i => app.run(`kioskDayCardHTML(kioskDaySummary(${i}))`);
  const tomorrow = html(1);
  assert.match(tomorrow, /<div class="np-swell np-primary">/, 'hero row: not dimmed');
  assert.match(tomorrow, /<div class="np-swell np-secondary np-out"><span class="np-out-tag">OUT OF WINDOW<\/span>/);
  assert.equal(tomorrow.split('OUT OF WINDOW').length - 1, 1);
  // Edge-of-window trains are not tagged.
  assert.doesNotMatch(html(2).split('np-secondary')[0], /OUT OF WINDOW/);
  // Nothing in window: the hero carries the tag too.
  assert.match(html(4), /<div class="np-swell np-primary np-out"><span class="np-out-tag">OUT OF WINDOW/);
});

test('away from Chocomount there is no window: Open-Meteo order kept, no tags', () => {
  const app = kioskWith(false);
  const tomorrow = app.clone('kioskDaySummary(1)');
  assert.equal(Math.round(tomorrow.primary.dir), 191);
  assert.equal(tomorrow.primary.cls, '');
  assert.doesNotMatch(app.run('kioskDayCardHTML(kioskDaySummary(1))'), /OUT OF WINDOW/);
});
