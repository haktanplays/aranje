# ARANJÉ — PILOT BUILD SPEC v2.0

**Sürüm:** 2.0 · **Sahip:** Haktan · **Tarih:** 19 Ağustos 2026
**Durum:** Faz 0 kapısı için hazırlanmış birleşik build spec

Bu belge kanundur. Belirsizlik varsa sor, çelişki varsa dur ve bildir.
Fazlar sıralıdır — sonraki fazın işini erkenden çekme.

---

## §0 Belge otoritesi ve öncelik sırası

Bu spec, aşağıdaki kaynakların birleştirilmiş ve çelişkileri çözülmüş hâlidir.
Çelişki durumunda öncelik sırası (yüksekten düşüğe):

1. **Bu belge (v2.0)** — tek uygulanabilir kaynak.
2. **v1.5 Yanıt Notu** (`docs/decisions/ARANJE_YANIT_NOTU_v1_5.md`) — v1.2'yi
   çakıştığı yerlerde geçersiz kılar.
3. **v1.2 Konsolide Kararlar** (`docs/decisions/ARANJE_KONSOLIDE_KARARLAR_v1_2.md`)
   — ürün kararlarının kaynağı, yol haritası belgesi.
4. **v1.0 Pilot One-Shot Spec** (`docs/decisions/ARANJE_PILOT_ONE_SHOT_SPEC_v1_0.md`)
   — **tamamen geçersiz**, yalnız tarihsel kayıt. Uygulamada kullanılmaz.
5. **Prototip** (`design/prototype.html`) — yalnız görsel/etkileşim referansı.
   Kodu kopyalanmaz; §13.6'daki taşıma listesi geçerlidir.

Bu sürümde alınan yeni kararlar §19'daki değişiklik günlüğünde listelenmiştir.

---

## §1 Vizyon, ilkeler ve isim kuralı

### §1.1 Tek cümlelik ürün

Aranjé, kullanıcının telefonda bir şarkıyı dinleyip bölüm bölüm görmesini,
doğal dille yeni bir pasaj istemesini ve AI önerisini dinleyerek kabul veya
reddetmesini sağlayan mobil müzik copilot'udur.

Pilot bir DAW, tam tab editörü veya otomatik stüdyo değildir.

### §1.2 Kanıt cümlesi

> Telefonumda, gerçek enstrüman benzeri seslerle çalan bir şarkıya doğal dille
> yeni bir pasaj eklettim; dinledim ve kabul ettim.

Pilotun amacı ürün değil KANIT üretmektir.

### §1.3 KISS tanımı

KISS; UI ve uygulama mimarisinde gereksiz karmaşıklığı önler, ancak
**onaylanmış ürün gereksinimlerini silmek veya ertelemek için gerekçe olarak
kullanılamaz.** Kapsam ve sıralama kararlarının tek gerekçesi §14'teki faz planı
ve §14.4'teki çıkış kapısıdır.

KISS'in uygulamadaki karşılıkları:

1. Ana ekranda aynı anda yalnızca bir ana iş yapılır: dinle, bölüm seç veya
   AI'a komut ver.
2. Gelişmiş ayarlar ana ekranda durmaz; bottom sheet ile açılır.
3. Kullanıcı bir özelliği anlamak için müzik teorisi bilmek zorunda değildir.
4. AI çıktısı hiçbir zaman doğrudan şarkıya yazılmaz; önce pending öneri olur.
5. Sesin birebir stüdyo kaydı olması gerekmez; nota, ritim, akort ve
   çalınabilirlik doğru olmalıdır.

### §1.4 İsim kuralı

Marka adı her kullanıcıya görünen yerde **"Aranjé"** (é ile) yazılır. Teknik her
bağlamda — repo adı, `package.json` `name`, klasör/dosya adları, route'lar, env
prefix'leri, localStorage anahtarları, CSS sınıfları — ASCII **`aranje`**
kullanılır. **Ham `é` karakteri teknik kaynağa girmez.**

Kural kendi içinde çelişmemesi için tek bir kaçış noktası tanımlanır: kullanıcıya
render edilen marka adı tek bir sabitten gelir ve `é` orada **unicode kaçışıyla**
yazılır.

```ts
// lib/brand.ts - the only place the escaped brand character may appear
export const BRAND_NAME = "Aranj\u00E9";
```

- UI'da marka adı her zaman `BRAND_NAME` üzerinden basılır; hiçbir bileşen
  string'i elle yazmaz.
- Lint/birim testi **yalnız ham `é` karakterini** yasaklar: `src/**` ve
  `public/**` altındaki hiçbir dosya adı ve hiçbir kaynak dosya ham `é`
  içeremez. `\u00E9` kaçışı serbesttir.
- Sonuç: teknik kaynak tamamen ASCII kalır, kullanıcı yine **Aranjé** görür.

---

## §2 Çekirdek kapsam (Faz 0–2)

Çekirdek, §14.4'teki çıkış kapısını geçmek için gereken minimum settir.

- §2.1 Mobil öncelikli tek sayfa web uygulaması (telefon tarayıcısında birinci
  sınıf deneyim).
- §2.2 Sembolik şarkı modeli (§5) — tek doğruluk kaynağı.
- §2.3 Şema ve ses motoru **en baştan `MAX_TRACKS=8` destekler.**
- §2.4 Hazır demo şarkı **4 track** kullanır: elektro gitar, akustik gitar,
  elektro bas, davul.
- §2.5 Enstrüman varyasyonları:
  - Elektro gitar: `clean` + `high_gain`
  - Çelik telli akustik: `steel` + `finger`
  - Elektro bas: `finger`
  - Davul: rock kit; `kick` / `snare` / `closed_hat` / `crash`
- §2.6 Ölçü: **4/4 ve 6/8.** Resolution: **8 ve 16** (§5.5 formülü).
- §2.7 Akort: **E Standard ve Drop D** preset'leri. Capo desteklenir (§9.1).
- §2.8 Pozisyon: §9.2'deki deterministik greedy kural.
- §2.9 Articulation: `palm_mute` ve `accent`. Velocity **şemada vardır, UI'da
  yoktur.**
- §2.10 Sınırlar: 16 toplam bar, section başına 1–8 bar, patch başına 8 bar
  (§6).
- §2.11 Ses motoru: sample tabanlı melodik enstrümanlar + sample davul kit;
  §8 kurallarına tam uyum.
- §2.12 Timeline: section kartları, bar highlight, play/stop, section loop.
- §2.13 AI copilot döngüsü: prompt → patch → validator → pending → dinle →
  kabul/ret (§11).
- §2.14 Severity'li deterministik müzik-teorisi validator'ları (§10).
- §2.15 2 adet stil kartı (§11.7).
- §2.16 UI: AI bottom sheet, karar çubuğu, basit track ayarı (volume/mute +
  akort preset seçimi).
- §2.17 localStorage kalıcılığı (şarkı + son karar geçmişi).
- §2.18 Maliyet güvenliği: bütçe tavanı, kota, rate limit, metering (§12).

Çekirdek demo yalnız dört track kullanır; bu bir motor veya ürün limiti
değildir. Fixture verisi sekiz track'e kadar açılır ve test edilir (§14.6).

---

## §3 Faz 2.5 kapsamı (pilotun parçası, çekirdek dışı)

- 64 toplam bar sınırı.
- 3/4 ve 7/8 ölçüleri.
- Core Lite'ın kalan enstrümanları ve varyasyonları (§7.1).
- Akort preset'lerinin tamamı (§9.1).
- Mevcut tellerin notasını tel tel elle değiştirme.
- Track ekleme, çoğaltma ve silme UI'sı.
- Aynı enstrümandan birden fazla track oluşturma akışı.
- Davul lane genişletmesi (ride, china, tom'lar).
- Genişletilmiş articulation seti.
- Velocity UI.
- Section `bpmOverride` UI'ı.
- Mixer sheet'in tam hali: pan / solo.
- **Cila maddeleri** (v1.2 §14 Faz 3'ten taşındı — §19 K-2):
  - Ret animasyonu ve `prefers-reduced-motion` desteği.
  - Son 10 karar geçmişi görünümü.
  - Kapsamlı görsel cila.

**Faz 2.5'te olmayanlar:** sample yükleme / ses hata durumları **Faz 1**'e,
anlaşılır AI/patch hata durumları ve **Lighthouse mobile ≥ 80** hedefi
**Faz 2 çıkış kapısı**na aittir (§14.4, §14.5).

Faz 2.5'te kullanıcı track ekler veya çoğaltır; AI bu track'lere içerik
yazabilir. **AI'ın kendi kararıyla yeni track oluşturması pilot sonrasıdır.**

---

## §4 Pilot sonrası (bu spec'in dışı — dokunma)

- **Basit/Pro mod ayrımı.** Pilot arayüzünün adı **Basit mod**'dur; Pro mod,
  pilot sonrası ilk UI işidir.
- AI'ın gerektiğinde yeni track oluşturabilmesi.
- Tel ekle/çıkar; 7/8 telli gitar ve 5/6 telli bas.
- Gelişmiş pozisyon motoru ve el hareketi optimizasyonu.
- alphaTab veya tam tab/nota render'ı.
- Tam manuel nota editörü.
- Audio import zinciri (fingerprint / tempo / key / section çıkarımı);
  telif ve lisans kuralları ayrı ürün kapısıdır.
- WAV/MP3 render ve gelişmiş export.
- Auth, cloud sync, paylaşım, işbirliği.
- React Native ile baştan yazılmış ayrı native istemci.
- Topluluk stil kartları; uzun vadeli zevk öğrenme.
- Gelişmiş mixer ve geniş efekt zinciri.

### §4.1 Pilotta özellikle yapılmayacaklar

Ana ekranda sürekli açık mixer; ana ekranda sürekli açık sohbet geçmişi;
10 enstrümanın hepsini aynı anda aktif etmek; tam gitar tab editörü; waveform
düzenleme; kusursuz otomatik tab sözü; efekt pedalboard'u; çok kullanıcılı
hesap; cloud proje yönetimi; telefonda büyük AI modeli veya çoklu otonom agent;
ayrıntılı DAW mixer'i ve tempo automation lane'i.

---

## §5 Veri modeli — Song Contract (isimler AYNEN böyle)

### §5.1 Song

```ts
type Song = {
  version: 2;
  title: string;
  bpm: number;                    // 40–260
  key: string;                    // "E minor" — /^[A-G](#|b)? (minor|major)$/
  tracks: Track[];                // 1..MAX_TRACKS
  sections: Section[];            // sıralı
};
```

### §5.2 Track — instrument registry ile

Track içine kapalı bir enstrüman enum'u gömülmez; registry kullanılır (§7).

```ts
type Track = {
  id: string;                     // benzersiz
  name: string;                   // kullanıcıya görünen ad ("Gitar 1")
  instrumentId: string;           // "electric_guitar" — registry anahtarı
  presetId: string;               // "high_gain"
  volumeDb: number;               // -60..+6
  pan?: number;                   // -1..+1 (Faz 2.5 UI)
  muted?: boolean;
  soloed?: boolean;               // Faz 2.5 UI
  fretboard?: {
    tuning: string[];             // kalından inceye
    capo: number;                 // 0..12
  };
};
```

- `Track.id` benzersizdir; `Track.instrumentId` benzersiz olmak **zorunda
  değildir.**
- Aynı `instrumentId` farklı `Track.id` değerleriyle birden fazla kez
  kullanılabilir (iki rhythm gitar aynı sample paketini paylaşır).
- Tel sayısı `tuning.length` değeridir. Ayrı bir `stringCount` alanı yoktur.
- Aynı sample kaynağı bellekte paylaşılır; her track için yeniden indirilmez.

Örnek akortlar:

```ts
const E_STANDARD = ["E2", "A2", "D3", "G3", "B3", "E4"];
const DROP_D     = ["D2", "A2", "D3", "G3", "B3", "E4"];
const BASS_4     = ["E1", "A1", "D2", "G2"];
```

### §5.3 Section

```ts
type Section = {
  id: string;
  name: string;                   // kullanıcıya görünen ad
  status: "fixed" | "pending" | "accepted";
  bars: Bar[];                    // 1..barsPerSection
};
```

`status` sadece bu üç değeri alır. **Ret = section silinir**; ayrı bir
`"rejected"` durumu yoktur (ret animasyonu geçici UI state'i ile yapılır).

### §5.4 Melodik nota ve davul olayı

```ts
type Articulation =
  | "normal" | "palm_mute" | "accent" | "sustain" | "staccato";

type NoteEvent = {
  pitch: string;                  // "E2", "F#4"
  velocity?: number;              // 1–127; yoksa preset varsayılanı
  articulation?: Articulation;
  position?: { string: number; fret: number };   // capo-relative (§9.1)
};

type MelodicSlot = null | "-" | { notes: NoteEvent[] };

type DrumPiece =
  | "kick" | "snare" | "closed_hat" | "open_hat" | "ride"
  | "crash" | "china" | "tom_high" | "tom_mid" | "tom_floor";

type DrumHit = {
  piece: DrumPiece;
  velocity?: number;
  articulation?: "normal" | "ghost" | "accent";
};

type DrumSlot = DrumHit[];        // boş dizi = sus
```

- Melodik slotta `null` **sus**, `"-"` **önceki olayı uzatan tie**'dır.
- Birden fazla `NoteEvent` **akor** oluşturur.
- `position` yoksa §9.2'deki pozisyon motoru hesaplar. Kullanıcının açıkça
  yaptığı tel/perde seçimi AI/motor hesabının üzerine yazılır ve korunur.
- `DrumSlot` bir dizidir: aynı slotta kick + hat + crash mümkündür.

### §5.5 Bar ve slot sayısı

```ts
type TimeSignature = [4, 4] | [3, 4] | [6, 8] | [7, 8];

type Bar = {
  timeSignature: TimeSignature;
  resolution: 8 | 16;
  bpmOverride?: number;
  slots: Record<string, MelodicSlot[] | DrumSlot[]>;   // trackId -> slot dizisi
};

const slotCount = (ts: TimeSignature, res: 8 | 16) => (ts[0] * res) / ts[1];
```

Örnekler: 4/4 + 8 → **8 slot**; 4/4 + 16 → **16**; 6/8 + 8 → **6**;
6/8 + 16 → **12**; 3/4 + 8 → **6**; 7/8 + 8 → **7**.

- Çekirdekte yalnız `[4,4]` ve `[6,8]` kullanılır (§2.6); `[3,4]` ve `[7,8]`
  şemada vardır, Faz 2.5'te açılır.
- Varsayılan ölçü `[4,4]`, varsayılan resolution `8`.
- `slots` anahtarları **var olan `Track.id` değerleri olmak zorundadır**
  (referential-integrity validator'ı, §10.2).
- Bir bar şarkıdaki track'lerin **istediği alt kümesini** taşıyabilir; eksik
  track o barda susuyor demektir.

### §5.6 Kalıcılık

- Şema zod ile doğrulanır. **Her localStorage okuması ve her AI patch'i
  zod'dan geçmeden sisteme giremez.**
- localStorage anahtar prefix'i: `aranje.` (ASCII, §1.4).
- **Parse hatası uygulamayı çökertmez:** bozuk veri
  `aranje.corrupt.<timestamp>` altına yedeklenir, kullanıcıya anlaşılır bir
  mesaj gösterilir ve örnek şarkı yüklenir.
- Kabul/ret olayları `aranje.history` altına loglanır: tarih, prompt, patch id,
  karar, section id. Son 10 karar Faz 2.5'te UI'da gösterilir (§3).

---

## §6 Merkezi limitler

Limitler koda dağınık biçimde gömülmez; tek bir `lib/limits.ts`ten okunur.

```ts
export const songLimits = {
  maxTracks: 8,
  totalBars: 16,        // Faz 2.5: 64
  barsPerSection: 8,
  barsPerPatch: 8,
  maxVoicesPerSlot: 32,
} as const;
```

- `definedTracks` ve `activeTracksPerSection` limitleri **YOKTUR.** Section
  başına aktif track sınırı yoktur; sekiz track'in sekizi de aynı section'da
  çalabilir.
- **Voice**, aynı anda başlayan veya sürmekte olan her `NoteEvent`/`DrumHit`
  sesidir. Bu tanım akorları ve davulun eşzamanlı parçalarını doğru sayar.
- Geçiş kararını track sayısı değil, voice sınırı ve §14.6 cihaz performans
  testi verir.
- Track sınırı **enstrüman kataloğu sınırı değildir**; katalogda çok sayıda
  enstrüman olabilir.

---

## §7 Enstrüman kataloğu, yükleme ve lisans

### §7.1 Core Lite

| # | Enstrüman | `instrumentId` | Başlangıç varyasyonları | Motor |
|---:|---|---|---|---|
| 1 | Elektro gitar | `electric_guitar` | clean, crunch, high_gain | Sample + Filter/Distortion |
| 2 | Çelik telli akustik | `steel_acoustic` | finger, pick | Sample |
| 3 | Klasik/nylon gitar | `nylon_guitar` | warm, bright | Sample |
| 4 | Elektro bas | `electric_bass` | finger, pick, driven | Sample + Filter/Distortion |
| 5 | Davul | `drum_kit` | rock, metal, electronic | Sample kit |
| 6 | Piyano | `piano` | grand, upright | Sample |
| 7 | Elektrikli piyano | `electric_piano` | soft, bright | Sample |
| 8 | Organ | `organ` | rock, church | Sample veya güvenli synth |
| 9 | Strings ensemble | `strings` | sustain, staccato | Sample |
| 10 | Synth | `synth` | lead, warm_pad, dark_pad | PolySynth(Synth) |

**Çekirdekte yalnız 1, 2, 4, 5 kullanılır** (§2.4–2.5). Kalanlar Faz 2.5'te
açılır; registry ve şema hepsini baştan tanır.

"Varyasyon" her zaman ayrı sample seti demek değildir. Elektro gitar ve basın
bazı varyasyonları aynı temiz sample'lardan **Filter + Gain + Distortion** ile
üretilir. Farklı çalım tekniği gerektiren finger/pick veya sustain/staccato,
mümkün olduğunda ayrı sample kullanır.

`palm_mute` articulation'ı çekirdekte ayrı sample değildir: kısa envelope +
lowpass Filter + hafif gain düşümü ile yaklaşık üretilir (§1.3/5 buna izin
verir).

### §7.2 Yükleme stratejisi

- Uygulama açılırken **bütün katalog indirilmez.**
- Yalnız aktif şarkının kullandığı `instrumentId + presetId` paketleri yüklenir
  (lazy load).
- İndirilen dosyalar **Cache Storage veya IndexedDB**'de tutulur.
- **Demo şarkısının ilk ses yükü ≈ 8 MB hedefindedir.** Bu bir toplam katalog
  limiti değildir; tüm katalog için tek bir 8 MB hard limit uygulanmaz.
- **Runtime'da üçüncü taraf sample URL'ine hotlink yapılmaz.** Lisansı uygun
  dosyalar optimize edilip sürümlü olarak kendi origin/CDN'imizden sunulur.
- APK'da Core Lite sample'ları uygulama içinde veya cihaz cache'inde bulunur;
  internet yokken playback çalışır (§4.6 karşılığı §14.7).
- Enstrüman başına seyrek nota seti kullanılır (oktav başına 2–3 sample);
  Sampler ara notaları pitch-shift'ler.

### §7.3 Lisans politikası

Öncelik sırası:

1. CC0 / public domain.
2. Ticari yeniden dağıtıma açık, atıf şartlı CC BY.
3. Açıkça izin alınmış özgün kayıtlar.

**CC BY-NC, belirsiz lisans veya yalnız "kişisel kullanım" izinli sesler ürüne
alınmaz.**

Her sample/paket için manifestte saklanır (§19 K-15):

```ts
type SampleManifestEntry = {
  sourceUrl: string;
  producer: string;
  licenseSpdx: string;        // "CC0-1.0", "CC-BY-3.0" — SPDX kimliği
  licenseTextPath: string;    // repodaki tam lisans metninin yolu
  attribution: string;        // CC BY için gereken atıf satırı
  originalFileName: string;
  processedFileName: string;
  checksum: string;           // sha256
};
```

- `licenseSpdx` serbest metin değil, **SPDX kimliğidir**; izinli küme §7.3'ün
  öncelik sırasıyla sınırlıdır ve bir birim testiyle zorlanır.
- Build çıktısına manifestten **`THIRD_PARTY_NOTICES.md`** üretilir: her paket
  için üretici, SPDX kimliği, atıf satırı ve lisans metninin yolu. Bu dosya
  hem web dağıtımına hem APK'ya girer.
- Lisans metni repoda tutulur; yalnız URL'e link verilmez.

Başlangıç kaynak adayları:

- VCSL — CC0 genel amaçlı: <https://github.com/sgossner/VCSL>
- VSCO 2 Community Edition — CC0 orkestral:
  <https://versilian-studios.com/vsco-community/>
- tonejs-instruments — <https://github.com/nbrosowsky/tonejs-instruments>

**Uyarı (§19 K-6):** tonejs-instruments tek bir lisans altında değildir; dosya
kökenleri karışıktır. Hiçbir dosya, kendi kaynağı ve lisansı dosya bazında
doğrulanmadan manifeste ve repoya alınmaz.

---

## §8 Ses motoru kuralları

### §8.1 İzin verilen node'lar (KANITLANMIŞ-NODE İLKESİ)

Sinyal zinciri yalnız şunları içerebilir:

`Sampler` · `PolySynth(Synth)` · `MembraneSynth` · `NoiseSynth` · `Filter` ·
`Distortion` (WaveShaper) · `Gain` / `Channel` · `Destination` · `Meter`

**Distortion prototipte mobil saha testinde çalışmıştır ve metal karakteri için
gereklidir.** v1.0 spec'indeki Distortion yasağı kaldırılmıştır.

### §8.2 Yasak/ertelenen node'lar

`Reverb` / `Freeverb` · `PluckSynth` · `FMSynth` · `Convolver` ·
AudioWorklet tabanlı özel zincirler.

Gerekçe: mobil WebView'da PluckSynth/Reverb ve FMSynth/Freeverb zincirlerinin
sessiz kaldığı saha testiyle doğrulanmıştır. Bu yasak sonsuza kadar değildir;
pilotun mobil ses kanıtını korur.

### §8.3 Scheduling

- Bütün ses zamanlaması `Tone.Transport` **nota değerleriyle** yapılır
  (`"8n"`, `"16n"`, `bars:beats:sixteenths`).
- **Mutlak saniye aritmetiği kullanılmaz.** (Prototipteki `EIGHTH = (60/BPM)/2`
  yaklaşımı taşınmaz.)
- BPM, scheduling başlamadan **önce** ayarlanır.
- UI highlight, **Transport callback'inin kendi zamanı** kullanılarak
  `Tone.Draw.schedule(fn, time)` üzerinden çizilir. `Tone.now()` ile
  çizilmez.
- `setTimeout` ile ses zamanlaması yasaktır (görsel efektler için serbesttir).
- `Tone.start()` **yalnız kullanıcı jestinde** çağrılır.
- Her track ayrı `Tone.Channel`'a, bütün kanallar tek master `Gain`'e bağlanır.
- Tone.js tam sürüm pinlenir: **`14.8.49`** (`^` kullanılmaz).
- Audio modülleri yalnız client'ta, SSR dışında yüklenir
  (`'use client'` + `dynamic(..., { ssr: false })`).

### §8.4 Debug modu

`?debug=1` query param'ı ile:

- Her track kanalına `Meter` bağlanır, UI'da dB gösterilir.
- `audioLateEvents`, `drawLateEvents`, `missedAudioEvents` sayaçları ayrı ayrı
  tutulur ve gösterilir. **Görsel `Tone.Draw` gecikmesi audio scheduling
  gecikmesiyle karıştırılmaz.**
- Test sonunda cihaz bilgisi + event istatistiklerini içeren **kopyalanabilir
  kısa rapor** üretilir (§14.6 protokolünün çıktısı).

Ses sorunu raporlanırsa **ilk bakılacak yer debug metresidir, kod değil.**

---

## §9 Akort, capo ve pozisyon

### §9.1 Capo-relative fret semantiği

Tab üzerindeki perde sayısı capo'ya göre yazılır:

```ts
position.fret : 0..(24 - capo)
soundingPitch = tuning[string] + capo + position.fret
physicalFret  = capo + position.fret
```

- `fret = 0`, capo varsa **capo'nun bastığı açık sesi** ifade eder.
- Validator ve pozisyon motoru aynı anlamı kullanır.
- UI capo-relative tab gösterir; iç hesapta fiziksel perde ayrıca türetilir.
- `position.string` **0 tabanlıdır ve kalından inceye sayılır**
  (`tuning[0]` = en kalın tel = `string: 0`).

Akort preset'leri: çekirdekte **E Standard** ve **Drop D**. Faz 2.5'te
Eb Standard, D Standard, Drop C, Open G ve 7-telli preset'ler açılır; tel
sayısını değiştirmeyen manuel akort da Faz 2.5'tedir. **Tel ekle/çıkar pilot
sonrasıdır** (§4).

### §9.2 Deterministik pozisyon motoru — Ergonomic Placement v2 (§19 K-19)

`position` yazılmamış fretted melodik onset'ler, track'in **zaman sıralı
bağlamı** içinde deterministic beam-search / dynamic-programming ile
yerleştirilir. K-4'ün hafızasız greedy kuralı üretimden kaldırılmıştır.

**Aday üretimi (onset başına):**

1. Geçerli capo-relative fret aralığındaki bütün pozisyonlar bulunur.
   `fret 0` capo'nun bastığı sestir (§9.1); alternate tuning ayrı dal kullanmaz.
2. Bir akorda her tel en fazla bir bağımsız nota taşır. Aynı pitch'in farklı
   tellerde bilinçli doubling'i geçerlidir.
3. Explicit `position` **aynen korunur** ve telini rezerve eder; kalan
   notalar onun etrafına yerleştirilir. Explicit pitch/tel/perde tutarsızlığı
   düzeltilmez — `fretboardIntegrity`'nin sorumluluğudur. İki explicit nota
   aynı teli kullanıyorsa taşınmaz — `stringCollision` raporlar.
4. Hiç tam voicing bulunamazsa sahte pozisyon üretilmez ve bu bir çakışma
   olarak etiketlenmez; `unplaceable` (§10.3) raporlar.

**El konumu ölçüleri** — `fretJump` (§10.3) ile **aynı** yardımcıdan gelir:

- **Anchor:** basılan (capo-relative fret > 0) notaların fiziksel perdelerinin
  medyanı. Yalnız açık teller varsa 0; karışık akorda açık teller medyanı
  aşağı çekmez.
- **Chord span:** basılan notaların en yüksek ve en düşük fiziksel perdesi
  arasındaki fark; tek veya sıfır basılı notada 0.
- **String center:** kullanılan `stringIndex` değerlerinin medyanı (veri
  modelindeki tel indeksleri; görsel satır değil).

**Maliyet — ağırlıklı skor değil, lexicographic tuple.** Sırasıyla:

1. Büyük sıçrama sayısı (gitar > 7, bas > 5 fiziksel fret; eşikler §6)
2. Eşik üzerindeki toplam fazla perde
3. Toplam anchor hareketi
4. Toplam chord span
5. Toplam string-center hareketi
6. Toplam maksimum fiziksel perde
7. Toplam fiziksel perde yükü
8. Canonical voicing/yol imzası

İlk onset'te ve reset sonrası hareket maliyeti yoktur; orada eski kuralın ruhu
korunur — daha dar span, daha düşük maksimum perde, daha düşük toplam perde,
son olarak canonical imza.

**Reset semantiği** — Faz 0 carry davranışıyla aynı yardımcıdan gelir. El
bağlamı yalnız şu üç durumda sıfırlanır: track bir sonraki section'da hiç
anılmıyorsa, taşınan ses de onset de olmayan **tam bir bar** varsa, ve şarkının
başında. Section sınırı tek başına, kısa sus, bar boyu süren tie/sustain reset
**değildir**.

Onset ve sessizlik okuması tek bir saf modülde (`lib/tab/placement-input`)
toplanır; tab timeline ve yerleşim motoru aynı okumayı paylaşır. O okumanın üç
kuralı: tie (`"-"`) yeni onset değildir; bir ses sonraki bar'a **yalnız** o bar
tie ile açılıyorsa taşınır; track'in hiç yazılmadığı bar sessizdir ve taşınan
sesi keser (§5.5).

**Bu sürümün iddiası olmayanlar:** parmak numarası, barre tespiti, parmak
bağımsızlığı, legato/picking ergonomisi, tel atlama tekniği ve insan gitarist
seviyesinde kusursuz fingering. Motor yalnız pozisyon türetir; pitch, onset,
süre, velocity, articulation ve playback event zamanları değişmez.

**§19 K-4 kaydı:** eski hafızasız kuralın sınırı bu karara kadar geçerliydi;
K-19 ile üretimden kaldırıldı. Kalan büyük sıçramalar için `fretJump` uyarısı
kalite güvenlik ağı olarak yerinde kalır.

---

## §10 Validator katmanı

Saf fonksiyonlar, `lib/validators/`. Her biri birim testlidir. Her sonuç
`severity` taşır:

```ts
type Severity = "error" | "warning";

type ValidationIssue = {
  code: string;
  severity: Severity;
  message: string;          // kullanıcıya anlaşılır, nota ve bar söyler
  sectionId?: string;
  barIndex?: number;
  trackId?: string;
  slotIndex?: number;
};
```

**Hard error varsa patch sisteme giremez. Warning girer, kullanıcıya bilgi
olarak gösterilir.**

### §10.1 Hard error üretenler

- `schemaShape` — zod. Zincirin ilk halkası.
- `slotCount` — ölçü ve resolution'a göre yanlış slot sayısı (§5.5).
- `range` — nota enstrüman aralığı dışında.
- `drumVocab` — davul track'inde tanımsız `DrumPiece`.
- `fretboardIntegrity` — geçersiz string/fret/tuning ilişkisi, **yalnız açıkça
  girilmiş `position`lar için.**
- `stringCollision` — aynı telde çalınması imkânsız eşzamanlı notalar
  (bkz. §10.2).
- `songLimits` — `maxTracks`, `totalBars`, `barsPerSection`,
  `maxVoicesPerSlot` aşımı.
- `patchSize` — tek AI patch'inde 8'den fazla yeni/değişen bar.
- `trackReferences` — `Bar.slots` içinde var olmayan `trackId`.
- `tonalMajority` — bir bardaki melodik notaların **%50'den fazlası** izinli
  tonal küme dışında.

### §10.2 `stringCollision` kapsamı — track bazında (§19 K-3)

Çakışma kontrolü **track başına** yapılır: aynı `trackId` + aynı bar + aynı
slot + aynı `position.string` → hard error.

Gerekçe: §5.2 aynı `instrumentId`'den birden fazla track'e izin verir (iki
rhythm gitar iki ayrı fiziksel gitardır). Kontrol şarkı genelinde yapılırsa
iki gitarın aynı power chord'u çalması sahte hata üretir.

### §10.3 Warning üretenler

- Tonal çekirdek dışındaki **tekil** renk notası (§10.4).
- Olağandışı ama çalınabilir fret sıçraması. Eşikler tek merkezi kaynakta
  tutulur: gitarda **> 7**, basta **> 5** fiziksel fret'lik el pozisyonu
  değişimi (§19 K-17). Bu bir uyarıdır, patch'i bloklamaz.
- `position` boş olduğu için otomatik yerleştirilen nota; greedy uygun yerleşim
  bulamadıysa nota positionsız çalınır.

### §10.4 Tonal çekirdek ve renk notaları (§19 K-17)

**Tonal çekirdek yalnız deklarasyondaki yedi notalı dizidir:**

| `Song.key` modu | Çekirdek (tonik'ten yarım ton) |
|---|---|
| `major` | 0, 2, 4, 5, 7, 9, 11 |
| `minor` | 0, 2, 3, 5, 7, 8, 10 (doğal minör) |

Bunun dışındaki her şey **renk notasıdır**: harmonik minörün yükseltilmiş 7'si,
melodik minörün yükseltilmiş 6/7'si, `b5`, ödünç alınan notalar ve kromatik
geçişler.

- Renk notası **tek başına error değildir**; §10.1'deki `tonalMajority` eşiği
  engeller.
- Renk notası çoğunluk hesabının **payına eklenmez.**
- Stil kartının önerdiği renk notaları da çekirdek sayılmaz.
- "Komşusu kromatikse otomatik tonal say" istisnası **yoktur.**

**`tonalMajority` sayımı:**

- Payda: bardaki **bütün melodik track'lerin vurulan pitched onset'leri.**
  Tie/sustain yeniden onset sayılmaz; davul ve pitch taşımayan event sayılmaz.
- Validator yalnız **en az 3 pitched onset** bulunan barda karar verir. Bir
  veya iki nota tonal çoğunluk için yeterli kanıt değildir; bar atlanır.
- Geçmek için çekirdek onset sayısı toplam pitched onset sayısının
  **%50'sinden kesinlikle fazla** olmalıdır. Tam %50 başarısızdır.
- Karar tam candidate Song üzerinde verilir.

### §10.5 Uygulama alanı

Validator'lar hem AI patch'lerine hem manuel düzenlemeye uygulanır. Backend'de
çalışır, istemcide **tekrar** çalışır (§11.4 adım 6).

---

## §11 AI copilot

### §11.1 Sözleşme — track-scoped `arrange_track` (§19 K-18)

İlk kullanıcı ürünü, section'ın tamamını değiştiren bir üretim değil, **yalnız
hedef track'i düzenleyen** bir co-arranger'dır.

```ts
type CopilotRequest = {
  operation: "arrange_track";
  skill: "drums" | "bass" | "harmony";
  sectionId: string;
  targetTrackId: string;
  lockedTrackIds: string[];
  instruction?: string;
};

type CopilotPatch = {
  id: string;                 // sunucuda üretilir
  operation: "arrange_track";
  sectionId: string;
  targetTrackId: string;
  bars: { barIndex: number; slots: MelodicSlot[] | DrumSlot[] }[];
  explanation: string;        // kullanıcıya 1-2 cümle
};
```

- `id` **sunucuda** üretilir, modele bırakılmaz. `aranje.history` bu id'yi
  loglar (§5.6).
- Slot tipleri §5.4'ten türetilir; **ikinci bir slot tanımı yoktur.**
- Skill ile hedef track uyumu zorunludur: `drums` → davul track'i, `bass` →
  fretted bas, `harmony` → fretted gitar.
- **Section'daki target dışı bütün track'ler sunucu tarafından kilitli kabul
  edilir.** `lockedTrackIds` yalnız ek açıklıktır; güvenlik sınırının tek
  kaynağı değildir.
- Model **yeni Track oluşturamaz**; section adı, id'si, bar sayısı, ölçü ve
  diğer metadata'sı değiştirilemez.
- Melodik çıktıda **explicit `position` kabul edilmez**; tel/perde yerleşimini
  §9.2 deterministik motoru yapar.
- Bar sayısı hedef section'ın bar sayısıyla aynı olmalı, her `barIndex` tam bir
  kez ve sıralı bulunmalıdır.
- **AI sağlayıcısı değişse bile istemcinin gördüğü bu sözleşme değişmez.**

`insert_section` / `replace_section` public route'tan **kaldırılmıştır**
(§19 K-18).

### §11.2 Model stratejisi — NİHAİ (§19 K-1)

```txt
ARANJE_MODEL_DEFAULT=claude-sonnet-5
ARANJE_MODEL_CHEAP=claude-haiku-4-5-20251001
ARANJE_ENABLE_CHEAP_ROUTING=false
ARANJE_MODEL_ESCALATION=
```

1. Riff, armoni, akustik pasaj, bas, davul ve **bütün müzikal patch
   üretimleri doğrudan `ARANJE_MODEL_DEFAULT` ile** yapılır.
2. **"Önce ucuz modeli dene, başarısız olursa kaliteliye geç" yaklaşımı
   kullanılmaz.** Ucuzla başlayıp geri dönmek maliyeti, gecikmeyi ve kullanıcı
   reddini artırır.
3. Ucuz model yalnız gelecekte, **müzikal yaratıcılık gerektirmeyen** yardımcı
   görevlerde (prompt intent sınıflandırma, stil kartı seçimi, bağlam
   özetleme) değerlendirilebilir. Bu routing **pilotta kapalıdır** ve yalnız
   `ARANJE_ENABLE_CHEAP_ROUTING=true` ile, **görev whitelist'i üzerinden**
   açılabilir.
4. `ARANJE_MODEL_CHEAP` değeri reproducibility için tarihli ID olarak
   tutulur. **Cheap routing açılmadan önce bu ID Models API ile doğrulanır**
   (`GET /v1/models/{id}`); doğrulanmadan `true` yapılamaz.
5. **Validator, akort hesaplama, transpoze, greedy tab pozisyonu, limit
   kontrolü ve şema doğrulama model işi değildir**; deterministik kodla ve
   API maliyeti olmadan yapılır.
6. JSON güvenilirliği için **assistant prefill kullanılmaz**
   (`output_config.format` structured output veya `strict: true` tool).
7. Başarı metriği yalnız istek başına maliyet değildir. Asıl metrikler:
   kabul edilen patch başına maliyet · ilk seferde kabul oranı · validator
   başarı oranı · müzikal kalite eval puanı · kullanıcı ret oranı.
8. Maliyet azaltımı **müzikal model kalitesinden değil**, gereksiz bağlamdan
   ve gereksiz API çağrılarından yapılır.
9. `ARANJE_MODEL_ESCALATION` Faz 2 müzikal değerlendirmesine kadar boş kalır.
   Otomatik escalation pilotta kapalıdır; yalnız eval ve açık ürün kararıyla
   açılır.

### §11.3 Sağlayıcı ve adapter (§19 K-5)

- `CopilotPatch` sözleşmesi ve `lib/ai/adapter.ts` **sağlayıcıdan bağımsız**
  yazılır.
- **Pilotta yalnız Anthropic adapter'ı implemente edilir.** v1.2 §11.4–11.5'te
  atıf yapılan OpenAI dokümanları mimari emsaldir, entegrasyon talimatı
  değildir.
- Adapter, model kimliğine göre desteklenen request payload'ını kurar. Route
  farklı capability'lere sahip modellere aynı ham payload'ı göndermez.
- Adapter her model için **golden request snapshot birim testi** taşır.
- Adapter, girdi ve çıktı token tavanlarını **somut sayı olarak** zorlar:
  `ARANJE_MAX_INPUT_TOKENS` ve `ARANJE_MAX_OUTPUT_TOKENS`. Bu iki değer
  **Faz 2 başlamadan önce belirlenir** (§14.5) ve §12.3'teki rezervasyon
  hesabının girdisidir. Tavanı aşan istek adapter seviyesinde reddedilir.
- README; Messages API, tool use, prompt caching, streaming ve model migration
  dokümanlarına referans verir.

### §11.4 Akış

```
Telefon/istemci ──prompt + kompakt bağlam──► Aranjé API
                                              │ kota + rate limit kontrolü
                                              ▼
                                          AI modeli (structured output)
                                              │
                                    zod → §10 validator'ları
                                    (en fazla 2 düzeltme turu)
                                              ▼
Telefon/istemci ◄──SSE durum + validated patch──┘
```

1. İstemci hedef section ve komşularını **kompakt formatta** backend'e
   gönderir (§11.5).
2. Backend kullanıcı kotasını ve global bütçeyi kontrol eder (§12).
3. Model yalnız tanımlı `CopilotPatch` şemasında öneri üretir.
4. Backend zod + §10 validator'larını çalıştırır. Hard error varsa modele
   hata listesiyle **en fazla 2 düzeltme turu** yaptırılır.
5. İstemci gerçek durum olaylarını SSE ile alır: `generating`, `validating`,
   `retrying`, `done`, `failed`. **Sahte ilerleme mesajı üretilmez.**
6. Son patch **istemcide tekrar doğrulanır** ve pending olarak gösterilir.
7. **Kullanıcı kabul etmeden canonical Song değişmez.**

Hâlâ geçmiyorsa kullanıcıya anlaşılır hata döner (hangi nota, hangi bar).

### §11.5 Token ekonomisi

- **Modele ham Song JSON gönderilmez.**
- Yalnız **hedef section + bir önceki + bir sonraki** section ile tek satır
  meta gönderilir.
- Kompakt taşıma formatı örneği:

  ```txt
  gtr: E2 E2 . G2 - - A2 G2
  drm: K+H H S+H H K+H H S+H H
  ```

  Canonical model ayrıntılı kalır; **AI taşıma formatı kompakttır.**
- Sabit prompt + şema + stil kartı **byte-sabit cache bloğudur.**
- **Prompt cache prefix sırası zorunludur:** `tools → system → messages`.
  Sabit blok (sistem promptu, şema, stil kartı) **önce**; değişken blok
  (section verisi, kullanıcı promptu) **sonra**. Ters sırada cache hiç tutmaz.
- Structured output / tool-use **zorunludur.**
- Düzeltme turu **en fazla 2**'dir.
- Prompt ve output token sınırları adapter seviyesinde zorunludur.
- Aynı prompt + section hash'i için kısa süreli cache kullanılabilir (§12.2).
- Kullanım ve tahmini maliyet loglanır (§12.4).

### §11.6 Müzikal kalite

"Ruh" yalnız daha pahalı modelden gelmez. Birlikte değerlendirilen katmanlar:
stil kartının somut örnekleri · motifin section'lar arasında devamı · velocity
ve articulation · akor voicing'i ve gitar çalınabilirliği · groove /
humanization · kullanıcının kabul-ret geçmişi.

### §11.7 Stil kartları

- `content/styles/*.md`. Pilotta 2 kart: `generic-metal.md`,
  `progressive-atmospheric-acoustic.md` (§19 K-18).
- **Kartlar özellik tabanlıdır.** Sanatçı, grup, şarkı veya telifli eser adı
  kullanılmaz; kart bir sanatçıyı taklit etme talimatı değil, doku tarifidir.
- Kart formatı: tonalite eğilimleri, ritmik karakter, tempo aralığı, doku
  tarifi.
- Kart içeriği **talimat katmanındadır** (sistem promptu); kullanıcı ve Song
  verisi **veri katmanındadır** (data fence). İkisi karışmaz.
- Route, prompt içinde stil adı geçerse ilgili kartı sistem promptuna ekler;
  geçmezse kart eklenmez.
- Kart içerikleri route/build zamanında fs ile okunur.

---

## §12 Maliyet güvenliği ve pilot kotası

Harici model API'si kullanıldığı için mutlak sıfır değişken maliyet garanti
edilemez. Toplam zarar baştan kesin bir tavanla sınırlandırılır.

### §12.1 Pilot varsayılanları

```txt
ARANJE_DAILY_AI_BUDGET_USD=2
ARANJE_MONTHLY_AI_BUDGET_USD=20
ARANJE_FREE_PATCHES_PER_USER_PER_DAY=3
```

Bu değerler **backend ortam değişkenleridir**; istemci veya APK tarafından
değiştirilemez.

### §12.2 Sayaç deposu — KV store (§19 K-7)

Kota, bütçe ve rate limit sayaçları **kalıcı ve paylaşılan bir KV store**'da
tutulur (Vercel KV / Upstash Redis).

- Yalnız şunlar için kullanılır: harcama sayacı, kullanıcı/cihaz kotası, rate
  limit pencereleri, prompt+section hash cache'i.
- **DB değildir, auth değildir, Supabase değildir.** Şarkı verisi buraya
  yazılmaz; şarkı kalıcılığı localStorage'dadır (§5.6).
- Gerekçe: serverless'ta in-memory sayaç her instance'ta sıfırlanır ve
  fail-closed garantisi kâğıt üstünde kalır.
- Bu, "backend DB yok" ilkesine bilinçli ve **dar** bir istisnadır.

### §12.3 Atomik bütçe rezervasyonu (§19 K-12)

"Önce kontrol et, sonra çağır, sonra maliyeti yaz" sırası eşzamanlı isteklerde
bütçeyi aşar: iki istek aynı anda kontrolü geçip ikisi de sağlayıcıya gider.
Fail-closed garantisi ancak rezervasyonla gerçek olur.

- **Ön rezervasyon:** sağlayıcıya gitmeden önce, bu isteğin **en fazla üç model
  çağrısının** (ilk üretim + en fazla 2 düzeltme turu, §11.4) tahmini **üst**
  maliyeti atomik olarak rezerve edilir.
- **Tek işlem:** günlük ve aylık bütçe **aynı transaction / Lua script'i**
  içinde kontrol edilir ve artırılır. Kontrol ile artırma arasında başka bir
  isteğin araya girebileceği bir pencere bırakılmaz.
- **Rezervasyon sığmıyorsa istek reddedilir** ve sağlayıcıya hiç gidilmez.
- **Uzlaştırma yalnız aşağı yönlüdür ve yalnız doğrulanmış kullanımla yapılır.**
  Çağrı tamamlanıp sağlayıcıdan gerçek token kullanımı alınabildiyse rezervasyon
  gerçek maliyete indirilir, fark bütçeye geri verilir ve gerçek maliyet
  metering'e yazılır.
- **Kullanım doğrulanamıyorsa rezervasyon HARCANMIŞ kabul edilir.** Timeout, ağ
  hatası, kesilen bağlantı veya sonucu bilinmeyen her durumda rezerve edilen
  tutar bütçeden düşülmüş sayılır. Gerekçe: sağlayıcı o çağrıyı ücretlendirmiş
  olabilir; doğrulanamayan kullanımı "harcanmadı" saymak bütçeyi sessizce
  aşmanın yoludur.
- **Belirsiz rezervasyon, ilgili günlük/aylık bütçe penceresi kapanmadan
  serbest bırakılmaz.** Rezervasyonun serbest kalması için tek yol, gerçek
  kullanımın doğrulanıp aşağı yönlü uzlaştırılmasıdır. Pencere kapandığında
  sayaç zaten sıfırlandığı için ayrıca bir geri verme işlemi gerekmez.
- **Rezervasyon süresi ile idempotency/sonuç cache TTL'i ayrı kavramlardır.**
  Idempotency key'in ve sonuç cache'inin TTL'i istemci retry penceresine göre
  belirlenir (dakikalar); bütçe rezervasyonu ise bütçe penceresine bağlıdır
  (gün/ay). Biri diğerinin süresini belirlemez; ikisi ayrı anahtarlarda
  tutulur.
- **Idempotency:** her istek bir **idempotency key** taşır. Aynı key ile gelen
  retry **ikinci kez rezervasyon yapmaz**; var olan rezervasyonu ve varsa
  sonucunu kullanır.
- **KV erişilemiyorsa AI çağrısı yapılmaz.** Sayaç deposuna ulaşılamaması
  "limit yok" anlamına gelmez; istek fail-closed reddedilir.

Kullanıcı kotası (`ARANJE_FREE_PATCHES_PER_USER_PER_DAY`) ve "kullanıcı başına
aynı anda tek istek" kilidi de aynı atomik işlemin parçasıdır.

#### Rezervasyon üst sınırı ve başlangıç invariant'ı (§19 K-16)

Ölçüm tamamlanana kadar (§18) ön rezervasyon **en kötü durum** varsayımıyla
hesaplanır: 3 tur, cache isabeti yok, adapter'ın izin verdiği maksimum token.

```txt
worstCaseReservation =
  3 × ( ARANJE_MAX_INPUT_TOKENS  × girdi fiyatı
      + ARANJE_MAX_OUTPUT_TOKENS × çıktı fiyatı )
```

**Başlangıç invariant'ı — birim testlidir ve backend açılışında da doğrulanır:**

```txt
worstCaseReservation <= ARANJE_DAILY_AI_BUDGET_USD
```

Bu invariant sağlanmazsa **hiçbir istek geçemez**: ilk rezervasyon günlük
bütçeye sığmadığı için sistem her isteği reddeder ve dışarıdan "AI hiç
çalışmıyor" gibi görünür. İhlal hâlinde tek doğru çözüm ya
`ARANJE_MAX_OUTPUT_TOKENS` tavanını düşürmek ya da günlük bütçeyi yükseltmektir;
invariant testi devre dışı bırakılamaz.

### §12.4 Davranış kuralları

- Günlük ya da aylık global tavan dolduğunda sistem **fail closed** davranır:
  yeni AI isteği **sağlayıcıya hiç gitmeden** reddedilir, anlaşılır kota
  mesajı gösterilir.
- Kota dolunca **playback, kayıtlı şarkılar ve manuel düzenleme çalışmaya
  devam eder.**
- Rate limit kullanıcı, cihaz, IP ve global kapsamda uygulanır.
- **Kullanıcı başına aynı anda yalnız bir AI patch isteği** çalışabilir.
- Request öncesi tahmini token kontrolü; request sonrası gerçek
  input/output/cache token ve tahmini USD maliyeti kaydı yapılır.
- Model fiyatları koda gömülmez; **sürümlenebilir backend fiyat
  konfigürasyonundan** okunur.
- Bütçe, kota ve escalation için **backend kill-switch** bulunur.
- İnternet yoksa AI düğmesi bunu açıkça söyler; editör ve playback çalışır.

### §12.5 Monetizasyon yolu (pilotta uygulanmaz, yön olarak kayıtlı)

- Kapalı pilot ücretsizdir; ödeme entegrasyonu ürün kanıtını geciktirmez.
- İlk ticari model **Free + Pro**; reklam kullanılmaz. Temel akort, tel
  düzenleme ve Core Lite sesleri ücret duvarının arkasına konmaz. Değişken
  maliyet yaratan AI, audio analysis, cloud ve export Pro değerini oluşturur.
- **"Sınırsız AI" sözü verilmez.**
- Play üzerinden dağıtımda dijital abonelikler için Play Billing kullanılır;
  satın alma cihazda güvenilir sayılmaz, backend purchase token'ı doğrular.
- Ticari beta başladığında basit auth gerekir; üyelik ve AI kotası
  localStorage ile korunamaz.
- Fiyat ve kota **gerçek metering verisi görülmeden kilitlenmez.** Başlangıç
  hedefi, AI kredisinin değişken maliyetinin en az 3–5 katına fiyatlanmasıdır.

---

## §13 UI, bilgi mimarisi ve görsel dil

### §13.1 Ana ekran

Üç sabit bölge:

| Bölge | Her zaman görünen | Gizlenen |
|---|---|---|
| Üst bar | Şarkı adı, geri/menü | Dosya, import, ayarlar |
| İçerik | Section timeline, seçili section özeti | Nota/fret/drum ayrıntısı |
| Alt dock | Play/stop, mevcut bar, "Ne ekleyelim?" | AI seçenekleri, mixer |

- Section'lar yatay kaydırılır.
- Her section kartında ad, durum, bar sayısı ve **küçük çok şeritli önizleme**
  bulunur.
- Kart yüksekliği yaklaşık **100–120 px**.
- Kart üzerindeki noktalar **editör değil, müzikal konturdur.**
- Bir karta dokunmak ayrıntı bottom sheet'ini açar.

### §13.2 AI komutu

- Dev bir sohbet alanı sürekli açık durmaz.
- Alt dock'taki "Ne ekleyelim?" alanına dokununca **AI bottom sheet**'i açılır.
- Sheet'te yalnız prompt, isteğe bağlı stil seçimi ve "Üret" bulunur.
- Geçmiş konuşma ana ekranda yer kaplamaz; menüden açılır.

### §13.3 Pending öneri

- Pending kart **kesikli bronz çerçeve** ve hafif breathe animasyonu kullanır.
- Pending section seçiliyken ekranın altında tek **karar çubuğu**: "Dinle",
  "Kabul", "Ret".
- Üç buton da **en az 44 px** dokunma hedefidir.
- Kabul → `status: "accepted"`, localStorage'a yaz. Ret → section silinir,
  kısa scale-out animasyonu (Faz 2.5, §3).

### §13.4 Track ve davul yönetimi

- Ana ekranda sürekli mixer gösterilmez.
- Track başlığına dokununca **Track Settings** bottom sheet'i açılır.
- Çekirdekte burada: enstrüman/varyasyon bilgisi, volume, mute, akort preset
  seçimi. Pan/solo ve tel tel manuel akort Faz 2.5'te.
- Davul editörü ilk açılışta kick, snare, hi-hat gösterir; ek lane'ler
  Faz 2.5'te "Parça ekle" sheet'i ile açılır. **Parça eklemek yeni track
  oluşturmaz**, aynı kit içindeki lane'i gösterir.

### §13.5 Mini şeritler (mini-tab)

- **Her track için ayrı mini şerit.**
- Gitar tel sayısına göre çizgi (çekirdekte 6), bas tel sayısına göre
  (çekirdekte 4), davul **3 lane grid** (kick/snare/hat); ek parçalar yalnız
  ayrıntıda.
- Nota yüksekliği **section min/max'ına göre değil**, enstrüman aralığına veya
  hesaplanmış gerçek string/fret pozisyonuna göre çizilir.
- **Bar bölücüleri section bar sayısına göre dinamik** oluşturulur (sabit
  `left:50%` / `/16` yaklaşımı taşınmaz).
- Önizleme editör değil, section konturudur. alphaTab kullanılmaz.

### §13.6 Görsel dil — Dark Workshop

Arayüz "editoryal poster" yerine modern bir müzik aleti gibi davranır. Bronz
her yerde kullanılan dekor değil, **AI ve yaratıcı müdahale rengidir.**

| Rol | Değer |
|---|---|
| Uygulama zemini | `#101114` |
| Panel | `#181A1F` |
| Yükseltilmiş panel | `#202329` |
| Çizgi / grid | `#30343C` |
| Ana metin | `#F0ECE4` |
| Soluk metin | `#9CA2AC` |
| Playback / aktif seçim (çelik) | `#7FA7B8` |
| AI / pending (bronz) | `#C58A3A` |
| Kabul (yeşil) | `#56866A` |
| Ret / hata (kırmızı) | `#B55E57` |

Renkler semantiktir: çelik = çalan/seçili, bronz = AI önerisi, yeşil = kabul,
kırmızı = geri döndürülemez veya hatalı. Enstrümanlar sürekli farklı renklere
boyanmaz; küçük ikon/etiketlerle ayrılır.

**Section rengi ayrı bir `kind` alanından değil, durumdan ve baskın
instrument/preset metadata'sından türetilir.** Durum renkleri enstrüman
renginin önüne geçer. `Section` şemasına `kind` alanı **eklenmez.**

Tipografi ve biçim:

- **Fraunces** yalnız marka, onboarding ve büyük boş durum cümlelerinde.
- **Inter** editör, sayı, süre, akort ve kontrollerde.
- İtalik bronz metin dekor olarak tekrarlanmaz.
- Köşeler orta yuvarlaklıkta, çizgiler ince, gölgeler minimum.
- Dokunma hedefleri **≥ 44 px**; kritik transport 48–52 px olabilir.
- Fontlar **`next/font` ile self-host** edilir (Google CDN link'i kullanılmaz).
- Animasyonlarda **`prefers-reduced-motion`** desteği bulunur.

**Not (§19 K-8):** Bu palet prototipin sıcak kahve-siyahından (`#15130F` /
`#1E1A14`) nötr mavi-siyaha geçiştir. v1.2 §5 "sıcak/karanlık karakter
korunur" dese de verdiği hex'ler nötrdür; somut olan hex'ler esas alınmıştır.

### §13.7 Prototipten taşınan / taşınmayanlar

**Taşınır:** pending kesikli çerçeve + breathe animasyonu ve reduced-motion
guard'ı · `playing-now` inset ring · ret scale-out animasyonu · örnek şarkının
nota içeriği (E doğal minör metal riff + akustik pasaj — demo şarkısı ve
stil kartlarının doku referansı; kartlar sanatçı adı taşımaz, §19 K-18).

**Taşınmaz:** `Tone.Draw.schedule(fn, Tone.now())` (§8.3) · mutlak saniye
aritmetiği (§8.3) · davulun procedural üretilmesi — davul veri modelinin
parçasıdır (§5.4) · çalma anında `transpose(7)` ile power chord üretimi —
akorlar veride `NoteEvent[]` olarak açık durur · `status: "rejected"` (§5.3) ·
33 px butonlar ve 860 px masaüstü yerleşimi (§13.6) · Google Fonts CDN link'i ·
`Tone.Distortion` dışındaki prototip efekt kurgusu §8.1 ile sınırlanır.

---

## §14 Stack, mimari ve fazlar

### §14.1 Stack (sabit — değiştirme, öneri varsa sor)

- Next.js (App Router) + TypeScript **strict** + Tailwind.
- **Tone.js `14.8.49`** — yalnız §8.1'de izin verilen node'lar.
- **zod** — şema ve patch doğrulama.
- **Vitest** — validator'lar, pozisyon motoru, adapter golden snapshot,
  patch akışı.
- AI: **Anthropic Messages API**, yalnız sunucu tarafı route üzerinden
  (`/api/copilot`). Anahtar `.env.local` → `ANTHROPIC_API_KEY`, **client'a
  veya APK'ya asla sızmaz.**
- Kota/metering sayaçları: KV store (§12.2).
- Şarkı verisi: localStorage. Şarkı için backend DB yok.
- `nextjs-supabase-standards` skill'i geçerlidir (Supabase bölümleri hariç).

### §14.2 İki build hedefi (§19 K-9)

Next.js statik export route handler barındıramaz; `/api/copilot` statik
çıktıdan servis edilemez. Bu yüzden tek repodan **iki hedef** üretilir:

| Hedef | İçerik | Dağıtım |
|---|---|---|
| **Client** | `output: 'export'` statik istemci | Web + Capacitor Android kabuğu |
| **API** | Normal Next.js deployment, yalnız `/api/*` | Vercel |

- İstemci backend'e **mutlak URL** ile gider:
  `NEXT_PUBLIC_ARANJE_API_BASE`.
- API tarafında CORS yalnız bilinen origin'lere ve Capacitor şemasına açılır.
- Model/API anahtarı APK veya istemci bundle'ına **girmez.**

### §14.3 Faz 0 — Temel ve model

- Next.js, TypeScript strict, Tailwind, zod, Vitest kurulu.
- §5'teki **tam** Song/Track/NoteEvent/DrumHit/Bar/Section şeması —
  `tuning`, `capo`, `velocity`, `position` **baştan** bulunur.
- Instrument registry ve preset metadata (§7.1).
- `lib/limits.ts` (§6).
- Validator'lar: slot sayısı (4/4, 3/4, 6/8, 7/8 × 8/16), tuning/fretboard,
  davul multi-hit, referential integrity.
- Örnek metal şarkı (4 track) localStorage'dan yükleniyor; mobil boş/özet
  timeline çiziliyor.
- Prototip `design/prototype.html` olarak yalnız referans.

**KABUL:** §15 komutları temiz; telefonda sayfa açılıyor, örnek şarkı
listeleniyor; `é` lint testi yeşil.

### §14.4 Faz 1 — Ses ve sade mobil editör

- Aktif enstrümanların lazy sample yüklemesi (§7.2).
- Distortion dahil §8.1 güvenli ses zinciri; §8.3 scheduling kurallarına tam
  uyum.
- Play/stop, bar highlight, section loop.
- Section timeline, mini şeritler (§13.5), bottom sheet'ler (§13.1).
- Track ayarı: volume/mute + akort preset seçimi.
- **Sample yükleme / ses hata / offline durum ekranları** (yükleniyor, sample
  indirilemedi, ses bağlamı başlamadı, çevrimdışı).
- Debug metreleri ve sayaçları (§8.4).

**KABUL:** telefonda örnek şarkı 4 enstrümanla baştan sona duyuluyor;
§14.6'nın **Faz 1 performans testi yeşil**; tüm birim testleri yeşil;
§15 komutları temiz.

### §14.5 Faz 2 — Copilot ve ÇEKİRDEK MÜZİKAL KANIT

**FAZ 2 BAŞLAMA KOŞULU (§19 K-16):**

- [ ] Adapter'ın somut `ARANJE_MAX_INPUT_TOKENS` ve `ARANJE_MAX_OUTPUT_TOKENS`
      tavanları belirlendi (§11.3).
- [ ] `worstCaseReservation <= ARANJE_DAILY_AI_BUDGET_USD` invariant'ı birim
      testiyle doğrulandı (§12.3).

Kapsam:

- `/api/copilot` çalışıyor; §11 akışı uçtan uca; SSE durum olayları gerçek.
- 2 stil kartı aktif.
- Küçük müzikal eval seti; `ARANJE_MODEL_ESCALATION` kararı burada verilir.
- Rate limit, kota, atomik bütçe rezervasyonu ve metering çalışıyor (§12).
- **Anlaşılır AI/patch hata durumları:** validator hatası (hangi nota, hangi
  bar), kota dolu, sağlayıcı hatası, zaman aşımı, çevrimdışı.

**FAZ 2 ÇIKIŞ KAPISI — bunlar sağlanmadan Faz 2.5'e BAŞLANMAZ:**

- [ ] Telefonda web demo uçtan uca çalışıyor: metal şarkı çalıyor; bir section
      seçilip `arrange_track` ile `harmony` (veya `bass` / `drums`) çalıştırılıyor;
      yalnız hedef track değişiyor, kaynak gitar aynı kalıyor, sonuç dinleniyor,
      kabul ediliyor ve kalıcı oluyor (§19 K-18).
- [ ] Kasıtlı bozuk patch anlaşılır hata veriyor.
- [ ] Açık position çakışması hard error üretiyor (§10.2 kapsamıyla).
- [ ] §14.6'nın Faz 1 performans testi yeşil.
- [ ] Build, tsc, test ve lint yeşil.
- [ ] Metering çalışıyor; istek başına token ve tahmini maliyet loglanıyor.
- [ ] Atomik bütçe rezervasyonu (§12.3) çalışıyor; eşzamanlı istek testinde
      tavan aşılmıyor, KV erişilemezken istek reddediliyor.
- [ ] **Lighthouse mobile performance ≥ 80.**
- [ ] §18'deki maliyet tablosu gerçek serializer token sayıları ve cache
      istatistikleriyle dolduruldu.

### §14.6 Ölçülebilir performans protokolü

- İki referans telefonun **model, Android ve WebView sürümü** kaydedilir.
- **Faz 1:** çekirdek demo (4 track × 16 bar × 16 resolution) **beş kez**
  baştan sona çalınır.
- **Faz 3:** sekiz track'in aynı section'da aktif olduğu 16 barlık **stres
  fixture'ı beş kez** çalınır; ayrıca 64 barlık şarkı bir kez tamamlanır.
- Test hem ekran açık beklerken hem section'lar arasında kaydırma yapılırken
  uygulanır.
- **Kabul:** kaçırılmış ses olayı = 0; 50 ms'den fazla geciken **audio event**
  = 0; donma / transport kayması = 0.
- `Tone.Draw` gecikmeleri audio scheduling ile karıştırılmaz; sayaçlar ayrıdır
  (§8.4).
- `?debug=1` test sonunda kopyalanabilir rapor üretir.

### §14.7 Faz 2.5 — pilot genişletmesi

§3'teki kapsam (cila maddeleri dahil). Lighthouse hedefi burada **değil**,
Faz 2 çıkış kapısındadır (§14.5).

### §14.8 Faz 3 — Android pilotu

- Next.js statik export + **Capacitor Android** projesi (§14.2).
- İki referans telefonda §14.6 audio regression protokolü.
- **İmzalı APK.**
- İnternet yokken playback, manuel düzenleme ve kayıtlı projeler çalışır; AI
  bağlantı ister.
- Mağaza yayınında aynı projeden Android App Bundle (AAB) üretilir.

**Pilot ancak Faz 3 APK'sı telefona kurulunca tamamlanmış sayılır.**

React Native veya ayrı native ses motoru, ancak WebView performansı ürün
hedeflerini karşılamazsa **pilot sonrasında** değerlendirilir.

---

## §15 Doğrulama komutları (her fazda)

```sh
npm run build
npx tsc --noEmit
npm test
npm run lint
```

Bunlardan biri kırmızıysa **faz bitmemiştir.** Her faz sonunda kabul
kriterleri ve bu komutların sonuçları raporlanır.

---

## §16 Sahip aksiyonları (Claude Code yapamaz)

Bu maddeler fiziksel cihaz veya gizli anahtar gerektirir; **Haktan'ın
sorumluluğundadır.** Claude Code altyapıyı hazırlar, ölçümü sahip yürütür.

- §14.6 performans protokolünün **iki gerçek Android telefonda** koşulması ve
  cihaz/WebView sürümlerinin kaydı.
- Faz 3 **APK imzalama** (keystore) ve telefona kurulum.
- KV store ve Vercel projelerinin oluşturulması, `ANTHROPIC_API_KEY` ve §12.1
  env değerlerinin backend'e girilmesi.
- Sample dosyalarının lisans doğrulaması sonrası nihai onayı (§7.3).

---

## §17 Riskler ve bilinen dersler

- **§17.1 Mobil WebView ses uyumsuzluğu** → §8.1 ilkesi + §8.4 metre. Ses
  sorununda ilk bakılacak yer debug metresidir, kod değil.
- **§17.2 Sample tedariki bu pilotun en büyük içerik riskidir.** Core Lite'ın
  tamamı ~25 sample seti demektir. Çekirdek bunu **4 gerçek sete** indirir
  (temiz elektro gitar, çelik akustik, elektro bas, rock davul kit);
  high-gain ve palm_mute sample değil, sinyal zinciri işidir (§7.1).
- **§17.3 Sample dosya boyutu** → oktav başına 2–3 sample; ilk şarkı yükü
  ≈ 8 MB hedefi (§7.2).
- **§17.4 Model JSON disiplini** → structured output + zod + en fazla 2
  düzeltme turu (§11.4–11.5).
- **§17.5 Prompt cache sırasının bozulması** girdi maliyetini belirgin biçimde
  artırır; etkisi Faz 2 metering'inde ölçülür (§18). §11.5'teki prefix sırası
  bir birim testiyle korunur.
- **§17.6 iOS sessiz mod anahtarı** sesi kesebilir → ilk çalmada "sesi açık
  tuttuğundan emin ol" ipucu gösterilir.
- **§17.7 Aylık bütçe** günlük tavan tam dolarsa 10 günde biter (§12.1).
  Bilinçli bir tercih olarak kayıtlıdır.

---

## §18 Maliyet referansı — Faz 2'de ölçümle doldurulur (§19 K-14)

Fiyatlar §12.4 gereği sürümlenebilir backend konfigürasyonundan okunur; bu bölüm
**kaynak değildir.**

**Bu spec tahmini rakam vermez.** Maliyet değerleri, Faz 2'de gerçek serializer
token sayıları ve gerçek cache istatistikleri ölçüldükten sonra doldurulur.
**O tarihe kadar bütçe kapasitesi için patch/gün veya kullanıcı/gün tahmini
verilmez** — ölçülmemiş rakam plan yapmak için kullanılamaz.

Ölçüm yöntemi (Faz 2'de uygulanacak):

```txt
istek maliyeti =
    (taze girdi token × girdi fiyatı)
  + (cache okuma token × cache okuma fiyatı)
  + (cache yazma token × cache yazma fiyatı)
  + (çıktı token × çıktı fiyatı)

patch maliyeti  = Σ (her turun gerçek istek maliyeti)      // tur sayısı 1..3
kabul başına    = toplam patch maliyeti / kabul edilen patch sayısı
günlük kapasite = ARANJE_DAILY_AI_BUDGET_USD / ölçülen ortalama patch maliyeti
```

Ölçüm girdileri metering'den gelir (§12.4): istek başına gerçek
input / output / cache_read / cache_write token sayıları ve tur sayısı.
Turlar aynı maliyette değildir — düzeltme turları farklı girdi ve farklı cache
isabeti taşır — bu yüzden patch maliyeti tur sayısıyla çarpılarak değil,
**turların gerçek maliyetleri toplanarak** bulunur. Ön rezervasyon üst sınırı
ve başlangıç invariant'ı §12.3'tedir.

Asıl karar metriği istek başına maliyet değil, **kabul edilen patch başına
maliyettir** (§11.2/7).

---

## §19 Değişiklik günlüğü — v2.0'da alınan kararlar

| # | Karar | Kaynak |
|---|---|---|
| **K-1** | Model stratejisi: müzikal patch üretimi **doğrudan `ARANJE_MODEL_DEFAULT`** ile. "Önce ucuz model" yaklaşımı kaldırıldı; `ARANJE_ENABLE_CHEAP_ROUTING=false` eklendi. v1.5 §7.4'teki "ucuz model önce denenir" ifadesi §11.2 ile değiştirildi. | Haktan, 19.08.2026 |
| **K-2** | v1.2 §14 Faz 3'ün maddeleri fazlara **ayrıştırıldı**: sample yükleme/ses hata durumları → **Faz 1**; anlaşılır AI/patch hata durumları ve Lighthouse mobile ≥ 80 → **Faz 2 çıkış kapısı**; ret animasyonu, son 10 karar ve kapsamlı görsel cila → **Faz 2.5**. | Haktan, 19.08.2026 |
| **K-3** | `stringCollision` hard error'ı **track bazında** kapsandı. Aksi hâlde iki rhythm gitar sahte hata üretirdi. | Claude Code önerisi — **Haktan onayladı 19.08.2026** |
| **K-4** | Greedy pozisyon kuralının **tel değişimini minimize etmediği** açıkça kayda geçti; v1.2 §6.2'nin maliyet listesi pilot sonrasına taşındı. | Claude Code önerisi — **Haktan onayladı 19.08.2026** |
| **K-5** | Pilotta **yalnız Anthropic adapter'ı** implemente edilir; sözleşme sağlayıcıdan bağımsız kalır. v1.2 §11.4–11.5'teki OpenAI linkleri emsaldir. | Haktan, 19.08.2026 |
| **K-6** | tonejs-instruments **tek lisans altında sayılmaz**; dosya bazında provenance doğrulaması zorunlu. | Claude Code önerisi — **Haktan onayladı 19.08.2026** |
| **K-7** | Kota/bütçe/rate-limit sayaçları **KV store**'da tutulur; "backend DB yok" ilkesine dar istisna. | Haktan, 19.08.2026 |
| **K-8** | Görsel kimlik prototipin sıcak paletinden v1.2 §5.1'in nötr **Dark Workshop** paletine geçer. | v1.2 §5.1 |
| **K-9** | Statik export + API aynı build'de olamaz → **iki build hedefi** ve `NEXT_PUBLIC_ARANJE_API_BASE`. | Teknik zorunluluk — **Haktan onayladı 19.08.2026** |
| **K-10** | Faz 0 kapısı, v1.2 §17 ve v1.5 §8 checklist'lerinin **birleşimidir**; çakışan rakamlarda v1.5 değeri geçerlidir. | v1.5 §0 |
| **K-11** | `ARANJE_MODEL_CHEAP` tarihli ID olarak korunur; **cheap routing açılmadan önce Models API ile doğrulanır** (§11.2/4). | Haktan + Claude Code notu |
| **K-12** | Bütçe tavanı **atomik rezervasyonla** uygulanır: ön rezervasyon, tek transaction/Lua'da günlük+aylık kontrol, gerçek maliyetle uzlaştırma, belirsizlikte rezervasyonu bekletme, idempotency key, KV erişilemezse çağrı yok. Fail-closed ancak böyle gerçektir. | Haktan, 19.08.2026 |
| **K-13** | Marka adı çelişkisi çözüldü: `lib/brand.ts` içinde `BRAND_NAME = "Aranj\u00E9"`. Lint yalnız **ham** `é`'yi yasaklar; kullanıcı yine Aranjé görür. | Haktan, 19.08.2026 |
| **K-14** | §18'deki tahmini maliyet rakamları **kaldırıldı**; ölçüme dayanmıyorlardı. Yöntem/formül kaldı, değerler Faz 2'de gerçek token ve cache istatistikleriyle doldurulacak. O tarihe kadar patch/gün kapasite tahmini verilmez. | Haktan, 19.08.2026 |
| **K-15** | Sample manifestine `licenseSpdx`, `licenseTextPath` ve `attribution` alanları eklendi; build çıktısına `THIRD_PARTY_NOTICES.md` üretilir. | Haktan tavsiyesi, 19.08.2026 |
| **K-16** | Belirsizlik kuralı tersine çevrildi: **kullanım doğrulanamıyorsa rezervasyon harcanmış sayılır**; uzlaştırma yalnız aşağı yönlü ve yalnız doğrulanmış kullanımla yapılır; belirsiz rezervasyon bütçe penceresi kapanmadan serbest bırakılmaz; rezervasyon süresi ile idempotency/cache TTL'i ayrı kavramlardır. Ayrıca adapter'ın somut token tavanları ve `worstCaseReservation <= dailyBudget` başlangıç invariant'ı Faz 2 başlama koşulu yapıldı; §18'de patch maliyeti tur sayısıyla çarpım yerine **turların toplamı** olarak düzeltildi; `lib/brand.ts` örneğindeki yorum ASCII'ye çevrildi. | Haktan, 19.08.2026 |
| **K-17** | `tonalMajority` için 11/12 perde sınıfını kapsayan birleşik küme **kaldırıldı**. Tonal çekirdek yalnız deklarasyondaki yedi notalı majör veya doğal minör dizidir; harmonik/melodik minör yükseltmeleri, `b5`, ödünç notalar ve kromatik geçişler **renk notasıdır** ve çoğunluk payına eklenmez. "Komşusu kromatikse otomatik tonal say" istisnası kaldırıldı. Validator yalnız **en az 3 pitched onset** bulunan barda karar verir; geçmek için çekirdek oran **kesinlikle %50'den fazla** olmalıdır. Ayrıca §10.3'te ertelenen olağandışı fret sıçraması uyarısı uygulandı; eşikler tek merkezi kaynakta (gitar > 7, bas > 5 fiziksel fret). | Haktan, 19.08.2026 |
| **K-18** | İlk kullanıcı ürünü, section'ın tamamını değiştiren `replace_section` değil, yalnız hedef track'i düzenleyen **`arrange_track`** oldu. Public `/api/copilot` strict şeması yalnız `arrange_track` kabul eder; `insert_section` / `replace_section` public route'tan kaldırıldı (dış kullanıcı olmadığı için geniş contract backward compatibility uğruna korunmadı). Sağlayıcı çıktısı section'ın tamamını değil **yalnız hedef track'in slotlarını** döndürür; melodik çıktıda explicit `position` reddedilir. Target dışı bütün track'ler sunucu tarafında kilitlidir; `lockedTrackIds` yalnızca ek açıklıktır. `patchSize` artık target track içinde dokunulan bar sayısını ölçer. Stil kartları sanatçıya değil **özelliğe** dayanır; `opeth-acoustic.md` yerine `progressive-atmospheric-acoustic.md`. | Haktan, 19.08.2026 |
| **K-19** | **Ergonomic Placement v2.** `position` yazılmamış fretted melodik onset'ler artık hafızasız greedy ile tek tek değil, track'in zaman sıralı bağlamı içinde deterministic beam-search / dynamic-programming ile yerleştirilir (§9.2). Maliyet ağırlıklı bir skor değil, **lexicographic tuple**'dır; eşikler `limits.ts`'teki tek merkezi kaynaktan gelir ve beam width orada sabittir (runtime env ayarı yok). El konumu ölçüleri (anchor, chord span, string center) ve reset/carry semantiği `fretJump` ile **aynı** yardımcıdan gelir; tab, validator, preview ve playback tek yerleşim modelini kullanır. Explicit `position` her zaman korunur ve motor tarafından değiştirilemez. K-4'ün hafızasız kuralı üretimden kaldırıldı; parmak numarası, barre analizi ve picking ergonomisi bu sürümün iddiası değildir. | Haktan, 19.08.2026 |

### §19.1 v1.5'in v1.2'yi geçersiz kıldığı yerler

| Konu | v1.2 | Geçerli (v1.5) |
|---|---|---|
| Track sınırı | 6 aktif track | **8**, section başına aktif-track limiti yok |
| Toplam bar | 64 (pilotta zorunlu) | **16 çekirdek**, 64 Faz 2.5 |
| Ölçüler | 4/4, 3/4, 6/8, 7/8 hepsi pilotta | **4/4 + 6/8 çekirdek**, kalanı Faz 2.5 |
| Tel ekle/çıkar, 7/8 telli gitar, 5/6 telli bas | Pilotta gelişmiş ayar | **Pilot sonrası** |
| Tel tel manuel akort, pan/solo, davul lane | Faz 1 | **Faz 2.5** |
| Pozisyon motoru | 4 maliyeti minimize eden motor | **Deterministik greedy** (§9.2) |

---

## §20 Faz 0 geçiş kapısı

v1.2 §17 ve v1.5 §8'in birleşimi (K-10). Çakışan rakamlarda v1.5 değeri
kullanılmıştır.

**Şema, model ve kapsam**

- [x] §2 track modeli işlendi: `maxTracks=8`; aynı enstrümandan birden fazla track serbest; section başına aktif-track limiti yok. → §5.2, §6
- [x] Faz planı ve çekirdek kapsam işlendi. → §2, §3, §14
- [x] Şema tam, kapsam çekirdek olarak yazıldı. → §5, §2
- [x] Instrument/preset registry eklendi. → §5.2, §7.1
- [x] Tuning/string/fret modeli eklendi. → §5.2, §9.1
- [x] Capo-relative fret semantiği işlendi. → §9.1
- [x] Davul multi-hit modeli eklendi. → §5.4
- [x] Velocity ve sınırlı articulation eklendi. → §5.4, §2.9
- [x] 3/4, 6/8, 7/8 ölçü preset'leri ve resolution modeli işlendi (çekirdek 4/4 + 6/8). → §5.5, §2.6
- [x] 8 track / 16 bar çekirdek (64 Faz 2.5) / patch başına 8 bar sınırı işlendi. → §6

**Validator ve motor**

- [x] Validator ayrımı, greedy kural, `limits.ts` ve voice sınırı işlendi. → §6, §9.2, §10
- [x] Distortion yasağı kaldırıldı ve izin listesine eklendi. → §8.1

**Enstrüman ve ses**

- [x] Core Lite 10 enstrüman listesi ve lazy-load politikası eklendi. → §7.1, §7.2
- [x] Eski 8 MB toplam katalog sınırı, ilk şarkı yükü hedefi olarak düzeltildi. → §7.2

**UI**

- [x] Mobil bottom-sheet bilgi mimarisi eklendi. → §13.1–13.4
- [x] Akort preset'leri + tel tel manuel düzenleme + tel ekle/çıkar fazlandırıldı (preset çekirdek, manuel Faz 2.5, tel ekle/çıkar pilot sonrası). → §9.1, §3, §4
- [x] KISS tanımı ilke bölümüne girdi. → §1.3
- [x] Basit/Pro modu pilot sonrası bölümünde adıyla yer aldı. → §4

**AI, maliyet ve mimari**

- [x] Model seçimi provider-agnostic config + Faz 2 eval olarak güncellendi. → §11.2, §11.3, §14.5
- [x] **Model stratejisi işlendi: müzikal üretim doğrudan default model; cheap routing pilotta kapalı.** → §11.2 (K-1)
- [x] §7.1 env varsayılanları ve §7.2 adapter işlendi. → §11.2, §11.3
- [x] Telefon → backend → model → validated patch mimarisi işlendi. → §11.4, §14.2
- [x] §7.4 global bütçe tavanı, kullanıcı kotası, rate limit, kill-switch ve fail-closed davranışı işlendi. → §12
- [x] Free + Pro abonelik ve kota temelli monetizasyon yolu işlendi. → §12.5
- [x] Audio import pilot sonrası deney olarak yazıldı. → §4

**Faz kabulü**

- [x] §5.4 performans protokolü Faz 1 ve Faz 3 kabulüne işlendi. → §14.4, §14.6, §14.8
- [x] Capacitor APK hedefi Faz 3 kabul kriterine eklendi; APK'nın pilot tamamlanma kriteri olduğu yazıldı. → §14.8

**KAPI DURUMU: 27/27 — Faz 0'a başlanabilir.**

Kapı geçildikten sonra Faz 0'a başla. Her faz sonunda kabul kriterleri ve
doğrulama komutları raporlanır. **Faz 2 müzikal kanıtı alınmadan Faz 2.5'e
geçilmez.**
