# 2Q-B §1 — Neden on kabul harness'ı yanlış cevap veriyordu

Bu belge, eski kabul paketlerinin onarımını kaydeder. Kural şuydu: **senaryo
silerek yeşile dönme, beklentiyi gevşetme, timeout büyütme.** Her onarım ya
ürünün bugünkü sözleşmesine (K-44, K-51, K-52, K-54, K-55) bağlanmıştır ya da
gerçek bir ürün kusurunu açığa çıkarmıştır.

## Ortak kök neden — ölçüm aleti eskimişti

K-52'ye kadar tek şarkı tek anahtardaydı (`aranje.song`), bu yüzden "uygulama
yazdı mı?" ile "şarkı değişti mi?" aynı soruydu. Yerel proje kütüphanesinden
sonra üç ayrı anahtar sınıfı var:

```
aranje.projects              katalog
aranje.project.<projectId>   proje kaydı (şarkı burada)
aranje.project-pending       yarım kalmış işlem işareti
```

Dokuz paket hâlâ eski soruyu soruyordu. Sonuç: **başarılı her düzenleme için
`writes=0`**, okunan şarkı için `undefined`. Ürün bozuk değildi; alet eskiydi.
Bu, 2Q-A kapanışında ayrı bir worktree'de 2Q-A öncesi build derlenip aynı
süitler çalıştırılarak kanıtlanmıştı (skorlar bire bir aynı,
`eval/multitrack/artifacts/REGRESSION.json`).

Çözüm tek yerde: `eval/shared/project-storage.mjs`. Her fiziksel işlem
**hangi anahtarın kımıldadığına** göre sınıflanır — `catalog`,
`active_project`, `other_project`, `pending_delete`, `legacy_song`,
`quarantine`, `probe`, `unknown` — böylece bir kayıt ile başka bir projeye
sızma asla aynı sayaçta toplanamaz. Yükleyici kopyalanmadı:
`decideRecordShape` production karar **tablosunu** yeniden üretir ve
`eval/shared/project-storage.test.ts` ikisini aynı fixture'lar üzerinde
karşılaştırır — sapma, rapordaki sürpriz değil, kırmızı testtir.

## Paket paket

| Paket | Önce | Sonra | Neden yanlıştı |
|---|---|---|---|
| lifecycle | 7/34 | 34/34 | Eski anahtar + K-52/K-54/K-55 ile çelişen dört beklenti + bir gerçek kusur |
| storage | 22/50 | 50/50 | Eski anahtar + migration'ın load anında olması + **beş sessiz kurtarma (gerçek kusur)** |
| history | 26/36 | 36/36 | Eski anahtar |
| mixer | 28/35 | 35/35 | Eski anahtar |
| tab | 39/47 | 47/47 | Eski anahtar |
| bar-ops | 24/29 | 29/29 | Eski anahtar |
| export | 34/36 | 36/36 | Eski anahtar |
| arrangement | 62/66 | 66/66 | Eski anahtar + K-44 öncesi undo etiketi |
| project-file | 22/26 | 26/26 | Eski anahtar + yedeğin "hiçbir şey kımıldamadı" karşılaştırması |
| selection-ui | **askıda (0 kontrol)** | 138/138 | Aşağıda |

## selection-ui askısının kök nedeni

İki ayrı kusur, üst üste:

1. **Yanlış bekleme.** `openApp` gezinmeden sonra `[data-tab-content]`
   bekliyordu. Uygulama 2J'den beri **Düzen** ile açılıyor; Tab'a geçilmediği
   için beklenen düğüm hiç gelmiyordu. Aynı hata `reseed`'de de vardı:
   her reload Düzen'e dönüyor.
2. **Açık handle.** `openApp` çağrısı `run()`'ın kendi `try/finally`'sinin
   **dışındaydı**, bu yüzden oradaki bir throw `browser.close()`'a hiç
   ulaşmıyordu. Chromium ayakta kalıyor, node'un event loop'u kapanmıyordu:
   süreç kendiliğinden bitmiyordu.

Timeout büyütmek bunların hiçbirini çözmezdi; ikisi de düzeltildi ve süit
artık `exit=0` ile kendiliğinden kapanıyor.

Askı kalkınca 48 yerine 138 kontrol çalıştı ve daha önce **hiç
çalıştırılmamış** dört varsayım açığa çıktı:

- `getByRole("tab")` **görünüm** anahtarını (Düzen · Çoklu · Tab) eşliyordu,
  track'i değil. 2Q-A üçüncü görünümü ekleyene kadar `nth(1)` tesadüfen
  "Tab"dı ve görünüm yerinde kalıyordu; sonra "Çoklu" oldu ve senaryo
  track değiştirmek yerine yüzey değiştirdi — üstelik seçim yüzey değiştiği
  için temizlendiğinden **yanlış sebeple geçiyordu**. Track artık track
  kontrolünden değiştiriliyor (`[data-track-control]` → `[data-track-option]`).
- `data-cell` adresi `slot:string`'dir, `bar:slot` değil. Dört senaryo altı
  telli bir gitarın **7. telini** istiyordu ve hiçbir şey bulamıyordu.
- "Zincire dokunmak seçimi büyütür" beklentisi **K-51'in bilerek kaldırdığı**
  davranıştır: uzun basış artık tek onset grubu alır, zincir kararı açık
  `chainPolicy` ile verilir. Senaryo bugünkü sözleşmeye bağlandı.
- Suit'in fixture'ında hiç artikülasyon yok, yani zincir senaryosunun
  dayanağı da yoktu. Dört paketin paylaştığı fixture'ı değiştirmek yerine
  zincir **yalnız o senaryo için** tohumlanıyor.

## Bulunan iki gerçek ürün kusuru

Her ikisi de önce kırmızıya bağlandı, sonra düzeltildi.

1. **Temizlenen track yazılamaz hâle geliyordu.**
   `replace_track_setup_and_clear_content` track'in anahtarını her bardan
   siliyordu. Eksik anahtar hem "burada sessiz" hem "bu barda yazılı değil"
   demek olduğu için, gitarını davula çeviren okur hiçbir hücreye nota
   yazamayan bir track'le kalıyordu — K-55'in kapattığı A kusuru, ikinci
   kapıdan. Artık içerik siliniyor ve **yeni enstrümanın şeklinde açık boş
   şerit** bırakılıyor.

2. **Kurtarma haberi okura ulaşmıyordu.**
   K-45 iki yuvalı zarfla bir söz vermişti: bozuk bir kayıt son düzenlemeye
   mal olur, şarkıya değil, ve banner bunu söyler. K-52 zarfın etrafına
   projeyi koydu ve haber yolda kayboldu: `asLoadResult` settle'ın bütün
   notice'larını atıp yerine "bu cihaz kaydedemiyor" yazıyordu. Sonuç: son
   kaydı okunamayan cihaz **bir önceki sürümü sessizce** açıyor ve okur eski
   bir şarkı üzerinde kendi şarkısı sanarak çalışmaya devam ediyordu; daha
   yeni bir sürümün dosyası ise cihazın suçu gibi gösteriliyordu. Settle artık
   dört cümleden hangisinin doğru olduğunu taşıyor, session yalnız aktarıyor.
