// Extension <-> web workspace, end to end: the real backend (serving the
// built React workspace on the same address), PostgreSQL, the real extension
// in Chromium. Pairing code from the website's Settings -> typed into the
// extension popup -> a checked message's verdict appears on the website, the
// dashboard shows the extension as connected, "Open in workspace" lands on it.
//
//   cd "front end" && npm run build && cd ..
//   DATABASE_URL=postgresql+psycopg://...(a throwaway database) \
//   NODE_PATH=<folder with playwright> node trustgraph_extension/test/workspace-e2e.js
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXT = path.resolve(__dirname, "..");
const ROOT = path.resolve(EXT, "..");
const BASE = "http://127.0.0.1:8000";
const PY = process.env.PYTHON || "python3";
let fails = 0;
const check = (ok, label, extra) => {
  if (!ok) fails++;
  console.log(ok ? "  ok  " : "  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOTS; // optional folder for screenshots
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png") }) : null);

(async () => {
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), "tg-assets-"));
  const server = spawn(PY, [path.join(ROOT, "tests", "universal_e2e_server.py"), "--assets", assets, "--port", "8000"], { cwd: ROOT });
  const log = [];
  server.stdout.on("data", (d) => log.push(String(d)));
  server.stderr.on("data", (d) => log.push(String(d)));
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(BASE + "/health")).ok) break;
    } catch (_) {}
    await sleep(500);
  }

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "tg-profile-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1280, height: 860 },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const extId = sw.url().split("/")[2];

  // 1. The website's Settings page issues a pairing code.
  const site = await ctx.newPage();
  const siteErrors = [];
  site.on("pageerror", (e) => siteErrors.push(e.message));
  await site.goto(BASE + "/app/settings");
  await site.getByTestId("settings-regenerate-key-button").click();
  await site.waitForFunction(() => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(document.querySelector('[data-testid="settings-extension-key"]')?.textContent || ""), null, { timeout: 10000 });
  const code = (await site.getByTestId("settings-extension-key").textContent()).trim();
  await shot(site, "settings");
  check(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), "website: Settings shows a pairing code", code);

  // 2. The extension popup takes it.
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/ui/popup.html`);
  await popup.waitForSelector("#pair-code");
  await popup.fill("#pair-code", code);
  await popup.getByRole("button", { name: "Connect" }).click();
  await sleep(1500);
  const account = await sw.evaluate(() => getAccount());
  check(account.state === "signed_in" && account.online === true && account.mock === false, "extension: paired with the real workspace", account);

  // 3. A shield check on a supported site: verdict saved and synced (no text).
  const scam = "Hi Mum, my phone broke, this is my new number. Please buy 2 Google Play gift cards and send me the codes now.";
  const res = await sw.evaluate((t) => handleMessage({ type: TG.MSG.SCORE, text: t, channel: "whatsapp" }, { tab: { url: "https://web.whatsapp.com/" } }), scam);
  await sleep(800);
  check(res.verdict && res.verdict.riskLevel === "high" && res.saved, "extension: scam checked and saved", { level: res.verdict && res.verdict.riskLevel });
  const id = res.record.id;
  const token = (await sw.evaluate(() => chrome.storage.local.get("account"))).account.token;
  const synced = await (await fetch(BASE + "/api/results", { headers: { Authorization: "Bearer " + token } })).json();
  check(synced.some((r) => r.id === id) && !JSON.stringify(synced).match(/gift|mum|codes/i), "backend: the verdict is stored, with no message text", synced[0]);
  await sw.evaluate(() => sendHeartbeat("whatsapp"));

  // 4. The website shows it.
  await site.goto(BASE + "/app/detections");
  await sleep(1500);
  const listText = await site.textContent("body");
  check(/web\.whatsapp\.com/.test(listText), "website: History lists the extension's verdict");
  await site.goto(BASE + "/app/detections/" + encodeURIComponent(id));
  await sleep(1200);
  const detail = await site.textContent("body");
  await shot(site, "detail");
  check(/request for money/i.test(detail) && !/google play|mum|phone broke/i.test(detail), "website: detail page shows signal types, no message text");
  await site.goto(BASE + "/app/dashboard");
  await sleep(1200);
  check((await site.getByTestId("extension-status-value").textContent()).trim() === "CONNECTED", "website: dashboard shows the extension as connected");
  await shot(site, "dashboard");

  // 5. "Mark as wrong verdict" and "Open in workspace" from the extension.
  await sw.evaluate((v) => handleMessage({ type: TG.MSG.MARK_WRONG, id: v }, {}), id);
  const after = await (await fetch(BASE + "/api/workspace/detections/" + encodeURIComponent(id))).json();
  check(after.feedback === "false_alarm", "website: 'Mark as wrong verdict' reaches the workspace", after.feedback);
  const opened = ctx.waitForEvent("page");
  await sw.evaluate((v) => handleMessage({ type: TG.MSG.OPEN_WORKSPACE, id: v }, {}), id);
  const tab = await opened;
  await tab.waitForLoadState();
  check(tab.url() === BASE + "/app/detections/" + id, "extension: Open in workspace lands on the detection page", tab.url());
  check(siteErrors.length === 0, "website: no page errors", siteErrors);

  await ctx.close();
  server.kill();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
