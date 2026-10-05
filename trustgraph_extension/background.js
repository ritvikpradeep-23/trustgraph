// TrustGraph service worker (Manifest V3 background script).
//
// The ONLY place that talks to the TrustGraph backend. Content scripts can't
// call it directly: the page's CORS rules would block them. Extension
// fetches to hosts listed in host_permissions skip CORS.
//
// Chrome stops this worker whenever it's idle (~30s), so:
//   - every listener is registered synchronously at the top level,
//   - nothing important lives in memory; it's all in chrome.storage,
//   - no setInterval (the content script drives the heartbeat instead).

importScripts("shared/constants.js", "shared/rules/normalize.js", "shared/rules/rules.js", "shared/rules/engine.js");

const Engine = self.TrustGraphEngine;

// ---------------------------------------------------------------------------
// Settings
// Precedence: defaults < server (/api/settings) < what the user changed here.
// Only keys the user changed are stored under "settings", so a server value
// applies until the user picks something different in the extension.
// ---------------------------------------------------------------------------

// Server settings may only touch these keys (never backend_url or debug).
const SERVER_SETTABLE = ["paused", "mode", "sources", "minutes_per_check"];

function mergeSettings(defaults, server, local) {
  const out = { ...defaults, sources: { ...defaults.sources } };
  for (const layer of [server || {}, local || {}]) {
    for (const [key, value] of Object.entries(layer)) {
      if (!(key in defaults)) continue;
      if (key === "sources" && value && typeof value === "object") Object.assign(out.sources, value);
      else out[key] = value;
    }
  }
  return out;
}

// Settings without touching the network.
async function readSettings() {
  const { settings, server_settings } = await chrome.storage.local.get(["settings", "server_settings"]);
  return mergeSettings(TG.DEFAULT_SETTINGS, server_settings && server_settings.values, settings);
}

// Settings, refreshing the server copy first if it's stale. Never throws.
async function getSettings() {
  const { server_settings } = await chrome.storage.local.get("server_settings");
  const age = server_settings ? Date.now() - server_settings.fetched_at : Infinity;
  if (age > TG.SERVER_SETTINGS_MAX_AGE_MS) await refreshServerSettings();
  return readSettings();
}

async function refreshServerSettings() {
  try {
    const res = await backendFetch(TG.ENDPOINTS.settings, { timeout: TG.TIMEOUT_SMALL_MS });
    const values = {};
    if (res.ok && res.data && typeof res.data === "object") {
      for (const key of SERVER_SETTABLE) if (key in res.data) values[key] = res.data[key];
    }
    // Cache even a 404 (as empty values) so we don't retry on every call.
    await chrome.storage.local.set({ server_settings: { values, fetched_at: Date.now() } });
  } catch (_) {
    // Server down: keep whatever we had cached. Local values still apply.
  }
}

// Saves only the keys passed in, on top of earlier user changes.
async function setSettings(patch) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const next = { ...settings, ...patch };
  if (patch.sources) next.sources = { ...(settings.sources || {}), ...patch.sources };
  await chrome.storage.local.set({ settings: next });
  // A different server: forget what we knew about the old one.
  if ("backend_url" in patch) await chrome.storage.local.remove(["server_settings", "last_score_source"]);
  return readSettings();
}

// ---------------------------------------------------------------------------
// Backend access
// ---------------------------------------------------------------------------

class OfflineError extends Error {}

// fetch() with a timeout against the configured backend.
// Resolves {ok, status, data} for any HTTP response (including 404/500).
// Throws OfflineError when the server can't be reached or times out.
async function backendFetch(path, { method = "GET", body, timeout = TG.TIMEOUT_SMALL_MS } = {}) {
  const { backend_url } = await readSettings();
  const url = backend_url.replace(/\/+$/, "") + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new OfflineError(err && err.message);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // Not JSON (or empty). Callers check res.ok and the data shape.
  }
  return { ok: res.ok, status: res.status, data };
}

function isValidScore(data) {
  return (
    data &&
    ["Low", "Caution", "High"].includes(data.band) &&
    typeof data.explanation === "string" &&
    Array.isArray(data.signals)
  );
}

// Cleans up text before it's checked: collapse whitespace, cap length.
function normaliseText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, TG.MAX_TEXT);
}

// Asks the TrustGraph server about one text. Short timeout, one quiet
// retry on a network failure. Returns {data} for a valid answer or
// {error} for an HTTP/shape problem; throws OfflineError if unreachable.
async function serverScore(text, channel) {
  const call = () =>
    backendFetch(TG.ENDPOINTS.score, {
      method: "POST",
      body: { message_text: text, channel: channel || "other" },
      timeout: TG.TIMEOUT_SCORE_MS,
    });
  let res;
  try {
    res = await call();
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;
    await new Promise((r) => setTimeout(r, 300));
    res = await call(); // throws OfflineError again if still down
  }
  if (res.ok && isValidScore(res.data)) return { data: res.data };
  return { error: res.ok ? "unexpected response" : "HTTP " + res.status };
}

// THE scoring function for one message. The on-device rules always run
// (they name each red flag and quote the evidence); the server, when it's
// up, adds its four signals and can raise the verdict. Swap serverScore()
// for a hosted API later; callers only depend on the result shape
// (shared/rules/engine.js) or {empty: true}.
async function scoreMessage(text, channel, meta = {}) {
  const messageText = normaliseText(text);
  if (!messageText) return { empty: true };
  const local = Engine.analyze(messageText, meta);
  try {
    const srv = await serverScore(messageText, channel);
    await chrome.storage.local.set({ last_score_source: srv.data ? "server" : "error" });
    return Engine.combine(local, srv.data || null, srv.data ? "server" : "error");
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;
    await chrome.storage.local.set({ last_score_source: "basic" });
    return Engine.combine(local, null, "offline");
  }
}

// Server answers for a chat scan (the on-device rules already ran in the
// page). Once the server is found to be down, the rest are skipped rather
// than each waiting for a timeout. Returns {results: {id: data|null},
// server: "server" | "offline" | "error"}.
async function serverBatch(items, channel) {
  const results = {};
  const queue = items.filter((it) => it && it.id && normaliseText(it.text));
  let offline = false;
  let errored = false;
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (offline) {
        results[item.id] = null;
        continue;
      }
      try {
        const srv = await serverScore(normaliseText(item.text), channel);
        if (srv.error) errored = true;
        results[item.id] = srv.data || null;
      } catch (err) {
        if (!(err instanceof OfflineError)) throw err;
        offline = true;
        results[item.id] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: TG.SERVER_CONCURRENCY }, worker));
  const server = offline ? "offline" : errored ? "error" : "server";
  await chrome.storage.local.set({ last_score_source: server === "server" ? "server" : server === "error" ? "error" : "basic" });
  return { results, server };
}

// ---------------------------------------------------------------------------
// Local counters (COUNTS ONLY, never message text)
// stats = { byDay: { "2026-10-05": { checked, flagged, byChannel: { whatsapp: {checked, flagged} } } } }
// ---------------------------------------------------------------------------

function todayKey() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

// Writes are chained so two quick checks can't overwrite each other.
let statsQueue = Promise.resolve();

function recordCheck(channel, band) {
  statsQueue = statsQueue
    .then(async () => {
      const { stats = { byDay: {} } } = await chrome.storage.local.get("stats");
      const key = todayKey();
      const day = (stats.byDay[key] = stats.byDay[key] || { checked: 0, flagged: 0, byChannel: {} });
      const ch = (day.byChannel[channel] = day.byChannel[channel] || { checked: 0, flagged: 0 });
      const flagged = band === "Caution" || band === "High" ? 1 : 0;
      day.checked++;
      day.flagged += flagged;
      ch.checked++;
      ch.flagged += flagged;

      // Drop days older than STATS_KEEP_DAYS.
      const cutoff = new Date(Date.now() - TG.STATS_KEEP_DAYS * 86400000).toLocaleDateString("en-CA");
      for (const k of Object.keys(stats.byDay)) if (k < cutoff) delete stats.byDay[k];

      await chrome.storage.local.set({ stats });
    })
    .catch((err) => console.warn("[TrustGraph] could not save counters", err));
  return statsQueue;
}

async function getStats() {
  const [{ stats = { byDay: {} } }, settings] = await Promise.all([chrome.storage.local.get("stats"), readSettings()]);
  const today = stats.byDay[todayKey()] || { checked: 0, flagged: 0, byChannel: {} };
  return {
    checkedToday: today.checked,
    flaggedToday: today.flagged,
    minutesSavedEstimate: today.checked * settings.minutes_per_check,
    byChannelToday: today.byChannel,
  };
}

// ---------------------------------------------------------------------------
// Other backend calls
// ---------------------------------------------------------------------------

// Heartbeat: tells the server a supported page is open. Fails silently.
async function sendHeartbeat(source) {
  try {
    await backendFetch(TG.ENDPOINTS.status, { method: "POST", body: { source, ts: Date.now() } });
  } catch (_) {}
}

// Report as scam. Never pretends to succeed.
async function reportMessage(text) {
  const messageText = normaliseText(text);
  if (!messageText) return { ok: false };
  try {
    const res = await backendFetch(TG.ENDPOINTS.report, {
      method: "POST",
      body: { message_text: messageText, category: "unspecified" },
    });
    return { ok: res.ok };
  } catch (_) {
    return { ok: false };
  }
}

// For the toolbar popup: is the server up, and how have checks gone lately?
async function getStatus() {
  let serverUp = false;
  try {
    // Any HTTP answer (even 404) means something is listening.
    await backendFetch(TG.ENDPOINTS.dashboard, { timeout: TG.TIMEOUT_SMALL_MS });
    serverUp = true;
  } catch (_) {}
  if (serverUp) await refreshServerSettings();
  const [settings, stats, { last_score_source }] = await Promise.all([
    readSettings(),
    getStats(),
    chrome.storage.local.get("last_score_source"),
  ]);
  return { serverUp, lastScoreSource: last_score_source || null, settings, stats };
}

// ---------------------------------------------------------------------------
// Right-click "Check with TrustGraph" (works on any site via activeTab)
// ---------------------------------------------------------------------------

const MENU_ID = "trustgraph-check";

// Menus persist across worker restarts, so create them once per install or
// update. removeAll first avoids a "duplicate id" error on update.
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Check with TrustGraph", contexts: ["selection"] });
  });
}

async function onContextMenuClick(info, tab) {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab || tab.id === undefined || tab.id < 0) {
    console.warn("[TrustGraph] can't show a result in this kind of tab");
    return;
  }
  const target = { tabId: tab.id, frameIds: [0] }; // the card always goes in the top frame

  try {
    // Safe to run twice: panel.js ignores a second injection.
    await chrome.scripting.executeScript({ target, files: ["shared/constants.js", "content/panel.js"] });
  } catch (err) {
    // e.g. chrome:// pages, the Web Store, or the PDF viewer can't be scripted.
    console.warn("[TrustGraph] can't add the result card to this page:", err.message);
    return;
  }

  const send = (msg) => chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 }).catch(() => {});
  // Anchor to the selection only when it's in the top frame (we can't
  // measure a selection inside an iframe from here).
  await send({ type: TG.MSG.SHOW_CHECKING, useSelection: !info.frameId });

  const text = info.selectionText || "";
  const result = await scoreMessage(text, "other");
  if (!result.empty) await recordCheck("other", result.band);
  await send({ type: TG.MSG.SHOW_RESULT, result, text });
}

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenu();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/onboarding.html") });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  onContextMenuClick(info, tab).catch((err) => console.error("[TrustGraph]", err));
});

// ---------------------------------------------------------------------------
// Message router: content scripts and extension pages talk to us here.
// ---------------------------------------------------------------------------

async function handleMessage(msg, sender) {
  switch (msg && msg.type) {
    case TG.MSG.SCORE: {
      const result = await scoreMessage(msg.text, msg.channel, { sender: msg.sender || null });
      // noStats: the onboarding "Try it" sample shouldn't count as a check.
      if (!result.empty && !msg.noStats) await recordCheck(msg.channel || "other", result.band);
      return result;
    }
    case TG.MSG.SCORE_SERVER:
      return serverBatch(msg.items || [], msg.channel || "other");
    case TG.MSG.RECORD_CHECK:
      await recordCheck(msg.channel || "other", msg.band || "Low");
      return { ok: true };
    case TG.MSG.REPORT:
      return reportMessage(msg.text);
    case TG.MSG.GET_SETTINGS:
      return getSettings();
    case TG.MSG.SET_SETTINGS:
      return setSettings(msg.patch || {});
    case TG.MSG.HEARTBEAT:
      await sendHeartbeat(msg.source);
      return { ok: true };
    case TG.MSG.GET_STATUS:
      return getStatus();
    case TG.MSG.CLEAR_DATA:
      await chrome.storage.local.clear();
      return { ok: true };
    default:
      return { error: "unknown message type" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse, (err) => {
    console.error("[TrustGraph]", err);
    sendResponse({ error: String((err && err.message) || err) });
  });
  return true; // keeps the channel open for the async response
});
