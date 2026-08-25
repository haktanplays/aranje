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
