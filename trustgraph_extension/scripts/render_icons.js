// Renders icons/icon.svg (the website's logo) to the toolbar PNGs with
// Chromium, so the extension icon matches the website pixel for pixel. Dev-only.
//
//   NODE_PATH=<folder with playwright> node trustgraph_extension/scripts/render_icons.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ICONS = path.resolve(__dirname, "..", "icons");
const svg = fs.readFileSync(path.join(ICONS, "icon.svg"), "utf8");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    // The 16 px icon gets a slightly thicker stroke so the check stays readable.
    const art = svg.replace(/width="128" height="128"/, `width="${size}" height="${size}"`).replace('stroke-width="2.5"', `stroke-width="${size <= 16 ? 3 : 2.5}"`);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${art}`);
    await page.screenshot({ path: path.join(ICONS, `icon-${size}.png`), omitBackground: true });
    console.log(`wrote icons/icon-${size}.png`);
  }
  await browser.close();
})();
