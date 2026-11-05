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
  // 1分に満たない大問は、その時間で解けたのではなく「たどり着けなかった」とみなす（目安や平均の計算に使わない）
  const REACH_MS = 60000;
  const GOOD_RATE = 0.8;   // 想定時間は、その大問で8割以上取れた回の時間から作る
  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const fmt = ms => { const t = Math.floor(ms / 1000); return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };
  // 大問の時間の表示：1分に満たなければ「たどり着けなかった？」（はかっていないときは —）
  const qTime = (ms, anyTime) => ms >= 60000 ? fmt(ms) : anyTime ? '<span class="kk-faint" title="1分に満たない大問は、たどり着けなかったものとして、目安や平均に使いません">たどり着けなかった？</span>' : "—";
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
    <details class="kk-marktip" id="kk-marktip">
      <summary>📝 過去問は、マークシートに塗って解こう（塗るのにも時間がかかります）</summary>
      <ul>
        <li><b>塗るだけで時間がかかります。</b>星飛ぶが試しに測ってみると、マークするだけで 3〜6分 かかりました。数学はマークが 90個ほどあるので、1マーク1秒というかなり速いペースでも、1分半はかかります。</li>
        <li><b>問題冊子とマークシートを見比べる時間もかかります。</b>どの解答欄に塗ったか、ずれていないかを確かめる時間です。</li>
        <li>なので、過去問は<b>本番と同じようにマークシートに塗って、その時間もふくめて</b>はかるのがおすすめです。問題用紙だけで解いていると、本番で時間が足りなくなります。</li>
        <li>マークシートは、教学社の<a href="https://akahon.net/book/detail/9001000" target="_blank" rel="noopener">赤本ノートプラス（共通テスト用）↗</a>（B5・30枚。各ページにマークシート小問60問分と分析シート。共通テスト過去問研究の全科目に対応）などが使えます。星飛ぶが数学で使ってみて、問題なく使えました。赤本（共通テスト過去問研究）にも、マークシート解答用紙がついています。</li>
        <li>塗ったマークシートは、下の「自己採点」の「📷 マークシートの写真から入れる」で、そのまま採点に使えます。</li>
      </ul>
    </details>
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
      <details class="kk-ai" id="kk-ai">
        <summary>📷 マークシートの写真から入れる（手持ちのAIを使う）</summary>
        <ol class="kk-ai-steps">
          <li><button type="button" class="kk-btn kk-btn-secondary" id="kk-aicopy">AIに渡す文章をコピー</button><span class="kk-faint" id="kk-aicopied"></span></li>
          <li id="kk-aistep2"></li>
          <li>AIが返したコードを、下に貼って「反映する」を押す</li>
        </ol>
        <textarea id="kk-aicode" rows="5" spellcheck="false" placeholder="例）&#10;KAKOMON 2026-IA&#10;1: ooxoooxoooooooxo&#10;2: oooxoxoooooo"></textarea>
        <div class="kk-ai-actions"><button type="button" class="kk-btn kk-btn-primary" id="kk-aiapply">反映する</button><span class="kk-faint" id="kk-aimsg"></span></div>
        <p class="kk-faint">このサイトは、写真もコードも外に送りません（コードは、この画面の ○× を入れるのに使うだけです）。AI は読み間違えることがあるので、反映したあとで見直してください。</p>
      </details>
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
      <div class="kk-goalmake">
        <span class="kk-faint">目安を作る：</span>
        <button type="button" class="kk-chip" data-goalfrom="haiten">配点から</button>
        <button type="button" class="kk-chip" data-goalfrom="last">前回の自分</button>
        <button type="button" class="kk-chip" data-goalfrom="avg">自分の平均</button>
        <button type="button" class="kk-chip" data-goalfrom="fit">制限に合わせて縮める</button>
        <button type="button" class="kk-chip is-save" id="kk-goalsave">この目安を保存</button>
      </div>
      <p class="kk-faint" id="kk-goalnote" style="margin:8px 2px 0"></p>
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

  <div class="kk-sec" id="kk-targetsec">
    <h4>目標点と目標時間</h4>
    <p class="kk-muted" id="kk-targetnote"></p>
    <div class="kk-targetpick" id="kk-targetpick" hidden><span class="kk-faint">目標にする学力帯：</span><select id="kk-targetband"></select>
      <button type="button" class="kk-chip" id="kk-targetuse">目標時間を自分の目安にする</button></div>
    <div class="kk-scroll"><table class="kk-table" id="kk-targettable"></table></div>
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
    <button type="button" class="kk-btn kk-btn-secondary" id="kk-print">成績表を印刷・PDFで保存</button>
    <button type="button" class="kk-btn kk-btn-secondary" id="kk-png">成績表を画像で保存</button>
  </div>
  <div class="kk-flash" id="kk-flash" hidden></div>
  <div class="kk-muted kk-hostnote" id="kk-hostnote"></div>
</section>

<section class="kk-card" id="kk-trendcard">
  <div class="kk-eyebrow"><h3>得点の推移</h3><span class="kk-aside" id="kk-trendnote"></span></div>
  <div class="kk-trendtabs" role="group" aria-label="グラフの物差し">
    <button type="button" class="kk-chip is-on" data-trend="dev">偏差値</button>
    <button type="button" class="kk-chip" data-trend="pct">得点率</button>
  </div>
  <div id="kk-trendchart"></div>
  <div class="kk-scroll"><table class="kk-table" id="kk-trendtable"></table></div>
  <p class="kk-muted" id="kk-trendhelp">年度によって難しさが違うので、伸びたかどうかは偏差値（全国の中での位置）で見るのがおすすめです。白丸は、全国の数字がない試験の「本番換算（推定）」です。</p>
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
    // 自分で決めて保存した目安（試験ごと）。なければ同じ科目で保存した目安（大問の数が同じとき）、なければ配点から
    const GOALS_KEY = () => E.id + ".mygoals", SUBJ_GOALS_KEY = () => "subj." + (E.sid || E.id) + ".mygoals";
    function savedGoals() {
      for (const k of [GOALS_KEY(), SUBJ_GOALS_KEY()]) {
        try {
          const g = JSON.parse(store.get(k) || "null");
          if (g && E.qs.every(x => g[x[0]] > 0)) return {goals: g, from: k === GOALS_KEY() ? "exam" : "subject"};
        } catch (e) {}
      }
      return null;
    }
    const fresh = () => ({sel: E.optional.slice(0, E.pick), marks: {}, why: {}, wbScore: {}, wbMax: {}, acc: {}, cur: null, since: null, started: false, savedAt: null,
                          goals: Object.assign(Object.fromEntries(E.qs.map(x => [x[0], defaultGoal(x[0])])), (savedGoals() || {}).goals || {})});
    const save = () => store.set(E.id + ".session", JSON.stringify(S));
    const chosen = () => [...E.required, ...S.sel.slice().sort((a, b) => a - b)];

    function examById(id) {
      const m = WB_ID.exec(id || "");
      if (m && WB_ON) { const w = workbookExam(WBD, m[1], m[2], +m[3]); if (w) return w; }
      return EXAMS.find(e => e.id === id) || null;
    }
    let WB_FRESH = true;   // 次に読むとき、読みおきを使わずに読み直すか（はじめと、記録・送信のあと）
    function loadWB(tries) {   // 予想問題集・追試などは、点数集計（Apps Script）の数字で比べる。過去問の「みんなの正答率」、目標点・目標時間も
      if (!window.HoshitobuLink || !E.survey) { WBS = {error: true}; return; }
      if (WBS && !WBS.error && tries === undefined) return;
      WBS = {loading: true};
      const asked = E.id, fresh = WB_FRESH || tries !== undefined;
      WB_FRESH = false;
      window.HoshitobuLink.stats(fresh).then(st => { WBS = {stats: st}; }, () => {
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
      q("#kk-aistep2").innerHTML = (SEC
        ? "手持ちのAIに、コピーした文章と、<b>解答用紙</b>・<b>問題集の解答と配点</b>を送る"
        : "手持ちのAIに、コピーした文章と、<b>マークシート</b>・<b>正解表</b>（大学入試センターの「過去問題」のページの正解の PDF など）を送る") +
        "<br><span class=\"kk-faint\">・マークシートは、撮った写真をそのまま渡すより、<b>写真を PDF にして</b>渡すほうが読み取りやすいです（スマホのスキャンの機能や、写真を PDF に変える機能で作れます）。正解表も PDF のまま渡してください。<br>" +
        "・試した範囲では、マークシートを読み取れたのは Claude だけでした（ChatGPT・Gemini では読み取れませんでした）。</span>";
      q("#kk-aicode").value = ""; q("#kk-aimsg").textContent = ""; q("#kk-aicopied").textContent = "";
      WBS = null;
      if (E.survey) loadWB();
      q("#kk-selcard").hidden = !opt;
      q("#kk-selnote").textContent = opt ? `第${E.optional.join("・")}問から${E.pick}問` : "";
      const base = opt ? 1 : 0;
      q('[data-n="ox"]').textContent = base + 1;
      q('[data-n="timer"]').textContent = base + 1;
      q('[data-n="report"]').textContent = base + 2;
      q("#kk-limit").textContent = `制限 ${E.minutes}分`;
      drawGoalNote();
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
      S.goals[n] = v; e.target.value = v; save(); drawTimer(); drawReport(); drawGoalNote();
    });
    // ---- 自分の想定時間：配点から／前回の自分の時間から／自分の平均から作って、保存できる
    function drawGoalNote(msg) {
      const sv = savedGoals();
      const sum = chosen().reduce((a, n) => a + (S.goals[n] || 0), 0);
      const base = sv ? (sv.from === "exam" ? "この試験で保存した自分の目安" : "同じ科目で保存した自分の目安") : "配点に合わせた仮の目安";
      q("#kk-goalnote").textContent = (msg ? msg + " " : "") +
        `いまの目安：${base}。合計 ${sum}分（制限 ${E.minutes}分、` +
        (sum > E.minutes ? `制限を${sum - E.minutes}分こえています。「制限に合わせて縮める」で、比率を保ったまま見直し${REVIEW_MIN}分を残す形に縮められます）。`
                         : `見直しに残るのは ${E.minutes - sum}分）。`) +
        "数字を押して書きかえ、「この目安を保存」で次からも使えます。";
    }
    // 自分の記録から、大問ごとにかかった時間（分）。同じ試験の記録がなければ、同じ科目のほかの年度の記録
    function myTimes() {
      const own = (H[E.id] || []).filter(r => r.per && r.per.some(p => p.ms >= REACH_MS));
      if (own.length) return {recs: own, scope: "この試験"};
      const same = Object.entries(H).filter(([id]) => id !== E.id && (examById(id) || {}).sid === E.sid)
        .flatMap(([, h]) => h).filter(r => r.per && r.per.some(p => p.ms >= REACH_MS));
      return {recs: same, scope: "同じ科目のほかの回"};
    }
    root.querySelector(".kk-goalmake").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "kk-goalsave") {
        const g = Object.fromEntries(E.qs.map(x => [x[0], S.goals[x[0]] || defaultGoal(x[0])]));
        store.set(GOALS_KEY(), JSON.stringify(g));
        store.set(SUBJ_GOALS_KEY(), JSON.stringify(g));
        drawGoalNote("保存しました。");
        return;
      }
      const from = b.dataset.goalfrom;
      if (from === "fit") {   // 今の比率のまま、合計を（制限 − 見直し）分にそろえる
        const ks = chosen(), sum = ks.reduce((a, n) => a + (S.goals[n] || 0), 0), room = E.minutes - REVIEW_MIN;
        if (sum > 0) ks.forEach(n => { S.goals[n] = Math.max(1, Math.round(S.goals[n] * room / sum)); });
        save(); drawTimer(); drawReport(); drawGoalNote(`合計 ${room}分前後に縮めました。`);
        return;
      }
      if (from === "haiten") {
        E.qs.forEach(x => { S.goals[x[0]] = defaultGoal(x[0]); });
        save(); drawTimer(); drawReport(); drawGoalNote("配点から作り直しました。");
        return;
      }
      const {recs, scope} = myTimes();
      const use = from === "last" ? recs.slice(-1) : recs;
      if (!use.length) { drawGoalNote("まだ時間をはかった記録がありません。一度はかって記録すると、自分の時間から作れます。"); return; }
      // 1分に満たない大問（たどり着けなかった）は使わない。「自分の平均」は、その大問で8割以上取れた回の時間の平均
      // （8割以上の回がない大問は、たどり着いた回の平均にして、そのことを書く）
      let n = 0;
      const rough = [], none = [];
      E.qs.forEach(x => {
        const ps = use.map(r => r.per.find(p => p.q === x[0])).filter(p => p && p.ms >= REACH_MS);
        if (!ps.length) { if (chosen().includes(x[0])) none.push(x[0]); return; }
        let pick = ps;
        if (from === "avg") {
          const good = ps.filter(p => p.max && p.got >= GOOD_RATE * p.max);
          if (good.length) pick = good; else rough.push(x[0]);
        }
        S.goals[x[0]] = Math.max(1, Math.min(E.minutes, Math.round(pick.reduce((a, p) => a + p.ms, 0) / pick.length / 60000)));
        n++;
      });
      save(); drawTimer(); drawReport();
      const how = from === "last" ? "前回" : "8割以上取れた回の平均";
      drawGoalNote(!n ? "記録に、たどり着いた（1分以上かけた）大問の時間がありませんでした。" :
        `${scope}の${how}の時間から作りました（${n}問分）。` +
        (rough.length ? `第${rough.join("・")}問は8割以上取れた回がないので、たどり着いた回の平均です。` : "") +
        (none.length ? `第${none.join("・")}問は、たどり着いた記録がないので、そのままです。` : ""));
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

    // ------------------------------------------------ マークシートの写真から（手持ちのAIで ○× のコードを作ってもらう）
    // サイトには正解を置かないので、照らし合わせは AI に正解表と写真を渡してやってもらう。ここでは採点の単位の並びと、返ってきたコードの読み取りだけ
    const qsOf = () => [...new Set(E.items.map(it => it[0]))].sort((a, b) => a - b);
    function aiPrompt() {
      if (SEC) {
        return [
          "共通テスト形式の問題集の自己採点を手伝ってください。",
          `問題：${E.title}`,
          "添付した「解答用紙（マークシート）の写真」と「問題集の解答・配点」を照らし合わせて、大問ごとの得点を出してください。",
          "- 解いていない大問（選ばなかった選択問題など）は書かないでください。",
          "- 読み取れないマークがあったら、その大問の行の最後に「（読めない所あり）」と書いてください。",
          "進め方：まず、読み取ったマークを解答番号ごとに書き出し（私が見て確かめます）、次に解答と照らし合わせ、最後に次の形のコードを書いてください（「KAKOMON」の行から下には、コード以外を書かないでください）。「得点/配点」の形です。",
          "",
          `KAKOMON ${E.id}`,
          ...E.qs.map(x => `${x[0]}: 得点/配点`),
        ].join("\n");
      }
      const lines = qsOf().map(qn => {
        const labs = E.items.filter(it => it[0] === qn).map(it => it[1]);
        return `第${qn}問（${labs.length}個）：${labs.join(" / ")}`;
      });
      return [
        "共通テストの自己採点を手伝ってください。",
        `試験：${E.title}`,
        "添付した「マークシート（解答用紙）の写真」と「正解表」を照らし合わせて、下の「採点の単位」ごとに、正解なら o、不正解なら x を付けてください。",
        "- 「ア–ウ」「12–13」のように、いくつかの解答をまとめた単位は、全部合っていれば o、1つでも違えば x にしてください。",
        "- 「（AとB・順不同）」と書いた単位は、AとBの答えが入れかわっていても正解として、1つずつ o / x を付けてください。",
        "- 解いていない大問（選ばなかった選択問題など）と、読み取れないマークは - にしてください。",
        "- 大問ごとに、書いてある個数と同じ数の文字にしてください。",
        "進め方：",
        "1. まず、マークシートから読み取ったマークの番号（または記号）を、解答番号ごとに書き出してください（私が見て確かめます）。読み取りに自信がない所には「？」を付けてください。",
        "2. 次に、正解表と照らし合わせてください。",
        "3. 最後に、次の形のコードを書いてください（「KAKOMON」の行から下には、コード以外を書かないでください）。",
        "",
        `KAKOMON ${E.id}`,
        ...qsOf().map(qn => `${qn}: ${"?".repeat(E.items.filter(it => it[0] === qn).length)}`),
        "",
        "採点の単位（この順番で並べてください）：",
        ...lines,
      ].join("\n");
    }
    const OX = {"o": "o", "O": "o", "○": "o", "〇": "o", "◯": "o", "⭕": "o", "x": "x", "X": "x", "×": "x", "✕": "x", "✗": "x", "❌": "x",
                "-": "-", "ー": "-", "－": "-", "—": "-", "_": "-", "?": "-"};
    // 返ってきたコード → {q: 文字の並び}（大問の番号がないときは、全部を1つの並びとして "all"）
    function readCode(text) {
      let t = String(text || "").normalize("NFKC");
      const last = t.lastIndexOf("KAKOMON");
      if (last >= 0) t = t.slice(last);   // AI が先に書き出した「読み取ったマーク」は読まない
      const m = /KAKOMON\s+(\S+)/.exec(t);
      const out = {id: m ? m[1] : null, rows: {}};
      t.split(/\r?\n/).forEach(line => {
        const r = /^\s*(?:第)?(\d{1,2})\s*(?:問)?\s*[:：]\s*(.+)$/.exec(line);
        if (r) out.rows[+r[1]] = r[2];
      });
      if (!Object.keys(out.rows).length) out.rows.all = t.replace(/KAKOMON\s+\S+/, "");
      return out;
    }
    function applyCode(text) {
      const c = readCode(text);
      if (c.id && c.id !== E.id) return `このコードは別の試験（${c.id}）のものです。いま開いているのは ${E.id} です。`;
      if (SEC) {
        let n = 0;
        for (const [k, v] of Object.entries(c.rows)) {
          const qn = +k, r = /(\d+)\s*(?:\/\s*(\d+))?/.exec(v);
          if (!qn || !r || !(qn in QMAX)) continue;
          const mx = r[2] ? Math.min(+r[2], E.full) : QMAX[qn];
          if (mx) { QMAX[qn] = mx; S.wbMax[qn] = mx; }
          S.wbScore[qn] = Math.min(+r[1], mx || E.full);
          if (E.optional.includes(qn) && !S.sel.includes(qn) && S.sel.length < E.pick) S.sel.push(qn);
          n++;
        }
        if (!n) return "コードから大問ごとの得点を読み取れませんでした。「1: 15/15」のような行があるか確かめてください。";
        save(); drawAll();
        return `${n}問分の得点を入れました。`;
      }
      const sym = str => [...String(str).replace(/\s+/g, "")].map(ch => OX[ch]).filter(Boolean);
      const qs = qsOf(), byQ = {};
      if (c.rows.all !== undefined) {
        const all = sym(c.rows.all);
        if (all.length !== E.items.length) return `○×の数が合いません（コードは${all.length}個、この試験は${E.items.length}個）。大問ごとに「1: ooxo…」の形で貼ってください。`;
        let k = 0;
        qs.forEach(qn => { byQ[qn] = all.slice(k, k += E.items.filter(it => it[0] === qn).length); });
      } else {
        const bad = [];
        qs.forEach(qn => {
          if (c.rows[qn] === undefined) return;
          const need = E.items.filter(it => it[0] === qn).length, got = sym(c.rows[qn]);
          if (got.length !== need) bad.push(`第${qn}問（コード${got.length}個／正しくは${need}個）`);
          else byQ[qn] = got;
        });
        if (bad.length) return `○×の数が合わない大問があります：${bad.join("、")}。AI にもう一度頼むか、その行を直してください。`;
        if (!Object.keys(byQ).length) return "コードから ○× を読み取れませんでした。「1: ooxo…」のような行があるか確かめてください。";
      }
      let n = 0;
      qs.forEach(qn => {
        if (!byQ[qn]) return;
        const idx = E.items.map((it, i) => [it, i]).filter(([it]) => it[0] === qn).map(([, i]) => i);
        idx.forEach((i, j) => {
          const v = byQ[qn][j];
          if (v === "o" || v === "x") { S.marks[i] = v; n++; } else delete S.marks[i];
          if (S.marks[i] !== "x") delete S.why[i];
        });
        // 選択問題：○× がついた大問を、選んだ大問にする
        if (E.optional.includes(qn) && byQ[qn].some(v => v !== "-") && !S.sel.includes(qn)) {
          S.sel.push(qn);
          if (S.sel.length > E.pick) S.sel = S.sel.slice(-E.pick);
        }
      });
      save(); drawAll();
      return `${n}か所に ○× を入れました。× の所は、落とした理由を選んでおくと、あとで役に立ちます。`;
    }
    async function copyText(t) {
      try { await navigator.clipboard.writeText(t); return true; }
      catch (e) {
        const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {}
        ta.remove(); return ok;
      }
    }
    q("#kk-aicopy").addEventListener("click", async () => {
      const ok = await copyText(aiPrompt());
      q("#kk-aicopied").textContent = ok ? "　コピーしました" : "　コピーできませんでした（下の欄の例を参考に、AIに頼んでください）";
    });
    q("#kk-aiapply").addEventListener("click", () => {
      const msg = applyCode(q("#kk-aicode").value);
      q("#kk-aimsg").textContent = "　" + msg;
    });

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
    // ---- 目標点・目標時間：点数集計に集まった、目標の学力帯の人の大問ごとの平均点と平均時間（点数を送った人にだけ見せる）
    let TARGET_BAND = null;   // 選んだ学力帯（ラベル）。null なら自動（自分の1つ上）
    function targetInfo() {
      const L = window.HoshitobuLink;
      if (!L || !E.survey) return {msg: "点数集計の対象外の試験です。"};
      if (!WBS || WBS.loading) return {msg: "点数集計を読み込み中…"};
      if (WBS.error) return {msg: "点数集計を読み込めませんでした。"};
      if (!L.hasSent(E.survey.subject, E.survey.book, E.survey.round || null)) {
        return {msg: "この試験の点数を「点数集計」に送ると、目標の学力帯の人が大問ごとに何点・何分だったかが見られます（送った人だけに見せています）。"};
      }
      const cell = siteCell(), bs = cell && cell.bandSections;
      if (!bs) return {msg: "まだ大問ごとの点数を送った人が少ないため、目標を出せません（3人以上になると出ます）。"};
      const ready = bs.filter(b => b.band && b.sections);
      const labels = bs.map(b => b.band).filter(Boolean);
      // 自分の学力帯の1つ上（「わからない」や未設定なら、全員の平均）
      const prof = L.profile(), BAND_IDS = ["lt50", "50_55", "55_60", "60_65", "65_70", "70up"];
      const mineIdx = BAND_IDS.indexOf(prof.band);
      const auto = mineIdx >= 0 ? labels[Math.min(mineIdx + 1, 5)] : null;
      const want = TARGET_BAND !== null ? TARGET_BAND : auto;
      const pick = bs.find(b => b.band === want && b.sections) || bs[0];
      return {bs, ready, pick, want, auto, labels};
    }
    // 目標時間：8割以上取れた人の平均（min80）、なければ全員の平均（min、all: true）
    const targetMin = c => c && c.min80 !== null && c.min80 !== undefined ? {v: c.min80, all: false}
      : c && c.min !== null && c.min !== undefined ? {v: c.min, all: true} : null;
    function drawTarget() {
      const t = targetInfo(), sec = q("#kk-targetsec");
      q("#kk-targetpick").hidden = !t.pick;
      if (!t.pick) { q("#kk-targetnote").textContent = t.msg; q("#kk-targettable").innerHTML = ""; return; }
      const sel = q("#kk-targetband");
      const opts = [["", "全員の平均"], ...t.bs.filter(b => b.band).map(b => [b.band, b.band + (b.sections ? "" : "（人数が少なく出せません）")])];
      sel.innerHTML = opts.map(([v, lab]) => `<option value="${esc(v)}"${(t.pick.band || "") === v ? " selected" : ""}${v && !t.bs.find(b => b.band === v).sections ? " disabled" : ""}>${esc(lab)}</option>`).join("");
      const who = t.pick.band ? `学力帯「${t.pick.band}」の人（${t.pick.n}人）` : `大問ごとを送った全員（${t.pick.n}人）`;
      q("#kk-targetnote").textContent = (t.want && t.pick.band !== t.want ? `「${t.want}」の人はまだ少ないため、` : "") +
        `${who}の、大問ごとの平均を目標として出しています。` + (t.auto && TARGET_BAND === null ? "ふつうは、あなたの学力帯の1つ上を目標にしています。" : "");
      const R = result();
      let sumT = 0, sumMine = 0, any = false;
      const rows = R.per.map(r => {
        const c = t.pick.sections.find(x => x.q === r.q) || {};
        const tPts = c.rate !== null && c.rate !== undefined && r.max ? r.max * c.rate / 100 : null;
        if (tPts !== null) { sumT += tPts; any = true; }
        sumMine += r.got;
        const gap = tPts === null || !r.done ? "" : r.got >= tPts ? '<span class="kk-up">目標に届いた</span>' : `<span class="kk-down">あと ${(tPts - r.got).toFixed(1)}点</span>`;
        const tm = targetMin(c);
        return `<tr><td><b>第${r.q}問</b></td><td class="r">${r.done ? r.got : "—"} / ${r.max || "?"}</td><td class="r">${tPts === null ? "—" : tPts.toFixed(1)}</td><td>${gap}</td>` +
          `<td class="r">${qTime(r.ms, totalMs() > 0)}</td><td class="r">${tm === null ? "—" : Math.round(tm.v) + "分" + (tm.all ? '<span class="kk-faint">＊</span>' : "")}</td></tr>`;
      }).join("");
      q("#kk-targetnote").textContent += "目標時間は、その大問で8割以上取れた人の平均時間です（＊は、8割以上の人が少ないため全員の平均）。1分に満たない時間（たどり着けなかった人）は入っていません。";
      q("#kk-targettable").innerHTML = `<thead><tr><th>大問</th><th class="r">あなた</th><th class="r">目標点</th><th></th><th class="r">あなたの時間</th><th class="r">目標時間</th></tr></thead><tbody>${rows}` +
        `<tr class="kk-total"><td>合計</td><td class="r">${sumMine}</td><td class="r">${any ? sumT.toFixed(1) : "—"}</td><td></td><td class="r">${fmt(totalMs())}</td><td></td></tr></tbody>`;
    }
    q("#kk-targetband").addEventListener("change", e => { TARGET_BAND = e.target.value || ""; drawTarget(); });
    q("#kk-targetuse").addEventListener("click", () => {
      const t = targetInfo(); if (!t.pick) return;
      let n = 0;
      t.pick.sections.forEach(c => { const tm = targetMin(c); if (tm && c.q in S.goals) { S.goals[c.q] = Math.max(1, Math.round(tm.v)); n++; } });
      save(); drawTimer(); drawReport();
      drawGoalNote(n ? `目標の学力帯の人の時間から、${n}問分の目安を作りました。` : "目標時間の出ている大問がありませんでした。");
    });

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
            `<td class="r ${r.ms > r.goal * 60000 ? "kk-over" : ""}">${qTime(r.ms, totalMs() > 0)} / ${r.goal}分</td>` +
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

      drawTarget();
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
        S.savedAt = at; save(); if (E.survey) { WBS = null; WB_FRESH = true; loadWB(); } if (NATR) loadPeers();
        flash(`記録しました（${R.total}点）。` + (prev ? `前回より ${R.total - prev.total >= 0 ? "+" : ""}${R.total - prev.total}点。` : "") +
          (res.message ? res.message + " " : "") + "もう一度解くときは「リセット」を押してから始めてください。");
        drawAll();
      } catch (err) {
        flash("記録できませんでした：" + (err && err.message ? err.message : err), true);
      } finally { btn.disabled = false; btn.textContent = "この結果を記録する"; }
    });
    // ---- 得点の推移（この科目の、全部の年度・試験・予想問題集の記録を、解いた日の順に）
    let TREND = "dev";
    const trendRows = () => Object.entries(H).flatMap(([id, h]) => {
      const ex = examById(id);
      if (!ex || ex.sid !== E.sid) return [];
      const nat = ex.mean !== null && ex.mean !== undefined && ex.sd > 0 && ex.kind !== "workbook";
      return (h || []).map(r => {
        const max = (r.per || []).reduce((a, p) => a + (p.max || 0), 0) || ex.full;
        return {at: r.at, ex, total: r.total, pct: Math.min(100, 100 * r.total / Math.min(ex.full, max)), dev: r.dev === null || r.dev === undefined ? null : +r.dev,
                est: !nat, ms: r.ms || 0, complete: r.complete};
      });
    }).sort((a, b) => a.at < b.at ? -1 : 1);
    function trendSvg(rows) {
      const pts = rows.map(r => ({...r, v: TREND === "dev" ? r.dev : r.pct})).filter(r => r.v !== null && isFinite(r.v));
      if (pts.length < 1) return `<p class="kk-muted">${TREND === "dev" ? "偏差値の出た記録がまだありません。" : "記録がまだありません。"}</p>`;
      const W = 640, Hh = 220, L = 40, R = 16, T = 14, B = 34;
      const vs = pts.map(p => p.v);
      let lo = TREND === "dev" ? Math.min(35, Math.floor(Math.min(...vs) / 5) * 5) : 0, hi = TREND === "dev" ? Math.max(70, Math.ceil(Math.max(...vs) / 5) * 5) : 100;
      const x = i => L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1));
      const y = v => T + (hi - v) * (Hh - T - B) / (hi - lo);
      const ticks = [];
      for (let v = lo; v <= hi; v += TREND === "dev" ? 5 : 20) ticks.push(v);
      return `<svg class="kk-trendsvg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="得点の推移">` +
        ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${TREND === "dev" && v === 50 ? "kk-tmid" : "kk-tgrid"}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="kk-tlab">${v}</text>`).join("") +
        `<polyline class="kk-tline" points="${pts.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")}"/>` +
        pts.map((p, i) => `<g><circle cx="${x(i)}" cy="${y(p.v)}" r="5" class="${p.est && TREND === "dev" ? "kk-tdot is-est" : "kk-tdot"}"><title>${esc(md(p.at))} ${esc(p.ex.title)}：${p.total}点・${TREND === "dev" ? "偏差値 " + p.v.toFixed(1) : p.v.toFixed(0) + "%"}</title></circle>` +
          `<text x="${x(i)}" y="${Hh - 12}" text-anchor="middle" class="kk-tlab">${md(p.at)}</text></g>`).join("") + `</svg>`;
    }
    function drawTrend() {
      const rows = trendRows();
      q("#kk-trendnote").textContent = rows.length ? `${subjName(E)}・${rows.length}回` : "";
      q("#kk-trendchart").innerHTML = rows.length ? trendSvg(rows) : `<p class="kk-muted">${esc(subjName(E))}の記録がたまると、ここに推移が出ます（日付は記録したときに自動で入ります）。</p>`;
      root.querySelectorAll("[data-trend]").forEach(b => b.classList.toggle("is-on", b.dataset.trend === TREND));
      q("#kk-trendtable").innerHTML = rows.length ? `<thead><tr><th>解いた日</th><th>試験</th><th class="r">得点</th><th class="r">得点率</th><th class="r">偏差値</th><th class="r">時間</th></tr></thead><tbody>` +
        rows.slice().reverse().map(r => `<tr${r.ex.id === E.id ? ' class="is-now"' : ""}><td>${md(r.at)}</td><td>${esc(r.ex.title)}</td><td class="r"><b>${r.total}</b>${r.complete ? "" : '<span class="kk-faint">（途中）</span>'}</td>` +
          `<td class="r">${r.pct.toFixed(0)}%</td><td class="r">${r.dev === null ? "—" : r.dev.toFixed(1) + (r.est ? '<span class="kk-faint">（推定）</span>' : "")}</td><td class="r">${r.ms ? fmt(r.ms) : "—"}</td></tr>`).join("") + "</tbody>" : "";
    }
    root.querySelector(".kk-trendtabs").addEventListener("click", e => {
      const b = e.target.closest("[data-trend]"); if (!b) return;
      TREND = b.dataset.trend; drawTrend();
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
    // ------------------------------------------------ 成績表（A4・印刷／PDF保存）：今回の結果、大問ごとの「自分・全国（みんな）・目標」、時間、落とした所、推移
    function reportCardHtml() {
      const R = result(), rp = NATR ? null : siteReport(R), d = new Date(), dv = devNow(R, rp);
      const t = targetInfo(), natQ = hasNatQ();
      const k = NATR ? rankOf(R.total) : null;
      const tile = (lab, v, sub, main) => `<div class="t${main ? " main" : ""}"><div class="l">${lab}</div><div class="v">${v}</div><div class="s">${sub || ""}</div></div>`;
      const tiles = [
        tile("得点", `${R.total}<small> / ${E.full}</small>`, NAT() ? `全国平均 ${E.mean}点` : (rp && rp.ok ? `このサイトの平均 ${rp.siteMean.toFixed(1)}点` : ""), true),
        tile(NAT() ? "全国偏差値" : "本番換算の偏差値", dv === null ? "—" : dv.toFixed(1), NAT() ? `平均 ${E.mean}・標準偏差 ${E.sd}` : "このサイトの人の本試の位置から推定"),
        NATR ? tile("全国の順位", "上位 " + topTxt(k.top), `${comma(E.n)}人中 ${comma(k.rank)}位`)
             : tile("このサイトの中", rp && rp.ok ? `${rp.rank}位` : "—", rp && rp.ok ? `${rp.of || rp.n}人中・上位 ${rp.top}%` : "記録が少ないため出せません"),
        tile("時間", fmt(totalMs()), `制限 ${E.minutes}分`),
      ].join("");
      const tgt = t.pick ? Object.fromEntries(t.pick.sections.map(c => [c.q, c])) : {};
      const rows = R.per.map(r => {
        const ref = natQ ? (r.avg === null || r.avg === undefined ? "—" : r.avg.toFixed(1)) : (siteRate(rp, r.q) === null ? "—" : siteRate(rp, r.q).toFixed(1) + "%");
        const c = tgt[r.q] || {};
        const tp = c.rate !== null && c.rate !== undefined && r.max ? (r.max * c.rate / 100).toFixed(1) : "—";
        const bar = r.max ? Math.round(100 * r.got / r.max) : 0;
        return `<tr><td><b>第${r.q}問</b><div class="f">${esc(r.name)}</div></td><td class="r"><b>${r.done ? r.got : "—"}</b> / ${r.max || "?"}</td>` +
          `<td><div class="bar"><i style="width:${bar}%"></i></div></td><td class="r">${ref}</td><td class="r">${tp}</td>` +
          `<td class="r">${qTime(r.ms, totalMs() > 0)}</td><td class="r">${r.goal}分</td><td class="r">${targetMin(c) ? Math.round(targetMin(c).v) + "分" + (targetMin(c).all ? "＊" : "") : "—"}</td></tr>`;
      }).join("");
      const miss = [];
      E.items.forEach((it, i) => { if (S.marks[i] === "x" && chosen().includes(it[0])) miss.push([it, S.why[i], rateOf(i)]); });
      miss.sort((a, b) => (b[2] ? b[2].v : -1) - (a[2] ? a[2].v : -1));
      const missHtml = SEC
        ? ((rp && rp.review || []).map(r => `<li>第${r.q}問　あなた ${r.mine.toFixed(0)}%／${r.refKind || "みんな"} ${r.ref.toFixed(0)}%</li>`).join("") || "<li>とくになし</li>")
        : (miss.slice(0, 8).map(([it, w, rr]) => `<li>第${it[0]}問 ${esc(it[1])}（${it[2]}点）${w ? "・" + esc(w) : ""}${rr ? `<span class="f">　${rr.src} ${rr.v.toFixed(0)}%${rr.v >= 70 ? "・取り返しやすい" : ""}</span>` : ""}</li>`).join("") || "<li>× なし</li>");
      const why = {};
      E.items.forEach((it, i) => { if (S.marks[i] === "x" && chosen().includes(it[0])) { const w = S.why[i] || "理由なし"; why[w] = (why[w] || 0) + it[2]; } });
      const whyHtml = Object.entries(why).sort((a, b) => b[1] - a[1]).map(([w, p]) => `<li>${esc(w)}　−${p}点</li>`).join("");
      const tr = trendRows();
      const keep = TREND; TREND = "dev";
      const chart = tr.length ? trendSvg(tr) : "";
      TREND = keep;
      const trendTable = tr.slice(-8).reverse().map(r => `<tr><td>${md(r.at)}</td><td>${esc(r.ex.title)}</td><td class="r">${r.total}</td><td class="r">${r.pct.toFixed(0)}%</td><td class="r">${r.dev === null ? "—" : r.dev.toFixed(1) + (r.est ? "（推定）" : "")}</td></tr>`).join("");
      const css = `@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:"Hiragino Sans","Yu Gothic UI","Noto Sans JP",sans-serif;color:#141a2b;margin:0;font-size:11.5px;line-height:1.5;background:#fff}
        .wrap{max-width:186mm;margin:0 auto;padding:6mm 0}h1{font-size:13px;color:#3559c7;margin:0}h2{font-size:19px;margin:2px 0 2px}h3{font-size:12.5px;margin:12px 0 6px;border-left:4px solid #3559c7;padding-left:6px}
        .meta{color:#5d6680}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.t{border:1px solid #d6dbe6;border-radius:8px;padding:6px 8px}.t.main{background:#3559c7;color:#fff;border-color:#3559c7}
        .t .l{font-size:10.5px;opacity:.85}.t .v{font-size:20px;font-weight:800}.t .v small{font-size:11px;font-weight:600}.t .s{font-size:10px;opacity:.85}
        table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e7eaf1;padding:3px 4px;text-align:left;vertical-align:top}th{font-size:10.5px;color:#5d6680;font-weight:600}.r{text-align:right}.f{color:#8d94a8;font-size:10px}
        .bar{height:7px;background:#e7eaf1;border-radius:4px;overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:#3559c7}
        .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}ul{margin:0;padding-left:16px}li{margin:1px 0}
        svg{width:100%;height:auto}.kk-tgrid{stroke:#e7eaf1}.kk-tmid{stroke:#c3c9d6;stroke-dasharray:4 4}.kk-tlab{fill:#8d94a8;font-size:11px}.kk-tline{fill:none;stroke:#3559c7;stroke-width:2.5}.kk-tdot{fill:#3559c7;stroke:#fff;stroke-width:2}.kk-tdot.is-est{fill:#fff;stroke:#3559c7}
        .foot{margin-top:10px;color:#8d94a8;font-size:9.5px}.noprint{margin:8px 0 0}@media print{.noprint{display:none}}`;
      return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>成績表 ${esc(E.title)}</title><style>${css}</style></head><body><div class="wrap">
        <div class="noprint"><button onclick="print()">印刷・PDFで保存</button>（印刷の画面で「PDFに保存」を選ぶと、PDFになります）</div>
        <h1>成績表　星飛ぶの勉強部屋　過去問演習</h1><h2>${esc(E.title)}</h2>
        <div class="meta">${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}　${E.optional.length ? "選んだ大問：第" + chosen().join("・") + "問" : "全問必答"}${R.done < R.all ? "　（採点の途中）" : ""}</div>
        <div class="tiles">${tiles}</div>
        <h3>大問ごと</h3>
        <table><thead><tr><th>大問</th><th class="r">得点</th><th style="width:20%"></th><th class="r">${natQ ? "全国平均" : "みんなの得点率"}</th><th class="r">目標点</th><th class="r">時間</th><th class="r">自分の目安</th><th class="r">目標時間</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="f">${t.pick ? `目標点・目標時間：点数集計の${t.pick.band ? "学力帯「" + esc(t.pick.band) + "」" : "全員"}（${t.pick.n}人）の大問ごとの平均。目標時間は8割以上取れた人の平均（＊は全員の平均）。「たどり着けなかった？」は1分に満たなかった大問です。` : "目標点・目標時間：" + esc(t.msg || "")}</div>
        <div class="two"><div><h3>${SEC ? "復習すべき大問" : "落とした所（正答率の高い順）"}</h3><ul>${missHtml}</ul></div>
          <div><h3>落とした理由</h3><ul>${whyHtml || "<li>—</li>"}</ul></div></div>
        ${tr.length ? `<h3>得点の推移（${esc(subjName(E))}）</h3>${chart}<table><thead><tr><th>解いた日</th><th>試験</th><th class="r">得点</th><th class="r">得点率</th><th class="r">偏差値</th></tr></thead><tbody>${trendTable}</tbody></table>` : ""}
        <div class="foot">出典：大学入試センター（平均点・標準偏差・成績分布・設問別正答率）。偏差値は (得点−平均点)÷標準偏差×10＋50 の目安。「みんな」「目標」は点数集計（このサイトの利用者）の数字です。</div>
      </div></body></html>`;
    }
    q("#kk-print").addEventListener("click", () => {
      const R = result();
      if (!R.done) { flash(needFirst(), true); return; }
      const w = window.open("", "_blank");
      if (!w) { flash("新しいタブを開けませんでした。このサイトのポップアップを許可してください。", true); return; }
      w.document.open(); w.document.write(reportCardHtml()); w.document.close();
    });
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
    function drawAll() { drawSel(); drawTimer(); drawOX(); drawMini(); drawReport(); drawHist(); drawTrend(); drawGoalNote(); }
    // 点数集計の数字を、ほかの場所（集計に送ったあとなど）から読み直す
    const refreshWB = () => { if (E && E.survey) { WBS = null; WB_FRESH = true; loadWB(); } };
    const want = (opt.initialExam) || store.get("lastExam") || (EXAMS[0] && EXAMS[0].id);
    const startId = examById(want) ? want : EXAMS[0].id;
    Promise.resolve(host.loadHistory ? host.loadHistory() : {}).catch(() => ({})).then(h => { H = h || {}; loadExam(startId); });
    // 開いた直後（まだ最初の試験を読み込んでいないとき）に呼ばれても、描き直しは読み込みのあとにまかせる
    return {reload: () => Promise.resolve(host.loadHistory()).then(h => { H = h || {}; if (E) drawAll(); }), current: () => E && E.id, refreshWB};
  }

  window.Kakomon = {mount, workbookExam};
})();
