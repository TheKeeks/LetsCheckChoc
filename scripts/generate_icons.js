// Dev-only: renders the Choc TV PWA icons (Win95 navy tile, beveled
// border, the titlebar wave glyph, "CHOC TV" wordmark) to PNG via a
// headless-Chromium canvas. Never loaded by the page; run once when the
// icon design changes:
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
    function drawIcon(size) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      const u = size / 64; // design units on a 64px grid

      // Face + Win95 raised bevel
      ctx.fillStyle = '#C0C0C0';
      ctx.fillRect(0, 0, size, size);
      const bev = Math.max(2, Math.round(3 * u));
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, bev); ctx.fillRect(0, 0, bev, size);
      ctx.fillStyle = '#404040';
      ctx.fillRect(0, size - bev, size, bev); ctx.fillRect(size - bev, 0, bev, size);

      // Navy inner tile (title-bar blue)
      const inset = Math.round(7 * u);
      ctx.fillStyle = '#000080';
      ctx.fillRect(inset, inset, size - 2 * inset, size - 2 * inset);

      // Wave glyph — two white sine crests across the tile
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(2, Math.round(2.6 * u));
      ctx.lineCap = 'round';
      const left = inset + 6 * u, right = size - inset - 6 * u;
      [0.42, 0.56].forEach(frac => {
        const midY = size * frac;
        const amp = 5 * u;
        ctx.beginPath();
        for (let x = left; x <= right; x += u / 2) {
          const t = (x - left) / (right - left);
          const y = midY + Math.sin(t * Math.PI * 3) * amp;
          if (x === left) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      // Wordmark
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(9.5 * u)}px Tahoma, Geneva, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CHOC TV', size / 2, size * 0.76);

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
