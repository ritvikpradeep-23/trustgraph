// WhatsApp scan scope, end to end, with the real extension loaded in
// Chromium: test/fixtures/whatsapp-page.html is served at
// https://web.whatsapp.com/ so the content scripts inject as on the live site.
// Checks (a) chat messages are scanned, (b) the chat list, search, header,
// notices, menus, composer and your own / short / emoji / link-only
// messages never are, (c) switching chats leaves no stale marks.
//
//   npm i -D playwright   (or set NODE_PATH to a folder that has it)
//   node trustgraph_extension/test/whatsapp-scope-e2e.js
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXT = path.resolve(__dirname, "..");
async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-profile-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1280, height: 860 },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
  return { ctx, sw };
}
const html = fs.readFileSync(EXT + "/test/fixtures/whatsapp-page.html", "utf8");
let fails = 0;
const check = (ok, label, extra) => { if (!ok) fails++; console.log(ok ? "  ok  " : "  FAIL", label, extra !== undefined ? JSON.stringify(extra) : ""); };

(async () => {
  const { ctx, sw } = await launch();
  await sw.evaluate(() => chrome.storage.local.set({ settings: { engine: "local" } }));
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1200, height: 760 });
  const logs = [];
  p.on("console", (m) => { if (m.text().includes("scan:")) logs.push(m.text()); });
  p.on("pageerror", (e) => { fails++; console.log("pageerror", e.message); });
  await p.route("**/*", (r) => (r.request().url().startsWith("https://web.whatsapp.com/") ? r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><meta charset=utf-8>" + html }) : r.fulfill({ status: 404, body: "" })));
  await p.goto("https://web.whatsapp.com/");
  await p.evaluate(() => localStorage.setItem("trustgraph-debug-scan", "1"));
  await p.waitForTimeout(1200);

  const shieldShown = () => p.evaluate(() => { const h = document.querySelector("trustgraph-shield"); return !!h && h.style.display !== "none"; });
  async function hover(sel, text) {
    await p.mouse.move(5, 5); await p.waitForTimeout(150);
    const loc = text ? p.locator(sel, { hasText: text }).first() : p.locator(sel).first();
    await loc.hover({ force: true }); await p.waitForTimeout(250);
    return shieldShown();
  }

  console.log("(a) chat messages get a shield");
  check(await hover('[data-id="3EB0B55E"] span.selectable-text'), "incoming scam message");
  check(await hover('[data-id="3EB0B11A"] span.selectable-text'), "incoming normal message");

  console.log("(b) never: chat list, search, header, notices, menu, composer, own/short/emoji/link");
  const never = [
    ["#pane-side .xprev", "SBI KYC"], ["#pane-side .xprev", "gift cards"], ["#side [role=textbox]"], ["#side header"],
    ["#main header span", "online"], ['[role=application] .xpill', "end-to-end"], ['[role=application] .xpill', "YESTERDAY"],
    ['[role=application] .xpill', "UNREAD"], [".xmenu li", "Report"], ["footer [role=textbox]"],
    ['[data-id="AC76B22E"] span.selectable-text'], ['[data-id="AC76B33F"] span.selectable-text'],
    ['[data-id="3EB0B22B"] span.selectable-text'], ['[data-id="3EB0B33C"] span.selectable-text'], ['[data-id="3EB0B44D"] span.selectable-text'],
  ];
  for (const [sel, text] of never) check(!(await hover(sel, text)), "no shield: " + sel + (text ? " / " + text : ""));

  console.log("chat scan");
  await p.mouse.move(5, 5);
  logs.length = 0;
  await p.mouse.click(1200 - 16 - 22, Math.round(760 * 0.45) + 22);
  await p.waitForTimeout(1500);
  const marks = () => p.evaluate(() => Array.from(document.querySelectorAll("[data-trustgraph-scored],[data-trustgraph-skipped],[data-trustgraph-flagged]")).map((el) => ({ id: el.getAttribute("data-id"), inList: !!el.closest("#main [role=application]"), scored: el.getAttribute("data-trustgraph-scored"), flagged: el.hasAttribute("data-trustgraph-flagged"), skipped: el.getAttribute("data-trustgraph-skipped") })));
  let m = await marks();
  console.log("  marks:", JSON.stringify(m));
  const by = Object.fromEntries(m.map((x) => [x.id, x]));
  check(m.every((x) => x.inList && x.id), "every marked element is a message in the open chat's list");
  check(by["3EB0B55E"] && by["3EB0B55E"].flagged, "scam message scored and flagged", by["3EB0B55E"]);
  check(by["3EB0B11A"] && by["3EB0B11A"].scored !== null && !by["3EB0B11A"].flagged, "normal message scored, not flagged", by["3EB0B11A"]);
  for (const id of ["AC76B22E", "AC76B33F"]) check(by[id] && /own message/.test(by[id].skipped), id + " skipped as own message", by[id]);
  check(by["3EB0B22B"] && /too short/.test(by["3EB0B22B"].skipped), "short message skipped", by["3EB0B22B"]);
  check(by["3EB0B33C"] && /emoji/.test(by["3EB0B33C"].skipped), "emoji-only skipped", by["3EB0B33C"]);
  check(by["3EB0B44D"] && /links/.test(by["3EB0B44D"].skipped), "link-only skipped", by["3EB0B44D"]);
  const scoredLogs = () => logs.filter((l) => l.includes("scan: scored"));
  check(scoredLogs().length === 2, "2 messages scored", logs);
  const panel = await p.evaluate(() => !!document.querySelector("trustgraph-panel"));
  console.log("  panel present:", panel);

  console.log("mutations without new messages don't re-score; a new message is scored once");
  await p.evaluate(() => { for (let i = 0; i < 30; i++) { const s = document.createElement("span"); s.className = "xmeta"; document.querySelector('[data-id="3EB0B11A"] .x9f619').appendChild(s); s.remove(); } document.querySelector('[data-id="3EB0B11A"] .xmeta').textContent = "7:37 am"; });
  await p.waitForTimeout(1200);
  check(scoredLogs().length === 2, "no re-score after 30 unrelated mutations", scoredLogs().length);
  await p.evaluate(() => {
    const row = document.createElement("div"); row.setAttribute("role", "row");
    row.innerHTML = '<div data-id="3EB0B66F" class="xnz67gz"><div class="x9f619"><div class="copyable-text" data-pre-plain-text="[8:20 am, 5/10/2026] Arjun K: "><span dir="ltr" class="selectable-text copyable-text"><span>Click this link to claim your KYC refund before your account is blocked today: http://sbi-kyc.xyz</span></span></div></div></div>';
    document.querySelector("#main [role=application]").appendChild(row);
  });
  await p.waitForTimeout(1500);
  check(scoredLogs().length === 3 && scoredLogs()[2].includes("KYC"), "new message scored once", scoredLogs().length);

  console.log("(c) chat switch");
  await p.evaluate(() => {
    const old = document.querySelector("#main");
    const fresh = old.cloneNode(true);
    fresh.querySelector("header span[title]").setAttribute("title", "Meera");
    fresh.querySelector("header span[title]").textContent = "Meera";
    const list = fresh.querySelector("[role=application]");
    list.innerHTML = '<div role="row"><div data-id="3EB0C77A" class="xnz67gz"><div class="x9f619"><div class="copyable-text" data-pre-plain-text="[9:00 am, 5/10/2026] Meera: "><span dir="ltr" class="selectable-text copyable-text"><span>Lunch at the canteen at one? I will bring the notes for the exam.</span></span></div></div></div></div>';
    for (const el of fresh.querySelectorAll("[data-trustgraph-scored],[data-trustgraph-skipped],[data-trustgraph-flagged]")) el.remove();
    old.replaceWith(fresh);
  });
  await p.waitForTimeout(2200);
  m = await marks();
  console.log("  marks:", JSON.stringify(m));
  check(m.length === 1 && m[0].id === "3EB0C77A" && m[0].scored !== null && !m[0].flagged, "only the new chat's message is marked; nothing stale", m);
  check(logs.some((l) => l.includes("chat switched")), "chat switch logged");
  const last = scoredLogs().slice(-1)[0] || "";
  check(last.includes("Lunch"), "new chat rescanned", last);
  const panelText = await p.evaluate(() => document.querySelector("trustgraph-panel") ? "present" : "none");
  console.log("  panel:", panelText);

  console.log("\nscan log sample:\n " + logs.slice(0, 12).join("\n "));
  await ctx.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
