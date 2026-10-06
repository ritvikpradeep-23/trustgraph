// The demo web app (see webapp.html). Reads the mock store; never sees
// message text because none is ever sent.
(function () {
  "use strict";
  const U = TrustGraphUI;
  const { el } = U;
  const V = TrustGraphVerdict;
  TrustGraphDesign.adopt(document);
  document.getElementById("logo").append(U.logo());
  const main = document.getElementById("main");

  async function route() {
    const path = location.hash.replace(/^#/, "").split("?")[0];
    // Same paths as the real workspace (/app/detections/<id>); /results/<id> from older versions.
    const page = ["/app/detections/", "/results/"].find((p) => path.startsWith(p));
    if (page) return showResult(decodeURIComponent(path.slice(page.length)));
    return showAuth(path.startsWith("/register") ? "register" : "login");
  }

  async function showAuth(kind) {
    const code = await TrustGraphApi.mockIssueCode();
    const msg = el("p", { class: "tg-muted", role: "status", style: "margin:0" });
    main.replaceChildren(
      el("div", { class: "tg-card auth" }, [
        U.eyebrow(kind === "register" ? "Create your workspace" : "Sign in", true),
        el("h1", { class: "tg-h", text: kind === "register" ? "Welcome to TrustGraph." : "Welcome back." }),
        el("p", { class: "tg-muted", style: "margin:0", text: "In the real web app you'd sign in here. This demo skips that: there's no password, and the extension never handles one either. Connect the extension with this one-time code." }),
        el("div", { class: "code", "aria-label": "Pairing code " + code.split("").join(" "), text: code }),
        el("p", { class: "tg-dim", style: "margin:0;font-size:12.5px", text: "Paste it in the TrustGraph toolbar popup (“Have a pairing code?”). It works once, for 10 minutes." }),
        el("div", { class: "row" }, [
          U.button("Connect this browser", {
            primary: true,
            arrow: true,
            onclick: async () => {
              // The web app → extension message path, simulated.
              const res = await chrome.runtime.sendMessage({ type: TG.MSG.PAIR, code });
              msg.textContent = res.ok ? "Connected. You can close this tab." : res.error;
            },
          }),
          U.button("Copy code", { icon: "fileDown", onclick: () => navigator.clipboard.writeText(code).then(() => (msg.textContent = "Copied.")) }),
        ]),
        msg,
      ])
    );
  }

  async function showResult(id) {
    const { results } = await TrustGraphApi.mockRead();
    const r = results.find((x) => x.id === id);
    const list = el(
      "ul",
      { class: "list" },
      results.slice(0, 30).map((x) =>
        el("li", null, [
          el("a", { href: "#/app/detections/" + encodeURIComponent(x.id), "aria-current": x.id === id ? "page" : null, "data-level": x.riskLevel }, [
            U.chip(x.riskLevel, { small: true, short: true }),
            el("span", { text: `${TG.CHANNEL_LABELS[x.channel] || x.channel} · ${U.timeAgo(x.timestamp)}` }),
            el("span", { class: "s", text: String(x.score) }),
          ]),
        ])
      )
    );
    const detail = r
      ? el("section", { class: "tg-card res", "data-level": r.riskLevel, "aria-label": "Result" }, [
          U.eyebrow("Result", true),
          el("div", { class: "res-top" }, [el("div", null, [U.chip(r.riskLevel), el("h1", { class: "tg-h", text: U.LEVELS[r.riskLevel].label })]), U.gauge(r.score, r.riskLevel)]),
          r.signalIds.length ? el("ul", { class: "tg-signals" }, r.signalIds.map((s) => U.signalRow({ ...(V.SIGNAL_TYPES[s] || { name: s }), severity: r.riskLevel === "high" ? "high" : "medium" }))) : el("p", { class: "tg-muted", style: "margin:0", text: "No scam signals." }),
          el("dl", null, [el("dt", { text: "Channel" }), el("dd", { text: TG.CHANNEL_LABELS[r.channel] || r.channel }), el("dt", { text: "Site" }), el("dd", { text: r.domain || "–" }), el("dt", { text: "Checked" }), el("dd", { text: new Date(r.timestamp).toLocaleString() }), el("dt", { text: "Result id" }), el("dd", { class: "tg-mono", text: r.id })]),
          el("p", { class: "tg-mono", style: "margin:0", text: "Only the verdict came home · the message stayed where it was" }),
        ])
      : el("section", { class: "tg-card res" }, [U.empty({ icon: "database", title: "Not in your workspace", text: "This result hasn't synced. Results sync when the extension is signed in and Save to history is on." })]);
    main.replaceChildren(
      U.eyebrow("Privacy-first detection workspace", true),
      el("h1", { class: "tg-h", style: "font-size:40px;margin-top:10px" }, ["Your results, ", el("em", { text: "without the messages." })]),
      el("div", { class: "grid" }, [detail, el("section", { "aria-label": "Recent results" }, [U.eyebrow(`Recent · ${results.length}`), el("div", { style: "margin-top:10px" }, [results.length ? list : U.empty({ title: "No synced results yet" })])])])
    );
  }

  window.addEventListener("hashchange", route);
  route();
})();
