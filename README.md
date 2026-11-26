# CEVIRI_AYBARION — aybarion.com Canlı Destek

aybarion.com için çevirili, birebir canlı destek. CEVIRI'nin Online Oda
altyapısından ayrı bir sürüm olarak üretildi.

> **Kullanım koşulları:** Tüm hakları saklıdır; ayrıntılar [LICENSE](LICENSE)
> dosyasında.

- **Test adresi:** https://kerilov1138.github.io/ceviri-ayba/
- **Geliştirici kurulumu:** [docs/GELISTIRICI-KURULUM.md](docs/GELISTIRICI-KURULUM.md)
  · [English](docs/DEVELOPER-SETUP.md)
- **Yönetici parolası aracı:** `arac/yonetici-anahtari.html`
- **Testler:** `npm ci && npm test`

## Paket

Her gönderimde GitHub Actions şunları yapar:

1. Testleri çalıştırır.
2. Test sürümünü GitHub Pages'e yayınlar.
3. Siteye yüklenecek `CEVIRI_AYBARION-canli-destek.zip` paketini üretir (Actions → Artifacts).
