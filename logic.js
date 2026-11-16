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
  st.deck = newDeck(); st.board = []; st.result = null;
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

function nextStreet(st) {
  const ps = st.players;
  while (true) {
    ps.forEach(p => { p.bet = 0; p.acted = false; });
    st.currentBet = 0; st.minRaise = st.settings.bb;
    if (st.phase === 'river') return showdown(st);
    st.deck.pop(); // burn
    if (st.phase === 'preflop') { st.board.push(st.deck.pop(), st.deck.pop(), st.deck.pop()); st.phase = 'flop'; }
    else if (st.phase === 'flop') { st.board.push(st.deck.pop()); st.phase = 'turn'; }
    else { st.board.push(st.deck.pop()); st.phase = 'river'; }
    if (ps.filter(canAct).length > 1) {
      const d = ps.findIndex(p => p.id === st.dealerId);
      st.toAct = nextIdx(ps, d, canAct); st.turnSince = Date.now();
      return st;
    }
  }
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
  st.phase = 'showdown'; st.toAct = -1;
  st.result = { type: 'fold', pots: [{ amount: pot, winners: [w.id], refund: false }], hands: {} };
  ps.forEach(p => p.bet = 0);
  log(st, `${w.name} 팟 ${pot} 획득 (나머지 폴드)`);
  return st;
}

function showdown(st) {
  const ps = st.players, lp = ps.filter(live);
  st.phase = 'showdown'; st.toAct = -1;
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

if (typeof module !== 'undefined') module.exports = { newDeck, eval5, bestHand, cmpScore, handName, newTable, startHand, applyAction, syncSeats, clone };
