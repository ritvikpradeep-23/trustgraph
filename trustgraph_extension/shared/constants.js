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

  TG.VERSION = "0.2.1";

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
    backend_url: "http://127.0.0.1:8000", // the scoring engine (TrustGraph Python server)
    webapp_url: "", // the TrustGraph web app; empty = the built-in mock
    demo_data: false,
    debug: false,
  };

  // Scoring-engine paths (on backend_url).
  TG.ENDPOINTS = {
    score: "/api/score", // POST {message_text, channel}
    settings: "/api/settings", // GET  (optional)
    status: "/api/status", // POST {source, ts} heartbeat (optional)
    dashboard: "/", // reachability check
  };

  // Web app paths (on webapp_url). Only verdicts and metadata go here,
  // never message text (see shared/result.js).
  TG.WEBAPP = {
    results: "/api/results", // POST Result, GET -> Result[]
    result: "/api/results/", // DELETE /api/results/:id
    export: "/api/export", // GET -> Result[]
    feedback: "/api/feedback", // POST {resultId}  ("Mark as wrong verdict")
    pair: "/api/extension/pair", // POST {code} -> {token, account: {name}}
    login: "/login?source=extension",
    register: "/register?source=extension",
    resultPage: "/results/", // + id: "Open in workspace"
  };

  TG.TIMEOUT_SCORE_MS = 3000; // short: we fall back to the on-device check quietly
  TG.TIMEOUT_SMALL_MS = 2000; // pings, settings, heartbeat, web app calls
  TG.SERVER_SETTINGS_MAX_AGE_MS = 60 * 1000;
  TG.HEARTBEAT_MS = 15 * 1000;
  TG.MAX_TEXT = 4000; // characters sent for one check
  TG.STATS_KEEP_DAYS = 90;
  TG.HISTORY_MAX = 2000; // newest kept when over
  TG.SERVER_CONCURRENCY = 4; // parallel /api/score calls during a chat scan
  TG.MAX_SCAN_MESSAGES = 40; // most recent incoming messages scored per scan

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
  };

  root.TG = TG;
})(globalThis);
