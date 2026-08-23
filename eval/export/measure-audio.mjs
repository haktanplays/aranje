/**
 * Runs the 2M-A export render cases in a real Chromium and writes what they
 * measured (spec 13.19 §6, §11, §16, §17).
 *
 * The bundle is loaded into a page served by the running app, so the sample
 * URLs resolve exactly as they do in the product and the render is the one
 * the export button performs. Every number is peak/RMS off rendered samples,
 * or a field read back out of the encoded WAV header.
 *
 *   npx vite build --config eval/export/vite.render.config.mts
 *   npx next start -p 3100
 *   node eval/export/measure-audio.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/export";
mkdirSync(OUT, { recursive: true });

const bundle = readFileSync("eval/export/.render/export-render.js", "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const names = await page.evaluate(() => window.AranjeExportRender.caseNames());
const results = {};
const timings = {};
for (const name of names) {
  process.stdout.write(`  rendering ${name} ... `);
  const started = Date.now();
  results[name] = await page.evaluate(
    (caseName) => window.AranjeExportRender.renderExportCase(caseName),
    name,
  );
  timings[name] = Date.now() - started;
  console.log(`ok (${timings[name]} ms)`);
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

/* The file is the format it promises. */
const format = at("level-0");
claim(
  "the encoded file is stereo 44.1 kHz 16-bit with a header that matches it",
  format.wavChannels === 2 &&
    format.wavSampleRate === 44100 &&
    format.wavBitDepth === 16 &&
    format.headerMatchesFile &&
    Object.values(results).every((entry) => entry.headerMatchesFile),
  `${format.wavChannels}ch ${format.wavSampleRate}Hz ${format.wavBitDepth}bit, ` +
    `data ${format.wavDataBytes} + 44 = ${format.wavBytes}`,
);

/* Persisted level reaches the file. */
const drop6 = db(at("level--6").rms, at("level-0").rms);
const drop12 = db(at("level--12").rms, at("level-0").rms);
claim(
  "the persisted track volume is what the file carries",
  Math.abs(drop6 + 6) < 1 && Math.abs(drop12 + 12) < 1,
  `-6 dB measured ${round(drop6)} dB, -12 dB measured ${round(drop12)} dB`,
);

/* Persisted stereo position reaches the file. */
const centre = at("pan-centre");
const left = at("pan-left");
const right = at("pan-right");
claim(
  "the persisted stereo position is what the file carries",
  Math.abs(db(centre.leftRms, centre.rightRms)) < 0.5 &&
    left.leftRms > left.rightRms * 4 &&
    right.rightRms > right.leftRms * 4,
  `centre L-R ${round(db(centre.leftRms, centre.rightRms))} dB, ` +
    `left L-R ${round(db(left.leftRms, left.rightRms))} dB, ` +
    `right L-R ${round(db(right.leftRms, right.rightRms))} dB`,
);

/* Articulation is audible in the WAV — the thing MIDI cannot carry. */
const hammer = at("expressive-hammer");
const plain = at("expressive-plain");
claim(
  "an expressive articulation is heard in the audio, not merely planned",
  hammer.rms > plain.rms && hammer.peak > 1e-3,
  `hammered rms ${hammer.rms}, plain rms ${plain.rms}`,
);

/* The two content choices differ, and only where they should. */
const all = at("scope-all-tracks");
const mutedGuitar = at("scope-audible-muted-guitar");
const soloGuitar = at("scope-audible-solo-guitar");
claim(
  "'Şu anda duyduklarım' drops a muted track from the file",
  mutedGuitar.rms < all.rms && mutedGuitar.rms > 0,
  `all ${all.rms}, guitar muted ${mutedGuitar.rms}`,
);
claim(
  "'Şu anda duyduklarım' keeps only a soloed track",
  soloGuitar.rms < all.rms &&
    soloGuitar.rms > 0 &&
    soloGuitar.rms !== mutedGuitar.rms,
  `all ${all.rms}, guitar alone ${soloGuitar.rms}, bass alone ${mutedGuitar.rms}`,
);
claim(
  "everything muted exports a valid silence, not a fallback",
  at("scope-all-muted").peak < 1e-4,
  `peak ${at("scope-all-muted").peak}`,
);

/* The full-mix export ignores the audition and the legacy flags entirely. */
const legacy = at("legacy-flags-full-mix");
claim(
  "a full-mix export ignores the phase-0 muted/soloed flags",
  Math.abs(legacy.rms - at("level-0").rms) < 1e-6 &&
    Math.abs(legacy.peak - at("level-0").peak) < 1e-6,
  `flagged rms ${legacy.rms} peak ${legacy.peak}, plain rms ${at("level-0").rms}`,
);

/* No metronome in the file, ever: a silent song exports silence. */
claim(
  "no metronome reaches the file",
  at("scope-all-muted").peak < 1e-4,
  `all-muted peak ${at("scope-all-muted").peak} (a click would show here)`,
);

/* Length: derived from the song, at the song's own tempo. */
const three = at("meter-3-4");
const seven = at("meter-7-8");
const six = at("meter-6-8");
const slower = at("tempo-section-override");
claim(
  "the file's length follows the metre and the tempo map",
  three.notatedSeconds < seven.notatedSeconds &&
    Math.abs(six.notatedSeconds - three.notatedSeconds) < 0.01 &&
    slower.notatedSeconds > three.notatedSeconds,
  `3/4 ${three.notatedSeconds}s, 6/8 ${six.notatedSeconds}s, ` +
    `7/8 ${seven.notatedSeconds}s, section 60 BPM ${slower.notatedSeconds}s`,
);
claim(
  "every file runs past its notated end by the central tail",
  Object.values(results).every(
    (entry) => entry.seconds >= entry.notatedSeconds + entry.tailSeconds - 0.01,
  ),
  `e.g. ${three.name}: notated ${three.notatedSeconds}s, file ${three.seconds}s`,
);

/*
 * The last note is not chopped.
 *
 * Measured in the window *after* the notated end: a long file proves nothing
 * on its own, because silence is long too. Sound there is the decay that a
 * fixed-duration render would have cut at the bar line.
 */
const held = at("tail-held-note");
claim(
  "the decay of a note still ringing at the bar line is inside the file",
  held.tailRms > 1e-4 && held.peak > 1e-3 && held.lastSecondRms < held.tailRms,
  `held note: overall rms ${held.rms}, after notated end ${held.tailRms}, ` +
    `final second ${held.lastSecondRms}`,
);

/* Nothing is left sounding after the render's graph is torn down. */
claim(
  "no voice is left sounding after dispose",
  Object.values(results).every((entry) => entry.activeAfterDispose === 0),
  `active after dispose: ${[
    ...new Set(Object.values(results).map((entry) => entry.activeAfterDispose)),
  ].join(",")}`,
);

claim("the page stayed quiet", errors.length === 0, errors.slice(0, 2).join(" | "));

const failed = checks.filter((entry) => !entry.pass);
writeFileSync(
  `${OUT}/AUDIO.json`,
  `${JSON.stringify(
    {
      honesty: [
        "Bu ölçümler gain/pan/audibility/format doğruluğudur; müzikal mix kalitesi kanıtı değildir.",
        "Masaüstü Chromium offline render'ıdır; fiziksel telefon kanıtı değildir.",
      ],
      checks,
      failed: failed.length,
      renderMillis: timings,
      measurements: results,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n${checks.length - failed.length}/${checks.length} audio claims hold`);
process.exit(failed.length === 0 ? 0 : 1);
