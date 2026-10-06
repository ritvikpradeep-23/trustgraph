// Gmail adapter (https://mail.google.com). Granularity: one expanded email
// in an open thread. The inbox list isn't supported (open the email, or
// select text and right-click).
//
// STATUS: hint-based, NOT yet verified against the live site. Historical
// structure: body div.a3s inside a message wrapper div.adn (or div.gs);
// subject h2.hP; sender span.gD with "email" and "name" attributes; some
// containers carry data-message-id / data-legacy-message-id. Gmail's class
// names are generated and can change, so data-* and role fallbacks follow.
// Calibrate with a real sample saved as test/fixtures/gmail.html.
(function () {
  "use strict";
  const kit = window.TrustGraphKit;

  // Never scored: quoted history, signatures and Gmail's "..." toggle. Gmail
  // renames classes and ids inside emails sent from other apps (adds an
  // "m_123..." prefix), so these match on "contains".
  const EXCLUDE = [
    "blockquote", ".ajU", ".yj6qo", ".adL > .adm",
    '[class*="gmail_quote"]', '[class*="gmail_extra"]', '[class*="gmail_attr"]', '[class*="gmail_signature"]',
    '[id*="divRplyFwdMsg"]', '[id*="appendonsend"]', '[class*="OutlookMessageHeader"]', // Outlook replies
    '[class*="moz-cite-prefix"]', '[class*="moz-signature"]', '[class*="yahoo_quoted"]', '[id*="ymail_android_signature"]',
    '[class*="ms-outlook-mobile-signature"]', '[id*="Signature"]',
  ].join(", ");

  // Cuts what the selectors can't catch, by its words: the older message
  // under "On <date>, <name> wrote:" or "-----Original Message-----" or an
  // Outlook "From: / Sent:" header, and a legal disclaimer at the end
  // ("This email is confidential... do not forward"), which otherwise reads
  // like a scammer asking for secrecy. Forwarded messages are kept: a
  // forwarded scam is what the user wants checked.
  const QUOTE_START = /^(?:on .{4,200}wrote:\s*$|-{2,}\s*original message\s*-{2,}|_{8,}\s*$)/im;
  const OUTLOOK_HEADER = /^from:\s.+\n(?:.*\n){0,2}?(?:sent|date):\s.+$/im;
  const DISCLAIMER = /^(?:confidentiality notice|disclaimer\b|legal notice|this (?:e-?mail|message|communication)(?: and any (?:attachments?|files))? (?:is|are|contains?|may contain|is intended)\b.{0,40}(?:confidential|privileged|intended)|the information (?:contained )?in this (?:e-?mail|message)|if you (?:are not|have received this).{0,60}(?:intended recipient|in error))/im;
  function trimEmail(text) {
    let t = text;
    const cut = (m) => (m && m.index > 0 ? (t = t.slice(0, m.index)) : t);
    cut(QUOTE_START.exec(t));
    cut(OUTLOOK_HEADER.exec(t));
    const d = DISCLAIMER.exec(t);
    if (d && t.slice(0, d.index).trim().length >= 10) t = t.slice(0, d.index); // keep it only if it's ALL there is
    return t.trim();
  }
  const BODY = ".a3s";
  const withBody = (el) => (el && el.querySelector(BODY) ? el : null);

  // The signed-in address, from the account button's label ("Google
  // Account: Name (name@gmail.com)").
  function accountEmail() {
    const el = document.querySelector('[aria-label^="Google Account"], a[aria-label*="@"][href*="accounts.google.com"]');
    const m = el && (el.getAttribute("aria-label") || "").match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    return m ? m[0].toLowerCase() : null;
  }

  const adapter = {
    channel: "gmail",
    push: true,
    strategies: [
      {
        name: "adn-wrapper",
        find: (t) => withBody(t.closest("div.adn")) || withBody(t.closest("div.gs")),
        all: () => {
          const adn = Array.from(document.querySelectorAll("div.adn")).filter(withBody);
          return adn.length ? adn : Array.from(document.querySelectorAll("div.gs")).filter(withBody);
        },
      },
      {
        name: "data-message-id",
        find: (t) => withBody(t.closest("[data-message-id], [data-legacy-message-id]")),
        all: () => Array.from(document.querySelectorAll("[data-message-id], [data-legacy-message-id]")).filter(withBody),
      },
      {
        name: "role-listitem",
        find: (t) => withBody(t.closest('[role="listitem"]')),
        all: () => Array.from(document.querySelectorAll('[role="listitem"]')).filter(withBody),
      },
    ],

    matches(url) {
      return url.startsWith("https://mail.google.com/");
    },

    findMessage(target) {
      if (target.closest('[contenteditable="true"], [role="textbox"]')) return null; // reply box
      return kit.find(adapter, target);
    },

    // "Subject: <subject>" plus the body, so subject-line scams count too.
    extractText(el) {
      const r = adapter.record(el);
      return r ? kit.clean((r.subject ? "Subject: " + r.subject + "\n" : "") + r.text) : "";
    },

    // Everything a single check needs: the email's own text, who it's from
    // (address and display name, to spot "PayPal" sending from a lookalike
    // domain) and its links with their visible text (to spot a link that
    // shows one address and opens another). Memory only.
    record(el) {
      const body = el.querySelector(BODY);
      const subjectEl = document.querySelector("h2.hP") || document.querySelector("h2[data-thread-perm-id]");
      const subject = subjectEl ? kit.clean(subjectEl.textContent) : "";
      const text = body ? trimEmail(kit.text(body, EXCLUDE, { lines: true })) : "";
      if (!text && !subject) return null;
      const from = el.querySelector("span.gD[email]") || el.querySelector("[email]");
      const quote = body && body.querySelector(EXCLUDE);
      return {
        text,
        subject,
        sender: from ? from.getAttribute("email") : null,
        senderName: from ? from.getAttribute("name") || kit.clean(from.textContent) || null : null,
        links: body ? kit.links(body, quote) : [],
      };
    },

    sender(el) {
      const from = el.querySelector("span.gD[email]") || el.querySelector("[email]");
      return from ? from.getAttribute("email") : null;
    },

    // --- chat-level reading (content/chat-store.js) ----------------------
    // One record per expanded email in the open thread.
    read() {
      const els = adapter.listMessages();
      const subjectEl = document.querySelector("h2.hP") || document.querySelector("h2[data-thread-perm-id]");
      const subject = subjectEl ? kit.clean(subjectEl.textContent) : "";
      const account = accountEmail();
      const pane = adapter.messagePane();
      const stats = { rows: els.length, containers: els.length, parsed: 0, skipped: {}, byType: {} };
      const messages = [];
      for (const el of els) {
        const body = el.querySelector(BODY);
        const quote = body && body.querySelector(EXCLUDE);
        const text = body ? trimEmail(kit.text(body, EXCLUDE, { lines: true })) : "";
        const from = el.querySelector("span.gD[email]") || el.querySelector("[email]");
        const email = from ? from.getAttribute("email") : null;
        const timeEl = el.querySelector(".g3[title]") || el.querySelector("span[title][alt]");
        const when = timeEl ? Date.parse(timeEl.getAttribute("title")) : NaN;
        const hasMedia = !!el.querySelector("[download_url], .aZo, .aQH");
        const type = text ? "text" : hasMedia ? "media" : "empty";
        if (type === "empty") {
          stats.skipped["no text or media"] = (stats.skipped["no text or media"] || 0) + 1;
          continue;
        }
        stats.parsed++;
        stats.byType[type] = (stats.byType[type] || 0) + 1;
        messages.push({
          id: el.getAttribute("data-message-id") || el.getAttribute("data-legacy-message-id") || "gm:" + kit.hashId(String(email) + text.slice(0, 200)),
          sender: email,
          senderName: from ? from.getAttribute("name") : null,
          timestamp: Number.isFinite(when) ? when : null,
          subject,
          text,
          links: body ? kit.links(body, quote) : [],
          isReply: !!quote || /^re:/i.test(subject),
          quotedText: "", // never needed, so never read
          hasMedia,
          mediaType: hasMedia ? "attachment" : null,
          isForwarded: /^fwd?:/i.test(subject) || /-+ ?forwarded message ?-+/i.test(text),
          // Your own emails: the sender is the signed-in account.
          direction: account && email ? (email.toLowerCase() === account ? "outgoing" : "incoming") : "incoming",
          type,
          element: el,
        });
      }
      return { messages, stats, pane };
    },

    readMessages() {
      return adapter.read().messages;
    },

    chatKey() {
      return location.hash; // each open thread has its own #…/threadId
    },

    scroller() {
      const first = adapter.listMessages()[0];
      return (first && kit.findScroller(first)) || null;
    },

    messagePane() {
      return document.querySelector('[role="main"]') || document.body;
    },

    elementFor(id) {
      const safe = CSS.escape(id);
      return document.querySelector(`[data-message-id="${safe}"], [data-legacy-message-id="${safe}"]`);
    },

    listMessages() {
      return kit.list(adapter);
    },

    selfTest() {
      return adapter.listMessages().length;
    },
  };

  adapter.trimEmail = trimEmail; // for tests
  kit.register(adapter);
})();
