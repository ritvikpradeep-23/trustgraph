// Settings page. Every change saves immediately through the background
// (TG.MSG.SET_SETTINGS), which stores only the keys you change.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let settings = TG.DEFAULT_SETTINGS;
  let savedTimer = 0;

  function flashSaved(text) {
    $("saved").textContent = text || "Saved";
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => ($("saved").textContent = ""), 2000);
  }

  async function save(patch) {
    settings = await chrome.runtime.sendMessage({ type: TG.MSG.SET_SETTINGS, patch });
    flashSaved();
  }

  function render() {
    for (const input of document.querySelectorAll("[data-source]")) {
      input.checked = settings.sources[input.dataset.source] !== false;
    }
    $("minutes").value = settings.minutes_per_check;
    $("minutes-value").textContent = settings.minutes_per_check + " min";
    $("backend").value = settings.backend_url;
    $("debug").checked = !!settings.debug;
    $("version").textContent = "v" + chrome.runtime.getManifest().version;
  }

  // --- Sources, time estimate, debug -------------------------------------
  for (const input of document.querySelectorAll("[data-source]")) {
    input.addEventListener("change", () => save({ sources: { [input.dataset.source]: input.checked } }));
  }

  $("minutes").addEventListener("input", (e) => ($("minutes-value").textContent = e.target.value + " min"));
  $("minutes").addEventListener("change", (e) => save({ minutes_per_check: Number(e.target.value) }));

  $("debug").addEventListener("change", (e) => save({ debug: e.target.checked }));

  // --- Backend URL ---------------------------------------------------------
  // Returns {url, permission} or {error}. Plain http only for this computer;
  // anything else must be https and needs the user's permission for that host.
  function validateBackend(raw) {
    let url;
    try {
      url = new URL(String(raw).trim());
    } catch (_) {
      return { error: "Enter a full address, like http://127.0.0.1:8000" };
    }
    if (url.username || url.password) return { error: "Don't include a username or password in the address." };
    const normalized = url.origin + url.pathname.replace(/\/+$/, "");
    if (url.protocol === "http:") {
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return { url: normalized, permission: null };
      return { error: "Plain http:// is only allowed for 127.0.0.1 or localhost. Use https:// for other servers." };
    }
    if (url.protocol === "https:") return { url: normalized, permission: `https://${url.hostname}/*` };
    return { error: "The address must start with http:// or https://" };
  }

  function showBackendMsg(text, isError) {
    $("backend-msg").textContent = text;
    $("backend-msg").classList.toggle("error", !!isError);
    $("backend").setAttribute("aria-invalid", isError ? "true" : "false");
  }

  async function forgetOldPermission(oldUrl, newPermission) {
    const old = validateBackend(oldUrl);
    if (old.permission && old.permission !== newPermission) {
      try {
        await chrome.permissions.remove({ origins: [old.permission] });
      } catch (_) {}
    }
  }

  async function saveBackend(raw) {
    const checked = validateBackend(raw);
    if (checked.error) return showBackendMsg(checked.error, true);
    if (checked.permission) {
      // Must be the first await after the click so Chrome sees a user gesture.
      const granted = await chrome.permissions.request({ origins: [checked.permission] });
      if (!granted) return showBackendMsg("TrustGraph needs your permission to contact that server. Not saved.", true);
    }
    const previous = settings.backend_url;
    await save({ backend_url: checked.url });
    await forgetOldPermission(previous, checked.permission);
    $("backend").value = checked.url;
    showBackendMsg("Saved. Use Test connection to check it.", false);
  }

  $("backend-save").addEventListener("click", () => saveBackend($("backend").value));
  $("backend").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBackend($("backend").value);
  });
  $("backend-reset").addEventListener("click", () => saveBackend(TG.DEFAULT_SETTINGS.backend_url));

  $("backend-test").addEventListener("click", async () => {
    showBackendMsg("Testing…", false);
    const status = await chrome.runtime.sendMessage({ type: TG.MSG.GET_STATUS });
    if (status && status.serverUp) showBackendMsg(`Connected to ${status.settings.backend_url}.`, false);
    else showBackendMsg(`No response from ${settings.backend_url}. Checks will use the Basic check (offline).`, true);
  });

  // --- Clear data ----------------------------------------------------------
  $("clear").addEventListener("click", async () => {
    if (!confirm("Clear TrustGraph's settings and counts on this device?")) return;
    await chrome.runtime.sendMessage({ type: TG.MSG.CLEAR_DATA });
    settings = await chrome.runtime.sendMessage({ type: TG.MSG.GET_SETTINGS });
    render();
    $("clear-msg").textContent = "Cleared. Settings are back to their defaults.";
  });

  // Keep the page in sync if settings change elsewhere (e.g. the popup).
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    settings = await chrome.runtime.sendMessage({ type: TG.MSG.GET_SETTINGS });
    render();
  });

  (async function init() {
    render();
    try {
      settings = await chrome.runtime.sendMessage({ type: TG.MSG.GET_SETTINGS });
    } catch (_) {}
    render();
  })();
})();
