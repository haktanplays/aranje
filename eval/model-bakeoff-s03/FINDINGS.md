# S-03 bulgular

`transport_confounded_shadow_run`. Bu dosya koşu sırasında tutulur; sonradan
hatırlanarak yazılmaz. Hiçbir madde model kazananı ilan etmez.

## 1. Solo backing kör yazılıyor

`sourcesFor` (src/lib/copilot/arrangement-context.ts:70) `rhythm_guitar` için
yalnızca davulu kaynak gösteriyor: "The riff is written against the groove,
not against the lead's detail." Bu bilinçli bir tasarım ve riff bölümlerinde
doğru.

Ama Solo bölümünde ritim gitarının işi riff yazmak değil; kullanıcının kendi
sözleriyle "Solo backing'i lead'i örtmeden duyulabilir bırak". Model bu turda:

- lead'i göremiyor (rol kuralı gereği),
- davulu da göremiyor (Solo davulu bir sonraki turda yazılıyor).

Yani örtmemesi istenen partiyi hiç görmeden backing yazıyor. Bu bir model
hatası değil, arrangement-context sınırı. İki olası yön: Solo'da
`rhythm_guitar` için lead'i kaynağa eklemek, ya da tur sırasını rol yerine
bağımlılığa göre kurmak. Production'a bu koşuda dokunulmadı.

## 2. tuningIntent materialiser'a geçmiyor

Aday A blueprint'te "Drop-tuned low string for weight" istedi; materialiser
track'i standart E2 A2 D3 G3 B3 E4 ile kurdu. Model sonra Break'te D2 yazınca
`range` validator'ı haklı olarak reddetti (semantic_failure).

Model kendi planına sadıktı; plan ile kurulan enstrüman arasında bağ yok.
`tuningIntent` şu an yalnızca prompt metni; akort üretmiyor.

## 3. Articulation context uyarıları gerçek davranış

Turn 8'de iki `articulationContext` uyarısı: bağlanamayan hammer-on normal
çalınıyor. Sözleşme bunu hata değil uyarı sayıyor ve öyle kaydedildi.

## 4. Her iki aday da fence üretti

Şema düz metin olarak gittiği için iki aday da cevabı ```json içine sardı.
Provider tarafında şema tool definition/grammar olarak verilseydi bu mümkün
olmazdı. Bu yüzden fence bir model bulgusu olarak sayılmadı; koşunun
sınıflandırması da bu yüzden `transport_confounded`.

## 5. Baglam basligindaki bpm bolumun bpm'i degil

`prompt.ts:291` baglam satirina `request.song.bpm` yaziyor. Faz 2G'de bolum
bazli tempo geldiginden beri bu deger bir bolumun gercek temposu olmak zorunda
degil.

Acoustic Bridge turunda model su iki satiri birlikte gordu:

- `baglam`: `bpm: 138`
- `parcanin bicimi`: `sec-5 "Acoustic Bridge" 6 bar 116 bpm`

Ikisi celisiyor. Form satiri dogru, baslik yanlis. Model dogru olani secmek
zorunda kaliyor; nota suresi veya nefes hesabi yapan bir turda bu sessiz bir
hata kaynagi. Tek dogru deger `sectionTempo` olmali.

Production'a bu kosuda dokunulmadi; 2H-B yeni production ozelligi eklemiyor.

## 6. `harmony` rolu her zaman electric_guitar oluyor (en onemli bulgu)

Kullanicinin acik istegi: "Sonuna da temiz, sadece akustik bir Opeth
bridge/outro istiyorum. Davul yok, elektrik gitar yok; sadece akustik gitar
olacak."

Aday A bunu plani icinde dogru karsiladi. Blueprint'te `harmony` rolu icin
`presetIntent`: "Second clean acoustic voice, soft attack, upper register" ve
bu rol yalnizca `acoustic_bridge` ile `outro` bolumlerinde calisiyor.

Materialiser ise rol -> enstruman esleme tablosunu sabit tutuyor:

    rhythm_guitar   -> electric_guitar
    lead_guitar     -> electric_guitar
    acoustic_guitar -> steel_acoustic
    harmony         -> electric_guitar     <-- burasi
    drums           -> drum_kit

Sonuc: yalnizca akustik olmasi istenen kapanis bolumu bir elektrik gitarla
render edilecek. Bunu dinleme paketinde duyacaksiniz; uydurma degil, gercek
cikti boyle.

Bu bir model hatasi degil. Model dogru plani yazdi; `presetIntent` ve
`instrumentFamily` materialiser'a ulasmiyor. 2. bulgudaki `tuningIntent`
sorunuyla ayni kok: blueprint'in enstruman niyeti kuruluma gecmiyor.

Production'a bu kosuda dokunulmadi.

## 7. `harmony` eslik ettigi partiyi gormuyor

`sourcesFor` harmony icin `guitars.slice(0, 1)` aliyor — yani track listesinin
ILK gitarini. Acoustic Bridge'de bu `rhythm_guitar` ve o bolumde susuyor
(`-sus-`). Harmony'nin gercekten eslik ettigi `acoustic_guitar` kaynakta hic
yok.

Yani "ana gitari ortmeyen ikinci bir parti yaz" denen tur, ana gitari
goremiyor. 1. bulgunun akustik taraftaki esi: kaynak secimi sabit sirayla
degil, o bolumde gercekten calan partiye gore yapilmali.

## 8. 2H-B.1 sonrasi deterministik replay

Ayni blueprint, duzeltilmis materializer. Yeni model kosusu degildir ve model
kalitesi olcmez; yalnizca planin artik dogru uygulandigini gosterir.

| rol | once | sonra |
|---|---|---|
| rhythm_guitar | electric_guitar/high_gain | electric_guitar/high_gain |
| lead_guitar | electric_guitar/high_gain | electric_guitar/high_gain |
| acoustic_guitar | steel_acoustic/finger | steel_acoustic/finger |
| **harmony** | **electric_guitar/clean** | **steel_acoustic/finger** |
| drums | drum_kit/rock | drum_kit/rock |

Akustik bolumler: `violated before=true`, `after=false`. Her ikisi de artik
yalnizca steel_acoustic tasiyor.

Harmony kaynak baglami: once o bolumde susan ritim gitari, simdi
`gitar (acoustic_guitar)`.

14/14 tur yeniden uygulandi. WAV'lar `artifacts/replay-2h-b1/wav/`.
