/*
 * CEVIRI_AYBARION - Canli destek sifrelemesi
 *
 * Yonetici anahtari: kurulumda bir kez P-256 (ECDH) anahtar cifti uretilir.
 *  - Acik anahtar yapilandirmada durur: uyeler sira kayitlarini (oda kodu ve
 *    tek kullanimlik oda anahtari dahil) bununla muhurler.
 *  - Gizli anahtar yonetici parolasindan turetilen anahtarla (PBKDF2 +
 *    AES-GCM) sifreli durur. Yalnizca parolayi bilen yoneticiler acabilir.
 *  - Yoneticiler arasi masa mesajlari (ustlenme, suren gorusmeler) gizli
 *    anahtardan turetilen ortak bir anahtarla sifrelenir.
 */
(function (root) {
  'use strict';

  var subtle = root.crypto.subtle;
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var PBKDF2_ITER = 310000;
  var CURVE = { name: 'ECDH', namedCurve: 'P-256' };

  function b64(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(String(str));
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  function rand(n) {
    var u = new Uint8Array(n);
    root.crypto.getRandomValues(u);
    return u;
  }

  async function aesEncrypt(key, obj) {
    var iv = rand(12);
    var ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function aesDecrypt(key, blob) {
    var pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return JSON.parse(dec.decode(pt));
  }

  async function passwordKey(password, salt, iter) {
    var base = await subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function hkdfAesKey(secretBytes, info) {
    var base = await subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('ceviri-ayba-v1'), info: enc.encode(info) },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function sha256hex(str) {
    var h = new Uint8Array(await subtle.digest('SHA-256', enc.encode(str)));
    return Array.prototype.map.call(h, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function cleanSiteId(siteId) {
    return String(siteId || 'site').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 60) || 'site';
  }

  /** Kurulum araci: yeni yonetici anahtari ve yapilandirma uretir. */
  async function generateAdminConfig(password, siteId) {
    if (!password || String(password).length < 8) throw new Error('Parola en az 8 karakter olmali');
    var kp = await subtle.generateKey(CURVE, true, ['deriveBits']);
    var pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    var pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
    var salt = rand(16);
    var lockKey = await passwordKey(password, salt, PBKDF2_ITER);
    var iv = rand(12);
    var ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, lockKey, pkcs8);
    return {
      v: 1,
      siteId: cleanSiteId(siteId),
      adminPub: b64(pub),
      adminLock: { salt: b64(salt), iter: PBKDF2_ITER, iv: b64(iv), ct: b64(ct) },
    };
  }

  /**
   * Yonetici girisi: parola dogruysa gizli anahtari ve yoneticiler arasi
   * masa anahtarini verir; yanlissa 'bad-password' hatasi firlatir.
   */
  async function unlockAdmin(config, password) {
    var lock = config && config.adminLock;
    if (!lock) throw new Error('no-config');
    var lockKey = await passwordKey(password, unb64(lock.salt), Number(lock.iter) || PBKDF2_ITER);
    var pkcs8;
    try {
      pkcs8 = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.iv) }, lockKey, unb64(lock.ct)));
    } catch (e) {
      throw new Error('bad-password');
    }
    var priv = await subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
    var deskKey = await hkdfAesKey(pkcs8, 'desk');
    return { priv: priv, deskKey: deskKey };
  }

  /** Uye: bir nesneyi yalnizca yoneticilerin acabilecegi bicimde muhurler. */
  async function sealForAdmins(adminPubB64, obj) {
    var adminPub = await subtle.importKey('raw', unb64(adminPubB64), CURVE, false, []);
    var eph = await subtle.generateKey(CURVE, true, ['deriveBits']);
    var bits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: adminPub }, eph.privateKey, 256));
    var key = await hkdfAesKey(bits, 'seal');
    var blob = await aesEncrypt(key, obj);
    var epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
    return { epk: b64(epk), iv: blob.iv, ct: blob.ct };
  }

  /** Yonetici: muhurlu nesneyi acar (bozuk/yabanci ise hata firlatir). */
  async function openSealed(priv, sealed) {
    var epk = await subtle.importKey('raw', unb64(sealed.epk), CURVE, false, []);
    var bits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256));
    var key = await hkdfAesKey(bits, 'seal');
    return aesDecrypt(key, sealed);
  }

  /** Destek masasinin konusu: site + yonetici anahtarina ozgu, tahmin edilemez. */
  async function deskTopic(config) {
    var h = await sha256hex('ayba-desk|' + cleanSiteId(config.siteId) + '|' + config.adminPub);
    return 'ceviri-ayba/' + h.slice(0, 32) + '/desk';
  }

  root.AybaCrypto = {
    generateAdminConfig: generateAdminConfig,
    unlockAdmin: unlockAdmin,
    sealForAdmins: sealForAdmins,
    openSealed: openSealed,
    deskEncrypt: aesEncrypt,
    deskDecrypt: aesDecrypt,
    deskTopic: deskTopic,
    randomId: function () {
      return Array.prototype.map.call(rand(12), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
