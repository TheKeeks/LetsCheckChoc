// Fishers Bracelet plans for the jeweller (bracelet/plans.js): a real-size
// flat drawing of the piece before the tail is wrapped, the spec, and how to
// make it, in Spanish by default. Checks the drawing is 1:1 on Letter
// landscape, the Spanish instructions follow the route and the joint/clasp
// design, and the committed PDF/SVG match the code.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO_ROOT } = require('../helpers/load-app');

const G = require(path.join(REPO_ROOT, 'bracelet/geometry.js'));
const P = require(path.join(REPO_ROOT, 'bracelet/plans.js'));
const { jsPDF } = require(path.join(REPO_ROOT, 'bracelet/vendor/jspdf.umd.min.js'));
const OUTLINE = (() => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'bracelet/fishers-outline.js'), 'utf8') + '\nthis.out = FISHERS_OUTLINE;', ctx);
  return ctx.out;
})();
const model = G.build({}, OUTLINE);

test('the drawing is real size on a US Letter landscape page', () => {
  const svg = P.svg(model, 'es');
  assert.match(svg, /^<svg [^>]*width="279.4mm" height="215.9mm" viewBox="0 0 279.4 215.9"/);
  // The first polyline is the wire: island plus straight tail, in millimetres.
  const pts = /<polyline points="([^"]+)"/.exec(svg)[1].split(' ').map(p => p.split(',').map(Number));
  const xs = pts.map(p => p[0]);
  const fp = model.flatPiece;
  const flatSpan = Math.max(...fp.pts.map(p => p[0])) - Math.min(...fp.pts.map(p => p[0]));
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - flatSpan) < 0.05, 'drawn 1:1');
  assert.match(svg, /stroke-width="3"/, 'wire drawn at its real 3 mm thickness');
  assert.ok(Math.max(...xs) < 279.4 - 12 && Math.min(...xs) > 12, 'fits inside the margins');
  // The 50 mm check bar.
  assert.match(svg, /<polyline points="12,126 62,126"/);
  assert.match(svg, /esta barra debe medir 50 mm impresa al 100 %/);
});

test('Spanish labels: the joint, the ball on North Hill, sizes with decimal commas; no Choc or Wilderness', () => {
  const svg = P.svg(model, 'es');
  for (const s of ['Pulsera Fishers Island: plano a escala real (1:1)', 'Extremo Este (Wicopesset): el inicio se suelda', 'a tope aquí, mismo grosor, sin doblar el alambre',
    'North Hill: aquí se apoya', 'Bola Ø 4,2 mm', 'isla 65 mm', '16,4 mm', 'Race Point', 'Silver Eel', 'Vista lateral, 1:1', 'Ø interior 50,5 mm', 'cola recta']) {
    assert.ok(svg.includes(s), `drawing says “${s}”`);
  }
  assert.doesNotMatch(svg, /Chocomount|Wilderness/, 'those labels are gone');
  const en = P.svg(model, 'en');
  assert.ok(en.includes('4.2 mm ball') && en.includes('island 65 mm'), 'English drawing uses decimal points');
});

test('how to make it, in Spanish: the route, the T joint, the mandrel, the ball', () => {
  const steps = P.steps(model, 'es');
  assert.ok(steps.length >= 10, `${steps.length} steps`);
  const all = steps.join('\n');
  for (const s of ['oro amarillo de 18 k, Ø 3,0 mm', 'Recueza', 'al 100 %', 'Extremo Este (Wicopesset)', 'unión en T', 'sin superponerlo ni doblarlo', 'mismo grosor',
    'tribulete de pulsera de 50,5 mm', '158,75 mm de circunferencia', 'círculo perfecto y plano', 'bola de Ø 4,2 mm', 'sube por debajo de la muñeca', 'se apoya sobre North Hill', 'pula']) {
    assert.ok(all.includes(s), `steps say “${s}”`);
  }
  assert.ok(all.indexOf('North Hill y Silver Eel, hasta Race Point') > 0, 'north shore in the described order');
  assert.ok(all.indexOf('costa norte') < all.indexOf('costa sur') && all.indexOf('costa sur') < all.indexOf('unión en T') && all.indexOf('unión en T') < all.indexOf('tribulete') && all.indexOf('tribulete') < all.indexOf('bola de'), 'steps in making order');
  assert.doesNotMatch(all, /Chocomount|Wilderness/);
  assert.match(all, /usa 283 mm de alambre/, 'quotes the wire length');
  const en = P.steps(model, 'en').join('\n');
  assert.match(en, /T joint/);
  assert.match(en, /50\.5 mm across/);
});

test('the note to the jeweller asks for a price and lead time', () => {
  const es = P.message(model, 'es');
  assert.match(es, /¿Podría cotizar y hacer esta pulsera\?/);
  assert.match(es, /precio y el plazo de entrega/);
  assert.match(es, /Largo de alambre: 283 mm/);
  assert.match(es, /6,25 pulgadas/);
  assert.match(P.message(model, 'en'), /price and lead time/);
});

test('the PDF: two Letter landscape pages, drawing then instructions', () => {
  const doc = P.pdf(model, 'es', jsPDF);
  assert.equal(doc.getNumberOfPages(), 2);
  assert.equal(doc.internal.pageSize.getWidth().toFixed(1), '279.4');
  assert.equal(doc.internal.pageSize.getHeight().toFixed(1), '215.9');
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.slice(0, 5).toString(), '%PDF-');
  const text = bytes.toString('latin1');
  for (const s of ['Pulsera Fishers Island: plano a escala real', 'Recueza el alambre', 'Datos']) assert.ok(text.includes(s), `PDF has “${s}”`);
});

test('the committed plans match the code (run node scripts/bracelet_plans.js after changes)', () => {
  const { build } = require(path.join(REPO_ROOT, 'scripts/bracelet_plans.js'));
  const out = build();
  const dir = path.join(REPO_ROOT, 'bracelet/plans');
  assert.ok(out.pdf.equals(fs.readFileSync(path.join(dir, P.FILE.pdf))), `${P.FILE.pdf} is stale`);
  assert.equal(fs.readFileSync(path.join(dir, P.FILE.svg), 'utf8'), out.svg, `${P.FILE.svg} is stale`);
});
