// 「このページ」の目次（どのページでも）。広い画面では左に固定し、読んでいる節を線の上の点で示す。狭い画面では見出しの下に一覧で出す。
// 見出し（h2）を持つ節を拾う：section[id] / .card / .home-sec。画面で隠れている節は入れない。
// 過去問演習のように、あとから節が出たり消えたりするページでは、そのたびに作り直す。
(function () {
  var nav, ol, links = [], secs = [], ticking = false, key = "";

  // 見出しの文字：h2 があればそれ、なければ data-toc-label
  function labelOf(s) {
    if (s.dataset && s.dataset.tocLabel) return s.dataset.tocLabel;
    var h = s.matches("h2, h3") ? s : s.querySelector(":scope > h2");
    // 目次では「（100点満点）」などの満点の注記を外して短くする（本文の見出しには残る）
    return h ? h.textContent.trim().replace(/\s*[（(]\s*\d+\s*点満点\s*[）)]\s*$/, "") : "";
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
    var k = found.map(function (s) { return (s.dataset.tocGroup || "") + ":" + labelOf(s); }).join("|");
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
      var anchor = document.querySelector("main .k-title, main .hero, main .kk-title");
      if (anchor) anchor.after(nav); else document.querySelector("main").prepend(nav);
    }
    nav.hidden = false;
    document.body.classList.add("has-toc");
    ol.textContent = "";
    // data-toc-group のある節（集計を見るの科目など）は、科目ごとに並べず、教科ごとに1つの項目にまとめる。
    // 項目は、その教科がページに初めて出る節へ飛ぶ。読んでいる節の教科の項目に点が付く
    var groupLink = {};
    links = secs.map(function (s, i) {
      if (!s.id) s.id = "sec-" + (i + 1);
      var g = s.dataset.tocGroup || "";
      if (g && groupLink[g]) return groupLink[g];
      var li = document.createElement("li"), a = document.createElement("a");
      a.href = "#" + s.id; a.textContent = g || labelOf(s);
      li.append(a); ol.append(li);
      if (g) groupLink[g] = a;
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
    var on = links[cur];   // 教科でまとめたときは、同じ a が何度も入っている
    links.forEach(function (a) { a.classList.toggle("is-on", a === on); if (a === on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    follow(links[cur]);
  }

  // 目次が画面より長く、目次の中で送れるとき：読んでいる項目が目次の中で見える位置に来るよう寄せる（ページ自体は動かさない）
  var lastCur = null;
  function follow(a) {
    if (!a || a === lastCur || !nav || nav.scrollHeight <= nav.clientHeight + 1) { lastCur = a; return; }
    lastCur = a;
    var nr = nav.getBoundingClientRect(), ar = a.getBoundingClientRect(), pad = 48;
    if (ar.top < nr.top + pad || ar.bottom > nr.bottom - pad) {
      var to = nav.scrollTop + (ar.top - nr.top) - nav.clientHeight / 3;
      nav.scrollTo({top: Math.max(0, to), behavior: "smooth"});
    }
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
