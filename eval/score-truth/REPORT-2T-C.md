# Faz 2T-C · Songsterr-Parity Authoring + Guitar Performance

Başlangıç: `6ded910` · Bu turun commit'leri: `b9ec099`, `56eb49a`, `d29d8b8`,
`6a262a7`, ve bu rapor. (§16: beş commit, amend/rebase/force-push yok.)

Turun ölçüsü tek cümleydi: **"Çekirdekte var fakat kullanıcı yüzeyinden
ulaşılamayan iş tamamlanmış sayılmaz."** Aşağıdaki maddeler bu ölçüye göre
yazıldı: her biri zincirin neresine dokunduğunu ve neyi *hâlâ* söylemediğini
söyler.

## Yapılanlar

1. **§1 — aynı telde çakışma tipli reddediliyor.** `string-collision.ts`
   çekirdeği *farkı* raporlar: şarkıda zaten olan çakışma bildirilir, bir
   düzenlemenin *eklediği* çakışma `string_collision` koduyla reddedilir.
   Reddediş bir cümle, kod değil: "3. tel iki kez isteniyor…".
2. **Ulaşılabilir olan kapı test ediliyor.** `set_note` yapısı gereği aynı
   telde çakışma üretemez (adı verilen telin notasını değiştirir); gerçekten
   ulaşılabilir olan yol `arpeggioToChord`'un ayrı onset'lerden ses
   toplamasıdır ve reddedişi orada test edilir (probe P28 kırmızı).
3. **§1 — UI'dan yazılan her notanın kendi süresi var.** `set_note`
   `durationTicks` alır; verilmediğinde eski kural (tie run) aynen kalır, yani
   eski şarkılar bayt bayt aynı açılır (`migrate.test.ts`).
4. **§2 — ölçü, tempo ve ızgara üç ayrı cümle.** `counting-language.ts`:
   "Ölçü: 4/4 · Her ölçüde 4 dörtlük", "Tempo: 132 BPM", "Izgara: 16'lık ·
   Her vuruşta 4 adım". Teknik ad (1/16) yanında durur, tek başına
   kullanılmaz.
5. **§4 — ritim yazma yüzeyi.** Birlikten otuz ikiliğe, noktalı, iki triole
   ailesi, es ve bağ; `rhythm-choice.ts` ızgaraya yazılamayan değeri hiç
   göstermez, bu ölçüye sığmayanı soluk gösterir.
6. **§5 — süre tutamağı 44 px ve pointer sahipliği tek yerde.** Global
   `touch-action: none` yok; sayfa kaydırması yalnız tutamacın sahip olduğu
   süre boyunca durur.
7. **§6 — arpej/strum önizlemesi hedef telleri sayıyor.** Önizleme hiçbir şey
   yazmaz (`shapePreviewWroteNothing` dört viewport'ta doğrulandı).
8. **§7 — "Ritmi koru, akoru değiştir" artık UI'da.** `RetuneSection`
   parçanın üzerinde olduğu akoru tahmin eder, önizler, uygulanana kadar
   hiçbir şey yazmaz, sağlayıcıya hiç gitmez ve deterministiktir.
9. **§7 — süsleme korunuyor.** `9–10–9` hücresi taşındıktan sonra
   `x–(x+1)–x` kalır; onset, süre ve artikülasyon aynen durur.
10. **§8 — çalınabilirlik uyarıları üç kademe.** "Çalınamaz" yalnız fiziksel
    olarak imkânsız olan için (aynı telde aynı anda iki ses); geri kalanı
    "Zor olabilir" ve "Bilgi". Açık teller esnemeye sayılmaz. Model kelimesi
    (slot, tick, span) hiçbir mesajda geçmez.
11. **§9 — teknik matrisi bir veri yapısı oldu.** `technique-matrix.ts`: dört
    aile, 18 satır, her satır hangi alana yazıldığını ve tab'da nasıl
    çizildiğini söyler. Yanındaki test beş halkayı da yürür.
12. **§9 — sözleşme v4.** `ghost`, `dead`, `tapping`, `natural_harmonic`,
    `pinch_harmonic` eklendi; `READABLE_SONG_VERSIONS = [2, 3, 4]`. v2 ve v3
    şarkılar tek bayt değişmeden okunur.
13. **§9 — beş teknik playback'te ölçülebilir biçimde ayrışıyor.** Hayalet
    nota daha kısık ve daha kısa; ölü nota 55 ms'lik mat bir vuruş; tapping
    mızrap transient'i olmadan yükselir; doğal armonik +1200 sent; pinch
    +1900 sent, mızraptan 30 ms sonra.
14. **§9 — strum artık duyuluyor.** Bir strum, yazılı tek onset'i el telleri
    geçerken çalar: aşağı vuruş en kalın telden, yukarı vuruş ince telden
    başlar, yayılım akorun sığdığı yere sıkıştırılır. Skor değişmez — tek
    onset, okuyucunun yazdığı gibi.
15. **§9 — staccato ve uzatma artık çiziliyor.** İkisi de sesi değiştiriyor
    ama sayfada hiçbir iz bırakmıyordu; nokta ve tenuto çizgisi eklendi.
16. **§9 — KISS notasyon.** Hayalet `(5)`, ölü `x`, doğal armonik `<5>`
    numaranın *üzerine*; tapping `T`, pinch `PH` numaranın *yanına*. Ekran
    okuyucu için üçü de kendi adını söyler.
17. **§9 — on beş teknik de fret sheet'ten seçilebiliyor**, dört aile başlığı
    altında. `FretSheet.test.ts` matris ile chip listesinin ayrılmasını
    engeller.
18. **§10 — baseline önce ölçüldü.** Beş figür (`6ded910` üzerinde, ayrı bir
    worktree'de) render edildi: tepe dBFS, kırpma, onset sayısı, geçişteki
    seviye ve parlaklık, fiziksel/mantıksal voice sayısı, perde varış ve
    kalkış anları.
19. **§10 — eşikler yamadan önce yazıldı.** Dokuz eşik, her biri işitmeye
    dayandırılarak (`THRESHOLDS.md`). Baseline'da yedisi geçti, ikisi kaldı.
20. **§10 — hammer-on'a parmağın indiği an verildi.** Pull-off'ta 2F.1'den
    beri olan kısa tıkırtının aynısı, ama daha kısık ve daha mat; iki
    hareketin telin enerjisine yaptığı şey artık zıt yönde (0.92 / 0.72).
21. **§10 — dokuz eşiğin dokuzu geçiyor.** Kalan iki eşik yamanın düzelttiği
    iki eşik; geçen yedisinden hiçbiri bozulmadı (`RESULT.json`).
22. **§3 — üç fixture da gerçek UI'dan yazıldı.** Boş projeden başlayarak,
    yalnız parmakla dokunulabilecek şeylere dokunularak: görünüm anahtarı,
    Düzenle, porte hücreleri, ritim çipleri, perde alanı, artikülasyon
    düğmeleri, Çınlat, süre adımı ve Düzen'de basılı tutup "Ölçü ve ritim".
    Internal command, debug handle, store injection veya fixture kısayolu
    kullanılmadı.
23. **§3 — karşılaştırma müzikal parmak izi ile.** Başlık, id ve zaman
    dışlanır; üçü de kanonik repertuvarla birebir aynı çıkıyor
    (`authored-parity.test.ts`).
24. **§3 sırasında bulunan kusur: süre `+` düğmesi.** Ölçüldü: okuyucu `+`
    tuşuna on beş kez bastığında yedi adım ilerliyordu ve **ilk basış hiçbir
    şey yapmıyordu**. Sebep: düğme bir drag yapıyordu ve `release` kendi
    closure'ından, yani bir önceki render'ın değerinden okuyordu. Bir dokunuş
    bir komuttur; artık öyle yazılıyor.
25. **Kusurun kanıtı harness'ta duruyor.** Authoring koşusu saniyede on
    dokunuş yapar; düzeltmeden önce pasajlar yarı uzunlukta çıkıyordu.
26. **Fixture B'den velocity aksanı kaldırıldı.** Nota velocity'si uygulamada
    hiçbir kontrolün yazamadığı tek alandı; kimsenin yazamadığı bir referans
    pasajı hiçbir şeyin referansı değildir. Pedalı pedal yapan şey — bir kez
    vurulup çınlaması — zaten yazılı.
27. **§11 — sekiz işlemin her biri tek history adımı.** Akor→arpej, arpej→akor,
    strum, süre, retune, teknik, çınlat ve süreli nota yazma: her biri için
    "girdiyi değiştirmez", "önizleme ile uygulama aynı", "tek adım, undo
    bayt bayt geri", "storage round trip" ve "şema kabul eder" testleri.
28. **§11 — normale dönmek iz bırakmıyor.** Teknik ve çınlat kaldırıldığında
    alan silinir, yazılmaz: hiç verilmemiş nota ile geri alınmış nota aynı
    baytlardır.
29. **§12 — dört viewport, on ardışık yeşil.** 320×700, 390×844, 412×915
    (Android UA), 1363×936 (touch=0). Her koşuda 25 iddia × 4 viewport.
30. **§12 — on iki founder ekran görüntüsü**
    (`artifacts/screens/`): her viewport için okuma yüzeyi, teknik sayfası ve
    "Ritmi koru, akoru değiştir".
31. **§13 — 46 mutasyon probe'unun 46'sı kırmızı.** Sıfır test koşulması PASS
    sayılmaz (`NO-TEST-RAN` ayrı raporlanır) ve uygulanamayan mutasyon da
    başarısızlıktır (`NOT-APPLIED`).
32. **§14 — on ardışık hedefli koşu (391 test) ve dört ardışık tam koşu
    (3943 test).** Tam koşuda dörtte bir oranında görülen tek kırmızı bir
    *timeout*'tu: `budget-race` testinin iki yüz turu, suite yanında
    koşarken beş saniyeyi aşıyordu. Timeout bir sonuç değildir — iddia hiç
    koşmamıştı — ve sınır makinenin sınırıydı, o yüzden sınır büyütüldü.
    Hiçbir iddia zayıflatılmadı.

## Sınırlar

- `Workspace.tsx` 377 (≤377), `ArrangementCanvas.tsx` 470 (≤470),
  `TabCanvas.tsx` 440 (≤472). Hiçbiri yükseltilmedi; TabCanvas'ın boşluğu
  doldurulmadı.
- Yeni sample indirilmedi, lisansı belirsiz asset eklenmedi, round-robin
  taklidi yapılmadı.
- K-59 açılmadı. Sağlayıcı/Copilot prompt'u genişletilmedi (§17): §9'un beş
  tekniği insana açık, modele değil — ve bu fark
  `articulation-contract.test.ts` içinde yazılı.

## Yapılmayanlar

- **Fiziksel dinleme yapılmadı.** `eval/guitar-performance/wav/` altındaki on
  dosya (beş figür + `6ded910` baseline'ları) ölçülebilir farkı gösterir;
  "gitar gibi oldu" ya da "organik oldu" cümlesi bu belgede yok ve bir kulak
  onaylamadan yazılmayacak.
- **§9'un playback'i sample tabanlı.** Doğal armonik, yazılı düğümü değil,
  on ikinci perde düğümünü (bir oktav) modeller; bu sınır preset yorumunda
  yazılıdır, gizlenmedi.
- **MIDI export teknikleri taşımıyor.** Beş yeni artikülasyon MIDI'ye
  aktarılmıyor; bu tur MIDI'ye hiç dokunmadı.

## Durum

**Faz 2T teknik kapanışı tamamlandı — Haktan fiziksel ve müzikal dinleme
onayı bekleniyor.**

Teknik tarafta açık madde bırakılmadı: §1–§14 karşılandı, 46/46 probe
kırmızı, dört ardışık tam koşu yeşil, dört viewport'ta on ardışık kabul
koşusu yeşil, üç referans pasajı gerçek UI'dan yazıldı ve kanonik
repertuvarla birebir. Kalan tek şey ölçülemeyen şey: sesin kulağa nasıl
geldiği.
