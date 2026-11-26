// CEVIRI - Arayuz dili (cok dilli arayuz)
//
// Tum arayuz yazilari i18n-data.js icindeki sozluklerden gelir. Ilk acilista
// cihazin dili secilir; kullanici ayarlardan (veya ust bardaki 🌐) degistirebilir.
//
// HTML'de:
//   data-i18n="anahtar"            -> elemanin yazisi
//   data-i18n-html="anahtar"       -> elemanin HTML'i (<strong> gibi etiketli metinler)
//   data-i18n-attr="placeholder:anahtar;title:anahtar2;aria-label:anahtar3"

import { STRINGS } from './i18n-data.js';

export const UI_LANGS = [
  { code: 'tr', name: 'Türkçe' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية', rtl: true },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'uk', name: 'Українська' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'sv', name: 'Svenska' },
  { code: 'no', name: 'Norsk' },
  { code: 'da', name: 'Dansk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'cs', name: 'Čeština' },
  { code: 'ro', name: 'Română' },
  { code: 'hu', name: 'Magyar' },
  { code: 'bg', name: 'Български' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'az', name: 'Azərbaycan dili' },
  { code: 'fa', name: 'فارسی', rtl: true },
  { code: 'he', name: 'עברית', rtl: true },
];

const STORAGE_KEY = 'ceviri_ui_lang';
const FALLBACK = 'tr';
let current = FALLBACK;
const listeners = [];

/** Konusma dili kodunu (tr-TR, zh-TW, nb-NO, iw...) arayuz dili koduna cevirir. */
export function toUiLang(code) {
  if (!code || typeof code !== 'string') return null;
  const lower = code.toLowerCase();
  if (lower.startsWith('zh')) {
    return /tw|hk|mo|hant/.test(lower) ? 'zh-TW' : 'zh-CN';
  }
  let base = lower.split(/[-_]/)[0];
  if (base === 'nb' || base === 'nn') base = 'no';
  if (base === 'iw') base = 'he';
  return UI_LANGS.some((l) => l.code === base) ? base : null;
}

function detectInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch {
    // localStorage yoksa yoksay
  }
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const p of prefs) {
    const ui = toUiLang(p);
    if (ui && STRINGS[ui]) return ui;
  }
  return FALLBACK;
}

export function getUiLang() {
  return current;
}

export function isRtl(code = current) {
  return Boolean(UI_LANGS.find((l) => l.code === code)?.rtl);
}

/** Ceviri: once secili dil, yoksa Ingilizce, yoksa Turkce, yoksa anahtarin kendisi. */
export function t(key, vars) {
  const dict = STRINGS[current] || {};
  let s = dict[key];
  if (s === undefined) s = (STRINGS.en || {})[key];
  if (s === undefined) s = (STRINGS.tr || {})[key];
  if (s === undefined) return key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : m));
  }
  return s;
}

let displayNames = null;
let displayNamesLang = null;

/** Bir dil kodunun (tr-TR, en-US...) secili arayuz dilindeki adi. */
export function langName(code, fallbackName) {
  try {
    if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
      if (displayNamesLang !== current) {
        displayNames = new Intl.DisplayNames([current], { type: 'language' });
        displayNamesLang = current;
      }
      const n = displayNames.of(code);
      if (n && n !== code) return n.charAt(0).toLocaleUpperCase(current) + n.slice(1);
    }
  } catch {
    // Intl.DisplayNames yoksa yedek ada dus
  }
  return fallbackName || code;
}

/** Bir kokun altindaki tum data-i18n* isaretli elemanlari gunceller. */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.getAttribute('data-i18n-attr')
      .split(';')
      .forEach((pair) => {
        const [attr, key] = pair.split(':').map((x) => x.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
  });
  document.title = t('app.title');
  document.documentElement.lang = current;
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
}

export function setUiLang(code) {
  if (!STRINGS[code]) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // yoksay
  }
  applyI18n();
  listeners.forEach((fn) => {
    try {
      fn(code);
    } catch (e) {
      console.error(e);
    }
  });
}

export function onUiLangChange(fn) {
  listeners.push(fn);
}

export function initI18n() {
  current = detectInitial();
  applyI18n();
  return current;
}
