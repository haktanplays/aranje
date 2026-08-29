# Faz 2U-A — UI Contract v1 + Editor Parity Omurgası

Teknik kapanış raporu. 35 madde, §19'un istediği sırayla.

Kabul **verilmemiştir**: bu rapor neyin yapıldığını ve neyin ölçüldüğünü
söyler. UI ve editör akışı kabulü Haktan'a aittir.

---

## 1 · Başlangıç durumu

Branch `claude/proje-yorumları-n06wen`, HEAD `dc8cde8`, çalışma ağacı temiz.
§0 kapısı geçildi; duracak bir sebep yoktu.

## 2 · UI Contract v1 yazıldı

`docs/UI-CONTRACT-v1.md`. İlk cümlesi §1'in istediği cümledir ve kalıcı bir
tasarım kararı olarak değil, geçici bir dondurma olarak yazılmıştır.

## 3 · Dondurulan yüzey ölçüldü, tarif edilmedi

`eval/ui-contract/golden.mjs` + `GOLDEN.json`: 4 viewport × 8 durum.
Ölçülenler — staff sınırları, altı telin y'si, perde rakamlarının merkezi,
`main` yüksekliği, toolbar/transport sınırları, body taşması, staff scroller
sayısı, 44px hedefler, etiket kırpılması, press sahipliği.

Baseline **değiştirilmemiş** `dc8cde8` üzerinde kaydedildi.

## 4 · Neden piksel diff değil

Bir piksel diff "herhangi bir piksel kımıldadı mı" sorusunu yanıtlar; sözleşme
ise parmağın güvendiği aritmetiği korur. Antialiasing farkı diff'i kırar,
kutusu değişmeden 40px kayan bir kontrol diff'ten geçer. Bu yüzden sayılar
ölçülür ve sayı olarak karşılaştırılır.

## 5 · Sözleşme her adımda yeniden ölçüldü

c4'te selection toolbar'ın çizimi değişti. Değişiklikten sonra golden yeniden
koşturuldu: **4 viewport × 8 durum, sapma yok**.

## 6 · Tek tipli seçim tanımı

`src/lib/song/selection-descriptor.ts` — `scope`, `sectionId`, tick aralığı,
`trackIds`, `stringIndexes`, `eventIds`, `wholeBars`, `barRange`, `barScope`,
`onsetCount`. Üç seçim modeli şekillerini korudu; ortak bir cümle kazandı.

## 7 · Olay kimliği pozisyoneldir, ve bu bir kısayol değildir

Song Contract'ta nota id'si yok. Bir nota *konumudur*. `eventIds` bundan
türetilir; müzik taşınınca değişir. §4'ün "pano id taşımaz" ve "paste yeni id
üretir" maddeleri buradan **düşer**, ayrıca hatırlanması gereken kural olarak
değil.

`NoteEvent`'e kalıcı `id` eklemek tek yönlü bir kapıdır — yazılmış her şarkı
onu isterdi ve müzikal olarak aynı iki nota eşit olmaktan çıkardı. Bu turda
açılmadı; **blocker olarak değil, kapsam dışı karar olarak** kaydedildi.

## 8 · Eylem yeteneği tek yerde

`src/lib/song/selection-capability.ts` — 22 fiil, üç durum: `available`,
`disabled(reason)`, `hidden`. Component'ler nota sayarak karar vermiyor.

## 9 · Üç durum, iki değil

Kaybolan bir eylem okura hiçbir şey öğretmez; hep görünüp hep reddeden daha
kötüdür. Ortadaki durum — sebebiyle birlikte pasif — okurun kuralı kontrolden
öğrendiği yerdir.

## 10 · c1'in bıraktığı kusur, c3'te kapatıldı

Yetenek modeli iki ölçü kapsamını ayırt edemiyordu. `full` ve `track` ikisi de
`measures` olarak tarif ediliyordu; tek track'li bir şarkıda aynı notaları
kapsıyorlar, yani track sayarak ayırt edilemezler. Sonuç: bir enstrümanın
ölçüsünde "Ölçü ekle" teklif ediliyor, çekirdek basıldıktan sonra
`not_available_in_scope` ile reddediyordu — §2'nin asla olmamalı dediği şey.

`barScope` eklendi. Gerçekten bütün ölçüyü gerektiren üç fiil — iki ekleme ve
ölçü/ritim sayfası — sebebiyle pasifleşti. Diğer dördü **pasifleşmedi**:
silme, çoğaltma, tekrar ve taşımanın dürüst bir tek-enstrüman anlamı var ve
çekirdek onu uyguluyor.

## 11 · Son ölçü reddi kapsama bağlandı

"Şarkıda en az bir ölçü kalmalı" yalnız `full` kapsamda geçerli. Bir lane'in
ölçüsünü boşaltmak ölçüyü yerinde bırakır; bölüm ölçüsüz kalamaz.

## 12 · Pano yapısal, oturum-yerel, izinsiz

OS panosu istenmedi. Pano scope, göreli onset, süre, track, tel, perde, pitch,
velocity, artikülasyon, letRing ve strum taşır; **id taşımaz**. Kullanıcı
proje deposuna yazılmaz, analytics'e ve export'a gitmez.

## 13 · Gerçek bir gizli kusur bulundu ve düzeltildi

`readRegion` notaları `{ ...note }` ile kopyalıyordu. Yayılma alanları kopyalar,
işaret ettikleri nesneleri değil — `position` bir nesnedir. Yani pano, okunduğu
şarkıyla **aynı** position nesnesini tutuyordu; paste yolu da panoyla. Üç ayrı
görünen yer tek nesneydi.

Bugün hiçbir çekirdek notayı yerinde değiştirmediği için hiç patlamadı. Çekmecede
duran dolu bir silahtı; §4 çekmecenin boş olmasını istiyor. İki taraf da
`structuredClone` kullanıyor.

## 14 · Ve bir denk mutant dürüstçe raporlandı

Yazma tarafındaki `detachedNote`'u kaldırmak **gözlemlenebilir bir davranış
değiştirmiyor**: `settle()` şarkıyı çıkışta derin kopyalıyor, dolayısıyla
fonksiyon içinde panoyla paylaşılan bir slot, çağıran onu gördüğünde hiçbir şey
paylaşmıyor. Deneyerek doğrulandı (`shared: false`).

Bu bir denk mutanttır. §14 denk mutantı kabul etmeyi yasaklıyor, o yüzden probe
listesinden **çıkarıldı** ve yerine gözlemlenebilir bir sınır kondu. Detach
kodda kalıyor — "aşağıdaki kopya bizi kurtarıyor" başka bir fonksiyonun
özelliğidir ve kaybedildiğinde burada kimse fark etmez. Hem kodda hem probe
dosyasında yazılı.

## 15 · Toolbar aynen korundu

`Bağla · Taşı · Devam · Daha fazla`. Yeni satır yok, yeni kontrol yok.
Uygulanmayan fiil satırdan **düşürülmez**, sebebiyle griler; çekmece kısalabilir.

## 16 · "Taşı" sekiz hareket

Zaman (grid · vuruş · ölçü), ses (yarım · oktav), tel, şekil (tel · perde) —
sekizi de iki yönlü. Zaten oradaydılar; eksik olan birini kaybettiğini fark
edecek bir şeydi. `src/lib/song/movement-menu.ts` sayıyı tutuyor, sayfa zaman
tanelerini oradan okuyor, tarayıcı kabulü on altı hedefin hepsine basıyor.

## 17 · "Devam" artık seçimi uzatıyor

Eskiden 2S-A'nın `continue_pattern` besteci aracını seçiyordu. O araç
**kaybolmadı** — K-59'dan beri Ritim kapısının arkasında, `doorOf` ile
doğrulandı. Ama seçim toolbar'ındaki bir fiil seçime bir şey yapmalı.

Uygulama: "Devam" erişimi kurar, sonraki uzun basış nereye uzanılacağını söyler.
Yeni jest yok — seçimi başlatan basışın ta kendisi. Başlangıç sabit, uçtan
uzar, **daraltmaya izin verir**, Song'a ve history'ye hiçbir şey yazmaz.

## 18 · Neden bir erişim gerekliydi

Bant zaten iki tutamak taşıyor. Tek slotluk bir seçimde bu iki tutamak 34px
arayla duruyor; bir parmak aralarından seçemiyor. "Buradan devam et" bir
kapalı yüzeyin yapamadığı tek erişimdi.

## 19 · Ölçü press'i sıraya girdi

`pointerOwner` c1'de `"measure"` rütbesini kazandı ve kimse sormuyordu; tab'ın
ölçü başlığı sahipliği bir prop'un verilip verilmediğine ve bubble'ı durdurmaya
göre karar veriyordu. Doğru cevabı veriyordu — ama yalnızca hiçbir kalem
hücresi başlığın üstünde durmadığı için. Bu yerleşim hakkında bir olgu, kural
değil. Şimdi tutamak, kalem ve zaman seçimiyle aynı kuyrukta.

## 20 · Ölçü jesti tek yerde

`src/lib/song/measure-gesture.ts` — basış tutar, erişim yakın kenarı büyütür
veya küçültür, bir kenar diğerini asla geçmez, başka bölüme ve başka enstrümana
uzanmak adıyla reddedilir. Hiçbir şey yazmaz.

## 21 · §11 bitişiklik kontrol edilmiyor, imkânsız

`BarSelection` bir başlangıç ve bir bitiş indeksidir; arada delik tutamaz.
Non-contiguous seçim **reddedilen** değil **ifade edilemeyen** bir şeydir — ki
bu daha güçlü garantidir: sonraki bir jest doğrulayıcıyı çağırmayı unutarak
içeri sokamaz.

## 22 · Ölçü operasyonları bütün track'lere ulaşıyor

Ekleme her lane'i bir ölçü uzatır; silme her track'ten aynı anda kaldırır,
hiçbir lane uzun kalmaz; taşıma bloğu sırasını koruyarak taşır. İki enstrümanlı
bir fixture üzerinde ölçüldü — tek track'li bir fixture'da "bütün track'ler"
yanlışlanamaz.

## 23 · Her operasyon bir adım

Altı operasyonun her biri tam bir history adımı kaydediyor; girdi şarkısı
bayt-bayt değişmiyor; ret hâlinde sıfır adım ve bayt-eş şarkı. Test
`history-boundary`'nin muafiyet listesine **açıkça** eklendi — o kural
muafiyetin bir diff'te görünmesini istiyor.

## 24 · Tarayıcı kabulü

`eval/editor-parity/verify.mjs` — 22 adım × 4 viewport (320×700, 390×844,
412×915, 1363×936 touch=0).

**88/88 geçti. 10 ardışık koşu yeşil.**

## 25 · Founder ekran görüntüleri

Koşu başına 40 görüntü (`eval/editor-parity/artifacts/`), §13'ün istediği 12'nin
üstünde: toolbar, Devam armed, Devam erişti, Taşı sayfası, hayalet, zincir
sorusu, uygulanmış hareket, çekmece, kes, ölçü başlığı — dördü de her viewport'ta.

## 26 · Kabul sırasında bulunan gerçek davranış

Adım 12 ilk hâlinde hayalet göremedi çünkü seçtiğim koşu bir hammer-on'un
üstünden geçiyordu ve uygulama **tahmin etmek yerine soruyordu** — "Bu seçim bir
bağlantıyı kesiyor". Uygulama haklıydı, adım yanlış şeyi ölçüyordu. Adım 12 temiz
bir seçime taşındı; adım 13 artık iki iptal yolunu da kapsıyor: hayaletten
çıkmak ve zincir sorusundan çıkmak — ikisi de sıfır yazma ve bayt-eş şarkı.

## 27 · Mutasyon probe'ları

`eval/editor-parity/probes.sh` — **40 anlamlı probe, hepsi adıyla kırmızı.
0 vacuous, 0 invalid.**

## 28 · Probe koşucusu neden "exit non-zero"dan sert

§14'ün adıyla dışladığı üç şey sıfırdan farklı çıkış veriyor ve hiçbir şey
kanıtlamıyor: hiç test koşmaması (parser'ı bozan bir mutasyon), yalnız timeout
(makine meşguldü demektir), ve denk mutant. Bir probe ancak vitest pozitif bir
test sayısı *ve* en az bir başarısız iddia raporladığında sayılıyor. Gerisi
INVALID ve koşuyu düşürüyor.

## 29 · Probe'lar dört gerçek test boşluğu buldu

Hepsi benim testlerimdeydi, çekirdeklerde değil:

1. **Descriptor fixture'ı tek track'liydi** — "her track'i kapsar" iddiası
   yanlışlanamaz. İkinci bir enstrüman eklendi.
2. **`canRun` gri bir fiil için hiç sınanmamıştı** — yalnız durum sınanıyordu.
   Yüzeyler `canRun` çağırıyor; artık sınanıyor.
3. **Paste aliasing'i değerlerle karşılaştırılıyordu** — eşit değerler
   paylaşımı göstermez. Yazılan notayı değiştirip panoya bakan bir test eklendi.
4. **Yalnız bitiş kenarının geçmesi sınanmıştı** — başlangıç kenarı ayrı bir
   clamp'tir ve sınanmıyordu.

Hiçbir iddia zayıflatılmadı; testler güçlendirildi.

## 30 · Hedefli paket

Dokuz dosya, **190 test, 10 ardışık koşu yeşil.**

## 31 · Tam paket

**4051 test, 4 ardışık koşu yeşil** (246 dosya).

## 32 · Satır bütçeleri

Yükseltilmedi. `Workspace.tsx` 377/379, `TabCanvas.tsx` 440/472,
`ArrangementCanvas.tsx` 470/470. TabCanvas'ın payına komut mantığı konmadı.

## 33 · Saf modüller / component sınırı

Seçim tanımı, eylem yeteneği, pano yükü, paste planlama, zaman/perde/tel
dönüşümleri, ölçü operasyonları, tipli ret ve hareket envanteri saf modüllerde.
Component'ler dizi kesmiyor, perde hesaplamıyor, çakışma kararı vermiyor, seçim
türü tahmin etmiyor, storage anahtarı kurmuyor.

## 34 · Kapsam dışı bırakılanlar

Ana UI yeniden tasarımı, UI Contract v2, ses kalitesi ayarı, yeni WAV, yeni
sample, HO/PO/slide ses değişikliği, yeni artikülasyon, standart notasyon,
MusicXML/Guitar Pro, provider/Copilot, fiyatlama, analytics, APK/Capacitor,
release sertleştirme, 1/64 grid, non-contiguous ölçü seçimi, yeni track/bar
limitleri. K-59 açılmadı. Fiziksel/müzikal ses kabulü yeniden yorumlanmadı.

## 35 · Ne iddia edilmiyor

Bu turda kimse editörü kullanmadı. Ölçülen şey davranış ve sayılar; "iyi
hissettiriyor mu" ölçülmedi ve ölçülemez. Songsterr yalnız davranış referansı
olarak okundu; tasarımından, metninden, içeriğinden hiçbir şey alınmadı.

---

## Commit'ler

`dc8cde8`'den itibaren dört ileri commit:

- `6ba01f9` — Freeze the surface, and say once what a selection is
- `25b1f5e` — Detach a copied note from the music it came from
- `94feb30` — Tell the two bar scopes apart before offering a verb
- `7d3e86c` — Make "Devam" reach, and the drawer tell the truth

Amend yok, rebase yok, force-push yok.
