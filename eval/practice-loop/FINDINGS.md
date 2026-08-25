# 2R-A §5 — Yoğun davul ızgarası: kök neden

Ürün koduna dokunmadan, `73250de` üzerinde ölçüldü.

## Fixture

`denseKit` — sözleşmenin iki yöndeki tavanı: **8 track** (`songLimits.maxTracks`)
ve **32 ölçü** (`songLimits.totalBars`). İlk bölüm bu checkpoint'in konusu:
sekiz adet 4/4 ölçü, **1/32** çözünürlükte. Şarkının kendi kullandığı parçalar
çekirdek kitin dışında üç parça daha içerdiği için step grid **7 satır** çiziyor.

    7 satır × 8 ölçü × 32 slot = 1.792 hücre

Bar başına hücrelerin yaklaşık üçte biri dolu; üç vuruş sertliği (ghost, normal,
accent) ve on bir farklı velocity var. Validator hata sayısı `0`.

## Ölçülen

### Saf katmanlar (Node, 20 tur, `PERFORMANCE.json`)

| katman | median | p95 |
|---|---|---|
| komut: bir vuruş yaz (`insertDrumHit`) | 39,475 ms | 42,475 ms |
| komut: bir vuruş sil (`removeDrumHit`) | 38,228 ms | 42,470 ms |
| şema: adayı `songSchema.parse` | 8,535 ms | 11,097 ms |
| validator zinciri (`runValidators`) | 29,505 ms | 32,688 ms |
| merkezî kapı (`settle`) | 36,641 ms | 54,572 ms |
| model: step grid'i kur | **0,432 ms** | 1,366 ms |
| çizim: bugünkü hücre başına arama | **0,559 ms** | 2,295 ms |
| çizim: aynı aramanın indekslenmiş hâli | 0,438 ms | 0,609 ms |

Zincirin içi (aynı fixture, aynı yöntem):

| validator | median |
|---|---|
| `validateFretJump` | 7,843 ms |
| `validateStringCollision` | 6,937 ms |
| `validateArticulationContext` | 6,890 ms |
| `validateUnplaceable` | 6,056 ms |
| `validateFretboardIntegrity` | 0,616 ms |
| `validateTonalMajority` | 0,487 ms |
| `validateRange` | 0,333 ms |
| `validateSongLimits` | 0,133 ms |
| kalan üçü toplam | < 0,1 ms |

### Tarayıcı (masaüstü Chromium, production build, `DRUM-BASELINE.json`)

| | 390×844 | 320×700 |
|---|---|---|
| step grid açılışı | 145 ms | 158 ms |
| **bir hücreye dokunma (toggle)** | **221 ms medyan / 313 p95** | **223 ms medyan / 356 p95** |
| boş hücreye yazma | 258 ms / 285 | 254 ms / 298 |
| en uzak hücreye dokunma | 206 ms / 273 | 227 ms / 297 |
| hızlı yatay kaydırma | 64 ms | 64 ms |
| mount edilmiş hücre | 1.792 | 1.792 |
| `<button>` | 1.811 | 1.811 |
| toplam DOM düğümü | 3.775 | 3.775 |
| scrollWidth | 24.507 px | 24.460 px |
| AudioContext | 0 | 0 |
| konsol/sayfa hatası | 0 | 0 |
| 46 dokunuş sonrası revision | 1 → 47 | 1 → 47 |

## Kök neden

İki ayrı maliyet var ve ikisi aynı şey değil.

**1. Merkezî kapı: ~37 ms, her düzenlemede.**
Bir davul dokunuşu `settle`'dan geçer; `settle` bütün şarkıyı yeniden parse
eder (8,5 ms) ve bütün validator zincirini yeniden koşar (29,5 ms). Zincirin
%90'ı dört validator'da: `fretJump`, `stringCollision`, `articulationContext`
ve `unplaceable`. Bu dördü **perdeli** track'leri gezer — yani davula dokunan
bir okur, hiç dokunmadığı altı gitar/bas track'i için ödeme yapar.

Bu maliyet **davul ızgarasına ait değil**; tab'ın kendi düzenlemeleri de aynısını
öder. Bu checkpoint'te gevşetilmeyecek: validator atlamak, atomikliği kaldırmak
ve warning zincirini kısaltmak açıkça yasak.

**2. Çizim: ~185 ms, ızgaraya ait.**
Tarayıcıdaki 221 ms'den ~37 ms'i yukarıdaki kapıysa, geriye kalan ~185 ms React
render + 1.811 düğmenin DOM'u + layout/paint'tir. Ekranda aynı anda 320 px'de
yaklaşık **on bir** sütun görünürken **256** sütunun tamamı mount ediliyor.

**Yanlış çıkan ilk hipotez, kayda geçiyor.** Bileşen her hücre için
`row.cells.find(...)` yapıyor — bölümün bütün hücrelerini tarayan, bölüm
uzunluğunda karesel bir arama. Bunun darboğaz olduğu tahmin edilmişti; ölçüldü
ve **0,559 ms** çıktı. İndekslenmiş hâli 0,438 ms. Yani karesel arama gerçek
ama maliyeti yok; düzeltmek 0,1 ms kazandırırdı. Tahminle değil sayıyla
ilerlemenin karşılığı bu.

## Bundan çıkan iş

- Izgaranın zaman sütunlarını **yatay window'la**: hedef ~185 ms'lik çizim
  payıdır, kapı değil.
- Kapının ~37 ms'i **açık ve kayıtlı** kalır. Gevşetilmez; 2R-A'nın hedefi
  (`≤33 ms median / ≤50 ms p95`) bu kapı tek başına 37 ms sürerken **tanım
  gereği bu fixture'da karşılanamaz** ve bu, raporda gizlenmeyecek bir risktir.
- Hücre başına arama düzeltilebilir, ama performans gerekçesiyle değil:
  ölçüldü, 0,1 ms.

## Not

2Q-C'nin kapanışında kayıtlı ~100 ms / ~153 ms **başka bir fixture'dır**
(`eightTracks`: 8 track, 32 ölçü, ama 1/32 yoğun kit bölümü yok ve step grid
4 çekirdek satır çiziyor). Buradaki `denseKit` 7 satır × 1/32 ile daha ağırdır.
İki sayı doğrudan karşılaştırılamaz ve karşılaştırılmıyor; 2R-A'nın önce/sonra
karşılaştırması aynı `denseKit` fixture'ı üzerinden yapılacak.

Bütün sayılar masaüstü Chromium ve Node'dandır. **Fiziksel telefon kanıtı
değildir.**

---

# 2. Windowing sonrası: ikinci hipotez de ölçüldü, o da yanlış çıktı

`DRUM-AFTER.json`, `TAP-PROFILE.json`, `OVERSCAN.json` (aynı `denseKit`,
aynı harness, aynı production build).

## Windowing'in gerçekten yaptığı

| | önce | sonra |
|---|---|---|
| mount edilmiş hücre | 1.792 | 154 (390px) / 126 (320px) |
| düğme | 1.811 | 173 / 145 |
| DOM düğümü | 3.775 | 441 / 385 |
| ızgarayı açma | 145 / 158 ms | 102 / 81 ms |
| scroller genişliği | 24.507 px | 16.891 px |
| **dokunuş (Playwright dışarıdan)** | **221 / 223 ms medyan** | **213 / 207 ms medyan** |

Son satır beklenen sonuç değildi. Çizim payının ~185 ms olduğu tahmini —
yukarıdaki "1. bölüm"de yazılı — **yanlıştı**. DOM'un %88'i gitti, dokunuş
~10 ms kısaldı.

Bir de sayaç düzeltildi: window hook'unun ilk hâli her düzenlemede scroll
dinleyicisini ve ResizeObserver'ı yeniden kuruyordu (46 dokunuşta 72 observer
kurulumu). Eksen artık callback'in içinden ref üzerinden okunuyor; sayaç
38'e indi, windowing öncesi taban 35'ti.

## Nerede olduğu, tahminle değil profil ve ikinci fixture'la

`profile-tap.mjs` iki şey ölçtü. Birincisi dokunuşu **sayfanın içinden**
(`click()` → iki rAF), yani Playwright'ın kendi actionability maliyeti
dışarıda: `denseKit` üzerinde **166–182 ms medyan**. Yani dışarıdan ölçülen
~210 ms'nin ~40 ms'i harness'ın kendisiydi; önce/sonra karşılaştırması yine
geçerli, ama mutlak sayı bu.

İkincisi belirleyici oldu: **aynı ızgara, küçük bir şarkı.** `practiceSong`
(3 track, 13 ölçü, çoğu 1/8) ekrana 88 hücre mount ediyor — `denseKit`'in
154'üyle karşılaştırılabilir bir çizim yükü.

| fixture | mount edilen hücre | sayfa içi dokunuş |
|---|---|---|
| denseKit @390 | 154 | 182,0 ms medyan / 231,1 p95 |
| denseKit @320 | 126 | 166,0 ms medyan / 222,7 p95 |
| **practiceSong @390** | **88** | **30,8 ms medyan / 52,5 p95** |

Ekranda neredeyse aynı sayıda hücre var; maliyet **beş kat** farklı. Demek ki
dokunuşun maliyeti **mount edilen hücreye değil, şarkının büyüklüğüne**
bağlı — komut + merkezî kapı + kalıcılık zinciri, yani her düzenlemenin
ödediği ve §6'nın gevşetilmesini açıkça yasakladığı yol.

CPU profili bunu doğruluyor: tepe self-time %5 çöp toplayıcı, sonrası %2'nin
altında dağınık minified fonksiyonlar. Tek bir sıcak nokta yok; çok sayıda
tahsis var — şarkının klonlanması, `songSchema` parse'ının yeni nesne üretmesi,
validator'ların her track'i gezmesi, `setItem` için `JSON.stringify`.

## §6 hedefi karşısında dürüst durum

Hedef `≤33 ms median / ≤50 ms p95`.

- **Gerçekçi bir şarkıda karşılanıyor**: `practiceSong` 30,8 ms medyan.
  p95 52,5 ms hedefin 2,5 ms üstünde.
- **Sözleşme tavanında karşılanmıyor**: `denseKit` 166–182 ms.
- Bu bir windowing eksiği **değil**. Windowing'in ulaşabileceği pay çizimdi ve
  o pay ölçüldüğünde ~4 ms çıktı. Kalanı merkezî kapı ve kalıcılık zinciridir;
  onu ucuzlatmak validator atlamak, atomikliği kaldırmak veya yazmayı
  ertelemek demek olurdu. Hiçbiri yapılmadı, sonuç da gizlenmiyor.
- Sonraki iş için doğru hedef ızgara değil, **düzenleme zincirinin şarkı
  büyüklüğüne bağlı maliyeti**dir. 2R-A kapsamında değildir.

## Overscan: seçilen değer artık ölçülmüş

`OVERSCAN.json`: beş aday × iki viewport × iki commit gecikmesi × üç hareket
(hızlı fling ileri, fling geri, yavaş sürükleme), `denseKit`'in dört bölümü ve
`practiceSong`'un dört bölümü üzerinde.

- `0 + 0` ve `0,25 + 0,25` **boş kare üretti** (en kötüsü 120 px boş şerit).
  Harness'ın boşluğu görebildiğinin kanıtı bu; hepsi geçseydi hiçbir şey
  ölçülmemiş olurdu.
- Boş kare üretmeyen en ucuz aday **`behind: 0,5 / ahead: 1`**, en fazla
  **120 hücre** mount ederek. `1 + 1` aynı temizlikte ama 144 hücre,
  `1 + 2` 160 hücre.
- Kod bu değeri tek merkezî yerde tutuyor: `DRUM_GRID_OVERSCAN`.

Bütün sayılar masaüstü Chromium ve Node'dandır. **Fiziksel telefon kanıtı
değildir.**

---

# 3. Aşama aşama teşhis ve davranış-korumalı kazanç

`EDIT-COST-BREAKDOWN.json` (Node, 8 ısınma + 30 tur) bir davul dokunuşunun
gerçekten geçtiği yolu üretim kodundan okuyup her adımı ayrı ölçtü.

## Sözleşme tavanında bir dokunuş (denseKit, 218 KB, 1.792 hücre)

| aşama | medyan |
|---|---|
| komut (`insertDrumHit`, `settle` dahil) | 31,6 ms |
| — strict schema | 5,1 ms |
| — merkezî validator zinciri | 24,1 ms |
| store'un **ikinci** schema parse'ı | 5,1 ms |
| aynı-müzik kontrolü | 2,4 ms |
| history adımı | 0,001 ms |
| serialize | 1,1 ms |
| fiziksel yazma | 1,1 ms |
| **arrangement modeli** | **22,4 ms** |
| **playback planı** | **6,7 ms** |
| **multi-track modeli** | **5,9 ms** |
| davul grid modeli + ekseni | 0,34 ms |

Gerçekçi şarkıda (practiceSong, 17 KB) aynı sıra: komut 4,4 · gate 2,1 ·
arrangement 1,5 · plan 0,4 · multi 0,29 ms.

## Bulunan gerçek tekrar

Dokunuş tab yüzeyindeyken **arrangement modeli ve multi-track modeli yeniden
kuruluyordu**. İkisi de ekranda değildi. Sebep basit: her ikisi de `song`
üzerine memoize edilmiş, commit yeni bir `song` üretiyor, `useMemo` bağımlılık
değişince *okunmasa da* hesaplıyor.

Bu, §IV'ün adını koyduğu "ilgisiz arrangement/tab modelinin davul dokunuşunda
yeniden hesaplanması" sınıfının tam kendisi.

Düzeltme davranış-korumalı: memo artık değeri değil **thunk'ı** tutuyor
(`lib/ui/lazy-value.ts`). Aynı `song` ile aynı fonksiyon çağrılıyor, aynı model
dönüyor; değişen tek şey *ne zaman* kurulduğu — çizen dal render edildiğinde,
en fazla bir kez. Gevşetilen kapı yok: schema, validator, atomiklik, history ve
yazma yolunun hiçbirine dokunulmadı.

## Sonuç, sayfa içinden ölçülmüş (click → iki rAF)

| fixture | önce | sonra |
|---|---|---|
| denseKit @390 | 182,0 / 231,1 ms | **131,5 / 201,4 ms** |
| denseKit @320 | 166,0 / 222,7 ms | **130,8 / 203,4 ms** |
| practiceSong @390 | 30,8 / 52,5 ms | **31,4 / 36,2 ms** |

Playwright'ın dışarıdan ölçtüğü sayı da aynı yönde: 213/207 → 179/174 ms
medyan.

## §IV hedefleri karşısında

- Gerçekçi medyan hedefi `≤33 ms`: **31,4 ms — geçti.**
- Gerçekçi p95 hedefi `≤50 ms`: **36,2 ms — geçti.** Ara raporda 2,5 ms ile
  kaçan p95 bu değişiklikle kapandı.
- Sözleşme tavanı: **131 ms — kapanmadı.** Kalanının ~30 ms'i merkezî kapı
  (5,1 + 24,1) ve ~7 ms'i playback planıdır; üçü de gevşetilmesi yasak
  yollardır. Geri kalanı React reconciliation, DOM ve paint'tir.
- Keyfî yeni tavan eşiği uydurulmadı.

## Bakılıp reddedilen ikinci aday

`settle()` bir `songSchema.safeParse` çalıştırıyor, `songStore.commit()` aynı
nesne üzerinde bir tane daha: tavanda 5,1 ms. Kaldırılmadı. Store'un parse'ı
`settle`'dan geçmeyen çağıranlar için gerçek bir kapıdır ve nesne kimliğine
dayalı bir önbellek, doğrulamadan sonra mutasyon olmadığı varsayımını runtime
garantisi olmadan kabul etmek olurdu. Ölçüldü, kaydedildi, dokunulmadı.

Bütün sayılar masaüstü Chromium ve Node'dandır. **Fiziksel telefon kanıtı
değildir.**
