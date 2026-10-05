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

  // Quoted history and Gmail's "..." toggle must not be scored.
  const EXCLUDE = ".gmail_quote, .gmail_extra, blockquote, .gmail_attr, .ajU, .yj6qo, .adL > .adm";
  const BODY = ".a3s";
  const withBody = (el) => (el && el.querySelector(BODY) ? el : null);

  const adapter = {
    channel: "gmail",
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
      const body = el.querySelector(BODY);
      const bodyText = body ? kit.text(body, EXCLUDE) : "";
      const subjectEl = document.querySelector("h2.hP") || document.querySelector("h2[data-thread-perm-id]");
      const subject = subjectEl ? kit.clean(subjectEl.textContent) : "";
      if (!bodyText && !subject) return "";
      return kit.clean((subject ? "Subject: " + subject + "\n" : "") + bodyText);
    },

    sender(el) {
      const from = el.querySelector("span.gD[email]") || el.querySelector("[email]");
      return from ? from.getAttribute("email") : null;
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
