# S-03 — İzole model bake-off

İki ayrı modelin, aynı istekten, aynı sözleşme altında müzik yazıp
yazamadığını ölçer. Model adları bu klasörde yalnız `provenance.json` ve
`SEALED_MAPPING.json` içinde geçer; kullanıcıya sunulan karşılaştırma
raporu (`report.ts`) hiçbirini okumaz.

## Koşular

- `artifacts/run-1-failed/` — ilk koşu. İki aday da blueprint aşamasında
  elendi; düzeltme bütçesinin çoğu prompt eksikliklerine gitti.
  `run-1-failed/BLOCKER.md` ne olduğunu tam olarak anlatır.
- `artifacts/candidate-a/`, `artifacts/candidate-b/` — ikinci koşu, aşağıdaki
  düzeltmelerden sonra ve **iki aday da sıfırdan**.

## Birinci koşudan sonra düzeltilenler (yalnız eval, production'a dokunulmadı)

1. `tonalCenter`'ın Song tonalite kalıbı (`"D minor"`) prompt'ta açıkça
   yazıldı; örnekleriyle birlikte geçerli ve geçersiz biçim gösterildi.
2. Karakter sınırları prompt metnine düzyazı olarak eklendi — şemadan
   türetilerek, böylece ikisi birbirinden ayrılamaz.
3. Materializer hataları modelin gördüğü alan adına çevriliyor: `key` yerine
   `tonalCenter`. Modele göremediği bir alanı göstermek düzeltme değildir.
4. `capture-response.mjs` artık `--expect-replies` ile yanıt gelmeden
   yakalamayı reddediyor. Birinci koşuda bu yarış bir adayı yanlışlıkla
   başarısız göstermişti.

## Her deneme ayrı bir invocation

Bir cevap reddedildiğinde düzeltme, o adayın modeline **yeni ve izole bir
invocation** olarak gönderilir; önceki ajan devam ettirilmez.

Bunun nedeni sadakattir, kolaylık değil: production'da tur durumsuzdur.
`payloadFor` her denemede system + şema + kullanıcı mesajını baştan kurar ve
düzeltme metnini sonuna ekler; modelin kendi önceki cevabı payload'a
konmaz. Ajanı devam ettirmek modele production'da göremeyeceği bir şeyi
(kendi reddedilen çıktısını) göstermiş olurdu.

Kural iki aday için de aynıdır ve her denemenin `toolUses: 0` ile kendi
runtime kaydı vardır.

## Dosyalar

| Dosya | Ne yapar |
|---|---|
| `request.ts` | Kullanıcının iki turluk isteği, aynen |
| `blueprint-prompt.ts` | Plan prompt'u; şema production'dan türetilir |
| `harness.ts` | Arrange turları için production prompt/parse/apply/validator yolu |
| `run.ts` | Sürücü: payload yazar, cevabı bekler, zinciri çalıştırır |
| `capture-response.mjs` | Modelin cevabını transcript'ten aynen alır |
| `inspect-invocation.mjs` | Bir invocation'ın runtime gerçekleri |
| `build-provenance.mjs` | Provenance'ı diskteki runtime kayıtlarından kurar |
| `verify.ts` | Koşunun kendi iddialarını artefaktlara karşı sınar |
| `analysis.ts` | Phrase düzeyi ölçümler; puan üretmez |
| `report.ts` | Kör karşılaştırma tablosu; mührü hiç okumaz |
| `render-entry.ts` | Offline render; kesit adlarında model adı geçmez |
