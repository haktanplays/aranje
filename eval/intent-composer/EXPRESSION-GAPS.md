# 2S-A §10 · İfade envanteri ve açık boşluklar

Bu belge **önce envanteri** çıkarır, sonra ne yapılmadığını ve neden
yapılmadığını yazar. Tablo elle yazılmadı: `expression-inventory.ts` ürünün
kendi modüllerinden okuyup `EXPRESSION-INVENTORY.json`'a yazıyor, böylece
tablo tarif ettiği kodla ayrışamaz.

```
npx tsx eval/intent-composer/expression-inventory.ts
```

## Envanter

| İfade | Contract'ta | Yazılabilir | Çiziliyor | Duyuluyor | MIDI | Enstrüman |
|---|---|---|---|---|---|---|
| **sus (sustain)** | ✅ | ❌ | ❌ | ✅ (tam süre, `hold = 1`) | ❌ | her melodik |
| **palm mute** | ✅ | ✅ | ✅ (`PM`) | ✅ (`hold = 0,45` + filtre) | ❌ | her melodik |
| **staccato** | ✅ | ❌ | ❌ | ✅ (`hold = 0,35`) | ❌ | her melodik |
| **dead note (x)** | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| **ghost note (gitar)** | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| **muted strum** | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| **vuruş yönü (aşağı/yukarı)** | ❌ | ❌ | ❌ | ❌ | ❌ | — |

Karşılaştırma için, contract'ın **taşıdığı** ve bu fazın dokunduğu ifadeler:
`accent`, `vibrato`, `bend_half`, `bend_full`, `slide`, `hammer_on`,
`pull_off` — hepsi yazılabilir, çizilir ve duyulur.

**MIDI sütunu bütün satırlarda ❌ ve bu bir eksiklik değil, 2M-A'nın kaydedilmiş
kararıdır (K-50):** MIDI'nin kanal düzeyindeki tek aracı pitch bend'dir ve o da
kanalda çalan **her** notayı taşır; bir akorun tek notasına bend yazmak diğer
notaları da bükerdi. Uydurulmuş bir kural yerine hiçbir articulation
yazılmıyor.

## Ne yapıldı

İki satır, contract'ın zaten dürüstçe taşıdığı ama okurun ulaşamadığı
ifadelerdi:

- **`sustain`** duyuluyor (`hold = 1`) ama not sayfasında seçeneği yok ve
  tab'da işareti yok.
- **`staccato`** duyuluyor (`hold = 0,35`) ama aynı şekilde ulaşılamıyor.

Bunlar bu fazda **açılmadı**. Gerekçe aşağıda, "Neden şimdi değil" başlığında.

## Ne yapılmadı, ve neden

Dört ifade contract'ta yok: **dead note**, **gitar ghost note**, **muted
strum**, **vuruş yönü**. Hiçbiri gizlice eklenmedi ve hiçbiri çalışmayan bir
seçenek olarak ekrana konmadı. Sebep tek tek yazılıyor, çünkü dördü aynı
sebeple eksik değil.

### 1. Dead note, `sustain` değildir

Bir dead note **perdesiz bir vuruştur**: tel bastırılır ama basılı tutulmaz,
çıkan şey belirli bir perdesi olmayan bir "tak"tır. `sustain` ise notanın tam
süresini çalmasıdır. İkisini aynı alana yazmak, iki farklı şeye bir isim
vermek olurdu.

### 2. Boş bir slot dead note olarak çalınamaz

Contract'ta `null` **sessizliktir** (spec 5.4). Bir okurun yazmadığı yerde ses
çıkarmak, yazmadığı müziği çalmak demektir; K-55'in kaydettiği "yazılmamış =
yok" kuralının tam karşıtıdır.

### 3. Davulun `ghost`'u gitarın ghost note'u değildir

`drumHitSchema` `normal | ghost | accent` taşıyor ve bu **davul vuruşunun
sertliğidir**. Gitarın ghost note'u ise sol elin telin üstünde durup perdeyi
basmaması, yani perdenin kısmen ölmesidir. Aynı kelimeyi iki farklı fiziksel
olay için kullanmak, ikisinden birini yanlış çalmak demektir.

### 4. Perde zorunlu `NoteEvent`'e sahte perde yazılamaz

`noteEventSchema` `pitch`'i **zorunlu** tutuyor ve bu bilinçli: bir nota bir
sestir. Tab'da "x" çizmek için uydurulmuş bir perde yazmak, playback'e,
MIDI'ye, transpoze'a ve export'a var olmayan bir sesi vermek olurdu — ve o ses
her yerde gerçek bir nota gibi davranırdı.

### 5. Vuruş yönü yalnız UI metni olarak tutulamaz

Aşağı ve yukarı vuruş **kalıcı olmalı ve duyulmalıdır**: aynı akorun aşağı ve
yukarı vuruşu farklı sıralarla ve farklı zamanlamalarla tınlar. Yalnız
arayüzde bir etiket olarak tutulursa proje dosyasına girmez, export'ta yoktur,
ve bir sonraki oturumda kaybolur — yani söz verip tutmamak olur.

## Önerilen sorumluluk katmanı (uygulanmadı)

Dördü de aynı yere ait: **notanın nasıl seslendiği**, notanın kendisi değil.
Contract'ta bugün bunun tek yeri `articulation` ve o bir **tek değerli** alan
— bir nota en çok bir ifade taşıyor. Dördünü oraya sıkıştırmak, "palm mute +
yukarı vuruş" gibi gerçek ve sık bir kombinasyonu imkânsız kılardı.

Önerilen katman, uygulanmadan yazılıyor:

- **Perdesiz vuruşlar** (`dead note`) `NoteEvent`'in kardeşi bir slot türü
  olmalı, notanın bir bayrağı değil: perdesi olmadığı için `pitch`'i de yok.
- **Ghost note** ve **muted strum** bir *derece* meselesidir (ne kadar
  ölü), yani `velocity` gibi ölçülü bir alan ister, bir enum değil.
- **Vuruş yönü** notanın değil **vuruşun** (onset'in) özelliğidir: bir akorun
  altı notası tek bir yönle çalınır. Yani `MelodicSlot`'un kendisine ait bir
  alan, `NoteEvent`'e değil.

### Göç ihtiyacı

`songSchema` `strictObject` ve `version: 2`. Yukarıdakilerin herhangi biri
**şema sürümünü ilerletir** ve şunları gerektirir: eski dosyaların okunması,
proje dosyası içe aktarımının iki sürümü de kabul etmesi, ve fingerprint'in
değişmesi. Hiçbiri bu fazın işi değildir.

### Çok enstrümanlı etki

Dördü de "telli" kavramlar. Perdesiz enstrümanlarda (piyano, yaylı) dead note
ve vuruş yönü ya anlamsızdır ya başka bir şeydir; davulda `ghost` zaten
başka bir şeydir. Yani alanlar eklenirse **enstrüman ailesine göre
anlamlandırılmalı**, yoksa her enstrümanda görünen ama çoğunda çalışmayan
seçenekler ortaya çıkar.

## Neden şimdi değil

`sustain` ve `staccato` için kapı açmak tek başına küçük bir iştir; fakat
ikisini de açmak "ifade seçenekleri" listesini büyütür ve o liste **K-54'ün
mühürlü kör dinleme paketiyle aynı sistemi** paylaşır. K-54 açıkken production
bend/slide sistemine yeni ifade eklemek, Haktan'ın dinleyip karar vereceği
şeyin altını değiştirmek olurdu.

Bu yüzden §10 bu fazda **envanterle kapanıyor** ve genişleme **K-59'un açık
devamı** olarak kaydediliyor.

## Açık kayıt (K-59 devamı)

- `sustain` ve `staccato` contract'ta var, duyuluyor, ama yazılamıyor ve
  çizilmiyor. **Açık.**
- Dead note, gitar ghost note'u, muted strum ve vuruş yönü contract'ta **yok**
  ve bu fazda eklenmedi. Yukarıdaki katman önerisi uygulanmadı. **Açık.**
- Hiçbir çalışmayan seçenek arayüze konmadı ve hiçbir alan gizlice eklenmedi.
