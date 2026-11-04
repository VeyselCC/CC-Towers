'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../public/game.js');
const { server } = require('../server.js');

let port;
test.before(() => new Promise((res) => server.listen(0, () => { port = server.address().port; res(); })));
test.after(() => new Promise((res) => {
  for (const ws of require('../server.js').sockets) ws.close(1001);
  server.close(() => res());
}));

function client() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const c = { ws, msgs: [], waiters: [] };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      c.msgs.push(m);
      c.waiters = c.waiters.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
    };
    c.send = (m) => ws.send(JSON.stringify(m));
    c.wait = (pred, ms) => new Promise((res, rej) => {
      const found = c.msgs.find(pred);
      if (found) { c.msgs.splice(c.msgs.indexOf(found), 1); return res(found); }
      const w = { pred, res: (m) => { clearTimeout(t); c.msgs.splice(c.msgs.indexOf(m), 1); res(m); } };
      const t = setTimeout(() => rej(new Error('Timeout beim Warten')), ms || 2000);
      c.waiters.push(w);
    });
    ws.onopen = () => resolve(c);
    ws.onerror = reject;
  });
}

test('statische Dateien werden ausgeliefert', async () => {
  const r = await fetch('http://127.0.0.1:' + port + '/');
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /Space Towers/);
  const g = await fetch('http://127.0.0.1:' + port + '/game.js');
  assert.strictEqual(g.status, 200);
  const bad = await fetch('http://127.0.0.1:' + port + '/../server.js');
  assert.notStrictEqual(bad.status, 200);
});

test('Raum erstellen, beitreten, Runde spielen, Ergebnis', async () => {
  const a = await client();
  const b = await client();
  a.send({ t: 'create', name: 'Anna' });
  const wa = await a.wait((m) => m.t === 'welcome');
  assert.match(wa.code, /^[A-Z0-9]{4}$/);

  b.send({ t: 'join', code: wa.code, name: 'Anna' });
  const wb = await b.wait((m) => m.t === 'welcome');
  assert.strictEqual(wb.name, 'Anna 2'); // Name wird eindeutig gemacht

  // Nur der Host darf Einstellungen ändern
  b.send({ t: 'settings', settings: { rounds: 7 } });
  a.send({ t: 'settings', settings: { rounds: 2, timeLimit: 0, wrap: false } });
  const room = await a.wait((m) => m.t === 'room' && m.settings.rounds === 2);
  assert.strictEqual(room.settings.timeLimit, 0);
  assert.strictEqual(room.settings.wrap, false);
  assert.strictEqual(room.players.length, 2);

  b.send({ t: 'start' }); // kein Host -> ignoriert
  a.send({ t: 'start' });
  const sa = await a.wait((m) => m.t === 'start');
  const sb = await b.wait((m) => m.t === 'start');
  assert.strictEqual(sa.seed, sb.seed); // gleiches Blatt für alle
  assert.strictEqual(sa.wrap, false);

  // Ungültiger Zug -> resync
  a.send({ t: 'move', m: { type: 'play', id: 0 } });
  await a.wait((m) => m.t === 'resync');

  // A spielt automatisch bis zum Ende, B gibt auf
  const g = G.newGame(sa.seed, { wrap: false });
  while (g.status === 'playing') {
    const p = G.playableIds(g);
    const mv = p.length ? { type: 'play', id: p[0] } : { type: 'draw' };
    G.applyMove(g, mv);
    a.send({ t: 'move', m: mv });
  }
  b.send({ t: 'giveup' });
  const res = await a.wait((m) => m.t === 'room' && m.phase === 'results', 3000);
  assert.strictEqual(res.lastResults.length, 2);
  const ra = res.lastResults.find((r) => r.id === wa.id);
  assert.strictEqual(ra.score, g.score); // Server hat dieselbe Punktzahl berechnet
  assert.strictEqual(res.lastResults[0].rank, 1);

  // Runde 2 -> danach Endstand
  a.send({ t: 'start' });
  await a.wait((m) => m.t === 'start' && m.round === 2);
  a.send({ t: 'giveup' });
  b.send({ t: 'giveup' });
  const fin = await b.wait((m) => m.t === 'room' && m.phase === 'final', 3000);
  const pa = fin.players.find((p) => p.id === wa.id);
  assert.strictEqual(pa.roundScores.length, 2);

  a.send({ t: 'lobby' });
  const lob = await b.wait((m) => m.t === 'room' && m.phase === 'lobby');
  assert.strictEqual(lob.players[0].total, 0);
  a.ws.close();
  b.ws.close();
});

test('Wiederverbinden mit Token setzt das Spiel fort', async () => {
  const a = await client();
  a.send({ t: 'create', name: 'Ben' });
  const w = await a.wait((m) => m.t === 'welcome');
  a.send({ t: 'settings', settings: { timeLimit: 0 } });
  a.send({ t: 'start' });
  const s = await a.wait((m) => m.t === 'start');
  a.send({ t: 'move', m: { type: 'draw' } });
  await new Promise((r) => setTimeout(r, 100));
  a.ws.close();
  await new Promise((r) => setTimeout(r, 100));

  const a2 = await client();
  a2.send({ t: 'join', code: w.code, token: w.token, name: 'Ben' });
  const w2 = await a2.wait((m) => m.t === 'welcome');
  assert.strictEqual(w2.id, w.id);
  const s2 = await a2.wait((m) => m.t === 'start');
  assert.strictEqual(s2.seed, s.seed);
  assert.deepStrictEqual(s2.moves, [{ type: 'draw' }]);
  a2.ws.close();
});

test('unbekannter Raum liefert Fehlermeldung', async () => {
  const c = await client();
  c.send({ t: 'join', code: 'ZZZZ', name: 'X' });
  const e = await c.wait((m) => m.t === 'error');
  assert.match(e.msg, /nicht gefunden/);
  c.ws.close();
});

test('Zeitlimit beendet die Runde, auch wenn noch jemand spielt', async () => {
  const { rooms, endRound } = require('../server.js');
  const a = await client();
  a.send({ t: 'create', name: 'Cem' });
  const w = await a.wait((m) => m.t === 'welcome');
  a.send({ t: 'start' });
  const s = await a.wait((m) => m.t === 'start');
  assert.ok(s.endsAt > Date.now()); // Standard: 3 Minuten
  const room = rooms.get(w.code);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endRound(room), 50); // Ablauf simulieren
  const r = await a.wait((m) => m.t === 'room' && m.phase === 'results', 3000);
  assert.strictEqual(r.lastResults.length, 1);
  a.send({ t: 'move', m: { type: 'draw' } }); // nach Ablauf ignoriert
  a.ws.close();
});

test('Totenkopf: bei 3 Spielern scheidet der Letzte aus und spielt nicht mehr mit', async () => {
  const [a, b, c] = [await client(), await client(), await client()];
  a.send({ t: 'create', name: 'A' });
  const wa = await a.wait((m) => m.t === 'welcome');
  b.send({ t: 'join', code: wa.code, name: 'B' });
  c.send({ t: 'join', code: wa.code, name: 'C' });
  const wb = await b.wait((m) => m.t === 'welcome');
  const wc = await c.wait((m) => m.t === 'welcome');
  a.send({ t: 'settings', settings: { rounds: 3, timeLimit: 0 } });
  await a.wait((m) => m.t === 'room' && m.settings.rounds === 3 && m.players.length === 3);
  const playRound = async (round, ps) => {
    a.send({ t: 'start' });
    for (const p of ps) await p.wait((m) => m.t === 'start' && m.round === round);
    // B legt eine Karte, wenn möglich, damit B vorne liegt; C zieht nur
    for (const p of ps) p.send({ t: 'giveup' });
    return a.wait((m) => m.t === 'room' && (m.phase === 'results' || m.phase === 'final') && m.round === round, 3000);
  };
  const r1 = await playRound(1, [a, b, c]);
  assert.deepStrictEqual(r1.elimRounds, [2]);
  assert.ok(!r1.lastResults.some((r) => r.eliminated));
  const r2 = await playRound(2, [a, b, c]);
  const out = r2.lastResults.filter((r) => r.eliminated);
  assert.strictEqual(out.length, 1);
  const outId = out[0].id;
  assert.strictEqual(r2.players.find((p) => p.id === outId).status, 'out');
  const outClient = [a, b, c][[wa.id, wb.id, wc.id].indexOf(outId)];
  const stay = [a, b, c].filter((p) => p !== outClient);
  // Runde 3: der Ausgeschiedene bekommt kein Spiel mehr
  a.send({ t: 'start' });
  for (const p of stay) await p.wait((m) => m.t === 'start' && m.round === 3);
  await assert.rejects(outClient.wait((m) => m.t === 'start' && m.round === 3, 300));
  outClient.send({ t: 'move', m: { type: 'draw' } }); // wird ignoriert
  for (const p of stay) p.send({ t: 'giveup' });
  const fin = await a.wait((m) => m.t === 'room' && m.phase === 'final', 3000);
  assert.strictEqual(fin.lastResults.length, 2);
  assert.strictEqual(fin.players.find((p) => p.id === outId).eliminated, 2);
  a.send({ t: 'lobby' });
  const lob = await a.wait((m) => m.t === 'room' && m.phase === 'lobby');
  assert.ok(lob.players.every((p) => !p.eliminated));
  for (const p of [a, b, c]) p.ws.close();
});

test('Bonus-Zug wird vom Server geprüft', async () => {
  const a = await client();
  a.send({ t: 'create', name: 'Bo' });
  await a.wait((m) => m.t === 'welcome');
  a.send({ t: 'settings', settings: { timeLimit: 0 } });
  a.send({ t: 'start' });
  await a.wait((m) => m.t === 'start');
  a.send({ t: 'move', m: { type: 'bonus' } }); // kein Bonus-Stapel -> resync
  await a.wait((m) => m.t === 'resync');
  a.ws.close();
});
