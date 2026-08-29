# Faz 2U-A — Founder Editor Acceptance Handoff · Rapor

Yalnız bu turun deltası. 21 madde.

**Founder kabulü verilmedi ve bu rapor vermez.**

---

## 1 · Başlangıç ve final SHA

Başlangıç `5d2bb18`. Final: bu turun ikinci commit'i (aşağıda).

## 2 · Commit zinciri

- `8dae4f0` — isolated founder editor acceptance route
- (bu commit) — route acceptance, probes, handoff artefacts

Amend yok, rebase yok, force-push yok. İki ileri commit, §10'un sınırı.

## 3 · Giriş kapısı

Branch `claude/proje-yorumları-n06wen`, HEAD `5d2bb18`, upstream ile eşit,
tree temiz, `dc8cde8..5d2bb18` beş commit yerinde. Kapı geçildi.

## 4 · Faz 2U-A işlem kanıt tablosu

Sütunlar: **P** production UI binding · **H** tek history adımı · **U**
undo/redo bayt-eş · **S** storage/reload · **B** browser.

| İşlem | P | H | U | S | B |
|---|---|---|---|---|---|
| Devam ile selection uzatma | ✅ c4 | ✅ yazma yok | — n/a | ✅ yazma yok | ✅ parity 5–8 |
| Copy | ✅ | ✅ yazma yok | — n/a | ✅ 0 yazma | ✅ parity 17 |
| Cut | ✅ | ✅ | ⚠️ genel | ✅ 1 yazma | ✅ parity 18 |
| Paste preview/cancel/apply | ✅ | ✅ | ⚠️ genel | ✅ | ⚠️ **kısmi** |
| Duplicate | ✅ | ✅ pure | ⚠️ genel | ⚠️ genel | ❌ **yok** |
| Repeat | ✅ | ✅ pure | ⚠️ genel | ⚠️ genel | ❌ **yok** |
| Zamanda sağ/sol taşı | ✅ | ✅ | ⚠️ genel | ✅ 1 yazma | ✅ parity 14 |
| Yarım ses/oktav taşı | ✅ | ✅ pure | ⚠️ genel | ⚠️ genel | ⚠️ hedef var, uygulanmadı |
| Üst/alt tele taşı | ✅ | ✅ pure | ⚠️ genel | ⚠️ genel | ⚠️ hedef var, uygulanmadı |
| Measure selection | ✅ | — n/a | — n/a | ✅ 0 yazma | ✅ parity 19–20 |
| Insert before/after | ✅ Düzen | ✅ | ⚠️ genel | ⚠️ genel | ⚠️ bar-ops 19 (blank bar) |
| Measure duplicate | ✅ Düzen | ✅ pure | ⚠️ genel | ⚠️ genel | ❌ **yok** |
| Measure delete | ✅ Düzen | ✅ | ⚠️ genel | ✅ bar-ops 16–17 | ✅ bar-ops |
| Measure move | ✅ Düzen | ✅ pure | ⚠️ genel | ⚠️ genel | ❌ **yok** |
| Multi-measure | ✅ Düzen | ✅ pure | ⚠️ genel | ⚠️ genel | ⚠️ bar-ops 5 (yalnız seçim) |

**"⚠️ genel" ne demek:** `history-store.test.ts` mekanizmayı kanıtlıyor —
«bir düzenleme bir yazma ve bir adımdır» (#12), «geri almak aynı baytları
verir» (#24), «yapısal bir bar düzenlemesi tek adımdır» (#17). Bu, her satır
için ayrı ayrı ölçülmüş değil, mekanizma için ölçülmüş demektir.

**Bu tablo tamamlanmış sayılmadı.** Boş hücreler kapatılmadı çünkü onları
kapatmanın dürüst yolu bir insanın işlemleri gerçek UI'da yapması, ve bu
turun teslim ettiği şey tam olarak o. Route'un yedi adımı **bu hücrelerin
her birini** ölçüyor: paste'in tek yazma olduğunu, undo'nun bayt-eş
döndüğünü, sekiz hareketin her birinin tek history olduğunu, ölçü
işlemlerinin iki track'i birden taşıdığını. Founder testi koşulduğunda
tablo kanıtla dolar; şimdi doldurmak uydurmak olurdu.

## 5 · Build / tsc / test / lint

Final HEAD üzerinde taze:

- `npm run build` → exit 0
- `npx tsc --noEmit` → temiz
- `npm test` → **4.121 test geçti**
- `npm run lint` → temiz
- `git status --porcelain` → boş

Başlangıç `5d2bb18` üzerinde de ayrıca koşuldu: build 0, tsc temiz,
4.051 test, lint temiz, tree temiz.

## 6 · Route: yeniden kullanım mı, yeni mi

**İkisi de.** `/eval/android-acceptance` (K-59.1) vardı ama o bir *dinleme*
testi: yedi adımı palm mute, HO/PO, slide, bend, vibrato üzerine. Editör
adımlarını karşılamıyordu, build SHA kapısı yoktu, fixture tek track'liydi.

Yeniden kullanılan şey **izolasyon**: `session.ts`, `memory-storage.ts`,
`fixture-read.ts`, `device-storage.ts`. Tek değişiklik, fixture'ın parametre
olması — böylece iki test tek bir dikişten geçiyor, iki dikiş birbirinden
uzaklaşmıyor.

Yeni olan: `/eval/editor-acceptance`, yedi editör adımı, build kimliği,
iki track'li fixture, sonuç bloğu.

## 7 · İzolasyon

- Gerçek production `Workspace` ve gerçek editör kontrolleri.
- Kendi belleğe yazan deposu; gerçek proje deposuna yazmıyor.
- İkinci kurulum **sessizce devralmıyor**, reddediyor ve ekranda söylüyor.
- Copilot/provider çağrısı yok, analytics yok, izin isteği yok, origin dışı
  istek yok, uygulamadan link yok, `robots: noindex`.

Hepsi `editor-isolation.test.ts` ile bağlandı — dosyaların hangi API'lere
uzanabileceği ve installer'ın ikinci çağrıda ne yaptığı.

## 8 · Fixture

`editor-fixture.ts`: dört ölçü, iki track (gitar + bas), ilk ölçüde bir akor
ve üç tek nota, üç ayrı tel, boş bir yapıştırma hedefi, taşıma/çoğaltma için
boş komşu ölçü, iki bitişik dolu ölçü. Schema geçiyor, hard validator hatası
0. Her pitch fretboard'dan hesaplanıyor, elle yazılmıyor.

**Bas dekorasyon değil.** «İşlem bütün track'lere ulaştı» iddiası tek
track'li bir şarkıda yanlışlanamaz — ilk track'i almakla hepsini almak aynı
cevabı verir. `editor-invariants.test.ts` bunu bir testle gösteriyor:
gitarı çoğaltıp bası bırakan bir mutasyon, ölçü sayısı doğru olduğu için
bar-count kontrolünden geçiyor ve yalnız bas kontrolüne takılıyor.

## 9 · Yedi rehber adımı

Her adım **fazlara** bölündü, her faz kendi ekranı ve kendi «Yaptım»ı.
Toplam 31 ekran.

1. Seçim ve Devam (4 faz) — başlangıç sabit, uç uzuyor, küçülüyor, yazma yok
2. Kopyala ve yapıştır (4 faz) — kopya 0 yazma, iptal 0 yazma, uygula 1 yazma
3. Geri al / ileri al (3 faz) — bayt-eş dönüş
4. Taşı (9 faz) — sekiz hareketin her biri ayrı ekran, her biri tek yazma
5. Nota/ölçü ayrımı (2 faz)
6. Ölçü ve çoklu ölçü (8 faz) — ekle, çoğalt, sağa, sola, çoklu tekrar, tek undo, sil
7. Yerleşim ve sonuç (1 faz + üç soru + not)

**Neden fazlar:** «kopyala, yapıştır, iptal et, tekrar yapıştır» dört
işlemdir ve ilginç oldukları noktalar farklıdır. Adım boyunca ölçülünce
dördü tek sayıya çöker ve rapor artık temiz bir koşuyu yazan bir kopyadan
ayıramaz. Bu aynı zamanda «her ekranda tek görev»in kendisi — dürüst ölçüm
ve nazik yönerge aynı şekle çıktı.

## 10 · Gerçek production kontrol kanıtı

Route hiçbir editör işlemini kendisi yapmıyor. `EditorAcceptance.tsx` içinde
bir `applyTransform`, bir `stage`, bir `commit` çağrısı yok — sayfa yalnız
faz sınırlarında fotoğraf çekiyor ve karşılaştırıyor.

Sayılar da sayfanın kendi tuttuğu sayaçlar değil: şarkının baytları
route'un kendi deposundan, ve **proje kaydının revision'ı**. Uygulama kaydı
her commit edilen düzenlemede bir kez yazıyor, yani bir artan revision bir
history adımı ve bir storage yazması demek — bunu yapan şeyin kendi ağzından.
`setItem` sarmalayıcısı benim «yazma» tanımımı ölçerdi.

## 11 · Sonuç bloğu

«Sonucu kopyala» ve «Baştan dene» var; pano izni olmayan tarayıcıda aynı
metin seçilebilir bir alanda duruyor. Blok handoff'un istediği bütün
satırları taşıyor, kırılan kontrolü **adıyla** yazıyor.

`Automated verdict` yalnız PASS/PARTIAL/FAIL döner. `Founder verdict:
Haktan doldurmadı` bir **sabittir** — temiz otomasyonu founder pass'e
çeviren bir kod yolu yok, ve bir test bunu tutuyor.

## 12 · User storage hash

Gerçek görünen bir proje kaydı (`aranje.project.1`, revision 7) tohumlandı
ve 31 ekranın tamamı yürütüldü:

    BEFORE sha256[0:16] = 87c8f57eb8b05ee9
    AFTER  sha256[0:16] = 87c8f57eb8b05ee9
    identical: true
    keys: aranje.project.1, aranje.projects, not.aranje

Bir baytı oynamadı.

## 13 · Dört viewport

`eval/editor-handoff/verify.mjs` — 21 adım × 4 viewport (320×700, 390×844,
412×915 Android UA, 1363×936 touch=0): **84/84**, 12 ekran görüntüsü.

Kapsananlar: yedi adımın hepsine erişim, geri dönüşün cevabı silmemesi,
restart'ın temiz oturum vermesi, gerçek deponun bayt-eş kalması, 0 origin
dışı istek, 0 izin isteği, 0 body taşması, 44px altı kontrol 0, 0 console
hatası, sonucun kopyalanabilirliği, yanlış SHA'nın bloke etmesi, doğru
SHA'nın geçmesi, ve **hiçbir şey yapılmadan yürütülen bir koşunun pass
raporlamaması** (FAIL çıkıyor).

## 14 · Mutation probe

`eval/editor-handoff/probes.sh` — **30 anlamlı probe, hepsi adıyla kırmızı,
0 vacuous, 0 invalid.** Minimum 16'ydı.

Koşucu «exit non-zero»dan bilerek sert: hiç test koşmaması, yalnız timeout
ve denk mutant üçü de sıfırdan farklı çıkış verir ve hiçbir şey kanıtlamaz.
Bir probe ancak vitest pozitif bir test sayısı **ve** en az bir başarısız
iddia raporladığında sayılıyor.

§9'un listesindeki her madde karşılandı: elle sabitlenmiş SHA (1), yanlış
SHA ile başlatma (2, 3, 4), gerçek depoya bağlanma (5, 6), refresh sonrası
yazma (9), Devam yerine composer (21), nota seçiminde ölçü fiilleri (19),
track sayımıyla tahmin (20), kopya sırasında yazma (11), iptal sonrası
kalıntı (11), iki adımlı undo (10, 12), string move'da pitch (14), ikinci
track'i düşürme (15), çoklu tekrarın iki adımı (10), sonuç kopyasının boşa
çalışması (28), temiz otomasyondan founder PASS (22), sıfır test koşumu ve
timeout (koşucunun kendi kuralları).

## 15 · UI Contract drift

Route production UI'ı **değiştirmiyor**; `Workspace` olduğu gibi mount
ediliyor. Bu turda hiçbir production editör component'i değişmedi —
değişenler `src/lib/acceptance/*`, `src/components/acceptance/*`,
route sayfası, `next.config.ts` ve iki sınır testi.

`selection-verbs.ts`, `SelectionToolbar.tsx`, `TransformSheet.tsx`,
`TabCanvas.tsx`, `Workspace.tsx`, `ArrangementCanvas.tsx`: dokunulmadı.

## 16 · Değişen dosyalar

Yeni: `build-id.ts`, `editor-fixture.ts`, `editor-steps.ts`,
`editor-report.ts`, `editor-invariants.ts` (+ beş test dosyası),
`editor-isolation.test.ts`, `EditorAcceptance.tsx`, `useEditorWatch.ts`,
`app/eval/editor-acceptance/page.tsx`, `eval/editor-handoff/*`.

Değişen: `next.config.ts` (build SHA), `session.ts` (fixture parametresi),
`server-only.test.ts` (SHA istisnası, gerekçesiyle).

## 17 · Satır bütçeleri

Yükseltilmedi ve dokunulmadı: `Workspace.tsx` 377/379,
`TabCanvas.tsx` 440/472, `ArrangementCanvas.tsx` 470/470.
Acceptance mantığı production component'lere konmadı.

## 18 · Clean tree / push

Tree temiz, iki commit push edildi.

## 19 · Public URL ve görünen SHA

**Üretilemedi.** Ekranda görünen SHA yerelde `8dae4f0` olarak doğrulandı
(header, sonuç bloğu ve yanlış-sürüm reddi dâhil), ama telefondan
açılabilecek bir HTTPS adresi yok.

Uydurma adres yazılmadı, production URL'nin güncellendiği varsayılmadı,
loopback adres telefona verilebilir gibi sunulmadı, deployment config
kapsam dışı biçimde değiştirilmedi. QR üretilmedi.

## 20 · Deploy blocker — Haktan'ın tek işlemi

Servis: **Vercel** (spec §14). Bu ortamda Vercel CLI yok, `~/.vercel` yok,
`vercel.json` yok, `VERCEL_*` env yok, repoda bağlı proje kaydı yok. Vercel
projesi oluşturma spec §16'da **sahip aksiyonu**.

Branch push edildi. Bilinen bir production/preview URL yok.

**Tek işlem:** Vercel'de repoyu bir projeye bağla (ya da mevcut projeye bu
branch'i preview olarak aldır).

**Sonrasında beklenen adres:**

    https://<preview-host>/eval/editor-acceptance?sha=<final-commit>

Ayrıntı `HANDOFF.md`'de.

## 21 · Founder verdict hâlâ açık

Bu turda editörü kimse kullanmadı. Route'un kendisi dört viewport'ta
84/84 geçiyor; route testi editörü test etmez. §4'ün tablosundaki boş
hücreler bu paket koşulduğunda kanıtla dolar.

Fiziksel Android/iOS kabulü açık. Ses kalitesi bu turda yeniden açılmadı.
