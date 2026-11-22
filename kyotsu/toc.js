// 「このページ」の目次（どのページでも）。広い画面では左に固定し、読んでいる節を線の上の点で示す。狭い画面では見出しの下に一覧で出す。
// 見出し（h2）を持つ節を拾う：section[id] / .card / .home-sec。画面で隠れている節は入れない。
// 過去問演習のように、あとから節が出たり消えたりするページでは、そのたびに作り直す。
(function () {
  var nav, ol, links = [], secs = [], ticking = false, key = "";

  // 見出しの文字：h2 があればそれ、なければ data-toc-label
  function labelOf(s) {
    if (s.dataset && s.dataset.tocLabel) return s.dataset.tocLabel;
    var h = s.matches("h2, h3") ? s : s.querySelector(":scope > h2");
    return h ? h.textContent.trim() : "";
  }
  function visible(s) { return !s.closest("[hidden]") && s.offsetParent !== null; }

  // 過去問演習のページ（節が h3 や部品でできている）では、こちらを使う
  var EXTRA = [[".sg-pw-t", "いまの実力"], [".sg-scroll", "点数のマス目"], [".sg details", "送る人の情報"], [".qk-more", "大問ごと・所要時間も入れる"]];

  function targets() {
    var list = [].slice.call(document.querySelectorAll("main section, main .card, main .home-sec"));
    var seen = [];
    var out = list.filter(function (s) {
      if (seen.indexOf(s) >= 0) return false;
      seen.push(s);
      var h = s.querySelector(":scope > h2");
      if (!h || !h.textContent.trim()) return false;
      if (!visible(s)) return false;   // 隠れている節は入れない
      if (s.parentElement && s.parentElement.closest("main section, main .card")) return false;  // 入れ子は外側だけ
      return true;
    });
    if (out.length >= 3) return out;
    // 節が少ないページ：見えている h3 と、点数のマス目の部品を、ページの順に
    var more = [].slice.call(document.querySelectorAll("main h3")).filter(function (h) {
      return visible(h) && h.textContent.trim() && !h.closest(".toc, table, .sg");
    });
    EXTRA.forEach(function (x) {
      var el = document.querySelector("main " + x[0]);
      if (el && visible(el)) { el.dataset.tocLabel = x[1]; more.push(el); }
    });
    more.sort(function (a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
    return more.length >= 3 ? more : out;
  }

  function build() {
    var found = targets();
    var k = found.map(labelOf).join("|");
    if (k === key) return;
    key = k;
    secs = found;
    if (secs.length < 3) { if (nav) nav.hidden = true; document.body.classList.remove("has-toc"); return; }
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "toc"; nav.setAttribute("aria-label", "このページ");
      var head = document.createElement("p"); head.className = "toc-h"; head.textContent = "このページ";
      ol = document.createElement("ol");
      var top = document.createElement("a"); top.className = "toc-top"; top.href = "#"; top.textContent = "トップへ戻る";
      top.addEventListener("click", function (ev) { ev.preventDefault(); window.scrollTo({top: 0, behavior: "smooth"}); history.replaceState(null, "", location.pathname + location.search); });
      nav.append(head, ol, top);
      var anchor = document.querySelector("main .k-title, main .hero, main .kk-news");
      if (anchor) anchor.after(nav); else document.querySelector("main").prepend(nav);
    }
    nav.hidden = false;
    document.body.classList.add("has-toc");
    ol.textContent = "";
    links = secs.map(function (s, i) {
      if (!s.id) s.id = "sec-" + (i + 1);
      var li = document.createElement("li"), a = document.createElement("a");
      a.href = "#" + s.id; a.textContent = labelOf(s);
      li.append(a); ol.append(li);
      return a;
    });
    update();
  }

  // 読んでいる節：画面の上から3分の1の線を越えた最後の節
  function update() {
    ticking = false;
    if (!links.length) return;
    var line = window.innerHeight / 3, cur = 0;
    secs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= line) cur = i; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = secs.length - 1;
    links.forEach(function (a, i) { a.classList.toggle("is-on", i === cur); if (i === cur) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
  }

  function start() {
    if (!document.querySelector("main")) return;
    build();
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, {passive: true});
    window.addEventListener("resize", update);
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(build, 200); })
      .observe(document.querySelector("main"), {childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"]});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
