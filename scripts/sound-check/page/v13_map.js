(function () {
  'use strict';
  // ── shared data and helpers for the whole page (window.CHOC), and the ray model that carries the
  // buoy's swell across the sound. The map at the top of the page draws this model in its Forecast
  // and Past views; this file only computes it.
  const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = { swell: css('--swell'), soft: css('--swell-soft'), cool: css('--cool'), off: css('--offshore'), blown: css('--blown'),
              fg: css('--fg'), fg2: css('--fg-2'), fg3: css('--fg-3'), rule: css('--rule'), panel: css('--panel'), ink: css('--ink') };
  // Charts retain this palette object, so update it before their theme redraw listeners run.
  addEventListener('lcc-theme-change', () => {
    const vars = { swell: '--swell', soft: '--swell-soft', cool: '--cool', off: '--offshore', blown: '--blown', fg: '--fg', fg2: '--fg-2', fg3: '--fg-3', rule: '--rule', panel: '--panel', ink: '--ink' };
    for (const key in vars) C[key] = css(vars[key]);
  });
  const OFF = 335, BIG_E = 5.2;
  const wSoft = d => d >= 115 && d <= 158 ? 1 : d >= 100 && d < 115 ? (d - 100) / 15 : d > 158 && d <= 175 ? (175 - d) / 17 : 0;

  // ── daily rows: [yymmdd, hs, dir, per, e_all, e_day, ea_all, s_all, s_day, wdir, wspd, clean%, mh_all, mh_day]
  const D = DATA.daily.map(r => ({
    y: 2000 + +r[0].slice(0, 2), m: +r[0].slice(2, 4), d: +r[0].slice(4, 6), hs: r[1], dir: r[2], per: r[3],
    e: [r[4], r[5]], ea: r[6], s: [r[7], r[8]], wdir: r[9], wspd: r[10], clean: r[11], mh: [r[12], r[13]] }));
  D.forEach(x => {
    x.doy = Math.floor((Date.UTC(x.y, x.m - 1, x.d) - Date.UTC(x.y, 0, 1)) / 864e5); x.key = Date.UTC(x.y, x.m - 1, x.d);
    x.iso = `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
  });
  const byIso = new Map(D.map((x, i) => [x.iso, i]));

  // period colors: short period cool, long period warm
  const stops = [[79, 182, 201], [216, 209, 122], [240, 138, 75]];
  function perRGB(p) {
    const t = Math.max(0, Math.min(1, (p - 5) / 11)) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
    return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  }
  const perColor = (p, a) => { const c = perRGB(p); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  // wave-height colors (ft), the same on every map: most of the change is in surfable sizes, and
  // the scale carries on up to ocean storms
  const HST = [[0, [16, 42, 74]], [1, [30, 100, 160]], [2, [40, 170, 165]], [3.5, [120, 200, 100]], [5, [240, 210, 100]],
               [8, [240, 138, 75]], [13, [224, 71, 90]], [20, [176, 79, 201]], [28, [214, 128, 214]]];
  function hCol(ft) {
    let k = 0; while (k < HST.length - 2 && ft > HST[k + 1][0]) k++;
    const [a, ca] = HST[k], [b, cb] = HST[k + 1], f = Math.max(0, Math.min(1, (ft - a) / (b - a)));
    return ca.map((v, j) => Math.round(v + (cb[j] - v) * f));
  }

  // ── shared state: the day picked anywhere on the page (map, calendar, date pickers) and whether
  // counts use all hours or daylight only
  const st = { daylight: 0, playing: false, idx: 0 };
  const listeners = [], dayListeners = [];
  function jump(i) {
    st.idx = Math.max(0, Math.min(D.length - 1, i));
    dayListeners.forEach(f => f(st.idx));
  }
  // sunrise and sunset at Choc for the UTC day of ms (NOAA's short formula, +-2 min); "daylight" starts
  // half an hour after sunrise and ends half an hour before sunset, when there is light to surf
  const D2R = Math.PI / 180, SUN = [-71.96339, 41.27557];
  function sunWin(ms) {
    const d = new Date(ms), day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), N = Math.round((day0 - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
    const dec = 23.44 * D2R * Math.sin(2 * Math.PI * (284 + N) / 365), B = 2 * Math.PI * (N - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const phi = SUN[1] * D2R, h0 = Math.acos(Math.max(-1, Math.min(1, (Math.sin(-0.833 * D2R) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))))) / D2R;
    const noon = 720 - 4 * SUN[0] - eot;
    return [day0 + (noon - 4 * h0) * 6e4, day0 + (noon + 4 * h0) * 6e4];
  }
  // a small arrow pointing where the wind is blowing to (wind "from WNW" points ESE), for any wind text
  const windArrow = (from) => (from == null || isNaN(from) ? '' : `<svg class="warr" viewBox="0 0 12 12" aria-hidden="true" style="transform:rotate(${Math.round((+from + 180) % 360)}deg)"><path d="M6 1 L9.6 10 L6 8 L2.4 10 Z" fill="currentColor"/></svg>`);
  const daylight = (ms) => { const [a, b] = sunWin(ms); return ms >= a + 18e5 && ms <= b - 18e5; };
  window.CHOC = { st, D, MON, C, css, perColor, wSoft, BIG_E, OFF, HST, hCol, sunWin, daylight, windArrow,
    onChange: f => listeners.push(f), onDay: f => dayListeners.push(f), jump,
    dayIndex: iso => (byIso.has(iso) ? byIso.get(iso) : -1),
    setDaylight: v => { st.daylight = v ? 1 : 0; listeners.forEach(f => f(st)); } };

  // ── the ray model across the sound: K per (period, direction) from kfull/T_D.png at 144 m (single
  //    direction, so the refraction streaks show), kgrid.png at 288 m with a directional spread
  //    (used while those load). Covers the survey map (TILEMAN.world).
  const WM = TILEMAN.world;
  const RG = RAY2, R2 = RG.R2, C2 = RG.C2, NC = R2 * C2, RF = RG.R, CF = RG.C, NF = RF * CF, CELL = RG.cell_km;
  let KG = null, DEPTH = null, NEAREST = null, started = null;
  const updates = [];
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = src; });
  // Every image the page reads pixels from goes through this one scratch canvas, shrunk back to 1x1 after
  // each read. iPhone and iPad Safari cap the memory all of a page's canvases hold together (about 224 MB on
  // an iPhone); a fresh canvas per image (about 70 sea-floor images, plus the forecast strips) went over it,
  // after which new canvases come back with no drawing context and the map drew only its dark background.
  const SCRATCH = document.createElement('canvas');
  window.CHOC.pixels = function (img) {
    const c = SCRATCH; c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data; c.width = 1; c.height = 1; return d;
  };
  const pixels = window.CHOC.pixels;
  async function setupModel() {
    const [kimg, dimg] = await Promise.all([loadImg('kgrid.png'), loadImg('depth144.png')]);
    const p = pixels(kimg), W = kimg.width;
    KG = RG.pers.map((_, ti) => RG.dirs.map((_, di) => {
      const t = new Uint8Array(NC);
      for (let r = 0; r < R2; r++) { const row = ((ti * R2 + r) * W + di * C2) * 4; for (let c = 0; c < C2; c++) t[r * C2 + c] = p[row + c * 4]; }
      return t;
    }));
    const dp = pixels(dimg); DEPTH = new Float32Array(NF);
    for (let i = 0; i < NF; i++) DEPTH[i] = -(((dp[i * 4] << 8) | dp[i * 4 + 1]) / 10 - 1000);
    // every land cell borrows the color of its nearest water cell, so colors run cleanly under the coastline
    NEAREST = new Int32Array(NF).fill(-1); const q = new Int32Array(NF); let qh = 0, qt = 0;
    for (let i = 0; i < NF; i++) if (DEPTH[i] > 0.4) { NEAREST[i] = i; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], r = (i / CF) | 0, c = i - r * CF;
      if (c > 0 && NEAREST[i - 1] < 0) { NEAREST[i - 1] = NEAREST[i]; q[qt++] = i - 1; }
      if (c < CF - 1 && NEAREST[i + 1] < 0) { NEAREST[i + 1] = NEAREST[i]; q[qt++] = i + 1; }
      if (r > 0 && NEAREST[i - CF] < 0) { NEAREST[i - CF] = NEAREST[i]; q[qt++] = i - CF; }
      if (r < RF - 1 && NEAREST[i + CF] < 0) { NEAREST[i + CF] = NEAREST[i]; q[qt++] = i + CF; }
    }
  }
  // full-resolution K, loaded on demand and in the background (most common swells first)
  const KF = new Map(); let kLoading = 0; const kQueue = [];
  // Only the swells on show need full-resolution K: fetch those on demand and keep the 24 used most recently.
  // (All 68 used to be fetched as soon as the model started, about 200 MB of decoding on top of the page.)
  const KF_KEEP = 24;
  function kfGet(T, Dd) {
    const key = T + '_' + Dd, v = KF.get(key);
    if (v instanceof Uint8Array) { KF.delete(key); KF.set(key, v); return v; }   // most recently used goes to the back
    if (v === undefined) { KF.set(key, 'q'); kQueue.unshift(key); pumpK(); }
    return null;
  }
  function pumpK() {
    while (kLoading < 3 && kQueue.length) {
      const key = kQueue.shift(); if (KF.get(key) !== 'q') continue;
      KF.set(key, 'loading'); kLoading++;
      loadImg(`kfull/${key}.png`).then(img => {
        const p = pixels(img), a = new Uint8Array(NF); for (let i = 0; i < NF; i++) a[i] = p[i * 4];
        KF.set(key, a);
        const have = [...KF].filter(([, x]) => x instanceof Uint8Array);
        for (const [k] of have.slice(0, Math.max(0, have.length - KF_KEEP))) KF.delete(k);
        fieldKey = ''; updates.forEach(f => f());
      }).catch(() => KF.set(key, 'fail')).finally(() => { kLoading--; pumpK(); });
    }
  }
  const SPREAD_S = 10;
  const kcache = new Map();
  function keff(dir, per) {   // energy-weighted K over a cos^2s directional spread, interpolated in period
    const dq = Math.round(dir), pq = Math.round(per * 4) / 4, key = dq + '|' + pq;
    if (kcache.has(key)) return kcache.get(key);
    const P = RG.pers; let ti = 0; const pc = Math.max(P[0], Math.min(P[P.length - 1], pq));
    while (ti < P.length - 2 && pc > P[ti + 1]) ti++;
    const ft = (pc - P[ti]) / (P[ti + 1] - P[ti]);
    let norm = 0; for (let d = 0; d < 360; d += 10) norm += Math.pow(Math.cos((d - dq) * Math.PI / 360), 2 * SPREAD_S);
    const out = new Float32Array(NC);
    RG.dirs.forEach((Dd, di) => {
      const w = Math.pow(Math.abs(Math.cos((Dd - dq) * Math.PI / 360)), 2 * SPREAD_S) / norm;
      if (w < 0.004) return;
      const a = KG[ti][di], b = KG[ti + 1][di], wa = w * (1 - ft) / 1e4, wb = w * ft / 1e4;
      for (let i = 0; i < NC; i++) out[i] += wa * a[i] * a[i] + wb * b[i] * b[i];
    });
    for (let i = 0; i < NC; i++) out[i] = Math.sqrt(out[i]);
    if (kcache.size > 24) kcache.delete(kcache.keys().next().value);
    kcache.set(key, out); return out;
  }
  // height (ft) everywhere on the survey map for one or more swell trains [{ft, T, D}] given at the
  // buoy; trains add as energy. Depth-limited: no wave taller than 0.78 x the depth.
  const fieldCv = document.createElement('canvas'); fieldCv.width = CF; fieldCv.height = RF;
  const fieldCtx = fieldCv.getContext('2d'), fieldImg = fieldCtx.createImageData(CF, RF), field32 = new Uint32Array(fieldImg.data.buffer);
  const HFT = new Float32Array(NF), E2 = new Float32Array(NF);
  const LUT = new Uint32Array(512);
  for (let i = 0; i < 512; i++) { const c = hCol(i / 511 * 20); LUT[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; }
  let fieldKey = '', fieldDone = false;
  function addTrain(hs, dir, per) {
    const P = RG.pers, Ds = RG.dirs;
    // swell from outside the modeled directions (60-220 deg) fades out instead of being clamped
    const dIn = Math.max(Ds[0], Math.min(Ds[Ds.length - 1], dir)), fade = Math.max(0, 1 - Math.abs(dir - dIn) / 25);
    const H = hs * fade; if (H <= 0.01) return true;
    let di = 0; while (di < Ds.length - 2 && dIn > Ds[di + 1]) di++;
    const fd = (dIn - Ds[di]) / (Ds[di + 1] - Ds[di]);
    const pc = Math.max(P[0], Math.min(P[P.length - 1], per)); let ti = 0; while (ti < P.length - 2 && pc > P[ti + 1]) ti++;
    const ft = (pc - P[ti]) / (P[ti + 1] - P[ti]);
    const corners = [[ti, di, (1 - ft) * (1 - fd)], [ti, di + 1, (1 - ft) * fd], [ti + 1, di, ft * (1 - fd)], [ti + 1, di + 1, ft * fd]]
      .map(([a, b, w]) => ({ k: kfGet(P[a], Ds[b]), w })).filter(o => o.w > 1e-4);
    const have = corners.filter(o => o.k), wsum = have.reduce((a, o) => a + o.w, 0);
    if (wsum < 0.5) {   // full-resolution fields not here yet: the coarse, spread fields
      const K2 = keff(dir, per);
      for (let i = 0; i < NF; i++) { const j = NEAREST[i] < 0 ? i : NEAREST[i], r = (j / CF) | 0, c = j - r * CF, h = H * K2[Math.min(R2 - 1, r >> 1) * C2 + Math.min(C2 - 1, c >> 1)]; E2[i] += h * h; }
    } else {
      const ks = have.map(o => o.k), ws = have.map(o => o.w / wsum / 100), n = ks.length;
      for (let i = 0; i < NF; i++) { const j = NEAREST[i] < 0 ? i : NEAREST[i]; let k = 0; for (let m = 0; m < n; m++) k += ks[m][j] * ws[m]; const h = H * k; E2[i] += h * h; }
    }
    return wsum >= 0.999;
  }
  function field(trains) {
    if (!KG) return null;
    const key = trains.map(t => [Math.round(t.ft * 8) / 8, Math.round(t.D / 2) * 2, Math.round(t.T * 4) / 4].join()).join('|');
    if (key === fieldKey) return { cv: fieldCv, complete: fieldDone };
    E2.fill(0); let done = true;
    for (const t of trains) if (t.ft > 0.05) done = addTrain(Math.round(t.ft * 8) / 8, Math.round(t.D / 2) * 2, Math.round(t.T * 4) / 4) && done;
    for (let i = 0; i < NF; i++) {
      const j = NEAREST[i] < 0 ? i : NEAREST[i]; let h = Math.sqrt(E2[i]); const brk = 2.56 * DEPTH[j]; if (h > brk) h = brk;
      HFT[i] = DEPTH[i] > 0.4 ? h : -1; field32[i] = LUT[Math.min(511, (h / 20 * 511) | 0)];
    }
    fieldCtx.putImageData(fieldImg, 0, 0);
    fieldKey = key; fieldDone = done;
    return { cv: fieldCv, complete: done };
  }
  function heightAt(lon, lat) {                              // modeled height (ft) and depth (m) at a point, or null off the map
    if (!DEPTH) return null;
    const c = Math.floor((lon - WM.left) * WM.kmlon / CELL), r = Math.floor((WM.top - lat) * WM.kmlat / CELL);
    if (c < 0 || r < 0 || c >= CF || r >= RF) return null;
    return { h: HFT[r * CF + c], depth: DEPTH[r * CF + c] };
  }

  // ── wind: 17 over-water ECMWF points (ERA5 for 2016), one vector per day
  const WG = WIND, W0 = Date.UTC(2016, 0, 1);
  function windPts(i) {                                      // [{lon, lat, kn, from}] for day i
    const x = D[i]; if (!x) return [];
    const k = Math.round((x.key - W0) / 864e5);
    return WG.pts.map(p => {
      const a = p.uv[k] || WG.base[k] || [0, 0], u = -(a[0] / 2), v = a[1] / 2;     // toward-vector, knots (x east, y south)
      return { lon: p.lon, lat: p.lat, kn: Math.hypot(u, v), from: (Math.atan2(u, -v) * 180 / Math.PI + 180 + 360) % 360 };
    });
  }

  window.CHOC.model = {
    bounds: [WM.left, WM.right, WM.bottom, WM.top],
    init: () => started || (started = setupModel().catch(e => { console.error(e); started = null; throw e; })),
    ready: () => !!KG, field, heightAt, windPts, onUpdate: f => updates.push(f),
  };
})();
