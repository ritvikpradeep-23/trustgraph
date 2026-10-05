// Demo-data mode ("start with demo data"): seeded sample verdicts so every
// screen can be reviewed without a backend or real checks. They are
// ordinary Result records (no text, ever) whose ids start with "demo-", so
// switching demo data off removes exactly these and nothing else.
(function (root) {
  "use strict";

  const CHANNELS = [
    ["gmail", "mail.google.com", 9],
    ["whatsapp", "web.whatsapp.com", 8],
    ["linkedin", "www.linkedin.com", 4],
    ["telegram", "web.telegram.org", 3],
    ["slack", "app.slack.com", 2],
    ["discord", "discord.com", 2],
    ["instagram", "www.instagram.com", 2],
  ];
  // Plausible signal sets per verdict (signal TYPE ids from shared/verdict.js).
  const HIGH = [
    ["credential_request", "impersonation", "suspicious_link", "urgency"],
    ["money_request", "impersonation", "urgency"],
    ["money_request", "pattern_similarity", "suspicious_link"],
    ["credential_request", "urgency", "sender_mismatch"],
  ];
  const CAUTION = [["suspicious_link"], ["pattern_similarity"], ["money_request", "urgency"], ["sender_mismatch", "urgency"], ["continuity_break"]];

  // Small seeded PRNG so the demo looks the same on every machine.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function generate(now = Date.now(), count = 42) {
    const rand = rng(20261005);
    const weighted = CHANNELS.flatMap(([c, d, w]) => Array(w).fill([c, d]));
    const out = [];
    for (let i = 0; i < count; i++) {
      const [channel, domain] = weighted[Math.floor(rand() * weighted.length)];
      const roll = rand();
      const level = roll < 0.62 ? "low" : roll < 0.86 ? "caution" : "high";
      const score = level === "low" ? Math.floor(rand() * 30) + 2 : level === "caution" ? 35 + Math.floor(rand() * 33) : 72 + Math.floor(rand() * 26);
      const signalIds = level === "low" ? [] : (level === "high" ? HIGH : CAUTION)[Math.floor(rand() * (level === "high" ? HIGH : CAUTION).length)].slice();
      // Spread over the last 14 days, a few already today.
      const ageMs = i < 5 ? Math.floor(rand() * 6 * 3600e3) : Math.floor(rand() * 14 * 86400e3);
      out.push({ id: "demo-" + String(i + 1).padStart(4, "0") + "-" + Math.floor(rand() * 1e8).toString(36), timestamp: now - ageMs, riskLevel: level, score, signalIds, channel, domain });
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  const isDemo = (r) => typeof (r && r.id) === "string" && r.id.startsWith("demo-");

  root.TrustGraphDemo = { generate, isDemo };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TrustGraphDemo;
})(globalThis);
