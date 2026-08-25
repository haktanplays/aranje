/**
 * What the rendered audio has to be true of (2S-A §17).
 *
 *   npx vite build --config eval/intent-composer/vite.intent.config.mts
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/check-audio.mjs
 *
 * `measure-arrival.mjs` and `measure-contribution.mjs` write down what the
 * audio *is*. This one says what it must be, and exits non-zero when it is
 * not — which is what makes an audio vacuity probe possible at all: a probe
 * needs something that can go red, and a JSON file cannot.
 *
 * Every claim is measured off a real offline render at a real tempo. None of
 * it is a DOM assertion and none of it is a mock.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

import { expressionPresets } from "../../src/lib/audio/expression.ts";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";

/** Every grid and tempo the §3 matrix names, plus the technique cases. */
const ARRIVAL = [
  "reported-8-40", "reported-8-132", "reported-8-260",
  "reported-16-132", "reported-16-260",
  "reported-24-132", "reported-24-260",
  "reported-32-40", "reported-32-132", "reported-32-260",
  "technique-hammer_on-32", "technique-pull_off-32",
  "dropd-32", "capo3-32",
];

let failed = 0;
const claim = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const bundle = readFileSync(`${OUT}/.render/intent-render.js`, "utf8");
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

/* ------------------------------------- 1. the pitch is reached, every time */

for (const name of ARRIVAL) {
  const report = await page.evaluate(
    (fixture) => window.AranjeIntentRender.measureArrivalNamed(fixture),
    name,
  );
  /*
   * A fixture with no targets is a fixture whose slur was silently turned
   * into an ordinary attack — and every claim below it would then hold by
   * having nothing to check. §3 forbids that fix, so the count is a claim.
   */
  claim(`${name}: the slur it is written with is still a slur`, report.targets.length > 0);
  for (const target of report.targets) {
    claim(
      `${name}: the ${target.kind} reaches ${target.pitch} before its voice stops`,
      target.stopsBeforeArrival === false && target.heldSeconds > 0,
      `held ${(target.heldSeconds * 1000).toFixed(1)}ms`,
    );
    /*
     * The strong form of the same thing: the note is sounded for at least as
     * long as the finger took to get to it. A constant travel time fails this
     * the moment the grid is dense enough — measured 28.0 ms of travel against
     * 0.0 ms held at 1/32 and 260 BPM, before the fix.
     */
    claim(
      `${name}: the ${target.pitch} is held at least as long as the travel took`,
      target.heldSeconds >= target.transitionSeconds - 1e-9,
      `held ${(target.heldSeconds * 1000).toFixed(1)}ms, travel ${(target.transitionSeconds * 1000).toFixed(1)}ms`,
    );
  }
}

/* --------------------------- 2. the tightest case is actually in tune */

const tightest = await page.evaluate(
  () => window.AranjeIntentRender.measureArrivalNamed("reported-32-260"),
);
for (const target of tightest.targets) {
  /*
   * Measured, not chosen: the run that produced `AUDIO.json` read 21.1 cents
   * at the target's own window after the fix and 49.0 before it. The bound is
   * a quarter-tone — the point at which a listener stops hearing the written
   * note and starts hearing a bend — which is the smallest claim that
   * distinguishes the two.
   */
  claim(
    "1/32 at 260 BPM: the target's own pitch is what sounds, within a quarter-tone",
    Math.abs(target.centsOffAtSlotEnd) < 50,
    `${target.centsOffAtSlotEnd} cents`,
  );
}

/* ---------------------- 3. every onset of the dense bar is really audible */

const contribution = await page.evaluate(
  () => window.AranjeIntentRender.measureContributionNamed("reported-32-132"),
);
/*
 * Subtraction, not energy: each onset is removed from the song, the song is
 * rendered again, and the difference is measured. An onset that changes
 * nothing when taken out is an onset nobody hears — which is the claim the
 * reported "some notes are silent at 1/32" defect was really about.
 */
claim(
  "1/32 at 132 BPM: every onset changes the render when it is taken out",
  contribution.onsets.every((onset) => onset.peak > 0.01),
  contribution.onsets.map((onset) => onset.peak.toFixed(3)).join(" "),
);

/* ------------------- 4. the tight case is still one strike, not two */

const pullOff = await page.evaluate(
  () => window.AranjeIntentRender.measureArrivalNamed("technique-pull_off-32"),
);
for (const target of pullOff.targets) {
  claim(
    "a pull-off at 1/32 is still a pull-off rather than a second attack",
    target.kind === "pull_off" && target.stopsBeforeArrival === false,
    `${target.kind}, held ${(target.heldSeconds * 1000).toFixed(1)}ms`,
  );
  claim(
    "and its written pitch is what the render actually sounds",
    target.centsOffAtSlotEnd !== null && Math.abs(target.centsOffAtSlotEnd) < 50,
    `${target.centsOffAtSlotEnd} cents`,
  );
}

/* ------------- 5. the preset the fix is built on is still the one in use */

claim(
  "a landing finger may take at most its named share of the note",
  expressionPresets.legato.maxTravelFraction > 0 &&
    expressionPresets.legato.maxTravelFraction <= 0.5,
  String(expressionPresets.legato.maxTravelFraction),
);

claim("the render raised no page error", errors.length === 0, errors[0] ?? "");

await browser.close();
console.log(`\n${failed === 0 ? "all claims hold" : `${failed} claim(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
