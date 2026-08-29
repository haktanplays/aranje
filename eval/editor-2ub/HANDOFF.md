# Faz 2U-B — Canlı FAIL'lerin kapanışı

Bu tur, `a807502` üzerinde yapılan canlı founder editor acceptance koşumunda
çıkan altı gerçek FAIL'i kapatır. **Founder kabulü verilmemiştir ve bu dosya
vermez.**

---

## Ne kırıktı, ne yapıldı

| Canlı bulgu | Kök neden | Şimdi |
|---|---|---|
| «Yapıştır» menüden tamamen kayboluyor | `DRAWER_VERBS` içinde `paste` girdisi yoktu; capability modeli en başından `available` diyordu ama çizecek yüzey yoktu | Drawer'da; ayrıca "model sunuyorsa bir yüzey çizmeli" testi eklendi |
| Undo/redo, paste hiç uygulanmadan PASS | Yazma olmayınca paste'in iki yanındaki fingerprint aynı şarkıydı; "geri geldi" hiçbir şey söylemiyordu | Adım `pasteApplied`'a bağlı; iki işaretin **farklı** olması da şart |
| İnce/kalın tele taşıma iki yönde de reddediliyor | Rehber ilk ölçüyü gösteriyordu; o ölçü boş alt Mi ile başlıyor — daha ince tel o sesi veremez, daha kalın tel yok | Pozitif adım 3. ölçüde (her iki yön gerçek), imkânsız seçim ayrı bir **negatif** adım |
| «Ölçü işlemleri» diyaloğu bomboş | Sheet'in her girdisi `full`/`canPaste` ile kapılıydı, kapının kendisi kapısızdı | Kapı ve sheet tek listeden (`bar-menu.ts`); arkasında bir şey yoksa kapı çizilmiyor |
| «Yerine koy» hiçbir şey yapmıyor | `canReplace` yalnız hata koduna bakıyordu; o kod üç ayrı çakışmayı anlatıyor, çekirdek yalnız birini onurlandırıyordu | Taşımanın çakışması kendi koduna sahip; çoğalt/tekrarla kendi mesajlarının sözünü tutuyor |
| Basılı tutup sürükleyerek çoklu ölçü seçilemiyor | Ownership presten *önce* karara bağlanıyordu; bu jest yarım saniye sonra belli oluyor | Üç durumlu jest, tanınma anında pointer'ı alıyor, `touchmove` başına scroll reddi, kenarda görünüm parmağı takip ediyor |

Ek olarak: seçim tutamakları ölçü başlığı şeridinin üstünü kaplıyordu ve
ölçü jestine gidecek presleri kapıyordu — tutamaklar başlığın altına indi.

## Kapsam değişimi: üç seçim, üç fiil kümesi

Ürün artık üçünü açıkça ayırıyor ve rehber de öyle:

- **nota/aralık** — pano fiilleri, ölçü fiili yok
- **tek enstrümanın ölçüsü** — «İçeriği sil / çoğalt / taşı»; şarkıyı
  uzatan hiçbir fiil yok
- **bütün enstrümanların ölçüsü** — «Ölçü ekle», «Ölçüyü kaldır», hizalı taşıma

Tab görünümünden bütün-ölçü kapsamına **gizli jest olmadan** geçiliyor: ölçü
seçim çubuğunda iki radyo düğmesi var. Önceden kapsamı yalnız *hangi jestin*
seçtiği belirliyordu, dolayısıyla tab'dan ölçü eklemek mümkün değildi.

## Koşum

    PORT=3110 ./eval/chord-audio/serve.sh
    node eval/editor-2ub/verify.mjs      # 27 ölçüm × 4 viewport
    ./eval/editor-2ub/probes.sh          # 32 mutasyon probe'u

Route değişmedi: `/eval/editor-acceptance?sha=<commit>`.

## Ne test edilmedi

Fiziksel Android/iOS kabulü hâlâ açık. Bu turda dört viewport'un üçü
dokunmatik emülasyonu, biri masaüstü; **hiçbiri fiziksel cihaz değildir** ve
"physical PASS" yazılmadı. Founder verdict sabit: **Haktan onayı bekliyor.**
