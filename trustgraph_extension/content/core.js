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
  const Card = window.TrustGraphCard;
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
    if (!active) hideShield();
    if (active && !wasActive) {
      console.info(LOG, `${adapter.channel} adapter active on this page.`);
    }
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
  // Click: extract, check, show the verdict next to the message.
  // -------------------------------------------------------------------------
  function anchorFor(el) {
    const r = el.getBoundingClientRect();
    // Tall messages (e.g. a whole email): anchor near the top, by the shield.
    if (r.height > 240) {
      const top = Math.max(r.top, 0);
      return { top, left: r.left, right: r.right, bottom: top + SHIELD_SIZE + 8 };
    }
    return r;
  }

  shieldButton.addEventListener("mousedown", (event) => event.preventDefault()); // don't steal the site's focus/selection
  shieldButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (inFlight || !currentMessage || !adapter) return;

    const message = currentMessage;
    const text = TrustGraphKit.clean(safe(() => adapter.extractText(message), ""));
    if (!text) {
      Card.showEmpty(anchorFor(message));
      return;
    }

    inFlight = true;
    shieldButton.setAttribute("aria-busy", "true");
    Card.showChecking(anchorFor(message));
    try {
      const result = await send({ type: TG.MSG.SCORE, text, channel: adapter.channel });
      Card.showResult(result, message.isConnected ? anchorFor(message) : null, { text });
    } catch (_) {
      Card.showError("TrustGraph was updated or reloaded. Refresh this page and try again.", null);
    } finally {
      inFlight = false;
      shieldButton.removeAttribute("aria-busy");
    }
  });

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
    console.debug(LOG, `debug: ${messages.length} messages via strategy "${adapter.lastStrategy || "none"}"`);
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
    } else if (settings.debug && active && ticks % 3 === 0) {
      updateDebug(); // virtual lists add/remove messages as you scroll
    }
    // Heartbeat every HEARTBEAT_MS while a supported page is active and visible.
    if (active && document.visibilityState === "visible" && ticks % (TG.HEARTBEAT_MS / 1000) === 0) {
      send({ type: TG.MSG.HEARTBEAT, source: adapter.channel }).catch(() => {});
    }
  }, 1000);

  function teardown() {
    clearInterval(timer);
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
    });
  });

  evaluate(); // with defaults, so the shield works at once
  loadSettings(); // then with the user's settings
})();
