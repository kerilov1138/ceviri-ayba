/*
 * CEVIRI_AYBARION - Canli destek ekranlari
 *
 * Uye:      "Soru sormak istiyorum" -> kendi bire bir odasini kurar, sira kaydini
 *           masaya koyar -> ilk gelen yoneticiyi kendiliginden kabul eder ve
 *           odayi kilitler.
 * Yonetici: parolayla girer -> siradakileri (firma adlariyla) ve suren
 *           gorusmeleri gorur -> bekleyene tiklayip gorusmeyi alir -> gorusme
 *           bitince PDF dokum otomatik iner.
 */
(function () {
  'use strict';

  var cfg = window.AYBA_SUPPORT_CONFIG || {};
  var ident = window.AybaIdentity;
  var user = ident && ident.user;
  var $ = function (id) { return document.getElementById(id); };
  var App = null;
  var t = function (k, v) { return App ? App.t(k, v) : k; };

  function show(id, on) {
    var el = $(id);
    if (el) el.classList.toggle('hidden', !on);
  }

  function fullName(u) {
    return ((u.firstName || u.name || '') + ' ' + (u.lastName || u.surname || '')).trim();
  }

  // Gorusme sirasinda (ve sirada beklerken) dil degistirilemez
  function lockLang(locked) {
    var sel = $('myLangSelect');
    if (sel) sel.disabled = Boolean(locked);
  }

  function pubsub() {
    return window.CeviriRelay.pubsub;
  }

  // -------------------------------------------------------------------------
  // Test girisi (gercek sitede site kendi girisini kullanir)
  // -------------------------------------------------------------------------
  function renderLogin() {
    document.documentElement.classList.add('ayba-login');
    show('aybaLogin', true);
    show('aybaTestForm', ident.testLoginAllowed);
    show('aybaNoLogin', !ident.testLoginAllowed);
    var form = $('aybaTestForm');
    var roleSel = $('aybaTestRole');
    var syncRole = function () {
      show('aybaTestCompanyRow', roleSel.value === 'member');
    };
    roleSel.addEventListener('change', syncRole);
    syncRole();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = ident.set({
        role: roleSel.value,
        firstName: $('aybaTestFirst').value,
        lastName: $('aybaTestLast').value,
        company: roleSel.value === 'member' ? $('aybaTestCompany').value : '',
        id: 'test-' + Math.random().toString(36).slice(2, 10),
        test: true,
      });
      if (!ok) App.showAlert(t('ayba.fillName'));
    });
  }

  function renderWho() {
    var who = $('aybaWho');
    if (!who || !user) return;
    who.textContent = user.role === 'admin'
      ? t('ayba.whoAdmin', { name: fullName(user) })
      : fullName(user) + (user.company ? ' · ' + user.company : '');
    show('aybaSignOut', Boolean(user.test));
  }

  // -------------------------------------------------------------------------
  // Uye
  // -------------------------------------------------------------------------
  var member = { phase: 'idle', desk: null, admitted: '', adminSeen: false, startedAt: 0 };

  function memberPhase(p) {
    member.phase = p;
    document.documentElement.dataset.aybaPhase = p;
    show('aybaMemberIdle', p === 'idle' || p === 'ended');
    show('aybaMemberWaiting', p === 'asking' || p === 'waiting');
    show('aybaMemberEnded', p === 'ended');
    show('aybaMemberInCall', p === 'call');
    lockLang(p === 'asking' || p === 'waiting' || p === 'call');
    updateAskButton();
  }

  // Ziyaretci: dil hazir secili gelmez; dil secilmeden soru sorulamaz
  var langChosen = false;
  function updateAskButton() {
    var ready = langChosen && member.phase !== 'asking';
    $('aybaAskBtn').disabled = !ready;
    show('aybaLangHint', !langChosen && (member.phase === 'idle' || member.phase === 'ended'));
  }

  function addLangPlaceholder() {
    var sel = $('myLangSelect');
    if (!sel || langChosen) return;
    var ph = sel.querySelector('option[data-ayba-placeholder]');
    if (!ph) {
      ph = document.createElement('option');
      ph.value = '';
      ph.disabled = true;
      ph.setAttribute('data-ayba-placeholder', '1');
      sel.insertBefore(ph, sel.firstChild);
    }
    ph.textContent = '— ' + t('ayba.chooseLang') + ' —';
    ph.selected = true;
    sel.value = '';
  }

  function initMemberLang() {
    var sel = $('myLangSelect');
    addLangPlaceholder();
    sel.addEventListener('change', function () {
      if (sel.value) {
        langChosen = true;
        var ph = sel.querySelector('option[data-ayba-placeholder]');
        if (ph) ph.remove();
        updateAskButton();
      }
    });
    // Arayuz dili degisince liste yeniden kurulur: secim yapilmadiysa bos kalsin
    new MutationObserver(function () {
      if (!langChosen && !sel.querySelector('option[data-ayba-placeholder]')) addLangPlaceholder();
    }).observe(sel, { childList: true });
  }

  async function memberAsk() {
    if (member.phase === 'asking' || member.phase === 'waiting' || member.phase === 'call') return;
    if (!langChosen) {
      updateAskButton();
      return;
    }
    if (!cfg.adminPub) {
      App.showAlert(t('ayba.noConfig'));
      return;
    }
    App.clearMessages();
    member.admitted = '';
    member.adminSeen = false;
    memberPhase('asking');
    try {
      var label = fullName(user) + (user.company ? ' (' + user.company + ')' : '');
      var room = await App.startMemberRoom(label);
      if (!room.token) throw new Error('token');
      member.desk = window.AybaDesk.createMemberDesk({
        config: cfg,
        pubsub: pubsub(),
        ticket: { name: user.firstName, surname: user.lastName, company: user.company, lang: App.myLang, code: room.code, token: room.token, at: Date.now() },
      });
      await member.desk.start();
      memberPhase('waiting');
    } catch (err) {
      console.warn(err);
      App.leave();
      memberPhase('idle');
      App.showAlert(t('ayba.askFailed'));
    }
  }

  function memberStopDesk() {
    if (member.desk) {
      member.desk.stop();
      member.desk = null;
    }
  }

  function memberRoomState(data) {
    if (member.phase !== 'waiting' && member.phase !== 'call') return;
    var lobby = data.lobby || [];
    if (!member.admitted && lobby.length) {
      // Oda anahtarini getiren ilk yonetici kendiliginden iceri alinir; oda kilitlenir
      member.admitted = lobby[0].clientId;
      App.approve(member.admitted);
      App.lock();
      memberStopDesk();
      lobby.slice(1).forEach(function (p) { App.reject(p.clientId); });
      memberPhase('call');
      return;
    }
    lobby.forEach(function (p) { if (p.clientId !== member.admitted) App.reject(p.clientId); });
    if (member.phase === 'call') {
      var here = (data.participants || []).some(function (p) { return p.clientId === member.admitted; });
      if (here) member.adminSeen = true;
      else if (member.adminSeen) {
        // Yonetici gorusmeyi bitirdi
        App.leave();
      }
    }
  }

  function memberLeft() {
    memberStopDesk();
    if (member.phase === 'call') memberPhase('ended');
    else if (member.phase !== 'ended') memberPhase('idle');
  }

  function initMember() {
    initMemberLang();
    // Yoneticiler cevrimici ziyaretci sayisini gorur (yalnizca ziyaretciler sayilir)
    if (cfg.adminPub) {
      var presence = window.AybaDesk.createMemberPresence({ config: cfg, pubsub: pubsub() });
      presence.start();
      window.addEventListener('pagehide', function () { presence.stop(); });
    }
    $('aybaAskBtn').addEventListener('click', memberAsk);
    $('aybaCancelBtn').addEventListener('click', function () {
      memberStopDesk();
      App.leave();
      memberPhase('idle');
    });
    memberPhase('idle');
    show('aybaMember', true);
  }

  // -------------------------------------------------------------------------
  // Yonetici
  // -------------------------------------------------------------------------
  var admin = { desk: null, keys: null, phase: 'locked', ticket: null, start: 0, joinTimer: null, partnerSeen: false, known: new Set(), docs: [], sound: true, finishing: false };
  var PW_KEY = 'ayba_admin_pw';

  function adminId() {
    if (user.id) return user.id;
    try {
      var k = sessionStorage.getItem('ayba_admin_id');
      if (!k) {
        k = 'a' + Math.random().toString(36).slice(2, 12);
        sessionStorage.setItem('ayba_admin_id', k);
      }
      return k;
    } catch (e) {
      return 'a' + Math.random().toString(36).slice(2, 12);
    }
  }

  function adminPhase(p) {
    admin.phase = p;
    document.documentElement.dataset.aybaPhase = p;
    show('aybaUnlock', p === 'locked');
    show('aybaConsole', p === 'console');
    show('aybaAdminCall', p === 'joining' || p === 'call');
    lockLang(p === 'joining' || p === 'call');
    $('aybaCallStatus').textContent = p === 'joining' ? t('ayba.joining') : '';
  }

  var audioCtx = null;
  function beep() {
    if (!admin.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var now = audioCtx.currentTime;
      [0, 0.18].forEach(function (d, i) {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, now + d);
        g.gain.exponentialRampToValueAtTime(0.25, now + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.16);
        o.connect(g).connect(audioCtx.destination);
        o.start(now + d);
        o.stop(now + d + 0.18);
      });
    } catch (e) {
      /* ses yok */
    }
  }

  function mmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  var lastSnap = { waiting: [], sessions: [], adminsOnline: 1, visitorsOnline: 0 };
  function renderConsole(snap) {
    if (snap) lastSnap = snap;
    snap = lastSnap;
    var fresh = snap.waiting.filter(function (w) { return !admin.known.has(w.id); });
    snap.waiting.forEach(function (w) { admin.known.add(w.id); });
    if (fresh.length && admin.phase === 'console') beep();
    document.title = (snap.waiting.length ? '(' + snap.waiting.length + ') ' : '') + t('ayba.title');

    $('aybaWaitCount').textContent = String(snap.waiting.length);
    $('aybaSessionCount').textContent = String(snap.sessions.length);
    $('aybaAdminsOnline').textContent = t('ayba.adminsOnline', { n: snap.adminsOnline });
    $('aybaVisitorsOnline').textContent = t('ayba.visitorsOnline', { n: snap.visitorsOnline || 0 });

    var wl = $('aybaWaitList');
    wl.textContent = '';
    show('aybaWaitEmpty', !snap.waiting.length);
    snap.waiting.forEach(function (w, i) {
      var li = document.createElement('li');
      li.className = 'ayba-item';
      var main = document.createElement('div');
      main.className = 'ayba-item-main';
      var company = document.createElement('strong');
      company.textContent = (i + 1) + '. ' + (w.company || '—');
      var person = document.createElement('span');
      person.className = 'ayba-person';
      person.textContent = (w.name + ' ' + w.surname).trim() + ' · ' + App.langName(w.lang);
      var wait = document.createElement('span');
      wait.className = 'ayba-wait';
      wait.textContent = t('ayba.waitingFor', { t: mmss(w.waitedMs) });
      main.append(company, person, wait);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'online-btn primary ayba-take';
      if (w.claimedBy) {
        btn.disabled = true;
        btn.textContent = t('ayba.takenBy', { name: w.claimedBy });
      } else {
        btn.textContent = t('ayba.take');
        btn.disabled = admin.phase !== 'console';
        btn.addEventListener('click', function () { adminTake(w.id, btn); });
      }
      li.append(main, btn);
      wl.appendChild(li);
    });

    var sl = $('aybaSessionList');
    sl.textContent = '';
    show('aybaSessionEmpty', !snap.sessions.length);
    snap.sessions.forEach(function (s) {
      var li = document.createElement('li');
      li.className = 'ayba-item busy' + (s.mine ? ' mine' : '');
      var main = document.createElement('div');
      main.className = 'ayba-item-main';
      var strong = document.createElement('strong');
      strong.textContent = s.adminName + ' ↔ ' + (s.company || (s.name + ' ' + s.surname).trim());
      var person = document.createElement('span');
      person.className = 'ayba-person';
      person.textContent = (s.name + ' ' + s.surname).trim();
      var since = document.createElement('span');
      since.className = 'ayba-wait';
      since.textContent = t('ayba.busyFor', { t: mmss(Date.now() - s.since) });
      main.append(strong, person, since);
      var tag = document.createElement('span');
      tag.className = 'ayba-busy-tag';
      tag.textContent = t('ayba.busy');
      li.append(main, tag);
      sl.appendChild(li);
    });

    var dl = $('aybaDocList');
    dl.textContent = '';
    show('aybaDocs', admin.docs.length > 0);
    admin.docs.slice().reverse().forEach(function (d) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = d.url;
      a.download = d.filename;
      a.textContent = '📄 ' + d.filename;
      li.appendChild(a);
      dl.appendChild(li);
    });
  }

  async function adminUnlock(pw, silent) {
    var msg = $('aybaUnlockMsg');
    msg.textContent = silent ? '' : t('ayba.unlocking');
    $('aybaUnlockBtn').disabled = true;
    try {
      admin.keys = await window.AybaCrypto.unlockAdmin(cfg, pw);
    } catch (e) {
      $('aybaUnlockBtn').disabled = false;
      msg.textContent = e.message === 'bad-password' ? t('ayba.badPassword') : t('ayba.noConfig');
      try { sessionStorage.removeItem(PW_KEY); } catch (er) { /* yoksay */ }
      return;
    }
    try { sessionStorage.setItem(PW_KEY, pw); } catch (e) { /* yoksay */ }
    msg.textContent = '';
    admin.desk = window.AybaDesk.createAdminDesk({
      config: cfg,
      pubsub: pubsub(),
      keys: admin.keys,
      me: { id: adminId(), name: fullName(user) },
      onChange: renderConsole,
    });
    await admin.desk.start();
    window.addEventListener('pagehide', function () { if (admin.desk) admin.desk.stop(); });
    adminPhase('console');
    renderConsole();
    setInterval(function () { if (admin.phase === 'console') renderConsole(); }, 1000);
  }

  async function adminTake(id, btn) {
    if (admin.phase !== 'console') return;
    btn.disabled = true;
    btn.textContent = t('ayba.joining');
    var r = await admin.desk.claim(id);
    if (!r.ticket) {
      App.showAlert(r.by ? t('ayba.lostTo', { name: r.by }) : t('ayba.lost'));
      renderConsole();
      return;
    }
    admin.ticket = r.ticket;
    admin.partnerSeen = false;
    admin.finishing = false;
    App.clearMessages();
    adminPhase('joining');
    $('aybaCallWith').textContent = (r.ticket.name + ' ' + r.ticket.surname).trim() + (r.ticket.company ? ' · ' + r.ticket.company : '');
    admin.desk.beginSession(r.ticket);
    App.joinAsAdmin(r.ticket.code, r.ticket.token, fullName(user));
    clearTimeout(admin.joinTimer);
    admin.joinTimer = setTimeout(function () {
      if (admin.phase === 'joining') {
        App.showAlert(t('ayba.joinFailed'));
        abortJoin();
      }
    }, 30000);
  }

  function abortJoin() {
    clearTimeout(admin.joinTimer);
    var tk = admin.ticket;
    admin.ticket = null;
    admin.desk.endSession(true);
    if (tk) admin.desk.release(tk.id);
    adminPhase('console');
    App.leave();
    renderConsole();
  }

  function adminRoomState(data) {
    if (admin.phase !== 'joining' && admin.phase !== 'call') return;
    if (data.invite === 'used' || data.invite === 'invalid') {
      App.showAlert(t('ayba.lost'));
      admin.phase = 'aborting';
      setTimeout(abortJoin, 0);
      return;
    }
    if (data.invite === 'ok' && admin.phase === 'joining') {
      clearTimeout(admin.joinTimer);
      admin.start = Date.now();
      adminPhase('call');
    }
    if (admin.phase === 'call') {
      var others = (data.participants || []).filter(function (p) { return p.clientId !== App.clientId; });
      if (others.length) admin.partnerSeen = true;
      else if (admin.partnerSeen) finishCall(); // musteri ayrildi
    }
  }

  async function finishCall() {
    if (admin.finishing || !admin.ticket) return;
    admin.finishing = true;
    var tk = admin.ticket;
    var messages = App.messages();
    var start = new Date(admin.start || Date.now());
    var end = new Date();
    admin.ticket = null;
    clearTimeout(admin.joinTimer);
    admin.desk.endSession();
    App.leave();
    adminPhase('console');
    renderConsole();
    var meta = {
      start: start,
      end: end,
      adminName: fullName(user),
      customerName: tk.name,
      customerSurname: tk.surname,
      company: tk.company,
      customerLang: tk.lang,
      adminLang: App.myLang,
    };
    try {
      var labels = {
        title: t('ayba.docTitle'), start: t('ayba.docStart'), end: t('ayba.docEnd'), duration: t('ayba.docDuration'),
        admin: t('ayba.docAdmin'), customer: t('ayba.docCustomer'), company: t('ayba.docCompany'),
        customerLang: t('ayba.docLang'), count: t('ayba.docCount'), original: t('export.original'), translation: t('export.translation'),
      };
      var doc = await window.AybaTranscript.build(meta, messages, labels, App.langName);
      var url = URL.createObjectURL(doc.blob);
      admin.docs.push({ url: url, filename: doc.filename });
      var a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      renderConsole();
      deliverTranscript(doc, meta, messages);
    } catch (err) {
      console.warn(err);
      App.showAlert(t('ayba.docFailed'));
    }
  }

  // Sitenin gelistiricisi icin: dokumu kendi arsivine almasi icin iki yol
  function deliverTranscript(doc, meta, messages) {
    var payload = {
      pdf: doc.blob,
      filename: doc.filename,
      html: doc.html,
      meta: {
        start: meta.start.toISOString(),
        end: meta.end.toISOString(),
        adminName: meta.adminName,
        adminId: adminId(),
        customerName: meta.customerName,
        customerSurname: meta.customerSurname,
        company: meta.company,
        customerLang: meta.customerLang,
      },
      messages: messages.map(function (m) {
        return { time: m.time, who: m.senderName, mine: m.speaker === 'me', sourceLang: m.sourceLang, targetLang: m.targetLang, original: m.originalText, translation: m.translatedText };
      }),
    };
    var hooks = window.AybaSupportHooks;
    if (hooks && typeof hooks.onTranscript === 'function') {
      try {
        hooks.onTranscript(payload);
      } catch (e) {
        console.warn(e);
      }
    }
    if (cfg.transcriptUploadUrl) {
      var fd = new FormData();
      fd.append('pdf', doc.blob, doc.filename);
      fd.append('meta', JSON.stringify(payload.meta));
      fd.append('messages', JSON.stringify(payload.messages));
      fetch(cfg.transcriptUploadUrl, { method: 'POST', body: fd, credentials: 'include' }).catch(function (e) { console.warn(e); });
    }
  }

  function adminLeft() {
    if (admin.phase === 'call') finishCall();
    else if (admin.phase === 'joining') abortJoin();
  }

  function initAdmin() {
    show('aybaAdmin', true);
    var leaveBtn = $('leaveRoomBtn');
    leaveBtn.removeAttribute('data-i18n');
    leaveBtn.textContent = t('ayba.end');
    adminPhase('locked');
    $('aybaUnlock').addEventListener('submit', function (e) {
      e.preventDefault();
      adminUnlock($('aybaPassword').value);
    });
    $('aybaEndBtn').addEventListener('click', function () {
      if (admin.phase === 'joining') abortJoin();
      else finishCall();
    });
    $('aybaSoundBtn').addEventListener('click', function () {
      admin.sound = !admin.sound;
      $('aybaSoundBtn').textContent = admin.sound ? '🔔' : '🔕';
      $('aybaSoundBtn').setAttribute('aria-pressed', String(admin.sound));
      if (admin.sound) beep();
    });
    var saved = null;
    try { saved = sessionStorage.getItem(PW_KEY); } catch (e) { /* yoksay */ }
    if (saved) adminUnlock(saved, true);
    else $('aybaPassword').focus();
  }

  // -------------------------------------------------------------------------
  function start() {
    App = window.AybaApp;
    document.title = t('ayba.title');
    if (window.AYBA_NEEDS_LOGIN) {
      renderLogin();
      return;
    }
    renderWho();
    $('aybaSignOut').addEventListener('click', function () { ident.signOut(); });
    window.AybaHooks = {
      roomState: function (data) { if (user.role === 'admin') adminRoomState(data); else memberRoomState(data); },
      left: function () { if (user.role === 'admin') adminLeft(); else memberLeft(); },
    };
    if (user.role === 'admin') initAdmin();
    else initMember();
  }

  if (window.AybaApp) start();
  else window.addEventListener('ayba-app-ready', start, { once: true });
})();
