# S-02 — İnsan dinleme değerlendirmesi

Bu belge bir test fixture'ı değildir ve koddan türetilmemiştir. Haktan'ın
S-02 render'larını dinledikten sonra verdiği değerlendirmedir; buraya
anlamı değiştirilmeden yazılmıştır. Ölçümler için `verify.ts` ve
`../../eval/grid-check/` altındaki raporlara bakın — burada ölçüm yoktur,
yargı vardır.

Değerlendirme iki turda geldi. İkinci tur birincisini **nüanslandırır**;
çeliştikleri yerde ikincisi geçerlidir.

---

## Sonuç

| Kapı | Durum |
|---|---|
| Mühendislik kabulü | **geçti** |
| Temel müzikal tutarlılık | **geçti** |
| Premium / co-arranger müzikal kalite | **geçmedi** |

S-02 müzik dışı veya anlamsız **değildir**. S-01'e göre daha fazla flavor,
daha fazla teknik öğe ve daha fazla müzikal niyet taşır. Genel seviye,
yaklaşık 3–4 aydır gitar çalan **fakat müzikal kulağı olan** bir gitaristin
yazacağı şeyi andırıyor. Bu, ürünün "etkileyici bir AI co-arranger"
iddiasını taşıması için hâlâ yeterli değil.

Eksik olan şey **daha fazla nota değil**; ileri seviye phrase ve teknik söz
dağarcığıdır.

---

## Bölüm bölüm

**Break.** Aşırı progresif; doğal groove hissi yok. Haken'ı andıran additive
bir algı bırakıyor — sert ve senkoplu olması sorun değil, kaybolan şey temel
4/4 nabız hissi. Buna karşılık bölümdeki **sus/es boşlukları groove'a olumlu
katkı yapmış**; bu fikir korunmalı.

**Bridge.** Break'e fazla benziyor; anlamlı bir twist yok. Bridge→Solo
geçişinde çözülmemiş gerilim hissi oluşmuyor. Bölümdeki articulation
kullanımında slide **bend gibi algılandı** ve doğal bulunmadı.

**Solo.** Müzikal, ama fazla frenli: daha güçlü bir fikrin önü kesilmiş gibi
duruyor. Cümleler nefes alıyor, fakat potansiyel de birlikte kesiliyor.
Solo'nun altındaki **rhythm-guitar backing müzikal olarak başarılı**. İlk
dinlemede fark edilmemesinin nedeni yazım değil, **full mix içinde fazla
kısık kalması**. Bu bir kompozisyon başarısızlığı değildir; ayrı bir bulgu
olarak `mix_balance_issue` diye kaydedilmiştir.

**Solo → Acoustic geçişi.** Başarılı; sırıtmıyor.

**Acoustic outro.** Beklentinin üzerinde: yaklaşık **6.5/10**. Karanlık tonal
karakteri ve son barı yaklaşık **7/10**.

**Davul.** Fazla basit ve miks içinde yok denecek kadar zayıf. Sorun hit
sayısı değil: farklı groove rolleri, kick/snare ilişkisi ve geçiş fill'leri
yok.

**Tempo.** 138'den 69'a ani yarılama fren etkisi yaratıyor; istenmiyor.

---

## Kaydedilen bulgular

### 1. `mix_balance_issue` — solo altındaki backing

Backing'in müzikal olarak iyi olması ile miks içinde duyulabilir olması iki
ayrı şeydir. Bu checkpoint'te section seviyesinde volume automation
**eklenmedi**; bulgu, mevcut global track volume/pan ile oluşan sonucun
ölçümü olarak kayıtlıdır.

### 2. "Sus" terminolojisi

Song Contract'taki teknik terim değişmedi. Ancak kullanıcıya açık metinde
tek başına "sus" yazmak belirsizdir ve **suspended chord** ile karışır.
Kullanıcıya dönük metinlerde tercih edilecek karşılıklar: **"sessizlik"**,
**"es"**, **"boşluk"**, gerekiyorsa **"sus (es)"**.

Bu bir terminoloji bulgusudur; production UI bu checkpoint'te
değiştirilmemiştir.

### 3. `unsupported_phrase_technique` — sweep picking

Denetim sonucu: mevcut Song Contract sweep picking'i **ifade edemiyor**.

- `NoteEvent.articulation` nota başına **tek** değer taşır.
- Sweep picking bir nota articulation'ı değil, birden fazla notayı ve teli
  kapsayan bir **icra hareketidir**.
- Picking direction, string traversal ve gesture sınırı contract'ta yoktur.
- Hızlı arpej yazılabilir, fakat playback bunun sweep mi alternate picking
  mi olduğunu ayıramaz.

Bu yüzden bir modelin "sweep yazmamış olması" başarısızlık sayılmaz;
`unsupported_phrase_technique` olarak kaydedilir.

`articulation` enum'una `sweep`, `sweep_up` veya `sweep_down` **eklenmedi**
ve eklenmemelidir. Doğru çözüm phrase/grup düzeyindedir. Gelecek bir ürün
kararı için yön notu (yalnız yön; Faz 2H'de uygulanmaz):

```ts
type TechniqueSpan = {
  kind: "sweep_up" | "sweep_down";
  trackId: string;
  start: MusicalPosition;
  end: MusicalPosition;
  noteIds: string[];
};
```

### 4. Geniş slide, mevcut motor sınırı

Mevcut slide motoru tek bir source pitch automation'ı kullanır. Bu yüzden
**geniş aralıklı bir slide bend gibi algılanabilir** — S-02'de olan tam
olarak budur. Motor bu checkpoint'te değiştirilmemiştir; sınır kayda
geçmiştir.

---

## Bu değerlendirmenin Faz 2H-A'ya etkisi

"Eksik olan ileri seviye phrase ve teknik söz dağarcığıdır" bulgusu, Faz
2H-A'nın (Rhythmic Vocabulary Gate) doğrudan gerekçesidir: hızlı bir scalar
run, kısa bir legato burst, gerçek bir drum fill veya bir triplet groove
`resolution: 8 | 16` ile yazılamıyordu. 138 BPM'de yazılabilen en ince şey
108.7 ms'lik bir onaltılıktı.

2H-A bu boşluğun **yazılabilirlik** tarafını açar. Modelin bu söz dağarcığını
gerçekten kullanıp kullanmadığı ayrı bir sorudur ve Faz 2H-B'nin (izole
model bake-off) konusudur.
