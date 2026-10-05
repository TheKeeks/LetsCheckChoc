// ════════════════════════════════════════════════════════════════════
// CLEAN — model.js (owner: Model part)
// ────────────────────────────────────────────────────────────────────
// The Model tab (A2-Phone-Model, A2-Phone-Model-Early). It reads the
// app's three surf-log models as slRetrain leaves them in STATE:
//   wave  (target: size rating)          WAVE_FEATURE_NAMES
//   ride  (target: ride quality rating)  RIDE_FEATURE_NAMES
//   cond  (target: wind quality rating)  COND_FEATURE_NAMES
// Features are z-scored and the target is mean-centred, so each weight
// is "rating points per one standard deviation of that condition": the
// weights compare directly. Your score on the Forecast tab is the mean
// of the three predictions (core's ratingsAt), so a condition's pull on
// it is the sum of its weights over the trained models, divided by how
// many are trained. That is what the sentence and the bars show.
//
//   • Trained: one plain sentence from the two strongest pulls, "What
//     matters most" (3–4 strongest, Raises solid / Lowers hatched, bar
//     length ∝ |pull|), "Typical miss ±x points" (leave-one-out, from the
//     app's own _regLOOFor), a row to the legacy Tab 2 charts, and
//     "Trained on N rated sessions".
//   • Early (no model trained yet, app.js minSamples = 12): dots N of 12,
//     "Log N more sessions to train it", a call to the Log tab.
//   • Details sub-page: the legacy Tab 2 panels (predicted vs actual,
//     per-factor charts, raw weights, forecast vs buoy) are borrowed into
//     a CLEAN sub-page and put back where they were when it closes, so the
//     app's own renderers keep drawing them. Tapping a dot opens that
//     session as a stacked sub-page (the legacy drill-down's contents).
//
// Settings is core's (core.js › Settings); this part adds nothing there.
// Nothing here writes a surf-log entry: the drill-down has no edit path.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.CLEAN) return;            // core failed: the classic app is showing
  var C = window.CLEAN, U = C.util, F = C.fmt, I = C.icon;
  var isNum = U.isNum, esc = U.esc;

  var SUBS = ['wave', 'ride', 'cond'];
  var MAX_FACTORS = 4;                  // "What matters most": the 3–4 strongest
  var MIN_SHARE = 0.08;                 // drop pulls under 8% of the strongest (noise)
  var LOAD_GIVE_UP_MS = 20000;          // stop saying "Loading" after this

  // Plain surf words for the models' features. `row` names the condition
  // as it goes UP (the bar's Raises/Lowers is the sign); `say` is the same
  // in a sentence. Labels stay put across retrains so the list reads the
  // same from one session to the next.
  var WORDS = {
    effective_in_window_height: { row: 'In-window swell size', say: 'bigger in-window swell' },
    effective_in_window_period: { row: 'Longer period', say: 'a longer period' },
    total_swell_height: { row: 'Swell from any direction', say: 'more swell from any direction' },
    tide_height: { row: 'Higher tide', say: 'a higher tide' },
    tide_rate: { row: 'Incoming tide', say: 'an incoming tide' },
    wind_speed: { row: 'Stronger wind', say: 'stronger wind' },
    wind_offshore: { row: 'Offshore wind', say: 'offshore wind' }
  };
  function plain(name) { return String(name || '').replace(/_/g, ' '); }
  function rowWord(name) { return WORDS[name] ? WORDS[name].row : plain(name).replace(/^./, function (c) { return c.toUpperCase(); }); }
  function sayWord(name) { return WORDS[name] ? WORDS[name].say : plain(name); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function st() { return typeof STATE !== 'undefined' ? STATE : null; }
  function cfgOf(key) {
    try { return (typeof REG_SUBMODELS !== 'undefined' && REG_SUBMODELS[key]) || null; } catch (_) { return null; }
  }

  // The rows slRetrain trains on: the signed-in surfer's own sessions
  // (everyone's before auth has a uid, as in slRetrain), with conditions.
  function scopedEntries() {
    var S = st();
    var log = S && Array.isArray(S.surfLog) ? S.surfLog : [];
    var uid = window._fbUserId;
    var mine = uid ? log.filter(function (e) { return e && e.userId === uid; }) : log;
    return mine.filter(function (e) { return e && e.conditions && e.conditions.swell; });
  }

  // ── What the models learned ─────────────────────────────────────────
  var memo = { key: null, val: null };
  function learnKey() {
    var S = st();
    return [S && S._lastFitAt, S && S._lastFitN, S && S.surfLog && S.surfLog.length, window._fbUserId || '',
      S && S.surfLogWaveWeights ? S.surfLogWaveWeights.join() : '',
      S && S.surfLogRideWeights ? S.surfLogRideWeights.join() : '',
      S && S.surfLogCondWeights ? S.surfLogCondWeights.join() : ''].join('|');
  }
  function learn() {
    var key = learnKey();
    if (memo.key === key && memo.val) return memo.val;
    var S = st();
    var entries = scopedEntries();
    var subs = [];
    SUBS.forEach(function (k) {
      var cfg = cfgOf(k);
      if (!cfg || !S) return;
      var names = cfg.featureNames || [];
      // The app's own row filter (complete, rated 0–10, finite features);
      // without it, a rough count of the sessions rated for this model.
      var kept = null;
      try {
        if (typeof _modelRows === 'function') kept = _modelRows(entries, cfg.extractor, cfg.targetFn).kept.length;
      } catch (e) { C.err('model.rows', e); kept = null; }
      if (!isNum(kept)) {
        kept = entries.filter(function (e) { try { return isNum(cfg.targetFn(e)); } catch (_) { return false; } }).length;
      }
      var w = S[cfg.weightsKey];
      var ok = Array.isArray(w) && w.length === names.length && w.every(isNum);
      subs.push({ key: k, cfg: cfg, names: names, kept: kept, need: Math.max(2 * names.length, 12), weights: ok ? w : null });
    });
    var trained = subs.filter(function (s) { return s.weights; });
    var val;
    if (!trained.length) {
      // The model closest to training sets the count (all need 12 today).
      var best = null;
      subs.forEach(function (s) { if (!best || s.need - s.kept < best.need - best.kept) best = s; });
      val = { trained: false, have: best ? Math.min(best.kept, best.need) : 0, need: best ? best.need : 12 };
    } else {
      var k = trained.length, pull = {}, order = [];
      trained.forEach(function (s) {
        s.weights.forEach(function (w, j) {
          var n = s.names[j];
          if (!Object.prototype.hasOwnProperty.call(pull, n)) { pull[n] = 0; order.push(n); }
          pull[n] += w / k;
        });
      });
      var all = order.map(function (n) { return { name: n, c: pull[n] }; })
        .filter(function (f) { return isNum(f.c) && Math.abs(f.c) > 1e-9; })
        .sort(function (a, b) { return Math.abs(b.c) - Math.abs(a.c); });
      var max = all.length ? Math.abs(all[0].c) : 0;
      var shown = all.filter(function (f, i) { return i < MAX_FACTORS && Math.abs(f.c) >= MIN_SHARE * max; });
      val = {
        trained: true,
        n: Math.max.apply(null, trained.map(function (s) { return s.kept; })),
        factors: shown,
        max: max,
        miss: typicalMiss(trained)
      };
    }
    memo = { key: key, val: val };
    return val;
  }

  // Typical miss of YOUR SCORE (the mean of the trained models), in
  // rating points: each session is scored by models trained without it
  // (the app's leave-one-out, _regLOOFor, the same folds as the Tab 2
  // charts), clamped to 1–10 like predict*Rating, averaged across the
  // models that cover it, and compared with the mean of the same ratings.
  // Root-mean-square over sessions. null until a fold is possible
  // (one session past the 12 needed to train).
  function typicalMiss(trained) {
    var S = st();
    try {
      if (typeof _regLOOFor === 'function') {
        var acc = new Map();
        trained.forEach(function (s) {
          var d = _regLOOFor(s.key);
          ((d && d.rows) || []).forEach(function (r) {
            if (!r || !isNum(r.pred) || !isNum(r.target)) return;
            var id = r.entry || r.id;
            var o = acc.get(id);
            if (!o) { o = { p: 0, t: 0, n: 0 }; acc.set(id, o); }
            o.p += U.clamp(r.pred, 1, 10);
            o.t += r.target;
            o.n++;
          });
        });
        if (!acc.size) return null;
        var sse = 0;
        acc.forEach(function (o) { var e = (o.p - o.t) / o.n; sse += e * e; });
        return Math.sqrt(sse / acc.size);
      }
    } catch (e) { C.err('model.miss', e); }
    // Fallback: the app's per-model leave-one-out RMSE, averaged.
    var v = S ? trained.map(function (s) { return S[s.cfg.rmseKey]; }).filter(isNum) : [];
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }

  // One plain sentence from the two strongest pulls.
  function sentence(factors) {
    if (!factors.length) return 'Nothing stands out yet: your ratings don’t follow any one condition.';
    var a = factors[0], b = factors[1];
    var up = function (f) { return f.c > 0; };
    if (!b) return cap(sayWord(a.name)) + (up(a) ? ' raises' : ' lowers') + ' your rating most.';
    if (up(a) === up(b)) return cap(sayWord(a.name)) + ' and ' + sayWord(b.name) + (up(a) ? ' raise' : ' lower') + ' your rating most.';
    return cap(sayWord(a.name)) + (up(a) ? ' raises' : ' lowers') + ' your rating most, and ' +
      sayWord(b.name) + (up(b) ? ' raises' : ' lowers') + ' it.';
  }

  // ── Markup ──────────────────────────────────────────────────────────
  function factorHTML(f, max) {
    var up = f.c > 0;
    var pct = Math.max(4, Math.min(100, Math.round(Math.abs(f.c) / max * 100)));
    return '<div class="cl-m-f">' +
      '<div class="cl-m-top"><span>' + esc(rowWord(f.name)) + '</span>' +
        '<span class="cl-m-dir">' + (up ? I.up(16) : I.down(16)) + (up ? 'Raises' : 'Lowers') + '</span></div>' +
      '<div class="cl-m-bar" aria-hidden="true"><i' + (up ? '' : ' class="cl-m-lo"') + ' style="width:' + pct + '%"></i></div>' +
      '</div>';
  }

  function trainedHTML(m) {
    var miss = isNum(m.miss)
      ? '±' + F.score(m.miss) + F.NB + '<small>points</small>'
      : F.DASH;
    return '' +
      '<p class="cl-m-say">' + esc(sentence(m.factors)) + '</p>' +
      '<div class="cl-gap"></div>' +
      (m.factors.length
        ? '<h2 class="cl-h2">What matters most</h2>' +
          '<div class="cl-m-fac">' + m.factors.map(function (f) { return factorHTML(f, m.max); }).join('') + '</div>'
        : '') +
      '<div class="cl-m-err"><span>Typical miss</span><b>' + miss + '</b></div>' +
      '<div class="cl-pad"><button type="button" class="cl-dr cl-m-more" data-act="detail">' +
        '<span>Predicted vs actual, per-factor charts</span>' + I.chevronRight() + '</button></div>' +
      '<p class="cl-fine cl-pad cl-m-n">Trained on ' + m.n + ' rated session' + (m.n === 1 ? '' : 's') + '.</p>';
  }

  function earlyHTML(m, signedIn) {
    var left = Math.max(0, m.need - m.have);
    var dots = '';
    for (var i = 0; i < m.need; i++) dots += '<i' + (i < m.have ? ' class="f"' : '') + '></i>';
    var say, note;
    if (left === 0) {
      // Enough sessions, but the fit failed (they are too alike to separate).
      say = 'Log a few more sessions to train it.';
      note = m.have + ' rated sessions so far, but they are too alike to learn from. Sessions in different swell, wind and tide help it most.';
    } else {
      say = m.have === 0
        ? 'Log ' + m.need + ' sessions to train it.'
        : 'Log ' + left + ' more session' + (left === 1 ? '' : 's') + ' to train it.';
      note = m.have + ' of ' + m.need + ' rated sessions. ' + (signedIn ? '' : 'Sign in to log sessions. ') +
        'Once it is trained, it will tell you what makes a session good for you, and score each forecast window out of 10.';
    }
    return '' +
      '<p class="cl-m-say">' + esc(say) + '</p>' +
      '<div class="cl-m-dots" role="img" aria-label="' + m.have + ' of ' + m.need + ' rated sessions logged">' + dots + '</div>' +
      '<p class="cl-fine cl-m-note">' + esc(note) + '</p>' +
      (signedIn
        ? '<button type="button" class="cl-btn cl-m-cta" data-act="log">Log a session</button>'
        : '<button type="button" class="cl-btn cl-m-cta" data-act="signin">Sign in with Google</button>');
  }

  function waitHTML(gaveUp) {
    return gaveUp
      ? '<p class="cl-m-say cl-m-wait">Your sessions haven’t loaded yet.</p>' +
        '<p class="cl-fine cl-m-note">They load once sign-in finishes. If this stays, check the connection and reopen the page.</p>'
      : '<p class="cl-m-say cl-m-wait">Loading your sessions…</p>';
  }

  // ── Part ────────────────────────────────────────────────────────────
  var root = null, box = null, lastHTML = '', mountedAt = 0;

  function logLoaded() { var S = st(); return !!(S && S._lastFitAt); }

  function render() {
    if (!box) return;
    var html;
    if (!logLoaded()) {
      html = waitHTML(Date.now() - mountedAt > LOAD_GIVE_UP_MS);
    } else {
      var m = learn();
      html = m.trained ? trainedHTML(m) : earlyHTML(m, C.auth().signedIn);
    }
    if (html !== lastHTML) { box.innerHTML = html; lastHTML = html; }
  }

  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !box.contains(b)) return;
    var act = b.getAttribute('data-act');
    if (act === 'detail') openDetail();
    else if (act === 'log') C.show('log');
    else if (act === 'signin') C.signIn();
  }

  C.register('model', {
    mount: function (el) {
      root = el;
      mountedAt = Date.now();
      box = U.h('div', { class: 'cl-m' });
      el.appendChild(box);
      el.addEventListener('click', C.guard('model.click', onClick));
      // A surf log that never arrives (auth hangs) stops saying "Loading".
      setTimeout(C.guard('model.giveUp', function () { C.render('model', 'request'); }), LOAD_GIVE_UP_MS + 100);
    },
    render: function () { render(); }
  });
  C.on('log', function () { C.render('model', 'request'); });
  C.on('auth', function () { C.render('model', 'request'); });

  // ════════════════════════════════════════════════════════════════════
  // DETAILS SUB-PAGE — the legacy Tab 2 panels, borrowed
  // ════════════════════════════════════════════════════════════════════
  // The panels move into the sub-page and back (a comment marks each
  // home), so the app's renderers (renderRegressionTab, slRetrain's
  // re-render, the scrubber hook) keep finding them by id.
  var BORROW = ['panel-regression-pva', 'panel-regression-submodel', 'panel-surflog-weights', 'panel-verification'];
  // Headings in sentence case and surf words; all put back on close.
  var LEGENDS = {
    'Predicted vs Actual': 'Predicted vs actual',
    'Per-feature scatters': 'Each factor',
    'Feature Importance': 'Feature importance',
    'Preferred Conditions': 'Preferred conditions',
    'Model Fit': 'Model fit',
    'Raw weights (advanced)': 'Raw weights',
    'Model vs Buoy — is the forecast telling the truth?': 'Forecast vs buoy'
  };
  // The three models by the rating they predict (the Log tab's words).
  var SUB_TITLES = { wave: 'Size', ride: 'Ride quality', cond: 'Wind quality' };
  // Feature names on the charts (REG_FEATURE_LABELS), in surf words.
  var CHART_LABELS = {
    effective_in_window_height: 'In-window swell size',
    effective_in_window_period: 'In-window period',
    total_swell_height: 'Swell from any direction',
    tide_height: 'Tide height',
    tide_rate: 'Tide rate (+ incoming)',
    wind_speed: 'Wind speed',
    wind_offshore: 'Offshore wind (−1 onshore, +1 offshore)'
  };
  var detail = null;   // { handle, borrowed: [{ n, mark }], renamed: [{ el, text }], added: [nodes], swaps: [fn] }

  // Swap a property on an app object for as long as the sub-page is open.
  function swapProp(obj, key, val, list) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) return;
    var old = obj[key];
    obj[key] = val;
    list.push(function () { obj[key] = old; });
  }
  // The spot name stays off screen (owner decision): the legacy Forecast
  // vs buoy text says "the Choc forecast point".
  function scrubSpot(node) {
    if (!node || !document.createTreeWalker) return;
    var w = document.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */), t;
    while ((t = w.nextNode())) {
      var v = t.nodeValue;
      var n = v.replace(/\bthe Choc(?:omount)? (?:forecast )?point\b/g, 'the forecast point')
        .replace(/\b(?:Chocomount|Choc|Fishers Island)\s+/g, '');
      if (n !== v) t.nodeValue = n;
    }
  }
  function relabel(node, map) {
    if (!node || !document.createTreeWalker) return;
    var w = document.createTreeWalker(node, 4), t;
    while ((t = w.nextNode())) {
      var v = t.nodeValue, n = v;
      Object.keys(map).forEach(function (k) { n = n.split(k).join(map[k]); });
      if (n !== v) t.nodeValue = n;
    }
  }

  function byId(id) { return document.getElementById(id); }
  function borrow(n, into, list) {
    if (!n || !n.parentNode) return;
    var mark = document.createComment('clean: ' + (n.id || 'node') + ' lives here');
    n.parentNode.insertBefore(mark, n);
    into.appendChild(n);
    list.push({ n: n, mark: mark });
  }
  function giveBack(list) {
    (list || []).forEach(function (b) {
      try {
        if (b.mark.parentNode) { b.mark.parentNode.insertBefore(b.n, b.mark); b.mark.parentNode.removeChild(b.mark); }
      } catch (e) { C.err('model.giveBack', e); }
    });
  }

  function verifCanvases() {
    return ['verif-canvas-height', 'verif-canvas-period', 'verif-canvas-dir'].map(byId).filter(Boolean);
  }
  // Canvases measured while hidden cached a 1×1 size: forget it so the
  // next draw measures the sub-page.
  function freshCanvases() {
    if (typeof invalidateCanvasDPR !== 'function') return;
    verifCanvases().forEach(function (cv) { try { invalidateCanvasDPR(cv); } catch (_) { /* fine */ } });
  }

  function openDetail() {
    if (detail && detail.handle) return detail.handle;
    var d = { handle: null, borrowed: [], renamed: [], added: [], swaps: [] };
    detail = d;
    d.handle = C.sub.open({
      id: 'model-detail',
      title: 'Model details',
      mount: function (body) {
        body.classList.add('cl-m-dt');
        BORROW.forEach(function (id) { borrow(byId(id), body, d.borrowed); });
        // Sentence-case headings, surf words (put back on close).
        var rename = function (el, text) { d.renamed.push({ el: el, text: el.textContent }); el.textContent = text; };
        body.querySelectorAll('legend, summary').forEach(function (lg) {
          var t = (lg.textContent || '').trim();
          if (LEGENDS[t]) rename(lg, LEGENDS[t]);
        });
        body.querySelectorAll('.reg-submodel-tab[data-submodel]').forEach(function (b) {
          var t = SUB_TITLES[b.getAttribute('data-submodel')];
          if (t) rename(b, t);
        });
        try {
          if (typeof REG_SUBMODELS !== 'undefined') SUBS.forEach(function (k) { swapProp(REG_SUBMODELS[k], 'title', SUB_TITLES[k], d.swaps); });
          if (typeof REG_FEATURE_LABELS !== 'undefined') Object.keys(CHART_LABELS).forEach(function (k) { swapProp(REG_FEATURE_LABELS, k, CHART_LABELS[k], d.swaps); });
        } catch (e) { C.err('model.detail.labels', e); }
        var add = function (n, before) { before.parentNode.insertBefore(n, before); d.added.push(n); };
        var pvaLegend = body.querySelector('#panel-regression-pva legend');
        if (pvaLegend && pvaLegend.nextSibling) {
          add(U.h('p', { class: 'cl-m-lead' },
            'Each dot is one of your sessions, scored by the model trained without it. On the dashed line the score was spot on. Tap a dot to open that session.'),
          pvaLegend.nextSibling);
        }
        var subRow = body.querySelector('#panel-regression-submodel .reg-submodel-row');
        if (subRow) {
          add(U.h('h2', { class: 'cl-m-h2' }, 'By rating'), subRow);
          add(U.h('p', { class: 'cl-m-lead' }, 'What each of your three ratings follows.'), subRow);
        }
        freshCanvases();
        try { if (typeof renderRegressionTab === 'function') renderRegressionTab(); } catch (e) { C.err('model.detail.render', e); }
        var any = d.borrowed.some(function (b) { return b.n.style.display !== 'none'; });
        if (!any) {
          var none = U.h('p', { class: 'cl-empty' }, 'Nothing to chart yet. The charts fill in once the model has trained.');
          body.insertBefore(none, body.firstChild);
          d.added.push(none);
        }
      },
      onClose: function () {
        closeSessionLegacy();
        d.added.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        d.renamed.forEach(function (r) { r.el.textContent = r.text; });
        d.swaps.forEach(function (undo) { try { undo(); } catch (_) { /* fine */ } });
        giveBack(d.borrowed);
        freshCanvases();
        if (detail === d) detail = null;
      }
    });
    if (!d.handle && detail === d) detail = null;
    return d.handle;
  }

  // Forecast vs buoy draws on the legacy chart paper (FC_RETRO.plotBg,
  // cream). In the sub-page it draws on white instead (night inverts it
  // to dark in model.css); the classic page is untouched.
  (function () {
    var orig = window.drawVerifChart;
    if (typeof orig !== 'function') return;
    var w = function (canvasId) {
      var swap = false, saved;
      try {
        var cv = byId(canvasId);
        if (detail && cv && typeof FC_RETRO !== 'undefined' && cv.closest && cv.closest('#cl-sub-model-detail')) {
          saved = FC_RETRO.plotBg; FC_RETRO.plotBg = '#FFFFFF'; swap = true;
        }
      } catch (e) { C.err('model.verifBg', e); }
      try { return orig.apply(this, arguments); }
      finally { if (swap) { try { FC_RETRO.plotBg = saved; } catch (_) { /* fine */ } } }
    };
    w._cleanOrig = orig;
    window.drawVerifChart = w;
  })();
  // Its table, legend and footer are rebuilt on every render: scrub the
  // spot name each time while the sub-page shows them.
  (function () {
    var orig = window._verifRender;
    if (typeof orig !== 'function') return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { if (detail) scrubSpot(byId('panel-verification')); } catch (e) { C.err('model.verifScrub', e); }
      return r;
    };
    w._cleanOrig = orig;
    window._verifRender = w;
  })();

  // ── One session (a dot was tapped) ─────────────────────────────────
  // openRegressionDrilldown fills #reg-drilldown-inner and shows the
  // legacy side panel, which stays in its hidden home; its contents move
  // into a stacked sub-page so the back swipe returns to the charts.
  var session = null;   // { mark, inner }
  function closeSessionLegacy() {
    try {
      var p = byId('reg-drilldown');
      if (p && p.classList.contains('open') && typeof closeRegressionDrilldown === 'function') closeRegressionDrilldown();
    } catch (e) { C.err('model.drill.close', e); }
  }
  function sessionTitle(entry) {
    var t = U.toDate(entry && entry.timestamp);
    if (!t) return 'Session';
    var y = U.dayKey(t).slice(0, 4), yNow = U.dayKey(new Date()).slice(0, 4);
    return F.date(t) + (y !== yNow ? ' ' + y : '');
  }
  function goLog() {
    var d = C.sub.depth();
    try { if (d && history.state && history.state.clSub) history.go(-d); } catch (_) { /* fine */ }
    C.show('log');
  }
  function openSession(entry) {
    var inner = byId('reg-drilldown-inner');
    if (!inner || !inner.parentNode) return;
    if (session && C.sub.top() && session.handle === C.sub.top()) { C.sub.top().setTitle(sessionTitle(entry)); return; }
    var s = { mark: null, inner: inner, handle: null };
    session = s;
    s.handle = C.sub.open({
      id: 'model-session',
      title: sessionTitle(entry),
      mount: function (body) {
        body.classList.add('cl-m-ss');
        s.mark = document.createComment('clean: reg-drilldown-inner lives here');
        inner.parentNode.insertBefore(s.mark, inner);
        body.appendChild(inner);
        var link = inner.querySelector('#reg-drill-open-log');
        if (link) link.textContent = 'Open the Log';
        // The ratings by the Log tab's names (inner is rebuilt on every open).
        relabel(inner, { 'Wave size:': 'Size', 'Ride quality:': 'Ride quality', 'Wind/conditions:': 'Wind quality',
          'Your ratings vs predicted': 'Your ratings and the model’s', 'Their ratings vs predicted': 'Their ratings and the model’s',
          'Per-feature attribution': 'Why it scored this' });
        scrubSpot(inner);
        // Capture: runs before the app's own handler on the link (which
        // would switch the hidden legacy tabs).
        body.addEventListener('click', C.guard('model.drill.log', function (ev) {
          var a = ev.target && ev.target.closest ? ev.target.closest('#reg-drill-open-log') : null;
          if (!a) return;
          ev.preventDefault();
          ev.stopPropagation();
          goLog();
        }), true);
      },
      onClose: function () {
        if (s.mark && s.mark.parentNode) { s.mark.parentNode.insertBefore(s.inner, s.mark); s.mark.parentNode.removeChild(s.mark); }
        closeSessionLegacy();
        if (session === s) session = null;
      }
    });
    if (!s.handle && session === s) session = null;
  }
  (function () {
    var orig = window.openRegressionDrilldown;
    if (typeof orig !== 'function') return;
    var w = function (entry) {
      var r = orig.apply(this, arguments);
      try { if (detail && entry) openSession(entry); } catch (e) { C.err('model.drill', e); }
      return r;
    };
    w._cleanOrig = orig;
    window.openRegressionDrilldown = w;
  })();
})();
