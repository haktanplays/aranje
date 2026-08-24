/**
 * The browser half of the 2O-A performance report (§25).
 *
 * Three things only a real page can answer: how many DOM nodes a library of
 * n projects costs, how long the app takes to settle its storage before the
 * first paint, and what this browser's `localStorage` actually accepts.
 *
 * These are **desktop Chromium** numbers on this machine. They are not phone
 * measurements and are not evidence about one. The quota figure in particular
 * is a property of this browser and this profile: it is reported as an
 * observation, never as a guarantee about what a device will hold.
 *
 *   npm run build && npx next start -p 3100
 *   npx tsx eval/projects/measure.ts
 *   node eval/projects/measure-browser.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

import { libraryDevice } from "./seeds.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const REPORT = "eval/projects/artifacts/PERFORMANCE.json";

const browser = await chromium.launch();

async function withLibrary(count, run) {
  const titles = Array.from({ length: count }, (_, index) => `Proje ${index + 1}`);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript((entries) => {
    try {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    } catch {
      /* nothing to do */
    }
    window.__t0 = performance.now();
  }, Object.entries(libraryDevice(titles)));
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-projects]");
  await page.waitForTimeout(900);
  const result = await run(page);
  await context.close();
  return result;
}

const scale = {};
for (const count of [1, 5, 20, 50]) {
  scale[`${count} projects`] = await withLibrary(count, async (page) => {
    const before = await page.evaluate(() => document.querySelectorAll("*").length);
    await page.waitForTimeout(50);
    /*
     * Click to *rows on screen*, not click to click.
     *
     * React renders asynchronously, so subtracting a fixed wait from a click
     * measures the click and nothing else. This waits for the row count the
     * library is supposed to show and stops there.
     */
    const opened = await page.evaluate(async (expected) => {
      const start = performance.now();
      document.querySelector("[data-open-projects]").click();
      for (let guard = 0; guard < 600; guard += 1) {
        if (document.querySelectorAll("[data-project-row]").length >= expected) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return performance.now() - start;
    }, count);
    const after = await page.evaluate(() => document.querySelectorAll("*").length);
    return {
      domNodesBeforeList: before,
      domNodesWithList: after,
      domNodesAddedByList: after - before,
      /** Click to the rows being on screen. One sample, so read the shape. */
      openToRowsOnScreenMs: Number(opened.toFixed(1)),
      rows: await page.locator("[data-project-row]").count(),
    };
  });
}

/* --------------------------------------------------- what the browser takes */

const quota = await withLibrary(1, async (page) =>
  page.evaluate(async () => {
    /*
     * How much this browser accepts, found by asking. One 760 KiB block per
     * step — the size of the worst-case project record — until it refuses.
     */
    const block = "x".repeat(760 * 1024);
    const keys = [];
    let accepted = 0;
    try {
      for (let index = 0; index < 40; index += 1) {
        const key = `aranje.__quota-probe-${index}`;
        localStorage.setItem(key, block);
        keys.push(key);
        accepted += 1;
      }
    } catch {
      /* The refusal is the measurement. */
    }
    for (const key of keys) localStorage.removeItem(key);
    const estimate = navigator.storage?.estimate
      ? await navigator.storage.estimate()
      : null;
    return {
      worstCaseProjectsAccepted: accepted,
      blockBytes: block.length,
      note:
        accepted >= 40
          ? "stopped at the probe's own ceiling, not the browser's"
          : "the browser refused here",
      navigatorEstimate: estimate
        ? { quota: estimate.quota ?? null, usage: estimate.usage ?? null }
        : null,
    };
  }),
);

await browser.close();

const report = JSON.parse(readFileSync(REPORT, "utf8"));
report.browser = {
  measuredOn: "desktop Chromium — not a phone, and not evidence about one",
  base: BASE,
  scale,
  quota: {
    ...quota,
    warning:
      "an observation about this browser and profile, never a guarantee about a device",
  },
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.browser, null, 2));
