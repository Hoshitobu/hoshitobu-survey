// 予想問題集（駿台・河合塾・Z会）の紹介リンク。正本は _横断/サイト_紹介リンク/books.js（build_books.py が公開フォルダへ写す）。
// books-data.js（links.json から build_books.py が作る）を先に読み込む。
// 案A：「偏差値を出す」に点数を入れた直後、その帯に合う1〜2冊。平均に届かない帯は本を出さず、過去問を勧める。
// タブ「問題集」：3社を役割つきで並べる。タブと空の欄は build_pages.py が 2024〜2026 の数学・理科のページにだけ書く。
// 出さないところ：1/17（本番の2日め）以降。2021〜2023の数学・理科（センターの許諾で問題PDFを自前で載せているページ）。
(function () {
  var UNTIL = new Date("2027-01-17T00:00:00+09:00");
  var NOTICE = "リンクはAmazonの商品ページに移ります（紹介リンクです）。<br>Amazonのアソシエイトとして、星飛ぶは適格販売により収入を得ています。";
  var SIDS = ["math1a", "math2bc", "phys", "phys_basic", "chem", "chem_basic", "bio", "bio_basic", "earth", "earth_basic"];
  var YEARS = [2024, 2025, 2026];
  var PUB = {
    sundai: { name: "駿台（青本）", why: "本番に近い難しさで、解説が丁寧です。落とした所を直すのに使いやすい本です。" },
    zkai: { name: "Z会（緑本）", why: "難しめに作られていて、時間内に解ききる練習に向いています。駿台で8割に乗ってから使う順がおすすめです。" },
    kawai: { name: "河合塾（黒本）", why: "黒本で7〜8割取れているなら、次は駿台に進むのがおすすめです。" }
  };

  var css = ""
    + ".bk-next{margin:18px 0 0;padding:14px 16px;border-left:3px solid var(--accent);background:var(--surface-2);border-radius:0 var(--radius) var(--radius) 0}"
    + ".bk-next .bk-h{margin:0 0 6px;font-weight:700;color:var(--ink)}"
    + ".bk-next p{margin:0 0 8px}"
    + ".bk-next p:last-child{margin-bottom:0}"
    + ".bk-list{list-style:none;margin:12px 0 0;padding:0}"
    + ".bk-list li{padding:12px 0;border-top:1px solid var(--line)}"
    + ".bk-list li:first-child{border-top:0;padding-top:4px}"
    + ".bk-pub{display:block;font-size:.85em;color:var(--sub);margin-bottom:2px}"
    + ".bk-why{display:block;margin-top:4px;color:var(--sub);font-size:.92em}"
    + ".bk-t{color:var(--ink);overflow-wrap:anywhere}"
    + ".bk-go{display:inline-block;font-size:.88em;white-space:nowrap}"
    + ".bk-list .bk-go{display:block;margin-top:2px}"
    + ".bk-notice{margin:12px 0 0;font-size:.8em;color:var(--faint)}"
    + ".bk-sub{margin:18px 0 0;font-size:1em}"
    + ".card > .bk-sub:first-of-type{margin-top:0}"
    + ".bk-compact li{padding:8px 0;display:flex;flex-wrap:wrap;gap:2px 14px;align-items:baseline}"
    + ".bk-compact .bk-pub{display:inline;margin:0;min-width:7.5em}"
    + ".bk-list.bk-compact .bk-go{display:inline-block;margin:0}"
    + ".tabs4.has5 a{padding:0 4px;font-size:clamp(12px,3.3vw,17px)}";

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function link(b) {
    return '<span class="bk-t">' + esc(b.title) + '</span> <a class="bk-go" href="' + esc(b.url) + '" target="_blank" rel="sponsored noopener noreferrer">Amazonで見る ↗</a>';
  }
  function where(opt) {
    if (opt && opt.sid) return opt;
    var m = location.pathname.match(/\/kyotsu\/(\d{4})\/([a-z0-9_]+)\.html$/);
    return m ? { year: +m[1], sid: m[2] } : null;
  }
  function allowed(w, now) {
    return w && (now || new Date()) < UNTIL && SIDS.indexOf(w.sid) >= 0 && YEARS.indexOf(w.year) >= 0;
  }
  function addCss() {
    if (document.getElementById("bk-css")) return;
    var st = document.createElement("style"); st.id = "bk-css"; st.textContent = css; document.head.appendChild(st);
  }

  // 案A：点数の帯ごとの中身（偏差値で分ける。年度ごとの難しさの差をならすため）
  function nextHtml(dev, set) {
    if (dev < 50) {
      var chips = document.querySelector("#related .chips");
      var other = chips ? [].slice.call(chips.querySelectorAll("a:not([aria-current])")).map(function (a) { return a.outerHTML; }).join(" ") : "";
      return '<p class="bk-h">次は、過去問をもう1年分</p>'
        + "<p>平均点に届かないうちは、予想問題集より先に、ほかの年度の本試験・追試験を解いて、落とした所を直すほうが点につながります。</p>"
        + (other ? '<p class="chips">' + other + "</p>" : "");
    }
    if (dev < 60 || !set.zkai) {   // Z会の本がない科目（物理基礎・地学基礎）は、上の帯も駿台
      if (!set.sundai) return "";
      return '<p class="bk-h">次に解くなら：' + PUB.sundai.name + "</p><p>" + PUB.sundai.why + "</p><p>" + link(set.sundai) + "</p>"
        + '<p class="bk-notice">' + NOTICE + "</p>";
    }
    if (!set.zkai) return "";
    return '<p class="bk-h">次に解くなら：' + PUB.zkai.name + "</p>"
      + "<p>難しめに作られていて、時間内に解ききる練習に向いています。</p><p>" + link(set.zkai) + "</p>"
      + (set.sundai ? "<p>駿台の実戦問題集をまだ解いていないなら、先に駿台で8割に乗せてから使うと、点につながりやすくなります。</p><p>" + link(set.sundai) + "</p>" : "")
      + '<p class="bk-notice">' + NOTICE + "</p>";
  }

  function mountA(w, now) {
    var set = (window.HOSHITOBU_BOOKS || {})[w.sid] || {};
    var box = document.querySelector("[data-dev]"); if (!box) return;
    var input = box.querySelector("input"), mean = +box.dataset.mean, sd = +box.dataset.sd, full = +box.dataset.full;
    var out = document.createElement("div"); out.className = "bk-next"; out.hidden = true; out.setAttribute("aria-live", "polite");
    box.parentNode.insertBefore(out, box.nextSibling);
    function show() {
      var v = input.value.trim(), x = Number(v);
      if (v === "" || !/^\d+$/.test(v) || x > full) { out.hidden = true; out.innerHTML = ""; return; }
      var h = nextHtml(50 + 10 * (x - mean) / sd, set);
      out.innerHTML = h; out.hidden = !h;
    }
    input.addEventListener("input", show); show();
    return out;
  }

  var ORDER = ["kawai", "sundai", "zkai"];   // 黒本で7〜8割 → 駿台 → 駿台で8割に乗ったら Z会
  var LEAD = "過去問を解き終えたあと、初見の通しの練習に使えます。平均点に届かないうちは、先に過去問を解き直すほうが点につながります。";
  var OFF = "2027年用の本の紹介は、本番が終わったので外しました。2028年用の本が出たら差しかえます。";

  function listHtml(set, why) {
    return '<ul class="bk-list' + (why ? "" : " bk-compact") + '">' + ORDER.filter(function (k) { return set[k]; }).map(function (k) {
      return '<li><span class="bk-pub">' + PUB[k].name + "</span>" + link(set[k]) + (why ? '<span class="bk-why">' + PUB[k].why + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  function bodyHtml(set) {
    return "<h2>予想問題集</h2>" + '<p class="note">' + LEAD + "</p>" + listHtml(set, true) + '<p class="bk-notice">' + NOTICE + "</p>";
  }

  // 5つめのタブ「問題集」：タブと空の欄はページ（build_pages.py）が書き、中身はここで入れる。
  // 本が1冊もない科目・1/17 以降は、タブごと隠す（#books で来た人には外した理由を出す）。
  function mountTab(w, now) {
    var sec = document.querySelector("[data-books-tab]"), tab = document.getElementById("t-books");
    if (!sec) return;
    var set = (window.HOSHITOBU_BOOKS || {})[w.sid] || {};
    var ok = allowed(w, now) && ORDER.some(function (k) { return set[k]; });
    sec.innerHTML = ok ? bodyHtml(set) : "<h2>予想問題集</h2><p class=\"note\">" + OFF + "</p>";
    if (tab) { tab.hidden = !ok; tab.style.display = ok ? "" : "none"; }
    var bar = document.querySelector(".tabs4"); if (bar) bar.classList.toggle("has5", ok);
    return sec;
  }

  // 「問題集を選ぶ」のページ：全科目の一覧
  var GROUPS = [
    ["数学", [["math1a", "数学Ⅰ・A"], ["math2bc", "数学Ⅱ・B・C"]]],
    ["理科", [["phys", "物理"], ["chem", "化学"], ["bio", "生物"], ["phys_basic", "物理基礎"], ["chem_basic", "化学基礎"], ["bio_basic", "生物基礎"], ["earth_basic", "地学基礎"]]],
    ["英語", [["eng_r", "リーディング"], ["eng_l", "リスニング"]]],
    ["国語", [["kokugo", "国語"]]],
    ["地理歴史・公民", [["geo", "地理総合，地理探究"], ["jhist", "歴史総合，日本史探究"], ["whist", "歴史総合，世界史探究"], ["ethics", "公共，倫理"], ["polieco", "公共，政治・経済"]]],
    ["情報", [["info1", "情報Ⅰ"]]]
  ];
  function mountList(box, now) {
    var B = window.HOSHITOBU_BOOKS || {};
    if ((now || new Date()) >= UNTIL) { box.innerHTML = '<section class="card"><h2>予想問題集</h2><p class="note">' + OFF + "</p></section>"; return; }
    box.innerHTML = GROUPS.map(function (g) {
      var rows = g[1].filter(function (s) { return B[s[0]]; });
      if (!rows.length) return "";
      return '<section class="card" id="g-' + rows[0][0] + '"><h2>' + g[0] + "</h2>" + rows.map(function (s) {
        return '<h3 class="bk-sub">' + s[1] + "</h3>" + listHtml(B[s[0]], false);
      }).join("") + "</section>";
    }).join("");
  }

  // mode: "A"（点数を入れたあと）・"T"（タブ）の組み合わせ。ページは "AT" で呼ぶ。now は見本で日付を変えて確かめるため。
  window.HoshitobuBooks = {
    mount: function (mode, opt, now) {
      var w = where(opt); addCss();
      var got = [];
      if (mode.indexOf("T") >= 0) got.push(mountTab(w || {}, now));
      if (!allowed(w, now)) return got.filter(Boolean);
      if (mode.indexOf("A") >= 0) got.push(mountA(w, now));
      return got.filter(Boolean);
    },
    list: function (box, now) { addCss(); mountList(box, now); }
  };
})();
