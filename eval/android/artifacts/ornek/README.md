# Örnek kart — gerçek bağlantı değil

Bu klasördeki üç dosya `make-card.mjs`'in **çalıştığının kanıtı**, dağıtımın
kendisi değil. QR kodun içinde `http://127.0.0.1:3100/eval/android-acceptance`
yazıyor; bu adres yalnız harness'i koşan makinede vardır ve **telefondan
açılmaz**.

Gerçek kart, herkese açık önizleme adresi belli olduğunda tek komutla üretilir
ve bu dosyaların üstüne yazılır:

```
npm i --no-save qrcode playwright
node eval/android/make-card.mjs https://<host>/eval/android-acceptance
```
