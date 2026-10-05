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
  const DATE_ROW = /^(today|yesterday|mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}[:./])/i;

  // Innermost dir="auto" blocks that hold message text.
  function textLeaves(el) {
    const blocks = Array.from(el.querySelectorAll('[dir="auto"]'));
    if (el.matches('[dir="auto"]')) blocks.unshift(el);
    return blocks
      .filter((b) => !b.querySelector('[dir="auto"]'))
      .filter((b) => !b.closest(NOT_TEXT) && !b.closest(COMPOSER))
      .filter((b) => {
        const t = kit.text(b);
        return t && !TIME_ONLY.test(t);
      });
  }

  function mediaOf(row) {
    if (row.querySelector("audio, [aria-label*='audio' i], [aria-label*='voice' i]")) return "voice";
    if (row.querySelector("video")) return "video";
    const img = Array.from(row.querySelectorAll("img")).find((im) => !kit.isEmojiImg(im));
    return img ? "image" : null;
  }

  function makeAdapter({ channel, matches }) {
    const main = () => document.querySelector('[role="main"]') || document.body; // an element: the panel measures it

    const adapter = {
      channel,
      push: true,
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

      // --- chat-level reading (content/chat-store.js) --------------------
      // Rows have no ids, so the id is a hash of the content (stable across
      // the list re-rendering); repeats within one read get a suffix.
      read() {
        const rows = adapter.listMessages();
        const pane = adapter.messagePane();
        const partner = adapter.sender();
        const stats = { rows: rows.length, containers: rows.length, parsed: 0, skipped: {}, byType: {} };
        const messages = [];
        const used = {};
        for (const row of rows) {
          const leaves = textLeaves(row);
          const text = kit.cleanLines(Array.from(new Set(leaves.map((b) => kit.text(b, null, { lines: true })))).join("\n"));
          const mediaType = mediaOf(row);
          const bubble = leaves[0] || row.querySelector("img, video") || row;
          let direction = kit.directionOf(bubble, pane);
          let type = text ? "text" : mediaType ? "media" : "empty";
          // Only an obvious date/time line counts as a separator; anything
          // else stays a message so it still gets checked.
          if (direction === "center" && !mediaType && text.length < 40 && DATE_ROW.test(text)) type = "date";
          if (type === "empty") {
            stats.skipped["no text or media"] = (stats.skipped["no text or media"] || 0) + 1;
            continue;
          }
          const base = kit.hashId(type + "|" + text + "|" + (mediaType || ""));
          used[base] = (used[base] || 0) + 1;
          stats.parsed++;
          stats.byType[type] = (stats.byType[type] || 0) + 1;
          messages.push({
            id: used[base] > 1 ? base + "-" + used[base] : base,
            sender: type === "date" || type === "system" ? null : direction === "outgoing" ? "You" : partner,
            timestamp: null,
            text: type === "date" ? "" : text,
            links: kit.links(row),
            isReply: /\b(replied to|replying to)\b/i.test(row.getAttribute("aria-label") || ""),
            quotedText: "",
            hasMedia: !!mediaType,
            mediaType,
            isForwarded: /\bforwarded\b/i.test(row.getAttribute("aria-label") || ""),
            direction: type === "date" || type === "system" ? "center" : direction,
            type,
            element: row,
          });
        }
        return { messages, stats, pane };
      },

      readMessages() {
        return adapter.read().messages;
      },

      chatKey() {
        return location.pathname; // /messages/t/<id> or /direct/t/<id>
      },

      scroller() {
        const first = adapter.listMessages()[0];
        return (first && kit.findScroller(first)) || null;
      },

      messagePane() {
        return document.querySelector('[role="grid"]') || main();
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
