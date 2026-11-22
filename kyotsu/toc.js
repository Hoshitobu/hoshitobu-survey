// 「このページ」の目次。広い画面では左に固定し、読んでいる節を線の上の点で示す。狭い画面では見出しの下に一覧で出す
(function () {
  var secs = [].slice.call(document.querySelectorAll("main section.card[id]")).filter(function (s) { return s.querySelector("h2"); });
  if (secs.length < 3) return;
  var nav = document.createElement("nav");
  nav.className = "toc"; nav.setAttribute("aria-label", "このページ");
  var head = document.createElement("p"); head.className = "toc-h"; head.textContent = "このページ";
  var ol = document.createElement("ol");
  var links = secs.map(function (s) {
    var li = document.createElement("li"), a = document.createElement("a");
    a.href = "#" + s.id; a.textContent = s.querySelector("h2").textContent;
    li.append(a); ol.append(li);
    return a;
  });
  var top = document.createElement("a"); top.className = "toc-top"; top.href = "#"; top.textContent = "トップへ戻る";
  top.addEventListener("click", function (ev) { ev.preventDefault(); window.scrollTo({top: 0, behavior: "smooth"}); history.replaceState(null, "", location.pathname + location.search); });
  nav.append(head, ol, top);
  var title = document.querySelector("main .k-title");
  (title || document.querySelector("main")).after(nav);
  document.body.classList.add("has-toc");

  // 読んでいる節：画面の上から3分の1の線を越えた最後の節
  var ticking = false;
  function update() {
    ticking = false;
    var line = window.innerHeight / 3, cur = 0;
    secs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= line) cur = i; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = secs.length - 1;
    links.forEach(function (a, i) { a.classList.toggle("is-on", i === cur); if (i === cur) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, {passive: true});
  window.addEventListener("resize", update);
  update();
})();
