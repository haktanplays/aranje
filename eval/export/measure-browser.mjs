/**
 * The Chromium half of the 2M-A performance report (spec 13.19 §11).
 *
 * The offline render is the expensive part of a WAV export and cannot run in
 * Node at all, so it is measured here, in a real browser, through the very
 * render the export button performs.
 *
 * **Desktop Chromium numbers, labelled as such.** Not a phone measurement;
 * Android/iOS latency stays open at the release gate. A full render is not
 * repeated twenty times: each one decodes the sample banks and renders the
 * whole song, and the honest thing is to say how many rounds were run and
 * why rather than to pad the count.
 *
 *   npx vite build --config eval/export/vite.render.config.mts
 *   npx next start -p 3100
 *   node eval/export/measure-browser.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const REPORT = "eval/export/PERFORMANCE.json";
const ROUNDS = Number(process.env.RENDER_ROUNDS ?? 5);

const bundle = readFileSync("eval/export/.render/export-render.js", "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  const round = (value) => Number(value.toFixed(1));
  return {
    rounds: sorted.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
  };
};

/* One warm-up so the sample banks are decoded and cached, then the rounds. */
await page.evaluate(() => window.AranjeExportRender.renderExportCase("level-0"));

const renderSamples = [];
for (let index = 0; index < ROUNDS; index += 1) {
  const started = Date.now();
  await page.evaluate(() => window.AranjeExportRender.renderExportCase("scope-all-tracks"));
  renderSamples.push(Date.now() - started);
}

const shape = await page.evaluate(() =>
  window.AranjeExportRender.renderExportCase("scope-all-tracks"),
);

/* The Object-URL round trip a download costs, on the real APIs. */
const urlRoundTrip = await page.evaluate(() => {
  const blob = new Blob([new Uint8Array(3_000_000)], { type: "audio/wav" });
  const samples = [];
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    const url = URL.createObjectURL(blob);
    URL.revokeObjectURL(url);
    samples.push(performance.now() - started);
  }
  return samples;
});

await browser.close();

const report = JSON.parse(readFileSync(REPORT, "utf8"));
report.chromium = {
  honesty: [
    "Bu bölümdeki sayılar masaüstü Chromium ölçümüdür; fiziksel telefon kanıtı değildir.",
    `Tam offline render ${ROUNDS} turda ölçüldü: her tur bütün şarkıyı render ediyor ve ` +
      "yirmi tur ölçümü daha doğru yapmıyor, yalnız uzatıyor. Tur sayısı burada yazılıdır.",
  ],
  offlineRender: {
    ...stats(renderSamples),
    note: "Warm-up sonrası; sample bankları ilk turda çözülüp önbelleğe alınmıştır.",
    renderedSeconds: shape.seconds,
    frames: shape.frames,
    wavBytes: shape.wavBytes,
    wavMiB: Number((shape.wavBytes / (1024 * 1024)).toFixed(2)),
    activeAfterDispose: shape.activeAfterDispose,
  },
  objectUrlRoundTrip: {
    ...stats(urlRoundTrip),
    note: "3 MB'lık bir blob için createObjectURL + revokeObjectURL.",
  },
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  "PERFORMANCE.json merged (chromium half):",
  JSON.stringify(report.chromium.offlineRender),
);
