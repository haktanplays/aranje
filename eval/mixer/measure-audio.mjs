/**
 * Runs the 2L-C offline render cases in a real Chromium and writes what they
 * measured (spec 13.18 §8, §17).
 *
 * The bundle is loaded into a page served by the running app, so the sample
 * URLs resolve exactly as they do in the product. Every number is peak/RMS
 * off a rendered buffer — gain, stereo position and audibility correctness,
 * not mix quality.
 *
 *   npx vite build --config eval/mixer/vite.render.config.mts
 *   npx next start -p 3100
 *   node eval/mixer/measure-audio.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/mixer";
mkdirSync(OUT, { recursive: true });

const bundle = readFileSync("eval/mixer/.render/mixer-render.js", "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const names = await page.evaluate(() => window.AranjeMixerRender.caseNames());
const results = {};
for (const name of names) {
  process.stdout.write(`  rendering ${name} ... `);
  results[name] = await page.evaluate(
    (caseName) => window.AranjeMixerRender.renderMixCase(caseName),
    name,
  );
  console.log("ok");
}

await browser.close();

/* ------------------------------------------------------------- the claims */

const db = (a, b) => (b === 0 ? Infinity : 20 * Math.log10(a / b));
const round = (value) => Number(value.toFixed(2));
const checks = [];
const claim = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
};

const at = (name) => results[name];

/* Levels: -6 dB should measure about half the amplitude, -12 about a quarter. */
const drop6 = db(at("level--6").rms, at("level-0").rms);
const drop12 = db(at("level--12").rms, at("level-0").rms);
claim(
  "volume follows the dB it was given",
  Math.abs(drop6 + 6) < 1 && Math.abs(drop12 + 12) < 1,
  `-6 dB measured ${round(drop6)} dB, -12 dB measured ${round(drop12)} dB`,
);

/* Pan: hard left puts the energy on the left channel and vice versa. */
const centre = at("pan-centre");
const left = at("pan-left");
const right = at("pan-right");
claim(
  "the stereo position moves the energy the right way",
  centre.channels === 2 &&
    Math.abs(db(centre.leftRms, centre.rightRms)) < 0.5 &&
    left.leftRms > left.rightRms * 4 &&
    right.rightRms > right.leftRms * 4,
  `centre L-R ${round(db(centre.leftRms, centre.rightRms))} dB, ` +
    `left L-R ${round(db(left.leftRms, left.rightRms))} dB, ` +
    `right L-R ${round(db(right.leftRms, right.rightRms))} dB`,
);

/* Two tracks, opposite sides: both channels carry something, and differently. */
const split = at("two-tracks-split");
claim(
  "two tracks sit on opposite sides",
  split.leftRms > 0 && split.rightRms > 0,
  `L ${split.leftRms}, R ${split.rightRms}`,
);

/* A chord is one track, so every voice in it shares that track's position. */
const chordCase = at("chord-shares-pan");
claim(
  "every voice of a chord shares the track's position",
  chordCase.leftRms > chordCase.rightRms * 4,
  `L-R ${round(db(chordCase.leftRms, chordCase.rightRms))} dB`,
);

/* An expressive voice hangs off the same channel as the sampler. */
const expressive = at("expressive-shares-mix");
const plain = at("expressive-plain");
claim(
  "an expressive voice takes the same track mix as the sampler",
  expressive.leftRms > expressive.rightRms * 4 &&
    plain.leftRms > plain.rightRms * 4 &&
    expressive.rms > plain.rms,
  `hammered L-R ${round(db(expressive.leftRms, expressive.rightRms))} dB, ` +
    `plain L-R ${round(db(plain.leftRms, plain.rightRms))} dB`,
);

/* Session audition: mute removes a track, solo keeps only one. */
const both = at("both-audible");
const muted = at("session-mute-guitar");
const soloed = at("session-solo-guitar");
claim(
  "a session mute takes its track out of the render",
  muted.rms < both.rms && muted.rms > 0,
  `both ${both.rms}, guitar muted ${muted.rms}`,
);
claim(
  "a session solo leaves only the track being listened to",
  soloed.rms < both.rms && soloed.rms > 0 && soloed.rms !== muted.rms,
  `both ${both.rms}, guitar alone ${soloed.rms}, bass alone ${muted.rms}`,
);

/* Everything muted is a valid silence — and the metronome still clicks. */
const silence = at("all-muted");
const withClick = at("all-muted-with-metronome");
claim(
  "every track muted is silence, not a fallback",
  silence.peak < 1e-4,
  `peak ${silence.peak}`,
);
claim(
  "the metronome is not a track and keeps clicking",
  withClick.peak > silence.peak * 10 && withClick.peak > 1e-3,
  `silent ${silence.peak}, with metronome ${withClick.peak}`,
);

/* Nothing is left sounding after the graph is torn down. */
claim(
  "no voice is left sounding after dispose",
  Object.values(results).every((entry) => entry.activeAfterDispose === 0),
  `active after dispose: ${[...new Set(Object.values(results).map((e) => e.activeAfterDispose))].join(",")}`,
);

claim("the page stayed quiet", errors.length === 0, errors.slice(0, 2).join(" | "));

const failed = checks.filter((entry) => !entry.pass);
writeFileSync(
  `${OUT}/AUDIO.json`,
  `${JSON.stringify(
    {
      honesty: [
        "Bu ölçümler gain/pan/audibility doğruluğudur; müzikal mix kalitesi kanıtı değildir.",
        "Masaüstü Chromium offline render'ıdır; fiziksel telefon kanıtı değildir.",
      ],
      checks,
      failed: failed.length,
      measurements: results,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n${checks.length - failed.length}/${checks.length} audio claims hold`);
process.exit(failed.length === 0 ? 0 : 1);
