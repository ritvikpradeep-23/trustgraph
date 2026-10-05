// Stub adapter for the local test page (test/test-chat.html), channel "test".
// Dev-only: build_zip.py leaves it out of the store package.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;

  const adapter = {
    channel: "test",
    push: true,
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
    read() {
      const els = adapter.listMessages();
      const pane = document.querySelector("main") || document.body;
      const messages = els.map((el) => {
        const text = kit.text(el, ".sender, .time", { lines: true });
        const hasMedia = !!el.querySelector(".image, img");
        return {
          id: el.getAttribute("data-id") || kit.hashId(text + el.getAttribute("data-sender")),
          sender: adapter.sender(el),
          timestamp: null,
          text,
          links: kit.links(el),
          isReply: false,
          quotedText: "",
          hasMedia,
          mediaType: hasMedia ? "image" : null,
          isForwarded: false,
          direction: kit.directionOf(el, pane),
          type: text ? "text" : "media",
          element: el,
        };
      });
      const stats = { rows: els.length, containers: els.length, parsed: messages.length, skipped: {}, byType: {} };
      return { messages, stats, pane };
    },
    readMessages() {
      return adapter.read().messages;
    },
    chatKey() {
      return location.pathname;
    },
    scroller() {
      return document.scrollingElement;
    },
    messagePane() {
      return document.querySelector("main") || document.body;
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
