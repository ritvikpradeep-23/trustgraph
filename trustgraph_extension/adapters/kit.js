// Small helpers shared by every site adapter. Loaded before the adapters.
//
// THE ADAPTER CONTRACT (keep it, so anyone can replace one adapter file
// without touching content/core.js). Each adapter pushes onto
// window.TrustGraphAdapters an object with:
//   channel          "whatsapp" | "gmail" | "messenger" | "instagram" | "test"
//   matches(url)     true when the adapter should be active on this URL
//   findMessage(t)   the message element containing node t, or null
//   extractText(el)  only the message body (no sender, time, ticks, quotes)
//   sender(el)       best-effort sender string, or null
//   selfTest()       how many messages it recognizes on the page right now
// Optional extras used for debugging:
//   strategies       ordered [{name, find(target), all()}] tried in turn
//   listMessages()   the recognized message elements (debug outlines)
//   lastStrategy     name of the strategy that matched last
(function (root) {
  "use strict";
  root.TrustGraphAdapters = root.TrustGraphAdapters || [];

  const MAX_TEXT = (root.TG && root.TG.MAX_TEXT) || 4000;

  // Try each strategy's find() in order. Records which one matched.
  function find(adapter, target) {
    if (!target || target.nodeType !== 1) target = target && target.parentElement;
    if (!target) return null;
    for (const strategy of adapter.strategies) {
      let el = null;
      try {
        el = strategy.find(target);
      } catch (_) {
        el = null; // a bad selector must never break the page
      }
      if (el) {
        adapter.lastStrategy = strategy.name;
        return el;
      }
    }
    return null;
  }

  // All messages from the FIRST strategy that recognizes any.
  function list(adapter) {
    for (const strategy of adapter.strategies) {
      let found = [];
      try {
        found = Array.from(strategy.all());
      } catch (_) {}
      if (found.length) {
        adapter.lastStrategy = strategy.name;
        return found;
      }
    }
    return [];
  }

  // Readable text of `el`, leaving out any descendant matching `exclude`
  // (a CSS selector list such as ".time, .sender"). Walks the live DOM so
  // the page is never modified; adds a space at block boundaries and <br>.
  // With {lines: true}, <br> and block boundaries become line breaks instead
  // (for multi-line chat messages).
  function text(el, exclude, opts) {
    const lines = !!(opts && opts.lines);
    const gap = lines ? "\n" : " ";
    if (!el) return "";
    const parts = [];
    let lastParent = null;
    const isExcluded = (node) => exclude && node.nodeType === 1 && node.matches(exclude);
    const isBlock = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const display = getComputedStyle(node).display;
      return display !== "inline" && display !== "contents";
    };

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (isExcluded(node)) return NodeFilter.FILTER_REJECT; // skips the whole subtree
        if (node.nodeType === 1) {
          const tag = node.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return NodeFilter.FILTER_REJECT;
          if (node.getAttribute("aria-hidden") === "true" && !node.querySelector("img[alt]")) return NodeFilter.FILTER_REJECT;
          if (isHidden(node)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) {
        if (node.tagName === "BR") parts.push(gap);
        // Sites often draw emoji as <img alt="😀">; keep the emoji.
        else if (node.tagName === "IMG" && isEmojiImg(node)) parts.push(node.getAttribute("alt"));
        continue;
      }
      const parent = node.parentElement;
      if (lastParent && parent !== lastParent && (isBlock(parent) || isBlock(lastParent))) parts.push(gap);
      parts.push(node.nodeValue);
      lastParent = parent;
    }
    return lines ? cleanLines(parts.join("")) : clean(parts.join(""));
  }

  // Text a person can't see: hidden email "preheaders", tracking blocks and
  // the invisible padding scammers add to fool filters. Computed style only
  // (no layout), so it also works on pages that aren't on screen.
  function isHidden(el) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return true;
    if (parseFloat(s.opacity) === 0) return true;
    if (parseFloat(s.fontSize) < 2) return true; // font-size:0 / 1px tricks
    const clipped = s.overflow === "hidden" || s.overflowY === "hidden";
    if (clipped && (s.maxHeight === "0px" || s.height === "0px" || s.maxWidth === "0px" || s.width === "0px")) return true;
    if (s.color === "rgba(0, 0, 0, 0)" || s.color === "transparent") return true;
    return false;
  }

  // Like clean(), but keeps single line breaks (drops blank-line runs).
  function cleanLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t\u00a0\u202f]+/g, " ").trim())
      .filter((line, i, all) => line || (i > 0 && all[i - 1]))
      .join("\n")
      .trim()
      .slice(0, MAX_TEXT);
  }

  // Links in `el` (real hrefs, not just visible text). Facebook/Instagram/
  // Google wrap outbound links in a redirect; unwrap so the real target is
  // checked. `skip` = an element whose links to ignore (e.g. a quoted reply).
  function links(el, skip) {
    const out = [];
    const seen = new Set();
    for (const a of el.querySelectorAll("a[href]")) {
      if (skip && skip.contains(a)) continue;
      if (isHidden(a)) continue; // invisible tracking links
      let href = a.href;
      try {
        const url = new URL(href);
        const wrapped =
          /^(l|lm)\.facebook\.com$|^l\.instagram\.com$/.test(url.hostname) ? url.searchParams.get("u") :
          url.hostname.endsWith("google.com") && url.pathname === "/url" ? url.searchParams.get("q") || url.searchParams.get("url") : null;
        if (wrapped) href = wrapped;
      } catch (_) {
        continue; // not a usable URL
      }
      if (!/^https?:/i.test(href) || seen.has(href)) continue;
      seen.add(href);
      out.push({ href, text: clean(a.textContent) });
      if (out.length >= 20) break;
    }
    return out;
  }

  // Which side of the conversation pane a bubble sits on. Chat apps
  // right-align your own messages and left-align everyone else's, whatever
  // their class names or language, so position is the most stable signal.
  // Returns "outgoing", "incoming", "center" (system notices) or "unknown".
  function directionOf(bubble, pane) {
    if (!bubble || !pane) return "unknown";
    let b = bubble.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    if (!b.width || !p.width) return "unknown";
    // A block that spans the pane says nothing about alignment: measure
    // where its text actually sits instead.
    if (b.width > p.width * 0.85) {
      const range = document.createRange();
      range.selectNodeContents(bubble);
      const t = range.getBoundingClientRect();
      if (t.width) b = t;
    }
    const leftGap = b.left - p.left;
    const rightGap = p.right - b.right;
    if (Math.abs(leftGap - rightGap) < p.width * 0.04) return "center";
    return rightGap < leftGap ? "outgoing" : "incoming";
  }

  // Nearest scrollable ancestor (the message list's scroller).
  function findScroller(el) {
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    }
    return null;
  }

  // Short stable id from a string (FNV-1a), for messages without an id.
  function hashId(value) {
    let h = 0x811c9dc5;
    const str = String(value);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  // An <img> standing in for an emoji: its alt text is emoji characters
  // (not a word like "Photo").
  const EMOJI = /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D|[0-9#*]\uFE0F?\u20E3)+$/u;
  function isEmojiImg(img) {
    const alt = (img.getAttribute("alt") || "").trim();
    return !!alt && alt.length <= 16 && EMOJI.test(alt);
  }

  // Collapse whitespace and cap the length.
  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }

  function register(adapter) {
    root.TrustGraphAdapters.push(adapter);
    return adapter;
  }

  // ---------------------------------------------------------------------
  // Fallback: the smallest block around `target` that reads like a message
  // (20-3000 characters), inside `scope`, never in navigation, headers,
  // inputs or TrustGraph's own UI. Used by adapters/generic.js, and by
  // content/core.js on every supported site when the site's own selectors
  // find nothing (e.g. after the site changed its HTML), so the shield
  // keeps working for single-message checks.
  // ---------------------------------------------------------------------
  const BLOCK = "p, li, blockquote, td, dd, article, section, [role='article'], [role='listitem'], [role='row'], [dir='auto'], div, span";
  const NEVER =
    "input, textarea, select, button, nav, header, footer, aside, [contenteditable='true'], [role='textbox'], [role='navigation'], [role='banner'], [role='menu'], [role='menubar'], [role='toolbar'], [role='tablist'], [role='search'], trustgraph-panel, trustgraph-shield, trustgraph-launcher";
  function textBlock(target, scope, opts = {}) {
    const min = opts.min || 20;
    const max = opts.max || 3000;
    if (!target || target.nodeType !== 1) target = target && target.parentElement;
    if (!target || (scope && !scope.contains(target))) return null;
    for (let el = target.closest(BLOCK); el && el !== document.body && el !== scope; el = el.parentElement && el.parentElement.closest(BLOCK)) {
      if (el.closest(NEVER)) return null;
      const len = textLength(el);
      if (len > max) return null;
      if (len >= min) return grow(el, scope, max, min);
    }
    return null;
  }
  const textLength = (el) => (el.innerText || el.textContent || "").trim().length;
  // Hovering one line of a message should check the whole message: take the
  // parent while it holds no OTHER message-sized block (only loose text,
  // line breaks, times, names), so two messages are never merged.
  function grow(el, scope, max, min) {
    for (let p = el.parentElement; p && p !== document.body && p !== scope && !p.closest(NEVER); p = el.parentElement) {
      if (textLength(p) > max) break;
      if (Array.from(p.children).some((c) => c !== el && textLength(c) >= min)) break;
      el = p;
    }
    return el;
  }

  // ---------------------------------------------------------------------
  // Calibration sample: a copy of `el`'s HTML with every letter replaced by
  // x/X and every digit by 0, attribute values that can hold text (labels,
  // titles, alt, links, names) anonymised the same way, and scripts, styles,
  // images and SVG paths removed. Keeps tags, classes, ids, roles and data-*
  // names, which is what adapter selectors need. Never leaves the page
  // unless the user saves the file.
  // ---------------------------------------------------------------------
  const KEEP_ATTRS = /^(class|id|role|dir|tabindex|aria-hidden|aria-expanded|aria-selected|data-testid|data-qa|data-list-id|data-list-item-id|data-mid|data-event-urn|data-item-key|data-msg-ts|data-ts|data-message-id|data-legacy-message-id|data-thread-perm-id|contenteditable|type|datetime)$/i;
  const scrub = (s) => String(s).replace(/\p{L}|\p{N}/gu, (c) => (/\p{N}/u.test(c) ? "0" : /\p{Lu}/u.test(c) ? "X" : "x"));
  function anonymizedHtml(el, limit = 2000000) {
    const copy = el.cloneNode(true);
    for (const n of copy.querySelectorAll("script, style, noscript, template, iframe, canvas, video, audio, source")) n.remove();
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    const nodes = [copy];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.nodeType === 3) {
        node.nodeValue = scrub(node.nodeValue);
        continue;
      }
      for (const attr of Array.from(node.attributes || [])) {
        const name = attr.name.toLowerCase();
        if (name === "d" || name === "style" || name === "srcset" || name.startsWith("on")) node.removeAttribute(attr.name);
        else if (name === "src") node.setAttribute(attr.name, "about:blank");
        else if (name === "href") node.setAttribute(attr.name, "https://example.invalid/" + scrub(attr.value).slice(-24).replace(/[^x0X]/g, ""));
        else if (!KEEP_ATTRS.test(name) || name === "data-pre-plain-text") node.setAttribute(attr.name, scrub(attr.value));
      }
    }
    const html = copy.outerHTML;
    return html.length > limit ? html.slice(0, limit) + "\n<!-- truncated -->" : html;
  }

  root.TrustGraphKit = { find, list, text, clean, cleanLines, isEmojiImg, isHidden, links, directionOf, findScroller, hashId, register, textBlock, anonymizedHtml, BLOCK_NEVER: NEVER };
})(globalThis);
