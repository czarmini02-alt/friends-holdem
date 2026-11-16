// 친구들과 홀덤 — Node + Socket.IO 서버
// 카드(덱, 다른 사람 패)는 서버만 알고, 각 플레이어에게는 자기 패만 보냅니다.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const L = require('./logic');

const PORT = process.env.PORT || 3000;
const TURN_MS = Number(process.env.TURN_MS) || 45000;          // 내 차례 제한 시간
const OFFLINE_TURN_MS = 15000;  // 연결 끊긴 사람 차례 제한 시간
const ACTIVE = ['preflop', 'flop', 'turn', 'river'];

const app = express();
app.get('/logic.js', (req, res) => res.sendFile(path.join(__dirname, 'logic.js')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map(); // code -> { game, seats, tokens, timer, touched }
function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { game: null, seats: {}, tokens: {}, timer: null, touched: Date.now() });
  return rooms.get(code);
}

function viewFor(r, pid) {
  const g = L.clone(r.game); delete g.deck; delete g.departed;
  const reveal = g.phase === 'showdown' && g.result && g.result.type === 'showdown';
  g.players.forEach(p => { if (p.id !== pid && !(reveal && g.result.hands[p.id])) p.hole = p.hole.map(() => 'x'); });
  return g;
}
function publicSeats(r) {
  const out = {};
  for (const [id, s] of Object.entries(r.seats)) out[id] = { name: s.name, left: s.left, rebuys: s.rebuys, online: s.online > 0 };
  return out;
}
async function broadcast(code) {
  const r = rooms.get(code); if (!r || !r.game) return;
  const seats = publicSeats(r);
  const sockets = await io.in(code).fetchSockets();
  for (const s of sockets) s.emit('state', { game: viewFor(r, s.data.pid), seats, you: s.data.pid, host: r.game.host, deadline: r.deadline || 0, now: Date.now() });
}

function schedule(code) {
  const r = rooms.get(code); if (!r) return;
  clearTimeout(r.timer); r.timer = null;
  const g = r.game; if (!g || !ACTIVE.includes(g.phase)) return;
  const cur = g.players[g.toAct]; if (!cur) return;
  const seat = r.seats[cur.id];
  const limit = seat && seat.left ? 1500 : (seat && seat.online > 0 ? TURN_MS : OFFLINE_TURN_MS);
  const wait = Math.max(500, limit - (Date.now() - g.turnSince));
  const hand = g.handNo, idx = g.toAct;
  r.deadline = Date.now() + wait;
  r.timer = setTimeout(() => {
    const g2 = r.game;
    if (!g2 || g2.handNo !== hand || g2.toAct !== idx || !ACTIVE.includes(g2.phase)) return;
    const p = g2.players[idx];
    try { r.game = L.applyAction(g2, null, g2.currentBet > p.bet ? 'fold' : 'check', 0, true); } catch (e) { return; }
    schedule(code); broadcast(code);
  }, wait);
}

const seatsForLogic = r => {
  const m = {}; for (const [id, s] of Object.entries(r.seats)) m[id] = { name: s.name, left: s.left, rebuys: s.rebuys }; return m;
};
const cleanName = n => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 12);
const int = (v, lo, hi) => { v = Math.floor(Number(v)); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error('숫자를 확인해주세요'); return v; };

io.on('connection', socket => {
  const handle = (ev, fn) => socket.on(ev, async (data, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    try {
      const code = socket.data.code;
      if (ev !== 'join' && !code) throw new Error('먼저 테이블에 입장해주세요');
      const res = await fn(data || {}, code ? rooms.get(code) : null, code);
      if (code || socket.data.code) { const c = socket.data.code; rooms.get(c).touched = Date.now(); schedule(c); broadcast(c); }
      cb({ ok: true, ...(res || {}) });
    } catch (e) { cb({ error: e.message || String(e) }); }
  });

  handle('join', async (d) => {
    const code = String(d.code || '').toLowerCase();
    if (!/^[a-z0-9-]{1,20}$/.test(code)) throw new Error('테이블 코드는 영문 소문자·숫자·- 만 쓸 수 있어요');
    const name = cleanName(d.name); if (!name) throw new Error('닉네임을 입력해주세요');
    const token = String(d.token || ''); if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new Error('잘못된 접속 정보예요. 새로고침 해주세요');
    if (socket.data.code && socket.data.code !== code) leaveSocket(socket);
    const r = getRoom(code);
    let pid = r.tokens[token];
    if (!pid) { pid = crypto.randomBytes(6).toString('hex'); r.tokens[token] = pid; }
    const already = socket.data.code === code;
    const s = r.seats[pid] || { rebuys: 0, online: 0 };
    s.name = name; s.left = false; if (!already) s.online = (s.online || 0) + 1;
    r.seats[pid] = s;
    if (!r.game) r.game = L.newTable(pid);
    socket.data.code = code; socket.data.pid = pid;
    socket.join(code);
  });

  handle('start', async (d, r) => {
    if (ACTIVE.includes(r.game.phase)) throw new Error('이미 핸드가 진행 중이에요');
    if (!r.seats[socket.data.pid] || r.seats[socket.data.pid].left) throw new Error('자리에 앉아야 시작할 수 있어요');
    r.game = L.startHand(r.game, seatsForLogic(r));
  });

  handle('action', async (d, r) => {
    const type = String(d.type || '');
    if (!['fold', 'check', 'call', 'raise', 'allin'].includes(type)) throw new Error('알 수 없는 액션');
    if (d.hand !== r.game.handNo || d.toAct !== r.game.toAct) throw new Error('상태가 바뀌었어요. 화면을 확인하고 다시 눌러주세요');
    r.game = L.applyAction(r.game, socket.data.pid, type, Number(d.amount) || 0, false);
  });

  handle('rebuy', async (d, r) => {
    const pid = socket.data.pid, s = r.seats[pid], p = r.game.players.find(x => x.id === pid);
    if (!p || p.stack > 0) throw new Error('칩을 다 잃었을 때만 리바이할 수 있어요');
    if ((s.rebuys || 0) > (p.seen || 0)) throw new Error('이미 리바이를 신청했어요');
    s.rebuys = (s.rebuys || 0) + 1;
  });

  handle('sit', async (d, r) => { r.seats[socket.data.pid].left = false; });

  handle('leave', async (d, r) => {
    const pid = socket.data.pid; r.seats[pid].left = true;
    const g = r.game;
    if (ACTIVE.includes(g.phase) && g.players[g.toAct] && g.players[g.toAct].id === pid) r.game = L.applyAction(g, pid, 'fold', 0, false);
  });

  handle('settings', async (d, r) => {
    if (r.game.host !== socket.data.pid) throw new Error('방장만 설정을 바꿀 수 있어요');
    if (ACTIVE.includes(r.game.phase)) throw new Error('핸드 사이에만 바꿀 수 있어요');
    const sb = int(d.sb, 1, 1e7), bb = int(d.bb, sb, 1e8), start = int(d.start, bb * 10, 1e10);
    r.game.settings = { sb, bb, start };
    r.game.log.push(`설정 변경: 블라인드 ${sb}/${bb}, 시작 칩 ${start}`);
  });

  handle('reset', async (d, r) => {
    if (r.game.host !== socket.data.pid) throw new Error('방장만 초기화할 수 있어요');
    const t = L.newTable(r.game.host); t.settings = r.game.settings; t.log = ['테이블이 초기화됐어요 — 모든 칩이 리셋돼요'];
    for (const s of Object.values(r.seats)) s.rebuys = 0;
    r.game = t;
  });

  socket.on('disconnect', () => leaveSocket(socket));
});

function leaveSocket(socket) {
  const code = socket.data.code; if (!code) return;
  const r = rooms.get(code); socket.leave(code); socket.data.code = null;
  if (!r) return;
  const s = r.seats[socket.data.pid]; if (s) s.online = Math.max(0, (s.online || 0) - 1);
  // 방장이 완전히 나가면 접속 중인 다른 사람에게 넘김
  if (r.game && r.game.host === socket.data.pid && !(s && s.online > 0)) {
    const next = Object.entries(r.seats).find(([id, x]) => x.online > 0 && !x.left);
    if (next) r.game.host = next[0];
  }
  r.touched = Date.now();
  schedule(code); broadcast(code);
}

// 3시간 동안 아무도 없는 테이블은 정리
setInterval(() => {
  for (const [code, r] of rooms) {
    const online = Object.values(r.seats).some(s => s.online > 0);
    if (!online && Date.now() - r.touched > 3 * 3600 * 1000) { clearTimeout(r.timer); rooms.delete(code); }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`홀덤 서버 실행 중: http://localhost:${PORT}`));
