# Faz 2U-C — güvenilir çoklu seçim, nota aralığı, kenar takibi

**Bu turun kapanış ölçütü karşılanmadı.** Fiziksel Android doğrulaması
(`HANDOFF.md`) yapılmadı; aşağıdaki her ölçüm **tarayıcı emülasyonudur**.

---

## 1. Turun öncülü

2U-B'nin otomasyon raporu (108/108 × 10 koşum) teknik olarak duruyor. Gerçek
bir Android telefonda alınan sonuç ise onu çürüttü:

> «Ölçüye basılı tutulup sağa/sola sürüklendiğinde seçim genişlemiyor; arkadaki
> tab yüzeyi kayıyor.»

İkisi de dürüsttü. Harness yanlış yüzeyi ölçüyordu.

## 2. Eski harness'ın tam olarak neyi kaçırdığı

`eval/editor-2ub/verify.mjs` adım 20, "arkadaki sayfa kaymadı" iddiasını
`document.scrollingElement.scrollTop` üzerinden kuruyordu. Kabul rotası
`overflow-hidden`; o değer hareketten bağımsız olarak **yapısal biçimde 0**.
Founder'ın kaydığını gördüğü yüzey — tab'ın kendi `scrollLeft`'i — hiç
sorgulanmamıştı. Bu turun harness'ında her kaydırma iddiası okuduğu elemanı
adıyla söyler ve birincil ölçü tab'ın `scrollLeft`'idir.

## 3. Kök neden — ölçülerek bulundu, tahmin edilmedi

`touch-action` bir hareket **başlarken** kilitlenir; derleyiciye "sayfayı
beklemeden hangi kaydırmayı yapabilirsin" sözüdür. Ölçü başlığı `pan-x`
diyordu — yani bu hareketin sahip olması gereken ekseni önceden veriyordu.
Ölçüm (412×915 Android emülasyonu, CDP dokunma):

| deneme | önce (`pan-x`) | sonra (`pan-y`) |
|---|---|---|
| başlıktan anlık yana kaydırma | `scrollLeft` 0 → **205** | 0 → **0** |
| basılı tut + kenarda bekle | 0 → 0, "1 ölçü"de takılı | 0 → **1416**, "1 → 2 → 3 → 4 ölçü" |

Timer'a dokunulmadı. `LONG_PRESS_MS` hâlâ 500, tolerans hâlâ 10px.

## 4. İkinci kök neden — bitişteki tıklama

Ölçü bloğu seek eden bir `<button>`. Dokunma biten yerde bir `click` üretir, bu
yüzden 1. ölçüyü tutup 3'e uzanıp bırakmak, parmağın kalktığı ölçüye `open_bar`
gönderiyor ve görüntüyü oraya taşıyordu — aynı kayan yüzey, hareketin *içinde*
değil bir kare sonrasında. `touch-action` bunu engelleyemez; kaydırma değil.
`swallowNextClick` artık ortak bir modül ve sürükleme de kendi tıklamasını
harcıyor — yalnızca gerçekten sahiplendiyse.

## 5. Üçüncü kök neden — dinleyici geç geliyordu

Chrome bir hareketi hangi dinleyicilerin durdurabileceğine **touchstart'ta**
karar veriyor. Uzun basış tanındığında eklenen `{ passive: false }` bir
`touchmove` dinleyicisi, o sekans boyunca passive sayılıyor: `preventDefault`
çalışmıyor, derleyici kaydırıyor, Chrome `pointercancel` gönderiyor. Ölçüm:
tanınmış bir nota sürüklemesinde 20 dokunma hareketi → **1 pointermove, 1
pointercancel**, aralık hiç büyümedi. Dinleyici mount'ta kurulup sahipliği bir
ref'ten okuyunca: **her harekete bir pointermove, 0 pointercancel**.

## 6. Dördüncü kök neden — her render'da kendini bırakan hareket

`useEdgeFollow` her render'da yeni bir nesne döndürüyordu; ona kapanan her
callback de yenileniyor, ona bağlı teardown effect'i de **her render'da
cleanup'ını çalıştırıyordu**. Hareket, kendini tanıdıktan bir kare sonra
bırakıyordu. Dışarıdan görünüşü: bir nota seçiliyor ve büyümüyor. Aynı hata
paylaşılan çekirdek çıkarılırken ölçü sürüklemesini de sessizce bozmuştu.

## 7. Beşinci kök neden — masaüstünde native drag

Fare ile ölçü numaraları üzerinde yana sürüklemek native drag-and-drop
başlatıyor: `dragstart`, hemen ardından `pointercancel`, ve seçim düğme hâlâ
basılıyken ölüyor. `dragstart` ve `selectstart` artık sahiplik sürerken
reddediliyor.

## 8. Altıncı kök neden — kendi bitişini duymayan hareket

Tab yatay windowing yapıyor: üç ölçü ilerleyen bir uzanma, parmağın indiği
ölçüyü DOM'dan kaldırıyor ve React onun dinleyicilerini de götürüyor.
`pointerup` boşluğa düşüyor, sürükleme hiç bırakmıyor. 320px koşumunda
**parmak kalktıktan sonra hâlâ tıklayan bir edge-follow interval'i** olarak
ölçüldü. Artık `document` da bitişi duyuyor; iki kez bırakmak bir kez
bırakmaktır.

## 9. `touch-action: none` kullanılmadı

Ne global ne de porte üzerinde. `declaredTouchAction` tek yer; `none` yalnızca
süre tutamağına ait, `pan-y` yalnızca 22px'lik başlık şeridine. Porte gövdesi
`auto` kalıyor ve iki yöne de eskisi gibi kayıyor — harness bunu her viewport'ta
ayrıca ölçüyor (adım 3 ve 16).

## 10. Nota aralığı (§3)

Bir notaya basılı tutmak akoru seçiyor; parmak kalkmadan sağa uzanmak aralığı
slot slot büyütüyor, geri gelmek küçültüyor. Ölçüm (412×915): band 34px (1
slot) → 204px (6 slot); kenarda bekleyince `scrollLeft` 0 → 1200 ve 46 slot.
Dikey sapma bilerek okunmuyor: aralık tek bir track üzerinde tick aralığı, yani
başparmak yarım satır kaysa bile aynı müziği adlandırıyor.

## 11. Sahiplik sırası tek yerde (§3)

`pointer-ownership.ts`. Sıra ve brief'ten farklı olduğu tek yer orada yazılı:
tanınmış iki sürükleme her şeyin üstünde, çünkü pointerdown'da karar
verilmeyen tek girdiler onlar; altında sıra brief'in sırası (yer, sonra alet).
Kalem elde iken hiçbir aralık sürüklemesi kurulmuyor, dolayısıyla "kalem nota
aralığının üstünde" gözlemlenebilir her yerde sağlanıyor.

## 12. Dürüst sınır — emülasyonun kapatamadığı yer

`declaresBeforeGesture` bunu koda yazıyor: nota aralığı porte gövdesinde
başlıyor, herkesin tab'ı kaydırdığı yüzey, dolayısıyla bir ekseni önceden
rezerve edemez ve sahipliği aldıktan sonra her `touchmove`'u reddetmeye
dayanır. Emülasyonda çalışıyor; cihazda çalıştığını yalnızca fiziksel adım
gösterebilir.

## 13. Kenar takibi (§4)

Sabit adım, koordinata bağlı olmayan hız: 12px/16ms ≈ 750px/s ≈ 1.4 ölçü/s.
Bant 44px (dokunma hedefi alt sınırı). Tick hem kaydırıyor **hem de** hareketsiz
parmağın altındakini yeniden okuyor — `followTick` bu ikiliyi tek fonksiyonda
tutuyor ve testi ikisini birden ölçüyor. Kenardan çıkınca tick anında duruyor.
Yeni toolbar, chip, row veya modal eklenmedi; canlı özet mevcut UI Contract'ın
kendi satırında ("Gitar · 3 ölçü").

## 14. Dört viewport kabulü (§6)

`eval/editor-2uc/verify.mjs` — 320×700, 390×844, 412×915 + Android UA,
1363×936 (touch=0). 18 ölçüm × 4 viewport = **72/72**,
`artifacts/RESULTS.json`. Çekirdek dizi her viewport'ta geçiyor: 1 ölçü → 3
ölçü → 2 ölçü, bırakma, sürükleme boyunca `scrollLeft` sabit, `scrollTop` 0,
seek yok, açık timer yok.

Kararlılık: aynı build üzerinde **10 ardışık koşum, hepsi 72/72**
(`/tmp` dışına taşınan tek çıktı `artifacts/RESULTS.json`'dır; o dosya son
koşumun sonucudur). Bu sayı yine de yalnızca tarayıcı emülasyonunun
kararlılığını gösterir — bir tur önce "108/108 × 10" fiziksel kanıt sanıldığı
için burada tekrar söylemek gerekiyor: tekrar sayısı, kanıtın *cinsini*
değiştirmez.

## 15. Harness'ın kendi hataları (dürüstlük kaydı)

İlk koşumda 17 FAIL vardı. Altısı üründe gerçek kusurdu (§5–§8) ve düzeltildi.
Kalanı harness'ın kendi hatasıydı ve **kod zayıflatılarak değil, ölçüm
düzeltilerek** kapatıldı: masaüstünde fare sürüklemesi zaten bir kaydırıcıyı
kaydırmaz (tekerlek kullanıldı); adım 5 ölçüm ortasında tab'ı kaydırıyordu;
"seek oldu mu" sorusu kaydırma konumu yerine playhead'e soruldu; açık timer
sayısı sıfırla değil hareketten önceki sayıyla karşılaştırıldı; 320px'de basış
yapışkan gutter'ın altına iniyordu.

## 16. Mutasyon probe'ları (§8)

`eval/editor-2uc/probes.sh` — **31 kırmızı, 0 vacuous, 0 invalid**. Altısı
bugün kodun gerçekten içinde bulunduğu hâl. İlk koşumda iki tanesi yeşildi;
ikisi de gerçek boşluktu ve probe gevşetilerek değil test güçlendirilerek
kapatıldı (`followTick` çıkarıldı, iki hook'un biteceği ayrı ayrı iddia
edildi). Sıfır test, timeout ve equivalent mutant koşucu tarafından ayrıca
raporlanıyor ve toplama dahil edilmiyor.

## 17. Birim testleri ve sınırlar

`npm test` — 4236 test, 257 dosya, hepsi yeşil. Yeni: `press-drag.test.ts` (11),
`drag-ownership.test.ts` (15), `swallow-click.test.ts` (5),
`pointer-ownership.test.ts` +11, `interaction-boundary.test.ts` +9,
`honesty.test.ts` (8). Satır bütçeleri yükseltilmedi: Workspace 377 (≤379),
ArrangementCanvas 470 (≤470), MultiTrackCanvas 340 (≤500), TabCanvas 456
(≤480).

## 18. Kapsam

UI Contract yeniden tasarlanmadı, yeni toolbar/sheet/chip/row/modal eklenmedi,
yeni müzik tekniği yok, Song/Expression Contract değişmedi, ses motoruna
dokunulmadı, Copilot/provider yok, APK/Capacitor yok, analytics yok. K-59
açılmadı. Kullanıcının kendi projesine yazılmadı — harness her viewport'ta
sentinel'i geri okuyor (adım 17).

## 19. Commit'ler

Üç ileri commit, amend/rebase/force-push yok:

1. `67e66d2` — gerçek pointer/touch sahiplik düzeltmesi
2. `4df18c5` — nota aralığı + kenar takibi, paylaşılan çekirdek
3. (bu commit) — kabul, probe'lar, fiziksel teslim, rapor

## 20. Sıradaki tek adım

`eval/editor-2uc/HANDOFF.md`. Deploy sonrası gerçek bir Android telefonda,
tam SHA'lı rotada, arkadaki yüzey kaymadan **"1 → 3 → 2 ölçü"**. O yapılana
kadar bu turun sonucu "browser emulation 72/72"dir ve başka bir şey değildir.
Eski "108/108" fiziksel kanıt olarak tekrar edilmiyor.
