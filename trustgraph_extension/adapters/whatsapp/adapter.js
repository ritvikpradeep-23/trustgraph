// WhatsApp Web adapter (https://web.whatsapp.com). Uses adapters/whatsapp/
// reader.js for all parsing; see that file for the selectors and why.
//
// Calibrated against observations of the live site (Oct 2026): hashed class
// names, data-id without a true_/false_ prefix, virtualised message list.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;
  const reader = window.TrustGraphWhatsAppReader;

  const main = () => document.querySelector("#main");
  // Inside the open chat's message list (not its header or composer).
  const inList = (el) => {
    const list = reader.messageList(main());
    return !!list && list.contains(el) && !el.closest("header, footer");
  };
  // Remembers which #main element we saw, so a re-rendered pane (WhatsApp
  // swaps it on chat switch) counts as a new chat even with the same title.
  const paneIds = new WeakMap();
  let paneCounter = 0;

  const adapter = {
    channel: "whatsapp",
    push: true, // the side panel narrows the page instead of covering it
    // Only real message bubbles: no generic "any block of text" fallback
    // (it picked up chat-list previews, the sidebar and notices).
    fallback: false,
    // Chat scans skip your own, very short, emoji-only and link-only
    // messages (content/core.js skipReason; limits in shared/constants.js).
    scanFilters: true,
    strategies: [
      {
        name: "main-data-id",
        find: (t) => {
          const el = t.closest("[data-id]");
          return el && inList(el) ? el : null;
        },
        all: () => (main() ? Array.from(main().querySelectorAll("[data-id]")).filter((el) => !el.parentElement.closest("[data-id]")) : []),
      },
      {
        name: "copyable-text",
        find: (t) => {
          const box = t.closest(".copyable-text[data-pre-plain-text]");
          return box && inList(box) ? box.closest('[role="row"]') || box : null;
        },
        all: () => (main() ? main().querySelectorAll(".copyable-text[data-pre-plain-text]") : []),
      },
    ],

    matches(url) {
      return url.startsWith("https://web.whatsapp.com/");
    },

    // Only inside the open chat's message list; never the chat list, search,
    // header, composer, menus or popups.
    findMessage(target) {
      if (!target.closest || target.closest('footer, header, [contenteditable="true"], [role="textbox"]')) return null;
      if (!inList(target)) return null;
      return kit.find(adapter, target);
    },

    // One message: the same parser as a chat scan, so quoted replies, media
    // and deleted messages are handled identically.
    record(el) {
      const container = el.matches("[data-id]") ? el : el.querySelector("[data-id]");
      return container ? reader.readOne(container) : null;
    },

    // WhatsApp shows long messages cut short with a "Read more" button; the
    // rest isn't in the page until it's clicked. Called only when the user
    // clicks the shield, so the whole message is checked, not just the start.
    // Resolves true if anything was expanded.
    async expand(el) {
      const container = el.matches("[data-id]") ? el : el.querySelector("[data-id]") || el;
      let expanded = false;
      for (let round = 0; round < 3; round++) {
        const more = reader.readMoreButton(container);
        if (!more) break;
        more.click();
        expanded = true;
        await new Promise((r) => setTimeout(r, 150));
      }
      return expanded;
    },

    extractText(el) {
      const rec = adapter.record(el);
      if (rec) return kit.clean(rec.text);
      return el.querySelector("[data-pre-plain-text]") ? "" : kit.text(el);
    },

    sender(el) {
      const box = el.matches("[data-pre-plain-text]") ? el : el.querySelector("[data-pre-plain-text]");
      const parsed = box && reader.parsePrePlainText(box.getAttribute("data-pre-plain-text"));
      return parsed ? parsed.sender : null;
    },

    // --- chat-level reading (used by content/chat-store.js) ---------------
    read() {
      return reader.read(document);
    },

    readMessages() {
      return reader.readMessages(document);
    },

    // Changes when the user opens a different chat.
    chatKey() {
      const m = main();
      if (!m) return null;
      if (!paneIds.has(m)) paneIds.set(m, ++paneCounter);
      const title = m.querySelector("header span[title], header [dir='auto']");
      return paneIds.get(m) + "|" + (title ? kit.clean(title.getAttribute("title") || title.textContent) : "");
    },

    // The message list's scroller: a div[tabindex="0"] inside #main.
    scroller() {
      const m = main();
      if (!m) return null;
      const candidates = Array.from(m.querySelectorAll('div[tabindex="0"]')).filter((el) => el.scrollHeight > el.clientHeight + 1);
      const withMessages = candidates.find((el) => el.querySelector("[data-id]"));
      if (withMessages) return withMessages;
      const first = m.querySelector("[data-id]");
      return (first && kit.findScroller(first)) || candidates[0] || null;
    },

    // WhatsApp's app root, narrowed along with the page when the panel opens.
    pushTarget() {
      return document.querySelector("#app");
    },

    // The launcher must never sit on the chat header's buttons.
    chatHeader() {
      const m = main();
      return m ? m.querySelector("header") : null;
    },

    // The element holding the open chat's messages (chat-store observes it).
    messageList() {
      return reader.messageList(main());
    },

    // Area the side panel must never cover.
    messagePane() {
      return adapter.scroller() || main();
    },

    elementFor(id) {
      const m = main();
      return m ? m.querySelector(`[data-id="${CSS.escape(id)}"]`) : null;
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
