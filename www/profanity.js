// CEVIRI - Kufur filtresi
//
// censor(metin, dilKodu) -> kufurleri '***' ile degistirir.
// Her metin kendi dilinin listesiyle (profanity-data.js) ve butun dillerde
// gecerli kisa Ingilizce listeyle taranir. Konusma tanima bazi kufurleri kendi
// yildizlasa da her dilde bunu yapmadigi icin filtre her zaman uygulanir:
//   - konusulan/yazilan metin cevrilmeden ONCE (karsiya kufur hic gitmesin),
//   - ceviri sonucu (ceviri kufurlu bir kelime uretirse),
//   - online odada gelen mesajlar ve seslendirme.

import { PROFANITY, PROFANITY_INTL } from './profanity-data.js';

const MASK = '***';
const LETTER = '[\\p{L}\\p{M}\\p{N}]';
const cache = new Map();

const GREEK_ACCENTS = {
  α: '[αά]', ε: '[εέ]', η: '[ηή]', ι: '[ιίϊΐ]', ο: '[οό]', υ: '[υύϋΰ]', ω: '[ωώ]', σ: '[σς]',
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entryToPattern(entry, mode, accentFold) {
  const stem = entry.endsWith('*');
  const raw = (stem ? entry.slice(0, -1) : entry).trim().toLocaleLowerCase();
  let body = raw
    .split(/\s+/)
    .map((part) => {
      let p = escapeRe(part);
      if (accentFold) p = [...p].map((ch) => GREEK_ACCENTS[ch] || ch).join('');
      return p;
    })
    .join('\\s+');
  if (stem) body += mode === 'sub' ? '' : `${LETTER}*`;
  return body;
}

function buildRegex(words, mode, accentFold) {
  if (!words || !words.length) return null;
  // Uzun girdiler once: "orospu cocugu" "orospu"dan once eslessin
  const patterns = [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map((w) => entryToPattern(w, mode, accentFold));
  const alt = patterns.join('|');
  const src = mode === 'sub' ? `(?:${alt})` : `(?<!${LETTER})(?:${alt})(?!${LETTER})`;
  return new RegExp(src, 'giu');
}

/** Konusma dili kodunu (tr-TR, zh-TW, pt-BR...) listedeki anahtara cevirir. */
export function profanityKey(lang) {
  if (!lang) return null;
  const lower = String(lang).toLowerCase();
  if (lower.startsWith('zh')) return /tw|hk|mo|hant/.test(lower) ? 'zh-TW' : 'zh-CN';
  let base = lower.split(/[-_]/)[0];
  if (base === 'nb' || base === 'nn') base = 'no';
  if (base === 'iw') base = 'he';
  return PROFANITY[base] ? base : null;
}

function regexesFor(lang) {
  const key = profanityKey(lang) || '_';
  if (cache.has(key)) return cache.get(key);
  const list = [];
  const conf = PROFANITY[key];
  if (conf) list.push(buildRegex(conf.words, conf.mode, conf.accentFold));
  // Ortak Ingilizce kufurler: bosluksuz dillerde metin icinde, digerlerinde kelime olarak
  const intlMode = conf && conf.mode === 'sub' ? 'sub' : 'word';
  list.push(buildRegex(PROFANITY_INTL, intlMode, false));
  const out = list.filter(Boolean);
  cache.set(key, out);
  return out;
}

/** Metindeki kufurleri '***' ile degistirir. Dil bilinmiyorsa yalniz ortak liste uygulanir. */
export function censor(text, lang) {
  if (!text || typeof text !== 'string') return text;
  let out = text.normalize('NFC');
  const key = profanityKey(lang);
  const locale = key === 'tr' || key === 'az' ? key : undefined;
  for (const re of regexesFor(lang)) {
    // Buyuk harfli yazilari da yakala (Turkce I/İ dahil): kucuk harfe cevirip
    // eslesme yerlerini bul, ayni yerleri asil metinde maskele.
    const lowered = locale ? out.toLocaleLowerCase(locale) : out.toLocaleLowerCase();
    const source = lowered.length === out.length ? lowered : out;
    const ranges = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      ranges.push([m.index, m.index + m[0].length]);
    }
    for (let i = ranges.length - 1; i >= 0; i--) {
      out = out.slice(0, ranges[i][0]) + MASK + out.slice(ranges[i][1]);
    }
  }
  return out;
}

/** Metinde kufur var mi? */
export function hasProfanity(text, lang) {
  return censor(text, lang) !== (text || '').normalize('NFC');
}

/** Seslendirmeden once yildizlari temizler (TTS "yildiz yildiz" okumasin). */
export function stripMaskForSpeech(text) {
  return String(text || '')
    .replace(/\*+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
