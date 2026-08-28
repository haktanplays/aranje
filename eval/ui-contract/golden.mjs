/**
 * The geometry UI Contract v1 freezes (2U-A §1).
 *
 * ## What this measures, and why it is not a screenshot diff
 *
 * A screenshot diff answers "did any pixel move", which is the wrong
 * question: an antialiasing change on one machine fails it, and a control
 * moved forty pixels down inside an unchanged bounding box passes it. What
 * the contract actually protects is the *arithmetic a finger depends on* —
 * where the six strings are, where the digits sit, how tall the working area
 * is, whether anything overflows, and who owns a press. Those are numbers,
 * so they are measured as numbers and compared as numbers.
 *
 * Eight states because a layout is not one layout. The staff that fits at
 * rest is the staff that clipped three strings the moment a selection bar
 * appeared under it (K-59 §18), and a contract that only froze the resting
 * screen would have frozen the one screen that was never in trouble.
 *
 *   PORT=3104 ./eval/chord-audio/serve.sh
 *   node eval/ui-contract/golden.mjs                 # compare against GOLDEN
 *   WRITE_GOLDEN=1 node eval/ui-contract/golden.mjs  # record the baseline
 *
 * Recording is deliberately a separate switch. A harness that rewrote its own
 * expectation on every run would be a harness that agrees with whatever the
 * code currently does, which is the opposite of a contract.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { deviceWith } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3104";
const OUT = fileURLToPath(new URL("./", import.meta.url));
const GOLDEN_PATH = `${OUT}GOLDEN.json`;
const WRITE = process.env.WRITE_GOLDEN === "1";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700, touch: true },
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "412x915", width: 412, height: 915, touch: true, userAgent: ANDROID_UA },
  { name: "1363x936", width: 1363, height: 936, touch: false },
];

/**
 * A song with something in every state's way: a chord to select, a note with
 * its own length to grab, a technique to open, and two bars so a measure can
 * be told from a section.
 */
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
  bar1[8] = { notes: [{ pitch: "B3", position: { string: 4, fret: 0 }, durationTicks: 48 }] };
  bar1[12] = { notes: [{ pitch: "E4", position: { string: 5, fret: 0 }, durationTicks: 192 }] };

  const bar2 = Array.from({ length: 16 }, () => null);
  bar2[0] = { notes: [{ pitch: "G3", position: { string: 3, fret: 0 }, durationTicks: 96 }] };
  bar2[4] = { notes: [{ pitch: "A3", position: { string: 3, fret: 2 }, durationTicks: 96 }] };

  return {
    version: 4,
    title: "UI Contract",
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
          { timeSignature: [4, 4], resolution: 16, slots: { gtr: bar2 } },
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------- measurement */

/**
 * Everything the contract holds still, read out of the live document.
 *
 * Runs inside the page because that is where layout is; nothing here decides
 * whether a number is acceptable, only what the number is.
 */
const MEASURE = () => {
  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      x: Math.round(rect.x * 10) / 10,
      y: Math.round(rect.y * 10) / 10,
      w: Math.round(rect.width * 10) / 10,
      h: Math.round(rect.height * 10) / 10,
    };
  };

  const staff = document.querySelector("[data-bar-key]");
  const strings = [...document.querySelectorAll("[data-string-line]")]
    .slice(0, 6)
    .map((node) => Math.round(node.getBoundingClientRect().y * 10) / 10);

  /* Digit centres, in document order, so a shifted glyph is a changed list. */
  const digits = [...document.querySelectorAll("[data-fret-glyph]")]
    .slice(0, 12)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        text: node.getAttribute("data-fret-glyph"),
        cx: Math.round((rect.x + rect.width / 2) * 10) / 10,
        cy: Math.round((rect.y + rect.height / 2) * 10) / 10,
      };
    });

  /*
   * A staff cell is not a chrome control.
   *
   * Its width is the musical slot width — 34px, the same constant the tab is
   * drawn on — and making it 44 would make the bar 30% wider and fit a third
   * less music on a phone. What K-59 §18 actually fixed, and what this
   * contract holds, is its *row height*: six strings a finger can hit
   * without the staff needing a scroller. So the cells are measured on that
   * rule, below, and kept out of the control census here.
   */
  const isStaffCell = (node) =>
    (node.getAttribute("aria-label") ?? "").startsWith("Bar ");

  const onScreen = (node) => {
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
    );
  };

  const cells = [...document.querySelectorAll("button, [role='button']")].filter(
    (node) => isStaffCell(node) && onScreen(node),
  );
  const shortCells = cells
    .map((node) => Math.round(node.getBoundingClientRect().height))
    .filter((height) => height < 44).length;

  /* Anything a finger is meant to hit, and whether it is big enough. */
  const controls = [...document.querySelectorAll("button, [role='button'], select")]
    .filter((node) => onScreen(node) && !isStaffCell(node))
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label:
          (node.getAttribute("aria-label") ?? node.textContent ?? "")
            .trim()
            .slice(0, 40) || "(adsız)",
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        /* A label wider than the box it is drawn in is a clipped label. */
        clipped: node.scrollWidth > Math.ceil(rect.width) + 1,
      };
    });

  /* Which element actually receives a press at the centre of each surface. */
  const ownerAt = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.x + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.y + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    /* Named by the nearest thing that says what it is, never by class. */
    const named = hit.closest(
      "[data-duration-handle],[data-testid='duration-handle'],[data-fret-glyph]," +
        "[data-selection-toolbar],[data-bar-action-bar],[data-composer-doors]," +
        "[data-bar-key],[data-arrangement-scroller],[role='dialog']",
    );
    if (!named) return hit.tagName.toLowerCase();
    for (const attribute of named.getAttributeNames()) {
      if (attribute.startsWith("data-") || attribute === "role") return attribute;
    }
    return named.tagName.toLowerCase();
  };

  /* A scroller inside the staff means the reader has to scroll to see a
     string, which is the thing K-59 §18 was about. */
  const staffScrollers = [...document.querySelectorAll("[data-bar-key]")].filter(
    (node) => {
      let element = node;
      while (element && element !== document.body) {
        const style = getComputedStyle(element);
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 1
        ) {
          return true;
        }
        element = element.parentElement;
      }
      return false;
    },
  ).length;

  return {
    staff: box(staff),
    strings,
    digits,
    main: box(document.querySelector("main")),
    toolbar:
      box(document.querySelector("[data-selection-toolbar]")) ??
      box(document.querySelector("[data-composer-doors]")),
    transport: box(document.querySelector("[data-transport]")),
    barActionBar: box(document.querySelector("[data-bar-action-bar]")),
    dialog: box(document.querySelector("[role='dialog']")),
    bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth,
    staffScrollers,
    /** Staff cells drawn shorter than a finger. The K-59 §18 rule. */
    shortCells,
    cellCount: cells.length,
    smallControls: controls.filter(
      (control) => control.w < 44 || control.h < 44,
    ),
    clippedLabels: controls.filter((control) => control.clipped),
    controlCount: controls.length,
    owners: {
      staff: ownerAt("[data-bar-key]"),
      durationHandle: ownerAt("[data-testid='duration-handle']"),
      toolbar: ownerAt("[data-selection-toolbar]"),
    },
  };
};

/* ------------------------------------------------------------- the states */

/** Open the tab view, which is where every state below begins. */
async function toTab(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-bar-key]");
  await page.waitForTimeout(250);
}

async function enterEdit(page) {
  await page.getByRole("button", { name: "Düzenle", exact: true }).first().click();
  await page.waitForTimeout(400);
}

/** The cell a state needs, by the accessible name the app gives it. */
const cell = (page, bar, slot, string) =>
  page.locator(`[aria-label^="Bar ${bar}, slot ${slot}, tel ${string}"]`).first();

/** Press and hold, which is how a run is covered. */
async function longPress(page, locator, ms = 700) {
  await locator.scrollIntoViewIfNeeded();
  const target = await locator.boundingBox();
  if (!target) throw new Error("nothing to hold");
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

const STATES = [
  {
    name: "1-read",
    async reach(page) {
      await toTab(page);
    },
  },
  {
    name: "2-focused-edit",
    async reach(page) {
      await toTab(page);
      await enterEdit(page);
    },
  },
  {
    name: "3-note-selection",
    async reach(page) {
      await toTab(page);
      await enterEdit(page);
      await cell(page, 1, 5, 4).click();
      await page.waitForTimeout(350);
    },
  },
  {
    name: "4-range-selection",
    async reach(page) {
      await toTab(page);
      await enterEdit(page);
      await longPress(page, cell(page, 1, 1, 1));
    },
  },
  {
    name: "5-more-sheet",
    async reach(page) {
      await toTab(page);
      await enterEdit(page);
      await longPress(page, cell(page, 1, 1, 1));
      const more = page.locator("[data-selection-more]");
      if ((await more.count()) > 0) {
        await more.click();
        await page.waitForTimeout(300);
      }
    },
  },
  {
    name: "6-duration-edit",
    async reach(page) {
      await toTab(page);
      await enterEdit(page);
      await cell(page, 1, 5, 4).click();
      await page.waitForTimeout(350);
      const handle = page.locator('[data-testid="duration-handle"]');
      if ((await handle.count()) > 0) await handle.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
    },
  },
  {
    name: "7-technique-sheet",
    async reach(page) {
      await toTab(page);
      await enterEdit(page);
      await cell(page, 1, 5, 4).click();
      await page.waitForTimeout(350);
      const ghost = page.locator('[data-articulation="ghost"]');
      if ((await ghost.count()) > 0) await ghost.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
    },
  },
  {
    name: "8-arpeggio-preview",
    async reach(page) {
      await toTab(page);
      await enterEdit(page);
      await cell(page, 1, 1, 1).click();
      await page.waitForTimeout(350);
      const door = page.locator("[data-shape-open]");
      if ((await door.count()) > 0) {
        await door.scrollIntoViewIfNeeded();
        await door.click();
        await page.waitForTimeout(300);
      }
    },
  },
];

/* ----------------------------------------------------------------- the run */

const browser = await chromium.launch();
const measured = {};
const errors = [];

for (const viewport of VIEWPORTS) {
  measured[viewport.name] = {};
  for (const state of STATES) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      ...(viewport.userAgent
        ? { userAgent: viewport.userAgent, isMobile: true }
        : {}),
    });
    await context.addInitScript((seed) => {
      for (const [key, value] of Object.entries(seed)) {
        localStorage.setItem(key, value);
      }
    }, deviceWith(seedSong()));

    const page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push(`${viewport.name}/${state.name}: ${String(error).slice(0, 160)}`),
    );

    try {
      await state.reach(page);
      measured[viewport.name][state.name] = await page.evaluate(MEASURE);
    } catch (error) {
      errors.push(
        `${viewport.name}/${state.name}: unreachable — ${String(error).slice(0, 160)}`,
      );
      measured[viewport.name][state.name] = null;
    }
    await context.close();
  }
  process.stdout.write(`  ${viewport.name} measured\n`);
}

await browser.close();

/* ------------------------------------------------------------ the verdict */

const failures = [];

/*
 * The invariants that hold whatever the numbers are. These are not a
 * comparison against the baseline — they are what any state of this app must
 * satisfy, and a baseline recorded while one of them was broken would freeze
 * the breakage.
 */
for (const [viewport, states] of Object.entries(measured)) {
  for (const [state, found] of Object.entries(states)) {
    const where = `${viewport}/${state}`;
    if (!found) {
      failures.push(`${where}: state could not be reached`);
      continue;
    }
    if (found.bodyOverflowX) failures.push(`${where}: body scrolls sideways`);
    if (found.staffScrollers > 0) {
      failures.push(`${where}: ${found.staffScrollers} scroller inside the staff`);
    }
    if (found.strings.length !== 6) {
      failures.push(`${where}: ${found.strings.length} strings drawn, not 6`);
    }
    if (found.shortCells > 0) {
      failures.push(`${where}: ${found.shortCells} staff cell under 44px tall`);
    }
    for (const control of found.smallControls) {
      failures.push(
        `${where}: "${control.label}" is ${control.w}x${control.h}, under 44`,
      );
    }
    for (const control of found.clippedLabels) {
      failures.push(`${where}: "${control.label}" is clipped`);
    }
  }
}

const golden = existsSync(GOLDEN_PATH)
  ? JSON.parse(readFileSync(GOLDEN_PATH, "utf8"))
  : null;

/** What the contract froze, compared field by field with what is there now. */
const drift = [];
if (golden && !WRITE) {
  for (const [viewport, states] of Object.entries(golden.measured)) {
    for (const [state, want] of Object.entries(states)) {
      const found = measured[viewport]?.[state];
      const where = `${viewport}/${state}`;
      if (!want || !found) continue;

      const compare = (name, a, b) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          drift.push(`${where}: ${name}\n    dondurulan: ${JSON.stringify(a)}\n    şimdi:      ${JSON.stringify(b)}`);
        }
      };
      compare("staff bounds", want.staff, found.staff);
      compare("string y", want.strings, found.strings);
      compare("fret digit centres", want.digits, found.digits);
      compare("main height", want.main?.h, found.main?.h);
      compare("toolbar bounds", want.toolbar, found.toolbar);
      compare("transport bounds", want.transport, found.transport);
    }
  }
}

mkdirSync(OUT, { recursive: true });
const payload = {
  what: "2U-A §1 — UI Contract v1'in dondurduğu geometri",
  recordedAt: new Date().toISOString(),
  commit: process.env.MEASURE_COMMIT ?? null,
  viewports: VIEWPORTS.map((entry) => entry.name),
  states: STATES.map((entry) => entry.name),
  measured,
};

if (WRITE) {
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nbaseline yazıldı: ${GOLDEN_PATH}`);
} else {
  writeFileSync(`${OUT}CURRENT.json`, `${JSON.stringify(payload, null, 2)}\n`);
}

for (const line of failures) console.log(`FAIL  ${line}`);
for (const line of drift) console.log(`DRIFT ${line}`);
for (const line of errors) console.log(`ERROR ${line}`);

const total = failures.length + drift.length + errors.length;
console.log(
  total === 0
    ? `\nPASS — ${VIEWPORTS.length} viewport × ${STATES.length} durum, sapma yok`
    : `\nFAIL (${failures.length} ihlal, ${drift.length} sapma, ${errors.length} hata)`,
);
process.exitCode = total === 0 ? 0 : 1;
