// Facebook Messenger on the web. messenger.com was retired in April 2026 and
// redirects to facebook.com/messages, so that's what we target.
//
// The content script is injected on all of www.facebook.com (it's a
// single-page app: a script matched only to /messages/* would never load
// when you navigate there from the news feed). This adapter only switches
// on under /messages. Elsewhere on Facebook it does nothing.
//
// STATUS: hint-based, NOT yet verified. See adapters/meta-chat.js.
(function () {
  "use strict";
  window.TrustGraphKit.register(
    window.TrustGraphMeta.makeAdapter({
      channel: "messenger",
      matches: (url) => /^https:\/\/www\.facebook\.com\/messages(\/|\?|#|$)/.test(url),
    })
  );
})();
