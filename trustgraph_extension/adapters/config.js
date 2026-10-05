// Config-driven adapters: describe a chat site with selectors, get a full
// adapter (the contract in kit.js, plus read() for whole-chat scans).
// Used for LinkedIn, Telegram, Discord and Slack (adapters/sites.js).
//
// TrustGraphKit.fromConfig({
//   channel: "slack",
//   matches: (url) => boolean,
//   rows: [{name, selector}],        message rows, most specific first
//   body: "selector, ...",           the text inside a row (default: the row)
//   exclude: "selector, ...",        never text: names, times, reactions, quotes
//   sender: "selector",              name inside the row (or `senderAttr`)
//   inheritSender: true,             grouped rows without a name take the
//                                    previous row's (Slack, Discord, LinkedIn)
//   time: "selector",                element with a datetime / data-ts / title
//   id: (row) => string | null,      stable id from the site's attributes
//   outgoing: (row) => boolean,      your own messages (else: by position)
//   pane, header, composer: "selector"
// })
(function (root) {
  "use strict";
  const kit = root.TrustGraphKit;
  const q = (sel, from = document) => (sel ? from.querySelector(sel) : null);

  function timeOf(row, cfg) {
    const el = q(cfg.time, row);
    if (!el) return null;
    const raw = el.getAttribute("datetime") || el.getAttribute("data-ts") || el.getAttribute("title") || "";
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(parseFloat(raw) * (raw.length > 11 ? 1 : 1000)); // Slack: seconds.micro
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }

  function fromConfig(cfg) {
    const adapter = {
      channel: cfg.channel,
      push: cfg.push !== false,
      strategies: cfg.rows.map(({ name, selector }) => ({
        name,
        find: (t) => t.closest(selector),
        all: () => document.querySelectorAll(selector),
      })),

      matches: cfg.matches,

      findMessage(target) {
        if (cfg.composer && target.closest(cfg.composer)) return null;
        const row = kit.find(adapter, target);
        return row && adapter.extractText(row) ? row : null;
      },

      bodyOf(row) {
        if (!cfg.body) return row;
        const parts = Array.from(row.querySelectorAll(cfg.body)).filter((b) => !b.parentElement.closest(cfg.body));
        return parts.length ? parts : null;
      },

      // One line for a single check; read() keeps line breaks ({lines: true}).
      extractText(row, opts) {
        const body = adapter.bodyOf(row);
        if (!body) return "";
        const lines = !!(opts && opts.lines);
        const parts = (Array.isArray(body) ? body : [body]).map((b) => kit.text(b, cfg.exclude, { lines }));
        return lines ? kit.cleanLines(parts.join("\n")) : kit.clean(parts.join(" "));
      },

      sender(row) {
        let el = q(cfg.sender, row);
        if (!el && cfg.inheritSender) {
          // Grouped messages show the name once; walk back to it.
          const rows = adapter.listMessages();
          for (let i = rows.indexOf(row) - 1; i >= 0 && !el; i--) el = q(cfg.sender, rows[i]);
        }
        if (!el) return null;
        return kit.clean((cfg.senderAttr && el.getAttribute(cfg.senderAttr)) || el.textContent) || null;
      },

      // --- chat-level reading (content/chat-store.js) ----------------------
      read() {
        const rows = adapter.listMessages();
        const pane = adapter.messagePane();
        const stats = { rows: rows.length, containers: rows.length, parsed: 0, skipped: {}, byType: {} };
        const messages = [];
        let lastSender = null;
        for (const row of rows) {
          const nameEl = q(cfg.sender, row);
          const sender = nameEl ? kit.clean((cfg.senderAttr && nameEl.getAttribute(cfg.senderAttr)) || nameEl.textContent) : cfg.inheritSender ? lastSender : null;
          if (nameEl) lastSender = sender;
          const body = adapter.bodyOf(row);
          const text = adapter.extractText(row, { lines: true });
          const hasMedia = !!row.querySelector("img:not([alt]), video, audio, [data-qa='file_image']");
          const type = text ? "text" : hasMedia ? "media" : "empty";
          stats.parsed++;
          stats.byType[type] = (stats.byType[type] || 0) + 1;
          // Only a site's own marker says a message is yours. Channel apps
          // (Discord, Slack) left-align everyone, so position can't tell;
          // checking one of your own messages is better than skipping a scam.
          const outgoing = cfg.outgoing ? !!cfg.outgoing(row) : false;
          messages.push({
            id: (cfg.id && cfg.id(row)) || cfg.channel.slice(0, 2) + ":" + kit.hashId(String(sender) + text.slice(0, 200)),
            sender,
            timestamp: timeOf(row, cfg),
            text,
            links: body ? (Array.isArray(body) ? body : [body]).flatMap((b) => kit.links(b)) : [],
            hasMedia,
            direction: outgoing ? "outgoing" : "incoming",
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
        return location.pathname + location.hash;
      },

      scroller() {
        const first = adapter.listMessages()[0];
        return (first && kit.findScroller(first)) || q(cfg.pane);
      },

      messagePane() {
        return q(cfg.pane) || document.body;
      },

      chatHeader() {
        return q(cfg.header);
      },

      elementFor(id) {
        return adapter.listMessages().find((row) => cfg.id && cfg.id(row) === id) || null;
      },

      listMessages() {
        return kit.list(adapter);
      },

      selfTest() {
        return adapter.listMessages().length;
      },

      // The scan button shows only while a conversation is on screen.
      hasChat() {
        return adapter.listMessages().length > 0;
      },
    };
    return adapter;
  }

  kit.fromConfig = fromConfig;
})(globalThis);
