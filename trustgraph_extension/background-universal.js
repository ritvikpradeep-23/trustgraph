// Background half of the universal click-to-check (content/universal.js).
// Loaded into the service worker by background.js (importScripts) and only
// reached through these messages:
//
//   UNIVERSAL_CHECK    text -> the existing engines (local rules, plus the
//                      TrustGraph API's /api/detect when Settings -> Engine
//                      is remote), exactly like a shield check, including its
//                      reported-scam matches. Text only: images and videos
//                      are never downloaded, captured or sent.
//   UNIVERSAL_CARD     a frame's result card, passed to the tab's top frame.
//   UNIVERSAL_HEALTH   extension -> backend -> database round trip.
//
// Uses background.js helpers (readSettings, postWithRetry, fetchJson,
// handleVerdict) at call time. Message text is only kept for the request.
const Universal = (() => {
  const apiUrl = (settings, path) => settings.backend_url.replace(/\/+$/, "") + path;

  async function check(msg, sender) {
    if (!TG.UNIVERSAL_CHECK) return { error: "off", message: "Click-to-check on every site is switched off." };
    const settings = await readSettings();
    const pageUrl = (sender && (sender.url || (sender.tab && sender.tab.url))) || "";
    const kind = msg.kind;
    if (kind !== "text") return { error: "bad", message: "Only text can be checked." };

    // The same scoring as a shield check (scoreMessage in background.js):
    // on-device rules + /api/detect with its reported-scam matches.
    const text = String(msg.text || "").slice(0, TG.MAX_TEXT);
    const verdict = await scoreMessage(text, "other");
    if (verdict.empty) return { kind, verdict };
    const { record, saved } = await handleVerdict(verdict, { channel: "other", url: pageUrl, text });
    return { kind, verdict, record, saved, engine: settings.engine };
  }

  // GET /health/database: the server counts the reported scams and known
  // fakes, and writes, finds and rolls back a probe record in PostgreSQL.
  async function health() {
    const settings = await readSettings();
    try {
      const res = await fetchJson(apiUrl(settings, TG.ENDPOINTS.dbHealth), { timeout: 5000 });
      if (!res.ok || !res.data) return { ok: false, stage: "backend", message: "HTTP " + res.status };
      return { ...res.data, stage: res.data.ok ? "database" : "database-error", backend: settings.backend_url };
    } catch (_) {
      return { ok: false, stage: "backend-unreachable", backend: settings.backend_url };
    }
  }

  // A frame's result card, shown by the tab's top frame.
  async function showCard(msg, sender) {
    try {
      const res = await chrome.tabs.sendMessage(sender.tab.id, { type: TG.MSG.UNIVERSAL_CARD, desc: msg.desc }, { frameId: 0 });
      return { ok: !!(res && res.ok) };
    } catch (_) {
      return { ok: false };
    }
  }

  return { check, showCard, health };
})();
