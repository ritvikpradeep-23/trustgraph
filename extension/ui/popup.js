// Toolbar popup: status, today's counts, what this page supports, pause.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let backendUrl = TG.DEFAULT_SETTINGS.backend_url;

  function formatMinutes(total) {
    if (total < 60) return total + " min";
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function renderStatus(status) {
    const pill = $("pill");
    const detail = $("pill-detail");
    let state;
    let label;
    let text = "";

    if (status.settings.paused) {
      state = "paused";
      label = "Paused";
      text = "The shield is hidden. Right-click checks still work.";
    } else if (!status.serverUp) {
      state = "offline";
      label = "Server not running";
      text = `No TrustGraph server at ${status.settings.backend_url}. Checks use the Basic check (offline).`;
    } else if (status.lastScoreSource === "error") {
      state = "basic";
      label = "Basic check mode";
      text = "The server returned an error on the last check, so the Basic check was used.";
    } else {
      state = "active";
      label = "Active";
    }
    pill.dataset.state = state;
    pill.textContent = label;
    detail.textContent = text;
    detail.hidden = !text;

    $("stat-checked").textContent = String(status.stats.checkedToday);
    $("stat-flagged").textContent = String(status.stats.flaggedToday);
    $("stat-saved").textContent = formatMinutes(status.stats.minutesSavedEstimate);
    $("stat-saved").title = `${status.stats.checkedToday} checks × ${status.settings.minutes_per_check} min each (your setting). An estimate only.`;

    $("pause").checked = !!status.settings.paused;
    $("open-dashboard").hidden = !status.serverUp;
    backendUrl = status.settings.backend_url;
  }

  async function renderPage() {
    const line = $("page-line");
    const tip = $("page-tip");
    const showTip = (text) => {
      tip.textContent = text;
      tip.hidden = !text;
    };
    const RIGHT_CLICK_TIP = 'Tip: select any text, right-click, and choose "Check with TrustGraph".';

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (_) {}
    if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
      line.textContent = "TrustGraph can't run on this page.";
      showTip("Browser pages and the Chrome Web Store can't be checked.");
      return;
    }

    let info = null;
    try {
      info = await chrome.tabs.sendMessage(tab.id, { type: TG.MSG.SELF_TEST }, { frameId: 0 });
    } catch (_) {
      // No TrustGraph content script on this site (or it hasn't loaded yet).
    }

    if (!info || !info.supported) {
      line.textContent = "This site doesn't have the hover shield.";
      showTip(RIGHT_CLICK_TIP);
      return;
    }
    const name = TG.CHANNEL_LABELS[info.channel] || info.channel;
    if (info.paused) {
      line.textContent = `${name} is supported. TrustGraph is paused.`;
      showTip("");
    } else if (!info.sourceEnabled) {
      line.textContent = `${name} is turned off in Settings.`;
      showTip(RIGHT_CLICK_TIP);
    } else if (info.count > 0) {
      line.textContent = `Recognizing ${info.count} message${info.count === 1 ? "" : "s"} on this page (${name}).`;
      showTip("Hover a message and click the shield.");
    } else {
      line.textContent = `Not recognizing messages here (${name}).`;
      showTip("Open a conversation. If messages are open, the site may have changed: turn on Debug mode in Settings, or use right-click.");
    }
  }

  async function refresh() {
    try {
      const status = await chrome.runtime.sendMessage({ type: TG.MSG.GET_STATUS });
      if (status && !status.error) renderStatus(status);
    } catch (err) {
      $("pill").textContent = "Error";
      console.error("[TrustGraph]", err);
    }
    renderPage();
  }

  $("pause").addEventListener("change", async (event) => {
    await chrome.runtime.sendMessage({ type: TG.MSG.SET_SETTINGS, patch: { paused: event.target.checked } });
    refresh();
  });

  $("open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  $("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: backendUrl.replace(/\/+$/, "") + TG.ENDPOINTS.dashboard });
  });

  refresh();
})();
