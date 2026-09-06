# 2V-D.2 — Ritim, ölçü ve grid dili · kapanış raporu (c3)

Bu rapor c3'ün 27 maddesini sırayla cevaplar. Her rakam **final commit'in
build'inden** alınmıştır; alınmadıysa öyle yazar.

**Kanıtın kaynağı:** tarayıcı koşumları `6299237`'ün production build'ine
karşı yapıldı ve sayfadan okunan `data-build-sha` o SHA'ydı. Final commit,
kaynak olarak `6299237` ile **birebir aynıdır**; tek farkı bu raporun kendi
metnidir (bir raporun kendi rakamları, kendisini içeren commit'ten önce
ölçülmek zorundadır). Süit, tsc, ESLint ve probe kapıları final ağaçta
yeniden koşuldu.

---

## 1. Turun üç commit'i

| SHA | Ne |
|---|---|
| `8714df7` | c1 — founder yetkisi, zamanlama envanteri, metre/gruplama alanı |
| `8955c00` | c2 — ana vuruş / alt bölünme ayrımı, `barTicks(bar)` otoritesi, Ölçü paneli |
| _final_ | c3 — flake kök nedeni, export doğruluğu, L30–L32, geometry, akışlar |

`7f1fe36` üzerinde **tam üç ileri commit**. Reset, rebase, stash, force-push
yok.

**Açıkça bildirilen sapma:** c3 commit'i bir kez `--amend` edildi. Sebep:
geometry runner'ı commit'ten *sonra*, o commit'in build'ine karşı çalıştırınca
uygulamanın **Düzen** görünümünde açıldığı ve runner'ın Tab yüzeyine hiç
ulaşamadığı görüldü (60/60 state `reached: false`). §22 "c3 tek commit
olmalı" ve §0 "tam üç ileri commit" kuralları ile §0'ın "amend yok" kuralı bu
noktada çelişti; commit henüz **push edilmemişti** ve dördüncü bir commit
atmak iki kuralı birden bozacaktı, amend ise yalnız birini. Son durum §0'ın
istediği tam üç commit. Amend'de taşınan ek değişiklikler: iki runner
navigasyon düzeltmesi, §16'nın bulduğu iki UI kusuru, `.gitignore` satırı.

---

## 2. Flake: gerçekten üretildi mi?

Evet, ve belirti değil sebep bulundu.

| Koşum | Adet | Kırmızı |
|---|---|---|
| Tek başına (`-t "holds one call open"`) | 20 | 0 |
| Hedefli paket içinde | 10 | 1 |
| Yük altında (4 paralel `tsc`) | 10 | 2 |
| Probe koşumundan sonra | 5 | 0 |
| Tam süit içinde | 3 | 1 |

Hepsinde tek imza: `Test timed out in 5000ms`. Fazların süreleri
`FLAKE-BUDGET-RACE.md` içinde; barrier kurulumu, birinci varış, ikinci varış,
release, settle ve cleanup ayrı ayrı ölçüldü. Açık timer, açık handle,
settle olmamış promise sayıları ve restore hash'leri orada.

**Sıra tersliğinin ölçümü** (`digest-order.mjs`, iki çağıran × üç ardışık
`crypto.subtle.digest`, 3000 tur):

| Ortam | Ters sıra |
|---|---|
| Boşta | %3,3 |
| Yük altında | %7,7 |

---

## 3. Kök neden — tek cümle

`withStore` rezervasyondan önce üç `crypto.subtle.digest` bekliyor, bunlar
libuv havuzunda **başlatılma sırasında çözülmüyor**, ve test *ikinci
başlatılanın kaybeden olduğunu* varsaydığı için sıra ters döndüğünde
`await second` hiç settle olmayacak bir promise'i bekliyordu.

Kontrollü tekrar: çağıranlar bilerek ters sırayla başlatıldığında test
**deterministik** olarak aynı `Test timed out in 5000ms` ile düşüyor.

---

## 4. Yasak düzeltmelerin hiçbiri kullanılmadı

| Yasak | Durum |
|---|---|
| Global timeout yükseltmek | Yapılmadı — `testTimeout` dosyada değişmedi |
| Bu teste büyük timeout vermek | Yapılmadı |
| Retry | Yapılmadı |
| `skip` / `todo` | Yapılmadı |
| Kök neden olmadan yalnız serial | Yapılmadı |
| Rastgele `sleep` | Yapılmadı |
| Assertion silmek | Silinmedi — **iki assertion eklendi** |
| Yarışan tarafı kaldırmak | Kaldırılmadı, iki çağıran duruyor |
| Probe koşumunu atlamak | Atlanmadı |

Düzeltme: `Promise.race` kaybedeni verir; kazanan bariyerde tutulduğu için
bu deterministiktir. Eklenen iki assertion: (a) tam bir çağıran hâlâ uçuşta,
(b) uçuşta olan çağıran kazanan.

---

## 5. Kapanış kapıları

| Kapı | İstenen | Ölçülen |
|---|---|---|
| Değişiklikten önce hata görüldü mü | evet | evet, 4 ayrı koşumda |
| Tek cümlelik mekanik kök neden | evet | §3 |
| Yama kök nedeni kaldırıyor mu | evet | testin iddiası artık *hangi* çağıranın kazandığı değil |
| Yarış assertion'ları korundu mu | evet | korundu + 2 eklendi |
| Tek başına ardışık yeşil | 30 | **30/30** |
| Probe sonrası hedefli ardışık yeşil | 10 | **10/10** |
| Ardışık yeşil tam süit | ≥3 | **3/3** |
| Her koşumdan sonra açık iş | 0 | 0 |

`budget-race` süreleri, final commit'in ağacında ölçüldü: vitest'in bildirdiği
**test süresi 2,70–2,83 s**, uçtan uca süreç 3,62–3,81 s; 30 koşumun süreç
duvar saati **p50 4596 ms, p95 4864 ms, max 4900 ms** (makine yükü altında).
Test başına limit **değişmeden 5000 ms**.

---

## 6. c1/c2 otoritelerinin entegrasyonu

- `barTicks(bar)` tek bar-uzunluğu otoritesi; c3'ün yeni export denetimi,
  L30–L32 fixture'ları ve zaman çizgisi tablosu **hepsi** oradan okuyor.
  Grep testi eski açık çarpımın **yokluğunu** tutuyor.
- `meterBeats` / `meterPulses` iki katman; `readRhythm` ana vuruş sayısı ile
  alt bölünme satırını ayrı taşıyor. Üretim UI'ında ölçülen (§17 akış 7):
  `3 ana vuruş · 7 adım` ve `7 sekizlik · 2+2+3` **aynı anda ve ayrı
  satırlarda** ekranda.

---

## 7. Metronomun iki katmanı

`metronomeClicks(plan)` ana vuruşları, `metronomeClicks(plan, {
subdivisions: true })` bütün nota değerlerini verir; alt bölünme açıkken ana
vuruşlar **aynı tick'te ve aynı vurguda** kalır (`position.test.ts`).
Gürlükler: downbeat 1, secondary 0,55, subdivision 0,28.

**Eksik, açıkça:** motorda `metronomeSubdivisions` seçeneği var ama üretim
UI'ında bunu açan bir kontrol **yok**. Guardrail 2 bu yarıyı izin verici
yazmıştı ("mevcut metronom yeteneği izin veriyorsa ayrı bir seçenek olarak");
görsel yarı (alt bölünme satırı) teslim edildi, sesli seçenek edilmedi.

---

## 8. L31: fark metronomdan gelmiyor

`rhythm-take.test.ts` iki take'i karşılaştırır ve ikisinin **aynı** olduğunu
tek tek doğrular: perdeler, süreler, BPM, enstrüman, nota sayısı, bar
tick'leri. Farklı olan tek şey `gainEnvelope` tepe konumları — `2+2+3` için
sekizlik `[0, 2, 4]`, `3+2+2` için `[0, 3, 5]`. Bunlar üretim
`attack: "accent"` yolundan (`attackLayerFor` → `preset.accent.gainMultiplier`)
gelir; kart metni "Metronom yok" der ve plan click içermez.

---

## 9. JSON round-trip

`meter-export-audit.test.ts`, sekiz metrede + karışık şarkıda semantik parmak
izi eşitliği arar (şema geçerliliği değil): ölçü işareti, `Bar.grouping`,
`Bar.notation`, çözünürlük/lattice, notalar + `durationTicks`, cümleler,
teknik span'leri, gesture'lar, tempo.

Kapsanan: 4/4 karışık · 6/8 + 1/16 üçleme · 5/8 `2+3` · 7/8 iki his · 9/8 ·
12/8 · ardışık farklı ölçüler · bar sınırını geçen cümle · ölçü değişiminden
etkilenen span.

---

## 10. WAV zaman çizgisi — ve ölçülemeyen yarısı

Altı fixture için beklenen bar başlangıcı (tick ve saniye), bar sonu, bir
sonraki barın başlangıcı, ölçü değişimi sınırı, loop uçları, son olayın sonu
ve toplam süre **üretim planlayıcılarından** (`barTimeline`, `buildTempoMap`,
`renderDuration`) çıkarıldı. Drift yok, eksik/fazla yarım bar yok, loop ucu
`barTicks` toplamına birebir eşit, kuyruk bar uzunluğu sanılmıyor.

**AÇIK BORÇ:** *render edilmiş PCM'in ilk onset'i ölçülmedi.* PCM render bir
audio context ve sample bankası ister, ikisi de node test ortamında yok. Bu
yarı bu turda **yapılmadı** ve yapılmış gibi yazılmadı.

---

## 11. MIDI: gerçek byte'lar, bağımsız okuyucu

`readMeta` MThd/MTrk chunk'larını kendi yürür, VLQ'yu kendi çözer ve `FF 58`
/ `FF 51`'i tanır; denominator **2'nin üssü olarak** saklanan exponent'ten
geri kazanılır. Doğrulananlar: meta tick'i, numerator, denominator, tempo
tutarlılığı, karışık ölçülerin doğru bar başlarında değişmesi, üçleme ve düz
tick'lerin birebirliği, note-off'lar, 5/8 · 6/8 · 7/8 · 9/8 · 12/8 round-trip.

**Dürüstlük sınırı:** `2+2+3` ile `3+2+2` **birebir aynı** meta event'leri
üretir; test bunu ("gruplamanın hayatta kaldığını iddia etmez") adıyla tutar.
Özel marker yazılmadı, MPE iddia edilmedi. Ekranda görünen cümle:

> Ölçü MIDI'ye yazılır. 2+2+3 gibi vurgu grupları bazı uygulamalarda
> sadeleşebilir.

§17 akış 12 bu cümlenin **ekranda göründüğünü** (yalnız DOM'da değil)
doğrular.

---

## 12. BPM

Kanonik BPM dörtlük/dakika. 6/8'in hissedilen vuruşu ikinci bir kanonik BPM
olarak **saklanmıyor**, yalnız okunuyor; 7/8 için tek bir hissedilen-vuruş
BPM'i **uydurulmuyor**. Test 132 bpm ile yazılmıştır — 120 bpm'in 500000 µs
olması, sabit yazılmış bir writer'ı gizlerdi.

---

## 13. L30 / L31 / L32

| Kart | İçerik | Soru (kartta birebir) |
|---|---|---|
| **L30** | Gerçek 6/8, üstünde hızlı 1/16 üçlemeler, ≥2 loop, tam tick'te kapanış | "Üçlemeler ölçünün içine oturuyor mu, yoksa acele mi ediyor?" |
| **L31** | Aynı riff iki gruplamada, metronom kapalı, vurgular gerçek nota atağında | "İki alışta vurgular farklı yerlere mi düşüyor?" |
| **L32** | Bir riff ölçü değişiminin iki yakasında, bar çizgisini geçen bağlı nota | "Cümle ölçü değişiminde kopuyor mu?" |

L32'nin kullanıcıya görünen adı: **"Farklı ölçüler arasında riff devamı."**
Sahte pick yok, boşluk yok, drift yok; cümle kimliği tek.

Otomatik ölçüm yalnız farkın **render edildiğini** kanıtlar. "Fark
hissediliyor" kararını hiçbir test veremez ve bu raporda hiçbir yerde
verilmemiştir.

---

## 14. Dinleme kapsamı

`ACTIVE_CLIP_IDS = ["L30", "L31", "L32"]`. L1–L29 salt-okunur arşiv;
geriye dönük PASS yok, otomatik PASS yok. Founder'dan istenen tek şey
dinlemek. Kartlarda sayaç: **"Bu tur: n/3"**.

---

## 15. Geometry — altı viewport × on state, final commit'in build'i

Runner sayfadaki `data-build-sha`'yı okur; beklenen SHA ile eşleşmezse bunu
JSON'a yazar. Bayat build yeşil geçemez.

- **60/60 state gerçekten açıldı** (witness selector ile doğrulandı) ve son
  koşumda **hiçbirinde bulgu yok**.
- `gridHit = grid`: 60/60. Overlay: 0. `overflowX`: 0. Kırpılan CTA: 0.
  Çift CTA/etiket: 0. Ham tick/slot/resolution/enum: 0.
- Konsol hatası: 0.
- Seçim tick'leri zoom/pan sonrası aynı; preview yazımı 0 (§17 akış 9).
- Landscape'te inspector notaların üstünde değil (`gridHit = grid`,
  740×360 ve 844×390 dâhil).

**Bu turun ara koşumlarının bulduğu ve düzeltilen iki kusur** (final koşum
temiz) (ikisi de bu turun inşa
etmediği panellerde, ikisi de tek özellik):

1. `ShelfChoice` yalnız `minHeight` veriyordu; tek karakterli "−" / "+" perde
   düğmeleri 26 px genişlikte ölçüldü, altı viewportta 6 adet. `minWidth`
   eklendi.
2. Dock'un "Nota süresi" düğmesi landscape'te kendi metninden 3 px dar
   yerleşiyordu (`min-w-0`). Satır zaten yana kayıyor; `min-w-0` kaldırıldı.

**Ölçüm kapsamı hakkında dürüstlük notu:** 44 px kuralı *kontrollere*
uygulanır. Porte hücreleri (`[data-tab-content]` içi) müziğin kendisidir ve
her biri 44 px olsa bir bar 700 px olurdu; bunlar `smallTargets`'tan çıkarılıp
`gridCells` olarak **ayrıca sayılır** — gizlenmez. Cümle bandı istisnası
değişmedi.

---

## 16. Üretim UI akışları — 12/12

`meter-flows.mjs` üretim komutlarını üretim yüzeyinde yürütür (test helper'ı
yok). "Müzikal yazım", proje kaydının sardığı **şarkı belgesi**dir; kaydın
`revision`/`updatedAt` alanları her yazımda değişir ve müzikle ilgisi yoktur.

| # | Akış | Sonuç |
|---|---|---|
| 1 | 4/4 → 6/8 önizleme | ✅ cümle ekranda, 0 yazım |
| 2 | İptal | ✅ 0 yazım, 0 history adımı |
| 3 | Uygula | ✅ 1 yazım, undo açıldı ve ne yapacağını söylüyor |
| 4 | Undo/redo | ✅ **byte'ı byte'ına** geri geliyor ve geri dönüyor |
| 5 | Karışık yerel yükseltme | ✅ önce önizleme, sonra yazım; grid sayı olarak söylenmiyor |
| 6 | Hızlı dizi önizleme + uygula | ✅ seçim 0 yazım, uygulama yazıyor |
| 7 | 7/8 gruplama önizleme | ✅ his değişince cümle değişiyor; iki his de sunuluyor |
| 8 | Pro alanı | ✅ açmak da kapatmak da 0 yazım |
| 9 | Zoom + pan | ✅ 0 yazım, panel gesture'dan sağ çıkıyor |
| 10 | Dolu bar reddi | ✅ cümleyle reddediliyor, 0 yazım, sessiz kırpma yok |
| 11 | Cümle/span korunması | ✅ ölçü değişti, hiçbir cümle ve teknik katmanı kaybolmadı |
| 12 | Export açıklaması | ✅ cümle birebir ve **görünür** |

Konsol hatası 0, ulaşılamayan akış 0, başarısız kontrol 0.

**Ölçülen sınır, saklanmadan:** demo şarkının ilk barı dolu bir 4/4'tür ve
7/8 ondan **kısadır**, bu yüzden 7/8 bu bara *uygulanamaz* — üretim onu
"Sondaki notalar yeni ölçüye sığmıyor." diye reddeder ve hiçbir şey yazmaz.
Akış 7 bu yüzden gruplama **önizlemesini** kanıtlar, uygulamasını değil; §14
davranışı da aynı akışta ayrıca doğrulanır. Yazım gerektiren akışlar
(3, 4, 11) bara **sığan** bir ölçüyü (12/8) kullanır.

---

## 17. Probe'lar

`probes.sh`: **59 adlandırılmış probe, seri**, testlerle paralel değil.
Her biri gözlemlenebilir davranışı değiştirir.

| | |
|---|---|
| Kırmızıya dönen | **59 / 59** |
| Kırmızıya dönmeyen | **0** |
| Restore hash uyuşmazlığı | **0** |
| Koşum sonrası artık dosya | 0 (`git status --porcelain \| grep -c probe-bak` → 0) |

Yeşil kalan 15 probe'un hiçbiri "test zaten doğru" diye bırakılmadı: gözlem
noktası düzeltildi ya da eksik test yazıldı (şema gruplama reddi, MIDI
açıklama cümlesi, 132 bpm'de tempo). Probe runner'ı süit başlamadan kapanır.

---

## 18. Final doğrulama (final commit'in ağacından)

| Kapı | Sonuç |
|---|---|
| `tsc --noEmit` | temiz |
| ESLint (`src` + `eval`, `--max-warnings 0`) | temiz |
| Production build | başarılı |
| `git diff --check` | temiz |
| Tam süit ×3 | **5693/5693** ×3 (65,5 s · 65,6 s · 66,4 s) |
| Hedefli ritim/ölçü/export/dinleme paketi ×5 | 708/708 ×5 |
| Probe sonrası hedefli ×10 | 708/708 ×10 |
| `budget-race` tek başına ×30 | 30/30 |
| `budget-race` probe sonrası ×10 | 10/10 |
| Browser geometry | 60/60 state açıldı, **0 bulgu**, `shaMatches: true`, 0 konsol hatası |
| Üretim UI akışları | 12/12 ulaşıldı, **0 başarısız kontrol**, `shaMatches: true`, 0 konsol hatası |
| L30–L32 render kontrolü | 14/14 test |
| Gerçek JSON/WAV/MIDI export kontrolleri | 17/17 test |
| `git status --porcelain` | temiz |

Sıfır testli koşum, timeout ve yalnız-fixture-üretimi hiçbir yerde PASS
sayılmadı.

---

## 19. Bütçeler

Satır bütçeleri yükseltilmedi ve gevşetilmedi. Workspace'in ayrıştırma
kazancı geri doldurulmadı. Export/ritim mantığı TabCanvas'a yığılmadı; ölçü
dönüşümü ArrangementCanvas'a taşınmadı. Runner boyutu üretim bileşeni
bütçesiyle karıştırılmadı — `eval/` bütçeye girmez.

---

## 20. Spec

- **§13.40** (on alt bölüm) `§14`'ten önce eklendi.
- **K-73** karar günlüğüne eklendi (K-72'den sonra, numara mevcut diziden
  belirlendi, tahmin edilmedi).

---

## 21. Artefaktların yeniden üretimi

`eval/rhythm-grid/artifacts/` **takip edilmiyor** ve `.gitignore`'da: içindeki
her dosya kendisini üreten commit'in SHA'sını yazar, dolayısıyla o commit'in
içinde yaşayamaz. Yeniden üretmek için:

```sh
npx next build
npx next start -p 3115 &
SHA=$(git rev-parse HEAD) BASE=http://127.0.0.1:3115 node eval/rhythm-grid/geometry.mjs
SHA=$(git rev-parse HEAD) BASE=http://127.0.0.1:3115 node eval/rhythm-grid/meter-flows.mjs
node eval/rhythm-grid/digest-order.mjs
bash eval/rhythm-grid/probes.sh
```

Takip edilen üretilmiş artefakt bu turda yok, dolayısıyla geri yükleneni de
yok.

---

## 22. Bu turda YAPILMAYANLAR

Kapsam dışı bırakılanlar zaten §1'de dondurulmuştu (Copilot, örüntü
kütüphanesi, yeni sample bank, genel ses cilası, L5/L7/L23 borçları, keyfi
tuplet, polimetre, tempo otomasyonu, UI yeniden tasarımı, yeni kalıcılık
deposu). Bunların dışında **eksik kalan iki şey** var:

1. **WAV'ın render edilmiş PCM onset'leri ölçülmedi** (§10). Zaman çizgisi
   yarısı üretim planlayıcılarından üretildi; PCM yarısı açık borç.
2. **Metronomun alt bölünme seçeneği UI'da yok** (§7). Motor yeteneği var,
   Pro'da bir anahtar yok. Guardrail 2 bunu izin verici yazmıştı; görsel yarı
   teslim edildi.

---

## 23. Founder'dan istenen

Yalnız **L30, L31, L32**'yi dinlemek. Başka hiçbir şey sorulmuyor, hiçbir
kart geriye dönük olarak açılmıyor ve hiçbir otomatik ölçüm "duyuluyor"
demiyor.
