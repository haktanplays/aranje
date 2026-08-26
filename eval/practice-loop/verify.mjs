/**
 * The practice loop, in a real browser (2R-A §XIV).
 *
 * Eighty-odd scenarios over two viewports and three text scales, on a
 * production build, with the counters installed before the app's first line.
 * Nothing here is checked by reading a sentence off the screen when the fact
 * behind it can be measured instead: a range is checked against the ticks the
 * transport loops, a write against `Storage.prototype.setItem`, a frame
 * against the playhead loop's own live count, and a drum cell against the
 * canonical x its column sits at.
 *
 * ## Why the matrix is the whole matrix
 *
 * A control that is reachable at 390px and 100% text is not evidence about
 * 320px at 150%: that is where the transport row wrapped, where the sheet
 * ran past the fold, and where a two-line banner earns its second line. Each
 * scenario is therefore a *result per combination*, and the artefact records
 * all of them rather than a pass rate.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/practice-loop/verify.mjs
 *   ONE_VIEWPORT=1 ONLY=extent node eval/practice-loop/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture, TEXT_SCALES, VIEWPORTS } from "./device.mjs";
import { PROJECT_LEDGER, writeTally } from "../shared/project-storage.mjs";
import {
  INSTRUMENT,
  START_RECORDING,
  STOP_RECORDING,
} from "../continuous-follow/instrument.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/practice-loop";
mkdirSync(OUT, { recursive: true });

/** Geometry the product owns; the harness reads it rather than assuming it. */
const SLOT = 34;
const GUTTER = 34;

const results = [];
let combo = "";
const record_ = (name, pass, detail = "") => {
  results.push({ combo, name, pass, detail: String(detail).slice(0, 220) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${combo} · ${name}${detail ? `  — ${detail}` : ""}`);
};

/** `ONLY=extent,countin node verify.mjs` runs some tours, for iterating. */
const ONLY = (process.env.ONLY ?? "").split(",").map((e) => e.trim()).filter(Boolean);
const wanted = (label) => ONLY.length === 0 || ONLY.some((entry) => label.includes(entry));

/* ------------------------------------------------------------------ boot */

async function boot(browser, viewport, storage, extra = {}) {
  const { textScale = 100, ...contextOptions } = extra;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ...contextOptions,
  });
  await context.addInitScript(
    ([entries, instrument, ledger]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(instrument);
      // After the seed, so seeding is not counted as the app writing.
      (0, eval)(ledger);
    },
    [Object.entries(storage), INSTRUMENT, PROJECT_LEDGER],
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
   * surface, resized.
   */
  if (textScale !== 100) {
    await page.addStyleTag({
      content: `html { font-size: ${Math.round(16 * (textScale / 100))}px }`,
    });
    await page.waitForTimeout(200);
  }
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors };
}

/* --------------------------------------------------------------- gestures */

const view = (page, id) => page.getByTestId(`view-${id}`);
const play = (page) => page.locator("footer button[aria-label='Çal']");
const pause = (page) => page.locator("footer button[aria-label='Duraklat']");

async function toView(page, id) {
  /*
   * The view switch is not on screen while the reader is writing (2S-A §18).
   *
   * Edit mode is a focused layout: the brand header, the view switch and the
   * section navigator stand down so the six-string staff can have rows a
   * finger can hit. The way out is "Bitti", so that is what the harness
   * presses — the same door a reader has.
   */
  const done = page.locator("[data-edit-done]");
  if (await done.isVisible().catch(() => false)) {
    await done.click();
    await page.waitForTimeout(250);
  }
  await view(page, id).click();
  await page.waitForTimeout(350);
}

/** A real finger: a tap, or a press held long enough to mean something else. */
async function touch(page, cdp, x, y, ms = 60) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);
}

/**
 * Drag the time selection's end handle right by `dx`, in one gesture.
 *
 * The handle is scrolled to a quarter of the screen first, so a drag that
 * would otherwise start at the right edge has somewhere to go. On a 320px
 * viewport a selection two bars wide puts its end handle past the edge
 * entirely, and a drag that starts off-screen does nothing at all.
 */
const HANDLE_HOME = 36;

async function dragHandle(page, cdp, edge, dx) {
  const handle = page.locator(`[data-testid=selection-handle-${edge}]`).first();
  let box = await handle.boundingBox();
  if (box !== null && dx > 0 && box.x > HANDLE_HOME + 4) {
    const scroller = await surface(page);
    if (scroller) {
      await scrollTo(page, Math.max(0, scroller.scrollLeft + box.x - HANDLE_HOME));
      await page.waitForTimeout(200);
      box = await handle.boundingBox();
    }
  }
  if (!box) return false;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * step) / 8, y, id: 1 }],
    });
    await page.waitForTimeout(25);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
  return true;
}

const editButton = (page) => page.getByRole("button", { name: "Düzenle", exact: true });

async function enterEdit(page) {
  if (await editButton(page).isVisible().catch(() => false)) {
    await editButton(page).click();
    await page.waitForTimeout(300);
  }
}

/** Move to a section by pressing the transport's own next/previous chips. */
async function gotoSection(page, sectionId) {
  for (let step = 0; step < 8; step += 1) {
    const at = await page.getAttribute("[data-viewed-section]", "data-viewed-section");
    if (at === sectionId) return true;
    const next = page.getByRole("button", { name: /^Sonraki bölüm/ });
    if (!(await next.isEnabled().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(300);
  }
  return (await page.getAttribute("[data-viewed-section]", "data-viewed-section")) === sectionId;
}

/**
 * Tap a bar on the reading surface, which is also what moves the playhead.
 *
 * In the middle of the bar rather than at its top-left corner. At a 150% text
 * setting the corner is under the section marker strip, so a tap there
 * reached the marker instead of the staff — and every scenario that needed a
 * current bar failed at that one text scale while passing at the other two.
 */
async function tapBar(page, barKey) {
  const bar = page.locator(`[data-bar-key='${barKey}']`).first();
  if ((await bar.count()) === 0) return false;
  await bar.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(120);
  const box = await bar.boundingBox();
  if (!box || box.width < 4 || box.height < 4) return false;
  await bar
    .click({ position: { x: Math.min(30, box.width / 2), y: box.height / 2 } })
    .catch(() => {});
  await page.waitForTimeout(250);
  return true;
}

const openPractice = async (page) => {
  await page.locator("[data-open-practice]").click();
  await page.waitForSelector("[data-practice-sheet]", { timeout: 4000 });
  await page.waitForTimeout(150);
};

/**
 * Leave the sheet the way a reader would.
 *
 * Escape rather than the backdrop: the backdrop is a full-screen button
 * underneath the sheet, so a click aimed at its centre lands on the sheet
 * body instead and waits forever. Escape is the same `onClose`, and 2R-A §X
 * is the reason it exists.
 */
const closePractice = async (page) => {
  if (await present(page, "[data-practice-sheet]")) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
};

const text = async (page, selector) =>
  (await page.locator(selector).first().textContent().catch(() => null)) ?? null;

const present = async (page, selector) =>
  (await page.locator(selector).count()) > 0;

/* -------------------------------------------------------------- readings */

/** Everything that really scrolls horizontally right now. */
const scrollers = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1
        );
      })
      .map((el) => ({
        scrollLeft: Math.round(el.scrollLeft),
        scrollWidth: Math.round(el.scrollWidth),
        clientWidth: Math.round(el.clientWidth),
      })),
  );

const surface = async (page) => (await scrollers(page))[0] ?? null;

/** The runtime facts a scenario is allowed to assert about. */
const shot = (page) =>
  page.evaluate(() => ({
    barKeys: [...document.querySelectorAll("[data-bar-key]")].map((el) =>
      el.getAttribute("data-bar-key"),
    ),
    drumCells: document.querySelectorAll("[data-drum-cell]").length,
    viewedSection:
      document.querySelector("[data-viewed-section]")?.getAttribute("data-viewed-section") ??
      null,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    audioContexts: window.__probe.audioContexts,
    externalRequests: window.__probe.externalRequests.length,
    live: { ...window.__playheadProbe.live },
    rootFontPx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  }));

/** The project as it physically sits in storage. */
const storedSong = (page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.projects");
    if (!raw) return null;
    const id = JSON.parse(raw).activeProjectId;
    const record = window.localStorage.getItem(`aranje.project.${id}`);
    return record ? JSON.parse(record).current : null;
  });

/** Every touch target on screen that a reader is expected to be able to hit. */
const targetSizes = (page, selector) =>
  page.$$eval(selector, (nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 24) ?? "",
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        bottom: Math.round(rect.bottom),
        right: Math.round(rect.right),
      };
    }),
  );

/** Scroll the reading surface until a bar is actually mounted, then tap it. */
async function revealAndTapBar(page, barKey) {
  if (await tapBar(page, barKey)) return true;
  const scroller = await surface(page);
  if (!scroller) return false;
  for (let at = 0; at <= scroller.scrollWidth; at += Math.max(120, scroller.clientWidth / 2)) {
    await page.evaluate((left) => {
      const el = [...document.querySelectorAll("*")].find((node) => {
        const style = getComputedStyle(node);
        return (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth + 1
        );
      });
      if (el) el.scrollLeft = left;
    }, at);
    await page.waitForTimeout(180);
    if (await tapBar(page, barKey)) return true;
  }
  return false;
}

/** Put the practice range on exactly one bar, through the single-bar door. */
async function practiseBar(page, barKey) {
  if (!(await revealAndTapBar(page, barKey))) return false;
  await openPractice(page);
  if (!(await present(page, "[data-practice-current]"))) return false;
  await page.locator("[data-practice-current]").click();
  await page.waitForTimeout(250);
  return present(page, "[data-practice-range]");
}

/** Extend the standing range to another bar: the two-tap door's second tap. */
async function extendToBar(page, barKey) {
  await closePractice(page);
  if (!(await revealAndTapBar(page, barKey))) return false;
  await openPractice(page);
  if (!(await present(page, "[data-practice-extend]"))) return false;
  await page.locator("[data-practice-extend]").click();
  await page.waitForTimeout(250);
  return true;
}

/** The selection's own ticks, straight off the band the reader can see. */
const selectionTicks = async (page) => {
  const band = page.locator("[data-testid=time-selection-band]").first();
  if ((await band.count()) === 0) return null;
  const start = Number(await band.getAttribute("data-start-ticks"));
  const end = Number(await band.getAttribute("data-end-ticks"));
  const box = await band.boundingBox();
  return { start, end, widthPx: box?.width ?? 0 };
};

/**
 * Drag the selection's end until it lands on an exact tick.
 *
 * Two facts were measured rather than assumed. A gesture does not translate
 * one-to-one: dragging the handle `k` slot-widths lands it `k + 1` slots
 * further on, because putting it down where the next slot begins takes that
 * slot too. And a gesture cannot be longer than the screen, so on a 320px
 * viewport two bars is more than one drag — which is also how a reader would
 * do it, and each of those drags brings its own extra slot.
 *
 * So the plan is arithmetic — `gain = dragged + stages` — and the miss is
 * still measured and folded into a retry, because a plan that was merely
 * plausible is how this measured a partial bar and called the offer broken.
 */
async function extendSelectionToTicks(page, cdp, wantTicks) {
  const size = page.viewportSize();
  let correction = 0;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0 && !(await selectFirstOnset(page, cdp))) return false;
    const base = await selectionTicks(page);
    if (base === null || base.widthPx <= 0 || base.end <= base.start) return false;
    if (base.end === wantTicks) return true;

    const ticksPerSlot = base.end - base.start;
    const slotPx = base.widthPx;
    const wantSlots = (wantTicks - base.start) / ticksPerSlot;
    if (!Number.isInteger(wantSlots) || wantSlots < 2) return false;

    const roomSlots = Math.max(1, Math.floor((size.width - HANDLE_HOME - 24) / slotPx));
    const gain = wantSlots - 1 + correction;
    const stages = Math.max(1, Math.ceil(gain / (roomSlots + 1)));
    let dragged = gain - stages;

    for (let stage = 0; stage < stages && dragged > 0; stage += 1) {
      const slots = Math.min(dragged, roomSlots);
      if (!(await dragHandle(page, cdp, "end", slots * slotPx))) return false;
      dragged -= slots;
    }

    const landed = await selectionTicks(page);
    if (landed === null) return false;
    if (landed.end === wantTicks) return true;
    correction -= (landed.end - wantTicks) / ticksPerSlot;
  }
  return (await selectionTicks(page))?.end === wantTicks;
}

/**
 * Long-press the first written moment on the tab, which starts a selection.
 *
 * Scrolled home first. A previous drag leaves the surface somewhere else, and
 * "the first onset on screen" is then a different moment — which made every
 * retry measure a selection that started somewhere other than the section's
 * first tick.
 */
async function selectFirstOnset(page, cdp) {
  await enterEdit(page);
  /*
   * Cancel whatever is selected first. A long press while a selection stands
   * *extends* it rather than replacing it, so a retry that skipped this
   * measured a selection growing by a slot on every attempt — which is what
   * made a correcting loop oscillate instead of converge.
   */
  const cancel = page.getByRole("button", { name: "Seçimi iptal et" });
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
    await page.waitForTimeout(200);
  }
  await scrollTo(page, 0);
  await page.waitForTimeout(200);
  const cell = page.locator("[data-cell][data-onset]").first();
  if ((await cell.count()) === 0) return false;
  const box = await cell.boundingBox();
  if (!box) return false;
  await touch(page, cdp, box.x + box.width / 2, box.y + box.height / 2, 700);
  await page.waitForTimeout(350);
  return (await page.locator("[data-testid=time-selection-band]").count()) > 0;
}

/* ------------------------------------------------- A. the three doors in */

async function tourEntry(page) {
  await toView(page, "tab");
  const before = await writeTally(page);

  record_("tek ölçüden range", await practiseBar(page, "four:0"), "four:0");
  record_(
    "range özeti ölçü numarasıyla",
    (await text(page, "[data-practice-range]")) === "Dört Dörtlük, 1. ölçü",
    await text(page, "[data-practice-range]"),
  );
  record_(
    "range kaynağı: tek ölçü",
    (await text(page, "[data-practice-source]")) === "Tek ölçü",
    await text(page, "[data-practice-source]"),
  );
  const afterRange = await writeTally(page);
  record_(
    "range kurmak 0 write",
    afterRange.total === before.total,
    `${afterRange.total - before.total} setItem`,
  );

  record_("iki ölçü pair", await extendToBar(page, "four:2"), "four:0 → four:2");
  const pairText = await text(page, "[data-practice-range]");
  record_(
    "pair aradaki her ölçüyü kapsar",
    pairText === "Dört Dörtlük, 1–3. ölçüler",
    pairText,
  );

  // The same two bars named the other way round is the same music.
  await page.locator("[data-practice-clear]").click();
  await page.waitForTimeout(200);
  await closePractice(page);
  await practiseBar(page, "four:2");
  await extendToBar(page, "four:0");
  record_(
    "ters pair aynı aralığı verir",
    (await text(page, "[data-practice-range]")) === pairText,
    `${await text(page, "[data-practice-range]")} vs ${pairText}`,
  );

  await page.locator("[data-practice-clear]").click();
  await page.waitForTimeout(200);
  await closePractice(page);
  await practiseBar(page, "four:0");
  const whole = await extendToBar(page, "four:3");
  record_(
    "bütün section pair",
    whole && (await text(page, "[data-practice-range]")) === "Dört Dörtlük, 1–4. ölçüler",
    await text(page, "[data-practice-range]"),
  );

  /*
   * Across a section boundary. Not a smaller range and not a rounded one:
   * tempo and meter belong to the section, so a loop over two of them would
   * change length depending on where in it you asked.
   */
  await closePractice(page);
  await gotoSection(page, "three");
  await extendToBar(page, "three:0");
  const refusal = await text(page, "[data-practice-refusal]");
  record_(
    "cross-section red",
    refusal !== null && refusal.includes("tek bir bölüm"),
    refusal ?? "no refusal shown",
  );
  record_(
    "cross-section reddi ham kod göstermez",
    refusal !== null && !/different_sections|sectionId|Error/.test(refusal),
    refusal ?? "-",
  );
  await closePractice(page);
}

/* ------------------------------ B. the time selection, whole bars or not */

async function tourSelection(page, cdp) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  const started = await selectFirstOnset(page, cdp);
  record_("zaman seçimi başlar", started, started ? "band shown" : "no band");

  record_(
    "partial time selection teklif edilmez",
    !(await present(page, "[data-practice-from-selection]")),
    `ticks ${JSON.stringify(await selectionTicks(page))}`,
  );

  // One whole bar: 4/4 at 1/8 is eight slots of 96 ticks.
  const wholeBar = await extendSelectionToTicks(page, cdp, 768);
  record_(
    "tam bar TimeSelection teklif edilir",
    wholeBar && (await present(page, "[data-practice-from-selection]")),
    `ticks ${JSON.stringify(await selectionTicks(page))}`,
  );

  if (await present(page, "[data-practice-from-selection]")) {
    await page.locator("[data-practice-from-selection]").click();
    await page.waitForTimeout(250);
    await openPractice(page);
    record_(
      "tam bar TimeSelection range olur",
      (await text(page, "[data-practice-range]")) === "Dört Dörtlük, 1. ölçü",
      await text(page, "[data-practice-range]"),
    );
    record_(
      "range kaynağı: zaman seçimi",
      (await text(page, "[data-practice-source]")) === "Zaman seçiminden",
      await text(page, "[data-practice-source]"),
    );
    await page.locator("[data-practice-clear]").click();
    await page.waitForTimeout(150);
    await closePractice(page);
  } else {
    record_("tam bar TimeSelection range olur", false, "offer never appeared");
    record_("range kaynağı: zaman seçimi", false, "offer never appeared");
  }

  /*
   * One slot past the bar line, from a fresh one-bar selection whose end
   * handle is still on screen. Nothing is snapped back: the offer simply
   * stops being made, which is the rule (§V).
   */
  await selectFirstOnset(page, cdp);
  const past = await extendSelectionToTicks(page, cdp, 864);
  const at = await selectionTicks(page);
  record_(
    "bar çizgisini aşan seçim yuvarlanmaz",
    past && at?.end === 864 && !(await present(page, "[data-practice-from-selection]")),
    `${at?.end} tick — ölçü çizgisi 768'de`,
  );

  // Two whole bars, which is a different offer and the same rule.
  await selectFirstOnset(page, cdp);
  const twoBars = await extendSelectionToTicks(page, cdp, 1536);
  record_(
    "çoklu bar TimeSelection range olur",
    twoBars && (await present(page, "[data-practice-from-selection]")),
    `ticks ${JSON.stringify(await selectionTicks(page))}`,
  );
}

/* ------------------------------------- C. what the loop's edges cut (§VI) */

async function tourEdge(page) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  /*
   * Bar 2 of `four` opens on a tie whose onset is in bar 1, so a loop over
   * bar 2 alone starts in the middle of a held note. That is a legitimate
   * thing to practise, so it is described rather than refused.
   */
  await practiseBar(page, "four:1");
  const edge = await text(page, "[data-practice-edge]");
  record_(
    "tie preflight kenarı anlatır",
    edge !== null && edge.includes("ortasından"),
    edge ?? "no edge message",
  );
  record_(
    "kenar mesajı ham bağlantı adı göstermez",
    edge === null || !/tie|legato|hammer_on|pull_off|tick/i.test(edge),
    edge ?? "-",
  );
  record_(
    "include connection teklif edilir",
    await present(page, "[data-practice-include]"),
    "Bağlantıyı da dahil et",
  );

  if (await present(page, "[data-practice-include]")) {
    await page.locator("[data-practice-include]").click();
    await page.waitForTimeout(250);
    record_(
      "include connection range'i genişletir",
      (await text(page, "[data-practice-range]")) === "Dört Dörtlük, 1–2. ölçüler",
      await text(page, "[data-practice-range]"),
    );
  } else {
    record_("include connection range'i genişletir", false, "no offer to take");
  }
  await page.locator("[data-practice-clear]").click();
  await page.waitForTimeout(150);
  await closePractice(page);

  /*
   * The seam. `sixeight`'s first bar continues a note whose onset is in the
   * *previous section*, and a practice loop cannot cross a section — so the
   * range is refused outright rather than offered with an edge it could
   * never widen to cover.
   */
  await gotoSection(page, "sixeight");
  await practiseBar(page, "sixeight:0");
  const seam = await text(page, "[data-practice-refusal]");
  record_(
    "seam fail-closed",
    !(await present(page, "[data-practice-range]")) && seam !== null,
    seam ?? "a range was produced across the seam",
  );
  record_(
    "seam reddi müzikal dille anlatılır",
    seam !== null && seam.includes("bölüm") && !/chain|preflight|Error/i.test(seam),
    seam ?? "-",
  );
  await closePractice(page);
}

/* ----------------------------------------- D. what actually loops (§VII) */

/** Play for a while and describe where the playhead went, in axis pixels. */
async function recordPlayback(page, ms) {
  await page.evaluate(START_RECORDING);
  await play(page).click();
  await page.waitForTimeout(ms);
  const raw = await page.evaluate(STOP_RECORDING);
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(200);
  const xs = raw.scrollSamples.map((s) => s.playheadX).filter((x) => x !== null);
  let wraps = 0;
  for (let i = 1; i < xs.length; i += 1) if (xs[i] < xs[i - 1] - 1) wraps += 1;
  return { xs, wraps, samples: raw.scrollSamples };
}

/** Where a bar sits on the canonical axis, measured off the page itself. */
const barAxisX = (page, barKey) =>
  page.evaluate((key) => {
    const scroller = [...document.querySelectorAll("*")].find((node) => {
      const style = getComputedStyle(node);
      return (
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    const bar = document.querySelector(`[data-bar-key='${key}']`);
    if (!scroller || !bar) return null;
    const left =
      bar.getBoundingClientRect().left -
      scroller.getBoundingClientRect().left +
      scroller.scrollLeft;
    return {
      left: Math.round(left * 10) / 10,
      width: Math.round(bar.getBoundingClientRect().width * 10) / 10,
    };
  }, barKey);

async function tourLoop(page) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  await practiseBar(page, "four:0");
  await closePractice(page);

  const bar = await barAxisX(page, "four:0");
  const played = await recordPlayback(page, 5200);
  /*
   * The playhead is drawn from a clock the audio scheduler runs slightly
   * ahead of, so the last frame before a wrap can land a frame or two past
   * the loop's end. That is drawing latency, not a loop that overruns, and
   * the tolerance says so in the drawing's own units: three hundredths of a
   * bar is about 30ms at this tempo, which is two frames.
   */
  const slack = bar === null ? 0 : Math.max(6, bar.width * 0.03);
  const inside =
    bar !== null &&
    played.xs.length > 0 &&
    played.xs.every((x) => x >= bar.left - 2 && x <= bar.left + bar.width + slack);
  record_(
    "loop tam bar sınırları içinde kalır",
    inside,
    bar === null
      ? "bar not measurable"
      : `${played.xs.length} örnek, ${Math.round(Math.min(...played.xs))}–${Math.round(Math.max(...played.xs))} vs ${bar.left}–${Math.round(bar.left + bar.width)} (+${Math.round(slack)}px çizim payı)`,
  );
  record_(
    "loop wrap gerçekten oluyor",
    played.wraps > 0,
    `${played.wraps} wrap`,
  );
  record_(
    "loop sonu bir sonraki ölçüye taşmıyor",
    bar !== null && played.xs.every((x) => x < bar.left + bar.width + slack),
    bar === null
      ? "-"
      : `max ${Math.round(Math.max(...played.xs, 0))}, ölçü sonu ${Math.round(bar.left + bar.width)}, bir sonraki ölçü ${Math.round(bar.left + bar.width + SLOT)}`,
  );

  // The banner says what is looping, in bars rather than in ticks.
  const banner = await text(page, "[data-practice-banner]");
  record_(
    "banner aktif range'i söyler",
    banner !== null && banner.startsWith("Pratik · 1 ölçü"),
    banner ?? "no banner",
  );

  /*
   * Two kinds of loop, one at a time. Pressing the section loop while a
   * practice range is set replaces it; the transport can only be looping one
   * thing, and a reader who set both would have no way to tell which won.
   */
  await page.getByRole("button", { name: "Bölüm döngüsü" }).click();
  await page.waitForTimeout(300);
  record_(
    "section loop practice'i kapatır",
    (await text(page, "[data-practice-banner]")) === null,
    (await text(page, "[data-practice-status]")) ?? "banner gone",
  );
  const status = await text(page, "[data-transport-status]");
  record_(
    "section loop kendi adını söyler",
    status !== null && status.includes("Döngü:"),
    status ?? "-",
  );

  await practiseBar(page, "four:2");
  await closePractice(page);
  const after = await text(page, "[data-transport-status]");
  record_(
    "practice range section loop'u kapatır",
    after !== null && !after.includes("Döngü:") && (await present(page, "[data-practice-banner]")),
    after ?? "-",
  );
}

/* ------------------------------------------- E. counting in, and stopping */

const countInButton = (page, bars) => page.locator(`[data-count-in='${bars}']`);

async function setCountIn(page, bars) {
  await openPractice(page);
  await countInButton(page, bars).click();
  await page.waitForTimeout(200);
  const pressed = await countInButton(page, bars).getAttribute("aria-pressed");
  await closePractice(page);
  return pressed === "true";
}

/** How long the transport waits before the playhead first moves. */
async function startLatency(page, ms) {
  await page.evaluate(START_RECORDING);
  await play(page).click();
  await page.waitForTimeout(ms);
  const raw = await page.evaluate(STOP_RECORDING);
  const samples = raw.scrollSamples.filter((entry) => entry.playheadX !== null);
  /*
   * When the playhead *starts moving*, not when it is somewhere other than
   * zero. A practice range on the second bar puts the playhead a third of
   * the way along the axis before a note has sounded, so "x > 0" would have
   * called every count-in instant — which is exactly what it did.
   */
  const origin = samples[0]?.playheadX ?? 0;
  const started = samples[0]?.t ?? 0;
  const first = samples.find((entry) => Math.abs(entry.playheadX - origin) > 1);
  return {
    movedAfterMs: first === undefined ? null : first.t - started,
    moved: first !== undefined,
    samples,
  };
}

/**
 * What the latency sampler actually saw, when it disagreed with the claim.
 *
 * A count-in that reports "the playhead moved at 83 ms" is either a product
 * defect or a measurement that mistook something else for transport motion,
 * and the two are told apart by the samples rather than by the verdict.
 */
function dumpLatency(name, payload) {
  mkdirSync(`${OUT}/artifacts`, { recursive: true });
  writeFileSync(
    `${OUT}/artifacts/countin-${combo.replace(/[^0-9a-zA-Z]+/g, "-")}-${name}.json`,
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

async function tourCountIn(page, sectionId, label) {
  await toView(page, "tab");
  await gotoSection(page, sectionId);
  const barKey = `${sectionId}:1`;
  await practiseBar(page, barKey);
  await closePractice(page);

  await setCountIn(page, 0);
  const none = await startLatency(page, 1800);
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(200);
  record_(`${label} count-in kapalı hemen başlar`, none.moved && none.movedAfterMs < 900, `${none.movedAfterMs}ms`);

  const armedOne = await setCountIn(page, 1);
  const one = await startLatency(page, 3200);
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(200);
  const oneHeld =
    armedOne && one.moved && none.movedAfterMs !== null && one.movedAfterMs > none.movedAfterMs + 300;
  if (!oneHeld) dumpLatency(`${label}-one`, { armed: armedOne, none, one });
  record_(
    `${label} bir ölçü count-in bekletir`,
    oneHeld,
    `${one.movedAfterMs}ms vs ${none.movedAfterMs}ms${armedOne ? "" : " — sayim kurulamadi"}`,
  );

  await setCountIn(page, 2);
  const two = await startLatency(page, 5200);
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(200);
  record_(
    `${label} iki ölçü count-in bir ölçüden uzun bekletir`,
    two.moved && one.movedAfterMs !== null && two.movedAfterMs > one.movedAfterMs + 200,
    `${two.movedAfterMs}ms vs ${one.movedAfterMs}ms`,
  );

  // The music is untouched: counting in adds no bar to the song.
  const song = await storedSong(page);
  const section = song?.sections.find((entry) => entry.id === sectionId);
  record_(
    `${label} count-in şarkıya ölçü eklemez`,
    section !== undefined && section.bars.length === (sectionId === "four" ? 4 : 3),
    `${section?.bars.length} ölçü`,
  );
}

async function tourCountInCancel(page) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  await practiseBar(page, "four:1");
  await closePractice(page);
  await setCountIn(page, 2);

  // Pause during the count: nothing may start after the counting stops.
  await play(page).click();
  await page.waitForTimeout(350);
  await pause(page).click();
  await page.waitForTimeout(1800);
  const afterPause = await page.evaluate(() => ({
    playing: !!document.querySelector("footer button[aria-label='Duraklat']"),
    live: Object.values(window.__playheadProbe.live).reduce((a, b) => a + b, 0),
  }));
  record_(
    "count-in sırasında pause iptal eder",
    !afterPause.playing,
    afterPause.playing ? "still playing" : "stopped",
  );
  record_("iptal edilen count-in hayalet playback başlatmaz", afterPause.live === 0, `${afterPause.live} rAF`);

  /*
   * And the transport is still usable afterwards. A cancellation that cleared
   * the schedule but left the count-in's own token behind would look exactly
   * like this one — stopped, no ghost frame — right up until the next press
   * of play silently did nothing.
   */
  await play(page).click();
  await page.waitForTimeout(6500);
  const resumed = await page.evaluate(() => ({
    live: Object.values(window.__playheadProbe.live).reduce((a, b) => a + b, 0),
    playing: !!document.querySelector("footer button[aria-label='Duraklat']"),
    error: document.querySelector("footer [role=alert]")?.textContent ?? null,
    status: document.querySelector("[data-transport-status]")?.textContent ?? null,
  }));
  record_(
    "iptalden sonra tekrar çal gerçekten başlıyor",
    resumed.playing && resumed.live === 1,
    `${resumed.live} rAF, ${resumed.playing ? "çalıyor" : "durmuş"}` +
      `${resumed.error ? ` — hata: ${resumed.error}` : ""}` +
      `${resumed.status ? ` — ${resumed.status}` : ""}`,
  );
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(300);

  // Rewind during the count is the other cancellation door.
  await play(page).click();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Başa dön" }).click();
  await page.waitForTimeout(1800);
  const afterStop = await page.evaluate(() => ({
    playing: !!document.querySelector("footer button[aria-label='Duraklat']"),
    live: Object.values(window.__playheadProbe.live).reduce((a, b) => a + b, 0),
  }));
  record_("count-in sırasında stop iptal eder", !afterStop.playing, afterStop.playing ? "still playing" : "stopped");

  // Two quick presses must not stack two count-ins.
  await play(page).click();
  await page.waitForTimeout(80);
  await page.locator("footer button[aria-label='Duraklat'], footer button[aria-label='Çal']").first().click();
  await page.waitForTimeout(2200);
  const doubled = await page.evaluate(
    () => Object.values(window.__playheadProbe.live).reduce((a, b) => a + b, 0),
  );
  record_("hızlı çift play ikinci count-in kurmaz", doubled <= 1, `${doubled} rAF`);
  if ((await pause(page).count()) > 0) await pause(page).click();
  await page.waitForTimeout(200);
}

/* --------------------------------------------------- F. the speed form */

async function tourSpeed(page) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  await practiseBar(page, "four:0");

  record_(
    "sabit hız kontrolleri gizli",
    !(await present(page, "[data-speed-value=fromPercent]")),
    "Sabit",
  );
  record_(
    "hız modu yalnız renkle anlatılmıyor",
    (await text(page, "[data-speed-mode=fixed]"))?.includes("✓") === true,
    await text(page, "[data-speed-mode=fixed]"),
  );

  await page.locator("[data-speed-mode=progressive]").click();
  await page.waitForTimeout(200);
  const fields = ["fromPercent", "toPercent", "incrementPercent", "repeatsPerStep"];
  const shown = [];
  for (const field of fields) shown.push(await text(page, `[data-speed-value=${field}]`));
  record_(
    "kademeli mod dört kontrolü açar",
    shown.every((value) => value !== null),
    shown.join(" / "),
  );

  const steppers = await targetSizes(page, "[data-speed-step]");
  record_(
    "hız kontrolleri 44x44",
    steppers.length === 8 && steppers.every((box) => box.width >= 44 && box.height >= 44),
    `${steppers.length} kontrol, en küçük ${Math.min(...steppers.map((b) => Math.min(b.width, b.height)))}px`,
  );

  // A field stops at its own end, visibly, rather than silently not moving.
  for (let press = 0; press < 12; press += 1) {
    const button = page.locator("[data-speed-step='repeatsPerStep:-1']");
    if (!(await button.isEnabled())) break;
    await button.click();
    await page.waitForTimeout(60);
  }
  record_(
    "kontrol kendi sınırında disabled olur",
    !(await page.locator("[data-speed-step='repeatsPerStep:-1']").isEnabled()),
    await text(page, "[data-speed-value=repeatsPerStep]"),
  );

  // Target below start: a refusal by name, not a silent swap.
  for (let press = 0; press < 20; press += 1) {
    const button = page.locator("[data-speed-step='toPercent:-1']");
    if (!(await button.isEnabled())) break;
    await button.click();
    await page.waitForTimeout(40);
  }
  await page.locator("[data-progressive-start]").click();
  await page.waitForTimeout(250);
  const speedRefusal = await text(page, "[data-speed-refusal]");
  record_(
    "hedef başlangıcın altındaysa typed red",
    speedRefusal !== null && speedRefusal.includes("Hedef hız"),
    speedRefusal ?? "no refusal",
  );
  record_(
    "hız reddi ham kod göstermez",
    speedRefusal !== null && !/target_not_above_start|Error|undefined/.test(speedRefusal),
    speedRefusal ?? "-",
  );

  // Vazgeç puts the form back as it opened, and clears the refusal with it.
  await page.locator("[data-speed-cancel]").click();
  await page.waitForTimeout(200);
  record_(
    "Vazgeç formu sıfırlar",
    !(await present(page, "[data-speed-refusal]")) &&
      !(await present(page, "[data-speed-value=fromPercent]")),
    "Sabit'e döndü",
  );

  // Applying a real plan starts it, and the banner says where it is going.
  await page.locator("[data-speed-mode=progressive]").click();
  await page.waitForTimeout(150);
  await page.locator("[data-progressive-start]").click();
  await page.waitForTimeout(250);
  const notice = await text(page, "[data-progressive-notice]");
  record_(
    "Uygula planı başlatır",
    notice !== null,
    notice ?? "no notice",
  );
  record_(
    "bildirim çalımı değerlendirmiyor",
    notice === null || !/doğru|temiz|başarı|puan/.test(notice),
    notice ?? "-",
  );
  await closePractice(page);
  const banner = await text(page, "[data-practice-banner]");
  record_(
    "banner kademeli planı söyler",
    banner !== null && banner.includes("→") && banner.includes("turda bir"),
    banner ?? "no banner",
  );

  // Escape is the same cleanup as Vazgeç: the form is not left half-filled.
  await openPractice(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  record_(
    "Escape sheet'i Vazgeç ile aynı yoldan kapatır",
    !(await present(page, "[data-practice-sheet]")),
    "sheet closed",
  );
}

/* ------------------------- G. the song moves, the range answers for itself */

/**
 * Write one drum hit through the surface the reader would use.
 *
 * `armKit` is defined further down with the grid tour, which is where the
 * arming gesture belongs; this only picks a cell and taps it.
 */
async function writeDrumHit(page) {
  if (!(await armKit(page))) return null;
  await scrollTo(page, 0);
  await page.waitForTimeout(250);
  const row = await kitRow(page, "snare");
  const cell = row?.cells.find((entry) => !entry.filled) ?? row?.cells[1];
  if (!cell) return null;
  await page.locator(`[data-drum-cell='${cell.address}']`).click();
  await page.waitForTimeout(400);
  return cell.address;
}

async function tourReconcile(page) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  await practiseBar(page, "four:0");
  await extendToBar(page, "four:2");
  const range = await text(page, "[data-practice-range]");
  await closePractice(page);

  const before = await writeTally(page);
  const address = await writeDrumHit(page);
  const afterWrite = await writeTally(page);
  record_("davul editi ekranda görünür", address !== null, address ?? "no drum cell");
  record_(
    "commit tek write",
    afterWrite.activeProject - before.activeProject === 1,
    `${afterWrite.activeProject - before.activeProject} write`,
  );

  await openPractice(page);
  record_(
    "nota editi geçerli range'i korur",
    (await text(page, "[data-practice-range]")) === range,
    `${await text(page, "[data-practice-range]")} vs ${range}`,
  );
  await closePractice(page);

  const beforeUndo = await writeTally(page);
  await page.locator("[data-undo]").click();
  await page.waitForTimeout(400);
  const afterUndo = await writeTally(page);
  record_(
    "undo tek write",
    afterUndo.activeProject - beforeUndo.activeProject === 1,
    `${afterUndo.activeProject - beforeUndo.activeProject} write`,
  );

  await page.locator("[data-redo]").click();
  await page.waitForTimeout(400);
  const afterRedo = await writeTally(page);
  record_(
    "redo tek write",
    afterRedo.activeProject - afterUndo.activeProject === 1,
    `${afterRedo.activeProject - afterUndo.activeProject} write`,
  );

  await openPractice(page);
  record_(
    "undo/redo range'i yerinde bırakır",
    (await text(page, "[data-practice-range]")) === range,
    await text(page, "[data-practice-range]"),
  );
  await closePractice(page);

  /*
   * A structural edit that takes the range's bars with it. The range does
   * not slide onto whatever moved into those indices — the reader chose
   * specific bars, and different bars are not the loop they set.
   */
  await enterEdit(page);
  const bar = page.locator("[data-bar-key='four:2']").first();
  if ((await bar.count()) > 0) {
    const box = await bar.boundingBox();
    if (box) {
      const cdpBar = await page.context().newCDPSession(page);
      await touch(page, cdpBar, box.x + 12, box.y + 12, 700);
      await page.waitForTimeout(400);
    }
  }
  const deleteButton = page.locator("[data-bar-action='delete']");
  let deleted = false;
  if (await deleteButton.isVisible().catch(() => false)) {
    await deleteButton.click();
    await page.waitForTimeout(300);
    const apply = page.locator("[data-bar-apply]");
    if (await apply.isVisible().catch(() => false)) {
      await apply.click();
      await page.waitForTimeout(500);
      deleted = true;
    }
  }
  await openPractice(page);
  const afterDelete = await text(page, "[data-practice-range]");
  record_(
    "bar silme invalid range'i temizler",
    !deleted || afterDelete === null || afterDelete !== range,
    deleted ? (afterDelete ?? "range cleared") : "delete gesture unavailable",
  );
  await closePractice(page);
}

/* ------------------------------------ H. the session-only boundary (§XI) */

async function tourBoundary(page) {
  await toView(page, "tab");
  await gotoSection(page, "four");

  const songBefore = JSON.stringify(await storedSong(page));
  const before = await writeTally(page);

  await practiseBar(page, "four:0");
  const afterRange = await writeTally(page);
  record_("range seçmek 0 setItem", afterRange.total === before.total, `${afterRange.total - before.total}`);

  await countInButton(page, 2).click();
  await page.waitForTimeout(200);
  const afterCountIn = await writeTally(page);
  record_("count-in ayarı 0 setItem", afterCountIn.total === before.total, `${afterCountIn.total - before.total}`);

  await page.locator("[data-speed-mode=progressive]").click();
  await page.waitForTimeout(150);
  await page.locator("[data-speed-step='fromPercent:1']").click();
  await page.locator("[data-progressive-start]").click();
  await page.waitForTimeout(300);
  const afterSpeed = await writeTally(page);
  record_("hız formu 0 setItem", afterSpeed.total === before.total, `${afterSpeed.total - before.total}`);

  await page.locator("[data-practice-clear]").click();
  await page.waitForTimeout(150);
  await closePractice(page);
  const afterClear = await writeTally(page);
  record_("practice kapatma 0 setItem", afterClear.total === before.total, `${afterClear.total - before.total}`);

  const songAfter = JSON.stringify(await storedSong(page));
  record_("song byte-eş kalır", songAfter === songBefore, songAfter === songBefore ? "identical" : "changed");

  // And none of it survives a reload, because none of it was ever written.
  await practiseBar(page, "four:1");
  await closePractice(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  await page.waitForTimeout(400);
  record_(
    "refresh practice state taşımaz",
    !(await present(page, "[data-practice-banner]")),
    (await text(page, "[data-practice-banner]")) ?? "no banner after reload",
  );

  const after = await shot(page);
  record_("dış ağ isteği 0", after.externalRequests === 0, `${after.externalRequests}`);
}

/* --------------------------------------- I. one of each runtime resource */

async function tourRuntime(page, errors) {
  await toView(page, "tab");
  const idle = await shot(page);
  record_(
    "idle rAF 0",
    Object.values(idle.live).every((count) => count === 0),
    JSON.stringify(idle.live),
  );
  record_("tek yatay scroller", (await scrollers(page)).length === 1, `${(await scrollers(page)).length}`);

  await play(page).click();
  await page.waitForTimeout(1200);
  const playing = await shot(page);
  const liveNow = Object.values(playing.live).reduce((a, b) => a + b, 0);
  record_("playing rAF 1", liveNow === 1, `${liveNow} (${JSON.stringify(playing.live)})`);
  record_("tek AudioContext", playing.audioContexts === 1, `${playing.audioContexts}`);

  await pause(page).click();
  await page.waitForTimeout(400);
  const paused = await shot(page);
  record_(
    "pause sonrası rAF 0",
    Object.values(paused.live).every((count) => count === 0),
    JSON.stringify(paused.live),
  );

  // Switching views and back must not build a second engine.
  await toView(page, "multi");
  await toView(page, "arrange");
  await toView(page, "tab");
  const later = await shot(page);
  record_("görünüm değişimi ikinci AudioContext kurmaz", later.audioContexts === 1, `${later.audioContexts}`);

  record_("console/page error 0", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
}

/* ---------------------------- J. the scroll extent, arithmetically (§III) */

/** Slots in one bar, by the same rule the product's timing module uses. */
const slotsIn = (bar) => (bar.timeSignature[0] * bar.resolution) / bar.timeSignature[1];

/** The canonical axis of a song, in pixels — bars only, no gutter, no tail. */
const axisWidthOf = (song) =>
  song.sections.reduce(
    (total, section) =>
      total + section.bars.reduce((sum, bar) => sum + slotsIn(bar) * SLOT, 0),
    0,
  );

/** Set the scroller's position without going through a gesture. */
const scrollTo = (page, left) =>
  page.evaluate((at) => {
    const el = [...document.querySelectorAll("*")].find((node) => {
      const style = getComputedStyle(node);
      return (
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    if (el) el.scrollLeft = at;
  }, left);

async function tourExtent(page, song) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  await page.waitForTimeout(300);

  const axis = axisWidthOf(song);
  const first = await surface(page);
  /*
   * The reading tail is what lets the *last* bar reach the reading anchor
   * instead of being pinned to the right edge, so it is the part of a screen
   * that sits after the anchor: 68% of the viewport. It is not read off
   * `[data-tab-tail]`, which is the window's spacer and also stands in for
   * every bar that is not mounted — a number that changes with the scroll
   * position and would make this claim untestable.
   */
  const tail = first === null ? null : Math.round(first.clientWidth * 0.68 * 10) / 10;
  const expected = axis + GUTTER + (tail ?? 0);
  record_(
    "toplam extent = axis + gutter + reading tail",
    first !== null && Math.abs(first.scrollWidth - expected) <= 2,
    `${first?.scrollWidth}px ölçüldü, ${Math.round(expected * 10) / 10}px bekleniyor (axis ${axis} + gutter ${GUTTER} + tail ${tail})`,
  );
  record_(
    "gutter müzikal axis'e dahil değil",
    first !== null && Math.abs(first.scrollWidth - axis - (tail ?? 0) - GUTTER) <= 2,
    `axis ve tail çıkınca ${first === null ? "-" : Math.round((first.scrollWidth - axis - (tail ?? 0)) * 10) / 10}px kalıyor`,
  );
  // At the end of the song, where the tail actually is.
  await scrollTo(page, 99_000);
  await page.waitForTimeout(250);
  const barsInTail = await page.evaluate(
    ([axisEnd]) => {
      const scroller = [...document.querySelectorAll("*")].find((node) => {
        const style = getComputedStyle(node);
        return (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth + 1
        );
      });
      if (!scroller) return -1;
      const origin = scroller.getBoundingClientRect().left - scroller.scrollLeft;
      return [...document.querySelectorAll("[data-bar-key]")].filter(
        (bar) => bar.getBoundingClientRect().left - origin >= axisEnd,
      ).length;
    },
    [axis + GUTTER],
  );
  record_(
    "reading tail müzikal değil",
    barsInTail === 0,
    `${barsInTail} ölçü axis'in (${axis + GUTTER}px) ötesinde`,
  );

  /*
   * The old 24.507px measurement was `contentWidthPx + gridWidth −
   * renderedPx`, which moved with the scroll position and with how many bars
   * were mounted. A length does not do that. These two claims are what make
   * the new number a length.
   */
  const widths = [];
  const mounted = [];
  for (const at of [0, 200, 700, 1500, 3000, 99_000]) {
    await scrollTo(page, at);
    await page.waitForTimeout(220);
    const now = await surface(page);
    widths.push(now?.scrollWidth ?? null);
    mounted.push((await shot(page)).barKeys.length);
  }
  record_(
    "scroll konumu toplam genişliği değiştirmez",
    new Set(widths).size === 1,
    widths.join(" / "),
  );
  record_(
    "farklı mounted bar sayılarında extent sabit",
    new Set(mounted).size > 1 && new Set(widths).size === 1,
    `mounted ${mounted.join("/")}, extent ${widths[0]}`,
  );

  await scrollTo(page, 0);
  await page.waitForTimeout(250);
  const firstBar = await barAxisX(page, "four:0");
  record_(
    "ilk gerçek ölçü erişilebilir",
    firstBar !== null && Math.abs(firstBar.left - GUTTER) <= 2,
    firstBar === null ? "not mounted" : `${firstBar.left}px`,
  );

  const lastKey = (() => {
    const section = song.sections[song.sections.length - 1];
    return `${section.id}:${section.bars.length - 1}`;
  })();
  const reachedLast = await revealAndTapBar(page, lastKey);
  const lastBar = await barAxisX(page, lastKey);
  record_(
    "son gerçek ölçü erişilebilir",
    reachedLast && lastBar !== null,
    lastBar === null ? "not mounted" : `${lastKey} @ ${lastBar.left}px`,
  );
  record_(
    "son ölçü axis'in sonunda biter",
    lastBar !== null && Math.abs(lastBar.left + lastBar.width - (axis + GUTTER)) <= 2,
    lastBar === null ? "-" : `${Math.round(lastBar.left + lastBar.width)}px vs ${axis + GUTTER}px`,
  );

  // The tail is scenery: tapping it moves nothing and creates no loop.
  await scrollTo(page, 99_000);
  await page.waitForTimeout(250);
  const beforeTap = await page.evaluate(() => ({
    section: document.querySelector("[data-viewed-section]")?.getAttribute("data-viewed-section"),
    band: !!document.querySelector("[data-testid=time-selection-band]"),
  }));
  const tailBox = await page.locator("[data-tab-tail]").first().boundingBox();
  if (tailBox && tailBox.width > 4) {
    await page.mouse.click(tailBox.x + tailBox.width / 2, tailBox.y + tailBox.height / 2);
    await page.waitForTimeout(250);
  }
  const afterTap = await page.evaluate(() => ({
    section: document.querySelector("[data-viewed-section]")?.getAttribute("data-viewed-section"),
    band: !!document.querySelector("[data-testid=time-selection-band]"),
  }));
  record_(
    "tail no-op",
    afterTap.section === beforeTap.section && afterTap.band === beforeTap.band,
    JSON.stringify(afterTap),
  );
  await openPractice(page);
  record_(
    "tail practice range üretmez",
    !(await present(page, "[data-practice-range]")),
    (await text(page, "[data-practice-range]")) ?? "no range",
  );
  await closePractice(page);
}

/* ------------------------------- K. the same x on every surface (§III.8) */

/** Where each of these bars sits, measured from the first one on this surface. */
async function barOffsets(page, keys) {
  const out = [];
  for (const key of keys) {
    const box = await barAxisX(page, key);
    if (box === null) return null;
    out.push(box);
  }
  return out.map((box) => ({
    left: Math.round((box.left - out[0].left) * 10) / 10,
    width: box.width,
  }));
}

async function tourParity(page) {
  const keys = ["four:0", "four:1", "four:2"];
  await toView(page, "tab");
  await gotoSection(page, "four");
  await scrollTo(page, 0);
  await page.waitForTimeout(250);
  const onTab = await barOffsets(page, keys);
  const tabFirst = await barAxisX(page, "four:0");

  await toView(page, "multi");
  await page.waitForTimeout(400);
  await scrollTo(page, 0);
  await page.waitForTimeout(250);
  const onMulti = await barOffsets(page, keys);
  const multiFirst = await barAxisX(page, "four:0");

  /*
   * The two surfaces share the axis, not the inset. The Tab carries a 34px
   * gutter for the string names and the Çoklu view does not, so the claim is
   * about the *music*: every bar sits at the same distance from the first
   * one, and every bar is the same width, on both.
   */
  record_(
    "Tab ve Çoklu ölçüleri aynı kanonik ofsette çizer",
    onTab !== null && onMulti !== null && JSON.stringify(onTab) === JSON.stringify(onMulti),
    `${JSON.stringify(onTab)} vs ${JSON.stringify(onMulti)}`,
  );
  record_(
    "iki yüzey arasındaki tek fark müzikal olmayan gutter",
    tabFirst !== null &&
      multiFirst !== null &&
      Math.abs(tabFirst.left - multiFirst.left - GUTTER) <= 2,
    `Tab ${tabFirst?.left}px, Çoklu ${multiFirst?.left}px, fark ${
      tabFirst === null || multiFirst === null ? "-" : Math.round(tabFirst.left - multiFirst.left)
    }px`,
  );

  await toView(page, "tab");
  await page.waitForTimeout(300);
  const played = await recordPlayback(page, 2600);
  const bar = await barAxisX(page, "four:0");
  record_(
    "playhead aynı kanonik eksende ilerler",
    bar !== null && played.xs.length > 0 && Math.min(...played.xs) >= bar.left - 2,
    bar === null ? "-" : `min ${Math.round(Math.min(...played.xs))} vs bar ${bar.left}`,
  );

  /*
   * The armed kit is the third drawing of the same axis, and it is measured
   * on the song's *second* section: on the first one the section's own x is
   * zero, so a grid that ignored it entirely would land in the right place
   * by accident. Arming replaces the bars with the step grid, so the bar's
   * own x has to be read before.
   */
  // No scroll home here: the section's bars are only mounted where they are.
  await gotoSection(page, "three");
  await page.waitForTimeout(300);
  const laterBar = await barAxisX(page, "three:0");
  const armed = await armKit(page);
  await gotoSection(page, "three");
  await page.waitForTimeout(300);
  const kit = await kitRow(page, "kick");
  record_(
    "davul ızgarası bölümün kendi kanonik x'inde başlar",
    armed && kit !== null && kit.cells.length > 0 && laterBar !== null
      ? Math.abs(kit.cells[0].left - laterBar.left) <= 1
      : false,
    kit === null
      ? "no grid"
      : `hücre ${kit.cells[0]?.left}px, bölümün ilk ölçüsü ${laterBar?.left}px`,
  );
  record_(
    "ikinci bölümün x'i gerçekten sıfır değil",
    laterBar !== null && laterBar.left > GUTTER,
    `${laterBar?.left}px`,
  );
}

/* --------------------------- L. the armed kit grid, addressed by its tick */

/**
 * Arm the kit: the drum track, then edit mode, in that order.
 *
 * The order is not a preference. Choosing a different track leaves edit mode
 * — a reader who switches instruments is looking, not writing — so arming
 * first and picking second lands on a reading surface with no grid on it,
 * which is exactly what the first version of this helper measured.
 */
async function armKit(page) {
  await toView(page, "tab");
  const track = page.getByRole("button", { name: /^Aktif track/ });
  if (!(await track.isVisible().catch(() => false))) return false;
  await track.click();
  await page.waitForTimeout(250);
  const drums = page.locator("[data-track-option='drums']");
  if ((await drums.count()) === 0) return false;
  await drums.click();
  await page.waitForTimeout(400);
  await enterEdit(page);
  await page.waitForTimeout(300);
  return (await page.locator("[data-drum-step]").count()) > 0;
}

/** Every mounted cell of one kit row, with the tick it claims to stand for. */
const kitRow = (page, piece) =>
  page.evaluate((wanted) => {
    const row = document.querySelector(`[data-drum-step-row='${wanted}']`);
    if (!row) return null;
    const scroller = [...document.querySelectorAll("*")].find((node) => {
      const style = getComputedStyle(node);
      return (
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    if (!scroller) return null;
    const origin = scroller.getBoundingClientRect().left - scroller.scrollLeft;
    const cells = [...row.querySelectorAll("[data-drum-cell]")].map((cell) => ({
      address: cell.getAttribute("data-drum-cell"),
      ticks: Number(cell.getAttribute("data-drum-cell").split(":")[1]),
      left: Math.round((cell.getBoundingClientRect().left - origin) * 10) / 10,
      width: Math.round(cell.getBoundingClientRect().width * 10) / 10,
      filled: cell.hasAttribute("data-filled"),
    }));
    const lead = row.querySelector("[data-drum-window-lead]");
    const tail = row.querySelector("[data-drum-window-tail]");
    return {
      cells,
      leadPx: lead ? Math.round(lead.getBoundingClientRect().width * 10) / 10 : 0,
      tailPx: tail ? Math.round(tail.getBoundingClientRect().width * 10) / 10 : 0,
    };
  }, piece);

async function tourGrid(page, song) {
  /*
   * What the surface measures before the kit is armed. An armed grid replaces
   * the reading window's spacers rather than sitting beside them, so the
   * surface must be exactly as wide with it as without — the claim §III is
   * about, and one that can only be made on a page that has both states.
   */
  await toView(page, "tab");
  await scrollTo(page, 0);
  await page.waitForTimeout(250);
  const reading = await surface(page);

  const armed = await armKit(page);
  record_("davul ızgarası silinmeden kurulur", armed, armed ? "grid armed" : "no kit grid");
  if (!armed) return;

  await scrollTo(page, 0);
  await page.waitForTimeout(300);
  const armedSection = await page.getAttribute("[data-viewed-section]", "data-viewed-section");
  const writing = await surface(page);
  record_(
    "silahlanmış ızgara yüzeyi genişletmiyor",
    reading !== null && writing !== null && Math.abs(reading.scrollWidth - writing.scrollWidth) <= 2,
    `okuma ${reading?.scrollWidth}px, yazma ${writing?.scrollWidth}px`,
  );
  const axis = axisWidthOf(song);
  const tail = writing === null ? 0 : Math.round(writing.clientWidth * 0.68 * 10) / 10;
  record_(
    "silahlanmış extent de axis + gutter + tail",
    writing !== null && Math.abs(writing.scrollWidth - (axis + GUTTER + tail)) <= 2,
    `${writing?.scrollWidth}px vs ${Math.round((axis + GUTTER + tail) * 10) / 10}px`,
  );

  const row = await kitRow(page, "kick");
  record_(
    "her hücre kendi tick'ini taşır",
    row !== null && row.cells.every((cell, index, all) => index === 0 || cell.ticks > all[index - 1].ticks),
    `${row?.cells.length} hücre`,
  );
  /*
   * The cell's tick and the cell's position have to agree, and both are
   * checked against the *fixture* rather than against each other: they come
   * out of the same model, so a model that shifted every tick by a slot would
   * still be perfectly consistent with itself. The bar starts are computed
   * from the song's own meters and resolutions — mixed grids included, which
   * is why a single ticks-per-slot factor would not do.
   */
  const section = song.sections.find((entry) => entry.id === armedSection);
  const barStarts = [];
  {
    let ticks = 0;
    let slots = 0;
    for (const bar of section?.bars ?? []) {
      barStarts.push({ ticks, x: GUTTER + slots * SLOT });
      ticks += slotsIn(bar) * (768 / bar.resolution);
      slots += slotsIn(bar);
    }
  }
  const misplaced = barStarts.filter((start) => {
    const cell = row?.cells.find((entry) => entry.ticks === start.ticks);
    return cell === undefined ? false : Math.abs(cell.left - start.x) > 1;
  });
  const missing = barStarts.filter(
    (start) => !(row?.cells ?? []).some((entry) => entry.ticks === start.ticks),
  );
  record_(
    "ölçü başlarının tick'i ve kanonik x'i fixture ile aynı",
    row !== null && misplaced.length === 0 && missing.length < barStarts.length,
    `${barStarts.length} ölçü başı, ${misplaced.length} yanlış yerde, ` +
      `${missing.length} mount edilmemiş`,
  );

  record_(
    "hücreler kanonik x'te sıralı ve boşluksuz",
    row !== null &&
      row.cells.every(
        (cell, index, all) => index === 0 || Math.abs(cell.left - (all[index - 1].left + all[index - 1].width)) <= 1,
      ),
    row === null ? "-" : `${row.cells[0]?.left} → ${row.cells[row.cells.length - 1]?.left}`,
  );
  record_(
    "window yalnız ızgaranın bir kısmını mount eder",
    row !== null && row.cells.length > 0 && (row.leadPx > 0 || row.tailPx > 0),
    row === null ? "-" : `lead ${row.leadPx} / tail ${row.tailPx}`,
  );

  /*
   * A hit in the middle of the window, then one at its very edge, then one
   * on the last mounted column. Each is written by tapping the cell and read
   * back out of storage at the tick the cell claimed — the address the DOM
   * showed and the address the song received have to be the same one.
   */
  const cases = [
    ["window ortasında doğru hücreye yazar", (cells) => Math.floor(cells.length / 2)],
    ["window sınırında doğru hücreye yazar", () => 0],
    ["son mount edilen kolonda doğru hücreye yazar", (cells) => cells.length - 1],
  ];
  for (const [name, pick] of cases) {
    // Picked from the window as it stands, not from the one measured before
    // the previous write: a tap can move the surface, and an index taken
    // from a stale window is a cell that is no longer there.
    const fresh = await kitRow(page, "kick");
    const cell = fresh === null ? undefined : fresh.cells[pick(fresh.cells)];
    if (!cell) {
      record_(name, false, "cell not mounted");
      continue;
    }
    const before = await storedSong(page);
    await page.locator(`[data-drum-cell='${cell.address}']`).click();
    await page.waitForTimeout(400);
    const after = await storedSong(page);
    const changed = hitTicksOf(after, armedSection).filter(
      (tick) => !hitTicksOf(before, armedSection).includes(tick),
    );
    const removed = hitTicksOf(before, armedSection).filter(
      (tick) => !hitTicksOf(after, armedSection).includes(tick),
    );
    const touched = [...changed, ...removed];
    record_(
      name,
      touched.length === 1 && touched[0] === cell.ticks,
      `hücre ${cell.address} → şarkıda ${touched.join(",") || "hiçbir şey"}`,
    );
  }

  // And the same after a scroll, which is where an off-by-one window shows.
  await scrollTo(page, 600);
  await page.waitForTimeout(350);
  const scrolled = await kitRow(page, "snare");
  const target = scrolled?.cells[2];
  if (target) {
    const before = await storedSong(page);
    await page.locator(`[data-drum-cell='${target.address}']`).click();
    await page.waitForTimeout(400);
    const after = await storedSong(page);
    const moved = hitTicksOf(after, armedSection, "snare").filter(
      (tick) => !hitTicksOf(before, armedSection, "snare").includes(tick),
    );
    const gone = hitTicksOf(before, armedSection, "snare").filter(
      (tick) => !hitTicksOf(after, armedSection, "snare").includes(tick),
    );
    const touched = [...moved, ...gone];
    record_(
      "scroll sırasında yanlış hücreye yazılmaz",
      touched.length === 1 && touched[0] === target.ticks,
      `hücre ${target.address} → şarkıda ${touched.join(",") || "hiçbir şey"}`,
    );
  } else {
    record_("scroll sırasında yanlış hücreye yazılmaz", false, "no cell after scroll");
  }
}

/**
 * Every tick a piece is written at, in the section on screen.
 *
 * Read out of the stored song rather than off the grid, because the claim
 * being tested is that the two agree — asking the grid twice would prove
 * only that it is consistent with itself.
 */
function hitTicksOf(song, sectionId, piece = "kick", trackId = "drums") {
  if (!song) return [];
  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section) return [];
  const ticks = [];
  let start = 0;
  for (const bar of section.bars) {
    // A slot is a 1/`resolution` note, and a whole note is 4 x PPQ = 768.
    const perSlot = 768 / bar.resolution;
    const lane = bar.slots[trackId];
    const count = slotsIn(bar);
    for (let slot = 0; slot < count; slot += 1) {
      const hits = Array.isArray(lane) ? lane[slot] : undefined;
      if (Array.isArray(hits) && hits.some((hit) => hit.piece === piece)) {
        ticks.push(start + slot * perSlot);
      }
    }
    start += count * perSlot;
  }
  return ticks;
}

/* ------------------------ M. what the lazy models really cost (2R-A §3) */

/**
 * The fourteen steps, in order.
 *
 * The thunks moved the arrangement and multi-track models off the edit path.
 * The question this answers is not "is it faster" — the Node harness already
 * measured that — but *where the work went*: removed, or merely deferred to
 * the first time the view is opened. So each step is measured on the page,
 * and the two view openings are timed separately from the second opening of
 * the same view, which is the one memoisation is supposed to make free.
 */
/** Click a view and wait for what it builds: click-to-mounted, in ms. */
async function openViewTimed(page, id, selector) {
  /*
   * Leave the focused edit layout first, the way a reader does (2S-A §18).
   * The switch this times is not on screen while writing, so pressing "Bitti"
   * is part of the journey being measured rather than a way around it — the
   * cost of the door is counted with the cost of the view.
   */
  const done = page.locator("[data-edit-done]");
  if (await done.isVisible().catch(() => false)) {
    await done.click();
    await page.waitForTimeout(200);
  }
  const at = Date.now();
  await view(page, id).click();
  await page.waitForSelector(selector, { timeout: 6000 }).catch(() => {});
  return Date.now() - at;
}

async function tourThunk(page) {
  await toView(page, "tab");
  const section = await page.getAttribute("[data-viewed-section]", "data-viewed-section");
  const armed = await armKit(page);
  if (!armed) {
    record_("hit ekranda görünür", false, "kit could not be armed");
    return;
  }
  await scrollTo(page, 0);
  await page.waitForTimeout(250);

  const row = await kitRow(page, "snare");
  const target = row?.cells.find((cell) => !cell.filled) ?? row?.cells[1];
  if (!target) {
    record_("hit ekranda görünür", false, "no cell to write");
    return;
  }

  const before = await writeTally(page);
  const beforeSong = await storedSong(page);
  const undoBefore = await page.locator("[data-undo]").getAttribute("aria-label");

  const tapAt = Date.now();
  await page.locator(`[data-drum-cell='${target.address}']`).click();
  await page.waitForTimeout(400);
  const tapMs = Date.now() - tapAt;

  // 1-3: the hit is on screen, and it cost exactly one write and one step.
  const filledNow = await page.evaluate(
    (address) => document.querySelector(`[data-drum-cell='${address}']`)?.hasAttribute("data-filled"),
    target.address,
  );
  record_("hit ekranda görünür", filledNow === true, `${target.address} → ${filledNow}`);

  const afterTap = await writeTally(page);
  record_(
    "hit tam 1 storage write üretir",
    afterTap.activeProject - before.activeProject === 1,
    `${afterTap.activeProject - before.activeProject} write, ${tapMs}ms`,
  );
  const undoAfter = await page.locator("[data-undo]").getAttribute("aria-label");
  record_(
    "hit tam 1 history adımı üretir",
    undoAfter !== undoBefore && undoAfter !== null && /Geri al/.test(undoAfter),
    `${undoBefore} → ${undoAfter}`,
  );

  // 4: the other two surfaces were never built while the tap was handled.
  const builtDuringTap = await page.evaluate(() => ({
    arrangement: document.querySelectorAll("[data-arr-track]").length,
    lanes: document.querySelectorAll("[data-multi-lane]").length,
  }));
  record_(
    "tap sırasında Düzen ve Çoklu kurulmaz",
    builtDuringTap.arrangement === 0 && builtDuringTap.lanes === 0,
    JSON.stringify(builtDuringTap),
  );

  // 5-7: opening Düzen builds it once, from the song as it is now.
  const arrangeMs = await openViewTimed(page, "arrange", "[data-arr-track]");
  const arrange = await page.evaluate(() => ({
    tracks: document.querySelectorAll("[data-arr-track]").length,
    sections: document.querySelectorAll("[data-arr-section]").length,
  }));
  record_("Düzen ilk açılışta kurulur", arrange.tracks > 0, `${JSON.stringify(arrange)} @ ${arrangeMs}ms`);

  const arrangeWrites = await writeTally(page);
  record_(
    "Düzen açmak yazma üretmez",
    arrangeWrites.total === afterTap.total,
    `${arrangeWrites.total - afterTap.total}`,
  );

  /*
   * The same gesture a second time. Timed the same way — click to the first
   * mounted track — so the two numbers are comparable; an earlier version
   * timed a `toView` helper that sleeps 350ms and duly reported the warm
   * open as twice the cold one.
   */
  await toView(page, "tab");
  const warmMs = await openViewTimed(page, "arrange", "[data-arr-track]");
  record_(
    "ikinci açılış birinciden pahalı değil",
    warmMs <= arrangeMs + 60,
    `soğuk ${arrangeMs}ms, sıcak ${warmMs}ms`,
  );

  // 8-11: the same for Çoklu, and the new hit is in it at the right tick.
  const multiMs = await openViewTimed(page, "multi", "[data-multi-lane]");
  const lanes = await page.evaluate(() => document.querySelectorAll("[data-multi-lane]").length);
  record_("Çoklu ilk açılışta kurulur", lanes > 0, `${lanes} lane @ ${multiMs}ms`);

  const song = await storedSong(page);
  const ticksNow = hitTicksOf(song, section, "snare");
  const ticksThen = hitTicksOf(beforeSong, section, "snare");
  const added = ticksNow.filter((tick) => !ticksThen.includes(tick));
  const removedTicks = ticksThen.filter((tick) => !ticksNow.includes(tick));
  record_(
    "yeni hit doğru tick üzerinde",
    [...added, ...removedTicks].length === 1 && [...added, ...removedTicks][0] === target.ticks,
    `${[...added, ...removedTicks].join(",")} vs ${target.ticks}`,
  );
  record_(
    "Çoklu güncel Song'u gösterir",
    await page.evaluate(
      (id) => !!document.querySelector(`[data-multi-drums='${id}']`),
      "drums",
    ),
    "davul lane'i var",
  );

  // 12-14: no second engine, no lost playback state, no extra write.
  const end = await shot(page);
  record_("görünüm açılışları AudioContext'i çoğaltmaz", end.audioContexts <= 1, `${end.audioContexts}`);
  const finalWrites = await writeTally(page);
  record_(
    "görünüm açılışları toplamda 1 write bırakır",
    finalWrites.activeProject - before.activeProject === 1,
    `${finalWrites.activeProject - before.activeProject}`,
  );
  record_(
    "playback state bozulmadan kalır",
    (await play(page).count()) === 1 && (await pause(page).count()) === 0,
    "durmuş, çalmaya hazır",
  );
}

/* ------------------------------------- N. the screen itself, at each size */

async function tourLayout(page) {
  await toView(page, "tab");
  await gotoSection(page, "four");
  await practiseBar(page, "four:0");
  await page.locator("[data-speed-mode=progressive]").click();
  await page.waitForTimeout(250);

  const sheet = await page.locator("[data-practice-sheet]").boundingBox();
  const size = page.viewportSize();
  record_(
    "sheet viewport içinde",
    sheet !== null && sheet.x >= -1 && sheet.x + sheet.width <= size.width + 1,
    sheet === null ? "-" : `${Math.round(sheet.x)}–${Math.round(sheet.x + sheet.width)} / ${size.width}`,
  );

  const critical = await targetSizes(
    page,
    "[data-count-in], [data-speed-mode], [data-speed-step], [data-practice-clear], [data-progressive-start], [data-speed-cancel]",
  );
  const small = critical.filter((box) => box.height < 44 || box.width < 44);
  record_(
    "kritik hedefler 44x44",
    critical.length >= 10 && small.length === 0,
    `${critical.length} hedef, ${small.length} küçük ${small.map((b) => `${b.label}:${b.width}x${b.height}`).join(",")}`,
  );
  /*
   * The sheet is capped at 85dvh and scrolls inside itself, so a control
   * below the fold is not an unreachable control — it is one the reader
   * scrolls to. What must be true is that scrolling *inside the sheet* is
   * enough to reach every one of them, without the page itself moving.
   */
  const belowFold = critical.filter((box) => box.bottom > size.height).length;
  await page.evaluate(() => {
    const body = document.querySelector("[data-practice-sheet]")?.parentElement;
    if (body) body.scrollTop = body.scrollHeight;
  });
  await page.waitForTimeout(250);
  const afterScroll = await targetSizes(
    page,
    "[data-count-in], [data-speed-mode], [data-speed-step], [data-practice-clear], [data-progressive-start], [data-speed-cancel]",
  );
  const unreachable = afterScroll.filter((box) => box.bottom > size.height + 1);
  record_(
    "sheet kontrolleri kaydırınca erişilebilir",
    unreachable.length === 0,
    `${belowFold} kontrol katlamanın altındaydı, kaydırınca ${unreachable.length} kaldı`,
  );

  const body = await shot(page);
  record_("sheet açıkken body yatay taşması 0", body.bodyOverflow <= 0, `${body.bodyOverflow}px`);
  record_(
    "metin ölçeği gerçekten uygulandı",
    body.rootFontPx > 0,
    `root ${body.rootFontPx}px`,
  );

  await closePractice(page);
  const closed = await shot(page);
  record_("body yatay taşması 0", closed.bodyOverflow <= 0, `${closed.bodyOverflow}px`);

  const transport = await targetSizes(page, "footer button");
  const tooSmall = transport.filter((box) => box.height < 44 || box.width < 44);
  record_(
    "transport kontrolleri 44x44 kalır",
    tooSmall.length === 0,
    `${transport.length} kontrol, ${tooSmall.map((b) => `${b.label}:${b.width}x${b.height}`).join(",") || "hepsi yeterli"}`,
  );
  record_(
    "transport kontrolleri ekran içinde",
    transport.every((box) => box.right <= size.width + 1),
    `${transport.filter((b) => b.right > size.width).length} kontrol kırpılmış`,
  );

  // The banner may wrap; it may not be cut off.
  const banner = await page.locator("[data-practice-banner]").boundingBox();
  record_(
    "banner kırpılmıyor",
    banner === null || banner.x + banner.width <= size.width + 1,
    banner === null ? "no banner" : `${Math.round(banner.x + banner.width)} / ${size.width}`,
  );
  const bannerText = await text(page, "[data-practice-banner]");
  record_(
    "banner metni kısaltılmıyor",
    bannerText === null || !bannerText.includes("…"),
    bannerText ?? "-",
  );

  // A long section name has to fit somewhere, not push the row sideways.
  const header = await page.locator("[data-section-nav]").boundingBox().catch(() => null);
  record_(
    "uzun bölüm adı satırı taşırmıyor",
    header === null || header.x + header.width <= size.width + 1,
    header === null ? "no nav" : `${Math.round(header.x + header.width)} / ${size.width}`,
  );
}

/* ------------------------------------------------------------ the run */

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const version = browser.version();

/*
 * `VIEWPORT=320x700 ONLY=layout node verify.mjs` measures one corner of the
 * matrix while iterating. The full run is the default; the artefact records
 * which combinations it actually covered rather than assuming all of them.
 */
const chosen = process.env.VIEWPORT;
const viewports = chosen
  ? VIEWPORTS.filter((entry) => entry.name === chosen)
  : process.env.ONE_VIEWPORT
    ? VIEWPORTS.slice(0, 1)
    : VIEWPORTS;
const scales = process.env.ONE_SCALE
  ? [Number(process.env.ONE_SCALE) === 1 ? 100 : Number(process.env.ONE_SCALE)]
  : TEXT_SCALES;

const SONG = fixture("practiceSong");
const STORAGE = device(SONG);

/**
 * One context per tour.
 *
 * A tour that writes a hit, deletes a bar or reloads the page leaves the
 * device in a state the next tour did not ask for. Booting fresh costs a
 * second and buys every scenario the right to say what it started from.
 */
async function run(label, viewport, textScale, tour, options = {}) {
  if (!wanted(label)) return;
  const { context, page, cdp, errors } = await boot(browser, viewport, STORAGE, {
    textScale,
    ...options,
  });
  try {
    await tour(page, cdp, errors);
  } catch (error) {
    record_(`${label} (threw)`, false, String(error).split("\n")[0]);
    if (process.env.TRACE) console.log(String(error).split("\n").slice(0, 14).join("\n"));
  } finally {
    if (!options.keepErrors) {
      const noise = errors.filter((line) => !/favicon|ResizeObserver loop/.test(line));
      if (noise.length > 0) record_(`${label} · sayfa hatası yok`, false, noise[0]);
    }
    await context.close();
  }
}

for (const viewport of viewports) {
  for (const textScale of scales) {
    combo = `${viewport.name} @%${textScale}`;
    console.log(`\n=== ${combo} ===`);

    await run("entry", viewport, textScale, (page) => tourEntry(page));
    await run("selection", viewport, textScale, (page, cdp) => tourSelection(page, cdp));
    await run("edge", viewport, textScale, (page) => tourEdge(page));
    await run("loop", viewport, textScale, (page) => tourLoop(page));
    await run("countin44", viewport, textScale, (page) => tourCountIn(page, "four", "4/4"));
    await run("countin68", viewport, textScale, (page) => tourCountIn(page, "sixeight", "6/8"));
    await run("countin78", viewport, textScale, (page) => tourCountIn(page, "seveneight", "7/8"));
    await run("cancel", viewport, textScale, (page) => tourCountInCancel(page));
    await run("speed", viewport, textScale, (page) => tourSpeed(page));
    await run("reconcile", viewport, textScale, (page) => tourReconcile(page));
    await run("boundary", viewport, textScale, (page) => tourBoundary(page));
    await run("runtime", viewport, textScale, (page, cdp, errors) => tourRuntime(page, errors));
    await run("extent", viewport, textScale, (page) => tourExtent(page, SONG));
    await run("parity", viewport, textScale, (page) => tourParity(page));
    await run("grid", viewport, textScale, (page) => tourGrid(page, SONG));
    await run("thunk", viewport, textScale, (page) => tourThunk(page));
    await run("layout", viewport, textScale, (page) => tourLayout(page));
  }
}

await browser.close();

const failed = results.filter((entry) => !entry.pass);
const scenarios = [...new Set(results.map((entry) => entry.name))];
const combos = [...new Set(results.map((entry) => entry.combo))];

writeFileSync(
  `${OUT}/BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2R-A §XIV — pratik döngüsü tarayıcı kabulü",
      measuredOn: {
        chromium: version,
        node: process.version,
        surface: "masaüstü Chromium, mobil viewport emülasyonu",
        physicalDevice: false,
        build: "production (next build + next start)",
      },
      fixture: {
        name: "practiceSong",
        sections: SONG.sections.map((section) => ({
          id: section.id,
          bars: section.bars.length,
          timeSignature: section.bars[0].timeSignature,
          resolutions: [...new Set(section.bars.map((bar) => bar.resolution))],
        })),
        canonicalAxisPx: axisWidthOf(SONG),
      },
      matrix: {
        viewports: viewports.map((entry) => entry.name),
        textScales: scales,
        distinctScenarios: scenarios.length,
        combinations: combos.length,
        results: results.length,
      },
      passed: failed.length === 0,
      failures: failed,
      results,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `\n${results.length - failed.length}/${results.length} — ` +
    `${scenarios.length} senaryo × ${combos.length} viewport/metin kombinasyonu`,
);
if (failed.length > 0) {
  for (const entry of failed.slice(0, 40)) {
    console.log(`  FAIL ${entry.combo} · ${entry.name} — ${entry.detail}`);
  }
}
process.exit(failed.length > 0 ? 1 : 0);
