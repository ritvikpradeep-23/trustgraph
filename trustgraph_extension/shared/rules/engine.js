// TrustGraph on-device scoring engine. Turns rule hits into an
// explainable score and verdict.
//
//   analyze(text, meta)    one message  -> result
//   analyzeChat(items)     a conversation (incoming messages, in order)
//                          -> {id: result}; also scores runs of messages
//                          from the same sender together
//   combine(local, server, status)  merge with a TrustGraph server answer
//
// result = {band, score, flags, weakSignals, contributions, explanation,
//           source: "basic", signals}
//   flag = {ruleId, title, reason, severity, weight, messageId,
//           evidence: {start, end, text}}  (evidence = exact original text)
//
// HOW THE SCORE WORKS (so every verdict can be explained):
//   1. Each rule that fires contributes its weight w (0..1). In a developer
//      conversation, "devSensitive" rules count a quarter.
//   2. Combinations add their own weight: link + urgency + money (0.35);
//      "new number" + money/codes (0.35); secrecy + payment/code (0.3);
//      threat + money demand (0.3); official warning + bad link (0.25).
//   3. score = 1 - product(1 - w)  (independent signals reinforce).
//   4. Sender context, only when a real scam sign fired:
//        unsaved phone number          raises: 1 - (1 - score) * 0.85
//        first message from them here  raises: 1 - (1 - score) * 0.95
//        saved contact, 5+ earlier msgs lowers: score * 0.8
//   5. Cap: with at most ONE real scam sign (one phrase of one rule) and no
//      combination, the score stays below High (max 0.69). One keyword can
//      never produce High; a rule matched by two different phrases counts
//      as two signs.
//   6. Bands: High >= 0.70, Caution >= 0.35, else Low.
(function (root) {
  "use strict";
  const N = root.TrustGraphNormalize || require("./normalize.js");
  const R = root.TrustGraphRules || require("./rules.js");

  const HIGH = 0.7;
  const CAUTION = 0.35;
  const SINGLE_CAP = 0.69;
  const RANK = { Low: 0, Caution: 1, High: 2 };
  const SIGNALS = ["continuity", "similarity", "precedent", "anomaly"];
  const AMOUNT = /(?:₹|\brs\.? ?|\binr ?|rupees? ?|രൂപ|रुपये)\s?\d|\d[\d,]* ?(?:rs|rupees|lakh|crore)\b/u;
  const MONEY_RULES = ["money_request", "upi_collect", "upfront_fee", "prize", "investment", "job_offer", "gift_card"];
  const COMBOS = {
    combo_link_urgency_money: {
      title: "A link, a deadline and a money request together",
      reason: "This mix is the most common scam pattern: it pushes you to pay through a link before you can check.",
      weight: 0.35,
    },
    combo_new_number_money: {
      title: "Someone 'new' asking for money or codes",
      reason: "A new number that immediately asks for money, codes or gift cards is the classic family-impersonation scam.",
      weight: 0.35,
    },
    combo_official_link: {
      title: "Official-sounding warning with a suspicious link",
      reason: "Real banks, police and utilities don't send warnings with links to unofficial sites.",
      weight: 0.25,
    },
    combo_secret_money: {
      title: "Asked to keep a payment, code or app secret",
      reason: "Being told to keep a payment, a code or an app install secret stops you checking with anyone: scammers rely on it.",
      weight: 0.3,
    },
    combo_threat_money: {
      title: "A threat plus a demand for money",
      reason: "Pairing a threat with a payment demand is extortion, whoever it claims to be from.",
      weight: 0.3,
    },
  };

  const severity = (w) => (w >= 0.5 ? "high" : w >= 0.3 ? "medium" : "low");
  const bandOf = (s) => (s >= HIGH ? "High" : s >= CAUTION ? "Caution" : "Low");
  const round = (x) => Math.round(x * 100) / 100;

  // ---- negation ----------------------------------------------------------
  function sentenceStart(norm, idx) {
    for (let i = idx - 1; i >= 0; i--) {
      const c = norm[i];
      if (c === "\n" || c === "!" || c === "?" || c === "।") return i + 1;
      if (c === "." && !(/\d/.test(norm[i - 1] || "") && /\d/.test(norm[i + 1] || ""))) return i + 1;
    }
    return 0;
  }
  function sentenceEnd(norm, idx) {
    const m = norm.slice(idx).search(/[\n!?।]|\.(?!\d)/);
    return m === -1 ? norm.length : idx + m;
  }
  function isNegated(norm, start, end) {
    const before = norm.slice(sentenceStart(norm, start), start).trim().split(/\s+/).slice(-6).join(" ");
    if (R.NEG_BEFORE.test(" " + before + " ")) return true;
    // Inside the match and the rest of the word + 3 words after it, for
    // languages that negate after the verb.
    const after = norm.slice(end, sentenceEnd(norm, end)).trim().split(/\s+/).slice(0, 4).join(" ");
    const tail = norm.slice(start, end) + norm.slice(end).match(/^\S*/)[0] + " " + after;
    return R.NEG_AFTER.test(tail);
  }

  // First valid hit of a rule (its evidence) and how many of the rule's
  // different phrases matched.
  function firstHit(rule, n) {
    let evidence = null;
    let phrases = 0;
    for (const re of rule.patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(n.norm))) {
        if (!m[0]) {
          re.lastIndex++;
          continue;
        }
        const start = m.index;
        const end = start + m[0].length;
        if (rule.exclude && rule.exclude.test(n.norm.slice(end))) continue;
        if (rule.negatable !== false && isNegated(n.norm, start, end)) continue;
        if (!evidence) evidence = n.evidence(start, end);
        phrases++;
        break; // one hit per phrase is enough
      }
    }
    return evidence ? { evidence, phrases } : null;
  }

  // ---- links -------------------------------------------------------------
  function linkFindings(n, metaLinks, dev) {
    const found = new Map(); // ruleId -> finding (highest weight kept)
    let unknownLink = false;
    const seen = new Set();
    const consider = (raw, evidence) => {
      const key = raw.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const c = R.classifyUrl(raw);
      if (!c) return;
      if (!c.safe) unknownLink = true;
      for (const id of c.issues) {
        if (!found.has(id)) found.set(id, { id, evidence });
      }
    };
    R.URL_IN_TEXT.lastIndex = 0;
    let m;
    while ((m = R.URL_IN_TEXT.exec(n.base))) {
      const url = m[0].replace(/[.,!?)]+$/, "");
      consider(url, { start: m.index, end: m.index + url.length, text: url });
    }
    for (const href of metaLinks || []) consider(href, { start: -1, end: -1, text: href });
    const flags = [];
    for (const { id, evidence } of found.values()) {
      const def = R.LINK_RULES[id];
      flags.push({ id, title: def.title, reason: def.reason, kind: "rule", w: dev ? def.weight * 0.5 : def.weight, evidence });
    }
    return { flags, unknownLink };
  }

  // ---- one message -------------------------------------------------------
  const PHONE = /^\+?[\d\s\-().]{8,}$/;

  function analyze(text, meta = {}) {
    const n = N.normalize(text);
    const dev = R.DEV_CONTEXT.test(n.norm);
    const fired = [];

    for (const rule of R.RULES) {
      const hit = firstHit(rule, n);
      if (!hit) continue;
      const w = dev && rule.devSensitive ? rule.weight * 0.25 : rule.weight;
      fired.push({ id: rule.id, title: rule.title, reason: rule.reason, kind: rule.kind, w, evidence: hit.evidence, phrases: hit.phrases });
    }
    const links = linkFindings(n, meta.links, dev);
    fired.push(...links.flags);

    const has = (id) => fired.some((f) => f.id === id);
    const linkish = links.unknownLink || links.flags.length > 0;
    const money = MONEY_RULES.some(has) || AMOUNT.test(n.norm);
    const combos = [];
    if (linkish && has("urgency") && money) combos.push("combo_link_urgency_money");
    if ((has("new_number_family") || has("new_number")) && ["money_request", "gift_card", "otp_request", "upi_collect"].some(has)) combos.push("combo_new_number_money");
    if (["kyc_block", "authority_threat", "power_cut"].some(has) && links.flags.length) combos.push("combo_official_link");
    if (has("secrecy") && (MONEY_RULES.some(has) || has("otp_request") || has("remote_access"))) combos.push("combo_secret_money");
    if (["blackmail", "authority_threat", "legal_threat", "power_cut", "kyc_block"].some(has) && money) combos.push("combo_threat_money");
    // Evidence for a combination: the sign that defines it (the secrecy
    // phrase, the "new number" line, the link, the threat).
    const ANCHORS = {
      combo_link_urgency_money: ["link_lookalike", "link_punycode", "link_ip", "link_shortener", "link_risky_tld", "urgency"],
      combo_new_number_money: ["new_number_family", "new_number"],
      combo_official_link: ["link_lookalike", "link_punycode", "link_ip", "link_shortener", "link_risky_tld"],
      combo_secret_money: ["secrecy"],
      combo_threat_money: ["blackmail", "authority_threat", "legal_threat", "power_cut", "kyc_block"],
    };
    for (const id of combos) {
      const c = COMBOS[id];
      const anchor = ANCHORS[id].map((a) => fired.find((f) => f.id === a)).find(Boolean) || fired.slice().sort((a, b) => b.w - a.w)[0];
      fired.push({ id, title: c.title, reason: c.reason, kind: "combo", w: c.weight, evidence: anchor ? anchor.evidence : null });
    }

    let score = 1 - fired.reduce((p, f) => p * (1 - f.w), 1);
    const contributions = fired.map((f) => ({ label: f.title, weight: round(f.w) }));

    const real = fired.filter((f) => f.kind === "rule");
    const strong = real.some((f) => f.w >= 0.3);
    if (strong) {
      if (meta.sender && PHONE.test(String(meta.sender).trim())) {
        score = 1 - (1 - score) * 0.85;
        contributions.push({ label: "Sender is an unsaved number", effect: "raises" });
      }
      if (meta.inChat && meta.senderHistory === 0) {
        score = 1 - (1 - score) * 0.95;
        contributions.push({ label: "First message from this sender in the chat", effect: "raises" });
      }
      if (meta.sender && !PHONE.test(String(meta.sender).trim()) && meta.senderHistory >= 5) {
        score *= 0.8;
        contributions.push({ label: "Saved contact you've chatted with before", effect: "lowers" });
      }
    }
    const signs = real.reduce((sum, f) => sum + Math.min(2, f.phrases || 1), 0);
    const capped = signs <= 1 && !combos.length && score > SINGLE_CAP;
    if (capped) {
      score = SINGLE_CAP;
      contributions.push({ label: "Only one scam sign, so it can't reach High on its own", effect: "caps" });
    }
    score = round(Math.min(1, score));
    const band = bandOf(score);

    const ordered = fired.slice().sort((a, b) => b.w - a.w);
    // Red flags are the real signs, combinations and pressure tactics.
    // "Weak" context (a new number, a code request) only shows in "Why?".
    const flags =
      band === "Low"
        ? []
        : ordered.filter((f) => f.kind !== "weak").map((f) => ({
            ruleId: f.id,
            title: f.title,
            reason: f.reason,
            severity: f.kind === "modifier" ? "low" : severity(f.w),
            weight: round(f.w),
            messageId: meta.id || null,
            evidence: f.evidence,
          }));
    const weakSignals = band === "Low" ? ordered.map((f) => f.title) : ordered.filter((f) => f.kind === "weak").map((f) => f.title);

    let explanation;
    if (band === "High") explanation = "Several scam signs together: " + ordered.slice(0, 2).map((f) => f.title.toLowerCase()).join("; ") + ".";
    else if (band === "Caution") explanation = ordered[0].title + ".";
    else explanation = weakSignals.length ? `Nothing strong enough to flag (weak signs: ${weakSignals.join(", ").toLowerCase()}).` : "No scam signs found.";

    return {
      band,
      score,
      flags,
      weakSignals,
      contributions,
      explanation,
      source: "basic",
      signals: SIGNALS.map((name) => ({ name, score: null, explanation: "stub: needs the TrustGraph server" })),
    };
  }

  // ---- a conversation ----------------------------------------------------
  // items: [{id, text, sender, timestamp, links, senderHistory,
  //          prevSameSender, inChat}] in conversation order.
  // Consecutive messages from the same sender (prevSameSender) are also
  // scored together, so a scam split over three bubbles is caught. If the
  // run scores higher than each message alone, the run's result goes on
  // its last message, with each flag pointing at the message it came from.
  function analyzeChat(items) {
    const results = {};
    for (const it of items) results[it.id] = analyze(it.text, { ...it, inChat: it.inChat !== false });

    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const texts = run.map((it) => String(it.text || "").normalize("NFKC"));
        const offsets = [];
        let pos = 0;
        for (const t of texts) {
          offsets.push(pos);
          pos += t.length + 1;
        }
        const joined = texts.join("\n");
        const best = Math.max(...run.map((it) => results[it.id].score));
        const r = analyze(joined, { ...run[0], links: run.flatMap((it) => it.links || []), inChat: true });
        if (r.score > best + 0.01 && r.band !== "Low") {
          r.flags = r.flags.map((f) => {
            if (!f.evidence || f.evidence.start < 0) return { ...f, messageId: run[run.length - 1].id };
            let k = offsets.length - 1;
            while (k > 0 && offsets[k] > f.evidence.start) k--;
            return {
              ...f,
              messageId: run[k].id,
              evidence: { ...f.evidence, start: f.evidence.start - offsets[k], end: f.evidence.end - offsets[k] },
            };
          });
          r.explanation = `Across ${run.length} messages from ${run[0].sender || "this sender"}: ${r.explanation}`;
          r.window = run.length;
          results[run[run.length - 1].id] = r;
        }
      }
      run = [];
    };
    for (const it of items) {
      if (run.length && it.prevSameSender) run.push(it);
      else {
        flush();
        run = [it];
      }
    }
    flush();
    return results;
  }

  // ---- merge with the server's answer -------------------------------------
  // server: {band, score, explanation, signals} or null; status: "server" |
  // "offline" | "error".
  function combine(local, server, status) {
    if (!local) return null;
    if (!server) {
      const out = { ...local, source: "basic" };
      if (status === "offline") out.offline = true;
      if (status === "error") out.serverError = "server error";
      return out;
    }
    const serverHigher = RANK[server.band] > RANK[local.band];
    const band = serverHigher ? server.band : local.band;
    const flags = local.flags.slice();
    if (serverHigher) {
      flags.unshift({
        ruleId: "server",
        title: "Flagged by the full analysis",
        reason: server.explanation || "",
        severity: band === "High" ? "high" : "medium",
        weight: round(server.score || 0),
        messageId: local.flags[0] ? local.flags[0].messageId : null,
        evidence: null,
      });
    }
    return {
      ...local,
      band,
      score: round(Math.max(local.score, server.score || 0)),
      flags,
      weakSignals: band === "Low" ? local.weakSignals : [],
      contributions: [...local.contributions, { label: "TrustGraph server", weight: round(server.score || 0) }],
      explanation: serverHigher || !local.flags.length ? server.explanation || local.explanation : local.explanation,
      signals: Array.isArray(server.signals) ? server.signals : local.signals,
      source: "server",
    };
  }

  const api = { analyze, analyzeChat, combine, HIGH, CAUTION, SINGLE_CAP };
  root.TrustGraphEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
