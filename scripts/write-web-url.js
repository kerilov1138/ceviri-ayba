// www/web-url.js dosyasini GitHub Pages adresine gore yazar.
// GitHub Actions'ta GITHUB_REPOSITORY (sahip/depo) ortam degiskeninden alinir.
const fs = require('fs');
const repoFull = process.env.GITHUB_REPOSITORY;
if (!repoFull) {
  console.log('GITHUB_REPOSITORY yok, www/web-url.js oldugu gibi birakildi');
  process.exit(0);
}
const [owner, repo] = repoFull.split('/');
const host = `${owner.toLowerCase()}.github.io`;
const url = repo.toLowerCase() === host ? `https://${host}` : `https://${host}/${repo}`;
fs.writeFileSync(
  'www/web-url.js',
  `// Davet linklerinin acilacagi web adresi (GitHub Pages).\n// GitHub Actions bu dosyayi depo adina gore yeniden yazar.\nwindow.CEVIRI_WEB_URL = '${url}';\n`
);
console.log('Web adresi:', url);
