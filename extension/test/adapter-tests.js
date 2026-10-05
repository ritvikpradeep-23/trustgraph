// Test runner for adapter-tests.html. See fixtures/expected.json for format.
(async function () {
  "use strict";

  const results = document.getElementById("results");
  const summary = document.getElementById("summary");
  let failures = 0;
  let checks = 0;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Loads a fixture plus the adapter scripts into a same-origin iframe, so
  // the adapter's `document` is the fixture's document.
  function loadFrame(html, scripts) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      const tags = ["shared/constants.js", "adapters/kit.js", ...scripts]
        .map((src) => `<script src="/${src}"><\/script>`)
        .join("");
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}${tags}</body></html>`;
      frame.onload = () => resolve(frame);
      frame.onerror = reject;
      document.body.appendChild(frame);
    });
  }

  function deepestElement(node) {
    let current = node;
    while (current.lastElementChild) current = current.lastElementChild;
    return current;
  }

  async function runFixture(spec) {
    const section = el("section");
    const heading = el("h2", null, spec.name + " ");
    heading.appendChild(el("span", "tag", spec.origin === "real" ? "real sample" : "synthetic (hint-based)"));
    const list = el("ul");
    section.append(heading, list);
    results.appendChild(section);

    const check = (ok, label, detail) => {
      checks++;
      if (!ok) failures++;
      list.appendChild(el("li", ok ? "pass" : "fail", (ok ? "PASS " : "FAIL ") + label + (detail ? "\n     " + detail : "")));
    };

    let html;
    try {
      const res = await fetch("fixtures/" + spec.file);
      if (!res.ok) throw new Error("HTTP " + res.status);
      html = await res.text();
    } catch (err) {
      check(false, `load fixtures/${spec.file}`, String(err));
      return;
    }

    const frame = await loadFrame(html, spec.scripts);
    const w = frame.contentWindow;
    const adapter = (w.TrustGraphAdapters || []).find((a) => a.channel === spec.channel);
    check(!!adapter, `adapter "${spec.channel}" registered`);
    if (!adapter) return;

    const count = adapter.selfTest();
    check(count === spec.count, `selfTest() recognizes ${spec.count} messages`, `got ${count} (strategy: ${adapter.lastStrategy || "none"})`);

    const messages = adapter.listMessages ? adapter.listMessages() : [];
    for (const expected of spec.messages || []) {
      const msgEl = messages[expected.index];
      if (!msgEl) {
        check(false, `message #${expected.index} exists`);
        continue;
      }
      const text = adapter.extractText(msgEl);
      check(text === expected.text, `#${expected.index} extractText`, `expected ${JSON.stringify(expected.text)}\n     got      ${JSON.stringify(text)}`);

      if ("sender" in expected) {
        const sender = adapter.sender(msgEl);
        check(sender === expected.sender, `#${expected.index} sender`, `expected ${JSON.stringify(expected.sender)}, got ${JSON.stringify(sender)}`);
      }

      const inner = deepestElement(msgEl);
      const found = adapter.findMessage(inner);
      check(found === msgEl, `#${expected.index} findMessage(deepest child) returns the message`, `strategy: ${adapter.lastStrategy || "none"}`);
    }

    check(adapter.findMessage(w.document.body) === null, "findMessage(<body>) returns null");

    for (const url of spec.matchUrls || []) check(adapter.matches(url) === true, `matches ${url}`);
    for (const url of spec.noMatchUrls || []) check(adapter.matches(url) === false, `does not match ${url}`);
    frame.remove();
  }

  try {
    const res = await fetch("fixtures/expected.json");
    const { fixtures } = await res.json();
    for (const spec of fixtures) await runFixture(spec);
  } catch (err) {
    failures++;
    results.appendChild(el("p", "fail", "Could not run tests: " + err));
  }

  const verdict = failures ? "FAIL" : "PASS";
  summary.textContent = `${verdict}: ${checks - failures}/${checks} checks passed.`;
  summary.className = failures ? "fail" : "pass";
  summary.dataset.failed = String(failures);
  document.title = `TrustGraph adapter tests: ${verdict}`;
})();
