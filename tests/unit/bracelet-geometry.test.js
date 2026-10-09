// Fishers Bracelet (bracelet/): the wire's route and shape, checked against
// the owner's description. One 3 mm wire starts at the East End, runs west
// along the north shore past North Hill and Silver Eel to Race Point, back
// east along the south shore to the East End, where it meets its own start
// in one end-on joint (the island closed, one wire thick), then carries on as
// a perfect circle round the back of a 6.25 in wrist, coming up from under
// the wrist to a small ball that sits on North Hill.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO_ROOT } = require('../helpers/load-app');

const G = require(path.join(REPO_ROOT, 'bracelet/geometry.js'));
const OUTLINE = (() => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'bracelet/fishers-outline.js'), 'utf8') + '\nthis.out = FISHERS_OUTLINE;', ctx);
  return ctx.out;
})();
const build = p => G.build(p || {}, OUTLINE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('the coastline is the real island: ~9.8 km long, counter-clockwise, landmarks on it', () => {
  assert.equal(OUTLINE.coast.length % 2, 0);
  const pts = [];
  for (let i = 0; i < OUTLINE.coast.length; i += 2) pts.push(G.toKm([OUTLINE.coast[i], OUTLINE.coast[i + 1]]));
  const xs = pts.map(p => p[0]);
  near(Math.max(...xs) - Math.min(...xs), 9.8, 0.2, 'east–west extent (km)');
  assert.ok(G.signedArea(pts) > 0, 'counter-clockwise');
  for (const name of ['East End', 'North Hill', 'Silver Eel', 'Race Point', 'Wilderness', 'Chocomount']) {
    assert.ok(OUTLINE.landmarks.some(l => l.name === name), `landmark ${name}`);
  }
});

test('defaults: 6.25 in wrist, 3 mm wire, the ball sits on North Hill', () => {
  const m = build();
  assert.equal(m.params.wristCircMm, 158.75);
  assert.equal(m.params.wireDiaMm, 3);
  assert.equal(m.params.startGapMm, undefined, 'no free-end gap any more: the start is joined');
  near(m.wristRadius * 2 * Math.PI, 158.75, 1e-9, 'wrist circumference');
  near(m.ring.innerDiaMm, 50.53, 0.01, 'inside diameter (mm)');
  assert.equal(m.clasp.landmark, 'North Hill');
  assert.ok(m.clasp.offMm < 2, `ball within 2 mm of North Hill's shore (${m.clasp.offMm.toFixed(2)} mm)`);
});

test('the wire runs East End → north shore → North Hill → Silver Eel → Race Point → south shore → East End joint → circle → clasp', () => {
  const m = build();
  const at = Object.fromEntries(m.landmarks.map(l => [l.name, l.wireIndex]));
  const order = [0, at['North Hill'], at['Silver Eel'], at['Race Point'], m.index.junctionStart, m.index.jointIndex, m.index.ringStart, m.index.ringEnd, m.index.claspStart, m.wire.length - 1];
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `step ${i} in order: ${order.join(' < ')}`);
  // Leaving the East End the wire heads west (−u) along the north (upper) side.
  const f = m.flat;
  assert.ok(f[10][0] < f[0][0], 'heads west from the start');
  const T = m.joint.flat;
  assert.ok(Math.hypot(f[0][0] - T[0], f[0][1] - T[1]) < 2 * m.wireRadius, 'starts at the East End tip');
  // North-shore landmarks sit north of the south-shore ones at the same end.
  const v = Object.fromEntries(m.landmarks.map(l => [l.name, l.flat[1]]));
  assert.ok(v['North Hill'] > v['Silver Eel'] && v['Silver Eel'] > v['Race Point'], 'west end: North Hill above Silver Eel above Race Point');
});

test('East End: the island closes in one end-on joint, one wire thick, no doubled wire', () => {
  for (const p of [{}, { wireDiaMm: 2 }, { wireDiaMm: 4 }, { islandLenMm: 90 }, { hookSlide: 1 }]) {
    const m = build(p);
    const f = m.flat, r = m.wireRadius, dia = 2 * r, T = m.joint.flat;
    // The south shore comes back through the tip itself and carries on into the circle.
    assert.deepEqual(f[m.index.jointIndex], T, 'the passing wire goes through the East End tip');
    const passing = f.slice(m.index.junctionStart, m.index.ringStart);
    const dmin = q => Math.min(...passing.map(a => Math.hypot(a[0] - q[0], a[1] - q[1])));
    // The start's rounded end sits in the side of the passing wire: touching, fused.
    const d0 = dmin(f[0]);
    assert.ok(d0 <= r && d0 >= 0.5 * r, `start is fused end-on (${d0.toFixed(2)} mm off the passing wire, r = ${r})`);
    // Beyond two wire widths from the joint the two never run side by side.
    let s = 0;
    for (let i = 1; i < m.index.junctionStart; i++) {
      s += Math.hypot(f[i][0] - f[i - 1][0], f[i][1] - f[i - 1][1]);
      if (s > 2 * dia && s < 30) assert.ok(dmin(f[i]) >= dia, `no doubling ${s.toFixed(1)} mm from the joint (${dmin(f[i]).toFixed(2)} mm apart)`);
    }
    // The joint is designed, so it is not counted among the places the outline touches itself.
    for (const sp of m.spots) assert.ok(Math.hypot(sp.at[0] - T[0], sp.at[1] - T[1]) > 2 * dia, 'touch points are away from the joint');
  }
});

test('the circle is perfect: one radius, one plane, round the back of the wrist', () => {
  for (const p of [{}, { hookSlide: 1 }, { wristCircMm: 170, wireDiaMm: 2, islandLenMm: 80 }]) {
    const m = build(p);
    const ring = m.wire.slice(m.index.ringStart, m.index.ringEnd + 1);
    const z0 = ring[0][2];
    for (const q of ring) {
      near(Math.hypot(q[0], q[1]), m.centreRadius, 1e-9, 'distance from the wrist axis');
      near(q[2], z0, 1e-9, 'same plane');
    }
    // It passes under the wrist (the back), not over the island.
    const minY = Math.min(...ring.map(q => q[1]));
    near(minY, -m.centreRadius, 0.05, 'reaches the underside');
    // Wire wraps at its centreline radius, so the circle's wire is exactly that arc.
    near(m.ring.lenMm, m.ring.to - m.ring.from, 1e-6, 'circle length is the arc length');
  }
});

test('clasp: the circle comes up from under the wrist and ends in a small ball sitting on North Hill', () => {
  for (const p of [{}, { wireDiaMm: 2 }, { hookSlide: 1 }]) {
    const m = build(p);
    const c = m.clasp, r = m.wireRadius, dia = 2 * r, seat = c.seat;
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    near(c.ballDiaMm, 1.4 * dia, 1e-9, 'a small ball, 1.4× the wire');
    // The seat is the outline wire itself, and the ball rests on it.
    const outline = m.wire.slice(0, m.index.junctionStart);
    assert.ok(Math.min(...outline.map(q => d3(q, seat))) < 0.5, 'the seat is on the outline wire');
    near(d3(c.ballPos, seat), r + c.ballR, 1e-9, 'ball touches the outline wire');
    assert.ok(Math.hypot(c.ballPos[0], c.ballPos[1]) - c.ballR > m.wristRadius, 'ball clear of the skin');
    // The clasp wire rises over the outline wire, never through it or the wrist, and ends in the ball.
    const clasp = m.wire.slice(m.index.claspStart);
    for (const q of clasp) {
      assert.ok(d3(q, seat) >= dia - 0.05, 'clears the outline wire');
      assert.ok(Math.hypot(q[0], q[1]) >= m.centreRadius - 0.05, 'stays outside the skin');
    }
    assert.ok(d3(m.wire[m.wire.length - 1], c.ballPos) < c.ballR, 'the wire ends inside the ball');
    // Up from below: the circle reaches the west end from round the back of the wrist.
    assert.ok(m.ring.uHook < 0 && m.ring.uEast > 0, 'ball on the west end, circle leaves from the east');
  }
});

test('ball slider: North Hill → Silver Eel → Race Point, circle stays flat at every stop', () => {
  const stops = G.hookStops(OUTLINE);
  assert.deepEqual(stops.map(s => s.name), ['North Hill', 'Silver Eel', 'Race Point']);
  assert.equal(stops[0].at, 0);
  assert.equal(stops[2].at, 1);
  assert.ok(stops[1].at > 0.3 && stops[1].at < 0.95, 'Silver Eel between them');
  for (const s of stops) {
    const m = build({ hookSlide: s.at });
    assert.equal(m.clasp.landmark, s.name, `slider ${s.at.toFixed(2)} lands on ${s.name}`);
  }
});

test('flat piece: the island and the straight tail ending in the ball, as the jeweller bends it', () => {
  const m = build();
  const fp = m.flatPiece;
  near(fp.tailLenMm, m.ring.lenMm + m.lengths.claspMm, 1e-9, 'tail = circle + clasp wire');
  near(fp.tailEnd[1], m.ring.v, 1e-9, 'tail runs straight');
  assert.ok(fp.ball[0] > fp.tailEnd[0], 'ball at the end of the tail');
  // Laid flat, the wire is as long as it is wrapped.
  let L = 0;
  for (let i = 1; i < fp.pts.length; i++) L += Math.hypot(fp.pts[i][0] - fp.pts[i - 1][0], fp.pts[i][1] - fp.pts[i - 1][1]);
  near(L, m.lengths.outlineMm + m.lengths.ringMm + m.lengths.claspMm, 1e-6, 'flat length = wrapped length');
});

test('island length and wire weight', () => {
  const m = build();
  near(m.island.lengthMm, 65, 0.5, 'island length round the wrist');
  assert.ok(m.island.widthMm > 12 && m.island.widthMm < 22, `island width ${m.island.widthMm.toFixed(1)} mm`);
  const L = m.lengths;
  near(L.totalMm, L.outlineMm + L.ringMm + L.claspMm + L.ballMm, 1e-9, 'lengths add up');
  // The ball is balled up from the wire's own end, so it counts as wire.
  near(L.ballMm, (4 / 3) * Math.PI * Math.pow(m.clasp.ballR, 3) / (Math.PI * 1.5 * 1.5), 1e-9, 'ball as wire length');
  // Solid round wire: π r² × length × density.
  const g18 = G.grams(m, '18k');
  near(g18, Math.PI * 1.5 * 1.5 * L.totalMm / 1000 * 15.58, 1e-9, '18k weight');
  assert.ok(g18 > 25 && g18 < 40, `18k weight ${g18.toFixed(1)} g`);
  assert.ok(G.grams(m, 'silver') < G.grams(m, '14k') && G.grams(m, '14k') < g18 && g18 < G.grams(m, '22k'), 'heavier metals weigh more');
  const longer = build({ islandLenMm: 90 });
  assert.ok(longer.lengths.outlineMm > L.outlineMm && longer.lengths.ringMm < L.ringMm, 'a longer island trades circle for outline');
});

test('gold cost: the pure gold in the wire at the spot price', () => {
  const m = build();
  // 18k is 75% gold: grams × 0.75 ÷ 31.1035 g/ozt × $/ozt.
  const c = G.metalCost(m, '18k', 4116.40);
  near(c.fineGrams, G.grams(m, '18k') * 0.75, 1e-9, 'pure gold in 18k');
  near(c.usd, c.fineGrams / 31.1035 * 4116.40, 1e-9, 'priced per troy ounce');
  assert.ok(c.usd > 2500 && c.usd < 3700, `18k default at $4,116/oz is ~$3,000 (${c.usd.toFixed(0)})`);
  assert.equal(c.base, 'gold');
  // Purity by hallmark; sterling is priced off silver.
  assert.deepEqual(['14k', '18k', '22k', 'silver'].map(k => G.METALS[k].purity), [0.585, 0.75, 0.916, 0.925]);
  assert.equal(G.metalCost(m, 'silver', 60).base, 'silver');
  assert.ok(G.metalCost(m, '14k', 4116.40).usd < c.usd && c.usd < G.metalCost(m, '22k', 4116.40).usd, 'higher karat costs more');
  // Cost scales with the price and with the wire: twice the price, twice the cost.
  near(G.metalCost(m, '18k', 8232.80).usd, 2 * c.usd, 1e-6, 'linear in price');
  assert.ok(G.metalCost(build({ wireDiaMm: 2 }), '18k', 4116.40).usd < c.usd * 0.5, 'a 2 mm wire is under half the gold');
  // The price saved with the page is a real recent quote, dated.
  assert.ok(G.PRICE_SAVED.gold.usdPerOzt > 1000 && !isNaN(Date.parse(G.PRICE_SAVED.gold.asOf)));
  assert.ok(G.PRICE_SAVED.silver.usdPerOzt > 5 && !isNaN(Date.parse(G.PRICE_SAVED.silver.asOf)));
});

test('smoothing rounds off the coves a 3 mm wire cannot follow', () => {
  const raw = build({ smoothMm: 0 });
  const smooth = build({ smoothMm: 4 });
  assert.ok(raw.spots.length > smooth.spots.length, `touch points ${raw.spots.length} raw vs ${smooth.spots.length} smoothed`);
  assert.ok(raw.lengths.outlineMm > smooth.lengths.outlineMm, 'smoothing shortens the outline');
  for (const s of smooth.spots) assert.ok(s.gapMm < 0.5, 'a touch point is a gap under 0.5 mm');
});

test('normalize clamps bad input to something buildable', () => {
  const p = G.normalize({ wristCircMm: 9999, wireDiaMm: 'x', hookSlide: -3, metal: 'tin', north: 'up', bogus: 1 });
  assert.equal(p.wristCircMm, G.LIMITS.wristCircMm[1]);
  assert.equal(p.wireDiaMm, 3);
  assert.equal(p.hookSlide, 0);
  assert.equal(p.metal, '18k');
  assert.equal(p.north, 'hand');
  assert.equal(p.bogus, undefined);
  assert.ok(build(p).wire.length > 100);
});
