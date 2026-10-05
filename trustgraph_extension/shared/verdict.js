// The scoring-engine interface and the Verdict shape every UI reads.
//
//   engine.scoreMessage(input) -> Promise<Verdict>
//   input   = {text, channel, sender?, links?, id?}   (text: memory only)
//   Verdict = {
//     id,                         // random id; "Mark as wrong verdict" sends only this
//     riskLevel: "low" | "caution" | "high",
//     score: 0-100,
//     explanation: string,        // one plain-language paragraph
//     signals: [{id, name, icon, description, severity, ruleIds, evidence?, messageId?}],
//     continuity: {state, text},  // computed metadata only, never earlier text
//     similarity: {score|null, text},
//     engine: "local" | "remote", source: "basic" | "server", offline?, serverError?,
//     details: {score01, contributions, weakSignals}   // for "How this was decided"
//   }
// `evidence` is the quoted phrase that triggered a signal. It lives only in
// memory for the panel; shared/result.js decides what may be stored, and
// it is never evidence.
//
// Two engines ship:
//   LocalEngine   the on-device rules (shared/rules/), works offline
//   RemoteEngine  POSTs {message_text, channel} to a configurable URL and
//                 accepts {riskLevel, score 0-100, explanation, signals}
//                 or the older {band, score 0..1, explanation, signals};
//                 the local rules still run and the higher verdict wins.
// background.js picks one from Settings (engine: "local" | "remote").
(function (root) {
  "use strict";
  const Engine = root.TrustGraphEngine || (typeof require === "function" ? require("./rules/engine.js") : null);

  // The eight signal types shown in the UI (design spec). Every rule id
  // maps to one of them, so the panel speaks in a small, stable vocabulary.
  const SIGNAL_TYPES = {
    urgency: { name: "Urgency pressure", icon: "timer", description: "Pushes you to act now, before you can think or check." },
    money_request: { name: "Request for money, gift cards or crypto", icon: "wallet", description: "Asks you to pay, transfer, buy gift cards or invest." },
    credential_request: { name: "Credential or OTP request", icon: "keyRound", description: "Asks for a code, PIN, password or access to your device." },
    suspicious_link: { name: "Suspicious link or lookalike domain", icon: "link", description: "A link that hides or imitates where it really goes." },
    sender_mismatch: { name: "Sender mismatch", icon: "userX", description: "The sender doesn't match who they say they are." },
    impersonation: { name: "Impersonation of a contact or brand", icon: "venetianMask", description: "Claims to be family, a bank, police or a known company." },
    continuity_break: { name: "Unusual continuity break", icon: "gitBranch", description: "The conversation suddenly changed tone or purpose." },
    pattern_similarity: { name: "Similar to known scam patterns", icon: "fingerprint", description: "Follows the shape of a well-known scam." },
  };
  const SIGNAL_ORDER = Object.keys(SIGNAL_TYPES);

  // Why each rule lands where it does: by what the message is trying to
  // get from you (money, a code), or how it gets there (pressure, a link,
  // pretending to be someone).
  const RULE_SIGNAL = {
    otp_request: "credential_request", // the code IS the account
    code_request: "credential_request",
    remote_access: "credential_request", // screen-sharing apps hand over the device
    upi_collect: "money_request", // "enter PIN to receive" actually pays out
    upfront_fee: "money_request",
    investment: "money_request",
    gift_card: "money_request",
    money_request: "money_request",
    blackmail: "money_request",
    kyc_block: "impersonation", // poses as the bank
    authority_threat: "impersonation", // poses as police / customs / CBI
    power_cut: "impersonation", // poses as the electricity board
    new_number_family: "impersonation", // poses as family
    new_number: "sender_mismatch",
    urgency: "urgency",
    secrecy: "urgency", // isolation is a pressure tactic
    legal_threat: "urgency",
    prize: "pattern_similarity",
    lottery_mention: "pattern_similarity",
    job_offer: "pattern_similarity",
    link_lookalike: "suspicious_link",
    link_punycode: "suspicious_link",
    link_ip: "suspicious_link",
    link_shortener: "suspicious_link",
    link_risky_tld: "suspicious_link",
    combo_link_urgency_money: "pattern_similarity",
    combo_new_number_money: "impersonation",
    combo_official_link: "suspicious_link",
    combo_secret_money: "pattern_similarity",
    combo_threat_money: "pattern_similarity",
    server: "pattern_similarity",
  };
  // Server signal names (the Python server's four) -> signal types.
  const SERVER_SIGNAL = { continuity: "continuity_break", anomaly: "continuity_break", similarity: "pattern_similarity", precedent: "pattern_similarity" };

  // Sensitivity moves the thresholds; Balanced is the spec's (35 / 70).
  const THRESHOLDS = { relaxed: { caution: 45, high: 80 }, balanced: { caution: 35, high: 70 }, strict: { caution: 25, high: 60 } };
  const LEVEL_RANK = { low: 0, caution: 1, high: 2 };
  const SEV_RANK = { low: 0, medium: 1, high: 2 };

  function levelFor(score100, sensitivity) {
    const t = THRESHOLDS[sensitivity] || THRESHOLDS.balanced;
    return score100 >= t.high ? "high" : score100 >= t.caution ? "caution" : "low";
  }

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  // Groups rule hits into typed signals (strongest first).
  function signalsFrom(hits, contributions) {
    const byType = new Map();
    for (const h of hits || []) {
      if (h.kind === "weak") continue; // context only, shown in "How this was decided"
      const type = RULE_SIGNAL[h.ruleId] || "pattern_similarity";
      const cur = byType.get(type);
      if (!cur) {
        byType.set(type, {
          id: type,
          ...SIGNAL_TYPES[type],
          description: h.reason || SIGNAL_TYPES[type].description,
          severity: h.severity || "medium",
          ruleIds: [h.ruleId],
          evidence: h.evidence ? h.evidence.text || null : null,
          messageId: h.messageId || null,
        });
      } else {
        cur.ruleIds.push(h.ruleId);
        if (SEV_RANK[h.severity] > SEV_RANK[cur.severity]) cur.severity = h.severity;
      }
    }
    if ((contributions || []).some((c) => /unsaved number/i.test(c.label)) && !byType.has("sender_mismatch")) {
      byType.set("sender_mismatch", { id: "sender_mismatch", ...SIGNAL_TYPES.sender_mismatch, description: "Sent from a number that isn't in your contacts.", severity: "low", ruleIds: ["sender_unsaved"], evidence: null, messageId: null });
    }
    return [...byType.values()].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || SIGNAL_ORDER.indexOf(a.id) - SIGNAL_ORDER.indexOf(b.id));
  }

  // Similarity to known patterns: the server's similarity signal if there
  // is one, else the strongest pattern-type rule that fired.
  function similarityFrom(result) {
    const srv = (result.signals || []).find((s) => s && s.name === "similarity" && typeof s.score === "number");
    if (srv) return { score: Math.round(srv.score * 100), text: srv.explanation || "Compared with known scam messages by the TrustGraph server." };
    const pattern = (result.hits || []).filter((h) => h.kind !== "weak" && h.kind !== "modifier").sort((a, b) => b.weight - a.weight)[0];
    if (!pattern) return { score: 0, text: "Doesn't match any scam pattern TrustGraph knows." };
    return { score: Math.round(pattern.weight * 100), text: `Closest known pattern: ${pattern.title.toLowerCase()}.` };
  }

  // engine result (shared/rules/engine.js, possibly merged with a server
  // answer) -> Verdict.
  function fromEngine(result, opts = {}) {
    const score = Math.round((result.score || 0) * 100);
    const sensitivity = opts.sensitivity || "balanced";
    // Balanced keeps the engine's own band (it also knows the one-sign cap
    // and a server's raised verdict); other sensitivities re-threshold.
    let riskLevel = sensitivity === "balanced" ? String(result.band || "Low").toLowerCase() : levelFor(score, sensitivity);
    if (!(riskLevel in LEVEL_RANK)) riskLevel = "caution";
    const hits = result.hits || result.flags || [];
    // combine() adds a "server" flag (not a hit) when the server raised the verdict.
    const pool = [...(result.flags || []).filter((f) => f.ruleId === "server"), ...hits];
    const signals = riskLevel === "low" ? [] : signalsFrom(pool, result.contributions);
    for (const s of result.signals || []) {
      // Server signals with a real score above 0.5 add their own row.
      const type = SERVER_SIGNAL[s && s.name];
      if (riskLevel !== "low" && type && typeof s.score === "number" && s.score >= 0.5 && !signals.some((x) => x.id === type)) {
        signals.push({ id: type, ...SIGNAL_TYPES[type], description: s.explanation || SIGNAL_TYPES[type].description, severity: s.score >= 0.75 ? "high" : "medium", ruleIds: ["server_" + s.name], evidence: null, messageId: null });
      }
    }
    return {
      id: opts.id || newId(),
      riskLevel,
      score,
      explanation: explain(result, riskLevel, signals),
      signals,
      continuity: opts.continuity || { state: "single", text: "Single message: there's no earlier thread to compare with." },
      similarity: similarityFrom(result),
      engine: opts.engine || (result.source === "server" ? "remote" : "local"),
      source: result.source === "server" ? "server" : "basic",
      offline: !!result.offline,
      serverError: result.serverError || null,
      window: result.window || 0,
      details: { score01: result.score || 0, contributions: result.contributions || [], weakSignals: result.weakSignals || [] },
    };
  }

  // One calm paragraph: what landed the verdict where it is.
  function explain(result, level, signals) {
    const names = signals.slice(0, 3).map((s) => s.name.toLowerCase());
    const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
    if (level === "high") return `Several scam signs appear together: ${list}. Together they match how scams usually work, so treat this message as unsafe until you've checked with the sender another way.`;
    if (level === "caution") return `${names.length > 1 ? "A few scam signs stand out" : names.length ? "One scam sign stands out" : "Something here looks off"}${list ? ": " + list : ""}. That isn't enough on its own to call this a scam, so take a moment before you reply, pay or share anything.`;
    const weak = (result.weakSignals || []).length;
    return weak ? "Nothing strong enough to flag. A few words matched common scam phrases, but in context they look ordinary." : "No scam signs found. That isn't a guarantee: if something feels off, check with the person another way.";
  }

  // A remote answer in either shape -> the engine's {band, score 0..1,
  // explanation, signals}, or null if it isn't one we understand.
  function normalizeRemote(data) {
    if (!data || typeof data !== "object") return null;
    if (typeof data.riskLevel === "string" && typeof data.score === "number") {
      const level = data.riskLevel.toLowerCase();
      if (!(level in LEVEL_RANK)) return null;
      return { band: level[0].toUpperCase() + level.slice(1), score: Math.max(0, Math.min(100, data.score)) / 100, explanation: String(data.explanation || ""), signals: remoteSignals(data.signals) };
    }
    if (["Low", "Caution", "High"].includes(data.band) && typeof data.explanation === "string" && Array.isArray(data.signals)) {
      return { band: data.band, score: Math.max(0, Math.min(1, Number(data.score) || 0)), explanation: data.explanation, signals: remoteSignals(data.signals) };
    }
    return null;
  }

  function remoteSignals(list) {
    return (Array.isArray(list) ? list : [])
      .filter((s) => s && typeof s === "object")
      .map((s) => ({ name: String(s.name || s.id || ""), score: typeof s.score === "number" ? (s.score > 1 ? s.score / 100 : s.score) : null, explanation: String(s.explanation || s.description || "") }));
  }

  // ---- engines ---------------------------------------------------------------
  function cleanText(text, max = 4000) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  const LocalEngine = {
    name: "local",
    async scoreMessage(input, opts = {}) {
      const text = cleanText(input.text);
      if (!text) return { empty: true };
      const r = Engine.analyze(text, { sender: input.sender || null, links: input.links, id: input.id });
      return fromEngine(Engine.combine(r, null, opts.status || "local"), { ...opts, engine: "local" });
    },
  };

  // url: full scoring endpoint. fetchImpl(url, body, timeoutMs) resolves
  // {ok, status, data} or throws when unreachable (background.js passes one
  // with a short timeout and a quiet retry).
  function RemoteEngine(url, fetchImpl, timeoutMs = 3000) {
    return {
      name: "remote",
      async scoreMessage(input, opts = {}) {
        const text = cleanText(input.text);
        if (!text) return { empty: true };
        const local = Engine.analyze(text, { sender: input.sender || null, links: input.links, id: input.id });
        let merged;
        try {
          const res = await fetchImpl(url, { message_text: text, channel: input.channel || "other" }, timeoutMs);
          const remote = res.ok ? normalizeRemote(res.data) : null;
          merged = remote ? Engine.combine(local, remote, "server") : Engine.combine(local, null, "error");
          if (!remote) merged.serverError = res.ok ? "unexpected response" : "HTTP " + res.status;
        } catch (_) {
          merged = Engine.combine(local, null, "offline");
        }
        return fromEngine(merged, { ...opts, engine: "remote" });
      },
    };
  }

  const api = { SIGNAL_TYPES, SIGNAL_ORDER, RULE_SIGNAL, THRESHOLDS, levelFor, fromEngine, normalizeRemote, signalsFrom, newId, LocalEngine, RemoteEngine };
  root.TrustGraphVerdict = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
