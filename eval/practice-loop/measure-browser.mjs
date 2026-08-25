/**
 * What the dense drum grid costs in a real browser (2R-A §5.4).
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/practice-loop/measure-browser.mjs
 *
 * The Node measurement next door times the layers a tap passes through before
 * anything is drawn. This one times the tap itself, on the production build,
 * on the fixture that is the contract's ceiling — so the difference between
 * the two numbers is what drawing costs.
 *
 * No adjectives. "Slow" is not a measurement; a millisecond is.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture, VIEWPORTS } from "./device.mjs";
import { INSTRUMENT } from "../continuous-follow/instrument.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/practice-loop";
const NAME = process.env.OUT_NAME ?? "DRUM-BASELINE";
const ROUNDS = Number(process.env.ROUNDS ?? 20);
mkdirSync(OUT, { recursive: true });

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

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

async function boot(browser, viewport, storage) {
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
    [Object.entries(storage), INSTRUMENT],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  return { context, page, errors };
}

/** Everything the grid costs the page, counted rather than estimated. */
const shot = (page) =>
  page.evaluate(() => {
    const scrollers = [...document.querySelectorAll("*")].filter((el) => {
      const style = getComputedStyle(el);
      return (
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth + 1
      );
    });
    return {
      nodes: document.querySelectorAll("*").length,
      buttons: document.querySelectorAll("button").length,
      drumCells: document.querySelectorAll("[data-drum-cell]").length,
      filledCells: document.querySelectorAll("[data-drum-cell][data-filled]").length,
      stepBars: document.querySelectorAll("[data-drum-step-bar]").length,
      /*
       * The kit rows the grid really drew, counted from the cells themselves.
       * The legend is a Çoklu-view element and is not on the Tab surface, so
       * counting its children reported -1 in the first run of this harness.
       */
      rows: new Set(
        [...document.querySelectorAll("[data-drum-cell]")].map(
          (el) => el.getAttribute("data-drum-cell").split(":")[0],
        ),
      ).size,
      scrollers: scrollers.length,
      scrollWidth: scrollers[0]?.scrollWidth ?? null,
      clientWidth: scrollers[0]?.clientWidth ?? null,
      listeners: window.__probe.listeners,
      observers: { ...window.__probe.observers },
      audioContexts: window.__probe.audioContexts,
      storageWrites: window.__probe.storageWrites ?? null,
    };
  });

const probeCounts = (page) =>
  page.evaluate(() => ({
    longTasks:
      window.__probe.longTasks === null ? null : window.__probe.longTasks.length,
    audioContexts: window.__probe.audioContexts,
    externalRequests: window.__probe.externalRequests.length,
  }));

async function timed(page, run) {
  const start = Date.now();
  await run();
  return Date.now() - start;
}

/** Repeat an action `ROUNDS` times after a warm-up and describe the spread. */
async function repeat(page, rounds, run) {
  await run(0);
  await run(1);
  const samples = [];
  for (let index = 0; index < rounds; index += 1) {
    samples.push(await timed(page, () => run(index + 2)));
  }
  return stats(samples);
}

/** The song as the app holds it, so a write can be counted rather than assumed. */
const revision = (page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.projects");
    if (!raw) return null;
    const id = JSON.parse(raw).activeProjectId;
    const record = window.localStorage.getItem(`aranje.project.${id}`);
    return record ? JSON.parse(record).revision : null;
  });

async function measure(browser, viewport) {
  const { context, page, errors } = await boot(
    browser,
    viewport,
    device(fixture("denseKit")),
  );
  const result = { viewport: viewport.name };

  /* ------------------------------------------------------ opening the grid */

  await page.getByTestId("view-tab").click();
  await page.waitForSelector("[data-track-control]", { timeout: 10000 });

  await page.locator("[data-track-control]").click();
  await page.locator("[data-track-option]", { hasText: "Davul" }).first().click();
  await page.waitForTimeout(200);

  result.openStepGridMs = await timed(page, async () => {
    await page.locator("[data-action-row] button", { hasText: /^Düzenle$/ }).click();
    await page.waitForSelector("[data-drum-cell]", { timeout: 10000 });
  });

  result.grid = await shot(page);
  result.revisionBefore = await revision(page);

  /* -------------------------------------------------------------- the taps */

  const first = page.locator("[data-drum-cell]").first();
  result.toggleMs = await repeat(page, ROUNDS, async () => {
    await first.click();
    await page.waitForTimeout(0);
  });

  /*
   * A tap on an empty cell and a tap on a filled one are two different
   * commands, so they are two different measurements rather than an average
   * of the pair.
   */
  const empty = page.locator("[data-drum-cell]:not([data-filled])").first();
  result.writeMs = await repeat(page, Math.min(ROUNDS, 10), async () => {
    await empty.click();
    await page.waitForTimeout(0);
    if ((await empty.getAttribute("data-filled")) !== null) {
      await empty.click();
      await page.waitForTimeout(0);
    }
  });

  /* ------------------------------------------------------- moving about */

  result.scrollFarMs = await repeat(page, Math.min(ROUNDS, 10), async (index) => {
    await page.evaluate((fraction) => {
      const el = [...document.querySelectorAll("*")].find((node) => {
        const s = getComputedStyle(node);
        return (
          (s.overflowX === "auto" || s.overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth + 1
        );
      });
      if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) * fraction;
    }, (index % 4) / 4);
    await page.waitForTimeout(60);
  });

  await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((node) => {
      const s = getComputedStyle(node);
      return (
        (s.overflowX === "auto" || s.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    if (el) el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(200);
  result.atFarEnd = await shot(page);

  const far = page.locator("[data-drum-cell]").last();
  result.farCellToggleMs =
    (await far.count()) > 0
      ? await repeat(page, Math.min(ROUNDS, 10), async () => {
          await far.click();
          await page.waitForTimeout(0);
        })
      : "en uzak hücre mount edilmemiş";

  result.revisionAfter = await revision(page);
  result.counts = await probeCounts(page);
  result.consoleErrors = errors.slice(0, 3);
  await context.close();
  return result;
}

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const results = [];
for (const viewport of VIEWPORTS) {
  const measured = await measure(browser, viewport);
  results.push(measured);
  console.log(
    `${viewport.name}: ${measured.grid.drumCells} hücre, ` +
      `${measured.grid.nodes} düğüm, açılış ${measured.openStepGridMs} ms, ` +
      `dokunuş ${measured.toggleMs?.median} ms medyan / ${measured.toggleMs?.p95} p95`,
  );
}
await browser.close();

writeFileSync(
  `${OUT}/${NAME}.json`,
  `${JSON.stringify(
    {
      what:
        NAME === "DRUM-BASELINE"
          ? "2R-A §5.4 — yoğun davul ızgarası, windowing öncesi tarayıcı ölçümü"
          : "2R-A §19 — yoğun davul ızgarası, windowing sonrası tarayıcı ölçümü",
      head: process.env.HEAD_SHA ?? "73250de",
      measuredOn:
        "masaüstü Chromium, gerçek production build — fiziksel telefon değil",
      method: `Her ölçüm 2 ısınma turundan sonra ${ROUNDS} tur (pahalı olanlarda 10); median / p95 / max ms.`,
      notes: [
        "Katman katman saf maliyet için PERFORMANCE.json'a bak; buradaki fark çizim maliyetidir.",
        "Boş hücreye yazmak ile dolu hücreyi silmek iki ayrı komuttur, ayrı ölçüldü.",
        "src/ altında hiçbir dosya ölçüm için değiştirilmedi.",
      ],
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${OUT}/${NAME}.json yazıldı`);
