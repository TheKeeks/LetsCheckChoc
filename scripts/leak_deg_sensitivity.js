// Read-only sensitivity analysis for the swell-window edge-softening decay
// (LEAK_DEG). For each candidate LEAK_DEG, re-extract Wave/Ride features on a
// 28-session dataset, refit the model with the same ridge + OLS math used in
// app.js, and report R² (in-sample) and LOO-RMSE. This script does NOT modify
// any production code or pick a new LEAK_DEG; it only reports.
//
// Data source: the 28-session synthetic dataset embedded in
// scripts/smoke_regression.js, which was modeled after the spot owner's
// distribution per INVESTIGATION_OUT_VS_IN_POST_BACKFILL.md. Real user logs
// live in Firestore and aren't reachable from node; this serialized copy is
// the closest stand-in available offline.
//
// Run: node scripts/leak_deg_sensitivity.js

'use strict';

// ── Swell window (matches CONFIG.chocomount in app.js) ──────────────
const SWELL_WIN_MIN = 115;
const SWELL_WIN_MAX = 158;

// ── 28-session dataset (copied verbatim from scripts/smoke_regression.js) ──
const SESSIONS = [
  // SEC IN
  { swell: { height: 2.0, direction: 99,  period: 4.3, secondary: { height: 1.4, direction: 142, period: 9.0 } }, wind: { speed: 6,  direction: 67  }, tide: { height: 1.8, rate:  0.5, stage: 'rising' }, ratings: { size: 2, windQuality: 7, rideQuality: 3 } },
  { swell: { height: 2.3, direction: 109, period: 5.0, secondary: { height: 1.2, direction: 146, period: 8.3 } }, wind: { speed: 7,  direction: 112 }, tide: { height: 2.1, rate:  0.3, stage: 'rising' }, ratings: { size: 2, windQuality: 6, rideQuality: 3 } },
  // PRI IN — small
  { swell: { height: 1.3, direction: 137, period: 8.4, secondary: { height: 0.5, direction: 90,  period: 4.0 } }, wind: { speed: 12, direction: 180 }, tide: { height: 3.0, rate: -0.2, stage: 'falling' }, ratings: { size: 1, windQuality: 3, rideQuality: 0 } },
  { swell: { height: 2.4, direction: 128, period: 8.6, secondary: { height: 0.4, direction: 80,  period: 4.0 } }, wind: { speed: 11, direction: 292 }, tide: { height: 2.2, rate:  0.4, stage: 'rising' }, ratings: { size: 3, windQuality: 5, rideQuality: 4 } },
  { swell: { height: 2.5, direction: 136, period: 6.6, secondary: { height: 0.6, direction: 100, period: 4.5 } }, wind: { speed: 5,  direction: 157 }, tide: { height: 1.7, rate:  0.6, stage: 'rising' }, ratings: { size: 3, windQuality: 7, rideQuality: 5 } },
  { swell: { height: 2.5, direction: 146, period: 6.9, secondary: { height: 0.5, direction: 100, period: 4.0 } }, wind: { speed: 3,  direction: 247 }, tide: { height: 1.5, rate:  0.5, stage: 'rising' }, ratings: { size: 4, windQuality: 9, rideQuality: 6 } },
  { swell: { height: 2.8, direction: 136, period: 6.5, secondary: { height: 0.4, direction: 100, period: 4.0 } }, wind: { speed: 8,  direction: 67  }, tide: { height: 2.6, rate:  0.3, stage: 'rising' }, ratings: { size: 3, windQuality: 5, rideQuality: 4 } },
  { swell: { height: 2.8, direction: 119, period: 8.5, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 8,  direction: 247 }, tide: { height: 1.9, rate:  0.5, stage: 'rising' }, ratings: { size: 5, windQuality: 7, rideQuality: 6 } },
  { swell: { height: 3.3, direction: 125, period: 7.5, secondary: { height: 0.5, direction: 95,  period: 4.0 } }, wind: { speed: 2,  direction: 337 }, tide: { height: 1.4, rate:  0.6, stage: 'rising' }, ratings: { size: 6, windQuality: 9, rideQuality: 6 } },
  { swell: { height: 3.7, direction: 123, period: 7.0, secondary: { height: 0.7, direction: 95,  period: 4.5 } }, wind: { speed: 6,  direction: 202 }, tide: { height: 2.8, rate: -0.3, stage: 'falling' }, ratings: { size: 5, windQuality: 6, rideQuality: 4 } },
  { swell: { height: 3.9, direction: 147, period: 9.1, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 10, direction: 337 }, tide: { height: 1.6, rate:  0.7, stage: 'rising' }, ratings: { size: 7, windQuality: 9, rideQuality: 9 } },
  { swell: { height: 4.2, direction: 117, period: 6.6, secondary: { height: 0.5, direction: 100, period: 4.0 } }, wind: { speed: 5,  direction: 0   }, tide: { height: 1.9, rate:  0.6, stage: 'rising' }, ratings: { size: 7, windQuality: 9, rideQuality: 7 } },
  { swell: { height: 4.4, direction: 127, period: 7.7, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 8,  direction: 225 }, tide: { height: 2.0, rate:  0.5, stage: 'rising' }, ratings: { size: 8, windQuality: 7, rideQuality: 6 } },
  { swell: { height: 4.7, direction: 140, period: 9.5, secondary: { height: 0.6, direction: 95,  period: 4.5 } }, wind: { speed: 10, direction: 112 }, tide: { height: 2.3, rate:  0.3, stage: 'rising' }, ratings: { size: 5, windQuality: 5, rideQuality: 6 } },
  { swell: { height: 6.4, direction: 145, period: 15.4, secondary: { height: 0.7, direction: 95, period: 4.5 } }, wind: { speed: 0,  direction: 0   }, tide: { height: 1.2, rate:  0.8, stage: 'rising' }, ratings: { size: 9, windQuality: 10, rideQuality: 10 } },
  { swell: { height: 8.8, direction: 150, period: 8.1, secondary: { height: 0.8, direction: 95,  period: 4.5 } }, wind: { speed: 7,  direction: 270 }, tide: { height: 1.5, rate:  0.7, stage: 'rising' }, ratings: { size: 9, windQuality: 9, rideQuality: 10 } },
  // BOTH OUT
  { swell: { height: 2.9, direction: 107, period: 9.9, secondary: { height: 0.4, direction: 95,  period: 4.0 } }, wind: { speed: 2,  direction: 135 }, tide: { height: 2.7, rate: -0.4, stage: 'falling' }, ratings: { size: 1, windQuality: 6, rideQuality: 0 } },
  { swell: { height: 4.3, direction: 113, period: 7.1, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 2,  direction: 337 }, tide: { height: 2.4, rate:  0.2, stage: 'rising' }, ratings: { size: 4, windQuality: 8, rideQuality: 5 } },
  { swell: { height: 2.6, direction: 185, period: 4.7, secondary: { height: 0.3, direction: 95,  period: 4.0 } }, wind: { speed: 3,  direction: 90  }, tide: { height: 2.1, rate:  0.4, stage: 'rising' }, ratings: { size: 4, windQuality: 7, rideQuality: 4 } },
  { swell: { height: 3.5, direction: 181, period: 5.6, secondary: { height: 0.4, direction: 95,  period: 4.0 } }, wind: { speed: 10, direction: 225 }, tide: { height: 2.5, rate: -0.3, stage: 'falling' }, ratings: { size: 4, windQuality: 5, rideQuality: 4 } },
  { swell: { height: 3.0, direction: 159, period: 8.7, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 7,  direction: 112 }, tide: { height: 1.8, rate:  0.5, stage: 'rising' }, ratings: { size: 6, windQuality: 6, rideQuality: 6 } },
  { swell: { height: 3.0, direction: 159, period: 8.7, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 7,  direction: 112 }, tide: { height: 1.7, rate:  0.4, stage: 'rising' }, ratings: { size: 6, windQuality: 6, rideQuality: 7 } },
  { swell: { height: 1.4, direction: 181, period: 5.3, secondary: { height: 0.4, direction: 95,  period: 4.0 } }, wind: { speed: 4,  direction: 247 }, tide: { height: 2.3, rate:  0.3, stage: 'rising' }, ratings: { size: 2, windQuality: 8, rideQuality: 5 } },
  { swell: { height: 3.2, direction: 110, period: 7.8, secondary: { height: 0.5, direction: 95,  period: 4.5 } }, wind: { speed: 5,  direction: 202 }, tide: { height: 1.6, rate:  0.6, stage: 'rising' }, ratings: { size: 5, windQuality: 7, rideQuality: 9 } },
  { swell: { height: 3.8, direction: 192, period: 5.5, secondary: { height: 0.9, direction: 103, period: 7.0 } }, wind: { speed: 16, direction: 292 }, tide: { height: 2.9, rate: -0.4, stage: 'falling' }, ratings: { size: 3, windQuality: 4, rideQuality: 1 } },
  { swell: { height: 2.7, direction: 196, period: 4.8, secondary: { height: 0.7, direction: 104, period: 9.1 } }, wind: { speed: 6,  direction: 180 }, tide: { height: 2.0, rate:  0.4, stage: 'rising' }, ratings: { size: 3, windQuality: 7, rideQuality: 2 } },
  { swell: { height: 2.4, direction: 94,  period: 9.2, secondary: { height: 0.5, direction: 53,  period: 2.4 } }, wind: { speed: 6,  direction: 247 }, tide: { height: 1.9, rate:  0.5, stage: 'rising' }, ratings: { size: 4, windQuality: 7, rideQuality: 4 } },
  { swell: { height: 2.4, direction: 94,  period: 9.1, secondary: { height: 0.3, direction: 91,  period: 3.9 } }, wind: { speed: 4,  direction: 270 }, tide: { height: 1.6, rate:  0.6, stage: 'rising' }, ratings: { size: 5, windQuality: 8, rideQuality: 5 } }
];

// ── Parameterized feature extractors (port of app.js, LEAK_DEG parameterized) ─

function alignmentScore(directionDeg, leakDeg) {
  if (directionDeg == null || !isFinite(directionDeg)) return 0;
  const lo = SWELL_WIN_MIN, hi = SWELL_WIN_MAX;
  if (directionDeg >= lo && directionDeg <= hi) return 1;
  if (leakDeg <= 0) return 0; // hard gate
  const distOutside = directionDeg < lo ? (lo - directionDeg) : (directionDeg - hi);
  if (distOutside >= leakDeg) return 0;
  return 1 - (distOutside / leakDeg);
}

function effectiveInWindowSwell(cond, leakDeg) {
  const pri = cond?.swell || {};
  const sec = cond?.swell?.secondary;
  const priScore = alignmentScore(pri.direction, leakDeg);
  const secScore = sec ? alignmentScore(sec.direction, leakDeg) : 0;
  const wPri = priScore * (pri.height || 0);
  const wSec = secScore * (sec?.height || 0);
  const effHeight = wPri + wSec;
  const effPeriod = effHeight > 1e-6
    ? (wPri * (pri.period || 0) + wSec * (sec?.period || 0)) / effHeight
    : 0;
  const totalHeight = (pri.height || 0) + (sec?.height || 0);
  return { effHeight, effPeriod, totalHeight };
}

function extractWaveFeatures(cond, leakDeg) {
  if (!cond?.swell) return null;
  const { effHeight, effPeriod, totalHeight } = effectiveInWindowSwell(cond, leakDeg);
  return [effHeight, effPeriod, totalHeight];
}

function extractRideFeatures(cond, leakDeg) {
  if (!cond?.swell) return null;
  const t = cond.tide;
  if (!t || typeof t.height !== 'number' || !isFinite(t.height)) return null;
  let rate = t.rate;
  if (typeof rate !== 'number' || !isFinite(rate)) {
    if (t.stage === 'rising') rate = 0.5;
    else if (t.stage === 'falling') rate = -0.5;
    else rate = 0;
  }
  const { effHeight, effPeriod } = effectiveInWindowSwell(cond, leakDeg);
  return [t.height, rate, effPeriod, effHeight];
}

const WAVE_FEATURE_NAMES = ['effective_in_window_height', 'effective_in_window_period', 'total_swell_height'];
const RIDE_FEATURE_NAMES = ['tide_height', 'tide_rate', 'effective_in_window_period', 'effective_in_window_height'];

// ── Matrix math + ridge OLS (verbatim from app.js) ──────────────────

function matTranspose(A) { const r=A.length,c=A[0].length,T=[]; for(let j=0;j<c;j++){T[j]=[]; for(let i=0;i<r;i++) T[j][i]=A[i][j];} return T; }
function matMul(A,B) { const rA=A.length,cA=A[0].length,cB=B[0].length,C=Array.from({length:rA},()=>new Array(cB).fill(0)); for(let i=0;i<rA;i++) for(let j=0;j<cB;j++) for(let k=0;k<cA;k++) C[i][j]+=A[i][k]*B[k][j]; return C; }
function matInvert(m) {
  const n=m.length, aug=m.map((r,i)=>{const row=[...r]; for(let j=0;j<n;j++) row.push(i===j?1:0); return row;});
  for(let c=0;c<n;c++){
    let mr=c; for(let r=c+1;r<n;r++) if(Math.abs(aug[r][c])>Math.abs(aug[mr][c])) mr=r;
    [aug[c],aug[mr]]=[aug[mr],aug[c]];
    if(Math.abs(aug[c][c])<1e-10) return null;
    const piv=aug[c][c]; for(let j=0;j<2*n;j++) aug[c][j]/=piv;
    for(let r=0;r<n;r++){ if(r===c) continue; const f=aug[r][c]; for(let j=0;j<2*n;j++) aug[r][j]-=f*aug[c][j]; }
  }
  return aug.map(r=>r.slice(n));
}

function normalEquation(X,y) {
  const Xt=matTranspose(X), XtX=matMul(Xt,X);
  for(let i=0;i<XtX.length;i++) XtX[i][i]+=0.001;
  const inv=matInvert(XtX); if(!inv) return null;
  return matMul(inv, matMul(Xt, y.map(v=>[v]))).map(r=>r[0]);
}

function trainOnArrays(X, y) {
  if (!X.length) return null;
  const nF = X[0].length;
  const stats = { mean: [], std: [] };
  for (let j = 0; j < nF; j++) {
    const col = X.map(r => r[j]);
    const mean = col.reduce((a,b) => a+b, 0) / col.length;
    const variance = col.reduce((a,b) => a + (b-mean)*(b-mean), 0) / col.length;
    stats.mean[j] = mean;
    stats.std[j] = Math.sqrt(variance);
  }
  const Xn = X.map(row => row.map((v,j) => stats.std[j] > 1e-10 ? (v - stats.mean[j]) / stats.std[j] : 0));
  const yMean = y.reduce((a,b) => a+b, 0) / y.length;
  const yCentered = y.map(v => v - yMean);
  const weights = normalEquation(Xn, yCentered);
  if (!weights) return null;
  stats.targetMean = yMean;
  return { weights, stats };
}

function predict(model, xRow) {
  let pred = model.stats.targetMean;
  for (let j = 0; j < xRow.length; j++) {
    const z = model.stats.std[j] > 1e-10 ? (xRow[j] - model.stats.mean[j]) / model.stats.std[j] : 0;
    pred += model.weights[j] * z;
  }
  return pred;
}

function buildXY(extractor, targetFn, leakDeg) {
  const X = [], y = [];
  SESSIONS.forEach(s => {
    const cond = { swell: s.swell, wind: s.wind, tide: s.tide };
    const f = extractor(cond, leakDeg);
    if (f) { X.push(f); y.push(targetFn(s)); }
  });
  return { X, y };
}

function rSquared(X, y, model) {
  const yMean = y.reduce((a,b) => a+b, 0) / y.length;
  let sse = 0, sst = 0;
  for (let i = 0; i < X.length; i++) {
    const pred = predict(model, X[i]);
    sse += (y[i] - pred) ** 2;
    sst += (y[i] - yMean) ** 2;
  }
  return sst > 1e-10 ? 1 - sse / sst : null;
}

function looRMSE(X, y) {
  const nF = X[0].length;
  const minSamples = Math.max(2 * nF, 12);
  if (X.length < minSamples + 1) return null;
  let sse = 0, count = 0;
  for (let h = 0; h < X.length; h++) {
    const Xtr = X.slice(0, h).concat(X.slice(h+1));
    const ytr = y.slice(0, h).concat(y.slice(h+1));
    const m = trainOnArrays(Xtr, ytr);
    if (!m) continue;
    const err = predict(m, X[h]) - y[h];
    sse += err * err; count++;
  }
  return count ? Math.sqrt(sse / count) : null;
}

function sweep(label, extractor, targetFn, featureNames, leakValuesOverride) {
  const leakValues = leakValuesOverride || [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
  const rows = [];
  for (const leakDeg of leakValues) {
    const { X, y } = buildXY(extractor, targetFn, leakDeg);
    const model = trainOnArrays(X, y);
    const r2 = model ? rSquared(X, y, model) : null;
    const loo = looRMSE(X, y);
    let topIdx = -1, topAbs = -Infinity;
    if (model) {
      for (let j = 0; j < model.weights.length; j++) {
        const a = Math.abs(model.weights[j]);
        if (a > topAbs) { topAbs = a; topIdx = j; }
      }
    }
    rows.push({
      leakDeg,
      r2,
      loo,
      topFeature: topIdx >= 0 ? featureNames[topIdx] : null,
      topWeight: topIdx >= 0 ? model.weights[topIdx] : null,
      n: X.length
    });
  }

  const fmt = v => v == null ? 'n/a' : v.toFixed(4);
  const fmtW = v => v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(4);
  const header = '| LEAK_DEG | R²       | LOO-RMSE | Top feature                  | Top feature weight |';
  const sep    = '|---------:|---------:|---------:|------------------------------|-------------------:|';
  console.log(`\n──────── ${label} model sensitivity (n=${rows[0].n}) ────────`);
  console.log(header);
  console.log(sep);
  rows.forEach(r => {
    console.log(`| ${String(r.leakDeg).padStart(8)} | ${fmt(r.r2).padStart(8)} | ${fmt(r.loo).padStart(8)} | ${(r.topFeature || 'n/a').padEnd(28)} | ${fmtW(r.topWeight).padStart(18)} |`);
  });

  const ranked = rows.filter(r => r.loo != null).sort((a,b) => a.loo - b.loo);
  if (ranked.length) {
    const best = ranked[0];
    console.log(`\nBest LEAK_DEG by LOO-RMSE: ${best.leakDeg}°  (LOO-RMSE=${best.loo.toFixed(4)}, R²=${fmt(best.r2)})`);
    const prodRow = rows.find(r => r.leakDeg === 30);
    if (prodRow && prodRow.loo != null) {
      const delta = best.loo - prodRow.loo;
      const pct = (delta / prodRow.loo) * 100;
      console.log(`Production LEAK_DEG=30 LOO-RMSE: ${prodRow.loo.toFixed(4)}  (delta from best: ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`);
    }
  }
  return rows;
}

console.log('LEAK_DEG sensitivity sweep — read-only, no production code modified.');
console.log(`Dataset: ${SESSIONS.length}-session synthetic corpus from scripts/smoke_regression.js`);
console.log(`Swell window: [${SWELL_WIN_MIN}°, ${SWELL_WIN_MAX}°]`);
console.log(`Ridge λ = 0.001 (matches app.js normalEquation)`);

sweep('WAVE  (target=ratings.size)',         extractWaveFeatures, s => s.ratings.size,        WAVE_FEATURE_NAMES);
sweep('RIDE  (target=ratings.rideQuality)',  extractRideFeatures, s => s.ratings.rideQuality, RIDE_FEATURE_NAMES);

// Extended Wave-only sweep across wider softening ranges. The base sweep
// showed Wave LOO-RMSE was still falling at the right edge of the original
// [0..45] grid; this block tests whether the curve plateaus, bottoms out, or
// keeps falling beyond 45°. Ride is intentionally omitted — its optimum sits
// at 15° and behavior beyond 45° is not in question.
sweep('WAVE-EXTENDED  (target=ratings.size)', extractWaveFeatures, s => s.ratings.size, WAVE_FEATURE_NAMES,
      [30, 40, 50, 60, 75, 90, 120]);
