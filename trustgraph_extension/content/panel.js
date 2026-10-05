// TrustGraph side panel: the in-page UI.
//
// A 360px panel docked to the right edge. On supported chat sites it PUSHES
// the page aside (the site's layout narrows) so it never covers messages;
// elsewhere it overlays. It collapses to a thin rail in the verdict colour.
// Also owns the small draggable "Scan chat" launcher.
//
// Everything lives in closed shadow roots, so the site's CSS can't restyle
// it and the site's scripts can't reach in. All text is set with
// textContent (never innerHTML): message text can't inject HTML. Styles and
// components come from shared/design.js and shared/ui.js.
//
// It's a view: core.js (and the right-click path, and the welcome page)
// build a state object and call TrustGraphPanel.render(state). See render()
// for the state shape. Loaded as a content script, injected by the
// right-click menu (a second injection is a no-op), and on the welcome page.
(function () {
  "use strict";
  if (window.__trustgraphPanelLoaded) return;
  window.__trustgraphPanelLoaded = true;

  const TG = window.TG;
  const U = window.TrustGraphUI;
  const Design = window.TrustGraphDesign;
  const { el } = U;
  const PANEL_W = 360;
  const RAIL_W = 14;

  // -------------------------------------------------------------------------
  // Panel-specific styles (tokens and components come from design.js)
  // -------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; }
    .panel {
      position: fixed; z-index: 2147483646; top: 0; right: 0; bottom: 0; width: ${PANEL_W}px;
      display: flex; flex-direction: column; background: var(--bg);
      border-left: var(--hair) solid var(--border);
      transform: translateX(100%); transition: transform var(--dur) var(--ease); visibility: hidden;
    }
    .panel.open { transform: none; visibility: visible; }
    .panel.overlay { box-shadow: var(--shadow); }
    .panel:focus, .panel:focus-visible { outline: none; }
    .top { flex: none; display: flex; align-items: center; gap: 4px; height: 54px; padding: 0 8px 0 16px; border-bottom: var(--hair) solid color-mix(in srgb, var(--border) 65%, transparent); }
    .top .tg-logo { flex: 1; }
    .scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent; }
    .sec { padding: 16px 18px; border-bottom: var(--hair) solid color-mix(in srgb, var(--border) 50%, transparent); }
    .sec-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 10px; }

    /* verdict hero */
    .hero { padding: 18px 18px 16px; position: relative; overflow: hidden; }
    .hero::before { content: ""; position: absolute; inset: -40% -20% auto auto; width: 260px; height: 260px; border-radius: 50%;
      background: radial-gradient(closest-side, color-mix(in srgb, var(--c, var(--primary)) 16%, transparent), transparent); pointer-events: none; }
    .hero-row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
    .level { display: grid; gap: 8px; justify-items: start; min-width: 0; }
    .level .tg-h { font-size: 30px; }
    .expl { position: relative; margin: 14px 0 0; color: var(--text-muted); font-size: 13.5px; line-height: 1.55; }
    .source { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 12px; }
    .source .tg-mono { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; }
    .coverage { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 8px; font-size: 12.5px; color: var(--text-dim); }
    .coverage .tg-link, .source .tg-link { font-size: 12.5px; }
    .notice { position: relative; margin: 8px 0 0; font-size: 12.5px; color: var(--caution); }

    /* signals */
    .evidence { box-sizing: border-box; width: 100%; margin: 8px 0 0; padding: 7px 10px; border-radius: 8px; background: var(--bg-deep); border-left: 2px solid var(--c, var(--accent-light));
      font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .sig-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px; margin-top: 6px; font: 10.5px var(--font-mono); color: var(--text-dim); letter-spacing: .03em; }
    .sig-meta .tg-link { font: 500 12px var(--font-body); letter-spacing: 0; }
    .none { display: grid; gap: 10px; }
    .none p { margin: 0; font-size: 12.5px; color: var(--text-dim); }

    /* continuity + similarity */
    .cs { display: grid; gap: 8px; }
    .cs-card { padding: 12px; border-radius: 12px; background: var(--surface); border: var(--hair) solid color-mix(in srgb, var(--border) 55%, transparent); display: grid; grid-template-columns: 28px 1fr; gap: 4px 10px; }
    .cs-card > .ic { grid-row: span 2; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--surface-2); color: var(--accent-light); }
    .cs-card > .ic svg { width: 15px; height: 15px; }
    .cs-title { margin: 0; display: flex; justify-content: space-between; gap: 8px; font-weight: 600; font-size: 13px; }
    .cs-title .tg-mono { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--s, var(--text-dim)); }
    .cs-text { margin: 0; font-size: 12.5px; color: var(--text-muted); }
    .cs-card[data-state="changed"] { --s: var(--caution); } .cs-card[data-state="steady"] { --s: var(--low); }
    .meter { grid-column: 2; height: 5px; border-radius: 3px; background: var(--surface-3); overflow: hidden; margin: 4px 0 2px; }
    .meter i { display: block; height: 100%; background: var(--accent-light); border-radius: 3px; }

    /* why */
    .why-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0; border: 0; background: none; color: var(--text); cursor: pointer; font-size: 13px; font-weight: 500; }
    .why-btn svg { width: 16px; height: 16px; color: var(--text-dim); transition: transform var(--dur); }
    .why-btn[aria-expanded="true"] svg { transform: rotate(180deg); }
    .why { margin-top: 10px; font-size: 12.5px; color: var(--text-muted); }
    .why p { margin: 0 0 8px; }
    .why ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; }

    /* footer actions */
    .foot { flex: none; padding: 12px 16px 10px; border-top: var(--hair) solid color-mix(in srgb, var(--border) 65%, transparent); background: var(--bg); display: grid; gap: 10px; }
    .save { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
    .save label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .save svg { width: 16px; height: 16px; color: var(--accent-light); }
    .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .acts .tg-btn { font-size: 12.5px; padding: 6px 8px; }
    .done { margin: 0; font-size: 12.5px; color: var(--low); display: flex; align-items: center; gap: 6px; }
    .done svg { width: 14px; height: 14px; }
    .micro { margin: 0; text-align: center; font: 10.5px var(--font-mono); letter-spacing: .08em; color: var(--text-dim); text-transform: uppercase; }

    /* scanning */
    .scan-hero { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; margin-top: 10px; }
    .scan-ring { width: 80px; height: 80px; border-radius: 50%; border: 7px solid var(--surface-3); border-top-color: var(--accent-light); animation: tg-spin 1s linear infinite; }
    @keyframes tg-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .scan-ring { animation: none; } }

    /* rail (collapsed) */
    .rail { position: fixed; z-index: 2147483646; top: 0; right: 0; bottom: 0; width: ${RAIL_W}px; border: 0; padding: 0; cursor: pointer;
      background: var(--rc, var(--primary)); display: none; box-shadow: 0 0 18px color-mix(in srgb, var(--rc, var(--primary)) 45%, transparent); }
    .rail.show { display: block; }
    .rail[data-level="low"] { --rc: var(--low); } .rail[data-level="caution"] { --rc: var(--caution); } .rail[data-level="high"] { --rc: var(--high); }
    .rail:focus-visible { outline: 2px solid var(--text); outline-offset: -4px; }

    /* launcher */
    .launcher { position: fixed; z-index: 2147483645; width: 44px; height: 44px; border-radius: 14px; border: 0; padding: 0;
      display: grid; place-items: center; cursor: grab; touch-action: none; color: #fff; background: var(--primary);
      box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 8px 24px var(--primary-glow), 0 0 22px var(--primary-glow); transition: background var(--dur); }
    .launcher:hover { background: var(--primary-hover); }
    .launcher.dragging { cursor: grabbing; }
    .launcher svg { width: 22px; height: 22px; pointer-events: none; }
    .launcher:focus-visible { outline: 2px solid var(--accent-light); outline-offset: 3px; }
  `;

  // -------------------------------------------------------------------------
  // Theme (Settings → Appearance; dark by default)
  // -------------------------------------------------------------------------
  let theme = "dark";
  const themed = new Set();
  function setTheme(t) {
    theme = t === "light" ? "light" : "dark";
    for (const host of themed) host.setAttribute("data-theme", theme);
  }

  function makeHost(tag, css) {
    const h = document.createElement(tag);
    h.style.cssText = "all: initial; position: fixed; top: 0; right: 0; width: 0; height: 0; z-index: 2147483646;";
    const r = h.attachShadow({ mode: "closed" });
    Design.adopt(r, css);
    themed.add(h);
    h.setAttribute("data-theme", theme);
    return [h, r];
  }

  // -------------------------------------------------------------------------
  // Push-aside layout: narrow the page instead of covering it.
  // Making <body> a containing block (transform) means the site's
  // position:fixed app shell shrinks with it.
  // -------------------------------------------------------------------------
  let pushSheet = null;
  let highlightSheet = null;
  // `target` (optional): the site's app root, sized to the narrowed body
  // too, for apps that size themselves with 100vw.
  let pushTarget = null;
  function setPush(width, target) {
    const docEl = document.documentElement;
    if (!width) {
      docEl.removeAttribute("data-trustgraph-push");
      docEl.style.removeProperty("--trustgraph-push");
      if (pushTarget) pushTarget.removeAttribute("data-trustgraph-push-target");
      pushTarget = null;
      return;
    }
    if (!pushSheet) {
      pushSheet = new CSSStyleSheet();
      pushSheet.replaceSync(
        "html[data-trustgraph-push] body { transform: translateZ(0) !important; width: calc(100vw - var(--trustgraph-push, 0px)) !important; min-width: 0 !important; }" +
          "html[data-trustgraph-push] [data-trustgraph-push-target] { width: 100% !important; max-width: 100% !important; }"
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, pushSheet];
    }
    docEl.style.setProperty("--trustgraph-push", width + "px");
    docEl.setAttribute("data-trustgraph-push", "");
    if (target && target !== pushTarget) {
      if (pushTarget) pushTarget.removeAttribute("data-trustgraph-push-target");
      pushTarget = target;
      target.setAttribute("data-trustgraph-push-target", "");
    }
  }

  // Briefly outlines a message in the chat ("Jump to message").
  function highlight(node) {
    if (!highlightSheet) {
      highlightSheet = new CSSStyleSheet();
      highlightSheet.replaceSync("[data-trustgraph-highlight] { outline: 2px solid #9DBBFF !important; outline-offset: 3px !important; border-radius: 8px !important; box-shadow: 0 0 0 6px rgba(47,102,240,.25) !important; }");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
    }
    node.setAttribute("data-trustgraph-highlight", "");
    setTimeout(() => node.removeAttribute("data-trustgraph-highlight"), 2200);
  }

  const reducedMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // -------------------------------------------------------------------------
  // Panel
  // -------------------------------------------------------------------------
  let host = null;
  let root = null;
  let panel = null;
  let rail = null;
  let live = null;
  let scrollBox = null;
  let foot = null;
  let state = null;
  let isOpen = false;
  let collapsed = false;
  let layout = { push: false, pane: null, debug: false };
  let returnFocus = null;
  let lastAnnounced = "";
  let whyOpen = false;

  function ensurePanel() {
    if (host && host.isConnected) return;
    [host, root] = makeHost("trustgraph-panel", CSS);
    rail = el("button", { class: "rail", type: "button", "aria-label": "Expand the TrustGraph panel", title: "TrustGraph", onclick: () => expand() });
    live = el("div", { class: "tg-sr", role: "status", "aria-live": "polite" });
    scrollBox = el("div", { class: "scroll" });
    foot = el("div", { class: "foot" });
    panel = el("aside", { class: "panel tg-root", "aria-labelledby": "tg-name", tabindex: "-1" }, [
      el("div", { class: "top" }, [
        U.logo(),
        el("h2", { class: "tg-sr", id: "tg-name", text: "TrustGraph" }),
        U.iconButton("chevronRight", "Collapse the TrustGraph panel", () => collapse()),
        U.iconButton("x", "Close the TrustGraph panel (Esc)", () => close()),
      ]),
      scrollBox,
      foot,
      live,
    ]);
    root.append(panel, rail);
    document.documentElement.append(host);
  }

  // opts: {push: boolean, pane: Element (must stay uncovered), target, debug, collapsed}
  function open(opts = {}) {
    ensurePanel();
    layout = { push: !!opts.push, pane: opts.pane || null, target: opts.target || null, debug: !!opts.debug };
    if (!isOpen && !opts.collapsed) returnFocus = document.activeElement;
    isOpen = true;
    if (opts.collapsed) {
      // Auto-scan: only the rail, and don't take focus from the page.
      collapsed = true;
      panel.classList.remove("open");
      rail.classList.add("show");
      if (layout.push) setPush(RAIL_W, layout.target);
    } else {
      collapsed = false;
      panel.classList.add("open");
      rail.classList.remove("show");
      applyLayout(PANEL_W);
      panel.focus({ preventScroll: true });
    }
    if (window.TrustGraphPanel.onOpenChange) window.TrustGraphPanel.onOpenChange(true);
  }

  // Push the page aside, then check the chat really is uncovered; if the
  // site's layout ignored us, fall back to overlaying.
  function applyLayout(width) {
    if (!layout.push) {
      setPush(0);
      panel.classList.add("overlay");
      return;
    }
    setPush(width, layout.target);
    panel.classList.remove("overlay");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const pane = layout.pane && layout.pane.isConnected ? layout.pane : null;
        if (!pane || !isOpen) return;
        const r = pane.getBoundingClientRect();
        const edge = window.innerWidth - width;
        if (r.width && r.right > edge + 1) {
          if (layout.debug) console.debug("[TrustGraph] push-aside didn't narrow the chat; overlaying instead.");
          layout.push = false;
          setPush(0);
          panel.classList.add("overlay");
        }
      })
    );
  }

  function collapse() {
    if (!isOpen) return;
    collapsed = true;
    panel.classList.remove("open");
    rail.classList.add("show");
    if (layout.push) setPush(RAIL_W, layout.target);
    rail.focus({ preventScroll: true });
  }

  function expand() {
    if (!isOpen) return;
    if (!returnFocus) returnFocus = document.activeElement;
    collapsed = false;
    panel.classList.add("open");
    rail.classList.remove("show");
    applyLayout(PANEL_W);
    panel.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    collapsed = false;
    panel.classList.remove("open");
    rail.classList.remove("show");
    setPush(0);
    whyOpen = false;
    const cb = state && state.on && state.on.close;
    state = null;
    if (returnFocus && returnFocus.isConnected && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    if (cb) cb();
    if (window.TrustGraphPanel.onOpenChange) window.TrustGraphPanel.onOpenChange(false);
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && isOpen && !collapsed) {
        e.stopPropagation();
        close();
      }
    },
    true
  );

  // -------------------------------------------------------------------------
  // render(state)
  // state = {
  //   mode: "chat" | "single",
  //   status: "scanning" | "result" | "nothing" | "error",
  //   verdict: Verdict (shared/verdict.js), when status is "result"
  //   coverage: {read, scored, label},   e.g. "Read 14 messages from this chat"
  //   messageMeta: {id: {sender, timeText}}  (chat: who sent the flagged message)
  //   scanEarlier: {available, running, label},
  //   record, saved, wrong,               Save to history / Mark as wrong state
  //   notice, errorText,
  //   on: {retry, scanEarlier, jump(id), close, toggleSave(on), markWrong, openWorkspace}
  // }
  // -------------------------------------------------------------------------
  function render(next) {
    ensurePanel();
    state = next;
    const activeKey = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.key : null;
    const scrollTop = scrollBox.scrollTop;
    const v = next.status === "result" ? next.verdict : null;

    scrollBox.replaceChildren(...body(next));
    foot.replaceChildren(...footer(next));
    rail.setAttribute("data-level", v ? v.riskLevel : "");
    rail.setAttribute("aria-label", "Expand the TrustGraph panel" + (v ? ` (${U.LEVELS[v.riskLevel].label})` : ""));

    scrollBox.scrollTop = scrollTop;
    if (activeKey) {
      const again = root.querySelector(`[data-key="${activeKey}"]`);
      if (again) again.focus({ preventScroll: true });
    }
    announce(next);
  }

  // Say the verdict once per change, not on every re-render.
  function announce(s) {
    let text = "";
    if (s.status === "scanning") text = "TrustGraph is checking.";
    else if (s.status === "result") text = `TrustGraph: ${U.LEVELS[s.verdict.riskLevel].label}, score ${s.verdict.score} out of 100.`;
    else if (s.status === "nothing") text = "TrustGraph: nothing to read here.";
    else if (s.status === "error") text = "TrustGraph couldn't finish the check.";
    if (text && text !== lastAnnounced) {
      lastAnnounced = text;
      live.textContent = text;
    }
  }

  function body(s) {
    if (s.status === "scanning") return [scanningBlock(s)];
    if (s.status === "nothing")
      return [el("div", { class: "sec" }, [U.empty({ icon: "messageCircle", title: "Nothing to read here yet", text: s.mode === "single" ? "This message has no text (it may be an image, sticker or voice note)." : "Open a conversation, then scan again.", action: s.mode === "chat" && s.on.retry ? U.button("Scan again", { small: true, icon: "refresh", key: "retry", onclick: s.on.retry }) : null })])];
    if (s.status === "error")
      return [el("div", { class: "sec" }, [U.empty({ kind: "error", title: "Couldn't finish the check", text: s.errorText || "Something went wrong. Try again.", action: s.on.retry ? U.button("Try again", { small: true, icon: "refresh", key: "retry", onclick: s.on.retry }) : null })])];
    return [verdictBlock(s), signalsBlock(s), continuityBlock(s), whyBlock(s)];
  }

  const eyebrowFor = (s) => (s.mode === "single" ? "Verdict · this message" : "Verdict · this chat");

  function coverageRow(s) {
    const se = s.scanEarlier;
    if (!(s.coverage && s.coverage.label) && !(se && se.available)) return null;
    return el("div", { class: "coverage" }, [
      s.coverage && s.coverage.label ? el("span", { text: s.coverage.label }) : null,
      se && se.available ? el("button", { class: "tg-link", type: "button", "data-key": "scan-earlier", text: se.running ? se.label || "Scanning earlier messages…" : "Scan earlier messages", disabled: se.running, onclick: () => s.on.scanEarlier && s.on.scanEarlier() }) : null,
    ]);
  }

  function scanningBlock(s) {
    return el("div", { class: "sec hero", "aria-busy": "true" }, [
      U.eyebrow(eyebrowFor(s)),
      el("div", { class: "scan-hero" }, [el("div", { style: "display:grid;gap:10px" }, [U.skeleton("60%", 22), U.skeleton("90%"), U.skeleton("70%")]), el("div", { class: "scan-ring", "aria-hidden": "true" })]),
      el("p", { class: "expl", text: s.mode === "single" ? "Checking this message…" : "Reading this chat…" }),
      coverageRow({ ...s, scanEarlier: null }),
    ]);
  }

  function sourceLine(v, s) {
    if (v.engine === "local") return el("div", { class: "source" }, [el("span", { class: "tg-node blue", "aria-hidden": "true" }), el("span", { class: "tg-mono", text: "On-device rules" })]);
    if (v.source === "server") return el("div", { class: "source" }, [el("span", { class: "tg-node green", "aria-hidden": "true" }), el("span", { class: "tg-mono", text: "TrustGraph server + on-device rules" })]);
    return el("div", { class: "source" }, [
      el("span", { class: "tg-node amber", "aria-hidden": "true" }),
      el("span", { class: "tg-mono", text: v.serverError ? "Server error · on-device rules only" : "Server offline · on-device rules only" }),
      s.on.retry ? el("button", { class: "tg-link", type: "button", "data-key": "retry", text: "Retry", "aria-label": "Retry the full analysis", onclick: s.on.retry }) : null,
    ]);
  }

  function verdictBlock(s) {
    const v = s.verdict;
    const L = U.LEVELS[v.riskLevel];
    return el("section", { class: "sec hero", "data-level": v.riskLevel, "aria-label": "Verdict" }, [
      U.eyebrow(eyebrowFor(s)),
      el("div", { class: "hero-row" }, [el("div", { class: "level" }, [U.chip(v.riskLevel), el("p", { class: "tg-h", text: L.label })]), U.gauge(v.score, v.riskLevel, { size: 88 })]),
      el("p", { class: "expl", text: v.explanation }),
      sourceLine(v, s),
      coverageRow(s),
      s.notice ? el("p", { class: "notice", role: "status", text: s.notice }) : null,
    ]);
  }

  function signalsBlock(s) {
    const v = s.verdict;
    const n = v.signals.length;
    const sec = el("section", { class: "sec", "aria-labelledby": "tg-sig" }, [el("div", { class: "sec-head" }, [el("h3", { class: "tg-eyebrow", id: "tg-sig", text: "Signals" }), el("span", { class: "tg-mono", text: n ? `${n} found` : "none" })])]);
    if (!n) {
      sec.append(
        el("div", { class: "none" }, [
          el("ul", { class: "tg-checks" }, [U.checkRow("No scam signals found", v.riskLevel === "low" ? "Nothing matched the scam patterns TrustGraph knows." : null)]),
          el("p", { text: "That's not a guarantee. If something feels wrong, check with the person another way." }),
        ])
      );
      return sec;
    }
    const meta = s.messageMeta || {};
    const list = el(
      "ul",
      { class: "tg-signals" },
      v.signals.map((sig) => {
        const m = meta[sig.messageId] || {};
        const extra = [];
        if (sig.evidence) extra.push(el("blockquote", { class: "evidence", "data-level": v.riskLevel, text: "“" + sig.evidence + "”" }));
        const who = [m.sender, m.timeText, sig.count > 1 ? `in ${sig.count} messages` : null].filter(Boolean).join(" · ");
        if (who || (s.mode === "chat" && sig.messageId && s.on.jump)) {
          extra.push(
            el("div", { class: "sig-meta" }, [
              el("span", { text: who }),
              s.mode === "chat" && sig.messageId && s.on.jump ? el("button", { class: "tg-link", type: "button", "data-key": "jump-" + sig.id, text: "Jump to message", "aria-label": `Jump to the message: ${sig.name}`, onclick: () => s.on.jump(sig.messageId) }) : null,
            ])
          );
        }
        return U.signalRow(sig, extra.length ? el("div", null, extra) : null);
      })
    );
    sec.append(list);
    return sec;
  }

  const CONT_LABEL = { single: "Single message", steady: "Steady", changed: "Changed", new: "New sender" };

  function continuityBlock(s) {
    const v = s.verdict;
    const c = v.continuity || { state: "single", text: "" };
    const sim = v.similarity || { score: 0, text: "" };
    const pct = Math.max(0, Math.min(100, Number(sim.score) || 0));
    return el("section", { class: "sec", "aria-labelledby": "tg-cs" }, [
      el("div", { class: "sec-head" }, [el("h3", { class: "tg-eyebrow", id: "tg-cs", text: "Continuity and similarity" })]),
      el("div", { class: "cs" }, [
        el("div", { class: "cs-card", "data-state": c.state }, [
          el("span", { class: "ic", "aria-hidden": "true" }, [U.icon("gitBranch")]),
          el("p", { class: "cs-title" }, [el("span", { text: "Conversation shape" }), el("span", { class: "tg-mono", text: CONT_LABEL[c.state] || c.state })]),
          el("p", { class: "cs-text", text: c.text }),
        ]),
        el("div", { class: "cs-card" }, [
          el("span", { class: "ic", "aria-hidden": "true" }, [U.icon("fingerprint")]),
          el("p", { class: "cs-title" }, [el("span", { text: "Similarity to known patterns" }), el("span", { class: "tg-mono", text: pct + "%" })]),
          el("div", { class: "meter", role: "img", "aria-label": `Similarity to known scam patterns: ${pct} percent` }, [el("i", { style: `width:${pct}%` })]),
          el("p", { class: "cs-text", style: "grid-column:2", text: sim.text }),
        ]),
      ]),
      el("p", { class: "tg-mono", style: "margin:10px 0 0;font-size:10.5px", text: "Computed from verdicts and metadata; earlier messages aren't stored." }),
    ]);
  }

  // "How this was decided": the score and every contribution to it.
  function whyBlock(s) {
    const v = s.verdict;
    const d = v.details || {};
    const items = [`Risk score ${v.score} out of 100 (Caution from 35, High from 70 at Balanced sensitivity).`];
    for (const c of d.contributions || []) items.push(c.effect ? `${c.label}: ${c.effect} the score` : `${c.label}: +${Math.round(c.weight * 100)}`);
    if ((d.weakSignals || []).length) items.push(`Weak signs (context only): ${d.weakSignals.join(", ").toLowerCase()}.`);
    const how =
      v.engine === "local" || v.source !== "server"
        ? "Checked with TrustGraph's on-device scam rules (English, Malayalam, Manglish, Hinglish, Hindi), including negation such as “we will never ask for your OTP”."
        : "Checked by the TrustGraph server and the on-device scam rules; the higher verdict wins.";
    const btn = el("button", { class: "why-btn", type: "button", "data-key": "why", "aria-expanded": String(whyOpen), "aria-controls": "tg-why", onclick: () => ((whyOpen = !whyOpen), render(state)) }, [el("span", { text: "How this verdict was decided" }), U.icon("chevronDown")]);
    return el("section", { class: "sec" }, [
      btn,
      whyOpen
        ? el("div", { class: "why", id: "tg-why" }, [
            el("p", { text: how }),
            el("ul", null, items.map((t) => el("li", { text: t }))),
            s.mode === "chat" ? el("p", { style: "margin-top:8px", text: "Your own messages aren't scored; others' are checked alone and as runs from the same sender." }) : null,
          ])
        : null,
    ]);
  }

  function footer(s) {
    const nodes = [];
    if (s.status === "result" && s.verdict) {
      if (s.record && s.on.toggleSave) {
        nodes.push(
          el("div", { class: "save" }, [
            el("label", { for: "tg-save" }, [U.icon("history"), el("span", { text: "Save to history" })]),
            el("input", { type: "checkbox", role: "switch", class: "tg-switch", id: "tg-save", "data-key": "save", checked: !!s.saved, onchange: (e) => s.on.toggleSave(e.target.checked) }),
          ])
        );
      }
      const acts = el("div", { class: "acts" });
      if (s.on.markWrong) {
        acts.append(s.wrong ? el("p", { class: "done", role: "status" }, [U.icon("check"), "Marked as wrong. Thanks."]) : U.button("Mark as wrong verdict", { small: true, icon: "flag", key: "wrong", title: "Sends only this verdict's id, never the message", onclick: s.on.markWrong }));
      }
      if (s.on.openWorkspace) {
        acts.append(U.button("Open in workspace", { small: true, icon: "externalLink", key: "workspace", disabled: !s.saved, title: s.saved ? "Open this result in the web app" : "Save to history first to open it in your workspace", onclick: s.on.openWorkspace }));
      }
      if (acts.childNodes.length) nodes.push(acts);
    }
    nodes.push(el("p", { class: "micro", text: "No message text stored · Results only" }));
    return nodes;
  }

  // Scroll a chat message into view and outline it briefly.
  function jumpTo(node) {
    if (!node || !node.isConnected) return false;
    node.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    highlight(node);
    return true;
  }

  // -------------------------------------------------------------------------
  // Single-message results (hover shield, right-click, welcome page)
  // response = {verdict, record, saved} from the background, or
  // {verdict: {empty: true}}, or {error}.
  // -------------------------------------------------------------------------
  function showSingle(response, context = {}, layoutOpts = {}) {
    if (!isOpen || collapsed) open(layoutOpts);
    const v = response && response.verdict;
    if (!response || response.error || !v) return render(baseSingle({ status: "error", errorText: response && response.error }, context));
    if (v.empty) return render(baseSingle({ status: "nothing" }, context));
    render(baseSingle({ status: "result", verdict: v, record: response.record || null, saved: !!response.saved, wrong: false }, context));
  }

  function baseSingle(partial, context) {
    const s = { mode: "single", coverage: { read: 1, label: "" }, on: {}, ...partial };
    if (context.onRetry) s.on.retry = context.onRetry;
    if (partial.status !== "result") return s;
    const send = (msg) => chrome.runtime.sendMessage(msg);
    s.on.markWrong = async () => {
      try {
        await send({ type: TG.MSG.MARK_WRONG, id: s.verdict.id }); // the id, nothing else
      } catch (_) {}
      if (state && state.verdict === s.verdict) render({ ...state, wrong: true });
    };
    if (s.record) {
      s.on.toggleSave = async (on) => {
        try {
          await send({ type: TG.MSG.SET_SAVED, record: s.record, saved: on });
        } catch (_) {}
        if (state && state.verdict === s.verdict) render({ ...state, saved: on });
      };
      s.on.openWorkspace = () => send({ type: TG.MSG.OPEN_WORKSPACE, id: s.record.id }).catch(() => {});
    }
    return s;
  }

  function showChecking(context = {}, layoutOpts = {}) {
    if (!isOpen || collapsed) open(layoutOpts);
    render(baseSingle({ status: "scanning" }, context));
  }

  // -------------------------------------------------------------------------
  // Launcher: one small draggable button; position remembered per site.
  // -------------------------------------------------------------------------
  const launcher = (() => {
    let lhost = null;
    let button = null;
    let channel = null;
    let avoid = null;
    let onActivate = null;
    let pos = null; // {right, top} in px
    const SIZE = 44;
    const KEY = "launcher_pos";

    function ensure() {
      if (lhost && lhost.isConnected) return;
      let r;
      [lhost, r] = makeHost("trustgraph-launcher", CSS);
      lhost.style.zIndex = "2147483645";
      button = el("button", { class: "launcher tg-root", type: "button", "aria-label": "Scan this chat with TrustGraph", title: "Scan this chat with TrustGraph (drag to move)" }, [U.icon("shieldCheck", { stroke: 2 })]);
      r.append(button);
      document.documentElement.append(lhost);
      wireDrag();
    }

    function clampAndPlace() {
      const vw = document.documentElement.clientWidth || innerWidth;
      const vh = innerHeight;
      const right = Math.max(8, Math.min(pos.right, vw - SIZE - 8));
      let top = Math.max(8, Math.min(pos.top, vh - SIZE - 8));
      // Never sit on the chat header (call / search / menu buttons).
      const header = avoid && avoid();
      if (header) {
        const h = header.getBoundingClientRect();
        const left = vw - right - SIZE;
        const overlaps = h.width && left < h.right && left + SIZE > h.left && top < h.bottom && top + SIZE > h.top;
        if (overlaps) top = h.bottom + 8;
      }
      button.style.right = right + "px";
      button.style.top = top + "px";
      return { right, top };
    }

    function wireDrag() {
      let start = null;
      let dragged = false;
      button.addEventListener("pointerdown", (e) => {
        start = { x: e.clientX, y: e.clientY, right: pos.right, top: pos.top };
        dragged = false;
        button.setPointerCapture(e.pointerId);
      });
      button.addEventListener("pointermove", (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!dragged && Math.hypot(dx, dy) < 5) return;
        dragged = true;
        button.classList.add("dragging");
        pos = { right: start.right - dx, top: start.top + dy };
        clampAndPlace();
      });
      button.addEventListener("pointerup", () => {
        if (dragged) {
          pos = clampAndPlace();
          save();
        }
        start = null;
        button.classList.remove("dragging");
      });
      // A drag must not also count as a click.
      button.addEventListener("click", (e) => {
        if (dragged) {
          dragged = false;
          e.preventDefault();
          return;
        }
        if (onActivate) onActivate();
      });
      window.addEventListener("resize", () => lhost && lhost.isConnected && pos && clampAndPlace());
    }

    async function save() {
      try {
        const { [KEY]: all = {} } = await chrome.storage.local.get(KEY);
        all[channel] = pos;
        await chrome.storage.local.set({ [KEY]: all });
      } catch (_) {}
    }

    async function show(opts) {
      channel = opts.channel;
      avoid = opts.avoid || null;
      onActivate = opts.onActivate;
      ensure();
      if (!pos) {
        pos = { right: 16, top: Math.round(innerHeight * 0.45) };
        try {
          const { [KEY]: all = {} } = await chrome.storage.local.get(KEY);
          if (all[channel]) pos = all[channel];
        } catch (_) {}
      }
      clampAndPlace();
      lhost.style.display = "";
    }

    function hide() {
      if (lhost) lhost.style.display = "none";
    }

    return { show, hide };
  })();

  // -------------------------------------------------------------------------
  // Right-click / "Check current selection": the background tells us what
  // to show.
  // -------------------------------------------------------------------------
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.theme) setTheme(msg.theme);
      // On a supported chat site the panel pushes the page aside; anywhere
      // else it overlays.
      const opts = window.TrustGraphPanel.layoutForPage ? window.TrustGraphPanel.layoutForPage() : {};
      if (msg.type === TG.MSG.SHOW_CHECKING) showChecking({}, opts);
      else if (msg.type === TG.MSG.SHOW_RESULT) showSingle({ verdict: msg.verdict, record: msg.record, saved: msg.saved }, {}, opts);
    });
  }

  window.TrustGraphPanel = {
    open,
    close,
    collapse,
    expand,
    render,
    showSingle,
    showChecking,
    setTheme,
    jumpTo,
    launcher,
    isOpen: () => isOpen,
    isCollapsed: () => collapsed,
    current: () => state,
    // Set by core.js on supported sites: {push, pane}.
    layoutForPage: null,
    onOpenChange: null,
  };
})();
