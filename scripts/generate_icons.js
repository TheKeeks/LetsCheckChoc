// Dev-only: renders the Choc TV PWA icons — the radar scope's coastline
// outline with the swell-window cone and lineup dot, phosphor green on
// true black — to PNG via a headless-Chromium canvas. Never loaded by
// the page; run once when the icon design changes:
//
//   node scripts/generate_icons.js
//
// Writes icons/icon-512.png, icons/icon-192.png, icons/apple-touch-icon.png.
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const OUT_DIR = path.join(__dirname, '..', 'icons');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const dataUrls = await page.evaluate(sizes => {
    // Mirror of KIOSK_COAST in kiosk.js (normalized over the lineup.jpg
    // frame, 1992×949; lineup at frame center). Keep in sync by hand —
    // this script never loads the page.
    const SHORE = [
      [0.216, 1.000], [0.199, 0.915], [0.201, 0.845], [0.216, 0.775],
      [0.238, 0.708], [0.259, 0.649], [0.281, 0.594], [0.306, 0.545],
      [0.336, 0.499], [0.367, 0.463], [0.399, 0.428], [0.433, 0.392],
      [0.468, 0.357], [0.503, 0.327], [0.541, 0.303], [0.577, 0.288],
      [0.612, 0.282], [0.647, 0.286], [0.678, 0.301], [0.700, 0.329],
      [0.719, 0.364], [0.741, 0.409], [0.766, 0.451], [0.796, 0.482],
      [0.833, 0.508], [0.874, 0.527], [0.919, 0.544], [0.963, 0.556],
      [1.000, 0.562]
    ];
    const ASPECT = 1992 / 949;
    const WIN_MIN = 115, WIN_MAX = 158; // swell window bearings

    function drawIcon(size) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');

      // Square crop of the frame, centered on the lineup: frame height =
      // icon height, horizontal overflow cropped evenly.
      const fh = size, fw = size * ASPECT;
      const fx = (size - fw) / 2, fy = 0;
      const px = p => [fx + p[0] * fw, fy + p[1] * fh];
      const lx = size / 2, ly = size / 2;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      // Land mass above the shore line.
      ctx.beginPath();
      const [x0, y0] = px(SHORE[0]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < SHORE.length; i++) { const [x, y] = px(SHORE[i]); ctx.lineTo(x, y); }
      ctx.lineTo(size, size * 0.562);
      ctx.lineTo(size, 0); ctx.lineTo(0, 0); ctx.lineTo(0, size);
      ctx.closePath();
      ctx.fillStyle = 'rgba(69, 255, 154, 0.10)';
      ctx.fill();

      // Coastline stroke.
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 1; i < SHORE.length; i++) { const [x, y] = px(SHORE[i]); ctx.lineTo(x, y); }
      ctx.lineTo(size, size * 0.562);
      ctx.strokeStyle = '#45ff9a';
      ctx.lineWidth = Math.max(2, size * 0.022);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // Swell-window cone from the lineup (compass θ → canvas θ − 90°).
      const r = size * 0.44;
      const a1 = WIN_MIN * Math.PI / 180 - Math.PI / 2;
      const a2 = WIN_MAX * Math.PI / 180 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.arc(lx, ly, r, a1, a2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(69, 255, 154, 0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(69, 255, 154, 0.55)';
      ctx.lineWidth = Math.max(1.5, size * 0.012);
      ctx.stroke();

      // Lineup dot.
      ctx.beginPath();
      ctx.arc(lx, ly, size * 0.035, 0, Math.PI * 2);
      ctx.fillStyle = '#45ff9a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly, size * 0.07, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(69, 255, 154, 0.5)';
      ctx.lineWidth = Math.max(1.5, size * 0.012);
      ctx.stroke();

      return c.toDataURL('image/png');
    }
    const out = {};
    for (const s of sizes) out[s] = drawIcon(s);
    return out;
  }, [512, 192, 180]);

  const write = (name, dataUrl) => {
    const b64 = dataUrl.split(',')[1];
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(b64, 'base64'));
    console.log('wrote icons/' + name);
  };
  write('icon-512.png', dataUrls[512]);
  write('icon-192.png', dataUrls[192]);
  write('apple-touch-icon.png', dataUrls[180]);

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
