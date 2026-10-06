// Universal click-to-check, end to end: the real extension in Chromium, the
// real backend (tests/universal_e2e_server.py: app.main against the
// PostgreSQL database in DATABASE_URL, seeded with a known image and two
// reported scam messages) and local pages that
// reproduce what real sites do (cross-origin images without CORS, CSS
// backgrounds, canvas, video, iframes, open shadow DOM, lazy/infinite
// content, overlays over photos and players, SPA navigation).
//
//   DATABASE_URL=postgresql+psycopg://...(a throwaway database) \
//   NODE_PATH=<folder with playwright> node trustgraph_extension/test/universal-e2e.js
//
// A seeded image that comes back as db_match=true after a SCREENSHOT crop
// proves the crop landed on the element (a misaligned crop would not match).
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const EXT = path.resolve(__dirname, "..");
const ROOT = path.resolve(EXT, "..");
const FIX = path.join(__dirname, "fixtures", "universal");
const ASSETS = fs.mkdtempSync(path.join(os.tmpdir(), "tg-assets-"));
const PY = process.env.PYTHON || "python3";

let fails = 0;
const results = [];
function check(ok, label, extra) {
  if (!ok) fails++;
  results.push({ ok, label });
  console.log(ok ? "  ok  " : "  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const proc = spawn(PY, [path.join(ROOT, "tests", "universal_e2e_server.py"), "--assets", ASSETS, "--port", "8000"], { cwd: ROOT });
  const log = [];
  const onData = (d) => log.push(...String(d).split("\n").filter(Boolean));
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8000/health")).ok) break;
    } catch (_) {}
    await sleep(500);
  }
  // Warm the text engine so the extension's 3 s scoring timeout isn't spent loading models.
  await fetch("http://127.0.0.1:8000/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "warm up", channel: "other" }) });
  return { proc, log };
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webm": "video/webm" };
function serve(route, file) {
  const ext = path.extname(file);
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(file) });
}

// The test "sites", served by a real HTTP server that sends NO CORS headers
// (Playwright's route.fulfill adds them, which would hide the fallbacks).
// Chromium maps every *.test host to it (--host-resolver-rules).
function siteFile(host, p) {
  const base = path.basename(p);
  if (host === "cdn.other.test") return path.join(ASSETS, base);
  if (host === "embed.other.test") return path.join(FIX, "frame.html");
  if (host === "social.test") return path.join(FIX, base.endsWith(".js") ? "feed.js" : "feed.html");
  if (host === "video.test") return path.join(FIX, base.endsWith(".js") ? "player.js" : "player.html");
  if (p === "/") return path.join(FIX, "article.html");
  return /\.(png|webm)$/.test(base) ? path.join(ASSETS, base) : path.join(FIX, base);
}
function startSites() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const host = String(req.headers.host || "").split(":")[0];
      const file = siteFile(host, new URL(req.url, "http://x").pathname);
      if (!fs.existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  const server = await startServer();
  const media = () => server.log.filter((l) => l.includes("media check:"));
  const sites = await startSites();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-profile-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=MAP *.test 127.0.0.1:${sites.address().port}`],
    viewport: { width: 1280, height: 900 },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  await sw.evaluate(() => chrome.storage.local.set({ settings: { backend_url: "http://127.0.0.1:8000" } })); // the local test server

  await ctx.route("https://web.whatsapp.com/**", (r) => serve(r, path.join(__dirname, "fixtures", "whatsapp-page.html")));
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("trustgraph-debug-scan", "1");
    } catch (_) {}
  });

  async function open(url) {
    const page = await ctx.newPage();
    const logs = [];
    const errors = [];
    page.on("console", (m) => {
      if (m.text().includes("[TrustGraph universal]")) logs.push(m.text());
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.bringToFront(); // a screenshot is only taken of the visible tab
    await sleep(1500);
    return { page, logs, errors };
  }

  // Hover an element (by its centre), then report what got a shield.
  async function hover(t, selector, frame) {
    await t.page.mouse.move(2, 2);
    await sleep(500);
    const loc = (frame || t.page).locator(selector).first();
    await loc.scrollIntoViewIfNeeded();
    await sleep(300);
    const before = t.logs.length;
    const box = await loc.boundingBox();
    await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(400);
    return { box, shown: t.logs.slice(before).filter((l) => l.includes("shield on")) };
  }
  // Click where the shield sits (media: top-left, text: top-right), wait for the result.
  async function clickShield(t, box, kind, wait = 9000) {
    const before = t.logs.length;
    const x = kind === "text" ? box.x + box.width - 6 - 15 : box.x + 6 + 15;
    await t.page.mouse.move(x, box.y + 6 + 15, { steps: 3 });
    await t.page.mouse.click(x, box.y + 6 + 15);
    for (let i = 0; i < wait / 250; i++) {
      const r = t.logs.slice(before).find((l) => l.includes("result"));
      if (r) return r;
      await sleep(250);
    }
    return null;
  }
  async function checkMedia(t, selector, kind, expect, frameSel) {
    const frame = frameSel ? t.page.frameLocator(frameSel) : null;
    const h = await hover(t, selector, frame);
    const shown = h.shown.some((l) => l.includes(`shield on ${kind}`));
    check(shown, `${t.name}: shield on ${selector} (${kind})`, h.shown.slice(-1));
    if (!shown) return;
    const res = await clickShield(t, h.box, kind, kind === "video" ? 20000 : 9000);
    check(!!res && res.includes(`capture=${expect.capture}`) && res.includes(`db_match=${expect.db}`), `${t.name}: ${selector} -> capture ${expect.capture}, db_match ${expect.db}`, res);
  }

  // --- 1. news article ------------------------------------------------------
  console.log("news article (http://news.test/)");
  const a = await open("http://news.test/");
  a.name = "article";
  const layoutBefore = await a.page.evaluate(() => [document.documentElement.scrollHeight, document.getElementById("para").getBoundingClientRect().top]);
  let h = await hover(a, "#para");
  check(h.shown.some((l) => l.includes("shield on text")), "article: shield on a paragraph", h.shown);
  let r = await clickShield(a, h.box, "text");
  check(!!r && r.includes("db_match=false"), "article: ordinary paragraph -> result, no database match", r);
  h = await hover(a, "#scam");
  r = await clickShield(a, h.box, "text");
  check(!!r && r.includes("db_match=true") && !r.includes("model=low"), "article: known scam text -> flagged and matched in the database", r);
  await checkMedia(a, "#same", "image", { capture: "direct", db: true });
  await checkMedia(a, "#cross", "image", { capture: "fetch", db: false });
  await checkMedia(a, "#bg", "image", { capture: "fetch", db: true });
  h = await hover(a, "#tiny");
  check(!h.shown.some((l) => l.includes("shield on image")), "article: no shield on a 60px thumbnail", h.shown);
  await checkMedia(a, "#canvas", "image", { capture: "direct", db: true });
  await checkMedia(a, "#video", "video", { capture: "direct", db: true });
  await checkMedia(a, "#xvideo", "video", { capture: "screenshot", db: true });
  await checkMedia(a, "#framed", "image", { capture: "fetch", db: true }, "#frame");
  await checkMedia(a, "#tainted", "image", { capture: "screenshot", db: true }, "#frame");
  await checkMedia(a, "#in-shadow", "image", { capture: "direct", db: true });
  await a.page.evaluate(() => document.getElementById("feed").scrollIntoView());
  await sleep(600);
  await checkMedia(a, "#lazy", "image", { capture: "direct", db: true });
  await a.page.evaluate(() => scrollTo(0, 0));
  await sleep(300);
  const layoutAfter = await a.page.evaluate(() => [document.documentElement.scrollHeight, document.getElementById("para").getBoundingClientRect().top]);
  check(JSON.stringify(layoutBefore) === JSON.stringify(layoutAfter), "article: layout unchanged", { layoutBefore, layoutAfter });
  await a.page.mouse.move(640, 450);
  await a.page.mouse.wheel(0, 600);
  await sleep(400);
  check((await a.page.evaluate(() => scrollY)) > 0, "article: scrolling with the wheel still works");
  check(a.errors.length === 0, "article: no console errors", a.errors);

  // --- 2. social feed: overlay over the photo + SPA navigation ---------------
  console.log("social feed (http://social.test/)");
  const f = await open("http://social.test/");
  f.name = "feed";
  await checkMedia(f, "#photo", "image", { capture: "fetch", db: true });
  await f.page.click("#next");
  await sleep(800);
  check(f.page.url().endsWith("/feed/next"), "feed: in-app navigation happened");
  await checkMedia(f, "#photo2", "image", { capture: "fetch", db: false });
  check(f.errors.length === 0, "feed: no console errors", f.errors);

  // --- 3. video player: overlay + controls ----------------------------------
  console.log("video player (http://video.test/)");
  const v = await open("http://video.test/");
  v.name = "player";
  await checkMedia(v, "#v", "video", { capture: "screenshot", db: true });
  await v.page.click("#pp");
  await sleep(300);
  check((await v.page.textContent("#clicks")) === "1" && (await v.page.evaluate(() => document.getElementById("v").paused)), "player: its own pause button still works");
  check(v.errors.length === 0, "player: no console errors", v.errors);

  // --- 4. WhatsApp: the site adapter keeps text; no universal text shields ---
  console.log("WhatsApp fixture (https://web.whatsapp.com/)");
  const w = await open("https://web.whatsapp.com/");
  w.name = "whatsapp";
  h = await hover(w, "#pane-side .xprev");
  check(!h.shown.length, "whatsapp: no universal shield on the chat list", h.shown);
  h = await hover(w, '[data-id="3EB0B55E"] span.selectable-text');
  check(!h.shown.some((l) => l.includes("shield on text")), "whatsapp: messages stay with the existing shield", h.shown);
  check(w.errors.length === 0, "whatsapp: no console errors", w.errors);

  // --- 5. extension -> backend -> database ----------------------------------
  const health = await sw.evaluate(() => Universal.health());
  check(health.ok === true && health.probe_found === true && health.reports >= 2, "health: extension -> backend -> database round trip", health);

  // --- 6. the shield's own check (any adapter site) uses /api/detect matching ---
  const retyped = "DEAR CUSTOMER!! Your SBI KYC is pending, and your account will be blocked today... share the OTP to verify immediately";
  const hit = await sw.evaluate((t) => scoreMessage(t, "whatsapp"), retyped);
  check(hit.database && hit.database.matches >= 1 && hit.riskLevel !== "low" && hit.source === "server", "shield check: a re-typed reported scam matches the database", { level: hit.riskLevel, db: hit.database });
  const calm = await sw.evaluate((t) => scoreMessage(t, "whatsapp"), "Are we still on for lunch on Sunday at the usual place near the station?");
  check(calm.database && calm.database.checked && calm.database.matches === 0 && calm.riskLevel === "low" && !calm.serverError, "shield check: an ordinary message is checked against the database, no match", { level: calm.riskLevel, db: calm.database });

  console.log("\nserver saw:\n " + media().slice(-14).join("\n "));
  await ctx.close();
  server.proc.kill();
  sites.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  fs.writeFileSync(path.join(os.tmpdir(), "tg-universal-e2e.json"), JSON.stringify(results, null, 2));
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
