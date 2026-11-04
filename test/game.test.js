'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../public/game.js');

test('Deck hat 52 verschiedene Karten', () => {
  const deck = G.createDeck();
  assert.strictEqual(deck.length, 52);
  assert.strictEqual(new Set(deck.map((c) => c.rank + c.suit)).size, 52);
});

test('gleicher Seed ergibt gleiches Blatt, anderer Seed ein anderes', () => {
  const a = G.newGame(1234);
  const b = G.newGame(1234);
  const c = G.newGame(999);
  assert.deepStrictEqual(a.tableau, b.tableau);
  assert.deepStrictEqual(a.stock, b.stock);
  assert.notDeepStrictEqual(a.tableau, c.tableau);
});

test('Aufbau: 28 Turmkarten, 23 im Stapel, 1 auf der Ablage', () => {
  const g = G.newGame(42);
  assert.strictEqual(g.tableau.length, 28);
  assert.strictEqual(g.stock.length, 23);
  assert.strictEqual(g.waste.length, 1);
  const all = g.tableau.map((t) => t.card).concat(g.stock, g.waste);
  assert.strictEqual(new Set(all.map((c) => c.rank + c.suit)).size, 52);
});

test('nur die unterste Reihe (10 Karten) ist zu Beginn offen', () => {
  const g = G.newGame(7);
  const open = g.tableau.filter((t) => G.isFaceUp(g, t.id)).map((t) => t.id);
  assert.deepStrictEqual(open, [18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
});

test('Verdeckung: jede Karte außer der untersten Reihe hat genau 2 Abdecker', () => {
  G.LAYOUT.forEach((s) => {
    if (s.row === 3) assert.strictEqual(s.coveredBy.length, 0);
    else assert.strictEqual(s.coveredBy.length, 2, 'Slot ' + s.id);
  });
  assert.deepStrictEqual(G.LAYOUT[0].coveredBy, [3, 4]);
  assert.deepStrictEqual(G.LAYOUT[3].coveredBy, [9, 10]);
  assert.deepStrictEqual(G.LAYOUT[9].coveredBy, [18, 19]);
});

function forceGame(tableauRanks, wasteRank, stockRanks, wrap) {
  const g = G.newGame(1, { wrap });
  g.tableau.forEach((t, i) => { t.card = { rank: tableauRanks[i] || 5, suit: 'S' }; });
  g.waste = [{ rank: wasteRank, suit: 'H' }];
  g.stock = (stockRanks || []).map((r) => ({ rank: r, suit: 'C' }));
  return g;
}

test('Karte passt bei ±1, Farbe egal; verdeckte Karten sind nicht spielbar', () => {
  const ranks = new Array(28).fill(9);
  ranks[18] = 6; ranks[19] = 8; ranks[20] = 7; ranks[0] = 6;
  const g = forceGame(ranks, 7, [2]);
  assert.ok(G.canPlay(g, 18));
  assert.ok(G.canPlay(g, 19));
  assert.ok(!G.canPlay(g, 20));
  assert.ok(!G.canPlay(g, 0)); // verdeckt
});

test('König ↔ Ass nur mit wrap', () => {
  const ranks = new Array(28).fill(9);
  ranks[18] = 1;
  const w = forceGame(ranks, 13, [2], true);
  assert.ok(G.canPlay(w, 18));
  const nw = forceGame(ranks, 13, [2], false);
  assert.ok(!G.canPlay(nw, 18));
});

test('Kettenpunkte steigen, Nachziehen setzt die Kette zurück', () => {
  const ranks = new Array(28).fill(13);
  ranks[18] = 6; ranks[19] = 5; ranks[20] = 4;
  const g = forceGame(ranks, 7, [10, 11]);
  assert.strictEqual(G.play(g, 18).gained, 10);
  assert.strictEqual(G.play(g, 19).gained, 20);
  assert.strictEqual(G.play(g, 20).gained, 30);
  assert.strictEqual(g.score, 60);
  assert.strictEqual(g.streak, 3);
  G.draw(g);
  assert.strictEqual(g.streak, 0);
  assert.strictEqual(g.bestStreak, 3);
});

test('aufgedeckte Karte wird spielbar, wenn beide Abdecker weg sind', () => {
  const ranks = new Array(28).fill(13);
  ranks[18] = 6; ranks[19] = 5; ranks[9] = 4;
  const g = forceGame(ranks, 7, [10]);
  assert.ok(!G.isFaceUp(g, 9));
  G.play(g, 18);
  assert.ok(!G.isFaceUp(g, 9));
  G.play(g, 19);
  assert.ok(G.isFaceUp(g, 9));
  assert.ok(G.canPlay(g, 9));
});

test('ungültige Züge ändern nichts', () => {
  const g = G.newGame(5);
  const before = JSON.stringify(g);
  assert.strictEqual(G.play(g, 0), null);
  assert.strictEqual(G.applyMove(g, { type: 'play', id: 99 }), null);
  assert.strictEqual(G.applyMove(g, { type: 'xyz' }), null);
  assert.strictEqual(JSON.stringify(g), before);
});

test('Undo stellt den vorherigen Zustand wieder her', () => {
  const g = G.newGame(77);
  const before = JSON.stringify({ t: g.tableau, s: g.stock, w: g.waste, sc: g.score });
  G.draw(g);
  const p = G.playableIds(g);
  if (p.length) G.play(g, p[0]);
  while (G.undo(g)) { /* zurück */ }
  assert.strictEqual(JSON.stringify({ t: g.tableau, s: g.stock, w: g.waste, sc: g.score }), before);
});

test('Spiel endet: gewonnen oder festgefahren; Boni werden vergeben', () => {
  // Alle Turmkarten so wählen, dass sie in einer Kette abräumbar sind:
  // Ablage 1, dann 2,3,4,... (mit wrap) – Reihenfolge der Züge: unterste Reihe zuerst.
  const order = [];
  for (let i = 27; i >= 0; i--) order.push(i);
  const ranks = new Array(28);
  order.forEach((id, k) => { ranks[id] = ((k + 1) % 13) + 1; });
  const g = forceGame(ranks, 1, [5, 6, 7]);
  // Reihenfolge so, dass Abdecker zuerst entfernt werden (höhere IDs zuerst passt hier)
  order.forEach((id) => assert.ok(G.play(g, id), 'Zug ' + id));
  assert.strictEqual(g.status, 'won');
  assert.ok(g.peaksCleared.every(Boolean));
  const chain = (28 * 29 / 2) * G.SCORE.perChainStep;
  const bonus = 2 * G.SCORE.peakBonus + G.SCORE.allPeaksBonus + 3 * G.SCORE.stockBonus;
  assert.strictEqual(g.score, chain + bonus);

  const stuck = forceGame(new Array(28).fill(13), 5, []);
  G.draw(stuck); // Stapel leer -> kein Zug
  assert.strictEqual(stuck.status, 'playing');
  // status wird erst nach einem Zug geprüft – leerer Stapel und kein Zug:
  const s2 = forceGame(new Array(28).fill(13), 5, [6]);
  G.draw(s2);
  assert.strictEqual(s2.status, 'stuck');
});

test('Zufällige Partien laufen ohne Fehler bis zum Ende', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const g = G.newGame(seed);
    let guard = 0;
    while (g.status === 'playing' && guard++ < 200) {
      const p = G.playableIds(g);
      if (p.length) G.play(g, p[0]);
      else G.draw(g);
    }
    assert.notStrictEqual(g.status, 'playing', 'Seed ' + seed);
    assert.strictEqual(G.remaining(g) + g.waste.length + g.stock.length, 52);
  }
});
