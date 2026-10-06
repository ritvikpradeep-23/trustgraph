// Runs background.js in node against an in-memory fake of the chrome.* APIs
// and checks the message flows: score -> verdict + Result in history (no
// text), delete, export, overview counts, demo data, mock sign-in and
// "Mark as wrong verdict".
//   node trustgraph_extension/test/background.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, name) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name);
  if (!ok) failed++;
};

// ---- fake chrome ------------------------------------------------------------
const store = {};
const listeners = { message: [] };
const tabsCreated = [];
const noop = () => {};
const evt = () => ({ addListener: noop });
const chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = keys === undefined || keys === null ? Object.keys(store) : [].concat(keys);
        const out = {};
        for (const k of list) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store[k] = JSON.parse(JSON.stringify(v));
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete store[k];
      },
      async clear() {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
    onChanged: evt(),
  },
  runtime: {
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onInstalled: evt(),
    getURL: (p) => "chrome-extension://test/" + p,
    getManifest: () => JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")),
  },
  tabs: { create: async (o) => tabsCreated.push(o.url), query: async () => [], sendMessage: async () => {} },
  contextMenus: { removeAll: (cb) => cb && cb(), create: noop, onClicked: evt() },
  permissions: { onAdded: evt(), onRemoved: evt(), contains: async () => false },
  scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => [] },
};

const ctx = {
  chrome,
  console,
  crypto: globalThis.crypto,
  TextEncoder,
  URL,
  AbortSignal,
  setTimeout,
  // No scoring server: every fetch fails like a closed port.
  fetch: async () => {
    throw new TypeError("connect ECONNREFUSED");
  },
};
ctx.self = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
ctx.importScripts = (...files) => {
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(EXT, f), "utf8"), ctx, { filename: f });
};
vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), ctx, { filename: "background.js" });

function send(msg, sender = { tab: { url: "https://web.whatsapp.com/chat?x=secret" } }) {
  return new Promise((resolve) => {
    const keep = listeners.message[0](msg, sender, resolve);
    if (keep !== true) resolve(undefined);
  });
}

(async () => {
  const TG = ctx.TG;
  const SCAM = "Hi Mum this is my new number, buy 2 Google Play gift cards and send me the codes urgently, don't tell Dad";

  // Score one message (remote engine, server down -> local fallback).
  const r1 = await send({ type: TG.MSG.SCORE, text: SCAM, channel: "whatsapp", sender: "+44 7700 900123" });
  check(r1.verdict && r1.verdict.riskLevel === "high" && r1.verdict.offline, "score: high verdict from local rules while the server is down");
  check(r1.saved === true && r1.record && r1.record.domain === "web.whatsapp.com", "score: Result saved with the hostname only");
  const raw = JSON.stringify(store);
  // Word boundaries avoid mistaking a random hex ID/hash containing "dad" for text.
  check(!/\b(gift|google play|mum|dad|codes)\b/i.test(raw) && !raw.includes("+44 7700 900123"), "nothing from the message text is anywhere in storage");

  // Same text again: dedupe by salted hash keeps one entry.
  await send({ type: TG.MSG.SCORE, text: SCAM, channel: "whatsapp" });
  let h = await send({ type: TG.MSG.GET_HISTORY });
  check(h.results.length === 1, "checking the same text twice keeps one history entry");

  // Local engine + a low message.
  await send({ type: TG.MSG.SET_SETTINGS, patch: { engine: "local" } });
  const r2 = await send({ type: TG.MSG.SCORE, text: "Lunch at 1?", channel: "gmail" }, { tab: { url: "https://mail.google.com/mail/u/0/#inbox/abc" } });
  check(r2.verdict.riskLevel === "low" && r2.verdict.engine === "local" && !r2.verdict.offline, "local engine: low verdict, not marked offline");

  // Save-to-history switch off removes it and turns saving off for next time.
  await send({ type: TG.MSG.SET_SAVED, record: r2.record, saved: false });
  h = await send({ type: TG.MSG.GET_HISTORY });
  const s = await send({ type: TG.MSG.GET_SETTINGS });
  check(h.results.length === 1 && s.save_history === false, "switching Save to history off removes the result and remembers the choice");
  const r3 = await send({ type: TG.MSG.SCORE, text: "Share the OTP now, account blocked", channel: "gmail" });
  check(r3.saved === false && (await send({ type: TG.MSG.GET_HISTORY })).results.length === 1, "with saving off, new verdicts aren't kept");
  await send({ type: TG.MSG.SET_SETTINGS, patch: { save_history: true } });

  // Chat-scan verdict recorded from the page (no text).
  const rec = await send({ type: TG.MSG.RECORD_RESULT, verdict: { id: "chat-verdict-123456", riskLevel: "caution", score: 48, signals: [{ id: "urgency" }, { id: "suspicious_link" }] }, channel: "whatsapp" });
  check(rec.saved && rec.record.signalIds.join() === "urgency,suspicious_link", "chat verdict recorded as a Result");

  // Overview counts.
  const ov = await send({ type: TG.MSG.GET_OVERVIEW });
  check(ov.today.high === 2 && ov.today.caution === 2 && ov.today.low === 1, `overview today: ${JSON.stringify(ov.today)}`);
  check(ov.days.length === 7 && ov.channels[0].channel === "whatsapp", "overview: 7 days and channels sorted by volume");

  // Export.
  const csv = await send({ type: TG.MSG.EXPORT, format: "csv" });
  check(csv.data.split("\n")[0] === "id,timestamp,riskLevel,score,signalIds,channel,domain" && csv.data.trim().split("\n").length === 3, "CSV export: header + 2 rows");
  const json = JSON.parse((await send({ type: TG.MSG.EXPORT, format: "json" })).data);
  check(json.results.length === 2 && Object.keys(json.results[0]).every((k) => ctx.TrustGraphResult.RESULT_FIELDS.includes(k)), "JSON export holds Result records only");

  // Demo data on/off.
  await send({ type: TG.MSG.SET_SETTINGS, patch: { demo_data: true } });
  h = await send({ type: TG.MSG.GET_HISTORY });
  const demoCount = h.results.filter((r) => r.id.startsWith("demo-")).length;
  check(demoCount === 42 && h.results.every(ctx.TrustGraphResult.isValid), "demo data seeds 42 valid Results");
  check((await send({ type: TG.MSG.GET_OVERVIEW })).demo === true, "overview knows demo data is on");
  await send({ type: TG.MSG.SET_SETTINGS, patch: { demo_data: false } });
  h = await send({ type: TG.MSG.GET_HISTORY });
  check(h.results.length === 2, "demo data off removes exactly the demo results");

  // Delete one.
  await send({ type: TG.MSG.DELETE_RESULT, id: rec.record.id });
  check((await send({ type: TG.MSG.GET_HISTORY })).results.length === 1, "delete one result");

  // Account: signed out -> mock pairing.
  check((await send({ type: TG.MSG.GET_ACCOUNT })).state === "signed_out", "starts signed out");
  check((await send({ type: TG.MSG.PAIR, code: "ABCD-1234" })).ok === false, "an unissued pairing code is refused");
  const code = await ctx.TrustGraphApi.mockIssueCode();
  check((await send({ type: TG.MSG.PAIR, code })).ok === true, "a code issued by the mock web app signs in");
  const acct = await send({ type: TG.MSG.GET_ACCOUNT });
  check(acct.state === "signed_in" && acct.mock && !("token" in acct), "account: signed in (mock), token never returned");
  check((await send({ type: TG.MSG.PAIR, code })).ok === false, "a pairing code works once");

  // Synced to the mock web app after sign-in.
  const r4 = await send({ type: TG.MSG.SCORE, text: "Your KYC is pending, account blocked, share OTP at http://sbi-kyc.xyz", channel: "gmail" });
  await new Promise((r) => setTimeout(r, 50));
  const mock = store[ctx.TrustGraphApi.MOCK_KEY];
  check(mock.results.some((x) => x.id === r4.record.id), "new results sync to the (mock) web app when signed in");
  check(!/kyc|otp|sbi/i.test(JSON.stringify(mock)), "the web app copy has no message text");

  // Mark as wrong: only the id.
  await send({ type: TG.MSG.MARK_WRONG, id: r4.verdict.id });
  check(store[ctx.TrustGraphApi.MOCK_KEY].feedback.includes(r4.verdict.id) && (await send({ type: TG.MSG.GET_HISTORY })).wrong.includes(r4.verdict.id), "Mark as wrong sends and stores only the verdict id");

  // Open in workspace -> mock web app page.
  await send({ type: TG.MSG.OPEN_WORKSPACE, id: r4.record.id });
  check(tabsCreated.pop() === "chrome-extension://test/ui/webapp.html#/app/detections/" + r4.record.id, "Open in workspace opens the (mock) web app result page");

  // Retention: old results pruned.
  store.history.push({ ...r4.record, id: "old-result-000001", hash: undefined, timestamp: Date.now() - 40 * 86400000 });
  delete store.history[store.history.length - 1].hash;
  await send({ type: TG.MSG.SET_SETTINGS, patch: { retention_days: 30 } });
  check(!(await send({ type: TG.MSG.GET_HISTORY })).results.some((r) => r.id === "old-result-000001"), "30-day retention prunes older results");

  // Delete all.
  await send({ type: TG.MSG.DELETE_ALL });
  check((await send({ type: TG.MSG.GET_HISTORY })).results.length === 0 && (await send({ type: TG.MSG.GET_OVERVIEW })).today.total === 0, "delete all clears history and counts");

  // Settings ignore unknown keys.
  const s2 = await send({ type: TG.MSG.SET_SETTINGS, patch: { bogus: 1, mode: "auto" } });
  check(!("bogus" in s2) && !("mode" in s2), "unknown and retired settings keys are ignored");

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
