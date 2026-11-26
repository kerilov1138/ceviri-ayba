// Canli destek sifrelemesi: parola, muhurleme, masa anahtari
const vm = require('vm'); const fs = require('fs'); const assert = require('assert');
const g = { crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, JSON, String, Number, Array, Error, Promise };
g.globalThis = g; vm.createContext(g);
vm.runInContext(fs.readFileSync(__dirname + '/../www/support-crypto.js', 'utf8'), g);
const C = g.AybaCrypto;
(async () => {
  await assert.rejects(C.generateAdminConfig('kisa', 'aybarion.com'), /en az 8/);
  const cfg = await C.generateAdminConfig('dogru-parola-123', 'Aybarion.com');
  assert.equal(cfg.siteId, 'aybarion.com');
  assert.ok(!JSON.stringify(cfg).includes('dogru-parola'));
  await assert.rejects(C.unlockAdmin(cfg, 'yanlis-parola'), /bad-password/);
  const k1 = await C.unlockAdmin(cfg, 'dogru-parola-123');
  const k2 = await C.unlockAdmin(cfg, 'dogru-parola-123');
  const ticket = { name: 'Ali', surname: 'Veli', company: 'ACME', code: 'ABCD-1234', token: 'tok' };
  const sealed = await C.sealForAdmins(cfg.adminPub, ticket);
  assert.ok(!JSON.stringify(sealed).includes('ACME'));
  assert.deepEqual(await C.openSealed(k1.priv, sealed), ticket);
  // Baska bir kurulumun yoneticisi acamaz
  const other = await C.unlockAdmin(await C.generateAdminConfig('baska-parola-9', 'x'), 'baska-parola-9');
  await assert.rejects(C.openSealed(other.priv, sealed));
  // Ayni parolayi bilen iki yonetici masa mesajlarini birbirine acabilir
  const m = await C.deskEncrypt(k1.deskKey, { op: 'claim', id: 't1' });
  assert.deepEqual(await C.deskDecrypt(k2.deskKey, m), { op: 'claim', id: 't1' });
  await assert.rejects(C.deskDecrypt(other.deskKey, m));
  const t1 = await C.deskTopic(cfg), t2 = await C.deskTopic(cfg);
  assert.equal(t1, t2); assert.match(t1, /^ceviri-ayba\/[0-9a-f]{32}\/desk$/);
  console.log('ALL CRYPTO TESTS PASS');
})().catch((e) => { console.error(e); process.exit(1); });
