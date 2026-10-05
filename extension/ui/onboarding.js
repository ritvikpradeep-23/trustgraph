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
    const box = $("sample");
    const text = box.value;
    const anchor = () => box.getBoundingClientRect();

    button.disabled = true;
    TrustGraphCard.showChecking(anchor());
    try {
      const result = await chrome.runtime.sendMessage({ type: TG.MSG.SCORE, text, channel: "other", noStats: true });
      // No {text} context: the sample shouldn't be reportable.
      TrustGraphCard.showResult(result, anchor());
    } catch (err) {
      TrustGraphCard.showError("Couldn't run the check. Try reloading this page.", anchor());
    } finally {
      button.disabled = false;
    }
  });

  showServerStatus();
})();
