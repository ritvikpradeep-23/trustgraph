// Background half of the universal click-to-check (content/universal.js).
// Loaded into the service worker by background.js (importScripts) and only
// reached through three messages:
//
//   UNIVERSAL_CHECK    text  -> the existing engines (local rules, plus the
//                              server when Settings -> Engine is remote),
//                              exactly like a shield check; the request also
//                              carries {type, payload, hostname, timestamp}
//                              so the server returns its database match.
//                      image/video -> POST {type, payload, hostname,
//                              timestamp, capture} to the same /api/score.
//                              Media needs the server; "on-device only"
//                              sends nothing.
//   UNIVERSAL_FETCH    download an image by its address from here (the
//                      service worker isn't bound by the page's CORS, and the
//                      page gets no console errors), scaled down to JPEG.
//   UNIVERSAL_CAPTURE  screenshot of the visible tab, cropped to an element
//                      (last fallback, when the pixels can't be read).
//   UNIVERSAL_CARD     a frame's result card, passed to the tab's top frame.
//   UNIVERSAL_HEALTH   extension -> backend -> database round trip.
//
// Uses background.js helpers (readSettings, postWithRetry, fetchJson,
// handleVerdict) at call time. Message text is only kept for the request.
const Universal = (() => {
  const CAPTURE_GAP_MS = 550; // Chrome allows about 2 captureVisibleTab calls per second
  let lastCapture = 0;
  let captureQueue = Promise.resolve();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scoreUrl = (settings) => settings.backend_url.replace(/\/+$/, "") + TG.ENDPOINTS.score;
  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return "";
    }
  }

  async function check(msg, sender) {
    if (!TG.UNIVERSAL_CHECK) return { error: "off", message: "Click-to-check on every site is switched off." };
    const settings = await readSettings();
    const pageUrl = (sender && (sender.url || (sender.tab && sender.tab.url))) || "";
    const hostname = hostOf(pageUrl);
    const kind = msg.kind;

    if (kind === "text") {
      const text = String(msg.text || "").slice(0, TG.MAX_TEXT);
      let fingerprint = null;
      // The existing RemoteEngine, with the new fields added to its request
      // and the database match read from its answer.
      const post = async (url, body, timeout) => {
        const res = await postWithRetry(url, { ...body, type: "text", payload: body.message_text, hostname, timestamp: Date.now(), capture: "direct" }, timeout);
        if (res && res.data && res.data.fingerprint) fingerprint = res.data.fingerprint;
        return res;
      };
      const engine = settings.engine === "local" ? Verdict.LocalEngine : Verdict.RemoteEngine(scoreUrl(settings), post, TG.TIMEOUT_SCORE_MS);
      const verdict = await engine.scoreMessage({ text, channel: "other" }, { sensitivity: settings.sensitivity });
      if (verdict.empty) return { kind, verdict };
      const { record, saved } = await handleVerdict(verdict, { channel: "other", url: pageUrl, text });
      return { kind, verdict, record, saved, fingerprint, engine: settings.engine };
    }

    if (kind !== "image" && kind !== "video") return { error: "bad", message: "Unknown content type." };
    if (settings.engine === "local") {
      return { kind, error: "local", message: "Images and videos are checked by the TrustGraph server, and Settings → Engine is set to on-device only, so nothing was sent." };
    }
    const body = { type: kind, payload: msg.payload, hostname, timestamp: Date.now(), capture: msg.capture || "direct" };
    let res;
    try {
      res = await fetchJson(scoreUrl(settings), { method: "POST", body, timeout: TG.UNIVERSAL.timeoutMs });
    } catch (_) {
      return { kind, error: "offline", message: `Couldn't reach the TrustGraph server at ${settings.backend_url}. Start it with python run_server.py.` };
    }
    if (!res.ok || !res.data) {
      const why = res.data && (res.data.detail || res.data.error);
      return { kind, error: "server", message: `The server couldn't check this (${why || "HTTP " + res.status}).` };
    }
    return { kind, ...res.data, capture: msg.capture || "direct" };
  }

  // Part of a bitmap -> scaled-down JPEG data: URL.
  async function toJpeg(bitmap, sx, sy, sw, sh, maxSide, quality) {
    const fit = Math.min(1, (maxSide || TG.UNIVERSAL.maxSide) / Math.max(sw, sh));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * fit)), Math.max(1, Math.round(sh * fit)));
    canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality || TG.UNIVERSAL.jpegQuality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { dataUrl: "data:image/jpeg;base64," + btoa(bin), width: canvas.width, height: canvas.height };
  }

  async function fetchImage(msg) {
    try {
      const url = new URL(String(msg.url || ""));
      if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "not a web address" };
      const res = await fetch(url.href, { credentials: "omit", signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { error: "HTTP " + res.status };
      const blob = await res.blob();
      if (!/^image\//.test(blob.type) || blob.size > 20 * 1024 * 1024) return { error: "not an image" };
      const bitmap = await createImageBitmap(blob);
      return await toJpeg(bitmap, 0, 0, bitmap.width, bitmap.height, msg.maxSide, msg.quality);
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  }

  // Screenshot of the visible tab, cropped to rect (CSS px of the top
  // frame's viewport). Only for the tab that asked, and only while it's the
  // visible tab of its window. Calls are queued and spaced to stay under
  // Chrome's capture rate limit.
  function capture(msg, sender) {
    const run = async () => {
      const [visible] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
      if (!visible || visible.id !== sender.tab.id) throw new Error("this tab isn't the visible one");
      const wait = lastCapture + CAPTURE_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCapture = Date.now();
      // A frame's card is shown by the top page: keep it out of the picture.
      const topUi = (hide) => (sender.frameId ? chrome.tabs.sendMessage(sender.tab.id, { type: TG.MSG.UNIVERSAL_CARD, hide }, { frameId: 0 }).catch(() => {}) : null);
      await topUi(true);
      let shot;
      try {
        shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
      } finally {
        topUi(false);
      }
      const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
      // Device pixels per CSS pixel: from the real screenshot width when the
      // top viewport width is known (covers page zoom), else devicePixelRatio.
      const scale = msg.viewportWidth ? bitmap.width / msg.viewportWidth : msg.dpr || 1;
      const r = msg.rect;
      const sx = Math.max(0, Math.round(r.x * scale));
      const sy = Math.max(0, Math.round(r.y * scale));
      const sw = Math.min(bitmap.width - sx, Math.round(r.w * scale));
      const sh = Math.min(bitmap.height - sy, Math.round(r.h * scale));
      if (sw < 8 || sh < 8) throw new Error("the element isn't on screen");
      return toJpeg(bitmap, sx, sy, sw, sh, msg.maxSide, msg.quality);
    };
    const job = captureQueue.then(run, run);
    captureQueue = job.catch(() => {});
    return job.catch((err) => ({ error: String((err && err.message) || err) }));
  }

  // GET /health/fingerprint: the server writes a probe fingerprint, finds
  // it in the database and rolls it back.
  async function health() {
    const settings = await readSettings();
    try {
      const res = await fetchJson(settings.backend_url.replace(/\/+$/, "") + "/health/fingerprint", { timeout: 5000 });
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

  return { check, fetchImage, capture, showCard, health };
})();
