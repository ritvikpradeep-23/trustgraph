// Privacy page: design system, logo and the three guarantees.
TrustGraphDesign.adopt(document);
document.getElementById("logo").append(TrustGraphUI.logo());
document.getElementById("promise").append(
  TrustGraphUI.checkRow("No message text in detection history"),
  TrustGraphUI.checkRow("No scam reports or public submission database"),
  TrustGraphUI.checkRow("Delete or export your data anytime")
);
if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: "getSettings" }).then((s) => TrustGraphDesign.applyTheme(document, s.theme), () => {});
