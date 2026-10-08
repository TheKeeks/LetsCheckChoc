#!/usr/bin/env node
// Dev-only: regenerate the jeweller's plans for the standard Fishers Bracelet
// design, bracelet/plans/plano-pulsera-fishers.{pdf,svg} (Spanish). The page
// builds the same files for any design on demand; these copies are for
// sending straight from the repo. tests/unit/bracelet-plans.test.js fails if
// they drift from the code, so run this after changing geometry.js or plans.js:
//
//   node scripts/bracelet_plans.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'bracelet');
const OUT = path.join(DIR, 'plans');

function outline() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DIR, 'fishers-outline.js'), 'utf8') + '\nthis.out = FISHERS_OUTLINE;', ctx);
  return ctx.out;
}

// Same input, same bytes: fixed creation date and file id.
function build() {
  const G = require(path.join(DIR, 'geometry.js'));
  const P = require(path.join(DIR, 'plans.js'));
  const { jsPDF } = require(path.join(DIR, 'vendor', 'jspdf.umd.min.js'));
  const model = G.build({}, outline());
  const doc = P.pdf(model, 'es', jsPDF);
  doc.setCreationDate("D:20261008000000+00'00'");   // a PDF date string, so the local timezone can't change the bytes
  doc.setFileId('0F15E5B7AC3E1E7F15E5B7AC3E1E7A11');
  return {
    pdf: Buffer.from(doc.output('arraybuffer')),
    svg: P.svg(model, 'es') + '\n',
    names: P.FILE
  };
}

if (require.main === module) {
  const out = build();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, out.names.pdf), out.pdf);
  fs.writeFileSync(path.join(OUT, out.names.svg), out.svg);
  console.log(`wrote bracelet/plans/${out.names.pdf} (${out.pdf.length} bytes) and ${out.names.svg} (${out.svg.length} bytes)`);
}

module.exports = { build };
