// Universal click-to-check: one shield on a block of text on ANY website,
// in every frame, with no site selectors, hostnames or class names.
//
//   What counts as checkable (found under the pointer, see textAt()): a
//   visible block of at least TG.UNIVERSAL.minText characters
//   (TrustGraphKit.textBlock), only where no site adapter already handles
//   the page, so WhatsApp, Gmail, etc. behave exactly as before.
//
//   Text only: images and videos are never read, downloaded or captured.
//
// Nothing is read until the shield is clicked. The UI lives in a closed
// shadow root on a fixed, pointer-events:none host, so the site's CSS can't
// reach it and it can't move the site's layout or swallow its scrolling,
// clicks or video controls. Off when TG.UNIVERSAL_CHECK is false.
(function () {
  "use strict";
  const TG = window.TG;
  if (!TG || !TG.UNIVERSAL_CHECK || window.__trustgraphUniversal) return;
  window.__trustgraphUniversal = true;

  const CFG = TG.UNIVERSAL;
  const UI = window.TrustGraphUI;
  const kit = window.TrustGraphKit;
  const SHIELD = 30;
  const KIND_LABEL = { text: "Text check" };

  let settings = { paused: false, theme: "dark" };
  let current = null; // {el, kind} under the pointer
  let busy = false;
  let alive = true;

  // ---------------------------------------------------------------------
  // Talking to the background
  // ---------------------------------------------------------------------
  async function send(message) {
    if (!alive) throw new Error("TrustGraph was reloaded. Refresh this page.");
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      if (String(err && err.message).includes("context invalidated")) {
        alive = false;
        host.remove();
      }
      throw err;
    }
  }

  function loadSettings() {
    send({ type: TG.MSG.GET_SETTINGS })
      .then((s) => {
        if (s && !s.error) settings = s;
        host.setAttribute("data-theme", settings.theme === "light" ? "light" : "dark");
        if (settings.paused) hideShield();
      })
      .catch(() => {});
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) loadSettings();
  });

  // Same switch as the chat scan log (content/core.js): in DevTools run
  // localStorage.setItem("trustgraph-debug-scan", "1"). Logs what got a
  // shield and each result's summary (never the content itself).
  function debug(...args) {
    try {
      if (TG.DEBUG_SCAN || localStorage.getItem("trustgraph-debug-scan") === "1") console.debug("[TrustGraph universal]", ...args);
    } catch (_) {
      // storage blocked in this frame
    }
  }

  // A site adapter (content/core.js) already offers text checks here.
  function adapterActive() {
    return (window.TrustGraphAdapters || []).some((a) => {
      try {
        return a.matches(location.href);
      } catch (_) {
        return false;
      }
    });
  }

  // ---------------------------------------------------------------------
  // What's under the pointer
  // ---------------------------------------------------------------------
  function textAt(target) {
    if (!target || target.nodeType !== 1 || adapterActive()) return null;
    if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return null;
    const el = kit.textBlock(target, null, { min: CFG.minText });
    return el ? { el, kind: "text" } : null;
  }

  // ---------------------------------------------------------------------
  // The UI: a shield on the content and a result card, in one closed
  // shadow root on a pointer-events:none host.
  // ---------------------------------------------------------------------
  const host = document.createElement("trustgraph-universal");
  host.style.cssText = "all: initial; position: fixed; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none;";
  host.setAttribute("data-theme", "dark");
  const root = host.attachShadow({ mode: "closed" });
  window.TrustGraphDesign.adopt(
    root,
    `:host { all: initial; }
    .shield { position: fixed; display: none; pointer-events: auto; }
    .card { position: fixed; right: 16px; bottom: 16px; width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; display: none; pointer-events: auto;
      background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 12px 40px rgba(2, 6, 17, .45);
      font: 14px/1.5 var(--font-body, system-ui, sans-serif); padding: 14px 16px; box-sizing: border-box; }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .head .title { font: 600 15px/1.2 var(--font-display, system-ui, sans-serif); flex: 1; }
    .head svg { width: 18px; height: 18px; color: var(--accent-light); }
    .row { display: grid; grid-template-columns: 22px 1fr; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); }
    .row svg { width: 18px; height: 18px; color: var(--text-muted); margin-top: 2px; }
    .row b { display: block; font-weight: 600; }
    .row span { color: var(--text-muted); }
    .row .chip { margin-bottom: 6px; }
    .match b { color: var(--high); }
    .note { color: var(--text-dim); font-size: 12px; margin-top: 8px; }
    .busy { color: var(--text-muted); }`
  );
  const shield = UI.el("button", { type: "button", class: "tg-shield shield", "aria-label": "Check this with TrustGraph", title: "Check this with TrustGraph" }, [UI.icon("shieldCheck", { stroke: 2 })]);
  const card = UI.el("div", { class: "card", role: "dialog", "aria-label": "TrustGraph result" });
  root.append(shield, card);

  function ensureHost() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }

  function placeShield() {
    if (!current || !current.el.isConnected) return hideShield();
    const r = current.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width === 0) return hideShield();
    // Top-right, like the chat shield.
    const left = Math.min(innerWidth - SHIELD - 4, r.right - SHIELD - 6);
    shield.style.left = Math.max(4, left) + "px";
    shield.style.top = Math.max(4, Math.min(innerHeight - SHIELD - 4, r.top + 6)) + "px";
    shield.style.display = "grid";
  }

  function showShield(hit) {
    ensureHost();
    debug("shield on", hit.kind, hit.el.tagName, hit.el);
    current = hit;
    placeShield();
  }

  function hideShield() {
    if (busy) return;
    shield.style.display = "none";
    current = null;
  }

  // Hover: one lookup per animation frame, from the pointer position.
  let point = null;
  let frame = 0;
  let hideTimer = 0;
  function onPointer(e) {
    if (!alive || settings.paused || busy) return;
    if (e.composedPath && e.composedPath().includes(host)) return; // over our own shield/card
    point = { x: e.clientX, y: e.clientY, target: (e.composedPath && e.composedPath()[0]) || e.target };
    if (!frame) frame = requestAnimationFrame(locate);
  }
  function locate() {
    frame = 0;
    if (!point) return;
    const hit = textAt(point.target);
    if (hit) {
      clearTimeout(hideTimer);
      hideTimer = 0;
      if (!current || current.el !== hit.el) showShield(hit);
    } else if (current && !hideTimer) {
      hideTimer = setTimeout(() => {
        hideTimer = 0;
        hideShield();
      }, 350); // time to reach the shield
    }
  }
  document.addEventListener("pointermove", onPointer, { capture: true, passive: true });
  document.addEventListener("scroll", () => current && requestAnimationFrame(placeShield), { capture: true, passive: true });
  addEventListener("resize", () => current && placeShield(), { passive: true });
  shield.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  shield.addEventListener("mousedown", (e) => e.preventDefault());
  shield.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (current && !busy) runCheck(current);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && card.style.display !== "none" && !busy) card.style.display = "none";
  });

  // ---------------------------------------------------------------------
  // Check + result card
  // ---------------------------------------------------------------------
  // The card is described as plain data so a frame can hand it to the top
  // page: inside an embed it would cover the very content around it.
  //   {kind, rows: [{icon, title, detail, cls, chip: {level, text}} | {busy}], note}
  function drawCard(desc) {
    const rows = (desc.rows || []).map((r) =>
      r.busy
        ? UI.el("div", { class: "busy", text: r.busy })
        : UI.el("div", { class: "row " + (r.cls || "") }, [
            UI.icon(r.icon),
            UI.el("div", {}, [r.chip ? UI.el("div", { class: "chip" }, [UI.chip(r.chip.level, { text: r.chip.text })]) : UI.el("b", { text: r.title }), r.detail ? UI.el("span", { text: r.detail }) : null]),
          ])
    );
    card.replaceChildren(
      ...[UI.el("div", { class: "head" }, [UI.icon("messageCircle"), UI.el("span", { class: "title", text: "TrustGraph · " + KIND_LABEL[desc.kind] }), UI.iconButton("x", "Close", () => (card.style.display = "none"))]),
      ...rows,
      desc.note ? UI.el("div", { class: "note", text: desc.note }) : null].filter(Boolean)
    );
    ensureHost();
    card.style.display = "block";
  }
  let relayFailed = false;
  function renderCard(kind, rows, note) {
    const desc = { kind, rows, note };
    if (window === window.top || relayFailed) return drawCard(desc);
    send({ type: TG.MSG.UNIVERSAL_CARD, desc })
      .then((res) => {
        if (!res || !res.ok) throw new Error("no top frame");
      })
      .catch(() => {
        relayFailed = true;
        drawCard(desc);
      });
  }
  const row = (icon, title, detail, cls) => ({ icon, title, detail, cls });
  const busyRow = (text) => ({ busy: text });

  // The top frame shows cards for its frames.
  if (window === window.top) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== TG.MSG.UNIVERSAL_CARD) return;
      if (msg.desc) drawCard(msg.desc);
      sendResponse({ ok: true });
    });
  }

  // Text: the reported scams in the database (/api/detect).
  function reportedRow(v) {
    const db = v.database;
    if (!db) return row("database", "Reported scams database", v.offline ? "Not checked: the TrustGraph server isn't reachable." : "Not checked: the server didn't answer.");
    if (!db.matches) return row("database", "No match in the reported scams database", "It isn't like any scam reported to TrustGraph so far.");
    return row("fingerprint", `Matches ${db.matches === 1 ? "a reported scam" : db.matches + " reported scams"}`, `Similarity ${Math.round(db.top.similarity * 100)}% · ${db.top.reportType}${db.top.status ? " · " + db.top.status : ""}`, "match");
  }

  async function runCheck(t) {
    busy = true;
    shield.setAttribute("aria-busy", "true");
    const kind = t.kind;
    renderCard(kind, [busyRow("Checking…")]);
    try {
      const text = kit.text(t.el, "script, style, nav, button", { lines: true });
      const res = await send({ type: TG.MSG.UNIVERSAL_CHECK, kind, text });
      showResult(kind, res);
    } catch (err) {
      renderCard(kind, [row("info", "Couldn't check this", String((err && err.message) || err))]);
    } finally {
      busy = false;
      shield.removeAttribute("aria-busy");
    }
  }

  function showResult(kind, res) {
    const dbMatch = res && res.verdict && res.verdict.database ? res.verdict.database.matches > 0 : "-";
    debug("result", kind, res && res.error ? "error=" + res.error : `model=${(res.verdict && res.verdict.riskLevel) || "-"} db_match=${dbMatch}`);
    if (!res || res.error) {
      renderCard(kind, [row(res && res.error === "offline" ? "wifiOff" : "info", "Couldn't check this", (res && res.message) || "No answer from TrustGraph.")]);
      return;
    }
    const v = res.verdict || {};
    if (v.empty) return renderCard(kind, [row("info", "Nothing to check", "No readable text here.")]);
    const level = v.riskLevel || "low";
    const rows = [{ icon: "gauge", chip: { level, text: `${UI.LEVELS[level].label} · ${v.score}` }, detail: v.explanation || "" }];
    rows.push(res.engine === "local" ? row("database", "Reported scams database", "Not checked: Settings → Engine is on-device only.") : reportedRow(v));
    renderCard(kind, rows);
  }

  // ---------------------------------------------------------------------
  loadSettings();
})();
