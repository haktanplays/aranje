# 2V-D.2 · kapanış turu raporu

> **SONRADAN DÜZELTİLDİ — 2V-D.2 gain parity turu.** Bu rapordaki iki cümle
> yanlıştı ve düzeltildi:
>
> 1. **«expressive yol sampler'ın sabit ~9,92 dB üstünde»** — doğru değil.
>    Doğrudan ölçüm (`eval/audio-parity/measure-parity.mjs`) iki yolu grafiğin
>    beş aşamasında da **×1,000 — 0,000 dB** buluyor. Gerçek mekanik neden
>    *kayıt seçimidir*: `nearestSample` ile `Tone.Sampler` beraberliği ters
>    yönde bozuyordu ve L31'in perdesi (D3) tam o iki beraberlikten biriydi.
>    Ölçülen tablo `eval/rhythm-grid/L31-ROOT-CAUSE.md` içinde.
> 2. **«c3 probe paketi: 59 kırmızı, 0 yeşil kalan»** — o ölçüm üç satırlık
>    bir düzeltme uygulanmışken alınmıştı; commit'lenen ağaçta paket
>    **56 kırmızı / 3 SETUP-FAIL** veriyordu. Üç probe gain parity turunun
>    ilk commit'inde onarıldı ve paket şimdi gerçekten 59/59.
>
> Aşağıdaki metin, o iki satır dışında, yazıldığı hâliyle bırakılmıştır.

Bu tur yeni faz değildir. D.2'nin açık kalan üç maddesini kapatır: L31'in
kök nedeni, WAV'ın gerçek rendered-PCM kanıtı, ve motorda duran Pro metronom
seçeneğinin üretim UI'ına bağlanması. Rapor c3'ün 24 maddesini sırayla
cevaplar.

**Kanıtın kaynağı:** tarayıcı ve PCM koşumları `6b342d1`'in production
build'ine karşı yapıldı; sayfadan okunan `data-build-sha` o SHA'ydı. Final
commit kaynak olarak `6b342d1` ile aynıdır, tek farkı bu rapor ve onun
istediği runner düzeltmesidir. Final SHA'ya karşı yeniden koşulan sonuçlar
§18'de ayrıca verilmiştir.

---

## 1. Giriş ve final SHA

Başlangıç `cdedf83`. Branch `claude/proje-yorumları-n06wen`. Giriş kapısında
istenen on altı atanın hepsi zincirde. Reset, rebase, amend, stash,
force-push yok. Bu turda **üç ileri commit** var ve dördüncü artefakt
commit'i açılmadı.

## 2. Commit tablosu

| SHA | Ne |
|---|---|
| `f0ea2a8` | Founder yetkisi (L30/L31/L32), L31'in kök nedeni, gerçek PCM analizörü, L33 fixture'ı ve kartı |
| `6b342d1` | Pro metronom alt-bölünme UI'ı, count-in'in aynı seçimi okuması, sample'ın kendi onset profili |
| _final_ | Geometry, üretim akışları, 36 probe, spec §13.41 + K-74, bu rapor |

## 3. Founder yetkisi

| Kart | Sonuç | Founder'ın sözü |
|---|---|---|
| L30 · 6/8 içinde hızlı üçleme | **Olmuş** | — |
| L31 · Aynı riff, iki gruplama | **Olmamış** | «İkisi arasında belirgin bir fark yok» |
| L32 · Farklı ölçüler arasında riff devamı | **Olmuş** | — |

Arşiv bu turda ilk `fail` verdict'ini kazandı; etiketi **Olmamış**. L31 satırı
yumuşatılmadı, silinmedi ve L33'ün sonucu ne olursa olsun değişmeyecek — bunu
bir yorum değil, `keeps L31 refuted whatever the next card scores` adlı bir
test tutuyor.

## 4. L31 fixture'ının gerçeği

Fixture suçsuzdu. İki take'in vurguları doğru tick'lerde, aralarındaki tek
fark yerleri, ve plan `1.18`'i birebir uyguluyor.

| | L31a | L31b |
|---|---|---|
| Onset tick'leri | 6144…6720, 96'da bir | aynı |
| Perdeler | D3 D#3 E3 D3 D#3 E3 D3 | aynı |
| Süre / velocity | 88 tick / 96 | aynı |
| Plan gain | 0,755906 | aynı |
| Vurgulu sekizlikler | 0, 2, 4 | 0, 3, 5 |
| Uygulanan oran | ×1,18 | ×1,18 |

## 5. Dört hipotezin ölçüm sonucu

| | Hipotez | Sonuç |
|---|---|---|
| **A** | Gruplama/fixture bağlantısı hatalı | **Elendi** — §4'ün tablosu |
| **B** | Plan farklı, PCM aynıya yakın | **Doğrulandı, işareti ters** — plan +1,44 dB der, render +11,4 dB verir |
| **C** | PCM farklı, fixture okunaksız | **Ayrıca doğru** — 5-6-7-5-6-7-5 konturu her üç notada tekrar eder |
| **D** | Ürün semantiği yanlış beklenmiş | **Hayır** — gruplama metadata'sı hiçbir notayı kendiliğinden vurgulamıyor ve bu tur da öyle bırakıldı |

## 6. Accent plan tablosu

Sekiz özdeş nota (tek perde, tek tel, tek süre, tek velocity), üç kez
render edildi.

| Render | plan gain | plan zarfı | PCM tepe | dBFS |
|---|---|---|---|---|
| hepsi vurgusuz | 0,755906 | *(yok)* | 0,0353 | −29,0 |
| hepsi vurgulu | 0,755906 | 0,891969 | 0,1307 | −17,7 |

## 7. Pre/post-effect PCM tablosu

Master zinciri lineer bir −3 dB trim ve −1 dBFS tavandır; bu fixture'ın
tepesi −17,7 dBFS olduğu için **tavan hiç çalışmıyor** (`clippedFrames: 0`,
`nonFinite: 0`). Yani plan oranı ile PCM oranı arasındaki fark master'dan
gelmiyor:

| attack | preset | teslim edilen ÷ düz | ima edilen yol farkı |
|---|---|---|---|
| accent | 1,18 | 3,697 | **3,133** |
| ghost | 0,45 | 1,410 | **3,133** |
| tapping | 0,85 | 2,556 | 3,007 ¹ |
| dead | 0,55 | 1,192 | 2,167 ¹ |
| natural harmonic | 0,70 | 2,577 | 3,682 ¹ |
| pinch harmonic | 0,95 | 3,444 | 3,625 ¹ |

¹ Bu dördü filtre, hold veya playback rate'i de değiştirir; yalnız `accent`
ve `ghost` saf gain değişimidir ve yalnız onlar yol farkını izole eder.

## 8. Kök neden

> Vurgulu bir nota, preset'in ilan ettiği bir buçuk desibel yerine yaklaşık
> **on bir desibel** yüksek teslim ediliyor — çünkü bir attack, notayı
> expressive-voice yoluna taşıyor ve o yol aynı nominal gain için sampler
> yolunun **9,92 dB** üstünde. L31'de bunun sonucu, *vurgusuz* sekizliklerin
> nabız olmaktan çıkması; nabız yoksa `2+2+3` ile `3+2+2` arasında duyulacak
> bir fark da yok.

Sabit iki bağımsız attack'ta üç ondalığa kadar aynı çıkıyor (3,133), yani
farklı sample seçimi ya da zarf şekli değil, **sabit bir gain katı**.

## 9. Uygulanan düzeltme

**Yol farkı düzeltilmedi.** Tek sabitlik bir değişiklik uygulamadaki her
tekniği kaydırır; aralarında founder'ın zaten `pass` verdiği L25, L26, L27,
L28 ve L29 var. Onaylanmış sesi, onu yeniden onaylayacak kulak olmadan bir
kapanış turunda yeniden yazmak düzeltme değildir. Sayı, onu üreten kontrol ve
yeniden üretim komutu `L31-ROOT-CAUSE.md` içinde **birinci açık borç**.

**Fixture düzeltildi.** L33 aynı soruyu iki kusur da çıkarılmış hâlde sorar
(§17).

Yasak sayılanların hiçbiri yapılmadı: per-card gain/EQ yok, ikinci
transient/sample/synth yok, yalnız L33'ü gizlice yükseltme yok, master
limiter devre dışı bırakılmadı, normal notalar kısılmadı.

## 10. Gruplama metadata'sı ile yazılmış accent sınırı

`Bar.grouping` metronomu, vuruş çizgilerini, count-in'i ve okunabilir ölçü
dilini yönetir. Gruplama var diye mevcut notalara sessizce `attack: "accent"`
yazılmaz; kullanıcı gruplamayı değiştirdiğinde nota fingerprint'i değişmez.
Bu tur bu sınıra dokunmadı ve Pro'ya «vurguları ana vuruşlara yerleştir»
önerisi **eklenmedi** — §7 zorunlu tutmuyordu ve geniş scope gerektiriyordu.

## 11. Pro metronom UI'ı

Pro alanında iki seçenek: **«Yalnız ana vuruşlar»** ve **«Tüm sekizlikleri
duy»**. Altında, yalnız doğru olduğunda: *«Grup başları daha güçlü, diğer
sekizlikler daha hafif çalar.»* 4/4'te ana vuruşlar zaten notasal
birimlerdir, o yüzden cümle yoktur — ölçüldü ve doğrulandı.

- Basit mod varsayılanı: yalnız ana vuruşlar.
- Toggle grid'i kapatmaz; modal/bottom sheet/fixed overlay yok; portrede
  shelf, landscape'te yan panel — altı viewport'ta `gridHit=grid`.
- Song fingerprint'i üç click state'inde **birebir aynı** (geometry
  artefaktındaki `songHash`).
- History adımı yok, proje yazımı yok, zoom/selection değişmiyor.
- Playback sürerken açılıp kapanıyor; bayat click bırakmıyor, çünkü her pulse
  koşulsuz schedule ediliyor ve ince click'in çalıp çalmayacağı **ateşlendiği
  anda** soruluyor.
- Count-in aynı seçimi ve aynı üç gürlüğü okuyor.

**Kalıcılık:** seçim **session-local**'dir. Bir device setting'e yazılmaz,
projeye girmez ve reload sonrası ana vuruşlara döner.

## 12. Metronom event tablosu

Üretim `metronomeClicks` yolundan, üretim `buildSongPlan` üzerinde:

| Fixture | ana vuruş | notasal birim | bir pulse bir click | ana vuruşlar yerinde |
|---|---|---|---|---|
| 4/4 | 4 | 4 | evet | evet |
| 6/8 `3+3` | 2 | 6 | evet | evet |
| 7/8 `2+2+3` | 3 | 7 | evet | evet |
| 7/8 `3+2+2` | 3 | 7 | evet | evet |
| 9/8 | 3 | 9 | evet | evet |
| 12/8 | 4 | 12 | evet | evet |

7/8 `2+2+3`: ana vuruşlar 0, 192, 384 tick; birimler 0, 96, 192, 288, 384,
480, 576. Gürlükler downbeat 1 · grup başı 0,55 · ince 0,28.

Toggle-sırasında-çalma, loop wrap, pause/resume, stop/dispose davranışları
üretim akışlarında yürütüldü (§19, akış 15).

## 13. WAV PCM detector yöntemi

`renderSongToBuffer` — export düğmesinin kendi renderer'ı — gerçek
Chromium'da, uygulamanın kendi sunduğu sayfada koşuyor; sample URL'leri
üründeki gibi çözülüyor.

Detector'a **yalnız buffer** verilir. Gürültü tabanını dosyanın 10 ms'lik
pencerelerinin en sessiz yüzde onundan ölçer, eşiği ondan türetir (taban × 8,
dijital sessizlikte sıfıra düşmesin diye 1e-4 alt sınırıyla), ve her yükselişi
raporlar. Planner'ın tick'leri **sonradan**, çağıran tarafından karşılaştırılır
— bir test kendi başladığı sayıyı sonuç diye geri okuyamaz. Hiç onset
bulunmazsa koşum düşer.

**Tolerans, ölçülerek türetildi.** Etrafında hiçbir şey olmayan tek bir
nota: eşiği **+6,1 ms**, tepesini **+66,6 ms** sonra geçiyor; detector aynı
notayı **+6,5 ms**'de buluyor.

## 14. Mixed-meter onset / bar sınırı tablosu

| Fixture | bar | ölçü | başlangıç tick | başlangıç sn | ilk PCM yükselişi | hata | önceki ile arası |
|---|---|---|---|---|---|---|---|
| mixed | 1 | 5/8 | 0 | 0 | 0,005011 | +5,0 ms | — |
| mixed | 2 | 7/8 | 480 | 1,136364 | 1,162630 | +26,3 ms | 230,5 ms |
| mixed | 3 | 6/8 | 1152 | 2,727273 | 2,751224 | +24,0 ms | 225,5 ms |
| cross-meter | 1 | 7/8 | 0 | 0 | 0,005011 | +5,0 ms | — |
| cross-meter | 2 | 6/8 | 672 | 1,590909 | 1,613651 | +22,7 ms | 681,5 ms |
| loop | 1–3 | 7/8 | 0 / 672 / 1344 | 0 / 1,590909 / 3,181818 | — | +5,0 / +27,8 / +25,4 ms | — |
| release-tail | 1–2 | 6/8 | 0 / 576 | 0 / 1,363636 | — | +5,0 / +24,5 ms | — |

Ve tam sayı aritmetiği:

| Fixture | `barTicks` toplamı | notalı son tick | render sn | kuyruk | expression |
|---|---|---|---|---|---|
| mixed | 1728 | 1728 | 7,090909 | 3,000 | 0 |
| cross-meter | 1248 | 1248 | 5,954545 | 3,000 | 0 |
| loop | 2016 | 2016 | 7,772727 | 3,000 | 0 |
| release-tail | 1152 | 1152 | 5,727273 | 3,000 | 0 |

- Kümülatif `barTicks` toplamı, notalı sonla **birebir eşit** — eksik ya da
  fazla yarım bar yok, son bar kırpılmıyor.
- Barlar arasında boşluk yok, erken onset yok.
- Kuyruk ayrı bir alan olarak raporlanıyor ve bar süresine katılmıyor.
- Tempo dörtlük otoritesi değişmiyor (`expressionSeconds: 0`).

**Hatalar hakkında dürüstlük:** 22–28 ms'lik değerler drift değildir ve
rapor bunu iki bağımsız gerekçeyle söyler. (a) Tek notanın kendi atağı
ölçüldü: eşiği +6,1 ms'de geçiyor. (b) Geri kalanı, detector'ın **hâlâ
çınlayan bir notanın üstünde** bir yükseliş araması; ilk barın hatası 5 ms,
sonrakilerinki 22–28 ms ve **birikmiyor** — mixed'de 26,3 → 24,0, loop'ta
27,8 → 25,4. Drift olsaydı bar numarasıyla birlikte artardı.

## 15. MIDI/WAV/JSON tutarlılığı

c3'ün `meter-export-audit` denetimi bu turda değişmedi ve tam süitte yeşil:
JSON round-trip sekiz metrede + karışık şarkıda semantik parmak izi eşitliği,
MIDI byte'ları bağımsız bir okuyucuyla, ve `2+2+3` ile `3+2+2` için birebir
aynı meta event'ler. WAV ve MIDI sınır tabloları aynı kanonik tick zaman
çizgisinden türüyor; hiçbiri diğerinin sonucunu geri okuyarak PASS vermiyor.

## 16. «Nato süresi» sonucu

**UI'da yoktu; önceki turun rapor metnindeki yazım hatasıydı.** Üretim
kaynağında dört yerde geçen etiket her yerde **«Nota süresi»**. Kaynak
gereksiz yere değiştirilmedi; bunun yerine adlandırılmış bir test dört
dosyayı birden tutuyor (`never writes the note-length label as anything but
Nota süresi`) ve üç ayrı probe onu kırmızıya çeviriyor.

## 17. L33 fixture invariant'ları

| | L33a | L33b |
|---|---|---|
| Ölçü | 7/8 `2+2+3`, iki tur | 7/8 `3+2+2`, iki tur |
| Perde | tek, tekrar eden | aynı |
| Onset / süre | 14 nota, hepsi eşit | aynı |
| Vurgu sayısı | 3 + 3 | 3 + 3 |
| Ghost sayısı | 4 + 4 | 4 + 4 |
| Vurgu yerleri (sekizlik) | 0, 2, 4 | 0, 3, 5 |
| Metronom | kapalı | kapalı |
| Ölçülen accent ÷ ghost | 2,610 → **+8,33 dB** | 2,597 → **+8,29 dB** |

Kartın tek sorusu: **«Bu kez iki tekrar belirgin biçimde farklı yerlerden
gruplanmış gibi duyuluyor mu?»** Yanıtlar mevcut standart: Olmuş · Kısmen ·
Emin değilim · Olmamış. Kartta dB, tick veya vurgu listesi yok.

Neden okunabilir: L31'in perde konturu her üç notada tekrar edip kendi
gruplamasını dayatıyordu; L33 tek perde. Ve L33'ün her sekizliği yazılmış
(`accent` / `ghost`), bu yüzden iki tür de **aynı render yolundan** geçiyor —
yani §8'deki 9,92 dB'lik yol farkı bu karta karışmıyor. Bu bir düzeltme
değil, bir kaçınmadır ve öyle yazılmıştır.

## 18. Altı viewport geometri

Final commit'in build'inde, on bir durum × altı viewport = **66 durum**.

- **66/66 gerçekten açıldı** (her durumun kendi witness selector'ıyla).
- Dokuz workspace durumunda: `gridHit=grid`, overlay 0, staff üstüne çizilen
  panel 0.
- On bir durumun hepsinde: viewport overflow 0, kesilen metin/CTA 0, 44 px
  altı yeni hedef 0, duplicate label 0, raw enum/tick/slot/resolution 0.
- Konsol hatası **0**.
- Click state'leri arasında Song fingerprint'i birebir aynı.

Export sheet'i ve dinleme kartı **staff'sız** olarak işaretli: ilki tasarım
gereği tam ekran bir sheet, ikincisi porte içermeyen ayrı bir route. Grid ve
overlay kuralları porte olan dokuz duruma uygulanır; metin, hedef ve taşma
kuralları on birine birden.

Porte hücreleri 44 px kuralından ayrı sayılır ve `gridCells` olarak
raporlanır — gizlenmez. Cümle bandı istisnası değişmedi.

## 19. Üretim akışları

`meter-flows.mjs`, üretim komutlarını üretim yüzeyinde yürütür.
**16/16 ulaşıldı, 0 başarısız kontrol, 0 konsol hatası.**

| # | Akış | Sonuç |
|---|---|---|
| 1 | 4/4 → 6/8 önizleme | ✅ cümle var, 0 yazım |
| 2 | İptal | ✅ 0 yazım, 0 history |
| 3 | Uygula | ✅ 1 yazım, undo ne yapacağını söylüyor |
| 4 | Undo/redo | ✅ byte'ı byte'ına |
| 5 | Karışık yerel yükseltme | ✅ önce önizleme |
| 6 | Hızlı dizi | ✅ seçim 0 yazım, uygulama yazıyor |
| 7 | 7/8 gruplama önizleme | ✅ his değişince cümle değişiyor |
| 8 | Pro alanı | ✅ 0 yazım |
| 9 | Zoom + pan | ✅ 0 yazım |
| 10 | Dolu bar reddi | ✅ cümleyle, 0 yazım |
| 11 | Cümle/span korunması | ✅ hiçbiri kaybolmadı |
| 12 | Export açıklaması | ✅ cümle birebir ve görünür |
| 13 | Pro click satırı | ✅ iki seçenek okunur dilde, iki yönde de 0 yazım, 0 history |
| 14 | 7/8 ince click cümlesi | ✅ 4/4'te yok, 7/8'de birebir doğru, model kelimesi yok |
| 15 | Playback sürerken toggle | ✅ transport çalışırken açıldı-kapandı, 0 yazım |
| 16 | Dinleme turu | ✅ yalnız L33 soruluyor; L30/L31/L32 sorulmuyor |

Founder'dan bu akışı elle yapması istenmedi.

## 20. Test / probe / build sonuçları

| Kapı | Sonuç |
|---|---|
| `tsc --noEmit` | temiz |
| ESLint (`src` + `eval`, `--max-warnings 0`) | temiz |
| Production build | başarılı |
| `git diff --check` | temiz |
| Tam süit | **350 dosya / 5714 test**, üç ardışık yeşil |
| Hedefli L31/PCM/metronom paketi | beş ardışık yeşil |
| Probe sonrası hedefli paket | on ardışık yeşil |
| **Kapanış probe'ları** | **36 kırmızı, 0 yeşil kalan, 0 restore hatası** |
| c3 probe paketi (regresyon) | ~~59 kırmızı, 0 yeşil kalan~~ → commit'lenen ağaçta **56 kırmızı / 3 SETUP-FAIL**; gain parity c1'de onarıldı, şimdi **59 kırmızı / 0 SETUP-FAIL / 0 restore hatası** |
| `budget-race` tek başına ×30 | 30/30, timeout değişmedi, retry/skip yok |
| Altı viewport geometry | 66/66 durum, 0 bulgu |
| Üretim akışları | 16/16, 0 bulgu |
| L33 render kontrolü | +8,33 / +8,29 dB, `activeAfterDispose: 0` |
| PCM onset/bar sınırı analizörü | dokuz fixture, `nonFinite: 0`, `clippedFrames: 0` |
| `git status --porcelain` | temiz |

## 21. Satır bütçeleri

Hiçbir bütçe yükseltilmedi veya gevşetilmedi.

| Dosya | Satır | Bütçe |
|---|---|---|
| `Workspace.tsx` | 376 | ≤379 |
| `EditArea.tsx` | 246 | ≤250 |
| `MeterPanel.tsx` | 235 | — |
| `ShelfPanels.tsx` | 271 | — |

Export/ritim mantığı TabCanvas'a yığılmadı, ölçü dönüşümü
ArrangementCanvas'a taşınmadı, runner boyutu üretim bileşeni bütçesine
girmez.

## 22. Açık borçlar

1. **Expressive-voice ile sampler arasındaki 9,92 dB'lik yol farkı.**
   Ölçüldü, iki bağımsız attack'ta doğrulandı, düzeltilmedi. Uygulamadaki
   **her** tekniği etkiler ve düzeltmesi founder'ın zaten onayladığı beş
   kartın sesini değiştirir. Sayı, kontrol ve yeniden üretim komutu
   `L31-ROOT-CAUSE.md` içinde.
2. **Yol farkının mekanik sebebi henüz isimlendirilmedi.** Sabitin kendisi
   (3,133) ölçüldü; hangi düğümün eksik ya da fazla olduğu Tone'un Sampler
   iç yapısında kalıyor ve bu turda açılmadı.
3. **Pro'ya «vurguları ana vuruşlara yerleştir» önerisi eklenmedi.** §7 onu
   zorunlu tutmuyordu; non-destructive öneri + preview + tek transaction
   gerektirdiği için kapsam dışı bırakıldı.

## 23. Ağaç durumu

`HEAD == @{u}`, çalışma ağacı temiz, `7f1fe36` üzerinde toplam altı ileri
commit — bu turun payı **üç**.

Artefaktlar (`eval/rhythm-grid/artifacts/`, `eval/rhythm-grid/wav/`) takip
edilmiyor: her biri kendisini üreten commit'in SHA'sını yazar. Yeniden
üretim:

```sh
npx next build
npx next start -p 3115 &
npx vite build --config eval/rhythm-grid/vite.rhythm-render.config.mts
NO_PROXY='*' SHA=$(git rev-parse HEAD) node eval/rhythm-grid/measure-audio.mjs
SHA=$(git rev-parse HEAD) BASE=http://127.0.0.1:3115 node eval/rhythm-grid/geometry.mjs
SHA=$(git rev-parse HEAD) BASE=http://127.0.0.1:3115 node eval/rhythm-grid/meter-flows.mjs
bash eval/rhythm-grid/probes-completion.sh
bash eval/rhythm-grid/probes.sh
```

## 24. Founder'dan istenen

Yalnız **L33**'ü dinlemek.

> **L33 · Aynı riff, iki belirgin gruplama**
> «Bu kez iki tekrar belirgin biçimde farklı yerlerden gruplanmış gibi
> duyuluyor mu?»

L30 ve L32 tekrar sorulmuyor. L31 arşivde **Olmamış** olarak duruyor ve
L33'ün sonucu onu değiştirmiyor. Hiçbir otomatik ölçüm bu kartı geçirmez:
+8,33 dB'lik fark yalnız farkın **render edildiğini** kanıtlar.

~~**Durum: Faz 2V-D.2 teknik olarak hazır — Haktan yalnız L33 gruplama
farkını dinliyor.** L33 founder PASS'ı gelmeden D.2 fiziksel olarak
kapanmış sayılmaz.
~~

**Bu durum satırı geri alındı (gain parity turu).** O sırada L33 henüz
ölçülmemişti, üç probe SETUP-FAIL veriyordu ve kök neden yanlış
adlandırılmıştı. Yerine geçen durum:

> **Faz 2V-D.2 açık — expressive/plain gain parity ve üç geçersiz probe
> kapanmadı.**

Bu turun sonucu için `eval/audio-parity/REPORT-2V-D2-GAIN-PARITY.md`.
