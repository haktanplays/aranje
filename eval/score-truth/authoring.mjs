/**
 * 2T-C §3. Writing a reference passage with nothing but the production UI.
 *
 * ## What this is measuring, and why the rules are strict
 *
 * A fixture living in the test suite proves the *model* can hold a figure. It
 * says nothing about whether a person can write one, which is the only
 * question that matters to somebody who opens the app. So this harness starts
 * from an empty project and touches only what a finger could touch: the view
 * switch, the edit toggle, staff cells, the sheet's own fields and buttons.
 *
 * Forbidden, and absent by construction: internal commands, the debug handle,
 * writing to storage, and any shortcut that loads a fixture. The only thing
 * seeded is an *empty* song — the starting point, not the answer.
 *
 * The comparison is a musical fingerprint rather than bytes: the two songs
 * have different titles and ids and always will, and none of that is music.
 *
 *   rm -rf .next && npm run build && npx next start -p 3110
 *   node eval/score-truth/authoring.mjs
 */
import { writeFileSync } from "node:fs";

import { chromium } from "playwright";

import { activeSongBytes, deviceWith } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3110";

/** An empty, valid one-bar song. The starting point, never the answer. */
function emptySong(resolution = 16, slotCount = 16, bpm = 132) {
  return {
    version: 3,
    title: "Boş",
    bpm,
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
        bars: Array.from({ length: 2 }, () => ({
          timeSignature: [4, 4],
          resolution,
          slots: { gtr: Array.from({ length: slotCount }, () => null) },
        })),
      },
    ],
  };
}

/* ------------------------------------------------------------- UI gestures */

/**
 * Open one staff cell.
 *
 * Found by the accessible name the app gives it — "Bar 1, slot 3, tel 2" —
 * rather than by arithmetic on a bounding box. That is the same string a
 * screen-reader user hears, so this is the production control, and a layout
 * change cannot quietly turn the harness into a test of empty space.
 */
async function openCell(page, barNumber, slotIndex, stringIndex) {
  const cell = page.locator(
    `[aria-label^="Bar ${barNumber}, slot ${slotIndex + 1}, tel ${stringIndex + 1}"]`,
  );
  await cell.first().scrollIntoViewIfNeeded();
  await cell.first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(120);
}

async function closeSheet(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

/** Choose a rhythm value by the ticks its chip carries. */
async function chooseRhythm(page, ticks) {
  const chip = page.locator(`[data-rhythm-choice="${ticks}"]`);
  if ((await chip.count()) === 0) throw new Error(`no rhythm chip for ${ticks}`);
  if (await chip.isDisabled()) throw new Error(`rhythm ${ticks} does not fit here`);
  await chip.click();
  await page.waitForTimeout(80);
}

/** Type a fret and press the write button. */
async function writeFret(page, fret) {
  const field = page.locator('[role="dialog"] input').first();
  await field.fill(String(fret));
  await page.waitForTimeout(60);
  const write = page.getByRole("button", { name: /^(Ekle|Güncelle)$/ }).last();
  await write.click();
  await page.waitForTimeout(220);
}

async function chooseArticulation(page, label) {
  await page.getByRole("button", { name: label, exact: true }).last().click();
  await page.waitForTimeout(200);
}

async function toggleLetRing(page) {
  await page.locator("[data-let-ring]").click();
  await page.waitForTimeout(200);
}

/**
 * Lengthen a note with the sheet's own step button.
 *
 * Some lengths are not note values at all — a string that rings from the
 * second sixteenth to the bar line is 720 ticks, which no chip offers and no
 * notation names. The reader reaches those the way the sheet offers them: one
 * grid step at a time, watching the number.
 */
async function stepLonger(page, steps) {
  const longer = page.locator('[data-testid="duration-longer"]');
  await longer.scrollIntoViewIfNeeded();
  for (let index = 0; index < steps; index += 1) {
    if (await longer.isDisabled()) throw new Error("cannot lengthen any further");
    /*
     * Ten taps a second. Before 2T-C §11 fixed the button, half of these
     * were dropped and the passage came out at half its written length; the
     * pace is left this fast on purpose, so a return of that fault fails
     * here rather than in somebody's hands.
     */
    await longer.click();
    await page.waitForTimeout(100);
  }
}

/**
 * Change one bar's rhythm grid through "Ölçü ve ritim".
 *
 * The grid is a reader's choice, not a property of the empty project, so a
 * passage written in thirty-seconds has to start by asking for them. Bars are
 * selected outside edit mode — that is where a bar is a button — so this
 * leaves edit mode, chooses, applies, and goes back in.
 */
async function setBarGrid(page, barNumber, resolution) {
  /* Bars are chosen in Düzen, and a whole bar is a press and hold — which is
     what the bar's own label tells the reader to do. The view switch is not
     offered while a staff is being edited, so this leaves edit mode first,
     exactly as a reader would. */
  await page.getByRole("button", { name: "Bitti", exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="view-arrange"]').click();
  await page.waitForSelector("[data-arrangement-scroller]");
  await page.waitForTimeout(250);

  const bar = page.locator(`[aria-label^="${barNumber}. ölçü"]`).first();
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForSelector("[data-bar-action-bar]", { timeout: 5000 });

  await page.getByRole("button", { name: "Daha fazla", exact: true }).first().click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="bar-more-timing"]').click();
  await page.waitForTimeout(250);
  await page
    .locator('[data-testid="timing-grid"]')
    .selectOption(String(resolution));
  await page.waitForTimeout(150);
  await page.locator('[data-testid="timing-apply"]').click();
  await page.waitForTimeout(500);
  await page.locator("[aria-label='Ölçü seçimini iptal et']").first().click();
  await page.waitForTimeout(250);

  /* Back to the tab, and back into edit mode, where notes are written. */
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-bar-key]");
  await page.getByRole("button", { name: "Düzenle", exact: true }).first().click();
  await page.waitForTimeout(350);
}

/**
 * Write one note: open its cell, pick its length, type its fret, and add any
 * articulation. Exactly the sequence a person performs.
 */
async function note(
  page,
  { bar = 1, slot, string, fret, ticks, articulation, letRing, longerBy },
) {
  await openCell(page, bar, slot, string);
  if (ticks !== undefined) await chooseRhythm(page, ticks);
  await writeFret(page, fret);
  if (articulation !== undefined) await chooseArticulation(page, articulation);
  if (letRing === true) await toggleLetRing(page);
  if (longerBy !== undefined) await stepLonger(page, longerBy);
  await closeSheet(page);
}

/* ---------------------------------------------------------------- fixtures */

/**
 * Fixture A — syncopated palm-muted double stops.
 *
 * Two open strings struck together, real rests between the figures, the
 * accent off the beat, two separate palm-mute spans, and a hammer-on.
 */
async function writeFixtureA(page) {
  /* Eighths and sixteenths side by side; the third figure lands off the beat. */
  const stops = [
    { slot: 0, ticks: 96 },
    { slot: 2, ticks: 48 },
    { slot: 5, ticks: 48 },
    { slot: 8, ticks: 96 },
    { slot: 11, ticks: 48 },
  ];
  for (const stop of stops) {
    for (const string of [0, 1]) {
      await note(page, { ...stop, string, fret: 0, articulation: "Palm mute" });
    }
  }
  /* The palm mute stops for the two legato notes and comes back after them. */
  await note(page, { bar: 2, slot: 0, string: 2, fret: 5, ticks: 48 });
  await note(page, {
    bar: 2,
    slot: 2,
    string: 2,
    fret: 7,
    ticks: 48,
    articulation: "Hammer-on",
  });
  for (const string of [0, 1]) {
    await note(page, {
      bar: 2,
      slot: 8,
      string,
      fret: 0,
      ticks: 96,
      articulation: "Palm mute",
    });
  }
}

/**
 * Fixture B — pedal string under fast legato.
 *
 * The bar starts on the ordinary sixteenth grid and the reader asks for
 * thirty-seconds, because that is a choice somebody makes rather than a
 * property of an empty project. Then an open low E left ringing under a
 * 9-10-9 cell, a sixteenth beside those thirty-seconds, a string change and
 * a vibrato to finish.
 */
async function writeFixtureB(page) {
  await setBarGrid(page, 1, 32);

  /* Struck once and left to ring through everything that follows. */
  await note(page, { slot: 0, string: 0, fret: 0, ticks: 768, letRing: true });

  /* The legato cell, in thirty-seconds, on the third string. */
  await note(page, { slot: 8, string: 2, fret: 9, ticks: 24 });
  await note(page, { slot: 9, string: 2, fret: 10, ticks: 24, articulation: "Hammer-on" });
  await note(page, { slot: 10, string: 2, fret: 9, ticks: 24, articulation: "Pull-off" });

  /* A sixteenth in the same beat as those thirty-seconds. */
  await note(page, { slot: 12, string: 2, fret: 7, ticks: 48 });

  /* String change, and the phrase ends on a vibrato. */
  await note(page, {
    slot: 20,
    string: 3,
    fret: 9,
    ticks: 288,
    articulation: "Vibrato",
  });
}

/**
 * Fixture C — six-string ringing arpeggio with a partial re-attack.
 *
 * Every string is left ringing and every one has its own length, so most of
 * these lengths are not note values at all: a string struck on the second
 * sixteenth and ringing to the bar line is 720 ticks, which no chip offers.
 * The reader reaches them with the sheet's step button, one grid step at a
 * time — which is exactly why that button exists.
 */
async function writeFixtureC(page) {
  const voicing = [
    { string: 0, fret: 0 },
    { string: 1, fret: 2 },
    { string: 2, fret: 2 },
    { string: 3, fret: 0 },
    { string: 4, fret: 0 },
    { string: 5, fret: 0 },
  ];
  const RESTRIKE_SLOT = 10;

  for (const [index, voice] of voicing.entries()) {
    const endSlot = voice.string === 4 || voice.string === 5 ? RESTRIKE_SLOT : 16;
    /* One sixteenth is already written by the chip; the rest are steps. */
    await note(page, {
      slot: index,
      string: voice.string,
      fret: voice.fret,
      ticks: 48,
      letRing: true,
      longerBy: endSlot - index - 1,
    });
  }

  /* Two of the six taken again while the other four keep sounding. */
  for (const string of [4, 5]) {
    await note(page, {
      slot: RESTRIKE_SLOT,
      string,
      fret: 0,
      ticks: 48,
      letRing: true,
      longerBy: 16 - RESTRIKE_SLOT - 1,
    });
  }
}

/* -------------------------------------------------------------- the runner */

const FIXTURES = [
  {
    name: "A",
    seed: () => emptySong(16, 16, 132),
    write: writeFixtureA,
    /* Which parts of §3's list this passage exercises. */
    covers: [
      "iki telli tekrarlar",
      "16'lık ritim",
      "açık esler",
      "senkop",
      "kesintili palm-mute",
      "kısa HO hareketi",
    ],
  },
  {
    name: "B",
    seed: () => emptySong(16, 16, 96),
    write: writeFixtureB,
    covers: [
      "pedal tel (çınlat)",
      "1/32 ızgara",
      "hammer-on + pull-off hücresi",
      "aynı vuruşta 1/16 ve 1/32",
      "tel değişimi",
      "vibrato",
    ],
  },
  {
    name: "C",
    seed: () => emptySong(16, 16, 84),
    write: writeFixtureC,
    covers: [
      "altı telli arpej",
      "her tel kendi süresi",
      "çınlat",
      "kısmi yeniden vuruş",
      "üst üste binen sesler",
    ],
  },
];

const browser = await chromium.launch();
const results = [];

for (const fixture of FIXTURES) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  /*
   * Seeded once, not on every navigation. An init script runs again on
   * reload, and re-seeding there would wipe what the reader just wrote and
   * then report the app had failed to persist it — a harness measuring
   * itself.
   */
  await context.addInitScript((seed) => {
    if (localStorage.getItem("aranje.projects") !== null) return;
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
  }, deviceWith(fixture.seed()));

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-bar-key]");
  await page.getByRole("button", { name: "Düzenle", exact: true }).first().click();
  await page.waitForTimeout(300);

  const started = await activeSongBytes(page);
  let wrote = null;
  let failure = null;
  try {
    await fixture.write(page);
    wrote = await activeSongBytes(page);
  } catch (error) {
    failure = String(error).slice(0, 300);
  }

  /* Reload: what a reader would find when they come back tomorrow. */
  let reloaded = null;
  if (failure === null) {
    /* Storage is written on a debounce; reloading inside it would be
       measuring the harness's impatience rather than the app's persistence. */
    await page.waitForTimeout(1500);
    wrote = await activeSongBytes(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("[data-arrangement-scroller]");
    await page.waitForTimeout(400);
    reloaded = await activeSongBytes(page);
  }

  results.push({
    fixture: fixture.name,
    covers: fixture.covers,
    failure,
    startedEmpty: started !== null && !started.includes('"notes"'),
    changed: wrote !== null && wrote !== started,
    survivedReload: reloaded !== null && reloaded === wrote,
    song: wrote === null ? null : JSON.parse(wrote),
    reloadDiff:
      reloaded === null || reloaded === wrote
        ? null
        : { wroteLength: wrote?.length ?? 0, reloadedLength: reloaded.length },
    pageErrors: errors,
  });
  await context.close();
}

await browser.close();

const out = { base: BASE, ranAt: new Date().toISOString(), results };
writeFileSync(
  new URL("./artifacts/AUTHORED.json", import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`,
);

for (const run of results) {
  console.log(
    `Fixture ${run.fixture}:`,
    run.failure
      ? `FAILED — ${run.failure}`
      : `startedEmpty=${run.startedEmpty} changed=${run.changed} ` +
        `reload=${run.survivedReload} errors=${run.pageErrors.length}`,
  );
}
console.log(
  "\nSongs written to artifacts/AUTHORED.json. The fingerprint comparison " +
    "against the canonical repertoire is `authored-parity.test.ts`, so both " +
    "sides come from one implementation.",
);
process.exitCode = results.every(
  (run) =>
    run.failure === null &&
    run.changed &&
    run.survivedReload &&
    run.pageErrors.length === 0,
)
  ? 0
  : 1;
