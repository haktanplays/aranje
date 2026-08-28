# Faz 2T-B · Kullanıcıya Ulaşan Dikey Tamamlama Turu

Başlangıç: `177491e` · Bu turun commit'leri: `8755f79`, `4929fd0`, `bfa87c2`,
`875729a`, ve bu rapor.

Zincir: **yazma → çizim → düzenleme → önizleme → komut → history → storage →
playback → tarayıcı kabulü**. Aşağıdaki her madde bu zincirin neresine
dokunduğunu söyler; dokunmadığı yer varsa onu da söyler.

## Yapılanlar

1. **§3.1 — aynı telde `letRing` düzeltildi.** Aynı fiziksel telde ikinci
   attack, `letRing` olsun olmasın, önceki sounding voice'u bitirir. Aynı anda
   aynı telde iki nota varsa yalnız ilki duyulur, ikincisi `soundingTicks: 0`
   ve `cutByRestrike: true` ile bildirilir. Skor olayı hiç silinmez.
2. **`letRing`'in gerçek işi belirlendi.** Süresi yazılmamış bir nota uzunluğunu
   tie run'dan alır ve tie run *global* bir onset kuralıdır — hangi telde olursa
   olsun bir sonraki dolu slotta biter. `letRing` yalnız bu sınırı kaldırır ve
   notayı kendi teli gerekene kadar çınlatır. Yazılmış bir süreyi uzatmaz.
3. **Fixture C düzeltildi.** Yeniden vurulan iki tel, ikinci vuruşun başladığı
   yerde bitecek şekilde yazıldı. Arpej hâlâ kirli (re-attack anında dört ses
   üst üste, öncesinde altı) ama fiziksel olarak imkânsız same-string polyphony
   üretmiyor.
4. **§3.2 — armoni artık ornament'i koruyor.** Nota iki türe ayrıldı: akor sesi
   ve süsleme. Akor sesi hedef voicing'in *aynı sesine* taşınır (en yakın perde
   değil), süsleme bağlı olduğu yapısal notaya olan tam yarım-ton mesafesini
   korur.
5. **`9–10–9` hücresi dönüşümden sonra `x–(x+1)–x` kalıyor.** Eski "en yakın
   akor sesine yapıştır" kuralı bunu `x–x–x` yapıyordu; komşu, süslediği notaya
   yapışıyordu.
6. **Geçit notası, alt/üst komşu, kromatik yaklaşım, pedal ton, HO/PO süslemesi
   ve farklı telde ses** için ayrı testler yazıldı ve hepsi karakterini koruyor.
7. **Typed preview warning kanalı açıldı.** `unanchored_ornament`,
   `voice_folded`, `articulation_inverted`. Bağlanacak yapısal nota yoksa
   sessizce yapıştırma yok: uyarı üretilir ve nota yalnız kök aralığı kadar
   taşınır. Enstrümanın dışına düşen bir nota bütün dönüşümü reddettirir.
8. **§4 — `timeline.ts` süreyi görüyor.** Span uzunluğu artık tie run değil,
   `soundingSpans`'in söylediği duyulan uzunluk. Süresiz eski şarkılar bire bir
   aynı span'lere dilimleniyor.
9. **Aynı değişiklik playback'i de düzeltti.** Audio scheduler süresini
   `span.endSlot`'tan okuyor; o yüzden 2T'de yazılan `durationTicks` ne ekrana
   ne kulağa ulaşıyordu. Artık ikisine de ulaşıyor.
10. **`sliceSpan`** tick→slot dönüşümünü tek yerde yapıyor, böylece ölçü
    çizgisinin iki yanı farklı ızgaradayken tab ve scheduler ayrı hesap
    yapmıyor.
11. **§4 — gerçek ritim kuyruğu.** Sap, 1/2/3 çengel, tek notanın taşıdığı
    çengel için kanca, nokta, tuplet parantezi, bağ işareti ve es.
12. **Es'ler voice-aware.** Boş yazılmış bir slot, üstünden uzun bir nota
    çınlarken es değildir. Es'ler vuruş çizgisinde bölünür, birleşir.
13. **Vuruş gruplaması ölçü işaretinden geliyor.** 6/8 iki noktalı vuruşta,
    3/4 üç dörtlükte. Ölçü başından kör dörtlere bölme yok. İkincil çengeller
    dörtten uzun grupta yarım vuruşta kırılıyor.
14. **Akor yığını tek ritim.** Altı telli akor kuyrukta bir giriş; sesler farklı
    uzunluktaysa en kısası çizilir ve uyuşmazlık `mixed` ile bildirilir.
15. **Ritim satırı 28 → 34 px.** Perde rakamı bir piksel kaymadı, tel aralığı
    büyümedi, hiçbir ölçü genişlemedi, satır hiç pointer olayı almıyor.
16. **§5 — ızgara çipi kısaldı.** Görünen `Izgara · 16'lık`, okunan
    `Izgara: 16'lık · Her vuruşta 4 adım`. Bir cümlenin iki biçimi.
17. **§6 — süre tutamağı gerçek UI'da.** Nota sheet'inde, çünkü seçili nota
    orada: hücreye dokunmak sheet'i açıyor, sahnedeki bir tutamak arkada kalıp
    parmakla erişilemez olurdu. Sahnede olan şey önizleme.
18. **Kurucu bulgularının dördü de kapandı.** Uzatmak sonraki notayı silmiyor
    (süre notanın kendisinde), bir adım bir adım (jest başlangıcından ölçülen
    tam ızgara adımı), jest sayfa kaydırmasına kaptırılmıyor (pointer capture +
    yalnız o jest süresince scroll kilidi), bir sonraki notada kesilmiyor.
19. **Parmak kalkana kadar hiçbir şey yazılmıyor.** Başladığı yere dönen bir
    sürükleme hiçbir şey yazmaz, yani tutamağa dokunmak history'ye boş adım
    koyamaz. −/+ düğmeleri aynı jesti tam bir adım yapar.
20. **§7 — akor dönüşümleri "Daha fazla" kapısının arkasında.** Kapı kapalı
    başlıyor. Önizleme, uygulamanın çağırdığı saf çekirdeğin aynısını aynı
    şarkı üzerinde çalıştırıp sonucu atıyor: çakışma ve ölçü taşması
    çekirdeğin kendi cümleleriyle geliyor, reddedilmişken düğme kapalı.
21. **§8 — beş dönüşüm tek komut, tek history adımı.** `note_duration`,
    `chord_shape` (üç komut), `retune_harmony`. Her biri için saf düzeyde:
    girdi şarkı değişmiyor, önizleme ile uygulama aynı cevabı veriyor, undo
    öncesini redo sonrasını bire bir veriyor, storage round-trip bir byte
    değiştirmiyor.
22. **History satırları ne yapıldığını söylüyor.** "Akoru arpeje çevirme",
    "Arpeji akora toplama", "Vuruş yönü verme"/"kaldırma", "Nota süresini
    uzatma"/"kısaltma", "Figürü yeni akora taşıma".
23. **§14 — 26 mutasyon probe'u, hepsi adıyla kırmızı.**
    `bash eval/score-truth/probes.sh` → `red: 26   not-red: 0`.
24. **İki probe ilk turda yeşil geldi ve değiştirildi.** P07'nin mutasyonu
    (`ceil`→`floor`) tam kat süreler üzerinde hiçbir şeyi değiştirmiyordu;
    slot ortasında biten bir süreyi ölçen gerçek bir teste yöneltildi. P18'in
    `-t` filtresi test adındaki uzun tireyi hiç eşleştirmemişti — yani sıfır
    test koşmuştu, bu da geçen probe gibi okunuyordu. Runner artık "hiç test
    koşmadı"yı ayrı ve başarısız bir sonuç sayıyor.
25. **§15 — 4 viewport × 21 kontrol, 10 ardışık koşu, hepsi PASS.**
    `320×700`, `390×844`, `412×915` (dokunmatik) ve masaüstü kontrolü
    `1280×800`. Sonuçlar `eval/score-truth/artifacts/ACCEPTANCE.json`.
26. **§20 — doğrulama:** `npm run build` ✓, `npx tsc --noEmit` temiz,
    `npm run lint` temiz, `npm test` **3757/3757 (230 dosya)**. Satır
    bütçeleri: `Workspace.tsx 377` (≤379), `TabCanvas.tsx 440` (≤472),
    `ArrangementCanvas.tsx 470` (≤470). Hiçbiri yükseltilmedi; tab canvas
    yapışkan gutter'ını kendi dosyasına verince düştü.

## Yapılmayanlar — faz bu yüzden kapanmıyor

- **§9 teknik matrisi.** `articulationSchema` hâlâ 11 değer. Dead note, ghost,
  tremolo, natural/pinch harmonic, tapping, slide-in/out, pre-bend, rake,
  sweep, geniş/dar vibrato yazılamıyor. Dört aile (Bağlantı / Perde hareketi /
  Vuruş / Tını ve süre) kurulmadı.
- **§10 HO/PO duyulur farkı ve pick-attack ölçümü.** Legato planlayıcısının
  doğru olduğu 2T'de kanıtlanmıştı; tını farkı ve transient tepe / attack
  süresi / crest factor / tekrar davranışı ölçümü yapılmadı.
- **§11 üç fixture'ın gerçek UI kapılarından yazılabilmesi.** Fixture'lar saf
  çekirdekte var ve test ediliyor; kullanıcının bunları uygulamadan
  yazabildiği gösterilmedi.
- **§12 retune UI.** `retuneHarmony` çekirdeği, uyarı kanalı, history action'ı
  ve etiketi var ve test ediliyor — **ama hiçbir kullanıcı yüzeyi onu
  çağırmıyor.** Bu turda eklenen `retune_harmony` history action'ı şu an
  yalnız testlerden ulaşılabilir durumda; sonraki turun kapısı için duruyor.
- **§13 çalınabilirlik uyarıları** için kullanıcı yüzeyi yok. Aynı telde aynı
  anda iki nota `soundingTicks: 0` ile modelde bildiriliyor ama ekranda
  gösterilmiyor.
- **§16 ses kabulü** yapılmadı. Bu turda hiçbir WAV üretilmedi ve hiçbir
  dinleme iddiası yok.

## Durum

**Faz 2T devam ediyor.**

Fiziksel dinleme dışında da eksikler var: §9, §10, §11, §12, §13 ve §16
kapanmadı. Bu turda çalışan hiçbir şey için "organik duyuldu" ya da "daha
kaliteli oldu" denmedi; ses tarafında yalnız `durationTicks`'in artık
scheduler'a ulaştığı — ölçülebilir, yapısal bir olgu — söylendi.
