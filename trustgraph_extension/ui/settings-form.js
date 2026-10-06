// The settings form, shared by the popup's Settings tab and the full
// settings page. Every change saves at once through the background
// (TG.MSG.SET_SETTINGS), which stores only the keys you change.
//
//   TrustGraphSettingsForm.mount(container, {compact, onAccountChange})
(function (root) {
  "use strict";
  const U = root.TrustGraphUI;
  const { el } = U;
  const send = (msg) => chrome.runtime.sendMessage(msg);

  const SITES = [
    ["gmail", "Gmail"],
    ["whatsapp", "WhatsApp Web"],
    ["linkedin", "LinkedIn messages"],
    ["telegram", "Telegram Web"],
    ["discord", "Discord"],
    ["slack", "Slack"],
    ["messenger", "Facebook Messenger"],
    ["instagram", "Instagram DMs"],
  ];
  const EXPERIMENTAL = new Set(["gmail", "linkedin", "telegram", "discord", "slack", "messenger", "instagram"]);
  const ALL_SITES = { origins: ["https://*/*"] };

  function row(label, sub, control, id) {
    return el("div", { class: "set-row" }, [
      el("div", { class: "set-text" }, [el("label", { class: "set-label", for: id || null, text: label }), sub ? el("p", { class: "set-sub", text: sub }) : null]),
      control,
    ]);
  }

  function group(title, children, eyebrow) {
    return el("section", { class: "set-group", "aria-label": title }, [U.eyebrow(eyebrow || title), el("div", { class: "tg-card flat set-card" }, children)]);
  }

  // Plain http only for this computer; anything else must be https and
  // needs the user's permission for that host.
  function validateUrl(raw, { allowEmpty } = {}) {
    const text = String(raw || "").trim();
    if (!text && allowEmpty) return { url: "", permission: null };
    let url;
    try {
      url = new URL(text);
    } catch (_) {
      return { error: "Enter a full address, like https://app.example.com" };
    }
    if (url.username || url.password) return { error: "Don't include a username or password in the address." };
    const normalized = url.origin + url.pathname.replace(/\/+$/, "");
    if (url.protocol === "http:") {
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return { url: normalized, permission: null };
      return { error: "Plain http:// is only allowed for 127.0.0.1 or localhost. Use https:// for other servers." };
    }
    if (url.protocol === "https:") return { url: normalized, permission: `https://${url.hostname}/*` };
    return { error: "The address must start with http:// or https://" };
  }

  function mount(container, opts = {}) {
    let settings = null;
    let account = null;
    let status = null;
    const msgs = {};

    async function save(patch) {
      settings = await send({ type: TG.MSG.SET_SETTINGS, patch });
      flash("Saved");
      return settings;
    }

    const live = el("p", { class: "set-saved tg-mono", role: "status", "aria-live": "polite" });
    let flashTimer = 0;
    function flash(text) {
      live.textContent = text;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => (live.textContent = ""), 1800);
    }

    function urlField(key, label, sub, { allowEmpty, placeholder, testable } = {}) {
      const id = "set-" + key;
      const input = el("input", { class: "tg-input", id, type: "url", spellcheck: "false", autocomplete: "off", value: settings[key], placeholder: placeholder || "" });
      const msg = el("p", { class: "set-msg", role: "status", "aria-live": "polite", text: msgs[key] || "" });
      async function commit() {
        const checked = validateUrl(input.value, { allowEmpty });
        if (checked.error) {
          msgs[key] = checked.error;
          msg.textContent = checked.error;
          msg.classList.add("error");
          input.setAttribute("aria-invalid", "true");
          return;
        }
        if (checked.permission) {
          // Must be the first await after the click so Chrome sees a user gesture.
          const granted = await chrome.permissions.request({ origins: [checked.permission] });
          if (!granted) {
            msg.textContent = "TrustGraph needs your permission to contact that address. Not saved.";
            msg.classList.add("error");
            return;
          }
        }
        await save({ [key]: checked.url });
        msgs[key] = "";
        msg.classList.remove("error");
        input.setAttribute("aria-invalid", "false");
        msg.textContent = checked.url ? "Saved." : "Cleared: using the built-in demo web app.";
      }
      input.addEventListener("keydown", (e) => e.key === "Enter" && commit());
      const buttons = el("div", { class: "set-inline" }, [
        U.button("Save", { small: true, onclick: commit }),
        testable
          ? U.button("Test", {
              small: true,
              onclick: async () => {
                msg.textContent = "Testing…";
                const st = await send({ type: TG.MSG.GET_STATUS });
                msg.textContent = st.serverUp ? `Connected to ${st.settings.backend_url}.` : `No answer from ${st.settings.backend_url}. Checks use the on-device rules.`;
                msg.classList.toggle("error", !st.serverUp);
              },
            })
          : null,
      ]);
      return el("div", { class: "set-block" }, [el("label", { class: "set-label", for: id, text: label }), sub ? el("p", { class: "set-sub", text: sub }) : null, el("div", { class: "set-inline grow" }, [input, buttons]), msg]);
    }

    function accountGroup() {
      const children = [];
      if (account.state === "signed_in") {
        children.push(
          row(account.name || "Signed in", account.mock ? "Connected to the built-in demo web app. Results sync as verdicts only." : "Results sync to your workspace as verdicts only.", U.button("Disconnect", { small: true, onclick: async () => { await send({ type: TG.MSG.SIGN_OUT }); await refresh(); opts.onAccountChange && opts.onAccountChange(); } }))
        );
      } else {
        const code = el("input", { class: "tg-input", id: "set-pair", placeholder: "ABCD-1234", autocomplete: "off", spellcheck: "false", "aria-describedby": "set-pair-msg", style: "text-transform:uppercase;max-width:150px" });
        const msg = el("p", { class: "set-msg", id: "set-pair-msg", role: "status", "aria-live": "polite" });
        const connect = async () => {
          msg.classList.remove("error");
          msg.textContent = "Connecting…";
          const noAnswer = "No answer from TrustGraph. Reload it in chrome://extensions and try again.";
          const res = await Promise.race([send({ type: TG.MSG.PAIR, code: code.value }), new Promise((r) => setTimeout(() => r(null), TG.UI_WAIT_MS))])
            .then((r) => r || { ok: false, error: noAnswer }, () => ({ ok: false, error: noAnswer }));
          if (res.ok) {
            await refresh();
            opts.onAccountChange && opts.onAccountChange();
          } else {
            msg.textContent = res.error;
            msg.classList.add("error");
          }
        };
        code.addEventListener("keydown", (e) => e.key === "Enter" && connect());
        children.push(
          row(account.state === "local" ? "Using without an account" : "Not connected", "History stays on this device. Connect to sync verdicts (never message text) to the web app.", U.button("Sign in", { small: true, primary: true, onclick: () => send({ type: TG.MSG.OPEN_AUTH, page: "login" }) })),
          el("div", { class: "set-block" }, [el("label", { class: "set-label", for: "set-pair", text: "Pairing code" }), el("p", { class: "set-sub", text: "After signing in, the web app shows a code. Paste it here." }), el("div", { class: "set-inline" }, [code, U.button("Connect", { small: true, onclick: connect })]), msg])
        );
      }
      return group("Account", children);
    }

    function sitesGroup() {
      const rows = SITES.map(([key, label]) => {
        const id = "set-src-" + key;
        return row(label, EXPERIMENTAL.has(key) ? "Experimental" : null, U.switchInput(id, settings.sources[key] !== false, (e) => save({ sources: { [key]: e.target.checked } })), id);
      });
      // Any other site: needs the optional all-sites permission.
      const gid = "set-src-generic";
      rows.push(
        row(
          "Any other site",
          "Shield on any page with text. Asks Chrome for access to all sites; right-click checks work everywhere without it.",
          U.switchInput(gid, !!settings.sources.generic, async (e) => {
            const on = e.target.checked;
            if (on) {
              const granted = await chrome.permissions.request(ALL_SITES);
              if (!granted) {
                e.target.checked = false;
                return;
              }
            } else {
              await chrome.permissions.remove(ALL_SITES).catch(() => {});
            }
            await save({ sources: { generic: on } });
          }),
          gid
        )
      );
      return group("Sites", rows);
    }

    function scanningGroup() {
      return group("Scanning", [
        row("How checks start", settings.scan_mode === "auto" ? "Open chats are scanned in the background. The panel stays a thin rail and only opens for High risk." : "Nothing is read until you click the shield or the scan button.", U.segmented("scan_mode", [["click", "Click to scan"], ["auto", "Auto-scan"]], settings.scan_mode, (v) => save({ scan_mode: v }).then(render), "How checks start")),
        row("Shield position", "Where the shield sits on a message.", el("select", { class: "tg-input", id: "set-shield", style: "width:auto", onchange: (e) => save({ shield_position: e.target.value }) }, [["top-right", "Top right"], ["top-left", "Top left"], ["bottom-right", "Bottom right"]].map(([v, l]) => el("option", { value: v, text: l, selected: settings.shield_position === v }))), "set-shield"),
        row("Sensitivity", { relaxed: "Fewer warnings: Caution from 45, High from 80.", balanced: "Caution from 35, High from 70.", strict: "More warnings: Caution from 25, High from 60." }[settings.sensitivity], U.segmented("sensitivity", [["relaxed", "Relaxed"], ["balanced", "Balanced"], ["strict", "Strict"]], settings.sensitivity, (v) => save({ sensitivity: v }).then(render), "Sensitivity")),
        row(
          "Notify me on high risk",
          "A system notification that says where, never what the message said.",
          U.switchInput("set-notify", settings.notify_high, async (e) => {
            const on = e.target.checked;
            if (on) {
              const granted = await chrome.permissions.request({ permissions: ["notifications"] });
              if (!granted) {
                e.target.checked = false;
                return;
              }
            }
            await save({ notify_high: on });
          }),
          "set-notify"
        ),
        row("Pause TrustGraph", "Hides the shield and scan button everywhere. Right-click still works.", U.switchInput("set-pause", settings.paused, (e) => save({ paused: e.target.checked })), "set-pause"),
      ]);
    }

    function historyGroup() {
      return group("History", [
        row("Save results to history", "Verdicts and metadata only. You can switch it off per result in the panel.", U.switchInput("set-save", settings.save_history, (e) => save({ save_history: e.target.checked })), "set-save"),
        row("Keep history for", null, el("select", { class: "tg-input", id: "set-retention", style: "width:auto", onchange: (e) => save({ retention_days: Number(e.target.value) }) }, [[7, "7 days"], [30, "30 days"], [90, "90 days"], [0, "Forever"]].map(([v, l]) => el("option", { value: String(v), text: l, selected: Number(settings.retention_days) === v }))), "set-retention"),
        row("Demo data", "Fills History and Overview with sample verdicts so you can explore. Switch off to remove them.", U.switchInput("set-demo", settings.demo_data, (e) => save({ demo_data: e.target.checked }).then(() => opts.onDataChange && opts.onDataChange())), "set-demo"),
      ]);
    }

    function appearanceGroup() {
      return group("Appearance", [row("Theme", null, U.segmented("theme", [["dark", "Dark"], ["light", "Light"]], settings.theme, (v) => save({ theme: v }).then(() => TrustGraphDesign.applyTheme(document, v)), "Theme"))]);
    }

    function engineGroup() {
      const engineNote =
        settings.engine === "local"
          ? "Checks run only on this device with TrustGraph's scam rules. Works offline."
          : status && status.serverUp
            ? "Message text is sent to the scoring server below for the full analysis. The on-device rules still run and the higher verdict wins."
            : "Server not reachable right now, so checks use the on-device rules.";
      return group("Engine and web app", [
        row("Scoring engine", engineNote, U.segmented("engine", [["remote", "Remote"], ["local", "On-device"]], settings.engine, (v) => save({ engine: v }).then(refreshStatus), "Scoring engine")),
        settings.engine === "remote" ? urlField("backend_url", "Scoring server URL", "http://127.0.0.1 or localhost (any port), or any https:// address.", { testable: true }) : null,
        urlField("webapp_url", "Web app URL", "Where History syncs and “Open in workspace” goes. Leave empty to use the TrustGraph server's workspace (the built-in demo when checks are on-device only).", { allowEmpty: true, placeholder: "Same as the TrustGraph server" }),
        row("Debug mode", "Outlines recognised messages and logs counts (never text) to the page console.", U.switchInput("set-debug", settings.debug, (e) => save({ debug: e.target.checked })), "set-debug"),
      ]);
    }

    function privacyCard() {
      return el("section", { class: "set-group", "aria-label": "Privacy" }, [
        U.eyebrow("Privacy", true),
        el("div", { class: "tg-card pad" }, [
          el("ul", { class: "tg-checks" }, [
            U.checkRow("No message text in detection history", "Only the verdict and its metadata come home."),
            U.checkRow("No scam reports or public submission database"),
            U.checkRow("Delete or export your data anytime", "From the History tab."),
          ]),
          el("p", { class: "set-sub", style: "margin:14px 0 0" }, [el("a", { class: "tg-link", href: chrome.runtime.getURL("ui/privacy.html"), target: "_blank", text: "Read the privacy policy" })]),
        ]),
      ]);
    }

    function render() {
      const focusId = document.activeElement && document.activeElement.id;
      container.replaceChildren(
        el("div", { class: "set-head" }, [opts.compact ? null : el("h2", { class: "tg-h set-title", text: "Settings" }), live]),
        accountGroup(),
        sitesGroup(),
        scanningGroup(),
        historyGroup(),
        appearanceGroup(),
        engineGroup(),
        privacyCard(),
        opts.compact ? el("p", { class: "set-sub", style: "text-align:center;margin:4px 0 8px" }, [el("button", { class: "tg-link", type: "button", text: "Open settings in a tab", onclick: () => chrome.runtime.openOptionsPage() })]) : null
      );
      if (focusId) {
        const again = document.getElementById(focusId);
        if (again) again.focus();
      }
    }

    async function refreshStatus() {
      status = await send({ type: TG.MSG.GET_STATUS });
      render();
    }

    async function refresh() {
      [settings, account] = await Promise.all([send({ type: TG.MSG.GET_SETTINGS }), send({ type: TG.MSG.GET_ACCOUNT })]);
      render();
    }

    container.append(U.skeleton("60%", 18), U.skeleton("100%", 120));
    refresh().then(refreshStatus);
    return { refresh };
  }

  // Styles for the form (used inside pages that adopt the design system).
  const CSS = `
    .set-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .set-title { font-size: 26px; }
    .set-saved { position: fixed; z-index: 5; right: 16px; bottom: 48px; margin: 0; padding: 4px 10px; border-radius: 999px; color: var(--low); background: var(--surface-2); border: var(--hair) solid var(--low-line); }
    .set-saved:empty { display: none; }
    .set-group { display: grid; gap: 8px; margin-top: 18px; }
    .set-card { padding: 4px 14px; border-radius: 14px; }
    .set-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 0; }
    .set-row + .set-row, .set-row + .set-block, .set-block + .set-row, .set-block + .set-block { border-top: var(--hair) solid color-mix(in srgb, var(--border) 60%, transparent); }
    .set-text { min-width: 0; }
    .set-label { display: block; font-weight: 500; font-size: 13.5px; }
    .set-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-dim); }
    .set-block { padding: 11px 0; display: grid; gap: 6px; }
    .set-inline { display: flex; gap: 6px; align-items: center; }
    .set-inline.grow > .tg-input { flex: 1; min-width: 0; }
    .set-msg { margin: 0; font-size: 12.5px; color: var(--text-muted); min-height: 0; }
    .set-msg:empty { display: none; }
    .set-msg.error { color: var(--high); }
    .set-row .tg-seg { flex: none; }
  `;

  root.TrustGraphSettingsForm = { mount, validateUrl, CSS };
})(globalThis);
