// TrustGraph service worker (Manifest V3 background script).
//
// Owns the scoring engines, history, counts, the account and every network
// call. Content scripts and pages talk to it through typed messages
// (TG.MSG in shared/constants.js). The page's CORS rules would block
// content scripts; extension fetches to host_permissions skip CORS.
//
// Privacy: message text arrives only for a check, lives in memory for the
// length of that check, and is never stored, synced or logged. What is
// kept is a Result (shared/result.js): verdict + metadata, no text.
//
// Chrome stops this worker whenever it's idle (~30s), so:
//   - every listener is registered synchronously at the top level,
//   - nothing important lives in memory; it's all in chrome.storage,
//   - no setInterval (the content script drives the heartbeat instead).

importScripts(
  "shared/constants.js",
  "shared/rules/normalize.js",
  "shared/rules/rules.js",
  "shared/rules/engine.js",
  "shared/verdict.js",
  "shared/result.js",
  "shared/api-client.js",
  "shared/demo-data.js",
  "background-universal.js"
);

const Engine = self.TrustGraphEngine;
const Verdict = self.TrustGraphVerdict;
const Result = self.TrustGraphResult;
const Api = self.TrustGraphApi;
const Demo = self.TrustGraphDemo;

// ---------------------------------------------------------------------------
// Settings
// Precedence: defaults < server (/api/settings) < what the user changed here.
// Only keys the user changed are stored under "settings", so a server value
// applies until the user picks something different in the extension.
// ---------------------------------------------------------------------------

// Server settings may only touch these keys (never URLs, engine or debug).
const SERVER_SETTABLE = ["paused", "scan_mode", "sources", "sensitivity"];

function mergeSettings(defaults, server, local) {
  const out = { ...defaults, sources: { ...defaults.sources } };
  for (const layer of [server || {}, local || {}]) {
    for (const [key, value] of Object.entries(layer)) {
      if (!(key in defaults)) continue; // drops retired keys (e.g. the old "mode")
      if (key === "sources" && value && typeof value === "object") Object.assign(out.sources, value);
      else out[key] = value;
    }
  }
  return out;
}

async function readSettings() {
  const { settings, server_settings } = await chrome.storage.local.get(["settings", "server_settings"]);
  return mergeSettings(TG.DEFAULT_SETTINGS, server_settings && server_settings.values, settings);
}

// Settings, refreshing the server copy first if it's stale. Never throws.
async function getSettings() {
  const s = await readSettings();
  if (s.engine === "remote") {
    const { server_settings } = await chrome.storage.local.get("server_settings");
    const age = server_settings ? Date.now() - server_settings.fetched_at : Infinity;
    if (age > TG.SERVER_SETTINGS_MAX_AGE_MS) {
      await refreshServerSettings();
      return readSettings();
    }
  }
  return s;
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
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) if (k in TG.DEFAULT_SETTINGS) clean[k] = v;
  const next = { ...settings, ...clean };
  if (clean.sources) next.sources = { ...(settings.sources || {}), ...clean.sources };
  await chrome.storage.local.set({ settings: next });
  // A different server: forget what we knew about the old one.
  if ("backend_url" in clean) await chrome.storage.local.remove(["server_settings", "last_score_source"]);
  if ("demo_data" in clean) await setDemo(!!clean.demo_data);
  if ("retention_days" in clean) await pruneHistory();
  if ("sources" in clean && "generic" in clean.sources) await syncGenericScript();
  return readSettings();
}

// ---------------------------------------------------------------------------
// Scoring engine (TrustGraph server at backend_url, or on-device only)
// ---------------------------------------------------------------------------

class OfflineError extends Error {}

// fetch() with a timeout against the scoring server. Resolves {ok, status,
// data} for any HTTP response; throws OfflineError when unreachable.
async function backendFetch(path, { method = "GET", body, timeout = TG.TIMEOUT_SMALL_MS } = {}) {
  const { backend_url } = await readSettings();
  return fetchJson(backend_url.replace(/\/+$/, "") + path, { method, body, timeout });
}

async function fetchJson(url, { method = "GET", body, timeout = TG.TIMEOUT_SMALL_MS } = {}) {
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

// POST for RemoteEngine: one quiet retry when the connection fails at once
// (a dropped connection). Not after a timeout: a slow server would only make
// the user wait twice as long.
async function postWithRetry(url, body, timeout) {
  const started = Date.now();
  try {
    return await fetchJson(url, { method: "POST", body, timeout });
  } catch (err) {
    if (!(err instanceof OfflineError) || Date.now() - started > 1000) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return fetchJson(url, { method: "POST", body, timeout });
  }
}

function engineFor(settings) {
  if (settings.engine === "local") return Verdict.LocalEngine;
  const url = settings.backend_url.replace(/\/+$/, "") + TG.ENDPOINTS.score;
  return Verdict.RemoteEngine(url, postWithRetry, TG.TIMEOUT_SCORE_MS);
}

// THE scoring function for one message -> Verdict (or {empty: true}).
async function scoreMessage(text, channel, meta = {}) {
  const settings = await readSettings();
  const links = Array.isArray(meta.links) ? meta.links.slice(0, 20).filter((l) => l && typeof l.href === "string").map((l) => ({ href: l.href.slice(0, 2000), text: String(l.text || "").slice(0, 300) })) : [];
  const input = { text: String(text || "").slice(0, TG.MAX_TEXT), channel, sender: meta.sender || null, senderName: meta.senderName || null, links };
  const opts = { sensitivity: settings.sensitivity };
  const scoring = engineFor(settings).scoreMessage(input, opts);
  // Always answer in time: if the server is still busy (e.g. a cold start),
  // use the on-device verdict, marked as checked without the server.
  const verdict =
    settings.engine === "local"
      ? await scoring
      : await Promise.race([scoring, new Promise((r) => setTimeout(r, TG.SCORE_DEADLINE_MS)).then(() => Verdict.LocalEngine.scoreMessage(input, { ...opts, status: "offline" }))]);
  if (!verdict.empty && settings.engine === "remote") {
    await chrome.storage.local.set({ last_score_source: verdict.source === "server" || verdict.database ? "server" : verdict.offline ? "basic" : "error" });
  }
  return verdict;
}

// Server answers for a chat scan (the on-device rules already ran in the
// page). Answers are normalised to the engine's {band, score 0..1} shape.
// Once the server is found to be down, the rest are skipped. Returns
// {results: {id: data|null}, server: "server" | "offline" | "error" | "local"}.
async function serverBatch(items, channel) {
  const settings = await readSettings();
  if (settings.engine === "local") return { results: {}, server: "local" };
  const url = settings.backend_url.replace(/\/+$/, "") + TG.ENDPOINTS.score;
  const results = {};
  const queue = items.filter((it) => it && it.id && String(it.text || "").trim());
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
        const text = String(item.text).replace(/\s+/g, " ").trim().slice(0, TG.MAX_TEXT);
        const res = await postWithRetry(url, { text, message_text: text, channel: channel || "other" }, TG.TIMEOUT_SCORE_MS);
        const data = res.ok ? Verdict.normalizeRemote(res.data) : null;
        if (!data) errored = true;
        // {none}: checked against the reported scams, nothing to add.
        results[item.id] = data && data.none ? null : data;
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
// Counts (COUNTS ONLY, never text). Feed the popup's Overview.
// stats.byDay["2026-10-05"] = {low, caution, high, scoreSum, byChannel: {gmail: {low, caution, high}}}
// ---------------------------------------------------------------------------

const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
let statsQueue = Promise.resolve(); // chained so two quick checks can't overwrite each other

function recordStats(channel, level, score) {
  statsQueue = statsQueue
    .then(async () => {
      const { stats = { byDay: {} } } = await chrome.storage.local.get("stats");
      const day = upgradeDay((stats.byDay[dayKey()] = stats.byDay[dayKey()] || {}));
      const ch = (day.byChannel[channel] = day.byChannel[channel] || { low: 0, caution: 0, high: 0 });
      day[level]++;
      ch[level] = (ch[level] || 0) + 1;
      day.scoreSum += score;
      const cutoff = dayKey(Date.now() - TG.STATS_KEEP_DAYS * 86400000);
      for (const k of Object.keys(stats.byDay)) if (k < cutoff) delete stats.byDay[k];
      await chrome.storage.local.set({ stats });
    })
    .catch((err) => console.warn("[TrustGraph] could not save counters", err));
  return statsQueue;
}

// Days saved by v0.1 had {checked, flagged}; read them as low / caution.
function upgradeDay(day) {
  if ("checked" in day && !("low" in day)) {
    day.low = day.checked - day.flagged;
    day.caution = day.flagged;
    day.high = 0;
    for (const [k, c] of Object.entries(day.byChannel || {})) day.byChannel[k] = { low: c.checked - c.flagged, caution: c.flagged, high: 0 };
    delete day.checked;
    delete day.flagged;
  }
  day.low = day.low || 0;
  day.caution = day.caution || 0;
  day.high = day.high || 0;
  day.scoreSum = day.scoreSum || 0;
  day.byChannel = day.byChannel || {};
  return day;
}

async function getOverview() {
  const [{ stats = { byDay: {} } }, history] = await Promise.all([chrome.storage.local.get("stats"), readHistory()]);
  const byDay = {};
  for (const [k, d] of Object.entries(stats.byDay)) byDay[k] = upgradeDay(JSON.parse(JSON.stringify(d)));
  // Demo results count as if they had been checked (demo mode only).
  const demo = history.filter(Demo.isDemo);
  for (const r of demo) {
    const d = (byDay[dayKey(r.timestamp)] = byDay[dayKey(r.timestamp)] || upgradeDay({}));
    const ch = (d.byChannel[r.channel] = d.byChannel[r.channel] || { low: 0, caution: 0, high: 0 });
    d[r.riskLevel]++;
    ch[r.riskLevel]++;
    d.scoreSum += r.score;
  }
  const days = [];
  const channels = {};
  for (let i = 6; i >= 0; i--) {
    const key = dayKey(Date.now() - i * 86400000);
    const d = byDay[key] || upgradeDay({});
    const total = d.low + d.caution + d.high;
    days.push({ date: key, total, high: d.high, avgScore: total ? Math.round(d.scoreSum / total) : null });
    for (const [c, v] of Object.entries(d.byChannel)) {
      const agg = (channels[c] = channels[c] || { channel: c, label: TG.CHANNEL_LABELS[c] || c, low: 0, caution: 0, high: 0, total: 0 });
      for (const lv of ["low", "caution", "high"]) agg[lv] += v[lv] || 0;
      agg.total = agg.low + agg.caution + agg.high;
    }
  }
  const today = byDay[dayKey()] || upgradeDay({});
  return {
    today: { low: today.low, caution: today.caution, high: today.high, total: today.low + today.caution + today.high },
    days,
    channels: Object.values(channels).sort((a, b) => b.total - a.total),
    demo: demo.length > 0,
  };
}

// ---------------------------------------------------------------------------
// History: Result records only (shared/result.js). Local first; synced to
// the web app when signed in.
// ---------------------------------------------------------------------------

let historyQueue = Promise.resolve();
const withHistory = (fn) => (historyQueue = historyQueue.then(fn, fn));

async function readHistory() {
  const { history } = await chrome.storage.local.get("history");
  return Result.sanitizeList(history);
}

function keepFor(list, settings) {
  const days = Number(settings.retention_days) || 0;
  const cutoff = days ? Date.now() - days * 86400000 : -Infinity;
  // Demo results are exempt (they're removed by switching demo data off).
  return list.filter((r) => Demo.isDemo(r) || r.timestamp >= cutoff).slice(0, TG.HISTORY_MAX);
}

function pruneHistory() {
  return withHistory(async () => {
    const settings = await readSettings();
    await chrome.storage.local.set({ history: keepFor(await readHistory(), settings) });
  });
}

async function addToHistory(record) {
  await withHistory(async () => {
    const settings = await readSettings();
    let list = await readHistory();
    // Dedupe: the same text checked again replaces the earlier entry.
    list = list.filter((r) => r.id !== record.id && !(record.hash && r.hash === record.hash));
    await chrome.storage.local.set({ history: keepFor([record, ...list], settings) });
  });
  syncToWebapp((api) => api.saveResult(record));
}

async function removeFromHistory(ids) {
  await withHistory(async () => {
    const set = new Set(ids);
    await chrome.storage.local.set({ history: (await readHistory()).filter((r) => !set.has(r.id)) });
  });
}

async function setDemo(on) {
  await withHistory(async () => {
    const list = (await readHistory()).filter((r) => !Demo.isDemo(r));
    const next = on ? [...list, ...Demo.generate()].sort((a, b) => b.timestamp - a.timestamp) : list;
    await chrome.storage.local.set({ history: next });
  });
}

// Per-device salt for the dedupe hash, so hashes can't be compared with
// anyone else's.
async function deviceSalt() {
  const { device_salt } = await chrome.storage.local.get("device_salt");
  if (device_salt) return device_salt;
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ device_salt: salt });
  return salt;
}

// A finished verdict: count it, keep its Result (if saving is on), notify
// on High (if enabled). `text` is used only for the salted dedupe hash.
// update: a chat verdict that changed as more messages were read (already
// counted once; only its saved Result is refreshed).
async function handleVerdict(verdict, { channel, url, text, noStats, update }) {
  const settings = await readSettings();
  const hash = text ? await Result.saltedHash(text, await deviceSalt()) : undefined;
  const record = Result.fromVerdict(verdict, { channel: channel || "other", url: url || "", hash });
  if (noStats) return { record, saved: false };
  if (update) {
    if (settings.save_history) await addToHistory(record);
    return { record, saved: !!settings.save_history };
  }
  await recordStats(record.channel, record.riskLevel, record.score);
  const saved = !!settings.save_history;
  if (saved) await addToHistory(record);
  if (record.riskLevel === "high") notifyHigh(record, settings);
  return { record, saved };
}

function notifyHigh(record, settings) {
  if (!settings.notify_high || !chrome.notifications) return;
  // No text from the message: only where it was found.
  chrome.notifications.create("tg-" + record.id, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "High risk message",
    message: `TrustGraph flagged a message on ${TG.CHANNEL_LABELS[record.channel] || record.domain || "this page"}. Open the TrustGraph panel to see why.`,
    priority: 1,
  });
}

function toCsv(list) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["id", "timestamp", "riskLevel", "score", "signalIds", "channel", "domain"].join(",")];
  for (const r of list) rows.push([r.id, new Date(r.timestamp).toISOString(), r.riskLevel, r.score, r.signalIds.join(";"), r.channel, r.domain].map(q).join(","));
  return rows.join("\n") + "\n";
}

async function exportHistory(format) {
  const list = await readHistory();
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") return { filename: `trustgraph-history-${stamp}.csv`, mime: "text/csv", data: toCsv(list) };
  return { filename: `trustgraph-history-${stamp}.json`, mime: "application/json", data: JSON.stringify({ exportedAt: new Date().toISOString(), results: list }, null, 2) };
}

// ---------------------------------------------------------------------------
// Account and the web app (ApiClient; the mock when no web app URL is set)
// account = {state: "signed_out" | "local" | "signed_in", name, token, since}
// ---------------------------------------------------------------------------

async function getAccountRaw() {
  const { account } = await chrome.storage.local.get("account");
  return account && account.state ? account : { state: "signed_out" };
}

// The web workspace: Settings → Web app URL, else the TrustGraph server
// itself (it serves the React workspace and its API on one address), else
// (on-device only) the built-in demo web app.
function workspaceUrl(settings) {
  return settings.webapp_url || (settings.engine === "remote" ? settings.backend_url : "");
}

async function apiClient() {
  const [settings, account] = await Promise.all([readSettings(), getAccountRaw()]);
  return Api.create({ webappUrl: workspaceUrl(settings), token: account.state === "signed_in" ? account.token : null });
}

// Fire-and-forget sync of one change; failures leave the local copy as is.
async function syncToWebapp(fn) {
  const account = await getAccountRaw();
  if (account.state !== "signed_in") return;
  try {
    await fn(await apiClient());
  } catch (err) {
    console.warn("[TrustGraph] web app sync failed:", err.message);
  }
}

// What the popup shows (never the token).
async function getAccount() {
  const [account, settings] = await Promise.all([getAccountRaw(), readSettings()]);
  let online = true;
  if (account.state === "signed_in") {
    try {
      await (await apiClient()).ping();
    } catch (_) {
      online = false;
    }
  }
  return { state: account.state, name: account.name || null, since: account.since || null, online, mock: !workspaceUrl(settings) };
}

async function pair(code) {
  const api = await apiClient();
  try {
    const { token, name } = await api.pair(code);
    await chrome.storage.local.set({ account: { state: "signed_in", token, name, since: Date.now() } });
    await sendHeartbeat("extension");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Api.ApiError && err.status === 0 ? "Couldn't reach the TrustGraph server. Check that the server URL in Settings is right, then try again." : err.message };
  }
}

async function openAuth(page) {
  const api = await apiClient();
  await chrome.tabs.create({ url: api.pageUrl(page === "register" ? TG.WEBAPP.register : TG.WEBAPP.login) });
}

async function openWorkspace(id) {
  const api = await apiClient();
  await chrome.tabs.create({ url: api.pageUrl(TG.WEBAPP.resultPage + encodeURIComponent(String(id || ""))) });
}

async function markWrong(id) {
  const { feedback_ids = [] } = await chrome.storage.local.get("feedback_ids");
  if (!feedback_ids.includes(id)) await chrome.storage.local.set({ feedback_ids: [...feedback_ids, id].slice(-500) });
  try {
    await (await apiClient()).sendFeedback(id); // the verdict id, nothing else
    return { ok: true };
  } catch (_) {
    return { ok: true, queued: true }; // kept locally; nothing else to send
  }
}

// ---------------------------------------------------------------------------
// Status for the popup and settings
// ---------------------------------------------------------------------------

async function sendHeartbeat(source) {
  const settings = await readSettings();
  const account = await getAccountRaw();
  if (!workspaceUrl(settings) || account.state !== "signed_in") return;
  try {
    await (await apiClient()).heartbeat(source);
  } catch (_) {}
}

async function getStatus() {
  const settings = await readSettings();
  let serverUp = false;
  if (settings.engine === "remote") {
    try {
      // Any HTTP answer (even 404) means something is listening.
      await backendFetch(TG.ENDPOINTS.dashboard, { timeout: TG.TIMEOUT_SMALL_MS });
      serverUp = true;
    } catch (_) {}
    if (serverUp) await refreshServerSettings();
  }
  const [fresh, { last_score_source }, account] = await Promise.all([readSettings(), chrome.storage.local.get("last_score_source"), getAccount()]);
  return { serverUp, lastScoreSource: last_score_source || null, settings: fresh, account };
}

// ---------------------------------------------------------------------------
// Optional "all sites" fallback: a generic content script, registered only
// after the user grants the optional https://*/* permission.
// ---------------------------------------------------------------------------
const GENERIC_ID = "trustgraph-generic";
const GENERIC_FILES = [
  "shared/constants.js",
  "shared/icons.js",
  "shared/design.js",
  "shared/ui.js",
  "shared/rules/normalize.js",
  "shared/rules/rules.js",
  "shared/rules/engine.js",
  "shared/verdict.js",
  "adapters/kit.js",
  "adapters/generic.js",
  "content/chat-store.js",
  "content/panel.js",
  "content/core.js",
];

async function syncGenericScript() {
  try {
    const settings = await readSettings();
    const granted = await chrome.permissions.contains({ origins: ["https://*/*"] });
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [GENERIC_ID] });
    const want = granted && settings.sources.generic !== false && settings.sources.generic;
    if (want && !existing.length) {
      await chrome.scripting.registerContentScripts([
        {
          id: GENERIC_ID,
          matches: ["https://*/*"],
          // Sites with their own adapter keep it.
          excludeMatches: chrome.runtime.getManifest().content_scripts.flatMap((c) => c.matches).filter((m) => m.startsWith("https://")),
          js: GENERIC_FILES,
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    } else if (!want && existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [GENERIC_ID] });
    }
  } catch (err) {
    console.warn("[TrustGraph] generic script:", err.message);
  }
}
chrome.permissions.onAdded.addListener(syncGenericScript);
chrome.permissions.onRemoved.addListener(syncGenericScript);

// ---------------------------------------------------------------------------
// Right-click "Check with TrustGraph", and the popup's "Check current
// selection" (both work on any site via activeTab)
// ---------------------------------------------------------------------------

const MENU_ID = "trustgraph-check";
const PANEL_FILES = ["shared/constants.js", "shared/icons.js", "shared/design.js", "shared/ui.js", "shared/verdict.js", "content/panel.js"];

// Menus persist across worker restarts, so create them once per install or
// update. removeAll first avoids a "duplicate id" error on update.
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Check with TrustGraph", contexts: ["selection"] });
  });
}

async function checkInTab(tab, text, frameId) {
  if (!tab || tab.id === undefined || tab.id < 0) return { error: "This kind of tab can't be checked." };
  const target = { tabId: tab.id, frameIds: [0] }; // the panel always goes in the top frame
  try {
    // Safe to run twice: panel.js ignores a second injection.
    await chrome.scripting.executeScript({ target, files: PANEL_FILES });
  } catch (err) {
    // e.g. chrome:// pages, the Web Store, or the PDF viewer can't be scripted.
    console.warn("[TrustGraph] can't add the panel to this page:", err.message);
    return { error: "TrustGraph can't run on this page." };
  }
  const { theme } = await readSettings();
  const send = (msg) => chrome.tabs.sendMessage(tab.id, { theme, ...msg }, { frameId: 0 }).catch(() => {});
  await send({ type: TG.MSG.SHOW_CHECKING, useSelection: !frameId });
  const verdict = await scoreMessage(text, "other");
  const saved = verdict.empty ? null : await handleVerdict(verdict, { channel: "other", url: tab.url, text });
  await send({ type: TG.MSG.SHOW_RESULT, verdict, record: saved && saved.record, saved: saved && saved.saved });
  return { ok: true };
}

async function onContextMenuClick(info, tab) {
  if (info.menuItemId !== MENU_ID) return;
  await checkInTab(tab, info.selectionText || "", info.frameId);
}

async function checkSelection(tabId) {
  // The popped-out popup names its tab; the toolbar popup uses the active one.
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !/^https?:/.test(tab.url || "")) return { error: "TrustGraph can't run on this page." };
  let text = "";
  try {
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => String(getSelection() || "") });
    text = (frames.find((f) => f.result && f.result.trim()) || {}).result || "";
  } catch (_) {
    return { error: "TrustGraph can't run on this page." };
  }
  if (!text.trim()) return { error: "Select some text on the page first." };
  return checkInTab(tab, text, 0);
}

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenu();
  syncGenericScript();
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("ui/options.html#welcome") });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  onContextMenuClick(info, tab).catch((err) => console.error("[TrustGraph]", err));
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

async function handleMessage(msg, sender) {
  const tabUrl = (sender && sender.tab && sender.tab.url) || "";
  switch (msg && msg.type) {
    case TG.MSG.SCORE: {
      const verdict = await scoreMessage(msg.text, msg.channel, { sender: msg.sender || null, senderName: msg.senderName || null, links: msg.links });
      if (verdict.empty) return { verdict };
      // noStats: the onboarding sample isn't counted or saved.
      const { record, saved } = await handleVerdict(verdict, { channel: msg.channel || "other", url: tabUrl, text: msg.text, noStats: !!msg.noStats });
      return { verdict, record, saved };
    }
    case TG.MSG.SCORE_SERVER:
      return serverBatch(msg.items || [], msg.channel || "other");
    case TG.MSG.RECORD_RESULT: {
      // A chat scan's verdict, built in the page; no text crosses here.
      const { record, saved } = await handleVerdict(msg.verdict, { channel: msg.channel || "other", url: tabUrl, update: !!msg.update });
      return { record, saved };
    }
    case TG.MSG.SET_SAVED: {
      if (!Result.isValid(msg.record)) return { error: "invalid record" };
      if (msg.saved) await addToHistory(msg.record);
      else {
        await removeFromHistory([msg.record.id]);
        syncToWebapp((api) => api.deleteResult(msg.record.id));
      }
      await setSettings({ save_history: !!msg.saved });
      return { ok: true, saved: !!msg.saved };
    }
    case TG.MSG.MARK_WRONG:
      return markWrong(String(msg.id || ""));
    case TG.MSG.OPEN_WORKSPACE:
      await openWorkspace(msg.id);
      return { ok: true };
    case TG.MSG.GET_HISTORY: {
      const [results, { feedback_ids = [] }] = await Promise.all([readHistory(), chrome.storage.local.get("feedback_ids")]);
      return { results, wrong: feedback_ids };
    }
    case TG.MSG.DELETE_RESULT:
      await removeFromHistory([msg.id]);
      syncToWebapp((api) => api.deleteResult(msg.id));
      return { ok: true };
    case TG.MSG.DELETE_ALL:
      await withHistory(() => chrome.storage.local.set({ history: [] }));
      await chrome.storage.local.set({ stats: { byDay: {} } });
      syncToWebapp((api) => api.deleteAll());
      return { ok: true };
    case TG.MSG.EXPORT:
      return exportHistory(msg.format);
    case TG.MSG.GET_OVERVIEW:
      return getOverview();
    case TG.MSG.GET_ACCOUNT:
      return getAccount();
    case TG.MSG.OPEN_AUTH:
      await openAuth(msg.page);
      return { ok: true };
    case TG.MSG.PAIR:
      return pair(msg.code);
    case TG.MSG.USE_LOCAL:
      await chrome.storage.local.set({ account: { state: "local", since: Date.now() } });
      return { ok: true };
    case TG.MSG.SIGN_OUT:
      await chrome.storage.local.set({ account: { state: "signed_out" } });
      return { ok: true };
    case TG.MSG.CHECK_SELECTION:
      return checkSelection(msg.tabId);
    case TG.MSG.GET_SETTINGS:
      return getSettings();
    case TG.MSG.SET_SETTINGS:
      return setSettings(msg.patch || {});
    case TG.MSG.HEARTBEAT:
      await sendHeartbeat(msg.source);
      return { ok: true };
    case TG.MSG.GET_STATUS:
      return getStatus();
    case TG.MSG.UNIVERSAL_CHECK:
      return Universal.check(msg, sender);
    case TG.MSG.UNIVERSAL_FETCH:
      return Universal.fetchImage(msg);
    case TG.MSG.UNIVERSAL_CAPTURE:
      return Universal.capture(msg, sender);
    case TG.MSG.UNIVERSAL_CARD:
      return Universal.showCard(msg, sender);
    case TG.MSG.UNIVERSAL_HEALTH:
      return Universal.health();
    case TG.MSG.CLEAR_DATA:
      await chrome.storage.local.clear();
      await syncGenericScript();
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
