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
  bpmOverride?: number;           // bu section'ın kendi tempsu (§8.3, K-25)
  bars: Bar[];                    // 1..barsPerSection
};
```

`status` sadece bu üç değeri alır. **Ret = section silinir**; ayrı bir
`"rejected"` durumu yoktur (ret animasyonu geçici UI state'i ile yapılır).

`bpmOverride` **section seviyesindedir, bar seviyesinde değildir** (§19 K-25).
Yoksa section şarkının kendi `bpm` değerinde çalar; hiçbir şey bir sonraki
section'a taşınmaz. Bar içinde tempo değişimi, ramp ve rubato bu sürümün
kapsamı dışındadır. `bpmOverride` müziğin parçasıdır: kilitli yüzeydedir ve
bir arrange patch'i onu değiştiremez (§11.1).

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

/** Bir tam notanın kaça bölündüğü (§19 K-34). */
type Resolution = 8 | 12 | 16 | 24 | 32;

type Bar = {
  timeSignature: TimeSignature;
  resolution: Resolution;
  slots: Record<string, MelodicSlot[] | DrumSlot[]>;   // trackId -> slot dizisi
};

const slotCount = (ts: TimeSignature, res: Resolution) => (ts[0] * res) / ts[1];
```

Örnekler: 4/4 + 8 → **8 slot**; 4/4 + 12 → **12**; 4/4 + 16 → **16**;
4/4 + 24 → **24**; 4/4 + 32 → **32**; 6/8 + 8 → **6**; 6/8 + 16 → **12**;
3/4 + 12 → **9**; 7/8 + 8 → **7**.

**Grid sözlüğü (§19 K-34).** Resolution "bir tam notanın kaç parçaya
bölündüğü"dür; bu yüzden aynı sayı her ölçüde aynı şeyi ifade eder:

| Değer | 4/4 slot | Anlamı |
|---|---|---|
| 8 | 8 | sekizlik |
| 12 | 12 | **sekizlik triplet** |
| 16 | 16 | onaltılık |
| 24 | 24 | **onaltılık triplet** |
| 32 | 32 | otuzikilik |

`12` ve `24` **üçleme grid'leridir**, "biraz daha sık düz grid" değildir: bir
vurus üç slottur, iki veya dört değil. Kullanıcıya ve modele gösterilen etiket
her zaman nota değeridir — "1/8 üçleme", "1/16 üçleme" — çıplak `1/12` veya
`1/24` hiçbir yerde yazılmaz, çünkü "1/16"nın yanında düz bir değer gibi
okunur.

**64 bu sürümde kasıtlı olarak yoktur.** Gerekçe ölçümdür, tercih değil:

- 4/4 bar başına 64 slot; 32 bar ve çoklu track'te JSON/token yükü prompt
  bütçesinin taşıyamayacağı büyüklüğe çıkar.
- 138 BPM'de bir slot yaklaşık **27 ms**; bu, pilotun çaldığı sample'ların
  attack'ından kısadır, yani iki komşu slot iki ayrı nota olarak duyulmaz.
- 64'ün gerçekten istendiği olaylar — grace note, flam, sweep gesture —
  yoğun grid adımı değil **phrase/micro-event** düzeyinde modellenmesi gereken
  şeylerdir; slot olarak modellemek yanlış şekildir.

Bu, **açık bir ürün boşluğu olarak kayıtlıdır**; desteklenmiyormuş gibi
davranılmaz, destekleniyormuş gibi de davranılmaz.

**Yazılabilirlik kuralı.** Bir grid, ölçüsünün kendi nota değerini
yazabilmelidir; yani `resolution`, ölçünün paydasına tam bölünmelidir. Bu tek
kural iki hatayı birden kapatır:

- 7/8 @ 1/12 → 10.5 slot, ki bu bir bar değildir;
- 6/8 @ 1/12 → 9 tam slot, ama hiçbiri bir sekizlik değil.

İkisi de **bar şeması** ve `slotCount` tarafından reddedilir; sonuç asla
yarım slot olarak aşağı akmaz.

**Bar başına bağımsız grid.** Her bar kendi resolution'ını taşır ve bir
section'ın bütün barlarını aynı grid'e zorlayan ikinci bir kural **yoktur**.
Grid değişimi section sınırı gerektirmez: dört barlık bir break'in ortasında
tek barlık bir 1/16-triplet turnaround olabilir.

Farklı grid seçmek bir çeşitlilik kutusu değildir. Blueprint'te yüksek
resolution'lı her bar bir **niyet** belirtir (§11.8); niyet yoksa mümkün olan
en düşük grid kullanılır.

- Çekirdekte yalnız `[4,4]` ve `[6,8]` kullanılır (§2.6); `[3,4]` ve `[7,8]`
  şemada vardır, Faz 2.5'te açılır.
- Varsayılan ölçü `[4,4]`, varsayılan resolution `8`.
- Tick aritmetiğinin **tek sahibi** `lib/music/timing.ts`'tir (§8.3): slot
  uzunluğu, bar uzunluğu, vuruş yerleri ve çizim genişliği oradan türer.
  `60 / bpm` veya `resolution / denominator` hesabı başka hiçbir yerde
  tekrarlanmaz.
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
  totalBars: 32,        // Faz 2.5: 64 (§19 K-25)
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
- `totalBars` Faz 2G'de 16'dan **32**'ye çıkarıldı (§19 K-25). Gerekçe ölçüm:
  dört bölümlü, bölüm başına 8 barlık bir parça 16 barlık tavana sığmıyordu ve
  bir dakikalık bir talep ancak bölümleri kırparak karşılanabiliyordu. Sınır
  `barsPerSection = 8` ve `barsPerPatch = 8` ile birlikte hâlâ tek patch'in
  bir section'dan fazlasına dokunamayacağı anlamına gelir.

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
`Distortion` (WaveShaper) · `Gain` / `Channel` · `Destination` · `Meter` ·
`ToneAudioBuffers` · `ToneBufferSource`

**Distortion prototipte mobil saha testinde çalışmıştır ve metal karakteri için
gereklidir.** v1.0 spec'indeki Distortion yasağı kaldırılmıştır.

**`ToneAudioBuffers` ve `ToneBufferSource` §19 K-21 ile eklendi.** Gerekçe:
Expressive Playback (§8.5) nota başına bağımsız pitch automation gerektirir ve
`Sampler` bunu dışarı açmaz. `ToneAudioBuffers` çözülmüş sample'ları **tek**
kez tutar; hem `Sampler` hem nota-sahipli `ToneBufferSource`'lar aynı bank'ten
beslenir, böylece aynı URL ikinci kez indirilmez veya decode edilmez.
`LFO`, `Convolver` ve AudioWorklet zinciri **eklenmedi**: vibrato dahil bütün
modulation, planner'ın ürettiği ayrık automation noktalarıyla yazılır.

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

**Tempo haritası v1 (§19 K-25).** BPM artık tek sayı değildir. Tick'ten
saniyeye çeviren **tek** bir otorite vardır (`lib/audio/tempo.ts`); `60 / bpm`
aritmetiği başka hiçbir yerde tekrarlanmaz — ne scheduler'da, ne expression
planner'ında, ne playhead'de, ne offline render'da. Semantik kasten dardır:

- Bir section'ın temposu `section.bpmOverride ?? song.bpm`'dir ve o section'ın
  **ilk barının ilk tick'inde** yürürlüğe girer. Yalnız section sınırında
  basamak değişimi vardır; ramp, rubato ve bar içi tempo yoktur.
- Hiçbir şey devralınmaz: override'ı olmayan section, kendinden önceki section
  ne yaparsa yapsın şarkının kendi temposunda çalar. Bu, arrange sözleşmesinin
  ihtiyacı olan şeydir — modele bir section gösterildiğinde temposu da, o
  tempoya nasıl gelindiğinin tarihçesi olmadan söylenebilir.
- Tempo değişimi transport'a **otomasyon eğrisi** olarak yazılır
  (`cancelScheduledValues` + segment başına `setValueAtTime`); event'ler
  tick'te kaldığı için ses, playhead, metronom ve loop birlikte hareket eder.
- Tempo sınırını aşan bir nota **iki parçasının toplamı** kadar sürer; süre
  `ticks × secondsPerTick` ile değil, zaman çizgisine iki kez sorularak
  hesaplanır.
- Aynı kural **grid sınırı** için de geçerlidir (§19 K-34): bar sınırını aşan
  bir tie yeni bir onset değildir ve süresi, geçtiği her barın **kendi**
  grid'inde ölçülüp toplanır. Slot sayılarını toplayıp tek bir grid ile
  çarpmak, iki grid farklıysa aralarındaki oran kadar yanlıştır. Ses, gerçek
  bir sus veya track'in yazılı olmadığı bir bar ile biter.
- Practice rate (§13.8) müziğin değil oturumun özelliğidir: bütün haritayı
  ölçekler, Song'a yazılmaz ve section tempolarını **hep birlikte** ölçekler.
- Başlıkta gösterilen tempo, şarkının üst düzey sayısı değil **playhead'in
  bulunduğu section'ın** temposudur; playhead bir sınırı geçtiğinde kendi
  başına güncellenir.

### §8.5 Expressive Playback v1 (§19 K-21)

`NoteEvent.articulation` yalnız görsel metadata değildir: **nota bazında**
duyulan bir davranıştır. Pilot sözlüğü sekiz değerdir — `accent`, `palm_mute`,
`vibrato`, `bend_half`, `bend_full`, `slide`, `hammer_on`, `pull_off` — ve bir
nota aynı anda **yalnız bir** articulation taşır. Kombinasyonlar bu sürümün
kapsamı dışındadır. Faz 0'dan gelen `normal`, `sustain`, `staccato` değerleri
anlamlarını aynen korur; articulation'sız eski Song JSON'ları aynı şekilde
çalar.

**Mantıksal pitch değişmez.** Bend, slide ve vibrato `NoteEvent.pitch`
değerine dokunmaz; modulation yalnız playback katmanında yaşar. Bend miktarı
serbest sayı değildir: `bend_half` = +100 cent, `bend_full` = +200 cent.

**Merkezî presetler.** Bütün başlangıç değerleri tek saf modülde durur;
component, scheduler ve voice sınıflarında sayı tekrarlanmaz.

| Articulation | Değer |
|---|---|
| Vibrato | ±35 cent derinlik, 5.5 Hz, gecikme `min(120 ms, süre × 0.25)`, nota sonuna kadar sinüs |
| Bend half | +100 cent |
| Bend full | +200 cent |
| Bend eğrisi (v2) | settle **35 ms** (≤ sürenin %8'i) · rise süre × %22, **80–280 ms** arası, ease-out · hold kalan orta bölüm, hedef tam korunur · release süre × %12, **60–180 ms** arası, ease-in-out, 0 cent'e döner (§19 K-22) |
| Slide (v2) | hedef onset **varış** anıdır; glide önceki notanın kuyruğunda başlar. İstenen süre `clamp(\|yarım ton\| × 45 ms, 120 ms, 360 ms)`, kaynağın başında en az **20 ms** sabit pitch kalır, kalan süreye sığdırılır; **90 ms**'nin altına düşerse slide çalınmaz. Smoothstep eğri, 8 adım, son nokta tam hedef cent. En fazla **12 yarım ton** (§19 K-23) |
| Hammer-on | geçiş **22 ms**, geçiş sonrası enerji **%88** (§19 K-22) |
| Pull-off | geçiş **28 ms**, enerji **%78**, kısa yardımcı transient: gain 0.16, ≤35 ms, low-pass 4500 Hz (§19 K-22) |
| Legato aralığı | en fazla **5 yarım ton** (§19 K-22) |
| Palm mute | gövde en fazla süre × %45, üst sınır 180 ms, kısa release, kontrollü low-pass |
| Accent | merkezî gain sabiti, limiter öncesi clipping üretmeyen muhafazakâr değer |

Bu sayılar "gerçekçilik kesinleşti" kararı değildir; WAV insan kabulünden sonra
ayarlanabilir.

**Legato zinciri (§19 K-22).** Hammer-on ve pull-off *ayrı bir onset değildir*.
Aynı telde birbirine değen notalar tek bir **zincir** oluşturur: primary source
yalnız ilk notada başlar, zincirin sonuna kadar canlı kalır, her transition'da
o source'un **kendi** pitch parametresi hedef perdeye automate edilir ve hedefte
ikinci tam sustain sample başlatılmaz. `5h7p5` tek primary voice ve iki
transition'dır. Pitch automation **cumulative**'dir: değerler zincirin
başladığı perdeye göre sayılır ve her transition hedefte kararlı biter, vibrato
gibi salınmaz.

Zincir aynı track ve aynı `stringIndex` içinde kalır. Kaynak onset normal
articulation taşısa bile arkasından geçerli bir hammer/pull geliyorsa primary
voice'a yükseltilir. Hedef nota **logical Song/timeline event'i olarak
korunur**; scheduler'ın pitch/onset anlık görüntüsünden silinmez, yalnız audio
rendering'de yeniden vurulmaz. Tie yeni transition değildir; gerçek sus, eksik
track anahtarı ve farklı tel zinciri keser; section sınırı tek başına kesmez.
Chain ID canonical ve deterministic'tir. Zincir kurulamayan her durumda mevcut
`articulationContext` uyarısı ve normal onset'e fallback korunur.

Pull-off'un yardımcı transient'i primary zincirin parçası **değildir** ve
diagnostic'te ayrıca `auxiliaryTransient` olarak sayılır; primary voice'ın
yerine geçmez ve full restrike gibi duyulmamalıdır.

**Slide de aynı zincirdedir (§19 K-23).** Slide için ikinci bir zincir veya
scheduler yoktur; hammer/pull ile aynı `LegatoChain` modelini kullanır. Tek
farkı **zamanıdır**: hammer-on hedefte olur — parmak iner ve pitch orada
değişir — slide ise hedeften **önce** olur. Bu yüzden bir transition iki zaman
taşır: pitch'in hareket etmeye başladığı an (`atSeconds`) ve hedefe vardığı an
(`arrivesAtSeconds`). Slide'da varış anı hedef notanın **notated onset'idir**;
yani yazılan zaman kaymanın başlangıcı değil, hedef perdeye ulaşma anıdır.
Hedefte yeni full sample attack başlamaz ve aynı primary source hedef notanın
süresi boyunca devam eder.

Glide süresi aralığa göre ölçeklenir ve iki notanın arasındaki zamana
sığdırılır: kaynak nota önce **kendisi olarak** duyulmalıdır (en az 20 ms sabit
pitch), kalan süre istenen glide'dan kısaysa glide kısaltılır, kalan süre
**90 ms**'nin altındaysa slide hiç kurulmaz — nota normal çalınır ve
`no_room_to_glide` uyarısı verilir. Practice rate bütün bu süreleri ölçekler,
bu yüzden %50'de aynı pasaj daha uzun, %150'de daha kısa kayar; hangi
pasajların kayabildiği hızla değişmez.

Glide eğrisi tek linear ramp değildir: smoothstep ile başta yumuşak, ortada
belirgin, hedefe yaklaşırken kontrollü bir hareket yazılır. Son automation
noktası **tam** hedef cent değerindedir, bu yüzden overshoot yoktur, varıştan
sonra pitch sabit kalır, başlangıç perdesine dönüş yoktur ve bend release
davranışı slide'a taşınmaz. Yukarı ve aşağı slide simetriktir. Zincir kurulmayan
bir slide **yarım zincir bırakmaz**: kaynak nota transition'ı olmayan bir
zincirin içinde kalamaz.

**Saf Expression Planner.** Audio node'larından bağımsız bir katman her nota
için pitch automation, gain envelope ve gerekiyorsa filter preset üretir.
Planner Song/timeline girdisini mutate etmez, practice rate'i hesaba katar,
tie'ı yeni onset saymaz, bar ve section carry semantiğini korur, explicit ve
Ergonomic v2 pozisyonlarını **aynı** normalize edilmiş timeline'dan okur,
slide/hammer/pull için önceki gerçek onset'i aynı track ve aynı tel bağlamında
arar. Eksik track anahtarı ve gerçek sus bağlantıyı keser; section sınırı tek
başına kesmez. Geçersiz bağlamda exception atılmaz: normal playback planı artı
sabit bir `fallbackReason` üretilir. Diagnostic'e provider veya kullanıcı metni
konmaz.

**Nota/voice izolasyonu — bu bölümün en kritik invariant'ı.** Bir notanın
vibrato/bend/slide modulation'ı aynı anda çalan başka bir notanın pitch'ini
değiştiremez. Paylaşılan track sampler'ında global `detune`, `playbackRate`
veya pitch node'u **değiştirilmez**. Zincir:

    paylaşılan decoded buffer bank
    → nota-sahipli ToneBufferSource
    → nota-sahipli Gain envelope
    → gerekiyorsa nota-sahipli Filter
    → track bus
    → mevcut master graph

Context constructor'dan gelir; `Tone.Transport`, `Tone.Destination` ve
`.toDestination()` gibi global singleton yolları geri getirilmez. `setTimeout`
tabanlı scheduler yaması yoktur. Online ve offline **aynı** planner ve aynı
scheduling yolunu kullanır. Tone.js private alanlarına güvenilmez.

**Yaşam döngüsü.** Pause bütün aktif voice'ları durdurur; seek eski voice'ları
dispose eder; başa dönüş eski automation'ı bırakmaz; section loop sararken
önceki turdan voice sarkmaz; practice rate değişince eski automation iptal
edilip yeni zamanlamayla schedule edilir ve **engine yeniden kurulmaz**;
preview kapanınca bütün preview voice'ları dispose edilir. Aynı voice iki kez
dispose edilirse hata çıkmaz. Aktif/dispose sayıları test diagnostic'iyle
ölçülebilir; normal akışta console log yoktur.

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

Yerleşim motoru barın grid'ini bilmez ve bilmesi gerekmez (§19 K-34): onset'ler
zaman sıralı bir dizi olarak gelir, slot uzunluğu aramaya girmez. Karışık
grid'li bir section'da da aynı arama, aynı maliyet ve aynı sonuç geçerlidir.

**Articulation motoru bilir (§19 K-27).** Slide, hammer-on ve pull-off aynı
telde çalınır (§8.5); yerleşim motoru bunu bilmezse iki notayı ayrı tellere
koyar ve sonra planner "aynı telde değil" diye uyarır. Bu, kimsenin
düzeltemeyeceği bir uyarıdır: kullanıcı perde yazmamıştır, perdeyi motor
seçmiştir. Bu yüzden legato çiftleri arama sırasında **kısıt kenarı** olarak
taşınır; kırılan kenar sayısı lexicographic maliyetin **ikinci** terimidir —
büyük el sıçramasından hemen sonra, fazla kayma ve toplam yolculuktan önce.
Bir kenar hem kaynağı hem hedefi yerleşmiş olduğunda sayılır; yerleşemeyen
notayı iki kez cezalandırmak aramayı sorunu gizlemeye iter. Explicit
`position` bu kısıt yüzünden de **taşınmaz** (madde 3).

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

**Arama teşhisleri iki ayrı büyüklüktür ve karıştırılmaz:**
`maxExpandedStates` pruning **öncesi** üretilen ardıl state sayısıdır (yapılan
işin ölçüsü; üst sınırı `beamWidth × aday sayısı`). `maxRetainedBeamStates`
pruning **sonrası** taşınan gerçek beam'dir ve her zaman
`<= placementLimits.beamWidth`'tir.

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
- **`articulationContext`** — articulation'ın bağlamı tutmuyor (§8.5, K-21).
  Saf ve UI'dan bağımsızdır, **error üretmez**. Kurallar: `accent` her pitched
  melodik notada geçerlidir; `palm_mute`, `vibrato`, `bend_half` ve `bend_full`
  Core Lite fretted melodik track'te geçerlidir; `slide` için önceki gerçek
  onset **aynı telde** bulunmalıdır, aralık **12 yarım tonu geçmemeli** ve iki
  onset arasında %100 hız eşdeğerinde en az **90 ms** kayma süresi kalmalıdır
  (§8.5, K-23); `hammer_on` için önceki gerçek onset aynı
  telde ve **daha düşük** pitch'te, `pull_off` için aynı telde ve **daha
  yüksek** pitch'te olmalıdır. Uyarı ile playback'in fallback'i **aynı saf
  yardımcıdan** (`legatoDecision`) okunur; ikisi farklı karar veremez. Önceki olay tie'ın arkasında bulunabiliyorsa Faz
  0 carry semantiği kullanılır; arada gerçek sus varsa bağlantı yoktur; eksik
  track anahtarı bağlantıyı keser; section sınırı tek başına kesmez. Davulda
  melodik articulation uygulanmaz. Fretboard'suz Faz 2.5 enstrümanlarında
  davranış uydurulmaz, deferred olarak bırakılır. Geçersiz bağlamda uyarı
  üretilir ve playback normal onset'e düşer. Aynı kök sorun için tekrar tekrar
  issue üretilmez. Issue path deterministic'tir: track → section → bar → slot →
  mümkünse nota/tel.

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
- **Çıktı şeması adapter sınırının parçasıdır (§19 K-24).** `AdapterRequest`
  zorunlu bir `responseSchema` taşır; sağlayıcıya structured output kısıtı
  şemasız gidemez. Şema Zod sözleşmesinden **türetilir**
  (`z.toJSONSchema(modelPatchSchema)`), elle ikinci bir kopya olarak yazılmaz —
  aksi hâlde iki şema zamanla ayrışır ve reddedilen bir yanıt "modelin hatası"
  gibi görünür. Tip, sağlayıcı paketine bağlı değildir: yapısal bir
  `JsonSchema` tipi kullanılır. Şema sabit blokta taşındığı için token
  tahminine de **dahildir**.
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

### §11.5 Token ekonomisi ve parçanın bütünü (§19 K-32)

- **Modele ham Song JSON gönderilmez.**
- Bir tur, parçanın **şeklini** görür; parçanın kendisini değil. Gönderilen
  bağlam üç parçadır ve hepsi özettir:
  1. **Form anahatı** — playing order'da her section: id, ad, bar sayısı,
     kendi temposu ve hangisinin hedef olduğu. İçerik yok.
  2. **Bağlanma noktaları** — önceki section'ın nereye bıraktığı (tek bar,
     o bölümdeki en baskın gitar), hedef track'in **kendi** en son çaldığı bar
     (aradaki sessiz bölümler atlanarak) ve varsa bir sonraki section'ın
     hedef track'teki ilk barı.
  3. **Rol filtreli kaynaklar** — aynı section'daki diğer track'lerin, bu
     rolün işine yarayan okumaları.
- Minimizasyon kuralı değişmedi, uygulanışı roldedir. `drums` **hiçbir zaman**
  perde görmez, yalnız onset/aksan/sus ritmi; `rhythm_guitar` davul grooveunu
  görür, lead'in ayrıntısını değil; `lead_guitar` üzerine çaldığı backing'i
  perdeleriyle görür; `acoustic_guitar` varsa diğer gitarların perdelerini;
  `harmony` desteklediği tek gitarı; `bass` bir gitar + davul grooveunu.
- Gerekçe ölçümdür, tercih değil: K-18'in tek-section penceresinde S-01'de
  "önceki bölümün motifini geliştir" denen bir tur, gördüğü tek track'in her
  barında `-sus-` okuyordu. Görev zor değil, **cevaplanamazdı**; motif ancak
  kullanıcı talimatına düzyazı olarak elle yazılarak taşınabiliyordu. O
  workaround bu bağlamın yokluğunun belirtisiydi. **Modelin görmediği bir
  motifi instruction alanına elle yazmak açık kapatmak değildir.**
- Bütün form artık cevabı etkilediği için **fingerprint'e dahildir** (§12.3):
  başka bir section'da yapılan değişiklik farklı bir sorudur ve aynı
  idempotency anahtarıyla eski cevabı tekrarlayamaz.
- Kompakt taşıma formatı örneği:
- Kompakt taşıma formatı örneği:

  ```txt
  gtr: E2 E2 . G2 - - A2 G2
  drm: K+H H S+H H K+H H S+H H
  ```

  Canonical model ayrıntılı kalır; **AI taşıma formatı kompakttır.**
- Genişleme ölçülmüştür ve tavanın altındadır: en kötü durumda tahmini girdi
  **3424 / 8000** token (çıktı şeması dahil, §11.3).
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

**Ritmik söz dağarcığı raporu (§19 K-34).** Bir parçanın grid'lerle ne yaptığı
ölçülür ve **puanlanmaz**: kullanılan grid dağılımı, triplet bar sayısı, ince
grid'e konmuş ama daha kaba bir grid'in de taşıyacağı bar sayısı, gerçek
onset'ler arasındaki en kısa aralık, hızlı yazımın burst mı yoksa kesintisiz
akış mı olduğu ve duyulur gam yürüyüşü adayları.

Kural açıkça bir **karşılaştırma ölçüsüdür**, müzikal hakikat değildir:
"en az 4 ardışık pitched onset, çoğunluğu aynı yönde, adımların çoğu 1–2
yarım ton, arada uzun sus yok, tie yeni onset sayılmaz". Bir parçanın bir
gamın notalarını kullanması ile o parçada duyulur bir run olması aynı şey
değildir; bu kural ikisini her seferinde aynı şekilde ayırt etmek içindir.

**Daha yüksek resolution için skor üretilmez.** 1/8'de iyi bir riff, 1/32'de
riff olmayan bir şeyi yener; tek bir sayı bununla çelişiyormuş gibi okunurdu.

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

### §11.8 Composition blueprint (§19 K-31)

Bir kullanıcı "bir dakikalık, sert bir break, bridge ve sololu bir şey" dediği
zaman ortada henüz düzenlenecek bir Song yoktur. Boş Song'u **kim** kurar
sorusunun bu sürümdeki cevabı: modelden bir **plan** istenir, Song'u o plandan
**deterministic bir materializer** kurar.

- `CompositionBlueprint` strict bir sözleşmedir: hedef süre ve tolerans, tonal
  merkez, akort niyeti, çözünürlük, **özellik tabanlı** referans nitelikleri,
  track rolleri, motifler, section'lar, istenen teknikler ve **karşılanmayan
  istekler**.
- **Model kalıcı ID üretmez.** Blueprint yalnız `internalKey` taşır
  (`^[a-z][a-z0-9_-]*$`) ve Song'daki `sectionId` / `trackId` değerlerini
  materializer üretir (`sec-1`, `rhythm-1`, …). Modelin ürettiği bir ID kalıcı
  olsaydı fingerprint, idempotency ve kilitli yüzey karşılaştırmaları modelin
  o an ne yazdığına bağlı olurdu.
- **Sanatçı adı blueprint'e girmez.** Kullanıcının kendi cümlesi ham istek
  artefaktında aynen durur; blueprint onu doku tarifine çevirir ("low
  register'da senkoplu stop-start groove", "tonik pedal üzerine kromatik
  gerilim"). Bu, §11.7'nin kart kuralının aynısıdır.
- Materializer saftır: aynı blueprint her zaman aynı iskeleti verir. Süre
  kontrolü tempo haritası üzerinden yapılır (§8.3), bar sayısı ile değil.
- **Grid planı üç yerde, gittikçe daralarak belirtilir (§19 K-34):** parçanın
  varsayılan `resolution`'ı, section'ın kendi `resolution`'ı (isteğe bağlı) ve
  bir barın `gridAccents` girdisi. Yalnız sonuncusu gerekçe ister ve gerekçe
  kapalı bir sözlükten gelir: `scalar_run`, `legato_burst`, `arpeggio`,
  `triplet_groove`, `drum_fill`, `tremolo_burst`, `ornamented_transition`.
  Niyet yoksa mümkün olan en düşük grid kullanılır.
- Bar şeklini ve slot sayısını bu plandan **materializer** kurar; model slot
  dizisi yazmaz. Plan olmayan bir plan — section'ın sonunu aşan accent, bir
  bara iki grid, accent ettiği grid'den ince olmayan accent, ölçünün
  taşıyamayacağı grid — iskelet oluşmadan **önce** reddedilir.
- Bütün barları en ince grid'e çıkarmak yasak değildir; `gridUsage`
  raporunda görünür (§11.6). **Daha ince grid = daha iyi müzik değildir** ve
  hiçbir rapor bunu puan olarak sunmaz.
- **Public `/api/copilot` rotasında tam parça bestelemek yoktur.** Rota
  yalnız `arrange_track` kabul eder (§11.1, K-18); blueprint yolu bu sürümde
  eval/rehearsal yoludur. Bir istekle bir bütün parça üretmek maliyet, kota ve
  kilitli yüzey açısından ayrı bir üründür ve o kapıdan geçmeden açılmaz.

### §11.9 Track rolleri (§19 K-30)

Beceri listesi enstrüman başına değil **iş** başına tanımlanır:
`rhythm_guitar`, `lead_guitar`, `acoustic_guitar`, `harmony`, `bass`, `drums`.

Gerekçe: K-18'in listesinde tek bir `harmony` rolü vardı ve S-01'de aynı
prompt kartı hem açılış riff'ini, hem soloyu, hem de yalnız akustik codayı
yazmak zorunda kaldı — kart "ana gitarı örtme, ana motifi yeniden yazma"
dediği için üçünde de geri çekilen bir parti üretti. Roller ayrıldıktan sonra
her kart tek bir iş tarif eder. `rhythm_guitar` ve `acoustic_guitar` aynı
enstrüman ailesini hedefler ama farklı **enstrümanları**: registry
amplifiye olmayan gitarı ayırt eder, böylece bir akustik rolü elektro gitara,
bir ritim rolü akustiğe yöneltilemez — sağlayıcı çağrısından **önce**.

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

### §13.8 Çalışma hızı ve akor grubu taşıma (§19 K-20)

**Çalışma hızı (practice rate).** Şarkının `bpm` değeri eserin canonical
temposudur ve bu kontrol onu **değiştirmez**. Çalınan tempo:

    effectiveBpm = song.bpm * practiceRate

- Sınırlar `limits.ts`'teki `practiceRateLimits`'ten gelir: **%50–%150**, adım
  **%5**, varsayılan **%100**. Sayılar component içine yazılmaz.
- Practice rate Song Contract'a yazılmaz, song fingerprint'ini değiştirmez,
  Copilot request/prompt/idempotency fingerprint'ine girmez, patch veya
  validator sonucunu etkilemez.
- Tercih Song'dan **ayrı** bir ayar anahtarında (`aranje.settings`) strict
  şemayla saklanır. Bozuk ayar sessizce %100'e döner ve **Song karantina
  sistemini tetiklemez**; bunlar ayrı depolama sorumluluklarıdır.
- Tek transport, tek scheduler. Hız değişimi engine'i yeniden kurmaz,
  sample'ları yeniden yüklemez ve hiçbir event'i yeniden schedule etmez:
  playback, metronom, section loop, seek, playhead ve bar highlight tick
  cinsinden yazıldığı için tempo ile birlikte hareket eder.
- Preview playback ile mevcut playback aynı hesabı ve aynı ayarı kullanır.
- UI şarkının gerçek BPM'si, oran ve efektif BPM'i birlikte gösterir
  (`132 BPM · %75 → 99 BPM`), %100'e dönüş kontrolü bulunur ve dokunma
  hedefleri 44 px'tir. Ondalıklı efektif BPM hesapta korunur, ekranda en fazla
  bir ondalık gösterilir.

**Onset block.** Zaman ekseninde taşımanın birimi nota değil **onset**'tir:
bir `MelodicSlot` onset'i, içindeki bütün akor notaları ve onu sürdüren
kesintisiz tie zinciri. Akorun tek teli zaman ekseninde bağımsız taşınmaz —
tek tel düzenlemesi FretSheet'in sorumluluğudur. Taşıma pitch, nota sırası,
explicit position, velocity, articulation ve tie süresini **değiştirmez**;
yalnız zaman konumunu değiştirir.

**`move_onset_group`.** Saf komut: `{ sectionId, trackId, origins, movement }`.
`movement` ∈ `previous_slot | next_slot | previous_bar | next_bar`. Slot
hareketi section içindeki bar'ları flatten ederek bir slot kaydırır ve bar
sınırını geçebilir. Bar hareketi **slot indeksini değil anı** korur (§19
K-34): kaynağın kendi barı içindeki tick ofseti okunur ve hedef barda tam o
ofset aranır. Slot 8, 1/16 barda üçüncü vuruş, 1/32 barda ikinci vuruştur;
indeksi korumak, iki barın grid'i farklıysa müziği sessizce başka bir vuruşa
taşımak demektir.

Bloğun uzunluğu da **tick** olarak ölçülür. Blok, hedef grid'de aynı süreyi
kaplayacak şekilde yeniden notalanır: bir 1/16 slot iki 1/32 slot olur, dört
1/32 slot bir 1/8 slot olur, ses aynı kalır. Hedef grid o anı ya da o süreyi
yazamıyorsa işlem **`target_grid_incompatible`** ile reddedilir; **en yakın
slota yuvarlanmaz.** Yuvarlama, kullanıcının notasını istemediği bir yere
taşır ve bunu fark etmesi için hiçbir iz bırakmaz.

Bar'lar kendi `timeSignature`/`resolution` değerleriyle sayılır; 4/4 veya 8
slot varsayımı yoktur.

İşlem **atomiktir** ve şu sırayla yürür: kaynak alanları belirlenir → kaynaklar
geçici olarak boş kabul edilir → bütün hedefler hesaplanır → hepsi doğrulanır →
ancak hepsi geçerliyse yeni Song kurulur → şema ve validator zinciri çalışır →
tek storage commit yapılır. Seçili blokların birbirlerinin boşalttığı alana
kayması geçerlidir. Dolu hedef, seçime ait olmayan tie, section dışı, uyumsuz
slot yapısı, track'in yazılı olmadığı bar, **hedef grid'in yazamadığı an veya
süre** ve iki bloğun aynı hedefe düşmesi işlemi **tümüyle** reddeder; kısmi
taşıma ve üzerine yazma yoktur. Yetim tie
ne bırakılır ne oluşturulur. Hata kullanıcıya engelleyen bar/slot'u söyler.
Warning engellemez, error engeller. Bütün grup taşıma **tek** undo adımıdır.

**Çoklu seçim.** Yalnız aktif fretted melodic track'te ve tek section içinde
çalışır. Uzun basmak seçimi açar; akorun hangi teline basıldığı önemsizdir.
Sonraki onset'lere dokunmak seçime ekler/çıkarır. Sus veya tie slot'una tek
başına dokunmak yeni onset seçmez; seçili bir onset'in tie kuyruğu görsel
olarak seçimin parçası gösterilir. Track, section veya edit modu değişince ve
preview açılınca seçim temizlenir. Taşımadan önce playback durdurulur. Seçili
durum yalnız renkle değil outline ve erişilebilir metinle de anlatılır. Bu
sürümde serbest drag-and-drop **yoktur**: tab'ın yatay scroll hareketiyle
çakışma riski fiziksel cihaz görülmeden alınmaz.

### §13.9 Articulation düzenleme ve tab işaretleri (§19 K-21)

**Riff editörü.** FretSheet seçili notaya articulation seçimi ekler. Kullanıcı
adları teknik ID değildir: *Normal · Vurgu · Palm mute · Vibrato · Yarım bend ·
Tam bend · Slide · Hammer-on · Pull-off*. Articulation bütün akora değil,
**seçilen teldeki** `NoteEvent`'e uygulanır; "Normal" alanı kaldırır. Seçimin
ürettiği bağlam uyarısı sheet içinde görünür ve **kaydetmeyi engellemez**.
Davul ve fretboard'suz track'te kontrol gösterilmez. Dokunma hedefleri 44 px,
320 px'de sheet dışına taşma yok. Articulation seçimi pitch veya fret'i
değiştirmez; tek undo geri alır; grup taşıma articulation'ı aynen korur.

**Tab işaretleri.** `accent` `>` · `palm_mute` `PM` · `vibrato` `~` ·
`bend_half` `b½` · `bend_full` `b1` · `slide` yönüne göre `/` veya `\` ·
`hammer_on` `h` · `pull_off` `p`. Slide'ın yönü **gerçek pitch'ten** türetilir
(hedef pitch daha yüksekse `/`, daha düşükse `\`); görsel tel yönünden veya
`stringIndex`'ten değil (§19 K-23) — tab thickest-string-first çizildiği için
bu ikisi ters yöne bakabilir ve işaret duyulanla aynı şeyi söylemelidir.
Bağlamı tutmayan bir slide yine yazılı işaretini gösterir, erişilebilir uyarı
ayrıca durur. İşaret fret numarasını kapatmaz, tie
çizgisiyle karışmaz, akorda doğru telin satırına düşer, yalnız renge dayanmaz
ve screen reader tam articulation adını söyler. Mobil tab yüksekliği artmaz;
gutter maskesi ve yatay scroll bozulmaz.

### §13.12 Ölçü işlemleri — track ve full kapsam (§19 K-43)

**İki kapsam, ve asla birbiri yerine geçmez.** `track` bir enstrümanın ölçü
içeriğidir; `full` bütün track'lerle birlikte **bölümün şeklidir**. Aynı yedi
fiil iki kapsamda iki farklı şey yapar, bu yüzden action bar özet satırında
kapsamı **söyler**: "Ritim Gitar · 2 ölçü" ile "Tüm enstrümanlar · 2 ölçü"
tahmin edilecek kadar yakın değildir.

**Seçim.** Arrangement'ta bir hücreye uzun basmak o track'in ölçüsünü, bar
numarasına uzun basmak bütün kolonu seçer; Tab'da bar başlığına uzun basmak
**aktif track'in** ölçüsünü seçer — tab tek track çizer, ve tek track üzerinde
yapılan bir hareket görünmeyen yedisine uzanamaz. Sol/sağ handle aralığı **tam
ölçü** adımlarıyla değiştirir; bar seçiminin başka adımı yoktur. Seçim tek
bölümdedir, oturumluktur ve Song'a, fingerprint'e, Copilot isteğine yazılmaz.
Bir parmak iki seçim modelini birden uyandıramaz: bar seçimi zaman seçimini
bırakır, zaman seçimi bar seçimini.

**Zincir.** Seçim bir tie/slide/hammer-on/pull-off'u ortadan bölemez.
Deterministik olarak tam ölçülere genişler ve okuyucuya söylenir: *"Bağlantılı
notalar nedeniyle seçim 2 ölçüye genişletildi."* `full` kapsamda herhangi bir
track'in bağı yeter. Bölüm sınırını aşan zincir **kapalı biter**: *"Bu ölçü
sonraki bölüme bağlı. Bölüm sınırını aşan ölçü taşıma henüz desteklenmiyor."*
— ve pano, store, undo değişmez. Gerçek sus zinciri keser; track anahtarı
olmayan bar da keser, çünkü eksik anahtar sessizliktir (§5.5).

**Track kapsamı.** Kes ve sil **içeriği boşaltır, barı asla kaldırmaz**.
Yapıştırma yalnız kopyalandığı `trackId`'ye gider. Hedef kendi ölçü işaretini
ve grid'ini korur; içerik hedefin grid'inde **birebir** ifade edilemiyorsa
reddedilir, asla yuvarlanmaz. Dolu bir hedef açık "Yerine koy" ister. Taşıma
bar dizisini değil içeriği kaydırır. Tekrar, bölümü büyütmeden `count` veya
`fill_to_section_end` ile çalışır.

**Full kapsamı.** Sil bar nesnesini çıkarır ve arkasını sola kaydırır; bir
bölüm **asla sıfır ölçüye inemez**. İçerik yapıştırma hedefin ölçü işaretini,
grid'ini ve bölüm BPM'ini korur. `insert_copied_bars` kaynağın yapısını taşır.
Tekrar yalnız `count` alır — ölçü ekleyen bir işlemde "bölüm sonuna kadar"
ölçülecek sonun kendisi kaydığı için belirsizdir. Taşıma bar nesnelerini
yeniden sıralar; üstüne yazmaz ve bölüm sınırını aşmaz. Boş ölçü komşusunun
ölçü işaretini ve grid'ini alır, **hiçbir track anahtarı taşımaz**, temposu
bölümündür ve uydurulmuş `bpmOverride` almaz.

**Ghost ve yazma.** Kopyalama dışında her işlem önce **çizilir**: önizleme,
gerçek şarkı üzerinde gerçek komutu çalıştırır ve sonucu yarı saydam,
dokunulamaz bir arrangement olarak gösterir — store'a, localStorage'a, undo'ya
ve playback planına hiçbir şey yazmadan. "Uygula" **tek** storage yazımı,
**tek** history girişi, **tek** Song commit'idir. Vazgeç ve reddediş sıfır
yazımdır; pano değişmez.

**Playback.** Yapısal full-bar işlemi önce playback'i durdurur; önizleme
durdurmaz. Yazımdan sonra mevcut Song-değişikliği yolu kullanılır — ikinci bir
scheduler yoktur, loop sınırları yeni plandan türetilir, playhead **hâlâ var
olan en yakın bara** taşınır ve bekleyen bir seek yanlış bara inemez.

**Kapsam dışı (bu sürümde).** Bölümler arası ölçü seçimi · track'ler arası
içerik yapıştırma · linked pattern · yaklaşık motif · bölüm çoğaltma/taşıma ·
tempo ramp · scale-aware transpose · 64 grid · export.

### §13.13 Çok adımlı undo/redo ve birleşik düzenleme geçmişi (§19 K-44)

**Tek geçmiş.** Şarkıyı değiştirebilen her yol tek `commit` kapısından geçer:
riff düzenleme, nota grubu taşıma, seçim transform'u, ölçü işlemi, uygulanan
Copilot önerisi. Component seviyesinde ikinci bir undo state'i yoktur; Tab ve
Düzen **aynı** geçmişi kullanır, görünüm değiştirmek ve track/section
değiştirmek geçmişi sıfırlamaz.

**Model.** Tek `snapshots` dizisi ve bir `cursor`. Her snapshot, kendisini
üreten `actionFromPrevious`'ı taşır — bu yüzden "undo neyi geri alır?" mevcut
snapshot'ın kendi eylemi, "redo ne yapar?" bir sonrakinin eylemidir. Sınır
`historyLimits.maxUndoSteps = 50`; baseline hariç en fazla 51 snapshot tutulur
ve taşarsa en eskisi atılıp cursor buna göre kaydırılır.

**Commit.** Başarılı bir commit: cursor'dan sonraki redo dalını siler, tek
snapshot ekler, localStorage'a **tam bir kez** yazar, abonelere **tam bir kez**
yayınlar. Başarısız işlem geçmişi, cursor'ı, storage'ı ve redo dalını hiç
değiştirmez. **İki reddediş sebebi vardır:** şemadan geçmeyen aday, ve mevcut
şarkıyla **aynı müzik** olan aday. İkincisi yapısal karşılaştırmadır — anahtar
sırası değişmiş ama içeriği aynı bir şarkı adım üretmez. Warning işlemi
engellemez; başarılı aday normal bir adımdır.

**Coalescing.** Zamana bağlı otomatik birleştirme yoktur; timer'a bakan bir
kural deterministik değildir. Staged davranış korunur: ghost preview,
kopyalama, sheet içi geçici ayarlar ve Copilot preview adım üretmez; beş nudge
+ tek "Uygula" tek adımdır; kes/yapıştır/sil/taşı ayrı adımlardır.

**Undo/redo.** Cursor tam bir adım hareket eder, şarkı byte-eşdeğer döner,
localStorage tam bir kez yazılır ve **yeni entry oluşmaz**. Yapacak bir şey
yoksa işlem no-op'tur ve hiçbir şey yazılmaz. Her ikisi de aktif seçimi,
ghost'u, açık işlem preview'sini ve Copilot preview'sini (ses dahil) temizler;
**pano korunur**. Ana playback çalıyorsa önce durur ve **kendiliğinden devam
etmez**; ikinci AudioContext veya ikinci scheduler kurulmaz.

**Branch.** A→B→C→D, iki undo, sonra E → A→B→E. Eski C→D dalı tamamen silinir.

**Baseline.** İlk hydration, örnek şarkının ilk yüklenmesi, bozuk Song sonrası
fallback ve baseline değişimi **adım değildir**; geçmişi tek snapshot'a
sıfırlarlar. Bozuk localStorage karantina davranışı değişmedi.

**Metinler.** Tek merkezî Türkçe tablo. «Geri al: Ölçüleri silme» ·
«Yinele: Ölçüleri silme». Ham enum, command ID ve provider diagnostic'i bu
metinlere girmez. `track` ve `full` ölçü komutları farklı okunur, çünkü farklı
şeyler yaparlar.

**UI.** Undo ve redo **iki ayrı 44×44 kontroldür**; pasif olan görünür kalır ve
disabled olur. 320px'de ikinci yatay scroller yoktur. Klavye: `Ctrl/Cmd+Z`,
`Ctrl/Cmd+Shift+Z`, `Ctrl+Y`; `input`/`textarea`/`contenteditable` içinde
tetiklenmez ve yapılabilir bir hareket yoksa browser event'i yutulmaz. Geçmiş
listesi/sheet'i bu sürümde yoktur.

**Playback güvenliği.** Yapısal ekleme/silme/yeniden sıralama ve bunların
undo/redo'su sonrasında: playhead geçersiz bar/tick üzerinde kalamaz, bekleyen
seek silinmiş bara işaret edemez, bölüm duruyorsa local bar index yeni son bara
clamp edilir, bölüm yoksa şarkı başına dönülür. **Loop:** bölüm hâlâ varsa loop
korunur ve sınırları yeni plandan yeniden türetilir; bölüm yoksa loop
**kapatılır** — sessizce başka müziğe taşınmaz.

**Sınır.** Component'ler geçmiş dizisine dokunamaz: `.tsx` içinde `snapshots`,
cursor aritmetiği, `recordEdit`, `localStorage` ve ikinci bir `useState` yığını
testle yasaktır. Saf command çekirdekleri değişmedi; geçmiş onların yerine
geçmez, yalnız başarılı sonuçların commit katmanıdır.

**Kapsam dışı (bu sürümde).** Autosave recovery · proje dosyası · export · yeni
şarkı akışı · provider · Copilot kalitesi · KV · fiyatlandırma · geçmiş listesi.

### §13.14 Dayanıklı kayıt ve çökme kurtarma (§19 K-45)

**Yeni bir anahtar yoktur.** `aranje.song` iki formatı okur: eski ham Song ve
yeni V1 zarf. Zarf `{format, version, revision, current, previous}` taşır; dış
nesne strict, `current` ve `previous` **ayrı ayrı** doğrulanır. Song
Contract'a yeni alan eklenmedi; recovery metadata fingerprint'e ve Copilot
isteğine girmez.

**Neden tek zarf.** Her normal commit hâlâ **tam 1** `setItem`'dır. İki slot +
pointer, normal bir düzenlemeyi iki-üç fiziksel yazıma çıkarır; yazmanın yarım
kalabildiği an, bu checkpoint'in kaldırdığı andır.

**Yükleme karar sırası** (saf, `decideLoad`):

| # | Durum | Sonuç |
| --- | --- | --- |
| 1 | Anahtar yok | Örnek şarkı, normal başlangıç |
| 2 | JSON parse edilemiyor | Karantina + örnek şarkı |
| 3 | Geçerli legacy Song | Normal yüklenir, **açılışta yazma yok** |
| 4 | Zarf etiketi + bilinmeyen version | **Dokunulmaz**, düzenleme kilitli |
| 5 | V1 zarf, `current` geçerli | `current` yüklenir |
| 6 | `current` geçersiz, `previous` geçerli | `previous` kurtarılır, anahtar tamir edilir |
| 7 | İkisi de geçersiz | Karantina + örnek şarkı |

**Legacy migration.** Açılışta hiçbir şey yazılmaz. İlk gerçek commit zarfa
geçirir ve eski şarkıyı `previous`'a koyar. Migration history adımı değildir ve
kullanıcıya mesaj gösterilmez.

**Kurtarma.** `previous` ile açılan oturum tek baseline snapshot ile başlar;
bozuk ham değer `aranje.corrupt.<timestamp>` altında korunur (çakışırsa
deterministik `.1`, `.2` soneki) ve ana anahtar sağlam bir zarfla tamir edilir.
Tamir yazımı da reddedilirse bu **başarı gibi raporlanmaz**: şarkı açılır ama
oturum "kaydedilemiyor" durumundadır.

**Gelecek sürüm.** Corrupt sayılmaz. Silinmez, karantinaya alınmaz, üzerine
yazılmaz. Örnek şarkı yalnız bakılacak bir yüzeydir; kalıcı düzenleme
kontrolleri disabled olur.

**Commit atomikliği.** Sıra: strict şema → no-op kontrolü → yeni history hazır
(mutate edilmeden) → zarf serialize → **tam 1** `setItem` → **yalnız yazma
başarılıysa** current Song değişir, cursor ilerler, redo dalı silinir ve
publish edilir. `setItem` başarısızsa hiçbiri değişmez.

**Depo yokken düzenleme yoktur (2K-B.1).** Bellekte-düzenleme modu kaldırıldı:
kaydedilmiş görünen ve sekmeyle birlikte ölen bir saatlik emek, zarfın önlemeye
çalıştığı kaybın ta kendisidir — uygulamanın kendi eliyle. `localStorage` yoksa,
erişim exception veriyorsa veya **açılıştaki yazma kabiliyeti probe'u**
(`aranje.probe` anahtarına 1 `setItem` + 1 `removeItem`) başarısızsa:
`canPersist: false`. Şarkı görüntülenir, playback ve navigation çalışır,
kopyalama gibi mutasyonsuz işlemler çalışabilir; **bütün kalıcı mutasyonlar**
(nota düzenleme, selection/bar transform, undo/redo, Copilot apply) disabled
olur ve selection jestleri hiç armed edilmez. Non-dismissible mesaj: «Cihazda
kayıt açılamadı. Çalışmanı kaybetmemek için düzenleme kapatıldı; şarkıyı
dinlemeye devam edebilirsin.» "Kaydetmeden devam et" seçeneği bilinçli olarak
yoktur; retry altyapısı da yoktur — depo sonradan açılırsa sayfayı yenilemek
yeter. `canPersist` tek store durumundan gelir; component kendi probe'unu
yapmaz.

**Undo/redo.** Her biri diske yeni bir current yazar (tam 1 `setItem`),
`previous` işlemden hemen önce diskte olandır, `revision` monoton artar.
Kullanılamayan undo/redo hiç yazmaz. Geçmiş oturumluk kalır; zarfa snapshot
veya cursor yazılmaz.

**Fiziksel işlem matrisi (2K-B.1).** Sayaç uygulama kodundan **önce** kurulur
ve her `setItem`/`removeItem`'ı anahtar, sıra ve başarı durumuyla ayrı sayar.
Her açılış yolu kabiliyet probe'unu öder (`aranje.probe`: 1 set + 1 remove) —
probe defterden gizlenmez, çünkü uygulamanın kendi ayak izini "0 yazma" altına
saklamak, bu checkpoint'in düzelttiği raporlama hatasının ta kendisidir. Şarkı
ve karantina anahtarlarında: anahtar yok / geçerli legacy / geçerli V1 /
gelecek sürüm → **0 set, 0 remove**; malformed JSON ve iki slot bozuk →
**1 set (karantina), 1 remove (ana anahtar)**, bu sırayla; current bozuk +
previous sağlam → **2 set (karantina + repair), 0 remove**, karantina önce.
**Kurtarma sırası kayıpsızdır:** ham değer kopyalanmadan ana anahtar silinmez
ve üzerine yazılmaz; karantina başarısızsa ana değer byte-eş kalır ve
`canPersist: false`; repair başarısızsa eski zarf yerinde kalır, kurtarma
başarı gibi raporlanmaz ve `canPersist: false`. `saveSong` ayrıca korunmamış
corrupt bir değerin üzerine yazmayı kendi içinde de reddeder.

**Boyut.** En ağır desteklenen şarkı (8 track × 32 bar × 1/32, her slot dolu),
iki birimle: ham **798.516 B (UTF-8) / 798.504 code-unit / ≈1.597.008 B
UTF-16**; zarf current-only **798.592 B / 798.580 cu**; current+previous
**1.597.104 B (UTF-8) / 1.597.080 cu / ≈3.194.160 B UTF-16** (≈1,52 MiB
UTF-8, 2,00×). Production Chromium 141'de gerçek `setItem` denemesi: **başarılı
ve round-trip byte-eş** (`eval/storage/QUOTA.json`). Bu bir kota garantisi ve
fiziksel iOS Safari kabulü değildir; o açık kalır. Gerçek `setItem` her
hâlükârda fail-closed yakalanır.

**Recovery UI.** Kompakt, dismiss edilebilir tek şerit ve dört durum. Banner
bir *durum* alır, cümle değil — cümleler tek tabloda. Transport, Tab ve Düzen
kullanılabilir kalır; yalnız `unsupported_version` düzenlemeyi kilitler ve o
durumda banner kapatılamaz, çünkü altındaki disabled kontrollerin açıklaması
odur. Dismiss yalnız banner'ı kapatır: şarkıya ve depoya dokunmaz. "Autosave",
"JSON", "schema", "Zod", "localStorage" gibi kelimeler kullanıcıya gösterilmez.

**Oturum.** Timer/interval/debounce autosave yoktur.
`beforeunload`/`visibilitychange`/`pagehide` dinleyicisi **hiç kaydedilmez** —
her düzenleme zaten olduğu anda yazılıyor, ve kapanırken çalışan ikinci bir
yazma yolu, yanlış olduğunu keşfetmek için mümkün olan en kötü andır. Geçmiş ve
pano sayfa yenilenince sıfırlanır; practice ayarı kendi anahtarında kalır.

**Kapsam dışı (bu sürümde).** Periyodik autosave · draft/ghost kaydı · geçmiş
kalıcılığı · proje kütüphanesi · cloud sync · destructive "veriyi sıfırla" UI.

### §13.15 Taşınabilir proje yedeği ve güvenli açma (§19 K-46)

**Dosya sözleşmesi.** Tek strict, versioned, provider'dan bağımsız dosya:
`{format: "aranje.project", version: 1, song}` — `song` mevcut `songSchema`'dan
gelir, ikinci bir Song Contract yazılmaz. Uzantı `.aranje.json`, MIME
`application/json`. Dosyada **yalnız müzik** vardır: storage zarfı
(`current/previous/revision`), recovery state, undo/redo history, clipboard,
seçim, ghost, açık sheet, practice rate, ayarlar, Copilot fingerprint/metering,
örnek binary'leri, API anahtarı ve cihaz bilgisi dosyaya giremez.

**Deterministik export.** Kanonik serileştirme: her seviyede sıralı anahtarlar,
compact JSON, tek satır sonu. Aynı şarkı beş kez byte-eş dosya üretir; yapısal
olarak eşit iki şarkı, bellekteki anahtar sırası farklı olsa da aynı byte'ları
üretir. Export öncesi strict Song şeması ve merkezi validator zinciri çalışır:
error reddeder, warning engellemez. Export şarkıyı değiştirmez, depoya yazmaz,
history adımı oluşturmaz, playback'i durdurmaz, ağa çıkmaz — ve
**`canPersist: false` iken de çalışır**: cihazına kayıt açamayan kullanıcı,
ekranda gördüğü şarkıyı dosya olarak kurtarabilir. İndirme kullanıcı jesti
içinde `Blob` + Object URL ile yapılır ve URL güvenli biçimde revoke edilir.

**Güvenli dosya adı.** Tek saf yardımcı: `/ \ ? % * : | " < >` ve kontrol
karakterleri temizlenir, boşluk dizileri tek tireye iner, baştaki/sondaki
nokta-boşluk kırpılır, Unicode korunur, uzunluk `projectFileLimits`'teki
merkezî sabitle sınırlanır, boş kalan başlık `aranje-proje`ye düşer.
Component içinde regex veya ad mantığı yoktur.

**Import karar sırası** (saf, `parseProjectText` + boyut kapısı):

1. Byte sınırı — `projectFileLimits.maxImportBytes = 2 * 1024 * 1024`,
   **içerik okunmadan** (ölçülen en ağır ham Song ≈799 KB; 2 MiB iki kattan
   fazla pay bırakır; bu müzikal ürün limiti değil, istemci girdi sınırıdır)
2. UTF-8 okuma ve baştaki BOM temizliği
3. JSON parse
4. `__proto__` / `constructor` / `prototype` her derinlikte reddedilir
5. Ham legacy Song reddi — storage migration ile taşınabilir dosya ayrı
   sınırlardır; proje olduğunu iddia eden dosya gerçekten proje olmalıdır
6. Gevşek etiketle format + sürüm — gelecek sürüm **fail-closed**, "bozuk" değil
7. Strict dış kabuk (bilinmeyen alan reddedilir, düşürülmez)
8. Strict Song şeması
9. Merkezi validator zinciri — enstrüman/preset/tuning referansları dahil;
   error bloklar, warning preview'de sayı olarak görünür
10. Read-only preview modeli (başlık, tonalite, tempo, bölüm/ölçü/track
    sayıları, enstrümanlar, warning sayısı)

Onarım, clamp, alan düşürme veya sessiz varsayılan yoktur: dosyadan çıkan şarkı
ya dosyadaki şarkının aynısıdır ya da hiçbir şeydir.

**Typed hatalar.** Dokuz sabit kod (`file_too_large`, `file_read_failed`,
`invalid_json`, `invalid_project`, `unsupported_project_version`,
`song_invalid`, `storage_unavailable`, `import_no_change`, `internal_error`) ve
tek merkezî Türkçe tablo. Ham JSON, Zod diagnostic'i, dosya içeriği veya
exception mesajı UI'a taşmaz; component durum gösterir, cümle kurmaz.

**Preview ve apply.** Dosya seçmek uygulamak değildir: preview sırasında şarkı,
depo, history, playback, seçim ve pano değişmez, ikinci AudioContext kurulmaz;
"Vazgeç" bütün geçici state'i temizler. "Projeyi aç" açık karardır ve tek
`commit(next, {kind: "project_import"})`'ten geçer: tam 1 `setItem`, tam 1
history adımı, etiketler "Geri al: Projeyi açma" / "Yinele: Projeyi açma",
undo önceki şarkıyı byte-eş getirir. Apply zemini deterministiktir: playback
durur ve kendi kendine sürmez, loop kapanır (aynı section id yeni şarkıda da
olsa), pending seek temizlenir, playhead başa döner, tab/arrangement seçimleri
ve ghost kapanır, **panolar temizlenir** (bütünüyle değişmiş bir şarkıdan
kesilmiş pano başka şarkının müziğini yapıştırırdı), görünüm Düzen'e döner.
`canPersist: false` iken apply disabled'dır ve store'daki commit kapısı ikinci
kemerdir; preview açıkça "mevcut şarkın henüz değişmedi" der ve "Mevcut şarkıyı
yedekle" ayrı bir eylem olarak sunulur (zorunlu değildir). Import sonrası eski
şarkı oturum içinde undo ile geri gelir; bu kalıcı kütüphane değildir ve sayfa
yenilenince history sıfırlanır.

**Erişim noktası.** InfoSheet'te "Proje dosyası" bölümü: "Projeyi yedekle"
(tek dokunuşta indirme) ve "Yedekten aç" (ProjectFileSheet'i açar). Ana
kullanıcı metinlerinde "export/import" geçmez. Mobil kurallar ölçülür: bottom
sheet viewport içinde, hedefler ≥44 px, 320 px'te body taşması 0, ikinci yatay
scroller yok, uzun dosya adı ellipsis.

**Orkestrasyon büyüme sınırı (kabul edildi ve ölçüldü).** Saf
contract/parser/serializer `src/lib/project/`'te (`project-file.ts`,
`project-file-errors.ts`, `project-file-name.ts`), dosya seçimi/preview/apply
orkestrasyonu ve Blob/ObjectURL yaşam döngüsü `use-project-file.ts`'te, görünüm
`ProjectFileSheet.tsx`'te. Workspace yalnız controller'ı çağırır, sheet'i açar
kapar ve bağımlılıkları enjekte eder; FileReader callback'i, JSON parse, URL
yaşam döngüsü, hata eşleme, preview state ve ad temizliği Workspace'e girmez.
`Workspace.tsx` 1555 → **1543** satır (başlık `WorkspaceHeader`'a davranış
koruyarak çıkarıldı; `runCommand` hedef kurulumu tek yere indirildi — hileli
sıkıştırma yok); `ArrangementCanvas.tsx` 881'de kaldı. Bu tam refactor değildir;
yeni borç eklememe kapısıdır.

**Boundary yöntemi.** Yeni proje modüllerinde grep tabanlı mimari test yoktur.
Sınırlar üç gerçek mekanizmayla tutulur: (1) TypeScript AST'den çıkarılan
**gerçek import graph** — saf modüller react/tone/next/component/storage
zarfı/store'a import edge'i taşıyamaz, hook depoya yalnız enjekte edilen
commit'le ulaşır, hiçbir component parser'ı import edemez, Workspace yalnız
hook'u alır, ArrangementCanvas `@/lib/project`'ten hiçbir şey alamaz;
(2) modüllerin **export yüzeyi** birebir sabitlenmiştir; (3) ESLint
`no-restricted-imports` aynı kuralları lint'te de söyler. Mevcut grep testleri
bu checkpoint'te dönüştürülmedi.

**Performans (PERFORMANCE.json; warm-up + 30 tur, median/p95/max).** Worst-case
*desteklenen* şarkı (validator-temiz, ≈781 KB dosya) ve demo şarkı ayrı ayrı:
Node'da export serialize ≈8,4 ms, import JSON parse ≈4,0 ms, strict Song
doğrulama ≈11,9 ms, merkezi validator zinciri ≈102 ms, uçtan uca import kararı
≈120 ms median (demo şarkıda uçtan uca ≈2,2 ms). Masaüstü Chromium 141'de
worst-case zarf `setItem` ≈10-18 ms median (max ≈23-34 ms), Object URL
create/revoke ≤0,3 ms, ana şarkı anahtarı benchmark boyunca byte-eş. 51
snapshot history: JSON-eşdeğer üst sınır ≈38,9 MiB; gerçekte tutulan bellek
tek-bar düzenlemelerde ≈0,07 MiB (Node, taban paylaşılır) / ≈1,1 MiB (Chromium,
taban kopyası dahil, CDP `Runtime.getHeapUsage`). Bunların tamamı masaüstü
Node/Chromium ölçümüdür; **fiziksel Android/iOS gecikmesi release gate'inde
açıktır** ve keyfî bir eşik uydurulmamıştır.

**Kapsam dışı (bu sürümde).** WAV/MP3/MIDI/MusicXML export · örnek dosyaları ·
çoklu proje kütüphanesi · cloud sync/hesap · yeni şarkı/section/track akışı ·
mixer · Space playback · provider/Copilot/KV/fiyatlandırma.

### §13.16 Workspace orkestrasyon ayrıştırması (§19 K-47)

**Davranış-korumalı refactor; yeni ürün özelliği yok.** Amaç, bir sonraki
fazın `Workspace.tsx`'e yüzlerce satır eklemek zorunda kalmayacağı temiz bir
composition root bırakmaktı.

**Sorumluluk haritası (önce → sonra).** 1543 satırlık Workspace'te iç içe
duran dokuz state grubu tek sahiplerine taşındı:

- **Navigation** (`src/lib/workspace/use-workspace-navigation.ts`): görünüm,
  aktif track, bar odağı, görünüm değişimindeki scroll hedefleri. Şarkıyı
  değiştirmez, depoya ve motora dokunmaz; transport'a yalnız enjekte edilen
  `seek` ile ulaşır.
- **Selection/edit-session** (`use-selection-session.ts`): zaman seçimi, ölçü
  seçimi, iki pano, ghost/staged komutlar, paste akışı ve bu ikisinin
  sheet'leri. "Bir anda tek seçim" kuralı artık iki bileşenin hatırlaması
  değil, tek sahibin yapısıdır. Komut algoritmalarını yeniden yazmaz; hedef
  hazırlar, unified commit'e typed action ile devreder, retleri UI metnine
  yönlendirir.
- **Note editing** (`use-note-editing.ts`): edit modu, seçili hücre, fret
  hedefi ve onset-grup seçimi; `note_edit`/`group_move` commit köprüsü.
- **Overlays** (`use-workspace-overlays.ts`): hangi üst düzey sheet'in açık
  olduğu, beş bağımsız boolean yerine typed enum — karşılıklı dışlama tipin
  özelliği; büyük bir state-machine yeniden yazımı yapılmadı.
- **Görünüm:** `WorkspaceSurface` (Düzen/Tab seçimi), `WorkspaceOverlays`
  (bütün sheet'ler; arrange formu kendi taslağı olarak burada) ve
  `SelectionActionArea` (aksiyon şeritleri + transform sheet).

`Workspace.tsx` 1543 → **416** satır ve **sıfır `useState`** taşır: kökte
kalan her şey birden fazla sahibi aynı anda ilgilendiren zamk — undo/redo
zemini, proje-apply zemini, Copilot kapıları, yerleşim. `ArrangementCanvas`
881 → **470**: hücreler, seçim tutamacı ve follow-scroll rAF'i `arrangement/`
altında; model/geometri semantiği, tek rAF, hücre başına dinleyici sayısı ve
`data-*` yüzeyleri değişmedi.

**Parite (ölçüldü, iddia edilmedi).** İki viewport'ta önce/sonra: header,
görünüm anahtarı, çalışma alanı, transport ve track gutter bounds'ları
**piksel-eş**; yatay scroller 1, body taşması 0, hedefler 44px; AudioContext
1, oynatma sırasında ~60 rAF/s, üç görünüm geçişinde çalma sürüyor, plan
tick'leri aynı; console/page error 0. Süreler eşit veya daha iyi (COMPARISON.json;
masaüstü Chromium — fiziksel telefon kanıtı değildir). Song, storage zarfı,
fingerprint ve Copilot payload'una dokunulmadı (import-graph bunu söylüyor).

**Sınır yöntemi.** Yeni kontroller gerçek sözdiziminde: AST import-graph,
tanımlayıcı/çağrı sayaçları (ör. `requestAnimationFrame` çağrı sayısı, hücre
başına JSX event attribute sayısı), `useState` tip argümanından tek-sahip
kanıtı, export yüzeyleri, döngüsel import taraması ve ESLint
`no-restricted-imports` (ürün kodu `**/eval/**` alamaz). Eski grep
testlerinden yalnız dokunulanlar dönüştürüldü: history cursor kontrolü artık
metin değil, aritmetik ifadeye giren tanımlayıcı arıyor — `cursor-pointer`
sınıfının verdiği yanlış pozitif probe ile kanıtlandı.

**Eval konsolidasyonu.** Üçten fazla harness'ın kopyaladığı yardımcılar
(`press`, `reveal`, mobil context, layout/44px ölçümü, hata toplama, kayıt)
`eval/shared/harness.mjs`'te; storage, bar-ops, history ve project-file
suite'leri ona bağlandı, eski kopyalar silindi. Storage 50/50 ve project-file
52/52 aynen yeşil. **Dürüst kayıt:** bar-ops 23/29 ve history 22/36 — düşen
senaryolar baseline commit'te birebir aynı; 2K-B'nin zarfı ve undo/redo yazma
semantiği sonrasında güncellenmemiş beklentiler. Bu checkpoint onları ne
kırdı ne de sessizce onardı.

**Kapsam dışı (bu checkpoint'te).** Yeni şarkı/section/track akışı · mixer ·
audio export · çoklu proje · Copilot/provider · çoklu sekme · history
listesi · UI redesign · storage/Song Contract değişikliği · çürümüş bar-ops
ve history suite'lerinin onarımı (ayrı bir bakım işi olarak kayda geçti).

### §13.17 Yeni şarkı, bölüm ve track yaşam döngüsü (§19 K-48)

**Amaç.** Kullanıcı örnek şarkıya bağlı kalmadan sıfırdan proje kurabilsin;
şarkı bilgilerini, bölümleri ve track'leri güvenli, anlaşılır ve geri
alınabilir biçimde yönetebilsin. Tek aktif proje modeli korunur.

**Ön kapı.** Ürün koduna başlamadan önce 2K-B'den beri çürümüş iki tarayıcı
paketi güncel sözleşmeye onarıldı (yalnız eval altyapısı, ayrı commit):
`eval/shared/harness.mjs`'e zarf-farkında `unwrapStoredSong` eklendi, iki
suite ona bağlandı; bar-ops **29/29**, history **36/36**.

**Saf çekirdekler.** On altı komut üç ayrı saf modülde: şarkı
(`song-lifecycle`: şablondan oluşturma + başlık/tonik/mod/tempo), bölüm
(`section-lifecycle`: create/rename/duplicate/move/delete/set/clear tempo
override) ve track (`track-lifecycle`: create/rename/duplicate/move/delete +
**iki ayrı setup yolu**). Hiçbir komut girdisini mutate etmez; her aday tek
kapıdan (`lifecycle-guard`) strict şema + merkezi validator zincirinden
geçer — error atomik red, warning sonuçla birlikte taşınır ve engellemez.
Red kodları typed'dır ve tek Türkçe tabloyla konuşur
(`lifecycle-messages`); dört yıkıcı işlemin onay cümleleri de aynı dosyada
merkezîdir.

**Determinizm.** Timestamp, UUID, randomness yok — AST testi lifecycle
modüllerinde `Date/random/randomUUID/crypto` tanımlayıcısı olmadığını
bağlar. ID'ler ve kopya adları merkezî, collision-safe üreticilerden gelir
(`lifecycle-ids`: `track-1`/`section-1` biçimi; kopyalar `gtr-copy`,
"Gitar 1 kopyası", çakışmada `-2`/` 2`). Aynı girdi beş koşuda byte-eş Song
üretir.

**Şablonlar.** Üç şablon ("Boş başlangıç", "Rock grubu", "Akustik") tek
merkezî tabloda (`song-templates`); ortak varsayılanlar — "Yeni Şarkı",
E minor, 120 BPM, 4/4, ritim aralığı 1/16, "Bölüm 1", 4 ölçü, override yok —
tek yerde. Enstrüman ayrıntıları registry'den çözülür (ilk core preset,
default tuning preset'i, capo 0); sessizlik eksik anahtar olarak yazılır
(spec 5.5). Üç şablonun ürettiği Song strict şema + validator zincirinden
sıfır hatayla geçer.

**Setup güvenliği (iki yol).** Dolu track'te instrument/preset/tuning/capo
değişikliği: güvenli yol içeriği koruyarak aday kurar ve şema+validator bir
error bulursa **atomik reddeder** — pozisyon silinmez, clamp edilmez,
başka tele taşınmaz (`setup_incompatible`). Reddedilirse kullanıcıya ayrı ve
açıkça yıkıcı "Track içeriğini temizleyip değiştir" sunulur: onay bütün
bölümlerdeki notaların silineceğini söyler, anahtarlar missing/silence
semantiğiyle kaldırılır, tek commit/tek yazma, undo eski setup'ı ve bütün
müziği byte-eş getirir. Tek belirsiz "zorla uygula" yoktur.

**Controller ve UI.** Tek controller (`use-lifecycle`) bütün komutların tek
yolu: red → no-op (hiçbir şey bozulmaz) → blocked (`canPersist:false`) →
zemin + tek `commit(next, {kind:"lifecycle", command})` + normalizasyon
sırası sabittir. Zemin geri çağrıları kökten enjekte edilir; controller
başka controller import etmez (AST ile bağlı). Dört sheet (NewSong,
SongInfo, SectionManager, TrackManager) taslaklarını kendinde tutar ve
commit/storage/history/validator'a hiç dokunmaz; `apply*Command`
çağrılarının tek sahibi `use-lifecycle`'dır (AST testi). Giriş noktaları:
Info'da "Yeni şarkı" + "Şarkı bilgileri" (yeni şarkı sheet'i zorunlu
"Mevcut şarkının yerine yeni bir şarkı oluşturulacak." cümlesini ve 2L-A
export yolunu aynen kullanan "Mevcut şarkıyı yedekle"yi taşır), Bölümler
sheet'inde "Bölümleri düzenle", Enstrümanlar sheet'inde "Track'leri
düzenle". `Workspace.tsx` 416 → **450** satır (sınır 450, AST testi 450'ye
daraltıldı), `ArrangementCanvas.tsx` dokunulmadı (470, sınır 470).

**Normalizasyon.** Yapısal apply'da: pause → seçimler/ghost/staged/pano/bar
odağı yere iner; loop ve playhead motorun undo/redo ile aynı yolundan
yeniden türetilir (silinen loop hedefi loop'u kapatır, playhead en yakın
geçerli bara oturur — özel durum yeniden yazılmadı). Silinen aktif
bölüm/track'te deterministik kural: aynı index'te kalan, yoksa önceki
(`survivorIndex`, tek yerde). Yeni şarkı proje importuyla aynı zemine basar.

**History.** `HistoryAction`'a typed `{kind:"lifecycle", command}` varyantı;
on altı komut on beş okuyucu etiketi giyer (set/clear tempo aynı cümle:
"Bölüm temposunu değiştirme"). Ham komut ID UI'da görünmez. Undo/redo diske
de yazar ve byte-eş döner (2K-B sözleşmesi).

**Ürün dili kararı.** Ürün "track" kelimesini 2J.1'den beri history
etiketlerinde kullanıyor; bu checkpoint yarım lokalizasyon yapmadı — yeni
etiketler ve mesajlar da "Track ..." der, enstrüman listesinin başlığı
"Enstrümanlar" (K-42) kalır. "Resolution" kullanıcıya hiçbir yerde denmez;
"Ritim aralığı" ve mevcut etiketler ("1/16", "1/8 üçleme") kullanılır.
Bölüm oluşturmada yalnız core ölçü işaretleri (4/4, 6/8) ve `timing.ts`'in
tam yazabildiği grid'ler sunulur.

**Doğrulama.** 50 yeni birim testi (şablonlar, determinizm, metadata,
bölüm/track komutları, iki setup yolu, store atomikliği: başarı = tam 1
yazma + 1 history adımı, red/no-op = 0/0, `canPersist:false` hiçbir şeyi
ilerletmez). Tarayıcı kabulü: 32+ senaryo × 2 viewport = **68/68** gerçek
production build'de, her apply için gerçek `setItem` sayımı; Copilot hedef
listesi yeni track'i görür, provider çağrısı 0. Performans
(PERFORMANCE.json, Node + masaüstü Chromium — telefon kanıtı değil):
şablon materialization ~0,004-0,006 ms; limit-altı en ağır girdide section
duplicate ~231 ms / track duplicate ~248 ms median (maliyetin ~200 ms'i
merkezi validator zinciri); tek lifecycle commit zarfı `setItem` ~15,6 ms
median; 51 snapshot JSON-eşdeğeri ≈38,9 MiB üst sınır, tutulan Node heap
≈0,07 MiB. 25 vacuity probe (16 unit + 9 tarayıcı) kırmızı.

**Kapsam dışı.** Mixer (volume/pan/mute/solo 2L-C) · audio export · çoklu
proje kütüphanesi · gerçek provider · release hardening.

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

### §13.18 Minimal mixer ve canlı mix önizlemesi (§19 K-49)

**Amaç.** Kullanıcı track'lerin sesini ve stereo konumunu tek yerden, çalarken
duyarak ayarlayabilsin; "sustur"/"tek dinle" ile çalışırken dinleme odağını
değiştirebilsin. Efekt, otomasyon, bus ve gerçek mastering kapsam dışıdır.

**Ön kapı.** Ürün koduna başlamadan önce bölüm oluşturma formu Song
Contract'ın bütün ölçü işaretlerini gösterir hale getirildi (ayrı commit):
`TIME_SIGNATURES` doğrudan kullanılır, form kendi uyumluluk tablosunu
tutmaz, her ölçü için yalnızca `timing.ts`'in tam yazabildiği ritim
aralıkları listelenir (`isRepresentableGrid`). 4/4 ve 6/8 davranışı
değişmedi; 3/4 ve 7/8 artık seçilebilir ve `6/8@12` ile `7/8@12` hâlâ
reddedilir. Formu daraltan `CORE_TIME_SIGNATURES`/`isCoreTimeSignature`
silindi.

**İki ayrı durum sınıfı — bu bölümün taşıyıcı kararı.**

- **Kalıcı mix (proje verisi):** track `volumeDb` ve `pan`. Song
  Contract'ta, proje dosyasında, Copilot fingerprint'inde, undo/redo'da ve
  depoda yaşar; offline render bu değerleri okur.
- **Oturum dinlemesi (session audition):** `mute` ve `solo`. Song'a **hiç**
  yazılmaz — alan yok, dosya yok, fingerprint yok, history yok, depo yok.
  Reload, yeni şarkı ve proje import'u onu bırakır; silinen track'in id'si
  temizlenir; görünüm değiştirmek ve sheet açıp kapamak korur.

Song Contract'a `mute`/`solo` alanı **eklenmedi** (faz 0'dan kalan opsiyonel
`muted`/`soloed` alanlarına hiçbir şey yazmaz ve mixer onları yönetmez).
Mute "−sonsuz dB" olarak da modellenmedi: duyulurluk seviyeden ayrı bir
karardır, aksi halde "sustur"u kaldırmak hangi seviyeye dönüleceği konusunda
belirsiz olurdu. `effectiveTrackGain` seviyeyi, `audibleTrackIds` kimin
duyulduğunu söyler.

**Saf çekirdek** (`src/lib/song/track-mix.ts`). Kalıcı komut iki biçimdir:
`update_track_mix` (bir apply'da kaç track varsa hepsi) ve
`reset_track_mix_to_opened_value`. Komut yalnız `volumeDb`/`pan` değiştirir;
nota, pozisyon, akort, capo, bölüm ve ölçü girdiden okunup dokunulmadan geri
verilir, girdi mutate edilmez, davul da diğer track'ler gibi mikslenir.
Aday tek kapıdan (`guardCandidate`) strict şema + merkezi validator
zincirinden geçer: error atomik red (typed kodlar, tek Türkçe tablo),
warning taşınır ve engellemez. **Sınır dışı değer clamp edilmez, reddedilir**
— bıraktığı yerden başka yere kayan bir slider güvenilmez bir slider'dır.
No-op apply history ve yazma üretmez (aynı müzik geri geldiğinde commit
kapısı reddeder; ikinci bir no-op kuralı yazılmadı). Aynı girdi beş koşuda
byte-eş sonuç verir.

**Merkezî limitler** (`mixerLimits`). Ses −24…+6 dB, adım 0,5; stereo −1…+1,
adım 0,05, merkez 0. Bu sayılar tek kaynakta yaşar; component, engine ve
hook onları tekrar yazmaz. Okunuşlar tek yerde: "−6 dB", "0 dB", "+2.5 dB",
"Merkez", "Sol %30", "Sağ %25".

**Solo/mute truth table.** Solo listesi boşsa mute edilmeyen her track
duyulur; herhangi bir solo varsa yalnız solo'lananlar ve içlerinden mute
edilmemiş olanlar duyulur — **mute solo'ya üstün gelir**. Çoklu solo
serbesttir. Metronom track değildir (`voices` haritasında yoktur, master'a
bağlıdır), hiçbir mute/solo kombinasyonu onu susturmaz. Bilinmeyen/silinmiş
id'ler deterministik temizlenir. **Bütün track'lerin mute edilmesi geçerli
bir sessizliktir** — hata değil, fallback değil.

**Canlı önizleme, apply, vazgeç, bayat taslak.** Mixer açılırken o anki
şarkının kopyası ve kimliği alınır. Slider yalnız taslağı ve çalan ses
düğümünü değiştirir: şarkı, depo ve history'ye dokunmaz. Mute/solo anında
etkilidir ve oturumsaldır. "Uygula" bütün taslağı tek Song adayına, tek
commit'e, tek history adımına ve **tam 1** depo yazımına çevirir; sheet
kapanır, runtime düğümleri commit edilmiş değerde kalır. "Vazgeç"/Escape/
backdrop taslağı açılıştaki değerlere döndürür, runtime'ı geri yazar,
mute/solo'ya dokunmaz ve **0** yazma/history üretir. Mixer açıkken şarkı
değişmişse taslak **inemez**: `isStaleMixDraft` merkezî kararıyla Uygula
kapanır ve güvenli cümle görünür ("Mikser açıldıktan sonra şarkı değişti.
Değerleri yeniden açarak düzenle."); sessiz rebase yoktur, ham
fingerprint/diagnostic UI'a taşmaz.

**Ses grafiği.** İkinci scheduler veya ikinci motor yok. Her track'in
kazancı ve konumu **kendi kanalına** yazılır: `setTrackMix(trackId,
volumeDb, pan)` ve `setTrackAudibility(audibleTrackIds)` typed runtime
yüzeyleridir. Global sampler detune, global gain hilesi ve master pan
yoktur; bir track'in değişimi başka bir track'in düğümünü yazmaz. Sample
yeniden fetch/decode edilmez, schedule listesi değişmez, playhead, çalışma
hızı ve loop sınırları değişmez. Sampler, akor sesleri ve bütün
expressive/legato sesler aynı `voice.channel`'a bağlı olduğu için kararı
birlikte alır. **Mix-only yol bir component koşulu değildir:** merkezî saf
`isMixOnlyChange` yüklenici, `usePlayback` içinde motoru koruyan tek karar
noktasıdır; başka her değişiklik olağan yeniden kurulumu alır.

**Offline render paritesi** (`eval/mixer/`, 15 case, `AUDIO.json`). Ölçülen:
−12/−6/0 dB aynı track'te beklenen yönde (−6 dB → −6,00 dB; −12 dB →
−12,01 dB RMS), pan −1/0/+1 doğru kanalda (merkez L−R 0,00 dB; sert pan
sonsuz oran), iki track iki yana ayrılıyor, akor sesleri track'in panını
paylaşıyor, expressive ses sampler ile aynı miksi alıyor, oturum mute'u
hedefi susturuyor, oturum solo'su yalnız seçileni bırakıyor, bütün track'ler
mute edildiğinde tepe 0, metronom aynı durumda 0,068463 tepeyle çalmaya
devam ediyor, dispose sonrası aktif ses 0. **Bu ölçümler gain/pan/audibility
doğruluğudur; profesyonel mix kalitesi kanıtı değildir.**

**History ve yazma atomikliği.** Tek typed aksiyon `track_mix_update`,
okuyucu etiketi "Track miksini değiştirme". Bir apply = bir history adımı,
kaç track değişirse değişsin; undo hepsini tek adımda eski değerlerine
döndürür ve mute/solo'ya dokunmaz; redo commit edilmiş değerleri geri
getirir ve yine mute/solo'ya dokunmaz. Undo/redo sırasında runtime düğümleri
ikinci motor kurulmadan Song ile eşleşir.

**Yaşam döngüsü entegrasyonu.** Yeni şarkı ve proje import apply'ı oturum
dinlemesini temizler; import **önizlemesi** değiştirmez; track silme o id'yi
düşürür; yeniden adlandırma ve sıralama (id tabanlı olduğu için) korur;
kopyalanan track sustursuz/solo'suz başlar; aynı id ile setup değişimi
korur; undo ile geri gelen track eski mute'unu **diriltmez**.
`canPersist:false` iken kalıcı Uygula kapalıdır, mute/solo çalışır, şarkı
çalınır ve "Sustur ve Tek dinle yalnız bu oturumda çalışır" notu görünür.

**Copilot ve proje dosyası sınırı.** Kalıcı `volumeDb`/`pan` fingerprint'e
doğal olarak girer (`surfaceDigest.tracks`); mute/solo ve mixer taslağı
girmez. Locked-surface guard, modelin track miksini değiştirme denemesini
`tracks` ihlali olarak yakalamaya devam eder. Proje export'u yalnız commit
edilmiş `volumeDb`/`pan` taşır; mute/solo ve taslak dosyaya girmez; import
commit edilmiş değerleri geri getirir. Bu bölümde provider çağrısı yoktur.

**UI.** Transport'ta kullanıcıya görünür "Mikser" girişi (bir track
susturulmuş veya tek dinleniyorsa etiket bunu söyler). Her satırda: track
adı, enstrüman etiketi, "Sustur", "Tek dinle", ses slider'ı, erişilebilir
"−/+" ince ayarları, güncel dB, stereo slider'ı, "Sol/Merkez/Sağ" okunuşu ve
44px merkeze alma kontrolü; altta "Vazgeç" ve "Uygula". Mute/solo yalnız
renkle değil metin, basılı durum, `aria-pressed` ve açık erişilebilir adla
anlatılır; çıplak "M", "S", "pan", "gain", "bus" yoktur. Kapsam cümlesi
açıkça yazılıdır: "Bu ayarlar track'in bütün bölümlerdeki sesini
değiştirir." Sınırlar korundu: `Workspace.tsx` 449 satır (bütçe ≤450),
`ArrangementCanvas.tsx` 470 (bütçe ≤470) ve mixer'ı **import etmiyor**;
`MixerSheet` yalnız typed view-model ve callback alır — audio engine, Song
commit, depo ve history'ye erişmez (AST ile bağlı).

**Dürüst kalite boşluğu (kapatılmadı).** Solo yapılan bölümde arkadaki
enstrümanları yalnız o bölüm için yükseltmek **mümkün değildir**: ses ve
stereo konumu track'in bütün bölümlerine uygulanır. Bölüm bazlı volume
override ve otomasyon bu checkpoint'te **yoktur** ve Song Contract'a böyle
bir alan eklenmedi. Bu, çözülmüş bir problem olarak raporlanmaz; açık bir
kalite boşluğu olarak burada ve K-49'da kayıtlıdır.

**Doğrulama.** 50+ birim testi (saf komut, audibility, staging/stale,
runtime, history ve sınırlar); 35 tarayıcı senaryosu × 2 viewport = **70/70**
gerçek production build'de — ses iddiaları DOM'dan değil gerçek Web Audio
grafiğinden okunur (Tone param'ı zamanlayarak yazdığı için `setValueAtTime`
ve rampalar da yakalanır; beklenen lineer kazanç ve pan değeri birebir
aranır). 30 vacuity probe (20 unit + 8 tarayıcı + 2 ses) kırmızı. Performans
(Node + masaüstü Chromium; **fiziksel telefon kanıtı değil**): 8 track staged
mix güncellemesi ~0,001 ms, audibility hesabı ~0,003 ms, tek mixer apply
~167 ms (≈147 ms'i validator zinciri), runtime gain/pan yazımı ~0,003 ms,
runtime audibility yazımı ~0,05 ms, mix commit ~0,04 ms (Node); mix commit
zarfı `setItem` ~11,8 ms median / 14,1 ms max, 25 slider hareketi 211 ms,
apply gidiş-dönüşü 458 ms, motor kurulumundan sonra sample isteği 21 → 21
(masaüstü Chromium).

---

### §13.19 WAV ve MIDI export (§19 K-50)

**Amaç.** Kullanıcı şarkısını uygulamanın dışına çıkarabilsin: dinlenebilir
stereo WAV, DAW ve nota yazılımında düzenlenebilir MIDI, ve mevcut
`.aranje.json` proje yedeği. Stem export, MP3, MusicXML, ZIP, paylaşım
servisi, cloud upload, mastering ve billing kapsam dışıdır.

**Ön kapı — legacy `muted`/`soloed` (ayrı commit).** Denetim tek gerçek
okuyucu buldu: `engine.ts` içindeki `buildVoice`, `muted: true` taşıyan bir
şarkının track'ini susturuyordu; `soloed`'in hiçbir okuyucusu yoktu. Bu,
üründe hiçbir kontrolün göremediği ve geri alamadığı gizli bir sessizlikti ve
export'la birlikte kullanıcının sakladığı dosyaya sızacaktı. **Okuyucu
kaldırıldı.** Song Contract migration'ı yapılmadı: alanlar şemada duruyor ve
proje dosyası onları byte-eş taşımaya devam ediyor — değişen tek şey ne karar
verdikleri, ki artık hiçbir şey. Doğru cümle **"session mute/solo export
edilmez"**; "proje dosyasında hiçbir mute alanı bulunamaz" değil, ve test bu
ayrımı açıktan bağlıyor. Ses seviyesinde kanıtlandı: bayraklı ve bayraksız
render RMS 0,033224 ve tepe 0,439353 ile birebir aynı.

**Export ürün yüzeyi.** Info/Proje bölümündeki "Dışa aktar" tek görünür
yüzeyi açar; üç format ne *için* olduklarıyla anlatılır: proje ("Şarkıyı daha
sonra Aranjé'de düzenlemek için"), WAV ("Dinlemek ve paylaşmak için; mevcut
Aranjé enstrüman seslerini kullanır"), MIDI ("Başka müzik programlarında
notaları ve zamanlamayı düzenlemek için; Aranjé'nin enstrüman sesi ve bazı
çalım teknikleri taşınmaz"). Proje yolu 2L-A serializer'ıdır; ikinci
serializer yazılmadı.

**WAV kapsamı ve iki içerik seçeneği.** V1 yalnız tam şarkı stereo WAV üretir
(section WAV, stem ve seçili alan yok). "Tüm track'ler" session mute/solo'yu
**yok sayar** ve Song'un kalıcı volume/pan değerlerini kullanır; "Şu anda
duyduklarım" 2L-C'nin `audibleTrackIds` sonucunu açıkça offline render'a
geçirir. Ayrım yapısaldır: tam miks yolunda `setTrackAudibility` **hiç
çağrılmaz**, listeyi geçirmemek "hepsini duy" demektir. MIDI her zaman bütün
track'leri taşır ve session durumunu hiç sormaz.

**WAV sözleşmesi.** RIFF/WAVE, PCM, stereo, 44,1 kHz, 16-bit signed
little-endian; kanonik header/chunk boyutları; `data` + 44 = dosya boyutu ve
RIFF boyutu = dosya − 8. Float → int16 dönüşümü ±1'de clamp edilir (wrap
değil: taşan bir tepe ters yönde bir tık olurdu) ve −1 → −32768, +1 → 32767
ile tipin gerçek uçlarına oturur. **NaN/Infinity susturulmaz, reddedilir** —
render yukarıda bozulmuşsa dosyaya sessiz bir delik açmak, kullanıcının bunu
öğrenmesinin hiçbir yolu olmadığı anlamına gelir. Encoder saftır: aynı veri
beş koşuda byte-eş, girdi buffer'ları mutate edilmez, sessizlik geçerli WAV
üretir, sol/sağ sırası korunur, tek fazla byte veya yarım frame kalmaz.

**Dosya adları.** `project-file-name`'den çıkarılan tek `safeFileStem` üçünü
de adlandırır: `<ad>.wav`, `<ad>.mid`, `<ad>.aranje.json`. Yeni regex
yazılmadı; Unicode korunur, yasak/kontrol karakterleri temizlenir, boş ad
`aranje-proje`ye düşer, uzunluk merkezî sabitte kalır.

**WAV render semantiği.** Mevcut offline motor, mevcut scheduler, mevcut
expression planner ve mevcut sample bank kullanılır — ikinci nota veya
articulation zamanlama yolu **yoktur**. Render tempo haritasını, mixed
grid'i, section tempo override'ını, tie/sustain'i, vibrato/bend/slide/
hammer-on/pull-off/palm-mute/accent'i, track volume ve pan'ı ve davulu
taşır; şarkının gerçek %100 temposunda çalışır (practice rate bir prova
aracıdır ve dosyaya girmez — scheduler'a verilen tempo haritasının
`practicePercent` değeri testle bağlıdır). Export sırasında Song, depo,
history, fingerprint ve Copilot durumu değişmez; online motor yeniden
kurulmaz ve online AudioContext sayısı sabit kalır; offline context işi
bitince dispose edilir ve dispose sonrası aktif ses 0'dır. Çalma varsa export
başlamadan **görünür biçimde duraklatılır**, playhead başa sarmaz ve export
sonrası kendiliğinden devam etmez; bu davranış kullanıcı metninde yazılıdır.

**Süre ve kuyruk.** Render süresi üç terimden türer: notated bitiş +
expression uzantısı + merkezî `audioExportLimits.tailSeconds`. **Dürüst
kayıt: expression terimi bugün her şarkı için 0'dır** — planner her jesti
kendi notasının içine sıkıştırır (bend, vibrato, slide ve sustain dahil), son
notayı bütün tutan şey tail'dir. Terim doğru şekil olduğu için duruyor ve
sıfır olduğu testle sabitlendi, böylece bir gün sıfır olmaktan çıkarsa bu
görünür olur. Tail bir component'te hardcode edilmez. Ölçülen: notated
bitişten sonraki pencerede RMS 0,006798 — decay dosyanın içinde.

**MIDI sözleşmesi.** Standard MIDI File, **format 1**: conductor track +
Aranjé track'i başına bir MIDI track. PPQ merkezî tick modelinden (`PPQ`)
gelir; ikinci timing sabiti yoktur. Conductor: şarkı adı, tempo meta
event'leri (yalnız gerçekten değişen her section'da), time-signature meta
event'leri (yalnız ölçünün gerçekten değiştiği tick'te — bar başına bir tane
değil), end-of-track. Melodik track: track adı, GM program change, CC7
volume, CC10 pan, note on/off, end-of-track. Davul: GM percussion kanalı
(index 9), merkezî drum note map, kick/snare/hat/tom/cymbal ayrı notalarda;
**program change gönderilmez** — 10. kanalda program change enstrüman değil
*kit* seçer. Event sırası deterministiktir: aynı tick'te meta → program →
controller → note-off → note-on, ve note-off aynı pitch'in yeni note-on'undan
önce gelir (aksi halde ikinci vuruş birincinin release'iyle kesilirdi). VLQ
kanoniktir, running status kullanılmaz. Aynı Song beş koşuda byte-eş `.mid`
üretir.

**MIDI'de articulation sınırı — ve nedeni.** V1 yalnız temel pitch, onset,
**tie ile birleşmiş gerçek süre**, velocity, tempo, meter, track kimliği,
program ve kalıcı mix controller'larını taşır. Bend, slide, vibrato,
hammer-on ve pull-off **yazılmaz**: MIDI'nin kanal düzeyindeki tek aracı
pitch bend'dir ve o, aynı kanalda çalan bütün notaları birlikte büker —
akorun bir notası için bend yazmak okuyucunun DAW'ında diğer notaları da
detune ederdi. Sessizce akort bozan bir dosya, "nota ve zamanlama taşır"
diyen bir dosyadan daha kötüdür. MPE, sahte bir yeni standart, global pitch
bend ve guitar tablature uzantısı da yoktur. Dosyanın hiçbir yerinde `0xEn`
status baytı bulunmadığı byte düzeyinde testle bağlıdır. Export sheet bunu
kullanıcıya açıkça söyler.

**MIDI program ve drum map.** Registry'de MIDI bilgisi yoktu; tek merkezî
`midi-map.ts` yazıldı. **Program numaraları 0-tabanlıdır** (protokolün
baytı) ve çoğu yazılımın gösterdiği 1-tabanlı numaradan bir eksiktir — bu tek
yerde belgelenmiş ve testlenmiştir. Preset değil *enstrüman* eşlenir: GM'de
"high gain'e karşı clean" diyebilecek bir program yoktur ve öyleymiş gibi
yapan bir dosya taşıdığı şey konusunda yalan söylerdi. Registry'de olmayan
enstrüman **typed `midi_instrument_unsupported`** ile reddedilir; sessiz
piano fallback'i yoktur. `volumeDb → CC7` ve `pan → CC10` tek saf
fonksiyondadır: CC7 MIDI'nin kendi genlik oranıdır (0 dB → 127, −6 dB → 64),
pan −1/0/+1 tam olarak 0/64/127'ye düşer, clamp yalnız MIDI'nin 0–127
duvarındadır ve Song değeri mutate edilmez.

**Export mimarisi ve tek kapı.** Saf WAV encoder, saf MIDI writer, saf MIDI
plan, saf export planı, offline render adapter, tek export controller ve
yalnız görünüm olan `ExportSheet`. Bir Object URL'i minten ve revoke eden tek
yer vardır; eşzamanlı ikinci export kuyruklanmaz **reddedilir** (iki render
aynı örnekler ve CPU için yarışır ve kullanıcıya yanlış dosyayı vermenin en
kolay yolu budur); başarısız export önceki dosyayı bırakmaz — "tamamlanamadı"
mesajının üstünde geçen seferin sesini indiren bir buton kalmaz. Bütün export
eylemleri controller girişinden geçer; component'lerde dağınık indirme yolu
yoktur (AST ile bağlı: canvas export import edemez, sheet Tone/scheduler/
serializer/encoder göremez, hiçbir component `createObjectURL` çağırmaz).
Sınırlar: `Workspace.tsx` 444 satır (bütçe ≤450), `ArrangementCanvas.tsx` 470
(≤470, export import etmiyor).

**Durum makinesi ve metinler.** `idle → preparing → rendering → encoding →
ready → error`, aynı anda tek iş. Kullanıcıya: "Sesler hazırlanıyor", "Şarkı
işleniyor", "WAV hazırlanıyor", "MIDI hazırlanıyor", "İndirmeye hazır",
"Dışa aktarma tamamlanamadı". Ham exception, Tone diagnostic'i, stack, JSON
veya tarayıcı mesajı gösterilmez. Ready durumunda dosya adı, süre, boyut,
"İndir" ve "Yeni export oluştur" bulunur; error durumunda şarkı ve depo
değişmez, önceki dosya sunulmaz ve yeniden denenebilir. Export öncesi tahmin
gösterilir: WAV süresi ve boyutu (frame × kanal × bit derinliği + header,
encoder'ın kendi aritmetiğiyle) ve MIDI için yaklaşık olay sayısı.

**Depo güvenliği.** `canPersist:false` export'u **engellemez**: proje, WAV ve
MIDI çalışır, düzenleme kapalı kalır, export hiçbir depo yazımı yapmaz.
Export recovery envelope'a dokunmaz, revision değiştirmez, history
oluşturmaz, clipboard/selection temizlemez, yeni şarkı oluşturmaz ve import
preview'ını uygulamaz.

**Lisans ve atıf.** WAV mevcut FluidR3 tabanlı örnekleri kullanır, bu yüzden
export yüzeyi lisansı saklamaz: manifestteki doğrulanmış değerlerle kaynak,
depo bağlantısı, CC BY 3.0 US adı ve bağlantısı ve zorunlu atıf cümlesi
gösterilir; "Atıf metnini kopyala" ve "Atıf dosyasını indir" sunulur. Atıf
dosyası deterministik UTF-8 `.txt`'tir ve örneklerin seçilip dönüştürüldüğünü
söyler. **MIDI ses örneği içermez ve bu yüzden aynı atıf yükümlülüğünü
taşımaz** — sheet bunu ayrıca yazar. **Açık blocker:** CC BY 3.0 US
legalcode bu ortamdan indirilemiyor (`creativecommons.org` proxy politikası
`CONNECT` isteğine 403 veriyor; resmî adres
`https://creativecommons.org/licenses/by/3.0/us/legalcode.en`, kanonik lisans
adresi `https://creativecommons.org/licenses/by/3.0/us/`). Metin **ezberden
yazılmadı**, üçüncü taraf mirror'dan alınmadı, SPDX kopyası "kanonik Creative
Commons kaynağı" diye sunulmadı; `textVendored:false` kalıyor ve uygulama
metni taşıdığını iddia etmiyor, bağlantı veriyor. Yapılacak iş — beklenen
dosya yolu, resmî indirme adresi, SHA-256'nın manifeste kaydı,
`textVendored:true` — repo içinde
`public/samples/licenses/OWNER-ACTION.md` dosyasında kayıtlıdır. **Bu eksik
K-50 kod kapanışını engellemez; public release gate'ini engeller.**

**Ticari erişim.** Bu checkpoint'te abonelik, kota, reklam, ödeme SDK'sı,
fiyat metni, premium rozeti veya kullanıcı hesabı yoktur; export bütün
kullanıcılara açıktır. Sahte kota da yazılmadı — tek controller girişi,
gelecekte entitlement kontrolünün eklenebileceği tek yer olduğu için var.

**İki ayrı worst-case (2M-A.1 §1).** "Worst case" tek kelime değil iki
sorudur ve tek fixture'la cevaplamak, uygulanmayan baskıyı gizler. Süre/bellek
baskısı ile olay/voice baskısı ayrı fixture'lardır ve ikisi de merkezî
limitlerden türer (`eval/shared/export-worst-case.ts`):

- **En uzun süre:** `songLimits.totalBars` = 32 bar, `bpmRange.min` = 40 BPM,
  bar süresi en uzun ölçü (4/4, 768 tick — `ticksPerBar` ile ölçülerek
  seçilir, varsayılmaz). Bar = 768 × 60/(40×192) = 6,000 s → notated 192,000 s
  + expression 0 + tail 3 = **195,000 s**, 8.599.500 frame,
  `44 + 8.599.500 × 2 × 2` = **34.398.044 byte = 32,80 MiB**. Gerçek render
  edilip encode edilen dosya birebir aynı: header `data` 34.398.000 + 44.
- **En yoğun olay:** 8 track, 32 bar, en ince grid (1/32), 4.864 olay, 1.536
  expressive nota, 768 legato zinciri, sıfır fallback; 58,65 s, 9,87 MiB.

**Dürüst düzeltme:** 2M-A raporunda "worst-case WAV ≈9,9 MiB" yazılmıştı. O,
*olay-yoğun* şarkının boyutuydu ve geldiği fixture 138 BPM'de koşuyordu —
sözleşmenin izin verdiği en yavaş tempoya hiç yaklaşmıyordu. Gerçek en uzun
dosya bunun üç katından fazla. Testler artık tempoyu, bar sayısını, tail'i,
kanal sayısını ve bit derinliğini ayrı ayrı bağlıyor.

**Worst-case render ölçümü (2M-A.1 §2, masaüstü Chromium, 3 tur).**
En uzun süre: toplam ~2,2 s median (encode ~161 ms), 32,80 MiB, dispose
sonrası aktif ses 0. En yoğun olay: toplam **~206 s median** (encode ~149 ms),
9,87 MiB, dispose sonrası aktif ses 0. **Açık release riski:** yoğun fixture
masaüstünde gerçek zamanın **~3,5 katında** render ediliyor; telefonda daha
yavaş olması beklenir. Sınırlar bu yüzden küçültülmedi — bulgu
`eval/export/WORST-CASE.json` içinde release riski olarak kayıtlı ve release
gate'inde açık. Fiziksel Android/iOS kanıtı yoktur.

**On-uçuş tahmini bir üst sınırdır.** Frame sayısı yukarı yuvarlanır, yani
gösterilen boyut hiçbir zaman dosyadan küçük değildir; yoğun fixture'da tam
1 frame (4 byte) fazla çıkar. İki sayı da raporlanır; "tahmin dosyadır"
denmez.

**Pitch bend kanıtı doğru seam'de (2M-A.1 §4).** Ham byte'larda `0xE0…0xEF`
aramak MIDI olayı hakkında bir şey söylemez: writer meta metnini Latin-1
yazdığı için "ç" tek başına `0xE7` baytıdır. Kanıt artık `lib/dev`'deki sıkı
okuyucudan geçiyor — chunk sınırları, VLQ delta'lar, meta ve SysEx
uzunlukları, running status, her channel mesajının sabit veri baytı sayısı,
end-of-track — ve **çözülmüş event** sayılıyor. Non-vacuity fixture'ı: başlığı
ve track adı Latin-1 aksanlı harfler taşıyan bir şarkı dosyada **9 adet
`0xEn` baytı** üretiyor ve parser **0** pitch bend buluyor; aynı writer'la
gerçek bir pitch-bend mesajı enjekte edildiğinde parser **1** buluyor. MIDI
üretim davranışı değişmedi.

**Proje yedeğinin sınırı (2M-A.1 §5).** Proje dosyasına iki giriş vardır ve
bu kasıtlıdır: Info'daki tek dokunuşluk "Projeyi yedekle" bir **güvenlik**
yoludur ve her zaman ücretsiz, doğrudan erişilebilir kalır; ileride bir
entitlement/paywall gelirse **proje yedeği onun arkasına konmaz**. WAV ve MIDI
tek export controller'ından geçer, ki böyle bir kontrolün yaşayacağı tek yer
orasıdır. İkisinin paylaştığı şey serializer'dır: tek `exportProject`, tek
dosya formatı, byte-eş — ikinci bir serializer veya farklı bir format
oluşturulmaz. Bu karar testle bağlıdır.

**Doğrulama.** 87 birim testi (WAV encoder, MIDI writer/plan/map/reader,
export planı, worst-case aritmetiği, orkestrasyon, ortak notated plan, legacy
denetimi); 36 tarayıcı senaryosu × 2 viewport = **72/72** gerçek production
build'de, **indirilen byte'lar okunarak** (RIFF/fmt alanları, MThd/MTrk
yapısı ve çözülmüş event'ler, atıf metni) — indirme olayı sonuç sayılmaz;
20 offline render case'inde 14 ses iddiası + 12 worst-case iddiası; 47
vacuity probe (38 unit + 6 tarayıcı + 3 ses) kırmızı. Performans (Node +
masaüstü Chromium, **telefon kanıtı değil**): worst-case WAV encode ~33 ms
median (Node), sample şarkı ~11 ms; MIDI plan ~1,3 ms (sample) / ~75 ms
(worst-case), MIDI yazımı ~11 ms; render süresi planı ~61 ms; proje export'u
~188 ms; encode sırasında tutulan Node heap farkı ≈0 MiB; 3 MB blob için
createObjectURL + revokeObjectURL ~0 ms.
---

### §13.20 Tab okunabilirliği, tek akor seçimi ve bölüm senkronizasyonu (§19 K-51)

Bu checkpoint (2N-A) üç gerçek cihaz kusurunu kapatır ve düzenleme çekirdeğini
notaya bakmayan birine okunur hâle getirir. Kusurlar önce **mevcut build
üzerinde**, üretim koduna dokunmadan yeniden üretildi (`eval/tab/DEFECTS.json`,
5/5): uzun basış tek akoru değil bütün legato zincirini seçiyordu; bölüm
seçimi değişirken çizilen sekme aynı kalıyordu; kısa şarkıda seçilen bölümün
ilk ölçüsü görünür yüzeye hiç gelmiyordu.

**§1 Onset öncelikli seçim.** Uzun basış **bir onset grubunu** alır: parmağın
düştüğü anda vurulan akorun bütün telleri ve onu süren bağlar. Akor için Song
Contract'a nesne veya kalıcı tip eklenmedi — "akor", tek slotta birden fazla
`NoteEvent` demektir, contract'ın zaten söylediği şey. Bağ (`"-"`) yeni onset
değildir; basış bağın ortasına düşerse seçim vuruşa kadar geri uzanır ve özet
bunu `1 uzatılan nota` diye söyler. Velocity, articulation ve position korunur;
seçim Song'a, proje dosyasına, fingerprint'e veya Copilot isteğine girmez.
Zincir kapsamı **seçim anında hesaplanmaz**; ancak kullanıcı bir eylem
seçtiğinde preflight sonucu olarak doğar. Aralık seçimi ve tutamaklar korundu.

**§2 Zincir preflight ve üç karar.** Her mutasyondan önce tipli bir okuma
çalışır: `no_chain_impact`, `crosses_tie_boundary`, `crosses_legato_boundary`,
`crosses_multiple_boundaries` (iki tür birden), `crosses_section_boundary`
(fail-closed). Kullanıcıya üç seçenek gösterilir: **"Bağlantıyla birlikte …"**
— gerçek genişletilmiş kapsam önizlemede görünür ve açıklama komutun kendi
fiilinden, merkezî bir command→copy tablosundan gelir ("Bağlantının tamamı
birlikte silinir: 6 nota · 1 ölçü."), component içinde dağılmaz;
**"Yalnız akoru …"** — deterministik atomik detach; **"Vazgeç"** — şarkı,
pano, depo ve geçmiş değişmez, 0 yazma. **Karar UI'ın değil çekirdeğin
şartıdır:** `applyTransform`, `copySelection` ve `commitTransform` zinciri
bölen bir komutu açık `chainPolicy` olmadan çalıştırmaz, `chain_policy_required`
ile reddeder; önizleme ile commit dört komut × iki policy'de byte-eş ölçüldü.
Detach semantiği tek saf yardımcıda: seçim içindeki legato korunur, yalnız
sınırı aşan slide/hammer_on/pull_off kaldırılır, `"normal"` kalıcı articulation
olarak **hiç yazılmaz** (alan silinir), öksüz kalan bağlar sus olur, hiçbir
durumda öksüz `"-"` oluşmaz, yalnız bağdan başlayan seçim `selection_starts_inside_tie`
ile reddedilir, eksik track anahtarı taşımayı kesmeye devam eder.

**§3 Bölüm navigasyonu tek otorite.** Chip, ok, bölüm sheet'i ve düzen→tab
aynı saf geçiş fonksiyonundan geçer (`section-navigation.ts`). Görülen bölüm
transport'un `activeBarKey`'inden **türetilmez**: bakılan bölüm ile çalan
bölüm iki ayrı olgudur. Bölüm seçmek görünümü devralır (`followsPlayback:false`),
ölçüye dokunmak açık seek'tir, playhead yalnız gerçekten çalınan bölüm
görünürken çizilir. Kısa şarkıda görünür yüzeyin kaynağı seçilen bölümün ilk
ölçüsüdür; scroll sınırına takılan durum `scrollLeft` ile değil, ölçülen bir
viewport genişliğindeki `data-tab-tail` boşluğuyla çözüldü — bu boşluk müzikal
bar, seçim hedefi veya seek hedefi değildir, arrangement bar sayısına,
fingerprint'e ve export'a girmez, dokunulduğunda 0 seek / 0 seçim / 0 yazma
üretir (tarayıcı kabulünde ayrı ayrı ölçüldü).

**§4 Ritim dili.** Teknik değer hiç kaldırılmadan yanına sade okuma eklendi:
"4 ana vuruş · 16 adım" / "4/4 · 1/16". Vuruş ile düzenleme adımı ayrıdır ve
**"16 vuruş" hiçbir yerde yazmaz**. 6/8'in iki ana vuruşu `timing.ts`'in
felt-beat fonksiyonundan gelir. 7/8'e uydurma gruplama verilmez — contract'ta
alan yoktur — bar kendi sayıldığı birimde anlatılır: "7 sekizlik · 14 adım".
Bütün metin tek saf formatter'dan (`rhythm-language.ts`) çıkar; component
içinde ritim matematiği veya ikinci Türkçe tablo yoktur.

**§5 1/4 grid.** `RESOLUTIONS` geriye dönük uyumlu biçimde
`4 | 8 | 12 | 16 | 24 | 32` oldu; anlam değişmedi. 1/4, 4/4'te 4, 3/4'te 3 slot
verir ve mevcut `resolution % denominator === 0` kuralına uyar; 6/8 ve 7/8'de
**önerilmez** (temsil edilemez), yuvarlama yoktur. İkinci timing formülü
yazılmadı ve şema literal listesi `RESOLUTIONS`'tan türetildi, böylece
playback/MIDI/WAV/arrangement/playhead/seçim/grup taşıma/ölçü işlemleri/compact
parser/prompt/fingerprint yollarında yamalı liste kalmadı. Token tavanları
değişmedi; 64'lük grid eklenmedi.

**§6 Mevcut müziğin ölçü ve ritmi.** Tipli, saf, atomik komut
(`timing-change.ts`) iki kapsamda çalışır: tek ölçü ve bölümün bütün ölçüleri.
İki görünür giriş: "Düzen görünümünde ölçü action sheet'i → 'Ölçü ve ritim'" ve
"Bölüm yönetimi → 'Bölümün ölçü ve ritmi'"; sheet açılışta mevcut değeri iki
okumayla gösterir. **Metadata değişimi değil gerçek yeniden yazımdır:** müzikal
tick'ler korunur, yalnız birebir temsil edilebiliyorsa yeniden notalanır, en
yakın slota yuvarlama yoktur, kısalan ölçüde clamp/truncate/sessizce sonraki
ölçüye itme yoktur. Bağ ve legato korunur ya da tipli fail-closed olur; eksik
track anahtarı sessiz kalır ve sahte boş slot dizisi üretilmez; bütün track'ler
aynı bar şekline uyar ve **tek track başarısız olursa işlemin tamamı reddedilir**.
Girdi mutate edilmez, sonuç strict şema + merkezî validator zincirinden geçer,
warning bloklamaz. Başarı = tek depo yazımı + tek history adımı; undo/redo
byte-eş. Tipli hata kodları: `target_grid_incompatible`, `content_exceeds_new_measure`,
`timing_change_splits_chain`, `unsupported_meter_resolution`, `no_timing_change`
(+ `section_not_found`, `bar_not_found`, `validation_failed`). UI'a ham Zod veya
diagnostic metni gitmez. `bpmOverride` ve diğer bölüm alanları dokunulmadan
taşınır.

**§7 Ritmik gruplama (beam) rehberi.** Aynı ana vuruş içindeki kısa onset'lerin
birlikte okunduğunu gösterir. **Perde okumaz** — fonksiyona hiçbir nota
girmez — dolayısıyla "beam var, öyleyse bu bir gamdır" okuması yapısal olarak
imkânsızdır. Song Contract'a alan eklemez; fingerprint'e, proje dosyasına,
MIDI'ye veya Copilot isteğine girmez. Girdisi tab'ın zaten ürettiği
`SlotState[]`'tir, bu yüzden "akor tek onset'tir" özelliği miras alınır. V1:
bağ yeni onset değildir, gerçek sus beam'i keser, ölçü çizgisinde biter, 1/8
bir çizgi, 1/16 iki, 1/32 üç, üçlemede görünür "3", 1/4 hiç beam almaz, karışık
grid'li bar kendi çözünürlüğüyle çizilir, 6/8 felt-beat'ten gruplanır, 7/8'e
yapay 2+2+3 verilmez. Çizgiler fret numarasını, articulation glyph'ini,
playhead'i veya seçim bandını örtmez (dördü de ayrı ayrı `0` çakışma ölçüldü),
yalnız renge dayanmaz, dokunma hedefi veya event listener üretmez, ekran
okuyucuya "Ritim grubu" olarak kapsamıyla birlikte söylenir. **Tam notasyon
motoru değildir:** sap yönü, polifonik ses dizgisi, nüans, alternatif sonlar,
süsleme ve sweep kapsam dışıdır ve yaklaştırılmamıştır.

**§8 Sorumluluk sınırları.** Yedi sorumluluk saf/tipli katmanlara ayrıldı:
onset seçim niyeti, zincir preflight, sınır detach/onarımı, ritim metni
formatter'ı, ölçü/bölüm timing dönüşümü, ritim rehberi modeli, bölüm
navigasyonu geçişi. Sınır testi bunu sahiplik haritası, import grafi ve export
yüzeyi üzerinden ölçer — **yeni grep tabanlı mimari testi yazılmadı**; yeni
runtime dependency eklenmedi. Wiring'den önce davranış-korumalı bir çıkarma
yapıldı (`use-session-ground.ts`), bütçe gevşetilmedi: `Workspace.tsx` 450 →
**385** (≤450), `ArrangementCanvas.tsx` **470** ve bu özelliği sahiplenmiyor.

**§9 Mobil kabul.** Gerçek production build'de 390×844 ve 320×700'de 47'şer
senaryo = **94/94**. İddialar oldukları şeyin üzerinde ölçülür: band'ın kendi
`data-start-ticks`/`data-end-ticks` değerleri, çizilen fret glyph'lerinin
digest'i, `localStorage.setItem` sayımı, `AudioContext` kurulum sayısı — hiçbir
senaryo yalnız görünen metne bakmaz. Ölçülen ek sonuçlar: timing önizleme/vazgeç
**0**, uygula **1**, undo **1**, redo **1** yazma; 4/4→3/4 sonrası MIDI
time-signature olayı `["4/4@0"] → ["3/4@0", "4/4@576"]` ve sonraki onset'ler
`[0, 768, 1536] → [0, 576, 1344]`; proje export/import yeni 1/4 grid'i byte-eş
taşıyor; döngü sınırı `0–2688 → 0–2496` (toplam 4992 → 4800) ile yeni bar
uzunluğundan türüyor; **çalarken timing değişiminde transport duruyor**
(`playing@588 → idle@1344`) ve playhead yeni plandaki bir bar çizgisine
oturuyor — devam etmiyor, ve bu davranış gizlenmeden raporlanıyor;
AudioContext `1 → 1`; beam işaretleri 0 buton / 0 pointer-event / 0 handler;
1/16 grid'de bağla uzayan nota ikinci beam grubu üretmiyor; bölüm timing
değişimi başarısız olduğunda sheet açık kalıyor, güvenli cümle gösteriyor ve
yarım UI state bırakmıyor.

**§10 Vacuity.** 29 probe (spec §10 asgarisi 22), her biri korumayı geçici
olarak kırıp ilgili testin kırmızıya döndüğünü gösteriyor; hepsi tek turda
kırmızı **değildi**: "1/4 beam almaz" probe'u yeşil geldi çünkü testin kullandığı
bar zaten her dörtlüğü ayrı vuruşa koyuyordu ve grup hiç oluşmuyordu — koruma
gerçekten boştu. Gizlenmedi; kural kendi yerinde (`beamLevels` nota değeri)
sabitlendi, mutasyon geri alındı ve süit yeniden yeşil koştu. Kaynakta veya
eval artefaktlarında `PROBE` artığı yok.

**§11 Performans** (Node + masaüstü Chromium; **telefon kanıtı değil**):
8 bar × 1/32 ritim rehberi tek hatta ~0,042 ms, altı telli akor yoğunluğunda
~0,049 ms (beam modeli tek başına ~0,024 ms); bir bölümün timing dönüşümü
strict şema ve bütün validator zinciriyle ~0,9 ms median / ~2,1 ms p95 —
**fixture kapsamı: 1 bölüm, 8 ölçü, 1 track, ölçü başına 16 → 8 slot, 64 ses
olayı**; bu sayı 2L-B/2M-A'nın 32 bar × 8 track worst-case validator
ölçümleriyle karşılaştırılabilir değildir ve öyle sunulmaz. Rehberin eklediği
DOM 7 grup = **49 düğüm** (toplam 603), iki viewport'ta aynı. AudioContext
görünüm değişiminde `1 → 1`.

**Playhead frame yaşam döngüsü (2N-A.1 düzeltmesi).** İlk teslimde "playhead
rAF: boşta 61,3 ↔ çalarken 60,5" diye raporlanan sayı **playhead'e ait
değildi**: ölçüm harness'ının kendi `requestAnimationFrame` döngüsüydü, yani
ekranın tazeleme hızı — boş bir sayfada da aynı çıkar. **Gerçek bir pil
regresyonu yoktu; kusur ölçümün adındaydı.** Üretim davranışı değişmedi.
Sayım artık hook seam'inde, enjekte edilebilir scheduler ve açık debug
sayacıyla, yüzey başına ayrı alınır ve dört sayı asla toplanmaz: tarayıcının
global rAF hızı, hook'un `scheduled` çağrısı, callback'in gerçekten
çalıştırılma sayısı (`drawn`) ve **o an frame borcu olan** loop sayısı
(`live`). Aynı saniyede boşta: global 61,3/s ↔ playhead callback **0**.
Kural tek modülde toplandı (`playhead-loop.ts`; tab ve arrangement paylaşır,
tarayıcının rAF'ine erişen tek yer orası ve bu sınır testiyle bağlı): loop
başlarken **bir** boyama yapar — duran transport'un da bir pozisyonu vardır ve
çizgi oraya konmalıdır — ve **yalnız çalarken** yeniden frame ister; cleanup
borçlu frame'i iptal eder. Bu ilk boyama raporlarda `initialSyncDraw` adıyla
anılır: idle'da "bir başlangıç boyaması var ama `drawn: 0`" çelişki değildir,
iki ayrı şeydir — biri geçişteki tek senkron çizim, öbürü pencere içinde
çalışan rAF callback sayısı. On ayrı ≥1 sn penceresinde ölçüldü: idle / paused /
ended / tab unmount edilmişken / üç görünüm geçişinden sonra idle / dispose
sonrası → **canlı loop 0, tekrar eden callback 0**; playing ve üç geçişten
sonra playing → **tam 1**; başka bölüm okunurken → tam 1, gizli seek yok
(tick 471 → 791), playhead opacity 0; timing değişimi transport'u idle'a
aldıktan sonra → **0**. Playing callback sıklığı ölçülen hâliyle verilir
(uydurma eşik yok): median 60,9/s, p95 61,8/s, maks 61,8/s; aynı pencerelerde
global rAF 60,0–60,8/s. Beam rehberi, seçim ve `data-tab-tail` yeni döngü
kurmaz (çalan tab'da canlı loop hâlâ 1). 14/14 senaryo geçti; 7 vacuity probe
kırmızı — biri doğrudan "ölçüm yine yalnız global rAF'i sayarsa" mutasyonudur.

**Kapsam dışı (yapılmadı):** yeni provider, Copilot kalitesi, ses motoru, yeni
sample, gerçek kayıt senkronizasyonu, rakip ürün özellikleri, tam notasyon
editörü, fiziksel Android/iOS kabulü.

---

### §13.21 Yerel proje kütüphanesi v1 (§19 K-52)

Bu checkpoint (2O-A) Aranjé'yi "tek açık şarkı" uygulamasından, aynı cihazda
**birden fazla projeyi güvenle saklayan** bir uygulamaya çevirir. Kabul ölçütü
listede birkaç şarkı görünmesi değil, **kalıcı kayıt ve kurtarma
garantilerinin proje başına doğru çalışmasıdır**.

**Yerel kalır.** Hesap, sunucu, senkronizasyon, paylaşım yoktur ve bu
checkpoint hiçbirini hazırlamaz. Proje yedeği her zaman ücretsiz ve doğrudan
erişilebilirdir (K-50); proje sayısı için kota, paywall veya uydurma tavan
yoktur. Şarkı başına track/bar limitleri değişmedi.

**§1 Kimlik.** Proje kimliği `project-<n>`'dir; `n` katalogda tutulan
`nextProjectNumber` sayacından gelir, **monoton artar ve silinen kimlik asla
yeniden dağıtılmaz**. Zaman damgası, UUID, `Math.random`, `crypto.randomUUID`
ve cihaz bilgisi kimliğe girmez — beş özdeş koşu byte-eş sonuç verir. Kimlik
deseni tek yerde (`project-id.ts`) tanımlıdır ve `localStorage` anahtarına
dönüşen tek kullanıcıya yakın değer odur: tanınmayan bir kimlikten anahtar
**üretilmez** (`projectKey` null döner).

**§2 İki kayıt, üç anahtar.** Katalog `aranje.projects` anahtarında
`{format:"aranje.project-catalog", version:1, activeProjectId, projectIds,
nextProjectNumber}`; her projenin müziği `aranje.project.<id>` anahtarında
`{format:"aranje.project-record", version:1, projectId, revision, updatedAt,
current, previous}`. Üçüncü anahtar `aranje.project-pending`, yarım kalmış bir
silmenin notudur. Kayıt zarfı **şarkı zarfının aynısıdır**: `decideLoad`
sırası, `previous` rungu ve revision kuralı yeniden yazılmadı, yeniden
kullanıldı — ikinci bir kurtarma yolu yoktur.

**§3 Yazma sırası kurtarılabilirliği belirler.** `localStorage` tek anahtar
yazar; iki yazımlık bir işleme "kaydetme" demek, katalogda var olup diskte
olmayan projeler üretir. Bu yüzden sıra seçilidir: **oluşturma biçimli**
işlemler (yeni proje, çoğaltma, dosyadan yeni proje) önce payload, sonra
katalog yazar — yarıda kesilirse ortada **sahipsiz ama okunabilir** bir kayıt
kalır ve kayıt kendi `projectId`'sini taşıdığı için açılışta sahiplenilir.
**Silme** ise önce not, sonra katalog, sonra payload, en son notu siler —
yarıda kesilirse açılış notu okuyup işi **bitirir**, çünkü not kullanıcının
onayının zaten alındığını kaydeder. Not olmasaydı yarım silme ile yarım
oluşturma birbirinden ayırt edilemez, açılış da kullanıcının az önce silmek
istediği projeyi geri sahiplenirdi.

**§4 Migration eski anahtarı okumadan bırakmaz.** `aranje.song` bulunursa
`project-1`'e taşınır; **eski anahtar ancak yeni kayıt geri okunup içeriği
doğrulandıktan sonra** silinir — `setItem`'ın hata atmaması kanıt değildir.
On üç başlangıç durumu ölçülerek karşılandı (boş, legacy ham Song, V1 zarf,
`current` bozuk/`previous` sağlam, ikisi de bozuk, gelecek sürüm, bozuk
katalog, katalogsuz payload'lar, katalog var payload yok, yarım kalmış silme,
okunamaz not, dolu birinci slot, yazılamayan cihaz). Bozuk katalog **önce
taranarak yeniden kurulur**; hiçbir durumda katalogun adını bilmediği payload
silinmez ve birinci slot doluysa migration üzerine yazmaz.

**§5 Kullanıcının on eylemi, beş saf komut.** Ekrandaki eylemler: yeni proje,
listeleme, aç, adlandır, çoğalt, yedekle, sil, dosyadan **yeni proje** olarak
içe aktar, dosyayı **açık projenin yerine** koy, yarım kalmış işi kurtar.
Bunların beşi yeni saf komuttur (`createProject`, `openProject`,
`duplicateProject`, `importProjectAsNew`, `deleteProject`); adlandırma mevcut
`update_song_info` komutundan geçer (tek başlık otoritesi, §6), yedekleme ve
yerine koyma 2L-A'nın tek serializer'ında kalır (ikinci format yok), kurtarma
ve sahiplenme ise açılışta `settleProjects` içindedir. Komutlar aynı iskeleti
korur: reddet → adayı **katı şema
ve merkezî validator zincirinden** geçir → payload yaz **ve geri oku** →
ancak ondan sonra katalogu yaz → katalogu da doğrula. Herhangi bir adım
başarısızsa kullanıcının önceki görünümü bütündür; hayatta kalabilen tek şey
henüz kimsenin işaret etmediği bir payload'dır ve bu bilinçlidir. Komutlar
React, saat ve global durum bilmez; `now` enjekte edilir.

**§6 Tek başlık otoritesi.** Liste satırındaki ad `Song.title`'dan türer;
katalogda ikinci bir ad alanı yoktur, dolayısıyla "listede başka, ekranda
başka" durumu yapısal olarak imkânsızdır. Yeni projeler deterministik dostane
ad alır (`Yeni Şarkı`, `Yeni Şarkı 2`), kopya `… kopyası` ile devam eder.
Liste özeti (`3 bölüm · 24 ölçü · 4 track`) her açılışta şarkıdan hesaplanır —
önbelleğe alınmış bir şekil ikinci bir Song Contract olurdu.

**§7 "Yeni şarkı" artık üzerine yazmaz.** `create_song` komutu **kaldırıldı**;
tek kullanıcı yolu yeni bir proje oluşturmaktır ve açık proje byte-eş kalır.
Komut dispatcher'ı bilinmeyen komutta `undefined` değil **tipli red** döner,
yani kaldırılan davranışa geri dönen çağrılabilir bir yol bırakılmadı. İçe
aktarma iki ayrı hedefe bölündü: **yeni proje olarak** ve (eskiden olduğu
gibi) **açık projenin yerine**.

**§8 Proje başına kalıcılık ve tek yazım.** Şarkı deposu tektir; değişen tek
şey **hangi anahtara** yazdığıdır ve bunu tek bir port (`active-project.ts`)
bilir. Bir commit tam olarak **bir** proje anahtarı yazar, başka hiçbir
anahtara dokunmaz. Undo/redo proje sınırını geçmez: proje değişince geçmiş
sıfırlanır (`canUndo:false`, derinlik 0/0) ve proje değişimi geri alınabilir
bir Song düzenlemesi değildir. Açık projenin kaydı oturum ortasında okunamaz
hâle gelirse **commit reddedilir ve bozuk byte'lar aynen korunur** — tek
kopyayı silmek, uygulamanın istenmediği hâlde bir kaybı tamamlaması olurdu.

**§9 Bayat sekme kayıp kapısı.** İki sekme aynı projeyi açabilir. Her
commit'ten önce diskteki `revision` yeniden okunur; hatırlanandan farklıysa bu
sekme **yazmayı reddeder**. Bu bir **kayıp kapısıdır, çoklu sekme
senkronizasyonu değildir**: `localStorage`'ta işlem ve compare-and-swap
yoktur, aynı anda yazan iki sekme okuma ile yazma arasında hâlâ araya
girebilir. Kapının gerçekten çözdüğü durum, saatlerdir arkada açık duran bir
sekmenin sahibinin dönüp tek nota yazmasıdır. Bayat sekme **yedek alabilir**;
dinlemek ve kendi müziğini dışa aktarmak hiçbir kapının arkasında değildir.

**§10 Sınırlar ve gizlilik.** Katalog, aktif proje kimliği, `revision`,
`updatedAt` ve kurtarma metadata'sı **Song fingerprint'ine, Copilot isteğine
ve `.aranje.json` dosyasına girmez**; proje dosyası formatı değişmedi
(`{format:"aranje.project", version:1, song:{}}`). Kütüphane Copilot,
provider, faturalama ve reklam kavramlarını hiç bilmez. Aynı şarkı iki kez
saklanmaz. Ekranda ham `localStorage`, `JSON`, `Zod`, `revision`, anahtar adı,
stack trace veya istisna adı **hiç görünmez**; her hata kapalı bir koda ve tek
bir tablodan gelen cümleye bağlıdır (eksik cümle derleme hatasıdır).

**§11 Silme dürüsttür.** Silmeden önce projenin adı, şekli ve "geri
alınamaz" olduğu açıkça yazılır; çöp kutusu veya bulut kurtarma varmış gibi
davranılmaz. Son proje V1'de silinemez (buton kapalıdır): boş bir kütüphanenin
aktif projesi olmaz ve uygulama birini uydurmak zorunda kalırdı. Açık proje
silindiğinde hayatta kalan, bölüm ve track'lerin zaten kullandığı aynı
`survivorIndex` kuralıyla seçilir; açılamayan bir hayatta kalan varsa silme
hiç başlamaz.

**§12 Ölçümler (masaüstü Node + Chromium — telefon kanıtı değildir).**
Gerçekçi fixture'da (2 bölüm, 8 ölçü, 4 track, 10 proje): liste kurulumu
median 8,8 ms; proje açma 1,5 ms; yeni proje 10,1 ms; çoğaltma 14,7 ms; bir
commit 1,0 ms; bir kayıt 14.449 byte, on projelik katalog 236 byte.
Worst-case şarkıda (4 bölüm, 32 ölçü, 8 track) bir kayıt **799.772 byte**,
proje geçişi 39,1 ms, uçtan uca çoğaltma 306,1 ms. Tarayıcıda liste 50 satırda
313 DOM düğümü ekliyor ve açılış 43,7 ms; **50 projelik özet modeli 46,0 ms
median (p95 66,4 / maks 98,0)** — bu sayı iyi değildir, gizlenmiyor ve
sanallaştırma **ölçülmeden** eklenmedi. **İkinci dürüst bulgu:** Chromium bu
profilde worst-case boyuttaki yalnızca **6 projeyi** kabul etti (~4,5 MiB) ve
sonra yazmayı reddetti; aynı anda `navigator.storage.estimate()` ~1,07 GB
söylüyordu. Yani `estimate()` bir söz değildir ve kota gerçek yazımla
ölçülmelidir.

**§13 Sınır ve mimari.** Yedi sorumluluk saf modüllere ayrıldı (kimlik,
katalog, kayıt, depo, migration, komutlar, özet/kopya); component'ler bir
controller görür, altındaki depoyu görmez. Ölçüm **import grafi, AST ve
ESLint restricted-import** ile yapıldı; yeni grep tabanlı mimari testi ve yeni
runtime dependency yok. `Workspace.tsx` **380** satır (başlangıç 385'in
altında, bütçe gevşetilmedi), `ArrangementCanvas.tsx` 470'te ve bu özelliği
sahiplenmiyor; yeni mega-hook yok (`use-workspace-files.ts` 66 satırlık,
hiçbir şeye sahip olmayan bir kompozisyon).

**§14 Doğrulama.** 2.342 birim testi (kütüphanenin kendisi 125); **55 senaryo
satırı × 2 viewport = 110/110** gerçek production build'de, fiziksel storage
ledger'ı anahtar türüne göre sayılarak; **35 vacuity probe kırmızı, 0
vacuous**. İlk turda sekiz probe yeşil geldi ve hiçbiri gizlenmedi: dördü
gerçek test boşluğuydu (migration read-back'i, katalogun payload'ları, yazımın
geri okunması, liste özetinin şarkıdan türemesi) ve testle kapatıldı; dördünün
mutasyonu iddia edilen tehlikeyi ölçmüyordu ve hedefleri düzeltildi.

**§15 Kapanışta bulunan ve düzeltilen kusur.** Adlandırma, dosyadan yeni proje
ve "açık projenin yerine koy" akışları ilk turda yalnız birim testleriyle
kapsanmıştı. Bu üç akış için tarayıcı senaryosu yazılınca **gerçek bir kusur**
çıktı: liste `useMemo`'da katalog kimliğine bağlıydı ve şarkı depo üzerinden
değişince (adlandırma, düzenleme, geri alma) yeniden hesaplanmıyordu — yani
"özet her zaman şarkıdan türer" iddiası yerde doğruydu ama **zamanda
değildi**. Liste artık her açılışta yeniden okunuyor; kusur senaryo 51.b ile
ve mutasyonu geri koyan 35. probe ile bağlandı.

**Kapsam dışı (yapılmadı):** bulut, hesap, senkronizasyon, paylaşım, proje
klasörü/etiketi/arama, çöp kutusu, sürüm geçmişi tarayıcısı, akor kurucu,
çoklu enstrüman görünümü, release hardening, fiziksel Android/iOS kabulü.

### §13.22 Hızlı akor ve power chord kurucu v1 (§19 K-53)

Bu checkpoint (2O-B) tek bir vaadi karşılar: **"Am7 veya bir power chord
yazmak için notaları ve telleri tek tek girmek zorunda değilim."** Kullanıcı
kök sesi, akor türünü ve çalınabilir bir şekli seçer; Aranje bütün notaları
aynı vuruşa tek, geri alınabilir ve düzenlenebilir bir müzik olayı olarak
yazar.

**Yönlendirme yoktur.** Sistem olasılık sunar, seçimi kullanıcı yapar. "Sonraki
akor", "önerilen", "en kolay", "şarkına uygun" gibi hiçbir ifade yoktur ve bu
sözcükler kod tabanında bulunmaz (testle bağlı). Varyasyon etiketleri
betimleyicidir: "Açık konum · kök basta", "5. perde çevresi", "1. çevrim".

**§1 Akor kalıcı bir nesne değildir.** Song Contract değişmedi. Akor, aynı
onset'te başlayan birden fazla `NoteEvent`'tir — contract'ın zaten söylediği
şey. `chordName`, `chordId`, `voicingId`, `shapeId` gibi hiçbir alan eklenmedi;
`voicingId` yalnızca deterministik aday kimliğidir ve Song'a, dosyaya,
fingerprint'e veya Copilot isteğine **girmez** (serialize edilen byte'lar
üzerinde testle bağlı).

**§2 Tek armonik sözlük.** On bir kalite tek tabloda (`chord-formula.ts`):
majör `[0,4,7]`, minör `[0,3,7]`, power `[0,7]`, sus2 `[0,2,7]`, sus4 `[0,5,7]`,
eksilmiş `[0,3,6]`, artmış `[0,4,8]`, 7 `[0,4,7,10]`, maj7 `[0,4,7,11]`,
min7 `[0,3,7,10]`, yarı eksilmiş 7 `[0,3,6,10]`. Bu sayılar başka hiçbir yerde
tekrar edilmez; UI etiketi, tanıma ve iki voicing üreteci aynı tablodan okur.
Kaliteye aralık + etiket verilmeden tabloya ekleme yapmak derleme hatasıdır.
Add9/6/9/11/13/altered/slash/polychord V1 dışıdır ve UI destekliyormuş gibi
göstermez.

**§3 requiredChordTones politikası tek yerde.** Beşli **yalnız yedili
akorlarda** düşebilir, çünkü kaliteyi yedili zaten sabitler. Yarı eksilmiş 7
istisnadır: eksilmiş beşlisi düşerse geriye düz bir minör 7 kalır, o yüzden
korunur. Kök hiçbir zaman opsiyonel değildir.

**§4 Kök ve enharmonic.** Seçim 12 pitch class üzerinden yapılır; kullanıcı
"D♯ / E♭" okur, uygulama yalnız `3` sayısını taşır. Aynı sounding pitch iki
farklı semantik üretmez. Capo takılıyken seçilen kök **sounding pitch**'tir;
yazılan perde capo'ya görelidir. UI'da MIDI numarası gösterilmez.

**§5 Perdeli arama bir sözlük değildir.** Elle yazılmış ikinci bir akor
veritabanı yoktur. Arama kullanıcının track'inde gerçekten ne varsa onu okur:
akort, capo, tel sayısı, capo'nun bıraktığı perde sınırı. El genişliği kadar
bir pencere boyunca her telde ya bir akor sesi ya sessizlik seçilir. Mevcut
`soundingMidi` / pitch / hand-position yardımcıları yeniden kullanıldı; ikinci
pitch matematiği yazılmadı.

**Fiziksel kurallar — hiçbiri zevk değil:** aynı telde iki nota yok, perde
clamp yok, range dışı şekil reddedilir, zorunlu ton eksikse aday kabul
edilmez. **El kuralı:** dört parmak; yetmezse en alt perdede bir barre ve
barre'ın örttüğü tel açık çalamaz. "Aynı perde iki kez = barre" varsayımı
**yanlıştır** ve açık D7'yi (`x x 0 2 1 2`) elerdi; kural parmak sayısı
üzerinedir. **Maksimum açıklık ölçülerek 2'ye çekildi:** beş klavyede
(standard, Drop D, capo 2, DADGAD, dört telli bas) 12 kök × 11 kalite = 660
kombinasyonun hiçbiri boşalmıyor.

**§6 Sıralama ve varyasyon seçimi.** Sıra: akorun ne kadarı duyuluyor, ortada
susturulan tel var mı, kaç tel çalıyor, el ne kadar açılıyor, parmak sayısı,
konum, id. Aynı bölgeden ikinci kart ya **bastaki sesi** ya da en az **iki tel**
doluluk farkını taşımalıdır; tek fazladan susturulmuş tel aynı fikri iki kez
göstermektir. En fazla dört kart. Önceki/sonraki akora göre voice leading
yapılmaz, tonaliteye göre aday elenmez.

**Zorunlu kabul:** standard akort, capo 0'da A minör 7 adayları arasında
`x 0 2 0 1 0`, `5 7 5 5 5 5` ve `5 x 5 5 5 x` bulunur ve testler her telin
**sounding pitch**'ini doğrular (yanlış tel sırasıyla kazara geçmez).

**§7 Power chord kalıcı bir tip değildir.** Formül tablosu `[0, 7]` der; iki
ya da üç ses olması ve **kökün mutlaka basta** olması *shape* katmanının
kuralıdır. Üç sesli biçimde tepe nota kökün tam bir oktav üstüdür. Drop D'de
açık D5 (`0 0 0 x x x`) gerçek akorttan bulunur ve standard akortta
bulunmaz.

**§8 Perdesiz enstrümanlar.** Piyano/e-piyano/org/synth/yaylı için akor bir
perde yığınıdır: kök pozisyonu ve çevrimler, **hiçbir `position` alanı
yazılmadan**. **Aranje'de bu enstrümanlar için sayısal ses aralığı yoktur** ve
bu checkpoint o kararı değiştirmez — `range.ts` onları bilerek erteler
("aralık uydurulacak bir şey değil"). Denetlenen tek sınır, Song Contract'ın
yazabildiği perde uzayıdır; dışına çıkan yığın sessizce oktav aşağı
katlanmaz, reddedilir.

**§9 Yazma komutu tikte çalışır.** Hedef, slot index değil **tik**tir (K-34).
Tikte tam olarak başlayan slot yoksa `target_grid_incompatible` ve hiçbir
yuvarlama yapılmaz. Süre de slot sınırına birebir oturmak zorundadır; uzun
akor mevcut tie mekanizmasıyla taşınır, tekrar vuruşla değil. Ya bütün akor
yazılır ya hiçbir şey; başarısızlıkta girdi Song byte-eş kalır.

**§10 Dolu vuruş sessizce ezilmez.** Kullanıcı açıkça "Bu vuruşu akorla
değiştir" demelidir; `replace_onset` bütün onset'i alır, eski tie kuyruğu susa
döner, sonraki onset'e dokunulmaz. Bağlı onset (`slide`/`hammer_on`/`pull_off`,
ister bu slottan çıkan ister öncekinden gelen) **atomik reddedilir** — kullanıcı
bağlantıyı mevcut araçlarla, ne kestiğini görerek ayırır. Karışık
süre/velocity/ifade taşıyan onset'te ortalama uydurulmaz, tipli reddedilir.

**§11 Önizleme ile commit aynı hesaptır.** Ghost, gerçek komutun gerçek şarkı
üzerinde üretip attığı sonuçtur; Uygula aynı komutu bir kez daha koşup saklar.
İkinci bir yol yoktur, dolayısıyla önizlemenin sözünü commit'in tutmaması
mümkün değildir. Önizleme ve varyasyon dolaşma **0 yazma / 0 history**.

**§12 Sesli dinleme mevcut yolu kullanır.** Copilot adayının kullandığı
`PreviewEngine`; ikinci AudioContext, ikinci scheduler, ikinci sample bank
yoktur. Sheet kapanınca ve unmount'ta `stop()`. Önizleme kazancı nota sayısına
göre ölçeklenir ve bu sayı **yalnız önizlemede** kalır — Song velocity'sine,
mixer'a ve dışa aktarılan dosyaya girmez (ölçüldü).

**§13 Yazılan akor sıradan müziktir.** Tek basışla bütün akor seçilir (bir
onset bloğu, beş onset değil); transpoze aralıkları korur; `translate_fret_shape`
power shape'i blok halinde taşır; move/duplicate/repeat/delete/bar kopyala
akoru bütün olarak taşır; undo tek adımda bütün akoru kaldırır, redo byte-eş
geri getirir. MIDI planında beş note-on ve hepsi tek tik'te. Proje dosyasında
akor metadata'sı yoktur ve import sonrası şarkı byte-eş gelir. History
etiketleri: "Akor ekleme" / "Akoru değiştirme".

**§14 Sınırlar.** Saf çekirdekler React/Tone/Next/storage/projects/components/
eval import etmez; `window`/`document`/`localStorage`/`AudioContext`/`fetch`
kullanmaz; `Date`/`random`/`randomUUID`/`crypto` yoktur. Sheet'ler arama, store
ve motor import edemez; component içinde interval tablosu ve tuning matematiği
yoktur. `ArrangementCanvas` `/chords/` altından hiçbir şey import etmez.
Ölçüm AST ve import grafiyle; yeni grep tabanlı mimari testi ve yeni runtime
dependency yok. `Workspace.tsx` **379** (başlangıç 380 aşılmadı),
`ArrangementCanvas.tsx` 470 ve değişmedi. Yeni mega-hook yok.

**§15 Ölçümler (masaüstü Node + Chromium — telefon kanıtı değildir).**
Formül 12 kök × 11 kalite 0,046 ms; tanıma 0,076 ms; klavye çevrimleri
0,009 ms; komut önizlemesi (validatörler dahil) 0,388 ms. Gitar aday üretimi
standard akortta **15,5 ms** median (Drop D 11,1 · capo 2 6,4 · DADGAD 10,8 ·
bas 1,6); dört kartın üretilmesi 16,6 ms. Tarayıcıda builder açılışı 250 ms,
kök seçimi 99 ms, kalite + liste 102 ms, 25 varyasyon değişimi 50 ms, uygula
round-trip 393 ms, geri al/yinele 234 ms; sheet 41 düğüm.

**§16 Üç dürüst bulgu — hiçbiri gizlenmedi.**

1. **Bütün klavye taraması 621 ms median.** 11 kalite × 12 kök tek seferde
   taranırsa yarım saniyeyi geçer. Ürün bunu yapmaz (kullanıcı bir kök ve bir
   kalite seçer, o yol 16,6 ms) ama sayı kaydedildi ve **ölçmeden cache
   eklenmedi**.
2. **Yoğun akor 0 dB'de tam ölçeği aşıyor.** Altı sesli Am7 tepe 1,8090; WAV
   encoder ±1'e clamp ettiği için dışa aktarılan dosyada kırpılırdı. Elle
   yazılan beş sesli akor de aynısını yapar — mix yolu değişmedi — ama akoru
   kolaylaştırmak bunu çok daha ulaşılabilir kılar. Şablonların verdiği
   −6 dB'de aynı akor 0,9066 ile içeride kalır. Sahibi mixer'dır; motora
   limiter eklenmedi.
3. **Ölçüm sırasında mevcut bir ürün kusuru bulundu:** bütün launch
   şablonları yeni kullanıcıya `electric_guitar/clean` verir ve **`clean`
   preset'inin vendor edilmiş sample pack'i yoktur**, dolayısıyla o track hiç
   ses çıkarmaz. 2O-B'nin sebep olduğu bir şey değildir (aynı track'teki her
   nota da sessizdir) ama chord builder tam olarak "yeni proje açan yeni
   kullanıcı" için vardır, yani "Dinle" o track'te hiçbir şey yapmaz. Şablonun
   hangi preset'i seçtiği bir ürün kararıdır ve tek taraflı değiştirilmedi;
   sahibe bildirildi. En ucuz çözüm: ya temiz gitar pack'i vendor edilir, ya
   şablon pack'i olan ilk core preset'i seçer.

**§17 Bir ölü koruma kaldırıldı.** Perdesiz voicing'ler için önce bir
"register ceiling" yazılmıştı. Ölçüldüğünde 11 kalite × 12 kök × her yazılabilir
oktavdaki **4.040 yığının hiçbirini** kesmediği görüldü. Ateşlenemeyen koruma
koruma değildir; hem kural hem yanındaki limit kaldırıldı, register artık
çevrim aritmetiğinin kendisiyle yapısal olarak korunuyor.

**§18 İki kabul boşluğu açıkça kayıtlı.** Perdesiz enstrümanlar için (a)
repoda sayısal ses aralığı yok ve (b) klavye düzenleme yüzeyi yok —
`isEditableTrack()` fretboard şart koşar, tab tel satırı çizer ve track
manager yalnız core enstrümanları sunar. Saf çekirdek eksiksiz yazıldı ve
birim testleriyle bağlandı; **UI yüzeyi bugün yalnız perdeli track'lerde
vardır** ve bu, uydurulmuş bir klavye editörüyle kapatılmadı.

**Kapsam dışı (yapılmadı):** akor dizisi önerisi, scale-aware öneri, voice
leading, add9/6/9/11/13/altered, slash chord kalıcı modeli, polychord,
arpeggiator, strumming motoru, sweep/TechniqueSpan, akor diyagramı eğitim
sistemi, parmak numarası, barre kalıcı modeli, MIDI/audio akor tanıma, 64'lük
grid, çoklu enstrüman stacked editor, cloud/hesap/paywall, gerçek provider,
release hardening, fiziksel Android/iOS kabulü.

### §13.23 Açılış ses bütünlüğü, paylaşılan preview bank ve ifade ölçümü (§19 K-54)

Bu bölüm iki checkpoint'i birlikte kaydeder. **2O-B.1** ölçülmüş üç ürün
sorununu kapatır; **2P-A** bir *ölçüm* ve *tasarım* turudur ve bugünkü
bend/slide davranışını **değiştirmez**.

#### 2O-B.1 — açılış sesi

**§1 Kayıtta olmak ile duyulabilmek iki ayrı olgudur.** Registry hangi
preset'lerin *var* olduğunu söyler ve kasıtlı olarak kayıtlardan haberi
yoktur. `electric_guitar/clean` gerçek, core kapsamda, seçilebilir bir
preset'ti ve arkasında vendor edilmiş sample pack yoktu: o preset'i taşıyan
track hiç ses çıkarmıyordu — daha kısık değil, hiç — ve üstündeki her katman
başarı bildiriyordu. İki launch şablonu yeni okura tam olarak bu track'i
veriyordu (`eval/chord-audio/artifacts/BASELINE.json`).

`AudioPresetAvailability` bu ikinci soruyu sahiplenir. **Song Contract'ın
parçası değildir:** şarkı okurun seçtiğini saklar, hiçbir availability alanı
şarkıya yazılmaz, dosyaya çıkmaz, fingerprint'e girmez ve validator zincirinde
sorulmaz. Bugün duyulamayan, yarın vendor edilen bir preset diskteki hiçbir
dosya hakkında hiçbir şeyi değiştirmez. `bankKey` preset adının değil
**çözülmüş varlık kümesinin** kimliğidir.

**§2 Şablon duyulabilen bir şey verir.** `materializeTrack` artık
`playableCorePresets(...)[0]` seçer — electric guitar için `high_gain` —
ve duyulabilir core preset'i olmayan enstrüman için track üretmek yerine
**reddeder**. `clean` registry'de anlamını korur; kaldırılmadı.

**§3 Legacy şarkı düzeltilmez, doğrusu söylenir.** `silentTracks(song)`
şarkıyı okur ve asla yazmaz. Kullanıcıya gösterilen cümle okurun kendi track
adlarını kullanır; preset id'si, pack id'si, URL, manifest dosya adı ve hata
kodu ekrana çıkmaz. Preset seçici duyulamayan bir preset'i sıradan bir
seçenek gibi sunmaz, ama track'in **zaten taşıdığı** değeri listeden düşürmez:
düşürmek, kontrolün başka bir preset göstermesine ve formdaki ilk tuş
vuruşunun o başka preset'i şarkıya yazmasına yol açardı.

**§4 Paylaşılan preview bank.** Bir dinleme bütün bir motor kurar, tek akor
çalar ve motoru atar. Şekil doğrudur — önizleme *çalmanın kendisidir* — ama
çözülmüş bank motorla birlikte ölüyordu ve sonraki dinleme aynı yedi dosyayı
yeniden indirip çözüyordu. `getOrLoad(context, bankKey, load)` tek yükleme
kapısıdır: uçuştaki iki çağrı tek fetch/tek decode/tek promise üretir,
başarısız yükleme **hatırlanmaz** (önbelleğe alınmış bir red, tek kötü ağ
anını oturum boyunca çalınamayan bir preset'e çevirirdi) ve kimlik üzerinden
korunur, böylece yerine geçmiş bir yeniden deneme eskisinin hatasıyla
düşürülmez. **Retention** context başına açılır: son tüketici bırakınca bank
dispose edilmek yerine retention'a geçer ve retention kapanınca ölür. Offline
render retention açmaz; export bank'lerini context'iyle birlikte yıkar.

**Kapanışta bulunan gerçek üretim hatası:** retention `this.disposed`
kontrolünden *sonra* açılıyordu. Okur bir sonraki kartı pack yüklenmeden çok
önce basar, yani motorların çoğu buraya zaten terk edilmiş gelir; onlar
bank'lerini kimse tutmadan bırakıyordu ve 25 dinleme hâlâ 175 istek
çıkarıyordu. Sıra düzeltildi ve sırayı geri alan bir birim testiyle bağlandı.

**§5 Seviye ve kırpma yalnız ölçüldü.** `HEADROOM.json` dört kazanç
yaklaşımını yalnızca eval tarafında, render edilmiş float'lar üzerinde
karşılaştırır. **Production'a limiter veya normalizer eklenmedi.** Kodlayıcı
±1 dışını kırpmaya devam eder, ama artık **sessizce değil**: kaç örnek ve kaç
çerçeve kırpıldığı geri döner ve kullanıcıya karıştırıcıyı işaret eden bir
cümle gösterilir.

#### 2P-A — bend/slide ölçümü ve Expression Contract v2 tasarımı

**§6 Bu turda production migration yoktur.** Song Contract'taki on bir
artikülasyon değişmedi, `articulation` alanı tek olmaya devam ediyor, hiçbir
enum eklenmedi ve bugünkü bend/slide varsayılanları değişmedi. Üretilen şey
ölçüm, aday render'ları, kör adlandırılmış dinleme dosyaları ve bir **tasarım
belgesi**dir (`EXPRESSION-CONTRACT-V2.md`).

**§7 Beş hipotez varsayılmadı, tek tek sınandı.** İkisi doğrulandı: bugünkü
bend'in sorunu %22'lik yükseliş sabiti değil, **zorunlu sıfıra dönüş**tür
(hedefe 1,5 s'lik notanın %30'undan önce varıyor ve her zaman geri iniyor);
bugünkü slide **yalnız legato** taşır (hedef atak oranı 0,98, gerçek yeniden
vuruş 619) ve legato adayı bugünküyle bayt bayt aynıdır.

**§8 Rakip sınırı.** Beş resmî Songsterr/Guitar Pro adresinin hepsi bu
ortamdan 403 döndü. `referenceAudioAvailable: false` **ve**
`sourceTextAvailable: false`. Hiçbir davranış, eğri veya DSP sabiti hiçbir
rakibe atfedilmedi; hiçbir rakip sample'ı repoya veya artefakta kopyalanmadı;
binary inceleme, decompile veya ağ isteğinden URL ayıklama yapılmadı;
"reverse engineered" ifadesi hiçbir belgede aday için kullanılmadı ve testle
bağlandı.

**§9 Ölçüm aracının kendisi yanlış olabilir.** Bu turda beş **enstrüman
hatası** bulundu ve düzeltildi: AudioContext'i subclass eden sayaç Tone'un
decoder'ını bozup uydurma bir sonuç üretti (şeffaf `Proxy`'ye geçildi); F0
platosu iki kez seçim yanlılığıyla okundu (+208,9 ve +206,3 yerine bölgeyi
değerden bulup değeri bölgeden okuyunca +200,65); ölçüm penceresi sonraki
notayı yakalıyordu; mantıksal ses ile fiziksel kaynak ayrımı yapılmadığı için
shift adayı legato ile aynı maliyette görünüyordu; fret gürültüsü penceresi
patlamanın dışındaydı. **Bir iddia, hakkında olduğu artefakt üzerinde
ölçülmelidir** ve ölçen alet de kanıt ister.

**Kapsam dışı (yapılmadı):** Expression Contract v2 production migration'ı,
yeni articulation enum'ları, sweep/TechniqueSpan implementasyonu, global
mastering, ölçmeden limiter, harici sample indirme, rakip asset çıkarma,
64'lük grid, stem/MP3 export, fiziksel Android/iOS kabulü, insan dinlemesi
yapılmadan "müzikal olarak daha iyi" kararı.

---

### §13.24 Senkron çoklu-enstrüman görünümü, yazılabilir track ve mobil transport (§19 K-55)

Bu bölüm tek bir checkpoint'i (**2Q-A**) kaydeder ve üç ölçülmüş kusuru
kapatır: yeni bir track'e nota yazılamıyordu, 320 px'de transport'un bir
kontrolü ekranda yoktu, ve aynı zaman aralığındaki enstrümanlar birlikte
görülemiyordu.

#### §1 Eksik anahtar iki şey birden söyler

Song Contract'ta bir barın `slots` haritasında bir track anahtarının
**bulunmaması** iki ayrı cümledir: *"bu track burada sessiz"* (§5.5) **ve**
*"bu track bu barda yazılı değil"*. İkisi aynı veri şekliyle söylendiği için
yazma yolu ikincisini görüp reddediyordu; okur için sonuç, az önce kendi
kurduğu track'in hiçbir hücresine nota yazamamaktı
(`eval/multitrack/BASELINE.json`).

Song Contract'a **alan eklenmedi**. Ayrım şekilde yapılır ve tek bir modül
sahiplenir (`lib/song/track-lanes.ts`):

- **Eksik anahtar** — track bu barda yazılı değil. Taşıyan bir tie zincirini
  kırar (§5.5), arajman özetinde sessizdir ve dosyaya eksik olarak çıkar.
- **Açık boş şerit** — anahtar var, içi baştan sona `null` (davulda `[]`).
  Aynı sessizlik, aynı zincir kırılması, **ama yazılabilir bir yüzey**.

Bu ikisinin *sesi* aynıdır ve öyle kalmak zorundadır: `buildSongPlan`,
`buildNotatedPlan` ve `barTimeline` her iki şekil için bayt bayt aynı sonucu
üretir (`playback-parity.test.ts`), ifade planındaki onset sayısı eşittir ve
export/import ikisini de olduğu gibi taşır.

#### §2 Yeni track her barda yazılabilir

`create_track` artık şarkının **her barına** o track için boş şerit koyar.
Bar'ın kendi ölçü işareti ve ritim çözünürlüğü şeridin uzunluğunu belirler
(sabit değil), enstrüman kaydı şeklini belirler (davul `[]`, melodik `null`).
Tempo, bölüm, başka track'in içeriği, barın metrik bilgisi ve şarkı
meta verisi değişmez. İşlem idempotent'tir ve değiştirecek bir şey yoksa
**aynı nesneyi** döndürür.

Dosyadan gelen (legacy) bir şarkı **düzeltilmez**. Onun için ayrı bir yol
vardır: bir barda yazılı olmayan track'e ilk nota yazıldığında şerit ve nota
**tek aday, tek `applyEdit`, tek undo adımı** olarak yazılır. Nota reddedilirse
(perde aralık dışı, tel yok, zincir kırılıyor) aday bütünüyle atılır — geride
kimsenin istemediği boş şerit **kalmaz**. Sus, uzatma ve silme komutları şerit
materyalize **etmez**: yazılmamış bir barda susturulacak, uzatılacak veya
silinecek bir şey yoktur ve dürüst cevap rettir.

#### §3 Mobil transport: boşluk daralır, kontrol kaybolmaz

320×700'de kontrol satırı 355,7 px istiyordu, 320 px vardı; çalışma hızı
pill'inin 23,7 px'i workspace kabuğunun `overflow-hidden`'ı tarafından
kırpılıyordu — yani kontrol kaydırılarak ulaşılabilir değildi, **orada
değildi**. `globals.css`'e 360 px'lik bir kırılma noktası (`--breakpoint-xs`)
eklendi; 360 px altında satır boşlukları ve yatay dolgu daralır, çal düğmesi
komşularıyla aynı 44 px kareye iner. **Hiçbir kontrol kaldırılmadı, ikinci
satıra taşınmadı, ikinci yatay scroller açılmadı, overflow ile hiçbir şey
saklanmadı.** Sonuç: 307,7 / 320 px, kırpılan kontrol 0, 44 px altında hedef
0, body taşması 0 — Düzen, Tab ve Çoklu görünümlerinin üçünde ve sheet
açıkken de. 390×844 bire bir değişmedi.

Ölçülen pay küçüktür: **12,3 px**. Bu bir uyarıdır, teminat değil — büyük
sistem yazı tipi veya üç haneli bir yüzde onu yiyebilir.

#### §4 Çoklu görünüm — üçüncü yüzey

`WorkspaceView` artık üç değerlidir: **Düzen · Çoklu · Tab**. Çoklu görünüm
bir bölümün bütün enstrümanlarını dikey olarak yığar ve **tek zaman ekseni**
üzerine oturtur.

- **Tek yatay scroller.** Yüzeyde yatay kaydıran tam olarak bir eleman vardır
  ve bütün şeritler onun içindedir. Şeritler birbirini dinleyerek senkron
  kalmaz; senkron kalacak bir şey yoktur.
- **Tek zaman ekseni, yapısal olarak.** Ölçü işareti ve ritim **bara** aittir,
  dolayısıyla bir barda yazılı her track aynı slot sayısına sahiptir. Bar
  çizgileri aynı x'e bakımla değil **tanım gereği** düşer; eksen bölümden bir
  kez hesaplanır (`lib/multitrack/geometry.ts`). Karışık grid ve karışık ölçü
  işaretinde de bütün şeritlerin bar çizgileri aynı global tick'te hizalıdır.
- **Tek playhead, tek animasyon karesi.** Bütün şeritleri kesen tek bir sütun,
  uygulamanın tek `runPlayheadLoop`'u üzerinden transform ile hareket eder.
  Beşinci enstrüman ek bir geri çağrı maliyeti getirmez. Transport bu bölümün
  dışındaysa sütun **çizilmez** — kenara sabitlenmiş bir çizgi doğru olmayan
  bir iddiadır.
- **Bar genişliği slot sayısından gelir**, tick süresinden değil. Bu bilinçli
  bir okunabilirlik kararıdır (tick oranlı genişlik 1/32'lik bir barı okunamaz
  yapardı); barın tick süresi yine de modelde taşınır, böylece kural tek bir
  yerde değişebilir.
- **Şerit türü enstrümanın kendi olgusudur** (`lane-kind.ts`): fretboard'u
  olan **fretted**, kit **drums**, fretboard'u olmayan melodik enstrüman
  **pitched**. Pitched şeritte **tel ve perde uydurulmaz**; nota adı ve süresi
  çizilir. Bu bir piyano notasyonu değildir ve öyle sunulmaz.
- **Sessiz track listeden düşmez.** Kayıt sırası korunur; bu bölümde hiçbir
  şey yazmayan track adıyla, enstrümanıyla ve ince ritim özetiyle durur.

#### §5 Tek aktif düzenleme track'i

Çoklu görünümde bir gesture yalnız **tek** bir şeridi değiştirebilir. Düzenleme
makinesi aktif şeride verilir ve başka hiçbirine verilmez — pasif şeridin
saygı göstermesi beklenen bir bayrak olarak değil, nesne orada **olmadığı**
için. Pasif şeritte uzun basış seçim açmaz, dokunuş nota yazmaz.

Bir şeride dokunmak yalnız onu **aktif düzenleme track'i** yapar: yatay konum,
çalma durumu ve bakılan bölüm değişmez, depoya hiçbir şey yazılmaz. Pasif
şeritteki bir notaya dokunmak önce o şeridi aktif eder; yazma ikinci
dokunuştur.

**Kapsam dışı:** track'ler arası seçim, tek komutla çok track'i değiştirme,
bu görünümde mikser (seviye/pan/sustur/tek dinle) kontrolü.

#### §6 Takip nezaketi tek bir yerde

Playhead'i takip etmek bir kolaylıktır ve kasıtlı bir eylemi geçersiz kılan
kolaylık rahatsızlıktır: okur elle kaydırdıysa görünüm onda kalır, `Çal`'a
basmak görünümü transport'a geri verir. Kural artık iki yüzeyde iki kopya
değil, tek modüldür (`use-scroll-takeover.ts`). Kapanışta bulunan gerçek kusur
buydu: bir şeridi aktif etmek yeniden render tetikliyor, döngü çalışmasa da
bir kez boyuyor ve o tek boyama okuru duraklamış playhead'e geri sürüklüyordu.

#### §7 Oturumluk görünüm durumu

Hangi görünümde olunduğu ve hangi şeritlerin katlandığı **oturumluk**tur:
Song'a, depoya, proje dosyasına, fingerprint'e ve Copilot isteğine girmez.
Bayat değer **okunduğu yerde** çözülür (2N-A §3'ün kuralı): başka projede
yapılmış katlama sayılmaz, silinmiş track'in katlanmışlığı katlanmışlık
değildir, yeni track açık gelir. Katlama, sekiz şeridin bir telefon ekranından
uzun olması sorununa verilen cevaptır — şerit listede kalır, notasyonunun
yüksekliğini geri verir.

#### §8 Ölçülen, uydurulmayan

Node (saf çekirdek) ve masaüstü Chromium — **telefon kanıtı değildir, eşik
uydurulmadı**. `eval/multitrack/artifacts/PERFORMANCE.json`.

**Kapsam dışı (yapılmadı):** production bend/slide davranışı, Expression
Contract v2 migration'ı, yeni articulation enum'ları, Song Contract'a görünüm
alanı, görünüm tercihinin proje dosyasına yazılması, 64'lük grid,
sweep/TechniqueSpan, ses motoru veya sample değişikliği, yeni scheduler,
şerit başına bağımsız yatay scroller, şerit başına rAF, ölçmeden
virtualization, ücretsiz/premium track sınırı, faturalandırma, sağlayıcı veya
Copilot API değişikliği, fiziksel Android/iOS kabulü.

#### Kapanış — Haktan onayladı, 25.08.2026

Onay anında doğru olan ve doğru kalması gereken olgular:

- Yeni track ilk notasını **atomik** biçimde kabul ediyor: şerit ve nota tek
  aday, tek yazım, tek undo adımı; ret hâlinde geride boş şerit kalmıyor.
- 320 px transport **bütün** kontrolleri gösteriyor: 307,7 / 320 px, kırpılan
  kontrol 0, 44 px altı hedef 0, body taşması 0.
- Çoklu görünüm tek yatay scroller, ortak zaman ekseni ve tek playhead altında
  **sekiz track'e kadar** birlikte okuma ve aktif track düzenleme sağlıyor.
- `songLimits.maxTracks` **8**'dir; bu checkpoint sınırı yükseltmedi.
- Davul ve pitched track'lerin **okuyucu** yüzeyi mevcut, fakat **nota girişi
  2Q-A'da tamamlanmadı**. Bu, 2Q-B'nin ürün kapsamıdır (§13.25).
- **Fiziksel Android/iOS kabulü yapılmadı**; bütün tarayıcı sayıları masaüstü
  Chromium'dur.
- Eski kabul harness'larının bir bölümü K-52 sonrası proje anahtarlarını
  okuyamadığı için baseline'da kırmızıydı. Bunun **ürün regresyonu olmadığı**
  ayrı bir worktree'de 2Q-A öncesi build derlenip aynı süitler çalıştırılarak
  kanıtlandı (skorlar bire bir aynı,
  `eval/multitrack/artifacts/REGRESSION.json`) — fakat **test borcu açık
  kaldı** ve 2Q-B'nin ön kapısıdır.

---

### §13.25 Enstrümanlar arası nota girişi ve kabul harness'larının yenilenmesi (§19 K-56)

Bu bölüm tek bir checkpoint'i (**2Q-B**) kaydeder. K-55'in kendi kapanışında
açıkça bıraktığı ürün boşluğunu — "davul için okur yüzeyli bir nota editörü
yoktur" — kapatır ve aynı boşluğun perdesiz enstrümanlardaki ikizini de
kapatır.

**Tek komut çekirdeği.** `lib/song/event-entry.ts` bir *anı* alır
(`{sectionId, trackId, ticks}`), bar ile slotu kendisi bulur ve **hiçbir şeyi
yuvarlamaz**: barın ızgarasına tam oturmayan bir tick reddedilir, çünkü
"yardımcı" bir kaydırma okurun çalmadığı müziği yazar. Negatif tick de
reddedilir ve bu kontrol tek başına iş görür: kesirli bir tick zaten hiçbir
slota tam bölünmez, NaN ve Infinity hiçbir barın içine düşmez, ama tam bölünen
bir negatif tick ikisinden de geçer. Her komut **bütün bir aday** kurar ve
tab'ın kullandığı aynı `settle` kapısından geçirir; reddedilen aday bütünüyle
atılır, dolayısıyla yolda serilmiş bir şerit okurun şarkısına ulaşmaz.
Refüzlerin cümleleri tek tabloda (`event-entry-messages.ts`) ve çekirdek o
tabloyu görmez.

**Davul: step grid.** Satırlar iki kaynaktan gelir ve üçüncü bir liste
uydurulmaz — şarkının o track'te *kullandığı* parçalar ve çekirdek setin
parçaları; sıra notasyon sırasıdır. Boş bir kitin de satırı vardır, yoksa ilk
vuruşun ineceği yer olmaz (K-55'in kapattığı kusurun aynı şekli). Bir dokunuş
bir komuttur: dolu hücre siler, boş hücre yazar, kararı son render'dan değil
şarkıdan sorar. Vuruş sertliği **Contract'ın kendi semantiğidir** — velocity +
`normal|ghost|accent` — ikinci bir ifade sistemi kurulmadı. Son vuruş
kalktığında **şerit yerinde kalır**: boşalan slot bir sustur, anahtarı düşürmek
"burada yazılı değil" demek olurdu.

**Perdesiz enstrüman: nota şeridi.** Piyano rulosu değildir ve olmadığını
söyler. Bir perdeli olmayan track için **dikey eksen yoktur**, çünkü bu
uygulamada hiçbir enstrümanın sayısal ses aralığı kayıtlı değildir (registry
tutmaz; perdeliler kendi akort ve perde sayılarından türetir, §9.1). Uydurulmuş
bir aralık, enstrümanın çalamayacağı notaları ekrana koymak olurdu. Bu yüzden
şerit **bir sıra andır**; hangi notanın oraya gideceği sorulur, tahmin
edilmez. Nota sayfası on iki nota + oktav adımlayıcısı sunar; adımlayıcının
sınırları **Song Contract'ın kendi grameridir** (-1..9), açıldığı oktav ise
şarkıdan okunur — önce bu track'in son notası, sonra şarkının herhangi bir
melodik notası, hiçbiri yoksa 4. Nota okunur dilde anlatılır ("Nota: La ·
Teknik: A3 · Oktav: 3") ve **enarmonik yeniden yazılmaz**: `Bb3` "Si bemol"dur,
"La diyez" değil. Yazılan notaya **tel/perde yazılmaz**; yazılamaz da, çünkü
yazacak bir klavye yoktur.

**Sesi olmayan enstrüman dürüstçe söylenir.** Perdesiz enstrümanların
hiçbirinin bu sürümde örneklem paketi yoktur. Sahte bir önizleme, sahte bir
örneklem veya başka bir enstrümanla ikame üretilmedi: Dinle **kapalıdır** ve
yanında tek cümle durur — *"Bu enstrümanın sesi bu sürümde bulunmuyor.
Notaları düzenleyebilir ve MIDI olarak dışa aktarabilirsin."* Aynı kural akor
kartlarındaki Dinle için de geçerlidir; şekiller yine seçilebilir ve
yazılabilir.

**Akor kurucusu perdesiz track'lere açıldı.** Klavye voicing'leri (kök pozisyon
ve çevrimleri) 2O-B'de zaten yazılmıştı; eksik olan tek şey kapıydı — kurucu
yalnız fret sheet'ten açılıyordu, o da fretboard'u olan enstrümanlarda. Akor
**gerçek nota olarak** yazılır, metadata olarak değil; `position` yazılmaz; "en
iyi çevrim" gibi bir etiket üretilmez. Oktav uydurulmaz, hedefle birlikte
taşınır.

**Erişim kapısı.** `editGate` artık enstrümana bakmaz. "Yalnız akordu olan
telli track'ler düzenlenebiliyor" cümlesi **doğru olmadığı için** kaldırıldı,
rahatsız ettiği için değil. Hangi yüzeyin cevap verdiği çizim katmanının
sorusudur; okurun yazıp yazamayacağı bu kapının, ve cevap artık ne çaldıklarına
bağlı değil. Düzenlemenin kapalı kaldığı iki gerçek sebep kaldı: oturum
kaydedemiyor, ya da ekranda bir Copilot önerisi var — ve ikincisi artık doğru
cümleyi gösteriyor (eskiden yanlış cümle geliyordu).

**Yeni track'te okur artık o track'te durur.** `create_track` sonrası aktif
track eskisi kalıyordu; yani "yeni davul → ilk vuruş" zinciri yanlış
enstrümana yazıyordu. `createdTrackId` iki şarkıyı **kimlikten** karşılaştırır
(sıradan değil — kopyalama ve yer değiştirme indeksleri kaydırır).

**Büyük yazı ayarı.** Transport'un dokunma hedefleri `rem` idi, yani okurun
metin ayarıyla büyüyordu: %150'de her kontrol 66 px oldu ve 320 px'lik ekranda
satır 460,6 px istedi — iki kontrol ekran dışında kaldı (ölçüldü). İki telefon
platformu da böyle yapmaz; 44 pt hedef 44 pt kalır, **yazı** büyür. Hedefler,
boşluklar ve dolgular piksele sabitlendi. 320 px'de %150'de satır **sarar** ve
bu dürüstçe raporlanır: kabul, tek satırlık olmayı değil **erişilebilirliği**
ölçer — hiçbir kontrol kırpılmıyor, gövde yatay taşmıyor, hepsi 44 px.
2Q-A'nın `--breakpoint-xs`'i bu düzenlemeyle kullanımsız kaldı ve kaldırıldı.

**Parite.** Elle yazılan ve komutla yazılan aynı müzik, kendisini okuyabilen
beş tüketicinin hepsinden aynı çıkar: Song'un baytları, history'nin `sameSong`
kararı, playback planı, MIDI planı ve proje dosyası. Bu paritenin bir sınırı
ölçülerek bulundu ve kayda geçti: iki şarkı da `songSchema.parse`'tan geçtiği
için **anahtar sırası hiç farklılaşamaz**; parite iddiası anahtar sırasına
değil, değerlere ve slot içi vuruş sırasına dayanır.

**Kabul harness'ları.** K-52'den beri eski proje anahtarını okuyan on harness
proje deposuna taşındı; ne senaryo silindi, ne beklenti gevşetildi, ne
`waitForTimeout` büyütüldü. Bu modernizasyon sırasında bulunan iki **production
kusuru** ayrı regresyon testleriyle önce kırmızıya bağlandı, sonra düzeltildi
(§19 K-56'da ayrı ayrı yazılıdır).

**Kapsam dışı:** sürekli kayan çalma yüzeyi (kendi görsel/performans kabulüyle
ayrı bir prompt'a bırakıldı), production bend/slide davranışı ve kör dinleme
paketi (dokunulmadı), piyano rulosu, mikser, DAW dönüşümü, perdesiz
enstrümanların lifecycle'a eklenmesi, ölçmeden virtualization, fiziksel
Android/iOS kabulü.

#### §13.25.1 Kapanış kaydı (K-56 — Haktan onayladı 25.08.2026)

Onay anında doğru olan olgular, sonraki checkpoint'lerin üzerine bina edeceği
hâliyle:

- Davul, **Tab ve Çoklu görünümün ikisinden de** gerçek step-grid komutlarıyla
  yazılabiliyor.
- Perdesiz/pitched track, gerçek `.aranje.json` **import yolu** üzerinden nota ve
  akor kabul ediyor — depoya elle yerleştirilmiş bir fixture üzerinden değil.
- Davul ve pitched giriş **aynı Event Entry komut çekirdeğini** kullanıyor.
- Başarılı bir yazım **tek active-project write ve tek history adımı**; preview,
  vazgeç ve reddedilen komut **sıfır yazım**.
- Büyük yazı ayarında transport kontrollerinin hepsi erişilebilir; `%150` metinde
  320 px yüzeyde satır **bilinçli olarak sarıyor** ve bu raporlanıyor.
- Sesi olmayan pitched track'e **sahte preview verilmiyor**; Dinle kapalı ve
  nedeni tek cümleyle yazılı.
- K-52 sonrası bayatlamış **on eski acceptance harness** güncel project storage
  sözleşmesine taşındı.
- **Fiziksel Android/iOS kabulü yapılmadı**; bütün tarayıcı sayıları masaüstü
  Chromium'dur.
- En yoğun davul yüzeyinde (8 bar × 1/32 = 1.024 hücre) bir dokunuş
  **103,6 ms medyan / 181,3 ms p95** ölçüldü. **Yatay windowing açık performans
  borcu olarak bırakıldı.**
- **Sürekli kayan playback takip modeli 2Q-B kapsamı dışında bırakıldı** ve
  2Q-C'nin konusu oldu.

### §13.26 Sürekli okuma yüzeyi v1 ve yatay windowing (§19 K-57)

Bu bölüm tek bir checkpoint'i (**2Q-C**) kaydeder. K-56'nın kapanış kaydında
açıkça bırakılan iki borcu kapatır: *"sürekli kayan playback takip modeli 2Q-B
kapsamı dışında bırakıldı"* ve *"yatay windowing açık performans borcu olarak
bırakıldı"*.

**Ölçülmüş kusur.** Önceki takip modeli — playhead görüş alanının rahat
bölgesindeyken hiç kaydırma yapma, çıkınca sıçra — aynı harness'la ölçüldü
(`eval/continuous-follow/BASELINE-STEADY.json`, HEAD `d89c193`): dört saniyelik
çalmada yüzey **355 karenin 4-23'ünde** hareket ediyor, geri kalanında duruyor
ve sonra tek karede **148-770 px** sıçrıyordu. Durduğu kareler tam da
playhead'in sağ kenara sürüklendiği kareler olduğu için, okurun önündeki boşluk
— çalarken işe yarayan tek kısım — sıçrama onu geri verene kadar sürekli
küçülüyordu. Tab'da playhead **9-24 karede hiç çizilmiyordu**, çünkü transport
bakılan bölümden çıktığında satır saklanıyordu.

**Okuma çapası.** Playhead ekranda sabit bir yer tutar ve müzik altından akar.
Kesir tek merkezî sabittir (`FOLLOW_ANCHOR_FRACTION = 0.32`,
`lib/ui/continuous-follow.ts`) ve hiçbir bileşen ikinci bir kopyasını tutamaz —
bu sözdizimi ağacından ölçülür, metinden değil. Formül tek satırdır:

    desiredScrollLeft = playheadContentX − viewportWidth × 0.32   (clamp'lı)

Şarkının başı ve sonu **ayrı kural değildir, clamp'ın kendisidir**: başta sola
kaydırılacak bir şey olmadığı için playhead ekranı normal biçimde geçer ve
çapaya vardığında yüzey hareket etmeye başlar; sonda aynısı tersine olur.
Kaydırma konumun fonksiyonu olduğu için birikip sıçramaya dönüşecek durum
yoktur, **seek ve loop wrap olduğu karede iner**, ve hiçbir yerde
`behavior: "smooth"` kullanılmaz — hâlâ hareket eden bir kaydırma bir konum
değildir. Şarkının sonunda son ölçünün de çapaya ulaşabilmesi için **müzikal
olmayan bir kuyruk** vardır: eksende yoktur, tick taşımaz, bar anahtarı yoktur,
export'a ve fingerprint'e giremez; yalnız kaydırılan bir div'in genişliğidir.

**Tek eksen.** `lib/tab/song-axis.ts` bütün şarkının tek yatay otoritesidir.
Bar genişliği **slot sayısı × slot genişliğidir**; tempo formülde geçmez, bir
`bpmOverride` çizimi değiştirmez, ve genişlik tick süresiyle orantılı değildir
(iki eşit süreli 1/8 ve 1/32 barı aynı genişliğe koymak 1/32'nin glifini dörtte
bire indirirdi). Eksik track anahtarı, baştan sona susan bir track, katlanmış
bir şerit ve şeridin hangi renderer'ı kullandığı ekseni değiştirmez. Bir x'in
hangi slotun *içinde* olduğu bir olgudur, hangisine *en yakın* olduğu bir
görüştür: `pointAtX` yuvarlamaz. Bu tur iki eski cevabı sildi —
`lib/multitrack/geometry.ts` (bölüm başına ayrı eksen) ve
`components/workspace/playhead.ts` (plandan yürüyen ikinci hesap).

**Yatay windowing.** `lib/ui/horizontal-window.ts` saf aritmetiktir: eksen artı
kaydırma konumu, hangi barların DOM'da olması gerektiğini verir.
`beforePx + renderedPx + afterPx` her konumda ekseni **tam olarak** verir —
`afterPx` çıkarmayla hesaplanır, çünkü yuvarlama farkı müzikle çelişen bir
`scrollWidth` demektir. Bar anahtarları kararlıdır; React yalnız çizilen aralık
değiştiğinde haber alır. **Yeni runtime dependency yoktur** (`react-window` ve
benzerleri kullanılmadı; pencere kırk satır aritmetiktir ve bir kütüphane kendi
"satır" tanımını getirirdi).

**Overscan varsayılmadı, ölçüldü.** `eval/continuous-follow/OVERSCAN.json` beş
adayı uygulamanın en kötü durumunda koşar (1/32, 260 BPM, %150 pratik hızı,
320 px, React commit'i 1 ve 2 kare gecikmeli, taban ölçümünden alınan 83,3
ms'lik takılan kareler dahil): `0+0` 7-60 boş kare, `0,25+0,25` fling'de 3-21
boş kare, `0,5+1` her satırda 0. En küçük temiz aday seçildi ve
`OVERSCAN_VIEWPORTS` odur. İlk iki aday kasıtlı olarak yetersizdir: hepsi geçen
bir ölçüm hiçbir şey ölçmemiştir.

**Bir yüzey, bütün şarkı.** Tab zaten bütün şarkıyı tek scroller'da çiziyordu;
Çoklu görünüm bölüm başınaydı ve **bölüm sınırında sıfırlanmasının sebebi
buydu** — yeni bölüm yeni model, yeni eksen, yeni scroll içeriği demekti.
`buildMultiTrackModel` artık bölüm argümanı almaz. Bölüm sınırı müzikte olduğu
şeydir: iki ölçü arasındaki çizgi. **Bakılan bölüm ile çalınan bölüm ayrı
kalır**, ama bakılan bölüm artık saklanan bir seçim değil bir kaydırma
konumudur ve yüzeyin sol kenarından okunur. Okur kendi eliyle başka bir bölüme
kaydırdığında bu açık bir olaydır (`scrolledToSection`) ve görüşü transport'tan
devralır.

**Playhead artık saklanmıyor.** Eski `playheadBelongsHere` kuralı, bir yüzeyin
tek bölüm çizmesinin sonucuydu: iki bölüm ötedeki playhead'in dürüst bir yeri
yoktu. Şimdi var; satır müziğin gerçekten olduğu yere çizilir ve okur başka
yere kaydırdıysa onu görmez — bu, gerçeğin kendisidir, gerçek hakkında bir
kural değil.

**Devralma ve geri dönüş.** Oturum durumu üç değerlidir (`following`,
`manual`, `reduced_motion`) ve **Song'a, depoya, dosyaya, fingerprint'e ve
Copilot'a girmez**. Devralan olaylar: tekerlek/dokunma/scrollbar, hücre veya
tutamağa inen parmak, bar işlemi, şarkıyı düzenleyen sheet'in açılması, okurun
kendi kaydırmasıyla bölüm değiştirmesi. Geri veren olaylar: çal, devam et,
açık **"Çalmaya dön"**, ve açık bir seek. **Yüzeyin kendi programatik
kaydırması devralma sayılmaz** — kendi yazdığı konumu geri okuduğunda tanır.
"Çalmaya dön" ≥44×44'tür, transport satırında **değildir** (o satır 320 px'de
%150 metinde zaten sekiz kontrolle doludur) ve **playback tick'ine dokunmaz**:
görüşü taşır, müziği değil.

**Azaltılmış hareket.** `prefers-reduced-motion: reduce` gerçekten okunur
(`matchMedia`, ayrı kabul koşusu). O modda kare başına kaydırma yoktur ve ikinci
bir rAF açılmaz; yüzey playhead ekranı terk etmek üzereyken **tek hamlede**
yetişir ve hamle onu tam da sürekli takip eden bir yüzeyin tutacağı yere koyar.
"Hiç kaydırma" seçilmedi, çünkü o playhead'in ekrandan çıkması demek olurdu.

**Etkileşim windowing'den etkilenmez.** DOM bir çizimdir, kaynak değildir: her
jest eksene karşı çözülür, her komut barı **anahtarla** ve slotu **indeksle**
adlandırır, ve ikisi de şarkının olgusudur. Bölüm navigasyonu artık
`querySelector([data-bar-key])` kullanmaz — mount edilmemiş bir barı bulamaz ve
sessizce hiçbir şey yapmazdı; `xAtBarKey` her bar için cevap verir. Nota/vuruş
girişi, seçim, zincir preflight, bar işlemleri ve export bu turda anlamca
değişmedi ve bayt bayt bağlandı.

**Kabul koşusunda bulunan production kusuru.** İlk tarayıcı turunda bir bölüm
sıçraması üç konumdan geçiyordu: `4635 → 2754 → 16`. İkincisi doğru hedefti,
üçüncüsü onu geri alan şeydi. Sebep, "bir barı görüşe getir" isteğinin tek
çeşit sanılmasıydı: yüzey her böyle isteği açık bir seek gibi ele alıp görüşü
transport'a geri veriyordu, ve duraklamış playhead şarkının başında olduğu için
bir sonraki boyama okuru oraya sürüklüyordu — 2Q-A'nın "defect C"sinin aynısı,
yeni bir kapıdan. **Bir bar'a dokunmak ile bir bölüm seçmek aynı şey değildir:**
ilki *transport'u* da taşır, ikincisi yalnız *görüşü*. İstek artık hangisi
olduğunu taşıyor (`pendingScroll.follows`) ve yalnız birincisi takibi geri
veriyor. Kusur önce tarayıcı senaryosuyla kırmızıya bağlandı; senaryo "ara
konumdan geçmiyor" diye ölçer, çünkü bir sıçramayı bir animasyondan ayıran şey
budur.

**Yazma yüzeyi bilerek windowed değildir.** Silahlanmış davul step grid'i ve
perdesiz nota şeridi bir *bölümü* bütünüyle çizer ve o bölümün eksendeki kendi
x'ine yerleştirilir; slot sayıları paylaşıldığı için bar çizgileri yine her
şeritle aynı yere düşer. Bu bir okuma değil yazma yüzeyidir ve modeli bölüm
kapsamlıdır.

#### §13.26.1 Kapanış kaydı (K-57 — Haktan onayladı 25.08.2026)

Onay anında doğru olan olgular, sonraki checkpoint'lerin üzerine bina edeceği
hâliyle:

- Tab ve Çoklu **bütün şarkıyı tek yatay eksende** okuyor; iki yüzeyin de
  eksen, pencere, kaydırma hedefi ve kaydırma sahipliği tek modülden geliyor.
- Normal playback'te yüzey playhead'in **altından sürekli akıyor**; ölçülen
  hareket ~360 karenin 314-360'ında.
- Okuma çapası **`%32`**'dir ve tek merkezî sabittedir.
- Gelecek müzik için ekranın yaklaşık **`%68`**'i ayrılır.
- Bar ve section sınırındaki eski büyük sıçrama modeli **kaldırılmıştır**:
  kararlı en büyük sıçrama 148-770 px'den **7-17 px**'e indi, yarım ekrandan
  büyük kararlı sıçrama her satırda **0**.
- Bar-level **yatay windowing iki yüzeyde ortaktır**; window state Song'a,
  depoya, history'ye, fingerprint'e, Copilot'a ve export'a girmez.
- Overscan **ölçümle** seçildi: geriye `0,5 viewport`, ileri `1 viewport`.
- **Manuel gezinme playback'i durdurmaz.**
- **Bölüm seçimi seek değildir**; bara dokunmak açık seek'tir.
- **"Çalmaya dön"** playback konumuna geri bağlar; playback tick'ine dokunmaz,
  yazım üretmez, ≥44×44'tür ve transport satırında değildir.
- **Reduced-motion ayrı bir hareket sunumudur**, ikinci bir playback motoru
  değildir; aynı tick, aynı playhead, aynı tek rAF.
- **Yoğun davul step-grid maliyeti kapanmış sayılmaz:** sekiz track'lik
  fixture'da ölçülen yaklaşık **`100 ms median` / `153 ms p95`** duruyor.
  Maliyet komutta ya da takipte değil, bilerek windowed olmayan step grid'in
  kendisindedir ve 2R-A'nın konusudur.
- **Fiziksel Android/iOS kabulü yapılmamıştır**; bütün tarayıcı sayıları
  masaüstü Chromium'dur.

---

### §13.27 Pratik Döngüsü v1 ve Davul Izgarası Performans Kapanışı (§19 K-58)

**Ne olduğu.** Bir okur bir ölçüyü — ya da aynı bölümdeki bir ölçü aralığını —
seçip döngüye alır, isterse sayarak başlar, isterse hız kademeli yükselir.
Üçü de **yalnız bu oturum boyunca** vardır: Song Contract'a eklenmez, depoya
yazılmaz, proje dosyasına, export'a, fingerprint'e ve Copilot isteğine geçmez,
yenilemeden sonra yoktur.

#### §13.27.1 Üç giriş, tek kanonik aralık

`PracticeRange` bir bölümün içindeki tam ölçülerdir ve
`${sectionId}:${localBarIndex}` anahtarlarıyla tutulur. Üç kapı vardır ve üçü
de aynı `land()` fonksiyonundan geçer:

1. **Tek ölçü** — çalarken bulunulan ölçü.
2. **İki ölçü** — iki dokunuş, iki uçtan; **sıra fark etmez**, aradaki her
   ölçü döngüye girer.
3. **TimeSelection** — yalnız tam ölçü sınırlarındaysa. **Yuvarlama yok, snap
   yok**: ölçü ortasından başlayan bir seçim başka bir müziktir ve
   `requires_full_bars` ile adıyla reddedilir.

Bölüm sınırını aşan bir çift `different_sections` ile reddedilir: tempo ve
ölçü işareti bölüme aittir, iki bölümü kapsayan bir döngünün uzunluğu
nereden sorulduğuna göre değişirdi.

Zincir preflight **üç sonuç** verir ve fazlası yoktur: `no_chain_impact`,
`include_connection`, ya da red. Bağlantı bölüm sınırını aşıyorsa aralık
**fail-closed** üretilmez — genişletilemeyeceği bir kenarla teklif edilmez.
Okura gösterilen cümlelerde `hammer_on`, `pull_off`, tick ya da hata kodu
geçmez.

#### §13.27.2 Tek loop otoritesi, count-in ve kademeli hız

`PlaybackLoop` bir union'dır: `{ none | section | practice_range }`. Bölüm
döngüsü ve pratik aralığı **aynı anda etkin olamaz** ve hangisinin kazandığını
okur görür. Loop state undo/redo'ya, export'a, proje dosyasına, fingerprint'e
ve Copilot'a girmez.

**Count-in aralığın kendi ilk ölçüsünden sayılır.** Kapalı / 1 ölçü / 2 ölçü.
Kural `slotsPerFeltBeat`'tir ve ikinci bir kopyası yoktur: 6/8 ve 7/8 ikişer
hissedilen vuruş sayar. Şarkıya **ölçü eklenmez**, tick üretilmez, bar
numarası kaymaz. İptal beş kapıdan da tamdır: pause, başa dön, sheet kapanışı,
proje değişimi, dispose/unmount. Hızlı çift `play` ikinci bir count-in
kurmaz. **Hayalet playback yoktur.**

**Kademeli hız yalnız gerçek bir turda artar.** Başlangıç, hedef, artış ve
kaç turda bir — dördü de merkezî `progressiveRateLimits` içindedir. Her alanın
kendi aralığı vardır ve kontrol o aralığın ucunda **görünür biçimde kapanır**;
birleşim (hedef başlangıcın altında gibi) **clamp edilmez, adıyla reddedilir**.
Artış yalnız transport'un bildirdiği tamamlanmış turda olur: seek, pause ve
count-in tur saymaz. Otomasyonun uğradığı her hız, manuel kontrolün de
basabildiği bir kademedir. Okurun eli her zaman kazanır ve otomasyon
kendiliğinden geri dönmez. **Uygulama çalımı dinlemez** ve bunu kendi
cümlesiyle söyler; mikrofon yoktur, doğruluk puanı yoktur.

**Drill'in çaldığı tempo diske yazılmaz.** Kayıtlı `practiceRatePercent` okurun
kendi seçimidir; drill ondan geçici bir sapmadır ve transport'a doğrudan
verilir. Uygulamayı drill'in ortasında kapatan okur, ertesi gün hiç seçmediği
bir `%85` ile karşılaşmaz.

#### §13.27.3 PracticeSheet ve aktif banner

Transport'ta yalnız tek bir 44×44 kapı ve anlaşılır bir aktif durum vardır;
ayarlar sheet'tedir: çalışma alanı özeti, aralık kaynağı, sayım (Kapalı/1/2),
hız modu (Sabit/Kademeli), başlangıç, hedef, artış, kaç turda bir, Uygula,
Vazgeç, aktif aralığı kapat. "Sabit"te dört sayı kısılmaz, **hiç yoktur**:
görünüp hiçbir şey yapmayan kontrol, ekranın tutmadığı bir sözdür. Vazgeç,
backdrop ve **Escape** tek bir temizlik yolundan geçer. Aktif banner kısa ve
dürüsttür (`Pratik · 4 ölçü · %70→%100 · 2 turda bir +%5 · 1 ölçü sayım`),
kırpılmaz, gerekirse iki satır olur.

#### §13.27.4 Davul ızgarası: kanonik eksen ve ölçülmüş kusurlar

Silahlanmış kit, okuma penceresinin spacer'larının **yerine** çizilir, yanına
değil. Toplam yüzey genişliği `axis + gutter + reading tail`'dir; kaydırma
konumundan ve mount edilen ölçü sayısından bağımsızdır. `buildDrumStepModel`
artık `{ song, sectionId, trackId }` alır ve bilinmeyen bölüm ya da track için
**null** döner — başka bir bölümün müziğini asla.

#### §13.27.5 Kapanış kaydı (K-58 — Haktan onayladı 25.08.2026)

Onaylanan olgular:

- **Practice Loop v1 tamamlandı**: üç giriş, üç-sonuçlu preflight, typed
  `PlaybackLoop`, karşılıklı dışlama.
- **Count-in ve kademeli hız session-only çalışıyor**; şarkıya ölçü eklenmiyor,
  beş iptal kapısı da tam, hayalet playback yok.
- **Davul time-column windowing kanonik axis'i koruyarak DOM yoğunluğunu
  düşürdü**: `1.792` hücrelik ızgaradan bir anda en çok **`210`** hücre mount
  ediliyor, silahlanmış yüzeyin DOM'u `443` → `277` düğüm.
- **Gerçekçi median hedefi geçti**: `31,0-31,8 ms` (hedef `≤33 ms`).
- **Gerçekçi p95 kapanmış sayılmadı**: altı uzun koşuda `32,0-49,8 ms`, en
  kötüsünde hedefin yalnız `0,2 ms` altında; daha önceki 24 turluk bir koşuda
  `57,3 ms`. Kuyruğun kök nedeni **bilinmiyor**.
- **Contract-ceiling edit latency açık borç:** son temiz koşuda medyan
  `96,5-100,3 ms`, makine yüklüyken alınmış daha önceki bir koşuda `~131 ms`.
  Her iki sayı da gerçekçi şarkının üç katından fazla ve hedefsizdir.
- **Fiziksel Android/iOS kabulü yapılmadı.**
- **`320 px` EditToolbar taşması** (`326/320 px`) bu fazın kapsamı dışında
  ölçüldü ve **ayrı bir ürün kusuru olarak açık kaldı**.

**Karar (K-58 kapanışı):** «Haktan onayladı 25.08.2026. Pratik Döngüsü v1 teknik olarak kapandı. Gerçekçi medyan 31,8 ms ile hedefi geçti; p95 güvenlik payı kapanmış sayılmadı. Contract-ceiling düzenleme gecikmesi temiz koşuda 96,5–100,3 ms, yüklü ortamda yaklaşık 131 ms olarak açık performans borcudur. Fiziksel cihaz kanıtı yoktur. 320 px EditToolbar taşması ayrı ürün kusuru olarak açıktır.»

### §13.28 Intent-First Composer Tools v1 · Tab Görsel Dili ve Playback Doğruluğu (§19 K-59)

Nota okumayı bilmeyen birinin kafasındaki müziği şarkıya koyabilmesi için,
mevcut düzenleme çekirdeğinin **üstüne** bir niyet katmanı kuruldu. Altındaki
hiçbir komut yeniden yazılmadı: kalem `applyChordWrite`'a, fırça mevcut
articulation semantiğine, devam ettirme `repeat_selection` /
`translate_fret_shape` / `transpose_pitch`'e gider. Yeni olan, bir dokunuşun
**ne demek istediğini** merkezî olarak bilen tek bir modeldir.

#### §13.28.1 Bağlı notanın perdesi, indiği notaya sığar

Bildirilen kusur «1/32'de bazı notalar duyulmuyor» idi. Katman katman ölçüldü
ve **düşen bir nota bulunamadı**: her onset planlanıyor, zamanlanıyor,
tetikleniyor ve hem offline hem canlı hem uygulamada duyuluyor (1/32'de de
1/16'da da `13` buffer başlıyor). Bu olumsuz sonuç gizlenmedi.

Yeniden üretilen gerçek kusur başkaydı: **bir parmağın inişi sabit süreliydi.**
`hammer_on` `22 ms`, `pull_off` `28 ms` — ızgara ne olursa olsun, tempo ne
olursa olsun. 1/8'de `132 BPM`'de hedef perde `180,3 ms` duyulurken, 1/32'de
`24,1 ms`, ve **1/32 · 260 BPM'de `0,0 ms`**: ses, perde varmadan kesiliyordu.
Ölçülen sapma `49,0 cent` — yazılan nota değil, ona doğru giden bir bükülme.

Slide bu soruyu zaten soruyordu (`glideFor` yolculuğu kalan yere sığdırır).
Aynı soru diğer ikisine de soruldu: `expressionPresets.legato.maxTravelFraction
= 0.4`. Yolculuk, **indiği notanın kendi süresinin** en çok %40'ını alır.

- Yazılan hiçbir şey değişmedi: onset da, süre de, tick de aynı. `1/32` ızgara
  kabalaştırılmadı, hiçbir nota başka yuvaya yuvarlanmadı, BPM ve pratik hızı
  değişmedi, kısa notalara keyfî bir asgari süre verilmedi, tekrar eden perde
  «duyulmaz» diye atılmadı, pull-off sıradan bir atağa çevrilmedi.
- **Production bend/slide eğrilerine dokunulmadı.** Değişen tek dal `glideSeconds
  === null` olan dal — yani hammer-on ve pull-off — ve pull-off'un parmak
  tıkırtısının kendi notasının içinde kalması.
- Ölçülen sonuç (aynı harness, aynı fixture'lar): `1/32 · 260`'ta hedef perde
  `0,0 → 15,9 ms` duyuluyor ve sapma `49,0 → 21,1 cent`. Yeri zaten bol olan
  hiçbir durum değişmedi: `1/8 · 132`, `1/16 · 132` ve `1/32 · 40` hâlâ tam
  preset süresini alıyor.
- WAV ve export davranışı **bilerek** değişir, çünkü dosya playback'in okuduğu
  aynı plandan render edilir. Değişmeyeni parite testi tutuyor: yazılan skor
  ve dosyanın uzunluğu aynı (`renderDuration(...).expressionSeconds === 0`).

#### §13.28.2 Tab: çizgi üstünde bir sayı, kart değil

Perde rakamları kart gibi duruyordu: her rakam `13,23 × 12 px` dolgulu bir
dikdörtgenin üstünde oturuyor, tel çizgisi **kutunun** kenarında bitiyordu.
Tab bunun tersidir — altı çizgi, ve üstlerine yazılmış sayılar.

- Rakamın kendisinde **dolgu, kenarlık, köşe yarıçapı ve gölge yoktur**.
  Telin kesintisi ayrı bir elemandır ve genişliği basamak sayısına göre
  hesaplanır (`maskWidthFor`), çünkü sabit bir boşluk `7`'yi kutulu, `12`'yi
  sıkışık gösterir.
- Tek ve çift basamaklı perdeler aynı yuva merkezine göre optik olarak
  ortalanır; rakamlar `tabular-nums`, böylece bir akor dikey hizalanır.
- Boş tel `0` yazılır ve **"Boş tel"** diye okunur; iki basamaklı ve
  kapo-göreli perdeler tek sistemdedir.
- **Dokunma hedefi görsel kutu değildir.** Hücre kendi ≥`44×44 px` kutusudur;
  rakam `44 px`'lik bir kareye boyanmaz — altı telin arası düzenlemede `44 px`
  olduğu için o kare komşularını örterdi.
- Yedi durum vardır ve her biri **renkten başka bir şeyle** de söylenir:
  normal (işaretsiz), seçili (altı çizili), hayalet önizleme (noktalı çerçeve),
  çalan onset (üstte küçük ok), uzatma (kısa bağ çizgisi), HO/PO ucu (altı
  çizili) ve reddedilen komut (üstü çizili).
- Çalan onset'i **React sahiplenmez**: `data-playing` niteliği tek rAF
  döngüsünden yazılır (2Q-C), böylece her karede tab yeniden render edilmez.
- Beam'ler telin altındadır: 1/32 üç çizgi alır, çizgi rakamdan daha
  hafiftir, sus grubu böler, ölçü çizgisini aşmaz.
- HO/PO yayları telin üstündedir, `H`/`P` harfini taşır, art arda gelen yaylar
  **dönüşümlü yükselir** ki bir koşu tek kapsül gibi okunmasın, ve katman
  hiçbir pointer olayı almaz. Yön **duyulan perdeden** okunur, perde
  numarasından değil.
- Ekran okuyucu müzik konuşur: «7. perde», «8. perdeden 7. perdeye koparma».
  `hammer_on`, `pull_off`, tick, yuva numarası ve tanılama arayüze çıkmaz.

#### §13.28.3 Dört kapı: Nota · Şekil · Ritim · Bağla

Oturumluk, tipli tek bir `ComposerTool` vardır (`note` | `power_chord` |
`connect` | `continue_pattern`). Song'a, depoya, proje dosyasına, fingerprint'e
ve Copilot isteğine **girmez**; yenilemede kaybolur; track, bölüm ve proje
değişiminde bırakılır; undo/redo'nun parçası değildir. Aynı anda **tam olarak
bir** araç tutulur, ve tutulan aracı yeniden seçmek onu bırakmaktır — okurun
çıkamayacağı bir durum yoktur.

- **Şekil → Power chord → 2 ses / 3 ses.** Kök teline ve perdesine dokunulur,
  hayalet görünür, uygulanır, **kalem elde kalır.** 2 ses kök + beşli, 3 ses
  buna oktav ekler; kök her zaman **en pes duyulan nota**dır ve parmağın
  olduğu yerdir. Tek onset grubudur, varsayılan velocity mevcut nota girişi
  kaynağından gelir, pozisyon açıkça yazılır, kapo-göreli semantik korunur,
  Drop D ve alternatif akortlarda ve baste çalışır. Davul ve armonik olmayan
  track tipli bir redle karşılanır; perdesiz track'e sahte perde şekli
  yazılmaz.
- Dolu bir vuruşta iki açık kapı vardır: **Vazgeç** ya da **Bu vuruşu power
  chord ile değiştir**. Değiştirme onset grubunun bütününü değiştirir ve
  **sonraki vuruşa dokunmaz**.
- **Bağla → Otomatik / Çekiç / Koparma.** İlk notaya uzun basılır, tek track
  içinde sürüklenir. Otomatik, **duyulan perdeden** karar verir: yükseliyorsa
  hammer-on, düşüyorsa pull-off, aynıysa tipli red. Açık bir seçim yönü
  tutmuyorsa reddedilir — sessiz bir geri düşüş yoktur. v1 tek track, tek
  bölüm, çok ölçü, karışık ızgara, **tam tick**, tek telde monofonik ve en az
  iki notadır; akordan akora, teller arası ve bölüm sınırı kapsam dışıdır.
  **Hepsi ya da hiçbiri:** beş notanın bir bağı bozuksa hiçbiri yazılmaz.
- **Seçim eylemi → "Bu deseni devam ettir".** Gam farkında değildir ve
  "gamı tamamla" değildir. Üç seçenek: aynen tekrar, aynı şekli taşı, aynı
  perdeyi taşı — ve tekrar sayısını, yönü ve deltayı okur seçer. Hiçbir
  seçenek "en iyi", "önerilen", "gama uygun" ya da "doğru" diye
  etiketlenmez. Seçimin `widthTicks`'i susları da taşır; offset, süre,
  velocity ve içerideki articulation korunur. Sığmıyorsa
  `target_grid_incompatible`, çakışma varsa **bütünü** reddedilir, bölüm
  sonunu aşmak tipli bir red ya da okurun açıkça istediği "sığdığı kadar"
  ister — sessiz kırpma yoktur. En çok üç hayalet kart çizilir ve her kart
  gerçek komutun gerçek sonucudur; **sıfır sağlayıcı çağrısı** yapılır.

#### §13.28.3b Focused Edit Layout: hedef değil çevre geri çekilir

`44 px`'lik düzenleme satırı ile `320×700`'ün aritmetiği kapanmıyordu. Altı
tel × `44 px` + ölçü başlığı = `286 px`; okuma chrome'u ayaktayken yüzey
`219–249 px`, seçim eylem çubuğu da açıkken **`44 px`**. Ölçülen sonuç:
düzenleme ızgarası yüzeyin dışına çıkıyor (`hücre y=423`, `yüzey sonu
y=402`), dokunuş track kontrol satırına gidiyor, zaman seçimi hiç açılmıyor.

**Karar.** Okuma modu `360 px` altında yoğun kalabilir. **Düzenleme modunda
bütün etkileşim satırları en az `44 px`'tir** ve aritmetik kapanmıyorsa
küçültülecek olan dokunma hedefi değil, çevredir.

Düzenlemeye girildiğinde:

- marka/şarkı başlığı, görünüm anahtarı ve geniş bölüm navigasyonu geri
  çekilir;
- yerlerine tek kompakt satır gelir: **"Bitti · Ana Riff · 12. ölçü"**;
- satırın ve "Bitti"nin yüksekliği en az `44 px`, "Bitti" gerçek kontrol;
- ölçü numarası şarkı boyunca sayılır; bakılan bölümün dışındaki bir odak
  için **numara verilmez** — yanlış müziğe ait doğru bir sayı, sayısızlıktan
  kötüdür;
- uzun bölüm adı ekranda kırpılabilir, erişilebilir ad tam kalır;
- staff kendi içinde dikey scroll almaz, altı tel aynı anda görünür;
- **dört niyet kapısı geri çekilmez.** İlk çözüm buydu ve yanlıştı: Legato
  Fırçası seçili bir koşu üzerinde kullanılır, dolayısıyla "Bağla" kapısı
  tam seçim varken erişilebilir olmak zorundadır. Yer, yazarken kullanılmayan
  chrome'dan gelir — kapılardan değil;
- transport korunur; düzenlemeden çıkınca normal chrome geri döner.

Bu state oturumluktur: Song'a, depoya, proje dosyasına, history'ye,
fingerprint'e ve Copilot payload'una girmez.

**Kabul ölçümü buna göre değiştirildi.** `getBoundingClientRect().height >=
44` tek başına iddia değildir; her hücre için *görünür* yükseklik (her
scroller ve viewport ile kırpılmış), `elementFromPoint` ile gerçek hit
sahibi, komşu tellerin çakışmaması, dış iki telin bütünlüğü ve staff içi
scroller olmaması ölçülür.

#### §13.28.4 Atomiklik ve sınırlar

- Başarı: aktif projeye **tam 1** `setItem`, katalog `0`, başka proje `0`,
  **tam 1** geçmiş adımı. Başarısızlık: `0` yazma, `0` geçmiş, bayt-eş Song,
  ham tanılama yok. Önizleme: `0` depo, `0` geçmiş, çalma durmaz, ikinci
  AudioContext açılmaz, fingerprint değişmez, Copilot çağrılmaz.
- **Bir jest bir adımdır**: power chord bir adım, beş notalık fırça bir adım,
  devam ettirme kaç kopya olursa olsun bir adım.
- Yeni alan adı davranış `Workspace.tsx`'te ya da bir `.tsx` handler'ında
  hesaplanmaz. Saf çekirdekler React, Tone, `@/components/**` ve DOM
  global'i görmez; tek istisna adıyla yazılıdır (`@/lib/audio/schedule`, bir
  notanın yazılırken aldığı velocity'nin **zaten** yaşadığı yer).
- Satır bütçeleri yükseltilmedi: `Workspace.tsx` `377 → 366`,
  `ArrangementCanvas.tsx` `470 → 470`, `TabCanvas.tsx` `472 → 452`. Bağlama,
  bütçeyle değil davranış koruyan üç ayrıştırmayla ödendi.

#### §13.28.6 Kapanış turu: bir güncelleme tek bir şey söyler

**Perde güncellemesi articulation'ı silemez.** `set_note` notayı komuttan
sıfırdan kuruyordu; komutun taşımadığı her alan — articulation da, velocity de
— kayboluyordu. Legato Fırçası ile yazılan bir zincirin bir perdesini
değiştirmek bağlantıyı sessizce yok ediyordu.

Articulation artık **ayrık bir patch** ile geliyor:

- `{ kind: "keep" }` — varsayılan; kullanıcı yalnız perde/tel/velocity/süre
  değiştirdiyse ifade korunur;
- `{ kind: "set", articulation }` — açıkça başka bir değer;
- `{ kind: "clear" }` — açıkça kaldır.

`undefined` artık «söylenmedi» demektir ve «söylenmedi» **koru** demektir.
İkinci bir note command yazılmadı.

**Bağlantı yaşayamıyorsa güncelleme atomik reddedilir.** Karar otoritesi
articulation validator'ıdır — renderer ve player'ın da uyduğu tek otorite —
fakat onun cevabı bir *uyarıdır* («normal çalınacak»), ki bu öyle gelmiş bir
şarkı için doğru, az önce bunu kıran bir düzenleme için yanlıştır. Bu yüzden
kapı **farktır**: düzenlemeden önce çalan bir bağlantı sonra çalmıyorsa
`articulation_conflict` döner, Song bayt-eş kalır, storage ve history 0'dır.
Zaten kırık gelmiş bir bağlantı sahibini kilitlemez.

Reddin metni müzikle konuşur ve hiçbir tanımlayıcı sızdırmaz.

**Bütçe, sağlayıcıdan önce ve tek adımda karar verir.** Rezervasyon zaten
adapter çağrısından önceydi ve `kv.transact` içinde atomikti; 200 kontrollü
koşuluk ölçüm bunu doğruladı ve «iki çağıran da sağlayıcıya gidiyor»
iddiasının gözlenen üç örneğinin **kazananın düzeltme turu** olduğunu
gösterdi. Değişen şey davranış değil, iddianın bağlanma biçimi: bariyer
artık rezervasyonun kendisinde, ilk rezervasyon ikincisi gelene kadar
tutuluyor. Fiyatlandırma, bütçe miktarı, entitlement, provider ve KV
mimarisi değişmedi.

**Focused Edit Layout'ta tutulan araç satır büyütmez.** `320×700`'de tutulan
araç çipi ikinci bir satır alıyor, `main` `357 → 307 px`'e düşüyor ve en
kalın tel `37 px`'e kırpılıyordu. Çip artık kapıların satırını paylaşır.

#### §13.28.5 Kapanışta açık kalanlar

- **`sus`, dead note, ghost note, muted strum ve vuruş yönü Song Contract'ta
  yoktur.** Sahte alan, sahte enum ve çalışmayan seçenek eklenmedi; teklif
  edilen sorumluluk katmanı, migration ihtiyacı ve çoklu-enstrüman etkisi
  `eval/intent-composer/EXPRESSION-GAPS.md`'de yazılıdır ve K-59'un açık
  devamıdır.
- **Perde yazma sheet'inin "Güncelle" düğmesi az önce seçilen articulation'ı
  siliyor** (baseline §D.1'de ölçüldü). Bu fazda kapatılmadı; ayrı bir ürün
  kusuru olarak açıktır.
- **Fiziksel Android/iOS kabulü yapılmadı.** Bütün sayılar masaüstü Node ve
  masaüstü Chromium'dandır.
- Bu katman **hiçbir müzikal öneri yapmaz.** Ne çalınacağına dair tek bir
  karar vermez; yalnız okurun söylediğini tam, atomik ve geri alınabilir bir
  komuta çevirir.

### §13.29 Score Truth v2 kullanıcı yüzeyi ve gitar performansı (Faz 2T)

Faz 2T'nin ölçüsü tek cümledir: **çekirdekte var fakat kullanıcı yüzeyinden
ulaşılamayan iş tamamlanmış sayılmaz.** Bu bölüm sözleşmenin nereye
taşındığını ve neyin ölçüldüğünü kaydeder; onay kaydı değildir.

#### §13.29.1 Song Contract v4

`SONG_VERSION = 4`, `READABLE_SONG_VERSIONS = [2, 3, 4]`. v4 tek bir şey
ekler: artikülasyon sözlüğü on birden **on altıya** çıktı — `ghost`, `dead`,
`tapping`, `natural_harmonic`, `pinch_harmonic`. Hiçbiri varsayılan değildir;
yokluğu, her zaman olduğu gibi, sıradan çalınan bir notadır. Bu yüzden v2 ve
v3 şarkılar tek bayt değişmeden okunur ve migration hiçbir notaya sahip
olmadığı bir artikülasyon vermez.

`letRing` ve `strum` bu listeye **girmez**. İkisi de atağın nasıl yapıldığını
değil, etrafında ne olduğunu söyler ve kendi alanlarında yaşarlar.

#### §13.29.2 Teknik matrisi — beş halka

`lib/song/technique-matrix.ts` her tekniği dört ailede (Bağlantı · Perde
hareketi · Vuruş · Tını ve süre) ve beş halkasıyla yazar: okur seçebilir,
tab çizer, şema saklar, undo geri alır, **playback ölçülebilir biçimde
ayrıştırır**. Yalnız glyph çizen bir özellik desteklenmiş sayılmaz; matrisin
yanındaki test her satır için bu zinciri yürür.

Notasyon tablatürün kendi geleneğidir: hayalet nota `(5)`, ölü nota `x`,
doğal armonik `<5>` — numaranın *üzerine*; tapping `T`, pinch armonik `PH`,
staccato `.`, uzatma `–` — numaranın *yanına*. Ekran okuyucu bu üçünün adını
ayrıca söyler.

Bir **strum** yazılı tek onset'tir ve el telleri geçerken çalınır: aşağı
vuruş en kalın telden, yukarı vuruş ince telden başlar, telden tele
`perStringSeconds` gecikmeyle, akorun süresine sığmayan yayılım
sıkıştırılarak. Skorda hiçbir şey değişmez — yayılım notanın yanında
taşınır, `timeTicks`'e katılmaz.

#### §13.29.3 Parmağın indiği an (§10 ölçümü)

Hammer-on ile pull-off arasındaki fark `6ded910` üzerinde ölçüldü ve
yetersiz bulundu: `1,72 dB` seviye farkı ve hammer-on tarafında **hiç
transient yok**. Pull-off'un 2F.1'den beri taşıdığı kısa tıkırtının eşi
hammer-on'a da verildi — daha kısık (`0.11`/`0.16`) ve daha mat
(`2000`/`4500 Hz`), çünkü parmak ucunun teli perdeye bastırması tırnağın
teli yandan koparmasıyla aynı ses değildir. İki hareketin telin enerjisine
yaptığı şey artık zıt yönde: `levelAfter` `0.92` / `0.72`.

Kabul eşikleri yamadan **önce** yazıldı ve işitmeye dayandırıldı
(`eval/guitar-performance/THRESHOLDS.md`); ölçüm, WAV'lar ve `6ded910`
baseline'ları aynı dizinde durur.

#### §13.29.4 Referans pasajları gerçek UI'dan yazılır

Üç referans pasajı (A senkoplu palm-mute double-stop, B pedal tel altında
hızlı legato, C altı telli çınlayan arpej) **boş bir projeden başlayarak**,
yalnız parmakla dokunulabilecek kontrollerle yazılabilir ve yazıldıklarında
kanonik repertuvarla müzikal parmak izi düzeyinde birebir aynıdır. Internal
command, debug handle, store injection ve fixture kısayolu bu ölçümde
yasaktır.

Bunun sonucu olarak referans pasajları yalnız uygulamanın yazabildiği
şeyleri içerir: nota velocity'si hiçbir kontrolden yazılamadığı için
fixture'lardan çıkarıldı.


### §13.30 UI Contract v1 ve editör parity omurgası (2U-A)

#### §13.30.1 UI Contract v1 geçicidir

`docs/UI-CONTRACT-v1.md` bir geliştirme dondurmasıdır, kalıcı bir tasarım
kararı değildir; editor parity tamamlandıktan sonra founder değerlendirmesiyle
değiştirilebilir. Dondurulan geometri `eval/ui-contract/GOLDEN.json` içinde
4 viewport × 8 durum olarak **ölçülüdür**, tarif edilmiş değildir.

Karşılaştırma piksel diff değildir: bir diff "herhangi bir piksel kımıldadı mı"
sorusunu yanıtlar, sözleşme ise parmağın güvendiği aritmetiği korur —
antialiasing farkı diff'i kırar, kutusu değişmeden kayan bir kontrol diff'ten
geçer. Staff sınırları, altı telin y'si, rakam merkezleri, `main` yüksekliği,
toolbar/transport sınırları, body taşması, 44px hedefler, etiket kırpılması ve
press sahipliği sayı olarak ölçülür.

#### §13.30.2 Seçim tek cümleyle tarif edilir

Üç seçim modeli (`Selection`, `TimeSelection`, `BarSelection`) şekillerini
korur; `selection-descriptor.ts` hepsine ortak bir tanım verir ve
`selection-capability.ts` "bu seçime ne yapılabilir" sorusunu **bir kez**
yanıtlar. Component'ler nota sayarak karar vermez.

Bir fiil ya sunulur ve çalışır, ya sebebiyle pasiftir, ya da hiç yoktur.
Dördüncü hâl — çizilen, basılan, sonra reddeden — yasaktır.

Olay kimliği pozisyoneldir: Song Contract'ın nota id'si yoktur, bir nota
konumudur. Pano id taşımaz ve paste id yeniden kullanmaz — bunlar hatırlanması
gereken kurallar değil, contract'tan düşen sonuçlardır. `NoteEvent`'e kalıcı
`id` eklemek tek yönlü bir kapıdır ve bu turda açılmamıştır.

#### §13.30.3 İki ölçü kapsamı asla karıştırılmaz

`full` (ölçü nesne olarak, bütün track'leriyle) ve `track` (tek enstrümanın
içeriği) descriptor'da `barScope` ile ayrılır. Tek track'li bir şarkıda ikisi
aynı notaları kapsar, yani track sayarak ayırt edilemezler — yalnız jest bilir.

Bölümün şeklini değiştiren fiiller — ölçü ekleme ve ölçü/ritim sayfası — tek
enstrüman seçiminde sebebiyle pasiftir. Silme, çoğaltma, tekrar ve taşımanın
dürüst bir tek-enstrüman anlamı vardır ve pasifleştirilmez.

#### §13.30.4 Bitişiklik ifade edilemezliktir

`BarSelection` bir başlangıç ve bir bitiş indeksidir; arada delik tutamaz.
Non-contiguous ölçü seçimi **reddedilen** değil **ifade edilemeyen** bir şeydir.

#### §13.30.5 Selection toolbar dondurulmuştur

`Bağla · Taşı · Devam · Daha fazla`. Uygulanmayan bir fiil satırdan düşürülmez,
sebebiyle grileşir; çekmece kısalabilir. "Taşı" sekiz hareket sunar ve sayı
`movement-menu.ts` tarafından tutulur. "Devam" seçimi ucundan uzatır: başlangıç
sabit, daraltmaya izin verilir, Song'a ve history'ye hiçbir şey yazılmaz.


### §13.31 Seçimi dinle ve seçimden döngü (2V-A)

#### §13.31.1 Dinleme bir plandır, ikinci bir çalar değil

`selection-playback.ts` saf bir çekirdektir: tipli `SelectionDescriptor`'ı
okur, gerçek başlangıç/bitiş tick'ini çözer, kapsamı bir track listesine
çevirir, çalınabilir onset olup olmadığını söyler ve gerekirse **tipli bir
ret** üretir. UI tick hesaplamaz, track filtrelemez, scheduler kararı vermez.

Motor tarafında değişen tek şey `ScheduleOptions`'a eklenen bir penceredir.
Ayrı bir preview synth yoktur; HO/PO, slide, bend, vibrato, palm mute ve strum
normal scheduler yolundan geçer. Seçim playback'i, aynı motorun **sınırlanmış
ve filtrelenmiş** bir kullanımıdır.

#### §13.31.2 Bölüm-göreli tick ile şarkı-mutlak tick

Descriptor tick'leri bölüm başından, transport tick'leri şarkı başından sayar.
İkisi yalnız ilk bölümde eşittir — yani tek bölümlü her fixture'ın geçireceği,
gerçek bir şarkıda yanlış yeri çalacak bir fark. Dönüştürmek planın işidir ve
fixture bu yüzden bilerek iki bölümlüdür.

#### §13.31.3 Duyulabilirlik descriptor'a değil, çalınacak plana sorulur

`SelectionDescriptor.onsetCount` yapı gereği melodiktir: `sectionSlotStream`
davul slot dizilerini `writable: false` işaretler, dolayısıyla davul dolu bir
ölçüde sıfırdır. Duyulabilirlik `buildNotatedPlan` üzerinden — motorun gerçekten
çalacağı şey üzerinden — hesaplanır. Karar çekmece **açılmadan önce** verilir;
basıldıktan sonra core'dan ret gelmez.

Nota fiilleri ile ölçü fiilleri artık ayrık kümeler **değildir** ve bu
kasıtlıdır: düzenleme fiilleri bir kapsama aittir, ama "bunu dinlet" tutulan ne
olursa olsun aynı sorudur.

#### §13.31.4 Sınır anlamı

Aralık yarı açıktır: `[startTick, endTick)`. Başlamadan önce başlamış bir nota
yapay atakla içeri sokulmaz. Sonu taşan bir nota **yalnız seste** sınırda
kesilir; Song event'inin yazılı süresi değişmez.

#### §13.31.5 Tek loop otoritesi

`PlaybackLoop` dördüncü bir varyant kazanır (`selection`) — ikinci bir loop
alanı değil. Seçim döngüsü bölüm/çalışma döngüsünün yerine geçer, yanında
çalışmaz. Şarkı değiştiğinde taşınmaz: o tick çifti artık var olmayan bir
müziğin üstüne çizilmişti.

#### §13.31.6 Bir koşu, başlatıldığı seçime aittir

İptal, yeniden çizim, enstrüman değişimi ve bölüm değişimi bir bileşenin
içinden dört ayrı state değişimi gibi görünür; teker teker ele alan bir hook
beşte dördünü ele alır. Soru ters çevrilir: *ne çalıyor, ve hâlâ seçili olan o
mu?* Görünümden çıkmak, düzenleyiciyi kapatmak, unmount, ses hatası ve abort
seçim değişimi değildir ve olduğu yerde karşılanır.

Motor kurulumu asenkron, iptaller senkrondur; uçuştaki bir başlatma bir token
ile iptal edilebilir olmalıdır, yoksa okuyucunun bıraktığı seçim bir an sonra
çalmaya başlar.

#### §13.31.7 Efemerlik ve onu ölçen alet

Dinleme ve döngü hiçbir command üretmez. Song baytları, proje kaydı revizyonu,
storage, history, undo/redo yığını ve pano değişmez.

Bu sıfırlar ancak onları ölçen aletin kımıldayabildiği gösterilirse bir şey
söyler. Kabul koşusu aynı oturumda gerçek bir düzenleme yapar, üç okumanın da
(bayt, revizyon, "Geri al") değişmesini şart koşar ve sonra geri alır. Yazma
saymak için `localStorage.setItem` sarmalamak bu rotada **yasaktır**: sayfa
kendi sahip olduğu bir `Map` kullanır ve o sayaç uygulama ne yaparsa yapsın
sıfır okur.


### §13.32 Kayıp «Devam» ve gerçek dinleme rotası (2V-A.1)

#### §13.32.1 Yetenek modeli sunuyorsa yüzey de çizmelidir

`selection-capability.ts` bir fiili `available` diye yanıtlıyorsa, o fiili
çizen **her** liste onu taşımalıdır. Sunulan ama çizilmeyen bir fiil, 2U-A
§3'ün yasakladığı dördüncü hâlin öteki yüzüdür: kullanıcı basamaz, kimse
reddetmez, ve hiçbir ekran neden olmadığını söylemez.

İki seçim eylem yüzeyi vardır — okuma yüzeyinin uzun çubuğu ve odaklı
düzenlemenin tek satırı — ve ikisi de aynı fonksiyona sorar
(`selectionOffers`). Sabit kodlanmış fiil listesi tutan bir yüzey, modelin
sesini duymayan bir yüzeydir.

#### §13.32.2 «Ne yapılabilir» sorusu düzenleme moduna bağlı değildir

Bir koşuya ne yapılabileceği müzikal bir sorudur; okuyucunun «Düzenle»ye
basmış olup olmaması cevabın parçası değildir. İkisini birbirine bağlamak,
bir yüzeyin diğerinin çizemediği bir şeyi sunmasına yol açar — kaybolan
«Devam» tam olarak buydu.

#### §13.32.3 Bir rehber, olmayan bir düğmeyi onaylayamamalıdır

`no_write` bekleyen bir adım, hiçbir şeye dokunmadan «Yaptım»a basan bir
okuyucu için de geçer: hiçbir şey yapmamak hiçbir şey yazmaz. Bu, rehberin
ekranda bulunmayan bir kontrolü onaylamasının yoludur ve olan da budur.

Bir adım, uygulamanın o basıştan sonra hangi durumda kaldığını sormalıdır.
«Devam» adımı artık `armed` bekler ve cevabı okuyucunun bastığı kontrolün
`aria-pressed`'inden alır.

#### §13.32.4 Dinleme testi kendi rotasıdır

`/eval/editor-acceptance` genel editör testidir. `/eval/selection-playback`
dinleme testidir: `noindex`, linkteki commit'e kapılı, izole bellek
deposunda, production Workspace ve production çekmecesiyle. Sekiz adım, her
ekranda tek görev, hiçbir adımda tick/slot/scope/scheduler geçmez.

Sayfanın kendi playback kontrolü **yoktur**; ilk ses okuyucunun production
çekmecesine dokunuşuyla başlar. Bir sınır testi bunu dosyadan okur.

#### §13.32.5 `touch=0` fiziksel PASS üretemez

Bu kural bir dipnot değil, bir fonksiyondur: `listeningVerdict` dokunma
noktası sıfır olan bir ortamda en fazla `PARTIAL` döner, her adım ne kadar
temiz koşmuş olursa olsun. Sonuç bloğu hangi ortamın cevapladığını kendi
satırında söyler.

Gerekçe ölçülmüştür: 2V-A'da dört yeşil masaüstü viewport'un bulamadığını bir
telefon bir dakikada buldu.


### §13.33 Selection Action Canon (2V-B)

#### §13.33.1 Aynı seçim için ikinci bir sabit liste yasaktır

Üç turda üst üste aynı kusur çıktı: yetenek modeli bir fiili sunuyor, çizen
sabit liste onu taşımıyor. 2U-B'de «Yapıştır», 2V-A.1'de «Devam», 2V-B'de her
iki dinleme fiili. Her seferinde düzeltme **bir listeye bir giriş eklemek**
oldu — ki bu bir düzeltme değil, sıradakini beklemektir.

Bir seçimin eylemleri artık **tek yerde** yanıtlanır:
`src/lib/song/selection-action-canon.ts`. Hangi eylemler vardır, okuyucunun
bulunduğu modda hangi yüzeye düşerler, canlı mıdırlar, değilse kullanıcıya
hangi Türkçe cümle gösterilir — hepsi burada.

Canon **ikinci bir yetenek modeli değildir.** Bir fiilin *uygulanabilir* olup
olmadığı hâlâ `selectionCapabilities`'in cevabıdır ve canon onu asla ezmez:
`hidden` bir fiil burada yoktur, `disabled` bir fiil modelin kendi cümlesini
kelimesi kelimesine taşır. Canon'un eklediği şey hiç yazılmamış olan yarıdır —
yerleşim, etiket ve hangi handler'ın çalışacağı.

**UI component'leri kendi eylem listelerini taşımaz.** Bir bileşenin kodunda
«Kopyala», «Seçimi dinle» ya da «Ölçüyü kaldır» yazması, o bileşenin yeniden
karar vermeye başladığı anlamına gelir; bir sınır testi bunu adıyla yasaklar.

#### §13.33.2 Dört yüzey, üç mod, tek cevap

`SelectionSurface`: `read_primary`, `edit_primary`, `more_sheet`,
`measure_primary`. `SelectionMode`: `read`, `edit`, `measure`. Modlar arasında
değişen tek şey bir eylemin **hangi listeye düştüğüdür** — var olup olmadığı
değil.

Satırlar UI Contract v1'in dondurduğu yerde donmuş kalır: okuma ızgarası sekiz
hedef ve dört sütun, compact satır `Bağla · Taşı · Devam · Daha fazla`, ölçü
satırı yedi hedef. Bir modun `primary` ve `sheet` listeleri **kesişmez**: bir
fiili aynı bağlamda iki kez çizmek, okuyucuya tek sonuç için iki kontrol
arasında seçim yaptırmaktır ve basmadığı, bastığı hakkında yanlış şey öğretir.

Bu yüzden okuma sheet'inde «Sil» yoktur: önündeki ızgarada zaten vardır. Bir
founder o kapıyı açtığında arkasında **yalnız** «Seçimi sil» buldu — ızgarada
olan fiilin tekrarı — ve rehberin istediği «Seçimi dinle» hiç yoktu.

#### §13.33.3 Yanlış yüzeyi ölçmek yeşil sayılmaz

2V-A kabulü «Daha fazla»yı bulup açtı ve iki dinleme fiilini gördü — ama
`toEditor()` önce «Düzenle»ye basıyordu, yani ölçtüğü sheet **compact satırın
çekmecesiydi.** 2V-A.1 kabulü kapının *varlığını* saydı, içeriğini hiç
açmadı. İkisi de 70/70 verdi ve ikisi de founder'ın açtığı yüzeyi hiç
görmedi.

Kural: bir kabul koşusu, kullanıcının gerçekten geçtiği yolu geçmelidir.
Gerçek pointer seçimi, ekranda görünen gerçek kapı, açılan gerçek sheet.
State inject etmek, bileşeni doğrudan mount etmek, gizli bir elemanı bulmak,
başka bir seçim türü kullanmak veya registry'de kayıtlı olmayı «kullanıcı
ulaşabilir» saymak — hiçbiri kanıt değildir.

#### §13.33.4 Çizilen her eylemin bir yeteneği ve bir handler'ı vardır

`available → rendered count === 1`, `disabled → rendered count ≤ 1`,
`rendered → handler exists`, `handler invoked → expected operation`, ve
desteklenen bir eylemin `rendered count === 0` olması FAIL'dir.

Bu tablo **testlerden üretilir**, elle doldurulmaz
(`eval/editor-2vb/artifacts/REACHABILITY.json`). Elle yazılan tablo koda dair
bir iddiadır; bu tablo kodun kendisidir, dolayısıyla canon'un yerleştirmediği
bir eylem için «rendered 1» yazamaz ve runner'ın case'i olmayan bir id için
«handler var» diyemez.

Ölçü satırı bu kuralla sınandığında **modelde bir boşluk** çıktı: yedi düğmenin
üçünün arkasında fiil vardı, dördünün hiçbiri yoktu — çünkü *ölçüleri*
kopyalamak, kesmek, tekrarlamak ve taşımak, aynı adı taşıyan nota fiillerinden
başka komutlardır. `copy_bar`, `cut_bar`, `repeat_bar` ve `move_bars`
eklendi; «Taşı» tek ölçülük bir bölümde artık **«Taşınacak yer yok.»** ile
grileşir, çünkü orada iki ölü ok açıyordu.

#### §13.33.5 Dinleme bir moda değil bir seçime aittir

`useCoveredRun` dinleme oturumunu artık *covered run'ın içinde* değil, onun
yanında döndürür ve **hangi seçim tutuluyorsa onu** tarif eder. Okuma
yüzeyinin dinleyecek bir şeyi olmamasının sebebi buydu: dinleme, düzenleme
modunun bir ayrıcalığı olarak bağlanmıştı.

Bir ölçü aralığı da dinlenebilir ve **kapsamı dürüstçe kullanır**:
«Bu enstrüman» plana tek track id taşır, «Tüm enstrümanlar» hepsini taşır —
`describeBarSelection`'ın kendi cevabı, bu dosyanın kapsamlardan haberi olması
gerekmeden.

#### §13.33.6 Founder'a artık her kusur için yeni link gönderilmez

`/eval/editor-action-batch?sha=<sha>` — `noindex`, linksiz, exact-SHA kapılı,
izole bellek deposu, gerçek Workspace ve gerçek seçim yüzeyleri. En fazla on
iki kısa ekran, ekran başına tek görev.

**İş bölümü sözleşmedir:** founder yalnız bir insanın bilebileceğini yanıtlar —
kulağa doğru geldi mi, kontrol adının söylediğini yaptı mı, bulması kolay
mıydı. Bayt, history ve storage bir insana sorulacak sorular değildir; sayfa
onları kendisi ölçer — proje kaydının baytları ve revizyonu, adım ekrandayken
örneklenerek. «Tek atomik yazma» ve «geri al bayt-eş döndü» bu izden
yargılanır.

Bunun sonucu, **hiçbir şey yapmadan «Sonraki»ye basmanın geçmemesidir:** iz tek
durumda kalır ve yazan adımlar düşer. Uygulanmamış bir yapıştırma ve hiçbir
şeye dokunulmadan onaylanan bir rehber adımı — ikisi de daha önce yeşil
raporlanmıştı — burada imkânsızdır.

`touch=0` fiziksel PASS üretemez; bu bir dipnot değil, `batchVerdict`'in bir
kuralıdır.


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

**Faz 2 sonrası kalan release kapıları (24.08.2026; ilk üçü K-51, dördüncüsü
K-52, beşincisi K-54 kapanışında kaydedildi).** **Beşi de** kod kapanışını
değil public release'i engeller:

- **Fiziksel Android/iOS ses ve etkileşim kabulü.** Bugüne kadarki bütün
  gecikme, frame ve ses ölçümleri masaüstü Node/Chromium'dur ve raporlarda
  telefon kanıtı olarak sunulmamıştır.
- **Resmî CC BY 3.0 US legalcode'unun vendor edilmesi ve checksum kaydı.**
  Ayrıntı ve beklenen dosya yolu `public/samples/licenses/OWNER-ACTION.md`'de;
  `textVendored:false` bu iş yapılana kadar öyle kalır (K-50).
- **Yoğun WAV export'un fiziksel cihazda süre ve bellek testi.** Masaüstünde
  yoğun fixture gerçek zamanın ~3,5 katında render ediliyor (K-50, 2M-A.1);
  telefonda ne olduğu ölçülmedi.

2O-A bu üç kapının hiçbirini kapatmaz ve dördüncüsünü ekler:

- **Cihazın gerçek proje kapasitesi.** Masaüstü Chromium bu profilde
  worst-case boyuttaki yalnızca 6 projeyi kabul etti (~4,5 MiB) oysa
  `navigator.storage.estimate()` ~1,07 GB söylüyordu (K-52); telefonun ne
  kabul ettiği ölçülmedi ve `estimate()` bir söz olarak kullanılmamalıdır.
  Bu nedenle ürün **localStorage üzerinde "sınırsız proje" garantisi vermez**;
  public release ve **fiyatlandırma dili** bu sınırı gizleyemez.

2O-B.1 ve 2P-A bu dört kapının hiçbirini kapatmaz ve beşincisini ekler:

- **Kurucunun akor ve bend/slide dinleme paketlerini müzikal olarak kabulü.**
  `eval/chord-audio/wav/` (12 dosya) ve `eval/expression-benchmark/wav/`
  (42 dosya, kör adlandırılmış; eşleme ayrı `KEY.json`'da) ölçülmüştür,
  **dinlenmemiştir**. "Perde hedefe varıyor" ile "bend doğal duyuluyor",
  "akor doğru notaları çalıyor" ile "voicing müzikal", "sample geliyor" ile
  "gitar iyi duyuluyor" bu raporda ayrı tutulmuştur ve ikincilerine dair
  hiçbir iddia yoktur. **İnsan dinlemesi olmadan hiçbir aday kazanan ilan
  edilemez** ve Expression Contract v2 bu kapı açılmadan production'a
  taşınmaz (K-54).

---

## §17 Riskler ve bilinen dersler

- **§17.0 Tekrarlanamayan tek test kırmızısı (2I-B, açık).** Bir kez tek test
  kırmızı görüldü; dört ardışık tam koşuda tekrarlanmadı, kök nedeni bilinmiyor.
  Çözülmüş sayılmıyor ve release hardening'de bu ifadeyle ele alınacak.
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
- **§17.8 Yeni bir track eklendikten sonra ilk nota yazılamıyor (2O-B.1,
  açık).** Bir bar'da track anahtarının olmaması spec 5.5 gereği "burada
  sessiz" demektir; yazma yolu aynı eksikliği "bu barda yazılı değil" olarak
  okur ve *«…» bu barda yazılı değil; önce bu bara eklenmeli* diyerek
  reddeder — hiçbir kontrolün yapmadığı bir talimat. Launch şablonları için
  kapatıldı (barlar track başına boş şerit taşıyor), ama `create_track` bar
  anahtarı eklemez, yani mevcut bir şarkıya eklenen ikinci track aynı
  çıkmaza girer. Bu, "bu barda yazılı" ifadesinin ne anlama geldiğine dair
  bir ürün kararıdır ve tek taraflı verilmedi. Hiçbir eval seed'i bunu
  görmemişti çünkü hepsi slot dizilerini baştan sona yazıyor.
- **§17.9 320 px genişlikte transport satırı taşıyor (2O-B.1, açık).**
  320×700'de satır 344 px istiyor, practice-rate düğmesi 24 px kırpılıyor ve
  kök `overflow-x` gizli olduğu için sayfa kaydırmıyor: içerik görünmeden
  kayboluyor. Diff üzerinden gösterildi ki nedeni bu checkpoint değil —
  eklenen bildirim bandı o fixture'da render edilmiyor. Ölçüldü, kaydedildi,
  düzeltilmedi.

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
| **K-20** | **Çalışma hızı ve akor grubu taşıma (§13.8).** Transport'un mutlak BPM kaydırıcısı kaldırıldı; yerine şarkının kendi `bpm`'ini değiştirmeyen bir **practice rate** geldi (%50–%150, %5 adım, varsayılan %100; `limits.ts` tek kaynak). İkinci bir tempo sistemi yoktur: tek transport, tek scheduler, tick tabanlı zamanlama. Rate Song Contract'a yazılmaz, song/Copilot fingerprint'ine girmez ve Song'dan ayrı, strict doğrulanan bir ayar anahtarında saklanır; bozuk ayar %100'e döner ve Song karantinasını tetiklemez. Zaman ekseninde taşımanın birimi **onset block**'tur (onset + akor notaları + kesintisiz tie zinciri) ve saf `move_onset_group` komutu atomiktir: kısmi taşıma, üzerine yazma ve yetim tie yoktur, bütün grup tek storage write ve tek undo adımıdır. Bu sürümde serbest drag-and-drop yoktur. | Haktan, 20.08.2026 |
| **K-21** | **Expressive Playback v1 (§8.5, §10.3, §13.9).** `NoteEvent.articulation` artık yalnız görsel metadata değil, nota bazında duyulan davranıştır. Pilot sözlüğü sekiz değerdir ve bir nota aynı anda yalnız birini taşır; kombinasyon kapsam dışıdır. Mantıksal pitch değişmez, bend miktarı sabittir (+100 / +200 cent), bütün başlangıç değerleri tek saf preset modülünde durur. Saf bir Expression Planner audio node'larından bağımsız olarak pitch automation ve gain envelope üretir; geçersiz bağlamda exception değil `articulationContext` uyarısı ve normal onset'e fallback verir. **Modulation nota-sahiplidir:** paylaşılan sampler'da global detune kullanılmaz; §8.1 allow-list'i bu yüzden `ToneAudioBuffers` ve `ToneBufferSource` ile açıkça genişletildi ve çözülmüş sample'lar tek bank'ten paylaşılır. Online ve offline aynı planner ve aynı scheduling yolunu kullanır. | Haktan, 20.08.2026 |
| **K-22** | **Gerçek legato voice zinciri ve Bend v2 (§8.5).** Hammer-on/pull-off, hedefin daha kısık yeniden tetiklenmesi olmaktan çıkarıldı: aynı telde birbirine değen notalar tek bir primary voice'ta yaşar, transition'da o voice'un kendi pitch parametresi cumulative olarak hedef perdeye gider ve hedefte ikinci tam sample başlatılmaz. Hammer 22 ms / %88, pull 28 ms / %78; pull ayrıca ayrı sayılan kısa bir yardımcı transient alabilir (0.16 gain, ≤35 ms, 4500 Hz). Pilot legato aralığı en fazla 5 yarım tondur; aşan aralık uyarı + normal fallback üretir. Bend eğrisi yalnız yüzdeye bağlı olmaktan çıkarıldı: settle/rise/hold/release, rise 80–280 ms ve release 60–180 ms gerçek zaman sınırlarıyla, kısa notada deterministic oransal sıkıştırma ile. Üretim profili **tight**; **expressive** üst salınım yalnız render/test preset injection yolunda yaşar, UI seçici yoktur. Faz 2F'nin eski legato ve bend eğrileri yalnız dinleme karşılaştırması için durur, üretimde seçilebilir bir legacy motor yoktur. | Haktan, 20.08.2026 |

| **K-23** | **Continuous slide chain (§8.5, §10.3, §13.9).** Slide'ın yazılı zamanı yeniden tanımlandı: hedef notanın notated onset'i kaymanın **başlangıcı değil, hedef perdeye varış anıdır**. El önceki notanın kuyruğunda hareket etmeye başlar, hedef onset'te tam hedef perdededir ve hedefte yeni bir full sample attack başlamaz; aynı primary source hedef notanın süresi boyunca devam eder. Faz 2F'nin `min(160 ms, süre × 0.35)` glide'ı hedef attack'ın altında kaybolduğu ve pasaj sıradan bir yeniden vuruş gibi duyulduğu için bırakıldı. Slide için ikinci bir zincir veya scheduler yazılmadı: hammer/pull ile aynı `LegatoChain` modelini kullanır, tek farkı bir transition'ın artık iki zaman taşımasıdır (hareketin başladığı an ve vardığı an). İstenen glide `clamp(|yarım ton| × 45 ms, 120 ms, 360 ms)`, kaynağın başında en az 20 ms sabit pitch bırakılarak mevcut süreye sığdırılır; kalan süre 90 ms'nin altındaysa slide kurulmaz, nota normal çalınır ve `no_room_to_glide` uyarısı verilir. Pilot slide aralığı en fazla 12 yarım tondur. Eğri tek linear ramp değil smoothstep'tir; son nokta tam hedef cent olduğu için overshoot, varış sonrası geri dönüş ve bend release davranışı yoktur. Practice rate bütün bu süreleri ölçekler. Uyarı ile fallback aynı saf `legatoDecision` yardımcısından okunur ve kurulamayan bir slide yarım zincir bırakmaz. Tab işaretinin yönü gerçek pitch'ten türetilir, `stringIndex`'ten değil. | Haktan, 20.08.2026 |

| **K-24** | **Çıktı şeması adapter sınırına taşındı (§11.3).** `AdapterRequest` artık zorunlu bir `responseSchema` taşır; structured output kısıtı sağlayıcıya şemasız gidemez. Şema Zod sözleşmesinden türetilir (`z.toJSONSchema(modelPatchSchema)`), ikinci bir elle yazılmış kopya tutulmaz. Tip sağlayıcı paketinden bağımsız yapısal bir `JsonSchema`'dır. Şema sabit blokta gittiği için token tahminine dahil edildi: en kötü durum 2887 → **3424 / 8000**. Ayrıca düzeltme diagnostiğini bozan kaçış düzeltildi: veri katmanı kaçışı zod mesajlarındaki `<=400` ifadesini `(=400` yapıp modele yanlış sınır bildiriyordu; `asData` ile `asDiagnostic` ayrıldı. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-25** | **Tempo haritası v1 ve 32 bar (§5.3, §6, §8.3, §13.8).** `bpmOverride` bar'dan **section**'a taşındı; deklare edilmiş ama hiçbir zaman okunmayan bar seviyesindeki alan kaldırıldı. Tick→saniye çevrimi tek otoriteye (`lib/audio/tempo.ts`) indirildi; `60 / bpm` aritmetiği scheduler, expression planner, playhead ve offline render'dan kaldırıldı. Semantik dardır: section'ın temposu ilk tick'inde yürürlüğe girer, hiçbir şey devralınmaz, ramp/rubato/bar-içi tempo yoktur. Tempo transport'a otomasyon eğrisi olarak yazılır; tempo sınırını aşan nota iki parçasının toplamı kadar sürer. Practice rate bütün haritayı ölçekler ve Song'a yazılmaz. Başlıkta gösterilen tempo playhead'in section'ınındır ve sınır geçildiğinde kendi başına güncellenir. `totalBars` 16 → **32**: dört bölümlü bir parça 16 barlık tavana sığmıyordu. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-26** | **Bir nota aynı anda iki şey olabilir (§8.5).** `7p5 h7` durumunda ortadaki notanın kendi pull-off'u reddedilmişken (yanlış yön, ya da yerleşim iki notayı farklı tellere koymuş) aynı nota kendisinden sonraki hammer-on'un geçerli **kaynağıdır**. Faz 2F.2 yalnız birini kaydediyordu: zincir üyeliği kazanıyor, `fallbackReason` düşüyordu. Ses hiçbir zaman yanlış değildi — böyle bir nota zaten zincir kaynağı olarak vuruluyor — ama planner validator ile aynı fikirde olmuyordu ve coverage raporu bir fallback'i olan şarkıda sıfır okuyordu. İki olgu artık bağımsız kaydedilir: zincir **ne çalınacağını**, fallback **ne istenip verilmediğini** söyler. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-27** | **Articulation-aware yerleşim (§9.2).** Slide/hammer/pull çiftleri yerleşim aramasına **kısıt kenarı** olarak verilir; kırılan kenar sayısı lexicographic maliyetin ikinci terimidir. Gerekçe: kullanıcı perde yazmadığında perdeyi motor seçer, sonra planner "aynı telde değil" diye uyarırdı — kimsenin düzeltemeyeceği bir uyarı. Yerleşemeyen nota bu terimde ikinci kez cezalandırılmaz (`unplaceable` onun sahibidir), aksi hâlde arama sorunu gizlemeye yönelir. Explicit `position` bu kısıt yüzünden de taşınmaz. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-28** | **Sample bank context+pack başına paylaşılır (§8.1).** Çözülmüş `ToneAudioBuffers` artık track başına değil, **audio context başına, pack başına** tutulur ve referans sayılır; son bırakan dispose eder. Aynı paketi kullanan iki gitar aynı belleği ve aynı indirmeyi paylaşır (S-01 demo şarkısında 22 → **15** istek, tam olarak farklı URL sayısı). Cache context üzerinde `WeakMap`'tir: ayrı context'ler ayrı bank alır, giden context girdisini birlikte götürür. Bir track'in dispose'u diğerinin bank'ini bozamaz. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-29** | **Pan denetlendi, varsayılmadı (§5.2, §8.1).** Faz 2G'de pan yolu ölçüldü: `track.pan` track'in `Channel`'ına yazılır ve track'in **bütün** kaynakları — sampler, her expressive primary voice ve pull-off'un yardımcı transient'i — aynı kanala bağlanır. İkinci bir sistem yazılmadı; davranış testle sabitlendi. Offline ölçüm: −0.3 pan → **+4.25 dB** L, +0.25 pan → **−3.50 dB** R, pan'sız track → **0.00 dB**. Nota başına panner yoktur (bir akorun tek notasını başka yere koyardı). Pan kilitli yüzeydedir ve cevap şemasında yazılabileceği bir yer yoktur. Materializer artık rolden pan verir (ritim −0.3, lead +0.25, harmony +0.35; akustik/bas/davul merkez), çünkü hepsi merkezdeyken bestelenen parçada ölçülen ayrışma her yerde 0.00 dB'di. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-30** | **Track rolleri işe göre bölündü (§11.9).** `ARRANGE_SKILLS` altı roldür: `rhythm_guitar`, `lead_guitar`, `acoustic_guitar`, `harmony`, `bass`, `drums`. K-18'in tek `harmony` rolü S-01'de hem açılış riff'ini hem soloyu hem akustik codayı yazmak zorunda kaldı ve kart "geri çekil" dediği için üçü de geri çekildi. Registry amplifiye olmayan gitarı ayırt eder; rol/enstrüman uyuşmazlığı **sağlayıcı çağrısından önce** reddedilir. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-31** | **CompositionBlueprint + deterministic materializer (§11.8).** Boş Song'u model değil, modelin **planından** saf bir materializer kurar. Blueprint strict'tir; model **kalıcı ID üretmez** (yalnız `internalKey`, Song id'lerini materializer verir); sanatçı adları blueprint'e girmez, ham istek artefaktında kalır ve blueprint onları özellik tabanlı doku tarifine çevirir; süre kontrolü tempo haritası üzerinden yapılır. **Public rotada tam parça besteleme yoktur** — rota yalnız `arrange_track` kabul etmeye devam eder. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-32** | **Turun gördüğü bağlam parçanın bütününü kapsar (§11.5).** Bir tur artık form anahatını (her section: id, ad, bar sayısı, kendi temposu, hedef mi), bağlanma noktalarını (önceki section'ın bıraktığı yer, hedef track'in kendi son barı, sonraki section'ın ilk barı) ve **rol filtreli** kaynak okumalarını görür. Minimizasyon kuralı kalktı değil, role bağlandı: `drums` hiçbir zaman perde görmez. Ham Song JSON'u hâlâ gönderilmez. Bütün form fingerprint'e dahildir. Bu değişiklik "modelin görmediği motifi kullanıcı talimatına elle yazma" workaround'unu kapatmak içindir; o workaround bir çözüm değil, eksik girdinin belirtisiydi. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |
| **K-33** | **Provenance kayıtsız yazılamaz (§21).** S-01 teslim raporu "Sonnet 8 turda 1 şema hatası üretti" dedi; Sonnet hiç çağrılmamıştı. İddia mümkündü çünkü çalıştırmada cevapları kimin yazdığını **hiçbir şey kaydetmiyordu**. Artık her cevap — blueprint dahil — kendi `ShadowProvenance` kaydını taşır: `generationMode`, sağlayıcı çağrısı olup olmadığı, model etiketinin doğrulanmış bir ID mi yoksa oturum etiketi mi olduğu, istek ve cevap hash'leri. `assertHonestProvenance` sağlayıcı çağrılmadan sağlayıcı iddia eden bir kaydı **reddeder**; `coding_agent_simulation` latency ve maliyet rakamı üretmez, çünkü ölçülecek bir çağrı yoktur. Kural test altındadır: elle değiştirilmiş bir blueprint hash'i tutmaz, talimata elle yazılmış bir motif ve "provider eval" etiketi testi kırar. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |

| **K-34** | **Ritmik söz dağarcığı kapısı (§5.5, §8.3, §9.2, §11.8, §13.x).** `Resolution` 8/16'dan **8, 12, 16, 24, 32**'ye genişletildi: sekizlik, sekizlik triplet, onaltılık, onaltılık triplet, otuzikilik. Gerekçe ölçümdür: 138 BPM'de yazılabilen en ince şey 108.7 ms'lik bir onaltılıktı, yani hızlı scalar run, kısa legato burst, hızlı arpej, tremolo-benzeri tekrar, gelişmiş drum fill ve triplet groove **yazılamıyordu**. **64 eklenmedi** ve nedeni kayda geçti (bar başına 64 slot'un token/JSON yükü; 138 BPM'de ~27 ms slot'un mevcut sample attack'ının altında kalması; grace/flam/sweep gibi olayların slot değil phrase/micro-event olması) — açık ürün boşluğu olarak durur. `12` ve `24` **triplet grid**'dir ve hiçbir yerde düz grid gibi hesaplanamaz veya etiketlenemez; kullanıcıya ve modele "1/8 üçleme" / "1/16 üçleme" gösterilir, çıplak "1/12" hiçbir yerde geçmez. Bir grid ölçüsünün kendi nota değerini yazabilmelidir (`resolution % payda === 0`); 7/8@12 ve 6/8@12 şema tarafından reddedilir. **Tick aritmetiğinin tek sahibi** `lib/music/timing.ts` oldu; `PPQ`, `ticksPerSlot`, `slotCount` ve iki ayrı slots-per-beat kuralı oraya taşındı, üç kopya silindi. **Her bar kendi grid'ini taşır**; grid değişimi section sınırı gerektirmez, fakat blueprint'te yüksek-resolution her bar bir **niyet** belirtir (`scalar_run`, `legato_burst`, `arpeggio`, `triplet_groove`, `drum_fill`, `tremolo_burst`, `ornamented_transition`) ve niyet yoksa mümkün olan en düşük grid kullanılır. Bütün barları 32 yapmak yasak değildir ama `gridUsage` raporunda görünür. Model **bar grid'ini değiştiremez**; yanlış slot sayısı, düzeltme mesajında ölçü + grid + beklenen slot sayısı ile reddedilir. Tie/sustain/legato/slide karışık grid'lerde **exact tick** üzerinden hesaplanır — bu sırada, bar sınırını aşan bir tie'ın taşınan kısmının hem scheduler'da hem expression planner'ında **düşürüldüğü** bulundu ve düzeltildi. `move_onset_group` slot indeksi değil **an** korur; hedef grid o anı yazamıyorsa `target_grid_incompatible` ile reddedilir, en yakın slota yuvarlanmaz; süre korunacak şekilde hedef grid'de yeniden notalanır. Ölçüm: 8 bar × 1/32 yoğun cevap ~1045/4000 output token, en kötü input ~3870/8000 — **tavanlar değiştirilmedi** ve run-length encoding gereksiz bulundu. | Claude Code önerisi — **Haktan onayladı 20.08.2026** |

| **K-35** | **Blueprint niyet koruma kapısı (§5.2, §7.1).** Materializer'daki sabit `role -> instrument` tablosu tek otorite olmaktan çıkarıldı. Blueprint'in `instrumentFamily` ve `presetIntent` alanları registry üzerinden doğrulanıp materialized Track'e deterministik biçimde taşınır; rol yalnız izin verilen aileyi sınırlar, açık niyeti sessizce ezmez. Desteklenmeyen aile/preset **fail-closed**: elektrik gitara veya başka bir default'a sessiz fallback yoktur. Gerekçe ölçümdür: S-03'te aday A `harmony` rolü için "Second clean acoustic voice" yazdı, materializer `electric_guitar` üretti ve yalnız-akustik olması istenen kapanış elektrik gitar içerdi. Section isolation invariant: blueprint bir section'ı yalnız akustik tanımlıyorsa materialized Song'da elektrik/bas/davul track anahtarı bulunmaz; sahte sessizlik (boş slot dizisi) yazılmaz, mevcut "eksik anahtar = sus" semantiği kullanılır. Source-context seçimi sıra tabanlı olmaktan çıktı: kaynak, hedef section'da gerçekten aktif olan track'lerden seçilir; akustik harmony turu aynı section'daki ana akustik track'i görür, o section'da susan ritim gitarını değil. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-36** | **Tuning intent koruma kapısı (§9.1).** `tuningIntent` materializer'a ulaşıyordu fakat yalnız düz "drop d" string eşleşmesi yapılıyordu. Aday A'nın "Drop-tuned low string for riff weight" isteği bu yüzden standard tuning'e düştü; model kendi planındaki D2'yi yazdı, range validator haklı olarak reddetti ve **plan ile enstrüman arasındaki çelişki bir correction tüketti**. `resolveTuningIntent` tek otorite: tuning'ler `TUNING_PRESETS`'ten, default'lar registry'den gelir; ikinci bir tuning listesi yoktur. Dört sonuç ayrılır — `defaulted` (plan susuyor), `resolved`, `unsupported` (desteklenmeyen tuning adı), `incompatible` (tel sayısı enstrümana uymuyor) — ve son ikisi materialization'ı durdurur. **Açık intent için standard tuning fallback'i yasaktır.** Tuning enstrümandan **sonra** ve seçilen gerçek enstrüman üzerinde çözülür: "standard tuning" o enstrümanın standard'ı demektir, ki bu ancak enstrüman bilindikten sonra bilinebilir. Capo tuningIntent'ten türetilmez ve 0 kalır. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-37** | **Selection & transform çekirdeği ve mobil UI (§5.4, §10, §13.1).** Zaman aralığı seçimi ve on atomik komut (`copy`, `cut`, `delete`, `paste`, `duplicate`, `move_selection_time`, `repeat`, `transpose_pitch`, `restring_same_pitch`, `translate_fret_shape`) tek saf API'de toplandı. **Seçim ve clipboard oturumluk state'tir**: Song'a, fingerprint'e ve Copilot isteğine girmez, track/section değişiminde temizlenir. **V1 sınırı zaman bandıdır** — tek track, tek section, serbest tel dikdörtgeni değil; cross-track, cross-section ve string-rectangle seçimi ertelendi. Seçim **tick** ile ifade edilir, slot indeksi ile değil (K-34): bar'lar grid paylaşmadığından indeks tabanlı bir seçim hangi barda başladığına göre farklı müzik demektir. **Zincir politikası genişletmedir** ve tie ile legato zincirlerine aynı biçimde uygulanır: zincire dokunan seçim, iş başlamadan önce zincirin tamamını kapsayacak şekilde büyütülür; akorun bir teline dokunmak akoru seçer. `selection_splits_chain` **eklenmedi** çünkü ulaşılamaz: tie slotu doluluktur, bu yüzden zincirin içine yazmak bölmeden önce çarpışır ve dürüst hata `target_occupied`'dır. **Dört taşıma modu ayrı tutulur** (2x2 kart): Zaman, Ses (`transpose_pitch`), Tel (`restring_same_pitch`), Şekil (`translate_fret_shape`) — tek belirsiz "yukarı/aşağı" komutu yoktur. Chord/power chord için **yeni kalıcı tip yoktur**; aynı onset'teki notalar gruptur ve power chord etiketi yalnız UI'da, notalardaki aralıklardan türetilir. **Ghost preview mutasyon yapmaz**: gerçek komut gerçek şarkıya karşı çalıştırılıp sonucu atılır, bu yüzden önizleme yazamaz ve commit'in yapmayacağı bir şeyi gösteremez. **Tek commit / tek undo**: art arda nudge'lar tek pending komutta birikir; başarısız komut storage'a ve geçmişe hiç dokunmaz. Long-press eşiği ve tolerans tek kaynakta; hareket toleransı aşılınca jest kalıcı olarak scroller'a devredilir. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-38** | **Tek parmak, tek cevap; ve dokunma hedefi pazarlık konusu değildir (§13.1).** Faz 2I-B'nin tarayıcı koşusu üç gerçek kusur buldu; üçü de yalnız gerçekten render edilerek görülebilirdi. **(1) Bir basış iki seçim modeli uyandırıyordu.** 2E'nin akor-grubu seçimi kendi 400ms eşiğini tutuyor, zaman seçimi paylaşılan 500ms'yi kullanıyordu ve ikisi de aynı hücrelere bağlıydı: bir onset üzerinde tek bir basış altı hücreye yeşil grup halkası **ve** zaman bandı çiziyordu. Basışın sahibi, canlı olduğu her yerde **yeni model**tir; akor seçimi jesti yalnız zaman seçiminin kapalı olduğu yüzeylerde (örneğin Copilot önizlemesi açıkken) korur. Kopya sabit silindi: eşik tek dosyada yazılıdır. **(2) Harcanmış bir basış arkasında canlı bir click bırakıyordu.** Biten bir dokunuş click üretir ve tarayıcı bunu **parmağın indiği anda altında olan** öğeye yöneltir, parmak inerken orada olana değil. Basışın az önce açtığı araç çubuğu bu yüzden parmağın altına düşen düğmeye click alıyordu: 320x700'de o düğme "Taşı"dır, yani tab'ın alt yarısındaki bir notayı seçmek taşıma sayfasını kendiliğinden açıyordu. Basış seçime harcandığı için click artık capture aşamasında, hiçbir kontrol görmeden durdurulur. **(3) Yedi adet 44px hedef 320px'e sığmaz** — boşluk ve padding ile 348px ister. Tek sıra, her düğmeyi 40px genişliğe indirerek sığıyordu; bu minimumun altındadır ve gerçek bir 320px viewport'ta böyle **ölçüldü**. Vazgeçilecek şey satır sayısıdır: dört sütun, iki satır — hem hedef korunur hem de bu ekranın tek yatay scroller'ının tab olduğu kuralı. **(4) Seçim tutamaçları küçük telefonda parmağın ulaşamayacağı yerdeydi.** Band bütün staff yüksekliğindedir (altı telde 178px) ama 320x700'de action bar açıkken tab'a ~103px kalır; band'ın **ortasına** hizalanmış tutamaç görünür alanın altında kalıyordu — layout'ta var, testin bulduğu, parmağın dokunamadığı bir kontrol. Tutamaç artık band'ın **üstüne** hizalıdır: band görünüyorsa üstü de görünüyordur. Kalan dürüst sınır kayda geçer — 320x700'de seçim açıkken tab yaklaşık üç tel gösterir, gerisi dikey kaydırmayla gelir; 44px hedeflerin istediği iki satır yer kaplar ve bu ölçülmüş bir takastır. **Üçüncüsünün tam yeşil bir koşudan sağ çıkmasının nedeni ölçümün kendisiydi**: kontrol yalnız yüksekliğe bakıyordu ve o 40px genişliğindeki düğmelerin hepsi 44px yüksekliğindeydi. Artık iki boyut da ölçülür ve iki yeni tarayıcı kontrolü basışın **sonucuna** değil kendisine bakar. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-39** | **Düzen ve Tab, iki gerçek yüzey (§13.10).** Workspace iki çalışma moduna ayrıldı ve **ilk açılış "Düzen"dir**: tanımadığı bir şarkı hakkında ilk sorulan şey, ilk gitarın üçüncü ölçüsünün neye benzediği değil, parçanın **şekli**dir. Bu bir görünüm tercihidir ve yalnız oturumda yaşar — Song'a, fingerprint'e ve Copilot isteğine **girmez**. Bir yüzey ekrandayken diğeri **gizlenmez, unmount edilir**: gizlemek, baktığınızın arkasında ikinci bir canlı yatay scroller ve ikinci bir animasyon frame'i bırakırdı; bu checkpoint ikisinden de tam olarak bir tane olduğunu söylüyor. PlaybackController ikisinin de üstünde durur, bu yüzden görünüm değişimi **motoru yeniden kurmaz** (harness `AudioContext` yapımını sayar; sayı 1'de kalır), playback'i durdurmaz, ikinci scheduler açmaz, practice rate'i sıfırlamaz. **Bar hücresine dokunmak** tek gezinmedir ve dört şeyi bu sırayla yapar: track aktif olur, transport o barın tick'ine gider, Tab ekranı alır, tab o bara kayar. **Section başlığına dokunmak yalnız kaydırır**; yapıya bakmak müziği yerinden oynatmamalıdır. Faz 2J.1'e ertelenenler: bar copy/paste, insert/delete, bar taşıma, çoklu bar seçimi, drag-and-drop. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-40** | **Bar genişliği müzikal süredir; grid ve tempo ona dokunamaz (§13.10).** Arrangement'ta bir barın genişliği yalnız **ölçü işaretinden** gelir. **Grid dokunmaz:** 1/32'de yazılmış bir 4/4 bar, 1/8'de yazılmış olanla aynı uzunlukta müziktir; dördüncüsünü dört kat geniş çizmek, okuyucuya "nota yazımı sıklaştıkça parça yavaşlıyor" demek olurdu. **Tempo dokunmaz:** tempo playback'in özelliğidir (§8.3, K-25), 4/4 bar 69'da da 138'de de 4/4 bardır. Aritmetik iddia edilmez, tick kontratından **düşer**: `ticksPerBar = pay × TICKS_PER_WHOLE / payda` olduğundan resolution sadeleşir, yani "tick'ten genişlik" zaten "grid'den bağımsız genişlik" demektir ve ikinci bir kural yoktur. 3/4, 4/4'ün dörtte üçü kadar çizilir; 6/8 ile 3/4 aynı genişliktedir çünkü aynı süredir. **Exact repeat yalnız birebir aynılıktır:** grid, ölçü, onset/rest/tie yapısı, pitch veya drum içeriği, velocity, articulation ve açık position. Yaklaşık motif benzerliği, benzerlik skoru, "bu riff şunun varyasyonu" **yoktur**. Kimlik karşılaştırmaya girmez (section id, bar numarası, track id), böylece iki farklı bölümde birebir tekrar eden nakarat tekrardır, adı değişen bar farklı bar değildir. İki bilinçli normalizasyon: bir slot'taki notalar **sıralanır** (hepsi birlikte başlar, yazım sırası duyulmaz) ve **eksik alan default sayılmaz** (`velocity: undefined`, 100 değildir). **Sessiz bar asla tekrar etiketi almaz.** Bu digest, Copilot fingerprint'i ve idempotency key ile **ilgisizdir** ve biri diğerinden hesaplanamaz. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-41** | **Ölçüler arası bağlantı yalnız veride varsa çizilir (§13.10).** Tab'da bir notanın bar çizgisini aştığını görürsünüz çünkü notayı görürsünüz; arrangement'ta bar bir kutudur, bu yüzden taşınan ses iki kutu arasında bir köprü olarak çizilmezse genel görünüm tutulan notayı sessizce iki ayrı notaya çevirir. Bağlantılar **yeniden türetilmez**: **tie**, timeline'ın kendi carry işaretinden gelir (audio scheduler ve tab da ondan çizer); **slide/hammer-on/pull-off**, `legatoDecision`'dan gelir ve validator'ın sorduğu gibi şarkının kendi tempo haritasıyla sorulur — bu yüzden "elin gezmesine yer yok" diye reddedilen bir slide burada da köprü olarak çizilmez. Oyuncunun duymayacağı bir köprü müzik hakkında yalandır. **Section sınırı bağlantıyı kesmez** (nakarat ile köprü arasındaki dikişte tutulan nota tek notadır); **gerçek sus keser** ve **track anahtarı olmayan bar keser**, çünkü eksik anahtar sessizliktir (§5.5). Bu çalışma, 2I-A çekirdeğinde fazla geniş bir reddedişi de ortaya çıkardı: `canvasOf`, bölümün **herhangi** bir barında track yoksa null dönüyor ve o bölümdeki **her** düzenlemeyi kilitliyordu — bir bar susan gitar sıradan bir şeydir. Reddediş bölümden **seçime** taşındı: yazılmamış bara **uzanan** seçim hâlâ reddedilir, uzanmayan düzenlenir; geri yazma da artık yok olan barları boş diziyle doldurmaz, çünkü yokluk kontratın bir ifadesidir ve commit onu sessizce başka bir ifadeye çeviremez. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-42** | **Ekran alanı müziğe aittir (§13.11).** 2J teknik olarak geçti, görsel olarak geçmedi; bu checkpoint arrangement ve tab yüzeylerini **değiştirmeden** aradaki kromu geri aldı. **Header üç kolondur**: 44px leading, `min-width:0` merkez, 44px trailing. Sol kolon **ayrılmıştır** — bu yüzeyin içinde çalıştığı kabuk kendi kapatma kontrolünü oraya çizer ve header'ın işi onun altına yazmak değil, ona yer bırakmaktır; marka ve başlık artık x=60'tan başlar, çakışma 0px². **Düzen/Tab tek şerittir**, iki kart değil (57→47px), ve etiketler duruma göre **değişmez**: kendini yeniden adlandıran bir segment, her bakışta yeniden okunması gereken bir kontroldür. **Düzen'de section şeridi yoktur** — timeline zaten her bölümü kendi başlığı, ölçü sayısı ve temposuyla çiziyor; Tab'da iki satırlık chip yığını yerine tek satırlık önceki/mevcut/sonraki navigator vardır (89→49px) ve tam liste sheet'tedir. **Track sütunu yalnız adı taşır** (96→108px, ama ikinci satır yok): lane'in yanında sekiz kez tekrarlanan "Elektro gitar" okuyucunun zaten gördüğü bir kategoridir ve tam bilgi track sheet'indedir. **Sessiz hücre kelime basmaz**; boş yüzeyle anlaşılır, erişilebilir adı "sessiz" kalır, ve baştan sona susan track için ad yanında tek işaret vardır (139 kelime → 0). **Tekrar göstergesi koşu farkındadır**: bir koşunun ilk hücresi `↻N`, devamı sessiz bir nokta — otuz barlık bir bas çizgisinde otuz etiket bilgi değil gürültüdür. Veri modeli değişmedi, yalnız sunum. **Tab yüzeyi baskındır**: sekiz track'lik 4×2 buton grid'i tek satırlık aktif-track kontrolüne indi ve liste **mevcut** sheet'e taşındı — aynı `onSelect`, ikinci bir selector implementasyonu yok. **Transport tek satırdır** ve practice-rate bir pill'dir; efektif BPM **bir yerde** görünür, "Hazır" gibi bilgi taşımayan durum satırı hiç görünmez. **Renk rolleri sabittir**: mavi müziğin konumu ve sürekliliği (playhead, çalan bar, bar sınırını aşan bağlantı), altın **yalnız** okuyucunun seçtiği kontrol, gri pasif bilgi (grid, bar çizgisi, section sınırı, tekrar notu), kırmızı yalnız gerçek hata. Section sınırı altın olmaktan çıktı — üç ilgisiz anlam tek renge binmiş ve sınırlar playhead'in üstüne bağırıyordu. **Enstrüman ve preset adları tek merkezî tabloda Türkçedir** (`instruments/labels.ts`); bileşen içinde dağınık string yok, tam lokalizasyon sistemi de yok. Ölçüm: 320×700'de tab çalışma alanı **40px → 397px**, arrangement **274px → 490px**, görünen lane 5 → 8, transport 162px → 57px. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-43** | **Ölçü işlemleri: iki kapsam, iki pano, tek yazma (§13.12).** Bir ölçü aralığı üzerinde on bir komut (`copy_bars`, `cut_bars`, `paste_bar_contents`, `insert_copied_bars`, `duplicate_bars`, `repeat_bars`, `insert_blank_bar_before/after`, `delete_bars`, `move_bars_left/right`) tanımlandı ve **iki kapsam asla karışmaz**: `track` bir enstrümanın ölçü içeriğidir, `full` bütün track'lerle birlikte **bölümün şeklidir**. `track` sil **içeriği boşaltır, barı asla kaldırmaz**; `full` sil bar nesnesini çıkarır ve arkasını sola kaydırır, ve bir bölüm asla sıfır ölçüye inemez. İki ayrı pano vardır (`track_bars`, `full_bars`) ve **sessizce birbirine çevrilmez**; kapsamına uymayan pano menüde **gösterilmez** — devre dışı bir satır, okuyucunun dikkatini yapamayacağı şeye harcar. Section adı/id'si, tempo ve track kaydı **hiçbir zaman kopyalanmaz**; boş ölçü komşusunun ölçü işareti ve grid'ini alır, **hiçbir track anahtarı taşımaz**. **Seçim oturumluktur**: Song'a, fingerprint'e ve Copilot isteğine yazılmaz; kanonik zaman hâlâ tick'tir. **Zincir kuralı:** seçim bir tie/slide/hammer-on/pull-off'u ortadan bölemez; deterministik olarak tam ölçülere genişler ve okuyucuya söylenir; `full` kapsamda **herhangi bir** track'in bağı yeter; bölüm sınırını aşan zincir **kapalı biter** — pano, store ve undo'ya hiçbir şey yazılmadan reddedilir, ve o reddediş seçimi de götürdüğü için mesaj action bar'ın **dışında** durur, yoksa açıklaması gereken olayla birlikte yok olurdu. **Bar seviyesinde ikinci bir düzeltme:** `track` kapsamı önce zaman seçimi çekirdeğinin üstüne kuruldu; bu, müzik hakkında doğru, veri hakkında yanlıştı ve iki gerçek kusur üretti — track anahtarı hiç olmayan bar (yani sıradan boş bar) "ritim aralığına oturmuyor" diye reddediliyordu, ve **davul lane'inde hiçbir ölçü işlemi çalışmıyordu**, oysa arrangement o lane'i çizip aynı hareketi teklif ediyor. Artık iki kapsam da **tam ölçülerle** çalışır ve `regridMelodic`/`regridDrums`'ı paylaşır: hedef grid'in **birebir** ifade edemediği bir an reddedilir, asla yuvarlanmaz (K-34). **Ghost gerçek komuttur:** önizleme, gerçek şarkı üzerinde gerçek komutu çalıştırır ve sonucu **çizer** — yarı saydam ve dokunulamaz bir arrangement — store'a, localStorage'a, undo'ya ve playback planına hiçbir şey yazmadan. Uygula **tek** storage yazımı, **tek** history girişi, **tek** Song commit'idir; vazgeç ve reddediş sıfır yazımdır. **Yapısal işlem playback'i önce durdurur, önizleme durdurmaz.** Yapısal yazımdan sonra playhead **bölümüyle birlikte taşınır**: `usePlayback` yeni controller'a eski konumun **hâlâ var olan en yakın barını** verir — silinen bir bar şarkının başına değil, bulunduğu yerin yanına düşer, ve bekleyen seek artık yanlış bara inemez. Renk rolleri K-42'nin devamıdır: altın seçim, mavi playhead, yarı saydam ghost, kırmızı yalnız gerçek ret. **Kapsam dışı** (bu sürümde): bölümler arası ölçü seçimi, track'ler arası içerik yapıştırma, linked pattern, yaklaşık motif, bölüm çoğaltma/taşıma, tempo ramp, scale-aware transpose, 64 grid, export. | Claude Code önerisi — **Haktan onayladı 21.08.2026** |
| **K-44** | **Tek geçmiş, tek kapı, tek yazma (§13.13).** Şarkıyı değiştirebilen bütün yollar — riff düzenleme, nota grubu taşıma, seçim transform'u, ölçü işlemi ve uygulanan Copilot önerisi — tek bir `commit` kapısından geçer ve her biri **ne yaptığını söyler**. Dağınık component undo state'i yoktur; geçmiş **tek snapshot dizisi + cursor**'dur, bu yüzden branch kuralı zorlanmaz, **düşer**: undo'dan sonraki commit cursor'da keser, terk edilen gelecek saklanmaz. Snapshot seçildi çünkü alternatifi on bir ölçü komutunun, on seçim komutunun ve Copilot'un çıktısının **tersini** doğru yazmaktır; tek bir yanlış ters müziği sessizce ve çok sonra kaybettirir, oysa snapshot yanlış olamaz. Bedeli bellektir ve `historyLimits.maxUndoSteps = 50` ile sınırlıdır (baseline hariç en fazla 51 snapshot). **Geçmiş oturumluktur:** localStorage'a yazılmaz, Song Contract'a girmez, fingerprint'e ve Copilot payload'una girmez, sayfa yenilenince sıfırlanır. Hydration, örnek şarkı fallback'i ve baseline değişimi **adım değildir**; geçmişi tek snapshot'a sıfırlarlar. **Commit reddi iki sebepten olur:** şema kabul etmiyorsa (geçmişte yüklenemeyen bir şarkı, undo'su bozuk bir geçmiş demektir) ve aday **aynı müzikse**. İkincisi `JSON.stringify` değil **yapısal** karşılaştırmadır: bir bar'ın `slots`'unu spread ile yeniden kuran bir düzenleme aynı müziği farklı byte'larla üretebilir, ve onun için history adımı yazmak okuyucuya **görünürde hiçbir şey yapmayan bir undo** vermek olurdu — eksik bir undo'dan daha kötüdür, çünkü bütün yığını güvenilmez kılar. **Zamana bağlı coalescing yoktur;** staged davranış korunur: ghost preview, kopyalama, sheet içi geçici ayarlar ve Copilot preview adım üretmez, beş nudge + tek "Uygula" tek adımdır. **Undo ve redo iki ayrı 44×44 kontroldür**, birbirine dönüşen tek bir düğme değil, ve her biri ne yapacağını söyler: «Geri al: Ölçüleri silme». Metinler tek merkezî Türkçe tablodan gelir; ham enum, command ID veya provider diagnostic'i ekrana çıkmaz. Klavye: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`; **metin alanı içinde tetiklenmez** (orada Ctrl+Z kullanıcının cümlesine aittir) ve yapılabilecek bir hareket yoksa browser event'i **yutulmaz**. **Yapısal düzenleme ve history hareketi playback'i önce durdurur, kendiliğinden devam ettirmez**, ikinci AudioContext kurmaz. Playhead hâlâ var olan en yakın bara taşınır (K-43). **Loop için yeni kural:** bölüm hâlâ varsa loop korunur ve sınırları yeni plandan **yeniden türetilir**; bölüm yoksa loop **kapatılır** — sessizce başka müziğe taşınan bir loop, uygulamanın kimsenin istemediği bir şeyi çalması demektir. Undo/redo aktif seçimi, ghost'u, açık işlem preview'sini ve Copilot preview'sini temizler; **pano korunur**, çünkü pano Song state'i değildir. Sınır testleri `.tsx` içinde `snapshots`, cursor aritmetiği, `recordEdit`, `localStorage` ve ikinci bir `useState` yığınını yasaklar. | Claude Code önerisi — **Haktan onayladı 22.08.2026** |
| **K-45** | **Kayıt bir zarf içindedir ve bir basamak geride tutar (§13.14).** Her başarılı düzenleme zaten kaydediliyordu; yapmadığı şey **yerine geçtiği şarkıyı saklamaktı** — yarım inen bir yazma, şemanın altından kayması ya da tek slotun bozulmasının başka bir yolu müzisyenin işini götürüp yerine örnek şarkıyı bırakıyordu. `aranje.song` artık `{format, version, revision, current, previous}` taşır: **tek nesne**, çünkü iki slot + pointer normal bir commit'i iki-üç fiziksel yazıma çıkarır ve yazmanın yarım kalabildiği an, bu checkpoint'in kaldırmaya çalıştığı andır. Normal commit hâlâ **tam 1** `setItem`'dır. `current` ve `previous` **ayrı ayrı** doğrulanır — ikisini birden tek Zod hatasına bağlamak, iki tane tutmanın bütün anlamını yok ederdi. **Okuma saf bir karardır:** `decideLoad` ham string alır, hiçbir şeye dokunmaz ve altı sonuçtan birini döner (empty · legacy · envelope · recovered_previous · corrupt · unsupported_version), böylece yalnız bir şeyler zaten bozulduğunda çalışan dallar birebir test edilebilir. **Sürüm şekilden önce okunur:** format etiketi ve version *gevşek* bir şemayla bakılır, çünkü gelecek bir sürümün şekli hiç bu olmayabilir; tanımadığı bir dosyayı karantinaya almak, bu sürümün okuyamadığı gerekçesiyle yeni sürümün işini yok etmesi olurdu. Future version **fail-closed**: silinmez, taşınmaz, üzerine yazılmaz ve o oturumda kalıcı düzenleme kontrolleri **disabled** olur. **Legacy migration sessizdir:** eski ham Song normal açılır, açılışta **hiç yazma yapılmaz**, ilk gerçek düzenlemede zarfa geçer ve eski şarkı `previous`'a girer; migration history adımı değildir ve kullanıcıya mesaj gösterilmez. **Commit atomikliği tersine döndü:** eskiden reddedilen bir yazma, ekranda kaydedilmemiş bir düzenleme ve altında "kaydedilemiyor" notu bırakıyordu — yani okuyucudan, önündeki şeylerin hangisinin gerçek olduğunu hatırlamasını istiyordu. Artık `setItem` başarısızsa **hiçbir şey ilerlemez**: ne şarkı, ne cursor, ne redo dalı; banner sebebini söyler ve ekranda görünen, diskte olandır. Tek istisna deponun **hiç olmaması**dır (private pencere): `setItem` çağrılmadı ve başarısız olmadı, oturum bellekte çalışır ve bunu açılışta zaten söyler — tarayıcısı hatırlamayı reddeden birinden düzenlemeyi almak, koruma değil ceza olurdu. **Undo ve redo da diske yeni bir current yazar** (her biri tam 1 `setItem`), `previous` işlemden hemen önce diskte olandır ve `revision` monoton artar. Geçmiş hâlâ oturumluktur; zarfa snapshot veya cursor yazılmaz. **Kurtarma ekranı dört durumdan ibarettir** (`recovered_previous`, `corrupt_fallback`, `unsupported_version`, `storage_write_failed`) ve banner bir *durum* alır, bir cümle değil — diagnostic'ten okuyucuya giden kod yolu yoktur. Karantina anahtarı çakışırsa deterministik `.1`, `.2` soneki alır: ikinci bir kurtarmanın birincinin kanıtını ezmesi, bu fonksiyonun bir kat aşağıda önlediği hatanın ta kendisidir. Ölçüm: en ağır şarkı (8 track × 32 bar × 1/32, her slot dolu) ham **798.516 B**, zarf current-only **798.592 B** (+76 B), current+previous **1.597.104 B** (≈1,52 MiB, 2,00×). Tarayıcının tahmini kotası garanti sayılmaz; gerçek `setItem` her hâlükârda fail-closed yakalanır. **Timer/interval/debounce autosave yoktur** ve `beforeunload`/`visibilitychange`/`pagehide` dinleyicisi **hiç kaydedilmez** — kapanırken çalışan ikinci bir yazma yolu, yanlış olduğunu keşfetmek için mümkün olan en kötü andır. **2K-B.1 kapanışı:** bellekte-düzenleme modu kaldırıldı — depo yoksa, erişim exception veriyorsa veya açılıştaki yazma probe'u (`aranje.probe`, 1 set + 1 remove) başarısızsa `canPersist: false` olur; şarkı görüntülenir ve çalınır, bütün kalıcı mutasyonlar disabled olur, jestler armed edilmez ve non-dismissible banner sebebini söyler. Kurtarma sırası kayıpsızdır: ham değer kopyalanmadan ana anahtar silinmez/yazılmaz, karantina veya repair başarısızsa `canPersist: false` ve başarı raporlanmaz. Fiziksel işlem defteri uygulamadan önce kurulur ve `removeItem` dahil anahtar+sıra+sonuç sayar; temiz açılış yolları şarkı ve karantina anahtarlarında 0/0'dır, probe'un kendi 2 işlemi açıkça raporlanır. Boyut iki birimle ölçüldü (worst case 1.597.104 B UTF-8 / 1.597.080 code-unit / ≈3.194.160 B UTF-16) ve production Chromium 141'de gerçek `setItem` başarılı, round-trip byte-eş; fiziksel iOS Safari kabulü açık. | Claude Code önerisi — çekirdek şartlı kabul, 2K-B.1 kapanışıyla **Haktan onayladı 22.08.2026** |
| **K-46** | **Taşınabilir proje yedeği ve güvenli açma (§13.15).** Şarkı tek, strict, versioned bir dosya olarak cihaza iner ve güvenle geri açılır: `{format: "aranje.project", version: 1, song}`, uzantı `.aranje.json`. **Storage zarfı dosyaya girmez** — `current/previous/revision`, recovery state, history, clipboard, ayarlar, fingerprint, örnekler ve cihaz bilgisi dosyada yoktur; dosya müziği taşır, oturumu değil. **Export deterministiktir:** kanonik sıralı anahtarlar + compact JSON + tek satır sonu; aynı şarkı beş kez byte-eş dosya üretir ve yapısal eşitlik byte eşitliğini getirir. Export öncesi strict Song şeması + merkezi validator zinciri çalışır; error export'u reddeder, warning etmez. Export hiçbir şey yazmaz, history adımı oluşturmaz, playback'i durdurmaz ve **`canPersist: false` iken de çalışır** — kaydedemeyen cihazdaki şarkı dosya olarak kurtarılabilir. Dosya adı tek saf yardımcıdan gelir (yasak/kontrol karakterleri temizlenir, Unicode korunur, boş başlık `aranje-proje`ye düşer, uzunluk merkezî sabitte). **Import saf bir karar sırasıdır:** byte sınırı (`projectFileLimits.maxImportBytes = 2 MiB`, içerik okunmadan) → UTF-8 + BOM → JSON → ham legacy Song reddi (storage migration ile taşınabilir dosya ayrı sınırlardır) → gevşek etiketle sürüm (gelecek sürüm fail-closed, "bozuk" değil) → strict dış kabuk → strict Song → merkezi validator zinciri; onarım, clamp, alan düşürme, sessiz varsayılan yoktur ve `__proto__`/`constructor`/`prototype` her derinlikte reddedilir. Hatalar dokuz sabit koddur ve tek Türkçe tabloyla konuşur; ham JSON/diagnostic UI'a taşmaz. **Preview hiçbir şeyi değiştirmez** (şarkı, depo, history, playback, seçim, pano; ikinci AudioContext kurulmaz), apply açık kararla tek `commit(next, {kind: "project_import"})`'tir: tam 1 yazma, tam 1 history adımı, "Geri al: Projeyi açma", undo/redo byte-eş. Apply zemini deterministiktir: playback durur, loop kapanır (aynı section id yeniden görünse bile), playhead başa döner, seçimler/ghost/pano temizlenir, görünüm Düzen'e döner. **Orkestrasyon sınırı tutuldu:** saf contract `src/lib/project`'te, akış `use-project-file`'da, görünüm `ProjectFileSheet`'te; `Workspace.tsx` 1555 → 1543 satır (dürüst: başlık çıkarımı + davranış-koruyan sadeleştirme), `ArrangementCanvas.tsx` 881'de kaldı ve proje kablosu almadı. **Yeni boundary'ler grep değil:** gerçek import graph (TypeScript AST), export yüzeyi ve ESLint `no-restricted-imports`. Performans ölçüldü (PERFORMANCE.json): worst-case desteklenen şarkıda export serialize ~8 ms, JSON parse ~4 ms, strict doğrulama ~12 ms, validator zinciri ~102 ms median (Node); worst-case zarf `setItem` ~10-18 ms median / ~23-34 ms max (masaüstü Chromium 141); 51 snapshot history JSON-eşdeğeri ≈38,9 MiB üst sınır, gerçek tutulan bellek tek-bar düzenlemelerde ≈0,07 MiB (Node, taban hariç) / ≈1,1 MiB (Chromium, taban dahil) — bunlar masaüstü ölçümüdür, fiziksel telefon kanıtı değildir; Android/iOS gecikmesi release gate'inde açıktır. Kapsam dışı: audio/MIDI export, çoklu proje kütüphanesi, cloud sync, yeni şarkı akışı, mixer. | Claude Code önerisi — **Haktan onayladı 22.08.2026** |
| **K-47** | **Workspace bir composition root'tur (§13.16, 2L-R).** Davranış-korumalı ayrıştırma; yeni özellik yok. `Workspace.tsx` 1543 → **416** satır (useState 0 — bütün state kendi sahibinde), `ArrangementCanvas.tsx` 881 → **470**. Sahiplik: view/track/bar-focus/scroll hedefleri `use-workspace-navigation`; iki seçim modeli + panolar + staged komutlar + sheet'leri `use-selection-session` (tek-seferde-bir kuralı artık tek sahibin yapısı); edit modu + hücre + onset grubu `use-note-editing` (nota/grup commit köprüsü burada); üst düzey sheet'ler `use-workspace-overlays`'ta typed enum (karşılıklı dışlama tipin özelliği); görünüm `WorkspaceSurface`/`WorkspaceOverlays`/`SelectionActionArea`'da. Arrangement'ın hücreleri, seçim tutamacı ve follow-scroll rAF'i `arrangement/` altına taşındı — model/geometri semantiği, tek rAF, hücre başına dinleyici sayısı ve `data-*` yüzeyleri değişmedi. **Parite ölçüldü:** iki viewport'ta önce/sonra bounds piksel-eş, yatay scroller 1, body taşması 0, hedefler 44px, AudioContext 1, oynatmada ~60 rAF/s, üç görünüm geçişinde çalma sürüyor, console/page error 0; boot/geçiş/seçim/sheet süreleri eşit veya daha iyi (COMPARISON.json). **Sınırlar artık gerçek sözdiziminde:** AST import-graph + tanımlayıcı/çağrı sayaçları + export yüzeyi + ESLint `no-restricted-imports` (`**/eval/**` ürün koduna kapalı); history cursor kontrolü grep'ten AST aritmetik analizine çevrildi (Tailwind `cursor-pointer` artık yanlış pozitif veremez — probe bunu kanıtlıyor). Eval'de üçten fazla harness'ın kopyaladığı press/reveal/layout/44px/hata-toplama/kayıt yardımcıları `eval/shared/harness.mjs`'te ortaklandı, dört suite ona bağlandı ve eski kopyalar silindi; storage 50/50 ve project-file 52/52 aynen yeşil. **Dürüst kayıt:** bar-ops (23/29) ve history (22/36) suite'lerinin düşen senaryoları baseline commit'te birebir aynı listeyle düşüyor — 2K-B zarfı ve undo/redo yazma semantiği sonrası çürümüş beklentiler; bu checkpoint'te ne kırıldı ne de sessizce onarıldı, kayda geçirildi. Yeni 20 senaryoluk regresyon paketi (2 viewport, 40/40) navigation'dan Copilot demo döngüsüne ve depolama kapısına kadar akışları ölçüyor. 16 vacuity probe (12 unit + 4 tarayıcı) kırmızı. | Claude Code önerisi — **Haktan onayladı 22.08.2026** |
| **K-48** | **Yeni şarkı, bölüm ve track yaşam döngüsü (§13.17, 2L-B).** Ön kapı: 2K-B'den beri çürümüş bar-ops ve history tarayıcı paketleri güncel zarf + durable-save sözleşmesine onarıldı (yalnız eval, ayrı commit; `unwrapStoredSong` paylaşılan yardımcı) — bar-ops **29/29**, history **36/36**. **On altı saf komut, üç ayrı modül:** şarkı (şablondan oluşturma + başlık/tonik/mod/tempo), bölüm (create/rename/duplicate/move/delete/set/clear tempo override), track (create/rename/duplicate/move/delete + iki ayrı setup yolu). Her aday tek kapıdan strict şema + merkezi validator zincirinden geçer; error atomik red, warning taşınır ve engellemez; red kodları typed ve tek Türkçe tabloda. **Determinizm:** timestamp/UUID/randomness yok (AST ile bağlı); ID ve kopya adları merkezî collision-safe üreticilerden (`track-1`, `gtr-copy`, "Gitar 1 kopyası"); aynı girdi beş koşuda byte-eş. **Üç şablon tek merkezî tabloda** (Boş başlangıç / Rock grubu / Akustik; "Yeni Şarkı", E minor, 120 BPM, 4/4, 1/16, "Bölüm 1", 4 ölçü) ve enstrüman ayrıntıları registry'den; üç Song da validator zincirinden sıfır hatayla geçer; sessizlik eksik anahtardır. **Setup güvenliği iki ayrı yoldur:** güvenli güncelleme içerik korunarak şema+validator'a sorulur ve bozulma atomik reddedilir (pozisyon silinmez/clamp edilmez); "Track içeriğini temizleyip değiştir" ayrı, onaylı ve yıkıcıdır — tek commit, undo eski setup'ı ve bütün müziği byte-eş getirir. **Tek controller** (`use-lifecycle`): red → no-op → blocked → zemin + tek commit + normalizasyon; sheet'ler commit/storage/history/validator görmez (AST ile bağlı); yeni şarkı sheet'i zorunlu uyarı cümlesini ve 2L-A yedeğini taşır; `canPersist:false`'ta oluşturma kapalı, dinleme + yedek açık. Silme sonrası aktif bölüm/track deterministik (`survivorIndex`: aynı index, yoksa önceki); loop/playhead motorun undo/redo yolundan normalize olur; yapısal apply'da çalan transport güvenle durur, ikinci AudioContext kurulmaz. **History:** typed `{kind:"lifecycle", command}`; 16 komut 15 okuyucu etiketi (set/clear tempo aynı cümle); ham komut ID UI'da yok. **Ürün dili:** "Track" mevcut ürün dili olarak korundu (yarım lokalizasyon yapılmadı; enstrüman listesi başlığı "Enstrümanlar" kalır), "resolution" yerine "Ritim aralığı" + mevcut Türkçe grid etiketleri; yalnız core ölçü işaretleri ve `timing.ts`'in tam yazabildiği grid çiftleri sunulur. **Doğrulama:** 50 birim testi; satır bütçeleri daraltıldı (Workspace ≤450, fiili 450; ArrangementCanvas ≤470, dokunulmadı); 32+ tarayıcı senaryosu × 2 viewport = 68/68 gerçek production build'de, her apply gerçek `setItem` sayımıyla (başarı tam 1, vazgeç/no-op/red 0); Copilot hedef listesi Song'dan yeniden türer, provider çağrısı 0; proje dosyası formatı değişmedi. Performans (Node + masaüstü Chromium, telefon kanıtı değil): şablon ~0,005 ms; limit-altı en ağır girdide section/track duplicate ~231/~248 ms median (≈200 ms'i validator zinciri); lifecycle commit zarfı setItem ~15,6 ms median; 51 snapshot ≈38,9 MiB JSON-eşdeğer üst sınır / ≈0,07 MiB tutulan Node heap. 25 vacuity probe (16 unit + 9 tarayıcı) kırmızı. Kapsam dışı: mixer (2L-C), audio export, çoklu proje, gerçek provider, release hardening. | Claude Code önerisi — **Haktan onayladı 22.08.2026** |
| **K-49** | **Minimal mixer ve canlı mix önizlemesi (§13.18, 2L-C).** Ön kapı: bölüm formu artık Song Contract'ın bütün ölçü işaretlerini gösterir (3/4 ve 7/8 dahil); form kendi uyumluluk tablosunu tutmaz, her ölçü için yalnız `timing.ts`'in tam yazabildiği ritim aralıkları listelenir; `6/8@12` ve `7/8@12` hâlâ reddedilir; formu daraltan `CORE_TIME_SIGNATURES` silindi. **Taşıyıcı karar iki ayrı durum sınıfıdır:** kalıcı mix (`volumeDb` + `pan`) proje verisidir — contract, dosya, fingerprint, undo/redo, depo ve offline render onu okur; oturum dinlemesi (mute/solo) **Song'a hiç yazılmaz** — alan yok, dosya yok, fingerprint yok, history yok, depo yok. Contract'a `mute`/`solo` alanı eklenmedi; mute "−sonsuz dB" olarak da modellenmedi (duyulurluk seviyeden ayrı bir karardır: `effectiveTrackGain` seviyeyi, `audibleTrackIds` kimin duyulduğunu söyler). **Saf çekirdek** (`track-mix.ts`) yalnız iki alanı değiştirir, girdiyi mutate etmez, davulu da mikslar, tek kapıdan strict şema + validator zincirinden geçer (error atomik red, warning taşınır) ve **sınır dışını clamp etmez, reddeder**; no-op apply history/yazma üretmez; beş koşuda byte-eş. **Merkezî `mixerLimits`:** ses −24…+6 dB adım 0,5; stereo −1…+1 adım 0,05, merkez 0 — sayılar component/engine/hook'ta tekrarlanmaz. **Truth table:** solo yoksa mute edilmeyen herkes; solo varsa yalnız solo'lananlar eksi mute'lananlar — **mute solo'ya üstün gelir**; çoklu solo serbest; bilinmeyen id'ler deterministik temizlenir; metronom track değildir ve hiçbir kombinasyon onu susturmaz; hepsi mute geçerli sessizliktir. **Canlı yol:** slider yalnız taslağı ve çalan düğümü değiştirir; Uygula = tek Song adayı, tek commit, tek history adımı, tam 1 yazma; Vazgeç/Escape/backdrop = açılış değerlerine dönüş, runtime geri yazımı, mute/solo korunur, 0 yazma; şarkı mixer açıkken değiştiyse merkezî `isStaleMixDraft` taslağı indirmez — sessiz rebase yok, Uygula kapalı, güvenli cümle, ham diagnostic yok. **Ses grafiği:** ikinci scheduler/motor yok; kazanç ve konum track'in **kendi kanalına** yazılır (`setTrackMix`, `setTrackAudibility`); global detune/gain/master pan yok; sample yeniden decode edilmez, schedule/playhead/hız/loop değişmez; sampler, akor ve expressive sesler aynı kanalı paylaştığı için kararı birlikte alır; mix-only yol bir component koşulu değil, merkezî saf `isMixOnlyChange` yüklenicisidir. **Offline render ölçüldü** (15 case, AUDIO.json, 11/11): −6 dB → −6,00; −12 dB → −12,01; merkez L−R 0,00 dB; sert pan sonsuz oran; akor ve expressive sesler track miksini paylaşıyor; oturum mute/solo doğru track'i bırakıyor; hepsi mute → tepe 0 iken metronom 0,068463 tepeyle çalıyor; dispose sonrası aktif ses 0 — **bunlar gain/pan/audibility doğruluğudur, mix kalitesi kanıtı değildir**. **Lifecycle/Copilot/dosya sınırı:** yeni şarkı ve import apply oturum durumunu temizler, import önizlemesi temizlemez, track silme id'yi düşürür, ad/sıra korur, kopya sustursuz başlar, undo ile dönen track eski mute'unu diriltmez; `canPersist:false`'ta Uygula kapalı, mute/solo açık, oturumsallık notu görünür; fingerprint kalıcı miksi izler ve locked-surface guard modelin mix denemesini yakalar; export yalnız commit edilmiş miksi taşır. **UI:** görünür "Mikser" girişi; satırda ad, enstrüman, "Sustur", "Tek dinle", ses slider'ı, −/+ ince ayar, dB, stereo slider'ı, Sol/Merkez/Sağ okunuşu, 44px merkezleme; mute/solo renk dışında metin + `aria-pressed` ile anlatılır; çıplak "M"/"S"/"pan"/"gain"/"bus" yok; kapsam cümlesi ("bütün bölümlerdeki sesini değiştirir") yazılı; `Workspace.tsx` 449 (≤450), `ArrangementCanvas.tsx` 470 ve mixer'ı import etmiyor, `MixerSheet` engine/commit/depo/history görmüyor (AST ile bağlı). **Dürüst kalite boşluğu — kapatılmadı:** solo yapılan bölümde arkadaki enstrümanları yalnız o bölüm için yükseltmek mümkün değildir; ses ve stereo track'in bütün bölümlerine uygulanır; bölüm bazlı override/otomasyon yoktur ve Contract'a eklenmedi. **Doğrulama:** 50+ birim testi; 35 senaryo × 2 viewport = 70/70 gerçek production build'de, ses iddiaları DOM'dan değil gerçek Web Audio param yazımından (Tone zamanlayarak yazdığı için `setValueAtTime`/rampalar da yakalanır, beklenen lineer kazanç birebir aranır); 30 vacuity probe (20 unit + 8 tarayıcı + 2 ses) kırmızı. Performans (Node + masaüstü Chromium, telefon kanıtı değil): staged mix ~0,001 ms, audibility ~0,003 ms, apply ~167 ms (≈147 ms validator), runtime gain/pan ~0,003 ms, audibility yazımı ~0,05 ms, mix commit ~0,04 ms; zarf `setItem` ~11,8 ms median / 14,1 ms max; 25 slider hareketi 211 ms, apply gidiş-dönüş 458 ms, sample isteği 21 → 21. Kapsam dışı: audio/MIDI export, section automation, efektler, gerçek provider, çoklu proje kütüphanesi, release hardening. | Claude Code önerisi — **Haktan onayladı 23.08.2026** |
| **K-50** | **WAV ve MIDI export (§13.19, 2M-A).** Ön kapı: legacy `muted`/`soloed` denetlendi — tek gerçek okuyucu (`buildVoice`, `muted:true` → kanal susuk) kaldırıldı, `soloed`'in okuyucusu zaten yoktu; contract migration yapılmadı, alanlar şemada kalıyor ve proje dosyası onları byte-eş taşıyor, ama artık hiçbir şeye karar vermiyorlar (bayraklı/bayraksız render RMS 0,033224 ve tepe 0,439353 ile birebir aynı). **Üç format tek görünür yüzeyde**, her biri ne *için* olduğuyla anlatılıyor; proje yolu 2L-A serializer'ı, ikinci serializer yok. **WAV:** RIFF/WAVE PCM stereo 44,1 kHz 16-bit, kanonik chunk boyutları (`data`+44 = dosya, RIFF = dosya−8), ±1 clamp (wrap değil), −1/+1 tipin uçlarına, **NaN/Infinity susturulmaz reddedilir**, beş koşuda byte-eş, girdi mutate edilmez. İki içerik seçeneği yapısal olarak ayrı: "Tüm track'ler" yolunda `setTrackAudibility` **hiç çağrılmaz**, "Şu anda duyduklarım" 2L-C'nin `audibleTrackIds`'ini açıkça geçirir; MIDI session durumunu hiç sormaz. **Render mevcut motoru/scheduler'ı/expression planner'ını/sample bank'ini kullanır** — ikinci nota veya articulation zamanlama yolu yok; şarkının %100 temposunda çalışır (practice rate dosyaya girmez, scheduler'a verilen haritanın `practicePercent`'i testle bağlı); metronom dosyaya girmez; Song/depo/history/fingerprint değişmez; online motor yeniden kurulmaz; offline context dispose edilir ve sonrasında aktif ses 0; çalma görünür biçimde duraklatılır, playhead sarmaz, kendiliğinden devam etmez. **Süre türer:** notated + expression + merkezî tail; **dürüst kayıt: expression terimi bugün her şarkı için 0** (planner her jesti kendi notasına sıkıştırıyor), son notayı tutan şey tail — sıfır olduğu testle sabitlendi. **MIDI:** format 1, conductor + track başına MTrk, PPQ merkezî tick modelinden, tempo yalnız değişen section'da, time-signature yalnız ölçünün değiştiği tick'te, davul GM kanal 10'da ve program change'siz (10. kanalda program change *kit* değiştirir), deterministik sıra (note-off aynı pitch'in yeni note-on'undan önce), kanonik VLQ, running status yok, beş koşuda byte-eş. **V1 sınırı ve nedeni:** bend/slide/vibrato/hammer/pull yazılmaz çünkü MIDI'nin kanal düzeyindeki tek aracı pitch bend'dir ve akorun diğer notalarını da büker — sessizce akort bozan dosya, "nota ve zamanlama taşır" diyenden kötüdür; dosyada hiç `0xEn` baytı olmadığı byte düzeyinde bağlı; sheet bunu kullanıcıya söyler. **Merkezî `midi-map.ts`:** 0-tabanlı program numaraları (DAW'ların 1-tabanlı gösteriminden bir eksik, tek yerde belgeli), preset değil enstrüman eşlenir, bilinmeyen enstrüman **typed red** (sessiz piano fallback'i yok), `volumeDb→CC7` ve `pan→CC10` tek saf fonksiyonda (−1/0/+1 → 0/64/127). **Tek export kapısı:** bir Object URL'i minten/revoke eden tek yer, eşzamanlı ikinci export reddedilir, başarısız export bayat dosyayı sunmaz; component'lerde indirme yolu yok (AST ile bağlı); `Workspace.tsx` 444 (≤450), `ArrangementCanvas.tsx` 470. **`canPersist:false` üç export'u da çalıştırır**, hiçbir depo yazımı yapılmaz. **Lisans:** FluidR3 atfı görünür, kopyalanabilir ve indirilebilir; MIDI ses örneği içermediği için aynı yükümlülüğü taşımadığı ayrıca yazılı. **Açık blocker:** CC BY 3.0 US legalcode bu ortamdan indirilemiyor (proxy 403), metin ezberden yazılmadı, `textVendored:false` kalıyor, release öncesi kanonik kaynaktan vendor edilmeli. Billing/kota/premium yok; sahte kota da yazılmadı. **Doğrulama:** 70 birim testi; 36 senaryo × 2 viewport = 72/72, **indirilen byte'lar okunarak** (indirme olayı sonuç sayılmaz); 18 render case'inde 14 ses iddiası; 37 probe (28 unit + 6 tarayıcı + 3 ses) kırmızı. Performans (Node + masaüstü Chromium, telefon kanıtı değil): worst-case WAV encode ~33 ms, MIDI plan ~75 ms + yazım ~11 ms, süre planı ~61 ms, proje export ~188 ms. **2M-A.1 kapanışı:** raporlanan "worst-case WAV ≈9,9 MiB" düzeltildi — o, olay-yoğun şarkının boyutuydu ve fixture'ı 138 BPM'de koşuyordu; limitlerden türeyen gerçek en uzun dosya 32 bar × 4/4 × 40 BPM = 195,000 s, 8.599.500 frame, **34.398.044 byte = 32,80 MiB** ve gerçek render/encode ile birebir aynı. Süre baskısı ile olay baskısı artık **iki ayrı fixture**: en uzun süre (tek nota, 195 s) ve en yoğun olay (8 track, 32 bar, 1/32, 4.864 olay, 1.536 expressive nota, 768 legato zinciri, sıfır fallback, 58,7 s). Gerçek offline render (masaüstü Chromium, 3 tur): sırasıyla ~2,2 s ve **~206 s** median, dispose sonrası aktif ses 0, ObjectURL sızıntısı 0. **Açık release riski:** yoğun fixture gerçek zamanın ~3,5 katında render ediliyor; sınırlar küçültülmedi, bulgu `eval/export/WORST-CASE.json`'da kayıtlı ve telefon davranışı release gate'inde açık. On-uçuş tahmini bir üst sınırdır (frame yukarı yuvarlanır; yoğun fixture'da 4 byte fazla) ve iki sayı da raporlanır. Pitch-bend kanıtı ham byte taramasından **event-aware okuyucuya** taşındı (`lib/dev/midi-reader`: chunk sınırları, VLQ, meta/SysEx uzunlukları, running status, sabit veri baytı sayısı); non-vacuity fixture'ı dosyada 9 adet `0xEn` baytı taşırken parser 0 bend buluyor, gerçek bend enjekte edilince 1 buluyor; üretim davranışı değişmedi. **Proje yedeği kararı:** Info'daki tek dokunuşluk "Projeyi yedekle" bir güvenlik yoludur, her zaman ücretsiz ve doğrudan erişilebilir kalır ve ileride bir entitlement/paywall gelirse onun arkasına konmaz; WAV/MIDI tek export controller'ından geçer; ikisi de aynı saf `exportProject` serializer'ını kullanır ve ikinci bir serializer/format yoktur (testle bağlı). Legalcode hâlâ vendor edilemedi (proxy 403); metin ezberden yazılmadı, mirror'dan alınmadı, `textVendored:false` kaldı ve yapılacak iş `public/samples/licenses/OWNER-ACTION.md`'de kayıtlı — K-50 kod kapanışını engellemez, public release gate'ini engeller. Doğrulama: 87 birim testi, 72/72 tarayıcı, 20 render case'inde 14 + 12 iddia, **47 probe** (38 unit + 6 tarayıcı + 3 ses) kırmızı. Kapsam dışı: stem, MP3, MusicXML, ZIP, paylaşım, cloud, mastering, section automation, billing/paywall, gerçek provider, release hardening. | **Haktan onayladı 23.08.2026** |
| **K-51** | **Tab okunabilirliği, tek akor seçimi ve bölüm senkronizasyonu (§13.20, 2N-A).** Üç kusur önce mevcut build üzerinde, üretim koduna dokunmadan yeniden üretildi (`eval/tab/DEFECTS.json`, 5/5): uzun basış bütün legato zincirini seçiyordu, bölüm seçimi değişirken çizilen sekme aynı kalıyordu, kısa şarkıda seçilen bölümün ilk ölçüsü görünür yüzeye gelmiyordu. **Seçim onset önceliklidir:** basış bir onset grubunu alır, akor tek slottaki birden fazla `NoteEvent`'tir ve Contract'a akor nesnesi/tipi eklenmedi, bağ yeni onset değildir (`1 uzatılan nota`), seçim Song'a/dosyaya/fingerprint'e/Copilot'a girmez; **zincir kapsamı seçim anında değil, kullanıcı bir eylem seçtiğinde preflight sonucu olarak doğar.** **Zincir kararı çekirdeğin şartıdır:** `applyTransform`/`copySelection`/`commitTransform` açık `chainPolicy` olmadan zincir bölen komutu çalıştırmaz (`chain_policy_required`); beş tipli sonuç (`no_chain_impact`, `crosses_tie_boundary`, `crosses_legato_boundary`, `crosses_multiple_boundaries`, `crosses_section_boundary` = fail-closed); üç seçenek — bağlantıyla birlikte (gerçek genişletilmiş kapsam görünür, açıklama komutun kendi fiilinden merkezî command→copy tablosundan gelir), yalnız akor (deterministik atomik detach), vazgeç (0 yazma); **önizleme ile commit dört komut × iki policy'de byte-eş**. Detach: içerideki legato korunur, yalnız sınırı aşan bağ kaldırılır, `"normal"` kalıcı olarak hiç yazılmaz, öksüz bağ sus olur, öksüz `"-"` hiçbir durumda oluşmaz, yalnız bağdan başlayan seçim tipli reddedilir. **Bölüm navigasyonu tek otoritedir** ve `viewedSectionId` transport'un `activeBarKey`'inden türetilmez — bakılan bölüm ile çalan bölüm iki ayrı olgudur; playhead yalnız gerçekten çalınan bölüm görünürken çizilir; kısa şarkı `scrollLeft` ile değil ölçülen bir viewport genişliğindeki `data-tab-tail` ile çözüldü ve bu boşluk bar/seçim/seek hedefi değildir, arrangement sayısına, fingerprint'e ve export'a girmez, dokunulduğunda 0 seek / 0 seçim / 0 yazma. **Ritim dili:** teknik değer kalır, yanına sade okuma gelir ("4 ana vuruş · 16 adım"), "16 vuruş" hiçbir yerde yazmaz, 6/8 felt-beat'ten gelir, 7/8'e uydurma gruplama verilmez ("7 sekizlik · 14 adım"), hepsi tek saf formatter'dan. **1/4 grid** geriye dönük uyumlu eklendi (`4|8|12|16|24|32`), `resolution % denominator === 0` kuralına uyar, 6/8 ve 7/8'de önerilmez, şema literali `RESOLUTIONS`'tan türer, ikinci timing formülü ve yamalı liste yok, 64'lük grid yok. **Mevcut müziğin ölçü/ritim değişimi** metadata değil gerçek tick-preserving yeniden yazımdır: yalnız birebir temsil edilebiliyorsa notalanır, yuvarlama/clamp/truncate yok, tek track başarısız olursa işlem tamamen reddedilir, eksik anahtar sahte boş dizi üretmez, `bpmOverride` korunur, başarı = 1 yazma + 1 history, undo/redo byte-eş, tipli kodlar UI'a ham diagnostic sızdırmaz. **Beam rehberi perde okumaz** — fonksiyona nota girmez — bu yüzden gam iddiası yapısal olarak imkânsızdır; Contract'a alan eklemez, fingerprint/dosya/MIDI/Copilot'a girmez, dokunma hedefi veya listener üretmez, fret/glyph/seçim bandı/playhead ile çakışması ayrı ayrı 0, ekran okuyucuya "Ritim grubu" der; **tam notasyon motoru değildir** (sap yönü, polifonik dizgi, nüans, alternatif son, süsleme, sweep kapsam dışı). **Sınırlar:** yedi sorumluluk saf/tipli katmanlara ayrıldı, ölçüm import grafi ve export yüzeyi üzerinden, yeni grep testi ve yeni runtime dependency yok; wiring öncesi davranış-korumalı çıkarma ile `Workspace.tsx` 450 → **385** (bütçe gevşetilmedi), `ArrangementCanvas.tsx` 470 ve bu özelliği sahiplenmiyor. **Doğrulama:** 2.209 birim testi; 47 senaryo × 2 viewport = **94/94** gerçek production build'de; timing önizleme/vazgeç 0, uygula 1, undo 1, redo 1 yazma; MIDI meter `["4/4@0"] → ["3/4@0","4/4@576"]` ve onset'ler `[0,768,1536] → [0,576,1344]`; proje export/import 1/4'ü byte-eş taşıyor; döngü sınırı 0–2688 → 0–2496; **çalarken timing değişiminde transport duruyor** (`playing@588 → idle@1344`) ve bu gizlenmeden raporlanıyor; AudioContext 1 → 1. **29 vacuity probe kırmızı**; biri ilk turda yeşil geldi ("1/4 beam almaz") — koruma gerçekten boştu, gizlenmedi, kural `beamLevels`'ta kendi yerinde sabitlendi. Performans (Node + masaüstü Chromium, **telefon kanıtı değil**): 8 bar × 1/32 rehber ~0,042 ms (akorda ~0,049 ms, model tek başına ~0,024 ms), bölüm timing dönüşümü validatörlerle ~0,9 ms median (fixture: 1 bölüm, 8 ölçü, 1 track, 64 ses olayı — 2L-B/2M-A'nın 32 bar × 8 track worst-case validator ölçümleriyle karşılaştırılabilir değil), rehberin eklediği DOM 49 düğüm (iki viewport'ta aynı). **2N-A.1 düzeltmesi:** ilk raporda "playhead rAF 61,3 ↔ 60,5" diye verilen sayı ölçüm harness'ının kendi rAF döngüsüydü — ekranın tazeleme hızı, playhead'e ait değil. **Gerçek regresyon yok; üretim davranışı değişmedi.** Frame kuralı tek modülde toplandı (`playhead-loop.ts`) ve sayım hook seam'ine taşındı: aynı saniyede boşta global 61,3/s ↔ playhead callback 0; idle/paused/ended/unmount/dispose ve üç görünüm geçişinden sonra canlı loop 0, playing'de tam 1, timing değişimi idle'a aldıktan sonra 0 (10 ayrı ≥1 sn penceresi, 14/14 senaryo, 7 probe kırmızı). **Kapsam dışı:** yeni provider, Copilot kalitesi, ses motoru, yeni sample, gerçek kayıt senkronizasyonu, rakip özellikleri, tam notasyon editörü, fiziksel Android/iOS kabulü. **Kapanış (2N-A.1):** önceki "boşta 61,3 playhead rAF/s" iddiasının eval harness'ının global ekran yenileme döngüsünü ölçmesinden kaynaklandığı doğrulandı. Üretim yaşam döngüsü değişmedi: idle/paused/ended/unmounted/disposed durumlarında canlı playhead loop'u **0**, playing durumunda tam **1**'dir. | **Haktan onayladı 24.08.2026** |
| **K-52** | **Yerel proje kütüphanesi v1 (§13.21, 2O-A).** Aranjé artık aynı cihazda birden fazla projeyi saklar; kabul ölçütü listede birkaç şarkı görünmesi değil, **kalıcı kayıt ve kurtarma garantilerinin proje başına doğru çalışmasıdır**. Yerel kalır: hesap, sunucu, senkronizasyon yok; proje sayısında kota/paywall/uydurma tavan yok; proje yedeği her zaman ücretsiz ve doğrudan erişilebilir (K-50). **Kimlik** `project-<n>`, katalogdaki monoton sayaçtan; zaman damgası/UUID/`Math.random`/`crypto.randomUUID`/cihaz bilgisi yok, silinen kimlik yeniden dağıtılmaz, beş koşu byte-eş; tanınmayan kimlikten anahtar üretilmez. **Üç anahtar:** `aranje.projects` (katalog: `format`, `version`, `activeProjectId`, `projectIds`, `nextProjectNumber`), `aranje.project.<id>` (kayıt: `projectId`, `revision`, `updatedAt`, `current`, `previous`), `aranje.project-pending` (yarım silme notu). Kayıt zarfı şarkı zarfının aynısıdır — `decideLoad`, `previous` rungu ve revision kuralı yeniden kullanıldı, ikinci kurtarma yolu yok. **Yazma sırası kurtarılabilirliği belirler:** oluşturma biçimli işlemler payload → katalog (kesilirse sahiplenilebilir öksüz kayıt), silme not → katalog → payload → not (kesilirse açılış kullanıcının zaten verdiği onayı yerine getirir); not olmasa yarım silme ile yarım oluşturma ayırt edilemezdi. **Migration** eski `aranje.song`'u `project-1`'e taşır ve **eski anahtarı ancak yeni kayıt geri okunup doğrulandıktan sonra** siler; on üç başlangıç durumu ölçülerek karşılandı; bozuk katalog önce taramayla yeniden kurulur, katalogun bilmediği payload silinmez, dolu birinci slotun üzerine yazılmaz. **Beş saf komut** (create/open/duplicate/import-as-new/delete) tek iskeleti korur: reddet → katı şema + merkezî validator → payload yaz **ve geri oku** → sonra katalog → katalogu da doğrula; `now` enjekte edilir, React/saat/global yok. **Tek başlık otoritesi:** liste adı `Song.title`'dan türer, katalogda ikinci ad alanı yok, özet her açılışta şarkıdan hesaplanır. **`create_song` kaldırıldı** — "yeni şarkı" artık açık projeyi byte-eş bırakıp yeni proje açar ve dispatcher bilinmeyen komutta `undefined` değil tipli red döner. **Bir commit tam olarak bir proje anahtarı yazar**; undo/redo proje sınırını geçmez (geçişte geçmiş 0/0) ve proje değişimi geri alınabilir bir Song düzenlemesi değildir; açık projenin kaydı okunamaz hâle gelirse commit reddedilir ve bozuk byte'lar korunur. **Bayat sekme kayıp kapısı** (çoklu sekme senkronizasyonu değil): her commit öncesi diskteki `revision` yeniden okunur, farklıysa yazım reddedilir; atomik CAS olmadığı açıkça yazılıdır; bayat sekme yedek alabilir ve dinleyebilir. **Katalog, aktif proje kimliği, `revision`/`updatedAt` ve kurtarma metadata'sı fingerprint'e, Copilot isteğine ve `.aranje.json`'a girmez**; dosya formatı değişmedi. Ekranda ham `localStorage`/`JSON`/`Zod`/`revision`/anahtar adı/stack trace yok; kapalı hata kodu + tek tablo (eksik cümle derleme hatası). Silme onayı adı, şekli ve geri alınamazlığı söyler; çöp kutusu/bulut kurtarma yokmuş gibi davranılır çünkü yok; **son proje V1'de silinemez**; hayatta kalan `survivorIndex` ile seçilir ve açılamıyorsa silme hiç başlamaz. **Sınırlar:** yedi saf modül, controller altındaki depoyu component görmez, ölçüm import grafi + AST + ESLint restricted-import ile (yeni grep testi ve yeni runtime dependency yok); `Workspace.tsx` 385 → **380**, `ArrangementCanvas.tsx` 470 ve değişmedi, yeni mega-hook yok. **Doğrulama:** 2.342 birim testi (kütüphane 125), 55 senaryo satırı × 2 viewport = **110/110** gerçek production build'de fiziksel storage ledger'ıyla, **35 vacuity probe kırmızı / 0 vacuous**; ilk turda sekiz probe yeşil geldi, gizlenmedi — dördü gerçek test boşluğuydu ve testle kapatıldı, dördünün mutasyonu tehlikeyi ölçmüyordu ve hedefi düzeltildi. **İki dürüst performans bulgusu:** 50 projelik özet modeli 46,0 ms median (p95 66,4 / maks 98,0) — kötüdür, gizlenmedi ve sanallaştırma ölçülmeden eklenmedi; Chromium bu profilde worst-case boyuttaki yalnızca **6 projeyi** kabul edip yazmayı reddetti (~4,5 MiB) oysa `navigator.storage.estimate()` ~1,07 GB diyordu — `estimate()` bir söz değildir. **Kapanışta bulunan ve düzeltilen kusur:** adlandırma / dosyadan yeni proje / yerine koyma akışları için tarayıcı senaryosu yazılınca liste `useMemo`'sunun katalog kimliğine bağlı olduğu ve şarkı depo üzerinden değişince yenilenmediği çıktı — "özet şarkıdan türer" yerde doğruydu, zamanda değildi; liste artık her açılışta yeniden okunuyor, senaryo 51.b ve 35. probe ile bağlandı. **Kapsam dışı:** bulut, hesap, senkronizasyon, paylaşım, klasör/etiket/arama, çöp kutusu, sürüm geçmişi tarayıcısı, akor kurucu, çoklu enstrüman görünümü, release hardening, fiziksel Android/iOS kabulü. **Onay kapsamı:** yerel proje kütüphanesi; **proje başına dayanıklı kayıt**, **kayıpsız legacy migration**, **proje izolasyonu**, güvenli **oluşturma/açma/çoğaltma/import/silme** ve **bayat sekme kayıp kapısı** ile kabul edildi. **Çoklu sekme birleştirme veya atomik CAS iddiası yoktur.** **50 proje özet maliyeti** (ölçülen: **46,0 ms median / 66,4 ms p95 / 98,0 ms maks**) ve **cihaz kotasına bağlı gerçek proje kapasitesi** (masaüstü Chromium profilinde worst-case kayıtlarla **yalnız altı proje kabul edildi**, ~**4,5 MiB** civarında yazma reddedildi; aynı anda `navigator.storage.estimate()` ~1,07 GB diyordu) **ölçülmüş açık release riskleridir**. Bu kapasite sonucu nedeniyle ürün **localStorage üzerinde "sınırsız proje" garantisi vermez**; bulgu **K-52 kod kabulünü engellemez**, fakat **public release ve fiyatlandırma dilinde açık risktir** ve §16'da dördüncü owner kapısı olarak açık durur. | **Haktan onayladı 24.08.2026** |
| **K-53** | **Hızlı akor ve power chord kurucu v1 (§13.22, 2O-B).** Kullanıcı kök sesi, akor türünü ve çalınabilir bir şekli seçer; bütün notalar aynı vuruşa tek, geri alınabilir bir olay olarak yazılır. **Yönlendirme yoktur** — "önerilen/en kolay/en iyi/sonraki akor" ifadeleri kod tabanında bulunmaz (testle bağlı); etiketler betimleyicidir ("Açık konum · kök basta", "1. çevrim"). **Akor kalıcı bir nesne değildir:** Song Contract değişmedi, akor aynı onset'teki birden fazla `NoteEvent`'tir, `chordName`/`voicingId`/`shapeId` gibi alan eklenmedi ve `voicingId` Song'a/dosyaya/fingerprint'e/Copilot'a girmez (serialize edilen byte'larda testli). **On bir kalite tek tabloda**; aralık sayıları başka yerde tekrar edilmez, eksik kalite derleme hatasıdır; **requiredChordTones politikası tek yerde** — beşli yalnız yedililerde düşebilir, yarı eksilmiş 7 istisnadır. **Perdeli arama sözlük değil klavye taramasıdır:** akort, capo, tel sayısı ve perde sınırı track'ten okunur; mevcut `soundingMidi`/pitch/hand-position yardımcıları yeniden kullanıldı. El kuralı dört parmak + en alt perdede barre'dır ve "aynı perde iki kez = barre" varsayımı yanlış olduğu için açık D7'yi eleyen ilk kural düzeltildi. **Maksimum açıklık ölçülerek 2'ye çekildi**: beş klavyede 12 kök × 11 kalite = 660 kombinasyonun hiçbiri boşalmıyor. Am7'nin üç kanonik şekli (`x02010`, `577555`, `5x555x`) aday kümesinde ve her telin **sounding pitch**'i doğrulanarak. **Power chord kalıcı tip değildir**: formül `[0,7]`, iki ya da üç ses ve kök mutlaka basta olması shape kuralıdır; Drop D açık D5 gerçek akorttan bulunur, standard akortta bulunmaz. **Perdesiz enstrümanlarda** akor bir perde yığınıdır, `position` yazılmaz ve **sayısal enstrüman aralığı uydurulmadı** — `range.ts`'in erteleme kararı korundu. **Komut tikte çalışır** (K-34): tam oturmayan hedef/süre tipli reddedilir, yuvarlama yok, uzun akor tie ile taşınır, ya hepsi ya hiçbiri. **Dolu vuruş sessizce ezilmez**; bağlı onset ve karışık süre/velocity/ifade atomik reddedilir. **Önizleme ile commit aynı hesaptır** — ghost gerçek komutun çıktısıdır, Uygula aynı komutu tekrar koşar; önizleme ve varyasyon dolaşma 0 yazma / 0 history. **Dinleme mevcut PreviewEngine'i kullanır**; ikinci AudioContext/scheduler/bank yok, önizleme kazancı yalnız önizlemede kalır. Yazılan akor sıradan müziktir: seçim/transform/bar işlemleri/undo-redo/MIDI/WAV/proje dosyası paritesi testli. `Workspace.tsx` **379** (380 aşılmadı), `ArrangementCanvas.tsx` 470 ve değişmedi, yeni runtime dependency yok. **Üç dürüst bulgu:** (1) bütün klavye taraması 621 ms median — ürün bu yolu kullanmıyor (kök+kalite yolu 16,6 ms) ve **ölçmeden cache eklenmedi**; (2) yoğun akor 0 dB'de tepe 1,8090 ile tam ölçeği aşıyor ve encoder kırpardı, şablonların verdiği −6 dB'de 0,9066 ile içeride kalıyor, sahibi mixer'dır, limiter eklenmedi; (3) **mevcut ürün kusuru bulundu** — bütün launch şablonları `electric_guitar/clean` veriyor ve o preset'in vendor edilmiş sample pack'i yok, yani yeni kullanıcının gitarı hiç ses çıkarmıyor; 2O-B'nin sebebi değil ama "Dinle" tam da o track'te sessiz kalıyor, tek taraflı değiştirilmedi ve sahibe bırakıldı. **Bir ölü koruma kaldırıldı:** perdesiz register ceiling ölçüldüğünde 4.040 yazılabilir yığının hiçbirini kesmiyordu; ateşlenemeyen koruma koruma değildir. **İki kabul boşluğu açık:** perdesiz enstrümanlar için repoda sayısal aralık yok ve klavye düzenleme yüzeyi yok — saf çekirdek eksiksiz ve testli, UI yüzeyi bugün yalnız perdeli track'lerde var ve uydurma bir klavye editörüyle kapatılmadı. **Kapsam dışı:** akor dizisi önerisi, scale-aware öneri, voice leading, add9/6/9/11/13/altered, slash/polychord, arpeggiator, strumming motoru, sweep, parmak numarası, MIDI/audio akor tanıma, 64'lük grid, çoklu enstrüman editörü, cloud/hesap/paywall, gerçek provider, release hardening, fiziksel Android/iOS kabulü. | **Haktan onayı bekliyor** |
| **K-54** | **Açılış ses bütünlüğü, paylaşılan preview bank ve ifade ölçümü (§13.23, 2O-B.1 + 2P-A).** **2O-B.1 üç ölçülmüş sorunu kapatır.** (1) *Kayıtta olmak duyulabilmek değildir:* `electric_guitar/clean` gerçek, core, seçilebilir bir preset'ti ve vendor edilmiş pack'i yoktu, iki launch şablonu yeni okura tam olarak o track'i veriyordu; `AudioPresetAvailability` bu ikinci soruyu sahiplenir ve **Song Contract'ın parçası değildir** — hiçbir availability alanı şarkıya yazılmaz, dosyaya çıkmaz, fingerprint'e girmez (serialize edilen byte'larda ve validator zincirinde testli). Şablon artık duyulabilir ilk core preset'i seçer (`high_gain`) ve duyulabilir preset'i olmayan enstrüman için track üretmek yerine reddeder; `clean` registry'de anlamını korur. **Legacy şarkı düzeltilmez, doğrusu söylenir:** `silentTracks` şarkıyı okur ve asla yazmaz, cümle okurun kendi track adlarını kullanır, preset/pack id'si, URL, manifest adı ve hata kodu ekrana çıkmaz; seçici duyulamayan preset'i sıradan seçenek gibi sunmaz ama track'in **zaten taşıdığı** değeri listeden düşürmez (düşürmek ilk tuş vuruşunda başka bir preset'i şarkıya yazdırırdı). (2) *Paylaşılan preview bank:* `getOrLoad(context, bankKey, load)` tek yükleme kapısıdır — uçuştaki iki çağrı tek fetch/tek decode/tek promise, başarısız yükleme hatırlanmaz ve tahliye kimlik üzerinden korunur, retention context başına açılır ve son tüketici bırakınca bank dispose yerine retention'a geçer; offline render retention açmaz. **Kapanışta gerçek bir üretim hatası bulundu:** retention `this.disposed` kontrolünden sonra açılıyordu, terk edilmiş motorlar bank'lerini kimse tutmadan bırakıyordu ve 25 dinleme hâlâ 175 istek çıkarıyordu; sıra düzeltildi ve sırayı geri alan bir birim testiyle bağlandı. Aynı harness ile önce/sonra **175/175 → 7/7**, AudioContext 1 → 1, kapanıştan sonra yeni ses 0, dispose sonrası aktif ses 0. (3) *Seviye ve kırpma yalnız ölçüldü:* `HEADROOM.json` dört kazanç yaklaşımını **yalnız eval tarafında** karşılaştırır, **production'a limiter veya normalizer eklenmedi**; kodlayıcı ±1 dışını kırpmaya devam eder ama artık sessizce değil — kaç örnek ve kaç çerçeve kırpıldığı geri döner ve kullanıcıya karıştırıcıyı işaret eden bir cümle gösterilir. Ölçülen: altı sesli Am7 track 0 dB'de tepe **1,8090** ve **788** kırpılmış çerçeve, −6 dB'de tepe **0,9066** ve **0** kırpılmış çerçeve; ayrıca sert pan (1,2822 / 18 çerçeve) ve iki gitarın ikilemesi (1,6156 / 322 çerçeve) varsayılan −6 dB'de de kırpıyor. **2P-A bir ölçüm ve tasarım turudur; production migration yoktur.** On bir artikülasyon değişmedi, tek `articulation` alanı yerinde, hiçbir enum eklenmedi, **bugünkü bend/slide varsayılanları değişmedi**; üretilen şey 42 render, kör adlandırılmış dinleme dosyaları + ayrı `KEY.json`, `MEASUREMENTS.json` ve bir **tasarım belgesi**dir (`EXPRESSION-CONTRACT-V2.md`). Beş hipotez varsayılmadı, tek tek sınandı; ikisi doğrulandı: bugünkü bend'in sorunu %22'lik yükseliş sabiti değil **zorunlu sıfıra dönüş**tür (hedefe 1,5 s'lik notanın %30'undan önce varıyor ve her zaman iniyor) ve bugünkü slide **yalnız legato** taşır (hedef atak oranı **0,98**, gerçek yeniden vuruş **619**), legato adayı bugünküyle bayt bayt aynıdır. **Rakip sınırı:** beş resmî Songsterr/Guitar Pro adresinin hepsi bu ortamdan **403** döndü — `referenceAudioAvailable: false` **ve** `sourceTextAvailable: false`; hiçbir davranış, eğri veya DSP sabiti hiçbir rakibe atfedilmedi, hiçbir rakip sample'ı kopyalanmadı, binary inceleme/decompile/ağ isteğinden URL ayıklama yapılmadı ve "reverse engineered" ifadesi hiçbir belgede aday için kullanılmadı (testle bağlı). **Ölçüm aracının kendisi yanlış olabilir:** bu turda beş enstrüman hatası bulundu ve düzeltildi — AudioContext'i subclass eden sayaç Tone'un decoder'ını bozup uydurma bir sonuç üretti (şeffaf `Proxy`'ye geçildi), F0 platosu iki kez seçim yanlılığıyla okundu (+208,9 ve +206,3 yerine bölgeyi değerden bulup değeri bölgeden okuyunca **+200,65**), ölçüm penceresi sonraki notayı yakalıyordu, mantıksal ses ile fiziksel kaynak ayrılmadığı için shift adayı legato ile aynı maliyette görünüyordu (şimdi legato 1/1, shift 1/2, crossfade 1/2), fret gürültüsü penceresi patlamanın dışındaydı. **Kapanışta bulunan ikinci ürün kusuru:** yepyeni bir şarkı hiçbir yüzeyden ilk notasını alamıyordu — şablonun barlarında, şablonun az önce kurduğu track için anahtar yoktu ve eksik anahtar hem "burada sessiz" hem "bu barda yazılı değil" demek olduğu için yazma yolu reddediyordu; **launch şablonları için kapatıldı** (barlar artık track başına boş şerit taşıyor). **Açık kalıyor:** `create_track` bar anahtarı eklemiyor, yani mevcut bir şarkıya eklenen ikinci track aynı çıkmaza giriyor; bu "bu barda yazılı" ifadesinin ne anlama geldiğine dair bir ürün kararıdır ve tek taraflı verilmedi. **İkinci açık bulgu:** 320×700'de transport satırı 344 px istiyor, practice-rate düğmesi 24 px kırpılıyor ve kök `overflow-x` gizli olduğu için sayfa kaydırmıyor — içerik görünmeden kayboluyor; 2O-B.1'in eklediği bildirim bandı o fixture'da render edilmiyor, yani nedeni bu checkpoint değil. **Doğrulama:** 2.597 birim testi / 155 dosya; 32 senaryo × 2 viewport = **63/64** (tek başarısızlık kayıtlı 320 px taşmasıdır); 42 render'da **23/23** ölçüm iddiası; preview bank 18/18; ses iddiaları 14/14; 2O-B regresyonu 160/160 ve 13/13 — **değişmedi**; **40 vacuity probe kırmızı / 0 boş**. Üçü ilk turda yeşil geldi ve gizlenmedi: açılış seviyesini hiçbir test iddia etmiyordu (HEADROOM ölçümünü geri okuyan test eklendi), tie probe'unun mutasyonu bağlı bend fixture'larının hiç uğramadığı bir kolu hedefliyordu (gerçek mekanizmaya taşındı), matrisin sözleşmeyi kapsadığını iddia eden test yoktu (eklendi). **Performans** (Node + masaüstü Chromium — **telefon kanıtı değil, eşik uydurulmadı**): availability sorgusu 0,001 ms, şablon materyalizasyonu 0,025 ms, bank sıcak arama 0,001 ms, ifade planı (demo şarkı) 1,709 ms / p95 4,999 ms, bir saniyelik F0 analizi **357,578 ms** (yalnız eval; production yolunda çağrılmıyor); tarayıcıda ilk (soğuk) akor dinlemesi 208 ms medyan, ısınmış dinleme 77 ms, 25 varyasyon değişimi toplam 2.082 ms, sheet kapatma + dispose 31 ms, varsayılan şablonun ilk sesi 214 ms. **Bir disiplin ihlali kaydedilmiştir:** `1a962b3` commit'inde `npm test | tail` çıkış kodunu kaybettiği için kırmızı bir koşunun ardından commit atıldı; o commit'te ağaç yeşildi (art arda 8 koşu, 2.571/2.571) ve tek hata yeniden üretilemedi, ama ihlal gerçekti ve sonraki commit'te kaydedildi. **Kapsam dışı:** Expression Contract v2 production migration'ı, yeni articulation enum'ları, sweep/TechniqueSpan, global mastering, ölçmeden limiter, harici sample indirme, rakip asset çıkarma, 64'lük grid, stem/MP3, cloud/hesap/paywall, gerçek provider, release hardening, fiziksel Android/iOS kabulü. **İnsan dinlemesi yapılmadığı için hiçbir aday kazanan ilan edilmemiştir.** | **Haktan onayı bekliyor** |
| **K-55** | **Senkron çoklu-enstrüman görünümü, yazılabilir track ve mobil transport (§13.24, 2Q-A).** Üç ölçülmüş kusur kapatıldı. **(1) Eksik bar anahtarı iki şey birden söylüyordu:** "burada sessiz" (§5.5) ve "bu barda yazılı değil". Yeni kurulan track hiçbir hücresine nota alamıyordu. **Song Contract'a alan eklenmedi;** ayrım şekilde yapılır ve tek modül sahiplenir (`lib/song/track-lanes.ts`): eksik anahtar = yazılı değil, açık boş şerit (baştan sona `null`, davulda `[]`) = yazılı ve sessiz. `create_track` artık her bara boş şerit koyar — uzunluk barın kendi ölçü işareti ve çözünürlüğünden, şekil enstrüman kaydından gelir; işlem idempotent'tir ve değişecek bir şey yoksa aynı nesneyi döndürür. **Legacy şarkı düzeltilmez:** yazılı olmayan bara ilk nota **tek aday, tek write, tek undo** olarak yazılır; nota reddedilirse aday bütünüyle atılır ve geride boş şerit kalmaz. Sus, uzatma ve silme şerit materyalize etmez. **Ses değişmedi:** iki sessizlik için `buildSongPlan`, `buildNotatedPlan` ve `barTimeline` bayt bayt aynıdır. **(2) 320×700'de transport'un bir kontrolü ekranda yoktu** (355,7 px isteniyor, 320 px var; pill'in 23,7 px'i kabuğun `overflow-hidden`'ı tarafından kırpılıyor). Çözüm boşluk, çıkarma değil: 360 px'lik `--breakpoint-xs`; altında boşluk ve dolgu daralır, çal düğmesi 44 px kareye iner. Hiçbir kontrol kaldırılmadı, ikinci satıra taşınmadı, ikinci scroller açılmadı, overflow ile hiçbir şey saklanmadı. Sonuç 307,7/320, kırpılan 0, 44 px altı 0, body taşması 0 — üç görünümde ve sheet açıkken. **Pay 12,3 px'tir ve bu bir uyarıdır:** ilk denemede yalnız çal düğmesini eski hâline döndüren probe 0,3 px farkla yeşil kaldı; bu, testin değil payın bulgusudur ve kayda geçmiştir. **(3) Çoklu görünüm:** `WorkspaceView` üç değerli (Düzen · Çoklu · Tab); bir bölümün bütün enstrümanları dikey yığılır. **Tek yatay scroller** (şeritler onun içindedir), **tek zaman ekseni** (ölçü işareti ve çözünürlük bara ait olduğundan hizalama bakımla değil tanım gereğidir), **tek playhead ve tek rAF** (paylaşılan `runPlayheadLoop`; transport başka bölümdeyse sütun çizilmez), **tek aktif düzenleme track'i** (düzenleme makinesi yalnız aktif şeride verilir; pasif şeritte uzun basış seçim açmaz). Bar genişliği slot sayısından gelir, tick süresinden değil — bilinçli okunabilirlik kararıdır ve tick süresi modelde taşınır. Şerit türü enstrümanın olgusudur: fretted / drums / **pitched**; pitched şeritte **tel ve perde uydurulmaz** ve bu bir piyano notasyonu değildir. Sessiz track listeden düşmez. Bir şeride dokunmak yalnız onu aktif eder: yatay konum, çalma ve bakılan bölüm değişmez, depoya yazılmaz. **Takip nezaketi tek modüle indi** (`use-scroll-takeover.ts`) — kapanışta bulunan gerçek kusur buydu: şerit aktif etmek yeniden render tetikliyor, döngü çalışmasa da bir kez boyuyor ve o boyama okuru duraklamış playhead'e geri sürüklüyordu. Görünüm ve katlama **oturumluktur**; Song'a, depoya, dosyaya, fingerprint'e ve Copilot'a girmez, bayat değer okunduğu yerde çözülür. **Brief'in "10 track" hedefi uygulanamaz:** `songLimits.maxTracks` **8**'dir ve bu merkezî sınırı gizlice yükseltmek ölçümü yalan yapardı; kabul sekiz track tavanında yapıldı. **Açık ürün boşluğu:** davul için okur yüzeyli bir nota editörü yoktur (`isEditableTrack` davulda false), bu yüzden "tek komutla ilk davul vuruşu" bu build'de production yolundan test edilemez; sahte bir UI veya test yüzeyi üretilmedi. Çoklu görünümde davulun çizimi, hizalanması, aktivasyonu ve şerit materyalizasyonu doğrulanmıştır. **Doğrulama:** 2.693 birim testi / 161 dosya; 65 senaryo × 2 viewport = **130/130**; **37 vacuity probe kırmızı / 0 boş / 0 atlanan** (31 birim + 6 tarayıcı). Dördü ilk turda yeşil geldi ve gizlenmedi: `isEditableTrack` guard'ını düşürmek etkisiz çıktı (kit'in fretboard'u yok, komut zaten reddediliyor — probe adayın okurun şarkısına sızmasına çevrildi), `slotX` testi slot genişliğinin bileşenin sabitine eşit olduğu bir fixture üzerinde ölçülüyordu (test farklı genişlikte yeniden soruldu), nota editörü olmayan track'e `set_note` için hiç test yoktu (eklendi), ve yukarıdaki 0,3 px payı. İki tarayıcı probe'u tehlikeli olmak için iki guard'ın birden düşürülmesini gerektirdi; ikisi de probe dosyasında yazılıdır. **Performans** (Node + masaüstü Chromium — telefon kanıtı değil): `eval/multitrack/artifacts/PERFORMANCE.json`. **Kapsam dışı:** production bend/slide davranışı ve kör dinleme paketi (dokunulmadı; ZIP ve `SEALED_KEY.json` SHA-256'ları değişmedi), Expression Contract v2 migration'ı, yeni articulation enum'ları, Song Contract'a görünüm alanı, görünüm tercihinin dosyaya yazılması, track'ler arası seçim, bu görünümde mikser kontrolü, ücretsiz/premium track sınırı, faturalandırma, sağlayıcı/Copilot API değişikliği, ölçmeden virtualization, şerit başına scroller/rAF, fiziksel Android/iOS kabulü. | **Haktan onayladı 25.08.2026** |
| **K-56** | **Enstrümanlar arası nota girişi ve kabul harness'larının yenilenmesi (§13.25, 2Q-B).** K-55'in kendi kapanışında yazdığı ürün boşluğu kapatıldı: davulun okur yüzeyli editörü yoktu, ve aynı boşluk perdesiz enstrümanlarda da vardı. **Tek komut çekirdeği** (`lib/song/event-entry.ts`): hedef bir *an*dır (`{sectionId, trackId, ticks}`), bar ve slot ondan bulunur, **hiçbir şey yuvarlanmaz** — ızgaraya oturmayan tick reddedilir, çünkü yardımcı bir kaydırma okurun çalmadığı müziği yazar. Her komut bütün bir aday kurar ve tab'ın kullandığı aynı `settle` kapısından geçer; reddedilen aday bütünüyle atılır. **Davul step grid:** satırlar şarkının kullandığı parçalar ∪ çekirdek set, notasyon sırasında; boş kitin de satırı vardır (yoksa ilk vuruşun ineceği yer olmaz). Bir dokunuş bir komuttur ve kararını son render'dan değil şarkıdan sorar. Sertlik **Contract'ın kendi semantiğidir** (velocity + `normal|ghost|accent`); ikinci bir ifade sistemi kurulmadı. Son vuruş kalkınca **şerit yerinde kalır**. **Perdesiz nota şeridi:** piyano rulosu değildir ve dikey ekseni **yoktur**, çünkü registry hiçbir enstrüman için sayısal aralık tutmaz; uydurulmuş bir aralık, enstrümanın çalamayacağı notaları ekrana koymak olurdu. Şerit bir sıra andır; nota sorulur. Oktav adımlayıcısının sınırları **Song Contract'ın grameridir** (-1..9), açılış oktavı **şarkıdan okunur**. Nota okunur dilde anlatılır ("Nota: La · Teknik: A3 · Oktav: 3") ve **enarmonik yeniden yazılmaz** (`Bb3` "Si bemol"dur). Notaya tel/perde yazılmaz. **Sesi olmayan enstrümanda Dinle kapalıdır** ve tek cümle söyler: *"Bu enstrümanın sesi bu sürümde bulunmuyor. Notaları düzenleyebilir ve MIDI olarak dışa aktarabilirsin."* Sahte önizleme, sahte örneklem, ikame enstrüman üretilmedi; aynı kural akor kartlarındaki Dinle için de geçerli. **Akor kurucusu perdesiz track'lere açıldı:** klavye voicing'leri 2O-B'de zaten vardı, eksik olan kapıydı. Akor gerçek nota yazar, metadata değil; `position` yazılmaz; "en iyi çevrim" etiketi üretilmez. **Kabul, perdesiz track'i production `.aranje.json` içe aktarma akışıyla açar** — depoya elle yerleştirilmiş gizli bir test şarkısıyla değil — çünkü bu enstrümanlar production'da yalnız o yoldan gelebilir. **Kabul koşusunun ilk turunda iki production kusuru bulundu ve düzeltildi:** (1) `editGate` hâlâ "yalnız akordu olan telli track'ler" diyordu, yani step grid ve nota şeridi yazılmış ama hiçbir okur açamıyordu — kapı artık enstrümana bakmaz, cümle **doğru olmadığı için** kaldırıldı; yan bulgu olarak Copilot önerisi ekrandayken gösterilen yanlış cümle de düzeltildi. (2) `create_track` sonrası okur eski track'te kalıyordu, yani «yeni davul → ilk vuruş» zinciri yanlış enstrümana yazıyordu; `createdTrackId` iki şarkıyı **kimlikten** karşılaştırır. **Harness modernizasyonunda bulunan iki production kusuru ayrıca:** (A) `replace_track_setup_and_clear_content` bar anahtarlarını siliyordu, yani enstrümanı değiştirilen track bir daha yazılamıyordu — komut artık yeni enstrümanın şeklinde açık boş şeritler bırakır; (B) `SettleOutcome` kurtarma durumunu taşımadığı için `asLoadResult` onu `storage_unavailable` diye uyduruyor ve okura yanlış sebep gösteriyordu — `recovery` uçtan uca geçirildi. İkisi de önce ayrı regresyon testleriyle kırmızıya bağlandı. **Büyük yazı:** transport'un dokunma hedefleri `rem` olduğu için okurun %150 metin ayarında 66 px'e çıkıyor ve 320 px'de satır 460,6 px istiyordu — iki kontrol ekran dışındaydı (ölçüldü). Hedefler, boşluklar ve dolgular piksele sabitlendi; iki telefon platformu da böyle yapar. 320 px'de %150'de satır **sarar** ve bu raporlanır: kabul tek satırlık olmayı değil erişilebilirliği ölçer (kırpılan 0, body taşması 0, hepsi 44 px). 2Q-A'nın `--breakpoint-xs`'i kullanımsız kaldığı için kaldırıldı. **Parite:** elle ve komutla yazılan aynı müzik beş tüketiciden de aynı çıkar (Song baytları, `sameSong`, playback planı, MIDI planı, proje dosyası). Paritenin ölçülmüş bir sınırı kayda geçti: iki şarkı da `songSchema.parse`'tan geçtiği için **anahtar sırası hiç farklılaşamaz**; iddia değerlere ve slot içi vuruş sırasına dayanır. **Ölçülerek bulunan iki vacuity üründen silindi:** hiçbir komutun döndüremediği `instrument_range_unavailable` kodu, ve `landOn`'daki `Number.isInteger` kontrolü (kesirli tick zaten modulodan geçemez; işi yapan yarı işaret kontrolüdür). **Doğrulama:** 2.829 birim testi / 175 dosya; **182/182** kabul senaryosu (2 viewport × {100, 125, 150}% metin); **51 vacuity probe kırmızı / 0 boş / 0 atlanan** (45 birim + 6 tarayıcı). On ikisi ilk turda yeşil geldi ve hiçbiri gizlenmedi — beşi eksik testti (yazıldı), ikisi yeterince tehlikeli olmayan mutasyondu (sertleştirildi), ikisi iki yolun da aynı cevabı verdiği fixture'lardı (ayrıştırıldı), üçü üründeki gerçek bulgulardı (ölü kontrol, üretilemeyen kod, zod'un anahtar sırasını normalize etmesi), ve biri `flex-wrap` sonrası rem hedeflerin tek başına tehlikeli olmaktan çıkmasıydı (probe gönderilen kusuru birebir üreten mutasyona çevrildi). **Performans** (Node + masaüstü Chromium — telefon kanıtı değil): `eval/cross-instrument/artifacts/PERFORMANCE.json` ve `PERFORMANCE-BROWSER.json`. Bir yazma komutu worst-case şarkıda ~17 ms'dir ve neredeyse tamamı `settle`'dır — tab'ın kendi düzenlemelerinin ödediği maliyetin aynısı, yeni bir maliyet değil. Bir davul dokunuşu ~32 ms ölçüldü; 60 Hz'de iki kare 33 ms olduğundan ölçülen şey komut değil kare sınırıdır ve öyle raporlanır. **Kapsam dışı:** sürekli kayan çalma yüzeyi (kendi görsel/performans kabulüyle ayrı prompt'a bırakıldı), production bend/slide davranışı ve kör dinleme paketi (dokunulmadı; ZIP ve `SEALED_KEY.json` açılmadı), piyano rulosu, mikser, DAW dönüşümü, perdesiz enstrümanların lifecycle'a eklenmesi, ölçmeden virtualization, fiziksel Android/iOS kabulü. | **Haktan onayladı 25.08.2026** |
| **K-57** | **Sürekli okuma yüzeyi v1 ve yatay windowing (§13.26, 2Q-C).** K-56'nın kapanış kaydında açıkça bırakılan iki borç kapatıldı: sürekli kayan takip modeli ve yatay windowing. **Kusur ölçüldü, tarif edilmedi.** Aynı harness `d89c193` üzerinde yeniden koşuldu (`eval/continuous-follow/BASELINE-STEADY.json`): dört saniyelik çalmada yüzey ~355 karenin **4-23'ünde** hareket ediyor, geri kalanında duruyor ve sonra tek karede **148-770 px** sıçrıyordu; medyan sıfır-olmayan sıçrama **146-197 px**; Tab'da playhead **9-15 karede hiç çizilmiyordu**. Durduğu kareler tam da playhead'in sağ kenara sürüklendiği kareler olduğu için okurun önündeki boşluk — çalarken işe yarayan tek kısım — sıçrama onu geri verene kadar sürekli küçülüyordu. **Sonra, aynı harness, aynı fixture'lar** (`AFTER.json`): hareket **314-360/360 kare**, kararlı en büyük sıçrama **7-17 px**, yarım ekrandan büyük kararlı sıçrama **her satırda 0**, medyan **3-11 px**, boş playhead karesi **her satırda 0**. Tab'daki tek 400-611 px'lik hareket `firstMovePx` ile birebir aynıdır: çal'a basıldığında görüşün transport'a geri verilmesi — bir kez, kasıtlı. **Okuma çapası** `FOLLOW_ANCHOR_FRACTION = 0.32` tek merkezî sabittir ve hiçbir bileşen ikinci kopyasını tutamaz (sözdizimi ağacından ölçülür, grep'le değil); formül `playheadContentX − viewportWidth × 0.32`, clamp'lı. Şarkının başı ve sonu **ayrı kural değil clamp'ın kendisidir**; kaydırma konumun fonksiyonu olduğu için birikip sıçramaya dönüşecek durum yoktur, **seek hiçbir ara konumdan geçmez** (tarayıcıda ölçüldü) ve hiçbir yerde `behavior: "smooth"` yoktur. Şarkı sonunda **müzikal olmayan bir kuyruk** vardır: eksende yok, tick yok, bar anahtarı yok, export'ta ve fingerprint'te yok. **Tek eksen** (`lib/tab/song-axis.ts`): bar genişliği slot sayısı × slot genişliğidir, **tempo formülde geçmez**, tick süresiyle orantılı değildir, ve `pointAtX` en yakın ızgaraya yuvarlamaz. İki eski cevap silindi: `lib/multitrack/geometry.ts` ve `components/workspace/playhead.ts`. **Yatay windowing** saf aritmetiktir; `beforePx + renderedPx + afterPx` her konumda ekseni tam verir (`afterPx` çıkarmayla) ve **yeni runtime dependency yoktur**. **Overscan varsayılmadı, ölçüldü** (`OVERSCAN.json`, beş aday, 1/32 + 260 BPM + %150 pratik + 320 px + 1 ve 2 kare commit gecikmesi + 83,3 ms takılan kareler): `0+0` 7-60 boş kare, `0,25+0,25` fling'de 3-21 boş kare, `0,5+1` her satırda 0 — en küçük temiz aday seçildi. İlk iki aday kasıtlı olarak yetersizdir. **Çoklu görünüm bütün şarkı oldu**; bölüm sınırında yeniden kurulan model/eksen/scroll içeriği kalmadı, `buildMultiTrackModel` bölüm argümanı almıyor. **Bakılan bölüm artık bir kaydırma konumudur** ve yüzeyin sol kenarından okunur; okur kendi eliyle kaydırdığında bu açık bir olaydır ve görüşü devralır. **Playhead saklanmıyor:** `playheadBelongsHere` kuralı tek-bölüm yüzeyinin sonucuydu, tek yüzeyde satırın dürüst bir yeri var. **"Çalmaya dön"** ≥44×44'tür, transport satırında değildir ve **playback tick'ine dokunmaz**. **Azaltılmış hareket** gerçekten okunur ve ayrı context'te ölçülür: kare başına kaydırma yok, ikinci rAF yok, playhead her karede çizili ve hiç ekrandan çıkmıyor. **Etkileşim windowing'den etkilenmez** — DOM bir çizimdir: bölüm navigasyonu artık `querySelector([data-bar-key])` değil `xAtBarKey` kullanır (mount edilmemiş barı bulamaz ve sessizce hiçbir şey yapmazdı). Kaydırma ve okuma **sıfır depo yazımı** yapar; Song, playback planı, MIDI planı ve proje dosyası bayt bayt aynıdır ve dışa aktarılan metinde hiçbir görünüm kelimesi geçmez. **Yazma yüzeyi bilerek windowed değildir:** silahlanmış davul grid'i ve nota şeridi bir bölümü bütünüyle çizer ve o bölümün eksendeki x'ine yerleştirilir. **Sınırlar:** `Workspace.tsx` 375 → **373**, `ArrangementCanvas.tsx` 470 ve değişmedi, `MultiTrackCanvas.tsx` 319 (≤500), `TabCanvas.tsx` 511 → **452** ve **ilk kez bir bütçesi var (480)**. **Doğrulama:** 2.899 birim testi / 176 dosya; **196/196** kabul senaryosu (88 farklı senaryo × 2 viewport, 4 fixture, iki yüzey, azaltılmış hareket ayrı context'te); **47 vacuity probe kırmızı / 0 boş / 0 atlanan**. **Ölçüm aracında bir hata bulundu ve düzeltildi:** `instrument.mjs`'in playhead regex'i bir template literal'in içindeydi ve `\(` orada yalnız `(` olduğu için desen hiçbir zaman eşleşmiyordu — `playheadX` bugüne kadar hep null'du. Hiçbir raporlanmış sayı o alanı kullanmıyordu, ama kullanamazdı da; düzeltildikten sonra çapa iddiası tarayıcıda ölçülebildi. **Yedi probe ilk turda ölçüsüz, beşi boş geldi ve hiçbiri gizlenmedi:** yedisi yanlış anchor'dı (düzeltildi), ikisi tek bölümlü fixture üzerinde tehlikesiz kalan mutasyondu ve **iki eksik testi ortaya çıkardı** — hiçbir test bir şeridin bütün bölümleri taşıdığını, ve hiçbir test perdesiz şeridin slotlarını barın kendi bölümünden okuduğunu iddia etmiyordu (ikisi de yazıldı), üçü de mutasyonun testin baktığı yolu ıskalamasıydı (sertleştirildi). **Kabul koşusunda bir production kusuru bulundu ve düzeltildi:** bir bölüm sıçraması üç konumdan geçiyordu (`4635 → 2754 → 16`) — yüzey "bir barı görüşe getir" isteğinin tek çeşit olduğunu sanıyor, her birini açık bir seek gibi ele alıp görüşü transport'a geri veriyor, ve duraklamış playhead şarkının başında olduğu için bir sonraki boyama okuru oraya sürüklüyordu (2Q-A'nın "defect C"sinin aynısı, yeni bir kapıdan). Bir bara dokunmak transport'u da taşır, bir bölüm seçmek yalnız görüşü; istek artık hangisi olduğunu taşıyor. Önce tarayıcı senaryosuyla kırmızıya bağlandı. **Ayrıca dört harness kusuru bulundu ve düzeltildi:** yanlış regex, `mouse.wheel`'in imleç (0,0)'da olduğu için yüzeye hiç ulaşmaması, duraklamadan hemen sonra okunan "canlı rAF" sayısının kare gecikmesini ölçmesi, ve dinleyici büyümesinin yalnız eklemeleri sayması — türe göre bakıldığında büyüyen şey **ses motorunun voice başına `ended`** dinleyicisiydi (2,5 saniyede 188), yüzeyin değil. **Performans** (Node + masaüstü Chromium — telefon kanıtı değil, eşik uydurulmadı): `PERFORMANCE.json` — eksen kurulumu 0,005-0,010 ms, bütün şarkının Çoklu modeli 0,182-1,843 ms, **bir kare (konum + takip hedefi + pencere + karşılaştırma) 0-0,002 ms**, bin kare 0,127-0,309 ms. **Açık kalan performans borcu, dürüstçe:** K-56'nın kaydettiği yoğun davul dokunuşu bu turda **düzelmedi** — sekiz track'te medyan 105 → **100 ms**, p95 138 → **153 ms**; maliyet komutta ya da takipte değil, **bilerek windowed olmayan step grid'in kendisindedir**. Silahlanmış yüzeyin DOM'u 3.933 → **2.323** düğüme indi ama dokunuş bundan faydalanmadı. **Kapsam dışı:** dikey virtualization, düzenleme yüzeyinin windowing'i, arrangement'ta sürekli kaydırma, piyano rulosu, yeni perdeli lifecycle, yeni sample pack, 64'lük grid, Expression Contract v2, production bend/slide değişikliği, Sweep/TechniqueSpan, track'ler arası seçim, mikser şerit kontrolleri, ses kaydı, MIDI klavye girişi, cloud/hesap/paylaşım, topluluk kütüphanesi, fork/remix, sosyal akış, faturalandırma, sağlayıcı/Copilot API, fiziksel Android/iOS kabulü. **Kör dinleme paketine dokunulmadı:** ZIP `e325ff96b6a83dce281d7144ac6996aa1e7ac455d9f3ea06c833ce84a7c0e0f6` ve `SEALED_KEY.json` `5aad28fd8760d9c4ea8042ded5fc3aaecc1064008169ca637fe1d9ec60b52b30` doğrulandı, anahtar açılmadı, hiçbir aday kazanan ilan edilmedi, K-54 kapatılmadı. | **Haktan onayladı 25.08.2026** |
| **K-58** | **Pratik Döngüsü v1 ve davul ızgarası performans kapanışı (§13.27, 2R-A).** **Practice Loop v1 tamamlandı.** Bir aralık üç kapıdan gelir — tek ölçü, iki ölçü (sıra fark etmez), ve tam ölçü sınırlarına oturan bir `TimeSelection` — ve üçü de aynı `land()`'den geçtiği için aynı kanonik `PracticeRange`'i üretir. Ölçü ortasından başlayan bir seçim **yuvarlanmaz, snap edilmez**: `requires_full_bars` ile adıyla reddedilir. Bölüm sınırını aşan çift `different_sections` ile reddedilir. Zincir preflight **üç sonuç** verir (`no_chain_impact`, `include_connection`, red) ve bölüm dikişinde **fail-closed**'dur: `sixeight`'in ilk ölçüsü önceki *bölümde* başlayan bir sesi sürdürdüğü için orada aralık hiç üretilmez. Okura gösterilen hiçbir cümlede `hammer_on`, `pull_off`, tick ya da hata kodu yoktur — bu, `messages.test.ts`'te bir kural olarak tutulur ve bir reddin kendi tanımlayıcısını yazdırması ayrıca yasaklanmıştır. **`PlaybackLoop` tek otoritedir** (`none | section | practice_range`): bölüm döngüsü ve pratik aralığı aynı anda etkin olamaz, ve loop state undo/redo'ya, export'a, proje dosyasına, fingerprint'e ve Copilot'a girmez. **Count-in aralığın kendi ilk ölçüsünden sayılır** ve merkezî `slotsPerFeltBeat`'i kullanır; tarayıcıda ölçüldü: 4/4'te kapalı `233 ms`, bir ölçü `1.900 ms`, iki ölçü `3.717 ms`; 6/8 `250 / 1.416 / 2.900`; 7/8 `233 / 1.650 / 3.267`. Şarkıya **ölçü eklenmiyor** (her fixture'da bölüm ölçü sayısı değişmedi), iptal pause, başa dön, sheet kapanışı, proje değişimi ve dispose'ta tam, ve iptalden sonra **canlı rAF 0**. Hızlı çift `play` ikinci bir count-in kurmuyor. **Kademeli hız yalnız transport'un bildirdiği tamamlanmış turda artıyor**; her alanın kendi aralığı var ve kontrol o aralığın ucunda görünür biçimde kapanıyor, fakat *birleşim* clamp edilmiyor — hedef başlangıcın altındaysa `target_not_above_start` adıyla reddediliyor. Otomasyonun uğradığı her hız manuel kontrolün de basabildiği bir kademe. **Uygulama çalımı dinlemiyor** ve bunu kendi cümlesiyle söylüyor. **Kabul koşusunda bulunan ve kapatılan bir sınır ihlali:** kademeli plan `setPracticeRatePercent` üzerinden gidiyordu ve her adımda `aranje.settings`'e **fiziksel bir `setItem`** yazıyordu — yani drill'in geçici hızı okurun kalıcı tercihi olarak diske geçiyordu. Artık transport'a doğrudan veriliyor; ölçülen sonuç: aralık seçmek, count-in ayarı, hız formu ve döngüyü kapatmak **0 yazma**, ve Song bayt-eş. Aynı koşuda §X'in "Escape/backdrop/Vazgeç aynı temizlik" sözünün üçte birinin hiç bağlanmamış olduğu görüldü; `Sheet` artık Escape'i dinliyor. **Davul ızgarası:** silahlanmış kit okuma penceresinin spacer'larının **yerine** çiziliyor. Toplam extent `axis + gutter + reading tail`; tarayıcıda `3.298 + 34 + 265,2 = 3.597,2 px` ölçüldü, altı farklı kaydırma konumunda ve 2-6 arası mount edilmiş ölçüde **değişmedi**. İlk ölçü `34 px`'te, son ölçü tam `axis + gutter`'da bitiyor, reading tail'de **0 ölçü** var ve tail'e dokunmak ne bölüm değiştiriyor ne seçim ne aralık üretiyor. Tab, Çoklu, davul ızgarası ve playhead **aynı kanonik ofsetleri** kullanıyor; iki yüzey arasındaki tek fark müzikal olmayan `34 px` gutter. `1.792` hücrelik ızgaradan aynı anda en çok **`210`** hücre mount ediliyor, silahlanmış yüzeyin DOM'u `443` → `277` düğüm, dinleyici `+7/−7`, kaydırma karesi medyan `16,7 ms`. **Ölçüm aracında iki kusur bulundu ve yapısal olarak kapatıldı.** `buildDrumStepModel(song, sectionId, trackId)` iki `string`i yan yana alıyordu ve bilinmeyen bir `sectionId` sessizce şarkının **ilk** bölümüne düşüyordu; `measure-overscan.ts` ikisini birden yapıp dört bölümü section-one olarak dört kez ölçtü ve inandırıcı sayılar üretti. Çağrı artık `{ song, sectionId, trackId }`, bilinmeyen bölüm ya da track **null** dönüyor, ve her çağıran sözdizimi ağacından denetleniyor. Düzeltilmiş ölçüm sekiz **farklı** ızgara veriyor (`8.704 / 3.264 / 2.448 / 2.176` ve `1.360 / 612 / 612 / 714 px`); overscan seçimi değişmedi (`geriye 0,5 / ileri 1`) fakat gerçek bedel **`120` değil `210` mount edilmiş hücredir** ve eski sayı geri çekilmiştir. Eski `24.507 px` "scroll genişliği" de bir uzunluk değildi: formülü `contentWidthPx + gridWidth − renderedPx` olduğu için kaydırma konumuna göre değişiyordu (iki mount edilmiş ölçüyle `23.419 px`). **Windowing bir şeyi küçültmedi; eski ölçüm aynı spacer genişliğini ikinci kez sayan bozuk bir geometri ölçümüydü.** **Performans, dürüst ayrımlarıyla.** Gerçekçi fixture'da davul dokunuşu medyanı `31,0-31,8 ms` — hedef `≤33 ms` **geçildi** ve altı 60-turluk koşuda kararlı. p95 aynı altı koşuda `32,0-49,8 ms` ile hedefin (`≤50 ms`) altında kaldı, **fakat kapanmış sayılmıyor**: en kötü koşu hedefi yalnız `0,2 ms` ile geçti ve daha önceki 24 örneklik bir koşuda `57,3 ms` ölçülmüştü. O koşuya dayanan "p95 `36,2 ms` — kapandı" iddiası **geri çekildi**. Kuyruğun tahsis/çöp-toplama kaynaklı olduğu **yalnız bir hipotezdir; kök neden bilinmiyor.** Contract-ceiling toplam edit gecikmesi `182` → **son temiz koşuda `96,5-100,3 ms`** (makine kabul matrisiyle yüklüyken aynı ölçüm `~131 ms` vermişti): görünmeyen arrangement (`22,4 ms`) ve Çoklu (`5,9 ms`) modelleri artık ancak bakıldıklarında kuruluyor (`lib/ui/lazy-value.ts`). Bu maliyetin **ortadan kalkmayıp ertelendiği** tarayıcıda ölçüldü: dokunuş sırasında iki yüzeyden hiçbiri kurulmuyor, Düzen ilk açılışta `~409 ms`, ikinci açılış `~63 ms`, ve toplam yazma yine tam **1**. Kalanın `~30 ms`'i merkezî schema + validator kapısı, `~4,5 ms`'i playback planıdır; **açık borçtur** ve keyfî yeni bir eşik uydurulmamıştır. `settle()` ile `songStore.commit()`'in aynı nesneyi iki kez parse etmesi (tavanda `5,1 ms`) ölçüldü, kaydedildi ve **bilerek dokunulmadı**. **Doğrulama:** `3.141` birim testi / 190 dosya (bunun `239`'u 2R-A'nındır); **780/780** kabul senaryosu (130 farklı senaryo × 2 viewport × 3 metin ölçeği); **65 vacuity probe** (54 birim/AST/davranış + 11 tarayıcı) ve ilk turda yeşil gelen dokuzunun her biri raporlanmıştır. **Regresyon:** 17 paket koşuldu, `2.333` senaryo geçti, `37` senaryo kırmızı; hiçbiri pratik döngüsüne ait değil ve hepsi 2Q-B ya da öncesinde son kez güncellenmiş harness'ların **eskimiş beklentileridir** (windowed yüzeyi "bütün ölçüler mount" sanmak, sarmalanan transport satırını tek satır sanmak, `6` kontrol beklerken `7` bulmak). Bunlardan biri bu fazın kendi değişikliğiydi ve harness düzeltildi: `chord` paketi Escape'e basıp sonra backdrop'a tıklıyordu, Escape hiçbir şey yapmadığı sürece zararsızdı. **Ayrıca bu fazın kapsamı dışında, kapatılmamış bir kusur ölçüldü:** `320 px`'te düzenleme modundayken `EditToolbar` satırı `326/320 px` ile `6 px` kırpılıyor (`chord-audio` 26b). **Kör dinleme paketine dokunulmadı:** ZIP ve `SEALED_KEY.json` yalnız SHA-256 ile doğrulandı, açılmadı, eşleme yazılmadı, K-53/K-54 değiştirilmedi. **Fiziksel Android/iOS kabulü yapılmadı; bütün sayılar masaüstü Chromium ve Node'dandır.** **Karar:** «Haktan onayladı 25.08.2026. Pratik Döngüsü v1 teknik olarak kapandı. Gerçekçi medyan 31,8 ms ile hedefi geçti; p95 güvenlik payı kapanmış sayılmadı. Contract-ceiling düzenleme gecikmesi temiz koşuda 96,5–100,3 ms, yüklü ortamda yaklaşık 131 ms olarak açık performans borcudur. Fiziksel cihaz kanıtı yoktur. 320 px EditToolbar taşması ayrı ürün kusuru olarak açıktır.» | **Haktan onayladı 25.08.2026** |
| **K-59** | **Intent-First Composer Tools v1 · Tab görsel dili ve playback doğruluğu (§13.28, 2S-A).** Mevcut düzenleme çekirdeğinin üstüne bir **niyet katmanı** kuruldu; altındaki hiçbir komut yeniden yazılmadı — kalem `applyChordWrite`'a, fırça mevcut articulation semantiğine, devam ettirme `repeat_selection` / `translate_fret_shape` / `transpose_pitch`'e gidiyor. **Bildirilen «1/32'de bazı notalar duyulmuyor» kusuru olduğu gibi doğrulanmadı ve bu gizlenmedi:** katman katman ölçüldü, düşen bir nota bulunamadı (1/32'de de 1/16'da da `13` buffer başlıyor). Yeniden üretilen gerçek kusur başkaydı: **bir parmağın inişi sabit süreliydi.** 1/8 · 132'de hedef perde `180,3 ms` duyulurken 1/32 · 132'de `24,1 ms`, **1/32 · 260'ta `0,0 ms`** — ses, perde varmadan kesiliyordu (`49,0 cent` sapma). Slide'ın zaten sorduğu soru (`glideFor`) diğer ikisine de soruldu: `expressionPresets.legato.maxTravelFraction = 0.4`. Yolculuk indiği notanın kendi süresinin en çok %40'ını alır. Yazılan hiçbir şey değişmedi (onset, süre, tick aynı; ızgara kabalaştırılmadı, yuvarlama yok, keyfî asgari süre yok, tekrar eden perde atılmadı, pull-off sıradan atağa çevrilmedi) ve **production bend/slide eğrilerine dokunulmadı** — değişen tek dal `glideSeconds === null` olan daldır. Sonuç: `1/32 · 260`'ta hedef perde `0,0 → 15,9 ms`, sapma `49,0 → 21,1 cent`; yeri bol olan hiçbir durum değişmedi. **Tab görsel dili:** rakamın kendisinde dolgu/kenarlık/yarıçap/gölge yok, telin kesintisi basamak sayısına göre hesaplanan ayrı bir eleman, `tabular-nums`, yedi durum **renkten başka bir şeyle** de söyleniyor, çalan onset'i React sahiplenmiyor (`data-playing`, tek rAF), HO/PO yayları duyulan perdeden yön alıyor ve art arda gelenler dönüşümlü yükseliyor, ekran okuyucu müzik konuşuyor («8. perdeden 7. perdeye koparma»). **Dört kapı** (Nota · Şekil · Ritim · Bağla) tek oturumluk `ComposerTool` üstünde; Song'a, depoya, proje dosyasına, fingerprint'e ve Copilot'a girmiyor, aynı anda tek araç tutuluyor ve tutulanı yeniden seçmek onu bırakmak demek. **Power Chord Kalemi** kökü parmağın olduğu yere yazıyor (en pes duyulan nota), tek onset grubu, kapo-göreli, Drop D ve baste çalışıyor, davul ve perdesiz track tipli redle karşılanıyor, dolu vuruşta iki açık kapı var. **Legato Fırçası** duyulan perdeden karar veriyor, açık seçim yanlış yöndeyse reddediliyor, **hepsi ya da hiçbiri**. **«Bu deseni devam ettir»** gam farkında değil; hiçbir seçenek «en iyi/önerilen/gama uygun» diye etiketlenmiyor, en çok üç hayalet kart ve **sıfır sağlayıcı çağrısı**. **Atomiklik:** başarı = 1 aktif-proje yazması, katalog 0, başka proje 0, 1 history adımı; başarısızlık = 0/0 ve bayt-eş Song; bir jest bir adım (beş notalık fırça da, kaç kopya olursa olsun devam ettirme de). **Satır bütçeleri yükseltilmedi:** `Workspace.tsx` `377 → 368`, `ArrangementCanvas.tsx` `470 → 470`, `TabCanvas.tsx` `472 → 452`. **§18'de bu fazın açtığı gerçek bir kusur bulundu ve kapatıldı.** `320×700`'de düzenleme ızgarası okuma yüzeyinin **dışına** çıkıyordu (`hücre y=423`, `yüzey sonu y=402`); dokunuş track kontrol satırına gidiyor, zaman seçimi hiç açılmıyordu — `practice-loop` `0 → 19` kırmızı, `selection-ui` `1 → 2`, `multitrack` `22 → 26`. **Kabul ölçümünün kendi kusuruydu:** yalnız `height >= 44` soruluyor, o `44`'ün ekranda olup olmadığı sorulmuyordu. Karar: okuma modu `360 px` altında yoğun kalabilir, **düzenleme modunda bütün etkileşim satırları en az `44 px`**, ve aritmetik kapanmıyorsa **hedef değil çevre** geri çekilir — **Focused Edit Layout**: marka başlığı, görünüm anahtarı ve geniş bölüm navigasyonu yerine tek kompakt `44 px` satır («Bitti · Ana Riff · 12. ölçü»), staff kendi içinde dikey scroll almadan altı tel birden. **Dört niyet kapısı geri çekilmiyor:** ilk çözüm buydu ve yanlıştı — Legato Fırçası seçili bir koşu üzerinde kullanılır, dolayısıyla «Bağla» tam seçim varken erişilebilir olmalı; kendi kabul paketim bunu 36. senaryoda çökerek söyledi, kapı satırı geri alındı ve `ComposerArea`'nın syntax tree'sini okuyan bir sınır testiyle bağlandı. Kabul artık *görünür* yüksekliği, `elementFromPoint` ile gerçek hit sahibini, komşu çakışmasını, dış tellerin bütünlüğünü ve staff içi scroller yokluğunu ölçüyor. **Doğrulama:** `3.310` birim testi / 200 dosya; kabul matrisi 6 kombinasyon (`320×700` ve `390×844` × %100/%125/%150); **102 vacuity probe** (80 birim/AST + 16 tarayıcı + 6 gerçek ses/render; 100 kırmızı, 2 eşdeğer) ve ilk turda yeşil gelen her biri `PROBES.md`'de sınıflandırıldı — on altısı gerçek boşluktu ve adlandırılmış testlerle kapatıldı, ikisi eşdeğer mutasyon olarak gerekçesiyle bırakıldı. **Regresyon (19 paket, tek tek ve sırayla koşuldu):** bu fazın ürettiği yeni kırmızı **yok**. `practice-loop` `780/780`, `intent-composer` `474/474`, `chord` `162/162`, `projects` `112/112` ve `cross-instrument` `182/182` tamamen temiz — son ikisi başlangıç SHA'sından **daha iyi**. `multitrack` (22) ve `tab` (5) başlangıçtaki kırmızılarla senaryo adına kadar birebir aynı; `arrangement` `3 → 2`; `selection-ui` (1) ve `orchestration-refactor` (10) değişmedi. Focused Edit Layout'un yarattığı **harness borcu** altı pakette kapatıldı: başlığa, görünüm anahtarına veya bölüm navigasyonuna uzanan her suite artık okuyucunun kapısından — «Bitti» — çıkıyor. **Kör dinleme paketine dokunulmadı:** ZIP ve `SEALED_KEY.json` yalnız SHA-256 ile doğrulandı, açılmadı; K-53/K-54 değiştirilmedi. **Kapanış turu (§13.28.6):** perde güncellemesi artık articulation'ı ve velocity'yi koruyor, üç niyet (`keep`/`set`/`clear`) ayrık bir patch'le söyleniyor ve bağlantıyı yaşatamayan bir güncelleme `articulation_conflict` ile atomik reddediliyor — sessiz düşürme yok. Copilot bütçesi 200 kontrollü koşuda tek şekil veriyor (`accepted=1 calls=1 refusal=budget_exhausted`); bariyer artık rezervasyonun kendisinde, ve «iki kez para harcanıyor» iddiasının gözlenen örnekleri kazananın düzeltme turu çıktı. Founder görsel paketi 12 ekran ve ölçümleriyle üretildi; `320×700`'de tutulan araç çipinin ikinci satırı en kalın teli `37 px`'e kırpıyordu, çip artık kapıların satırını paylaşıyor. **Açık borçlar:** `sus`/dead note/ghost note/muted strum/vuruş yönü Song Contract'ta yok — sahte alan eklenmedi, teklif `EXPRESSION-GAPS.md`'de; perde sheet'inin «Güncelle» düğmesi az önce seçilen articulation'ı siliyor (baseline §D.1, bu fazda kapatılmadı); `320×700`'de **seçim açıkken** seçim eylem çubuğu `108 px` alıyor, `main` `196 px`'e düşüyor ve staff'ın istediği `286 px` karşılanamadığı için üç tel kırpılıyor — hangi chrome'un geri çekileceği ürün kararıdır ve ölçüsüyle açık bırakıldı; **fiziksel Android/iOS kabulü yapılmadı**, bütün sayılar masaüstü Node ve Chromium'dandır. Bu katman **hiçbir müzikal öneri yapmaz.** **Görsel kapanış turu (K-59 Visual Closure):** açık bırakılan iki görsel kusur kapatıldı. Legato altçizgisi çizilen yayla aynı şeyi iki kez söylüyordu; `glyphStateFor` artık yayın altındaki notayı `legato` durumundan çıkarıyor, yani altçizgi yalnız yayın **ulaşamadığı** notada kalıyor — kaldırılmadı, tekrarı kesildi. `320×700`'de seçim açıkken staff'ın üç teli kırpılıyordu: seçim eylem çubuğu `108 px` yerine `44–49 px` tek satıra indi (üç fiil + «Daha fazla» kapısı), geri kazanılan dikey alan `≥90 px`, altı tel birden görünüyor. Aynı turda Power Chord hayaleti gerçek çok sesli hâline getirildi ve tutulan aracın adı kendi kapısında yazılıyor. **Founder görsel kabulü alındı** («İdare eder ya, fena değil bence»); iki **bloke etmeyen** görsel-cila borcu kaydedildi: seçim çerçevesinin görsel ağırlığı ve Power Chord hayaletinin kontrastı ileride yeniden değerlendirilebilir. **Bu onay fiziksel cihaz, audio veya release onayı değildir** — fiziksel Android kabulü hâlâ yapılmadı ve K-59.1 altında ayrıca yürütülüyor. | **Haktan onayladı** |
| **K-60** | **UI Contract v1 · Editör parity omurgası (§13.30, 2U-A).** Mevcut UI geometrisi **geçici olarak** donduruldu (`docs/UI-CONTRACT-v1.md`; ilk cümlesi bunun kalıcı bir tasarım kararı olmadığını söyler) ve dondurulan yüzey değiştirilmemiş `dc8cde8` üzerinde **ölçülerek** kaydedildi: 4 viewport × 8 durum, staff sınırları, altı telin y'si, rakam merkezleri, `main` yüksekliği, toolbar/transport sınırları, body taşması, 44px hedefler, press sahipliği. Piksel diff bilerek kullanılmadı — bir diff «herhangi bir piksel kımıldadı mı» sorusunu yanıtlar, sözleşme ise parmağın güvendiği aritmetiği korur. UI değiştikten sonra golden yeniden koşuldu: **sapma yok. Seçim tek cümleyle tarif ediliyor:** üç seçim modeli şeklini korudu, `selection-descriptor.ts` ortak tanımı verdi, `selection-capability.ts` «bu seçime ne yapılabilir»i bir kez yanıtlıyor — bir fiil ya sunulur ve çalışır, ya sebebiyle pasiftir, ya hiç yoktur; dördüncü hâl yasak. **Olay kimliği pozisyoneldir ve bu bir kısayol değildir:** contract'ta nota id'si yok, bir nota konumudur; «pano id taşımaz» ve «paste yeni id üretir» buradan düşer. `NoteEvent`'e kalıcı `id` tek yönlü kapıdır, açılmadı. **c1'in bıraktığı gerçek kusur c3'te kapatıldı:** yetenek modeli `full` ile `track` ölçü kapsamını ayırt edemiyordu (tek track'li şarkıda aynı notaları kapsarlar, track sayarak ayrılamazlar), bu yüzden bir enstrümanın ölçüsünde «Ölçü ekle» teklif ediliyor ve çekirdek basıldıktan sonra `not_available_in_scope` ile reddediyordu — §2'nin asla olmamalı dediği şey. `barScope` eklendi; yalnız gerçekten bütün ölçüyü gerektiren üç fiil pasifleşti, silme/çoğaltma/tekrar/taşıma **pasifleşmedi** çünkü dürüst bir tek-enstrüman anlamları var. «Son ölçü» reddi de kapsama bağlandı: bir lane'i boşaltmak ölçüyü yerinde bırakır. **Gizli bir aliasing kusuru bulundu ve düzeltildi:** `readRegion` notaları `{ ...note }` ile kopyalıyordu, yani pano okunduğu şarkıyla aynı `position` nesnesini tutuyordu ve paste yolu panoyla — üç ayrı görünen yer tek nesneydi. Hiç patlamamıştı (hiçbir çekirdek notayı yerinde değiştirmiyor); `structuredClone` ile iki taraf da ayrıldı. **Bir denk mutant dürüstçe raporlandı:** yazma tarafındaki detach'i kaldırmak gözlemlenebilir davranış değiştirmiyor çünkü `settle()` çıkışta derin kopyalıyor (deneyerek doğrulandı, `shared: false`); §14 denk mutantı yasakladığı için probe listesinden çıkarıldı, yerine gözlemlenebilir bir sınır kondu, detach savunma olarak kodda kaldı ve gerekçesi hem kodda hem probe dosyasında yazılı. **Ölçü press'i sıraya girdi:** `pointerOwner` c1'de `"measure"` rütbesini kazanmış ama kimse sormuyordu; tab'ın ölçü başlığı doğru cevabı yalnızca hiçbir kalem hücresi üstünde durmadığı için veriyordu — yerleşim hakkında bir olgu, kural değil. Şimdi tutamak/kalem/zaman seçimiyle aynı kuyrukta. **`measure-gesture.ts`** basış/erişim kararını tek yerde veriyor; bir kenar diğerini asla geçmiyor, başka bölüme ve başka enstrümana uzanmak adıyla reddediliyor, hiçbir şey yazmıyor. **Non-contiguous seçim reddedilmiyor, ifade edilemiyor** — `BarSelection` iki indekstir, arada delik tutamaz; bu bir doğrulayıcıdan güçlüdür. **Ölçü operasyonları bütün track'lere ulaşıyor** ve iki enstrümanlı bir fixture üzerinde ölçüldü (tek track'li fixture'da «bütün track'ler» yanlışlanamaz); her biri tam bir history adımı, ret hâlinde sıfır adım ve bayt-eş Song, muafiyet `history-boundary`'ye açıkça yazıldı. **Toolbar aynen korundu** (`Bağla · Taşı · Devam · Daha fazla`, yeni satır yok): uygulanmayan fiil düşürülmüyor, sebebiyle grileşiyor; çekmece kısalabiliyor. **«Taşı» sekiz hareket** zaten sunuyordu, eksik olan birini kaybettiğini fark edecek şeydi — `movement-menu.ts` sayıyı tutuyor, kabul on altı hedefin hepsine basıyor. **«Devam» artık seçimi uzatıyor:** eskiden `continue_pattern` besteci aracını seçiyordu, o araç Ritim kapısının arkasında **kaybolmadı**; erişim kuruyor, sonraki uzun basış nereye uzanılacağını söylüyor — yeni jest yok, başlangıç sabit, daraltma serbest, Song'a ve history'ye sıfır yazma. Gerekçe: bant zaten iki tutamak taşıyor ama tek slotluk seçimde 34px arayla duruyorlar ve bir parmak aralarından seçemiyor. **Doğrulama:** hedefli paket 190 test **10 ardışık yeşil**; tam paket **4.051 test / 246 dosya, 4 ardışık yeşil**; tarayıcı kabulü 22 adım × 4 viewport = **88/88, 10 ardışık yeşil**, koşu başına **40 founder ekran görüntüsü**; **40 anlamlı mutasyon probe'u, hepsi adıyla kırmızı, 0 vacuous, 0 invalid**. Probe koşucusu «exit non-zero»dan bilerek serttir: hiç test koşmaması, yalnız timeout ve denk mutant üçü de sıfırdan farklı çıkış verir ve hiçbir şey kanıtlamaz, bu yüzden bir probe ancak pozitif test sayısı **ve** en az bir başarısız iddia varsa sayılır. **Probe'lar dört gerçek test boşluğu buldu ve hepsi benim testlerimdeydi** (descriptor fixture'ı tek track'liydi; `canRun` gri bir fiil için hiç sınanmamıştı; paste aliasing'i değerlerle karşılaştırılıyordu; yalnız bitiş kenarının geçmesi sınanmıştı) — hiçbir iddia zayıflatılmadı, testler güçlendirildi. **Kabul sırasında uygulamanın haklı olduğu bir yer bulundu:** seçtiğim koşu bir hammer-on'un üstünden geçtiği için hareket hayalet göstermek yerine «bu seçim bir bağlantıyı kesiyor» diye **soruyordu**; adım yanlış şeyi ölçüyordu, taşındı ve zincir sorusundan çıkmak da ayrıca ölçüldü (sıfır yazma, bayt-eş Song). **Satır bütçeleri yükseltilmedi:** `Workspace.tsx` `377/379`, `TabCanvas.tsx` `440/472`, `ArrangementCanvas.tsx` `470/470`; TabCanvas'ın payına komut mantığı konmadı. Songsterr yalnız **davranış/parity** referansı olarak okundu; tasarımından, metninden, markasından, içeriğinden hiçbir şey alınmadı. **Bu turda kimse editörü kullanmadı** — ölçülen şey davranış ve sayılardır. K-59 açılmadı, fiziksel/müzikal ses kabulü yeniden yorumlanmadı. | **Haktan editör akışı kabulünü bekliyor** |
| **K-61** | **Seçimi dinle · Seçimden döngü (§13.31, 2V-A).** Amaç yeni bir notasyon ya da ses kalitesi denemesi değildi: **düzenleyiciden çıkmadan** seçilen yeri bir kez duymak ve tekrarlatmak. Dinleme bir **plandır**, ikinci bir çalar değil — `selection-playback.ts` tipli descriptor'ı okur, tick'i çözer, kapsamı track listesine çevirir ve gerekirse tipli bir ret üretir; motorda değişen tek şey `ScheduleOptions`'a eklenen bir penceredir. **Ayrı ve düşük kaliteli bir preview synth yazılmadı:** HO/PO, slide, bend, vibrato, palm mute ve strum normal scheduler yolundan geçer, ifade planı ve `playChain` dokunulmadan kalır. **Ölçülerek bulunan iki kusur:** (1) duyulabilirlik `descriptor.onsetCount`'a soruluyordu, o alan yapı gereği melodiktir (`sectionSlotStream` davul slot dizilerini `writable: false` işaretler) ve davul dolu bir ölçü «dinlenecek nota yok» diye grileşiyordu — soru artık `buildNotatedPlan`'a, motorun gerçekten çalacağı şeye sorulur; (2) tick dönüşümü: descriptor bölüm-göreli, transport şarkı-mutlaktır ve ikisi yalnız ilk bölümde eşittir, bu yüzden fixture bilerek iki bölümlüdür. **Testler önce yazılırken iki gerçek yaşam döngüsü kusuru çıktı:** ses hatası `void`'lenmiş bir press handler'a promise reddi olarak fırlatılıyordu (okuyucuya hiçbir şey söylenmiyor, hiçbir şey temizlenmiyordu), ve motor kurulurken gelen bir abort yok sayılıyordu — iptaller senkron, başlatma asenkron, dolayısıyla bir an sonra dönen başlatma okuyucunun çoktan bıraktığı seçimi çalmaya başlıyordu; bir token bunu kapatır. **Tek loop otoritesi:** `PlaybackLoop` dördüncü bir varyant kazandı (`selection`), ikinci bir loop alanı değil; bölüm/çalışma döngüsünün yerine geçer ve şarkı değiştiğinde taşınmaz. **Sınır anlamı:** aralık yarı açıktır, başlamadan önce başlamış nota yapay atakla içeri sokulmaz, sonu taşan nota **yalnız seste** kesilir ve Song'un yazılı süresi değişmez. **Efemerlik:** Song baytları, proje revizyonu, storage, history, undo/redo ve pano değişmez — ve bu sıfırlar aynı koşuda gerçek bir düzenlemeyle kımıldadığı gösterilen aletlerle ölçülür; `localStorage.setItem` sarmalayarak yazma saymak bu rotada yasaktır çünkü sayfa kendi `Map`'ini kullanır ve o sayaç uygulama ne yaparsa yapsın sıfır okur. **UI Contract v1'e dokunulmadı:** iki eylem mevcut «Daha fazla» çekmecesindedir, ana toolbar'a düğme veya satır eklenmedi, yeni badge/chip yok, aktif döngü yalnız «Seçim döngüsünü kapat» etiketiyle söylenir. `selection-capability.test.ts`'in «nota fiilleri ile ölçü fiilleri ayrık kümelerdir» iddiası artık doğru değildir ve zayıflatılmadı, kesişimi adıyla söyleyecek şekilde düzeltildi. **Doğrulama:** hedefli paket 163 test **10 ardışık yeşil**; tam paket **4.338 test / 267 dosya, 4 ardışık yeşil**; tarayıcı kabulü 20 kontrol × 4 bağlam = **80/80, 10 ardışık koşu (800 kontrol)**; **32 mutasyon probe'u, hepsi adıyla kırmızı, 0 vacuous, 0 invalid**. İki mutant **eşdeğer olduğu için gerekçesiyle emekli edildi** ve yeşil bırakılmadı; yerlerine gerçek soruyu ölçen bir mutant kondu (davul şeridi scheduler'da ayrı bir döngüdür). **Probe'lar üç gerçek boşluk buldu, üçü de benim testlerimdeydi** (bitiş tick'ine ulaşan bir döngünün durdurulmaması; durduktan sonra bütün şarkının yeniden schedule edilmesi; seçim döngüsünün şarkı değişimiyle karşılaşması) — hiçbir iddia zayıflatılmadı. **Satır bütçeleri yükseltilmedi:** `Workspace.tsx` `375/379` (bir ara `398`'e çıktı, bütçe değil kod taşındı: `use-covered-run.ts` ve `copilot/gates.ts`), `TabCanvas.tsx` `456/472`, `ArrangementCanvas.tsx` `470/470`. **Bu turda kimse bu sesi dinlemedi.** Ölçülen şey, doğru notaların doğru pencerede, normal scheduler tarafından schedule edildiğidir; kabul koşusu masaüstü Chromium'dur, kendi raporunda «browser emulation — not a physical device» yazar ve `touch=0` bağlamı fiziksel cihaz kanıtı sayılmaz. 2U-C'nin fiziksel Android seçme/sürükleme kapısı açılmadı; bu turun teknik başarısı işitsel kaliteyi kendiliğinden onaylamaz. | **Haktan edit–dinle akışı kabulünü bekliyor** |

| **K-62** | **Kayıp «Devam» ve gerçek dinleme rotası (§13.32, 2V-A.1).** Founder'ın gerçek Android cihazındaki canlı sonucu otorite kabul edildi: `384×740`, `dokunma 5`, rehber «2/36 · «Devam»a dokun.», production seçimi «1 power chord · 3 nota», ekrandaki eylemler `Kopyala · Kes · Çoğalt · Tekrarla · Taşı · Sil · Daha fazla` — **«Devam» yok.** **Kök neden ölçülerek bulundu ve bariz şüphelilerin hepsi masumdu:** yetenek modeli power chord için `extend`'i zaten `available` yanıtlıyordu ve compact toolbar onu K-59'dan beri çiziyordu. O yedi fiillik liste `SelectionActionBar`'dır — **okuma** yüzeyinin çubuğu — ve fiilleri modele hiçbir şey sormayan sabit bir listeydi; compact satır ise yalnız «Düzenle»ye basıldıktan sonra var olur ve rehber bunu istemez. Yani 2U-B pano kusurunun aynısı: model sunuyor, çizen liste taşımıyor. **Derin düzeltme sekizinci bir satır değil**, iki çubuğun artık aynı fonksiyona sorması oldu (`selectionOffers`), ve o fonksiyon okuyucunun yazıp yazmadığını sormuyor — «bu koşuya ne yapılabilir» müzikal bir sorudur, düzenleme modu cevabın parçası değildir. Dört sütunlu ızgarada sekiz hedef yedinin yaptığı iki satırın aynısıdır; **üçüncü satır yok, hiçbir tel kaybedilmedi**, «Devam» «Taşı»nın yanında, «Daha fazla» sonda. **Model düzgün sorgulanınca bir soruyu özensiz yanıtladığı görüldü:** `extend` koşulsuz `available` idi, bu neredeyse her yerde doğru ve bölümün son slot'undaki tek slotluk bir seçimde yanlıştır — kol yanar, gidecek yer yoktur. `hasExtendTarget` bunu bölümün kendi slot'larından yanıtlar ve kontrol «Uzatılacak yer kalmadı.» ile grileşir; yetenek modeli Song'u almama sözünü korur. **İkinci extension algoritması yazılmadı:** çubuk odaklı satırın çağırdığı `toggleExtend`'i çağırır, sonraki uzun basış bitiş kenarını taşır, kolu kurmak ve uzatmak hiçbir şey yazmaz. **Rehber, ekranda olmayan bir düğmeyi onaylayamaz hâle getirildi:** «Devam» adımı `no_write` bekliyordu ve hiçbir şeye dokunmadan «Yaptım»a basmak da hiçbir şey yazmaz — adım artık `armed` bekler ve cevabı okuyucunun bastığı kontrolün `aria-pressed`'inden alır. **2V-A için gerçek founder rotası açıldı:** `/eval/selection-playback` (`noindex`, `?sha=` kapısı, izole bellek deposu, production Workspace + çekmece + audio engine, sekiz adım, teknik terim yok, **sayfanın kendi playback kontrolü yok**). Eski editör rotası 2V-A dinleme sonucu olarak yeniden verilmedi. **`touch=0` fiziksel PASS üretemez** ve bu bir dipnot değil bir fonksiyondur: `listeningVerdict` dokunmasız ortamda en fazla `PARTIAL` döner, sonuç bloğu hangi ortamın cevapladığını kendi satırında söyler. **Doğrulama:** hedefli paket **10 ardışık yeşil**; tam paket **4.393 test / 270 dosya, 4 ardışık yeşil**; iki tarayıcı kabulü × 5 bağlam = **70/70 ve 70/70, 10 ardışık koşu**; **32 mutasyon probe'u, hepsi adıyla kırmızı, 0 vacuous, 0 invalid**. Devam harness'ı, sekizinci giriş çıkarılmış bir build'e karşı **10/14** verir ve kırmızı adımlar 4, 5, 6, 7'dir — canlı FAIL'in kendisi. **Probe'lar iki gerçek boşluk buldu, ikisi de benim testlerimdeydi** (dosya geneli arama, kollu dalın *yakın* kenarı taşımasıyla yeşil kalıyordu; rehberin kolu nereden okuduğu hiç sınanmamıştı) ve iki harness adımı kendini tarif ediyordu (uzatmadan sonra özetin hâlâ «power chord» diyeceği varsayımı — uygulama haklı; ve 320×700'de eylem çubuğunun altında kalan bir noktaya nişan almak). **Satır bütçeleri yükseltilmedi:** `Workspace.tsx` `375/379`, `TabCanvas.tsx` `456/472`, `ArrangementCanvas.tsx` `470/470`. **Bu turda kimse dinlemedi** — fiziksel edit–dinle kabulü `/eval/selection-playback` üzerinden ayrıca yürütülecektir; 2U-C fiziksel sürükleme kapısı açılmadı ve K-61 kendiliğinden onaylanmadı. | **Haktan 2V-A fiziksel edit–dinle kabulünü bekliyor** |
| **K-63** | **Selection Action Canon (§13.33, 2V-B).** Founder `/eval/selection-playback?sha=4d4deb3` üzerinde adım 1'i tamamladı, «Daha fazla»yı açtı ve arkasında **yalnız «Seçimi sil»** buldu; rehberin adım 2'si gerçekleştirilemedi. **Canlı FAIL, üretim rotasında, gerçek pointer seçimi ve görünen gerçek kapıyla yeniden üretildi:** sheet `["Kapat","Seçimi sil","Vazgeç","Uygula"]`, iki dinleme eyleminin de `rendered=0` (`eval/editor-2vb/artifacts/BASELINE.json`). **Önceki 70/70 neden yanlış yeşildi:** 2V-A koşusu `toEditor()` içinde önce «Düzenle»ye basıyordu, yani ölçtüğü sheet compact satırın çekmecesiydi; 2V-A.1 koşusu kapının *varlığını* saydı, içeriğini hiç açmadı. İkisi de founder'ın açtığı yüzeyi hiç görmedi. **Bulunan bütün sabit eylem yüzeyleri:** okuma ızgarası (`SelectionActionBar`), okuma «Daha fazla» (`TransformSheet` içindeki `kind === "more"` dalı), compact satır ve çekmecesi (`SelectionToolbar` + `DRAWER_VERBS`), ölçü satırı (`BarActionBar` + `SCOPE_LABELS`/`PRIMARY`). Beşi de artık `selection-action-canon.ts`'in yerleştirdiğini çizer; hiçbir bileşen kendi listesini taşımaz ve bir sınır testi eylem etiketlerini bileşen kodunda adıyla yasaklar. **İkinci gerçek kusur modelde çıktı:** ölçü satırının yedi düğmesinin arkasında üç fiil ve dört boşluk vardı — ölçü kopyalamak/kesmek/tekrarlamak/taşımak aynı adlı nota fiillerinden başka komutlardır — `copy_bar`, `cut_bar`, `repeat_bar`, `move_bars` eklendi ve «Taşı» tek ölçülük bölümde «Taşınacak yer yok.» ile grileşti. **Üçüncüsü dinlemedeydi:** yetenek modeli 2V-A'dan beri bir ölçü aralığında `audition` sunuyordu ve hiçbir yüzey çizmiyordu; `useCoveredRun` artık hangi seçim tutuluyorsa onu tarif eder, «Bu enstrüman» plana tek track id, «Tüm enstrümanlar» hepsini taşır. **Dördüncüsünü kendi harness'ım buldu:** paylaşılan More sheet her basıştan sonra kendini kapatıyordu — «Yapıştır»ın az önce açtığı sheet dâhil — canon artık hangi eylemin sheet açtığını söyler. **Reachability denetimi testlerden üretilir:** 404 satır, on seçim türü × üç mod × iki pano durumu; gizli-ama-available `0`, çift render `0`, handler'sız render `0`. **Founder'a tek toplu rota verildi:** `/eval/editor-action-batch?sha=<sha>` — on iki ekran, founder yalnız işitsel ve kullanım sorularını yanıtlar, bayt/history/storage'ı sayfa proje kaydının izinden kendisi ölçer; hiçbir şey yapmadan «Sonraki»ye basmak yazan adımlarda düşer. **Doğrulama:** iki tarayıcı harness'ı × 5 bağlam = **85/85 ve 70/70**, **10 ardışık koşu** (`everyRunGreen: true`, 1.550 kontrol, `eval/editor-2vb/artifacts/RUNS.json`); **52 mutasyon probe'u, hepsi adıyla kırmızı, 0 vacuous, 0 invalid**; tam paket temiz. **Satır bütçeleri yükseltilmedi.** **Bu turda kimse bu sesi dinlemedi** — ölçülen şey erişilebilirlik ve yazma davranışıdır; kabul koşuları masaüstü Chromium'dur ve `touch=0` fiziksel kanıt sayılmaz. 2U-C fiziksel sürükleme kapısı açılmadı; K-61 ve K-62 kendiliğinden onaylanmadı. | **Haktan tek toplu editor-action kabulünü bekliyor** |


### §19.1 v1.5'in v1.2'yi geçersiz kıldığı yerler

| Konu | v1.2 | Geçerli (v1.5) |
|---|---|---|
| Track sınırı | 6 aktif track | **8**, section başına aktif-track limiti yok |
| Toplam bar | 64 (pilotta zorunlu) | **32 çekirdek** (K-25; v1.5'te 16 idi), 64 Faz 2.5 |
| Ölçüler | 4/4, 3/4, 6/8, 7/8 hepsi pilotta | **4/4 + 6/8 çekirdek**, kalanı Faz 2.5 |
| Grid | 8 / 16 | **8, 12, 16, 24, 32** (K-34); 64 açık boşluk |
| Tel ekle/çıkar, 7/8 telli gitar, 5/6 telli bas | Pilotta gelişmiş ayar | **Pilot sonrası** |
| Tel tel manuel akort, pan/solo, davul lane | Faz 1 | **Faz 2.5** |
| Pozisyon motoru | 4 maliyeti minimize eden motor | **Ergonomic Placement v2** (§9.2, K-19) |
| Seçim modeli | yok | **Zaman bandı** (tek track + tek section, K-37); cross-track, cross-section ve string-rectangle ertelendi |
| Uzun basışın sahibi | iki model, iki eşik | **Zaman seçimi**, canlı olduğu her yerde (K-38); akor grubu jesti yalnız kapalı olduğu yüzeylerde |
| Dokunma hedefi | yalnız yükseklik ölçülüyordu | **44x44, iki boyut da ölçülür** (K-38); seçim araç çubuğu 320px'te iki satır |
| Çalışma yüzeyi | tek tab ekranı | **Düzen + Tab** (K-39); açılış Düzen, diğeri unmount, tercih oturumluk |
| Arrangement bar genişliği | yok | **Müzikal süre** (K-40); grid ve tempo genişliğe dokunamaz, 3/4 < 4/4 |
| Tekrar göstergesi | yok | **Yalnız birebir exact repeat** (K-40); yaklaşık benzerlik yok, sessiz bar etiketlenmez |
| Barlar arası bağlantı | yok | **Yalnız gerçek tie/slide/hammer/pull** (K-41); section sınırı kesmez, sus ve eksik anahtar keser |
| Ekran bütçesi | krom müziği eziyordu | **320×700'de tab 40→397px, düzen 274→490px** (K-42); transport tek satır |
| Renk rolleri | karışık | **Mavi=konum/süreklilik, altın=seçilen kontrol, gri=pasif, kırmızı=hata** (K-42) |
| Enstrüman adları | registry'nin İngilizcesi | **Tek merkezî Türkçe tablo** (K-42); teknik ID ve preset ID ekrana çıkmaz |
| Ölçü işlemleri | yok | **İki kapsam, iki pano, tek yazma** (K-43); `track` barı kaldırmaz, `full` bölümün şeklini değiştirir |
| Ölçü panosu | yok | **`track_bars` ve `full_bars` asla birbirine çevrilmez** (K-43); tempo ve section metadata kopyalanmaz |
| Ölçü ghost'u | yok | **Gerçek komut, çizilmiş sonuç** (K-43); sıfır yazım, sıfır undo, playback planına dokunmaz |
| Yapısal yazımdan sonra playhead | şarkının başına dönüyordu | **Hâlâ var olan en yakın bara taşınır** (K-43) |
| Undo | tek adım | **50 adıma kadar, redo ile birlikte** (K-44); tek snapshot dizisi + cursor |
| Undo kapsamı | yalnız bazı yollar | **Bütün mutation yolları tek commit kapısından** (K-44) |
| Undo metni | "Son değişikliği geri al" | **Ne geri alınacağını söyler** (K-44); tek merkezî Türkçe tablo |
| Geçmiş kalıcılığı | yok | **Oturumluk; Song'a, fingerprint'e, Copilot'a girmez** (K-44) |
| Düzenlemeden sonra loop | her düzenlemede kapanıyordu | **Bölüm duruyorsa korunur, yoksa kapatılır** (K-44) |
| Kayıt formatı | ham Song | **Zarf: `{format, version, revision, current, previous}`** (K-45); tek `setItem` |
| Bozuk kayıt | örnek şarkıya düşülüyordu | **Önce bir önceki sağlam sürüm denenir** (K-45) |
| Gelecek sürüm dosyası | ayırt edilmiyordu | **Fail-closed: silinmez, üzerine yazılmaz, düzenleme kilitlenir** (K-45) |
| Yazma başarısızsa | düzenleme ekranda kalıyordu | **Hiçbir şey ilerlemez; ekran diski gösterir** (K-45) |
| En ağır şarkı dosyası | 798.516 B | **1.597.104 B (≈1,52 MiB, 2,00×)** (K-45) |
| Proje yedeği | yoktu | **Tek taşınabilir `.aranje.json` dosyası; deterministik export, güvenli import, undo ile geri dönüş** (K-46) |
| Mixer | yoktu | **Kalıcı ses/stereo (proje verisi) ile oturumsal sustur/tek dinle ayrı; canlı önizleme, tek commit, bölüm otomasyonu yok** (K-49) |
| Export | yalnız proje dosyası | **Stereo WAV + Standard MIDI File + proje yedeği; tek kapı, gerçek byte doğrulaması, FluidR3 atfı taşınır** (K-50) |
| Ritim aralıkları | `8|12|16|24|32` | **`4|8|12|16|24|32`; 1/4 yalnız `timing.ts`'in yazabildiği ölçülerde** (K-51) |
| Ölçü işareti/ritim | yalnız yeni bölüm formunda | **Mevcut ölçü ve bölüm için tick-koruyan, atomik, tipli değişim** (K-51) |
| Uzun basış | zinciri sessizce genişletiyordu | **Bir onset grubu; zincir kararı açık `chainPolicy` olmadan çalışmaz** (K-51) |
| Proje sayısı | tek açık şarkı (`aranje.song`) | **Cihazda çok proje: katalog + proje başına kayıt; kota/tavan yok** (K-52) |
| "Yeni şarkı" | açık şarkının üzerine yazıyordu | **Yeni proje açar; `create_song` komutu kaldırıldı** (K-52) |
| İki sekme | sessizce birbirinin üzerine yazabiliyordu | **Bayat sekme kayıp kapısı: `revision` uyuşmazsa yazım reddedilir (senkronizasyon değil)** (K-52) |
| Akor yazmak | tel tel, nota nota | **Kök + tür + şekil seçimi; bütün notalar tek atomik, geri alınabilir olay** (K-53) |
| Akor verisi | — | **Kalıcı akor nesnesi yok; akor aynı onset'teki NoteEvent'lerdir** (K-53) |
| Yeni projenin gitarı | `electric_guitar/clean` — vendor edilmiş pack yok, hiç ses çıkmıyordu | **Şablon duyulabilir ilk core preset'i seçer (`high_gain`); duyulamayan preset tipli bir durumdur** (K-54) |
| Duyulamayan preset | sessiz başarı; her katman "oldu" diyordu | **`AudioPresetAvailability` — Song Contract'ın parçası değil; legacy şarkı düzeltilmez, doğrusu söylenir** (K-54) |
| Akor dinleme maliyeti | 25 dinleme = 175 sample isteği | **Paylaşılan preview bank + retention: 7 istek, 7 decode, 1 AudioContext** (K-54) |
| WAV kırpılması | ±1 clamp sessizdi | **Kırpılan örnek/çerçeve sayısı geri döner; kullanıcıya karıştırıcıyı işaret eden cümle gösterilir (limiter eklenmedi)** (K-54) |
| Yepyeni şarkıya ilk nota | şablonun barlarında track anahtarı yoktu; yazma reddediliyordu | **Launch şablonları track başına boş şerit taşır; `create_track` için açık** (K-54) |
| Bend/slide | — | **Ölçüldü ve tasarlandı; production davranışı değişmedi, migration yapılmadı** (K-54) |
| Yeni track'e ilk nota | bar anahtarı yoktu; yazma reddediliyordu | **`create_track` her bara boş şerit koyar; legacy barda şerit + nota tek write, tek undo** (K-55) |
| Eksik bar anahtarı | tek anlam varsayılıyordu | **İki cümle: "burada sessiz" ve "bu barda yazılı değil"; ayrım şekilde, Song Contract'a alan eklenmeden** (K-55) |
| 320 px transport | practice pill kırpılıyordu | **360 px kırılma noktası; 307,7/320, kırpılan 0 — kontrol kaldırılmadı, saklanmadı** (K-55) |
| Enstrümanları karşılaştırmak | tek track'lik Tab | **Çoklu görünüm: tek eksen, tek scroller, tek playhead, tek aktif düzenleme track'i** (K-55) |
| Playhead takibi | iki yüzeyde iki kopya kural | **Tek modül: elle kaydırma takibi durdurur, `Çal` geri verir** (K-55) |
| Track tavanı | brief'te 10 | **`songLimits.maxTracks` = 8; kabul tavanda yapıldı, sınır yükseltilmedi** (K-55) |
| Davulun nota editörü | yoktu (K-55'te açık boşluk) | **Step grid: satır=parça, hücre=an; boş kitin de satırı var** (K-56) |
| Perdesiz enstrümanın editörü | yoktu | **Nota şeridi + nota sayfası; dikey eksen yok, çünkü aralık kayıtlı değil** (K-56) |
| Perdesiz enstrümanın oktavı | — | **Contract'ın grameri (-1..9), açılış şarkıdan okunur; uydurulmaz** (K-56) |
| Sesi olmayan enstrüman | Dinle sessizce hiçbir şey yapardı | **Dinle kapalı + tek dürüst cümle; sahte önizleme yok** (K-56) |
| Akor kurucusu | yalnız fret sheet'ten | **Perdesiz track'lerde de; gerçek nota yazar, metadata değil** (K-56) |
| Düzenleme kapısı | enstrümana bakıyordu | **Bakmaz; iki gerçek sebep kaldı: kaydedilemiyor, öneri ekranda** (K-56) |
| Yeni track sonrası aktif track | eskisi kalıyordu | **Yeni track; kimlikten bulunur, sıradan değil** (K-56) |
| Büyük yazı ayarı | dokunma hedefleri rem'di | **Piksel; %150'de 320 px'de satır sarar, hiçbir kontrol kırpılmaz** (K-56) |
| Enstrüman/akort niyeti | sabit rol tablosu | **Blueprint niyeti registry üzerinden taşınır** (K-35, K-36); sessiz fallback yok |

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

---

## §21 Shadow rehearsal ve provenance (§19 K-33)

Bir "shadow rehearsal", üretim prompt / şema / apply / validator yolunu
gerçek bir sağlayıcı çağrısı olmadan uçtan uca çalıştırmaktır. Faydalıdır —
sözleşmenin gerçekten bir parça çıkarıp çıkarmadığını gösterir — ama **kalite
ölçümü değildir** ve öyle raporlanamaz.

### §21.1 Kayıt zorunluluğu

Her cevap, blueprint dahil, kendi kaydını taşır:

```ts
type GenerationMode =
  | "provider"                  // adapter üzerinden gerçek sağlayıcı çağrısı
  | "separate_shadow_model"     // bilerek çağrılan ayrı bir model
  | "coding_agent_simulation"   // cevabı kodlama ajanının kendisi yazdı
  | "fixture";                  // diskten oynatılan kayıtlı cevap
```

Kayıt ayrıca sağlayıcı çağrısı olup olmadığını, sağlayıcı adını (varsa), model
etiketinin **doğrulanmış bir ID mi yoksa oturum etiketi mi** olduğunu, istek ve
cevap hash'lerini ve zaman damgasını taşır.

### §21.2 Dürüstlük kuralları

- `exactModelId` yalnız **runtime metadata**'dan doldurulur. Runtime
  söylemiyorsa alan boş kalır: makul görünen bir ID, boş bir alandan kötüdür,
  çünkü kanıt gibi okunur.
- Sağlayıcı çağrısı olmadan `provider` iddia eden kayıt **reddedilir**; bir
  sağlayıcı çağrısı sağlayıcıyı adlandırmak zorundadır.
- `coding_agent_simulation` **latency ve maliyet rakamı üretmez.** Ölçülecek
  bir çağrı yoktur ve burada uydurulan bir sayı karşılaştırma tablosunda
  ölçüm gibi görünür.
- Rehearsal, blueprint'i veya notaları sonuç yeşil olsun diye elle
  düzeltemez. Blueprint'in hash'i kayda bağlıdır; elle değiştirilmiş bir
  blueprint tutmaz.
- Modelin görmediği bir motif, turun talimatına elle yazılamaz (§11.5, K-32).

### §21.3 Neden

S-01 teslim raporu bir sağlayıcı modelinin cevapları ürettiğini söyledi.
Sağlayıcı hiç çağrılmamıştı. İddiayı mümkün kılan şey kötü niyet değil,
**kaydın yokluğuydu**. Bu bölümün tamamı o boşluğu kapatmak içindir ve
kuralları test altındadır.
