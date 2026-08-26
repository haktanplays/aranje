# 2S-A · Başlangıç ölçümleri (§2)

Bu belge **ölçülen** şeyi yazar. Hiçbir satırı ürün kodunu değiştirmeden,
production build üzerinde ve masaüstü Chromium'da alınmıştır. **Fiziksel
Android/iOS kanıtı yoktur.**

Üretenler:

```
npx tsx eval/intent-composer/make-fixtures.ts
npx vite build --config eval/intent-composer/vite.intent.config.mts
./eval/chord-audio/serve.sh
node eval/intent-composer/measure-audio.mjs         # katman katman ses
node eval/intent-composer/measure-contribution.mjs  # nota başına katkı (çıkarma)
node eval/intent-composer/measure-live.mjs          # canlı bağlam kaydı
node eval/intent-composer/measure-arrival.mjs       # bağlı notanın perdesi geliyor mu
node eval/intent-composer/baseline.mjs              # uygulamanın kendisi
```

Artefaktlar: `BASELINE.json` (uygulama), `AUDIO.json` (ses), `fixtures.json`
(şema + validator zincirinden geçmiş şarkılar), `shots/` (iki ekran görüntüsü),
`wav/` (dinlenebilir render'lar).

---

## A · «1/32'de bazı notalar duyulmuyor»

Bildirilen fixture birebir kuruldu: 4/4, **132 BPM**, `electric_guitar/high_gain`,
**1/32** ızgara, tek telde sekiz vuruş, perdeler `7,7,7,7,8,7,7,7`, `8→7`
**pull-off**, tek ölçü, track'in varsayılan güvenli sesi (`-6 dB`, ürünün kendi
`DEFAULT_TRACK_VOLUME_DB`'si).

Zincir **katman katman** ölçüldü, çünkü "nota duyulmuyor" cümlesi altı ayrı
yerde doğru olabilir ve her birinde düzeltme başka bir düzeltmedir.

| Katman | Ölçüm | Sonuç |
|---|---|---|
| Timeline / notated plan | `buildNotatedPlan` olayları | **8/8 onset var** |
| Scheduler | `transport.schedule` çağrıları sarmalandı | **8/8 olay yerleştirildi** |
| Voice | `sampler.triggerAttackRelease`, `expression.play`, `playChain` sarmalandı | **7 tetik + 1 zincir** (pull-off hedefi kasten vurulmaz) |
| Offline render | tam render eksi «bu onset sus» render'ı | **8/8 onset ölçülebilir enerji katıyor** |
| Enerji penceresi | 5 ms pencereler, slot başına tepe | tepe dizisi düzenli, boşluk yok |
| Canlı (online) bağlam | gerçek `AudioContext`, `ScriptProcessorNode` ile kayıt | **8/8 duyuluyor** |
| Uygulamanın kendisi | `AudioBufferSourceNode.prototype.start` sayıldı | **1/32 → 13, 1/16 → 13** (aynı) |

**Yani bildirilen kusur "düşen nota" olarak hiçbir katmanda yeniden
üretilemedi.** Bu dürüst bir olumsuz sonuçtur ve gizlenmemiştir.

### A.1 Yeniden üretilen gerçek kusur: bağlı notanın perdesi gelmiyor

Bir pull-off **vurulmaz**: zincir, çalan sesin perdesini hedefe taşır. Dolayısıyla
"nota duyuldu mu" sorusu enerji sorusu değil, **perde** sorusudur. Parmağın inişi
için ayrılan süre (`expressionPresets.legato.pullOff.transitionSeconds = 28 ms`,
hammer-on `22 ms`) **sabittir** ve müziğin bıraktığı yeri hiç sormaz. Slide bunu
zaten soruyor (`glideFor`); hammer-on ve pull-off hiç sormamış.

Ölçülen (`AUDIO.json → arrivals`), aynı sekiz vuruş, aynı `8→7` pull-off:

| Izgara / tempo | Slot | Yolculuk | Perde ne zaman geliyor | Ses ne zaman bitiyor | Hedef perde ne kadar duyuluyor | Slotun %60'ında ölçülen sapma |
|---|---|---|---|---|---|---|
| 1/8 · 132 | 227,3 ms | 28 ms | 255,3 ms | 435,6 ms | **180,3 ms** | 6,5 cent |
| 1/16 · 132 | 113,6 ms | 28 ms | 141,6 ms | 217,8 ms | **76,2 ms** | 9,4 cent |
| 1/24 · 132 | 75,8 ms | 28 ms | 103,8 ms | 144,4 ms | **40,7 ms** | 14,3 cent |
| 1/32 · 132 | 56,8 ms | 28 ms | 84,8 ms | 108,9 ms | **24,1 ms** | 15,5 cent |
| 1/24 · 260 | 38,5 ms | 28 ms | 66,5 ms | 73,3 ms | **6,9 ms** | 25,7 cent |
| **1/32 · 260** | 28,8 ms | 28 ms | 56,8 ms | **55,3 ms** | **0,0 ms** | **49,0 cent** |

Son satırda ses, perde daha yerine varmadan susuyor: **hedef notanın perdesi hiç
duyulmuyor.** Bir üstteki satırda 6,9 ms duyuluyor, ki bu da duyulmuyor demektir.
1/32 · 132'de 24,1 ms kalıyor ve ölçülen sapma çeyrek sesin altıysa da 1/8'deki
6,5 cent'in iki buçuk katı.

Aynı ölçüm Drop D'de, capo 3'te ve bölüm dikişinde birebir aynı sayıları veriyor:
kusur akorda, akortta ya da konumda değil, **sabitte**.

**Kök neden, tek cümle:** legato geçişinin süresi bir sabittir; bir sabit her
tempoda ve her ızgarada doğru olamaz.

### A.2 Ölçülüp elenen adaylar

Hiçbiri varsayılmadı; hepsi ölçüldü ve elendi:

- **Yuvarlama** — 1/32 slotu tam `24` tick, `768/32`; hiçbir yerde kesir yok.
- **Sıfıra düşen süre** — `articulationHold` sonrası çalınan süre `22` tick
  (`Math.max(1, …)` hiç devreye girmiyor).
- **Tekrarlanan perdenin yutulması** — `repeat-32-260` fixture'ında sekiz aynı
  perde art arda ve sekizinin de katkısı ölçüldü (`0,105–0,112` tepe).
- **Voice pool sınırı / voice çalma** — havuzda üst sınır yok; `active` sayacı
  render sonrası `0`.
- **Geç kalan transport callback'i** — ölçüldü: medyan **−55 … −80 ms**, yani
  callback'ler zamanından *önce* koşuyor; 8 ms'lik yapay ana-iş-parçacığı
  bloklamasıyla da geç kalan callback sayısı **0**.
- **`transport.start()` biçimi** — `plain`, count-in gibi `start(now+0.5)` ve
  `ticks` atayıp başlatma; **üçünde de 8/8**.
  (Harness'ın ilk turunda `start(0)` kullanılmıştı ve tick 0'daki olay hiç
  koşmadı; bu **harness kusuruydu**, ürün `transport.start()` çağırıyor.
  Düzeltildi ve buraya not edildi.)
- **Offline ile online farkı** — ikisi de 8/8.

### A.3 Yan bulgu: 1/32'de slide reddediliyor

`technique-slide-32` fixture'ında zincir hiç kurulmuyor: `glideFor` "kayacak yer
yok" diyor ve nota sıradan bir vuruş olarak çalınıyor. Bu **K-23'ün kayıtlı ve
kabul edilmiş** davranışıdır, sessizlik değildir; burada yalnızca ölçülmüş
olduğu için yazılıdır.

---

## B · Tab rakamları kart gibi duruyor

Ölçülen (`BASELINE.json → glyph`, 390×844, %100 metin):

| Ne | Değer |
|---|---|
| Perde rakamı kutusu | **13,23 × 12 px** |
| Arka plan | `rgb(16, 17, 20)` — dolu bir dikdörtgen (`bg-app` maskesi) |
| Kenarlık / köşe / gölge | `0px` / `0px` / `none` |
| Yatay dolgu | `3px` + `3px` |
| Punto | `12px`, `ui-monospace`, `tabular-nums` |
| Tel çizgisi | 6 adet, `1px` |
| Slot genişliği | `34px` (`SLOT_WIDTH`) |
| Dokunma hedefi | rakamla **aynı kutu değil**; düzenleme modunda `34 × 26 px` hücre |

Yani "kart" hissi bir kenarlıktan gelmiyor — **dolu bir zemin dikdörtgeni ve iki
yandan 3 px dolgu**dan geliyor. Tel çizgisi rakamın arkasından geçmiyor, bir
kutunun kenarında bitiyor. Ekran görüntüsü: `shots/before-tab-390.png`.

Ayrıca ölçülen: düzenleme hücresi **34 × 26 px**, yani `MIN_TOUCH_TARGET_PX`
(44) altında.

---

## C · Power chord yazmak

Ölçülen yol (`BASELINE.json → powerChord`), boş bir vuruşa power chord yazmak:

1. **Düzenle**
2. **hücreye dokun** → 20 düğmeli fret sheet açılıyor (`Kapat` ve `Ekle`
   katlanmanın altında)
3. **Power chord** → akor kurucusu
4. **kök: perde adı** — 12 perde sınıfı arasından *isimle* (`C`, `C♯ / D♭`, …).
   **Hiçbir adım "hangi tel, hangi perde" diye sormuyor.**
5. **2 ses / 3 ses** (`Kök + beşli`, `Kök + beşli + oktav`)
6. → **4 şekil kartı** (`Açık konum`, `5. perde çevresi`, `7. perde çevresi`,
   `10. perde çevresi`) arasından seçim, sonra **Uygula**

**Bir tek nota yazılmadan önce 5 dokunuş**, ve şeklin seçimi 4 karttan biri.
Notasyon okumayan biri için asıl sorun sayıda değil: *kök perde adıyla soruluyor*,
oysa parmağı bir telin bir perdesinde. Yanlış seçme riski doğrudan buradan geliyor.

---

## D · Beş notayı hammer-on / pull-off ile bağlamak

Ölçülen (`BASELINE.json → legato`), tek telde beş nota, dört bağ:

- Bağ başına **4 dokunuş**: `hücreye dokun` → `Hammer-on`/`Pull-off` →
  `Güncelle` → `Kapat`.
- Toplam **17 dokunuş**. Hiçbir yerde "şu beşini bağla" diyen bir şey yok.
- Her turda sheet'in `Kapat` ve `Güncelle` düğmeleri **katlanmanın altında**.

### D.1 Yeniden üretilen gerçek ürün kusuru

Ölçüm sırasında bulundu ve izole edildi:

```
Hammer-on'a bas          → [[0,5,null],[1,7,"hammer_on"],[2,8,null],…]   ✔ yazıldı
sonra Güncelle'ye bas    → [[0,5,null],[1,7,null],       [2,8,null],…]   ✘ silindi
```

Sheet'in birincil düğmesi mevcut bir notada **"Güncelle"** yazıyor — okurun
onaylamak için basacağı düğme. Bastığında `set_note` notayı yeniden yazıyor ve
**üzerindeki artikülasyonu düşürüyor**. Kusur ayrı bir senaryoyla kırmızıya
bağlanacak ve sonra düzeltilecektir.

---

## E · 320 px EditToolbar taşması

Ölçülen (`BASELINE.json → toolbar`), `[data-action-row] > div` satırının
`scrollWidth`/`clientWidth`'i. **On iki kombinasyonun sekizi taşıyor**:

| Viewport | Metin | Düzenleme | scroll / client | Kırpılan |
|---|---|---|---|---|
| 390×844 | %100 | kapalı/açık | 366 / 366 | 0 |
| 390×844 | %125 | açık | 362 / 360 | **2** |
| 390×844 | %150 | kapalı | 371 / 354 | **17** |
| 390×844 | %150 | açık | 419 / 354 | **65** |
| 320×700 | %100 | açık | 314 / 296 | **18** |
| 320×700 | %125 | kapalı | 323 / 290 | **33** |
| 320×700 | %125 | açık | 362 / 290 | **72** |
| 320×700 | %150 | kapalı | 371 / 284 | **87** |
| 320×700 | %150 | açık | **419 / 284** | **135** |

`body` yatay taşması her kombinasyonda **0**: taşan şey sayfa değil, satırın
kendisi — yani kontroller ekran dışında kalıyor ve oraya kaydırılarak da
ulaşılamıyor.

Kök neden, ölçülen genişliklerden: satır **tek satırlık, sarmayan bir flex**;
`Aranje et` `shrink-0` ve metin ölçeğiyle büyüyor (`85 → 106 → 127 px`);
`Düzenle` `flex-1` ama `min-content` genişliğinin altına inemiyor ve
"Düzenlemeyi bitir" onu `117 → 138 → 168 px` yapıyor. İki `44 px` düğme ve üç
`8 px` boşluk sabit. `168 + 127 + 44 + 44 + 24 = 407 px`, ölçülen `419`.

2R-A'nın raporladığı `326/320 px` aynı kusurun **yalnız bir hücresidir**
(`[data-action-row]`'un kendisi, %100 metin). Gerçek en kötü hâl `419/284`.

Ekran görüntüsü: `shots/before-toolbar-320.png`.

---

## §3 sonrası · aynı harness, aynı fixture'lar (`AFTER.json`)

Düzeltme: legato geçişinin süresi artık **indiği notanın ne kadar yer
bıraktığını soruyor** (`expressionPresets.legato.maxTravelFraction = 0.4`).
Slide bunu `glideFor` ile zaten soruyordu; hammer-on ve pull-off da sordu.
Yazılan hiçbir şey değişmedi: onset da, süre de, tick de aynı.

| Izgara / tempo | Yolculuk (önce → sonra) | Hedef perde ne kadar duyuluyor (önce → sonra) | %60 noktasındaki sapma (önce → sonra) |
|---|---|---|---|
| 1/8 · 132 | 28,0 → **28,0 ms** | 180,3 → **180,3 ms** | 6,5 → **6,5 cent** |
| 1/16 · 132 | 28,0 → **28,0 ms** | 76,2 → **76,2 ms** | 9,4 → **9,4 cent** |
| 1/16 · 260 | 28,0 → **21,2 ms** | 24,9 → **31,7 ms** | 15,2 → **14,9 cent** |
| 1/24 · 132 | 28,0 → **27,5 ms** | 40,7 → **41,2 ms** | 14,3 → **14,1 cent** |
| 1/24 · 260 | 28,0 → **13,9 ms** | 6,9 → **20,9 ms** | 25,7 → **22,6 cent** |
| 1/32 · 132 | 28,0 → **20,8 ms** | 24,1 → **31,3 ms** | 15,5 → **15,8 cent** |
| **1/32 · 260** | 28,0 → **10,6 ms** | **0,0 → 15,9 ms** | **49,0 → 21,1 cent** |

Yeri bol olan hiçbir durum değişmedi: 1/8, 1/16 · 132 ve 1/32 · 40'ta yolculuk
hâlâ tam preset süresi. Değişen yalnız yerin yetmediği yerler.

Aynı koşuda geri kalan her şey de yeniden ölçüldü ve değişmedi: 45 fixture'ın
her onset'i çıkarma yöntemiyle ölçülebilir katkı veriyor, canlı bağlamda
8/8 duyuluyor, geç kalan callback **0**.

**Dürüstlük notu.** `reported-32-260` fixture'ında enerji ölçütüm 6. onset'i
hem önce hem sonra "sessiz" işaretliyor. Bu ölçütün kusurudur, ürünün değil:
o onset zincir bittikten sonra geliyor, yani üzerine binen bir kuyruk yok ve
penceresindeki tepe yalnız kendi atağı. Çıkarma yöntemi aynı onset için
`0,1069` katkı ölçüyor — komşularıyla aynı. İşaret bilerek bırakıldı.

**Ölçülmeyen.** Bu satırların hiçbiri bir insanın "daha iyi duyuluyor"
demesi değildir. Ölçülen şey perdenin ne zaman geldiği ve ne kadar
duyulduğudur; nasıl duyulduğuna Haktan karar verir.

---

## §15 sırasında bulunan harness kusuru (ürün kusuru değil)

Kabul koşusunun ilk sürümünde, 320×700 %150 metinde kalemi kuşandıktan
sonraki **ilk** hücre dokunuşu hiçbir şey yazmıyordu; aynı koordinata ikinci
dokunuş çalışıyordu. Kök neden ölçüldü: `document.elementsFromPoint` o
koordinatta en üstte `[data-return-to-playback]` düğmesini döndürüyor.

```
4:0 box {"x":170,"y":263.25,"width":34,"height":44}
    @ BUTTON {data-return-to-playback aria-label=Çalmaya dön}   ← ilk dokunuş buraya gitti
    @ BUTTON {data-cell=4:0}
```

«Çalmaya dön» pili, okuyucu playhead'den uzağa kaydırdığında okuma yüzeyinin
sağ altında beliren gerçek bir denetimdir (2Q-C §6). Harness hücreyi görünür
kılmak için kaydırdığı an pil beliriyor ve 320 px'te en pes telin son
hücrelerinin üstüne oturuyor. İnsan o pili **görür** ve başka yere nişan alır;
`page.mouse.click` ise körlemesine koordinata basar ve dokunuş pili kapatmakla
harcanır. Bu, harness'in kusurudur.

Düzeltme harness'te: `tapCell` artık dokunmadan önce o noktada gerçekten
hedeflenen hücrenin olup olmadığını soruyor, üstte pil varsa önce onu
kapatıyor, kutuyu yeniden çözüp öyle dokunuyor. Üründe hiçbir şey
değiştirilmedi — çünkü değiştirilecek bir kusur bulunamadı.

---

## §18 regresyonunda bulunan gerçek kusur: 320 px'te düzenleme ızgarası ekranın dışına çıkıyordu

Regresyon koşusu üç pakette **yeni kırmızı** verdi. Başlangıç SHA'sı
(`217e7cb`) aynı makinede, aynı harness'lerle ölçüldü:

| Paket | İlk hâli | `217e7cb` | Sonuç |
|---|---|---|---|
| `practice-loop` | 19 kaldı | **0 kaldı** | 19'u da yeni |
| `selection-ui` | 2 kaldı | 1 kaldı | 1'i yeni |
| `multitrack` | 26 kaldı | 22 kaldı | 4'ü yeni |

**Kök neden, ölçülerek.** `320×700`'de düzenleme modunda ilk onset hücresi
`y=423`'te duruyor, okuma yüzeyi ise `y=402`'de bitiyor. Hücre yüzeyin
**dışında**; o noktaya yapılan dokunuş track kontrol satırına gidiyor.
`390×844`'te aynı hücre yüzeyin içinde.

```
320×700  cell {"y":423,"h":44}  main {"top":153,"bottom":402}
390×844  cell {"y":423,"h":44}  main {"top":153,"bottom":646}
```

Zaman seçimi bütünüyle kırılmıştı: uzun basış hiç band açmıyordu
(`"no band"`), dolayısıyla pratik döngüsünün giriş kapısı da çalışmıyordu.

İkinci ölçüm, seçim eylem çubuğu açıkken: `320×700` %150 metinde `main`
**`44 px`** (169→213). Dört niyet kapısı müziğin son satırını alıyordu.

**Kabul ölçümünün kendi kusuru.** Senaryo yalnız
`getBoundingClientRect().height >= 44` soruyordu. `44` yüksekliğindeki bir
hücrenin ekranda olup olmadığını, altında kalıp kalmadığını, komşusuyla üst
üste binip binmediğini ve o noktaya basınca kimin cevap verdiğini
sormuyordu. Kusur tam da bu boşluktan geçti.

## Karar: Focused Edit Layout

Okuma modu `360 px` altında yoğun kalabilir; **düzenleme modunda bütün
etkileşim satırları en az `44 px`**. Aritmetik kapanmıyorsa hedef değil
**çevre** geri çekilir:

- düzenlemeye girince marka başlığı, görünüm anahtarı ve geniş bölüm
  navigasyonu geri çekilir;
- yerlerine tek bir kompakt satır gelir: **"Bitti · Ana Riff · 12. ölçü"**;
- satır ve "Bitti" en az `44 px`;
- uzun bölüm adı ekranda kırpılabilir, erişilebilir ad tam kalır
  (`lib/workspace/edit-header.ts` saf, altı testi var);
- staff kendi içinde dikey scroll almaz, altı tel aynı anda görünür;
- transport korunur; çıkınca normal chrome geri gelir.

Ölçülen sonuç — okuma yüzeyi düzenleme modunda:

| | %100 | %125 | %150 |
|---|---|---|---|
| `390×844` | `601 px` | `542 px` | `535 px` |
| `320×700` | `357 px` | `~340 px` | `~330 px` |
| gereken porte | `264 px` | `264 px` | `264 px` |

Altı kombinasyonun hepsinde: görünür hücre yüksekliği `44 px`, yanlış
sahiplenen nokta `0/72`, komşu tel çakışması `0`, dış tellerin görünür
yüksekliği `44 px`, staff içi scroller `0`.

**Kabul artık gerçekten ölçüyor.** 59 görünür yüksekliği (her scroller ve
viewport ile kırpılmış), 59.b `elementFromPoint` ile hücrenin merkezinde ve
merkezin biraz altında/üstünde gerçek sahibi, 59.c komşu şeritlerin
çakışmasını, 59.d dış iki telin bütünlüğünü, 59.e staff içi scroller
olmadığını, 63 her hücrenin yüzeyin içinde olduğunu, 64/64.b/64.c focused
satırı, çıkış kontrolünü ve eylem satırındaki her kontrolün `44 px` olduğunu
soruyor.

**Düzeltmeden sonra** `selection-ui` ve `multitrack` başlangıç SHA'sıyla
**birebir aynı** (`1` ve `22`, aynı senaryolar).

---

## §18'de bulunan ikinci kusur, bu sefer harness'in: `eval/tab` de körlemesine dokunuyordu

`eval/tab` senaryo 3 (`320×700`) bu build'de kırmızıya döndü ve arkasındaki
tur `TimeoutError` ile düştü — 4 senaryo hiç koşmadı. Kök neden ölçüldü:

```
pressCell intro:0 5:0 top: Çalmaya dön
```

§15'te kendi harness'imde bulduğum kusurun aynısı: `pressCell` ham koordinata
basıyor ve okuma yüzeyi playhead'den uzağa kaydırıldığında beliren «Çalmaya
dön» pili (2Q-C §6) dokunuşu yutuyor. Düzenleme satırı `44 px` olunca en pes
telin son hücreleri pilin altına giriyor, bu yüzden aynı zayıflık burada
ısırıyor. `pressCell` artık dokunmadan önce o noktada gerçekten hedef
hücrenin olup olmadığını soruyor. Düzeltmeden sonra `eval/tab` başlangıç
SHA'sıyla **birebir aynı**: `89 geçti / 5 kaldı`, aynı beş senaryo.

## §18'de bulunan üçüncü kusur, ve bu sefer kusur bendeydi: kapılar fırçanın kapısını da kapatıyordu

320×700 · %150'de yüzeyin sıkışmasına verdiğim ilk cevap, bir koşu seçiliyken
dört kapıyı gizlemekti (`doorsStandDown`). Ölçüm doğruydu — o kombinasyonda
kapılar `main`'i `44px`'e indiriyordu — ama çözüm yanlış yeri kesti.

Legato Fırçası **seçili bir koşu üzerinde** kullanılır: notaları kapla, sonra
"Bağla"yı aç. Kapıları seçim varken gizlemek, fırçanın tek kapısını tam ihtiyaç
duyulan anda ortadan kaldırdı. Kendi kabul paketim bunu söyledi:

```
locator.click: Timeout 30000ms exceeded.
  - waiting for locator('[data-composer-door=\'connect\']')
  at brushTour (eval/intent-composer/verify.mjs:569)
```

Suite senaryo üretmeyi bırakıp çöktü; 36 senaryodan sonrası hiç koşmadı.

**Düzeltme.** Kapılar satırını geri aldım. Yer, Focused Edit Layout'tan
geliyor: marka başlığı, görünüm anahtarı ve bölüm navigasyonu tek bir 44 px
edit başlığına iniyor. Bunlar yazarken kullanılmayan chrome; kapılar değil.

**Önce kırmızı test.** `intent-boundary.test.ts` artık `ComposerArea`'nın
syntax tree'sini okuyor ve `ComposerDoorRow`'un `selection`'ı soran hiçbir
koşulun içinde olmadığını doğruluyor. Kapıyı seçime bağlayan mutasyon testi
kırmızıya çeviriyor (1 failed | 12 passed), yani iddia boş değil.

## §21 final doğrulamasında ortaya çıkan, bu faza ait olmayan bir yarış

`npm test` final HEAD üzerinde dört kez koşuldu: **iki kez 3316/3316 yeşil,
iki kez tek bir test kırmızı.**

```
FAIL src/lib/copilot/pipeline.test.ts
  > the phase 2A budget and idempotency rules are untouched
  > does not overspend when two callers arrive together
AssertionError: expected [ …(2) ] to have a length of 1 but got 2
```

Aynı dosya tek başına beş kez koşuldu, beşinde de `62/62` yeşil. Yani kırmızı,
bütün suite paralel çalışırken oluşan bir zamanlama penceresine bağlı.

**Kusur gerçek ve bu fazın değil.** Kırılan iddia bütçe *sonucu* değil —
`[a.ok, b.ok]` hâlâ tam olarak bir kabul, bir red veriyor ve red kodu
`budget_exhausted`. Kırılan, `adapter.calls` sayısı: iki çağıran aynı anda
geldiğinde ikisi de bütçe kontrolünden geçip **sağlayıcıya gidiyor**, red
sonradan veriliyor. Yani tek patch dönerken para iki kez harcanabiliyor.

`src/lib/copilot/` bu fazda hiç değişmedi:

```
git diff --stat 217e7cb..HEAD -- src/lib/copilot/   →  (boş)
```

Kod başlangıç SHA'sıyla bayt-eş olduğu için davranış da bayt-eş; bu yarış
2S-A'nın açtığı bir kırmızı değil, Faz 2A rezervasyonunun atomik olmayışı.

**Kapatılmadı, gizlenmedi.** Para harcayan bir yolun kilitlenmesi kendi
kararını ve kendi testlerini hak ediyor; bir 2S-A teslimatının kuyruğunda,
kapsam dışı ve dokunulmamış bir modülde sessizce yapılacak iş değil. Açık
borç olarak buraya ve final rapora yazıldı.
