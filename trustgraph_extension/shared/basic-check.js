// Offline "Basic check": a small, rule-based red-flag detector that runs on
// the user's device when the TrustGraph server can't be reached.
//
// TODO: sync with src/trustgraph/similarity/detector.py. That file was not in
// the repo when this was written, so these rules were written from the
// category list in the spec (gift cards, one-time codes, remote access,
// crypto, secrecy, threats, upfront fees) rather than ported line by line.
//
// It is far weaker than the full engine and is always labeled as a Basic
// check in the UI.
//
// Loaded in the service worker (importScripts) and in Node for tests
// (`node trustgraph_extension/test/basic-check.test.js`), hence the export at the end.
(function (root) {
  "use strict";

  // Each rule: a category id, a human label for the "Why?" list, and one or
  // more regexes. Patterns aim at *requests* ("send me the code") rather
  // than mentions, so normal messages like "your OTP is 123456" don't flag.
  const RULES = [
    {
      id: "gift_card",
      label: "Asks you to pay with gift cards",
      patterns: [
        /\b(buy|purchase|get|grab|pick up|send|pay (with|in|using))\b[^.!?\n]{0,40}\bgift ?cards?\b/i,
        /\bgift ?card (codes?|numbers?|pins?)\b/i,
        /\b(itunes|google play|steam|apple|razer gold|ebay) (gift )?cards?\b/i,
        /\bscratch (off )?the back\b/i,
      ],
    },
    {
      id: "one_time_code",
      label: "Asks for a one-time code or password",
      patterns: [
        /\b(send|share|give|tell|forward|read|provide|confirm|text|reply with)\b( me| us| it)?( back)?( the| your| that| this)?( \d[- ]digit)? (otp|one[- ]time (pass)?code|verification code|security code|login code|code|password|passcode|pin)\b/i,
        /\b(ask|asking|request|requesting)\b( you)?( for)?( your)? (otp|one[- ]time (pass)?code|verification code|security code|password|passcode|pin)\b/i,
        /\b(the )?(code|otp) (we|i) (just )?(sent|texted)\b/i,
      ],
    },
    {
      id: "remote_access",
      label: "Asks you to install remote-access software",
      patterns: [
        /\b(any ?desk|team ?viewer|rust ?desk|ultra ?viewer|quick ?support|airdroid|splashtop|logmein)\b/i,
        /\bremote (access|desktop|control|support app)\b/i,
        /\b(install|download)\b[^.!?\n]{0,30}\b(app|application|software)\b[^.!?\n]{0,30}\b(access|control|fix|secure)\b/i,
      ],
    },
    {
      id: "crypto",
      label: "Asks for crypto payments or promises guaranteed returns",
      patterns: [
        // (?:[^.!?\n]|\.\d) = stay in the sentence, but allow "0.1 BTC"
        /\b(send|pay|deposit|transfer|invest|buy)\b(?:[^.!?\n]|\.\d){0,40}\b(bitcoin|btc|usdt|tether|ethereum|eth|crypto ?currency|crypto|binance)\b/i,
        /\b(bitcoin|btc|usdt|crypto) (wallet|address|atm)\b/i,
        /\bwallet address\b/i,
        /\bguaranteed (returns?|profits?|income)\b/i,
        /\b(double|triple) your (money|investment)\b/i,
      ],
    },
    {
      id: "secrecy",
      label: "Asks you to keep it secret",
      patterns: [
        /\b(don'?t|do not|never) (tell|inform|mention (this|it) to)\b[^.!?\n]{0,20}\b(anyone|anybody|your (bank|family|parents|wife|husband)|(mum|mom|dad|mother|father|my (wife|husband|parents)))\b/i,
        /\bkeep (this|it) (a )?(secret|between us|confidential|to yourself)\b/i,
        /\bbetween (you and me|us only)\b/i,
      ],
    },
    {
      id: "threat",
      label: "Threatens arrest, fines, or account closure",
      patterns: [
        /\b(arrest(ed)?|arrest warrant|warrant|deport(ed|ation)?|legal action|lawsuit|prosecut(e|ed|ion))\b/i,
        /\b(account|card|number|sim|service)\b[^.!?\n]{0,25}\b(will be|has been|is being|gets?)\b[^.!?\n]{0,10}\b(suspended|blocked|closed|terminated|deactivated|frozen|disconnected)\b/i,
        /\b(pay|fine|penalty)\b[^.!?\n]{0,20}\bor (else|face|you will)\b/i,
      ],
    },
    {
      id: "upfront_fee",
      label: "Asks for a fee before you get money, a prize, or a parcel",
      patterns: [
        /\b(processing|registration|clearance|release|delivery|customs|activation|transfer|handling|unlock(ing)?) (fee|charge|payment)\b/i,
        /\bpay (a|the) (small |one[- ]time |refundable )?fee\b/i,
        /\badvance (payment|fee)\b/i,
        /\bto (claim|receive|release|unlock) (your )?(prize|winnings|reward|package|parcel|funds|refund|loan)\b/i,
      ],
    },
  ];

  // Urgency on its own isn't a red flag, but it makes the others worse.
  const URGENCY_PATTERNS = [
    /\b(urgent(ly)?|immediately|right now|act now|asap|last chance|final (notice|warning)|today only)\b/i,
    /\bwithin (\d+|one|two|24|48) (minutes?|hours?|hrs?)\b/i,
    /\b(expires?|expiring) (today|tonight|soon|in)\b/i,
  ];

  // Words that cancel a match when they appear shortly before it in the same
  // sentence: "We will NEVER ask for your password" must not flag.
  const NEGATION = /\b(never|not|no|don'?t|do not|won'?t|will not|cannot|can'?t|shouldn'?t|nobody|no one|nor)\b/i;
  const NEGATION_WINDOW_WORDS = 6;

  // Categories that count as high-risk when paired with urgency.
  const SEVERE_WITH_URGENCY = ["one_time_code", "remote_access", "gift_card", "threat"];

  // Normalise curly apostrophes so "don’t" matches "don't".
  function normalise(text) {
    return String(text || "").replace(/[‘’′]/g, "'");
  }

  // True when the few words before `index` (in the same sentence) negate it.
  function isNegated(text, index) {
    const before = text.slice(0, index);
    // Sentence start = after the last . ! ? or newline before the match.
    const sentenceStart = Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("!"),
      before.lastIndexOf("?"),
      before.lastIndexOf("\n")
    );
    const words = before.slice(sentenceStart + 1).trim().split(/\s+/);
    const recent = words.slice(-NEGATION_WINDOW_WORDS).join(" ");
    return NEGATION.test(recent);
  }

  // Returns the first non-negated match of any pattern, or null.
  function findMatch(text, patterns) {
    for (const pattern of patterns) {
      // A global copy lets us walk every match, not just the first.
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!isNegated(text, m.index)) return m[0];
        if (m[0].length === 0) re.lastIndex++; // safety: avoid infinite loops
      }
    }
    return null;
  }

  function basicCheck(rawText) {
    const text = normalise(rawText);

    const flags = [];
    for (const rule of RULES) {
      const match = findMatch(text, rule.patterns);
      if (match) flags.push({ category: rule.id, label: rule.label, match: match });
    }
    const urgent = findMatch(text, URGENCY_PATTERNS) !== null;

    let band = "Low";
    if (flags.length >= 2) band = "High";
    else if (flags.length === 1) {
      band = urgent && SEVERE_WITH_URGENCY.includes(flags[0].category) ? "High" : "Caution";
    }

    // A rough 0..1 score so the UI can draw a bar. Not comparable to the
    // server's score.
    const score = Math.min(1, flags.length * 0.35 + (urgent ? 0.15 : 0) + (band === "High" ? 0.15 : 0));

    let explanation;
    if (band === "Low") {
      explanation = urgent
        ? "No common scam red flags found, though the message is pushy about timing."
        : "No common scam red flags found by the basic check.";
    } else if (flags.length === 1) {
      explanation = "Red flag: " + flags[0].label.toLowerCase() + (urgent ? ", with pressure to act fast." : ".");
    } else {
      explanation =
        "Several red flags: " + flags.map((f) => f.label.toLowerCase()).join("; ") + (urgent ? "; with pressure to act fast." : ".");
    }

    if (urgent && band !== "Low") {
      flags.push({ category: "urgency", label: "Pressures you to act fast", match: findMatch(text, URGENCY_PATTERNS) });
    }

    return {
      band: band,
      score: Math.round(score * 100) / 100,
      explanation: explanation,
      // Same shape as the server, but the engine's four signals need the
      // server, so they are marked inactive.
      signals: ["continuity", "similarity", "precedent", "anomaly"].map((name) => ({
        name: name,
        score: null,
        explanation: "stub: needs the TrustGraph server",
      })),
      flags: flags,
      source: "basic",
    };
  }

  root.TrustGraphBasicCheck = { basicCheck: basicCheck, RULES: RULES };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TrustGraphBasicCheck;
})(globalThis);
