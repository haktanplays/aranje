/**
 * The gesture the founder could not make, measured through a real browser
 * (2U-C §5, §6).
 *
 * ## Why this harness exists at all
 *
 * The previous round's harness reported 108/108 across four viewports and ten
 * runs, and a person on a real Android phone then found the opposite:
 * «Ölçüye basılı tutulup sağa/sola sürüklendiğinde seçim genişlemiyor; arkadaki
 * tab yüzeyi kayıyor.» Both were honest. The harness was measuring the wrong
 * surface — its "the page underneath did not move" step read
 * `document.scrollingElement.scrollTop` on a route that is `overflow-hidden`,
 * so it was structurally zero whatever the gesture did, and the tab's own
 * `scrollLeft`, which is the surface the founder watched slide, was never
 * asserted at all.
 *
 * So every scroll assertion here names the element it reads, and the tab's
 * `scrollLeft` is the primary one. A step that cannot be made to fail by
 * breaking the thing it names is not a step.
 *
 * ## What this is not
 *
 * It is a **browser emulation**: Chromium with a touch-capable context, an
 * Android user-agent string and CDP touch events. That is enough to exercise
 * the pointer path, the ownership, the timers and the scroll surfaces, and it
 * is *not* a phone. Chromium's compositor here is not the one on the founder's
 * device, and the whole failure being fixed lived in the compositor. Nothing
 * in this file may be reported as a physical pass — HANDOFF.md is the physical
 * step, and it has not been run.
 *
 * ## What each run measures (§5)
 *
 * Start and end selection, how many bars or slots ended up held, the tab's
 * `scrollLeft`, the page's `scrollTop`, which owner took the pointer, whether
 * pointer capture was taken and when, whether a seek followed the gesture, how
 * many timers and animation frames were left open, and console errors.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3114";
const ROUTE = `${BASE}/eval/editor-acceptance`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ONLY = process.env.ONLY ?? "";

const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700 },
  { name: "390x844", width: 390, height: 844 },
  {
    name: "412x915",
    width: 412,
    height: 915,
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  },
  { name: "1363x936", width: 1363, height: 936, desktop: true },
];

const results = [];
let currentViewport = "";
let shots = 0;
let lastPage = null;

function flush() {
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        results,
        failed: results.filter((entry) => !entry.pass).length,
        screenshots: shots,
      },
      null,
      2,
    )}\n`,
  );
}

const record = (step, name, pass, detail = "") => {
  results.push({ viewport: currentViewport, step, name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${currentViewport} ${step} ${name}${detail ? `  — ${detail}` : ""}`,
  );
  flush();
};

/** A step that threw is a failed step, not a crashed run. */
async function safe(step, name, fn) {
  try {
    await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 140);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${currentViewport}-${step}.png` })
      .catch(() => {});
    record(step, name, false, `threw: ${first}`);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${currentViewport}-${name}.png` });
  shots += 1;
}

/*
 * The reader's own store, seeded before the page loads and read back at the
 * end. The acceptance route promises not to touch it (§9); this is how that
 * promise is checked rather than believed.
 */
const USER_KEY = "aranje.project.1";
const USER_VALUE = JSON.stringify({ sentinel: "founder's own project", n: 1 });

/**
 * The instruments, installed before the app's own script runs.
 *
 * Pointer capture and open timers cannot be read back from the DOM after the
 * fact — they have to be watched as they happen, which means wrapping the
 * platform before anything has a chance to call it. Counting rather than
 * listing: what matters is that nothing survives the gesture.
 */
const INSTRUMENT = `
  window.__consoleErrors = [];
  window.__captures = [];
  window.__timers = new Set();
  window.__frames = new Set();

  window.__cancels = [];
  for (const type of ["pointercancel", "lostpointercapture", "dragstart"]) {
    document.addEventListener(
      type,
      (event) => window.__cancels.push(type + ":" + (event.target && event.target.tagName)),
      true,
    );
  }

  const capture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) {
    window.__captures.push({ at: performance.now(), id });
    return capture.call(this, id);
  };

  const setInterval_ = window.setInterval;
  const clearInterval_ = window.clearInterval;
  window.__timerDelays = new Map();
  window.setInterval = function (...args) {
    const id = setInterval_.apply(window, args);
    window.__timers.add(id);
    window.__timerDelays.set(id, args[1]);
    return id;
  };
  window.clearInterval = function (id) {
    window.__timers.delete(id);
    return clearInterval_.call(window, id);
  };

  const raf = window.requestAnimationFrame;
  const caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    const id = raf.call(window, (t) => { window.__frames.delete(id); return fn(t); });
    window.__frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    window.__frames.delete(id);
    return caf.call(window, id);
  };
`;

async function open(browser, size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: !size.desktop,
    isMobile: !size.desktop,
    deviceScaleFactor: size.desktop ? 1 : 2,
    ...(size.ua ? { userAgent: size.ua } : {}),
  });
  await context.addInitScript(INSTRUMENT);
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* a private window is not a reason to fail the run */
      }
    },
    [USER_KEY, USER_VALUE],
  );
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(9000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((t) => window.__consoleErrors.push(t), message.text()).catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((t) => window.__consoleErrors.push(t), String(error)).catch(() => {});
  });
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  const cdp = size.desktop ? null : await context.newCDPSession(page);
  return { context, page, cdp };
}

/* ------------------------------------------------------------ measuring */

const tabScrollLeft = (page) =>
  page.evaluate(
    () => document.querySelector("[data-tab-content]")?.parentElement?.scrollLeft ?? -1,
  );

/**
 * How far the page itself has scrolled.
 *
 * Every candidate, not one: the acceptance route is `overflow-hidden`, so the
 * document's own `scrollTop` is structurally zero and reading only it is how
 * the previous round passed a step it was not testing. The largest offset
 * across the document and every ancestor of the tab is the honest answer to
 * "did anything underneath move vertically".
 */
const pageScrollTop = (page) =>
  page.evaluate(() => {
    let worst = document.scrollingElement?.scrollTop ?? 0;
    let node = document.querySelector("[data-tab-content]")?.parentElement ?? null;
    for (; node !== null; node = node.parentElement) {
      worst = Math.max(worst, node.scrollTop);
    }
    return worst;
  });

const barSummary = (page) =>
  page.evaluate(() => document.querySelector("[data-bar-summary]")?.textContent ?? null);

/** How wide the time-selection band is, in slots. Null when none is drawn. */
const bandSlots = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="time-selection-band"]');
    if (!el) return null;
    return Math.round(el.getBoundingClientRect().width / 34);
  });

const barsHeld = (summary) => {
  const match = /·\s*(\d+)\s+ölçü/.exec(summary ?? "");
  return match ? Number(match[1]) : 0;
};

const openWork = (page) =>
  page.evaluate(() => ({
    timers: window.__timers.size,
    frames: window.__frames.size,
    /* The delays, so a leak can be named rather than merely counted. */
    delays: [...window.__timers].map((id) => window.__timerDelays.get(id)),
  }));

const captures = (page) => page.evaluate(() => window.__captures.length);

/** Which bar the transport is sitting on, as the staff draws it. */
const activeBar = (page) =>
  page.evaluate(
    () =>
      document
        .querySelector("[data-bar-drag-index].border-steel")
        ?.getAttribute("data-bar-drag-index") ?? null,
  );

/** Everything that took the pointer away since the last reset. */
const takenAway = (page) => page.evaluate(() => window.__cancels.slice());
const forgetTakenAway = (page) => page.evaluate(() => { window.__cancels.length = 0; });
const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors.slice());

/* ------------------------------------------------------------- gestures */

async function down(page, cdp, x, y) {
  if (cdp === null) {
    await page.mouse.move(x, y);
    await page.mouse.down();
  } else {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
  }
}

async function moveTo(page, cdp, from, to, steps = 10, gap = 22) {
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    if (cdp === null) await page.mouse.move(x, y);
    else
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y, id: 1 }],
      });
    await page.waitForTimeout(gap);
  }
}

async function up(page, cdp) {
  if (cdp === null) await page.mouse.up();
  else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(380);
}

/**
 * Take the gesture away the way the platform does.
 *
 * `touchCancel` rather than a lifted finger, because the two mean opposite
 * things to the reader and the whole point of §2's cancel rule is that they
 * are not the same ending. On the desktop there is no touch to cancel, so the
 * page is told directly — the same event the browser would send.
 */
async function cancel(page, cdp) {
  if (cdp === null) {
    /*
     * At the element the gesture captured, not at the tab. Pointer capture
     * retargets the whole sequence, so a cancel delivered anywhere else is one
     * the handler never hears — and the step would then be reporting that the
     * app ignores cancels when what it ignored was the harness.
     */
    await page.evaluate(() => {
      const target =
        document.querySelector("[data-bar-drag-index='0'] [data-tab-bar-header]") ??
        document.querySelector("[data-tab-content]");
      target?.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
      );
    });
    await page.mouse.up().catch(() => {});
  } else {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  }
  await page.waitForTimeout(380);
}

/**
 * Scroll the staff the way this viewport's reader scrolls it.
 *
 * A dragged finger on a phone, a wheel on a desktop. Dragging with a held
 * mouse button does not scroll an `overflow-x-auto` container in any browser,
 * so a desktop run that dragged would report the tab as unscrollable and be
 * describing the harness rather than the app.
 */
async function scrollStaff(page, cdp) {
  await scrollTabTo(page, 0);
  const content = await page.locator("[data-tab-content]").boundingBox();
  const y = content.y + Math.min(content.height / 2, 140);
  const size = page.viewportSize() ?? { width: 400, height: 800 };
  if (cdp === null) {
    await page.mouse.move(size.width / 2, y);
    await page.mouse.wheel(320, 0);
    await page.waitForTimeout(400);
  } else {
    const start = { x: size.width - 40, y };
    await down(page, cdp, start.x, start.y);
    await moveTo(page, cdp, start, { x: 40, y }, 10, 16);
    await up(page, cdp);
  }
  return tabScrollLeft(page);
}

async function scrollTabTo(page, x) {
  await page.evaluate((left) => {
    const content = document.querySelector("[data-tab-content]");
    const scroller = content?.parentElement;
    if (scroller) scroller.scrollLeft = left;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    for (let node = scroller ?? null; node !== null; node = node.parentElement) {
      if (node.scrollTop !== 0) node.scrollTop = 0;
    }
  }, x);
  await page.waitForTimeout(260);
}

/** How far apart two neighbouring bars are drawn, in px. */
async function barPitch(page) {
  return page.evaluate(() => {
    const a = document.querySelector("[data-bar-drag-index='0']");
    const b = document.querySelector("[data-bar-drag-index='1']");
    if (!a || !b) return 600;
    return (
      Math.round(b.getBoundingClientRect().x - a.getBoundingClientRect().x) || 600
    );
  });
}

/**
 * Bring one bar into the drawn window and hand back its box.
 *
 * The tab windows horizontally (2Q-C): only the bars near the viewport exist in
 * the DOM, and at 320px a bar of sixteenths is wider than the screen, so at
 * most two of the four are ever present. Scroll, look, correct — the window
 * renders a spacer whose width changes as the window moves, so a position
 * computed from one window's geometry is wrong under the next one.
 */
async function showBar(page, barIndex) {
  const selector = `[data-bar-drag-index='${barIndex}']`;
  const WANT_X = 44;
  let estimate = Math.max(0, barIndex * (await barPitch(page)) - WANT_X);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await scrollTabTo(page, estimate);
    const box = await page.locator(selector).first().boundingBox().catch(() => null);
    if (box === null) {
      estimate += 200;
      continue;
    }
    const error = box.x - WANT_X;
    if (Math.abs(error) < 6) return box;
    estimate = Math.max(0, estimate + error);
  }
  const last = await page.locator(selector).first().boundingBox().catch(() => null);
  if (!last) throw new Error(`bar ${barIndex} not drawn after scrolling`);
  return last;
}

/**
 * A staff cell of this bar that is genuinely visible, as a point to press.
 *
 * Not "slot 0": the gutter is sticky and covers the left of whatever the
 * window has scrolled to, so the first slot of a bar is often under it. This
 * walks the drawn cells and takes the first one clear of the gutter and inside
 * the viewport.
 */
async function firstVisibleCell(page, barIndex) {
  const size = page.viewportSize() ?? { width: 400, height: 800 };
  const point = await page.evaluate(
    ([index, width, height]) => {
      const cells = document.querySelectorAll(
        `[data-bar-drag-index='${index}'] [data-cell]`,
      );
      for (const cell of cells) {
        const box = cell.getBoundingClientRect();
        if (box.x > 40 && box.right < width - 8 && box.y > 60 && box.bottom < height - 200) {
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
      }
      return null;
    },
    [barIndex, size.width, size.height],
  );
  if (!point) throw new Error(`bar ${barIndex} has no visible cell`);
  return point;
}

/** Where a press on this bar's header should land, kept inside the screen. */
async function headerPoint(page, barIndex) {
  const size = page.viewportSize() ?? { width: 400, height: 800 };
  const bar = await showBar(page, barIndex);
  const header = await page
    .locator(`[data-bar-drag-index='${barIndex}'] [data-tab-bar-header]`)
    .first()
    .boundingBox()
    .catch(() => null);
  const box = header ?? { x: bar.x, y: bar.y, width: 60, height: 22 };
  return {
    x: Math.min(Math.max(box.x + 24, 24), size.width - 24),
    y: box.y + box.height / 2,
  };
}

/**
 * Let go of whatever is selected, whichever of the two models holds it.
 *
 * Both action bars carry a labelled cancel; neither is always present. Named
 * by the label a reader reads rather than by a test id, so a step that clears
 * the screen is doing what a person would do.
 */
async function letGo(page) {
  for (const label of ["Ölçü seçimini iptal et", "Seçimi iptal et"]) {
    const control = page.getByRole("button", { name: label, exact: true });
    if (await control.count().catch(() => 0)) {
      await control.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

/** Into the tab, writing, with the fixture untouched. */
async function toEditor(page) {
  await page.locator("[data-acceptance-action]").first().click();
  await page.waitForTimeout(400);
  await page.locator("[data-testid=view-tab]").click();
  await page.waitForSelector("[data-tab-content]");
  const edit = page.getByRole("button", { name: "Düzenle", exact: true });
  if (await edit.count()) {
    await edit.first().click();
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(200);
}

/**
 * Where the finger should go to reach a named bar.
 *
 * Onto the bar when it is on the screen, and only to the edge band when it is
 * not. That is what a person does — nobody parks at the edge of a desktop
 * window to reach a bar they can see — and aiming at the edge regardless is
 * how the previous round's harness dragged straight past the bar it was
 * naming and produced a three-bar run where it wanted two. On a phone the
 * neighbour is never on screen (a bar of sixteenths is 544px wide), so the
 * edge band is the only answer there, which is exactly why §4 exists.
 */
async function reachPoint(page, barIndex, y) {
  const size = page.viewportSize() ?? { width: 400, height: 800 };
  const box = await page
    .locator(`[data-bar-drag-index='${barIndex}']`)
    .first()
    .boundingBox()
    .catch(() => null);
  const onScreen =
    box !== null && box.x > 8 && box.x + Math.min(box.width, 60) < size.width - 8;
  return onScreen
    ? { x: box.x + Math.min(box.width / 2, 40), y, parked: false }
    : { x: size.width - 14, y, parked: true };
}

/**
 * Hold the finger where it is until the run says the bars it wants are held,
 * or the patience runs out.
 *
 * A fixed dwell would measure how fast the edge follow is rather than whether
 * the range reaches the bar the step names — and it measures it differently on
 * every viewport, because how far away bar 3 is depends on how wide the screen
 * is. Waiting on the observable and reporting how long it took is the honest
 * version of the same step.
 */
async function waitForBars(page, want, budgetMs = 5000) {
  const trace = [];
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    const summary = await barSummary(page);
    if (trace.at(-1) !== summary) trace.push(summary);
    if (barsHeld(summary) === want) return { held: want, trace, ms: Date.now() - started };
    await page.waitForTimeout(60);
  }
  const summary = await barSummary(page);
  return { held: barsHeld(summary), trace, ms: Date.now() - started };
}

/* ------------------------------------------------------------- the run */

async function runViewport(browser, size) {
  currentViewport = size.name;
  const { context, page, cdp } = await open(browser, size);

  await safe(1, "the editor opens on the tab, writing", async () => {
    await toEditor(page);
    const strings = await page.locator("[data-string-line]").count();
    const bars = await page.locator("[data-bar-drag-index]").count();
    record(1, "the editor opens on the tab, writing", strings >= 6 && bars >= 1,
      `strings=${strings} drawnBars=${bars}`);
    await shot(page, "01-editor");
  });

  /* ------------------------------------------- §1 the founder's complaint */

  await safe(2, "a sideways swipe from a bar number does not slide the tab", async () => {
    /*
     * The founder's second sentence, and the one `pan-x` caused. A finger
     * that starts on a bar header and moves sideways immediately — before any
     * threshold could elapse — must not hand the compositor a scroll.
     */
    const point = await headerPoint(page, 0);
    const before = await tabScrollLeft(page);
    await down(page, cdp, point.x, point.y);
    await moveTo(page, cdp, point, { x: Math.max(point.x - 220, 8), y: point.y }, 12, 16);
    await up(page, cdp);
    const after = await tabScrollLeft(page);
    record(2, "a sideways swipe from a bar number does not slide the tab",
      Math.abs(after - before) < 8, `tab scrollLeft ${before} → ${after}`);
  });

  await safe(3, "the staff itself still scrolls, from the staff", async () => {
    const before = await tabScrollLeft(page);
    const after = await scrollStaff(page, cdp);
    record(3, "the staff itself still scrolls, from the staff",
      after - before > 60, `tab scrollLeft ${before} → ${after}`);
  });

  /* --------------------------------------------- §6 one bar, three, two */

  await safe(4, "a long press on bar 1 holds exactly one bar", async () => {
    await scrollTabTo(page, 0);
    const point = await headerPoint(page, 0);
    /*
     * Remembered, because from here until the finger lifts the harness must
     * not touch the tab. `headerPoint` scrolls to find its bar, and a harness
     * that scrolled the surface mid-drag would be moving the very thing the
     * next three steps are asking whether the *app* moved.
     */
    page.__anchor = point;
    page.__timersBefore = (await openWork(page)).timers;
    page.__framesBefore = (await openWork(page)).frames;
    page.__activeBefore = await activeBar(page);
    await forgetTakenAway(page);
    await down(page, cdp, point.x, point.y);
    await page.waitForTimeout(700);
    const summary = await barSummary(page);
    record(4, "a long press on bar 1 holds exactly one bar", barsHeld(summary) === 1,
      `summary="${summary}"`);
  });

  await safe(5, "the same finger reaches to bar 3 and the run says three", async () => {
    /*
     * Without lifting. On a phone bar 3 is off the side of the screen — a bar
     * of sixteenths is 544px wide — so the finger goes to the edge band and
     * waits for the view to bring the music to it. That is §4, and it is the
     * only way this gesture exists on a 320px screen at all.
     */
    const here = page.__anchor;
    const to = await reachPoint(page, 2, here.y);
    await moveTo(page, cdp, here, to, 8, 22);
    page.__reach = to;
    const reached = await waitForBars(page, 3);
    /*
     * The taken-away list is part of the claim, not decoration. On a mouse
     * this gesture was being killed by a native `dragstart` half a second in,
     * and a step that only checked the range would have reported "held=0"
     * without saying why — which is how a real cause gets read as flakiness.
     */
    const taken = (await takenAway(page)).filter((entry) =>
      entry.startsWith("pointercancel"),
    );
    record(5, "the same finger reaches to bar 3 and the run says three",
      reached.held === 3 && taken.length === 0,
      `held=${reached.held} after ${reached.ms}ms, trace=${JSON.stringify(reached.trace)}, tab scrollLeft ${await tabScrollLeft(page)}, takenAway=${JSON.stringify(taken)}`);
    await shot(page, "05-three-bars");
  });

  await safe(6, "coming back leaves two bars, not three", async () => {
    /*
     * Reversal, mid-gesture. The anchor never moves, so travelling back
     * shrinks the run from the far end rather than dragging the whole thing.
     */
    const y = page.__anchor.y;
    /*
     * Back onto bar 2 itself. After the reach the view has moved, so where
     * bar 2 *is* has to be asked again rather than remembered — and if it is
     * still off the screen the finger goes to the left band and waits for the
     * view to bring it back, which is the mirror of how it got there.
     */
    const back = await reachPoint(page, 1, y);
    const target = back.parked ? { x: 14, y } : back;
    await moveTo(page, cdp, page.__reach, target, 10, 22);
    const shrunk = await waitForBars(page, 2, 3000);
    record(6, "coming back leaves two bars, not three", shrunk.held === 2,
      `held=${shrunk.held}, trace=${JSON.stringify(shrunk.trace)}`);
  });

  await safe(7, "lifting fixes the run at two bars", async () => {
    await up(page, cdp);
    const summary = await barSummary(page);
    /*
     * And no seek followed it. A bar block is a button that seeks; before this
     * round the click a finished drag left behind jumped the playhead to
     * whatever the finger lifted over and carried the view there — the same
     * moving surface, one frame after the gesture instead of during it.
     *
     * Asked of the *playhead*, not of the scroll position. A view that moves
     * after a gesture can be the follow catching up or the window settling;
     * only the transport landing on a bar nobody chose is the defect §2 names,
     * and a step that could not tell those apart would be red for reasons it
     * could not explain.
     */
    await page.waitForTimeout(700);
    const active = await activeBar(page);
    record(7, "lifting fixes the run at two bars",
      barsHeld(summary) === 2 && active === page.__activeBefore,
      `summary="${summary}" active bar ${page.__activeBefore} → ${active}, tab scrollLeft ${await tabScrollLeft(page)}`);
    await shot(page, "07-two-bars");
  });

  await safe(8, "the page underneath never scrolled vertically", async () => {
    const top = await pageScrollTop(page);
    record(8, "the page underneath never scrolled vertically", top === 0,
      `worst scrollTop across the document and the tab's ancestors = ${top}`);
  });

  await safe(9, "the gesture took the pointer, and left no work behind", async () => {
    const work = await openWork(page);
    const took = await captures(page);
    /*
     * Against the count from before the gesture, not against zero. The app
     * keeps long-lived intervals of its own — a transport clock outlives every
     * gesture and should — so an absolute count would fail on something that
     * has nothing to do with this drag, which is a step that cannot be trusted
     * when it goes red. What §4 forbids is a timer *this gesture* opened
     * surviving the finger.
     */
    const leakedTimers = work.timers - page.__timersBefore;
    const leakedFrames = work.frames - page.__framesBefore;
    record(9, "the gesture took the pointer, and left no work behind",
      took > 0 && leakedTimers === 0 && leakedFrames === 0,
      `captures=${took} intervals ${page.__timersBefore} → ${work.timers} (delays ${JSON.stringify(work.delays)}), frames ${page.__framesBefore} → ${work.frames}`);
  });

  /* ------------------------------ §2 a drag that stays put moves nothing */

  await safe(10, "a reach that never touches the edge moves the tab not at all", async () => {
    /*
     * Separated from step 5 on purpose. §4's edge follow scrolls deliberately,
     * so a blanket "scrollLeft never changed" would either forbid the feature
     * or be satisfied by a gesture that does nothing. This is the founder's
     * actual complaint isolated: a finger dragging inside the screen must
     * leave the surface behind it exactly where it was.
     */
    await letGo(page);
    await scrollTabTo(page, 0);
    const point = await headerPoint(page, 0);
    const before = await tabScrollLeft(page);
    await down(page, cdp, point.x, point.y);
    await page.waitForTimeout(700);
    const size = page.viewportSize() ?? { width: 400, height: 800 };
    const inside = { x: Math.min(point.x + 120, size.width - 80), y: point.y };
    await moveTo(page, cdp, point, inside, 10, 22);
    const during = await tabScrollLeft(page);
    await up(page, cdp);
    record(10, "a reach that never touches the edge moves the tab not at all",
      during === before, `tab scrollLeft ${before} → ${during}`);
  });

  /* --------------------------------------------- §3 the note range drag */

  await safe(11, "a long press on a note holds one slot", async () => {
    await letGo(page);
    await showBar(page, 0);
    /*
     * A cell that is actually on the screen, chosen by looking rather than by
     * arithmetic. At 320px the sticky gutter covers the first slot of the bar
     * the window has just scrolled to, and a press aimed at slot 0 landed on
     * the gutter and selected nothing — which reads exactly like a broken
     * gesture and is in fact a harness pointing at furniture.
     */
    const point = await firstVisibleCell(page, 0);
    page.__timersBefore = (await openWork(page)).timers;
    page.__notePoint = point;
    const before = await tabScrollLeft(page);
    page.__noteScroll = before;
    await down(page, cdp, point.x, point.y);
    await page.waitForTimeout(700);
    const slots = await bandSlots(page);
    record(11, "a long press on a note holds one slot", slots === 1, `slots=${slots}`);
  });

  await safe(12, "reaching right grows the run slot by slot", async () => {
    const size = page.viewportSize() ?? { width: 400, height: 800 };
    const from = page.__notePoint;
    const to = { x: Math.min(from.x + 170, size.width - 70), y: from.y };
    await moveTo(page, cdp, from, to, 10, 22);
    page.__noteReach = to;
    const slots = await bandSlots(page);
    record(12, "reaching right grows the run slot by slot", (slots ?? 0) > 1,
      `slots=${slots}`);
    await shot(page, "12-note-range");
  });

  await safe(13, "coming back shrinks it again", async () => {
    const grown = await bandSlots(page);
    await moveTo(page, cdp, page.__noteReach, page.__notePoint, 10, 22);
    const shrunk = await bandSlots(page);
    record(13, "coming back shrinks it again",
      (shrunk ?? 0) >= 1 && (shrunk ?? 0) < (grown ?? 0),
      `slots ${grown} → ${shrunk}`);
  });

  await safe(14, "the staff behind the note drag stood still", async () => {
    const after = await tabScrollLeft(page);
    await up(page, cdp);
    record(14, "the staff behind the note drag stood still",
      after === page.__noteScroll, `tab scrollLeft ${page.__noteScroll} → ${after}`);
  });

  /* --------------------------------------------- §2 what a cancel means */

  await safe(15, "an interrupted drag gives back what it had selected", async () => {
    await letGo(page);
    await scrollTabTo(page, 0);
    const point = await headerPoint(page, 0);
    await down(page, cdp, point.x, point.y);
    await page.waitForTimeout(700);
    const held = barsHeld(await barSummary(page));
    const before = await openWork(page);
    await cancel(page, cdp);
    const after = await barSummary(page);
    const work = await openWork(page);
    record(15, "an interrupted drag gives back what it had selected",
      held === 1 &&
        barsHeld(after) === 0 &&
        work.timers <= before.timers &&
        work.frames <= before.frames,
      `held=${held} afterCancel="${after}" intervals ${before.timers} → ${work.timers}, frames ${before.frames} → ${work.frames}`);
  });

  await safe(16, "and the tab scrolls normally again afterwards", async () => {
    const before = await tabScrollLeft(page);
    const after = await scrollStaff(page, cdp);
    record(16, "and the tab scrolls normally again afterwards", after - before > 60,
      `tab scrollLeft ${before} → ${after}`);
  });

  /* -------------------------------------------------------- §9, §5 tail */

  await safe(17, "the reader's own project was never written to", async () => {
    const kept = await page.evaluate((key) => localStorage.getItem(key), USER_KEY);
    record(17, "the reader's own project was never written to", kept === USER_VALUE,
      kept === USER_VALUE ? "sentinel intact" : `sentinel now ${String(kept).slice(0, 60)}`);
  });

  await safe(18, "nothing was written to the console", async () => {
    const errors = await consoleErrors(page);
    record(18, "nothing was written to the console", errors.length === 0,
      errors.slice(0, 2).join(" | ").slice(0, 160));
  });

  await context.close();
}

const browser = await chromium.launch();
try {
  for (const size of VIEWPORTS) {
    if (ONLY && size.name !== ONLY) continue;
    await runViewport(browser, size);
  }
} finally {
  await browser.close();
}

const failed = results.filter((entry) => !entry.pass);
flush();
console.log(
  `\n${results.length - failed.length}/${results.length} — browser emulation, not a physical device`,
);
if (failed.length > 0) {
  for (const entry of failed) console.log(`  FAIL ${entry.viewport} ${entry.step} ${entry.name}`);
  process.exitCode = 1;
}
