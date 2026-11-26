/*
 * CEVIRI_AYBARION - Destek masasi (sira, ustlenme, suren gorusmeler)
 *
 * Sunucusuz calisir: mesajlar CEVIRI'nin MQTT araci baglantilari uzerinden
 * siteye ozgu bir "masa" konusuna gider.
 *  - Uye, sira kaydini (ad, soyad, firma, dil, oda kodu, tek kullanimlik oda
 *    anahtari) yonetici acik anahtariyla muhurleyip duzenli yayinlar. Kayidi
 *    yalnizca yoneticiler acabilir.
 *  - Yoneticiler kendi aralarinda (ortak masa anahtariyla sifreli) ustlenme,
 *    suren gorusme ve cevrimici bilgisi paylasir.
 *  - Iki yonetici ayni anda ustlenirse kural: once tiklayan kazanir (esitlikte
 *    kimligi kucuk olan). Asil kilit odadadir: tek kullanimlik anahtarla yalnizca
 *    bir kisi girebilir.
 *
 * pubsub: { subscribe(topic, fn(text)), unsubscribe(topic), publish(topic, text) }
 */
(function (root) {
  'use strict';

  var TICKET_EVERY_MS = 4000;
  var TICKET_TTL_MS = 13000;
  var SESSION_EVERY_MS = 4000;
  var SESSION_TTL_MS = 15000;
  var HERE_EVERY_MS = 8000;
  var HERE_TTL_MS = 20000;
  var CLAIM_WAIT_MS = 900;
  var CLAIM_TTL_MS = 12000;

  function clip(s, n) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  }

  function makeDedupe() {
    var seen = new Map();
    return function (mid) {
      if (!mid) return false;
      if (seen.has(mid)) return true;
      seen.set(mid, Date.now());
      if (seen.size > 1000) {
        var cut = Date.now() - 60000;
        seen.forEach(function (t, k) { if (t < cut) seen.delete(k); });
      }
      return false;
    };
  }

  /** Uye tarafi: sira kaydini yayinlar. */
  function createMemberDesk(opts) {
    var C = root.AybaCrypto;
    var cfg = opts.config;
    var pubsub = opts.pubsub;
    var id = opts.ticketId || C.randomId();
    var t = opts.ticket;
    var timer = null;
    var topic = null;
    var sealed = null;
    var stopped = false;

    function publish(obj) {
      if (!topic) return;
      obj.v = 1;
      obj.mid = C.randomId();
      pubsub.publish(topic, JSON.stringify(obj));
    }

    async function start() {
      topic = await C.deskTopic(cfg);
      sealed = await C.sealForAdmins(cfg.adminPub, {
        name: clip(t.name, 60),
        surname: clip(t.surname, 60),
        company: clip(t.company, 120),
        lang: clip(t.lang, 16),
        code: clip(t.code, 32),
        token: clip(t.token, 64),
        at: Number(t.at) || Date.now(),
      });
      if (stopped) return;
      var send = function () { publish({ k: 't', id: id, s: sealed }); };
      // Yeni baglanan yonetici "kim bekliyor" diye sorar: hemen yanitla
      var lastAsk = 0;
      pubsub.subscribe(topic, function (text) {
        var m;
        try { m = JSON.parse(text); } catch (e) { return; }
        if (m && m.k === 'q' && !stopped && Date.now() - lastAsk > 1000) {
          lastAsk = Date.now();
          setTimeout(send, Math.random() * 400);
        }
      });
      send();
      timer = setInterval(send, TICKET_EVERY_MS);
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      timer = null;
      publish({ k: 'x', id: id });
      var tp = topic;
      setTimeout(function () { if (tp) { publish({ k: 'x', id: id }); pubsub.unsubscribe(tp); } }, 400);
    }

    return { id: id, start: start, stop: stop };
  }

  /** Yonetici tarafi: sirayi, suren gorusmeleri ve diger yoneticileri izler. */
  function createAdminDesk(opts) {
    var C = root.AybaCrypto;
    var cfg = opts.config;
    var pubsub = opts.pubsub;
    var keys = opts.keys; // { priv, deskKey }
    var me = { id: clip(opts.me.id, 64), name: clip(opts.me.name, 80) };
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    var dedupe = makeDedupe();

    var waiting = new Map(); // id -> ticket
    var opening = new Map(); // id -> Promise (muhur aciliyor)
    var sessions = new Map(); // ticket id -> { id, adminId, adminName, name, surname, company, since, seen }
    var claims = new Map(); // ticket id -> [{ adminId, adminName, at, seen }]
    var admins = new Map(); // admin id -> { name, seen }
    var gone = new Map(); // iptal edilen/biten kayitlar: id -> zaman (gec gelen tekrar listeye girmesin)
    var mySession = null; // { id, info, timer }
    var topic = null;
    var timers = [];
    var changeQueued = false;
    var lastHere = 0;

    function changed() {
      if (changeQueued) return;
      changeQueued = true;
      Promise.resolve().then(function () {
        changeQueued = false;
        onChange(snapshot());
      });
    }

    async function sendDesk(payload) {
      if (!topic) return;
      var blob = await C.deskEncrypt(keys.deskKey, payload);
      pubsub.publish(topic, JSON.stringify({ v: 1, k: 'a', mid: C.randomId(), iv: blob.iv, ct: blob.ct }));
    }

    async function onTicket(msg) {
      var id = clip(msg.id, 40);
      if (!id || !msg.s) return;
      if (gone.has(id) || sessions.has(id)) return;
      var cur = waiting.get(id);
      if (cur) {
        cur.seen = Date.now();
        return;
      }
      if (opening.has(id)) return;
      var p = C.openSealed(keys.priv, msg.s).then(function (tk) {
        if (gone.has(id) || sessions.has(id)) return;
        waiting.set(id, {
          id: id,
          name: clip(tk.name, 60),
          surname: clip(tk.surname, 60),
          company: clip(tk.company, 120),
          lang: clip(tk.lang, 16),
          code: clip(tk.code, 32),
          token: clip(tk.token, 64),
          at: Math.min(Number(tk.at) || Date.now(), Date.now()),
          seen: Date.now(),
        });
        changed();
      }).catch(function () { /* baska kurulumun ya da bozuk kayit */ }).then(function () { opening.delete(id); });
      opening.set(id, p);
    }

    function onAdminMessage(d) {
      var now = Date.now();
      var id = clip(d.id, 40);
      var adminId = clip(d.adminId, 64);
      if (adminId) admins.set(adminId, { name: clip(d.adminName, 80), seen: now });
      if (d.op === 'claim' && id) {
        var list = (claims.get(id) || []).filter(function (c) { return c.adminId !== adminId; });
        list.push({ adminId: adminId, adminName: clip(d.adminName, 80), at: Number(d.at) || now, seen: now });
        claims.set(id, list);
      } else if (d.op === 'busy' && id) {
        sessions.set(id, {
          id: id,
          adminId: adminId,
          adminName: clip(d.adminName, 80),
          name: clip(d.name, 60),
          surname: clip(d.surname, 60),
          company: clip(d.company, 120),
          since: Number(d.since) || now,
          seen: now,
        });
        waiting.delete(id);
      } else if (d.op === 'end' && id) {
        sessions.delete(id);
        waiting.delete(id);
        gone.set(id, now);
      }
      changed();
    }

    function onRaw(text) {
      var msg;
      try {
        msg = JSON.parse(text);
      } catch (e) {
        return;
      }
      if (!msg || msg.v !== 1 || dedupe(msg.mid)) return;
      if (msg.k === 't') onTicket(msg);
      else if (msg.k === 'q') {
        // Yeni baglanan yonetici: kendini hemen bildir (cevrimici sayisi icin)
        if (Date.now() - lastHere > 1500) {
          lastHere = Date.now();
          setTimeout(function () { sendDesk({ op: 'here', adminId: me.id, adminName: me.name }); }, Math.random() * 500);
        }
      }
      else if (msg.k === 'x') {
        var id = clip(msg.id, 40);
        gone.set(id, Date.now());
        if (waiting.delete(id)) changed();
      } else if (msg.k === 'a' && msg.iv && msg.ct) {
        C.deskDecrypt(keys.deskKey, msg).then(onAdminMessage).catch(function () {});
      }
    }

    function prune() {
      var now = Date.now();
      var dirty = false;
      waiting.forEach(function (w, id) { if (now - w.seen > TICKET_TTL_MS) { waiting.delete(id); dirty = true; } });
      sessions.forEach(function (s, id) {
        if (mySession && mySession.id === id) return;
        if (now - s.seen > SESSION_TTL_MS) { sessions.delete(id); dirty = true; }
      });
      admins.forEach(function (a, id) { if (now - a.seen > HERE_TTL_MS) { admins.delete(id); dirty = true; } });
      claims.forEach(function (list, id) {
        var keep = list.filter(function (c) { return now - c.seen < CLAIM_TTL_MS; });
        if (keep.length) claims.set(id, keep); else claims.delete(id);
      });
      gone.forEach(function (t, id) { if (now - t > 10 * 60000) gone.delete(id); });
      if (dirty) changed();
    }

    function claimWinner(id) {
      var list = (claims.get(id) || []).slice();
      if (!list.length) return null;
      list.sort(function (a, b) { return a.at - b.at || (a.adminId < b.adminId ? -1 : a.adminId > b.adminId ? 1 : 0); });
      return list[0];
    }

    function snapshot() {
      var now = Date.now();
      var w = [];
      waiting.forEach(function (x) {
        var win = claimWinner(x.id);
        w.push({
          id: x.id, name: x.name, surname: x.surname, company: x.company, lang: x.lang, at: x.at,
          waitedMs: now - x.at,
          claimedBy: win && win.adminId !== me.id ? win.adminName : '',
        });
      });
      w.sort(function (a, b) { return a.at - b.at; });
      var s = [];
      sessions.forEach(function (x) { s.push(Object.assign({ mine: x.adminId === me.id }, x)); });
      s.sort(function (a, b) { return a.since - b.since; });
      var others = 0;
      admins.forEach(function (a, id) { if (id !== me.id) others++; });
      return { waiting: w, sessions: s, adminsOnline: others + 1 };
    }

    async function start() {
      topic = await C.deskTopic(cfg);
      pubsub.subscribe(topic, onRaw);
      var here = function () { sendDesk({ op: 'here', adminId: me.id, adminName: me.name }); };
      here();
      pubsub.publish(topic, JSON.stringify({ v: 1, k: 'q', mid: C.randomId() }));
      timers.push(setInterval(here, HERE_EVERY_MS));
      timers.push(setInterval(prune, 1500));
      changed();
    }

    /**
     * Bekleyeni ustlenmeyi dener. Kazanirsa bileti (oda kodu ve anahtari ile)
     * verir; baskasi aldiysa { lost: true, by: ad } doner.
     */
    async function claim(id) {
      var tk = waiting.get(id);
      if (!tk || sessions.has(id)) return { lost: true, by: sessions.has(id) ? sessions.get(id).adminName : '' };
      var win = claimWinner(id);
      if (win && win.adminId !== me.id && Date.now() - win.seen < CLAIM_TTL_MS) return { lost: true, by: win.adminName };
      var at = Date.now();
      var mine = { adminId: me.id, adminName: me.name, at: at, seen: at };
      claims.set(id, (claims.get(id) || []).filter(function (c) { return c.adminId !== me.id; }).concat([mine]));
      await sendDesk({ op: 'claim', id: id, adminId: me.id, adminName: me.name, at: at });
      await new Promise(function (r) { setTimeout(r, CLAIM_WAIT_MS); });
      win = claimWinner(id);
      if (sessions.has(id) && sessions.get(id).adminId !== me.id) return { lost: true, by: sessions.get(id).adminName };
      if (!win || win.adminId !== me.id) return { lost: true, by: win ? win.adminName : '' };
      return { ticket: Object.assign({}, tk) };
    }

    /** Gorusme basladi: diger yoneticiler "dolu" olarak gorur. */
    function beginSession(ticket) {
      endSession(true);
      var info = {
        op: 'busy', id: ticket.id, adminId: me.id, adminName: me.name,
        name: ticket.name, surname: ticket.surname, company: ticket.company, since: Date.now(),
      };
      var send = function () { sendDesk(info); };
      mySession = { id: ticket.id, info: info, timer: setInterval(send, SESSION_EVERY_MS) };
      onAdminMessage(info);
      send();
    }

    /** Bu yoneticinin gorusmesi bitti. */
    function endSession(silent) {
      if (!mySession) return;
      clearInterval(mySession.timer);
      var id = mySession.id;
      mySession = null;
      var msg = { op: 'end', id: id, adminId: me.id, adminName: me.name };
      onAdminMessage(msg);
      sendDesk(msg);
      if (!silent) setTimeout(function () { sendDesk(msg); }, 500);
    }

    /** Basarisiz ustlenmeden sonra (or. oda anahtari baskasina gitmis) birakir. */
    function release(id) {
      var list = (claims.get(id) || []).filter(function (c) { return c.adminId !== me.id; });
      if (list.length) claims.set(id, list); else claims.delete(id);
      changed();
    }

    function stop() {
      endSession();
      timers.forEach(clearInterval);
      timers = [];
      if (topic) pubsub.unsubscribe(topic);
    }

    return {
      start: start,
      stop: stop,
      claim: claim,
      release: release,
      beginSession: beginSession,
      endSession: endSession,
      snapshot: snapshot,
    };
  }

  root.AybaDesk = { createMemberDesk: createMemberDesk, createAdminDesk: createAdminDesk };
})(typeof window !== 'undefined' ? window : globalThis);
