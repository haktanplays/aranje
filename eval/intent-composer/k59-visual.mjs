/**
 * The two visual problems K-59 left open, measured on a real browser.
 *
 *  1. the legato underline that repeated what the HO/PO arc already said;
 *  2. the `320×700` focused-edit selection stack that clipped the staff.
 *
 * Eight screens a person can look at, and the numbers under each one. It
 * approves nothing: the measurements are recorded as measurements and the
 * founder decision stays open.
 *
 * `--before` runs the same measurements without expecting anything this round
 * added, so the two builds can be compared on identical arithmetic.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/k59-visual.mjs [--before]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture } from "./device.mjs";
import { PROJECT_LEDGER } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const BEFORE = process.argv.includes("--before");
const OUT = "eval/intent-composer/artifacts/k59";
mkdirSync(OUT, { recursive: true });

const V390 = { name: "390x844", width: 390, height: 844 };
const V320 = { name: "320x700", width: 320, height: 700 };

async function boot(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries, ledger]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(ledger);
    },
    [Object.entries(device(fixture("techniques"))), PROJECT_LEDGER],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  await page.getByTestId("view-tab").click();
  await page.waitForTimeout(400);
  return { context, page, errors };
}

const enterEdit = async (page) => {
  const edit = page
    .locator("[data-action-row] button", { hasText: "Düzenle" })
    .first();
  if (await edit.isVisible().catch(() => false)) {
    await edit.click();
    await page.waitForTimeout(400);
  }
};

/** The surface's own long press, which is what opens a time selection. */
async function coverRun(page, context, from = "0:2", to = "4:2") {
  const cdp = await context.newCDPSession(page);
  const node = page.locator(`[data-cell='${from}']`).first();
  if ((await node.count()) === 0) return;
  const box = await node.boundingBox();
  if (!box) return;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
  });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(450);

  for (let stage = 0; stage < 4; stage += 1) {
    if ((await page.getByTestId("selection-handle-end").count()) === 0) break;
    const handle = await page.getByTestId("selection-handle-end").boundingBox();
    const target = await page.locator(`[data-cell='${to}']`).first().boundingBox();
    if (!handle || !target) break;
    const edge = page.viewportSize().width - 8;
    const goal = Math.min(target.x + target.width, edge);
    if (goal <= handle.x + handle.width / 2 + 2) break;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, id: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: handle.x + handle.width / 2 + ((goal - handle.x - handle.width / 2) * step) / 8,
            y: handle.y + handle.height / 2,
            id: 1,
          },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(350);
  }
}

/** Pick the three-voice pen up. */
async function armPen(page) {
  const door = page.locator("[data-composer-door='shape']").first();
  if ((await door.count()) === 0) return;
  await door.click();
  await page.waitForTimeout(300);
  const option = page.locator("[data-composer-option='power-3']").first();
  if ((await option.count()) > 0) {
    await option.click();
    await page.waitForTimeout(400);
  }
}

/**
 * Hold a beat, so the pen's ghost is on screen, and never let go.
 *
 * The press *is* the preview: a pen writes on the tap. The touch is cancelled
 * rather than released once the screen has been taken, which is also the proof
 * that nothing was written — a commit would have needed the release.
 */
async function holdBeat(page, context, cell = "5:2") {
  const cdp = await context.newCDPSession(page);
  const node = page.locator(`[data-cell='${cell}']`).first();
  if ((await node.count()) === 0) return null;
  const box = await node.boundingBox();
  if (!box) return null;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
  });
  await page.waitForTimeout(250);
  return cdp;
}

const letGo = async (page, cdp) => {
  if (!cdp) return;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await page.waitForTimeout(200);
};

const scrollToTail = (page) =>
  page
    .evaluate(() => {
      const bars = [...document.querySelectorAll("[data-bar-key]")];
      let node = bars[0]?.parentElement ?? null;
      while (node && getComputedStyle(node).overflowX !== "auto") node = node.parentElement;
      if (!node || !bars[1]) return;
      node.scrollLeft = Math.max(
        0,
        Math.min(bars[1].offsetLeft - 214, node.scrollWidth - node.clientWidth),
      );
    })
    .then(() => page.waitForTimeout(400));

/** Everything §7 and §8 ask for, off the real DOM. */
const measure = (page) =>
  page.evaluate(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const overlaps = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const staffScroller = (() => {
      let node = document.querySelector("[data-bar-key]")?.parentElement ?? null;
      while (node && getComputedStyle(node).overflowX !== "auto") node = node.parentElement;
      return node;
    })();
    const main = document.querySelector("main");
    const staffBox = staffScroller?.getBoundingClientRect() ?? null;
    const mainBox = main?.getBoundingClientRect() ?? null;

    const bar = document.querySelector("[data-bar-key]");
    const lines = [...(bar?.querySelectorAll("[data-string-line]") ?? [])].map((node) => ({
      index: Number(node.getAttribute("data-string-line")),
      y: round(node.getBoundingClientRect().top),
    }));
    lines.sort((a, b) => a.index - b.index);

    // A string is visible when its line is inside the surface the staff is
    // drawn on *and* inside the window. A row clipped by either is not there.
    const visibleStrings = lines.filter(
      (line) =>
        mainBox !== null &&
        line.y >= mainBox.top - 0.5 &&
        line.y <= mainBox.bottom + 0.5 &&
        line.y >= 0 &&
        line.y <= window.innerHeight,
    ).length;

    /*
     * A ghost is drawn with the same glyph the real notes use, which is the
     * point — it has to look like a fret number. So every count of "the
     * digits" excludes it, or a preview would look like music.
     */
    const realGlyphs = (root) =>
      [...root.querySelectorAll("[data-fret-glyph]")].filter(
        (node) => !node.closest("[data-pen-ghost]"),
      );

    const digits = {};
    for (const glyph of realGlyphs(document)) {
      const box = glyph.getBoundingClientRect();
      const owner = glyph.closest("[data-bar-key]")?.getAttribute("data-bar-key");
      digits[`${owner}:${glyph.getAttribute("data-glyph-slot")}:${glyph.getAttribute("data-fret-glyph")}`] =
        { x: round(box.left + box.width / 2), y: round(box.top + box.height / 2) };
    }

    let annotationCollisions = 0;
    let ownerSlotViolations = 0;
    let stolenTargets = 0;
    for (const frame of document.querySelectorAll("[data-bar-key]")) {
      const box = frame.getBoundingClientRect();
      const glyphs = realGlyphs(frame).map((node) => node.getBoundingClientRect());
      for (const mark of frame.querySelectorAll("[data-technique]")) {
        const rect = mark.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        for (const glyph of glyphs) if (overlaps(rect, glyph)) annotationCollisions += 1;
        const [left, right] = (mark.getAttribute("data-owner") ?? "").split(",").map(Number);
        if (Number.isFinite(left) && Number.isFinite(right)) {
          if (rect.left < box.left + left - 1 || rect.right > box.left + right + 1) {
            ownerSlotViolations += 1;
          }
        }
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (hit && hit.closest("[data-technique-layer]")) stolenTargets += 1;
      }
    }

    // Every visible control, and the ones under the touch minimum.
    const controls = [...document.querySelectorAll("button, [role='button'], a[href]")]
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(
        ({ node, box }) =>
          box.width > 0 &&
          box.height > 0 &&
          getComputedStyle(node).visibility !== "hidden" &&
          box.bottom > 0 &&
          box.top < window.innerHeight,
      );
    /*
     * The staff's own edit cells are excluded, and counted separately.
     *
     * A cell is one slot wide (34px) and a finger tall (44px) by decision, not
     * by accident: widening it would pull this lane's bar lines away from
     * every other lane's, which is the one thing the shared axis exists to
     * hold together (K-57, `geometry.ts`). Hiding them in this count would be
     * dishonest; counting them as new failures would be wrong.
     */
    const isCell = (node) => node.hasAttribute("data-cell");
    const undersized = ({ box }) => box.width < 43.5 || box.height < 43.5;
    const small = controls
      .filter(({ node, box }) => !isCell(node) && undersized({ box }))
      .map(({ node, box }) => ({
        label: (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().slice(0, 24),
        w: round(box.width),
        h: round(box.height),
      }));
    const slotWideCells = controls.filter(
      ({ node, box }) => isCell(node) && undersized({ box }),
    ).length;

    // A label the reader cannot finish reading.
    const truncated = controls
      .flatMap(({ node }) => [...node.querySelectorAll("*"), node])
      .filter((node) => node.children.length === 0 && (node.textContent ?? "").trim().length > 0)
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => (node.textContent ?? "").trim().slice(0, 24));

    const scrollersIn = (root) =>
      root
        ? [...root.querySelectorAll("*")].filter(
            (node) =>
              node.scrollHeight > node.clientHeight + 1 &&
              ["auto", "scroll"].includes(getComputedStyle(node).overflowY),
          ).length
        : 0;

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      staffBounds: staffBox
        ? {
            top: round(staffBox.top),
            left: round(staffBox.left),
            width: round(staffBox.width),
            height: round(staffBox.height),
          }
        : null,
      mainHeight: mainBox ? round(mainBox.height) : null,
      stringY: lines.map((line) => line.y),
      visibleStringCount: visibleStrings,
      digitCentres: digits,
      digitCount: Object.keys(digits).length,
      internalScrollers: scrollersIn(main),
      undersizedTargets: small,
      slotWideEditCells: slotWideCells,
      truncatedLabels: truncated,
      annotationCollisions,
      ownerSlotViolations,
      stolenTargets,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      /* The two things this round is about, counted rather than described. */
      legatoUnderlines: document.querySelectorAll("[data-glyph-state='legato']").length,
      characterMarks: document.querySelectorAll("[data-fret-glyph] + span .sr-only").length,
      ghostVoices: Number(
        document.querySelector("[data-pen-ghost]")?.getAttribute("data-pen-ghost") ?? 0,
      ),
      selectionToolbarHeight: round(
        document.querySelector("[data-selection-toolbar]")?.getBoundingClientRect().height ?? 0,
      ),
      tallSelectionBarHeight: round(
        document.querySelector("[data-testid='selection-action-bar']")?.getBoundingClientRect()
          .height ?? 0,
      ),
      doorRowHeight: round(
        document.querySelector("[data-composer-doors]")?.getBoundingClientRect().height ?? 0,
      ),
      actionRowHeight: round(
        document.querySelector("[data-action-row]")?.getBoundingClientRect().height ?? 0,
      ),
      /*
       * §4's three rules, stated as counts rather than as prose.
       *
       * Each of these was a rule nothing measured until a mutation probe came
       * back green: the doors and the selection row share a line, there is one
       * way out of edit mode, and the section is named once.
       */
      editing: document.querySelector("[data-edit-header]") !== null,
      selectionOpen: document.querySelector("[data-edit-header-selection]") !== null,
      doorRowPresent: document.querySelector("[data-composer-doors]") !== null,
      waysOutOfEditMode: [...document.querySelectorAll("button")].filter((node) => {
        const name = (node.getAttribute("aria-label") ?? node.textContent ?? "").trim();
        return name === "Bitti" || name === "Düzenlemeyi bitir";
      }).length,
      sectionNamesInStaff: [...document.querySelectorAll("[data-section-name]")].filter(
        (node) => !node.hidden && (node.textContent ?? "").trim().length > 0,
      ).length,
      doorLabels: [...document.querySelectorAll("[data-composer-door]")].map((node) => ({
        drawn: (node.textContent ?? "").trim(),
        name: node.getAttribute("aria-label"),
      })),
    };
  });

/** Fret numbers that are really in the song, ghosts excluded. */
const realDigits = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("[data-fret-glyph]")].filter(
        (node) => !node.closest("[data-pen-ghost]"),
      ).length,
  );

const screens = [];

async function shot(name, page, errors) {
  const numbers = await measure(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  const entry = { name, ...numbers, consoleErrors: errors.length };
  screens.push(entry);
  console.log(
    `${name} strings=${entry.visibleStringCount}/6 scrollers=${entry.internalScrollers} ` +
      `small=${entry.undersizedTargets.length} trunc=${entry.truncatedLabels.length} ` +
      `overflow=${entry.bodyOverflow} underlines=${entry.legatoUnderlines} ` +
      `ghost=${entry.ghostVoices} toolbar=${entry.selectionToolbarHeight} ` +
      `tall=${entry.tallSelectionBarHeight} main=${entry.mainHeight} err=${entry.consoleErrors}`,
  );
  return entry;
}

const browser = await chromium.launch();

/* 1 — 390 read, the hammer-on/pull-off run. */
{
  const { context, page, errors } = await boot(browser, V390);
  await shot("1-390-read-hopo", page, errors);
  await context.close();
}

/* 2 — 390 focused edit, the run covered. */
{
  const { context, page, errors } = await boot(browser, V390);
  await enterEdit(page);
  await coverRun(page, context);
  await shot("2-390-edit-hopo-selected", page, errors);
  await context.close();
}

/* 3 — 390 focused edit, the slides, bends, vibrato and palm mute. */
{
  const { context, page, errors } = await boot(browser, V390);
  await enterEdit(page);
  await scrollToTail(page);
  await shot("3-390-edit-techniques", page, errors);
  await context.close();
}

/* 4 — 390, the power chord pen's real ghost. */
{
  const { context, page, errors } = await boot(browser, V390);
  await enterEdit(page);
  await armPen(page);
  const cdp = await holdBeat(page, context);
  const entry = await shot("4-390-power-ghost", page, errors);
  await letGo(page, cdp);
  entry.wroteNothing = (await realDigits(page)) === entry.digitCount;
  await context.close();
}

/* 5 — 320x700 with a selection open, the top of the screen. */
{
  const { context, page, errors } = await boot(browser, V320);
  await enterEdit(page);
  await coverRun(page, context);
  await shot("5-320-selection-top", page, errors);
  await context.close();
}

/* 6 — 320x700 with a selection open, staff and toolbar together. */
{
  const { context, page, errors } = await boot(browser, V320);
  await enterEdit(page);
  await coverRun(page, context);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("6-320-selection-staff", page, errors);
  await context.close();
}

/* 7 — 320x700, the "Daha fazla" drawer. */
{
  const { context, page, errors } = await boot(browser, V320);
  await enterEdit(page);
  await coverRun(page, context);
  const more = page.locator("[data-selection-more]").first();
  if ((await more.count()) > 0) {
    await more.click();
    await page.waitForTimeout(400);
  }
  await shot("7-320-more-sheet", page, errors);
  await context.close();
}

/* 8 — 320x700, the power chord pen's real ghost. */
{
  const { context, page, errors } = await boot(browser, V320);
  await enterEdit(page);
  await armPen(page);
  const cdp = await holdBeat(page, context);
  const entry = await shot("8-320-power-ghost", page, errors);
  await letGo(page, cdp);
  entry.wroteNothing = (await realDigits(page)) === entry.digitCount;
  await context.close();
}

await browser.close();

/*
 * The gate §7 names, as one predicate over every screen.
 *
 * The edit cells are excluded from the touch minimum and counted separately:
 * a cell is one slot wide by decision (K-57), and hiding that here would be
 * dishonest while counting it as a failure would be wrong.
 */
const green = screens.every(
  (screen) =>
    screen.visibleStringCount === 6 &&
    screen.internalScrollers === 0 &&
    screen.bodyOverflow <= 0 &&
    screen.undersizedTargets.length === 0 &&
    screen.truncatedLabels.length === 0 &&
    screen.annotationCollisions === 0 &&
    screen.ownerSlotViolations === 0 &&
    screen.stolenTargets === 0 &&
    screen.consoleErrors === 0 &&
    screen.legatoUnderlines === 0 &&
    screen.tallSelectionBarHeight === 0 &&
    // The doors and the selection row are one line of the screen, never two.
    screen.doorRowPresent === (screen.editing && !screen.selectionOpen) &&
    // One way out of a mode, in one place.
    screen.waysOutOfEditMode === (screen.editing ? 1 : 0) &&
    // The section is named once: in the header while writing, in the staff
    // while reading.
    screen.sectionNamesInStaff === (screen.editing ? 0 : 1) &&
    (screen.wroteNothing === undefined || screen.wroteNothing) &&
    // The two ghost screens must really have seen all three voices.
    (!screen.name.includes("ghost") || screen.ghostVoices === 3),
);

const artefact = {
  what: "K-59 Visual Closure — sekiz founder ekranı ve altlarındaki sayılar",
  build: BEFORE ? "before" : "after",
  fixture:
    "techniques: 5-7-8-7-5 HO/PO koşusu, çıkan ve inen slide, ½ ve 1 bend, tutulan vibrato, üç notalık palm mute.",
  notes: [
    "Hiçbir görsel kabul burada onaylanmaz; ölçüm ölçüm olarak kaydedilir.",
    "Fiziksel Android/iOS kabulü yapılmadı; bütün sayılar masaüstü Chromium'dandır.",
  ],
  green,
  screens,
};
writeFileSync(
  `eval/intent-composer/K59-${BEFORE ? "BEFORE" : "VISUAL"}.json`,
  `${JSON.stringify(artefact, null, 2)}\n`,
);
console.log(`${BEFORE ? "BEFORE" : "AFTER"} recorded — ${green ? "GREEN" : "NOT GREEN"}`);
if (!BEFORE) process.exitCode = green ? 0 : 1;
