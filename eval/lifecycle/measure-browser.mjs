/**
 * The browser half of the 2L-B performance report: the real
 * `localStorage.setItem` of the envelope a single lifecycle commit writes,
 * in a production Chromium on this desktop, merged into `PERFORMANCE.json`
 * next to the Node numbers.
 *
 * This is a **desktop Chromium** data point and is labelled as one. It is
 * not a phone measurement; Android/iOS latency stays open at the release
 * gate. The benchmark key never touches `aranje.song` and is removed
 * afterwards.
 *
 *   1. next build && next start on :3100 (or BASE_URL)
 *   2. NODE_OPTIONS=--expose-gc npx tsx eval/lifecycle/measure.ts
 *   3. node eval/lifecycle/measure-browser.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const REPORT = "eval/lifecycle/PERFORMANCE.json";

const ROUNDS = 30;
const WARMUP = 5;

const envelope = readFileSync(
  join(tmpdir(), "aranje-2lb-commit-envelope.json"),
  "utf8",
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

const result = await page.evaluate(
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

    const KEY = "aranje.bench.lifecycle-envelope";
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

await browser.close();

const report = JSON.parse(readFileSync(REPORT, "utf8"));
report.chromium = {
  honesty: [
    "Bu bölümdeki sayılar masaüstü Chromium ölçümüdür; fiziksel telefon kanıtı değildir.",
  ],
  lifecycleCommitEnvelopeSetItem: result,
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log("PERFORMANCE.json merged (chromium half):", JSON.stringify(result.write));
