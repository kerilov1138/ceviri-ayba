// Bire bir destek odasi: uye kurar, oda anahtarini bilen ilk yonetici girer,
// ikinci kisi giremez; masa uzerinden gercek araciyla sira/ustlenme.
const vm = require('vm'); const fs = require('fs'); const assert = require('assert');
const startBroker = require('./broker.js');
const W = require('path').join(__dirname, '..', 'www') + '/';
const libs = ['mqtt.min.js', 'online-relay.js', 'android-shim.js', 'support-crypto.js', 'support-desk.js'].map(f => [f, fs.readFileSync(W + f, 'utf8')]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function makeDevice(brokers, role) {
  const store = new Map();
  const g = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Response, TextEncoder, TextDecoder,
    WebSocket, crypto: globalThis.crypto, btoa, atob, Uint8Array, Uint32Array, Map, Set, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, Error, Symbol, ArrayBuffer, DataView, Buffer, queueMicrotask, performance, Blob, EventTarget, Event, AbortController,
    navigator: {}, location: { href: 'https://localhost/', origin: 'https://localhost', protocol: 'https:' },
    document: { createElement: () => ({}), documentElement: { appendChild() {} }, addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    CEVIRI_BROKERS: brokers, AYBA_ROLE: role,
    fetch: async (url) => { const u = new URL(url); return new Response(JSON.stringify([[[`[${u.searchParams.get('tl')}] ${u.searchParams.get('q')}`]], null, u.searchParams.get('sl')]), { status: 200 }); },
  };
  for (const k of Object.getOwnPropertyNames(globalThis)) { if (!(k in g) && !['global','globalThis','process','require','module','localStorage'].includes(k)) { try { g[k] = globalThis[k]; } catch {} } }
  g.window = g; g.self = g; g.globalThis = g;
  vm.createContext(g);
  for (const [f, src] of libs) vm.runInContext(src, g, { filename: f });
  return g;
}
function openRoom(dev, code, clientId, name, lang, token, creator) {
  const events = [];
  const tk = token ? `&token=${encodeURIComponent(token)}` : '';
  const es = new dev.EventSource(`/api/rooms/${code}/events?clientId=${clientId}&name=${encodeURIComponent(name)}&lang=${lang}${tk}${creator ? '&creator=1' : ''}`);
  for (const t of ['room_state', 'chat_message']) es.addEventListener(t, (e) => events.push({ type: t, data: JSON.parse(e.data) }));
  return { es, events, last: (t) => events.filter(e => e.type === t).slice(-1)[0] };
}
const post = async (dev, path, body) => { const r = await dev.fetch(path, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
(async () => {
  await startBroker(18921);
  const brokers = ['ws://127.0.0.1:18921/mqtt'];
  const member = makeDevice(brokers, 'member'), adm1 = makeDevice(brokers, 'admin'), adm2 = makeDevice(brokers, 'admin'), other = makeDevice(brokers, 'member');
  for (const d of [member, adm1, adm2, other]) await d.fetch('/api/online-info');
  await sleep(600);
  assert.equal((await post(adm1, '/api/rooms', {})).status, 403, 'yonetici sayfasi oda kuramaz');
  const cfg = await member.AybaCrypto.generateAdminConfig('parola-12345', 'aybarion.com');
  const { data: { roomCode } } = await post(member, '/api/rooms', {});
  const M = openRoom(member, roomCode, 'mem1', 'Ali Kaya', 'en-US', undefined, true);
  await sleep(400);
  const token = member.CeviriRelay.createInvite(roomCode);
  // Uye sira kaydini masaya koyar; yoneticiler gercek araci uzerinden gorur
  const md = member.AybaDesk.createMemberDesk({ config: cfg, pubsub: member.CeviriRelay.pubsub, ticket: { name: 'Ali', surname: 'Kaya', company: 'ACME', lang: 'en-US', code: roomCode, token } });
  await md.start();
  const views = {};
  const desks = await Promise.all([adm1, adm2].map(async (d, i) => {
    const keys = await d.AybaCrypto.unlockAdmin(cfg, 'parola-12345');
    const desk = d.AybaDesk.createAdminDesk({ config: cfg, pubsub: d.CeviriRelay.pubsub, keys, me: { id: 'adm' + i, name: 'Yonetici ' + i }, onChange: (s) => { views[i] = s; } });
    await desk.start(); return desk;
  }));
  await sleep(1500); // yeni baglanan yonetici sorar, uye hemen yanitlar
  assert.equal(views[0].waiting.length, 1); assert.equal(views[0].waiting[0].company, 'ACME');
  const [c0, c1] = await Promise.all([desks[0].claim(md.id), desks[1].claim(md.id)]);
  const win = c0.ticket ? 0 : 1; assert.ok((c0.ticket ? 1 : 0) + (c1.ticket ? 1 : 0) === 1);
  const winDev = win === 0 ? adm1 : adm2, loseDev = win === 0 ? adm2 : adm1;
  const t = (win === 0 ? c0 : c1).ticket;
  console.log('ok gercek araci: sira gorundu, tek yonetici ustlendi');
  // Kazanan oda anahtariyla girer; uye kendiliginden kabul eder ve odayi kilitler
  const A = openRoom(winDev, t.code, 'admW', 'Yonetici W', 'tr-TR', t.token);
  await sleep(1500);
  const lobby = M.last('room_state').data.lobby;
  assert.deepEqual(lobby.map((p) => p.clientId), ['admW']);
  assert.ok(member.CeviriRelay.approve(roomCode, 'admW'));
  member.CeviriRelay.setLocked(roomCode, true);
  md.stop();
  await sleep(1500);
  assert.equal(A.last('room_state').data.invite, 'ok');
  // Ayni anahtari ele geciren ikinci yonetici giremez
  const B = openRoom(loseDev, t.code, 'admL', 'Yonetici L', 'tr-TR', t.token);
  // Kod bilen baska bir uye de giremez
  const O = openRoom(other, t.code, 'oth', 'Baskasi', 'tr-TR');
  await sleep(2500);
  assert.notEqual(B.last('room_state').data.invite, 'ok', 'ikinci kisi giremez');
  assert.ok(!O.last('room_state') || O.last('room_state').data.invite !== 'ok' || O.last('room_state').data.lockedOut, 'kilitli oda');
  assert.deepEqual(M.last('room_state').data.participants.map((p) => p.clientId).sort(), ['admW', 'mem1']);
  await post(member, `/api/rooms/${roomCode}/message`, { clientId: 'mem1', text: 'hello support', sourceLang: 'en-US' });
  await sleep(1500);
  assert.ok(A.events.some((e) => e.type === 'chat_message' && /hello support/.test(JSON.stringify(e.data))), 'yonetici mesaji alir');
  assert.ok(!B.events.some((e) => e.type === 'chat_message'), 'ikinci yonetici mesaj goremez');
  assert.ok(!O.events.some((e) => e.type === 'chat_message'), 'baska uye mesaj goremez');
  console.log('ok bire bir oda: ikinci yonetici ve baska uye giremez, mesajlari goremez');
  console.log('ALL SUPPORT ROOM TESTS PASS');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
