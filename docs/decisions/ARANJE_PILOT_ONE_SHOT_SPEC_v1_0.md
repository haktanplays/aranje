# ARANJÉ — PILOT ONE-SHOT BUILD SPEC
Sürüm: 1.0 · Sahip: Haktan · Durum: Onaylı taslak
Bu doküman spec-driven-build protokolüne göre yazılmıştır. Spec kanundur;
belirsizlik varsa sor, çelişki varsa dur ve bildir. Fazlar sıralıdır —
sonraki fazın işini erkenden çekme.

---

## §1 Vizyon ve Pilot Amacı

Aranjé, Cursor × Songsterr kesişiminde bir "müzik copilot"udur:
kullanıcı doğal dille müzik ister ("şuraya Opeth gibi akustik pasaj ekle"),
AI sembolik müzik üretir, kullanıcı dinler ve bar bazında kabul/ret eder.

Pilotun amacı ürün değil KANIT üretmektir. Pilot bittiğinde şu cümle
gösterilebilir olmalı: "Telefonumda, gerçek enstrüman sesleriyle çalan
bir şarkıya, doğal dille AI pasajı ekletip dinleyip kabul ettim."

Hedef kitle ikili: müzik bilenler (editör) + bilmeyenler (sadece prompt).
Pilot, ikisinin ortak çekirdeğini kurar; mod ayrımı pilot sonrasıdır.

- §1.1 İSİM KURALI: Marka adı her kullanıcıya görünen yerde "Aranjé"
  (é ile) yazılır. Teknik her bağlamda — repo adı, package.json `name`,
  klasör/dosya adları, route'lar, env prefix'leri, localStorage anahtarları —
  ASCII "aranje" kullanılır. é karakteri koda asla girmez.

## §2 Kapsam (Pilotta VAR)

- §2.1 Mobil öncelikli responsive web uygulaması (telefon tarayıcısında birinci sınıf deneyim).
- §2.2 Sembolik şarkı modeli (JSON) — tek doğruluk kaynağı (§5).
- §2.3 Ses motoru: sample tabanlı melodik enstrümanlar + synth davul (§6).
- §2.4 Çok kanal: en az 3 enstrüman aynı anda (ör. gitar + bas + davul).
- §2.5 Timeline editörü: section blokları, bar highlight, play/stop (§10).
- §2.6 AI copilot döngüsü: prompt → patch → validator → pending diff → kabul/ret (§7).
- §2.7 Deterministik müzik-teorisi validator'ları (§8).
- §2.8 2 adet stil kartı (§9).
- §2.9 localStorage kalıcılığı (şarkı + geçmiş).

## §3 Non-Goals (Pilotta YOK — yapma)

- §3.1 Kayıt/auth, Supabase, çok kullanıcılılık.
- §3.2 alphaTab / gerçek tab-nota render'ı (pilot sonrası).
- §3.3 Expo / React Native native uygulama (pilot sonrası; §14).
- §3.4 Audio export (WAV/MP3 render).
- §3.5 Basit/Pro mod ayrımı — pilot tek arayüz.
- §3.6 Ses efekt zincirleri (reverb, delay, distortion node'ları) — §6.2 gereği yasak.
- §3.7 3'ten fazla enstrüman, 16 bar'dan uzun şarkı.

## §4 Stack (sabit — değiştirme, öneri varsa sor)

- Next.js 14+ (App Router) + TypeScript strict + Tailwind.
- Tone.js (^14) — yalnızca §6.2'de izin verilen node'lar.
- AI: Anthropic Messages API, yalnızca sunucu tarafı route üzerinden
  (`/api/copilot`); API anahtarı `.env.local` → `ANTHROPIC_API_KEY`,
  client'a asla sızmaz.
- Veri: localStorage. Backend DB yok.
- nextjs-supabase-standards skill'i geçerlidir (Supabase bölümleri hariç).

## §5 Veri Modeli — Song Contract (isimler AYNEN böyle)

```ts
type Song = {
  version: 1;
  bpm: number;                 // 60–200
  timeSignature: [4, 4];       // pilot: sadece 4/4
  key: string;                 // ör. "E minor" — validator referansı
  tracks: Track[];             // max 3
  sections: Section[];         // sıralı
};
type Track = {
  id: string;                  // "gtr", "bass", "drums"
  instrument: "acoustic_guitar" | "electric_guitar" | "bass" | "piano" | "drums";
  volumeDb: number;            // -24..+6
};
type Section = {
  id: string;
  name: string;                // kullanıcıya görünen ad
  status: "fixed" | "pending" | "accepted";
  bars: Bar[];                 // 1–8 bar
};
type Bar = {
  // trackId -> 8 sekizlik slot; null = sus.
  // Melodik track: nota adı ("E3", "F#4") veya nota dizisi (akor).
  // drums track: "kick" | "snare" | "hat" | null.
  notes: Record<string, (string | string[] | null)[]>;
};
```

- §5.1 Bu şema hem UI'nin hem ses motorunun hem AI patch'lerinin ortak dilidir.
- §5.2 Şemayı zod ile doğrula; her localStorage okuması ve her AI patch'i
  zod'dan geçmeden sisteme giremez.

## §6 Ses Motoru Kuralları

- §6.1 Melodik enstrümanlar `Tone.Sampler` ile GERÇEK sample çalar.
  Sample'lar `public/samples/<instrument>/` altına vendor'lanır (setup
  adımında tonejs-instruments setinden indirilir; runtime'da dış CDN'e
  gidilmez). Her enstrüman için nota başına dosya listesi README'ye yazılır.
- §6.2 KANITLANMIŞ-NODE İLKESİ (mobil WebView dersi): sinyal zinciri
  yalnızca şu node'ları içerebilir: Sampler, PolySynth(Synth),
  MembraneSynth, NoiseSynth, Filter, Gain/Channel, Destination, Meter.
  Reverb, Freeverb, PluckSynth, FMSynth, Convolver, AudioWorklet YASAK.
  Gerekçe: bu projede mobil WebView'da PluckSynth/Reverb ve
  FMSynth/Freeverb zincirlerinin sessiz kaldığı saha testiyle doğrulandı.
- §6.3 Her Track bir `Tone.Channel`'a, tüm kanallar tek master Gain'e bağlanır.
- §6.4 Tüm zamanlama `Tone.Transport.schedule` ile; `setTimeout` ile ses
  zamanlaması yasak. `Tone.start()` yalnızca kullanıcı jestinde çağrılır.
- §6.5 Debug modunda (query param `?debug=1`) her kanala Meter bağlanır ve
  UI'da dB gösterilir — sessizlik teşhisi için kalıcı altyapı.

## §7 AI Copilot Döngüsü

- §7.1 Kullanıcı promptu + mevcut Song JSON + ilgili stil kartı,
  `/api/copilot` route'unda sistem promptuyla birleştirilir.
- §7.2 Model YALNIZCA şu patch formatında JSON döner (isimler aynen):

```ts
type CopilotPatch = {
  action: "insert_section" | "replace_section";
  targetSectionId?: string;    // replace için zorunlu
  afterSectionId?: string;     // insert için zorunlu
  section: Section;            // status her zaman "pending" gelir
  explanation: string;         // kullanıcıya gösterilecek 1-2 cümle
};
```

- §7.3 Sunucu akışı: model yanıtı → JSON parse → zod → §8 validator'ları.
  Validator hatası varsa model'e hata listesiyle EN FAZLA 2 kez düzeltme
  turu yaptırılır; hâlâ geçmiyorsa kullanıcıya anlaşılır hata döner.
- §7.4 Client: geçen patch pending section olarak timeline'a düşer
  (kesikli çerçeve). Butonlar: "Dinle" (sadece o section), "Kabul", "Ret".
  Kabul → status "accepted", localStorage'a yaz. Ret → section silinir.
- §7.5 Kabul/ret olayları `history` olarak localStorage'a loglanır
  (tarih, prompt, patch id, karar) — gelecekteki zevk-öğrenme döngüsünün tohumu.

## §8 Validator Katmanı (saf fonksiyonlar, `lib/validators/`)

Her biri `(song, patch) => ValidationError[]` imzasında, birim testli:

- §8.1 `barLength`: her bar her track'te tam 8 slot.
- §8.2 `keyMembership`: melodik notalar şarkının `key` gamı içinde
  (doğal minör/majör; gam dışı nota = hata, hata mesajı notayı ve bar'ı söyler).
- §8.3 `range`: notalar enstrüman aralığında (gitar E2–E6, bas E1–G3, piyano A0–C8).
- §8.4 `drumVocab`: drums track'i yalnızca kick/snare/hat/null içerir.
- §8.5 `schemaShape`: zod (bkz. §5.2) — validator zincirinin ilk halkası.
- §8.6 Validator'lar hem AI patch'lerine hem manuel düzenlemeye uygulanır.

## §9 Stil Kartları (`content/styles/*.md`)

- §9.1 Pilotta 2 kart: `opeth-acoustic.md`, `generic-metal.md`.
- §9.2 Kart formatı: tonalite eğilimleri, ritmik karakter, tempo aralığı,
  doku tarifi + Song JSON formatında 2 somut örnek pasaj (few-shot).
- §9.3 Route, prompt içinde stil adı geçerse ilgili kartı sistem promptuna
  ekler; geçmezse kart eklenmez.
- §9.4 Kart içerikleri build'e gömülür (fs read at build/route time).

## §10 UI (mobil öncelikli)

- §10.1 Tek sayfa: üstte prompt girişi + gönder; ortada yatay kaydırılabilir
  section timeline'ı (bar highlight, pending'de kesikli çerçeve + üç buton);
  altta transport (play/stop, bpm göstergesi) + AI açıklama satırı.
- §10.2 Dokunma hedefleri ≥ 44px; tek elle kullanılabilir yerleşim.
- §10.3 Mini-tab görselleştirme (6 çizgi + nota noktaları) prototipteki
  gibi; alphaTab DEĞİL (§3.2).
- §10.4 Görsel kimlik: koyu sıcak zemin (#15130F ailesi), bronz vurgu
  (#C98F3D), pending = kesikli bronz. Prototipteki dili koru.

## §11 Fazlar ve Kabul Kriterleri

### Faz 0 — İskelet
Next.js + TS + Tailwind kurulu; zod'lu Song şeması + örnek şarkı
(2 metal section, 3 track) localStorage'dan yükleniyor; boş timeline çiziliyor.
KABUL: `npm run build` temiz; telefonda sayfa açılıyor, örnek şarkı listeleniyor.

### Faz 1 — Ses Motoru + Editör
Sampler'lar vendor'lanmış sample'larla çalıyor; 3 kanal karışık çalıyor;
play/stop + bar highlight; §6 kurallarına tam uyum; `?debug=1` metre çalışıyor.
KABUL: telefonda örnek şarkı 3 enstrümanla baştan sona duyuluyor;
tüm validator birim testleri yeşil (`npm test`).

### Faz 2 — Copilot Döngüsü
`/api/copilot` çalışıyor; §7 akışı uçtan uca; 2 stil kartı aktif.
KABUL: telefonda "add an Opeth-style acoustic passage after the first riff"
promptu pending section üretiyor, dinlenip kabul edilince kalıcı oluyor;
kasıtlı bozuk patch (gam dışı nota) kullanıcıya anlaşılır hatayla dönüyor.

### Faz 3 — Cila
Ret animasyonu, history görünümü (son 10 karar), hata durum ekranları,
Lighthouse mobile performance ≥ 80.
KABUL: Faz 0–2 kriterleri hâlâ yeşil + bu fazın maddeleri.

## §12 Doğrulama Komutları (her fazda)

`npm run build` · `npx tsc --noEmit` · `npm test` (Vitest, validator'lar
+ patch akışı) · `npm run lint`. Bunlardan biri kırmızıysa faz bitmemiştir.

## §13 Riskler ve Bilinen Dersler

- §13.1 Mobil WebView ses uyumsuzluğu → §6.2 ilkesi + §6.5 metre. Ses
  sorunu raporlanırsa ilk bakılacak yer debug metresidir, kod değil.
- §13.2 Sample dosya boyutu → enstrüman başına seyrek nota seti (oktav
  başına 2-3 sample; Sampler ara notaları pitch-shift'ler).
- §13.3 Model JSON disiplini → §7.3'teki düzeltme turu + zod zorunlu.
- §13.4 iOS sessiz mod anahtarı sesi kesebilir → UI'da ilk çalmada
  "sesi açık tuttuğundan emin ol" ipucu göster.

## §14 Pilot Sonrası Ufuk (bu spec'in dışı — dokunma)

alphaTab entegrasyonu ve gerçek tab görünümü; Basit/Pro mod ayrımı;
Expo + react-native-audio-api ile native mobil; audio export; zevk-öğrenme
döngüsü (history verisinden kişiselleştirme); topluluk stil kartları.
