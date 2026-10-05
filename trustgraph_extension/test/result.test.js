// Privacy test for the stored/synced Result record (shared/result.js).
//   node trustgraph_extension/test/result.test.js
// It FAILS if anyone adds a field to the Result whitelist, or if any
// message text, evidence, explanation or sender can reach a stored record.
"use strict";
const R = require("../shared/result.js");
require("../shared/rules/normalize.js");
require("../shared/rules/rules.js");
require("../shared/rules/engine.js");
const V = require("../shared/verdict.js");

let failed = 0;
const check = (ok, name) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name);
  if (!ok) failed++;
};

// 1. The whitelist is exactly this. Adding a field means changing this test
//    on purpose, in review, with a reason.
const EXPECTED = ["id", "timestamp", "riskLevel", "score", "signalIds", "channel", "domain", "hash"];
check(JSON.stringify(R.RESULT_FIELDS) === JSON.stringify(EXPECTED), `Result fields are exactly ${EXPECTED.join(", ")}`);
check(Object.isFrozen(R.RESULT_FIELDS), "the field list is frozen");

// 2. No text-like field name, even if the list above were changed with it.
const TEXTY = /text|message|body|snippet|content|explanation|evidence|sender|subject|quote|preview|note|comment|title|reason|url|link/i;
check(R.RESULT_FIELDS.every((f) => !TEXTY.test(f)), "no field name looks like it holds text");

// 3. A real verdict with evidence becomes a record with no trace of the text.
(async () => {
  const message = "URGENT Dear customer your KYC is pending, account blocked today. Share OTP 482913 at http://sbi-kyc-update.xyz/login now";
  const verdict = await V.LocalEngine.scoreMessage({ text: message, channel: "whatsapp", sender: "+91 98765 43210" });
  check(verdict.riskLevel === "high" && verdict.signals.some((s) => s.evidence), "fixture verdict is High and carries evidence in memory");
  const hash = await R.saltedHash(message, "device-salt-123");
  const record = R.fromVerdict(verdict, { channel: "whatsapp", url: "https://web.whatsapp.com/some/path?q=secret", hash });
  check(JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...EXPECTED].sort()), "record has only whitelisted keys");
  check(record.domain === "web.whatsapp.com", "domain keeps the hostname only (no path or query)");
  const json = JSON.stringify(record);
  const words = message.toLowerCase().match(/[a-z0-9]{4,}/g).filter((w) => !["https", "http"].includes(w));
  const leaked = words.filter((w) => json.toLowerCase().includes(w));
  check(leaked.length === 0, `no word of the message appears in the record (leaked: ${leaked.join(", ") || "none"})`);
  check(!json.includes("98765") && !json.includes(verdict.explanation.slice(0, 20)), "no sender, no explanation");
  check(record.signalIds.every((s) => s in V.SIGNAL_TYPES), "signalIds are signal TYPE ids");
  check(/^[a-f0-9]{64}$/.test(record.hash) && record.hash !== (await R.saltedHash(message, "other-salt")), "hash is salted SHA-256");

  // 4. validate() rejects anything outside the whitelist or out of shape.
  check(R.validate({ ...record, text: message }).includes("field not allowed: text"), "a `text` field is rejected");
  check(!R.isValid({ ...record, evidence: "x" }), "an `evidence` field is rejected");
  check(!R.isValid({ ...record, signalIds: ["Share OTP 482913 now"] }), "free text hidden in signalIds is rejected");
  check(!R.isValid({ ...record, channel: "Dear customer" }), "free text hidden in channel is rejected");
  check(!R.isValid({ ...record, domain: "x.com/path?msg=hi" }), "a path in domain is rejected");
  check(!R.isValid({ ...record, score: 0.7 }) && !R.isValid({ ...record, riskLevel: "High" }), "score must be 0-100 integer, riskLevel lowercase");
  check(R.sanitizeList([record, { ...record, text: "x" }, null]).length === 1, "sanitizeList drops invalid records");
  let threw = false;
  try {
    R.fromVerdict({ id: "bad id with spaces", riskLevel: "low", score: 3, signals: [] }, {});
  } catch (_) {
    threw = true;
  }
  check(threw, "fromVerdict refuses to build an invalid record");

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
