// WhatsApp Web message reader.
//
// readMessages(root) -> [{id, sender, timestamp, text, links[], isReply,
//   quotedText, hasMedia, mediaType, isForwarded, direction, type, ...}]
// read(root)         -> {messages, stats} (stats feed the debug counts)
//
// Built on what live WhatsApp Web (Oct 2026) still exposes reliably:
//   #main                         the open chat
//   [data-id]                     one per message container (ids like
//                                 "3EB0…" / "AC76…"; no true_/false_ prefix)
//   [data-pre-plain-text]         "[7:36 am, 4/10/2026] Name: "
//   span.selectable-text          the message body
//   [role="row"]                  rows, including date separators and
//                                 system notices that have no data-id
// Class names are hashed (x1n2onr6…) and change, so none are used, apart
// from WhatsApp's long-lived semantic ones above.
//
// Privacy: this only reads the DOM when called (after the user clicks), and
// never logs or stores message text.
(function (root) {
  "use strict";
  const kit = root.TrustGraphKit;

  const QUOTED = '[aria-label*="quoted" i], .quoted-mention';
  const FORWARDED_ICON = '[data-icon="forwarded"], [data-icon="forward-refreshed"], [data-icon="frequently-forwarded"]';
  const DELETED_ICON = '[data-icon*="recalled"]';
  const DELETED_TEXT = /^(this message was deleted|you deleted this message|ഈ സന്ദേശം ഇല്ലാതാക്കി)\.?$/i;
  const FORWARDED_TEXT = /^forwarded( many times)?$/i;
  const TIME_ONLY = /^\d{1,2}[:.]\d{2}(\s?[ap]\.?\s?m\.?)?$/i;
  const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
  const DATE_ROW = new RegExp(
    `^(today|yesterday|ഇന്ന്|ഇന്നലെ|monday|tuesday|wednesday|thursday|friday|saturday|sunday|` +
      `\\d{1,4}[/.\\-]\\d{1,2}[/.\\-]\\d{1,4}|` +
      `\\d{1,2} (${MONTHS})[a-z]* \\d{4}|(${MONTHS})[a-z]* \\d{1,2},? \\d{4})$`,
    "i"
  );

  // -------------------------------------------------------------------------
  // "[7:36 am, 4/10/2026] Name: " -> {sender, timeText, dateText, timestamp}
  // Tolerates 12h/24h, am/pm in any case or with dots, the narrow no-break
  // space Chrome puts before "am", [date, time] order, d/m/y vs m/d/y vs
  // y-m-d, and names that contain colons or non-Latin script.
  // -------------------------------------------------------------------------
  // `order` ("dmy" | "mdy"), when known, settles dates like 4/10/2026.
  function parsePrePlainText(raw, locale, order) {
    if (!raw) return null;
    const value = String(raw).replace(/[   ]/g, " ");
    const m = value.match(/^\s*\[([^\]]*)\]\s*([\s\S]*)$/);
    if (!m) return null;
    // The sender is everything after "]" minus the trailing ": " (so a name
    // like "Dr: Raj" keeps its own colon).
    const sender = m[2].replace(/:\s*$/, "").trim() || null;

    // Find the date by its shape (three number groups), then the time in
    // whatever is left: works for "[time, date]", "[date, time]" and
    // "[2026-10-04 08:00]".
    const inner = m[1];
    const dateMatch = inner.match(/\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}/);
    const dateText = dateMatch ? dateMatch[0] : "";
    const rest = dateMatch ? inner.replace(dateText, " ") : inner;
    const timeMatch = rest.match(/\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[ap]\.?\s?m\.?)?/i);
    const timeText = timeMatch ? timeMatch[0].trim() : "";
    const time = parseTime(timeText);
    const date = parseDate(dateText, locale, order);
    let timestamp = null;
    if (date && time) timestamp = new Date(date.y, date.m - 1, date.d, time.h, time.min).getTime();
    else if (date) timestamp = new Date(date.y, date.m - 1, date.d).getTime();
    return { sender, timeText, dateText, timestamp };
  }

  function parseTime(text) {
    const m = String(text).match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?\.?\s?(m\.?)?/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ampm = m[3] ? m[3].toLowerCase() : null;
    if (ampm === "p" && h < 12) h += 12;
    if (ampm === "a" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h, min };
  }

  function parseDate(text, locale, order) {
    const nums = String(text).match(/\d+/g);
    if (!nums || nums.length < 3) return null;
    let [a, b, c] = nums.map(Number);
    let y, mo, d;
    if (nums[0].length === 4) [y, mo, d] = [a, b, c]; // 2026-10-04
    else {
      y = c < 100 ? 2000 + c : c;
      if (a > 12) [d, mo] = [a, b]; // 24/10 -> day first
      else if (b > 12) [mo, d] = [a, b]; // 10/24 -> month first
      else if (order === "mdy") [mo, d] = [a, b];
      else if (order === "dmy") [d, mo] = [a, b];
      else {
        // Ambiguous (4/10) with no hint from the chat: follow the browser's
        // locale; only US-style locales put the month first.
        const lang = (locale || (typeof navigator !== "undefined" && navigator.language) || "en-GB").toLowerCase();
        if (/^en-(us|ph)|^(fil|es-us)/.test(lang)) [mo, d] = [a, b];
        else [d, mo] = [a, b];
      }
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d };
  }

  // -------------------------------------------------------------------------
  // One message container ([data-id]) -> record
  // -------------------------------------------------------------------------
  function quotedBlock(container) {
    const q = container.querySelector(QUOTED);
    if (!q) return null;
    const button = q.closest('[role="button"]');
    return button && container.contains(button) && button !== container ? button : q;
  }

  // Body text: the selectable-text spans outside the quoted reply.
  function bodyText(container, quote) {
    const spans = Array.from(container.querySelectorAll("span.selectable-text")).filter((s) => !(quote && quote.contains(s)));
    const outer = spans.filter((s) => !spans.some((o) => o !== s && o.contains(s)));
    return kit.cleanLines(outer.map((s) => kit.text(s, null, { lines: true })).join("\n"));
  }

  function mediaOf(container, quote) {
    const inQuote = (el) => quote && quote.contains(el);
    const has = (sel) => Array.from(container.querySelectorAll(sel)).some((el) => !inQuote(el));
    if (has('audio, [data-icon*="ptt"], [data-icon*="audio"], [aria-label*="voice message" i]')) return "voice";
    if (has('video, [data-icon*="video"]')) return "video";
    if (has('[data-icon*="document"], [data-icon*="doc-"], [aria-label*="document" i]')) return "document";
    if (has('[data-icon*="sticker"], img[alt*="sticker" i]')) return "sticker";
    // Real images: blob/data/media URLs, bigger than an emoji.
    const img = Array.from(container.querySelectorAll("img")).find((im) => {
      if (inQuote(im) || kit.isEmojiImg(im)) return false;
      const src = im.getAttribute("src") || "";
      return /^(blob|data|https?):/.test(src) || im.width > 40;
    });
    return img ? "image" : null;
  }

  // Learns the chat's date order from any unambiguous date (24/10 or 10/24),
  // because WhatsApp's format doesn't always follow navigator.language.
  function inferDateOrder(pres) {
    for (const pre of pres) {
      const m = (pre.getAttribute("data-pre-plain-text") || "").match(/(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}/);
      if (!m) continue;
      if (Number(m[1]) > 12) return "dmy";
      if (Number(m[2]) > 12) return "mdy";
    }
    return null;
  }

  function readContainer(container, pane, locale, order) {
    const pre = container.matches("[data-pre-plain-text]") ? container : container.querySelector("[data-pre-plain-text]");
    const meta = pre ? parsePrePlainText(pre.getAttribute("data-pre-plain-text"), locale, order) : null;
    const quote = quotedBlock(container);
    // The quoted message's own text (not the quoted author's name).
    const quotedText = quote ? kit.text(quote.matches(".quoted-mention") ? quote : quote.querySelector(".quoted-mention") || quote) : "";
    let text = bodyText(container, quote);
    const mediaType = mediaOf(container, quote);
    const isForwarded =
      !!container.querySelector(FORWARDED_ICON) ||
      Array.from(container.querySelectorAll("span")).some((s) => FORWARDED_TEXT.test(kit.clean(s.textContent)));

    // Visible text minus times/labels, used to spot deleted and system rows.
    const visible = kit.clean(
      Array.from(container.querySelectorAll("span"))
        .filter((s) => !s.querySelector("span"))
        .map((s) => kit.clean(s.textContent))
        .filter((t) => t && !TIME_ONLY.test(t) && !FORWARDED_TEXT.test(t))
        .join(" ")
    );
    const deleted = !!container.querySelector(DELETED_ICON) || DELETED_TEXT.test(visible) || DELETED_TEXT.test(text);

    const bubble = pre || container.querySelector("img, video") || container.firstElementChild || container;
    let direction = kit.directionOf(bubble, pane);

    let type;
    let media = mediaType;
    if (deleted) {
      type = "deleted";
      text = "";
    } else if (text) type = "text";
    else if (media) type = "media";
    else if (pre) {
      // Has a sender line but no text or known media: a contact card,
      // location, poll, etc. Count it rather than dropping it.
      type = "media";
      media = "other";
    } else if (visible) type = "system";
    else type = "empty";
    if (type === "system") {
      text = visible;
      direction = "center";
    }

    return {
      id: container.getAttribute("data-id"),
      sender: meta ? meta.sender : rowLabelSender(container),
      timestamp: meta ? meta.timestamp : null,
      timeText: meta ? meta.timeText : "",
      dateText: meta ? meta.dateText : "",
      text,
      links: deleted ? [] : kit.links(container, quote),
      isReply: !!quote,
      quotedText,
      hasMedia: !!media,
      mediaType: media,
      isForwarded,
      direction,
      type,
    };
  }

  // Fallback sender when data-pre-plain-text is missing: the row's
  // aria-label often starts "Name: …"; else the first author-looking line.
  function rowLabelSender(container) {
    const row = container.closest('[role="row"]');
    const label = (row && row.getAttribute("aria-label")) || container.getAttribute("aria-label") || "";
    const m = label.match(/^([^:]{1,60}):/);
    return m ? m[1].trim() : null;
  }

  // A [role=row] with no message container: a date separator or a system
  // notice ("Messages are end-to-end encrypted", "Asha added you").
  function readBareRow(row) {
    const text = kit.clean(row.textContent);
    if (!text) return null;
    const type = DATE_ROW.test(text) ? "date" : "system";
    return {
      id: "row:" + kit.hashId(type + text),
      sender: null,
      timestamp: null,
      timeText: "",
      dateText: type === "date" ? text : "",
      text: type === "system" ? text : "",
      links: [],
      isReply: false,
      quotedText: "",
      hasMedia: false,
      mediaType: null,
      isForwarded: false,
      direction: "center",
      type,
    };
  }

  // -------------------------------------------------------------------------
  // Whole pane
  // -------------------------------------------------------------------------
  function chatPane(rootEl) {
    const base = rootEl || document;
    if (base.id === "main") return base;
    return (base.querySelector && base.querySelector("#main")) || null;
  }

  function read(rootEl, opts) {
    const locale = opts && opts.locale;
    const main = chatPane(rootEl);
    const stats = { rows: 0, containers: 0, parsed: 0, skipped: {}, byType: {} };
    if (!main) return { messages: [], stats, pane: null };

    const containers = Array.from(main.querySelectorAll("[data-id]")).filter((el) => !el.parentElement.closest("[data-id]"));
    const rows = Array.from(main.querySelectorAll('[role="row"]'));
    stats.rows = rows.length;
    stats.containers = containers.length;
    // Rows that hold no message container: date separators, system notices.
    const bareRows = rows.filter((r) => !r.querySelector("[data-id]") && !r.closest("[data-id]") && !r.querySelector('[role="row"]'));

    const items = [...containers.map((el) => ({ el, kind: "msg" })), ...bareRows.map((el) => ({ el, kind: "row" }))];
    items.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    // Bubbles are measured against the message list, not the whole pane.
    const list = (containers[0] && kit.findScroller(containers[0])) || main;
    const order = (opts && opts.dateOrder) || inferDateOrder(main.querySelectorAll("[data-pre-plain-text]"));
    const messages = [];
    const skip = (reason) => (stats.skipped[reason] = (stats.skipped[reason] || 0) + 1);
    for (const item of items) {
      let record = null;
      try {
        record = item.kind === "msg" ? readContainer(item.el, list, locale, order) : readBareRow(item.el);
      } catch (err) {
        skip("error");
        continue;
      }
      if (!record) {
        skip("empty row");
        continue;
      }
      if (record.type === "empty") {
        skip("no text or media");
        continue;
      }
      record.element = item.el; // in-memory only, for "Jump to message"
      messages.push(record);
      stats.byType[record.type] = (stats.byType[record.type] || 0) + 1;
      if (item.kind === "msg") stats.parsed++;
    }
    return { messages, stats, pane: main };
  }

  // One container (for a single-message check from the hover shield).
  function readOne(container, opts) {
    const pane = kit.findScroller(container) || container.closest("#main") || document.body;
    const order = inferDateOrder((container.closest("#main") || container).querySelectorAll("[data-pre-plain-text]"));
    const record = readContainer(container, pane, opts && opts.locale, order);
    return record.type === "empty" ? null : record;
  }

  function readMessages(rootEl, opts) {
    return read(rootEl, opts).messages;
  }

  root.TrustGraphWhatsAppReader = { read, readOne, readMessages, parsePrePlainText, parseDate, parseTime, inferDateOrder, chatPane };
})(globalThis);
