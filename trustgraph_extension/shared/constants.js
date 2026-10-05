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

  TG.VERSION = "0.1.0";

  // Settings the user can change. Only keys the user has actually changed are
  // saved in chrome.storage.local; everything else falls back to these.
  TG.DEFAULT_SETTINGS = {
    paused: false,
    mode: "point", // "point" = point and check. "auto" is coming later.
    sources: { whatsapp: true, gmail: true, messenger: true, instagram: true },
    minutes_per_check: 2,
    backend_url: "http://127.0.0.1:8000",
    debug: false,
  };

  // Every backend path lives here, so changing the server only means editing
  // this object. Only `score` exists on the server today; the rest are coded
  // against and fail gracefully until a teammate adds them.
  TG.ENDPOINTS = {
    score: "/api/score", // POST {message_text, channel}
    settings: "/api/settings", // GET  (not built yet)
    status: "/api/status", // POST {source, ts} heartbeat (not built yet)
    report: "/api/report", // POST {message_text, category} (not built yet)
    dashboard: "/", // opened from the toolbar popup
  };

  TG.TIMEOUT_SCORE_MS = 5000; // full analysis can take a moment
  TG.TIMEOUT_SMALL_MS = 2000; // pings, settings, heartbeat, report
  TG.SERVER_SETTINGS_MAX_AGE_MS = 60 * 1000;
  TG.HEARTBEAT_MS = 15 * 1000;
  TG.MAX_TEXT = 4000; // characters sent for one check
  TG.STATS_KEEP_DAYS = 90;
  TG.SERVER_CONCURRENCY = 4; // parallel /api/score calls during a chat scan
  TG.MAX_SCAN_MESSAGES = 40; // most recent incoming messages scored per scan

  // Band colors and card titles. The band word is always shown as text too,
  // so the verdict never relies on color alone.
  TG.BANDS = {
    Low: { color: "#1C8A5A", title: "Looks OK" },
    Caution: { color: "#B8860B", title: "TrustGraph: possible scam" },
    High: { color: "#E63946", title: "TrustGraph: likely scam" },
  };

  TG.CHANNEL_LABELS = {
    whatsapp: "WhatsApp Web",
    gmail: "Gmail",
    messenger: "Facebook Messenger",
    instagram: "Instagram DMs",
    test: "the test page",
    other: "other sites",
  };

  TG.SIGNAL_NAMES =["continuity", "similarity", "precedent", "anomaly"];

  TG.TEXT = {
    basicLabel:
      "Basic check (offline). Start the TrustGraph server for the full analysis.",
    serverErrorLabel:
      "The TrustGraph server returned an error, so this is a Basic check.",
    nothingToCheck: "Nothing to check here",
    nothingToCheckDetail:
      "This message has no text (it may be an image, sticker, or voice note).",
    checking: "Checking…",
    reportConsent: "This message will be added to the shared scam database.",
    reportOk: "Added. Similar messages will now be flagged.",
    reportUnavailable: "Reporting isn't available right now.",
  };

  // Message types passed between content scripts, pages and the background.
  TG.MSG = {
    SCORE: "score",
    SCORE_BATCH: "scoreBatch", // a whole chat: {items: [{id, text}], channel, count}
    REPORT: "report",
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
  };

  root.TG = TG;
})(globalThis);
