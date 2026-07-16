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
    // Mirror of KIOSK_COAST in kiosk.js (the owner-traced coastline,
    // normalized over the sketch frame). Keep in sync by hand — this
    // script never loads the page.
    const SHORE = [
      [0.013, 0.978], [0.058, 0.942], [0.102, 0.917], [0.139, 0.894],
      [0.160, 0.880], [0.156, 0.833], [0.159, 0.772], [0.168, 0.711],
      [0.181, 0.656], [0.196, 0.606], [0.215, 0.556], [0.236, 0.506],
      [0.259, 0.456], [0.285, 0.400], [0.312, 0.350], [0.338, 0.306],
      [0.364, 0.261], [0.390, 0.220], [0.416, 0.183], [0.442, 0.156],
      [0.469, 0.139], [0.497, 0.113], [0.524, 0.091], [0.550, 0.072],
      [0.576, 0.058], [0.602, 0.050], [0.623, 0.056], [0.644, 0.067],
      [0.665, 0.080], [0.686, 0.098], [0.702, 0.120], [0.717, 0.150],
      [0.730, 0.183], [0.743, 0.220], [0.759, 0.244], [0.780, 0.267],
      [0.806, 0.291], [0.838, 0.313], [0.869, 0.330], [0.901, 0.344],
      [0.932, 0.353], [0.963, 0.356], [0.992, 0.359]
    ];
    const ASPECT = 2.122;
    const WIN_MIN = 115, WIN_MAX = 158; // swell window bearings

    function drawIcon(size) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');

      // Square crop of the frame, centered on the lineup point.
      const LINEUP = [0.482, 0.306];
      const fh = size * 1.3, fw = fh * ASPECT;
      const fx = size / 2 - LINEUP[0] * fw, fy = size / 2 - LINEUP[1] * fh;
      const px = p => [fx + p[0] * fw, fy + p[1] * fh];
      const lx = size / 2, ly = size / 2;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);

      // Land mass above the shore line.
      ctx.beginPath();
      const [x0, y0] = px(SHORE[0]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < SHORE.length; i++) { const [x, y] = px(SHORE[i]); ctx.lineTo(x, y); }
      ctx.lineTo(size * 3, size * 0.5);
      ctx.lineTo(size * 3, -size); ctx.lineTo(-size, -size); ctx.lineTo(-size, size * 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(69, 255, 154, 0.10)';
      ctx.fill();

      // Coastline stroke.
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 1; i < SHORE.length; i++) { const [x, y] = px(SHORE[i]); ctx.lineTo(x, y); }
      ctx.lineTo(size * 3, size * 0.5);
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
