// Universal click-to-check (text only), end to end: the real extension in
// Chromium, the real backend (tests/universal_e2e_server.py: app.main against
// the PostgreSQL database in DATABASE_URL, seeded with two reported scam
// messages) and local pages that reproduce what real sites do (images,
// canvas, video, iframes, open shadow DOM, overlays over photos and players,
// SPA navigation).
//
//   DATABASE_URL=postgresql+psycopg://...(a throwaway database) \
//   NODE_PATH=<folder with playwright> node trustgraph_extension/test/universal-e2e.js
//
// Text gets a shield and a verdict; images and videos must get NO shield, and
// nothing is ever sent to the server's media check.
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
  // Click where the shield sits (top-right of the text), wait for the result.
  async function clickShield(t, box, wait = 9000) {
    const before = t.logs.length;
    const x = box.x + box.width - 6 - 15;
    await t.page.mouse.move(x, box.y + 6 + 15, { steps: 3 });
    await t.page.mouse.click(x, box.y + 6 + 15);
    for (let i = 0; i < wait / 250; i++) {
      const r = t.logs.slice(before).find((l) => l.includes("result"));
      if (r) return r;
      await sleep(250);
    }
    return null;
  }
  // Images and videos are never checked: hovering one shows no shield.
  async function noMediaShield(t, selector, frameSel) {
    const frame = frameSel ? t.page.frameLocator(frameSel) : null;
    const h = await hover(t, selector, frame);
    check(!h.shown.some((l) => /shield on (image|video)/.test(l)), `${t.name}: no shield on ${selector} (images and videos aren't checked)`, h.shown.slice(-1));
  }

  // --- 1. news article ------------------------------------------------------
  console.log("news article (http://news.test/)");
  const a = await open("http://news.test/");
  a.name = "article";
  const layoutBefore = await a.page.evaluate(() => [document.documentElement.scrollHeight, document.getElementById("para").getBoundingClientRect().top]);
  let h = await hover(a, "#para");
  check(h.shown.some((l) => l.includes("shield on text")), "article: shield on a paragraph", h.shown);
  let r = await clickShield(a, h.box);
  check(!!r && r.includes("db_match=false"), "article: ordinary paragraph -> result, no database match", r);
  h = await hover(a, "#scam");
  r = await clickShield(a, h.box);
  check(!!r && r.includes("db_match=true") && !r.includes("model=low"), "article: known scam text -> flagged and matched in the database", r);
  for (const sel of ["#same", "#cross", "#bg", "#canvas", "#video", "#xvideo", "#in-shadow"]) await noMediaShield(a, sel);
  await noMediaShield(a, "#framed", "#frame");
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
  await noMediaShield(f, "#photo");
  await f.page.click("#next");
  await sleep(800);
  check(f.page.url().endsWith("/feed/next"), "feed: in-app navigation happened");
  await noMediaShield(f, "#photo2");
  check(f.errors.length === 0, "feed: no console errors", f.errors);

  // --- 3. video player: overlay + controls ----------------------------------
  console.log("video player (http://video.test/)");
  const v = await open("http://video.test/");
  v.name = "player";
  await noMediaShield(v, "#v");
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

  check(media().length === 0, "server: no image or video was sent to /api/media/check", media().slice(-3));
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
