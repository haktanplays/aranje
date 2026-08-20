# S-03 bake-off — kör A/B paketi üretilemedi

**Durum: bake-off tamamlanmadı ve kör dinleme paketi yok.** Bir aday
blueprint aşamasını geçti, diğeri izin verilen iki düzeltme turu içinde
geçemedi. Tek adayla kör A/B karşılaştırması yapılamaz.

Üçüncü deneme verilmedi, hiçbir blueprint elle düzeltilmedi ve coding-agent
simulation'a geri düşülmedi.

---

## Teknik kapı: geçti

| Kontrol | Sonuç |
|---|---|
| İki gerçekten ayrı model çağrıldı | **evet** |
| Exact model kimliği runtime metadata'dan doğrulandı | **evet** — her invocation'ın kendi transcript kaydından |
| Coding agent blueprint/nota yazdı mı | **hayır** |
| Model çıktısı elle düzeltildi mi | **hayır** |
| Invocation'lar tool kullandı mı | **hayır** — 6/6 invocation'da 0 tool use |
| Context inheritance | **yok** — attempt N'de tam N+1 mesaj, N+1 yanıt |
| Aynı raw input, aynı şema, aynı prompt, aynı correction limiti | **evet** |
| Aday eşlemesi mühürlü | **evet** |
| Production davranışı değişti mi | **hayır** |

Model kimliği modele sorularak değil, çalışma zamanının kendi kaydından
okundu. Bir modelin kendisi hakkındaki beyanı iddiadır; runtime'ın hangi
modelin o turu servis ettiğine dair kaydı delildir.

---

## Ne oldu

Her aday için üç deneme (ilk + iki düzeltme):

### Candidate A — blueprint KABUL (attempt 2)

| Deneme | Sonuç | Neden |
|---|---|---|
| 0 | RED — şema | 5 alan karakter sınırını aştı |
| 1 | RED — materialise | `path ["key"], pattern /^[A-G](#\|b)? (minor\|major)$/` |
| 2 | **KABUL** | 57.78 s (hedef 60±6, tolerans içinde) |

Bütün düzeltme bütçesini kullandı ama geçti. Arrange turları
**başlatılmadı** — aşağıdaki gerekçeyle.

### Candidate B — blueprint RED (bütçe tükendi)

| Deneme | Sonuç | Neden |
|---|---|---|
| 0 | RED — şema | 4 alan karakter sınırını aştı |
| 1 | RED — grid planı | `break: bar 3: 1/12 bölümün 1/16 gridinden daha ince değil` |
| 2 | RED — şema | `sections.1.gridAccents.0.purpose` **202 karakter**, sınır 200 |

Son denemede grid hatasını düzeltti (12 → 24) ve **iki karakterle** elendi.

---

## Kök neden: bütçenin çoğu harness'ın eksiklerine gitti

Bu koşu, müzikal yeteneği ölçmekten çok blueprint prompt'unun
eksikliklerini ölçtü. Dört bulgu, biri benim kendi hatam:

### 1. Düzeltme mesajı, modelin göremediği bir alanı gösteriyor

Materializer `blueprint.tonalCenter` değerini `Song.key` alanına kopyalar.
Başarısız olduğunda hata **Song** şemasının yolunu bildirir:
`path: ["key"]`. Modele verilen sözleşmede kökte `key` diye bir alan
**yoktur**; `tonalCenter` vardır. A bunu ikinci düzeltmesinde çözebildi,
ama bir düzeltme turunu buna harcadı.

### 2. `tonalCenter`'ın Song key formatında olması gerektiği yazılı değil

Şema `z.string().min(1).max(40)`; doc yorumu `"D minor"` diyor ama şema
zorlamıyor, prompt söylemiyor. İki aday da kendi doğal biçimini yazdı
("C# minor / frigyen renkli merkez", "E minör, düşük akortlu karanlık
merkez") ve ikisi de aynı duvara çarpardı.

### 3. Alan uzunluk sınırları yalnız JSON Schema içinde görünüyor

İki aday da attempt 0'ı **yalnızca** `maxLength` aşımlarıyla kaybetti ve
B nihayetinde 2 karakterle elendi. Sınırlar prompt metninde düzyazı olarak
yazılmadı.

### 4. Benim hatam: capture yarışı

Düzeltme turlarını beklerken yanlış sinyali kullandım — gönderilen mesaj
sayısını, gelen yanıt sayısını değil. Bu, A'nın 2. denemesinde bir önceki
yanıtı yeni deneme adı altında kaydetti ve A'yı **yanlışlıkla başarısız**
gösterdi. Fark edildi, `capture-response.mjs` artık `--expect-replies` ile
yanıt gelmeden yakalamayı reddediyor, A yeniden yakalandı ve gerçek sonucu
(kabul) ortaya çıktı. B'nin kaydı yeniden doğrulandı: yarış yok, elenme
gerçek.

Bu bulgu kaydediliyor çünkü koşunun güvenilirliğini etkiler: bir
başarısızlık raporu, harness'ın kendi hatası yüzünden üretilmişti.

### 5. Gerçek bir model hatası: B, 12'yi 16'dan ince sandı

Harness'ın değil modelin hatası ve tam olarak Faz 2H-A'nın öngördüğü
karışıklık: `12` (1/8 üçleme) `16`'dan **daha kabadır**. Prompt bunu açıkça
yazıyordu ("Ucleme grid'lerinde bir vurus 3 slottur… Bunlar 'biraz daha sik
duz grid' degildir") ve model yine de yanlış anladı. Kaydedilmeye değer tek
saf sözleşme-anlama bulgusu budur.

---

## Arrange turları neden başlatılmadı

Candidate A tek başına ilerletilebilirdi. Başlatılmadı, çünkü:

- Bu checkpoint'in teslimi **kör A/B dinleme paketidir**; tek adayla
  üretilemez.
- Karşılaştırma zaten mümkün değilken A'nın ~20 arrange turunu çalıştırmak,
  kullanıcının bütçesini karşılığı olmayan bir çıktıya harcardı.
- Harness'ta koşu ortasında gerçek bir hata bulundu (bulgu 4). Düzeltilmiş
  harness ile **iki adayı da sıfırdan** koşmak, yarısı eski yarısı yeni bir
  koşudan daha dürüst bir karşılaştırma verir.

## Adil bir tekrar neye benzer

Hepsi eval-only, production'a dokunmadan:

1. Blueprint prompt'una `tonalCenter`'ın Song key formatını yazmak.
2. Alan uzunluk sınırlarını prompt metnine düzyazı olarak eklemek.
3. Materializer hatalarını modelin gördüğü alan adına çevirmek — `key`
   yerine `tonalCenter`.
4. (Yapıldı) Capture yarışını kapatmak.

Tekrar **her iki aday için sıfırdan** çalıştırılmalıdır; tek bir adaya
düzeltilmiş prompt vermek karşılaştırmayı geçersiz kılar.

Bu değişiklikler prompt sözleşmesini değiştirdiği için kullanıcı onayı
olmadan yapılmadı.

---

## Mühürlü kalanlar

`SEALED_MAPPING.json` yerinde ve açılmadı. Hangi adayın hangi model olduğu
bu raporda ve hiçbir kullanıcıya açık artefaktta geçmiyor.
