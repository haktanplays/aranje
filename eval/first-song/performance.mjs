/**
 * What the loop costs on a song at the pilot's limit (2V-E.1 §27).
 *
 * No blind millisecond gate. Each figure is a p50 and a p95 over repeated
 * samples, beside the fixture it was measured on and the machine it ran on,
 * so a later round can compare like with like instead of arguing with a
 * number nobody can reproduce.
 *
 * Everything here runs in the **browser**, on the production route, because
 * that is where the cost lands. A node figure would be a different quantity
 * and is not mixed in.
 *
 *   BASE=http://127.0.0.1:3134 node eval/first-song/performance.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";

const BASE = process.env.BASE ?? "http://127.0.0.1:3134";
const OUT = "eval/first-song/artifacts";
const SAMPLES = Number(process.env.SAMPLES ?? 7);
mkdirSync(OUT, { recursive: true });

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[index] * 10) / 10;
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.setDefaultTimeout(15000);

const press = async (s) => {
  await page.locator(s).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(200);
};

/*
 * The sampled paths use this instead: a click and nothing else.
 *
 * `press` sleeps 200 ms so the *setup* is reliable, and a sample that
 * contained that sleep would report the harness's patience as the app's
 * cost. The first run of this file did exactly that — every figure sat
 * between 717 and 917 ms, which is the shape of a fixed delay rather than of
 * six different amounts of work.
 */
const tap = (s) => page.locator(s).first().click({ timeout: 6000 }).catch(() => {});

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await press("[data-home-start]");
await page.waitForTimeout(700);

/*
 * The fixture: the song grown to the pilot's own ceiling through the domain
 * the app itself uses, then written back through the same storage key the
 * app reads. Not a hand-built JSON blob — a song this build would accept.
 */
const fixture = await page.evaluate(() => {
  let key = null;
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k?.startsWith("aranje.project.")) key = k;
  }
  if (key === null) return null;
  const record = JSON.parse(localStorage.getItem(key));
  const song = record.current;
  const shape = song.sections[0];
  const bar = shape.bars[0];
  const trackId = song.tracks[0].id;

  /* A bar with a note in every slot, on every track. */
  const dense = (tracks) => ({
    ...bar,
    slots: Object.fromEntries(
      tracks.map((id) => [
        id,
        Array.from({ length: bar.resolution }, (_, s) =>
          s % 2 === 0 ? { notes: [{ pitch: "E2" }] } : null,
        ),
      ]),
    ),
  });

  /* Eight tracks, and 64 bars split into eight sections of eight. */
  const tracks = [song.tracks[0]];
  for (let n = 2; n <= 8; n += 1) {
    tracks.push({ ...song.tracks[0], id: `track-${n}`, name: `Gitar ${n}` });
  }
  const ids = tracks.map((t) => t.id);
  const sections = Array.from({ length: 8 }, (_, i) => ({
    ...shape,
    id: `section-${i + 1}`,
    name: `Bölüm ${i + 1}`,
    bars: Array.from({ length: 8 }, () => dense(ids)),
  }));

  const big = { ...song, tracks, sections };
  localStorage.setItem(key, JSON.stringify({ ...record, current: big }));
  return {
    key,
    tracks: tracks.length,
    sections: sections.length,
    bars: sections.reduce((n, s) => n + s.bars.length, 0),
    notes: sections.reduce(
      (n, s) =>
        n +
        s.bars.reduce(
          (m, b) =>
            m +
            Object.values(b.slots).reduce(
              (k, row) => k + row.filter((slot) => slot !== null).length,
              0,
            ),
          0,
        ),
      0,
    ),
    bytes: JSON.stringify(big).length,
    trackId,
  };
});

if (fixture === null) throw new Error("no project to grow");
console.log(
  `fixture: ${fixture.tracks} tracks · ${fixture.sections} sections · ${fixture.bars} bars · ` +
    `${fixture.notes} notes · ${(fixture.bytes / 1024).toFixed(1)} KiB`,
);

const measurements = {};
/** `after` runs between samples and is deliberately not timed. */
const sample = async (name, body, after) => {
  const times = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const started = Date.now();
    await body();
    times.push(Date.now() - started);
    if (after) await after();
  }
  measurements[name] = { p50: percentile(times, 50), p95: percentile(times, 95), samples: times };
  console.log(`  ${name}: p50 ${measurements[name].p50} ms, p95 ${measurements[name].p95} ms`);
};

console.log(`\nbrowser measurements, ${SAMPLES} samples each\n`);

await sample("cold load of the big song, to first notation", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-tab-content], [data-arrangement-scroller]").first().waitFor();
});

await sample("switch to the arrangement", async () => {
  await tap("[data-testid='view-arrange']");
  await page.locator("[data-arr-cell]").first().waitFor();
  await tap("[data-testid='view-tab']");
  await page.locator("[data-tab-content]").waitFor();
});

await sample("switch to the multi view", async () => {
  await tap("[data-testid='view-multi']");
  await page.locator("[data-string-line]").first().waitFor();
  await tap("[data-testid='view-tab']");
  await page.locator("[data-tab-content]").waitFor();
});

await sample("open the section manager on eight sections", async () => {
  await tap("[data-section-nav] button:nth-child(2)");
  await tap("[data-section-manage]");
  await page.locator("[data-section-row]").first().waitFor();
}, async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
});

await sample("open the track manager on eight tracks", async () => {
  await tap("[data-track-control]");
  await tap("[data-track-manage]");
  await page.locator("[data-track-row]").first().waitFor();
}, async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
});

await sample("go Home and back into the song", async () => {
  await tap("[data-open-projects]");
  await page.locator("[data-home-card]").first().waitFor();
  await tap("[data-home-card]");
  await page.locator("[data-tab-content], [data-arrangement-scroller]").first().waitFor();
});

const artefact = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  where: "browser (Chromium, Playwright), production route",
  machine: `${os.platform()} ${os.arch()}, ${os.cpus().length} cores`,
  note:
    "Browser figures only. Node-side timings are a different quantity and are " +
    "deliberately not mixed into this table.",
  fixture,
  samples: SAMPLES,
  measurements,
  pageErrors: errors,
};
writeFileSync(`${OUT}/PERFORMANCE.json`, `${JSON.stringify(artefact, null, 2)}\n`);
console.log(`\npage errors: ${errors.length}`);
await browser.close();
