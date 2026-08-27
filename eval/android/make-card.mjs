/**
 * The link, the QR code and the one-screen card the reader is handed (§7).
 *
 * There is no terminal step in the Android acceptance round and no cable: the
 * reader gets a URL, a square to point a camera at, and a page of Turkish that
 * fits on one screen. This builds all three from whatever URL it is given, so
 * the card is generated from the deployment rather than typed out beside it.
 *
 *   npm i --no-save qrcode
 *   node eval/android/make-card.mjs https://<preview-host>/eval/android-acceptance
 *
 * Writes `artifacts/QR.png`, `artifacts/KART.png` and `artifacts/KART.html`.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import QRCode from "qrcode";

const url = process.argv[2];
if (!url) {
  console.error("kullanım: node eval/android/make-card.mjs <url>");
  process.exit(2);
}

const OUT = "eval/android/artifacts";
mkdirSync(OUT, { recursive: true });

/*
 * High correction, because this square is going to be photographed off a
 * laptop screen at an angle in whatever light the room has.
 */
const png = await QRCode.toBuffer(url, {
  errorCorrectionLevel: "H",
  margin: 2,
  width: 640,
  color: { dark: "#161310", light: "#ffffff" },
});
writeFileSync(`${OUT}/QR.png`, png);
const dataUri = `data:image/png;base64,${png.toString("base64")}`;

const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>Aranjé — Android kabul testi</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; width: 900px; padding: 36px 40px;
    background: #ffffff; color: #161310;
    font: 16px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: #6b6560; font-size: 14px; margin: 0 0 22px; }
  .row { display: flex; gap: 32px; align-items: flex-start; }
  .qr { width: 260px; flex: none; text-align: center; }
  .qr img { width: 260px; height: 260px; display: block; }
  .qr code {
    display: block; margin-top: 10px; font-size: 12px; color: #6b6560;
    word-break: break-all; line-height: 1.35;
  }
  ol { margin: 0; padding-left: 20px; }
  li { margin-bottom: 9px; }
  .note {
    margin-top: 22px; padding: 12px 14px; border-radius: 8px;
    background: #f5f2ee; font-size: 14px; color: #4a4540;
  }
  .note b { color: #161310; }
  .time { color: #a3762f; font-weight: 600; }
</style></head><body>
  <h1>Aranjé · Android kabul testi</h1>
  <p class="sub">Telefonda Chrome ile aç. <span class="time">Tahmini süre: 5 dakika.</span></p>

  <div class="row">
    <div class="qr">
      <img src="${dataUri}" alt="QR kod">
      <code>${url}</code>
    </div>
    <div>
      <ol>
        <li>Telefonun kamerasını soldaki kareye tut, çıkan bağlantıya dokun.
          Sayfa Chrome'da açılmazsa bağlantıyı Chrome'a yapıştır.</li>
        <li>Telefon sesini yaklaşık <b>%50</b>'ye getir. Kulaklık varsa tak —
          bükümü ve titreşimi hoparlörden ayırt etmek zordur.</li>
        <li>Ekrandaki yönergeleri sırayla uygula. Her adımda tek iş var ve
          düğmeler büyük. Yanlış dokunursan <b>‹ Geri</b> ile bir adım dön;
          verdiğin cevaplar durur.</li>
        <li>Dinleme bölümünde riffi bir kez baştan sona dinle, sonra altı
          soruyu cevapla. Emin değilsen <b>Belirsiz</b> de — tahmin etme.</li>
        <li>Son ekranda <b>Sonucu kopyala</b>'ya dokun ve kopyalananı
          Haktan'ın açık ChatGPT konuşmasına yapıştır.</li>
      </ol>
      <div class="note">
        <b>Bu sayfa telefonundaki hiçbir şeyi değiştirmez.</b> Kendi şarkıların,
        geçmişin ve kayıtların olduğu gibi kalır: test kendi sabit riffini kendi
        belleğinde açar. Giriş istemez, mikrofon veya kamera izni istemez,
        hiçbir yere veri göndermez. Sayfayı yenilersen test baştan başlar.
      </div>
    </div>
  </div>
</body></html>`;

writeFileSync(`${OUT}/KART.html`, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.locator("body").screenshot({ path: `${OUT}/KART.png` });
await browser.close();

console.log(`QR.png, KART.png, KART.html → ${OUT}\n${url}`);
