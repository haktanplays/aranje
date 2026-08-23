/**
 * The Chromium half of the 2L-C performance report (spec 13.18 §17): the
 * real `localStorage.setItem` of the envelope one mixer apply writes, and
 * the sample traffic a mix commit causes in a running page.
 *
 * These are **desktop Chromium** numbers and are labelled as such — not a
 * phone measurement; Android/iOS latency stays open at the release gate.
 * The benchmark key never touches `aranje.song` and is removed afterwards.
 *
 *   1. next build && next start on :3100 (or BASE_URL)
 *   2. NODE_OPTIONS=--expose-gc npx tsx eval/mixer/measure.ts
 *   3. node eval/mixer/measure-browser.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const REPORT = "eval/mixer/PERFORMANCE.json";

const ROUNDS = 25;
const WARMUP = 5;

const envelope = readFileSync(
  join(tmpdir(), "aranje-2lc-mix-envelope.json"),
  "utf8",
);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();

/* What the page asks the network for, so a mix commit's traffic is counted. */
const sampleRequests = [];
page.on("request", (request) => {
  if (request.url().includes("/samples/")) sampleRequests.push(request.url());
});

await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-arrangement-scroller]");

const setItem = await page.evaluate(
  ({ envelope, ROUNDS, WARMUP }) => {
    const bench = (run) => {
      for (let i = 0; i < WARMUP; i += 1) run();
      const samples = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        const start = performance.now();
        run();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const at = (q) =>
        samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)] ?? 0;
      const round = (v) => Number(v.toFixed(3));
      return {
        rounds: samples.length,
        medianMs: round(at(0.5)),
        p95Ms: round(at(0.95)),
        maxMs: round(samples[samples.length - 1] ?? 0),
      };
    };

    const KEY = "aranje.bench.mix-envelope";
    const mainBefore = localStorage.getItem("aranje.song");
    const write = bench(() => localStorage.setItem(KEY, envelope));
    localStorage.removeItem(KEY);
    return {
      codeUnits: envelope.length,
      write,
      songKeyUntouched: localStorage.getItem("aranje.song") === mainBefore,
    };
  },
  { envelope, ROUNDS, WARMUP },
);

/*
 * The engine is built by playing, so the sample traffic below is the traffic
 * of a real graph. Then the mixer moves a level and applies it, and the same
 * counters are read again: §7 says a mix change costs no new engine and no
 * re-decoded sample, and this is that promise as two numbers.
 */
await page.locator("[aria-label='Çal']").click();
await page.waitForTimeout(1500);
await page.locator("[aria-label='Duraklat']").click();
await page.waitForTimeout(400);

const samplesAfterBuild = sampleRequests.length;

await page.locator("[data-open-mixer]").click();
await page.waitForSelector("[data-mixer-sheet]");

const slider = page.locator("[data-mixer-volume]").first();
const stageStart = Date.now();
for (let index = 0; index < ROUNDS; index += 1) {
  await slider.fill(String(-6 - (index % 12) * 0.5));
}
const stageMs = Date.now() - stageStart;

const applyStart = Date.now();
await page.locator("[data-mixer-apply]").click();
await page.waitForTimeout(400);
const applyMs = Date.now() - applyStart;

const mixCommit = {
  stagedSliderMoves: ROUNDS,
  stagedTotalMs: stageMs,
  applyRoundTripMs: applyMs,
  samplesAfterEngineBuild: samplesAfterBuild,
  samplesAfterMixCommit: sampleRequests.length,
  note:
    "Fill + apply süreleri Playwright'ın tur süresi dahildir; alt sınır değil üst sınırdır.",
};

await browser.close();

const report = JSON.parse(readFileSync(REPORT, "utf8"));
report.chromium = {
  honesty: [
    "Bu bölümdeki sayılar masaüstü Chromium ölçümüdür; fiziksel telefon kanıtı değildir.",
  ],
  mixCommitEnvelopeSetItem: setItem,
  mixCommit,
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log("PERFORMANCE.json merged (chromium half):", JSON.stringify(mixCommit));
