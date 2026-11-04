/* Space Towers – Browser-Client */
(function () {
  'use strict';

  var G = window.SpaceTowers;
  // Im claude.ai-Artifact gibt es keinen teilbaren Link mit ?room=, nur den Code
  var CODE_ONLY = !!window.STRoom && !window.ST_STATIC;
  var LAYOUT = G.LAYOUT;
  // Deutsche Kartenbezeichnungen: Ass, Bube, Dame, König
  var RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];
  var SUIT = G.SUIT_SYMBOLS;

  var ROW_STEP = 0.62; // vertikaler Abstand der Reihen in Kartenbreiten
  var CARD_H = 1.36;
  var PILE_TOP = 3 * ROW_STEP + CARD_H + 0.4;
  var STOCK_X = 3.55;
  var WASTE_X = 5.45;
  var BONUS_X = 7.45;

  // ------------------------------------------------------------------
  // Hilfsfunktionen
  // ------------------------------------------------------------------
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem('st-' + key));
      localStorage.setItem('st-' + key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function session(val) {
    try {
      if (val === undefined) return JSON.parse(sessionStorage.getItem('st-session'));
      if (val === null) sessionStorage.removeItem('st-session');
      else sessionStorage.setItem('st-session', JSON.stringify(val));
    } catch (e) { return null; }
  }
  function fmtTime(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function fmt(n) { return Number(n || 0).toLocaleString('de-DE'); }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }

  function showScreen(name) {
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); });
    if (name === 'game') requestAnimationFrame(layout);
  }

  // ------------------------------------------------------------------
  // Einstellungen
  // ------------------------------------------------------------------
  var prefs = Object.assign({ sound: true, name: '' }, store('prefs') || {});
  delete prefs.hint; // keine Spielhilfen mehr
  function savePrefs() { store('prefs', prefs); }

  // ------------------------------------------------------------------
  // Sound (WebAudio, ohne Dateien)
  // ------------------------------------------------------------------
  var audio = null;
  function ctx() {
    if (!audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, dur, type, vol, delay) {
    if (!prefs.sound) return;
    var a = ctx();
    if (!a) return;
    var t0 = a.currentTime + (delay || 0);
    var o = a.createOscillator();
    var g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  var sfx = {
    play: function (streak) { var f = 440 * Math.pow(2, Math.min(streak - 1, 16) / 12); tone(f, 0.16, 'triangle', 0.14); },
    draw: function () { tone(220, 0.09, 'sine', 0.08); tone(330, 0.08, 'sine', 0.05, 0.04); },
    bad: function () { tone(140, 0.18, 'square', 0.05); },
    peak: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.12, i * 0.07); }); },
    win: function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.3, 'triangle', 0.13, i * 0.11); }); },
    lose: function () { [392, 330, 262].forEach(function (f, i) { tone(f, 0.35, 'sine', 0.1, i * 0.16); }); },
    tick: function () { tone(880, 0.05, 'square', 0.03); },
    pop: function () { tone(660, 0.08, 'sine', 0.06); }
  };

  // ------------------------------------------------------------------
  // Sternenhimmel
  // ------------------------------------------------------------------
  (function stars() {
    var c = $('#stars');
    var g = c.getContext('2d');
    var list = [];
    var w, h, dpr;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c.width = innerWidth * dpr;
      h = c.height = innerHeight * dpr;
      var n = Math.round((innerWidth * innerHeight) / 5000);
      list = [];
      for (var i = 0; i < n; i++) {
        list.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + 0.2, s: Math.random() * 0.25 + 0.03, p: Math.random() * 6.28 });
      }
    }
    function frame(t) {
      g.clearRect(0, 0, w, h);
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        s.y += s.s * dpr;
        if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
        var a = 0.45 + 0.55 * Math.sin(t / 900 + s.p);
        g.globalAlpha = a;
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(s.x, s.y, s.r * dpr, 0, 6.283);
        g.fill();
      }
      requestAnimationFrame(frame);
    }
    addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  })();

  // ------------------------------------------------------------------
  // Karten-HTML
  // ------------------------------------------------------------------
  function faceHTML(card) {
    var r = RANKS[card.rank];
    var s = SUIT[card.suit];
    var center;
    if (card.rank >= 11) center = '<div class="face">' + r + '<small>' + s + '</small></div>';
    else center = '<div class="pip">' + s + '</div>';
    return '<div class="corner tl">' + r + '<span class="s">' + s + '</span></div>' +
      center +
      '<div class="corner br">' + r + '<span class="s">' + s + '</span></div>';
  }
  function cardClass(card) { return 'card' + (G.isRed(card) ? ' red' : ''); }
  function cardName(card) {
    var names = { S: 'Pik', H: 'Herz', D: 'Karo', C: 'Kreuz' };
    var r = { 1: 'Ass', 11: 'Bube', 12: 'Dame', 13: 'König' }[card.rank] || String(card.rank);
    return names[card.suit] + ' ' + r;
  }

  // ------------------------------------------------------------------
  // Spielzustand
  // ------------------------------------------------------------------
  var app = {
    mode: null, // 'solo' | 'multi'
    game: null,
    cw: 60,
    cardEls: [],
    faceUp: [],
    locked: false,
    endShown: false,
    soloSeed: 0
  };

  var board = $('#board');
  var fx = $('#fx');

  function buildBoard() {
    board.innerHTML = '';
    app.cardEls = [];
    app.faceUp = [];
    var g = app.game;
    g.tableau.forEach(function (t, i) {
      var el = document.createElement('div');
      el.className = cardClass(t.card);
      el.dataset.id = i;
      el.innerHTML = faceHTML(t.card);
      el.style.zIndex = LAYOUT[i].row + 1;
      board.appendChild(el);
      app.cardEls.push(el);
      app.faceUp.push(G.isFaceUp(g, i));
    });
    var stock = document.createElement('div');
    stock.id = 'stock';
    stock.className = 'pile stock-slot';
    board.appendChild(stock);
    var stockCards = document.createElement('div');
    stockCards.id = 'stock-cards';
    board.appendChild(stockCards);
    var waste = document.createElement('div');
    waste.id = 'waste';
    board.appendChild(waste);
    var sc = document.createElement('div');
    sc.id = 'stock-count';
    sc.className = 'stock-count';
    board.appendChild(sc);
    var bp = document.createElement('div');
    bp.id = 'bonus';
    board.appendChild(bp);
    var bl = document.createElement('div');
    bl.id = 'bonus-label';
    bl.className = 'pile-label bonus-label';
    bl.textContent = 'Bonus';
    board.appendChild(bl);
    var wl = document.createElement('div');
    wl.id = 'waste-label';
    wl.className = 'pile-label';
    wl.textContent = 'Ablage';
    board.appendChild(wl);
    layout();
  }

  function layout() {
    if (!app.game) return;
    var table = $('#table');
    var W = table.clientWidth - 16;
    var H = table.clientHeight - 12;
    if (W <= 0 || H <= 0) return;
    var cw = Math.floor(Math.min(W / 10, H / (PILE_TOP + CARD_H + 0.45), 132));
    cw = Math.max(cw, 24);
    app.cw = cw;
    document.documentElement.style.setProperty('--cw', cw + 'px');
    board.style.width = (cw * 9.94) + 'px';
    board.style.height = (cw * (PILE_TOP + CARD_H + 0.42)) + 'px';
    app.cardEls.forEach(function (el, i) {
      el.style.left = (LAYOUT[i].x * cw) + 'px';
      el.style.top = (LAYOUT[i].row * ROW_STEP * cw) + 'px';
    });
    var stock = $('#stock');
    stock.style.left = (STOCK_X * cw) + 'px';
    stock.style.top = (PILE_TOP * cw) + 'px';
    var sc = $('#stock-count');
    sc.style.left = (STOCK_X * cw) + 'px';
    sc.style.width = (0.94 * cw) + 'px';
    sc.style.top = ((PILE_TOP + CARD_H + 0.06) * cw) + 'px';
    var wl = $('#waste-label');
    wl.style.left = (WASTE_X * cw) + 'px';
    wl.style.width = (0.94 * cw) + 'px';
    wl.style.top = ((PILE_TOP + CARD_H + 0.1) * cw) + 'px';
    var bl = $('#bonus-label');
    bl.style.left = (BONUS_X * cw) + 'px';
    bl.style.width = (0.94 * cw) + 'px';
    bl.style.top = ((PILE_TOP + CARD_H + 0.1) * cw) + 'px';
    render();
  }

  function render() {
    var g = app.game;
    if (!g) return;
    var cw = app.cw;
    var playable = app.locked ? [] : G.playableIds(g);
    app.cardEls.forEach(function (el, i) {
      var t = g.tableau[i];
      if (t.removed) {
        el.style.display = 'none';
        el.classList.remove('playable', 'open', 'reveal', 'shake');
        app.faceUp[i] = false;
        return;
      }
      el.style.display = '';
      var up = G.isFaceUp(g, i);
      el.classList.toggle('back', !up);
      el.classList.toggle('open', up);
      el.classList.toggle('playable', playable.indexOf(i) !== -1);
      el.setAttribute('aria-label', up ? cardName(t.card) : 'Verdeckte Karte');
      if (up && !app.faceUp[i]) {
        el.classList.remove('reveal');
        void el.offsetWidth;
        el.classList.add('reveal');
      }
      app.faceUp[i] = up;
    });

    // Nachziehstapel
    var sc = $('#stock-cards');
    var n = Math.min(3, g.stock.length);
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<div class="card back stock-card" style="left:' + ((STOCK_X - i * 0.035) * cw) + 'px;top:' + ((PILE_TOP - i * 0.035) * cw) + 'px;z-index:' + (30 + i) + '"></div>';
    }
    sc.innerHTML = html;
    $('#stock').classList.toggle('empty', g.stock.length === 0);
    $('#stock-count').textContent = g.stock.length + (g.stock.length === 1 ? ' Karte' : ' Karten');

    // Ablage (bis zu 3 Karten aufgefächert)
    var w = $('#waste');
    var k = Math.min(3, g.waste.length);
    var wh = '';
    for (var j = 0; j < k; j++) {
      var c = g.waste[g.waste.length - k + j];
      wh += '<div class="' + cardClass(c) + (j === k - 1 ? ' waste-top' : '') + '" style="left:' + ((WASTE_X + j * 0.14) * cw) + 'px;top:' + (PILE_TOP * cw) + 'px;z-index:' + (30 + j) + '">' + faceHTML(c) + '</div>';
    }
    w.innerHTML = wh;

    // Bonus-Stapel (verschwindet beim Nachziehen)
    var bp = $('#bonus');
    var bh = '';
    var bonusOk = !app.locked && G.canPlayBonus(g);
    for (var b = 0; b < g.bonus.length; b++) {
      var bc = g.bonus[b];
      var isTop = b === g.bonus.length - 1;
      var off = (g.bonus.length - 1 - b) * 0.05;
      bh += '<div class="' + cardClass(bc) + ' bonus-card' + (isTop ? ' bonus-top open' : ' back') +
        (isTop && bonusOk ? ' playable' : '') + '" style="left:' + ((BONUS_X + off) * cw) + 'px;top:' + ((PILE_TOP - off) * cw) + 'px;z-index:' + (30 + b) + '"' +
        (isTop ? ' aria-label="Bonuskarte ' + cardName(bc) + '"' : '') + '>' + faceHTML(bc) + '</div>';
    }
    bp.innerHTML = bh;
    $('#bonus-label').style.visibility = g.bonus.length ? 'visible' : 'hidden';

    // HUD
    $('#hud-score').textContent = fmt(g.score);
    var st = $('#hud-streak');
    st.textContent = g.streak;
    st.classList.toggle('hot', g.streak >= 5);
    $('#hud-left').textContent = G.remaining(g);
  }

  // ------------------------------------------------------------------
  // Effekte
  // ------------------------------------------------------------------
  function relRect(el) {
    var r = el.getBoundingClientRect();
    var f = fx.getBoundingClientRect();
    return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height };
  }

  function fly(fromRect, targetEl, html, cls) {
    if (!targetEl) return;
    var to = relRect(targetEl);
    var el = document.createElement('div');
    el.className = cls + ' fly';
    el.innerHTML = html;
    el.style.left = fromRect.x + 'px';
    el.style.top = fromRect.y + 'px';
    fx.appendChild(el);
    targetEl.style.visibility = 'hidden';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.style.transform = 'translate(' + (to.x - fromRect.x) + 'px,' + (to.y - fromRect.y) + 'px)';
      });
    });
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      el.remove();
      targetEl.style.visibility = '';
    }
    el.addEventListener('transitionend', finish);
    setTimeout(finish, 450);
  }

  function floatText(x, y, text, big) {
    var el = document.createElement('div');
    el.className = 'float-text' + (big ? ' big' : '');
    el.textContent = text;
    var fw = fx.clientWidth;
    if (fw) x = Math.max(fw * 0.14, Math.min(fw * 0.86, x));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    fx.appendChild(el);
    setTimeout(function () { el.remove(); }, 1050);
  }

  function sparks(x, y, count) {
    var colors = ['#ff7ad9', '#8fb0ff', '#ffd36b', '#3ee6a8', '#ffffff'];
    for (var i = 0; i < count; i++) {
      var s = document.createElement('div');
      s.className = 'spark';
      var a = Math.random() * Math.PI * 2;
      var d = 40 + Math.random() * 120;
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.background = colors[i % colors.length];
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      fx.appendChild(s);
      setTimeout(s.remove.bind(s), 850);
    }
  }

  function celebrate() {
    var f = fx.getBoundingClientRect();
    for (var i = 0; i < 6; i++) {
      (function (i) {
        setTimeout(function () {
          sparks(Math.random() * f.width, Math.random() * f.height * 0.7, 26);
        }, i * 180);
      })(i);
    }
  }

  // ------------------------------------------------------------------
  // Spielzüge
  // ------------------------------------------------------------------
  function onCard(id) {
    var g = app.game;
    if (!g || app.locked || g.status !== 'playing') return;
    var el = app.cardEls[id];
    if (!G.canPlay(g, id)) {
      if (G.isFaceUp(g, id)) {
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        sfx.bad();
      }
      return;
    }
    var from = relRect(el);
    var ev = G.play(g, id);
    if (app.mode === 'multi') net.send({ t: 'move', m: { type: 'play', id: id } });
    render();
    fly(from, $('#waste .waste-top'), faceHTML(ev.card), cardClass(ev.card));
    var cx = from.x + from.w / 2;
    var cy = from.y + from.h / 2;
    floatText(cx, cy, '+' + ev.gained, false);
    if (ev.bonusPile) setTimeout(function () { floatText(cx, cy - app.cw * 0.6, 'Bonus-Stapel!', true); sfx.peak(); }, 120);
    else if (ev.streak >= 3 && ev.streak % 3 === 0) floatText(cx, cy - app.cw * 0.6, ev.streak + 'er-Kette!', true);
    if (ev.bonus) {
      setTimeout(function () {
        floatText(cx, cy + app.cw * 0.3, (ev.bonus >= G.SCORE.allPeaksBonus ? 'Alle Türme! +' : 'Turm geräumt! +') + ev.bonus, true);
      }, 180);
      sparks(cx, cy, 30);
      sfx.peak();
    } else {
      sfx.play(ev.streak);
    }
    afterMove();
  }

  function onBonus() {
    var g = app.game;
    if (!g || app.locked || g.status !== 'playing' || !g.bonus.length) return;
    var el = $('#bonus .bonus-top');
    if (!G.canPlayBonus(g)) {
      if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
      sfx.bad();
      return;
    }
    var from = relRect(el);
    var ev = G.playBonus(g);
    if (app.mode === 'multi') net.send({ t: 'move', m: { type: 'bonus' } });
    render();
    fly(from, $('#waste .waste-top'), faceHTML(ev.card), cardClass(ev.card));
    var cx = from.x + from.w / 2;
    var cy = from.y + from.h / 2;
    floatText(cx, cy, '+' + ev.gained, false);
    if (ev.bonusPile) setTimeout(function () { floatText(cx, cy - app.cw * 0.6, 'Bonus-Stapel!', true); sfx.peak(); }, 120);
    sfx.play(ev.streak);
    afterMove();
  }

  function onStock() {
    var g = app.game;
    if (!g || app.locked || g.status !== 'playing') return;
    if (g.stock.length === 0) { sfx.bad(); return; }
    var top = $('#stock-cards .stock-card:last-child');
    var from = top ? relRect(top) : relRect($('#stock'));
    var ev = G.draw(g);
    if (app.mode === 'multi') net.send({ t: 'move', m: { type: 'draw' } });
    render();
    fly(from, $('#waste .waste-top'), faceHTML(ev.card), cardClass(ev.card));
    sfx.draw();
    afterMove();
  }

  function afterMove() {
    var g = app.game;
    if (g.status === 'playing') return;
    if (g.status === 'won') {
      sfx.win();
      celebrate();
    } else {
      sfx.lose();
    }
    setTimeout(function () {
      if (app.mode === 'solo') showSoloEnd();
      else if (net.room && net.room.phase === 'playing') showWaiting();
    }, g.status === 'won' ? 900 : 500);
  }

  board.addEventListener('click', function (e) {
    var card = e.target.closest('.card');
    if (card && card.dataset.id !== undefined && card.parentNode === board) return onCard(+card.dataset.id);
    if (e.target.closest('#bonus .bonus-top')) return onBonus();
    if (e.target.closest('.stock-card') || e.target.closest('#stock')) return onStock();
  });

  // ------------------------------------------------------------------
  // Solo
  // ------------------------------------------------------------------
  function startSolo(seed) {
    app.mode = 'solo';
    app.soloSeed = seed === undefined ? G.randomSeed() : seed;
    app.game = G.newGame(app.soloSeed, { wrap: prefs.soloWrap !== false });
    app.locked = false;
    app.endShown = false;
    closeOverlay();
    setGameChrome();
    showScreen('game');
    buildBoard();
  }

  function showSoloEnd() {
    if (app.endShown || app.mode !== 'solo') return;
    app.endShown = true;
    var g = app.game;
    var best = store('best') || 0;
    var isBest = g.score > best;
    if (isBest) store('best', g.score);
    var played = (store('played') || 0) + 1;
    store('played', played);
    var wins = (store('wins') || 0) + (g.status === 'won' ? 1 : 0);
    store('wins', wins);
    openOverlay(
      '<h2>' + (g.status === 'won' ? '🚀 Alle Türme geräumt!' : 'Keine Züge mehr') + '</h2>' +
      '<p class="subtitle">' + (g.status === 'won' ? 'Starker Flug, ' + esc(myName()) + '!' : 'Noch ' + G.remaining(g) + ' Karten in den Türmen.') + '</p>' +
      '<div class="big-score">' + fmt(g.score) + '</div>' +
      (isBest ? '<p class="subtitle" style="color:var(--warn)">★ Neuer Rekord!</p>' : '<p class="subtitle">Rekord: ' + fmt(Math.max(best, g.score)) + '</p>') +
      '<div class="stats">' +
      '<div><b>' + g.bestStreak + '</b><span>Längste Kette</span></div>' +
      '<div><b>' + g.peaksCleared.filter(Boolean).length + '/3</b><span>Türme</span></div>' +
      '<div><b>' + wins + '/' + played + '</b><span>Siege</span></div>' +
      '</div>' +
      '<div class="actions">' +
      '<button class="btn" data-act="replay">Gleiches Blatt</button>' +
      '<button class="btn primary" data-act="new">Neues Spiel</button>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // Overlays
  // ------------------------------------------------------------------
  var overlayKind = null;
  function openOverlay(html, kind) {
    $('#overlay-box').innerHTML = html;
    $('#overlay').classList.remove('hidden');
    overlayKind = kind || 'generic';
  }
  function closeOverlay() {
    $('#overlay').classList.add('hidden');
    overlayKind = null;
  }

  function showRules() {
    openOverlay($('#rules-tpl').innerHTML + '<div class="actions"><button class="btn primary" data-act="close">Verstanden</button></div>', 'rules');
  }

  function showMenu() {
    var html = '<h2>Menü</h2><div class="actions" style="flex-direction:column">' +
      '<button class="btn primary" data-act="close">Weiterspielen</button>' +
      '<button class="btn" data-act="rules">Spielregeln</button>';
    if (app.mode === 'solo') {
      html += '<label class="check" style="display:flex;gap:10px;align-items:center;justify-content:center;padding:6px"><input type="checkbox" id="solo-wrap"' + (prefs.soloWrap !== false ? ' checked' : '') + '> König ↔ Ass verbinden (ab nächstem Spiel)</label>' +
        '<button class="btn" data-act="new">Neues Spiel</button>' +
        '<button class="btn" data-act="home">Hauptmenü</button>';
    } else {
      html += '<button class="btn" data-act="leave">Raum verlassen</button>';
    }
    html += '</div>';
    openOverlay(html, 'menu');
    var sw = $('#solo-wrap');
    if (sw) sw.addEventListener('change', function () { prefs.soloWrap = sw.checked; savePrefs(); });
  }

  function confirmGiveUp() {
    openOverlay(
      '<h2>Aufgeben?</h2><p class="subtitle">Deine bisherigen Punkte zählen trotzdem. Du kannst in dieser Runde aber keine Karten mehr legen.</p>' +
      '<div class="actions"><button class="btn" data-act="close">Weiterspielen</button><button class="btn accent" data-act="giveup">Aufgeben</button></div>',
      'confirm'
    );
  }

  $('#overlay').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) {
      if (e.target.id === 'overlay' && (overlayKind === 'rules' || overlayKind === 'menu' || overlayKind === 'confirm')) closeOverlay();
      return;
    }
    var act = b.dataset.act;
    if (act === 'close') closeOverlay();
    else if (act === 'rules') showRules();
    else if (act === 'new') startSolo();
    else if (act === 'replay') startSolo(app.soloSeed);
    else if (act === 'home') { closeOverlay(); app.mode = null; app.game = null; showScreen('home'); }
    else if (act === 'leave') { closeOverlay(); net.leave(); }
    else if (act === 'giveup') { closeOverlay(); net.send({ t: 'giveup' }); app.locked = true; render(); showWaiting(); }
    else if (act === 'next') net.send({ t: 'start' });
    else if (act === 'lobby') net.send({ t: 'lobby' });
    else if (act === 'peek') { closeOverlay(); app.peeking = true; }
  });

  // ------------------------------------------------------------------
  // Mehrspieler
  // ------------------------------------------------------------------
  var net = {
    ws: null,
    id: null,
    token: null,
    code: null,
    room: null,
    offset: 0,
    queue: [],
    retry: 0,
    wantConnected: false,
    pendingJoin: null,

    url: function () {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    },

    connect: function (joinMsg) {
      if (location.protocol === 'file:') {
        $('#home-error').textContent = 'Für Mehrspieler muss der Server laufen (node server.js).';
        return;
      }
      this.wantConnected = true;
      this.pendingJoin = joinMsg;
      this.open();
    },

    open: function () {
      var self = this;
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
        if (this.ws.readyState === 1 && this.pendingJoin) { this.ws.send(JSON.stringify(this.pendingJoin)); this.pendingJoin = null; }
        return;
      }
      var ws;
      try { ws = window.STRoom ? window.STRoom.create() : new WebSocket(this.url()); } catch (e) { return this.failed(); }
      this.ws = ws;
      ws.onopen = function () {
        self.retry = 0;
        $('#conn').classList.add('hidden');
        var join = self.pendingJoin;
        if (!join && self.code && self.token) join = { t: 'join', code: self.code, token: self.token, name: myName() };
        self.pendingJoin = null;
        if (join) ws.send(JSON.stringify(join));
        while (self.queue.length) ws.send(JSON.stringify(self.queue.shift()));
      };
      ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        self.handle(msg);
      };
      ws.onclose = function (e) {
        if (self.ws !== ws) return;
        self.ws = null;
        if (e.code === 4000) { toast('In einem anderen Tab geöffnet.'); self.wantConnected = false; return; }
        if (e.code === 4001) {
          self.reset();
          showScreen('home');
          $('#home-error').textContent = window.ST_STATIC
            ? 'Der Mehrspieler-Dienst ist gerade nicht erreichbar. Prüfe deine Internetverbindung und lade die Seite neu.'
            : 'Mehrspieler ist in dieser Ansicht nicht verfügbar. Melde dich bei claude.ai an und öffne die Seite dort.';
          return;
        }
        if (!self.wantConnected) return;
        if (!self.code) return self.failed();
        $('#conn').classList.remove('hidden');
        var delay = Math.min(8000, 500 * Math.pow(2, self.retry++));
        setTimeout(function () { if (self.wantConnected) self.open(); }, delay);
      };
    },

    failed: function () {
      this.wantConnected = false;
      $('#home-error').textContent = 'Keine Verbindung zum Server. Läuft „node server.js“?';
    },

    send: function (msg) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
      else if (msg.t === 'move' || msg.t === 'giveup') this.queue.push(msg);
    },

    leave: function () {
      this.send({ t: 'leave' });
      this.reset();
      app.mode = null;
      app.game = null;
      closeOverlay();
      showScreen('home');
      if (!CODE_ONLY) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }
    },

    reset: function () {
      this.wantConnected = false;
      this.code = null;
      this.token = null;
      this.id = null;
      this.room = null;
      this.queue = [];
      session(null);
      $('#conn').classList.add('hidden');
      var ws = this.ws;
      this.ws = null;
      if (ws) setTimeout(function () { try { ws.close(); } catch (e) { /* ignore */ } }, 100);
    },

    handle: function (msg) {
      if (msg.now) this.offset = msg.now - Date.now();
      switch (msg.t) {
        case 'welcome':
          this.id = msg.id;
          this.token = msg.token;
          this.code = msg.code;
          session({ code: msg.code, token: msg.token });
          if (!CODE_ONLY) { try { history.replaceState(null, '', '?room=' + msg.code); } catch (e) { /* ignore */ } }
          $('#home-error').textContent = '';
          $('#toast').classList.remove('show');
          break;
        case 'error':
          $('#home-error').textContent = msg.msg;
          if (!this.id) {
            this.reset();
            showScreen('home');
          } else toast(msg.msg);
          break;
        case 'room':
          this.room = msg;
          onRoom(msg);
          break;
        case 'start':
        case 'resync':
          startMulti(msg);
          break;
        case 'emote':
          showEmote(msg);
          break;
        case 'left':
          break;
      }
    }
  };

  function myName() {
    var n = ($('#name-input').value || prefs.name || '').trim();
    return n || 'Pilot';
  }

  function me() {
    if (!net.room) return null;
    for (var i = 0; i < net.room.players.length; i++) if (net.room.players[i].id === net.id) return net.room.players[i];
    return null;
  }
  function isHost() { return net.room && net.room.hostId === net.id; }

  function setGameChrome() {
    var multi = app.mode === 'multi';
    $('#opponents').classList.toggle('show', multi);
    $('#emotes').classList.toggle('show', multi);
    $('#hud-round-wrap').style.display = multi ? '' : 'none';
    $('#hud-time-wrap').style.display = multi ? '' : 'none';
    $('#btn-new').style.display = multi ? 'none' : '';
    $('#btn-giveup').style.display = multi ? '' : 'none';
  }

  function startMulti(msg) {
    app.mode = 'multi';
    app.game = G.newGame(msg.seed, { wrap: msg.wrap });
    (msg.moves || []).forEach(function (m) { G.applyMove(app.game, m); });
    app.game.history = [];
    app.locked = app.game.status !== 'playing' || !!msg.done;
    app.endShown = false;
    app.peeking = false;
    if (msg.t === 'start') {
      closeOverlay();
      if (!msg.moves || !msg.moves.length) toast('Runde ' + msg.round + ' – los geht’s!');
    }
    setGameChrome();
    showScreen('game');
    buildBoard();
    if (app.locked && net.room && net.room.phase === 'playing') showWaiting();
  }

  function onRoom(room) {
    var p = me();
    if (room.phase === 'lobby') {
      app.game = null;
      app.mode = 'multi';
      if (overlayKind !== 'rules') closeOverlay();
      showScreen('lobby');
      renderLobby(room);
      return;
    }
    if (room.phase === 'playing') {
      if (p && (p.status === 'waiting' || p.status === 'out')) {
        if (p.status === 'waiting' && !$('#screen-lobby').classList.contains('active') && !app.game) showScreen('lobby');
        if (p.status === 'waiting') renderLobby(room);
        else if (app.game) { app.locked = true; render(); renderOpponents(room); }
        showWaiting(p.status === 'out' ? 'out' : true);
        return;
      }
      if (p && p.status === 'done' && app.game && !app.locked) {
        app.locked = true;
        render();
      }
      renderOpponents(room);
      if (overlayKind === 'waiting') showWaiting();
      return;
    }
    // results / final
    app.locked = true;
    if (app.game) render();
    renderOpponents(room);
    showResults(room);
  }

  function renderLobby(room) {
    $('#lobby-code').textContent = room.code;
    var link = CODE_ONLY
      ? 'Schick deinen Freunden den Link zu dieser Seite und den Code ' + room.code + '.'
      : location.origin + location.pathname + '?room=' + room.code;
    $('#copy-hint').textContent = link;
    $('#btn-copy').textContent = CODE_ONLY ? 'Code kopieren' : 'Einladungslink kopieren';
    $('#lobby-count').textContent = '(' + room.players.length + '/8)';
    $('#lobby-players').innerHTML = room.players.map(function (p) {
      return '<li><span class="dot' + (p.connected ? '' : ' off') + '"></span>' +
        esc(p.name) + (p.id === net.id ? ' <span class="me">(du)</span>' : '') +
        '<span class="tag">' + (p.host ? '👑 Host' : p.connected ? 'bereit' : 'offline') + '</span></li>';
    }).join('');
    var host = isHost();
    var s = room.settings;
    $('#set-rounds').value = String(s.rounds);
    $('#set-time').value = String(s.timeLimit);
    $('#set-wrap').checked = !!s.wrap;
    ['#set-rounds', '#set-time', '#set-wrap'].forEach(function (sel) { $(sel).disabled = !host; });
    var startBtn = $('#btn-start');
    startBtn.style.display = host ? '' : 'none';
    var hint = '';
    if (!host) hint = 'Warte, bis der Host das Spiel startet …';
    else if (room.players.length < 2) hint = 'Teile den Code mit deinen Freunden. Du kannst auch allein starten.';
    if (room.phase !== 'lobby') hint = 'Ein Turnier läuft gerade. Du spielst beim nächsten Turnier mit und kannst so lange zuschauen.';
    else if (room.players.length >= 3) (function () {
      var er = G.eliminationRounds(room.players.length, s.rounds);
      if (!er.length) return;
      var list = er.length === 1 ? 'Runde ' + er[0] : 'den Runden ' + er.slice(0, -1).join(', ') + ' und ' + er[er.length - 1];
      hint += (hint ? ' ' : '') + '💀 Bei ' + room.players.length + ' Spielern scheidet nach ' + list + ' jeweils der Spieler mit den wenigsten Gesamtpunkten aus.';
    })();
    $('#lobby-hint').textContent = hint;
  }

  function sendSettings() {
    if (!isHost()) return;
    net.send({ t: 'settings', settings: { rounds: +$('#set-rounds').value, timeLimit: +$('#set-time').value, wrap: $('#set-wrap').checked } });
  }
  ['#set-rounds', '#set-time', '#set-wrap'].forEach(function (sel) { $(sel).addEventListener('change', sendSettings); });

  function statusText(p) {
    if (!p.connected) return ['offline', 'off'];
    if (p.status === 'out' || p.eliminated) return ['💀 raus', 'off'];
    if (p.status === 'waiting') return ['schaut zu', ''];
    if (p.result === 'won') return ['geschafft!', 'won'];
    if (p.gaveUp) return ['aufgegeben', 'stuck'];
    if (p.result === 'stuck') return ['keine Züge', 'stuck'];
    if (p.status === 'done') return ['fertig', ''];
    return ['spielt', ''];
  }

  function renderOpponents(room) {
    var list = room.players.slice().filter(function (p) { return p.status !== 'waiting' && !p.eliminated; });
    list.sort(function (a, b) { return b.score - a.score || a.remaining - b.remaining; });
    list = list.concat(room.players.filter(function (p) { return p.eliminated; }));
    var html = list.map(function (p) {
      var st = statusText(p);
      var pct = Math.round(((28 - p.remaining) / 28) * 100);
      return '<div class="opp' + (p.id === net.id ? ' me' : '') + (p.eliminated ? ' out' : '') + '" data-pid="' + p.id + '">' +
        '<div class="top"><span class="name">' + esc(p.name) + (p.host ? ' 👑' : '') + '</span><span class="score">' + fmt(p.score) + '</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="meta"><span>' + p.remaining + ' übrig · Stapel ' + p.stock + '</span><span class="state ' + st[1] + '">' + st[0] + '</span></div>' +
        '</div>';
    }).join('');
    $('#opponents').innerHTML = html;
    var skull = (room.elimRounds || []).indexOf(room.round) !== -1 && room.phase === 'playing';
    $('#hud-round').textContent = room.round + '/' + room.settings.rounds + (skull ? ' 💀' : '');
    $('#hud-round').title = skull ? 'Nach dieser Runde scheidet der Letzte aus' : '';
  }

  // Endstand: Wer bis zum Schluss dabei war vor den Ausgeschiedenen,
  // Ausgeschiedene nach Zeitpunkt (später = besser), dann Punkte.
  function finalRanking(room) {
    return room.players.filter(function (p) { return p.roundScores && p.roundScores.length; })
      .sort(function (a, b) {
        var ea = a.eliminated || Infinity;
        var eb = b.eliminated || Infinity;
        return eb - ea || b.total - a.total;
      });
  }

  function nextSkull(room) {
    var next = (room.elimRounds || []).filter(function (r) { return r > room.round; })[0];
    return next ? '💀 Nächster Totenkopf: nach Runde ' + next : '';
  }

  function standingsTable(rows, opts) {
    opts = opts || {};
    var medals = ['🥇', '🥈', '🥉'];
    return '<table class="results"><thead><tr><th></th><th>Spieler</th><th>' + (opts.totalOnly ? 'Gesamt' : 'Runde') + '</th>' +
      (opts.showTotal ? '<th>Gesamt</th>' : '') + (opts.totalOnly ? '' : '<th>Rest</th>') + '</tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr class="' + (r.id === net.id ? 'me' : '') + '"><td class="medal">' + (medals[i] || (i + 1) + '.') + '</td>' +
          '<td>' + esc(r.name) + (r.result === 'won' ? ' 🚀' : '') + (r.eliminated ? ' 💀' : '') + '</td>' +
          '<td>' + fmt(opts.totalOnly ? r.total : r.score) + '</td>' +
          (opts.showTotal ? '<td>' + fmt(r.total) + '</td>' : '') +
          (opts.totalOnly ? '' : '<td>' + r.remaining + '</td>') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function showWaiting(spectator) {
    var room = net.room;
    if (!room || room.phase !== 'playing') return;
    if (app.peeking && !spectator) return;
    var g = app.game;
    var rows = room.players.filter(function (p) { return p.status !== 'waiting' && p.status !== 'out'; })
      .sort(function (a, b) { return b.score - a.score || a.remaining - b.remaining; });
    var playing = rows.filter(function (p) { return p.status === 'playing' && p.connected; }).length;
    var head;
    if (spectator === 'out') head = '<h2>💀 Ausgeschieden</h2><p class="subtitle">Du schaust bis zum Ende des Turniers zu. Runde ' + room.round + ' von ' + room.settings.rounds + '.</p>';
    else if (spectator) head = '<h2>Turnier läuft</h2><p class="subtitle">Du spielst beim nächsten Turnier mit. Runde ' + room.round + ' von ' + room.settings.rounds + '.</p>';
    else if (g && g.status === 'won') head = '<h2>🚀 Geschafft!</h2><div class="big-score">' + fmt(g.score) + '</div>';
    else head = '<h2>' + (g && g.status === 'stuck' ? 'Keine Züge mehr' : 'Fertig') + '</h2><div class="big-score">' + fmt(g ? g.score : 0) + '</div>';
    openOverlay(
      head +
      '<p class="subtitle">' + (playing ? 'Warte auf ' + playing + (playing === 1 ? ' Spieler' : ' Spieler') + ' …' : 'Runde wird ausgewertet …') + '</p>' +
      '<h3>Zwischenstand</h3>' + standingsTable(rows) +
      '<div class="actions">' + (spectator ? '' : '<button class="btn" data-act="peek">Brett ansehen</button>') + '<button class="btn" data-act="leave">Raum verlassen</button></div>',
      'waiting'
    );
  }

  function showResults(room) {
    var final = room.phase === 'final';
    var res = room.lastResults || [];
    var host = isHost();
    var html;
    if (final) {
      var totals = finalRanking(room);
      var winner = totals[0];
      var tie = totals.length > 1 && totals[1].total === winner.total && !totals[1].eliminated && !winner.eliminated;
      if (overlayKind !== 'final') { sfx.win(); setTimeout(celebrate, 200); }
      html = '<h2>🏆 ' + (!winner ? 'Spiel vorbei' : tie ? 'Unentschieden!' : esc(winner.name) + ' gewinnt!') + '</h2>' +
        (room.settings.rounds > 1 ? '<p class="subtitle">Endstand nach ' + room.settings.rounds + ' Runden</p>' : '') +
        standingsTable(totals, { totalOnly: true }) +
        (room.settings.rounds > 1 ? '<h3>Letzte Runde</h3>' + standingsTable(res) : '');
      html += '<div class="actions">' +
        (host ? '<button class="btn primary" data-act="lobby">Neues Turnier</button>' : '<p class="subtitle">Warte auf den Host …</p>') +
        '<button class="btn" data-act="leave">Raum verlassen</button></div>';
      openOverlay(html, 'final');
    } else {
      var outRow = res.filter(function (r) { return r.eliminated; })[0];
      html = '<h2>Runde ' + room.round + ' von ' + room.settings.rounds + '</h2>' +
        (res[0] ? '<p class="subtitle">' + (res[1] && res[1].score === res[0].score && res[1].remaining === res[0].remaining ? 'Gleichstand an der Spitze!' : 'Rundensieg: <b>' + esc(res[0].name) + '</b>') + '</p>' : '') +
        (outRow ? '<p class="skull-note">💀 <b>' + esc(outRow.name) + '</b> hat die wenigsten Gesamtpunkte und scheidet aus' + (outRow.id === net.id ? '. Du schaust ab jetzt zu.' : '.') + '</p>' : '') +
        standingsTable(res, { showTotal: true }) +
        (nextSkull(room) ? '<p class="subtitle small">' + nextSkull(room) + '</p>' : '') +
        '<div class="actions">' +
        (host ? '<button class="btn primary" data-act="next">Nächste Runde</button>' : '<p class="subtitle">Warte auf den Host …</p>') +
        '<button class="btn" data-act="leave">Raum verlassen</button></div>';
      openOverlay(html, 'results');
    }
  }

  function showEmote(msg) {
    var el = document.querySelector('.opp[data-pid="' + msg.id + '"]');
    if (el) {
      var b = document.createElement('span');
      b.className = 'bubble';
      b.textContent = msg.e;
      el.appendChild(b);
      setTimeout(function () { b.remove(); }, 1700);
    }
    if (msg.id !== net.id) toast(msg.name + ' ' + msg.e, 1400);
    sfx.pop();
  }

  $('#emotes').addEventListener('click', function (e) {
    var b = e.target.closest('[data-e]');
    if (b) net.send({ t: 'emote', e: b.dataset.e });
  });

  // Countdown
  var lastTickSec = -1;
  setInterval(function () {
    var room = net.room;
    if (app.mode !== 'multi' || !room || room.phase !== 'playing') return;
    var el = $('#hud-time');
    if (!room.endsAt) { el.textContent = '∞'; el.classList.remove('low'); return; }
    var left = room.endsAt - (Date.now() + net.offset) - 1500;
    el.textContent = fmtTime(left);
    var secs = Math.ceil(left / 1000);
    el.classList.toggle('low', left < 15000);
    if (left < 10000 && left > 0 && secs !== lastTickSec && !app.locked) { lastTickSec = secs; sfx.tick(); }
  }, 200);

  // ------------------------------------------------------------------
  // Startbildschirm & Steuerung
  // ------------------------------------------------------------------
  var nameInput = $('#name-input');
  nameInput.value = prefs.name || '';
  nameInput.addEventListener('change', function () {
    prefs.name = nameInput.value.trim();
    savePrefs();
  });

  $('#btn-solo').addEventListener('click', function () { ctx(); prefs.name = nameInput.value.trim(); savePrefs(); startSolo(); });
  $('#btn-create').addEventListener('click', function () {
    ctx();
    prefs.name = nameInput.value.trim();
    savePrefs();
    $('#home-error').textContent = '';
    net.connect({ t: 'create', name: myName() });
  });
  function join() {
    ctx();
    var code = $('#code-input').value.trim().toUpperCase();
    if (code.length !== 4) { $('#home-error').textContent = 'Bitte gib den 4-stelligen Raumcode ein.'; return; }
    prefs.name = nameInput.value.trim();
    savePrefs();
    $('#home-error').textContent = '';
    net.connect({ t: 'join', code: code, name: myName() });
  }
  $('#btn-join').addEventListener('click', join);
  $('#code-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });
  $('#code-input').addEventListener('input', function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#btn-rules').addEventListener('click', showRules);

  $('#btn-copy').addEventListener('click', function () {
    var link = CODE_ONLY ? net.code : $('#copy-hint').textContent;
    function ok() { toast(CODE_ONLY ? 'Code ' + net.code + ' kopiert' : 'Link kopiert – schick ihn deinen Freunden!'); }
    if (!CODE_ONLY && navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      navigator.share({ title: 'Space Towers', text: 'Spiel mit mir Space Towers! Raumcode: ' + net.code, url: link }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(ok, function () { toast('Code: ' + net.code); });
    } else toast('Code: ' + net.code);
  });
  $('#btn-start').addEventListener('click', function () { ctx(); net.send({ t: 'start' }); });
  $('#btn-leave').addEventListener('click', function () { net.leave(); });

  $('#btn-menu').addEventListener('click', showMenu);
  $('#btn-new').addEventListener('click', function () { startSolo(); });
  $('#btn-giveup').addEventListener('click', function () {
    if (!app.locked && app.game && app.game.status === 'playing') confirmGiveUp();
    else showWaiting();
  });

  function syncToggles() {
    $('#btn-sound').textContent = prefs.sound ? '🔊' : '🔇';
  }
  $('#btn-sound').addEventListener('click', function () { prefs.sound = !prefs.sound; savePrefs(); syncToggles(); if (prefs.sound) sfx.pop(); });
  syncToggles();

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (!$('#screen-game').classList.contains('active')) return;
    if (e.key === 'Escape') { if (overlayKind === 'menu' || overlayKind === 'rules' || overlayKind === 'confirm') closeOverlay(); else if (!overlayKind) showMenu(); return; }
    if (overlayKind && overlayKind !== 'waiting') return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onStock(); }
    else if (e.key === 'b' || e.key === 'B') onBonus();
    else if (e.key === 'm' || e.key === 'M') $('#btn-sound').click();
  });

  var resizeRaf = 0;
  addEventListener('resize', function () {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(layout);
  });

  // Einladungslink / Wiederverbinden nach Neuladen
  (function boot() {
    var params = new URLSearchParams(location.search);
    var code = (params.get('room') || '').toUpperCase().slice(0, 4);
    var saved = session();
    if (saved && saved.code && saved.token && (!code || code === saved.code)) {
      net.code = saved.code;
      net.token = saved.token;
      net.connect({ t: 'join', code: saved.code, token: saved.token, name: myName() });
      return;
    }
    if (code) {
      $('#code-input').value = code;
      $('#home-error').textContent = '';
      toast('Du wurdest in Raum ' + code + ' eingeladen. Gib deinen Namen ein und tippe auf „Beitreten“.', 4000);
      setTimeout(function () { nameInput.focus(); }, 300);
    }
  })();
})();
