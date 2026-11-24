/* 類題演習：端末の中だけで動く。送信なし。外部の読みこみなし（問題の束はこのサイトの pool-<テーマ>.json だけ）。
 * ・過去問の解禁：過去問演習の記録 localStorage["kakomon.<試験id>.history"]（JSON の配列。点数 total のある記録が1つ以上）、または
 *   点数のマス目・「点数だけ入れる」で送った記録 localStorage["hoshitobu-survey:mine"]（{kind, subject, book, round, score}）に、
 *   その試験と同じ subject・book（round があれば round も）の点数があれば、解いたとみなす。試験ごとの subject・book・round は、
 *   ページに埋めこんだ window.RUIDAI_EXAMS（kakomon-data.js の survey）。読むだけで、送信はしない。
 * ・結果（○／×）：localStorage["ruidai.<テーマid>.<問題>"] = "ok" | "ok+t"（目標時間内）| "again"（最新の結果）
 * ・回ごとの記録：localStorage["ruidai.<テーマid>.@log.<問題id>"] = [{sec: 秒（時計を使わなければ null）, ok: true|false, date: "YYYY-MM-DD"}…]（1回目・2回目…）。「同じ形でもう1問」は数だけ数え、この記録には入れない
 * ・解いた数：localStorage["ruidai.<テーマid>.@cnt"] = {"n": できたを押した数, "t": そのうち1問の目標時間内（基礎ドリルの問題だけ数える）}
 * ・同じ形でもう1問：localStorage["ruidai.<テーマid>.@seen.<グループ>"] = 出した問題の id の配列（一巡したら空にもどす）
 */
(function () {
  "use strict";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function lsKeys() { var o = []; try { for (var i = 0; i < localStorage.length; i++) o.push(localStorage.key(i)); } catch (e) {} return o; }
  function lsJson(k, d) { try { var v = JSON.parse(lsGet(k)); return v == null ? d : v; } catch (e) { return d; } }

  var main = document.querySelector("main.ruidai[data-theme]");
  var TID = main ? main.dataset.theme : "";

  // ---------------------------------------------------------------- 過去問の解禁
  function mineList() {
    var v = lsJson("hoshitobu-survey:mine", []);
    return Array.isArray(v) ? v : [];
  }
  function solvedByMine(id) {
    var ex = (window.RUIDAI_EXAMS || {})[id];
    if (!ex) return false;
    return mineList().some(function (m) {
      return m && typeof m.score === "number" && m.subject === ex.subject && m.book === ex.book &&
        (ex.round === null || ex.round === undefined || m.round === ex.round);
    });
  }
  function solved(id) {
    if (id === "any-IA") {
      var ex = window.RUIDAI_EXAMS || {};
      return lsKeys().some(function (k) {
        var m = /^kakomon\.(\d{4}-IA)\.history$/.exec(k || "");
        return m && solved(m[1]);
      }) || Object.keys(ex).some(function (k) { return /-IA$/.test(k) && solvedByMine(k); });
    }
    if (solvedByMine(id)) return true;
    var raw = lsGet("kakomon." + id + ".history");
    if (!raw) return false;
    try {
      var h = JSON.parse(raw);
      return Array.isArray(h) && h.some(function (r) { return r && typeof r.total === "number"; });
    } catch (e) { return false; }
  }

  function unlock() {
    [].forEach.call(document.querySelectorAll(".pg[data-exams]"), function (g) {
      if (g.dataset.opened) return;
      var ids = g.dataset.exams.split(/\s+/).filter(Boolean);
      if (!ids.length || !ids.every(solved)) return;
      var t = g.querySelector("template.pg-open");
      if (!t) return;
      g.dataset.opened = "1";
      g.classList.add("is-open");
      var lock = g.querySelector(".pg-lock");
      if (lock) lock.remove();
      g.appendChild(t.content.cloneNode(true));
    });
  }

  // 熟考の台詞：開いているものを先に、閉じているものは「ほかに n 件：…年を過去問演習で解くと開きます。」の1行にまとめる
  function summarize() {
    [].forEach.call(document.querySelectorAll(".jk-group"), function (g) {
      var more = g.querySelector(".jk-more"); if (!more) return;
      var pgs = [].slice.call(g.querySelectorAll(".pg-q"));
      var opened = pgs.filter(function (x) { return x.classList.contains("is-open"); });
      var closed = pgs.filter(function (x) { return !x.classList.contains("is-open"); });
      opened.forEach(function (x) { g.insertBefore(x, more); });
      closed.forEach(function (x) { x.hidden = true; });
      if (!closed.length) { more.hidden = true; return; }
      var years = {}, ids = [];
      closed.forEach(function (x) {
        x.dataset.exams.split(/\s+/).forEach(function (id) {
          var m = /^(\d{4})-IA$/.exec(id);
          if (m && !solved(id)) { years[m[1]] = 1; ids.push(id); }
        });
      });
      var ys = Object.keys(years).sort();
      more.querySelector(".jk-n").textContent = String(closed.length);
      var a = more.querySelector(".jk-link");
      a.textContent = ys.length ? ys.join("・") + " 年を過去問演習で解くと開きます。" : "数学ⅠAの過去問演習を解くと開きます。";
      a.setAttribute("href", ys.length ? "../kakomon.html?exam=" + ys[0] + "-IA" : "../kakomon.html");
      more.hidden = false;
    });
  }

  // ---------------------------------------------------------------- 解いた数（テーマごと。○ をつけた数と、そのうち目標時間内の数）
  function cntKey(tid) { return "ruidai." + tid + ".@cnt"; }
  function getCnt(tid) {
    var c = lsJson(cntKey(tid), null);
    return { n: Math.max(0, +(c && c.n) || 0), t: Math.max(0, +(c && c.t) || 0) };
  }
  function addCnt(tid, dn, dt) {
    var c = getCnt(tid);
    c.n = Math.max(0, c.n + dn); c.t = Math.max(0, Math.min(c.n, c.t + dt));
    lsSet(cntKey(tid), JSON.stringify(c));
    drawSolved();
  }
  function drawSolved() {
    [].forEach.call(document.querySelectorAll(".solved[data-theme]"), function (p) {
      var c = getCnt(p.dataset.theme);
      p.innerHTML = "この端末で解いた数 <b class=\"sv-n\">" + c.n + "</b>（時間内 <b class=\"sv-t\">" + c.t + "</b>）";
    });
  }

  // ---------------------------------------------------------------- いつも見える時計
  // ・いまの問題 ＝ 開いている問題（qfold）。別の問題を開くと切りかわり、時計は 0 から。動いていたら、そのまま動かしつづける。
  // ・「自分の答えを書いた」「答え合わせ」を押した時点で時計が止まり、その時間がその回の時間になる。
  // ・目標（秒）は、問題が入っている節の data-per（基礎ドリルだけ）。
  var T = { running: false, acc: 0, t0: 0, cur: null, wasRun: false, iv: null };
  function pad2(n) { return ("0" + n).slice(-2); }
  function fmt(sec) { return typeof sec === "number" ? Math.floor(sec / 60) + ":" + pad2(sec % 60) : "－"; }
  function secNow() { return Math.floor((T.acc + (T.running ? Date.now() - T.t0 : 0)) / 1000); }
  function goalOf(li) { var s = li && li.closest("[data-per]"); return s ? (+s.dataset.per || 0) : 0; }
  function each(sel, f) { [].forEach.call(document.querySelectorAll(sel), f); }
  function each2(root, sel, f) { [].forEach.call(root.querySelectorAll(sel), f); }
  function tdraw() {
    var s = secNow(), goal = T.cur ? goalOf(T.cur) : 0, over = goal > 0 && s > goal;
    var label = T.cur ? (T.cur.querySelector(".q-n") || {}).textContent || "" : "問題を開くと使えます";
    each(".rd-clock", function (x) { x.textContent = fmt(s); });
    each(".rd-now", function (x) { x.textContent = label; });
    each(".rd-goal", function (x) { x.hidden = !goal; x.textContent = goal ? "目標 1問 " + goal + " 秒" : ""; });
    each(".rd-start", function (x) { x.textContent = T.running ? "とめる" : (s ? "つづける" : "はじめる"); x.disabled = !T.cur; });
    each(".rd-reset", function (x) { x.disabled = !T.cur; });
    each(".rd-side, .rd-dock", function (x) { x.classList.toggle("is-over", over); x.classList.toggle("is-run", T.running); });
  }
  function tstart() { if (!T.cur || T.running) return; T.running = true; T.t0 = Date.now(); if (!T.iv) T.iv = setInterval(tdraw, 250); tdraw(); }
  function tstop() { if (T.running) { T.acc += Date.now() - T.t0; T.running = false; } if (T.iv) { clearInterval(T.iv); T.iv = null; } tdraw(); }
  function setCurrent(li) {
    var go = T.running || T.wasRun;
    T.cur = li; T.wasRun = false; tstop(); T.acc = 0;
    if (li && go) tstart(); else tdraw();
  }
  function fixTime(li) {          // 答えを書いた時点の時間を、この回の時間にして、時計を止める
    var mine = li === T.cur, goal = goalOf(li), sec = mine && (T.running || T.acc > 0) ? secNow() : null;
    li._fix = { sec: sec, within: mine && T.running && goal > 0 && sec <= goal };
    if (mine) { T.wasRun = T.running; tstop(); }
  }
  function initTimer() {
    each(".rd-start", function (b) { b.addEventListener("click", function () { if (T.running) tstop(); else tstart(); }); });
    each(".rd-reset", function (b) { b.addEventListener("click", function () { tstop(); T.acc = 0; T.wasRun = false; tdraw(); }); });
    var d = document.querySelector("details.qfold[open]");
    setCurrent(d ? d.closest(".qitem") : null);
    var wrap = document.querySelector(".rd-wrap"), dock = document.querySelector(".rd-dock");
    if (wrap && dock && "IntersectionObserver" in window) {      // 帯は、時計のある節が見えているあいだだけ
      new IntersectionObserver(function (es) { dock.classList.toggle("is-off", !es[0].isIntersecting); }).observe(wrap);
    }
  }

  // ---------------------------------------------------------------- 1回目・2回目の記録
  function logKey(qid) { return "ruidai." + TID + ".@log." + qid; }
  function getLog(qid) { var v = lsJson(logKey(qid), []); return Array.isArray(v) ? v : []; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addLog(qid, rec) { var l = getLog(qid); l.push(rec); l = l.slice(-200); lsSet(logKey(qid), JSON.stringify(l)); return l.length - 1; }
  function setLogOk(qid, i, ok) { var l = getLog(qid); if (l[i]) { l[i].ok = ok; lsSet(logKey(qid), JSON.stringify(l)); } }
  function renderLog(li) {
    var s = li.querySelector(".q-log"); if (!s || !li.id) return;
    var l = getLog(li.id), goal = goalOf(li), out = [], from = Math.max(0, l.length - 3);
    if (from > 0) out.push("<span class=\"lg-more\">ほか " + from + " 回</span>");
    for (var i = from; i < l.length; i++) {
      var r = l[i], inG = goal > 0 && typeof r.sec === "number" && r.sec <= goal;
      out.push("<span class=\"lg" + (inG ? " lg-in" : "") + "\"><span class=\"lg-n\">" + (i + 1) + "回目</span> <span class=\"lg-t\">" + fmt(r.sec) +
        "</span> <span class=\"lg-r " + (r.ok ? "lg-ok" : "lg-ng") + "\">" + (r.ok ? "○" : "×") + "</span></span>");
    }
    s.innerHTML = out.join("");
  }

  // ---------------------------------------------------------------- 結果（○／×）
  // box.dataset.cur : "" | "ok" | "ok+t" | "again"（いま画面に出ている問題の最新の結果）
  // box.dataset.persist : "1" のとき（もとの問題）だけ localStorage に残す。「もう1問」で出した問題は残さない（数だけ数える）
  function paint(box) {
    var cur = box.dataset.cur || "", isOk = cur.indexOf("ok") === 0;
    [].forEach.call(box.querySelectorAll(".mk"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === "ok" ? isOk : b.dataset.v === cur));
    });
    var li = box.closest(".qitem");
    if (li) { li.classList.toggle("is-ok", isOk); li.classList.toggle("is-again", cur === "again"); }
  }
  function setMark(box, want, within) {            // want: "" | "ok" | "again"
    var prev = box.dataset.cur || "", next = want;
    if (want === "ok" && within) next = "ok+t";
    var dn = (next.indexOf("ok") === 0 ? 1 : 0) - (prev.indexOf("ok") === 0 ? 1 : 0);
    var dt = (next === "ok+t" ? 1 : 0) - (prev === "ok+t" ? 1 : 0);
    box.dataset.cur = next;
    if (box.dataset.persist === "1") { if (next) lsSet("ruidai." + box.dataset.key, next); else lsDel("ruidai." + box.dataset.key); }
    paint(box);
    if (dn || dt) addCnt(TID, dn, dt);
  }
  function judge(li, ok) {
    var box = li.querySelector(".mark"); if (!box) return;
    var fx = li._fix || { sec: null, within: false };
    setMark(box, ok ? "ok" : "again", fx.within);
    if (box.dataset.persist === "1" && li.id) {
      if (li._att == null) li._att = addLog(li.id, { sec: fx.sec, ok: ok, date: today() });
      else setLogOk(li.id, li._att, ok);
    }
    li.classList.add("is-done");
    renderLog(li);
  }
  function retry(li) {          // もう一度解く：新しい回
    each2(li, "details.fold[open]", function (d) { d.open = false; });
    li.classList.remove("is-ok", "is-again");
    setupSolve(li);
    setCurrent(li);
  }
  function initMarks() {
    each(".mark", function (box) {
      box.dataset.persist = "1";
      box.dataset.cur = lsGet("ruidai." + box.dataset.key) || "";
      paint(box);
      var li = box.closest(".qitem");
      box.addEventListener("click", function (ev) {
        var b = ev.target.closest(".mk, .t-retry"); if (!b) return;
        if (b.classList.contains("t-retry")) { retry(li); return; }
        if (!li.classList.contains("self-judge")) return;
        judge(li, b.dataset.v === "ok");
      });
      renderLog(li);
    });
    each(".t-clear", function (b) {
      b.addEventListener("click", function () {
        if (!confirm("このページの ○／× と時間の記録、解いた数を消します。よいですか？")) return;
        lsKeys().filter(function (k) { return k && k.indexOf("ruidai." + b.dataset.theme + ".") === 0; }).forEach(lsDel);
        each(".mark", function (box) { box.dataset.cur = ""; paint(box); });
        each(".qitem", function (li) { li._att = null; renderLog(li); });
        each(".t-more", function (m) { setPoolNote(m.closest(".qitem"), ""); });
        drawSolved();
      });
    });
  }

  // ---------------------------------------------------------------- 道具カード（問題の中は、開いたとき一覧から写す）
  function fillCards(d) {
    each2(d, ".cslot", function (s) {
      if (s.firstChild) return;
      var box = document.getElementById("card-" + s.dataset.card), src = box && box.querySelector(".thcard");
      if (!src) return;
      var c = src.cloneNode(true);
      each2(c, "[id]", function (x) { x.removeAttribute("id"); });
      s.appendChild(c);
    });
  }

  // ---------------------------------------------------------------- 同じ形でもう1問
  var poolP = null;
  function loadPool() {
    if (poolP) return poolP;
    poolP = fetch("pool-" + TID + ".json?v=" + (window.RUIDAI_V || ""), { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function (e) { poolP = null; throw e; });
    return poolP;
  }
  function seenKey(g) { return "ruidai." + TID + ".@seen." + g; }
  function setPoolNote(li, text) {
    var s = li && li.querySelector(".pool-n");
    if (!s) return;
    if (text) { s.textContent = text; return; }
    var n = li.querySelector(".t-more").dataset.n;
    var seen = lsJson(seenKey(li.querySelector(".t-more").dataset.group), []).length;
    s.textContent = seen ? "この形 " + n + " 問のうち " + seen + " 問を出した" : "この形 " + n + " 問";
  }
  function foldsOf(li) { return li.querySelector(".folds:not(.folds-help)"); }
  function stash(li) {
    if (li._orig) return;
    var head = li.querySelector(".q-head"), body = li.querySelector(".q-body"), help = li.querySelector(".folds-help");
    li._orig = { head: head.innerHTML, body: body.innerHTML, folds: foldsOf(li).innerHTML, help: help ? help.innerHTML : "", marks: li.dataset.marks || "", choice: li.dataset.choice || "" };
  }
  function showPool(li, it) {
    stash(li);
    var head = li.querySelector(".q-head"), box = li.querySelector(".mark");
    li.querySelector(".q-body").innerHTML = it.q;
    foldsOf(li).innerHTML = it.folds;
    var help = li.querySelector(".folds-help");
    if (help) help.innerHTML = it.help != null ? it.help : li._orig.help;
    if (it.marks && Object.keys(it.marks).length) { li.dataset.marks = JSON.stringify(it.marks); li.dataset.choice = JSON.stringify(it.choice || {}); }
    else { li.dataset.marks = ""; li.dataset.choice = ""; }
    if (it.tags) {                                     // 組み合わせ：解き方の型の札を、この問題のものに
      [].forEach.call(head.querySelectorAll(".tag"), function (x) { x.remove(); });
      head.querySelector(".q-n").insertAdjacentHTML("afterend", it.tags);
    }
    [].forEach.call(head.querySelectorAll(".q-pool, .q-sum"), function (x) { x.remove(); });   // 見出しの1文はもとの問題のものなので外す（もどすと戻る）
    head.insertAdjacentHTML("beforeend", "<span class=\"q-pool\">同じ形のもう1問</span>");
    box.dataset.persist = "0"; box.dataset.cur = ""; paint(box);
    li.querySelector(".t-back").hidden = false;
    li.classList.add("is-pool");
    li.classList.remove("is-ok", "is-again");
    setupSolve(li);
    setCurrent(li);
  }
  function backOrig(li) {
    if (!li._orig) return;
    li.querySelector(".q-head").innerHTML = li._orig.head;
    li.querySelector(".q-body").innerHTML = li._orig.body;
    foldsOf(li).innerHTML = li._orig.folds;
    var help = li.querySelector(".folds-help"); if (help) help.innerHTML = li._orig.help;
    li.dataset.marks = li._orig.marks; li.dataset.choice = li._orig.choice;
    var box = li.querySelector(".mark");
    box.dataset.persist = "1"; box.dataset.cur = lsGet("ruidai." + box.dataset.key) || ""; paint(box);
    li.querySelector(".t-back").hidden = true;
    li.classList.remove("is-pool");
    renderLog(li);
    setupSolve(li);
    setCurrent(li);
  }
  function nextOne(li) {
    var btn = li.querySelector(".t-more"), g = btn.dataset.group;
    btn.disabled = true;
    loadPool().then(function (pool) {
      var list = (pool.groups || {})[g] || [];
      if (!list.length) throw new Error("empty");
      var seen = lsJson(seenKey(g), []), cur = li.dataset.poolCur;
      var left = list.filter(function (x) { return seen.indexOf(x.id) < 0; });
      var wrapped = false;
      if (!left.length) {                                // 一巡した：最初から
        seen = []; wrapped = true;
        left = list.filter(function (x) { return list.length < 2 || x.id !== cur; });
      }
      var it = left[Math.floor(Math.random() * left.length)];
      seen.push(it.id); lsSet(seenKey(g), JSON.stringify(seen));
      li.dataset.poolCur = it.id;
      showPool(li, it);
      setPoolNote(li, wrapped ? "一巡したので、最初から（この形 " + list.length + " 問）" : "");
      btn.disabled = false;
    }).catch(function () {
      setPoolNote(li, "問題の束を読みこめなかった。ページを開き直してください。");
      btn.disabled = false;
    });
  }
  function initMore() {
    each(".t-more", function (b) {
      var li = b.closest(".qitem");
      setPoolNote(li, "");
      b.addEventListener("click", function () { nextOne(li); });
      li.querySelector(".t-back").addEventListener("click", function () { delete li.dataset.poolCur; backOrig(li); });
    });
  }

  // ---------------------------------------------------------------- 解く：マーク式の解答欄、なければ「自分の答えを書いた」
  // li.dataset.marks ＝ {空欄の文字: 正解の1文字}、li.dataset.choice ＝ {解答群の空欄の文字: 選べる番号の並び}
  // 各カタカナに「−・0〜9」（解答群の問いは番号）を押して選び、「答え合わせ」で空欄ごとに〇×、全部合っていれば ○、ほかは × が回の記録になる。
  // 化学は、空欄が解答番号（1つの四角に 16 など。data-whole）で、どの空欄も番号（①〜⑨、数字の空欄は ①〜⑨ と ⓪）を選ぶ。
  function h(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }
  function parseJ(v) { try { return JSON.parse(v || "{}") || {}; } catch (e) { return {}; } }
  function bodyBoxes(li) {
    return [].filter.call(li.querySelectorAll(".q-body .bx"), function (b) { return !b.closest(".kgrp"); });
  }
  function showVal(li, sel, res) {
    bodyBoxes(li).forEach(function (b) {
      var ks = b.dataset.k || "", whole = !!b.dataset.whole;          // whole：化学の解答番号（1つの四角に番号全体）
      [].forEach.call(b.querySelectorAll("i, .mbk"), function (it, n) {
        var k = whole ? ks : ks.charAt(n), v = sel[k];
        it.textContent = v ? (v === "-" ? "−" : v) : k;
        it.classList.toggle("has-v", !!v);
        it.classList.toggle("is-ok", !!(res && res[k] === true));
        it.classList.toggle("is-ng", !!(res && res[k] === false));
      });
    });
  }
  function setupSolve(li) {
    li.classList.remove("is-locked", "is-checked", "is-wrote", "is-done", "self-judge", "is-ans-open");
    li._fix = null; li._att = null;
    var old = li.querySelector(".apanel"); if (old) old.remove();
    showVal(li, {}, null);
    if (!setupPanel(li)) selfPanel(li);
  }
  function selfPanel(li) {
    li.classList.add("is-locked");
    var p = h("div", "apanel ap-self");
    p.appendChild(h("p", "ap-h", "自分の答え"));
    p.appendChild(h("p", "ap-s", "紙やノートに答えを書いてから押す。押すと時計が止まり、解説のたたみが開けるようになる。"));
    var act = h("div", "ap-act"), b = h("button", "tb ap-check ap-wrote", "自分の答えを書いた"), msg = h("span", "ap-msg");
    b.type = "button"; msg.setAttribute("aria-live", "polite");
    act.appendChild(b); act.appendChild(msg); p.appendChild(act);
    foldsOf(li).parentNode.insertBefore(p, foldsOf(li));
    b.addEventListener("click", function () {
      fixTime(li);
      li.classList.remove("is-locked"); li.classList.add("is-wrote", "self-judge");
      b.disabled = true;
      msg.textContent = "答えを書いた（" + (li._fix.sec == null ? "時間は計っていない" : fmt(li._fix.sec)) + "）。「答え」を開いて、○ か × をつける。";
    });
  }
  function setupPanel(li) {
    var marks = parseJ(li.dataset.marks), choice = parseJ(li.dataset.choice);
    var cells = [], whole = !!li.querySelector(".q-body .bx[data-whole]");
    bodyBoxes(li).forEach(function (b) {
      var k = b.dataset.k || "";
      if (choice[k]) { if (cells.indexOf(k) < 0) cells.push(k); }
      else k.split("").forEach(function (c) { if (cells.indexOf(c) < 0) cells.push(c); });
    });
    if (!cells.length || !Object.keys(marks).length) return false;
    li.classList.add("is-locked");
    var sel = {}, p = h("div", "apanel");
    p.appendChild(h("p", "ap-h", "解答欄"));
    p.appendChild(h("p", "ap-s", (whole ? "解答番号ごとに、選ぶ番号を押す（数字を並べる解答番号は ①〜⑨ と ⓪）。押したものをもう一度押すと外れる。" : "空欄の文字ごとに、数は − と 0〜9、解答群の問いは番号を押して選ぶ。押したものをもう一度押すと外れる。")));
    var rows = h("div", "ap-rows"), rowEl = {};
    cells.forEach(function (k) {
      var r = h("div", "ap-row"), lab = h("span", "bx ap-l" + (whole ? " bx-n" : choice[k] ? " bx-c" : "")), keys = h("div", "ap-keys"), res = h("span", "ap-r");
      lab.appendChild(h("i", "", k));
      var vals = choice[k] ? choice[k].split("") : ["-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
      vals.forEach(function (v) {
        var b = h("button", "ap-k", v === "-" ? "−" : v); b.type = "button"; b.dataset.v = v; b.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-label", k + " に " + (v === "-" ? "マイナス" : v));
        keys.appendChild(b);
      });
      r.appendChild(lab); r.appendChild(keys); r.appendChild(res); rows.appendChild(r); rowEl[k] = r;
    });
    p.appendChild(rows);
    var act = h("div", "ap-act"), chk = h("button", "tb ap-check", "答え合わせ"), skip = h("button", "tb ap-skip", "答えを入れずに解説を見る"), clr = h("button", "tb ap-clear", "入れなおす"), msg = h("span", "ap-msg");
    [chk, clr, skip].forEach(function (b) { b.type = "button"; });
    msg.setAttribute("aria-live", "polite");
    act.appendChild(chk); act.appendChild(clr); act.appendChild(skip); act.appendChild(msg);
    p.appendChild(act);
    foldsOf(li).parentNode.insertBefore(p, foldsOf(li));
    function paintP(res) {
      cells.forEach(function (k) {
        [].forEach.call(rowEl[k].querySelectorAll(".ap-k"), function (b) { b.setAttribute("aria-pressed", String(sel[k] === b.dataset.v)); });
        var r = rowEl[k].querySelector(".ap-r");
        r.textContent = res ? (res[k] ? "〇" : "×") : "";
        r.className = "ap-r" + (res ? (res[k] ? " is-ok" : " is-ng") : "");
      });
      showVal(li, sel, res);
    }
    rows.addEventListener("click", function (ev) {
      var b = ev.target.closest(".ap-k"); if (!b) return;
      var k = b.closest(".ap-row").querySelector(".bx i").textContent;
      sel[k] = sel[k] === b.dataset.v ? undefined : b.dataset.v;
      if (sel[k] === undefined) delete sel[k];
      if (li.classList.contains("is-checked")) { li.classList.remove("is-checked"); msg.textContent = ""; }
      paintP(null);
    });
    clr.addEventListener("click", function () { sel = {}; msg.textContent = ""; li.classList.remove("is-checked"); paintP(null); });
    chk.addEventListener("click", function () {
      var res = {}, ok = 0, filled = 0;
      cells.forEach(function (k) { if (sel[k] !== undefined) filled++; res[k] = sel[k] === marks[k]; if (res[k]) ok++; });
      if (!li._fix) fixTime(li);
      li.classList.add("is-checked"); li.classList.remove("is-locked");
      msg.textContent = ok === cells.length ? "全部合っています（" + ok + "/" + cells.length + "）。解説を開けます。"
        : ok + "/" + cells.length + " の空欄が合っています" + (filled < cells.length ? "（空欄が" + (cells.length - filled) + "つ、入っていません）" : "") + "。解説で確かめよう。";
      paintP(res);
      judge(li, ok === cells.length);
    });
    skip.addEventListener("click", function () {
      if (!li._fix) fixTime(li);
      li.classList.remove("is-locked"); li.classList.add("is-wrote", "self-judge");
      msg.textContent = "解答欄を使わずに、解説を開きました。「答え」を開いて、○ か × をつける。";
    });
    paintP(null);
    return true;
  }

  // ---------------------------------------------------------------- 問題のトグル・ページ内リンク
  function initToggles() {
    document.addEventListener("toggle", function (ev) {
      var d = ev.target;
      if (!d || !d.classList) return;
      if (d.classList.contains("qfold")) {
        var li = d.closest(".qitem");
        if (d.open) {
          setCurrent(li);        // 先に切りかえてから、ほかを閉じる（動いていた時計を続けるため）
          each("details.qfold[open]", function (x) { if (x !== d) x.open = false; });
        } else if (T.cur === li) {
          setTimeout(function () { if (T.cur === li && !d.open) { T.wasRun = false; T.cur = null; tstop(); T.acc = 0; tdraw(); } }, 80);
        }
      } else if (d.classList.contains("fold-cards")) {
        if (d.open) fillCards(d);
      } else if (d.classList.contains("fold-ans")) {
        var q = d.closest(".qitem"); if (q) q.classList.toggle("is-ans-open", d.open);
      }
    }, true);
  }
  // #c3・#d2（問題）や #card-T03（一覧のカード）のリンクで来たとき・押したときは、それを開いて、そこへ移る
  function openHash() {
    var id = ""; try { id = decodeURIComponent((location.hash || "").slice(1)); } catch (e) { return; }
    if (!id) return;
    var el = document.getElementById(id); if (!el) return;
    if (el.matches("details")) el.open = true;
    else { var d = el.querySelector("details.qfold"); if (d && !d.open) d.open = true; }
    if (el.matches("details, .qitem")) setTimeout(function () { el.scrollIntoView({ block: "start" }); }, 30);
  }
  function initLinks() {
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest("a[href^=\"#\"]"); if (!a) return;
      var id = decodeURIComponent(a.getAttribute("href").slice(1)), el = id && document.getElementById(id);
      if (!el || !el.matches("details, .qitem")) return;
      ev.preventDefault();
      try { history.pushState(null, "", "#" + id); } catch (e) {}
      openHash();
    });
    window.addEventListener("hashchange", openHash);
    openHash();
  }

  window.ruidaiSolved = solved;          // 確かめ用（読むだけ）
  function init() {
    unlock(); summarize();
    if (main) {
      initToggles(); initMarks(); initMore();
      each(".qitem", setupSolve);
      initTimer();
      initLinks();
    }
    drawSolved();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.addEventListener("storage", function () { unlock(); summarize(); drawSolved(); });
})();
