/* 過去問演習の本体（公開サイトとスケジューラで共通）。
 *
 *   Kakomon.mount(root, {exams, stages, host})
 *
 * host（置き場所ごとの違い）：
 *   kind          "public" | "scheduler"
 *   store         {get(key), set(key, value)}   … 途中経過と表示の設定（この端末だけ）
 *   loadHistory() → Promise<{examId: [記録…]}>
 *   saveRecord(exam, rec, extras) → Promise<{history: [記録…], message}>
 *   deleteRecord(exam, at) → Promise<{history: [記録…]}>
 *   peers(exam)   → Promise<{label, scores: number[] | null, minN, empty}>   … 「仲間の中での偏差値」
 *   saveOptions(exam, minutes) → HTML（任意。記録ボタンの上に出す選択肢）
 *   readSaveOptions(root) → extras（任意）
 *   hostNote(exam) → HTML（任意。記録ボタンの下の説明）
 * 問題文と正解は扱わない（センターの公式ページへのリンクだけ）。
 */
(function () {
  "use strict";
  const WHYS = ["計算ミス", "読み落とし", "方針が立たない", "時間切れ"];
  const REVIEW_MIN = 6;   // 目安の初期値：見直しに残す分
  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const fmt = ms => { const t = Math.floor(ms / 1000); return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };
  const comma = n => Number(n).toLocaleString("ja-JP");
  const dev = (x, mean, sd) => 50 + 10 * (x - mean) / sd;
  const topTxt = t => t < 0.1 ? "0.1%未満" : t.toFixed(1) + "%";
  const labelOf = k => k === "rev" ? "見直し" : `第${k}問`;
  const md = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

  // 予想問題集（点数集計の問題集名と同じ）。設問ごとのデータはないので、大問ごとに点数を入れる
  const WORKBOOKS = [["sundai", "駿台 実戦問題集（青本）"], ["kawai", "河合 共通テスト総合問題集（黒本）"],
                     ["zkai", "Z会 実戦模試（緑本）"], ["yozemi", "代ゼミ 実戦問題集（白本）"], ["toshin", "東進 共通テスト実戦問題集"]];
  const WB_PARTS = {
    IIBC: {label: "数学Ⅱ・数学Ｂ・数学Ｃ", subject: "数学IIBC", required: [1, 2, 3], optional: [4, 5, 6, 7], pick: 3, max: [15, 15, 22, 16, 16, 16, 16]},
    IA: {label: "数学Ⅰ・数学Ａ", subject: "数学IA", required: [1, 2, 3, 4], optional: [], pick: 0, max: [30, 30, 20, 20]},
  };
  const WB_ROUNDS = 6;
  function workbookExam(book, part, round) {
    const b = WORKBOOKS.find(x => x[0] === book), P = WB_PARTS[part];
    if (!b || !P || !(round >= 1 && round <= WB_ROUNDS)) return null;
    return {id: `wb-${book}-${part}-${round}`, kind: "workbook", book, bookName: b[1], part, round,
            title: `${b[1]}　${P.label}　第${round}回`, minutes: 70, required: P.required, optional: P.optional, pick: P.pick,
            qs: P.max.map((mx, i) => [i + 1, P.optional.includes(i + 1) ? "選択" : "必答", mx, null]), items: [], videos: {},
            survey: {subject: P.subject, book: b[1], round}};
  }

  function mount(root, opt) {
    const EXAMS = opt.exams || [], STAGES = opt.stages || {}, host = opt.host;
    const WB_ON = opt.workbooks !== false;   // 予想問題集（点数集計の数字で比べる）を選べるようにするか
    const store = host.store;
    let E = null, QMAX = {}, S = null, H = {}, PEERS = null, tick = 0, WB = false, WBS = null;
    const q = sel => root.querySelector(sel);

    root.classList.add("kk");
    root.innerHTML = `
<section class="kk-card">
  <div class="kk-hero">
    <div>
      <div class="kk-hero-label">解く過去問・問題集</div>
      <div class="kk-pick">
        <div class="kk-select-wrap"><select class="kk-select" id="kk-exam" aria-label="解く過去問・問題集"></select></div>
        <div class="kk-select-wrap kk-round-wrap" id="kk-roundwrap" hidden><select class="kk-select" id="kk-round" aria-label="回"></select></div>
      </div>
    </div>
    <div class="kk-hero-actions">
      <a class="kk-btn kk-btn-secondary" href="https://www.dnc.ac.jp/kyotsu/kakomondai/" target="_blank" rel="noopener">問題と正解（大学入試センター）↗</a>
    </div>
    <div class="kk-meta" id="kk-meta"></div>
    <p class="kk-faint kk-src" id="kk-srcnote">問題文と正解は、ここには載せていません。大学入試センターの「過去問題」のページから開いてください（古い年度は、センターのサイトから消えていることがあります）。</p>
  </div>
</section>

<section class="kk-card" id="kk-selcard">
  <div class="kk-eyebrow"><span class="kk-step">1</span><h3>解く大問を選ぶ</h3><span class="kk-aside" id="kk-selnote"></span></div>
  <div class="kk-choices" id="kk-choices"></div>
  <div class="kk-warnline" id="kk-selmsg"></div>
</section>

<div class="kk-layout">
  <div class="kk-main">
    <section class="kk-card">
      <div class="kk-eyebrow"><span class="kk-step" data-n="ox"></span><h3>自己採点</h3><span class="kk-aside" id="kk-oxcount"></span></div>
      <p class="kk-muted" id="kk-oxnote"></p>
      <label class="kk-toggle" id="kk-onlyprev-wrap" hidden><input type="checkbox" id="kk-onlyprev">前回 × だった所だけ表示する（解き直し）</label>
      <div id="kk-ox"></div>
    </section>
  </div>
  <aside class="kk-side">
    <section class="kk-card">
      <div class="kk-eyebrow"><span class="kk-step" data-n="timer"></span><h3>時間</h3><span class="kk-aside" id="kk-limit"></span></div>
      <div class="kk-ring" id="kk-ring">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="kk-ring-track" cx="100" cy="100" r="88" fill="none" stroke-width="10"></circle>
          <circle class="kk-ring-fill" id="kk-ringfill" cx="100" cy="100" r="88" fill="none" stroke-width="10" stroke-linecap="round"
                  stroke-dasharray="552.92" stroke-dashoffset="552.92"></circle>
        </svg>
        <div class="kk-ring-center"><div class="kk-clock" id="kk-clock">00:00</div><div class="kk-clock-sub" id="kk-clocksub"></div></div>
      </div>
      <div class="kk-now" id="kk-now"></div>
      <div class="kk-timer-actions">
        <button type="button" class="kk-btn kk-btn-primary" id="kk-start">開始</button>
        <button type="button" class="kk-btn kk-btn-secondary" id="kk-reset">リセット</button>
      </div>
      <div class="kk-qlist" id="kk-qlist"></div>
      <p class="kk-faint" id="kk-goalnote" style="margin:10px 2px 0"></p>
    </section>
    <section class="kk-card">
      <div class="kk-eyebrow"><h3>いまの点数</h3><span class="kk-aside" id="kk-minirest"></span></div>
      <div class="kk-mini">
        <div class="kk-wide"><div><div class="kk-k">得点</div><div class="kk-v" id="kk-miniscore">—<small> / 100</small></div></div><div class="kk-faint" id="kk-miniavg"></div></div>
        <div><div class="kk-k" id="kk-minidevlabel">全国偏差値</div><div class="kk-v" id="kk-minidev">—</div></div>
        <div><div class="kk-k" id="kk-minitoplabel">全国の上位</div><div class="kk-v" id="kk-minitop">—</div></div>
      </div>
    </section>
  </aside>
</div>

<section class="kk-card" id="kk-report">
  <div class="kk-eyebrow"><span class="kk-step" data-n="report"></span><h3>成績表</h3><span class="kk-aside" id="kk-repnote"></span></div>
  <div class="kk-kpis">
    <div class="kk-kpi is-main"><div class="kk-k">得点</div><div class="kk-v" id="kk-score">—</div><div class="kk-s" id="kk-scoresub"></div></div>
    <div class="kk-kpi"><div class="kk-k" id="kk-devlabel">全国の中での偏差値</div><div class="kk-v" id="kk-dev">—</div><div class="kk-s" id="kk-devsub"></div></div>
    <div class="kk-kpi"><div class="kk-k" id="kk-ranklabel">全国の順位</div><div class="kk-v" id="kk-rank">—</div><div class="kk-s" id="kk-ranksub"></div></div>
    <div class="kk-kpi"><div class="kk-k" id="kk-peerlabel">仲間の中での偏差値</div><div class="kk-v" id="kk-peer">—</div><div class="kk-s" id="kk-peersub"></div></div>
  </div>
  <div class="kk-prev" id="kk-prev" hidden></div>

  <div class="kk-sec">
    <h4>大問ごと</h4>
    <div class="kk-scroll"><table class="kk-table" id="kk-qtable"></table></div>
    <div class="kk-legend"><span><i></i>取れた点</span><span><i class="is-avg"></i><span id="kk-avglegend">全国平均（選択問題は、その大問を選んだ人の平均）</span></span></div>
  </div>

  <div class="kk-split">
    <div class="kk-sec" id="kk-stagesec">
      <h4>どんな力で落としたか</h4>
      <p class="kk-muted">設問ごとの「力の種類」は星飛ぶの判断です（全体概観の動画の分け方）。正答率から、落とした原因までは決められません。</p>
      <div class="kk-bars" id="kk-stages"></div>
    </div>
    <div class="kk-sec" id="kk-whysec">
      <h4>落とした理由</h4>
      <p class="kk-muted" id="kk-whynote">今回と、これまでの記録すべて（全部の年度・科目）で数えます。</p>
      <div class="kk-bars" id="kk-whys"></div>
    </div>
  </div>

  <div class="kk-sec">
    <h4 id="kk-misstitle">落とした所</h4>
    <p class="kk-muted" id="kk-missnote">全国の正答率が 70％以上なのに × だった所が、いちばん取り返しやすい所です。</p>
    <ul class="kk-miss" id="kk-miss"></ul>
  </div>

  <div id="kk-saveopts"></div>
  <div class="kk-actions">
    <button type="button" class="kk-btn kk-btn-primary" id="kk-save">この結果を記録する</button>
    <button type="button" class="kk-btn kk-btn-secondary" id="kk-png">成績表を画像で保存</button>
  </div>
  <div class="kk-flash" id="kk-flash" hidden></div>
  <div class="kk-muted kk-hostnote" id="kk-hostnote"></div>
</section>

<section class="kk-card">
  <div class="kk-eyebrow"><h3>これまでの記録</h3><span class="kk-aside" id="kk-histnote"></span></div>
  <div class="kk-scroll"><table class="kk-table" id="kk-hist"></table></div>
  <p class="kk-muted" id="kk-histempty">まだ記録はありません。</p>
</section>

<p class="kk-foot">出典：大学入試センター「実施結果の概要」「科目別成績分布」「設問別得点率及び正答率」（各年度・本試験）。偏差値は (得点 − 平均点) ÷ 標準偏差 × 10 ＋ 50 で計算した目安です。全国の順位は、科目別成績分布（1点ごとの人数）から数えています。</p>

<div class="kk-dock" id="kk-dock"><div class="kk-clock" id="kk-dockclock">00:00</div><div class="kk-dock-now" id="kk-docknow"></div><button type="button" class="kk-btn kk-btn-primary" id="kk-dockbtn">開始</button></div>`;

    // ------------------------------------------------ 過去問の切りかえ
    const hist = () => H[E.id] || [];
    const lastRec = () => { const h = hist().filter(r => r.at !== S.savedAt); return h.length ? h[h.length - 1] : null; };
    const defaultGoal = n => Math.max(1, Math.round(QMAX[n] * (E.minutes - REVIEW_MIN) / 100));
    const fresh = () => ({sel: E.optional.slice(0, E.pick), marks: {}, why: {}, wbScore: {}, wbMax: {}, acc: {}, cur: null, since: null, started: false, savedAt: null,
                          goals: Object.fromEntries(E.qs.map(x => [x[0], defaultGoal(x[0])]))});
    const save = () => store.set(E.id + ".session", JSON.stringify(S));
    const chosen = () => [...E.required, ...S.sel.slice().sort((a, b) => a - b)];

    function examById(id) {
      const m = /^wb-(\w+)-(IIBC|IA)-(\d)$/.exec(id || "");
      if (m && WB_ON) { const w = workbookExam(m[1], m[2], +m[3]); if (w) return w; }
      return EXAMS.find(e => e.id === id) || EXAMS[0];
    }
    function loadWB() {   // 予想問題集は、点数集計（Apps Script）の数字で比べる
      if (WBS || !window.HoshitobuLink) { if (!window.HoshitobuLink) WBS = {error: true}; return; }
      WBS = {loading: true};
      window.HoshitobuLink.stats().then(st => { WBS = {stats: st}; if (WB) { drawMini(); drawReport(); } })
        .catch(() => { WBS = {error: true}; if (WB) { drawMini(); drawReport(); } });
    }
    function loadExam(id) {
      E = examById(id);
      WB = E.kind === "workbook";
      QMAX = Object.fromEntries(E.qs.map(x => [x[0], x[2]]));
      S = fresh();
      try { const raw = store.get(E.id + ".session"); if (raw) S = Object.assign(fresh(), JSON.parse(raw)); } catch (e) {}
      S.sel = S.sel.filter(n => E.optional.includes(n));
      if (WB) Object.entries(S.wbMax || {}).forEach(([n, mx]) => { if (QMAX[n]) QMAX[n] = mx; });   // 配点を直していたら、それを使う
      if (!(E.id in H) && host.historyFor) H[E.id] = host.historyFor(E.id) || [];
      store.set("lastExam", E.id);
      q("#kk-exam").value = WB ? `wb-${E.book}-${E.part}` : E.id;
      q("#kk-roundwrap").hidden = !WB;
      if (WB) q("#kk-round").value = String(E.round);
      const opt = E.optional.length;
      q("#kk-meta").innerHTML = [
        `<span class="kk-pill">試験時間 <b>${E.minutes}分</b></span>`, `<span class="kk-pill"><b>100</b>点満点</span>`,
        opt ? `<span class="kk-pill">第${E.required.join("・")}問 必答／第${E.optional[0]}〜${E.optional[E.optional.length - 1]}問から <b>${E.pick}問</b></span>`
            : `<span class="kk-pill">全問 <b>必答</b></span>`,
        WB ? `<span class="kk-pill">点数集計（このサイトの利用者）の数字で比べます</span>`
           : `<span class="kk-pill">受験者 <b>${comma(E.n)}</b>人・平均 <b>${E.mean}</b>点</span>`,
      ].join("");
      q("#kk-srcnote").textContent = WB
        ? "問題集の問題文・解答は、ここには載せていません。手元の問題集で解いて、大問ごとの得点を入れてください。"
        : "問題文と正解は、ここには載せていません。大学入試センターの「過去問題」のページから開いてください（古い年度は、センターのサイトから消えていることがあります）。";
      q("#kk-oxnote").textContent = WB
        ? "問題集の解答で採点して、大問ごとの得点を入れてください。配点は本番の配点を入れてあります。問題集で違うときは直してください。"
        : "センターの正解と照らし合わせて、採点の単位ごとに ○ か × を押してください。「ア–ウ」のようにまとめて採点する欄は、全部合っていれば ○ です。× を押したら、落とした理由も1つ選んでください。全国の正答率は、○× をつけた欄だけに出ます（解いている途中に見えないように）。";
      q("#kk-devlabel").textContent = WB ? "本番換算の偏差値" : "全国の中での偏差値";
      q("#kk-ranklabel").textContent = WB ? "このサイトの中での順位" : "全国の順位";
      q("#kk-minidevlabel").textContent = WB ? "本番換算" : "全国偏差値";
      q("#kk-minitoplabel").textContent = WB ? "サイト内の上位" : "全国の上位";
      q("#kk-avglegend").textContent = WB ? "このサイトの人の得点率（点数集計で大問ごとを入れた人）" : "全国平均（選択問題は、その大問を選んだ人の平均）";
      q("#kk-whysec").hidden = WB;
      if (WB) loadWB();
      q("#kk-selcard").hidden = !opt;
      q("#kk-selnote").textContent = opt ? `第${E.optional.join("・")}問から${E.pick}問` : "";
      const base = opt ? 1 : 0;
      q('[data-n="ox"]').textContent = base + 1;
      q('[data-n="timer"]').textContent = base + 1;
      q('[data-n="report"]').textContent = base + 2;
      q("#kk-limit").textContent = `制限 ${E.minutes}分`;
      q("#kk-goalnote").textContent = `目安は配点に合わせた仮の数字です（合計 ${E.minutes - REVIEW_MIN}分前後＋見直し ${REVIEW_MIN}分）。数字を押して書きかえられます。`;
      q("#kk-stagesec").hidden = !E.items.some(it => it[4]);
      q("#kk-hostnote").innerHTML = host.hostNote ? host.hostNote(E) : "";
      q("#kk-peerlabel").textContent = WB ? "このサイトの中での偏差値" : (host.peerLabel || "仲間の中での偏差値");
      q("#kk-onlyprev").checked = false;
      q("#kk-flash").hidden = true;
      PEERS = null;
      drawAll();
      if (!WB) loadPeers();
    }
    function loadPeers() {
      const asked = E.id;   // 読み込み中に別の過去問へ切りかえても、取り違えない
      if (host.peers) host.peers(E).then(p => { if (asked !== E.id) return; PEERS = Object.assign({}, p, {examId: asked}); drawPeer(); })
        .catch(() => { if (asked === E.id) { PEERS = {error: true, examId: asked}; drawPeer(); } });
    }
    q("#kk-exam").innerHTML = `<optgroup label="過去問（本試験）">` + EXAMS.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join("") + `</optgroup>` +
      (WB_ON ? `<optgroup label="予想問題集（大問ごとに点数を入れる）">` + WORKBOOKS.flatMap(([id, name]) => Object.entries(WB_PARTS).map(([part, P]) =>
        `<option value="wb-${id}-${part}">${esc(name)}　${P.label}</option>`)).join("") + `</optgroup>` : "");
    q("#kk-round").innerHTML = Array.from({length: WB_ROUNDS}, (_, i) => `<option value="${i + 1}">第${i + 1}回</option>`).join("");
    function pickChanged() {
      const v = q("#kk-exam").value;
      const id = v.startsWith("wb-") ? `${v}-${q("#kk-round").value || 1}` : v;
      if (host.kind === "public") history.replaceState(null, "", "?exam=" + id);
      loadExam(id);
    }
    q("#kk-exam").addEventListener("change", pickChanged);
    q("#kk-round").addEventListener("change", pickChanged);

    // ------------------------------------------------ 時間
    const spent = k => (S.acc[k] || 0) + (S.cur === k && S.since ? Date.now() - S.since : 0);
    const totalMs = () => Object.values(S.acc).reduce((a, v) => a + v, 0) + (S.cur && S.since ? Date.now() - S.since : 0);
    function commit() { if (S.cur && S.since) { S.acc[S.cur] = (S.acc[S.cur] || 0) + Date.now() - S.since; S.since = Date.now(); } }
    function switchTo(k) { commit(); S.cur = k; S.since = Date.now(); S.started = true; save(); drawTimer(); }
    function toggleRun() {
      if (S.since) { commit(); S.since = null; }
      else { if (!S.cur) S.cur = chosen()[0]; S.since = Date.now(); S.started = true; }
      save(); drawTimer();
    }
    function drawTimer() {
      const total = totalMs(), limit = E.minutes * 60000, over = total > limit;
      const C = 552.92;
      q("#kk-ringfill").style.strokeDashoffset = String(C * (1 - Math.min(1, total / limit)));
      q("#kk-ring").classList.toggle("is-over", over);
      q("#kk-clock").textContent = fmt(total);
      q("#kk-clocksub").textContent = over ? `${fmt(total - limit)} 超過` : `残り ${fmt(limit - total)}`;
      const label = S.since ? "一時停止" : (S.started ? "再開" : "開始");
      q("#kk-start").textContent = label;
      q("#kk-dockbtn").textContent = label;
      const now = S.cur ? (S.since ? `<span class="kk-live"></span>いま <b>${labelOf(S.cur)}</b>` : `一時停止中（${labelOf(S.cur)}）`)
        : `「開始」で第${chosen()[0]}問から計ります。大問を移るときは、下のその大問を押してください。`;
      q("#kk-now").innerHTML = now;
      q("#kk-dockclock").textContent = fmt(total);
      q("#kk-docknow").innerHTML = S.cur ? (S.since ? `いま ${labelOf(S.cur)}` : `一時停止中`) : `${E.minutes}分`;
      q("#kk-dock").classList.toggle("is-over", over);
      const keys = [...chosen(), "rev"];
      const list = q("#kk-qlist");
      if (list.dataset.keys !== keys.join()) {
        list.dataset.keys = keys.join();
        list.innerHTML = keys.map(k => `<div class="kk-qrow" role="button" tabindex="0" data-k="${k}">
            <span class="kk-qname">${labelOf(k)}${k === "rev" ? "" : `<span class="kk-faint" style="font-weight:400"> ${QMAX[k]}点</span>`}</span>
            <span class="kk-qtime" data-t></span>
            ${k === "rev" ? "" : `<span class="kk-goal">目安 <input type="number" min="1" max="${E.minutes}" data-goal="${k}" aria-label="第${k}問の目安（分）"> 分</span><span class="kk-qbar"><i></i></span>`}
          </div>`).join("");
      }
      for (const row of list.children) {
        const k = row.dataset.k === "rev" ? "rev" : +row.dataset.k;
        const t = spent(k);
        row.querySelector("[data-t]").textContent = fmt(t);
        row.classList.toggle("is-on", S.cur === k && !!S.since);
        if (k !== "rev") {
          const g = S.goals[k] * 60000;
          row.classList.toggle("is-over", t > g);
          row.querySelector(".kk-qbar i").style.width = Math.min(100, t / g * 100) + "%";
          const inp = row.querySelector("input");
          if (document.activeElement !== inp) inp.value = S.goals[k];
        }
      }
    }
    q("#kk-qlist").addEventListener("click", e => {
      if (e.target.closest(".kk-goal")) return;   // 目安の入力欄は、大問の切りかえにしない
      const r = e.target.closest(".kk-qrow"); if (!r) return;
      switchTo(r.dataset.k === "rev" ? "rev" : +r.dataset.k);
    });
    q("#kk-qlist").addEventListener("keydown", e => {
      const r = e.target.closest(".kk-qrow");
      if (r && e.target === r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); switchTo(r.dataset.k === "rev" ? "rev" : +r.dataset.k); }
    });
    q("#kk-qlist").addEventListener("change", e => {
      const n = e.target.dataset.goal; if (!n) return;
      const v = Math.max(1, Math.min(E.minutes, Math.round(+e.target.value) || defaultGoal(+n)));
      S.goals[n] = v; e.target.value = v; save(); drawTimer(); drawReport();
    });
    q("#kk-start").addEventListener("click", toggleRun);
    q("#kk-dockbtn").addEventListener("click", toggleRun);
    q("#kk-reset").addEventListener("click", () => {
      if (!confirm("時間と ○× を消して、最初からにしますか？（記録したものは消えません）")) return;
      const goals = S.goals, sel = S.sel;
      S = fresh(); S.goals = goals; S.sel = sel;
      q("#kk-flash").hidden = true;
      save(); drawAll();
    });
    setInterval(() => { if (!S || !S.since) return; drawTimer(); if (++tick % 4 === 0) { drawMini(); drawReport(); } }, 250);

    // ------------------------------------------------ 選ぶ大問
    function drawSel() {
      q("#kk-choices").innerHTML = E.optional.map(n => {
        const on = S.sel.includes(n);
        return `<label class="kk-choice ${on ? "is-on" : ""}"><input type="checkbox" data-sel="${n}" ${on ? "checked" : ""}>` +
          `<b>第${n}問</b>${esc(E.qs[n - 1][1])}</label>`;
      }).join("");
      q("#kk-selmsg").textContent = !E.optional.length || S.sel.length === E.pick ? "" : `いま ${S.sel.length}問 選んでいます。${E.pick}問にしてください。`;
    }
    q("#kk-choices").addEventListener("change", e => {
      const n = +e.target.dataset.sel; if (!n) return;
      if (e.target.checked) { if (!S.sel.includes(n)) S.sel.push(n); } else S.sel = S.sel.filter(x => x !== n);
      if (S.sel.length > E.pick) S.sel = S.sel.filter(x => x !== n).slice(-(E.pick - 1)).concat(n);   // 多く選んだら、いちばん前のを外す
      save(); drawAll();
    });

    // ------------------------------------------------ ○×
    function qScore(n) {
      let got = 0, done = 0, all = 0;
      if (WB) { const v = S.wbScore[n]; return {got: v === undefined ? 0 : v, done: v === undefined ? 0 : 1, all: 1}; }
      E.items.forEach((it, i) => { if (it[0] !== n) return; all++; if (S.marks[i]) done++; if (S.marks[i] === "o") got += it[2]; });
      return {got, done, all};
    }
    function drawOX() {
      if (WB) {   // 予想問題集：大問ごとに「得点 / 配点」
        q("#kk-onlyprev-wrap").hidden = true;
        q("#kk-ox").innerHTML = chosen().map(n => `<div class="kk-qcard"><div class="kk-qhead"><h4>第${n}問<span class="kk-qfield">${esc(E.qs[n - 1][1])}</span></h4>` +
          `<span class="kk-qscore" data-qs="${n}"></span></div><div class="kk-wbrow">` +
          `<label>得点 <input type="number" min="0" step="1" inputmode="numeric" data-wbs="${n}" value="${S.wbScore[n] === undefined ? "" : S.wbScore[n]}" aria-label="第${n}問の得点"></label>` +
          `<span class="kk-faint">/</span><label>配点 <input type="number" min="1" step="1" inputmode="numeric" data-wbm="${n}" value="${QMAX[n]}" aria-label="第${n}問の配点"></label>` +
          `</div></div>`).join("");
        drawQScores();
        return;
      }
      const prev = lastRec();
      const prevX = prev && prev.marks ? new Set(Object.keys(prev.marks).filter(i => prev.marks[i] === "x").map(Number)) : new Set();
      q("#kk-onlyprev-wrap").hidden = prevX.size === 0;
      const only = q("#kk-onlyprev").checked && prevX.size > 0;
      const html = chosen().map(n => {
        const rows = E.items.map((it, i) => [it, i]).filter(([it, i]) => it[0] === n && (!only || prevX.has(i))).map(([it, i]) => {
          const m = S.marks[i];
          return `<div class="kk-item ${m ? "is-" + m : ""}">
              <div class="kk-lab">${esc(it[1])}${prevX.has(i) ? '<span class="kk-prevx">前回 ×</span>' : ""}</div>
              <div class="kk-pts">${it[2]}点</div>
              <div class="kk-rate">${m ? `<span class="kk-track"><i style="width:${it[3]}%"></i></span>${it[3].toFixed(1)}%` : `<span class="kk-faint">採点後に正答率</span>`}</div>
              <div class="kk-ox" role="group" aria-label="${esc(it[1])}"><button type="button" class="kk-o" data-i="${i}" data-m="o" aria-pressed="${m === "o"}" aria-label="${esc(it[1])} 正解">○</button><button type="button" class="kk-x" data-i="${i}" data-m="x" aria-pressed="${m === "x"}" aria-label="${esc(it[1])} 不正解">×</button></div>
              ${m === "x" ? `<div class="kk-why"><span>理由</span>${WHYS.map(w => `<button type="button" data-why="${i}" data-w="${w}" aria-pressed="${S.why[i] === w}">${w}</button>`).join("")}</div>` : ""}
            </div>`;
        }).join("");
        if (only && !rows) return "";
        return `<div class="kk-qcard"><div class="kk-qhead"><h4>第${n}問<span class="kk-qfield">${esc(E.qs[n - 1][1])}</span></h4>` +
          `<span class="kk-qprog" data-qp="${n}"><i></i></span><span class="kk-qscore" data-qs="${n}"></span></div>${rows}</div>`;
      }).join("");
      q("#kk-ox").innerHTML = html || `<p class="kk-muted" style="margin-top:12px">表示する欄がありません。</p>`;
      drawQScores();
    }
    function drawQScores() {
      root.querySelectorAll("[data-qs]").forEach(el => {
        const r = qScore(+el.dataset.qs);
        el.innerHTML = `${r.done ? r.got : "—"}<small> / ${QMAX[el.dataset.qs]}</small>`;
      });
      root.querySelectorAll("[data-qp]").forEach(el => {
        const r = qScore(+el.dataset.qp);
        el.firstChild.style.width = (r.all ? r.done / r.all * 100 : 0) + "%";
        el.title = `採点 ${r.done} / ${r.all}`;
      });
      const R = result();
      q("#kk-oxcount").textContent = `採点 ${R.done} / ${R.all}`;
    }
    q("#kk-ox").addEventListener("click", e => {
      const w = e.target.closest("button[data-why]");
      if (w) {
        const i = +w.dataset.why;
        S.why[i] = S.why[i] === w.dataset.w ? undefined : w.dataset.w;
        if (!S.why[i]) delete S.why[i];
        w.parentNode.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", S.why[i] === x.dataset.w));
        save(); drawReport(); return;
      }
      const b = e.target.closest("button[data-i]"); if (!b) return;
      const i = +b.dataset.i;
      S.marks[i] = S.marks[i] === b.dataset.m ? undefined : b.dataset.m;   // もう一度押すと取り消し
      if (!S.marks[i]) delete S.marks[i];
      if (S.marks[i] !== "x") delete S.why[i];
      save();
      const keepScroll = window.scrollY;   // 描き直しても、見ている位置を動かさない
      drawOX(); window.scrollTo(0, keepScroll);
      drawMini(); drawReport();
    });
    q("#kk-ox").addEventListener("input", e => {   // 予想問題集の得点・配点
      const n = +(e.target.dataset.wbs || e.target.dataset.wbm || 0); if (!n) return;
      const sv = q(`[data-wbs="${n}"]`).value.trim(), mv = q(`[data-wbm="${n}"]`).value.trim();
      const mx = /^\d+$/.test(mv) && +mv > 0 && +mv <= 100 ? +mv : QMAX[n];
      QMAX[n] = mx; S.wbMax[n] = mx;
      if (/^\d+$/.test(sv)) S.wbScore[n] = Math.min(+sv, mx); else delete S.wbScore[n];
      save(); drawQScores(); drawMini(); drawReport();
    });
    q("#kk-onlyprev").addEventListener("change", () => { drawOX(); drawReport(); });

    // ------------------------------------------------ 成績
    function result() {
      const per = chosen().map(n => ({q: n, ...qScore(n), max: QMAX[n], avg: E.qs[n - 1][3], name: E.qs[n - 1][1], ms: spent(n), goal: S.goals[n]}));
      return {per, total: per.reduce((a, r) => a + r.got, 0), done: per.reduce((a, r) => a + r.done, 0), all: per.reduce((a, r) => a + r.all, 0)};
    }
    function rankOf(x) {
      const higher = E.dist.slice(Math.floor(x) + 1).reduce((a, v) => a + v, 0);
      return {rank: higher + 1, top: higher / E.n * 100, same: E.dist[Math.floor(x)] || 0};
    }
    function wbReport(R) {
      if (!WBS || !WBS.stats || !window.HoshitobuLink) return null;
      const secs = R.per.filter(r => r.done).map(r => ({q: r.q, score: r.got, max: r.max}));
      return window.HoshitobuLink.report(WBS.stats, window.NATIONAL_STATS || {}, E.survey.subject, E.survey.book, E.survey.round, R.total, secs);
    }
    function wbWhy(rep) {
      if (!WBS || WBS.loading) return "点数集計を読み込み中…";
      if (WBS.error) return "点数集計を読み込めませんでした";
      return `この問題集・回の記録が${(WBS.stats && WBS.stats.minN) || 3}人以上になると出ます`;
    }
    function drawMini() {
      const R = result(), on = R.done > 0;
      if (WB) {
        const rp = wbReport(R);
        q("#kk-miniscore").innerHTML = `${on ? R.total : "—"}<small> / 100</small>`;
        q("#kk-miniavg").textContent = rp && rp.ok ? `サイト平均 ${rp.siteMean.toFixed(1)}` : "点数集計と比べます";
        q("#kk-minidev").textContent = on && rp && rp.natDev !== null ? rp.natDev.toFixed(1) : "—";
        q("#kk-minitop").textContent = on && rp && rp.ok ? `${rp.top}%` : "—";
        q("#kk-minirest").textContent = R.done < R.all ? `未入力 ${R.all - R.done}` : "入力おわり";
        return;
      }
      q("#kk-miniscore").innerHTML = `${on ? R.total : "—"}<small> / 100</small>`;
      q("#kk-miniavg").textContent = on ? `平均との差 ${R.total >= E.mean ? "+" : ""}${(R.total - E.mean).toFixed(1)}` : `全国平均 ${E.mean}`;
      q("#kk-minidev").textContent = on ? dev(R.total, E.mean, E.sd).toFixed(1) : "—";
      q("#kk-minitop").textContent = on ? topTxt(rankOf(R.total).top) : "—";
      q("#kk-minirest").textContent = R.done < R.all ? `未採点 ${R.all - R.done}` : "採点おわり";
    }
    function drawPeer() {
      if (WB) return;   // 予想問題集は drawReport で点数集計の数字を出す
      const v = q("#kk-peer"), sub = q("#kk-peersub");
      v.textContent = "—";
      if (!PEERS) { sub.textContent = "読み込み中…"; return; }
      if (PEERS.examId !== E.id) return;
      q("#kk-peerlabel").textContent = PEERS.label || "仲間の中での偏差値";
      if (PEERS.error) { sub.textContent = "読み込めませんでした"; return; }
      // scores（一人ずつの点数）か stats（人数・平均・標準偏差だけ）のどちらかで受け取る
      if (!PEERS.scores && !PEERS.stats) { sub.textContent = PEERS.empty || "この年度は対象外です"; return; }
      const xs = PEERS.scores || [];
      const n = PEERS.stats ? PEERS.stats.n : xs.length, minN = PEERS.minN || 2;
      if (n < minN) { sub.textContent = (PEERS.fewText ? PEERS.fewText(n) : `記録 ${n}人`) + `（${minN}人から出します）`; return; }
      const m = PEERS.stats ? PEERS.stats.mean : xs.reduce((a, x) => a + x, 0) / n;
      const sd = PEERS.stats ? PEERS.stats.sd : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / n);
      if (!(sd > 0)) { sub.textContent = `${n}人（点数がそろいすぎて出せません）`; return; }
      const R = result();
      v.textContent = R.done ? dev(R.total, m, sd).toFixed(1) : "—";
      sub.textContent = `${n}人・平均 ${m.toFixed(1)}点`;
    }
    function bar(label, sub, parts, max, val, cls) {
      const seg = parts.map(([w, c]) => `<span class="${c}" style="width:${max ? w / max * 100 : 0}%"></span>`).join("");
      return `<div class="kk-brow ${cls || ""}"><div class="kk-bname">${label}${sub ? `<small>${sub}</small>` : ""}</div>` +
        `<div class="kk-btrack">${seg}</div><div class="kk-bval">${val}</div></div>`;
    }
    function drawReport() {
      const R = result(), on = R.done > 0;
      const rp = WB ? wbReport(R) : null;
      q("#kk-repnote").textContent = !on ? (WB ? "大問ごとの得点を入れると、ここに出ます" : "○× をつけると、ここに出ます")
        : R.done < R.all ? `未${WB ? "入力" : "採点"} ${R.all - R.done}${WB ? "問" : "個"}（いまの点数で出しています）` : (WB ? "全部の大問を入れました" : "全部の欄を採点しました");
      q("#kk-score").innerHTML = `${on ? R.total : "—"}<small> / 100</small>`;
      if (WB) {
        q("#kk-scoresub").textContent = rp && rp.ok ? `このサイトの平均 ${rp.siteMean.toFixed(1)}点` : "点数集計の数字と比べます";
        q("#kk-dev").textContent = on && rp && rp.natDev !== null ? rp.natDev.toFixed(1) : "—";
        q("#kk-devsub").textContent = rp && rp.natDev !== null ? "このサイトの人が過去問の本試を解いたときの位置から推定"
          : rp && rp.anchor ? `過去問本試の記録が${window.HoshitobuLink.ANCHOR_MIN}人分たまると出ます（いま${rp.anchor.n}人分）` : wbWhy(rp);
        q("#kk-rank").textContent = on && rp && rp.ok ? `${rp.rank}位` : "—";
        q("#kk-ranksub").textContent = rp && rp.ok ? `${rp.n}人中・上位 ${rp.top}%` : wbWhy(rp);
        q("#kk-peer").textContent = on && rp && rp.ok && rp.siteDev !== null ? rp.siteDev.toFixed(1) : "—";
        q("#kk-peersub").textContent = rp && rp.ok ? `${rp.n}人・平均 ${rp.siteMean.toFixed(1)}点` : wbWhy(rp);
      } else {
        q("#kk-scoresub").textContent = `全国平均 ${E.mean}点` + (on ? `（${R.total >= E.mean ? "+" : ""}${(R.total - E.mean).toFixed(1)}）` : "");
        q("#kk-dev").textContent = on ? dev(R.total, E.mean, E.sd).toFixed(1) : "—";
        q("#kk-devsub").textContent = `平均 ${E.mean}点・標準偏差 ${E.sd}`;
        if (on) {
          const k = rankOf(R.total);
          q("#kk-rank").textContent = "上位 " + topTxt(k.top);
          q("#kk-ranksub").textContent = `${comma(E.n)}人中 ${comma(k.rank)}位（同点 ${comma(k.same)}人）`;
        } else { q("#kk-rank").textContent = "—"; q("#kk-ranksub").textContent = `受験者 ${comma(E.n)}人`; }
        drawPeer();
      }
      // 大問ごとの比べる相手：過去問は全国平均、予想問題集はこのサイトの人の得点率
      const siteRate = n => rp && rp.cell && rp.cell.sections ? ((rp.cell.sections.find(c => c.q === n) || {}).rate ?? null) : null;
      const refPct = r => WB ? siteRate(r.q) : r.avg / r.max * 100;
      const refTxt = r => WB ? (siteRate(r.q) === null ? "—" : siteRate(r.q).toFixed(1) + "%") : r.avg.toFixed(1);

      // 前回
      const prev = lastRec(), pv = q("#kk-prev");
      pv.hidden = !prev;
      if (prev) {
        const px = Object.keys(prev.marks || {}).filter(i => prev.marks[i] === "x").map(Number);
        if (q("#kk-onlyprev").checked && px.length) {
          const fixed = px.filter(i => S.marks[i] === "o");
          pv.innerHTML = `解き直し：前回（${md(prev.at)}）× だった <b>${px.length}か所</b>のうち、<span class="kk-up">${fixed.length}か所が ○</span>（+${fixed.reduce((a, i) => a + E.items[i][2], 0)}点ぶん）`;
        } else {
          const d = on ? R.total - prev.total : null;
          pv.innerHTML = `前回（${md(prev.at)}）<b>${prev.total}点</b>・${fmt(prev.ms)}` +
            (d === null ? "" : `　→　今回 <b>${R.total}点</b>（<span class="${d >= 0 ? "kk-up" : "kk-down"}">${d >= 0 ? "+" : ""}${d}</span>）`);
        }
      }

      // 大問ごと
      q("#kk-qtable").innerHTML = `<thead><tr><th>大問</th><th style="width:34%">得点</th><th class="r"></th><th class="r">${WB ? "みんなの得点率" : "全国平均"}</th>` +
        (prev ? `<th class="r">前回</th>` : "") + `<th class="r">時間 / 目安</th><th>解説</th></tr></thead><tbody>` +
        R.per.map(r => {
          const url = (E.videos || {})[r.q];
          const p = prev && prev.per ? prev.per.find(x => x.q === r.q) : null;
          return `<tr><td><b>第${r.q}問</b><div class="kk-faint">${esc(r.name)}</div></td>` +
            `<td><div class="kk-sbar"><i style="width:${r.done ? r.got / r.max * 100 : 0}%"></i>${refPct(r) === null ? "" : `<b style="left:calc(${refPct(r)}% - 1px)"></b>`}</div></td>` +
            `<td class="r"><b>${r.done ? r.got : "—"}</b> / ${r.max}</td><td class="r">${refTxt(r)}</td>` +
            (prev ? `<td class="r">${p ? p.got : "—"}</td>` : "") +
            `<td class="r ${r.ms > r.goal * 60000 ? "kk-over" : ""}">${r.ms ? fmt(r.ms) : "—"} / ${r.goal}分</td>` +
            `<td>${url ? `<a class="kk-vid" href="${esc(url)}" target="_blank" rel="noopener">▶ 解説動画</a>` : `<span class="kk-vid-none">動画は準備中</span>`}</td></tr>`;
        }).join("") +
        `<tr class="kk-total"><td>合計</td><td></td><td class="r">${on ? R.total : "—"} / 100</td><td class="r">${WB ? (rp && rp.ok ? rp.siteMean.toFixed(1) : "—") : E.mean}</td>` +
        (prev ? `<td class="r">${prev.total}</td>` : "") + `<td class="r">${fmt(totalMs())} / ${E.minutes}分</td><td></td></tr></tbody>`;

      // 力の種類
      if (!q("#kk-stagesec").hidden) {
        const st = {};
        E.items.forEach((it, i) => {
          if (!chosen().includes(it[0]) || !it[4]) return;
          const t = st[it[4]] || (st[it[4]] = {pts: 0, got: 0, lost: 0, rate: 0, n: 0});
          t.pts += it[2]; t.rate += it[3]; t.n++;
          if (S.marks[i] === "o") t.got += it[2];
          if (S.marks[i] === "x") t.lost += it[2];
        });
        const ks = Object.keys(STAGES).filter(k => st[k]);
        const maxLost = Math.max(0, ...ks.map(k => st[k].lost));
        q("#kk-stages").innerHTML = ks.map(k => {
          const t = st[k];
          return bar(k, STAGES[k], [[t.got, "is-got"], [t.lost, "is-lost"]], t.pts,
            `<b>${t.lost ? "−" + t.lost : "0"}</b> / ${t.pts}点`, t.lost && t.lost === maxLost ? "is-top" : "");
        }).join("") + `<div class="kk-legend"><span><i style="background:var(--kk-ok)"></i>取れた点</span><span><i style="background:var(--kk-warn)"></i>落とした点</span><span>右の数字：落とした点 / 配点</span></div>`;
      }

      // 落とした理由
      const now = {}, all = {};
      const add = (o, w, p) => { const k = w || "理由なし"; o[k] = (o[k] || 0) + p; };
      E.items.forEach((it, i) => { if (S.marks[i] === "x" && chosen().includes(it[0])) add(now, S.why[i], it[2]); });
      EXAMS.forEach(ex => (H[ex.id] || []).forEach(r => {
        if (!r.marks || r.at === S.savedAt) return;
        Object.keys(r.marks).forEach(i => { if (r.marks[i] === "x" && ex.items[i]) add(all, (r.why || {})[i], ex.items[i][2]); });
      }));
      Object.keys(now).forEach(k => add(all, k === "理由なし" ? "" : k, now[k]));
      const wk = [...WHYS, "理由なし"].filter(k => now[k] || all[k]);
      const sumAll = Object.values(all).reduce((a, v) => a + v, 0);
      const maxAll = Math.max(0, ...wk.map(k => all[k] || 0));
      q("#kk-whys").innerHTML = wk.length ? wk.map(k => bar(k, now[k] ? `今回 −${now[k]}点` : "今回 なし",
          [[all[k] || 0, "is-why"]], maxAll, `<b>−${all[k] || 0}</b>（${sumAll ? Math.round((all[k] || 0) / sumAll * 100) : 0}%）`)).join("")
        : `<p class="kk-muted">× をつけて理由を選ぶと、ここに出ます。</p>`;

      // 予想問題集：復習すべき大問（このサイトの人の得点率と比べる）
      q("#kk-misstitle").textContent = WB ? "復習すべき大問" : "落とした所";
      q("#kk-missnote").textContent = WB
        ? `このサイトの人の得点率より ${window.HoshitobuLink ? window.HoshitobuLink.GAP : 15}ポイント以上低い大問を、差の大きい順に出しています。`
        : "全国の正答率が 70％以上なのに × だった所が、いちばん取り返しやすい所です。";
      if (WB) {
        const rv = rp && rp.review ? rp.review : [];
        q("#kk-miss").innerHTML = rv.length ? rv.map(r =>
          `<li class="${r.ref >= 60 ? "is-easy" : ""}"><b>第${r.q}問</b><span class="kk-faint">あなた ${r.mine.toFixed(1)}%</span>` +
          `${r.ref >= 60 ? '<span class="kk-tag">みんなが取れている所</span>' : ""}<span class="kk-mrate">みんな ${r.ref.toFixed(1)}%</span></li>`).join("")
          : `<li class="kk-muted" style="background:none;border:0;padding:0">${!on ? "大問ごとの得点を入れると出ます。" : rp && rp.cell && rp.cell.sections ? "みんなと比べて大きく落とした大問はありません。" : "点数集計で、この回の大問ごとの点数を送った人が3人以上になると出ます。"}</li>`;
      }
      // 落とした所
      const miss = [];
      E.items.forEach((it, i) => { if (S.marks[i] === "x" && chosen().includes(it[0])) miss.push([it, S.why[i]]); });
      miss.sort((a, b) => b[0][3] - a[0][3]);
      if (!WB) q("#kk-miss").innerHTML = miss.length ? miss.map(([it, w]) =>
        `<li class="${it[3] >= 70 ? "is-easy" : ""}"><b>第${it[0]}問 ${esc(it[1])}</b><span class="kk-faint">${it[2]}点${w ? "・" + esc(w) : ""}</span>` +
        `${it[3] >= 70 ? '<span class="kk-tag">取り返しやすい</span>' : ""}<span class="kk-mrate">全国 ${it[3].toFixed(1)}%</span></li>`).join("")
        : `<li class="kk-muted" style="background:none;border:0;padding:0">× をつけた欄は、まだありません。</li>`;

      // 記録ボタンの上の選択肢（スケジューラの学習時間など）
      const so = q("#kk-saveopts");
      const html = host.saveOptions ? host.saveOptions(E, Math.round(totalMs() / 60000)) : "";
      if (so.dataset.html !== html) {
        const prevChecked = so.querySelector("input") ? so.querySelector("input").checked : null;
        so.innerHTML = html; so.dataset.html = html;
        if (prevChecked !== null && so.querySelector("input")) so.querySelector("input").checked = prevChecked;
      }
    }

    // ------------------------------------------------ 記録
    function flash(msg, warn) { const f = q("#kk-flash"); f.hidden = false; f.classList.toggle("is-warn", !!warn); f.textContent = msg; }
    q("#kk-save").addEventListener("click", async () => {
      commit();
      const R = result();
      if (!R.done) { flash(WB ? "先に大問ごとの得点を入れてください。" : "先に ○× をつけてください。", true); return; }
      const marks = {}, why = {};
      const rp = WB ? wbReport(R) : null;
      E.items.forEach((it, i) => { if (chosen().includes(it[0]) && S.marks[i]) { marks[i] = S.marks[i]; if (S.why[i]) why[i] = S.why[i]; } });
      const at = new Date().toISOString();
      const rec = {at, replaces: S.savedAt || null, total: R.total,
                   dev: WB ? (rp && rp.natDev !== null ? +rp.natDev.toFixed(1) : null) : +dev(R.total, E.mean, E.sd).toFixed(1),
                   top: WB ? null : +rankOf(R.total).top.toFixed(2),
                   ms: Math.round(totalMs()), sel: S.sel.slice().sort((a, b) => a - b),
                   per: R.per.map(r => ({q: r.q, got: r.got, max: r.max, name: r.name, ms: Math.round(r.ms), done: r.done})),
                   marks, why, complete: R.done === R.all};
      const prev = lastRec();
      const btn = q("#kk-save"); btn.disabled = true; btn.textContent = "記録しています…";
      try {
        const extras = host.readSaveOptions ? host.readSaveOptions(root) : {};
        const res = await host.saveRecord(E, rec, extras);
        H[E.id] = res.history;
        S.savedAt = at; save(); if (WB) { WBS = null; loadWB(); } else loadPeers();
        flash(`記録しました（${R.total}点）。` + (prev ? `前回より ${R.total - prev.total >= 0 ? "+" : ""}${R.total - prev.total}点。` : "") +
          (res.message ? res.message + " " : "") + "もう一度解くときは「リセット」を押してから始めてください。");
        drawAll();
      } catch (err) {
        flash("記録できませんでした：" + (err && err.message ? err.message : err), true);
      } finally { btn.disabled = false; btn.textContent = "この結果を記録する"; }
    });
    function drawHist() {
      const h = hist();
      q("#kk-histempty").hidden = h.length > 0;
      q("#kk-histnote").textContent = h.length ? `${h.length}回` : "";
      q("#kk-hist").innerHTML = h.length ? `<thead><tr><th>日時</th><th class="r">得点</th><th class="r">${WB ? "本番換算" : "全国偏差値"}</th><th class="r">上位</th><th class="r">時間</th><th>選んだ大問</th><th></th></tr></thead><tbody>` +
        h.map((r, i) => [r, i]).reverse().map(([r]) => {
          const d = new Date(r.at);
          const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          return `<tr><td>${when}</td><td class="r"><b>${r.total}</b>${r.complete ? "" : '<span class="kk-faint">（途中）</span>'}</td><td class="r">${r.dev === null || r.dev === undefined ? "—" : (+r.dev).toFixed(1)}</td>` +
            `<td class="r">${r.top === undefined || r.top === null ? "—" : topTxt(+r.top)}</td><td class="r">${fmt(r.ms || 0)}</td>` +
            `<td>${r.sel && r.sel.length ? r.sel.map(n => "第" + n + "問").join("・") : "全問"}</td>` +
            `<td class="r"><button type="button" class="kk-link" data-del="${esc(r.at)}">消す</button></td></tr>`;
        }).join("") + "</tbody>" : "";
    }
    q("#kk-hist").addEventListener("click", async e => {
      const at = e.target.dataset.del; if (!at) return;
      if (!confirm("この記録を消しますか？")) return;
      try { const res = await host.deleteRecord(E, at); H[E.id] = res.history; if (S.savedAt === at) { S.savedAt = null; save(); } drawAll(); loadPeers(); }
      catch (err) { flash("消せませんでした：" + (err && err.message ? err.message : err), true); }
    });

    // ------------------------------------------------ 成績表を画像で保存（1200×675、動画・SNS向けの16:9）
    q("#kk-png").addEventListener("click", () => {
      const R = result();
      if (!R.done) { flash(WB ? "先に大問ごとの得点を入れてください。" : "先に ○× をつけてください。", true); return; }
      const rp = WB ? wbReport(R) : null;
      const W = 1200, Hh = 675, c = document.createElement("canvas");
      c.width = W; c.height = Hh;
      const g = c.getContext("2d");
      const F = '"Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif';
      const ink = "#141a2b", sub = "#5d6680", acc = "#3559c7", line = "#e7eaf1", warn = "#d24343", ok = "#138a63";
      g.fillStyle = "#f5f6fa"; g.fillRect(0, 0, W, Hh);
      const rr = (x, y, w, h, r, fill) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fillStyle = fill; g.fill(); };
      rr(28, 28, W - 56, Hh - 56, 26, "#fff");
      g.textBaseline = "alphabetic";
      g.fillStyle = acc; g.font = `700 18px ${F}`; g.fillText("成績表", 64, 82);
      g.fillStyle = ink; g.font = `800 30px ${F}`; g.fillText(E.title.replace("　", " "), 64, 120);
      const d = new Date();
      g.fillStyle = sub; g.font = `18px ${F}`;
      g.fillText(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}　時間 ${fmt(totalMs())} / ${E.minutes}分` + (R.done < R.all ? "　（採点の途中）" : ""), 64, 152);
      const k = WB ? null : rankOf(R.total);
      const tiles = WB
        ? [["得点", `${R.total}`, "/ 100点", true],
           ["本番換算の偏差値", rp && rp.natDev !== null ? rp.natDev.toFixed(1) : "—", "このサイトの人の本試の位置から推定", false],
           ["このサイトの中", rp && rp.ok ? `${rp.rank}位` : "—", rp && rp.ok ? `${rp.n}人中・平均 ${rp.siteMean.toFixed(1)}点` : "記録が少ないため出せません", false]]
        : [["得点", `${R.total}`, "/ 100点", true], ["全国偏差値", dev(R.total, E.mean, E.sd).toFixed(1), `平均 ${E.mean}点`, false],
           ["全国の順位", "上位 " + topTxt(k.top), `${comma(E.n)}人中 ${comma(k.rank)}位`, false]];
      tiles.forEach((t, i) => {
        const x = 64 + i * 362, y = 178;
        rr(x, y, 344, 128, 18, t[3] ? acc : "#f1f4fb");
        g.fillStyle = t[3] ? "rgba(255,255,255,.85)" : sub; g.font = `600 18px ${F}`; g.fillText(t[0], x + 22, y + 36);
        g.fillStyle = t[3] ? "#fff" : ink; g.font = `800 ${t[1].length > 7 ? 40 : 52}px ${F}`; g.fillText(t[1], x + 22, y + 94);
        g.fillStyle = t[3] ? "rgba(255,255,255,.85)" : sub; g.font = `17px ${F}`; g.fillText(t[2], x + 22, y + 118);
      });
      const bx = 64, by = 352, bw = 690, rh = Math.min(40, 236 / R.per.length);
      g.fillStyle = ink; g.font = `700 20px ${F}`; g.fillText("大問ごと", bx, by);
      R.per.forEach((r, i) => {
        const y = by + 16 + i * rh, w = bw - 180, bh = Math.min(16, rh - 16);
        g.fillStyle = ink; g.font = `18px ${F}`; g.fillText(`第${r.q}問`, bx, y + rh * 0.62);
        rr(bx + 84, y + (rh - bh) / 2, w, bh, bh / 2, line);
        if (r.got) rr(bx + 84, y + (rh - bh) / 2, Math.max(bh, w * r.got / r.max), bh, bh / 2, acc);
        const ref = WB ? (rp && rp.cell && rp.cell.sections ? ((rp.cell.sections.find(c => c.q === r.q) || {}).rate ?? null) : null) : r.avg / r.max * 100;
        if (ref !== null) { g.fillStyle = warn; g.fillRect(bx + 84 + w * ref / 100 - 1.5, y + (rh - bh) / 2 - 5, 3, bh + 10); }
        g.fillStyle = ink; g.font = `700 18px ${F}`; g.fillText(`${r.got} / ${r.max}`, bx + 100 + w, y + rh * 0.62);
      });
      g.fillStyle = warn; g.fillRect(bx, Hh - 76, 3, 14);
      g.fillStyle = sub; g.font = `15px ${F}`;
      g.fillText(WB ? "＝このサイトの人の得点率" : "＝全国平均（選択問題は、その大問を選んだ人の平均）", bx + 10, Hh - 64);
      const rx = 806;
      g.fillStyle = ink; g.font = `700 20px ${F}`; g.fillText(WB ? "復習すべき大問" : "落とした理由", rx, by);
      const now = {};
      if (WB) (rp && rp.review ? rp.review : []).forEach(r => { now[`第${r.q}問`] = `${r.mine.toFixed(0)}%／みんな${r.ref.toFixed(0)}%`; });
      else E.items.forEach((it, i) => { if (S.marks[i] === "x" && chosen().includes(it[0])) { const w = S.why[i] || "理由なし"; now[w] = (now[w] || 0) + it[2]; } });
      const ks = Object.keys(now).sort((a, b) => WB ? 0 : now[b] - now[a]);
      if (!ks.length) { g.fillStyle = sub; g.font = `18px ${F}`; g.fillText(WB ? "とくになし" : "× なし", rx, by + 42); }
      ks.slice(0, 6).forEach((w, i) => {
        const y = by + 44 + i * 40;
        g.fillStyle = ink; g.font = `18px ${F}`; g.fillText(w, rx, y);
        g.fillStyle = warn; g.font = `800 ${WB ? 15 : 18}px ${F}`; g.textAlign = "right"; g.fillText(WB ? now[w] : `−${now[w]}点`, W - 64, y); g.textAlign = "left";
        g.fillStyle = line; g.fillRect(rx, y + 12, W - 64 - rx, 1);
      });
      g.fillStyle = ok; g.font = `700 15px ${F}`; g.textAlign = "right";
      g.fillText("星飛ぶの勉強部屋　過去問演習", W - 64, Hh - 64);
      g.fillStyle = sub; g.font = `13px ${F}`;
      g.fillText(WB ? "比べた数字：点数集計（このサイトの利用者）・大学入試センター" : "出典：大学入試センター（平均点・標準偏差・成績分布）", W - 64, Hh - 44);
      g.textAlign = "left";
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `成績表_${E.id}_${d.getMonth() + 1}${String(d.getDate()).padStart(2, "0")}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    });

    // ------------------------------------------------ はじめに
    function drawAll() { drawSel(); drawTimer(); drawOX(); drawMini(); drawReport(); drawHist(); }
    // 予想問題集の画面を、ほかの場所（集計に送ったあとなど）から描き直す
    const refreshWB = () => { if (WB) { WBS = null; loadWB(); } };
    const want = (opt.initialExam) || store.get("lastExam") || (EXAMS[0] && EXAMS[0].id);
    const startId = EXAMS.some(e => e.id === want) || (WB_ON && /^wb-\w+-(IIBC|IA)-\d$/.test(want || "")) ? want : EXAMS[0].id;
    Promise.resolve(host.loadHistory ? host.loadHistory() : {}).catch(() => ({})).then(h => { H = h || {}; loadExam(startId); });
    return {reload: () => Promise.resolve(host.loadHistory()).then(h => { H = h || {}; drawAll(); }), current: () => E && E.id, refreshWB};
  }

  window.Kakomon = {mount};
})();
