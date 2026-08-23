/**
 * The browser half of the 2N-A performance report (spec 13.20 §11).
 *
 * Two things only a real page can answer: how many DOM nodes the rhythm guide
 * adds, and whether switching between the arrangement and the tab builds a
 * second AudioContext. The display's frame rate is recorded beside them as a
 * baseline — the playhead loop's own counts are a different measurement and
 * live in `PLAYHEAD.json` (2N-A.1).
 *
 * These are **desktop Chromium** numbers on this machine and are labelled as
 * such. They are not phone measurements and are not evidence about one;
 * physical Android/iOS latency stays open at the release gate.
 *
 *   1. npm run build && npx next start -p 3100   (or BASE_URL)
 *   2. npx tsx eval/tab/measure.ts
 *   3. node eval/tab/measure-browser.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

import { rhythmSong } from "./songs.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const REPORT = "eval/tab/PERFORMANCE.json";

const VIEWPORTS = [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
];

/** Counted before any app code runs, so nothing can be inferred from the UI. */
const INSTRUMENT = `
  window.__audioContexts = 0;
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args) {
        window.__audioContexts += 1;
        return Reflect.construct(target, args);
      },
    });
  }
`;

const browser = await chromium.launch();
const viewports = {};

for (const [label, size] of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* a private window is not a reason to fail the run */
      }
    },
    ["aranje.song", JSON.stringify(rhythmSong())],
  );
  await context.addInitScript(INSTRUMENT);

  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(500);

  /*
   * The guide's cost is counted on the guide's own subtree rather than by
   * diffing two builds. A group is one `role="img"` element plus one stem per
   * onset, the beam lines, and the triplet mark where there is one — so the
   * number below is exactly what 2N-A §7 added to the page, measured on the
   * thing it is about.
   */
  const dom = await page.evaluate(() => {
    const total = document.querySelectorAll("*").length;
    const groups = [...document.querySelectorAll('[aria-label^="Ritim grubu"]')];
    const added = groups.reduce(
      (sum, node) => sum + 1 + node.querySelectorAll("*").length,
      0,
    );
    return { totalNodes: total, guideGroups: groups.length, guideNodes: added };
  });

  /*
   * The **display's** frame rate, and nothing else (corrected in 2N-A.1).
   *
   * This number was previously reported as "playhead rAF", which it never
   * was: `requestAnimationFrame` fires about sixty times a second on any page,
   * including one where nothing has asked for a frame, so counting our own
   * frames measures the screen rather than the app. It is kept because it is
   * the baseline the hook's own counts are read against — never as a playhead
   * figure. Those live in `PLAYHEAD.json`, taken at the hook seam.
   */
  const rafIdle = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start < 1000) requestAnimationFrame(tick);
          else resolve(Number((frames / ((performance.now() - start) / 1000)).toFixed(1)));
        };
        requestAnimationFrame(tick);
      }),
  );

  await page.getByRole("button", { name: /Çal/ }).first().click();
  await page.waitForTimeout(600);
  const rafPlaying = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start < 1000) requestAnimationFrame(tick);
          else resolve(Number((frames / ((performance.now() - start) / 1000)).toFixed(1)));
        };
        requestAnimationFrame(tick);
      }),
  );

  const audioAfterPlay = await page.evaluate(() => window.__audioContexts);

  /* A view switch and back: the graph is built once or not at all. */
  await page.locator('[data-testid="view-arrange"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(400);
  const audioAfterSwitch = await page.evaluate(() => window.__audioContexts);

  viewports[label] = {
    dom,
    displayFrames: {
      note: "the browser's own rAF rate — NOT the playhead loop; see PLAYHEAD.json",
      idlePerSecond: rafIdle,
      playingPerSecond: rafPlaying,
      unchangedByPlayback: Math.abs(rafIdle - rafPlaying) <= 3,
    },
    audioContexts: {
      afterPlay: audioAfterPlay,
      afterViewSwitch: audioAfterSwitch,
      unchangedAcrossSwitch: audioAfterPlay === audioAfterSwitch,
    },
  };

  await context.close();
}

await browser.close();

const report = JSON.parse(readFileSync(REPORT, "utf8"));
report.browser = {
  measuredOn: "desktop Chromium — not a phone, and not evidence about one",
  base: BASE,
  viewports,
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.browser, null, 2));
