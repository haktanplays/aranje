# Resmî kaynak denetimi — 2P-A §7

**Erişim tarihi:** 2026-08-24
**Sonuç: kaynakların hiçbiri okunamadı.** Bu belge okunanları değil,
okunamayanları kaydeder.

## Neden

Bu çalışma, ağ çıkışı bir egress proxy'sinin arkasında olan bir ortamda
yürütüldü. §7'de verilen beş resmî URL'nin tamamı için proxy CONNECT
isteğine `403` döndü; hiçbir sayfa alınamadı, hiçbir metin okunmadı.

Ham kanıt, her host için ayrı ayrı denendi:

```
www.guitar-pro.com      -> curl: (56) CONNECT tunnel failed, response 403
support.guitar-pro.com  -> curl: (56) CONNECT tunnel failed, response 403
www.songsterr.com       -> curl: (56) CONNECT tunnel failed, response 403
guitar-pro.com          -> curl: (56) CONNECT tunnel failed, response 403
songsterr.com           -> curl: (56) CONNECT tunnel failed, response 403
```

Proxy'nin kendi durum uç noktası aynı reddi kaydediyor:

```json
{ "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "support.guitar-pro.com:443" }
```

## Kaynak tablosu

| Kaynak | URL | Erişildi mi? | Gözlemlenen davranış | Neyi kanıtlıyor | Neyi kanıtlamıyor | Audio referansı |
| --- | --- | --- | --- | --- | --- | --- |
| Songsterr yardım | `https://www.songsterr.com/help` | Hayır (403) | — | Hiçbir şey | Hiçbir şey | Alınmadı |
| Guitar Pro bend/vibrato | `https://www.guitar-pro.com/blog/p/12520-bends-and-vibrato-in-guitar-pro-6` | Hayır (403) | — | Hiçbir şey | Hiçbir şey | Alınmadı |
| Guitar Pro slide türleri | `https://www.guitar-pro.com/blog/p/31896-14-guitar-pro-7-6-tips-you-need-to-know` | Hayır (403) | — | Hiçbir şey | Hiçbir şey | Alınmadı |
| Guitar Pro mobil gesture | `https://support.guitar-pro.com/hc/en-us/articles/207435295-GP-Mobile-iOS-Handling-effects-with-the-guitar-fretboard-iPad` | Hayır (403) | — | Hiçbir şey | Hiçbir şey | Alınmadı |
| Guitar Pro kısayol listesi | `https://support.guitar-pro.com/hc/en-us/articles/360001646978-GP8-List-of-keyboard-shortcuts` | Hayır (403) | — | Hiçbir şey | Hiçbir şey | Alınmadı |

## Bunun sonuçları

- `referenceAudioAvailable: false`. Rakip uygulamalardan **hiçbir** ses
  ölçümü alınmadı.
- `sourceTextAvailable: false`. Rakip uygulamaların **yazılı** semantiği de
  okunmadı. Bu, §7'nin öngördüğü "yalnız semantic evidence var" durumundan
  daha zayıf bir durumdur: elde semantic evidence de yok.
- Bu çalışmanın hiçbir yerinde bir davranış, eğri, sabit veya varsayılan
  değer Guitar Pro'ya, Songsterr'a veya başka bir ürüne atfedilmemiştir.
  "Guitar Pro'nun kamuya açık semantiğinden türetilen aday" ifadesi de
  kullanılamaz, çünkü o semantik okunmadı.
- Bellekten hatırlanan bir davranış kaynak yerine geçmez ve bu belgeye
  yazılmadı.

## Peki adaylar nereden geliyor

İki yerden, ve ikisi de rakip değil:

1. **Bu checkpoint'in kendi talimatı.** §10 ve §11 hangi fixture'ların
   üretileceğini adlarıyla sayıyor: bend / bend-release / prebend /
   prebend-release, legato slide / shift slide / slide-in / slide-out.
   Aday isimleri oradan geliyor.
2. **Gitar notasyonunun genel sözlüğü.** Bu terimler tek bir ürüne ait
   değil; onlarca yayıncının tablature konvansiyonunda ortak. Bu belge
   onları hiçbir ürüne atfetmiyor ve hiçbirine sayısal bir sabit
   yüklemiyor.

Her adayın *sayısal* davranışı — süre, cent, eğri, seviye — Aranjé'nin
kendi `expressionPresets` tablosundan türetildi ve `MEASUREMENTS.json`'da
render edilmiş sesten ölçüldü. Kaynağı bu repodur.

## Hangi metrikler neyle karşılaştırıldı — §13

Rakip ölçümü olmadığı için `MEASUREMENTS.json`'daki **her** sayı yalnızca
Aranjé adayları arasında karşılaştırıldı:

| Metrik | Neyle karşılaştırıldı |
| --- | --- |
| Nota sonundaki cent | Bugünkü Aranjé bend'i ↔ Aranjé aday bend'i |
| Hedefe varış zamanı | Aranjé adayları arasında |
| Hedef atak oranı | Aranjé legato ↔ Aranjé shift ↔ Aranjé normal yeniden vuruş |
| Gürültü bandı enerjisi | Aranjé tek-sample ↔ Aranjé fret-noise adayları |
| Mantıksal / fiziksel ses sayısı | Aranjé adayları arasında |

Hiçbir satırda dışarıdan bir referans yok, ve olmadığı için de "şuna daha
yakın" türünden bir yargı üretilmedi.

## Bu kapı açık kalıyor

Rakip davranışının okunması ve, mümkünse, kamuya açık arayüzden
tekrarlanabilir bir synth ölçümü alınması hâlâ yapılmamış bir iştir.
Ağ politikası buna izin veren bir ortamda tekrar denenmelidir. O ölçüm
alınmadan "reverse engineered" ifadesi kullanılamaz.
