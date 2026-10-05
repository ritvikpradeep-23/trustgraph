// TrustGraph side panel: the in-page UI.
//
// A 340px panel docked to the right edge. On supported chat sites it PUSHES
// the page aside (the site's layout narrows) so it never covers messages;
// elsewhere it overlays. It collapses to a thin rail in the verdict colour.
// Also owns the small draggable "Scan chat" launcher.
//
// Everything lives in closed shadow roots, so the site's CSS can't restyle
// it and the site's scripts can't reach in. All text is set with
// textContent (never innerHTML): message text can't inject HTML.
//
// It's a view: core.js (and the right-click path, and onboarding) build a
// state object and call TrustGraphPanel.render(state). See render() for the
// state shape. Loaded as a content script, injected by the right-click
// menu (a second injection is a no-op), and on the onboarding page.
(function () {
  "use strict";
  if (window.__trustgraphPanelLoaded) return;
  window.__trustgraphPanelLoaded = true;

  const TG = window.TG;
  const PANEL_W = 340;
  const RAIL_W = 14;
  const NS = "http://www.w3.org/2000/svg";
  const RANK = { Low: 0, Caution: 1, High: 2 };

  // -------------------------------------------------------------------------
  // Styles (one constructed sheet, shared by the panel and the launcher)
  // -------------------------------------------------------------------------
  const CSS = `
    :host {
      all: initial;
      --w: ${PANEL_W}px;
      --font: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Malayalam", "Helvetica Neue", Arial, sans-serif;
      --bg: #fbfaf7; --surface: #f1efe8; --text: #15192e; --muted: #4a5068; --line: #e0ddd3;
      --brand: #1e2761; --on-brand: #ffffff; --focus: #2f6fed;
      --low: #1c8a5a; --caution: #b8860b; --high: #e63946;
      --low-ink: #146b45; --caution-ink: #7a5a06; --high-ink: #b01f2e;
      --low-tint: #e5f2ea; --caution-tint: #f7efdb; --high-tint: #fbe4e6;
      --dur: 180ms;
    }
    :host([data-theme="dark"]) {
      --bg: #14161d; --surface: #1d2029; --text: #eceef5; --muted: #a9afc2; --line: #2b2f3c;
      --brand: #cadcfc; --on-brand: #10142c; --focus: #8fb2ff;
      --low-ink: #5bd69f; --caution-ink: #e9be54; --high-ink: #ff8a94;
      --low-tint: #14281e; --caution-tint: #2a2412; --high-tint: #2e1619;
    }
    @media (prefers-reduced-motion: reduce) { :host { --dur: 0ms; } }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    /* The panel container takes focus on open so Tab starts inside it; its
       controls show the focus ring, not the whole panel. */
    .panel:focus, .panel:focus-visible { outline: none; }
    .rail:focus-visible { outline-offset: -4px; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* ---- panel ---- */
    .panel {
      position: fixed; z-index: 2147483646; top: 0; right: 0; bottom: 0; width: var(--w);
      display: flex; flex-direction: column;
      font: 14px/1.45 var(--font); color: var(--text); background: var(--bg);
      border-left: 1px solid var(--line);
      transform: translateX(100%); transition: transform var(--dur) ease-out; visibility: hidden;
    }
    .panel.open { transform: none; visibility: visible; }
    .panel.overlay { box-shadow: -12px 0 32px rgba(15, 18, 40, .18); }
    .top { flex: none; display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--line); }
    .mark { width: 18px; height: 18px; flex: none; }
    .mark .s { fill: var(--brand); } .mark .c { stroke: var(--bg); }
    .name { flex: 1; font-weight: 700; font-size: 14px; letter-spacing: .01em; margin: 0; }
    .icon-btn { width: 34px; height: 34px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; display: grid; place-items: center; }
    .icon-btn:hover { background: var(--surface); color: var(--text); }
    .icon-btn svg { width: 18px; height: 18px; }
    .scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; }

    /* ---- verdict ---- */
    .verdict { padding: 20px 20px 16px; background: var(--tint, var(--surface)); border-bottom: 1px solid var(--line); }
    .verdict[data-band="Low"] { --tint: var(--low-tint); --ink: var(--low-ink); }
    .verdict[data-band="Caution"] { --tint: var(--caution-tint); --ink: var(--caution-ink); }
    .verdict[data-band="High"] { --tint: var(--high-tint); --ink: var(--high-ink); }
    .level { display: flex; align-items: center; gap: 12px; }
    .level svg { width: 36px; height: 36px; flex: none; color: var(--ink, var(--muted)); }
    .level-word { margin: 0; font-size: 24px; line-height: 1.15; font-weight: 750; color: var(--ink, var(--text)); }
    .headline { margin: 12px 0 0; font-size: 15.5px; font-weight: 600; }
    .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
    .coverage { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 12px; font-size: 12.5px; color: var(--muted); }
    .link { border: 0; background: none; padding: 2px 0; color: var(--brand); font-weight: 600; font-size: 12.5px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .link:disabled { color: var(--muted); cursor: default; text-decoration: none; }

    /* skeleton (scanning) */
    .skel { display: block; height: 12px; border-radius: 6px; background: var(--line); margin-top: 10px; }
    .skel.w1 { width: 55%; height: 22px; margin-top: 0; } .skel.w2 { width: 85%; } .skel.w3 { width: 65%; }
    .skel { animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .45; } }
    @media (prefers-reduced-motion: reduce) { .skel { animation: none; } }

    /* ---- sections ---- */
    .sec { padding: 16px 20px; border-bottom: 1px solid var(--line); }
    .sec h3 { margin: 0 0 10px; font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    .flags { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
    .flag { border-left: 3px solid var(--sev, var(--caution)); padding: 0 0 0 12px; }
    .flag[data-sev="high"] { --sev: var(--high); } .flag[data-sev="low"] { --sev: var(--line); }
    .flag-title { margin: 0; font-weight: 650; }
    .flag-reason { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
    .evidence {
      margin: 8px 0 0; padding: 6px 10px; border-radius: 6px; background: var(--surface);
      font-size: 13px; overflow-wrap: anywhere;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .flag-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--muted); }
    .flag-meta .link { flex: none; white-space: nowrap; }
    .empty-note { margin: 0; color: var(--muted); }

    .meters { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
    .meter-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 6px; font-size: 12.5px; }
    .meter-head span:first-child { font-weight: 600; text-transform: capitalize; }
    .meter-head span:last-child { color: var(--muted); }
    .bar { height: 6px; margin-top: 4px; border-radius: 3px; background: var(--surface); overflow: hidden; }
    .bar > span { display: block; height: 100%; background: var(--brand); }
    .meter.off { opacity: .55; }
    .status { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--caution); flex: none; }
    .status p { flex: 1; margin: 0; }
    .why p { margin: 0 0 8px; font-size: 13px; }
    .why ul { margin: 0; padding-left: 18px; font-size: 13px; }

    /* ---- footer ---- */
    .foot { flex: none; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--bg); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn[aria-expanded="true"] { background: var(--surface); border-color: var(--muted); }
    .btn {
      min-height: 36px; padding: 6px 12px; border-radius: 8px; cursor: pointer; white-space: nowrap;
      border: 1px solid var(--line); background: var(--bg); color: var(--text); font-weight: 600; font-size: 13px;
    }
    .btn:hover { border-color: var(--muted); }
    .btn.primary { background: var(--brand); border-color: var(--brand); color: var(--on-brand); margin-left: auto; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .confirm { margin: 0 0 10px; padding: 10px 12px; border-radius: 8px; background: var(--surface); font-size: 13px; }
    .confirm .actions { margin-top: 8px; }
    .report-status { margin: 0 0 10px; font-size: 13px; }

    /* ---- rail (collapsed) ---- */
    .rail {
      position: fixed; z-index: 2147483646; top: 0; right: 0; bottom: 0; width: ${RAIL_W}px;
      border: 0; padding: 0; cursor: pointer; background: var(--rail, var(--brand)); display: none;
    }
    .rail.show { display: block; }
    .rail[data-band="Low"] { --rail: var(--low); } .rail[data-band="Caution"] { --rail: var(--caution); } .rail[data-band="High"] { --rail: var(--high); }

    /* ---- launcher ---- */
    .launcher {
      position: fixed; z-index: 2147483645; width: 44px; height: 44px; border-radius: 50%;
      display: grid; place-items: center; cursor: grab; touch-action: none;
      background: var(--brand); color: var(--on-brand); border: 2px solid var(--bg);
      box-shadow: 0 2px 10px rgba(15, 18, 40, .3);
    }
    .launcher.dragging { cursor: grabbing; }
    .launcher svg { width: 22px; height: 22px; pointer-events: none; }
    .launcher .c { stroke: var(--brand); }
  `;

  let sheet = null;
  function styleSheet() {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
    }
    return sheet;
  }

  // -------------------------------------------------------------------------
  // Small DOM helpers (textContent only)
  // -------------------------------------------------------------------------
  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "onclick") node.addEventListener("click", v);
      else if (k === "style") node.style.cssText = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children || []) if (c) node.append(c);
    return node;
  }

  function svg(viewBox, parts, cls) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    for (const [tag, attrs] of parts) {
      const p = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
      s.append(p);
    }
    return s;
  }

  const STROKE = { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" };
  const ICONS = {
    shield: (cls) =>
      svg("0 0 24 24", [
        ["path", { class: "s", d: "M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z", fill: "currentColor" }],
        ["path", { class: "c", d: "m8.5 12.2 2.4 2.4 4.8-5", fill: "none", stroke: "#fff", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" }],
      ], cls),
    // Distinct SHAPES per level, so colour is never the only cue.
    Low: () => svg("0 0 36 36", [["circle", { cx: "18", cy: "18", r: "15", ...STROKE, "stroke-width": "2.5" }], ["path", { d: "m11.5 18.5 4.5 4.5 8.5-9", ...STROKE, "stroke-width": "3" }]]),
    Caution: () => svg("0 0 36 36", [["path", { d: "M18 4 33 31H3L18 4z", ...STROKE, "stroke-width": "2.5" }], ["path", { d: "M18 14v8", ...STROKE, "stroke-width": "3" }], ["circle", { cx: "18", cy: "26.5", r: "1.8", fill: "currentColor" }]]),
    High: () => svg("0 0 36 36", [["path", { d: "M12 3h12l9 9v12l-9 9H12l-9-9V12z", ...STROKE, "stroke-width": "2.5" }], ["path", { d: "M18 10.5v10", ...STROKE, "stroke-width": "3" }], ["circle", { cx: "18", cy: "25.5", r: "1.8", fill: "currentColor" }]]),
    Neutral: () => svg("0 0 36 36", [["circle", { cx: "18", cy: "18", r: "15", ...STROKE, "stroke-width": "2.5" }], ["path", { d: "M12 18h12", ...STROKE, "stroke-width": "3" }]]),
    close: () => svg("0 0 24 24", [["path", { d: "M6 6l12 12M18 6 6 18", ...STROKE }]]),
    collapse: () => svg("0 0 24 24", [["path", { d: "m9 6 6 6-6 6", ...STROKE }]]),
  };

  // -------------------------------------------------------------------------
  // Theme: WhatsApp's own dark class on <body>, else the OS setting.
  // -------------------------------------------------------------------------
  function currentTheme() {
    const body = document.body;
    if (body && body.classList.contains("dark")) return "dark";
    if (body && body.classList.contains("light")) return "light";
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  const themed = new Set();
  function applyTheme() {
    const theme = currentTheme();
    for (const host of themed) host.setAttribute("data-theme", theme);
  }
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  if (document.body) new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ["class"] });

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
    const root = document.documentElement;
    if (!width) {
      root.removeAttribute("data-trustgraph-push");
      root.style.removeProperty("--trustgraph-push");
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
    root.style.setProperty("--trustgraph-push", width + "px");
    root.setAttribute("data-trustgraph-push", "");
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
      highlightSheet.replaceSync(
        "[data-trustgraph-highlight] { outline: 3px solid #b8860b !important; outline-offset: 2px !important; border-radius: 8px !important; }"
      );
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
    host = document.createElement("trustgraph-panel");
    host.style.cssText = "all: initial; position: fixed; top: 0; right: 0; width: 0; height: 0; z-index: 2147483646;";
    root = host.attachShadow({ mode: "closed" });
    root.adoptedStyleSheets = [styleSheet()];
    themed.add(host);
    applyTheme();

    rail = el("button", { class: "rail", type: "button", "aria-label": "Expand the TrustGraph panel", title: "TrustGraph", onclick: () => expand() });
    live = el("div", { class: "sr", role: "status", "aria-live": "polite" });
    scrollBox = el("div", { class: "scroll" });
    foot = el("div", { class: "foot" });
    panel = el("aside", { class: "panel", "aria-labelledby": "tg-name", tabindex: "-1" }, [
      el("div", { class: "top" }, [
        ICONS.shield("mark"),
        el("h2", { class: "name", id: "tg-name", text: "TrustGraph" }),
        el("button", { class: "icon-btn", type: "button", "aria-label": "Collapse the TrustGraph panel", title: "Collapse", onclick: () => collapse() }, [ICONS.collapse()]),
        el("button", { class: "icon-btn", type: "button", "aria-label": "Close the TrustGraph panel", title: "Close (Esc)", onclick: () => close() }, [ICONS.close()]),
      ]),
      scrollBox,
      foot,
      live,
    ]);
    root.append(panel, rail);
    document.documentElement.append(host);
  }

  // opts: {push: boolean, pane: Element (must stay uncovered), debug}
  function open(opts = {}) {
    ensurePanel();
    layout = { push: !!opts.push, pane: opts.pane || null, target: opts.target || null, debug: !!opts.debug };
    if (!isOpen) returnFocus = document.activeElement;
    isOpen = true;
    collapsed = false;
    panel.classList.add("open");
    rail.classList.remove("show");
    applyLayout(PANEL_W);
    panel.focus({ preventScroll: true });
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
      if (e.key === "Escape" && isOpen) {
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
  //   band: "Low" | "Caution" | "High",
  //   coverage: {read, label},        // e.g. read 14 -> "Read 14 messages from this chat"
  //   source: "server" | "basic",      // basic = offline Basic check only
  //   server: "server" | "offline" | "error",
  //   flags: [{key, title, reason, evidence, severity, sender, timeText, messageId}],
  //   signals: [{name, score, explanation}],
  //   explanation: string,             // the engine's one-line summary
  //   scanEarlier: {available, running, label},
  //   report: {state: "idle"|"confirm"|"sending"|"sent"|"unavailable", count},
  //   errorText: string,
  //   on: {retry, scanEarlier, jump(id), report, reportConfirm, reportCancel, close}
  // }
  // -------------------------------------------------------------------------
  function render(next) {
    ensurePanel();
    state = next;
    const activeKey = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.key : null;
    const scrollTop = scrollBox.scrollTop;

    scrollBox.replaceChildren(...body(next));
    foot.replaceChildren(...footer(next));
    rail.setAttribute("data-band", next.status === "result" ? next.band : "");
    rail.setAttribute("aria-label", "Expand the TrustGraph panel" + (next.status === "result" ? ` (${levelWord(next.band)})` : ""));

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
    else if (s.status === "result") text = `TrustGraph: ${levelWord(s.band)}. ${headline(s)}`;
    else if (s.status === "nothing") text = "TrustGraph: nothing to read here.";
    else if (s.status === "error") text = "TrustGraph couldn't finish the check.";
    if (text && text !== lastAnnounced) {
      lastAnnounced = text;
      live.textContent = text;
    }
  }

  const levelWord = (band) => ({ Low: "Low risk", Caution: "Caution", High: "High risk" })[band] || "Checked";
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Honest about coverage: what was read, and how it was checked.
  function headline(s) {
    const n = s.flags.length;
    const where = s.mode === "single" ? "this message" : `the ${plural(s.coverage.read, "message", "messages")} I could read`;
    if (s.band === "High") return n ? `Likely scam: ${plural(n, "red flag", "red flags")} in ${where}.` : `Likely scam, based on ${where}.`;
    if (s.band === "Caution") return n ? `${plural(n, "possible red flag", "possible red flags")} in ${where}.` : `Something in ${where} looks off.`;
    return `No red flags in ${where}.`;
  }

  function body(s) {
    if (s.status === "scanning") return [scanningBlock(s)];
    if (s.status === "nothing") return [plainBlock("Nothing to read here yet", s.mode === "single" ? "This message has no text (it may be an image, sticker or voice note)." : "Open a conversation, then scan again.", s, s.mode === "chat" ? "Scan again" : null)];
    if (s.status === "error") return [plainBlock("Couldn't finish the check", s.errorText || "Something went wrong. Try again.", s, "Try again")];

    const nodes = [verdictBlock(s), flagsBlock(s), signalsBlock(s)];
    if (whyOpen) nodes.push(whyBlock(s));
    return nodes;
  }

  function coverageRow(s) {
    const row = el("div", { class: "coverage" }, [el("span", { text: s.coverage && s.coverage.label })]);
    const se = s.scanEarlier;
    if (se && se.available) {
      row.append(
        el("button", { class: "link", type: "button", "data-key": "scan-earlier", text: se.running ? se.label || "Scanning earlier messages…" : "Scan earlier messages", disabled: se.running, onclick: () => s.on.scanEarlier && s.on.scanEarlier() })
      );
    }
    return row;
  }

  function scanningBlock(s) {
    return el("div", { "aria-busy": "true" }, [scanningVerdict(s), el("div", { class: "sec" }, [el("span", { class: "skel w2", style: "margin-top:0" }), el("span", { class: "skel w3" }), el("span", { class: "skel w2" })])]);
  }

  function scanningVerdict(s) {
    return el("div", { class: "verdict" }, [
      el("span", { class: "skel w1" }),
      el("span", { class: "skel w2" }),
      el("span", { class: "skel w3" }),
      el("p", { class: "sub", text: s.mode === "single" ? "Checking this message…" : "Reading this chat…" }),
      s.coverage && s.coverage.label ? coverageRow({ ...s, scanEarlier: null }) : null,
    ]);
  }

  function plainBlock(title, text, s, retryLabel) {
    return el("div", { class: "verdict" }, [
      el("div", { class: "level" }, [ICONS.Neutral(), el("p", { class: "level-word", text: title, style: "font-size:19px" })]),
      el("p", { class: "sub", text }),
      retryLabel && s.on.retry ? el("div", { class: "coverage" }, [el("button", { class: "link", type: "button", "data-key": "retry", text: retryLabel, onclick: s.on.retry })]) : null,
    ]);
  }

  function verdictBlock(s) {
    const basicNote =
      s.source === "basic"
        ? s.server === "error"
          ? "The server returned an error, so this is the basic check only."
          : "Basic check only: the full analysis needs the TrustGraph server."
        : "";
    return el("div", { class: "verdict", "data-band": s.band }, [
      el("div", { class: "level" }, [ICONS[s.band](), el("p", { class: "level-word", text: levelWord(s.band) })]),
      el("p", { class: "headline", text: headline(s) }),
      basicNote ? el("p", { class: "sub", text: basicNote }) : null,
      coverageRow(s),
      s.notice ? el("p", { class: "sub", role: "status", text: s.notice }) : null,
    ]);
  }

  function flagsBlock(s) {
    const n = s.flags.length;
    const sec = el("section", { class: "sec", "aria-labelledby": "tg-flags" }, [el("h3", { id: "tg-flags", text: n ? `Red flags (${n})` : "No red flags" })]);
    if (!n) {
      sec.append(el("p", { class: "empty-note", text: s.band === "Low" ? "Nothing matched the scam patterns TrustGraph knows. That's not a guarantee: if something feels wrong, check with the person another way." : s.explanation || "" }));
      return sec;
    }
    const list = el("ul", { class: "flags" });
    for (const f of s.flags) {
      const meta = el("div", { class: "flag-meta" }, [el("span", { text: [f.sender, f.timeText].filter(Boolean).join(" · ") })]);
      if (f.messageId && s.on.jump) {
        meta.append(el("button", { class: "link", type: "button", "data-key": "jump-" + f.key, text: "Jump to message", "aria-label": `Jump to the message: ${f.title}`, onclick: () => s.on.jump(f.messageId) }));
      }
      list.append(
        el("li", { class: "flag", "data-sev": f.severity || "medium" }, [
          el("p", { class: "flag-title", text: f.title }),
          f.reason ? el("p", { class: "flag-reason", text: f.reason }) : null,
          f.evidence ? el("blockquote", { class: "evidence", text: "“" + f.evidence + "”" }) : null,
          meta,
        ])
      );
    }
    sec.append(list);
    return sec;
  }

  function signalsBlock(s) {
    const sec = el("section", { class: "sec", "aria-labelledby": "tg-signals" }, [el("h3", { id: "tg-signals", text: "Signals" })]);
    const offline = s.source === "basic";
    if (offline) {
      sec.append(
        el("div", { class: "status" }, [
          el("span", { class: "dot", "aria-hidden": "true" }),
          el("p", { text: s.server === "error" ? "Server error: basic check only" : "Offline: basic check only" }),
          s.on.retry ? el("button", { class: "btn", type: "button", "data-key": "retry", text: "Retry", "aria-label": "Retry the full analysis", onclick: s.on.retry }) : null,
        ])
      );
      return sec;
    }
    if (!(s.signals || []).length) {
      sec.append(el("p", { class: "empty-note", text: "Signals appear once a message from someone else has been checked." }));
      return sec;
    }
    const grid = el("div", { class: "meters" });
    for (const sig of s.signals || []) {
      const stub = String(sig.explanation || "").startsWith("stub:");
      const pct = !stub && typeof sig.score === "number" ? Math.round(Math.max(0, Math.min(1, sig.score)) * 100) : null;
      const fill = el("span");
      fill.style.width = (pct || 0) + "%";
      grid.append(
        el("div", { class: "meter" + (pct === null ? " off" : ""), title: stub ? "Not active yet" : sig.explanation || "" }, [
          el("div", { class: "meter-head" }, [el("span", { text: sig.name }), el("span", { text: pct === null ? "not active" : pct + "%" })]),
          el("div", { class: "bar", role: "img", "aria-label": `${sig.name}: ${pct === null ? "not active yet" : pct + " percent"}` }, [fill]),
        ])
      );
    }
    sec.append(grid);
    return sec;
  }

  // "How this was decided": the score and every contribution to it, so
  // the verdict is fully explained.
  function whyBlock(s) {
    const items = [];
    if (typeof s.score === "number") {
      items.push(`Risk score ${Math.round(s.score * 100)} out of 100 (Caution from 35, High from 70).`);
    }
    for (const c of s.contributions || []) {
      if (c.effect) items.push(`${c.label}: ${c.effect} the score`);
      else items.push(`${c.label}: +${Math.round(c.weight * 100)}`);
    }
    if ((s.weakSignals || []).length) items.push(`Weak signs (context only, not red flags): ${s.weakSignals.join(", ").toLowerCase()}.`);
    const how =
      s.source === "basic"
        ? "Checked on this device with TrustGraph's scam rules (English, Malayalam, Manglish, Hinglish), including negation such as “we will never ask for your OTP”."
        : "Checked by the TrustGraph server's four signals and the on-device scam rules; the higher verdict wins.";
    const extra = [];
    if (s.mode === "chat") extra.push(`Your own messages aren't scored; ${plural(s.coverage.scored || 0, "message from others was", "messages from others were")} checked, alone and as runs from the same sender.`);
    return el("section", { class: "sec why", id: "tg-why", "aria-labelledby": "tg-why-h" }, [
      el("h3", { id: "tg-why-h", text: "How this was decided" }),
      el("p", { text: how }),
      s.explanation ? el("p", { text: s.explanation }) : null,
      items.length ? el("ul", null, items.map((t) => el("li", { text: t }))) : null,
      extra.length ? el("p", { text: extra.join(" "), style: "margin-top:8px" }) : null,
    ]);
  }

  function footer(s) {
    const nodes = [];
    const r = s.report || { state: "idle" };
    if (r.state === "confirm" || r.state === "sending") {
      nodes.push(
        el("div", { class: "confirm" }, [
          el("p", { style: "margin:0", text: r.count > 1 ? `Add the ${r.count} flagged messages to the shared scam database?` : "Add this message to the shared scam database?" }),
          el("div", { class: "actions" }, [
            el("button", { class: "btn primary", type: "button", "data-key": "report-yes", text: r.state === "sending" ? "Sending…" : "Report", disabled: r.state === "sending", onclick: s.on.reportConfirm }),
            el("button", { class: "btn", type: "button", "data-key": "report-no", text: "Cancel", disabled: r.state === "sending", onclick: s.on.reportCancel }),
          ]),
        ])
      );
    } else if (r.state === "sent") nodes.push(el("p", { class: "report-status", role: "status", text: "Sent. Similar messages will now be flagged." }));
    else if (r.state === "unavailable") nodes.push(el("p", { class: "report-status", role: "status", text: "Reporting isn't available right now." }));

    const actions = el("div", { class: "actions" });
    if (s.status === "result") {
      actions.append(
        el("button", {
          class: "btn",
          type: "button",
          "data-key": "why",
          text: "Why?", // pressed state shown by aria-expanded + style
          title: whyOpen ? "Hide the explanation" : "Show how this was decided",
          "aria-expanded": String(whyOpen),
          "aria-controls": "tg-why",
          onclick: () => {
            whyOpen = !whyOpen;
            render(state);
            if (whyOpen) {
              const w = root.getElementById("tg-why");
              if (w) w.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
            }
          },
        })
      );
      if (s.on.report && r.state !== "sent") {
        actions.append(el("button", { class: "btn", type: "button", "data-key": "report", text: "Report as scam", disabled: r.state === "confirm" || r.state === "sending", onclick: s.on.report }));
      }
    }
    actions.append(el("button", { class: "btn primary", type: "button", "data-key": "dismiss", text: "Dismiss", "aria-label": "Dismiss and close the TrustGraph panel", onclick: () => close() }));
    nodes.push(actions);
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
  // Single-message results (hover shield, right-click, onboarding)
  // -------------------------------------------------------------------------
  // Turns one scoreMessage() result into flag rows.
  function flagsFromResult(result, extra = {}) {
    const flags = (result.flags || []).map((f, i) => ({
      key: (extra.messageId || "m") + "-" + (f.ruleId || f.category || i),
      title: f.title || f.label,
      reason: f.reason || "",
      evidence: f.evidence ? f.evidence.text || f.evidence : f.match || "",
      severity: f.severity || "medium",
      sender: extra.sender || null,
      timeText: extra.timeText || "",
      messageId: extra.messageId || null,
    }));
    // The server can flag a message without naming rules.
    if (!flags.length && result.source === "server" && RANK[result.band] > 0) {
      flags.push({
        key: (extra.messageId || "m") + "-server",
        title: "Flagged by the full analysis",
        reason: result.explanation || "",
        evidence: extra.snippet || "",
        severity: result.band === "High" ? "high" : "medium",
        sender: extra.sender || null,
        timeText: extra.timeText || "",
        messageId: extra.messageId || null,
      });
    }
    return flags;
  }

  function snippet(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > 160 ? t.slice(0, 157) + "…" : t;
  }

  // One message: {result} from the background, {text} kept in memory only
  // so "Report as scam" can send it.
  function showSingle(result, context = {}, layoutOpts = {}) {
    if (!isOpen) open(layoutOpts);
    if (!result) return render(baseSingle({ status: "error" }, context));
    if (result.empty) return render(baseSingle({ status: "nothing" }, context));
    if (result.error) return render(baseSingle({ status: "error", errorText: result.error }, context));
    const s = baseSingle(
      {
        status: "result",
        band: RANK[result.band] !== undefined ? result.band : "Caution",
        source: result.source === "server" ? "server" : "basic",
        server: result.offline ? "offline" : result.serverError ? "error" : "server",
        flags: flagsFromResult(result, { snippet: snippet(context.text), sender: context.sender }),
        signals: result.signals || [],
        explanation: result.explanation || "",
        score: typeof result.score === "number" ? result.score : null,
        contributions: result.contributions || [],
        weakSignals: result.weakSignals || [],
      },
      context
    );
    render(s);
  }

  function baseSingle(partial, context) {
    const s = {
      mode: "single",
      coverage: { read: 1, label: "Checked 1 message" },
      flags: [],
      signals: [],
      report: { state: "idle", count: 1 },
      on: {},
      ...partial,
    };
    if (context.onRetry) s.on.retry = context.onRetry;
    if (context.text && partial.status === "result") {
      s.on.report = () => render({ ...state, report: { state: "confirm", count: 1 } });
      s.on.reportCancel = () => render({ ...state, report: { state: "idle", count: 1 } });
      s.on.reportConfirm = async () => {
        render({ ...state, report: { state: "sending", count: 1 } });
        let ok = false;
        try {
          const res = await chrome.runtime.sendMessage({ type: TG.MSG.REPORT, text: context.text });
          ok = !!(res && res.ok);
        } catch (_) {}
        if (state) render({ ...state, report: { state: ok ? "sent" : "unavailable", count: 1 } });
      };
    }
    return s;
  }

  function showChecking(context = {}, layoutOpts = {}) {
    if (!isOpen) open(layoutOpts);
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
      lhost = document.createElement("trustgraph-launcher");
      lhost.style.cssText = "all: initial; position: fixed; top: 0; right: 0; width: 0; height: 0; z-index: 2147483645;";
      const r = lhost.attachShadow({ mode: "closed" });
      r.adoptedStyleSheets = [styleSheet()];
      themed.add(lhost);
      applyTheme();
      button = el("button", { class: "launcher", type: "button", "aria-label": "Scan this chat with TrustGraph", title: "Scan this chat with TrustGraph (drag to move)" }, [ICONS.shield()]);
      r.append(button);
      document.documentElement.append(lhost);
      wireDrag();
    }

    function clampAndPlace() {
      const vw = document.documentElement.clientWidth || innerWidth;
      const vh = innerHeight;
      let right = Math.max(8, Math.min(pos.right, vw - SIZE - 8));
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
  // Right-click path: the background tells us what to show.
  // -------------------------------------------------------------------------
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      // On a supported chat site the panel pushes the page aside; anywhere
      // else it overlays.
      const opts = window.TrustGraphPanel.layoutForPage ? window.TrustGraphPanel.layoutForPage() : {};
      if (msg.type === TG.MSG.SHOW_CHECKING) showChecking({}, opts);
      else if (msg.type === TG.MSG.SHOW_RESULT) showSingle(msg.result, { text: msg.text }, opts);
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
    jumpTo,
    flagsFromResult,
    snippet,
    launcher,
    isOpen: () => isOpen,
    isCollapsed: () => collapsed,
    current: () => state,
    // Set by core.js on supported sites: {push, pane}.
    layoutForPage: null,
    onOpenChange: null,
  };
})();
