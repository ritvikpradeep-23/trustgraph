// TrustGraph UI components, built with DOM calls only (never innerHTML),
// so message text can never inject markup. Styles: shared/design.js.
// Used by the popup, the welcome/options page, the dev gallery and the
// in-page panel (inside its closed shadow root).
//
//   const U = TrustGraphUI;
//   U.el("p", {class: "x", text: "hi"}, [children])
//   U.icon("shieldCheck")   U.logo()   U.chip("high")   U.gauge(82, "high")
//   U.signalRow({icon, name, description, severity})   U.checkRow(label, sub)
//   U.statTile(label, value, level)   U.sparkline(values)   U.barList(rows)
//   U.button(label, {primary, arrow, icon, tag, small, onclick})
//   U.empty({icon, title, text, kind})   U.skeleton(width)
(function (root) {
  "use strict";
  if (root.TrustGraphUI) return;
  const Icons = root.TrustGraphIcons;
  const NS = "http://www.w3.org/2000/svg";

  // Verdict levels. Each has its own icon SHAPE (circle / triangle /
  // octagon), so the verdict never relies on colour alone.
  const LEVELS = {
    low: { label: "Low risk", short: "Low", icon: "circleCheck" },
    caution: { label: "Caution", short: "Caution", icon: "triangleAlert" },
    high: { label: "High risk", short: "High", icon: "octagonAlert" },
  };

  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "value" || k === "selected") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children || [])) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    return n;
  }

  const icon = (name, opts) => Icons.make(name, opts);

  function logo(opts = {}) {
    const word = el("span", { class: "tg-wordmark" }, ["Trust", el("span", { text: "Graph" })]);
    return el(opts.href ? "a" : "span", { class: "tg-logo", href: opts.href, "aria-label": opts.href ? "TrustGraph" : null }, [
      el("span", { class: "tg-logo-tile", "aria-hidden": "true" }, [icon("shieldCheck", { stroke: 2 })]),
      opts.markOnly ? null : word,
    ]);
  }

  const eyebrow = (text, blue) => el("p", { class: "tg-eyebrow" + (blue ? " blue" : ""), text });

  function chip(level, opts = {}) {
    const L = LEVELS[level];
    if (!L) return el("span", { class: "tg-chip" + (opts.small ? " small" : ""), text: opts.text || "Unchecked" });
    return el("span", { class: "tg-chip" + (opts.small ? " small" : ""), "data-level": level }, [icon(L.icon, { stroke: 2 }), opts.text || (opts.short ? L.short : L.label)]);
  }

  // Score ring: 0-100 in the verdict colour. The number is always shown.
  function gauge(score, level, opts = {}) {
    const size = opts.size || 96;
    const stroke = opts.stroke || 7;
    const r = (size - stroke) / 2 - 2;
    const c = 2 * Math.PI * r;
    const known = typeof score === "number" && isFinite(score);
    const v = known ? Math.max(0, Math.min(100, Math.round(score))) : 0;
    const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" });
    svg.append(
      svgEl("circle", { class: "track", cx: size / 2, cy: size / 2, r, fill: "none", "stroke-width": stroke }),
      svgEl("circle", { class: "arc", cx: size / 2, cy: size / 2, r, fill: "none", "stroke-width": stroke, "stroke-linecap": "round", "stroke-dasharray": c, "stroke-dashoffset": c * (1 - v / 100) })
    );
    return el("div", { class: "tg-gauge", "data-level": level || null, role: "img", "aria-label": known ? `Risk score ${v} out of 100` : "Risk score not available" }, [
      svg,
      el("div", { class: "val", "aria-hidden": "true" }, [el("span", { class: "num", text: known ? String(v) : "–", style: opts.numSize ? `font-size:${opts.numSize}px` : null }), opts.hideOf ? null : el("span", { class: "of", text: "/ 100" })]),
    ]);
  }

  const SEV_WORD = { high: "High", medium: "Medium", low: "Low", ok: "Clear" };
  const dot = (sev) => el("span", { class: "tg-dot", "data-sev": sev || "low", "aria-hidden": "true" });

  // One signal: icon tile, name, short description, severity dot + word.
  function signalRow(s, extra) {
    return el("li", { class: "tg-signal" }, [
      el("span", { class: "tg-signal-icon", "aria-hidden": "true" }, [icon(s.icon || "activity")]),
      el("div", null, [
        el("p", { class: "tg-signal-name", text: s.name }),
        s.description ? el("p", { class: "tg-signal-desc", text: s.description }) : null,
        extra || null,
      ]),
      el("div", { class: "tg-signal-sev", title: `${SEV_WORD[s.severity] || "Low"} severity` }, [dot(s.severity), el("span", { text: SEV_WORD[s.severity] || "Low" })]),
    ]);
  }

  function checkRow(label, sub) {
    return el("li", { class: "tg-check" }, [
      el("span", { class: "tg-check-tile", "aria-hidden": "true" }, [icon("check", { stroke: 2.2 })]),
      el("div", null, [el("p", { class: "tg-check-label", text: label }), sub ? el("p", { class: "tg-check-sub", text: sub }) : null]),
    ]);
  }

  function statTile(label, value, level) {
    return el("div", { class: "tg-stat", "data-level": level || null }, [
      el("p", { class: "tg-eyebrow", style: "display:flex;align-items:center;gap:6px" }, [level ? dot(level === "low" ? "ok" : level === "caution" ? "medium" : "high") : null, label]),
      el("span", { class: "n", text: String(value) }),
    ]);
  }

  // values: numbers (null = no data that day). labels: for the a11y text.
  function sparkline(values, opts = {}) {
    const w = opts.width || 320;
    const h = opts.height || 56;
    const pad = 4;
    const max = Math.max(opts.max || 0, ...values.filter((v) => v !== null), 1);
    const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
    const pts = values.map((v, i) => [pad + i * step, v === null ? null : h - pad - (v / max) * (h - pad * 2)]);
    const known = pts.filter((p) => p[1] !== null);
    const svg = svgEl("svg", { class: "tg-spark", viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": opts.label || "Risk over time" });
    const defs = svgEl("defs");
    const grad = svgEl("linearGradient", { id: "tg-spark-fill", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svgEl("stop", { offset: "0", "stop-color": "var(--accent-light)", "stop-opacity": ".28" }), svgEl("stop", { offset: "1", "stop-color": "var(--accent-light)", "stop-opacity": "0" }));
    defs.append(grad);
    svg.append(defs);
    if (known.length) {
      const d = known.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      svg.append(svgEl("path", { class: "area", d: `${d} L${known[known.length - 1][0].toFixed(1)} ${h} L${known[0][0].toFixed(1)} ${h} Z` }), svgEl("path", { class: "line", d }));
      const last = known[known.length - 1];
      svg.append(svgEl("circle", { class: "pt", cx: last[0], cy: last[1], r: 3 }));
    }
    return svg;
  }

  // rows: [{label, total, low, caution, high}] -> stacked bars, scaled to the largest total.
  function barList(rows) {
    const max = Math.max(1, ...rows.map((r) => r.total));
    return el(
      "ul",
      { class: "tg-bars" },
      rows.map((r) =>
        el("li", null, [
          el("div", { class: "tg-bar-head" }, [el("span", { text: r.label }), el("span", { text: `${r.total} checked · ${r.high || 0} high` })]),
          el(
            "div",
            { class: "tg-bar", role: "img", "aria-label": `${r.label}: ${r.low || 0} low, ${r.caution || 0} caution, ${r.high || 0} high risk` },
            ["low", "caution", "high"].map((lv) => (r[lv] ? el("i", { "data-level": lv, style: `width:${(r[lv] / max) * 100}%` }) : null))
          ),
        ])
      )
    );
  }

  function button(label, opts = {}) {
    const cls = ["tg-btn", opts.primary && "primary", opts.ghost && "ghost", opts.danger && "danger", opts.small && "small", opts.block && "block"].filter(Boolean).join(" ");
    return el("button", { type: "button", class: cls, onclick: opts.onclick, disabled: opts.disabled, "data-key": opts.key, title: opts.title, "aria-label": opts.ariaLabel, "aria-pressed": opts.pressed === undefined ? null : String(opts.pressed) }, [
      opts.icon ? icon(opts.icon) : null,
      el("span", { text: label }),
      opts.tag ? el("span", { class: "tg-tag", text: opts.tag }) : null,
      opts.arrow ? icon("arrowRight") : null,
    ]);
  }

  function iconButton(name, label, onclick, key) {
    return el("button", { type: "button", class: "tg-icon-btn", "aria-label": label, title: label, onclick, "data-key": key }, [icon(name)]);
  }

  function empty(opts = {}) {
    return el("div", { class: "tg-empty", "data-kind": opts.kind || null, role: opts.kind === "error" ? "alert" : null }, [
      el("span", { class: "tg-empty-icon", "aria-hidden": "true" }, [icon(opts.icon || (opts.kind === "error" ? "triangleAlert" : "history"))]),
      opts.title ? el("p", { class: "t", text: opts.title }) : null,
      opts.text ? el("p", { text: opts.text }) : null,
      opts.action || null,
    ]);
  }

  const skeleton = (width, height) => el("span", { class: "tg-skel", style: `width:${width || "100%"};${height ? `height:${height}px` : ""}`, "aria-hidden": "true" });

  function switchInput(id, checked, onchange, label) {
    return el("input", { type: "checkbox", role: "switch", class: "tg-switch", id, checked: !!checked, "aria-label": label, onchange });
  }

  // radios as a segmented control. options: [[value, label]]
  function segmented(name, options, value, onchange, label) {
    return el(
      "div",
      { class: "tg-seg", role: "radiogroup", "aria-label": label },
      options.map(([v, l]) => el("label", null, [el("input", { type: "radio", name, value: v, checked: v === value, onchange: () => onchange(v) }), el("span", { text: l })]))
    );
  }

  // "12 min ago", "Yesterday 14:05", "3 Oct 09:12"
  function timeAgo(ts, now = Date.now()) {
    const d = new Date(ts);
    const diff = (now - ts) / 1000;
    if (diff < 60) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const today = new Date(now);
    if (d.toDateString() === today.toDateString()) return "Today " + hm;
    const y = new Date(now - 86400000);
    if (d.toDateString() === y.toDateString()) return "Yesterday " + hm;
    return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + hm;
  }

  root.TrustGraphUI = { LEVELS, el, svgEl, icon, logo, eyebrow, chip, gauge, dot, signalRow, checkRow, statTile, sparkline, barList, button, iconButton, empty, skeleton, switchInput, segmented, timeAgo };
})(globalThis);
