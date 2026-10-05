// First-install page: server status and the "Try it" sample.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  async function showServerStatus() {
    try {
      const status = await chrome.runtime.sendMessage({ type: TG.MSG.GET_STATUS });
      $("server-status").textContent = status.serverUp
        ? `Server found at ${status.settings.backend_url}. You'll get the full analysis.`
        : `No server found at ${status.settings.backend_url} right now, so checks will use the Basic check. You can change the address in Settings.`;
    } catch (_) {
      $("server-status").textContent = "";
    }
  }

  $("try").addEventListener("click", async () => {
    const button = $("try");
    const text = $("sample").value;
    button.disabled = true;
    TrustGraphPanel.showChecking();
    try {
      const result = await chrome.runtime.sendMessage({ type: TG.MSG.SCORE, text, channel: "other", noStats: true });
      // No {text} in the context: the sample shouldn't be reportable.
      TrustGraphPanel.showSingle(result, {});
    } catch (err) {
      TrustGraphPanel.showSingle({ error: "Couldn't run the check. Try reloading this page." });
    } finally {
      button.disabled = false;
    }
  });

  showServerStatus();
})();
