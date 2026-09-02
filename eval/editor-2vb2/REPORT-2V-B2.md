# Faz 2V-B.2 — teslim raporu

Dal: `claude/proje-yorumları-n06wen` · Depo: `haktanplays/aranje`

Bu tur, kurucunun **fiziksel Android koşusunda** durduğu üç yeri kapatıyor.
Editörün birleştirilmiş kontrol yüzeyi ve akor akışı **teslim edilmedi**;
neden olduğu ve elimizde ne kaldığı §B'de ölçümüyle yazılıdır.

---

## §0 · Giriş kapısı

| | |
|---|---|
| Dal | `claude/proje-yorumları-n06wen` (tam) |
| Başlangıç HEAD = `@{u}` | `a096686359d76fc3537e985ae3fe814a00f748bc` |
| Çalışma ağacı | temiz |
| `dc10969` ata mı | evet |
| `ef4291d` ata mı | evet |

Reset, rebase, amend, force-push, stash-atma yok.

---

## §A · Teslim edilen: üç fiziksel tıkanma

### A1 · 11A — seçim çalma «yalnız dar bir koşulda» çalışıyordu

**Kök neden, ölçülerek bulundu.** Kabul fixture'ının bütün seçim şekilleri
üretim planlayıcısından geçirildi. Ortaya çıkan desen tekti: bir seçim
**yalnızca tam bir vuruşun üzerinde başlıyorsa** çalıyordu.

`inWindow` onset tabanlıdır ve *zamanlama* için bu doğrudur — daha önce
başlamış bir nota sınırda yeniden vurulmamalı. Ama aynı yüklem *«burada
duyulacak bir şey var mı?»* sorusuna da cevap veriyordu ve orada yanlıştır.
Fixture'ın 1. ölçüsü sekiz slot boyunca tutulan let-ring bir power chord'dur;
o akorun **içinden** seçilen 1–3. slotlar «dinlenecek nota yok» diyordu.

Ölçülen örnekler (üretim planlayıcısı, kabul fixture'ı):

| Seçim | Önce | Sonra |
|---|---|---|
| 1. ölçü · gitar · slot 1–3 | `REFUSE:no_audible_notes` | `ok` (onset 0, sustain 3) |
| 1. ölçü · gitar · slot 5 | `REFUSE:no_audible_notes` | `ok` |
| 1. ölçü · gitar · slot 2–6 | `ok(1)` | `ok` (onset 1, sustain 3) |
| 2. ölçü (gerçekten boş) | `REFUSE` | `REFUSE` — doğru |

**Düzeltme.** Üyelik onset tabanlı kaldı; duyulabilirlik örtüşme tabanlı
oldu. Aradaki boşluk ikinci bir vuruşla değil **devam yoluyla** dolduruldu:
`activeVoicesAt` zaten bir notayı ulaştığı perdeden ve fazdan sürdürüyor ve
motor bunu her duraklamada yapıyor. Pencere açıldığında çalmakta olan
notalar artık devam ediyor — sınırda yeni bir atak yok.

### A2 · Sessiz reddin sonu

Reddedilen bir basış hiçbir şey söylemeden geri dönüyordu; okuyucunun
tarafından bu, bozuk bir düğmeden ayırt edilemez. Planlayıcının zaten
ürettiği ret cümlesi artık eylemi sunan yüzeye taşınıyor ve orada yazıyor.
Karar React dışına çıkarıldı (`planAudition`), çünkü hook'un içinde kalan
tek satır test edilemiyordu — ve probe 36 tam olarak o satırı silip yeşil
kaldığı için bu gerekliydi.

### A3 · Adım 10 — «takıldı, tamamlanamadı»

**Kök neden.** Talimat *sil, sonra geri al* diyordu. Kapı *sil, sonra geri
al, sonra ileri al* istiyordu — defterin `redoHash` sütununu o üçüncü basış
besliyor. İkisi de tek başına savunulabilir; birlikte, okunacak hiçbir şeyi
olmayan devre dışı bir düğme ürettiler.

**Düzeltme.** Yargı artık tek bir boolean değil: aynı iz, hangi parçanın
geldiğini ve hangisinin beklendiğini satır satır söylüyor, ve bir sonraki
basışı adıyla veriyor («İleri al»). İki çıkış eklendi:

- **«Tekrar dene»** — yalnız o adımın kanıtını sıfırlar, on üç adımı değil.
- **«Burada bitir ve sonucu oluştur»** — koşuyu olduğu yerde bitirir.
  `PASS` üretmesi **imkânsızdır**: `BLOCKED` her `PASS` dönüşünün üstünde
  durur. Ölçülmüş bir kırılma ise `BLOCKED`'ın da üstündedir — kaçış kapısı
  bir kusuru gömemez.

### A4 · 11B — telefon hoparlöründe ikinci enstrüman

Kabul bası G1 ve C2 üzerindeydi: temel frekanslar ~49 Hz ve ~65 Hz, yani bir
telefon hoparlörünün üretmediği bir bölge. Soru **cevaplanamazdı**, düşmüş
değildi.

İki dürüst müzikal değişiklik: kayıt Re ve Sol tellerine taşındı (G2 · A2 ·
C3 — harmonikleri telefonun yaydığı banda düşüyor) ve ritim gitarın vuruş
üstü ifadesine **karşı** yazıldı (gitar 0,4,8,12 · bas 0,3,6,10,13), böylece
tını ayırt edemeyen bir okuyucu **ne zaman hareket ettiklerinden** ayırt
edebilsin. Vuruş 1 ortak bırakıldı, yoksa düet olmaz. Kazanç hilesi yok, ek
klik yok, fixture dışında hiçbir şey değişmedi.

Soru da cevaplanabilir hâle getirildi:
«Gitarın yanında ikinci, daha kalın partiyi telefon hoparlöründe ayırt
edebildin mi?»

### A5 · Boş zeminden kaydırma

Kurucunun ilk doğal hareketi: seçimi görünür kenarda bitir, bırak, zemini
sürükleyerek sonraki ölçülere geç, devam et. Editörde bu jest yoktu.
Artık var — yalnız **boş zeminde**, yalnız **elde bir seçim varken**, ve
üstündeki her jeste kaybederek: boş bir portede ilk uzun basış hâlâ seçer,
kalem tutan hâlâ dokunduğu yere yazar.

---

## §B · Teslim edilmeyen: birleşik kontrol yüzeyi ve akor akışı

Denendi, ölçüldü, **gönderilmedi.** Sebebi tek cümleyle: hazırladığım
sürüm, doğrulanmış kabul koşusunu **34/34'ten 20/34'e** düşürdü.

Ama denemenin ürettiği ölçüm, bir sonraki turun en değerli girdisidir.

**384×692'de, sahne 556 px. Sütun tam dolu:**

| Satır | Yükseklik |
|---|---|
| düzenleme başlığı | 44 px |
| **porte** | **298 px** |
| enstrüman kontrolü | 44 px |
| besteci kapıları | 48 px |
| **kontekst paneli** | **16 px** |
| eylem satırı | 49 px |
| transport | 57 px |

Yani porteye ait olmayan yerleşik kontroller **242 px** yiyor. Panel
mevcut satırların *yanına* eklendiğinde geriye 16 px kalıyor — kullanılamaz
bir şerit. Porte tabanını 240 px'e indirip kapı satırını panel açıkken
kaldırdığımda panel **122 px**'e çıktı ve ölçümler §3'ün dördüncü
değişmezini karşıladı (porte 240/556 = %43.2, scrim yok, `elementFromPoint`
portenin ortasında porte hücresine düşüyor, yatay taşma 0) — dört
viewport'ta 52/52. Ama aynı sürüm kabul koşusunu düşürdü ve bunun
harness kırılganlığı mı gerçek bir gerileme mi olduğunu sorumluca
saptayamadım.

**Bundan çıkan karar:** panel, mevcut satırların yanına eklenemez.
§8/§9'un istediği **birleştirme** — kapı satırı, seçim araç çubuğu, eylem
satırı ve enstrüman kontrolünün tek bir yüzeye indirilmesi — bu turun
opsiyonel bir güzelleştirmesi değil, panelin çalışabilmesinin **önkoşulu**.
Ve 360 px yüksekliğindeki yatay bir telefonda sütun toplam 241 px; orada
hiçbir taban+panel düzeni sığmıyor, cevap §8'in izin verdiği yan panel.

Gönderilmeyen: birleşik dock, Ses/Ritim/Çalım/Seçim bilgi mimarisi, sade
akor akışı ve voicing seçimi, uyarı tekilleştirme, zoom kontrolü, görsel
sadeleştirme, yeni fiziksel kabul rotası.

---

## §C · Doğrulama

| Kapı | Sonuç |
|---|---|
| `npm test` | **281 dosya · 4631 test · hepsi geçti** |
| `npx tsc --noEmit` | çıkış 0 |
| `npm run lint` | `eslint .` sessiz |
| `npm run build` | başarılı |
| `git diff --check` | temiz |
| Tarayıcı kabulü (2V-B.1) | **34/34** |
| Geometri (5 bağlam) | **130/130** |
| Mutasyon probe'ları | **47 kırmızı · 0 yeşil kalan** (13'ü bu turun) |
| Hedefli süit ×10 | her koşuda **523 test** |
| Bütün süit ×4 | her koşuda **4631 test** |
| Tarayıcı kabulü ×10 | her koşuda **34/34** |

Satır bütçeleri: `Workspace.tsx` 376/379 · `ArrangementCanvas.tsx` 470/470 ·
`TabCanvas.tsx` 467/480.

**Bir probe gerçek bir boşluk buldu.** «Reddedilen basış yine sessizleşiyor»
mutasyonu ilk turda **yeşil kaldı**: ret cümlesini üreten satır bir React
hook'unun içindeydi ve bu süitin DOM'u yok. Probe'u zayıflatmak yerine karar
saf bir fonksiyona çıkarıldı (`planAudition`), beş testle sabitlendi ve probe
oraya yönlendirildi; ayrıca yüzeyin cümleyi göstermesini ayrı sınayan 36b
eklendi. Bir şeyi kontrol edemeyen tek satır, tam olarak sessizce kaybolan
satırdır.

**Bu turda kendi hatam:** probe'ları tekrar koşularıyla **eşzamanlı**
çalıştırdım; probe'lar kaynağı yerinde değiştirdiği için bir tam süit koşusu
sahte bir hata verdi. Seri olarak yeniden koşuldu ve temiz. Sayıları
yukarıdaki tablo seri koşulardan alıyor.

---

## §D · Hâlâ fiziksel kanıtı olmayanlar

1. **Hiç kimse bu sesi dinlemedi.** Bas artık telefonun üretebileceği bir
   kayıtta yazılı; Haktan'ın telefonunda **duyulup duyulmadığı** hâlâ onun
   söyleyeceği bir şey.
2. **Devam eden ses.** Tutulan akorun ortasından başlayan bir seçimin
   yeniden vurulmuş gibi duyulup duyulmadığı ölçülmedi — plan ve zamanlama
   kanıtı var, ses kanıtı yok.
3. **Slide, vibrato, HO/PO** için elimizde yine yalnız zamanlayıcı kanıtı
   var.
4. **Gerçek parmak.** Zemin kaydırması ve jest hakemliği Playwright dokunma
   emülasyonuyla doğrulandı; gerçek Android dokunma davranışı değil.
5. **K-61, K-62, K-63** kendiliğinden onaylanmadı.
6. **Adım 12'nin cevabı** («aradığın işlemi bulmak kolay mıydı») bu turda
   iyileşmedi: birleştirme gönderilmedi.
