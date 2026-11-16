if (typeof crypto === 'undefined') globalThis.crypto = require('crypto').webcrypto;
// ===== Texas Hold'em pure game logic =====
const RANKS = '23456789TJQKA', SUITS = 'shdc', MAX_SEATS = 9;
const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

function randInt(n) {
  const a = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
  let x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim);
  return x % n;
}
function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = randInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function eval5(cs) {
  const v = cs.map(c => RANKS.indexOf(c[0]) + 2).sort((a, b) => b - a);
  const flush = cs.every(c => c[1] === cs[0][1]);
  let sh = 0;
  if (new Set(v).size === 5) { if (v[0] - v[4] === 4) sh = v[0]; else if (v[0] === 14 && v[1] === 5) sh = 5; }
  const cnt = {}; v.forEach(x => cnt[x] = (cnt[x] || 0) + 1);
  const g = Object.entries(cnt).map(([r, c]) => [c, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const gr = g.map(x => x[1]);
  if (sh && flush) return [8, sh];
  if (g[0][0] === 4) return [7, ...gr];
  if (g[0][0] === 3 && g[1][0] === 2) return [6, ...gr];
  if (flush) return [5, ...v];
  if (sh) return [4, sh];
  if (g[0][0] === 3) return [3, ...gr];
  if (g[0][0] === 2 && g[1][0] === 2) return [2, ...gr];
  if (g[0][0] === 2) return [1, ...gr];
  return [0, ...v];
}
function cmpScore(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }
function bestHand(cards) {
  let best = null, bc = null; const n = cards.length;
  if (n <= 5) return { score: eval5(cards), cards };
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (n === 6 && b !== a + 1) continue;
    const five = n === 7 ? cards.filter((_, i) => i !== a && i !== b) : cards.filter((_, i) => i !== a);
    const s = eval5(five);
    if (!best || cmpScore(s, best) > 0) { best = s; bc = five; }
  }
  return { score: best, cards: bc };
}
// 7장 빠른 족보 점수 (bestHand(...).score 와 같은 비교 결과)
const CARD_R = {}, CARD_S = {};
for (const r of RANKS) for (const s of SUITS) { CARD_R[r + s] = RANKS.indexOf(r) + 2; CARD_S[r + s] = SUITS.indexOf(s); }
function straightHigh(mask) {
  for (let h = 14; h >= 6; h--) { if (((mask >> (h - 4)) & 31) === 31) return h; }
  if ((mask & (1 << 14)) && (mask & 0b111100) === 0b111100) return 5;
  return 0;
}
function fastScore(cards) {
  const cnt = new Array(15).fill(0), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) { const r = CARD_R[c], s = CARD_S[c]; cnt[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r; }
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) {
    const sf = straightHigh(sm[s]); if (sf) return [8, sf];
    const fr = []; for (let r = 14; r >= 2 && fr.length < 5; r--) if (sm[s] & (1 << r)) fr.push(r);
    var flush = [5, ...fr];
  }
  let quad = 0, trips = [], pairs = [], singles = [];
  for (let r = 14; r >= 2; r--) { if (cnt[r] === 4) quad = r; else if (cnt[r] === 3) trips.push(r); else if (cnt[r] === 2) pairs.push(r); else if (cnt[r] === 1) singles.push(r); }
  if (quad) { let k = 0; for (let r = 14; r >= 2; r--) if (r !== quad && cnt[r]) { k = r; break; } return [7, quad, k]; }
  if (trips.length && (trips.length > 1 || pairs.length)) { const p = Math.max(trips[1] || 0, pairs[0] || 0); return [6, trips[0], p]; }
  if (flush) return flush;
  const st = straightHigh(mask); if (st) return [4, st];
  if (trips.length) return [3, trips[0], ...singles.slice(0, 2)];
  if (pairs.length >= 2) { const k = Math.max(pairs[2] || 0, singles[0] || 0); return [2, pairs[0], pairs[1], k]; }
  if (pairs.length) return [1, pairs[0], ...singles.slice(0, 3)];
  return [0, ...singles.slice(0, 5)];
}
function handName(s) { return s[0] === 8 && s[1] === 14 ? '로열 플러시' : HAND_NAMES[s[0]]; }

const clone = o => JSON.parse(JSON.stringify(o));
const live = p => p.inHand && !p.folded;
const canAct = p => p.inHand && !p.folded && !p.allIn;
function nextIdx(ps, from, pred) { const n = ps.length; for (let k = 1; k <= n; k++) { const i = ((from + k) % n + n) % n; if (pred(ps[i])) return i; } return -1; }
const blankHand = () => ({ inHand: false, folded: false, allIn: false, bet: 0, total: 0, acted: false, hole: [] });
function put(p, c) { c = Math.max(0, Math.min(c, p.stack)); p.stack -= c; p.bet += c; p.total += c; if (p.stack === 0) p.allIn = true; return c; }

function newTable(hostId) {
  return { host: hostId, settings: { sb: 5, bb: 10, start: 1000 }, players: [], departed: {}, phase: 'waiting',
    handNo: 0, dealerId: null, toAct: -1, currentBet: 0, minRaise: 10, deck: [], board: [], log: [], result: null, turnSince: 0 };
}

// seats: { uid: {name, left, rebuys} }
function syncSeats(st, seats) {
  st.departed = st.departed || {};
  st.players = st.players.filter(p => {
    const s = seats[p.id];
    if (!s || s.left) { st.departed[p.id] = { stack: p.stack, rebuys: p.rebuys, seen: p.seen || 0, name: p.name }; return false; }
    p.name = s.name || p.name; return true;
  });
  for (const [id, s] of Object.entries(seats)) {
    if (s.left || st.players.some(p => p.id === id) || st.players.length >= MAX_SEATS) continue;
    const d = st.departed[id];
    st.players.push({ id, name: s.name || '플레이어', stack: d ? d.stack : st.settings.start, rebuys: d ? d.rebuys : 0, seen: d ? (d.seen || 0) : (s.rebuys || 0), ...blankHand() });
    delete st.departed[id];
  }
  for (const p of st.players) {
    const r = (seats[p.id] && seats[p.id].rebuys) || 0;
    const seen = p.seen || 0;
    if (r > seen) { if (p.stack === 0) { p.stack += st.settings.start; p.rebuys = (p.rebuys || 0) + 1; } p.seen = r; }
  }
}

function needs(st) { return p => canAct(p) && (!p.acted || p.bet < st.currentBet); }
function roundComplete(st) { return st.players.filter(canAct).every(p => p.acted && p.bet === st.currentBet); }
function log(st, m) { st.log.push(m); if (st.log.length > 40) st.log.splice(0, st.log.length - 40); }

function startHand(st0, seats) {
  const st = clone(st0); syncSeats(st, seats);
  const ps = st.players;
  ps.forEach(p => Object.assign(p, blankHand(), { inHand: p.stack > 0 }));
  const elig = ps.filter(p => p.inHand);
  if (elig.length < 2) throw new Error('칩이 있는 플레이어가 2명 이상 있어야 시작할 수 있어요');
  let prev = ps.findIndex(p => p.id === st.dealerId); if (prev < 0) prev = ps.length - 1;
  const d = nextIdx(ps, prev, p => p.inHand);
  st.dealerId = ps[d].id;
  const sbI = elig.length === 2 ? d : nextIdx(ps, d, p => p.inHand);
  const bbI = nextIdx(ps, sbI, p => p.inHand);
  st.deck = newDeck(); st.board = []; st.result = null; st.runout = false; st.shown = {}; st.equity = null;
  st.handNo = (st.handNo || 0) + 1; st.log = [];
  for (let r = 0; r < 2; r++) { let i = sbI; for (let k = 0; k < elig.length; k++) { ps[i].hole.push(st.deck.pop()); i = nextIdx(ps, i, p => p.inHand); } }
  put(ps[sbI], st.settings.sb); put(ps[bbI], st.settings.bb);
  st.currentBet = st.settings.bb; st.minRaise = st.settings.bb; st.phase = 'preflop';
  log(st, `#${st.handNo} 핸드 시작 · 딜러 ${ps[d].name} · SB ${ps[sbI].name} · BB ${ps[bbI].name}`);
  if (roundComplete(st)) return nextStreet(st);
  st.toAct = nextIdx(ps, bbI, needs(st)); st.turnSince = Date.now();
  return st;
}

function applyAction(st0, uid, type, amount, force) {
  const st = clone(st0), ps = st.players, i = st.toAct, p = ps[i];
  if (!p || !['preflop', 'flop', 'turn', 'river'].includes(st.phase)) throw new Error('지금은 액션할 수 없어요');
  if (force) { if (type !== 'fold' && type !== 'check') throw new Error('강제는 폴드/체크만'); }
  else if (p.id !== uid) throw new Error('내 차례가 아니에요');
  const toCall = st.currentBet - p.bet;
  if (type === 'call' && toCall <= 0) type = 'check';
  if (type === 'allin') type = p.bet + p.stack > st.currentBet ? 'raise' : 'call', amount = p.bet + p.stack;
  if (type === 'fold') { p.folded = true; log(st, `${p.name} 폴드${force ? ' (시간 초과)' : ''}`); }
  else if (type === 'check') { if (toCall > 0) throw new Error('체크할 수 없어요'); p.acted = true; log(st, `${p.name} 체크${force ? ' (시간 초과)' : ''}`); }
  else if (type === 'call') { const c = put(p, toCall); p.acted = true; log(st, `${p.name} 콜 ${c}${p.allIn ? ' (올인)' : ''}`); }
  else if (type === 'raise') {
    const max = p.bet + p.stack; let to = Math.min(Math.floor(amount), max);
    if (to <= st.currentBet) {
      if (to !== max) throw new Error('현재 베팅보다 크게 걸어야 해요');
      const c = put(p, toCall); p.acted = true; log(st, `${p.name} 콜 ${c} (올인)`);
    } else {
      const inc = to - st.currentBet;
      if (inc < st.minRaise && to !== max) throw new Error(`최소 ${st.currentBet + st.minRaise}까지 올려야 해요`);
      const wasBet = st.currentBet === 0;
      put(p, to - p.bet);
      if (inc >= st.minRaise) st.minRaise = inc;
      st.currentBet = to;
      ps.forEach(q => { if (q !== p && canAct(q)) q.acted = false; }); p.acted = true;
      log(st, `${p.name} ${wasBet ? '벳' : '레이즈'} ${to}${p.allIn ? ' (올인)' : ''}`);
    }
  } else throw new Error('알 수 없는 액션');

  if (ps.filter(live).length === 1) return awardFold(st);
  if (roundComplete(st)) return nextStreet(st);
  st.toAct = nextIdx(ps, i, needs(st)); st.turnSince = Date.now();
  return st;
}

function dealStreet(st) {
  st.deck.pop(); // burn
  if (st.phase === 'preflop') { st.board.push(st.deck.pop(), st.deck.pop(), st.deck.pop()); st.phase = 'flop'; }
  else if (st.phase === 'flop') { st.board.push(st.deck.pop()); st.phase = 'turn'; }
  else { st.board.push(st.deck.pop()); st.phase = 'river'; }
}
function nextStreet(st) {
  const ps = st.players;
  ps.forEach(p => { p.bet = 0; p.acted = false; });
  st.currentBet = 0; st.minRaise = st.settings.bb;
  if (st.phase === 'river') return showdown(st);
  // 더 이상 베팅할 사람이 없으면(올인) 패를 공개하고 한 장씩 천천히 진행
  if (ps.filter(canAct).length <= 1) {
    st.runout = true; st.toAct = -1;
    log(st, '올인! 패를 공개합니다');
    return st;
  }
  dealStreet(st);
  const d = ps.findIndex(p => p.id === st.dealerId);
  st.toAct = nextIdx(ps, d, canAct); st.turnSince = Date.now();
  return st;
}
// 올인 런아웃 한 단계: 다음 스트리트를 깔거나 쇼다운
function runoutStep(st0) {
  const st = clone(st0);
  if (!st.runout) return st;
  if (st.phase === 'river') return showdown(st);
  dealStreet(st);
  return st;
}
// 승률(%) 계산: 남은 카드가 2장 이하면 전수, 아니면 몬테카를로
function equity(st, samples) {
  const lp = st.players.filter(live);
  const known = new Set(st.board);
  st.players.forEach(p => (p.hole || []).forEach(c => known.add(c)));
  const rest = [];
  for (const r of RANKS) for (const s of SUITS) if (!known.has(r + s)) rest.push(r + s);
  const need = 5 - st.board.length, win = {};
  lp.forEach(p => win[p.id] = 0);
  let total = 0;
  const score = extra => {
    const board = st.board.concat(extra); let best = null, ws = [];
    lp.forEach(p => { const sc = fastScore(p.hole.concat(board)); const c = best ? cmpScore(sc, best) : 1; if (c > 0) { best = sc; ws = [p.id]; } else if (c === 0) ws.push(p.id); });
    ws.forEach(id => win[id] += 1 / ws.length); total++;
  };
  if (need === 0) score([]);
  else if (need === 1) rest.forEach(c => score([c]));
  else if (need === 2) { for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) score([rest[i], rest[j]]); }
  else {
    const n = samples || 3000, a = rest.slice();
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < need; i++) { const j = i + randInt(a.length - i); [a[i], a[j]] = [a[j], a[i]]; }
      score(a.slice(0, need));
    }
  }
  const out = {}; lp.forEach(p => out[p.id] = Math.round(win[p.id] / total * 1000) / 10);
  return out;
}

function seatOrderFromDealer(st, list) {
  const ps = st.players, d = ps.findIndex(p => p.id === st.dealerId), n = ps.length;
  const pos = p => ((ps.indexOf(p) - d - 1) % n + n) % n;
  return list.slice().sort((a, b) => pos(a) - pos(b));
}

function awardFold(st) {
  const ps = st.players, w = ps.find(live);
  const pot = ps.reduce((s, p) => s + p.total, 0);
  w.stack += pot;
  st.phase = 'showdown'; st.toAct = -1; st.runout = false;
  st.result = { type: 'fold', pots: [{ amount: pot, winners: [w.id], refund: false }], hands: {} };
  ps.forEach(p => p.bet = 0);
  log(st, `${w.name} 팟 ${pot} 획득 (나머지 폴드)`);
  return st;
}

function showdown(st) {
  const ps = st.players, lp = ps.filter(live);
  st.phase = 'showdown'; st.toAct = -1; st.runout = false;
  const ev = {}; lp.forEach(p => ev[p.id] = bestHand([...p.hole, ...st.board]));
  const levels = [...new Set(lp.map(p => p.total))].sort((a, b) => a - b);
  let prev = 0; const pots = [];
  levels.forEach((L, li) => {
    const last = li === levels.length - 1;
    let amt = 0;
    ps.forEach(p => { const cap = last ? p.total : Math.min(p.total, L); amt += Math.max(0, cap - Math.min(p.total, prev)); });
    prev = L;
    if (amt <= 0) return;
    const el = lp.filter(p => p.total >= L);
    let best = null, ws = [];
    el.forEach(p => { const c = best ? cmpScore(ev[p.id].score, best) : 1; if (c > 0) { best = ev[p.id].score; ws = [p]; } else if (c === 0) ws.push(p); });
    ws = seatOrderFromDealer(st, ws);
    const share = Math.floor(amt / ws.length), rem = amt - share * ws.length;
    ws.forEach((w, k) => w.stack += share + (k === 0 ? rem : 0));
    pots.push({ amount: amt, winners: ws.map(w => w.id), refund: el.length === 1 });
  });
  const hands = {}; lp.forEach(p => hands[p.id] = { name: handName(ev[p.id].score), cards: ev[p.id].cards });
  st.result = { type: 'showdown', pots, hands };
  ps.forEach(p => p.bet = 0);
  pots.forEach((pt, k) => {
    const names = pt.winners.map(id => ps.find(p => p.id === id).name).join(', ');
    if (pt.refund) log(st, `${names} 초과 베팅 ${pt.amount} 돌려받음`);
    else log(st, `${names} ${k === 0 ? '메인 팟' : '사이드 팟'} ${pt.amount} 획득 — ${hands[pt.winners[0]].name}`);
  });
  return st;
}

if (typeof module !== 'undefined') module.exports = { newDeck, eval5, bestHand, cmpScore, handName, newTable, startHand, applyAction, syncSeats, clone, runoutStep, equity, fastScore };
