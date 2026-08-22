/**
 * Behaviour, layout, audio and timing parity for the 2L-R refactor.
 *
 * Run once at the pre-refactor baseline and once after, with the same fixture
 * and viewports; the two JSON files are the before/after evidence. Nothing
 * here asserts — it *measures*, so the comparison is a diff of numbers rather
 * than a memory of how things looked.
 *
 *   next start on :3100
 *   node eval/orchestration-refactor/parity.mjs BEFORE   (or AFTER)
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  collectPageErrors,
  layoutProbe,
  mobileContext,
  press,
  targetEdges,
} from "../shared/harness.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const TAG = (process.argv[2] ?? "BEFORE").toUpperCase();
const OUT = "eval/orchestration-refactor";
mkdirSync(`${OUT}/artifacts`, { recursive: true });

const FIXTURE = readFileSync("eval/bar-ops/fixture-song.json", "utf8").trim();

const INSTRUMENT = `
  window.__audioContexts = 0;
  window.__rafCalls = 0;
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
  const originalRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    window.__rafCalls += 1;
    return originalRaf(cb);
  };
`;

async function openApp(browser, size) {
  const context = await mobileContext(browser, size);
  await context.addInitScript(
    ([key, value]) => {
      try {
        if (sessionStorage.getItem("aranje.harness.seeded") === "1") return;
        sessionStorage.setItem("aranje.harness.seeded", "1");
        localStorage.setItem(key, value);
      } catch {
        /* private windows do not fail the run */
      }
    },
    ["aranje.song", FIXTURE],
  );
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = collectPageErrors(page);
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors };
}

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  const round = (v) => Number(v.toFixed(1));
  return {
    rounds: sorted.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
  };
};

const bounds = (page, selectors) =>
  page.evaluate((list) => {
    const out = {};
    for (const [name, selector] of Object.entries(list)) {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      out[name] = box
        ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }
        : null;
    }
    return out;
  }, selectors);

async function switchView(page, id) {
  await page.locator(`[data-testid=view-${id}]`).click();
  await page.waitForSelector(
    id === "tab" ? "[data-tab-content]" : "[data-arrangement-scroller]",
  );
}

const report = { tag: TAG, viewports: {} };

const browser = await chromium.launch();

for (const [label, size] of [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
]) {
  const entry = {};

  /* Boot time: fresh context each round, warm server. */
  {
    const samples = [];
    for (let round = 0; round < 22; round += 1) {
      const context = await mobileContext(browser, size);
      await context.addInitScript(
        ([key, value]) => {
          try {
            if (sessionStorage.getItem("aranje.harness.seeded") === "1") return;
            sessionStorage.setItem("aranje.harness.seeded", "1");
            localStorage.setItem(key, value);
          } catch { /* ignore */ }
        },
        ["aranje.song", FIXTURE],
      );
      const page = await context.newPage();
      const start = Date.now();
      await page.goto(`${BASE}/`, { waitUntil: "commit" });
      await page.waitForSelector("[data-arrangement-scroller]");
      samples.push(Date.now() - start);
      await context.close();
    }
    entry.bootToArrangement = stats(samples.slice(2));
  }

  const { context, page, cdp, errors } = await openApp(browser, size);

  /* Layout snapshot on the arrangement. */
  entry.arrangeBounds = await bounds(page, {
    header: "header",
    viewSwitch: "[data-view-switch]",
    main: "main",
    arrangementScroller: "[data-arrangement-scroller]",
    transportStatusRow: "[data-transport-status]",
    playButton: "[aria-label='Çal']",
    firstTrackLabel: "[data-arr-track]",
  });
  entry.arrangeLayout = await layoutProbe(page);
  entry.arrangeLanes = await page.evaluate(
    () => document.querySelectorAll("[data-arr-track]").length,
  );
  entry.arrangeTargets = await targetEdges(page, [
    "[data-testid=view-arrange]",
    "[data-testid=view-tab]",
    "[aria-label='Çal']",
    "[data-undo]",
    "[data-redo]",
  ]);
  await page.screenshot({ path: `${OUT}/artifacts/${TAG}-${label}-arrange.png` });

  /* View switch timing, both directions. */
  {
    const toTab = [];
    const toArrange = [];
    for (let round = 0; round < 22; round += 1) {
      let start = Date.now();
      await switchView(page, "tab");
      toTab.push(Date.now() - start);
      start = Date.now();
      await switchView(page, "arrange");
      toArrange.push(Date.now() - start);
    }
    entry.switchToTab = stats(toTab.slice(2));
    entry.switchToArrange = stats(toArrange.slice(2));
  }

  /* Tab layout snapshot. */
  await switchView(page, "tab");
  entry.tabBounds = await bounds(page, {
    header: "header",
    sectionNavigator: "[data-section-nav]",
    tabContent: "[data-tab-content]",
    trackControl: "[data-track-control]",
  });
  entry.tabLayout = await layoutProbe(page);
  entry.tabBars = await page.evaluate(
    () => document.querySelectorAll("[data-bar-key]").length,
  );
  await page.screenshot({ path: `${OUT}/artifacts/${TAG}-${label}-tab.png` });
  await switchView(page, "arrange");

  /* Bar selection opening. */
  {
    const samples = [];
    for (let round = 0; round < 22; round += 1) {
      const start = Date.now();
      await press(page, cdp, "[data-arr-bar='intro:0']");
      await page.waitForSelector("[data-bar-action-bar]");
      samples.push(Date.now() - start);
      await page.locator("[aria-label='Ölçü seçimini iptal et']").click();
      await page.waitForTimeout(150);
    }
    entry.barSelectionOpen = stats(samples.slice(2));
  }

  /* Project sheet opening. */
  {
    const samples = [];
    for (let round = 0; round < 22; round += 1) {
      const start = Date.now();
      await page.locator("[aria-label='Ses kaynakları ve lisans']").click();
      await page.waitForSelector("[data-info-project-open]");
      await page.locator("[data-info-project-open]").click();
      await page.waitForSelector("[data-project-sheet]");
      samples.push(Date.now() - start);
      await page.locator("[data-project-sheet] button:has-text('Kapat')").click();
      await page.waitForTimeout(150);
    }
    entry.projectSheetOpen = stats(samples.slice(2));
  }

  /* Audio and frame-loop parity: play, switch views three times. */
  {
    await page.locator("[aria-label='Çal']").click();
    await page.waitForFunction(() => window.__aranjeDebug?.status() === "playing", null, {
      timeout: 30000,
    });
    await switchView(page, "tab");
    await switchView(page, "arrange");
    await switchView(page, "tab");
    await switchView(page, "arrange");
    const rafBefore = await page.evaluate(() => window.__rafCalls);
    await page.waitForTimeout(1000);
    const sample = await page.evaluate(() => ({
      raf: window.__rafCalls,
      contexts: window.__audioContexts,
      status: window.__aranjeDebug?.status() ?? null,
      ticks: window.__aranjeDebug?.ticks() ?? null,
      totalTicks: window.__aranjeDebug?.totalTicks() ?? null,
    }));
    await page.locator("[aria-label='Bölüm döngüsü']").click();
    await page.waitForTimeout(200);
    const loop = await page.evaluate(() => window.__aranjeDebug?.loop() ?? null);
    await page.locator("[aria-label='Duraklat']").click();
    entry.audio = {
      audioContexts: sample.contexts,
      rafCallsPerSecondWhilePlaying: sample.raf - rafBefore,
      statusAfterThreeSwitches: sample.status,
      ticksProgressing: sample.ticks > 0,
      planTotalTicks: sample.totalTicks,
      loopBounds: loop,
    };
  }

  entry.consoleErrors = errors();
  report.viewports[label] = entry;
  await context.close();
}

await browser.close();
writeFileSync(`${OUT}/PARITY-${TAG}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`written ${OUT}/PARITY-${TAG}.json`);
