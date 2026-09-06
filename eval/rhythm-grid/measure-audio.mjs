/**
 * Renders the L31 takes and the nine bar-boundary fixtures in a real
 * Chromium, through the production export renderer (§4, §10, §11).
 *
 * The bundle is injected into a page served by the running app, so the sample
 * URLs resolve exactly as they do in the product and what is measured is the
 * audio a reader would receive.
 *
 *   npx vite build --config eval/rhythm-grid/vite.rhythm-render.config.mts
 *   npx next build && npx next start -p 3115
 *   node eval/rhythm-grid/measure-audio.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = "eval/rhythm-grid/artifacts";
const WAV = "eval/rhythm-grid/wav";
mkdirSync(OUT, { recursive: true });
mkdirSync(WAV, { recursive: true });

const bundle = readFileSync("eval/rhythm-grid/.render/rhythm-render.js", "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.setDefaultTimeout(120_000);

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const save = (name, render) => {
  if (render?.wavBase64) {
    writeFileSync(`${WAV}/${name}.wav`, Buffer.from(render.wavBase64, "base64"));
    delete render.wavBase64;
  }
  return render;
};

/* ------------------------------------------------------------ the takes */

const takes = {};
for (const id of ["L30a", "L31a", "L31b", "L32a", "L33a", "L33b"]) {
  process.stdout.write(`  take ${id} ... `);
  const render = save(
    `take-${id}`,
    await page.evaluate((takeId) => window.AranjeRhythmRender.renderTake(takeId), id),
  );
  takes[id] = render;
  if (!render) {
    process.stdout.write("NOT BUILT\n");
    continue;
  }
  const missed = render.onsets.filter((onset) => onset.detectedSeconds === null).length;
  process.stdout.write(
    `${render.onsets.length} notes, ${render.detector.count} rises found, ${missed} unmatched, peak ${render.health.peak}\n`,
  );
}

/* -------------------------------------------------- the sample's own onset */

process.stdout.write("  sample onset profile ... ");
const profile = await page.evaluate(() =>
  window.AranjeRhythmRender.renderSampleProfile(),
);
process.stdout.write(
  profile
    ? `threshold at +${profile.toThresholdMs} ms, peak at +${profile.toPeakMs} ms, detector +${profile.detectedMs} ms\n`
    : "NOT BUILT\n",
);

/* --------------------------------------------------- the metronome events */

const clickNames = await page.evaluate(() =>
  window.AranjeRhythmRender.metronomeCaseNames(),
);
const metronome = {};
for (const name of clickNames) {
  const table = await page.evaluate(
    (id) => window.AranjeRhythmRender.metronomeTable(id),
    name,
  );
  metronome[name] = table;
  console.log(
    `  click ${name}: ${table.beats.length} beats, ${table.units.length} units,` +
      ` one-per-tick ${table.onePulseOneClick}, main beats unmoved ${table.mainBeatsUnmoved}`,
  );
}

/* ------------------------------------------------- the accent A/B control */

const contrastModes = await page.evaluate(() => window.AranjeRhythmRender.accentModes());
const contrast = {};
for (const mode of contrastModes) {
  process.stdout.write(`  accent contrast ${mode} ... `);
  const render = save(
    `accent-${mode}`,
    await page.evaluate((id) => window.AranjeRhythmRender.renderAccentContrast(id), mode),
  );
  contrast[mode] = render;
  process.stdout.write(
    render
      ? `plan ${render.planGainRatio}x, measured ${render.measuredPeakRatio}x (${render.measuredDb} dB), abs peak ${render.absolutePeak}\n`
      : "NOT BUILT\n",
  );
}

/* ------------------------------------------------ the boundary fixtures */

const names = await page.evaluate(() => window.AranjeRhythmRender.boundaryNames());
const boundaries = {};
for (const name of names) {
  process.stdout.write(`  boundary ${name} ... `);
  const render = save(
    `boundary-${name}`,
    await page.evaluate((id) => window.AranjeRhythmRender.renderBoundary(id), name),
  );
  boundaries[name] = render;
  if (!render) {
    process.stdout.write("NOT BUILT\n");
    continue;
  }
  const worst = Math.max(
    ...render.bars.map((bar) => Math.abs(bar.onsetErrorMs ?? Infinity)),
  );
  process.stdout.write(
    `${render.bars.length} bars, ${render.detector.count} rises, worst |error| ${Number.isFinite(worst) ? `${worst} ms` : "UNMATCHED"}\n`,
  );
}

await browser.close();

const artefact = {
  generatedAt: new Date().toISOString(),
  sha: process.env.SHA ?? "unset",
  pageErrors: errors,
  takes,
  sampleProfile: profile,
  metronome,
  accentContrast: contrast,
  boundaries,
};
writeFileSync(`${OUT}/AUDIO.json`, `${JSON.stringify(artefact, null, 2)}\n`);
console.log(`\npage errors: ${errors.length}`);
console.log(`written to ${OUT}/AUDIO.json and ${WAV}/`);
