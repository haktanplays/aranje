# Faz 2I-B — Mobil seçim ve dönüştürme UI'ı: doğrulama bulguları

Bu belge 2I-B'nin tarayıcı doğrulamasının **ne ölçtüğünü** ve **ne bulduğunu**
kaydeder. Yeşil bir listeden çok, yeşile giden yolda kırılan üç şeyin kaydıdır;
çünkü asıl bilgi orada.

## Neden ayrı bir fixture

Demo şarkı bu kontrol noktasını **çalıştıramaz** ve bu bir hata değil, şarkının
kendisidir:

- Barları baştan sona yazılıdır. Her zaman hedefi doludur, yani hiçbir zaman
  taşıması mümkün değildir ve "her commit tek yazma" kuralının inebileceği bir
  yer yoktur. (24 grid adımı iki yönde de arandı; boş hedef yok.)
- İçinde power chord yoktur, yani akorun grup olarak seçilmesi denenemez.
- Alternatif akort ve capo içermez, yani `restring_same_pitch` ve
  `translate_fret_shape` için "bu şekil bu akortla çalınamaz" durumu doğmaz.

`fixture-song.json` bunun için yapıldı: üç track (standard, Drop D, capo 2
akustik), dört bar (grid 8 / 16 / 12 / 8), bir power chord ve gerçek suslar.
Uygulama onu **kendi normal yolundan** yükler — fixture, sayfa açılmadan önce
`aranje.song` anahtarına yazılır ve hiçbir production kodu testin varlığından
haberdar değildir.

## Ölçüm neye bakıyor

Ekrandaki duruma değil, **şarkıya ve depoya** bakar. Her koşuda
`Storage.prototype.setItem` uygulama kodunun ilk satırından önce sarmalanır, bu
yüzden yazma sayıları uygulamanın gerçekten yaptığı yazmalardır. Undo, DOM'a
değil, depodan okunan şarkının **bayt bayt aynı** olmasına bakar.

## Üç kusur

Üçü de yalnız gerçekten render edilerek görülebilirdi. Saf birim testleri
üçünü de yeşil geçirdi ve geçirmeye devam ederdi.

### 1. Bir basış, iki seçim modeli

2E'nin akor-grubu seçimi kendi 400ms eşiğini tutuyordu; zaman seçimi paylaşılan
500ms'yi kullanıyordu; ikisi de aynı hücrelere bağlıydı. Bir onset üzerinde tek
bir basış **altı hücreye yeşil grup halkası ve aynı anda zaman bandı** çizdi —
tek parmağa iki farklı cevap, iki farklı eşikte.

Ölçüm: `23 one press selects one way` — basıştan sonra `[data-group-selected]`
sayısı. Kusurluyken 6, düzeltmeden sonra 0.

Karar: basışın sahibi, canlı olduğu her yerde **zaman seçimi**dir. Akor seçimi
jesti yalnız zaman seçiminin kapalı olduğu yüzeylerde korur. Eşik tek dosyada.

### 2. Harcanmış basışın arkasında kalan canlı click

Biten bir dokunuş click üretir ve tarayıcı bunu **parmağın indiği anda altında
olan** öğeye yöneltir — parmak inerken orada olana değil. Basışın az önce açtığı
araç çubuğu bu yüzden parmağın altına düşen düğmeye click aldı.

Olay dizisi, 320x700'de, gerçek dokunuşla ölçüldü:

```
pointerdown -> BUTTON{cell 4:0} @187,226
touchstart  -> BUTTON{cell 4:0} @187,226
pointerup   -> BUTTON{cell 4:0} @187,226
touchend    -> BUTTON{cell 4:0} @187,226
click       -> BUTTON[selection-action-move] @187,226   <-- aynı nokta, başka öğe
```

Yani: tab'ın alt yarısındaki bir notayı seçmek **taşıma sayfasını kendiliğinden
açıyordu**. 390x844'te görünmüyordu, çünkü orada araç çubuğu parmağın altına
denk gelmiyor. Viewport'a bağlı olması onu daha az gerçek yapmaz.

Ölçüm: `23 press alone opens no sheet` — basıştan sonra `[role=dialog]` var mı.
Kusurluyken "Taşı", düzeltmeden sonra yok.

### 3. Yedi adet 44px hedef 320px'e sığmaz

Boşluk ve padding ile 348px ister. Tek sıra sığıyordu — her düğmeyi **40px
genişliğe** indirerek. Gerçek 320px viewport'ta böyle ölçüldü.

**Bunun tam yeşil bir koşudan sağ çıkmasının nedeni ölçümün kendisiydi:** kontrol
yalnız yüksekliğe bakıyordu ve o 40px genişliğindeki düğmelerin hepsi 44px
yüksekliğindeydi. Kontrol artık iki boyutu da ölçer.

Karar: vazgeçilecek şey satır sayısıdır, dokunma hedefi değil. Dört sütun, iki
satır. Sütun sayısı viewport'a göre değişmez — telefondan telefona yer değiştiren
bir araç çubuğu, bakmadan bulunması gereken yedi düğme için doğru şey değildir.

## Ölçülen değerler

| | 390x844 | 320x700 |
|---|---|---|
| Seçim özeti | `1 power chord şekli · 1 ölçü` | `1 power chord şekli · 1 ölçü` |
| En küçük eylem düğmesi | 91x44 | 73x44 |
| Taşıma modu kartları | 44px (dördü de) | 44px (dördü de) |
| Gövde yatay taşması (sayfa açıkken) | 0px | 0px |
| Yatay scroller sayısı | 1 | 1 |
| Konsol hatası | 0 | 0 |

Yazma sayıları (hepsi gerçek `setItem` sayımı):

| Eylem | Yazma |
|---|---|
| Kopyala | 0 |
| Ghost preview (N nudge) | 0 |
| Vazgeç | 0 |
| Reddedilen taşıma | 0 |
| Sil | 1 |
| N nudge + Uygula | 1 |
| Şekil taşıma + Uygula | 1 |
| Çoğalt | 1 |
| Geri al | şarkı bayt bayt aynı |

## Harness'ın kendi kusurları

Bunlar uygulamanın değil, ölçümün kusurlarıydı ve hepsi uygulamayı bozukmuş gibi
gösterdi. Kayda geçiyorlar çünkü bir sonraki koşuda tekrar edilmemeleri gerekir.

- Playwright'ın mouse API'si dokunmatik emülasyonda `pointerdown` üretmiyor —
  jest kontrolleri boşluğa çalışıyordu. CDP `Input.dispatchTouchEvent`'e geçildi.
- `pgrep -f "next-server"` kendi kabuğunu eşleştirip ebeveynini öldürüyordu;
  koşu ortasında bir hang gibi görünüyordu. Bracket kalıbı (`'[n]ext-server'`).
- Sunucu eski bir build'i servis ediyordu. Build damgası artık doğrulanıyor.
- Sonuçlar yalnız koşunun sonunda yazılıyordu: takılan bir viewport, ondan önce
  geçen kırk kontrolün kaydını da götürüyordu. Artık her kontrolden sonra yazılır.
- Bir viewport'un hatası diğerini de düşürüyordu; her viewport artık korumalı.
- İki viewport arasında tab kaydırması deterministik değildi — aynı senaryo iki
  farklı şeyi ölçüyordu. Basıştan önce `resetScroll`.
