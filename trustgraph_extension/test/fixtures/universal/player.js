const v = document.getElementById("v");
document.getElementById("pp").addEventListener("click", () => {
  v.paused ? v.play() : v.pause();
  const c = document.getElementById("clicks");
  c.textContent = String(Number(c.textContent) + 1);
});
