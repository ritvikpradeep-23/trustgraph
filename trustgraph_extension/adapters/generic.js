// Generic fallback: any block of text on any https site. Registered only
// after the user switches on "Any other site" in Settings, which asks
// Chrome for the optional all-sites permission (background.js,
// syncGenericScript). Single-message checks only: there's no chat to scan.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;
  const BLOCK = "p, li, blockquote, td, dd, article, section, [role='article'], [role='listitem'], div";
  const NEVER = "input, textarea, select, button, nav, header, footer, aside, [contenteditable='true'], [role='textbox'], [role='navigation'], [role='banner'], trustgraph-panel, trustgraph-shield, trustgraph-launcher";
  const MIN = 40; // characters: skip labels, buttons and menu items
  const MAX = 3000; // and whole page sections

  // The smallest block around the pointer that reads like a message.
  function block(target) {
    for (let el = target.closest(BLOCK); el && el !== document.body; el = el.parentElement.closest(BLOCK)) {
      if (el.closest(NEVER)) return null;
      const len = (el.innerText || "").trim().length;
      if (len > MAX) return null;
      if (len >= MIN) return el;
    }
    return null;
  }

  const adapter = {
    channel: "generic",
    push: false, // overlay: we don't know this site's layout
    strategies: [{ name: "text-block", find: block, all: () => [] }],
    matches: (url) => /^https:\/\//.test(url),
    findMessage: (target) => (target && target.nodeType === 1 ? block(target) : null),
    extractText: (el) => kit.text(el, "script, style, nav, button", { lines: true }),
    sender: () => null,
    selfTest: () => 0,
  };
  // Only when no site adapter claimed this page.
  if (!(window.TrustGraphAdapters || []).some((a) => a.channel !== "generic" && a.matches(location.href))) kit.register(adapter);
})();
