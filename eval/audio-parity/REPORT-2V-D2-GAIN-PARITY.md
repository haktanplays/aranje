# 2V-D.2 · gain parity turu raporu

Bu tur L31'i bir fixture hilesiyle geçirmeye değil, ortaya çıkardığı seviye
kusurunu **ölçüp** çözmeye ayrıldı. Sonuç, önceki turun kök neden teşhisini
düzeltiyor.

## 1. Giriş ve final SHA

Başlangıç `b669f49` (upstream ile aynı, ağaç temiz, `cdedf83` atası).
Bu turun üç ileri commit'i eklendi.

Yeniden üretim:

```sh
npx vite build --config eval/audio-parity/vite.parity.config.mts
npx vite build --config eval/rhythm-grid/vite.rhythm-render.config.mts
npx next build && npx next start -p 3115
node eval/audio-parity/measure-parity.mjs
node eval/rhythm-grid/measure-audio.mjs
SHA=$(git rev-parse HEAD) BASE=http://127.0.0.1:3115 node eval/rhythm-grid/geometry.mjs
SHA=$(git rev-parse HEAD) BASE=http://127.0.0.1:3115 node eval/rhythm-grid/meter-flows.mjs
bash eval/rhythm-grid/probes.sh
bash eval/rhythm-grid/probes-completion.sh
bash eval/audio-parity/probes-gain-parity.sh
```

## 2. Commit tablosu

| | konu |
|---|---|
| c1 | üç SETUP-FAIL probe onarımı + parity bench + ölçülen kök neden + spec/rapor düzeltmesi |
| c2 | merkezî düzeltme (`nearestSample`) + 45 yeni test (parite, teknik matrisi, kablolama) |
| c3 | L34/L35 kartları + kapsam + geometri + PCM yeniden ölçüm + üçüncü probe paketi + spec/rapor |

## 3. Önceki «teknik hazır» durumunun düzeltilmesi

`REPORT-2V-D2-COMPLETION.md` başına bir düzeltme bloğu kondu, `59 kırmızı`
satırı gerçek değeriyle (**56 kırmızı / 3 SETUP-FAIL**) düzeltildi ve durum
satırı üstü çizilip yerine

> **Faz 2V-D.2 açık — expressive/plain gain parity ve üç geçersiz probe
> kapanmadı.**

kondu. Spec §13.41.2 ve §13.41.4 ile K-74 de yeniden yazıldı: **c1'in «sabit
9,92 dB routing farkı» sonucu yanlıştı.**

## 4. Founder yetkisi

| kart | sonuç | yorum |
|---|---|---|
| L30 | **PASS** | — |
| L31 | **FAIL** | «İkisi arasında belirgin bir fark yok» |
| L32 | **PASS** | — |

Üçü de arşivde, harfi harfine, değişmedi. Bu turun hiçbir ölçümü onları
yükseltmiyor, silmiyor veya yeniden yazmıyor; L1–L29 da aynı.

## 5. Üç SETUP-FAIL'in önce/sonra sonucu

| probe | önce | sonra |
|---|---|---|
| `L31's two takes become byte-identical` | SETUP-FAIL (`hit.accent` artık yok) | **RED** |
| `L32 loses the sound that crosses the line` | SETUP-FAIL (note shape değişti) | **RED** |
| `the round re-asks a card the founder already decided` | SETUP-FAIL (kapsam değişti) | **RED** |

Paket: **59 kırmızı / 0 SETUP-FAIL / 0 yeşil kalan / 0 restore hatası.**

## 6. Plain / expressive topolojisi

| aşama | düz yol | expressive yol |
|---|---|---|
| kaynak | `ToneBufferSource` (Sampler içinde) | `ToneBufferSource` |
| normalization | Sampler `volume: pack.trimDb` | `Gain` × `10^(trimDb/20)` |
| nota seviyesi | `triggerAttackRelease(..., plan.gain)` | `Gain` = zarf[0] × trim |
| technique | — | filtre / pitch automation / gain zarfı |
| track | `sampler.connect(channel)` | `gain.connect(host.destination)` = aynı channel |
| track volume | `Channel({ volume: track.volumeDb })` | aynı Channel |
| master | `channel.connect(master)` — tek kenar | aynı |
| ceiling | `Limiter(-1 dBFS)` | aynı |
| destination | yalnız ceiling | aynı |

İki yolda `toDestination()` yok, ikinci kuru yol yok, trim iki tarafta da tam
bir kez uygulanıyor.

## 7. 9,92 dB'nin mekanik kök nedeni

**Gain routing'de yoktur.** `neutralParity()` tek notayı iki yoldan geçirip
her aşamada tepe okuyor:

| aşama | düz | expressive | oran |
|---|---|---|---|
| yalnız kaynak | 0,102654 | 0,102654 | ×1,000 — **0,000 dB** |
| + pack trim (+14 dB) | 0,514491 | 0,514491 | ×1,000 — **0,000 dB** |
| + track channel | 0,363800 | 0,363800 | ×1,000 — **0,000 dB** |
| + master headroom (−3 dB) | 0,257551 | 0,257551 | ×1,000 — **0,000 dB** |
| + ceiling limiter | 0,257693 | 0,257693 | ×1,000 — **0,000 dB** |

Gerçek neden **kayıt seçimi**. Articulation'sız nota paylaşılan
`Tone.Sampler`'ın seçtiği kaydı alır; sampler seçimini kendisi yapar ve
dışarıdan yönlendirilemez. Articulation'lı nota `nearestSample`'a sorar. İki
seçicinin beraberlik kuralı zıttı:

| midi | expressive çalardı | hızı | sampler çalar | hızı |
|---|---|---|---|---|
| **50 (D3)** | C3 | 1,122462 | **E3** | 0,890899 |
| **62 (D4)** | C4 | 1,122462 | **E4** | 0,890899 |

25 yarım sesin 23'ü zaten uyuşuyordu; uyuşmayan ikisi pack'in tam ortasındaki
iki perde. **L31 tel 1, perde 5 — yani D3 — üzerine yazılmıştır**, c1'in A/B
kontrolü de öyle.

c1'in sayısı buradan geldi: ölçüm onset'ten **25 ms** pencere okuyordu, bu
pack ise tepesine **66 ms**'de çıkıyor — yani pencere seviyeyi değil yükselme
hızını ölçtü. Hızlandırılmış C3 çok daha erken yükselir:

| perde | tepe farkı | ilk 25 ms farkı |
|---|---|---|
| C3 (kayıtlı) | ×1,000 — 0,000 dB | ×1,000 — 0,000 dB |
| **D3 (beraberlik)** | ×1,078 — 0,655 dB | **×4,900 — 13,804 dB** |
| E3 (kayıtlı) | ×1,000 — 0,000 dB | ×1,000 — 0,000 dB |
| **D4 (beraberlik)** | ×0,922 — −0,704 dB | ×0,864 — −1,269 dB |
| F3 (gerdirilmiş) | ×1,000 — 0,000 dB | ×1,000 — 0,000 dB |

## 8. Nötr routing kontrolü, önce ve sonra

Aynı sample, aynı perde, aynı onset, aynı süre, aynı velocity, düz pitch
automation, nötr gain zarfı, attack çarpanı 1:

| | önce | sonra |
|---|---|---|
| ayrışan yarım ses | **2 / 25** | **0 / 25** |
| D3, notanın tepesi | ×1,078 (0,655 dB) | **×1,000 (0,000 dB)** |
| D3, ilk 25 ms | ×4,900 (13,804 dB) | **×1,000 (0,000 dB)** |
| D4, notanın tepesi | ×0,922 (−0,704 dB) | **×1,000 (0,000 dB)** |

Üç pack'in (elektro gitar, çelik akustik, bas) tamamında, pack aralığının 12
yarım ses altı ve üstü dahil, hiçbir ayrışma kalmadı.

## 9. Temiz/lineer gain oranları

Kayıtlı bir perdede (C3), notanın kendi çalma penceresinde:

| | tepe | transient RMS (0–60 ms) | ilan edilen |
|---|---|---|---|
| accent ÷ plain | ×1,1800 — **+1,438 dB** | ×1,1714 — +1,374 dB | ×1,18 — +1,438 dB |
| ghost ÷ plain | ×0,4425 — −7,082 dB | ×0,4467 — −7,000 dB | ×0,45 — −6,936 dB |
| accent ÷ ghost | ×2,6667 — +8,520 dB | ×2,6223 — **+8,374 dB** | ×2,6222 — +8,373 dB |

`ghost`'un sustain RMS'i (×0,3275) oranından aşağıdadır ve bu bir artık değil,
preset'in kendi `holdFraction`'ıdır: hayalet nota kısadır.

## 10. High-gain final PCM sıralaması

Beraberlik perdesinde (D3), gerçek export renderer'ıyla, sekiz nota:

| | önce | sonra | ilan edilen |
|---|---|---|---|
| accent ÷ plain | ×1,2600 (+2,007 dB) | **×1,1738 (+1,392 dB)** | +1,438 dB |
| ghost ÷ plain | ×0,4723 (−6,516 dB) | **×0,4477 (−6,981 dB)** | −6,936 dB |
| accent ÷ ghost | ×2,6679 (+8,523 dB) | **×2,6222 (+8,373 dB)** | +8,373 dB |

Sıra her iki perdede de **`accent > plain > ghost`**; hiçbir fixture clip
etmedi, non-finite örnek yok.

## 11. Uygulanan merkezî düzeltme

`src/lib/audio/sample-map.ts`, tek fonksiyon: `nearestSample` artık
**paylaşılan sampler'ın seçimini bildirir** — eşit uzaklıktaki iki kayıttan
yalnız yukarıdaki kazanır. Otorite sampler'dır, tersi değil: düz yol
founder'ın L1'de kulakla PASS verdiği yoldur ve onu kaydırmak, kayıtlı bir
kararı olan sesi yeniden seviyelendirmek olurdu.

Eklenmeyenler: telafi sabiti, per-kart gain, EQ, ikinci transient/sample/synth,
attack preset yeniden kalibrasyonu, master/limiter değişikliği, sample asset
düzenlemesi.

## 12. Etkilenen technique matrisi

Yirmi olayın hepsi, plana gerçekten ulaştığı doğrulanarak (vacuous geçiş yok):

| olay | yol | plana ulaştığının kanıtı |
|---|---|---|
| normal | **shared** | boş zarf, düz pitch |
| accent | expressive | zarf tepesi = gain × 1,18 |
| ghost | expressive | zarf tepesi = gain × 0,45 |
| dead note | expressive | `filterPreset: "dead"` |
| tapping | expressive | zarf tepesi = gain × 0,85 |
| natural harmonic | expressive | zarf tepesi = gain × 0,70 |
| pinch harmonic | expressive | zarf tepesi = gain × 0,95 |
| vibrato | expressive | 2'den fazla pitch noktası |
| bend | expressive | ≥199 cent'e ulaşan nokta |
| bend release | expressive | tepe ≥199, son <1 |
| pre-bend | expressive | ilk nokta ≥199 |
| slide-in | expressive | ilk nokta <0 |
| slide-out | expressive | son nokta <0 |
| legato slide | expressive | `chainRole: "target"` |
| shift slide | expressive | pitch automation veya zincir |
| hammer-on | expressive | `chainRole: "target"` |
| pull-off | expressive | `chainRole: "target"` |
| palm mute span | expressive | `filterPreset: "palm_mute"` |
| PM + accent | expressive | filtre **ve** zarf, çarpan tam bir kez |
| harmonic + bend + vibrato | expressive | ≥199 cent **ve** zarf |

Paylaşılan yolda tek bir olay var ve o da düz notadır.

## 13. Kabul edilmiş timing/pitch regresyonları

Düzeltme planlayıcıya dokunmuyor; bir kaydın hangi dosyadan çalındığına
dokunuyor. Bend cent'leri ve zaman çizgisi, release eğrisi, pre-bend ilk
pitch'i, vibrato faz/derinlik, slide mesafesi, shift handoff dikişi, HO/PO
attack sayısı, shape slide ses sayısı, palm-mute filtre/süresi,
let-ring/restrike, harmonic pitch, attack türü, loop/resume ve Song event
tick/süreleri değişmedi — tam süit 5769 test yeşil, aralarında bu alanların
mevcut testleri.

Yan etkisi olan tek yer `sample-onset.ts`: D3/D4 için artık E3/E4'ün atak
süresini bildiriyor. Bu bir sapma değil, düzeltmenin kendisi — handoff artık
**gerçekten çalan** kaydın atağına göre ayarlanıyor.

## 14. Headroom ve clipping

| | tepe | dBFS | clip | non-finite |
|---|---|---|---|---|
| altı düz ses | 0,473579 | −6,492 | 0 | 0 |
| altı vurgulu ses | 0,558824 | −5,055 | 0 | 0 |
| altı hayalet ses | 0,160972 | −15,865 | 0 | 0 |

Vurgulu altılı düzün tam **+1,437 dB** üstünde — preset'in kendisi. Hayalet
ses sessize yaklaşmıyor: tek nota tepesi 0,0609, altılı 0,1610; telefon
bandında duyulur bir seviyedir. Master headroom ve ceiling değişmedi.

## 15. Lifecycle ve kaynak sahipliği

- Bir ses track bus'ına **tam bir kenarla** bağlanır; kaynak bus'a değil,
  kendi gain'ine gider.
- Filtreli sesin zinciri üç kenardır: kaynak → filtre → gain → bus. Kuru kopya
  yok.
- Yirmi kez çalındığında bus'a giden kenar sayısı yirmidir, artmaz.
- `stopAll` sonrası aktif ses **0**, ve beş ses tam on düğüm serbest bırakır
  (her ses kendi kaynağını ve gain'ini birer kez).
- Yeni bir havuz eskisinin seslerini devralmaz; kapalı havuz ne çalar ne
  kablolar.
- Aynı müzik üç kez render edildiğinde tepe ve RMS yayılımı **0 dB**, dispose
  sonrası aktif ses her seferinde **0**.

## 16. Pro metronom regresyonu

«Yalnız ana vuruşlar» / «Tüm sekizlikleri duy» yerinde; 7/8 cümlesi var,
4/4'te yok; üç velocity (downbeat/group/subdivision) korunuyor; seçim session
state, Song/history/proje yazımı sıfır; her pulse koşulsuz schedule edilip
karar ateşlenirken veriliyor. Üretim akışı 13–15 dört/üç/üç kontrolle geçti.

## 17. WAV PCM mixed-meter sonucu

Dokuz sınır fixture'ı, düzeltilmiş kaynakla yeniden ölçüldü:

| fixture | bar | yükseliş | en kötü \|hata\| |
|---|---|---|---|
| 4/4 | 2 | 7 | 25,99 ms |
| 6/8 compound | 2 | 9 | 24,51 ms |
| 6/8 + üçleme | 2 | 9 | **eşleşmedi** |
| 7/8 `2+2+3` | 2 | 14 | 27,75 ms |
| 7/8 `3+2+2` | 2 | 14 | 27,75 ms |
| mixed 5/8→7/8→6/8 | 3 | 14 | 26,27 ms |
| cross-meter phrase | 2 | 5 | 22,74 ms |
| loop selection | 3 | 21 | 27,75 ms |
| release tail | 2 | 7 | 24,51 ms |

Tolerans yine ölçülerek türetiliyor: tek notanın kendi atağı eşiği **+6,08
ms**, tepesini **+66,55 ms** sonra geçiyor; detector aynı notayı **+6,50
ms**'de buluyor. Hatalar ölçüler boyunca birikmiyor.

**6/8 + üçleme eşleşmiyor ve bu düzeltmeden önce de eşleşmiyordu** — sebebi
§25'te.

## 18. MIDI / JSON regresyonu

MIDI bağımsız byte okuyucusu, JSON round-trip ve export kapıları tam süitin
içinde yeşil (5769 test). Bu tur bu üç alana dokunmadı.

## 19. L33 fixture'ı ve render'ı

Tek tekrar eden perde (perde 3 = C3, pack'in birebir kaydettiği bir perde),
yedi sekizliğin hepsi yazılı, grup başları accent, diğerleri ghost, iki tur,
metronom yok. Düzeltilmiş kaynakla: **14 nota, 14/14 onset eşleşti**, en kötü
hata 5,71 ms. İki take aynı perde, aynı onset, aynı accent/ghost sayısı;
yalnız vurgu yerleri farklı.

## 20. L34 fixture'ı ve render'ı

**L34 · Düz, vurgulu ve hayalet vuruş.** Aynı nota, aynı register, aynı süre;
düz → vurgulu → hayalet, bir sekizlik boşluk, sonra aynısı. Altı nota, tek
perde, tek süre, tek nominal gain; sıralama planın kendi seviyeleriyle
doğrulanıyor.

Render: **6 nota, 4'ü eşleşti, 2'si eşleşmedi** — ikisi de vurgulu notalar.
Sebep §25'te; **L34 bu turda PCM ile doğrulanmış sayılmıyor.**

## 21. L35 fixture'ı ve render'ı

**L35 · İfade eklenince ses dengesi.** Tek tel, tek register, hiç attack yok:
düz (uzatılmış) → vibrato → bend-release → düz → shift slide → düz kapanış.
Üç düz nota kontroldür; ilk ve son nota düzdür. Vibrato (32 pitch noktası),
bend-release (200 cent'e çıkıp 0'a dönen 16 nokta) ve slide plana gerçekten
ulaşıyor. Harmonic bilerek yok: farklı bir spektrumdur, farklı bir seviye
değil.

Render: **7 nota, 6'sı eşleşti, 1'i eşleşmedi.** Aynı gerekçe; **L35 de PCM
ile doğrulanmış sayılmıyor.**

## 22. Geometri ve üretim akışları

Onüç durum × altı viewport = **78/78 ulaşıldı, 0 bulgu, 0 konsol hatası**,
`shaMatches` doğru. Durumlar: basit metronom, Pro kapalı, Pro açık, yalnız
vuruşlar, tüm birimler, 7/8 `2+2+3`, 7/8 `3+2+2`, çalarken değiştirme,
landscape inspector, export açıklaması, dinleme kartı, üç kartın tamamı,
resting. Her durumda `gridHit=grid`, overlay 0, overflow 0, kesilen metin 0,
44 px altı hedef 0, staff üzerinde panel yok.

Üretim akışları: **16/16, 0 hata, 0 konsol hatası.** Akış 16 artık üç kartın
tamamını, hiçbirinin cevaplanmış bir kartı tekrar sormadığını ve hiçbirinin
founder'a sayı göstermediğini kontrol ediyor.

`Nato süresi` yazımı kaynakta ve UI'da yok; typo guard dört dosyada duruyor.

## 23. Probe paketlerinin ayrı sonuçları

| paket | kırmızı | yeşil kalan | SETUP-FAIL | restore hatası |
|---|---|---|---|---|
| A · D.2 c3 (`probes.sh`) | **59** | 0 | **0** | 0 |
| B · completion (`probes-completion.sh`) | **36** | 0 | **0** | 0 |
| C · gain parity (`probes-gain-parity.sh`) | **37** | 0 | **0** | 0 |

Toplam **132 geçerli kırmızı**. C paketi ilk koşumda **4 yeşil kaldı ve 1
SETUP-FAIL** verdi; dördü de gerçek test boşluğuydu ve **testler
güçlendirildi**, probe'lar değil:

- «ilan edilen oranlar preset'ten kayıyor» → test preset'i yalnız kendisiyle
  karşılaştırıyordu; artık `1.18` ve `0.45` sayılarının kendisi sabitlendi.
- «bir attack notanın kendi gain'ini kaydırıyor» → üçü birlikte kaydığında
  test geçiyordu; artık düz notanın gain'i yazılı velocity'ye (96/127)
  bağlandı.
- «expressive normalization kaldırıldı» ve «accent sessizce paylaşılan yola
  döndü» → probe'lar yanlış satırı hedefliyordu; gerçek satırlara yöneltildi.

## 24. Test / build / bütçeler

| kapı | sonuç |
|---|---|
| `tsc --noEmit` | temiz |
| ESLint | temiz |
| production build | başarılı |
| `git diff --check` | temiz |
| tam süit | **5769 test**, üç ardışık yeşil |
| gain-routing hedefli paket | beş ardışık yeşil |
| probe sonrası hedefli paket | on ardışık yeşil |
| `budget-race` | **30/30** |
| bileşen satır bütçeleri | değişmedi, yükseltilmedi |

Ses routing düzeltmesi hiçbir bileşene girmedi: tek dosya, tek fonksiyon,
`src/lib/audio/sample-map.ts`.

## 25. Açık ve dürüst borçlar

1. **Kör onset detector'ı bu iki karta yetmiyor.** Detector bir yükselişi
   «önceki 5 ms penceresinin 2,5 katı» diye tanımlar. L34'te vurgulu nota,
   227 ms önce çalınan ve hâlâ çınlayan düz notanın üstüne yalnız ×1,18
   çıkar — bu eşiği geçmez. Aynı sebep `6/8 + üçleme` fixture'ında da
   geçerli ve düzeltmeden **önce de** vardı. Eşik körlemesine
   genişletilmedi; doğru çözüm spektral akış tabanlı bir detector'dır ve o
   kendi başına bir iştir. **Sonuç: L34 ve L35 bu turda PCM ile doğrulanmış
   sayılmıyor.** Seviye kontratı yine de ölçülüdür — parity bench her notayı
   kendi penceresinde ölçer ve kör bir detector'a ihtiyaç duymaz (§9, §10).
2. **c1'in kök neden teşhisi yanlıştı.** Bu raporda ve spec'te düzeltildi,
   ama yanlış teşhis bir tur boyunca «açık ürün kusuru» olarak durdu. Sebebi:
   ölçüm penceresi (25 ms) sample'ın atağından (66 ms) kısaydı ve fixture tam
   da iki ayrışan perdeden birine yazılmıştı. Pencere artık notanın kendi
   çalma süresidir.
3. **D3 ve D4'ün tınısı değişti.** Bu iki perdedeki *expressive* notalar artık
   C3/C4'ün hızlandırılmışı yerine E3/E4'ün yavaşlatılmışını çalıyor. Perde
   aynı, kayıt farklı. Düzeltmenin kendisi budur ve founder'ın onayladığı
   kartlardan bu perdelere denk gelen varsa tınısı bir miktar oynamıştır.
4. **Pro panelde «ana vuruşlara vurgu koy» önerisi hâlâ yok.** Önceki turda da
   isteğe bağlıydı, yine yapılmadı.

## 26. Ağaç durumu

`HEAD == @{u}`, `git status --porcelain` boş, `cdedf83` ile `b669f49` mevcut
HEAD'in ataları, bu turda üç ileri commit.

Üretilmiş ama izlenmeyen artefaktlar (`eval/audio-parity/artifacts/`,
`eval/rhythm-grid/artifacts/`, `eval/rhythm-grid/wav/`, her iki `.render/`)
§1'deki komutlarla yeniden üretilir.

## 27. Founder'dan istenen

Yalnız üç kartı dinlemek. Sayı, tick, dB veya accent listesi gösterilmez.

> **L33 · Aynı riff, iki belirgin gruplama**
> Bu kez iki tekrar belirgin biçimde farklı yerlerden gruplanmış gibi
> duyuluyor mu?

> **L34 · Düz, vurgulu ve hayalet vuruş**
> Vurgulu nota düz notadan daha belirgin, hayalet nota ise daha geride ve
> doğal duyuluyor mu?

> **L35 · İfade eklenince ses dengesi**
> Bend, vibrato ve kaydırma geldiğinde karakter değişiyor ama ses seviyesi
> aniden zıplamadan aynı cümlenin içinde kalıyor mu?

Otomatik hiçbir ölçüm bu üç kartı geçiremez. L30 ve L32 tekrar sorulmuyor,
L31 arşivde **Olmamış** olarak duruyor ve bu turun sonucu onu değiştirmiyor.

**Faz 2V-D.2 teknik olarak hazır — Haktan yalnız L33–L35'i dinliyor.**
Founder PASS'ı gelmeden D.2 fiziksel olarak kapanmış sayılmaz.
