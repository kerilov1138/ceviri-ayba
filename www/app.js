import { LANGUAGES, findLanguage } from './languages.js';
import { initI18n, t, langName, setUiLang, getUiLang, isRtl, onUiLangChange, UI_LANGS } from './i18n.js';
import './support-strings.js';
import { censor, stripMaskForSpeech } from './profanity.js';
import { initCamera } from './camera.js';
import { createVideoMesh } from './video.js';

// Online oda modulu (online-relay.js) karsiya gidecek metni de filtrelesin
window.CeviriCensor = censor;

const IS_NATIVE_APP = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// Davet linki / QR ile web sitesinden gelen kisi (misafir): yalnizca Online Oda gorur.
// Kamera, Canli Dongu ve Yuz Yuze sekmeleri yalnizca uygulamada (APK) vardir.
// Bilgisayar surumu (CEVIRI_WIN): tarayicida acilir ama uygulamadaki tum modlar vardir
// CEVIRI_AYBARION canli destek: uye odayi kurar (uygulama gibi), yonetici
// tek kullanimlik oda anahtariyla girer (davetli misafir gibi)
const AYBA_ROLE = window.AYBA_ROLE === 'admin' || window.AYBA_ROLE === 'member' ? window.AYBA_ROLE : '';
if (AYBA_ROLE) document.documentElement.classList.add('ayba', `ayba-${AYBA_ROLE}`);
const IS_DESKTOP = !IS_NATIVE_APP && (Boolean(window.CEVIRI_DESKTOP) || AYBA_ROLE === 'member');
const IS_GUEST = !IS_NATIVE_APP && !IS_DESKTOP;
if (IS_GUEST) document.documentElement.classList.add('guest-mode');

// ---------------------------------------------------------------------------
// Tek kullanimlik davet linki: .../#j=<kodlanmis oda + davet anahtari>
// Misafir oda kodunu gormez; link adres cubugundan hemen silinir.
// ---------------------------------------------------------------------------
const INVITE_SESSION_KEY = 'ceviri_invite';

function encodeInvite(code, token) {
  return btoa(`${code}.${token}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeInvite(str) {
  try {
    const raw = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
    const i = raw.indexOf('.');
    if (i < 0) return null;
    const code = raw.slice(0, i).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const token = raw.slice(i + 1).replace(/[^A-Za-z0-9_-]/g, '');
    return code.length >= 4 && token.length >= 16 ? { code, token } : null;
  } catch {
    return null;
  }
}

function readGuestInvite() {
  if (!IS_GUEST || AYBA_ROLE) return null; // canli destekte oda anahtari masadan gelir
  let invite = null;
  const m = window.location.hash.match(/[#&]j=([A-Za-z0-9_-]+)/) || window.location.hash.match(/^#([A-Za-z0-9_-]{20,})$/);
  if (m) invite = decodeInvite(m[1]);
  const params = new URLSearchParams(window.location.search);
  // Linki adres cubugundan sil (kopyalanip baskasina iletilemesin, oda kodu gorunmesin)
  if (m || params.has('room')) {
    params.delete('room');
    const q = params.toString();
    try {
      window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : ''));
    } catch {
      // yoksay
    }
  }
  try {
    if (invite) sessionStorage.setItem(INVITE_SESSION_KEY, JSON.stringify(invite));
    else invite = JSON.parse(sessionStorage.getItem(INVITE_SESSION_KEY) || 'null');
  } catch {
    // depolama yok
  }
  return invite && invite.code && invite.token ? invite : null;
}

let guestInvite = readGuestInvite();

function forgetGuestInvite() {
  guestInvite = null;
  try {
    sessionStorage.removeItem(INVITE_SESSION_KEY);
  } catch {
    // yoksay
  }
  updateGuestJoinView();
}

// Misafir: davet linki yoksa katil dugmesi yerine aciklama gorunur
function updateGuestJoinView() {
  if (!IS_GUEST) return;
  const note = document.getElementById('inviteRequiredNote');
  const join = document.getElementById('joinRoomBtn');
  if (note) note.classList.toggle('hidden', Boolean(guestInvite));
  if (join) join.classList.toggle('hidden', !guestInvite);
}

let cameraCtl = null; // kamera sekmesi (yalnizca uygulamada)

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

const STORAGE_KEYS = {
  myLang: 'ceviri_my_lang',
  partnerLang: 'ceviri_partner_lang',
  myName: 'ceviri_my_name',
  settings: 'ceviri_settings',
};

// Ilk acilista konusma dili: tarayicinin dili (listede varsa)
function browserSpeechLang() {
  const prefs = [...(navigator.languages || []), navigator.language].filter(Boolean);
  for (const p of prefs) {
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === p.toLowerCase());
    if (exact) return exact.code;
    const base = p.toLowerCase().split('-')[0];
    const near = LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base);
    if (near) return near.code;
  }
  return '';
}

function getTabClientId() {
  // Misafir: ayni davet linkiyle ayni cihazdan her donuste ayni kimlik
  // (sekme kapanip link yeniden acilsa da girer; linkin iletildigi baska cihaz giremez)
  if (IS_GUEST && guestInvite) {
    const key = `ceviri_guest_${guestInvite.token.slice(0, 16)}`;
    try {
      let gid = localStorage.getItem(key);
      if (!gid) {
        gid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        localStorage.setItem(key, gid);
      }
      sessionStorage.setItem('ceviri_client_id', gid);
      return gid;
    } catch {
      // depolama yoksa sekme kimligi kullanilir
    }
  }
  let id = sessionStorage.getItem('ceviri_client_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    sessionStorage.setItem('ceviri_client_id', id);
  }
  return id;
}

const state = {
  watch: 'off', // 'off' | 'app' (saat uygulamasi) | 'notify' (bildirimle saate)
  headsetConnected: false, // kulaklik takili mi (yalnizca uygulama)
  voiceMode: false, // online odada herkes ayni dilde: dogrudan sesli sohbet
  micMuted: false, // sesli sohbette mikrofonum kapali mi
  silenced: new Set(), // sesli sohbette sesini kendim icin kistigim kisiler
  speakerToo: false, // "Ben"in cevirisi telefondan da calsin mi
  mode: 'loop', // 'loop' | 'face' | 'online'
  isActive: false,
  phase: 'idle', // 'idle' | 'listening' | 'translating' | 'speaking'
  activeSpeaker: 'me', // 'me' | 'partner'
  myLang: localStorage.getItem(STORAGE_KEYS.myLang) || browserSpeechLang() || 'tr-TR',
  partnerLang: localStorage.getItem(STORAGE_KEYS.partnerLang) || 'en-US',
  myName: localStorage.getItem(STORAGE_KEYS.myName) || '',
  partnerName: '',
  clientId: getTabClientId(),
  roomCode: '',
  activeMicClientId: null,
  activeMicName: null,
  pendingTranscript: '',
  eventSource: null,
  onlineInfo: { onlineMode: false, status: 'disabled', publicUrl: null },
  onlinePollTimer: null,
  seenMessageIds: new Set(),
  messages: [],
  voices: [],
  settings: {
    autoSpeak: true,
    autoLoop: true,
    autoDetect: true, // konusani dilinden tani (Canli Dongu)
    keepAwake: true, // canli ceviride / odada ekran acik kalsin
    headsetButton: true, // kulaklik dugmesiyle konus (uygulama)
    flipPartner: false,
    speechRate: 1.0,
    ...loadSavedSettings(),
  },
  recognition: null,
  recognitionGen: 0,
  mediaStream: null,
  audioCtx: null,
  analyser: null,
  rafId: null,
  speakWatchdog: null,
  speakKeepAlive: null,
  resumeTimer: null,
  // Online oda: 3+ kisi grup modu (soz sirasi), katilimcilar, kamera
  group: false,
  queue: [],
  participants: [],
  handRaised: false,
  turnTimer: null,
  turnStartedAt: 0, // benim konusmamin baslangici (geri sayim)
  holderSince: 0, // su anki konusanin baslangici (yerel saat)
  ownerId: null,
  roomLocked: false,
  lobby: [], // kapida bekleyenler (oda sahibi gorur)
  isCreator: false, // bu cihaz odayi kurdu mu
  awaitingApproval: false, // ben kapida bekliyorum (linkle gelen misafir)
  incomingChain: Promise.resolve(),
  videoMesh: null,
};

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
}

// DOM Elements
const els = {
  myLangSelect: document.getElementById('myLangSelect'),
  partnerLangSelect: document.getElementById('partnerLangSelect'),
  swapLangsBtn: document.getElementById('swapLangsBtn'),
  modeCameraBtn: document.getElementById('modeCameraBtn'),
  cameraStage: document.getElementById('cameraStage'),
  modeLoopBtn: document.getElementById('modeLoopBtn'),
  modeFaceBtn: document.getElementById('modeFaceBtn'),
  modeOnlineBtn: document.getElementById('modeOnlineBtn'),
  onlineBar: document.getElementById('onlineBar'),
  onlineJoinView: document.getElementById('onlineJoinView'),
  onlineActiveView: document.getElementById('onlineActiveView'),
  onlineNameInput: document.getElementById('onlineNameInput'),
  onlineRoomInput: document.getElementById('onlineRoomInput'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  roomCodeBadge: document.getElementById('roomCodeBadge'),
  tunnelStatusBadge: document.getElementById('tunnelStatusBadge'),
  partnerPresenceText: document.getElementById('partnerPresenceText'),
  inviteLinkInput: document.getElementById('inviteLinkInput'),
  copyInviteBtn: document.getElementById('copyInviteBtn'),
  leaveRoomBtn: document.getElementById('leaveRoomBtn'),
  myLangCardLabel: document.getElementById('myLangCardLabel'),
  partnerLangCardLabel: document.getElementById('partnerLangCardLabel'),
  turnControls: document.querySelector('.turn-controls'),
  loopStage: document.getElementById('loopStage'),
  faceStage: document.getElementById('faceStage'),
  statusPill: document.getElementById('statusPill'),
  statusText: document.getElementById('statusText'),
  alertBanner: document.getElementById('alertBanner'),
  alertMessage: document.getElementById('alertMessage'),
  alertCloseBtn: document.getElementById('alertCloseBtn'),
  mainToggleBtn: document.getElementById('mainToggleBtn'),
  orbLabel: document.getElementById('orbLabel'),
  turnMeBtn: document.getElementById('turnMeBtn'),
  turnPartnerBtn: document.getElementById('turnPartnerBtn'),
  turnMeLabel: document.getElementById('turnMeLabel'),
  turnPartnerLabel: document.getElementById('turnPartnerLabel'),
  swapTurnBtn: document.getElementById('swapTurnBtn'),
  interimText: document.getElementById('interimText'),
  visualizerCanvas: document.getElementById('visualizerCanvas'),
  facePartnerCard: document.getElementById('facePartnerCard'),
  faceMeCard: document.getElementById('faceMeCard'),
  facePartnerLangBadge: document.getElementById('facePartnerLangBadge'),
  faceMeLangBadge: document.getElementById('faceMeLangBadge'),
  facePartnerText: document.getElementById('facePartnerText'),
  faceMeText: document.getElementById('faceMeText'),
  facePartnerBtn: document.getElementById('facePartnerBtn'),
  faceMeBtn: document.getElementById('faceMeBtn'),
  chatStream: document.getElementById('chatStream'),
  emptyState: document.getElementById('emptyState'),
  messageCount: document.getElementById('messageCount'),
  textTranslateForm: document.getElementById('textTranslateForm'),
  textSpeakerSelect: document.getElementById('textSpeakerSelect'),
  textInput: document.getElementById('textInput'),
  attachBtn: document.getElementById('attachBtn'),
  participantsGrid: document.getElementById('participantsGrid'),
  roomTools: document.getElementById('roomTools'),
  lockRoomBtn: document.getElementById('lockRoomBtn'),
  lockedBadge: document.getElementById('lockedBadge'),
  videoReceiveBtn: document.getElementById('videoReceiveBtn'),
  attachInput: document.getElementById('attachInput'),
  exportBtn: document.getElementById('exportBtn'),
  exportModal: document.getElementById('exportModal'),
  autoDetectToggle: document.getElementById('autoDetectToggle'),
  keepAwakeToggle: document.getElementById('keepAwakeToggle'),
  headsetButtonToggle: document.getElementById('headsetButtonToggle'),
  clearBtn: document.getElementById('clearBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  autoSpeakToggle: document.getElementById('autoSpeakToggle'),
  flipPartnerToggle: document.getElementById('flipPartnerToggle'),
  speechRateRange: document.getElementById('speechRateRange'),
  rateValueLabel: document.getElementById('rateValueLabel'),
};

function showAlert(msg) {
  els.alertMessage.textContent = msg;
  els.alertBanner.classList.remove('hidden');
}

function hideAlert() {
  els.alertBanner.classList.add('hidden');
}

// Tek varyantli dillerde bolge adini gosterme: "Turkish (Turkey)" yerine "Turkish"
const LANG_BASE_COUNT = LANGUAGES.reduce((acc, l) => {
  const base = l.code.split('-')[0];
  acc[base] = (acc[base] || 0) + 1;
  return acc;
}, {});

function displayLangName(code, fallback) {
  const base = String(code || '').split('-')[0];
  return langName(LANG_BASE_COUNT[base] === 1 ? base : code, fallback);
}

function populateLanguageSelects() {
  const buildOptions = (selectEl, selectedCode) => {
    selectEl.innerHTML = '';
    for (const lang of LANGUAGES) {
      const opt = document.createElement('option');
      opt.value = lang.code;
      const localName = displayLangName(lang.code, lang.name);
      opt.textContent = localName.toLocaleLowerCase() === lang.nativeName.toLocaleLowerCase()
        ? lang.nativeName
        : `${localName} (${lang.nativeName})`;
      if (lang.code === selectedCode) opt.selected = true;
      selectEl.appendChild(opt);
    }
  };
  buildOptions(els.myLangSelect, state.myLang);
  buildOptions(els.partnerLangSelect, state.partnerLang);
  updateLanguageBadges();
}

function updateLanguageBadges() {
  const myLangObj = findLanguage(state.myLang);
  const partnerLangObj = findLanguage(state.partnerLang);
  const meDisplay = state.mode === 'online' && state.myName ? state.myName : t('who.me');
  const partnerDisplay = state.mode === 'online' && state.partnerName ? state.partnerName : t('who.partner');

  els.turnMeLabel.textContent = `${meDisplay} (${myLangObj.short})`;
  els.turnPartnerLabel.textContent = `${partnerDisplay} (${partnerLangObj.short})`;
  els.faceMeLangBadge.textContent = myLangObj.short;
  els.facePartnerLangBadge.textContent = partnerLangObj.short;

  if (state.mode === 'online') {
    els.myLangCardLabel.textContent = state.myName
      ? t('lang.mineNamed', { name: state.myName.toLocaleUpperCase() })
      : t('lang.mine');
    els.partnerLangCardLabel.textContent = state.partnerName
      ? t('lang.partnerNamed', { name: state.partnerName.toLocaleUpperCase() })
      : t('lang.partner');
  } else {
    els.myLangCardLabel.textContent = t('lang.mine');
    els.partnerLangCardLabel.textContent = t('lang.partner');
  }
  if (cameraCtl) cameraCtl.updateDirection();
}

function setPhase(phase) {
  state.phase = phase;
  els.statusPill.dataset.state = phase;

  const labels = {
    idle: t('status.idle'),
    listening: t('status.listening'),
    translating: t('status.translating'),
    speaking: t('status.speaking'),
  };
  els.statusText.textContent = labels[phase] || t('status.idle');
}

function updateTurnUI() {
  const isMe = state.activeSpeaker === 'me';
  const lockedByRemote =
    state.mode === 'online' &&
    Boolean(state.activeMicClientId) &&
    state.activeMicClientId !== state.clientId;

  els.turnMeBtn.classList.toggle('active', isMe);
  els.turnPartnerBtn.classList.toggle('active', !isMe);
  els.mainToggleBtn.dataset.active = String(state.isActive);
  els.mainToggleBtn.dataset.speaker = state.activeSpeaker;
  const groupWait = lockedByRemote && state.group && !state.voiceMode;
  const inQueue = groupWait && state.queue.includes(state.clientId);
  // 2 kisi: karsidaki konusurken dugme kilitli (bugunku davranis).
  // 3+ kisi: dugme "Soz Iste" / "Siradan Cik" olur.
  els.mainToggleBtn.disabled =
    (lockedByRemote && !state.group) || (state.mode === 'online' && (state.awaitingApproval || state.voiceMode));
  els.mainToggleBtn.classList.toggle('locked-remote', lockedByRemote && !state.group);
  els.mainToggleBtn.classList.toggle('raise-hand', groupWait);
  els.mainToggleBtn.classList.toggle('in-queue', inQueue);
  els.orbLabel.textContent = groupWait
    ? inQueue
      ? t('group.cancelHand')
      : t('group.raiseHand')
    : lockedByRemote
      ? t('orb.locked')
      : state.isActive
        ? state.mode === 'online' && state.group && state.turnStartedAt
          ? `${t('orb.stop')} · ${turnSecondsLeft(state.turnStartedAt)}`
          : t('orb.stop')
        : t('orb.start');
  if (state.mode === 'online' && state.awaitingApproval) els.orbLabel.textContent = t('lobby.waitingShort');
  if (state.mode === 'online' && state.voiceMode && !state.awaitingApproval) els.orbLabel.textContent = t('voice.on');

  els.faceMeCard.classList.toggle('active-me', state.isActive && isMe);
  els.facePartnerCard.classList.toggle('active-partner', state.isActive && !isMe);
  els.faceMeBtn.querySelector('span').textContent =
    state.isActive && isMe ? t('orb.stop') : t('face.speak');
  els.facePartnerBtn.querySelector('span').textContent =
    state.isActive && !isMe ? t('orb.stop') : t('face.speak');
}

// Dil degisince yeniden yazilabilmesi icin anahtarla ayarlanan metinler
const i18nSlots = { interim: null, badge: null, presence: null };

function renderSlot(slot) {
  const v = i18nSlots[slot];
  if (!v) return;
  const vars = { ...(v.vars || {}) };
  if (vars.lang && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(vars.lang)) vars.lang = displayLangName(vars.lang, vars.langFallback);
  const text = t(v.key, vars);
  if (slot === 'interim') {
    if (v.html) els.interimText.innerHTML = text;
    else els.interimText.textContent = text;
    els.interimText.classList.remove('live');
  } else if (slot === 'badge') {
    els.tunnelStatusBadge.textContent = text;
  } else if (slot === 'presence') {
    els.partnerPresenceText.textContent = text;
  }
}

function setInterimKey(key, vars, html = false) {
  i18nSlots.interim = { key, vars, html };
  renderSlot('interim');
}

function setBadgeKey(key, vars) {
  i18nSlots.badge = { key, vars };
  renderSlot('badge');
}

function setPresenceKey(key, vars) {
  i18nSlots.presence = { key, vars };
  renderSlot('presence');
}

function setInterimMessage(text, isLive = false) {
  i18nSlots.interim = null;
  els.interimText.textContent = text;
  els.interimText.classList.toggle('live', isLive);
}

// Speech Synthesis (TTS)
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  state.voices = window.speechSynthesis.getVoices();
}

function pickBestVoice(langCode) {
  if (!state.voices.length) loadVoices();
  const exact = state.voices.find((v) => v.lang.toLowerCase() === langCode.toLowerCase());
  if (exact) return exact;
  const prefix = langCode.split('-')[0].toLowerCase();
  return state.voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) || null;
}

function clearSpeechTimers() {
  if (state.speakWatchdog) {
    clearTimeout(state.speakWatchdog);
    state.speakWatchdog = null;
  }
  if (state.speakKeepAlive) {
    clearInterval(state.speakKeepAlive);
    state.speakKeepAlive = null;
  }
}

function stopSpeaking() {
  clearSpeechTimers();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (AudioRoute && state.speakerToo) AudioRoute.stop().catch(() => {});
}

// iPhone/iPad (iOS'ta Chrome dahil): tarayici, kullanici bir kez dokunmadan
// sayfanin kendiliginden baslattigi sesli okumayi sessizce engeller. Gelen
// ceviriler dokunmadan okundugu icin sesi ilk dokunuslarda bir kez "acariz":
// duyulmayan bos bir okuma baslatilir, sonraki tum okumalar serbest kalir.
let speechUnlockTries = 0;
function unlockSpeech() {
  if (speechUnlockTries >= 3 || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) return;
  speechUnlockTries += 1;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
    if (synth.paused) synth.resume();
  } catch {
    // desteklenmiyor
  }
}
['touchend', 'click', 'keydown'].forEach((ev) =>
  document.addEventListener(ev, unlockSpeech, { capture: true, passive: true })
);

// ---------------------------------------------------------------------------
// Kulaklik takiliyken "Ben"in cevirisini telefon hoparlorunden de ver
// (yalnizca uygulamada; Canli Dongu ve Yuz Yuze). Karsidakinin cevirisi
// her zaman yalnizca kulakliktan gelir.
// ---------------------------------------------------------------------------
const AudioRoute = (() => {
  if (!IS_NATIVE_APP) return null;
  const reg = (window.capacitorExports && window.capacitorExports.registerPlugin) || (window.Capacitor && window.Capacitor.registerPlugin);
  try {
    return reg ? reg('AudioRoute') : null;
  } catch {
    return null;
  }
})();

// ---------------------------------------------------------------------------
// Saat (Galaxy Watch / Wear OS). "Saate aktar": saatte CEVIRI saat uygulamasi
// varsa onu acar (saatin mikrofonu "Ben"i dinler); yoksa ceviriyi bildirimle
// saate yansitir. "Saatten cikar" ile kapanir. Varsayilan kapali.
// ---------------------------------------------------------------------------
const WatchBridge = (() => {
  if (!IS_NATIVE_APP) return null;
  const reg = (window.capacitorExports && window.capacitorExports.registerPlugin) || (window.Capacitor && window.Capacitor.registerPlugin);
  try {
    return reg ? reg('WatchBridge') : null;
  } catch {
    return null;
  }
})();

const watchApp = () => state.watch === 'app';
let lastWatchJson = '';
let watchChain = Promise.resolve();

function renderWatchButtons() {
  const on = state.watch !== 'off';
  const label = on ? t('watch.stopBtn') : t('watch.send');
  const loopOrFace = state.mode === 'loop' || state.mode === 'face';
  const inRoom = state.mode === 'online' && Boolean(state.roomCode);
  [
    [document.getElementById('watchBtn'), loopOrFace],
    [document.getElementById('watchRoomBtn'), inRoom],
  ].forEach(([btn, show]) => {
    if (!btn) return;
    btn.classList.toggle('hidden', !WatchBridge || !show);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = label;
  });
}

async function toggleWatch() {
  if (!WatchBridge) return;
  if (state.watch !== 'off') {
    watchOff(true);
    return;
  }
  let available = false;
  try {
    available = Boolean((await WatchBridge.isWatchAppAvailable()).available);
  } catch {
    available = false;
  }
  if (available) {
    try {
      await WatchBridge.openWatchApp();
    } catch {
      showAlert(t('watch.openManually'));
    }
    state.watch = 'app';
    // Canli Dongu: telefon artik yalnizca karsidakini dinler, "Ben" saatte
    if (state.mode === 'loop' && state.isActive && state.activeSpeaker !== 'partner') switchTurn('partner');
  } else {
    let granted = false;
    try {
      granted = Boolean((await WatchBridge.ensureNotificationPermission()).granted);
    } catch {
      granted = false;
    }
    if (!granted) {
      showAlert(t('watch.notifDenied'));
      return;
    }
    state.watch = 'notify';
    showAlert(t('watch.fallbackNotify'));
  }
  lastWatchJson = '';
  renderWatchButtons();
  pushWatchState();
  applyWakeLock();
}

function watchOff(tellWatch) {
  if (!WatchBridge || state.watch === 'off') return;
  if (tellWatch && state.watch === 'app') WatchBridge.send({ path: '/ceviri/finish', data: '' }).catch(() => {});
  WatchBridge.cancelNotification().catch(() => {});
  state.watch = 'off';
  lastWatchJson = '';
  renderWatchButtons();
  applyWakeLock();
}

function watchUiStrings() {
  return {
    speakMe: t('watch.speakMe'),
    stop: t('orb.stop'),
    listening: t('watch.listening'),
    tapToSpeak: t('watch.tapToSpeak'),
    phoneSpeaking: t('watch.phoneSpeaking'),
    noSpeech: t('watch.noSpeech'),
    connecting: t('watch.connecting'),
    close: t('watch.stopBtn'),
    accept: t('lobby.accept'),
    reject: t('lobby.reject'),
    hint: t('watch.hint'),
  };
}

function buildWatchState() {
  const modeKey = { loop: 'mode.loop', face: 'mode.face', online: 'mode.online', camera: 'mode.camera' }[state.mode] || 'mode.loop';
  const my = findLanguage(state.myLang).short;
  const partner = findLanguage(state.partnerLang).short;
  const m = state.messages[state.messages.length - 1];
  let last = null;
  if (m) {
    const mine = m.speaker === 'me';
    const who = m.senderName || (mine ? t('who.meUpper') : t('who.partnerUpper'));
    const langs = m.targetLang ? `${findLanguage(m.sourceLang).short} → ${findLanguage(m.targetLang).short}` : findLanguage(m.sourceLang).short;
    last = {
      id: `${state.messages.length}:${m.time}`,
      side: mine ? 'me' : 'partner',
      who: `${who} · ${langs}`,
      text: m.translatedText || m.originalText || '',
    };
  }
  const amOwner = state.mode === 'online' && state.roomCode && state.ownerId === state.clientId;
  return {
    mode: state.mode,
    myLang: state.myLang,
    title: state.mode === 'online' ? t(modeKey) : `${t(modeKey)} · ${my} ⇄ ${partner}`,
    mainLabel: els.orbLabel ? els.orbLabel.textContent : '',
    last,
    lobby: amOwner ? state.lobby.map((p) => ({ id: p.clientId, text: t('lobby.waiting', { name: censor(p.name || '?', state.myLang) }) })) : [],
    ui: watchUiStrings(),
  };
}

function pushWatchState() {
  if (!WatchBridge || state.watch === 'off') return;
  const st = buildWatchState();
  const json = JSON.stringify(st);
  if (json === lastWatchJson) return;
  lastWatchJson = json;
  if (state.watch === 'app') {
    WatchBridge.send({ path: '/ceviri/state', data: json }).catch(() => {});
    return;
  }
  // Bildirim (saat uygulamasi yok): ayni bilgi + dugmeler
  const close = { id: 'close', label: t('watch.stopBtn') };
  let actions;
  if (state.mode === 'loop') actions = [{ id: 'toggle', label: st.mainLabel }, { id: 'swap', label: t('turn.swap') }, close];
  else if (state.mode === 'face') actions = [{ id: 'faceMe', label: t('watch.speakMe') }, close];
  else if (state.mode === 'online') actions = [{ id: 'toggle', label: st.mainLabel }, close];
  else actions = [close];
  WatchBridge.showNotification({
    title: st.title,
    text: st.last ? `${st.last.who}\n${st.last.text}` : t('watch.hint'),
    actions: JSON.stringify(actions),
    lobby: JSON.stringify(st.lobby),
    acceptLabel: t('lobby.accept'),
    rejectLabel: t('lobby.reject'),
  }).catch(() => {});
}

// Saatten gelen "Ben" konusmasi (Canli Dongu / Yuz Yuze)
async function waitIdle() {
  for (let i = 0; i < 70 && ['translating', 'speaking'].includes(state.phase); i++) {
    await new Promise((r) => setTimeout(r, 150));
  }
}

function onWatchUtterance(text) {
  watchChain = watchChain
    .then(async () => {
      text = String(text || '').trim();
      if (!text || (state.mode !== 'loop' && state.mode !== 'face')) return;
      await waitIdle(); // karsidakinin cevirisi bitsin
      const wasActive = state.isActive;
      if (wasActive) abortRecognition(); // telefon kendi seslendirmesini duymasin
      await handleUtterance(text, 'me');
      if (wasActive && state.isActive) {
        if (state.mode === 'loop' && watchApp()) {
          state.activeSpeaker = 'partner';
          updateTurnUI();
        }
        startListening();
      }
    })
    .catch(() => {});
}

function lobbyDecision(id, accept) {
  if (!id || !window.CeviriRelay || state.ownerId !== state.clientId) return;
  if (accept) window.CeviriRelay.approve(state.roomCode, id);
  else window.CeviriRelay.reject(state.roomCode, id);
}

function initWatch() {
  if (!WatchBridge) return;
  WatchBridge.addListener('watchMessage', ({ path, data }) => {
    if (path === '/ceviri/hello') {
      if (state.watch === 'off') return;
      if (state.watch === 'notify') {
        // Saat uygulamasi sonradan acildi: ona gec
        WatchBridge.cancelNotification().catch(() => {});
        state.watch = 'app';
        renderWatchButtons();
      }
      lastWatchJson = '';
      pushWatchState();
    } else if (path === '/ceviri/utterance') {
      if (state.watch !== 'off') onWatchUtterance(data);
    } else if (path === '/ceviri/toggle') {
      if (state.mode === 'online' && state.voiceMode) toggleMyMic();
      else if (!els.mainToggleBtn.disabled) els.mainToggleBtn.click();
    } else if (path === '/ceviri/lobby') {
      try {
        const o = JSON.parse(data || '{}');
        lobbyDecision(o.id, Boolean(o.accept));
      } catch {
        // bozuk mesaj
      }
    } else if (path === '/ceviri/close') {
      watchOff(false);
    }
  }).catch(() => {});
  WatchBridge.addListener('notificationAction', ({ id, target }) => {
    if (id === 'toggle') {
      if (state.mode === 'online' && state.voiceMode) toggleMyMic();
      else if (!els.mainToggleBtn.disabled) els.mainToggleBtn.click();
    } else if (id === 'swap') {
      els.swapTurnBtn.click();
    } else if (id === 'faceMe') {
      els.faceMeBtn.click();
    } else if (id === 'close') {
      watchOff(true);
    } else if (id === 'accept' || id === 'reject') {
      lobbyDecision(target, id === 'accept');
    }
  }).catch(() => {});
  ['watchBtn', 'watchRoomBtn'].forEach((bid) => {
    const b = document.getElementById(bid);
    if (b) b.addEventListener('click', toggleWatch);
  });
  // Durum degistikce saate yolla (yalnizca degisiklik varsa)
  setInterval(pushWatchState, 700);
  renderWatchButtons();
}

function updateHeadset(info) {
  const connected = Boolean(info && info.connected);
  state.headsetConnected = connected;
  if (!connected) state.speakerToo = false; // kulaklik cikinca normale don
  renderAudioRoute();
}

function renderAudioRoute() {
  const bar = document.getElementById('audioRouteBar');
  const btn = document.getElementById('speakerTooBtn');
  if (!bar || !btn) return;
  const loopOrFace = state.mode === 'loop' || state.mode === 'face';
  const show = Boolean(AudioRoute) && state.headsetConnected && loopOrFace;
  btn.classList.toggle('hidden', !show);
  // Saate aktar dugmesi de ayni satirda (yalnizca uygulamada)
  renderWatchButtons();
  const watchShown = Boolean(WatchBridge) && loopOrFace;
  bar.classList.toggle('hidden', !show && !watchShown);
  btn.setAttribute('aria-pressed', String(state.speakerToo));
  btn.classList.toggle('active', state.speakerToo);
  btn.textContent = state.speakerToo ? t('audio.speakerTooOn') : t('audio.speakerTooOff');
}

function initAudioRoute() {
  if (!AudioRoute) return;
  AudioRoute.getState().then(updateHeadset).catch(() => {});
  try {
    AudioRoute.addListener('headsetChange', updateHeadset);
  } catch {
    // eklenti yok
  }
}

// Bu ceviri hem kulakliktan hem telefondan mi calsin?
function shouldSpeakBoth(isMine) {
  return Boolean(AudioRoute) && isMine && state.speakerToo && state.headsetConnected && (state.mode === 'loop' || state.mode === 'face');
}

function speakBoth(text, langCode) {
  text = stripMaskForSpeech(censor(text, langCode));
  if (!text) return Promise.resolve();
  stopSpeaking();
  const maxMs = Math.max(8000, text.length * 160) + 4000;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      AudioRoute.stop().catch(() => {});
      finish();
    }, maxMs);
    AudioRoute.speakBoth({ text, lang: langCode, rate: state.settings.speechRate || 1 })
      .then(finish)
      .catch(() => {
        // Olmazsa normal yoldan (yalnizca kulaklik) oku
        clearTimeout(timer);
        done = true;
        speakText(text, langCode).then(resolve);
      });
  });
}

// Telefon konusurken saat dinlemeyi duraklatsin (yanki olmasin)
let watchSpeakDepth = 0;
let watchSpeakOffTimer = null;
function watchSpeakSignal(delta) {
  const before = watchSpeakDepth > 0;
  watchSpeakDepth = Math.max(0, watchSpeakDepth + delta);
  const after = watchSpeakDepth > 0;
  if (before === after || state.watch !== 'app' || !WatchBridge) return;
  clearTimeout(watchSpeakOffTimer);
  if (after) {
    WatchBridge.send({ path: '/ceviri/speaking', data: '1' }).catch(() => {});
  } else {
    watchSpeakOffTimer = setTimeout(() => {
      if (watchSpeakDepth === 0) WatchBridge.send({ path: '/ceviri/speaking', data: '0' }).catch(() => {});
    }, 300);
  }
}

function speakText(text, langCode, opts) {
  watchSpeakSignal(1);
  return speakTextCore(text, langCode, opts).finally(() => watchSpeakSignal(-1));
}

function speakTextCore(text, langCode, opts) {
  if (opts && shouldSpeakBoth(opts.mine)) return speakBoth(text, langCode);
  text = stripMaskForSpeech(censor(text, langCode));
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text) {
      resolve();
      return;
    }

    // iOS: cancel()'in hemen ardindan gelen speak() bazen yutulur; bir sey
    // calarken kesildiyse yeni okumayi kisa bir bekleyisle baslat
    const busy = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode;
    utterance.rate = state.settings.speechRate;
    const voice = pickBestVoice(langCode);
    if (voice) utterance.voice = voice;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearSpeechTimers();
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    // Chrome bug workaround: keep speechSynthesis alive and add safety watchdog
    state.speakKeepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 8000);

    const maxMs = Math.max(6000, text.length * 145);
    state.speakWatchdog = setTimeout(() => {
      window.speechSynthesis.cancel();
      finish();
    }, maxMs);

    const start = () => {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    };
    if (busy) setTimeout(start, 80);
    else start();
  });
}

// Audio Visualizer (uses speech activity pulses so it never competes with SpeechRecognition for mic hardware)
function startAudioVisualizer() {
  if (state.rafId) return;
  drawVisualizer();
}

function stopAudioVisualizer() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  drawIdleOrb();
}

function drawIdleOrb() {
  const canvas = els.visualizerCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 80, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawVisualizer() {
  const canvas = els.visualizerCanvas;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  const render = (now) => {
    if (!state.isActive) {
      drawIdleOrb();
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sinceSpeech = now - (state.lastSpeechPulseAt || 0);
    const speechBoost = sinceSpeech < 450 ? (1 - sinceSpeech / 450) * 14 : 0;
    const breath = state.phase === 'listening' ? (Math.sin(now / 260) + 1) * 4 : 0;
    const radius = 78 + breath + speechBoost;
    const color =
      state.activeSpeaker === 'me' ? 'rgba(16, 185, 129, 0.55)' : 'rgba(129, 140, 248, 0.55)';

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
    ctx.strokeStyle = color.replace('0.55', '0.18');
    ctx.lineWidth = 1.5;
    ctx.stroke();

    state.rafId = requestAnimationFrame(render);
  };

  state.rafId = requestAnimationFrame(render);
}

// Speech Recognition (STT)
function abortRecognition() {
  state.recognitionGen += 1;
  if (state.resumeTimer) {
    clearTimeout(state.resumeTimer);
    state.resumeTimer = null;
  }
  if (state.recognition) {
    try {
      state.recognition.onresult = null;
      state.recognition.onerror = null;
      state.recognition.onend = null;
      state.recognition.abort();
    } catch {
      // Ignore abort errors
    }
    state.recognition = null;
  }
}

function startListening() {
  if (!SpeechRecognitionAPI) {
    showAlert(
      t('err.noSR')
    );
    stopLiveSession();
    return;
  }

  abortRecognition();
  if (!state.isActive) return;

  const gen = ++state.recognitionGen;
  const isMe = state.mode === 'online' ? true : state.activeSpeaker === 'me';
  if (state.mode === 'online') {
    state.activeSpeaker = 'me';
  }
  const listenLang = isMe ? state.myLang : state.partnerLang;
  const langInfo = findLanguage(listenLang);

  const recognition = new SpeechRecognitionAPI();
  recognition.lang = listenLang;
  // Online odada da cumle sonu/duraksama beklenir: konusma bitince TEK mesaj gider
  // (surekli modda kisa parcalar ayri ayri ve mobil Chrome'da tekrarli gidiyordu)
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  state.recognition = recognition;

  setPhase('listening');
  const listenName = displayLangName(listenLang, langInfo.name);
  const promptMsg = t(isMe ? 'listen.mine' : 'listen.partner', { lang: listenName });
  setInterimMessage(promptMsg, false);
  if (state.mode === 'face') {
    (isMe ? els.faceMeText : els.facePartnerText).textContent = t('listen.short', { lang: listenName });
  }

  let finalTranscript = '';
  state.pendingTranscript = '';

  recognition.onspeechstart = () => {
    state.lastSpeechPulseAt = performance.now();
  };

  recognition.onresult = (event) => {
    if (gen !== state.recognitionGen) return;
    state.lastSpeechPulseAt = performance.now();

    let interim = '';
    let newFinalChunk = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        newFinalChunk += res[0].transcript + ' ';
        finalTranscript += res[0].transcript + ' ';
      } else {
        interim += res[0].transcript;
      }
    }

    if (state.mode === 'online') {
      // Tum sonuclari bastan birlestir: mobil Chrome her sonucu oncekileri de
      // icerecek sekilde tekrar gonderebiliyor ("merhaba", "merhaba nasilsin"...)
      let finals = '';
      let interims = '';
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const tx = String(res[0].transcript || '').trim();
        if (!tx) continue;
        if (res.isFinal) finals = mergeTranscript(finals, tx);
        else interims = mergeTranscript(interims, tx);
      }
      finalTranscript = finals;
      const full = mergeTranscript(finals, interims);
      state.pendingTranscript = full;
      if (full) setInterimMessage(censor(full, listenLang), true);
      return;
    }

    const display = censor((finalTranscript + interim).trim(), listenLang);
    state.pendingTranscript = display;
    if (display) {
      setInterimMessage(display, true);
      if (state.mode === 'face') {
        (isMe ? els.faceMeText : els.facePartnerText).textContent = display;
      }
    }
  };

  recognition.onerror = (event) => {
    if (gen !== state.recognitionGen) return;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showAlert(t(IS_NATIVE_APP ? 'err.micDeniedApp' : 'err.micDeniedWeb'));
      stopLiveSession();
      return;
    }
    if (event.error === 'audio-capture') {
      showAlert(t('err.micMissing'));
      stopLiveSession();
      return;
    }
    // 'no-speech' or 'aborted' are normal when silent; onend will handle restart
  };

  recognition.onend = async () => {
    if (gen !== state.recognitionGen) return;
    state.recognition = null;

    if (state.mode === 'online') {
      const trailing = state.pendingTranscript.trim();
      state.pendingTranscript = '';
      if (trailing) {
        await handleUtterance(trailing, 'me');
      } else if (state.group && state.queue.length && state.activeMicClientId === state.clientId && state.isActive) {
        // Grup: sirada bekleyen varken konusan sustu (tanima "ses yok" ile bitti)
        // -> soz hemen siradakine gecer (konusmanin ortasinda kesmez)
        stopLiveSession();
        return;
      }
      if (state.isActive && gen === state.recognitionGen) {
        state.resumeTimer = setTimeout(() => {
          if (state.isActive && gen === state.recognitionGen) {
            startListening();
          }
        }, 350);
      }
      return;
    }

    const cleanText = (finalTranscript || state.pendingTranscript).trim();
    state.pendingTranscript = '';
    if (cleanText) {
      // Cumle aslinda karsi tarafin dilindeyse konusani duzelt (sira da ona gore doner).
      // Saat modunda "Ben" saatten gelir; telefona konusan hep karsidakidir.
      const spk = watchApp() && state.mode === 'loop' ? 'partner' : await detectSpeaker(cleanText, state.activeSpeaker);
      if (!state.isActive || gen !== state.recognitionGen) return;
      if (spk !== state.activeSpeaker) {
        state.activeSpeaker = spk;
        updateTurnUI();
      }
      await handleUtterance(cleanText, spk);
      if (!state.isActive || gen !== state.recognitionGen) return;

      if (state.mode === 'face') {
        // In Face-to-Face mode, one tap = one utterance
        stopLiveSession();
        return;
      }

      if (state.settings.autoLoop && !watchApp()) {
        state.activeSpeaker = state.activeSpeaker === 'me' ? 'partner' : 'me';
        updateTurnUI();
      }
    }

    if (state.isActive && gen === state.recognitionGen) {
      // Short acoustic tail delay to prevent TTS echo pickup
      state.resumeTimer = setTimeout(() => {
        if (state.isActive && gen === state.recognitionGen) {
          startListening();
        }
      }, 250);
    }
  };

  try {
    recognition.start();
  } catch {
    if (state.isActive) {
      state.resumeTimer = setTimeout(() => startListening(), 300);
    }
  }
}

/**
 * Iki konusma tanima parcasini tekrarsiz birlestirir.
 * "merhaba" + "merhaba nasilsin" -> "merhaba nasilsin";
 * "bugun hava" + "hava cok guzel" -> "bugun hava cok guzel"
 */
function mergeTranscript(a, b) {
  a = String(a || '').trim();
  b = String(b || '').trim();
  if (!a) return b;
  if (!b) return a;
  const la = a.toLocaleLowerCase();
  const lb = b.toLocaleLowerCase();
  if (lb.startsWith(la)) return b;
  if (la.endsWith(lb) || la.includes(lb)) return a;
  const aw = a.split(/\s+/);
  const bw = b.split(/\s+/);
  for (let k = Math.min(aw.length, bw.length); k > 0; k--) {
    const tail = aw.slice(-k).join(' ').toLocaleLowerCase();
    const head = bw.slice(0, k).join(' ').toLocaleLowerCase();
    if (tail === head) return [...aw, ...bw.slice(k)].join(' ');
  }
  return `${a} ${b}`;
}

// ---------------------------------------------------------------------------
// Konusani dilinden tanima (Canli Dongu). Konusma tanima secili dilde dinler;
// soylenen cumle metin olarak karsi tarafin dilinde cikarsa (or. Turkce dinlerken
// Ingilizce cumle) konusan karsi taraf sayilir ve ceviri dogru yone yapilir.
// ---------------------------------------------------------------------------
function baseLang(code) {
  let b = String(code || '').split(/[-_]/)[0].toLowerCase();
  if (b === 'iw') b = 'he';
  if (b === 'nb' || b === 'nn') b = 'no';
  return b;
}

async function identifyLanguages(text) {
  const tools = window.CeviriTools;
  try {
    if (tools) {
      const r = await tools.identifyLanguage({ text });
      const out = {};
      (r.languages || []).forEach((l) => {
        const b = baseLang(l.lang);
        if (b && b !== 'und') out[b] = Math.max(out[b] || 0, Number(l.confidence) || 0);
      });
      return out;
    }
    // Uygulama disi (bilgisayar): ceviri servisinin dil tespiti
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceLang: 'auto', targetLang: state.myLang }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b = baseLang(data.detectedSourceLang);
    return b ? { [b]: 1 } : null;
  } catch {
    return null;
  }
}

async function detectSpeaker(text, expected) {
  if (!state.settings.autoDetect || state.mode !== 'loop') return expected;
  if (text.trim().split(/\s+/).length < 2) return expected; // tek kelime guvenilmez
  const myB = baseLang(state.myLang);
  const partnerB = baseLang(state.partnerLang);
  if (!myB || !partnerB || myB === partnerB) return expected;
  const scores = await identifyLanguages(text);
  if (!scores) return expected;
  const expB = expected === 'me' ? myB : partnerB;
  const otherB = expected === 'me' ? partnerB : myB;
  if ((scores[otherB] || 0) >= 0.6 && (scores[expB] || 0) < 0.3) {
    return expected === 'me' ? 'partner' : 'me';
  }
  return expected;
}

async function handleUtterance(text, speaker) {
  // Kufurler karsiya hic gitmesin: cevirmeden once kaynak dilde filtrele
  text = censor(text, state.mode === 'online' || speaker === 'me' ? state.myLang : state.partnerLang);
  if (!text.replace(/[\s*.,!?]+/g, '')) return;
  if (state.mode === 'online') {
    if (!state.roomCode) {
      showAlert(t('err.needRoom'));
      return;
    }

    setPhase('translating');
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(state.roomCode)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: state.clientId,
          senderName: state.myName || t('who.me'),
          text,
          sourceLang: state.myLang,
          fallbackTargetLang: state.partnerLang,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const msg = await res.json();
      setInterimMessage(censor(msg.translatedText || text, msg.targetLang || state.partnerLang), true);
      // SSE chat_message will append to stream for both participants
    } catch (err) {
      showAlert(t('err.sendFailed', { err: err.message }));
    } finally {
      if (state.isActive) {
        setPhase('listening');
      } else {
        setPhase('idle');
      }
    }
    return;
  }

  const sourceLang = speaker === 'me' ? state.myLang : state.partnerLang;
  const targetLang = speaker === 'me' ? state.partnerLang : state.myLang;

  setPhase('translating');

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceLang, targetLang }),
    });

    if (!res.ok) throw await translateError(res);

    const data = await res.json();
    const translatedText = censor(data.translatedText || '', targetLang);

    appendMessage({
      speaker,
      sourceLang,
      targetLang,
      originalText: text,
      translatedText,
      latencyMs: data.latencyMs,
    });

    if (state.mode === 'face') {
      // Show translation on the opposite person's card
      const targetEl = speaker === 'me' ? els.facePartnerText : els.faceMeText;
      targetEl.textContent = translatedText;
      els.faceMeText.dataset.untouched = 'false';
      els.facePartnerText.dataset.untouched = 'false';
    } else {
      setInterimMessage(translatedText, true);
    }

    if (state.settings.autoSpeak && translatedText) {
      setPhase('speaking');
      await speakText(translatedText, targetLang, { mine: speaker === 'me' });
    }
  } catch (err) {
    showAlert(err.userMessage || t('err.translate', { err: err.message }));
  } finally {
    if (!state.isActive) {
      setPhase('idle');
    }
  }
}

// Ceviri hatasini anlasilir mesaja cevir (or. internet yok + paket indirilmemis)
async function translateError(res) {
  let detail = '';
  try {
    detail = String((await res.json()).detail || '');
  } catch {
    // govde yok
  }
  const err = new Error(`HTTP ${res.status}`);
  if (detail.includes('OFFLINE_MODEL_MISSING')) err.userMessage = t('offline.missing');
  else if (detail.includes('OFFLINE_UNSUPPORTED')) err.userMessage = t('offline.unsupported');
  else if (detail.includes('OFFLINE_FAILED')) err.userMessage = t('offline.failed');
  if (err.userMessage) err.message = err.userMessage;
  return err;
}

// Online odada her kisinin rengi: sari, kirmizi, lacivert, gri, koyu yesil, pembe
const PERSON_COLORS = ['#facc15', '#ef4444', '#3b5bdb', '#9ca3af', '#15803d', '#ec4899'];

function personColor(clientId, fallbackIndex) {
  if (state.mode !== 'online' || !state.roomCode) return '';
  const p = clientId ? state.participants.find((x) => x.clientId === clientId) : null;
  const idx = p && typeof p.color === 'number' && p.color >= 0 ? p.color : fallbackIndex;
  return typeof idx === 'number' && idx >= 0 && idx < PERSON_COLORS.length ? PERSON_COLORS[idx] : '';
}

function paintPerson(el, color) {
  el.classList.toggle('has-color', Boolean(color));
  if (color) el.style.setProperty('--pc', color);
  else el.style.removeProperty('--pc');
}

function appendMessage({
  id,
  speaker,
  senderName,
  sourceLang,
  targetLang,
  originalText,
  translatedText,
  latencyMs,
  senderId,
  color,
}) {
  if (id && state.seenMessageIds.has(id)) return;
  if (id) state.seenMessageIds.add(id);
  originalText = censor(originalText, sourceLang);
  translatedText = censor(translatedText, targetLang);

  els.emptyState.classList.add('hidden');

  const msg = {
    id: id || Date.now() + Math.random(),
    speaker,
    senderName: senderName || (speaker === 'me' ? t('who.meUpper') : t('who.partnerUpper')),
    sourceLang,
    targetLang,
    originalText,
    translatedText,
    time: new Date().toLocaleTimeString(getUiLang(), { hour: '2-digit', minute: '2-digit' }),
  };
  state.messages.push(msg);
  els.messageCount.textContent = t('stream.count', { n: state.messages.length });

  const card = document.createElement('article');
  card.className = `msg-card ${speaker}`;
  paintPerson(card, personColor(senderId, color));

  const srcShort = findLanguage(sourceLang).short;
  const tgtShort = findLanguage(targetLang).short;
  const whoLabel = msg.senderName.toUpperCase();

  card.innerHTML = `
    <div class="msg-top">
      <span class="msg-speaker"></span>
      <span class="msg-time"></span>
    </div>
    <div class="msg-original" dir="auto"></div>
    <div class="msg-translated" dir="auto"></div>
    <div class="msg-actions">
      <button class="mini-btn replay-btn" type="button"></button>
      <button class="mini-btn copy-btn" type="button"></button>
    </div>
  `;

  card.querySelector('.msg-original').textContent = originalText;
  card.querySelector('.msg-translated').textContent = translatedText;
  card.querySelector('.msg-speaker').textContent = targetLang && translatedText
    ? `${whoLabel} · ${srcShort} → ${tgtShort}`
    : `${whoLabel} · ${srcShort}`;
  card.querySelector('.msg-time').textContent = `${msg.time}${typeof latencyMs === 'number' ? ` · ${latencyMs}ms` : ''}`;
  if (!translatedText) card.querySelector('.msg-translated').classList.add('hidden');

  card.querySelector('.replay-btn').textContent = t('msg.replay');
  card.querySelector('.copy-btn').textContent = t('msg.copy');

  card.querySelector('.replay-btn').addEventListener('click', () => {
    speakText(translatedText, targetLang, { mine: speaker === 'me' });
  });

  card.querySelector('.copy-btn').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(translatedText);
      const btn = e.currentTarget;
      btn.textContent = t('msg.copied');
      setTimeout(() => (btn.textContent = t('msg.copy')), 1400);
    } catch {
      // Ignore clipboard errors
    }
  });

  els.chatStream.appendChild(card);
  els.chatStream.scrollTop = els.chatStream.scrollHeight;
}

async function setRemoteMicLock(active) {
  if (state.mode !== 'online' || !state.roomCode) return true;
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(state.roomCode)}/mic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: state.clientId, active }),
    });
    if (res.status === 409) {
      const errData = await res.json().catch(() => ({}));
      state.activeMicClientId = errData.activeMicClientId || 'remote';
      state.activeMicName = errData.activeMicName || null;
      updateTurnUI();
      showAlert(t('err.partnerSpeaking', { name: state.activeMicName || t('online.otherSide') }));
      return false;
    }
    if (res.ok) {
      const data = await res.json();
      state.activeMicClientId = data.activeMicClientId || null;
      if (!active) state.activeMicName = null;
      updateTurnUI();
    }
    return true;
  } catch {
    return true;
  }
}

async function startLiveSession(speaker = state.activeSpeaker) {
  if (state.mode === 'online' && state.voiceMode) return; // sesli sohbette ceviri yok
  hideAlert();
  if (state.mode === 'online') {
    if (!state.roomCode) {
      showAlert(t('err.needRoom'));
      return;
    }
    if (state.activeMicClientId && state.activeMicClientId !== state.clientId) {
      showAlert(t('err.partnerSpeaking', { name: state.activeMicName || t('online.otherSide') }));
      return;
    }
    const acquired = await setRemoteMicLock(true);
    if (!acquired) return;
  }

  stopSpeaking();
  // Saat modunda Canli Dongu: telefonun mikrofonu yalnizca karsidakini dinler
  if (watchApp() && state.mode === 'loop') speaker = 'partner';
  state.activeSpeaker = speaker;
  state.isActive = true;
  updateTurnUI();
  startAudioVisualizer();
  startListening();

  startTurnClock();
}

// Grup odasinda bir konusma en fazla 45 saniye: sonra soz siradakine gecer
function startTurnClock() {
  clearTimeout(state.turnTimer);
  state.turnTimer = null;
  state.turnStartedAt = Date.now();
  if (state.mode === 'online' && state.group) {
    state.turnTimer = setTimeout(() => {
      if (state.isActive && state.mode === 'online' && state.group) stopLiveSession();
    }, GROUP_TURN_MS);
  }
}

function turnSecondsLeft(since) {
  if (!since) return Math.round(GROUP_TURN_MS / 1000);
  return Math.max(0, Math.ceil((GROUP_TURN_MS - (Date.now() - since)) / 1000));
}

// Grup odasinda soz iste / siradan cik
async function toggleHand() {
  if (!state.roomCode) return;
  const raise = !state.queue.includes(state.clientId);
  state.handRaised = raise;
  try {
    await fetch(`/api/rooms/${encodeURIComponent(state.roomCode)}/hand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: state.clientId, raise }),
    });
  } catch {
    // yoksay
  }
}

async function stopLiveSession() {
  clearTimeout(state.turnTimer);
  state.turnTimer = null;
  state.turnStartedAt = 0;
  const pending = state.pendingTranscript.trim();
  state.pendingTranscript = '';
  state.isActive = false;
  abortRecognition();
  stopSpeaking();
  stopAudioVisualizer();

  if (pending) {
    await handleUtterance(pending, state.activeSpeaker);
  }

  if (state.mode === 'online' && state.roomCode) {
    await setRemoteMicLock(false);
  }

  setPhase('idle');
  updateTurnUI();
  setInterimKey('hint.stopped');
}

function switchTurn(newSpeaker) {
  state.activeSpeaker = newSpeaker;
  updateTurnUI();
  if (state.isActive) {
    stopSpeaking();
    startListening();
  }
}

function setMode(mode) {
  if (state.isActive) stopLiveSession();
  state.mode = mode;

  els.modeCameraBtn.classList.toggle('active', mode === 'camera');
  els.modeCameraBtn.setAttribute('aria-selected', String(mode === 'camera'));
  els.modeLoopBtn.classList.toggle('active', mode === 'loop');
  els.modeLoopBtn.setAttribute('aria-selected', String(mode === 'loop'));
  els.modeFaceBtn.classList.toggle('active', mode === 'face');
  els.modeFaceBtn.setAttribute('aria-selected', String(mode === 'face'));
  els.modeOnlineBtn.classList.toggle('active', mode === 'online');
  els.modeOnlineBtn.setAttribute('aria-selected', String(mode === 'online'));

  els.loopStage.classList.toggle('hidden', mode === 'face' || mode === 'camera');
  els.cameraStage.classList.toggle('hidden', mode !== 'camera');
  els.faceStage.classList.toggle('hidden', mode !== 'face');
  els.onlineBar.classList.toggle('hidden', mode !== 'online');
  renderAudioRoute();
  updateMediaButtons();
  const modeMenuSel = document.getElementById('modeMenuSelect');
  if (modeMenuSel) modeMenuSel.value = mode;
  updateRoomLayout();
  els.turnControls.classList.toggle('hidden', mode === 'online');
  els.textSpeakerSelect.classList.toggle('hidden', mode === 'online');
  updateAttachVisibility();
  els.partnerLangSelect.disabled = mode === 'online' && Boolean(state.partnerName);
  els.swapLangsBtn.classList.toggle('hidden', mode === 'online');
  els.clearBtn.disabled = mode === 'online';

  if (mode === 'online') {
    if (!els.onlineNameInput.value && state.myName) {
      els.onlineNameInput.value = state.myName;
    }
    pollOnlineInfo();
  }

  updateLanguageBadges();
}

function getShareBaseUrl() {
  if (state.onlineInfo.publicUrl) return state.onlineInfo.publicUrl;
  // Uygulamada bilgi henuz gelmediyse de davet linki web adresini gostersin
  if ((IS_NATIVE_APP || IS_DESKTOP) && window.CEVIRI_WEB_URL) return String(window.CEVIRI_WEB_URL).replace(/\/+$/, '');
  return window.location.origin;
}

// Panoya kopyala: once modern yol, olmazsa (Android WebView, http) eski yol
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // eski yola gec
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// Uygulama: her davet linki tek kullanimliktir (ilk acan kisiye baglanir)
function updateInviteLink(fresh) {
  if (!state.roomCode || IS_GUEST || !window.CeviriRelay) return;
  if (fresh || !state.inviteToken || state.inviteTokenRoom !== state.roomCode) {
    state.inviteToken = window.CeviriRelay.createInvite(state.roomCode);
    state.inviteTokenRoom = state.roomCode;
  }
  if (!state.inviteToken) return;
  els.inviteLinkInput.value = `${getShareBaseUrl()}/#${encodeInvite(state.roomCode, state.inviteToken)}`;
}

async function pollOnlineInfo() {
  if (state.onlinePollTimer) {
    clearTimeout(state.onlinePollTimer);
    state.onlinePollTimer = null;
  }

  try {
    const res = await fetch('/api/online-info');
    if (res.ok) {
      const info = await res.json();
      state.onlineInfo = info;

      if (info.onlineMode) {
        if (info.status === 'ready' && info.publicUrl) {
          setBadgeKey('online.ready');
          els.tunnelStatusBadge.dataset.state = 'ready';
          updateInviteLink();
          return;
        }
        els.tunnelStatusBadge.dataset.state = info.status === 'error' ? 'error' : 'connecting';
        if (info.status === 'error') {
          if (window.CeviriRelay) setBadgeKey('online.unreachable');
          else els.tunnelStatusBadge.textContent = info.error || 'Tünel hatası';
          updateInviteLink();
          if (window.CeviriRelay) state.onlinePollTimer = setTimeout(pollOnlineInfo, 4000);
          return;
        }
        setBadgeKey('online.connecting');
        state.onlinePollTimer = setTimeout(pollOnlineInfo, 2000);
      } else {
        els.tunnelStatusBadge.textContent = window.location.protocol === 'https:'
          ? t('online.connected')
          : 'Yerel Ağ (Farklı PC için CEVIRI-Baslat-online.bat kullanın)';
        updateInviteLink();
      }
    }
  } catch {
    // Ignore transient poll errors
  }
}

function connectToRoom(roomCode) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  state.roomCode = roomCode;
  // Linkle gelen misafir oda kodunu gormez
  els.roomCodeBadge.textContent = IS_GUEST ? '' : roomCode;
  // Kamera baglantilari: ayni odada dil degisince (yeniden baglanma) korunur
  if (state.videoMesh && state.videoMesh.roomCode !== roomCode) {
    state.videoMesh.destroy();
    state.videoMesh = null;
  }
  if (!state.videoMesh && window.CeviriRelay && window.RTCPeerConnection) {
    state.videoMesh = createVideoMesh({
      selfId: state.clientId,
      roomCode,
      sendSignal: (to, data) => window.CeviriRelay.sendSignal(roomCode, to, data),
      onRemoteStream: (id, stream) => {
        remoteStreams.set(id, stream);
        renderParticipants();
      },
      onRemoteAudio: (id, stream) => setRemoteAudio(id, stream),
      onPeerState: (id, connState) => {
        peerStates.set(id, connState);
        renderParticipants();
      },
    });
  }
  els.onlineJoinView.classList.add('hidden');
  els.onlineActiveView.classList.remove('hidden');
  updateInviteLink();
  updateRoomLayout();

  updateAttachVisibility();

  const params = new URLSearchParams({
    clientId: state.clientId,
    name: state.myName || t('who.me'),
    lang: state.myLang,
  });
  if (IS_GUEST && guestInvite && guestInvite.code === roomCode) params.set('token', guestInvite.token);
  if (state.isCreator) params.set('creator', '1'); // odayi kuran: kendiliginden girer ve icerik anahtarini uretir

  const es = new EventSource(`/api/rooms/${encodeURIComponent(roomCode)}/events?${params.toString()}`);
  state.eventSource = es;

  es.addEventListener('room_state', (event) => {
    const data = JSON.parse(event.data);
    const others = (data.participants || []).filter((p) => p.clientId !== state.clientId);
    const partner = others[0];

    const newHolder = data.activeMicClientId || null;
    if (newHolder !== state.activeMicClientId) state.holderSince = newHolder ? Date.now() : 0;
    state.activeMicClientId = newHolder;
    state.activeMicName = data.activeMicName || null;
    state.group = Boolean(data.group);
    state.ownerId = data.ownerId || null;
    state.roomLocked = Boolean(data.locked);
    state.queue = Array.isArray(data.queue) ? data.queue : [];
    state.participants = data.participants || [];
    if (window.AybaHooks && typeof window.AybaHooks.roomState === 'function') {
      try {
        window.AybaHooks.roomState(data);
      } catch (err) {
        console.warn(err);
      }
    }

    if (data.full) {
      showAlert(t('room.full', { n: data.maxParticipants || 6 }));
      leaveOnlineRoom();
      return;
    }
    if (data.lockedOut) {
      showAlert(t('room.lockedOut'));
      leaveOnlineRoom();
      return;
    }
    if (data.invite === 'used' || data.invite === 'invalid') {
      // Bu link baska biri tarafindan kullanildi ya da gecersiz: hicbir sey gosterilmez
      leaveOnlineRoom();
      forgetGuestInvite();
      showAlert(t(data.invite === 'used' ? 'invite.used' : 'invite.invalid'));
      return;
    }
    // Herkes ayni dildeyse ceviri yerine dogrudan sesli sohbet
    updateVoiceMode(data.invite === 'waiting');
    // Kapida bekleme: linkle gelen, oda sahibi "Kabul et" diyene kadar iceri giremez
    const wasWaiting = state.awaitingApproval;
    state.awaitingApproval = data.invite === 'waiting';
    const prevLobby = state.lobby.length;
    state.lobby = data.lobby || [];
    if (navigator.vibrate && state.ownerId === state.clientId && state.lobby.length > prevLobby) navigator.vibrate([80, 60, 80]);
    if (navigator.vibrate && wasWaiting && !state.awaitingApproval) navigator.vibrate(150);
    setWaitingInputs(state.awaitingApproval);
    if (state.awaitingApproval) {
      renderParticipants();
      setPresenceKey('lobby.waitingSelf');
      setInterimKey('lobby.waitingSelf');
      updateTurnUI();
      return;
    }
    // Oda 2 kisiden gruba gecerken mikrofonu tutan kisiye de 45 sn siniri baslar
    // (yoksa 2 kisilik aliskanlikla acik birakilan mikrofon sozu hic birakmiyordu)
    if (state.group && state.isActive && state.activeMicClientId === state.clientId && !state.turnTimer) {
      startTurnClock();
    }

    renderParticipants();
    if (state.videoMesh) state.videoMesh.syncPeers(state.participants.map((p) => p.clientId));

    if (state.group) {
      // 3+ kisi: herkes kendi dilinde okur; tek "karsidaki" yok
      state.partnerName = '';
      els.partnerLangSelect.disabled = true;
      setPresenceKey('group.people', { n: state.participants.length });
      updateLanguageBadges();
      updateTurnUI();
      const pos = state.queue.indexOf(state.clientId);
      if (state.activeMicClientId === state.clientId && !state.isActive && state.handRaised) {
        // Sira geldi: mikrofon otomatik acilir
        state.handRaised = false;
        if (navigator.vibrate) navigator.vibrate(200);
        setInterimKey('group.yourTurnNow');
        startLiveSession('me');
      } else if (state.voiceMode) {
        setInterimKey('voice.active');
      } else if (!state.isActive) {
        if (state.activeMicClientId && state.activeMicClientId !== state.clientId) {
          if (pos >= 0) setInterimKey('group.inQueue', { n: pos + 1 });
          else setInterimKey('group.speakingRaise', { name: state.activeMicName || t('online.otherSide') });
        } else if (state.phase === 'idle') {
          setInterimKey('online.yourTurn');
        }
      }
      return;
    }
    state.handRaised = false;

    if (partner) {
      state.partnerName = partner.name;
      state.partnerLang = partner.lang;
      els.partnerLangSelect.value = partner.lang;
      els.partnerLangSelect.disabled = true;
      const partnerLangInfo = findLanguage(partner.lang);
      setPresenceKey('online.partnerConnected', { name: partner.name, lang: partner.lang, langFallback: partnerLangInfo.name });
    } else {
      state.partnerName = '';
      els.partnerLangSelect.disabled = false;
      setPresenceKey('online.waiting');
    }

    updateLanguageBadges();
    updateTurnUI();

    if (state.voiceMode) {
      setInterimKey('voice.active');
    } else if (!state.isActive) {
      if (state.activeMicClientId && state.activeMicClientId !== state.clientId) {
        setInterimKey('online.partnerSpeaking', { name: state.activeMicName || t('online.otherSide') });
      } else if (partner && state.phase === 'idle') {
        setInterimKey('online.yourTurn');
      }
    }
  });

  es.addEventListener('history', (event) => {
    const data = JSON.parse(event.data);
    state.incomingChain = state.incomingChain
      .then(async () => {
        for (const raw of data.messages || []) {
          const speaker = raw.senderId === state.clientId ? 'me' : 'partner';
          const msg = speaker === 'partner' ? await ensureMyLanguage(raw) : raw;
          appendMessage({ ...msg, speaker });
        }
      })
      .catch(() => {});
  });

  es.addEventListener('file_message', (event) => onFileMessage(JSON.parse(event.data), roomCode));
  es.addEventListener('file_progress', (event) => onFileProgress(JSON.parse(event.data)));
  es.addEventListener('file_ready', (event) => onFileReady(JSON.parse(event.data)));
  es.addEventListener('file_failed', (event) => onFileFailed(JSON.parse(event.data)));

  es.addEventListener('chat_message', (event) => {
    const raw = JSON.parse(event.data);
    // Mesajlar geldikleri sirayla islenir (ceviri + seslendirme ust uste binmesin)
    state.incomingChain = state.incomingChain.then(() => handleIncomingChat(raw)).catch(() => {});
  });

  es.addEventListener('kicked', (event) => {
    let reason = '';
    try {
      reason = JSON.parse(event.data || '{}').reason || '';
    } catch {
      // yoksay
    }
    leaveOnlineRoom();
    if (reason === 'reject') forgetGuestInvite();
    showAlert(t(reason === 'reject' ? 'lobby.rejected' : 'owner.kicked'));
  });

  es.addEventListener('rtc_signal', (event) => {
    const { from, data } = JSON.parse(event.data);
    if (state.videoMesh) state.videoMesh.handleSignal(from, data);
  });

  async function handleIncomingChat(raw) {
    const speaker = raw.senderId === state.clientId ? 'me' : 'partner';
    const msg = speaker === 'partner' ? await ensureMyLanguage(raw) : raw;
    appendMessage({ ...msg, speaker });

    // Speak incoming partner message on this PC without mic echo
    if (speaker === 'partner' && state.settings.autoSpeak && msg.translatedText) {
      const wasActive = state.isActive;
      if (wasActive) abortRecognition();
      setPhase('speaking');
      setInterimMessage(`${msg.senderName}: ${censor(msg.translatedText, state.myLang)}`, true);
      await speakText(msg.translatedText, state.myLang);
      if (wasActive && state.isActive) {
        state.resumeTimer = setTimeout(() => {
          if (state.isActive) startListening();
        }, 250);
      } else if (!state.isActive) {
        setPhase('idle');
      }
    }
  }

  es.onerror = () => {
    setPresenceKey('online.reconnecting');
  };
}

async function createOnlineRoom() {
  if (IS_GUEST) return; // linkle acilan sayfa oda kuramaz
  const name = els.onlineNameInput.value.trim();
  if (!name) {
    showAlert(t('err.needName'));
    els.onlineNameInput.focus();
    return;
  }
  hideAlert();
  state.myName = name;
  localStorage.setItem(STORAGE_KEYS.myName, name);

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    state.isCreator = true; // bu cihaz odayi kurdu: oda sahibi
    connectToRoom(data.roomCode);
    updateLanguageBadges();
  } catch (err) {
    showAlert(t('err.roomCreate', { err: err.message }));
  }
}

function joinOnlineRoom() {
  const name = els.onlineNameInput.value.trim();
  if (IS_GUEST && !guestInvite) {
    showAlert(t('invite.required'));
    return;
  }
  // Misafir: oda kodu davet linkinden gelir (ekranda gorunmez)
  const code = IS_GUEST
    ? guestInvite.code
    : els.onlineRoomInput.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!name) {
    showAlert(t('err.needName'));
    els.onlineNameInput.focus();
    return;
  }
  if (!code || code.length < 4) {
    showAlert(t('err.badRoom'));
    els.onlineRoomInput.focus();
    return;
  }
  hideAlert();
  state.myName = name;
  localStorage.setItem(STORAGE_KEYS.myName, name);
  state.isCreator = false; // kodla katilan: oda sahibinin onayini bekler
  connectToRoom(code);
  updateLanguageBadges();
}

// ---------------------------------------------------------------------------
// Online odada fotograf / PDF paylasimi
// ---------------------------------------------------------------------------
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const FILE_MAX_MB = 10;
const IMAGE_SHRINK_OVER = 2 * 1024 * 1024; // 2 MB ustu fotograflar kucultulur
const IMAGE_MAX_SIDE = 2560;
const fileCards = new Map(); // dosya id -> { meta, roomCode, el, state, p, thumbDone }

function updateAttachVisibility() {
  if (!els.attachBtn) return;
  els.attachBtn.classList.toggle('hidden', !(state.mode === 'online' && state.roomCode && window.CeviriRelay));
}

function fileTypeOf(file) {
  const type = String(file.type || '').toLowerCase();
  if (FILE_TYPES.includes(type)) return type;
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[ext] || '';
}

function formatSize(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function prepareFile(file, type) {
  if (type.startsWith('image/') && file.size > IMAGE_SHRINK_OVER) {
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob && blob.size < file.size) {
        const base = String(file.name || 'foto').replace(/\.[^.]+$/, '');
        return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg', name: `${base}.jpg` };
      }
    } catch {
      // kucultme olmazsa asli gonderilir
    }
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), type, name: file.name || (type === 'application/pdf' ? 'belge.pdf' : 'foto.jpg') };
}

async function handleAttach(file) {
  if (!file) return;
  if (state.mode !== 'online' || !state.roomCode || !window.CeviriRelay) {
    showAlert(t('err.needRoom'));
    return;
  }
  const type = fileTypeOf(file);
  if (!type) {
    showAlert(t('file.badType'));
    return;
  }
  els.attachBtn.classList.add('busy');
  try {
    const prepared = await prepareFile(file, type);
    if (prepared.bytes.length > FILE_MAX_MB * 1024 * 1024) {
      showAlert(t('file.tooBig', { mb: FILE_MAX_MB }));
      return;
    }
    await window.CeviriRelay.sendFile(state.roomCode, prepared.name, prepared.type, prepared.bytes);
  } catch (err) {
    showAlert(t('file.sendFailed', { err: (err && err.message) || String(err) }));
  } finally {
    els.attachBtn.classList.remove('busy');
  }
}

function renderFileCard(entry) {
  const stateEl = entry.el.querySelector('.file-state');
  const labels = {
    sending: t('file.sending', { p: entry.p || 0 }),
    receiving: t('file.receiving', { p: entry.p || 0 }),
    ready: t('file.tapToSave'),
    available: t('file.tapToDownload'),
    failed: t('file.unavailable'),
  };
  stateEl.textContent = labels[entry.state] || '';
  entry.el.classList.toggle('failed', entry.state === 'failed');
}

async function loadFileThumb(entry) {
  if (entry.thumbDone || !entry.meta.type.startsWith('image/')) return;
  entry.thumbDone = true;
  try {
    const blob = await window.CeviriRelay.getFile(entry.roomCode, entry.meta.id);
    const img = document.createElement('img');
    img.className = 'file-thumb';
    img.alt = '';
    img.src = URL.createObjectURL(blob);
    entry.el.querySelector('.file-thumb').replaceWith(img);
  } catch {
    entry.thumbDone = false;
  }
}

function onFileMessage(meta, roomCode) {
  const existing = fileCards.get(meta.id);
  if (existing) {
    if (meta.state === 'ready' && existing.state !== 'ready') onFileReady({ id: meta.id });
    return;
  }
  const speaker = meta.senderId === state.clientId ? 'me' : 'partner';
  const name = censor(meta.name, speaker === 'me' ? state.myLang : state.partnerLang);
  const time = new Date(meta.timestamp || Date.now()).toLocaleTimeString(getUiLang(), { hour: '2-digit', minute: '2-digit' });
  const who = censor(meta.senderName || '', state.myLang) || (speaker === 'me' ? t('who.meUpper') : t('who.partnerUpper'));

  els.emptyState.classList.add('hidden');
  const card = document.createElement('article');
  card.className = `msg-card file-card ${speaker}`;
  paintPerson(card, personColor(meta.senderId, meta.color));
  card.dataset.fileId = meta.id;
  card.innerHTML = `
    <div class="msg-top">
      <span class="msg-speaker"></span>
      <span class="msg-time"></span>
    </div>
    <button class="file-body" type="button">
      <span class="file-thumb" aria-hidden="true"></span>
      <span class="file-info">
        <span class="file-name" dir="auto"></span>
        <span class="file-meta"></span>
        <span class="file-state"></span>
      </span>
    </button>
  `;
  card.querySelector('.msg-speaker').textContent = `📎 ${who.toLocaleUpperCase()}`;
  card.querySelector('.msg-time').textContent = time;
  card.querySelector('.file-thumb').textContent = meta.type === 'application/pdf' ? '📄' : '🖼️';
  card.querySelector('.file-name').textContent = name;
  card.querySelector('.file-meta').textContent = `${meta.type === 'application/pdf' ? 'PDF' : meta.type.split('/')[1].toUpperCase()} · ${formatSize(meta.size)}`;

  const entry = { meta: { ...meta, name }, roomCode, el: card, state: meta.state || 'available', p: 0, thumbDone: false };
  fileCards.set(meta.id, entry);
  card.querySelector('.file-body').addEventListener('click', () => saveRoomFile(entry));
  renderFileCard(entry);

  state.messages.push({
    id: meta.id,
    speaker,
    senderName: who,
    sourceLang: state.myLang,
    targetLang: state.myLang,
    originalText: `📎 ${name}`,
    translatedText: '',
    time,
  });
  els.messageCount.textContent = t('stream.count', { n: state.messages.length });
  els.chatStream.appendChild(card);
  els.chatStream.scrollTop = els.chatStream.scrollHeight;
  if (entry.state === 'ready') loadFileThumb(entry);
}

function onFileProgress({ id, received, total, sending }) {
  const entry = fileCards.get(id);
  if (!entry || entry.state === 'ready') return;
  entry.state = sending ? 'sending' : 'receiving';
  entry.p = total ? Math.round((received / total) * 100) : 0;
  renderFileCard(entry);
}

function onFileReady({ id }) {
  const entry = fileCards.get(id);
  if (!entry) return;
  entry.state = 'ready';
  renderFileCard(entry);
  loadFileThumb(entry);
}

function onFileFailed({ id }) {
  const entry = fileCards.get(id);
  if (!entry || entry.state === 'ready') return;
  entry.state = 'failed';
  renderFileCard(entry);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsDataURL(blob);
  });
}

async function saveBlob(blob, name, type) {
  if (IS_NATIVE_APP) {
    // Uygulama: Belgeler/CEVIRI klasorune kaydet ve ac
    const reg = (window.capacitorExports && window.capacitorExports.registerPlugin) || window.Capacitor.registerPlugin;
    const Filesystem = reg('Filesystem');
    const FileOpener = reg('FileOpener');
    const data = await blobToBase64(blob);
    const path = `CEVIRI/${name}`;
    let uri;
    try {
      uri = (await Filesystem.writeFile({ path, data, directory: 'DOCUMENTS', recursive: true })).uri;
      showAlert(t('file.saved', { path: `Documents/${path}` }));
    } catch {
      // Eski Android / izin yok: gecici klasore yaz, yine de ac
      uri = (await Filesystem.writeFile({ path, data, directory: 'CACHE', recursive: true })).uri;
    }
    try {
      await FileOpener.open({ filePath: uri, contentType: type, openWithDefault: true });
    } catch {
      // Acacak uygulama yoksa dosya yine de kaydedildi
    }
    return;
  }
  // Tarayici: dosyayi indir
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function saveRoomFile(entry) {
  if (entry.saving || !window.CeviriRelay) return;
  entry.saving = true;
  try {
    if (entry.state !== 'ready' && entry.state !== 'sending') {
      entry.state = 'receiving';
      renderFileCard(entry);
    }
    const blob = await window.CeviriRelay.getFile(entry.roomCode, entry.meta.id);
    entry.state = 'ready';
    renderFileCard(entry);
    loadFileThumb(entry);
    await saveBlob(blob, entry.meta.name, entry.meta.type);
  } catch (err) {
    if (err && err.message === 'unavailable') {
      entry.state = 'failed';
      renderFileCard(entry);
      showAlert(t('file.unavailable'));
    } else {
      showAlert(t('file.saveFailed', { err: (err && err.message) || String(err) }));
    }
  } finally {
    entry.saving = false;
  }
}

// ---------------------------------------------------------------------------
// Online oda: alicinin kendi diline ceviri, katilimci kutulari, kamera
// ---------------------------------------------------------------------------
const GROUP_TURN_MS = 45000;
const remoteStreams = new Map(); // katilimci id -> MediaStream
const peerStates = new Map(); // katilimci id -> WebRTC baglanti durumu
const tiles = new Map(); // katilimci id -> kutu elemani

/** Gelen mesaj benim dilimde degilse (grup odasi) kendi cihazimda cevir. */
async function ensureMyLanguage(msg) {
  if (msg.translatedText && msg.targetLang && baseLang(msg.targetLang) === baseLang(state.myLang)) return msg;
  if (baseLang(msg.sourceLang) === baseLang(state.myLang)) {
    return { ...msg, translatedText: msg.originalText, targetLang: state.myLang };
  }
  try {
    const translated = await translateViaApi(msg.originalText, msg.sourceLang, state.myLang);
    return { ...msg, translatedText: censor(translated, state.myLang), targetLang: state.myLang };
  } catch {
    return { ...msg, translatedText: '', targetLang: '' };
  }
}

// Dar ekranda davet dugmesi kisa yazilir (tek sirada sigsin)
function inviteLabel() {
  const compact = window.matchMedia && window.matchMedia('(max-width: 699px)').matches;
  return compact ? t('online.inviteShort') : t('online.copyInvite');
}

function renderRoomTools() {
  renderLobby();
  renderWatchButtons();
  if (!els.copyInviteBtn.dataset.copied) els.copyInviteBtn.textContent = inviteLabel();
  const tools = els.roomTools;
  if (!tools) return;
  const inRoom = Boolean(state.roomCode && state.participants.length);
  tools.classList.toggle('hidden', !inRoom);
  const amOwner = inRoom && state.ownerId === state.clientId;
  // Davet linki olusturmayi yalnizca oda sahibi yapar (oda sahibi belli olunca uret)
  if (amOwner) updateInviteLink();
  els.copyInviteBtn.classList.toggle('hidden', !amOwner);
  if (els.inviteLinkInput) els.inviteLinkInput.classList.toggle('hidden', !amOwner);
  els.lockRoomBtn.classList.toggle('hidden', !amOwner);
  els.lockRoomBtn.textContent = state.roomLocked ? t('owner.unlock') : t('owner.lock');
  els.lockedBadge.classList.toggle('hidden', !(inRoom && state.roomLocked && !amOwner));
  els.lockedBadge.textContent = t('room.lockedInfo');
  const receiving = !state.videoMesh || state.videoMesh.receiveVideo;
  els.videoReceiveBtn.textContent = receiving ? t('video.receiveOff') : t('video.receiveOn');
  els.videoReceiveBtn.classList.toggle('active', !receiving);
  els.videoReceiveBtn.disabled = !state.videoMesh;
}

// Kapida beklerken yazma ve dosya gonderme kapali
function setWaitingInputs(waiting) {
  els.textInput.disabled = waiting;
  const send = document.querySelector('#textTranslateForm .send-btn');
  if (send) send.disabled = waiting;
  const attach = document.getElementById('attachBtn');
  if (attach) attach.disabled = waiting;
}

// Oda sahibi: kapida bekleyenler icin "Kabul et" / "Reddet"
function renderLobby() {
  const bar = document.getElementById('lobbyBar');
  if (!bar) return;
  const list = state.roomCode && state.ownerId === state.clientId ? state.lobby : [];
  const sig = `${t('lobby.accept')}|${list.map((p) => p.clientId + p.name).join(',')}`;
  bar.classList.toggle('hidden', !list.length);
  if (bar.dataset.sig === sig) return;
  bar.dataset.sig = sig;
  bar.replaceChildren(
    ...list.map((p) => {
      const row = document.createElement('div');
      row.className = 'lobby-item';
      const text = document.createElement('span');
      text.className = 'lobby-text';
      text.textContent = t('lobby.waiting', { name: censor(p.name || '?', state.myLang) });
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'online-btn primary';
      ok.textContent = t('lobby.accept');
      ok.addEventListener('click', () => window.CeviriRelay && window.CeviriRelay.approve(state.roomCode, p.clientId));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'online-btn secondary';
      no.textContent = t('lobby.reject');
      no.addEventListener('click', () => window.CeviriRelay && window.CeviriRelay.reject(state.roomCode, p.clientId));
      row.append(text, ok, no);
      return row;
    })
  );
}

function kickParticipant(clientId) {
  if (state.ownerId !== state.clientId || !window.CeviriRelay) return;
  const p = state.participants.find((x) => x.clientId === clientId);
  const name = censor((p && p.name) || '', state.myLang) || '?';
  if (!window.confirm(t('owner.kickConfirm', { name }))) return;
  window.CeviriRelay.kick(state.roomCode, clientId);
}

// Odadayken tek ekran duzeni: kameralar, akis ve mikrofon kaydirmadan gorunur
function updateRoomLayout() {
  const inRoom = state.mode === 'online' && Boolean(state.roomCode);
  document.body.classList.toggle('in-room', inRoom);
  layoutVideoGrid();
}

// Kamera kutularini alana gore yerlestir: goruntu en az kirpilacak sutun sayisi
function layoutVideoGrid() {
  const grid = els.participantsGrid;
  if (!grid) return;
  if (!document.body.classList.contains('in-room')) {
    grid.removeAttribute('data-layout');
    grid.style.removeProperty('--cols');
    grid.style.removeProperty('--rows');
    return;
  }
  const n = grid.children.length;
  const W = grid.clientWidth;
  const H = grid.clientHeight;
  if (!n || !W || !H) return;
  const speaker = grid.querySelector('.p-tile.speaking');
  if (speaker && n >= 3) {
    // Konusan buyuk ustte, digerleri altta serit
    grid.dataset.layout = 'speaker';
    grid.style.setProperty('--cols', String(n - 1));
    grid.style.removeProperty('--rows');
    return;
  }
  const target = 4 / 3;
  let best = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = W / cols / (H / rows);
    const score = Math.abs(Math.log(aspect / target)) + (cols * rows - n) * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = cols;
    }
  }
  grid.dataset.layout = 'even';
  grid.style.setProperty('--cols', String(best));
  grid.style.setProperty('--rows', String(Math.ceil(n / best)));
}

function renderParticipants() {
  updateRoomLayout();
  renderRoomTools();
  // Grup odasinda tek bir "karsidakinin dili" yok: o kutu gizlenir
  const partnerCard = els.partnerLangSelect.closest('.lang-card');
  if (partnerCard) partnerCard.classList.toggle('hidden', Boolean(state.roomCode && state.group));
  const grid = els.participantsGrid;
  if (!grid) return;
  const list = state.roomCode ? state.participants : [];
  grid.classList.toggle('hidden', list.length === 0);
  const ids = new Set(list.map((p) => p.clientId));
  for (const [id, tile] of tiles) {
    if (!ids.has(id)) {
      tile.remove();
      tiles.delete(id);
      remoteStreams.delete(id);
      peerStates.delete(id);
    }
  }
  list.forEach((p, index) => {
    const isMe = p.clientId === state.clientId;
    let tile = tiles.get(p.clientId);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'p-tile';
      tile.innerHTML = `
        <video class="p-video hidden" autoplay playsinline muted></video>
        <div class="p-avatar" aria-hidden="true"></div>
        <div class="p-badges"><span class="p-owner hidden">👑</span><span class="p-speaking hidden">🎙️</span><span class="p-muted hidden">🔇</span><span class="p-hand hidden"></span></div>
        <div class="p-footer">
          <span class="p-name" dir="auto"></span>
          <span class="p-lang"></span>
        </div>
        <div class="p-note hidden"></div>
      `;
      if (isMe) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'p-cam-btn';
        btn.addEventListener('click', toggleMyCamera);
        // Ayni dildeki sesli sohbette: kamera simgesinin yaninda mikrofon
        const mic = document.createElement('button');
        mic.type = 'button';
        mic.className = 'p-mic-btn hidden';
        mic.addEventListener('click', toggleMyMic);
        const tools = document.createElement('div');
        tools.className = 'p-self-tools';
        tools.append(mic, btn);
        tile.appendChild(tools);
      } else {
        // Oda sahibi icin: bu kisiyi odadan cikar
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'p-kick-btn hidden';
        kick.textContent = '✕';
        kick.addEventListener('click', () => kickParticipant(p.clientId));
        // Sesli sohbette: bu kisinin sesini yalnizca kendim icin sustur / ac
        const listen = document.createElement('button');
        listen.type = 'button';
        listen.className = 'p-listen-btn hidden';
        listen.addEventListener('click', () => toggleListen(p.clientId));
        const tools = document.createElement('div');
        tools.className = 'p-self-tools';
        tools.append(listen, kick);
        tile.appendChild(tools);
      }
      tiles.set(p.clientId, tile);
    }
    if (grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] || null);

    const name = censor(p.name || '', state.myLang) || '?';
    tile.classList.toggle('me', isMe);
    tile.querySelector('.p-name').textContent = isMe ? `${name} (${t('tile.you')})` : name;
    tile.querySelector('.p-lang').textContent = findLanguage(p.lang).short;
    tile.querySelector('.p-avatar').textContent = name.trim().charAt(0).toLocaleUpperCase();
    paintPerson(tile, personColor(p.clientId, p.color));
    const speaking = !state.voiceMode && state.activeMicClientId === p.clientId;
    tile.classList.toggle('speaking', speaking);
    const spk = tile.querySelector('.p-speaking');
    spk.classList.toggle('hidden', !speaking);
    // Grup odasinda konusanin kalan suresi herkese gorunur
    spk.textContent = speaking && state.group
      ? `🎙️ ${turnSecondsLeft(isMe && state.turnStartedAt ? state.turnStartedAt : state.holderSince)}`
      : '🎙️';
    const isOwnerTile = state.ownerId === p.clientId;
    const own = tile.querySelector('.p-owner');
    own.classList.toggle('hidden', !isOwnerTile);
    own.title = t('owner.badge');
    const listenBtn = tile.querySelector('.p-listen-btn');
    if (listenBtn) {
      const off = state.silenced.has(p.clientId);
      listenBtn.classList.toggle('hidden', !state.voiceMode);
      listenBtn.classList.toggle('on', off);
      listenBtn.textContent = off ? '🔇' : '🔊';
      listenBtn.title = `${off ? t('voice.listenOn') : t('voice.listenOff')}: ${p.name || ''}`;
      listenBtn.setAttribute('aria-label', listenBtn.title);
      listenBtn.setAttribute('aria-pressed', String(off));
    }
    const kickBtn = tile.querySelector('.p-kick-btn');
    if (kickBtn) {
      kickBtn.classList.toggle('hidden', state.ownerId !== state.clientId);
      kickBtn.title = t('owner.kick');
      kickBtn.setAttribute('aria-label', `${t('owner.kick')}: ${p.name || ''}`);
    }
    // Sesli sohbette mikrofonu kapali olanlar
    const mutedBadge = tile.querySelector('.p-muted');
    const isMuted = state.voiceMode && (isMe ? state.micMuted : Boolean(p.mute));
    mutedBadge.classList.toggle('hidden', !isMuted);
    mutedBadge.title = t('voice.mutedBadge');
    const qpos = state.group && !state.voiceMode ? state.queue.indexOf(p.clientId) : -1;
    const hand = tile.querySelector('.p-hand');
    hand.classList.toggle('hidden', qpos < 0);
    hand.textContent = qpos >= 0 ? `✋ ${qpos + 1}` : '';

    // Goruntu: benim kameram yerel akistan, digerleri baglantidan
    const video = tile.querySelector('.p-video');
    const stream = isMe ? (state.videoMesh && state.videoMesh.localStream) : remoteStreams.get(p.clientId);
    const camOn = isMe ? Boolean(state.videoMesh && state.videoMesh.cameraOn) : Boolean(p.cam);
    // "Goruntuleri alma" acikken baskalarinin goruntusu gelmez (veri tasarrufu)
    const receiving = isMe || !state.videoMesh || state.videoMesh.receiveVideo;
    const show = Boolean(camOn && stream && receiving);
    if (show && video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    if (!show && video.srcObject) video.srcObject = null;
    video.classList.toggle('hidden', !show);
    video.classList.toggle('mirror', isMe);
    tile.querySelector('.p-avatar').classList.toggle('hidden', show);

    // Kamerasi acik: goruntu gelene kadar "Baglaniyor...", kurulamazsa uyari
    const connState = peerStates.get(p.clientId);
    const failed = !isMe && camOn && connState === 'failed';
    const connecting = !isMe && camOn && !show && !failed && receiving;
    const note = tile.querySelector('.p-note');
    note.classList.toggle('hidden', !failed && !connecting);
    note.textContent = failed ? t('video.noConn') : connecting ? t('online.connecting') : '';

    if (isMe) {
      const btn = tile.querySelector('.p-cam-btn');
      const on = Boolean(state.videoMesh && state.videoMesh.cameraOn);
      btn.textContent = on ? '📷 ✕' : '📷';
      btn.classList.toggle('on', on);
      btn.title = on ? t('video.off') : t('video.on');
      btn.setAttribute('aria-label', btn.title);
      btn.disabled = !state.videoMesh;
      const mic = tile.querySelector('.p-mic-btn');
      mic.classList.toggle('hidden', !state.voiceMode);
      mic.textContent = state.micMuted ? '🔇' : '🎙';
      mic.classList.toggle('on', state.micMuted);
      mic.title = state.micMuted ? t('voice.unmute') : t('voice.mute');
      mic.setAttribute('aria-label', mic.title);
      mic.setAttribute('aria-pressed', String(state.micMuted));
    }
  });
  layoutVideoGrid();
}

// ---------------------------------------------------------------------------
// Ayni dildeki sesli sohbet: odadaki herkes ayni dili konusuyorsa ceviri
// gerekmez; mikrofon sesi dogrudan gider. Mikrofon varsayilan acik; kendi
// kutumdaki mikrofon simgesiyle anlik kapatilip acilir. Farkli dilde biri
// gelirse kendiliginden normal (ceviri) moda donulur.
// ---------------------------------------------------------------------------
const remoteAudioEls = new Map(); // katilimci id -> <audio>

function setRemoteAudio(id, stream) {
  let el = remoteAudioEls.get(id);
  if (!stream) {
    if (el) {
      el.srcObject = null;
      el.remove();
      remoteAudioEls.delete(id);
    }
    return;
  }
  if (!el) {
    el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    el.className = 'remote-audio';
    document.body.appendChild(el);
    remoteAudioEls.set(id, el);
  }
  if (el.srcObject !== stream) el.srcObject = stream;
  el.muted = state.silenced.has(id);
  el.play().catch(() => {
    // Tarayici dokunus bekliyor: ilk dokunusta yeniden dene
    document.addEventListener('click', () => el.play().catch(() => {}), { once: true, capture: true });
  });
}

function computeSameLanguage(waiting) {
  if (waiting || state.mode !== 'online' || !state.roomCode) return false;
  const list = state.participants || [];
  if (list.length < 2) return false;
  const first = baseLang(list[0].lang);
  return Boolean(first) && list.every((p) => baseLang(p.lang) === first);
}

function updateVoiceMode(waiting) {
  const want = computeSameLanguage(waiting);
  if (want && !state.voiceMode) enterVoiceMode();
  else if (!want && state.voiceMode) exitVoiceMode();
}

async function enterVoiceMode() {
  state.voiceMode = true;
  state.micMuted = false; // mikrofon varsayilan acik
  state.silenced.clear();
  if (state.isActive) await stopLiveSession(); // konusma tanima mikrofonu birakir
  // Herkes ayni dilde: soz isteme ve konusma suresi gerekmez
  if (state.handRaised || (state.queue || []).includes(state.clientId)) {
    state.handRaised = false;
    if (state.queue.includes(state.clientId)) toggleHand();
  }
  setInterimKey('voice.active');
  updateTurnUI();
  renderParticipants();
  const mesh = state.videoMesh;
  if (!mesh) return;
  mesh.setAudioMuted(false);
  if (window.CeviriRelay) window.CeviriRelay.setMute(state.roomCode, false);
  try {
    await mesh.startAudio();
  } catch {
    showAlert(t('voice.micFailed'));
  }
  if (!state.voiceMode) mesh.stopAudio(); // bu arada normal moda donulduyse
}

function exitVoiceMode() {
  if (!state.voiceMode) return;
  state.voiceMode = false;
  state.micMuted = false;
  state.silenced.clear();
  if (state.videoMesh) state.videoMesh.stopAudio();
  [...remoteAudioEls.keys()].forEach((id) => setRemoteAudio(id, null));
  if (state.roomCode && window.CeviriRelay) window.CeviriRelay.setMute(state.roomCode, false);
  if (state.roomCode) setInterimKey('online.yourTurn');
  updateTurnUI();
  renderParticipants();
}

// Karsidakinin sesini yalnizca kendi cihazimda sustur / ac (o kisi fark etmez)
function toggleListen(id) {
  if (!state.voiceMode) return;
  if (state.silenced.has(id)) state.silenced.delete(id);
  else state.silenced.add(id);
  const el = remoteAudioEls.get(id);
  if (el) el.muted = state.silenced.has(id);
  renderParticipants();
}

function toggleMyMic() {
  if (!state.voiceMode || !state.videoMesh) return;
  state.micMuted = !state.micMuted;
  state.videoMesh.setAudioMuted(state.micMuted);
  if (window.CeviriRelay) window.CeviriRelay.setMute(state.roomCode, state.micMuted);
  if (navigator.vibrate) navigator.vibrate(30);
  renderParticipants();
}

async function toggleMyCamera() {
  const mesh = state.videoMesh;
  if (!mesh || !state.roomCode) return;
  if (mesh.cameraOn) {
    mesh.stopCamera();
    window.CeviriRelay.setCam(state.roomCode, false);
  } else {
    try {
      await mesh.startCamera();
      window.CeviriRelay.setCam(state.roomCode, true);
    } catch {
      showAlert(t('video.denied'));
    }
  }
  renderParticipants();
}

function leaveOnlineRoom() {
  if (state.isActive) stopLiveSession();
  exitVoiceMode();
  if (state.videoMesh) {
    state.videoMesh.destroy();
    state.videoMesh = null;
  }
  state.group = false;
  state.queue = [];
  state.participants = [];
  state.handRaised = false;
  state.ownerId = null;
  state.roomLocked = false;
  state.holderSince = 0;
  state.lobby = [];
  state.awaitingApproval = false;
  state.isCreator = false;
  setWaitingInputs(false);
  renderParticipants();
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.roomCode = '';
  state.partnerName = '';
  state.activeMicClientId = null;
  state.activeMicName = null;
  els.partnerLangSelect.disabled = false;
  els.onlineActiveView.classList.add('hidden');
  els.onlineJoinView.classList.remove('hidden');
  updateAttachVisibility();
  updateLanguageBadges();
  updateTurnUI();
  updateRoomLayout();
  if (window.AybaHooks && typeof window.AybaHooks.left === 'function') window.AybaHooks.left();
}

function exportTranscript() {
  if (!state.messages.length) return;
  els.exportModal.classList.remove('hidden');
}

function exportWho(m) {
  return m.senderName || (m.speaker === 'me' ? t('who.meUpper') : t('who.partnerUpper'));
}

function exportFileBase() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `ceviri-sohbet-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Iki dilli, yazdirilabilir dokum (tum alfabeler icin sistem yazi tipleri)
function buildTranscriptHtml() {
  const dateStr = new Date().toLocaleString(getUiLang());
  const items = state.messages
    .map((m) => {
      const langs = m.targetLang
        ? `${findLanguage(m.sourceLang).short} → ${findLanguage(m.targetLang).short}`
        : findLanguage(m.sourceLang).short;
      return `<div class="m ${m.speaker === 'me' ? 'me' : 'partner'}">
  <div class="who">${escapeHtml(exportWho(m))} · ${escapeHtml(langs)} · ${escapeHtml(m.time)}</div>
  <div class="o" dir="auto"><span class="lbl">${escapeHtml(t('export.original'))}:</span> ${escapeHtml(m.originalText)}</div>
  ${m.translatedText ? `<div class="t" dir="auto"><span class="lbl">${escapeHtml(t('export.translation'))}:</span> ${escapeHtml(m.translatedText)}</div>` : ''}
</div>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(getUiLang())}" dir="${isRtl() ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(t('export.docTitle'))}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", "Noto Sans CJK SC", sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 18px; }
  .m { border-left: 4px solid #10b981; padding: 8px 12px; margin: 0 0 10px; break-inside: avoid; page-break-inside: avoid; background: #f7f7f8; }
  html[dir="rtl"] .m { border-left: 0; border-right: 4px solid #10b981; }
  .m.partner { border-color: #6366f1; }
  .who { font-size: 11px; font-weight: 700; color: #444; margin-bottom: 4px; }
  .o { font-size: 14px; line-height: 1.45; }
  .t { font-size: 14px; line-height: 1.45; font-weight: 600; margin-top: 4px; }
  .lbl { font-weight: 400; color: #666; font-size: 12px; }
</style>
</head>
<body>
<h1>${escapeHtml(t('export.docTitle'))}</h1>
<div class="meta">${escapeHtml(dateStr)} · ${escapeHtml(t('stream.count', { n: state.messages.length }))}</div>
${items}
</body>
</html>`;
}

async function exportPdf() {
  els.exportModal.classList.add('hidden');
  if (!state.messages.length) return;
  const html = buildTranscriptHtml();
  const name = exportFileBase();
  if (window.CeviriTools) {
    // Uygulama: sistemin "PDF olarak kaydet" ekrani
    try {
      await window.CeviriTools.printHtml({ html, name });
    } catch {
      showAlert(t('export.failed'));
    }
    return;
  }
  // Tarayici / bilgisayar: yazdirma penceresinde "PDF olarak kaydet"
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.onload = () => {
    try {
      frame.contentWindow.document.title = name;
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      showAlert(t('export.failed'));
    }
    setTimeout(() => frame.remove(), 60000);
  };
  frame.srcdoc = html;
}

async function exportTxt() {
  els.exportModal.classList.add('hidden');
  if (!state.messages.length) return;
  const lines = state.messages.map(
    (m) =>
      `[${m.time}] ${m.senderName || (m.speaker === 'me' ? t('who.meUpper') : t('who.partnerUpper'))} (${findLanguage(m.sourceLang).short} -> ${findLanguage(m.targetLang).short})\n${t('export.original')}: ${m.originalText}\n${t('export.translation')}: ${m.translatedText}\n`
  );
  const header = `${t('export.docTitle')} — ${new Date().toLocaleString(getUiLang())}\n\n`;
  const blob = new Blob(['\ufeff' + header + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  try {
    await saveBlob(blob, `${exportFileBase()}.txt`, 'text/plain');
  } catch {
    showAlert(t('export.failed'));
  }
}

// ---------------------------------------------------------------------------
// Ekran acik kalsin: canli ceviri surerken ve odadayken
// ---------------------------------------------------------------------------
let wakeWanted = false;
let wakeSentinel = null;
async function applyWakeLock() {
  const want =
    (Boolean(state.settings.keepAwake) && (state.isActive || (state.mode === 'online' && Boolean(state.roomCode)))) ||
    state.watch !== 'off'; // saat modunda telefon karsidakini dinledigi icin ekran acik kalir
  if (want === wakeWanted && (!want || window.CeviriTools || wakeSentinel)) return;
  wakeWanted = want;
  if (window.CeviriTools) {
    window.CeviriTools.setKeepScreenOn({ on: want }).catch(() => {});
    return;
  }
  try {
    if (want && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeSentinel) {
        wakeSentinel = await navigator.wakeLock.request('screen');
        wakeSentinel.addEventListener('release', () => (wakeSentinel = null));
      }
    } else if (!want && wakeSentinel) {
      await wakeSentinel.release();
      wakeSentinel = null;
    }
  } catch {
    wakeSentinel = null; // tarayici izin vermedi
  }
}

// ---------------------------------------------------------------------------
// Kulaklik dugmesi (oynat/duraklat) ile konusmayi baslat / durdur (uygulama)
// ---------------------------------------------------------------------------
let mediaButtonsOn = null;
function updateMediaButtons() {
  const tools = window.CeviriTools;
  if (!tools) return;
  const want = Boolean(state.settings.headsetButton) && ['loop', 'face', 'online'].includes(state.mode);
  if (want === mediaButtonsOn) return;
  mediaButtonsOn = want;
  tools.setMediaButtons({ enabled: want }).catch(() => {});
}

function onHeadsetButton() {
  if (!state.settings.headsetButton) return;
  if (navigator.vibrate) navigator.vibrate(40);
  if (state.mode === 'face') {
    // Yuz Yuze: kulaklik bendeyse "Ben" konusur
    els.faceMeBtn.click();
  } else if (state.mode === 'online' && state.voiceMode) {
    toggleMyMic();
  } else if (state.mode === 'loop' || state.mode === 'online') {
    if (!els.mainToggleBtn.disabled) els.mainToggleBtn.click();
  }
}

// ---------------------------------------------------------------------------
// Cevrimdisi ceviri paketleri (Ayarlar)
// ---------------------------------------------------------------------------
const offlineBusy = new Set();
async function renderOfflineSection() {
  const tools = window.CeviriTools;
  const box = document.getElementById('offlineLangs');
  if (!tools || !box) return;
  let have = [];
  try {
    have = ((await tools.offlineModels()).languages || []).map(baseLang);
  } catch {
    have = [];
  }
  const codes = [...new Set([state.myLang, state.partnerLang])];
  const rows = await Promise.all(
    codes.map(async (code) => {
      let supported = true;
      let mlCode = baseLang(code);
      try {
        const r = await tools.offlineSupported({ lang: code });
        supported = Boolean(r.supported);
        if (r.code) mlCode = baseLang(r.code);
      } catch {
        supported = false;
      }
      const row = document.createElement('div');
      row.className = 'offline-row';
      const name = document.createElement('span');
      name.className = 'offline-name';
      name.textContent = displayLangName(code, findLanguage(code).name);
      row.appendChild(name);
      if (!supported) {
        const st = document.createElement('span');
        st.className = 'offline-status muted';
        st.textContent = t('offline.notAvailable');
        row.appendChild(st);
      } else if (have.includes(mlCode)) {
        const st = document.createElement('span');
        st.className = 'offline-status ok';
        st.textContent = t('offline.ready');
        row.appendChild(st);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mini-btn offline-dl';
        const busy = offlineBusy.has(mlCode);
        btn.disabled = busy;
        btn.textContent = busy ? t('offline.downloading') : t('offline.download');
        btn.addEventListener('click', async () => {
          offlineBusy.add(mlCode);
          renderOfflineSection();
          try {
            await tools.downloadOffline({ lang: code });
          } catch {
            showAlert(t('offline.dlFailed'));
          }
          offlineBusy.delete(mlCode);
          renderOfflineSection();
        });
        row.appendChild(btn);
      }
      return row;
    })
  );
  box.replaceChildren(...rows);
}

// Event Listeners
function bindEvents() {
  els.myLangSelect.addEventListener('change', (e) => {
    state.myLang = e.target.value;
    localStorage.setItem(STORAGE_KEYS.myLang, state.myLang);
    updateLanguageBadges();
    renderOfflineSection();
    if (state.mode === 'online' && state.roomCode) {
      connectToRoom(state.roomCode);
    }
    if (state.isActive && state.activeSpeaker === 'me') startListening();
  });

  els.partnerLangSelect.addEventListener('change', (e) => {
    state.partnerLang = e.target.value;
    localStorage.setItem(STORAGE_KEYS.partnerLang, state.partnerLang);
    updateLanguageBadges();
    renderOfflineSection();
    if (state.isActive && state.activeSpeaker === 'partner') startListening();
  });

  els.swapLangsBtn.addEventListener('click', () => {
    const prevMy = state.myLang;
    state.myLang = state.partnerLang;
    state.partnerLang = prevMy;
    localStorage.setItem(STORAGE_KEYS.myLang, state.myLang);
    localStorage.setItem(STORAGE_KEYS.partnerLang, state.partnerLang);
    els.myLangSelect.value = state.myLang;
    els.partnerLangSelect.value = state.partnerLang;
    updateLanguageBadges();
    if (state.isActive) startListening();
  });

  els.modeCameraBtn.addEventListener('click', () => setMode('camera'));
  els.modeLoopBtn.addEventListener('click', () => setMode('loop'));
  // Kulaklik takiliyken: "Ben"in cevirisi telefondan da duyulsun / yalnizca kulaklik
  const speakerTooBtn = document.getElementById('speakerTooBtn');
  if (speakerTooBtn) {
    speakerTooBtn.addEventListener('click', () => {
      if (!state.headsetConnected) return;
      state.speakerToo = !state.speakerToo;
      if (!state.speakerToo && AudioRoute) AudioRoute.stop().catch(() => {});
      renderAudioRoute();
    });
  }
  initAudioRoute();
  initWatch();
  els.modeFaceBtn.addEventListener('click', () => setMode('face'));
  els.modeOnlineBtn.addEventListener('click', () => setMode('online'));
  // Odadayken sekmeler yerine ust cubuktaki mod dugmesi (uygulamada)
  const modeMenu = document.getElementById('modeMenuSelect');
  if (modeMenu) modeMenu.addEventListener('change', (e) => setMode(e.target.value));

  els.createRoomBtn.addEventListener('click', createOnlineRoom);
  els.joinRoomBtn.addEventListener('click', joinOnlineRoom);
  els.leaveRoomBtn.addEventListener('click', leaveOnlineRoom);
  els.copyInviteBtn.addEventListener('click', async () => {
    // Her kopyalamada yeni, tek kisilik link
    updateInviteLink(true);
    const link = els.inviteLinkInput.value;
    if (!link) return;
    if (await copyText(link)) {
      els.copyInviteBtn.textContent = t('msg.copied');
      els.copyInviteBtn.dataset.copied = '1';
      setTimeout(() => {
        delete els.copyInviteBtn.dataset.copied;
        els.copyInviteBtn.textContent = inviteLabel();
      }, 1600);
    } else {
      // Kopyalanamadiysa link gorunsun, elle kopyalanabilsin
      showAlert(link);
    }
  });

  els.mainToggleBtn.addEventListener('click', () => {
    if (
      !state.isActive &&
      state.mode === 'online' &&
      state.group &&
      state.activeMicClientId &&
      state.activeMicClientId !== state.clientId
    ) {
      toggleHand();
      return;
    }
    if (state.isActive) {
      stopLiveSession();
    } else {
      startLiveSession(state.activeSpeaker);
    }
  });

  els.turnMeBtn.addEventListener('click', () => switchTurn('me'));
  els.turnPartnerBtn.addEventListener('click', () => switchTurn('partner'));
  els.swapTurnBtn.addEventListener('click', () => {
    switchTurn(state.activeSpeaker === 'me' ? 'partner' : 'me');
  });

  els.faceMeBtn.addEventListener('click', () => {
    if (state.isActive && state.activeSpeaker === 'me') {
      stopLiveSession();
    } else {
      startLiveSession('me');
    }
  });

  els.facePartnerBtn.addEventListener('click', () => {
    if (state.isActive && state.activeSpeaker === 'partner') {
      stopLiveSession();
    } else {
      startLiveSession('partner');
    }
  });

  els.lockRoomBtn.addEventListener('click', () => {
    if (state.roomCode && window.CeviriRelay) window.CeviriRelay.setLocked(state.roomCode, !state.roomLocked);
  });
  els.videoReceiveBtn.addEventListener('click', () => {
    if (!state.videoMesh) return;
    state.videoMesh.setReceiveVideo(!state.videoMesh.receiveVideo);
    renderParticipants();
  });
  // Ekran donunce / klavye acilinca kamera kutulari yeniden yerlesir
  window.addEventListener('resize', () => {
    layoutVideoGrid();
    // Klavye acilinca / ekran donunce son mesaj gorunur kalsin
    if (document.body.classList.contains('in-room')) els.chatStream.scrollTop = els.chatStream.scrollHeight;
    if (state.roomCode) renderRoomTools();
  });

  // Grup odasinda konusma geri sayimi her saniye yenilenir
  setInterval(() => {
    if (state.mode === 'online' && state.roomCode && state.group && state.activeMicClientId && !state.voiceMode) {
      renderParticipants();
      updateTurnUI();
    }
  }, 1000);

  els.attachInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    handleAttach(file);
  });

  els.textTranslateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.textInput.value.trim();
    if (!text) return;
    const speaker = els.textSpeakerSelect.value;
    els.textInput.value = '';
    const wasActive = state.isActive;
    if (wasActive) abortRecognition();
    await handleUtterance(text, speaker);
    if (wasActive) startListening();
  });

  els.clearBtn.addEventListener('click', () => {
    if (state.mode === 'online') return;
    state.messages = [];
    els.chatStream.querySelectorAll('.msg-card').forEach((n) => n.remove());
    els.emptyState.classList.remove('hidden');
    els.messageCount.textContent = t('stream.count', { n: 0 });
  });

  els.exportBtn.addEventListener('click', exportTranscript);
  document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
  document.getElementById('exportTxtBtn').addEventListener('click', exportTxt);
  // Hakkinda (lisans ve sorumluluk reddi): telefon/tablet uygulamasi ve bilgisayar surumu
  const aboutModal = document.getElementById('aboutModal');
  const aboutBtn = document.getElementById('aboutBtn');
  aboutBtn.classList.toggle('hidden', !(IS_NATIVE_APP || IS_DESKTOP));
  aboutBtn.addEventListener('click', () => aboutModal.classList.remove('hidden'));
  document.getElementById('closeAboutBtn').addEventListener('click', () => aboutModal.classList.add('hidden'));
  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) aboutModal.classList.add('hidden');
  });
  document.getElementById('closeExportBtn').addEventListener('click', () => els.exportModal.classList.add('hidden'));
  els.exportModal.addEventListener('click', (e) => {
    if (e.target === els.exportModal) els.exportModal.classList.add('hidden');
  });

  // Yalnizca uygulamada olan ayarlar (kulaklik dugmesi, cevrimdisi paketler)
  document.querySelectorAll('.native-only').forEach((el) => el.classList.toggle('hidden', !window.CeviriTools));
  if (window.CeviriTools) {
    window.CeviriTools.addListener('mediaButton', onHeadsetButton).catch(() => {});
  }
  // Ekran acik kalsin: durum degistikce uygula (canli ceviri / oda)
  setInterval(applyWakeLock, 1500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      wakeWanted = false; // yeniden iste
      applyWakeLock();
    }
  });
  els.alertCloseBtn.addEventListener('click', hideAlert);

  // Settings modal
  els.settingsBtn.addEventListener('click', () => {
    els.settingsModal.classList.remove('hidden');
    renderOfflineSection();
  });

  els.closeSettingsBtn.addEventListener('click', () => {
    els.settingsModal.classList.add('hidden');
  });

  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) {
      els.settingsModal.classList.add('hidden');
    }
  });

  els.autoSpeakToggle.checked = state.settings.autoSpeak;
  els.flipPartnerToggle.checked = state.settings.flipPartner;
  els.speechRateRange.value = String(state.settings.speechRate);
  els.rateValueLabel.textContent = `${state.settings.speechRate.toFixed(2).replace(/\.00$/, '.0')}x`;
  els.facePartnerCard.classList.toggle('flipped', state.settings.flipPartner);

  els.autoSpeakToggle.addEventListener('change', (e) => {
    state.settings.autoSpeak = e.target.checked;
    saveSettings();
  });

  els.autoDetectToggle.checked = state.settings.autoDetect;
  els.keepAwakeToggle.checked = state.settings.keepAwake;
  els.headsetButtonToggle.checked = state.settings.headsetButton;
  els.autoDetectToggle.addEventListener('change', (e) => {
    state.settings.autoDetect = e.target.checked;
    saveSettings();
  });
  els.keepAwakeToggle.addEventListener('change', (e) => {
    state.settings.keepAwake = e.target.checked;
    saveSettings();
    applyWakeLock();
  });
  els.headsetButtonToggle.addEventListener('change', (e) => {
    state.settings.headsetButton = e.target.checked;
    saveSettings();
    updateMediaButtons();
  });

  els.flipPartnerToggle.addEventListener('change', (e) => {
    state.settings.flipPartner = e.target.checked;
    els.facePartnerCard.classList.toggle('flipped', state.settings.flipPartner);
    saveSettings();
  });

  els.speechRateRange.addEventListener('input', (e) => {
    state.settings.speechRate = parseFloat(e.target.value);
    els.rateValueLabel.textContent = `${state.settings.speechRate.toFixed(2).replace(/\.00$/, '.0')}x`;
    saveSettings();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!els.settingsModal.classList.contains('hidden')) return;

    if (e.code === 'Space' && state.mode === 'loop') {
      e.preventDefault();
      els.mainToggleBtn.click();
    } else if (e.code === 'Tab' && state.mode === 'loop' && state.isActive) {
      e.preventDefault();
      els.swapTurnBtn.click();
    }
  });
}

// Arayuz dili secimi (ust bardaki 🌐 ve Ayarlar)
function populateUiLangSelect() {
  const sel = document.getElementById('uiLangSelect');
  if (!sel) return;
  sel.innerHTML = '';
  for (const l of UI_LANGS) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.name;
    opt.dir = 'auto';
    if (l.code === getUiLang()) opt.selected = true;
    sel.appendChild(opt);
  }
  const code = document.getElementById('uiLangBtnCode');
  if (code) code.textContent = getUiLang().split('-')[0].toUpperCase();
}

function rerenderForUiLang() {
  populateUiLangSelect();
  populateLanguageSelects();
  setPhase(state.phase);
  updateTurnUI();
  els.messageCount.textContent = t('stream.count', { n: state.messages.length });
  els.chatStream.querySelectorAll('.replay-btn').forEach((b) => (b.textContent = t('msg.replay')));
  els.chatStream.querySelectorAll('.copy-btn').forEach((b) => (b.textContent = t('msg.copy')));
  renderSlot('interim');
  renderSlot('badge');
  renderSlot('presence');
  fileCards.forEach((entry) => renderFileCard(entry));
  renderParticipants();
  renderAudioRoute();
  // Henuz konusulmamis yuz yuze kartlari yeni dilde goster
  [els.faceMeText, els.facePartnerText].forEach((el) => {
    if (!state.isActive && el.dataset.untouched !== 'false') el.textContent = t('face.tap');
  });
}

function bindUiLang() {
  initI18n();
  populateUiLangSelect();
  setInterimKey('hint.start', null, true);
  els.faceMeText.textContent = t('face.tap');
  els.facePartnerText.textContent = t('face.tap');
  els.messageCount.textContent = t('stream.count', { n: 0 });
  const sel = document.getElementById('uiLangSelect');
  if (sel) sel.addEventListener('change', (e) => setUiLang(e.target.value));
  onUiLangChange(rerenderForUiLang);
}

async function translateViaApi(text, sourceLang, targetLang) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sourceLang, targetLang }),
  });
  if (!res.ok) throw await translateError(res);
  const data = await res.json();
  return data.translatedText || '';
}

function setupCamera() {
  if (IS_GUEST) return; // Misafirde kamera sekmesi yok
  cameraCtl = initCamera({
    t,
    censor,
    showAlert,
    langName: (code) => displayLangName(code, findLanguage(code).name),
    getLangs: () => ({ from: state.partnerLang, to: state.myLang }),
    translate: translateViaApi,
    speak: (text, lang) => speakText(text, lang),
  });
}

function init() {
  bindUiLang();
  setupCamera();
  populateLanguageSelects();
  updateTurnUI();
  drawIdleOrb();
  bindEvents();

  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = (urlParams.get('room') || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const modeFromUrl = urlParams.get('mode');

  if (AYBA_ROLE) {
    setMode('online');
  } else if (IS_GUEST) {
    // Misafir: yalnizca davet linkiyle, adini yazip katilir
    setMode('online');
    updateGuestJoinView();
    if (state.myName) els.onlineNameInput.value = state.myName;
    if (guestInvite) els.onlineNameInput.focus();
  } else if (roomFromUrl) {
    setMode('online');
    els.onlineRoomInput.value = roomFromUrl;
    if (state.myName) {
      els.onlineNameInput.value = state.myName;
    }
    els.onlineNameInput.focus();
  } else if (modeFromUrl === 'online' || IS_GUEST) {
    setMode('online');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (!SpeechRecognitionAPI) {
    showAlert(
      t('err.noSRInfo')
    );
  }
}

init();

// ---------------------------------------------------------------------------
// Canli destek katmani (support-ui.js) icin dar bir arayuz
// ---------------------------------------------------------------------------
window.AybaApp = {
  role: AYBA_ROLE,
  /** Uye: kendi bire bir odasini kurar; { code, token } verir. */
  async startMemberRoom(name) {
    els.onlineNameInput.value = name;
    await createOnlineRoom();
    if (!state.roomCode) throw new Error('room');
    for (let i = 0; i < 40 && !state.inviteToken; i++) {
      updateInviteLink(true);
      if (!state.inviteToken) await new Promise((r) => setTimeout(r, 150));
    }
    return { code: state.roomCode, token: state.inviteToken };
  },
  /** Yonetici: ustlendigi odaya tek kullanimlik anahtarla girer. */
  joinAsAdmin(code, token, name) {
    guestInvite = { code, token };
    els.onlineNameInput.value = name;
    joinOnlineRoom();
  },
  approve(target) {
    return window.CeviriRelay.approve(state.roomCode, target);
  },
  reject(target) {
    return window.CeviriRelay.reject(state.roomCode, target);
  },
  lock() {
    return window.CeviriRelay.setLocked(state.roomCode, true);
  },
  leave() {
    if (state.roomCode) leaveOnlineRoom();
  },
  get clientId() {
    return state.clientId;
  },
  get roomCode() {
    return state.roomCode;
  },
  get myLang() {
    return state.myLang;
  },
  messages() {
    return state.messages.slice();
  },
  clearMessages() {
    state.messages = [];
    els.chatStream.querySelectorAll('.msg-card').forEach((n) => n.remove());
    fileCards.clear();
    els.emptyState.classList.remove('hidden');
    els.messageCount.textContent = t('stream.count', { n: 0 });
  },
  t,
  langName: (code) => findLanguage(code).nativeName || findLanguage(code).name || code,
  showAlert,
};
window.dispatchEvent(new Event('ayba-app-ready'));
