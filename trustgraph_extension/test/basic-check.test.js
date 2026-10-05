// Tests for the offline Basic check. No dependencies:
//   node trustgraph_extension/test/basic-check.test.js
// Exits with code 1 if any case fails.
"use strict";

const assert = require("assert");
const { basicCheck } = require("../shared/basic-check.js");

// [message, expected band, categories that must be flagged (optional)]
const CASES = [
  // Clean messages
  ["Hey, are we still on for dinner at 7?", "Low"],
  ["Thanks for the birthday gift card, I loved it!", "Low"],
  ["Your OTP is 482913. Do not share it with anyone.", "Low"],
  ["I read an article about crypto today, wild stuff.", "Low"],
  ["Meeting moved to Thursday, see the updated invite.", "Low"],

  // Negation: the spec's key case and variations
  ["We will never ask for your password.", "Low"],
  ["Never share this code with anyone, including our staff.", "Low"],
  ["Note: we don't ask you to pay a processing fee.", "Low"],
  ["We will never ask for your password. Reply with your password to verify.", "Caution", ["one_time_code"]],
  ["We won’t ever ask for your OTP.", "Low"], // curly apostrophe

  // One red flag -> Caution
  ["Please send me the code you just received.", "Caution", ["one_time_code"]],
  ["Can you buy some Google Play cards for me?", "Caution", ["gift_card"]],
  ["Download AnyDesk so our technician can help.", "Caution", ["remote_access"]],
  ["Deposit 0.1 BTC to start earning.", "Caution", ["crypto"]],
  ["This investment has guaranteed returns of 30% a month.", "Caution", ["crypto"]],
  ["Keep this between us please.", "Caution", ["secrecy"]],
  ["Love you. Please don't tell Dad about the surprise party.", "Caution", ["secrecy"]], // known false positive: the Basic check can't read intent
  ["Your account will be suspended for unusual activity.", "Caution", ["threat"]],
  ["You won! Pay the delivery fee of $2.99 to claim your prize.", "Caution", ["upfront_fee"]],

  // Several flags, or a severe flag plus urgency -> High
  ["Buy a gift card and send me the code", "High", ["gift_card", "one_time_code"]],
  ["URGENT: share the verification code within 10 minutes or lose access.", "High", ["one_time_code"]],
  [
    "This is the police. There is an arrest warrant in your name. Pay the fine in Bitcoin and don't tell anyone.",
    "High",
    ["threat", "crypto", "secrecy"],
  ],
  ["Can you buy two Google Play gift cards? It's urgent, please don't tell Dad.", "High", ["gift_card", "secrecy"]],
  ["Install TeamViewer immediately, your bank account has been frozen.", "High", ["remote_access", "threat"]],
];

let failed = 0;
for (const [message, band, categories = []] of CASES) {
  const result = basicCheck(message);
  const got = result.flags.map((f) => f.category);
  try {
    assert.strictEqual(result.band, band, `band: expected ${band}, got ${result.band}`);
    for (const c of categories) assert.ok(got.includes(c), `missing category ${c} (got ${got.join(", ") || "none"})`);
    assert.strictEqual(result.source, "basic");
    assert.strictEqual(result.signals.length, 4);
    assert.ok(result.signals.every((s) => s.explanation.startsWith("stub:")));
    assert.ok(typeof result.explanation === "string" && result.explanation.length > 0);
    assert.ok(result.score >= 0 && result.score <= 1);
    console.log("PASS", JSON.stringify(message));
  } catch (err) {
    failed++;
    console.log("FAIL", JSON.stringify(message), "->", err.message);
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
