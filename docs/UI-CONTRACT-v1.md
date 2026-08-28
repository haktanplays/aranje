# UI Contract v1

UI Contract v1 geçici bir geliştirme dondurmasıdır; editor parity
tamamlandıktan sonra founder değerlendirmesiyle değiştirilebilir.

Bu belge bir tasarım kararı değildir. Faz 2U boyunca geliştirme yüzeyini
sabit tutar, o kadar. Kalıcı bir UI kararı ancak ayrı bir UI/UX turunda,
founder değerlendirmesiyle alınır ve o tur "UI Contract v2"yi yazar.

Dondurmanın gerekçesi tasarım değil, ölçüm. Editor parity omurgası — seçim,
pano, taşıma, çoğaltma, ölçü işlemleri — mevcut yüzeye bağlanacak. Yüzey
aynı turda hareket ederse, çıkan hatanın omurgadan mı yerleşimden mi
geldiği söylenemez. Önce zemin sabitlenir, sonra üstüne inşa edilir.

Songsterr bu turda yalnız davranış/parity referansıdır. Tasarımı, metinleri,
marka öğeleri, içerikleri ve görselleri kopyalanmaz; Aranjé'nin kendi UI
dili korunur.

## Dondurulan ana geometri

Faz 2U boyunca aşağıdakiler keyfî olarak taşınmaz veya yeniden tasarlanmaz:

- header
- Düzen / Çoklu / Tab görünüm kapıları
- bölüm seçici
- focused edit üst satırı
- staff yerleşimi
- tel aralığı
- "Nota / Şekil / Ritim / Bağla" kapıları
- selection toolbar
- transport
- instrument strip
- alt kontrol bölgeleri

**Yeni işlev nereye eklenir:** mevcut sheet'lere, "Taşı" sheet'ine, "Daha
fazla" sheet'ine, measure header/gutter bağlamına ve mevcut contextual
toolbar'a. Yeni bir sürekli satır, yeni bir kalıcı çubuk ya da yeni bir
görünüm kapısı eklenmez.

## Ölçülen zemin

Dondurma bir cümle değil, bir dosya: `eval/ui-contract/GOLDEN.json`.
`dc8cde8` üzerinde, dört viewport × sekiz durum ölçülerek kaydedildi.

Viewport'lar:

| | genişlik × yükseklik | dokunma |
| --- | --- | --- |
| telefon (dar) | 320 × 700 | var |
| telefon | 390 × 844 | var |
| Android | 412 × 915 | var, Android Chrome UA |
| masaüstü | 1363 × 936 | **yok** (`touch=0`) |

Durumlar: `read`, `focused edit`, `note/chord selection`, `range selection`,
`Daha fazla`, `duration edit`, `technique sheet`, `arpej preview`.

Sekiz durum, çünkü bir yerleşim tek bir yerleşim değildir. Boştayken sığan
staff, altında bir seçim çubuğu belirdiği anda üç teli kırpan staff'ın ta
kendisiydi (K-59 §18); yalnız duran ekranı donduran bir sözleşme, hiç
sorun çıkarmamış tek ekranı dondururdu.

Dondurulan ölçüler:

- staff bounds
- altı string y
- fret digit centres
- `main` yüksekliği
- toolbar / transport bounds
- body overflow
- staff scroller sayısı
- 44 px hedefler
- label truncation
- hit owner'ları

`dc8cde8` üzerinde ölçülen zemin, dört viewport'ta da aynı: staff
`x=34 y=73 544×320`, tel y'leri `[337, 293, 249, 205, 161, 117]`, düzenleme
modunda 192 staff hücresi ve 16 chrome kontrolü. Değişen tek şey `main`
yüksekliği (`409 / 601 / 672 / 693`), ki ekran boyu odur.

### Piksel diff neden değil

Ekran görüntüsü diff'i "herhangi bir piksel oynadı mı" sorusunu yanıtlar,
ki yanlış sorudur: bir makinede antialiasing değişse kırmızı olur, aynı
kutunun içinde kırk piksel aşağı kaymış bir kontrolde yeşil kalır.
Sözleşmenin koruduğu şey **bir parmağın bağlı olduğu aritmetiktir** — altı
telin nerede olduğu, rakamların nereye oturduğu, çalışma alanının kaç piksel
kaldığı, bir şeyin taşıp taşmadığı ve bir basışın sahibinin kim olduğu.
Bunlar sayıdır; sayı olarak ölçülür, sayı olarak karşılaştırılır.

### Staff hücresi bir chrome kontrolü değildir

Staff hücresinin genişliği müzikal slot genişliğidir — `34 px`, tab'ın
üzerine çizildiği sabitin aynısı. 44'e çıkarmak ölçüyü %30 genişletir ve
telefona üçte bir daha az müzik sığdırır. K-59 §18'in kapattığı ve bu
sözleşmenin koruduğu şey hücrenin **satır yüksekliğidir**: staff'ın kendi
içinde scroller'a ihtiyaç duymadan bir parmağın basabileceği altı tel. Bu
yüzden hücreler o kuralla, chrome kontrolleri 44×44 kuralıyla ölçülür.

## Bu turda UI değişikliğine izin veren gerçek blocker'lar

1. Özellik mevcut yüzeyden erişilemiyorsa.
2. 320×700'de taşma veya tel kaybı varsa.
3. Bir kontrol 44×44'ün altına düşüyorsa.
4. Label kesiliyorsa.
5. Pointer/hit-owner çatışması varsa.
6. Aynı kullanıcı jesti iki komut çalıştırıyorsa.
7. İşlem ne yapacağı anlaşılmadan destructive oluyorsa.

**Gerekçe sayılmayanlar:** "daha güzel olur", "daha modern görünür", "bu
component'e sığmadı". Üçü de tek başına UI değiştirme gerekçesi değildir.

Bir blocker'a dayanarak yapılan değişiklik, hangi maddeye dayandığını
söyleyerek yapılır ve `GOLDEN.json` o değişiklikten sonra **yeniden
kaydedilir** — sessizce sürüklenmez.

## Nasıl koşulur

```
PORT=3104 ./eval/chord-audio/serve.sh
node eval/ui-contract/golden.mjs                 # dondurulanla karşılaştır
WRITE_GOLDEN=1 node eval/ui-contract/golden.mjs  # zemini yeniden kaydet
```

Kaydetmenin ayrı bir anahtar olması bilerek. Her koşuda kendi beklentisini
yeniden yazan bir harness, kodun o an ne yapıyorsa ona katılan bir
harness'tır; bu, bir sözleşmenin tam tersidir.
