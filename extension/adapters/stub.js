// Stub adapter for the local test page (test/test-chat.html), channel "test".
// Dev-only: build_zip.py leaves it out of the store package.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;

  const adapter = {
    channel: "test",
    strategies: [
      {
        name: "bubble-class",
        find: (target) => target.closest(".bubble"),
        all: () => document.querySelectorAll(".bubble"),
      },
    ],
    matches(url) {
      return /^http:\/\/(localhost|127\.0\.0\.1):5500\//.test(url);
    },
    findMessage(target) {
      return kit.find(adapter, target);
    },
    extractText(el) {
      return kit.text(el, ".sender, .time");
    },
    sender(el) {
      return el.getAttribute("data-sender") || null;
    },
    listMessages() {
      return kit.list(adapter);
    },
    selfTest() {
      return adapter.listMessages().length;
    },
  };

  kit.register(adapter);
})();
