/*
 * CEVIRI - Sunucusuz Online Oda Modu
 *
 * Masaustu surumde odalari server.js yonetir (/api/rooms..., SSE /events).
 * Telefonda sunucu olmadigi icin bu dosya ayni HTTP/SSE arayuzunu tarayici
 * icinde taklit eder ve cihazlar arasi iletisimi herkese acik ucretsiz MQTT
 * araci (broker) uzerinden yapar. app.js'in oda kodu degismeden calisir.
 *
 * Guvenlik: Oda kodu hem konu (topic) adinin hem de sifreleme anahtarinin
 * kaynagidir. Konu adi kodun SHA-256 ozetidir (kod gorunmez), tum mesajlar
 * AES-GCM ile sifrelenir: araci veya ayni konuyu dinleyen biri icerigi okuyamaz.
 *
 * Dayaniklilik: Ayni anda birden fazla araciya baglanilir, her mesaj hepsine
 * gonderilir, gelenler mesaj kimligiyle tekillestirilir. Biri cokerse oteki calisir.
 *
 * Kullanim: window.CeviriRelay.install({ translate }) - translate(text, src, tgt)
 * => Promise<{ translatedText, latencyMs }>
 */
(function () {
  'use strict';

  var BROKERS = window.CEVIRI_BROKERS || [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
  ];
  var TOPIC_PREFIX = 'ceviri/v1/';
  var KDF_SALT = 'ceviri-relay-v1';
  var HEARTBEAT_MS = 8000;
  var PARTICIPANT_TTL_MS = 25000;
  var HISTORY_LIMIT = 50;
  var MAX_PARTICIPANTS = 6;
  var COLOR_COUNT = 6; // sari, kirmizi, lacivert, gri, koyu yesil, pembe
  var INVITE_LIMIT = 200; // saklanan davet sayisi
  var INVITE_VERDICT_MS = 5000; // gecersiz link karari icin bekleme // odada en fazla 6 kisi
  var GROUP_MIN = 3; // 3+ kisi: soz sirasi (bas-konus), cevirmeyi her alici yapar
  // Uctan uca sifrelenen (yalnizca kabul edilenlerin okuyabilecegi) mesaj turleri.
  // Bunlarin disindakiler (presence/hello/leave/invite/approve/keyshare) el sikisma
  // katmanidir ve oda kodundan turetilen anahtarla sarilir.
  var CONTENT_TYPES = { chat: 1, history: 1, 'file-meta': 1, 'file-chunk': 1, 'file-req': 1, mic: 1, hand: 1, cam: 1, mute: 1, rtc: 1 };
  var ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function sanitizeRoomCode(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  }

  function generateRoomCode() {
    var out = '';
    var rnd = new Uint32Array(8);
    crypto.getRandomValues(rnd);
    for (var i = 0; i < 8; i++) out += ROOM_CODE_CHARS[rnd[i] % ROOM_CODE_CHARS.length];
    return out;
  }

  function randomId() {
    var b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  // Uygulama (APK / bilgisayar surumu) mi, linkle acilan misafir sayfasi mi?
  function isAppClient() {
    var cap = window.Capacitor;
    // Canli destek: uye odayi kurar (oda sahibi), yonetici tek kullanimlik anahtarla girer
    if (window.AYBA_ROLE) return window.AYBA_ROLE === 'member';
    return Boolean(cap && cap.isNativePlatform && cap.isNativePlatform()) || Boolean(window.CEVIRI_DESKTOP);
  }

  function randomToken() {
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function sha256hex(str) {
    return crypto.subtle.digest('SHA-256', enc.encode(String(str))).then(toHex);
  }

  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function b64(bytes) {
    var s = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  function unb64(str) {
    var s = atob(str);
    var arr = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
    return arr;
  }

  var enc = new TextEncoder();
  var dec = new TextDecoder();

  async function deriveRoomSecrets(code) {
    var topicHash = await crypto.subtle.digest('SHA-256', enc.encode('topic:' + code));
    var baseKey = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(KDF_SALT), iterations: 100000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return { topic: TOPIC_PREFIX + toHex(topicHash).slice(0, 40), key: key };
  }

  async function seal(key, obj) {
    var iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
  }

  async function open(key, text) {
    var env = JSON.parse(text);
    if (!env || env.v !== 1) throw new Error('bad envelope');
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
    return JSON.parse(dec.decode(pt));
  }

  // --- Uctan uca icerik anahtari: oda kodundan TURETILMEZ, oda sahibi uretir ve
  // yalnizca kabul ettigi kisiye ECDH ile sarip gonderir. Linki ele geciren biri
  // (kirilmis uygulamayla bile) bu anahtari alamaz, yani konusmalari okuyamaz. ---
  function genEcdh() {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  }
  function exportEcdhPub(pub) {
    return crypto.subtle.exportKey('raw', pub).then(function (b) { return b64(b); });
  }
  function importEcdhPub(str) {
    return crypto.subtle.importKey('raw', unb64(str), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  }
  function ecdhSecretKey(priv, pub) {
    return crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256).then(function (bits) {
      return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function genContentKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  function exportRawKey(key) { return crypto.subtle.exportKey('raw', key).then(function (b) { return b64(b); }); }
  function importRawKey(str) { return crypto.subtle.importKey('raw', unb64(str), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
  async function encBlob(key, obj) {
    var iv = new Uint8Array(12); crypto.getRandomValues(iv);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decBlob(key, ivB64, ctB64) {
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
    return JSON.parse(dec.decode(pt));
  }

  // ---------------------------------------------------------------------------
  // Araci baglantilari (tum odalar icin ortak)
  // ---------------------------------------------------------------------------
  var transport = {
    clients: [],
    started: false,
    startedAt: 0,
    subscriptions: {}, // topic -> handler(payloadString)
    seen: new Map(),

    start: function () {
      if (this.started) return;
      this.started = true;
      this.startedAt = Date.now();
      var self = this;
      var mqttLib = window.mqtt;
      if (!mqttLib || typeof mqttLib.connect !== 'function') {
        this.error = 'MQTT kutuphanesi yuklenemedi';
        return;
      }
      BROKERS.forEach(function (url) {
        var c;
        try {
          c = mqttLib.connect(url, {
            clientId: 'ceviri_' + randomId(),
            clean: true,
            keepalive: 30,
            reconnectPeriod: 3000,
            connectTimeout: 10000,
            protocolVersion: 4,
            timerVariant: 'native', // Worker tabanli zamanlayici yerine (WebView'de daha guvenli)
          });
        } catch (e) {
          return;
        }
        c.on('connect', function () {
          Object.keys(self.subscriptions).forEach(function (t) { c.subscribe(t, { qos: 0 }); });
          self.emitStatus();
        });
        c.on('close', function () { self.emitStatus(); });
        c.on('offline', function () { self.emitStatus(); });
        c.on('error', function () { /* yeniden baglanma otomatik */ });
        c.on('message', function (topic, payload) {
          var h = self.subscriptions[topic];
          if (h) h(typeof payload === 'string' ? payload : dec.decode(payload));
        });
        self.clients.push(c);
      });
    },

    connectedCount: function () {
      return this.clients.filter(function (c) { return c.connected; }).length;
    },

    statusListeners: [],
    emitStatus: function () {
      this.statusListeners.forEach(function (fn) { try { fn(); } catch (e) { /* yoksay */ } });
    },

    subscribe: function (topic, handler) {
      this.start();
      this.subscriptions[topic] = handler;
      this.clients.forEach(function (c) { if (c.connected) c.subscribe(topic, { qos: 0 }); });
    },

    unsubscribe: function (topic) {
      delete this.subscriptions[topic];
      this.clients.forEach(function (c) { if (c.connected) c.unsubscribe(topic); });
    },

    publish: function (topic, text) {
      var sent = 0;
      this.clients.forEach(function (c) {
        if (c.connected) { c.publish(topic, text, { qos: 0 }); sent++; }
      });
      return sent;
    },

    // Ayni mesaj birden fazla aracidan gelir: kimlikle tekillestir
    isDuplicate: function (mid) {
      if (this.seen.has(mid)) return true;
      this.seen.set(mid, Date.now());
      if (this.seen.size > 2000) {
        var cutoff = Date.now() - 120000;
        this.seen.forEach(function (t, k, m) { if (t < cutoff) m.delete(k); });
      }
      return false;
    },
  };

  // ---------------------------------------------------------------------------
  // Oda oturumu: sunucudaki "room" + bu cihazin "participant" kaydi
  // ---------------------------------------------------------------------------
  var rooms = {}; // code -> RoomSession
  var translateFn = null;

  function RoomSession(code) {
    this.code = code;
    this.ready = null; // Promise<secrets>
    this.secrets = null;
    this.self = null; // {clientId,name,lang,joinedAt}
    this.participants = new Map(); // clientId -> {clientId,name,lang,joinedAt,lastSeen}
    this.messages = [];
    this.activeMic = null; // {clientId, ts}
    this.sink = null; // FakeEventSource
    this.heartbeat = null;
    this.locked = false; // oda sahibi yeni katilimi kapattiysa
    this.allowed = new Set(); // kilitliyken odada kalabilecekler
    this.kicked = new Set(); // oda sahibinin cikardiklari
    this.outFiles = new Map(); // bu cihazin gonderdigi dosyalar: id -> { meta, bytes }
    this.inFiles = new Map(); // gelen dosyalar: id -> { meta, parts, got, blob, ... }
    this.fileMetas = []; // odadaki dosyalarin listesi (gec gelenlere gecmis olarak gider)
    this.fileTimer = null;
    // Tek kullanimlik davet linkleri: odadakiler gecerli davetlerin OZETINI
    // bilir (anahtarin kendisini degil); linki ilk kullanan kisiye baglanir
    this.invites = new Set(); // davet anahtari SHA-256 ozetleri
    this.bindings = new Map(); // ozet -> { id: ilk kullananin clientId, at }
    this.approved = new Set(); // oda sahibinin "Kabul et" dedigi (oda sahibinde dogru)
    this.joinStartedAt = 0;
    this.heardApp = false;
    this.contentKey = null; // uctan uca icerik anahtari (kabul edilince gelir)
    this.ecdh = null; // { priv, pub, pubB64 } bu oturumun ECDH anahtar cifti
    this.sharedPk = new Map(); // oda sahibi: clientId -> anahtari gonderdigimiz pk
    this.ownerSynced = false; // oda sahibinin kabul listesini en az bir kez aldik mi
    this._genningKey = false;
    this.pendingEnc = []; // icerik anahtari gelmeden once gelen sifreli mesajlar
    this.loadInviteState();
    var self = this;
    this.ready = Promise.all([
      deriveRoomSecrets(code),
      genEcdh().then(function (kp) {
        return exportEcdhPub(kp.publicKey).then(function (pb) { return { priv: kp.privateKey, pub: kp.publicKey, pubB64: pb }; });
      }),
    ]).then(function (arr) {
      self.secrets = arr[0];
      self.ecdh = arr[1];
      transport.subscribe(self.secrets.topic, function (text) { self.onRaw(text); });
      return arr[0];
    });
  }

  RoomSession.prototype.inviteKey = function () {
    return 'ceviri_inv_' + this.code;
  };

  RoomSession.prototype.loadInviteState = function () {
    try {
      var raw = window.localStorage && window.localStorage.getItem(this.inviteKey());
      if (!raw) return;
      var data = JSON.parse(raw);
      var self = this;
      (data.invites || []).forEach(function (h) { if (typeof h === 'string') self.invites.add(h); });
      (data.approved || []).forEach(function (id) { if (typeof id === 'string') self.approved.add(id); });
      (data.bindings || []).forEach(function (b) {
        if (Array.isArray(b) && typeof b[0] === 'string' && typeof b[1] === 'string') self.bindings.set(b[0], { id: b[1], at: Number(b[2]) || 0 });
      });
    } catch (e) {
      // bozuk kayit: yoksay
    }
  };

  RoomSession.prototype.saveInviteState = function () {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(this.inviteKey(), JSON.stringify({
        invites: Array.from(this.invites).slice(-INVITE_LIMIT),
        bindings: this.bindingList(),
        approved: Array.from(this.approved).slice(-INVITE_LIMIT),
      }));
    } catch (e) {
      // depolama yok
    }
  };

  RoomSession.prototype.bindingList = function () {
    var out = [];
    this.bindings.forEach(function (v, h) { out.push([h, v.id, v.at]); });
    return out.slice(-INVITE_LIMIT);
  };

  // Linki ilk kullanan kazanir; ayni anda gelenlerde once katilan
  RoomSession.prototype.bindInvite = function (hash, id, at) {
    if (!this.invites.has(hash)) return false;
    var cur = this.bindings.get(hash);
    if (cur && (cur.id === id || cur.at < at || (cur.at === at && cur.id < id))) return false;
    this.bindings.set(hash, { id: id, at: at });
    this.saveInviteState();
    return true;
  };

  // Gecerli davet linkinin ilk sahibi mi (kapiya kadar gelebilir)
  // Oda sahibi = en eski uygulama kullanicisi (yoksa en eski kisi). Kabul listesinin
  // tek yetkili kaynagi budur; digerleri bunu aynalar.
  RoomSession.prototype.authOwnerId = function () {
    var bestApp = null, bestAny = null;
    this.participants.forEach(function (p) {
      if (!bestAny || p.joinedAt < bestAny.joinedAt || (p.joinedAt === bestAny.joinedAt && p.clientId < bestAny.clientId)) bestAny = p;
      if (p.app && (!bestApp || p.joinedAt < bestApp.joinedAt || (p.joinedAt === bestApp.joinedAt && p.clientId < bestApp.clientId))) bestApp = p;
    });
    var best = bestApp || bestAny;
    return best ? best.clientId : null;
  };

  // Odayi kuran icerik anahtarini uretir (yalnizca bir kez)
  RoomSession.prototype.ensureContentKey = function () {
    if (this.contentKey || this._genningKey) return;
    if (!this.self || !this.self.creator) return;
    var self = this;
    this._genningKey = true;
    genContentKey().then(function (k) { self.contentKey = k; self._genningKey = false; self.broadcastState(); })
      .catch(function () { self._genningKey = false; });
  };

  // Icerik anahtari gelince, bekleyen sifreli mesajlari sirayla isle
  RoomSession.prototype.drainPending = function () {
    var self = this;
    var pend = this.pendingEnc;
    this.pendingEnc = [];
    var chain = Promise.resolve();
    pend.forEach(function (env) {
      chain = chain.then(function () {
        if (!self.contentKey || !env.mid || transport.isDuplicate(env.mid)) return;
        if (!self.self || env.from === self.self.clientId) return;
        return decBlob(self.contentKey, env.iv, env.ct).then(function (inner) {
          inner.from = env.from; inner.mid = env.mid; inner.ts = env.ts;
          return self.handle(inner);
        }).catch(function () {});
      });
    });
    return chain;
  };

  // Oda sahibi: kabul ettigi kisiye icerik anahtarini ECDH ile sarip gonderir
  RoomSession.prototype.shareKeyTo = function (member) {
    if (!this.contentKey || !this.ecdh || !member || !member.pk) return Promise.resolve();
    if (member.clientId === (this.self && this.self.clientId)) return Promise.resolve();
    if (this.sharedPk.get(member.clientId) === member.pk) return Promise.resolve();
    var self = this;
    var pkAtShare = member.pk;
    this.sharedPk.set(member.clientId, member.pk);
    return importEcdhPub(member.pk)
      .then(function (pub) { return ecdhSecretKey(self.ecdh.priv, pub); })
      .then(function (wrapKey) { return exportRawKey(self.contentKey).then(function (raw) { return encBlob(wrapKey, { k: raw }); }); })
      .then(function (bl) { return self.send({ type: 'keyshare', to: member.clientId, epk: self.ecdh.pubB64, iv: bl.iv, ct: bl.ct }); })
      .catch(function () { if (self.sharedPk.get(member.clientId) === pkAtShare) self.sharedPk.delete(member.clientId); });
  };

  RoomSession.prototype.holdsInvite = function (p) {
    var b = p && p.tokenHash ? this.bindings.get(p.tokenHash) : null;
    return Boolean(b && b.id === p.clientId);
  };

  // Odaya kabul: odayi kuran kendiliginden; herkes (uygulama ya da link) oda sahibi onayindan gecer
  RoomSession.prototype.isAdmitted = function (p) {
    if (!p) return false;
    if (this.self && p.clientId === this.self.clientId && this.self.creator) return true;
    if (!this.approved.has(p.clientId)) return false;
    return p.app || this.holdsInvite(p);
  };

  // Kapida bekleyenler: gecerli linkle gelmis, henuz kabul edilmemis
  RoomSession.prototype.lobbyList = function () {
    var self = this;
    var selfId = this.self ? this.self.clientId : null;
    return this.allSorted().filter(function (p) {
      if (p.clientId === selfId || self.kicked.has(p.clientId)) return false;
      var rec = self.participants.get(p.clientId);
      if (!rec || self.approved.has(p.clientId)) return false;
      // Kodla giren uygulama kullanicisi ya da gecerli davet linki sahibi kapida bekler
      return rec.app ? true : self.holdsInvite(rec);
    });
  };

  /** Oda sahibi: kapida bekleyeni iceri alir. */
  RoomSession.prototype.approve = function (target) {
    if (!this.self || this.authOwnerId() !== this.self.clientId) return false;
    if (!this.lobbyList().some(function (p) { return p.clientId === target; })) return false;
    this.approved.add(target);
    this.sharedPk.delete(target);
    this.saveInviteState();
    this.send({ type: 'approve', target: target });
    var self = this;
    var rec = this.participants.get(target);
    // ONCE icerik anahtari gonderilir, SONRA gecmis (anahtarsiz gecmis okunamaz)
    var shared = rec ? this.shareKeyTo(rec) : Promise.resolve();
    shared.then(function () {
      if (self.messages.length || self.fileMetas.length) {
        self.send({ type: 'history', messages: self.messages.slice(-HISTORY_LIMIT), files: self.fileMetas.slice(-FILE_HISTORY_LIMIT) });
      }
    });
    this.sendPresence('presence');
    this.broadcastState();
    return true;
  };

  /** Oda sahibi: kapida bekleyeni geri cevirir. */
  RoomSession.prototype.reject = function (target) {
    if (!this.self || this.authOwnerId() !== this.self.clientId || target === this.self.clientId) return false;
    this.send({ type: 'kick', target: target, reason: 'reject' });
    this.applyKick(target);
    return true;
  };

  // Misafir icin davet durumu: ok | pending | used | invalid
  RoomSession.prototype.inviteStatus = function () {
    var me = this.self;
    if (!me) return 'ok';
    if (me.creator) return 'ok'; // odayi kuran
    if (me.token) {
      // Linkle gelen misafir: once davet gecerliligi
      if (me.tokenPending) return 'pending';
      if (!me.tokenHash) return 'invalid';
      var b = this.bindings.get(me.tokenHash);
      if (b && b.id !== me.clientId) return 'used';
      if (!b) {
        if (this.heardApp && Date.now() - this.joinStartedAt > INVITE_VERDICT_MS && !this.invites.has(me.tokenHash)) return 'invalid';
        return 'pending';
      }
    }
    // Gecerli davet sahibi ya da kodla giren uygulama kullanicisi: oda sahibi onayi beklenir
    if (!this.ownerSynced) return 'waiting';
    if (this.approved.has(me.clientId)) return 'ok';
    return 'waiting';
  };

  /** Uygulama kullanicisi: yeni tek kullanimlik davet anahtari uretir. */
  RoomSession.prototype.createInvite = function () {
    if (!this.self || this.authOwnerId() !== this.self.clientId) return '';
    var token = randomToken();
    var self = this;
    sha256hex(token).then(function (h) {
      self.invites.add(h);
      self.saveInviteState();
      if (self.self) self.send({ type: 'invite', h: h });
    });
    return token;
  };

  RoomSession.prototype.absorbInvites = function (msg) {
    var self = this;
    var changed = false;
    if (Array.isArray(msg.invites)) {
      msg.invites.slice(-INVITE_LIMIT).forEach(function (h) {
        if (typeof h === 'string' && h.length === 64 && !self.invites.has(h)) {
          self.invites.add(h);
          changed = true;
        }
      });
    }
    if (Array.isArray(msg.bindings)) {
      msg.bindings.slice(-INVITE_LIMIT).forEach(function (b) {
        if (Array.isArray(b) && typeof b[0] === 'string' && typeof b[1] === 'string') {
          if (self.bindInvite(b[0], b[1], Number(b[2]) || 0)) changed = true;
        }
      });
    }
    if (changed) this.saveInviteState();
  };

  RoomSession.prototype.send = async function (payload) {
    // Odaya kabul edilmeyen (or. baskasinin linkiyle gelen) hicbir sey gonderemez
    var t = payload.type;
    var handshake = t === 'hello' || t === 'presence' || t === 'leave' || t === 'invite' || t === 'approve' || t === 'keyshare';
    if (!handshake && !this.selfAdmitted()) return 0;
    // Icerik mesaji icerik anahtari olmadan gonderilemez (henuz kabul edilmedik)
    if (CONTENT_TYPES[t] && !this.contentKey) return 0;
    // Gonderen bilgisi beklemeden once alinir (leave() hemen self'i siler)
    payload.mid = randomId();
    payload.from = this.self ? this.self.clientId : '';
    payload.ts = Date.now();
    transport.isDuplicate(payload.mid); // kendi yankimizi yok say
    var self = this;
    // Icerik mesajlari once icerik anahtariyla sarilir (sadece kabul edilenler cozer),
    // sonra tum mesajlar oda kodu anahtariyla disardan sifrelenir (rastgele dinleyiciye karsi)
    var inner = this.ready.then(function () {
      if (!CONTENT_TYPES[t]) return payload;
      return encBlob(self.contentKey, payload).then(function (bl) {
        return { type: 'enc', mid: payload.mid, from: payload.from, ts: payload.ts, iv: bl.iv, ct: bl.ct };
      });
    });
    var sealed = Promise.all([this.ready, inner]).then(function (a) { return seal(a[0].key, a[1]); });
    var publish = (this.sendChain || Promise.resolve()).then(function () {
      return sealed.then(function (text) { return transport.publish(self.secrets.topic, text); });
    });
    this.sendChain = publish.catch(function () {});
    return publish;
  };

  // Mesajlar GELDIKLERI SIRAYLA islenir. Sifre cozme asenkron oldugu icin
  // paralel cozulen mesajlar yer degistirebiliyordu (or. goruntu baglantisinda
  // "aday" mesaji "teklif"ten once islenip kayboluyordu).
  RoomSession.prototype.onRaw = function (text) {
    var self = this;
    var decrypted = open(this.secrets.key, text)
      .then(function (env) {
        if (env && env.type === 'enc') {
          // Icerik anahtarimiz henuz yoksa, gelince islemek uzere sakla (broker sirasi degisebilir)
          if (!self.contentKey) {
            if (self.pendingEnc.length < 300 && env.mid && env.from !== (self.self && self.self.clientId)) self.pendingEnc.push(env);
            return null;
          }
          return decBlob(self.contentKey, env.iv, env.ct).then(function (inner) {
            inner.from = env.from; inner.mid = env.mid; inner.ts = env.ts;
            return inner;
          }).catch(function () { return null; });
        }
        if (env && typeof env.token === 'string' && env.token) {
          return sha256hex(env.token.slice(0, 64)).then(function (h) { env.tokenHash = h; return env; });
        }
        return env;
      })
      .catch(function () { return null; });
    this.rawChain = (this.rawChain || Promise.resolve()).then(function () {
      return decrypted.then(function (msg) {
        if (!msg || !msg.mid || transport.isDuplicate(msg.mid)) return;
        if (!self.self || msg.from === self.self.clientId) return;
        return self.handle(msg);
      });
    }).catch(function () {});
  };

  RoomSession.prototype.handle = function (msg) {
    var now = Date.now();
    if (msg.type === 'presence' || msg.type === 'hello') {
      if (this.kicked.has(msg.from)) return; // cikarilan kisi geri gelemez
      if (msg.app === true) this.heardApp = true;
      // Oda kurallari ve davet bilgisi yalnizca kabul edilmis kisilerden ya da oda sahibinden alinir
      var known = this.participants.get(msg.from);
      if (this.isAdmitted(known) || msg.from === this.authOwnerId()) {
        this.absorbRoomRules(msg);
        this.absorbInvites(msg);
      }
      if (this.self && this.kicked.has(this.self.clientId)) return;
      var isNew = !this.participants.has(msg.from);
      var prev = this.participants.get(msg.from);
      this.participants.set(msg.from, {
        clientId: msg.from,
        name: String(msg.name || 'Misafir').slice(0, 40),
        lang: String(msg.lang || 'tr-TR').slice(0, 16),
        joinedAt: msg.joinedAt || now,
        lastSeen: now,
        hand: typeof msg.handTs === 'number' ? msg.handTs : prev ? prev.hand : 0,
        cam: typeof msg.cam === 'boolean' ? msg.cam : prev ? prev.cam : false,
        mute: typeof msg.mute === 'boolean' ? msg.mute : prev ? prev.mute : false,
        color: validColor(msg.color) ? msg.color : prev && validColor(prev.color) ? prev.color : -1,
        app: msg.app === true,
        creator: msg.creator === true,
        pk: typeof msg.pk === 'string' && msg.pk ? msg.pk : prev ? prev.pk : '',
        tokenHash: typeof msg.tokenHash === 'string' ? msg.tokenHash : prev ? prev.tokenHash : '',
      });
      var rec = this.participants.get(msg.from);
      // Oda sahibinin (en eski uygulama kullanicisi) kabul listesini aynala:
      // kimin iceride oldugu yalnizca oda sahibinin kararina gore belirlenir
      var aOwner = this.authOwnerId();
      if (aOwner && this.self && aOwner !== this.self.clientId && msg.from === aOwner && Array.isArray(msg.approved)) {
        this.approved = new Set(msg.approved);
        this.ownerSynced = true;
      }
      if (!rec.app && rec.tokenHash && !this.bindings.has(rec.tokenHash)) this.bindInvite(rec.tokenHash, rec.clientId, rec.joinedAt);
      var admitted = this.isAdmitted(rec);
      if (msg.micActive && admitted) {
        this.applyRemoteMic(msg.from, true, msg.micTs || msg.ts);
      } else if (this.activeMic && this.activeMic.clientId === msg.from) {
        this.activeMic = null;
      }
      if (isNew || msg.type === 'hello') {
        // Yeni gelene kendimizi ve gecmisi hemen bildir
        this.sendPresence('presence');
        var canSee = admitted && this.selfAdmitted() && (!this.locked || this.allowed.has(msg.from));
        if (canSee && (this.messages.length || this.fileMetas.length)) {
          this.send({ type: 'history', messages: this.messages.slice(-HISTORY_LIMIT), files: this.fileMetas.slice(-FILE_HISTORY_LIMIT) });
        }
      }
      this.broadcastState();
      return;
    }

    if (msg.type === 'leave') {
      this.participants.delete(msg.from);
      if (this.activeMic && this.activeMic.clientId === msg.from) this.activeMic = null;
      if (this.self && this.authOwnerId() === this.self.clientId) {
        // Oda sahibi: ayrilan kisiyi kabul listesinden cikarir. Linkle gelen biri
        // tekrar katilmak isterse yeniden "Kabul et" beklenir (bildirim yine gelir).
        if (this.approved.delete(msg.from)) this.saveInviteState();
        this.sharedPk.delete(msg.from);
        this.sendPresence('presence');
      }
      this.broadcastState();
      return;
    }

    if (msg.type === 'kick') {
      // Yalnizca oda sahibinin cikarma istegi gecerlidir
      if (!this.isOwner(msg.from) || typeof msg.target !== 'string') return;
      this.applyKick(msg.target, false, msg.reason === 'reject' ? 'reject' : '');
      return;
    }

    if (msg.type === 'approve') {
      // Yalnizca oda sahibinin onayi gecerlidir (bekleyen kisinin kendisi de alir)
      if (msg.from !== this.authOwnerId() || typeof msg.target !== 'string') return;
      this.approved.add(msg.target);
      this.ownerSynced = true;
      this.saveInviteState();
      this.broadcastState();
      return;
    }

    if (msg.type === 'keyshare') {
      // Oda sahibi, kabul ettigi kisiye icerik anahtarini ECDH ile sararak gonderir.
      // Bir kez aldiktan sonra degismez; yalnizca oda sahibinden kabul edilir.
      if (!this.self || msg.to !== this.self.clientId || this.contentKey) return;
      if (!this.ecdh || typeof msg.epk !== 'string' || msg.from !== this.authOwnerId()) return;
      var ksSelf = this;
      return importEcdhPub(msg.epk).then(function (pub) { return ecdhSecretKey(ksSelf.ecdh.priv, pub); })
        .then(function (wrapKey) { return decBlob(wrapKey, msg.iv, msg.ct); })
        .then(function (obj) { return importRawKey(obj.k); })
        .then(function (key) {
          if (!ksSelf.contentKey) { ksSelf.contentKey = key; ksSelf.broadcastState(); return ksSelf.drainPending(); }
        })
        .catch(function () {});
    }

    if (msg.type === 'lock') {
      if (!this.isOwner(msg.from)) return;
      this.locked = Boolean(msg.locked);
      this.allowed = new Set(Array.isArray(msg.allowed) ? msg.allowed.map(String) : []);
      this.broadcastState();
      return;
    }

    if (msg.type === 'invite') {
      var inviter = this.participants.get(msg.from);
      if (inviter && inviter.app && typeof msg.h === 'string' && msg.h.length === 64) {
        this.invites.add(msg.h);
        this.saveInviteState();
        this.broadcastState();
      }
      return;
    }

    if (this.kicked.has(msg.from)) return;
    // Odaya kabul edilmemis kisinin (or. baskasindan gelen linkle girmeye
    // calisan) mesajlari yok sayilir; ben kabul edilmediysem de hicbir sey almam
    if (msg.type !== 'leave' && (!this.isAdmitted(this.participants.get(msg.from)) || !this.selfAdmitted())) return;
    // Kilitli odada izinli listesinde olmayanin mesajlari yok sayilir
    if (this.locked && !this.allowed.has(msg.from) && msg.type !== 'leave') return;

    if (msg.type === 'hand') {
      var ph = this.participants.get(msg.from);
      if (ph) {
        ph.lastSeen = now;
        ph.hand = msg.raise ? Number(msg.handTs) || msg.ts || now : 0;
      }
      this.broadcastState();
      return;
    }

    if (msg.type === 'cam') {
      var pc = this.participants.get(msg.from);
      if (pc) {
        pc.lastSeen = now;
        pc.cam = Boolean(msg.on);
      }
      this.broadcastState();
      return;
    }

    if (msg.type === 'mute') {
      var pm = this.participants.get(msg.from);
      if (pm) {
        pm.lastSeen = now;
        pm.mute = Boolean(msg.on);
      }
      this.broadcastState();
      return;
    }

    if (msg.type === 'rtc') {
      if (this.self && msg.to === this.self.clientId && msg.data) this.emitFile('rtc_signal', { from: msg.from, data: msg.data });
      return;
    }

    if (msg.type === 'mic') {
      var p = this.participants.get(msg.from);
      if (p) p.lastSeen = now;
      this.applyRemoteMic(msg.from, Boolean(msg.active), msg.ts);
      this.broadcastState();
      return;
    }

    if (msg.type === 'chat' && msg.message) {
      var m = sanitizeChat(msg.message, this.code);
      if (m) this.addMessage(m);
      return;
    }

    if (msg.type === 'file-meta' && msg.file) {
      var fm = sanitizeFileMeta(msg.file);
      if (fm && fm.senderId === msg.from) this.registerIncoming(fm, true);
      return;
    }

    if (msg.type === 'file-chunk') {
      this.receiveChunk(msg);
      return;
    }

    if (msg.type === 'file-req') {
      if (this.self && msg.to === this.self.clientId) this.resendChunks(String(msg.fileId || ''), msg.missing);
      return;
    }

    if (msg.type === 'history' && Array.isArray(msg.files)) {
      var selfRef = this;
      msg.files.forEach(function (raw) {
        var fm2 = sanitizeFileMeta(raw);
        if (fm2) selfRef.registerIncoming(fm2, false);
      });
    }

    if (msg.type === 'history' && Array.isArray(msg.messages)) {
      var fresh = [];
      var self = this;
      msg.messages.forEach(function (raw) {
        var m2 = sanitizeChat(raw, self.code);
        if (m2 && !self.messages.some(function (x) { return x.id === m2.id; })) fresh.push(m2);
      });
      if (!fresh.length) return;
      fresh.forEach(function (m3) { self.messages.push(m3); });
      this.messages.sort(function (a, b) { return a.timestamp - b.timestamp; });
      if (this.messages.length > HISTORY_LIMIT) this.messages = this.messages.slice(-HISTORY_LIMIT);
      if (this.sink) this.sink._emit('history', { messages: fresh });
    }
  };

  // Ayni anda iki kisi mikrofonu alirsa: once alan kazanir, esitlikte kucuk kimlik
  RoomSession.prototype.applyRemoteMic = function (clientId, active, ts) {
    if (!active) {
      if (this.activeMic && this.activeMic.clientId === clientId) this.activeMic = null;
      return;
    }
    var mine = this.activeMic && this.self && this.activeMic.clientId === this.self.clientId;
    if (mine) {
      var myTs = this.activeMic.ts;
      var theyWin = ts < myTs || (ts === myTs && clientId < this.self.clientId);
      if (!theyWin) {
        this.send({ type: 'mic', active: true }); // sahipligi yeniden duyur
        return;
      }
    }
    this.activeMic = { clientId: clientId, ts: ts || Date.now() };
  };

  RoomSession.prototype.addMessage = function (m) {
    if (this.messages.some(function (x) { return x.id === m.id; })) return;
    this.messages.push(m);
    if (this.messages.length > HISTORY_LIMIT) this.messages.shift();
    if (this.sink) this.sink._emit('chat_message', m);
  };

  RoomSession.prototype.sendPresence = function (type) {
    if (!this.self) return Promise.resolve(0);
    var self = this;
    // ECDH acik anahtari hazir olana kadar bekle: presence her zaman pk tasisin
    return this.ready.then(function () {
      if (!self.self) return 0;
      return self._sendPresence(type);
    });
  };
  RoomSession.prototype._sendPresence = function (type) {
    var micActive = Boolean(this.activeMic && this.activeMic.clientId === this.self.clientId);
    return this.send({
      type: type || 'presence',
      name: this.self.name,
      lang: this.self.lang,
      joinedAt: this.self.joinedAt,
      micActive: micActive,
      micTs: micActive ? this.activeMic.ts : 0,
      handTs: this.self.hand || 0,
      cam: Boolean(this.self.cam),
      mute: Boolean(this.self.mute),
      color: typeof this.self.color === 'number' ? this.self.color : -1,
      locked: this.locked,
      allowed: this.locked ? Array.from(this.allowed) : [],
      kicked: Array.from(this.kicked).slice(-50),
      app: Boolean(this.self.app),
      creator: Boolean(this.self.creator),
      pk: this.ecdh ? this.ecdh.pubB64 : '',
      token: this.self.token || undefined,
      invites: Array.from(this.invites).slice(-INVITE_LIMIT),
      bindings: this.bindingList(),
      approved: Array.from(this.approved).slice(-INVITE_LIMIT),
    });
  };

  RoomSession.prototype.prune = function () {
    var now = Date.now();
    var changed = false;
    var self = this;
    this.participants.forEach(function (p, id) {
      if (self.self && id === self.self.clientId) return;
      if (now - p.lastSeen > PARTICIPANT_TTL_MS) {
        self.participants.delete(id);
        if (self.activeMic && self.activeMic.clientId === id) self.activeMic = null;
        if (self.authOwnerId() === (self.self && self.self.clientId)) {
          if (self.approved.delete(id)) self.saveInviteState();
          self.sharedPk.delete(id);
        }
        changed = true;
      }
    });
    if (changed) this.broadcastState();
  };

  // Ilk gelen 6 kisi odanin uyesidir; sonradan gelenler "oda dolu" gorur.
  // Herkes ayni siralamayi (katilma zamani, esitlikte kimlik) hesapladigi icin
  // sunucu olmadan da ayni sonuca varilir.
  RoomSession.prototype.allSorted = function () {
    var list = [];
    this.participants.forEach(function (p) {
      list.push({ clientId: p.clientId, name: p.name, lang: p.lang, joinedAt: p.joinedAt, hand: p.hand || 0, cam: Boolean(p.cam), mute: Boolean(p.mute), color: validColor(p.color) ? p.color : -1 });
    });
    list.sort(function (a, b) { return a.joinedAt - b.joinedAt || (a.clientId < b.clientId ? -1 : 1); });
    return list;
  };

  RoomSession.prototype.selfAdmitted = function () {
    return this.inviteStatus() === 'ok';
  };

  RoomSession.prototype.participantList = function () {
    var self = this;
    var selfId = this.self ? this.self.clientId : null;
    return this.allSorted()
      .filter(function (p) {
        if (self.kicked.has(p.clientId)) return false;
        // Kabul bekleyen kendim listede gorunurum; digerleri kabul edilmeli
        if (p.clientId === selfId) {
          if (self.inviteStatus() === 'used' || self.inviteStatus() === 'invalid') return false;
        } else if (!self.isAdmitted(self.participants.get(p.clientId))) {
          return false;
        }
        if (self.locked && !self.allowed.has(p.clientId)) return false;
        return true;
      })
      .slice(0, MAX_PARTICIPANTS);
  };

  // Oda sahibi: odadaki en eski uye (odayi kuran). Ayrilinca siradaki olur.
  RoomSession.prototype.ownerId = function () {
    var m = this.participantList();
    return m.length ? m[0].clientId : null;
  };

  RoomSession.prototype.isOwner = function (clientId) {
    return Boolean(clientId) && this.ownerId() === clientId;
  };

  // Baskalarinin presence mesajindan oda kurallarini (kilit, cikarilanlar) ogren
  RoomSession.prototype.absorbRoomRules = function (msg) {
    var self = this;
    if (Array.isArray(msg.kicked)) {
      msg.kicked.forEach(function (id) {
        if (typeof id === 'string' && !self.kicked.has(id)) self.applyKick(id, true);
      });
    }
    if (msg.locked === true && Array.isArray(msg.allowed) && msg.allowed.length) {
      // Kilitli bir odaya sonradan gelen: izinli listesinde yoksa giremez
      if (!this.locked) {
        this.locked = true;
        this.allowed = new Set(msg.allowed.map(String));
      }
    } else if (msg.locked === false && this.locked && this.isOwner(msg.from)) {
      this.locked = false;
      this.allowed = new Set();
    }
  };

  RoomSession.prototype.applyKick = function (target, silent, reason) {
    this.kicked.add(target);
    this.allowed.delete(target);
    this.approved.delete(target);
    this.sharedPk.delete(target);
    this.participants.delete(target);
    if (this.activeMic && this.activeMic.clientId === target) this.activeMic = null;
    if (this.self && target === this.self.clientId) {
      this.emitFile('kicked', { reason: reason || '' });
      return;
    }
    if (this.self && this.authOwnerId() === this.self.clientId) this.sendPresence('presence');
    if (!silent) this.broadcastState();
  };

  /** Oda sahibi: bir kisiyi odadan cikarir. */
  RoomSession.prototype.kick = function (target) {
    if (!this.self || !this.isOwner(this.self.clientId) || target === this.self.clientId) return false;
    this.send({ type: 'kick', target: target });
    this.applyKick(target);
    return true;
  };

  /** Oda sahibi: odayi yeni katilima kilitler / acar. */
  RoomSession.prototype.setLocked = function (locked) {
    if (!this.self || !this.isOwner(this.self.clientId)) return false;
    // Izinli liste kilitlemeden ONCE alinir (kilitliyken liste izinlilere gore suzulur)
    var members = this.participantList().map(function (p) { return p.clientId; });
    this.locked = Boolean(locked);
    this.allowed = new Set(locked ? members : []);
    this.send({ type: 'lock', locked: this.locked, allowed: Array.from(this.allowed) });
    this.broadcastState();
    return true;
  };

  RoomSession.prototype.isGroup = function () {
    return this.participantList().length >= GROUP_MIN;
  };

  RoomSession.prototype.setHand = function (raise) {
    if (!this.self) return;
    var ts = raise ? this.self.hand || Date.now() : 0;
    if ((this.self.hand || 0) === ts) return;
    this.self.hand = ts;
    this.send({ type: 'hand', raise: Boolean(raise), handTs: ts });
    this.broadcastState();
  };

  RoomSession.prototype.setCam = function (on) {
    if (!this.self) return;
    this.self.cam = Boolean(on);
    this.send({ type: 'cam', on: Boolean(on) });
    this.broadcastState();
  };

  /** Ayni dildeki sesli sohbette mikrofonu kapattim / actim. */
  RoomSession.prototype.setMute = function (on) {
    if (!this.self) return;
    this.self.mute = Boolean(on);
    this.send({ type: 'mute', on: Boolean(on) });
    this.broadcastState();
  };

  RoomSession.prototype.broadcastState = function () {
    if (!this.sink) return;
    // Oda sahibiysem kabul listem yetkilidir; icerik anahtarini uret ve kabul
    // ettiklerime dagit (yalnizca onlar konusmayi cozebilir)
    if (this.self && this.authOwnerId() === this.self.clientId) {
      this.ownerSynced = true;
      this.ensureContentKey();
      if (this.contentKey) {
        var ko = this;
        this.participants.forEach(function (pp) {
          if (pp.clientId === ko.self.clientId) return;
          if (ko.isAdmitted(pp) && pp.pk && ko.sharedPk.get(pp.clientId) !== pp.pk) ko.shareKeyTo(pp);
        });
      }
    }
    var members = this.participantList();
    var memberIds = members.map(function (m) { return m.clientId; });
    var selfId = this.self ? this.self.clientId : null;
    var lockedOut = Boolean(selfId) && this.locked && !this.allowed.has(selfId);
    var inviteState = this.inviteStatus();
    var full = Boolean(selfId) && memberIds.indexOf(selfId) < 0 && !lockedOut && !this.kicked.has(selfId) && inviteState !== 'used' && inviteState !== 'invalid';
    var group = members.length >= GROUP_MIN;
    if (this.activeMic && memberIds.indexOf(this.activeMic.clientId) < 0) this.activeMic = null;

    // 2 kisiye dusunce soz sirasi kalkar (bugunku iki kisilik davranis)
    if (!group) {
      this.participants.forEach(function (p) { p.hand = 0; });
    }
    var holderId = this.activeMic ? this.activeMic.clientId : null;
    var queue = members
      .filter(function (m) { return m.hand && m.clientId !== holderId; })
      .sort(function (a, b) { return a.hand - b.hand || (a.clientId < b.clientId ? -1 : 1); });

    // Mikrofon bos ve sira bendeyse sozu otomatik al
    if (group && !holderId && queue.length && queue[0].clientId === selfId && !full) {
      this.activeMic = { clientId: selfId, ts: Date.now() };
      this.self.hand = 0;
      this.send({ type: 'mic', active: true });
      this.send({ type: 'hand', raise: false, handTs: 0 });
      holderId = selfId;
      queue = queue.slice(1);
    }

    this.resolveColor(members);

    var holder = holderId ? this.participants.get(holderId) : null;
    // Kapida bekleyen (henuz kabul edilmemis) misafir iceriyi hic gormez:
    // kimin oldugunu, isimleri, kameralari ve konusmalari almaz
    if (this.self && !this.self.app && inviteState !== 'ok') {
      var me = members.filter(function (m) { return m.clientId === selfId; });
      this.sink._emit('room_state', {
        roomCode: this.code,
        participants: me,
        activeMicClientId: null,
        activeMicName: null,
        group: false,
        queue: [],
        full: full,
        lockedOut: lockedOut,
        invite: inviteState,
        lobby: [],
        locked: false,
        ownerId: null,
        maxParticipants: MAX_PARTICIPANTS,
      });
      return;
    }
    this.sink._emit('room_state', {
      roomCode: this.code,
      participants: members,
      activeMicClientId: holderId,
      activeMicName: holder ? holder.name : null,
      group: group,
      queue: queue.map(function (q) { return q.clientId; }),
      full: full,
      lockedOut: lockedOut,
      invite: inviteState,
      lobby: this.lobbyList().map(function (p) { return { clientId: p.clientId, name: p.name, lang: p.lang }; }),
      locked: this.locked,
      ownerId: this.ownerId(),
      maxParticipants: MAX_PARTICIPANTS,
    });
  };

  // Her kisiye bir renk: odaya once girenin rengi korunur; sonra gelen,
  // oncekilerin kullanmadigi ilk rengi alir (ayni anda girenlerde sonraki degistirir)
  RoomSession.prototype.resolveColor = function (members) {
    var me = this.self;
    if (!me || !members.some(function (m) { return m.clientId === me.clientId; })) return;
    var taken = {};
    members.forEach(function (m) {
      if (m.clientId === me.clientId || !validColor(m.color)) return;
      var earlier = m.joinedAt < me.joinedAt || (m.joinedAt === me.joinedAt && m.clientId < me.clientId);
      if (earlier) taken[m.color] = true;
    });
    if (validColor(me.color) && !taken[me.color]) return;
    for (var c = 0; c < COLOR_COUNT; c++) {
      if (!taken[c]) {
        me.color = c;
        this.sendPresence('presence');
        return;
      }
    }
  };

  RoomSession.prototype.join = function (sink, clientId, name, lang, token, creator) {
    var self = this;
    this.sink = sink;
    this.joinStartedAt = Date.now();
    // Kisa kopma (yeniden baglanma) sirayi/sahipligi korur; gercekten ayrilip
    // sonra donen kisi en sona eklenir (sahiplik siradakinde kalir)
    var resume = this.lastSelf && this.lastSelf.clientId === clientId && Date.now() - (this.lastLeftAt || 0) < 20000;
    var keepJoined = resume ? this.lastSelf.joinedAt : Date.now();
    var keepCam = resume ? Boolean(this.lastSelf.cam) : false;
    var keepColor = resume && typeof this.lastSelf.color === 'number' ? this.lastSelf.color : -1;
    var app = isAppClient();
    var isCreator = Boolean(creator) && app;
    this.self = { clientId: clientId, name: name, lang: lang, joinedAt: keepJoined, lastSeen: Infinity, hand: 0, cam: keepCam, color: keepColor, app: app, creator: isCreator, pk: '', token: app ? '' : String(token || '').slice(0, 64), tokenHash: '', tokenPending: !app && Boolean(token) };
    this.participants.set(clientId, this.self);
    if (isCreator) {
      // Odayi kuran kendini kabul eder ve icerik anahtarini uretir; herkes onun
      // onayindan gecer. Kuran disinda kimse (kirilmis uygulama dahil) anahtari alamaz.
      this.approved.add(clientId);
      this.ownerSynced = true;
    }
    if (!app) {
      // Misafir: gecersiz link karari icin sure dolunca durumu yeniden degerlendir
      clearTimeout(this.verdictTimer);
      this.verdictTimer = setTimeout(function () { self.broadcastState(); }, INVITE_VERDICT_MS + 200);
    }
    if (this.self.tokenPending) {
      var me = this.self;
      sha256hex(me.token).then(function (h) {
        me.tokenHash = h;
        me.tokenPending = false;
        self.broadcastState();
      });
    }
    sink._emit('history', { messages: this.messages.slice() });
    this.fileMetas.forEach(function (meta) { sink._emit('file_message', self.fileStatus(meta)); });
    this.broadcastState();
    this.sendPresence('hello');
    this.startFileWatchdog();
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(function () {
      self.sendPresence('presence');
      self.prune();
    }, HEARTBEAT_MS);
  };

  RoomSession.prototype.leave = function (sink) {
    if (this.sink !== sink) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.self) {
      if (this.activeMic && this.activeMic.clientId === this.self.clientId) this.activeMic = null;
      this.send({ type: 'leave' });
      this.participants.delete(this.self.clientId);
      this.lastSelf = this.self;
      this.lastLeftAt = Date.now();
    }
    this.sink = null;
    this.self = null;
  };

  // ---------------------------------------------------------------------------
  // Dosya paylasimi (fotograf ve PDF)
  // Dosya ~48 KB'lik sifreli parcalar halinde gider; alici eksik parcalari
  // gonderenden yeniden ister. Odaya sonradan gelen, dosyaya dokununca
  // tum parcalari ister.
  // ---------------------------------------------------------------------------
  var FILE_CHUNK = 48 * 1024;
  var FILE_MAX_BYTES = 10 * 1024 * 1024;
  var FILE_HISTORY_LIMIT = 20;
  var FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  var FILE_RETRY_MS = 4000;
  var FILE_MAX_TRIES = 6;

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function cleanFileName(name, type) {
    var base = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
    if (!base) base = type === 'application/pdf' ? 'belge.pdf' : 'foto.jpg';
    return base;
  }

  function sanitizeFileMeta(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    var type = String(raw.type || '');
    if (FILE_TYPES.indexOf(type) < 0) return null;
    var size = Number(raw.size);
    if (!(size > 0) || size > FILE_MAX_BYTES) return null;
    var chunks = Math.max(1, Math.ceil(size / FILE_CHUNK));
    return {
      id: raw.id.slice(0, 64),
      senderId: String(raw.senderId || '').slice(0, 64),
      senderName: String(raw.senderName || 'Kullanici').slice(0, 40),
      name: cleanFileName(raw.name, type),
      type: type,
      size: size,
      chunks: chunks,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
      color: validColor(raw.color) ? raw.color : -1,
    };
  }

  RoomSession.prototype.rememberMeta = function (meta) {
    if (this.fileMetas.some(function (m) { return m.id === meta.id; })) return;
    this.fileMetas.push(meta);
    if (this.fileMetas.length > FILE_HISTORY_LIMIT) this.fileMetas.shift();
  };

  RoomSession.prototype.fileStatus = function (meta) {
    var out = this.outFiles.get(meta.id);
    var inc = this.inFiles.get(meta.id);
    var state = out || (inc && inc.blob) ? 'ready' : inc && inc.failed ? 'failed' : inc && inc.wanted ? 'receiving' : 'available';
    return Object.assign({}, meta, {
      state: state,
      received: out ? meta.chunks : inc ? inc.got : 0,
      mine: Boolean(out),
    });
  };

  RoomSession.prototype.emitFile = function (event, data) {
    if (this.sink) this.sink._emit(event, data);
  };

  RoomSession.prototype.sendChunk = function (id, index) {
    var entry = this.outFiles.get(id);
    if (!entry || index < 0 || index >= entry.meta.chunks) return Promise.resolve(0);
    var part = entry.bytes.subarray(index * FILE_CHUNK, Math.min(entry.bytes.length, (index + 1) * FILE_CHUNK));
    return this.send({ type: 'file-chunk', fileId: id, index: index, data: b64(part) });
  };

  RoomSession.prototype.sendFile = async function (name, type, bytes, onProgress) {
    if (!this.self) throw new Error('not in room');
    if (FILE_TYPES.indexOf(type) < 0) throw new Error('type');
    if (!bytes || !bytes.length || bytes.length > FILE_MAX_BYTES) throw new Error('size');
    if (transport.connectedCount() === 0) throw new Error('offline');
    var meta = {
      id: Date.now().toString(36) + '-' + randomId().slice(0, 8),
      senderId: this.self.clientId,
      senderName: this.self.name,
      color: validColor(this.self.color) ? this.self.color : -1,
      name: cleanFileName(name, type),
      type: type,
      size: bytes.length,
      chunks: Math.max(1, Math.ceil(bytes.length / FILE_CHUNK)),
      timestamp: Date.now(),
    };
    this.outFiles.set(meta.id, { meta: meta, bytes: bytes });
    // Bellek: en fazla 20 dosya tut
    if (this.outFiles.size > FILE_HISTORY_LIMIT) this.outFiles.delete(this.outFiles.keys().next().value);
    this.rememberMeta(meta);
    this.emitFile('file_message', Object.assign(this.fileStatus(meta), { state: 'sending', received: 0 }));
    await this.send({ type: 'file-meta', file: meta });
    for (var i = 0; i < meta.chunks; i++) {
      await this.sendChunk(meta.id, i);
      var p = (i + 1) / meta.chunks;
      if (onProgress) onProgress(p);
      this.emitFile('file_progress', { id: meta.id, received: i + 1, total: meta.chunks, sending: true });
      if (i % 6 === 5) await sleep(25); // araciyi bogmamak icin kucuk ara
    }
    this.emitFile('file_ready', { id: meta.id });
    return meta;
  };

  RoomSession.prototype.resendChunks = async function (id, missing) {
    var entry = this.outFiles.get(id);
    if (!entry) return;
    var list = Array.isArray(missing) ? missing : [];
    if (!list.length) for (var k = 0; k < entry.meta.chunks; k++) list.push(k);
    list = list.slice(0, 400);
    for (var i = 0; i < list.length; i++) {
      var idx = Number(list[i]);
      if (Number.isInteger(idx)) await this.sendChunk(id, idx);
      if (i % 6 === 5) await sleep(25);
    }
  };

  RoomSession.prototype.registerIncoming = function (meta, live) {
    if (this.outFiles.has(meta.id)) return;
    var entry = this.inFiles.get(meta.id);
    if (!entry) {
      entry = { meta: meta, parts: new Array(meta.chunks), got: 0, blob: null, failed: false, wanted: Boolean(live), tries: 0, lastAt: Date.now(), waiters: [], lastProgress: 0 };
      this.inFiles.set(meta.id, entry);
      if (this.inFiles.size > 40) this.inFiles.delete(this.inFiles.keys().next().value);
      this.rememberMeta(meta);
      this.emitFile('file_message', this.fileStatus(meta));
    } else if (live && !entry.wanted) {
      entry.wanted = true;
      entry.lastAt = Date.now();
    }
    this.startFileWatchdog();
  };

  RoomSession.prototype.receiveChunk = function (msg) {
    var entry = this.inFiles.get(String(msg.fileId || ''));
    if (!entry || entry.blob) return;
    var idx = Number(msg.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= entry.meta.chunks || entry.parts[idx]) return;
    var bytes;
    try { bytes = unb64(String(msg.data || '')); } catch (e) { return; }
    entry.parts[idx] = bytes;
    entry.got += 1;
    entry.lastAt = Date.now();
    entry.wanted = true;
    if (entry.failed) entry.failed = false;
    var now = Date.now();
    if (entry.got === entry.meta.chunks) {
      entry.blob = new Blob(entry.parts, { type: entry.meta.type });
      entry.parts = null;
      this.emitFile('file_ready', { id: entry.meta.id });
      entry.waiters.forEach(function (w) { w.resolve(entry.blob); });
      entry.waiters = [];
    } else if (now - entry.lastProgress > 200) {
      entry.lastProgress = now;
      this.emitFile('file_progress', { id: entry.meta.id, received: entry.got, total: entry.meta.chunks });
    }
  };

  RoomSession.prototype.requestMissing = function (entry) {
    var missing = [];
    for (var i = 0; i < entry.meta.chunks && missing.length < 400; i++) if (!entry.parts[i]) missing.push(i);
    this.send({ type: 'file-req', fileId: entry.meta.id, to: entry.meta.senderId, missing: missing });
  };

  RoomSession.prototype.startFileWatchdog = function () {
    if (this.fileTimer) return;
    var self = this;
    this.fileTimer = setInterval(function () {
      var now = Date.now();
      var pending = 0;
      self.inFiles.forEach(function (entry) {
        if (entry.blob || entry.failed || !entry.wanted) return;
        pending++;
        if (now - entry.lastAt < FILE_RETRY_MS) return;
        if (entry.tries >= FILE_MAX_TRIES) {
          entry.failed = true;
          self.emitFile('file_failed', { id: entry.meta.id });
          entry.waiters.forEach(function (w) { w.reject(new Error('unavailable')); });
          entry.waiters = [];
          return;
        }
        entry.tries += 1;
        entry.lastAt = now;
        self.requestMissing(entry);
      });
      if (!pending && !self.sink) {
        clearInterval(self.fileTimer);
        self.fileTimer = null;
      }
    }, 1000);
  };

  /** Dosyanin icerigini verir; henuz gelmediyse gonderenden ister. */
  RoomSession.prototype.getFile = function (id) {
    var out = this.outFiles.get(id);
    if (out) return Promise.resolve(new Blob([out.bytes], { type: out.meta.type }));
    var entry = this.inFiles.get(id);
    if (!entry) return Promise.reject(new Error('unavailable'));
    if (entry.blob) return Promise.resolve(entry.blob);
    var self = this;
    return new Promise(function (resolve, reject) {
      entry.waiters.push({ resolve: resolve, reject: reject });
      if (!entry.wanted || entry.failed) {
        entry.wanted = true;
        entry.failed = false;
        entry.tries = 0;
        entry.lastAt = Date.now();
        self.emitFile('file_progress', { id: id, received: entry.got, total: entry.meta.chunks });
        self.requestMissing(entry);
      }
      self.startFileWatchdog();
    });
  };

  function censorText(text, lang) {
    return typeof window.CeviriCensor === 'function' ? window.CeviriCensor(text, lang) : text;
  }

  function validColor(c) {
    return typeof c === 'number' && c >= 0 && c < COLOR_COUNT && Math.floor(c) === c;
  }

  function sanitizeChat(raw, code) {
    if (!raw || typeof raw !== 'object') return null;
    var text = typeof raw.originalText === 'string' ? raw.originalText.slice(0, 4000) : '';
    if (!text || typeof raw.id !== 'string') return null;
    return {
      id: raw.id.slice(0, 64),
      roomCode: code,
      senderId: String(raw.senderId || '').slice(0, 64),
      senderName: String(raw.senderName || 'Kullanici').slice(0, 40),
      sourceLang: String(raw.sourceLang || 'tr-TR').slice(0, 16),
      targetLang: typeof raw.targetLang === 'string' ? raw.targetLang.slice(0, 16) : '',
      originalText: censorText(text, raw.sourceLang),
      translatedText: censorText(typeof raw.translatedText === 'string' ? raw.translatedText.slice(0, 8000) : '', raw.targetLang),
      latencyMs: typeof raw.latencyMs === 'number' ? raw.latencyMs : undefined,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
      color: validColor(raw.color) ? raw.color : -1,
    };
  }

  function getRoom(code) {
    if (!rooms[code]) rooms[code] = new RoomSession(code);
    return rooms[code];
  }

  // ---------------------------------------------------------------------------
  // EventSource taklidi: /api/rooms/:code/events
  // ---------------------------------------------------------------------------
  function RelayEventSource(url) {
    this.url = url;
    this.readyState = 0;
    this.onerror = null;
    this.onopen = null;
    this.onmessage = null;
    this._listeners = {};
    var u = new URL(url, window.location.href);
    var m = u.pathname.match(/^\/api\/rooms\/([A-Za-z0-9-]+)\/events$/);
    var code = sanitizeRoomCode(m ? m[1] : '');
    var clientId = (u.searchParams.get('clientId') || '').trim().slice(0, 64);
    var name = (u.searchParams.get('name') || 'Misafir').trim().slice(0, 40) || 'Misafir';
    var lang = (u.searchParams.get('lang') || 'tr-TR').trim().slice(0, 16);
    var token = (u.searchParams.get('token') || '').trim().slice(0, 64);
    var creator = u.searchParams.get('creator') === '1';
    var self = this;
    this._room = getRoom(code);
    this._statusFn = function () {
      if (self.readyState === 2) return;
      if (transport.connectedCount() === 0 && typeof self.onerror === 'function') self.onerror({});
    };
    transport.statusListeners.push(this._statusFn);
    setTimeout(function () {
      if (self.readyState === 2) return;
      self.readyState = 1;
      if (typeof self.onopen === 'function') self.onopen({});
      self._room.join(self, clientId, name, lang, token, creator);
    }, 0);
  }

  RelayEventSource.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };

  RelayEventSource.prototype.removeEventListener = function (type, fn) {
    var arr = this._listeners[type] || [];
    var i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };

  RelayEventSource.prototype._emit = function (type, data) {
    if (this.readyState === 2) return;
    var ev = { type: type, data: JSON.stringify(data) };
    (this._listeners[type] || []).slice().forEach(function (fn) {
      try { fn(ev); } catch (e) { setTimeout(function () { throw e; }); }
    });
  };

  RelayEventSource.prototype.close = function () {
    if (this.readyState === 2) return;
    this.readyState = 2;
    var i = transport.statusListeners.indexOf(this._statusFn);
    if (i >= 0) transport.statusListeners.splice(i, 1);
    this._room.leave(this);
  };

  // ---------------------------------------------------------------------------
  // fetch taklidi: /api/rooms, /api/rooms/:code/mic, /api/rooms/:code/message
  // ---------------------------------------------------------------------------
  function json(status, obj) {
    return new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json' } });
  }

  function normBase(lang) {
    return String(lang || '').toLowerCase().split('-')[0];
  }

  async function handleRoomApi(path, init) {
    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { return json(400, { error: 'Invalid JSON body' }); }

    if (path === '/api/rooms') {
      // Linkle acilan misafir sayfasi oda kuramaz
      if (!isAppClient()) return json(403, { error: 'Oda yalnizca uygulamadan kurulabilir' });
      transport.start();
      var requested = sanitizeRoomCode(body.roomCode);
      return json(200, { roomCode: requested.length >= 4 ? requested : generateRoomCode() });
    }

    var act = path.match(/^\/api\/rooms\/([A-Za-z0-9-]+)\/(mic|hand|message)$/);
    var actRoom = act ? rooms[sanitizeRoomCode(act[1])] : null;
    if (actRoom && actRoom.self && !actRoom.selfAdmitted()) return json(403, { error: 'Davet gecerli degil' });

    var mic = path.match(/^\/api\/rooms\/([A-Za-z0-9-]+)\/mic$/);
    if (mic) {
      var room = rooms[sanitizeRoomCode(mic[1])];
      if (!room || !room.self) return json(404, { error: 'Oda bulunamadi' });
      var clientId = String(body.clientId || '').trim();
      if (!clientId) return json(400, { error: 'clientId is required' });
      if (body.active) {
        var holder = room.activeMic && room.activeMic.clientId !== clientId ? room.participants.get(room.activeMic.clientId) : null;
        if (holder) {
          return json(409, { error: 'Mikrofon su anda karsi tarafta aktif', activeMicClientId: holder.clientId, activeMicName: holder.name });
        }
        room.activeMic = { clientId: clientId, ts: Date.now() };
        room.send({ type: 'mic', active: true });
        if (room.self && room.self.hand) {
          room.self.hand = 0;
          room.send({ type: 'hand', raise: false, handTs: 0 });
        }
      } else if (room.activeMic && room.activeMic.clientId === clientId) {
        room.activeMic = null;
        room.send({ type: 'mic', active: false });
      }
      room.broadcastState();
      return json(200, { activeMicClientId: room.activeMic ? room.activeMic.clientId : null });
    }

    var hand = path.match(/^\/api\/rooms\/([A-Za-z0-9-]+)\/hand$/);
    if (hand) {
      var rh = rooms[sanitizeRoomCode(hand[1])];
      if (!rh || !rh.self) return json(404, { error: 'Oda bulunamadi' });
      rh.setHand(Boolean(body.raise));
      return json(200, { raised: Boolean(rh.self.hand) });
    }

    var msgMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9-]+)\/message$/);
    if (msgMatch) {
      var r = rooms[sanitizeRoomCode(msgMatch[1])];
      if (!r || !r.self) return json(404, { error: 'Oda bulunamadi' });
      var text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return json(400, { error: 'text is required' });
      var censorFn = typeof window.CeviriCensor === 'function' ? window.CeviriCensor : function (x) { return x; };
      if (transport.connectedCount() === 0) return json(503, { error: 'Online baglanti yok, internetinizi kontrol edin' });

      var sourceLang = (typeof body.sourceLang === 'string' && body.sourceLang.trim()) || r.self.lang || 'tr-TR';
      if (r.isGroup()) {
        // 3+ kisi: herkes farkli dilde olabilir; ceviriyi her alici kendi cihazinda yapar
        var gm = {
          id: Date.now() + '-' + randomId().slice(0, 5),
          roomCode: r.code,
          senderId: r.self.clientId,
          senderName: r.self.name || String(body.senderName || 'Kullanici'),
          color: validColor(r.self.color) ? r.self.color : -1,
          sourceLang: sourceLang,
          targetLang: '',
          originalText: censorFn(text, sourceLang),
          translatedText: '',
          timestamp: Date.now(),
        };
        r.addMessage(gm);
        await r.send({ type: 'chat', message: gm });
        return json(200, gm);
      }
      var partner = r.participantList().filter(function (p) { return p.clientId !== r.self.clientId; })[0] || null;
      var targetLang = (partner && partner.lang) ||
        (typeof body.fallbackTargetLang === 'string' && body.fallbackTargetLang) ||
        (normBase(sourceLang) === 'tr' ? 'en-US' : 'tr-TR');

      // Kufur filtresi: karsiya giden metin ve ceviri
      text = censorFn(text, sourceLang);
      var result;
      try {
        result = await translateFn(text, sourceLang, targetLang);
        result = Object.assign({}, result, { translatedText: censorFn(result.translatedText || '', targetLang) });
      } catch (err) {
        return json(502, { error: 'Translation failed', detail: String(err && err.message || err) });
      }
      var m = {
        id: Date.now() + '-' + randomId().slice(0, 5),
        roomCode: r.code,
        senderId: r.self.clientId,
        senderName: r.self.name || String(body.senderName || 'Kullanici'),
        color: validColor(r.self.color) ? r.self.color : -1,
        sourceLang: sourceLang,
        targetLang: targetLang,
        originalText: text,
        translatedText: result.translatedText,
        latencyMs: result.latencyMs,
        timestamp: Date.now(),
      };
      r.addMessage(m);
      await r.send({ type: 'chat', message: m });
      return json(200, m);
    }

    return json(404, { error: 'Not found' });
  }

  // Davet linklerinin gidecegi web surumu (GitHub Pages). web-url.js'te tanimlanir.
  // Tarayicida acilmissa bulundugu adres kullanilir.
  function webUrl() {
    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    // Bilgisayar surumu yerel (localhost) calisir: davet linki web surumune gider
    if (!isNative && !window.CEVIRI_DESKTOP && /^https?:$/.test(window.location.protocol)) {
      return (window.location.origin + window.location.pathname).replace(/\/(index\.html)?$/, '');
    }
    return String(window.CEVIRI_WEB_URL || '').replace(/\/+$/, '');
  }

  function onlineInfo() {
    transport.start();
    var n = transport.connectedCount();
    if (transport.error) return { onlineMode: true, status: 'error', publicUrl: webUrl() || null, error: transport.error };
    if (n > 0) return { onlineMode: true, status: 'ready', publicUrl: webUrl(), error: null, brokers: n };
    if (Date.now() - transport.startedAt > 20000) {
      return { onlineMode: true, status: 'error', publicUrl: webUrl() || null, error: 'Online sunucuya ulasilamadi - internetinizi kontrol edin' };
    }
    return { onlineMode: true, status: 'starting', publicUrl: webUrl() || null, error: null };
  }

  // Sayfa/sekme kapanirken odadan ayrildigini hemen bildir (digerleri 25 sn beklemesin)
  if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', function () {
    Object.keys(rooms).forEach(function (code) {
      var room = rooms[code];
      if (room && room.sink) room.leave(room.sink);
    });
  });

  window.CeviriRelay = {
    install: function (opts) {
      translateFn = opts.translate;
      window.EventSource = RelayEventSource;
    },
    handleRoomApi: handleRoomApi,
    onlineInfo: onlineInfo,
    /** Kamera durumunu odaya bildirir. */
    setCam: function (code, on) {
      var room = rooms[sanitizeRoomCode(code)];
      if (room) room.setCam(on);
    },
    /** Sesli sohbette mikrofon kapali/acik durumunu odaya bildirir. */
    setMute: function (code, on) {
      var room = rooms[sanitizeRoomCode(code)];
      if (room) room.setMute(on);
    },
    /** WebRTC sinyal mesajini (teklif/cevap/aday) tek bir kisiye gonderir. */
    sendSignal: function (code, to, data) {
      var room = rooms[sanitizeRoomCode(code)];
      if (!room || !room.self) return Promise.resolve(0);
      return room.send({ type: 'rtc', to: String(to), data: data });
    },
    MAX_PARTICIPANTS: MAX_PARTICIPANTS,
    /** Uygulama: yeni tek kullanimlik davet anahtari */
    createInvite: function (code) {
      if (!isAppClient()) return '';
      return getRoom(sanitizeRoomCode(code)).createInvite();
    },
    /** Oda sahibi: kapida bekleyeni kabul et / geri cevir */
    approve: function (code, target) {
      var room = rooms[sanitizeRoomCode(code)];
      return Boolean(room && room.approve(String(target)));
    },
    reject: function (code, target) {
      var room = rooms[sanitizeRoomCode(code)];
      return Boolean(room && room.reject(String(target)));
    },
    /** Oda sahibi: kisiyi cikar */
    kick: function (code, target) {
      var room = rooms[sanitizeRoomCode(code)];
      return Boolean(room && room.kick(String(target)));
    },
    /** Oda sahibi: odayi kilitle / ac */
    setLocked: function (code, locked) {
      var room = rooms[sanitizeRoomCode(code)];
      return Boolean(room && room.setLocked(locked));
    },
    /** Odaya fotograf/PDF gonderir. bytes: Uint8Array */
    sendFile: function (code, name, type, bytes, onProgress) {
      var room = rooms[sanitizeRoomCode(code)];
      if (!room || !room.self) return Promise.reject(new Error('not in room'));
      return room.sendFile(name, type, bytes, onProgress);
    },
    /** Odadaki bir dosyanin icerigini (Blob) verir; gerekirse gonderenden ister. */
    getFile: function (code, id) {
      var room = rooms[sanitizeRoomCode(code)];
      if (!room) return Promise.reject(new Error('unavailable'));
      return room.getFile(id);
    },
    FILE_MAX_BYTES: FILE_MAX_BYTES,
    FILE_TYPES: FILE_TYPES,
    /** Canli destek masasi icin ortak araci baglantisi */
    pubsub: {
      subscribe: function (topic, fn) { transport.subscribe(topic, fn); },
      unsubscribe: function (topic) { transport.unsubscribe(topic); },
      publish: function (topic, text) { return transport.publish(topic, text); },
    },
    // testler icin
    _transport: transport,
    _rooms: rooms,
  };
})();
