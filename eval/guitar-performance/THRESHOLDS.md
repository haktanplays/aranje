# 2T-C §10 — kabul eşikleri

**Bu belge yamadan önce yazıldı.** Ölçümler `BASELINE.json` dosyasındaki
`6ded910` render'ından; eşikler o sayılara *bakarak* değil, bir dinleyicinin
neyi ayırt edebildiğine bakarak seçildi. Yamadan sonra sonuca göre eşik
oynatılmadı; hangi eşiğin geçtiği ve hangisinin geçemediği aşağıda olduğu
gibi durur.

## Baseline — `6ded910`, beş figür, tek değişken

Beşi de aynı tempo (90 BPM), aynı velocity (100), aynı akort, aynı preset
(`electric_guitar/high_gain`), aynı tel (3. tel) ve aynı iki perde (7 ve 9).
Değişen tek şey ikinci notanın nasıl çalındığı.

| figür | onset | geçişte seviye | geçişte parlaklık | fiziksel kaynak | kalkış |
| --- | --- | --- | --- | --- | --- |
| mızrap (çıkan) | 2 | +4.09 dB | 2832 Hz | 2 | −34 ms |
| mızrap (inen) | 2 | +1.62 dB | 2547 Hz | 2 | −26 ms |
| hammer-on | 1 | −0.43 dB | 2509 Hz | **1** | −26 ms |
| pull-off | 1 | −2.15 dB | 3061 Hz | 2 | −26 ms |
| slide | 1 | +0.33 dB | 3418 Hz | 1 | **−114 ms** |

"Geçişte seviye", yazılı anın 50 ms öncesi ile 50 ms sonrasının RMS farkı.
"Parlaklık", yazılı andan sonraki 30 ms'nin spektral ağırlık merkezi.
"Kalkış", perdenin kaynak notadan ayrıldığı an — negatif, yani vuruştan önce.

## Eşikler ve gerekçeleri

**T1 — mızrap yeniden vurur, legato vurmaz.** Mızraplı figürlerde 2 onset,
legato figürlerde 1 onset. *Gerekçe:* bu bir tercih değil, tanım. Hammer-on
tel hiç durmadan devam ederken parmağın perdeyi değiştirmesidir; ikinci bir
atak duyuluyorsa çalınan şey hammer-on değildir. Baseline geçiyor; bu eşik
gerilemeyi önlemek için var.

**T2 — hammer-on ile pull-off seviyede ayrışır: fark ≥ 2 dB.** *Gerekçe:*
karşılaştırmalı dinlemede karmaşık bir seste fark edilebilen en küçük
seviye değişimi yaklaşık 1 dB'dir. Telefon hoparlöründe ve gürültülü bir
odada bunun iki katını istiyoruz, yani 2 dB. Sayı, yamanın ulaşabildiği
yerden değil, işitmenin sınırından geliyor. **Baseline: 1.72 dB — kalıyor.**

**T3 — hammer-on'ın da bir iniş anı olur: fiziksel kaynak ≥ 2.** *Gerekçe:*
gerçek bir hammer-on'da parmak tele vurur; bu, perdenin kaymasından ayrı,
duyulabilir bir gürültüdür. Pull-off'ta bu ses zaten var (2P/2F'in
`pullOff.auxiliary` tıkırtısı), hammer-on'da hiç yok — hammer-on bugün
"kendi kendine değişen bir perde"den ibaret. **Baseline: 1 — kalıyor.**

**T4 — hiçbir figür master'ın izin verdiğinden yüksek çıkmaz.** Tepe
≤ −1 dBFS ve kırpılan örnek sayısı 0. *Gerekçe:* zincirin kendi tavanı
(`MASTER_CEILING_DB = -1`). Baseline geçiyor (−16.5 dBFS, 0 örnek).

**T5 — yazılan perde çalınan perde olarak kalır: |sapma| ≤ 25 sent.**
*Gerekçe:* 25 sent, eğitimli bir kulağın akortsuzluk demeye başladığı
eşiğin altıdır ve yarım sesin dörtte biridir. Baseline geçiyor (en kötü
10.2 sent).

**T6 — slide yol alır, diğerleri almaz.** Slide'ın kalkışı ≤ −80 ms;
hammer-on ve pull-off'unki ≥ −40 ms. *Gerekçe:* 2F.2'nin kararı, slide'ın
önceki notanın kuyruğunda yol alıp hedefe tam yazıldığı anda varmasıdır. El
yola çıkmıyorsa çalınan şey slide değil, ani bir perde sıçramasıdır.
Baseline geçiyor (−114 ms / −26 ms).

**T7 — render bittiğinde çalan hiçbir ses kalmaz.** `activeAfterDispose = 0`.
*Gerekçe:* sızan bir voice, bir sonraki render'ı da kirletir; ölçümün
kendisine güvenilmesi buna bağlı. Baseline geçiyor.

**T8 — legato çifti hâlâ tek sestir: mantıksal voice = 1.** *Gerekçe:*
parmağın iniş gürültüsü bir *nota* değildir. T3'ün istediği ikinci fiziksel
kaynak, ikinci bir nota olarak sayılırsa hammer-on yeniden vurulmuş olur ve
T1 anlamını yitirir. Baseline geçiyor.

**T9 — hammer-on ile pull-off parlaklıkta ayrışır: fark ≥ %15.**
*Gerekçe:* iki hareket iki farklı gürültüdür — biri parmağın teli perdeye
çarpması, öbürü telin yandan koparılması — ve aralarındaki fark ağırlıklı
olarak tınıdadır. %15, spektral ağırlık merkezinde bir dinleyicinin
"öbürü daha parlak" diyebildiği bilinen en küçük fark aralığının (%10–20)
üst ucudur. **Baseline: %22 — geçiyor.**

## Yamadan önce durum

Dokuz eşiğin yedisi baseline'da geçiyor. Kalan ikisi aynı eksiğin iki
yüzü: **hammer-on'da parmağın indiği an diye bir şey yok.** Yama tam olarak
bunu ekler ve başka hiçbir şeye dokunmaz — tek değişkeni korumak, ölçümün
bir şey söyleyebilmesinin şartı.

## Yama

Tek bir şey değişti ve iki sayıyla anlatılır: **parmağın indiği an**.

- Hammer-on artık kendi gürültüsünü çıkarıyor. Pull-off'un 2F.1'den beri
  sahip olduğu kısa tıkırtının aynısı, ama başka bir el hareketinin sesi
  olduğu için başka sayılarla: daha kısık (`gain` 0.11 / 0.16) ve daha mat
  (`filterHz` 2000 / 4500). Parmak ucunun teli perdeye bastırması, tırnağın
  teli yandan koparmasından böyle ayrılır.
- İki hareketin telin enerjisine yaptığı şey artık zıt yönde: hammer-on
  enerji *koyar* (`levelAfter` 0.88 → 0.92), pull-off enerji *alır*
  (0.78 → 0.72). Eski çift arasında 1 dB vardı; enstrümanda bu iki hareket
  bundan daha uzaktır.

Başka hiçbir şeye dokunulmadı: mızrap yolu, slide, perde eğrileri, master
zinciri, hiçbiri. Tek değişkenli karşılaştırmanın anlamı buna bağlı.

## Sonuç — `node eval/guitar-performance/check.mjs`

| eşik | baseline | yamadan sonra |
| --- | --- | --- |
| T1 mızrap 2 onset, legato 1 | geçti | geçti |
| T2 hammer/pull seviye farkı ≥ 2 dB | **1.72 dB — kaldı** | **2.31 dB — geçti** |
| T3 hammer-on'ın iniş anı var | **1 kaynak — kaldı** | **2 kaynak — geçti** |
| T4 tepe ≤ −1 dBFS, kırpma yok | geçti | geçti |
| T5 perde ±25 sent | geçti | geçti |
| T6 slide yola önceden çıkar | geçti | geçti |
| T7 render sonrası ses kalmaz | geçti | geçti |
| T8 legato çifti tek ses | geçti | geçti |
| T9 hammer/pull parlaklık ≥ %15 | geçti (%22.0) | geçti (%21.8) |

Dokuz eşiğin dokuzu geçiyor; baseline'da kalan iki eşik yamanın düzelttiği
iki eşik. Hiçbir eşik yamayla bozulmadı.

## Bunun söylemediği şey

Bu ölçümler **sesin iyi olduğunu söylemez**. Söyledikleri şu: mızrap ile
legato ölçülebilir biçimde farklı, hammer-on ile pull-off ölçülebilir
biçimde farklı, slide ikisinden de farklı, ve hiçbiri kırpmıyor. "Organik
oldu" ya da "gitar gibi" cümlesini kuracak olan kulak; WAV'lar
`wav/` altında, baseline'ları `wav/baseline/` altında, aynı isimlerle.
Fiziksel dinleme yapılmadan bu cümle bu belgeye yazılmayacak.
