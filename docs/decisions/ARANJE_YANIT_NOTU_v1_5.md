# ARANJE — v1.2 KONSOLİDASYONUNA YANIT NOTU

**Sürüm:** v1.5 — NİHAİ · track ve maliyet güvenliği kararları işlenmiş  
**Muhatap:** Claude Code (aranje repo'su)  
**Sahip:** Haktan  
**Tarih:** 18 Ağustos 2026

Bu not v1.4'ün yerini alır. v1.3'teki `definedTracks=4` ve
`activeTracksPerSection=3` ayrımı, gerçek bir aranjedeki birden fazla gitar,
bas ve davul katmanlarını gereksiz biçimde engellediği için kaldırılmıştır.
v1.5 ayrıca pilot API maliyetinin ürün sahibine sınırsız zarar yazmaması için
sert bütçe ve kullanım kapılarını tanımlar.
v1.2 SİLİNMEZ; yol haritası belgesi olarak kalır. Build spec bu nota göre
güncellenir. Çelişki görürsen dur ve sor.

---

## 0. Genel değerlendirme

v1.2'nin şu kısımları AYNEN onaylandı ve build spec'e girecek:

- Resolution formülü ve Bar modeli (§6.4).
- NoteEvent/DrumHit şemaları.
- Instrument registry yaklaşımı (§6.1).
- Severity'li validator modeli (§10).
- Lisans politikası ve kaynak adayları (§7.2).
- Lazy yükleme (§7.1).
- Ses motoru izin/yasak listesi ve Distortion'ın geri alınması (§8).
- Token ekonomisi (§11.2).
- Telefon → backend → model mimarisi ve anahtar güvenliği (§11.4-11.5).
- Monetizasyonun metering sonrasına bırakılması (§12).
- Dark Workshop görsel dili (§5).

Yapısal düzeltme: "pilotta zorunlu" listesi faz sırasına yayılır. Hiçbir
onaylı gereksinim silinmez; yalnızca ne zaman yapılacağı netleşir.

## 1. KISS tanımı

KISS; UI ve uygulama mimarisinde gereksiz karmaşıklığı önler, ancak
onaylanmış ürün gereksinimlerini silmek veya ertelemek için gerekçe olarak
kullanılamaz. Kapsam ve sıralama kararlarının tek gerekçesi §3'teki faz planı
ve §6'daki çıkış kapısıdır.

v1.2 §4 bilgi mimarisi — tek ana yüzey ve gerektiğinde açılan bottom
sheet'ler — bu ilkenin UI karşılığıdır ve aynen geçerlidir.

## 2. Track modeli — nihai karar

### 2.1 Track ne demektir?

Track, bağımsız olarak çalınabilen ve ayrı volume/mute/pan ayarı taşıyan bir
müzik katmanıdır. Enstrüman türü değildir. Aynı enstrümanın birden fazla
örneği ayrı track'ler olabilir.

Örnek:

| Track | Rol | Enstrüman |
|---|---|---|
| Gitar 1 | Ana riff / rhythm L | electric_guitar |
| Gitar 2 | Aynı riffin armonisi / rhythm R | electric_guitar |
| Bas | Bas hattı | electric_bass |
| Davul | Ritim | drum_kit |

Bu örnek **4 track**'tir. İki gitar aynı sample paketini ve aynı
`instrumentId` değerini paylaşabilir; fakat ayrı `Track.id` değerlerine ve
ayrı mixer kanallarına sahiptir. Dolayısıyla ikinci gitar geldiğinde bas
veya davul dışarıda kalmaz.

### 2.2 Pilot sınırı

Pilotun tek track sınırı:

```ts
MAX_TRACKS = 8
```

- Section başına ayrıca bir "aktif track" sınırı YOKTUR.
- Şarkıda tanımlı track ile section'da aktif track arasında ayrı ürün limiti
  YOKTUR.
- Aynı `instrumentId`, farklı `Track.id` değerleriyle birden fazla kez
  kullanılabilir.
- Bir section, şarkıda bulunan track'lerin istediği alt kümesini kullanabilir.
- Sekiz track'in sekizi de aynı section'da çalabilir; geçiş kararını track
  sayısı değil §5.4'teki eşzamanlı voice sınırı ve cihaz performans testi
  verir.
- Track sınırı enstrüman kataloğu sınırı değildir. Katalogda çok sayıda
  enstrüman olabilir; aynı şarkıda en fazla sekiz bağımsız track bulunur.

Sekiz track tipik bir mobil düzen için şu alanı bırakır: iki rhythm gitar,
bir lead/armoni gitar, bir akustik gitar, bas, davul ve iki ek enstrüman
(örneğin piyano + strings/organ). Bu yalnız örnektir; roller sabitlenmez.

### 2.3 Şema ve ses motoru sonucu

- `Track.id` benzersizdir.
- `Track.instrumentId` benzersiz olmak zorunda değildir.
- Aynı sample kaynağı bellekte paylaşılır; aynı enstrümanın her track'i için
  örnekler yeniden indirilmez.
- Her track ayrı `Tone.Channel`/mixer kanalı kullanır.
- Volume, mute, pan ve efekt ayarları track bazındadır.
- NoteEvent ve DrumHit verileri track kimliği üzerinden ayrılır.
- Track ekleme, çoğaltma ve silme işlemleri referential-integrity validator'ı
  tarafından kontrol edilir.

## 3. Faz planı ve ÇEKİRDEK kapsam

Kanıt cümlesi:

> Telefonumda, gerçek enstrüman benzeri seslerle çalan bir şarkıya doğal
> dille pasaj eklettim; dinledim ve kabul ettim.

### 3.1 ÇEKİRDEK — Faz 0-2

- Şema ve motor en baştan `MAX_TRACKS=8` destekler.
- Hazır demo şarkı 4 track kullanır: elektro gitar, akustik gitar, elektro
  bas ve davul.
- Elektro gitar: clean + high-gain varyasyonları.
- Akustik gitar: steel + finger varyasyonları.
- Elektro bas: finger varyasyonu.
- Davul: rock kit; kick/snare/closed_hat/crash.
- Ölçü: 4/4 ve 6/8.
- Resolution: 8 ve 16; v1.2 §6.4 formülü aynen uygulanır.
- Akort: E Standard ve Drop D preset'leri.
- Pozisyon: §5.2'deki deterministik greedy kural.
- Articulation: palm_mute ve accent. Velocity şemada vardır, UI'da yoktur.
- Sınırlar: 16 toplam bar, section başına 1-8 bar, patch başına 8 bar.
- UI: AI sheet, karar çubuğu ve basit track ayarı
  (volume/mute + akort preset seçimi).
- Şema, v1.2'deki TAM Song/Track/NoteEvent/DrumHit/Bar haliyle yazılır;
  tuning dizisi, capo, velocity ve position baştan bulunur.

Çekirdek demo yalnız dört track kullanır; bu bir motor veya ürün limiti
değildir. Kullanıcı/fixture verisi sekiz track'e kadar açılabilir ve test
edilir.

### 3.2 Faz sırası — hepsi pilotun parçasıdır

#### Faz 0-2 — çekirdek web kanıtı

§3.1 kapsamı ve §6 çıkış kapısı tamamlanır.

#### Faz 2 çıkış kapısı

§6'daki ÇEKİRDEK MÜZİKAL KANIT geçilmeden Faz 2.5'e başlanmaz.

#### Faz 2.5 — pilot genişletmesi

- 64 toplam bar sınırı.
- 3/4 ve 7/8 ölçüleri.
- Core Lite'ın kalan enstrümanları ve varyasyonları.
- Akort preset'lerinin tamamı.
- Mevcut tellerin notasını tel tel elle değiştirme.
- Track ekleme, çoğaltma ve silme UI'sı.
- Aynı enstrümandan birden fazla track oluşturma akışı.
- Davul lane genişletmesi.
- Genişletilmiş articulation.
- Velocity UI.
- Section `bpmOverride`.
- Mixer sheet'in tam hali: pan/solo.

Faz 2.5'te kullanıcı track ekler veya mevcut track'i çoğaltır; AI bu
track'lere içerik yazabilir. AI'ın kendi kararıyla yeni track oluşturması
pilot sonrası kalır. Böylece ilk mobil akış öngörülebilir olur.

#### Faz 3 — Android pilotu

- Capacitor Android projesi.
- İki referans telefonda §5.4 audio regression protokolü.
- İmzalı APK.

Pilot ancak Faz 3 APK'sı telefona kurulunca tamamlanmış sayılır.

### 3.3 Pilot sonrası

- Basit/Pro mod ayrımı. Pilot arayüzünün adı Basit moddur; Pro mod, pilot
  sonrası ilk UI işidir.
- AI'ın gerektiğinde yeni track oluşturabilmesi.
- Tel ekle/çıkar, 7/8 telli gitar ve 5/6 telli bas.
- Gelişmiş pozisyon motoru ve el hareketi optimizasyonu.
- Audio import zinciri: yüklenen kayıttan fingerprint/tempo/key/section
  çıkarımı; telif ve lisans kuralları ayrı ürün kapısıdır.

## 4. Akort, capo ve perde semantiği

### 4.1 Pilot akortları

- Çekirdekte E Standard ve Drop D preset'leri bulunur.
- Faz 2.5'te ek preset'ler ve mevcut tellerin tel tel manuel akordu gelir.
- Manuel akort tel sayısını değiştirmez; tel ekle/çıkar pilot sonrasıdır.

### 4.2 Capo-relative tab kuralı

Tab üzerindeki perde sayısı capo'ya göre yazılır:

```ts
position.fret: 0..(24 - capo)
soundingPitch = tuning[string] + capo + position.fret
```

- `fret=0`, capo varsa capo'nun bastığı açık sesi ifade eder.
- Fiziksel perde = `capo + position.fret`.
- Validator ve greedy pozisyon motoru aynı anlamı kullanır.
- UI, capo-relative tab göstermeli; iç hesapta fiziksel perdeyi ayrıca
  türetmelidir.

## 5. Validator, pozisyon ve performans

### 5.1 Position hataları

- Kullanıcı veya model açıkça iki eşzamanlı notaya aynı tel numarasını
  verdiyse: **HARD ERROR**. Fiziksel olarak imkânsız tab warning ile kabul
  edilmez.
- Position boş ve greedy algoritma uygun yerleşim bulamadıysa: **WARNING**;
  nota positionsız çalınır veya yeniden eşleştirilir.
- Geçersiz string/fret/tuning ilişkisi yalnız açıkça girilmiş position'lar
  için **HARD ERROR** üretir.

### 5.2 Deterministik greedy pozisyon kuralı

1. Geçerli capo-relative fret aralığındaki pozisyonları bul.
2. Akorda her tel en fazla bir kez kullanılır.
3. En düşük maksimum fiziksel freti seç.
4. Eşitse toplam fiziksel fret değeri en düşük olanı seç.
5. Yine eşitse en düşük tel numarasıyla deterministik karar ver.

Bu kural birim testlidir ve gelişmiş el-hareketi optimizasyonu değildir.

### 5.3 Merkezi limitler

Limitler koda dağınık biçimde gömülmez; tek bir `lib/limits.ts`ten okunur.

```ts
export const songLimits = {
  maxTracks: 8,
  totalBars: 16,       // Faz 2.5: 64
  barsPerSection: 8,
  barsPerPatch: 8,
  maxVoicesPerSlot: 32,
} as const;
```

`definedTracks` ve `activeTracksPerSection` limitleri YOKTUR. Voice; aynı
anda başlayan veya sürmekte olan her NoteEvent/DrumHit sesidir. Bu tanım
akorları ve davulun eşzamanlı parçalarını doğru biçimde hesaba katar.

### 5.4 Ölçülebilir performans protokolü

- İki referans telefonun model, Android ve WebView sürümü kaydedilir.
- Faz 1'de çekirdek demo (4 track × 16 bar × 16 resolution) beş kez baştan
  sona çalınır.
- Faz 3'te sekiz track'in aynı section'da aktif olduğu 16 barlık stres
  fixture'ı beş kez çalınır; ayrıca 64 barlık şarkı bir kez tamamlanır.
- Test hem ekran açık beklerken hem section'lar arasında kaydırma yapılırken
  uygulanır.
- Kabul: kaçırılmış ses olayı = 0; 50 ms'den fazla geciken **audio event**
  = 0; donma/transport kayması = 0.
- Görsel `Tone.Draw` gecikmeleri audio scheduling ile karıştırılmaz.
  `audioLateEvents`, `drawLateEvents` ve `missedAudioEvents` ayrı sayaçlardır.
- `?debug=1`, test sonunda cihaz bilgisi ile event istatistiklerini içeren
  kopyalanabilir kısa rapor üretir.

## 6. Faz 2 çıkış kapısı — Çekirdek Müzikal Kanıt

Faz 2.5'e ancak şunlar sağlanınca geçilir:

- Telefonda web demo uçtan uca çalışır: metal şarkı çalar; "Opeth tarzı
  akustik pasaj ekle" promptu akustik gitarlı pending section üretir;
  pasaj dinlenir, kabul edilir ve kalıcı olur.
- Kasıtlı bozuk patch anlaşılır hata verir.
- Açık position çakışması hard error üretir.
- §5.4'ün Faz 1 performans testi yeşildir.
- Build, tsc, test ve lint yeşildir.
- Metering çalışır; istek başına token ve tahmini maliyet loglanır.

## 7. Model, adapter ve backend

### 7.1 Model env varsayılanları

```txt
ARANJE_MODEL_DEFAULT=claude-sonnet-5
ARANJE_MODEL_CHEAP=claude-haiku-4-5-20251001
ARANJE_MODEL_ESCALATION=
```

Haiku pinned snapshot ID ile sabitlenir. Escalation, Faz 2 müzikal
değerlendirmesinden önce boş kalır. Eval, varsayılanları değiştirmekte
serbesttir; maliyet tek seçim ölçütü değildir. Müzikal tutarlılık ve
"ruhsuz olmayan" çıktı ayrı eval başlıklarıdır.

### 7.2 Model-capability adapter

`lib/ai/adapter.ts`, model kimliğine göre desteklenen request payload'ını
kurar. Route, farklı capability'lere sahip modellere aynı ham payload'ı
göndermez. Adapter her model için golden request snapshot birim testine
sahiptir. README; Messages API, tool use, prompt caching, streaming ve model
migration dokümanlarına referans verir.

### 7.3 Telefonda agent mimarisi

- Model/API anahtarı APK veya istemci içine gömülmez.
- Telefon yalnız doğrulanmış patch isteğini backend'e gönderir.
- Backend modeli çağırır, tool/JSON çıktısını validator'dan geçirir ve
  istemciye döndürür.
- İstemci pending sonucu çalar; kabul veya ret kararı kullanıcıdadır.
- Başlangıçta ücretsiz/çok düşük maliyet hedeflenir; istek sayısı, token ve
  maliyet metering'i monetizasyondan önce tamamlanır.

### 7.4 Maliyet güvenliği ve pilot kotası

Harici model API'si kullanıldığı için mutlak sıfır değişken maliyet garanti
edilemez. Bunun yerine pilotta oluşabilecek toplam zarar baştan kesin bir
tavanla sınırlandırılır.

Pilot varsayılanları:

```txt
ARANJE_DAILY_AI_BUDGET_USD=2
ARANJE_MONTHLY_AI_BUDGET_USD=20
ARANJE_FREE_PATCHES_PER_USER_PER_DAY=3
ARANJE_MODEL_ESCALATION=
```

- Bu değerler backend ortam değişkenleridir; istemci veya APK tarafından
  değiştirilemez.
- Günlük ya da aylık global tavan dolduğunda sistem **fail closed** davranır:
  yeni AI isteği gönderilmez ve anlaşılır kota mesajı gösterilir.
- Kota dolunca playback, kayıtlı şarkılar ve manuel düzenleme çalışmaya devam
  eder.
- Kullanıcı, cihaz/hesap, IP ve global kapsamda rate limit uygulanır.
- Kullanıcı başına aynı anda yalnız bir AI patch isteği çalışabilir.
- Request öncesi tahmini token kontrolü, request sonrası gerçek
  input/output/cache token ve tahmini USD maliyeti kaydı yapılır.
- Model fiyatları uygulama koduna dağınık biçimde gömülmez; sürümlenebilir
  backend fiyat konfigürasyonundan okunur.
- Ucuz model önce denenir. Pahalı modele otomatik escalation pilotta kapalıdır;
  yalnız müzikal eval ve açık ürün kararıyla açılabilir.
- Prompt ve output token sınırları adapter seviyesinde zorunludur.
- Prompt caching ve kompakt serileştirme uygulanır.
- 6-8 track'li kullanım verisi oluştuğunda §7.7 bağlam penceresi metering
  loglarına göre daraltılabilir: hedef section'da aktif track'ler tam,
  komşu section'lar özet gönderilir. Bu şimdilik bloker değildir.
- Bütçe, kota ve escalation ayarları için backend kill-switch bulunur; limit
  aşımlarında sağlayıcı çağrısı yapılmadan istek reddedilir.

Ticari sürümde sınırsız AI paketi sunulmaz. Ücretli kredi/paket fiyatı;
model, backend ve mağaza değişken maliyetleri ölçüldükten sonra belirlenir.
Başlangıç hedefi, AI kredisinin değişken maliyetinin en az 3-5 katına
fiyatlanmasıdır. Monetizasyon kararı gerçek metering verisi görülmeden
kilitlenmez.

## 8. Faz 0 başlama koşulu

Build spec şu maddelerle güncellenince Faz 0 başlar:

- [ ] §2 track modeli işlendi: `maxTracks=8`; aynı enstrümandan birden fazla
  track serbest; section başına aktif-track limiti yok.
- [ ] §3 faz planı ve çekirdek kapsam işlendi.
- [ ] Şema tam, kapsam çekirdek olarak yazıldı.
- [ ] §4 capo-relative fret semantiği işlendi.
- [ ] §5 validator ayrımı, greedy kural, `limits.ts` ve voice sınırı işlendi.
- [ ] §1 KISS tanımı ilke bölümüne girdi.
- [ ] Basit/Pro modu pilot sonrası bölümünde adıyla yer aldı.
- [ ] §7.1 env varsayılanları ve §7.2 adapter işlendi.
- [ ] §7.4 global bütçe tavanı, kullanıcı kotası, rate limit, kill-switch ve
  fail-closed davranışı işlendi.
- [ ] §5.4 performans protokolü Faz 1 ve Faz 3 kabulüne işlendi.
- [ ] APK'nın pilot tamamlanma kriteri olduğu Faz 3'e yazıldı.

Kapı geçildikten sonra Faz 0'a başla. Her faz sonunda kabul kriterleri ve
doğrulama komutları raporlanır. Faz 2 müzikal kanıtı alınmadan Faz 2.5'e
geçilmez.
