/* 公開サイト（点数集計・過去問演習）と受験スケジューラをつなぐ共通の部品。
 *
 * - リンク先（公開サイト・スケジューラの URL）
 * - 点数集計（Apps Script）の読み書き：config・stats の取得、送信
 * - 回答者コード・学力帯など、送るときの設定（この端末に保存）
 * - 成績表の計算：サイト内の順位・偏差値・平均点、本番換算（集計ページ results.html と同じ考え方）、復習すべき大問
 * - スケジューラの記録 → 点数集計の科目・問題集への対応
 * 新しい API は使わない（点数集計の Apps Script をそのまま使う）。
 */
(function () {
  "use strict";
  // 点数集計の Apps Script（公開サイトの app-config.js と同じ）。ローカル検証では app-config.js の値が優先される
  const DEFAULT_API = "https://script.google.com/macros/s/AKfycbzweAZmpLGl2PB5OcjPVMm3oakEWJh2av8DbAeorch-Sr1iaYU9E_GSY6SR0z0EjDlx/exec";
  const L = {
    siteUrl: "https://hoshitobu.github.io/hoshitobu-survey/",
    // 受験スケジューラを公開したら、その URL を入れる（入れるまで公開サイトのメニューにはリンクを出さない）
    schedulerUrl: "",
    ANCHOR_MIN: 10,   // 本番換算に使う「過去問本試の記録」の最低人数
    GAP: 15,          // 復習の候補にする得点率の差（ポイント）
  };
  const apiUrl = () => window.SURVEY_API_URL || DEFAULT_API;
  const OPENED = Date.now();

  // ------------------------------------------------ 点数集計の読み書き
  let CFG = null, STATS = null;
  L.get = action => fetch(apiUrl() + (apiUrl().includes("?") ? "&" : "?") + "action=" + action).then(r => r.json());
  L.config = () => CFG || (CFG = L.get("config").then(c => { if (!c.ok) throw new Error(c.error || "config"); return c; }));
  // 失敗した読み込みは覚えない（次に呼んだとき読み直す）
  L.stats = (fresh) => (!fresh && STATS) || (STATS = L.get("stats").then(s => { if (!s.ok) throw new Error(s.error || "stats"); return s; })
    .catch(err => { STATS = null; throw err; }));
  L.post = body => fetch(apiUrl(), {
    method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body: JSON.stringify(body),
  }).then(r => r.json());

  // ------------------------------------------------ 送るときの設定（この端末に保存。公開サイトの回答者コードと同じものを使える）
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  L.CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
  L.newCode = () => { const a = new Uint32Array(6); crypto.getRandomValues(a); return Array.from(a, x => CODE_CHARS[x % CODE_CHARS.length]).join(""); };
  L.profile = () => ({
    code: ls.get("hoshitobu-link:code") || ls.get("hoshitobu-survey:code") || "",
    band: ls.get("hoshitobu-link:band") || ls.get("hoshitobu-survey:band") || "",
    nickname: ls.get("hoshitobu-link:nickname") || "",
    ranking: ls.get("hoshitobu-link:ranking") === "1",
    consent: ls.get("hoshitobu-link:consent") === "1",
    auto: ls.get("hoshitobu-link:auto") === "1",
  });
  L.saveProfile = p => {
    for (const k of ["code", "band", "nickname"]) if (p[k] !== undefined) ls.set("hoshitobu-link:" + k, String(p[k] || ""));
    for (const k of ["ranking", "consent", "auto"]) if (p[k] !== undefined) ls.set("hoshitobu-link:" + k, p[k] ? "1" : "");
  };
  // この端末から送った記録（集計ページの「あなたの記録」と同じ形）
  L.mine = () => { try { return JSON.parse(ls.get("hoshitobu-link:mine") || "[]"); } catch (e) { return []; } };

  /** 点数集計に送る。rows は点数集計の形（{subject, book, round?, score, sections?}） */
  L.send = async rows => {
    const p = L.profile();
    if (!p.consent) throw new Error("点数集計に送るには、設定で「匿名で集計し、動画で使用すること」への同意が必要です");
    if (!L.CODE_RE.test(p.code)) throw new Error("回答者コード（6文字）を設定してください");
    if (!p.band) throw new Error("学力帯（直近の模試の偏差値）を設定してください");
    if (!rows.length) throw new Error("点数集計に送れる記録がありません");
    const wait = 3500 - (Date.now() - OPENED);   // 点数集計は、開いてすぐの送信を受け付けない
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const body = {mode: "practice", code: p.code, band: p.band, ranking: !!p.ranking && !!p.nickname,
                  website: "", fillMs: Date.now() - OPENED, rows};
    if (p.nickname) body.nickname = p.nickname;
    const res = await L.post(body);
    if (!res.ok) throw new Error(res.error || "送信できませんでした");
    const cfg = await L.config();
    const mine = L.mine(), at = new Date().toISOString();
    for (const r of rows) {
      const s = cfg.subjects.find(x => x.id === r.subject), b = cfg.books.find(x => x.id === r.book);
      mine.push({kind: "practice", subject: s ? s.name : r.subject, book: b ? b.name : r.book,
                 round: r.round === undefined ? null : r.round, score: r.score, at, sections: r.sections || null});
    }
    ls.set("hoshitobu-link:mine", JSON.stringify(mine.slice(-300)));
    // 公開サイトでは、集計ページの「あなたの記録・成績表」にも出るように、回答フォームと同じ場所にも残す
    try {
      const sv = JSON.parse(ls.get("hoshitobu-survey:mine") || "[]");
      for (const m of mine.slice(-rows.length)) sv.push(m);
      ls.set("hoshitobu-survey:mine", JSON.stringify(sv.slice(-300)));
      if (!ls.get("hoshitobu-survey:code")) ls.set("hoshitobu-survey:code", p.code);
    } catch (e) {}
    STATS = null;   // 次に見るときは新しい集計を読む
    return res;
  };

  // ------------------------------------------------ 成績表の計算（results.html の成績表と同じ考え方）
  const popStats = xs => {
    const n = xs.length, m = xs.reduce((a, x) => a + x, 0) / n;
    return {n, m, sd: Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / n)};
  };
  L.popStats = popStats;
  /** このサイトの人たちが過去問の本試を解いたときの位置（d＝全国平均から標準偏差いくつ分上か、k＝ばらつきの比） */
  L.anchorOf = (stats, nat, subject) => {
    const zs = [];
    for (const book in nat) {
      const n = nat[book][subject];
      const cell = stats.practice.find(c => c.subject === subject && c.book === book && c.ranking);
      if (!n || !cell) continue;
      cell.ranking.forEach(r => zs.push((r.score - n.mean) / n.sd));
    }
    if (zs.length < L.ANCHOR_MIN) return {ok: false, n: zs.length};
    const z = popStats(zs);
    return z.sd > 0.05 ? {ok: true, n: z.n, d: z.m, k: z.sd} : {ok: false, n: z.n};
  };
  /** 点数集計のひと欄（科目×問題集×回）の中での、ある点数の位置 */
  L.report = (stats, nat, subject, book, round, score, sections) => {
    const cell = stats.practice.find(c => c.subject === subject && c.book === book && (c.round === null ? round === null || round === undefined : c.round === round));
    // 記録が少ない（3人未満）ときは、数字を出さない（値はすべて null にそろえる）
    if (!cell || !cell.ranking) return {cell: cell || null, ok: false, n: cell ? cell.n : 0, minN: stats.minN,
                                        rank: null, top: null, siteMean: null, siteDev: null, natDev: null, natMean: null, natKind: "", review: []};
    const st = popStats(cell.ranking.map(r => r.score));
    const rank = 1 + cell.ranking.filter(r => r.score > score).length;
    const out = {cell, ok: true, n: st.n, rank, top: Math.max(1, Math.round(rank / st.n * 100)), siteMean: st.m,
                 siteDev: st.sd > 0 ? 50 + 10 * (score - st.m) / st.sd : null, natDev: null, natMean: null, natKind: ""};
    const n = nat && nat[book] && nat[book][subject];
    if (n) { out.natDev = 50 + 10 * (score - n.mean) / n.sd; out.natMean = n.mean; out.natKind = "全国（実際の本試）"; }
    else {
      const a = L.anchorOf(stats, nat || {}, subject);
      out.anchor = a;
      if (a.ok && st.sd > 0) {
        out.natDev = 50 + 10 * (a.d + a.k * (score - st.m) / st.sd);
        out.natMean = st.m - a.d * st.sd / a.k;
        out.natKind = "本番換算（推定）";
      }
    }
    if (sections && sections.length) {
      out.review = sections.map(x => {
        const mine = 100 * x.score / x.max;
        const site = cell.sections ? (cell.sections.find(c => c.q === x.q) || {}).rate : null;
        const ns = n && n.sections ? n.sections.find(c => c.q === x.q) : null;
        const ref = ns ? 100 * ns.mean / ns.max : (site === undefined ? null : site);
        return {q: x.q, mine, ref, gap: ref === null ? null : ref - mine, refKind: ns ? "全国" : "みんな"};
      }).filter(r => r.gap !== null && r.gap >= L.GAP).sort((a, b) => b.gap - a.gap);
    }
    return out;
  };

  // ------------------------------------------------ スケジューラの記録 → 点数集計の科目・問題集
  /** スケジューラの問題セットID → 点数集計の問題集ID・回（対応しないときは null） */
  L.bookOf = setId => {
    let m = /^honshi_(\d{4})$/.exec(setId);
    if (m) { const y = +m[1]; return y >= 2022 ? {book: "honshi" + y} : y === 2021 ? {book: "day1_2021"} : y >= 2010 ? {book: "center_honshi" + y} : null; }
    m = /^tsuishi_(\d{4})$/.exec(setId);
    if (m) { const y = +m[1]; return y >= 2022 ? {book: "tsuishi" + y} : y >= 2010 && y <= 2020 ? {book: "center_tsuishi" + y} : null; }
    m = /^(kawai|sundai|zkai|toshin)_wb_\d{4}_(\d+)$/.exec(setId);
    if (m) return {book: m[1], round: +m[2]};
    return null;   // 模試などは点数集計にない
  };
  const ONE = {physics: "phys", chemistry: "chem", biology: "bio", chigaku: "earth", joho: "info1", kokugo: "kokugo",
               chiri: "geo", nihonshi: "jhist", sekaishi: "whist", koukyo_rinri: "ethics", koukyo_seikei: "polieco"};
  const qOf = name => { const m = /第(\d+)問/.exec(name); return m ? +m[1] : null; };
  /** スケジューラの共テ記録（科目ID→点数、科目ID→大問名→{score,max}）を、点数集計の行に直す。送れない科目は skipped に理由 */
  L.rowsFromTracker = (setId, scores, sections) => {
    const b = L.bookOf(setId);
    const rows = [], skipped = [];
    if (!b) return {rows, skipped: ["この問題セットは点数集計にありません（模試など）"]};
    const base = sid => ({book: b.book, ...(b.round ? {round: b.round} : {}), subject: sid});
    const secList = (obj, prefix) => Object.entries(obj || {})
      .filter(([name]) => !prefix || name.startsWith(prefix))
      .map(([name, v]) => ({q: qOf(name.replace(prefix || "", "")), score: v.score, max: v.max}))
      .filter(x => x.q && Number.isInteger(x.score) && Number.isInteger(x.max));
    for (const [sid, score] of Object.entries(scores)) {
      if (ONE[sid]) {
        if (!Number.isInteger(score)) { skipped.push(`${sid}：点数が整数でない`); continue; }
        const s = secList(sections && sections[sid]);
        rows.push({...base(ONE[sid]), score, ...(s.length && s.reduce((a, x) => a + x.score, 0) === score ? {sections: s} : {})});
      } else if (sid === "math" || sid === "english") {
        // 200点の科目は、大問別の点数から2つに分ける（IA／IIBC、R／L）
        const parts = sid === "math" ? [["IA", "math1a"], ["IIBC", "math2bc"], ["IIB", "math2bc"]] : [["R", "eng_r"], ["L", "eng_l"]];
        const sec = (sections && sections[sid]) || {};
        let used = false;
        for (const [prefix, target] of parts) {
          const names = Object.keys(sec).filter(n => n.startsWith(prefix) && !(prefix === "IIB" && n.startsWith("IIBC")));
          if (!names.length) continue;
          const s = names.map(n => ({q: qOf(n.slice(prefix.length)), score: sec[n].score, max: sec[n].max}));
          const total = s.reduce((a, x) => a + x.score, 0);
          if (!Number.isInteger(total)) continue;
          // 「L第1問〜第6問（合計）」のようにまとめた欄は、大問ごととしては送らない（合計点だけ送る）
          const perQ = names.every(n => !/〜|合計/.test(n)) && s.every(x => x.q && Number.isInteger(x.score) && Number.isInteger(x.max));
          rows.push({...base(target), score: total, ...(perQ ? {sections: s} : {})});
          used = true;
        }
        if (!used) skipped.push(sid === "math" ? "数学：IA と IIBC に分けられない（大問別得点を入れると送れます）" : "英語：R と L に分けられない（大問別得点を入れると送れます）");
      } else {
        skipped.push(`${sid}：点数集計にない科目`);
      }
    }
    return {rows, skipped};
  };
  /** 過去問演習（kakomon）の記録 → 点数集計の行 */
  L.rowsFromKakomon = (exam, rec) => [{
    subject: exam.part === "IA" ? "math1a" : "math2bc", book: "honshi" + exam.year, score: Math.round(rec.total),
    sections: rec.per.map(p => ({q: p.q, score: Math.round(p.got), max: Math.round(p.max)})),
  }];

  /** 点数集計の設定（行の大問ごとを受け付けるか）に合わせて、受け付けない大問ごとを外す */
  L.fitRows = async rows => {
    const cfg = await L.config();
    return rows.map(r => {
      const subject = cfg.subjects.find(s => s.id === r.subject), book = cfg.books.find(b => b.id === r.book);
      if (!subject || !book || (book.exclude || []).includes(subject.id)) return null;
      const tpl = book.sections ? (book.sections[subject.id] || null) : (cfg.sectionGroups || []).includes(book.group) ? (cfg.sections || {})[subject.id] : null;
      const out = {...r};
      if (!tpl || !r.sections || r.sections.some(x => x.q > tpl.length)) delete out.sections;
      if (book.rounds === "none") delete out.round;
      return out;
    }).filter(Boolean);
  };

  // ------------------------------------------------ 公開サイトのメニューに「受験スケジューラ」（URL が決まってから）
  L.addSchedulerLink = () => {
    if (!L.schedulerUrl) return;
    const nav = document.querySelector("header nav");
    if (!nav || nav.querySelector("[data-scheduler-link]")) return;
    const a = document.createElement("a");
    a.href = L.schedulerUrl; a.textContent = "受験スケジューラ ↗"; a.target = "_blank"; a.rel = "noopener";
    a.dataset.schedulerLink = "1";
    nav.append(a);
  };

  window.HoshitobuLink = L;
})();
