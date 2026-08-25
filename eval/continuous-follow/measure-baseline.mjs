/**
 * What the reading surface costs and how it moves, before 2Q-C (§1.2).
 *
 * Every number here is measured on the production build as it stands at
 * `d89c193`. Nothing in `src/` was changed to make the measurement possible:
 * the playhead is found by the property that makes it a playhead (a
 * transformed layer), the scroller by the fact that it scrolls, and the
 * viewed section by an attribute the surface already declares.
 *
 * No adjectives. "Akıcı" is not a measurement; a frame interval is.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/continuous-follow/measure-baseline.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture, VIEWPORTS } from "./device.mjs";
import { INSTRUMENT, START_RECORDING, STOP_RECORDING } from "./instrument.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/continuous-follow";
mkdirSync(OUT, { recursive: true });

/** How long each playback recording runs, in milliseconds. */
const RECORD_MS = Number(process.env.RECORD_MS ?? 6000);

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

/* ------------------------------------------------------------- readings */

const domShot = (page) =>
  page.evaluate(() => {
    const scrollers = [...document.querySelectorAll("*")].filter((el) => {
      const style = getComputedStyle(el);
      return style.overflowX === "auto" || style.overflowX === "scroll";
    });
    const scrolling = scrollers.filter((el) => el.scrollWidth > el.clientWidth + 1);
    const surface = scrolling[0] ?? scrollers[0] ?? null;
    return {
      nodes: document.querySelectorAll("*").length,
      buttons: document.querySelectorAll("button").length,
      bars: document.querySelectorAll("[data-bar-key]").length,
      drumCells: document.querySelectorAll("[data-drum-cell]").length,
      pitchedCells: document.querySelectorAll("[data-pitched-cell]").length,
      cells: document.querySelectorAll("[data-cell]").length,
      lanes: document.querySelectorAll("[data-multi-lane]").length,
      declaredScrollers: scrollers.length,
      scrollingNow: scrolling.length,
      scrollWidth: surface ? surface.scrollWidth : null,
      clientWidth: surface ? surface.clientWidth : null,
      listeners: window.__probe.listeners,
      observers: { ...window.__probe.observers },
      audioContexts: window.__probe.audioContexts,
    };
  });

const probeCounts = (page) =>
  page.evaluate(() => ({
    playhead: {
      scheduled: { ...window.__playheadProbe.scheduled },
      drawn: { ...window.__playheadProbe.drawn },
      live: { ...window.__playheadProbe.live },
    },
    scrollLeftWrites: window.__probe.scrollLeftWrites,
    sampleRequests: window.__probe.sampleRequests,
    externalRequests: window.__probe.externalRequests.length,
    audioContexts: window.__probe.audioContexts,
  }));

const view = (page, id) => page.getByTestId(`view-${id}`);

async function timed(page, run) {
  const start = Date.now();
  await run();
  return Date.now() - start;
}

/** Play for a while and describe how the surface moved while it did. */
async function recordPlayback(page, ms) {
  await page.evaluate(START_RECORDING);
  await page.locator("footer button[aria-label='Çal']").click();
  await page.waitForTimeout(ms);
  const raw = await page.evaluate(STOP_RECORDING);
  const pause = page.locator("footer button[aria-label='Duraklat']");
  if ((await pause.count()) > 0) await pause.click();

  const samples = raw.scrollSamples.filter((s) => s.scrollLeft !== null);
  const deltas = [];
  let sectionChanges = 0;
  let jumpAtSectionChange = 0;
  let blankFrames = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta = Math.abs(current.scrollLeft - previous.scrollLeft);
    deltas.push(delta);
    if (current.section !== previous.section) {
      sectionChanges += 1;
      jumpAtSectionChange = Math.max(jumpAtSectionChange, delta);
    }
    /*
     * A frame where the playhead is inside the song but not drawn. That is
     * what a reader sees as a blank: the surface is on screen and the line
     * that says where the music is, is not.
     */
    if (!current.playheadShown) blankFrames += 1;
  }
  const moved = deltas.filter((delta) => delta > 0.5);

  return {
    frames: stats(raw.frames),
    framesOver25ms: raw.frames.filter((interval) => interval > 25).length,
    framesOver50ms: raw.frames.filter((interval) => interval > 50).length,
    longTasks:
      raw.longTasks === null
        ? "PerformanceObserver longtask desteklenmiyor"
        : { count: raw.longTasks.length, ...(stats(raw.longTasks) ?? {}) },
    scrollLeftWrites: raw.scrollLeftWrites,
    scrollLeftWritesPerSecond: round((raw.scrollLeftWrites / ms) * 1000),
    scrollMoves: moved.length,
    largestScrollJumpPx: round(Math.max(0, ...deltas)),
    medianNonZeroJumpPx: moved.length > 0 ? stats(moved).median : 0,
    sectionChanges,
    largestJumpAtSectionChangePx: round(jumpAtSectionChange),
    blankPlayheadFrames: blankFrames,
    sampledFrames: samples.length,
  };
}

/* ------------------------------------------------------------------ tour */

async function measureFixture(browser, viewport, name) {
  const { context, page, errors } = await boot(browser, viewport, device(fixture(name)));
  const result = { fixture: name, viewport: viewport.name };

  result.openMs = await timed(page, async () => {
    await view(page, "tab").click();
    await page.waitForSelector("[data-track-control]", { timeout: 10000 });
  });
  result.tab = await domShot(page);

  // The "next section" step of the one navigation authority (spec 13.20 §3).
  result.sectionChangeMs = await timed(page, async () => {
    const next = page.locator("[data-section-nav] button[aria-label^='Sonraki bölüm']");
    if ((await next.count()) > 0 && (await next.isEnabled())) {
      await next.click();
      await page.waitForTimeout(120);
    }
  });

  result.barSeekMs = await timed(page, async () => {
    const bars = page.locator("[data-bar-key]");
    if ((await bars.count()) > 0) {
      await bars.first().click();
      await page.waitForTimeout(80);
    }
  });

  result.manualScrollMs = await timed(page, async () => {
    await page.evaluate(() => {
      const scroller = [...document.querySelectorAll("*")].find((el) => {
        const style = getComputedStyle(el);
        return (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1
        );
      });
      if (scroller) scroller.scrollLeft += 400;
    });
    await page.waitForTimeout(80);
  });

  result.tabPlayback = await recordPlayback(page, RECORD_MS);

  /* ------------------------------------------------------------- Çoklu */

  await view(page, "multi").click();
  await page.waitForTimeout(250);
  result.multi = await domShot(page);
  result.multiPlayback = await recordPlayback(page, RECORD_MS);

  /* --------------------------------------------------- the armed kit */

  const drumOption = page.locator("[data-track-option]", { hasText: "Davul" });
  await page.locator("[data-track-control]").click();
  if ((await drumOption.count()) > 0) {
    await drumOption.first().click();
    await page.waitForTimeout(150);
    const edit = page.locator("[data-action-row] button", { hasText: /^Düzenle$/ });
    if ((await edit.count()) > 0) {
      await edit.click();
      await page.waitForTimeout(200);
    }
    result.armedDrums = await domShot(page);
    const cell = page.locator("[data-drum-cell]").first();
    if ((await cell.count()) > 0) {
      const taps = [];
      for (let round_ = 0; round_ < 8; round_ += 1) {
        taps.push(await timed(page, async () => {
          await cell.click();
          await page.waitForTimeout(0);
        }));
      }
      result.drumTapMs = stats(taps);
    }
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    result.armedDrums = "bu fixture'da davul track'i yok";
  }

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
  for (const name of ["normal", "denseDrums", "eightTracks", "shortSections"]) {
    const measured = await measureFixture(browser, viewport, name);
    results.push(measured);
    console.log(
      `${name} @ ${viewport.name}: tab ${measured.tab.nodes} düğüm, ` +
        `sıçrama ${measured.tabPlayback.largestScrollJumpPx}px, ` +
        `çoklu ${measured.multi.nodes} düğüm, ` +
        `sıçrama ${measured.multiPlayback.largestScrollJumpPx}px`,
    );
  }
}
await browser.close();

writeFileSync(
  `${OUT}/BASELINE.json`,
  `${JSON.stringify(
    {
      what: "2Q-C §1 — sürekli okuma yüzeyi öncesi taban ölçümü",
      head: "d89c193",
      measuredOn:
        "masaüstü Chromium, gerçek production build — fiziksel telefon değil",
      method: `Her playback kaydı ${RECORD_MS} ms; kare aralıkları ve scrollLeft her animasyon karesinde örneklendi.`,
      notes: [
        "src/ altında hiçbir dosya ölçüm için değiştirilmedi.",
        "Playhead, transform ile taşınan katman olduğu için öyle bulundu; " +
          "ölçüm uğruna eklenmiş bir data attribute yok.",
        "largestScrollJumpPx, ardışık iki kare arasındaki en büyük |ΔscrollLeft|'tir — " +
          "yani okurun gördüğü en büyük sıçrama.",
        "blankPlayheadFrames, playhead'in çizilmediği kare sayısıdır.",
      ],
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${OUT}/BASELINE.json yazıldı`);
