// 右上の「地図」：サイトの中のページどうしのつながりと、外のサイト（YouTube・大学入試センター）への行き先を小さな図で見せる。
// どのページでも <script src="(相対)sitemap-nav.js" defer></script> を読むだけで、header nav の右に「地図」ボタンが付く。
(function () {
  var me = document.currentScript;
  var base = me ? me.src.replace(/sitemap-nav\.js(\?.*)?$/, "") : "";
  var path = location.pathname;
  var q = location.search;

  // 類題演習のページを公開したら true にする（true なら「類題演習」の箱が押せるようになる）
  var RUIDAI_PUBLISHED = false;

  // いまいるところ
  var here = "top";
  if (/kakomon\.html$/.test(path)) here = /view=quick/.test(q) ? "quick" : "practice";
  else if (/results\.html$/.test(path)) here = "results";
  else if (/videos\.html$/.test(path)) here = "videos";
  else if (/\/enshu\//.test(path)) here = "enshu";
  else if (/\/seiri\//.test(path)) here = "seiri";
  else if (/\/ruidai\//.test(path)) here = "ruidai";
  else if (/muki\//.test(path)) here = "muki";
  else if (/kyotsu\/index\.html$/.test(path) || /kyotsu\/$/.test(path)) here = "kyotsu";
  else if (/kyotsu\/\d{4}\/[^/]+\.html$/.test(path)) here = "page";

  var m = path.match(/kyotsu\/(\d{4})\/([^/]+)\.html$/);
  var pageLabel = m ? m[1] + "年の各科目" : "各年度・科目のページ";
  var YT = "https://www.youtube.com/channel/UCr70QjMPBkxJ1PT0CQhJvQA", DNC = "https://www.dnc.ac.jp/kyotsu/kakomondai/";

  // 図：左から「入口」→「大きなページ」→「その中のページ」→「外のサイト」。
  // 狭い画面（640px未満）では、文字が小さくならないように、箱を縦に並べた縮めない図（幅280）に切り替える
  var narrow = false, N, WIDE = {
    top: {x: 10, y: 220, w: 84, h: 34, t: "トップ", href: "index.html"},
    enshu: {x: 124, y: 74, w: 124, h: 34, t: "実践演習", href: "enshu/index.html"},
    seiri: {x: 124, y: 206, w: 124, h: 34, t: "知識の総整理", href: "seiri/index.html"},
    kyotsu: {x: 124, y: 266, w: 124, h: 34, t: "過去問の平均点", href: "kyotsu/index.html"},
    videos: {x: 124, y: 326, w: 124, h: 34, t: "解説動画", href: "videos.html"},
    results: {x: 124, y: 386, w: 124, h: 34, t: "集計を見る", href: "results.html"},
    quick: {x: 282, y: 20, w: 150, h: 34, t: "点数を入れる", href: "kakomon.html?view=quick"},
    practice: {x: 282, y: 74, w: 150, h: 34, t: "時間を計って解く", href: "kakomon.html"},
    ruidai: {x: 282, y: 128, w: 150, h: 34, t: RUIDAI_PUBLISHED ? "類題演習" : "類題演習 Coming soon", href: RUIDAI_PUBLISHED ? "ruidai/index.html" : null, soon: !RUIDAI_PUBLISHED},
    muki: {x: 282, y: 206, w: 150, h: 34, t: "無機化学", href: "muki/index.html"},
    page: {x: 282, y: 266, w: 150, h: 34, t: pageLabel, href: m ? null : "kyotsu/index.html"},
    dnc: {x: 462, y: 266, w: 128, h: 34, t: "問題・正解PDF", href: DNC, ext: true},
    yt: {x: 462, y: 326, w: 128, h: 34, t: "YouTube", href: YT, ext: true}
  };
  var NARROW = {
    top: {x: 0, y: 190, w: 56, h: 40, t: "トップ", href: "index.html"},
    enshu: {x: 66, y: 84, w: 100, h: 40, t: "実践演習", href: "enshu/index.html"},
    seiri: {x: 66, y: 212, w: 100, h: 40, t: "知識の総整理", href: "seiri/index.html"},
    kyotsu: {x: 66, y: 282, w: 100, h: 40, t: "過去問の平均点", href: "kyotsu/index.html"},
    videos: {x: 66, y: 348, w: 100, h: 40, t: "解説動画", href: "videos.html"},
    yt: {x: 66, y: 414, w: 100, h: 40, t: "YouTube", href: YT, ext: true},
    results: {x: 0, y: 348, w: 56, h: 40, t: "集計を見る", href: "results.html"},
    quick: {x: 176, y: 28, w: 104, h: 40, t: "点数を入れる", href: "kakomon.html?view=quick"},
    practice: {x: 176, y: 84, w: 104, h: 40, t: "時間を計って解く", href: "kakomon.html"},
    ruidai: {x: 176, y: 140, w: 104, h: 40, t: RUIDAI_PUBLISHED ? "類題演習" : "類題演習|Coming soon", href: RUIDAI_PUBLISHED ? "ruidai/index.html" : null, soon: !RUIDAI_PUBLISHED},
    muki: {x: 176, y: 212, w: 104, h: 40, t: "無機化学", href: "muki/index.html"},
    page: {x: 176, y: 282, w: 104, h: 40, t: pageLabel, href: m ? null : "kyotsu/index.html"},
    dnc: {x: 176, y: 348, w: 104, h: 40, t: "問題・正解PDF", href: DNC, ext: true}
  };
  N = WIDE;
  // top→practice・quick は、実践演習を通る形にしてある
  var E = [
    ["top", "enshu"], ["top", "seiri"], ["top", "kyotsu"], ["top", "videos"], ["top", "results"],
    ["enshu", "quick"], ["enshu", "practice"], ["enshu", "ruidai"], ["practice", "ruidai"],
    ["seiri", "muki"], ["ruidai", "muki"],
    ["kyotsu", "page"], ["page", "videos"], ["page", "dnc"], ["videos", "yt"]
  ];

  function center(n) { return {x: n.x + n.w / 2, y: n.y + n.h / 2}; }
  function edge(a, b) {
    var A = N[a], B = N[b], p = center(A), r = center(B);
    // 箱のふちから出る
    var x1 = p.x, y1 = p.y, x2 = r.x, y2 = r.y;
    if (Math.abs(r.x - p.x) > 10) { x1 = r.x > p.x ? A.x + A.w : A.x; x2 = r.x > p.x ? B.x : B.x + B.w; }
    else { y1 = r.y > p.y ? A.y + A.h : A.y; y2 = r.y > p.y ? B.y : B.y + B.h; }
    var mx = (x1 + x2) / 2;
    var d = Math.abs(x2 - x1) > 10 ? "M" + x1 + " " + y1 + " C" + mx + " " + y1 + " " + mx + " " + y2 + " " + x2 + " " + y2
                                   : "M" + x1 + " " + y1 + " L" + x2 + " " + y2;
    var on = a === here || b === here;
    return '<path d="' + d + '" class="sm-e' + (on ? " on" : "") + '" marker-end="url(#sm-arr)"/>';
  }
  function box(id) {
    var n = N[id], cur = id === here;
    var rect = '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="8" class="sm-b' +
      (cur ? " cur" : "") + (n.ext ? " ext" : "") + (n.soon ? " soon" : "") + '"/>';
    var label = n.t + (n.ext ? " ↗" : ""), cx = n.x + n.w / 2, text;
    if (narrow && /[^\x00-\x7f]/.test(n.t) && (label.indexOf("|") >= 0 || label.length * 13.5 > n.w - 8)) {
      // 2行に分ける（長い名前は「の」「・」などの切れ目の近くで）
      var k = Math.ceil(label.length / 2), best = k, bar = label.indexOf("|");
      if (bar >= 0) { label = label.replace("|", ""); best = bar; k = -9; }
      for (var d = 0; k > 0 && d <= 2; d++) { if ("のを・".indexOf(label.charAt(k - d - 1)) >= 0) { best = k - d; break; } if ("のを・".indexOf(label.charAt(k + d - 1)) >= 0) { best = k + d; break; } }
      text = '<text text-anchor="middle" class="sm-t' + (cur ? " cur" : "") + (n.soon ? " soon" : "") + '"><tspan x="' + cx + '" y="' + (n.y + n.h / 2 - 3) + '">' + label.slice(0, best) +
        '</tspan><tspan x="' + cx + '" y="' + (n.y + n.h / 2 + 13) + '">' + label.slice(best) + "</tspan></text>";
    } else {
      text = '<text x="' + cx + '" y="' + (n.y + n.h / 2 + 5) + '" text-anchor="middle" class="sm-t' + (cur ? " cur" : "") + (n.soon ? " soon" : "") + '">' + label + "</text>";
    }
    var g = rect + text + (cur ? '<text x="' + (n.x + n.w / 2) + '" y="' + (n.y + n.h + (narrow ? 12 : 13)) + '" text-anchor="middle" class="sm-here">いまここ</text>' : "");
    if (!n.href || cur) return "<g>" + g + "</g>";
    var href = n.ext ? n.href : base + n.href;
    return '<a href="' + href + '"' + (n.ext ? ' target="_blank" rel="noopener"' : "") + ">" + g + "</a>";
  }
  function svg() {
    N = narrow ? NARROW : WIDE;
    return '<svg viewBox="0 0 ' + (narrow ? "280 470" : "600 440") + '" role="img" aria-label="サイトの地図" class="sm-svg' + (narrow ? " sm-n" : "") + '">' +
      '<defs><marker id="sm-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0 0 L8 4 L0 8 z" class="sm-arr"/></marker></defs>' +
      (narrow ? '<text x="0" y="14" class="sm-col">サイトの中</text>'
              : '<text x="10" y="22" class="sm-col">サイトの中</text><text x="462" y="256" class="sm-col">外のサイト</text>') +
      E.map(function (e) { return edge(e[0], e[1]); }).join("") +
      Object.keys(N).map(box).join("") + "</svg>";
  }

  function mount() {
    var nav = document.querySelector("header nav");
    if (!nav || nav.querySelector(".sm-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "sm-btn"; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "sm-pop");
    btn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5l5-2 6 2 5-2v12l-5 2-6-2-5 2z M7 3v12 M13 5v12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span>地図</span>';
    var pop = document.createElement("div");
    pop.id = "sm-pop"; pop.className = "sm-pop"; pop.hidden = true;
    pop.innerHTML = '<p class="sm-h">サイトの地図<span>押すと、そのページへ移ります</span></p>' + svg();
    nav.appendChild(btn);
    document.body.appendChild(pop);
    function place() {
      var nw = document.documentElement.clientWidth < 640;
      if (nw !== narrow) { narrow = nw; pop.querySelector("svg").outerHTML = svg(); }
      var r = btn.getBoundingClientRect();
      // ヘッダーは上に出し続けるので、ポップはボタンの下に画面固定で置く（スクロールで流れるサイト名の行があるスマホでは、スクロールのたびに置き直す）
      pop.style.top = (r.bottom + 8) + "px";
      if (document.documentElement.clientWidth < 640) { pop.style.left = "8px"; pop.style.right = "8px"; pop.style.width = "auto"; }
      else { pop.style.left = ""; pop.style.width = ""; pop.style.right = Math.max(8, document.documentElement.clientWidth - r.right) + "px"; }
    }
    function close() { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (pop.hidden) { place(); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); } else close();
    });
    document.addEventListener("click", function (ev) { if (!pop.hidden && !pop.contains(ev.target)) close(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") close(); });
    window.addEventListener("resize", function () { if (!pop.hidden) place(); });
    window.addEventListener("scroll", function () { if (!pop.hidden) place(); }, {passive: true});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
