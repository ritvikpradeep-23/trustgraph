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
    const b = bubble.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    if (!b.width || !p.width) return "unknown";
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

  root.TrustGraphKit = { find, list, text, clean, cleanLines, isEmojiImg, links, directionOf, findScroller, hashId, register };
})(globalThis);
