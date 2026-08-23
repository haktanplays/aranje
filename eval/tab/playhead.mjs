/**
 * What the playhead loop really costs, per transport state (2N-A.1).
 *
 * The 2N-A report said "playhead rAF: 61,3 idle ↔ 60,5 playing". That number
 * was this harness's *own* `requestAnimationFrame` loop counting the display's
 * refresh rate — a figure that is about sixty on any page, including a blank
 * one, and says nothing whatever about whether the app asked for a frame.
 * Reporting it under the playhead's name was the mistake this file exists to
 * make impossible.
 *
 * Four separate numbers are taken, and they are never added together:
 *
 *   1. `globalRaf`  — the browser's frame rate, measured by our own loop.
 *                     A property of the display. Reported so it can be seen
 *                     next to the others and recognised for what it is.
 *   2. `scheduled`  — times the hook asked for a frame.
 *   3. `drawn`      — times the hook's callback actually ran.
 *   4. `live`       — follow loops alive at the end of the window.
 *
 * 2–4 come from the hook seam itself (`window.__playheadProbe`, set before any
 * app code runs), split by surface, so a tab number can never be read as an
 * arrangement one.
 *
 *   1. npm run build && npx next start -p 3100
 *   2. node eval/tab/playhead.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { twoSections, timingSong } from "./songs.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.TAB_OUT ?? "eval/tab/artifacts";
mkdirSync(OUT, { recursive: true });

/** How long each state is watched. One second minimum, per the acceptance. */
const WINDOW_MS = 1100;

const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/*
 * Installed before the app runs, so the counters exist by the time the first
 * effect does. The probe is a plain object the app writes to and never reads:
 * nothing about the app's behaviour depends on its being here.
 */
const INSTRUMENT = `
  window.__playheadProbe = { scheduled: {}, drawn: {}, live: {} };
  window.__audioContexts = 0;
  window.__consoleErrors = [];
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

/**
 * Watch one state for a window and return all four numbers.
 *
 * The hook counters are read as a difference across the window; `live` is a
 * level, not a count, so it is read at the end. The global rate is measured
 * inside the same window by our own loop — deliberately, so the two can be
 * printed side by side and the difference between them seen rather than
 * asserted.
 */
async function watch(page, label) {
  const before = await page.evaluate(() => ({
    scheduled: { ...window.__playheadProbe.scheduled },
    drawn: { ...window.__playheadProbe.drawn },
  }));

  const globalRaf = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          const elapsed = performance.now() - start;
          if (elapsed < ms) requestAnimationFrame(tick);
          else resolve(Number((frames / (elapsed / 1000)).toFixed(1)));
        };
        requestAnimationFrame(tick);
      }),
    WINDOW_MS,
  );

  const after = await page.evaluate(() => ({
    scheduled: { ...window.__playheadProbe.scheduled },
    drawn: { ...window.__playheadProbe.drawn },
    live: { ...window.__playheadProbe.live },
  }));

  const delta = (field, source) =>
    (after[field][source] ?? 0) - (before[field][source] ?? 0);

  return {
    state: label,
    windowMs: WINDOW_MS,
    globalRaf,
    tab: {
      scheduled: delta("scheduled", "tab"),
      drawn: delta("drawn", "tab"),
      live: after.live.tab ?? 0,
    },
    arrangement: {
      scheduled: delta("scheduled", "arrangement"),
      drawn: delta("drawn", "arrangement"),
      live: after.live.arrangement ?? 0,
    },
  };
}

const liveTotal = (m) => m.tab.live + m.arrangement.live;
const drawnTotal = (m) => m.tab.drawn + m.arrangement.drawn;

const showTab = async (page) => {
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(300);
};
const showArrange = async (page) => {
  await page.locator('[data-testid="view-arrange"]').click();
  await page.waitForSelector("[data-arrangement-scroller]");
  await page.waitForTimeout(300);
};

async function openApp(browser, seed) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
    ["aranje.song", JSON.stringify(seed)],
  );
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page
        .evaluate((text) => window.__consoleErrors.push(text), message.text())
        .catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page
      .evaluate((text) => window.__consoleErrors.push(text), String(error))
      .catch(() => {});
  });
  // `?debug=1` exposes the transport's own clock; it drives nothing.
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  return { context, page };
}

const browser = await chromium.launch();
const measurements = {};

/* ------------------------------------------------------- the ten windows */

{
  const { context, page } = await openApp(browser, twoSections());
  await showTab(page);

  // 1. ready / idle
  measurements.idle = await watch(page, "ready/idle");
  record(
    "1 idle: canlı loop 0, tekrar eden callback 0",
    liveTotal(measurements.idle) === 0 && drawnTotal(measurements.idle) === 0,
    `live ${liveTotal(measurements.idle)}, drawn ${drawnTotal(measurements.idle)}, global rAF ${measurements.idle.globalRaf}/s`,
  );

  /*
   * The finding of 2N-A.1, said outright.
   *
   * In the same second the display produced about sixty frames and the
   * playhead asked for none of them. A harness that counted its own frames
   * would report the first number; the hook's own counter reports the second.
   * If this ever passes with both numbers equal, the measurement has gone
   * back to watching the display.
   */
  record(
    "1.b global rAF ile playhead callback'i aynı şey değil",
    measurements.idle.globalRaf > 30 && drawnTotal(measurements.idle) === 0,
    `global ${measurements.idle.globalRaf}/s ↔ playhead ${drawnTotal(measurements.idle)}/pencere`,
  );

  // 2. playing
  await page.getByRole("button", { name: /Çal/ }).first().click();
  await page.waitForTimeout(500);
  measurements.playing = await watch(page, "playing");
  record(
    "2 playing: canlı loop tam 1",
    liveTotal(measurements.playing) === 1 && measurements.playing.tab.drawn > 10,
    `live ${liveTotal(measurements.playing)}, drawn ${measurements.playing.tab.drawn}, global rAF ${measurements.playing.globalRaf}/s`,
  );

  // 3. paused
  await page.getByRole("button", { name: "Duraklat" }).first().click();
  await page.waitForTimeout(500);
  measurements.paused = await watch(page, "paused");
  record(
    "3 paused: canlı loop 0, tekrar eden callback 0",
    liveTotal(measurements.paused) === 0 && drawnTotal(measurements.paused) <= 1,
    `live ${liveTotal(measurements.paused)}, drawn ${drawnTotal(measurements.paused)} (geçiş boyaması)`,
  );

  await context.close();
}

{
  /*
   * 4. ended — played to the end rather than stopped by hand.
   *
   * A short song and a loop that is off: the transport runs out on its own,
   * which is the state a stop button never produces.
   */
  const { context, page } = await openApp(browser, twoSections());
  await showTab(page);
  await page.getByRole("button", { name: /Çal/ }).first().click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const debug = window.__aranjeDebug;
    return debug ? debug.totalTicks() : null;
  });
  // Wait for the transport to report it is no longer playing.
  for (let guard = 0; guard < 40; guard += 1) {
    const status = await page.evaluate(() => window.__aranjeDebug?.status() ?? null);
    if (status !== "playing") break;
    await page.waitForTimeout(500);
  }
  const endedStatus = await page.evaluate(() => window.__aranjeDebug?.status() ?? null);
  measurements.ended = await watch(page, `ended (${endedStatus})`);
  record(
    "4 ended: canlı loop 0",
    liveTotal(measurements.ended) === 0 && drawnTotal(measurements.ended) <= 1,
    `status ${endedStatus}, live ${liveTotal(measurements.ended)}, drawn ${drawnTotal(measurements.ended)}`,
  );
  await context.close();
}

{
  const { context, page } = await openApp(browser, twoSections());
  await showTab(page);

  // 5. the tab is unmounted while Düzen is shown
  await showArrange(page);
  const tabGone = (await page.locator("[data-tab-content]").count()) === 0;
  measurements.tabUnmounted = await watch(page, "tab unmounted (Düzen görünümü)");
  record(
    "5 tab unmount edilmişken tab loop 0",
    tabGone &&
      measurements.tabUnmounted.tab.live === 0 &&
      measurements.tabUnmounted.tab.drawn === 0 &&
      measurements.tabUnmounted.arrangement.live === 0,
    `tab DOM ${tabGone ? "yok" : "duruyor"}, tab live ${measurements.tabUnmounted.tab.live}/drawn ${measurements.tabUnmounted.tab.drawn}, arrangement live ${measurements.tabUnmounted.arrangement.live}`,
  );

  // 6. idle after three Tab ↔ Düzen round trips
  for (let round = 0; round < 3; round += 1) {
    await showTab(page);
    await showArrange(page);
  }
  await showTab(page);
  measurements.switchedIdle = await watch(page, "idle after 3 view switches");
  record(
    "6 üç görünüm geçişinden sonra idle: canlı loop 0",
    liveTotal(measurements.switchedIdle) === 0,
    `live ${liveTotal(measurements.switchedIdle)}, drawn ${drawnTotal(measurements.switchedIdle)}`,
  );

  // 7. playing after three round trips — still exactly one loop
  await page.getByRole("button", { name: /Çal/ }).first().click();
  await page.waitForTimeout(500);
  measurements.switchedPlaying = await watch(page, "playing after 3 view switches");
  record(
    "7 üç geçişten sonra playing: canlı loop tam 1, ikinci loop yok",
    liveTotal(measurements.switchedPlaying) === 1,
    `tab live ${measurements.switchedPlaying.tab.live}, arrangement live ${measurements.switchedPlaying.arrangement.live}, drawn ${measurements.switchedPlaying.tab.drawn}`,
  );

  // 8. another section is being read while the transport plays elsewhere
  const ticksBefore = await page.evaluate(() => window.__aranjeDebug?.ticks() ?? null);
  await page.locator('[data-section-nav] button[aria-label^="Bölüm:"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-section-option="main"]').click();
  await page.waitForTimeout(600);
  const ticksAfter = await page.evaluate(() => window.__aranjeDebug?.ticks() ?? null);
  measurements.elsewhere = await watch(page, "playing in another section");
  const playhead = await page.evaluate(() => {
    const node = document.querySelector("[data-tab-content] .z-20");
    return node ? getComputedStyle(node).opacity : null;
  });
  record(
    "8 başka bölüm okunurken: tek loop, gizli seek yok, sahte playhead yok",
    liveTotal(measurements.elsewhere) === 1 &&
      ticksAfter !== null &&
      ticksAfter >= ticksBefore &&
      playhead === "0",
    `live ${liveTotal(measurements.elsewhere)}, tick ${ticksBefore} → ${ticksAfter}, playhead opacity ${playhead}`,
  );

  const audioBefore = await page.evaluate(() => window.__audioContexts);
  await showArrange(page);
  await showTab(page);
  const audioAfter = await page.evaluate(() => window.__audioContexts);
  record(
    "AudioContext 1 → 1",
    audioBefore === 1 && audioAfter === 1,
    `${audioBefore} → ${audioAfter}`,
  );

  const errors = await page.evaluate(() => window.__consoleErrors);
  record("console/page error 0", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

{
  /*
   * 9. a timing change drops the transport to idle under a running loop.
   *
   * The song is replaced, the controller is rebuilt and playback stops. The
   * loop that was following the old plan has to end with it.
   */
  const { context, page } = await openApp(browser, timingSong());
  await showTab(page);
  await page.getByRole("button", { name: /Çal/ }).first().click();
  await page.waitForTimeout(700);
  const playingLive = await page.evaluate(
    () => (window.__playheadProbe.live.tab ?? 0) + (window.__playheadProbe.live.arrangement ?? 0),
  );

  /*
   * The same door 2N-A §9 used, because it is the one that really lands: a
   * single bar taken to 1/16 through the bar action sheet. A refused change
   * leaves the song alone and playback running, which would make this measure
   * nothing at all — so the refusal is checked for rather than hoped against.
   */
  await page.locator('[data-testid="view-arrange"]').click();
  await page.waitForSelector("[data-arrangement-scroller]");
  await page.waitForTimeout(300);
  const cell = page.locator('[data-arr-bar="s1:1"]').first();
  await cell.scrollIntoViewIfNeeded();
  await cell.click({ delay: 700 });
  await page.waitForTimeout(400);
  const more = page.locator('[data-bar-action="more"]');
  await more.scrollIntoViewIfNeeded();
  await more.click();
  await page.waitForTimeout(300);
  const entry = page.locator('[data-testid="bar-more-timing"]');
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="timing-grid"]').selectOption("16");
  await page.waitForTimeout(250);
  await page.locator('[data-testid="timing-apply"]').click();
  await page.waitForTimeout(900);

  const refused = await page
    .locator('[data-testid="timing-error"]')
    .innerText()
    .catch(() => null);
  const statusAfter = await page.evaluate(() => window.__aranjeDebug?.status() ?? null);
  measurements.afterTimingChange = await watch(page, "after a timing change made it idle");
  record(
    "9 timing değişimi idle'a aldıktan sonra loop sonlanıyor",
    refused === null &&
      playingLive === 1 &&
      statusAfter !== "playing" &&
      liveTotal(measurements.afterTimingChange) === 0,
    refused !== null
      ? `değişim reddedildi (${refused.slice(0, 40)}) — ölçüm geçersiz`
      : `çalarken live ${playingLive} → status ${statusAfter}, live ${liveTotal(measurements.afterTimingChange)}, drawn ${drawnTotal(measurements.afterTimingChange)}`,
  );
  await context.close();
}

{
  /*
   * 10. dispose.
   *
   * Both surfaces are unmounted in turn — the tab's DOM really is gone while
   * Düzen is showing, and vice versa — and each one's own counters are read
   * after its subtree has been torn down. Nothing is inferred from the other
   * surface's numbers, which is why the two are counted separately at all.
   */
  const { context, page } = await openApp(browser, twoSections());
  await showTab(page);
  await page.getByRole("button", { name: /Çal/ }).first().click();
  await page.waitForTimeout(600);

  await showArrange(page);
  await page.waitForTimeout(400);
  const tabDisposed = await watch(page, "tab disposed while playing");
  const tabGone = (await page.locator("[data-tab-content]").count()) === 0;

  await showTab(page);
  await page.waitForTimeout(400);
  const arrangementDisposed = await watch(page, "arrangement disposed while playing");
  const arrangeGone =
    (await page.locator("[data-arrangement-scroller]").count()) === 0;

  measurements.disposed = { tabDisposed, arrangementDisposed };
  record(
    "10 dispose sonrası o yüzeyin loop'u 0 ve callback'i durmuş",
    tabGone &&
      arrangeGone &&
      tabDisposed.tab.live === 0 &&
      tabDisposed.tab.drawn === 0 &&
      arrangementDisposed.arrangement.live === 0 &&
      arrangementDisposed.arrangement.drawn === 0,
    `tab DOM ${tabGone ? "yok" : "duruyor"} live ${tabDisposed.tab.live} drawn ${tabDisposed.tab.drawn} · arrangement DOM ${arrangeGone ? "yok" : "duruyor"} live ${arrangementDisposed.arrangement.live} drawn ${arrangementDisposed.arrangement.drawn}`,
  );

  /*
   * The beam guide, the selection and the tail spacer are drawn markup with
   * no loop of their own. Measured on a playing tab: if any of them had one,
   * the live count would be above one.
   */
  record(
    "beam/selection/tail yeni rAF döngüsü kurmuyor",
    arrangementDisposed.tab.live === 1,
    `tab live ${arrangementDisposed.tab.live} (yalnız playhead)`,
  );
  await context.close();
}

await browser.close();

/* ------------------------------------------------------- playing spread */

/*
 * The playing rate is reported as it was measured — median, p95 and max over
 * the windows in which something really was playing — rather than compared to
 * a threshold this file invented. What a healthy number is depends on the
 * display, which is exactly why the global rate is printed beside it.
 */
const playingWindows = [
  measurements.playing,
  measurements.switchedPlaying,
  measurements.elsewhere,
].filter(Boolean);
const perSecond = playingWindows
  .map((entry) => Number(((entry.tab.drawn / entry.windowMs) * 1000).toFixed(1)))
  .sort((a, b) => a - b);
const at = (q) => perSecond[Math.min(perSecond.length - 1, Math.ceil(q * perSecond.length) - 1)] ?? 0;

const report = {
  measuredOn: "desktop Chromium — not a phone, and not evidence about one",
  base: BASE,
  note:
    "globalRaf is the display's own frame rate measured by this harness; it is not a playhead number.",
  windows: measurements,
  playingCallbackRate: {
    samples: perSecond,
    medianPerSecond: at(0.5),
    p95PerSecond: at(0.95),
    maxPerSecond: perSecond[perSecond.length - 1] ?? 0,
    globalRafPerSecond: playingWindows.map((entry) => entry.globalRaf),
  },
  results,
  failed: results.filter((entry) => !entry.pass).length,
};

writeFileSync(`${OUT}/PLAYHEAD.json`, `${JSON.stringify(report, null, 2)}\n`);
const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length === 0 ? 0 : 1);
