# 2V-C.1 — Guitar Expression Mechanics · teslim raporu

Giriş SHA `1190e11` (`HEAD == @{u}`, temiz ağaç, dokuz atanın hepsi mevcut).
Branch `claude/proje-yorumları-n06wen`. Üç ileri commit, dördüncü yok.

---

## 1. Giriş ve final SHA

Giriş: **`1190e11`**. Final: **bu commit** — üçüncü ve son ileri commit.
Tracked artefact'a yanlış bir SHA yazmaktansa sabit yazılmadı; SHA kapılı
tarayıcı koşuları `0014b39` build'i üzerinde yapıldı ve final build bu
commit'ten yeniden alınmıştır.

## 2. Commit tablosu

| # | SHA | Başlık | Kapsam |
|---|---|---|---|
| c1 | `274cc31` | Give a note three questions instead of one enum | §2 §3 §4 §5 |
| c2 | `0014b39` | Play the gestures, carry them across bar lines, and draw them | §6 §7 §8 §10 §11 §12 |
| c3 | *(bu commit)* | (editor + listening pack + evidence) | §13 §14 §15 §16 §17 §19 §20 |

## 3. Production'a giren exact schema

`NoteEvent`'e **iki isteğe bağlı alan** eklendi. Başka hiçbir alan
değişmedi; `articulation` enum'ı genişletilmedi.

```ts
pitchGesture?:
  | { kind: "bend" | "bend_release" | "prebend" | "prebend_release";
      targetCents: int 25..400;
      vibrato?: { startAfterTarget: true; depthCents: 1..100; rateHz: 1..12 } }
  | { kind: "slide_in";  from: "below" | "above"; approxSemitones?: 1..12 }
  | { kind: "slide_out"; to:   "down"  | "up";    approxSemitones?: 1..12 }

connection?: { kind: "hammer_on" | "pull_off" | "legato_slide" | "shift_slide" }
```

`targetCents` bir sayıdır, `half | full` enum'ı değil: bir sonraki aralık bir
sınır değişikliğine mal olur, şema göçüne değil. Bu turun basit editörü hâlâ
yalnız 100 ve 200 sunuyor. `startAfterTarget` **yalnız `true`** kabul eder —
"önce titret, sonra var" bir el hareketi değildir ve artık yazılamaz.

## 4. Legacy dual-read ve çakışma kuralları

`expression-resolver` üç ekseni ayrı ayrı okur:

| Eksen | Legacy kaynak | Açık kaynak |
|---|---|---|
| attack | `normal/accent/palm_mute/staccato/…` | — |
| pitch | `vibrato`, `bend_half`, `bend_full` | `pitchGesture` |
| connection | `hammer_on`, `pull_off`, `slide` | `connection` |

- Farklı eksenlerde iki değer **çakışma değildir**: accent + bend sıradan müzik.
- Aynı eksende iki kaynak **tipli retle** karşılanır, öncelikle çözülmez.
  Sessiz bir kazanan, dosyanın bir şey, hoparlörün başka bir şey söylemesidir.
- Reddedilen nota düz bir onset'e düşer ve `fallbackReason:
  "conflicting_expression"` taşır; ne perde hareketi ne bağlantı çalınır.

## 5. Eski bend/slide sesi nasıl korundu

**Çeviriyle değil, kendi yolunu koruyarak.** `bend_full` yazılmış bir nota
`{ source: "legacy" }` olarak çözülür ve planlayıcı onu **her zaman
kullandığı** `bendAutomation`'a yollar. `bend_release` en yakın yeni şekildir
ve "en yakın" "aynı" değildir, bu yüzden yeniden okunmuyor.

`legacy-expression.test.ts` sekiz legacy articulation'lı bir ölçüyü ölçüyor:
yarım ve tam bend tam olarak 100 ve 200 cent'e varıyor **ve ikisi de sonunda
sıfıra dönüyor**; vibrato yazılı perdenin etrafında; slide/hammer-on/pull-off
zincirleri hâlâ kuruluyor. Yanına bir gesture yazıldığında **diğer yedi
notanın planı bayt bayt aynı** kalıyor.

Eski `slide`, yeni modelde legato slide olarak *okunur* fakat çalınırken
zincire gider ve açık `legato_slide` ile **byte-eş zincir planı** üretir.

## 6. Her yeni bend türünün exact automation anlamı

| Tür | Başlangıç | Bitiş | Cümle |
|---|---|---|---|
| `bend` | yazılı perde | **hedefte kalır** | "tam bend, yukarıda tut" |
| `bend_release` | yazılı perde | yazılı perde | "tam bend ve geri indir" |
| `prebend` | **hedefte** | hedefte | "önceden tam bükülmüş" |
| `prebend_release` | **hedefte** | yazılı perde | "önceden tam bükülmüş, indir" |

Hedef **tam**: yarım 100, tam 200 — 97 ya da 205 değil. Köşeler sayıdır,
yalnız aralarındaki eğri yumuşatılır. 20 ms'lik bir notada bile negatif hold,
notanın dışına taşan automation ya da NaN üretilmiyor ve zaman geri akmıyor
(dört tür × dört süre, hepsi ölçüldü).

Bend + vibrato **tek bir gesture**: önce hedefe varır, sonra tepede titrer, ve
türünün söylediği yerde biter.

## 7. Legato ile shift slide arasındaki gerçek atak farkı

**Shift slide bir zincir değildir.** Zincir tam da hedefin *vurulmaması* için
vardır — tek bir ses bütün üyelerin içinden geçer — dolayısıyla zincire "hedefi
vur" demek ona zincir olmayı bırakmasını söylemektir.

- `legato_slide` → nota zincire girer (`chainRole: "target"`), transport onu
  ayrıca tetiklemez, hiçbir atak duyulmaz.
- `shift_slide` → nota **sıradan bir onset**'tir (`chainId` yok), transport onu
  her nota gibi vurur, ve seyahat kendi automation'ında taşınır: bir tam ton
  aşağıdan başlayıp kendi onset'inde yazılı perdeye varır.

İkisi aynı `transitionPoints("slide", …)` eğrisini kullanır, yani **fark
yalnız ataktır** — dinleme sorusunun adil olmasının koşulu budur. Gain hilesi
yok, ikinci scheduler yok, ikinci synth yok.

## 8. Slide-in/out Song'a hayali nota yazmıyor — kanıt

`gesture-take.test.ts` L14: her iki take'in kendi ölçüsünde
`buildExpressionPlan` **tam olarak bir nota** planlıyor. Elin nereden geldiği
ya da nereye gittiği automation'dır, portede ikinci bir onset değil.
`approxSemitones` bilerek yaklaşıktır: aşağıdan giren bir el daha aşağıda bir
yerden başlar, oyuncunun yazdığı bir perdeden değil.

## 9. Tie/bar/selection/pause/loop devamlılığı

**Yeni bir makine gerekmedi, ki asıl mesele bu.** Bir bend sıradan bir notanın
sıradan perde automation'ıdır; ölçü sınırını aşan bağlı bir nota tek bir
gesture taşıyan tek bir notadır, ve `activeVoicesAt` perdeyi zaten notanın
schedule edildiği automation'dan okur.

| Durum | Sonuç |
|---|---|
| Ölçü sınırını aşan tie | tek nota, tek gesture (`notes.length === 1`) |
| Sınırın yarım ölçü ötesinde pause · `bend` | **200 cent, hâlâ yukarıda** |
| Aynı anda · `bend_release` | 200'den küçük, inişte |
| Bir slot içinde · `prebend` | **200 cent, yükseliş duyulmadan** |
| Restore edilen automation | bulunduğu cent'ten başlar, türünün bitişinde biter |
| Loop wrap | aynı plan + aynı tick = **byte-eş cevap** |
| Selection penceresi sonu | devam doğal uzunluğundan kısa kesiliyor |

Bu turda `valueAt` iki yerde bulundu (`active-voices` ve yeni modülde
`centsAt`). "Bu eğri t anında nerede" kuralının iki kopyası, devam eden bir
sesin devam ettirdiği notayla anlaşmazlığa düşmesinin tam yoludur; tek kopya
`automation`'da bırakıldı.

## 10. Notasyon her semantiği nasıl ayırıyor

`gesture-language` bir gesture'ı **hem işaret hem cümle** yapan tek yerdir, bu
yüzden perdenin yanındaki karakter ile ekran okuyucunun söylediği söz birbirinden
ayrılamaz.

| Gesture | İşaret | Cümle |
|---|---|---|
| bend (tut) | `b1` | 17. perdede tam bend, yukarıda tut |
| bend-release | `br1` | 17. perdede tam bend ve geri indir |
| prebend | `pb1` | 17. perdede önceden tam bükülmüş |
| prebend-release | `pbr1` | 17. perdede önceden tam bükülmüş, indir |
| bend + vibrato | `b1~` | … yukarıda tut, tepede vibrato |
| legato slide | `/` `\` | önceki notadan bağlı kaydır |
| **shift slide** | `s/` `s\` | önceki notadan kaydır ve **yeniden vur** |
| slide-in | `/‑` `\‑` | aşağıdan / yukarıdan kayarak gir |
| slide-out | `‑\` `‑/` | aşağı / yukarı kayarak çık |

Yarım ile tam bend ayrı işaret taşır (`b½` / `b1`). Renk tek anlam taşıyıcısı
değil: hepsi karakterdir. Cümlelerde cent, enum id, slot ya da hata kodu yok;
tek rakam perdenin kendisi. Bir eksene iki cevap veren nota **çizilmiyor** —
hoparlör onu reddederken sayfanın "b1" demesi ikisinin anlaşmazlığı olurdu.

## 11. UI akışları ve altı viewport geometri tablosu

Yeni panel: **Çalım → Bend / Kaydır**. İki kelimeyle açılır; ikinci seviye
yalnız biri seçilince belirir. Slide seçenekleri **yazma komutunun kendisine**
sorulur: sunulan seçenek çalışır, grileşen seçenek komutun kendi cümlesini
taşır.

`flows.mjs`, altı viewport × dokuz durum (akor, çalım, bend, bend+ghost,
kaydır, taşı, taşı+ghost, cümle paneli, cümle yazıldı) — **342 kontrol, hepsi
geçti**:

| Viewport | grid (bend+ghost) | hit | overlay | ≥44px | metin taşması | konsol |
|---|---|---|---|---|---|---|
| 360×800 | 202px | grid | 0 | ✅ | yok | temiz |
| 384×692 | 143px | grid | 0 | ✅ | yok | temiz |
| 412×915 | 237px | grid | 0 | ✅ | yok | temiz |
| 740×360 | 139px | grid | 0 | ✅ | yok | temiz |
| 844×390 | 169px | grid | 0 | ✅ | yok | temiz |
| 1280×800 | 219px | grid | 0 | ✅ | yok | temiz |

Ayrıca her viewport'ta: panel yalnız `door` satırıyla açılıyor; `Bend` "ne
kadar" ve "hareket" satırlarını açıyor; `Kaydır` onların yerine slide
satırını koyuyor; ve seçilen hareket tab'ın söyleyeceği cümleyle gösteriliyor
(`"0. perdede tam bend, yukarıda tut"`).

**Koşarken bulunan gerçek kusur:** `Çalım` grubu iki panelli olunca, bir panel
açıkken grubun panel satırı gizleniyordu — yani `Bend / Kaydır` açıkken
`Taşı`ya dönmenin tek yolu paneli kapatıp grubu yeniden açmaktı. §13'ün
"transpose kapısı geri çekilmesin" dediği şeyin ta kendisi. Satır artık iki
panelli bir grupta açık kalıyor ve açık olan işaretleniyor; tek panelli
gruplarda eskisi gibi gizli, çünkü orada zaten açık olanı yeniden açan tek bir
düğme olurdu.

Regresyon: `fast-sequence.mjs` **18/18**, `inventory.mjs` 12 ölçümün hepsinde
`gridHit=grid`, 0 overlay, 0 jargon.

## 12. Atomiklik ve transpose invariantları

`gesture-write` tek bir Song ya da hiçbir şey üretir. Panel yalnız **taslak**
kurar ve gridde ghost gösterir; kanonik Song, proje deposu ve history
`Uygula`'ya kadar dokunulmaz.

Retler — hepsi yazmadan önce, hepsi müzisyen cümlesiyle, hepsinde şarkı
**bayt-eş**: `no_note_here`, `target_is_tie_continuation`, `no_previous_note`,
`previous_note_other_string`, `silence_between`, `no_direction`,
`interval_too_wide`, `conflicting_gesture`, `not_fretted`, `no_change`.
Aynı komut iki kez → `no_change`, alan çoğalmıyor.

Transpoze invariantları (`transpose-acceptance.test.ts` §100):

- Bend miktarı **cent olarak** korunur — iki yarım ton yukarı taşımak tam
  bendi bir buçuğa çevirmez.
- Bend türü ve tepe vibratosu korunur.
- `legato_slide` ve `shift_slide` kimliğini korur, ve taşındıktan sonra da
  biri zincire girip öteki girmez.
- Kaydırma yönü **taşınmış seslerden** yeniden doğrulanır.
- Gesture'ı olmayan notaya gesture eklenmez.

## 13. L11–L16 render sonuçları

Altı kart, on take, hepsi production `applyGestureWrite` ile kendi ölçüsüne
yazıldı; biri bile yazılamazsa **hiçbiri sunulmaz**, çünkü bir tarafı eksik
karşılaştırma yapılamaz. Fixture'ın kendisi bayt-eş kalıyor.

| Kart | Ölçülen fark |
|---|---|
| L11 | automation sonu 200 cent ↔ 0 cent |
| L12 | ikisi de 200'den başlıyor; biri 200'de bitiyor, öteki 0'da |
| L13 | legato hedefi `chainRole: "target"`, shift hedefinin `chainId` yok |
| L14 | her iki take'te de **tek** planlanmış nota |
| L15 | hedefe varış indeksi > 0, sonra 200'ün üstüne çıkıyor |
| L16 | ölçüsünü aşan tek nota, 200 cent'te bitiyor |

**Otomatik taraf sesin nasıl olduğu hakkında hiçbir şey iddia etmiyor.**
İddia edilenler: doğru olay planı, doğru nota sayısı, doğru automation uçları.
"Doğal", "gerçekçi" ya da "olmuş" kelimeleri bu turda hiçbir yerde yazılmadı.

## 14. Founder'ın dinlemesi gereken kartlar

**Yalnız L11, L12, L13, L14, L15, L16.**

L1–L10 sonuçları otoritedir ve yeniden sorulmuyor. Editör hareketi testi
istenmiyor — panelin geometrisi, retleri ve atomikliği testlerle ölçüldü.

Founder URL: `/eval/listening-pack?sha=<FINAL_SHA>`

## 15. Test / probe / build sonuçları

| Kapı | Sonuç |
|---|---|
| TypeScript | temiz |
| ESLint (`eslint .`) | temiz |
| `next build` | başarılı |
| `git diff --check` | temiz |
| Tam süit | **5105 test / 313 dosya** (giriş: 4993 / 306) |
| Hedefli paket ×5 ardışık | 129/129, beş kez aynı |
| Tarayıcı: `flows.mjs` | **342/342**, 6 viewport × 9 durum |
| Tarayıcı: `fast-sequence.mjs` | 18/18 |
| Tarayıcı: `inventory.mjs` | 12 ölçüm, hepsi `gridHit=grid` |
| Seri mutasyon probe'ları | **20/20 kırmızı** |

Bu turda eklenen 12 probe: dört bendin bitişi, prebend'in başlangıcı,
vibratonun sırası, legacy bend'in kendi yolu, aynı eksende çift cevap reddi,
shift/legato atak farkı, devam eden sesin kendi automation'ından okunması,
kaydırma yönünün sesten gelmesi, sus üzerinden kaydırmanın reddi, shift
slide'ın işareti, L11'in iki tarafının gerçekten farklı olması, taşınan
notanın gesture'ını taşıması.

**Dördü ilk turda yeşil geldi ve dördü de probe'un kendi kusuruydu** —
kaldırılan dal yedek bir dalla aynı cevabı veriyordu, ya da mutasyon
fixture'da gözlemlenemiyordu. Testler zayıflatılmadı; probe'lar gözlemlenebilir
mutasyonlara taşındı ve biri (adı `a bend survives the bar line`) bu fixture'da
gözlemlenemez olduğu için gerçekten yük taşıyan bir invariantla değiştirildi:
devam eden sesin cent'ini kendi automation'ından okuması.

Probe'lar süit tekrarlarıyla eşzamanlı çalıştırılmadı.

## 16. Satır bütçeleri

Hiçbiri yükseltilmedi, bütçe testi gevşetilmedi.

| Dosya | Bütçe | Şimdi |
|---|---|---|
| `Workspace.tsx` | 377 | 377 |
| `TabCanvas.tsx` | 478 | 475 |
| `ArrangementCanvas.tsx` | 470 | 470 |

Yeni davranış küçük, adlı production modüllerine çıkarıldı:
`audio/automation.ts`, `audio/pitch-gesture.ts`, `music/expression-resolver.ts`,
`music/gesture-language.ts`, `song/gesture-write.ts`,
`listening/gesture-take.ts`, `shelf/PlayingPanel.tsx`.

## 17. Açık kalan dürüst borçlar

- **Ses kalitesi ölçülmedi.** Bu turun bütün iddiaları plan, automation ve
  olay düzeyindedir. L11–L16 cevaplanana kadar hiçbiri "iyi duyuluyor" demez.
- **`TechniqueSpan` göçü yapılmadı.** Palm-mute ve let-ring hâlâ nota
  özelliğidir; Expression Contract v2'nin aralık modeli bu turun kapsamı
  dışındaydı ve açıkça dışarıda bırakıldı.
- **`attack` ekseni ayrı bir alana taşınmadı.** Hâlâ legacy enum okunuyor;
  resolver bunu üçüncü eksen olarak *raporluyor* ama yeni bir alan eklenmedi.
- **Picking direction, rake, tremolo, harmonics, ornament, MPE/MIDI
  pitch-bend export** kapsam dışıydı ve yapılmadı.
- **Şekil önizlemesi bend için yok.** Panel gesture'ı cümleyle gösteriyor;
  bir eğri ya da mini grafik bilerek eklenmedi (§14: cent grafiği gösterme).
- **`approxSemitones` UI'dan seçilemiyor.** Slide-in/out varsayılan mesafeyi
  kullanıyor; alan şemada var ve basit akış onu sormuyor.
- **Kart render'ları bu turda çalıştırılmadı.** L11–L16 klipleri saf testlerle
  doğrulandı; gerçek WAV render'ı founder'ın kendi cihazında, rotayı açtığında
  üretilir — pack her zaman böyle çalışır.

## 18. `HEAD == @{u}` ve temiz ağaç

Push öncesi upstream yeniden kontrol edildi; başka bir oturum dalı
ilerletmedi. Final build final commit'ten alındı. Merge, rebase, reset,
amend, stash veya force-push yapılmadı.
