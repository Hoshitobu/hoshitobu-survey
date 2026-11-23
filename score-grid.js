/* 点数のマス目（行＝試験、列＝科目）。入れたマスをまとめて点数集計に送り、サイト内の平均・全国平均を見られる。
 *
 *   <link rel="stylesheet" href="score-grid.css">
 *   <script src="app-config.js"></script>        … window.surveyApi / SURVEY_API_URL（集計サーバーの場所）
 *   <script src="national-stats.js"></script>    … window.NATIONAL_STATS（全国平均。なくても動く）
 *   <script src="score-grid.js"></script>
 *   <div data-score-grid></div>                              … 表と科目を選べる全体のマス目
 *   <div data-score-grid data-books="honshi2025,tsuishi2025" data-subjects="chem"></div>   … 行・列を固定（選ぶ欄は出ない）
 *
 * 属性: data-books=問題集の id（カンマ区切り。行になる。予想問題集は第1回〜の行に展開）/ data-subjects=科目の id（列）/ data-avg="1"|"0"（平均の表示の初期値）
 * JS: ScoreGrid.mount(el, {books, subjects, avg}) / ScoreGrid.refresh()（この端末の「送った記録」を読み直して描き直す）
 * kakomon.html に依存しない。「はじめに」へのリンクは、このスクリプト自身の場所から見た kakomon.html?view=quick。
 */
(function () {
  "use strict";
  var SRC = (document.currentScript && document.currentScript.src) || "";
  function near(path) { try { return new URL(path, SRC || location.href).href; } catch (e) { return path; } }
  var INTRO_URL = near("kakomon.html?view=quick");
  var RESULTS_URL = near("results.html#mine");
  // 類題演習のページを公開したら true にする（false の間は「準備中」の文にする）
  var RUIDAI_PUBLISHED = false;
  var ENSHU_URL = near("enshu/index.html#ruidai");
  function ruidaiLine() {
    var p = document.createElement("p"); p.className = "sg-note sg-ruidai";
    var a = document.createElement("a"); a.href = ENSHU_URL;
    if (RUIDAI_PUBLISHED) { p.append("この年の共通テストの設問が、類題演習で開きました → "); a.textContent = "実践演習へ"; p.append(a); }
    else { p.append("類題演習（準備中）は"); a.textContent = "実践演習のページ"; p.append(a); p.append("から"); }
    return p;
  }

  var CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
  var COOLDOWN = 31;       // 続けて送るときの間隔（秒）。サーバーの既定は30秒
  var MIN_FILL_MS = 3500;  // サーバーは開いてすぐの送信を受け付けない

  // ---- この端末の保存（quick-entry.js と同じキー）
  var P = "hoshitobu-survey:";
  var sget = function (k) { try { return localStorage.getItem(P + k); } catch (e) { return null; } };
  var sset = function (k, v) { try { localStorage.setItem(P + k, v); } catch (e) { /* 保存できなくても使える */ } };
  var lget = function (k) { try { return localStorage.getItem("hoshitobu-link:" + k); } catch (e) { return null; } };

  function newCode() {
    var a = new Uint32Array(6);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return CODE_CHARS[x % CODE_CHARS.length]; }).join("");
  }

  // ---- 集計サーバー
  function apiGet(action) {
    if (window.surveyApi) return window.surveyApi.get(action);
    var url = window.SURVEY_API_URL || "/api";
    return fetch(url + (url.indexOf("?") >= 0 ? "&" : "?") + "action=" + action).then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    if (window.surveyApi) return window.surveyApi.post(body);
    return fetch(window.SURVEY_API_URL || "/api", {
      method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }
  var CFGP = null, STATSP = null;
  function getConfig() {
    if (!CFGP) CFGP = apiGet("config").then(function (c) { if (!c.ok) throw new Error(c.error || "config"); return c; })
      .catch(function (e) { CFGP = null; throw e; });
    return CFGP;
  }
  function getStats(fresh) {
    if (fresh || !STATSP) STATSP = apiGet("stats").then(function (s) { if (!s.ok) throw new Error(s.error || "stats"); return s; })
      .catch(function (e) { STATSP = null; throw e; });
    return STATSP;
  }

  // ---- 科目・問題集の決まり（Code.gs と同じ）
  function maxOf(s, book) { return book && book.max && book.max[s.id] !== undefined ? book.max[s.id] : s.max; }
  function excluded(s, book) { return !!(book && book.exclude && book.exclude.indexOf(s.id) >= 0); }
  var SHORT = {kokugo: "国語", eng_r: "英R", eng_l: "英L", math1a: "IA", math2bc: "IIBC", chem: "化学", bio: "生物", phys: "物理", earth: "地学",
    info1: "情報I", chem_basic: "化基", bio_basic: "生基", phys_basic: "物基", earth_basic: "地基", geo: "地理", jhist: "日本史", whist: "世界史",
    ethics: "倫理", polieco: "政経", chirekikou: "地歴公",
    chiri_b: "地理B", chiri_a: "地理A", nihonshi_b: "日本史B", nihonshi_a: "日本史A", sekaishi_b: "世界史B", sekaishi_a: "世界史A",
    gensha: "現社", rinri: "倫理", seikei: "政経", rinsei: "倫政"};
  // 旧課程の社会（2024年までの共通テスト・センター試験）
  var OLD_SOCIAL = ["chiri_b", "chiri_a", "nihonshi_b", "nihonshi_a", "sekaishi_b", "sekaishi_a", "gensha", "rinri", "seikei", "rinsei"];
  var LABEL_SHORT = {"数学IIB": "IIB", "英語（筆記）": "英R", "英語（リスニング）": "英L"};
  function shortOf(s) { return s.short || SHORT[s.id] || s.name; }
  function rowShort(s, book) {  // その試験だけ呼び名が違う科目（2024以前の数学IIB など）
    var l = book && book.labels && book.labels[s.id];
    return l ? (LABEL_SHORT[l] || l) : shortOf(s);
  }
  var PREF = ["kokugo", "eng_r", "eng_l", "math1a", "math2bc", "info1", "phys", "chem", "bio", "earth", "phys_basic", "chem_basic", "bio_basic",
    "earth_basic", "geo", "jhist", "whist", "ethics", "polieco", "chirekikou"].concat(OLD_SOCIAL);
  // 「枠」の列（選んだ科目が入る列）：理科・社会・理科基礎の解答科目。列の id は "@" + 枠の id
  // 社会は新課程の科目と、2024年までの旧課程の対応科目を1列にまとめる（行ごとに、その試験にある方を使う）
  var SOCIALS = [{id: "geo", old: "chiri_b"}, {id: "jhist", old: "nihonshi_b"}, {id: "whist", old: "sekaishi_b"},
    {id: "ethics", old: "rinri"}, {id: "polieco", old: "seikei"}, {id: "chirekikou", old: null}];
  var SOCIAL_IDS = SOCIALS.map(function (x) { return x.id; });
  var SCI = ["phys", "chem", "bio", "earth"], BASIC = ["phys_basic", "chem_basic", "bio_basic", "earth_basic"];
  var SLOTS = {
    sci1: {label: "理科 第1解答科目", kind: "sci", pair: "sci2", def: "phys", choices: SCI},
    sci2: {label: "理科 第2解答科目", kind: "sci", pair: "sci1", def: "chem", choices: SCI},
    soc: {label: "社会", kind: "soc", pair: null, def: "geo", choices: SOCIAL_IDS},
    soc1: {label: "社会 第1解答科目", kind: "soc", pair: "soc2", def: "geo", choices: SOCIAL_IDS},
    soc2: {label: "社会 第2解答科目", kind: "soc", pair: "soc1", def: "jhist", choices: SOCIAL_IDS},
    bas1: {label: "理科基礎 第1", kind: "bas", pair: "bas2", def: "chem_basic", choices: BASIC},
    bas2: {label: "理科基礎 第2", kind: "bas", pair: "bas1", def: "bio_basic", choices: BASIC},
  };
  function socialDef(id) { return SOCIALS.find(function (x) { return x.id === id; }) || SOCIALS[0]; }
  // その行の試験で実際に使う科目（列がまとめ列なら、あるものの先頭）。なければ null
  function resolveSub(col, book) {
    if (col.merged) return col.merged.filter(Boolean).find(function (x) { return !excluded(x, book); }) || null;
    return excluded(col, book) ? null : col;
  }
  var FIXED = ["kokugo", "eng_r", "eng_l", "math1a", "math2bc", "info1"];
  var PRESETS = [
    {id: "sci", name: "理系", ids: FIXED.concat(["@sci1", "@sci2", "@soc"])},
    {id: "arts", name: "文系", ids: FIXED.concat(["@soc1", "@soc2", "@bas1", "@bas2"])},
    {id: "old", name: "旧課程の社会（2024年まで）", ids: OLD_SOCIAL},
    {id: "custom", name: "自分で選ぶ"},
  ];
  // 前の版で保存された組み合わせ → いまの組み合わせ（理系の理科の選びも引き継ぐ）
  var OLD_PRESETS = {sci2: {preset: "sci", slots: {sci1: "chem", sci2: "bio"}}, arts2: {preset: "arts"}};
  function slotIds(preset) {
    return (preset && preset.ids ? preset.ids : []).filter(function (id) { return id.charAt(0) === "@"; }).map(function (id) { return id.slice(1); });
  }

  // ---- DOM の小道具
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "on") for (var ev in v) el.addEventListener(ev, v[ev]);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function option(value, text) { var o = document.createElement("option"); o.value = value; o.textContent = text; return o; }
  function fmt(x) { return String(Math.round(x * 10) / 10); }

  // ---- 表（行の組）の一覧
  function roundRows(book, long) {
    var out = [];
    for (var n = 1; n <= CFGROUND; n++) out.push({book: book, round: n, label: long ? book.name + " 第" + n + "回" : "第" + n + "回"});
    return out;
  }
  var CFGROUND = 6;
  function buildTables(cfg) {
    var out = [], groups = [];
    cfg.books.forEach(function (b) { if (b.group && b.group !== "予想問題集" && b.group !== "その他" && groups.indexOf(b.group) < 0) groups.push(b.group); });
    groups.forEach(function (g) {
      var rows = [];
      cfg.books.filter(function (b) { return b.group === g; }).forEach(function (b) {
        if (b.roundCount && b.rounds !== "none") {   // 模試：回ごとに1行（河合 全統共通テスト模試 第1回 …）
          for (var n = 1; n <= b.roundCount; n++) rows.push({book: b, round: n, label: (b.short || b.name) + " 第" + n + "回"});
        } else {
          rows.push({book: b, round: null, label: b.short || b.name});
        }
      });
      out.push({id: "g:" + g, label: g, group: "", rows: rows});
    });
    cfg.books.filter(function (b) { return b.group === "予想問題集"; }).forEach(function (b) {
      out.push({id: "b:" + b.id, label: b.name, group: "予想問題集", rows: roundRows(b, false)});
    });
    return out;
  }
  function rowsForIds(cfg, ids) {
    var rows = [];
    ids.forEach(function (id) {
      var b = cfg.books.find(function (x) { return x.id === id; });
      if (!b) return;
      if (b.rounds === "required") rows = rows.concat(roundRows(b, true));
      else rows.push({book: b, round: null, label: b.name});
    });
    return rows;
  }

  // ---- この端末の「送った記録」
  function readMine() { try { return JSON.parse(sget("mine") || "[]"); } catch (e) { return []; } }
  function mineKey(subjectName, bookName, round) { return subjectName + "|" + bookName + "|" + (round || ""); }
  function mineMap() {
    var m = {};
    readMine().forEach(function (r) {
      if (r && r.kind === "practice") m[mineKey(r.subject, r.book, r.round)] = r.score;
    });
    return m;
  }
  function saveMine(cells) {
    var mine = readMine(), at = new Date().toISOString();
    var keys = {};
    cells.forEach(function (c) { keys[mineKey(c.subject.name, c.book.name, c.round)] = true; });
    mine = mine.filter(function (r) { return !(r && r.kind === "practice" && keys[mineKey(r.subject, r.book, r.round)]); });  // 上書きは1件にまとめる
    cells.forEach(function (c) {
      mine.push({kind: "practice", subject: c.subject.name, book: c.book.name, round: c.round === null ? null : c.round, score: c.score, at: at, sections: null});
    });
    sset("mine", JSON.stringify(mine.slice(-300)));
  }

  // ---- 集計の平均
  function statsCell(stats, subjectName, bookName, round) {
    return (stats.practice || []).find(function (c) {
      return c.subject === subjectName && c.book === bookName && (c.round === null ? !round : c.round === round);
    }) || null;
  }
  function siteText(stats, c) {
    if (!stats) return null;
    var cell = statsCell(stats, c.subject.name, c.book.name, c.round);
    return cell && cell.mean !== null && cell.mean !== undefined ? {mean: cell.mean, n: cell.n} : {mean: null};
  }
  function natMean(c) {
    var n = window.NATIONAL_STATS && window.NATIONAL_STATS[c.book.name] && window.NATIONAL_STATS[c.book.name][c.subject.name];
    return n && typeof n.mean === "number" ? n.mean : null;
  }
  // 全国の平均点・標準偏差からの偏差値（本試験だけ）。60以上をお祝いする
  var GREAT = 60, SUPER = 70;
  function natDev(c, score) {
    var n = window.NATIONAL_STATS && window.NATIONAL_STATS[c.book.name] && window.NATIONAL_STATS[c.book.name][c.subject.name];
    if (!n || typeof n.mean !== "number" || !(n.sd > 0) || score === "" || score === null || isNaN(+score)) return null;
    return 50 + 10 * (+score - n.mean) / n.sd;
  }

  // ---- 目標の得点率（%）・全国偏差値での色づけ（この端末の保存）
  function goalRead() { var n = parseFloat(sget("grid-goal")); return n > 0 && n <= 100 ? n : 0; }
  // 全国偏差値を5段階に（0〜4）。全国の平均・標準偏差がない試験は null
  function devStep(dev) { return dev === null ? null : dev < 45 ? 0 : dev < 50 ? 1 : dev < 55 ? 2 : dev < 60 ? 3 : 4; }
  // ---- 共通テスト過去問の「解く」リンク（kakomon.html のときだけ。KAKOMON_EXAMS が無ければ出さない）
  var EXAM_IDX = null;
  function examId(bookId, subjectId) {
    var L = window.KAKOMON_EXAMS;
    if (!Array.isArray(L)) return null;
    if (!EXAM_IDX || EXAM_IDX.n !== L.length) {
      EXAM_IDX = {n: L.length, m: {}};
      L.forEach(function (e) {
        var sv = e && e.survey;
        if (sv && sv.bookId && sv.subjectId) { var k = sv.bookId + "|" + sv.subjectId; if (!(k in EXAM_IDX.m)) EXAM_IDX.m[k] = e.id; }
      });
    }
    return EXAM_IDX.m[bookId + "|" + subjectId] || null;
  }
  function solveHref(eid) { return near("kakomon.html?exam=" + encodeURIComponent(eid)); }

  // ---- 得点調整のあった試験（kakomon/kakomon-adjust.js の window.KAKOMON_ADJUST。なければ何も出さない）
  // 注記の文は項目ごと（各項目の text）。同じ文は1回だけ出す
  function adjTexts() {
    var A = window.KAKOMON_ADJUST, out = {};
    if (!A) return out;
    Object.keys(A).forEach(function (id) {
      var a = A[id];
      if (a && a.bookId && a.subjectId && a.text) out[a.bookId + "|" + a.subjectId] = a.text;
    });
    return out;
  }
  function adjText(book, subject) { return (book && subject && adjTexts()[book.id + "|" + subject.id]) || ""; }
  function isAdj(book, subject) { return !!adjText(book, subject); }
  function addText(list, t) { if (t && list.indexOf(t) < 0) list.push(t); }
  function adjNoteEls(list) { return list.map(function (t) { return h("p", {class: "sg-note sg-adjnote", text: t}); }); }

  var instances = [];

  function mount(el, opts) {
    opts = opts || {};
    var ds = el.dataset || {};
    var split = function (s) { return s ? String(s).split(",").map(function (x) { return x.trim(); }).filter(Boolean) : null; };
    var fixedBooks = opts.books || split(ds.books), fixedSubjects = opts.subjects || split(ds.subjects);
    var embedded = !!(fixedBooks || fixedSubjects);
    var avgDefault = opts.avg !== undefined ? !!opts.avg : ds.avg !== undefined ? ds.avg === "1" : embedded;
    var openedAt = performance.now();
    var S = {cfg: null, tables: [], table: null, preset: "sci", slots: {}, custom: [], drafts: {}, avgOn: avgDefault, stats: null, busy: false, tint: true};
    var ui = {};

    el.classList.add("sg");
    el.textContent = "";
    el.append(h("p", {class: "sg-note", text: "読み込み中…"}));

    function build(cfg) {
      S.cfg = cfg; CFGROUND = cfg.roundMax || 6;
      S.tables = buildTables(cfg);
      var savedAvg = sget("grid-avg");
      if (!embedded && opts.avg === undefined && ds.avg === undefined && (savedAvg === "1" || savedAvg === "0")) S.avgOn = savedAvg === "1";
      S.tint = sget("grid-dev") !== "0";
      var t = sget("grid-table");
      S.table = S.tables.find(function (x) { return x.id === t; }) || S.tables[0];
      var pr = sget("grid-subjects"), saved = {};
      try { saved = JSON.parse(sget("grid-slots") || "{}") || {}; } catch (e) { saved = {}; }
      if (typeof saved !== "object" || Array.isArray(saved)) saved = {};
      var oldP = OLD_PRESETS[pr];
      if (oldP) {   // 前の版の組み合わせ：理系・文系にまとめ、理科の選びは引き継ぐ
        pr = oldP.preset; sset("grid-subjects", pr);
        if (oldP.slots && !saved.sci1 && !saved.sci2) saved = Object.assign({}, saved, oldP.slots);
      }
      S.preset = PRESETS.some(function (x) { return x.id === pr; }) ? pr : "sci";
      var oldSoc = sget("grid-social");
      if (!saved.soc && oldSoc) saved.soc = oldSoc;
      Object.keys(SLOTS).forEach(function (k) {
        var d = SLOTS[k], v = saved[k];
        S.slots[k] = d.choices.indexOf(v) >= 0 && S.cfg.subjects.some(function (x) { return x.id === v; }) ? v : d.def;
      });
      Object.keys(SLOTS).forEach(function (k) {   // 組の2つが同じ科目なら、2つめを既定に戻す（それも同じなら別の科目に）
        var d = SLOTS[k];
        if (d.pair && k > d.pair && S.slots[k] === S.slots[d.pair]) {
          S.slots[k] = d.def !== S.slots[d.pair] ? d.def : d.choices.filter(function (c) { return c !== S.slots[d.pair]; })[0];
        }
      });
      try { S.custom = JSON.parse(sget("grid-custom") || "[]"); } catch (e) { S.custom = []; }
      if (!Array.isArray(S.custom)) S.custom = [];
      el.textContent = "";
      layout();
      renderGrid();
      loadStats();
    }

    // ---- 列（科目）・行
    function subjectList() {
      var all = S.cfg.subjects, byId = function (id) { return all.find(function (s) { return s.id === id; }); };
      var ids;
      if (fixedSubjects) ids = fixedSubjects;
      else if (S.preset === "custom") ids = S.custom.slice().sort(function (a, b) { return PREF.indexOf(a) - PREF.indexOf(b); });
      else ids = PRESETS.find(function (p) { return p.id === S.preset; }).ids;
      return ids.map(function (id) {
        if (id.charAt(0) !== "@") return byId(id);
        var k = id.slice(1), d = SLOTS[k], nw = d && byId(S.slots[k]);
        if (!nw) return null;
        if (d.kind !== "soc") return nw;   // 理科・理科基礎は、年が変わっても同じ科目の id
        var sd = socialDef(nw.id), od = sd.old ? byId(sd.old) : null;
        return Object.assign({}, nw, {id: id, short: SHORT[nw.id], merged: [nw, od]});
      }).filter(Boolean);
    }
    function presetSlots() {
      return fixedSubjects ? [] : slotIds(PRESETS.find(function (x) { return x.id === S.preset; }));
    }
    // 選んだ科目の欄（いまの組み合わせにある枠だけ）。組の2つに同じ科目は選べない（選ぶと相手と入れ替わる）
    function renderSlots() {
      if (!ui.slots) return;
      var ids = presetSlots();
      ui.slots.textContent = ""; ui.slots.hidden = !ids.length; ui.slotSel = {};
      ids.forEach(function (k) {
        var d = SLOTS[k], sel = h("select", {"aria-label": d.label, "data-slot": k});
        d.choices.forEach(function (sid) {
          var sj = S.cfg.subjects.find(function (x) { return x.id === sid; });
          if (sj) sel.append(option(sid, sj.name));
        });
        sel.value = S.slots[k];
        sel.addEventListener("change", function () {
          var v = sel.value;
          if (d.pair && S.slots[d.pair] === v) S.slots[d.pair] = S.slots[k];
          S.slots[k] = v;
          sset("grid-slots", JSON.stringify(S.slots));
          ids.forEach(function (x) { ui.slotSel[x].value = S.slots[x]; });
          clearResult(); renderGrid();
        });
        ui.slotSel[k] = sel;
        ui.slots.append(field(d.label, sel));
      });
    }
    function rowList() { return fixedBooks ? rowsForIds(S.cfg, fixedBooks) : S.table.rows; }
    function cellKey(row, s) { return row.book.id + "|" + (row.round || "") + "|" + s.id; }

    // ---- 画面の骨組み
    function layout() {
      var ctl = h("div", {class: "sg-ctl"});
      if (!fixedBooks) {
        ui.table = h("select", {"aria-label": "表"});
        var gOther = h("optgroup", {label: "予想問題集"});
        S.tables.forEach(function (t) { (t.group ? gOther : ui.table).append(option(t.id, t.label)); });
        if (gOther.children.length) ui.table.append(gOther);
        ui.table.value = S.table.id;
        ui.table.addEventListener("change", function () {
          S.table = S.tables.find(function (x) { return x.id === ui.table.value; }) || S.tables[0];
          sset("grid-table", S.table.id); clearResult(); renderGrid();
        });
        ctl.append(field("表", ui.table));
      }
      if (!fixedSubjects) {
        ui.subj = h("select", {"aria-label": "科目"});
        PRESETS.forEach(function (p) { ui.subj.append(option(p.id, p.name)); });
        ui.subj.value = S.preset;
        ui.subj.addEventListener("change", function () {
          var prev = PRESETS.find(function (p) { return p.id === S.preset; });
          S.preset = ui.subj.value; sset("grid-subjects", S.preset);
          if (S.preset === "custom" && !S.custom.length && prev && prev.ids) {  // はじめて「自分で選ぶ」にしたときは、直前の組み合わせから始める
            S.custom = prev.ids.map(function (id) { return id.charAt(0) === "@" ? S.slots[id.slice(1)] : id; })
              .filter(function (id) { return S.cfg.subjects.some(function (x) { return x.id === id; }); });
            sset("grid-custom", JSON.stringify(S.custom));
            [].forEach.call(ui.custom.querySelectorAll("input"), function (x) { x.checked = S.custom.indexOf(x.value) >= 0; });
          }
          ui.custom.hidden = S.preset !== "custom"; renderSlots(); clearResult(); renderGrid();
        });
        ctl.append(field("科目", ui.subj));
        ui.slots = h("div", {class: "sg-slots"});
        ctl.append(ui.slots);
        renderSlots();
      }
      ui.avg = h("label", {class: "sg-chk"}, h("input", {type: "checkbox"}), h("span", {text: "平均点を出す"}));
      ui.avg.firstChild.checked = S.avgOn;
      ui.avg.firstChild.addEventListener("change", function () {
        S.avgOn = ui.avg.firstChild.checked; if (!embedded) sset("grid-avg", S.avgOn ? "1" : "0"); renderGrid();
      });
      ctl.append(ui.avg);
      if (!embedded) {
        ui.goal = h("input", {type: "number", min: 1, max: 100, step: 1, inputmode: "numeric", class: "sg-goal-in", placeholder: "例 80", "aria-label": "目標の得点率（%）"});
        var g0 = goalRead(); if (g0) ui.goal.value = String(g0);
        ui.goal.addEventListener("input", function () {
          var n = parseFloat(ui.goal.value);
          sset("grid-goal", n > 0 && n <= 100 ? String(n) : "");
          ui.goal.classList.toggle("is-bad", ui.goal.value.trim() !== "" && !(n > 0 && n <= 100));
          renderGrid();
        });
        ctl.append(h("label", {class: "sg-goal"}, h("span", {text: "目標の得点率"}), ui.goal, h("span", {text: "%"})));
        ui.tint = h("label", {class: "sg-chk"}, h("input", {type: "checkbox"}), h("span", {text: "全国偏差値で色をつける"}));
        ui.tint.firstChild.checked = S.tint;
        ui.tint.firstChild.addEventListener("change", function () { S.tint = ui.tint.firstChild.checked; sset("grid-dev", S.tint ? "1" : "0"); renderGrid(); });
        ctl.append(ui.tint);
      }
      el.append(ctl);

      ui.custom = h("div", {class: "sg-custom", hidden: S.preset !== "custom" || !!fixedSubjects});
      PREF.forEach(function (id) {
        var s = S.cfg.subjects.find(function (x) { return x.id === id; });
        if (!s) return;
        if (id === OLD_SOCIAL[0]) ui.custom.append(h("div", {class: "sg-custom-h", text: "旧課程の社会（2024年まで）"}));
        var cb = h("input", {type: "checkbox", value: id});
        cb.checked = S.custom.indexOf(id) >= 0;
        cb.addEventListener("change", function () {
          S.custom = [].slice.call(ui.custom.querySelectorAll("input")).filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
          sset("grid-custom", JSON.stringify(S.custom)); clearResult(); renderGrid();
        });
        ui.custom.append(h("label", {class: "sg-chk"}, cb, h("span", {text: s.name})));
      });
      el.append(ui.custom);

      if (!embedded) { ui.power = h("section", {class: "sg-power", "aria-label": "いまの実力"}); el.append(ui.power); }
      ui.scroll = h("div", {class: "sg-scroll", tabindex: "-1"});
      el.append(ui.scroll);

      ui.msg = h("div", {class: "sg-msg", role: "alert"});
      ui.status = h("div", {class: "sg-status", "aria-live": "polite"});
      ui.send = h("button", {type: "button", class: "sg-btn", on: {click: send}}, "入れたマスをまとめて送る");
      el.append(h("div", {class: "sg-actions"}, ui.send, ui.status), ui.msg);

      el.append(profileBox());
      ui.result = h("div", {class: "sg-result", hidden: true});
      el.append(ui.result);
    }
    function field(label, control) {
      return h("label", {class: "sg-f"}, h("span", {text: label}), h("div", {class: "sg-sel"}, control));
    }

    // ---- 送る人の情報（登録ずみならたたむ）
    function profileBox() {
      var cfg = S.cfg;
      var code = sget("code") || lget("code") || "";
      if (!CODE_RE.test(code)) code = newCode();
      sset("code", code);
      ui.code = code;
      var band = sget("band") || lget("band") || "";
      var consent = sget("consent") === "1" || lget("consent") === "1";
      ui.consent = h("input", {type: "checkbox"}); ui.consent.checked = consent;
      ui.band = h("select", {"aria-label": "学力帯"}, option("", "選んでください"));
      cfg.bands.forEach(function (b) { ui.band.append(option(b.id, b.label)); });
      ui.band.value = band;
      var nick = sget("nickname"); if (nick === null) nick = lget("nickname") || "";
      ui.nick = h("input", {type: "text", maxlength: cfg.nickname.maxLength, autocomplete: "off", placeholder: "例: ほしのこ", "aria-label": "ニックネーム"});
      ui.nick.value = nick;
      var rk = sget("ranking"); if (rk === null) rk = lget("ranking");
      ui.rank = h("input", {type: "checkbox"}); ui.rank.checked = rk === "1";
      ui.pass = cfg.passphraseRequired ? h("input", {type: "text", autocomplete: "off", "aria-label": "合言葉"}) : null;
      if (ui.pass) ui.pass.value = sget("passphrase") || "";
      ui.hp = h("input", {tabindex: "-1", autocomplete: "off", "aria-hidden": "true"});
      ui.codeView = h("span", {class: "sg-code", text: code});
      ui.codeIn = h("input", {type: "text", maxlength: 6, autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "6文字", "aria-label": "前に発行されたコード"});
      ui.codeWrap = h("div", {class: "sg-codein", hidden: true}, ui.codeIn,
        h("button", {type: "button", class: "sg-link", on: {click: function () {
          var v = ui.codeIn.value.trim().toUpperCase();
          if (!CODE_RE.test(v)) { ui.msg.textContent = "回答者コードは6文字の英数字です（0・O・1・I は使われていません）"; return; }
          ui.msg.textContent = ""; ui.code = v; sset("code", v); ui.codeView.textContent = v; ui.codeWrap.hidden = true; sumUp();
        }}}, "このコードを使う"));
      ui.copy = h("button", {type: "button", class: "sg-link", on: {click: function () {
        var done = function (t) { ui.copy.textContent = t; };
        try { navigator.clipboard.writeText(ui.code).then(function () { done("コピーしました"); }, function () { done("長押しでコピーしてください"); }); }
        catch (e) { done("長押しでコピーしてください"); }
      }}}, "コピー");
      ui.sum = h("span", {class: "sg-sum"});
      var save = function () {
        sset("consent", ui.consent.checked ? "1" : ""); sset("band", ui.band.value); sset("nickname", ui.nick.value.trim());
        sset("ranking", ui.rank.checked ? "1" : ""); if (ui.pass) sset("passphrase", ui.pass.value); sumUp();
      };
      [ui.consent, ui.band, ui.nick, ui.rank, ui.pass].forEach(function (x) { if (x) x.addEventListener("change", save); });

      var consentLine = h("label", {class: "sg-chk sg-consent"}, ui.consent,
        h("span", null, "回答は匿名で集計し、YouTube『星飛ぶ』の動画で使用します。名前・学校名などの個人情報は入力しないでください（同意する）。",
          h("a", {href: INTRO_URL, text: "くわしく"})));
      ui.prof = h("details", {class: "sg-prof"},
        h("summary", null, h("span", {text: "送る人の情報"}), ui.sum),
        h("div", {class: "sg-prof-body"},
          consentLine,
          h("div", {class: "sg-two"},
            h("label", {class: "sg-f"}, h("span", {text: "学力帯（直近の模試の偏差値）"}), h("div", {class: "sg-sel"}, ui.band)),
            h("label", {class: "sg-f"}, h("span", {text: "ニックネーム（" + cfg.nickname.maxLength + "文字まで・" + (cfg.nickname.required ? "必須" : "任意") + "）"}), ui.nick)),
          h("label", {class: "sg-chk"}, ui.rank, h("span", {text: "80点以上（100点満点のとき。得点率80%以上）なら、ニックネームを集計ページのランキングに載せる"})),
          ui.pass ? h("label", {class: "sg-f"}, h("span", {text: "合言葉"}), ui.pass) : null,
          h("div", {class: "sg-codeline"}, h("span", {class: "sg-k", text: "回答者コード"}), ui.codeView, ui.copy,
            h("button", {type: "button", class: "sg-link", on: {click: function () { ui.codeWrap.hidden = !ui.codeWrap.hidden; }}}, "別のコードを入力")),
          ui.codeWrap,
          h("div", {class: "sg-hp", "aria-hidden": "true"}, h("label", null, "Webサイト", ui.hp))));
      sumUp();
      ui.prof.open = !(consent && band);
      return ui.prof;
    }
    function sumUp() {
      var b = S.cfg.bands.find(function (x) { return x.id === ui.band.value; });
      ui.sum.textContent = (ui.consent.checked && b ? "学力帯 " + b.label : "未設定") + "・コード " + ui.code;
    }

    // ---- マス目
    function renderGrid() {
      var left = ui.scroll.scrollLeft, top = ui.scroll.scrollTop;
      var subs = subjectList(), rows = rowList(), mine = mineMap();
      renderPower(subs, rows, mine);
      ui.scroll.textContent = "";
      if (!subs.length) { ui.scroll.append(h("p", {class: "sg-note", text: "科目を選んでください。"})); updateCount(); return; }
      var showTotal = !embedded, goal = goalRead(), anyNat = false, anyAdj = [];
      var head = h("tr", null, h("th", {class: "sg-rh", scope: "col"}));
      subs.forEach(function (s) { head.append(h("th", {scope: "col", title: s.name, text: shortOf(s)})); });
      if (showTotal) head.append(h("th", {scope: "col", class: "sg-tot", text: "合計"}));
      var body = h("tbody");
      rows.forEach(function (row) {
        var tr = h("tr", null, h("th", {class: "sg-rh", scope: "row", text: row.label}));
        var sum = 0, mxAll = 0, mxSent = 0, n = 0, got = 0, devs = [], devAll = true;
        subs.forEach(function (col) {
          var td = h("td"), s = resolveSub(col, row.book);
          if (!s) {
            td.append(h("div", {class: "sg-cell sg-na"}, h("input", {class: "sg-in", disabled: true, "aria-label": row.label + " " + col.name + "（この試験にはありません）"})));
          } else {
            var k = cellKey(row, s), sent = mine[mineKey(s.name, row.book.name, row.round)], mx = maxOf(s, row.book);
            n++; mxAll += mx;
            if (sent !== undefined) {
              got++; sum += sent; mxSent += mx;
              var dv = natDev({book: row.book, subject: s}, sent);
              if (dv !== null) devs.push(dv); else devAll = false;
            } else devAll = false;
            var val = S.drafts[k] !== undefined ? S.drafts[k] : sent !== undefined ? String(sent) : "";
            var tag = col.merged ? (s !== col.merged[0] ? h("span", {class: "sg-tag", text: shortOf(s)}) : null) : rowShort(s, row.book) !== shortOf(s) ? h("span", {class: "sg-tag", text: rowShort(s, row.book)}) : null;
            var input = h("input", {class: "sg-in", type: "number", min: 0, max: mx, step: 1, inputmode: "numeric",
              placeholder: String(mx), "aria-label": row.label + " " + s.name + "（" + mx + "点満点）", "data-k": k});
            input.value = val;
            if (sent !== undefined) { input.readOnly = true; input.title = "送った点数"; }  // 集計は最初に送った点数だけを数えるので、送ったマスは書き換えない
            input._cell = {row: row, subject: s, key: k, sent: sent, goal: goal};
            input.addEventListener("input", function () { S.drafts[k] = input.value.trim(); mark(input); updateCount(); });
            mark(input);
            var eid = row.round ? null : examId(row.book.id, s.id);
            var adjT = sent !== undefined ? adjText(row.book, s) : "";
            var adjMark = adjT ? (addText(anyAdj, adjT), h("span", {class: "sg-adj", title: adjT, text: "調整"})) : null;
            var solve = eid ? h("a", {class: "sg-solve", href: solveHref(eid), title: row.label + " " + s.name + "を解く", text: "解く"}) : null;
            td.append(h("div", {class: "sg-cell"}, input, tag, adjMark, solve, S.avgOn && sent !== undefined ? h("div", {class: "sg-avg", "data-avg": k}) : null));
          }
          tr.append(td);
        });
        if (showTotal) {
          var tot = h("td", {class: "sg-tot"});
          if (n) {
            var done = got === n;
            tot.append(h("div", {class: "sg-tot-n" + (done ? " is-done" : ""), text: sum + " / " + mxAll}));
            if (got && n === got && devAll && devs.length) {
              anyNat = true;
              tot.append(h("div", {class: "sg-tot-s", title: "この行の各科目の全国偏差値の平均", text: "平均偏差値 " + (devs.reduce(function (a, b) { return a + b; }, 0) / devs.length).toFixed(1)}));
            }
            if (goal && got) {
              var rate = Math.round(100 * sum / mxSent);
              tot.append(h("div", {class: "sg-tot-s" + (100 * sum / mxSent >= goal ? " is-goal" : ""), text: rate + "% / 目標" + fmt(goal) + "%"}));
            }
          }
          tr.append(tot);
        }
        body.append(tr);
      });
      ui.scroll.append(h("table", {class: "sg-table" + (S.tint ? " is-tint" : "")}, h("thead", null, head), body));
      adjNoteEls(anyAdj).forEach(function (el) { ui.scroll.append(el); });
      if (!embedded && S.tint) {
        var lg = h("div", {class: "sg-legend", "aria-label": "全国偏差値の色"}, h("span", {class: "sg-lg-t", text: "全国偏差値"}));
        ["〜45", "45〜", "50〜", "55〜", "60〜"].forEach(function (t, i) {
          lg.append(h("span", {class: "sg-lg-i"}, h("i", {class: "sg-dv" + i}), t));
        });
        ui.scroll.append(lg);
      }
      ui.scroll.scrollLeft = left; ui.scroll.scrollTop = top;
      fillAvg(); updateCount();
    }
    // ---- いまの実力（全体のマス目だけ）：進み具合の円グラフと、本番予想点数
    function donut(done, total) {
      var NS = "http://www.w3.org/2000/svg", R = 52, C = 2 * Math.PI * R;
      function se(tag, a) { var x = document.createElementNS(NS, tag); for (var k in a) x.setAttribute(k, a[k]); return x; }
      var svg = se("svg", {viewBox: "0 0 120 120", width: 120, height: 120, class: "sg-donut", role: "img", "aria-label": done + " / " + total});
      svg.append(se("circle", {cx: 60, cy: 60, r: R, fill: "none", "stroke-width": 10, class: "sg-d-track"}));
      if (total > 0 && done > 0) {
        svg.append(se("circle", {cx: 60, cy: 60, r: R, fill: "none", "stroke-width": 10, class: "sg-d-fill", transform: "rotate(-90 60 60)",
          "stroke-dasharray": (C * done / total).toFixed(2) + " " + C.toFixed(2)}));
      }
      var tx = se("text", {x: 60, y: 60, "text-anchor": "middle", "dominant-baseline": "central", class: "sg-d-num"});
      tx.textContent = done + " / " + total;
      svg.append(tx);
      return svg;
    }
    function natRef(s) {  // その科目の全国平均・標準偏差がある、いちばん新しい年の本試験
      var ns = window.NATIONAL_STATS || {}, keys = Object.keys(ns).filter(function (k) { return /^\d{4}/.test(k); })
        .sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
      for (var i = 0; i < keys.length; i++) {
        var n = ns[keys[i]][s.name];
        if (n && typeof n.mean === "number" && n.sd > 0) return {key: keys[i], year: parseInt(keys[i], 10), mean: n.mean, sd: n.sd};
      }
      return null;
    }
    function predictFor(s, entries) {
      var ns = window.NATIONAL_STATS || {}, att = [], adjUsed = [];
      var variants = s.merged ? s.merged.filter(Boolean) : [s];  // 社会の列は、新旧どちらの科目で解いた記録も合わせる
      entries.forEach(function (r) {
        var sub = variants.find(function (x) { return x.name === r.subject; });
        var n = sub && ns[r.book] && ns[r.book][sub.name];
        var bk = S.cfg.books.find(function (b) { return b.name === r.book; });
        if (sub && bk) addText(adjUsed, adjText(bk, sub));
        if (!sub || !n || typeof n.mean !== "number" || !(n.sd > 0) || typeof r.score !== "number" || isNaN(r.score)) return;
        att.push({dev: 50 + 10 * (r.score - n.mean) / n.sd, at: String(r.at || "")});
      });
      if (!att.length) return null;
      att.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
      att = att.slice(0, 5);
      var w = 0, sum = 0;
      att.forEach(function (a, i) { var wt = 5 - i; w += wt; sum += wt * a.dev; });
      var dev = sum / w, ref = natRef(s.merged ? s.merged[0] : s);
      if (!ref) return null;
      var pred = Math.round(ref.mean + ref.sd * (dev - 50) / 10);
      return {dev: dev, adj: adjUsed, n: att.length, ref: ref, score: Math.max(0, Math.min(s.max, pred))};
    }
    // 次に解く1回：予想偏差値がいちばん低い科目（まだ解いていない科目があればそちら）の、未提出の本試験でいちばん新しい年
    function nextPick(subs, preds, mine) {
      var books = S.cfg.books.filter(function (b) { return /^honshi\d{4}$/.test(b.id); })
        .sort(function (a, b) { return parseInt(b.id.slice(6), 10) - parseInt(a.id.slice(6), 10); });
      var need = Array.isArray(window.KAKOMON_EXAMS), cands = [];
      preds.forEach(function (x) {
        for (var i = 0; i < books.length; i++) {
          var b = books[i], a = resolveSub(x.s, b);
          if (!a || mine[mineKey(a.name, b.name, null)] !== undefined) continue;
          var eid = examId(b.id, a.id);
          if (need && !eid) continue;
          cands.push({s: a, b: b, eid: eid, dev: x.p ? x.p.dev : -1});
          return;
        }
      });
      if (!cands.length) return null;
      cands.sort(function (a, b) { return a.dev - b.dev; });  // まだ解いていない科目（-1）が先頭。同じなら列の順
      return cands[0];
    }
    function renderPower(subs, rows, mine) {
      if (!ui.power) return;
      var box = ui.power; box.textContent = "";
      var done = 0, total = 0, per = [];
      subs.forEach(function (s) {
        var d = 0, t = 0;
        rows.forEach(function (row) {
          var a = resolveSub(s, row.book);
          if (!a) return;
          t++; if (mine[mineKey(a.name, row.book.name, row.round)] !== undefined) d++;
        });
        if (t) per.push({s: s, d: d, t: t});
        done += d; total += t;
      });
      var list = h("ul", {class: "sg-pw-list"});
      per.forEach(function (p) {
        var bar = h("span", {class: "sg-pw-bar", "aria-hidden": "true"}, h("i", {style: "width:" + (100 * p.d / p.t).toFixed(1) + "%"}));
        list.append(h("li", null, h("span", {class: "sg-pw-s", title: p.s.name, text: shortOf(p.s)}), bar, h("span", {class: "sg-pw-c", text: p.d + "/" + p.t})));
      });
      var prog = h("div", {class: "sg-pw-prog"},
        h("div", {class: "sg-pw-dn"}, donut(done, total), h("p", {class: "sg-pw-cap", text: (S.table ? S.table.label : "") + " " + total + "回分のうち" + done + "回分"})),
        list);

      var entries = readMine().filter(function (r) { return r && r.kind === "practice"; });
      var preds = subs.map(function (s) { return {s: s, p: predictFor(s, entries)}; });
      var any = preds.filter(function (x) { return x.p; });
      var pl = h("ul", {class: "sg-pw-list sg-pw-pl"});
      preds.forEach(function (x) {
        var detail = x.p ? "（偏差値 " + x.p.dev.toFixed(1) + "、" + x.p.n + "回分から" + (x.p.ref.key !== "2026本試" ? "、" + x.p.ref.year + "年基準" : "") + "）" : "";
        pl.append(h("li", null, h("span", {class: "sg-pw-s", title: x.s.name, text: shortOf(x.s)}),
          h("span", {class: "sg-pw-v" + (x.p ? "" : " is-none"), text: x.p ? "予想 " + x.p.score + "点" : "—"}),
          h("span", {class: "sg-pw-d", text: detail})));
      });
      var pred = h("div", {class: "sg-pw-pred"}, h("p", {class: "sg-pw-t2", text: "本番予想点数（目安）"}), pl);
      if (any.length) {
        var tot = any.reduce(function (a, x) { return a + x.p.score; }, 0), mx = any.reduce(function (a, x) { return a + x.s.max; }, 0);
        pred.append(h("p", {class: "sg-pw-sum", text: "合計 " + tot + "点 ／ " + mx + "点満点（" + any.length + "科目）"}),
          h("p", {class: "sg-note", text: "過去問（本試験）の全国偏差値から、2026年の本試験と同じ平均点・散らばりだった場合の点数を出しています。"}));
        var predAdj = []; any.forEach(function (x) { x.p.adj.forEach(function (t) { addText(predAdj, t); }); });
        adjNoteEls(predAdj).forEach(function (el) { pred.append(el); });
      } else {
        pred.append(h("p", {class: "sg-note", text: "過去問の点数を入れると、ここに予想が出ます。"}));
      }
      var nx = nextPick(subs, preds, mine);
      box.append(h("h3", {class: "sg-pw-t", text: "いまの実力"}), h("div", {class: "sg-pw-body"}, prog, pred),
        nx ? h("p", {class: "sg-pw-next"}, h("span", {class: "sg-k", text: "次に解くなら："}),
          h("strong", {text: nx.s.name + " " + nx.b.name}), "（まだ解いていない年のうち最新）",
          nx.eid ? h("a", {class: "sg-solve", href: solveHref(nx.eid), text: "解く"}) : null) : "");
    }
    function mark(input) {
      var c = input._cell, v = input.value.trim();
      var sent = c.sent !== undefined && v === String(c.sent);
      input.classList.toggle("is-sent", sent);
      input.classList.toggle("is-new", v !== "" && !sent);
      var dev = sent ? natDev({book: c.row.book, subject: c.subject}, v) : null;
      input.classList.toggle("is-great", dev !== null && dev >= GREAT);
      input.classList.toggle("is-super", dev !== null && dev >= SUPER);
      var st = S.tint && dev !== null ? devStep(dev) : null;
      for (var q = 0; q < 5; q++) input.classList.toggle("sg-dv" + q, st === q);
      var mxc = maxOf(c.subject, c.row.book);
      input.classList.toggle("is-goal", sent && c.goal > 0 && mxc > 0 && 100 * (+v) / mxc >= c.goal);
      if (dev !== null) input.title = "送った点数・全国偏差値 " + dev.toFixed(1) + (isAdj(c.row.book, c.subject) ? "（目安）" : "");
      input.classList.remove("is-bad");
    }
    function fillAvg() {
      if (!S.avgOn) return;
      ui.scroll.querySelectorAll("[data-avg]").forEach(function (box) {
        var input = ui.scroll.querySelector('input[data-k="' + box.getAttribute("data-avg").replace(/"/g, '\\"') + '"]');
        if (!input) return;
        var c = input._cell, cc = {subject: c.subject, book: c.row.book, round: c.row.round};
        var site = siteText(S.stats, cc), nat = natMean(cc);
        box.textContent = "";
        box.append(h("span", {text: "サイト " + (!S.stats ? "…" : site.mean !== null ? fmt(site.mean) : "まだ少ない")}),
          h("span", {text: "全国 " + (nat !== null ? fmt(nat) : "—")}));
      });
    }
    function loadStats(fresh) {
      return getStats(fresh).then(function (s) { S.stats = s; fillAvg(); return s; }, function () { return null; });
    }
    function dirtyInputs() {
      return [].slice.call(ui.scroll.querySelectorAll("input.sg-in:not(:disabled)")).filter(function (i) {
        var v = i.value.trim();
        return v !== "" && !(i._cell.sent !== undefined && v === String(i._cell.sent));
      });
    }
    function updateCount() {
      var n = dirtyInputs().length;
      ui.send.textContent = "入れたマスをまとめて送る" + (n ? "（" + n + "件）" : "");
    }
    function clearResult() { ui.result.hidden = true; ui.result.textContent = ""; ui.msg.textContent = ""; }

    // ---- 送信
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function countdown(sec, text) {
      return new Promise(function (res) {
        var n = sec;
        ui.status.textContent = text(n);
        var t = setInterval(function () {
          n--;
          if (n <= 0) { clearInterval(t); ui.status.textContent = ""; res(); } else ui.status.textContent = text(n);
        }, 1000);
      });
    }
    function problem(text, focus) { ui.msg.textContent = text; if (focus) focus.focus(); return false; }

    async function send() {
      if (S.busy) return;
      ui.msg.textContent = ""; ui.result.hidden = true;
      var inputs = dirtyInputs();
      if (!inputs.length) { ui.msg.textContent = "送るマスに点数を入れてください"; return; }
      var bad = null, cells = [];
      inputs.forEach(function (i) {
        var c = i._cell, v = i.value.trim(), max = maxOf(c.subject, c.row.book);
        if (!/^\d+$/.test(v) || +v > max) { i.classList.add("is-bad"); if (!bad) bad = {i: i, max: max, c: c}; return; }
        cells.push({subject: c.subject, book: c.row.book, round: c.row.round, score: Number(v), label: c.row.label, key: c.key});
      });
      if (bad) return void problem(bad.c.row.label + "の" + bad.c.subject.name + "：点数は0〜" + bad.max + "の整数で入れてください", bad.i);
      var cfg = S.cfg;
      if (!ui.consent.checked) { ui.prof.open = true; return void problem("送るには、匿名で集計して動画で使うことへの同意が必要です。「送る人の情報」にチェックを入れてください", ui.consent); }
      if (!ui.band.value) { ui.prof.open = true; return void problem("学力帯（直近の模試の偏差値）を選んでください", ui.band); }
      var nick = ui.nick.value.trim();
      if (!nick && (cfg.nickname.required || ui.rank.checked)) { ui.prof.open = true; return void problem(ui.rank.checked ? "ランキングに載せるには、ニックネームを入れてください" : "ニックネームを入れてください", ui.nick); }
      var base = {mode: "practice", code: ui.code, band: ui.band.value, ranking: ui.rank.checked, website: ui.hp.value};
      if (nick) base.nickname = nick;
      if (cfg.passphraseRequired) base.passphrase = ui.pass.value;
      sset("consent", "1"); sset("band", ui.band.value); sset("nickname", nick); sset("ranking", ui.rank.checked ? "1" : "");
      sumUp();

      S.busy = true; ui.send.disabled = true;
      var size = (cfg.limits && cfg.limits.maxRows) || 20, chunks = [], sentAll = [];
      for (var i = 0; i < cells.length; i += size) chunks.push(cells.slice(i, i + size));
      try {
        for (var ci = 0; ci < chunks.length; ci++) {
          var chunk = chunks[ci], tries = 0, res;
          for (;;) {
            var wait = MIN_FILL_MS - (performance.now() - openedAt);
            if (wait > 0) await sleep(wait);
            ui.status.textContent = "送信中…" + (chunks.length > 1 ? "（" + (ci + 1) + "/" + chunks.length + "）" : "");
            var body = Object.assign({}, base, {fillMs: Math.round(performance.now() - openedAt), rows: chunk.map(function (c) {
              var r = {subject: c.subject.id, book: c.book.id, score: c.score};
              if (c.book.rounds !== "none" && c.round) r.round = c.round;
              return r;
            })});
            res = await apiPost(body);
            var m = !res.ok && /(\d+)秒/.exec(res.error || "");
            if (m && /空けて/.test(res.error) && tries < 2 && +m[1] <= 60) {  // 前の送信から間もないときは、あけてから自動でもう一度
              tries++;
              await countdown(+m[1] + 1, function (n) { return "あと" + n + "秒で続きを送ります"; });
              continue;
            }
            break;
          }
          if (!res.ok) {
            ui.status.textContent = "";
            ui.msg.textContent = (sentAll.length ? sentAll.length + "件は送れました。残りは送れませんでした：" : "") + (res.error || "送信できませんでした");
            break;
          }
          saveMine(chunk);
          chunk.forEach(function (c) { delete S.drafts[c.key]; });
          sentAll = sentAll.concat(chunk);
          renderGrid();
          if (ci < chunks.length - 1) await countdown(COOLDOWN, function (n) { return "あと" + n + "秒で続きを送ります（" + (ci + 2) + "/" + chunks.length + "）"; });
        }
      } catch (e) {
        ui.msg.textContent = (sentAll.length ? sentAll.length + "件は送れました。" : "") + "通信に失敗しました。電波の良いところでもう一度送ってください";
      } finally {
        S.busy = false; ui.send.disabled = false; ui.status.textContent = "";
      }
      if (sentAll.length) {
        renderGrid();
        showResult(sentAll, null);
        var stats = await loadStats(true);
        showResult(sentAll, stats || false);
        refreshOthers();
      }
    }

    // ---- 送ったあと：自分の点数・サイト内の平均・全国平均
    function showResult(sent, stats) {
      var r = ui.result;
      r.hidden = false; r.textContent = "";
      var minN = (S.stats && S.stats.minN) || S.cfg.minN || 3;
      var tbody = h("tbody"), best = null, anyAdjR = [];
      sent.forEach(function (c) {
        addText(anyAdjR, adjText(c.book, c.subject));
        var dev = natDev(c, c.score);
        if (dev !== null && dev >= GREAT && (!best || dev > best.dev)) best = {c: c, dev: dev};
        var site = stats === null ? "…" : stats === false ? "読み込めませんでした" : (function () {
          var s = siteText(stats, c);
          return s.mean !== null ? fmt(s.mean) + "点（" + s.n + "人）" : "まだ少ない";
        })();
        var nat = natMean(c);
        tbody.append(h("tr", {class: dev !== null && dev >= SUPER ? "is-super" : dev !== null && dev >= GREAT ? "is-great" : null},
          h("th", {scope: "row", text: c.label}), h("td", {text: c.subject.name}),
          h("td", {class: "sg-n sg-you", text: c.score + "点"}), h("td", {class: "sg-n", text: site}), h("td", {class: "sg-n", text: nat !== null ? fmt(nat) + "点" : "—"}),
          h("td", {class: "sg-n", text: dev !== null ? dev.toFixed(1) : "—"})));
      });
      var table = h("table", {class: "sg-table sg-rt"},
        h("thead", null, h("tr", null, h("th", {scope: "col", class: "sg-rh", text: "試験"}), h("th", {scope: "col", text: "科目"}),
          h("th", {scope: "col", text: "あなた"}), h("th", {scope: "col", text: "サイト内の平均"}), h("th", {scope: "col", text: "全国平均"}),
          h("th", {scope: "col", text: "全国偏差値"}))), tbody);
      if (best) {
        r.append(h("div", {class: "sg-congrats" + (best.dev >= SUPER ? " is-super" : "")},
          h("p", {class: "sg-congrats-t", text: "Congratulations!"}),
          h("p", {class: "sg-congrats-d", text: best.c.label + "の" + best.c.subject.name + "は" + best.c.score + "点、全国偏差値 " + best.dev.toFixed(1) + "。" +
            (best.dev >= SUPER ? "全国でもごく一部しか取れない点数です。" : "全国の平均点を大きく上回っています。")})));
      }
      r.append(h("p", {class: "sg-done", text: sent.length + "件を送りました。"}), h("div", {class: "sg-scroll"}, table),
        h("p", {class: "sg-note"}, "サイト内の平均は、" + minN + "人以上の点数がたまると出ます。全国平均は本試験だけです。",
          h("a", {href: RESULTS_URL, text: "自分の順位と分布を見る →"})));
      adjNoteEls(anyAdjR).forEach(function (el) { r.append(el); });
      if (sent.some(function (c) { return c.book && /^(honshi202[2-6]|day1_2021)$/.test(c.book.id); })) r.append(ruidaiLine());
    }

    function refreshOthers() { instances.forEach(function (x) { if (x.el !== el) x.refresh(); }); }

    var inst = {
      el: el,
      refresh: function () { if (S.cfg && !S.busy) { renderGrid(); } },
    };
    instances.push(inst);
    getConfig().then(build, function () {
      el.textContent = "";
      el.append(h("p", {class: "sg-note sg-err", text: "集計サーバーにつながりませんでした。時間をおいて再読み込みしてください。"}));
    });
    return inst;
  }

  function mountAll() { document.querySelectorAll("[data-score-grid]").forEach(function (el) { if (!el.classList.contains("sg")) mount(el); }); }
  window.ScoreGrid = {
    mount: mount,
    mountAll: mountAll,
    refresh: function () { instances.forEach(function (x) { x.refresh(); }); },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll); else mountAll();
})();
