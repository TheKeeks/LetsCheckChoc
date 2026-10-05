// ════════════════════════════════════════════════════════════════════
// CLEAN — log.js (owner: Log part) · ?preview=clean
// ────────────────────────────────────────────────────────────────────
// The Log tab of the "A refined" boards (A2-Phone-Log, A2-Phone-Log-Other,
// A2-Notes "Log time" and "Log ratings"). theme.js loads this file after
// core.js; see previews/clean/CONTRACT.md.
//
// The new form is a face over the app's own surf-log form, which stays in
// the DOM (hidden under html.cl-on). Every value goes into the legacy
// controls and every action is the legacy one, so saving, Firebase, the
// owner-only write guard, photo upload and retry, the conditions lookup
// and the incomplete-entry repair all keep working unchanged:
//   when       → #sl-datetime (spot wall time, "2026-10-01T11:00")
//   ratings    → #sl-size / #sl-wind-quality / #sl-ride-quality + 'input'
//                (the legacy listener clears w1-untouched and repairs)
//   notes      → #sl-notes
//   photos     → #sl-photo-file (picker), #sl-photo-gallery × (remove)
//   conditions → #sl-lookup-btn, run by itself (debounced) when the time
//                changes; the result is the legacy _slConditions
//   save       → #sl-save-btn; cancel edit → #sl-cancel-edit-btn
//   edit/del   → editLogEntry(id) / deleteLogEntry(id), own entries only
// Hooks (call-through wraps, written here because core has no generic
// one): initSurfLogForm (legacy form wired), resetSurfLogForm (saved or
// edit cancelled), renderPhotoGallery (photos changed), addLogEntry /
// updateLogEntry (a save really started).
// Times are America/New_York: the crew's, the fixtures', the spot's.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.CLEAN || window.CLEAN.isTV) return;
  var C = window.CLEAN, F = C.fmt, U = C.util;
  var NB = F.NB, DASH = F.DASH, esc = U.esc, isNum = U.isNum;
  var MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
  var TZ = 'America/New_York';
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PAGE = 20;                  // past sessions shown per "Show more"
  var FUTURE_SLACK = 15 * MIN;    // a session can't start later than this from now
  var LOOKUP_MS = 600;            // debounce for a picked time
  var TYPED_MS = 900;             // … and for a typed one
  var SAVE_WAIT_MS = 45e3;        // longest Save waits for a lookup in flight
  var DAYS_BACK = 5;              // Today, Yesterday, then 4 weekday chips

  var RATINGS = [
    { key: 'size', id: 'sl-size', label: 'Size', word: 'size', desc: 'getSizeDesc' },
    { key: 'windQuality', id: 'sl-wind-quality', label: 'Wind quality', word: 'wind quality', desc: 'getWindDesc' },
    { key: 'rideQuality', id: 'sl-ride-quality', label: 'Ride quality', word: 'ride quality', desc: 'getRideDesc' }
  ];

  // ── State (the legacy form holds the values; this holds the face) ──
  var S = {
    root: null, el: {},
    active: false,          // the Log tab has been shown: lookups may run
    legacyReady: false,     // initSurfLogForm has wired the legacy form
    authSettled: false,     // Firebase has had its chance to restore a session
    sel: 'now',             // now | h1 | h2 | low | other
    when: null,             // { y, m, d, hh, mm } spot wall time of the session
    otherDay: 0,            // 0..DAYS_BACK days back, or 'older'
    dateText: '', timeText: '', ampm: 'AM',
    dateBad: false, timeBad: false,
    lookup: { state: 'idle', dt: '', queued: false, timer: null, dog: null, waiters: [] },
    saving: false, saveStarted: false, saveTimer: null, pendingEdit: null,
    saveSeq: 0,             // bumped when a waiting Save is abandoned
    photoBusy: false,
    shown: PAGE, listHTML: null
  };

  // ════════════════════════════════════════════════════════════════════
  // Spot time (America/New_York) without trusting the device's zone
  // ════════════════════════════════════════════════════════════════════
  var dtfET = null;
  function etParts(ms) {
    if (!dtfET) {
      var o = { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' };
      try { dtfET = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, o)); } catch (_) { dtfET = new Intl.DateTimeFormat('en-US', o); }
    }
    var p = {};
    dtfET.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var hh = +p.hour;
    if (hh === 24) hh = 0;
    return { y: +p.year, m: +p.month, d: +p.day, hh: hh, mm: +p.minute };
  }
  // Spot wall time → instant (two passes cover the DST offset).
  function wallToMs(w) {
    var target = Date.UTC(w.y, w.m - 1, w.d, w.hh || 0, w.mm || 0), guess = target;
    for (var i = 0; i < 3; i++) {
      var p = etParts(guess);
      var diff = target - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
      if (!diff) break;
      guess += diff;
    }
    return guess;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function wallStr(w) { return w.y + '-' + pad(w.m) + '-' + pad(w.d) + 'T' + pad(w.hh) + ':' + pad(w.mm); }
  // "2026-09-27T07:30" (the form's own, wall time) → parts. A zoned ISO
  // string (an import) is an instant: read it in spot time.
  function parseWall(s) {
    s = String(s == null ? '' : s);
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      var d = new Date(s);
      return isFinite(d.getTime()) ? etParts(d.getTime()) : null;
    }
    return { y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mm: +m[5] };
  }
  function nowWall(offsetMs) { return etParts(Date.now() - (offsetMs || 0)); }
  function dayNum(w) { return Math.round(Date.UTC(w.y, w.m - 1, w.d) / DAY); }
  function dayBack(w, k) {
    var t = new Date(Date.UTC(w.y, w.m - 1, w.d - k));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function wdOf(w) { return new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay(); }
  // "Thu 1 Oct" (+ the year when it isn't this one)
  function dateLabel(w) {
    var s = WD[wdOf(w)] + ' ' + w.d + ' ' + MON[w.m - 1];
    return w.y !== nowWall().y ? s + ' ' + w.y : s;
  }
  // "7:30 AM" (no-break space, as fmt.time)
  function timeLabel(w) { return (w.hh % 12 || 12) + ':' + pad(w.mm) + NB + (w.hh < 12 ? 'AM' : 'PM'); }
  function isToday(w) { return dayNum(w) === dayNum(nowWall()); }
  // "Thu 11:00 AM" today, "Tue 29 Sep 7:30 AM" any other day
  function whenShort(w) { return (isToday(w) ? WD[wdOf(w)] : dateLabel(w)) + ' ' + timeLabel(w); }

  // Typed time: "730", "7:30", "1130", "19:30", "7", "7pm". → { hh, mm, forced }
  function parseTime(txt, ampm) {
    var s = String(txt || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var ap = null, m = /\s*([ap])\.?\s*m?\.?$/.exec(s);
    if (m && m.index > 0) { ap = m[1] === 'a' ? 'AM' : 'PM'; s = s.slice(0, m.index).trim(); }
    var hh, mm, c = /^(\d{1,2})\s*[:.h ]\s*(\d{2})$/.exec(s);
    if (c) { hh = +c[1]; mm = +c[2]; }
    else if (/^\d{1,4}$/.test(s)) {
      if (s.length <= 2) { hh = +s; mm = 0; }
      else if (s.length === 3) { hh = +s.charAt(0); mm = +s.slice(1); }
      else { hh = +s.slice(0, 2); mm = +s.slice(2); }
    } else return null;
    if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
    if (hh === 0) return { hh: 0, mm: mm, forced: 'AM' };          // 0030 = 12:30 AM
    if (hh > 12) return { hh: hh, mm: mm, forced: 'PM' };          // 24-hour typing
    var use = ap || ampm || 'AM';
    return { hh: (hh % 12) + (use === 'PM' ? 12 : 0), mm: mm, forced: ap };
  }
  // Typed date: "9/24", "9-24", "9.24", "9 24", "924", "0924", "9/24/25".
  // No year: the latest such day that is not after today.
  function parseDate(txt) {
    var s = String(txt || '').trim(), mo, d, y = null;
    var m = /^(\d{1,2})\s*[\/.\- ]\s*(\d{1,2})(?:\s*[\/.\- ]\s*(\d{2}|\d{4}))?$/.exec(s);
    if (m) { mo = +m[1]; d = +m[2]; if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
    else if (/^\d{3,4}$/.test(s)) { mo = s.length === 3 ? +s.charAt(0) : +s.slice(0, 2); d = +s.slice(-2); }
    else return null;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    var today = nowWall();
    if (y == null) { y = today.y; if (dayNum({ y: y, m: mo, d: d }) > dayNum(today)) y--; }
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null; // 9/31
    return { y: y, m: mo, d: d };
  }

  // ════════════════════════════════════════════════════════════════════
  // The legacy form
  // ════════════════════════════════════════════════════════════════════
  function $(id) { return document.getElementById(id); }
  // Top-level let bindings of app.js (shared global scope of classic scripts).
  function legacyConditions() { try { return typeof _slConditions !== 'undefined' ? _slConditions : null; } catch (_) { return null; } }
  function legacyPhotos() { try { return typeof _slPhotos !== 'undefined' && Array.isArray(_slPhotos) ? _slPhotos.slice() : []; } catch (_) { return []; } }
  function editId() { return (typeof STATE !== 'undefined' && STATE.surfLogEditId) || null; }
  function repairCandidates() { return (typeof STATE !== 'undefined' && Array.isArray(STATE.surfLogEditRepairCandidates)) ? STATE.surfLogEditRepairCandidates : []; }
  function entries() { return (typeof STATE !== 'undefined' && Array.isArray(STATE.surfLog)) ? STATE.surfLog : []; }
  function findEntry(id) { var a = entries(); for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i]; return null; }
  function canLog() { return C.auth().signedIn; }
  function isOwn(e, uid) { return !!(e && uid && e.userId && e.userId === uid); }
  function fire(node, type) { try { node.dispatchEvent(new Event(type, { bubbles: true })); } catch (_) { /* old engine */ } }
  function legacyIsReady() {
    // initSurfLogForm runs in the same synchronous block as selectBuoy.
    if (!S.legacyReady && typeof STATE !== 'undefined' && STATE.selectedBuoy && $('sl-save-btn')) S.legacyReady = true;
    return S.legacyReady;
  }

  function writeLegacyTime() {
    var inp = $('sl-datetime');
    if (!inp || !S.when) return;
    var v = wallStr(S.when);
    if (inp.value !== v) { inp.value = v; fire(inp, 'input'); fire(inp, 'change'); }
  }
  function legacyTime() { var inp = $('sl-datetime'); return inp ? inp.value : ''; }

  function ratingOf(r) {
    var s = $(r.id);
    if (!s || s.classList.contains('w1-untouched')) return null;
    var v = parseInt(s.value, 10);
    return isFinite(v) ? v : null;
  }
  function setRating(r, v) {
    var s = $(r.id);
    if (!s) return;
    s.value = String(v);
    fire(s, 'input');   // legacy: marks it touched, updates its readout, clears a repair flag
    fire(s, 'change');
    renderRatings();
    renderSave();
  }
  function descOf(r, v) {
    try { var f = window[r.desc]; return typeof f === 'function' ? f(v) : ''; } catch (_) { return ''; }
  }

  function pristine() {
    if (editId() || S.sel !== 'now') return false;
    if (RATINGS.some(function (r) { return ratingOf(r) != null; })) return false;
    var n = $('sl-notes');
    if (n && n.value) return false;
    return legacyPhotos().length === 0;
  }

  // ── Conditions lookup (the legacy Lookup button) ──────────────────
  function futureWhen() { return !!S.when && wallToMs(S.when) > Date.now() + FUTURE_SLACK; }
  function lookupSettled() {
    if (S.lookup.timer || S.lookup.state === 'busy') return false;
    if (S.lookup.state === 'future' || futureWhen()) return true;
    return legacyTime() === S.lookup.dt;
  }
  function scheduleLookup(delay) {
    clearTimeout(S.lookup.timer);
    S.lookup.timer = null;
    if (!S.active || !legacyIsReady() || !canLog()) return;
    S.lookup.timer = setTimeout(C.guard('log.lookup', runLookup), delay == null ? LOOKUP_MS : delay);
    renderCond();
  }
  function runLookup() {
    S.lookup.timer = null;
    var btn = $('sl-lookup-btn');
    if (!btn || !legacyIsReady() || !canLog() || S.dateBad || S.timeBad) { renderCond(); settle(); return; }
    writeLegacyTime();
    if (futureWhen()) { S.lookup.state = 'future'; renderCond(); renderSave(); settle(); return; }
    if (btn.disabled) { S.lookup.queued = true; return; }   // one in flight: go again when it lands
    S.lookup.state = 'busy';
    S.lookup.dt = legacyTime();
    S.lookup.queued = false;
    renderCond();
    renderSave();
    btn.click();
    // The handler disables the button until lookupHistoricalConditions
    // answers; if it didn't, nothing is listening (legacy not wired).
    if (!btn.disabled) { lookupDone(); return; }
    // Never sit on "looking up…" for good (a lookup that never answers).
    clearTimeout(S.lookup.dog);
    S.lookup.dog = setTimeout(C.guard('log.lookupDog', function () {
      if (S.lookup.state !== 'busy') return;
      S.lookup.state = 'failed';
      renderCond();
      renderSave();
      settle();
    }), 60e3);
  }
  // The legacy Lookup button came back on: its answer is in _slConditions.
  // ('failed' too: a slow answer can land after the 60 s watchdog.)
  function lookupDone() {
    if (S.lookup.state !== 'busy' && S.lookup.state !== 'failed') return;
    clearTimeout(S.lookup.dog);
    S.lookup.state = legacyConditions() ? 'done' : 'failed';
    if (S.pendingEdit) { var pe = S.pendingEdit; S.pendingEdit = null; onEdit(pe); return; }
    if (S.lookup.queued || legacyTime() !== S.lookup.dt) { S.lookup.queued = false; scheduleLookup(0); }
    renderCond();
    renderSave();
    settle();
  }
  function settle() {
    if (!lookupSettled()) return;
    var w = S.lookup.waiters;
    S.lookup.waiters = [];
    w.forEach(function (fn) { try { fn(); } catch (e) { C.err('log.settle', e); } });
  }
  // Resolves once the conditions match the time on the form (or after ms).
  function whenSettled(ms) {
    return new Promise(function (resolve) {
      if (lookupSettled()) { resolve(true); return; }
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(false); } }, ms);
      S.lookup.waiters.push(function () { if (!done) { done = true; clearTimeout(t); resolve(true); } });
      if (S.lookup.timer) { clearTimeout(S.lookup.timer); S.lookup.timer = null; runLookup(); }
      else if (S.lookup.state !== 'busy') runLookup();
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Choosing the time
  // ════════════════════════════════════════════════════════════════════
  // Today's low that has passed, in daylight (first light to last light):
  // "this morning's low" on the boards. null before the first one.
  function passedLow() {
    var nowMs = Date.now(), key = U.dayKey(new Date(nowMs)), best = null;
    var sun = C.data.sun(new Date(nowMs));
    C.data.tideEvents().forEach(function (e) {
      if (e.type !== 'L' || !e.t) return;
      var t = e.t.getTime();
      if (t > nowMs || U.dayKey(e.t) !== key) return;
      if (sun && sun.firstLight && sun.lastLight && (e.t < sun.firstLight || e.t > sun.lastLight)) return;
      if (sun && sun.alwaysNight) return;
      if (!best || t > best.t.getTime()) best = e;
    });
    return best;
  }

  function setWhen(w, delay) {
    S.when = { y: w.y, m: w.m, d: w.d, hh: w.hh, mm: w.mm };
    writeLegacyTime();
    renderWhen();
    if (futureWhen()) { clearTimeout(S.lookup.timer); S.lookup.timer = null; S.lookup.state = 'future'; settle(); }
    else if (legacyTime() !== S.lookup.dt || S.lookup.state === 'future' || S.lookup.state === 'idle') {
      if (S.lookup.state === 'future') S.lookup.state = 'idle';
      scheduleLookup(delay);
    }
    renderCond();
    renderSave();
  }
  function quick(sel) {
    S.sel = sel;
    S.dateBad = S.timeBad = false;
    if (sel === 'now') setWhen(nowWall());
    else if (sel === 'h1') setWhen(nowWall(HOUR));
    else if (sel === 'h2') setWhen(nowWall(2 * HOUR));
    else if (sel === 'low') { var lo = passedLow(); setWhen(lo ? etParts(lo.t.getTime()) : nowWall()); }
    else if (sel === 'other') { openOther(); renderWhen(); renderSave(); }
  }
  // Other: start from the time already on the form.
  function openOther() {
    var w = S.when || nowWall(), today = nowWall();
    var k = dayNum(today) - dayNum(w);
    S.otherDay = k >= 0 && k <= DAYS_BACK ? k : 'older';
    S.dateText = S.otherDay === 'older' ? w.m + '/' + w.d + (w.y !== today.y ? '/' + pad(w.y % 100) : '') : '';
    S.timeText = (w.hh % 12 || 12) + ':' + pad(w.mm);
    S.ampm = w.hh < 12 ? 'AM' : 'PM';
    S.dateBad = S.timeBad = false;
    syncOtherInputs(true);
  }
  // Day chip / typed date + typed time + AM/PM → the session time.
  function composeOther(delay) {
    var day = S.otherDay === 'older' ? parseDate(S.dateText) : dayBack(nowWall(), S.otherDay);
    var t = parseTime(S.timeText, S.ampm);
    S.dateBad = !day;
    S.timeBad = !t;
    if (t && t.forced && t.forced !== S.ampm) { S.ampm = t.forced; }
    if (day && t) setWhen({ y: day.y, m: day.m, d: day.d, hh: t.hh, mm: t.mm }, delay);
    else { renderWhen(); renderCond(); renderSave(); }
  }

  // Back to a fresh form: after a save, a cancelled edit, a sign-in.
  function resetFace() {
    S.sel = 'now';
    S.otherDay = 0;
    S.dateText = S.timeText = '';
    S.dateBad = S.timeBad = false;
    S.lookup.state = 'idle';
    S.lookup.dt = '';
    var n = S.el.notes;
    if (n) { n.value = ''; growNotes(); }
    setWhen(nowWall());
    renderAll();
  }
  // The legacy form was filled by editLogEntry: show it.
  function syncFromLegacy(entry) {
    var w = parseWall(entry && entry.timestamp) || parseWall(legacyTime()) || nowWall();
    S.when = w;
    S.sel = 'other';
    openOther();
    writeLegacyTime();
    S.lookup.dt = legacyTime();
    var c = legacyConditions();
    if (!c || repairCandidates().indexOf('swell') >= 0) { S.lookup.state = 'idle'; scheduleLookup(0); }
    else S.lookup.state = 'done';
    if (S.el.notes) { var ln = $('sl-notes'); S.el.notes.value = ln ? ln.value : ''; growNotes(); }
    renderAll();
  }

  // ════════════════════════════════════════════════════════════════════
  // Actions
  // ════════════════════════════════════════════════════════════════════
  // An open edit must stay the signed-in surfer's own session. Edit checks
  // the owner, but the legacy form never checks again: sign out and back in
  // as someone else in Settings and the edit stays open, and Save would put
  // the new surfer's ratings and notes on another crew member's session on
  // this device (STATE and the lcc_surfLog copy; saveLogEntryToFirebase
  // refuses, so only the cloud copy is safe). So every auth change and every
  // Save checks again, and Save stays off while the edit isn't yours.
  function foreignEdit() {
    var id = editId();
    if (!id) return '';
    var e = findEntry(id);
    if (!e) return 'This session is no longer in the log. Cancel the edit';
    return isOwn(e, C.auth().uid) ? '' : 'This is another surfer’s session. Cancel the edit';
  }
  function dropForeignEdit() {
    if (!foreignEdit()) return false;
    S.pendingEdit = null;
    S.saving = false;
    S.saveSeq++;         // a Save still waiting on the lookup never clicks
    clearTimeout(S.saveTimer);
    onCancelEdit();      // clears STATE.surfLogEditId, resets the form and the face
    return true;
  }
  function blockReason() {
    if (!legacyIsReady()) return 'Getting the log ready…';
    var fe = foreignEdit();
    if (fe) return fe;
    if (S.sel === 'other' && S.dateBad) return 'Type the date, like 9/24';
    if (S.sel === 'other' && S.timeBad) return 'Type the time, like 730';
    if (futureWhen()) return 'Pick a time that has passed';
    var miss = RATINGS.filter(function (r) { return ratingOf(r) == null; }).map(function (r) { return r.word; });
    if (miss.length) return 'Rate ' + (miss.length === 1 ? miss[0] : miss.slice(0, -1).join(', ') + ' and ' + miss[miss.length - 1]) + ' to save';
    if (repairCandidates().indexOf('swell') >= 0 && S.lookup.state === 'failed') return 'Conditions are still missing. Try the lookup again';
    return '';
  }
  function onSave() {
    if (S.saving || dropForeignEdit() || blockReason()) return;
    var btn = $('sl-save-btn');
    if (!btn) return;
    S.saving = true;
    renderSave();
    var ln = $('sl-notes');
    if (ln && S.el.notes && ln.value !== S.el.notes.value) { ln.value = S.el.notes.value; fire(ln, 'input'); }
    writeLegacyTime();
    var seq = ++S.saveSeq;
    whenSettled(SAVE_WAIT_MS).then(C.guard('log.save', function (ok) {
      // Abandoned while it waited on the lookup (the edit was cancelled, or
      // the account changed): the form it was for is gone.
      if (seq !== S.saveSeq || dropForeignEdit()) return;
      // A lookup still out for an earlier time must not label this one.
      if (!ok && S.lookup.dt !== legacyTime()) { try { _slConditions = null; } catch (_) { /* gone */ } }
      if (btn.disabled || blockReason()) { S.saving = false; renderSave(); return; }
      S.saveStarted = false;
      btn.click();
      if (!S.saveStarted) { S.saving = false; renderSave(); return; }   // the legacy guard refused (it says why)
      clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(function () { if (S.saving) { S.saving = false; renderSave(); } }, 60e3);
    }));
  }
  function onEdit(id) {
    var e = findEntry(id);
    if (!e || !isOwn(e, C.auth().uid) || typeof editLogEntry !== 'function' || S.saving) return;
    clearTimeout(S.lookup.timer);
    S.lookup.timer = null;
    // A lookup still out would land on top of the entry's saved conditions
    // (the legacy handler writes _slConditions when it answers): edit after.
    if (S.lookup.state === 'busy') { S.pendingEdit = id; renderCond(); return; }
    editLogEntry(id);    // fills the legacy form, sets STATE.surfLogEditId, scrolls to the top
    syncFromLegacy(e);
  }
  function onCancelEdit() {
    var b = $('sl-cancel-edit-btn');
    if (b) b.click();    // legacy: clears the edit, resetSurfLogForm → resetFace
    else resetFace();
  }
  function onDelete(id) {
    var e = findEntry(id);
    if (!e || !isOwn(e, C.auth().uid) || typeof deleteLogEntry !== 'function') return;
    var w = parseWall(e.timestamp);
    if (!window.confirm('Delete your session' + (w ? ' from ' + dateLabel(w) : '') + '?')) return;
    if (editId() === id) onCancelEdit();
    var p = deleteLogEntry(id);
    if (p && typeof p.catch === 'function') p.catch(function (er) { C.err('log.delete', er); });
  }
  function onAddPhoto() {
    var f = $('sl-photo-file');
    if (f) f.click();
  }
  function onRemovePhoto(i) {
    var b = document.querySelectorAll('#sl-photo-gallery .sl-photo-remove')[i];
    if (b) b.click();    // legacy splices _slPhotos and re-renders its gallery
  }

  // ════════════════════════════════════════════════════════════════════
  // Rendering
  // ════════════════════════════════════════════════════════════════════
  function chip(act, label, extra) {
    return '<button type="button" class="cl-chip" data-act="' + act + '"' + (extra || '') + ' aria-pressed="false">' + label + '</button>';
  }
  function mount(root) {
    S.root = root;
    root.classList.add('cl-l');
    var cells = function (r) {
      var b = '';
      for (var v = 0; v <= 10; v++) b += '<button type="button" data-rate="' + r.key + '" data-v="' + v + '" aria-pressed="false">' + v + '</button>';
      return b;
    };
    var days = '';
    for (var k = 0; k <= DAYS_BACK; k++) days += chip('day', '', ' data-k="' + k + '"');
    days += chip('day', 'Older', ' data-k="older"');
    root.innerHTML =
      '<div class="cl-l-wait" aria-hidden="true"></div>' +
      '<div class="cl-l-gate" hidden>' +
        '<div class="cl-pad">' +
          '<p class="cl-l-gt">Sign in to log sessions</p>' +
          '<p class="cl-fine cl-l-gf">Sign in with Google in Settings. Your sessions train your model.</p>' +
          '<button type="button" class="cl-btn cl-btn-block" data-act="settings">Open Settings</button>' +
        '</div>' +
      '</div>' +
      '<form class="cl-l-form" hidden novalidate autocomplete="off">' +
        '<div class="cl-l-edit" hidden><span class="cl-l-et"></span>' +
          '<button type="button" class="cl-chip" data-act="cancel">Cancel</button></div>' +
        '<h2 class="cl-h2">When</h2>' +
        '<p class="cl-l-whn" aria-live="polite"><b></b> <span></span></p>' +
        '<div class="cl-chips cl-l-chips" role="group" aria-label="When">' +
          chip('now', 'Now') + chip('h1', '1' + NB + 'h ago') + chip('h2', '2' + NB + 'h ago') +
          chip('low', 'Low') + chip('other', 'Other') +
        '</div>' +
        '<div class="cl-l-other" hidden>' +
          '<div class="cl-chips cl-l-chips cl-l-dayc" role="group" aria-label="Day">' + days + '</div>' +
          '<div class="cl-l-tf cl-l-df" hidden>' +
            '<input class="cl-l-tin cl-l-date" type="text" inputmode="text" enterkeyhint="done" maxlength="10" placeholder="9/24" aria-label="Date, like 9/24" spellcheck="false" autocapitalize="off">' +
          '</div>' +
          '<div class="cl-l-tf">' +
            '<input class="cl-l-tin cl-l-time" type="text" inputmode="numeric" enterkeyhint="done" maxlength="8" placeholder="7:30" aria-label="Time, like 730" spellcheck="false" autocapitalize="off">' +
            '<div class="cl-seg" role="group" aria-label="AM or PM">' +
              '<button type="button" data-act="ampm" data-v="AM" aria-pressed="false">AM</button>' +
              '<button type="button" data-act="ampm" data-v="PM" aria-pressed="false">PM</button>' +
            '</div>' +
          '</div>' +
          '<p class="cl-l-hint">Type the time, like 730. For an older day, tap Older and type the date, like 9/24.</p>' +
        '</div>' +
        '<div class="cl-gap"></div>' +
        '<h2 class="cl-h2">How was it?</h2>' +
        RATINGS.map(function (r) {
          return '<div class="cl-l-rt" data-r="' + r.key + '">' +
            '<div class="cl-l-rl"><b id="cl-l-lab-' + r.key + '">' + r.label + '</b><span class="cl-l-rv"></span></div>' +
            '<div class="cl-l-sc" role="group" aria-labelledby="cl-l-lab-' + r.key + '">' + cells(r) + '</div>' +
          '</div>';
        }).join('') +
        '<div class="cl-l-cond"><div class="cl-l-lab">Conditions, filled in for you</div>' +
          '<div class="cl-l-cv" aria-live="polite"></div>' +
          '<button type="button" class="cl-l-retry" data-act="retry" hidden>Try again</button></div>' +
        '<div class="cl-l-fld"><textarea class="cl-l-notes" rows="1" placeholder="Notes" aria-label="Notes"></textarea></div>' +
        '<div class="cl-l-phs" hidden></div>' +
        '<div class="cl-pad cl-l-addw"><button type="button" class="cl-btn cl-btn-quiet cl-btn-block cl-l-addp" data-act="photo">' +
          C.icon.camera(20) + '<span>Add photo</span></button></div>' +
        '<div class="cl-pad cl-l-savew"><button type="button" class="cl-btn cl-btn-block cl-l-save" data-act="save" disabled>Save</button>' +
          '<p class="cl-l-why" aria-live="polite"></p></div>' +
      '</form>' +
      '<section class="cl-l-past" hidden>' +
        '<div class="cl-gap"></div>' +
        '<h2 class="cl-h2">Past sessions</h2>' +
        '<div class="cl-l-list"></div>' +
        '<div class="cl-pad cl-l-morew" hidden><button type="button" class="cl-btn cl-btn-quiet cl-btn-block" data-act="more">Show more</button></div>' +
      '</section>';
    var q = function (s) { return root.querySelector(s); };
    S.el = {
      wait: q('.cl-l-wait'), gate: q('.cl-l-gate'), form: q('.cl-l-form'),
      edit: q('.cl-l-edit'), editT: q('.cl-l-et'),
      whnB: q('.cl-l-whn b'), whnT: q('.cl-l-whn span'), whn: q('.cl-l-whn'),
      quick: root.querySelectorAll('.cl-l-chips:not(.cl-l-dayc) .cl-chip'),
      low: q('[data-act="low"]'),
      other: q('.cl-l-other'), days: root.querySelectorAll('.cl-l-dayc .cl-chip'),
      dateRow: q('.cl-l-df'), date: q('.cl-l-date'), time: q('.cl-l-time'),
      ampm: root.querySelectorAll('[data-act="ampm"]'),
      cv: q('.cl-l-cv'), retry: q('.cl-l-retry'),
      notes: q('.cl-l-notes'), phs: q('.cl-l-phs'), addp: q('.cl-l-addp'),
      save: q('.cl-l-save'), why: q('.cl-l-why'),
      past: q('.cl-l-past'), list: q('.cl-l-list'), more: q('.cl-l-morew')
    };
    root.addEventListener('click', C.guard('log.click', onClick));
    root.addEventListener('submit', function (e) { e.preventDefault(); });
    // A broken thumbnail falls back to the plain tile.
    root.addEventListener('error', function (e) {
      var t = e.target;
      if (t && t.tagName === 'IMG' && t.parentNode) { t.parentNode.classList.remove('cl-l-has'); t.remove(); }
    }, true);
    S.el.time.addEventListener('input', C.guard('log.time', function () { S.timeText = S.el.time.value; composeOther(TYPED_MS); }));
    S.el.date.addEventListener('input', C.guard('log.date', function () { S.dateText = S.el.date.value; composeOther(TYPED_MS); }));
    [S.el.time, S.el.date].forEach(function (inp) {
      inp.addEventListener('blur', C.guard('log.blur', function () { syncOtherInputs(true); }));
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });
    S.el.notes.addEventListener('input', C.guard('log.notes', function () {
      var ln = $('sl-notes');
      if (ln) { ln.value = S.el.notes.value; fire(ln, 'input'); }
      growNotes();
    }));
    var pf = $('sl-photo-file');
    if (pf) pf.addEventListener('change', C.guard('log.photoPick', function () {
      if (pf.files && pf.files.length) { S.photoBusy = true; renderPhotos(); }
    }));
    var lb = $('sl-lookup-btn');
    if (lb && window.MutationObserver) {
      new MutationObserver(C.guard('log.lookupDone', function () { if (!lb.disabled) lookupDone(); }))
        .observe(lb, { attributes: true, attributeFilter: ['disabled'] });
    }
    try {
      if (window._fbAuthReady && typeof window._fbAuthReady.then === 'function') {
        window._fbAuthReady.then(C.guard('log.authReady', function () { S.authSettled = true; renderAll(); }));
      } else S.authSettled = true;
    } catch (_) { S.authSettled = true; }
    S.when = nowWall();
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || !S.root.contains(b)) return;
    var rate = b.getAttribute('data-rate');
    if (rate) {
      var r = RATINGS.filter(function (x) { return x.key === rate; })[0];
      if (r) setRating(r, +b.getAttribute('data-v'));
      return;
    }
    var act = b.getAttribute('data-act');
    switch (act) {
      case 'now': case 'h1': case 'h2': case 'low': case 'other': quick(act); break;
      case 'day': {
        var k = b.getAttribute('data-k');
        S.otherDay = k === 'older' ? 'older' : +k;
        if (k === 'older') {
          syncOtherInputs(false);
          if (!S.dateText) { S.dateBad = true; renderWhen(); renderCond(); renderSave(); }
          else composeOther();
          try { S.el.date.focus(); } catch (_) { /* fine */ }
        } else composeOther();
        break;
      }
      case 'ampm': S.ampm = b.getAttribute('data-v'); composeOther(); break;
      case 'save': onSave(); break;
      case 'cancel': onCancelEdit(); break;
      case 'retry': S.lookup.state = 'idle'; S.lookup.dt = ''; scheduleLookup(0); break;
      case 'photo': onAddPhoto(); break;
      case 'rmphoto': onRemovePhoto(+b.getAttribute('data-i')); break;
      case 'edit': onEdit(b.getAttribute('data-id')); break;
      case 'delete': onDelete(b.getAttribute('data-id')); break;
      case 'more': S.shown += PAGE; renderList(); break;
      case 'settings': C.openSettings('account'); break;
      default: break;
    }
  }

  function growNotes() {
    var n = S.el.notes;
    if (!n) return;
    n.style.height = 'auto';
    if (n.scrollHeight > 0) n.style.height = Math.max(52, n.scrollHeight + 1) + 'px';
  }
  function setPressed(btn, on) { var v = on ? 'true' : 'false'; if (btn.getAttribute('aria-pressed') !== v) btn.setAttribute('aria-pressed', v); }
  function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }

  // Inputs keep what the viewer typed while they have focus.
  function syncOtherInputs(force) {
    var e = S.el;
    if (!e.time) return;
    if (force && document.activeElement !== e.time) {
      var t = parseTime(S.timeText, S.ampm);
      if (t) S.timeText = (t.hh % 12 || 12) + ':' + pad(t.mm);
      e.time.value = S.timeText;
    }
    if (force && document.activeElement !== e.date) e.date.value = S.dateText;
  }

  function renderAuth() {
    var a = C.auth(), e = S.el;
    var signedIn = a.signedIn;
    var settled = S.authSettled || signedIn;
    e.wait.hidden = settled;
    e.gate.hidden = !settled || signedIn;
    e.form.hidden = !signedIn;
  }

  function renderWhen() {
    var e = S.el, w = S.when || nowWall();
    setText(e.whnB, dateLabel(w));
    setText(e.whnT, timeLabel(w));
    e.whn.classList.toggle('cl-l-unsure', S.sel === 'other' && (S.dateBad || S.timeBad));
    var lo = passedLow();
    e.low.hidden = !lo;
    if (lo) setText(e.low, 'Low ' + F.time(lo.t));
    if (!lo && S.sel === 'low') { S.sel = 'other'; openOther(); }
    Array.prototype.forEach.call(e.quick, function (b) { setPressed(b, b.getAttribute('data-act') === S.sel); });
    e.other.hidden = S.sel !== 'other';
    var today = nowWall();
    Array.prototype.forEach.call(e.days, function (b) {
      var k = b.getAttribute('data-k');
      if (k !== 'older') {
        var n = +k;
        setText(b, n === 0 ? 'Today' : n === 1 ? 'Yesterday' : WD[wdOf(dayBack(today, n))]);
      }
      setPressed(b, String(S.otherDay) === k);
    });
    e.dateRow.hidden = S.otherDay !== 'older';
    e.date.setAttribute('aria-invalid', S.dateBad ? 'true' : 'false');
    e.time.setAttribute('aria-invalid', S.timeBad ? 'true' : 'false');
    Array.prototype.forEach.call(e.ampm, function (b) { setPressed(b, b.getAttribute('data-v') === S.ampm); });
    if (document.activeElement !== e.time && e.time.value !== S.timeText) e.time.value = S.timeText;
    if (document.activeElement !== e.date && e.date.value !== S.dateText) e.date.value = S.dateText;
    var id = editId(), ent = id ? findEntry(id) : null, ew = ent ? parseWall(ent.timestamp) : null;
    e.edit.hidden = !id;
    if (id) e.editT.innerHTML = 'Editing ' + (ew ? '<b class="cl-nowrap">' + esc(dateLabel(ew)) + '</b>' : 'your session');
  }

  function renderRatings() {
    RATINGS.forEach(function (r) {
      var row = S.root.querySelector('.cl-l-rt[data-r="' + r.key + '"]');
      if (!row) return;
      var v = ratingOf(r);
      var rv = row.querySelector('.cl-l-rv');
      setText(rv, v == null ? 'Unrated' : v + NB + '/' + NB + '10');
      rv.classList.toggle('cl-l-none', v == null);
      Array.prototype.forEach.call(row.querySelectorAll('button[data-v]'), function (b) {
        var n = +b.getAttribute('data-v');
        setPressed(b, n === v);
        var lab = r.label + ' ' + n + ' of 10';
        var d = descOf(r, n);
        if (d) lab += ', ' + d;
        if (b.getAttribute('aria-label') !== lab) b.setAttribute('aria-label', lab);
      });
    });
  }

  // Stored conditions → "1.6 ft @ 8 s ESE", "7 mph SW cross-shore", tide.
  function swellText(c) {
    var s = c && c.swell;
    if (!s) return DASH;
    var hgt = isNum(s.height) ? s.height : isNum(s.size) ? s.size : null;
    var per = isNum(s.period) && s.period > 0 ? s.period : null;
    if (hgt == null || (hgt === 0 && per == null)) return DASH;
    return F.swell(hgt, per, isNum(s.direction) ? F.compass(s.direction) : null);
  }
  function windText(c) {
    var w = c && c.wind;
    if (!w || !isNum(w.speed)) return DASH;
    var q = U.windQuality(w.speed, w.direction);
    return F.wind(w.speed, isNum(w.direction) ? w.direction : null) + (q ? ' ' + F.quality(q, 'long') : '');
  }
  function tideText(c) {
    var t = c && c.tide;
    if (!t || !isNum(t.height)) return DASH;
    var st = String(t.stage || '');
    var rising = st === 'rising' ? true : st === 'falling' ? false : null;
    return F.tide(t.height, rising) + (/^slack/.test(st) ? ' slack' : '');
  }

  function renderCond() {
    var e = S.el;
    if (!e.cv) return;
    var w = S.when || nowWall();
    var head = whenShort(w), txt, busy = false, failed = false;
    if (S.sel === 'other' && (S.dateBad || S.timeBad)) { txt = head + ' · ' + DASH; }
    else if (futureWhen()) { txt = head + ' · later than now'; busy = true; }
    else if (S.lookup.timer || S.lookup.state === 'busy' || (S.lookup.state === 'idle' && canLog())) { txt = head + ' · looking up…'; busy = true; }
    else {
      var c = legacyConditions();
      if (!c || S.lookup.state === 'failed') { txt = head + ' · couldn’t look up the conditions for this time'; failed = true; }
      else txt = [head, swellText(c), windText(c), tideText(c)].join(' · ');
    }
    setText(e.cv, txt);
    e.cv.classList.toggle('cl-l-busy', busy || failed);
    e.retry.hidden = !failed;
  }

  function renderPhotos() {
    var e = S.el, ph = legacyPhotos();
    var html = ph.map(function (p, i) {
      var src = typeof safeUrl === 'function' ? safeUrl(typeof photoUrl === 'function' ? photoUrl(p) : p) : '';
      return '<div class="cl-l-ph' + (src ? ' cl-l-has' : '') + '">' + (src ? '<img src="' + src + '" alt="Photo ' + (i + 1) + '">' : '') +
        '<button type="button" data-act="rmphoto" data-i="' + i + '" aria-label="Remove photo ' + (i + 1) + '"><i>' +
        '<svg class="cl-ic" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="stroke-width:3"><path d="M6 6l12 12M18 6L6 18"/></svg></i></button></div>';
    }).join('');
    if (e.phs.getAttribute('data-html') !== html) { e.phs.innerHTML = html; e.phs.setAttribute('data-html', html); }
    e.phs.hidden = !ph.length;
    setText(e.addp.querySelector('span'), S.photoBusy ? 'Adding photo…' : ph.length ? 'Add another photo' : 'Add photo');
  }

  function renderSave() {
    var e = S.el;
    if (!e.save) return;
    var why = S.saving ? '' : blockReason();
    var label = S.saving ? 'Saving…' : editId() ? 'Save changes' : 'Save';
    setText(e.save, label);
    e.save.disabled = !!why || S.saving;
    e.save.classList.toggle('cl-btn-fill', !why && !S.saving);
    // Ready, but the lookup found nothing: it still saves (as the classic
    // form does), and says so. The session stays out of your model until
    // its conditions are looked up again.
    var note = why || (!S.saving && S.lookup.state === 'failed' && !legacyConditions()
      ? 'Saves without conditions. Edit it later to look them up' : '');
    setText(e.why, note);
    e.why.hidden = !note;
  }

  // ── Past sessions ──────────────────────────────────────────────────
  function crewName(n) {
    n = String(n || '').trim();
    if (!n) return 'Crew';
    if (n.indexOf('@') > 0) n = n.split('@')[0];
    return n.split(/\s+/)[0];
  }
  function ratingsText(e) {
    var r = e.ratings || {};
    var v = function (x) { return isNum(x) && x >= 0 && x <= 10 ? String(x) : DASH; };
    return 'Size ' + v(r.size) + ' · Wind ' + v(r.windQuality) + ' · Ride ' + v(r.rideQuality);
  }
  // The low nearest the session, when the app's tide table covers it
  // (about the last day and the next nine). Older sessions show their
  // stored tide instead; a low time is never guessed.
  function lowNear(ms, ev) {
    if (!isNum(ms) || ev.length < 2 || ms < ev[0].t.getTime() || ms > ev[ev.length - 1].t.getTime()) return null;
    var best = null, bd = 7 * HOUR;
    ev.forEach(function (x) {
      if (x.type !== 'L') return;
      var d = Math.abs(x.t.getTime() - ms);
      if (d < bd) { bd = d; best = x; }
    });
    return best;
  }
  function pastCond(e, own, ev) {
    var c = e.conditions;
    if (!c || typeof c !== 'object') return own ? 'No conditions saved. Edit to look them up' : 'No conditions saved';
    var w = parseWall(e.timestamp);
    var lo = w ? lowNear(wallToMs(w), ev) : null;
    return [swellText(c), windText(c), lo ? 'low ' + F.time(lo.t) : tideText(c)].join(' · ');
  }
  function firstPhoto(e) {
    var ps = Array.isArray(e.photos) ? e.photos : [];
    for (var i = 0; i < ps.length; i++) {
      var u = typeof photoUrl === 'function' ? photoUrl(ps[i]) : (ps[i] && ps[i].url) || '';
      var s = typeof safeUrl === 'function' ? safeUrl(u) : '';
      if (s) return s;
    }
    return '';
  }
  function rowHTML(e, uid, ev) {
    var own = isOwn(e, uid);
    var w = parseWall(e.timestamp);
    var date = w ? dateLabel(w) : DASH;
    var who = own ? '' : ' · ' + esc(crewName(e.displayName));
    var src = firstPhoto(e);
    var aria = esc(date + (w ? ' ' + timeLabel(w) : ''));
    var acts = own
      ? '<div class="cl-l-ac">' +
          '<button type="button" class="cl-ib" data-act="edit" data-id="' + esc(e.id) + '" aria-label="Edit session ' + aria + '">' + C.icon.edit(19) + '</button>' +
          '<button type="button" class="cl-ib" data-act="delete" data-id="' + esc(e.id) + '" aria-label="Delete session ' + aria + '">' + C.icon.trash(19) + '</button>' +
        '</div>'
      : '';
    return '<div class="cl-l-ss' + (own ? '' : ' cl-l-crew') + '" role="listitem">' +
      '<div class="cl-l-tn' + (src ? ' cl-l-has' : '') + '">' + (src ? '<img src="' + src + '" alt="" loading="lazy" decoding="async">' : '') + '</div>' +
      '<div class="cl-l-sb">' +
        '<div class="cl-l-sd">' + esc(date) + who + '</div>' +
        '<div class="cl-l-sc2">' + esc(pastCond(e, own, ev)) + '</div>' +
        '<div class="cl-l-sr">' + esc(ratingsText(e)) + '</div>' +
      '</div>' + acts + '</div>';
  }
  function renderList() {
    var e = S.el;
    if (!e.list) return;
    var a = C.auth(), uid = a.uid;
    var all = entries().filter(function (x) { return x && typeof x === 'object'; });
    var keyed = all.map(function (x) { var w = parseWall(x.timestamp); return { e: x, ms: w ? wallToMs(w) : -Infinity }; });
    keyed.sort(function (p, q) { return q.ms - p.ms; });
    var ev = C.data.tideEvents();
    var shown = keyed.slice(0, S.shown);
    var html = shown.length
      ? shown.map(function (k) { return rowHTML(k.e, uid, ev); }).join('')
      : (a.signedIn ? '<p class="cl-l-empty">Your sessions show up here once you save one.</p>' : '');
    if (html !== S.listHTML) { e.list.innerHTML = html; S.listHTML = html; }
    e.list.setAttribute('role', shown.length ? 'list' : 'presentation');
    e.past.hidden = !html || !(S.authSettled || a.signedIn);
    e.more.hidden = keyed.length <= S.shown;
  }

  function renderAll() {
    renderAuth();
    renderWhen();
    renderRatings();
    renderCond();
    renderPhotos();
    renderSave();
    renderList();
  }

  // The Log tab opened: a fresh form follows the clock, and the
  // conditions are looked up the first time it is seen.
  function onShow() {
    S.active = true;
    followNow();
    if (S.lookup.state === 'idle' && !S.lookup.timer && !futureWhen()) scheduleLookup(0);
  }
  // "Now" on an untouched form keeps up with the clock in 5-minute steps
  // (each step looks the conditions up again). Once the viewer starts
  // filling it in, the time stays put.
  function followNow() {
    if (S.sel !== 'now' || S.saving || !pristine()) return;
    var w = nowWall();
    if (!S.when || Math.abs(wallToMs(w) - wallToMs(S.when)) >= 5 * MIN) setWhen(w);
  }

  // ════════════════════════════════════════════════════════════════════
  // Hooks into app.js (call-through)
  // ════════════════════════════════════════════════════════════════════
  function wrap(name, before, after) {
    var orig = window[name];
    if (typeof orig !== 'function') { C.err('log.hook', name + ' is not a function'); return; }
    var w = function () {
      if (before) { try { before.apply(this, arguments); } catch (e) { C.err('log.hook.' + name, e); } }
      var r = orig.apply(this, arguments);
      if (after) { try { after.apply(this, [r].concat(Array.prototype.slice.call(arguments))); } catch (e) { C.err('log.hook.' + name, e); } }
      return r;
    };
    w._cleanOrig = orig;
    window[name] = w;
  }
  wrap('initSurfLogForm', null, function () {
    S.legacyReady = true;
    writeLegacyTime();     // spot wall time instead of the device's
    if (S.root) { renderAll(); if (S.active) scheduleLookup(0); }
  });
  wrap('resetSurfLogForm', null, function () {
    var wasSaving = S.saving;
    S.saving = false;
    S.saveSeq++;
    clearTimeout(S.saveTimer);
    if (S.root) resetFace();
    if (wasSaving && S.root) {
      // Saved: the new session is at the top of Past sessions.
      try { S.root.querySelector('.cl-l-past').scrollIntoView({ block: 'start', behavior: U.reducedMotion() ? 'auto' : 'smooth' }); } catch (_) { /* fine */ }
    }
  });
  wrap('renderPhotoGallery', null, function () { S.photoBusy = false; if (S.root) renderPhotos(); });
  wrap('addLogEntry', function () { S.saveStarted = true; });
  wrap('updateLogEntry', function () { S.saveStarted = true; });

  // ════════════════════════════════════════════════════════════════════
  // Register
  // ════════════════════════════════════════════════════════════════════
  C.register('log', {
    mount: mount,
    render: function (reason) {
      if (!S.root) return;
      if (reason === 'show' || (reason === 'mount' && C.tab() === 'log')) onShow();
      if (reason === 'data' || reason === 'model') { renderWhen(); renderList(); return; }
      renderAll();
    },
    onShow: function () { S.active = true; }
  });
  C.on('log', function () { if (S.root) { renderList(); renderSave(); } });
  C.on('auth', function (a) {
    // Signed out, or in as someone else: an open edit of the last
    // account's session ends here (see foreignEdit).
    dropForeignEdit();
    if (!S.root) return;
    if (a && a.signedIn) S.authSettled = true;
    renderAll();
    if (a && a.signedIn && S.active && S.lookup.state === 'idle') scheduleLookup(0);
  });
  C.on('tick', function () {
    if (!S.root) return;
    followNow();
    renderWhen();
    renderCond();
    renderSave();
  });
})();
