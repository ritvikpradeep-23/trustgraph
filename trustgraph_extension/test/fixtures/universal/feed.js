document.getElementById("next").addEventListener("click", (e) => {
  e.preventDefault();
  history.pushState({}, "", "/feed/next");
  document.getElementById("main").innerHTML =
    '<div class="post"><img id="photo2" src="http://cdn.other.test/other.png"><div class="overlay"></div></div><p>Second post after an in-app navigation, with a caption long enough to check.</p>';
});
