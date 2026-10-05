// TrustGraph design system: tokens, bundled fonts and component styles.
//
// ONE source for every surface: extension pages (popup, options, welcome,
// dev gallery) and the in-page UI, which lives in closed shadow roots and
// can't see a page stylesheet. Pages call TrustGraphDesign.adopt(document);
// shadow roots call TrustGraphDesign.adopt(shadowRoot).
//
// Fonts are bundled (fonts/*.woff2, SIL OFL) and never fetched from the
// web: this is a privacy product. @font-face doesn't work inside a shadow
// root, so fonts are registered with the FontFace API on the document,
// from bytes (so a page's Content-Security-Policy can't block them).
//
// Theme: dark by default; [data-theme="light"] on <html> (pages) or on the
// shadow host switches to the light palette.
(function (root) {
  "use strict";
  if (root.TrustGraphDesign) return;

  // ---- tokens (dark = the design spec, exactly) ---------------------------
  const DARK = {
    "--bg": "#060B1A",
    "--bg-deep": "#020611",
    "--surface": "#0E1A38",
    "--surface-2": "#162750",
    "--surface-3": "#1B3267",
    "--border": "#243A6B",
    "--primary": "#2F66F0",
    "--primary-hover": "#2554CA",
    "--primary-glow": "rgba(47,102,240,.3)",
    "--accent-light": "#9DBBFF",
    "--text": "#F1F5FF",
    "--text-muted": "#B4C2E4",
    "--text-dim": "#7E92C3",
    "--low": "#3EE6A8",
    "--caution": "#FFB938",
    "--high": "#FF5468",
    "--low-bg": "rgba(62,230,168,.12)",
    "--caution-bg": "rgba(255,185,56,.12)",
    "--high-bg": "rgba(255,84,104,.12)",
    "--low-line": "rgba(62,230,168,.25)",
    "--caution-line": "rgba(255,185,56,.25)",
    "--high-line": "rgba(255,84,104,.25)",
    "--on-primary": "#FFFFFF",
    "--grid-dot": "rgba(157,187,255,.09)",
    "--shadow": "0 18px 48px rgba(2,6,17,.55)",
  };

  // Light theme (optional). Verdict colours are darkened so text on the
  // tinted chips keeps at least 4.5:1 contrast on white.
  const LIGHT = {
    "--bg": "#F4F7FE",
    "--bg-deep": "#E8EEFB",
    "--surface": "#FFFFFF",
    "--surface-2": "#F2F5FD",
    "--surface-3": "#E4EBFA",
    "--border": "#C9D5EE",
    "--primary": "#2F66F0",
    "--primary-hover": "#2554CA",
    "--primary-glow": "rgba(47,102,240,.22)",
    "--accent-light": "#2552C8",
    "--text": "#0A1330",
    "--text-muted": "#3A4870",
    "--text-dim": "#56668F",
    "--low": "#0B7A55",
    "--caution": "#8F5A00",
    "--high": "#C7243A",
    "--low-bg": "rgba(11,122,85,.10)",
    "--caution-bg": "rgba(143,90,0,.10)",
    "--high-bg": "rgba(199,36,58,.09)",
    "--low-line": "rgba(11,122,85,.30)",
    "--caution-line": "rgba(143,90,0,.30)",
    "--high-line": "rgba(199,36,58,.30)",
    "--on-primary": "#FFFFFF",
    "--grid-dot": "rgba(37,82,200,.08)",
    "--shadow": "0 18px 48px rgba(10,19,48,.16)",
  };

  const FONT = {
    display: '"TG Space Grotesk", "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif',
    body: '"TG DM Sans", "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Malayalam", "Noto Sans Devanagari", sans-serif',
    mono: '"TG JetBrains Mono", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  };
  const FONT_FILES = [
    ["TG Space Grotesk", "fonts/SpaceGrotesk.woff2"],
    ["TG DM Sans", "fonts/DMSans.woff2"],
    ["TG JetBrains Mono", "fonts/JetBrainsMono.woff2"],
  ];

  const vars = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v};`).join(" ");

  const TOKENS_CSS = `
    :root, :host {
      ${vars(DARK)}
      --font-display: ${FONT.display}; --font-body: ${FONT.body}; --font-mono: ${FONT.mono};
      --hair: .67px; --r-input: 9px; --r-btn: 10px; --r-card: 18px; --r-card-lg: 24px;
      --dur: 160ms; --ease: cubic-bezier(.2,.7,.2,1);
      color-scheme: dark;
    }
    :root[data-theme="light"], :host([data-theme="light"]) { ${vars(LIGHT)} color-scheme: light; }
    @media (prefers-reduced-motion: reduce) { :root, :host { --dur: 0ms; } }
  `;

  // ---- components ---------------------------------------------------------
  // Class names are prefixed tg- so they never collide on a page.
  const COMPONENTS_CSS = `
    .tg-root, .tg-root * { box-sizing: border-box; }
    .tg-root { font: 400 14px/1.5 var(--font-body); color: var(--text); -webkit-font-smoothing: antialiased; }
    .tg-root button, .tg-root input, .tg-root select, .tg-root textarea { font: inherit; color: inherit; }
    .tg-root :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .tg-sr { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    [hidden] { display: none !important; }

    /* type */
    .tg-h { font-family: var(--font-display); font-weight: 400; letter-spacing: -0.03em; line-height: 1.08; margin: 0; color: var(--text); }
    .tg-h em { font-style: normal; color: var(--accent-light); }
    .tg-eyebrow { font: 500 11px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .14em; color: var(--text-dim); margin: 0; }
    .tg-eyebrow.blue { color: var(--accent-light); }
    .tg-mono { font-family: var(--font-mono); font-size: 11px; letter-spacing: .06em; color: var(--text-dim); }
    .tg-muted { color: var(--text-muted); }
    .tg-dim { color: var(--text-dim); }
    .tg-link { color: var(--accent-light); background: none; border: 0; padding: 0; cursor: pointer; font-weight: 500; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent-light) 40%, transparent); text-underline-offset: 3px; }
    .tg-link:hover { text-decoration-color: currentColor; }
    .tg-link:disabled { color: var(--text-dim); cursor: default; text-decoration: none; }

    /* logo: blue tile + white shield-check, wordmark "Trust" + "Graph" */
    .tg-logo { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; }
    .tg-logo-tile { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex: none;
      background: var(--primary); color: #fff; box-shadow: 0 4px 14px var(--primary-glow); }
    .tg-logo-tile svg { width: 17px; height: 17px; }
    .tg-wordmark { font: 500 16px/1 var(--font-display); letter-spacing: -0.02em; color: var(--text); }
    .tg-wordmark span { color: var(--accent-light); }

    /* buttons */
    .tg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 8px 14px;
      border-radius: var(--r-btn); border: var(--hair) solid var(--border); background: var(--surface); color: var(--text);
      font-weight: 500; font-size: 13.5px; cursor: pointer; white-space: nowrap; text-decoration: none;
      transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
    .tg-btn:hover { background: var(--surface-2); border-color: color-mix(in srgb, var(--accent-light) 45%, var(--border)); }
    .tg-btn svg { width: 16px; height: 16px; flex: none; }
    .tg-btn.primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); box-shadow: 0 6px 22px var(--primary-glow), inset 0 1px 0 rgba(255,255,255,.14); }
    .tg-btn.primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
    .tg-btn.ghost { background: transparent; border-color: transparent; color: var(--text-muted); }
    .tg-btn.ghost:hover { background: var(--surface); color: var(--text); }
    .tg-btn.danger { color: var(--high); border-color: var(--high-line); background: var(--high-bg); }
    .tg-btn.small { min-height: 30px; padding: 4px 10px; font-size: 12.5px; }
    .tg-btn.block { width: 100%; }
    .tg-btn:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
    .tg-btn[aria-pressed="true"] { background: var(--surface-3); border-color: var(--accent-light); }
    .tg-tag { font: 500 9.5px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; padding: 3px 6px; border-radius: 5px;
      background: color-mix(in srgb, var(--accent-light) 14%, transparent); color: var(--accent-light); }
    .tg-icon-btn { width: 32px; height: 32px; border-radius: 9px; border: 0; background: transparent; color: var(--text-dim);
      display: inline-grid; place-items: center; cursor: pointer; transition: background var(--dur), color var(--dur); }
    .tg-icon-btn:hover { background: var(--surface-2); color: var(--text); }
    .tg-icon-btn svg { width: 18px; height: 18px; }

    /* inputs */
    .tg-input { width: 100%; min-height: 38px; padding: 8px 11px; border-radius: var(--r-input); background: var(--surface);
      border: 1px solid var(--border); color: var(--text); }
    .tg-input::placeholder { color: var(--text-dim); }
    .tg-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-glow); }
    select.tg-input { appearance: none; padding-right: 30px; cursor: pointer;
      background-image: linear-gradient(45deg, transparent 50%, var(--text-dim) 50%), linear-gradient(135deg, var(--text-dim) 50%, transparent 50%);
      background-position: calc(100% - 15px) 52%, calc(100% - 10px) 52%; background-size: 5px 5px; background-repeat: no-repeat; }

    /* switch: <input type="checkbox" role="switch" class="tg-switch"> */
    .tg-switch { appearance: none; flex: none; position: relative; width: 38px; height: 22px; margin: 0; border-radius: 999px; cursor: pointer;
      background: var(--surface-3); border: var(--hair) solid var(--border); transition: background var(--dur); }
    .tg-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: var(--text-muted); transition: transform var(--dur) var(--ease), background var(--dur); }
    .tg-switch:checked { background: var(--primary); border-color: var(--primary); }
    .tg-switch:checked::after { transform: translateX(16px); background: #fff; }
    .tg-switch:disabled { opacity: .45; cursor: not-allowed; }

    /* segmented control: radios inside .tg-seg */
    .tg-seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 11px; background: var(--bg-deep); border: var(--hair) solid var(--border); }
    .tg-seg label { position: relative; }
    .tg-seg input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
    .tg-seg span { display: block; padding: 5px 11px; border-radius: 8px; font-size: 12.5px; color: var(--text-muted); cursor: pointer; transition: background var(--dur), color var(--dur); }
    .tg-seg input:checked + span { background: var(--surface-2); color: var(--text); box-shadow: inset 0 0 0 var(--hair) var(--border); }
    .tg-seg input:focus-visible + span { outline: 2px solid var(--primary); outline-offset: 1px; }

    /* cards */
    .tg-card { border-radius: var(--r-card); background: linear-gradient(160deg, var(--surface), var(--surface-2)); border: var(--hair) solid color-mix(in srgb, var(--border) 65%, transparent); }
    .tg-card.pad { padding: 18px; }
    .tg-card.flat { background: var(--surface); }

    /* verdict chip: tint + border + colour + icon + word (never colour alone) */
    .tg-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 8px; border-radius: 999px; font-weight: 600; font-size: 12.5px; line-height: 1.2;
      color: var(--c, var(--text-muted)); background: var(--cb, var(--surface-2)); border: 1px solid var(--cl, var(--border)); white-space: nowrap; }
    .tg-chip svg { width: 14px; height: 14px; flex: none; }
    .tg-chip.small { font-size: 11.5px; padding: 2px 8px 2px 6px; }
    .tg-chip.small svg { width: 12px; height: 12px; }
    [data-level="low"] { --c: var(--low); --cb: var(--low-bg); --cl: var(--low-line); }
    [data-level="caution"] { --c: var(--caution); --cb: var(--caution-bg); --cl: var(--caution-line); }
    [data-level="high"] { --c: var(--high); --cb: var(--high-bg); --cl: var(--high-line); }

    /* status chip (popup header) */
    .tg-status { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font: 500 10.5px/1.4 var(--font-mono);
      letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); background: var(--surface); border: var(--hair) solid var(--border); }
    .tg-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--sc, var(--text-dim)); box-shadow: 0 0 8px var(--sc, transparent); }
    .tg-status[data-state="in"] { --sc: var(--low); }
    .tg-status[data-state="local"] { --sc: var(--accent-light); }
    .tg-status[data-state="out"] { --sc: var(--text-dim); }
    .tg-status[data-state="offline"] { --sc: var(--caution); }

    /* score gauge (ring) */
    .tg-gauge { position: relative; display: inline-grid; place-items: center; flex: none; }
    .tg-gauge svg { display: block; transform: rotate(-90deg); }
    .tg-gauge .track { stroke: var(--surface-3); }
    .tg-gauge .arc { stroke: var(--c, var(--primary)); filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c, var(--primary)) 45%, transparent));
      transition: stroke-dashoffset 600ms var(--ease); }
    .tg-gauge .val { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
    .tg-gauge .num { font: 400 26px/1 var(--font-display); letter-spacing: -0.03em; color: var(--text); }
    .tg-gauge .of { font: 500 9px/1 var(--font-mono); letter-spacing: .12em; color: var(--text-dim); margin-top: 3px; }

    /* severity dot */
    .tg-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--d, var(--text-dim)); box-shadow: 0 0 8px var(--d, transparent); }
    .tg-dot[data-sev="high"] { --d: var(--high); }
    .tg-dot[data-sev="medium"] { --d: var(--caution); }
    .tg-dot[data-sev="low"] { --d: var(--text-dim); box-shadow: none; }
    .tg-dot[data-sev="ok"] { --d: var(--low); }

    /* signal row */
    .tg-signals { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .tg-signal { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; align-items: start; padding: 10px 12px; border-radius: 12px;
      background: var(--surface); border: var(--hair) solid color-mix(in srgb, var(--border) 55%, transparent); }
    .tg-signal-icon { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--surface-2); color: var(--accent-light); }
    .tg-signal-icon svg { width: 16px; height: 16px; }
    .tg-signal-name { margin: 0; font-weight: 600; font-size: 13.5px; line-height: 1.3; }
    .tg-signal-desc { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }
    .tg-signal .tg-dot { margin-top: 6px; }
    .tg-signal-sev { display: flex; align-items: center; gap: 6px; font: 500 10px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); margin-top: 4px; }

    /* check-list row */
    .tg-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .tg-check { display: grid; grid-template-columns: 24px 1fr; gap: 10px; align-items: start; }
    .tg-check-tile { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; background: var(--low-bg); color: var(--low); border: var(--hair) solid var(--low-line); }
    .tg-check-tile svg { width: 14px; height: 14px; }
    .tg-check-label { margin: 2px 0 0; font-weight: 500; }
    .tg-check-sub { margin: 1px 0 0; font-size: 12.5px; color: var(--text-dim); }

    /* stat tile */
    .tg-stat { padding: 12px; border-radius: 14px; background: var(--surface); border: var(--hair) solid color-mix(in srgb, var(--border) 60%, transparent); }
    .tg-stat .n { display: block; font: 400 28px/1 var(--font-display); letter-spacing: -0.03em; color: var(--c, var(--text)); margin-top: 8px; }

    /* sparkline + bars */
    .tg-spark { display: block; width: 100%; height: auto; overflow: visible; }
    .tg-spark .line { fill: none; stroke: var(--accent-light); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
    .tg-spark .area { fill: url(#tg-spark-fill); }
    .tg-spark .pt { fill: var(--bg); stroke: var(--accent-light); stroke-width: 1.5; }
    .tg-bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .tg-bar-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; }
    .tg-bar-head span:last-child { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
    .tg-bar { height: 6px; margin-top: 5px; border-radius: 3px; background: var(--surface-3); overflow: hidden; display: flex; }
    .tg-bar i { display: block; height: 100%; }
    .tg-bar i[data-level="low"] { background: var(--low); } .tg-bar i[data-level="caution"] { background: var(--caution); } .tg-bar i[data-level="high"] { background: var(--high); }

    /* empty / loading / error states */
    .tg-empty { display: grid; justify-items: center; text-align: center; gap: 8px; padding: 28px 16px; color: var(--text-muted); }
    .tg-empty-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--surface-2); color: var(--accent-light); }
    .tg-empty-icon svg { width: 20px; height: 20px; }
    .tg-empty p { margin: 0; max-width: 32ch; }
    .tg-empty .t { color: var(--text); font-weight: 600; }
    .tg-empty[data-kind="error"] .tg-empty-icon { color: var(--caution); background: var(--caution-bg); }
    .tg-skel { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2)); background-size: 200% 100%; animation: tg-shimmer 1.4s linear infinite; }
    @keyframes tg-shimmer { to { background-position: -200% 0; } }

    /* textures and decoration */
    .tg-grid-bg { background-color: var(--bg);
      background-image: radial-gradient(ellipse 80% 55% at 50% -10%, var(--primary-glow), transparent 70%), radial-gradient(var(--grid-dot) 1px, transparent 1.2px);
      background-size: 100% 100%, 18px 18px; }
    .tg-node { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--n, var(--primary)); box-shadow: 0 0 10px 1px var(--n, var(--primary)); }
    .tg-node.amber { --n: var(--caution); } .tg-node.green { --n: var(--low); } .tg-node.blue { --n: var(--accent-light); }
    .tg-hr { height: var(--hair); border: 0; margin: 0; background: color-mix(in srgb, var(--border) 65%, transparent); }

    /* shield button (in-page) */
    .tg-shield { box-sizing: border-box; width: 30px; height: 30px; border-radius: 9px; border: 0; padding: 0; display: grid; place-items: center; cursor: pointer; position: relative;
      background: var(--primary); color: #fff; box-shadow: 0 0 0 1px rgba(255,255,255,.18), 0 4px 16px var(--primary-glow), 0 0 18px var(--primary-glow);
      transition: transform var(--dur) var(--ease), background var(--dur); }
    .tg-shield:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .tg-shield svg { width: 17px; height: 17px; pointer-events: none; }
    .tg-shield::after { content: ""; position: absolute; inset: -4px; border-radius: 12px; border: 2px solid var(--accent-light); opacity: 0; pointer-events: none; }
    .tg-shield[aria-busy="true"] { cursor: progress; }
    .tg-shield[aria-busy="true"]::after { animation: tg-ring 1.1s var(--ease) infinite; }
    @keyframes tg-ring { 0% { transform: scale(.85); opacity: .9; } 100% { transform: scale(1.45); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .tg-shield[aria-busy="true"]::after { animation: none; opacity: .8; transform: none; }
      .tg-skel { animation: none; }
      .tg-gauge .arc { transition: none; }
    }
  `;

  // ---- adopt into a document or shadow root -------------------------------
  const sheets = new WeakMap(); // document -> CSSStyleSheet
  function sheetFor(doc) {
    let sheet = sheets.get(doc);
    if (!sheet) {
      const Sheet = doc.defaultView ? doc.defaultView.CSSStyleSheet : CSSStyleSheet;
      sheet = new Sheet();
      sheet.replaceSync(TOKENS_CSS + COMPONENTS_CSS);
      sheets.set(doc, sheet);
    }
    return sheet;
  }

  // target: a Document or ShadowRoot. extraCss: surface-specific styles.
  function adopt(target, extraCss) {
    const doc = target.nodeType === 9 ? target : target.ownerDocument;
    const list = [sheetFor(doc)];
    if (extraCss) {
      const s = new CSSStyleSheet();
      s.replaceSync(extraCss);
      list.push(s);
    }
    target.adoptedStyleSheets = [...target.adoptedStyleSheets.filter((s) => s !== list[0]), ...list];
    loadFonts();
  }

  // ---- fonts ---------------------------------------------------------------
  // Base URL of the extension (or of the folder when the dev gallery is
  // served over http for review).
  const scriptSrc = root.document && root.document.currentScript ? root.document.currentScript.src : "";
  function assetUrl(path) {
    if (root.chrome && root.chrome.runtime && root.chrome.runtime.getURL) return root.chrome.runtime.getURL(path);
    return new URL("../" + path, scriptSrc || root.location.href).href;
  }

  let fontsPromise = null;
  function loadFonts() {
    if (fontsPromise || !root.document || !root.FontFace) return fontsPromise;
    fontsPromise = Promise.all(
      FONT_FILES.map(async ([family, path]) => {
        try {
          const res = await fetch(assetUrl(path));
          const face = new FontFace(family, await res.arrayBuffer(), { weight: "100 900", style: "normal", display: "swap" });
          await face.load();
          root.document.fonts.add(face);
        } catch (_) {
          // System fonts take over; the UI still works.
        }
      })
    );
    return fontsPromise;
  }

  // Theme for a page: <html data-theme>. Shadow hosts set their own.
  function applyTheme(target, theme) {
    const el = target.nodeType === 9 ? target.documentElement : target;
    el.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  }

  root.TrustGraphDesign = { DARK, LIGHT, FONT, TOKENS_CSS, COMPONENTS_CSS, adopt, loadFonts, applyTheme, assetUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TrustGraphDesign;
})(globalThis);
