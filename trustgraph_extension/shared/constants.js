// Shared constants for every part of the extension.
//
// This one file is loaded in three different places:
//   - the service worker (background.js, via importScripts)
//   - content scripts on chat sites (listed first in manifest.json)
//   - extension pages (popup, options, onboarding) via a <script> tag
// `globalThis` is the global object in all three, so everything hangs off a
// single global named TG.
(function (root) {
  "use strict";

  const TG = root.TG || {};

  TG.VERSION = "0.2.7";

  // Settings the user can change. Only keys the user has actually changed are
  // saved in chrome.storage.local; everything else falls back to these.
  TG.DEFAULT_SETTINGS = {
    paused: false,
    // Where the shield and launcher appear. "generic" = any other site; it
    // also needs the optional "all sites" permission.
    sources: { whatsapp: true, gmail: true, messenger: true, instagram: true, linkedin: true, telegram: true, discord: true, slack: true, generic: false },
    scan_mode: "click", // "click" = nothing is read until you click; "auto" = scan open chats (rail only, expands for High)
    shield_position: "top-right", // "top-right" | "top-left" | "bottom-right"
    sensitivity: "balanced", // "relaxed" | "balanced" | "strict"
    notify_high: false, // needs the optional "notifications" permission
    retention_days: 30, // 7 | 30 | 90 | 0 (= forever)
    save_history: true, // "Save to history" in the panel starts switched on
    theme: "dark", // "dark" | "light"
    engine: "remote", // "remote" = TrustGraph server at backend_url (local rules as fallback) | "local" = on-device only
    backend_url: "https://trustgraphai-alpha.vercel.app", // the scoring engine (TrustGraph server; http://127.0.0.1:8000 when running it yourself)
    webapp_url: "", // the TrustGraph web app; empty = the TrustGraph server's workspace (or the built-in demo when on-device only)
    demo_data: false,
    debug: false,
  };

  // TrustGraph API paths (on backend_url; the FastAPI app in app/main.py).
  TG.ENDPOINTS = {
    score: "/api/detect", // POST {text, channel} -> risk + previous_report_matches (reported-scam pattern matching)
    media: "/api/media/check", // POST {type, payload, hostname, timestamp, capture} -> known-fakes fingerprint match
    dbHealth: "/health/database", // GET: backend -> PostgreSQL round trip
    settings: "/api/settings", // GET  (optional)
    status: "/api/status", // POST {source, ts} heartbeat (optional)
    dashboard: "/health", // reachability check
  };

  // Web app paths (on webapp_url). Only verdicts and metadata go here,
  // never message text (see shared/result.js).
  TG.WEBAPP = {
    results: "/api/results", // POST Result, GET -> Result[]
    result: "/api/results/", // DELETE /api/results/:id
    export: "/api/export", // GET -> Result[]
    feedback: "/api/feedback", // POST {resultId}  ("Mark as wrong verdict")
    pair: "/api/extension/pair", // POST {code} -> {token, account: {name}}; the code comes from the workspace's Settings
    login: "/app/settings?source=extension", // the workspace's Settings page shows the pairing code
    register: "/app/settings?source=extension",
    resultPage: "/app/detections/", // + id: "Open in workspace"
  };

  // A server that has been idle (Vercel) needs several seconds to wake up and
  // load the scam model before its first answer; later answers are instant.
  TG.TIMEOUT_SCORE_MS = 10000; // one server attempt
  // The background always answers a check within this, with the on-device
  // verdict if the server is still busy. Must stay below the page's wait
  // (TG.PAGE_WAIT_MS), or the page gives up and says the background didn't answer.
  TG.SCORE_DEADLINE_MS = 11000;
  TG.PAGE_WAIT_MS = 14000;
  TG.TIMEOUT_SMALL_MS = 2000; // pings, settings, heartbeat, web app calls
  TG.SERVER_SETTINGS_MAX_AGE_MS = 60 * 1000;
  TG.HEARTBEAT_MS = 15 * 1000;
  TG.MAX_TEXT = 4000; // characters sent for one check
  TG.STATS_KEEP_DAYS = 90;
  TG.HISTORY_MAX = 2000; // newest kept when over
  TG.SERVER_CONCURRENCY = 4; // parallel /api/detect calls during a chat scan
  TG.MAX_SCAN_MESSAGES = 40; // most recent incoming messages scored per scan

  // Risk score (0-100) from which a message is flagged (Caution) at the
  // default Balanced sensitivity. The rules engine, the verdict bands and
  // the panel all read this one value; High stays at 70.
  TG.FLAG_THRESHOLD = 35;

  // Chat scans on sites whose adapter sets `scanFilters` (WhatsApp): what
  // never reaches the model. A message is long enough with at least
  // SCAN_MIN_CHARS characters OR SCAN_MIN_WORDS words; only-emoji,
  // only-link and media-without-caption messages are always skipped.
  TG.SCAN_MIN_CHARS = 25;
  TG.SCAN_MIN_WORDS = 5;
  // Your own (outgoing) messages are not scored. NOTE for the owner: set
  // this to true if you want them scored too (e.g. to test with one phone).
  TG.SCAN_OWN_MESSAGES = false;

  // Logs every message a scan looks at (element, text, score or the reason
  // it was skipped) with console.debug. This prints message text to the
  // console, so it's off by default. Turn it on here, or without editing:
  // in WhatsApp's DevTools console run
  //   localStorage.setItem("trustgraph-debug-scan", "1")
  // (and removeItem to turn it off). Console "Verbose" level must be shown.
  TG.DEBUG_SCAN = false;

  TG.CHANNEL_LABELS = {
    whatsapp: "WhatsApp",
    gmail: "Gmail",
    messenger: "Messenger",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    telegram: "Telegram",
    discord: "Discord",
    slack: "Slack",
    generic: "Other sites",
    test: "Test page",
    other: "Other sites",
  };

  // Click-to-check on ANY website (content/universal.js): images, video,
  // canvas, CSS background images and text blocks, found without site
  // selectors. This ONE switch turns the whole new path off (false); the
  // site adapters, panel and scoring are not affected either way.
  TG.UNIVERSAL_CHECK = true;
  TG.UNIVERSAL = {
    minMedia: 120, // px: images/videos/canvases smaller than this (either side) get no shield
    minText: 40, // characters: shorter text blocks get no shield
    videoFrames: 8, // frames sampled from a video...
    videoSeconds: 4, // ...over this many seconds (while it plays; it is never seeked)
    maxSide: 640, // px: captured images are scaled down to this before sending
    jpegQuality: 0.85,
    timeoutMs: 30000, // the server may take a while to score frames on a CPU
  };

  TG.SIGNAL_NAMES = ["continuity", "similarity", "precedent", "anomaly"]; // the Python server's four

  // Message types passed between content scripts, pages and the background.
  TG.MSG = {
    SCORE: "score", // {text, channel, sender, noStats} -> {verdict, record, saved}
    SCORE_SERVER: "scoreServer", // server only, for a chat scan: {items: [{id, text}], channel}
    RECORD_RESULT: "recordResult", // a chat scan's verdict (no text): {verdict, channel} -> {record, saved}
    SET_SAVED: "setSaved", // {record, saved}: the panel's "Save to history" switch
    MARK_WRONG: "markWrong", // {id}: sends only the verdict id
    OPEN_WORKSPACE: "openWorkspace", // {id}
    GET_HISTORY: "getHistory",
    DELETE_RESULT: "deleteResult", // {id}
    DELETE_ALL: "deleteAll",
    EXPORT: "export", // {format: "json" | "csv"} -> {filename, mime, data}
    GET_OVERVIEW: "getOverview",
    GET_ACCOUNT: "getAccount",
    OPEN_AUTH: "openAuth", // {page: "login" | "register"}
    PAIR: "pair", // {code}
    USE_LOCAL: "useLocal",
    SIGN_OUT: "signOut",
    CHECK_SELECTION: "checkSelection", // popup: check the selected text in the active tab
    GET_SETTINGS: "getSettings",
    SET_SETTINGS: "setSettings",
    HEARTBEAT: "heartbeat",
    GET_STATUS: "getStatus",
    CLEAR_DATA: "clearData",
    // background -> content script
    SHOW_CHECKING: "showChecking",
    SHOW_RESULT: "showResult",
    // toolbar popup -> content script
    SELF_TEST: "selfTest",
    CAPTURE_SAMPLE: "captureSample", // Debug mode: anonymised HTML of the chat area, for calibrating an adapter
    // universal click-to-check (content/universal.js <-> background-universal.js)
    UNIVERSAL_CHECK: "universalCheck", // {kind: "text"|"image"|"video", text | payload, capture}
    UNIVERSAL_FETCH: "universalFetch", // {url}: an image downloaded by the background (no page CORS)
    UNIVERSAL_CAPTURE: "universalCapture", // {rect, viewportWidth, dpr}: screenshot crop of the visible tab
    UNIVERSAL_CARD: "universalCard", // a frame's result card, shown by the top frame ({desc} | {hide})
    UNIVERSAL_HEALTH: "universalHealth", // extension -> backend -> database round trip
  };

  root.TG = TG;
})(globalThis);
