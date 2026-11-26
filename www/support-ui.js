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
  var member = {
    phase: 'idle', desk: null, admitted: '', adminSeen: false, startedAt: 0,
    ticketId: '', ticketAt: 0, info: null, transfer: null, transferDesk: null, transferTimer: null,
    rated: false, hadCall: false,
  };

  function memberPhase(p) {
    member.phase = p;
    document.documentElement.dataset.aybaPhase = p;
    show('aybaMemberIdle', p === 'idle' || p === 'ended');
    show('aybaMemberWaiting', p === 'asking' || p === 'waiting');
    show('aybaMemberEnded', p === 'ended');
    show('aybaMemberInCall', p === 'call');
    show('aybaRate', p === 'ended' && member.hadCall && !member.rated);
    show('aybaRateThanks', p === 'ended' && member.rated);
    lockLang(p === 'asking' || p === 'waiting' || p === 'call');
    var topic = $('aybaTopic');
    if (topic) topic.disabled = p === 'asking' || p === 'waiting' || p === 'call';
    updateAskButton();
    renderMemberInfo();
  }

  // Ziyaretci: dil hazir secili gelmez; dil secilmeden soru sorulamaz
  var langChosen = false;
  function topicText() {
    var el = $('aybaTopic');
    return el ? el.value.replace(/\s+/g, ' ').trim() : '';
  }
  function updateAskButton() {
    var idle = member.phase === 'idle' || member.phase === 'ended';
    var topicOk = topicText().length >= 3;
    $('aybaAskBtn').disabled = !(langChosen && topicOk && member.phase !== 'asking');
    show('aybaLangHint', idle && !langChosen);
    show('aybaTopicHint', idle && langChosen && !topicOk);
  }

  // Bekleme bilgisi: cevrimici yonetici, sira numarasi, tahmini bekleme
  function renderMemberInfo() {
    var info = member.info;
    var noAdmin = Boolean(info && info.ready && info.admins === 0);
    show('aybaNoAdmin', noAdmin && (member.phase === 'idle' || member.phase === 'ended' || member.phase === 'waiting'));
    var q = $('aybaQueueInfo');
    if (!q) return;
    if (member.phase !== 'waiting' || !info) {
      q.textContent = '';
      return;
    }
    var mine = member.ticketAt;
    var ahead = info.queue.filter(function (x) { return x.id !== member.ticketId && x.at < mine; }).length;
    var pos = ahead + 1;
    var text = t('ayba.queuePos', { n: pos });
    if (info.admins > 0) {
      if (info.free >= pos) text += ' · ' + t('ayba.etaSoon');
      else {
        var avg = info.avgMs || 5 * 60000;
        var rounds = Math.ceil((pos - info.free) / Math.max(1, info.admins));
        var mins = Math.max(1, Math.round((rounds * avg) / 60000));
        text += ' · ' + t('ayba.eta', { n: mins });
      }
    }
    q.textContent = text;
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
    if (topicText().length < 3) {
      updateAskButton();
      $('aybaTopic').focus();
      return;
    }
    App.clearMessages();
    member.admitted = '';
    member.adminSeen = false;
    member.hadCall = false;
    member.rated = false;
    member.transfer = null;
    memberPhase('asking');
    try {
      var label = fullName(user) + (user.company ? ' (' + user.company + ')' : '');
      var room = await App.startMemberRoom(label);
      if (!room.token) throw new Error('token');
      member.ticketAt = Date.now();
      member.desk = window.AybaDesk.createMemberDesk({
        config: cfg,
        pubsub: pubsub(),
        ticket: { name: user.firstName, surname: user.lastName, company: user.company, lang: App.myLang, topic: topicText(), code: room.code, token: room.token, at: member.ticketAt },
      });
      member.ticketId = member.desk.id;
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
      member.hadCall = true;
      memberPhase('call');
      return;
    }
    if (member.transfer && member.transfer.token && lobby.length) {
      // Devir: yeni anahtari getiren (devralan) yonetici iceri alinir, oda yeniden kilitlenir
      var next = lobby[0].clientId;
      App.approve(next);
      App.lock();
      lobby.slice(1).forEach(function (p) { App.reject(p.clientId); });
      member.previous = member.admitted;
      member.admitted = next;
      member.adminSeen = false;
      member.ticketId = member.transfer.ticketId;
      stopTransferDesk();
      member.transfer = null;
      return;
    }
    lobby.forEach(function (p) { if (p.clientId !== member.admitted) App.reject(p.clientId); });
    if (member.phase === 'call') {
      var here = (data.participants || []).some(function (p) { return p.clientId === member.admitted; });
      if (here) member.adminSeen = true;
      else if (member.adminSeen && !member.transfer) {
        // Yonetici gorusmeyi bitirdi
        App.leave();
      }
    }
  }

  function stopTransferDesk() {
    clearTimeout(member.transferTimer);
    if (member.transferDesk) {
      member.transferDesk.stop();
      member.transferDesk = null;
    }
  }

  // Oda icinden gelen denetim mesajlari (yalnizca iceri alinmis yoneticiden)
  async function memberRoomEvent(ev) {
    if (!ev || ev.from !== member.admitted || member.phase !== 'call') return;
    var d = ev.data || {};
    if (d.op === 'transfer' && !member.transfer) {
      try {
        App.unlock();
        var token = App.newInvite();
        for (var i = 0; i < 20 && !token; i++) {
          await new Promise(function (r) { setTimeout(r, 150); });
          token = App.newInvite();
        }
        if (!token) throw new Error('token');
        var info = { toId: d.toId, toName: d.toName, fromId: d.fromId, fromName: d.fromName, startAt: d.startAt };
        var desk = window.AybaDesk.createMemberDesk({
          config: cfg,
          pubsub: pubsub(),
          ticket: { name: user.firstName, surname: user.lastName, company: user.company, lang: App.myLang, topic: topicText(), code: App.roomCode, token: token, at: member.ticketAt, transfer: info },
        });
        member.transfer = { token: token, ticketId: desk.id, toName: d.toName };
        member.transferDesk = desk;
        await desk.start();
        App.sendEvent({ op: 'transfer-ready', ticketId: desk.id });
        toast(t('ayba.transferringTo', { name: d.toName }));
        member.transferTimer = setTimeout(cancelMemberTransfer, 120000);
      } catch (err) {
        console.warn(err);
        App.lock();
        App.sendEvent({ op: 'transfer-failed' });
      }
    } else if (d.op === 'transfer-cancel') {
      cancelMemberTransfer();
    }
  }

  function cancelMemberTransfer() {
    if (!member.transfer) return;
    stopTransferDesk();
    member.transfer = null;
    App.lock();
    // Eski yonetici artik odada degilse gorusme biter
    if (!App.participants.some(function (p) { return p.clientId === member.admitted; })) App.leave();
  }

  function memberLeft() {
    memberStopDesk();
    stopTransferDesk();
    member.transfer = null;
    if (member.phase === 'call') memberPhase('ended');
    else if (member.phase !== 'ended') memberPhase('idle');
  }

  // Gorusme sonrasi puan (1-5) ve istege bagli yorum: yoneticinin dokumune yazilir
  var rateStars = 0;
  function renderStars() {
    Array.prototype.forEach.call(document.querySelectorAll('#aybaStars button'), function (b) {
      var n = Number(b.dataset.n);
      b.classList.toggle('on', n <= rateStars);
      b.setAttribute('aria-pressed', String(n === rateStars));
    });
    $('aybaRateSend').disabled = !rateStars;
  }
  function initRating() {
    var box = $('aybaStars');
    for (var n = 1; n <= 5; n++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ayba-star';
      b.dataset.n = String(n);
      b.textContent = '★';
      b.setAttribute('aria-label', String(n) + '/5');
      b.addEventListener('click', function (e) {
        rateStars = Number(e.currentTarget.dataset.n);
        renderStars();
      });
      box.appendChild(b);
    }
    renderStars();
    $('aybaRateSend').addEventListener('click', function () {
      if (!rateStars || !member.ticketId) return;
      window.AybaDesk.sendRating(cfg, pubsub(), member.ticketId, { stars: rateStars, comment: $('aybaRateComment').value });
      member.rated = true;
      rateStars = 0;
      $('aybaRateComment').value = '';
      renderStars();
      memberPhase('ended');
    });
  }

  function initMember() {
    initMemberLang();
    // Yoneticiler cevrimici ziyaretci sayisini gorur (yalnizca ziyaretciler sayilir)
    if (cfg.adminPub) {
      var pid = null;
      try {
        pid = sessionStorage.getItem('ayba_presence_id');
        if (!pid) {
          pid = window.AybaCrypto.randomId();
          sessionStorage.setItem('ayba_presence_id', pid);
        }
      } catch (e) {
        pid = null;
      }
      // Ayni sekmede sayfa yenilenince "yeni ziyaretci" sayilmaz
      var presence = window.AybaDesk.createMemberPresence({
        config: cfg,
        pubsub: pubsub(),
        id: pid || undefined,
        onInfo: function (info) {
          member.info = info;
          renderMemberInfo();
        },
      });
      presence.start();
      window.addEventListener('pagehide', function () { presence.stop(); });
    }
    initRating();
    $('aybaTopic').addEventListener('input', updateAskButton);
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
  var admin = {
    desk: null, keys: null, phase: 'locked', ticket: null, start: 0, joinTimer: null, partnerSeen: false,
    known: new Set(), knownVisitors: new Set(), unlockedAt: 0, docs: [], sound: true, finishing: false,
    memberId: '', transferOut: null, transferTimer: null, handoverAt: 0, ratings: new Map(), pending: 0,
  };
  var RATING_WAIT_MS = 45000;
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

  // Ses: tarayici sesi ancak bir dokunustan sonra calar; ilk dokunusta hazirlanir
  var audioCtx = null;
  function audio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }
  function tones(list, peak) {
    if (!admin.sound) return;
    var ctx = audio();
    if (!ctx) return;
    var now = ctx.currentTime + 0.02;
    list.forEach(function (tn) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = tn.type || 'sine';
      o.frequency.value = tn.f;
      g.gain.setValueAtTime(0.0001, now + tn.at);
      g.gain.exponentialRampToValueAtTime(peak, now + tn.at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + tn.at + tn.len);
      o.connect(g).connect(ctx.destination);
      o.start(now + tn.at);
      o.stop(now + tn.at + tn.len + 0.02);
    });
  }
  // Siraya giren: iki tonlu
  function beep() {
    tones([{ f: 784, at: 0, len: 0.16 }, { f: 1046, at: 0.18, len: 0.16 }], 0.3);
  }
  // Yeni ziyaretci: farkli ve yuksek tonlu, uc vuruslu
  function visitorChime() {
    tones([
      { f: 1568, at: 0, len: 0.12, type: 'triangle' },
      { f: 2093, at: 0.14, len: 0.12, type: 'triangle' },
      { f: 2637, at: 0.28, len: 0.22, type: 'triangle' },
    ], 0.45);
  }

  // Masaustu bildirimi: yonetici baska sekmede ya da pencere kucukken
  function askNotifyPermission() {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } catch (e) {
      /* desteklenmiyor */
    }
  }
  function desktopNotify(text) {
    try {
      if (!document.hidden && document.hasFocus()) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var n = new Notification(t('ayba.title'), { body: text.replace(/^🔔\s*/, ''), icon: 'icon.svg', tag: 'ayba-' + Date.now() });
      n.onclick = function () {
        window.focus();
        n.close();
      };
    } catch (e) {
      /* yoksay */
    }
  }
  function alertAdmin(text) {
    visitorChime();
    toast(text);
    desktopNotify(text);
  }

  // Ekranda bir kez gorunen bildirim
  var toastTimer = null;
  function toast(text) {
    var el = $('aybaToast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 6000);
  }

  function mmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  var lastSnap = { waiting: [], sessions: [], adminsOnline: 1, visitorsOnline: 0 };
  function renderConsole(snap) {
    if (snap) lastSnap = snap;
    snap = lastSnap;
    var myId = adminId();
    // Devir kayitlari yalnizca devredilen yoneticide gorunur (en ustte)
    var waiting = snap.waiting.filter(function (w) { return !w.transfer || w.transfer.toId === myId; });
    waiting.sort(function (a, b) { return (b.transfer ? 1 : 0) - (a.transfer ? 1 : 0); });
    var fresh = waiting.filter(function (w) { return !admin.known.has(w.id); });
    waiting.forEach(function (w) { admin.known.add(w.id); });
    if (fresh.length && (admin.phase === 'console' || fresh[0].transfer)) {
      var f = fresh[0];
      var who = f.company || (f.name + ' ' + f.surname).trim();
      alertAdmin(f.transfer ? t('ayba.transferIn', { from: f.transfer.fromName, company: who }) : t('ayba.newTicket', { company: who }));
    }
    // Yeni ziyaretci: her ziyaretci icin bir kez (yonetici giris yaptigi anda
    // zaten sayfada olanlar icin bildirim yok)
    var settling = Date.now() - admin.unlockedAt < 3000;
    var newVisitors = (snap.visitorIds || []).filter(function (id) { return !admin.knownVisitors.has(id); });
    newVisitors.forEach(function (id) { admin.knownVisitors.add(id); });
    if (newVisitors.length && !settling && admin.phase === 'console' && !fresh.length) {
      alertAdmin(t('ayba.newVisitor'));
    }
    document.title = (waiting.length ? '(' + waiting.length + ') ' : '') + t('ayba.title');

    $('aybaWaitCount').textContent = String(waiting.length);
    $('aybaSessionCount').textContent = String(snap.sessions.length);
    $('aybaAdminsOnline').textContent = t('ayba.adminsOnline', { n: snap.adminsOnline }) +
      (snap.adminNames && snap.adminNames.length ? ' (' + snap.adminNames.join(', ') + ')' : '');
    $('aybaVisitorsOnline').textContent = t('ayba.visitorsOnline', { n: snap.visitorsOnline || 0 });

    var wl = $('aybaWaitList');
    wl.textContent = '';
    show('aybaWaitEmpty', !waiting.length);
    var num = 0;
    waiting.forEach(function (w) {
      var li = document.createElement('li');
      li.className = 'ayba-item' + (w.transfer ? ' transfer' : '');
      var i = w.transfer ? -1 : num++;
      var main = document.createElement('div');
      main.className = 'ayba-item-main';
      var company = document.createElement('strong');
      company.textContent = (w.transfer ? '↪ ' : (i + 1) + '. ') + (w.company || '—');
      var person = document.createElement('span');
      person.className = 'ayba-person';
      person.textContent = (w.name + ' ' + w.surname).trim() + ' · ' + App.langName(w.lang);
      main.append(company, person);
      if (w.topic) {
        var tp = document.createElement('span');
        tp.className = 'ayba-topic';
        tp.textContent = t('ayba.topicShort', { t: w.topic });
        main.appendChild(tp);
      }
      var wait = document.createElement('span');
      wait.className = 'ayba-wait';
      wait.textContent = w.transfer ? t('ayba.transferFrom', { name: w.transfer.fromName }) : t('ayba.waitingFor', { t: mmss(w.waitedMs) });
      main.appendChild(wait);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'online-btn primary ayba-take';
      if (w.claimedBy) {
        btn.disabled = true;
        btn.textContent = t('ayba.takenBy', { name: w.claimedBy });
      } else {
        btn.textContent = w.transfer ? t('ayba.acceptTransfer') : t('ayba.take');
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
      main.append(strong, person);
      since.className = 'ayba-wait';
      since.textContent = t('ayba.busyFor', { t: mmss(Date.now() - s.since) });
      main.appendChild(since);
      var tag = document.createElement('span');
      tag.className = 'ayba-busy-tag';
      tag.textContent = t('ayba.busy');
      li.append(main, tag);
      sl.appendChild(li);
    });

    var dl = $('aybaDocList');
    dl.textContent = '';
    show('aybaDocs', admin.docs.length > 0);
    show('aybaDocs', admin.docs.length > 0 || admin.pending > 0);
    show('aybaDocPending', admin.pending > 0);
    $('aybaDocPending').textContent = admin.pending ? t('ayba.waitingRating') : '';
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
    admin.unlockedAt = Date.now();
    admin.desk = window.AybaDesk.createAdminDesk({
      config: cfg,
      pubsub: pubsub(),
      keys: admin.keys,
      me: { id: adminId(), name: fullName(user) },
      onChange: renderConsole,
      onRating: function (id, rating) {
        admin.ratings.set(id, rating);
        var w = admin.ratingWaiters && admin.ratingWaiters[id];
        if (w) w(rating);
      },
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
    admin.memberId = '';
    admin.transferOut = null;
    admin.handoverAt = 0;
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
      // Devralinan gorusme: devir ani bu yoneticinin girdigi an
      if (admin.ticket && admin.ticket.transfer) admin.handoverAt = admin.start;
      adminPhase('call');
    }
    if (admin.phase === 'call') {
      var others = (data.participants || []).filter(function (p) { return p.clientId !== App.clientId; });
      if (!admin.memberId && others.length) {
        // Musteri: odayi kuran (oda sahibi)
        var owner = others.filter(function (p) { return p.clientId === data.ownerId; })[0];
        admin.memberId = (owner || others[0]).clientId;
      }
      var memberHere = others.some(function (p) { return p.clientId === admin.memberId; });
      if (memberHere) admin.partnerSeen = true;
      if (admin.transferOut) {
        var newcomer = others.filter(function (p) { return p.clientId !== admin.memberId; })[0];
        if (newcomer) {
          // Devralan yonetici iceri girdi: bu yoneticinin bolumu biter
          finishCall({ handedTo: admin.transferOut.toName, at: Date.now() });
          return;
        }
      }
      if (!memberHere && admin.partnerSeen) finishCall(); // musteri ayrildi
    }
  }

  // Devret: cevrimici baska bir yoneticiye
  function openTransfer() {
    if (admin.phase !== 'call' || admin.transferOut) return;
    var list = $('aybaTransferList');
    list.textContent = '';
    var others = (lastSnap.adminList || []);
    var busy = new Set((lastSnap.sessions || []).map(function (x) { return x.adminId; }));
    show('aybaTransferEmpty', !others.length);
    others.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'online-btn secondary ayba-transfer-pick';
      b.textContent = a.name + (busy.has(a.id) ? ' · ' + t('ayba.busy') : '');
      b.addEventListener('click', function () { startTransfer(a); });
      list.appendChild(b);
    });
    show('aybaTransferModal', true);
  }

  function startTransfer(target) {
    show('aybaTransferModal', false);
    if (!admin.ticket) return;
    var tr = admin.ticket.transfer;
    admin.transferOut = { toId: target.id, toName: target.name, at: Date.now() };
    App.sendEvent({
      op: 'transfer',
      toId: target.id,
      toName: target.name,
      fromId: adminId(),
      fromName: fullName(user),
      startAt: tr && tr.startAt ? tr.startAt : admin.start,
    });
    toast(t('ayba.transferWaiting', { name: target.name }));
    renderTransferBtn();
    clearTimeout(admin.transferTimer);
    admin.transferTimer = setTimeout(function () {
      if (!admin.transferOut) return;
      App.sendEvent({ op: 'transfer-cancel' });
      admin.transferOut = null;
      renderTransferBtn();
      App.showAlert(t('ayba.transferTimeout', { name: target.name }));
    }, 90000);
  }

  function adminRoomEvent(ev) {
    var d = (ev && ev.data) || {};
    if (d.op === 'transfer-failed' && admin.transferOut) {
      clearTimeout(admin.transferTimer);
      admin.transferOut = null;
      renderTransferBtn();
      App.showAlert(t('ayba.transferFailed'));
    }
  }

  function renderTransferBtn() {
    var b = $('aybaTransferBtn');
    if (!b) return;
    b.disabled = Boolean(admin.transferOut);
    b.textContent = admin.transferOut ? t('ayba.transferringShort') : t('ayba.transfer');
  }

  function waitRating(id) {
    if (admin.ratings.has(id)) return Promise.resolve(admin.ratings.get(id));
    admin.ratingWaiters = admin.ratingWaiters || {};
    return new Promise(function (resolve) {
      var done = function (r) {
        delete admin.ratingWaiters[id];
        resolve(r);
      };
      admin.ratingWaiters[id] = done;
      setTimeout(function () { if (admin.ratingWaiters[id]) done(null); }, RATING_WAIT_MS);
    });
  }

  async function finishCall(handover) {
    if (admin.finishing || !admin.ticket) return;
    admin.finishing = true;
    var tk = admin.ticket;
    var messages = App.messages();
    var me = fullName(user);
    var tr = tk.transfer;
    var start = new Date(tr && tr.startAt ? tr.startAt : admin.start || Date.now());
    var end = new Date();
    admin.ticket = null;
    clearTimeout(admin.joinTimer);
    clearTimeout(admin.transferTimer);
    admin.transferOut = null;
    admin.desk.endSession();
    App.leave();
    adminPhase('console');
    renderConsole();
    // Kim nereye kadar konustu: devir bolumleri
    var segments = [];
    if (tr) {
      segments.push({ admin: tr.fromName, from: start, to: new Date(admin.handoverAt || admin.start) });
      segments.push({ admin: me, from: new Date(admin.handoverAt || admin.start), to: end });
    } else {
      segments.push({ admin: me, from: start, to: handover ? new Date(handover.at) : end });
    }
    var meta = {
      start: start,
      end: end,
      adminName: me,
      customerName: tk.name,
      customerSurname: tk.surname,
      company: tk.company,
      customerLang: tk.lang,
      adminLang: App.myLang,
      topic: tk.topic || '',
      segments: segments,
      handoverIn: tr ? { at: admin.handoverAt || admin.start, fromName: tr.fromName, toName: me } : null,
      handoverOut: handover ? { at: handover.at, fromName: me, toName: handover.handedTo } : null,
      rating: null,
    };
    try {
      if (!handover) {
        // Musterinin puanini bekle (en fazla 45 sn)
        admin.pending++;
        renderConsole();
        meta.rating = await waitRating(tk.id);
        admin.pending--;
      }
      var labels = {
        title: t('ayba.docTitle'), start: t('ayba.docStart'), end: t('ayba.docEnd'), duration: t('ayba.docDuration'),
        admin: t('ayba.docAdmin'), customer: t('ayba.docCustomer'), company: t('ayba.docCompany'),
        customerLang: t('ayba.docLang'), count: t('ayba.docCount'), original: t('export.original'), translation: t('export.translation'),
        topic: t('ayba.docTopic'), rating: t('ayba.docRating'), noRating: t('ayba.docNoRating'), comment: t('ayba.docComment'),
        handedTo: t('ayba.docHandedTo'), handover: t('ayba.docHandover'), handedOut: t('ayba.docHandedOut'), transfer: t('ayba.docTransfer'),
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
        topic: meta.topic,
        rating: meta.rating,
        segments: meta.segments.map(function (x) { return { admin: x.admin, from: x.from.toISOString(), to: x.to.toISOString() }; }),
        handedTo: meta.handoverOut ? meta.handoverOut.toName : '',
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
    if (admin.phase === 'call') finishCall(admin.transferOut ? null : undefined);
    else if (admin.phase === 'joining') abortJoin();
  }

  // Hazir yanitlar: tek tikla gonderilir (karsi tarafin diline cevrilerek gider)
  var QUICK_KEY = 'ayba_quick_replies';
  function quickList() {
    try {
      var saved = JSON.parse(localStorage.getItem(QUICK_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) return saved.filter(Boolean).slice(0, 30);
    } catch (e) {
      /* yoksay */
    }
    // Varsayilan hazir yanitlar yoneticinin KONUSMA dilinde (oradan karsiya cevrilir)
    var all = window.AYBA_STRINGS || {};
    var base = String(App.myLang || 'en').toLowerCase();
    var code = base.indexOf('zh') === 0 ? (/tw|hk|hant/.test(base) ? 'zh-TW' : 'zh-CN') : base.split('-')[0];
    if (code === 'nb' || code === 'nn') code = 'no';
    if (code === 'iw') code = 'he';
    var defs = (all[code] && all[code]['ayba.quickDefaults']) || (all.en && all.en['ayba.quickDefaults']) || t('ayba.quickDefaults');
    return defs.split('|').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function renderQuick() {
    var list = $('aybaQuickList');
    list.textContent = '';
    quickList().forEach(function (text) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ayba-quick-item';
      b.textContent = text;
      b.addEventListener('click', function () {
        show('aybaQuickPop', false);
        App.sendText(text);
      });
      list.appendChild(b);
    });
  }
  function initQuick() {
    var form = $('textTranslateForm');
    var wrap = document.createElement('div');
    wrap.className = 'ayba-quick-wrap';
    wrap.innerHTML =
      '<button type="button" id="aybaQuickBtn" class="ayba-quick-btn" aria-haspopup="true"></button>' +
      '<div id="aybaQuickPop" class="ayba-quick-pop hidden" role="menu">' +
      '<div id="aybaQuickList" class="ayba-quick-list"></div>' +
      '<div id="aybaQuickEditBox" class="ayba-quick-edit hidden">' +
      '<textarea id="aybaQuickText" rows="6"></textarea>' +
      '<div class="ayba-quick-edit-btns"><button type="button" id="aybaQuickSave" class="online-btn primary"></button>' +
      '<button type="button" id="aybaQuickReset" class="online-btn secondary"></button></div></div>' +
      '<button type="button" id="aybaQuickEdit" class="ayba-link"></button></div>';
    form.insertBefore(wrap, form.firstChild);
    var labels = function () {
      $('aybaQuickBtn').textContent = '⚡';
      $('aybaQuickBtn').title = t('ayba.quick');
      $('aybaQuickBtn').setAttribute('aria-label', t('ayba.quick'));
      $('aybaQuickEdit').textContent = t('ayba.quickEdit');
      $('aybaQuickSave').textContent = t('ayba.quickSave');
      $('aybaQuickReset').textContent = t('ayba.quickReset');
      $('aybaQuickText').placeholder = t('ayba.quickHelp');
    };
    labels();
    $('aybaQuickBtn').addEventListener('click', function () {
      labels();
      renderQuick();
      show('aybaQuickEditBox', false);
      $('aybaQuickPop').classList.toggle('hidden');
    });
    $('aybaQuickEdit').addEventListener('click', function () {
      $('aybaQuickText').value = quickList().join('\n');
      show('aybaQuickEditBox', true);
      $('aybaQuickText').focus();
    });
    $('aybaQuickSave').addEventListener('click', function () {
      var lines = $('aybaQuickText').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 30);
      try { localStorage.setItem(QUICK_KEY, JSON.stringify(lines)); } catch (e) { /* yoksay */ }
      show('aybaQuickEditBox', false);
      renderQuick();
    });
    $('aybaQuickReset').addEventListener('click', function () {
      try { localStorage.removeItem(QUICK_KEY); } catch (e) { /* yoksay */ }
      $('aybaQuickText').value = quickList().join('\n');
      renderQuick();
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) show('aybaQuickPop', false);
    });
  }

  function initAdmin() {
    show('aybaAdmin', true);
    var leaveBtn = $('leaveRoomBtn');
    leaveBtn.removeAttribute('data-i18n');
    leaveBtn.textContent = t('ayba.end');
    // Gorusmeyi devret dugmesi: "Gorusmeyi bitir"in yaninda
    var trBtn = document.createElement('button');
    trBtn.type = 'button';
    trBtn.id = 'aybaTransferBtn';
    trBtn.className = 'online-btn secondary';
    leaveBtn.parentNode.insertBefore(trBtn, leaveBtn);
    trBtn.addEventListener('click', openTransfer);
    renderTransferBtn();
    $('aybaTransferClose').addEventListener('click', function () { show('aybaTransferModal', false); });
    initQuick();
    adminPhase('locked');
    $('aybaToast').addEventListener('click', function () { $('aybaToast').classList.add('hidden'); });
    // Ses ilk dokunusta hazirlanir (tarayici kurali)
    document.addEventListener('pointerdown', audio, { capture: true });
    document.addEventListener('keydown', audio, { capture: true });
    $('aybaUnlock').addEventListener('submit', function (e) {
      e.preventDefault();
      audio();
      askNotifyPermission();
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
      $('aybaSoundBtn').classList.toggle('off', !admin.sound);
      if (admin.sound) visitorChime();
      askNotifyPermission();
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
      ready();
      return;
    }
    renderWho();
    $('aybaSignOut').addEventListener('click', function () { ident.signOut(); });
    window.AybaHooks = {
      roomState: function (data) { if (user.role === 'admin') adminRoomState(data); else memberRoomState(data); },
      roomEvent: function (ev) { if (user.role === 'admin') adminRoomEvent(ev); else memberRoomEvent(ev); },
      left: function () { if (user.role === 'admin') adminLeft(); else memberLeft(); },
    };
    if (user.role === 'admin') initAdmin();
    else initMember();
    // Arayuz dili degisince elle yazilan (data-i18n disi) yazilari da yenile
    new MutationObserver(function () {
      document.title = t('ayba.title');
      renderWho();
      if (user.role === 'admin') {
        $('leaveRoomBtn').textContent = t('ayba.end');
        renderTransferBtn();
        adminPhase(admin.phase === 'aborting' ? 'console' : admin.phase);
        if (admin.desk) renderConsole();
      } else {
        renderMemberInfo();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    ready();
  }

  // Uygulama ve yazilar hazir: sayfayi goster
  function ready() {
    requestAnimationFrame(function () { document.documentElement.classList.remove('ayba-booting'); });
  }

  if (window.AybaApp) start();
  else window.addEventListener('ayba-app-ready', start, { once: true });
})();
