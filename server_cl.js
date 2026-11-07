'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./public/game_cl.js');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (p === '/') p = '/index_cl.html';
  const fp = path.normalize(path.join(PUB, p));
  if (!fp.startsWith(PUB + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 1000;

function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
function cleanName(n, seat) {
  const s = String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
  return s || `プレイヤー${seat + 1}`;
}
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj) { for (const s of room.seats) if (s) send(s.ws, obj); }
function roomInfo(room) {
  return {
    t: 'room',
    room: room.code,
    names: room.seats.map((s) => (s ? s.name : null)),
    online: room.seats.map((s) => !!(s && s.ws)),
    rematch: room.rematch,
  };
}

function detach(ws) {
  const ctx = ws.ctx;
  if (!ctx) return;
  ws.ctx = null;
  const seat = ctx.room.seats[ctx.seat];
  if (seat && seat.ws === ws) seat.ws = null;
  broadcast(ctx.room, roomInfo(ctx.room));
  if (ctx.room.seats.every((s) => !s || !s.ws)) ctx.room.emptySince = Date.now();
}

function attach(ws, room, seatIdx) {
  ws.ctx = { room, seat: seatIdx };
  room.emptySince = null;
  const seat = room.seats[seatIdx];
  send(ws, { t: 'joined', room: room.code, seat: seatIdx, token: seat.token });
  const starting = room.seats[0] && room.seats[1] && !room.state;
  if (starting) room.state = G.newGame(room.seats.map((s) => s.name), room.first);
  broadcast(room, roomInfo(room));
  if (starting) broadcast(room, { t: 'state', state: room.state });
  else if (room.state) send(ws, { t: 'state', state: room.state });
}

const handlers = {
  create(ws, msg) {
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', code: 'busy' });
    detach(ws);
    const room = { code: newCode(), seats: [null, null], state: null, first: 0, rematch: [false, false], emptySince: null };
    room.seats[0] = { token: crypto.randomUUID(), name: cleanName(msg.name, 0), ws };
    rooms.set(room.code, room);
    attach(ws, room, 0);
  },

  join(ws, msg) {
    const room = rooms.get(String(msg.room || '').toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'notfound' });
    let idx = room.seats.findIndex((s) => s && msg.token && s.token === msg.token);
    if (idx >= 0) {
      const old = room.seats[idx].ws;
      if (old && old !== ws) { old.ctx = null; old.close(); }
      detach(ws);
      room.seats[idx].ws = ws;
    } else {
      idx = room.seats.indexOf(null);
      if (idx < 0) return send(ws, { t: 'error', code: 'full' });
      detach(ws);
      room.seats[idx] = { token: crypto.randomUUID(), name: cleanName(msg.name, idx), ws };
    }
    attach(ws, room, idx);
  },

  shot(ws, msg) {
    const ctx = ws.ctx;
    if (!ctx || !ctx.room.state) return;
    const r = G.applyShot(ctx.room.state, ctx.seat, msg);
    if (r.error) return send(ws, { t: 'error', code: r.error });
    ctx.room.state = r.state;
    broadcast(ctx.room, { t: 'shot', seat: ctx.seat, frames: r.frames, events: r.events, newBall: r.newBall, state: r.state });
  },

  rematch(ws) {
    const ctx = ws.ctx;
    if (!ctx) return;
    const room = ctx.room;
    if (!room.state || room.state.phase !== 'over') return;
    room.rematch[ctx.seat] = true;
    if (room.rematch[0] && room.rematch[1]) {
      room.first = 1 - room.first;
      room.rematch = [false, false];
      room.state = G.newGame(room.seats.map((s) => s.name), room.first);
      broadcast(room, roomInfo(room));
      broadcast(room, { t: 'state', state: room.state });
    } else {
      broadcast(room, roomInfo(room));
    }
  },
};

wss.on('connection', (ws) => {
  ws.ctx = null;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const h = msg && handlers[msg.t];
    if (h) h(ws, msg);
  });
  ws.on('close', () => detach(ws));
});

// 切れた接続の検出と、空き部屋の掃除
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > 30 * 60 * 1000) rooms.delete(code);
  }
}, 30 * 1000);

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
