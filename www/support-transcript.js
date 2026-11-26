/*
 * CEVIRI_AYBARION - Gorusme dokumu (PDF)
 *
 * Gorusme bitince yoneticinin tarafinda calisir: tarih/saat, yonetici adi,
 * musterinin ad soyadi ve firmasi ile tum konusmayi A4 PDF yapar. Sayfa
 * tarayicida cizildigi icin butun alfabeler (Arapca, Cince...) dogru cikar.
 */
(function (root) {
  'use strict';

  var A4_W_MM = 210;
  var A4_H_MM = 297;
  var MARGIN_MM = 12;
  var PX_W = 760; // cizim genisligi (piksel)

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function stamp(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function duration(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    s %= 60;
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s);
  }

  function asciiSlug(str) {
    var map = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
    return String(str || '')
      .replace(/[çÇğĞıİöÖşŞüÜ]/g, function (c) { return map[c]; })
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  /**
   * meta: { start: Date, end: Date, adminName, customerName, customerSurname,
   *         company, customerLang, adminLang }
   * messages: CEVIRI mesajlari ({ speaker, senderName, sourceLang, targetLang,
   *           originalText, translatedText, time })
   * L: etiketler ({ title, start, end, duration, admin, customer, company,
   *    customerLang, count, original, translation })
   */
  function hm(d) {
    d = new Date(d);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fill(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }

  function buildHtml(meta, messages, L, langName) {
    var hin = meta.handoverIn;
    var bannerDone = !hin;
    var banner = function (text) {
      return '<div class="hb" dir="auto">⇄ ' + esc(text) + '</div>';
    };
    var rows = messages.map(function (m) {
      var pre = '';
      if (!bannerDone && (Number(m.ts) || 0) >= hin.at) {
        bannerDone = true;
        pre = banner(fill(L.handover, { time: hm(hin.at), from: hin.fromName, to: hin.toName }));
      }
      var prev = hin && !bannerDone && m.senderName === hin.fromName;
      var langs = m.targetLang && m.targetLang !== m.sourceLang
        ? langName(m.sourceLang) + ' → ' + langName(m.targetLang)
        : langName(m.sourceLang);
      var mine = m.speaker === 'me';
      var showT = m.translatedText && m.translatedText !== m.originalText && m.targetLang !== m.sourceLang;
      return pre + '<div class="m ' + (prev ? 'p' : mine ? 'a' : 'c') + '">' +
        '<div class="w">' + esc(m.senderName) + ' · ' + esc(m.time) + ' · ' + esc(langs) + '</div>' +
        '<div class="o" dir="auto">' + (showT ? '<span class="l">' + esc(L.original) + ':</span> ' : '') + esc(m.originalText) + '</div>' +
        (showT ? '<div class="t" dir="auto"><span class="l">' + esc(L.translation) + ':</span> ' + esc(m.translatedText) + '</div>' : '') +
        '</div>';
    }).join('');
    if (!bannerDone) rows += banner(fill(L.handover, { time: hm(hin.at), from: hin.fromName, to: hin.toName }));
    if (meta.handoverOut) rows += banner(fill(L.handedOut, { time: hm(meta.handoverOut.at), to: meta.handoverOut.toName }));
    var customer = (meta.customerName + ' ' + (meta.customerSurname || '')).trim();
    var admins = (meta.segments || []).map(function (sg) {
      return sg.admin + ' (' + hm(sg.from) + '–' + hm(sg.to) + ')';
    }).join(' → ') || meta.adminName;
    var ratingText;
    var transferText = '';
    if (meta.handoverOut) transferText = fill(L.handedTo, { name: meta.handoverOut.toName, time: hm(meta.handoverOut.at) });
    else if (hin) transferText = hin.fromName + ' → ' + hin.toName + ' (' + hm(hin.at) + ')';
    if (meta.rating) ratingText = '★★★★★'.slice(0, meta.rating.stars) + '☆☆☆☆☆'.slice(0, 5 - meta.rating.stars) + '  ' + meta.rating.stars + '/5';
    else ratingText = L.noRating;
    var info = [
      [L.start, stamp(meta.start)],
      [L.end, stamp(meta.end)],
      [L.duration, duration(meta.end - meta.start)],
      [L.admin, admins],
      [L.customer, customer],
      [L.company, meta.company || '-'],
      [L.topic, meta.topic || '-'],
      [L.customerLang, meta.customerLang ? langName(meta.customerLang) : '-'],
    ].concat(transferText ? [[L.transfer, transferText]] : []).concat(meta.handoverOut ? [] : [[L.rating, ratingText]]).concat(meta.rating && meta.rating.comment ? [[L.comment, meta.rating.comment]] : []).concat([
      [L.count, String(messages.length)],
    ]).map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td dir="auto">' + esc(r[1]) + '</td></tr>'; }).join('');
    return '<div class="ayba-doc">' +
      '<style>' +
      '.ayba-doc{width:' + PX_W + 'px;padding:28px 30px;box-sizing:border-box;background:#fff;color:#111;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic","Noto Sans CJK SC",sans-serif}' +
      '.ayba-doc h1{font-size:20px;margin:0 0 2px}' +
      '.ayba-doc .sub{color:#555;font-size:12px;margin:0 0 14px}' +
      '.ayba-doc table{border-collapse:collapse;width:100%;margin:0 0 18px;font-size:13px}' +
      '.ayba-doc th{text-align:left;color:#444;font-weight:600;padding:5px 10px 5px 0;width:150px;vertical-align:top}' +
      '.ayba-doc td{padding:5px 0;border-bottom:1px solid #eee}' +
      '.ayba-doc .m{border-left:4px solid #0f766e;background:#f5f7f7;padding:8px 12px;margin:0 0 9px}' +
      '.ayba-doc .m.c{border-color:#4f46e5;background:#f6f6fb}' +
      '.ayba-doc .m.p{border-color:#b45309;background:#fdf8f0}' +
      '.ayba-doc .hb{margin:14px 0;padding:10px 12px;border:2px dashed #b45309;background:#fff7ed;color:#7c2d12;font-weight:700;font-size:13px;border-radius:6px}' +
      '.ayba-doc .w{font-size:11px;font-weight:700;color:#444;margin-bottom:3px}' +
      '.ayba-doc .t{font-weight:600;margin-top:3px}' +
      '.ayba-doc .l{font-weight:400;color:#666;font-size:12px}' +
      '</style>' +
      '<h1>' + esc(L.title) + '</h1>' +
      '<p class="sub">AYBARION · CEVIRI_AYBARION</p>' +
      '<table>' + info + '</table>' + rows + '</div>';
  }

  async function renderPdf(html) {
    var host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + PX_W + 'px;z-index:-1;';
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      var node = host.firstChild;
      var scale = 2;
      var canvas = await root.html2canvas(node, { scale: scale, backgroundColor: '#ffffff', logging: false, useCORS: false });
      var jsPDF = root.jspdf.jsPDF;
      var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      var contentW = A4_W_MM - 2 * MARGIN_MM;
      var contentH = A4_H_MM - 2 * MARGIN_MM;
      var pxPerMm = canvas.width / contentW;
      var pageHpx = Math.floor(contentH * pxPerMm);
      // Mesaj kutularini ortadan bolmemek icin sayfa sinirlarini kutu araliklarina cek
      var breaks = Array.prototype.map.call(node.querySelectorAll('.m, .hb, table'), function (el) {
        return Math.round((el.offsetTop + el.offsetHeight) * scale);
      });
      var y = 0;
      var first = true;
      while (y < canvas.height - 2) {
        var end = Math.min(y + pageHpx, canvas.height);
        if (end < canvas.height) {
          var fit = breaks.filter(function (b) { return b > y + pageHpx * 0.5 && b <= end; });
          if (fit.length) end = fit[fit.length - 1] + 4;
        }
        var slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = end - y;
        var ctx = slice.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
        if (!first) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM, MARGIN_MM, contentW, (end - y) / pxPerMm);
        first = false;
        y = end;
      }
      return pdf.output('blob');
    } finally {
      host.remove();
    }
  }

  function fileName(meta) {
    var d = meta.start;
    var who = [asciiSlug(meta.company), asciiSlug(meta.customerName + ' ' + (meta.customerSurname || ''))].filter(Boolean).join('_');
    return 'AYBARION-destek_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + (who ? '_' + who : '') + '.pdf';
  }

  async function build(meta, messages, labels, langName) {
    var html = buildHtml(meta, messages, labels, langName);
    var blob = await renderPdf(html);
    return { blob: blob, filename: fileName(meta), html: html };
  }

  root.AybaTranscript = { build: build, buildHtml: buildHtml, fileName: fileName, duration: duration, stamp: stamp };
})(window);
