// TrustGraph verdict card, shown on the web page.
//
// It lives inside a *closed* Shadow DOM, so the site's CSS can't restyle it
// and the site's scripts can't reach into it. All text is set with
// textContent (never innerHTML), so message text can't inject HTML.
//
// Loaded three ways:
//   - as a content script on supported chat sites (manifest.json)
//   - injected on demand by the right-click menu (chrome.scripting)
//   - as a plain <script> on the onboarding page ("Try it")
// The guard below makes a second injection into the same page a no-op.
//
// Public API: window.TrustGraphCard.{showChecking, showEmpty, showError,
// showResult, dismiss}. Each takes an optional anchorRect (from
// getBoundingClientRect) to sit next to; without it the card sits top-right.
(function () {
  "use strict";
  if (window.__trustgraphCardLoaded) return;
  window.__trustgraphCardLoaded = true;

  const TG = window.TG;
  const CARD_WIDTH = 360;
  const MARGIN = 8;

  // Mirrors shared/tokens.css (the shadow root can't load that file).
  const STYLE = `
    :host {
      --bg: #ffffff; --surface: #f3f6fc; --text: #141a3c; --muted: #4a5378;
      --border: #d5dcec; --accent: #1e2761; --on-accent: #fff; --focus: #2f6fed;
      --shadow: 0 8px 28px rgba(20, 26, 60, 0.22); --band: #4a5378;
      --duration: 140ms;
      all: initial;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #1b2140; --surface: #232a4f; --text: #e8eefc; --muted: #a9b4d6;
        --border: #36406b; --accent: #cadcfc; --on-accent: #10142c; --focus: #8fb2ff;
        --shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
      }
    }
    @media (prefers-reduced-motion: reduce) { :host { --duration: 0ms; } }
    * { box-sizing: border-box; }
    .card {
      position: fixed; z-index: 2147483647;
      width: ${CARD_WIDTH}px; max-height: calc(100vh - ${MARGIN * 2}px); overflow: auto;
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--text); background: var(--bg);
      border: 1px solid var(--border); border-left: 6px solid var(--band);
      border-radius: 12px; box-shadow: var(--shadow);
      padding: 12px 14px 12px 14px; text-align: left;
      animation: tg-in var(--duration) ease-out;
    }
    .card:focus, .card:focus-visible { outline: none; } /* the card itself isn't a control; its buttons show focus */
    @keyframes tg-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    .band-Low { --band: #1c8a5a; }
    .band-Caution { --band: #b8860b; }
    .band-High { --band: #e63946; }
    .head { display: flex; align-items: flex-start; gap: 8px; }
    .brand { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin: 0 0 2px; }
    .title { flex: 0 1 auto; margin: 0; font-size: 15px; font-weight: 700; line-height: 1.3; }
    .badge {
      flex: none; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 700;
      background: var(--band); color: #000;
    }
    .close {
      flex: none; width: 28px; height: 28px; margin: -4px -6px 0 0; border: 0; border-radius: 6px;
      background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer;
    }
    .close:hover { background: var(--surface); color: var(--text); }
    p { margin: 8px 0 0; }
    .note { font-size: 12px; color: var(--muted); padding: 6px 8px; border-radius: 8px; background: var(--surface); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    button { font: inherit; }
    .btn {
      min-height: 32px; padding: 4px 12px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--border); background: var(--surface); color: var(--text);
    }
    .btn:hover { border-color: var(--accent); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .details { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
    .details h3 { margin: 0 0 6px; font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .details ul { margin: 0 0 10px; padding: 0; list-style: none; }
    .details li { margin: 0 0 8px; }
    .flag { padding-left: 14px; position: relative; }
    .flag::before { content: ""; position: absolute; left: 2px; top: .55em; width: 6px; height: 6px; border-radius: 50%; background: var(--band); }
    .sig-head { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; text-transform: capitalize; }
    .sig-head span:last-child { font-weight: 400; color: var(--muted); text-transform: none; }
    .bar { height: 6px; margin: 4px 0 2px; border-radius: 3px; background: var(--surface); overflow: hidden; }
    .bar > span { display: block; height: 100%; background: var(--band); }
    .sig-text { font-size: 12px; color: var(--muted); }
    .inactive { opacity: .6; }
    .confirm { margin-top: 10px; padding: 8px; border-radius: 8px; background: var(--surface); }
    .status { font-size: 13px; }
    .spinner {
      display: inline-block; width: 14px; height: 14px; margin-right: 8px; vertical-align: -2px;
      border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%;
      animation: tg-spin 0.8s linear infinite;
    }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
    @keyframes tg-spin { to { transform: rotate(360deg); } }
  `;

  let host = null;
  let shadow = null;
  let card = null;
  let anchor = null;
  let previousFocus = null;
  let selectionAnchor = null; // remembered between "checking" and "result" for right-click

  // --- tiny DOM helper: el("p", {class: "note", text: "hi"}, [children]) ---
  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key === "onclick") node.addEventListener("click", value);
      // CSSOM writes aren't blocked by a page's style-src CSP; attributes can be.
      else if (key === "style") node.style.cssText = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children || []) if (child) node.appendChild(child);
    return node;
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("trustgraph-card");
    // Inline styles keep the (empty) host itself out of the page layout.
    host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
    shadow = host.attachShadow({ mode: "closed" });
    // A constructed stylesheet isn't affected by the page's CSP (a <style>
    // tag can be, on sites like Gmail). Fall back to <style> just in case.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      shadow.adoptedStyleSheets = [sheet];
    } catch (_) {
      shadow.appendChild(el("style", { text: STYLE }));
    }
    // documentElement survives single-page apps swapping out <body>.
    document.documentElement.appendChild(host);
  }

  function toRect(r) {
    if (!r) return null;
    const rect = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
    if (![rect.top, rect.left, rect.right, rect.bottom].every(Number.isFinite)) return null;
    if (rect.right - rect.left === 0 && rect.bottom - rect.top === 0) return null;
    return rect;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  // Keep the card next to the anchor and fully inside the viewport.
  function position() {
    if (!card) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_WIDTH, vw - MARGIN * 2);
    card.style.width = width + "px";
    const height = card.offsetHeight;

    let left;
    let top;
    if (anchor) {
      left = anchor.right - width; // line up with the message's right edge
      if (left < MARGIN) left = anchor.left;
      top = anchor.bottom + MARGIN; // below the message...
      if (top + height > vh - MARGIN) top = anchor.top - height - MARGIN; // ...or above it
    } else {
      left = vw - width - 16;
      top = 16;
    }
    card.style.left = clamp(left, MARGIN, vw - width - MARGIN) + "px";
    card.style.top = clamp(top, MARGIN, Math.max(MARGIN, vh - height - MARGIN)) + "px";
  }

  // Builds a fresh card (replacing any open one) and shows it.
  // showBrand: add a small "TrustGraph" label when the title doesn't say it.
  function mount(bandClass, headChildren, bodyChildren, { focus, showBrand = true } = {}) {
    ensureHost();
    if (card) card.remove();
    else previousFocus = document.activeElement;

    const titleId = "tg-title";
    card = el(
      "div",
      { class: "card " + (bandClass || ""), role: "dialog", "aria-labelledby": titleId, tabindex: "-1" },
      [
        el("div", { class: "head" }, [
          el("div", { style: "flex:1" }, [showBrand ? el("p", { class: "brand", text: "TrustGraph" }) : null, ...headChildren(titleId)]),
          el("button", { class: "close", type: "button", "aria-label": "Dismiss TrustGraph result", text: "×", onclick: dismiss }),
        ]),
        ...bodyChildren,
      ]
    );
    shadow.appendChild(card);
    position();
    if (focus) card.focus({ preventScroll: true });
  }

  function dismiss() {
    if (!card) return;
    const hadFocus = host && document.activeElement === host;
    card.remove();
    card = null;
    anchor = null;
    if (hadFocus && previousFocus && previousFocus.isConnected && previousFocus.focus) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  // ---------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------

  function showChecking(anchorRect) {
    anchor = toRect(anchorRect);
    mount(
      "",
      (id) => [el("h2", { class: "title", id, text: TG.TEXT.checking })],
      [el("p", { class: "status", role: "status" }, [el("span", { class: "spinner", "aria-hidden": "true" }), document.createTextNode("Looking for scam signals in this message.")])]
    );
  }

  function showEmpty(anchorRect) {
    anchor = toRect(anchorRect);
    mount(
      "",
      (id) => [el("h2", { class: "title", id, text: TG.TEXT.nothingToCheck })],
      [el("p", { text: TG.TEXT.nothingToCheckDetail }), el("div", { class: "actions" }, [el("button", { class: "btn", type: "button", text: "Dismiss", "aria-label": "Dismiss TrustGraph result", onclick: dismiss })])],
      { focus: true }
    );
  }

  function showError(message, anchorRect) {
    anchor = toRect(anchorRect);
    mount(
      "",
      (id) => [el("h2", { class: "title", id, text: "Couldn't check this message" })],
      [
        el("p", { role: "alert", text: message || "Something went wrong. Try again." }),
        el("div", { class: "actions" }, [el("button", { class: "btn", type: "button", text: "Dismiss", "aria-label": "Dismiss TrustGraph result", onclick: dismiss })]),
      ],
      { focus: true }
    );
  }

  // result: what background.js scoreMessage() returns.
  // context.text: the checked text, kept in memory only so "Report" can send it.
  function showResult(result, anchorRect, context) {
    if (!result) return showError(null, anchorRect);
    if (result.empty) return showEmpty(anchorRect);
    if (result.error) return showError(result.error, anchorRect);

    anchor = toRect(anchorRect);
    const band = TG.BANDS[result.band] ? result.band : "Caution";
    const text = context && context.text;

    const body = [el("p", { class: "explanation", text: result.explanation })];

    if (result.serverError) {
      body.push(el("p", { class: "note", text: TG.TEXT.serverErrorLabel + " (" + result.serverError + ")" }));
    } else if (result.source === "basic") {
      body.push(el("p", { class: "note", text: TG.TEXT.basicLabel }));
    }

    const details = buildDetails(result);
    details.hidden = true;
    details.id = "tg-details";

    const whyBtn = el("button", {
      class: "btn",
      type: "button",
      text: "Why?",
      "aria-expanded": "false",
      "aria-controls": "tg-details",
      "aria-label": "Show why TrustGraph gave this result",
    });
    whyBtn.addEventListener("click", () => {
      details.hidden = !details.hidden;
      whyBtn.setAttribute("aria-expanded", String(!details.hidden));
      whyBtn.textContent = details.hidden ? "Why?" : "Hide why";
      position();
    });

    const actions = el("div", { class: "actions" }, [
      el("button", { class: "btn primary", type: "button", text: "Dismiss", "aria-label": "Dismiss TrustGraph result", onclick: dismiss }),
      whyBtn,
    ]);

    const reportArea = el("div");
    if (text) actions.appendChild(buildReportButton(text, reportArea));

    body.push(actions, details, reportArea);

    mount(
      "band-" + band,
      (id) => [
        el("div", { style: "display:flex;gap:8px;align-items:flex-start" }, [
          el("h2", { class: "title", id, text: TG.BANDS[band].title }),
          el("span", { class: "badge", text: band }),
        ]),
      ],
      body,
      { focus: true, showBrand: !TG.BANDS[band].title.startsWith("TrustGraph") }
    );
  }

  // The "Why?" panel: the four engine signals, plus Basic-check red flags.
  function buildDetails(result) {
    const children = [];

    if (Array.isArray(result.flags)) {
      children.push(el("h3", { text: "Red flags found (Basic check)" }));
      const list = el("ul");
      const flags = result.flags.length ? result.flags : [{ label: "None of the common red flags." }];
      for (const flag of flags) list.appendChild(el("li", { class: "flag", text: flag.label }));
      children.push(list);
    }

    children.push(el("h3", { text: "Full-analysis signals" }));
    const list = el("ul");
    for (const signal of result.signals || []) {
      const explanation = String(signal.explanation || "");
      const isStub = explanation.startsWith("stub:");
      const needsServer = isStub && result.source === "basic";
      const hasScore = !isStub && typeof signal.score === "number";
      const pct = hasScore ? Math.round(clamp(signal.score, 0, 1) * 100) : null;

      const item = el("li", { class: isStub ? "inactive" : "" }, [
        el("div", { class: "sig-head" }, [
          el("span", { text: signal.name }),
          el("span", { text: isStub ? (needsServer ? "needs server" : "not active yet") : pct + "%" }),
        ]),
      ]);
      if (hasScore) {
        const fill = el("span");
        fill.style.width = pct + "%";
        item.appendChild(el("div", { class: "bar", role: "img", "aria-label": signal.name + " " + pct + " percent" }, [fill]));
        if (explanation) item.appendChild(el("div", { class: "sig-text", text: explanation }));
      }
      list.appendChild(item);
    }
    children.push(list);
    return el("div", { class: "details" }, children);
  }

  // "Report as scam" -> consent note -> send -> honest outcome.
  function buildReportButton(text, area) {
    const reportBtn = el("button", { class: "btn", type: "button", text: "Report as scam", "aria-label": "Report this message as a scam" });
    reportBtn.addEventListener("click", () => {
      reportBtn.disabled = true;
      const confirmBtn = el("button", { class: "btn primary", type: "button", text: "Report", "aria-label": "Confirm: add this message to the shared scam database" });
      const cancelBtn = el("button", { class: "btn", type: "button", text: "Cancel", "aria-label": "Cancel report" });
      const box = el("div", { class: "confirm" }, [el("p", { style: "margin:0", text: TG.TEXT.reportConsent }), el("div", { class: "actions" }, [confirmBtn, cancelBtn])]);
      area.replaceChildren(box);
      position();
      confirmBtn.focus();

      cancelBtn.addEventListener("click", () => {
        area.replaceChildren();
        reportBtn.disabled = false;
        reportBtn.focus();
        position();
      });

      confirmBtn.addEventListener("click", async () => {
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        let ok = false;
        try {
          const res = await chrome.runtime.sendMessage({ type: TG.MSG.REPORT, text });
          ok = !!(res && res.ok);
        } catch (_) {
          ok = false;
        }
        const status = el("p", { class: "status", role: "status", text: ok ? TG.TEXT.reportOk : TG.TEXT.reportUnavailable });
        area.replaceChildren(status);
        if (ok) reportBtn.remove();
        else reportBtn.disabled = false;
        position();
      });
    });
    return reportBtn;
  }

  // ---------------------------------------------------------------------
  // Global listeners
  // ---------------------------------------------------------------------

  // Esc closes the card (and only then do we swallow the key).
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && card) {
        event.stopPropagation();
        dismiss();
      }
    },
    true
  );

  window.addEventListener("resize", () => position());

  function selectionRect() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return toRect(sel.getRangeAt(0).getBoundingClientRect());
  }

  // Messages from the background (right-click path).
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === TG.MSG.SHOW_CHECKING) {
        selectionAnchor = msg.useSelection ? selectionRect() : null;
        showChecking(selectionAnchor);
      } else if (msg.type === TG.MSG.SHOW_RESULT) {
        showResult(msg.result, selectionAnchor, { text: msg.text });
      }
    });
  }

  window.TrustGraphCard = { showChecking, showEmpty, showError, showResult, dismiss };
})();
