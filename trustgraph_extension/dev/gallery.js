// Builds the component gallery from the real components (shared/ui.js) and
// real verdicts from the local engine, in all three verdict states.
(async function () {
  "use strict";
  const U = TrustGraphUI;
  const { el } = U;
  const V = TrustGraphVerdict;
  const app = document.getElementById("app");

  const SAMPLES = {
    low: "Running 10 minutes late, order me a coffee? Will pay you back at lunch.",
    caution: "Congratulations! You have won a cashback reward, reply to claim",
    high: "Dear customer your SBI KYC is pending and your account will be blocked today. Share the OTP sent to you at http://sbi-kyc-update.xyz urgently",
  };
  const verdicts = {};
  for (const [level, text] of Object.entries(SAMPLES)) verdicts[level] = await V.LocalEngine.scoreMessage({ text, channel: "whatsapp", sender: "+91 90000 00000" });

  const section = (label, children) => el("section", { class: "g" }, [U.eyebrow(label, true), ...children]);
  const col = (level, children) => el("div", { class: "tg-card pad stack" }, [U.eyebrow(level), ...children]);
  const LEVELS = ["low", "caution", "high"];

  // Header + theme switch
  const themeSeg = U.segmented("theme", [["dark", "Dark"], ["light", "Light"]], "dark", (t) => TrustGraphDesign.applyTheme(document, t), "Theme");
  app.append(
    el("header", { class: "g" }, [
      U.logo(),
      el("div", { class: "sp" }),
      themeSeg,
    ]),
    U.eyebrow("Privacy-first detection workspace · component gallery", true),
    el("h1", { class: "tg-h", style: "font-size:44px;margin-top:10px" }, ["Read the signal. ", el("em", { text: "Keep the trust." })])
  );

  // Tokens
  const sw = (name) => el("div", { class: "swatch" }, [el("i", { style: `background:var(${name})` }), el("span", { text: name })]);
  app.append(section("Tokens", [el("div", { class: "swatches" }, Object.keys(TrustGraphDesign.DARK).filter((k) => !/shadow|glow|grid/.test(k)).map(sw))]));

  // Type
  app.append(
    section("Type", [
      el("div", { class: "tg-card pad stack" }, [
        el("p", { class: "tg-h", style: "font-size:40px", text: "Space Grotesk 400, tight" }),
        el("p", { style: "font-size:16px;margin:0", text: "DM Sans for body and UI text, 13–16px. The quick brown fox checks a suspicious link." }),
        U.eyebrow("JetBrains Mono · eyebrow labels · 11px"),
        el("p", { class: "tg-mono", style: "margin:0", text: "No message text stored · Results only" }),
      ]),
    ])
  );

  // Buttons, inputs, switches
  app.append(
    section("Controls", [
      el("div", { class: "tg-card pad stack" }, [
        el("div", { class: "row" }, [
          U.button("Sign in", { primary: true, arrow: true }),
          U.button("Create account"),
          U.button("Open in workspace", { icon: "externalLink" }),
          U.button("Team sync", { tag: "Coming soon", disabled: false }),
          U.button("Delete all", { danger: true, icon: "trash" }),
          U.button("Ghost", { ghost: true }),
          U.button("Disabled", { primary: true, disabled: true }),
          U.iconButton("settings", "Settings"),
        ]),
        el("div", { class: "row" }, [
          el("input", { class: "tg-input", placeholder: "Search by channel, signal or domain", style: "max-width:320px" }),
          el("select", { class: "tg-input", style: "max-width:180px" }, [el("option", { text: "All verdicts" }), el("option", { text: "High risk" })]),
          U.switchInput("s1", true, null, "On"),
          U.switchInput("s2", false, null, "Off"),
          U.segmented("sens", [["relaxed", "Relaxed"], ["balanced", "Balanced"], ["strict", "Strict"]], "balanced", () => {}, "Sensitivity"),
        ]),
        el("div", { class: "row" }, [
          el("span", { class: "tg-status", "data-state": "in", text: "Signed in" }),
          el("span", { class: "tg-status", "data-state": "local", text: "Local only" }),
          el("span", { class: "tg-status", "data-state": "out", text: "Signed out" }),
          el("span", { class: "tg-status", "data-state": "offline", text: "Offline" }),
          el("span", { class: "tg-node" }), el("span", { class: "tg-node amber" }), el("span", { class: "tg-node green" }), el("span", { class: "tg-node blue" }),
        ]),
      ]),
    ])
  );

  // Verdict states
  app.append(
    section("Verdict: chip, gauge, explanation", [
      el("div", { class: "cols" }, LEVELS.map((lv) => {
        const v = verdicts[lv];
        return col(lv, [
          el("div", { class: "row", style: "justify-content:space-between" }, [el("div", { class: "stack", style: "gap:8px" }, [U.chip(v.riskLevel), el("p", { class: "tg-h", style: "font-size:26px", text: U.LEVELS[v.riskLevel].label })]), U.gauge(v.score, v.riskLevel)]),
          el("p", { class: "tg-muted", style: "margin:0;font-size:13.5px", text: v.explanation }),
          el("div", { class: "row" }, [U.chip(lv, { small: true }), U.chip(lv, { small: true, short: true })]),
        ]);
      })),
    ])
  );

  // Signals
  app.append(
    section("Signals (all eight types, three severities)", [
      el("div", { class: "cols" }, [
        col("from the high sample", [el("ul", { class: "tg-signals" }, verdicts.high.signals.map((s) => U.signalRow(s)))]),
        col("every type", [el("ul", { class: "tg-signals" }, Object.entries(V.SIGNAL_TYPES).slice(0, 4).map(([id, t], i) => U.signalRow({ ...t, severity: ["high", "medium", "low", "high"][i] })))]),
        col("every type (cont.)", [el("ul", { class: "tg-signals" }, Object.entries(V.SIGNAL_TYPES).slice(4).map(([id, t], i) => U.signalRow({ ...t, severity: ["medium", "high", "low", "medium"][i] })))]),
      ]),
    ])
  );

  // Data viz + stats
  const days = [12, 18, 9, 22, 31, 17, 26];
  app.append(
    section("Overview pieces", [
      el("div", { class: "cols" }, [
        el("div", { class: "tg-card pad stack" }, [U.eyebrow("Today"), el("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:8px" }, [U.statTile("Low", 14, "low"), U.statTile("Caution", 3, "caution"), U.statTile("High", 1, "high")])]),
        el("div", { class: "tg-card pad stack" }, [U.eyebrow("Risk over time · 7 days"), U.sparkline(days, { max: 100 })]),
        el("div", { class: "tg-card pad stack" }, [U.eyebrow("Risk telemetry across your channels"), U.barList([
          { label: "Gmail", total: 18, low: 14, caution: 3, high: 1 },
          { label: "WhatsApp", total: 9, low: 6, caution: 2, high: 1 },
          { label: "LinkedIn", total: 4, low: 4 },
        ])]),
      ]),
    ])
  );

  // Lists and states
  app.append(
    section("Check-list, empty, loading, error", [
      el("div", { class: "cols" }, [
        el("div", { class: "tg-card pad" }, [el("ul", { class: "tg-checks" }, [
          U.checkRow("No message text in detection history", "Only the verdict and its metadata are kept."),
          U.checkRow("No scam reports or public submission database"),
          U.checkRow("Delete or export your data anytime", "JSON or CSV, from History."),
        ])]),
        el("div", { class: "tg-card" }, [U.empty({ title: "No results yet", text: "Hover a message and click the shield, or select text and right-click." })]),
        el("div", { class: "tg-card pad stack" }, [U.skeleton("55%", 22), U.skeleton("90%"), U.skeleton("70%"), U.empty({ kind: "error", title: "Couldn't load history", text: "Try again in a moment.", action: U.button("Retry", { small: true, icon: "refresh" }) })]),
      ]),
    ])
  );

  // Shield button
  const busy = el("button", { class: "tg-shield", type: "button", "aria-label": "Checking", "aria-busy": "true" }, [U.icon("shieldCheck", { stroke: 2 })]);
  app.append(
    section("In-page shield", [
      el("div", { class: "tg-card pad row" }, [
        el("button", { class: "tg-shield", type: "button", "aria-label": "Check this message" }, [U.icon("shieldCheck", { stroke: 2 })]),
        el("span", { class: "tg-muted", text: "Idle" }),
        busy,
        el("span", { class: "tg-muted", text: "Scanning (pulsing ring)" }),
      ]),
    ])
  );

  window.__galleryReady = true;
})();
