// 「点数だけ入れる」（点数集計の回答フォーム）。もとは index.html にあったスクリプトをそのまま移したもの。
// 画面は kakomon.html の #quickPanel にある（予想問題集・過去問・センター試験の点数をまとめて送る／本番の自己採点）。
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";  // 0/O/1/I を除外（サーバーと同じ）
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const OPENED_AT = performance.now();
let CFG = null;
let mode = "practice";

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem("hoshitobu-survey:" + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("hoshitobu-survey:" + k, v); } catch (e) { /* 保存できない環境でも回答は可能 */ } },
};

function newCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, x => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

function setCode(code, isNew) {
  $("codeView").textContent = code;
  $("codeNew").hidden = !isNew;
  store.set("code", code);
}

function option(value, text) {
  const o = document.createElement("option");
  o.value = value; o.textContent = text;
  return o;
}

function monthOptions() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);  // 日本時間の今月まで
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const [minY, minM] = CFG.limits.minMonth.split("-").map(Number);
  const out = [];
  while (y > minY || (y === minY && m >= minM)) {
    out.push([`${y}-${String(m).padStart(2, "0")}`, `${y}年${m}月`]);
    if (--m === 0) { m = 12; y--; }
  }
  return out;
}

// 年度ごとの違い（Code.gs と同じ）: センター英語は筆記200・リスニング50、存在しない科目は選べない
function maxOf(subject, book) {
  return book && book.max && book.max[subject.id] !== undefined ? book.max[subject.id] : subject.max;
}
function labelOf(subject, book) { return (book && book.labels && book.labels[subject.id]) || subject.name; }
function excluded(subject, book) { return !!(book && book.exclude && book.exclude.includes(subject.id)); }

function updateRow(el) {
  const book = mode === "practice" ? CFG.books.find(b => b.id === el.querySelector('[data-f="book"]').value) : null;
  const select = el.querySelector('[data-f="subject"]');
  for (const o of select.options) {
    const s = CFG.subjects.find(x => x.id === o.value);
    if (!s) continue;
    o.textContent = `${labelOf(s, book)}（${maxOf(s, book)}点）`;
    o.disabled = o.hidden = excluded(s, book);
  }
  let subject = CFG.subjects.find(s => s.id === select.value);
  if (subject && excluded(subject, book)) { select.value = ""; subject = null; }
  const roundWrap = el.querySelector("[data-round]");
  roundWrap.hidden = mode !== "practice" || (book && book.rounds === "none");
  roundWrap.querySelector("label").textContent = book && book.rounds === "optional" ? "回（任意）" : "回";
  el.querySelector("[data-max]").textContent = subject ? maxOf(subject, book) : "—";
  el.querySelector('[data-f="score"]').max = subject ? maxOf(subject, book) : "";
  buildSections(el, subject, book);
}

// ---- 大問ごとの点数（任意）。予想問題集だけ。配点の初期値は本番（2026本試）の配点で、問題集に合わせて直せる ----
function sectionTpl(subject, book) {  // 過去問はその年の配点、予想問題集は本番の配点（Code.gs の sectionTpl_ と同じ）
  if (mode !== "practice" || !subject || !book || !CFG.sections) return null;
  if (book.sections) return book.sections[subject.id] || null;
  if (!(CFG.sectionGroups || []).includes(book.group)) return null;
  return CFG.sections[subject.id] || null;
}
function readSections(el) {
  return [...el.querySelectorAll("[data-q]")].map(c => ({
    q: Number(c.dataset.q), score: c.querySelector("[data-ss]").value.trim(), max: c.querySelector("[data-sm]").value.trim(),
  })).filter(x => x.score !== "");
}
function updateSectionSum(el, auto) {
  const subject = CFG.subjects.find(x => x.id === el.querySelector('[data-f="subject"]').value);
  const book = CFG.books.find(b => b.id === el.querySelector('[data-f="book"]').value);
  const box = el.querySelector("[data-secsum]");
  const list = readSections(el);
  if (!list.length || !subject) { box.textContent = ""; box.classList.remove("bad"); return; }
  const sumS = list.reduce((a, x) => a + (+x.score || 0), 0), sumM = list.reduce((a, x) => a + (+x.max || 0), 0);
  if (auto) el.querySelector('[data-f="score"]').value = sumS;   // 合計点は大問の合計から自動で入れる
  const full = Math.min(maxOf(subject, book), sumM);              // この記録の満点 = min(科目の満点, 入れた大問の配点の合計)
  const ok = sumS <= full;
  box.textContent = `合計 ${sumS} / ${full}点` + (sumM < maxOf(subject, book) ? `（入れた大問だけ。科目の満点は${maxOf(subject, book)}点）` : "") +
    (ok ? "" : " … 点数の合計が満点を超えています");
  box.classList.toggle("bad", !ok);
}
function buildSections(el, subject, book) {
  const wrap = el.querySelector("[data-sections]");
  const tpl = sectionTpl(subject, book);
  wrap.hidden = !tpl;
  const key = tpl ? subject.id + "|" + book.id : "";
  if (wrap.dataset.key === key) return;
  wrap.dataset.key = key;
  const grid = el.querySelector("[data-secgrid]");
  grid.innerHTML = "";
  if (!tpl) return;
  const ask = tpl.some(x => x === null);   // 大問ごとの配点が年度で変わる科目（地学・理科基礎・社会）は、配点も本人が入れる
  el.querySelector("[data-secnote]").textContent = ask
    ? "この科目は大問ごとの配点が年度で変わるので、問題集に書いてある配点も入れてください。"
    : book.sections
      ? "配点はこの年の実際の配点を入れてあります。" + (tpl.reduce((a, x) => a + x, 0) > maxOf(subject, book) ? "選ばなかった大問は空欄のままにしてください。" : "")
      : subject.id === "math2bc"
        ? "選ばなかった大問は空欄のままにしてください。配点は本番の配点を入れてあります。問題集で違うときは直してください。"
        : "配点は本番の配点を入れてあります。問題集で違うときは直してください。";
  tpl.forEach((mx, i) => {
    const c = document.createElement("div");
    c.className = "cell"; c.dataset.q = String(i + 1);
    c.innerHTML = `<b>第${i + 1}問</b><div class="pair"><input type="number" data-ss min="0" step="1" inputmode="numeric" aria-label="第${i + 1}問の点数">` +
      `/ <input type="number" data-sm min="1" step="1" inputmode="numeric" value="${mx === null ? "" : mx}" placeholder="配点" aria-label="第${i + 1}問の配点"></div>`;
    grid.append(c);
  });
  grid.addEventListener("input", () => updateSectionSum(el, true));
  updateSectionSum(el, false);
}

function bookOptions() {  // 予想問題集・共通テスト過去問・センター試験過去問…のグループに分ける
  const groups = new Map();
  for (const b of CFG.books) {
    const label = b.group || "その他";
    if (!groups.has(label)) { const g = document.createElement("optgroup"); g.label = label; groups.set(label, g); }
    groups.get(label).append(option(b.id, b.name));
  }
  return [...groups.values()];
}

function renumber() {
  const rows = [...$("records").children];
  rows.forEach((el, i) => {
    el.querySelector("[data-title]").textContent = `記録 ${i + 1}`;
    el.querySelector("[data-remove]").hidden = rows.length === 1;
  });
  $("addRow").hidden = rows.length >= CFG.limits.maxRows;
}

function carryOver(el) {
  if (!el) return null;
  const v = {};
  for (const f of ["book", "round", "month"]) v[f] = el.querySelector(`[data-f="${f}"]`).value;
  return v;
}

function addRow(carry) {
  const el = $("rowTpl").content.firstElementChild.cloneNode(true);
  const book = el.querySelector('[data-f="book"]');
  book.append(option("", "選んでください"), ...bookOptions());
  const round = el.querySelector('[data-f="round"]');
  round.append(option("", "選んでください"));
  for (let n = 1; n <= CFG.roundMax; n++) round.append(option(String(n), `第${n}回`));
  const subject = el.querySelector('[data-f="subject"]');
  subject.append(option("", "選んでください"), ...CFG.subjects.map(s => option(s.id, `${s.name}（${s.max}点）`)));
  const month = el.querySelector('[data-f="month"]');
  month.append(option("", "—"), ...monthOptions().map(([v, t]) => option(v, t)));
  if (carry) {  // 同じ問題集・回で科目だけ変えて続けて入力しやすいように引き継ぐ
    for (const f in carry) el.querySelector(`[data-f="${f}"]`).value = carry[f];
  }
  el.querySelectorAll("[data-practice-only]").forEach(x => { x.hidden = mode !== "practice"; });
  el.addEventListener("change", () => updateRow(el));
  el.querySelector("[data-remove]").addEventListener("click", () => { el.remove(); renumber(); });
  $("records").append(el);
  updateRow(el);
  renumber();
}

function setMode(next) {
  mode = next;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  document.querySelectorAll("[data-practice-only]").forEach(x => { x.hidden = mode !== "practice"; });
  $("honbanNote").hidden = mode !== "honban";
  $("profileCard").hidden = mode === "honban" && !CFG.passphraseRequired;
  [...$("records").children].forEach(updateRow);
}

function intOrNull(v) { return v === "" ? null : Number(v); }

function collect() {
  let ok = true;
  const rows = [...$("records").children].map(el => {
    const get = f => el.querySelector(`[data-f="${f}"]`).value.trim();
    const err = el.querySelector("[data-err]");
    const subject = CFG.subjects.find(s => s.id === get("subject"));
    const book = CFG.books.find(b => b.id === get("book"));
    const score = get("score");
    const problems = [];
    if (mode === "practice" && !book) problems.push("問題集を選んでください");
    if (mode === "practice" && book && book.rounds === "required" && !get("round")) problems.push("回を選んでください");
    const max = subject ? maxOf(subject, mode === "practice" ? book : null) : 0;
    if (!subject) problems.push("科目を選んでください");
    else if (!/^\d+$/.test(score) || +score > max) problems.push(`点数を0〜${max}の整数で入力してください`);
    const minutes = get("minutes");
    if (mode === "practice" && minutes && (!/^\d+$/.test(minutes) || +minutes < 1 || +minutes > CFG.limits.maxMinutes)) {
      problems.push(`所要時間は1〜${CFG.limits.maxMinutes}分で入力してください`);
    }
    let sections = null;
    if (mode === "practice" && sectionTpl(subject, book)) {
      const list = readSections(el);
      if (list.length) {
        const noMax = list.find(x => x.max === "");
        const bad = list.find(x => !/^\d+$/.test(x.score) || !/^\d+$/.test(x.max) || +x.max < 1 || +x.score > +x.max);
        const sumS = list.reduce((a, x) => a + (+x.score || 0), 0), sumM = list.reduce((a, x) => a + (+x.max || 0), 0);
        if (noMax) problems.push(`第${noMax.q}問の配点を入れてください`);
        else if (bad) problems.push(`第${bad.q}問の点数は0〜配点の整数で入力してください`);
        else if (/^\d+$/.test(score) && sumS !== +score) problems.push(`大問ごとの点数の合計（${sumS}点）が、点数（${score}点）と合いません`);
        sections = list.map(x => ({q: x.q, score: Number(x.score), max: Number(x.max)}));
      }
    }
    err.textContent = problems.join(" / ");
    if (problems.length) ok = false;
    if (mode === "honban") return {subject: get("subject"), score: intOrNull(score)};
    const row = {subject: get("subject"), book: get("book"), score: intOrNull(score)};
    if (sections) row.sections = sections;
    if (book && book.rounds !== "none" && get("round")) row.round = Number(get("round"));
    if (minutes) row.minutes = Number(minutes);
    if (get("month")) row.month = get("month");
    return row;
  });
  return ok ? rows : null;
}

// 送信した自分の点数をこの端末に保存する（集計ページで順位・分布上の位置を表示するため）
function saveMine(rows) {
  let mine = [];
  try { mine = JSON.parse(store.get("mine") || "[]"); } catch (e) { mine = []; }
  const at = new Date().toISOString();
  for (const r of rows) {
    const subject = CFG.subjects.find(s => s.id === r.subject);
    const book = CFG.books.find(b => b.id === r.book);
    mine.push({
      kind: mode, subject: subject.name, book: book ? book.name : "",
      round: r.round === undefined ? null : r.round, score: r.score, at,
      sections: r.sections || null,   // 集計ページの「成績表」で、大問ごとの復習の提案に使う
    });
  }
  store.set("mine", JSON.stringify(mine.slice(-300)));
}

async function submit(ev) {
  ev.preventDefault();
  const msg = $("msg");
  msg.textContent = "";
  $("done").hidden = true;
  if (!$("consent").checked) { msg.textContent = "「はじめに」の内容を確認して、同意にチェックを入れてください"; return; }
  const body = {
    mode,
    code: $("codeView").textContent,
    website: $("website").value,
    fillMs: Math.round(performance.now() - OPENED_AT),
  };
  if (mode === "practice") {
    if (!$("band").value) { msg.textContent = "学力帯（直近の模試の偏差値）を選んでください"; return; }
    body.band = $("band").value;
    if ($("nickname").value.trim()) body.nickname = $("nickname").value.trim();
    else if (CFG.nickname.required || $("ranking").checked) { msg.textContent = "ニックネームを入力してください"; return; }
    body.ranking = $("ranking").checked;
  }
  if (CFG.passphraseRequired) body.passphrase = $("passphrase").value;
  const rows = collect();
  if (!rows) { msg.textContent = "赤字の項目を確認してください"; return; }
  body.rows = rows;
  const btn = $("submit");
  btn.disabled = true; btn.textContent = "送信中…";
  try {
    const res = await window.surveyApi.post(body);
    if (!res.ok) { msg.textContent = res.error || "送信できませんでした"; return; }
    if (mode === "practice") {
      store.set("nickname", $("nickname").value.trim());
      store.set("band", $("band").value);
      store.set("ranking", $("ranking").checked ? "1" : "");
    }
    if (CFG.passphraseRequired) store.set("passphrase", $("passphrase").value);
    saveMine(rows);
    $("done").innerHTML = "";
    $("done").append(`✓ ${rows.length}件の記録を送信しました。ありがとうございます！ `);
    const a = document.createElement("a"); a.href = "results.html#mine"; a.textContent = "自分の順位と分布を見る →";
    $("done").append(a);
    $("done").hidden = false;
    const keep = carryOver($("records").lastElementChild);
    $("records").innerHTML = "";
    addRow(keep);
  } catch (e) {
    msg.textContent = "通信に失敗しました。電波の良いところでもう一度送ってください";
  } finally {
    btn.disabled = false; btn.textContent = "送信する";
  }
}

async function init() {
  try {
    CFG = await window.surveyApi.get("config");
    if (!CFG.ok) throw new Error(CFG.error);
  } catch (e) {
    $("loadError").textContent = "集計サーバーにつながりませんでした。時間をおいて再読み込みしてください。";
    $("loadError").hidden = false;
    return;
  }
  const saved = store.get("code");
  if (saved && CODE_RE.test(saved)) setCode(saved, false); else setCode(newCode(), true);
  $("band").append(...CFG.bands.map(b => option(b.id, b.label)));
  $("band").value = store.get("band") || "";
  $("nickname").maxLength = CFG.nickname.maxLength;
  $("nickname").value = store.get("nickname") || "";
  $("ranking").checked = store.get("ranking") === "1";
  $("nickMax").textContent = CFG.nickname.maxLength;
  $("nickReq").textContent = CFG.nickname.required ? "必須" : "任意";
  $("maxRows").textContent = CFG.limits.maxRows;
  $("passWrap").hidden = !CFG.passphraseRequired;
  $("passphrase").value = CFG.passphraseRequired ? (store.get("passphrase") || "") : "";
  $("modeCard").hidden = !CFG.honbanEnabled;
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("copyCode").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("codeView").textContent); $("copyCode").textContent = "コピーしました"; }
    catch (e) { $("copyCode").textContent = "長押しでコピーしてください"; }
  });
  $("toggleCodeInput").addEventListener("click", () => { $("codeInputWrap").hidden = !$("codeInputWrap").hidden; });
  $("useCode").addEventListener("click", () => {
    const v = $("codeInput").value.trim().toUpperCase();
    if (!CODE_RE.test(v)) { $("msg").textContent = "回答者コードは6文字の英数字です（0・O・1・I は使われていません）"; return; }
    $("msg").textContent = "";
    setCode(v, false);
    $("codeInputWrap").hidden = true;
  });
  $("addRow").addEventListener("click", () => addRow(carryOver($("records").lastElementChild)));
  $("form").addEventListener("submit", submit);
  addRow(null);
  $("form").hidden = false;
}

init();
