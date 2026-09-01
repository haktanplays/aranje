# Faz 2V-B — Selection Action Canon

Aşağıdaki 25 madde **yalnız bu turun deltasıdır.**

---

### 1 · Başlangıç/final SHA ve commit zinciri

- Başlangıç: `4d4deb3` (2V-A.1 kapanışı)
- `febc76a` — canon + matris testleri + canlı FAIL baseline'ı
- `5d516c5` — bütün production seçim yüzeylerinin canon'a bağlanması
- `ee7a77c` — `/eval/editor-action-batch` + reachability + iki tarayıcı harness'ı
- Final: bu commit (probe'lar, spec §13.33 + K-63, rapor)

Dört ileri commit. Amend, rebase, force-push yok.

### 2 · Yeni LIVE FAIL baseline'ı

Founder'ın yolu, founder'ın build'inde, üretim rotası üzerinden yeniden
üretildi: `/eval/selection-playback?sha=4d4deb3`, `384×740` + Android UA,
gerçek uzun basış + sürükleme ile «4 nota · 1 ölçü», sonra ekranda görünen
gerçek «Daha fazla».

Arkasında:

```
["Kapat", "Seçimi sil", "Vazgeç", "Uygula"]
```

`listen_once` ve `listen_loop` için `rendered = 0`. Baseline `2/4` verir ve
kırmızı olan iki adım tam olarak bunlardır (`artifacts/BASELINE.json`).

Hiçbir şey mount edilmedi, hiçbir state inject edilmedi, test düğmesi
kullanılmadı.

### 3 · 70/70 neden yanlış yeşildi

İki farklı sebeple, ve ikisi de aynı hatanın biçimleri:

- **2V-A koşusu yanlış yüzeyi ölçtü.** `toEditor()` tab'a geçtikten sonra
  «Düzenle»ye basıyordu. O andan sonra ekrandaki «Daha fazla», compact satırın
  çekmecesidir — dinleme fiillerinin gerçekten bulunduğu yer. Founder
  «Düzenle»ye hiç basmaz.
- **2V-A.1 koşusu içeriği hiç açmadı.** Adım 3 «üretim çekmecesi bir dokunuş
  uzakta» diyordu ve kapının *var olduğunu* saydı; kapıyı açıp içine bakmadı.

İkisi de dürüstçe yeşildi ve ikisi de founder'ın açtığı sheet'i hiç görmedi.

### 4 · Bulunan bütün hard-coded action yüzeyleri

| Yüzey | Listeyi taşıyan | Durum |
|---|---|---|
| Okuma ızgarası | `SelectionActionBar` içindeki `PRIMARY` | canon'a bağlandı |
| Okuma «Daha fazla» | `TransformSheet` içindeki `kind === "more"` dalı | dal silindi, `SelectionMoreSheet` |
| Compact satır | `SelectionToolbar` içindeki satır içi dizi | canon'a bağlandı |
| Compact çekmece | `selection-verbs.ts` içindeki `DRAWER_VERBS` | canon'a bağlandı |
| Ölçü satırı | `BarActionBar` içindeki `PRIMARY` + `SCOPE_LABELS` | canon'a bağlandı |

Ölçü sheet'inin yapısal girişleri (`Ölçü ve ritim`, ölçü ekleme, ölçü
yapıştırma) `bar-menu.ts`'te kalır — bunlar seçim eylemi değil, bar yapısı
işlemleridir ve o dosya zaten kapı ile sheet'i tek listeden çizer.

### 5 · Canonical registry mimarisi

`src/lib/song/selection-action-canon.ts`:

- `SelectionActionId` — 12 eylem, tek kelime hazinesi
- `SelectionSurface` — `read_primary`, `edit_primary`, `more_sheet`, `measure_primary`
- `SelectionMode` — `read`, `edit`, `measure`
- `LAYOUT` — mod başına `primary` ve `sheet`, kesişmez
- `VERB_OF` / `MEASURE_VERB_OF` — hangi yeteneği okuduğu
- `OPENS_SHEET` — hangisi başka bir sheet açar
- `WORDS` / `MEASURE_WORDS` — etiket ve ipucu, kapsamın kendi diliyle

Canon **ikinci bir yetenek modeli değildir**: `hidden` bir fiil burada yoktur,
`disabled` bir fiil modelin cümlesini kelimesi kelimesine taşır. Yazmaz,
stage etmez, reddetmez.

Bir sınır testi bileşen kodunda eylem etiketi geçmesini adıyla yasaklar.

### 6 · Seçim × mod × eylem matrisi

`selection-action-canon.test.ts` on seçim türünü — tek nota, tek chord, tek
power chord, çoklu onset range, yalnız es range, drum onset, drum range,
bölüm sonuna dayanmış range, tek enstrüman ölçüsü, tüm enstrümanlar ölçüsü —
üç mod ve iki pano durumuyla çaprazlar ve değişmezleri **çarpım üzerinde**
iddia eder:

- aynı eylem aynı bağlamda iki kez çizilmez
- handler'ı olmayan eylem çizilmez
- capability'nin `available` dediği eylem gizlenmez
- UI'da enabled görünen eylem `canRun` ile daima aynı kararı verir
- disabled sebebi modelin kendi cümlesidir ve kullanıcı dilindedir
- yerleşim değiştirmek availability'yi değiştirmez

### 7 · Primary ve More sheet yerleşimleri

**Okuma (8 + sheet):** `Kopyala · Kes · Çoğalt · Tekrarla · Taşı · Devam ·
Sil · Daha fazla` → sheet: `Yapıştır · Seçimi dinle · Seçimden döngü`.

**Düzenleme (4 + sheet):** `Bağla · Taşı · Devam · Daha fazla` → sheet:
`Kopyala · Kes · Yapıştır · Çoğalt · Tekrarla · Sil · Seçimi dinle ·
Seçimden döngü`.

**Ölçü (7 + sheet):** kapsamın kendi sözleriyle — `Kopyala · Kes ·
İçeriği çoğalt · Tekrarla · İçeriği taşı · İçeriği sil · Daha fazla`
(«Tüm enstrümanlar»da `Ölçüyü çoğalt / Ölçüyü taşı / Ölçüyü kaldır`) →
sheet: bar-menu girişleri + `Seçimi dinle · Seçimden döngü`.

Okuma sheet'inde «Sil» **yoktur**: önündeki ızgarada zaten vardır.

### 8 · «Seçimi dinle» erişimi

Üç yüzeyin üçünde de sheet'te, `rendered = 1`, enabled. Tarayıcıda ölçülen
(384×740, okuma modunda, «Düzenle»ye hiç basılmadan):

```
["Kapat", "Yapıştır — Panoda bir şey yok.", "Seçimi dinle", "Seçimden döngü"]
```

### 9 · «Seçimden döngü» erişimi

Aynı sheet'te, aynı koşullarda. Kontrol çalışırken kendi çıkış yolunu söyler:
harness ilk basışta `aria-label="Seçimden döngü"`, ikinci basışta
`"Seçim döngüsünü kapat"` okur ve ikisi de arasında hiçbir yazma olmaz.

### 10 · «Devam» erişimi

Okuma ızgarasında ve compact satırda, ikisinde de `rendered = 1` ve enabled;
sheet'te **yok**. Basıldığında `aria-pressed="true"` olur, hiçbir şey yazmaz,
ve bölümün son slot'unda «Uzatılacak yer kalmadı.» ile grileşir.

### 11 · Clipboard eylemleri

- «Kopyala» şarkıyı, revizyonu ve storage'ı değiştirmez; hemen ardından
  sheet'teki «Yapıştır» grileşmekten çıkar (aynı koşuda ölçüldü).
- Pano boşken «Yapıştır» **«Panoda bir şey yok.»** ile grileşir — kayıp değil.
- Pano bir ölçü seçiminden gelmişse bir nota seçimine hiç sunulmaz.
- «Yapıştır» stage eder: `Uygula`'ya kadar revizyon kımıldamaz.

### 12 · Yazan eylemlerin atomic history/storage sonucu

`functional.mjs`, beş bağlamda, proje kaydının kendi baytları ve revizyonu
üzerinden:

| Eylem | Revizyon | Bayt |
|---|---|---|
| Çoğalt | `+1` | değişti |
| Sil | `+1` | değişti |
| Kes | `+1` | değişti |
| Taşı (stage → Uygula) | stage `+0`, Uygula `+1` | değişti |
| Tekrarla (stage → Uygula) | stage `+0`, Uygula `+1` | değişti |
| Yapıştır (stage → Uygula) | stage `+0`, Uygula `+1` | değişti |

Uygulama kaydı taahhüt edilen düzenleme başına bir kez yazar; revizyonun bir
artması **bir history adımı ve bir storage yazması** demektir — sayan biz
değiliz, yazan söylüyor.

### 13 · Yazmayan eylemlerin bayt-eş sonucu

«Devam», «Seçimi dinle», «Seçimden döngü», döngüyü kapatma, seçim iptali ve
ölçü kapsamı değiştirme: bayt ve revizyon **aynı**, beş bağlamda.

Bu sıfırlar vacuous değildir: aynı harness aynı koşuda altı gerçek yazma
yapar ve onlar önce kontrol edilir.

### 14 · Undo / redo

Her yazan eylem için, gerçek «Geri al» ve «Yinele» kontrolleriyle:

- geri al → başlangıç baytlarına **bayt-eş** dönüş
- yinele → yazılmış baytlara **bayt-eş** ileri dönüş

Pano aliasing'i ayrıca sınandı: bir koşu kopyalıyor, **kopyalandığı notaları
siliyor**, sonra geri yapıştırıyor — dönen baytlar kopyanın yakaladığı
baytlarla birebir aynı. Pano şarkının içine bir referans tutsaydı geri gelen
şey silme olurdu.

### 15 · Measure scope

«Bu enstrüman» / «Tüm enstrümanlar» seçimi korundu ve dinleme onu dürüstçe
kullanıyor: `describeBarSelection` track kapsamında tek track id, tam kapsamda
hepsini taşır, ve plan bu descriptor'dan kurulur. Harness her iki kapsamda da
sheet'te iki dinleme eylemini `rendered = 1` bulur.

Kapsam değiştirmek hiçbir şey yazmaz.

### 16 · Reachability denetimi

`artifacts/REACHABILITY.json`, `selection-reachability.test.ts` tarafından
**üretildi** — elle doldurulmadı.

- satır: **404**
- gizli ama available: **0**
- çift render: **0**
- handler'sız render: **0**
- her `available` satır `rendered = 1`
- her `disabled` satır `rendered ≤ 1`
- her handler adıyla doğru operasyona gider (`copy → clipboard.copy`,
  `cut → transform.cut_selection`, `listen_loop → transport.playSelection(loop)` …)

### 17 · Beş viewport

`320×700`, `384×740 + Android UA`, `390×844`, `412×915 + Android UA`,
`1363×936 · touch=0`.

- `actions.mjs`: 17 kontrol × 5 = **85/85**
- `functional.mjs`: 14 kontrol × 5 = **70/70**

Ölçülen geometri: 44 px altı hedef `0`, kırpılmış etiket `0`, body taşması
`0`, üçüncü toolbar satırı `0` (ızgara iki satır), tel `12`, arka plan scroll
kayması `0`, konsol hatası `0`.

### 18 · 10 ardışık tarayıcı koşusu

`runs.sh` iki harness'ı da on kez arka arkaya koşar ve `artifacts/RUNS.json`
yazar; `everyRunGreen` tek satırlık karardır — on koşunun biri kırmızıysa seri
kırmızıdır.

Seri, üretim kodu final HEAD ile **birebir aynı** olan `ee7a77c` build'i
üzerinde alındı: bu turun son commit'i test, probe, spec ve rapor ekler, ve
production tarafında yalnız bir doküman yorumunu yeniden yazar
(`useAcceptanceReading.ts` — §20). Rotanın davranışı değişmez.

_(seri bitince sayıları buraya yazılır; koşu sırasında rapor edilmez)_

### 19 · Mutation probe'ları

**52 probe.** On biri canon'un yerleşiminden tek tek bir eylemi kaldırır;
gerisi yerleşimi yanlış yüzeye taşır, available bir yeteneği çizilmeden
düşürür, aynı eylemi iki kez çizdirir, handler eşlemesini bozar, yüzeyleri
sabit listeye döndürür, yetenek modelini bozar, founder bloğunun dürüstlüğünü
bozar ve rotanın izolasyonunu deler.

**İlk turda beş probe yeşil geldi ve beşi de benim testlerimdeki gerçek
boşluklardı** — mutant zayıflığı değil:

- `hidden` bir fiilin çizilmemesi ve handler'ı olmayan bir eylemin
  çizilmemesi, gerçek matriste hiçbir yerleşimin ulaşmadığı iki korumaydı;
  artık canon'a doğrudan, elle kurulmuş bir offers listesi ve daraltılmış bir
  handler kümesiyle soruluyor.
- Okuma sheet'inin kaynak iddiası `onSurface(read, "more_sheet")` alt dizisini
  arıyordu; sonuna eklenen bir `.filter(...)` bunu geçiyordu. Artık prop'un
  tamamı pinlenmiş.
- Ölçü satırının «Taşı»sının **«Taşınacak yer yok.»** ile grileştiği hiçbir
  yerde yazılı değildi; matris availability'yi `canRun`'a karşı sınıyordu ve
  ikisi aynı mutasyonu paylaşıyordu.
- `OPENS_SHEET` hiç sınanmamıştı — yani «Yapıştır»ın açtığı sheet'in
  kapanmaması kuralı test edilmiyordu.

Beşi de kapatıldıktan sonra beşi de adıyla kırmızı (tek tek doğrulandı ve
sonra tam tur tekrarlandı).

**İkinci tam tur: 52 probe, hepsi adıyla kırmızı, 0 vacuous, 0 invalid**
(`artifacts/PROBES.log`).

### 20 · Targeted / full suite

- Hedefli paket (canon, reachability, verbs, batch, power chord, izolasyon,
  capability): **168 test, 10 ardışık yeşil**
- Tam paket: **4.473 test / 272 dosya, 4 ardışık yeşil**

**Tam paket bir gerçek ihlali yakaladı ve kayda geçiyor.** Yeni
`useAcceptanceReading.ts` `src/components/` altındadır ve doküman yorumunda
`localStorage` kelimesi geçiyordu; §138 sınır kuralı bileşen kaynağını
metin olarak tarar ve **dört koşuda dördünde de** kırmızı verdi. Dosya o API'ye
hiç dokunmuyor — açıklama, kod tabanının zaten kullandığı «cihazın kendi
deposu» adıyla yeniden yazıldı; kural zayıflatılmadı.

### 21 · build · tsc · test · lint

Dördü de temiz: `npm run build` `0`, `npx tsc --noEmit` `0`, tam paket
`4473/4473`, `npm run lint` `0` hata `0` uyarı.

### 22 · Dosyalar ve satır bütçeleri

Bütçeler **yükseltilmedi**:

| Dosya | Sınır | Şimdi |
|---|---|---|
| `Workspace.tsx` | ≤379 | **376** |
| `TabCanvas.tsx` | ≤472 | **456** |
| `ArrangementCanvas.tsx` | ≤470 | **470** |

Eylem kararı bileşenlerde kalmadı: saf registry `selection-action-canon.ts`,
bağlama `selection-verbs.ts`, rehber mantığı `batch-steps.ts` +
`batch-report.ts`. Rota bileşeni yalnız çizer ve ölçer.

### 23 · Temiz ağaç ve push

`git status --porcelain` boş, HEAD upstream ile eşit, commit'lerin hepsi
`claude/proje-yorumları-n06wen` üzerinde.

### 24 · Fiziksel founder testi yapılmadı

**Bu turda kimse bu sesi dinlemedi ve kimse bu ekranlara telefonda
dokunmadı.** Ölçülen şey erişilebilirlik ve yazma davranışıdır. Kabul
koşuları masaüstü Chromium'dur ve kendi artefaktlarında «browser emulation —
not a physical device» yazar; `touch=0` bağlamı fiziksel cihaz kanıtı
sayılmaz ve `batchVerdict` bunu bir kural olarak uygular.

2U-C fiziksel sürükleme kapısı açılmadı. K-61 ve K-62 kendiliğinden
onaylanmadı.

### 25 · Founder linki

```
https://<public-host>/eval/editor-action-batch?sha=<FINAL_SHA>
```

Eski `/eval/editor-acceptance` ve `/eval/selection-playback` rotaları
founder'a tekrar verilmedi.

---

**Selection Action Canon teknik olarak hazır — Haktan tek toplu
editor-action kabulünü bekliyor.**
