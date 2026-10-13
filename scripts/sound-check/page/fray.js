(function () {
  'use strict';
  // ── Part 1: forward rays. A line of rays 20 m apart enters the map where the swell crosses the
  // open-ocean edge, bends over the sea floor, and we count how many land in each spot's zone.
  const { C, css } = window.CHOC;
  const M = FRMETA, TAB = FRTAB, SP = 20, rad = Math.PI / 180;
  const WKM = (M.world[1] - M.world[0]) * M.kmlon, HKM = (M.world[3] - M.world[2]) * M.kmlat;
  const ZONE = { choc: { name: 'Choc', col: [255, 196, 140] }, wild: { name: 'Wilderness', col: [130, 226, 240] } };
  // landing-zone radius for a period (widens with wavelength; see the caption)
  const reff = (T, spot) => M.reff[T][spot === 'choc' ? 0 : 1];
  const CHOC = M.choc, W1 = M.w1, W2 = M.w2;          // km from the world's top-left
  // open-water width of each zone, measured square to the swell (the capsule's width depends on direction)
  function zoneWidth(spot, D, T) {
    const r = reff(T, spot);
    if (spot === 'choc') return 2 * r;
    const b = (D + 180) * rad, tx = Math.sin(b), ty = -Math.cos(b), vx = W2[0] - W1[0], vy = W2[1] - W1[1];
    return Math.abs(vx * ty - vy * tx) * 1000 + 2 * r;
  }
  // linear wave group speed (m/s) at depth h for period T
  function cg(T, h) {
    const L = window.CHOC.waveL(T, h);                 // exact, see v13_lab
    const k = 2 * Math.PI / L, kh = Math.min(20, k * h); return 0.5 * (1 + 2 * kh / Math.sinh(2 * kh)) * L / T;
  }
  const S = 15;                                        // directional spread cos^2s: about +-10 degrees
  function spreadBins(D) { const out = []; for (let d = D - 10; d <= D + 10; d += 5) { const w = Math.pow(Math.cos((d - D) * rad / 2), 2 * S); out.push([d, w]); } const t = out.reduce((a, b) => a + b[1], 0); return out.map(([d, w]) => [d, w / t]); }
  function stats(T, D) {
    const r = {};
    for (const spot of ['choc', 'wild']) {
      let cnt = 0, base = 0, pl = 0, pw = 0;
      for (const [d, w] of spreadBins(D)) {
        const row = TAB[T] && TAB[T][d]; if (!row) continue;
        const c = row[spot === 'choc' ? 0 : 1], p = row[spot === 'choc' ? 2 : 3];
        cnt += w * c; base += w * zoneWidth(spot, d, T) / SP;
        if (p != null && c > 0) { pl += w * c * p; pw += w * c; }
      }
      // both spots measured at the same depth (4 m), so neither gets a boost from shallower water
      const shoal = cg(T, 48) / cg(T, M.depth), ratio = base ? cnt / base : 0;
      r[spot] = { cnt, base, ratio, shoal, k: Math.sqrt(ratio * shoal), peel: pw > 0 ? pl / pw : null };
    }
    return r;
  }
  window.CHOC.fwd = { stats, zoneWidth };

  // ray pictures, one file per period, loaded when needed
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const files = new Map();
  function getT(T) {
    if (!files.has(T)) { files.set(T, null); fetch(`fr/${T}.json`).then(r => r.json()).then(j => { files.set(T, j); redraw(); if (window.CHOC.onRays) window.CHOC.onRays(); }).catch(() => files.delete(T)); }
    return files.get(T);
  }
  window.CHOC.fwd.rays = (T, D) => { const f = getT(T); return f && f[D] ? f[D] : null; };

  // ── figure
  const cvW = document.getElementById('frWorld'), cvC = document.getElementById('frClose');
  const xW = cvW.getContext('2d'), xC = cvC.getContext('2d');
  const dirIn = document.getElementById('frDir'), perIn = document.getElementById('frPer');
  const imgW = new Image(), imgC = new Image();
  imgW.onload = imgC.onload = () => redraw(); imgW.src = 'fr_world.jpg'; imgC.src = 'fr_close.jpg';
  let dpr = 1, cur = null, dash = 0;
  function sizeCv(cv, aspect) { dpr = Math.min(2, devicePixelRatio || 1); const w = cv.clientWidth, h = w * aspect; cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); return [w, h]; }
  let WW = 0, WH = 0, CW = 0, CH = 0;
  const CL = M.close;                                  // close-up extent in km
  function size() { [WW, WH] = sizeCv(cvW, HKM / WKM); [CW, CH] = sizeCv(cvC, (CL.y1 - CL.y0) / (CL.x1 - CL.x0)); }
  function compass(d) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }

  function drawRays(g, f, D, tr, close) {
    // context: the central direction's evenly spaced rays, faint
    const mid = f[D]; if (!mid) return;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const path = p => { g.beginPath(); for (let i = 0; i < p.length; i += 2) { const [x, y] = tr(p[i] / 100, p[i + 1] / 100); i ? g.lineTo(x, y) : g.moveTo(x, y); } };
    g.strokeStyle = close ? 'rgba(225,235,245,0.22)' : 'rgba(225,235,245,0.2)'; g.lineWidth = close ? 1 : 0.7;
    for (const r of mid.rays) if (!r.h) { path(r.p); g.stroke(); }
    // rays that land, from the neighboring directions too (real swell is spread out), by weight
    for (const spot of ['wild', 'choc']) {
      const c = ZONE[spot].col;
      for (const [d, w] of spreadBins(D)) {
        const b = f[d]; if (!b) continue;
        for (const r of b.rays) if (r.h.includes(spot[0])) {
          path(r.p);
          g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.25 + 1.6 * w).toFixed(2)})`; g.lineWidth = (close ? 1.6 : 1.1) + 2 * w; g.setLineDash([]); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = (close ? 1.2 : 0.9); g.setLineDash([3, 16]); g.lineDashOffset = -dash; g.stroke(); g.setLineDash([]);
        }
      }
    }
  }
  function drawZones(g, tr, s, T) {
    const [cx, cy] = tr(CHOC[0], CHOC[1]), c = ZONE.choc.col, w = ZONE.wild.col;
    // the landing zone for this period (dashed), and the pin
    g.lineWidth = 1.5; g.strokeStyle = `rgba(${c},0.9)`; g.fillStyle = `rgba(${c},0.12)`; g.setLineDash([4, 3]);
    g.beginPath(); g.arc(cx, cy, Math.max(3, reff(T, 'choc') / 1000 * s), 0, 7); g.fill(); g.stroke(); g.setLineDash([]);
    g.fillStyle = `rgb(${c})`; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
    const [ax, ay] = tr(W1[0], W1[1]), [bx, by] = tr(W2[0], W2[1]);
    g.strokeStyle = `rgba(${w},0.22)`; g.lineWidth = Math.max(5, 2 * reff(T, 'wild') / 1000 * s); g.lineCap = 'round'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    g.strokeStyle = `rgb(${w})`; g.lineWidth = 2.5; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  function label(g, t, x, y, al, col) { g.font = `600 12px ${css('--body')}`; g.textAlign = al; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 4; g.fillStyle = col || '#e7edf2'; g.fillText(t, x, y); g.shadowBlur = 0; }

  function redraw() {
    if (!WW) return;
    const T = +perIn.value, D = +dirIn.value, f = getT(T);
    // whole map
    xW.setTransform(dpr, 0, 0, dpr, 0, 0); xW.fillStyle = C.ink; xW.fillRect(0, 0, WW, WH);
    if (imgW.complete && imgW.naturalWidth) xW.drawImage(imgW, 0, 0, WW, WH);
    const sW = WW / WKM, trW = (x, y) => [x * sW, y * sW];
    // where the swell comes in: the open edges it crosses, and an arrow
    const b = (D + 180) * rad, tx = Math.sin(b), ty = -Math.cos(b);
    xW.strokeStyle = 'rgba(240,138,75,0.9)'; xW.lineWidth = 4;
    if (ty < -0.05) { xW.beginPath(); xW.moveTo(0, WH - 2); xW.lineTo(WW, WH - 2); xW.stroke(); }
    if (tx < -0.05) { xW.beginPath(); xW.moveTo(WW - 2, WH * 0.35); xW.lineTo(WW - 2, WH); xW.stroke(); }
    if (tx > 0.05) { xW.beginPath(); xW.moveTo(2, WH * 0.62); xW.lineTo(2, WH); xW.stroke(); }
    if (f) drawRays(xW, f, D, trW, false); else label(xW, 'Loading rays…', WW / 2, WH / 2, 'center');
    drawZones(xW, trW, sW, T);
    // close-up frame on the whole map
    const [qx, qy] = trW(CL.x0, CL.y0), [qx2, qy2] = trW(CL.x1, CL.y1);
    xW.strokeStyle = 'rgba(255,255,255,0.7)'; xW.lineWidth = 1; xW.setLineDash([4, 4]); xW.strokeRect(qx, qy, qx2 - qx, qy2 - qy); xW.setLineDash([]);
    // swell arrow
    const ax = WW * 0.84, ay = WH * 0.16, L = 30;
    xW.strokeStyle = '#e7edf2'; xW.fillStyle = '#e7edf2'; xW.lineWidth = 2.5; xW.beginPath(); xW.moveTo(ax - tx * L, ay - ty * L); xW.lineTo(ax + tx * L * 0.6, ay + ty * L * 0.6); xW.stroke();
    xW.beginPath(); const hx = ax + tx * L * 0.6, hy = ay + ty * L * 0.6; xW.moveTo(hx + tx * 8, hy + ty * 8); xW.lineTo(hx - ty * 6, hy + tx * 6); xW.lineTo(hx + ty * 6, hy - tx * 6); xW.fill();
    { const t = `swell from ${compass(D)} (${D}°)`; xW.font = `600 12px ${css('--body')}`; const tw = xW.measureText(t).width;
      const lx = Math.max(tw / 2 + 12, Math.min(WW - tw / 2 - 12, ax));
      xW.fillStyle = 'rgba(10,15,21,0.85)'; xW.beginPath(); xW.roundRect ? xW.roundRect(lx - tw / 2 - 8, ay + 34, tw + 16, 22, 11) : xW.rect(lx - tw / 2 - 8, ay + 34, tw + 16, 22); xW.fill();
      label(xW, t, lx, ay + 45, 'center'); }
    // close-up
    xC.setTransform(dpr, 0, 0, dpr, 0, 0); xC.fillStyle = C.ink; xC.fillRect(0, 0, CW, CH);
    if (imgC.complete && imgC.naturalWidth) xC.drawImage(imgC, 0, 0, CW, CH);
    const sC = CW / (CL.x1 - CL.x0), trC = (x, y) => [(x - CL.x0) * sC, (y - CL.y0) * sC];
    xC.save(); xC.beginPath(); xC.rect(0, 0, CW, CH); xC.clip();
    if (f) drawRays(xC, f, D, trC, true);
    drawZones(xC, trC, sC, T);
    xC.restore();
    const [lx, ly] = trC(CHOC[0], CHOC[1]); label(xC, 'CHOC', lx + 14, ly - 14, 'left', `rgb(${ZONE.choc.col})`);
    const [wx, wy] = trC((W1[0] + W2[0]) / 2, (W1[1] + W2[1]) / 2); label(xC, 'WILDERNESS', wx - 6, wy + 22, 'right', `rgb(${ZONE.wild.col})`);
    numbers(T, D);
  }
  const out = document.getElementById('frOut');
  let lastNum = '';
  function numbers(T, D) {
    const key = T + '|' + D; if (key === lastNum) return; lastNum = key;
    const st = stats(T, D);
    const card = spot => {
      const s = st[spot], z = ZONE[spot], pct = Math.round(s.k * 100);
      const p = s.peel, shape = p == null || s.cnt < 0.5 ? ['—', 'too few rays land to judge'] :
        p >= 0.5 ? ['peels', `${Math.round(p * 100)}% meet the bottom at 30°+, so it should peel`] :
        p >= 0.25 ? ['mixed', `${Math.round(p * 100)}% meet the bottom at 30°+: some peel, some close out`] :
        ['closes out', `only ${Math.round(p * 100)}% meet the bottom at 30°+: mostly square-on, so it tends to close out`];
      return `<div class="fr-card" style="--zc: rgb(${z.col})"><div class="fr-n">${z.name}</div>
        <div class="fr-row"><div><div class="fr-k">Size</div><div class="fr-big">${pct}%<small> of the buoy's height</small></div></div>
        <div><div class="fr-k">Shape (experimental)</div><div class="fr-big fr-shape">${shape[0]}</div></div></div>
        ${window.CHOC.kv([['Rays', `<b>${s.cnt.toFixed(0)}</b> land in the zone, against <b>${s.base.toFixed(0)}</b> in open water: <b>${s.ratio.toFixed(2)}×</b> the energy`],
          ['Height', `√${s.ratio.toFixed(2)} = ${Math.sqrt(s.ratio).toFixed(2)}, × ${Math.sqrt(s.shoal).toFixed(2)} as it slows to 4 m deep = <b>${pct}%</b>`],
          ['Example', `4 ft at the buoy → <b>${(4 * s.k).toFixed(1)} ft</b>`], ['Shape', shape[1]]], 'fr-kv')}
        <div class="fr-l">Shape is experimental: it can't yet see swell wrapping around a point (see Wilderness).</div></div>`;
    };
    out.innerHTML = card('choc') + card('wild');
    document.getElementById('frDirV').textContent = `${D}° ${compass(D)}`; document.getElementById('frPerV').textContent = `${T} s`;
  }
  const note = document.getElementById('frNote');
  dirIn.addEventListener('input', () => { note.textContent = ''; redraw(); }); perIn.addEventListener('input', () => { note.textContent = ''; redraw(); });
  // another part of the page hands over a swell (a forecast hour, a remembered day): snap to the nearest picture
  window.CHOC.frSet = (dir, per, label) => {
    dirIn.value = Math.max(60, Math.min(220, Math.round(dir / 5) * 5)); perIn.value = Math.max(6, Math.min(16, Math.round(per / 2) * 2));
    note.textContent = label ? `Showing ${label}: swell from ${Math.round(dir)}° at ${per.toFixed(0)} s (nearest picture: ${dirIn.value}°, ${perIn.value} s)` : '';
    redraw(); document.getElementById('how-h').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };
  // the moving dashes on the rays that land
  let onScreen = true, last = 0;
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); }).observe(cvW.closest('figure'));
  function tick(t) { if (onScreen && !reduce && t - last > 50) { dash = (dash + 1.2) % 19; last = t; redraw(); } requestAnimationFrame(tick); }
  addEventListener('resize', () => { size(); redraw(); });
  addEventListener('lcc-theme-change', redraw);
  size(); redraw(); requestAnimationFrame(tick);
})();
