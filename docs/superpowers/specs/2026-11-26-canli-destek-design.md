# CEVIRI_AYBARION — Canlı Destek: Tasarım

Tarih: 2026-11-26

## Amaç

aybarion.com'a giriş yapmış üyeler, sayfanın en üstündeki "Canlı Destek" bölümünden
bir site yöneticisiyle bire bir, canlı ve gerekirse çevirili görüşme yapabilsin.
Görüşmeler yöneticiler tarafından takip edilebilsin (tarih/saatli PDF döküm).
Uygulama, sitenin geliştiricisine verilecek bağımsız bir paket olarak hazırlanır.

## Hedefler

- Üye: "Soru sormak istiyorum" → onay/istek olmadan doğrudan sıraya girer.
- Yönetici: aynı canlı destek bölümünden, farklı bir arayüzle girer. Görür:
  sıradakiler (sayı + ad soyad + firma, sesli bildirim), süren görüşmeler
  (hangi yönetici ↔ hangi müşteri).
- Bekleyene ilk tıklayan yönetici görüşmeyi alır; oda o an kilitlenir. Başka
  hiçbir yönetici ya da üye giremez, içeriği göremez.
- Görüşmede mevcut Online Oda dinamiği korunur: çeviri, aynı dilde doğrudan
  ses + mikrofon/susturma düğmeleri, görüntü, dosya alışverişi.
- "Ben" yerine yöneticinin adı; karşı tarafta müşterinin ad soyadı + firması.
- Görüşme bitince yöneticinin tarafında otomatik PDF döküm: başlangıç/bitiş
  tarih-saati, yönetici adı, müşteri ad soyad ve firma, tüm konuşma.

## Hedef dışı

- Ortak döküm arşivi (sunucu tarafı) bu pakette yok; geliştirici kendi
  sunucusuna bağlar. Paket bunun için bir "döküm hazır" kancası verir.
- APK / exe yok; her şey tarayıcıda.
- Mevcut CEVIRI uygulaması, dosyaları ve `ceviri-android` deposu değişmez.

## Kaçınılacaklar (anti-goal)

- Bir üyenin başka bir görüşmeyi görebilmesi ya da katılabilmesi.
- Kodu okuyan birinin kendini yönetici gibi gösterebilmesi.
- İki yöneticinin aynı müşteriye aynı anda bağlanması.

## Yaklaşımlar

- **A (seçildi):** Bağımsız canlı destek paketi + sitenin ekleyeceği ince
  bağlantı (kimlik bilgisini verme + isteğe bağlı arşiv). Test GitHub Pages'te,
  test girişiyle.
- B: Supabase/Cloudflare gibi bulut hizmeti. Hesap açma gerektirdiği ve site
  ile çift giriş doğurduğu için seçilmedi.

## Yapı (karar verilenler)

- Yeni depo: `kerilov1138/ceviri-ayba`, test adresi
  `https://kerilov1138.github.io/ceviri-ayba/`.
- Temel: CEVIRI web uygulamasının Online Oda altyapısı (MQTT, uçtan uca
  şifreleme, WebRTC, çeviri, ses, dosya, PDF) kopyalanır; diğer modlar
  (Kamera, Canlı Döngü, Yüz Yüze) bu sürümde çıkarılır.
- Kimlik: site, giriş yapmış kişinin rolünü (üye/yönetici), ad soyadını ve
  firmasını canlı destek sayfasına verir. Paket bunun için tek bir yapılandırma
  noktası sunar; testte basit bir test giriş ekranı bunun yerine geçer.
- Yönetici güvenliği: kurulumda bir kez yönetici anahtar çifti üretilir.
  Açık anahtar pakette durur; gizli anahtar yönetici parolasıyla şifrelenmiş
  halde durur. Üyelerin sıra kaydı (oda kodu ve oda anahtarı dahil) bu açık
  anahtarla şifrelenir; yalnızca parolayı bilen yöneticiler okuyabilir. Oda
  anahtarını yalnızca yöneticiler alabildiği için odaya giren ilk kişi
  zorunlu olarak bir yöneticidir; üye tarafı ilk yöneticiden sonra odayı kilitler.
- Yarış durumu: iki yönetici aynı anda tıklarsa müşterinin tarayıcısı ilk
  geleni kabul eder; diğerine "başka yönetici aldı" denir.
- Döküm: PDF yöneticinin cihazına otomatik iner ve `onTranscript` kancasıyla
  sitenin sunucusuna yüklenebilir. Üye döküm almaz.
- Teslim: `TERCUMAN\CEVIRI_AYBARIONS` klasörüne siteye yüklenecek dosyalar
  (zip ve açık klasör), geliştirici kurulum anlatımı (Türkçe + İngilizce),
  yönetici anahtarı üretme aracı.

## Geliştiriciye kalanlar

- Üst menüye "Canlı Destek" bağlantısını yalnızca giriş yapmış kullanıcılara
  göstermek.
- Kimlik bilgisini (rol, ad, soyad, firma) güvenli biçimde canlı destek
  sayfasına vermek.
- Dökümleri saklayan ortak arşiv (isteğe bağlı).
