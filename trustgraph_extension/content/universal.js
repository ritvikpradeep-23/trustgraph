// Universal click-to-check: one shield on checkable content on ANY website,
// in every frame, with no site selectors, hostnames or class names.
//
//   What counts as checkable (found under the pointer, see contentAt()):
//     media  <img>, <video>, <canvas> and CSS background images, at least
//            TG.UNIVERSAL.minMedia px on both sides
//     text   a visible block of at least TG.UNIVERSAL.minText characters
//            (TrustGraphKit.textBlock), only where no site adapter already
//            handles the page, so WhatsApp, Gmail, etc. behave exactly as
//            before
//   A MutationObserver (document and every open shadow root) and an
//   IntersectionObserver keep a live set of on-screen media, so lazy-loaded,
//   infinite-scroll and SPA-navigated content is picked up as it appears.
//
//   Capture, in order: read the pixels directly (canvas / fetch) -> if the
//   page blocks that (cross-origin, blob:, DRM), a screenshot of the tab
//   cropped to the element (background-universal.js). Video: TG.UNIVERSAL
//   .videoFrames frames over .videoSeconds seconds, with their timestamps.
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
  const MEDIA = "img, video, canvas";
  const KIND_LABEL = { text: "Text check", image: "Image check", video: "Video check" };

  let settings = { paused: false, theme: "dark" };
  let current = null; // {el, kind, bg?} under the pointer
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
  // On-screen media: MutationObserver (+ open shadow roots) feeding an
  // IntersectionObserver.
  // ---------------------------------------------------------------------
  const onScreen = new Set();
  const tracked = new WeakSet();
  const watchedRoots = new WeakSet();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) onScreen.add(e.target);
        else onScreen.delete(e.target);
      }
    },
    { threshold: 0.05 }
  );

  function trackTree(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) return;
    if (node.nodeType === 1 && node.matches(MEDIA)) trackOne(node);
    for (const el of node.querySelectorAll(MEDIA)) trackOne(el);
    if (node.nodeType === 1 && node.shadowRoot) watchRoot(node.shadowRoot);
    for (const el of node.querySelectorAll("*")) if (el.shadowRoot) watchRoot(el.shadowRoot);
  }
  function trackOne(el) {
    if (tracked.has(el)) return;
    tracked.add(el);
    io.observe(el);
  }

  let pending = [];
  let flushTimer = 0;
  function watchRoot(root) {
    if (watchedRoots.has(root)) return;
    watchedRoots.add(root);
    new MutationObserver((mutations) => {
      for (const m of mutations) for (const n of m.addedNodes) if (n.nodeType === 1) pending.push(n);
      if (pending.length && !flushTimer) flushTimer = setTimeout(flush, 250); // batched
    }).observe(root, { childList: true, subtree: true });
    trackTree(root);
  }
  function flush() {
    flushTimer = 0;
    const batch = pending.splice(0, 400);
    for (const n of batch) if (n.isConnected) trackTree(n);
    for (const el of onScreen) if (!el.isConnected) onScreen.delete(el);
    if (pending.length) flushTimer = setTimeout(flush, 250);
  }

  // ---------------------------------------------------------------------
  // What's under the pointer
  // ---------------------------------------------------------------------
  function deepStack(x, y) {
    const out = [];
    let stack = document.elementsFromPoint(x, y);
    for (let depth = 0; depth < 4; depth++) {
      const next = [];
      for (const el of stack) {
        out.push(el);
        if (el.shadowRoot && el !== host) next.push(...el.shadowRoot.elementsFromPoint(x, y).filter((e) => e !== el));
      }
      if (!next.length) break;
      stack = next;
    }
    return out;
  }

  const big = (r) => r.width >= CFG.minMedia && r.height >= CFG.minMedia;

  function bgUrl(el) {
    const v = getComputedStyle(el).backgroundImage;
    const m = v && v !== "none" && v.match(/url\(["']?([^"')]+)["']?\)/);
    return m ? m[1] : null;
  }

  function mediaAt(x, y) {
    const stack = deepStack(x, y).filter((el) => el !== host).slice(0, 14);
    for (const el of stack) {
      const tag = el.tagName;
      if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS") {
        if (!big(el.getBoundingClientRect())) continue;
        if (tag === "IMG" && !(el.complete && el.naturalWidth)) continue;
        if (!onScreen.has(el)) trackOne(el); // not seen by the observers yet
        return { el, kind: tag === "VIDEO" ? "video" : "image" };
      }
      const url = bgUrl(el);
      if (url && !/^data:image\/svg/.test(url) && big(el.getBoundingClientRect())) return { el, kind: "image", bg: url };
    }
    return null;
  }

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
    // Media: top-left, away from the players' own top-right buttons and the
    // chat shield. Text: top-right, like the chat shield.
    const left = current.kind === "text" ? Math.min(innerWidth - SHIELD - 4, r.right - SHIELD - 6) : Math.max(4, r.left + 6);
    shield.style.left = Math.max(4, left) + "px";
    shield.style.top = Math.max(4, Math.min(innerHeight - SHIELD - 4, r.top + 6)) + "px";
    shield.style.display = "grid";
  }

  function showShield(hit) {
    ensureHost();
    debug("shield on", hit.kind, hit.el.tagName + (hit.bg ? " (background image)" : ""), hit.el);
    current = hit;
    placeShield();
  }

  function hideShield() {
    if (busy) return;
    shield.style.display = "none";
    current = null;
  }

  // Hover: one lookup per animation frame, from the pointer position (so
  // overlays laid over an image, as on Instagram, don't hide it).
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
    const hit = mediaAt(point.x, point.y) || textAt(point.target);
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
  // Capture
  // ---------------------------------------------------------------------
  function scaled(w, h) {
    const fit = Math.min(1, CFG.maxSide / Math.max(w, h));
    return [Math.max(1, Math.round(w * fit)), Math.max(1, Math.round(h * fit))];
  }

  // Pixels -> JPEG data: URL. Throws a SecurityError when the page's
  // pixels are cross-origin (a "tainted" canvas).
  function draw(source) {
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    if (!w || !h) throw new Error("nothing to draw yet");
    const [cw, ch] = scaled(w, h);
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, Math.min(cw, 16), Math.min(ch, 16)).data; // throws if tainted
    if (source.tagName === "VIDEO" && isBlack(px)) throw new Error("blank frame (protected video)");
    return c.toDataURL("image/jpeg", CFG.jpegQuality);
  }
  function isBlack(px) {
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) return false;
    return true;
  }

  // 1. the pixels on the page (same-origin or CORS-enabled), 2. the image
  // downloaded by the background (no CORS errors on the page), 3. a
  // screenshot of the tab cropped to the element.
  async function captureImage(t) {
    if (!t.bg) {
      try {
        return { data: draw(t.el), how: "direct" };
      } catch (_) {
        // cross-origin ("tainted") or not readable
      }
    }
    const url = t.bg || (t.el.tagName === "IMG" ? t.el.currentSrc || t.el.src : null);
    if (url && /^https?:/.test(url)) {
      const res = await send({ type: TG.MSG.UNIVERSAL_FETCH, url, maxSide: CFG.maxSide, quality: CFG.jpegQuality }).catch(() => null);
      if (res && res.dataUrl) return { data: res.dataUrl, how: "fetch" };
    }
    return { data: await screenshot(t.el), how: "screenshot" };
  }

  // Sample frames while the video plays (it's never seeked or paused).
  async function captureVideo(t, onProgress) {
    const v = t.el;
    const n = Math.max(1, CFG.videoFrames);
    const gap = n > 1 ? (CFG.videoSeconds * 1000) / (n - 1) : 0;
    const drm = !!v.mediaKeys;
    const frames = [];
    let how = drm ? "screenshot" : null;
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      const wait = start + i * gap - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      let data = null;
      if (how !== "screenshot") {
        try {
          data = draw(v);
          how = "direct";
        } catch (_) {
          how = "screenshot"; // tainted, blob:/MSE from elsewhere, or DRM
        }
      }
      if (!data) data = await screenshot(v);
      frames.push({ t: Math.round(v.currentTime * 100) / 100, data });
      onProgress(i + 1, n);
    }
    return { frames, how, paused: v.paused };
  }

  // --- screenshot fallback --------------------------------------------------
  // The crop rect must be in the TOP frame's viewport, so a frame asks its
  // parent where it sits (recursively up to the top). Only offsets are
  // exchanged, never content.
  const OFFSET = "__trustgraphUniversalOffset";
  addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d[OFFSET] !== "ask" || !e.source) return;
    const frameEl = Array.from(document.querySelectorAll("iframe, frame")).find((f) => {
      try {
        return f.contentWindow === e.source;
      } catch (_) {
        return false;
      }
    });
    if (!frameEl) return;
    const r = frameEl.getBoundingClientRect();
    const cs = getComputedStyle(frameEl);
    const inner = { x: r.left + frameEl.clientLeft + parseFloat(cs.paddingLeft || 0), y: r.top + frameEl.clientTop + parseFloat(cs.paddingTop || 0) };
    frameOffset().then((mine) => {
      if (mine) e.source.postMessage({ [OFFSET]: "reply", id: d.id, x: mine.x + inner.x, y: mine.y + inner.y, vw: mine.vw }, "*");
    });
  });

  function frameOffset() {
    if (window === window.top) return Promise.resolve({ x: 0, y: 0, vw: innerWidth });
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const done = (value) => {
        removeEventListener("message", onReply);
        resolve(value);
      };
      const onReply = (e) => {
        if (e.source === window.parent && e.data && e.data[OFFSET] === "reply" && e.data.id === id) done({ x: e.data.x, y: e.data.y, vw: e.data.vw });
      };
      addEventListener("message", onReply);
      window.parent.postMessage({ [OFFSET]: "ask", id }, "*");
      setTimeout(() => done(null), 1500);
    });
  }

  // The part of the element that shows the picture: videos (and images with
  // object-fit) are letterboxed inside their box, and the black bars would
  // throw the fingerprint off.
  function pictureRect(el) {
    const r = el.getBoundingClientRect();
    const w = el.videoWidth || el.naturalWidth;
    const h = el.videoHeight || el.naturalHeight;
    const fit = getComputedStyle(el).objectFit; // <video> is "contain" by default
    if (!w || !h || (fit !== "contain" && fit !== "scale-down")) return r;
    const scale = Math.min(r.width / w, r.height / h, fit === "scale-down" ? 1 : Infinity);
    const cw = w * scale;
    const ch = h * scale;
    return { left: r.left + (r.width - cw) / 2, top: r.top + (r.height - ch) / 2, right: r.left + (r.width + cw) / 2, bottom: r.top + (r.height + ch) / 2 };
  }

  async function screenshot(el) {
    const r = pictureRect(el);
    const x0 = Math.max(0, r.left);
    const y0 = Math.max(0, r.top);
    const x1 = Math.min(innerWidth, r.right);
    const y1 = Math.min(innerHeight, r.bottom);
    if (x1 - x0 < 8 || y1 - y0 < 8) throw new Error("Scroll it into view, then try again: only what's on screen can be captured.");
    const off = await frameOffset();
    if (!off) throw new Error("Couldn't find this frame on the page to take a screenshot.");
    // Our own UI, and whatever the site stacks over the picture (a player's
    // control bar, a transparent overlay), must not end up in it: they are
    // hidden for the capture frame only, then restored.
    host.style.visibility = "hidden";
    const covered = overlaysAbove(el, r);
    for (const c of covered) c.el.style.setProperty("visibility", "hidden", "important");
    await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
    try {
      // getBoundingClientRect is already relative to the viewport, which is
      // exactly what captureVisibleTab captures, so no scroll offset is
      // added; the background scales CSS px to device px.
      const res = await send({ type: TG.MSG.UNIVERSAL_CAPTURE, rect: { x: off.x + x0, y: off.y + y0, w: x1 - x0, h: y1 - y0 }, viewportWidth: off.vw, dpr: devicePixelRatio, maxSide: CFG.maxSide, quality: CFG.jpegQuality });
      if (!res || !res.dataUrl) throw new Error((res && res.error) || "screenshot failed");
      return res.dataUrl;
    } finally {
      for (const c of covered) {
        if (c.value) c.el.style.setProperty("visibility", c.value, c.priority);
        else c.el.style.removeProperty("visibility");
      }
      host.style.visibility = "";
    }
  }

  // Elements painted over the picture: found at a few points inside it,
  // excluding the element's own ancestors, and only ones no bigger than
  // about the picture itself (never a page-wide container).
  function overlaysAbove(el, r) {
    const area = Math.max(1, (r.right - r.left) * (r.bottom - r.top));
    const found = new Set();
    const xs = [0.5, 0.15, 0.85].map((f) => r.left + (r.right - r.left) * f);
    const ys = [0.5, 0.92, 0.08].map((f) => r.top + (r.bottom - r.top) * f);
    for (const x of xs) {
      for (const y of ys) {
        for (const o of document.elementsFromPoint(x, y)) {
          if (o === el || o.contains(el) || o === host) break; // everything after this is underneath
          const b = o.getBoundingClientRect();
          if (b.width * b.height <= area * 1.6) found.add(o);
        }
      }
    }
    return [...found].map((o) => ({ el: o, value: o.style.getPropertyValue("visibility"), priority: o.style.getPropertyPriority("visibility") }));
  }

  // ---------------------------------------------------------------------
  // Check + result card
  // ---------------------------------------------------------------------
  const CAPTURE_LABEL = { direct: "Read directly from the page", fetch: "Downloaded from its address", screenshot: "Screenshot of the page (the site doesn't allow reading it directly)" };

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
      ...[UI.el("div", { class: "head" }, [UI.icon(desc.kind === "text" ? "messageCircle" : "scan"), UI.el("span", { class: "title", text: "TrustGraph · " + KIND_LABEL[desc.kind] }), UI.iconButton("x", "Close", () => (card.style.display = "none"))]),
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

  // The top frame shows cards for its frames, and hides itself while a
  // frame's screenshot is taken.
  if (window === window.top) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== TG.MSG.UNIVERSAL_CARD) return;
      if (msg.desc) drawCard(msg.desc);
      if (msg.hide !== undefined) {
        host.style.visibility = msg.hide ? "hidden" : "";
        requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ ok: true })));
        return true;
      }
      sendResponse({ ok: true });
    });
  }

  function dbRow(fp) {
    if (!fp) return row("database", "Known-fakes database", "Not checked: the server didn't answer.");
    if (fp.available === false) return row("database", "Known-fakes database unavailable", fp.reason || "");
    if (fp.db_match) {
      const extra = fp.frames_checked ? ` · ${fp.frames_matched} of ${fp.frames_checked} frames` : "";
      return row("fingerprint", "Matches a known fake", `Similarity ${Math.round(fp.similarity * 100)}% · record ${String(fp.matched_record_id).slice(0, 8)}${fp.label ? " · " + fp.label : ""}${extra}`, "match");
    }
    return row("database", "No match in the known-fakes database", "It isn't a copy of anything already in the database. New fakes still need the model's answer.");
  }

  // Text: the reported scams in the database (/api/detect).
  function reportedRow(v) {
    const db = v.database;
    if (!db) return row("database", "Reported scams database", v.offline ? "Not checked: the TrustGraph server isn't reachable." : "Not checked: the server didn't answer.");
    if (!db.matches) return row("database", "No match in the reported scams database", "It isn't like any scam reported to TrustGraph so far.");
    return row("fingerprint", `Matches ${db.matches === 1 ? "a reported scam" : db.matches + " reported scams"}`, `Similarity ${Math.round(db.top.similarity * 100)}% · ${db.top.reportType}${db.top.status ? " · " + db.top.status : ""}`, "match");
  }

  function modelRow(d) {
    if (!d) return row("activity", "Deepfake model", "No answer.");
    if (d.result === "not_checked") return row("activity", "Deepfake model: not connected yet", d.reason || "No model is configured on the server, so no score was produced.");
    if (d.result === "inconclusive") return row("activity", "Deepfake model: inconclusive", `No face found in ${d.frames_examined} frame${d.frames_examined === 1 ? "" : "s"}, so nothing was scored.`);
    const label = d.result === "likely_fake" ? "Likely fake" : "Likely real";
    return row(d.result === "likely_fake" ? "octagonAlert" : "circleCheck", `Deepfake model: ${label}`, `Confidence ${Math.round((d.confidence || 0) * 100)}% · ${d.faces_examined} face${d.faces_examined === 1 ? "" : "s"} in ${d.frames_examined} frame${d.frames_examined === 1 ? "" : "s"}${d.mock ? " · demo model" : ""}`);
  }

  async function runCheck(t) {
    busy = true;
    shield.setAttribute("aria-busy", "true");
    const kind = t.kind;
    renderCard(kind, [busyRow(kind === "video" ? "Sampling frames…" : "Checking…")]);
    try {
      let res;
      if (kind === "text") {
        const text = kit.text(t.el, "script, style, nav, button", { lines: true });
        res = await send({ type: TG.MSG.UNIVERSAL_CHECK, kind, text });
      } else if (kind === "image") {
        const cap = await captureImage(t);
        renderCard(kind, [busyRow("Checking…")]);
        res = await send({ type: TG.MSG.UNIVERSAL_CHECK, kind, payload: cap.data, capture: cap.how });
      } else {
        const cap = await captureVideo(t, (i, n) => renderCard(kind, [busyRow(`Sampling frame ${i} of ${n}…`)]));
        renderCard(kind, [busyRow("Checking frames…")]);
        res = await send({ type: TG.MSG.UNIVERSAL_CHECK, kind, payload: cap.frames, capture: cap.how });
        if (res && !res.error) res.paused = cap.paused;
      }
      showResult(kind, res);
    } catch (err) {
      renderCard(kind, [row("info", "Couldn't check this", String((err && err.message) || err))]);
    } finally {
      busy = false;
      shield.removeAttribute("aria-busy");
    }
  }

  function showResult(kind, res) {
    const dbMatch = res && res.fingerprint ? res.fingerprint.db_match : res && res.verdict && res.verdict.database ? res.verdict.database.matches > 0 : "-";
    debug("result", kind, res && res.error ? "error=" + res.error : `capture=${res.capture || "-"} model=${(res.deepfake && res.deepfake.result) || (res.verdict && res.verdict.riskLevel) || "-"} db_match=${dbMatch}`);
    if (!res || res.error) {
      renderCard(kind, [row(res && res.error === "offline" ? "wifiOff" : "info", "Couldn't check this", (res && res.message) || "No answer from TrustGraph.")]);
      return;
    }
    if (kind === "text") {
      const v = res.verdict || {};
      if (v.empty) return renderCard(kind, [row("info", "Nothing to check", "No readable text here.")]);
      const level = v.riskLevel || "low";
      const rows = [{ icon: "gauge", chip: { level, text: `${UI.LEVELS[level].label} · ${v.score}` }, detail: v.explanation || "" }];
      rows.push(res.engine === "local" ? row("database", "Reported scams database", "Not checked: Settings → Engine is on-device only.") : reportedRow(v));
      return renderCard(kind, rows);
    }
    const frames = kind === "video" ? `${res.frames} frames over ${CFG.videoSeconds} s${res.paused ? " (the video was paused, so they may be identical)" : ""}. ` : "";
    renderCard(kind, [modelRow(res.deepfake), dbRow(res.fingerprint)], frames + (CAPTURE_LABEL[res.capture] || "") + ".");
  }

  // ---------------------------------------------------------------------
  watchRoot(document);
  loadSettings();
})();
