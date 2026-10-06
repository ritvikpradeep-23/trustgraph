// Toolbar popup (400px). Signed out: the pitch, Sign in / Create account,
// pairing code, "Use without account". Signed in (or local-only): tabs
// Overview, History, Settings. Everything here is verdicts and metadata;
// no message text ever reaches the popup.
(function () {
  "use strict";
  const U = TrustGraphUI;
  const { el } = U;
  const V = TrustGraphVerdict;
  const send = (msg) => chrome.runtime.sendMessage(msg);

  TrustGraphDesign.adopt(document, TrustGraphSettingsForm.CSS);

  const app = document.getElementById("app");
  const dlg = document.getElementById("confirm");
  let account = { state: "signed_out" };
  let settings = TG.DEFAULT_SETTINGS;
  let tab = "overview";
  try {
    tab = sessionStorage.getItem("tg-tab") || "overview";
  } catch (_) {}

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  function statusChip() {
    if (account.state === "signed_in") return el("span", { class: "tg-status", "data-state": account.online ? "in" : "offline", role: "status", text: account.online ? "Signed in" : "Offline" });
    if (account.state === "local") return el("span", { class: "tg-status", "data-state": "local", role: "status", text: "Local only" });
    return el("span", { class: "tg-status", "data-state": "out", role: "status", text: "Signed out" });
  }

  function header() {
    return el("header", { class: "top" }, [
      U.logo(),
      el("span", { class: "sp" }),
      statusChip(),
      U.iconButton("settings", "Settings", () => (account.state === "signed_out" ? chrome.runtime.openOptionsPage() : select("settings"))),
    ]);
  }

  const TABS = [
    ["overview", "Overview", "gauge"],
    ["history", "History", "history"],
    ["settings", "Settings", "settings"],
  ];

  function tabs() {
    const list = el(
      "div",
      { class: "tabs", role: "tablist", "aria-label": "TrustGraph" },
      TABS.map(([id, label, icon]) =>
        el("button", { class: "tab", role: "tab", id: "tab-" + id, type: "button", "aria-selected": String(tab === id), "aria-controls": "view", tabindex: tab === id ? "0" : "-1", onclick: () => select(id) }, [U.icon(icon), label])
      )
    );
    // Arrow keys move between tabs (WAI-ARIA tabs pattern).
    list.addEventListener("keydown", (e) => {
      const i = TABS.findIndex(([id]) => id === tab);
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      select(TABS[(i + step + TABS.length) % TABS.length][0], true);
    });
    return list;
  }

  function select(id, focusTab) {
    tab = id;
    try {
      sessionStorage.setItem("tg-tab", id);
    } catch (_) {}
    render();
    if (focusTab) document.getElementById("tab-" + id).focus();
  }

  function render() {
    TrustGraphDesign.applyTheme(document, settings.theme);
    if (account.state === "signed_out") {
      app.replaceChildren(header(), el("div", { class: "view tg-grid-bg", id: "view" }, signedOut()), footer());
      return;
    }
    const view = el("div", { class: "view", id: "view", role: "tabpanel", "aria-labelledby": "tab-" + tab, tabindex: "-1" });
    app.replaceChildren(header(), tabs(), view, footer());
    if (tab === "overview") renderOverview(view);
    else if (tab === "history") renderHistory(view);
    else TrustGraphSettingsForm.mount(view, { compact: true, onAccountChange: load, onDataChange: () => {} });
  }

  function footer() {
    // The version shows which copy Chrome is running (handy after a git pull).
    return el("div", { class: "foot" }, [el("span", { class: "tg-mono", text: `No message text stored · Results only · v${chrome.runtime.getManifest().version}` })]);
  }

  // ---------------------------------------------------------------------------
  // Signed out
  // ---------------------------------------------------------------------------
  function signedOut() {
    const code = el("input", { class: "tg-input", id: "pair-code", placeholder: "ABCD-1234", autocomplete: "off", spellcheck: "false", "aria-label": "Pairing code from the web app" });
    const msg = el("p", { class: "msg", role: "status", "aria-live": "polite" });
    const connect = async () => {
      msg.classList.remove("error");
      msg.textContent = "Connecting…";
      const res = await send({ type: TG.MSG.PAIR, code: code.value });
      if (res.ok) return load();
      msg.textContent = res.error;
      msg.classList.add("error");
    };
    code.addEventListener("keydown", (e) => e.key === "Enter" && connect());
    return [
      el("div", { class: "hero" }, [
        el("div", { class: "nodes", "aria-hidden": "true" }, [el("span", { class: "tg-node blue" }), el("span", { class: "tg-node amber" }), el("span", { class: "tg-node green" })]),
        U.eyebrow("Privacy-first detection", true),
        el("h1", { class: "tg-h" }, ["Read the signal.", el("br"), el("em", { text: "Keep the trust." })]),
        el("p", { class: "lead", text: "Check any message in one click. Only the verdict comes home; the message stays where it was." }),
        el("div", { class: "btn-row" }, [
          U.button("Sign in", { primary: true, arrow: true, onclick: () => send({ type: TG.MSG.OPEN_AUTH, page: "login" }) }),
          U.button("Create account", { onclick: () => send({ type: TG.MSG.OPEN_AUTH, page: "register" }) }),
        ]),
      ]),
      el("div", { class: "or" }, [U.eyebrow("Have a pairing code?")]),
      el("div", { class: "pair" }, [code, U.button("Connect", { onclick: connect })]),
      msg,
      el("div", { class: "tg-card local-cta" }, [
        el("div", { style: "flex:1" }, [el("p", { class: "t", text: "Use without account" }), el("p", { text: "History stays on this device only." })]),
        U.button("Continue", {
          small: true,
          arrow: true,
          onclick: async () => {
            await send({ type: TG.MSG.USE_LOCAL });
            load();
          },
        }),
      ]),
    ];
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------
  async function renderOverview(view) {
    view.replaceChildren(U.skeleton("40%", 12), el("div", { class: "tiles", style: "margin-top:10px" }, [U.skeleton("100%", 64), U.skeleton("100%", 64), U.skeleton("100%", 64)]), el("div", { style: "margin-top:14px" }, [U.skeleton("100%", 90)]));
    let ov;
    try {
      ov = await send({ type: TG.MSG.GET_OVERVIEW });
      if (!ov || ov.error) throw new Error(ov && ov.error);
    } catch (_) {
      view.replaceChildren(U.empty({ kind: "error", title: "Couldn't load your overview", text: "Try reopening the popup.", action: U.button("Retry", { small: true, icon: "refresh", onclick: () => renderOverview(view) }) }));
      return;
    }
    if (tab !== "overview") return;
    const children = [];
    if (ov.demo) children.push(demoBanner());

    children.push(
      el("section", { class: "sec", "aria-label": "Today" }, [
        el("div", { class: "sec-head" }, [U.eyebrow("Today"), el("span", { class: "tg-mono", text: `${ov.today.total} checked` })]),
        el("div", { class: "tiles" }, [U.statTile("Low", ov.today.low, "low"), U.statTile("Caution", ov.today.caution, "caution"), U.statTile("High", ov.today.high, "high")]),
      ])
    );

    const values = ov.days.map((d) => d.avgScore);
    const hasData = values.some((v) => v !== null);
    const dayLetter = (d) => new Date(d.date + "T12:00").toLocaleDateString([], { weekday: "narrow" });
    children.push(
      el("section", { class: "sec", "aria-label": "Risk over time" }, [
        el("div", { class: "sec-head" }, [U.eyebrow("Risk over time · 7 days"), el("span", { class: "tg-mono", text: "avg score" })]),
        el("div", { class: "tg-card spark-card" }, hasData
          ? [U.sparkline(values, { max: 100, height: 52, label: "Average risk score per day, last 7 days: " + ov.days.map((d) => `${d.date} ${d.avgScore === null ? "no checks" : d.avgScore}`).join(", ") }), el("div", { class: "spark-days", "aria-hidden": "true" }, ov.days.map((d) => el("span", { class: "tg-mono", text: dayLetter(d) })))]
          : [el("p", { class: "tg-dim", style: "margin:6px 0 8px;font-size:12.5px", text: "Your risk trend appears after your first checks." })]),
      ])
    );

    children.push(
      el("section", { class: "sec", "aria-label": "Risk telemetry across your channels" }, [
        el("div", { class: "sec-head" }, [U.eyebrow("Risk telemetry across your channels")]),
        el("div", { class: "tg-card bars-card" }, ov.channels.length ? [U.barList(ov.channels)] : [el("p", { class: "tg-dim", style: "margin:0;font-size:12.5px", text: "No checks in the last 7 days." })]),
      ])
    );

    const selMsg = el("p", { class: "msg", role: "status", "aria-live": "polite" });
    children.push(
      el("section", { class: "sec" }, [
        U.button("Check current selection", {
          primary: true,
          block: true,
          icon: "scan",
          onclick: async () => {
            selMsg.classList.remove("error");
            selMsg.textContent = "Checking…";
            const res = await send({ type: TG.MSG.CHECK_SELECTION });
            if (res && res.ok) return window.close(); // the panel opens on the page
            selMsg.textContent = (res && res.error) || "Couldn't check the selection.";
            selMsg.classList.add("error");
          },
        }),
        selMsg,
      ]),
      await pageCard()
    );
    view.replaceChildren(...children);
  }

  function demoBanner() {
    return el("div", { class: "demo-banner", role: "note" }, [
      U.icon("sparkles"),
      el("span", { text: "Showing demo data" }),
      el("button", {
        class: "tg-link",
        type: "button",
        text: "Turn off",
        onclick: async () => {
          settings = await send({ type: TG.MSG.SET_SETTINGS, patch: { demo_data: false } });
          render();
        },
      }),
    ]);
  }

  // What this tab supports, from the content script's self-test.
  async function pageCard() {
    let line = "TrustGraph can't run on this page.";
    let sub = "Browser pages and the Chrome Web Store can't be checked.";
    let icon = "globe";
    let sampleTab = null;
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (t && /^https?:/.test(t.url || "")) {
        let info = null;
        try {
          info = await chrome.tabs.sendMessage(t.id, { type: TG.MSG.SELF_TEST }, { frameId: 0 });
        } catch (_) {}
        if (!info || !info.supported) {
          line = "No shield on this site.";
          sub = 'Select text and right-click "Check with TrustGraph", or use the button above.';
        } else {
          const name = TG.CHANNEL_LABELS[info.channel] || info.channel;
          icon = "activity";
          if (info.paused) [line, sub] = [`${name}: TrustGraph is paused.`, "Turn it back on in Settings."];
          else if (!info.sourceEnabled) [line, sub] = [`${name} is switched off.`, "Turn it on in Settings → Sites."];
          else if (info.count > 0) {
            line = `${name}: recognising ${info.count} message${info.count === 1 ? "" : "s"}.`;
            const r = info.read;
            sub = r ? `Rows ${r.rows} · message containers ${r.containers} · parsed ${r.parsed}` + (Object.keys(r.skipped || {}).length ? ` · skipped ${Object.entries(r.skipped).map(([k, v]) => `${v} (${k})`).join(", ")}` : "") : "Hover a message and click the shield.";
          } else
            [line, sub] = [
              `${name}: no messages recognised yet.`,
              info.fallback
                ? "Open a conversation. If one is open, the site may have changed its layout: hover a message anyway (the shield falls back to any block of text), and send a page sample from Debug mode so the adapter can be fixed."
                : "Open a conversation. If one is open, the site may have changed: try Debug mode or right-click.",
            ];
          if (info.debug) sampleTab = { id: t.id, name };
        }
      }
    } catch (_) {}
    const card = el("div", { class: "tg-card flat page-card", style: "margin-top:8px" }, [el("p", { class: "page-line" }, [U.icon(icon), line]), el("p", { class: "tg-mono", style: "font-size:10.5px", text: sub })]);
    if (sampleTab) card.append(sampleButton(sampleTab));
    return el("section", { class: "sec", "aria-label": "This page" }, [U.eyebrow("This page"), card]);
  }

  // Debug mode: save the chat area's structure with all text replaced by
  // x / 0, to send to whoever maintains the adapters. Nothing is sent
  // anywhere by TrustGraph; the user saves the file.
  function sampleButton(t) {
    const msg = el("p", { class: "msg", role: "status", "aria-live": "polite" });
    return el("div", { style: "margin-top:8px" }, [
      U.button("Save anonymised page sample", {
        small: true,
        icon: "fileDown",
        title: "Saves this page's chat structure with every letter replaced by x and every digit by 0",
        onclick: async () => {
          try {
            const s = await chrome.tabs.sendMessage(t.id, { type: TG.MSG.CAPTURE_SAMPLE }, { frameId: 0 });
            const head = `<!-- TrustGraph page sample (anonymised: letters -> x/X, digits -> 0)\n     site: ${s.host}${s.path}  channel: ${s.channel}  recognised: ${s.count}  strategy: ${s.strategy || "none"}\n     version: ${chrome.runtime.getManifest().version}  saved: ${new Date().toISOString()} -->\n`;
            const url = URL.createObjectURL(new Blob([head + s.html], { type: "text/html" }));
            const a = el("a", { href: url, download: `trustgraph-sample-${s.channel}.html` });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            msg.textContent = "Saved. Check the file before you share it.";
          } catch (_) {
            msg.textContent = "Couldn't read this page. Reload it and try again.";
          }
        },
      }),
      msg,
    ]);
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  const filters = { q: "", level: "all", channel: "all", range: "all" };
  let openId = null;

  function matches(r) {
    if (filters.level !== "all" && r.riskLevel !== filters.level) return false;
    if (filters.channel !== "all" && r.channel !== filters.channel) return false;
    if (filters.range !== "all" && r.timestamp < Date.now() - Number(filters.range) * 86400000) return false;
    const q = filters.q.trim().toLowerCase();
    if (q) {
      // Metadata only: verdict, channel, domain, signal names, id.
      const hay = [U.LEVELS[r.riskLevel].label, TG.CHANNEL_LABELS[r.channel] || r.channel, r.domain, r.id, ...r.signalIds.map((s) => (V.SIGNAL_TYPES[s] || {}).name || s)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  async function renderHistory(view) {
    view.replaceChildren(U.skeleton("100%", 38), el("div", { style: "display:grid;gap:6px;margin-top:14px" }, [1, 2, 3, 4].map(() => U.skeleton("100%", 54))));
    let data;
    try {
      data = await send({ type: TG.MSG.GET_HISTORY });
      if (!data || data.error) throw new Error(data && data.error);
    } catch (_) {
      view.replaceChildren(U.empty({ kind: "error", title: "Couldn't load history", text: "Try reopening the popup.", action: U.button("Retry", { small: true, icon: "refresh", onclick: () => renderHistory(view) }) }));
      return;
    }
    if (tab !== "history") return;
    const all = data.results;
    const wrong = new Set(data.wrong || []);
    if (!all.length) {
      view.replaceChildren(
        U.empty({
          title: "No results yet",
          text: "Hover a message and click the shield, or select text and right-click “Check with TrustGraph”. Only verdicts are kept here.",
          action: U.button("Load demo data", {
            small: true,
            icon: "sparkles",
            onclick: async () => {
              settings = await send({ type: TG.MSG.SET_SETTINGS, patch: { demo_data: true } });
              renderHistory(view);
            },
          }),
        })
      );
      return;
    }

    const channels = [...new Set(all.map((r) => r.channel))];
    const search = el("input", { class: "tg-input", type: "search", placeholder: "Search verdict, channel, signal or domain", "aria-label": "Search history", value: filters.q });
    const sel = (key, label, options) =>
      el("select", { class: "tg-input", "aria-label": label, onchange: (e) => ((filters[key] = e.target.value), drawList()) }, options.map(([v, l]) => el("option", { value: v, text: l, selected: filters[key] === v })));
    const listBox = el("div");
    search.addEventListener("input", () => {
      filters.q = search.value;
      drawList();
    });

    function drawList() {
      const shown = all.filter(matches);
      const ul = el("ul", { class: "list", "aria-label": "Results" }, shown.map((r) => item(r, wrong, view)));
      listBox.replaceChildren(
        el("p", { class: "count tg-eyebrow", role: "status", text: shown.length === all.length ? `${all.length} result${all.length === 1 ? "" : "s"}` : `${shown.length} of ${all.length} results` }),
        shown.length ? ul : U.empty({ icon: "filter", title: "Nothing matches", text: "Try a different search or filter." })
      );
    }

    view.replaceChildren(
      data.results.some((r) => r.id.startsWith("demo-")) ? demoBanner() : "",
      el("div", { class: "hist-tools" }, [
        el("div", { class: "search" }, [U.icon("search"), search]),
        el("div", { class: "filters" }, [
          sel("level", "Filter by verdict", [["all", "All verdicts"], ["high", "High risk"], ["caution", "Caution"], ["low", "Low risk"]]),
          sel("channel", "Filter by channel", [["all", "All channels"], ...channels.map((c) => [c, TG.CHANNEL_LABELS[c] || c])]),
          sel("range", "Filter by date", [["all", "Any time"], ["1", "Today"], ["7", "7 days"], ["30", "30 days"]]),
        ]),
      ]),
      listBox,
      el("div", { class: "hist-foot" }, [
        U.button("JSON", { small: true, icon: "fileDown", ariaLabel: "Export history as JSON", onclick: () => exportAs("json") }),
        U.button("CSV", { small: true, icon: "download", ariaLabel: "Export history as CSV", onclick: () => exportAs("csv") }),
        el("span", { class: "sp" }),
        U.button("Delete all history", {
          small: true,
          danger: true,
          icon: "trash",
          onclick: () =>
            confirmDialog("Delete all history?", "This removes every saved verdict and today's counts from this device" + (account.state === "signed_in" ? " and from your workspace" : "") + ". It can't be undone.", "Delete all", async () => {
              await send({ type: TG.MSG.DELETE_ALL });
              renderHistory(view);
            }),
        }),
      ])
    );
    drawList();
  }

  function item(r, wrong, view) {
    const open = openId === r.id;
    const top = r.signalIds[0] ? (V.SIGNAL_TYPES[r.signalIds[0]] || {}).name || r.signalIds[0] : "No scam signals";
    const detailId = "d-" + r.id;
    const li = el("li", { class: "item", "data-open": String(open), "data-level": r.riskLevel }, [
      el("button", { class: "item-btn", type: "button", "aria-expanded": String(open), "aria-controls": detailId, onclick: () => ((openId = open ? null : r.id), renderHistory(view)) }, [
        U.chip(r.riskLevel, { small: true, short: true }),
        el("div", { class: "item-main" }, [
          el("p", { class: "item-top", text: top + (r.signalIds.length > 1 ? ` +${r.signalIds.length - 1}` : "") }),
          el("p", { class: "item-meta", text: `${TG.CHANNEL_LABELS[r.channel] || r.channel} · ${U.timeAgo(r.timestamp)}` }),
        ]),
        el("span", { class: "score", "aria-label": `score ${r.score}`, text: String(r.score) }),
      ]),
    ]);
    if (open) {
      li.append(
        el("div", { class: "item-detail", id: detailId }, [
          r.signalIds.length
            ? el("ul", { class: "tg-signals" }, r.signalIds.map((id) => U.signalRow({ ...(V.SIGNAL_TYPES[id] || { name: id, icon: "activity" }), description: null, severity: r.riskLevel === "high" ? "high" : r.riskLevel === "caution" ? "medium" : "low" })))
            : el("p", { class: "tg-dim", style: "margin:0;font-size:12.5px", text: "No scam signals were found." }),
          el("p", { class: "id-line", text: `${r.domain || "unknown site"} · ${new Date(r.timestamp).toLocaleString()} · ${r.id}` }),
          wrong.has(r.id) ? el("p", { class: "wrong-tag", text: "Marked as wrong verdict" }) : null,
          el("div", { class: "item-actions" }, [
            U.button("Open in workspace", { small: true, icon: "externalLink", onclick: () => send({ type: TG.MSG.OPEN_WORKSPACE, id: r.id }) }),
            wrong.has(r.id) ? null : U.button("Mark as wrong", { small: true, icon: "flag", onclick: async () => (await send({ type: TG.MSG.MARK_WRONG, id: r.id }), renderHistory(view)) }),
            U.button("Delete", { small: true, ghost: true, icon: "trash", onclick: async () => (await send({ type: TG.MSG.DELETE_RESULT, id: r.id }), (openId = null), renderHistory(view)) }),
          ]),
        ])
      );
    }
    return li;
  }

  async function exportAs(format) {
    const file = await send({ type: TG.MSG.EXPORT, format });
    const url = URL.createObjectURL(new Blob([file.data], { type: file.mime }));
    const a = el("a", { href: url, download: file.filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function confirmDialog(title, text, okLabel, onOk) {
    const cancel = U.button("Cancel", { onclick: () => dlg.close() });
    dlg.replaceChildren(
      el("h2", { class: "tg-h", id: "confirm-title", text: title }),
      el("p", { id: "confirm-text", text }),
      el("div", { class: "acts" }, [
        cancel,
        U.button(okLabel, {
          danger: true,
          onclick: async () => {
            dlg.close();
            await onOk();
          },
        }),
      ])
    );
    dlg.showModal();
    cancel.focus(); // the safe choice has focus
  }

  // ---------------------------------------------------------------------------
  async function load() {
    try {
      [settings, account] = await Promise.all([send({ type: TG.MSG.GET_SETTINGS }), send({ type: TG.MSG.GET_ACCOUNT })]);
    } catch (_) {}
    render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.account) load();
    else if (changes.settings && tab !== "settings") send({ type: TG.MSG.GET_SETTINGS }).then((s) => ((settings = s), TrustGraphDesign.applyTheme(document, s.theme)));
  });

  load();
})();
