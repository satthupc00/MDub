// Xuất icon PNG các cỡ từ build/icon.svg (cỡ nhỏ dùng icon-small.svg) bằng Chromium của Playwright.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const big = fs.readFileSync('build/icon.svg', 'utf8'), small = fs.readFileSync('build/icon-small.svg', 'utf8');
  fs.mkdirSync('build/png', { recursive: true });
  for (const s of [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]) {
    const svg = s <= 40 ? small : big;
    await p.setViewportSize({ width: s, height: s });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    await p.screenshot({ path: `build/png/${s}.png`, omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
  }
  await b.close();
})();
