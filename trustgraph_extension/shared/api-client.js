// ApiClient: the extension's only way to talk to the TrustGraph web app.
// Everything it sends is a Result (shared/result.js) or an id. Never
// message text.
//
//   const api = TrustGraphApi.create({webappUrl, token});
//   api.saveResult(r)  api.listResults()  api.deleteResult(id)
//   api.deleteAll()    api.exportAll()    api.sendFeedback(id)
//   api.pair(code)     api.ping()         api.kind  ("http" | "mock")
//
// With no web app URL configured it returns MockApi: the same interface,
// backed by chrome.storage.local ("mock_webapp"), so sign-in, sync, "Open
// in workspace" and feedback can all be reviewed without a backend. The
// mock "web app" page (ui/webapp.html) reads the same store.
(function (root) {
  "use strict";
  const TG = root.TG;
  const Result = root.TrustGraphResult;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status || 0;
    }
  }

  // ---- real HTTP client ------------------------------------------------------
  function HttpApi({ webappUrl, token, fetchImpl, timeout }) {
    const base = String(webappUrl).replace(/\/+$/, "");
    const doFetch = fetchImpl || root.fetch.bind(root);
    async function call(method, path, body) {
      let res;
      try {
        res = await doFetch(base + path, {
          method,
          headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeout || TG.TIMEOUT_SMALL_MS),
        });
      } catch (err) {
        throw new ApiError("offline", 0);
      }
      if (!res.ok) throw new ApiError("HTTP " + res.status, res.status);
      try {
        return await res.json();
      } catch (_) {
        return null;
      }
    }
    const needToken = () => {
      if (!token) throw new ApiError("not signed in", 401);
    };
    return {
      kind: "http",
      async ping() {
        await call("GET", TG.WEBAPP.results + "?limit=1");
        return true;
      },
      async heartbeat(source) {
        needToken();
        await call("POST", TG.ENDPOINTS.status, { source: String(source || "extension"), ts: Date.now() });
      },
      async saveResult(r) {
        needToken();
        if (!Result.isValid(r)) throw new ApiError("refusing to send an invalid Result");
        await call("POST", TG.WEBAPP.results, r);
      },
      async listResults() {
        needToken();
        return Result.sanitizeList(await call("GET", TG.WEBAPP.results));
      },
      async deleteResult(id) {
        needToken();
        await call("DELETE", TG.WEBAPP.result + encodeURIComponent(id));
      },
      async deleteAll() {
        needToken();
        await call("DELETE", TG.WEBAPP.results);
      },
      async exportAll() {
        needToken();
        return Result.sanitizeList(await call("GET", TG.WEBAPP.export));
      },
      async sendFeedback(id) {
        await call("POST", TG.WEBAPP.feedback, { resultId: String(id) });
      },
      async pair(code) {
        const data = await call("POST", TG.WEBAPP.pair, { code: String(code).trim() });
        if (!data || typeof data.token !== "string") throw new ApiError("That code didn't work. Get a new one and try again.");
        return { token: data.token, name: String((data.account && data.account.name) || "Your account").slice(0, 80) };
      },
      pageUrl: (path) => base + path,
    };
  }

  // ---- mock (no web app yet) -------------------------------------------------
  const MOCK_KEY = "mock_webapp";
  async function mockRead() {
    const { [MOCK_KEY]: m } = await chrome.storage.local.get(MOCK_KEY);
    return { results: Result.sanitizeList(m && m.results), feedback: (m && m.feedback) || [], codes: (m && m.codes) || {} };
  }
  const mockWrite = (m) => chrome.storage.local.set({ [MOCK_KEY]: m });
  const PAIR_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  function MockApi({ token }) {
    const needToken = () => {
      if (!token) throw new ApiError("not signed in", 401);
    };
    return {
      kind: "mock",
      async ping() {
        return true;
      },
      async saveResult(r) {
        needToken();
        if (!Result.isValid(r)) throw new ApiError("refusing to send an invalid Result");
        const m = await mockRead();
        m.results = [r, ...m.results.filter((x) => x.id !== r.id)].slice(0, TG.HISTORY_MAX);
        await mockWrite(m);
      },
      async listResults() {
        needToken();
        return (await mockRead()).results;
      },
      async deleteResult(id) {
        needToken();
        const m = await mockRead();
        m.results = m.results.filter((x) => x.id !== id);
        await mockWrite(m);
      },
      async deleteAll() {
        needToken();
        const m = await mockRead();
        m.results = [];
        await mockWrite(m);
      },
      async exportAll() {
        needToken();
        return (await mockRead()).results;
      },
      async sendFeedback(id) {
        const m = await mockRead();
        if (!m.feedback.includes(String(id))) m.feedback.push(String(id));
        await mockWrite(m);
      },
      // Codes are issued by the mock web app page (ui/webapp.html); any
      // well-formed code it issued in the last 10 minutes works once.
      async pair(code) {
        const c = String(code || "").trim().toUpperCase();
        if (!PAIR_CODE.test(c)) throw new ApiError("Pairing codes look like ABCD-1234.");
        const m = await mockRead();
        const issued = m.codes[c];
        if (!issued || Date.now() - issued > 10 * 60 * 1000) throw new ApiError("That code didn't work. Get a new one and try again.");
        delete m.codes[c];
        await mockWrite(m);
        return { token: "mock-" + c.replace("-", "").toLowerCase() + "-" + Date.now().toString(36), name: "Demo workspace" };
      },
      pageUrl: (path) => chrome.runtime.getURL("ui/webapp.html") + "#" + path,
    };
  }

  // Issues a pairing code (used by the mock web app page only).
  async function mockIssueCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const pick = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => abc[b % abc.length]).join("");
    const code = pick() + "-" + pick();
    const m = await mockRead();
    for (const [c, t] of Object.entries(m.codes)) if (Date.now() - t > 10 * 60 * 1000) delete m.codes[c];
    m.codes[code] = Date.now();
    await mockWrite(m);
    return code;
  }

  function create({ webappUrl, token, fetchImpl } = {}) {
    return webappUrl ? HttpApi({ webappUrl, token, fetchImpl }) : MockApi({ token });
  }

  root.TrustGraphApi = { create, HttpApi, MockApi, ApiError, mockIssueCode, mockRead, MOCK_KEY };
})(globalThis);
