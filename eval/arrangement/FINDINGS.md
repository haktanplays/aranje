# Faz 2J — Arrangement Overview: doğrulama bulguları

Bu belge 2J'nin ne ölçtüğünü ve ne bulduğunu kaydeder. Yeşil bir listeden çok,
yeşile giden yolda kırılan dört şeyin kaydıdır.

## Neden ayrı bir fixture

Demo şarkı bu kontrol noktasını **çalıştıramaz**: kısadır, tek ölçülüdür, ne
tekrarlanan bir barı ne de bar çizgisini aşan bir notası vardır — yani genel
görünümün var olma sebebi olan üç şeyin üçü de yoktur.

`fixture-song.json` her özelliği bir senaryo istediği için taşır:

| | |
|---|---|
| 32 bar × 8 track | 256 hücre; performans iddiasının konusu olan büyüklük |
| Dört bölüm, ikisi kendi temposunda | tempo basamağının çizileceği bir sınır |
| 3. bölüm 6/8 | dar bar geniş barın yanında; kural görünür olur |
| Bir bölüm içinde 1/8, 1/12, 1/16 | hepsi aynı genişlikte; en kolay kırılan kural |
| Baştan sona susan bir track | "Sessiz", sahte nota değil |
| Birebir tekrar | 1. ve 3. ölçü aynı |
| Bölüm dikişini aşan tie | section sınırı bağlantıyı kesmemeli |
| Bölüm dikişini aşan hammer-on | aynı, legato tarafında |

## Dört kusur

Üçü yalnız gerçekten render edilerek görülebilirdi; dördüncüsü yalnız bu
büyüklükte bir şarkı yüklenerek.

### 1. 320×700'de arrangement'a 40 piksel kalıyordu

Sekiz lane'den birini bile göremiyordunuz. Altındaki kontroller — tab'ın track
özeti, track seçici, düzenleme anahtarı — **tab'ın seçili track'ini** anlatır;
arrangement zaten her track'i kendi adı ve enstrümanıyla gösterir. Onlar tab'ın,
artık tab ile birlikte görünüyorlar.

```
önce : MAIN h=40    (chrome 660px)
sonra: MAIN h=274   (320×700) · h=443 (390×844)
```

### 2. Bekleyen bir hareket okuyucuyu tab'da hapsediyordu

Sheet'in perdesi ekranı z-30'da kaplıyor ve görünüm değiştiriciyi de kaplıyordu:
bir nudge staged iken **hiçbir yüzeye** geçilemiyordu — tek çıkış, kararmış alana
dokunmanın onu kapattığını fark etmekti. Ana gezinme, geçici bir düzenleme
sayfasının hapsedebileceği bir şey değildir. Şerit artık onların üstünde.

Bu aynı zamanda spec'in «Açık TransformSheet kapanır ve hiçbir pending preview
commit edilmez» garantisini **ölçülebilir** hale getirdi; önce ulaşılamadığı için
doğrulanamıyordu.

### 3. Hiç çalınmamışken bir bara dokunmak hiçbir şey yapmıyordu

Ses motoru ilk `play`'de kurulur, çünkü tarayıcı bir kullanıcı jesti dışında
audio context açmaz. O ana kadar `seekToBar`'ın tick yazacağı bir transport yoktu
ve isteği **sessizce atıyordu**.

Ölçüm:

```
taze sayfa                         ticks=0
27. ölçüye dokun (hiç çalınmamış)   ticks=0        <-- kayboldu
Çal                                ticks=277  bar=intro:0   <-- baştan
motor varken aynı dokunuş          ticks=18432 bar=outro:2  <-- doğru
```

Yani taze açılan bir şarkıda 27. ölçüye dokunup Çal'a basmak müziği **1.
ölçüden** başlatıyordu. Seek artık hatırlanıyor ve motor doğduğunda uygulanıyor.

### 4. Bir barda susan track, bütün bölümde düzenlenemiyordu

Büyük fixture, 2I-A çekirdeğinde fazla geniş bir reddedişi ortaya çıkardı:
`canvasOf`, bölümün **herhangi** bir barında track anahtarı yoksa `null` dönüyor
ve o bölümdeki **her** düzenlemeyi kilitliyordu — üstelik hata mesajı, orada
apaçık yazılı olan bir track için "bu bölümde yazılı değil" diyordu.

Bir bar susan gitar sıradan bir şeydir. Reddediş bölümden **seçime** taşındı:

- yazılmamış bara **uzanan** seçim → hâlâ `track_silent_here`
- uzanmayan seçim → düzenlenir

Geri yazma da artık yok olan barları boş diziyle doldurmuyor: yokluk kontratın
bir ifadesidir (§5.5) ve commit onu sessizce başka bir ifadeye çeviremez.

Bu değişiklik **mevcut bir testi kırdı** — "yazılmamış bara uzanan seçim
reddedilir" — ve doğrusu buydu: kırılma, reddedişi çok geniş bir yerden çok dar
bir yere taşırken bir an fazla daralttığımı gösterdi. Üç yeni regresyon testi
eklendi.

## Ölçülen değerler

| | 390×844 | 320×700 |
|---|---|---|
| Arrangement yüksekliği | 443px (8 lane tam) | 274px (~6 lane, dikey kaydırma) |
| Render edilen hücre | 256 | 256 |
| Lane | 8 | 8 |
| Gövde yatay taşması (her iki modda) | 0px | 0px |
| Yatay scroller (her modda) | 1 | 1 |
| 44px altı dokunma hedefi | 0 | 0 |
| Konsol/sayfa hatası | 0 | 0 |
| `AudioContext` yapımı (3 görünüm değişimi sonrası) | 1 | 1 |

Model: **22.1 ms**, 256 hücre, 2880px toplam genişlik.

Genişlikler ölçüden geliyor: 4/4 → 96px, 6/8 → 72px, her resolution'da aynı.

## Performans

256 hücre için ölçüldü (390×844):

| | |
|---|---|
| Model kurulumu | **22.1 ms** |
| Render edilen hücre | 256 (32 bar × 8 track) |
| DOM düğümü | 1199 |
| Hücre başına DOM listener | **0** |
| Sayfadaki en kalabalık listener tipi | 6 (React kök delegasyonu) |
| `scroll` listener (tümü) | 3 — biri bu görünümün |
| Bu görünümün kurduğu observer | 0 (sayfadaki 2'si Next.js'in) |

Sanallaştırma **eklenmedi**: 256 hücre bunu gerektirmiyor ve yalnız ölçek
göstermek için eklemek, olmayan bir sorunun çözümünü koda sokmak olurdu.
Playhead tek bir `requestAnimationFrame` döngüsüyle ve yalnız transport çalarken
sürülüyor; sütun `transform` ile taşınıyor, yani çalan bir bar hiçbir render'a
mal olmuyor.

## Vacuity probe

12 probe, 12 kırmızı, 0 vacuous. Altısı birim testine, altısı gerçek tarayıcıya.

Bir probe **yanlış seçilmişti**: görünüm üçlüsünü `true` ile değiştirmek derlenmiyor,
çünkü tab dalı daralma için o koşula dayanıyor — yani build, scroller'larla
ilgisi olmayan bir sebeple düşüyordu. Harness bunu "geçti" diye değil
`BROKEN <-- the mutation does not build` diye raporladı; probe gerçekten ikinci
bir scroller üreten bir mutasyonla değiştirildi (1 → 9 scroller).

## Açık UX sınırları

- **320×700'de seçim ve arrangement aynı anda dar.** Sekiz lane 352px ister,
  ekranda 274px var; gerisi dikey kaydırmayla gelir. Bu ölçülmüş bir takas.
- **Tekrar göstergesi hücrede kısaltılır.** 6/8 hücresi 72px'dir ve
  «1. ölçü ile aynı» cümlesi sığmaz; hücre `= 1. ölçü` gösterir, tam cümle
  erişilebilir adda ve tooltip'tedir.
- **Playhead takibi elle kaydırınca durur ve yeniden Çal'a basılınca döner.**
  Görünümü geri çağıran ayrı bir kontrol yok; bu bilinçli, çünkü bu checkpoint
  çalışmayan veya gelecek faza ait düğme eklemiyor.
- **Tekrarlayan bir track'te gösterge her barda görünür.** Bas her ölçüde aynı
  şeyi çalıyorsa otuz bar «= 1. ölçü» der. Doğrudur ve sessizdir, fakat yoğundur;
  tekrar **koşularını** tek bir işaretle özetlemek 2J.1'in arrangement işiyle
  birlikte ele alınmalıdır.
