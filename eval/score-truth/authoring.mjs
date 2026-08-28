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
 * Write one note: open its cell, pick its length, type its fret, and add any
 * articulation. Exactly the sequence a person performs.
 */
async function note(page, { bar = 1, slot, string, fret, ticks, articulation, letRing }) {
  await openCell(page, bar, slot, string);
  if (ticks !== undefined) await chooseRhythm(page, ticks);
  await writeFret(page, fret);
  if (articulation !== undefined) await chooseArticulation(page, articulation);
  if (letRing === true) await toggleLetRing(page);
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
