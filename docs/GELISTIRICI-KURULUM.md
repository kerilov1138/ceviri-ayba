# CEVIRI_AYBARION Canlı Destek — Geliştirici Kurulum Anlatımı

Bu paket, aybarion.com'a giriş yapmış üyelerin bir site yöneticisiyle **birebir,
canlı ve gerekirse çevirili** görüşmesini sağlar.

- **Üye:** "Soru sormak istiyorum" der. Onay beklemeden sıraya girer.
- **Yönetici:** Bekleyenleri firma adlarıyla görür, yeni biri gelince sesli
  bildirim alır, süren görüşmeleri görür.
- **Görüşmeyi alma:** Bekleyene ilk tıklayan yönetici görüşmeyi alır ve oda
  kilitlenir. Başka hiç kimse giremez, içeriği göremez.
- **Görüşmenin içeriği:** Yazılı ve sesli çeviri, aynı dilde doğrudan sesli
  sohbet, kamera ve dosya (fotoğraf/PDF) alışverişi.
- **Döküm:** Görüşme bitince yöneticinin tarafında tarih/saatli PDF döküm
  otomatik iner. İçinde yönetici adı, müşterinin ad soyadı, firması ve tüm
  konuşma bulunur.

Sunucu gerekmez: her şey tarayıcıda çalışır. Bağlantı genel MQTT aracıları
üzerinden, uçtan uca şifreli kurulur. Siteye eklenmesi gerekenler aşağıda.

> Test adresi: https://kerilov1138.github.io/ceviri-ayba/
> (test girişi açık; test yönetici parolası proje sahibindedir)

---

## 1. Dosyaları yayınlayın

`canli-destek/` klasörünü sitenin HTTPS altında olduğu gibi yayınlayın.
Örnek adres: `https://aybarion.com/canli-destek/`.

- Derleme gerekmez; düz statik dosyalardır.
- Mikrofon ve kamera yalnızca **HTTPS**'te çalışır.

| Dosya | Görevi |
|---|---|
| `index.html` | Canlı destek sayfası (üye ve yönetici aynı sayfa, farklı ekran) |
| `support-config.js` | Yönetici anahtarı ve ayarlar (**2. adım**) |
| `support-user.js` | Giriş yapmış kullanıcı bilgisi (**3. adım**, site üretir) |
| `support-*.js`, `app.js`, … | Uygulamanın kendisi; değiştirmeye gerek yok |

## 2. Yönetici parolasını belirleyin

1. `arac/yonetici-anahtari.html` dosyasını tarayıcıda açın.
2. Site adını ve yönetici parolasını girin.
3. **"Test girişi açık kalsın" kutusunu işaretlemeyin.**
4. İnen `support-config.js` dosyasını `canli-destek/` içindekinin yerine koyun.

Paketteki `support-config.js` bir **test** dosyasıdır. Canlıya almadan önce
mutlaka değiştirin.

Notlar:

- Parola dosyanın içinde yazılı durmaz. Yalnızca parolayı bilen biri yönetici
  ekranında bekleyenleri ve odaların anahtarlarını açabilir. Bu yüzden sayfanın
  kodunu okuyan biri kendini yönetici yapamaz.
- Parolayı yalnızca site yöneticilerine verin.
- Parola değişince araçla yeni bir dosya üretip değiştirin.

## 3. Giriş yapmış kullanıcıyı canlı desteğe tanıtın

Canlı destek, girişi kimin yaptığını `window.AYBA_USER` değişkeninden öğrenir:

```js
window.AYBA_USER = {
  role: 'member',        // site üyesi: 'member'   |   site yöneticisi: 'admin'
  firstName: 'Ali',
  lastName: 'Kaya',
  company: 'ACME Ltd',   // üyelerde firma adı (yöneticide boş bırakılabilir)
  id: 'kullanici-123'    // sitenin kullanıcı kimliği
};
```

En kolay yol: `canli-destek/support-user.js` adresini **sitenin sunucusundan,
oturuma göre** üretmek. `index.html` bu dosyayı zaten yükler.

- Kullanıcı giriş yapmamışsa boş bir yanıt (ya da 401) döndürün. Sayfa "siteye
  giriş yapın" yazar.
- Yanıtı önbelleğe aldırmayın (`Cache-Control: no-store`).

**Node.js / Express örneği:**

```js
app.get('/canli-destek/support-user.js', (req, res) => {
  res.set('Content-Type', 'text/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  const u = req.user; // sitenin oturumu
  if (!u) return res.send('// giris yok');
  const data = {
    role: u.isAdmin ? 'admin' : 'member',
    firstName: u.firstName, lastName: u.lastName,
    company: u.companyName || '', id: String(u.id),
  };
  res.send('window.AYBA_USER = ' + JSON.stringify(data).replace(/</g, '\\u003c') + ';');
});
```

**PHP örneği:**

```php
<?php // canli-destek/support-user.js yerine support-user.php + yonlendirme
session_start();
header('Content-Type: text/javascript; charset=utf-8');
header('Cache-Control: no-store');
if (empty($_SESSION['user'])) { echo '// giris yok'; exit; }
$u = $_SESSION['user'];
echo 'window.AYBA_USER = ' . json_encode([
  'role' => $u['is_admin'] ? 'admin' : 'member',
  'firstName' => $u['first_name'], 'lastName' => $u['last_name'],
  'company' => $u['company'] ?? '', 'id' => (string)$u['id'],
], JSON_HEX_TAG | JSON_UNESCAPED_UNICODE) . ';';
```

Rol yalnızca hangi ekranın açılacağını belirler. Yönetici yetkisinin asıl
koruması 2. adımdaki parola.

## 4. Üst menüye "Canlı Destek" bağlantısı

Bağlantıyı **yalnızca giriş yapmış kullanıcılara** gösterin:

```html
<a href="/canli-destek/" target="_blank" rel="noopener">Canlı Destek</a>
```

Yeni sekmede açmak önerilir; görüşme sürerken kullanıcı sitede gezinebilir.

**Site içine gömmek isterseniz (iframe):**

```html
<iframe src="/canli-destek/" allow="microphone; camera; autoplay; clipboard-write"
        style="width:100%;height:85vh;border:0"></iframe>
```

- Aynı alan adından açıldığında `support-user.js` normal çalışır.
- Farklı bir alan adından gömülecekse kimlik `postMessage` ile de verilebilir:
  1. Sayfanın adresini `support-config.js` içindeki `parentOrigins` listesine
     ekleyin.
  2. Üst sayfadan `{ type: 'ayba-user', user: { ...AYBA_USER } }` gönderin.

## 5. Döküm arşivi (isteğe bağlı)

Döküm her durumda yöneticinin bilgisayarına PDF olarak iner. Bütün yöneticilerin
ortak arşivinde de tutulsun isterseniz iki yol var:

**a) Yükleme adresi:** `support-config.js` içinde `transcriptUploadUrl` verin.
Örnek: `"https://aybarion.com/api/support/transcripts"`.

- Her görüşme bitince bu adrese `POST` (multipart/form-data, oturum çerezleriyle) gelir:
  - `pdf`: PDF dosyası
  - `meta`: JSON (start, end, adminName, adminId, customerName,
    customerSurname, company, customerLang, topic, rating {stars, comment},
    segments [{admin, from, to}] (devir varsa yöneticiler ve saatleri),
    handedTo (bu yönetici görüşmeyi devrettiyse))
  - `messages`: JSON listesi (time, who, sourceLang, targetLang, original,
    translation)
- Sunucu, isteği yalnızca **yönetici oturumundan** gelirse kabul etmeli.
- Arşiv sayfası da yalnızca yöneticilere açık olmalı.

**b) JavaScript kancası:** `index.html` içinde, `support-ui.js`'ten önce
tanımlayın:

```js
window.AybaSupportHooks = {
  onTranscript({ pdf, filename, html, meta, messages }) { /* kendi arşivinize gönderin */ }
};
```

## 6. Ağ ve güvenlik ayarları

Site bir İçerik Güvenlik Politikası (CSP) kullanıyorsa şu bağlantılara izin
verin:

- `connect-src`:
  - `wss://broker.hivemq.com:8884`
  - `wss://broker.emqx.io:8084`
  - `https://translate.googleapis.com`
  - `https://clients5.google.com`
- WebRTC (kamera/ses): STUN sunucuları `stun.l.google.com:19302` ve
  `stun.cloudflare.com:3478`
- `Permissions-Policy`: canlı destek sayfasında `microphone` ve `camera` izinli
  olmalı.

## 7. Nasıl çalışır (kısaca)

1. Üye "Soru sormak istiyorum" deyince kendi bire bir odasını kurar. Oda için
   tek kullanımlık bir anahtar üretir.
2. Adını, firmasını, dilini ve oda anahtarını **yönetici açık anahtarıyla
   mühürleyip** siteye özgü "destek masası" kanalına koyar. Bunu yalnızca
   parolayı bilen yöneticiler açabilir.
3. Yönetici tıklayınca diğer yöneticilere "ben alıyorum" der. Aynı anda iki
   kişi tıklarsa önce tıklayan kazanır.
4. Kazanan oda anahtarıyla odaya girer. Üyenin tarayıcısı onu kendiliğinden
   kabul eder ve odayı kilitler. Tek kullanımlık anahtar ikinci kez çalışmaz.
5. Görüşme içeriği uçtan uca şifrelidir. Diğer yöneticiler yalnızca "Yönetici
   ↔ Firma, süre" bilgisini görür.

## 8. Dil

Arayüz 32 dilde, canlı desteğe özgü bütün yazılar dahil. İlk açılışta
İngilizce başlar; kullanıcının seçtiği dil hatırlanır. Yazılar
`support-strings.js` dosyasındadır.

## 9. Özellikler (kısaca)

- **Üye ekranı:** konu yazılmadan ve dil seçilmeden soru sorulamaz. Sırada
  bekleyen, sıra numarasını ve tahmini bekleme süresini görür. Hiç yönetici
  çevrimiçi değilse uyarı çıkar. Görüşme bitince 1–5 yıldız ve isteğe bağlı
  yorumla puan verir.
- **Yönetici ekranı:** yeni ziyaretçi ve sıraya girme için ekranda bildirim,
  yüksek tonlu ses ve masaüstü bildirimi (tarayıcı izin isterse) çıkar.
- **Hazır yanıtlar:** her yönetici kendi listesini düzenleyebilir; liste o
  tarayıcıda saklanır.
- **Devretme:** görüşme çevrimiçi başka bir yöneticiye devredilebilir.
  Dökümde devir anı ayrı bir kutuyla gösterilir. Her iki yöneticiye de
  kendi bölümünün dökümü iner.
- **Döküm:** puan beklenir (en fazla 45 saniye), sonra PDF iner.
