// Testler icin yerel MQTT araci (WebSocket)
module.exports = async function start(port) {
  const aedesMod = require('aedes');
  const broker = aedesMod.createBroker ? await aedesMod.createBroker() : (aedesMod.Aedes ? new aedesMod.Aedes() : aedesMod());
  const { WebSocketServer, createWebSocketStream } = require('ws');
  const wss = new WebSocketServer({ port, path: '/mqtt' });
  wss.on('connection', (ws) => broker.handle(createWebSocketStream(ws)));
  await new Promise(r => wss.on('listening', r));
  return { broker, wss, close: () => { wss.close(); broker.close(); } };
};
