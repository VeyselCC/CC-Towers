/*
 * Space Towers – Mehrspieler-Server ohne externe Abhängigkeiten.
 * Liefert die Dateien aus /public aus und betreibt Spielräume über WebSockets.
 * Start: node server.js   (Port über die Umgebungsvariable PORT, Standard 3000)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Game = require('./public/game.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 8;
const MAX_NAME = 16;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const RECONNECT_GRACE_MS = 30 * 1000; // so lange darf man während einer Runde offline sein

// ---------------------------------------------------------------------------
// Statische Dateien
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Minimale WebSocket-Implementierung (RFC 6455, Textnachrichten)
// ---------------------------------------------------------------------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.open = true;
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    sock.setNoDelay(true);
    sock.on('data', (d) => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }

  _data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > 1 << 20) return this.close(1009);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > 1 << 16) return this.close(1009);
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      let payload = this.buf.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(off + maskLen + len);
      this.alive = true;

      if (opcode === 0x8) return this.close(1000);
      if (opcode === 0x9) { this._frame(0xa, payload); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          if (this.onmessage) this.onmessage(text);
        }
      }
    }
  }

  _frame(opcode, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.sock.write(Buffer.concat([header, payload]));
    } catch (e) {
      this._closed();
    }
  }

  send(obj) {
    this._frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  ping() {
    this._frame(0x9, Buffer.alloc(0));
  }

  close(code) {
    if (this.open) {
      const p = Buffer.alloc(2);
      p.writeUInt16BE(code || 1000, 0);
      this._frame(0x8, p);
    }
    try { this.sock.end(); } catch (e) { /* ignore */ }
    this._closed();
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    try { this.sock.destroy(); } catch (e) { /* ignore */ }
    if (this.onclose) this.onclose();
  }
}

// ---------------------------------------------------------------------------
// Räume und Spieler
// ---------------------------------------------------------------------------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME);
  return n || 'Pilot';
}

function uniqueName(room, name, exceptId) {
  const taken = new Set([...room.players.values()].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const candidate = name.slice(0, MAX_NAME - 2) + ' ' + i;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function createRoom() {
  const room = {
    code: makeCode(),
    hostId: null,
    players: new Map(),
    phase: 'lobby', // lobby | playing | results | final
    round: 0,
    settings: { rounds: 3, timeLimit: 180, wrap: true },
    seed: 0,
    endsAt: 0,
    timer: null,
    lastResults: [],
    broadcastPending: false,
    lastActive: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}

function newPlayer(room, name, ws) {
  const id = crypto.randomBytes(6).toString('hex');
  const p = {
    id,
    token: crypto.randomBytes(16).toString('hex'),
    name: uniqueName(room, cleanName(name)),
    ws,
    connected: true,
    joinedAt: Date.now(),
    game: null,
    moves: [],
    status: 'lobby', // lobby | waiting | playing | done
    finishedAt: 0,
    gaveUp: false,
    total: 0,
    roundScores: []
  };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  if (room.phase === 'playing') p.status = 'waiting';
  return p;
}

function publicPlayer(room, p) {
  const g = p.game;
  return {
    id: p.id,
    name: p.name,
    host: p.id === room.hostId,
    connected: p.connected,
    status: p.status,
    gaveUp: p.gaveUp,
    score: g ? g.score : 0,
    remaining: g ? Game.remaining(g) : 28,
    stock: g ? g.stock.length : 23,
    streak: g ? g.streak : 0,
    bestStreak: g ? g.bestStreak : 0,
    result: g ? g.status : null,
    total: p.total,
    roundScores: p.roundScores
  };
}

function roomState(room) {
  return {
    t: 'room',
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    endsAt: room.endsAt,
    now: Date.now(),
    players: [...room.players.values()].map((p) => publicPlayer(room, p)),
    lastResults: room.lastResults
  };
}

function broadcast(room, msg) {
  for (const p of room.players.values()) if (p.connected && p.ws) p.ws.send(msg);
}

// Raumzustand gebündelt verschicken (max. ~12x pro Sekunde)
function scheduleBroadcast(room) {
  if (room.broadcastPending) return;
  room.broadcastPending = true;
  setTimeout(() => {
    room.broadcastPending = false;
    if (rooms.has(room.code)) broadcast(room, roomState(room));
  }, 80);
}

function sendError(ws, msg) {
  ws.send({ t: 'error', msg });
}

function ensureHost(room) {
  const host = room.players.get(room.hostId);
  if (host && host.connected) return;
  const next = [...room.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (next) room.hostId = next.id;
}

function startRound(room) {
  clearTimeout(room.timer);
  room.round += 1;
  room.phase = 'playing';
  room.seed = Game.randomSeed();
  room.lastResults = [];
  const limit = room.settings.timeLimit;
  room.endsAt = limit > 0 ? Date.now() + limit * 1000 + 1500 : 0;
  for (const p of room.players.values()) {
    p.game = Game.newGame(room.seed, { wrap: room.settings.wrap });
    p.moves = [];
    p.finishedAt = 0;
    p.gaveUp = false;
    p.status = 'playing';
  }
  room.timer = null;
  if (limit > 0) {
    room.timer = setTimeout(() => endRound(room), room.endsAt - Date.now());
    if (room.timer.unref) room.timer.unref();
  }
  for (const p of room.players.values()) {
    if (p.connected) p.ws.send(startMessage(room, p));
  }
  scheduleBroadcast(room);
}

function startMessage(room, p) {
  return {
    t: 'start',
    seed: room.seed,
    round: room.round,
    rounds: room.settings.rounds,
    wrap: room.settings.wrap,
    endsAt: room.endsAt,
    now: Date.now(),
    moves: p.moves,
    done: p.status === 'done'
  };
}

function rankPlayers(list) {
  return list.sort((a, b) =>
    b.score - a.score ||
    a.remaining - b.remaining ||
    (a.finishedAt || Infinity) - (b.finishedAt || Infinity)
  );
}

function endRound(room) {
  if (room.phase !== 'playing') return;
  clearTimeout(room.timer);
  const participants = [...room.players.values()].filter((p) => p.game && p.status !== 'waiting');
  const ranked = rankPlayers(participants.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.game.score,
    remaining: Game.remaining(p.game),
    bestStreak: p.game.bestStreak,
    result: p.game.status,
    gaveUp: p.gaveUp,
    finishedAt: p.finishedAt
  })));
  ranked.forEach((r, i) => {
    r.rank = i + 1;
    const p = room.players.get(r.id);
    p.total += r.score;
    p.roundScores.push(r.score);
    r.total = p.total;
  });
  for (const p of room.players.values()) p.status = 'done';
  room.lastResults = ranked;
  room.phase = room.round >= room.settings.rounds ? 'final' : 'results';
  room.endsAt = 0;
  broadcast(room, roomState(room));
}

function checkRoundEnd(room) {
  if (room.phase !== 'playing') return;
  // Kurz getrennte Spieler zählen weiter mit (Schonfrist zum Wiederverbinden)
  const active = [...room.players.values()].filter((p) => p.status === 'playing');
  if (active.length === 0) endRound(room);
}

function finishPlayer(room, p) {
  if (p.status !== 'playing') return;
  p.status = 'done';
  p.finishedAt = Date.now();
  checkRoundEnd(room);
}

function resetToLobby(room) {
  clearTimeout(room.timer);
  room.phase = 'lobby';
  room.round = 0;
  room.endsAt = 0;
  room.lastResults = [];
  for (const p of room.players.values()) {
    p.game = null;
    p.moves = [];
    p.total = 0;
    p.roundScores = [];
    p.status = 'lobby';
    p.gaveUp = false;
  }
}

function leave(room, p) {
  room.players.delete(p.id);
  if (room.players.size === 0) {
    clearTimeout(room.timer);
    rooms.delete(room.code);
    return;
  }
  ensureHost(room);
  checkRoundEnd(room);
  scheduleBroadcast(room);
}

// ---------------------------------------------------------------------------
// Nachrichten der Clients
// ---------------------------------------------------------------------------
function handleConnection(ws) {
  let room = null;
  let me = null;

  function bind(r, p) {
    room = r;
    me = p;
    p.ws = ws;
    p.connected = true;
    clearTimeout(p.graceTimer);
    r.lastActive = Date.now();
    ensureHost(r);
    ws.send({ t: 'welcome', id: p.id, token: p.token, code: r.code, name: p.name });
    if (r.phase === 'playing' && p.status !== 'waiting' && p.game) ws.send(startMessage(r, p));
    broadcast(r, roomState(r));
  }

  ws.onmessage = (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (room) room.lastActive = Date.now();

    switch (msg.t) {
      case 'create': {
        if (room) return;
        const r = createRoom();
        bind(r, newPlayer(r, msg.name, ws));
        break;
      }
      case 'join': {
        if (room) return;
        const code = String(msg.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) return sendError(ws, 'Raum ' + (code || '?') + ' wurde nicht gefunden.');
        if (msg.token) {
          const existing = [...r.players.values()].find((p) => p.token === msg.token);
          if (existing) {
            if (existing.ws && existing.ws !== ws && existing.connected) existing.ws.close(4000);
            return bind(r, existing);
          }
        }
        if (r.players.size >= MAX_PLAYERS) return sendError(ws, 'Der Raum ist voll (max. ' + MAX_PLAYERS + ' Spieler).');
        bind(r, newPlayer(r, msg.name, ws));
        break;
      }
      case 'rename': {
        if (!room) return;
        me.name = uniqueName(room, cleanName(msg.name), me.id);
        scheduleBroadcast(room);
        break;
      }
      case 'settings': {
        if (!room || me.id !== room.hostId || room.phase !== 'lobby') return;
        const s = msg.settings || {};
        const rounds = parseInt(s.rounds, 10);
        const time = parseInt(s.timeLimit, 10);
        if (rounds >= 1 && rounds <= 10) room.settings.rounds = rounds;
        if ([0, 60, 120, 180, 300, 600].includes(time)) room.settings.timeLimit = time;
        if (typeof s.wrap === 'boolean') room.settings.wrap = s.wrap;
        scheduleBroadcast(room);
        break;
      }
      case 'start': {
        if (!room || me.id !== room.hostId) return;
        if (room.phase === 'lobby' || room.phase === 'results') startRound(room);
        break;
      }
      case 'lobby': {
        if (!room || me.id !== room.hostId) return;
        if (room.phase === 'final' || room.phase === 'results') {
          resetToLobby(room);
          broadcast(room, roomState(room));
        }
        break;
      }
      case 'move': {
        if (!room || room.phase !== 'playing' || me.status !== 'playing' || !me.game) return;
        const m = msg.m || {};
        const move = m.type === 'draw' ? { type: 'draw' } : { type: 'play', id: parseInt(m.id, 10) };
        const ev = Game.applyMove(me.game, move);
        if (!ev) {
          // Client ist nicht synchron – kompletten Zustand neu schicken
          ws.send({ t: 'resync', seed: room.seed, wrap: room.settings.wrap, moves: me.moves });
          return;
        }
        me.moves.push(move);
        if (me.game.status !== 'playing') finishPlayer(room, me);
        scheduleBroadcast(room);
        break;
      }
      case 'giveup': {
        if (!room || room.phase !== 'playing' || me.status !== 'playing') return;
        me.gaveUp = true;
        finishPlayer(room, me);
        scheduleBroadcast(room);
        break;
      }
      case 'emote': {
        if (!room) return;
        const e = String(msg.e || '').slice(0, 4);
        if (!['👍', '🔥', '😂', '😮', '🚀', '😭'].includes(e)) return;
        const now = Date.now();
        if (me.lastEmote && now - me.lastEmote < 800) return;
        me.lastEmote = now;
        broadcast(room, { t: 'emote', id: me.id, name: me.name, e });
        break;
      }
      case 'leave': {
        if (!room) return;
        const r = room;
        const p = me;
        room = null;
        me = null;
        leave(r, p);
        ws.send({ t: 'left' });
        break;
      }
      case 'ping':
        ws.send({ t: 'pong', now: Date.now() });
        break;
      default:
        break;
    }
  };

  ws.onclose = () => {
    if (!room || !me) return;
    if (me.ws !== ws) return; // bereits auf neue Verbindung umgezogen
    const r = room;
    const p = me;
    p.connected = false;
    p.ws = null;
    ensureHost(r);
    clearTimeout(p.graceTimer);
    p.graceTimer = setTimeout(() => {
      if (!p.connected && r.phase === 'playing' && p.status === 'playing') {
        finishPlayer(r, p);
        scheduleBroadcast(r);
      }
    }, RECONNECT_GRACE_MS);
    if (p.graceTimer.unref) p.graceTimer.unref();
    scheduleBroadcast(r);
  };
}

// ---------------------------------------------------------------------------
// HTTP-Server + Upgrade
// ---------------------------------------------------------------------------
const server = http.createServer(serveStatic);
const sockets = new Set();

server.on('upgrade', (req, sock) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { /* ignore */ }
  const key = req.headers['sec-websocket-key'];
  if (pathname !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const ws = new Socket(sock);
  sockets.add(ws);
  const origClose = () => sockets.delete(ws);
  handleConnection(ws);
  const userClose = ws.onclose;
  ws.onclose = () => { origClose(); if (userClose) userClose(); };
});

// Herzschlag: tote Verbindungen erkennen
setInterval(() => {
  for (const ws of sockets) {
    if (!ws.alive) { ws.close(1001); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 25000).unref();

// Verwaiste Räume aufräumen
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyone = [...room.players.values()].some((p) => p.connected);
    if (!anyone && now - room.lastActive > ROOM_IDLE_MS) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
    }
  }
}, 60000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('Space Towers läuft auf http://localhost:' + PORT);
  });
}

module.exports = { server, rooms, endRound, sockets };
