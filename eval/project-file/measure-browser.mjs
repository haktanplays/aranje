/**
 * The browser half of the 2L-A performance report: real `localStorage.setItem`
 * of the full durable envelope, Object-URL create/revoke, and a controlled
 * Chromium heap delta for the 51-snapshot history — all in a production
 * Chromium on this desktop, merged into `PERFORMANCE.json` next to the Node
 * numbers.
 *
 * This is a **desktop Chromium** data point and is labelled as one. It is not
 * a phone measurement; Android/iOS latency stays open at the release gate.
 * The benchmark keys never touch `aranje.song`, and are removed afterwards.
 *
 *   1. next build && next start on :3100 (or BASE_URL)
 *   2. NODE_OPTIONS=--expose-gc npx tsx eval/project-file/measure.ts
 *   3. node eval/project-file/measure-browser.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const PAYLOAD_DIR = process.env.PAYLOAD_DIR ?? tmpdir();
const REPORT = "eval/project-file/PERFORMANCE.json";

const ROUNDS = 30;
const WARMUP = 5;

const payloads = {
  worstEnvelope: readFileSync(join(PAYLOAD_DIR, "aranje-perf-worst-envelope.json"), "utf8"),
  demoEnvelope: readFileSync(join(PAYLOAD_DIR, "aranje-perf-demo-envelope.json"), "utf8"),
  worstProject: readFileSync(join(PAYLOAD_DIR, "aranje-perf-worst-project.json"), "utf8"),
  demoProject: readFileSync(join(PAYLOAD_DIR, "aranje-perf-demo-project.json"), "utf8"),
};

const browser = await chromium.launch({
  args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
});
const page = await browser.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

const result = await page.evaluate(
  ({ payloads, ROUNDS, WARMUP }) => {
    const stats = (samples) => {
      const sorted = [...samples].sort((a, b) => a - b);
      const at = (q) =>
        sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
      const round = (v) => Number(v.toFixed(3));
      return {
        rounds: sorted.length,
        medianMs: round(at(0.5)),
        p95Ms: round(at(0.95)),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
      };
    };

    const bench = (run) => {
      for (let i = 0; i < WARMUP; i += 1) run();
      const samples = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        const start = performance.now();
        run();
        samples.push(performance.now() - start);
      }
      return stats(samples);
    };

    // The real song key stays byte-identical throughout — measured, not hoped.
    const KEY = "aranje.bench.envelope";
    const mainBefore = localStorage.getItem("aranje.song");

    const setItem = {};
    for (const [name, value] of [
      ["worstEnvelope", payloads.worstEnvelope],
      ["demoEnvelope", payloads.demoEnvelope],
    ]) {
      setItem[name] = {
        codeUnits: value.length,
        write: bench(() => localStorage.setItem(KEY, value)),
      };
      localStorage.removeItem(KEY);
    }
    localStorage.removeItem(KEY);

    const objectUrl = {};
    for (const [name, text] of [
      ["worstProject", payloads.worstProject],
      ["demoProject", payloads.demoProject],
    ]) {
      const blob = new Blob([text], { type: "application/json" });
      const made = [];
      objectUrl[name] = {
        create: bench(() => made.push(URL.createObjectURL(blob))),
        revoke: bench(() => {
          const url = made.pop();
          if (url) URL.revokeObjectURL(url);
        }),
      };
      for (const url of made) URL.revokeObjectURL(url);
    }

    /*
     * The heap half runs outside this evaluate, through CDP, because
     * `performance.memory.usedJSHeapSize` is quantized/frozen in current
     * Chromium and reports a delta of zero even for megabytes of retained
     * allocation. Here we only install the builder for it to call.
     */
    window.__buildHistory = () => {
      const base = JSON.parse(payloads.worstProject).song;
      const snapshots = [{ song: base }];
      let previous = base;
      for (let step = 0; step < 50; step += 1) {
        const sectionIndex = step % previous.sections.length;
        const barIndex = step % previous.sections[sectionIndex].bars.length;
        const next = {
          ...previous,
          sections: previous.sections.map((section, index) => {
            if (index !== sectionIndex) return section;
            return {
              ...section,
              bars: section.bars.map((bar, position) => {
                if (position !== barIndex) return bar;
                const trackId = Object.keys(bar.slots)[0];
                const slots = bar.slots[trackId];
                const first = slots[0];
                const edited =
                  first && first !== "-" && !Array.isArray(first)
                    ? { notes: [{ ...first.notes[0], velocity: 1 + (step % 126) }] }
                    : first;
                return {
                  ...bar,
                  slots: { ...bar.slots, [trackId]: [edited, ...slots.slice(1)] },
                };
              }),
            };
          }),
        };
        snapshots.push({ song: next });
        previous = next;
      }
      return snapshots;
    };

    const mainAfter = localStorage.getItem("aranje.song");
    return {
      setItem,
      objectUrl,
      songKeyUntouched: mainBefore === mainAfter,
      benchKeyRemoved: localStorage.getItem(KEY) === null,
    };
  },
  { payloads, ROUNDS, WARMUP },
);

/*
 * The 51-snapshot heap delta, via CDP: `Runtime.getHeapUsage` reports live
 * bytes where `performance.memory` is quantized to uselessness. Ten histories
 * are retained together so the per-history figure sits well above noise, and
 * a `HeapProfiler.collectGarbage` runs on both sides of the region.
 */
const cdp = await page.context().newCDPSession(page);
await cdp.send("HeapProfiler.enable");

await cdp.send("HeapProfiler.collectGarbage");
const { usedSize: heapBefore } = await cdp.send("Runtime.getHeapUsage");
await page.evaluate(() => {
  window.__histories = [];
  for (let copy = 0; copy < 10; copy += 1) {
    window.__histories.push(window.__buildHistory());
  }
});
await cdp.send("HeapProfiler.collectGarbage");
const { usedSize: heapAfter } = await cdp.send("Runtime.getHeapUsage");
const snapshotCount = await page.evaluate(() => {
  const count = window.__histories[0].length;
  delete window.__histories;
  return count;
});
const perHistory = Math.round((heapAfter - heapBefore) / 10);

const report = JSON.parse(readFileSync(REPORT, "utf8"));
report.chromium = {
  browser: browser.version(),
  honesty: [
    "Bu bölümdeki sayılar masaüstü Chromium ölçümüdür; fiziksel telefon kanıtı değildir.",
  ],
  ...result,
  historyHeap: {
    snapshots: snapshotCount,
    amplification: 10,
    deltaBytes: perHistory,
    deltaMiB: Number((perHistory / (1024 * 1024)).toFixed(3)),
    note:
      "CDP Runtime.getHeapUsage delta per 51-snapshot history INCLUDING a fresh copy of the baseline song, averaged over 10 retained copies (single-bar edits, structural sharing); a controlled simulation, not the app itself, not a phone.",
  },
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.chromium, null, 2));
await browser.close();
