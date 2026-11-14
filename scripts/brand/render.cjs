const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [file, w, h, out] of JSON.parse(process.argv[2])) {
    await p.setViewportSize({ width: w, height: h });
    const svg = fs.readFileSync(file, 'utf8').replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);
    await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
  }
  await b.close();
})();
