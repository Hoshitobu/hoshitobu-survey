// 「年度と科目を選ぶ」の部品（Home と過去問演習）。選ぶと、その場で4択（解く／点数を入れる／平均点・正答率／解説動画）が開く。
// 科目のボタンは HTML に書いてある（JS がなくても、最新の年度は各年度・科目のページへのリンクとして使える）。年度ごとの数字は pick-data.js（window.PICK。build_pages.py が作る）。
// 4択の行き先は、各年度・科目のページの4つのタブ（kyotsu/年/科目.html#solve など）。過去問演習のページでは、「解く」だけは3（始める）へ進む。
// 過去問演習のページへのお知らせ：選んだら document に "pk:change"（detail: {y, s, todo}）を送る。
(function () {
  var P = window.PICK;
  if (!P) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  $$(".pk").forEach(function (pk) {
    var root = pk.dataset.root || "";
    var box = pk.dataset.acts ? $(pk.dataset.acts) : pk;
    var yearBox = $(".pk-years", pk), acts = $(".acts", box), head = $(".acts-h", box);
    var groups = $$(".pk-subj", pk);
    var st = {y: +(yearBox.querySelector('[aria-pressed="true"]') || {dataset: {y: 2026}}).dataset.y, s: null, todo: null};
    var mode = pk.dataset.mode;

    function info() { return P.info[st.y + "-" + st.s]; }
    function drawYears() { $$("button", yearBox).forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.y === st.y)); }); }
    function drawSubj() {
      var found = false;
      groups.forEach(function (g) {
        g.hidden = +g.dataset.y !== st.y;
        $$("a", g).forEach(function (a) {
          var on = a.dataset.s === st.s && +g.dataset.y === st.y; if (on) found = true;
          a.setAttribute("aria-pressed", String(on));
        });
      });
      if (!found) st.s = null;
    }
    function drawActs() {
      if (!acts) return;
      var frame = !st.s, i = frame ? null : info();
      acts.classList.toggle("is-frame", frame);
      if (head) { head.hidden = frame; head.innerHTML = frame ? "" : "<b>" + st.y + " " + i.nm + "</b>で、何をしますか。"; }
      var url = frame ? "" : root + "kyotsu/" + st.y + "/" + st.s + ".html";
      $$(".act", acts).forEach(function (a) {
        var k = a.dataset.k, d = "", href = "", none = false;
        if (!frame) {
          if (k === "solve") {
            none = !i.ex; d = none ? "この年度・科目は、時間を計って解く形では出していません" : "制限時間 " + i.mi + "分・設問ごとに○×で採点";
            href = pk.dataset.solve === "step" ? "#go" : url + "#solve";
          } else if (k === "score") {
            d = "解き終えた点数を送ると、偏差値と順位が出ます"; href = url + "#score";
          } else if (k === "mean") {
            d = (i.m !== null ? "全国の平均点 " + i.m.toFixed(2) + "点。" : "") + (st.y >= 2023 && i.it ? "大問ごと・設問ごとの数字も" : "平均点・標準偏差・問題と正解のPDF"); href = url + "#mean";
          } else {
            none = !i.v; d = !i.v ? "この年度・科目の解説動画は、まだありません" : i.v[1] === "z" ? "全問解説（" + i.v[0] + "）・大問ごとのチャプターつき" : "大問ごとの解説動画"; href = url + "#video";
          }
        }
        $(".a-d", a).textContent = d || " ";
        a.classList.toggle("is-none", none);
        a.classList.toggle("is-on", !frame && st.todo === k);
        if (frame || none) { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); } else { a.setAttribute("href", href); a.removeAttribute("aria-disabled"); }
      });
      document.dispatchEvent(new CustomEvent("pk:change", {detail: {y: st.y, s: st.s, todo: st.todo, info: frame ? null : info()}}));
    }
    yearBox.addEventListener("click", function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      st.y = +b.dataset.y; st.todo = null; drawYears(); drawSubj(); drawActs();
    });
    pk.addEventListener("click", function (ev) {
      var a = ev.target.closest(".pk-subj a"); if (!a) return;
      ev.preventDefault();
      st.s = a.dataset.s; st.todo = null; drawSubj(); drawActs();
      if (ev.isTrusted && acts && acts.getBoundingClientRect().bottom > innerHeight) (head || acts).scrollIntoView({block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    });
    if (acts) acts.addEventListener("click", function (ev) {
      var a = ev.target.closest(".act"); if (!a) return;
      if (a.getAttribute("aria-disabled")) { ev.preventDefault(); return; }
      if (a.dataset.k === "solve" && pk.dataset.solve === "step") { st.todo = "solve"; drawActs(); }
    });
    var p = new URLSearchParams(location.search);
    if (p.get("y") && P.years.indexOf(+p.get("y")) >= 0) st.y = +p.get("y");
    if (p.get("s") && P.info[st.y + "-" + p.get("s")]) st.s = p.get("s");
    if (p.get("do") === "solve" && st.s) st.todo = "solve";
    // 年度×科目のページの「時間を計って解く」（kakomon.html?exam=2025-honshi-chem）から来たときは、その年度・科目で「解く」を選んだ形にする
    var ex = (p.get("exam") || "").match(/^(\d{4})-[a-z0-9]+-(.+)$/);
    if (ex && pk.dataset.solve === "step" && P.info[ex[1] + "-" + ex[2]]) { st.y = +ex[1]; st.s = ex[2]; st.todo = "solve"; }
    $$(".pk-subj a", pk).forEach(function (a) { a.setAttribute("role", "button"); });
    drawYears(); drawSubj(); drawActs();
    pk.pickState = st;
  });
})();
