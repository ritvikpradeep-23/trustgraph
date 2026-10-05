// Generic fallback: any block of text on any https site. Registered only
// after the user switches on "Any other site" in Settings, which asks
// Chrome for the optional all-sites permission (background.js,
// syncGenericScript). Single-message checks only: there's no chat to scan.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;
  const block = (target) => kit.textBlock(target, null, { min: 40 }); // 40+: skip labels and menu items

  const adapter = {
    channel: "generic",
    push: false, // overlay: we don't know this site's layout
    fallback: false, // it IS the fallback
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
