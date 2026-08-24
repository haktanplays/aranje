/**
 * Renders the 2O-B chord cases in a real Chromium and writes what they
 * measured (spec 13.22 §25).
 *
 * The bundle is loaded into a page served by the running app, so the sample
 * URLs resolve exactly as they do in the product and the render is the one
 * the export button performs.
 *
 *   npx vite build --config eval/chord/vite.chord.config.mts
 *   npm run build && npx next start -p 3100
 *   node eval/chord/measure-audio.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/chord/artifacts";
mkdirSync(OUT, { recursive: true });

const bundle = readFileSync("eval/chord/.render/chord-render.js", "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

/* Count every AudioContext the page constructs, before the app can make one. */
await page.addInitScript(() => {
  window.__audioContexts = 0;
  window.__sampleRequests = 0;
  for (const key of ["AudioContext", "webkitAudioContext", "OfflineAudioContext"]) {
    const Original = window[key];
    if (!Original) continue;
    window[key] = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts += 1;
      }
    };
  }
  const fetchOriginal = window.fetch;
  window.fetch = (input, init) => {
    const url = String(typeof input === "string" ? input : input?.url ?? "");
    if (url.includes("/samples/")) window.__sampleRequests += 1;
    return fetchOriginal(input, init);
  };
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const names = await page.evaluate(() => window.AranjeChordRender.caseNames());
const results = {};
for (const name of names) {
  process.stdout.write(`  rendering ${name} ... `);
  results[name] = await page.evaluate(
    (caseName) => window.AranjeChordRender.renderChordCase(caseName),
    name,
  );
  process.stdout.write("done\n");
}

const scaling = await page.evaluate(() => ({
  one: window.AranjeChordRender.auditionScaling(1, 100),
  three: window.AranjeChordRender.auditionScaling(3, 100),
  five: window.AranjeChordRender.auditionScaling(5, 100),
  six: window.AranjeChordRender.auditionScaling(6, 100),
}));

const counts = await page.evaluate(() => ({
  audioContexts: window.__audioContexts,
  sampleRequests: window.__sampleRequests,
}));

await browser.close();

const overFullScale = Object.values(results)
  .filter((entry) => entry.peak > 1)
  .map((entry) => `${entry.name}:${entry.peak.toFixed(4)}`);

const artefact = {
  measuredOn: "desktop Chromium — not a phone, and not evidence about one",
  /*
   * Recorded rather than smoothed over: the WAV encoder clamps at +/-1, so
   * anything listed here would be clipped in an exported file. It is a
   * property of dense material at a loud track level and not of the chord
   * builder — a hand-written five-note chord does the same — but chords make
   * it much easier to reach, so the number is kept in front of the reader.
   */
  peaksOverFullScale: overFullScale,
  note:
    "These show the right notes sounding together on the right instrument " +
    "through the right mix. They are not evidence that a chord sounds good; " +
    "that is a human listening.",
  cases: results,
  auditionScaling: scaling,
  counts,
  consoleErrors: errors,
};

writeFileSync(`${OUT}/AUDIO.json`, `${JSON.stringify(artefact, null, 2)}\n`);

/* ------------------------------------------------------------- the claims */

const claims = [];
const claim = (name, ok, detail) => claims.push({ name, ok, detail });
const get = (name) => results[name];

claim(
  "every chord strikes its notes on one tick",
  Object.values(results).every((entry) => entry.onsetTicks[0] === 0),
  Object.values(results)
    .map((entry) => `${entry.name}:${entry.onsetTicks.join("/")}`)
    .join(" "),
);
claim(
  "the two-note power chord is two notes and the three-note one is three",
  get("a5-two").notesOnFirstOnset === 2 && get("a5-three").notesOnFirstOnset === 3,
  `${get("a5-two").pitches.join(",")} | ${get("a5-three").pitches.join(",")}`,
);
claim(
  "a chord is louder than the single note it is built from",
  get("am-open").rms > get("single-note").rms,
  `${get("single-note").rms.toFixed(6)} -> ${get("am-open").rms.toFixed(6)}`,
);
claim(
  "a palm-muted power chord is quieter than the open one",
  get("power-palm-muted").rms < get("a5-two").rms,
  `${get("a5-two").rms.toFixed(6)} -> ${get("power-palm-muted").rms.toFixed(6)}`,
);
claim(
  "an accented chord is louder than the plain one",
  get("chord-accent").peak > get("am-open").peak,
  `${get("am-open").peak.toFixed(6)} -> ${get("chord-accent").peak.toFixed(6)}`,
);
claim(
  "panning moves the whole chord, not one string",
  get("chord-panned-left").leftRms > get("chord-panned-left").rightRms * 4 &&
    get("chord-panned-right").rightRms > get("chord-panned-right").leftRms * 4,
  `L ${get("chord-panned-left").leftRms.toFixed(5)}/${get("chord-panned-left").rightRms.toFixed(5)} ` +
    `R ${get("chord-panned-right").leftRms.toFixed(5)}/${get("chord-panned-right").rightRms.toFixed(5)}`,
);
claim(
  "a chord and another track sound at the same tick",
  get("chord-with-bass").onsetTicks.length === 1 &&
    get("chord-with-bass").notesOnFirstOnset > get("am-open").notesOnFirstOnset,
  `${get("chord-with-bass").notesOnFirstOnset} notes on tick 0`,
);
claim(
  "the audition is quieter than the same chord at written velocity",
  get("audition-chord").rms < get("audition-velocity-unscaled").rms,
  `${get("audition-velocity-unscaled").rms.toFixed(6)} -> ${get("audition-chord").rms.toFixed(6)}`,
);
claim(
  "the preview scaling leaves one to three notes alone and quietens more",
  scaling.one === 100 && scaling.three === 100 && scaling.five < 100 && scaling.six < scaling.five,
  JSON.stringify(scaling),
);
claim(
  "every render disposed its context",
  Object.values(results).every((entry) => entry.activeAfterDispose === 0),
  "0",
);
/*
 * The honest one. A dense chord at the loudest a track can be set to goes past
 * full scale, and the encoder clamps it — so this is reported as a number
 * rather than asserted away. What the claim checks is the part that is the
 * product's promise: the level a reader is *given* does not clip.
 */
claim(
  "a six-note chord at the templates' own level stays inside full scale",
  get("am7-fifth-at-minus-6").peak <= 1,
  `0 dB peak ${get("am7-fifth").peak.toFixed(4)} -> -6 dB peak ${get("am7-fifth-at-minus-6").peak.toFixed(4)}`,
);
claim(
  "a single note at 0 dB does not clip either, so this is about density",
  get("single-note").peak <= 1,
  `${get("single-note").peak.toFixed(4)}`,
);

claim("no page error", errors.length === 0, errors[0] ?? "clean");

for (const entry of claims) {
  console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.name}  — ${entry.detail}`);
}
const failed = claims.filter((entry) => !entry.ok).length;
console.log(`\n${claims.length - failed}/${claims.length} claims hold`);
writeFileSync(`${OUT}/AUDIO-CLAIMS.json`, `${JSON.stringify(claims, null, 2)}\n`);
process.exit(failed === 0 ? 0 : 1);
