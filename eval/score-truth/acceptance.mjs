/**
 * 2T-B §15. The Score Truth surfaces, in a real browser, at four sizes.
 *
 * Four viewports because a rhythm tail that is legible on a phone and a
 * duration grip that is reachable with a thumb are not the same claim as
 * "it renders". The desktop size is the control: it is where a layout bug
 * hides, because everything fits.
 *
 *   rm -rf .next && npm run build && npx next start -p 3104
 *   node eval/score-truth/acceptance.mjs
 */
import { writeFileSync } from "node:fs";

import { chromium } from "playwright";

import { activeSongBytes, deviceWith } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3104";

const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700, touch: true },
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "412x915", width: 412, height: 915, touch: true },
  { name: "1280x800", width: 1280, height: 800, touch: false },
];

/** A chord, a rest, a dotted value and a triplet bar — one of each tail part. */
function seedSong() {
  const bar1 = Array.from({ length: 16 }, () => null);
  bar1[0] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "B2", position: { string: 1, fret: 2 } },
      { pitch: "E3", position: { string: 2, fret: 2 } },
    ],
  };
  bar1[4] = { notes: [{ pitch: "G3", position: { string: 3, fret: 0 }, durationTicks: 144 }] };
  bar1[7] = { notes: [{ pitch: "A3", position: { string: 3, fret: 2 }, durationTicks: 48 }] };
  bar1[12] = { notes: [{ pitch: "E4", position: { string: 5, fret: 0 }, durationTicks: 192 }] };

  const bar2 = Array.from({ length: 12 }, () => null);
  for (let index = 0; index < 6; index += 1) {
    bar2[index] = {
      notes: [{ pitch: "B3", position: { string: 4, fret: 0 }, durationTicks: 64 }],
    };
  }

  return {
    version: 3,
    title: "Score Truth",
    bpm: 100,
    key: "E minor",
    tracks: [
      {
        id: "gtr",
        name: "Gitar",
        instrumentId: "electric_guitar",
        presetId: "clean",
        volumeDb: -6,
        fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
      },
    ],
    sections: [
      {
        id: "s1",
        name: "Ana",
        status: "fixed",
        bars: [
          { timeSignature: [4, 4], resolution: 16, slots: { gtr: bar1 } },
          { timeSignature: [4, 4], resolution: 12, slots: { gtr: bar2 } },
        ],
      },
    ],
  };
}

const browser = await chromium.launch();
const report = [];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.touch,
  });
  await context.addInitScript((seed) => {
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
  }, deviceWith(seedSong()));

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));

  const scenario = {};
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-bar-key]");

  /* 1-6: the rhythm tail draws every part, and covers no digit. */
  scenario.tailNotes = await page.locator('[aria-label^="Nota:"]').count();
  scenario.tailRests = await page.locator('[aria-label^="Es:"]').count();
  scenario.tailBeams = await page.locator('[aria-label^="Ritim grubu"]').count();
  scenario.tailTuplets = await page.locator("[aria-label$=\"'lü grup\"]").count();
  scenario.dottedRead = await page
    .locator('[aria-label*="noktalı"]')
    .count();
  scenario.digitOverlaps = await page.evaluate(() => {
    const hit = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const tail = [
      ...document.querySelectorAll('[aria-label^="Nota:"],[aria-label^="Es:"],[aria-label^="Ritim grubu"]'),
    ].map((node) => node.getBoundingClientRect());
    let count = 0;
    for (const node of document.querySelectorAll("[data-fret-glyph]")) {
      const box = node.getBoundingClientRect();
      for (const other of tail) if (hit(box, other)) count += 1;
    }
    return count;
  });

  /* 7: the tail takes no pointer events at all. */
  scenario.tailPointerTargets = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll('[aria-label^="Nota:"],[aria-label^="Es:"],[aria-label^="Ritim grubu"]'),
      ].filter((node) => {
        let element = node;
        while (element && element !== document.body) {
          if (getComputedStyle(element).pointerEvents === "none") return false;
          element = element.parentElement;
        }
        return true;
      }).length,
  );

  /* 8: nothing scrolls sideways off the page. */
  scenario.pageOverflowX = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );

  /* 9-16: the duration grip and the chord door, through the real UI. */
  await page.getByRole("button", { name: "Düzenle", exact: true }).first().click();
  await page.waitForTimeout(400);
  const glyph = page.locator("[data-fret-glyph]").first();
  const box = await glyph.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);

  const handle = page.locator('[data-testid="duration-handle"]');
  scenario.handlePresent = (await handle.count()) === 1;
  /* A sheet taller than the screen scrolls, and so does a reader. */
  await handle.scrollIntoViewIfNeeded();
  const grip = await handle.boundingBox();
  scenario.handleTall = Math.round(grip.height);
  const plus = await page.locator('[data-testid="duration-longer"]').boundingBox();
  scenario.plusTouch = Math.round(Math.min(plus.width, plus.height));

  const before = await activeSongBytes(page);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 30, grip.y + grip.height / 2, { steps: 5 });
  scenario.previewBand = (await page.locator("[data-duration-preview]").count()) === 1;
  scenario.previewWroteNothing = (await activeSongBytes(page)) === before;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  scenario.roundTripWroteNothing = (await activeSongBytes(page)) === before;

  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 30, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(650);
  const lengthened = await activeSongBytes(page);
  scenario.lengthenWrote = lengthened !== before;

  /* 17-21: the chord door, its preview, and one transform end to end. */
  const door = page.locator("[data-shape-open]");
  scenario.doorStartsShut = (await door.count()) === 1;
  await door.scrollIntoViewIfNeeded();
  await door.click();
  await page.waitForTimeout(250);
  const preview = page.locator("[data-shape-preview]");
  scenario.previewText = (await preview.textContent())?.trim() ?? null;
  scenario.previewRefused = (await preview.getAttribute("data-refused")) === "true";
  scenario.shapePreviewWroteNothing =
    (await activeSongBytes(page)) === lengthened;
  const arpeggio = page.locator("[data-shape-arpeggio]");
  scenario.arpeggioOffered = !(await arpeggio.isDisabled());
  if (scenario.arpeggioOffered) {
    await arpeggio.click();
    await page.waitForTimeout(650);
    scenario.arpeggioWrote = (await activeSongBytes(page)) !== lengthened;
  }

  /* 22-24: undo names what happened, and moves the stored song both ways. */
  const after = await activeSongBytes(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  const undo = page.getByRole("button", { name: /Geri al/ }).first();
  scenario.undoName = await undo.getAttribute("aria-label");
  await undo.click();
  await page.waitForTimeout(700);
  scenario.undoRestored = (await activeSongBytes(page)) === lengthened;
  const redo = page.getByRole("button", { name: /Yinele|leri al/ }).first();
  await redo.click();
  await page.waitForTimeout(700);
  scenario.redoReapplied = (await activeSongBytes(page)) === after;

  scenario.pageErrors = errors;
  report.push({ viewport: viewport.name, ...scenario });
  await context.close();
}

await browser.close();

const failures = [];
for (const run of report) {
  const check = (name, ok) => {
    if (!ok) failures.push(`${run.viewport}: ${name}`);
  };
  check("tail draws notes", run.tailNotes > 0);
  check("tail draws rests", run.tailRests > 0);
  check("tail draws beams", run.tailBeams > 0);
  check("tail draws a tuplet bracket", run.tailTuplets > 0);
  check("tail names a dotted value", run.dottedRead > 0);
  check("tail covers no fret digit", run.digitOverlaps === 0);
  check("tail takes no pointer events", run.tailPointerTargets === 0);
  check("page does not scroll sideways", run.pageOverflowX === false);
  check("duration grip is present", run.handlePresent);
  check("duration grip is 44px tall", run.handleTall >= 44);
  check("step buttons are 44px", run.plusTouch >= 44);
  check("preview band is drawn on the staff", run.previewBand);
  check("dragging writes nothing", run.previewWroteNothing);
  check("a round-trip drag writes nothing", run.roundTripWroteNothing);
  check("releasing writes the length", run.lengthenWrote);
  check("the chord door starts shut", run.doorStartsShut);
  check("the shape preview writes nothing", run.shapePreviewWroteNothing);
  check("undo names the edit", /Geri al: /.test(run.undoName ?? ""));
  check("undo restores the stored song", run.undoRestored);
  check("redo puts it back", run.redoReapplied);
  check("no page errors", run.pageErrors.length === 0);
}

const out = { base: BASE, ranAt: new Date().toISOString(), report, failures };
writeFileSync(
  new URL("./artifacts/ACCEPTANCE.json", import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(JSON.stringify(out, null, 1));
console.log(failures.length === 0 ? "\nPASS" : `\nFAIL (${failures.length})`);
process.exitCode = failures.length === 0 ? 0 : 1;
