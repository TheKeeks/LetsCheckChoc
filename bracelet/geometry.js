// Fishers Bracelet geometry: pure functions, no DOM, no three.js.
//
// The piece is ONE round wire. Its route, as the owner described it:
//   1. it starts at the East End (Wicopesset end);
//   2. west along the north shore (West Harbor, North Hill, Hay Harbor,
//      Silver Eel) to Race Point;
//   3. round Race Point and east along the south shore back to the East End,
//      where it touches its own start: the start is soldered end-on to the
//      passing wire, so the island is a closed outline and the joint is one
//      wire thick (no doubling);
//   4. the same wire carries on east from that joint into a perfect circle
//      round the back of the wrist;
//   5. the circle comes up from under the wrist and ends in a small ball that
//      sits on the outline at North Hill: the clasp.
//
// Units: kilometres on the map, millimetres on the wrist. The design is laid
// out flat ("unrolled": u runs round the wrist, east positive; v runs along
// the arm, north positive), then wrapped onto a cylinder at the radius of the
// wire's centreline, which keeps every length exact.
//
// 3D frame (what bracelet/index.html draws): the arm lies along Z, the island
// sits on top (+Y), east is +X, north is -Z, the circle hangs round the
// underside. Looking down from above, the map reads north-up.
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;
  var LAT0 = 41.27;
  var KM_PER_DEG_LAT = 110.574;
  var KM_PER_DEG_LON = 111.320 * Math.cos(LAT0 * DEG);
  var STEP = 0.4;   // mm between samples along the wire

  var DEFAULTS = {
    wristCircMm: 158.75,   // 6.25 in
    wireDiaMm: 3,
    islandLenMm: 65,       // East End to Race Point, measured round the wrist
    smoothMm: 3,           // coastline wiggles smaller than about this are rounded off
    hookSlide: 0,          // where the clasp ball sits on the west end: 0 = North Hill … 1 = Race Point
    metal: '18k',
    north: 'hand'          // which way north faces when worn (labels only: the piece is the same)
  };

  var LIMITS = {
    wristCircMm: [130, 200],
    wireDiaMm: [1, 5],
    islandLenMm: [35, 110],
    smoothMm: [0, 8],
    hookSlide: [0, 1]
  };

  var BALL_PER_DIA = 0.7;   // clasp ball radius as a share of the wire diameter (Ø 4.2 mm on 3 mm wire)

  // Densities in g/cm³ (common alloys). purity is the fine-metal share by weight
  // (hallmarks 585, 750, 916, 925); base is which spot price applies.
  var METALS = {
    '14k': { label: '14k yellow gold', density: 13.07, purity: 0.585, base: 'gold' },
    '18k': { label: '18k yellow gold', density: 15.58, purity: 0.750, base: 'gold' },
    '22k': { label: '22k yellow gold', density: 17.80, purity: 0.916, base: 'gold' },
    silver: { label: 'Sterling silver (test piece)', density: 10.36, purity: 0.925, base: 'silver' }
  };

  var G_PER_OZT = 31.1035;   // grams in a troy ounce, the unit spot prices are quoted in

  // Spot prices saved with the page, used when the live price can't load (a
  // published artifact may not fetch other sites). From gold-api.com on
  // 2026-10-08 00:50 UTC (8:50 pm Oct 7 Eastern); Kitco closed Oct 7 at $4,107.10.
  var PRICE_SAVED = {
    gold: { usdPerOzt: 4116.40, asOf: '2026-10-08T00:50:54Z' },
    silver: { usdPerOzt: 60.00, asOf: '2026-10-08T00:50:53Z' }
  };

  // Named stops on the hook slider, north to south down the west end.
  var HOOK_STOPS = ['North Hill', 'Silver Eel', 'Race Point'];

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function normalize(input) {
    var p = {};
    var k;
    for (k in DEFAULTS) p[k] = DEFAULTS[k];
    if (input) for (k in input) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && input[k] != null) p[k] = input[k];
    for (k in LIMITS) {
      var n = Number(p[k]);
      p[k] = isFinite(n) ? clamp(n, LIMITS[k][0], LIMITS[k][1]) : DEFAULTS[k];
    }
    if (!METALS[p.metal]) p.metal = DEFAULTS.metal;
    if (p.north !== 'hand' && p.north !== 'elbow') p.north = DEFAULTS.north;
    return p;
  }

  // ── Small vector helpers on [x, y] pairs ──────────────────
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function len(a) { return Math.hypot(a[0], a[1]); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function unit(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l]; }

  function toKm(lonlat) {
    return [(lonlat[0] + 72) * KM_PER_DEG_LON, (lonlat[1] - LAT0) * KM_PER_DEG_LAT];
  }

  function coastPairs(data) {
    var c = data.coast;
    if (typeof c[0] !== 'number') return c.slice();
    var out = [];
    for (var i = 0; i + 1 < c.length; i += 2) out.push([c[i], c[i + 1]]);
    return out;
  }

  function signedArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  function nearestIndex(pts, q, from, to) {
    var best = -1, bd = Infinity;
    var lo = from == null ? 0 : from, hi = to == null ? pts.length : to;
    for (var i = lo; i < hi; i++) {
      var d = dist(pts[i], q);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function polylineLength(pts, closed) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0]);
    return L;
  }

  // Evenly spaced samples along a closed loop, starting at pts[0].
  function resampleClosed(pts, step) {
    var n = pts.length;
    var total = polylineLength(pts, true);
    var count = Math.max(8, Math.round(total / step));
    var d = total / count;
    var out = [];
    var seg = 0, segStart = 0;
    var segLen = dist(pts[0], pts[1 % n]);
    for (var k = 0; k < count; k++) {
      var s = k * d;
      while (s > segStart + segLen && seg < n - 1) {
        segStart += segLen;
        seg++;
        segLen = dist(pts[seg], pts[(seg + 1) % n]);
      }
      var a = pts[seg], b = pts[(seg + 1) % n];
      var t = segLen > 0 ? (s - segStart) / segLen : 0;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  // Gaussian smoothing round a closed loop of evenly spaced samples.
  function smoothClosed(pts, sigmaSamples) {
    if (!(sigmaSamples > 0.5)) return pts.slice();
    var n = pts.length;
    var half = Math.min(Math.floor(n / 2) - 1, Math.ceil(3 * sigmaSamples));
    var w = [], wsum = 0;
    for (var j = -half; j <= half; j++) {
      var v = Math.exp(-(j * j) / (2 * sigmaSamples * sigmaSamples));
      w.push(v);
      wsum += v;
    }
    var out = [];
    for (var i = 0; i < n; i++) {
      var x = 0, y = 0;
      for (var jj = -half; jj <= half; jj++) {
        var p = pts[((i + jj) % n + n) % n];
        var ww = w[jj + half];
        x += p[0] * ww;
        y += p[1] * ww;
      }
      out.push([x / wsum, y / wsum]);
    }
    return out;
  }

  // Cubic Hermite curve from p0 (heading t0) to p1 (heading t1); interior points only.
  function hermite(p0, t0, p1, t1, count) {
    var out = [];
    for (var i = 1; i < count; i++) {
      var s = i / count, s2 = s * s, s3 = s2 * s;
      var h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      out.push([
        h00 * p0[0] + h10 * t0[0] + h01 * p1[0] + h11 * t1[0],
        h00 * p0[1] + h10 * t0[1] + h01 * p1[1] + h11 * t1[1]
      ]);
    }
    return out;
  }

  function hermite3(p0, t0, p1, t1, count) {
    var out = [];
    for (var i = 1; i < count; i++) {
      var s = i / count, s2 = s * s, s3 = s2 * s;
      var h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      out.push([0, 1, 2].map(function (k) { return h00 * p0[k] + h10 * t0[k] + h01 * p1[k] + h11 * t1[k]; }));
    }
    return out;
  }

  // Every u where the loop crosses the line v = level.
  function crossingsAt(loop, level) {
    var out = [];
    for (var i = 0; i < loop.length; i++) {
      var a = loop[i], b = loop[(i + 1) % loop.length];
      var da = a[1] - level, db = b[1] - level;
      if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
        var t = da / (da - db);
        out.push({ u: a[0] + (b[0] - a[0]) * t, i: i });
      }
    }
    return out;
  }

  // ── Wrapping onto the wrist ───────────────────────────────
  // u, v (mm, flat) → [x, y, z] on a cylinder of radius rc (see the frame above).
  function wrap(u, v, rc) {
    var th = u / rc;
    return [rc * Math.sin(th), rc * Math.cos(th), -v];
  }

  // ── Tight spots: where the wire comes close to itself ──────
  // pts are flat samples with arc positions s. Pairs closer than limit that are
  // at least minApart apart along the wire are grouped into spots.
  function tightSpots(pts, s, limit, minApart, dia) {
    var hits = [];
    var n = pts.length;
    for (var i = 0; i < n; i++) {
      var bestJ = -1, bestD = limit;
      for (var j = i + 1; j < n; j++) {
        if (s[j] - s[i] < minApart) continue;
        var dx = pts[i][0] - pts[j][0];
        if (dx > limit || dx < -limit) continue;
        var d = Math.hypot(dx, pts[i][1] - pts[j][1]);
        if (d < bestD) { bestD = d; bestJ = j; }
      }
      if (bestJ >= 0) hits.push({ i: i, j: bestJ, d: bestD });
    }
    var spots = [];
    var cur = null;
    hits.forEach(function (h) {
      if (cur && s[h.i] - s[cur.lastI] < 2 && Math.abs(s[h.j] - s[cur.lastJ]) < 4) {
        cur.lastI = h.i;
        cur.lastJ = h.j;
        if (h.d < cur.d) { cur.d = h.d; cur.i = h.i; cur.j = h.j; }
      } else {
        cur = { i: h.i, j: h.j, d: h.d, lastI: h.i, lastJ: h.j };
        spots.push(cur);
      }
    });
    return spots.map(function (c) {
      return {
        i: c.i,
        j: c.j,
        gapMm: Math.round((c.d - dia) * 100) / 100,   // negative: the wires would overlap
        touching: c.d < dia + 0.05,
        at: [(pts[c.i][0] + pts[c.j][0]) / 2, (pts[c.i][1] + pts[c.j][1]) / 2]
      };
    });
  }

  // The turn (radians) that puts the East End level with each named stop.
  function levelAngles(coast, iE, marks) {
    var e = coast[iE], out = {};
    marks.forEach(function (m) {
      if (HOOK_STOPS.indexOf(m.name) < 0) return;
      var h = coast[nearestIndex(coast, m.pt)];
      out[m.name] = -Math.atan2(e[1] - h[1], e[0] - h[0]);
    });
    return out;
  }

  // Where each named stop sits on the hook slider (0 … 1).
  function hookStops(data) {
    data = data || root.FISHERS_OUTLINE;
    var coast = coastPairs(data).map(toKm);
    var marks = data.landmarks.map(function (m) { return { name: m.name, pt: toKm(m.lonlat) }; });
    var east = marks.filter(function (m) { return m.name === 'East End'; })[0];
    var lv = levelAngles(coast, nearestIndex(coast, east.pt), marks);
    var span = lv['Race Point'] - lv['North Hill'];
    return HOOK_STOPS.map(function (name) { return { name: name, at: Math.abs((lv[name] - lv['North Hill']) / span) }; });
  }

  // ── The whole design ──────────────────────────────────────
  function build(input, data) {
    var p = normalize(input);
    data = data || root.FISHERS_OUTLINE;
    if (!data) throw new Error('FISHERS_OUTLINE not loaded');

    var r = p.wireDiaMm / 2;
    var R = p.wristCircMm / (2 * Math.PI);   // wrist (skin) radius
    var rc = R + r;                          // wire centreline radius
    var cc = 2 * Math.PI * rc;               // centreline circumference

    // 1. Map → km, counter-clockwise, so leaving the East End heads along the north shore.
    var coast = coastPairs(data).map(toKm);
    if (signedArea(coast) < 0) coast.reverse();
    var marks = data.landmarks.map(function (m) { return { name: m.name, shore: m.shore, pt: toKm(m.lonlat) }; });
    function mark(name) { for (var i = 0; i < marks.length; i++) if (marks[i].name === name) return marks[i]; return null; }
    var iE = nearestIndex(coast, mark('East End').pt);

    // 2. Turn the island so the East End sits level with the hook point: the
    //    circle leaves one and reaches the other at the same height on the arm,
    //    which is what makes it a flat, perfect circle. The hook slider moves
    //    that point from North Hill (0) down the west end to Race Point (1).
    var lv = levelAngles(coast, iE, marks);
    var phi = lv['North Hill'] + p.hookSlide * (lv['Race Point'] - lv['North Hill']);
    var cs = Math.cos(phi), sn = Math.sin(phi);
    function rot(q) { return [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs]; }
    coast = coast.map(rot);
    marks.forEach(function (m) { m.pt = rot(m.pt); });

    // 3. Scale to millimetres (first pass), start the loop at the East End, resample, smooth.
    function extentU(pts) {
      var lo = Infinity, hi = -Infinity;
      pts.forEach(function (q) { if (q[0] < lo) lo = q[0]; if (q[0] > hi) hi = q[0]; });
      return hi - lo;
    }
    var k = p.islandLenMm / extentU(coast);
    var loop = coast.slice(iE).concat(coast.slice(0, iE)).map(function (q) { return [q[0] * k, q[1] * k]; });
    loop = resampleClosed(loop, STEP);
    loop = smoothClosed(loop, p.smoothMm / STEP);
    // Smoothing rounds the ends in a little: rescale so the island keeps its length.
    var k2 = p.islandLenMm / extentU(loop);
    loop = resampleClosed(loop.map(function (q) { return [q[0] * k2, q[1] * k2]; }), STEP);
    marks.forEach(function (m) { m.pt = [m.pt[0] * k * k2, m.pt[1] * k * k2]; });
    var n = loop.length;

    // 4. The East End tip: the easternmost sample near the start of the loop.
    var win = Math.round(12 / STEP), tip = 0;
    for (var w = -win; w <= win; w++) {
      var ii = (w + n) % n;
      if (loop[ii][0] > loop[tip][0]) tip = ii;
    }
    // Rotate the loop so index 0 is the tip.
    loop = loop.slice(tip).concat(loop.slice(0, tip));
    var ringV = loop[0][1];
    var uE = loop[0][0];

    // Race Point splits the north shore (0 … iRP) from the south shore (iRP … n).
    var iRP = nearestIndex(loop, mark('Race Point').pt);

    // 5. Where the circle comes home: the first place the line v = ringV meets the
    //    outline coming from the west.
    var xs = crossingsAt(loop, ringV).sort(function (a, b) { return a.u - b.u; });
    var hookX = xs[0];
    var uH = hookX.u;
    var hookName = null, hookDist = Infinity;
    marks.forEach(function (m) {
      if (m.name === 'East End') return;
      var d = dist(m.pt, [uH, ringV]);
      if (d < hookDist) { hookDist = d; hookName = m.name; }
    });

    // 6. Centre the island on top of the wrist.
    var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    loop.forEach(function (q) {
      if (q[0] < minU) minU = q[0];
      if (q[0] > maxU) maxU = q[0];
      if (q[1] < minV) minV = q[1];
      if (q[1] > maxV) maxV = q[1];
    });
    var cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
    function ctr(q) { return [q[0] - cu, q[1] - cv]; }
    loop = loop.map(ctr);
    marks.forEach(function (m) { m.pt = ctr(m.pt); });
    uE -= cu; uH -= cu; ringV -= cv;

    // 7. The flat route. The wire starts AT the East End tip T, runs the north
    //    shore west, rounds Race Point, comes back east along the south shore
    //    and passes back through T, where its own start is soldered to it
    //    end-on. From T the same wire carries straight on east into the circle.
    var blend = Math.max(3, 1.5 * p.wireDiaMm);
    var blendN = Math.round(blend / STEP);
    var T = loop[0];
    var A = loop[n - blendN];
    var tA = unit(sub(loop[(n - blendN + 1) % n], loop[n - blendN - 1]));
    var B = [uE + blend, ringV];            // due east of T: the circle keeps T's height
    var dAT = unit(sub(T, A));
    var tT = unit([dAT[0] + 1, dAT[1]]);    // through T halfway between the south shore's heading and due east
    var m1 = dist(A, T), m2 = dist(T, B);
    var into = hermite(A, [tA[0] * m1, tA[1] * m1], T, [tT[0] * m1, tT[1] * m1], Math.max(3, Math.round(m1 * 1.3 / STEP)));
    var outOf = hermite(T, [tT[0] * m2, tT[1] * m2], B, [m2, 0], Math.max(3, Math.round(m2 * 1.3 / STEP)));
    var passing = into.concat([T], outOf);
    // The start meets the passing wire end-on: trim it back to where its
    // centre is most of a radius off the passing wire, so its rounded end sits
    // in the side of that wire instead of running alongside it into the tip.
    function offPassing(q) {
      var d = Infinity;
      for (var pi = 0; pi < passing.length; pi++) d = Math.min(d, dist(q, passing[pi]));
      return d;
    }
    var want = 0.75 * r, startIdx = 0, dPrev = 0, dHere = offPassing(loop[0]);
    while (dHere < want && startIdx < n / 4) { startIdx++; dPrev = dHere; dHere = offPassing(loop[startIdx]); }
    var flat = [];
    if (startIdx > 0 && dHere > dPrev) {
      // Between samples: start exactly where the end sits that far off.
      var k0 = (want - dPrev) / (dHere - dPrev), q0 = loop[startIdx - 1], q1 = loop[startIdx];
      flat.push([q0[0] + (q1[0] - q0[0]) * k0, q0[1] + (q1[1] - q0[1]) * k0]);
    }
    var lead = flat.length;   // 1 when the start sits between samples
    for (var a = startIdx; a <= n - blendN; a++) flat.push(loop[a]);
    var junctionStart = flat.length;
    flat = flat.concat(into);
    var jointIndex = flat.length;
    flat.push([T[0], T[1]]);
    flat = flat.concat(outOf);
    var ringStart = flat.length;
    // The circle: constant v, from just past the East End round the back to the clasp.
    var hookR = p.wireDiaMm + 0.1;                            // clasp wire centre to outline wire centre as it crosses
    var lead = hookR * Math.cos(30 * DEG) + 2 * p.wireDiaMm;  // the clasp starts lifting this far out
    var uRingEnd = uH + cc - lead;
    for (var u = B[0]; u <= uRingEnd; u += STEP) flat.push([u, ringV]);
    flat.push([uRingEnd, ringV]);
    var ringEnd = flat.length - 1;

    // Arc positions along the flat route.
    var s = [0];
    for (var q = 1; q < flat.length; q++) s.push(s[q - 1] + dist(flat[q - 1], flat[q]));
    var outlineLen = s[ringStart];
    var ringLen = s[ringEnd] - s[ringStart];

    // 8. Wrap onto the wrist.
    var wire = flat.map(function (f) { return wrap(f[0], f[1], rc); });

    // 9. The clasp: the circle comes up from under the wrist, lifts off the
    //    skin, rises over the outline wire at North Hill and ends in a small
    //    ball sitting on top of it, a little inside the island, so the pull of
    //    the circle keeps it seated.
    var thH = uH / rc;
    var C3 = wrap(uH, ringV, rc);
    var tv = [Math.cos(thH), -Math.sin(thH), 0];   // round the wrist, eastward
    var nv = [Math.sin(thH), Math.cos(thH), 0];    // straight out from the skin
    function around(alpha, rad) {
      return [0, 1, 2].map(function (i) { return C3[i] + rad * (Math.cos(alpha) * tv[i] + Math.sin(alpha) * nv[i]); });
    }
    var a0 = 150 * DEG, a1 = 95 * DEG, aBall = 70 * DEG;
    var ballR = BALL_PER_DIA * p.wireDiaMm;
    var start3 = wire[wire.length - 1];
    var arc0 = around(a0, hookR);
    var dirIn = [0, 1, 2].map(function (i) { return Math.sin(a0) * tv[i] - Math.cos(a0) * nv[i]; });
    var chord = Math.hypot(arc0[0] - start3[0], arc0[1] - start3[1], arc0[2] - start3[2]);
    var thS = uRingEnd / rc;
    var tS = [Math.cos(thS), -Math.sin(thS), 0];   // the circle's own heading where the clasp starts
    var clasp = hermite3(start3, tS.map(function (c) { return c * chord; }), arc0, dirIn.map(function (c) { return c * chord; }), Math.max(6, Math.round(chord * 1.5 / STEP)));
    clasp.push(arc0);
    var arcSteps = Math.max(6, Math.round(hookR * (a0 - a1) / STEP));
    for (var t = 1; t <= arcSteps; t++) clasp.push(around(a0 - (a0 - a1) * t / arcSteps, hookR));
    var claspLen = 0;
    var prev = start3;
    clasp.forEach(function (pt) { claspLen += Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2]); prev = pt; });
    var ballPos = around(aBall, r + ballR);        // resting on the outline wire
    var claspStart = wire.length;
    wire = wire.concat(clasp);
    // The ball is balled up from the wire's own end: count it as wire.
    var ballMm = (4 / 3) * Math.PI * Math.pow(ballR, 3) / (Math.PI * r * r);

    // 10. Places the outline touches itself (solder points). The East End joint
    //     is soldered by design, so it is reported on its own, not here.
    var jointClear = 2.5 * p.wireDiaMm;
    var spots = tightSpots(flat, s, p.wireDiaMm + 0.5, 2 * p.wireDiaMm + 1, p.wireDiaMm).filter(function (sp) {
      return dist(flat[sp.i], T) > jointClear && dist(flat[sp.j], T) > jointClear;
    }).map(function (sp) {
      sp.pos = wrap(sp.at[0], sp.at[1], rc + r);
      return sp;
    });

    // 11. Landmarks, snapped to their shore.
    var landmarks = marks.map(function (mk) {
      var idx;
      if (mk.name === 'East End') idx = 0;
      else if (mk.shore === 'north') idx = nearestIndex(loop, mk.pt, 0, iRP + 1);
      else if (mk.shore === 'south') idx = nearestIndex(loop, mk.pt, iRP, n);
      else idx = nearestIndex(loop, mk.pt);
      var f = loop[idx];
      // Where the wire passes it, counting from the start at the East End.
      var wi = clamp(idx - startIdx + lead, 0, junctionStart);
      return { name: mk.name, flat: f, pos: wrap(f[0], f[1], rc + r + 0.5), loopIndex: idx, wireIndex: wi };
    });

    // 12. The piece laid flat, as the jeweller bends it before the tail is
    //     wrapped round the wrist: the island, then the tail straight east from
    //     the East End (circle plus clasp wire), ending in the ball.
    var tailLen = ringLen + claspLen;
    var tailEnd = [uRingEnd + claspLen, ringV];
    var flatPiece = {
      pts: flat.concat([tailEnd]),
      joint: [T[0], T[1]],
      tailFrom: B[0],
      tailEnd: tailEnd,
      tailLenMm: tailLen,
      ball: [tailEnd[0] + ballR * 0.6, ringV],
      ballR: ballR,
      northHill: [uH, ringV]
    };

    var totalLen = outlineLen + ringLen + claspLen + ballMm;
    var islandW = maxV - minV;
    return {
      params: p,
      wristRadius: R,
      wireRadius: r,
      centreRadius: rc,
      wire: wire,                // [x, y, z] mm, from the East End round the island, the circle, up to the clasp ball
      flat: flat,                // [u, v] mm, the unrolled route up to where the clasp lifts
      flatPiece: flatPiece,
      loop: loop,                // the smoothed outline, flat, starting at the East End tip
      index: { startLoop: startIdx, jointIndex: jointIndex, junctionStart: junctionStart, ringStart: ringStart, ringEnd: ringEnd, claspStart: claspStart, raceLoop: iRP },
      joint: { flat: [T[0], T[1]], pos: wrap(T[0], T[1], rc) },
      ring: { v: ringV, from: B[0], to: uRingEnd, uEast: uE, uHook: uH, lenMm: ringLen, innerDiaMm: 2 * R, centreDiaMm: 2 * rc },
      clasp: { u: uH, v: ringV, seat: C3, ballPos: ballPos, ballR: ballR, ballDiaMm: 2 * ballR, landmark: hookName, offMm: hookDist, turnDeg: phi / DEG },
      lengths: { outlineMm: outlineLen, ringMm: ringLen, claspMm: claspLen, ballMm: ballMm, totalMm: totalLen },
      island: { lengthMm: maxU - minU, widthMm: islandW },
      spots: spots,
      landmarks: landmarks
    };
  }

  function grams(model, metalKey) {
    var metal = METALS[metalKey || model.params.metal] || METALS['18k'];
    var r = model.wireRadius;
    var volMm3 = Math.PI * r * r * model.lengths.totalMm;
    return volMm3 / 1000 * metal.density;
  }

  // What the metal in the wire is worth at a spot price (US$ per troy ounce of
  // pure gold or silver). Metal only: no wire-making, labour or markup.
  function metalCost(model, metalKey, usdPerOzt) {
    var key = METALS[metalKey] ? metalKey : model.params.metal;
    var metal = METALS[key] || METALS['18k'];
    var g = grams(model, key);
    var fine = g * metal.purity;
    var ozt = fine / G_PER_OZT;
    return { base: metal.base, purity: metal.purity, grams: g, fineGrams: fine, fineOzt: ozt, usd: ozt * usdPerOzt };
  }

  var api = {
    DEFAULTS: DEFAULTS,
    LIMITS: LIMITS,
    METALS: METALS,
    G_PER_OZT: G_PER_OZT,
    BALL_PER_DIA: BALL_PER_DIA,
    PRICE_SAVED: PRICE_SAVED,
    HOOK_STOPS: HOOK_STOPS,
    hookStops: hookStops,
    STEP: STEP,
    normalize: normalize,
    toKm: toKm,
    signedArea: signedArea,
    resampleClosed: resampleClosed,
    smoothClosed: smoothClosed,
    polylineLength: polylineLength,
    crossingsAt: crossingsAt,
    wrap: wrap,
    build: build,
    grams: grams,
    metalCost: metalCost
  };
  root.BraceletGeom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
