# Faz 2J-P — Görsel hiyerarşi ve yoğunluk: ölçümler

2J teknik olarak geçti, görsel olarak geçmedi. Bu checkpoint arrangement ve tab
yüzeylerinin **kendisini değiştirmedi**; aradaki kromu geri aldı.

## Önce / sonra, aynı fixture, aynı viewport

| | 390×844 | | 320×700 | |
|---|---|---|---|---|
| | önce | sonra | önce | sonra |
| Header | 61 | **57** | 61 | **57** |
| Görünüm şeridi | 57 | **47** | 57 | **47** |
| Section navigasyonu (Tab) | 89 | **49** | 89 | **49** |
| **Düzen çalışma alanı** | 443 | **634** | 274 | **490** |
| **Tab çalışma alanı** | 256 | **541** | **40** | **397** |
| Action row | — | 49 | — | 49 |
| Transport | 138 | **57** | 162 | **57** |
| Sticky track sütunu | 96 | 108 | 96 | 108 |
| Aktif track kontrolü | — | 44 | — | 44 |
| Görünen lane sayısı | 8 | 8 | 5 | **8** |
| Ekranda "Sessiz" kelimesi | 139 | **0** | 139 | **0** |
| İngilizce enstrüman etiketi | 8 | **0** | 8 | **0** |
| Header çakışması | 0px² | 0px² | 0px² | 0px² |

**320×700'de tab çalışma alanı 40px'ti.** Sekiz track'lik buton grid'i, iki
satırlık section chip yığını ve iki satırlık transport, tab'a bir tel bile
sığmayacak kadar yer bırakmıyordu.

## Header

Üç kolon: 44px leading (**ayrılmış**), `min-width:0` merkez, 44px trailing ⓘ.

Marka ve başlık artık x=60'tan başlar; ayrılan kolon x=44'te biter.

**Varsayım, açıkça:** raporlanan sol X düğmesi bu yüzeyin içinde çalıştığı
kabuğa aittir — uygulamanın kendi header'ında bir leading action yoktur. Bu
yüzden kolon **ayrıldı**, içine çalışmayan bir düğme konmadı. Kabuk oraya bir
şey çizmiyorsa kolon boş durur ve başlık yine güvendedir; oraya gerçek bir
eylem konması istenirse yer hazırdır.

## Vacuity probe

18 probe: 6 birim, 6 tarayıcı, 6 görsel. Hepsi kırmızı.

**İki görsel probe ilk turda yeşil geldi ve ikisi de kontrolün yanlış şeye
baktığını gösterdi:**

- **13 — header.** Kontrol, metnin *bizim* düğmelerimizle çakışmasını ölçüyordu.
  Leading tarafta çakışacak bir öğe yok; orada duran şey kabuğun kontrolü. Yani
  kolonu 0px yapmak hiçbir şeyi kırmıyordu. Kontrol artık **geometriyi** ölçüyor:
  metin, ayrılan kolonun bitiminde veya sonrasında başlamalı.
- **17 — İngilizce etiket.** Enstrüman adları artık iki ana ekranda hiç
  görünmüyor (lane'in ikinci satırı kalktı), yalnız track sheet'inde. Kontrol
  yalnız ana ekranlara bakıyordu, yani "İngilizce etiket görünmüyor" iddiası
  **etiketin hiçbir yerde olmamasıyla** doğrulanıyordu. Kontrol artık sheet'i de
  açıp okuyor.

İkisi de düzeltildikten sonra kırmızıya döndü.

## Değiştirilmeyenler

Arrangement veri modeli, playback/engine yaşam döngüsü, transform çekirdeği,
Song Contract semantiği. 2J tarayıcı paketi (66 kontrol) aynı fixture'la
değişmeden geçiyor: bar tap navigasyonu, engine build sayısı, selection,
clipboard ve undo dâhil.

## Açık kalanlar

- **Düzen'de lane'lerin altında boş alan var.** Sekiz lane 352px, çalışma alanı
  490px. Zararsız; timeline'ı dikey ortalamak veya lane yüksekliğini artırmak
  ayrı bir karar.
- **Aktif track kontrolü preset adını taşıyor, enstrümanı taşımıyor.**
  "Ritim Gitar · Yüksek gain" — enstrüman track sheet'inde. Tek satırda üçü de
  320px'e sığmıyor.
