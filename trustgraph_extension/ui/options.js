// Welcome + Settings page.
//   #welcome[/N]  first-run onboarding: the three pipeline steps, the
//                 privacy promise, then "get started" (try a sample, sign
//                 in or use without an account, demo data)
//   (default)     the full settings form (ui/settings-form.js)
(function () {
  "use strict";
  const U = TrustGraphUI;
  const { el } = U;
  const send = (msg) => chrome.runtime.sendMessage(msg);
  TrustGraphDesign.adopt(document, TrustGraphSettingsForm.CSS);

  const main = document.getElementById("main");
  document.getElementById("brand-logo").append(U.logo());

  const STEPS = [
    {
      eyebrow: "Step 1 of 3 · Extension detects",
      title: "Point at a message you're unsure about.",
      lead: "Hover a message on a page you already use and click the small shield, or click the round TrustGraph button to scan the chat that's open. Anywhere else, select text and right-click “Check with TrustGraph”.",
      bullets: [
        ["Nothing is read until you click", "Hovering and scrolling read nothing."],
        ["Gmail, WhatsApp, LinkedIn, Telegram, Discord, Slack, Messenger, Instagram", "Plus any site, if you allow it in Settings."],
        ["Your own messages are never checked", "Only messages from other people."],
      ],
    },
    {
      eyebrow: "Step 2 of 3 · Engine thinks",
      title: "A scoring engine reads the signals.",
      lead: "The message goes to the engine you choose: TrustGraph's on-device rules, or your TrustGraph server. It answers with a verdict (Low risk, Caution or High risk), a 0–100 score, a plain explanation and the signals behind it.",
      bullets: [
        ["Urgency, money requests, codes and lookalike links", "Eight signal types, each explained in plain words."],
        ["English, Malayalam, Manglish, Hinglish and Hindi", "Including “we will never ask for your OTP” style negation."],
        ["Works offline", "If the server can't be reached, the on-device rules still answer."],
      ],
    },
    {
      eyebrow: "Step 3 of 3 · Web app shows and manages",
      title: "Only the verdict comes home.",
      lead: "Your history keeps the verdict, score, signal types, site and time. Never the message. Sign in to sync that history to your TrustGraph workspace, or keep it on this device only.",
      bullets: [
        ["History, filters and search in the toolbar popup", "Tap a result to see its signals again."],
        ["Export as JSON or CSV, delete one or everything", "Whenever you like."],
        ["Mark a verdict as wrong", "Sends only the verdict's id, so the engine can improve."],
      ],
    },
  ];
  const PIPE = [
    ["scan", "Extension detects", "On the page you're already using."],
    ["sparkles", "Engine thinks", "Scores the message in memory."],
    ["layers", "Web app shows and manages", "Verdicts and metadata only."],
  ];

  // -------------------------------------------------------------------------
  function route() {
    const hash = location.hash.replace(/^#/, "");
    const [page, n] = hash.split("/");
    if (page === "welcome") renderWelcome(Math.max(0, Math.min(4, Number(n) || 0)));
    else renderSettings();
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  const go = (hash) => (location.hash = hash);

  function nav(current) {
    return el("nav", { class: "nav", "aria-label": "Pages" }, [
      U.button("Welcome tour", { small: true, ghost: current !== "welcome", pressed: current === "welcome", icon: "sparkles", onclick: () => go("welcome") }),
      U.button("Settings", { small: true, ghost: current !== "settings", pressed: current === "settings", icon: "settings", onclick: () => go("") }),
      el("a", { class: "tg-btn small ghost", href: "privacy.html" }, [U.icon("lockKeyhole"), el("span", { text: "Privacy policy" })]),
    ]);
  }

  function stepper(i) {
    return el("div", { class: "stepper", role: "progressbar", "aria-label": "Welcome progress", "aria-valuemin": "1", "aria-valuemax": "5", "aria-valuenow": String(i + 1) }, [0, 1, 2, 3, 4].map((k) => el("i", { class: k <= i ? "on" : "" })));
  }

  function acts(i) {
    return el("div", { class: "step-acts" }, [
      i > 0 ? U.button("Back", { icon: "chevronLeft", onclick: () => go("welcome/" + (i - 1)) }) : U.button("Skip to settings", { ghost: true, onclick: () => go("") }),
      el("span", { class: "sp" }),
      i < 4 ? U.button(i === 3 ? "Get started" : "Next", { primary: true, arrow: true, onclick: () => go("welcome/" + (i + 1)) }) : null,
    ]);
  }

  function renderWelcome(i) {
    const nodes = [nav("welcome"), stepper(i)];
    if (i < 3) {
      const s = STEPS[i];
      nodes.push(
        U.eyebrow(s.eyebrow, true),
        el("h2", { class: "tg-h step-title", text: s.title }),
        el("p", { class: "step-lead", text: s.lead }),
        el("div", { class: "pipeline", "aria-hidden": "true" }, PIPE.map(([icon, title, sub], k) => el("div", { class: "tg-card pipe" + (k === i ? " on" : "") }, [el("span", { class: "ic" }, [U.icon(icon)]), el("h3", { text: title }), el("p", { text: sub })]))),
        el("div", { class: "tg-card detail" }, [el("ul", { class: "tg-checks" }, s.bullets.map(([a, b]) => U.checkRow(a, b)))]),
        i === 1 ? engineNote() : null,
        acts(i)
      );
    } else if (i === 3) {
      nodes.push(
        U.eyebrow("The privacy promise", true),
        el("h2", { class: "tg-h step-title", text: "Three guarantees, built into the code." }),
        el("p", { class: "step-lead", text: "TrustGraph's stored record has no field that could hold text, and a test fails the build if anyone adds one." }),
        el("div", { class: "tg-card promise" }, [
          el("ul", { class: "tg-checks" }, [
            U.checkRow("No message text in detection history", "Only the verdict, score, signal types, site and time are kept or synced."),
            U.checkRow("No scam reports or public submission database", "Nothing you check is shared with anyone. “Mark as wrong” sends only a verdict id."),
            U.checkRow("Delete or export your data anytime", "JSON or CSV export, delete one result or everything, from the toolbar popup."),
          ]),
        ]),
        acts(i)
      );
    } else {
      nodes.push(...getStarted());
    }
    main.replaceChildren(...nodes.filter(Boolean));
  }

  function engineNote() {
    const line = el("p", { class: "small-note", style: "margin-top:14px", role: "status", text: "Checking for your TrustGraph server…" });
    send({ type: TG.MSG.GET_STATUS })
      .then((st) => {
        line.textContent =
          st.settings.engine === "local"
            ? "Engine: on-device rules only."
            : st.serverUp
              ? `Engine: TrustGraph server found at ${st.settings.backend_url}, with the on-device rules alongside.`
              : `No TrustGraph server at ${st.settings.backend_url} right now, so checks use the on-device rules. You can change this in Settings.`;
      })
      .catch(() => (line.textContent = ""));
    return line;
  }

  function getStarted() {
    const sample = el("textarea", { class: "tg-input", id: "sample", "aria-label": "Sample message" });
    sample.value = "Hi Mum, I lost my phone so this is my new number. Can you buy two Google Play gift cards and send me the codes? It's urgent, please don't tell Dad.";
    const tryBtn = U.button("Check this message", {
      primary: true,
      icon: "shieldCheck",
      onclick: async () => {
        tryBtn.disabled = true;
        TrustGraphPanel.showChecking({ sample: true });
        try {
          const res = await send({ type: TG.MSG.SCORE, text: sample.value, channel: "other", noStats: true });
          // A sample: not counted or saved, so no history actions.
          TrustGraphPanel.showSingle({ verdict: res.verdict }, { sample: true });
        } catch (_) {
          TrustGraphPanel.showSingle({ error: "Couldn't run the check. Try reloading this page." }, { sample: true });
        } finally {
          tryBtn.disabled = false;
        }
      },
    });
    const accountMsg = el("p", { class: "small-note", role: "status", "aria-live": "polite" });
    const demo = U.switchInput("start-demo", false, async (e) => {
      await send({ type: TG.MSG.SET_SETTINGS, patch: { demo_data: e.target.checked } });
      accountMsg.textContent = e.target.checked ? "Demo data is on: open the toolbar popup to explore." : "Demo data removed.";
    }, "Start with demo data");
    send({ type: TG.MSG.GET_SETTINGS }).then((s) => (demo.checked = !!s.demo_data));
    return [
      U.eyebrow("You're set", true),
      el("h2", { class: "tg-h step-title", text: "Try it, then choose how to keep history." }),
      el("div", { class: "tg-card try" }, [el("label", { for: "sample", class: "tg-eyebrow", text: "A sample message (edit it if you like)" }), sample, el("div", { class: "step-acts", style: "margin-top:0" }, [tryBtn, el("span", { class: "small-note", text: "Samples aren't counted or saved." })])]),
      el("div", { class: "start-grid" }, [
        el("div", { class: "tg-card start-card" }, [
          el("h3", { text: "Sync to your workspace" }),
          el("p", { text: "Sign in on the web app, then paste the pairing code in the toolbar popup. TrustGraph never sees your password." }),
          el("div", { class: "step-acts", style: "margin-top:4px" }, [U.button("Sign in", { primary: true, arrow: true, onclick: () => send({ type: TG.MSG.OPEN_AUTH, page: "login" }) }), U.button("Create account", { onclick: () => send({ type: TG.MSG.OPEN_AUTH, page: "register" }) })]),
        ]),
        el("div", { class: "tg-card start-card" }, [
          el("h3", { text: "Use without account" }),
          el("p", { text: "History stays on this device only. You can connect later." }),
          el("div", { class: "step-acts", style: "margin-top:4px" }, [
            U.button("Use without account", {
              onclick: async () => {
                await send({ type: TG.MSG.USE_LOCAL });
                accountMsg.textContent = "Done. Your history stays on this device. Open the toolbar popup any time.";
              },
            }),
          ]),
        ]),
      ]),
      el("div", { class: "tg-card start-card", style: "margin-top:10px;grid-template-columns:1fr auto;align-items:center" }, [el("div", null, [el("label", { for: "start-demo", class: "set-label", text: "Start with demo data" }), el("p", { text: "Fill the popup with sample verdicts so you can look around. Switch it off any time." })]), demo]),
      accountMsg,
      el("div", { class: "step-acts" }, [U.button("Back", { icon: "chevronLeft", onclick: () => go("welcome/3") }), el("span", { class: "sp" }), U.button("Open settings", { onclick: () => go("") })]),
    ];
  }

  function renderSettings() {
    const box = el("div");
    main.replaceChildren(nav("settings"), box);
    TrustGraphSettingsForm.mount(box, {});
  }

  // Theme from settings, kept in sync.
  async function applyTheme() {
    try {
      const s = await send({ type: TG.MSG.GET_SETTINGS });
      TrustGraphDesign.applyTheme(document, s.theme);
      TrustGraphPanel.setTheme(s.theme);
    } catch (_) {}
  }
  chrome.storage.onChanged.addListener((c, area) => area === "local" && c.settings && applyTheme());

  window.addEventListener("hashchange", route);
  applyTheme();
  route();
})();
