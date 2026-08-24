/**
 * The browser half of the 2Q-A performance report (§17).
 *
 * Only a real page can answer these: how many DOM nodes eight lanes cost,
 * how long the first Çoklu open takes, what a view switch and a note edit
 * cost with the whole stack mounted, and how many animation frames, audio
 * contexts and sample requests exist while the reader moves between views.
 *
 * **Desktop Chromium on this machine**, and labelled as such throughout. Not
 * a phone measurement and not evidence about one; physical Android/iOS
 * latency stays open at the release gate.
 *
 *   1. ./eval/chord-audio/serve.sh
 *   2. npx tsx eval/multitrack/measure.ts
 *   3. node eval/multitrack/measure-browser.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

import { device, seed } from "./device.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const REPORT = "eval/multitrack/artifacts/PERFORMANCE.json";

const VIEWPORTS = [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
];

/**
 * Counted before the app's first line.
 *
 * `addEventListener` and `IntersectionObserver`/`ResizeObserver` are wrapped
 * rather than sampled, because "how many observers does this surface hold"
 * is a question about construction and there is no way to ask the DOM for it
 * afterwards.
 */
const INSTRUMENT = `
  window.__audioContexts = 0;
  window.__sampleRequests = 0;
  window.__listeners = 0;
  window.__observers = 0;
  window.__playheadProbe = { scheduled: {}, drawn: {}, live: {} };
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
  for (const name of ["IntersectionObserver", "ResizeObserver", "MutationObserver"]) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args) {
        window.__observers += 1;
        return Reflect.construct(target, args);
      },
    });
  }
  const addTarget = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    window.__listeners += 1;
    return addTarget.apply(this, args);
  };
  const removeTarget = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.removeEventListener = function (...args) {
    window.__listeners -= 1;
    return removeTarget.apply(this, args);
  };
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = String(typeof input === "string" ? input : (input && input.url) || "");
    if (url.indexOf("/samples/") !== -1) window.__sampleRequests += 1;
    return originalFetch.call(this, input, init);
  };
`;

const view = (page, id) => page.locator(`[data-testid="view-${id}"]`);
const round = (value) => Math.round(value * 100) / 100;

/** Median of a handful of samples, so one hiccup is not the number. */
const median = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / 2)] ?? 0);
};

/** How long until the page has actually painted the change. */
async function timed(page, run) {
  const start = await page.evaluate(() => performance.now());
  await run();
  return round(
    (await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => resolve(performance.now())),
        ),
    )) - start,
  );
}

const counts = (page) =>
  page.evaluate(() => ({
    domNodes: document.getElementsByTagName("*").length,
    laneNodes: [...document.querySelectorAll("[data-multi-lane]")].reduce(
      (sum, lane) => sum + lane.getElementsByTagName("*").length,
      0,
    ),
    lanes: document.querySelectorAll("[data-multi-lane]").length,
    listeners: window.__listeners,
    observers: window.__observers,
    audioContexts: window.__audioContexts,
    sampleRequests: window.__sampleRequests,
    liveFrames: Object.values(window.__playheadProbe.live).reduce(
      (sum, n) => sum + n,
      0,
    ),
    contentWidth: document.querySelector("[data-multi-content]")?.scrollWidth ?? 0,
    scrollerWidth: document.querySelector("[data-multi-scroll]")?.clientWidth ?? 0,
    bodyOverflowPx: Math.max(
      0,
      document.body.scrollWidth - document.body.clientWidth,
    ),
  }));

const browser = await chromium.launch();
const viewports = {};

for (const [label, size] of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(INSTRUMENT);
  await context.addInitScript(
    ([entries]) => {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    },
    [Object.entries(device(seed("realistic")))],
  );

  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid='view-multi']");
  await page.waitForTimeout(600);

  const arrangeOnly = await counts(page);

  const firstOpen = await timed(page, async () => {
    await view(page, "multi").click();
    await page.waitForSelector("[data-multi-lane]");
  });
  await page.waitForTimeout(400);
  const openEight = await counts(page);

  /* Switching away and back, five times, with the model already built. */
  const toTab = [];
  const toMulti = [];
  for (let round_ = 0; round_ < 5; round_ += 1) {
    toTab.push(await timed(page, async () => view(page, "tab").click()));
    await page.waitForTimeout(150);
    toMulti.push(await timed(page, async () => view(page, "multi").click()));
    await page.waitForTimeout(150);
  }

  /* Making another lane the active one — the model rebuilds, the axis does not. */
  const lanes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-multi-lane]")].map((lane) =>
      lane.getAttribute("data-multi-lane"),
    ),
  );
  const activate = [];
  for (const id of lanes.slice(0, 4)) {
    activate.push(
      await timed(page, async () => {
        await page.locator(`[data-multi-lane-header='${id}']`).click();
      }),
    );
    await page.waitForTimeout(120);
  }

  /* Reading another section: every lane's bars change together. */
  const nextSection = page.locator(
    "[data-section-nav] button[aria-label^='Sonraki bölüm']",
  );
  const previousSection = page.locator(
    "[data-section-nav] button[aria-label^='Önceki bölüm']",
  );
  const sectionSwitch = [];
  for (let round_ = 0; round_ < 3; round_ += 1) {
    if ((await nextSection.isEnabled()) === false) break;
    sectionSwitch.push(await timed(page, () => nextSection.click()));
    await page.waitForTimeout(120);
  }
  while (await previousSection.isEnabled()) {
    await previousSection.click();
    await page.waitForTimeout(80);
  }

  /* Scrolling, horizontally and vertically, inside the one scroller. */
  const box = await page.locator("[data-multi-scroll]").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scrollX = [];
  for (let round_ = 0; round_ < 5; round_ += 1) {
    scrollX.push(await timed(page, () => page.mouse.wheel(120, 0)));
  }
  const scrollY = [];
  for (let round_ = 0; round_ < 5; round_ += 1) {
    scrollY.push(await timed(page, () => page.mouse.wheel(0, 120)));
  }

  const afterEverything = await counts(page);

  viewports[label] = {
    "first Çoklu open (ms)": firstOpen,
    "switch to Tab (ms, median of 5)": median(toTab),
    "switch to Çoklu (ms, median of 5)": median(toMulti),
    "activate another lane (ms, median of 4)": median(activate),
    "read another section (ms, median)": median(sectionSwitch),
    "horizontal wheel (ms, median of 5)": median(scrollX),
    "vertical wheel (ms, median of 5)": median(scrollY),
    samples: { toTab, toMulti, activate, sectionSwitch, scrollX, scrollY },
    dom: {
      "Düzen only": arrangeOnly,
      "Çoklu, eight lanes": openEight,
      "after switching, activating, scrolling": afterEverything,
    },
    /*
     * The virtualization question, answered from the numbers rather than
     * from taste: how many nodes one lane costs, and therefore what the
     * contract's ceiling of eight actually buys.
     */
    virtualization: {
      lanes: openEight.lanes,
      nodesInLanes: openEight.laneNodes,
      nodesPerLane:
        openEight.lanes > 0 ? Math.round(openEight.laneNodes / openEight.lanes) : 0,
      contentWidthPx: openEight.contentWidth,
      scrollerWidthPx: openEight.scrollerWidth,
    },
  };

  await context.close();
}

await browser.close();

const report = JSON.parse(readFileSync(REPORT, "utf8"));
report.browser = {
  measuredOn: "desktop Chromium — not a phone, and not evidence about one",
  base: BASE,
  fixture: "realistic — 8 tracks, 4 sections, 32 bars",
  note:
    "Listener and observer counts are constructor counts, net of removals; " +
    "they say what the page holds, not what a phone can afford.",
  viewports,
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.browser, null, 2));
