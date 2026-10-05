// Instagram DMs (www.instagram.com/direct/...).
//
// Injected on all of www.instagram.com because it's a single-page app; the
// adapter only switches on under /direct/. Elsewhere it does nothing.
//
// STATUS: hint-based, NOT yet verified. See adapters/meta-chat.js.
(function () {
  "use strict";
  window.TrustGraphKit.register(
    window.TrustGraphMeta.makeAdapter({
      channel: "instagram",
      matches: (url) => /^https:\/\/www\.instagram\.com\/direct\//.test(url),
    })
  );
})();
