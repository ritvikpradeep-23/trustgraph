// WhatsApp Web adapter (https://web.whatsapp.com).
//
// STATUS: hint-based, NOT yet verified against the live site. The selectors
// come from how WhatsApp Web has historically been built:
//   - message rows: div[data-id] whose id starts "false_" (incoming) or
//     "true_" (outgoing)
//   - text: span.selectable-text inside .copyable-text, whose
//     data-pre-plain-text attribute holds "[time, date] Sender: "
//   - fallback: div[role="row"] rows with text in span[dir]
// Calibrate with a real sample saved as test/fixtures/whatsapp.html.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;

  const ROW_ID = '[data-id^="false_"], [data-id^="true_"]';
  // Quoted replies (the grey box above a reply) must not be scored.
  const QUOTED = '[aria-label*="quoted" i], .quoted-mention, [data-testid*="quoted"]';
  const TIME_ONLY = /^\d{1,2}[:.]\d{2}(\s?[ap]\.?m\.?)?$/i;
  // The message pane. Older builds used #main; fall back to the whole page.
  const pane = () => document.querySelector("#main") || document;

  const adapter = {
    channel: "whatsapp",
    strategies: [
      {
        name: "data-id",
        find: (t) => t.closest(ROW_ID),
        all: () => pane().querySelectorAll(ROW_ID),
      },
      {
        name: "copyable-text",
        find: (t) => {
          const box = t.closest(".copyable-text[data-pre-plain-text]");
          return box ? box.closest('[role="row"]') || box : null;
        },
        all: () => pane().querySelectorAll(".copyable-text[data-pre-plain-text]"),
      },
      {
        name: "role-row",
        find: (t) => {
          const row = t.closest('[role="row"]');
          return row && pane().contains(row) && row.querySelector("span[dir]") ? row : null;
        },
        all: () => Array.from(pane().querySelectorAll('[role="row"]')).filter((r) => r.querySelector("span[dir]")),
      },
    ],

    matches(url) {
      return url.startsWith("https://web.whatsapp.com/");
    },

    findMessage(target) {
      if (target.closest('footer, [contenteditable="true"], header')) return null; // composer & chat header
      return kit.find(adapter, target);
    },

    extractText(el) {
      const outsideQuote = (node) => !node.closest(QUOTED) || el.matches(QUOTED);
      // 1. The message body spans.
      const spans = Array.from(el.querySelectorAll("span.selectable-text")).filter(outsideQuote);
      // Keep only outermost spans (they can nest).
      const top = spans.filter((s) => !spans.some((o) => o !== s && o.contains(s)));
      if (top.length) return kit.clean(top.map((s) => kit.text(s)).join(" "));
      // 2. A media message with no caption: there is a copyable container but no text.
      if (el.querySelector(".copyable-text") || el.matches(ROW_ID)) return "";
      // 3. Fallback (role-row strategy): span[dir] leaves, minus quotes and times.
      const leaves = Array.from(el.querySelectorAll("span[dir]"))
        .filter(outsideQuote)
        .filter((s) => !s.querySelector("span[dir]"))
        .map((s) => kit.clean(s.textContent))
        .filter((t) => t && !TIME_ONLY.test(t));
      return kit.clean(leaves.join(" "));
    },

    sender(el) {
      const box = el.matches("[data-pre-plain-text]") ? el : el.querySelector("[data-pre-plain-text]");
      const pre = box && box.getAttribute("data-pre-plain-text");
      // "[10:01, 05/10/2026] Sender Name: "
      const m = pre && pre.match(/^\s*\[[^\]]*\]\s*(.+?):\s*$/);
      return m ? m[1] : null;
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
