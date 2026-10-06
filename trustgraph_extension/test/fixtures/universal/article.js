// Canvas drawn from a same-origin image, an open shadow root with an image
// inside, and "infinite scroll" content added later.
const img = new Image();
img.onload = () => document.getElementById("canvas").getContext("2d").drawImage(img, 0, 0, 300, 300);
img.src = "/known.png";
const shadow = document.getElementById("shadow-host").attachShadow({ mode: "open" });
shadow.innerHTML = '<p>Inside a web component:</p><img id="in-shadow" src="/known.png" width="240" height="240">';
setTimeout(() => {
  const a = document.createElement("article");
  a.innerHTML = '<h2>Loaded later</h2><img id="lazy" src="/known.png" width="260" height="260" loading="lazy">';
  document.getElementById("feed").appendChild(a);
}, 1200);
