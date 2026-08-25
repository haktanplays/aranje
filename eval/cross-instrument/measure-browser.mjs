/**
 * What the writing surfaces cost on a real page (2Q-B §16).
 *
 * The Node half measures the pure cores; this measures the half that only
 * exists in a browser — how many nodes a step grid puts on the page, how long
 * a tap takes to become a written, rendered cell, and whether that cost grows
 * with the size of the song or with the size of the *section on screen*.
 *
 * Desktop Chromium against the production build. That is not a phone, and
 * the artefact says so.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/cross-instrument/measure-browser.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { readFileSync } from "node:fs";

import { device, fixture } from "./device.mjs";

/*
 * The heavy song comes from 2Q-A's generated seeds rather than being written
 * again here. Its sections are the longest the contract allows, which is
 * where a grid drawn cell by cell would show up if it were going to.
 */
const BIG = JSON.parse(
  readFileSync(new URL("../multitrack/seeds.json", import.meta.url), "utf8"),
);

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/cross-instrument/artifacts";
mkdirSync(OUT, { recursive: true });

const ROUNDS = 24;
const WARMUP = 6;

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) =>
    Math.round(
      (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) * 100,
    ) / 100;
  return { rounds: sorted.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(0.999) };
};

async function boot(browser, storage, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
    },
    [Object.entries(storage)],
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]");
  await page.getByTestId("view-tab").click();
  await page.waitForSelector("[data-track-control]");
  return { context, page };
}

const arm = async (page) => {
  const end = page.locator("[data-action-row] button", { hasText: "Düzenlemeyi bitir" });
  if ((await end.count()) > 0) return;
  await page.locator("[data-action-row] button", { hasText: /^Düzenle$/ }).click();
  await page.waitForTimeout(150);
};

const pickTrack = async (page, name) => {
  await page.locator("[data-track-control]").click();
  await page.locator("[data-track-option]", { hasText: name }).first().click();
  await page.waitForTimeout(120);
};

const domShot = (page) =>
  page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    drumCells: document.querySelectorAll("[data-drum-cell]").length,
    pitchedCells: document.querySelectorAll("[data-pitched-cell]").length,
    buttons: document.querySelectorAll("button").length,
  }));

/** How long one tap takes to become a filled cell, measured in the page. */
async function tapCost(page, selector, rounds) {
  const samples = [];
  for (let index = 0; index < rounds; index += 1) {
    const cost = await page.evaluate(async (sel) => {
      const cell = document.querySelector(sel);
      if (!cell) return null;
      const start = performance.now();
      cell.click();
      // Two frames: the commit lands in the first, the paint in the second.
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - start;
    }, selector);
    if (cost !== null) samples.push(cost);
  }
  return samples;
}

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const report = { drums: {}, pitched: {} };

/* ------------------------------------------------------------------ drums */
{
  const { context, page } = await boot(browser, device(fixture("kit")));
  await pickTrack(page, "Davul");
  const reading = await domShot(page);
  await arm(page);
  const writing = await domShot(page);

  const warm = await tapCost(page, "[data-drum-cell]", WARMUP);
  const samples = await tapCost(page, "[data-drum-cell]", ROUNDS);
  report.drums = {
    dom: { reading, writing },
    tap: stats(samples),
    warmupRounds: warm.length,
  };
  await context.close();
}

/* ---------------------------------------------------------------- pitched */
{
  const { context, page } = await boot(browser, device(fixture("pitched")));
  await pickTrack(page, "Piyano");
  const reading = await domShot(page);
  await arm(page);
  const writing = await domShot(page);

  /*
   * A pitched tap opens a sheet rather than writing, so what is measured
   * here is the sheet appearing — the honest equivalent of "the tap
   * answered". Writing the note is the sheet's own button and is measured
   * as its own round.
   */
  const openSamples = [];
  for (let index = 0; index < ROUNDS; index += 1) {
    const start = Date.now();
    await page.locator("[data-pitched-cell]").first().click();
    await page.waitForSelector("[data-note-description]", { timeout: 4000 });
    openSamples.push(Date.now() - start);
    await page.locator("button", { hasText: /^Kapat$/ }).first().click();
    await page.waitForTimeout(40);
  }
  report.pitched = {
    dom: { reading, writing },
    sheetOpen: stats(openSamples),
  };
  await context.close();
}

/* --------------------------------- how the grid grows with the section --- */
{
  const { context, page } = await boot(browser, device(fixture("kit")), {
    width: 320,
    height: 700,
  });
  await pickTrack(page, "Davul");
  await arm(page);
  report.narrowViewport = await domShot(page);
  await context.close();
}

/* -------------------------- the biggest section the contract allows ------ */
{
  const { context, page } = await boot(browser, device(BIG.worstCase));
  await pickTrack(page, "Davul");
  const reading = await domShot(page);
  await arm(page);
  const writing = await domShot(page);
  const samples = await tapCost(page, "[data-drum-cell]", ROUNDS);
  report.worstCaseSection = {
    bars: BIG.worstCase.sections[0].bars.length,
    dom: { reading, writing },
    tap: stats(samples),
  };
  await context.close();
}

await browser.close();

writeFileSync(
  `${OUT}/PERFORMANCE-BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2Q-B §16 — yazma yüzeylerinin tarayıcıdaki maliyeti",
      measuredOn:
        "masaüstü Chromium, gerçek production build — fiziksel telefon değil",
      method: `${WARMUP} ısınma dokunuşu, sonra ${ROUNDS} ölçüm; medyan/p95/maks`,
      note:
        "Davul dokunuşu iki animasyon karesi boyunca ölçülüyor: commit ilkinde, " +
        "boyama ikincisinde. Perdesiz dokunuş yazmıyor, sayfa açıyor — ölçülen o.",
      ...report,
    },
    null,
    2,
  )}\n`,
);
console.log(`${OUT}/PERFORMANCE-BROWSER.json yazıldı`);
