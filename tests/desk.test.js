// Destek masasi: sira, ustlenme yarisi, suren gorusmeler
const vm = require('vm'); const fs = require('fs'); const assert = require('assert');
const g = { crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, JSON, String, Number, Array, Error, Promise, Map, Set, Math, Date, Object, setTimeout, clearTimeout, setInterval, clearInterval };
g.globalThis = g; vm.createContext(g);
for (const f of ['support-crypto.js', 'support-desk.js']) vm.runInContext(fs.readFileSync(__dirname + '/../www/' + f, 'utf8'), g);
const C = g.AybaCrypto, D = g.AybaDesk;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Iki aracidan gelir gibi: her mesaj iki kez ulasir
function bus() {
  const subs = [];
  const mk = () => ({
    handlers: {},
    subscribe(t, fn) { this.handlers[t] = fn; if (!subs.includes(this)) subs.push(this); },
    unsubscribe(t) { delete this.handlers[t]; },
    publish(t, text) { for (const s of subs) { const h = s.handlers[t]; if (h) { setTimeout(() => h(text), 5); setTimeout(() => h(text), 15); } } return 2; },
  });
  return mk;
}
(async () => {
  const cfg = await C.generateAdminConfig('parola-12345', 'aybarion.com');
  const keys1 = await C.unlockAdmin(cfg, 'parola-12345');
  const keys2 = await C.unlockAdmin(cfg, 'parola-12345');
  const cfgX = await C.generateAdminConfig('baska-12345', 'aybarion.com');
  const keysX = await C.unlockAdmin(cfgX, 'baska-12345');
  const mk = bus();
  let s1 = null, s2 = null, sx = null;
  const a1 = D.createAdminDesk({ config: cfg, pubsub: mk(), keys: keys1, me: { id: 'adm1', name: 'Ayse Yonetici' }, onChange: (s) => { s1 = s; } });
  const a2 = D.createAdminDesk({ config: cfg, pubsub: mk(), keys: keys2, me: { id: 'adm2', name: 'Mehmet Yonetici' }, onChange: (s) => { s2 = s; } });
  const ax = D.createAdminDesk({ config: cfgX, pubsub: mk(), keys: keysX, me: { id: 'x', name: 'X' }, onChange: (s) => { sx = s; } });
  await a1.start(); await a2.start(); await ax.start();
  const m1 = D.createMemberDesk({ config: cfg, pubsub: mk(), ticket: { name: 'Ali', surname: 'Kaya', company: 'ACME Ltd', lang: 'en-US', code: 'ROOM-1', token: 'tok-1', at: Date.now() - 1000 } });
  const m2 = D.createMemberDesk({ config: cfg, pubsub: mk(), ticket: { name: 'Zeynep', surname: 'Ak', company: 'Beta AS', lang: 'tr-TR', code: 'ROOM-2', token: 'tok-2' } });
  await m1.start(); await m2.start();
  await sleep(300);
  assert.equal(s1.waiting.length, 2); assert.equal(s2.waiting.length, 2);
  assert.deepEqual(s1.waiting.map((w) => w.company), ['ACME Ltd', 'Beta AS']); // once gelen once
  assert.equal(s1.adminsOnline, 2);
  assert.deepEqual([...s1.adminNames].sort(), ['Ayse Yonetici', 'Mehmet Yonetici']);
  assert.ok(!sx || sx.waiting.length === 0, 'baska kurulumun yoneticisi sirayi goremez');
  // Cevrimici sayilari: yoneticiler ve ziyaretciler ayri sayilir
  const v1 = D.createMemberPresence({ config: cfg, pubsub: mk() });
  const v2 = D.createMemberPresence({ config: cfg, pubsub: mk() });
  await v1.start(); await v2.start(); await sleep(300);
  assert.equal(s1.visitorsOnline, 2, 'iki ziyaretci'); assert.equal(s1.adminsOnline, 2, 'yoneticiler ziyaretci sayilmaz');
  v2.stop(); await sleep(300);
  assert.equal(s1.visitorsOnline, 1, 'ayrilan ziyaretci duser');
  console.log('ok cevrimici yonetici ve ziyaretci sayilari ayri');
  console.log('ok sira listesi (firma adlariyla), baska kurulum goremez');
  // Ayni anda ustlenme: yalnizca biri kazanir
  const [r1, r2] = await Promise.all([a1.claim(m1.id), a2.claim(m1.id)]);
  const winners = [r1, r2].filter((r) => r.ticket);
  assert.equal(winners.length, 1, JSON.stringify([r1, r2]));
  const loser = r1.ticket ? r2 : r1;
  assert.ok(loser.lost);
  const winTicket = winners[0].ticket;
  assert.equal(winTicket.code, 'ROOM-1'); assert.equal(winTicket.token, 'tok-1');
  console.log('ok ayni anda ustlenme: tek kazanan, digerine', loser.by);
  const winDesk = r1.ticket ? a1 : a2;
  winDesk.beginSession(winTicket);
  m1.stop();
  await sleep(300);
  for (const s of [s1, s2]) {
    assert.deepEqual(s.waiting.map((w) => w.company), ['Beta AS']);
    assert.equal(s.sessions.length, 1);
    assert.equal(s.sessions[0].company, 'ACME Ltd');
    assert.ok(/Yonetici/.test(s.sessions[0].adminName));
  }
  // Suren gorusmeyi baskasi ustlenemez
  const late = await (winDesk === a1 ? a2 : a1).claim(m1.id);
  assert.ok(late.lost);
  console.log('ok suren gorusme listede "dolu", ikinci ustlenme reddedildi');
  winDesk.endSession();
  await sleep(300);
  assert.equal(s1.sessions.length, 0); assert.equal(s2.sessions.length, 0);
  // Uye ayrilirsa siradan cikar
  m2.stop(); await sleep(300);
  assert.equal(s1.waiting.length, 0);
  console.log('ok gorusme bitti / uye ayrildi');
  // Ayni yonetici ikinci sekmede: yine tek kisi sayilir
  const a1b = D.createAdminDesk({ config: cfg, pubsub: mk(), keys: keys1, me: { id: 'adm1-tab2', name: 'Ayse Yonetici' }, onChange: () => {} });
  await a1b.start(); await sleep(300);
  assert.equal(s2.adminsOnline, 2, 'ayni kisi iki sekmede tek sayilir');
  a1b.stop();
  a2.stop(); await sleep(300);
  assert.equal(s1.adminsOnline, 1, 'ayrilan yonetici duser');
  v1.stop();
  [a1, ax].forEach((a) => a.stop());
  console.log('ALL DESK TESTS PASS');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
