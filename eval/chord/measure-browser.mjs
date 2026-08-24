/**
 * The Chromium half of the 2O-B performance report (spec 13.22 §28).
 *
 * What a reader actually waits for: the sheet opening, a root and a quality
 * landing, the shapes being drawn, and the round trip from Apply back to a
 * stored song. Measured through the real production build, with the real
 * storage underneath.
 *
 *   npm run build && npx next start -p 3100
 *   node eval/chord/measure-browser.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, guitarTrack, song } from "./seeds.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/chord/artifacts";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

await page.addInitScript(
  ([seed]) => {
    window.__audioContexts = 0;
    window.__sampleRequests = 0;
    for (const key of ["AudioContext", "webkitAudioContext"]) {
      const Original = window[key];
      if (!Original) continue;
      window[key] = new Proxy(Original, {
        construct(target, args) {
          window.__audioContexts += 1;
          return Reflect.construct(target, args);
        },
      });
    }
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = String(typeof input === "string" ? input : (input?.url ?? ""));
      if (url.includes("/samples/")) window.__sampleRequests += 1;
      return original(input, init);
    };
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
  },
  /*
   * `high_gain` rather than the template's `clean`: only three packs are
   * vendored and `clean` is not one of them, so a `clean` track makes no
   * sound and the audition rows would be timing an empty graph. See
   * artifacts/FINDINGS.json — that gap is a real defect, and it is reported
   * rather than measured around.
   */
  [device(song([guitarTrack({ presetId: "high_gain" })], { bars: 2 }))],
);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-open-projects]");
await page.waitForTimeout(800);

/** Time one interaction, from the click to the thing it produces. */
async function timed(label, run, rounds = 12) {
  const runs = [];
  for (let index = 0; index < rounds; index += 1) {
    const started = Date.now();
    await run(index);
    runs.push(Date.now() - started);
  }
  runs.sort((a, b) => a - b);
  return {
    label,
    rounds,
    medianMs: runs[Math.floor(runs.length / 2)],
    p95Ms: runs[Math.min(runs.length - 1, Math.floor(runs.length * 0.95))],
    maxMs: runs[runs.length - 1],
  };
}

await page.locator('[data-testid="view-tab"]').click().catch(() => {});
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Düzenle", exact: true }).click();
await page.waitForTimeout(300);

const measurements = [];

measurements.push(
  await timed("builder açılışı (hücre → sheet)", async () => {
    await page.locator('[data-cell="0:1"]').first().click();
    await page.waitForSelector("[data-fret-chord]");
    await page.locator("[data-fret-chord]").click();
    await page.waitForSelector("[data-chord-roots]");
    await page.locator("[data-chord-cancel]").click();
    await page.waitForTimeout(120);
  }),
);

await page.locator('[data-cell="0:1"]').first().click();
await page.waitForSelector("[data-fret-chord]");
await page.locator("[data-fret-chord]").click();
await page.waitForSelector("[data-chord-roots]");

measurements.push(
  await timed("kök seçimi", async (index) => {
    await page.locator(`[data-testid="chord-root-${index % 12}"]`).click();
    await page.waitForSelector("[data-chord-qualities]");
    await page.locator('[data-testid="chord-step-root"]').click();
    await page.waitForSelector("[data-chord-roots]");
  }),
);

await page.locator('[data-testid="chord-root-9"]').click();
await page.waitForSelector("[data-chord-qualities]");

const QUALITIES = [
  "major",
  "minor",
  "dominant_7",
  "major_7",
  "minor_7",
  "sus2",
  "sus4",
  "diminished",
  "augmented",
  "half_diminished_7",
];

measurements.push(
  await timed("kalite seçimi ve şekil listesinin çizilmesi", async (index) => {
    await page.locator('[data-testid="chord-step-quality"]').click();
    await page.waitForSelector("[data-chord-qualities]");
    await page.locator(`[data-testid="chord-quality-${QUALITIES[index % QUALITIES.length]}"]`).click();
    await page.waitForSelector("[data-chord-voicings]");
  }),
);

await page.locator('[data-testid="chord-step-quality"]').click();
await page.locator('[data-testid="chord-quality-minor_7"]').click();
await page.waitForSelector("[data-chord-voicings]");

const ids = await page
  .locator("[data-chord-voicing]")
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-chord-voicing")));

measurements.push(
  await timed(
    "25 varyasyon değişimi",
    async (index) => {
      await page.locator(`[data-chord-select="${ids[index % ids.length]}"]`).click();
      await page.waitForTimeout(30);
    },
    25,
  ),
);

const audioBefore = await page.evaluate(() => window.__audioContexts);
const samplesBefore = await page.evaluate(() => window.__sampleRequests);

measurements.push(
  await timed(
    "25 sesli dinleme",
    async (index) => {
      await page.locator(`[data-chord-audition="${ids[index % ids.length]}"]`).click();
      await page.waitForTimeout(60);
    },
    25,
  ),
);

const audioAfter = await page.evaluate(() => window.__audioContexts);
const samplesAfter = await page.evaluate(() => window.__sampleRequests);

const sheet = await page.evaluate(() => ({
  nodes: document.querySelectorAll("[data-chord-sheet] *").length,
  height: document.querySelector("[data-chord-sheet]")?.getBoundingClientRect().height ?? 0,
}));

measurements.push(
  await timed(
    "uygula → depoda akor (round trip)",
    async () => {
      await page.locator("[data-chord-apply]").click();
      await page.waitForFunction(() => {
        const raw = localStorage.getItem("aranje.project.project-1");
        if (!raw) return false;
        const slot = JSON.parse(raw).current.sections[0].bars[0].slots.gtr[0];
        return slot && slot !== "-" && slot.notes.length > 1;
      });
      // Put it back for the next round.
      await page.getByRole("button", { name: /^Geri al/ }).click();
      await page.waitForTimeout(120);
      await page.locator('[data-cell="0:1"]').first().click();
      await page.waitForSelector("[data-fret-chord]");
      await page.locator("[data-fret-chord]").click();
      await page.locator('[data-testid="chord-root-9"]').click();
      await page.locator('[data-testid="chord-quality-minor_7"]').click();
      await page.waitForSelector("[data-chord-voicings]");
    },
    6,
  ),
);

await page.locator("[data-chord-apply]").click();
await page.waitForTimeout(500);

measurements.push(
  await timed(
    "geri al / yinele",
    async () => {
      await page.getByRole("button", { name: /^Geri al/ }).click();
      await page.waitForTimeout(90);
      await page.getByRole("button", { name: /^Yinele/ }).click();
      await page.waitForTimeout(90);
    },
    8,
  ),
);

await browser.close();

const artefact = {
  measuredOn: "desktop Chromium — not a phone, and not evidence about one",
  note:
    "Wall-clock through the real build, so each number includes the click, " +
    "the render and the wait for what it produced. Nothing here is a promise " +
    "about a phone.",
  measurements,
  sheet,
  audio: {
    contextsBeforeAuditions: audioBefore,
    contextsAfterAuditions: audioAfter,
    sampleRequestsBefore: samplesBefore,
    sampleRequestsAfter: samplesAfter,
  },
  consoleErrors: errors,
};

writeFileSync(`${OUT}/PERFORMANCE-BROWSER.json`, `${JSON.stringify(artefact, null, 2)}\n`);
for (const entry of measurements) {
  console.log(
    `${entry.label.padEnd(42)} median ${String(entry.medianMs).padStart(6)} ms  p95 ${String(entry.p95Ms).padStart(6)}  max ${String(entry.maxMs).padStart(6)}`,
  );
}
console.log("sheet", sheet);
console.log("audio", artefact.audio);
console.log("errors", errors.length);
