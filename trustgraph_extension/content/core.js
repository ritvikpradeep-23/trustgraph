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
  const Verdict = window.TrustGraphVerdict;
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

  // send() with a time limit: resolves null if there's no answer in `ms`.
  function sendWithin(message, ms) {
    return Promise.race([send(message).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
  }

  // -------------------------------------------------------------------------
  // Settings and activation
  // -------------------------------------------------------------------------
  async function loadSettings() {
    try {
      const fresh = await send({ type: TG.MSG.GET_SETTINGS });
      if (fresh && !fresh.error) settings = fresh;
    } catch (_) {
      // Keep defaults; the shield still works with the on-device rules.
    }
    Panel.setTheme(settings.theme);
    shieldHost.setAttribute("data-theme", settings.theme === "light" ? "light" : "dark");
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
    maybeAutoScan();
  }

  // Auto-scan (Settings → Scanning): scan the open chat in the background
  // with only the rail showing; the panel opens by itself for High risk.
  function maybeAutoScan() {
    if (!active || settings.scan_mode !== "auto" || !adapter.read || scan || Panel.isOpen()) return;
    const key = safe(() => adapter.chatKey(), null);
    if (!key || key === autoDismissedKey) return;
    startScan({ auto: true });
  }
  let autoDismissedKey = null;

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (settings.debug) console.warn(LOG, err);
      return fallback;
    }
  }

  // -------------------------------------------------------------------------
  // What a scan may send to the model, and why not. TG.DEBUG_SCAN (or
  // localStorage "trustgraph-debug-scan" = "1") logs each decision, with
  // the element and its text, so you can see why something was or wasn't
  // flagged. Off by default: it prints message text to the console.
  // -------------------------------------------------------------------------
  const URLS = /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)+\/\S*/giu;
  const NOT_WORDS = /[\s\p{P}\p{S}\p{M}\p{Cf}\p{Extended_Pictographic}\p{Regional_Indicator}]/gu;

  // null if the message should be scored, else the reason it's skipped.
  function skipReason(m) {
    if (m.type !== "text" || !m.text) return m.type === "media" ? "media without text" : m.type || "no text";
    if (m.direction === "outgoing" && !TG.SCAN_OWN_MESSAGES) return "own message";
    if (!adapter.scanFilters) return null;
    const text = m.text.trim();
    if (!text.replace(URLS, " ").replace(NOT_WORDS, "")) return text.match(URLS) ? "only links" : "only emoji or symbols";
    const words = text.split(/\s+/).filter(Boolean).length;
    if (text.length < TG.SCAN_MIN_CHARS && words < TG.SCAN_MIN_WORDS) return `too short (${text.length} chars, ${words} words)`;
    return null;
  }

  function debugScan() {
    if (TG.DEBUG_SCAN) return true;
    try {
      return localStorage.getItem("trustgraph-debug-scan") === "1";
    } catch (_) {
      return false;
    }
  }

  function logScan(el, text, outcome) {
    if (debugScan()) console.debug(LOG, "scan:", outcome, "|", el, "|", JSON.stringify(text || ""));
  }

  // Markers on the site's own message elements, so each is scored once
  // and you can see in DevTools what was scanned: data-trustgraph-scored
  // (its score), data-trustgraph-flagged, data-trustgraph-skipped (reason).
  const MARKS = ["data-trustgraph-scored", "data-trustgraph-flagged", "data-trustgraph-skipped"];
  function mark(el, name, value) {
    if (el && el.setAttribute) el.setAttribute(name, value);
  }
  function clearMarks() {
    for (const el of document.querySelectorAll(MARKS.map((a) => `[${a}]`).join(","))) for (const a of MARKS) el.removeAttribute(a);
  }

  // -------------------------------------------------------------------------
  // The shield: ONE floating button, reused for every message.
  // -------------------------------------------------------------------------
  const shieldHost = document.createElement("trustgraph-shield");
  shieldHost.style.cssText = "all: initial; position: fixed; z-index: 2147483646; top: 0; left: 0; display: none;";
  shieldHost.setAttribute("data-theme", "dark");
  const shieldRoot = shieldHost.attachShadow({ mode: "closed" });
  // Blue tile, white shield, soft glow; a pulsing ring while checking
  // (.tg-shield in shared/design.js).
  window.TrustGraphDesign.adopt(shieldRoot, ":host { all: initial; }");

  const shieldButton = window.TrustGraphUI.el("button", { type: "button", class: "tg-shield", "aria-label": "Check this message with TrustGraph", title: "Check this message with TrustGraph" }, [window.TrustGraphUI.icon("shieldCheck", { stroke: 2 })]);
  shieldRoot.appendChild(shieldButton);

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
    // A corner of the message (Settings → Shield position), nudged inside
    // it, kept on screen.
    const where = settings.shield_position || "top-right";
    const top = where === "bottom-right" ? Math.max(4, Math.min(window.innerHeight - SHIELD_SIZE - 4, rect.bottom - SHIELD_SIZE - 4)) : Math.max(4, rect.top + 4);
    const left = where === "top-left" ? Math.max(4, rect.left + 4) : Math.min(vw - SHIELD_SIZE - 4, rect.right - SHIELD_SIZE - 4);
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
      let message = safe(() => adapter.findMessage(target), null);
      let via = adapter.lastStrategy || "?";
      if (message && adapter.scanFilters && message !== currentMessage) {
        // No shield on messages a scan would skip (yours, too short, ...).
        const rec = safe(() => adapter.record(message), null);
        const why = rec ? skipReason(rec) : "not a message";
        if (why) {
          if (message !== lastSkipped) logScan(message, rec && rec.text, "no shield: " + why);
          lastSkipped = message;
          message = null;
        }
      }
      if (!message && adapter.fallback !== false) {
        // The site's own selectors found nothing (it may have changed its
        // HTML): fall back to any message-sized block of text in the chat
        // area, so single checks keep working on every supported site.
        message = safe(() => TrustGraphKit.textBlock(target, fallbackScope()), null);
        if (message) {
          fallbackEls.add(message);
          via = "fallback-text-block";
        }
      }
      if (message) {
        if (settings.debug && message !== currentMessage) {
          console.debug(LOG, `message found via strategy "${via}"`, message);
        }
        showShield(message);
      } else {
        hideShield();
      }
    });
  }

  let lastSkipped = null; // last hovered message that gets no shield (logged once)

  // Elements found by the fallback (read with the generic text reader).
  const fallbackEls = new WeakSet();
  // The chat area if the adapter knows it, else the whole page (navigation,
  // headers and inputs are always skipped).
  function fallbackScope() {
    const pane = adapter.messagePane ? safe(() => adapter.messagePane(), null) : null;
    return pane && pane !== document.body && pane !== document.documentElement ? pane : null;
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
    if (active && adapter.read && !Panel.isOpen() && (!adapter.hasChat || safe(() => adapter.hasChat(), true))) {
      Panel.launcher.show({
        channel: adapter.channel,
        avoid: adapter.chatHeader ? () => safe(() => adapter.chatHeader(), null) : null,
        onActivate: startScan,
      });
    } else Panel.launcher.hide();
  }
  Panel.onOpenChange = () => updateLauncher();

  // --- One message (hover shield) ------------------------------------------
  // rec (optional, from the adapter): {sender, senderName, links}. They let
  // the rules spot an unsaved number, a display name that doesn't match the
  // address, or a link that shows one site and opens another. Memory only.
  async function checkSingle(text, rec) {
    const sender = rec ? rec.sender || null : null;
    const extra = rec ? { senderName: rec.senderName || null, links: (rec.links || []).slice(0, 20).map((l) => ({ href: l.href, text: l.text || "" })) } : {};
    inFlight = true;
    shieldButton.setAttribute("aria-busy", "true");
    Panel.showChecking({}, layoutOpts());
    const context = { onRetry: () => checkSingle(text, rec) };
    // Never wait forever: after `ms` the page answers on its own.
    let timedOut = false;
    const ask = (ms) =>
      Promise.race([
        send({ type: TG.MSG.SCORE, text, channel: adapter.channel, sender, ...extra }),
        new Promise((r) => setTimeout(() => ((timedOut = true), r(null)), ms)),
      ]);
    let response = null;
    let problem = "";
    try {
      // The sender lets the rules weigh an unsaved number; it isn't stored.
      // A short scanning state (the pulsing ring) even when the answer is instant.
      [response] = await Promise.all([ask(TG.PAGE_WAIT_MS), new Promise((r) => setTimeout(r, 450))]);
      // An empty answer usually means Chrome was still waking TrustGraph's
      // background up: ask once more (not after a time-out).
      if (!timedOut && (!response || (!response.verdict && !response.error))) response = await ask(3000);
      if (timedOut) problem = "no answer in time";
    } catch (err) {
      problem = String((err && err.message) || err);
    }
    try {
      if (response && response.verdict) {
        Panel.showSingle(response, context, layoutOpts());
      } else {
        // Always an answer: score it right here with the on-device rules
        // (already loaded on this page), and say why.
        if (!problem) problem = response && response.error ? response.error : "no answer";
        console.warn(LOG, "background didn't answer the check:", problem);
        const verdict = await Verdict.LocalEngine.scoreMessage({ text, channel: adapter.channel, sender, ...extra }, { sensitivity: settings.sensitivity, status: "offline" });
        context.notice = /context invalidated/i.test(problem)
          ? "TrustGraph was updated: checked on this page only. Refresh the page to save results again."
          : "TrustGraph's background didn't answer, so this was checked on this page only (not saved). If this keeps happening, reload TrustGraph in chrome://extensions.";
        Panel.showSingle({ verdict }, context, layoutOpts());
      }
    } catch (err) {
      Panel.showSingle({ error: "Couldn't check this message here: " + String((err && err.message) || err) }, context, layoutOpts());
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
    const viaFallback = fallbackEls.has(message);
    const record = !viaFallback && adapter.record ? safe(() => adapter.record(message), null) : null;
    const extract = () => (viaFallback ? TrustGraphKit.text(message, "time, button, [aria-hidden='true']") : adapter.extractText(message));
    const text = TrustGraphKit.clean(record ? (record.subject ? `Subject: ${record.subject}\n` : "") + record.text : safe(extract, ""));
    stopScan(); // a single check replaces any chat scan in the panel
    if (!text) {
      Panel.showSingle({ verdict: { empty: true } }, {}, layoutOpts());
      return;
    }
    checkSingle(text, record);
  });

  // --- Whole chat (launcher) -----------------------------------------------
  // scan = {store, results: Map(id -> engine result), verdict, record, ...}
  // Results (with evidence snippets) live only here, in memory.
  let scan = null;

  function freshScanState(current) {
    current.results = new Map(); // id -> merged result (on-device rules + server)
    current.serverCache = new Map(); // id -> server answer, or null if none
    current.server = null; // "server" | "offline" | "error" | "local" once known
    current.verdictId = Verdict.newId(); // one verdict per chat scan
    current.record = null; // the saved Result (no text), once recorded
    current.saved = false;
    current.wrong = false;
    current.earlier = { running: false, label: "", reachedTop: false };
    current.notice = "";
    current.autoOpened = false;
    current.scored = new Set(); // ids already scored (each message once)
    current.skipped = new Set(); // ids skipped, logged once
    current.rescore = false; // Retry: score everything again
    clearMarks(); // nothing left over from the previous chat
  }

  // opts.auto: started by auto-scan (rail only until something is High).
  function startScan(opts = {}) {
    if (!adapter || !adapter.read) return;
    stopScan();
    const current = { busy: false, again: false, auto: !!opts.auto };
    freshScanState(current);
    current.store = new TrustGraphChatStore(adapter, {
      debug: settings.debug,
      onChange: (info) => {
        if (scan !== current) return;
        if (info.chatSwitched) {
          // A different chat: start its verdict from scratch.
          if (debugScan()) console.debug(LOG, "scan: chat switched, old results cleared");
          hideShield();
          freshScanState(current);
          renderScan("scanning");
        }
        scoreNew();
      },
    });
    scan = current;
    Panel.open({ ...layoutOpts(), collapsed: current.auto });
    current.store.start(); // read first, so "Read N messages" is right at once
    renderScan("scanning");
    scoreNew();
  }

  function stopScan() {
    if (!scan) return;
    scan.store.stop(); // forgets all message text
    scan = null;
    clearMarks();
  }

  // Messages worth scoring (see skipReason), with the context the rules
  // use: text from other people (your own messages aren't checked), the most recent
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
      const why = skipReason(m);
      if (why && !s.skipped.has(m.id)) {
        s.skipped.add(m.id);
        mark(m.element, "data-trustgraph-skipped", why);
        logScan(m.element, m.text, "skipped: " + why);
      }
      if (!why) {
        items.push({
          id: m.id,
          // Emails: include the subject so subject-line scams count.
          text: m.subject ? `Subject: ${m.subject}\n${m.text}` : m.text,
          sender: m.sender,
          senderName: m.senderName || null,
          timestamp: m.timestamp,
          links: (m.links || []).map((l) => ({ href: l.href, text: l.text || "" })),
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
        const fresh = items.filter((it) => !s.scored.has(it.id));
        // Only skipped messages arrived (or none): no new scoring pass.
        if (!fresh.length && s.verdict && !s.rescore) {
          renderScan("result");
          continue;
        }
        s.rescore = false;
        const local = TrustGraphEngine.analyzeChat(items);
        // Ask the server only about new messages, and not again once it's
        // known to be down (Retry clears that).
        const ask = s.server === "offline" || s.server === "local" ? [] : items.filter((it) => !s.serverCache.has(it.id));
        if (ask.length) {
          // If the background can't be reached, carry on with the on-device rules.
          const out = (await sendWithin({ type: TG.MSG.SCORE_SERVER, items: ask.map((it) => ({ id: it.id, text: it.text })), channel: adapter.channel }, TG.PAGE_WAIT_MS)) || { results: {}, server: "offline" };
          if (scan !== s) return; // closed or restarted meanwhile
          for (const it of ask) s.serverCache.set(it.id, (out.results || {})[it.id] || null);
          s.server = out.server;
        }
        const status = s.server === "local" ? "local" : s.server || "offline";
        s.results = new Map(items.map((it) => [it.id, TrustGraphEngine.combine(local[it.id], s.serverCache.get(it.id) || null, status)]));
        s.items = items;
        for (const it of items) {
          const r = s.results.get(it.id);
          const score = Math.round(((r && r.score) || 0) * 100);
          const el = s.store.elementFor(it.id);
          mark(el, "data-trustgraph-scored", String(score));
          if (score >= TG.FLAG_THRESHOLD) mark(el, "data-trustgraph-flagged", "");
          else if (el && el.removeAttribute) el.removeAttribute("data-trustgraph-flagged");
          if (!s.scored.has(it.id)) logScan(el, it.text, `scored ${score}/100 (${(r && r.band) || "?"})` + (score >= TG.FLAG_THRESHOLD ? ` >= ${TG.FLAG_THRESHOLD}: flagged` : ""));
          s.scored.add(it.id);
        }
        s.verdict = Verdict.aggregate(items, Object.fromEntries(s.results), { id: s.verdictId, sensitivity: settings.sensitivity, server: s.server || "offline" });
        if (s.store.readCount() && items.length) await recordVerdict(s);
        if (scan !== s) return;
        renderScan("result");
        if (s.auto && !s.autoOpened && s.verdict.riskLevel === "high" && Panel.isCollapsed()) {
          s.autoOpened = true;
          Panel.expand();
        }
      } while (s.again && scan === s);
    } catch (_) {
      if (scan === s) renderScan("error", "TrustGraph was updated or reloaded. Refresh this page and try again.");
    } finally {
      s.busy = false;
    }
  }

  // Count the chat's verdict once, and keep its saved Result in step if the
  // verdict rises as more messages are read. Only the verdict (no text)
  // crosses to the background.
  const RANK_L = { low: 0, caution: 1, high: 2 };
  async function recordVerdict(s) {
    const v = s.verdict;
    const summary = { id: v.id, riskLevel: v.riskLevel, score: v.score, signals: v.signals.map((x) => ({ id: x.id })) };
    if (!s.record) {
      const res = await sendWithin({ type: TG.MSG.RECORD_RESULT, verdict: summary, channel: adapter.channel }, 3000); // not saved, still shown
      if (res && res.record) {
        s.record = res.record;
        s.saved = !!res.saved;
      }
      return;
    }
    const changed = RANK_L[v.riskLevel] !== RANK_L[s.record.riskLevel] || v.score !== s.record.score || summary.signals.length !== s.record.signalIds.length;
    if (changed && s.saved) {
      const res = await sendWithin({ type: TG.MSG.RECORD_RESULT, verdict: summary, channel: adapter.channel, update: true }, 3000);
      if (res && res.record) s.record = res.record;
    }
  }

  // Builds the panel state for the chat.
  function renderScan(status, errorText) {
    const s = scan;
    if (!s) return;
    const read = s.store.readCount();
    if (status === "result" && (read === 0 || !s.verdict)) status = read === 0 ? "nothing" : "scanning";
    const byId = new Map(s.store.messages().map((m) => [m.id, m]));
    const messageMeta = {};
    for (const sig of (s.verdict && s.verdict.signals) || []) {
      const m = byId.get(sig.messageId);
      if (m) messageMeta[m.id] = { sender: m.sender || null, timeText: m.timeText || "" };
    }
    const earlierLabel = s.earlier.reachedTop ? " (from the start of the chat)" : "";

    Panel.render({
      mode: "chat",
      status,
      verdict: s.verdict,
      coverage: { read, scored: (s.items || []).length, label: `Read ${read} ${read === 1 ? "message" : "messages"} from this chat${earlierLabel}` },
      messageMeta,
      notice: s.notice,
      scanEarlier: {
        available: !!(adapter.scroller && safe(() => adapter.scroller(), null)) && !s.earlier.reachedTop,
        running: s.earlier.running,
        label: s.earlier.label,
      },
      record: s.record,
      saved: s.saved,
      wrong: s.wrong,
      errorText,
      on: {
        close: () => {
          if (s.auto) autoDismissedKey = s.store.chatKey; // don't auto-scan this chat again right away
          stopScan();
        },
        retry: () => {
          // Try the server again for everything it hasn't answered.
          for (const [id, r] of s.serverCache) if (!r) s.serverCache.delete(id);
          s.server = null;
          s.rescore = true;
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
        toggleSave: async (on) => {
          if (!s.record) return;
          // Saving again stores the current verdict, which may have risen.
          const record = { ...s.record, riskLevel: s.verdict.riskLevel, score: s.verdict.score, signalIds: s.verdict.signals.map((x) => x.id).slice(0, 8) };
          try {
            await send({ type: TG.MSG.SET_SAVED, record, saved: on });
            s.record = record;
            s.saved = on;
          } catch (_) {}
          if (scan === s) renderScan("result");
        },
        markWrong: async () => {
          try {
            await send({ type: TG.MSG.MARK_WRONG, id: s.verdict.id }); // the id, nothing else
          } catch (_) {}
          s.wrong = true;
          if (scan === s) renderScan("result");
        },
        openWorkspace: () => s.record && send({ type: TG.MSG.OPEN_WORKSPACE, id: s.record.id }).catch(() => {}),
      },
    });
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
    if (scan) safe(() => scan.store.tick());
    if (currentMessage && !currentMessage.isConnected) hideShield();
    if (!scan && active && settings.scan_mode === "auto" && ticks % 2 === 0) maybeAutoScan();
    // Chats that open without a URL change (LinkedIn pop-ups): show or hide
    // the scan button as conversations appear.
    if (active && adapter.hasChat && ticks % 2 === 0) updateLauncher();
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
    if (msg && msg.type === TG.MSG.CAPTURE_SAMPLE) {
      // Every letter becomes x and every digit 0 before anything leaves
      // this function (adapters/kit.js anonymizedHtml).
      const pane = adapter && adapter.messagePane ? safe(() => adapter.messagePane(), null) : null;
      const rootEl = pane || document.body;
      sendResponse({ channel: adapter ? adapter.channel : "unknown", host: location.hostname, path: location.pathname.replace(/[^/]+/g, (seg) => (seg.length > 12 ? "…" : seg)), strategy: adapter ? adapter.lastStrategy || null : null, count: adapter ? safe(() => adapter.selfTest(), 0) : 0, html: TrustGraphKit.anonymizedHtml(rootEl) });
      return;
    }
    if (!msg || msg.type !== TG.MSG.SELF_TEST) return;
    sendResponse({
      supported: !!adapter,
      channel: adapter ? adapter.channel : null,
      active,
      paused: !!settings.paused,
      sourceEnabled: adapter ? sourceEnabled(adapter) : false,
      count: adapter ? safe(() => adapter.selfTest(), 0) : 0,
      strategy: adapter ? adapter.lastStrategy || null : null,
      fallback: !!adapter && adapter.fallback !== false,
      debug: !!settings.debug,
      // Counts only (never text): rows in the DOM vs containers vs parsed.
      read: adapter && adapter.read ? safe(() => adapter.read().stats, null) : null,
    });
  });

  evaluate(); // with defaults, so the shield works at once
  loadSettings(); // then with the user's settings
})();
