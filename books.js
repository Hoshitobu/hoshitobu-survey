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
  var ALL = '<p class="bk-all"><a href="../../books.html">全科目そろえるなら（パック・出版社ごと）→ 予想問題集の選び方</a></p>';
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
    + ".bk-all{margin:12px 0 0}"
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
        + ALL + '<p class="bk-notice">' + NOTICE + "</p>";
    }
    if (!set.zkai) return "";
    return '<p class="bk-h">次に解くなら：' + PUB.zkai.name + "</p>"
      + "<p>難しめに作られていて、時間内に解ききる練習に向いています。</p><p>" + link(set.zkai) + "</p>"
      + (set.sundai ? "<p>駿台の実戦問題集をまだ解いていないなら、先に駿台で8割に乗せてから使うと、点につながりやすくなります。</p><p>" + link(set.sundai) + "</p>" : "")
      + ALL + '<p class="bk-notice">' + NOTICE + "</p>";
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
    return "<h2>予想問題集</h2>" + '<p class="note">' + LEAD + "</p>" + listHtml(set, true) + ALL + '<p class="bk-notice">' + NOTICE + "</p>";
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

  // 「予想問題集の選び方」のページ（books.html、build_pages.py が枠を書く）：
  //   [data-bl-packs]：全科目1回分のパックを、表紙のタイルで横に3つ（img があれば表紙、なければ色の帯と書名）
  //   [data-bl-subjects]：出版社を切りかえると、科目ごとに1冊（「ほかの出版社」でその科目の残り）。選んだ出版社はこのブラウザに覚える（送らない）
  var PACK = { kawai: ["桃パック", "河合塾", "#d97a93"], sundai: ["青パック", "駿台", "#3d6fb8"], zkai: ["緑パック", "Z会", "#3a9468"] };
  var PACKNOTE = {
    zkai: "Z会とPASSLABOの共同企画で、緑パックを使った解説つきのLIVE配信（12/26・27、参加無料）があります。",
    kawai: "星飛ぶの企画「みんなで解こう 共通テスト」で、1/6（水）に桃パックをみんなで解きます。",
    sundai: "星飛ぶの企画「みんなで解こう 共通テスト」で、1/9（土）に青パックをみんなで解きます（本番1週間前の通し）。"
  };
  var MAINS = [["math1a", "数学Ⅰ・A"], ["math2bc", "数学Ⅱ・B・C"], ["phys", "物理"], ["chem", "化学"], ["bio", "生物"],
               ["phys_basic", "物理基礎"], ["chem_basic", "化学基礎"], ["bio_basic", "生物基礎"], ["earth_basic", "地学基礎"]];
  var OTHERS = [["eng_r", "英語リーディング"], ["eng_l", "英語リスニング"], ["kokugo", "国語"], ["geo", "地理総合，地理探究"],
                ["jhist", "歴史総合，日本史探究"], ["whist", "歴史総合，世界史探究"], ["ethics", "公共，倫理"],
                ["polieco", "公共，政治・経済"], ["info1", "情報Ⅰ"]];
  var KEY = "hoshitobu-books-pub";
  var lcss = ""
    + ".bl-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,170px));gap:16px;margin:10px 0 0;padding:0;list-style:none}"
    + ".bl-tile{display:flex;flex-direction:column;gap:6px;min-width:0}"
    + ".bl-cover{display:flex;flex-direction:column;justify-content:space-between;aspect-ratio:3/4;padding:10px;border:1px solid var(--line);border-radius:6px;"
    + "background:var(--surface-2);color:var(--ink);text-decoration:none;overflow:hidden;border-top-width:8px}"
    + ".bl-cover img{width:100%;height:100%;object-fit:contain}"
    + ".bl-cover.has-img{padding:0;background:var(--surface)}"
    + ".bl-cover b{font-size:clamp(15px,4.2vw,22px);line-height:1.25}"
    + ".bl-cover small{font-size:.78em;color:var(--sub);line-height:1.4;overflow-wrap:anywhere}"
    + ".bl-tile .bl-go{font-size:.88em;margin:0}"
    + ".bl-notes{margin:12px 0 0;padding-left:1.1em;font-size:.9em;color:var(--sub)}.bl-notes li{margin:4px 0}"
    + ".bl-rows{list-style:none;margin:8px 0 0;padding:0}"
    + ".bl-rows > li{display:grid;grid-template-columns:9.5em 1fr auto;gap:2px 16px;align-items:baseline;padding:10px 0;border-top:1px solid var(--line)}"
    + ".bl-rows > li:first-child{border-top:0}"
    + ".bl-s{font-weight:700;color:var(--ink)}"
    + ".bl-t{color:var(--ink);overflow-wrap:anywhere}"
    + ".bl-go{white-space:nowrap;font-size:.9em;margin-left:.6em}"
    + ".bl-alt{display:block;font-size:.82em;color:var(--sub)}"
    + ".bl-more{font:inherit;font-size:.82em;padding:2px 8px;width:auto;background:none;border:1px solid var(--line);border-radius:999px;color:var(--sub);cursor:pointer}"
    + ".bl-more[aria-expanded=true]{color:var(--accent);border-color:var(--accent)}"
    + ".bl-others{grid-column:1 / -1;margin:6px 0 0;padding:6px 0 0 12px;border-left:2px solid var(--line);list-style:none}"
    + ".bl-others li{padding:4px 0}"
    + ".bl-others .bl-p{display:inline-block;min-width:8em;font-size:.85em;color:var(--sub)}"
    + ".bl-seg{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}"
    + ".bl-seg button{font:inherit;width:auto;padding:6px 14px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink);cursor:pointer}"
    + ".bl-seg button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}"
    + ".bl-sep{margin:18px 0 0;padding-top:10px;border-top:1px solid var(--line);font-size:.9em;color:var(--sub);font-weight:700}"
    + "@media (max-width:640px){.bl-tiles{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.bl-cover{padding:7px}.bl-tile .bl-go{font-size:.76em}"
    + ".bl-rows > li{grid-template-columns:1fr auto}.bl-s{grid-column:1 / -1;font-size:.9em}"
    + ".bl-go{display:block;margin:2px 0 0}.bl-others .bl-p{display:block;min-width:0}.bl-more{align-self:end}}"
    + "@media (max-width:359px){.bl-tile .bl-go{white-space:normal}}";

  function getPub() { try { var v = localStorage.getItem(KEY); return ORDER.indexOf(v) >= 0 ? v : "sundai"; } catch (e) { return "sundai"; } }
  function setPub(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function go(u) { return '<a class="bk-go bl-go" href="' + esc(u) + '" target="_blank" rel="sponsored noopener noreferrer">Amazonで見る ↗</a>'; }
  function short(k) { return PUB[k].name.replace(/（.*/, ""); }

  function subjRow(sid, name, pub, B) {
    var set = B[sid]; if (!set) return "";
    var use = set[pub] ? pub : (set.sundai ? "sundai" : ORDER.filter(function (k) { return set[k]; })[0]);
    var alt = use !== pub ? '<span class="bl-alt">' + short(pub) + "の本が無いため" + short(use) + "</span>" : "";
    var others = ORDER.filter(function (k) { return k !== use && set[k]; });
    var id = "bl-o-" + sid;
    return '<li><span class="bl-s">' + esc(name) + '</span><span class="bl-b"><span class="bl-t">' + esc(set[use].title) + "</span>" + go(set[use].url) + alt + "</span>"
      + (others.length ? '<button type="button" class="bl-more" aria-expanded="false" aria-controls="' + id + '">ほかの出版社</button>'
        + '<ul class="bl-others" id="' + id + '" hidden>' + others.map(function (k) {
          return '<li><span class="bl-p">' + PUB[k].name + '</span><span class="bl-t">' + esc(set[k].title) + "</span>" + go(set[k].url) + "</li>";
        }).join("") + "</ul>" : "<span></span>")
      + "</li>";
  }

  function mountList(root, now) {
    var st = document.createElement("style"); st.id = "bl-css"; st.textContent = lcss; document.head.appendChild(st);
    var packBox = root.querySelector("[data-bl-packs]"), subjBox = root.querySelector("[data-bl-subjects]");
    if ((now || new Date()) >= UNTIL) {
      [packBox, subjBox].forEach(function (b) { if (b) b.innerHTML = '<p class="note">' + OFF + "</p>"; });
      [].forEach.call(root.querySelectorAll("[data-bl-notice],[data-bl-cover]"), function (e) { e.hidden = true; });
      return;
    }
    var P = window.HOSHITOBU_PACKS || {}, B = window.HOSHITOBU_BOOKS || {};
    var pk = ORDER.filter(function (k) { return P[k]; });
    if (packBox) packBox.innerHTML = '<ul class="bl-tiles">' + pk.map(function (k) {
      var c = PACK[k], img = P[k].img;
      var cover = img ? '<img src="' + esc(img) + '" alt="' + esc(P[k].title) + 'の表紙" loading="lazy">'
                      : "<b>" + c[0] + "</b><small>" + esc(P[k].title) + "</small>";
      return '<li class="bl-tile"><a class="bl-cover' + (img ? " has-img" : "") + '" style="border-top-color:' + c[2] + '" href="' + esc(P[k].url)
        + '" target="_blank" rel="sponsored noopener noreferrer" aria-label="' + esc(c[0] + "（" + c[1] + "）をAmazonで見る") + '">' + cover + "</a>"
        + '<span class="bl-s">' + (img ? c[0] + "（" + c[1] + "）" : c[1]) + "</span>" + go(P[k].url) + "</li>";
    }).join("") + "</ul>"
      + '<ul class="bl-notes">' + ["zkai", "kawai", "sundai"].filter(function (k) { return P[k]; }).map(function (k) {
        return "<li>" + PACKNOTE[k] + "</li>";
      }).join("") + "</ul>";
    if (!subjBox) return;
    function draw() {
      var pub = getPub();
      [].forEach.call(subjBox.querySelectorAll(".bl-seg button"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.pub === pub)); });
      subjBox.querySelector("[data-bl-main]").innerHTML = MAINS.map(function (s) { return subjRow(s[0], s[1], pub, B); }).join("");
      subjBox.querySelector("[data-bl-other]").innerHTML = OTHERS.map(function (s) { return subjRow(s[0], s[1], pub, B); }).join("");
    }
    subjBox.innerHTML = '<div class="bl-seg" role="group" aria-label="出版社">' + ORDER.map(function (k) {
      return '<button type="button" data-pub="' + k + '" aria-pressed="false">' + PUB[k].name + "</button>";
    }).join("") + "</div>"
      + '<ul class="bl-rows" data-bl-main></ul><p class="bl-sep">ほかの教科</p><ul class="bl-rows" data-bl-other></ul>';
    subjBox.addEventListener("click", function (ev) {
      var b = ev.target.closest(".bl-seg button");
      if (b) { setPub(b.dataset.pub); draw(); return; }
      var m = ev.target.closest(".bl-more");
      if (m) { var open = m.getAttribute("aria-expanded") !== "true"; m.setAttribute("aria-expanded", String(open)); document.getElementById(m.getAttribute("aria-controls")).hidden = !open; }
    });
    draw();
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
    list: function (root, now) { addCss(); mountList(root, now); }
  };
})();
