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
  function text(el, exclude) {
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
        if (node.tagName === "BR") parts.push(" ");
        // Sites often draw emoji as <img alt="😀">; keep the emoji.
        else if (node.tagName === "IMG") {
          const alt = node.getAttribute("alt") || "";
          if (alt && alt.length <= 8) parts.push(alt);
        }
        continue;
      }
      const parent = node.parentElement;
      if (lastParent && parent !== lastParent && (isBlock(parent) || isBlock(lastParent))) parts.push(" ");
      parts.push(node.nodeValue);
      lastParent = parent;
    }
    return clean(parts.join(""));
  }

  // Collapse whitespace and cap the length.
  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }

  function register(adapter) {
    root.TrustGraphAdapters.push(adapter);
    return adapter;
  }

  root.TrustGraphKit = { find, list, text, clean, register };
})(globalThis);
