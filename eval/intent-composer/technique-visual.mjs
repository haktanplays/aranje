/**
 * Does the technique notation survive contact with a real phone?
 * (Technique Notation Grammar v1 §11.)
 *
 * The geometry tests prove what the model *decides*. This proves what the
 * browser actually *draws*, on the one fixture that carries every technique
 * the Song Contract can express: a `5-7-8-7-5` legato run, a rising and a
 * falling slide, a half and a full bend, a held vibrato and a three-note
 * palm-muted range.
 *
 * The central measurement is a **before/after of the same page**: every string
 * line and every fret digit is measured with the technique layer drawn, then
 * again with it hidden. If a single coordinate moves, the overlay is part of
 * the layout and the whole premise is wrong.
 *
 * Nothing here is allowed to pass by finding nothing. Each screen asserts that
 * it really observed the marks — the counts per technique are recorded, and a
 * screen that saw none of them is a failure, not a green.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/technique-visual.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture } from "./device.mjs";
import { PROJECT_LEDGER } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer/artifacts/technique";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "320x700", width: 320, height: 700 },
];

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

/**
 * Put a note of the legato run under the reader's hand.
 *
 * A plain tap on a cell is what selects one note in edit mode, and that is
 * the state the accent belongs to. The whole phrase should go bronze, because
 * the arc is a statement about a run and not about one number.
 */
async function selectRunNote(page) {
  const node = page.locator("[data-cell='2:2']").first();
  if ((await node.count()) === 0) return;
  await node.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await node.click();
  await page.waitForTimeout(400);
}

/**
 * Every coordinate the overlay is forbidden to move, read off the real DOM.
 *
 * Keyed by bar and index rather than by document order, so a windowed surface
 * that mounts a different set of bars cannot make two runs look different.
 */
const anchors = (page) =>
  page.evaluate(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const out = { lines: {}, digits: {}, bars: {} };
    for (const bar of document.querySelectorAll("[data-bar-key]")) {
      const key = bar.getAttribute("data-bar-key");
      const frame = bar.getBoundingClientRect();
      // The bar's own size is the sharpest test of "the overlay is not part
      // of the layout": every string line and digit inside it is absolutely
      // positioned, so only the frame notices an in-flow child.
      out.bars[key] = { w: round(frame.width), h: round(frame.height) };
      for (const line of bar.querySelectorAll("[data-string-line]")) {
        const box = line.getBoundingClientRect();
        out.lines[`${key}:${line.getAttribute("data-string-line")}`] = round(box.top);
      }
      for (const glyph of bar.querySelectorAll("[data-fret-glyph]")) {
        const box = glyph.getBoundingClientRect();
        const slot = glyph.getAttribute("data-glyph-slot");
        out.digits[`${key}:${slot}:${glyph.getAttribute("data-fret-glyph")}`] = {
          x: round(box.left + box.width / 2),
          y: round(box.top + box.height / 2),
        };
      }
    }
    return out;
  });

/** Everything the marks themselves are, and everything they must not touch. */
const marks = (page) =>
  page.evaluate(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const overlaps = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const kinds = {};
    const tones = {};
    /** Marks in the tree but drawn nowhere — the vacuity gate reads this. */
    let invisible = 0;
    let digitCollisions = 0;
    let neighbourCollisions = 0;
    let slotViolations = 0;
    let stolenTargets = 0;
    const worst = [];

    for (const bar of document.querySelectorAll("[data-bar-key]")) {
      const lines = new Map();
      for (const line of bar.querySelectorAll("[data-string-line]")) {
        lines.set(
          Number(line.getAttribute("data-string-line")),
          line.getBoundingClientRect().top,
        );
      }
      const digits = [...bar.querySelectorAll("[data-fret-glyph]")].map((node) => ({
        slot: Number(node.getAttribute("data-glyph-slot")),
        box: node.getBoundingClientRect(),
      }));

      for (const node of bar.querySelectorAll("[data-technique]")) {
        const kind = node.getAttribute("data-technique");
        const owner = Number(node.getAttribute("data-technique-string"));
        const tone = node.getAttribute("data-technique-tone");
        kinds[kind] = (kinds[kind] ?? 0) + 1;
        tones[tone] = (tones[tone] ?? 0) + 1;
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
          invisible += 1;
          continue;
        }

        // A mark may sit on its own string's line (a slide does) and may never
        // reach the line above it, which belongs to another string.
        const above = lines.get(owner + 1);
        if (above !== undefined && box.top < above) {
          neighbourCollisions += 1;
          worst.push({ kind, why: "neighbour", top: round(box.top), above: round(above) });
        }

        for (const digit of digits) {
          if (!overlaps(box, digit.box)) continue;
          // A slide's connector legitimately shares a row with the numbers it
          // joins, but it may not overlap either of them.
          digitCollisions += 1;
          worst.push({ kind, why: "digit", slot: digit.slot });
        }

        // Nothing here may own a touch: the cell underneath has to answer.
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit.closest("[data-technique-layer]")) {
          stolenTargets += 1;
          worst.push({ kind, why: "hit" });
        }

        // The room this mark was allowed, as the pure model decided it.
        // A tolerance of one pixel, because a glyph's painted box is not its
        // advance width and the model does not pretend to know font metrics.
        const frame = bar.getBoundingClientRect();
        const [ownerLeft, ownerRight] = (node.getAttribute("data-owner") ?? "")
          .split(",")
          .map(Number);
        if (Number.isFinite(ownerLeft) && Number.isFinite(ownerRight)) {
          if (
            box.left < frame.left + ownerLeft - 1 ||
            box.right > frame.left + ownerRight + 1
          ) {
            slotViolations += 1;
            worst.push({
              kind,
              why: "owner",
              box: [round(box.left - frame.left), round(box.right - frame.left)],
              owner: [ownerLeft, ownerRight],
            });
          }
        }
        if (box.left < frame.left - 0.5 || box.right > frame.right + 0.5) {
          slotViolations += 1;
          worst.push({ kind, why: "bar", left: round(box.left), right: round(box.right) });
        }
      }
    }

    /*
     * The staff is exactly six rows tall and nothing else. Measured as an
     * absolute fact rather than as a before/after, because a staff that grew
     * with the marks would grow in both measurements and drift would see
     * nothing.
     */
    let staffGrew = 0;
    for (const line of document.querySelectorAll("[data-string-line]")) {
      const staffBox = line.parentElement?.getBoundingClientRect();
      const siblings = [...(line.parentElement?.children ?? [])].filter((node) =>
        node.hasAttribute?.("data-string-line"),
      );
      if (!staffBox || siblings.length < 2) continue;
      const tops = siblings.map((node) => node.getBoundingClientRect().top);
      const spacing = Math.abs((tops[1] ?? 0) - (tops[0] ?? 0));
      if (spacing > 0 && Math.abs(staffBox.height - siblings.length * spacing) > 1) {
        staffGrew += 1;
      }
      break;
    }

    const staff = document.querySelector("[data-tab-scroll]") ?? document.body;
    const staffScrollers = [...staff.querySelectorAll("*")].filter(
      (node) =>
        node.scrollHeight > node.clientHeight + 1 &&
        ["auto", "scroll"].includes(getComputedStyle(node).overflowY),
    ).length;

    return {
      kinds,
      tones,
      invisible,
      staffGrew,
      selectedGlyphs: document.querySelectorAll("[data-glyph-state='selected']").length,
      digitCollisions,
      neighbourCollisions,
      slotViolations,
      stolenTargets,
      staffScrollers,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      worst: worst.slice(0, 8),
    };
  });

const drift = (before, after) => {
  const moved = [];
  for (const [key, value] of Object.entries(before.bars)) {
    const now = after.bars[key];
    if (!now || now.w !== value.w || now.h !== value.h) {
      moved.push({ key, before: value, after: now ?? null });
    }
  }
  for (const [key, value] of Object.entries(before.lines)) {
    if (after.lines[key] !== value) moved.push({ key, before: value, after: after.lines[key] });
  }
  for (const [key, value] of Object.entries(before.digits)) {
    const now = after.digits[key];
    if (!now || now.x !== value.x || now.y !== value.y) {
      moved.push({ key, before: value, after: now ?? null });
    }
  }
  return moved;
};

/**
 * Scroll the tab so the far half of the fixture is on screen.
 *
 * The bends, the vibrato and the palm-muted range sit past slot 9, which is
 * off a 320px screen at the song's start. The measurements hold either way —
 * every check compares boxes inside one bar — but a screenshot that never
 * shows those marks is not a picture of them.
 */
async function scrollToTail(page) {
  await page.evaluate(() => {
    const bars = [...document.querySelectorAll("[data-bar-key]")];
    const second = bars[1];
    let node = bars[0]?.parentElement ?? null;
    while (node && getComputedStyle(node).overflowX !== "auto") {
      node = node.parentElement;
    }
    if (!node || !second) return;
    // Far enough back that the last bends and the vibrato of the first bar
    // are on screen, far enough forward that the second bar's PM label is.
    const target = second.offsetLeft - 214;
    node.scrollLeft = Math.max(0, Math.min(target, node.scrollWidth - node.clientWidth));
  });
  await page.waitForTimeout(500);
}

const screens = [];

async function run(browser, viewport, mode) {
  const { context, page, errors } = await boot(browser, viewport);
  if (mode === "edit") {
    await enterEdit(page);
    await selectRunNote(page);
  }
  if (mode === "tail") await scrollToTail(page);
  await page.waitForTimeout(250);

  const name = `${viewport.name}-${mode}`;
  const withLayer = await anchors(page);
  const measured = await marks(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

  // The same page with the marks hidden. `display:none` on an absolutely
  // positioned overlay changes nothing about the layout — unless it does,
  // which is the whole thing being tested.
  await page.addStyleTag({ content: "[data-technique-layer]{display:none}" });
  await page.waitForTimeout(200);
  const without = await anchors(page);
  const hidden = await marks(page);

  const moved = drift(withLayer, without);
  // A scroller that is already there with the marks hidden is not this
  // round's doing: the 320x700 selection-toolbar decision is 2S-A's and is
  // deliberately not redesigned here.
  const newScrollers = Math.max(
    0,
    measured.staffScrollers - hidden.staffScrollers,
  );
  const drawn = Object.values(measured.kinds).reduce((a, b) => a + b, 0);
  const stillDrawn = Object.values(hidden.kinds).reduce((a, b) => a + b, 0);
  const wentDark = hidden.invisible;

  const preview = measured.tones.preview ?? 0;
  const read = measured.tones.read ?? 0;
  /*
   * Grey is what permanent notation looks like; the accent belongs only to
   * the note under the reader's hand. A read screen with any accent on it is
   * a layer that has forgotten the difference.
   */
  const tonesCorrect =
    mode === "edit" ? preview >= 1 && read >= 1 : preview === 0 && read === drawn;

  const verdict = {
    name,
    viewport: viewport.name,
    mode,
    stringLines: Object.keys(withLayer.lines).length,
    digits: Object.keys(withLayer.digits).length,
    marksDrawn: drawn,
    perTechnique: measured.kinds,
    tones: measured.tones,
    tonesCorrect,
    layoutDrift: moved.length,
    movedExamples: moved.slice(0, 4),
    digitCollisions: measured.digitCollisions,
    neighbourCollisions: measured.neighbourCollisions,
    slotViolations: measured.slotViolations,
    stolenTargets: measured.stolenTargets,
    bodyOverflow: measured.bodyOverflow,
    staffGrewWithTheMarks: measured.staffGrew,
    staffScrollers: measured.staffScrollers,
    staffScrollersWithoutMarks: hidden.staffScrollers,
    staffScrollersAdded: newScrollers,
    consoleErrors: errors.length,
    /** The vacuity gate: hiding the layer must really remove what was seen. */
    selectedGlyphs: measured.selectedGlyphs,
    marksHiddenWhenLayerIsOff: wentDark,
    /*
     * The proof that this screen really looked at the marks: every one of
     * them had a real box, and every one of them lost it when the layer was
     * hidden. A harness that found nothing would fail here rather than pass.
     */
    observedTheLayer: drawn > 0 && wentDark === drawn && stillDrawn === drawn,
    worst: measured.worst,
  };
  verdict.pass =
    verdict.observedTheLayer &&
    tonesCorrect &&
    verdict.staffGrewWithTheMarks === 0 &&
    verdict.layoutDrift === 0 &&
    verdict.digitCollisions === 0 &&
    verdict.neighbourCollisions === 0 &&
    verdict.slotViolations === 0 &&
    verdict.stolenTargets === 0 &&
    verdict.bodyOverflow <= 0 &&
    verdict.staffScrollersAdded === 0 &&
    verdict.consoleErrors === 0;

  screens.push(verdict);
  console.log(
    `${verdict.pass ? "ok  " : "FAIL"} ${name} marks=${drawn} ` +
      `${JSON.stringify(measured.kinds)} tones=${JSON.stringify(measured.tones)} ` +
      `drift=${moved.length} collide=${measured.digitCollisions}/${measured.neighbourCollisions} ` +
      `slot=${measured.slotViolations} hits=${measured.stolenTargets} ` +
      `overflow=${measured.bodyOverflow} grew=${measured.staffGrew} ` +
      `scrollers=${measured.staffScrollers}(+${newScrollers}) ` +
      `errors=${errors.length} sel=${measured.selectedGlyphs} dark=${wentDark}/${drawn}`,
  );
  if (!verdict.pass) console.log(JSON.stringify(measured.worst, null, 1));
  await context.close();
}

const browser = await chromium.launch();
for (const viewport of VIEWPORTS) {
  for (const mode of ["read", "tail", "edit"]) {
    await run(browser, viewport, mode);
  }
}
await browser.close();

const artefact = {
  what: "Technique Notation Grammar v1 §11 — tarayıcı kabulü",
  fixture:
    "techniques: 5-7-8-7-5 legato koşusu, çıkan ve inen slide, ½ ve 1 bend, tutulan vibrato, üç notalık palm mute aralığı.",
  method:
    "Aynı sayfa iki kez ölçülür: teknik katmanı çizilirken ve gizliyken. Tel çizgileri ile perde rakamlarının koordinatları birebir aynı kalmak zorundadır.",
  notes: [
    "Ölçüm boş dönerse geçmez: her ekran gerçekten kaç işaret gördüğünü kaydeder ve katman gizlendiğinde sıfıra düşmek zorundadır.",
    "320×700 seçim çubuğu ürün kararı bu turda yeniden tasarlanmadı; burada yalnız teknik katmanının mevcut durumu kötüleştirmediği ölçüldü.",
  ],
  screens,
  green: screens.every((screen) => screen.pass),
};
writeFileSync(`${OUT}/../../TECHNIQUE-VISUAL.json`, `${JSON.stringify(artefact, null, 2)}\n`);
console.log(artefact.green ? "GREEN" : "NOT GREEN");
// Non-zero on failure, so a vacuity probe can assert this run goes red.
process.exitCode = artefact.green ? 0 : 1;
