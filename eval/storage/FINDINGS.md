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
