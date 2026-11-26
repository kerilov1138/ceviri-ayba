// CEVIRI - Kamerayla yazi cevirme
//
// Fotograf (kamera veya galeri) -> Tesseract.js ile yazi tanima (OCR, cihazda)
// -> /api/translate ile ceviri. Yazinin dili "Karsidakinin dili", ceviri
// "Benim dilim"e yapilir. Dil paketi ilk kullanimda internetten bir kez inir,
// sonra cihazda saklanir (IndexedDB).

// Konusma dili kodu -> Tesseract dil paketi
const TESS_LANG = {
  tr: 'tur', en: 'eng', de: 'deu', fr: 'fra', es: 'spa', it: 'ita', pt: 'por', ru: 'rus', ar: 'ara', ja: 'jpn',
  ko: 'kor', 'zh-CN': 'chi_sim', 'zh-TW': 'chi_tra', nl: 'nld', pl: 'pol', uk: 'ukr', el: 'ell', sv: 'swe',
  no: 'nor', da: 'dan', fi: 'fin', cs: 'ces', ro: 'ron', hu: 'hun', bg: 'bul', hi: 'hin', id: 'ind', vi: 'vie',
  th: 'tha', az: 'aze', fa: 'fas', he: 'heb',
};

const MAX_SIDE = 1800; // buyuk fotograflari kucult: hizli ve yeterince net
const MAX_CHARS = 4000;

export function tessLangFor(code) {
  const lower = String(code || '').toLowerCase();
  if (lower.startsWith('zh')) return /tw|hk|mo|hant/.test(lower) ? 'chi_tra' : 'chi_sim';
  let base = lower.split(/[-_]/)[0];
  if (base === 'nb' || base === 'nn') base = 'no';
  if (base === 'iw') base = 'he';
  return TESS_LANG[base] || 'eng';
}

let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractLoading) {
    tesseractLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('tesseract/tesseract.min.js', document.baseURI).href;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract')));
      s.onerror = () => {
        tesseractLoading = null;
        reject(new Error('Tesseract'));
      };
      document.head.appendChild(s);
    });
  }
  return tesseractLoading;
}

let worker = null;
let workerLang = null;
let currentLogger = () => {};

async function getWorker(tessLang) {
  if (worker && workerLang === tessLang) return worker;
  const Tesseract = await loadTesseract();
  if (worker) {
    try {
      await worker.terminate();
    } catch {
      // yoksay
    }
    worker = null;
  }
  const opts = {
    workerPath: new URL('tesseract/worker.min.js', document.baseURI).href,
    corePath: new URL('tesseract/core/', document.baseURI).href,
    workerBlobURL: false,
    logger: (m) => currentLogger(m),
  };
  // Testlerde dil paketleri yerel sunucudan verilebilsin
  if (window.CEVIRI_TESS_LANG_PATH) opts.langPath = window.CEVIRI_TESS_LANG_PATH;
  worker = await Tesseract.createWorker(tessLang, 1, opts);
  workerLang = tessLang;
  return worker;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}

function toCanvas(img) {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** OCR ciktisini toparlar: bos satirlari ve fazla bosluklari temizler. */
export function cleanOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l && /[\p{L}\p{N}]/u.test(l))
    .join('\n')
    .slice(0, MAX_CHARS);
}

/**
 * Kamera sekmesini baglar.
 * deps: { els, t, censor, langName, getLangs: () => ({ from, to }), translate, speak, onStatus }
 */
export function initCamera(deps) {
  const $ = (id) => document.getElementById(id);
  const el = {
    capture: $('cameraCaptureInput'),
    pick: $('cameraPickInput'),
    previewWrap: $('cameraPreviewWrap'),
    preview: $('cameraPreview'),
    status: $('cameraStatus'),
    bar: $('cameraProgressBar'),
    statusText: $('cameraStatusText'),
    result: $('cameraResult'),
    source: $('cameraSourceText'),
    translated: $('cameraTranslatedText'),
    retranslate: $('cameraRetranslateBtn'),
    speak: $('cameraSpeakBtn'),
    copy: $('cameraCopyBtn'),
    direction: $('cameraDirection'),
  };
  if (!el.capture) return { updateDirection() {} };

  let busy = false;
  let lastPreviewUrl = null;
  let lastTranslation = { text: '', lang: '' };

  function setStatus(text, progress) {
    el.status.classList.remove('hidden');
    el.statusText.textContent = text;
    el.bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress || 0)) * 100)}%`;
  }

  function hideStatus() {
    el.status.classList.add('hidden');
  }

  function updateDirection() {
    const { from, to } = deps.getLangs();
    el.direction.textContent = `${deps.langName(from)} → ${deps.langName(to)}`;
  }

  async function translateSource() {
    const { from, to } = deps.getLangs();
    const src = deps.censor(el.source.value.trim(), from);
    el.source.value = src;
    if (!src) return;
    el.translated.textContent = '…';
    try {
      const res = await deps.translate(src, from, to);
      const text = deps.censor(res || '', to);
      el.translated.textContent = text;
      lastTranslation = { text, lang: to };
    } catch (err) {
      el.translated.textContent = '';
      deps.showAlert(deps.t('err.translate', { err: err.message }));
    }
  }

  async function handleFile(file) {
    if (!file || busy) return;
    busy = true;
    el.result.classList.add('hidden');
    const { from } = deps.getLangs();
    const tessLang = tessLangFor(from);
    const langLabel = deps.langName(from);
    try {
      setStatus(deps.t('cam.preparing', { p: 0 }), 0);
      const { img, url } = await loadImage(file);
      if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
      lastPreviewUrl = url;
      el.preview.src = url;
      el.previewWrap.classList.remove('hidden');
      const canvas = toCanvas(img);

      currentLogger = (m) => {
        const p = typeof m.progress === 'number' ? m.progress : 0;
        const pct = Math.round(p * 100);
        if (m.status === 'loading language traineddata') {
          setStatus(deps.t('cam.downloading', { lang: langLabel, p: pct }), p);
        } else if (m.status === 'recognizing text') {
          setStatus(deps.t('cam.reading', { p: pct }), p);
        } else {
          setStatus(deps.t('cam.preparing', { p: pct }), p);
        }
      };
      const w = await getWorker(tessLang);
      const { data } = await w.recognize(canvas);
      const text = cleanOcrText(data && data.text);
      if (!text) {
        hideStatus();
        deps.showAlert(deps.t('cam.noText'));
        return;
      }
      hideStatus();
      el.source.value = text;
      el.result.classList.remove('hidden');
      await translateSource();
      el.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      hideStatus();
      // Yarim kalan isci (or. dil paketi inemedi) bir dahakine bastan kurulsun
      worker = null;
      workerLang = null;
      deps.showAlert(deps.t('cam.error', { err: (err && err.message) || String(err) }));
    } finally {
      currentLogger = () => {};
      busy = false;
    }
  }

  const onChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // ayni fotograf yeniden secilebilsin
    handleFile(file);
  };
  el.capture.addEventListener('change', onChange);
  el.pick.addEventListener('change', onChange);

  el.retranslate.addEventListener('click', translateSource);
  el.speak.addEventListener('click', () => {
    if (lastTranslation.text) deps.speak(lastTranslation.text, lastTranslation.lang);
  });
  el.copy.addEventListener('click', async () => {
    if (!lastTranslation.text) return;
    try {
      await navigator.clipboard.writeText(lastTranslation.text);
      el.copy.textContent = deps.t('msg.copied');
      setTimeout(() => (el.copy.textContent = deps.t('msg.copy')), 1400);
    } catch {
      // yoksay
    }
  });

  updateDirection();
  return { updateDirection, handleFile };
}
