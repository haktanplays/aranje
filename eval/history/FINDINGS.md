# Faz 2K-A — Birleşik düzenleme geçmişi: bulgular

Başlangıç noktası `824ba8b`. Bu dosya yalnız gerçekten çalıştırılarak
görülebilen şeyleri kaydeder.

## Tasarım kararı: snapshot, ters komut değil

Alternatif, her komutu saklayıp tersini uygulamaktı. Bu, on bir ölçü
komutunun, on seçim komutunun, riff düzenlemenin ve Copilot çıktısının
**tersini** doğru yazmayı gerektirir; ve bir ters ancak tamamen doğruysa
doğrudur. Tek bir yanlış ters müziği **sessizce** ve **çok sonra**
kaybettirir. Snapshot yanlış olamaz: geri gelen şarkı, orada olan şarkıdır.

Bedeli bellektir ve `historyLimits.maxUndoSteps = 50` ile sınırlıdır.

## No-op kontrolü neden `JSON.stringify` değil

Bir düzenleme, bir bar'ın `slots`'unu spread ile yeniden kurabilir. Sonuç aynı
müziktir ama **farklı byte'lardır** — anahtar sırası değişmiştir. Byte
karşılaştırması bunu "değişiklik" sayar ve okuyucuya **görünürde hiçbir şey
yapmayan bir undo** verir. Eksik bir undo'dan daha kötüdür, çünkü tek bir
şüpheli adım bütün yığını güvenilmez kılar. Karşılaştırma bu yüzden yapısaldır
(nesne anahtarı sırasız, dizi sırası anlamlı) ve `history-store.test.ts`'in
13 numaralı grubu tam olarak bu vakayı kurar.

## Gerçek uygulama kusurları

### 1. Loop her düzenlemede sessizce kapanıyordu

`usePlayback` şarkı değişince yeni bir controller kuruyor ve yeni controller
`loopSectionId: null` ile başlıyordu. Yani bir barı silmek bölüm döngüsünü de
kapatıyordu — kimse istememişken. Spec'in kuralı daha ince: bölüm hâlâ varsa
loop **korunmalı** ve sınırları yeni plandan yeniden türetilmeli; bölüm yoksa
loop **kapatılmalı** (sessizce başka müziğe taşınmamalı). İkisi de artık
`usePlayback`'te, ve senaryo 14 loop'un yaşadığını, bitiş tick'inin bölüm bir
ölçü kısaldığı için geriye geldiğini ve başlangıcın yerinde kaldığını ölçüyor.

### 2. Ekranda kalan tek İngilizce erişilebilir ad

Transport'taki bölüm döngüsü düğmesinin `aria-label`'ı `"Section loop"`
idi — "Çal" ile "Metronom" arasında dil değiştiren tek kontrol. `"Bölüm
döngüsü"` oldu. Senaryo 14 zaten o düğmeyi arıyordu; bulamayınca ortaya çıktı.

## Ölçüm hatası (benim, uygulamanın değil)

İlk koşuda senaryo 1 "başlangıçta 1 yazım" diyordu. Sebep uygulama değil,
harness'ti: fikstür `Storage.prototype.setItem` sarmalandıktan **sonra**
yazılıyordu, yani sayaç kendi kurulumunu sayıyordu. Fikstür artık
enstrümantasyondan önce yazılıyor.

## Boş çıkan kontroller (vacuity)

İki tarayıcı probe'u yeşil döndü.

| Probe | İlk hâli | Neden yeşildi | Sonuç |
| --- | --- | --- | --- |
| 14 | Undo'dan önceki `pause()` silinsin | Song değişince controller zaten değişiyor; transport her hâlükârda duruyor ve hiçbir kontrol ikisini ayırt edemiyor. **Bu bir bulgu:** açık `pause()` niyeti belirtir, garantiyi tek başına o taşımıyor (2J.1'deki aynı bulgunun devamı). | Probe aynı kontrolün ölçülebilir olan diğer sözüne çevrildi: **etikette ham command adı görünmemeli**. Artık kırmızı. |
| 16 | Playhead taşıması silinsin | Senaryo "düzenlemenin olduğu bölümün herhangi bir barı" kabul ediyordu — yerini kaybeden bir transport'un düşeceği yer de o bölümün ilk barıdır. | Senaryo artık **clamp'in kendisini** doğruluyor: `intro:4` silinince sonuç tam olarak `intro:3` olmalı. Artık kırmızı. |

Kalan 17 probe ilk seferde kırmızı döndü. Toplam **19 probe, 19 kırmızı**.

## Ölçümler

390×844 ve 320×700, üretim build'i.

| | Değer |
| --- | --- |
| Undo hedefi | 44×44 px |
| Redo hedefi | 44×44 px |
| Body yatay taşma | 0 px |
| Kasıtlı yatay scroller | 1 |
| Console/page error | 0 |

Yazma sayımları (`Storage.prototype.setItem` sarmalanarak, yalnız
`aranje.song`):

- Açılış: **0**
- Bir düzenleme + undo + redo: **3** (her biri tam bir yazım)
- Ghost preview + vazgeç: **0**
- Reddedilen işlem: **0**
- Yapılamayan undo/redo: **0**

Playback:

- Yapısal düzenleme + undo boyunca AudioContext: **1 → 1**
- Çalarken yapısal silme: `playing → idle`, undo sonrası hâlâ `idle`
- Playhead: `intro:4` → `intro:3` (bölüm bir ölçü kısaldı, konum clamp edildi)
- Loop: `{on:true, start:0, end:3840}` → `{on:true, start:0, end:3072}`

## Bilinen sınırlar

- **Geçmiş listesi/sheet'i yok.** Spec bu checkpoint'te kapsam dışı bıraktı;
  okuyucu adım adım gider, listeye bakıp atlayamaz.
- **Snapshot'lar tam şarkıdır.** 32 bar × 8 track'lik bir şarkı için 50 adım
  kabul edilebilir; daha büyük şarkılarda bu sayının yeniden ölçülmesi gerekir.
- **Undo, Copilot sheet'ini kapatır.** Preview sesini dispose etmenin yolu bu;
  açık bir istek formu da kapanır. Alternatifi, artık geçerli olmayan bir
  aday ile açık kalan bir sheet olurdu.
