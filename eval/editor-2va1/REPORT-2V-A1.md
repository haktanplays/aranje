# Faz 2V-A.1 — Canlı «Devam» FAIL'i kapatma + gerçek dinleme rotası

Aşağıdaki 21 madde **yalnız bu turun deltasıdır.**

---

### 1 · Başlangıç/final SHA ve commit zinciri

- Başlangıç: `057f405` (2V-A kapanışı)
- `52bdfe1` — power-chord «Devam» yeteneği + değişmezler
- `a0c05c8` — editör kabulünün canlı FAIL düzeltmesi (2/36 → 3/36)
- `8cf82f3` — `/eval/selection-playback` founder rotası
- Final: bu commit (kabul koşuları, probe'lar, spec §13.32 + K-62, rapor)

Dört ileri commit. Amend, rebase, force-push yok.

### 2 · Canlı FAIL'in yeniden üretimi

Founder'ın bildirdiği ekran, kendi viewport'unda ve kendi user-agent'ıyla,
production rotası üzerinden yeniden üretildi: `384×740`, Android UA, Tab'a
geç, ilk akora basılı tut → **«1 power chord · 3 nota»**, ve ekranda
`Kopyala · Kes · Çoğalt · Tekrarla · Taşı · Sil · Daha fazla`.

«Düzenle»ye hiç basılmaz. Okuma modunda tab'da `[data-cell]` yoktur; seçim
staff gövdesine uzun basışla açılır ve o an çizilen çubuk okuma yüzeyinin
kendi çubuğudur.

`devam.mjs`, sekizinci girişi çıkarılmış bir build'e karşı **10/14** verir ve
kırmızı adımlar **4, 5, 6, 7**'dir.

### 3 · «Devam»ın kaybolma nedeni

**Bariz şüphelilerin hepsi masumdu ve bu ölçülerek gösterildi.** Yetenek
modeli power chord için `extend`'i zaten `available` yanıtlıyordu; compact
toolbar (`Bağla · Taşı · Devam · Daha fazla`) onu K-59'dan beri çiziyordu.

Ekrandaki yedi fiillik liste **`SelectionActionBar`**'dır — okuma yüzeyinin
uzun çubuğu — ve fiilleri modele hiçbir şey sormayan sabit bir listeydi.
Compact satır yalnız `editing` doğruyken var olur; rehber «Düzenle»ye basmayı
istemez. Yani model sunuyor, çizen liste taşımıyor: 2U-B pano kusurunun aynı
şekli.

### 4 · Capability düzeltmesi

İki düzeltme, biri yüzeyde biri modelde.

**Yüzey:** iki seçim eylem çubuğu artık aynı fonksiyona sorar
(`selectionOffers`), ve o fonksiyon okuyucunun yazıp yazmadığını sormaz —
«bu koşuya ne yapılabilir» müzikal bir sorudur.

**Model:** `extend` koşulsuz `available` idi. Bu neredeyse her yerde doğru,
bölümün son slot'undaki tek slotluk bir seçimde yanlıştır. `hasExtendTarget`
cevabı bölümün kendi slot'larından üretir (`selection-extend.ts`), boolean
olarak `CapabilityContext`'e verilir — yetenek modeli Song'u almama sözünü
korur — ve kontrol **«Uzatılacak yer kalmadı.»** ile grileşir.

### 5 · Power chord extension sonucu

Tarayıcıda ölçülen (384×740): bant `{left:34,width:34}` →
`{left:34,width:306}`. **Yakın kenar kımıldamaz, uzak kenar taşınır.**
Özet «1 power chord · 3 nota» → «5 nota · 1 ölçü» olur; uygulama haklıdır —
dokuz slot boyunca beş nota bir koşudur, tek akor değil.

### 6 · Üç akor sesinin korunması

Birim: `stringIndexes` uzatmadan önce ve sonra `[0, 1, 2]`; `eventIds` sayısı
artar. Tarayıcı: uzatma sonrası tutulan nota sayısı ≥ 3 ve bandın sol kenarı
hiç kımıldamaz — akorun kendi slot'u koşunun içinde kalır.

### 7 · Song / storage / history

Kolu kurmak ve uzatmak hiçbir şey yazmaz.

- Song baytları: `2356`, aynı (beş bağlamda).
- Proje kaydı revizyonu: `1 → 1`.
- Kaynak denetimi: uzatma dalı `apply(`, `commit`, `copy`, `stage`,
  `localStorage` adlarının hiçbirini geçirmez; `moveEdge` yalnız
  `transform.select(next)` çağırır.

**Bu sıfırlar vacuous değildir:** aynı koşuda «Sil» ile gerçek bir düzenleme
yapılır, bayt ve revizyon değişmek zorundadır (`1 → 2`), sonra geri alınır.

### 8 · 2/36 → 3/36

Rehber ilerledi ve **kendi kararıyla** ilerledi. «Devam» adımı `no_write`
bekliyordu; hiçbir şeye dokunmadan «Yaptım»a basmak da hiçbir şey yazmaz, ve
bir rehberin ekranda olmayan bir kontrolü onaylamasının yolu tam olarak
budur. Adım artık `armed` bekler ve cevabı okuyucunun bastığı kontrolün
`aria-pressed`'inden alır.

Harness sayaçla yetinmez: sayfanın kaydettiği `extendSelected` ve
`extendArmed` doğru olmalıdır. Sayaç geçse de geçmese de ilerler.

### 9 · UI Contract ve geometri

- «Devam» **ana seçim eylem ızgarasında**, «Daha fazla»nın içinde değil.
- Dört sütun korundu; sekiz hedef yedinin yaptığı **iki satırın aynısı**.
  Üçüncü satır yok, staff yüksekliği düşmedi, tel kaybı yok.
- `320×700`: `73×44`. `384×740`: `89×44`. Kırpılma yok.
- Erişilebilir ad canlıyken **«Devam»**; grileştiğinde «Devam — <sebep>».
- 44px altı kontrol `0`, body taşması `0` (beş bağlam).

UI Contract v2 yapılmadı, toolbar yeniden tasarlanmadı.

### 10 · Gerçek 2V-A founder rotasının tam yolu

```
/eval/selection-playback?sha=<FINAL_SHA>
```

`noindex`, hiçbir yerden linklenmemiş, izole bellek deposu, production
Workspace + production çekmece + production audio engine. Sign-in yok,
sağlayıcı yok, Copilot yok, otomatik playback yok. **Sayfanın kendi playback
kontrolü yoktur**; ilk ses okuyucunun production çekmecesine dokunuşuyla
başlar ve bir sınır testi bunu dosyadan okur.

Eski `/eval/editor-acceptance` rotası 2V-A dinleme sonucu olarak yeniden
verilmedi.

### 11 · Exact-SHA kapısı

`?sha=` linkteki commit'i taşır. Yanlış sha ile açıldığında rota **testi
başlatmaz**: reddi çizer, staff hiç çizilmez (`refusal=1 staff drawn=0`).
Doğru sha ile açıldığında başlar (`strings=12`). Her iki hâl de beş bağlamda
ölçüldü.

### 12 · Sekiz adımın erişilebilirliği

Sekiz adım da erişilebilir, her ekranda tek görev:

1. Bir yer seç · 2. Seçimi bir kez dinle · 3. Seçimden döngü (≥3 tur) ·
4. Duraklat ve devam et · 5. Seçimi iptal et · 6. İki ölçü, bu enstrüman ·
7. Aynı ölçüler, tüm enstrümanlar · 8. Sonuç

Adımların en az beşi doğrudan bir production kontrolünü adıyla söyler.
Hiçbir adımda tick/slot/scope/scheduler/schema/validator/commit geçmez.
Her cevap düğmesi ≥44px ve kırpılmamış.

### 13 · Sonuç bloğu

Blok şu satırları taşır: build SHA, tarih, ekran, dokunma noktası, **ortam**,
Functional (proje değişmedi mi, konsol hatası sayısı), Listening (seçim; tek
dinleme başlangıç/kapsam/bitiş; üç loop turu — boşluk, çift atak, tempo;
duraklat/devam; iptal temizliği; tek enstrüman kapsamı; tüm enstrüman
kapsamı), cevaplanmamış soru sayısı, kararsız cevap sayısı, kullanıcı notu,
Verdict.

Kurallar: ölçülen kırılma → `FAIL`; eksik/belirsiz → `PARTIAL`;
**`touch=0` → asla `PASS`**; gerçek dokunmatik cihaz + bütün zorunlu cevaplar
olumlu → `PASS`. Blok hiçbir yerde sesin nasıl olduğuna dair bir iddia
taşımaz.

### 14 · Beş viewport

`320×700`, `384×740 + Android UA`, `390×844`, `412×915 + Android UA`,
`1363×936 · touch=0`.

- Devam regresyonu: 14 kontrol × 5 = **70/70**
- Founder rotası: 14 kontrol × 5 = **70/70**

### 15 · 10 ardışık kabul koşusu

İki harness da **10 ardışık koşuda** tam yeşil — 1.400 kontrol,
`artifacts/RUNS.json`.

### 16 · Mutasyon probe'ları

**32 probe, hepsi adıyla kırmızı, 0 vacuous, 0 invalid.**

İlk turda iki probe yeşil geldi ve ikisi de **benim testlerimdeki gerçek
boşluklardı**, mutant zayıflığı değil:

- dosya geneli `moveEdge("end", …)` araması, kollu dalın *yakın* kenarı
  taşımasıyla yeşil kalıyordu — artık dal dilimlenerek sınanıyor;
- rehberin kolu nereden okuduğu hiç sınanmamıştı — artık `aria-pressed`
  okuması adıyla pinlenmiş.

Ayrıca iki harness adımı kendini tarif ediyordu ve düzeltildi: uzatmadan
sonra özetin hâlâ «power chord» diyeceği varsayımı (uygulama haklı), ve
`320×700`'de eylem çubuğunun altında kalan bir noktaya nişan almak (384'te
çalışıyor, 320'de sessizce hiçbir şey yapmıyordu).

### 17 · Targeted / full suite

- Hedefli paket: **276 test, 10 ardışık yeşil**
- Tam paket: **4.394 test / 270 dosya, 5 ardışık yeşil** (tarayıcı kabul
  koşuları eşzamanlı çalışırken, günlükler saklanarak)

**Bir anomali dürüstçe kayda geçiyor.** Daha önceki bir tam paket serisinin
ilk koşusu `4393 passed | 1 failed` verdi. O koşuda yalnız özet satırı
saklandığı için **başarısız testin adı yakalanamadı**; sonraki üç sessiz ve
beş yüklü koşuda (toplam sekiz) yeniden üretilemedi. Bunu «flaky» diye
sınıflandırmıyorum — teşhis edilmemiş bir gözlem olarak duruyor, ve §16'nın
istediği ardışık yeşil serisi bundan sonra, günlükleri saklanarak alındı.

### 18 · build · tsc · test · lint

Final HEAD üzerinde taze; dördü de temiz.

### 19 · Dosyalar ve satır bütçeleri

Bütçeler **yükseltilmedi**:

| Dosya | Sınır | Şimdi |
|---|---|---|
| `Workspace.tsx` | ≤379 | **375** |
| `TabCanvas.tsx` | ≤472 | **456** |
| `ArrangementCanvas.tsx` | ≤470 | **470** |

Eval rehberi mantığı production component'lerine doldurulmadı: rehber
`listening-steps.ts` + `listening-report.ts` içinde saf, rota bileşeni
yalnız çizer.

### 20 · Temiz ağaç ve push

`git status --porcelain` boş; HEAD upstream ile eşit; dört commit de
`claude/proje-yorumları-n06wen` üzerinde.

### 21 · Fiziksel dinleme yapılmadı

**Bu turda kimse bu sesi dinlemedi.** Ölçülen şey davranış ve sayılardır.
Kabul koşuları masaüstü Chromium'dur ve kendi raporlarında «browser emulation
— not a physical device» yazar; `touch=0` bağlamı fiziksel cihaz kanıtı
sayılmaz ve `listeningVerdict` bunu bir kural olarak uygular.

2U-C fiziksel sürükleme kapısı açılmadı. K-61 kendiliğinden onaylanmadı.

---

**Canlı Devam FAIL'i kapatıldı — Haktan 2V-A fiziksel edit–dinle kabulünü
bekliyor.**
