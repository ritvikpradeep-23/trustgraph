// Shared helper for Meta's chat UIs: Facebook Messenger (facebook.com/messages)
// and Instagram DMs (instagram.com/direct). Both are React apps with hashed
// class names, so only role / dir attributes are used.
//
// STATUS: hint-based, NOT yet verified against the live sites; these are
// the weakest selectors in the extension. Historical structure: the message
// list is role="grid" with role="row" rows; text sits in div[dir="auto"]
// (Instagram: also span[dir="auto"]). Incoming vs outgoing isn't exposed,
// so any message can be checked.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;

  // Never treat the message composer or headings (names) as message text.
  const COMPOSER = '[contenteditable="true"], [role="textbox"]';
  const NOT_TEXT = 'h1, h2, h3, h4, h5, h6, abbr, time, [aria-hidden="true"], [role="img"], [role="button"][aria-label*="react" i]';
  const TIME_ONLY = /^(\d{1,2}[:.]\d{2}(\s?[ap]\.?m\.?)?|seen|sent|delivered|seen by .+)$/i;

  const hasContent = (row) => row.querySelector('[dir="auto"], img');

  function makeAdapter({ channel, matches }) {
    const main = () => document.querySelector('[role="main"]') || document;

    const adapter = {
      channel,
      strategies: [
        {
          name: "grid-row",
          find: (t) => {
            const row = t.closest('[role="grid"] [role="row"]');
            return row && hasContent(row) ? row : null;
          },
          all: () => Array.from(document.querySelectorAll('[role="grid"] [role="row"]')).filter(hasContent),
        },
        {
          name: "main-row",
          find: (t) => {
            const row = t.closest('[role="row"]');
            return row && main().contains(row) && hasContent(row) ? row : null;
          },
          all: () => Array.from(main().querySelectorAll('[role="row"]')).filter(hasContent),
        },
        {
          name: "dir-auto-block",
          find: (t) => {
            const block = t.closest('div[dir="auto"]');
            return block && main().contains(block) && !block.closest(NOT_TEXT) ? block : null;
          },
          all: () => Array.from(main().querySelectorAll('div[dir="auto"]')).filter((b) => !b.closest(COMPOSER) && !b.closest(NOT_TEXT)),
        },
      ],

      matches,

      findMessage(target) {
        if (target.closest(COMPOSER)) return null;
        return kit.find(adapter, target);
      },

      // Text of the innermost dir="auto" blocks, minus names, times, and
      // "Seen" markers.
      extractText(el) {
        const blocks = Array.from(el.querySelectorAll('[dir="auto"]'));
        if (el.matches('[dir="auto"]')) blocks.unshift(el);
        const leaves = blocks
          .filter((b) => !b.querySelector('[dir="auto"]'))
          .filter((b) => !b.closest(NOT_TEXT) && !b.closest(COMPOSER))
          .map((b) => kit.text(b))
          .filter((t) => t && !TIME_ONLY.test(t));
        // The same text is sometimes rendered twice (visible + accessible copy).
        return kit.clean(Array.from(new Set(leaves)).join(" "));
      },

      // Best effort: the conversation header (the other person in a 1:1 chat).
      sender() {
        const heading = main().querySelector('h1 [dir="auto"], h2 [dir="auto"], h1, h2');
        const name = heading ? kit.clean(heading.textContent) : "";
        return name || null;
      },

      listMessages() {
        return kit.list(adapter);
      },

      selfTest() {
        return adapter.listMessages().length;
      },
    };
    return adapter;
  }

  window.TrustGraphMeta = { makeAdapter };
})();
