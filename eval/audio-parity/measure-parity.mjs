/**
 * Renders the plain/expressive parity bench in a real Chromium (§4, §5, §6).
 *
 *   npx vite build --config eval/audio-parity/vite.parity.config.mts
 *   npx next build && npx next start -p 3117
 *   node eval/audio-parity/measure-parity.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3117";
const OUT = "eval/audio-parity/artifacts";
mkdirSync(OUT, { recursive: true });

const bundle = readFileSync("eval/audio-parity/.render/parity-render.js", "utf8");
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.setDefaultTimeout(180_000);

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const report = await page.evaluate(() => window.AranjeParityRender.neutralParity(0));
if (!report) {
  console.log("NOT BUILT");
} else {
  console.log(
    `pack ${report.pack.id} trim ${report.pack.trimDb} dB (x${report.pack.trimGain}), ` +
      `${report.pitch} from ${report.sampleNote} at rate ${report.playbackRate}`,
  );
  for (const row of report.cases) {
    console.log(
      `  ${row.name.padEnd(22)} peak ${String(row.peak).padEnd(10)} ${String(row.peakDb).padStart(8)} dBFS` +
        `  tRMS ${row.transientRms}  sRMS ${row.sustainRms}  clip ${row.clipped}`,
    );
  }
  console.log("\n  stage offsets (expressive / plain):");
  for (const row of report.offsets) {
    console.log(`  ${row.stage.padEnd(10)} x${row.ratio}  ${row.db} dB`);
  }
}

const choices = await page.evaluate(() => window.AranjeParityRender.sampleChoices());
console.log("\n  who chooses the recording (expressive vs shared sampler):");
for (const row of choices ?? []) {
  if (row.agree) continue;
  console.log(
    `  midi ${row.midi}: expressive plays ${row.expressiveNote} at ${row.expressiveRate}, ` +
      `sampler plays ${row.samplerNote} at ${row.samplerRate}  <-- DISAGREE`,
  );
}
console.log(`  ${(choices ?? []).filter((r) => !r.agree).length} of ${(choices ?? []).length} semitones disagree`);

const sweep = await page.evaluate(() => window.AranjeParityRender.pitchSweep());
console.log("\n  one note, both paths, whole chain:");
for (const row of sweep ?? []) {
  console.log(
    `  ${row.pitch.padEnd(4)} peak ${row.plain.peak} / ${row.expressive.peak} = x${row.peakRatio} (${row.peakDb} dB)` +
      `   first 25 ms ${row.plain.window25} / ${row.expressive.window25} = x${row.window25Ratio} (${row.window25Db} dB)`,
  );
}

const ordering = {};
for (const fret of [5, 3]) {
  const rows = await page.evaluate((f) => window.AranjeParityRender.techniqueOrdering(f), fret);
  ordering[fret] = rows;
  console.log(`\n  eight notes on fret ${fret} (${rows?.[0]?.pitch ?? "?"}), production renderer:`);
  for (const row of rows ?? []) {
    console.log(
      `  ${row.attack.padEnd(7)} expressive ${String(row.notes[0]?.expressive)}` +
        `  planGain ${row.notes[0]?.planGain}  env ${row.notes[0]?.envelopePeak}` +
        `  meanPeak ${row.meanPeak}  tRMS ${row.meanTransientRms}  sRMS ${row.meanSustainRms}` +
        `  clip ${row.clipped}`,
    );
  }
}

await browser.close();
writeFileSync(
  `${OUT}/PARITY.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), pageErrors: errors, report, choices, sweep, ordering }, null, 2)}\n`,
);
console.log(`\npage errors: ${errors.length}`);
