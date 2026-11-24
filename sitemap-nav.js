// ナビの動き（全ページで読まれる）：ヘッダーの「検索・地図」ボタンで、検索の欄と木の形の地図が1つの箱で開く。
// 子の行（ヘッダーのすぐ下）とフッターの地図は、生成した HTML にあればそれを使い、無いページ（手で書いたページ・別の生成元のページ）にはここで足す。
// ナビの定義は site-nav.js（_横断/サイト_入口ページ/site_header.py が書き出す window.SITE_NAV）。検索の索引は search-index.json（build_pages.py が作る。箱を初めて開いたときに読む）。
(function () {
  var me = document.currentScript;
  var src = me ? me.src : "";
  var base = src.replace(/sitemap-nav\.js(\?.*)?$/, "");
  var ver = (src.match(/\?(v=[^&#]*)/) || [, ""])[1];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]; }); }

  // いまいる所：[親の鍵, 子の鍵]
  function where() {
    var bp = base.replace(/^[a-z]+:\/\/[^/]*/i, "");
    var rel = decodeURIComponent(location.pathname);
    rel = rel.indexOf(bp) === 0 ? rel.slice(bp.length) : rel.replace(/^\//, "");
    if (rel === "" || /\/$/.test(rel) && !/^(muki|seiri|kyotsu|ruidai|enshu)\/$/.test(rel)) rel = rel + "index.html";
    if (/^(muki|seiri|kyotsu|ruidai|enshu)\/$/.test(rel)) rel += "index.html";
    if (rel === "index.html") return ["top", null];
    if (rel === "kakomon.html") return /[?&]view=quick/.test(location.search) ? ["score", "quick"] : ["solve", "kakomon"];
    if (rel === "enshu/index.html") return ["solve", "kakomon"];
    if (/^ruidai\//.test(rel)) return ["solve", "ruidai"];
    if (rel === "results.html") return ["score", "results"];
    if (/^kyotsu\//.test(rel)) return ["score", "kyotsu"];
    if (rel === "videos.html") return ["videos", null];
    if (/^muki\//.test(rel)) return ["seiri", "muki"];
    if (rel === "seiri/zukei.html") return ["seiri", "zukei"];
    if (/^seiri\//.test(rel)) return ["seiri", null];
    return [null, null];
  }

  var N = null, W = where();

  function subHtml() {
    for (var i = 0; i < N.nav.length; i++) {
      var p = N.nav[i];
      if (p[0] !== W[0] || !p[3].length) continue;
      return '<nav class="sub" aria-label="「' + p[1] + '」の中"><div class="sub-in">' + p[3].map(function (k) {
        return k[1] ? '<a href="' + base + k[1] + '"' + (k[3] === W[1] ? ' aria-current="page"' : "") + ">" + k[0] + "</a>"
                    : '<span class="soon">' + k[0] + "<small>Coming soon</small></span>";
      }).join("") + "</div></nav>";
    }
    return "";
  }
  function treeHtml() {
    var here = W[1] || W[0], T = N.tiers;
    function cur(k) { return k === here ? ' aria-current="page"' : ""; }
    function soon(n) { return '<li><span class="soon">' + n + "<small>Coming soon</small></span></li>"; }
    var lis = ['<li><a class="t-p" href="' + base + 'index.html"' + cur("top") + '>トップ</a><ul><li><a href="' + base + 'index.html#pick">年度と科目を選ぶ</a></li></ul></li>'];
    N.nav.forEach(function (p) {
      var rows = p[3].map(function (k) {
        var extra = "";
        if (k[3] === "kyotsu") extra = "<ul><li><span>各年度・科目のページ</span></li></ul>";
        if (T[k[3]]) {
          var t = T[k[3]];
          extra = "<ul>" + (t[1] ? '<li><a href="' + base + t[1] + '">' + t[0] + "</a></li>" : soon(t[0])) + (t[3] ? '<li><a href="' + base + t[3] + '">' + t[2] + "</a></li>" : soon(t[2])) + "</ul>";
        }
        return k[1] ? '<li><a href="' + base + k[1] + '"' + cur(k[3]) + ">" + k[0] + "</a>" + extra + "</li>" : soon(k[0]);
      });
      if (p[0] === "videos") rows.push('<li><a href="' + N.yt + '" target="_blank" rel="noopener">YouTube ↗</a></li>');
      lis.push('<li><a class="t-p" href="' + base + p[2] + '"' + cur(p[0]) + ">" + p[1] + "</a>" + (rows.length ? "<ul>" + rows.join("") + "</ul>" : "") + "</li>");
    });
    lis.push('<li class="t-ext"><span class="t-p">外のサイト</span><ul><li><a href="' + N.dnc + '" target="_blank" rel="noopener">大学入試センター（問題・正解PDF）↗</a></li><li><a href="' + N.yt + '" target="_blank" rel="noopener">YouTube「星飛ぶ」↗</a></li></ul></li>');
    return '<ul class="tree">' + lis.join("") + "</ul>";
  }
  var I_FIND = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12.8 12.8L17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var I_MAP = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5l5-2 6 2 5-2v12l-5 2-6-2-5 2z M7 3v12 M13 5v12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  // ---------- 検索 ----------
  var INDEX = null, loading = false;
  function loadIndex(done) {
    if (INDEX) return done();
    if (loading) return;
    loading = true;
    fetch(base + "search-index.json" + (ver ? "?" + ver : "")).then(function (r) { return r.json(); }).then(function (j) { INDEX = j; loading = false; done(); })
      .catch(function () { INDEX = []; loading = false; done(); });
  }
  function crumb(u) {
    if (/^muki\//.test(u)) return "知識の整理 › 無機化学 › 辞書";
    if (/^seiri\/zukei/.test(u)) return "知識の整理 › 図形の性質 › 辞書";
    if (/^seiri\//.test(u)) return "知識の整理";
    if (/^kyotsu\//.test(u)) return "点数と集計 › 平均点・正答率";
    if (/^kakomon/.test(u)) return "解く › 過去問演習";
    if (/^results/.test(u)) return "点数と集計 › サイトの集計";
    if (/^videos/.test(u)) return "解説動画";
    return "トップ";
  }
  function hl(s, words) { s = esc(s); words.forEach(function (w) { s = s.split(esc(w)).join("<mark>" + esc(w) + "</mark>"); }); return s; }
  function norm(s) { return s.toLowerCase().replace(/[Ⅰ]/g, "i").replace(/[Ⅱ]/g, "ii").replace(/\s+/g, " "); }

  function mountFind() {
    var fd = $("#fd");
    if (!fd) {
      fd = document.createElement("div"); fd.className = "fd"; fd.id = "fd"; fd.hidden = true;
      fd.innerHTML = '<label class="fd-q">' + I_FIND + '<input type="search" placeholder="ことば・年度・科目で探す" aria-label="サイト内を検索" autocomplete="off"></label>' +
        '<p class="fd-try">たとえば <button type="button">希硝酸</button><button type="button">錯イオン</button><button type="button">2025 化学</button><button type="button">正弦定理</button></p>' +
        '<div class="fd-res" aria-live="polite"></div><div class="fd-map"><p class="fd-h">サイトの地図</p>' + treeHtml() + "</div>";
      document.body.appendChild(fd);
    }
    var hd = $("body > header"), q = $("input", fd), res = $(".fd-res", fd), map = $(".fd-map", fd), tryBox = $(".fd-try", fd), opener = null;
    var btns = $$(".hd-find");
    if (!btns.length && hd) {   // 古い形のヘッダー：ボタンを足す
      var nv = $("nav", hd), b = document.createElement("button");
      b.type = "button"; b.className = "hd-find"; b.dataset.focus = "1"; b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", "fd");
      b.innerHTML = I_FIND + "<span>検索・地図</span>"; if (nv) nv.appendChild(b); btns = [b];
    }
    function place() {
      var r = hd.getBoundingClientRect();
      fd.style.top = (Math.max(0, r.bottom) + 8) + "px";
      fd.style.maxHeight = "calc(100vh - " + (Math.max(0, r.bottom) + 16) + "px)";
    }
    function openFd(btn, focus) {
      opener = btn; place(); fd.hidden = false;
      btns.forEach(function (x) { x.setAttribute("aria-expanded", String(x === btn)); });
      if (focus) q.focus();
      loadIndex(function () { if (q.value.trim()) search(); });
    }
    function closeFd() { if (fd.hidden) return; fd.hidden = true; btns.forEach(function (x) { x.setAttribute("aria-expanded", "false"); }); }
    btns.forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); if (!fd.hidden && opener === b) closeFd(); else openFd(b, b.dataset.focus === "1"); });
    });
    document.addEventListener("click", function (ev) { if (!fd.hidden && !fd.contains(ev.target)) closeFd(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !fd.hidden) { closeFd(); if (opener) opener.focus(); } });
    addEventListener("resize", function () { if (!fd.hidden) place(); });
    addEventListener("scroll", function () { if (!fd.hidden) place(); }, {passive: true});

    function search() {
      var raw = q.value.trim();
      if (!raw) { res.innerHTML = ""; map.hidden = false; tryBox.hidden = false; return; }
      if (!INDEX) { loadIndex(search); return; }
      var words = raw.split(/[\s　]+/).filter(Boolean), nw = words.map(norm), out = [];
      INDEX.forEach(function (p) {
        var t = norm(p.t), hs = p.h || [], body = norm(p.k || ""), score = 0, hit = null;
        for (var i = 0; i < nw.length; i++) {
          var w = nw[i], ok = false;
          if (t.indexOf(w) >= 0) { score += 10; ok = true; }
          for (var j = 0; j < hs.length; j++) if (norm(hs[j]).indexOf(w) >= 0) { score += 4; ok = true; if (!hit) hit = hs[j]; break; }
          if (body.indexOf(w) >= 0) { score += 2; ok = true; }
          if (!ok) return;
        }
        out.push({p: p, s: score, hit: hit});
      });
      out.sort(function (a, b) { return b.s - a.s; });
      var n = out.length; out = out.slice(0, 8);
      res.innerHTML = '<p class="fd-n">' + (n ? "「" + esc(raw) + "」 " + n + " ページ" + (n > 8 ? "（上から 8 つ）" : "") : "「" + esc(raw) + "」は見つかりませんでした。") + "</p>" +
        out.map(function (o) {
          return '<a href="' + base + o.p.u + '"><span class="r-c">' + crumb(o.p.u) + '</span><span class="r-t">' + hl(o.p.t, words) + "</span>" +
            (o.hit ? '<span class="r-h">' + hl(o.hit, words) + "</span>" : '<span class="r-h">本文に「' + esc(words[0]) + "」</span>") + "</a>";
        }).join("");
      map.hidden = true; tryBox.hidden = true;
    }
    q.addEventListener("input", search);
    $$("button", tryBox).forEach(function (b) { b.addEventListener("click", function () { q.value = b.textContent; search(); q.focus(); }); });
  }

  function mount() {
    var hd = $("body > header");
    if (!hd) return;
    // 点数を入れる画面（kakomon.html?view=quick）では、ナビの現在地を「点数と集計」にする
    if (W[0] === "score" && W[1] === "quick") {
      $$(".hd-item > a[aria-current]", hd).forEach(function (a) { a.removeAttribute("aria-current"); });
      var li = $$(".hd-item > a", hd).filter(function (a) { return /view=quick/.test(a.getAttribute("href") || ""); })[0];
      if (li) li.setAttribute("aria-current", "true");
    }
    var s = $("nav.sub");
    if (!s && W[0]) { var h = subHtml(); if (h) hd.insertAdjacentHTML("afterend", h); }
    if (s && W[0] === "score" && W[1] === "quick") {   // 生成した子の行の下線も合わせる
      $$("a", s).forEach(function (a) { if (/view=quick/.test(a.getAttribute("href") || "")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    }
    if (!$("footer.ft")) {
      var f = document.createElement("footer"); f.className = "ft";
      f.innerHTML = '<div class="ft-in"><p class="ft-h">' + I_MAP + "サイトの地図</p>" + treeHtml() +
        '<p class="ft-src">' + esc(N.src) + '（<a href="https://www.dnc.ac.jp/" rel="noopener">大学入試センター</a>）。名前やメールアドレスは聞きません。<a href="' + base + 'kakomon.html?view=quick">送る内容について</a></p></div>';
      document.body.appendChild(f);
    }
    mountFind();
  }

  function start() {
    if (window.SITE_NAV) { N = window.SITE_NAV; mount(); return; }
    var s = document.createElement("script");
    s.src = base + "site-nav.js" + (ver ? "?" + ver : "");
    s.onload = function () { N = window.SITE_NAV; mount(); };
    document.head.appendChild(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
