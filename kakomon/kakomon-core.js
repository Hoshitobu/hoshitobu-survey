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

  // 予想問題集（点数集計の問題集・科目・配点の初期値と同じ。kakomon-data.js の KAKOMON_WB）。
  // 設問ごとのデータはないので、大問ごとに点数を入れる。ID は wb-問題集-科目-回（数学は前からの IA／IIBC のまま）
  const WB_ID = /^wb-([a-z]+)-([A-Za-z0-9_]+)-(\d+)$/;
  const wbCode = s => s.part || s.sid;
  function workbookExam(WBD, book, code, round) {
    const b = (WBD.books || []).find(x => x.id === book), s = (WBD.subjects || []).find(x => wbCode(x) === code);
    if (!b || !s || !(round >= 1 && round <= (WBD.rounds || 6))) return null;
    return {id: `wb-${book}-${code}-${round}`, kind: "workbook", mode: "sections", book, bookName: b.name, sid: s.sid, part: s.part, round,
            subject: s.subject, label: s.label, title: `${b.name}　${s.label}　第${round}回`, minutes: s.minutes, full: s.full,
            required: s.required, optional: s.optional, pick: s.pick, mean: null, sd: null, n: null, dist: null,
            qs: s.max.map((mx, i) => [i + 1, s.names[i] || (s.optional.includes(i + 1) ? "選択" : ""), mx, null]), items: [], videos: {},
            survey: {subject: s.subject, book: b.name, round, subjectId: s.sid, bookId: b.id}};
  }

  function mount(root, opt) {
    const STAGES = opt.stages || {}, host = opt.host;
    const EXAMS = (opt.exams || []).map(e => Object.assign({mode: "items", full: 100}, e));
    const WBD = opt.wb || window.KAKOMON_WB || {books: [], subjects: [], rounds: 6};
    const WB_ON = opt.workbooks !== false && WBD.books.length > 0;   // 予想問題集（点数集計の数字で比べる）を選べるようにするか
    const store = host.store;
    // E＝いまの試験。WB＝予想問題集、SEC＝大問ごとに点数を入れる、NATR＝全国の成績分布がある（全国の順位を出せる）
    let E = null, QMAX = {}, S = null, H = {}, PEERS = null, tick = 0, WB = false, SEC = false, NATR = false, WBS = null;
    const q = sel => root.querySelector(sel);
    const NAT = () => E.mean !== null && E.mean !== undefined && E.sd > 0;   // 全国の平均点・標準偏差がある
    const subjName = e => e.part === "IIB" ? "数学IIB" : e.subject;

    root.classList.add("kk");
    root.innerHTML = `
<section class="kk-card">
  <div class="kk-hero">
    <div>
      <div class="kk-hero-label">解く過去問・問題集</div>
      <div class="kk-tabs" role="tablist" id="kk-tabs">
        <button type="button" role="tab" data-tab="past">共通テストの過去問</button>
        <button type="button" role="tab" data-tab="wb">予想問題集</button>
      </div>
      <div class="kk-pick" id="kk-pickpast">
        <label class="kk-select-wrap"><span>年度</span><select class="kk-select" id="kk-year"></select></label>
        <label class="kk-select-wrap"><span>試験</span><select class="kk-select" id="kk-kind"></select></label>
        <label class="kk-select-wrap kk-grow"><span>科目</span><select class="kk-select" id="kk-subj"></select></label>
      </div>
      <div class="kk-pick" id="kk-pickwb" hidden>
        <label class="kk-select-wrap kk-grow"><span>問題集</span><select class="kk-select" id="kk-book"></select></label>
        <label class="kk-select-wrap kk-grow"><span>科目</span><select class="kk-select" id="kk-wbsubj"></select></label>
        <label class="kk-select-wrap"><span>回</span><select class="kk-select" id="kk-round"></select></label>
      </div>
    </div>
    <div class="kk-hero-actions">
      <a class="kk-btn kk-btn-secondary" id="kk-dnc" href="https://www.dnc.ac.jp/kyotsu/kakomondai/" target="_blank" rel="noopener">問題と正解（大学入試センター）↗</a>
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

<p class="kk-foot">出典：大学入試センター「実施結果の概要」「科目別成績分布」「設問別得点率及び正答率」「正解（配点）」。平均点・標準偏差は、センターの公表値を kyotsu.org がまとめたものも使っています。偏差値は (得点 − 平均点) ÷ 標準偏差 × 10 ＋ 50 で計算した目安です。全国の順位は、科目別成績分布（1点ごとの人数）がある 2023〜2026年の本試験だけで数えています。「みんなの正答率」は、このサイトで解いて点数集計に送った人の ○× から出しています。</p>

<div class="kk-dock" id="kk-dock"><div class="kk-clock" id="kk-dockclock">00:00</div><div class="kk-dock-now" id="kk-docknow"></div><button type="button" class="kk-btn kk-btn-primary" id="kk-dockbtn">開始</button></div>`;

    // ------------------------------------------------ 過去問の切りかえ
    const hist = () => H[E.id] || [];
    const lastRec = () => { const h = hist().filter(r => r.at !== S.savedAt); return h.length ? h[h.length - 1] : null; };
    const evenGoal = () => Math.max(1, Math.round((E.minutes - REVIEW_MIN) / Math.max(1, E.required.length + E.pick)));
    const defaultGoal = n => QMAX[n] ? Math.max(1, Math.round(QMAX[n] * (E.minutes - REVIEW_MIN) / E.full)) : evenGoal();
    const fresh = () => ({sel: E.optional.slice(0, E.pick), marks: {}, why: {}, wbScore: {}, wbMax: {}, acc: {}, cur: null, since: null, started: false, savedAt: null,
                          goals: Object.fromEntries(E.qs.map(x => [x[0], defaultGoal(x[0])]))});
    const save = () => store.set(E.id + ".session", JSON.stringify(S));
    const chosen = () => [...E.required, ...S.sel.slice().sort((a, b) => a - b)];

    function examById(id) {
      const m = WB_ID.exec(id || "");
      if (m && WB_ON) { const w = workbookExam(WBD, m[1], m[2], +m[3]); if (w) return w; }
      return EXAMS.find(e => e.id === id) || null;
    }
    function loadWB(tries) {   // 予想問題集・追試などは、点数集計（Apps Script）の数字で比べる。過去問の「みんなの正答率」も
      if (!window.HoshitobuLink || !E.survey) { WBS = {error: true}; return; }
      if (WBS && !WBS.error && tries === undefined) return;
      WBS = {loading: true};
      const asked = E.id;
      window.HoshitobuLink.stats(true).then(st => { WBS = {stats: st}; }, () => {
        // 一時的に読めないことがあるので、少し間をおいて2回まで読み直す
        const n = (tries || 0) + 1;
        if (n <= 2) { setTimeout(() => { if (asked === E.id) loadWB(n); }, 2500 * n); return; }
        WBS = {error: true};
      }).then(() => { if (asked === E.id && WBS && !WBS.loading) { if (!SEC) drawOX(); drawMini(); drawReport(); } });   // 描くときのエラーを、読み込みの失敗と取り違えない
    }
    // 点数集計のこの欄（科目×問題集×回）
    const siteCell = () => WBS && WBS.stats && E.survey ? (WBS.stats.practice || []).find(c => c.subject === E.survey.subject && c.book === E.survey.book &&
      (c.round === null ? !E.survey.round : c.round === E.survey.round)) || null : null;
    // 設問の正答率：全国（センターの公表）、なければこのサイトの人の ○×
    function rateOf(i) {
      const it = E.items[i];
      if (it[3] !== null && it[3] !== undefined) return {v: it[3], src: "全国"};
      const c = siteCell(), x = c && c.items ? c.items[i] : null;
      return x && x.rate !== null && x.rate !== undefined ? {v: x.rate, src: "みんな", n: x.n} : null;
    }
    const usesSite = () => WB || SEC || !NATR || E.items.some(it => it[3] === null);
    function loadExam(id) {
      E = examById(id) || EXAMS[0];
      WB = E.kind === "workbook";
      SEC = E.mode === "sections";
      NATR = !WB && !!E.dist && NAT();
      QMAX = Object.fromEntries(E.qs.map(x => [x[0], x[2]]));
      S = fresh();
      try { const raw = store.get(E.id + ".session"); if (raw) S = Object.assign(fresh(), JSON.parse(raw)); } catch (e) {}
      S.sel = S.sel.filter(n => E.optional.includes(n));
      if (SEC) Object.entries(S.wbMax || {}).forEach(([n, mx]) => { if (n in QMAX && mx > 0) QMAX[n] = mx; });   // 配点を直していたら、それを使う
      if (!(E.id in H) && host.historyFor) H[E.id] = host.historyFor(E.id) || [];
      store.set("lastExam", E.id);
      store.set(WB ? "lastWB" : "lastPast", E.id);
      syncPick();
      q("#kk-dnc").hidden = WB;   // 予想問題集は手元の問題集で解く
      const opt = E.optional.length;
      const unknownMax = SEC && E.qs.some(x => !x[2]);
      q("#kk-meta").innerHTML = [
        `<span class="kk-pill">試験時間 <b>${E.minutes}分</b></span>`, `<span class="kk-pill"><b>${E.full}</b>点満点</span>`,
        opt ? `<span class="kk-pill">${E.required.length ? `第${E.required.join("・")}問 必答／` : ""}第${E.optional[0]}〜${E.optional[E.optional.length - 1]}問から <b>${E.pick}問</b></span>`
            : `<span class="kk-pill">全問 <b>必答</b></span>`,
        NATR ? `<span class="kk-pill">受験者 <b>${comma(E.n)}</b>人・平均 <b>${E.mean}</b>点</span>`
          : NAT() ? `<span class="kk-pill">全国平均 <b>${E.mean}</b>点${E.n ? `・受験者 ${comma(E.n)}人` : ""}</span>`
          : `<span class="kk-pill">点数集計（このサイトの利用者）の数字で比べます</span>`,
      ].join("");
      q("#kk-srcnote").textContent = WB
        ? "問題集の問題文・解答は、ここには載せていません。手元の問題集で解いて、大問ごとの得点を入れてください。"
        : "問題文と正解は、ここには載せていません。大学入試センターの「過去問題」のページから開いてください（古い年度は、センターのサイトから消えていることがあります）。";
      q("#kk-oxnote").textContent = SEC
        ? (WB ? (unknownMax ? "問題集の解答で採点して、大問ごとの得点と配点を入れてください（この科目は大問の配点が問題集ごとに違うので、配点も入れてください）。"
                            : "問題集の解答で採点して、大問ごとの得点を入れてください。配点は本番の配点を入れてあります。問題集で違うときは直してください。")
              : `センターの正解と配点で採点して、大問ごとの得点を入れてください。配点は${E.maxFrom ? `${E.maxFrom}の配点を仮に入れてあります。違うときは問題冊子・正解表の配点に直してください` : "わかっている配点を入れてあります"}。`)
        : "センターの正解と照らし合わせて、採点の単位ごとに ○ か × を押してください。「ア–ウ」のようにまとめて採点する欄は、全部合っていれば ○ です。× を押したら、落とした理由も1つ選んでください。設問ごとの配点と正答率は、○× をつけた欄だけに出ます（解いている途中に見えないように）。" +
          (E.items.some(it => it[3] === null) ? "この年度は全国の正答率が公表されていないので、このサイトで解いて点数集計に送った人の正答率（みんなの正答率）を出します。" : "");
      q("#kk-devlabel").textContent = NAT() ? "全国の中での偏差値" : "本番換算の偏差値";
      q("#kk-ranklabel").textContent = NATR ? "全国の順位" : "このサイトの中での順位";
      q("#kk-minidevlabel").textContent = NAT() ? "全国偏差値" : "本番換算";
      q("#kk-minitoplabel").textContent = NATR ? "全国の上位" : "サイト内の上位";
      q("#kk-avglegend").textContent = SEC ? "このサイトの人の得点率（点数集計で大問ごとを入れた人）" : "全国平均（選択問題は、その大問を選んだ人の平均）";
      q("#kk-whysec").hidden = SEC;
      WBS = null;
      if (usesSite()) loadWB();
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
      q("#kk-peerlabel").textContent = NATR ? (host.peerLabel || "仲間の中での偏差値") : "このサイトの中での偏差値";
      q("#kk-onlyprev").checked = false;
      q("#kk-flash").hidden = true;
      PEERS = null;
      drawAll();
      if (NATR) loadPeers();
    }
    function loadPeers() {
      const asked = E.id;   // 読み込み中に別の過去問へ切りかえても、取り違えない
      if (host.peers) host.peers(E).then(p => { if (asked !== E.id) return; PEERS = Object.assign({}, p, {examId: asked}); drawPeer(); })
        .catch(() => { if (asked === E.id) { PEERS = {error: true, examId: asked}; drawPeer(); } });
    }

    // ---- 選ぶところ：過去問は 年度 → 試験 → 科目、予想問題集は 問題集 → 科目 → 回
    const KINDS = ["本試験", "追試験"];
    const SUBJ_ORDER = [...new Set([...EXAMS.map(e => e.sid), ...WBD.subjects.map(s => s.sid)])];
    const years = [...new Set(EXAMS.map(e => e.year))].sort((a, b) => b - a);
    const opts = (list, cur) => list.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(t)}</option>`).join("");
    const pastOf = (y, k) => EXAMS.filter(e => e.year === y && e.kind === k).sort((a, b) => SUBJ_ORDER.indexOf(a.sid) - SUBJ_ORDER.indexOf(b.sid));
    function syncPick() {
      root.querySelectorAll("#kk-tabs [data-tab]").forEach(b => { const on = (b.dataset.tab === "wb") === WB; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on); });
      q("#kk-tabs").hidden = !WB_ON;
      q("#kk-pickpast").hidden = WB;
      q("#kk-pickwb").hidden = !WB;
      if (WB) {
        q("#kk-book").innerHTML = opts(WBD.books.map(b => [b.id, b.name]), E.book);
        q("#kk-wbsubj").innerHTML = opts(WBD.subjects.map(s => [wbCode(s), s.subject]), wbCode(E));
        q("#kk-round").innerHTML = opts(Array.from({length: WBD.rounds || 6}, (_, i) => [i + 1, `第${i + 1}回`]), E.round);
      } else {
        q("#kk-year").innerHTML = opts(years.map(y => [y, `${y}年${y === 2021 ? "（第1日程）" : ""}`]), E.year);
        q("#kk-kind").innerHTML = opts(KINDS.filter(k => pastOf(E.year, k).length).map(k => [k, E.year === 2021 ? (k === "本試験" ? "本試験（第1日程）" : "追試験（第2日程）") : k]), E.kind);
        q("#kk-subj").innerHTML = opts(pastOf(E.year, E.kind).map(e => [e.id, subjName(e) + (e.mode === "sections" ? "（大問ごとに入力）" : "")]), E.id);
      }
    }
    function go(id) {
      if (host.kind === "public") history.replaceState(null, "", "?exam=" + id);
      loadExam(id);
    }
    // 年度や試験を変えても、同じ科目があればその科目のまま
    function pickPast(y, k) {
      const list = pastOf(y, k).length ? pastOf(y, k) : pastOf(y, KINDS.find(x => pastOf(y, x).length));
      const same = list.find(e => e.sid === E.sid) || list.find(e => e.subject === E.subject) || list[0];
      if (same) go(same.id);
    }
    q("#kk-year").addEventListener("change", () => pickPast(+q("#kk-year").value, E.kind));
    q("#kk-kind").addEventListener("change", () => pickPast(E.year, q("#kk-kind").value));
    q("#kk-subj").addEventListener("change", () => go(q("#kk-subj").value));
    const wbPick = () => go(`wb-${q("#kk-book").value}-${q("#kk-wbsubj").value}-${q("#kk-round").value || 1}`);
    ["#kk-book", "#kk-wbsubj", "#kk-round"].forEach(s => q(s).addEventListener("change", wbPick));
    q("#kk-tabs").addEventListener("click", e => {
      const b = e.target.closest("[data-tab]"); if (!b || (b.dataset.tab === "wb") === WB) return;
      if (b.dataset.tab === "wb") {
        const last = store.get("lastWB");
        // 前に開いた予想問題集、なければ いま開いている科目の駿台の第1回
        const code = E.part || E.sid;
        go(last && examById(last) ? last : examById(`wb-sundai-${code}-1`) ? `wb-sundai-${code}-1` : `wb-${WBD.books[0].id}-${wbCode(WBD.subjects[0])}-1`);
      } else {
        const last = store.get("lastPast");
        go(last && examById(last) ? last : (EXAMS.find(e => e.sid === E.sid && e.kind === "本試験") || EXAMS[0]).id);
      }
    });

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
      const sig = keys.map(k => k + ':' + (QMAX[k] || '')).join();
      if (list.dataset.keys !== sig) {
        list.dataset.keys = sig;
        list.innerHTML = keys.map(k => `<div class="kk-qrow" role="button" tabindex="0" data-k="${k}">
            <span class="kk-qname">${labelOf(k)}${k === "rev" ? "" : `<span class="kk-faint" style="font-weight:400"> ${QMAX[k] || "?"}点</span>`}</span>
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
      if (SEC) { const v = S.wbScore[n]; return {got: v === undefined ? 0 : v, done: v === undefined ? 0 : 1, all: 1}; }
      E.items.forEach((it, i) => { if (it[0] !== n) return; all++; if (S.marks[i]) done++; if (S.marks[i] === "o") got += it[2]; });
      return {got, done, all};
    }
    const rateHtml = i => {
      const r = rateOf(i);
      if (!r) return `<span class="kk-faint">${WBS && WBS.loading ? "読み込み中…" : "正答率は集まり中"}</span>`;
      return `<span class="kk-track"><i style="width:${r.v}%"></i></span>${r.v.toFixed(1)}%${r.src === "みんな" ? `<small class="kk-faint">（みんな${r.n ? " " + r.n + "人" : ""}）</small>` : ""}`;
    };
    function drawOX() {
      if (SEC) {   // 大問ごとに「得点 / 配点」
        q("#kk-onlyprev-wrap").hidden = true;
        q("#kk-ox").innerHTML = chosen().map(n => `<div class="kk-qcard"><div class="kk-qhead"><h4>第${n}問<span class="kk-qfield">${esc(E.qs[n - 1][1])}</span></h4>` +
          `<span class="kk-qscore" data-qs="${n}"></span></div><div class="kk-wbrow">` +
          `<label>得点 <input type="number" min="0" step="1" inputmode="numeric" data-wbs="${n}" value="${S.wbScore[n] === undefined ? "" : S.wbScore[n]}" aria-label="第${n}問の得点"></label>` +
          `<span class="kk-faint">/</span><label>配点 <input type="number" min="1" max="${E.full}" step="1" inputmode="numeric" data-wbm="${n}" value="${QMAX[n] || ""}" placeholder="?" aria-label="第${n}問の配点"></label>` +
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
              <div class="kk-pts">${m ? `${it[2]}点` : ""}</div>
              <div class="kk-rate">${m ? rateHtml(i) : `<span class="kk-faint">採点後に配点・正答率</span>`}</div>
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
        el.innerHTML = `${r.done ? r.got : "—"}<small> / ${QMAX[el.dataset.qs] || "?"}</small>`;
      });
      root.querySelectorAll("[data-qp]").forEach(el => {
        const r = qScore(+el.dataset.qp);
        el.firstChild.style.width = (r.all ? r.done / r.all * 100 : 0) + "%";
        el.title = `採点 ${r.done} / ${r.all}`;
      });
      const R = result();
      q("#kk-oxcount").textContent = SEC ? `入力 ${R.done} / ${R.all}` : `採点 ${R.done} / ${R.all}`;
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
    q("#kk-ox").addEventListener("input", e => {   // 大問ごとの得点・配点
      const n = +(e.target.dataset.wbs || e.target.dataset.wbm || 0); if (!n) return;
      const sv = q(`[data-wbs="${n}"]`).value.trim(), mv = q(`[data-wbm="${n}"]`).value.trim();
      const mx = /^\d+$/.test(mv) && +mv > 0 && +mv <= E.full ? +mv : (QMAX[n] || null);
      QMAX[n] = mx;
      if (mx) S.wbMax[n] = mx;
      if (/^\d+$/.test(sv)) S.wbScore[n] = Math.min(+sv, mx || E.full); else delete S.wbScore[n];
      save(); drawQScores(); drawMini(); drawReport(); drawTimer();
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
    // 大問ごと（配点がわかっていて、全部採点した／入れた大問）
    const secsOf = R => R.per.filter(r => r.max && (SEC ? r.done : r.done === r.all)).map(r => ({q: r.q, score: r.got, max: r.max}));
    // 点数集計（このサイトの利用者）の中での位置。全国の平均点がある試験は、偏差値だけ全国で出す
    function siteReport(R) {
      if (!WBS || !WBS.stats || !window.HoshitobuLink || !E.survey) return null;
      const rp = window.HoshitobuLink.report(WBS.stats, window.NATIONAL_STATS || {}, E.survey.subject, E.survey.book, E.survey.round || null, R.total, secsOf(R));
      if (NAT()) { rp.natDev = dev(R.total, E.mean, E.sd); rp.natMean = E.mean; rp.natKind = "全国"; }
      return rp;
    }
    const devNow = (R, rp) => NAT() ? dev(R.total, E.mean, E.sd) : rp && rp.natDev !== null && rp.natDev !== undefined ? rp.natDev : null;
    function siteWhy() {
      if (!E.survey) return "点数集計の対象外です";
      if (!WBS || WBS.loading) return "点数集計を読み込み中…";
      if (WBS.error) return "点数集計を読み込めませんでした";
      return `${WB ? "この問題集・回" : "この試験・科目"}の記録が${(WBS.stats && WBS.stats.minN) || 3}人以上になると出ます`;
    }
    const doneWord = () => SEC ? "入力" : "採点";
    function drawMini() {
      const R = result(), on = R.done > 0;
      q("#kk-miniscore").innerHTML = `${on ? R.total : "—"}<small> / ${E.full}</small>`;
      q("#kk-minirest").textContent = R.done < R.all ? `未${doneWord()} ${R.all - R.done}` : `${doneWord()}おわり`;
      if (NATR) {
        q("#kk-miniavg").textContent = on ? `平均との差 ${R.total >= E.mean ? "+" : ""}${(R.total - E.mean).toFixed(1)}` : `全国平均 ${E.mean}`;
        q("#kk-minidev").textContent = on ? dev(R.total, E.mean, E.sd).toFixed(1) : "—";
        q("#kk-minitop").textContent = on ? topTxt(rankOf(R.total).top) : "—";
        return;
      }
      const rp = siteReport(R), d = devNow(R, rp);
      q("#kk-miniavg").textContent = NAT() ? (on ? `全国平均との差 ${R.total >= E.mean ? "+" : ""}${(R.total - E.mean).toFixed(1)}` : `全国平均 ${E.mean}`)
        : rp && rp.ok ? `サイト平均 ${rp.siteMean.toFixed(1)}` : "点数集計と比べます";
      q("#kk-minidev").textContent = on && d !== null ? d.toFixed(1) : "—";
      q("#kk-minitop").textContent = on && rp && rp.ok ? `${rp.top}%` : "—";
    }
    function drawPeer() {
      if (!NATR) return;   // 全国の順位がない試験は、drawReport で点数集計の数字を出す
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
    // 大問ごとの比べる相手：全国平均（センターの公表）、なければこのサイトの人の得点率
    const hasNatQ = () => E.qs.some(x => x[3] !== null && x[3] !== undefined);
    const siteRate = (rp, n) => rp && rp.cell && rp.cell.sections ? ((rp.cell.sections.find(c => c.q === n) || {}).rate ?? null) : null;
    const refPct = (rp, r) => r.avg !== null && r.avg !== undefined ? (r.max ? r.avg / r.max * 100 : null) : siteRate(rp, r.q);
    function drawReport() {
      const R = result(), on = R.done > 0;
      const rp = NATR ? null : siteReport(R);
      q("#kk-repnote").textContent = !on ? (SEC ? "大問ごとの得点を入れると、ここに出ます" : "○× をつけると、ここに出ます")
        : R.done < R.all ? `未${doneWord()} ${R.all - R.done}${SEC ? "問" : "個"}（いまの点数で出しています）` : (SEC ? "全部の大問を入れました" : "全部の欄を採点しました");
      q("#kk-score").innerHTML = `${on ? R.total : "—"}<small> / ${E.full}</small>`;
      if (!NATR) {
        const d = devNow(R, rp);
        q("#kk-scoresub").textContent = NAT() ? `全国平均 ${E.mean}点` + (on ? `（${R.total >= E.mean ? "+" : ""}${(R.total - E.mean).toFixed(1)}）` : "")
          : rp && rp.ok ? `このサイトの平均 ${rp.siteMean.toFixed(1)}点` : "点数集計の数字と比べます";
        q("#kk-dev").textContent = on && d !== null ? d.toFixed(1) : "—";
        q("#kk-devsub").textContent = NAT() ? `平均 ${E.mean}点・標準偏差 ${E.sd}`
          : rp && rp.natDev !== null ? "このサイトの人が過去問の本試を解いたときの位置から推定"
          : rp && rp.anchor ? `過去問本試の記録が${window.HoshitobuLink.ANCHOR_MIN}人分たまると出ます（いま${rp.anchor.n}人分）` : siteWhy();
        q("#kk-rank").textContent = on && rp && rp.ok ? `${rp.rank}位` : "—";
        q("#kk-ranksub").textContent = rp && rp.ok ? `${rp.of || rp.n}人中・上位 ${rp.top}%` : siteWhy();
        q("#kk-peer").textContent = on && rp && rp.ok && rp.siteDev !== null ? rp.siteDev.toFixed(1) : "—";
        q("#kk-peersub").textContent = rp && rp.ok ? `${rp.n}人・平均 ${rp.siteMean.toFixed(1)}点` : siteWhy();
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
      const natQ = hasNatQ();
      // 解説動画は数学だけ（国語・英語・社会などは、著作権の都合で解説を出さない）。ほかの科目は「解説」の列ごと出さない
      const vid = !!E.part;
      const refTxt = r => natQ ? (r.avg === null || r.avg === undefined ? "—" : r.avg.toFixed(1)) : (siteRate(rp, r.q) === null ? "—" : siteRate(rp, r.q).toFixed(1) + "%");

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
      q("#kk-qtable").innerHTML = `<thead><tr><th>大問</th><th style="width:34%">得点</th><th class="r"></th><th class="r">${natQ ? "全国平均" : "みんなの得点率"}</th>` +
        (prev ? `<th class="r">前回</th>` : "") + `<th class="r">時間 / 目安</th>${vid ? "<th>解説</th>" : ""}</tr></thead><tbody>` +
        R.per.map(r => {
          const url = (E.videos || {})[r.q];
          const p = prev && prev.per ? prev.per.find(x => x.q === r.q) : null;
          const ref = refPct(rp, r);
          return `<tr><td><b>第${r.q}問</b><div class="kk-faint">${esc(r.name)}</div></td>` +
            `<td><div class="kk-sbar"><i style="width:${r.done && r.max ? r.got / r.max * 100 : 0}%"></i>${ref === null ? "" : `<b style="left:calc(${ref}% - 1px)"></b>`}</div></td>` +
            `<td class="r"><b>${r.done ? r.got : "—"}</b> / ${r.max || "?"}</td><td class="r">${refTxt(r)}</td>` +
            (prev ? `<td class="r">${p ? p.got : "—"}</td>` : "") +
            `<td class="r ${r.ms > r.goal * 60000 ? "kk-over" : ""}">${r.ms ? fmt(r.ms) : "—"} / ${r.goal}分</td>` +
            (vid ? `<td>${url ? `<a class="kk-vid" href="${esc(url)}" target="_blank" rel="noopener">▶ 解説動画</a>` : `<span class="kk-vid-none">動画は準備中</span>`}</td>` : "") + `</tr>`;
        }).join("") +
        `<tr class="kk-total"><td>合計</td><td></td><td class="r">${on ? R.total : "—"} / ${E.full}</td><td class="r">${natQ || NAT() ? (E.mean ?? "—") : (rp && rp.ok ? rp.siteMean.toFixed(1) : "—")}</td>` +
        (prev ? `<td class="r">${prev.total}</td>` : "") + `<td class="r">${fmt(totalMs())} / ${E.minutes}分</td>${vid ? "<td></td>" : ""}</tr></tbody>`;

      // 力の種類
      if (!q("#kk-stagesec").hidden) {
        const st = {};
        E.items.forEach((it, i) => {
          if (!chosen().includes(it[0]) || !it[4]) return;
          const t = st[it[4]] || (st[it[4]] = {pts: 0, got: 0, lost: 0});
          t.pts += it[2];
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

      // 大問ごとに入れる試験：復習すべき大問（このサイトの人の得点率と比べる）
      q("#kk-misstitle").textContent = SEC ? "復習すべき大問" : "落とした所";
      q("#kk-missnote").textContent = SEC
        ? `このサイトの人の得点率より ${window.HoshitobuLink ? window.HoshitobuLink.GAP : 15}ポイント以上低い大問を、差の大きい順に出しています。`
        : `${natQ ? "全国" : "みんな"}の正答率が 70％以上なのに × だった所が、いちばん取り返しやすい所です。`;
      if (SEC) {
        const rv = rp && rp.review ? rp.review : [];
        q("#kk-miss").innerHTML = rv.length ? rv.map(r =>
          `<li class="${r.ref >= 60 ? "is-easy" : ""}"><b>第${r.q}問</b><span class="kk-faint">あなた ${r.mine.toFixed(1)}%</span>` +
          `${r.ref >= 60 ? '<span class="kk-tag">みんなが取れている所</span>' : ""}<span class="kk-mrate">${r.refKind || "みんな"} ${r.ref.toFixed(1)}%</span></li>`).join("")
          : `<li class="kk-muted" style="background:none;border:0;padding:0">${!on ? "大問ごとの得点を入れると出ます。" : rp && rp.cell && rp.cell.sections ? "みんなと比べて大きく落とした大問はありません。" : "点数集計で、この回の大問ごとの点数を送った人が3人以上になると出ます。"}</li>`;
      } else {
        // 落とした所（正答率の高い順）
        const miss = [];
        E.items.forEach((it, i) => { if (S.marks[i] === "x" && chosen().includes(it[0])) miss.push([it, S.why[i], rateOf(i)]); });
        miss.sort((a, b) => (b[2] ? b[2].v : -1) - (a[2] ? a[2].v : -1));
        q("#kk-miss").innerHTML = miss.length ? miss.map(([it, w, r]) =>
          `<li class="${r && r.v >= 70 ? "is-easy" : ""}"><b>第${it[0]}問 ${esc(it[1])}</b><span class="kk-faint">${it[2]}点${w ? "・" + esc(w) : ""}</span>` +
          `${r && r.v >= 70 ? '<span class="kk-tag">取り返しやすい</span>' : ""}<span class="kk-mrate">${r ? `${r.src} ${r.v.toFixed(1)}%` : "正答率なし"}</span></li>`).join("")
          : `<li class="kk-muted" style="background:none;border:0;padding:0">× をつけた欄は、まだありません。</li>`;
      }

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
    const needFirst = () => SEC ? "先に大問ごとの得点を入れてください。" : "先に ○× をつけてください。";
    q("#kk-save").addEventListener("click", async () => {
      commit();
      const R = result();
      if (!R.done) { flash(needFirst(), true); return; }
      const marks = {}, why = {};
      const rp = NATR ? null : siteReport(R);
      E.items.forEach((it, i) => { if (chosen().includes(it[0]) && S.marks[i]) { marks[i] = S.marks[i]; if (S.why[i]) why[i] = S.why[i]; } });
      const at = new Date().toISOString();
      const d = devNow(R, rp);
      const rec = {at, replaces: S.savedAt || null, total: R.total,
                   dev: d === null ? null : +d.toFixed(1),
                   top: NATR ? +rankOf(R.total).top.toFixed(2) : null,
                   ms: Math.round(totalMs()), sel: S.sel.slice().sort((a, b) => a - b),
                   per: R.per.map(r => ({q: r.q, got: r.got, max: r.max, name: r.name, ms: Math.round(r.ms), done: r.done, all: r.all})),
                   marks, why, complete: R.done === R.all};
      const prev = lastRec();
      const btn = q("#kk-save"); btn.disabled = true; btn.textContent = "記録しています…";
      try {
        const extras = host.readSaveOptions ? host.readSaveOptions(root) : {};
        const res = await host.saveRecord(E, rec, extras);
        H[E.id] = res.history;
        S.savedAt = at; save(); if (usesSite()) { WBS = null; loadWB(); } if (NATR) loadPeers();
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
      q("#kk-hist").innerHTML = h.length ? `<thead><tr><th>日時</th><th class="r">得点</th><th class="r">${NAT() ? "全国偏差値" : "本番換算"}</th><th class="r">上位</th><th class="r">時間</th><th>選んだ大問</th><th></th></tr></thead><tbody>` +
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
      try { const res = await host.deleteRecord(E, at); H[E.id] = res.history; if (S.savedAt === at) { S.savedAt = null; save(); } drawAll(); if (NATR) loadPeers(); }
      catch (err) { flash("消せませんでした：" + (err && err.message ? err.message : err), true); }
    });

    // ------------------------------------------------ 成績表を画像で保存（1200×675、動画・SNS向けの16:9）
    q("#kk-png").addEventListener("click", () => {
      const R = result();
      if (!R.done) { flash(needFirst(), true); return; }
      const rp = NATR ? null : siteReport(R);
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
      g.fillStyle = ink; g.font = `800 ${E.title.length > 30 ? 24 : 30}px ${F}`; g.fillText(E.title.replace(/　/g, " "), 64, 120);
      const d = new Date();
      g.fillStyle = sub; g.font = `18px ${F}`;
      g.fillText(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}　時間 ${fmt(totalMs())} / ${E.minutes}分` + (R.done < R.all ? `　（${doneWord()}の途中）` : ""), 64, 152);
      const dv = devNow(R, rp);
      const k = NATR ? rankOf(R.total) : null;
      const tiles = NATR
        ? [["得点", `${R.total}`, `/ ${E.full}点`, true], ["全国偏差値", dev(R.total, E.mean, E.sd).toFixed(1), `平均 ${E.mean}点`, false],
           ["全国の順位", "上位 " + topTxt(k.top), `${comma(E.n)}人中 ${comma(k.rank)}位`, false]]
        : [["得点", `${R.total}`, `/ ${E.full}点`, true],
           [NAT() ? "全国偏差値" : "本番換算の偏差値", dv !== null ? dv.toFixed(1) : "—", NAT() ? `平均 ${E.mean}点` : "このサイトの人の本試の位置から推定", false],
           ["このサイトの中", rp && rp.ok ? `${rp.rank}位` : "—", rp && rp.ok ? `${rp.of || rp.n}人中・平均 ${rp.siteMean.toFixed(1)}点` : "記録が少ないため出せません", false]];
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
        g.fillStyle = ink; g.font = `${rh < 30 ? 15 : 18}px ${F}`; g.fillText(`第${r.q}問`, bx, y + rh * 0.62);
        rr(bx + 84, y + (rh - bh) / 2, w, bh, bh / 2, line);
        if (r.got && r.max) rr(bx + 84, y + (rh - bh) / 2, Math.max(bh, w * r.got / r.max), bh, bh / 2, acc);
        const ref = refPct(rp, r);
        if (ref !== null) { g.fillStyle = warn; g.fillRect(bx + 84 + w * ref / 100 - 1.5, y + (rh - bh) / 2 - 5, 3, bh + 10); }
        g.fillStyle = ink; g.font = `700 ${rh < 30 ? 15 : 18}px ${F}`; g.fillText(`${r.got} / ${r.max || "?"}`, bx + 100 + w, y + rh * 0.62);
      });
      g.fillStyle = warn; g.fillRect(bx, Hh - 76, 3, 14);
      g.fillStyle = sub; g.font = `15px ${F}`;
      g.fillText(hasNatQ() ? "＝全国平均（選択問題は、その大問を選んだ人の平均）" : "＝このサイトの人の得点率", bx + 10, Hh - 64);
      const rx = 806;
      g.fillStyle = ink; g.font = `700 20px ${F}`; g.fillText(SEC ? "復習すべき大問" : "落とした理由", rx, by);
      const now = {};
      if (SEC) (rp && rp.review ? rp.review : []).forEach(r => { now[`第${r.q}問`] = `${r.mine.toFixed(0)}%／${r.refKind || "みんな"}${r.ref.toFixed(0)}%`; });
      else E.items.forEach((it, i) => { if (S.marks[i] === "x" && chosen().includes(it[0])) { const w = S.why[i] || "理由なし"; now[w] = (now[w] || 0) + it[2]; } });
      const ks = Object.keys(now).sort((a, b) => SEC ? 0 : now[b] - now[a]);
      if (!ks.length) { g.fillStyle = sub; g.font = `18px ${F}`; g.fillText(SEC ? "とくになし" : "× なし", rx, by + 42); }
      ks.slice(0, 6).forEach((w, i) => {
        const y = by + 44 + i * 40;
        g.fillStyle = ink; g.font = `18px ${F}`; g.fillText(w, rx, y);
        g.fillStyle = warn; g.font = `800 ${SEC ? 15 : 18}px ${F}`; g.textAlign = "right"; g.fillText(SEC ? now[w] : `−${now[w]}点`, W - 64, y); g.textAlign = "left";
        g.fillStyle = line; g.fillRect(rx, y + 12, W - 64 - rx, 1);
      });
      g.fillStyle = ok; g.font = `700 15px ${F}`; g.textAlign = "right";
      g.fillText("星飛ぶの勉強部屋　過去問演習", W - 64, Hh - 64);
      g.fillStyle = sub; g.font = `13px ${F}`;
      g.fillText(NATR ? "出典：大学入試センター（平均点・標準偏差・成績分布）" : "比べた数字：点数集計（このサイトの利用者）・大学入試センター", W - 64, Hh - 44);
      g.textAlign = "left";
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `成績表_${E.id}_${d.getMonth() + 1}${String(d.getDate()).padStart(2, "0")}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    });

    // ------------------------------------------------ はじめに
    function drawAll() { drawSel(); drawTimer(); drawOX(); drawMini(); drawReport(); drawHist(); }
    // 点数集計の数字を、ほかの場所（集計に送ったあとなど）から読み直す
    const refreshWB = () => { if (E && usesSite()) { WBS = null; loadWB(); } };
    const want = (opt.initialExam) || store.get("lastExam") || (EXAMS[0] && EXAMS[0].id);
    const startId = examById(want) ? want : EXAMS[0].id;
    Promise.resolve(host.loadHistory ? host.loadHistory() : {}).catch(() => ({})).then(h => { H = h || {}; loadExam(startId); });
    return {reload: () => Promise.resolve(host.loadHistory()).then(h => { H = h || {}; drawAll(); }), current: () => E && E.id, refreshWB};
  }

  window.Kakomon = {mount, workbookExam};
})();
