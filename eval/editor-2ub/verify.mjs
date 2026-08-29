/**
 * The six live FAILs, measured through the editor a person actually uses
 * (2U-B §12).
 *
 * The previous round's harness tested the acceptance *route* — could the seven
 * steps be reached, did going back keep answers, did a run where nothing
 * happened report that honestly. It deliberately did not perform the editor
 * operations, because they needed a person. That was the right call then and
 * it is why the founder found six defects the harness could not: every one of
 * them lived in the gap between "the route works" and "the editing works".
 *
 * So this one does the operations. Real pointers on real controls, on the real
 * `Workspace` the acceptance route mounts — no internal command is called, no
 * hook is reached into, and every judgement is made from what a reader could
 * see on the screen.
 *
 * ## How a write is counted
 *
 * By the music, not by a wrapper. The tab renders the song, so the text of the
 * bars *is* a fingerprint of it: it changes exactly when the music does. "One
 * atomic history step" is then a claim anyone can check — the fingerprint
 * moved, one press of «Geri al» brings back the byte-identical old one, and
 * one «İleri al» brings back the new one. A count of storage writes would have
 * measured this harness's opinion of what a write is; a single undo restoring
 * the exact previous music is the reader's.
 *
 * ## Why the desktop context is not the phone four times
 *
 * `hasTouch` is off for the desktop viewport, so the pointer paths differ and
 * the gestures are dispatched differently — mouse events there, CDP touch
 * events on the three phones. A run that reported touch on a desktop would be
 * measuring the same branch four times and calling it coverage.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3110";
const ROUTE = `${BASE}/eval/editor-acceptance`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

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
let shots = 0;
let currentViewport = "";
let lastPage = null;

function flush() {
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      {
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

async function safe(step, name, fn) {
  try {
    await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 120);
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
 * end. The acceptance route promises not to touch it; this is how that promise
 * is checked rather than believed.
 */
const USER_KEY = "aranje.project.1";
const USER_VALUE = JSON.stringify({ sentinel: "founder's own project", n: 1 });

const INSTRUMENT = `
  window.__consoleErrors = [];
  window.__scrollDeltas = [];
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
  page.setDefaultTimeout(6000);
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

/* ------------------------------------------------------------- gestures */

/**
 * A press-and-hold, dispatched the way this viewport's pointer works.
 *
 * Mouse on the desktop, CDP touch on the phones. `moveTo` makes it a drag:
 * the finger travels after the threshold has elapsed, which is the gesture
 * the founder could not make.
 */
async function hold(page, cdp, x, y, { holdMs = 700, moveTo = null, dwellMs = 150 } = {}) {
  if (cdp === null) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(holdMs);
    if (moveTo) await page.mouse.move(moveTo.x, moveTo.y, { steps: 12 });
    await page.waitForTimeout(dwellMs);
    await page.mouse.up();
  } else {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await page.waitForTimeout(holdMs);
    if (moveTo) {
      const steps = 12;
      for (let i = 1; i <= steps; i += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: x + ((moveTo.x - x) * i) / steps,
              y: y + ((moveTo.y - y) * i) / steps,
              id: 1,
            },
          ],
        });
        await page.waitForTimeout(20);
      }
      /*
       * And then stay there. A bar of sixteenths is wider than a phone
       * screen, so reaching the neighbour means holding at the edge while the
       * view follows the finger — releasing the moment the travel ends would
       * measure how fast the scroll is rather than whether the range grows.
       */
      await page.waitForTimeout(dwellMs);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.waitForTimeout(450);
}

/**
 * A long press on one onset inside a named bar.
 *
 * Positioned from that bar's own header rather than from an absolute slot
 * count, because a 320px screen cannot show a whole bar of sixteenths and an
 * offset measured from the content's left edge would land in whichever bar
 * happened to be scrolled into view. The bar is scrolled to first, so the
 * press lands on the music the step names.
 */
/**
 * A long press on one slot of a named bar.
 *
 * On the cell the app itself draws (`data-cell="slot:string"`), not on a pixel
 * offset computed from the bar's left edge. The offset version put the finger
 * on empty air — a bar block starts with its header and the staff is inset, so
 * "the bar's x plus half a slot" is not where a note is — and every press
 * aimed that way selected nothing.
 *
 * Which string row does not matter: a long press names a *moment*, and
 * `onSlotLongPress` reads only the x. So any row of the slot will do, and
 * asking for a particular one would be asserting something the gesture does
 * not depend on.
 */
async function pressSlotInBar(page, cdp, barIndex, slot) {
  await showBar(page, barIndex);
  const cell = page
    .locator(`[data-bar-drag-index='${barIndex}'] [data-cell^='${slot}:']`)
    .first();
  const box = await cell.boundingBox();
  if (!box) throw new Error(`bar ${barIndex} slot ${slot} has no cell`);
  await hold(page, cdp, box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Hold one bar and reach to its neighbour, and say what ended up held.
 *
 * Self-contained on purpose: the steps that need a run of two bars make one
 * rather than inheriting whatever the previous step happened to leave behind.
 * A measurement that depends on a neighbour's leftovers reports the neighbour.
 */
async function dragTwoBars(page, cdp, fromBar = 0) {
  const size = page.viewportSize() ?? { width: 400, height: 800 };
  const bar = await showBar(page, fromBar);
  const header = await page
    .locator(`[data-bar-drag-index='${fromBar}'] [data-tab-bar-header]`)
    .first()
    .boundingBox();
  const box = header ?? { x: bar.x, y: bar.y, width: 60, height: 22 };
  const startX = Math.min(box.x + 24, size.width - 24);
  const y = box.y + box.height / 2;
  /*
   * Where the finger is going. If the neighbouring bar is already on screen —
   * which it is on a desktop, and never on a 320px phone — the finger goes
   * *onto* it, because that is what a person does and it names exactly one
   * neighbour. Only when the neighbour is off-view does the finger go to the
   * edge and wait for the view to bring it over: aiming at the edge when the
   * bar was visible all along dragged straight past it and produced a
   * three-bar run the step was not asking for.
   */
  const neighbour = await page
    .locator(`[data-bar-drag-index='${fromBar + 1}']`)
    .first()
    .boundingBox()
    .catch(() => null);
  const onScreen =
    neighbour !== null && neighbour.x + 24 < size.width && neighbour.x > startX;
  const edgeX = onScreen ? neighbour.x + 24 : size.width - 6;

  const down = async () => {
    if (cdp === null) {
      await page.mouse.move(startX, y);
      await page.mouse.down();
    } else {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: startX, y, id: 1 }],
      });
    }
  };
  const moveTo = async (x) => {
    if (cdp === null) await page.mouse.move(x, y);
    else {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y, id: 1 }],
      });
    }
  };
  const up = async () => {
    if (cdp === null) await page.mouse.up();
    else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  await down();
  await page.waitForTimeout(700); // past the long-press threshold
  for (let step = 1; step <= 10; step += 1) {
    await moveTo(startX + ((edgeX - startX) * step) / 10);
    await page.waitForTimeout(20);
  }
  /*
   * Hold at the edge until two bars are held, then let go — which is what a
   * person does. Releasing after a fixed dwell measured the scroll speed
   * instead: at 12px every 16ms the view crosses more than a bar in a second,
   * so a generous wait reached *past* the neighbour and produced a three-bar
   * run that later refused to repeat for want of room. Watching the summary
   * and stopping when it says what the step is about removes the race.
   */
  if (!onScreen) {
    for (let tick = 0; tick < 60; tick += 1) {
      const seen = (await barSummary(page)) ?? "";
      if (/·\s*2\s+ölçü/.test(seen)) break;
      await moveTo(edgeX);
      await page.waitForTimeout(50);
    }
  } else {
    await page.waitForTimeout(250);
  }
  await up();
  await page.waitForTimeout(450);
  return (await barSummary(page)) ?? "";
}

/** Take hold of one bar, in whatever scope the tab is currently offering. */
async function selectOneBar(page, cdp, barIndex = 0) {
  await pressBarHeader(page, cdp, barIndex);
  return (await barSummary(page)) ?? "";
}

/**
 * Where the fixture's notes are, so a step names music rather than a number.
 *
 * Bar 1 opens on a chord that includes an open low E — the selection the
 * string move must refuse. Bar 3 is the mid-neck motif where both string
 * moves are real. Bar 2 is empty, which is what makes it a paste target.
 */
const MOTIF_BAR = 0;
const MOTIF_SLOT = 0;
const EMPTY_BAR = 1;
const RESTRING_BAR = 2;
const RESTRING_SLOT = 0;

/** A long press on one bar's header, having scrolled it into view first. */
async function pressBarHeader(page, cdp, barIndex, options = {}) {
  const bar = await showBar(page, barIndex);
  const header = await page
    .locator(`[data-bar-drag-index='${barIndex}'] [data-tab-bar-header]`)
    .first()
    .boundingBox();
  const box = header ?? { x: bar.x, y: bar.y, width: 60, height: 22 };
  const midY = box.y + box.height / 2;
  /*
   * Near the header's left edge, not its centre. A bar of sixteenths is 543px
   * wide, so on a 320px screen the centre of its header is off the right of
   * the viewport and a press aimed there lands on nothing — the run reported
   * an empty selection summary and no scope, which looked like the gesture
   * failing when it was the harness aiming outside the window.
   */
  const view = page.viewportSize() ?? { width: 320, height: 700 };
  const x = Math.min(box.x + 24, view.width - 24);
  /*
   * What is actually under the finger, recorded whether or not the press
   * works. A gesture that fails because something else was on top of the
   * target is a different bug from one that fails because the gesture is
   * wrong, and a harness that cannot tell them apart sends you looking in the
   * wrong file — as this one did until it started reporting the hit.
   */
  const hit = await page.evaluate(([px, py]) => {
    const node = document.elementFromPoint(px, py);
    if (!node) return "nothing";
    const owner = node.closest("[data-tab-bar-header]") ? "header" : "other";
    return `${node.tagName}/${owner}`;
  }, [x, midY]);
  /* A drag stays on the header row unless the caller says otherwise. */
  const moveTo = options.moveTo
    ? { x: options.moveTo.x, y: options.moveTo.y || midY }
    : null;
  await hold(page, cdp, x, midY, { ...options, moveTo });
  return { x, y: midY, hit };
}

/* ------------------------------------------------------------ readings */

/** Roughly a bar's width, for scrolling one into view. Measured, not assumed. */
async function barPitch(page) {
  return page.evaluate(() => {
    const bars = [...document.querySelectorAll("[data-bar-drag-index]")];
    if (bars.length < 2) return 600;
    const a = bars[0].getBoundingClientRect();
    const b = bars[1].getBoundingClientRect();
    return Math.round(b.x - a.x) || 600;
  });
}

async function scrollTabTo(page, x) {
  await page.evaluate((left) => {
    const content = document.querySelector("[data-tab-content]");
    const scroller = content?.parentElement;
    if (scroller) scroller.scrollLeft = left;
    /*
     * And put the vertical position back where the reader left it: at the
     * top. Playwright scrolls an element into view before clicking it, so
     * opening a sheet near the bottom of a phone screen can push the staff up
     * — the bar headers ended up at y=-28 and every press aimed at one landed
     * on nothing above the viewport. Resetting here rather than at each press
     * keeps the correction in the one place that already owns scrolling.
     */
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    for (
      let node = content?.parentElement ?? null;
      node !== null;
      node = node.parentElement
    ) {
      if (node.scrollTop !== 0) node.scrollTop = 0;
    }
  }, x);
  await page.waitForTimeout(280);
}

/**
 * Bring one bar into the drawn window and hand back its box.
 *
 * The tab windows horizontally (2Q-C): only the bars near the viewport exist
 * in the DOM at all, and at 320px a bar of sixteenths is wider than the
 * screen, so at most two of the four are ever present. A harness that assumed
 * all four would not be testing a narrower phone — it would be failing to
 * reach the music it named.
 */
async function showBar(page, barIndex) {
  const selector = `[data-bar-drag-index='${barIndex}']`;
  /* Where the bar's left edge should end up: clear of the sticky gutter. */
  const WANT_X = 44;
  let estimate = Math.max(0, barIndex * (await barPitch(page)) - WANT_X);

  /*
   * Scroll, look, correct — rather than scroll once and trust the arithmetic.
   *
   * The window renders a spacer for the bars it is not drawing, and that
   * spacer's width changes as the window moves, so a position computed from
   * one window's geometry is wrong under the next one. The first attempt here
   * put bar 2 at x=-38 instead of x=74, entirely off the left edge, and every
   * press aimed at it landed on nothing. Measuring the answer and adjusting by
   * the error converges in one or two passes and cannot drift.
   */
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
 * The music, as the reader sees it — all of it.
 *
 * The tab renders the song, so its text changes exactly when the music does.
 * But it renders only the *windowed* part, so a reading taken at one scroll
 * position and compared with one taken at another would differ because the
 * view moved rather than because anything was edited. So the fingerprint
 * sweeps the whole song and records what each bar index showed, keyed by that
 * index: scroll-independent, and still nothing but what a reader could see.
 *
 * Used for every "one atomic step" claim — the fingerprint moved, one undo
 * brings the old one back byte-identical, one redo brings the new one back.
 * A count of storage writes would have measured this harness's opinion of
 * what a write is; a single undo restoring the exact previous music is the
 * reader's.
 */
async function fingerprint(page) {
  const pitch = await barPitch(page);
  const seen = new Map();
  const width = await page.evaluate(
    () => document.querySelector("[data-tab-content]")?.parentElement?.scrollWidth ?? 0,
  );
  for (let x = 0; x <= width + pitch; x += Math.max(200, Math.floor(pitch / 2))) {
    await scrollTabTo(page, x);
    const bars = await page.evaluate(() =>
      [...document.querySelectorAll("[data-bar-drag-index]")].map((node) => [
        node.getAttribute("data-bar-drag-index"),
        node.textContent ?? "",
      ]),
    );
    for (const [index, text] of bars) if (!seen.has(index)) seen.set(index, text);
  }
  await scrollTabTo(page, 0);
  return [...seen.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([index, text]) => `${index}:${text}`)
    .join("\n");
}

/** How many bars the song has, counted across the whole sweep. */
async function songBars(page) {
  const printed = await fingerprint(page);
  return printed.split("\n").filter((line) => line.length > 0).length;
}

const errors = (page) => page.evaluate(() => window.__consoleErrors ?? []);
const userStore = (page) =>
  page.evaluate((key) => localStorage.getItem(key), USER_KEY);

const barSummary = (page) =>
  page.locator("[data-bar-summary]").textContent().catch(() => null);

async function openDrawer(page) {
  await page.locator("[data-selection-more]").click();
  await page.waitForSelector("[role=dialog]");
  await page.waitForTimeout(250);
}

/**
 * Dismiss an open sheet the way a reader does — by pressing outside it.
 *
 * The backdrop is a full-bleed button with the panel drawn on top, so a click
 * aimed at its centre lands on the panel and is refused as intercepted. Sheets
 * also stack, so this closes the topmost until none is left.
 */
async function closeSheet(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const close = page.locator("[role=dialog] [aria-label=Kapat]");
    if ((await close.count()) === 0) break;
    await close.last().click({ position: { x: 6, y: 6 } });
    await page.waitForTimeout(320);
  }
}

/**
 * Press undo, or say that it was shut.
 *
 * Never `click()` on a disabled control: Playwright waits for it to become
 * enabled and the step dies thirty seconds later with a timeout, which
 * describes the harness rather than the app. A shut undo where the step needs
 * one is a real failure and should be reported as that.
 */
async function undo(page) {
  const button = page.locator("[data-undo]").first();
  if (await button.isDisabled().catch(() => true)) return false;
  await button.click();
  await page.waitForTimeout(400);
  return true;
}

async function redo(page) {
  const button = page.locator("[data-redo]").first();
  if (await button.isDisabled().catch(() => true)) return false;
  await button.click();
  await page.waitForTimeout(400);
  return true;
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
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(200);
}

/* ------------------------------------------------------------- the run */

async function runViewport(browser, size) {
  currentViewport = size.name;
  const { context, page, cdp } = await open(browser, size);
  const storeBefore = await userStore(page);

  await safe(1, "the editor opens on the two-track fixture", async () => {
    await toEditor(page);
    const strings = await page.locator("[data-string-line]").count();
    /*
     * Counted across a sweep, not from what happens to be drawn: the tab
     * windows horizontally, and at 320px a bar of sixteenths is wider than
     * the screen. Two tracks is what makes "the operation reached every
     * track" falsifiable at all, so it is checked from the instrument strip
     * rather than inferred.
     */
    const bars = await songBars(page);
    await page.locator("[data-track-control]").first().click();
    await page.waitForSelector("[role=dialog]");
    await page.waitForTimeout(250);
    const tracks = await page.locator("[data-track-option]").count();
    await closeSheet(page);
    record(1, "the editor opens on the two-track fixture",
      strings >= 6 && bars === 4 && tracks >= 2,
      `strings=${strings} bars=${bars} tracks=${tracks}`);
    await shot(page, "01-editor");
  });

  /* ---------------------------------------------- §3 the clipboard */

  await safe(2, "copying a run writes nothing", async () => {
    await pressSlotInBar(page, cdp, MOTIF_BAR, MOTIF_SLOT);
    const before = await fingerprint(page);
    await openDrawer(page);
    await page.locator("[data-selection-action=Kopyala]").click();
    await page.waitForTimeout(400);
    const after = await fingerprint(page);
    record(2, "copying a run writes nothing", before === after && before.length > 0,
      `len=${before.length}`);
  });

  await safe(3, "the clipboard survives the selection changing", async () => {
    /* The founder's exact path: copy, then select the empty target. */
    await pressSlotInBar(page, cdp, EMPTY_BAR, 0);
    await openDrawer(page);
    const paste = page.locator("[data-selection-action=Yapıştır]");
    const drawn = await paste.count();
    const enabled = drawn > 0 ? !(await paste.first().isDisabled()) : false;
    record(3, "the clipboard survives the selection changing", drawn > 0 && enabled,
      `drawn=${drawn} enabled=${enabled}`);
    await shot(page, "02-paste-offered");
  });

  await safe(4, "a paste preview writes nothing and cancels clean", async () => {
    const before = await fingerprint(page);
    await page.locator("[data-selection-action=Yapıştır]").click();
    await page.waitForSelector("[role=dialog]");
    await page.waitForTimeout(300);
    const previewed = await page.locator("[data-testid=transform-preview]").count();
    const duringPreview = await fingerprint(page);
    await page.getByRole("button", { name: "Vazgeç", exact: true }).first().click();
    await page.waitForTimeout(400);
    const after = await fingerprint(page);
    record(4, "a paste preview writes nothing and cancels clean",
      previewed > 0 && duringPreview === before && after === before,
      `preview=${previewed} unchanged=${after === before}`);
  });

  await safe(5, "applying the paste changes the music once", async () => {
    const before = await fingerprint(page);
    await openDrawer(page);
    await page.locator("[data-selection-action=Yapıştır]").click();
    await page.waitForSelector("[role=dialog]");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Uygula", exact: true }).first().click();
    await page.waitForTimeout(500);
    const after = await fingerprint(page);
    record(5, "applying the paste changes the music once", after !== before,
      `changed=${after !== before}`);
    page.__beforePaste = before;
    page.__pasted = after;
    await shot(page, "03-pasted");
  });

  /* ------------------------------- §4 undo/redo, tied to that paste */

  await safe(6, "one undo brings the pre-paste music back byte-equal", async () => {
    const applied = page.__pasted !== page.__beforePaste;
    if (!applied) {
      record(6, "one undo brings the pre-paste music back byte-equal", false,
        "BLOCKED_BY_PASTE: the paste never changed the music");
      return;
    }
    await undo(page);
    const now = await fingerprint(page);
    record(6, "one undo brings the pre-paste music back byte-equal",
      now === page.__beforePaste, `equal=${now === page.__beforePaste}`);
  });

  await safe(7, "one redo brings the pasted music back byte-equal", async () => {
    const applied = page.__pasted !== page.__beforePaste;
    if (!applied) {
      record(7, "one redo brings the pasted music back byte-equal", false,
        "BLOCKED_BY_PASTE: the paste never changed the music");
      return;
    }
    await redo(page);
    const now = await fingerprint(page);
    record(7, "one redo brings the pasted music back byte-equal",
      now === page.__pasted, `equal=${now === page.__pasted}`);
    await undo(page);
  });

  /* ---------------------------------------- §5 moving between strings */

  await safe(8, "a mid-neck note moves to a thinner string", async () => {
    /*
     * Bar 3, not bar 1. Bar 1 opens on an open low E — no thinner string can
     * sound an E2 and there is no thicker one — so the guide used to ask for
     * a movement the fretboard does not have. This one has neighbours both
     * ways, which is what makes the step able to succeed *and* able to fail.
     */
    const before = await fingerprint(page);
    await pressSlotInBar(page, cdp, RESTRING_BAR, RESTRING_SLOT);
    await page.locator("[data-selection-verb='Taşı']").click();
    await page.waitForSelector("[role=dialog]");
    await page.locator("[data-testid=move-mode-string]").click();
    await page.waitForTimeout(200);
    await page.locator("[data-testid=restring-1]").click();
    await page.waitForTimeout(250);
    const preview = await page
      .locator("[data-testid=transform-preview]")
      .textContent()
      .catch(() => "");
    await page.getByRole("button", { name: "Uygula", exact: true }).first().click();
    await page.waitForTimeout(450);
    const after = await fingerprint(page);
    record(8, "a mid-neck note moves to a thinner string", after !== before,
      `preview="${(preview ?? "").slice(0, 40)}"`);
    page.__thin = { before, after };
  });

  await safe(9, "one undo takes the thinner move back byte-equal", async () => {
    if (!page.__thin || page.__thin.after === page.__thin.before) {
      record(9, "one undo takes the thinner move back byte-equal", false,
        "BLOCKED: the thinner move never changed the music");
      return;
    }
    await undo(page);
    const now = await fingerprint(page);
    record(9, "one undo takes the thinner move back byte-equal",
      now === page.__thin.before, `equal=${now === page.__thin.before}`);
  });

  await safe(10, "the same note moves to a thicker string", async () => {
    const before = await fingerprint(page);
    await pressSlotInBar(page, cdp, RESTRING_BAR, RESTRING_SLOT);
    await page.locator("[data-selection-verb='Taşı']").click();
    await page.waitForSelector("[role=dialog]");
    await page.locator("[data-testid=move-mode-string]").click();
    await page.waitForTimeout(200);
    await page.locator("[data-testid=restring--1]").click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Uygula", exact: true }).first().click();
    await page.waitForTimeout(450);
    const after = await fingerprint(page);
    record(10, "the same note moves to a thicker string", after !== before,
      `changed=${after !== before}`);
    if (after !== before) await undo(page);
    await shot(page, "04-restrung");
  });

  await safe(11, "an unplayable string move is refused, typed, and shut", async () => {
    /*
     * The other half of §5, and the half a green-only package would never
     * have. The chord in bar 1 holds an open low E; no thinner string can
     * sound it, so the command must refuse — visibly, with a sentence, and
     * with "Uygula" closed rather than live.
     */
    const before = await fingerprint(page);
    await pressSlotInBar(page, cdp, MOTIF_BAR, MOTIF_SLOT);
    await page.locator("[data-selection-verb='Taşı']").click();
    await page.waitForSelector("[role=dialog]");
    await page.locator("[data-testid=move-mode-string]").click();
    await page.waitForTimeout(200);
    await page.locator("[data-testid=restring-1]").click();
    await page.waitForTimeout(300);
    const text = (await page
      .locator("[data-testid=transform-preview]")
      .textContent()
      .catch(() => "")) ?? "";
    const apply = page.getByRole("button", { name: "Uygula", exact: true }).first();
    const shut = await apply.isDisabled().catch(() => false);
    await closeSheet(page);
    const after = await fingerprint(page);
    record(11, "an unplayable string move is refused, typed, and shut",
      /çalınamıyor|hedef tel yok/i.test(text) && shut && after === before,
      `said="${text.slice(0, 46)}" applyShut=${shut} unchanged=${after === before}`);
    await shot(page, "05-refusal");
  });

  /* ------------------------------- §6 §10 three scopes, three verb sets */

  await safe(12, "a note selection offers the clipboard and no measure verb", async () => {
    await pressSlotInBar(page, cdp, MOTIF_BAR, MOTIF_SLOT);
    await openDrawer(page);
    const labels = await page.locator("[data-selection-action]").allTextContents();
    const text = labels.join(" | ");
    const hasClipboard = /Kopyala/.test(text) && /Yapıştır/.test(text);
    const hasMeasure = /ölçü ekle|Ölçüyü kaldır|Ölçü ve ritim/i.test(text);
    await closeSheet(page);
    record(12, "a note selection offers the clipboard and no measure verb",
      hasClipboard && !hasMeasure, `verbs=[${labels.join(", ")}]`);
  });

  await safe(13, "one instrument's bar offers content verbs and no bar-adding one",
    async () => {
      const press = await pressBarHeader(page, cdp, 0);
      const scope = await page
        .locator("[data-bar-scope][aria-checked=true]")
        .getAttribute("data-bar-scope")
        .catch(() => null);
      const primary = await page.locator("[data-bar-action]").allTextContents();
      const text = primary.join(" | ");
      record(13, "one instrument's bar offers content verbs and no bar-adding one",
        scope === "track" && /İçeriği sil/.test(text) && !/Ölçüyü kaldır/.test(text),
        `scope=${scope} hit=${press.hit}@${Math.round(press.x)},${Math.round(press.y)} verbs=[${primary.join(", ")}]`);
      await shot(page, "06-track-scope");
    });

  await safe(14, "no door is opened onto an empty dialog", async () => {
    /*
     * The founder's empty "Ölçü işlemleri". Either the door is absent or the
     * panel behind it has something in it — never a titled sheet with nothing.
     */
    const door = page.locator("[data-bar-action=more]");
    const shown = await door.count();
    let panelControls = -1;
    if (shown > 0) {
      await door.click();
      await page.waitForSelector("[role=dialog]");
      await page.waitForTimeout(250);
      panelControls = await page.locator("[role=dialog] section button").count();
      await closeSheet(page);
    }
    record(14, "no door is opened onto an empty dialog",
      shown === 0 || panelControls > 0,
      `door=${shown} panelControls=${panelControls}`);
  });

  await safe(15, "the whole measure is reachable and offers the structural verbs",
    async () => {
      await page.locator("[data-bar-scope=full]").click();
      await page.waitForTimeout(300);
      const scope = await page
        .locator("[data-bar-scope][aria-checked=true]")
        .getAttribute("data-bar-scope")
        .catch(() => null);
      const summary = (await barSummary(page)) ?? "";
      await page.locator("[data-bar-action=more]").click();
      await page.waitForSelector("[role=dialog]");
      await page.waitForTimeout(250);
      const insert = page.locator("[data-testid=bar-more-blank_after]");
      const drawn = await insert.count();
      const runnable = drawn > 0 ? !(await insert.isDisabled()) : false;
      record(15, "the whole measure is reachable and offers the structural verbs",
        scope === "full" && /Tüm enstrümanlar/.test(summary) && drawn > 0 && runnable,
        `scope=${scope} summary="${summary}" insert=${drawn} runnable=${runnable}`);
      await shot(page, "07-whole-measure");
    });

  await safe(16, "adding a bar lengthens the song once and undoes in one step",
    async () => {
      const before = await fingerprint(page);
      const barsBefore = before.split("\n").filter((line) => line.length > 0).length;
      await page.locator("[data-testid=bar-more-blank_after]").click();
      await page.waitForTimeout(300);
      await page.locator("[data-bar-apply]").click();
      await page.waitForTimeout(500);
      const barsAfter = await songBars(page);
      await undo(page);
      const back = await fingerprint(page);
      record(16, "adding a bar lengthens the song once and undoes in one step",
        barsAfter === barsBefore + 1 && back === before,
        `bars ${barsBefore}→${barsAfter} undoneEqual=${back === before}`);
    });

  /* ---------------------------------- §7 a move onto occupied bars */

  await safe(17, "a blocked move refuses and offers no button it cannot honour",
    async () => {
      /*
       * The founder pressed "Yerine koy" here and nothing happened: the
       * dialog stayed open and the same warning was rewritten under it. A
       * move's collision has no overwrite that answers it, so what must be on
       * screen is the refusal — and no button promising otherwise.
       */
      /*
       * Its own selection: step 16 ended with an undo, which lets go of the
       * bars it was holding. A step that reached for the previous step's
       * leftovers would be reporting on those instead.
       */
      await selectOneBar(page, cdp, 0);
      await page.locator("[data-bar-scope=track]").click();
      await page.waitForTimeout(300);
      const before = await fingerprint(page);
      await page.locator("[data-bar-action=move]").click();
      await page.waitForTimeout(250);
      await page.locator("[data-bar-move-right]").click();
      await page.waitForTimeout(350);
      const preview = (await page
        .locator("[data-bar-preview]")
        .textContent()
        .catch(() => "")) ?? "";
      const replaceShown = await page.locator("[data-bar-replace]").count();
      const blocked = /taşınacak yerde/i.test(preview);
      const after = await fingerprint(page);
      record(17, "a blocked move refuses and offers no button it cannot honour",
        !blocked || (replaceShown === 0 && after === before),
        `preview="${preview.slice(0, 46)}" replaceShown=${replaceShown} blocked=${blocked}`);
      await page
        .getByRole("button", { name: "Vazgeç", exact: true })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(250);
      await shot(page, "08-move-refusal");
    });

  await safe(18, "a move into free space really moves, and undoes in one step",
    async () => {
      /*
       * Bar 3 has an empty bar 4 to its right, so this is the move that has
       * somewhere to go — the counterpart to the blocked one above.
       */
      await selectOneBar(page, cdp, 2);
      await page.locator("[data-bar-scope=track]").click().catch(() => {});
      await page.waitForTimeout(250);
      await page.locator("[data-bar-action=move]").click();
      await page.waitForTimeout(250);
      const before = await fingerprint(page);
      await page.locator("[data-bar-move-right]").click();
      await page.waitForTimeout(350);
      const ok = await page.locator("[data-bar-apply]").count();
      if (ok === 0) {
        const preview = (await page
          .locator("[data-bar-preview]")
          .textContent()
          .catch(() => "")) ?? "";
        record(18, "a move into free space really moves, and undoes in one step",
          false, `no apply offered; preview="${preview.slice(0, 50)}"`);
        return;
      }
      await page.locator("[data-bar-apply]").click();
      await page.waitForTimeout(500);
      const after = await fingerprint(page);
      await undo(page);
      const back = await fingerprint(page);
      record(18, "a move into free space really moves, and undoes in one step",
        after !== before && back === before,
        `moved=${after !== before} undoneEqual=${back === before}`);
    });

  /* -------------------------- §8 §9 the drag, and what it must not do */

  await safe(19, "a long press then a drag really holds two bars", async () => {
    const scrollBefore = await page.evaluate(() => ({
      body: document.scrollingElement?.scrollTop ?? 0,
    }));
    /*
     * The finger travels towards the right-hand edge, which is where the
     * neighbouring bar is on a phone: a bar of sixteenths is wider than a
     * 320px screen, so the next bar is off-view and the view has to follow
     * the finger for the gesture to exist there at all.
     */
    const summary = await dragTwoBars(page, cdp, 0);
    const scrollAfter = await page.evaluate(() => ({
      body: document.scrollingElement?.scrollTop ?? 0,
    }));
    record(19, "a long press then a drag really holds two bars",
      /·\s*[2-9]\s+ölçü/.test(summary),
      `summary="${summary}" bodyScroll ${scrollBefore.body}→${scrollAfter.body}`);
    page.__bodyScrollDelta = scrollAfter.body - scrollBefore.body;
    await shot(page, "09-two-bars");
  });

  await safe(20, "the page underneath did not move during the drag", async () => {
    /*
     * §8 item 4. The founder's phone scrolled the tab out from under the
     * finger the moment it moved, which is what made the gesture impossible
     * rather than merely awkward.
     */
    record(20, "the page underneath did not move during the drag",
      page.__bodyScrollDelta === 0, `bodyScrollDelta=${page.__bodyScrollDelta}`);
  });

  await safe(21, "repeating two bars is one step, and one undo takes it back",
    async () => {
      /*
       * On the run step 19 made, not a fresh one. That is the founder's flow —
       * take hold of two bars, then do something to them — and it keeps this
       * step measuring the operation rather than re-measuring the gesture,
       * which has its own step. If nothing is held any more the drag is
       * repeated, and either way the summary must say two bars before
       * anything is pressed.
       */
      let summary = (await barSummary(page)) ?? "";
      if (!/·\s*2\s+ölçü/.test(summary)) summary = await dragTwoBars(page, cdp, 0);
      if (!/·\s*[2-9]\s+ölçü/.test(summary)) {
        record(21, "repeating two bars is one step, and one undo takes it back",
          false, `BLOCKED: only "${summary}" was held`);
        return;
      }
      /*
       * Whole measures, because that is where a repeat has somewhere to go.
       *
       * A track-scope repeat writes into bars that already exist, so asking
       * for two more copies of a two-bar run needs four free bars after it —
       * and this fixture is four bars long in total. The app refused with "Bu
       * yönde bölüm içinde yer yok." and was right to; the step was asking
       * for something the section cannot hold. In the whole-measure scope a
       * repeat *inserts*, so the section grows to fit — and it is the scope
       * §9 cares about anyway, since "correct for every track" is only
       * falsifiable where every track is involved.
       */
      await page.locator("[data-bar-scope=full]").click().catch(() => {});
      await page.waitForTimeout(350);

      const door = page.locator("[data-bar-action=repeat]");
      if ((await door.count()) === 0) {
        record(21, "repeating two bars is one step, and one undo takes it back",
          false, `held "${summary}" but no «Tekrarla» was on screen`);
        return;
      }
      const before = await fingerprint(page);
      await door.click();
      await page.waitForSelector("[role=dialog]");
      await page.waitForTimeout(250);
      await page.getByRole("button", { name: "2 kez", exact: true }).click();
      await page.waitForSelector("[data-bar-preview]", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(350);

      const preview = (await page
        .locator("[data-bar-preview]")
        .textContent()
        .catch(() => "")) ?? "";
      /*
       * Whichever of the two the app is offering, and only if it is live.
       * Pressing a disabled control does not fail the app — it hangs the
       * harness for six seconds and then reports a timeout, which describes
       * nothing. A refusal here is a real answer and is recorded as one, with
       * the sentence the app gave.
       */
      const live = async (selector) => {
        const node = page.locator(selector);
        if ((await node.count()) === 0) return false;
        return !(await node.first().isDisabled().catch(() => true));
      };
      const button = (await live("[data-bar-apply]"))
        ? "[data-bar-apply]"
        : (await live("[data-bar-replace]"))
          ? "[data-bar-replace]"
          : null;
      if (button === null) {
        record(21, "repeating two bars is one step, and one undo takes it back",
          false, `refused: "${preview.slice(0, 60)}"`);
        return;
      }

      await page.locator(button).click();
      await page.waitForTimeout(600);
      const after = await fingerprint(page);
      const undone = await undo(page);
      const back = await fingerprint(page);
      record(21, "repeating two bars is one step, and one undo takes it back",
        after !== before && undone && back === before,
        `held="${summary}" via=${button} changed=${after !== before} oneUndo=${back === before}`);
      await shot(page, "10-multi-repeat");
    });

  await safe(22, "the page scrolls normally again once the gesture is over",
    async () => {
      /*
       * §8 item 7 and item 9. The suppression must live exactly as long as
       * the drag; a listener left attached would turn this round's fix into a
       * permanent inability to scroll.
       */
      /*
       * From a known position, and in the direction that has room. The drag's
       * edge-follow can leave the view against its right-hand stop, where
       * asking it to go further right is answered by the browser clamping —
       * a zero that says the scroller is at the end, not that it is stuck.
       */
      const moved = await page.evaluate(() => {
        const scroller =
          document.querySelector("[data-tab-content]")?.parentElement ?? null;
        if (!scroller) return null;
        scroller.scrollLeft = 0;
        const start = scroller.scrollLeft;
        scroller.scrollLeft = start + 120;
        const end = scroller.scrollLeft;
        scroller.scrollLeft = start;
        return end - start;
      });
      record(22, "the page scrolls normally again once the gesture is over",
        moved === null || moved > 0, `scrollLeftDelta=${moved}`);
    });

  /* ------------------------------------------------- §12 the hygiene */

  await safe(23, "nothing steals a hit from the control under the finger",
    async () => {
      /*
       * Every control the guide draws must be the thing that answers a press
       * at its own centre. A control covered by a neighbour is a control the
       * reader presses and something else happens — which is how the last
       * round's "Geri" turned out to be a toolbar button underneath.
       */
      const stolen = await page.evaluate(() => {
        const targets = [
          ...document.querySelectorAll(
            "[data-acceptance-action], [data-selection-verb], [data-selection-more], [data-bar-action], [data-bar-scope]",
          ),
        ];
        let bad = 0;
        for (const node of targets) {
          const box = node.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          if (hit && !node.contains(hit) && !hit.contains(node)) bad += 1;
        }
        return bad;
      });
      record(23, "nothing steals a hit from the control under the finger",
        stolen === 0, `stolen=${stolen}`);
    });

  await safe(24, "every guide control is at least 44px", async () => {
    const small = await page.evaluate(() => {
      const targets = [
        ...document.querySelectorAll("[data-acceptance-action], [data-bar-scope]"),
      ];
      return targets.filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && Math.min(box.width, box.height) < 44;
      }).length;
    });
    record(24, "every guide control is at least 44px", small === 0, `under44=${small}`);
  });

  await safe(25, "the body never scrolls sideways", async () => {
    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    record(25, "the body never scrolls sideways", overflow <= 0, `overflow=${overflow}`);
  });

  await safe(26, "the run threw nothing", async () => {
    const seen = await errors(page);
    record(26, "the run threw nothing", seen.length === 0,
      seen.slice(0, 2).join(" | ") || "0");
  });

  await safe(27, "the reader's own project is byte-identical", async () => {
    const after = await userStore(page);
    record(27, "the reader's own project is byte-identical",
      after === storeBefore && after === USER_VALUE,
      after === storeBefore ? "unchanged" : `moved: ${String(after).slice(0, 40)}`);
  });

  await context.close();
}

async function run() {
  const browser = await chromium.launch();
  for (const size of VIEWPORTS) {
    await runViewport(browser, size);
  }
  await browser.close();
  const failed = results.filter((entry) => !entry.pass);
  flush();
  console.log(
    `\n${results.length - failed.length}/${results.length} passed, ${shots} screenshots`,
  );
  for (const entry of failed) {
    console.log(`  FAIL ${entry.viewport} ${entry.step} ${entry.name} — ${entry.detail}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

await run();
