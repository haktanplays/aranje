# 2L-A — Taşınabilir proje yedeği: bulgular

## Sözleşme ve kararlar

- Dosya: `{format: "aranje.project", version: 1, song}`, strict dış kabuk,
  `song` mevcut `songSchema`'dan. Storage zarfı, history, pano, ayarlar,
  fingerprint dosyaya girmez (AST tabanlı boundary testleri + ESLint bunu
  import-graph seviyesinde tutar).
- Serileştirme kanonik: her seviyede sıralı anahtar + compact JSON + tek `\n`.
  Compact bilinçli bir tercihtir: en ağır desteklenen şarkı compact ≈781 KB
  iken girintili hâli 2 MiB import sınırına yaklaşırdı — format kendi
  dosyasını açamaz hâle gelirdi.
- Import sırası: byte sınırı (okumadan) → BOM → JSON → saldırı anahtarları
  (`__proto__`/`constructor`/`prototype`, her derinlikte) → ham legacy Song
  reddi → gevşek etiketle sürüm (gelecek sürüm fail-closed) → strict kabuk →
  strict Song → merkezi validator zinciri.
- `import_no_change` apply anında yakalanır: aynı müzik hiçbir yazma ve
  history adımı üretmez ve bunu kullanıcıya söyler.

## Ölçülen worst-case'in "desteklenen"e çevrilmesi

2K-B'nin boyut worst-case'i (`worstCaseSong`) yalnız şema-geçerliydi; pozisyon
ile pitch tutarsızdı ve `fretboardIntegrity`'den geçmiyordu. Export kapısı onu
haklı olarak reddetti. Performans için `worstCasePlayableSong` eklendi
(`eval/shared/worst-case-song.ts`): aynı yoğunluk, E minör diyatonik ve
pozisyon-pitch tutarlı — bütün validator zinciri warning'lerle geçer. Boyut
raporları (BYTES.json) eski üreticiyle değişmeden kaldı.

## Performans özeti (masaüstü; PERFORMANCE.json)

- Worst-case uçtan uca import kararı ≈120 ms median (Node) — baskın maliyet
  validator zinciri (≈102 ms). Demo şarkıda uçtan uca ≈2,2 ms.
- Worst-case zarf `setItem` masaüstü Chromium 141'de ≈10-18 ms median,
  ≈23-34 ms max. Fiziksel telefon ölçümü değildir; release gate'te açık.
- 51 snapshot history: JSON-eşdeğer üst sınır ≈38,9 MiB; tek-bar
  düzenlemelerde gerçekte tutulan ≈0,07 MiB (Node, taban paylaşılan) /
  ≈1,1 MiB (Chromium, taban kopyası dahil). İki bölge farklı şeyi kapsar ve
  notlarında bunu söyler.

## Ölçüm altyapısı bulguları (dürüstlük kayıtları)

1. **`performance.memory.usedJSHeapSize` ölü bir gösterge.** Chromium 141'de
   `--enable-precise-memory-info` ile bile 8 MB tutulan tahsise delta 0
   raporladı. Heap ölçümü CDP `Runtime.getHeapUsage` +
   `HeapProfiler.collectGarbage` ile yapıldı; sinyal 10 kopya üzerinden
   ortalanarak çözünürlük tabanının üstüne çıkarıldı.
2. **Headless Chromium, ASCII olmayan blob indirme adını "download"a
   düşürüyor.** Uygulamanın istediği ad (`anchor.download`) enstrümanla
   doğrulanır; tarayıcının verdiği ad ölçüm olarak kaydedilir, iddia edilmez.
   Gerçek cihaz tarayıcılarında Unicode adın korunması beklenir ama burada
   kanıtlanmadı.
3. **İlk kabul koşusu bir kapsama boşluğu gösterdi:** yedek indirme "hiçbir
   şey yazmaz" iddiası hiçbir senaryoda ölçülmüyordu (yazma sayacı yedekten
   *sonra* okunuyordu). Senaryo 01 güçlendirildi: yedek sonrası yazma sayısı
   0, ham anahtar byte-eş, undo hâlâ disabled. 4 ve 12 numaralı browser
   probe'ları bu satırları kırmızıya düşürerek doğrular.

## Kabul sonuçları

- Saf süit: `src/lib/project` 45 test (sözleşme 31 + apply 8'e denk gelen
  gruplar + AST boundary/export yüzeyi) — yeşil; toplam süit 1841+ yeşil.
- Tarayıcı: 25 senaryo × 2 viewport = 52 kayıt, 52/52 PASS
  (`artifacts/RESULTS.json`).
- Vacuity: 15 unit probe (probes.sh) + 7 browser probe (browser-probes.sh),
  22/22 kırmızı.
