// Selector configs for LinkedIn messaging, Telegram Web, Discord and Slack
// (see adapters/config.js for the format).
//
// STATUS: hint-based, NOT yet verified against the live sites. Attribute
// selectors (data-*, id prefixes, roles) come first because class names on
// these sites are generated and change. Calibrate each with a real sample
// (README, "Site adapters: status and calibration").
(function () {
  "use strict";
  const kit = window.TrustGraphKit;
  const attr = (name) => (row) => {
    const el = row.matches(`[${name}]`) ? row : row.querySelector(`[${name}]`);
    return el ? el.getAttribute(name) : null;
  };

  const CONFIGS = [
    {
      // LinkedIn is one single-page app, and its chat pop-ups (bottom right)
      // open on every page, not just /messaging, so the adapter is on across
      // linkedin.com; the scan button only shows while a chat is visible.
      channel: "linkedin",
      matches: (url) => /^https:\/\/www\.linkedin\.com\//.test(url),
      rows: [
        { name: "event-listitem", selector: "li.msg-s-message-list__event" },
        { name: "data-event-urn", selector: "[data-event-urn]" },
      ],
      body: ".msg-s-event-listitem__body, [data-test-message-body]",
      exclude: "time, .msg-s-message-group__meta, .visually-hidden",
      sender: ".msg-s-message-group__name",
      inheritSender: true,
      time: "time",
      id: (row) => attr("data-event-urn")(row),
      // LinkedIn marks other people's messages with --other.
      outgoing: (row) => !!row.querySelector(".msg-s-event-listitem") && !row.querySelector(".msg-s-event-listitem--other"),
      pane: ".msg-s-message-list, .msg-s-message-list-container, .msg-overlay-conversation-bubble",
      header: ".msg-title-bar, .msg-thread__link-to-profile",
      composer: '.msg-form__contenteditable, [contenteditable="true"], [role="textbox"]',
    },
    {
      // Telegram Web K (/k/) and A (/a/) have different markup; both listed.
      channel: "telegram",
      matches: (url) => /^https:\/\/web\.telegram\.org\/(k|a)\//.test(url),
      rows: [
        { name: "k-bubble", selector: ".bubble[data-mid]" },
        { name: "a-message", selector: '.Message[id^="message"]' },
      ],
      body: ".message .translatable-message, .message > .text-content, .text-content, .message",
      exclude: ".time, .time-inner, .reactions, .reply, .name, .peer-title, .message-title, .Reactions, .EmbeddedMessage, .MessageMeta, i.tgico",
      sender: ".name .peer-title, .message-title .sender-title, .sender-title",
      inheritSender: true,
      time: ".time[title], .MessageMeta [title]",
      id: (row) => row.getAttribute("data-mid") || (row.id || "").replace(/^message-?/, "") || null, // K: data-mid; A: id="message-123"
      outgoing: (row) => row.classList.contains("is-out") || row.classList.contains("own"),
      pane: ".bubbles-inner, .MessageList",
      header: ".chat-info, .ChatInfo, .MiddleHeader",
      composer: '.input-message-input, [contenteditable="true"]',
    },
    {
      channel: "discord",
      matches: (url) => /^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\//.test(url),
      rows: [
        { name: "chat-messages-id", selector: 'li[id^="chat-messages-"]' },
        { name: "role-article", selector: '[role="article"][data-list-item-id^="chat-messages"]' },
      ],
      body: '[id^="message-content-"]:not([class*="repliedTextContent"])',
      exclude: 'time, [class*="timestamp"], [class*="edited"], [class*="repliedTextPreview"]',
      sender: '[id^="message-username-"] [class*="username"], [id^="message-username-"]',
      inheritSender: true,
      time: "time[datetime]",
      id: (row) => (row.id || "").replace(/^chat-messages-/, "") || null,
      pane: 'ol[data-list-id="chat-messages"], [data-list-id="chat-messages"]',
      header: 'section[aria-label="Channel header"], [class*="title"][class*="container"]',
      composer: '[role="textbox"], [contenteditable="true"]',
    },
    {
      channel: "slack",
      matches: (url) => /^https:\/\/app\.slack\.com\/client\//.test(url),
      rows: [
        { name: "message-container", selector: '[data-qa="message_container"]' },
        { name: "message-kit", selector: ".c-message_kit__message" },
      ],
      body: '[data-qa="message-text"], .p-rich_text_section, .c-message_kit__blocks',
      exclude: '[data-qa="message_sender"], .c-timestamp, [data-qa="reactji"], .c-message__edited_label',
      sender: '[data-qa="message_sender_name"]',
      inheritSender: true,
      time: ".c-timestamp[data-ts], [data-ts]",
      id: (row) => attr("data-msg-ts")(row) || attr("data-item-key")(row),
      pane: '[data-qa="slack_kit_list"], .c-virtual_list__scroll_container',
      header: '[data-qa="channel_header"], .p-view_header',
      composer: '[data-qa="message_input"], [contenteditable="true"], [role="textbox"]',
    },
  ];

  for (const cfg of CONFIGS) kit.register(kit.fromConfig(cfg));
})();
