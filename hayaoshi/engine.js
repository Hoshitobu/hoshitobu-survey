/* 早押しのエンジン（公開サイト用・手元の版）。科目を知らない。
 * 問題データ（window.HAYAOSHI_PACKS[名前]）を差しかえれば、どの科目でも動く。形は 設計_早押しの問題データ.md。
 * ページ側の指定（window.HAYAOSHI_PAGE）：{ packs: ['muki'], root: 'hy-root', online: true }　online は入口のページだけ（ほかの人との対戦の欄を出す）
 *
 * 端末の記録（localStorage、どれも送らない）：
 *   hoshitobu-hayaoshi:wrong   まちがえた問い  { <問題id>: { due: 次に混ぜる回, n: まちがえた回数, guess: 勘だったか, last: 'YYYY-MM-DD' } }
 *   hoshitobu-hayaoshi:rounds  これまでに終えた組の数（due の基準）
 *   hoshitobu-hayaoshi:best    { <組id>: 最高点 }
 *   hoshitobu-hayaoshi:nick    ニックネーム
 * 入口：
 *   ?today=1&f=muki|zukei|mix   今日の10分（前にまちがえた問い → 早押し10問 → 類題2問）
 *   #<組id>                     その組を始める（辞書から「この内容の早押し」で来る）
 */
(function () {
'use strict';
window.onerror = function (m, u, l) {
  var b = document.getElementById('hy-errbox'); if (!b) return; b.hidden = false; b.textContent += 'エラー: ' + m + ' (' + l + ')\n';
};

/* ============================================================ 設定（ここだけ書きかえる） */
var FIREBASE_CONFIG = (window.HOSHITOBU_FIREBASE && window.HOSHITOBU_FIREBASE.apiKey) ? window.HOSHITOBU_FIREBASE : null;   // apiKey が空（または設定ファイルが無い）あいだは null：Firebase にはつながず、練習相手だけで動く
var GHOSTS_ON = false;               // ゴースト（段階1）。送る文の決定を待っているため、false のあいだは読まない・送らない・結果の「記録を送る」欄と「ランキングに名前が…」も出さない
var DISCORD_URL = '';
var PHRASES = ['よろしく', 'ナイス！', 'おしい', 'またやろう', 'ありがとう'];
var BASE = 100, BONUS_MAX = 100, BONUS_ZERO_MS = 8000, WRONG_WAIT = 2500, LIMIT = 15000;
var T_LIMIT = 60000, T_AFTER_ME = 3000, FIRST_BONUS = 30, NAME_MIN_RATE = 0.8;
var WRONG_MAX_TODAY = 5;             // 今日の10分の1段目に出す、前にまちがえた問いの数の上限
var RUIDAI_DIR = '../ruidai/';       // 類題演習のページの置き場所
var GROUP_LABEL = { muki: '無機化学', zukei: '図形' };

/* ============================================================ 道具 */
var PAGE = window.HAYAOSHI_PAGE || {};
var PACKS = (PAGE.packs || []).map(function (n) { return window.HAYAOSHI_PACKS[n]; }).filter(Boolean);
var ITEMS = [], BYID = {}, SETS = {}, PACKOF = {};
PACKS.forEach(function (p) {
  p.items.forEach(function (q) { ITEMS.push(q); BYID[q.id] = q; PACKOF[q.id] = p; });
  p.sets.forEach(function (s) { SETS[s.set] = s; s._pack = p; });
});
var CIRC = ['①', '②', '③', '④', '⑤', '⑥'];
var KEY = 'hoshitobu-hayaoshi:';
var QS = {}; (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) QS[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ''); });
var HASH = (location.hash || '').replace(/^#/, '');

function $(id) { return document.getElementById(id); }
function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
function elh(q, t, c, x) { var e = el(t, c); if (x != null) { if (q && q.html) e.innerHTML = x; else e.textContent = x; } return e; }   // html:true の問いは、式を MathML にした HTML で持つ（書き出しのとき tex_math.py で変換）
function plain(q, s) { if (!(q && q.html)) return s; var d = document.createElement('div'); d.innerHTML = s; return d.textContent; }
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function LSget(k, d) { try { var v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function LSset(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} }
function rawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { var u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function fmtS(ms) { return (ms / 1000).toFixed(1); }
function limitOf(q) { return (q && q.limit_ms) || LIMIT; }
function bonusZero(q) { return (q && q.bonus_ms) || BONUS_ZERO_MS; }
function pts(ms, q) { return BASE + Math.max(0, Math.round(BONUS_MAX - ms * BONUS_MAX / bonusZero(q))); }
function tlimit(q) { return (q && q.table_ms) || T_LIMIT; }
function slowOf(q) { return (q && q.bonus_ms) ? q.bonus_ms / BONUS_ZERO_MS : 1; }
var NONCE = Math.floor(Math.random() * 1e9);
var CLK = { t0: 0 };
function clk() { return Math.round(performance.now() - CLK.t0); }
function startClock() { CLK.t0 = performance.now(); }
function eligLine(correct, total) {
  var need = Math.ceil(total * NAME_MIN_RATE);
  return 'ランキングに名前が掲載されるのは、' + total + '問中' + need + '問以上に正解したときです。今回は ' + correct + ' 問正解のため、' +
    (correct >= need ? '名前が掲載されます。' : '名前は掲載されません。');
}
function jstDate() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function shuffleSeed(a, seed) { var r = mulberry(hash(seed)); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function groupOfItem(id) { var p = PACKOF[id]; return p ? p.group : null; }

/* ============================================================ マークシート */
function mediaEl(m, small) {
  var w = el('span', 'media' + (small ? ' small' : ''));
  if (m.type === 'swatch') {
    var s = el('span', 'sw' + (m.color ? '' : ' none')); if (m.color) s.style.background = m.color;
    w.appendChild(s); if (!small) w.appendChild(el('span', 'swl', m.label));
  } else if (m.type === 'svg' && m.html) {
    w.className += ' fig'; w.innerHTML = m.html;               // 自作の図（このサイトの生成器が書いた SVG）
  } else if (m.type === 'svg' || m.type === 'photo') {
    var im = document.createElement('img'); im.src = m.src; im.alt = m.label || ''; w.appendChild(im);
    if (m.credit) w.appendChild(el('small', 'credit', m.credit));
  }
  return w;
}
function buildSheet(q, no) {
  var s = el('div', 'sheet');
  var h = el('div', 'shead'), sn = el('span', 'sno');
  sn.appendChild(document.createTextNode('解答番号 ')); sn.appendChild(el('b', '', String(no)));
  h.appendChild(sn); s.appendChild(h);
  var st = el('div', 'stem');
  if (q.prompt) st.appendChild(el('p', 'prompt', q.prompt));
  st.appendChild(elh(q, 'p', 'qt', q.q));
  if (q.media) st.appendChild(mediaEl(q.media));
  s.appendChild(st);
  var list = el('div', 'olist');
  q.choices.forEach(function (c, i) {
    var b = el('button', 'orow'); b.type = 'button'; b.setAttribute('data-i', i);
    b.setAttribute('aria-label', CIRC[i] + ' ' + plain(q, c));
    var ov = el('span', 'oval'); ov.appendChild(el('i', '', CIRC[i])); ov.firstChild.style.fontStyle = 'normal';
    b.appendChild(ov);
    if (q.choice_media && q.choice_media[i]) b.appendChild(mediaEl(q.choice_media[i], true));
    b.appendChild(elh(q, 'span', 'otxt', c));
    b.addEventListener('click', function () { if (s._pick) s._pick(i); });
    list.appendChild(b);
  });
  s.appendChild(list);
  return s;
}
function markSheet(s, pick, ans, reveal) {
  var rows = s.querySelectorAll('.orow');
  for (var i = 0; i < rows.length; i++) {
    rows[i].disabled = true;
    if (i === pick) rows[i].classList.add('marked');
    if (reveal && i === ans) { rows[i].classList.add('right'); rows[i].appendChild(el('span', 'tagans', '答え')); }
  }
}
function feedback(q, st) {
  var f = el('div', 'fb ' + (st.ok ? 'ok' : 'ng'));
  var v = el('p', 'verdict', st.timeout ? '時間切れ' : (st.ok ? '正解' : '不正解'));
  var sm = el('small', '', (st.timeout ? '' : fmtS(st.ms) + ' 秒　') + (st.pt != null ? (st.pt < 0 ? '−' + (-st.pt) : st.pt) + ' 点' : ''));
  v.appendChild(sm); f.appendChild(v);
  var ap = el('p', 'ans', '答え：' + CIRC[q.answer] + ' '); ap.appendChild(elh(q, 'span', '', q.choices[q.answer])); f.appendChild(ap);
  var w = el(q.html ? 'div' : 'p', 'why'); w.appendChild(el('span', 'lab', '解説　')); w.appendChild(elh(q, q.html ? 'div' : 'span', q.html ? 'wbody' : '', q.why)); f.appendChild(w);
  if (!st.ok && !st.timeout && st.pick != null && st.pick >= 0 && q.wrong_why && q.wrong_why[st.pick]) {
    var x0 = el('p', 'slip'); x0.appendChild(el('span', 'lab', CIRC[st.pick] + ' を選んだ形　')); x0.appendChild(elh(q, 'span', '', q.wrong_why[st.pick])); f.appendChild(x0);
  }
  if (q.fix) { var x = el('p', 'fix'); x.appendChild(el('span', 'lab', '訂正のポイント　')); x.appendChild(elh(q, 'span', '', q.fix)); f.appendChild(x); }
  (q.notes || []).forEach(function (n) {
    var p = el('p', 'hnote'); p.appendChild(el('span', 'lab', n.label + '　')); p.appendChild(elh(q, 'span', '', n.text)); f.appendChild(p);
  });
  if (q.source && q.source.length) {
    var sp = el('p', 'src');
    sp.textContent = '関連する過去問：' + q.source.map(function (s) {
      return s.label + '（' + s.summary + (s.rate != null ? '、正答率 ' + s.rate + '%' : '') + '）';
    }).join('／');
    f.appendChild(sp);
  }
  // 答えのあとの手段：粒で見る（対応する1枚がある問いだけ）／勘だった（正解のときの、ひとり練習だけ）
  var pk = PACKOF[q.id], links = pk && pk.links;
  var showLink = q.basho && links && links.basho && !st.noLink, showGuess = st.ok && typeof st.onGuess === 'function';
  if (showLink || showGuess) {
    var act = el('div', 'fbact');
    if (showGuess) {
      var gb = el('button', 'fbbtn fbguess', '勘だった'); gb.type = 'button'; gb.setAttribute('aria-pressed', st.guess ? 'true' : 'false');
      var gn = el('span', 'fbnote', '');
      var paint = function () { var on = gb.getAttribute('aria-pressed') === 'true'; gb.textContent = on ? '勘だった ✓' : '勘だった'; gn.textContent = on ? '次の組で、もう一度出ます。' : ''; };
      gb.addEventListener('click', function () { var on = gb.getAttribute('aria-pressed') !== 'true'; gb.setAttribute('aria-pressed', on ? 'true' : 'false'); st.onGuess(on); paint(); });
      paint(); act.appendChild(gb); act.appendChild(gn);
    }
    if (showLink) {
      var la = el('a', 'fbbtn fblink', '粒で見る'); la.href = links.basho + q.basho; la.target = '_blank'; la.rel = 'noopener';
      la.setAttribute('aria-label', '粒で見る（新しいタブで開く）'); act.appendChild(la);
    }
    f.appendChild(act);
  }
  return f;
}
function discordEl() {
  if (!DISCORD_URL) return null;
  var a = el('a', 'hlink', '感想や質問は Discord のコミュニティへ'); a.href = DISCORD_URL; a.target = '_blank'; a.rel = 'noopener';
  return a;
}

/* ============================================================ 端末の記録（送らない） */
function getWrong() { return LSget('wrong', {}); }
function getRounds() { return LSget('rounds', 0); }
function dueCount() { var w = getWrong(), r = getRounds(); return Object.keys(w).filter(function (id) { return BYID[id] && w[id].due <= r; }).length; }

/* ============================================================ 類題演習から2問（今日の10分の3段目） */
// 類題演習の記録（読むだけ）：
//   ruidai.<テーマid>.<問題> = "ok" | "ok+t" | "again"　／　ruidai.<テーマid>.@log.<問題id> = [{ok: true|false, …}]（最後が最新）
function ruidaiState(page, id) {
  var cur = rawGet('ruidai.' + page + '.' + id), lg = null;
  try { lg = JSON.parse(rawGet('ruidai.' + page + '.@log.' + id) || 'null'); } catch (e) {}
  var last = Array.isArray(lg) && lg.length ? lg[lg.length - 1] : null;
  if (cur === 'again') return 'again';
  if (!cur && last && last.ok === false) return 'again';
  if (cur === 'ok' || cur === 'ok+t' || (last && last.ok === true)) return 'done';
  return 'new';
}
function ruidaiPicks(groups, n) {
  var date = jstDate(), out = [];
  var perGroup = groups.length > 1 ? 1 : n;
  groups.forEach(function (g) {
    var cand = [];
    PACKS.filter(function (p) { return p.group === g; }).forEach(function (p) {
      (p.ruidai || []).forEach(function (t) {
        (t.ids || []).forEach(function (id) { cand.push({ page: t.page, title: t.title, id: id, st: ruidaiState(t.page, id) }); });
      });
    });
    shuffleSeed(cand, 'ruidai:' + date + ':' + g);
    var rank = { again: 0, 'new': 1, done: 2 }, got = [], pages = {};
    cand.sort(function (a, b) { return rank[a.st] - rank[b.st]; });
    cand.forEach(function (c) { if (got.length < perGroup && !pages[c.page]) { got.push(c); pages[c.page] = 1; } });
    cand.forEach(function (c) { if (got.length < perGroup && got.indexOf(c) < 0) got.push(c); });
    out = out.concat(got);
  });
  return out.slice(0, n).map(function (c) {
    var num = (c.id.match(/\d+/) || [''])[0];
    return { href: RUIDAI_DIR + c.page + '.html#' + c.id, label: c.title + '　A ' + num, why: c.st === 'again' ? 'まちがえたので、もう一度' : (c.st === 'new' ? 'まだ解いていない' : 'もう一度') };
  });
}

/* ============================================================ 1人で解く */
var S = null, solTick = null, FLOW = null;
function soloHome() {
  var host = $('solo'); clear(host); S = null; FLOW = null;
  var best = LSget('best', {});
  var d = dueCount();
  var nsets = Object.keys(SETS).length;
  host.appendChild(el('p', 'lead', '1組10問前後（全' + nsets + '組）。早く正解するほど高得点になりますが、誤答すると減点され、次の問題までペナルティの待ち時間が発生します（当てずっぽうは禁物です）。'));
  if (d) host.appendChild(el('p', 'due', '誤答した問題が ' + d + ' 問、次の組に混ざって再出題されます。'));
  var groups = []; PACKS.forEach(function (p) { if (groups.indexOf(p.group) < 0) groups.push(p.group); });
  var tb = el('div', 'kind today');
  tb.appendChild(el('h3', '', '今日の10分'));
  tb.appendChild(el('p', '', '前にまちがえた問い → 早押し10問 → 類題2問。'));
  var tr = el('div', 'setrow');
  groups.forEach(function (g) { tr.appendChild(todayButton(g, GROUP_LABEL[g] || g)); });
  if (groups.length > 1) tr.appendChild(todayButton('mix', 'まぜる'));
  tb.appendChild(tr); host.appendChild(tb);
  PACKS.forEach(function (pk) {
    if (PACKS.length > 1) host.appendChild(el('h2', 'packh', pk.title));
    pk.kinds.forEach(function (k) {
      var box = el('div', 'kind'); box.appendChild(el('h3', '', k.title)); box.appendChild(el('p', '', k.desc));
      var row = el('div', 'setrow');
      pk.sets.filter(function (s) { return s.kind === k.kind; }).forEach(function (s, i) {
        var b = el('button', ''); b.type = 'button';
        b.id = 'set-' + s.set;
        b.appendChild(document.createTextNode(s.btn || ('第' + (i + 1) + '回')));
        b.appendChild(el('small', '', best[s.set] != null ? '最高 ' + best[s.set] + ' 点' : '未挑戦'));
        b.addEventListener('click', function () { soloStart(s.set); });
        row.appendChild(b);
      });
      box.appendChild(row); host.appendChild(box);
    });
  });
}
function todayButton(f, label) {
  var b = el('button', ''); b.type = 'button'; b.appendChild(document.createTextNode(label)); b.appendChild(el('small', '', '始める'));
  b.addEventListener('click', function () { todayStart(f); });
  return b;
}
function soloStart(setId, opt) {
  opt = opt || {};
  var set = opt.set || SETS[setId], rounds = getRounds(), w = getWrong();
  var rng = mulberry(hash('solo' + setId + NONCE));
  var list = set.items.map(function (id) { return { id: id, rev: !!opt.allRev }; });
  if (!opt.noDue) {
    var due = Object.keys(w).filter(function (id) { return BYID[id] && w[id].due <= rounds && set.items.indexOf(id) < 0; })
      .sort(function (a, b) { return w[a].due - w[b].due; }).slice(0, 3);
    due.forEach(function (id) {
      var cand = []; list.forEach(function (x, i) { if (!x.rev) cand.push(i); });
      if (cand.length) list[cand[Math.floor(rng() * cand.length)]] = { id: id, rev: true };
    });
  }
  S = { set: set, list: list, i: 0, res: [], locked: false, flow: !!opt.flow };
  soloShow();
}
function soloShow() {
  var host = $('solo'); clear(host);
  var cur = S.list[S.i], q = BYID[cur.id];
  var bar = el('div', 'hbar');
  bar.appendChild(el('span', 'cnt', (S.i + 1) + ' / ' + S.list.length));
  var dots = el('div', 'dots');
  S.list.forEach(function (x, i) { var d = el('i'); if (i < S.res.length) d.className = S.res[i].ok ? 'on' : 'miss'; else if (i === S.i) d.className = 'cur'; dots.appendChild(d); });
  bar.appendChild(dots);
  if (cur.rev) bar.appendChild(el('span', 'badge', '復習'));
  S.clockEl = el('span', 'clock', '0.0 秒'); bar.appendChild(S.clockEl);
  host.appendChild(bar);
  S.sheet = buildSheet(q, S.i + 1); S.sheet._pick = soloPick; host.appendChild(S.sheet);
  S.fbHost = el('div'); host.appendChild(S.fbHost);
  S.next = el('button', 'big primary', S.i + 1 < S.list.length ? '次の問題へ' : '結果を見る'); S.next.type = 'button'; S.next.hidden = true;
  S.next.addEventListener('click', soloNext); host.appendChild(S.next);
  var qb = el('button', 'quit', '中断する'); qb.type = 'button'; qb.addEventListener('click', function () { clearInterval(solTick); soloHome(); });
  host.appendChild(qb);
  S.locked = false; startClock();
  S.clockEl.textContent = fmtS(clk()) + ' 秒';
  clearInterval(solTick);
  var lim = limitOf(q);
  solTick = setInterval(function () { var ms = clk(); S.clockEl.textContent = fmtS(ms) + ' 秒'; if (ms >= lim) soloPick(-1); }, 50);
}
function soloPick(i) {
  if (!S || S.locked) return;
  var ms = clk(); if (i >= 0 && ms < 250) return;
  S.locked = true; clearInterval(solTick);
  var cur = S.list[S.i], q = BYID[cur.id], timeout = i < 0;
  if (timeout) ms = limitOf(q);
  var pen = q.penalty || { points: 0, wait_ms: WRONG_WAIT };
  var ok = !timeout && i === q.answer, pt = ok ? pts(ms, q) : (timeout ? 0 : -pen.points);
  S.res.push({ id: q.id, ok: ok, ms: ms, pick: i, pt: pt, rev: cur.rev, timeout: timeout });
  markSheet(S.sheet, i, q.answer, true);
  var rec = S.res[S.res.length - 1];
  S.fbHost.appendChild(feedback(q, { ok: ok, ms: ms, pt: pt, timeout: timeout, pick: i, onGuess: function (on) { rec.guess = on; } }));
  S.clockEl.textContent = fmtS(ms) + ' 秒';
  S.next.hidden = false;
  if (!ok) {
    var left = pen.wait_ms, nx = S.next; nx.disabled = true;   // 待ちのあいだに「中断する」で S が消えても止まるよう、ボタンを手元に持つ
    var lab = S.i + 1 < S.list.length ? '次の問題へ' : '結果を見る';
    var t = setInterval(function () { if (!nx.isConnected) { clearInterval(t); return; } left -= 100; nx.textContent = left > 0 ? 'あと ' + (left / 1000).toFixed(1) + ' 秒' : lab; if (left <= 0) { nx.disabled = false; clearInterval(t); } }, 100);
    nx.textContent = 'あと ' + (left / 1000).toFixed(1) + ' 秒';
  }
}
function soloNext() { S.i++; if (S.i >= S.list.length) soloFinish(S.res, S.set); else soloShow(); window.scrollTo(0, 0); }
function soloFinish(res, set) {
  var correct = res.filter(function (r) { return r.ok; }).length;
  var score = Math.max(0, res.reduce(function (a, r) { return a + r.pt; }, 0));
  var avg = Math.round(res.reduce(function (a, r) { return a + r.ms; }, 0) / res.length);
  var okr = res.filter(function (r) { return r.ok; });
  var avgOk = okr.length ? Math.round(okr.reduce(function (a, r) { return a + r.ms; }, 0) / okr.length) : null;
  var rounds = getRounds(), w = getWrong(), day = jstDate();
  res.forEach(function (r) {
    if (r.ok && !r.guess) delete w[r.id];
    else w[r.id] = { due: rounds + 1, n: (w[r.id] ? w[r.id].n : 0) + 1, guess: !!(r.ok && r.guess), last: day };
  });
  LSset('wrong', w); LSset('rounds', rounds + 1);
  if (!set.flow) { var best = LSget('best', {}); if (best[set.set] == null || best[set.set] < score) best[set.set] = score; LSset('best', best); }
  var host = $('solo'); clear(host); window.scrollTo(0, 0);
  resultView(host, {
    title: set.title, correct: correct, total: res.length, score: score, avg: avg, avgOk: avgOk, res: res,
    again: function () { soloStart(set.set, set.flow ? { set: set, noDue: true, flow: true } : null); }, home: soloHome, set: set.set, flow: set.flow
  });
}
function resultView(host, d) {
  host.appendChild(el('h2', '', d.title + ' の結果'));
  var box = el('div', 'result');
  var ng = d.res.filter(function (r) { return r.ok && r.guess; }).length;
  box.appendChild(el('p', 'score', '正解 ' + d.correct + ' / ' + d.total + '　' + d.score + ' 点'));
  if (ng) box.appendChild(el('p', 'stat', 'うち勘だった ' + ng + ' 問'));
  box.appendChild(el('p', 'stat', '平均解答時間 ' + fmtS(d.avg) + ' 秒' + (d.avgOk != null ? '（正解のみ ' + fmtS(d.avgOk) + ' 秒）' : '')));
  var dots = el('div', 'dots'); d.res.forEach(function (r) { dots.appendChild(el('i', r.ok ? 'on' : 'miss')); }); box.appendChild(dots);
  if (GHOSTS_ON && Net.ready && !d.flow) { box.appendChild(el('p', 'elig', eligLine(d.correct, d.total))); box.appendChild(sendBox(d)); }
  host.appendChild(box);
  var wrong = d.res.filter(function (r) { return !r.ok; });
  if (wrong.length) {
    host.appendChild(el('h2', '', '間違えた問題（' + wrong.length + ' 問）'));
    wrong.forEach(function (r) {
      var q = BYID[r.id], c = el('div', 'kind'); c.appendChild(elh(q, 'p', '', q.q)); c.appendChild(feedback(q, r)); host.appendChild(c);
    });
    host.appendChild(el('p', 'due', '間違えた問題は、少し間をあけて、次の組の中で再出題されます。'));
  }
  var guessed = d.res.filter(function (r) { return r.ok && r.guess; });
  if (guessed.length) {
    host.appendChild(el('h2', '', '勘だった問題（' + guessed.length + ' 問）'));
    guessed.forEach(function (r) {
      var q = BYID[r.id], c = el('div', 'kind'); c.appendChild(elh(q, 'p', '', q.q)); c.appendChild(feedback(q, r)); host.appendChild(c);
    });
    host.appendChild(el('p', 'due', '勘だった問題も、次の組の中で、もう一度出ます。'));
  }
  var two = el('div', 'two');
  if (d.flow && FLOW) {
    var nb = el('button', 'big primary', FLOW.stage + 1 < FLOW.rounds.length ? 'つぎへ' : '類題演習へ'); nb.type = 'button';
    nb.addEventListener('click', flowNext); two.appendChild(nb);
  } else {
    var b1 = el('button', 'big primary', 'もう一度挑戦'); b1.type = 'button'; b1.addEventListener('click', d.again);
    var b2 = el('button', 'big', '組の選択へ'); b2.type = 'button'; b2.addEventListener('click', d.home);
    two.appendChild(b1); two.appendChild(b2);
  }
  host.appendChild(two);
  var dc = discordEl(); if (dc) host.appendChild(dc);
}

/* ============================================================ 今日の10分 */
// 1 前にまちがえた問い（端末の記録から、最大 WRONG_MAX_TODAY 問）→ 2 早押し10問（日付で決まる）→ 3 類題2問（リンク）
function pickDaily(groups, n, seed, exclude) {
  var lists = [];
  groups.forEach(function (g) {
    PACKS.filter(function (p) { return p.group === g; }).forEach(function (p) {
      var kinds = (p.daily && p.daily.kinds) || p.kinds.map(function (k) { return k.kind; });
      kinds.forEach(function (k) {
        lists.push({ g: g, ids: shuffleSeed(p.items.filter(function (q) { return q.kind === k && exclude.indexOf(q.id) < 0; }).map(function (q) { return q.id; }), seed + ':' + p.name + ':' + k) });
      });
    });
  });
  var quota = {}; groups.forEach(function (g) { quota[g] = Math.floor(n / groups.length); });
  quota[groups[0]] += n - groups.length * Math.floor(n / groups.length);
  var ids = [], i = 0, guard = 0;
  while (ids.length < n && guard++ < 500) {
    var L = lists[i % lists.length]; i++;
    if (quota[L.g] > 0 && L.ids.length) { ids.push(L.ids.shift()); quota[L.g]--; }
  }
  return shuffleSeed(ids, seed + ':order');
}
function todayStart(f) {
  var avail = []; PACKS.forEach(function (p) { if (avail.indexOf(p.group) < 0) avail.push(p.group); });
  var groups = f === 'mix' ? avail.slice() : [f];
  groups = groups.filter(function (g) { return avail.indexOf(g) >= 0; });
  var host = $('solo'); clear(host); showTab('solo');
  if (!groups.length) {
    host.appendChild(el('p', 'lead', 'このページには、その分野の早押しがありません。'));
    var a = el('a', 'hlink', '早押しのトップへ'); a.href = 'index.html'; host.appendChild(a);
    return;
  }
  var w = getWrong();
  var wrongIds = Object.keys(w).filter(function (id) { return BYID[id] && groups.indexOf(groupOfItem(id)) >= 0; })
    .sort(function (a, b) { return (w[a].due - w[b].due) || (w[b].n - w[a].n); }).slice(0, WRONG_MAX_TODAY);
  var date = jstDate(), seed = 'today10:' + date + ':' + f;
  var daily = pickDaily(groups, 10, seed, wrongIds);
  var rounds = [];
  if (wrongIds.length) rounds.push({ title: '前にまちがえた問い', ids: wrongIds, kind: 'wrong' });
  rounds.push({ title: '早押し10問', ids: daily, kind: 'daily' });
  FLOW = { f: f, groups: groups, rounds: rounds, stage: -1, hadWrong: wrongIds.length > 0, results: [] };
  flowNext();
}
function flowSteps() { return FLOW.hadWrong ? 3 : 2; }
function flowNext() {
  FLOW.stage++;
  var host = $('solo'); clear(host); window.scrollTo(0, 0);
  var off = FLOW.hadWrong ? 0 : 1;
  if (FLOW.stage >= FLOW.rounds.length) return flowEnd();
  var rd = FLOW.rounds[FLOW.stage];
  var box = el('div', 'kind flow');
  box.appendChild(el('p', 'stagehd', '今日の10分　' + (FLOW.stage + 1 + off) + ' / 3'));
  box.appendChild(el('h3', '', rd.title + '（' + rd.ids.length + '問）'));
  if (!FLOW.hadWrong && FLOW.stage === 0) box.appendChild(el('p', '', '前にまちがえた問いはまだありません。早押し10問から始めます。'));
  box.appendChild(el('p', '', rd.kind === 'wrong' ? '前の組でまちがえた問い、勘で当てた問いです。' : (FLOW.f === 'mix' ? '図形と無機化学から5問ずつ。同じ日は、だれが開いても同じ問題です。' : '日替わりです。同じ日は、だれが開いても同じ問題です。')));
  var go = el('button', 'big primary', '始める'); go.type = 'button';
  go.addEventListener('click', function () {
    var set = { set: 'flow-' + FLOW.f + '-' + rd.kind, title: rd.title, items: rd.ids, flow: true };
    soloStart(set.set, { set: set, noDue: true, flow: true, allRev: rd.kind === 'wrong' });
  });
  box.appendChild(go); host.appendChild(box);
}
function flowEnd() {
  var host = $('solo'); clear(host);
  var box = el('div', 'kind flow');
  box.appendChild(el('p', 'stagehd', '今日の10分　3 / 3'));
  box.appendChild(el('h3', '', '類題演習 2問'));
  var picks = ruidaiPicks(FLOW.groups, 2);
  if (picks.length) {
    box.appendChild(el('p', '', 'リンクから、その問題が開きます。'));
    var ul = el('ul', 'ruidai-list');
    picks.forEach(function (p) {
      var li = el('li'), a = el('a', 'fbbtn fblink', p.label); a.href = p.href; li.appendChild(a); li.appendChild(el('span', 'fbnote', '　' + p.why)); ul.appendChild(li);
    });
    box.appendChild(ul);
  } else box.appendChild(el('p', '', '今日の類題演習はありません。'));
  box.appendChild(el('p', 'due', 'まちがえた問いは、次の組の中で、また出ます。'));
  var two = el('div', 'two');
  var b2 = el('button', 'big', '早押しの組を選ぶ'); b2.type = 'button'; b2.addEventListener('click', soloHome);
  two.appendChild(b2); box.appendChild(two);
  host.appendChild(box); FLOW = null;
}

/* ============================================================ ニックネーム（出してよいか） */
var NG_WORDS = [];                      // 不適切な語の一覧は、公開サイトの側から渡される（ここでは空）
function normNick(s) {
  s = (s || '').normalize('NFKC').toLowerCase();
  s = s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  return s.replace(/[\s　_\-.,、。・!！?？*＊~〜]/g, '');
}
function nickShown(raw) {
  var n = (raw || '').trim(); if (!n || n.length > 10) return '名無し';
  var k = normNick(n);
  if (!k || /^[0-9]+$/.test(k) || /^[^\p{L}\p{N}]+$/u.test(k)) return '名無し';
  if (/@|https?:|www\.|\.com|\.jp|\d{3,}/.test(k)) return '名無し';
  for (var i = 0; i < NG_WORDS.length; i++) if (k.indexOf(normNick(NG_WORDS[i])) >= 0) return '名無し';
  return n;
}
function sendBox(d) {
  // GHOSTS_ON が true のときだけ出る。ニックネームは送らない（規則の形に nick は入れない）
  var w = el('div', 'nick');
  var b = el('button', 'big', '記録を送る'); b.type = 'button'; b.style.marginTop = '0'; b.style.width = 'auto'; b.style.padding = '0 16px';
  b.addEventListener('click', function () {
    var per = d.res.map(function (r) { return [r.ok ? 1 : 0, r.ms]; });
    Net.submitGhost(d.set, { score: d.score, avg_ms: d.avg, per: per })
      .then(function () { b.textContent = '送信しました'; b.disabled = true; }, function () { b.textContent = '送れませんでした'; });
  });
  w.appendChild(b); return w;
}

/* ============================================================ つなぐ部分（Firebase Realtime Database） */
// 設定は window.HOSHITOBU_FIREBASE（survey/public/firebase-config.js）。apiKey が空のあいだは FIREBASE_CONFIG が null で、Firebase にはつながない。
// 読みこむのは、入口のページを開いたときと、オンラインの欄を使うときだけ。匿名ログイン（タブごとに別の人）で、部屋の道は rooms/<部屋の番号>。
// 時刻は、書くときはすべて ServerValue.TIMESTAMP（規則が now との一致を見ている）。読むときは Net.now()（端末の時計＋サーバーとのずれ）。
// ゴースト（ghosts/<組>/<uid>）は GHOSTS_ON が false のあいだ、呼ばない。
var Net = {
  ready: false, db: null, fb: null, offset: 0, uid: null, _init: null,
  loadScript: function (url) {
    return new Promise(function (ok, ng) { var s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = function () { ng(new Error('script')); }; document.head.appendChild(s); });
  },
  init: function () {
    if (!FIREBASE_CONFIG) return Promise.resolve(false);
    if (Net._init) return Net._init;
    var base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    Net._init = Net.loadScript(base + 'firebase-app-compat.js')
      .then(function () { return Net.loadScript(base + 'firebase-auth-compat.js'); })
      .then(function () { return Net.loadScript(base + 'firebase-database-compat.js'); })
      .then(function () {
        Net.fb = window.firebase;
        if (!Net.fb.apps.length) Net.fb.initializeApp(FIREBASE_CONFIG);
        var au = Net.fb.auth();
        return au.setPersistence(Net.fb.auth.Auth.Persistence.SESSION).then(function () { return au.signInAnonymously(); });
      })
      .then(function (cred) {
        Net.uid = cred.user.uid; Net.db = Net.fb.database();
        return new Promise(function (ok) {
          var done = false, fin = function () { if (!done) { done = true; ok(); } };
          Net.db.ref('.info/serverTimeOffset').on('value', function (s) { Net.offset = s.val() || 0; fin(); });
          setTimeout(fin, 4000);
        });
      })
      .then(function () { Net.ready = true; return true; })
      .catch(function (e) { Net._init = null; throw e; });
    return Net._init;
  },
  now: function () { return Date.now() + Net.offset; },
  ts: function () { return Net.fb.database.ServerValue.TIMESTAMP; },
  roomRef: function (id, sub) { return Net.db.ref('rooms/' + id + (sub ? '/' + sub : '')); },
  // ---- ゴースト（段階1）。GHOSTS_ON が true のときだけ使う。規則：ghosts/{set}/{uid} に1回だけ。nick は入れない
  ghostCode: function () {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', re = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/, c = rawGet('hoshitobu-survey:code');
    if (!c || !re.test(c)) {
      c = rawGet(KEY + 'gcode');
      if (!c || !re.test(c)) { c = ''; for (var i = 0; i < 6; i++) c += A.charAt(Math.floor(Math.random() * A.length)); try { localStorage.setItem(KEY + 'gcode', c); } catch (e) {} }
    }
    return c;
  },
  submitGhost: function (setId, rec) {
    if (!Net.ready) return Promise.reject(new Error('未接続'));
    if (!rec.per || rec.per.length !== 10 || rec.avg_ms < 300) return Promise.resolve({ skipped: true });
    var per = {}, ok = 0;
    rec.per.forEach(function (p, i) { per[i] = { ok: !!p[0], ms: Math.max(0, Math.min(30000, Math.round(p[1]))) }; if (p[0]) ok++; });
    var data = { correct: ok, score: Math.max(0, Math.min(10000, Math.round(rec.score))), avg_ms: Math.max(0, Math.min(30000, Math.round(rec.avg_ms))), per: per, at: Net.ts(), code: Net.ghostCode() };
    return Net.db.ref('ghosts/' + setId + '/' + Net.uid).transaction(function (cur) { return cur === null ? data : undefined; });
  },
  fetchGhosts: function (setId, n) {
    if (!Net.ready) return Promise.resolve([]);
    return Net.db.ref('ghosts/' + setId).orderByChild('score').limitToLast(50).once('value').then(function (s) {
      var best = {};
      s.forEach(function (c) {
        var v = c.val();
        if (!v || !v.per || !(v.avg_ms >= 300) || c.key === Net.uid) return;
        if (!best[v.code] || v.at < best[v.code].at) best[v.code] = v;           // 同じ回答者コードは、いちばん早い1件だけ
      });
      var a = Object.keys(best).map(function (k) {
        var v = best[k], per = [];
        for (var i = 0; i < 10; i++) per.push(v.per[i] ? [v.per[i].ok ? 1 : 0, v.per[i].ms] : [0, 30000]);
        return { avg_ms: v.avg_ms, per: per };
      });
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
      return a.slice(0, n || 1);
    });
  }
};

/* ============================================================ 相手の口（opponent source） */
/* 答えるまでの時間＝読む時間＋考える時間（2026-11-25 本人「AIが速すぎます」で作り直し。前は最低 0.9 秒で、問題文を読む時間に届いていなかった）。
 *   読む時間：問いの文と選択肢を、1秒に cps 文字で読む。選択肢は 0.75 倍（正解が見えたら残りは流し読み）。図があれば +1.5 秒、色見本の選択肢は +0.8 秒、見て構える 0.5 秒。
 *             「つよい」の 12 文字/秒は、よくできる受験生が問題文をふつうに読む速さ。読む時間の 0.85 倍より速くは答えない。
 *   考える時間：think × 問いの重さ（図形は bonus_ms で長い）× 難しさ（正答率の低い問いほど長い）。
 *   ばらつき：合計に exp(sd × 正規乱数) をかける。
 *   目安（本人 2026-11-25「合わせて20秒ぐらいあってもいい」「やさしいは40秒±20秒ぐらい」）：図形の問いの中央が やさしい 約40〜45秒・ふつう 約20〜23秒・つよい 約10〜12秒。
 *   無機は文が短いので、やさしい 約20秒・ふつう 約11秒・つよい 約7秒。対戦の制限時間 T_LIMIT も、遅い相手が答えられるよう 60 秒（図形と同じ）にした。 */
var LV = { easy: { label: 'やさしい', k: 1.4, cps: 5, think: 9000, sd: 0.4 }, normal: { label: 'ふつう', k: 1.0, cps: 8, think: 4000, sd: 0.3 }, strong: { label: 'つよい', k: 0.55, cps: 12, think: 1500, sd: 0.2 } };
function textLen(q, s) {
  if (s == null) return 0;
  if (typeof s === 'object') s = s.text || s.label || '';
  var t = String(s);
  if (q && q.html) { var d = document.createElement('div'); d.innerHTML = t; Array.prototype.forEach.call(d.querySelectorAll('annotation, annotation-xml'), function (a) { a.parentNode.removeChild(a); }); t = d.textContent; }
  return t.replace(/\s+/g, '').length;
}
var READ_CHARS = {};
function readChars(q) {
  if (READ_CHARS[q.id] == null) {
    var n = textLen(q, q.prompt) + textLen(q, q.q);
    (q.choices || []).forEach(function (c) { n += 0.75 * textLen(q, c); });
    READ_CHARS[q.id] = n;
  }
  return READ_CHARS[q.id];
}
function readMs(q, cps) { return 500 + readChars(q) * 1000 / cps + (q.media ? 1500 : 0) + (q.choice_media ? 800 : 0); }
function thinkMs(q, think) { return think * slowOf(q) * (0.6 + 0.8 * (1 - q.difficulty)); }
function answerMs(q, L, r) { var rd = readMs(q, L.cps); return Math.max(rd * 0.85, (rd + thinkMs(q, L.think)) * Math.exp(L.sd * gauss(r))); }
function wrongChoice(q, r) { var a = []; for (var i = 0; i < q.choices.length; i++) if (i !== q.answer) a.push(i); return a[Math.floor(r() * a.length)]; }
function cpuPlan(q, lv, seed) {
  var r = mulberry(hash(seed)), L = LV[lv], pq = q.difficulty;
  var pc = Math.max(0.1, Math.min(0.98, 1 - (1 - pq) * L.k)), ok = r() < pc;
  var ms = answerMs(q, L, r);
  ms = Math.round(Math.max(1500, Math.min(tlimit(q) - 500, ms)) / 100) * 100;
  return { ms: ms, ok: ok, choice: ok ? q.answer : wrongChoice(q, r) };
}
function srcBase(o) {
  o.timers = [];
  o.onQuestion = function (tb, qi, q) {
    var p = o.plan(qi, q);
    o.timers.push(setTimeout(function () { tb.onPress({ seat: o.seat, qi: qi, ms: p.ms, ok: p.ok, choice: p.choice }); }, p.ms));
  };
  o.cancel = function () { o.timers.forEach(clearTimeout); o.timers = []; };
  return o;
}
function cpuSource(seat, lv, seedBase) {
  return srcBase({ seat: seat, name: '練習相手', sub: LV[lv].label, kind: 'cpu', plan: function (qi, q) { return cpuPlan(q, lv, seedBase + ':' + qi); } });
}
function ghostSource(seat, label, per, name) {
  // per：{ <問題id>: [正解か, ms] }。出す順をまぜても、問いごとに同じ記録を使う
  return srcBase({ seat: seat, name: name || 'ゴースト', sub: label, kind: 'ghost', plan: function (qi, q) { var p = per[q.id] || [0, tlimit(q) - 2500]; return { ms: p[1], ok: !!p[0], choice: null }; } });
}
function perById(items, per) { var m = {}; items.forEach(function (id, i) { if (per[i]) m[id] = per[i]; }); return m; }
function fakeGhost(items, seedKey) {
  var r = mulberry(hash('ghost:' + seedKey));
  return items.map(function (id) {
    var q = BYID[id], ok = r() < Math.min(0.95, q.difficulty + 0.12);
    var ms = answerMs(q, LV.normal, r);         // 記録の無い組の代わり：「ふつう」と同じ読み方・考え方
    return [ok ? 1 : 0, Math.round(Math.max(1500, Math.min(tlimit(q) - 2500, ms)) / 100) * 100];
  });
}
function makeOpponents(seedKey, lv2, lv3, per, real) {
  // real：Firebase から取ってきた、ほかの人の本物の記録のときだけ。作り物（fakeGhost）は練習相手として出す
  return [real ? ghostSource(1, 'ほかの人の記録', per) : ghostSource(1, LV.normal.label, per, '練習相手'), cpuSource(2, lv2, 'cpu2:' + seedKey), cpuSource(3, lv3, 'cpu3:' + seedKey)];
}
/* おまかせ（2026-11-25 本人「同じ問題しか出なくね？せっかく問題セットたくさんあるのに」）：
 * そのページの全部の問題から、毎回ちがう10問。ページに分野が2つ以上あれば、分野を順にまわして選ぶ。前の対戦に出た問いは、できるだけ避ける。
 * 組を指定したときも、出す順を毎回まぜる。 */
var RANDOM_SET = '*おまかせ*', RANDOM_N = 10, TB_GAME = 0, TB_LAST = {};
function pickMix(rng, avoid) {
  var pools = PACKS.map(function (pk) {
    var a = pk.items.map(function (q) { return q.id; }), fresh = avoid ? a.filter(function (id) { return !avoid[id]; }) : a;
    if (avoid && fresh.length >= Math.ceil(RANDOM_N / PACKS.length)) a = fresh;
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }), items = [], k = 0;
  while (items.length < RANDOM_N && pools.some(function (a) { return a.length; })) { var a = pools[k++ % pools.length]; if (a.length) items.push(a.pop()); }
  return items;
}
function randomSet() {
  return { set: RANDOM_SET, title: 'おまかせの10問', subject: PACKS.length === 1 ? PACKS[0].subject : null, items: pickMix(Math.random, TB_LAST) };
}
function mixOrder(ids) { var a = ids.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

/* ============================================================ 対戦（4人で同時に解く） */
var T = null, tbTick = null;
function scoreQ(pr, q) {
  var first = -1, best = 1e9;
  pr.forEach(function (p, s) { if (p && p.ok && p.ms < best) { best = p.ms; first = s; } });
  return { first: first, pts: [0, 1, 2, 3].map(function (s) { var p = pr[s]; if (!p) return 0; if (p.ok) return pts(p.ms, q) + (s === first ? FIRST_BONUS : 0); return p.timeout || p.ms == null ? 0 : -((q && q.penalty) ? q.penalty.points : 0); }) };
}
function tlOf(q) { return (T && T.online) ? Math.min(tlimit(q), ONLINE_TL_MAX) : tlimit(q); }
function setField(id) {
  var f1 = el('div', 'field'); f1.appendChild(el('label', '', '組'));
  var sel = document.createElement('select'); sel.id = id;
  var o0 = document.createElement('option'); o0.value = RANDOM_SET; o0.textContent = 'おまかせ（毎回ちがう10問）'; o0.selected = true; sel.appendChild(o0);
  PACKS.forEach(function (pk) {
    pk.kinds.forEach(function (k) {
      var g = document.createElement('optgroup'); g.label = (PACKS.length > 1 ? pk.title + '　' : '') + k.title;
      pk.sets.filter(function (s) { return s.kind === k.kind; }).forEach(function (s) { var o = document.createElement('option'); o.value = s.set; o.textContent = s.title; g.appendChild(o); });
      sel.appendChild(g);
    });
  });
  f1.appendChild(sel); return f1;
}
function lvField(parent, id, label, def) {
  var f = el('div', 'field'); f.appendChild(el('label', '', label)); var s = document.createElement('select'); s.id = id;
  ['easy', 'normal', 'strong'].forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = LV[k].label; if (k === def) o.selected = true; s.appendChild(o); });
  f.appendChild(s); parent.appendChild(f);
}
function tableHome() {
  lobbyStop();
  var host = $('table'); clear(host);
  var n = el('div', 'night');
  n.appendChild(el('h2', '', '対戦'));
  if (FIREBASE_CONFIG && PAGE.online) { onlineSection(n); n.appendChild(el('h3', 'prh', '練習相手と対戦')); }
  else if (FIREBASE_CONFIG) {
    var lk = el('p', 'ormore', 'ほかの人との対戦は、'); var la = el('a', 'hlink', '早押しの入口のページ'); la.href = 'index.html'; lk.appendChild(la); lk.appendChild(document.createTextNode('から。'));
    n.appendChild(lk);
  }
  n.appendChild(el('p', 'lead', GHOSTS_ON && Net.ready
    ? '同じ組を、あなたを含む4人で同時に解きます。相手は、ゴースト（ほかの人の記録）1人と練習相手2人です。記録がまだ無い組では、練習相手が代わりに入ります。'
    : '同じ組を、あなたを含む4人で同時に解きます。相手は練習相手3人です。'));
  n.appendChild(setField('tbset'));
  lvField(n, 'tblv2', '練習相手1の強さ', 'easy'); lvField(n, 'tblv3', '練習相手2の強さ', 'strong');
  var go = el('button', 'big primary', '対戦をはじめる'); go.type = 'button';
  go.addEventListener('click', function () { tableStart($('tbset').value, $('tblv2').value, $('tblv3').value); });
  n.appendChild(go); host.appendChild(n);
}
function tableStart(setId, lv2, lv3) {
  var random = setId === RANDOM_SET, set = random ? randomSet() : SETS[setId], order = random ? set.items : mixOrder(set.items);
  var seedKey = setId + ':' + NONCE + ':' + (++TB_GAME);
  TB_LAST = {}; order.forEach(function (id) { TB_LAST[id] = 1; });
  var fake = function () { return { per: perById(set.items, fakeGhost(set.items, seedKey)), real: false }; };
  // ほかの人の記録は組ごと（その組の元の順の per）。おまかせには記録が無いので、練習相手が入る
  var load = GHOSTS_ON && Net.ready && !random ? Net.fetchGhosts(setId, 1).then(function (a) { return a.length ? { per: perById(set.items, a[0].per), real: true } : fake(); }).catch(fake) : Promise.resolve(fake());
  load.then(function (g) {
    var opp = makeOpponents(seedKey, lv2, lv3, g.per, g.real);
    T = {
      set: set, qs: order.map(function (id) { return BYID[id]; }), qi: -1, presses: [], tot: [0, 0, 0, 0], corr: [0, 0, 0, 0], firsts: [], closed: true, me: 0,
      seats: [{ seat: 0, name: 'あなた', sub: '', kind: 'self' }].concat(opp.map(function (o) { return { seat: o.seat, name: o.name, sub: o.sub, kind: o.kind }; })),
      opp: opp, say: ''
    };
    T.onPress = tbPress;
    tableNext();
  });
}
function tableNext() {
  T.qi++;
  if (T.qi >= T.qs.length) return tableResult();
  T.q = T.qs[T.qi]; T.presses[T.qi] = [null, null, null, null]; T.closed = false; T.nextEl = null;
  tableShow();
  startClock();
  T.opp.forEach(function (o) { o.onQuestion(T, T.qi, T.q); });
  clearInterval(tbTick); tbTick = setInterval(tbTickFn, 50);
  tbTickFn();
}
function tableShow() {
  var host = $('table'); clear(host);
  var n = el('div', 'night'); host.appendChild(n);
  T.chipsEl = el('div', 'hchips'); n.appendChild(T.chipsEl); tbChips();
  var bar = el('div', 'hbar');
  bar.appendChild(el('span', 'cnt', '問 ' + (T.qi + 1) + ' / ' + T.qs.length));
  T.clockEl = el('span', 'clock', '0.0 秒'); bar.appendChild(T.clockEl); n.appendChild(bar);
  var lanes = el('div', 'lanes'); n.appendChild(lanes);
  var tl = tlOf(T.q), tsec = tl / 1000, step = tsec / 4;
  var sc = el('div', 'scale'); sc.appendChild(el('span')); var sci = el('div', 'sc');
  [0, 1, 2, 3, 4].forEach(function (k) { var s = Math.round(step * k); var sp = el('span', k === 4 ? 'last' : '', s + '秒'); sp.style.left = (k / 4 * 100) + '%'; sci.appendChild(sp); });
  sc.appendChild(sci); sc.appendChild(el('span')); lanes.appendChild(sc);
  T.laneEls = T.seats.map(function (s) {
    var row = el('div', 'lane'), nm = el('div', 'lname'); nm.appendChild(el('b', '', s.name)); if (s.sub) nm.appendChild(el('small', '', s.sub));
    var tr = el('div', 'track'); var cur = el('span', 'cur'); tr.appendChild(cur); var rs = el('div', 'lres', '考え中');
    row.appendChild(nm); row.appendChild(tr); row.appendChild(rs); lanes.appendChild(row);
    return { row: row, track: tr, cur: cur, res: rs };
  });
  T.sheet = buildSheet(T.q, T.qi + 1); T.sheet._pick = T.online ? orSelf : tbSelf; n.appendChild(T.sheet);
  T.fbHost = el('div'); n.appendChild(T.fbHost);
  if (T.online) {
    T.cdEl = el('p', 'stat orcd', ''); n.appendChild(T.cdEl);                 // 「次の問題へ」ボタンは出さない（進めるのは host）
    n.appendChild(orChatRow()); T.sayEl = el('p', 'say', ''); n.appendChild(T.sayEl);
    var oq = el('button', 'quit', '対戦を抜ける'); oq.type = 'button'; oq.addEventListener('click', function () { orBack(false); }); n.appendChild(oq);
  } else {
    T.next = el('button', 'big primary', T.qi + 1 < T.qs.length ? '次の問題へ' : '結果を見る'); T.next.type = 'button'; T.next.hidden = true;
    T.next.addEventListener('click', function () { tableNext(); window.scrollTo(0, 0); }); n.appendChild(T.next);
    var chat = el('div', 'chat'); PHRASES.forEach(function (p, i) {
      var b = el('button', '', p); b.type = 'button';
      b.addEventListener('click', function () { T.say = 'あなた：' + p; T.sayEl.textContent = T.say; });
      chat.appendChild(b);
    });
    n.appendChild(chat); T.sayEl = el('p', 'say', T.say); n.appendChild(T.sayEl);
    var qb = el('button', 'quit', '対戦をやめる'); qb.type = 'button'; qb.addEventListener('click', tableLeave); n.appendChild(qb);
  }
  for (var s = 0; s < 4; s++) if (T.presses[T.qi][s]) laneUpdate(s);
}
function tableLeave() { clearInterval(tbTick); if (T) T.opp.forEach(function (o) { o.cancel(); }); T = null; tableHome(); }
function tbChips() {
  clear(T.chipsEl);
  T.seats.forEach(function (s) {
    var c = el('div', 'chip' + (s.seat === T.me ? ' me' : '')); c.appendChild(el('span', '', s.name));
    c.appendChild(el('span', 'sub', (s.gone && T.online ? '退出' : s.sub) || ' '));
    c.appendChild(el('b', '', T.tot[s.seat] + ' 点')); T.chipsEl.appendChild(c);
  });
}
function laneUpdate(seat) {
  var L = T.laneEls[seat], p = T.presses[T.qi][seat]; if (!L || !p) return;
  var old = L.track.querySelector('.mk'); if (old) old.remove();
  if (p.ms == null) { L.res.textContent = '時間切れ'; return; }
  var m = el('span', 'mk ' + (p.ok ? 'ok' : 'ng') + (T.first === seat ? ' first' : ''), p.ok ? '○' : '×');
  m.style.left = Math.max(2, Math.min(98, p.ms / tlOf(T.q) * 100)) + '%'; L.track.appendChild(m);
  L.res.textContent = fmtS(p.ms) + ' 秒 ' + (p.ok ? '正解' : '不正解');
}
function tbSelf(i) {
  if (!T || T.closed) return; var pr = T.presses[T.qi]; if (pr[0]) return;
  var ms = clk(); if (ms < 250) return;
  markSheet(T.sheet, i, T.q.answer, false);
  T.onPress({ seat: 0, qi: T.qi, ms: ms, ok: i === T.q.answer, choice: i });
}
function tbPress(e) {
  if (!T || T.closed || e.qi !== T.qi) return;
  var pr = T.presses[T.qi]; if (pr[e.seat]) return;
  pr[e.seat] = { ms: e.ms, ok: e.ok, choice: e.choice }; laneUpdate(e.seat);
  if (pr[0] && pr[1] && pr[2] && pr[3]) tableClose();
}
function tbTickFn() {
  if (!T || T.closed) return;
  var tl = tlimit(T.q), after = (T.q.after_ms || T_AFTER_ME);
  var ms = clk(); T.clockEl.textContent = fmtS(Math.min(ms, tl)) + ' 秒';
  T.laneEls.forEach(function (L) { L.cur.style.left = Math.min(100, ms / tl * 100) + '%'; });
  var me = T.presses[T.qi][0];
  if (ms >= tl) { if (!me) T.presses[T.qi][0] = { ms: null, ok: false, timeout: true }; tableClose(); }
  else if (me && ms >= me.ms + after) tableClose();
}
function tbApply(qi) {
  var r = scoreQ(T.presses[qi], T.qs[qi]); T.firsts[qi] = r.first;
  for (var s = 0; s < 4; s++) { T.tot[s] += r.pts[s]; var p = T.presses[qi][s]; if (p && p.ok) T.corr[s]++; }
  return r;
}
function tableClose() {
  if (T.closed) return; T.closed = true; clearInterval(tbTick); T.opp.forEach(function (o) { o.cancel(); });
  var qi = T.qi, r = tbApply(qi); T.first = r.first;
  var pr = T.presses[qi];
  for (var s = 0; s < 4; s++) { if (pr[s]) laneUpdate(s); else T.laneEls[s].res.textContent = '—'; T.laneEls[s].cur.style.display = 'none'; }
  tbChips();
  var me = pr[0] || { ms: null, ok: false, timeout: true };
  markSheet(T.sheet, me.choice == null ? -1 : me.choice, T.q.answer, true);
  T.fbHost.appendChild(feedback(T.q, { ok: me.ok, ms: me.ms, pt: r.pts[0], timeout: !!me.timeout, noLink: true, pick: me.choice }));
  T.next.hidden = false;
  if (!me.ok) {
    var left = (T.q.penalty ? T.q.penalty.wait_ms : WRONG_WAIT), nx = T.next; nx.disabled = true; var lab = T.qi + 1 < T.qs.length ? '次の問題へ' : '結果を見る';
    nx.textContent = 'あと ' + (left / 1000).toFixed(1) + ' 秒';
    var t = setInterval(function () { if (!nx.isConnected) { clearInterval(t); return; } left -= 100; nx.textContent = left > 0 ? 'あと ' + (left / 1000).toFixed(1) + ' 秒' : lab; if (left <= 0) { nx.disabled = false; clearInterval(t); } }, 100);
  }
}
function tableResult() {
  clearInterval(tbTick);
  var host = $('table'); clear(host); window.scrollTo(0, 0);
  var n = el('div', 'night'); host.appendChild(n);
  n.appendChild(el('h2', '', T.set.title + ' の順位'));
  var rows = T.seats.map(function (s) {
    var ms = []; T.presses.forEach(function (pr) { var p = pr[s.seat]; if (p && p.ms != null) { ms.push(p.ms); } });
    return { s: s, pts: T.tot[s.seat], corr: T.corr[s.seat], avg: ms.length ? Math.round(ms.reduce(function (a, b) { return a + b; }, 0) / ms.length) : null };
  }).sort(function (a, b) { return b.pts - a.pts || b.corr - a.corr || (a.avg || 1e9) - (b.avg || 1e9); });
  var tb = document.createElement('table'); tb.className = 'rank';
  var hd = document.createElement('tr'); ['順位', '名前', '得点', '正解', '平均時間'].forEach(function (h, i) { var th = document.createElement('th'); th.textContent = h; if (i > 1) th.className = 'n'; hd.appendChild(th); }); tb.appendChild(hd);
  var rk = 0, prev = null;
  rows.forEach(function (r, i) {
    if (prev === null || r.pts !== prev) rk = i + 1; prev = r.pts;
    var tr = document.createElement('tr'); if (r.s.seat === T.me) tr.className = 'me';
    [rk, r.s.name + (r.s.sub ? '・' + r.s.sub : ''), r.pts, r.corr + '/' + T.qs.length, r.avg == null ? '—' : fmtS(r.avg) + '秒'].forEach(function (v, j) {
      var td = document.createElement('td'); td.textContent = v; if (j > 1) td.className = 'n'; tr.appendChild(td);
    }); tb.appendChild(tr);
  });
  n.appendChild(tb);
  n.appendChild(el('p', 'stat', '問題ごとの結果（○ 正解　× 不正解　— 未解答）'));
  var g = el('div', 'grid10'); g.style.gridTemplateColumns = '5.6em repeat(' + T.qs.length + ',1fr)';
  T.seats.forEach(function (s) {
    g.appendChild(el('div', 'nm', s.name));
    T.qs.forEach(function (q, i) { var p = T.presses[i][s.seat]; g.appendChild(el('div', 'c' + (p ? (p.ok ? ' ok' : ' ng') : ''), p ? (p.ok ? '○' : '×') : '—')); });
  });
  n.appendChild(g);
  var correct = T.corr[T.me];
  if (GHOSTS_ON && Net.ready && !T.online) n.appendChild(el('p', 'elig', eligLine(correct, T.qs.length)));
  var wrong = [];
  T.qs.forEach(function (q, i) { var p = T.presses[i][T.me]; if (!p || !p.ok) wrong.push({ q: q, p: p || { ms: null, ok: false, timeout: true }, pt: 0 }); });
  var rounds = getRounds(), w = getWrong(), day = jstDate();
  T.qs.forEach(function (q, i) { var p = T.presses[i][T.me]; if (p && p.ok) delete w[q.id]; else w[q.id] = { due: rounds + 1, n: (w[q.id] ? w[q.id].n : 0) + 1, guess: false, last: day }; });
  LSset('wrong', w); LSset('rounds', rounds + 1);
  if (wrong.length) {
    n.appendChild(el('h2', '', '間違えた問題（' + wrong.length + ' 問）'));
    wrong.forEach(function (x) { var c = el('div', 'kind'); c.appendChild(elh(x.q, 'p', '', x.q.q)); c.appendChild(feedback(x.q, { ok: false, ms: x.p.ms, pt: 0, timeout: !!x.p.timeout, pick: x.p.choice })); n.appendChild(c); });
  }
  var two = el('div', 'two');
  if (T.online) {
    var o1 = el('button', 'big primary', '募集中の部屋へ'); o1.type = 'button'; o1.addEventListener('click', function () { orBack(false); });
    var o2 = el('button', 'big', '対戦を終える'); o2.type = 'button'; o2.addEventListener('click', function () { orBack(true); });
    two.appendChild(o1); two.appendChild(o2); n.appendChild(two);
  } else {
    var chat = el('div', 'chat'); PHRASES.forEach(function (p) { var b = el('button', '', p); b.type = 'button'; b.addEventListener('click', function () { say.textContent = 'あなた：' + p; }); chat.appendChild(b); });
    n.appendChild(chat); var say = el('p', 'say'); n.appendChild(say);
    var b1 = el('button', 'big primary', 'もう1戦'); b1.type = 'button'; b1.addEventListener('click', function () { var s = T.set.set, l2 = T.seats[2].sub, l3 = T.seats[3].sub; var k = { 'やさしい': 'easy', 'ふつう': 'normal', 'つよい': 'strong' }; tableStart(s, k[l2], k[l3]); });
    var b2 = el('button', 'big', '対戦を終える'); b2.type = 'button'; b2.addEventListener('click', tableLeave);
    two.appendChild(b1); two.appendChild(b2); n.appendChild(two);
  }
  var dc = discordEl(); if (dc) n.appendChild(dc);
}

/* ============================================================ 人どうしの対戦（部屋） */
// 設計：_横断/サイト_対戦/設計_人どうしの対戦.md。規則：_横断/サイト_対戦/database.rules.json（変えない）。
// 部屋は pub-1〜pub-12 だけ。部屋の一覧は読めないので、12個の meta と seats を見て並べる。
// 全員が同じ部屋のデータ（meta・seats・qAt・presses・words）を見て描く。進めるのは host だけ（qAt を書く・練習相手の答えを書く・done にする）。
// ※ rooms/<部屋> 全体には読む権限がないので、5つの道に分けて読む（席に座ってから）。
var STAR_NAMES = ['シリウス', 'ベガ', 'アルタイル', 'デネブ', 'スピカ', 'リゲル', 'カペラ', 'プロキオン', 'ポラリス', 'アンタレス', 'レグルス', 'ミラ', 'カストル', 'ポルックス', 'アルデバラン', 'ベテルギウス'];
var ROOM_IDS = []; for (var ri = 1; ri <= 12; ri++) ROOM_IDS.push('pub-' + ri);
var ROOM_GAP_MS = 4000, ROOM_START_MS = 3000, ROOM_STALL_MS = 20000, ROOM_LIST_MS = 30 * 60000, ROOM_OLD_MS = 2 * 3600000, ROOM_DONE_MS = 30000;
var ONLINE_TL_MAX = 58000;               // 規則は「出題から60秒以内」。通信のおくれを見て、1問の制限は 58 秒までにする
var OR = null, orTimer = null, LOBBY = null, lobbyTok = 0;

function myName() {
  var k = KEY + 'myname', v = null;
  try { v = sessionStorage.getItem(k); } catch (e) {}
  if (!v || v.length > 12) {
    var n = Math.floor(Math.random() * 100);
    v = STAR_NAMES[Math.floor(Math.random() * STAR_NAMES.length)] + (n < 10 ? '0' : '') + n;
    try { sessionStorage.setItem(k, v); } catch (e) {}
  }
  return v;
}
function otl(q) { return Math.min(tlimit(q), ONLINE_TL_MAX); }
function idx(v, i) { return v ? v[i] : undefined; }
function rand6() { var s = '', c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 6; i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; }
function setTitleOf(id) {
  if (/^mix-/.test(id)) return 'おまかせの10問';
  var st = SETS[id]; if (!st) return id;
  // 無機の組は「第1回」だけなので、分野と種類を前につける（例：無機化学 物質と色 第1回）。図形の組は題に分野が入っている
  var pk = st._pack, k = pk && (pk.kinds || []).filter(function (x) { return x.kind === st.kind; })[0];
  if (!k || st.title.indexOf(k.title) === 0) return st.title;
  return (PACKS.length > 1 ? pk.title + ' ' : '') + k.title + ' ' + st.title;
}
function roomItems(setId, created) {
  var items;
  if (/^mix-/.test(setId)) items = pickMix(mulberry(hash(setId)), null);
  else if (SETS[setId]) items = shuffleSeed(SETS[setId].items.slice(), setId + ':' + created);
  else return null;
  items = items.slice(0, 10);
  for (var i = 0; i < items.length; i++) if (!BYID[items[i]]) return null;
  return items.length ? items : null;
}
function netErr(e, what) {
  var c = (e && e.code) || '', m = (e && e.message) || '';
  if (/permission/i.test(c + m)) return what + 'ができませんでした。部屋が閉じられたか、すでに始まっているかもしれません。';
  return what + 'ができませんでした。通信を確かめて、もう一度お試しください。';
}
function lvOfName(nm) { var l = (nm || '').split('・')[1]; for (var k in LV) if (LV[k].label === l) return k; return 'normal'; }
function noop() {}

/* ---------------- 募集中の部屋（入口のページ） */
function lobbyStop() {
  lobbyTok++;
  if (LOBBY) { LOBBY.offs.forEach(function (f) { try { f(); } catch (e) {} }); clearInterval(LOBBY.timer); LOBBY = null; }
}
function onlineSection(n) {
  var sec = el('div', 'orsec');
  sec.appendChild(el('h3', '', 'ほかの人と対戦'));
  sec.appendChild(el('p', 'lead', 'ほかの人と、同じ10問を同時に解きます。名前は自動でつき、話せるのは決まった言葉だけです。'));
  var nm = el('p', 'orname'); nm.appendChild(document.createTextNode('あなたの名前：')); nm.appendChild(el('b', '', myName())); nm.appendChild(document.createTextNode('（自動でつきます）'));
  sec.appendChild(nm);
  sec.appendChild(el('h4', 'orh', '募集中の部屋'));
  var msg = el('p', 'ormsg', 'つないでいます…'); sec.appendChild(msg);
  var list = el('div', 'orlist'); sec.appendChild(list);
  var st = el('p', 'orstat', ''); sec.appendChild(st);
  sec.appendChild(el('h4', 'orh', '部屋を作る'));
  sec.appendChild(setField('orset'));
  var mk = el('button', 'big', '部屋を作る'); mk.type = 'button'; mk.disabled = true; mk.id = 'ormake';
  mk.addEventListener('click', function () { orCreate($('orset'), st); });
  sec.appendChild(mk);
  n.appendChild(sec);
  var tok = lobbyTok;
  Net.init().then(function () {
    if (tok !== lobbyTok) return;
    lobbyStart(msg, list, st, tok);
  }).catch(function () {
    if (tok !== lobbyTok) return;
    msg.textContent = 'オンライン対戦につなげませんでした。練習相手との対戦は、下から始められます。';
  });
}
function lobbyStart(msgEl, listEl, stEl, tok) {
  var L = LOBBY = { offs: [], data: {}, timer: null, busy: false, msgEl: msgEl, listEl: listEl, stEl: stEl };
  var mk = $('ormake'); if (mk) mk.disabled = false;
  ROOM_IDS.forEach(function (id) { L.data[id] = {}; });     // 先に全部用意する（手元の控えがあると .on はすぐ呼ばれ、まだ無い部屋を描こうとして落ちていた）
  ROOM_IDS.forEach(function (id) {
    ['meta', 'seats'].forEach(function (k) {
      var ref = Net.roomRef(id, k);
      var cb = ref.on('value', function (s) { if (LOBBY !== L) return; L.data[id][k] = s.val(); lobbyPaint(); },
        function () { if (LOBBY === L) msgEl.textContent = '部屋の一覧を読めませんでした。'; });
      L.offs.push(function () { ref.off('value', cb); });
    });
  });
  L.timer = setInterval(lobbyPaint, 15000);
  lobbyPaint();
}
function lobbyBusy(on) { if (!LOBBY) return; LOBBY.busy = on; var mk = $('ormake'); if (mk) mk.disabled = on; lobbyPaint(); }
function lobbyPaint() {
  var L = LOBBY; if (!L) return;
  var rows = [], now = Net.now(), loaded = 0;
  ROOM_IDS.forEach(function (id) {
    var d = L.data[id] || {}; if (d.meta !== undefined && d.seats !== undefined) loaded++;
    var m = d.meta;
    if (!m || m.state !== 'waiting' || m.host === Net.uid || typeof m.created !== 'number' || now - m.created > ROOM_LIST_MS) return;
    var cnt = 0; for (var i = 0; i < 4; i++) if (idx(d.seats, i)) cnt++;
    rows.push({ id: id, m: m, cnt: cnt });
  });
  rows.sort(function (a, b) { return b.m.created - a.m.created; });
  clear(L.listEl);
  L.msgEl.textContent = loaded < ROOM_IDS.length ? '募集中の部屋を探しています…' : (rows.length ? '' : 'いま募集中の部屋はありません。部屋を作ると、ここに載ります。');
  rows.forEach(function (r) {
    var row = el('div', 'orrow');
    row.appendChild(el('span', 'orset', setTitleOf(r.m.set)));
    row.appendChild(el('span', 'orcnt', r.cnt + ' / 4 人'));
    var mins = Math.floor((now - r.m.created) / 60000);
    row.appendChild(el('span', 'orago', mins < 1 ? '1分以内' : mins + ' 分前'));
    var b = el('button', '', r.cnt >= 4 ? '満席' : '参加する'); b.type = 'button'; b.disabled = r.cnt >= 4 || L.busy;
    b.addEventListener('click', function () { orJoin(r.id, L.stEl); });
    row.appendChild(b); L.listEl.appendChild(row);
  });
}
function orJoin(id, st) {
  if (!LOBBY || LOBBY.busy) return;
  lobbyBusy(true); st.textContent = '入っています…';
  var name = myName();
  var fail = function () { lobbyBusy(false); st.textContent = 'この部屋には入れませんでした。'; };
  var tryseat = function (n) {
    if (n > 3) return Promise.resolve(-1);
    return Net.roomRef(id, 'seats/' + n).transaction(function (cur) { return cur === null ? { kind: 'online', uid: Net.uid, name: name } : undefined; }, undefined, false)
      .then(function (r) { return r.committed ? n : tryseat(n + 1); });
  };
  tryseat(0).then(function (n) {
    if (n < 0) return fail();
    Net.roomRef(id, 'seats/' + n).onDisconnect().remove().catch(noop);
    orEnter(id, false, n);
  }).catch(fail);
}
function orCreate(selEl, st) {
  if (!LOBBY || LOBBY.busy) return;
  lobbyBusy(true); st.textContent = '部屋を作っています…';
  var setId = selEl.value === RANDOM_SET ? 'mix-' + rand6() : selEl.value, name = myName(), now = Net.now();
  var full = function () { lobbyBusy(false); st.textContent = 'いまは部屋がいっぱいです。少し待ってからもう一度お試しください。'; };
  var reads = ROOM_IDS.map(function (id) { return Net.roomRef(id, 'meta').once('value').then(function (s) { return s.val(); }); });
  Promise.all(reads).then(function (metas) {
    var cands = [];
    ROOM_IDS.forEach(function (id, i) {
      var m = metas[i];
      if (!m) cands.push({ id: id, stale: false });
      else if (typeof m.created === 'number' && now - m.created > ROOM_OLD_MS) cands.push({ id: id, stale: true });   // 2時間より古い部屋は、消してから使ってよい
    });
    var attempt = function (k) {
      if (k >= cands.length) return full();
      var c = cands[k], rr = Net.roomRef(c.id);
      var pre = c.stale ? rr.remove().catch(noop) : Promise.resolve();
      return pre.then(function () { return rr.onDisconnect().remove().then(function () { return true; }, function () { return false; }); })
        .then(function (reg) {
          return Net.roomRef(c.id, 'meta').set({ host: Net.uid, created: Net.ts(), set: setId, state: 'waiting', kind: 'public' })
            .then(function () { return 'ok'; }, function () { rr.onDisconnect().cancel().catch(noop); return 'next'; })
            .then(function (r) {
              if (r === 'next') return attempt(k + 1);
              return Net.roomRef(c.id, 'seats/0').set({ kind: 'online', uid: Net.uid, name: name }).then(function () {
                if (!reg) rr.onDisconnect().remove().catch(noop);
                orEnter(c.id, true, 0);
              }, function (e) { rr.remove().catch(noop); lobbyBusy(false); st.textContent = netErr(e, '部屋を作ること'); });
            });
        });
    };
    if (!cands.length) return full();
    return attempt(0);
  }).catch(function (e) { lobbyBusy(false); st.textContent = netErr(e, '部屋を作ること'); });
}

/* ---------------- 部屋に入ったあと */
function orEnter(id, host, seat) {
  lobbyStop();
  var o = OR = { id: id, host: host, seat: seat, got: {}, offs: [], timers: [], dead: false, adv: {}, wordAt: 0, state: null };
  var box = $('table'); clear(box);
  var n = el('div', 'night'); box.appendChild(n); n.appendChild(el('p', 'lead', '部屋に入っています…'));
  ['meta', 'seats', 'qAt', 'presses', 'words'].forEach(function (k) {
    var ref = Net.roomRef(id, k);
    var cb = ref.on('value', function (s) { if (OR !== o || o.dead) return; o[k] = s.val(); o.got[k] = true; orUpdate(); },
      function () { if (OR !== o || o.dead || o.leaving) return; orDenied(o); });
    o.offs.push(function () { ref.off('value', cb); });
  });
}
// 読み出しが断られたとき：部屋が消えた（host が閉じた・切れた）なら席も消えて読めなくなるので、meta を見て言い分ける
function orDenied(o) {
  if (o.denied) return; o.denied = true;
  // 拒否が meta の変化より先に届くことがある。手元の控えの古い meta を読まないよう、少し待ってからサーバーに聞き直す（meta が消えていれば、その前に orUpdate が「閉じられました」を出している）
  setTimeout(function () {
  if (OR !== o || o.dead || o.leaving || o.result) return;
  Net.roomRef(o.id, 'meta').get().then(function (s) {
    if (OR !== o || o.dead || o.leaving || o.result) return;
    var m = s.val();
    if (!m || m.created !== (o.meta && o.meta.created)) { if (o.state === 'done') return orFinish(); return orEnd('部屋が閉じられました。', true); }
    orEnd('部屋の情報を読めませんでした。');
  }, function () { if (OR === o && !o.dead && !o.result) orEnd('部屋の情報を読めませんでした。'); });
  }, 1500);
}
function orCleanup(o) {
  o.dead = true;
  clearInterval(orTimer); orTimer = null;
  o.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); o.timers = [];
  if (T && T.online && T.cpuT) T.cpuT.forEach(clearTimeout);
  o.offs.forEach(function (f) { try { f(); } catch (e) {} }); o.offs = [];
}
function orLeave() {
  var o = OR; if (!o) return;
  o.leaving = true; orCleanup(o); clearTimeout(o.doneTimer);
  if (Net.db) {
    var rr = Net.roomRef(o.id);
    if (o.host) { rr.remove().catch(noop); rr.onDisconnect().cancel().catch(noop); }
    else if (!o.gone) { var sr = Net.roomRef(o.id, 'seats/' + o.seat); sr.remove().catch(noop); sr.onDisconnect().cancel().catch(noop); }
  }
  OR = null; T = null;
}
function orBack(toSolo) { orLeave(); tableHome(); if (toSolo) showTab('solo'); }
function orEnd(msg, gone) {
  var o = OR; if (!o) return;
  orCleanup(o); if (gone) o.gone = true;
  if (T) T.closed = true;
  var box = $('table'); clear(box); window.scrollTo(0, 0);
  var n = el('div', 'night'); box.appendChild(n);
  n.appendChild(el('h2', '', msg));
  var b = el('button', 'big primary', '募集中の部屋へ'); b.type = 'button'; b.addEventListener('click', function () { orBack(false); });
  n.appendChild(b);
}
function orUpdate() {
  var o = OR; if (!o || o.dead || !o.got.meta || !o.got.seats) return;
  var m = o.meta;
  if (!m) {
    if (o.result) return;
    if (o.state === 'done') return orFinish();
    return orEnd('部屋が閉じられました。', true);
  }
  o.state = m.state;
  if (m.state === 'waiting') return orWaitUpdate();
  if (m.state === 'playing') { if (!o.playing) orPlayInit(); return; }
  if (m.state === 'done' && !o.result) orFinish();
}

/* ---------------- 待合 */
function orChatRow() {
  var chat = el('div', 'chat');
  PHRASES.forEach(function (p, i) {
    var b = el('button', '', p); b.type = 'button'; b.addEventListener('click', function () { orWord(i); });
    chat.appendChild(b);
  });
  return chat;
}
function orWord(i) {
  var o = OR; if (!o || o.dead || Net.now() - o.wordAt < 1200) return;      // 規則は、同じ席が1秒あけて次を書ける
  o.wordAt = Net.now();
  Net.roomRef(o.id, 'words/' + o.seat).set({ w: i, t: Net.ts() }).catch(noop);
}
function orWordOf(s) {
  var o = OR, w = idx(o.words, s);
  if (w && typeof w.t === 'number' && Net.now() - w.t < 5000 && PHRASES[w.w] != null) return PHRASES[w.w];
  return '';
}
function orSayText() {
  var out = [];
  for (var s = 0; s < 4; s++) { var w = orWordOf(s), st = idx(OR.seats, s); if (w && st) out.push(st.name + '：' + w); }
  return out.join('　');
}
function orWaitFrame() {
  var o = OR, box = $('table'); clear(box);
  var n = el('div', 'night'); box.appendChild(n); o.waitEl = n;
  n.appendChild(el('h2', '', '待合'));
  n.appendChild(el('p', 'lead', '組：' + setTitleOf(o.meta.set)));
  o.seatBox = el('div', 'orseats'); n.appendChild(o.seatBox);
  n.appendChild(orChatRow());
  if (o.host) {
    n.appendChild(el('p', 'lead', '人が集まらないときは、空いた席を練習相手で埋めて始められます。'));
    lvField(n, 'orlv2', '練習相手1の強さ', 'easy'); lvField(n, 'orlv3', '練習相手2の強さ', 'strong');
    n.appendChild(el('p', 'ormore', '練習相手が3人入るときは、3人目は「ふつう」です。'));
    o.goBtn = el('button', 'big primary', '始める（空いた席は練習相手）'); o.goBtn.type = 'button';
    o.goBtn.addEventListener('click', orStart); n.appendChild(o.goBtn);
  }
  var q = el('button', 'quit', o.host ? '部屋を閉じる' : '部屋を出る'); q.type = 'button'; q.addEventListener('click', function () { orBack(false); });
  n.appendChild(q);
  o.timers.push(setInterval(orWaitSeats, 500));
}
function orWaitUpdate() {
  var o = OR;
  if (!o.waitEl) orWaitFrame();
  orWaitSeats();
}
function orWaitSeats() {
  var o = OR; if (!o || o.dead || !o.seatBox || !o.meta) return;
  clear(o.seatBox);
  for (var s = 0; s < 4; s++) {
    var st = idx(o.seats, s), row = el('div', 'orseat' + (st ? '' : ' empty') + (s === o.seat ? ' me' : ''));
    row.appendChild(el('b', '', st ? st.name : '空き'));
    if (st && s === o.seat) row.appendChild(el('span', 'orbadge', 'あなた'));
    if (st && st.uid && st.uid === o.meta.host) row.appendChild(el('span', 'orbadge', '部屋を作った人'));
    var w = st ? orWordOf(s) : ''; if (w) row.appendChild(el('span', 'orsay', w));
    o.seatBox.appendChild(row);
  }
}
function orStart() {
  var o = OR; if (!o || !o.host || o.starting || o.dead) return;
  o.starting = true; o.goBtn.disabled = true; o.goBtn.textContent = '始めています…';
  var lvs = [$('orlv2').value, $('orlv3').value, 'normal'], k = 0, chain = Promise.resolve();
  [0, 1, 2, 3].forEach(function (s) {
    if (idx(o.seats, s)) return;
    var lv = lvs[Math.min(k++, 2)];
    chain = chain.then(function () { return Net.roomRef(o.id, 'seats/' + s).set({ kind: 'cpu', name: '練習相手・' + LV[lv].label }).catch(noop); });   // 同時に誰かが座った席は、断られてよい
  });
  chain.then(function () { return Net.roomRef(o.id, 'meta/state').set('playing'); })
    .then(function () { return Net.roomRef(o.id, 'meta/startAt').set(Net.ts()); })
    .catch(function (e) { orEnd(netErr(e, '対戦を始めること')); });
}

/* ---------------- 対戦 */
function orSeatInfo(s, st) {
  if (!st) return { seat: s, name: '空き', sub: '', kind: 'none', gone: true };
  var nm = st.name || '';
  if (st.kind === 'cpu') { var p = nm.split('・'); return { seat: s, name: p[0], sub: p[1] || '', kind: 'cpu' }; }
  return { seat: s, name: nm, sub: s === OR.seat ? 'あなた' : '', kind: 'online' };
}
function orPlayInit() {
  var o = OR;
  var items = roomItems(o.meta.set, o.meta.created);
  if (!items) return orEnd('この組を読みこめませんでした。');
  o.playing = true; o.timers.forEach(function (t) { clearInterval(t); }); o.timers = [];
  var seats = []; for (var s = 0; s < 4; s++) seats.push(orSeatInfo(s, idx(o.seats, s)));
  T = {
    online: true, set: { set: o.meta.set, title: setTitleOf(o.meta.set), items: items }, qs: items.map(function (id) { return BYID[id]; }),
    qi: -1, presses: [], tot: [0, 0, 0, 0], corr: [0, 0, 0, 0], firsts: [], closed: true, me: o.seat, seats: seats, opp: [], say: '',
    myChoice: {}, mine: {}, shown: {}, cpuT: [], totSig: ''
  };
  var box = $('table'); clear(box);
  var n = el('div', 'night'); box.appendChild(n);
  n.appendChild(el('h2', '', T.set.title));
  T.preEl = el('p', 'lead', 'まもなく始まります'); n.appendChild(T.preEl);
  clearInterval(orTimer); orTimer = setInterval(orTick, 50);
}
// 問い qi の、締めの時刻と点。全員が同じ式で、同じデータから出す
function orInfo(qi) {
  var q = T.qs[qi], tl = otl(q), qa = idx(OR.qAt, qi), after = q.after_ms || T_AFTER_ME, raw = [null, null, null, null], s;
  for (s = 0; s < 4; s++) {
    var pr = idx(OR.presses, qi), p = pr ? pr[s] : null;
    if (p && typeof p.t === 'number') raw[s] = { ms: p.t - qa, ok: !!p.ok, choice: s === T.me ? T.myChoice[qi] : null };
    else if (s === T.me && T.mine[qi]) raw[s] = { ms: T.mine[qi].ms, ok: T.mine[qi].ok, choice: T.myChoice[qi] };
  }
  var first = Infinity, close = tl, all = true, last = 0, cnt = 0;
  raw.forEach(function (p) { if (p && p.ms < tl && p.ok && p.ms < first) first = p.ms; });
  if (first < Infinity) close = Math.min(close, first + after);                        // 最初の正解のあと after(q) まで
  for (s = 0; s < 4; s++) {                                                            // 席が全部押した時刻（退出した席は数えない。押していれば数える）
    if (!(idx(OR.seats, s) || raw[s])) continue;
    cnt++; if (!raw[s]) all = false; else last = Math.max(last, raw[s].ms);
  }
  if (all && cnt) close = Math.min(close, Math.max(0, last));
  var valid = raw.map(function (p) { return p && p.ms <= close && p.ms < tl ? { ms: Math.max(0, p.ms), ok: p.ok, choice: p.choice } : null; });
  var r = scoreQ(valid, q);
  return { raw: raw, valid: valid, close: close, closeAt: qa + close, first: r.first, pts: r.pts };
}
function orTotals(upto) {
  var tot = [0, 0, 0, 0], corr = [0, 0, 0, 0];
  for (var q = 0; q <= upto && q < T.qs.length; q++) {
    if (typeof idx(OR.qAt, q) !== 'number') continue;
    var inf = orInfo(q); T.firsts[q] = inf.first;
    for (var s = 0; s < 4; s++) { tot[s] += inf.pts[s]; if (inf.valid[s] && inf.valid[s].ok) corr[s]++; }
  }
  T.tot = tot; T.corr = corr;
}
function orQuestion(qi) {
  var o = OR;
  T.qi = qi; T.q = T.qs[qi]; T.presses[qi] = [null, null, null, null]; T.closed = false; T.first = -1; T.shown = {}; T.totSig = ''; T.shownAt = performance.now();
  T.cpuT.forEach(clearTimeout); T.cpuT = [];
  tableShow();
  if (!o.host) return;
  for (var s = 0; s < 4; s++) (function (s) {                                          // 練習相手の答えは host が書く（種は 組・問い・席）
    var st = idx(o.seats, s); if (!st || st.kind !== 'cpu') return;
    var plan = cpuPlan(T.q, lvOfName(st.name), o.meta.set + ':' + qi + ':' + s);
    if (plan.ms >= otl(T.q)) return;
    var wait = plan.ms - Math.max(0, Net.now() - idx(o.qAt, qi));
    T.cpuT.push(setTimeout(function () {
      if (OR !== o || o.dead || !T || T.qi !== qi || T.closed) return;
      if (Net.now() >= orInfo(qi).closeAt) return;                                     // 締めを過ぎていたら書かない
      Net.roomRef(o.id, 'presses/' + qi + '/' + s).set({ t: Net.ts(), ok: plan.ok }).catch(function (e) { orEnd(netErr(e, '練習相手の答えを送ること')); });
    }, Math.max(0, wait)));
  })(s);
}
function orAdvance(n) {
  var o = OR; o.adv[n] = true;
  var p = n < T.qs.length ? Net.roomRef(o.id, 'qAt/' + n).set(Net.ts()) : Net.roomRef(o.id, 'meta/state').set('done');
  p.catch(function (e) { orEnd(netErr(e, '次の問題へ進むこと')); });
}
function orSelf(i) {
  var o = OR; if (!o || o.dead || !T || !T.online || T.closed || T.mine[T.qi]) return;
  if (performance.now() - T.shownAt < 250) return;
  var qi = T.qi, qa = idx(o.qAt, qi); if (typeof qa !== 'number') return;
  var ms = Math.max(0, Net.now() - qa); if (ms >= otl(T.q)) return;
  var ok = i === T.q.answer;
  T.mine[qi] = { ms: ms, ok: ok }; T.myChoice[qi] = i;                                   // 選んだ番号は端末だけに置く（送るのは 時刻と正誤）
  markSheet(T.sheet, i, T.q.answer, false);
  Net.roomRef(o.id, 'presses/' + qi + '/' + T.me).set({ t: Net.ts(), ok: ok }).catch(function (e) { orEnd(netErr(e, '答えを送ること')); });
  orTick();
}
function orPaint(info) {
  var qi = T.qi, arr = T.closed ? info.valid : info.raw, s;
  T.presses[qi] = arr;
  for (s = 0; s < 4; s++) {
    var p = arr[s], gone = !idx(OR.seats, s), k = (T.closed ? 'c' : 'o') + (p ? p.ms + ':' + p.ok : '-') + (gone ? 'g' : '');
    if (T.shown[s] === k) continue;
    T.shown[s] = k;
    if (p) laneUpdate(s);
    else {
      var L = T.laneEls[s], old = L.track.querySelector('.mk'); if (old) old.remove();
      L.res.textContent = gone ? '退出' : (T.closed ? '—' : '考え中');
    }
  }
  orTotals(T.closed ? qi : qi - 1);
  var g = []; for (s = 0; s < 4; s++) { T.seats[s].gone = !idx(OR.seats, s); g.push(T.seats[s].gone ? 1 : 0); }
  var sig = T.tot.join(',') + '|' + T.first + '|' + g.join(''); if (sig !== T.totSig) { T.totSig = sig; tbChips(); }
}
function orClose(qi, info) {
  T.closed = true; T.first = info.first;
  T.cpuT.forEach(clearTimeout); T.cpuT = [];
  T.shown = {}; T.totSig = '';
  T.laneEls.forEach(function (L) { L.cur.style.display = 'none'; });
  orPaint(info);
  var me = info.valid[T.me], choice = T.myChoice[qi];
  markSheet(T.sheet, choice == null ? -1 : choice, T.q.answer, true);
  T.fbHost.appendChild(feedback(T.q, { ok: !!(me && me.ok), ms: me ? me.ms : null, pt: info.pts[T.me], timeout: !me, noLink: true, pick: choice }));
}
function orTick() {
  var o = OR; if (!o || o.dead || !T || !T.online || o.result) return;
  var now = Net.now(), N = T.qs.length, cur = -1, i, m = o.meta || {};
  for (i = N - 1; i >= 0; i--) if (typeof idx(o.qAt, i) === 'number') { cur = i; break; }
  if (cur < 0) {                                                                         // 最初の問いの前
    var sa = m.startAt, ready = typeof sa === 'number';
    if (T.preEl) T.preEl.textContent = ready ? 'まもなく始まります（あと ' + Math.max(0, Math.ceil((sa + ROOM_START_MS - now) / 1000)) + ' 秒）' : 'まもなく始まります';
    if (ready && now >= sa + ROOM_START_MS) {
      if (o.host && !o.adv[0]) orAdvance(0);
      else if (!o.host && now >= sa + ROOM_START_MS + ROOM_STALL_MS) orEnd('部屋の進行が止まりました。');
    }
    return;
  }
  if (cur > T.qi) orQuestion(cur);
  var qi = T.qi, tl = otl(T.q), info = orInfo(qi), el0 = now - idx(o.qAt, qi);
  orPaint(info);
  if (!T.closed) {
    var shown = Math.max(0, Math.min(el0, tl));
    T.clockEl.textContent = fmtS(shown) + ' 秒';
    T.laneEls.forEach(function (L) { L.cur.style.left = Math.min(100, shown / tl * 100) + '%'; });
    if (now >= info.closeAt) orClose(qi, info);
  } else {
    var left = Math.max(0, Math.ceil((info.closeAt + ROOM_GAP_MS - now) / 1000));
    T.cdEl.textContent = (qi + 1 < N ? '次の問題まで ' : '結果まで ') + left + ' 秒';
    if (o.host) { if (now >= info.closeAt + ROOM_GAP_MS && !o.adv[qi + 1]) orAdvance(qi + 1); }
    else if (now >= info.closeAt + ROOM_STALL_MS) return orEnd('部屋の進行が止まりました。');
  }
  if (T.sayEl) { var sx = orSayText(); if (T.sayEl.textContent !== sx) T.sayEl.textContent = sx; }
}
function orFinish() {
  var o = OR; if (!o || o.result) return;
  if (!o.got.qAt || !o.got.presses) return;
  if (!o.playing) { orPlayInit(); if (!T || !T.online) return; }
  clearInterval(orTimer); orTimer = null;
  o.result = true;
  T.cpuT.forEach(clearTimeout);
  var N = T.qs.length, q;
  for (q = 0; q < N; q++) {
    if (typeof idx(o.qAt, q) === 'number') T.presses[q] = orInfo(q).valid; else T.presses[q] = [null, null, null, null];
  }
  orTotals(N - 1);
  tableResult();
  o.offs.forEach(function (f) { try { f(); } catch (e) {} }); o.offs = [];
  o.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); o.timers = [];
  if (o.host) {                                                                          // host は done の30秒後に部屋を消す（同じ番号の別の部屋を消さないよう、created を見る）
    var created = o.meta.created;
    o.doneTimer = setTimeout(function () {
      Net.roomRef(o.id, 'meta/created').once('value').then(function (s) { if (s.val() === created) return Net.roomRef(o.id).remove(); }).catch(noop);
    }, ROOM_DONE_MS);
  }
}

/* ============================================================ 画面の切りかえ */
function showTab(name) {
  $('tab-solo').setAttribute('aria-selected', name === 'solo'); $('tab-table').setAttribute('aria-selected', name === 'table');
  $('solo').hidden = name !== 'solo'; $('table').hidden = name !== 'table';
}
$('tab-solo').addEventListener('click', function () { showTab('solo'); });
$('tab-table').addEventListener('click', function () { showTab('table'); if (!T && !OR) tableHome(); });

/* ============================================================ はじまり */
soloHome();
if (PAGE.online && FIREBASE_CONFIG) Net.init().catch(function () {});   // 入口のページだけ。分野のページでは Firebase を読みこまない
if (QS.today === '1') {
  var avail = []; PACKS.forEach(function (p) { if (avail.indexOf(p.group) < 0) avail.push(p.group); });
  var f = QS.f || (avail.length === 1 ? avail[0] : 'mix');
  todayStart(f);
} else if (HASH && SETS[HASH]) {
  soloStart(HASH);
}
window.__hy = { todayEnd: function (f) { var av = []; PACKS.forEach(function (p) { if (av.indexOf(p.group) < 0) av.push(p.group); }); FLOW = { f: f, groups: f === 'mix' ? av : [f], rounds: [], stage: 0, hadWrong: false }; showTab('solo'); flowEnd(); }, SETS: SETS, BYID: BYID, ITEMS: ITEMS, ruidaiPicks: ruidaiPicks, pickDaily: pickDaily };   // 確かめ用
})();
