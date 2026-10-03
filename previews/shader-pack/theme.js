// ════════════════════════════════════════════════════════════════════
// SHADER PACK — overlay prototype (theme.js)
// ────────────────────────────────────────────────────────────────────
// "Same world, better light." Loaded as a classic script right after
// kiosk.js, so every app.js / kiosk.js function declaration is already a
// writable global — exactly the hook kiosk.js itself uses. Nothing here
// fetches, stores or computes forecast data of its own: it re-reads
// STATE, calls the app's own helpers (kioskDaySummary, _alignmentScore,
// calcDaylight, buildForecastConditions, predict*Rating …) and changes
// how the result is lit, ordered and drawn.
//
// Web (body.sp-web): one Win98 window on the teal desktop, an hour card
//   that every panel follows, a "This week at Choc" strip built from
//   kioskDaySummary, a lineup scene graded to the hour's sun, charts
//   that plot what reaches the reef, a status bar for freshness, and a
//   dark Win98 colour scheme after last light.
// Choc TV (body.sp-tv): ghost segments, bloom on lit segments only (two
//   strengths), day cards sized in vh, time-aware rows, home-panel
//   rotation, fade-through-black handoffs, and a radar whose sweep runs
//   on the compositor while the scope repaints once per hour step.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TV = typeof isKioskMode === 'function' && isKioskMode();
  const body = document.body;
  body.classList.add('sp', TV ? 'sp-tv' : 'sp-web');
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (REDUCED) body.classList.add('sp-reduced');

  // ── Pixel-art glyphs: 1-bit, on the pixel grid, in the app's palette.
  // They replace the emoji and the symbols the bitmap face cannot draw.
  const px = (w, h, rects, cls) => `<svg class="sp-px ${cls || ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  const R = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${c ? ` fill="${c}"` : ''}/>`;
  const TRI_L = px(7, 7, R(4, 0, 1, 7) + R(3, 1, 1, 5) + R(2, 2, 1, 3) + R(1, 3, 1, 1));
  const TRI_R = px(7, 7, R(2, 0, 1, 7) + R(3, 1, 1, 5) + R(4, 2, 1, 3) + R(5, 3, 1, 1));
  const TRI_U_S = px(7, 4, R(3, 0, 1, 1) + R(2, 1, 3, 1) + R(1, 2, 5, 1) + R(0, 3, 7, 1), 'sp-px-s');
  const TRI_D_S = px(7, 4, R(0, 0, 7, 1) + R(1, 1, 5, 1) + R(2, 2, 3, 1) + R(3, 3, 1, 1), 'sp-px-s');
  const X_SVG = px(8, 7, R(0, 0, 2, 1) + R(6, 0, 2, 1) + R(1, 1, 2, 1) + R(5, 1, 2, 1) + R(2, 2, 4, 1) + R(3, 3, 2, 1) + R(2, 4, 4, 1) + R(1, 5, 2, 1) + R(5, 5, 2, 1) + R(0, 6, 2, 1) + R(6, 6, 2, 1));
  // 16×16 anchor, drawn at 2× (32 px) like a Win95 dialog icon.
  const ANCHOR_SVG = `<span class="gate-icon sp-anchor">` + px(16, 16,
    R(6, 0, 4, 1, '#000080') + R(5, 1, 1, 2, '#000080') + R(10, 1, 1, 2, '#000080') + R(6, 3, 4, 1, '#000080') + R(6, 1, 1, 1, '#1084d0') +
    R(3, 4, 10, 2, '#000080') + R(3, 4, 10, 1, '#1084d0') + R(7, 6, 2, 7, '#000080') + R(8, 6, 1, 7, '#1084d0') +
    R(1, 8, 2, 1, '#000080') + R(13, 8, 2, 1, '#000080') + R(2, 9, 2, 2, '#000080') + R(12, 9, 2, 2, '#000080') +
    R(3, 11, 2, 1, '#000080') + R(11, 11, 2, 1, '#000080') + R(4, 12, 3, 1, '#000080') + R(9, 12, 3, 1, '#000080') +
    R(6, 13, 4, 1, '#000080') + R(7, 14, 2, 1, '#000080') + R(2, 10, 1, 1, '#1084d0') + R(13, 10, 1, 1, '#1084d0'), 'sp-px-icon') + `</span>`;
  const CAM_SVG = px(14, 11, R(4, 0, 6, 2) + R(0, 2, 14, 9) + R(5, 4, 4, 4, '#fff') + R(6, 5, 2, 2) + R(11, 3, 2, 1, '#fff'), 'sp-px-cam');
  const WAVE_SVG = px(16, 16, R(0, 0, 16, 16, '#000080') + `<path d="M1 10 Q3 6 5 10 T9 10 T13 10 L15 10 L15 13 L1 13 Z" fill="#fff"/>`, 'sp-px-wave');

  // ── Shared helpers ─────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => (typeof escHtml === 'function' ? escHtml(s) : String(s));
  function node(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function clock(t) {
    const d = t instanceof Date ? t : new Date(t);
    const h = d.getHours() % 12 || 12;
    return { hm: h + ':' + String(d.getMinutes()).padStart(2, '0'), ap: d.getHours() >= 12 ? 'PM' : 'AM', h };
  }
  // 14-segment readout with its unlit cells underneath (DSEG14 '~' lights
  // every segment). ':' and '.' are zero-width in DSEG, so they stay as is.
  function ghostOf(text) { return String(text).replace(/[0-9A-Za-z\-]/g, '~').replace(/ /g, '!'); }
  function seg(text, cls) {
    const t = String(text);
    return `<span class="sp-seg ${cls || ''}"><span class="sp-seg-ghost" aria-hidden="true">${ghostOf(t)}</span><span class="sp-seg-lit">${t}</span></span>`;
  }
  // Degree ring drawn in CSS: the bitmap face has no '°'.
  const DEG = '<i class="sp-deg" aria-label="degrees"></i>';
  function sun(date) {
    return calcDaylight(CONFIG.chocomount.lat, CONFIG.chocomount.lon, date) || {};
  }
  // Light phase of an instant at Choc, from the app's own NOAA sun maths.
  function phaseAt(ms) {
    const dl = sun(new Date(ms));
    if (!dl.sunrise) return 'day';
    const fl = dl.firstLight.getTime(), sr = dl.sunrise.getTime();
    const ss = dl.sunset.getTime(), ll = dl.lastLight.getTime();
    if (ms < fl || ms > ll) return 'night';
    if (ms < sr) return 'dawn';
    if (ms < sr + 50 * 60e3) return 'sunrise';
    if (ms > ss) return 'dusk';
    if (ms > ss - 70 * 60e3) return 'golden';
    return 'day';
  }
  function isDaylight(ms) { const p = phaseAt(ms); return p !== 'night' && p !== 'dusk' && p !== 'dawn'; }
  // Same buckets as the chart's wind colouring (offshore = from 335° ±60°),
  // light winds (<5 mph) upgraded one tier.
  function windQual(dir, spd) {
    if (dir == null) return null;
    const gap = Math.min(((dir - 335) % 360 + 360) % 360, ((335 - dir) % 360 + 360) % 360);
    let b = gap < 60 ? 'off' : gap < 120 ? 'cross' : 'on';
    if (spd != null && spd < 5) b = b === 'cross' ? 'off' : b === 'on' ? 'cross' : b;
    return b;
  }
  const WQ = { off: 'offshore', cross: 'cross-shore', on: 'onshore' };
  const WIN = { 'dir-in': 'IN WINDOW', 'dir-edge': 'EDGE', 'dir-out': 'OUT' };

  // The filled direction glyph Choc TV uses (kioskArrowHTML), reading
  // printed upright on it.
  function arrowGlyph(fromDeg, label, cls) {
    if (fromDeg == null) return '';
    const travel = Math.round((fromDeg + 180) % 360);
    return `<span class="sp-arrow ${cls || ''}"><svg viewBox="0 0 100 140" style="transform:rotate(${travel}deg)" aria-hidden="true">` +
      `<path d="M50 2 L98 62 L74 62 L74 138 L26 138 L26 62 L2 62 Z"/></svg>` +
      (label ? `<span class="sp-arrow-lbl">${label}</span>` : '') + `</span>`;
  }
  // Wind heading dial (the owner's option C), rim pointer = where it blows.
  function dial(fromDeg, inner, cls) {
    const travel = fromDeg != null ? Math.round((fromDeg + 180) % 360) : null;
    let ticks = '';
    for (let a = 0; a < 360; a += 45) ticks += `<line transform="rotate(${a} 50 50)" x1="50" y1="7" x2="50" y2="13"/>`;
    return `<span class="sp-dial ${cls || ''}"><svg viewBox="0 0 100 100" aria-hidden="true">` +
      `<circle cx="50" cy="50" r="43" class="sp-dial-ring"/><g class="sp-dial-ticks">${ticks}</g>` +
      (travel != null ? `<path class="sp-dial-ptr" transform="rotate(${travel} 50 50)" d="M50 0 L60 20 L40 20 Z"/>` : '') +
      `</svg><span class="sp-dial-in">${inner}</span></span>`;
  }

  // ── Hour model: one object every panel reads ───────────────────────
  // The train that reaches the reef this hour = whichever of the model's
  // two swell trains carries more in-window energy (Σ alignment·H²), the
  // hourly twin of kioskDaySummary's per-day choice.
  function hourAt(idx) {
    const cs = STATE.forecastChart, fd = STATE.forecastData;
    if (!cs || !fd || !fd.marine || idx < 0 || idx >= cs.times.length) return null;
    const mh = fd.marine.hourly;
    const t = cs.times[idx];
    const sP = (mh.secondary_swell_wave_period || [])[idx];
    const pri = { h: cs.heights[idx], p: cs.wavePeriods[idx], d: cs.swellDirs[idx] };
    const sec = { h: cs.secHeights[idx], p: sP, d: cs.secDirs[idx] };
    const e = s => (s.h != null ? _alignmentScore(s.d) * s.h * s.h : 0);
    let lead = pri, other = sec;
    if (STATE.isChocomount && sec.h != null && e(sec) > e(pri)) { lead = sec; other = pri; }
    lead.cls = swellDirClass(lead.d) || 'dir-in';
    other.cls = swellDirClass(other.d) || '';
    const reefH = Math.sqrt(Math.pow(_alignmentScore(pri.d) * (pri.h || 0), 2) + Math.pow(_alignmentScore(sec.d) * (sec.h || 0), 2));
    // Tide at t, its trend, and the next turn.
    let tide = null;
    const tp = cs.tidePred || fd.tidePred;
    if (tp && tp.length > 1) {
      const at = ms => {
        for (let i = 0; i < tp.length - 1; i++) {
          const a = new Date(tp[i].t).getTime(), b = new Date(tp[i + 1].t).getTime();
          if (ms >= a && ms <= b) {
            const va = parseFloat(tp[i].v), vb = parseFloat(tp[i + 1].v);
            if (!Number.isFinite(va) || !Number.isFinite(vb)) return null;
            return va + (vb - va) * ((ms - a) / (b - a || 1));
          }
        }
        return null;
      };
      const v = at(t.getTime());
      const v2 = at(t.getTime() + 20 * 60e3), v0 = at(t.getTime() - 20 * 60e3);
      if (v != null) {
        const ev = (cs.tideHiLo || fd.tideHiLo || []).map(p => ({ t: new Date(p.t).getTime(), type: p.type, v: parseFloat(p.v) }))
          .filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
        const next = ev.find(p => p.t > t.getTime());
        const nextLow = ev.find(p => p.type === 'L' && p.t > t.getTime());
        tide = { v, rising: (v2 != null && v0 != null) ? v2 > v0 : null, next, nextLow };
      }
    }
    const ws = cs.windSpeeds[idx], wd = cs.windDirs[idx], wg = cs.windGusts[idx];
    const wind = ws != null ? { mph: ws, gust: wg, dir: wd, q: windQual(wd, ws) } : null;
    // "Your model" for this hour, only when it is trained.
    let model = null;
    if (STATE.surfLogWaveWeights && typeof buildForecastConditions === 'function') {
      try {
        const cond = buildForecastConditions(fd.marine, fd.wind, fd.tideHiLo, fd.tidePred, idx);
        if (cond) {
          model = {
            size: predictWaveRating(extractWaveFeatures(cond)),
            ride: predictRideRating(extractRideFeatures(cond)),
            wind: predictCondRating(extractCondFeatures(cond))
          };
          const vals = [model.size, model.ride, model.wind].filter(v => v != null);
          model.avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        }
      } catch (_) { model = null; }
    }
    const nowIdx = findHourIndexForTime(Date.now(), cs);
    return { idx, t, lead, other, reefH, tide, wind, model, isNow: idx === nowIdx, nowIdx };
  }

  // ── Charts: plot what reaches the reef ─────────────────────────
  function inWindowSeries(data) {
    const n = data.heights.length;
    const sp = (STATE.forecastData && STATE.forecastData.marine.hourly.secondary_swell_wave_period) || [];
    const reef = new Array(n), total = new Array(n), leadP = new Array(n), leadIn = new Array(n);
    for (let i = 0; i < n; i++) {
      const h1 = data.heights[i], h2 = data.secHeights[i];
      const a1 = _alignmentScore(data.swellDirs[i]), a2 = _alignmentScore(data.secDirs[i]);
      reef[i] = h1 == null && h2 == null ? null : Math.sqrt(Math.pow(a1 * (h1 || 0), 2) + Math.pow(a2 * (h2 || 0), 2));
      total[i] = h1 == null && h2 == null ? null : Math.sqrt(Math.pow(h1 || 0, 2) + Math.pow(h2 || 0, 2));
      // Period of what reaches the reef: in-window-height-weighted mean
      // of the two trains (smooth, no hour-to-hour flip between trains).
      const p1 = data.wavePeriods[i], p2 = sp[i];
      const w1 = Number.isFinite(p1) ? a1 * (h1 || 0) : 0, w2 = Number.isFinite(p2) ? a2 * (h2 || 0) : 0;
      leadP[i] = w1 + w2 > 0.05 ? (w1 * (p1 || 0) + w2 * (p2 || 0)) / (w1 + w2) : p1;
      leadIn[i] = w1 + w2 > 0.05;
    }
    // Median-of-3 so one hour where the weights cross doesn't spike the line.
    const med = leadP.map((v, i) => {
      const w = [leadP[i - 1], v, leadP[i + 1]].filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
      return w.length ? w[Math.floor(w.length / 2)] : v;
    });
    // Direction of the train that carries the most in-window energy.
    const sd = data.secDirs || [];
    const leadD = data.swellDirs.map((d1, i) => {
      const w1 = _alignmentScore(d1) * (data.heights[i] || 0), w2 = _alignmentScore(sd[i]) * (data.secHeights[i] || 0);
      return w2 > w1 ? { d: sd[i], k: 2 } : { d: d1, k: 1 };
    });
    return { reef, total, leadP: med, leadIn, leadD };
  }
  // Night bands with real twilight: dark from last light to first light,
  // a gradient across civil twilight, a faint warm edge at sunrise/sunset.
  _fcDrawNightShading = function (ctx, common, plotLeft, plotW, top, height) {
    const P = FC_RETRO;
    const x = d => _fcXFor(d instanceof Date ? d : new Date(d), common, plotLeft, plotW);
    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, top, plotW, height); ctx.clip();
    for (let off = -1; off <= common.dayCount; off++) {
      const day = new Date(common.firstDay); day.setDate(day.getDate() + off);
      const dl = sun(day), nx = sun(new Date(day.getTime() + 86400e3 + 3600e3));
      if (!dl.sunset || !nx.sunrise) continue;
      const ll = x(dl.lastLight), ss = x(dl.sunset), fl = x(nx.firstLight), sr = x(nx.sunrise);
      ctx.fillStyle = P.nightShade;
      ctx.fillRect(ll, top, fl - ll, height);
      let g = ctx.createLinearGradient(ss, 0, ll, 0);
      g.addColorStop(0, `rgba(${P.twilight},0)`); g.addColorStop(1, P.nightShade);
      ctx.fillStyle = g; ctx.fillRect(ss, top, ll - ss, height);
      g = ctx.createLinearGradient(fl, 0, sr, 0);
      g.addColorStop(0, P.nightShade); g.addColorStop(1, `rgba(${P.twilight},0)`);
      ctx.fillStyle = g; ctx.fillRect(fl, top, sr - fl, height);
      // A thin warm edge where the sun meets the horizon (dawn patrol).
      const warm = (x0, dir) => {
        const w = 7;
        const gg = ctx.createLinearGradient(x0, 0, x0 + dir * w, 0);
        gg.addColorStop(0, `rgba(${P.dawnGlow},0.16)`); gg.addColorStop(1, `rgba(${P.dawnGlow},0)`);
        ctx.fillStyle = gg; ctx.fillRect(Math.min(x0, x0 + dir * w), top, w, height);
      };
      if (P.dawnGlow && P.warmEdges) { warm(sr, 1); warm(ss, -1); }
    }
    ctx.restore();
  };
  function selectedDayBand(ctx, common, plotLeft, plotW, top, h) {
    const cs = STATE.forecastChart;
    const i = STATE.scrubberIdx;
    if (!cs || !(i >= 0) || !cs.times[i]) return;
    const d = new Date(cs.times[i]); d.setHours(0, 0, 0, 0);
    const e = new Date(d); e.setDate(e.getDate() + 1);
    const a = Math.max(plotLeft, _fcXFor(d, common, plotLeft, plotW)), b = Math.min(plotLeft + plotW, _fcXFor(e, common, plotLeft, plotW));
    ctx.fillStyle = FC_RETRO.selDay;
    ctx.fillRect(a, top, b - a, h);
  }
  function hatch(ctx, color, gap) {
    const c = document.createElement('canvas');
    c.width = c.height = gap;
    const g = c.getContext('2d');
    g.strokeStyle = color; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-1, gap + 1); g.lineTo(gap + 1, -1); g.stroke();
    return ctx.createPattern(c, 'repeat');
  }
  drawSwellPanel = function (common, data) {
    const canvas = $('forecast-canvas-swell');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);
    const P = FC_RETRO;
    const plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right;
    const top = 4, usableH = cssH - 8, h = Math.round(usableH * 0.68);
    const subTop = top + h + 6, subBot = cssH - 2;
    const S = inWindowSeries(data);
    // Axis from what reaches the reef; blocked swell taller than that is
    // clipped at the ceiling and its true height printed there.
    let reefMax = 0, totMax = 0;
    for (let i = 0; i <= common.lastIdx; i++) { if (S.reef[i] > reefMax) reefMax = S.reef[i]; if (S.total[i] > totMax) totMax = S.total[i]; }
    const target = Math.max(reefMax * 1.25, 1);
    const maxY = target <= 2 ? 2 : target <= 3 ? 3 : target <= 4 ? 4 : target <= 6 ? 6 : Math.ceil(target / 4) * 4;
    const div = maxY === 3 || maxY === 6 ? 3 : maxY === 2 ? 2 : 4;
    const periodMax = 24;
    ctx.fillStyle = P.plotBg; ctx.fillRect(0, 0, cssW, cssH);
    _fcDrawNightShading(ctx, common, plotLeft, plotW, top, subBot - top);
    selectedDayBand(ctx, common, plotLeft, plotW, top, subBot - top);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, subBot - top);
    _fcDrawPastDim(ctx, common, plotLeft, plotW, top, subBot - top);
    for (let q = 1; q < div; q++) _fcDrawDashedHGrid(ctx, plotLeft, plotLeft + plotW, top + h * q / div);
    const y = v => top + h - (Math.min(v, maxY * 1.06) / maxY) * h;
    const yP = v => top + h - (Math.max(0, Math.min(periodMax, v)) / periodMax) * h;
    const X = i => _fcXFor(common.allTimes[i], common, plotLeft, plotW);
    const area = (arr) => {
      ctx.beginPath(); ctx.moveTo(X(0), y(0));
      for (let i = 0; i <= common.lastIdx; i++) ctx.lineTo(X(i), y(arr[i] != null ? arr[i] : 0));
      ctx.lineTo(X(common.lastIdx), y(0)); ctx.closePath();
    };
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, plotW, h); ctx.clip();
    // Ghost: all the swell out there, hatched — what Montauk and Block stop.
    area(S.total); ctx.fillStyle = hatch(ctx, P.ghostHatch, 6); ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= common.lastIdx; i++) { const v = S.total[i]; if (v == null) continue; i ? ctx.lineTo(X(i), y(v)) : ctx.moveTo(X(i), y(v)); }
    ctx.strokeStyle = P.ghostEdge; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    // Hero: what reaches the reef, lit from above with a pale rim.
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, P.inFillTop); g.addColorStop(1, P.inFill);
    area(S.reef); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= common.lastIdx; i++) { const v = S.reef[i]; if (v == null) continue; i ? ctx.lineTo(X(i), y(v)) : ctx.moveTo(X(i), y(v)); }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = P.swellStroke; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.translate(0, 1.5); ctx.strokeStyle = P.inRim; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    // Period of the train that reaches the reef (dashed where nothing does).
    const pts = [];
    for (let i = 0; i <= common.lastIdx; i++) { const p = S.leadP[i]; if (p != null && Number.isFinite(p)) pts.push([X(i), yP(p), S.leadIn[i]]); }
    if (pts.length > 1) {
      ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = P.periodHalo; ctx.lineWidth = 4.5; ctx.stroke();
      for (let k = 1; k < pts.length; k++) {
        ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.strokeStyle = P.period; ctx.lineWidth = pts[k][2] ? 2.25 : 1.25;
        ctx.setLineDash(pts[k][2] ? [] : [2, 3]); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
    // Blocked swell taller than the axis: say how tall, at the ceiling.
    if (totMax > maxY * 1.06) {
      let bi = 0; for (let i = 0; i <= common.lastIdx; i++) if (S.total[i] > S.total[bi]) bi = i;
      ctx.font = `11px ${FC_CHART_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const lbl = S.total[bi].toFixed(1) + 'ft blocked';
      const tw = ctx.measureText(lbl).width + 6, lx = Math.max(plotLeft + tw / 2, Math.min(plotLeft + plotW - tw / 2, X(bi)));
      ctx.fillStyle = P.plotBg; ctx.fillRect(lx - tw / 2, top + 2, tw, 13);
      ctx.fillStyle = P.ink2; ctx.fillText(lbl, lx, top + 3);
    }
    // Axes: height in ink, period in the period's own colour.
    const clampY = v => Math.min(Math.max(v, 7), cssH - 7);
    ctx.font = `11px ${FC_CHART_FONT}`; ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillStyle = P.ink;
    for (let q = 0; q <= div; q++) { const v = maxY * (1 - q / div); ctx.fillText(q === 0 ? v + 'ft' : String(v), plotLeft - 4, clampY(top + h * q / div)); }
    ctx.textAlign = 'left'; ctx.fillStyle = P.period;
    for (let q = 0; q <= div; q++) { const v = Math.round(periodMax * (1 - q / div)); ctx.fillText(q === 0 ? v + 's' : String(v), plotLeft + plotW + 4, clampY(top + h * q / div)); }
    // Direction strip: the window band, labelled; the line solid inside
    // it and dashed outside.
    const winMin = CONFIG.chocomount.swellWindowMin, winMax = CONFIG.chocomount.swellWindowMax;
    const dMin = 90, dMax = (winMin + winMax) / 2 + 120;
    const sT = subTop + 3, sB = subBot - 3;
    const yD = d => sT + ((d - dMin) / (dMax - dMin)) * (sB - sT);
    ctx.fillStyle = P.windBand; ctx.fillRect(plotLeft, yD(winMin), plotW, yD(winMax) - yD(winMin));
    // (band label drawn after the lines, below)
    const dirLine = (dirs, gate) => {
      ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, subTop, plotW, subBot - subTop); ctx.clip();
      let prev = null;
      for (let i = 0; i <= common.lastIdx; i++) {
        const v = dirs[i];
        if (v == null || (gate && !gate(i))) { prev = null; continue; }
        if (prev && Math.abs(v - prev.v) <= 180) {
          const inside = _alignmentScore(v) >= 0.999 && _alignmentScore(prev.v) >= 0.999;
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(X(i), yD(v));
          ctx.strokeStyle = inside ? P.dirPrimary : P.dirOut; ctx.lineWidth = inside ? 2.25 : 1.25;
          ctx.setLineDash(inside ? [] : [3, 3]); ctx.stroke();
        }
        prev = { v, x: X(i), y: yD(v) };
      }
      ctx.setLineDash([]); ctx.restore();
    };
    // One line: the direction of whatever reaches the reef that hour
    // (breaks where the lead switches trains, so no false sweeps).
    dirLine(S.leadD.map(x => x.d), i => i === 0 || S.leadD[i].k === S.leadD[i - 1].k);
    // Band label on a backing chip, drawn over the lines it names.
    ctx.font = `bold 11px ${FC_CHART_FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const bl = 'WINDOW 115-158', bw = ctx.measureText(bl).width + 8, by = (yD(winMin) + yD(winMax)) / 2;
    ctx.fillStyle = P.plotBg; ctx.globalAlpha = 0.85; ctx.fillRect(plotLeft + plotW - bw - 2, by - 7, bw, 14); ctx.globalAlpha = 1;
    ctx.fillStyle = P.windBandInk; ctx.fillText(bl, plotLeft + plotW - 6, by);
    ctx.font = `11px ${FC_CHART_FONT}`; ctx.fillStyle = P.ink; ctx.textAlign = 'right';
    [[135, 'SE'], [180, 'S'], [225, 'SW']].forEach(([d, l]) => { if (d >= dMin && d <= dMax) ctx.fillText(l, plotLeft - 4, Math.min(Math.max(yD(d), subTop + 6), subBot - 5)); });
    ctx.font = `bold 11px ${FC_CHART_FONT}`; ctx.fillStyle = P.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText('FROM', plotLeft + 4, subTop + 3);
    ctx.strokeStyle = P.frame; ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, h - 1);
    ctx.strokeRect(plotLeft + 0.5, subTop + 0.5, plotW - 1, subBot - subTop - 1);
    _fcDrawNowLine(ctx, common, plotLeft, plotW, top, subBot);
    // Buoy diamond (measured), unchanged rules.
    const { obsHsFt, obsMs } = data;
    if (obsHsFt != null && obsMs != null && Date.now() - obsMs <= BUOY_OBS_OLD_MS && obsMs >= common.t0 && obsMs <= common.tEnd) {
      const ox = _fcXFor(new Date(obsMs), common, plotLeft, plotW), oy = y(Math.min(obsHsFt, maxY));
      ctx.beginPath(); ctx.moveTo(ox, oy - 5); ctx.lineTo(ox + 5, oy); ctx.lineTo(ox, oy + 5); ctx.lineTo(ox - 5, oy); ctx.closePath();
      ctx.fillStyle = P.obsFill; ctx.fill(); ctx.strokeStyle = P.obsStroke; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const si = STATE.scrubberIdx;
    if (typeof si === 'number' && si >= 0 && si <= common.lastIdx) {
      const tx = X(si);
      if (S.reef[si] != null) drawScrubberDot(ctx, tx, y(S.reef[si]));
      if (S.leadP[si] != null) drawScrubberDot(ctx, tx, yP(S.leadP[si]));
      if (S.leadD[si] && S.leadD[si].d != null) drawScrubberDot(ctx, tx, yD(S.leadD[si].d));
    }
    return { canvas, cssW, cssH, plotLeft, plotW, top, h, swellMaxY: maxY, ySwell: y, yPeriod: yP };
  };

  drawWindPanel = function (common, data) {
    const canvas = $('forecast-canvas-wind');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);
    const P = FC_RETRO;
    const plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right, top = 4, h = cssH - 8;
    ctx.fillStyle = P.plotBg; ctx.fillRect(0, 0, cssW, cssH);
    _fcDrawNightShading(ctx, common, plotLeft, plotW, top, h);
    selectedDayBand(ctx, common, plotLeft, plotW, top, h);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, h);
    _fcDrawPastDim(ctx, common, plotLeft, plotW, top, h);
    const { windSpeeds, windDirs, windMaxY } = data;
    const y = v => top + h - (Math.min(v, windMaxY) / windMaxY) * h;
    const X = i => _fcXFor(common.allTimes[i], common, plotLeft, plotW);
    const onPat = hatch(ctx, P.windOnHatch, 5);
    ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, plotW, h); ctx.clip();
    // Luminance + pattern, not hue alone: offshore dark solid, cross mid,
    // onshore light and hatched.
    for (let i = 0; i < common.lastIdx; i++) {
      const q = windQual(windDirs[i], windSpeeds[i]);
      const w1 = windSpeeds[i] || 0, w2 = windSpeeds[i + 1] != null ? windSpeeds[i + 1] : w1;
      ctx.beginPath(); ctx.moveTo(X(i), y(0)); ctx.lineTo(X(i), y(w1)); ctx.lineTo(X(i + 1), y(w2)); ctx.lineTo(X(i + 1), y(0)); ctx.closePath();
      ctx.fillStyle = q === 'off' ? P.windOff : q === 'cross' ? P.windCross : q === 'on' ? P.windOn : P.windNull;
      ctx.fill();
      if (q === 'on') { ctx.fillStyle = onPat; ctx.fill(); }
    }
    ctx.beginPath();
    for (let i = 0; i <= common.lastIdx; i++) { const v = windSpeeds[i]; if (v == null) continue; i ? ctx.lineTo(X(i), y(v)) : ctx.moveTo(X(i), y(v)); }
    ctx.strokeStyle = P.windStroke; ctx.lineWidth = 1.25; ctx.stroke();
    ctx.restore();
    for (let v = 10; v < windMaxY; v += 10) _fcDrawDashedHGrid(ctx, plotLeft, plotLeft + plotW, y(v));
    ctx.font = `11px ${FC_CHART_FONT}`; ctx.fillStyle = P.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [0, 10, 20].forEach(v => ctx.fillText(v === 20 ? '20mph' : String(v), plotLeft - 4, Math.min(Math.max(y(v), 7), cssH - 7)));
    ctx.strokeStyle = P.frame; ctx.lineWidth = 1; ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, h - 1);
    _fcDrawNowLine(ctx, common, plotLeft, plotW, top, top + h);
    const si = STATE.scrubberIdx;
    if (typeof si === 'number' && si >= 0 && si <= common.lastIdx && windSpeeds[si] != null) drawScrubberDot(ctx, X(si), y(windSpeeds[si]));
    return { canvas, cssW, cssH, plotLeft, plotW, top, h, windMaxY };
  };

  drawTidePanel = function (common, data) {
    const canvas = $('forecast-canvas-tide');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { cssW, cssH } = ensureCanvasCssDims(canvas, ctx);
    const P = FC_RETRO;
    const plotLeft = FC_PAD.left, plotW = cssW - FC_PAD.left - FC_PAD.right, top = 4, h = cssH - 8;
    ctx.fillStyle = P.plotBg; ctx.fillRect(0, 0, cssW, cssH);
    _fcDrawNightShading(ctx, common, plotLeft, plotW, top, h);
    selectedDayBand(ctx, common, plotLeft, plotW, top, h);
    _fcDrawDaySeparators(ctx, common, plotLeft, plotW, top, h);
    const { tidePred, tideHiLo } = data;
    let tideMin = 0, tideMax = 1;
    const X = t => _fcXFor(new Date(t), common, plotLeft, plotW);
    if (tidePred && tidePred.length > 1) {
      const vals = tidePred.map(p => parseFloat(p.v)).filter(Number.isFinite);
      tideMin = Math.min(...vals); tideMax = Math.max(...vals);
      const pad = 5, rng = (tideMax - tideMin) || 1;
      const y = v => top + pad + (1 - (v - tideMin) / rng) * (h - 2 * pad);
      // Low incoming from each daylight low → the next high, clipped to
      // daylight: the windows the crew actually surfs.
      const ev = (tideHiLo || []).map(p => ({ t: new Date(p.t).getTime(), type: p.type, v: parseFloat(p.v) })).sort((a, b) => a.t - b.t);
      ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, top, plotW, h); ctx.clip();
      ev.forEach((p, k) => {
        if (p.type !== 'L') return;
        const hi = ev.slice(k + 1).find(q => q.type === 'H');
        const dl = sun(new Date(p.t));
        if (!hi || !dl.sunrise) return;
        const a = Math.max(p.t, dl.sunrise.getTime()), b = Math.min(hi.t, dl.sunset.getTime());
        if (b - a < 45 * 60e3) return;
        ctx.fillStyle = P.incoming; ctx.fillRect(X(a), top, X(b) - X(a), h);
        ctx.fillStyle = P.incomingEdge; ctx.fillRect(X(a), top, 2, h);
      });
      ctx.beginPath();
      let st = false;
      for (const p of tidePred) {
        const tt = new Date(p.t).getTime(); if (tt < common.t0 || tt > common.tEnd) continue;
        const v = parseFloat(p.v); if (!Number.isFinite(v)) continue;
        st ? ctx.lineTo(X(tt), y(v)) : ctx.moveTo(X(tt), y(v)); st = true;
      }
      ctx.strokeStyle = P.tide; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      _fcDrawPastDim(ctx, common, plotLeft, plotW, top, h);
      ctx.font = `11px ${FC_CHART_FONT}`; ctx.fillStyle = P.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText((tideMax >= 0 ? '+' : '') + tideMax.toFixed(1) + 'ft', plotLeft - 4, Math.max(y(tideMax), 7));
      ctx.fillText(tideMin.toFixed(1), plotLeft - 4, Math.min(y(tideMin), cssH - 7));
      // Next daylight lows, labelled in ink.
      const nowMs = Date.now();
      const lows = ev.filter(p => p.type === 'L' && p.t >= common.t0 && p.t <= common.tEnd);
      ctx.font = `bold 11px ${FC_CHART_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      let lastX = -1e9;
      lows.forEach(lo => {
        const xx = X(lo.t), yy = y(lo.v), day = isDaylight(lo.t);
        ctx.fillStyle = day ? P.tide : P.tideMarkFaint;
        ctx.beginPath(); ctx.moveTo(xx, yy + 3); ctx.lineTo(xx - 4, yy - 3); ctx.lineTo(xx + 4, yy - 3); ctx.closePath(); ctx.fill();
        if (lo.t >= nowMs - 3 * 3600e3 && day && xx - lastX > 46) {
          const c = clock(lo.t);
          const ty = yy + 5 + 11 < top + h ? yy + 5 : yy - 18;
          ctx.fillStyle = P.ink; ctx.fillText(c.hm + c.ap[0].toLowerCase(), xx, ty);
          lastX = xx;
        }
      });
      const si = STATE.scrubberIdx;
      if (typeof si === 'number' && si >= 0 && si <= common.lastIdx) {
        const H = hourAt(si);
        if (H && H.tide) drawScrubberDot(ctx, _fcXFor(common.allTimes[si], common, plotLeft, plotW), y(H.tide.v));
      }
    }
    ctx.strokeStyle = P.frame; ctx.lineWidth = 1; ctx.strokeRect(plotLeft + 0.5, top + 0.5, plotW - 1, h - 1);
    _fcDrawNowLine(ctx, common, plotLeft, plotW, top, top + h);
    return { canvas, cssW, cssH, plotLeft, plotW, top, h, tideMin, tideMax };
  };

  drawScrubberDot = function (ctx, x, y) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = FC_RETRO.scrubDot; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = FC_RETRO.plotBg; ctx.stroke();
    ctx.restore();
  };


  // ════════════════════════════════════════════════════════════════════
  // WEB
  // ════════════════════════════════════════════════════════════════════
  if (!TV) {
    // ── Light: chrome scheme follows the real clock; the scene follows
    // the selected hour. Night = Win98 "Choc Night" colour scheme.
    const DAY_PAL = Object.assign({}, FC_RETRO);
    const SP_DAY = {
      plotBg: '#FBF8EE', grid: '#9a9a9a', frame: '#7b7b7b',
      inFill: '#3E5F92', inFillTop: '#5878AA', inRim: 'rgba(255,255,255,0.75)', swellStroke: '#14305C',
      ghostHatch: 'rgba(74, 107, 154, 0.42)', ghostEdge: 'rgba(74, 107, 154, 0.55)',
      nightShade: 'rgba(20, 32, 110, 0.10)', twilight: '20, 32, 110', dawnGlow: '255, 176, 96',
      pastDim: 'rgba(60, 56, 52, 0.07)', windBand: 'rgba(58, 125, 86, 0.20)', windBandInk: '#2b5e40',
      dirOut: 'rgba(26, 59, 106, 0.45)',
      windOff: '#245a3b', windCross: '#b8862f', windOn: '#d9a39a', windOnHatch: '#8a3a2e', windStroke: '#2c2c2c',
      incoming: 'rgba(58, 125, 86, 0.13)', incomingEdge: 'rgba(43, 94, 64, 0.55)', tide: '#1f4f80',
      selDay: 'rgba(0, 0, 128, 0.06)', scrubDot: '#000000'
    };
    const SP_NIGHT = {
      plotBg: '#0e1420', grid: '#3a4658', ink: '#dde6f2', ink2: '#9fb0c6', frame: '#3a4658',
      inFill: '#3d6db0', inFillTop: '#6c98d8', inRim: 'rgba(200,225,255,0.85)', swellStroke: '#a9c8f5',
      ghostHatch: 'rgba(140, 170, 215, 0.35)', ghostEdge: 'rgba(140, 170, 215, 0.45)',
      period: '#ff9a52', periodHalo: 'rgba(14, 20, 32, 0.9)',
      dirPrimary: '#a9c8f5', dirSecondary: '#a9c8f5', dirOut: 'rgba(169, 200, 245, 0.45)',
      nightShade: 'rgba(0, 0, 0, 0.32)', twilight: '0, 0, 0', dawnGlow: '255, 150, 80',
      pastDim: 'rgba(0, 0, 0, 0.18)', daySep: 'rgba(220, 230, 245, 0.10)',
      windBand: 'rgba(69, 255, 154, 0.12)', windBandInk: '#7fe0a8',
      windOff: '#3fb47a', windCross: '#c9a04a', windOn: '#5a3b3a', windOnHatch: '#e08070', windStroke: '#c8d4e4', windNull: 'rgba(160,170,180,0.4)',
      tide: '#8fc0f0', tideMarkFaint: 'rgba(143,192,240,0.55)', tideMark: 'rgba(143,192,240,0.95)', tideConn: 'rgba(143,192,240,0.7)',
      incoming: 'rgba(69, 255, 154, 0.08)', incomingEdge: 'rgba(69, 255, 154, 0.40)',
      selDay: 'rgba(120, 160, 255, 0.07)', scrubDot: '#ffffff', nowLine: 'rgba(220,230,245,0.55)',
      obsFill: '#0e1420', obsStroke: '#ffffff', pulseCore: '#a9c8f5', pulseRing: '169, 200, 245'
    };
    function applyScheme() {
      const now = Date.now();
      const p = phaseAt(now);
      const night = p === 'night';
      body.dataset.scheme = night ? 'night' : 'day';
      body.dataset.sky = p;
      Object.assign(FC_RETRO, DAY_PAL, SP_DAY, night ? SP_NIGHT : {});
    }
    applyScheme();

    // ── Gate: keep the joke, drop the toll. "Don't ask again today" is
    // the era's own checkbox; a remembered No for today skips the dialog.
    (function gate() {
      const today = new Date().toDateString();
      let remembered = null;
      try { remembered = localStorage.getItem('lcc-gate-day'); } catch (_) {}
      if (remembered === today) { try { sessionStorage.setItem('lcc-gate', 'no'); } catch (_) {} }
      const card = $('gate-card');
      if (!card) return;
      const t = card.querySelector('#gate-titlebar-text');
      if (t) t.textContent = 'LetsCheckChoc';
      const icon = card.querySelector('.gate-icon');
      if (icon) icon.outerHTML = ANCHOR_SVG;
      const btns = card.querySelector('.gate-buttons');
      if (btns && !$('sp-gate-remember')) {
        const lab = node('label', 'sp-check', '<input type="checkbox" id="sp-gate-remember" checked><span class="sp-check-box"></span><span>Don\'t ask me again today</span>');
        btns.parentNode.insertBefore(lab, btns);
        $('gate-no').addEventListener('click', () => {
          try { if ($('sp-gate-remember').checked) localStorage.setItem('lcc-gate-day', today); } catch (_) {}
        }, true);
      }
      const ctr = card.querySelector('.ctrls');
      if (ctr) ctr.innerHTML = '<button type="button" tabindex="-1" aria-label="help">?</button><button type="button" tabindex="-1" aria-label="close">' + X_SVG + '</button>';
      const gh = $('gate-go-home');
      if (gh) gh.innerHTML = '<span class="sp-gohome">Go Home</span>';
    })();

    // ── Window chrome ───────────────────────────────────────────────
    (function chrome() {
      const tb = $('win95-titlebar');
      if (tb) {
        const ctr = tb.querySelector('.win95-titlebar-ctrls');
        if (ctr) ctr.innerHTML = '<button type="button" class="win95-tb-btn sp-help" aria-label="Sources and settings" title="Sources &amp; settings">?</button>';
        const txt = tb.querySelector('.win95-titlebar-text');
        if (txt) txt.innerHTML = 'LetsCheckChoc <span class="sp-tb-sub">- Chocomount</span>';
        tb.removeAttribute('aria-hidden');
      }
      // Tabs in surf words, in the order the crew uses them.
      const bar = $('tab-bar');
      if (bar) {
        const f = $('tab-btn-forecast'), r = $('tab-btn-regression'), s = $('tab-btn-surflog');
        if (f) f.textContent = 'Forecast';
        if (s) s.textContent = 'Log';
        if (r) r.textContent = 'My Model';
        if (f && s && r) { bar.appendChild(f); bar.appendChild(s); bar.appendChild(r); }
      }
      // Status bar: the era's own home for honest freshness.
      const st = node('div', 'sp-statusbar', '');
      st.id = 'sp-status';
      st.innerHTML = '<span class="sp-sb-pane sp-sb-main"><i class="sp-pilot"></i><span id="sp-sb-updated">Loading forecast...</span></span>' +
        '<span class="sp-sb-pane" id="sp-sb-buoy">Buoy --</span>' +
        '<span class="sp-sb-pane sp-sb-hour" id="sp-sb-hour">Now</span>';
      const win = $('app-window');
      if (win) win.appendChild(st);
    })();

    // ── Forecast tab structure: answer → week → proof → more → sources.
    function restructure() {
      const vf = $('view-forecast');
      if (!vf || $('sp-hour')) return;
      const hour = node('section', 'sp-hour sp-client', '');
      hour.id = 'sp-hour';
      hour.innerHTML =
        '<div class="sp-hour-nav">' +
          '<button type="button" class="sp-btn sp-step" data-step="-1" aria-label="Previous hour">' + TRI_L + '</button>' +
          '<div class="sp-when" id="sp-when"><span class="sp-when-day">--</span><span class="sp-when-tag" id="sp-when-tag">NOW</span></div>' +
          '<button type="button" class="sp-btn sp-step" data-step="1" aria-label="Next hour">' + TRI_R + '</button>' +
          '<button type="button" class="sp-btn sp-jump" id="sp-jump" aria-label="Next daylight low">Low ' + TRI_R + '</button>' +
        '</div>' +
        '<div class="sp-led-row">' +
          '<div class="sp-led" id="sp-led" aria-live="polite"></div>' +
        '</div>' +
        '<div class="sp-facts" id="sp-facts"></div>';
      vf.insertBefore(hour, vf.firstChild);
      // The hour bar is a direct child of the view so it stays pinned under
      // the tabs all the way down to the charts; when the LED scrolls away
      // it grows a one-line readout of the selected hour.
      const nav = hour.querySelector('.sp-hour-nav');
      vf.insertBefore(nav, hour);
      const pin = node('div', 'sp-pin', ''); pin.id = 'sp-pin';
      nav.appendChild(pin);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => es.forEach(e => body.classList.toggle('sp-pinned', !e.isIntersecting && e.boundingClientRect.top < 120)),
          { rootMargin: '-110px 0px 0px 0px' }).observe($('sp-led'));
      }

      const lineup = $('panel-lineup');
      if (lineup) {
        hour.after(lineup);
        const strip = lineup.querySelector('.retro-card-title-strip');
        if (strip) strip.remove();
        const help = lineup.querySelector('.widget-help');
        if (help) help.remove();
        const leg = lineup.querySelector('.lineup-legend-overlay');
        if (leg) leg.remove();
        const frame = $('lineup-frame');
        if (frame && !$('sp-pills')) {
          const scene = node('div', 'sp-scene', ''); scene.id = 'sp-scene';
          const img = $('lineup-img');
          if (img) { frame.insertBefore(scene, img); scene.appendChild(img); }
          const pills = node('div', 'sp-pills', ''); pills.id = 'sp-pills';
          const grade = node('div', 'sp-grade', ''); grade.id = 'sp-grade';
          frame.insertBefore(grade, $('lineup-overlay'));
          frame.appendChild(pills);
        }
        const key = node('div', 'sp-lineup-key',
          '<span><i class="sp-k sp-k-swell"></i>swell that reaches Choc</span>' +
          '<span><i class="sp-k sp-k-blocked"></i>blocked (out of window)</span>' +
          '<span><i class="sp-k sp-k-wind"></i>wind</span>');
        lineup.appendChild(key);
      }

      const week = node('section', 'sp-week-panel sp-client', '');
      week.innerHTML = '<div class="sp-caption"><span>This week at Choc</span><span class="sp-caption-note">tap a day: jumps to the low that starts the incoming</span></div>' +
        '<div class="sp-week" id="sp-week" role="listbox" aria-label="This week at Choc"></div>';
      (lineup || hour).after(week);

      const fc = $('panel-forecast');
      if (fc) {
        week.after(fc);
        const strip = fc.querySelector('.retro-card-title-strip');
        if (strip) strip.innerHTML = '<span>7-day outlook</span><span class="sp-caption-note">drag sideways to move the hour</span>';
        const lbl = (cls, html) => { const l = fc.querySelector(cls + ' .forecast-section-label'); if (l) l.innerHTML = html; };
        lbl('.forecast-card-swell', '<b>Swell at the reef</b><span class="sp-legend"><i class="sp-k sp-k-in"></i>reaches Choc <i class="sp-k sp-k-ghost"></i>blocked <i class="sp-k sp-k-per"></i>period <i class="sp-k sp-k-obs"></i>buoy</span>');
        lbl('.forecast-card-wind', '<b>Wind</b><span class="sp-legend"><i class="sp-k sp-k-off"></i>offshore <i class="sp-k sp-k-cross"></i>cross <i class="sp-k sp-k-on"></i>onshore</span>');
        lbl('.forecast-card-tide', '<b>Tide</b><span class="sp-legend"><i class="sp-k sp-k-inc"></i>incoming from a daylight low</span>');
      }

      // More conditions (collapsed): buoy cards, spectra, rose, tides.
      const more = node('details', 'sp-more sp-client', '<summary><span class="sp-tw">' + TRI_R + '</span>More conditions <span class="sp-caption-note">buoy, water, daylight, spectra, tides</span></summary><div class="sp-more-body"></div>');
      more.id = 'sp-more';
      const mb = more.querySelector('.sp-more-body');
      ['conditions-row', 'panel-spectral-row', 'panel-tides'].forEach(id => { const n = $(id); if (n) mb.appendChild(n); });
      vf.appendChild(more);

      // Sources & settings (collapsed): everything about choosing data.
      const src = node('details', 'sp-more sp-sources sp-client', '<summary><span class="sp-tw">' + TRI_R + '</span>Sources &amp; settings <span class="sp-caption-note">buoy, model, tide station, sign-in</span></summary><div class="sp-more-body"></div>');
      src.id = 'sp-sources';
      const sb = src.querySelector('.sp-more-body');
      ['app-header', 'panel-map', 'forecast-controls-bar', 'panel-tide-map', 'page-footer'].forEach(id => { const n = $(id); if (n) sb.appendChild(n); });
      vf.appendChild(src);

      nav.addEventListener('click', ev => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.dataset.step) stepHour(+b.dataset.step);
        else if (b.id === 'sp-jump') jumpNextLow();
        else if (b.id === 'sp-now') resetScrubberToNow();
      });
      const help = document.querySelector('#win95-titlebar .sp-help');
      if (help) help.addEventListener('click', () => { switchTab('forecast'); src.open = true; src.scrollIntoView({ block: 'start' }); });
    }
    restructure();

    // ── Selecting an hour ───────────────────────────────────────────
    function selectIdx(idx) {
      const cs = STATE.forecastChart;
      if (!cs) return;
      idx = Math.max(0, Math.min(cs.times.length - 1, idx));
      STATE.scrubberIdx = idx;
      try {
        const t = cs.times[idx];
        sessionStorage.setItem('lcc-scrubber-hour', t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' +
          String(t.getDate()).padStart(2, '0') + 'T' + String(t.getHours()).padStart(2, '0') + ':00');
      } catch (_) {}
      applyScrubberToHour(idx);
    }
    function stepHour(d) {
      const i = typeof STATE.scrubberIdx === 'number' && STATE.scrubberIdx >= 0 ? STATE.scrubberIdx : getScrubberIndex();
      selectIdx(i + d);
    }
    function daylightLowsAfter(ms) {
      const fd = STATE.forecastData || {};
      return (fd.tideHiLo || []).filter(p => p.type === 'L').map(p => new Date(p.t).getTime())
        .filter(t => t > ms && isDaylight(t)).sort((a, b) => a - b);
    }
    function jumpNextLow() {
      const cs = STATE.forecastChart;
      if (!cs) return;
      const cur = cs.times[STATE.scrubberIdx >= 0 ? STATE.scrubberIdx : getScrubberIndex()].getTime();
      const lows = daylightLowsAfter(cur + 30 * 60e3);
      if (lows.length) selectIdx(findHourIndexForTime(lows[0], cs));
    }
    // A day's session = the daylight low that opens its incoming window
    // (what the Choc TV card leads with); with no daylight low, its first
    // daylight hour.
    function dayTargetMs(dayOffset) {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() + dayOffset);
      const s = window._spWeek && window._spWeek[dayOffset];
      if (s && s.windows && s.windows.length) {
        const w = s.windows.find(w => w.end > Date.now()) || s.windows[0];
        return Math.max(w.dayStart, dayOffset === 0 ? Date.now() : 0);
      }
      const dl = sun(d0);
      return dl.sunrise ? dl.sunrise.getTime() + 3600e3 : d0.getTime() + 8 * 3600e3;
    }
    function jumpDay(dayOffset) {
      const cs = STATE.forecastChart;
      if (!cs) return;
      selectIdx(findHourIndexForTime(dayTargetMs(dayOffset), cs));
    }
    window.spJumpDay = jumpDay;

    // ── Hour card ───────────────────────────────────────────────────
    function renderHour(idx) {
      const H = hourAt(idx);
      const led = $('sp-led'), facts = $('sp-facts'), when = $('sp-when');
      if (!H || !led) return;
      const c = clock(H.t);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dd = Math.round((new Date(H.t).setHours(0, 0, 0, 0) - today) / 86400e3);
      const dayName = dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : H.t.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + (H.t.getMonth() + 1) + '/' + H.t.getDate();
      when.innerHTML = `<span class="sp-when-day">${dayName} ${c.h} ${c.ap}</span>` +
        (H.isNow ? '<span class="sp-when-tag" id="sp-when-tag">NOW</span>'
          : '<button type="button" class="sp-btn sp-now" id="sp-now">Now</button>');
      const L = H.lead;
      const hTxt = L.h != null ? L.h.toFixed(1) : '--';
      const pTxt = L.p != null ? String(Math.round(L.p)) : '--';
      led.className = 'sp-led ' + (L.cls || '');
      const dirTxt = L.d != null ? Math.round(L.d) + DEG + ' ' + directionLabel(L.d) : '';
      led.innerHTML =
        `<div class="sp-led-cap"><span>SWELL AT THE REEF</span><span>${dirTxt}</span></div>` +
        `<div class="sp-led-main">` +
          `<span class="sp-led-read">${seg(hTxt, 'sp-led-xl')}<span class="sp-led-u">FT</span><span class="sp-led-at">@</span>${seg(pTxt, 'sp-led-l')}<span class="sp-led-u">S</span></span>` +
          arrowGlyph(L.d, L.d != null ? directionLabel(L.d) : '', 'sp-led-arrow') +
        `</div>` +
        // Annunciators: all three printed on the glass, only the true one lit.
        `<div class="sp-ann">${['dir-in', 'dir-edge', 'dir-out'].map(k => `<span class="${L.cls === k ? 'on' : ''}">${WIN[k]}</span>`).join('')}</div>`;
      // Three readout cells on white: tide, wind, your model.
      const cell = (k, v, word, sub, cls) => `<div class="sp-cellx ${cls || ''}"><span class="sp-cx-k">${k}</span><span class="sp-cx-v">${v}</span>` +
        (word ? `<span class="sp-cx-w">${word}</span>` : '') + (sub ? `<span class="sp-cx-s">${sub}</span>` : '') + `</div>`;
      let tide = cell('Tide', '<span class="sp-cx-none">no data</span>', '', 'NOAA tides down');
      if (H.tide) {
        const T = H.tide;
        const nx = T.next ? clock(T.next.t) : null;
        tide = cell('Tide', seg((T.v < 0 ? '-' : '') + Math.abs(T.v).toFixed(1), 'sp-seg-m') + '<span class="sp-u">ft</span>',
          T.rising == null ? '' : (T.rising ? TRI_U_S + ' rising' : TRI_D_S + ' falling'),
          nx ? (T.next.type === 'H' ? 'high ' : 'low ') + nx.hm + ' ' + nx.ap : '', T.rising ? 'is-rising' : 'is-falling');
      }
      let wind = cell('Wind', '<span class="sp-cx-none">no data</span>', '', '');
      if (H.wind) {
        const W = H.wind;
        wind = cell('Wind', seg(Math.round(W.mph), 'sp-seg-m') + `<span class="sp-u">mph ${W.dir != null ? directionLabel(W.dir) : ''}</span>`,
          `<span class="sp-q sp-q-${W.q}">${W.q === 'off' ? 'offshore' : W.q === 'cross' ? 'cross' : 'onshore'}</span>`,
          W.gust != null ? 'gusts ' + Math.round(W.gust) : '', 'is-' + W.q);
      }
      let model = cell('Your model', '<span class="sp-cx-none">--</span>', '', 'log 5 sessions to train it', 'sp-cx-model');
      if (H.model && H.model.avg != null) {
        const m = H.model;
        const bar = (k, v) => `<span class="sp-mbar" title="${k} ${v != null ? v.toFixed(1) : '--'}"><i style="width:${Math.max(0, Math.min(100, (v || 0) * 10))}%"></i></span>`;
        model = cell('Your model', seg(m.avg.toFixed(1), 'sp-seg-m') + '<span class="sp-u">/10</span>',
          `<span class="sp-mbars">${bar('size', m.size)}${bar('wind', m.wind)}${bar('ride', m.ride)}</span>`,
          'if I went ' + (H.isNow ? 'now' : 'then'), 'sp-cx-model');
      }
      const notes = [];
      if (H.other && H.other.h != null && H.other.h >= 0.3) {
        const O = H.other;
        notes.push(`<span class="sp-note"><b class="sp-tag sp-tag-${O.cls === 'dir-out' ? 'out' : O.cls === 'dir-edge' ? 'edge' : 'in'}">${O.cls === 'dir-out' ? 'BLOCKED' : O.cls === 'dir-edge' ? 'EDGE' : 'ALSO IN'}</b> ${O.h.toFixed(1)}ft @ ${O.p != null ? Math.round(O.p) : '-'}s ${O.d != null ? directionLabel(O.d) : ''}${O.cls === 'dir-out' ? ', stopped by Montauk / Block' : ''}</span>`);
      }
      if (H.isNow) {
        const bh = ($('val-swell-height') || {}).textContent || '';
        const bd = ($('val-swell-detail') || {}).textContent || '';
        const ba = ($('val-swell-arrival') || {}).textContent || '';
        if (bh && bh !== '—') {
          const m = /reaches Choc ~?([^·]+)/.exec(ba);
          const obs = /Buoy obs ([^(]+)\(([^)]+)\)/.exec(ba);
          const p = (bd.split('·')[0] || '').trim();
          const dirm = /·\s*([A-Z]+)\s*\((\d+)/.exec(bd);
          notes.push(`<span class="sp-note"><b class="sp-tag sp-tag-buoy">BUOY</b> <b>${esc(bh.replace(' swell', '').replace(' ', ''))} @ ${esc(p)}${dirm ? ' ' + esc(dirm[1]) : ''}</b>${obs ? ' at ' + esc(obs[1].trim()) : ''}${m ? ', reaches Choc ~' + esc(m[1].trim()) : ''}</span>`);
        }
      }
      facts.innerHTML = `<div class="sp-cells">${tide}${wind}${model}</div>` + (notes.length ? `<div class="sp-notes">${notes.join('')}</div>` : '');
      const pin = $('sp-pin');
      if (pin) pin.innerHTML = `<b>${hTxt}ft @ ${pTxt}s ${L.d != null ? directionLabel(L.d) : ''}</b> <span class="sp-tag sp-tag-${L.cls === 'dir-out' ? 'out' : L.cls === 'dir-edge' ? 'edge' : 'in'}">${L.cls === 'dir-out' ? 'OUT' : L.cls === 'dir-edge' ? 'EDGE' : 'IN'}</span>` +
        (H.tide ? ` <span>tide ${H.tide.v.toFixed(1)} ${H.tide.rising ? 'rising' : 'falling'}</span>` : '') +
        (H.wind ? ` <span>wind ${Math.round(H.wind.mph)} ${directionLabel(H.wind.dir)} <b>${H.wind.q === 'off' ? 'offshore' : H.wind.q === 'cross' ? 'cross' : 'onshore'}</b></span>` : '') +
        (H.model && H.model.avg != null ? ` <span>model <b>${H.model.avg.toFixed(1)}</b></span>` : '');
      const sbh = $('sp-sb-hour');
      if (sbh) sbh.textContent = H.isNow ? 'Now' : dayName + ' ' + c.h + ' ' + c.ap;
      markWeek(H);
      gradeScene(H.isNow ? Date.now() : H.t.getTime());
    }

    // ── Week strip ──────────────────────────────────────────────────
    function daySummaryPlus(off) {
      const s = kioskDaySummary(off);
      const fd = STATE.forecastData || {};
      const ev = (fd.tideHiLo || []).map(p => ({ t: new Date(p.t).getTime(), type: p.type })).sort((a, b) => a.t - b.t);
      const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() + off);
      const dl = sun(d0);
      s.dl = dl;
      s.date = d0;
      // Incoming windows clipped to daylight (the TV card's session).
      s.windows = (s.lows || []).map(lo => {
        const hi = ev.find(p => p.type === 'H' && p.t > lo.t);
        const end = hi ? hi.t : lo.t + 6.2 * 3600e3;
        const a = dl.sunrise ? Math.max(lo.t, dl.sunrise.getTime()) : lo.t;
        const b = dl.sunset ? Math.min(end, dl.sunset.getTime()) : end;
        return { low: lo.t, end, dayStart: a, dayEnd: b, daylight: b > a + 45 * 60e3, wind: lo.wind };
      }).filter(w => w.daylight);
      // Best model hour inside those windows (only when trained).
      s.best = null;
      const cs = STATE.forecastChart;
      if (STATE.surfLogWaveWeights && cs) {
        for (const w of s.windows) {
          for (let t = w.dayStart; t <= w.dayEnd; t += 3600e3) {
            const H = hourAt(findHourIndexForTime(t, cs));
            if (H && H.model && H.model.avg != null && (!s.best || H.model.avg > s.best.v)) s.best = { v: H.model.avg, t: H.t };
          }
        }
      }
      return s;
    }
    function renderWeek() {
      const host = $('sp-week');
      if (!host || !STATE.forecastData) return;
      const days = [];
      for (let i = 0; i < 7; i++) { try { days.push(daySummaryPlus(i)); } catch (e) { days.push(null); } }
      window._spWeek = days;
      host.innerHTML = days.map((s, i) => {
        if (!s) return '';
        const name = i === 0 ? 'Today' : s.date.toLocaleDateString('en-US', { weekday: 'short' });
        const P = s.primary;
        const rng = P ? (P.min === P.max ? String(P.max) : `${P.min}-${P.max}`) : '--';
        const cls = P ? (P.cls || 'dir-in') : '';
        const w = s.windows[0];
        const passed = w && i === 0 && w.dayEnd < Date.now();
        const lowC = w ? clock(w.low) : null;
        const wq = w && w.wind ? windQual(w.wind.dir, w.wind.mph) : null;
        return `<button type="button" class="sp-day ${cls}${passed ? ' is-past' : ''}" data-day="${i}" role="option">` +
          `<span class="sp-day-name"><b>${name}</b><small>${s.date.getMonth() + 1}/${s.date.getDate()}</small></span>` +
          `<span class="sp-day-hero">${seg(rng, 'sp-seg-d')}<span class="sp-u">ft</span></span>` +
          `<span class="sp-day-per">@ ${seg(P && P.period != null ? P.period : '-', 'sp-seg-ds')}<span class="sp-u">s</span>${arrowGlyph(P ? P.dir : null, P && P.dir != null ? directionLabel(P.dir) : '', 'sp-day-arrow')}</span>` +
          `<span class="sp-day-win"><span class="sp-tag sp-tag-${cls === 'dir-out' ? 'out' : cls === 'dir-edge' ? 'edge' : 'in'}">${cls === 'dir-out' ? 'OUT' : cls === 'dir-edge' ? 'EDGE' : 'IN'}</span>` +
          `${P && P.dir != null ? Math.round(P.dir) + DEG : ''}</span>` +
          (w ? `<span class="sp-day-low"><small>LOW</small>${seg(lowC.hm, 'sp-seg-ds')}<small>${lowC.ap}</small></span>` +
               `<span class="sp-day-wind">${w.wind ? dial(w.wind.dir, Math.round(w.wind.mph), 'sp-dial-' + (wq || 'x')) : ''}<span>${w.wind ? (w.wind.dir != null ? directionLabel(w.wind.dir) : '') + '<br><b>' + (wq === 'off' ? 'offshore' : wq === 'cross' ? 'cross' : wq === 'on' ? 'onshore' : '') + '</b>' : 'no wind'}</span></span>`
             : `<span class="sp-day-low sp-dim"><small>no daylight low</small></span><span class="sp-day-wind"></span>`) +
          (s.best ? `<span class="sp-day-model"><small>model</small> <b>${s.best.v.toFixed(1)}</b> <small>best ${clock(s.best.t).h}${clock(s.best.t).ap.toLowerCase()}</small></span>` : '') +
          `</button>`;
      }).join('');
      host.querySelectorAll('.sp-day').forEach(b => b.addEventListener('click', () => jumpDay(+b.dataset.day)));
      const cs = STATE.forecastChart;
      if (cs) { const H = hourAt(STATE.scrubberIdx >= 0 ? STATE.scrubberIdx : getScrubberIndex()); if (H) markWeek(H); }
    }
    function markWeek(H) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dd = Math.round((new Date(H.t).setHours(0, 0, 0, 0) - today) / 86400e3);
      document.querySelectorAll('#sp-week .sp-day').forEach(b => {
        const on = +b.dataset.day === dd;
        b.classList.toggle('is-sel', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) { const host = b.parentElement; if (host && host.scrollWidth > host.clientWidth) host.scrollLeft = Math.max(0, b.offsetLeft - host.clientWidth / 2 + b.offsetWidth / 2); }
      });
      document.querySelectorAll('#forecast-day-header .forecast-day-label').forEach(b => b.classList.toggle('is-sel', +b.dataset.day === dd));
    }

    // ── The lineup scene: graded to the hour's sun ─────────────────
    function gradeScene(ms) {
      const f = $('lineup-frame');
      if (f) f.dataset.phase = phaseAt(ms);
    }
    drawLineupMap = function (marine, wind, buoyParsed, hourIdx) {
      const svg = $('lineup-overlay'), frame = $('lineup-frame'), pills = $('sp-pills');
      if (!svg || !frame) return;
      const W = frame.clientWidth - 4, Hh = frame.clientHeight - 4;
      if (W <= 0 || Hh <= 0) return;
      const cs = STATE.forecastChart;
      const idx = typeof hourIdx === 'number' && hourIdx >= 0 ? hourIdx : (cs ? findHourIndexForTime(Date.now(), cs) : -1);
      const H = idx >= 0 ? hourAt(idx) : null;
      svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      // Frame the reef, not the island: zoom 1.4× and put the lineup in
      // the upper third, so the water the swell crosses gets the pixels.
      const img = $('lineup-img');
      const ZOOM = 1.42, LY = 0.33;
      if (img) {
        const ih = Hh * ZOOM, iw = ih * (1992 / 949);
        img.classList.add('sp-placed');
        img.style.width = iw + 'px'; img.style.height = ih + 'px';
        img.style.left = (W / 2 - iw / 2) + 'px'; img.style.top = (Hh * LY - ih / 2) + 'px';
      }
      const cx = W / 2, cy = Hh * LY, R = Math.min(Hh * 0.62, W * 0.42);
      const pt = (deg, r) => [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)];
      const a = CONFIG.chocomount.swellWindowMin, b = CONFIG.chocomount.swellWindowMax;
      const [x1, y1] = pt(a, R * 1.15), [x2, y2] = pt(b, R * 1.15);
      let s = `<defs><radialGradient id="spCone" cx="${cx}" cy="${cy}" r="${R * 1.15}" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" class="sp-cone-s0"/><stop offset="1" class="sp-cone-s1"/></radialGradient></defs>`;
      s += `<path class="sp-cone" d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${R * 1.15} ${R * 1.15} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="url(#spCone)"/>`;
      s += `<line class="sp-cone-edge" x1="${cx}" y1="${cy}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/><line class="sp-cone-edge" x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      // Night: the scope borrows Choc TV's range rings.
      s += `<g class="sp-rings">${[0.33, 0.66, 1].map(k => `<circle cx="${cx}" cy="${cy}" r="${(R * k).toFixed(1)}"/>`).join('')}</g>`;
      const [rx, ry] = pt(LINEUP_REEF_HEADING, R * 0.42);
      s += `<line class="sp-reef" x1="${cx}" y1="${cy}" x2="${rx.toFixed(1)}" y2="${ry.toFixed(1)}"/>`;
      const html = [], boxes = [];
      // Tooltip labels with simple collision avoidance: estimate the box
      // (bitmap face ≈ 6 px/char), nudge vertically until it is clear.
      const pill = (x, y, text, cls, anchor, optional) => {
        const wpx = text.replace(/<[^>]+>/g, '').length * 6.1 + 12, hpx = 17;
        // Keep the whole tooltip on the photo.
        if (anchor === 'l') x = Math.min(x, W - wpx - 3); else if (anchor === 'r') x = Math.max(x, wpx + 3);
        else x = Math.max(wpx / 2 + 3, Math.min(W - wpx / 2 - 3, x));
        const box = yy => { const l = anchor === 'l' ? x : anchor === 'r' ? x - wpx : x - wpx / 2; return { l, r: l + wpx, t: yy - hpx / 2, b: yy + hpx / 2 }; };
        const hit = bx => boxes.some(o => bx.l < o.r + 2 && bx.r > o.l - 2 && bx.t < o.b + 1 && bx.b > o.t - 1) || bx.l < 0 || bx.r > W || bx.t < 0 || bx.b > Hh;
        let yy = y, bx = null;
        for (const d of [0, 19, -19, 38, -38, 57]) { const c = box(y + d); if (!hit(c)) { yy = y + d; bx = c; break; } }
        if (!bx) { if (optional) return; yy = y; bx = box(yy); }
        boxes.push(bx);
        html.push(`<span class="sp-pill ${cls || ''}" style="left:${x.toFixed(0)}px;top:${yy.toFixed(0)}px" data-anchor="${anchor || 'c'}">${text}</span>`);
      };
      // (land labels are placed after the arrows, as lower priority)
      // Arrows converging on the lineup; length ∝ √energy as before.
      const arrow = (from, len, cls) => {
        const th = from * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th), px = -uy, py = ux;
        const gap = 7, head = 13, hw = 9, sw = 3.2;
        const tipx = cx + ux * gap, tipy = cy + uy * gap;
        const bx = cx + ux * (gap + head), by = cy + uy * (gap + head);
        const tx = cx + ux * (gap + len), ty = cy + uy * (gap + len);
        const P = [[tipx, tipy], [bx + px * hw, by + py * hw], [bx + px * sw, by + py * sw], [tx + px * sw, ty + py * sw],
          [tx - px * sw, ty - py * sw], [bx - px * sw, by - py * sw], [bx - px * hw, by - py * hw]];
        s += `<g class="sp-arw ${cls}"><polygon class="sp-arw-sh" points="${P.map(p => (p[0] + 1.5).toFixed(1) + ',' + (p[1] + 1.5).toFixed(1)).join(' ')}"/>` +
          `<polygon class="sp-arw-body" points="${P.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/></g>`;
        return [tx, ty, ux, uy];
      };
      const lenFor = (hgt, per) => Math.max(R * 0.32, Math.min(R * 0.98, Math.sqrt(hgt * hgt * (per || 1)) * R * 0.18));
      const place = (end, text, cls) => {
        const [tx, ty, ux, uy] = end;
        const x = tx + ux * 14, y = ty + uy * 12;
        pill(Math.max(8, Math.min(W - 8, x)), Math.max(10, Math.min(Hh - 10, y)), text, cls, ux > 0.35 ? 'l' : ux < -0.35 ? 'r' : 'c');
      };
      if (H) {
        const O = H.other, L = H.lead;
        if (O && O.h != null && O.d != null && O.h >= 0.3) {
          const out = O.cls === 'dir-out';
          const e = arrow(O.d, lenFor(O.h, O.p), out ? 'sp-arw-blocked' : 'sp-arw-swell2');
          place(e, `${O.h.toFixed(1)}ft @ ${O.p != null ? Math.round(O.p) : '-'}s ${directionLabel(O.d)}${out ? ' <b>blocked</b>' : ''}`, out ? 'sp-pill-blocked' : '');
        }
        if (H.wind && H.wind.dir != null) {
          const e = arrow(H.wind.dir, Math.max(R * 0.3, Math.min(R * 0.8, H.wind.mph * R * 0.05)), 'sp-arw-wind');
          place(e, `${Math.round(H.wind.mph)}mph ${directionLabel(H.wind.dir)} <b>${H.wind.q === 'off' ? 'offshore' : H.wind.q === 'cross' ? 'cross' : 'onshore'}</b>`, 'sp-pill-wind');
        }
        if (L && L.h != null && L.d != null) {
          const out = L.cls === 'dir-out';
          const e = arrow(L.d, lenFor(L.h, L.p), out ? 'sp-arw-blocked' : 'sp-arw-swell');
          place(e, `<b>${L.h.toFixed(1)}ft @ ${L.p != null ? Math.round(L.p) : '-'}s</b> ${directionLabel(L.d)}`, out ? 'sp-pill-blocked' : 'sp-pill-swell');
        }
      }
      const [lmx, lmy] = pt(b, R * 0.95), [lbx, lby] = pt(a, R * 0.86);
      pill(lmx - 6, Math.min(lmy, Hh - 10), 'Montauk Pt', 'sp-pill-land', 'r', true);
      pill(lbx + 6, Math.min(lby + 8, Hh - 10), 'SW Pt (Block)', 'sp-pill-land', 'l', true);
      const [rlx, rly] = pt(LINEUP_REEF_HEADING, R * 0.5);
      pill(rlx, rly, 'reef 335' + DEG, 'sp-pill-land', 'c', true);
      s += `<circle class="sp-lineup-dot" cx="${cx}" cy="${cy}" r="3.5"/>`;
      svg.innerHTML = s;
      if (pills) pills.innerHTML = html.join('');
      gradeScene(H && !H.isNow ? H.t.getTime() : Date.now());
    };

    // Day labels are buttons: tap a day, land on its incoming window.
    renderDayLabels = function (common) {
      const host = $('forecast-day-header');
      if (!host) return;
      host.replaceChildren();
      const W = host.clientWidth;
      const plotW = W - FC_PAD.left - FC_PAD.right;
      if (W <= 0 || plotW <= 0) return;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (let off = 0; off < common.dayCount; off++) {
        const d0 = new Date(common.firstDay); d0.setDate(d0.getDate() + off);
        const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
        const a = Math.max(_fcXFor(d0, common, FC_PAD.left, plotW), FC_PAD.left);
        const b = Math.min(_fcXFor(d1, common, FC_PAD.left, plotW), FC_PAD.left + plotW);
        if (b <= a + 8) continue;
        const dd = Math.round((d0 - today) / 86400e3);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'forecast-day-label';
        btn.dataset.day = dd;
        btn.style.left = a + 'px';
        btn.style.width = (b - a) + 'px';
        btn.textContent = dd === 0 ? 'Today' : (b - a) >= 60 ? d0.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d0.getDate() : d0.toLocaleDateString('en-US', { weekday: 'short' });
        btn.addEventListener('click', () => jumpDay(dd));
        host.appendChild(btn);
      }
    };

    // ── Follow the hour everywhere ──────────────────────────────────
    const appApply = applyScrubberToHour;
    applyScrubberToHour = function (idx) {
      appApply(idx);
      try { renderHour(idx); } catch (e) { console.warn('sp hour', e); }
      // The cursor spans the three plots only, not the labels above them.
      const ch = document.querySelector('#forecast-chart-container .forecast-crosshair');
      const sw = document.querySelector('#forecast-chart-container .forecast-card-swell canvas');
      const td = document.querySelector('#forecast-chart-container .forecast-card-tide canvas');
      if (ch && sw && td && td.offsetHeight) {
        const top = (n) => { let y = 0; while (n && n.id !== 'forecast-chart-container') { y += n.offsetTop; n = n.offsetParent; } return y; };
        const a = top(sw), b = top(td) + td.offsetHeight;
        ch.style.top = a + 'px'; ch.style.height = (b - a) + 'px';
      }
    };
    const appDraw = drawForecastChart;
    drawForecastChart = function () {
      appDraw.apply(null, arguments);
      try { renderWeek(); } catch (e) { console.warn('sp week', e); }
      try { const i = getScrubberIndex(); if (i >= 0) renderHour(i); } catch (e) { console.warn('sp hour', e); }
    };

    // ── Status bar mirrors the header's honest age line ─────────────
    function syncStatus() {
      const src = $('header-update-time'), out = $('sp-sb-updated'), sb = $('sp-status');
      if (!src || !out || !sb) return;
      const t = src.textContent.trim();
      out.textContent = t || (STATE.lastLoadCompletedAt ? 'Refreshing...' : 'Loading forecast...');
      sb.classList.toggle('is-stale', src.classList.contains('is-stale'));
      sb.classList.toggle('is-busy', !t);
      const ba = (($('val-swell-arrival') || {}).textContent || '');
      const m = /Buoy obs ([^(]+)\(([^)]+)\)/.exec(ba);
      const bEl = $('sp-sb-buoy');
      if (bEl) {
        bEl.textContent = m ? 'Buoy ' + m[1].trim() : 'Buoy --';
        const old = /(\d+)h/.exec(m ? m[2] : '');
        bEl.classList.toggle('is-old', !!(old && +old[1] >= 6));
        bEl.classList.toggle('is-warn', !!(old && +old[1] >= 2 && +old[1] < 6));
      }
    }
    new MutationObserver(syncStatus).observe($('header-update-time'), { childList: true, characterData: true, subtree: true, attributes: true });
    setInterval(syncStatus, 15000);
    document.addEventListener('DOMContentLoaded', syncStatus);

    // ── Surf Log: 20-second logging ─────────────────────────────────
    function slBuild() {
      const fs = document.querySelector('#panel-surflog-form fieldset');
      if (!fs || $('sp-log')) return;
      const leg = fs.querySelector('legend');
      if (leg) leg.textContent = 'Log a session';
      const ui = node('div', 'sp-log', '');
      ui.id = 'sp-log';
      const rate = (key, sid, label) => `<div class="sp-rate" data-for="${sid}"><div class="sp-rate-head"><span class="sp-rate-k">${label}</span><span class="sp-rate-desc" id="sp-desc-${key}">Tap to rate</span></div>` +
        `<div class="sp-rate-row" role="radiogroup" aria-label="${label}">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button type="button" class="sp-rbtn" data-v="${n}" role="radio" aria-checked="false">${n}</button>`).join('')}</div></div>`;
      ui.innerHTML =
        '<div class="sp-log-when"><span class="sp-rate-k">When</span><div class="sp-chips" id="sp-when-chips"></div></div>' +
        '<div class="sp-log-cond" id="sp-log-cond"></div>' +
        rate('size', 'sl-size', 'Size') + rate('wind', 'sl-wind-quality', 'Wind') + rate('ride', 'sl-ride-quality', 'Ride') +
        '<div class="sp-log-row sp-log-extra"><button type="button" class="sp-btn" id="sp-log-notes">Notes...</button>' +
        '<label class="sp-btn" for="sl-photo-file">' + CAM_SVG + ' Photo</label></div>' +
        '<button type="button" class="sp-btn sp-btn-default sp-save" id="sp-save" disabled>Save session</button>' +
        '<div class="sp-log-hint" id="sp-save-hint">Rate size, wind and ride to save. Conditions fill themselves in.</div>';
      (leg || fs.firstChild).after(ui);
      ui.querySelectorAll('.sp-rate').forEach(r => {
        const s = $(r.dataset.for);
        r.addEventListener('click', ev => {
          const b = ev.target.closest('.sp-rbtn');
          if (!b || !s) return;
          s.value = b.dataset.v;
          s.dispatchEvent(new Event('input', { bubbles: true }));
          r.querySelectorAll('.sp-rbtn').forEach(x => { const on = +x.dataset.v <= +b.dataset.v; x.classList.toggle('lit', on); x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
          const key = r.dataset.for === 'sl-size' ? 'size' : r.dataset.for === 'sl-wind-quality' ? 'wind' : 'ride';
          const fn = key === 'size' ? getSizeDesc : key === 'wind' ? getWindDesc : getRideDesc;
          $('sp-desc-' + key).textContent = b.dataset.v + ' - ' + fn(b.dataset.v);
          slSync();
        });
      });
      $('sp-save').addEventListener('click', () => $('sl-save-btn') && $('sl-save-btn').click());
      $('sp-log-notes').addEventListener('click', () => { fs.classList.toggle('sp-show-notes'); $('sl-notes') && $('sl-notes').focus(); });
      slWhen();
    }
    function slSync() {
      const save = $('sl-save-btn'), mine = $('sp-save');
      if (save && mine) mine.disabled = save.disabled;
      const hint = $('sp-save-hint');
      if (hint && save) hint.textContent = save.disabled ? 'Rate size, wind and ride to save. Conditions fill themselves in.' : 'Ready. Conditions are looked up and saved with it.';
    }
    function slSetWhen(ms, chip) {
      const dt = $('sl-datetime');
      if (!dt) return;
      const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      dt.value = d.toISOString().slice(0, 16);
      dt.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelectorAll('#sp-when-chips .sp-chip').forEach(c => c.classList.toggle('on', c === chip));
      // The conditions line comes from the forecast the app already has.
      const cs = STATE.forecastChart, out = $('sp-log-cond');
      if (cs && out) {
        const i = findHourIndexForTime(ms, cs);
        const H = i >= 0 && Math.abs(cs.times[i].getTime() - ms) < 90 * 60e3 ? hourAt(i) : null;
        out.innerHTML = H
          ? `<span class="sp-rate-k">Conditions</span><span class="sp-log-cond-v">${H.lead.h.toFixed(1)}ft @ ${Math.round(H.lead.p)}s ${directionLabel(H.lead.d)} <b class="sp-tag sp-tag-${H.lead.cls === 'dir-out' ? 'out' : H.lead.cls === 'dir-edge' ? 'edge' : 'in'}">${WIN[H.lead.cls]}</b><br>` +
            (H.tide ? `tide ${H.tide.v.toFixed(1)}ft ${H.tide.rising ? 'rising' : 'falling'}` : 'tide --') + ', ' +
            (H.wind ? `wind ${Math.round(H.wind.mph)} ${directionLabel(H.wind.dir)} ${WQ[H.wind.q] || ''}` : 'wind --') + `<small>filled in from the forecast; checked against the archive on save</small></span>`
          : '<span class="sp-rate-k">Conditions</span><span class="sp-log-cond-v">looked up from the archive when you save</span>';
      }
    }
    function slWhen() {
      const host = $('sp-when-chips');
      if (!host) return;
      const now = Date.now();
      const fd = STATE.forecastData || {};
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const lows = (fd.tideHiLo || []).filter(p => p.type === 'L').map(p => new Date(p.t).getTime())
        .filter(t => t >= d0.getTime() && t <= now && isDaylight(t));
      const chips = [];
      if (lows.length) { const c = clock(lows[lows.length - 1]); chips.push([lows[lows.length - 1], `This morning's low <b>${c.hm} ${c.ap}</b>`]); }
      chips.push([now - 2 * 3600e3, '2 h ago']);
      chips.push([now, 'Now']);
      host.innerHTML = chips.map((c, k) => `<button type="button" class="sp-chip" data-ms="${c[0]}">${c[1]}</button>`).join('') +
        '<button type="button" class="sp-chip sp-chip-other">Other...</button>';
      host.querySelectorAll('.sp-chip').forEach(c => c.addEventListener('click', () => {
        if (c.classList.contains('sp-chip-other')) { document.querySelector('#panel-surflog-form fieldset').classList.add('sp-show-dt'); return; }
        slSetWhen(+c.dataset.ms, c);
      }));
      const first = host.querySelector('.sp-chip');
      if (first) slSetWhen(+first.dataset.ms, first);
    }
    // Past sessions as cards on every width.
    function slCards() {
      const host = $('sp-sessions') || (() => {
        const wrap = document.querySelector('#panel-surflog-entries fieldset');
        if (!wrap) return null;
        const leg = wrap.querySelector('legend'); if (leg) leg.textContent = 'Past sessions';
        const f = node('div', 'sp-chips sp-filter', '<button type="button" class="sp-chip on" data-f="all">All</button><button type="button" class="sp-chip" data-f="mine">Mine</button><button type="button" class="sp-chip" data-f="good">7+ avg</button><button type="button" class="sp-chip" data-f="photo">With photos</button>');
        f.id = 'sp-filter';
        const list = node('div', 'sp-sessions', ''); list.id = 'sp-sessions';
        const note = wrap.querySelector('.sl-crowdsource-note');
        (note || wrap.firstChild).after(f);
        f.after(list);
        f.addEventListener('click', ev => { const c = ev.target.closest('.sp-chip'); if (!c) return; f.querySelectorAll('.sp-chip').forEach(x => x.classList.toggle('on', x === c)); slCards(); });
        const more = node('details', 'sp-more sp-log-more', '<summary><span class="sp-tw">' + TRI_R + '</span>Export, import, re-fetch</summary>');
        const ex = $('sl-export-row'); if (ex) more.appendChild(ex);
        wrap.appendChild(more);
        return list;
      })();
      if (!host) return;
      const f = (document.querySelector('#sp-filter .sp-chip.on') || {}).dataset;
      const me = window._fbUserId;
      let rows = (STATE.surfLog || []).slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
      if (f && f.f === 'mine') rows = rows.filter(e => e.userId === me);
      if (f && f.f === 'photo') rows = rows.filter(e => e.photos && e.photos.length);
      const avgOf = e => { const r = e.ratings || {}; const v = [r.size, r.windQuality, r.rideQuality].filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      if (f && f.f === 'good') rows = rows.filter(e => (avgOf(e) || 0) >= 7);
      const cell = (k, v) => `<span class="sp-rc sp-rc-${v >= 7 ? 'hi' : v >= 4 ? 'mid' : 'lo'}"><small>${k}</small>${v != null ? v : '-'}</span>`;
      host.innerHTML = rows.slice(0, 40).map(e => {
        const t = new Date(e.timestamp);
        const own = e.userId === me;
        const avg = avgOf(e);
        const c = e.conditions && e.conditions.swell;
        const ph = e.photos && e.photos[0] ? (typeof photoUrl === 'function' ? photoUrl(e.photos[0]) : e.photos[0].url) : null;
        const incomplete = typeof isLogEntryIncomplete === 'function' && isLogEntryIncomplete(e);
        return `<div class="sp-sess${own ? ' is-own' : ''}${incomplete ? ' is-incomplete' : ''}" data-id="${esc(e.id)}" tabindex="0">` +
          (ph ? `<img class="sp-sess-ph" src="${esc(ph)}" alt="">` : `<span class="sp-sess-ph sp-sess-noph">${WAVE_SVG}</span>`) +
          `<span class="sp-sess-main"><span class="sp-sess-when"><b>${t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</b> ${esc(formatTime(t))} <span class="sp-who">${own ? 'you' : esc(e.displayName || 'crew')}</span></span>` +
          `<span class="sp-sess-cond">${c ? `${(+c.height).toFixed(1)}ft @ ${Math.round(c.period)}s ${directionLabel(c.direction)}` : '<b class="sp-warn">conditions missing</b>'}${e.notes ? ', ' + esc(String(e.notes).slice(0, 40)) : ''}</span></span>` +
          `<span class="sp-sess-r">${cell('size', e.ratings && e.ratings.size)}${cell('wind', e.ratings && e.ratings.windQuality)}${cell('ride', e.ratings && e.ratings.rideQuality)}` +
          `<span class="sp-rc sp-rc-avg"><small>avg</small>${avg != null ? avg.toFixed(1) : '-'}</span></span>` +
          `</div>`;
      }).join('') || '<div class="sp-empty">No sessions yet. Your first one trains the model.</div>';
    }
    const appRenderLog = renderSurfLogTable;
    renderSurfLogTable = function () {
      appRenderLog.apply(null, arguments);
      try { slBuild(); slCards(); slSync(); } catch (e) { console.warn('sp log', e); }
    };
    const appSwitch = switchTab;
    switchTab = function (tab) {
      appSwitch(tab);
      body.dataset.tab = tab;
      if (tab === 'surflog') { try { slBuild(); slWhen(); slCards(); slSync(); } catch (e) { console.warn('sp log', e); } }
      window.scrollTo(0, 0);
    };
    body.dataset.tab = 'forecast';
    setInterval(() => { applyScheme(); }, 60000);
  }

  // ════════════════════════════════════════════════════════════════════
  // CHOC TV
  // ════════════════════════════════════════════════════════════════════
  if (TV) {
    // Strength of the phosphor bloom: owner's choice (they once wrote "no
    // synthetic glow"), so it is a token with an off switch, ?kioskFx=.
    let FX = 'subtle';
    try { const q = new URLSearchParams(location.search).get('kioskFx'); if (/^(off|subtle|strong)$/.test(q)) FX = q; } catch (_) {}
    window.spSetFx = function (v) { FX = v; body.dataset.fx = v; };
    window.spSetFx(FX);

    // Palette additions for the shared chart drawers on the TV.
    Object.assign(FC_RETRO, {
      inFill: 'rgba(69,255,154,0.20)', inFillTop: 'rgba(69,255,154,0.42)', inRim: 'rgba(200,255,225,0.0)', swellStroke: '#45ff9a',
      ghostHatch: 'rgba(69,255,154,0.16)', ghostEdge: 'rgba(69,255,154,0.25)', twilight: '0,0,0', dawnGlow: '69,255,154',
      windBandInk: 'rgba(69,255,154,0.75)', dirOut: 'rgba(69,255,154,0.35)', selDay: 'rgba(69,255,154,0.035)',
      period: 'rgba(185,255,217,0.55)', nightShade: 'rgba(0,0,0,0.5)'
    });

    // Ghost segments under every DSEG readout.
    kioskSegHTML = function (text, extraClass) {
      const t = String(text);
      return `<span class="np-seg ${extraClass || ''}"><span class="np-ghost" aria-hidden="true">${ghostOf(t)}</span><span class="np-lit">${t}</span></span>`;
    };

    // Moon as a phosphor disc with a terminator (no colour emoji).
    function moonSVG(date) {
      const syn = 29.530588853 * 86400e3, epoch = Date.UTC(2000, 0, 6, 18, 14);
      const frac = (((date.getTime() - epoch) % syn) + syn) % syn / syn;
      const k = Math.cos(2 * Math.PI * frac);       // 1 new → −1 full
      const waxing = frac < 0.5;
      const rx = Math.abs(k) * 20;
      // Lit limb on the right while waxing (northern hemisphere).
      const sweepOuter = waxing ? 1 : 0;
      const sweepInner = (k > 0) === waxing ? 0 : 1;
      return `<svg class="sp-moon" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" class="sp-moon-dark"/>` +
        `<path class="sp-moon-lit" d="M24 4 A20 20 0 0 ${sweepOuter} 24 44 A${rx.toFixed(2)} 20 0 0 ${sweepInner} 24 4 Z"/></svg>`;
    }

    function tvWindows(s, off) {
      const fd = STATE.forecastData || {};
      const ev = (fd.tideHiLo || []).map(p => ({ t: new Date(p.t).getTime(), type: p.type })).sort((a, b) => a.t - b.t);
      const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() + off);
      const dl = sun(d0);
      return (s.lows || []).map(lo => {
        const hi = ev.find(p => p.type === 'H' && p.t > lo.t);
        const end = hi ? hi.t : lo.t + 6.2 * 3600e3;
        const a = dl.sunrise ? Math.max(lo.t, dl.sunrise.getTime()) : lo.t;
        const b = dl.sunset ? Math.min(end, dl.sunset.getTime()) : end;
        return { low: lo.t, wind: lo.wind, start: a, end: b, daylight: b > a + 45 * 60e3 };
      });
    }
    const QW = { off: 'OFFSHORE', cross: 'CROSS', on: 'ONSHORE' };
    function tvCard(s, off) {
      const now = Date.now();
      const P = s.primary, S2 = s.secondary;
      const wins = tvWindows(s, off);
      const range = P ? (P.min === P.max ? String(P.max) : `${P.min}-${P.max}`) : null;
      const cls = P ? (P.cls || 'dir-in') : '';
      const lowRow = (w, k) => {
        if (!w) return '<div class="sp-tv-low is-empty"></div>';
        const c = clock(w.low);
        const passed = w.daylight ? w.end < now : w.low < now;
        const q = w.wind ? windQual(w.wind.dir, w.wind.mph) : null;
        if (!w.daylight) {
          return `<div class="sp-tv-low is-dark${passed ? ' is-past' : ''}"><span class="np-legend">LOW</span>${kioskSegHTML(c.hm, 'sp-tv-seg-dark')}<span class="np-unit">${c.ap}</span><span class="sp-tv-dark">IN THE DARK</span></div>`;
        }
        const e = clock(w.end), st = clock(w.start);
        const live = w.start <= now && w.end > now;
        return `<div class="sp-tv-low${passed ? ' is-past' : ''}${live ? ' is-live' : ''}">` +
          // The session: the incoming window from the daylight low (start
          // big, end smaller), clipped to daylight.
          `<div class="sp-tv-low-t"><span class="np-legend">${live ? 'INCOMING NOW' : 'LOW ' + (w.start !== w.low ? c.hm + ' ' + c.ap + ' ' : '') + 'INCOMING'}</span>` +
          `<span class="sp-tv-span">${kioskSegHTML(st.hm, 'sp-tv-seg-low')}<span class="np-unit">${st.ap}</span></span>` +
          `<span class="sp-tv-until"><span class="sp-tv-to">UNTIL</span>${kioskSegHTML(e.hm, 'sp-tv-seg-low2')}<span class="np-unit">${e.ap}</span></span></div>` +
          (w.wind ? `<div class="sp-tv-wind sp-q-${q}">${kioskDialHTML(w.wind.dir, Math.round(w.wind.mph), 'MPH')}<span class="sp-tv-q">${QW[q] || ''}</span></div>` : '') +
          `</div>`;
      };
      const day = wins.filter(w => w.daylight), dark = wins.filter(w => !w.daylight);
      const rows = day.concat(dark).slice(0, 2);
      const sr = s.sun.sunrise ? clock(s.sun.sunrise.t) : null, ss = s.sun.sunset ? clock(s.sun.sunset.t) : null;
      const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() + off);
      const secOut = S2 && S2.cls === 'dir-out';
      return `<div class="np-day sp-tv-card ${cls}">` +
        `<div class="np-day-title"><span>${s.label}</span><span class="sp-tv-date">${d0.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</span></div>` +
        (P ? `<div class="sp-tv-hero">` +
            `<div class="sp-tv-hero-n">${kioskSegHTML(range, 'sp-tv-xl')}<span class="np-unit sp-tv-ft">FT</span></div>` +
            `<div class="sp-tv-hero-p"><span class="np-at">@</span>${kioskSegHTML(P.period != null ? P.period : '-', 'sp-tv-l')}<span class="np-unit np-unit-tight">s</span>` +
              kioskArrowHTML(P.dir, P.dir != null ? `<span class="np-ao-num">${directionLabel(P.dir)}</span><span class="np-ao-cap">${Math.round(P.dir)}°</span>` : '', 'sp-tv-arrow') +
            `</div>` +
            `<div class="sp-tv-ann">${['dir-in', 'dir-edge', 'dir-out'].map(k => `<span class="${k === cls ? 'on' : ''}">${k === 'dir-in' ? 'IN WINDOW' : k === 'dir-edge' ? 'EDGE' : 'OUT'}</span>`).join('')}</div>` +
            `</div>`
          : `<div class="sp-tv-hero"><span class="np-legend np-dim">NO SWELL DATA</span></div>`) +
        `<div class="sp-tv-lows">${s.tidesDown ? '<div class="sp-tv-low"><span class="np-legend">NOAA TIDES UNAVAILABLE &mdash; ALL-DAY SWELL</span></div>' : lowRow(rows[0]) + lowRow(rows[1])}</div>` +
        (S2 ? `<div class="sp-tv-sec${secOut ? ' is-out' : ''}"><span class="np-legend">ALSO</span>${kioskSegHTML(S2.min === S2.max ? String(S2.max) : `${S2.min}-${S2.max}`, 'sp-tv-s')}<span class="np-unit">FT</span><span class="np-at">@</span>${kioskSegHTML(S2.period != null ? S2.period : '-', 'sp-tv-s')}<span class="np-unit np-unit-tight">s</span>` +
              `<span class="np-legend">${S2.dir != null ? directionLabel(S2.dir) : ''}</span>${secOut ? '<span class="np-out-tag">OUT OF WINDOW</span>' : ''}</div>`
            : '<div class="sp-tv-sec is-empty"></div>') +
        `<div class="sp-tv-foot"><span class="np-legend">SUN</span>${sr ? kioskSegHTML(sr.hm, 'sp-tv-xs') + '<span class="np-unit-sm">' + sr.ap + '</span>' : ''}<span class="sp-tv-dash"></span>${ss ? kioskSegHTML(ss.hm, 'sp-tv-xs') + '<span class="np-unit-sm">' + ss.ap + '</span>' : ''}` +
          `<span class="sp-tv-moon">${moonSVG(new Date(d0.getTime() + 12 * 3600e3))}<span class="np-legend">${s.moon.pct}%</span></span></div>` +
        `</div>`;
    }
    // After the day's last daylight window (or after sunset), lead with
    // tomorrow: the evening crowd is deciding about dawn.
    function tvOffsets() {
      const now = Date.now();
      const s0 = kioskDaySummary(0);
      const wins = tvWindows(s0, 0).filter(w => w.daylight);
      const dl = sun(new Date());
      const over = (dl.sunset && now > dl.sunset.getTime()) || (wins.length && wins.every(w => w.end < now) && now > (dl.sunset ? dl.sunset.getTime() - 2 * 3600e3 : 0));
      return over ? { a: [1, 2, 3], b: [4, 5, 6], tonight: s0 } : { a: [0, 1, 2], b: [3, 4, 5], tonight: null };
    }
    function tonightStrip(s0) {
      const now = Date.now();
      const nextLow = (s0.lows || []).find(l => l.t > now);
      const dlT = sun(new Date(Date.now() + 86400e3));
      const fl = dlT.firstLight ? clock(dlT.firstLight) : null;
      return `<div class="sp-tv-tonight"><span class="np-legend sp-tv-tn-k">TONIGHT</span>` +
        (nextLow ? `<span class="np-legend">LOW ${clock(nextLow.t).hm} ${clock(nextLow.t).ap} — DARK</span>` : '') +
        (fl ? `<span class="np-legend">FIRST LIGHT ${fl.hm} ${fl.ap}</span>` : '') +
        `<span class="sp-tv-moon">${moonSVG(new Date())}<span class="np-legend">MOON ${kioskMoonPhase(new Date()).pct}%</span></span></div>`;
    }
    kioskRenderDays = function () {
      const p1 = $('kiosk-days-1'), p2 = $('kiosk-days-2');
      if (!p1 || !p2) return;
      try {
        const o = tvOffsets();
        p1.className = 'np-days sp-tv-days' + (o.tonight ? ' has-tonight' : '');
        p2.className = 'np-days sp-tv-days';
        p1.innerHTML = (o.tonight ? tonightStrip(o.tonight) : '') + o.a.map(i => tvCard(kioskDaySummary(i), i)).join('');
        p2.innerHTML = o.b.map(i => tvCard(kioskDaySummary(i), i)).join('');
        KIOSK.lastDaysRender = STATE.lastLoadCompletedAt || 0;
        body.classList.toggle('sp-evening', !!o.tonight);
      } catch (err) { console.warn('sp days', err); }
    };

    // ── Home-panel rotation: TODAY is never more than ~30 s away ─────
    KIOSK.panels = ['days1', 'radar', 'days1', 'days2', 'days1', 'spectral'];
    const DWELL = { days1: 30e3, days2: 20e3, radar: 60e3, spectral: 20e3 };
    kioskScheduleNext = function () {
      clearTimeout(KIOSK.rotateTimer);
      if (KIOSK.state !== 'rotating') return;
      const name = KIOSK.panels[KIOSK.idx];
      const ms = KIOSK.rotateMs !== 20000 ? KIOSK.rotateMs : DWELL[name] || 20e3;
      KIOSK.rotateTimer = setTimeout(kioskAdvance, ms);
      const pr = $('sp-progress');
      if (pr) {
        pr.style.animation = 'none'; void pr.offsetWidth;
        pr.style.animation = REDUCED ? 'none' : `sp-progress ${ms}ms steps(${Math.round(ms / 1000)}) forwards`;
      }
      paintPips();
    };
    function paintPips() {
      const host = $('sp-pips');
      if (!host) return;
      host.innerHTML = KIOSK.panels.map((p, i) => `<i class="${i === KIOSK.idx ? 'on' : ''} ${p === 'days1' ? 'home' : ''}"></i>`).join('');
    }
    // Fade through black between panels, like phosphor decay and warm-up.
    const appShow = kioskShowPanel;
    kioskShowPanel = function (name) {
      const veil = $('sp-veil');
      if (!veil || REDUCED || !body.dataset.kioskPanel) { appShow(name); return; }
      veil.classList.add('on');
      setTimeout(() => { appShow(name); requestAnimationFrame(() => requestAnimationFrame(() => veil.classList.remove('on'))); }, 200);
    };

    // ── Radar: still scope at 1 Hz, sweep on the compositor ───────────
    let radarGeom = null;
    kioskRadarLoop = function () { KIOSK_RADAR.raf = null; };
    kioskRadarStart = function () {
      if (KIOSK.radarTimer) { clearTimeout(KIOSK.radarTimer); KIOSK.radarTimer = null; }
      const cs = STATE.forecastChart;
      if (cs && cs.times.length) {
        const n = findHourIndexForTime(Date.now(), cs);
        KIOSK_RADAR.idx = n >= 0 ? n : 0;
        KIOSK_RADAR.home = KIOSK_RADAR.idx;
        STATE.scrubberIdx = KIOSK_RADAR.idx;
        applyScrubberToHour(KIOSK_RADAR.idx);
        const tick = () => {
          kioskRadarTick();
          const t = cs.times[KIOSK_RADAR.idx];
          // Night hours flick past; daylight hours get the full second.
          const ms = t && !isDaylight(t.getTime()) ? KIOSK.radarStepMs / 4 : KIOSK.radarStepMs;
          KIOSK.radarTimer = setTimeout(tick, ms);
        };
        KIOSK.radarTimer = setTimeout(tick, KIOSK.radarStepMs);
      } else KIOSK_RADAR.idx = -1;
      startSweep();
    };
    kioskRadarTick = function () {
      const cs = STATE.forecastChart;
      if (!cs || !cs.times.length || KIOSK.state === 'paused') return;
      const home = KIOSK_RADAR.home != null ? KIOSK_RADAR.home : 0;
      // Only the next 72 h loop: the decision window.
      KIOSK_RADAR.idx = KIOSK_RADAR.idx + 1 > home + 72 || KIOSK_RADAR.idx + 1 >= cs.times.length ? home : KIOSK_RADAR.idx + 1;
      STATE.scrubberIdx = KIOSK_RADAR.idx;
      applyScrubberToHour(KIOSK_RADAR.idx);
    };
    kioskRadarStop = function () {
      if (KIOSK.radarTimer) { clearTimeout(KIOSK.radarTimer); KIOSK.radarTimer = null; if (STATE.forecastChart) resetScrubberToNow(); }
      const sw = $('sp-sweep'); if (sw) sw.classList.remove('run');
    };
    const SWEEP_MS = 10000;
    let sweepEpoch = performance.now();
    function startSweep() {
      const sw = $('sp-sweep');
      if (!sw) return;
      sw.classList.toggle('run', !REDUCED);
      syncEchoes();
    }
    // Echo persistence: each target's lit copy flashes as the beam
    // crosses its bearing and decays over ~2.5 s — an opacity animation on
    // the compositor, phase-locked to the sweep by animation-delay.
    function syncEchoes() {
      const sw = $('sp-sweep');
      if (!sw) return;
      const phase = ((performance.now() - sweepEpoch) % SWEEP_MS);
      sw.style.animationDelay = (-phase) + 'ms';
      document.querySelectorAll('#sp-echo [data-brg]').forEach(n => {
        const brg = +n.dataset.brg;
        n.style.animationDelay = (brg / 360 * SWEEP_MS - phase - SWEEP_MS) + 'ms';
      });
    }
    window.spRadarFreeze = function (angle) {
      // Screenshot aid: hold the beam at `angle` (compass deg) with each
      // echo at the brightness the decay would give it there.
      body.classList.add('sp-frozen');
      const sw = $('sp-sweep');
      if (sw) { sw.style.animation = 'none'; sw.style.transform = `rotate(${angle}deg)`; }
      document.querySelectorAll('#sp-echo [data-brg]').forEach(n => {
        const since = ((angle - +n.dataset.brg) % 360 + 360) % 360 / 360 * SWEEP_MS;
        n.style.animation = 'none';
        n.style.opacity = since < 2500 ? (1 - since / 2500).toFixed(2) : 0;
      });
    };
    kioskRadarPaint = function () {
      const cv = $('kiosk-radar-canvas');
      if (!cv || !cv.clientWidth) return;
      const ctx = cv.getContext('2d');
      const dims = ensureCanvasCssDims(cv, ctx);
      const w = dims.cssW, h = dims.cssH;
      if (!w || !h) return;
      const fd = STATE.forecastData;
      const hr = fd && fd.marine && fd.marine.hourly;
      const i = KIOSK_RADAR.idx;
      const t = hr && i >= 0 && hr.time[i] ? new Date(hr.time[i]) : new Date();
      const night = !isDaylight(t.getTime());
      const FH = h / (1 - 0.15), FW = FH * KIOSK_COAST.aspect;
      const fx = (w - FW) / 2, fy = -0.15 * FH;
      const lx = fx + KIOSK_COAST.lineup[0] * FW, ly = fy + KIOSK_COAST.lineup[1] * FH;
      const rMax = h * 0.62;
      radarGeom = { lx, ly, rMax, w, h };
      const px = p => [fx + p[0] * FW, fy + p[1] * FH];
      const trace = pts => { const [a, b] = px(pts[0]); ctx.moveTo(a, b); for (let k = 1; k < pts.length; k++) { const [x, y] = px(pts[k]); ctx.lineTo(x, y); } };
      const shore = KIOSK_COAST.shore, endY = fy + shore[shore.length - 1][1] * FH;
      const G = a => `rgba(69,255,154,${a})`;
      const k = night ? 0.55 : 1; // night frames recede: land and grid, never the readings
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      // Water: a faint radial "screen" glow centred on the lineup.
      const wg = ctx.createRadialGradient(lx, ly, 0, lx, ly, rMax * 1.05);
      wg.addColorStop(0, G(0.07 * k)); wg.addColorStop(1, G(0.0));
      ctx.fillStyle = wg; ctx.fillRect(0, 0, w, h);
      ctx.beginPath(); trace(shore); ctx.lineTo(w, endY); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = G(0.075 * k); ctx.fill();
      // Rings with range ticks.
      ctx.strokeStyle = G(0.13 * k); ctx.lineWidth = 1;
      for (let r = 1; r <= 3; r++) { ctx.beginPath(); ctx.arc(lx, ly, rMax * r / 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath();
      for (let a = 0; a < 360; a += 10) {
        const th = a * Math.PI / 180, r0 = rMax * (a % 30 ? 0.985 : 0.96);
        ctx.moveTo(lx + Math.sin(th) * r0, ly - Math.cos(th) * r0); ctx.lineTo(lx + Math.sin(th) * rMax, ly - Math.cos(th) * rMax);
      }
      ctx.strokeStyle = G(0.22 * k); ctx.stroke();
      // Cone: brighter the more in-window energy this hour carries.
      const H = hourAt(i);
      const eIn = H ? Math.min(1, H.reefH / 3) : 0;
      const c1 = CONFIG.chocomount.swellWindowMin * Math.PI / 180 - Math.PI / 2, c2 = CONFIG.chocomount.swellWindowMax * Math.PI / 180 - Math.PI / 2;
      const cg = ctx.createRadialGradient(lx, ly, 0, lx, ly, rMax * 0.95);
      cg.addColorStop(0, G(0.05 + 0.16 * eIn)); cg.addColorStop(1, G(0.01 + 0.03 * eIn));
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, rMax * 0.95, c1, c2); ctx.closePath();
      ctx.fillStyle = cg; ctx.fill();
      ctx.strokeStyle = G(0.25 + 0.3 * eIn); ctx.lineWidth = 1.25; ctx.stroke();
      ctx.font = '600 13px "Orbitron", sans-serif'; ctx.fillStyle = G(0.6);
      const edge = (deg, dx, al) => { const th = deg * Math.PI / 180, r = rMax * 0.95 + 12; ctx.textAlign = al; ctx.textBaseline = 'middle'; return [lx + r * Math.sin(th) + dx, ly - r * Math.cos(th)]; };
      let [ex, ey] = edge(CONFIG.chocomount.swellWindowMax, 0, 'center'); ctx.fillText('MONTAUK PT', ex, Math.min(ey, h - 14));
      [ex, ey] = edge(CONFIG.chocomount.swellWindowMin, 6, 'left'); ctx.fillText('SOUTHWEST PT (BLOCK)', ex, ey);
      // Coast + ponds.
      ctx.beginPath(); trace(shore); ctx.lineTo(w, endY);
      ctx.strokeStyle = G(0.85 * (night ? 0.7 : 1)); ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
      for (const pond of KIOSK_COAST.ponds) { ctx.beginPath(); trace(pond); ctx.closePath(); ctx.fillStyle = '#000'; ctx.fill(); ctx.strokeStyle = G(0.35 * k); ctx.lineWidth = 1; ctx.stroke(); }
      // Arrows at base brightness; their lit twins live in #sp-echo.
      const echo = [];
      const arrowGeom = (from, len) => {
        const th = from * Math.PI / 180, ux = Math.sin(th), uy = -Math.cos(th);
        return { hx: lx + ux * 30, hy: ly + uy * 30, tx: lx + ux * (30 + len), ty: ly + uy * (30 + len), ux, uy };
      };
      const drawArrow = (g, width, color, dashed) => {
        const head = 12 + width * 2.2, hw = 6 + width * 1.6;
        const bx = g.hx + g.ux * head, by = g.hy + g.uy * head;
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.setLineDash(dashed ? [11, 8] : []);
        ctx.beginPath(); ctx.moveTo(g.tx, g.ty); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(g.hx, g.hy); ctx.lineTo(bx - g.uy * hw, by + g.ux * hw); ctx.lineTo(bx + g.uy * hw, by - g.ux * hw); ctx.closePath();
        dashed ? (ctx.lineWidth = 2, ctx.stroke()) : ctx.fill();
      };
      const clampL = (v, a, b) => Math.min(b, Math.max(a, v));
      if (H) {
        const O = H.other, L = H.lead;
        if (O && O.h != null && O.d != null && O.h >= 0.3) {
          const out = O.cls === 'dir-out';
          const g = arrowGeom(O.d, clampL(Math.sqrt(O.h * O.h * (O.p || 1)) * 16, 70, rMax * 0.85));
          drawArrow(g, 3.5, G(out ? 0.28 : 0.5), out);
          echo.push({ g, width: 3.5, dashed: out, brg: O.d, label: `${O.h.toFixed(1)}ft @ ${O.p != null ? Math.round(O.p) : '-'}s${out ? '  OUT' : ''}`, dim: out });
        }
        if (H.wind && H.wind.dir != null) {
          const g = arrowGeom(H.wind.dir, clampL(H.wind.mph * 8, 62, rMax * 0.8));
          drawArrow(g, 3, G(0.42), true);
          echo.push({ g, width: 3, dashed: true, brg: H.wind.dir, label: `${Math.round(H.wind.mph)}mph ${QW[H.wind.q] || ''}`, wind: true });
        }
        if (L && L.h != null && L.d != null) {
          const out = L.cls === 'dir-out';
          const g = arrowGeom(L.d, clampL(Math.sqrt(L.h * L.h * (L.p || 1)) * 16, 84, rMax * 0.9));
          drawArrow(g, 6, G(out ? 0.35 : 0.72), out);
          echo.push({ g, width: 6, dashed: out, brg: L.d, label: `${L.h.toFixed(1)}ft @ ${L.p != null ? Math.round(L.p) : '-'}s`, hero: !out });
        }
      }
      ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2); ctx.fillStyle = G(1); ctx.fill();
      ctx.beginPath(); ctx.arc(lx, ly, 12, 0, Math.PI * 2); ctx.strokeStyle = G(0.45); ctx.lineWidth = 1.5; ctx.stroke();
      // Echo layer (SVG over the canvas) + labels.
      const svg = $('sp-echo');
      if (svg) {
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.innerHTML = echo.map(e => {
          const g = e.g, head = 12 + e.width * 2.2, hw = 6 + e.width * 1.6;
          const bx = g.hx + g.ux * head, by = g.hy + g.uy * head;
          const lxp = g.tx + g.ux * 26, lyp = g.ty + g.uy * 22 - 14 * Math.abs(g.ux);
          const tx = Math.max(90, Math.min(w - 90, lxp)), ty = Math.max(20, Math.min(h - 16, lyp));
          return `<g class="sp-echo-t${e.hero ? ' hero' : ''}${e.dim ? ' dim' : ''}${e.wind ? ' wind' : ''}">` +
            `<g class="sp-echo-lit" data-brg="${e.brg}"><line x1="${g.tx.toFixed(1)}" y1="${g.ty.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke-width="${e.width}" ${e.dashed ? 'stroke-dasharray="11 8"' : ''}/>` +
            `<polygon points="${g.hx.toFixed(1)},${g.hy.toFixed(1)} ${(bx - g.uy * hw).toFixed(1)},${(by + g.ux * hw).toFixed(1)} ${(bx + g.uy * hw).toFixed(1)},${(by - g.ux * hw).toFixed(1)}" ${e.dashed ? 'class="hollow"' : ''}/></g>` +
            `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}">${e.label}</text></g>`;
        }).join('');
      }
      // Sweep centre follows the scope geometry.
      const sw = $('sp-sweep');
      if (sw) { sw.style.left = (lx - rMax) + 'px'; sw.style.top = (ly - rMax) + 'px'; sw.style.width = sw.style.height = (2 * rMax) + 'px'; }
      if (!body.classList.contains('sp-frozen')) syncEchoes();
      body.classList.toggle('sp-radar-night', night);
      paintHud(H, t, night);
    };
    function paintHud(H, t, night) {
      const hud = $('sp-hud');
      if (!hud) return;
      const c = clock(t);
      const dh = Math.round((t.getTime() - Date.now()) / 3600e3);
      const day0 = new Date(); day0.setHours(0, 0, 0, 0);
      const dd = Math.floor((t.getTime() - day0.getTime()) / 86400e3);
      const L = H && H.lead;
      const inW = L && L.cls !== 'dir-out';
      document.querySelectorAll('#forecast-day-header .forecast-day-label').forEach((n, k) => n.classList.toggle('is-sel', k === dd));
      hud.innerHTML =
        `<div class="sp-hud-time"><div class="sp-hud-when"><span class="np-legend">${t.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}</span>` +
          `<span class="sp-hud-clock">${kioskSegHTML(c.hm, 'sp-hud-seg')}<span class="np-unit">${c.ap}</span></span>` +
          `<span class="sp-hud-off ${Math.abs(dh) < 1 ? 'is-now' : ''}">${Math.abs(dh) < 1 ? 'NOW' : (dh > 0 ? '+' : '-') + Math.abs(dh) + ' H'}${night ? ' — DARK' : ''}</span></div>` +
        `<div class="sp-hud-week">${[0, 1, 2].map(k => `<i class="${k === dd ? 'on' : k < dd ? 'past' : ''}"><b>${k === 0 ? 'TODAY' : new Date(day0.getTime() + k * 86400e3).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</b></i>`).join('')}</div></div>` +
        (L ? `<div class="sp-hud-read ${inW ? '' : 'is-out'}"><span class="np-legend">${inW ? 'REACHING THE REEF' : 'NOTHING IN THE WINDOW'}</span>` +
          `<span class="sp-hud-big">${kioskSegHTML(L.h != null ? L.h.toFixed(1) : '-', 'sp-hud-h')}<span class="np-unit">FT</span><span class="np-at">@</span>${kioskSegHTML(L.p != null ? Math.round(L.p) : '-', 'sp-hud-p')}<span class="np-unit np-unit-tight">s</span></span>` +
          `<span class="np-legend">${L.d != null ? directionLabel(L.d) + ' ' + Math.round(L.d) + '°' : ''} — ${WIN[L.cls] || ''}</span></div>` : '');
    }

    // Kiosk chart: the playhead glows and spans the swell strip (the app
    // measured it to the hidden tide card, so it had no height on the TV).
    const tvApply = applyScrubberToHour;
    applyScrubberToHour = function (idx) {
      tvApply(idx);
      const cs = STATE.forecastChart, ch = document.querySelector('#forecast-chart-container .forecast-crosshair');
      const card = document.querySelector('#forecast-chart-container .forecast-card-swell');
      if (cs && ch && card && card.offsetHeight) { ch.style.top = card.offsetTop + 'px'; ch.style.height = card.offsetHeight + 'px'; }
    };
    // Kiosk chart: the current day label is lit.
    renderDayLabels = (function (orig) {
      return function (common) {
        orig(common);
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        document.querySelectorAll('#forecast-day-header .forecast-day-label').forEach((n, k) => n.dataset.day = k);
      };
    })(renderDayLabels);

    // Status strip: rotation pips + a 1 Hz progress line; no emoji glyphs.
    function tvChrome() {
      const strip = $('kiosk-status');
      if (strip && !$('sp-pips')) {
        const pips = node('span', 'sp-pips', ''); pips.id = 'sp-pips';
        const spacer = strip.querySelector('.kiosk-status-spacer');
        strip.insertBefore(pips, spacer);
        const pr = node('i', 'sp-progress', ''); pr.id = 'sp-progress';
        strip.appendChild(pr);
        const info = $('kiosk-info'); if (info) info.innerHTML = '<i class="sp-i">i</i> SOURCES';
        const next = $('kiosk-next'); if (next) next.innerHTML = 'NEXT <i class="sp-next-tri"></i>';
        paintPips();
      }
      const radar = $('kiosk-radar');
      if (radar && !$('sp-sweep')) {
        radar.style.position = 'relative';
        const sw = node('div', 'sp-sweep', ''); sw.id = 'sp-sweep';
        const ec = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ec.id = 'sp-echo'; ec.setAttribute('class', 'sp-echo');
        const hud = node('div', 'sp-hud', ''); hud.id = 'sp-hud';
        radar.appendChild(sw); radar.appendChild(ec); radar.appendChild(hud);
      }
      if (!$('sp-veil')) { const v = node('div', 'sp-veil', ''); v.id = 'sp-veil'; body.appendChild(v); }
      if (!$('sp-glass')) { const g = node('div', 'sp-glass', ''); g.id = 'sp-glass'; body.appendChild(g); }
    }
    const appBuild = kioskBuildChrome;
    kioskBuildChrome = function () { appBuild(); tvChrome(); };
    // Time-aware: re-render the cards on the hour so passed windows dim.
    setInterval(() => { if (/^days/.test(body.dataset.kioskPanel || '')) kioskRenderDays(); }, 5 * 60e3);
  }

})();
