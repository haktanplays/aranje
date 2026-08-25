/**
 * What the practice loop costs in a real browser (2R-A §XV).
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/practice-loop/measure-practice-browser.mjs
 *
 * Every number here is an interaction a reader actually performs, timed from
 * the gesture to the thing they are waiting for — the sheet appearing, the
 * range being named, the playhead moving. Nothing is timed from inside the
 * app: a measurement that started after React had already begun would be
 * measuring the second half of the work.
 *
 * ## What this file does not re-measure
 *
 * The drum tap itself. `profile-tap.mjs` measures it on both fixtures with a
 * CPU profile attached, and a third implementation of the same measurement
 * would be a third answer waiting to disagree. Those numbers are read out of
 * `TAP-PROFILE.json` and carried here with their provenance attached, so this
 * artefact can state the whole picture without pretending to have taken them.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { device, fixture } from "./device.mjs";
import { INSTRUMENT, START_RECORDING, STOP_RECORDING } from "../continuous-follow/instrument.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/practice-loop";
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const WARMUP = 2;
mkdirSync(OUT, { recursive: true });

const round = (value, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** median / p95 / max of a set of samples, and the samples themselves. */
function describe(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    rounds: sorted.length,
    warmup: WARMUP,
    median: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    samples: sorted.map((value) => round(value)),
  };
}

async function boot(browser, fixtureName) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries, instrument]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(instrument);
    },
    [Object.entries(device(fixture(fixtureName))), INSTRUMENT],
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  await page.getByTestId("view-tab").click();
  await page.waitForTimeout(400);
  return { context, page };
}

const play = (page) => page.locator("footer button[aria-label='Çal']");
const pause = (page) => page.locator("footer button[aria-label='Duraklat']");

/** Time one gesture, from the click to whatever the reader is waiting for. */
async function timed(page, act) {
  const at = performance.now();
  await act();
  return performance.now() - at;
}

async function repeat(page, count, act) {
  for (let index = 0; index < WARMUP; index += 1) await act(index);
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    samples.push(await timed(page, () => act(index + WARMUP)));
  }
  return describe(samples);
}

const results = {};

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const chromiumVersion = browser.version();

/* ------------------------------------------------- the sheet and the doors */
{
  const { context, page } = await boot(browser, "practiceSong");

  results.sheetOpen = await repeat(page, ROUNDS, async () => {
    await page.locator("[data-open-practice]").click();
    await page.waitForSelector("[data-practice-sheet]", { timeout: 4000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
  });

  // A bar has to be current before the single-bar door is offered.
  await page.locator("[data-bar-key='four:0']").first().click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(250);

  results.singleBarApply = await repeat(page, ROUNDS, async () => {
    await page.locator("[data-open-practice]").click();
    await page.waitForSelector("[data-practice-sheet]", { timeout: 4000 });
    const already = (await page.locator("[data-practice-clear]").count()) > 0;
    if (already) await page.locator("[data-practice-clear]").click();
    await page.locator("[data-practice-current]").click();
    await page.waitForSelector("[data-practice-range]", { timeout: 4000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
  });

  results.pairApply = await repeat(page, ROUNDS, async () => {
    await page.locator("[data-bar-key='four:2']").first().click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(80);
    await page.locator("[data-open-practice]").click();
    await page.waitForSelector("[data-practice-sheet]", { timeout: 4000 });
    await page.locator("[data-practice-extend]").click();
    await page.waitForTimeout(60);
    await page.locator("[data-practice-clear]").click();
    await page.locator("[data-practice-current]").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
  });

  results.progressiveApply = await repeat(page, ROUNDS, async () => {
    await page.locator("[data-open-practice]").click();
    await page.waitForSelector("[data-practice-sheet]", { timeout: 4000 });
    await page.locator("[data-speed-mode=progressive]").click();
    await page.locator("[data-progressive-start]").click();
    await page.waitForSelector("[data-progressive-notice]", { timeout: 4000 });
    await page.locator("[data-speed-mode=fixed]").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
  });

  await context.close();
}

/* ----------------------------------- the count-in, and the loop coming round */
{
  const { context, page } = await boot(browser, "practiceSong");
  await page.locator("[data-bar-key='four:1']").first().click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(250);
  await page.locator("[data-open-practice]").click();
  await page.waitForSelector("[data-practice-sheet]");
  await page.locator("[data-practice-current]").click();
  await page.waitForTimeout(150);

  /** Play, and report when the playhead first actually moved. */
  const startLatency = async () => {
    await page.evaluate(START_RECORDING);
    await play(page).click();
    await page.waitForTimeout(5200);
    const raw = await page.evaluate(STOP_RECORDING);
    if ((await pause(page).count()) > 0) await pause(page).click();
    await page.waitForTimeout(250);
    const samples = raw.scrollSamples.filter((entry) => entry.playheadX !== null);
    const origin = samples[0]?.playheadX ?? 0;
    const started = samples[0]?.t ?? 0;
    const first = samples.find((entry) => Math.abs(entry.playheadX - origin) > 1);
    return { latency: first === undefined ? null : first.t - started, samples };
  };

  for (const bars of [0, 1, 2]) {
    await page.locator("[data-count-in]").first().waitFor();
    await page.locator(`[data-count-in='${bars}']`).click();
    await page.waitForTimeout(120);
    const taken = [];
    for (let index = 0; index < 5; index += 1) {
      const { latency } = await startLatency();
      if (latency !== null) taken.push(latency);
    }
    results[`countInStart${bars}Bars`] = describe(taken);
  }

  // How long a pass of a one-bar loop takes, measured between wraps.
  await page.locator(`[data-count-in='0']`).click();
  await page.waitForTimeout(120);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const { samples } = await startLatency();
  const gaps = [];
  let previous = null;
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1].playheadX;
    const now = samples[index].playheadX;
    if (before === null || now === null) continue;
    if (now < before - 1) {
      if (previous !== null) gaps.push(samples[index].t - previous);
      previous = samples[index].t;
    }
  }
  results.loopWrapIntervalMs = describe(gaps.length > 0 ? gaps : [0]);

  await context.close();
}

/* ------------------------------- the armed grid: scrolling and remounting */
{
  const { context, page } = await boot(browser, "denseKit");
  const track = page.getByRole("button", { name: /^Aktif track/ });
  await track.click();
  await page.waitForTimeout(250);
  await page.locator("[data-track-option='drums']").click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Düzenle", exact: true }).click();
  await page.waitForTimeout(500);

  const armed = (await page.locator("[data-drum-step]").count()) > 0;
  const before = await page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    cells: document.querySelectorAll("[data-drum-cell]").length,
    listeners: window.__probe.listeners,
    listenersRemoved: window.__probe.listenersRemoved,
    observers: { ...window.__probe.observers },
    observersDisconnected: { ...window.__probe.observersDisconnected },
    audioContexts: window.__probe.audioContexts,
  }));

  // A fling across the whole grid, one frame's worth of scroll at a time.
  await page.evaluate(START_RECORDING);
  const flung = await page.evaluate(async () => {
    const scroller = [...document.querySelectorAll("*")].find((node) => {
      const style = getComputedStyle(node);
      return (
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    if (!scroller) return { steps: 0, mounted: [] };
    const mounted = [];
    let at = 0;
    let steps = 0;
    while (at < scroller.scrollWidth - scroller.clientWidth) {
      at += 60;
      scroller.scrollLeft = at;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      mounted.push(document.querySelectorAll("[data-drum-cell]").length);
      steps += 1;
      if (steps > 400) break;
    }
    return { steps, mounted };
  });
  const raw = await page.evaluate(STOP_RECORDING);
  const frames = raw.frames.filter((ms) => ms > 0);

  const after = await page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    cells: document.querySelectorAll("[data-drum-cell]").length,
    listeners: window.__probe.listeners,
    listenersRemoved: window.__probe.listenersRemoved,
    observers: { ...window.__probe.observers },
    observersDisconnected: { ...window.__probe.observersDisconnected },
    audioContexts: window.__probe.audioContexts,
    live: { ...window.__playheadProbe.live },
  }));

  results.armedGrid = {
    armed,
    fixture: "denseKit",
    flingSteps: flung.steps,
    frameMs: describe(frames.slice(0, 200)),
    mountedCells: {
      min: Math.min(...flung.mounted),
      max: Math.max(...flung.mounted),
      /*
       * The whole point of the window: the grid is 1.792 cells and the page
       * never holds them all. The maximum here is what the reader's phone
       * actually pays for.
       */
      grid: 8 * 32 * 7,
    },
    dom: { before: before.nodes, after: after.nodes },
    listeners: {
      added: after.listeners - before.listeners,
      removed: after.listenersRemoved - before.listenersRemoved,
    },
    observers: {
      constructed: after.observers,
      disconnected: after.observersDisconnected,
    },
    audioContexts: after.audioContexts,
    idleFrames: Object.values(after.live).reduce((a, b) => a + b, 0),
  };

  await context.close();
}

await browser.close();

/* --------------------------------------------------- the tap, by reference */
const tap = JSON.parse(readFileSync(`${OUT}/TAP-PROFILE.json`, "utf8"));
const tapOf = (fixtureName, viewport) =>
  tap.results.find(
    (entry) => entry.fixture === fixtureName && entry.viewport === viewport,
  ) ?? null;

/**
 * The targets, and whether they were met — stated as measured, not as hoped.
 *
 * `passed: false` is used where a number did not clear its target, and
 * `passed: null` where a target was cleared but by a margin too small to call
 * it closed. There is no target invented for anything that did not have one.
 */
const realistic = tapOf("practiceSong", "390x844");
const ceiling = tapOf("denseKit", "390x844");
const targets = [
  {
    what: "gerçekçi fixture, davul dokunuşu medyanı",
    target: "≤33 ms",
    measured: realistic?.inPageTapMs?.median ?? null,
    source: "TAP-PROFILE.json (profile-tap.mjs, 60 tur)",
    passed: realistic !== null && realistic.inPageTapMs.median <= 33,
  },
  {
    what: "gerçekçi fixture, davul dokunuşu p95",
    target: "≤50 ms",
    measured: realistic?.inPageTapMs?.p95 ?? null,
    source: "TAP-PROFILE.json (profile-tap.mjs, 60 tur)",
    /*
     * Deliberately not `true`. Six 60-round runs all landed inside the
     * target, but the worst of them cleared it by 0,2 ms and a 24-round run
     * measured 57,3 ms. A threshold met with no margin is not a threshold
     * met, and the tail's cause — allocation and garbage collection is the
     * hypothesis — is not actually known.
     */
    passed: null,
    note:
      "Altı koşuda hedefin altında (32,0-49,8 ms) fakat en kötüsünde yalnız " +
      "0,2 ms pay var; 24 turluk bir koşuda 57,3 ms ölçüldü. Kapandı sayılmıyor.",
  },
  {
    what: "sözleşme tavanı, davul dokunuşu medyanı",
    target: "yok — ölçülüyor, eşik uydurulmadı",
    measured: ceiling?.inPageTapMs?.median ?? null,
    source: "TAP-PROFILE.json (profile-tap.mjs, 60 tur)",
    passed: false,
    note:
      "182 → ~131 ms. Kalanın ~30 ms'i merkezî schema/validator kapısı, " +
      "~7 ms'i playback planıdır; ikisi de gevşetilmesi yasak yollardır. " +
      "Açık borç.",
  },
];

writeFileSync(
  `${OUT}/PERFORMANCE-BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2R-A §XV — pratik döngüsünün tarayıcıdaki maliyeti",
      measuredOn: {
        chromium: chromiumVersion,
        node: process.version,
        surface: "masaüstü Chromium, mobil viewport emülasyonu (390×844)",
        physicalDevice: false,
        build: "production (next build + next start)",
      },
      method:
        `Her etkileşim ${WARMUP} ısınma turundan sonra ${ROUNDS} tur ` +
        "(count-in gibi saniyeler süren ölçümlerde 5 tur); jest → okurun " +
        "beklediği şey görünene kadar, dışarıdan.",
      notes: [
        "Davul dokunuşu burada yeniden ölçülmedi: TAP-PROFILE.json'daki ölçüm " +
          "CPU profiliyle birlikte alınmıştır ve üçüncü bir kopya üçüncü bir " +
          "cevap olurdu. Sayılar kaynağıyla birlikte taşınıyor.",
        "Count-in gecikmeleri playhead'in gerçekten hareket ettiği ilk kareden " +
          "okunur; 'x sıfırdan farklı' ölçüsü ikinci ölçüde başlayan bir range " +
          "için her zaman doğrudur ve hiçbir şey ölçmez.",
        "Fiziksel telefon kanıtı değildir.",
      ],
      targets,
      results,
    },
    null,
    2,
  )}\n`,
);

console.log(`${OUT}/PERFORMANCE-BROWSER.json yazıldı`);
for (const [name, stat] of Object.entries(results)) {
  if (stat && typeof stat.median === "number") {
    console.log(`  ${name.padEnd(24)} ${stat.median} ms (p95 ${stat.p95})`);
  }
}
