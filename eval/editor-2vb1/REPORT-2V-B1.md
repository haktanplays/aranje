# Faz 2V-B.1 — teslim raporu

Dal: `claude/proje-yorumları-n06wen` · Depo: `haktanplays/aranje`

Bu tur iki eşzamanlı çalışmanın birleştirilmesiyle başladı ve tek bir ileri
commit ile kapanıyor. Aşağıdaki 24 madde, §18'in istediği sırayla, ölçülen
sayıları verir. Ölçülmemiş hiçbir şey "geçti" diye yazılmamıştır; fiziksel
kanıtı olmayanlar madde 24'te ayrıca sayılır.

---

## 1 · Başlangıç ve bitiş SHA'sı, commit grafiği

| | |
|---|---|
| Turun başladığı HEAD | `40a3a07b38cfd41765b2d66a02c28de1eb939953` |
| `@{u}` (aynı) | `40a3a07b38cfd41765b2d66a02c28de1eb939953` |
| Merge ebeveyni A | `dc109698b73983a2d1f683476c4ad24f1160492b` |
| Merge ebeveyni B | `ef4291d58b606ae0e17bdc6b41a9e07919de8d6f` |
| Turun bitiş SHA'sı | *(bu raporun commit'i — §20'de tek ileri commit)* |

```
*   40a3a07 Merge remote-tracking branch 'origin/…' into claude/proje-yorumları-n06wen
|\
| * ef4291d Separate acceptance storage truth from action transactions
* | dc10969 Reproduce the founder's run, and close what it exposed
|/
* 26bd505 Let the run artefact say what the ten runs did
```

Hiçbir reset, rebase, amend veya force-push yapılmadı. İki ebeveynin de işi
korunmuştur: `session.ts` birleşmesi denetlendi, iki taraf da çalışır durumda
kaldı (madde 2).

## 2 · Merge denetimi — iki gövde de yaşıyor

`ef4291d`'in getirdiği depo-izolasyon doğruluğu ve `dc10969`'un getirdiği
işlem defteri, birleşmeden sonra iki ayrı modül olarak duruyor:
`src/lib/acceptance/isolation-truth.ts` (depo alanı) ve
`transaction-ledger.ts` (işlem alanı). İkisi de bu turda genişletildi, hiçbiri
diğerinin lehine silinmedi. `session.ts` üzerindeki birleşme, her iki tarafın
da kendi testleriyle yeşil.

## 3 · Kurucu FAIL'inin canlı olarak yeniden üretilmesi

`artifacts/BASELINE.json`, kurucunun raporladığı turu `26bd505` üzerinde,
384×692 + Android Chrome UA ile yeniden çalıştırır. Ölçülen:

- `layout.guideHeight = 348`, `viewport = 692` → rehber ekranın **%50**'sini
  kaplıyordu. Rehber açıldığı andaki görünümde `strings = 0`,
  `staffHeight = 0`; Tab görünümüne geçildiğinde 12 tel çizgisi vardı ama
  rehberin altında kalıyordu. Yani ölçülen şey «porte hiç çizilmedi» değil,
  «porteye ulaşmak için ekranın yarısını kaplayan rehberin altına inmek
  gerekiyordu».
- Sonuç bloğu "Proje değişmedi: **evet**" diyordu, `verdict = FAIL`,
  `KALDI = 6`.
- Cihaz deposu üzerinde: `addedWhileOpen = []`, `changedWhileOpen = []`,
  `addedAfterClose = []`, `changedAfterClose = []`.

**Önemli düzeltme:** kurucunun aktardığı "Proje değişmedi: HAYIR" cümlesi bu
koşuda **yeniden üretilemedi** — blok "evet" diyordu. Bunu fiziksel bir iddiaya
çevirmiyorum; hangisinin doğru olduğunu ancak Haktan'ın tam ekran koşusu
söyleyebilir.

## 4 · Kök neden: rehberin ekranı yemesi

`Workspace`'in kökü `h-dvh`. Kabul sayfası onu `flex-1` bir kutuya koyunca
workspace kutudan taşıyordu: 384×692'de sahne **556 px**, workspace **761 px**
— yani transport çubuğu ve besteci kapısı satırı ekranın altında kalıyor,
dokunulamıyordu. Düzeltme, iletken rotasının zaten kullandığı
`[&>div]:h-full` varyantını üç kabul rotasına da vermek oldu. Bu, kurucunun
"kontroller orada değildi" FAIL'inin büyük olasılıkla büyük bölümüdür.

## 5 · Geometri: 348/692 → 0/692 rehber, 556/692 sahne

`artifacts/GEOMETRY.json` — beş bağlamda **130/130** kontrol geçti
(320×700, 384×692-android, 390×844, 412×915-android, 1363×936-desktop; her
biri 26/26).

384×692'de ölçülenler:

| Ölçüm | Değer |
|---|---|
| Rehber katmanı sayısı | 0 |
| Sahne yüksekliği | 556 / 692 px (**%80**) |
| «Teste dön» şeridi | 61 px, normal akışta, hiçbir üretim hedefinin üstünde değil |
| Görünür tel çizgisi | 12 (iki enstrüman × 6/4 tel) |
| Transport düğmeleri | 4 × 44 px, hepsi erişilebilir |
| Yatay taşma | 0 |
| 44 px altı zorunlu kontrol | 0 |
| Kırpılmış zorunlu etiket | 0 |
| Konsol hatası | 0 |

## 6 · İki tam ekran durumu, karşılıklı dışlayan

Soru ekranındayken workspace hem **düzenden** hem **hit-test'ten** çıkıyor:
`{"inLayout": false, "hidden": true}`, `workspaceHit: false`. Soru ekranında
tam olarak 1 görev ve 1 adım başlığı var; hiçbir cevap önceden seçili değil
(0), cevapsız soruda «Sonraki adım» `disabled` (`nextDisabled=true`).
«Şarkıya geç» 44 px ve aynı oturuma dönüyor
(`{"session":"2vb1-q49zme22","stageVisible":true,"tasks":0}`).

## 7 · Dört alanlı izolasyon doğruluğu

`isolation-truth.ts` dört alanı ayrı ayrı hash'ler ve tiplenmiş kusur adı
döner (`device_storage_writes_expected_0_received_N`,
`eval_fixture_not_restored`, `restore_invented_journal_writes_N`,
`watcher_read_the_wrong_store`, `session_store_not_installed`,
`guide_left_behind:<ad>`). Kabul koşusunun ölçtüğü:

```
Cihaz projesi değişmedi: evet
Cihaz deposuna yazma:    0
Cihaz hash:  device:b17388hazatve → device:b17388hazatve
Test kopyası geri yüklendi: evet
Test kopyasına yazma:    15
Kopya hash:  fixture:b4569h10c80x3 → fixture:b4569h10c80x3
Rehber temizliği: clean
İzolasyon: TAMAM
```

İki hash **ayrı alan adlarıyla** basılıyor; birinin diğerinin yerine geçmesi
mümkün değil.

## 8 · Revizyon, geçmiş ve kopya kaydı

`Revizyon: 1 → 1`, `Geçmiş adımı: 1 → 1`. Tur içinde 15 yazma oldu, sonunda
kopya bayt-eş geri yüklendi — yani kabul turu kendi izini siliyor, cihazın
gerçek projesine hiç dokunmuyor.

## 9 · Beş yazma eyleminin işlem defteri

Her satır: komut sayısı · yazan komut · depo yazması · revizyon artışı ·
geçmiş · ve beş hash (önce/sonra/geri/ileri/temizlik).

| Eylem | Sonuç | komut | yazan | depo | rev | geçmiş |
|---|---|---|---|---|---|---|
| paste | **atomic** | 1 | 1 | 1 | 1 | 1→2 |
| duplicate | **atomic** | 1 | 1 | 1 | 1 | 2→3 |
| move | **atomic** | 1 | 1 | 1 | 1 | 3→4 |
| repeat | **atomic** | 1 | 1 | 1 | 1 | 4→5 |
| delete | **atomic** | 1 | 1 | 1 | 1 | 5→6 |

Beş satırın hepsinde `geri` hash'i `önce` ile, `ileri` hash'i `sonra` ile
**bayt-eş**; `temizlik` hash'i `önce`ye dönüyor. Örnek (paste):
`önce=b3612hjgi1r4 · sonra=b3968hup9ami · geri=b3612hjgi1r4 ·
ileri=b3968hup9ami · temizlik=b3612hjgi1r4`.

**Kopya kanıtı:** `runCopy` `mutating: false` ve iki eşit parmak iziyle
yayın yapıyor; defterde depo yazması üretmiyor. Probe 9 ("a copy quietly
commits") bunu kırmızıya çeviriyor.

## 10 · Duraklat/devam et — tam tick

`ExpressionRuntime.resumeAt(ticks, audioTime, window?)` ve
`ExpressiveVoicePool.resume(plan, time)` eklendi; `PlaybackController` tick'i
transport kımıldamadan **önce** yakalıyor (`heldResumeTicks`) ve devam
ederken tek bir paylaşılan an kullanıyor. Ölçülen:

```
playing      → ticks 785
paused       → ticks 798
stillPaused  → ticks 798   (aynı tick, kaymadı)
resumed      → ticks 1053  (ileri gitti)
```

Duraklatılmış tick iki okumada da **798**; devam ettikten sonra ileri
sayıyor. Devam eden ses için **hiçbir yardımcı transient üretilmiyor** —
bu bilinçli bir sınır ve `active-voices.ts` içinde yazılı.

## 11 · Slide / vibrato / HO-PO için elimizdeki kanıt

`activeVoicesAt(...)` saf katmanı, Tone'suz, şunları test ediyor
(`active-voices.test.ts`, 11 test):

- slide, duraklama anında kaynak ile hedef perde **arasında** bir cent
  değerinde devam ediyor (tam sınırda değil);
- vibrato, iki farklı anda **farklı faz** değeri veriyor;
- hammer-on ve pull-off'un her biri tek bir zincir sesi üretiyor;
- tam onset anındaki nota **dışlanıyor** (transport'un kendi olayı çalar),
  bir tick sonrası **dahil ediliyor** (pozitif kontrol).

**Bu bir zamanlayıcı kanıtıdır.** Slide/vibrato/HO-PO'nun *kulağa doğru
geldiğini* söylemiyorum; bunu yalnızca fiziksel dinleme söyleyebilir
(madde 24).

## 12 · Döngü doğruluğu

`transport.on("loop")` geri çağrısı artık üç kapıdan geçiyor: controller
atılmışsa, `state.loop.kind === "none"` ise veya `transport.loop` kapalıysa
hiçbir şey yapmıyor. Kabul koşusunda ölçülen:

```
looping → status=playing, loop={on:true, 192→240}, selection={gtr, mode:"loop"}
after   → status=paused,  loop=null, selection=null
```

Yani döngü kapatıldıktan sonra kuyruğa girmiş bir sarma olayı artık ses
üretmiyor. İki kapı bilerek **fazlalıklıdır**: `setLoop({kind:"none"})`
ikisini birden kapatır, dolayısıyla biri tek başına da yeterlidir. Probe 18
bu yüzden ikisini **birlikte** kaldırır; yalnız birini kaldıran bir probe
yeşil kalır ve bu bir örtü boşluğu değil, kasıtlı bir yedekliliktir.

## 13 · Fixture yükseltmesi

`editor-fixture.ts` artık gerçek çalınabilir malzeme taşıyor: 1. ölçüde
basılı tutulan strum'lu let-ring power chord (`durationTicks` 384), 5. ölçüde
Re telinde 5→7 slide ve vibrato (384 tick), 6. ölçüde tek zincirde
hammer-on + pull-off ve strum'lu let-ring G5 akoru, ölçü boyunca gerçek
esler. `EDITOR_LANDMARKS` bu geçişleri adıyla veriyor; `song-support.ts` de
onları fixture'ı hatırlayarak değil **plandan okuyarak** buluyor (boş şarkıda
hepsi `null` döner — probe 27).

## 14 · Görev tanımları şarkıdan üretiliyor

`describeTask(...)`, bölüm/enstrüman/ölçü/tel/perde adlarını Song'un
kendisinden alır. Örnek üretilen cümle:

> Kabul · Gitar · 1. ölçü: ilk power chord'a basılı tut, sonra «Devam»a
> dokun ve ileride bir yere uzun bas.

Duraklatma görevi §12'nin verdiği örneği kelimesi kelimesine üretiyor:
"Re telindeki 5→7 slide" + "duraklat". Şarkı o pasajı taşımıyorsa görev
sorulmaz, tiplenmiş bir ret döner (`no_shared_bar`).

## 15 · Adımı geçiren şey basış değil, üretim olayı

`src/lib/song/workspace-events.ts` bir **üretim** kanalıdır: hiçbir çağrı
noktasında "eğer kabul" dalı yoktur, `@/lib/acceptance/` içine hiç bakmaz ve
kendi build SHA'sını taşımaz (bu dört kural teste bağlanmıştır). Yayın
yalnızca `store.commit(...)` **başarılı döndükten sonra** yapılır.

**Bunun bedeli ölçüldü.** Her yazma, iki parmak izi hesabı ekler
(`songBefore` ve `songAfter`). Ölçülen: 3.6 KB'lik kabul fixture'ında
0.33 ms, 14 KB'lik örnek şarkıda 0.53 ms, 123 KB'lik yirmi bölümlük bir
şarkıda 4.6 ms — yani düz `JSON.stringify`'ın yaklaşık **10 katı**, çünkü
`canonical()` önce anahtarları sıralayarak nesneyi yeniden kurar. Büyük bir
şarkıda tek bir düzenleme başına ~9 ms eklenir. Ayrı bir dokunma jesti için
kabul edilebilir bir bedeldir, ama bedava değildir ve gizlenmemiştir: tek
geçişli bir sıralı-serileştirici bunu 2–3 kata indirebilir, o iş bu turun
kapsamı dışında bırakıldı.

`judgeWorkspaceEvent`, bir olayın göreve ait olmamasının sekiz adını verir:
`wrong_build`, `wrong_session`, `wrong_song`, `wrong_step`, `wrong_action`,
`wrong_track`, `wrong_bar`, `stale_revision`. Yalnızca **kabul edilen** olay
ize girer. Kabul koşusunda `Ölçülmemiş adım: 0`, `refused: ""` (hiçbir adım
yanlış olayla geçmedi).

## 16 · On üç adımın tamamı, sayfanın ölçtüğü + insanın söylediği

`ACCEPTANCE.json`: **34/34** kontrol, **13/13** adım, `verdict = PASS`,
`Cevaplanmamış soru: 0`, `Kararsız cevap: 0`, `consoleErrors: []`.
Yazma adımlarının ölçümü şöyle okunuyor:

- 6 (kopyala-yapıştır): *üretim olayı + tek yazma + geri al + ileri al bayt-eş*
- 7 (çoğalt), 8 (taşı), 9 (tekrarla): *üretim olayı + tek atomik yazma*
- 10 (sil→geri al): *üretim olayı + tek yazma + geri al bayt-eş*
- okuma/dinleme adımlarının hepsi: *yazma yok*

## 17 · 10. adımın yeniden yazımı

10. adım artık §14'ün belirlediği iki cümleyi, o sırayla soruyor:

> Seçili notaları sil. Notalar kaybolunca Geri al'a dokun. Aynı notalar aynı
> yere geri geldi mi?

Bunu bir test kelimesi kelimesine sabitliyor. Ardından gelen "ileri al" bir
basış daha; soruyu değiştirmiyor, defterdeki `redoHash` sütununu veriyor.

## 18 · 11A ve 11B ayrıldı

İki adım artık **farklı filtrelerle** ölçülüyor ve aynı filtreyle geçmeleri
imkânsız (`batchVerdict`, `sameFilter(track, measure)` görürse FAIL):

| | başlangıç | bitiş | enstrüman | onset |
|---|---|---|---|---|
| 11A (satır) | 0 | 240 | `gtr` | 4 |
| 11B (ölçü başlığı) | 0 | 768 | `gtr`, `bass` | 9 |

`İkinci enstrüman duyuldu: evet`. `secondTrackAudible === false` de FAIL
üretir (probe 32).

## 19 · Eski bindirme yerine yeni akış

Eski akışta rehber ekranın yarısını kaplayan bir katmandı ve altındaki
workspace'i hem görsel hem dokunma olarak yiyordu (madde 3). Yeni akışta
iki durum karşılıklı dışlayan: ya tam ekran şarkı + 61 px'lik «Teste dön»
şeridi, ya tam ekran soru + düzenden çıkmış workspace. Ölçülen rehber
katmanı sayısı beş bağlamda da **0**.

## 20 · 34 negatif probe

`artifacts/PROBES.json`: **34 probe, 34 kırmızı, 0 yeşil kalan.** Aileler:
izolasyon (1–4), işlem defteri (5–10), fixture müzikalitesi (11–13),
devam eden ses (14–17), transport yaşam döngüsü (18–21), parmak izi ve olay
bağlama (22–27), adım/cevap doğruluğu (28–32), tarayıcı geometrisi (33–34).

Bu turda **üç probe önce yeşil kaldı ve üçü de probe'un kendi hatasıydı**:
bas notasını susturmadan taşıyan bir mutasyon, iki katmanlı sarma korumasının
yalnız bir yarısını kaldıran bir kesme, ve `batch-steps.ts`'i ayrıştırılamaz
hale getiren bir kesme (`if (false)` ile düzeltildi). Dördüncüsü yeni bir test
gerektirdi: `songFingerprint`'in anahtar sırasından bağımsızlığı (probe 22).

## 21 · Tekrarlı doğrulama

`artifacts/RUNS.json` — her koşu kaç test çalıştığını kaydeder, çünkü
"10× yeşil" hiçbir testi eşleştirmemiş bir komut üzerinde hiçbir şey
söylemez:

| Koşu | Adet | Her koşuda |
|---|---|---|
| Hedefli süit | 10 | **444 test** |
| Bütün süit | 4 | **4577 test** |
| Tarayıcı kabulü | 10 | 34/34 kontrol |

Ardışıklık esastır: düşen bir koşu sayacı sıfırlar, atlanmaz.

## 22 · Bu turda bulunan ve kapatılan dört üretim kusuru

1. **`h-dvh` kırpması** — kabul sahnesinde transport ve besteci kapısı
   ekran dışındaydı (madde 4). Probe 33.
2. **Hidrasyon uyuşmazlığı (React #418)** — oturum kimliği `useState`
   başlatıcısında `Math.random()` ile üretiliyordu; `useSyncExternalStore` ile
   istemciye taşındı.
3. **Parmak izinin anahtar sırasına bağlı olması** — aynı müzik iki yerde iki
   sırayla duruyordu, her yazma adımı `wrong_song` diyordu. Özyinelemeli
   `canonical()` ile çözüldü (diziler sırasını korur — müzikte sıra müziktir).
   Probe 22.
4. **Defterin ham bayt karşılaştırması** — kaydın baytları oturumun ilk
   commit'inde deponun kendi anahtar sırasıyla yeniden yazılıyordu;
   `canonicalBytes()` ile çözüldü. Probe 7.

Ayrıca bir sınır ihlali kapatıldı: kabul kancası `@/lib/projects/project-storage`
içine bakıyordu (§138); anahtar bilgi `fixture-read.ts` içine taşındı.

## 23 · Yapı, tip, test, lint, ağaç

| Kapı | Sonuç |
|---|---|
| `npm run build` | başarılı — beş rota (`/eval/editor-action-batch` dahil) üretildi |
| `npx tsc --noEmit` | çıkış kodu 0, hiç çıktı yok |
| `npm test` | **278 dosya, 4577 test, hepsi geçti** (41.7 s) |
| `npm run lint` | `eslint .` sessiz |
| `git diff --check` | temiz |
| `git status --porcelain` | commit'ten sonra boş |

Satır bütçeleri (hiçbiri aşılmadı):

| Dosya | Satır | Sınır |
|---|---|---|
| `Workspace.tsx` | 376 | 379 |
| `ArrangementCanvas.tsx` | 470 | 470 |
| `TabCanvas.tsx` | 456 | 480 |

Değişen 28 dosya (+2321 / −653), 12 yeni `src/` dosyası, `eval/editor-2vb1/`
altında beş koşucu ve altı PNG ile birlikte beş JSON manifesti.

## 24 · Hâlâ fiziksel kanıtı olmayanlar

Bunları "geçti" saymıyorum. Tarayıcı emülasyonu bir cihaz değildir.

1. **Sesin kendisi.** Hiçbir sesli kanıt toplanmadı. Slide, vibrato,
   hammer-on ve pull-off için elimizde yalnızca zamanlayıcı ve plan kanıtı
   var (madde 11).
2. **Duraklat/devam etmenin duyulan sürekliliği.** Tick'in kaymadığını
   ölçtük; devam eden notanın yeniden vurulmuş gibi duyulup duyulmadığını
   ölçmedik.
3. **Gerçek parmak.** Uzun bas, sürükle ve çekmece hareketleri Playwright
   dokunma emülasyonuyla yapıldı; gerçek Android dokunmatik davranışı
   (ölçek, gecikme, kaydırma çakışması) doğrulanmadı.
4. **Kurucunun "Proje değişmedi: HAYIR" gözlemi.** `26bd505` üzerinde
   yeniden üretilemedi (madde 3). Hangisinin doğru olduğu açık kalıyor.
5. **K-61, K-62, K-63.** Bu üç karar bu turda **kendi kendine onaylanmadı**;
   spec'te K-64 satırı bunu açıkça kaydeder. Onay Haktan'a aittir.

---

*Manifestler: `artifacts/BASELINE.json`, `GEOMETRY.json`, `ACCEPTANCE.json`,
`PROBES.json`, `RUNS.json` · koşucular: `serve.sh`, `geometry.mjs`,
`acceptance.mjs`, `probes.sh`, `runs.sh` (bkz. `README.md`).*
