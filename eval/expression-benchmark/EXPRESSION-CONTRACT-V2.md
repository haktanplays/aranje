# Expression Contract v2 — tasarım belgesi (2P-A §9)

**Bu bir üretim sözleşmesi değildir.** Bu turda hiçbir alanı yazılmadı,
hiçbir enum genişletilmedi ve hiçbir dosya biçimi değişmedi. Belge, bir
sonraki founder kararının girdisidir; kabul edilmeden önce §14'teki
dinleme paketinin dinlenmesi gerekir.

Ölçülen gerekçe `ARTICULATION-MATRIX.md`'de: 59 teknikten 14'ünün
sözleşmede karşılığı var, 10'u duyuluyor, ve *birleşebilir* işaretli 48
tekniğin hiçbiri bir diğeriyle birlikte yazılamıyor. Sebep tek: bir nota
tek bir `articulation` taşıyor.

---

## 1. Sorunun kendisi

Bugünkü alan dört ayrı soruyu tek bir cevaba sıkıştırıyor:

| Soru | Örnek | Bugün |
| --- | --- | --- |
| Bu nota **nasıl başlıyor**? | vurgu, ghost, dead note | `articulation` |
| **Nasıl vuruluyor**? | yukarı/aşağı vuruş, rake | temsil edilemiyor |
| **Perdesi ne yapıyor**? | bend, vibrato, slide-in | `articulation` |
| Bir **öncekiyle bağı** ne? | hammer-on, pull-off, legato slide | `articulation` |
| Hangi **aralık boyunca** sürüyor? | palm mute pasajı, let ring | `articulation` (yalnız nota başına) |

Bunlar birbirini dışlamıyor. Gerçek müzikte hepsi aynı anda olabiliyor;
sözleşmede olamıyor.

---

## 2. Önerilen katmanlar

İsimler mevcut mimariye uyacak biçimde seçildi: hepsi `@/lib/song/schema`
içinde, `articulationSchema` ile aynı yerde yaşar ve hepsi `strictObject`
olur.

```ts
/** Nota nasıl başlıyor. En çok bir tane. */
type NoteAttack =
  | "normal" | "accent" | "heavy_accent" | "ghost" | "dead"
  | "staccato" | "tenuto" | "natural_harmonic" | "pinch_harmonic";

/** Sağ elin hareketi. Atağın yerine geçmez, ona eklenir. */
type PickingGesture = { direction?: "down" | "up"; rake?: boolean };

/** Perdenin nota süresince yaptığı şey. */
type PitchGesture =
  | { kind: "vibrato"; width?: "normal" | "wide" }
  | {
      kind: "bend" | "bend_release" | "prebend" | "prebend_release";
      targetCents: number;
      /** Normalize zaman (0..1) → cent. Boşsa motor kendi eğrisini kurar. */
      points?: readonly { normalizedTime: number; cents: number }[];
      vibrato?: { startAfterTarget: boolean; depthCents: number; rateHz: number };
    }
  | { kind: "slide_in"; from: "below" | "above"; approxSemitones?: number }
  | { kind: "slide_out"; to: "down" | "up"; approxSemitones?: number };

/** Bu notanın bir öncekiyle ilişkisi. En çok bir tane. */
type NoteConnection =
  | { kind: "hammer_on" }
  | { kind: "pull_off" }
  | { kind: "legato_slide" }
  | { kind: "shift_slide"; targetAttack: NoteAttack };

/** Zaman aralığı boyunca süren teknik. Notanın değil, bölümün özelliği. */
type TechniqueSpan = {
  kind: "palm_mute" | "let_ring" | "tremolo_picking" | "sustain_pedal";
  trackId: string;
  startTicks: number;
  endTicks: number;
};

/** Nota içinde ek nota üreten süsleme. */
type Ornament =
  | { kind: "trill"; intervalSemitones: number }
  | { kind: "grace"; pitch: string; before: true }
  | { kind: "flam" }
  | { kind: "drag"; strokes: 2 | 3 };
```

`NoteEvent` bunları ayrı ve isteğe bağlı alanlar olarak taşır:

```ts
type NoteEventV2 = {
  pitch: string;
  velocity?: number;
  position?: { string: number; fret: number };
  attack?: NoteAttack;
  picking?: PickingGesture;
  pitchGesture?: PitchGesture;
  connection?: NoteConnection;
  ornament?: Ornament;
};
```

`TechniqueSpan` **notanın içinde değil**: bar'ın yanında, kendi
listesinde durur. Bir palm-mute pasajı sekiz notaya sekiz kez yazılan bir
bayrak değildir; bir aralıktır ve tek yerde düzeltilebilmelidir.

---

## 3. Talep edilen kombinasyonlar, kayıpsız

| Kombinasyon | v2 gösterimi |
| --- | --- |
| accent + palm mute | `attack: "accent"` + kapsayan `TechniqueSpan{palm_mute}` |
| bend + vibrato | `pitchGesture: {kind:"bend", vibrato:{startAfterTarget:true,…}}` |
| bend + tie | `pitchGesture` ilk notada; `"-"` slot'u perdeyi **sıfırlamaz** |
| palm mute span + downstroke | `TechniqueSpan{palm_mute}` + `picking:{direction:"down"}` |
| legato slide + kaynakta accent | kaynak notada `attack:"accent"`, hedefte `connection:{kind:"legato_slide"}` |
| shift slide + target attack | `connection:{kind:"shift_slide", targetAttack:"normal"}` |
| let ring + akor | tek `TechniqueSpan{let_ring}`, akorun bütün notalarını kapsar |
| ghost note + accent | ikisi de atak; **çakışma** — §5'e bakın |
| trill (bend'siz perde değişimi) | `ornament:{kind:"trill", intervalSemitones}` |
| bass slap + dead note | `attack:"dead"` + `picking:{…}`; slap bir `PickingGesture` genişletmesi |
| drum ghost + flam | `attack:"ghost"` + `ornament:{kind:"flam"}` |
| keyboard sustain pedal span | `TechniqueSpan{sustain_pedal}` |

Tek gerçek çakışma `ghost + accent`: ikisi de "nota nasıl başlıyor"
sorusunun cevabı ve bir notanın tek bir başlangıcı var.

---

## 4. Eski `articulation` alanının migration tablosu

| v1 | v2 |
| --- | --- |
| `normal` | alan yazılmaz (bugünkü davranışın aynısı) |
| `accent` | `attack: "accent"` |
| `palm_mute` | tek notayı kapsayan `TechniqueSpan{palm_mute}` |
| `sustain` | `attack: "tenuto"` |
| `staccato` | `attack: "staccato"` |
| `vibrato` | `pitchGesture: {kind:"vibrato"}` |
| `bend_half` | `pitchGesture: {kind:"bend", targetCents:100}` |
| `bend_full` | `pitchGesture: {kind:"bend", targetCents:200}` |
| `slide` | `connection: {kind:"legato_slide"}` |
| `hammer_on` | `connection: {kind:"hammer_on"}` |
| `pull_off` | `connection: {kind:"pull_off"}` |

`palm_mute` satırı tek dikkat isteyen yer: v1'de nota özelliği, v2'de
aralık. Tek notalık bir aralık kayıpsızdır ve arka arkaya gelen notalar
**birleştirilmez** — birleştirmek okuyucunun yazmadığı bir şeyi yazmak
olur.

`slide` satırı bir karar içeriyor: v1 slide'ı legato'ya çevriliyor,
çünkü bugün yaptığı şey bu (§11 ölçümü: hedefte yeniden vuruş yok). Shift
slide yeni bir seçimdir ve eski hiçbir dosyadan üretilmez.

---

## 5. Kombinasyon çakışma kuralları

1. Bir notanın en çok bir `attack`'ı olur. `ghost` ile `accent` aynı anda
   yazılamaz; UI ikisini tek bir seçim grubunda gösterir.
2. Bir notanın en çok bir `connection`'ı olur. Bir nota hem hammer-on hem
   slide ile bağlanamaz.
3. Bir notanın en çok bir `pitchGesture`'ı olur. `bend` içindeki
   `vibrato` ayrı bir gesture değil, bend'in bir parçasıdır — bu yüzden
   oraya gömülü.
4. `slide_in`/`slide_out` bir `connection` ile birlikte olabilir: biri
   notaya nasıl girildiğini, diğeri bir öncekiyle bağı söyler.
5. Aynı track ve aynı tür için `TechniqueSpan`'ler **örtüşemez**. İki
   palm-mute aralığı üst üste binerse bu bir hatadır, birleştirme değil.
6. `TechniqueSpan` bar sınırını geçebilir; bölüm sınırını geçemez.
7. Bir `ornament` her zaman ek ses üretir ve bu yüzden nota sayısını
   değiştirir — validator bunu bilmek zorundadır.

---

## 6. Validator sorumluluğu

- **Şema**: yalnız şekil. Bir alan var mı, tipi doğru mu, sayı aralıkta mı.
- **`articulationContext`** (bugün var): bağlam. Bir `connection` önceki
  notayı gerektirir; aynı telde olmalı; aralık `legato.maxIntervalSemitones`
  içinde olmalı. v2'de aynı validator `shift_slide` ve `slide_in`/`out`
  için de sorumludur.
- **Yeni: `spanIntegrity`**. Aralıklar örtüşmesin, ters olmasın, var
  olmayan track'e işaret etmesin, bölüm sınırını geçmesin.
- **Yeni: `gesturePlayability`** — *warning*, error değil. Enstrüman
  ailesi bu gesture'ı çalamıyorsa (klavyede bend) uyarır; yazmayı
  engellemez. Notasyon çalınabilirlikten geniştir ve öyle kalmalıdır.

Availability'de öğrenilen ders burada da geçerli (2O-B.1 §2):
**yazılabilir olmak ile duyulabilir olmak ayrı iki sütundur** ve
ikincisini birincisinin şartı yapmak insanları kendi dosyalarından dışarı
kilitler.

---

## 7. Yetenek üç seviyeli

Her teknik üç kutudan birine düşer ve bu belge ile UI aynı kutuyu
kullanır:

| Seviye | Anlamı | Örnek |
| --- | --- | --- |
| `notation_only` | Çizilir, kaydedilir, çalınırken duyulmaz | dinamikler, cymbal bell/bow |
| `approximate_playback` | Duyulur, ama fiziksel model değil | bend (tek sample playbackRate), palm mute (filtre) |
| `exact_playback` | Duyulan şey yazılanın karşılığı | vurgu (seviye), staccato (süre) |

Bu ayrım UI'da da görünür olmalıdır. Bir okuyucunun "yazdım ama
duymuyorum" ile "yazdım, yaklaşık duyuyorum" arasındaki farkı bilme hakkı
var.

---

## 8. UI progressive disclosure

Üç kademe:

1. **Varsayılan**: bugünkü sekiz seçenek, tek satır. Hiçbir şey
   kaybolmaz.
2. **Genişletilmiş**: atak / vuruş / perde hareketi / bağ ayrı gruplar
   hâlinde, her biri kendi başlığıyla. Yalnız istendiğinde açılır.
3. **Aralık modu**: palm mute ve let ring bir *seçimin* üzerine
   uygulanır, tek tek notaların üzerine değil.

Kural: varsayılan görünüm bugünkünden kalabalık olamaz. Yeni katmanların
bedeli yeni kullanıcıya çıkarılmaz.

---

## 9. MIDI ne kaybeder

Bugün olduğu gibi: **hepsini**. `midi-plan.ts` bilerek nota, zaman,
süre, velocity, tempo, ölçü, program ve seviye taşıyor; bend/slide/vibrato
taşımıyor çünkü MIDI'nin tek kanal-seviyesi aracı olan pitch bend, o
kanalda çalan **her** notayı kaydırır — bir akorun tek telini bend
etmek, okuyucunun DAW'ında diğer telleri detune eder.

v2 bunu değiştirmez ve değiştirmemelidir. Değişen tek şey, artık
kaybedilenin adlarıyla listelenebilir olması: `attack` velocity'ye
yaklaşık çevrilebilir, `TechniqueSpan{palm_mute}` CC olarak yazılamaz,
`PitchGesture` yalnız tek sesli bir pasajda güvenlidir. Eğer ileride MPE
yazılırsa bu ayrı ve açık bir karardır.

---

## 10. WAV ne duyurur

WAV, motorun duyduğu her şeyi duyurur — bugün sekiz artikülasyon, v2'de
`exact_playback` ve `approximate_playback` kutularındaki her şey.
`notation_only` kutusundakiler WAV'da da duyulmaz; bu bir eksiklik değil,
tanımın kendisi.

§10 ve §11 ölçümleri bugünkü yaklaşıklığın sınırını gösteriyor: tek
sample'ın playbackRate ile taşınması geniş aralıklarda timbre'ı da
kaydırıyor, ve bu bir contract sorunu değil bir sentez sorunu. v2 bunu
çözmez; yalnız *hangi* gesture'ın istendiğini kayıpsız söyler, böylece
motor sonradan daha iyisini yapabilir.

---

## 11. Copilot output şeması etkisi

Copilot'un dar çıktı şeması bugün `articulationSchema`'dan türüyor ve bu
doğru kalmalı: ikinci bir enum, ilk fırsatta ayrışacak ikinci bir gerçek
demektir. v2'de de aynı kural — Copilot v2 katmanlarının **bir alt
kümesini** kullanır ve o alt küme tek yerde tanımlanır.

Kural: Copilot'a desteklenmeyen bir teknik vaat edilmez. Bir gesture
`notation_only` ise prompt onu istemez.

---

## 12. Fingerprint etkisi

Fingerprint şarkının içeriği üzerinden hesaplanır. v2 alanları
şarkının içeriğidir, dolayısıyla fingerprint'e **girerler** — ve bu
doğrudur: bend eklenmiş bir riff başka bir riff'tir.

Benchmark durumu girmez. Aday profiller, ölçüm kimlikleri ve seed'ler
şarkının parçası değildir ve hiçbiri Song'a, fingerprint'e, proje
dosyasına veya history'ye yazılmaz. Bu turda da yazılmadı.

---

## 13. Versiyonlama kararı

`version: 3`. Gerekçe:

- v2 alanları **eklemeli**: eski bir dosyada yoklar ve yokluk sessizliktir.
- Ama `palm_mute` migration'ı bir notayı bir aralığa çeviriyor, yani eski
  bir dosyanın *okunuşu* değişiyor. Aynı sürüm numarası altında iki farklı
  okuma olamaz.
- Eski dosyalar `version: 2` olarak okunur, migration okuma anında
  yapılır ve **diske geri yazılmaz**. Kullanıcı kendi dosyasını
  kaydedene kadar byte'ları değişmez.
- Bir v3 dosyası v2 okuyucuda açılmaz. Bu bir hata değil, bir sürüm
  farkıdır ve kullanıcıya öyle söylenir.

---

## 14. v1'de yapılmayacaklar

- Yüzlerce enum. Yukarıdaki altı katmanın dışına çıkılmaz.
- Sweep / whammy otomasyonu.
- MPE veya per-note MIDI bend.
- Fiziksel modelleme.
- `notation_only` tekniklerin sahte seslendirilmesi.
- Palm-mute aralıklarının otomatik birleştirilmesi.
- Bugünkü `bend_half` / `bend_full` / `slide` semantiğinin sessizce
  değiştirilmesi.

---

## 15. Karar için gereken

1. §14 dinleme paketinin dinlenmesi (bend ve slide).
2. `version: 3` ve okuma-anında-migration kararının onaylanması.
3. `TechniqueSpan`'in bar'ın yanında mı, bölümün yanında mı duracağının
   seçilmesi — bu belge bar'ın yanını öneriyor, ama bölüm kopyalama
   semantiği (2J.1) bunu etkiler.
4. Hangi tekniklerin launch kapsamında olacağının seçilmesi;
   `ARTICULATION-MATRIX.md`'in `Öncelik` sütunu bir öneridir, karar
   değildir.
