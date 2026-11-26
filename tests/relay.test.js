const vm = require('vm'); const fs = require('fs'); const assert = require('assert');
const startBroker = require('./broker.js');
const W = require('path').join(__dirname, '..', 'www') + '/';
const libs = ['mqtt.min.js', 'online-relay.js', 'android-shim.js'].map(f => [f, fs.readFileSync(W + f, 'utf8')]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeDevice(name, brokers) {
  const g = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Response, TextEncoder, TextDecoder,
    WebSocket, crypto: globalThis.crypto, btoa, atob, Uint8Array, Uint32Array, Map, Set, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, Error, Symbol, ArrayBuffer, DataView, Buffer, queueMicrotask, performance, Blob, EventTarget, Event, AbortController,
    navigator: {}, location: { href: 'https://localhost/', origin: 'https://localhost', protocol: 'https:' },
    document: { createElement: () => ({}), documentElement: { appendChild() {} }, addEventListener() {}, getElementById() { return null; } },
    CEVIRI_BROKERS: brokers,
    CEVIRI_WEB_URL: 'https://example.github.io/ceviri-android/',
    Capacitor: { isNativePlatform: () => true },
    capacitorExports: { registerPlugin: () => ({ addListener: () => Promise.resolve({ remove() {} }) }) },
    fetch: async (url) => {
      const u = new URL(url); const q = u.searchParams.get('q'); const tl = u.searchParams.get('tl');
      return new Response(JSON.stringify([[[`[${tl}] ${q}`, q]], null, u.searchParams.get('sl')]), { status: 200 });
    },
  };
  for (const k of Object.getOwnPropertyNames(globalThis)) { if (!(k in g) && !['global','globalThis','process','require','module'].includes(k)) { try { g[k] = globalThis[k]; } catch {} } }
  g.window = g; g.self = g; g.globalThis = g;
  vm.createContext(g);
  for (const [f, src] of libs) vm.runInContext(src, g, { filename: f });
  return g;
}

function openRoom(dev, code, clientId, name, lang, creator) {
  const events = [];
  const es = new dev.EventSource(`/api/rooms/${code}/events?clientId=${clientId}&name=${encodeURIComponent(name)}&lang=${lang}${creator ? '&creator=1' : ''}`);
  for (const t of ['room_state', 'history', 'chat_message', 'file_message', 'file_progress', 'file_ready', 'file_failed', 'rtc_signal']) es.addEventListener(t, (e) => events.push({ type: t, data: JSON.parse(e.data) }));
  return { es, events, last: (t) => events.filter(e => e.type === t).slice(-1)[0] };
}
const post = async (dev, path, body) => { const r = await dev.fetch(path, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };

(async () => {
  const b1 = await startBroker(18881), b2 = await startBroker(18882);
  const brokers = ['ws://127.0.0.1:18881/mqtt', 'ws://127.0.0.1:18882/mqtt'];
  const A = makeDevice('A', brokers), B = makeDevice('B', brokers);

  // online-info -> ready
  let info; for (let i = 0; i < 50; i++) { info = await (await A.fetch('/api/online-info')).json(); if (info.status === 'ready') break; await sleep(100); }
  assert.equal(info.status, 'ready'); assert.equal(info.publicUrl, 'https://example.github.io/ceviri-android'); console.log('ok online-info ready, brokers=', info.brokers);
  await B.fetch('/api/online-info');

  // A creates room
  const { data: { roomCode } } = await post(A, '/api/rooms', {});
  assert.match(roomCode, /^[A-Z0-9]{8}$/); console.log('ok room', roomCode);
  const ra = openRoom(A, roomCode, 'aaa', 'Ali', 'tr-TR', true);
  await sleep(300);
  assert.deepEqual(ra.last('history').data.messages, []);
  assert.equal(ra.last('room_state').data.participants.length, 1);

  // A sends message before partner joins -> fallback target
  let m0 = await post(A, `/api/rooms/${roomCode}/message`, { clientId: 'aaa', senderName: 'Ali', text: 'ilk mesaj', sourceLang: 'tr-TR', fallbackTargetLang: 'en-US' });
  assert.equal(m0.status, 200); assert.equal(m0.data.translatedText, '[en] ilk mesaj');

  // B joins
  await sleep(1500);
  const rb = openRoom(B, roomCode, 'bbb', 'John', 'de-DE');
  await sleep(500);
  A.CeviriRelay.approve(roomCode, 'bbb'); // oda sahibi John'u kabul eder
  await sleep(1000);
  const sa = ra.last('room_state').data, sb = rb.last('room_state').data;
  assert.equal(sa.participants.length, 2, 'A sees 2'); assert.equal(sb.participants.length, 2, 'B sees 2');
  assert.equal(sa.participants.find(p => p.clientId === 'bbb').lang, 'de-DE');
  assert.equal(sb.participants.find(p => p.clientId === 'aaa').name, 'Ali');
  const hist = rb.events.filter(e => e.type === 'history').flatMap(e => e.data.messages);
  assert.ok(hist.some(m => m.originalText === 'ilk mesaj'), 'B got history');
  console.log('ok join + presence + history');

  // A -> B chat, translated to B's language, delivered exactly once (two brokers)
  const m1 = await post(A, `/api/rooms/${roomCode}/message`, { clientId: 'aaa', text: 'merhaba', sourceLang: 'tr-TR', fallbackTargetLang: 'en-US' });
  assert.equal(m1.data.translatedText, '[de] merhaba');
  await sleep(500);
  const bChats = rb.events.filter(e => e.type === 'chat_message' && e.data.originalText === 'merhaba');
  const aChats = ra.events.filter(e => e.type === 'chat_message' && e.data.originalText === 'merhaba');
  assert.equal(bChats.length, 1, 'B got exactly one'); assert.equal(aChats.length, 1, 'A appended own once');
  assert.equal(bChats[0].data.senderId, 'aaa');
  // B -> A
  const m2 = await post(B, `/api/rooms/${roomCode}/message`, { clientId: 'bbb', text: 'hallo', sourceLang: 'de-DE' });
  assert.equal(m2.data.translatedText, '[tr] hallo'); await sleep(400);
  assert.equal(ra.events.filter(e => e.type === 'chat_message' && e.data.originalText === 'hallo').length, 1);
  console.log('ok chat both ways, dedup across 2 brokers');

  // Mic lock
  let r1 = await post(A, `/api/rooms/${roomCode}/mic`, { clientId: 'aaa', active: true }); assert.equal(r1.status, 200);
  await sleep(400);
  assert.equal(rb.last('room_state').data.activeMicClientId, 'aaa'); assert.equal(rb.last('room_state').data.activeMicName, 'Ali');
  let r2 = await post(B, `/api/rooms/${roomCode}/mic`, { clientId: 'bbb', active: true }); assert.equal(r2.status, 409); assert.equal(r2.data.activeMicName, 'Ali');
  await post(A, `/api/rooms/${roomCode}/mic`, { clientId: 'aaa', active: false }); await sleep(400);
  assert.equal(rb.last('room_state').data.activeMicClientId, null);
  r2 = await post(B, `/api/rooms/${roomCode}/mic`, { clientId: 'bbb', active: true }); assert.equal(r2.status, 200);
  await sleep(400); assert.equal(ra.last('room_state').data.activeMicClientId, 'bbb');
  await post(B, `/api/rooms/${roomCode}/mic`, { clientId: 'bbb', active: false }); await sleep(300);
  console.log('ok mic lock');

  // Dosya paylasimi: A -> B (PDF, ~300 KB, 7 parca), parca kaybi ve gec katilan
  {
    const size = 300 * 1024;
    const bytes = new Uint8Array(size); for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 255;
    // B ilk seferde 2. parcayi kaybetsin -> eksik parca istenmeli
    const roomB = B.CeviriRelay._rooms[roomCode];
    const origRecv = roomB.receiveChunk.bind(roomB); let dropped = false;
    roomB.receiveChunk = (msg) => { if (!dropped && msg.index === 2) { dropped = true; return; } origRecv(msg); };
    const prog = [];
    const meta = await A.CeviriRelay.sendFile(roomCode, 'rapor.pdf', 'application/pdf', bytes, (p) => prog.push(p));
    assert.equal(meta.chunks, Math.ceil(size / (48 * 1024)));
    assert.equal(prog[prog.length - 1], 1);
    const t0 = Date.now();
    while (!rb.events.some(e => e.type === 'file_ready' && e.data.id === meta.id) && Date.now() - t0 < 12000) await sleep(100);
    assert.ok(dropped, 'parca dusuruldu');
    assert.ok(rb.events.some(e => e.type === 'file_message' && e.data.id === meta.id && e.data.name === 'rapor.pdf'), 'B dosya mesajini aldi');
    assert.ok(rb.events.some(e => e.type === 'file_ready' && e.data.id === meta.id), 'B dosyayi tamamladi (eksik parca yeniden istendi)');
    const blob = await B.CeviriRelay.getFile(roomCode, meta.id);
    const got = new Uint8Array(await blob.arrayBuffer());
    assert.equal(got.length, size); assert.ok(got.every((v, i) => v === bytes[i]), 'icerik ayni');
    assert.equal(blob.type, 'application/pdf');
    // Gondericinin kendi kartı
    assert.ok(ra.events.some(e => e.type === 'file_message' && e.data.id === meta.id && e.data.mine));
    // Yasak tur reddedilir
    await assert.rejects(A.CeviriRelay.sendFile(roomCode, 'x.exe', 'application/x-msdownload', new Uint8Array(10)));
    roomB.receiveChunk = origRecv;
    console.log('ok file transfer (+ lost chunk recovered in', Date.now() - t0, 'ms)');

    // Gec katilan D: gecmisten dosyayi gorur, dokununca (getFile) indirir
    const D = makeDevice('D', brokers); await D.fetch('/api/online-info'); await sleep(400);
    const rd = openRoom(D, roomCode, 'ddd', 'Deniz', 'tr-TR');
  await sleep(500); A.CeviriRelay.approve(roomCode, 'ddd'); await sleep(300);
    const t1 = Date.now();
    while (!rd.events.some(e => e.type === 'file_message' && e.data.id === meta.id) && Date.now() - t1 < 5000) await sleep(100);
    const dm = rd.events.find(e => e.type === 'file_message' && e.data.id === meta.id);
    assert.ok(dm, 'gec katilan dosyayi gecmisten gordu'); assert.equal(dm.data.state, 'available');
    const blobD = await D.CeviriRelay.getFile(roomCode, meta.id);
    assert.equal(blobD.size, size);
    console.log('ok late joiner downloads file on tap');
    rd.es.close(); await sleep(300);
  }

  // One broker dies -> still works
  b1.close(); await sleep(500);
  const m3 = await post(A, `/api/rooms/${roomCode}/message`, { clientId: 'aaa', text: 'tek araci', sourceLang: 'tr-TR' });
  assert.equal(m3.status, 200); await sleep(500);
  assert.equal(rb.events.filter(e => e.type === 'chat_message' && e.data.originalText === 'tek araci').length, 1);
  console.log('ok survives broker failure');

  // Language change = reconnect (close + new EventSource), partner sees new lang
  ra.es.close();
  const ra2 = openRoom(A, roomCode, 'aaa', 'Ali', 'en-US'); await sleep(800);
  const p = rb.last('room_state').data.participants.find(x => x.clientId === 'aaa');
  assert.ok(p, 'A back in room for B'); assert.equal(p.lang, 'en-US');
  console.log('ok reconnect with new language');

  // Ayni dildeki sesli sohbet: mikrofon kapali bilgisi karsiya gider
  A.CeviriRelay.setMute(roomCode, true); await sleep(500);
  assert.equal(rb.last('room_state').data.participants.find(x => x.clientId === 'aaa').mute, true);
  A.CeviriRelay.setMute(roomCode, false); await sleep(500);
  assert.equal(rb.last('room_state').data.participants.find(x => x.clientId === 'aaa').mute, false);
  console.log('ok mikrofon kapali/acik bilgisi');

  // Wrong room code cannot read: C in other room sees nothing
  const C = makeDevice('C', brokers.slice(1)); await C.fetch('/api/online-info'); await sleep(500);
  const rc = openRoom(C, 'WRONG123', 'ccc', 'Eve', 'fr-FR'); await sleep(500);
  await post(A, `/api/rooms/${roomCode}/message`, { clientId: 'aaa', text: 'gizli', sourceLang: 'tr-TR' }); await sleep(400);
  assert.equal(rc.events.filter(e => e.type === 'chat_message').length, 0);
  assert.equal(rc.last('room_state').data.participants.length, 1);
  console.log('ok isolation between rooms');

  // Leave -> partner sees 1 participant
  rb.es.close(); await sleep(500);
  assert.equal(ra2.last('room_state').data.participants.length, 1);
  console.log('ok leave');

  console.log('ALL RELAY TESTS PASS'); process.exit(0);
})().catch(e => { console.error('FAIL', String(e && e.message).slice(0,300), String(e && e.stack).split('\n').slice(-4).join(' | ').slice(-300)); process.exit(1); });
