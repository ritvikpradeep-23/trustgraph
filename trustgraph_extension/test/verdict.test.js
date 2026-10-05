// Engine interface tests (shared/verdict.js).
//   node trustgraph_extension/test/verdict.test.js
"use strict";
require("../shared/rules/normalize.js");
const Rules = require("../shared/rules/rules.js");
require("../shared/rules/engine.js");
const V = require("../shared/verdict.js");

let failed = 0;
const check = (ok, name) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name);
  if (!ok) failed++;
};

(async () => {
  // Every rule maps to one of the eight signal types.
  const ids = [...Rules.RULES.map((r) => r.id), ...Object.keys(Rules.LINK_RULES)];
  const unmapped = ids.filter((id) => !(V.RULE_SIGNAL[id] in V.SIGNAL_TYPES));
  check(unmapped.length === 0, `every rule id maps to a signal type (unmapped: ${unmapped.join(", ") || "none"})`);
  check(Object.keys(V.SIGNAL_TYPES).length === 8, "eight signal types");

  // Local engine: shape and thresholds.
  const high = await V.LocalEngine.scoreMessage({ text: "Hi Mum, new number. Buy 2 Google Play gift cards and send the codes, urgent, don't tell Dad", channel: "whatsapp" });
  check(high.riskLevel === "high" && high.score >= 70 && high.score <= 100, `scam -> high (${high.score})`);
  check(typeof high.id === "string" && high.explanation.length > 20 && Array.isArray(high.signals) && high.signals.length >= 2, "verdict has id, explanation, signals");
  check(high.signals.every((s) => s.id in V.SIGNAL_TYPES && ["low", "medium", "high"].includes(s.severity) && s.icon && s.name), "signals are typed with icon, name and severity");
  const low = await V.LocalEngine.scoreMessage({ text: "See you at 6 for dinner?", channel: "whatsapp" });
  check(low.riskLevel === "low" && low.score < 35 && low.signals.length === 0, "ordinary message -> low, no signals");
  check((await V.LocalEngine.scoreMessage({ text: "   " })).empty === true, "empty text -> {empty}");
  check(V.levelFor(34) === "low" && V.levelFor(35) === "caution" && V.levelFor(69) === "caution" && V.levelFor(70) === "high", "balanced thresholds 35 / 70");
  check(V.levelFor(30, "strict") === "caution" && V.levelFor(40, "relaxed") === "low", "sensitivity moves the thresholds");
  const strictV = await V.LocalEngine.scoreMessage({ text: "Install AnyDesk so I can help" }, { sensitivity: "strict" });
  check(strictV.riskLevel !== "low" ? strictV.signals.length > 0 : true, "a strict caution still names its signals");

  // Remote engine: both answer shapes, errors and offline.
  const fake = (answer) => async () => answer;
  const text = { text: "hello, are we still on for lunch", channel: "gmail" };
  const a = await V.RemoteEngine("http://x/api/score", fake({ ok: true, status: 200, data: { riskLevel: "high", score: 91, explanation: "Matches a known scam", signals: [{ name: "similarity", score: 0.9 }] } })).scoreMessage(text);
  check(a.riskLevel === "high" && a.score === 91 && a.source === "server" && a.engine === "remote", "new shape {riskLevel, score 0-100} accepted");
  check(a.similarity.score === 90, "server similarity feeds the similarity indicator");
  const b = await V.RemoteEngine("u", fake({ ok: true, status: 200, data: { band: "Caution", score: 0.5, explanation: "x", signals: [] } })).scoreMessage(text);
  check(b.riskLevel === "caution" && b.score === 50, "old shape {band, score 0..1} accepted");
  const c = await V.RemoteEngine("u", fake({ ok: false, status: 500, data: null })).scoreMessage(text);
  check(c.source === "basic" && c.serverError === "HTTP 500", "HTTP error falls back to local, labelled");
  const d = await V.RemoteEngine("u", async () => { throw new Error("down"); }).scoreMessage(text);
  check(d.offline === true && d.riskLevel === "low", "unreachable server falls back to local (offline)");
  const e = await V.RemoteEngine("u", fake({ ok: true, status: 200, data: { band: "Low", score: 0.1, explanation: "ok", signals: [] } })).scoreMessage({ text: "Share the OTP now, urgent, account blocked", channel: "x" });
  check(e.riskLevel !== "low", "local rules still win when they are higher than the server");
  check(V.normalizeRemote({ riskLevel: "weird", score: 3 }) === null && V.normalizeRemote({ nope: 1 }) === null, "unknown answers are rejected");

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
