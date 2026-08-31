# Faz 2V-A — Seçimi Dinle + Seçimden Döngü

Bu tur, düzenleyiciden çıkmadan seçilen yeri bir kez duymak ve tekrarlatmakla
ilgilidir. Yeni bir notasyon ya da ses kalitesi denemesi değildir; aşağıdaki
hiçbir sayı «daha iyi duyuluyor» demez.

Aşağıdaki 23 madde **yalnız bu turun deltasıdır.**

---

### 1 · Başlangıç ve final SHA, commit zinciri

- Başlangıç: `db092ea` (2U-C kapanışı)
- `4cd4280` — plan + engine sınırları
- `ae49a29` — çekmece eylemleri + yaşam döngüsü
- `1d408f5` — tarayıcı kabulü + mutasyon probe'ları
- Final: bu commit (spec §13.31 + K-61, rapor artefaktları)

Amend yok, rebase yok, force-push yok. Dört ileri commit; her birinin ağacı
kendi başına yeşildir.

### 2 · Seçim playback planı

`src/lib/playback/selection-playback.ts`. Saf: Song ve tipli
`SelectionDescriptor` alır, `SelectionPlaybackResult` döner — ya bir plan
(`startTicks`, `endTicks`, `trackIds`, `mode`, `onsetCount`), ya tipli bir
ret (`no_selection` · `unknown_section` · `empty_range` · `no_audible_notes`).

Tek ve gerçek bir tehlike vardı: **descriptor tick'leri bölüm-göreli, transport
tick'leri şarkı-mutlaktır.** İkisi yalnız ilk bölümde eşittir, yani tek bölümlü
her fixture'ın geçireceği ama gerçek bir şarkıda yanlış yeri çalacak bir fark.
Fixture bilerek iki bölümlüdür (`selection-playback.test.ts`): `s2`'nin ilk
ölçüsü `768`'dir, `0` değil.

### 3 · Seçim kapsam matrisi

| Seçim | Plan |
|---|---|
| Nota/zaman aralığı | aktif track, seçili tick aralığı |
| Tek enstrüman ölçü aralığı | o track, o ölçüler |
| Bütün enstrümanlar ölçü aralığı | o ölçülerdeki her track |
| Yalnız es | `no_audible_notes` — eylem pasif |
| Boş / geçersiz | `empty_range` / `no_selection` — pasif |

Kapsam descriptor'dan gelir; UI hiçbir yerde track filtrelemez.

**Burada bir kusur ölçülerek bulundu.** İlk hâl duyulabilirliği
`descriptor.onsetCount`'a soruyordu. O alan **yapı gereği melodiktir** —
`sectionSlotStream` davul slot dizilerini `writable: false` işaretler — yani
davul dolu bir ölçü «bu seçimde dinlenecek nota yok» diye grileşiyordu.
Duyulabilirlik artık `buildNotatedPlan`'a, yani motorun gerçekten çalacağı
şeye sorulur.

### 4 · Tek atış: başlangıç ve bitiş

Çalan playback atomik olarak durur, transport seçimin ilk tick'ine oturur,
motor **pencereyle** yeniden schedule edilir, seçimin son tick'inde biten
callback playhead'i başa döndürür ve durur. Tarayıcıda ölçülen (390×844):
`plan=[48,336)`, ilk görülen tick `55`, en uzağı `359`, dinlenme `48`,
`playing → paused` bir kez.

Aralık yarı açıktır: `[startTick, endTick)`.

### 5 · Döngü sınırı ve sürüklenme

`PlaybackLoop` dördüncü bir varyant kazandı (`selection`), ikinci bir loop
alanı değil — §4'ün istediği **tek loop otoritesi** budur; seçim döngüsü
açıldığında bölüm/çalışma döngüsünün yerine geçer, yanında çalışmaz.

- Birim: 50 turda aritmetik sürüklenme `0`.
- Tarayıcı: üç sarmada gözlenen sınır kümesi tek elemanlı (`48-336`), dört
  bağlamda da.

### 6 · Track ve onset filtreleme kanıtı

Motorun içinde tek bir yüklem var (`inWindow`) ve dört döngü de ondan geçiyor:
legato zincirleri, notalar, davullar, metronom. `selection-schedule.test.ts`
gerçek `scheduleSong`'u sahte bir transport'a karşı koşar ve şunları sayar:
kapsam dışı track'ten `0` çağrı, kapsam dışı onset'ten `0` çağrı.

Tarayıcı tarafı bunu göremez ve görebiliyormuş gibi yapmaz: orada ölçülen,
production kablolamasının o scheduler'a **doğru pencereyle** ulaştığıdır
(`ticksBeforeStart=0 ticksPastEnd=0 tracks=["gtr"]`).

### 7 · HO/PO ve diğer teknikler aynı scheduler'dan geçer

Ayrı bir preview synth yazılmadı. Pencere `ScheduleOptions`'a eklenen bir
alandır; ifade planı, `expression.playChain`, strum offset'leri, bend/slide/
vibrato/palm mute yolları değişmedi. `selection-schedule.test.ts` bunu
`src/test/expression-fixtures.ts`'in zaten zincir ürettiği kanıtlanmış
fixture'ıyla ölçer: pencere içindeki legato zinciri `playChain`'den geçer,
pencere dışındaki düşer, ifadeli nota `strumOffsetSeconds`'ını korur.

### 8 · Kuyruk ve taşıma sınırı

- **Başlamadan önce başlamış nota:** yapay atakla içeri sokulmaz. Yarı açık
  aralığın başlangıç kenarı bunu tek başına yapar; bağ (`"-"`) taşıması zaten
  ayrı bir onset değildir.
- **Sonu taşan nota:** yalnız **seste** sınırda kesilir (`clipToWindow`).
  Song event'inin yazılı `durationTicks`'i değişmez ve bu ayrıca ölçülür.

### 9 · Duraklat / devam / geri sar

Transport play/pause mevcut motoru sürer; duraklatıp devam etmek loop
sınırlarını kaybetmez (birim + tarayıcı, dört bağlamda). Aktif seçim döngüsü
sırasında geri sarmak şarkının değil **seçimin** başına döner.

### 10 · Hızlı çift dokunuş ve idempotency

Motor kurulumu asenkrondur, dolayısıyla iki basış tek transport üzerinde iki
schedule bırakabilirdi. Uçuştaki başlatma tutulur; aynı müziği isteyen ikinci
basış aynı basıştır. Ölçülen: iki eşzamanlı `playSelection` → `1` motor kurma,
`1` transport başlatma.

### 11 · Seçim değişimi, iptali, unmount temizliği

Kural tek cümle: **bir koşu, başlatıldığı seçime aittir.** `shouldStopListening`
soruyu ters çevirir — ne çalıyor, ve hâlâ seçili olan o mu? İptal, yeniden
çizim, enstrüman değişimi ve bölüm değişimi bir bileşenin içinden dört ayrı
state değişimi gibi görünür; teker teker ele alan bir hook beşte dördünü ele
alırdı.

Görünümden çıkmak, düzenleyiciyi kapatmak, unmount, ses hatası ve abort seçim
değişimi *değildir* ve olduğu yerde `stop` çağrısıyla karşılanır.

**Testleri önce yazarken iki gerçek kusur çıktı:**

1. Ses hatası, `void`'lenmiş bir press handler'a promise reddi olarak
   fırlatılıyordu — okuyucuya hiçbir şey söylenmiyor, hiçbir şey
   temizlenmiyordu. Artık ordinary playback hatası olarak raporlanır.
2. Motor kurulurken gelen bir abort yok sayılıyordu: iptaller senkron,
   başlatma değil. Bir an sonra geri dönen başlatma, okuyucunun çoktan
   bıraktığı seçimi çalmaya başlıyordu. Bir token bunu kapatır.

Ek olarak `carriedController` seçim döngüsünü **yeni şarkıya taşımaz** — o
tick çifti artık var olmayan bir müziğin üstüne çizilmişti.

### 12 · Song / storage / history / undo

Her iki işlem de tamamen efemerdir.

- Song baytları: değişmez (birim + tarayıcı, `2356 bayt`, dört bağlam).
- Proje kaydı revizyonu: `1 → 1`.
- History adımı: `0`; «Geri al» oturumun başındaki hâlinde kalır.
- Dinleme yolu diskten okunarak denetlenir: `commit(`, `edit-history`,
  `song-store`, `project-storage`, `project-record`, `localStorage`,
  `clipboard` — hiçbiri geçmez.

**Bu sıfırlar vacuous değildir.** Aynı koşuda gerçek bir düzenleme yapılır
(«Sil»), üç okumanın da kımıldaması şart koşulur (`bayt değişti`,
`revizyon 1 → 2`, «Geri al: Seçimi silme» aktif), sonra geri alınır.

`localStorage.setItem` sarmalayarak yazma saymak **bilerek reddedildi**: bu
rota kendi sahip olduğu bir `Map`'i kullanır, o sayaç uygulama ne yaparsa
yapsın sıfır okurdu.

### 13 · Çekmece ve capability sonucu

İki eylem de mevcut «Daha fazla» çekmecesindedir. Ana contextual toolbar'a
düğme veya satır eklenmedi. Karar çekmece **açılmadan önce** verilir:
`selection-capability.ts` `hasAudibleNotes`'u alır ve ya sunar ya
**«Bu seçimde dinlenecek nota yok.»** ile pasifleştirir. Basıldıktan sonra
core'dan ret gelmez — bir ölçünün bütün aralıkları üzerinde süpürülerek
`canRun(offers, "audition") === planned.ok` ölçülür.

`selection-capability.test.ts`'in «nota fiilleri ile ölçü fiilleri ayrık
kümelerdir» iddiası artık **doğru değildir** ve zayıflatılmadı, düzeltildi:
§2 gereği dinleme her iki kapsamda da sunulur, test kesişimi adıyla söyler.

Etiketler: «Seçimi dinle» · «Seçimden döngü» · aktifken «Seçim döngüsünü
kapat». Yeni badge/chip yok.

### 14 · Dört viewport kabulü

`320×700`, `390×844`, `412×915 + Android UA`, `1363×936 · touch=0`.
Bağlam başına 20 kontrol → **80/80**, **10 ardışık koşuda** (800 kontrol,
`artifacts/RUNS.json`).

Production Workspace, production kontroller. Teste özel playback düğmesi yok:
dinleme «Seçimi dinle» basıldığı için başlar, uygulama bittiğine karar
verdiği için biter.

### 15 · Arka plan kayması ve UI Contract ölçümleri

- Staff'ın yatay konumu: oturumun başındakiyle aynı (`0 → 0`), ve aynı adımda
  bir dürtmeyle okumanın kımıldadığı kanıtlanır (`120`).
- Dikey: staff'tan workspace köküne kadar kaydırılabilir kutu sayısı `0` —
  bu **iddia değil rapordur**, çünkü orada bir sıfır layout'un cevabıdır.
- 44px altı kontrol: `0`. Body taşması: `0`. Kırpılan etiket: `0`.
  Uygulama kaynaklı konsol hatası: `0`.

Golden UI Contract ölçümleri gevşetilmedi; eklenen tek şey iki davranışsal
çekmece satırıdır.

### 16 · Mutasyon probe'ları

**32 probe, hepsi adıyla kırmızı, 0 vacuous, 0 invalid.** Koşucu «exit
non-zero»dan serttir: sıfır test koşması ve timeout ayrı ayrı INVALID'dir ve
bulgu sayılmaz.

İki mutant **eşdeğer olduğu için emekli edildi**, yeşil bırakılmadı: hem
«sıfıra kırp» hem «odayı yanlış uçtan ölç» davranışı değiştiremez, çünkü
yalnız pencerenin *içindeki* bir olay hiç kırpılır. Yerine gerçek soru soruldu
— davul şeridi scheduler'da ayrı bir döngüdür ve oradaki bir filtre kaybı
notalarla ilgili her iddiaya görünmezdir.

**Probe'lar üç gerçek boşluk buldu, üçü de benim testlerimdeydi:** bitiş
tick'ine ulaşan bir döngünün durdurulmaması hiç sınanmamıştı; durduktan sonra
bütün şarkının yeniden schedule edilmesi hiç sınanmamıştı; seçim döngüsünün
şarkı değişimiyle karşılaşması hiç sınanmamıştı. Üç test eklendi, hiçbir iddia
zayıflatılmadı.

### 17 · Hedefli paket, 10 ardışık koşu

`src/lib/playback/` + `selection-verbs` + `selection-listening` +
`selection-capability` + `practice/range` + `honesty`: **163 test, 10 ardışık
yeşil.**

### 18 · Tam paket, 4 ardışık koşu

**4.338 test / 267 dosya, 4 ardışık yeşil.**

### 19 · build · tsc · test · lint

Final HEAD üzerinde taze: `npm run build` ✅ · `npx tsc --noEmit` ✅ ·
`npm test` ✅ · `npm run lint` ✅ (0 hata, 0 uyarı).

### 20 · Değişen dosyalar ve satır bütçeleri

27 kaynak dosyası. Bütçeler **yükseltilmedi**:

| Dosya | Sınır | Şimdi |
|---|---|---|
| `Workspace.tsx` | ≤379 | **375** |
| `TabCanvas.tsx` | ≤472 | **456** |
| `ArrangementCanvas.tsx` | ≤470 | **470** |

Workspace bir ara `398`'e çıktı. Bütçe büyütülmedi; davranışı sahiplenen iki
saf birim çıkarıldı — `use-covered-run.ts` (kompozisyon) ve `copilot/gates.ts`
(iki saf okuma).

### 21 · Temiz ağaç ve push

`git status --porcelain` boş; HEAD upstream ile eşit; dört commit de
`claude/proje-yorumları-n06wen` üzerinde push edildi.

### 22 · Fiziksel dinleme yapılmadı

**Bu turda kimse bu sesi dinlemedi.** Ölçülen şey, doğru notaların doğru
pencerede, normal scheduler tarafından schedule edildiğidir. Kabul koşusu
masaüstü Chromium'dur ve kendi raporunda «browser emulation — not a physical
device» yazar; `touch=0` bağlamı fiziksel cihaz kanıtı sayılmaz.

2U-C'nin fiziksel Android seçme/sürükleme kapısı **açılmadı** ve bu turun
teknik başarısı işitsel kaliteyi kendiliğinden onaylamaz.

### 23 · Bundan sonra gerçekten açık olan ürün maddeleri

1. **Edit–dinle akışının kendisi.** Seçip dinlemek teknik olarak çalışıyor;
   akışın bir bestecinin işine yarayıp yaramadığı ölçülmedi.
2. **Fiziksel Android dinleme.** Telefonda gecikme, ses kesilmesi ve ekranın
   uyanık kalması bu ortamda ölçülemez.
3. **Ölçü seçiminden dinleme, gerçek çok enstrümanlı bir şarkıda.** Kapsam
   matrisi ve testler bunu kapsıyor; kimse iki enstrümanlı bir şarkıda oturup
   dinlemedi.
4. **Döngü sırasında düzenleme.** Şu an bir düzenleme seçimi değiştirdiğinde
   koşu durur. Durmak yerine yeni hâli çalmaya devam etmek istenip
   istenmediği bir ürün kararıdır, açık bırakıldı.
5. **Sayım (count-in) ve dinleme.** Seçim dinlemesi count-in kullanmaz;
   çalışırken sayımın istenip istenmediği sorulmadı.

---

**Faz 2V-A teknik olarak hazır — Haktan edit–dinle akışı kabulünü bekliyor.**
