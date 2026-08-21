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
