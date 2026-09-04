/**
 * What the recordings do in their first frames (2V-C.4 §5).
 *
 * A browser, because the decoding is the thing being measured: an mp3's head
 * is whatever the decoder hands back, and reading the file with a different
 * decoder would answer a question nobody asked.
 *
 *   npx vite build --config eval/expression-fidelity/vite.seam.config.mts
 *   ./eval/chord-audio/serve.sh
 *   node eval/expression-fidelity/profile-samples.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/expression-fidelity/artifacts";
mkdirSync(OUT, { recursive: true });

const bundle = readFileSync("eval/expression-fidelity/.render/seam-render.js", "utf8");
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const result = await page.evaluate(() => window.AranjeSeam.samples());
await browser.close();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

let mismatches = 0;
for (const entry of result.packs) {
  console.log(`\npack ${entry.pack}`);
  console.log("file      silence   1stEnergy  10%      50%      90%     peak@    shape          table");
  for (const row of entry.files) {
    const p = row.profile;
    const ms = (value) => (value === null ? "  —   " : `${(value * 1000).toFixed(1)}ms`).padStart(8);
    console.log(
      `${row.note.padEnd(9)}${ms(p.digitalSilenceSeconds)}${ms(p.firstEnergySeconds)}` +
        `${ms(p.reach10Seconds)}${ms(p.reach50Seconds)}${ms(p.reach90Seconds)}` +
        `${ms(p.peakSeconds)}  ${row.shape.padEnd(15)}${row.attackMatches ? "ok" : "MISMATCH"}`,
    );
    if (!row.attackMatches) mismatches += 1;
  }
  console.log("  as played (buffer head divided by the playback rate):");
  console.log("  note   sample  rate    silence  1stEnergy  50%      90%     shape");
  for (const row of entry.played) {
    if (row.error) {
      console.log(`  ${row.note.padEnd(7)}${row.error}`);
      continue;
    }
    const ms = (value) => (value === null ? "  —   " : `${(value * 1000).toFixed(1)}ms`).padStart(9);
    console.log(
      `  ${row.note.padEnd(7)}${row.sample.padEnd(8)}${row.playbackRate.toFixed(3).padEnd(8)}` +
        `${ms(row.heardSilenceSeconds)}${ms(row.heardFirstEnergySeconds)}` +
        `${ms(row.heardReach50Seconds)}${ms(row.heardReach90Seconds)}  ${row.shape}`,
    );
  }
}

writeFileSync(
  `${OUT}/SAMPLE-ONSETS.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), consoleErrors: errors, ...result }, null, 2)}\n`,
);
console.log(`\nwritten to ${OUT}/SAMPLE-ONSETS.json`);
if (errors.length > 0) console.log(`console errors: ${errors.length}`);
if (mismatches > 0) {
  console.log(
    `\n${mismatches} recording(s) no longer match SAMPLE_ATTACK_SECONDS. ` +
      "The shipped handoff is tuned for audio that has changed.",
  );
}
process.exit(errors.length === 0 && mismatches === 0 ? 0 : 1);
