# 2S-A vacuity probes (§17)

A hundred and two mutations, each one a way a guarantee this checkpoint claims could be
quietly untrue, run against the tests that are supposed to hold it.

| Kind | Script | Probes | Red | Vacuous |
|---|---|---:|---:|---:|
| unit / AST | `probes.sh` | 80 | 78 | 2 |
| browser | `browser-probes.sh` | 16 | 16 | 0 |
| real audio / render | `audio-probes.sh` | 6 | 6 | 0 |
| **total** | | **102** | **100** | **2** |

Every mutation is the *dangerous behaviour*, never a syntax error. Three of the
first drafts only broke compilation or added dead code — they were rewritten
into real behaviour changes rather than counted, because a probe that only
breaks the build proves nothing about the test.

## What the first round found green, and what was done about it

Seventeen unit probes and six browser probes came back green the first time
they were run. None of them is hidden here; each is either a test that did not
exist and now does, or an equivalent mutation with the reason written down.

### Real gaps, now closed by a named test

| Probe | What was missing | Test added |
|---|---|---|
| 2 the room is measured on the note the finger leaves | the reported fixture puts the target one slot in, where the two readings are the same number | `expression-plan.test.ts` — "takes the travel from the note it lands on, not from the one it leaves" (target four slots in) |
| 6 negative room counts as room | nothing called `transitionSeconds` with a negative room | "treats a note with no room left as no room at all" |
| 19 the arc direction is read off the fret | on one string the fret order and the pitch order always agree — until a song says otherwise | `legato-arc.test.ts` — "believes the sounding pitch over the fret number" |
| 23 an arc crosses the bar line | `openStart` was never exercised | "draws nothing across a bar line" |
| 24 a silent bar still draws its arcs | `silent` was never exercised | "draws nothing in a bar that has no sound in it" |
| 26 the curve peaks at half the rise it claims | the path's control point was never read | "peaks at the rise it reports, not at half of it" |
| 35 a shape with a lower note under the finger | only one string and one size were checked | `power-chord-pen.test.ts` — "puts nothing under the finger, whichever string it lands on" |
| 42 an unreachable root is refused as an unrelated error | the refusal was asserted, its code was not | added to "refuses a root the fretboard cannot build a fifth above" |
| 45 auto reads the direction off the fret | the cross-string case refuses for a different reason first | `legato-brush.test.ts` — "follows the sounding pitch when the written fret disagrees with it" |
| 56 a count of nothing quietly does nothing | only `ok === false` was asserted | code and message added to "refuses a count of nothing" |
| 58 the shape move is done by transposing pitches | with `stringDelta: 0` the two produce the same song | `continue-pattern.test.ts` — "moves the hand across the strings even when the fret does not change" |
| 71 a 1/32 group is beamed as a 1/16 one | the label was only checked on a 1/16 group | `rhythm-guide.test.ts` — "says a thirty-second group is a thirty-second group" |
| 72 a group takes the deepest level | every note in the fixture had the same duration | "beams a mixed group at the shallowest note in it" |
| B5 the digit is painted into the 44px hit target | the cell was measured, the glyph's own box was not | acceptance scenario 62 — "the glyph's own box is smaller than the finger's" |
| B8/B9/B10 the row is sized in rem again | the layout tour ran at 390px only, and the clipping is a 320px fact | the browser probes now run the full viewport matrix |
| A5 a repeated pitch is dropped as inaudible | the arrival check had no claim about how many targets a fixture has | `check-audio.mjs` — "the slur it is written with is still a slur" |

### Equivalent mutations, kept and labelled

Two probes stay green because the mutation cannot change behaviour. Neither is
removed: a probe that is honestly equivalent is a fact about the code, and
deleting it would hide that fact from the next reader.

- **27 the chain depth never resets after a broken link.** The reset it removes
  is in the `no previous note on this string` branch. Reaching that branch means
  no arc has been drawn on that string yet, so the depth is already `0` and
  setting it to `0` changes nothing. The *other* reset — after a link whose
  direction disagrees with the pitch — is a real one, and probe 20 holds it red.
- **57 a move of zero takes a different path from an exact repeat.** The
  short-circuit it removes is an optimisation: `translate_fret_shape` with
  `0/0` gives back the same song the fast path does. The test that matters —
  "treats a move of zero as an exact repeat" — compares the two results byte
  for byte and would catch a real divergence.

### Rewritten rather than counted

Three first drafts were not valid probes and were replaced:

- `B7` first replaced `<LegatoArcLayer>` with an undefined component, which
  only broke the build. It now makes the layer render nothing.
- `A5` and `A6` first added an unused constant to `schedule.ts`, which changes
  nothing at all. They now filter repeated pitches out of the expression plan
  and turn a written slur into an ordinary attack — the two shortcuts §3
  forbids by name.

## The four added in §18

The regression sweep found a defect acceptance could not see: a row with the
right CSS height, painted outside the surface. Four probes now bind that
class, and two older ones were retargeted at the gaps they turned out to be
measuring nothing about.

| Probe | The dangerous behaviour it puts back |
|---|---|
| B13 | the normal chrome stays up while writing, so the staff loses its room again |
| B14 | the staff answers a cramped screen by growing a scroller of its own |
| B15 | six `44px` bands stacked `26px` apart — green on a height check, ambiguous under a finger |
| B16 | the way out of edit mode is not a control any more |

Retargeted rather than deleted:

- **B9** (the toolbar sized in rem) stayed green because no scenario measured
  the action row's own controls. Scenario **64.c** now does, and the probe
  runs against it.
- **B16**'s first form shrank "Bitti" to `12px` and nothing noticed, because
  the focused row had no scenario at all. **64** and **64.b** now hold the
  row, its accessible name, the section it says, and that the view switch has
  really stood down.

## Hygiene

- `.probebak` collision protection in all three scripts: a leftover backup
  aborts the run rather than racing another one.
- No parallel probe scripts; each mutates one file at a time and restores it
  before the next.
- `audio-probes.sh` rebuilds the render bundle after its last probe, so the
  bundle on disk is the committed sources' bundle rather than the last
  mutation's.
- After the runs: `git status --porcelain` shows only the intended files, no
  `*.probebak` exists anywhere, and `rg -n "PROBE" src scripts eval content`
  finds only `eval/shared/project-storage.mjs`'s own ledger key, which predates
  this phase.

## §18 sonrası eklenen iki probe

`73 an edit band shorter than a finger` — `EDIT_STRING_ROW_HEIGHT`'ı `26`'ya
düşürür. Hedefi `edit-geometry.test.ts`; beş iddiadan dördü kırmızıya döner.
Aynı test dosyası ikinci hileyi de tutuyor: 44 px bantları 26 px aralıklarla
üst üste bindirmek. Bu mutasyon test içindeki yığma modelini değiştirdiğinde
iki iddia kırmızıya dönüyor — yani "her eleman 44 px" kontrolünün yeşile
boyayabileceği iki yol da bağlı.

`74 the doors go back to hiding while a run is selected` — kapı satırını
yeniden `selection`'a bağlar. Hedefi `intent-boundary.test.ts`. Bu, §18'de
kendi yaptığım hatanın probe'u: Legato Fırçası seçili bir koşu üzerinde
kullanılır, dolayısıyla "Bağla" kapısı tam o anda erişilebilir olmalı.

## Kapanış turunda eklenen altı probe

`75-78` perde güncellemesini bağlıyor: articulation'ı düşürmek, geçersiz
bağlantıyı sessizce temizlemek, «koru» ile «kaldır»ı aynı şey saymak, ve
velocity'yi yeniden sıfırdan kurmak. Dördü de
`note-update-articulation.test.ts`'i kırmızıya çeviriyor.

`79-80` bütçe rezervasyonunu bağlıyor: kontrolün ve yazmanın tek atomik adım
olmaktan çıkması, ve rezervasyonun beş anahtarlık kritik bölgesinin
daraltılması.

**79 ilk turda yeşil geldi ve bu bir şey öğretti.** İlk mutasyon memory
store'un kuyruğunu kaldırıyordu; `run()` senkron olduğu için araya girecek bir
an yoktu, mutasyon davranışı değiştirmiyordu. İkinci mutasyon okuma ile yazma
arasına gerçek bir `await` koydu — o da yeşil kaldı, çünkü bariyer
**adapter'da** duruyordu ve bu pipeline'da birinci çağıranın rezervasyonu
ikincisi sormadan bitiyor. Yani test, atomikliği değil gözlenen sırayı
kanıtlıyordu.

Bariyer iddianın olduğu yere taşındı: ilk rezervasyon, ikincisi gelene kadar
tutuluyor ve ancak ondan sonra ikisi birden bırakılıyor. Gerçekten serileşen
bir store'da ikinci çağıran birincinin yazdığını görüyor ve reddediliyor;
yazmadan önce anlık görüntü alan bir store'da ikisi de boş bir gün görüp
sağlayıcıya ulaşırdı. Probe artık kırmızı.

## Technique Notation Grammar v1 — otuz bir aday, otuz kırmızı

Yayın turu 19–27'yi (eski `legato-arc.ts`) yeni `technique-geometry.ts`'e
taşıdı ve on beş yeni mutasyon ekledi: sahiplik slotunun komşularını unutması,
şeridin tabanının tel çizgisini temizleyip rakamı temizlememesi, rakam
genişliğinin bir slot sanılması, bend okunun miktarla büyümesi, sözleşmede
miktar yokken `½` uydurulması, slide'ın rakamları kaydırması, yön sabitlenmesi,
vibratonun süreyi ya da komşu rakamı yok sayması, palm mute'un her notaya `PM`
yazması ve rayın ilk susmamış notaya girmesi, sözleşmede olmayan bir tekniğin
mevcut bir articulation'dan taklit edilmesi, ve bir notanın hiç çizilmemiş bir
işareti sahiplenmesi.

Tarayıcı tarafında altı mutasyon `technique-visual.mjs`'i kırmızıya çeviriyor:
katmanın dokunuşları yutması, hiç çizilmemesi, işaretlerin staff'ı büyütmesi,
hiçbir şey seçili değilken vurgu rengiyle çizilmesi, şerit tabanının geri
alınması, ve bend'in kendi odasından taşması.

**Beşi ilk turda yeşil ya da atlanmış geldi; hiçbiri gizlenmedi.**

- `25` (sessiz ölçü) eşdeğerdi: fixture'ın span'i yoktu, dolayısıyla erken
  dönüşü kaldırmak hiçbir şeyi değiştirmiyordu. Fixture span taşıyacak şekilde
  değiştirildi — «sessiz» cevabı, ölçünün başka ne taşıdığına bakmaksızın
  kazanmak zorunda.
- `27g` (slide'ın rakam sınırları yerine slot merkezlerinden türetilmesi)
  eşdeğerdi: `SLIDE_MAX_PX` bağlayıcı olduğu için 34 px'lik slotta iki türetme
  aynı segmenti veriyordu. Asimetrik bir çift (`12 → 5`) üzerinde bağlayıcı
  olan iddia eklendi: bağlantı, birleştirdiği **rakamların** ortasındadır.
- `B17`'nin ilk mutasyonu (katmanın `absolute` yerine `relative` olması)
  **gerçekten eşdeğerdi ve bu kayda geçirilmiştir**: staff'ın yüksekliği
  `stringCount * rowHeight`'tır ve anotasyonlardan haberi yoktur, dolayısıyla
  akış içine giren bir çocuk onu büyütemez. Probe, asıl garantiyi soran bir
  mutasyonla değiştirildi — ya işaretler ölçüme dahil edilseydi?
- `B18` (her işaretin vurgu renginde çizilmesi) yeşildi çünkü kabul koşusu
  renkleri hiç iddia etmiyordu. Ekran başına ton disiplini eklendi: okuma
  ekranında sıfır vurgu, düzenleme ekranında en az bir vurgu ve en az bir gri.
- `B20` (bend'in kendi odasından taşması) yeşildi çünkü kabul koşusu **sahiplik
  slotunu ölçmüyordu** — yalnız ölçü çerçevesini soruyordu. Saf model her
  ilkelin `owner` aralığını artık DOM'a yazıyor ve kabul koşusu çizilen kutuyu
  o aralıkla karşılaştırıyor. Ölçüm eklenir eklenmez **gerçek bir kusur**
  buldu: ok başı çizgiden geniş olduğu için yarım bend slotunun sağ kenarını
  `2,6 px` aşıyordu. Baş için yer artık önceden ayrılıyor.

`27m` ilk yazımında bir **sözdizimi hatası** üretiyordu (kaçırılmış `&&`), yani
davranışı değil derlemeyi kırıyordu. Bu dosyanın kuralı gereği düzeltildi ve
gerçek bir davranış mutasyonuna çevrildi: vibrato dalgasının `sustain`'e de
çizilmesi.

## K-59 Visual Closure — altı tarayıcı mutasyonu, üçü ilk turda yeşil

`K1-K6` bu turun iki görsel kapanışını bağlıyor: yüksek seçim çubuğunun kompakt
olanın üstüne geri gelmesi, kapıların seçim açıkken satırını koruması,
düzenleme modundan ikinci bir çıkış yolunun geri gelmesi, staff'ın bölüm adını
ikinci kez söylemesi, kalemin yalnız kökünü önizlemesi ve yayın altındaki
alt çizginin geri gelmesi.

**Üçü ilk turda yeşil geldi ve üçü de kabul koşusunun kendi eksiğiydi.**
`K2`, `K3` ve `K4` mutasyonları ekranı gerçekten bozuyordu; kabul koşusu
bunların hiçbirini *sormuyordu* — yalnız altı telin görünürlüğüne ve scroller
sayısına bakıyordu, ve `320×700`'de kazanılan `212 px` bu üç bozulmayı da
yutacak kadar boldu. §4'ün üç kuralı artık cümle değil sayı olarak ölçülüyor:

- kapı satırı **yalnız** düzenleme açık ve seçim kapalıyken vardır;
- düzenleme modundan çıkış yolu ekranda **tam olarak bir** tanedir;
- bölüm adı **bir kez** söylenir — yazarken başlıkta, okurken staff'ta.

Ölçüm eklendikten sonra altı mutasyonun altısı da kırmızı.

**2S-A turunun dört senaryosu bu turun ürün kararlarıyla geçersizleşti ve
zayıflatılmadan güncellendi.** `8`, `10` ve `21` beşinci çipi (`data-composer-held`)
okuyordu; çip kaldırıldığı için artık tutan kapının kendisini okuyorlar —
çizilen kısa ad **ve** tam erişilebilir ad birlikte. `53` bağlı notayı alt
çizgiden tanıyordu; artık yayın çizildiğini **ve** alt çizginin bulunmadığını
birlikte istiyor, yani iddia gevşemedi, yer değiştirdi. Brush turu da seçim
açıkken kapıya değil `Bağla` düğmesine gidiyor: okurun gittiği yol o.
