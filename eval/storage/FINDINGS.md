# Faz 2K-B — Dayanıklı kayıt ve kurtarma: bulgular

Başlangıç noktası `df8c2aa`.

## Neden tek zarf, iki slot değil

İki ayrı anahtar + pointer, normal bir düzenlemeyi **iki veya üç fiziksel
yazıma** çıkarır. Bu checkpoint'in kaldırmaya çalıştığı şey tam olarak
"yazmanın yarım kalabildiği an" olduğu için, o anı ikiye üçe çıkaran bir
tasarım kendi amacını yener. Tek nesne, tek `setItem`: `previous` her zaman
`current` ile aynı yazma içinde diske iner.

## Neden `current` ve `previous` ayrı doğrulanıyor

İkisini birden tek `safeParse`'a bağlamak, iki tane tutmanın bütün anlamını
yok ederdi: `current` bozuksa zarfın tamamı reddedilir ve sağlam `previous`
onunla birlikte gider. Dış kabuk strict, iki slot `unknown`; kararı
`decideLoad` verir.

## Neden sürüm şekilden önce okunuyor

Gelecek bir sürümün zarfı bu şekle hiç uymayabilir. Strict kabuk önce
çalışsaydı, `version: 2` bir dosya "corrupt" sayılır ve karantinaya alınırdı —
yani bu sürüm, okuyamadığı gerekçesiyle yeni sürümün işini yok ederdi. Etiket
(`format` + `version`) **gevşek** bir şemayla, şekilden önce okunuyor.

## Değişen davranış: reddedilen yazma artık düzenlemeyi geri alır

Eskiden `setItem` başarısız olduğunda düzenleme ekranda kalıyor, altında
"kaydedilemiyor" notu duruyordu. Bu, okuyucudan önündeki şeylerin hangisinin
gerçek olduğunu hatırlamasını istemektir. Artık hiçbir şey ilerlemez —
şarkı, cursor, redo dalı — ve ekranda görünen diskte olandır.

**Tek istisna, deponun hiç olmaması.** Private pencerede `setItem` çağrılmadı
ve başarısız olmadı; oturum bellekte çalışır ve bunu açılışta zaten söyler.
Tarayıcısı hatırlamayı reddeden birinden düzenleme yeteneğini almak koruma
değil ceza olurdu. Spec'in kuralı `setItem`'in başarısız olmasına bağlı, bu
yüzden bu bir istisna değil, kuralın kapsamadığı bir durum.

## Ölçüm hatası (benim, uygulamanın değil)

İlk tarayıcı koşusunda dört senaryo kırmızıydı: reload sonrası düzenleme
kayboluyordu. Sebep uygulama değil, harness'ti — Playwright'ın
`addInitScript`'i **her navigasyonda** çalışır, yani reload fikstürü geri
yazıyordu. Tohum artık context başına bir kez atılıyor (`sessionStorage`
işareti ile). Bir senaryo da yanlış yere bakıyordu: "Düzenle" düğmesi yalnız
Tab yüzeyinde var, Düzen'de hiç render edilmiyor.

## Boş çıkan kontrol (vacuity)

Bir tarayıcı probe'u yeşil döndü: **"bir component doğrudan depoya erişiyor"**.
Mutasyon `RecoveryBanner`'a bir `localStorage.getItem` çağrısı ekliyordu ve
tarayıcı koşusu bunu göremiyordu — çünkü okuyucunun gördüğü hiçbir şey
değişmiyor. Kırdığı kural **kablolama** hakkında, ve kablolamayı diskten okuyan
şey birim testi. Probe, garantisinin sahibi olan süite taşındı ve orada kırmızı
döndü.

Kalan 18 probe ilk seferde kırmızı. Toplam **19 probe, 19 kırmızı**.

## Boyut

En ağır desteklenen şarkı — 8 track × 32 bar × 1/32, her slot dolu, her nota
açık pozisyon ve articulation taşıyor:

| | Bayt |
| --- | --- |
| Ham Song (legacy) | 798.516 |
| Zarf, yalnız `current` | 798.592 (+76) |
| Zarf, `current` + `previous` | 1.597.104 |
| Legacy'ye göre büyüme | **2,00×** (≈1,52 MiB) |

Merkezî bir bayt tavanı **eklenmedi**: mevcut Song limitlerinden türetilebilen
tek sayı bu ölçümün kendisi, ve onu bir ürün limitine çevirmek uydurma olurdu.
Tarayıcının tahmini kotası da garanti sayılmıyor — gerçek `setItem` her
hâlükârda fail-closed yakalanıyor.

## Yazma sayımları

`Storage.prototype.setItem` sarmalanarak, yalnız `aranje.song`:

- Açılış (her yol: boş, legacy, zarf): **0**
- Normal commit: **1**
- Undo: **1** · Redo: **1**
- No-op, ghost preview, yapılamayan undo/redo: **0**
- `beforeunload` + `pagehide` + `visibilitychange`: **+0**
- Legacy dosyada açılış: **0** (migration ilk düzenlemede)
- Gelecek sürüm dosyasında commit: **0** (fail-closed)

## Bilinen sınırlar

- **`previous` bir basamaktır, bir geçmiş değil.** Zarf tek bir geri adım
  taşır; oturum geçmişi (50 adım) hâlâ yalnız bellektedir ve sayfa
  yenilenince gider. Bu bilinçli: geçmişi kalıcılaştırmak K-44'ün açıkça
  reddettiği şey.
- **Dosya iki katına çıkar.** En ağır şarkıda 1,52 MiB. Tipik localStorage
  kotasının içinde, ama şarkı limitleri büyürse (2.5 fazında 64 bar) bu sayı
  yeniden ölçülmeli.
- **Aynı anda iki sekme.** `previous` diskten okunuyor, bellekten değil, bu
  yüzden basamak başka bir sekme yazmış olsa bile doğru. Ama iki sekmenin
  birbirinin düzenlemesini ezmesi bu checkpoint'in kapsamı değil.

---

# Faz 2K-B.1 — Kapanış: unavailable gate ve yazma defteri

Başlangıç noktası `d6955cb`.

## Kaldırılan davranış: bellekte düzenleme

2K-B'nin "depo hiç yoksa bellekte çalış" istisnası kaldırıldı. Gerekçe
spec'inki: kullanıcı düzenlediğini ve kaydedildiğini sanır, sekme kapanınca
her şey gider — zarfın önlemeye çalıştığı kaybın uygulama eliyle üretilmiş
hâli. Yeni davranış: şarkı görüntülenir, playback/navigation çalışır, bütün
kalıcı mutasyonlar kapalı, jestler armed edilmez, banner non-dismissible.

## Kabiliyet probe'u

"Kaydedebilir miyim?" sorusunun tek dürüst cevabı denemektir. Açılışta
`aranje.probe` anahtarına 1 `setItem` + 1 `removeItem` yapılır. Dolu ama
okunabilir bir depo (probe reddi) gerçek şarkıyı **salt-okunur** açar — örnek
şarkıyı değil.

## `canPersist` karar tablosu

| Durum | canPersist | Banner |
| --- | --- | --- |
| Depo API'si yok | false | `storage_unavailable` (kapatılamaz) |
| Erişim/`getItem` exception | false | `storage_unavailable` (kapatılamaz) |
| Açılış probe'u reddedildi | false | `storage_unavailable` (kapatılamaz) |
| Gelecek sürüm dosyası | false | `unsupported_version` (kapatılamaz) |
| Corrupt + karantina yazımı başarısız | false | `storage_write_failed` |
| Rescue + repair yazımı başarısız | false | `storage_write_failed` |
| Diğer her yol | true | — |

`canPersist: false` iken store `commit`/`undo`/`redo` kapıda reddeder (sıfır
fiziksel işlem), snapshot `canUndo`/`canRedo`'yu false yapar ve UI kontrolleri
disabled olur. Kapı kalksa bile `saveSong`'un kendi redleri (unsupported,
korunmamış corrupt, yazma hatası) ikinci hat olarak durur — ve testler artık
iki katmanı **ayrı ayrı** görüyor (aşağıda).

## Yazma raporundaki çelişkinin kapanışı

2K-B raporu "bütün açılış yollarında 0 yazma" diyordu. İki düzeltme:

1. **Probe artık var ve gizlenmiyor.** Her açılış `aranje.probe`'a 1 set +
   1 remove öder; defterde açıkça görünür. Spec'in matrisi şarkı/karantina
   anahtarları üzerinden okunur ve orada temiz yollar gerçekten 0/0'dır.
2. **`removeItem` sayılıyor.** Eski sayaç yalnız `setItem`'a bakıyordu; oysa
   karantina yolları ana anahtarı `removeItem` ile temizler. Defter artık
   op + anahtar + sıra + başarı kaydeder.

Ölçülen matris (birim testleri `storage-gate.test.ts` §22, tarayıcı
senaryoları 23–24; defter uygulama kodundan önce kurulu):

| Açılış durumu | probe | şarkı set | şarkı remove | karantina set | Sıra |
| --- | --- | --- | --- | --- | --- |
| Anahtar yok | 2 | 0 | 0 | 0 | probe |
| Geçerli legacy | 2 | 0 | 0 | 0 | probe |
| Geçerli V1 current | 2 | 0 | 0 | 0 | probe |
| Gelecek sürüm | 2 | 0 | 0 | 0 | probe |
| Malformed JSON | 2 | 0 | 1 | 1 | probe → karantina set → ana remove |
| Current bozuk, previous sağlam | 2 | 1 (repair) | 0 | 1 | probe → karantina set → repair set |
| İki slot bozuk | 2 | 0 | 1 | 1 | probe → karantina set → ana remove |

## Kurtarma başarısızlık sırası

- Karantina `setItem` başarısız → ana değer **byte-eş** durur (remove hiç
  çalışmaz), `canPersist: false`, başarı raporlanmaz.
- Repair `setItem` başarısız → eski zarf ana anahtarda byte-eş durur;
  karantina kopyası (başarılıysa) kalır; kurtarılan şarkı ekranda ama
  düzenlenemez.
- Karantina başarısızsa repair **hiç denenmez**: broken zarftaki current
  slot'un tek kopyası ham değerin kendisidir ve kopyalanmadan üzerine
  yazılamaz.

## Regresyon

Normal commit / undo / redo hâlâ **tam 1** `setItem`; no-op/ghost/yapılamayan
hareket 0; future version 0 yazma ve byte-eş; history zarfa girmiyor.
(`storage-gate.test.ts` §22 defter sırasıyla, 50/50 tarayıcı koşusu.)

## Boyut, iki birimle

| | UTF-8 bayt | Code-unit | ≈UTF-16 bellek |
| --- | --- | --- | --- |
| Ham Song | 798.516 | 798.504 | 1.597.008 |
| Zarf, yalnız current | 798.592 | 798.580 | 1.597.160 |
| Zarf, current+previous | 1.597.104 | 1.597.080 | 3.194.160 |

Kota garantisi değildir. **Production Chromium 141.0.7390.37'de gerçek
`setItem`:** başarılı, round-trip byte-eş (`QUOTA.json`). Fiziksel iOS Safari
kabulü açık kalır.

## Testlerin kendisinde bulunan iki maskeleme

İki yeni probe ilk koşuda yeşil döndü ve ikisi de aynı şeyi söylüyordu:
**kapı, kemerini görünmez kılıyor.**

- "Unavailable bellekte düzenlemeye düşüyor" probe'u: store kapısı kaldırılınca
  bile `saveSong` her yazmayı reddettiği için hiçbir test kırılmıyordu. Ama
  kapı olmadan başarısız commit, kapatılamayan `storage_unavailable`
  banner'ını **kapatılabilir** `storage_write_failed` ile değiştirir ve deftere
  başarısız bir fiziksel işlem ekler — test artık tam bunu ölçüyor.
- "Future version guard'ı düşürülüyor" probe'u: `saveSong`'daki guard
  kaldırılınca store kapısı (`canPersist: false`) commit'i zaten kesiyordu.
  Test artık `saveSong`'u **doğrudan** da çağırıyor, iki savunma hattı ayrı
  ayrı gözlenebilir.

Sonuç: birim probe'ları **20/20 kırmızı** (13 × 2K-B + 7 × 2K-B.1).
