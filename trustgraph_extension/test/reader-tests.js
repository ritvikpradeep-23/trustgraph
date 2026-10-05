// Runner for reader-tests.html: WhatsApp reader + chat store.
(async function () {
  "use strict";

  const results = document.getElementById("results");
  const summary = document.getElementById("summary");
  let checks = 0;
  let failures = 0;
  const reader = window.TrustGraphWhatsAppReader;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function section(name) {
    const sec = el("section");
    sec.append(el("h2", null, name));
    const list = el("ul");
    sec.append(list);
    results.append(sec);
    return (ok, label, detail) => {
      checks++;
      if (!ok) failures++;
      list.append(el("li", ok ? "pass" : "fail", (ok ? "PASS " : "FAIL ") + label + (!ok && detail ? "\n     " + detail : "")));
    };
  }

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ts = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function frame(src, srcdoc) {
    return new Promise((resolve) => {
      const f = document.createElement("iframe");
      f.className = "layout";
      f.onload = () => resolve(f);
      if (srcdoc !== undefined) f.srcdoc = srcdoc;
      else f.src = src;
      document.body.append(f);
    });
  }

  // ---------------------------------------------------------------------
  // 1. data-pre-plain-text parsing
  // ---------------------------------------------------------------------
  {
    const check = section("data-pre-plain-text parser");
    const cases = [
      ["[7:36 am, 4/10/2026] Arjun K: ", "en-GB", null, { sender: "Arjun K", timestamp: ts(2026, 10, 4, 7, 36) }],
      ["[7:36 AM, 4/10/2026] Arjun K: ", "en-US", null, { sender: "Arjun K", timestamp: ts(2026, 4, 10, 7, 36) }],
      ["[7:36 am, 4/10/2026] Arjun K: ", "en-US", "dmy", { sender: "Arjun K", timestamp: ts(2026, 10, 4, 7, 36) }],
      ["[19:05, 04/10/2026] അനു: ", "ml-IN", null, { sender: "അനു", timestamp: ts(2026, 10, 4, 19, 5) }],
      ["[9:15 PM, 24/10/2026] Dr: Mathew: ", "en-US", null, { sender: "Dr: Mathew", timestamp: ts(2026, 10, 24, 21, 15) }],
      ["[12:05 a.m., 10/24/26] Sam: ", "en-GB", null, { sender: "Sam", timestamp: ts(2026, 10, 24, 0, 5) }],
      ["[4/10/2026, 12:30 pm] +91 98765 43210: ", "en-IN", null, { sender: "+91 98765 43210", timestamp: ts(2026, 10, 4, 12, 30) }],
      ["[2026-10-04 08:00] Priya: ", "en-GB", null, { sender: "Priya", timestamp: ts(2026, 10, 4, 8, 0) }],
      ["[10.15, 4.10.2026] Hans: ", "de-DE", null, { sender: "Hans", timestamp: ts(2026, 10, 4, 10, 15) }],
    ];
    for (const [raw, locale, order, want] of cases) {
      const got = reader.parsePrePlainText(raw, locale, order);
      const pick = got && { sender: got.sender, timestamp: got.timestamp };
      check(eq(pick, want), `${JSON.stringify(raw)} (${locale}${order ? ", " + order : ""})`, `got ${JSON.stringify(pick)}, expected ${JSON.stringify(want)}`);
    }
    check(reader.parsePrePlainText("no brackets here") === null, "rejects text without [time, date]");
  }

  // ---------------------------------------------------------------------
  // 2. Static fixture: every container parsed, every field right
  // ---------------------------------------------------------------------
  {
    const check = section("Static WhatsApp pane (fixtures/whatsapp-live.html, anonymised)");
    const html = await (await fetch("fixtures/whatsapp-live.html")).text();
    const scripts = ["shared/constants.js", "adapters/kit.js", "adapters/whatsapp/reader.js"].map((s) => `<script src="/${s}"><\/script>`).join("");
    const f = await frame(null, `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}${scripts}</body></html>`);
    const { messages, stats } = f.contentWindow.TrustGraphWhatsAppReader.read(f.contentDocument);

    check(stats.containers === 14, "finds all 14 message containers via #main [data-id]", `got ${stats.containers}`);
    check(stats.parsed === stats.containers, "parsed = containers (nothing dropped)", `parsed ${stats.parsed}, skipped ${JSON.stringify(stats.skipped)}`);
    check(stats.rows === 17, "counts 17 rows", `got ${stats.rows}`);

    const base = { links: [], isReply: false, quotedText: "", hasMedia: false, mediaType: null, isForwarded: false };
    const want = [
      { ...base, type: "system", text: "Messages and calls are end-to-end encrypted. No one outside of this chat can read or listen to them.", direction: "center", sender: null },
      { ...base, type: "date", text: "", direction: "center", sender: null },
      { ...base, id: "3EB0A11F2C9D4E5B6A01", type: "text", sender: "Arjun K", timestamp: ts(2026, 10, 4, 7, 36), text: "Hi! Are you coming to the fest tomorrow?", direction: "incoming" },
      { ...base, id: "AC76B22E3D1F5A4C7B02", type: "text", sender: "Ritvik", timestamp: ts(2026, 10, 4, 7, 40), text: "Yes, will be there by 10", direction: "outgoing" },
      { ...base, id: "3EB0A33F4D2E6B5C8C03", type: "text", sender: "Arjun K", text: "Bring:\n1. ID card\n2. Laptop charger", direction: "incoming" },
      { ...base, id: "3EB0A44A5E3F7C6D9D04", type: "text", sender: "അനു", timestamp: ts(2026, 10, 4, 19, 5), text: "നാളെ ക്ലാസ് ഉണ്ടോ?", direction: "incoming" },
      { ...base, id: "3EB0A55B6F4A8D7E0E05", type: "text", timestamp: ts(2026, 10, 4, 19, 45), text: "Notes are here github.com/example/notes", links: [{ href: "https://github.com/example/notes", text: "github.com/example/notes" }], direction: "incoming" },
      { ...base, id: "AC76B66C7A5B9E8F1F06", type: "text", sender: "Ritvik", text: "Sure, see you there", isReply: true, quotedText: "Hi! Are you coming to the fest tomorrow?", direction: "outgoing" },
      { ...base, type: "date", direction: "center" },
      { ...base, id: "3EB0A77D8B6C0F9A2A07", type: "text", text: "Poster for the event", hasMedia: true, mediaType: "image", direction: "incoming", timestamp: ts(2026, 10, 5, 8, 1) },
      { ...base, id: "3EB0A88E9C7D1A0B3B08", type: "media", text: "", hasMedia: true, mediaType: "image", direction: "incoming", sender: null },
      { ...base, id: "3EB0A99F0D8E2B1C4C09", type: "media", text: "", hasMedia: true, mediaType: "voice", sender: "Arjun K" },
      { ...base, id: "3EB0AAA01E9F3C2D5D10", type: "media", text: "", hasMedia: true, mediaType: "document" },
      { ...base, id: "3EB0ABB12FA04D3E6E11", type: "deleted", text: "", direction: "incoming" },
      { ...base, id: "3EB0ACC23AB15E4F7F12", type: "text", text: "Share this with everyone!", isForwarded: true },
      { ...base, id: "3EB0ADD34BC26F5A8A13", type: "text", sender: "Dr: Mathew", timestamp: ts(2026, 10, 24, 21, 15), text: "Reports are ready" },
      { ...base, id: "AC76BEE45CD37A6B9B14", type: "text", text: "Congrats 🎉🎉", direction: "outgoing", timestamp: ts(2026, 10, 24, 21, 20) },
    ];
    check(messages.length === want.length, `returns ${want.length} records (messages + date + system rows)`, `got ${messages.length}`);
    want.forEach((w, i) => {
      const got = messages[i] || {};
      const diffs = Object.keys(w).filter((k) => !eq(got[k], w[k]));
      check(!diffs.length, `#${i + 1} ${w.type}${w.id ? " " + w.id.slice(0, 8) : ""}`, diffs.map((k) => `${k}: got ${JSON.stringify(got[k])}, expected ${JSON.stringify(w[k])}`).join("\n     "));
    });
    check(messages.filter((m) => m.type === "date" || m.type === "system").every((m) => m.id.startsWith("row:")), "date/system rows get stable synthetic ids");
    f.remove();
  }

  // ---------------------------------------------------------------------
  // 3. Virtualised list: accumulate, scan earlier, chat switch
  // ---------------------------------------------------------------------
  {
    const check = section("Virtualised chat (fixtures/whatsapp-virtual.html)");
    const f = await frame("fixtures/whatsapp-virtual.html");
    await sleep(100);
    const w = f.contentWindow;
    const adapter = w.TrustGraphAdapters.find((a) => a.channel === "whatsapp");
    const scroller = adapter.scroller();
    check(!!scroller && scroller.tabIndex === 0, "finds the div[tabindex=0] scroller");

    let changes = 0;
    const store = new w.TrustGraphChatStore(adapter, { onChange: () => changes++ });
    store.start();
    const inDom = w.document.querySelectorAll("#main [data-id]").length;
    check(store.map.size === inDom && inDom <= 16, `first read keeps exactly what's in the DOM (${inDom})`, `store ${store.map.size}`);

    // The user scrolls up a bit: older rows replace newer ones in the DOM.
    scroller.scrollTop -= 400;
    // Debounce (250ms) + render; poll so a slow frame can't fail the test.
    for (let i = 0; i < 40 && store.map.size === inDom; i++) await sleep(100);
    check(store.map.size > inDom, "scrolling adds messages (the Map grows, never shrinks)", `size ${store.map.size}`);
    check(changes >= 1, "onChange fired for new rows");

    const ids = () => store.messages().map((m) => Number(m.id.slice(-3)));
    const sorted = (arr) => arr.every((v, i) => i === 0 || v > arr[i - 1]);
    check(sorted(ids()), "messages stay in conversation order");

    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    const steps = [];
    const res = await store.scanEarlier({ maxSteps: 30, onProgress: (p) => steps.push(`${p.step}:${store.map.size}@${scroller.scrollTop}`) });
    const missing = [];
    const have = new Set(store.messages().map((m) => Number(m.id.slice(-3))));
    for (let i = 0; i < 60; i++) if (!have.has(i)) missing.push(i);
    check(store.map.size === 60, "Scan earlier reaches all 60 messages", `size ${store.map.size}, added ${res.added}, steps ${steps.join(" ")}, missing ${missing.join(",")}`);
    check(res.reachedTop, "Scan earlier stops at the top");
    check(Math.abs(scroller.scrollHeight - scroller.scrollTop - fromBottom) <= 2, "scroll position restored afterwards");
    check(sorted(ids()) && ids().length === 60, "all 60 in order after scanning");
    check(store.readCount() === 60, `readCount() = 60 ("Read 60 messages from this chat")`);

    const capped = new w.TrustGraphChatStore(adapter);
    capped.start();
    const r2 = await capped.scanEarlier({ maxSteps: 2 });
    check(r2.added > 0 && capped.map.size < 60, "maxSteps limit is respected", `size ${capped.map.size}`);
    capped.stop();

    w.switchChat();
    store.refresh();
    const allNew = store.messages().every((m) => m.id.startsWith("AC76W"));
    check(allNew && store.map.size > 0, "switching chats resets the store (no messages from the old chat)", `size ${store.map.size}`);

    store.stop();
    check(store.map.size === 0, "stop() forgets all message text");
    f.remove();
  }

  const verdict = failures ? "FAIL" : "PASS";
  summary.textContent = `${verdict}: ${checks - failures}/${checks} checks passed.`;
  summary.className = failures ? "fail" : "pass";
  summary.dataset.failed = String(failures);
  document.title = `TrustGraph reader tests: ${verdict}`;
})().catch((err) => {
  document.getElementById("summary").textContent = "FAIL: " + err;
  document.title = "TrustGraph reader tests: FAIL";
});
