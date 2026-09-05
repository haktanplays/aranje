/**
 * Render the three palm-mute cases and write down what came out
 * (2V-D.1-C §10, §15).
 *
 *   npx vite build --config eval/technique-spans/vite.spans.config.mts
 *   node eval/technique-spans/measure.mjs      # writes MEASUREMENTS.json
 *
 * The sample packs are fetched over HTTP by the audio layer, so a tiny static
 * server for `public/` is the whole setup. No Next build is involved: nothing
 * here renders a page, only audio.
 */
import { chromium } from "playwright";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const OUT = "eval/technique-spans";
const WAV_DIR = `${OUT}/wav`;
mkdirSync(WAV_DIR, { recursive: true });

const MIME = { ".json": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://x");
  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><meta charset=utf-8><title>render</title><body></body>");
    return;
  }
  const path = join("public", normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});
await new Promise((resolve) => server.listen(0, resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const bundle = readFileSync(`${OUT}/.render/spans-render.js`, "utf8");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("requestfailed", (request) => errors.push(`request failed: ${request.url()}`));
page.on("response", (response) => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const names = await page.evaluate(() => window.AranjeTechniqueSpans.fixtureNames());
if (names.length === 0) throw new Error("no fixtures: the bundle did not load");

const fixtures = {};
for (const name of names) {
  process.stdout.write(`  ${name.padEnd(8)} ... `);
  const rendered = await page.evaluate(
    (fixture) =>
      window.AranjeTechniqueSpans.renderFixture(fixture).then((result) => ({
        wav: result.wavBase64,
        measurement: { ...result, wavBase64: undefined },
      })),
    name,
  );
  writeFileSync(`${WAV_DIR}/${name}.wav`, Buffer.from(rendered.wav, "base64"));
  delete rendered.measurement.wavBase64;
  fixtures[name] = rendered.measurement;
  const m = rendered.measurement;
  process.stdout.write(
    `peak ${m.peak.toFixed(4)} · ilk vuruş RMS ${m.firstStrikeRms.toFixed(5)} · ` +
      `sönüm ${(m.firstStrikeDecaySeconds * 1000).toFixed(0)} ms\n`,
  );
}

await browser.close();
server.close();

if (errors.length > 0) {
  console.error("\npage errors:");
  for (const error of errors) console.error(`  ${error}`);
  process.exitCode = 1;
}

/*
 * The two claims this render is here to check, stated as numbers rather than
 * as prose. Parity is not asserted to the bit: two offline renders of the
 * same plan are deterministic, but the tolerance is written down so a reader
 * can see what "the same" was allowed to mean.
 */
const legacy = fixtures.legacy;
const span = fixtures.span;
const plain = fixtures.plain;
const verdicts = {
  spanIsAudible: span.peak > 0.001,
  spanMatchesLegacy:
    Math.abs(span.firstStrikeDecaySeconds - legacy.firstStrikeDecaySeconds) <= 0.005 &&
    Math.abs(span.firstStrikeRms - legacy.firstStrikeRms) <= legacy.firstStrikeRms * 0.02,
  /* The negative control: if this is false, the two above prove nothing. */
  muteChangesTheSound: legacy.firstStrikeDecaySeconds < plain.firstStrikeDecaySeconds,
};

writeFileSync(
  `${OUT}/MEASUREMENTS.json`,
  `${JSON.stringify(
    {
      what: "2V-D.1-C §10 — legacy palm mute, span palm mute ve susturulmamış notanın gerçek offline render'ı",
      renderedAt: new Date().toISOString(),
      commit: process.env.MEASURE_COMMIT ?? null,
      sampleRate: 44100,
      fixtures,
      verdicts,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${OUT}/MEASUREMENTS.json`);
for (const [name, value] of Object.entries(verdicts)) {
  console.log(`  ${value ? "ok  " : "FAIL"} ${name}`);
  if (!value) process.exitCode = 1;
}
