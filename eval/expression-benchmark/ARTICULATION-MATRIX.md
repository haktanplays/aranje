# Artikülasyon matrisi — 2P-A §8

Teknik adları bu checkpoint'in kendi listesinden; geri kalan her sütun
üretim kodundan okundu (`npx tsx eval/expression-benchmark/matrix.ts`).

Song Contract'taki artikülasyon sayısı: **11**.
Bunlardan çalarken gerçekten farklı duyulan: **8**.

## Bugünkü sözleşmenin rolleri

| Artikülasyon | Etiket | Expressive | Perdeyi oynatır | Önceki notaya ihtiyaç duyar | Komşuya bağlanır | Tab işareti |
| --- | --- | --- | --- | --- | --- | --- |
| `normal` | Normal | hayır | hayır | hayır | hayır | — |
| `palm_mute` | Palm mute | evet | hayır | hayır | hayır | PM |
| `accent` | Vurgu | evet | hayır | hayır | hayır | > |
| `sustain` | Uzatma | hayır | hayır | hayır | hayır | — |
| `staccato` | Staccato | hayır | hayır | hayır | hayır | — |
| `vibrato` | Vibrato | evet | evet | hayır | hayır | ~ |
| `bend_half` | Yarım bend | evet | evet | hayır | hayır | b½ |
| `bend_full` | Tam bend | evet | evet | hayır | hayır | b1 |
| `slide` | Slide | evet | evet | evet | evet | / |
| `hammer_on` | Hammer-on | evet | evet | evet | evet | h |
| `pull_off` | Pull-off | evet | evet | evet | evet | p |

## Teknik matrisi

| Teknik | Aile | Sözleşmede | UI'da yazılabilir | Tab'da çizilir | Playback'te duyulur | MIDI'ye taşınır | WAV'da duyulur | Katman | Birleşebilir | Legacy migration | Öncelik |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal | guitar_bass | `normal` | evet | hayır | hayır | hayır | hayır | nota atağı | hayır | `normal` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| accent | guitar_bass | `accent` | evet | evet | evet | hayır | evet | nota atağı | evet | `accent` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| heavy accent | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| staccato | guitar_bass | `staccato` | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | `staccato` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| sustain / let ring (nota) | guitar_bass | `sustain` | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | `sustain` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| palm mute | guitar_bass | `palm_mute` | evet | evet | evet | hayır | evet | zaman aralığı | evet | `palm_mute` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| let ring (span) | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | zaman aralığı | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| ghost note | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| dead note | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| upstroke / downstroke | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | vuruş yönü/hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| natural harmonic | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| artificial harmonic | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| pinch harmonic | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| tapping | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| left-hand tapping | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| hammer-on | guitar_bass | `hammer_on` | evet | evet | evet | hayır | evet | iki nota arası bağ | evet | `hammer_on` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| pull-off | guitar_bass | `pull_off` | evet | evet | evet | hayır | evet | iki nota arası bağ | evet | `pull_off` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| legato slide | guitar_bass | `slide` | evet | evet | evet | hayır | evet | iki nota arası bağ | evet | `slide` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| shift slide | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | iki nota arası bağ | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| slide-in below | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| slide-in above | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| slide-out down | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| slide-out up | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| bend (half) | guitar_bass | `bend_half` | evet | evet | evet | hayır | evet | perde hareketi | evet | `bend_half` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| bend (full) | guitar_bass | `bend_full` | evet | evet | evet | hayır | evet | perde hareketi | evet | `bend_full` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| bend / release | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| prebend | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| prebend / release | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| bend + vibrato | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| vibrato (normal) | guitar_bass | `vibrato` | evet | evet | evet | hayır | evet | perde hareketi | evet | `vibrato` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| vibrato (wide) | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| tremolo picking | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | zaman aralığı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| trill | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | süsleme | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| grace note | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | süsleme | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| slap / pop | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| brush / arpeggio / rake | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | vuruş yönü/hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| whammy / tremolo bar | guitar_bass | yok | hayır | hayır | hayır | hayır | hayır | perde hareketi | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| accent | drums | `accent` | evet | evet | evet | hayır | evet | nota atağı | evet | `accent` okunmaya devam eder; v2 katmanına birebir çevrilir | launch |
| ghost hit | drums | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | launch |
| flam | drums | yok | hayır | hayır | hayır | hayır | hayır | süsleme | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| drag / ruff | drums | yok | hayır | hayır | hayır | hayır | hayır | süsleme | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| roll | drums | yok | hayır | hayır | hayır | hayır | hayır | zaman aralığı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| rimshot | drums | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| cross-stick | drums | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| choke | drums | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| closed / half-open / open hi-hat | drums | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | near_term |
| cymbal bell / bow / edge | drums | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| sustain pedal (span) | keyboard | yok | hayır | hayır | hayır | hayır | hayır | zaman aralığı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| pedal up / down | keyboard | yok | hayır | hayır | hayır | hayır | hayır | zaman aralığı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| staccato | keyboard | `staccato` | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | `staccato` okunmaya devam eder; v2 katmanına birebir çevrilir | later |
| tenuto | keyboard | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| accent | keyboard | `accent` | hayır | evet | evet | hayır | evet | nota atağı | evet | `accent` okunmaya devam eder; v2 katmanına birebir çevrilir | later |
| dynamics | keyboard | yok | hayır | hayır | hayır | hayır | hayır | yalnız notasyon | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| arco | strings | yok | hayır | hayır | hayır | hayır | hayır | zaman aralığı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| pizzicato | strings | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| tremolo | strings | yok | hayır | hayır | hayır | hayır | hayır | zaman aralığı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| spiccato | strings | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | hayır | geçmiş dosyalarda yok; migration gerekmiyor | later |
| marcato | strings | yok | hayır | hayır | hayır | hayır | hayır | nota atağı | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |
| legato | strings | yok | hayır | hayır | hayır | hayır | hayır | iki nota arası bağ | evet | geçmiş dosyalarda yok; migration gerekmiyor | later |

## Sayılar

- Değerlendirilen teknik: **59**
- Song Contract'ta karşılığı olan: **14**
- Playback'te gerçekten duyulan: **10**
- MIDI'ye taşınan: **0**
- Hiçbir katmanda karşılığı olmayan: **45**

## Tek `articulation` alanının yetmediği yer

Matristeki `Katman` sütunu tek başına cevabı veriyor: bugünkü alan
**nota atağı**, **perde hareketi**, **iki nota arası bağ**, **zaman aralığı** gibi birbirinden bağımsız şeyleri tek bir enum'a
sıkıştırıyor. Bir nota aynı anda hem vurgulu hem palm mute olabilir, hem
bend hem vibrato olabilir; tek alan bunlardan birini seçmek zorunda.
Bugün `combinable` işaretli **48**
teknik var ve hiçbiri diğeriyle birlikte yazılamıyor.

## Bu belge ne değildir

Bir yol haritası değil. `Öncelik` sütunu bu checkpoint'in önerisidir ve
founder kararı değildir. Hiçbir teknik bu turda mevcut enum'a eklenmedi.

