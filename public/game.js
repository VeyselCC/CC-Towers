/*
 * Space Towers – gemeinsame Spiellogik (Browser + Server).
 * Tri-Peaks-Solitaire: drei Türme aus 28 Karten, Nachziehstapel und Ablage.
 * Eine offene Turmkarte darf abgelegt werden, wenn ihr Wert genau eins
 * höher oder niedriger ist als die oberste Ablagekarte (Farbe egal).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpaceTowers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUITS = ['S', 'H', 'D', 'C']; // Pik, Herz, Karo, Kreuz
  var SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var SCORE = {
    perChainStep: 10, // n-te Karte einer Kette bringt n * 10 Punkte
    peakBonus: 250, // erster und zweiter Turm abgeräumt
    allPeaksBonus: 1000, // alle drei Türme abgeräumt
    stockBonus: 50 // je übrige Nachziehkarte beim Sieg
  };

  // ---------- Zufall (deterministisch per Seed) ----------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 1; r <= 13; r++) deck.push({ rank: r, suit: SUITS[s] });
    }
    return deck;
  }

  function shuffle(deck, seed) {
    var rnd = mulberry32(seed);
    var d = deck.slice();
    for (var i = d.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = d[i];
      d[i] = d[j];
      d[j] = tmp;
    }
    return d;
  }

  // ---------- Layout der drei Türme ----------
  // Reihe 0 = Turmspitzen (3), Reihe 1 = 6, Reihe 2 = 9, Reihe 3 = 10 Karten.
  // x ist die horizontale Position in Kartenbreiten.
  function buildLayout() {
    var slots = [];
    var p, j;
    for (p = 0; p < 3; p++) slots.push({ row: 0, x: p * 3 + 1.5, peak: p });
    for (p = 0; p < 3; p++) for (j = 0; j < 2; j++) slots.push({ row: 1, x: p * 3 + 1 + j, peak: p });
    for (j = 0; j < 9; j++) slots.push({ row: 2, x: j + 0.5, peak: Math.min(2, Math.floor(j / 3)) });
    for (j = 0; j < 10; j++) slots.push({ row: 3, x: j, peak: -1 });
    // Wer verdeckt wen? Karte in Reihe r wird von den zwei Karten in Reihe r+1
    // verdeckt, die genau eine halbe Kartenbreite links/rechts liegen.
    slots.forEach(function (s, i) {
      s.id = i;
      s.coveredBy = [];
      slots.forEach(function (o, k) {
        if (o.row === s.row + 1 && Math.abs(o.x - s.x) === 0.5) s.coveredBy.push(k);
      });
    });
    return slots;
  }

  var LAYOUT = buildLayout();
  var PEAK_TOPS = [0, 1, 2];

  function newGame(seed, options) {
    options = options || {};
    var deck = shuffle(createDeck(), seed >>> 0);
    var tableau = LAYOUT.map(function (slot, i) {
      return { id: i, card: deck[i], removed: false };
    });
    var rest = deck.slice(28);
    var waste = [rest.shift()];
    return {
      seed: seed >>> 0,
      wrap: options.wrap !== false, // K <-> A erlaubt
      tableau: tableau,
      stock: rest, // stock[stock.length-1] ist die nächste Karte
      waste: waste,
      score: 0,
      streak: 0,
      bestStreak: 0,
      peaksCleared: [false, false, false],
      moves: 0,
      history: [],
      status: 'playing' // playing | won | stuck
    };
  }

  function isFaceUp(state, id) {
    var t = state.tableau[id];
    if (t.removed) return false;
    var cov = LAYOUT[id].coveredBy;
    for (var i = 0; i < cov.length; i++) if (!state.tableau[cov[i]].removed) return false;
    return true;
  }

  function topWaste(state) {
    return state.waste[state.waste.length - 1];
  }

  function isAdjacent(a, b, wrap) {
    var d = Math.abs(a - b);
    return d === 1 || (wrap && d === 12);
  }

  function canPlay(state, id) {
    if (state.status !== 'playing') return false;
    if (id < 0 || id >= state.tableau.length) return false;
    if (!isFaceUp(state, id)) return false;
    return isAdjacent(state.tableau[id].card.rank, topWaste(state).rank, state.wrap);
  }

  function playableIds(state) {
    var out = [];
    for (var i = 0; i < state.tableau.length; i++) if (canPlay(state, i)) out.push(i);
    return out;
  }

  function remaining(state) {
    var n = 0;
    for (var i = 0; i < state.tableau.length; i++) if (!state.tableau[i].removed) n++;
    return n;
  }

  function snapshot(state) {
    return {
      removed: state.tableau.map(function (t) { return t.removed; }),
      stock: state.stock.slice(),
      waste: state.waste.slice(),
      score: state.score,
      streak: state.streak,
      bestStreak: state.bestStreak,
      peaksCleared: state.peaksCleared.slice(),
      moves: state.moves,
      status: state.status
    };
  }

  function updateStatus(state) {
    if (remaining(state) === 0) {
      state.status = 'won';
      state.score += state.stock.length * SCORE.stockBonus;
      return;
    }
    if (state.stock.length === 0 && playableIds(state).length === 0) state.status = 'stuck';
  }

  // Liefert ein Ereignisobjekt (für Animation/Sound) oder null bei ungültigem Zug.
  function play(state, id) {
    if (!canPlay(state, id)) return null;
    state.history.push(snapshot(state));
    var t = state.tableau[id];
    t.removed = true;
    state.waste.push(t.card);
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    var gained = state.streak * SCORE.perChainStep;
    var bonus = 0;
    var peak = PEAK_TOPS.indexOf(id);
    if (peak !== -1 && !state.peaksCleared[peak]) {
      state.peaksCleared[peak] = true;
      var cleared = state.peaksCleared.filter(Boolean).length;
      bonus = cleared === 3 ? SCORE.allPeaksBonus : SCORE.peakBonus;
    }
    state.score += gained + bonus;
    state.moves += 1;
    updateStatus(state);
    return { type: 'play', id: id, card: t.card, gained: gained, bonus: bonus, streak: state.streak, peak: bonus ? peak : -1 };
  }

  function draw(state) {
    if (state.status !== 'playing' || state.stock.length === 0) return null;
    state.history.push(snapshot(state));
    var card = state.stock.pop();
    state.waste.push(card);
    state.streak = 0;
    state.moves += 1;
    updateStatus(state);
    return { type: 'draw', card: card };
  }

  function undo(state) {
    var s = state.history.pop();
    if (!s) return false;
    state.tableau.forEach(function (t, i) { t.removed = s.removed[i]; });
    state.stock = s.stock;
    state.waste = s.waste;
    state.score = s.score;
    state.streak = s.streak;
    state.bestStreak = s.bestStreak;
    state.peaksCleared = s.peaksCleared;
    state.moves = s.moves;
    state.status = s.status;
    return true;
  }

  // Zug als einfaches Objekt anwenden: {type:'play', id} oder {type:'draw'}
  function applyMove(state, move) {
    if (!move) return null;
    if (move.type === 'play') return play(state, move.id | 0);
    if (move.type === 'draw') return draw(state);
    return null;
  }

  function cardLabel(card) {
    return RANK_LABELS[card.rank] + SUIT_SYMBOLS[card.suit];
  }

  function isRed(card) {
    return card.suit === 'H' || card.suit === 'D';
  }

  function randomSeed() {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }

  return {
    SUITS: SUITS,
    SUIT_SYMBOLS: SUIT_SYMBOLS,
    RANK_LABELS: RANK_LABELS,
    SCORE: SCORE,
    LAYOUT: LAYOUT,
    newGame: newGame,
    isFaceUp: isFaceUp,
    canPlay: canPlay,
    playableIds: playableIds,
    remaining: remaining,
    topWaste: topWaste,
    play: play,
    draw: draw,
    undo: undo,
    applyMove: applyMove,
    cardLabel: cardLabel,
    isRed: isRed,
    randomSeed: randomSeed,
    shuffle: shuffle,
    createDeck: createDeck
  };
});
