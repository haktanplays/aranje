/**
 * Renders every seam fixture for real and measures the waveform (2V-C.4 §3).
 *
 * The audio comes out of the production `renderTake` in a real browser,
 * because Web Audio is what produces it. Nothing here re-reads an automation
 * list: the numbers are computed from the PCM samples the engine wrote.
 *
 *   npx vite build --config eval/expression-fidelity/vite.seam.config.mts
 *   ./eval/chord-audio/serve.sh
 *   LABEL=before node eval/expression-fidelity/measure-seam.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const LABEL = process.env.LABEL ?? "now";
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

const names = await page.evaluate(() => window.AranjeSeam.fixtureNames());
const rows = {};
let problems = 0;

for (const name of names) {
  process.stdout.write(`  ${name} ... `);
  const result = await page.evaluate((fixture) => window.AranjeSeam.measure(fixture), name);
  rows[name] = result;
  const seam = result.seam ?? {};
  const ok = result.verdict?.ok === true;
  /* A fixture that is *supposed* to have a hole in it passes by having one. */
  const asExpected = result.expectContinuous ? ok : !ok;
  if (!asExpected) problems += 1;
  console.log(
    `[${result.seamClass}] valley=${seam.valleyRatio} silent=${seam.silentSeconds}s step=${seam.maxStep} ` +
      `${asExpected ? "as expected" : `UNEXPECTED (${(result.verdict?.problems ?? []).join("; ")})`}`,
  );
}

await browser.close();

writeFileSync(
  `${OUT}/SEAM-${LABEL}.json`,
  `${JSON.stringify(
    { generatedAt: new Date().toISOString(), label: LABEL, consoleErrors: errors, rows },
    null,
    2,
  )}\n`,
);
console.log(`\n${problems === 0 ? "every fixture behaved as expected" : `${problems} unexpected`}`);
console.log(`written to ${OUT}/SEAM-${LABEL}.json`);
if (errors.length > 0) console.log(`console errors: ${errors.length}`);
process.exit(problems === 0 && errors.length === 0 ? 0 : 1);
