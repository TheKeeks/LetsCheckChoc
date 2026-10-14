// ── TEN YEARS, MONTH BY MONTH: a year x month grid of good days (or big swell days, or Choc at
// 3 ft+), and the chosen month as a calendar. A day picked here becomes the page's day: the map's
// Past view and the ocean panels follow it. The Past bar's month opens the same figure over the map
// (one tap from a past day to the ten years, and "Open this day on the map" back).
(function () {
  const host = document.getElementById('decHeat'); if (!host) return;
  const { D, MON, C, css, hCol, st } = window.CHOC;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); p && p.appendChild(e); return e; };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const COMP = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (d) => COMP[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  const key = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  let metric = 'good', sel = null;
  // ── photos from the site's surf log (Firestore surf_logs, read only). The page runs inside the site's
  // Explore and Methods tabs (Explore one frame further down, inside map/), so it borrows the site's Firebase
  // connection and sign-in; opened on its own it connects itself (below). Months and days with photos get a
  // camera; a month lists its photos, a day shows each logged session with its ratings (size, wind, ride) and
  // notes next to the ratings model's score. A session saved, edited or deleted on the site reads the log
  // again (CHOC.reloadLog, message lcc-log through methods-theme.js).
  const PH = { month: {}, day: {}, log: {}, logMonth: {} };
  const CAM = '<svg class="dec-cam" viewBox="0 0 16 12" aria-hidden="true"><path d="M1 3.2h3.2l1.3-1.9h5l1.3 1.9H15v8H1z" fill="currentColor"/><circle cx="8" cy="7" r="2.6" fill="#0b1622"/><circle cx="8" cy="7" r="1.5" fill="currentColor"/></svg>';
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const r10 = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 10 ? v : null);   // a rating is 0-10, or missing
  function session(x) {                                    // the log entry a photo belongs to: its ratings and notes
    const r = (x && x.ratings) || {}, o = { size: r10(r.size), wind: r10(r.windQuality), ride: r10(r.rideQuality), notes: x && typeof x.notes === 'string' ? x.notes.trim().slice(0, 600) : '' };
    const got = [o.size, o.wind, o.ride].filter((v) => v != null); o.avg = got.length === 3 ? (o.size + o.wind + o.ride) / 3 : null;
    return o;
  }
  const hm = (when) => { const h = +when.slice(11, 13), mi = when.slice(14, 16); return isNaN(h) ? '' : `${h % 12 || 12}:${mi} ${h < 12 ? 'am' : 'pm'}`; };
  const okUrl = (u) => typeof u === 'string' && /^https:\/\/[^"'<>\s]+$/.test(u);   // plain https links only: they go into src/href
  // the surf log: [{when: 'YYYY-MM-DDTHH:MM' (Eastern), ratings, notes, who, photos: [url]}], with or without photos
  function setLog(list) {
    PH.month = {}; PH.day = {}; PH.log = {}; PH.logMonth = {};
    for (const e of list || []) {
      if (!e || typeof e.when !== 'string') continue;
      const iso = e.when.slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      const se = Object.assign(session(e), { when: e.when, who: typeof e.who === 'string' ? e.who.trim().split(/\s+/)[0].slice(0, 30) : '', photos: [] });   // first name only
      for (const u of e.photos || []) if (okUrl(u)) {
        const q = { when: e.when, url: u, s: se }; se.photos.push(q);
        (PH.month[iso.slice(0, 7)] = PH.month[iso.slice(0, 7)] || []).push(q); (PH.day[iso] = PH.day[iso] || []).push(q);
      }
      (PH.log[iso] = PH.log[iso] || []).push(se); PH.logMonth[iso.slice(0, 7)] = (PH.logMonth[iso.slice(0, 7)] || 0) + 1;
    }
    for (const k in PH.month) PH.month[k].sort((a, b) => (a.when < b.when ? -1 : 1));
    for (const k in PH.log) PH.log[k].sort((a, b) => (a.when < b.when ? -1 : 1));
    draw(); month();
  }
  function setPhotos(list) {                               // [{when, url, log?: {ratings, notes, who}}]: one session per log entry
    const by = new Map();
    for (const q of list || []) { if (!q || typeof q.when !== 'string') continue; const k = q.log || q.when; if (!by.has(k)) by.set(k, Object.assign({ when: q.when, photos: [] }, q.log || {})); by.get(k).photos.push(q.url); }
    setLog([...by.values()]);
  }
  window.CHOC.setPhotos = setPhotos; window.CHOC.setLog = setLog;
  // Opened on its own (the site's address, outside the tab) it connects to the same Firebase project itself:
  // the same SDK version as the site, the default app so it reuses the visitor's existing sign-in on this
  // address, and an anonymous sign-in only if there is none (as the site does). It only reads.
  const FB_CFG = { apiKey: 'AIzaSyBWuLMPKGS91HSOzmQALinQl3w5FwkIdIs', authDomain: 'letscheckchoc.firebaseapp.com', projectId: 'letscheckchoc', storageBucket: 'letscheckchoc.firebasestorage.app', messagingSenderId: '801516961544', appId: '1:801516961544:web:c28584674e5be4643e36bd' };
  const script = (src) => new Promise((ok, no) => { const t = document.createElement('script'); t.src = src; t.onload = ok; t.onerror = no; document.head.appendChild(t); });
  async function ownFirestore() {
    if (!/(^|\.)thekeeks\.github\.io$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) return null;   // Firebase only accepts the site's own address
    const V = 'https://www.gstatic.com/firebasejs/9.23.0/';
    if (!window.firebase) { await script(V + 'firebase-app-compat.js'); await Promise.all([script(V + 'firebase-auth-compat.js'), script(V + 'firebase-firestore-compat.js')]); }
    const fb = window.firebase; if (!(fb.apps && fb.apps.length)) fb.initializeApp(FB_CFG);
    const auth = fb.auth();
    const user = await new Promise((ok) => { const off = auth.onAuthStateChanged((u) => { off(); ok(u); }); });
    if (!user) await auth.signInAnonymously();
    return fb.firestore();
  }
  // the site's window when the page is framed by it (Methods: the parent; Explore: the map page's parent), else null
  function siteWindow() {
    let w = window;
    for (let i = 0; i < 3 && w.parent !== w; i++) {
      w = w.parent;
      try { if (w.fbFirestore) return w; } catch (e) { return null; }   // another origin: no access
    }
    return null;
  }
  async function readLog() {
    const P = siteWindow();
    let fs = null;
    if (P) { if (P._fbAuthReady) await P._fbAuthReady; fs = P.fbFirestore; } else fs = await ownFirestore();
    if (!fs) return null;
    const snap = await fs.collection('surf_logs').orderBy('createdAt', 'desc').limit(500).get(), out = [];
    snap.forEach((doc) => { const d = doc.data() || {}; out.push({ when: d.timestamp, ratings: d.ratings, notes: d.notes, who: d.displayName, photos: (d.photos || []).map((ph) => (typeof ph === 'string' ? ph : ph && ph.url)).filter(Boolean) }); });
    return out;
  }
  const showLog = () => readLog().then((out) => { if (out) setLog(out); })
    .catch(() => { /* offline, blocked or not signed in: the log as it was (none at first) */ });
  // the page's own read of the surf log; done (or given up) when this settles, so tests hand the calendar their own
  // photos after it rather than have it replace them
  window.CHOC.logLoaded = showLog();
  // read it again, after the first read. A call while a read runs makes one more read after it, so the last change shows.
  let rereading = null, again = false;
  window.CHOC.reloadLog = () => {
    if (rereading) { again = true; return rereading; }
    rereading = window.CHOC.logLoaded.then(showLog).then(() => {
      rereading = null;
      if (again) { again = false; return window.CHOC.reloadLog(); }
    });
    return rereading;
  };
  // the months the ratings model has sessions from (the history bot fits it to the surf log)
  const logged = new Set(((DATA.model || {}).sessions || []).map((s) => +s.date.slice(5, 7)));
  const CAP = {
    good: 'A good day is one whose best 3 hours score 7/10 or better on the ratings model built from your surf log at Choc. ' +
      (![11, 12, 1, 2, 3, 4, 5].some((m) => logged.has(m)) ? 'Your log has no sessions from November to May, so winter counts are extrapolation.'
        : logged.size < 12 ? 'Months with no logged sessions are extrapolation.' : 'Every month has logged sessions.'),
    big: 'A big swell day has at least 3 hours at 4 ft or more at the buoy, coming from inside the swell window.',
    c3: 'Choc 3 ft+ counts days when the ray model puts Choc at 3 ft or more over its best 3 hours.',
  };
  // per-month counts from the daily rows
  function stats() {
    const dl = st.daylight, out = {};
    for (const x of D) {
      const k = key(x.y, x.m), o = out[k] || (out[k] = { y: x.y, m: x.m, days: 0, good: 0, c3: 0, w3: 0, best: null });
      o.days++;
      if ((x.s[dl] || 0) >= 7) o.good++;
      const c = x.mh[dl]; if (c >= 3) o.c3++;
      const v = DAYS2[x.iso]; if (v && v[4] >= 3) o.w3++;
      if (c != null && (!o.best || c > o.best.mh[dl])) o.best = x;
    }
    const ym = DATA.ym[dl ? 'day' : 'all'];
    for (const k in out) { const v = ym[k]; out[k].big = v ? v[0] : 0; out[k].hours = v ? v[2] : 0; }
    return out;
  }
  function draw() {
    const S = stats(), years = [...new Set(D.map((x) => x.y))].filter((y) => y >= 2016);
    const max = Math.max(1, ...Object.values(S).map((o) => o[metric]));
    const zero = document.documentElement.dataset.researchTheme === 'light' ? '#ebede6' : '#121b24';   // a month with none: a shade off the figure
    const cell = 40, L = 40, T = 20, w = L + cell * 12, h = T + cell * years.length + 4;
    host.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': 'Count per month for each year; tap a month for its days', style: 'min-width:340px' }, host);
    const pat = el('pattern', { id: 'decHatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('defs', {}, svg));
    el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: C.blown, 'stroke-width': 2 }, pat);
    const text = (x, y, s, o = {}) => { const t = el('text', Object.assign({ x, y, fill: C.fg3, 'font-size': 11, 'font-family': css('--mono') }, o), svg); t.textContent = s; return t; };
    MON.forEach((m, i) => text(L + i * cell + cell / 2, 13, m, { 'text-anchor': 'middle' }));
    years.forEach((yr, yi) => {
      text(L - 6, T + yi * cell + cell / 2 + 4, yr, { 'text-anchor': 'end' });
      for (let m = 1; m <= 12; m++) {
        const o = S[key(yr, m)], x = L + (m - 1) * cell, y = T + yi * cell;
        if (!o) { el('rect', { x: x + 1, y: y + 1, width: cell - 2, height: cell - 2, fill: C.panel, stroke: C.rule, rx: 3 }, svg); continue; }
        const thin = o.hours < 300, v = o[metric];
        const g = el('g', { class: 'dec-cell', tabindex: 0, role: 'button', 'aria-label': `${MONTHS[m - 1]} ${yr}: ${v} ${metric === 'good' ? 'good days' : metric === 'big' ? 'big swell days' : 'days at Choc 3 ft or more'}` }, svg);
        el('rect', { x: x + 1, y: y + 1, width: cell - 2, height: cell - 2, rx: 3, fill: thin ? 'url(#decHatch)' : v ? `rgba(240,138,75,${(0.12 + 0.88 * Math.min(1, v / max)).toFixed(2)})` : zero }, g);
        if (sel === key(yr, m)) el('rect', { x: x + 1.5, y: y + 1.5, width: cell - 3, height: cell - 3, rx: 3, fill: 'none', stroke: C.fg, 'stroke-width': 2 }, g);
        if (v) { const t = el('text', { x: x + cell / 2, y: y + cell / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-family': css('--mono'), fill: v / max > 0.55 ? '#1a0e06' : C.fg, 'pointer-events': 'none' }, g); t.textContent = v; }
        if (!PH.month[key(yr, m)] && PH.logMonth[key(yr, m)]) el('circle', { class: 'dec-lg', cx: x + cell - 8, cy: y + 8, r: 2.6, fill: v / max > 0.55 ? '#1a0e06' : '#e7edf2', 'pointer-events': 'none' }, g);
        if (PH.month[key(yr, m)]) { const fo = el('foreignObject', { x: x + cell - 15, y: y + 3, width: 12, height: 10, 'pointer-events': 'none' }, g); fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="color:${v / max > 0.55 ? '#1a0e06' : '#e7edf2'};line-height:0">${CAM}</div>`; }
        const pick = () => { sel = key(yr, m); draw(); month(); if (isOpen() || dock) document.getElementById('decMonth').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
        g.addEventListener('click', pick); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      }
    });
    document.getElementById('decCap').textContent = CAP[metric] + ' Hatched months have under 300 hours of buoy data' + gapNote() + '.';
  }
  // the months short of buoy data, from the history itself (the history bot adds a day every day and fills gaps
  // when late readings arrive): "(gaps in Oct–Nov 2017; the latest month is still filling in)"
  function gapNote() {
    const ym = DATA.ym.all, ks = Object.keys(ym).filter((k) => k >= '2016').sort(), lastK = ks[ks.length - 1], runs = [];
    for (const k of ks) {
      if (k === lastK || ym[k][2] >= 300) continue;
      const [y, m] = k.split('-').map(Number), r = runs[runs.length - 1];
      if (r && r.y === y && r.m1 === m - 1) r.m1 = m; else runs.push({ y, m0: m, m1: m });
    }
    const gaps = runs.map((r) => (r.m0 === r.m1 ? MON[r.m0 - 1] : `${MON[r.m0 - 1]}–${MON[r.m1 - 1]}`) + ' ' + r.y), notes = [];
    if (gaps.length) notes.push('gaps in ' + (gaps.length > 1 ? gaps.slice(0, -1).join(', ') + ' and ' + gaps[gaps.length - 1] : gaps[0]));
    if (lastK && ym[lastK][2] < 300) notes.push('the latest month is still filling in');
    return notes.length ? ' (' + notes.join('; ') + ')' : '';
  }
  function month() {
    const out = document.getElementById('decMonth'); if (!sel) { out.innerHTML = ''; return; }
    const [y, m] = sel.split('-').map(Number), o = stats()[sel]; if (!o) { out.innerHTML = ''; return; }
    const dl = st.daylight, n = new Date(Date.UTC(y, m, 0)).getUTCDate(), first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const tile = (v, t) => `<div class="dec-t"><b>${v}</b><span>${t}</span></div>`;
    let cal = 'SMTWTFS'.split('').map((d) => `<div class="dec-dh">${d}</div>`).join('') + '<div class="dec-pad"></div>'.repeat(first);
    for (let d = 1; d <= n; d++) {
      const iso = `${key(y, m)}-${String(d).padStart(2, '0')}`, i = window.CHOC.dayIndex(iso), x = D[i];
      if (!x) {                                            // no buoy history (yet: it runs through yesterday), maybe a session
        const lg = PH.day[iso] ? CAM : PH.log[iso] ? '<s class="dec-dot" aria-hidden="true"></s>' : '';
        cal += `<div class="dec-d none${PH.day[iso] ? ' ph' : PH.log[iso] ? ' lg' : ''}"${lg ? ` role="img" aria-label="${MONTHS[m - 1]} ${d}: no buoy history yet, ${PH.day[iso] ? 'logged with photos' : 'logged'}"` : ''}><i>${d}</i>${lg}</div>`;
        continue;
      }
      const ft = x.mh[dl], c = hCol(ft || 0), good = (x.s[dl] || 0) >= 7, light = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11 > 140;
      const hasPh = !!PH.day[iso], hasLog = !hasPh && !!PH.log[iso];
      cal += `<button type="button" class="dec-d${good ? ' good' : ''}${st.idx === i ? ' on' : ''}${hasPh ? ' ph' : ''}${hasLog ? ' lg' : ''}" data-i="${i}" style="background:rgb(${c});color:${light ? '#10161c' : '#f2f5f8'}" aria-label="${MONTHS[m - 1]} ${d}: Choc ${ft.toFixed(1)} ft${good ? ', good day' : ''}${hasPh ? ', logged with photos' : hasLog ? ', logged' : ''}"><i>${d}</i><b>${ft.toFixed(1)}</b>${hasPh ? CAM : hasLog ? '<s class="dec-dot" aria-hidden="true"></s>' : ''}</button>`;
    }
    const best = o.best ? `${MON[m - 1]} ${o.best.d}, ${o.best.mh[dl].toFixed(1)} ft at Choc` : '—';
    out.innerHTML = `<div class="dec-mh"><h3>${MONTHS[m - 1]} ${y}</h3><span>${o.days} days with buoy data · biggest: ${best}${PH.logMonth[sel] ? ` · ${PH.logMonth[sel]} session${PH.logMonth[sel] > 1 ? 's' : ''} logged` : ''}</span></div>
      <div class="dec-tiles">${tile(o.good, 'good days')}${tile(o.big, 'big swell days')}${tile(o.c3, 'Choc 3 ft+')}${tile(o.w3, 'Wilderness 3 ft+')}</div>
      <div class="dec-cal">${cal}</div>
      <div class="dec-key"><span><i class="g"></i>good day</span>${PH.logMonth[sel] ? `<span>${CAM} logged, with photos</span><span><s class="dec-dot"></s> logged</span>` : ''}<span>numbers: Choc's best 3 hours (ft), colored like the map</span></div>
      <div class="dec-day" id="decDay"></div>
      ${PH.month[sel] ? `<div class="dec-ph"><div class="dec-ph-h">${CAM} ${PH.month[sel].length} photo${PH.month[sel].length > 1 ? 's' : ''} from the surf log this month</div><div class="dec-ph-row">${PH.month[sel].map((q) => `<a href="${q.url}" target="_blank" rel="noopener" class="dec-ph-a" title="${esc(q.when.slice(0, 10) + (q.s && q.s.who ? ', ' + q.s.who : '') + (q.s && q.s.notes ? ': ' + q.s.notes : ''))}"><img src="${q.url}" alt="Surf log photo, ${q.when.slice(0, 10)}" loading="lazy"><span>${MON[+q.when.slice(5, 7) - 1]} ${+q.when.slice(8, 10)}${q.s && q.s.avg != null ? ` · rated ${q.s.avg.toFixed(1)}` : ''}</span></a>`).join('')}</div></div>` : ''}`;
    out.querySelectorAll('.dec-d[data-i]').forEach((b) => b.addEventListener('click', () => { if (window.CHOC.pastStop) window.CHOC.pastStop(); window.CHOC.jump(+b.dataset.i); }));
    day();
  }
  function sessions(list, model) {                         // the day's logged sessions: who, when, the ratings, the notes, the photos
    const n = (v) => (v == null ? '–' : String(Math.round(v * 10) / 10));
    return list.map((se) => {
      const when = hm(se.when);
      const head = `<div class="dec-log-h">Logged${se.who ? ' by ' + esc(se.who) : ''}${when ? ' at ' + when : ''}: rated <b>${se.avg != null ? se.avg.toFixed(1) + '/10' : '–'}</b> (size ${n(se.size)}, wind ${n(se.wind)}, ride ${n(se.ride)})${model != null ? ` · ratings model for the day <b>${model.toFixed(1)}/10</b>` : ''}</div>`;
      const note = se.notes ? `<blockquote class="dec-log-n">${esc(se.notes)}</blockquote>` : '';
      const pics = se.photos.length ? `<div class="dec-ph-row">${se.photos.map((q) => `<a href="${q.url}" target="_blank" rel="noopener" class="dec-ph-a"><img src="${q.url}" alt="Surf log photo, ${q.when.slice(0, 10)}" loading="lazy"><span>${hm(q.when)}</span></a>`).join('')}</div>` : '';
      return `<div class="dec-log">${head}${note}${pics}</div>`;
    }).join('');
  }
  // the chosen day as short lines: the spots, each swell (1° primary = the biggest share of Choc's energy, 2° the
  // next) at Choc's biggest hour, how much bent in from outside the window, the wind, the buoy
  function day() {                                         // the chosen day, if it falls in the month on show
    const box = document.getElementById('decDay'); if (!box) return;
    const x = D[st.idx]; if (!x || key(x.y, x.m) !== sel) { box.innerHTML = '<p>Tap a day for its details.</p>'; return; }
    const dl = st.daylight, v = DAYS2[x.iso], w = v && v[5], ww = v && v[6], SW = window.CHOC.swell, mx = SW && SW.day(x.iso, 'choc');
    const wind = (q, nm) => (q && q[1] != null ? `${nm} ${window.CHOC.windArrow(q[0])}${q[1]} kn ${compass(q[0])}, <span class="${q[2] ? 'ok' : ''}">${q[2] ? 'clean' : 'not clean'}</span>` : '');
    const winds = [wind(w, 'Choc'), wind(ww, 'Wilderness')].filter(Boolean).join(' · ');
    box.innerHTML = `<div><b>${new Date(Date.UTC(x.y, x.m - 1, x.d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</b></div>
      <div>Choc <b>${x.mh[dl].toFixed(1)} ft</b>${v && v[4] != null ? ` · Wilderness <b>${v[4].toFixed(1)} ft</b>` : ''}${x.s[dl] != null ? ` · ratings model <b>${x.s[dl].toFixed(1)}/10</b>` : ''}</div>
      ${window.CHOC.kv([mx ? [`Swells at ${mx.hr % 12 || 12}${mx.hr < 12 ? 'am' : 'pm'}, Choc's biggest hour`, null] : null, ...(mx ? SW.rows(mx.trains, 3, 'Choc') : []),
        mx && mx.bent != null ? SW.bentRow(mx.bent) : null, winds ? ['Wind', `<span class="dec-w">${winds}</span>`] : null,
        ['Buoy', `${x.hs.toFixed(1)} ft at its peak, all swells`]], 'dec-kv')}
      <button type="button" id="decShow" class="dec-go">Open this day on the map</button>
      ${PH.log[x.iso] ? sessions(PH.log[x.iso], x.s[dl]) : ''}`;
    document.getElementById('decShow').addEventListener('click', () => { closeTen(); window.CHOC.showPast(x.iso); });
  }
  document.querySelectorAll('#decMetric button').forEach((b) => b.addEventListener('click', () => {
    metric = b.dataset.v; document.querySelectorAll('#decMetric button').forEach((q) => q.setAttribute('aria-pressed', String(q === b))); draw();
  }));
  document.querySelectorAll('#decHours button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#decHours button').forEach((q) => q.setAttribute('aria-pressed', String(q === b))); window.CHOC.setDaylight(+b.dataset.v);
  }));
  window.CHOC.onChange(() => { draw(); month(); });
  window.CHOC.onDay((i) => {                               // a day picked anywhere moves the calendar to its month
    const x = D[i]; if (!x) return; const k = key(x.y, x.m);
    if (k !== sel) { sel = k; draw(); month(); } else { document.querySelectorAll('#decMonth .dec-d').forEach((b) => b.classList.toggle('on', +b.dataset.i === i)); day(); }
  });
  // ── over the map: the figure moves into the overlay while it is open, and back after
  const ov = document.getElementById('decOv'), fig = host.closest('figure'), hub = document.querySelector('.hub');
  let home = null;
  const isOpen = () => !!ov && !ov.hidden;
  function openTen() {
    if (!ov || isOpen()) return;
    if (window.CHOC.pastStop) window.CHOC.pastStop();
    home = { parent: fig.parentNode, next: fig.nextSibling };
    document.getElementById('decOvBody').appendChild(fig);
    ov.hidden = false; if (hub) hub.inert = true;
    document.documentElement.style.overflow = 'hidden';
    const x = D[st.idx]; sel = x ? key(x.y, x.m) : sel;                    // the month of the day on the map
    draw(); month();
    document.getElementById('decOvBody').scrollTop = 0;
    document.getElementById('decOvX').focus();
  }
  function closeTen() {
    if (!isOpen()) return;
    ov.hidden = true; if (hub) hub.inert = false;
    document.documentElement.style.overflow = '';
    if (home) home.parent.insertBefore(fig, home.next);
    const b = document.getElementById('pastDec'); if (b && b.offsetParent) b.focus();
  }
  window.CHOC.tenYears = { open: openTen, close: closeTen, isOpen };
  // The Explore tab (?ui=explore): the ten years stay out beside the map (under it on a phone), with the ocean that
  // day under them, instead of opening over it. A day picked there shows on the map straight away, and the Past bar's
  // month button brings them into view.
  const EXPLORE = document.documentElement.dataset.researchUi === 'explore';
  let dock = null;
  if (EXPLORE && hub) {
    dock = document.createElement('aside'); dock.id = 'exDock'; dock.className = 'ex-dock'; dock.setAttribute('aria-labelledby', 'exDockH');
    dock.innerHTML = '<h2 id="exDockH" class="ex-h">Ten years, month by month</h2><p class="ex-lede">Every month since the buoy went in. Tap a month for its days, a day to see it on the map.</p>';
    dock.appendChild(fig);
    const od = document.getElementById('odWrap'); if (od) dock.appendChild(od);
    hub.after(dock);
  }
  function toTen() {                                       // Explore: the month on show, in the column (or under the map)
    const x = D[st.idx]; if (x) { sel = key(x.y, x.m); draw(); month(); }
    const m = document.getElementById('decMonth'), wideDock = dock && getComputedStyle(dock).overflowY === 'auto';
    if (wideDock) dock.scrollTo({ top: Math.max(0, m.offsetTop - dock.offsetTop - 8), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    else dock.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  if (dock) document.getElementById('pastDec').addEventListener('click', toTen);
  else if (ov) {
    document.getElementById('pastDec').addEventListener('click', openTen);
    document.getElementById('decOvX').addEventListener('click', closeTen);
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeTen(); } });
  }
  { const x = D[st.idx]; sel = x ? key(x.y, x.m) : null; }
  draw(); month();
  addEventListener('lcc-theme-change', () => { draw(); month(); });
})();
