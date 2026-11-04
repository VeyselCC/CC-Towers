/*
 * Space Towers – Mehrspieler ohne eigenen Server, wenn die Seite als
 * claude.ai-Artifact läuft. Nutzt die "room"-Fähigkeit (Presence) und
 * bildet dieselben Nachrichten nach, die sonst server.js über WebSockets
 * schickt. Der Browser des Hosts übernimmt die Rolle des Servers; jeder
 * Browser spielt die Züge aller Spieler ab dem gemeinsamen Seed nach und
 * prüft sie so selbst.
 *
 * Stellt window.STRoom = { create() } bereit – ein WebSocket-ähnliches
 * Objekt (readyState, send, close, onopen, onmessage, onclose).
 * Läuft die Seite nicht als Artifact, passiert nichts.
 */
(function () {
  'use strict';
  if (!window.claude || typeof window.claude.use !== 'function') return;

  var G = window.SpaceTowers;
  var ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var MAX_PLAYERS = 8;
  var GRACE_MS = 30000;
  var HOST_TAKEOVER_MS = 4000;

  var roomPromise = null;
  function getRoom() {
    if (!roomPromise) {
      roomPromise = Promise.resolve()
        .then(function () { return window.claude.use('room'); })
        .catch(function () { return null; });
    }
    return roomPromise;
  }

  function rand(n, chars) {
    var s = '';
    for (var i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function encMove(m) { return m.type === 'draw' ? '.' : ALPH[m.id]; }
  function decMoves(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (c === '.') out.push({ type: 'draw' });
      else if (ALPH.indexOf(c) !== -1) out.push({ type: 'play', id: ALPH.indexOf(c) });
    }
    return out;
  }
  // Züge ab dem Seed nachspielen; beim ersten ungültigen Zug abbrechen.
  function replay(seed, wrap, mv) {
    var g = G.newGame(seed, { wrap: wrap });
    var moves = decMoves(typeof mv === 'string' ? mv.slice(0, 80) : '');
    for (var i = 0; i < moves.length; i++) if (!G.applyMove(g, moves[i])) break;
    g.history = [];
    return g;
  }
  function cleanName(n) {
    n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
    return n || 'Pilot';
  }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(sessionStorage.getItem(key));
      sessionStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  function create() {
    var sock = { readyState: 0, onopen: null, onmessage: null, onclose: null };
    var S = {
      lobby: null,
      named: null,
      code: null,
      me: null, // {id, name}
      isHost: false,
      host: null, // aktueller Host-Zustand
      lastHost: null,
      hostMissingSince: 0,
      offset: 0,
      rd: 0,
      mv: '',
      gu: false,
      em: null,
      game: null,
      startKey: null,
      cache: {}, // id -> {p: presence, seen: ms}
      emoteSeen: {},
      lastRoomJson: '',
      unsubs: [],
      timer: null,
      welcomed: false,
      closed: false
    };

    function deliver(msg) {
      if (S.closed || !sock.onmessage) return;
      try { sock.onmessage({ data: JSON.stringify(msg) }); } catch (e) { /* App-Fehler nicht hochreichen */ }
    }

    getRoom().then(function (room) {
      if (S.closed) return;
      if (!room) {
        sock.readyState = 3;
        if (sock.onclose) sock.onclose({ code: 4001 });
        return;
      }
      S.lobby = room;
      sock.readyState = 1;
      if (sock.onopen) sock.onopen();
    });

    sock.send = function (text) {
      var msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      handle(msg);
    };
    sock.close = function () {
      if (S.closed) return;
      S.closed = true;
      sock.readyState = 3;
      cleanup();
    };

    function cleanup() {
      clearInterval(S.timer);
      S.unsubs.forEach(function (u) { try { u(); } catch (e) { /* ignore */ } });
      S.unsubs = [];
      if (S.named) S.named.leave().catch(function () {});
      S.named = null;
    }

    function myPresence() {
      return { id: S.me.id, name: S.me.name, rd: S.rd, mv: S.mv, gu: S.gu, em: S.em, h: S.isHost ? S.host : null };
    }
    function push() {
      if (!S.named) return;
      if (S.isHost && S.host) S.host.ts = Date.now();
      S.named.presence(myPresence()).catch(function () {});
    }
    function saveMine() {
      store('st-mv-' + S.code + '-' + S.me.id, { rd: S.rd, mv: S.mv, gu: S.gu, seed: S.host ? S.host.seed : 0 });
    }

    function enter(code, id, name) {
      S.code = code;
      S.me = { id: id, name: cleanName(name) };
      return S.lobby.join('st-' + code.toLowerCase()).then(function (named) {
        if (S.closed) { named.leave(); return null; }
        S.named = named;
        S.unsubs.push(named.onPeers(function () { recompute(); }, function () {}));
        S.timer = setInterval(recompute, 1000);
        return named;
      });
    }

    // ---------------- Nachrichten der App ----------------
    function handle(msg) {
      switch (msg.t) {
        case 'create': {
          if (S.named) return;
          var code = rand(4, CODE_CHARS);
          var id = rand(12, 'abcdefghijklmnopqrstuvwxyz0123456789');
          enter(code, id, msg.name).then(function (named) {
            if (!named) return;
            S.isHost = true;
            S.host = {
              hostId: id, phase: 'lobby', round: 0,
              settings: { rounds: 3, timeLimit: 180, wrap: true },
              seed: 0, endsAt: 0, parts: [], results: [], totals: {}, rs: {}, ts: Date.now()
            };
            push();
            S.welcomed = true;
            deliver({ t: 'welcome', id: id, token: id, code: code, name: S.me.name });
            recompute();
          }).catch(function () {
            deliver({ t: 'error', msg: 'Der Raum konnte nicht erstellt werden. Bitte versuch es noch einmal.' });
          });
          break;
        }
        case 'join': {
          if (S.named) return;
          var jc = String(msg.code || '').toUpperCase().trim();
          if (!/^[A-Z0-9]{4}$/.test(jc)) return deliver({ t: 'error', msg: 'Raum ' + (jc || '?') + ' wurde nicht gefunden.' });
          var jid = msg.token || rand(12, 'abcdefghijklmnopqrstuvwxyz0123456789');
          enter(jc, jid, msg.name).then(function (named) {
            if (!named) return;
            var saved = store('st-mv-' + jc + '-' + jid);
            if (saved) { S.rd = saved.rd || 0; S.mv = saved.mv || ''; S.gu = !!saved.gu; }
            push();
            waitForHost(Date.now());
          }).catch(function () {
            deliver({ t: 'error', msg: 'Beitreten hat nicht geklappt. Bitte versuch es noch einmal.' });
          });
          break;
        }
        case 'settings': {
          if (!S.isHost || S.host.phase !== 'lobby') return;
          var s = msg.settings || {};
          var r = parseInt(s.rounds, 10);
          var tl = parseInt(s.timeLimit, 10);
          if (r >= 1 && r <= 10) S.host.settings.rounds = r;
          if ([0, 60, 120, 180, 300, 600].indexOf(tl) !== -1) S.host.settings.timeLimit = tl;
          if (typeof s.wrap === 'boolean') S.host.settings.wrap = s.wrap;
          push();
          recompute();
          break;
        }
        case 'start': {
          if (!S.isHost) return;
          if (S.host.phase === 'lobby' || S.host.phase === 'results') startRound();
          break;
        }
        case 'lobby': {
          if (!S.isHost) return;
          if (S.host.phase === 'final' || S.host.phase === 'results') {
            S.host.phase = 'lobby';
            S.host.round = 0;
            S.host.endsAt = 0;
            S.host.results = [];
            S.host.totals = {};
            S.host.rs = {};
            S.host.parts = [];
            push();
            recompute();
          }
          break;
        }
        case 'move': {
          var h = S.host;
          if (!h || h.phase !== 'playing' || h.parts.indexOf(S.me.id) === -1 || S.gu || !S.game) return;
          var m = msg.m || {};
          var move = m.type === 'draw' ? { type: 'draw' } : { type: 'play', id: parseInt(m.id, 10) };
          if (!G.applyMove(S.game, move)) {
            deliver({ t: 'resync', seed: h.seed, wrap: h.settings.wrap, moves: decMoves(S.mv) });
            return;
          }
          S.mv += encMove(move);
          S.rd = h.round;
          saveMine();
          push();
          recompute();
          break;
        }
        case 'giveup': {
          if (!S.host || S.host.phase !== 'playing') return;
          S.gu = true;
          saveMine();
          push();
          recompute();
          break;
        }
        case 'emote': {
          var allowed = ['👍', '🔥', '😂', '😮', '🚀', '😭'];
          if (allowed.indexOf(msg.e) === -1) return;
          S.em = { e: msg.e, t: Date.now() };
          push();
          break;
        }
        case 'leave': {
          cleanup();
          deliver({ t: 'left' });
          break;
        }
        default:
          break;
      }
    }

    function waitForHost(since) {
      if (S.closed || !S.named) return;
      if (S.host) {
        var known = S.host.parts && S.host.parts.indexOf(S.me.id) !== -1;
        if (players().length > MAX_PLAYERS && !known) {
          deliver({ t: 'error', msg: 'Der Raum ist voll (max. ' + MAX_PLAYERS + ' Spieler).' });
          cleanup();
          return;
        }
        S.welcomed = true;
        deliver({ t: 'welcome', id: S.me.id, token: S.me.id, code: S.code, name: S.me.name });
        S.lastRoomJson = '';
        recompute();
        return;
      }
      if (Date.now() - since > 6000) {
        deliver({ t: 'error', msg: 'Raum ' + S.code + ' wurde nicht gefunden. Ist der Host noch auf der Seite?' });
        cleanup();
        return;
      }
      setTimeout(function () { waitForHost(since); }, 250);
    }

    // ---------------- Zustand aus der Presence ableiten ----------------
    function players() {
      if (!S.named) return [];
      var byId = {};
      S.named.peers().forEach(function (peer) {
        var p = peer.presence || {};
        if (typeof p.id !== 'string' || !p.id) return;
        var prev = byId[p.id];
        if (!prev || peer.updatedAt > prev.updatedAt) byId[p.id] = { p: p, updatedAt: peer.updatedAt, isMe: peer.sameTab };
      });
      // eigene Presence immer aktuell einsetzen
      if (S.me) byId[S.me.id] = { p: myPresence(), updatedAt: Date.now(), isMe: true };
      var now = Date.now();
      Object.keys(byId).forEach(function (id) { S.cache[id] = { p: byId[id].p, seen: now, updatedAt: byId[id].updatedAt }; });
      return Object.keys(byId).map(function (id) { return byId[id]; });
    }

    function pickHost(list) {
      var best = null;
      list.forEach(function (e) {
        var h = e.p.h;
        if (!h || typeof h !== 'object' || h.hostId !== e.p.id) return;
        if (!best || e.p.id < best.p.id) best = e;
      });
      return best;
    }

    function stateOf(id, h) {
      var c = S.cache[id];
      var p = c ? c.p : null;
      var inRound = p && p.rd === h.round && h.round > 0;
      var g = inRound ? replay(h.seed, h.settings.wrap, p.mv) : G.newGame(h.seed || 1, { wrap: h.settings.wrap });
      return { p: p, g: g, gu: !!(inRound && p.gu), present: c && Date.now() - c.seen < 2500, seen: c ? c.seen : 0 };
    }

    function startRound() {
      var h = S.host;
      var list = players();
      h.round += 1;
      h.phase = 'playing';
      h.seed = G.randomSeed();
      h.results = [];
      h.parts = list.map(function (e) { return e.p.id; }).slice(0, MAX_PLAYERS);
      h.endsAt = h.settings.timeLimit > 0 ? Date.now() + h.settings.timeLimit * 1000 + 1500 : 0;
      push();
      recompute();
    }

    function endRound() {
      var h = S.host;
      if (h.phase !== 'playing') return;
      var rows = h.parts.map(function (id) {
        var st = stateOf(id, h);
        return {
          id: id,
          name: st.p ? cleanName(st.p.name) : 'Pilot',
          score: st.g.score,
          remaining: G.remaining(st.g),
          bestStreak: st.g.bestStreak,
          result: st.g.status,
          gaveUp: st.gu
        };
      });
      rows.sort(function (a, b) { return b.score - a.score || a.remaining - b.remaining; });
      rows.forEach(function (r, i) {
        r.rank = i + 1;
        h.totals[r.id] = (h.totals[r.id] || 0) + r.score;
        h.rs[r.id] = (h.rs[r.id] || []).concat([r.score]);
        r.total = h.totals[r.id];
      });
      h.results = rows;
      h.phase = h.round >= h.settings.rounds ? 'final' : 'results';
      h.endsAt = 0;
      push();
    }

    function hostTick() {
      var h = S.host;
      if (h.phase !== 'playing') return;
      if (h.endsAt && Date.now() >= h.endsAt) return endRound();
      var now = Date.now();
      var allDone = h.parts.every(function (id) {
        var st = stateOf(id, h);
        if (st.gu || st.g.status !== 'playing') return true;
        return !st.present && now - st.seen > GRACE_MS;
      });
      if (allDone) endRound();
    }

    function recompute() {
      if (S.closed || !S.named || !S.me) return;
      var list = players();
      var hostEntry = pickHost(list);

      if (hostEntry && hostEntry.p.id !== S.me.id) {
        // Ein anderer Spieler ist Host
        if (S.isHost && hostEntry.p.id < S.me.id) { S.isHost = false; push(); }
        if (!S.isHost) {
          S.host = hostEntry.p.h;
          S.offset = (S.host.ts || Date.now()) - hostEntry.updatedAt;
          S.lastHost = S.host;
          S.hostMissingSince = 0;
        }
      } else if (!hostEntry && !S.isHost && S.lastHost) {
        // Host ist weg: der Spieler mit der kleinsten ID übernimmt
        if (!S.hostMissingSince) S.hostMissingSince = Date.now();
        var ids = list.map(function (e) { return e.p.id; }).sort();
        if (Date.now() - S.hostMissingSince > HOST_TAKEOVER_MS && ids[0] === S.me.id) {
          S.isHost = true;
          S.host = JSON.parse(JSON.stringify(S.lastHost));
          if (S.host.endsAt) S.host.endsAt -= S.offset; // in eigene Uhr umrechnen
          S.host.hostId = S.me.id;
          S.offset = 0;
          push();
        }
      }

      var h = S.host;
      if (!h || !S.welcomed) return;
      if (S.isHost) { S.offset = 0; hostTick(); }

      // Neue Runde erkannt -> Spiel starten
      var inParts = h.parts.indexOf(S.me.id) !== -1;
      if ((h.phase === 'playing' || h.phase === 'results' || h.phase === 'final') && inParts) {
        var key = h.round + ':' + h.seed;
        if (S.startKey !== key) {
          S.startKey = key;
          if (S.rd !== h.round) { S.rd = h.round; S.mv = ''; S.gu = false; saveMine(); push(); }
          S.game = replay(h.seed, h.settings.wrap, S.mv);
          if (h.phase === 'playing') {
            deliver({
              t: 'start', seed: h.seed, round: h.round, rounds: h.settings.rounds, wrap: h.settings.wrap,
              endsAt: h.endsAt ? h.endsAt - S.offset : 0, now: Date.now(),
              moves: decMoves(S.mv), done: S.gu || S.game.status !== 'playing'
            });
          }
        }
      }
      if (h.phase === 'lobby') S.startKey = null;

      // Emojis
      list.forEach(function (e) {
        var em = e.p.em;
        if (!em || typeof em.t !== 'number') return;
        var seen = S.emoteSeen[e.p.id];
        if (seen === undefined) { S.emoteSeen[e.p.id] = em.t; return; }
        if (em.t > seen) {
          S.emoteSeen[e.p.id] = em.t;
          if (['👍', '🔥', '😂', '😮', '🚀', '😭'].indexOf(em.e) !== -1) deliver({ t: 'emote', id: e.p.id, name: cleanName(e.p.name), e: em.e });
        }
      });

      // Raumzustand für die App
      var ids = {};
      list.forEach(function (e) { ids[e.p.id] = true; });
      if (h.phase !== 'lobby') h.parts.forEach(function (id) { ids[id] = true; });
      var playersOut = Object.keys(ids).map(function (id) {
        var st = stateOf(id, h);
        var inRound = h.parts.indexOf(id) !== -1;
        var status;
        if (h.phase === 'lobby') status = 'lobby';
        else if (h.phase === 'playing') status = !inRound ? 'waiting' : (st.gu || st.g.status !== 'playing' ? 'done' : 'playing');
        else status = 'done';
        return {
          id: id,
          name: st.p ? cleanName(st.p.name) : 'Pilot',
          host: id === h.hostId,
          connected: !!st.present,
          status: status,
          gaveUp: st.gu,
          score: inRound ? st.g.score : 0,
          remaining: inRound ? G.remaining(st.g) : 28,
          stock: inRound ? st.g.stock.length : 23,
          streak: inRound ? st.g.streak : 0,
          bestStreak: inRound ? st.g.bestStreak : 0,
          result: inRound && h.round > 0 ? st.g.status : null,
          total: (h.totals && h.totals[id]) || 0,
          roundScores: (h.rs && h.rs[id]) || []
        };
      });
      var room = {
        t: 'room',
        code: S.code,
        hostId: h.hostId,
        phase: h.phase,
        round: h.round,
        settings: h.settings,
        endsAt: h.endsAt ? h.endsAt - S.offset : 0,
        players: playersOut,
        lastResults: h.results || []
      };
      var json = JSON.stringify(room);
      if (json === S.lastRoomJson) return;
      S.lastRoomJson = json;
      room.now = Date.now();
      deliver(room);
    }

    return sock;
  }

  window.STRoom = { create: create };
})();
