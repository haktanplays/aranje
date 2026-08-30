# Fiziksel Android doğrulaması — 2U-C §7

Bu turun kapanış ölçütü tek bir cümle:

> **Gerçek bir Android telefonda, arkadaki yüzey kaymadan "1 → 3 → 2 ölçü"
> seçilebiliyor.**

Aşağıdaki her şey tarayıcı emülasyonunda ölçüldü. Emülasyon telefon değildir:
düzeltilen kusur tam olarak derleyicinin (compositor) dokunma kararında
yaşıyordu ve o karar cihazda alınıyor. **Bu adım henüz yapılmadı.**

---

## Ne yapılacak (tek ekran)

1. Android telefonda **Chrome** aç.
2. Şu adrese git — SHA'yı olduğu gibi bırak, `main` değil:

   ```
   https://aranje.vercel.app/eval/editor-acceptance?sha=<DEPLOY_SHA>
   ```

3. "Başla"ya bas, **Tab** görünümüne geç, **Düzenle**'ye bas.
4. **1. ölçünün numarasına** (üstteki ince şeride) parmağını bas ve **bırakma**.
   Yarım saniye sonra o ölçü seçilecek.
5. Parmağını **kaldırmadan sağa** sürükle. Ekranın sağ kenarına gel ve orada
   **bekle** — görüntü kendi kendine ilerlemeli ve seçim 3. ölçüye ulaşmalı.
6. Yine kaldırmadan **sola** dön ve 2. ölçüde dur.
7. Parmağını kaldır.
8. Aşağıdaki bloğu doldur.

---

## Ölçülecek beş şey

```
Cihaz / Android sürümü / Chrome sürümü:
Deploy SHA (ekranın üstünde yazıyor):

1. Seçim 1 → 3 → 2 oldu mu?                  [ ] evet   [ ] hayır → ne oldu:
2. Sürükleme boyunca arkadaki tab kaydı mı?  [ ] hayır  [ ] evet → nerede:
3. Parmağın altındaki ölçü takip edildi mi?  [ ] evet   [ ] hayır → nerede koptu:
   (kenarda beklerken seçim büyümeye devam etti mi)
4. Bıraktıktan sonra normal kaydırma çalıştı mı?
   (portenin ortasından yana kaydır)          [ ] evet   [ ] hayır
5. Parmağı kaydırırken bir bildirim/çağrı gelip hareketi kestiyse,
   ekranda takılı kalan bir seçim kaldı mı?   [ ] hayır  [ ] evet → ne kaldı:
```

İsteğe bağlı ama çok değerli: 4. adımdaki sürüklemeyi **ekran kaydı** ile al.
Arkadaki yüzeyin kayıp kaymadığı, tek karede görülebilen bir şey.

---

## Bu adım yapılmadan

- "physical PASS" yazılmaz.
- Bu turun kapanış ölçütü karşılanmış sayılmaz.
- `eval/editor-2uc/artifacts/RESULTS.json` içindeki 72/72, **tarayıcı
  emülasyonu** sonucudur ve raporda da öyle geçer.

## Emülasyonun kapatamadığı tek nokta

Ölçü başlığı (`touch-action: pan-y`) kaydırmayı **parmak inmeden önce**
reddediyor; bu, derleyiciye verilen bir söz ve cihazda da geçerli olması
beklenen tek mekanizma. Nota aralığı ise porte gövdesinde başlıyor — herkesin
tab'ı kaydırdığı yüzey — ve orada bir ekseni önceden rezerve etmek, birkaç
kişinin kullandığı hareket için herkesin kullandığı hareketi bozmak olurdu. Bu
yüzden nota aralığı, sahipliği aldıktan sonra her `touchmove`'u reddetmeye
dayanıyor. Emülasyonda çalışıyor (11/11 hareket reddedildi, hiç `pointercancel`
yok); cihazda çalıştığını **yalnızca 2. ve 3. sorular** gösterebilir.
