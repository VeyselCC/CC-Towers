/*
 * Space Towers – Mehrspieler auf statischem Hosting (z. B. GitHub Pages).
 * Stellt eine "room"-Schnittstelle wie auf claude.ai bereit, die per PeerJS
 * (WebRTC) direkt zwischen den Browsern läuft. room-transport.js baut darauf
 * auf, die Spiellogik bleibt dieselbe.
 *
 * Aufbau: Der erste Browser eines Raums belegt die Peer-ID
 * "cctowers-<raum>" und verteilt als Knotenpunkt die Presence aller
 * Spieler. Fällt er weg, übernimmt der nächste Browser die ID.
 *
 * Wird nur aktiv, wenn window.ST_STATIC gesetzt ist und PeerJS geladen wurde.
 */
(function () {
  'use strict';
  if (!window.ST_STATIC || window.claude) return;

  var PREFIX = 'cctowers-v1-';

  function createNamed(name) {
    var hubId = PREFIX + name;
    var handlers = [];
    var peers = new Map(); // label -> {presence, updatedAt}
    var mine = {};
    var myLabel = null;
    var peer = null;
    var isHub = false;
    var hubConn = null; // als Client: Verbindung zum Hub
    var clients = new Map(); // als Hub: label -> DataConnection
    var left = false;
    var notifyPending = false;
    var retryTimer = null;

    function snapshot() {
      var out = [];
      peers.forEach(function (v, label) {
        var me = label === myLabel;
        out.push(Object.freeze({ peer: label, by: null, isMe: me, sameTab: me, kind: 'viewer', guest: false, presence: v.presence, updatedAt: v.updatedAt }));
      });
      return Object.freeze(out);
    }
    function notify() {
      if (notifyPending) return;
      notifyPending = true;
      setTimeout(function () {
        notifyPending = false;
        if (left) return;
        var ps = snapshot();
        handlers.forEach(function (h) { try { h({ peers: ps, joined: [], left: [], updated: [] }); } catch (e) { /* ignore */ } });
      }, 0);
    }
    function setPresence(label, presence) {
      var prev = peers.get(label);
      var same = prev && JSON.stringify(prev.presence) === JSON.stringify(presence);
      peers.set(label, { presence: presence, updatedAt: same ? prev.updatedAt : Date.now() });
      if (!same) notify();
    }

    // ---------- Hub ----------
    function hubBroadcast() {
      var list = [];
      peers.forEach(function (v, label) { list.push({ peer: label, presence: v.presence }); });
      var msg = { type: 'snap', peers: list };
      clients.forEach(function (c) { if (c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } });
    }
    function becomeHub(p) {
      isHub = true;
      peer = p;
      myLabel = hubId;
      peers.clear();
      setPresence(myLabel, mine);
      p.on('connection', function (conn) {
        conn.on('open', function () {
          clients.set(conn.peer, conn);
          hubBroadcast();
        });
        conn.on('data', function (d) {
          if (!d || d.type !== 'p' || typeof d.presence !== 'object') return;
          setPresence(conn.peer, d.presence);
          hubBroadcast();
        });
        var gone = function () {
          clients.delete(conn.peer);
          if (peers.delete(conn.peer)) { notify(); hubBroadcast(); }
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      p.on('disconnected', function () { if (!left) { try { p.reconnect(); } catch (e) { /* ignore */ } } });
      hubBroadcast();
    }

    // ---------- Client ----------
    function becomeClient(resolve, reject) {
      var p = new window.Peer();
      peer = p;
      p.on('open', function (id) {
        myLabel = id;
        var conn = p.connect(hubId, { reliable: true });
        var opened = false;
        conn.on('open', function () {
          opened = true;
          hubConn = conn;
          setPresence(myLabel, mine);
          conn.send({ type: 'p', presence: mine });
          if (resolve) { resolve(); resolve = null; }
        });
        conn.on('data', function (d) {
          if (!d || d.type !== 'snap' || !Array.isArray(d.peers)) return;
          var seen = {};
          d.peers.forEach(function (e) {
            if (!e || typeof e.peer !== 'string') return;
            seen[e.peer] = true;
            if (e.peer === myLabel) return;
            setPresence(e.peer, e.presence || {});
          });
          peers.forEach(function (v, label) { if (!seen[label] && label !== myLabel) { peers.delete(label); notify(); } });
        });
        var lost = function () {
          if (left || hubConn !== conn) return;
          hubConn = null;
          // Hub ist weg: alle anderen vergessen und neu verbinden
          peers.forEach(function (v, label) { if (label !== myLabel) peers.delete(label); });
          notify();
          scheduleRejoin();
        };
        conn.on('close', lost);
        conn.on('error', lost);
        setTimeout(function () { if (!opened && resolve) { resolve(); resolve = null; scheduleRejoin(); } }, 8000);
      });
      p.on('error', function (err) {
        if (err && err.type === 'peer-unavailable') {
          // Kein Hub da: selbst übernehmen
          try { p.destroy(); } catch (e) { /* ignore */ }
          if (resolve) { var r = resolve; resolve = null; start(r, reject); } else scheduleRejoin();
        } else if (resolve) { var rj = reject; resolve = null; rj(err); }
      });
    }

    function start(resolve, reject) {
      if (left) return;
      if (!window.Peer) { reject({ code: 'not_granted', message: 'PeerJS fehlt' }); return; }
      var p = new window.Peer(hubId);
      var settled = false;
      p.on('open', function () {
        if (settled) return;
        settled = true;
        becomeHub(p);
        resolve();
      });
      p.on('error', function (err) {
        if (settled) return;
        if (err && err.type === 'unavailable-id') {
          settled = true;
          try { p.destroy(); } catch (e) { /* ignore */ }
          becomeClient(resolve, reject);
        } else if (err && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error')) {
          settled = true;
          reject({ code: 'upstream_error', message: String(err.type) });
        }
      });
    }

    function scheduleRejoin() {
      if (left) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () {
        if (left) return;
        try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
        clients.clear();
        isHub = false;
        start(function () { notify(); }, function () { scheduleRejoin(); });
      }, 500 + Math.random() * 1500);
    }

    var api = {
      name: name,
      presence: function (patch) {
        var next = {};
        Object.keys(mine).forEach(function (k) { next[k] = mine[k]; });
        Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; });
        mine = next;
        if (myLabel) setPresence(myLabel, mine);
        if (isHub) hubBroadcast();
        else if (hubConn && hubConn.open) { try { hubConn.send({ type: 'p', presence: mine }); } catch (e) { /* ignore */ } }
        return Promise.resolve();
      },
      peers: snapshot,
      onPeers: function (h) {
        handlers.push(h);
        notify();
        return function () { handlers = handlers.filter(function (x) { return x !== h; }); };
      },
      connected: function () { return isHub || !!(hubConn && hubConn.open); },
      leave: function () {
        left = true;
        clearTimeout(retryTimer);
        handlers = [];
        clients.forEach(function (c) { try { c.close(); } catch (e) { /* ignore */ } });
        try { if (hubConn) hubConn.close(); } catch (e) { /* ignore */ }
        try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
        return Promise.resolve();
      }
    };

    return new Promise(function (resolve, reject) {
      start(function () { resolve(api); }, reject);
    });
  }

  var room = { join: function (name) { return createNamed(name); } };
  window.claude = {
    use: function (n) { return Promise.resolve(n === 'room' && window.Peer ? room : null); }
  };
})();
