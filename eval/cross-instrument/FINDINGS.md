# 2Q-B — enstrümanlar arası nota girişi: ölçülen bulgular

Bu dosya, checkpoint boyunca **ölçerek** bulunan şeyleri kaydeder. Karar
gerekçeleri spec §13.25'te; buradakiler sayı ve tarih.

## Kabul koşusunun ilk turunda bulunan iki production kusuru

**1. Düzenleme kapısı, bu fazın açtığı enstrümanları kapalı tutuyordu.**
Step grid ve nota şeridi yazılmıştı, ikisi de `noteEditing.editing`'in
arkasındaydı ve `editGate` davul/perdesiz track'lerde `canEdit: false`
döndürüyordu. Yüzeyler vardı, hiçbir okur açamıyordu. Tarayıcı kabulünde
"Düzenle" düğmesi bulunamadığı için ortaya çıktı; kapı okundu ve gerçek sebep
görüldü: `isEditableTrack` "fret editörü bunu düzenleyebilir mi" sorusunun
cevabıydı ve kapı bunu "okur yazabilir mi" sanıyordu. Önce
`edit-gate.test.ts` ile kırmızıya bağlandı (8 test, 4'ü kırmızı başladı),
sonra düzeltildi. Yan bulgu: Copilot önerisi ekrandayken kapı **yanlış**
cümleyi gösteriyordu ("yalnız akordu olan telli track'ler…"); o da düzeltildi.

**2. Yeni track kurulduktan sonra okur eski track'te kalıyordu.** Yani
«yeni davul → aktif lane → ilk vuruş» zincirinin ikinci adımı yoktu ve bir
sonraki dokunuş yanlış enstrümana gidiyordu. `createdTrackId` (saf, iki
şarkıyı kimlikten karşılaştırır — sıradan değil, çünkü kopyalama ve yer
değiştirme indeksleri kaydırır) yazıldı, 5 testle bağlandı ve
`use-lifecycle` içinde kullanıldı.

## Harness modernizasyonunda bulunan iki production kusuru

Bunlar §1'de, on kabul harness'ı proje deposuna taşınırken bulundu ve
raporun geri kalanından ayrı durur — çünkü harness'ı onarmak amaç değil,
kapıydı; kusurlar o kapıdan geçerken düştü.

**A. Temizlenen track yazılamaz hâle geliyordu.**
`replace_track_setup_and_clear_content` bar anahtarlarını siliyordu; K-55'in
sözlüğünde bu "bu barda yazılı değil" demektir, dolayısıyla enstrümanı
değiştirilen track'e bir daha nota yazılamıyordu. Eski davranışı kodlayan test
gerekçesiyle yeniden yazıldı, sonra komut yeni enstrümanın şeklinde **açık boş
şeritler** bırakacak biçimde düzeltildi.

**B. Kurtarma durumu sessizce kayboluyordu.** `SettleOutcome` kurtarma
bilgisini taşımıyordu; `asLoadResult` onu `storage_unavailable` diye
uyduruyordu. Okura yanlış sebep gösteriliyordu. 7 test yazıldı (5'i kırmızı
başladı, 2'si kontrol), sonra `recovery` `SettleOutcome` → `asLoadResult`
boyunca geçirildi.

## Ölçümle bulunan, kod değil belge gerektiren şeyler

**Parite iddiasının sınırı.** Elle yazılan ve komutla yazılan şarkının
**anahtar sırası hiç farklılaşamaz**, çünkü ikisi de `songSchema.parse`'tan
geçer ve zod her nesneyi şema sırasına göre yeniden kurar. Bunu bir probe'un
ilk turda yeşil gelmesi gösterdi (probe 43). Parite iddiası bu yüzden anahtar
sırasına değil, değerlere ve **slot içi vuruş sırasına** dayanır; probe da
oraya nişanlandı.

**`landOn`'daki kontrolün yarısı ölüydü.** `Number.isInteger(ticks)`
kanıtlanabilir biçimde gereksizdi: kesirli bir tick hiçbir slota tam bölünmez,
NaN ve Infinity hiçbir barın içine düşmez. İşi gerçekten yapan yarı işaret
kontrolüdür — tam bölünen bir negatif tick ikisinden de geçer. Ölü yarı
silindi, negatif tick için test yazıldı.

**Hiçbir komutun döndüremediği bir hata kodu vardı.**
`instrument_range_unavailable` union'da ve mesaj tablosundaydı; registry
hiçbir enstrüman için sayısal aralık tutmadığından üretilebilir değildi.
Silindi.

**Dokunma hedefleri okurun metin ayarıyla büyüyordu.** `min-h-11` = 2.75rem;
%150'de her transport kontrolü 66 px oldu ve 320 px'de satır 460,6 px istedi
(iki kontrol ekran dışında). Ölçüm §15 koşusunun 125%/150% turlarından geldi.

**`flex-wrap` sonrası rem hedefleri artık tek başına tehlikeli değil.** T1
probe'u ilk turda yeşil geldi: sarma yerinde olduğu için rem hedefler bir
kontrolü kaybettirmiyor, bir satır daha açtırıyor. Probe, gönderilen kusuru
birebir yeniden üreten mutasyona çevrildi (sarma + piksel boşluklar birlikte
geri alınır).

## Ölçümler

- `artifacts/PERFORMANCE.json` — saf çekirdekler, masaüstü Node.
- `artifacts/PERFORMANCE-BROWSER.json` — DOM ve dokunuş, masaüstü Chromium.
- `artifacts/BROWSER.json` — kabul senaryoları.

Dikkate değer iki sayı:

1. **Bir yazma komutu ~17 ms** (worst-case şarkı, 32 bar, 8 track). Bunun
   neredeyse tamamı `settle`'dır — şema + doğrulayıcı zincirinin tamamı — ve
   tab'ın kendi düzenlemelerinin ödediği maliyetle aynıdır. Yeni bir maliyet
   değil; buraya taşınmış bir maliyet.
2. **Bir davul dokunuşu ~32 ms**, iki animasyon karesi boyunca ölçüldü. 60 Hz'de
   iki kare 33 ms'tir: yani ölçülen şey komutun kendisi değil, kare sınırıdır.
   Bunu "hızlı" diye raporlamak yanlış olurdu — raporlanan, dokunuşun bir
   sonraki iki kare içinde ekrana çıktığıdır.
