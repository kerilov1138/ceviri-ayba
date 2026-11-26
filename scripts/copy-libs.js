// Tarayici kutuphanelerini node_modules'tan www/ icine kopyalar
const fs = require('fs');
const path = require('path');
const files = [
  ['node_modules/mqtt/dist/mqtt.min.js', 'www/mqtt.min.js'],
  // Gorusme dokumu (PDF): sayfa goruntusu + PDF olusturma
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'www/lib/jspdf.umd.min.js'],
  ['node_modules/html2canvas/dist/html2canvas.min.js', 'www/lib/html2canvas.min.js'],
  // Yonetici anahtari araci ayni sifreleme kodunu kullanir
  ['www/support-crypto.js', 'arac/support-crypto.js'],
];
for (const [from, to] of files) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`${from} -> ${to}`);
}
