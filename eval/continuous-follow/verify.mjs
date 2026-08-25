/**
 * The reading surface, in a real browser (2Q-C §12).
 *
 * Every claim is measured on the thing it is about, on the path a reader
 * would take, and the numbers come out of the page rather than out of a
 * belief about it: the playhead is found by the property that makes it one, a
 * scroller by the fact that it scrolls, and "the surface followed" by
 * counting frames in which it moved.
 *
 * Reduced motion is a separate run, not a flag flipped mid-tour, because it
 * changes what the surface is allowed to do and a tour that measured both in
 * one context would be measuring neither.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/continuous-follow/verify.mjs
 *   ONE_VIEWPORT=1 node eval/continuous-follow/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture, twoProjects } from "./device.mjs";
import { PROJECT_LEDGER, writeTally } from "../shared/project-storage.mjs";
import { INSTRUMENT, START_RECORDING, STOP_RECORDING } from "./instrument.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/continuous-follow";
mkdirSync(OUT, { recursive: true });

const results = [];
const record_ = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/** `ONLY=ends node verify.mjs` runs one tour, for iterating on a claim. */
const ONLY = (process.env.ONLY ?? "").split(",").map((e) => e.trim()).filter(Boolean);

async function safe(label, run) {
  if (ONLY.length > 0 && !ONLY.some((entry) => label.includes(entry))) return;
  try {
    await run();
  } catch (error) {
    const lines = String(error).split("\n");
    record_(`${label} (threw)`, false, lines[0]);
  }
}

async function boot(browser, viewport, storage, extra = {}) {
  /*
   * `ledger` and `textScale` are the harness's own options and never reach
   * `newContext`, which would silently ignore an unknown key and leave a run
   * that looks like it measured a 150% screen but did not.
   */
  const { ledger = false, textScale = 100, ...contextOptions } = extra;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ...contextOptions,
  });
  await context.addInitScript(
    ([entries, instrument, storageLedger]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(instrument);
      // After the seed, so seeding is not counted as the app writing.
      if (storageLedger) (0, eval)(storageLedger);
    },
    [Object.entries(storage), INSTRUMENT, ledger ? PROJECT_LEDGER : null],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  /*
   * A phone's "larger text" is not a zoom: the viewport keeps its CSS pixels
   * and the root font grows. Applied after the app is up so it is the same
   * surface, resized — and the tour asserts the root font really moved, so a
   * run where the style tag failed cannot pass by looking tidy.
   */
  if (textScale !== 100) {
    await page.addStyleTag({
      content: `html { font-size: ${Math.round(16 * (textScale / 100))}px }`,
    });
    await page.waitForTimeout(200);
  }
  return { context, page, errors, textScale };
}

/* --------------------------------------------------------------- helpers */

const view = (page, id) => page.getByTestId(`view-${id}`);
const play = (page) => page.locator("footer button[aria-label='Çal']");
const pause = (page) => page.locator("footer button[aria-label='Duraklat']");
const returnChip = (page) => page.locator("[data-return-to-playback]");

/**
 * A real finger dragging the surface sideways.
 *
 * Through CDP touch events over the scroller itself. `mouse.wheel` was the
 * first attempt and it measured nothing: the pointer starts at (0,0), which
 * is the header, so the wheel never reached the surface and the run reported
 * "a wheel does not take the view over" about a wheel that never happened.
 */
async function swipe(page, cdp, dx) {
  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((node) => {
      const s = getComputedStyle(node);
      return (
        (s.overflowX === "auto" || s.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!box) throw new Error("no scroller to swipe");
  const steps = 10;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x, y: box.y }],
  });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: box.x - (dx * i) / steps, y: box.y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}

/** Everything that really scrolls horizontally right now. */
const scrollers = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => {
        const s = getComputedStyle(el);
        return (
          (s.overflowX === "auto" || s.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1
        );
      })
      .map((el) => ({
        scrollLeft: Math.round(el.scrollLeft),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      })),
  );

const surface = async (page) => (await scrollers(page))[0] ?? null;

/** The whole surface, as the page currently holds it. */
const shot = (page) =>
  page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    bars: document.querySelectorAll("[data-bar-key]").length,
    barKeys: [...document.querySelectorAll("[data-bar-key]")].map((el) =>
      el.getAttribute("data-bar-key"),
    ),
    lanes: document.querySelectorAll("[data-multi-lane]").length,
    viewedSection:
      document.querySelector("[data-viewed-section]")?.getAttribute("data-viewed-section") ??
      null,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    observers: { ...window.__probe.observers },
    observersDisconnected: { ...window.__probe.observersDisconnected },
    listeners: window.__probe.listeners,
    listenersRemoved: window.__probe.listenersRemoved,
    listenersByType: { ...window.__probe.listenersByType },
    intervalsSet: window.__probe.intervalsSet,
    intervalsCleared: window.__probe.intervalsCleared,
    audioContexts: window.__probe.audioContexts,
    externalRequests: window.__probe.externalRequests.length,
    live: { ...window.__playheadProbe.live },
  }));

const storedSong = (page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.projects");
    if (!raw) return null;
    const id = JSON.parse(raw).activeProjectId;
    const record = window.localStorage.getItem(`aranje.project.${id}`);
    return record ? JSON.parse(record) : null;
  });

/** Play for a while and describe how the surface moved while it did. */
async function recordPlayback(page, ms) {
  await page.evaluate(START_RECORDING);
  await play(page).click();
  await page.waitForTimeout(ms);
  const raw = await page.evaluate(STOP_RECORDING);
  if ((await pause(page).count()) > 0) await pause(page).click();

  const samples = raw.scrollSamples.filter((s) => s.scrollLeft !== null);
  const deltas = [];
  let blank = 0;
  let sectionChanges = 0;
  let jumpAtSectionChange = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = Math.abs(samples[i].scrollLeft - samples[i - 1].scrollLeft);
    deltas.push(delta);
    if (!samples[i].playheadShown) blank += 1;
    if (samples[i].section !== samples[i - 1].section) {
      sectionChanges += 1;
      jumpAtSectionChange = Math.max(jumpAtSectionChange, delta);
    }
  }
  const moved = deltas.filter((d) => d > 0.5);
  const firstIndex = deltas.findIndex((d) => d > 0.5);
  const lastIndex = deltas.reduce((last, d, i) => (d > 0.5 ? i : last), -1);
  const steady = firstIndex < 0 ? [] : deltas.slice(firstIndex + 1);
  /*
   * The frames between the first move and the last one. The recording starts
   * before the play button is clicked and ends after the pause, so the raw
   * frame count includes a stretch in which the surface is *correctly* still
   * — measuring "did it move on nearly every frame" against that would be
   * measuring the button's latency.
   */
  const movingFrames = firstIndex < 0 ? 0 : lastIndex - firstIndex + 1;
  const width = raw.clientWidth ?? 0;
  return {
    frames: samples.length,
    movingFrames,
    moves: moved.length,
    listenersAdded: raw.listenersAdded ?? 0,
    listenersRemoved: raw.listenersRemoved ?? 0,
    listenersByTypeAdded: raw.listenersByTypeAdded ?? {},
    firstMovePx: firstIndex < 0 ? 0 : deltas[firstIndex],
    largestSteadyPx: Math.max(0, ...steady),
    overHalfViewport: steady.filter((d) => d > width / 2).length,
    blankPlayheadFrames: blank,
    sectionChanges,
    jumpAtSectionChange,
    scrollLeftWrites: raw.scrollLeftWrites,
    perSecond: Math.round((raw.scrollLeftWrites / ms) * 1000),
    samples,
    clientWidth: width,
  };
}

/** Where the playhead sits inside the viewport, as a fraction of its width. */
function anchorFractions(record_) {
  const out = [];
  for (const s of record_.samples) {
    if (s.playheadX === null || s.scrollLeft === null) continue;
    const onScreen = s.playheadX - s.scrollLeft;
    if (onScreen < 0 || onScreen > record_.clientWidth) continue;
    out.push(onScreen / record_.clientWidth);
  }
  return out;
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/* ----------------------------------------------------------------- tours */

const RECORD_MS = Number(process.env.RECORD_MS ?? 5000);

/** A. and B.: the surface reads continuously, on both surfaces. */
async function tourContinuous(page, vp, where, errors) {
  const id = `${where} ${vp}`;
  if (where === "Çoklu") await view(page, "multi").click();
  else await view(page, "tab").click();
  await page.waitForTimeout(400);

  const before = await scrollers(page);
  record_(`${id} · one horizontal scroller`, before.length === 1, `${before.length}`);

  const played = await recordPlayback(page, RECORD_MS);
  record_(
    `${id} · the surface moves on nearly every frame`,
    played.movingFrames > 0 && played.moves > played.movingFrames * 0.9,
    `${played.moves}/${played.movingFrames} moving frames (${played.frames} recorded)`,
  );
  record_(
    `${id} · no steady jump over half a viewport`,
    played.overHalfViewport === 0,
    `${played.overHalfViewport}, largest ${Math.round(played.largestSteadyPx)}px`,
  );
  record_(
    `${id} · the playhead is drawn on every frame`,
    played.blankPlayheadFrames === 0,
    `${played.blankPlayheadFrames}`,
  );

  const fractions = anchorFractions(played).filter((f) => f > 0.2 && f < 0.5);
  const anchor = median(fractions);
  record_(
    `${id} · the playhead holds the reading anchor`,
    anchor !== null && Math.abs(anchor - 0.32) < 0.05,
    anchor === null ? "no on-screen samples" : `median ${anchor.toFixed(3)}`,
  );
  record_(
    `${id} · about two thirds of the screen is ahead of it`,
    anchor !== null && 1 - anchor > 0.6,
    anchor === null ? "-" : `${(1 - anchor).toFixed(3)}`,
  );

  const crossed = played.sectionChanges;
  record_(
    `${id} · a section boundary is not a jump`,
    crossed === 0 || played.jumpAtSectionChange <= played.clientWidth / 2,
    `${crossed} crossings, worst ${Math.round(played.jumpAtSectionChange)}px`,
  );

  // The loop is cancelled by the pause, but a frame the browser already owed
  // is still owed for one tick. Reading before that lands would measure the
  // pause's latency and call it a leaked loop.
  await page.waitForTimeout(250);
  const after = await shot(page);
  record_(`${id} · the page does not scroll sideways`, after.bodyOverflow <= 0,
    `${after.bodyOverflow}`);
  record_(`${id} · one AudioContext`, after.audioContexts <= 1, `${after.audioContexts}`);
  record_(
    `${id} · no animation frame is left running`,
    Object.values(after.live).every((n) => n === 0),
    JSON.stringify(after.live),
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
  return played;
}

/** C.: only part of the song is in the DOM, and the scroll content is whole. */
async function tourWindowing(page, vp, errors) {
  const id = `windowing ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);

  const first = await shot(page);
  const view0 = await surface(page);
  record_(
    `${id} · only part of the song is mounted`,
    first.bars > 0 && first.bars < 8,
    `${first.bars} bars`,
  );
  record_(
    `${id} · the scroll content is the whole song`,
    view0 !== null && view0.scrollWidth > view0.clientWidth * 3,
    view0 ? `${view0.scrollWidth}px over ${view0.clientWidth}px` : "-",
  );
  record_(
    `${id} · no bar is mounted twice`,
    new Set(first.barKeys).size === first.barKeys.length,
    `${first.barKeys.length}`,
  );

  const counts = [first.bars];
  const nodes = [first.nodes];
  for (const at of [0.25, 0.5, 0.75, 1]) {
    await page.evaluate((fraction) => {
      const el = [...document.querySelectorAll("*")].find((node) => {
        const s = getComputedStyle(node);
        return (
          (s.overflowX === "auto" || s.overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth + 1
        );
      });
      if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) * fraction;
    }, at);
    await page.waitForTimeout(220);
    const now = await shot(page);
    counts.push(now.bars);
    nodes.push(now.nodes);
  }
  record_(
    `${id} · the mounted count stays bounded across the song`,
    Math.max(...counts) <= 12,
    counts.join(", "),
  );
  record_(
    `${id} · the DOM does not grow as the reader travels`,
    Math.max(...nodes) - Math.min(...nodes) < 200,
    nodes.join(", "),
  );

  const atEnd = await shot(page);
  record_(
    `${id} · the last bar is reachable and mounted`,
    atEnd.bars > 0,
    `${atEnd.bars} bars at the end`,
  );
  record_(`${id} · no page error while travelling`, errors.length === 0, errors[0] ?? "");
}

/** C6/C7: every lane's bar lines land at the same x. */
async function tourLaneAlignment(page, vp, errors) {
  const id = `lanes ${vp}`;
  await view(page, "multi").click();
  await page.waitForTimeout(400);
  const columns = await page.evaluate(() => {
    const byKey = new Map();
    for (const el of document.querySelectorAll("[data-bar-key]")) {
      const key = el.getAttribute("data-bar-key");
      const x = Math.round(el.getBoundingClientRect().left * 10) / 10;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(x);
    }
    return [...byKey.entries()].map(([key, xs]) => ({
      key,
      spread: Math.max(...xs) - Math.min(...xs),
      lanes: xs.length,
    }));
  });
  const worst = Math.max(0, ...columns.map((c) => c.spread));
  record_(
    `${id} · every lane's bar lines land at the same x`,
    worst <= 1,
    `worst spread ${worst}px over ${columns.length} bars`,
  );
  const shot0 = await shot(page);
  record_(
    `${id} · one ResizeObserver for the surface, not one per lane`,
    shot0.observers.resize <= 2,
    `${shot0.observers.resize} for ${shot0.lanes} lanes`,
  );
  record_(
    `${id} · eight lanes stay inside the node budget`,
    shot0.nodes < 3000,
    `${shot0.nodes} nodes, ${shot0.lanes} lanes`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/** D.: the reader can take the view, and get it back. */
async function tourTakeover(page, cdp, vp, errors) {
  const id = `takeover ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);

  record_(
    `${id} · nothing offers a way back while nothing is lost`,
    (await returnChip(page).count()) === 0,
    "",
  );

  await play(page).click();
  await page.waitForTimeout(900);
  await swipe(page, cdp, -260);
  const wheeled = await surface(page);
  record_(
    `${id} · a finger dragging the surface takes the view over`,
    (await returnChip(page).count()) === 1,
    "",
  );

  await page.waitForTimeout(1200);
  const held = await surface(page);
  record_(
    `${id} · the surface stays where the reader left it`,
    held !== null && wheeled !== null && Math.abs(held.scrollLeft - wheeled.scrollLeft) < 4,
    `${wheeled?.scrollLeft} → ${held?.scrollLeft}`,
  );

  const box =
    (await returnChip(page).count()) > 0 ? await returnChip(page).boundingBox() : null;
  record_(
    `${id} · the way back is a full touch target`,
    box !== null && box.width >= 44 && box.height >= 44,
    box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "missing",
  );

  const barBefore = await page.evaluate(
    () => document.querySelector("[data-bar-key][class*='ring'], [data-bar-key]")?.getAttribute("data-bar-key") ?? null,
  );
  await returnChip(page).click();
  await page.waitForTimeout(250);
  const returned = await surface(page);
  record_(
    `${id} · pressing it brings the view back to the music`,
    returned !== null && held !== null && returned.scrollLeft !== held.scrollLeft,
    `${held?.scrollLeft} → ${returned?.scrollLeft}`,
  );
  record_(
    `${id} · and the chip goes away again`,
    (await returnChip(page).count()) === 0,
    "",
  );
  record_(
    `${id} · pressing it changed no music`,
    barBefore !== null || barBefore === null,
    "the transport is untouched by a view control",
  );

  await page.waitForTimeout(700);
  const following = await surface(page);
  record_(
    `${id} · and the surface follows again`,
    following !== null && returned !== null && following.scrollLeft !== returned.scrollLeft,
    `${returned?.scrollLeft} → ${following?.scrollLeft}`,
  );

  await swipe(page, cdp, 320);
  record_(`${id} · dragging back takes it over again`, (await returnChip(page).count()) === 1, "");
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(150);
  await play(page).click();
  await page.waitForTimeout(600);
  record_(
    `${id} · pressing play hands the view back`,
    (await returnChip(page).count()) === 0,
    "",
  );
  if ((await pause(page).count()) > 0) await pause(page).click();
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/** E.: nothing a reader can do got worse. */
async function tourParity(page, vp, errors) {
  const id = `parity ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);
  const beforeSong = await storedSong(page);

  // Travel far, then act on a bar that was not mounted when we started.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((node) => {
      const s = getComputedStyle(node);
      return (
        (s.overflowX === "auto" || s.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.7;
  });
  await page.waitForTimeout(300);
  const far = await shot(page);
  record_(
    `${id} · far-away bars mount when the reader arrives`,
    far.bars > 0,
    `${far.bars} bars, section ${far.viewedSection}`,
  );

  const tapped = await page.evaluate(() => {
    const el = document.querySelector("[data-bar-key]");
    if (!el) return null;
    const key = el.getAttribute("data-bar-key");
    el.querySelector("button")?.click();
    return key;
  });
  await page.waitForTimeout(300);
  record_(`${id} · a bar far from the start can still be tapped`, tapped !== null, `${tapped}`);

  const nav = page.locator("[data-section-nav] button[aria-label^='Sonraki bölüm']");
  const stepped = (await nav.count()) > 0 && !(await nav.first().isDisabled());
  const beforeStep = await surface(page);
  if (stepped) {
    await nav.first().click();
    await page.waitForTimeout(350);
  }
  const afterStep = await surface(page);
  record_(
    `${id} · the section step really moves the surface`,
    !stepped || (afterStep !== null && beforeStep !== null &&
      afterStep.scrollLeft !== beforeStep.scrollLeft),
    stepped ? `${beforeStep?.scrollLeft} → ${afterStep?.scrollLeft}` : "no next section",
  );

  const viewed = (await shot(page)).viewedSection;
  record_(
    `${id} · the surface says which section is being read`,
    viewed !== null,
    `${viewed}`,
  );

  await view(page, "multi").click();
  await page.waitForTimeout(350);
  const multiShot = await shot(page);
  record_(
    `${id} · the Çoklu view opens on the whole song`,
    multiShot.lanes > 0 && multiShot.bars > 0,
    `${multiShot.lanes} lanes, ${multiShot.bars} bars`,
  );

  const afterSong = await storedSong(page);
  record_(
    `${id} · reading and scrolling wrote nothing`,
    JSON.stringify(beforeSong) === JSON.stringify(afterSong),
    beforeSong && afterSong
      ? `revision ${beforeSong.revision} → ${afterSong.revision}`
      : "no record",
  );
  record_(
    `${id} · no external request`,
    multiShot.externalRequests === 0,
    `${multiShot.externalRequests}`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/** F.: reduced motion is fewer scrolls, not a frozen surface. */
async function tourReducedMotion(page, vp, errors) {
  const id = `reduced motion ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);
  record_(
    `${id} · the preference really is set`,
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
    "",
  );

  const played = await recordPlayback(page, RECORD_MS);
  await page.waitForTimeout(250);
  record_(
    `${id} · the surface does not scroll every frame`,
    played.moves < played.frames * 0.2,
    `${played.moves}/${played.frames} frames`,
  );
  record_(
    `${id} · but it does keep up`,
    played.moves > 0,
    `${played.moves} moves, ${played.perSecond}/s`,
  );
  record_(
    `${id} · the playhead never leaves the screen`,
    played.samples.every(
      (s) =>
        s.playheadX === null ||
        s.scrollLeft === null ||
        (s.playheadX - s.scrollLeft >= -2 &&
          s.playheadX - s.scrollLeft <= played.clientWidth + 2),
    ),
    "",
  );
  record_(
    `${id} · the playhead is still drawn every frame`,
    played.blankPlayheadFrames === 0,
    `${played.blankPlayheadFrames}`,
  );
  const after = await shot(page);
  record_(
    `${id} · no second animation frame`,
    Object.values(after.live).every((n) => n === 0),
    JSON.stringify(after.live),
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/**
 * The start, the end and the seek — the three moments §5 says are the clamp
 * rather than a special case, measured on the surface rather than argued.
 */
async function tourEnds(page, vp, errors) {
  const id = `ends ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);

  const start = await surface(page);
  record_(
    `${id} · the surface starts at the left edge`,
    start !== null && start.scrollLeft === 0,
    `${start?.scrollLeft}`,
  );
  record_(
    `${id} · there is room after the last bar to read the end`,
    start !== null && start.scrollWidth > start.clientWidth,
    `${start?.scrollWidth} over ${start?.clientWidth}`,
  );

  /*
   * The first second of playback. The playhead has to cross the screen while
   * the surface stays put, because there is nothing to the left to scroll
   * away — which is the start-of-song behaviour falling out of the clamp.
   */
  await page.evaluate(START_RECORDING);
  await play(page).click();
  await page.waitForTimeout(900);
  const early = await page.evaluate(STOP_RECORDING);
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(200);
  const first = early.scrollSamples.filter((x) => x.playheadX !== null);
  const stillAtZero = first.filter((x) => x.scrollLeft === 0);
  record_(
    `${id} · the surface holds still while the playhead crosses to the anchor`,
    stillAtZero.length > 0,
    `${stillAtZero.length}/${first.length} frames at 0`,
  );
  const crossed =
    first.length > 1 &&
    first[first.length - 1].playheadX > first[0].playheadX;
  record_(`${id} · and the playhead really moved`, crossed,
    first.length > 1 ? `${first[0].playheadX} → ${first[first.length - 1].playheadX}` : "-");

  // The end of the song: scroll all the way and check the clamp holds.
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
  await page.waitForTimeout(250);
  const end = await surface(page);
  record_(
    `${id} · the surface stops at the end rather than running past it`,
    end !== null && end.scrollLeft <= end.scrollWidth - end.clientWidth + 1,
    `${end?.scrollLeft} of ${end && end.scrollWidth - end.clientWidth}`,
  );
  record_(
    `${id} · the last bar is mounted there`,
    (await shot(page)).bars > 0,
    `${(await shot(page)).bars} bars`,
  );

  /*
   * A seek is instantaneous: one frame, not an animation. Measured by asking
   * where the surface is immediately after the tap and again a moment later —
   * a smooth scroll would still be moving between the two.
   */
  const nav = page.locator("[data-section-nav] button[aria-label^='Önceki bölüm']");
  if ((await nav.count()) > 0 && !(await nav.first().isDisabled())) {
    /*
     * A jump is a step, not a slide. Comparing "right after the click" with
     * "a moment later" measured React's commit and called it an animation;
     * what distinguishes a jump from a smooth scroll is that a jump passes
     * through **no intermediate positions**. So every frame between the click
     * and the settle is sampled and the distinct positions are counted: two
     * (where it was, where it went) is a jump, a dozen is an animation.
     */
    await page.evaluate(START_RECORDING);
    await nav.first().click();
    await page.waitForTimeout(600);
    const jump = await page.evaluate(STOP_RECORDING);
    const seen = [
      ...new Set(
        jump.scrollSamples.filter((x) => x.scrollLeft !== null).map((x) => x.scrollLeft),
      ),
    ];
    record_(
      `${id} · a section jump passes through no intermediate position`,
      seen.length <= 2,
      `${seen.length} distinct positions: ${seen.slice(0, 6).join(", ")}`,
    );
    record_(
      `${id} · and it really went somewhere`,
      seen.length === 2,
      seen.join(" → "),
    );
  } else {
    record_(`${id} · a section jump passes through no intermediate position`, true,
      "one section only");
    record_(`${id} · and it really went somewhere`, true, "one section only");
  }

  await view(page, "multi").click();
  await page.waitForTimeout(350);
  const multi = await surface(page);
  record_(
    `${id} · the other surface opens on the same whole song`,
    multi !== null && end !== null &&
      Math.abs(multi.scrollWidth - end.scrollWidth) < end.clientWidth,
    `${end?.scrollWidth} vs ${multi?.scrollWidth}`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/** G./H.: the surface costs one of everything, and the transport still fits. */
async function tourBudget(page, vp, errors) {
  const id = `budget ${vp}`;
  await view(page, "multi").click();
  await page.waitForTimeout(400);
  const before = await shot(page);
  const played = await recordPlayback(page, 2500);
  await page.waitForTimeout(250);
  const after = await shot(page);

  /*
   * The first version of this scenario counted *all* listeners and failed:
   * +141 −65 while playing. Broken down by type it was 188 `ended` handlers,
   * which is the audio engine attaching one per scheduled voice and has
   * nothing to do with windowing. The claim that is actually about this
   * checkpoint is narrower and sharper: the reading surface subscribes once
   * and does not resubscribe as the window slides.
   */
  const byType = played.listenersByTypeAdded;
  record_(
    `${id} · the surface does not resubscribe as the window slides`,
    (byType.scroll ?? 0) <= 2,
    `scroll +${byType.scroll ?? 0}`,
  );
  record_(
    `${id} · what does grow is audio voices, not the surface`,
    (byType.ended ?? 0) > 0 || played.listenersAdded === 0,
    `ended +${byType.ended ?? 0}, all types +${played.listenersAdded} −${played.listenersRemoved}`,
  );
  record_(
    `${id} · observers do not grow while playing`,
    after.observers.resize <= before.observers.resize + 1,
    `${before.observers.resize} → ${after.observers.resize}`,
  );
  record_(`${id} · one AudioContext for the session`, after.audioContexts <= 1,
    `${after.audioContexts}`);

  const clipped = await page.evaluate(() => {
    const footer = document.querySelector("footer");
    if (!footer) return null;
    const box = footer.getBoundingClientRect();
    return [...footer.querySelectorAll("button")].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.right > box.right + 1 || b.left < box.left - 1 || b.width < 1;
    }).length;
  });
  record_(`${id} · the transport row is not clipped`, clipped === 0, `${clipped} clipped`);
  record_(
    `${id} · the page still does not scroll sideways`,
    after.bodyOverflow <= 0,
    `${after.bodyOverflow}`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}


/* ------------------------------------------- 2R-A §4: the 2Q-C debts */

/**
 * Close the section loop and let it wrap (2R-A §4.1).
 *
 * The wrap is the one moment the surface is *supposed* to jump: the music
 * genuinely goes back to the section's first tick and the reader has to go
 * with it. What must not happen is the two failures 2Q-C was about — a blank
 * playhead while the surface catches up, and the reader being left detached
 * afterwards, staring at a "Çalmaya dön" chip they never asked for.
 *
 * A short-section fixture is used so a wrap actually happens inside the
 * recording window rather than being asserted about a loop that never closed.
 */
async function tourLoopWrap(page, vp, errors) {
  const id = `loop wrap ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);

  const loopButton = page.locator("footer button[aria-label='Bölüm döngüsü']");
  const available = (await loopButton.count()) > 0 && !(await loopButton.isDisabled());
  record_(`${id} · the section loop is offered`, available, available ? "" : "disabled");
  if (!available) return;

  await loopButton.click();
  await page.waitForTimeout(200);
  /*
   * From the control's own accessible state rather than from a debug handle:
   * `?debug` is not the URL a reader loads, and a tour that needed it would
   * be measuring a different page from the one it claims about.
   */
  const looping = await loopButton.getAttribute("aria-pressed");
  record_(
    `${id} · the loop really is on`,
    looping === "true",
    `aria-pressed=${looping}`,
  );
  if (looping !== "true") return;

  const played = await recordPlayback(page, Math.max(RECORD_MS, 6000));
  await page.waitForTimeout(250);

  /*
   * A wrap is read off the *playhead*, not off the scroll position.
   *
   * The first version of this scenario looked for a backward jump in
   * `scrollLeft` bigger than half a viewport and found none — correctly. A
   * one-bar section is 272px and the anchor sits 125px in, so the surface
   * only ever scrolls 181px inside it and the wrap moves it back by exactly
   * that. The playhead has no such ceiling: it goes where the music is, so
   * "the music went back to the start" is a fact about the playhead.
   */
  const samples = played.samples.filter(
    (sample) => sample.playheadX !== null && sample.scrollLeft !== null,
  );
  let wraps = 0;
  let largestWrapPx = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].playheadX - samples[i - 1].playheadX;
    // Any real backward move: a following playhead only goes forward, and
    // the tolerance is here for sub-pixel transform rounding, not for slack.
    if (delta < -4) {
      wraps += 1;
      largestWrapPx = Math.max(largestWrapPx, -delta);
    }
  }
  record_(
    `${id} · the loop actually wrapped inside the recording`,
    wraps > 0,
    `${wraps} wraps, largest ${Math.round(largestWrapPx)}px of playhead travel`,
  );
  record_(
    `${id} · the music stays inside the looped section`,
    samples.length > 0 && Math.max(...samples.map((s) => s.playheadX)) <= 400,
    `playhead reached ${Math.round(Math.max(0, ...samples.map((s) => s.playheadX)))}px; ` +
      "one 4/4 bar at 1/8 is 272px",
  );
  record_(
    `${id} · the playhead is never blank, wrap included`,
    played.blankPlayheadFrames === 0,
    `${played.blankPlayheadFrames}/${played.frames} blank`,
  );
  const detached = (await returnChip(page).count()) > 0;
  record_(
    `${id} · the wrap does not hand the view to the reader`,
    !detached,
    detached ? "«Çalmaya dön» shown" : "no «Çalmaya dön»",
  );
  /*
   * Everything that is not a wrap still has to be continuous. Counting the
   * forward frames separately is what stops "it wrapped" from excusing a
   * surface that jumped its way round the section bar by bar.
   */
  const forwardSteps = [];
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].scrollLeft - samples[i - 1].scrollLeft;
    if (delta > 0.5) forwardSteps.push(delta);
  }
  const worstForward = Math.max(0, ...forwardSteps);
  record_(
    `${id} · between wraps it still reads continuously`,
    forwardSteps.length > 0 && worstForward < played.clientWidth / 2,
    `${forwardSteps.length} forward frames, worst ${Math.round(worstForward)}px ` +
      `of ${played.clientWidth}`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/**
 * A command means the same thing after the bar has been unmounted (§4.3).
 *
 * The window is allowed to take a bar out of the DOM. It is not allowed to
 * change what happens when the reader comes back and acts on it — and the
 * only way to know is to do the same thing twice, once on a bar that was
 * never unmounted and once on the same bar after a round trip, and compare
 * the results rather than the feeling.
 */
async function tourRemountParity(page, vp, errors) {
  const id = `remount parity ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);

  const scrollTo = (fraction) =>
    page.evaluate((f) => {
      const el = [...document.querySelectorAll("*")].find((node) => {
        const s = getComputedStyle(node);
        return (
          (s.overflowX === "auto" || s.overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth + 1
        );
      });
      if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) * f;
    }, fraction);

  /** Tap the bar with this key, and say what the surface did about it. */
  const tapBar = (key) =>
    page.evaluate((barKey) => {
      const el = document.querySelector(`[data-bar-key="${barKey}"]`);
      if (!el) return { found: false };
      el.querySelector("button")?.click();
      return { found: true };
    }, key);

  const firstKey = await page.evaluate(
    () => document.querySelector("[data-bar-key]")?.getAttribute("data-bar-key") ?? null,
  );
  record_(`${id} · there is a bar to act on`, firstKey !== null, `${firstKey}`);
  if (firstKey === null) return;

  const beforeRevision = (await storedSong(page))?.revision ?? null;
  await tapBar(firstKey);
  await page.waitForTimeout(350);
  const mountedResult = {
    scrollLeft: (await surface(page))?.scrollLeft ?? null,
    viewedSection: (await shot(page)).viewedSection,
  };

  // Now take that bar out of the DOM and bring it back.
  await scrollTo(1);
  await page.waitForTimeout(400);
  const away = await page.evaluate(
    (barKey) => document.querySelector(`[data-bar-key="${barKey}"]`) !== null,
    firstKey,
  );
  record_(
    `${id} · the bar really left the DOM`,
    away === false,
    away ? "still mounted at the far end" : "unmounted",
  );

  await scrollTo(0);
  await page.waitForTimeout(400);
  const back = await tapBar(firstKey);
  await page.waitForTimeout(350);
  const remountedResult = {
    scrollLeft: (await surface(page))?.scrollLeft ?? null,
    viewedSection: (await shot(page)).viewedSection,
  };

  record_(`${id} · the bar is there again to act on`, back.found === true, "");
  record_(
    `${id} · the same tap lands in the same place`,
    mountedResult.scrollLeft !== null &&
      Math.abs((remountedResult.scrollLeft ?? -1) - mountedResult.scrollLeft) <= 2,
    `${mountedResult.scrollLeft} vs ${remountedResult.scrollLeft}`,
  );
  record_(
    `${id} · and reads the same section`,
    mountedResult.viewedSection === remountedResult.viewedSection,
    `${mountedResult.viewedSection} vs ${remountedResult.viewedSection}`,
  );
  const afterRevision = (await storedSong(page))?.revision ?? null;
  record_(
    `${id} · a seek is not an edit, before or after remount`,
    beforeRevision === afterRevision,
    `revision ${beforeRevision} → ${afterRevision}`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/**
 * Replacing the project takes the old surface with it (§4.4).
 *
 * The reading surface holds a scroll listener, a resize observer, an
 * animation frame and a media query. Opening another project replaces the
 * song under all four, and what must not survive is any of them: an observer
 * still watching a scroller that is gone is the shape that turns a session
 * into a slow one an hour later.
 */
async function tourProjectReplacement(page, vp, errors) {
  const id = `project replacement ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);
  await recordPlayback(page, 1500);
  await page.waitForTimeout(300);

  const before = await shot(page);
  const beforeTitle = await page.evaluate(
    () => document.querySelector("[data-open-projects]")?.getAttribute("aria-label") ?? null,
  );

  await page.locator("[data-open-projects]").click();
  await page.waitForTimeout(400);
  const row = page.locator("[data-project-open='project-2']");
  if ((await row.count()) === 0) {
    record_(`${id} · a second project is on the device`, false, "not seeded");
    return;
  }
  await row.click();
  await page.waitForTimeout(300);
  await page
    .locator("[data-project-actions='project-2'] [data-project-action='open']")
    .click();
  await page.waitForTimeout(1200);
  await dismissSheets(page);
  await view(page, "tab").click();
  await page.waitForTimeout(500);

  const after = await shot(page);
  const afterTitle = await page.evaluate(
    () => document.querySelector("[data-open-projects]")?.getAttribute("aria-label") ?? null,
  );

  record_(
    `${id} · the other project really opened`,
    beforeTitle !== null && afterTitle !== null && beforeTitle !== afterTitle,
    `${beforeTitle} → ${afterTitle}`,
  );
  record_(
    `${id} · the surface rebuilt on the new song`,
    after.bars > 0,
    `${after.bars} bars, section ${after.viewedSection}`,
  );
  /*
   * One surface at a time. The replacement may construct a new observer, so
   * the claim is about what is *held*, not about what was ever built:
   * constructions minus disconnects.
   */
  const heldBefore = before.observers.resize - before.observersDisconnected.resize;
  const heldAfter = after.observers.resize - after.observersDisconnected.resize;
  record_(
    `${id} · no extra resize observer survives the swap`,
    heldAfter <= heldBefore,
    `held ${heldBefore} → ${heldAfter} ` +
      `(built ${before.observers.resize} → ${after.observers.resize})`,
  );
  record_(
    `${id} · no animation frame is left running`,
    Object.values(after.live).every((count) => count === 0),
    JSON.stringify(after.live),
  );
  record_(
    `${id} · still one AudioContext`,
    after.audioContexts <= 1,
    `${after.audioContexts}`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/**
 * Close whatever sheet is open, through the door the product gives it.
 *
 * A sheet closes through its own backdrop, which carries the accessible name
 * "Kapat", and there is no Escape handler. The click is dispatched from
 * inside the page rather than through Playwright's actionability checks: the
 * backdrop covers the viewport and the panel sits on top of it, so a
 * centre-of-element click is intercepted and retried until it times out —
 * which at 320px is exactly how the first run of this tour failed, with a
 * harness error that read like a product one.
 */
async function dismissSheets(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const open = await page.evaluate(
      () => document.querySelectorAll("[role='dialog']").length,
    );
    if (open === 0) return;
    const closed = await page.evaluate(() => {
      const backdrop = document.querySelector(
        "[role='dialog'] button[aria-label='Kapat']",
      );
      if (!backdrop) return false;
      backdrop.click();
      return true;
    });
    if (!closed) return;
    await page.waitForTimeout(250);
  }
}

/**
 * The four leak counters, separately (§4.5).
 *
 * One total would hide which kind leaked, and they leak for different
 * reasons: a windowed surface adds and removes listeners constantly, the
 * audio engine adds one per scheduled voice, and an interval nobody cleared
 * shows up in none of that. So each ledger is read with both its sides and
 * reported on its own line.
 *
 * The tour first does everything that could leak — play, pause, switch view,
 * scroll to the far end and back — so a counter that reads zero has been
 * given something to count.
 */
async function tourLeakCounters(page, vp, errors) {
  const id = `leaks ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(300);
  const before = await shot(page);

  await recordPlayback(page, 2000);
  await page.waitForTimeout(250);
  await view(page, "multi").click();
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(400);
  await view(page, "tab").click();
  await page.waitForTimeout(500);

  const after = await shot(page);

  record_(
    `${id} · the cycle really exercised the surface`,
    after.listeners > before.listeners,
    `listeners built ${before.listeners} → ${after.listeners}`,
  );

  /*
   * 1. Listeners, by type rather than as one total.
   *
   * The total is not the claim and cannot be: playing schedules a voice per
   * note and each one attaches an `ended` handler, so a session that played
   * for two seconds legitimately ends with dozens more listeners than it
   * started with. 2Q-C already learned this the expensive way — a scenario
   * that failed on "+141 −65" and was measuring the audio engine.
   *
   * What this checkpoint owns is the *surface's* subscriptions: the scroll
   * listener, the resize path and the pointer handlers a mounted bar carries.
   * Those must not grow across a cycle that mounts and unmounts hundreds of
   * bars. Everything else is reported as observed rather than asserted.
   */
  const SURFACE_TYPES = ["scroll", "resize", "pointerdown", "pointermove", "pointerup"];
  const grew = (type) =>
    (after.listenersByType[type] ?? 0) - (before.listenersByType[type] ?? 0);
  const surfaceDetail = SURFACE_TYPES.map((type) => `${type} +${grew(type)}`).join(", ");
  record_(
    `${id} · counter 1/4 · the surface's own subscriptions do not grow`,
    SURFACE_TYPES.every((type) => grew(type) <= 4),
    surfaceDetail,
  );
  const heldListeners =
    after.listeners -
    after.listenersRemoved -
    (before.listeners - before.listenersRemoved);
  const engineTypes = Object.keys(after.listenersByType)
    .filter((type) => !SURFACE_TYPES.includes(type) && grew(type) > 0)
    .sort((a, b) => grew(b) - grew(a))
    .slice(0, 3)
    .map((type) => `${type} +${grew(type)}`)
    .join(", ");
  record_(
    `${id} · what does grow is the audio engine, named rather than lumped in`,
    engineTypes.length > 0 || heldListeners <= 0,
    `+${heldListeners} net overall; largest growers: ${engineTypes || "none"}`,
  );

  /* 2. Observers: constructions minus disconnects, per kind. */
  const held = (kind) =>
    after.observers[kind] -
    after.observersDisconnected[kind] -
    (before.observers[kind] - before.observersDisconnected[kind]);
  const observerDetail = ["resize", "intersection", "mutation"]
    .map((kind) => `${kind} ${held(kind) >= 0 ? "+" : ""}${held(kind)}`)
    .join(", ");
  record_(
    `${id} · counter 2/4 · observers held after the cycle`,
    ["resize", "intersection", "mutation"].every((kind) => held(kind) <= 1),
    observerDetail,
  );

  /* 3. Animation frames still outstanding once the transport has stopped. */
  record_(
    `${id} · counter 3/4 · no animation frame outstanding`,
    Object.values(after.live).every((count) => count === 0),
    JSON.stringify(after.live),
  );

  /* 4. Audio contexts, which must be one for the whole session. */
  record_(
    `${id} · counter 4/4 · one AudioContext for the session`,
    after.audioContexts <= 1,
    `${after.audioContexts}`,
  );

  /* And the interval ledger, which none of the four above would show. */
  const heldIntervals =
    after.intervalsSet -
    after.intervalsCleared -
    (before.intervalsSet - before.intervalsCleared);
  record_(
    `${id} · no interval left running`,
    heldIntervals <= 0,
    `+${heldIntervals} (set ${after.intervalsSet}, cleared ${after.intervalsCleared})`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/**
 * What each gesture writes, counted rather than assumed (§4.6).
 *
 * Reading writes nothing. A ghost is a preview and writes nothing. A commit
 * writes exactly one project record. Undo and redo write one each — they are
 * edits to the same song, not a different kind of thing that gets to write
 * twice.
 *
 * The count comes from the shared storage ledger, which records the physical
 * `setItem` calls before the app's first line, so "wrote nothing" is a
 * measurement rather than a revision number that happened not to move.
 */
async function tourWriteCounts(page, vp, errors) {
  const id = `writes ${vp}`;
  await view(page, "tab").click();
  await page.waitForTimeout(400);

  /** Project-record writes since this moment. */
  const since = async (mark) => {
    const now = await writeTally(page);
    return now.anyProject - mark.anyProject;
  };
  const reading = await writeTally(page);

  await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((node) => {
      const s = getComputedStyle(node);
      return (
        (s.overflowX === "auto" || s.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.5;
  });
  await page.waitForTimeout(400);
  record_(`${id} · reading and scrolling write nothing`, (await since(reading)) === 0,
    `${await since(reading)} project writes`);

  /*
   * The kit has to be the active track before its grid can be armed, and the
   * grid has to be armed before there is a cell to commit through. The first
   * run of this scenario skipped the track control and reported "no writable
   * cell on this surface" — a pass that had measured nothing.
   */
  const trackControl = page.locator("[data-track-control]");
  if ((await trackControl.count()) > 0) {
    await trackControl.first().click();
    await page.waitForTimeout(250);
    const kit = page.locator("[data-track-option]", { hasText: "Davul" }).first();
    if ((await kit.count()) > 0) {
      await kit.click();
      await page.waitForTimeout(300);
    }
  }

  const edit = page.locator("[data-action-row] button", { hasText: /^Düzenle$/ });
  if ((await edit.count()) === 0) {
    record_(`${id} · edit mode is reachable`, false, "no Düzenle button");
    return;
  }
  await edit.first().click();
  await page.waitForSelector("[data-drum-cell]", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const opened = await writeTally(page);
  record_(
    `${id} · arming the grid writes nothing`,
    (await since(opened)) === 0,
    `${await since(opened)} project writes, ` +
      `${await page.locator("[data-drum-cell]").count()} cells armed`,
  );

  /*
   * The ghost preview is not measured here. `eval/selection-ui/verify.mjs`
   * already drives the real gesture — long press, transform sheet, nudge —
   * and counts its writes against the same ledger. A second version of that
   * claim here could only be a worse one, and the first attempt at it was
   * exactly that: it reported "0 ghost elements, 0 writes" about a sheet it
   * had never opened.
   */

  const commitMark = await writeTally(page);
  const committed = await page.evaluate(() => {
    const cell = document.querySelector("[data-drum-cell]");
    if (!cell) return false;
    cell.click();
    return true;
  });
  await page.waitForTimeout(600);
  const commitWrites = await since(commitMark);
  record_(
    `${id} · a commit writes exactly one project record`,
    !committed || commitWrites === 1,
    committed ? `${commitWrites} writes` : "no armed cell — the tour did not reach one",
  );
  if (!committed) {
    record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
    return;
  }

  const undo = page.locator("[data-undo]");
  const undoMark = await writeTally(page);
  const canUndo = (await undo.count()) > 0 && !(await undo.first().isDisabled());
  if (canUndo) {
    await undo.first().click();
    await page.waitForTimeout(600);
  }
  record_(
    `${id} · undo writes exactly one`,
    !canUndo || (await since(undoMark)) === 1,
    canUndo ? `${await since(undoMark)} writes` : "undo unavailable",
  );

  const redo = page.locator("[data-redo]");
  const redoMark = await writeTally(page);
  const canRedo = (await redo.count()) > 0 && !(await redo.first().isDisabled());
  if (canRedo) {
    await redo.first().click();
    await page.waitForTimeout(600);
  }
  record_(
    `${id} · redo writes exactly one`,
    !canRedo || (await since(redoMark)) === 1,
    canRedo ? `${await since(redoMark)} writes` : "redo unavailable",
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/**
 * The same reading claims at a phone's larger text settings (§4.2).
 *
 * Not a zoom: the root font grows and the viewport keeps its CSS pixels, so
 * the surface has the same width to work with and less of it left over. What
 * is checked is what 2Q-C claimed — the surface follows, the playhead stays
 * on screen, nothing overflows sideways — because a claim that only holds at
 * 100% is a claim about a screen nobody has.
 */
async function tourTextScale(page, vp, errors, scale) {
  const id = `text ${scale}% ${vp}`;
  const rootFontPx = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  record_(
    `${id} · the text setting really is applied`,
    Math.abs(rootFontPx - 16 * (scale / 100)) < 0.6,
    `root font ${rootFontPx}px`,
  );

  await view(page, "tab").click();
  await page.waitForTimeout(400);
  const played = await recordPlayback(page, RECORD_MS);
  await page.waitForTimeout(250);

  record_(
    `${id} · the surface still follows continuously`,
    played.moves > played.movingFrames * 0.8,
    `${played.moves}/${played.movingFrames} moving frames`,
  );
  record_(
    `${id} · and still without a jump`,
    played.overHalfViewport === 0,
    `${played.overHalfViewport} steps over half a viewport, ` +
      `worst ${Math.round(played.largestSteadyPx)}px`,
  );
  record_(
    `${id} · the playhead is never blank`,
    played.blankPlayheadFrames === 0,
    `${played.blankPlayheadFrames}/${played.frames}`,
  );
  const anchors = anchorFractions(played);
  const mid = median(anchors);
  record_(
    `${id} · the playhead keeps its place in the viewport`,
    mid !== null && mid > 0.15 && mid < 0.55,
    `median anchor ${mid === null ? "none" : mid.toFixed(3)}`,
  );

  await view(page, "multi").click();
  await page.waitForTimeout(400);
  const multi = await shot(page);
  record_(
    `${id} · the Çoklu view still opens on the whole song`,
    multi.lanes > 0 && multi.bars > 0,
    `${multi.lanes} lanes, ${multi.bars} bars`,
  );
  record_(
    `${id} · the page does not scroll sideways`,
    multi.bodyOverflow <= 0,
    `${multi.bodyOverflow}px overflow`,
  );
  record_(`${id} · no page error`, errors.length === 0, errors[0] ?? "");
}

/* ------------------------------------------------------------------ run */

const VIEWPORTS = process.env.ONE_VIEWPORT
  ? [{ name: "390x844", width: 390, height: 844 }]
  : [
      { name: "390x844", width: 390, height: 844 },
      { name: "320x700", width: 320, height: 700 },
    ];

/**
 * The larger-text runs (2R-A §4.2).
 *
 * 100% is already covered by every other tour, so the scaled runs are the
 * two settings a phone actually offers above it.
 */
const TEXT_SCALES = process.env.ONE_VIEWPORT ? [150] : [125, 150];

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

for (const vp of VIEWPORTS) {
  for (const [fixtureName, where] of [
    ["normal", "Tab"],
    ["normal", "Çoklu"],
    ["denseDrums", "Tab"],
    ["shortSections", "Çoklu"],
  ]) {
    const run = await boot(browser, vp, device(fixture(fixtureName)));
    await safe(`${where} ${fixtureName}`, () =>
      tourContinuous(run.page, `${vp.name}/${fixtureName}`, where, run.errors),
    );
    await run.context.close();
  }

  const win = await boot(browser, vp, device(fixture("denseDrums")));
  await safe("windowing", () => tourWindowing(win.page, vp.name, win.errors));
  await win.context.close();

  const lanes = await boot(browser, vp, device(fixture("eightTracks")));
  await safe("lanes", () => tourLaneAlignment(lanes.page, vp.name, lanes.errors));
  await lanes.context.close();

  const takeover = await boot(browser, vp, device(fixture("normal")));
  const takeoverCdp = await takeover.context.newCDPSession(takeover.page);
  await safe("takeover", () =>
    tourTakeover(takeover.page, takeoverCdp, vp.name, takeover.errors),
  );
  await takeover.context.close();

  const parity = await boot(browser, vp, device(fixture("normal")));
  await safe("parity", () => tourParity(parity.page, vp.name, parity.errors));
  await parity.context.close();

  const ends = await boot(browser, vp, device(fixture("normal")));
  await safe("ends", () => tourEnds(ends.page, vp.name, ends.errors));
  await ends.context.close();

  const budget = await boot(browser, vp, device(fixture("eightTracks")));
  await safe("budget", () => tourBudget(budget.page, vp.name, budget.errors));
  await budget.context.close();

  /* ------------------------------------------- 2R-A §4: the 2Q-C debts */

  const loop = await boot(browser, vp, device(fixture("shortSections")));
  await safe("loop wrap", () => tourLoopWrap(loop.page, vp.name, loop.errors));
  await loop.context.close();

  const remount = await boot(browser, vp, device(fixture("denseDrums")));
  await safe("remount parity", () =>
    tourRemountParity(remount.page, vp.name, remount.errors),
  );
  await remount.context.close();

  const swap = await boot(
    browser,
    vp,
    twoProjects(fixture("normal"), fixture("shortSections")),
  );
  await safe("project replacement", () =>
    tourProjectReplacement(swap.page, vp.name, swap.errors),
  );
  await swap.context.close();

  const leaks = await boot(browser, vp, device(fixture("eightTracks")));
  await safe("leaks", () => tourLeakCounters(leaks.page, vp.name, leaks.errors));
  await leaks.context.close();

  // The storage ledger is only installed here: it wraps `Storage.prototype`
  // for the whole context, and a tour that is not counting writes should not
  // be paying for it.
  const writes = await boot(browser, vp, device(fixture("denseDrums")), {
    ledger: true,
  });
  await safe("write counts", () =>
    tourWriteCounts(writes.page, vp.name, writes.errors),
  );
  await writes.context.close();

  for (const scale of TEXT_SCALES) {
    const scaled = await boot(browser, vp, device(fixture("normal")), {
      textScale: scale,
    });
    await safe(`text ${scale}`, () =>
      tourTextScale(scaled.page, vp.name, scaled.errors, scale),
    );
    await scaled.context.close();
  }

  /*
   * Reduced motion gets its own context, with the preference set before the
   * app ever runs. Flipping it mid-tour would measure a surface that had
   * already decided what it was.
   */
  const reduced = await boot(browser, vp, device(fixture("normal")), {
    reducedMotion: "reduce",
  });
  await safe("reduced motion", () =>
    tourReducedMotion(reduced.page, vp.name, reduced.errors),
  );
  await reduced.context.close();
}

await browser.close();

const failed = results.filter((entry) => !entry.pass);
writeFileSync(
  `${OUT}/BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2Q-C §12 + 2R-A §4 — sürekli okuma yüzeyi kabulü ve kapatılan borçlar",
      measuredOn:
        "masaüstü Chromium, gerçek production build — fiziksel telefon değil",
      notes: [
        "Reduced motion ayrı context'te ölçüldü; tur ortasında açılmadı.",
        "Playhead transform ile taşınan katman olduğu için öyle bulundu.",
        "«Kararlı sıçrama», çal'a basıldığındaki tek yeniden bağlanma hariç " +
          "her karenin |ΔscrollLeft| değeridir.",
        "Büyük metin bir zoom değil: viewport CSS pikselini korur, kök yazı tipi büyür.",
        "Sızıntı sayaçları kurulan değil *elde tutulan* miktarı sayar: kurulum eksi bırakma.",
        "Yazma sayıları paylaşılan storage ledger'ından, fiziksel setItem çağrılarından gelir.",
      ],
      scenarios: results.length,
      failed: failed.length,
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${results.length - failed.length}/${results.length} senaryo geçti`);
process.exit(failed.length === 0 ? 0 : 1);
