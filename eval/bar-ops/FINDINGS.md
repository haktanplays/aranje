# Faz 2J.1 — Ölçü işlemleri: bulgular

Başlangıç noktası `20a749d`. Bu dosya, yalnız gerçekten çalıştırılarak
görülebilen şeyleri kaydeder: birim testinin göremediği kusurlar, boş çıkan
kontroller ve ölçümler.

## Gerçek uygulama kusurları

Üçü de tarayıcı koşusunda bulundu ve üçü de düzeltildi.

### 1. Reddediş, açıklaması gereken olayla birlikte yok oluyordu

Bölüm sınırını aşan bir zincir seçildiğinde çekirdek doğru davranıyordu —
seçim yapılmıyor, hiçbir şey yazılmıyor — ama mesaj action bar'ın **içinde**
render ediliyordu ve o action bar seçim olmadığında hiç render edilmiyor.
Sonuç: okuyucu seçimin sessizce kaybolduğunu görüyordu.

Mesaj bir seviye yukarı taşındı; artık seçimden bağımsız durur.

```
FAIL 15 a chain out of the section is refused outright — error="" actionBar=0
```

### 2. Handle sürükleyince seçim parmaktan kaçıyordu

Sağ handle'ı yarım bar sağa çekmek seçimi üç bara açıyor, uzun bir sürükleme
bölüm sınırını aşıp seçimi tamamen düşürüyordu. Sebep: her `pointermove`
mesafeyi **o anki** kenara ekliyordu, ama kenar seçim büyüdükçe kendisi de
kayıyor. Sürüklenen mesafe artık basıldığı anda alınan çapaya eklenir.

### 3. Sıradan boş bar "ritim aralığına oturmuyor" diye reddediliyordu

`track` kapsamı önce zaman seçimi çekirdeğinin üstüne kurulmuştu. Bu, müzik
hakkında doğru (bir track'in ölçü aralığı gerçekten bir zaman aralığıdır) ama
**veri hakkında yanlış** bir muhakemeydi ve iki şeyi birden bozuyordu:

- **Track anahtarı hiç olmayan bar** — yani okuyucunun içine yapıştırmak
  isteyeceği sıradan boş bar — tick akışında "yazılabilir" değildir, bu yüzden
  yapıştırma `target_grid_incompatible` ile reddediliyordu. Var olmayan bir
  sorun hakkında bir cümle.
- **Davul lane'inde hiçbir ölçü işlemi çalışmıyordu**: zaman seçimi melodiktir
  ve davulu hiç ifade edemez. Arrangement o lane'i çiziyor ve aynı uzun basma
  hareketini teklif ediyor — yani uygulama kendi kendisiyle çelişiyordu.

İki kapsam da artık **tam ölçülerle** çalışır ve `regridMelodic` /
`regridDrums`'ı paylaşır. Asıl kural değişmedi: hedef grid'in birebir ifade
edemediği bir an reddedilir, asla yuvarlanmaz (K-34). 49 birim testi
değişiklikten sonra da geçti; kusurları hiçbiri yakalamadığı için ikisi için
altı yeni test yazıldı (35 ve 36 numaralı gruplar).

## Boş çıkan kontroller (vacuity)

Üç tarayıcı probe'u yeşil döndü. Üçü de kontrolün yanlış yere nişan aldığını
söylüyordu; ikisi düzeltildi, biri gerçek bir bulguydu.

| Probe | İlk hâli | Neden yeşildi | Sonuç |
| --- | --- | --- | --- |
| 13 | `apply` iki kez commit etsin | İki commit **aynı** song nesnesini geçiyor; React ikincisinde bail-out yapıyor ve sayaç tek yazım görüyor. Store hakkında doğru, garanti hakkında ilgisiz. | Probe **önizlemeyi** commit ettirir hâle getirildi — "önizleme yazmaz" garantisi budur. Artık kırmızı. |
| 15 | Yapısal yazımdan önceki `pause()` silinsin | Song değişince controller zaten değişiyor ve transport her hâlükârda duruyor; hiçbir kontrol ikisini ayırt edemez. **Bu bir bulgu:** açık `pause()` niyeti belirtir, garantiyi tek başına o taşımıyor. | Probe aynı kuralın dişi olan yarısına çevrildi: **önizleme müziği durdurmamalı** (senaryo 27). Artık kırmızı. |
| 17 | Playhead taşıması silinsin | Senaryo playhead'i bar bir'de başlatıyordu — yerini kaybeden bir transport'un da duracağı yer. | Senaryo playhead'i **düzenlemenin olmadığı başka bir bölüme** taşıyor. Artık kırmızı. |

Kalan 15 probe ilk seferde kırmızı döndü. Toplam **18 probe, 18 kırmızı**.

## Ölçümler

390×844 ve 320×700, üretim build'i, `eval/bar-ops/fixture-song.json`.

| | 390×844 | 320×700 |
| --- | --- | --- |
| Çalışma alanı (action bar açıkken) | 473px | 329px |
| Ölçü işlemleri action bar'ı | 161px | 161px |
| Bar numarası şeridi | 44px | 44px |
| 44px altı dokunma hedefi | 0 | 0 |
| Yatay taşma | 0px | 0px |

Yazma ve undo sayımları (`Storage.prototype.setItem` sarmalanarak):

- Önizleme: **0 yazım, 0 undo girişi** (senaryo 7)
- Vazgeç: **0 yazım**, şarkı byte-eş (senaryo 8)
- Kopyala: **0 yazım** (senaryo 9)
- Uygula: **tam 1 yazım** (senaryo 10, 12)
- Reddediş: **0 yazım**, pano değişmez (senaryo 15)

Playback:

- Yapısal yazım sırasında kurulan AudioContext sayısı: **1 → 1** (senaryo 18)
- Playhead: `chorus:1` → `chorus:1` (± çalarken ilerlediği bar), yani düzenleme
  başka bir bölümdeyken konum korunuyor (senaryo 20)
- Önizleme sırasında transport: `playing` → `playing` (senaryo 27)

## Bilinen sınırlar

- **Yapısal işlemden önceki açık `pause()` ölçülebilir değil.** Song değişince
  `usePlayback` controller'ı zaten değiştiriyor. Satır niyet beyanı olarak
  duruyor, ama garantiyi taşıyan şey controller'ın yeniden kurulması.
- **Bir ghost, açık olduğu sürece arrangement'ı kilitler.** Yarı saydam çizim
  `pointer-events: none` taşır, çünkü içindeki barlar henüz yok. "Vazgeç"
  yüzeyi geri verir.
- **Pano bölümler arası taşınabilir ama seçim taşınamaz.** Bu sürümde bir
  ölçü seçimi tek bölümdedir (spec kapsam dışı listesi).
