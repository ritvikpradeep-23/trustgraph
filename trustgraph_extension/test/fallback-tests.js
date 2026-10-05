// Runner for fallback-tests.html.
(async function () {
  "use strict";
  const results = document.getElementById("results");
  const summary = document.getElementById("summary");
  let checks = 0;
  let failures = 0;
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text ?? "" });
  function section(title) {
    const s = el("section");
    s.append(el("h2", null, title));
    const ul = el("ul");
    s.append(ul);
    results.append(s);
    return (ok, label, detail) => {
      checks++;
      if (!ok) failures++;
      ul.append(el("li", ok ? "pass" : "fail", (ok ? "PASS " : "FAIL ") + label + (detail ? "\n     " + detail : "")));
    };
  }

  // Same-origin iframe with kit.js loaded into it (laid out, so innerText works).
  function frame(html, scripts = []) {
    return new Promise((resolve) => {
      const f = document.createElement("iframe");
      f.className = "layout";
      const tags = ["shared/constants.js", "adapters/kit.js", ...scripts].map((s) => `<script src="/${s}"><\/script>`).join("");
      f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}${tags}</body></html>`;
      f.onload = () => resolve(f);
      document.body.append(f);
    });
  }

  // ---- 1. textBlock basics -------------------------------------------------
  {
    const check = section("kit.textBlock()");
    const f = await frame(`
      <nav><p id="nav">Inbox Sent Drafts Spam Starred Important Snoozed</p></nav>
      <main id="pane">
        <div class="row"><div class="bubble"><span id="deep">Your parcel is held. Pay the fee at bit.ly/x today</span><span class="time">10:01</span></div></div>
        <p id="short">OK</p>
        <div contenteditable="true"><p id="draft">This is a reply I am still writing to someone</p></div>
        <button id="btn">A button with a fairly long label inside it</button>
      </main>
      <aside><p id="side">Suggested contacts and other things in a sidebar</p></aside>`);
    const w = f.contentWindow;
    const d = w.document;
    const kit = w.TrustGraphKit;
    const pane = d.getElementById("pane");
    const hit = kit.textBlock(d.getElementById("deep"), pane);
    check(hit && hit.textContent.includes("Your parcel is held"), "finds the message text block from its innermost node");
    check(kit.textBlock(d.getElementById("nav"), null) === null, "skips navigation");
    check(kit.textBlock(d.getElementById("side"), null) === null, "skips sidebars (aside)");
    check(kit.textBlock(d.getElementById("short"), pane) === null, "skips short labels");
    check(kit.textBlock(d.getElementById("draft"), pane) === null, "skips the composer (contenteditable)");
    check(kit.textBlock(d.getElementById("btn"), pane) === null, "skips buttons");
    check(kit.textBlock(d.getElementById("side"), pane) === null, "respects the scope (outside the chat area)");
    f.remove();
  }

  // ---- 2. every platform after a simulated redesign ----------------------
  const { fixtures } = await (await fetch("fixtures/expected.json")).json();
  for (const spec of fixtures) {
    if (spec.channel === "test") continue;
    const check = section(`${spec.name}: redesign simulation`);
    const html = await (await fetch("fixtures/" + spec.file)).text();
    const f = await frame(html, spec.scripts);
    const w = f.contentWindow;
    const d = w.document;
    const kit = w.TrustGraphKit;
    const adapter = (w.TrustGraphAdapters || []).find((a) => a.channel === spec.channel);
    const before = adapter.listMessages();
    // Strip everything selectors rely on (keep dir and contenteditable).
    for (const node of d.body.querySelectorAll("*")) {
      for (const a of Array.from(node.attributes)) if (/^(class|id|role|dir|data-.*|aria-.*|email|name|title)$/.test(a.name)) node.removeAttribute(a.name);
    }
    check(adapter.listMessages().length === 0, "site selectors no longer match (as after a redesign)", `adapter still finds ${adapter.listMessages().length}`);
    for (const m of spec.messages || []) {
      // The fallback skips text under 20 characters (labels, "OK", "No
      // thanks.") on purpose; those stay checkable by right-click.
      if (!m.text || m.text.length < 20) continue;
      const orig = before[m.index];
      // Find the text node holding the last words of this message (emails
      // start with the "Subject:" line the adapter adds) and hover it.
      const tail = m.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(-4).join(" "); // emoji may be <img>
      const words = tail;
      const walker = d.createTreeWalker(d.body, w.NodeFilter.SHOW_TEXT);
      let node = null;
      while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(words.split(" ")[0]) && walker.currentNode.parentElement.closest("body")) {
        if (walker.currentNode.parentElement.textContent.replace(/\s+/g, " ").includes(words)) { node = walker.currentNode; break; }
      }
      const block = node && kit.textBlock(node.parentElement, null);
      const got = block ? kit.clean(kit.text(block, "time, button, [aria-hidden='true']")) : "";
      check(!!orig && got.includes(tail), `#${m.index} still checkable through the fallback`, `expected to contain ${JSON.stringify(tail)}\n     got ${JSON.stringify(got.slice(0, 120))}`);
    }
    f.remove();
  }

  // ---- 3. anonymised page sample ------------------------------------------
  {
    const check = section("kit.anonymizedHtml()");
    const f = await frame(`<div id="main" class="pane x1abc" role="application" data-testid="conversation-panel">
      <div data-id="false_919876543210@c.us_3EB0" data-pre-plain-text="[10:01, 5/10/2026] Amma: " class="message-in">
        <span dir="ltr" class="selectable-text">Send me the OTP 482913 now, beta</span>
        <a href="https://sbi-kyc-update.xyz/login?u=ravi">link</a><img src="https://pps.whatsapp.net/v/t61/photo.jpg" alt="Ravi Kumar">
        <span aria-label="Ravi Kumar, +91 98765 43210" title="Delivered">✓✓</span>
        <script type="text/x-not-run">secret()</script><svg><path d="M1 2L3 4"/></svg>
      </div></div>`);
    const w = f.contentWindow;
    const out = w.TrustGraphKit.anonymizedHtml(w.document.getElementById("main"));
    const leaks = ["Send", "OTP", "482913", "beta", "Amma", "Ravi", "98765", "919876543210", "sbi", "kyc", "pps.whatsapp", "secret", "Delivered", "M1 2"].filter((s) => out.includes(s));
    check(leaks.length === 0, "no text, numbers, names, links or scripts survive", `leaked: ${leaks.join(", ")}`);
    check(out.includes('class="pane x1abc"') && out.includes('data-testid="conversation-panel"') && out.includes('dir="ltr"') && out.includes('class="selectable-text"'), "keeps the structure selectors need (classes, data-testid, dir)");
    check(out.includes("Xxxx xx xxx XXX 000000 xxx, xxxx"), "text keeps its shape (x / X / 0)");
    f.remove();
  }

  const verdict = failures ? "FAIL" : "PASS";
  summary.textContent = `${verdict}: ${checks - failures}/${checks} checks passed.`;
  summary.className = failures ? "fail" : "pass";
  document.title = `TrustGraph fallback tests: ${verdict}`;
})().catch((e) => {
  document.getElementById("summary").textContent = "FAIL: " + e;
  document.title = "TrustGraph fallback tests: FAIL";
});
