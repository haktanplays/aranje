/**
 * Render the five figures and write down what came out (2T-C §10).
 *
 *   npx vite build --config eval/guitar-performance/vite.guitar.config.mts
 *   node eval/guitar-performance/measure.mjs            # writes MEASUREMENTS.json
 *   OUT_NAME=BASELINE.json node eval/guitar-performance/measure.mjs
 *
 * The sample packs are fetched over HTTP by the audio layer, so the page
 * cannot be `about:blank`; a tiny static server for `public/` is the whole
 * fix, and it serves exactly the files the app serves. No Next build is
 * involved, because nothing here renders a page — only audio.
 */
import { chromium } from "playwright";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const OUT = "eval/guitar-performance";
const OUT_NAME = process.env.OUT_NAME ?? "MEASUREMENTS.json";
const WAV_DIR = process.env.WAV_DIR ?? `${OUT}/wav`;
mkdirSync(WAV_DIR, { recursive: true });

const MIME = {
  ".json": "application/json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://x");
  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><meta charset=utf-8><title>render</title><body></body>");
    return;
  }
  const path = join(
    "public",
    normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""),
  );
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
  });
  createReadStream(path).pipe(response);
});
await new Promise((resolve) => server.listen(0, resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const bundle = readFileSync(`${OUT}/.render/guitar-render.js`, "utf8");
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("requestfailed", (request) => errors.push(`request failed: ${request.url()}`));
page.on("response", (response) => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const names = await page.evaluate(() => window.AranjeGuitarPerformance.fixtureNames());
if (names.length === 0) throw new Error("no fixtures: the bundle did not load");

const measurements = {};
for (const name of names) {
  process.stdout.write(`  ${name.padEnd(12)} ... `);
  const rendered = await page.evaluate(
    (fixture) =>
      window.AranjeGuitarPerformance.renderFixture(fixture).then((result) => ({
        wav: result.wavBase64,
        measurement: { ...result, wavBase64: undefined },
      })),
    name,
  );
  writeFileSync(`${WAV_DIR}/${name}.wav`, Buffer.from(rendered.wav, "base64"));
  delete rendered.measurement.wavBase64;
  measurements[name] = rendered.measurement;
  const m = rendered.measurement;
  process.stdout.write(
    `peak ${m.peakDbfs.toFixed(1)} dBFS · ${m.onsetCount} onset · ` +
      `geçiş ${m.transientWindow.changeDb >= 0 ? "+" : ""}${m.transientWindow.changeDb.toFixed(2)} dB · ` +
      `${m.transitionCentroidHz === null ? "?" : m.transitionCentroidHz.toFixed(0)} Hz · ` +
      `${m.voices.physical} kaynak · ` +
      `${m.pitch.settledCents === null ? "perde yok" : `${m.pitch.settledCents.toFixed(1)}c`}` +
      ` · varış ${m.pitch.arrivalSeconds === null ? "yok" : `${(m.pitch.arrivalSeconds * 1000).toFixed(0)}ms`}` +
      ` · kalkış ${m.pitch.departureSeconds === null ? "yok" : `${(m.pitch.departureSeconds * 1000).toFixed(0)}ms`}\n`,
  );
}

await browser.close();
server.close();

if (errors.length > 0) {
  console.error("\npage errors:");
  for (const error of errors) console.error(`  ${error}`);
  process.exitCode = 1;
}

writeFileSync(
  `${OUT}/${OUT_NAME}`,
  `${JSON.stringify(
    {
      what: "2T-C §10 — mızrap, hammer-on, pull-off ve slide'ın ölçülen farkı",
      renderedAt: new Date().toISOString(),
      commit: process.env.MEASURE_COMMIT ?? null,
      sampleRate: 44100,
      fixtures: measurements,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${OUT}/${OUT_NAME}`);
