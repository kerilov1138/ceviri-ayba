/*
 * CEVIRI - Android uyumluluk katmani
 *
 * Masaustu surumu tarayicinin Web Speech API'sini ve yerel Node sunucusunu
 * (/api/translate) kullanir. Android WebView ikisini de saglamaz. Bu dosya
 * app.js'ten ONCE yuklenir ve ayni arayuzleri Android'in kendi servisleriyle
 * yeniden kurar, boylece app.js neredeyse hic degismeden calisir:
 *
 *   window.SpeechRecognition  -> @capacitor-community/speech-recognition
 *   window.speechSynthesis    -> @capacitor-community/text-to-speech
 *   fetch('/api/translate')   -> dogrudan translate.googleapis.com (CapacitorHttp ile, CORS yok)
 *   fetch('/api/online-info') -> "online mod kapali" cevabi
 *
 *   /api/rooms...  + EventSource -> online-relay.js (sunucusuz, sifreli MQTT odalari)
 */
(function () {
  'use strict';

  var Cap = window.Capacitor;
  // APK icinde mi (Capacitor), yoksa tarayicida (GitHub Pages web surumu) mi?
  // Tarayicida: ceviri ve online oda bu dosyadan, ses tanima/seslendirme
  // tarayicinin kendi Web Speech API'sinden gelir.
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

  // capacitor-core.js (capacitorExports) index.html'de bu dosyadan once yuklenir
  var registerPlugin = (window.capacitorExports && window.capacitorExports.registerPlugin) || (Cap && Cap.registerPlugin);
  var SR = isNative ? registerPlugin('SpeechRecognition') : null;
  var TTS = isNative ? registerPlugin('TextToSpeech') : null;
  // Uygulamanin kendi yerel araclari: cevrimdisi ceviri, dil tanima, kulaklik dugmesi, ekran, PDF
  var Tools = isNative ? registerPlugin('CeviriTools') : null;
  window.CeviriTools = Tools;

  // ---------------------------------------------------------------------------
  // 1) Sunucu gerektiren arayuz parcalarini gizle
  // ---------------------------------------------------------------------------
  // (Disa aktarma artik uygulamada da calisir: dosya Belgeler/CEVIRI'ye kaydedilir,
  //  PDF icin sistemin "PDF olarak kaydet" ekrani acilir.)

  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = function () { return Promise.resolve(); };
    } catch (e) { /* yoksay */ }
  }

  // ---------------------------------------------------------------------------
  // 2) Ceviri: /api/translate -> Google (server.js'teki translateText ile ayni)
  // ---------------------------------------------------------------------------
  var originalFetch = window.fetch.bind(window);
  var cache = new Map();
  var MAX_CACHE = 1000;

  function normalizeTranslateCode(code) {
    if (!code || typeof code !== 'string') return 'auto';
    var t = code.trim();
    var l = t.toLowerCase();
    if (l === 'zh-cn' || l === 'zh-hans') return 'zh-CN';
    if (l === 'zh-tw' || l === 'zh-hant') return 'zh-TW';
    if (l === 'he-il' || l === 'iw-il') return 'iw';
    return t.split('-')[0].toLowerCase();
  }

  function jsonResponse(status, obj) {
    return new Response(JSON.stringify(obj), {
      status: status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function translate(text, sourceLang, targetLang) {
    var startedAt = Date.now();
    var clean = String(text || '').trim();
    var sl = normalizeTranslateCode(sourceLang);
    var tl = normalizeTranslateCode(targetLang);

    if (sl === tl && sl !== 'auto') {
      return { translatedText: clean, detectedSourceLang: sl, cached: true, latencyMs: 0 };
    }

    var key = sl + '::' + tl + '::' + clean;
    if (cache.has(key)) {
      var hit = cache.get(key);
      return { translatedText: hit.translatedText, detectedSourceLang: hit.detectedSourceLang, cached: true, latencyMs: Date.now() - startedAt };
    }

    var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t' +
      '&sl=' + encodeURIComponent(sl) +
      '&tl=' + encodeURIComponent(tl) +
      '&q=' + encodeURIComponent(clean);

    var translatedText;
    var detected = sl;
    var usedOffline = false;
    // Internet yoksa dogrudan cihaz ici (cevrimdisi) ceviri
    if (Tools && sl !== 'auto' && navigator.onLine === false) {
      translatedText = await translateOffline(clean, sl, tl);
      usedOffline = true;
    } else try {
      var res = await originalFetch(url, { method: 'GET' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (typeof data === 'string') data = JSON.parse(data);
      if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Beklenmeyen ceviri yaniti');
      translatedText = data[0]
        .map(function (s) { return Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''; })
        .join('')
        .trim();
      if (typeof data[2] === 'string') detected = data[2];
    } catch (primaryErr) {
      try {
        // Yedek adres (tarayicida ilk adres engellenirse)
        var url2 = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex' +
          '&sl=' + encodeURIComponent(sl) +
          '&tl=' + encodeURIComponent(tl) +
          '&q=' + encodeURIComponent(clean);
        var res2 = await originalFetch(url2, { method: 'GET' });
        if (!res2.ok) throw primaryErr;
        var d2 = await res2.json();
        if (typeof d2 === 'string') d2 = JSON.parse(d2);
        var first = Array.isArray(d2) ? d2[0] : d2;
        if (Array.isArray(first)) {
          translatedText = String(first[0] || '').trim();
          if (typeof first[1] === 'string') detected = first[1];
        } else if (typeof first === 'string') {
          translatedText = first.trim();
        } else {
          throw primaryErr;
        }
      } catch (fallbackErr) {
        // Cevrimici ceviri olmadi (internet zayif / yok): cihaz ici ceviriyi dene
        if (!Tools || sl === 'auto') throw fallbackErr;
        translatedText = await translateOffline(clean, sl, tl);
        usedOffline = true;
      }
    }

    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, { translatedText: translatedText, detectedSourceLang: detected });

    return { translatedText: translatedText, detectedSourceLang: detected, cached: false, offline: usedOffline, latencyMs: Date.now() - startedAt };
  }

  // Cihaz ici ceviri (Google ML Kit). Paket indirilmemisse OFFLINE_MODEL_MISSING.
  async function translateOffline(clean, sl, tl) {
    try {
      var r = await Tools.translateOffline({ text: clean, source: sl, target: tl });
      return String((r && r.text) || '').trim();
    } catch (e) {
      var m = String((e && (e.code || e.message)) || e);
      if (m.indexOf('OFFLINE_UNSUPPORTED') >= 0) throw new Error('OFFLINE_UNSUPPORTED');
      if (m.indexOf('OFFLINE_MODEL_MISSING') >= 0) throw new Error('OFFLINE_MODEL_MISSING');
      throw new Error('OFFLINE_FAILED');
    }
  }

  if (window.CeviriRelay) {
    window.CeviriRelay.install({ translate: translate });
  }

  window.fetch = async function (input, init) {
    var urlStr = typeof input === 'string' ? input : (input && input.url) || '';
    var path = urlStr;
    try { path = new URL(urlStr, window.location.href).pathname; } catch (e) { /* yoksay */ }
    var isLocal = urlStr.charAt(0) === '/' || urlStr.indexOf(window.location.origin) === 0;

    if (isLocal && path === '/api/translate') {
      try {
        var body = init && init.body ? JSON.parse(init.body) : {};
        if (!body.text || !String(body.text).trim()) return jsonResponse(400, { error: 'text is required' });
        if (!body.targetLang) return jsonResponse(400, { error: 'targetLang is required' });
        return jsonResponse(200, await translate(body.text, body.sourceLang || 'auto', body.targetLang));
      } catch (err) {
        return jsonResponse(502, { error: 'Translation failed', detail: String(err && err.message || err) });
      }
    }
    if (isLocal && path === '/api/online-info') {
      if (window.CeviriRelay) return jsonResponse(200, window.CeviriRelay.onlineInfo());
      return jsonResponse(200, { onlineMode: false, status: 'disabled', publicUrl: null });
    }
    if (isLocal && path.indexOf('/api/rooms') === 0 && window.CeviriRelay) {
      return window.CeviriRelay.handleRoomApi(path, init);
    }
    if (isLocal && path === '/api/health') {
      return jsonResponse(200, { ok: true });
    }
    if (isLocal && path.indexOf('/api/') === 0) {
      return jsonResponse(503, { error: 'Online mod Android surumunde kullanilamaz' });
    }
    return originalFetch(input, init);
  };

  if (!isNative) {
    // iPhone Safari: seslendirme ilk dokunusla "acilmazsa" gelen mesajlar okunmaz
    var unlockSpeech = function () {
      document.removeEventListener('pointerdown', unlockSpeech, true);
      try {
        if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
          var u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          window.speechSynthesis.speak(u);
        }
      } catch (e) { /* yoksay */ }
    };
    document.addEventListener('pointerdown', unlockSpeech, true);
    return; // Tarayicida ses tanima ve seslendirme tarayicinin kendisinden gelir
  }

  // ---------------------------------------------------------------------------
  // 3) Konusma tanima: Web Speech API benzeri sinif
  //    Eklenti "partialResults: false" ile kullanilir: start() sonuc veya
  //    hata ile kesin olarak biter, sessizlikte de takilmaz.
  // ---------------------------------------------------------------------------
  var permissionChecked = false;

  async function ensureMicPermission() {
    if (permissionChecked) return true;
    var p = await SR.checkPermissions();
    if (p.speechRecognition !== 'granted') {
      p = await SR.requestPermissions();
    }
    permissionChecked = p.speechRecognition === 'granted';
    return permissionChecked;
  }

  function mapError(message) {
    var m = String(message || '');
    if (/permission/i.test(m)) return 'not-allowed';
    if (/no match|no speech|didn't understand/i.test(m)) return 'no-speech';
    if (/audio recording/i.test(m)) return 'audio-capture';
    if (/network|server/i.test(m)) return 'network';
    if (/not available|unavailable|UNAVAILABLE/i.test(m)) return 'service-not-allowed';
    return 'aborted';
  }

  var speechStartListener = null;
  var activeRecognizer = null;

  function ensureSpeechStartListener() {
    if (speechStartListener) return;
    speechStartListener = SR.addListener('listeningState', function (ev) {
      if (ev && ev.status === 'started' && activeRecognizer && typeof activeRecognizer.onspeechstart === 'function') {
        try { activeRecognizer.onspeechstart({}); } catch (e) { /* yoksay */ }
      }
    });
  }

  function makeResultEvent(transcript) {
    var alt = { transcript: transcript, confidence: 1 };
    var result = [alt];
    result.isFinal = true;
    result.item = function (i) { return result[i]; };
    var results = [result];
    results.item = function (i) { return results[i]; };
    return { resultIndex: 0, results: results };
  }

  function NativeSpeechRecognition() {
    this.lang = 'tr-TR';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.onstart = null;
    this.onspeechstart = null;
    this._session = 0;
    this._running = false;
  }

  NativeSpeechRecognition.prototype._finish = function (session, delayMs) {
    var self = this;
    if (session !== self._session || !self._running) return;
    self._running = false;
    if (activeRecognizer === self) activeRecognizer = null;
    setTimeout(function () {
      if (typeof self.onend === 'function') self.onend({});
    }, delayMs || 0);
  };

  NativeSpeechRecognition.prototype.start = function () {
    var self = this;
    if (self._running) throw new Error('InvalidStateError: already started');
    self._running = true;
    var session = ++self._session;
    activeRecognizer = self;
    ensureSpeechStartListener();

    (async function () {
      try {
        var ok = await ensureMicPermission();
        if (session !== self._session) return;
        if (!ok) {
          if (typeof self.onerror === 'function') self.onerror({ error: 'not-allowed' });
          self._finish(session);
          return;
        }
        if (typeof self.onstart === 'function') self.onstart({});

        var res = await SR.start({
          language: self.lang,
          maxResults: Math.max(1, self.maxAlternatives || 1),
          partialResults: false,
          popup: false,
        });
        if (session !== self._session) return;

        var matches = (res && res.matches) || [];
        var text = matches.length ? String(matches[0] || '').trim() : '';
        if (text && typeof self.onresult === 'function') {
          self.onresult(makeResultEvent(text));
        }
        self._finish(session);
      } catch (err) {
        if (session !== self._session) return;
        var code = mapError(err && (err.message || err.code));
        if (typeof self.onerror === 'function') self.onerror({ error: code, message: String(err && err.message || err) });
        // Ag hatasinda hizli dongu olmasin diye kisa bekleme
        self._finish(session, code === 'network' ? 1200 : 0);
      }
    })();
  };

  NativeSpeechRecognition.prototype.stop = function () {
    // Konusmayi bitir; sonuc yine start() icinden gelir
    try { SR.stop(); } catch (e) { /* yoksay */ }
  };

  NativeSpeechRecognition.prototype.abort = function () {
    var session = this._session;
    this._session += 1; // bekleyen sonuclari yok say
    var wasRunning = this._running;
    this._running = false;
    if (activeRecognizer === this) activeRecognizer = null;
    try { SR.stop(); } catch (e) { /* yoksay */ }
    if (wasRunning && typeof this.onend === 'function') {
      var self = this;
      setTimeout(function () { if (self._session === session + 1 && typeof self.onend === 'function') self.onend({}); }, 0);
    }
  };

  NativeSpeechRecognition.prototype.addEventListener = function (type, fn) {
    this['on' + type] = fn;
  };

  window.SpeechRecognition = NativeSpeechRecognition;
  window.webkitSpeechRecognition = NativeSpeechRecognition;

  // ---------------------------------------------------------------------------
  // 4) Seslendirme: speechSynthesis benzeri nesne
  // ---------------------------------------------------------------------------
  function NativeUtterance(text) {
    this.text = text || '';
    this.lang = '';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.onend = null;
    this.onerror = null;
    this.onstart = null;
  }

  var synthState = { speaking: false, token: 0 };

  var nativeSynth = {
    get speaking() { return synthState.speaking; },
    get pending() { return false; },
    get paused() { return false; },
    onvoiceschanged: null,
    getVoices: function () { return []; },
    pause: function () {},
    resume: function () {},
    cancel: function () {
      synthState.token += 1;
      synthState.speaking = false;
      try { TTS.stop(); } catch (e) { /* yoksay */ }
    },
    speak: function (u) {
      var token = ++synthState.token;
      synthState.speaking = true;
      if (typeof u.onstart === 'function') u.onstart({});
      TTS.speak({
        text: String(u.text || ''),
        lang: u.lang || 'tr-TR',
        rate: typeof u.rate === 'number' ? u.rate : 1,
        pitch: typeof u.pitch === 'number' ? u.pitch : 1,
        volume: typeof u.volume === 'number' ? u.volume : 1,
        category: 'playback',
        queueStrategy: 0,
      }).then(function () {
        if (token === synthState.token) synthState.speaking = false;
        if (typeof u.onend === 'function') u.onend({});
      }).catch(function (err) {
        if (token === synthState.token) synthState.speaking = false;
        if (typeof u.onerror === 'function') u.onerror({ error: String(err && err.message || err) });
      });
    },
  };

  try {
    Object.defineProperty(window, 'speechSynthesis', { value: nativeSynth, configurable: true, writable: true });
  } catch (e) {
    window.speechSynthesis = nativeSynth;
  }
  window.SpeechSynthesisUtterance = NativeUtterance;
})();
