/**
 * Where a tap's time actually goes (2R-A §5, §6).
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/practice-loop/profile-tap.mjs
 *
 * `measure-browser.mjs` times a tap from outside the page, with Playwright's
 * own actionability checks and round trips inside the stopwatch. That is fine
 * for a before/after of the same harness and useless for "is 33 ms reachable",
 * so this measures two things the outside number cannot separate:
 *
 *   1. The page's own interaction cost — dispatch to the frame after the
 *      commit, taken with `performance.now()` inside the page.
 *   2. A CPU profile over the same taps, aggregated by self time, so the cost
 *      can be attributed instead of assumed.
 *
 * The first run of 2R-A predicted the grid's per-cell scan was the bottleneck
 * and the measurement cleared it. This script exists so the next prediction
 * gets the same treatment.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture, VIEWPORTS } from "./device.mjs";
import { INSTRUMENT } from "../continuous-follow/instrument.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/practice-loop";
const NAME = process.env.OUT_NAME ?? "TAP-PROFILE";
/*
 * 60, not 24.
 *
 * A p95 over 24 samples is the 22nd or 23rd of them, which one garbage
 * collection decides. Six runs at 24 rounds put `practiceSong`'s p95 anywhere
 * between 36,2 and 57,3 ms — a spread wide enough to straddle the target and
 * report either answer. At 60 rounds the same six runs land between 32,0 and
 * 49,8. The median never moved: 30,8–31,5 throughout.
 */
const ROUNDS = Number(process.env.ROUNDS ?? 60);
mkdirSync(OUT, { recursive: true });

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

function stats(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    count: sorted.length,
    median: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

/**
 * One tap, timed by the page.
 *
 * `click()` dispatches synchronously; React's work lands in a task after it,
 * and the pixels land on the frame after that. Two nested rAFs is therefore
 * the first moment at which the new grid has actually been painted — the same
 * boundary "interaction to next paint" uses, without needing an INP entry to
 * have been recorded.
 */
const tapOnce = (page, index) =>
  page.evaluate((nth) => {
    const cells = document.querySelectorAll("[data-drum-cell]");
    const cell = cells[nth % cells.length];
    if (!cell) return null;
    const start = performance.now();
    cell.click();
    return new Promise((resolve) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve(performance.now() - start)),
      );
    });
  }, index);

/** Self time per function, so the answer names a file rather than a feeling. */
function attribute(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const total = profile.samples.length;
  for (const id of profile.samples) {
    self.set(id, (self.get(id) ?? 0) + 1);
  }
  const rows = [];
  for (const [id, count] of self) {
    const node = byId.get(id);
    if (!node) continue;
    const frame = node.callFrame;
    rows.push({
      name: frame.functionName || "(anonymous)",
      url: (frame.url || "").replace(/^https?:\/\/[^/]+/, ""),
      line: frame.lineNumber,
      samples: count,
      shareOfSamples: round(count / Math.max(1, total), 4),
    });
  }
  rows.sort((a, b) => b.samples - a.samples);
  return { totalSamples: total, top: rows.slice(0, 20) };
}

/*
 * Two fixtures, because one number cannot say what a tap's cost is made of.
 *
 * `denseKit` is the contract's ceiling; `practiceSong` is a small song with
 * the same kit grid on screen. If the tap costs the same on both, the cost is
 * the grid; if it tracks the song, the cost is the per-edit chain that every
 * edit in the app pays — and that chain is not something §6 is allowed to
 * weaken.
 */
async function measure(browser, viewport, fixtureName) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries, instrument]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(instrument);
    },
    [Object.entries(device(fixture(fixtureName))), INSTRUMENT],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });

  await page.getByTestId("view-tab").click();
  await page.waitForSelector("[data-track-control]", { timeout: 10000 });
  await page.locator("[data-track-control]").click();
  await page.locator("[data-track-option]", { hasText: "Davul" }).first().click();
  await page.waitForTimeout(200);
  await page.locator("[data-action-row] button", { hasText: /^Düzenle$/ }).click();
  await page.waitForSelector("[data-drum-cell]", { timeout: 10000 });

  const mounted = await page.evaluate(() => ({
    cells: document.querySelectorAll("[data-drum-cell]").length,
    nodes: document.querySelectorAll("*").length,
  }));

  // Warm up: the first taps pay for lazily compiled code, not for the grid.
  await tapOnce(page, 0);
  await tapOnce(page, 1);

  const inPage = [];
  for (let index = 0; index < ROUNDS; index += 1) {
    const sample = await tapOnce(page, index + 2);
    if (sample !== null) inPage.push(sample);
  }

  const session = await context.newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");
  for (let index = 0; index < ROUNDS; index += 1) {
    await tapOnce(page, index + 2 + ROUNDS);
  }
  const { profile } = await session.send("Profiler.stop");
  await session.send("Profiler.disable");

  await context.close();
  return {
    fixture: fixtureName,
    viewport: viewport.name,
    mounted,
    inPageTapMs: stats(inPage),
    profile: attribute(profile),
    consoleErrors: errors.slice(0, 3),
  };
}

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const CASES = [
  [VIEWPORTS[0], "denseKit"],
  [VIEWPORTS[1], "denseKit"],
  [VIEWPORTS[0], "practiceSong"],
];
const results = [];
for (const [viewport, fixtureName] of CASES) {
  const measured = await measure(browser, viewport, fixtureName);
  results.push(measured);
  console.log(
    `${fixtureName} @ ${viewport.name}: ${measured.mounted.cells} hücre mount, ` +
      `sayfa içi dokunuş ${measured.inPageTapMs?.median} ms medyan / ` +
      `${measured.inPageTapMs?.p95} p95`,
  );
  for (const row of measured.profile.top.slice(0, 6)) {
    console.log(`    ${String(row.shareOfSamples * 100).padStart(5)}%  ${row.name}  ${row.url}`);
  }
}
await browser.close();

writeFileSync(
  `${OUT}/${NAME}.json`,
  `${JSON.stringify(
    {
      what: "2R-A §5/§6 — bir dokunuşun maliyetinin sayfa içinden ölçümü ve dağılımı",
      measuredOn: "masaüstü Chromium, gerçek production build — fiziksel telefon değil",
      method:
        `2 ısınma turundan sonra ${ROUNDS} tur sayfa içi ölçüm ` +
        `(click → iki rAF), ardından aynı sayıda tur için 100 µs örnekleme ile CPU profili.`,
      notes: [
        "Playwright'ın click() maliyeti bu ölçümün dışında; DRUM-BASELINE/DRUM-AFTER içindeki sayı onu da içerir.",
        "shareOfSamples, profilin toplam örneği içindeki paydır — mutlak süre değil.",
        "src/ altında hiçbir dosya ölçüm için değiştirilmedi.",
        "denseKit sözleşme tavanı, practiceSong küçük bir şarkı: ikisi aynı ızgarayı açar.",
      ],
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${OUT}/${NAME}.json yazıldı`);
