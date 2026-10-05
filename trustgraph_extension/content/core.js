// TrustGraph content script core: hover detection, the shield button,
// click-to-check, debug outlines, heartbeat, and the toolbar popup's
// "Recognizing N messages" self-test.
//
// Privacy: nothing is read or sent on hover. Text is extracted and sent to
// the background only after the user clicks the shield.
(function () {
  "use strict";
  if (window.__trustgraphCoreLoaded) return;
  window.__trustgraphCoreLoaded = true;

  const TG = window.TG;
  const Panel = window.TrustGraphPanel;
  const RANK = { Low: 0, Caution: 1, High: 2 };
  const ADAPTERS = window.TrustGraphAdapters || [];
  const SHIELD_SIZE = 30;
  const LOG = "[TrustGraph]";

  let settings = TG.DEFAULT_SETTINGS;
  let adapter = null; // adapter for the current URL, if any
  let active = false; // adapter present AND not paused AND its source is on
  let lastHref = location.href;
  let currentMessage = null; // message the shield is attached to
  let inFlight = false;
  let contextAlive = true; // false after the extension is reloaded/updated

  // -------------------------------------------------------------------------
  // Talking to the background. After the extension is reloaded, this old
  // content script loses its connection; we then go quiet instead of erroring.
  // -------------------------------------------------------------------------
  async function send(message) {
    if (!contextAlive) throw new Error("context invalidated");
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      if (String(err && err.message).includes("context invalidated")) {
        contextAlive = false;
        teardown();
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Settings and activation
  // -------------------------------------------------------------------------
  async function loadSettings() {
    try {
      const fresh = await send({ type: TG.MSG.GET_SETTINGS });
      if (fresh && !fresh.error) settings = fresh;
    } catch (_) {
      // Keep defaults; the shield still works with the Basic check.
    }
    evaluate();
  }

  function sourceEnabled(a) {
    // Channels without a toggle (e.g. "test") are always on.
    return !(a.channel in settings.sources) || settings.sources[a.channel] !== false;
  }

  // Re-checks which adapter applies to the current URL and whether it's on.
  function evaluate() {
    adapter = ADAPTERS.find((a) => safe(() => a.matches(location.href), false)) || null;
    const wasActive = active;
    active = !!adapter && !settings.paused && sourceEnabled(adapter);
    if (!active) {
      hideShield();
      stopScan();
    }
    if (active && !wasActive) {
      console.info(LOG, `${adapter.channel} adapter active on this page.`);
    }
    updateLauncher();
    updateDebug();
  }

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (settings.debug) console.warn(LOG, err);
      return fallback;
    }
  }

  // -------------------------------------------------------------------------
  // The shield: ONE floating button, reused for every message.
  // -------------------------------------------------------------------------
  const shieldHost = document.createElement("trustgraph-shield");
  shieldHost.style.cssText = "all: initial; position: fixed; z-index: 2147483646; top: 0; left: 0; display: none;";
  const shieldRoot = shieldHost.attachShadow({ mode: "closed" });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      button {
        all: initial; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
        width: ${SHIELD_SIZE}px; height: ${SHIELD_SIZE}px; border-radius: 50%; cursor: pointer;
        background: #1e2761; color: #fff; border: 2px solid #fff;
        box-shadow: 0 2px 8px rgba(20, 26, 60, .35);
        transition: transform 120ms ease-out;
      }
      button:hover { transform: scale(1.08); }
      button:focus-visible { outline: 3px solid #2f6fed; outline-offset: 2px; }
      button[aria-busy="true"] { opacity: .6; cursor: progress; }
      svg { width: 16px; height: 16px; display: block; pointer-events: none; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } button:hover { transform: none; } }
    `);
    shieldRoot.adoptedStyleSheets = [sheet];
  } catch (_) {}

  const shieldButton = document.createElement("button");
  shieldButton.type = "button";
  shieldButton.setAttribute("aria-label", "Check this message with TrustGraph");
  shieldButton.title = "Check this message with TrustGraph";
  shieldButton.appendChild(shieldIcon());
  shieldRoot.appendChild(shieldButton);

  // Shield-with-check icon, built with DOM calls (no innerHTML).
  function shieldIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const shield = document.createElementNS(NS, "path");
    shield.setAttribute("d", "M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z");
    shield.setAttribute("fill", "currentColor");
    const check = document.createElementNS(NS, "path");
    check.setAttribute("d", "m8.5 12.2 2.4 2.4 4.8-5");
    check.setAttribute("fill", "none");
    check.setAttribute("stroke", "#1e2761");
    check.setAttribute("stroke-width", "2.2");
    check.setAttribute("stroke-linecap", "round");
    check.setAttribute("stroke-linejoin", "round");
    svg.append(shield, check);
    return svg;
  }

  function ensureShieldInDom() {
    if (!shieldHost.isConnected) document.documentElement.appendChild(shieldHost);
  }

  function showShield(messageEl) {
    if (currentMessage === messageEl && shieldHost.style.display !== "none") return;
    currentMessage = messageEl;
    ensureShieldInDom();
    placeShield();
  }

  function placeShield() {
    if (!currentMessage || !currentMessage.isConnected) return hideShield();
    const rect = currentMessage.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    // Top-right corner of the message, nudged inside it, kept on screen.
    const top = Math.max(4, rect.top + 4);
    const left = Math.min(vw - SHIELD_SIZE - 4, rect.right - SHIELD_SIZE - 4);
    if (rect.bottom < 0 || rect.top > window.innerHeight) return hideShield();
    shieldHost.style.top = top + "px";
    shieldHost.style.left = left + "px";
    shieldHost.style.display = "block";
  }

  function hideShield() {
    if (inFlight) return; // keep it while a check is running
    shieldHost.style.display = "none";
    currentMessage = null;
  }

  // -------------------------------------------------------------------------
  // Hover / focus detection: one delegated listener, throttled to one
  // lookup per animation frame. Survives SPA navigation and virtual lists.
  // -------------------------------------------------------------------------
  let pendingTarget = null;
  let frameRequested = false;

  function onPointerOrFocus(event) {
    if (!active) return;
    pendingTarget = event.target;
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      const target = pendingTarget;
      pendingTarget = null;
      if (!target || !active) return;
      if (target === shieldHost) return; // pointer moved onto the shield itself
      const message = safe(() => adapter.findMessage(target), null);
      if (message) {
        if (settings.debug && message !== currentMessage) {
          console.debug(LOG, `message found via strategy "${adapter.lastStrategy || "?"}"`, message);
        }
        showShield(message);
      } else {
        hideShield();
      }
    });
  }

  document.addEventListener("mouseover", onPointerOrFocus, true);
  document.addEventListener("focusin", onPointerOrFocus, true); // keyboard users

  // Keep the shield glued to its message while the page scrolls.
  let scrollFrame = false;
  document.addEventListener(
    "scroll",
    () => {
      if (!currentMessage || scrollFrame) return;
      scrollFrame = true;
      requestAnimationFrame(() => {
        scrollFrame = false;
        placeShield();
      });
    },
    { capture: true, passive: true }
  );

  // -------------------------------------------------------------------------
  // The panel: layout for this site, single-message checks, chat scans.
  // -------------------------------------------------------------------------
  // On supported sites the panel pushes the page aside and must keep the
  // message list uncovered.
  function layoutOpts() {
    return {
      push: !!(adapter && active && adapter.push),
      pane: adapter && adapter.messagePane ? safe(() => adapter.messagePane(), null) : null,
      target: adapter && adapter.pushTarget ? safe(() => adapter.pushTarget(), null) : null,
      debug: !!settings.debug,
    };
  }
  Panel.layoutForPage = () => (adapter && active ? layoutOpts() : {});

  // The launcher shows while a supported chat page is active and the panel
  // is closed.
  function updateLauncher() {
    if (active && adapter.read && !Panel.isOpen()) {
      Panel.launcher.show({
        channel: adapter.channel,
        avoid: adapter.chatHeader ? () => safe(() => adapter.chatHeader(), null) : null,
        onActivate: startScan,
      });
    } else Panel.launcher.hide();
  }
  Panel.onOpenChange = () => updateLauncher();

  // --- One message (hover shield) ------------------------------------------
  async function checkSingle(text, sender) {
    inFlight = true;
    shieldButton.setAttribute("aria-busy", "true");
    Panel.showChecking({}, layoutOpts());
    const context = { text, sender, onRetry: () => checkSingle(text, sender) };
    try {
      // The sender lets the rules weigh an unsaved number; it isn't stored.
      const result = await send({ type: TG.MSG.SCORE, text, channel: adapter.channel, sender });
      Panel.showSingle(result, context, layoutOpts());
    } catch (_) {
      Panel.showSingle({ error: "TrustGraph was updated or reloaded. Refresh this page and try again." }, {}, layoutOpts());
    } finally {
      inFlight = false;
      shieldButton.removeAttribute("aria-busy");
    }
  }

  shieldButton.addEventListener("mousedown", (event) => event.preventDefault()); // don't steal the site's focus/selection
  shieldButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (inFlight || !currentMessage || !adapter) return;
    const message = currentMessage;
    const record = adapter.record ? safe(() => adapter.record(message), null) : null;
    const text = TrustGraphKit.clean(record ? record.text : safe(() => adapter.extractText(message), ""));
    stopScan(); // a single check replaces any chat scan in the panel
    if (!text) {
      Panel.showSingle({ empty: true }, {}, layoutOpts());
      return;
    }
    checkSingle(text, record ? record.sender : null);
  });

  // --- Whole chat (launcher) -----------------------------------------------
  // scan = {store, results: Map(id -> result), server, report, earlier, ...}
  // Results (with evidence snippets) live only here, in memory.
  let scan = null;

  function startScan() {
    if (!adapter || !adapter.read) return;
    stopScan();
    const current = {
      results: new Map(), // id -> merged result (on-device rules + server)
      serverCache: new Map(), // id -> server answer, or null if none
      server: null, // "server" | "offline" | "error" once known
      counted: false,
      busy: false,
      again: false,
      report: { state: "idle", count: 0 },
      earlier: { running: false, label: "", reachedTop: false },
      notice: "",
    };
    current.store = new TrustGraphChatStore(adapter, {
      debug: settings.debug,
      onChange: (info) => {
        if (scan !== current) return;
        if (info.chatSwitched) {
          // A different chat: start its verdict from scratch.
          current.results.clear();
          current.serverCache.clear();
          current.server = null;
          current.counted = false;
          current.report = { state: "idle", count: 0 };
          current.earlier = { running: false, label: "", reachedTop: false };
          current.notice = "";
          renderScan("scanning");
        }
        scoreNew();
      },
    });
    scan = current;
    Panel.open(layoutOpts());
    current.store.start(); // read first, so "Read N messages" is right at once
    renderScan("scanning");
    scoreNew();
  }

  function stopScan() {
    if (!scan) return;
    scan.store.stop(); // forgets all message text
    scan = null;
  }

  // Messages worth scoring, with the context the rules use: text from
  // other people (your own messages aren't checked), the most recent
  // MAX_SCAN_MESSAGES. For each: how many earlier messages this sender has
  // in the chat, and whether it continues a run from the same sender
  // (within 5 minutes, no reply in between).
  function candidates(s) {
    const counts = {};
    const items = [];
    let prev = null;
    for (const m of s.store.messages()) {
      if (m.type === "date" || m.type === "system") {
        prev = null;
        continue;
      }
      const key = m.direction === "outgoing" ? "\u0000me" : m.sender || "\u0000them";
      const history = counts[key] || 0;
      counts[key] = history + 1;
      const sameRun = !!prev && prev.key === key && (!(m.timestamp && prev.ts) || m.timestamp - prev.ts <= 5 * 60 * 1000);
      if (m.type === "text" && m.text && m.direction !== "outgoing") {
        items.push({
          id: m.id,
          // Emails: include the subject so subject-line scams count.
          text: m.subject ? `Subject: ${m.subject}\n${m.text}` : m.text,
          sender: m.sender,
          timestamp: m.timestamp,
          links: (m.links || []).map((l) => l.href),
          senderHistory: history,
          prevSameSender: sameRun,
          inChat: true,
        });
      }
      prev = { key, ts: m.timestamp };
    }
    return items.slice(-TG.MAX_SCAN_MESSAGES);
  }

  // One pass: the on-device rules over the whole conversation (instant, in
  // this page), then the server for messages it hasn't seen yet. Re-entrant
  // calls queue one more pass instead of overlapping.
  async function scoreNew() {
    const s = scan;
    if (!s) return;
    if (s.busy) {
      s.again = true;
      return;
    }
    s.busy = true;
    try {
      do {
        s.again = false;
        const items = candidates(s);
        const local = TrustGraphEngine.analyzeChat(items);
        // Ask the server only about new messages, and not again once it's
        // known to be down (Retry clears that).
        const ask = s.server === "offline" ? [] : items.filter((it) => !s.serverCache.has(it.id));
        if (ask.length) {
          const out = await send({ type: TG.MSG.SCORE_SERVER, items: ask.map((it) => ({ id: it.id, text: it.text })), channel: adapter.channel });
          if (scan !== s) return; // closed or restarted meanwhile
          for (const it of ask) s.serverCache.set(it.id, (out.results || {})[it.id] || null);
          s.server = out.server;
        }
        s.results = new Map(items.map((it) => [it.id, TrustGraphEngine.combine(local[it.id], s.serverCache.get(it.id) || null, s.server || "offline")]));
        if (!s.counted && s.store.readCount()) {
          // A chat scan counts as one check (counts only, no text).
          s.counted = true;
          const worst = [...s.results.values()].reduce((w, r) => (RANK[r.band] > RANK[w] ? r.band : w), "Low");
          send({ type: TG.MSG.RECORD_CHECK, channel: adapter.channel, band: worst }).catch(() => {});
        }
        renderScan("result");
      } while (s.again && scan === s);
    } catch (_) {
      if (scan === s) renderScan("error", "TrustGraph was updated or reloaded. Refresh this page and try again.");
    } finally {
      s.busy = false;
    }
  }

  // Builds the panel state for the chat from the per-message results.
  function renderScan(status, errorText) {
    const s = scan;
    if (!s) return;
    const messages = s.store.messages();
    const byId = new Map(messages.map((m) => [m.id, m]));
    const read = s.store.readCount();
    let band = "Low";
    let top = null;
    let anyBasic = false;
    const flags = [];
    const seen = new Set();
    for (const [id, r] of s.results) {
      if (r.source !== "server") anyBasic = true;
      if (!top || r.score > top.score) top = r;
      if (RANK[r.band] > RANK[band]) band = r.band;
      for (const f of r.flags || []) {
        // A flag points at the message its evidence came from (a run of
        // messages can put flags on earlier bubbles).
        const mid = f.messageId || id;
        const key = `${f.ruleId}|${mid}|${f.evidence ? f.evidence.start : ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = byId.get(mid) || {};
        flags.push({
          key: mid + "-" + f.ruleId,
          title: f.title,
          reason: f.reason,
          evidence: f.evidence ? f.evidence.text : Panel.snippet(m.text),
          severity: f.severity,
          sender: m.sender || null,
          timeText: m.timeText || "",
          messageId: mid,
        });
      }
    }
    const SEV = { high: 0, medium: 1, low: 2 };
    flags.sort((a, b) => (SEV[a.severity] ?? 1) - (SEV[b.severity] ?? 1));
    const serverResult = [...s.results.values()].find((r) => r.source === "server");
    const scoredCount = s.results.size;
    const source = scoredCount ? (anyBasic ? "basic" : "server") : s.server && s.server !== "server" ? "basic" : "server";
    const earlierLabel = s.earlier.reachedTop ? " (from the start of the chat)" : "";

    if (status === "result" && read === 0) status = "nothing";

    Panel.render({
      mode: "chat",
      status,
      band,
      coverage: { read, scored: scoredCount, label: `Read ${read} ${read === 1 ? "message" : "messages"} from this chat${earlierLabel}` },
      source,
      server: s.server || "server",
      flags,
      signals: (top && top.source === "server" ? top : serverResult || {}).signals || [],
      explanation: top ? top.explanation : "",
      score: top ? top.score : null,
      contributions: top ? top.contributions : [],
      weakSignals: [...new Set([...s.results.values()].flatMap((r) => r.weakSignals || []))],
      notice: s.notice,
      scanEarlier: {
        available: !!(adapter.scroller && safe(() => adapter.scroller(), null)) && !s.earlier.reachedTop,
        running: s.earlier.running,
        label: s.earlier.label,
      },
      report: s.report,
      errorText,
      on: {
        close: () => stopScan(),
        retry: () => {
          // Try the server again for everything it hasn't answered.
          for (const [id, r] of s.serverCache) if (!r) s.serverCache.delete(id);
          s.server = null;
          renderScan("scanning");
          scoreNew();
        },
        scanEarlier: async () => {
          s.earlier = { running: true, label: "Scanning earlier messages…", reachedTop: false };
          renderScan("result");
          const res = await s.store.scanEarlier({
            onProgress: (p) => {
              s.earlier.label = `Scanning earlier messages… ${p.added} found`;
              if (scan === s) renderScan("result");
            },
          });
          if (scan !== s) return;
          s.earlier = { running: false, label: "", reachedTop: res.reachedTop };
          scoreNew();
        },
        jump: (id) => {
          const ok = Panel.jumpTo(s.store.elementFor(id));
          s.notice = ok ? "" : "That message has scrolled out of view. Scroll the chat to find it.";
          renderScan("result");
        },
        report: () => {
          s.report = { state: "confirm", count: reportTexts(s).length };
          renderScan("result");
        },
        reportCancel: () => {
          s.report = { state: "idle", count: 0 };
          renderScan("result");
        },
        reportConfirm: async () => {
          const texts = reportTexts(s);
          s.report = { state: "sending", count: texts.length };
          renderScan("result");
          let ok = texts.length > 0;
          for (const text of texts) {
            try {
              const res = await send({ type: TG.MSG.REPORT, text });
              ok = ok && !!(res && res.ok);
            } catch (_) {
              ok = false;
            }
          }
          if (scan !== s) return;
          s.report = { state: ok ? "sent" : "unavailable", count: texts.length };
          renderScan("result");
        },
      },
    });
  }

  // What "Report as scam" sends: the flagged messages (up to 5), or the
  // latest message from someone else if nothing was flagged.
  function reportTexts(s) {
    const flagged = candidates(s).filter((m) => {
      const r = s.results.get(m.id);
      return r && RANK[r.band] > 0;
    });
    const pick = flagged.length ? flagged.slice(-5) : candidates(s).slice(-1);
    return pick.map((m) => m.text);
  }

  // -------------------------------------------------------------------------
  // Debug mode: outline every message the adapter recognizes.
  // -------------------------------------------------------------------------
  let debugSheet = null;

  function updateDebug() {
    const on = active && settings.debug;
    for (const el of document.querySelectorAll("[data-trustgraph-debug]")) {
      if (!on) el.removeAttribute("data-trustgraph-debug");
    }
    if (!on) {
      if (debugSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== debugSheet);
      debugSheet = null;
      return;
    }
    if (!debugSheet) {
      debugSheet = new CSSStyleSheet();
      debugSheet.replaceSync(
        "[data-trustgraph-debug] { outline: 2px dashed #e63946 !important; outline-offset: -2px !important; }"
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, debugSheet];
    }
    const messages = adapter.listMessages ? safe(() => adapter.listMessages(), []) : [];
    for (const el of messages) el.setAttribute("data-trustgraph-debug", adapter.lastStrategy || "");
    // Counts and skip reasons only; message text is never logged.
    const stats = adapter.read ? safe(() => adapter.read().stats, null) : null;
    console.debug(
      LOG,
      `debug: ${messages.length} messages via strategy "${adapter.lastStrategy || "none"}"` +
        (stats ? ` | rows ${stats.rows}, containers ${stats.containers}, parsed ${stats.parsed}, skipped ${JSON.stringify(stats.skipped)}` : "")
    );
  }

  // -------------------------------------------------------------------------
  // Timers: URL changes (SPA navigation), debug refresh, heartbeat.
  // A content script can't hook history.pushState (isolated world), so we
  // just compare location.href once a second; it's cheap.
  // -------------------------------------------------------------------------
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    if (location.href !== lastHref) {
      lastHref = location.href;
      hideShield();
      evaluate();
    }
    // Chat switched without a URL change (WhatsApp): the store resets itself.
    if (scan && safe(() => adapter.chatKey(), null) !== scan.store.chatKey) scan.store.refresh();
    if (settings.debug && active && ticks % 3 === 0) {
      updateDebug(); // virtual lists add/remove messages as you scroll
    }
    // Heartbeat every HEARTBEAT_MS while a supported page is active and visible.
    if (active && document.visibilityState === "visible" && ticks % (TG.HEARTBEAT_MS / 1000) === 0) {
      send({ type: TG.MSG.HEARTBEAT, source: adapter.channel }).catch(() => {});
    }
  }, 1000);

  function teardown() {
    clearInterval(timer);
    stopScan();
    Panel.launcher.hide();
    active = false;
    shieldHost.remove();
    document.removeEventListener("mouseover", onPointerOrFocus, true);
    document.removeEventListener("focusin", onPointerOrFocus, true);
  }

  // React to settings changes (pause, source toggles, debug) immediately.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.settings || changes.server_settings)) loadSettings();
  });

  // The toolbar popup asks what this page supports.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== TG.MSG.SELF_TEST) return;
    sendResponse({
      supported: !!adapter,
      channel: adapter ? adapter.channel : null,
      active,
      paused: !!settings.paused,
      sourceEnabled: adapter ? sourceEnabled(adapter) : false,
      count: adapter ? safe(() => adapter.selfTest(), 0) : 0,
      strategy: adapter ? adapter.lastStrategy || null : null,
      // Counts only (never text): rows in the DOM vs containers vs parsed.
      read: adapter && adapter.read ? safe(() => adapter.read().stats, null) : null,
    });
  });

  evaluate(); // with defaults, so the shield works at once
  loadSettings(); // then with the user's settings
})();
