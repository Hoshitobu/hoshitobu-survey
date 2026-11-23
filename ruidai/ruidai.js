/* 類題演習：端末の中だけで動く。送信なし。外部の読みこみなし（問題の束はこのサイトの pool-<テーマ>.json だけ）。
 * ・過去問の解禁：過去問演習の記録 localStorage["kakomon.<試験id>.history"]（JSON の配列。点数 total のある記録が1つ以上）を読むだけ。
 * ・できた／もう一度：localStorage["ruidai.<テーマid>.<問題>"] = "ok" | "ok+t"（目標時間内）| "again"
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
  function solved(id) {
    if (id === "any-IA") {
      return lsKeys().some(function (k) {
        var m = /^kakomon\.(\d{4}-IA)\.history$/.exec(k || "");
        return m && solved(m[1]);
      });
    }
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

  // ---------------------------------------------------------------- 解いた数（テーマごと。「できた」を押した数と、そのうち目標時間内の数）
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

  // ---------------------------------------------------------------- タイマー（1問ごとの目標時間。数えあげ。目標を超えたら色が変わる）
  // ・data-per ＝ 1問の目標（秒）。画面の時間は「いまの問題」の経過時間で、「できた」「もう一度」「同じ形でもう1問」を押すたびに 0 にもどる。
  // ・「できた」を押したとき、経過が目標以内なら「時間内」に数える（基礎ドリルの問題だけ。組み合わせは時間を数えない）。
  var timer = { running: false, sec: 0, goal: 0, draw: null };
  function lapReset() { timer.sec = 0; if (timer.draw) timer.draw(); }
  function withinTime(box) {
    return !!(box && box.closest && box.closest("#drill")) && timer.running && timer.goal > 0 && timer.sec <= timer.goal;
  }
  function initTimer() {
    var t = document.querySelector(".timer"); if (!t) return;
    var now = t.querySelector(".t-now"), start = t.querySelector(".t-start"), reset = t.querySelector(".t-reset");
    var id = null;
    timer.goal = +t.dataset.per || 0;
    function draw() {
      now.textContent = Math.floor(timer.sec / 60) + ":" + ("0" + (timer.sec % 60)).slice(-2);
      t.classList.toggle("is-over", timer.goal > 0 && timer.sec > timer.goal);
    }
    timer.draw = draw;
    function stop() { if (id) { clearInterval(id); id = null; } timer.running = false; start.textContent = timer.sec ? "つづける" : "はじめる"; }
    start.addEventListener("click", function () {
      if (id) { stop(); return; }
      start.textContent = "とめる";
      timer.running = true;
      id = setInterval(function () { timer.sec++; draw(); }, 1000);
    });
    reset.addEventListener("click", function () { stop(); timer.sec = 0; draw(); start.textContent = "はじめる"; });
  }

  // ---------------------------------------------------------------- できた／もう一度
  // box.dataset.cur : "" | "ok" | "ok+t" | "again"（いま画面に出ている問題の状態）
  // box.dataset.persist : "1" のとき（もとの問題）だけ localStorage に残す。「もう1問」で出した問題の状態は残さない（数だけ数える）
  function paint(box) {
    var cur = box.dataset.cur || "", isOk = cur.indexOf("ok") === 0;
    [].forEach.call(box.querySelectorAll(".mk"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === "ok" ? isOk : b.dataset.v === cur));
    });
    var li = box.closest(".qitem");
    if (li) { li.classList.toggle("is-ok", isOk); li.classList.toggle("is-again", cur === "again"); }
  }
  function setMark(box, want) {            // want: "" | "ok" | "again"
    var prev = box.dataset.cur || "", next = want;
    if (want === "ok") next = withinTime(box) ? "ok+t" : "ok";
    if (want && box.closest("#drill")) lapReset();         // 次の問題の時間を、0 から数えなおす
    var dn = (next.indexOf("ok") === 0 ? 1 : 0) - (prev.indexOf("ok") === 0 ? 1 : 0);
    var dt = (next === "ok+t" ? 1 : 0) - (prev === "ok+t" ? 1 : 0);
    box.dataset.cur = next;
    if (box.dataset.persist === "1") { if (next) lsSet("ruidai." + box.dataset.key, next); else lsDel("ruidai." + box.dataset.key); }
    paint(box);
    if (dn || dt) addCnt(TID, dn, dt);
  }
  function initMarks() {
    [].forEach.call(document.querySelectorAll(".mark"), function (box) {
      box.dataset.persist = "1";
      box.dataset.cur = lsGet("ruidai." + box.dataset.key) || "";
      paint(box);
      box.addEventListener("click", function (ev) {
        var b = ev.target.closest(".mk"); if (!b) return;
        var cur = box.dataset.cur || "";
        var isSame = b.dataset.v === "ok" ? cur.indexOf("ok") === 0 : cur === b.dataset.v;
        setMark(box, isSame ? "" : b.dataset.v);   // もう一度押すと外れる
      });
    });
    [].forEach.call(document.querySelectorAll(".t-clear"), function (b) {
      b.addEventListener("click", function () {
        if (!confirm("このページの「できた／もう一度」と、解いた数を消します。よいですか？")) return;
        lsKeys().filter(function (k) { return k && k.indexOf("ruidai." + b.dataset.theme + ".") === 0; }).forEach(lsDel);
        [].forEach.call(document.querySelectorAll(".mark"), function (box) { box.dataset.cur = ""; paint(box); });
        [].forEach.call(document.querySelectorAll(".t-more"), function (m) { setPoolNote(m.closest(".qitem"), ""); });
        drawSolved();
      });
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
  function stash(li) {
    if (li._orig) return;
    var head = li.querySelector(".q-head"), body = li.querySelector(".q-body"), folds = li.querySelector(".folds");
    li._orig = { head: head.innerHTML, body: body.innerHTML, folds: folds.innerHTML };
  }
  function showPool(li, it) {
    stash(li);
    var head = li.querySelector(".q-head"), box = li.querySelector(".mark");
    li.querySelector(".q-body").innerHTML = it.q;
    li.querySelector(".folds").innerHTML = it.folds;
    if (it.tags) {                                     // 組み合わせ：解き方の型の札を、この問題のものに
      [].forEach.call(head.querySelectorAll(".tag"), function (x) { x.remove(); });
      head.insertAdjacentHTML("beforeend", it.tags);
    }
    if (it.card) {                                     // 問いごとに札が替わるとき
      var mini = head.querySelector(".mini");
      if (mini) mini.outerHTML = it.card;
    }
    [].forEach.call(head.querySelectorAll(".q-pool"), function (x) { x.remove(); });
    head.insertAdjacentHTML("beforeend", "<span class=\"q-pool\">同じ形のもう1問</span>");
    box.dataset.persist = "0"; box.dataset.cur = ""; paint(box);
    li.querySelector(".t-back").hidden = false;
    li.classList.add("is-pool");
  }
  function backOrig(li) {
    if (!li._orig) return;
    li.querySelector(".q-head").innerHTML = li._orig.head;
    li.querySelector(".q-body").innerHTML = li._orig.body;
    li.querySelector(".folds").innerHTML = li._orig.folds;
    var box = li.querySelector(".mark");
    box.dataset.persist = "1"; box.dataset.cur = lsGet("ruidai." + box.dataset.key) || ""; paint(box);
    li.querySelector(".t-back").hidden = true;
    li.classList.remove("is-pool");
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
    [].forEach.call(document.querySelectorAll(".t-more"), function (b) {
      var li = b.closest(".qitem");
      setPoolNote(li, "");
      b.addEventListener("click", function () { if (li.closest("#drill")) lapReset(); nextOne(li); });
      li.querySelector(".t-back").addEventListener("click", function () { delete li.dataset.poolCur; if (li.closest("#drill")) lapReset(); backOrig(li); });
    });
  }

  function init() { unlock(); summarize(); initTimer(); initMarks(); initMore(); drawSolved(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.addEventListener("storage", function () { unlock(); summarize(); drawSolved(); });
})();
