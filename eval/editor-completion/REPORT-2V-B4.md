# 2V-B.4 — Founder Editor Completion

Başlangıç SHA `c11a7586c8cd1a716cb70abbe620c661f2827890`.
Branch `claude/proje-yorumları-n06wen`.

Bu tur yalnız mevcut kabul edilmiş playback yollarını kullanan editör UI/domain
çalışmasıdır. Yeni audible engine davranışı eklenmedi; **L11 oluşturulmadı ve
founder'dan tekrar ses testi istenmiyor.**

---

## 1. Commit tablosu

| # | SHA | Başlık | Kapsam |
|---|---|---|---|
| c1 | `78435a9` | Ship the fast-sequence and simple-rhythm editor in one shelf | §4 §5 §6 §7 §8 §10 §11 §12 §13 §14 §15 §16 §17 |
| c2 | `0e99ca7` | Lock what an edit may not touch, and what the shell may not become | §9 §13 §14 §15 §16 §17 §18 |
| c3 | *(bu commit)* | Measure the shell, walk the flow, and fix what walking it found | §3 §18 §20 |

Üçten fazla commit yok. Dördüncü bir "artefact" commit'i açılmadı.

## 2. Fiziksel ses otoritesi (§2) — kanonik kayıt

Founder'ın `s3777h1h8tp95` parçası üzerindeki gerçek cihaz sonucu, bu turun
başlangıç koşuludur ve **yeniden sorulmamıştır**:

| # | Konu | Sonuç |
|---|---|---|
| L1 | Gitar | PASS |
| L2 | Bas | PASS |
| L3 | Orta başlangıç | PASS |
| L4 | Pause/resume | INCONCLUSIVE (bloke etmez) |
| L5 | Slide | CONDITIONAL PASS (cila borcu) |
| L6 | Vibrato | PASS |
| L7 | Hammer-on / pull-off | CONDITIONAL PASS (cila borcu) |
| L8 | Power chord ve normal akor | PASS |
| L9 | Uzayan akorun loop dönüşü | PASS |
| L10 | Hızlı "9–10–9" | PASS |

L9 uzayan akorun her loop turunda devam ettiğini, L10 yerel ritim yoğunluğunu
ve bağlı çalımı doğrular. Bu turda L4/L5/L7 cila çalışması **yapılmadı**.

## 3. §3 — editörün ölçülmüş hâli, önce ve sonra

Altı viewport × iki jest (bir hücreye dokunuş, bir uzun basış). Ölçen:
`eval/editor-completion/inventory.mjs`. Ham veri:
`artifacts/INVENTORY-before.json` (SHA `c11a758`) ve
`artifacts/INVENTORY-after.json`.

Artefaktların içindeki `sha` alanı, koşucunun `/eval/` rota kapısını geçmek
için eline verilen commit kimliğidir; ölçülen ağaç bu commit'in ağacıdır.
Dördüncü bir commit açıp bu kimliği kovalamak §1 gereği yapılmadı.

| Viewport | Jest | Önce: grid görünür / hit / shelf / örtü / jargon | Sonra |
|---|---|---|---|
| 360×800 | tap | 320px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 174px · **grid** · 360 · 0 · — |
| 360×800 | long | 320px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 174px · **grid** · 360 · 0 · — |
| 384×692 | tap | 228px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 115px · **grid** · 311 · 0 · — |
| 384×692 | long | 228px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 115px · **grid** · 311 · 0 · — |
| 412×915 | tap | 320px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 237px · **grid** · 412 · 0 · — |
| 412×915 | long | 320px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 237px · **grid** · 412 · 0 · — |
| 740×360 | tap | 111px · **COVERED** · 139 · 2 · `slot`,`bar-n` | 111px · **grid** · 139 · 0 · — |
| 740×360 | long | 111px · **COVERED** · 139 · 2 · `slot`,`bar-n` | 111px · **grid** · 139 · 0 · — |
| 844×390 | tap | 141px · **COVERED** · 169 · 2 · `slot`,`bar-n` | 141px · **grid** · 169 · 0 · — |
| 844×390 | long | 141px · **COVERED** · 169 · 2 · `slot`,`bar-n` | 141px · **grid** · 169 · 0 · — |
| 1280×800 | tap | 320px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 191px · **grid** · 360 · 0 · — |
| 1280×800 | long | 320px · **COVERED** · 198 · 2 · `slot`,`bar-n` | 191px · **grid** · 360 · 0 · — |

**Önceki hâl, tek cümleyle:** bir hücreye dokunmak `FretSheet`'i açıyordu —
`fixed inset-0 z-30`, `max-h-[85dvh]`, başlığı **"Bar 1 · slot 1 · tel 1"** —
ve grid'in merkezi **on iki ölçümün on ikisinde de** hit testine cevap
vermiyordu. İlk yüzeyde dokuz nota değeri adı (birlik … otuz ikilik), bir
"Süre − ikilik +" step'çisi, dört ok, üç articulation satırı ve **iki** rakip
CTA vardı.

**Sonraki hâl:** on iki ölçümün on ikisinde `gridHit = grid`, **0** örtücü
overlay, **0** jargon, **0** çift adlandırılmış kontrol.

Dürüstlük notu: `before` ölçümü koşucunun ilk sürümüyle alındı. Bu turda
koşucuda iki değişiklik yapıldı — uzun basış noktası jest öncesinde yeniden
hesaplanıyor, ve çift-ad kontrolü *erişilebilir ad* üzerinden yapılıyor. İkisi
de bir ölçümü ancak **iyileştirebilir**; `before`'un başlığı olan
`gridHit = COVERED` sonucu ise ikisinden de etkilenmez, çünkü örtü tam ekran
bir sheet'ti. `before`'un `duplicateLabels` sayısı (`−×2 +×2 ikilik×2`) eski
metin-tabanlı ölçümdür ve yeni ölçümle birebir kıyaslanamaz.

Grid yüksekliğindeki düşüş bedeldir ve saklanmıyor: panel açıkken shelf
büyüyor. `.workspace-shelf` **`max-height: 45dvh` + kendi içinde scroll** ile
sınırlandı; panel bölgesi `max-h-[32dvh]`. Sınır konmadan önce ölçüldü:
384×692'de shelf `481px`'e, staff'ın görünür yüksekliği **`0px`'e** düşüyordu —
kaldırılan sheet'in öbür yönden geri gelmesi. Bu, bir birim testiyle
(`editor-shell-boundary` 61) bağlandı.

## 4. Gerçek kullanıcı akışı — Hızlı dizi, tarayıcıda uçtan uca

`eval/editor-completion/fast-sequence.mjs`, production rotası
`/eval/editor-action-batch`, 412×915, Android UA, dokunmatik. **18/18 PASS**
(`artifacts/FAST-SEQUENCE.json`):

1. Editör grid ekranda açılıyor (479px).
2. Bir hücreye dokunuş **Nota panelini shelf'te** açıyor — sheet değil.
3. Grid piksellerini koruyor (265px, 0 overlay).
4. `Ritim` → `Hızlı dizi` **aynı shelf'te** açılıyor.
5. Tam ekran sheet açılmıyor.
6. Tek satır açıklama: **"Aynı süreye 3 nota sığar; ölçünün uzunluğu değişmez."**
7. Perdeler founder'ın kendi koşusuyla başlıyor: **9-10-9**.
8. Üç sayı da sunuluyor ve yanıtlanıyor: `3:reddedildi 4:yazılabilir 2:yazılabilir`.
9. Ret **ekrandaki bir cümle**, sessiz gri düğme değil:
   *"Bu hız, bu ölçüdeki mevcut notalarla birlikte yazılamıyor."*
10. `Dinle` öneriyi **amber hayalet** olarak grid'e çiziyor (4 slot).
11. Grid ve seçenekler **aynı anda** ekranda.
12. Önizleme sırasında ölçü uzamıyor (2 ölçü · 3578px).
13. `Uygula` hayaletleri temizliyor.
14. Koşu porte üzerinde: `9,10,9,7,…`.
15. Ölçü sayısı ve genişliği değişmedi.
16. Grid hâlâ ana eleman.
17. **Tek undo bütün koşuyu geri alıyor** (6 glyph → 6 glyph, başlangıçla aynı).

**Kabul fixture'ında 3 notanın reddedilmesi bir kusur değil, §20(3)'ün ta
kendisidir.** Fixture'ın ölçüsü Straight 1/16 ve altında on altılıklarda bir
bas partisi var; iki notanın yerine üç nota bir **triplet**'tir ve bir ölçünün
tek ızgarası (K-34) hem on altılıkları hem tripleti tutamaz. Uygulama bunu
sessizce yuvarlamıyor, gizlemiyor, başka profile çevirmiyor — cümleyle
söylüyor. Founder'ın kendi `9–10–9`'u, 1/8 ızgaralı bir ölçüde uçtan uca
çalışır ve bu `sequence-write.test.ts` + `preserve.test.ts` ile kanıtlıdır.

## 5. Bu turda bulunan ve kapatılan üç gerçek kusur

Üçü de kabul koşusu sırasında ortaya çıktı; hiçbiri tahminle bulunmadı.

1. **Yerel sıklaştırma davullu hiçbir ölçüde çalışmıyordu.**
   `applySequenceWrite` melodik olmayan bir lane görünce `regrid_failed`
   dönüyordu — yani neredeyse her gerçek şarkının her ölçüsünde. `bar-regrid`
   zaten `regridDrums`'a sahipti ve çağrılmıyordu. Kit artık ölçüyle birlikte
   taşınıyor; ince ızgaraya oturmayan bir vuruş varsa **yine** reddediliyor.

2. **Teklif ile yazma farklı soruyu soruyordu.** `rhythmAvailability` doğru
   yazılmıştı — aday ızgaranın mevcut notaları *tam olarak* tutmasını şart
   koşuyor — ama hem panel hem komut ona yalnız **yazılan track'in** dolu
   anlarını veriyordu. Bir ölçünün tek ızgarası vardır: artık ikisi de
   ölçünün **bütün lane'lerini** veriyor. Sonuç: "sıklaştır" teklif edilip
   sonra reddedilen durum ortadan kalktı.

3. **"Üçe böl" var olan bir notaya uygulanamıyordu.** Komut dolu bir alana
   yazmayı reddediyordu, ama §6'nın fiili tam olarak var olan bir notayı
   bölmektir. `replaceExisting` eklendi ve **sınırı yazılı**: koşunun kendi
   aralığında *başlayan* notalar ve onları tutan bağlar gider; aralığa
   **dışarıdan** giren bir bağ varsa işlem reddedilir, kırpılmaz.

## 6. §9 — aynı ölçüdeki hedef-dışı veri

`src/lib/song/preserve.ts` sözleşmeyi bir **yol** olarak yazıyor (bu tickler,
bu track'ler) ve `breachesOutside` yolun dışında kımıldayan her olayı adıyla
sayıyor. Fixture bilerek kalabalık: sade bir nota, kendi velocity'si olan bir
nota, bağıyla tutulan uzun bir nota, iki sesli bir akor, articulation'lı bir
nota ve let-ring'li bir nota — hepsi koşunun yazıldığı **aynı ölçüde**.

- Koşu yerel sıklaştırma kullanıyor, yani ölçünün tamamı yeniden ızgaralanıyor.
- Yol dışındaki ihlal sayısı: **0**. Onset, uzunluk, perde, tel, fret,
  velocity, bağ, articulation, let-ring, akor üyeliği ve ses kimliği tick tick
  aynı.
- Vacuity kontrolü: yolun *içinde* önce 0, sonra 3 olay var — yani korunma
  iddiası hiçbir şey yapmayan bir edit üzerinden kurulmuyor.
- Üç negatif kontrol: kurcalanmış bir komşu `changed`, silinen bir nota
  `removed`, eklenen bir nota `added` — her biri **tam bir** ihlal üretiyor.
- `structureDigest` / `trackDigest` değişmiyor; tek istisna **beyan edilen**
  ölçünün çözünürlüğü, ve komşu ölçünün çözünürlüğünün değişmediği ayrıca
  ölçülüyor.

## 7. Phrase (§10, §11)

- `phrase-band.ts` `Section.phrases`'i barların çizildiği **aynı eksene**
  koyuyor; band staff'ın zaten sahip olduğu üst dolguya giriyor, yani grid
  yüksekliğinden **0px** alıyor ve hiçbir notanın üstünü kapatmıyor.
- Kimlik pencereye bağlı değil: dört farklı pencerede aynı `phraseId`,
  `phraseStartTicks`, `phraseEndTicks`; değişen yalnız `leftPx`. Zoom iki
  katına çıkınca `leftPx` ve `widthPx` tam iki katı, kimlik aynı.
- Grid sınırında **yeni phrase oluşmuyor**: üç farklı pencerede de tek fragment,
  şarkıda hâlâ tek phrase; ekranın dışına taşan tarafta chevron.
- Phrase ölçü sınırını aşabiliyor (2 ve 3 ölçüye dokunan örnekler) ve ölçüden
  kısa da olabiliyor.
- Bir phrase'e dokunmak **aralığını seçime veriyor**; phrase yerinde kalıyor.
  `Cümle` paneli tersini yapıyor: tutulan aralığı kalıcı bir bölgeye çeviriyor,
  müziğe **hiç dokunmadan** (`semanticSnapshot` bayt-eş), örtüşmeyi kırpmadan
  reddederek.
- Bu turda phrase editörü yazılmadı: sınır sürükleme, yeniden adlandırma, iç
  içe cümle yok.

## 8. Akor ve transpoze semantiği (§12–§16)

- **Tek isim otoritesi.** `Cm`, `C min`, `C minör`, `Cminor`, `C-`, `Cmoll`,
  `C m` → tek akor. `CM` majör, `Cm` minör kalıyor. `F#m` ve `Gbm` tek kimlik,
  şarkının tonuna göre yazılıyor. Gösterilen ad geri okunduğunda aynı akoru
  veriyor. Ölçü adı **"4. ölçü"**; `Bar 4` ve `slot` yasak ve testle bağlı.
- **Akor süresi niyet olarak**: `Bu vuruş` · `Ölçü sonuna kadar` ·
  `Sonraki akora kadar` · `Seçili alan boyunca`. Ham süre alanı yok; her
  seçenek her zaman listede, uygulanamayan gerekçesiyle gri.
- **Sesi taşı / Tonu değiştir ayrı.** Akorun her sesi aynı aralık kadar
  taşınıyor; ritim, bağ, es ve velocity değişmiyor; davul kiti bayt-eş;
  yalnız kapsamı **şarkı** olan bir değişiklik şarkının tonunu yazıyor —
  bir seçim, istense bile, yazamıyor.
- **Çalınabilirlik.** Dört oktav yukarı taşıma tek cümleyle reddediliyor ve
  reddin ardından şarkı bayt-eş. Taşınan her nota gerçek bir tel/perde
  taşıyor ve yazılan perde ile pozisyonun **duyulan sesi birbirini tutuyor** —
  yalnız MIDI sayısına bakan bir test bunu yakalayamazdı.

## 9. Kabul, doğrulama ve sayılar

| Kapı | Sonuç |
|---|---|
| `npx tsc --noEmit` | temiz |
| `npm run lint` | temiz |
| `npx vitest run` | **4.934 test / 303 dosya, hepsi yeşil** |
| Bu turda eklenen test | **+79** (`4.855 → 4.934`) |
| `npm run build` | başarılı |
| §3 envanter matrisi | 12/12 `gridHit = grid`, 0 overlay, 0 jargon, 0 çift ad |
| Hızlı dizi UI uçtan uca | **18/18** |
| `git diff --check` | temiz |

Satır bütçeleri:

| Dosya | Sonuç | Tavan |
|---|---|---|
| `Workspace.tsx` | **377** | 377 (değişmedi) |
| `ArrangementCanvas.tsx` | **470** | 470 (değişmedi) |
| `TabCanvas.tsx` | **475** | 480 |
| `EditArea.tsx` | **250** | 250 |

`TabCanvas`'ın `intent-boundary` içindeki iğnesi `472 → 478`'e taşındı ve
gerekçesi testin içine yazıldı: phrase bandı staff'ın üstünde çizilen yeni bir
şeydir, modeli ve markup'ı kendi iki dosyasında, buraya inen dört prop.
`workspace-boundary`'nin zaten kabul ettiği `480` tavanı bağlayıcı kalıyor.
**Composition root büyümedi:** `useEditIntent` `Workspace.tsx`'e değil,
commit'i ve preview motorunu zaten elinde tutan tab view'a kondu.

## 10. §20 — tanım gereği bitmiş sayılan akışlar

| # | Akış | Durum | Kanıt |
|---|---|---|---|
| 1 | `9–10–9` hızlı dizi: kur, dinle, uygula, geri al | ✅ | `fast-sequence.mjs` 18/18; `sequence-write.test.ts`; `preserve.test.ts` |
| 2 | Bir cümlenin grid/ölçü sınırının ötesine devam ettiğini görmek | ✅ | `phrase-band.test.ts` (chevron + kimlik), `PhraseBand` |
| 3 | Straight/Triplet ya da yerel sıklaştırma uyuşmazlığını anlamak | ✅ | ekranda cümle; `fast-sequence.mjs` adım 9 |
| 4 | Power chord'u mevcut kolaylığıyla eklemek | ✅ | dokunulmadı; `power-chord` paketi yeşil |
| 5 | Telleri tek tek doldurmadan normal akor yazmak | ✅ | `ChordPanel` (kök · tür · süre · şekil · Dinle · Ekle) |
| 6 | Akorun ne kadar süreceğini sade seçeneklerle söylemek | ✅ | `chord-span.test.ts` |
| 7 | Nota/akor/bölüm/şarkı transpozesi | ✅ | `transpose.test.ts` (13 test) |
| 8 | Grid boyunca ekranda kalıyor | ✅ | 12/12 `gridHit = grid` |
| 9 | Portre ve yatay aynı editör mantığı | ✅ | aynı `EditArea`/`EditorDock`; 740×360 ve 844×390 satırları |
| 10 | Hiçbir işlem hedefin dışındaki müziği sessizce değiştirmiyor | ✅ | `preserve.test.ts` (10 test, 3 negatif kontrol) |

## 11. Bilerek kapsam dışı bırakılanlar

Copilot, pattern/lick kütüphanesi, öneri sıralayıcı, beğeni telemetrisi, LLM
sağlayıcı, AI harness, büyük Pro workspace, keyfî 5/7 tuplet motoru, polimetre,
L4/L5/L7 ses cilası, yeni founder ses kabul harness'ı. Hiçbiri yazılmadı ve
hiçbiri için kullanılmayan bir soyutlama bırakılmadı.

## 12. Açık borçlar

- **Fiziksel cihaz kabulü yapılmadı.** Bütün sayılar masaüstü Chromium ve
  Node'dandır. §2'nin L1–L10'u bu turdan **önceki** gerçek cihaz koşusudur.
- Bir ölçünün tek ızgarası olduğu için, on altılık içeren bir ölçüye triplet
  bir koşu yazılamıyor. Doğru davranış budur ve okura söyleniyor; **fakat**
  founder'ın `9–10–9`'unu kabul fixture'ının o ölçüsünde yazamaz. Boş ya da
  1/8 ızgaralı bir ölçüde yazabilir.
- Panel açıkken grid yüksekliği düşüyor (360×800'de 320 → 174px). Sınırlar
  konuldu ve ölçüldü; hangi chrome'un daha geri çekileceği bir ürün kararıdır.
- `Cümle` yalnız adlandırma ve ad kaldırma yapıyor; sınır düzenleme yok.
- §3 `before` ölçümünün `duplicateLabels` sütunu eski koşucunundur (§3 notu).
