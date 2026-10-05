// The Result record: the ONLY shape that is stored in history or synced to
// the web app. "Only the verdict comes home. The message stays where it
// was detected."
//
// @typedef {Object} Result
// @property {string} id          the Verdict id (random, not derived from text)
// @property {number} timestamp   ms since epoch
// @property {"low"|"caution"|"high"} riskLevel
// @property {number} score       0-100
// @property {string[]} signalIds signal TYPE ids (e.g. "urgency"), never text
// @property {string} channel     "gmail" | "whatsapp" | ... | "other"
// @property {string} domain      hostname only, e.g. "mail.google.com"
// @property {string} [hash]      optional salted SHA-256 for dedupe
//
// There is deliberately NO text field: not the message, not a snippet, not
// the explanation, not the sender. test/result.test.js fails if a field is
// added to RESULT_FIELDS, and validate() rejects any record carrying a
// field outside it, so nothing text-like can slip into storage.
(function (root) {
  "use strict";

  const RESULT_FIELDS = Object.freeze(["id", "timestamp", "riskLevel", "score", "signalIds", "channel", "domain", "hash"]);
  const OPTIONAL = new Set(["hash"]);
  const LEVELS = ["low", "caution", "high"];
  const ID = /^[A-Za-z0-9-]{8,64}$/;
  const TOKEN = /^[a-z][a-z0-9_]{0,39}$/; // signal and channel ids
  const HOST = /^[a-z0-9.-]{0,253}$/; // hostname or "" (no path, no query)
  const HASH = /^[a-f0-9]{64}$/;

  // Returns a list of problems ([] = valid).
  function validate(r) {
    const problems = [];
    if (!r || typeof r !== "object" || Array.isArray(r)) return ["not an object"];
    for (const key of Object.keys(r)) if (!RESULT_FIELDS.includes(key)) problems.push(`field not allowed: ${key}`);
    for (const key of RESULT_FIELDS) if (!OPTIONAL.has(key) && !(key in r)) problems.push(`missing: ${key}`);
    if (!ID.test(String(r.id))) problems.push("bad id");
    if (!Number.isFinite(r.timestamp)) problems.push("bad timestamp");
    if (!LEVELS.includes(r.riskLevel)) problems.push("bad riskLevel");
    if (!Number.isInteger(r.score) || r.score < 0 || r.score > 100) problems.push("bad score");
    if (!Array.isArray(r.signalIds) || r.signalIds.length > 8 || !r.signalIds.every((s) => typeof s === "string" && TOKEN.test(s))) problems.push("bad signalIds");
    if (typeof r.channel !== "string" || !TOKEN.test(r.channel)) problems.push("bad channel");
    if (typeof r.domain !== "string" || !HOST.test(r.domain)) problems.push("bad domain");
    if ("hash" in r && !HASH.test(String(r.hash))) problems.push("bad hash");
    return problems;
  }

  const isValid = (r) => validate(r).length === 0;

  // Hostname of a URL, or "" (never the path or query: they can hold text).
  function domainOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_) {
      return "";
    }
  }

  // Salted SHA-256 of the text, for dedupe only (the salt stays on this
  // device, so the hash can't be matched against anyone else's).
  async function saltedHash(text, salt) {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle || !text || !salt) return undefined;
    const bytes = new TextEncoder().encode(salt + "\u0000" + String(text).replace(/\s+/g, " ").trim());
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Verdict (+ where it came from) -> Result. Builds the record field by
  // field from the whitelist; nothing is copied wholesale.
  function fromVerdict(verdict, ctx = {}) {
    const r = {
      id: String(verdict.id),
      timestamp: Number.isFinite(ctx.timestamp) ? ctx.timestamp : Date.now(),
      riskLevel: verdict.riskLevel,
      score: Math.max(0, Math.min(100, Math.round(Number(verdict.score) || 0))),
      signalIds: (verdict.signals || []).map((s) => s.id).filter((id) => typeof id === "string" && TOKEN.test(id)).slice(0, 8),
      channel: TOKEN.test(String(ctx.channel || "")) ? ctx.channel : "other",
      domain: ctx.domain !== undefined ? String(ctx.domain).toLowerCase() : ctx.url ? domainOf(ctx.url) : "",
    };
    if (ctx.hash) r.hash = ctx.hash;
    const problems = validate(r);
    if (problems.length) throw new Error("invalid Result: " + problems.join(", "));
    return r;
  }

  // Drops anything that isn't a valid Result (e.g. from an old version or a
  // tampered import) instead of trusting it.
  function sanitizeList(list) {
    return (Array.isArray(list) ? list : []).filter(isValid);
  }

  const api = { RESULT_FIELDS, validate, isValid, fromVerdict, domainOf, saltedHash, sanitizeList };
  root.TrustGraphResult = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
