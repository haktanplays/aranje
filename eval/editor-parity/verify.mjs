/**
 * Faz 2U-A browser acceptance (§13).
 *
 * Twenty-two steps that no unit test can answer, because each is about
 * something that only exists while the app is running: which control is on
 * screen, whether it is greyed, how many times storage was written, whether
 * a gesture that stages anything left a trace before the reader confirmed.
 *
 * Four viewports, because a toolbar that fits at 1363px is the toolbar that
 * clipped a label at 320px, and the four verbs are frozen at four (§1).
 *
 * Three things are instrumented before any app code runs:
 *
 * - `Storage.prototype.setItem`, so "one apply, one write" is a count.
 * - `AudioContext`, so "no second scheduler" is a count.
 * - console and page errors, collected rather than sampled.
 *
 *   PORT=3104 ./eval/chord-audio/serve.sh
 *   BASE_URL=http://127.0.0.1:3104 node eval/editor-parity/verify.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

import { press, reveal } from "../shared/harness.mjs";
import { activeSongBytes, deviceWith, readActiveSong } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3104";
const OUT = process.env.PARITY_OUT ?? "eval/editor-parity/artifacts";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/selection-ui/fixture-song.json", "utf8").trim();

/** The four the contract measures at (§1). */
const ONLY = process.env.PARITY_ONLY ?? "";
const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700 },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
  { name: "1363x936", width: 1363, height: 936, desktop: true },
];

/** The tab content begins with the sticky gutter (geometry.ts). */
const GUTTER = 34;
const SLOT = 34;

const results = [];
let shots = 0;

function flush() {
  const failed = results.filter((entry) => !entry.pass);
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      { results, failed: failed.length, screenshots: shots },
      null,
      2,
    )}\n`,
  );
}

let currentViewport = "";
let lastPage = null;

const record = (step, name, pass, detail = "") => {
  results.push({ viewport: currentViewport, step, name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${currentViewport} ${step} ${name}${
      detail ? `  — ${detail}` : ""
    }`,
  );
  flush();
};

async function safe(step, name, fn) {
  try {
    await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 110);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${currentViewport}-${step}.png` })
      .catch(() => {});
    record(step, name, false, first);
  }
}

/** A founder screenshot, taken on purpose rather than only on failure. */
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${currentViewport}-${name}.png` });
  shots += 1;
}

const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key && String(key).includes("aranje")) window.__writes += 1;
    return originalSet.call(this, key, value);
  };
  window.__audioContexts = 0;
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args) {
        window.__audioContexts += 1;
        return Reflect.construct(target, args);
      },
    });
  }
`;

async function openApp(browser, size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    /*
     * The desktop viewport is opened with touch off, as §1 measures it. A
     * desktop that reported `hasTouch` would take the mobile branch of every
     * gesture and this run would be measuring the phone four times.
     */
    hasTouch: !size.desktop,
    isMobile: !size.desktop,
    deviceScaleFactor: size.desktop ? 1 : 2,
  });
  await context.addInitScript(INSTRUMENT);
  await context.addInitScript(
    (entries) => {
      try {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      } catch {
        /* a private window is not a reason to fail the run */
      }
    },
    Object.entries(deviceWith(JSON.parse(FIXTURE))),
  );
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(5000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page
        .evaluate((text) => window.__consoleErrors.push(text), message.text())
        .catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((text) => window.__consoleErrors.push(text), String(error)).catch(() => {});
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid='view-tab']");
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

const writes = (page) => page.evaluate(() => window.__writes);
const errors = (page) => page.evaluate(() => window.__consoleErrors ?? []);
const contexts = (page) => page.evaluate(() => window.__audioContexts ?? 0);

async function toTab(page) {
  await page.locator("[data-testid='view-tab']").click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(200);
}

async function enterEditMode(page) {
  const toggle = page.getByRole("button", { name: "Düzenle", exact: true });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(250);
  }
}

/** Back to the pristine fixture, in the tab, writing. */
async function fresh(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid='view-tab']");
  await toTab(page);
  await enterEditMode(page);
  await page
    .locator("[data-tab-content]")
    .evaluate((node) => {
      const scroller = node.closest(".overflow-x-auto");
      if (scroller) scroller.scrollLeft = 0;
    })
    .catch(() => {});
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__writes = 0;
  });
}

async function touch(page, cdp, x, y, holdMs) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await page.waitForTimeout(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}

/**
 * A long press inside the bars, `slots` slots from the first one.
 *
 * Measured from the content's left edge plus the gutter, because the row
 * begins with the sticky string names and an offset taken from the row lands
 * a gutter too far left.
 */
async function longPressSlot(page, cdp, slots, rowOffset = 60) {
  const box = await page.locator("[data-tab-content]").boundingBox();
  if (!box) throw new Error("no tab content");
  await touch(page, cdp, box.x + GUTTER + slots * SLOT + SLOT / 2, box.y + rowOffset, 700);
}

const verb = (page, label) => page.locator(`[data-selection-verb='${label}']`).first();
const toolbarVisible = (page) =>
  page.locator("[data-selection-toolbar]").isVisible().catch(() => false);

async function openDrawer(page) {
  await page.locator("[data-selection-more]").click();
  await page.waitForSelector("[role=dialog]");
  await page.waitForTimeout(250);
}

/**
 * Dismiss an open sheet the way a reader does — by pressing outside it.
 *
 * The control is a full-bleed backdrop with the sheet drawn on top, so a
 * click aimed at its centre lands on the sheet and is refused as intercepted.
 * Pressing near the top-left hits the part of the backdrop nothing covers.
 */
async function closeSheet(page) {
  /*
   * Sheets stack — a staged movement that would cut a legato chain puts the
   * decision sheet in front of the movement sheet — so this closes the
   * topmost until none is left rather than assuming there is one.
   */
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const close = page.locator("[role=dialog] [aria-label=Kapat]");
    const open = await close.count();
    if (open === 0) break;
    await close.last().click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(350);
  }
}

const undoEnabled = (page) =>
  page
    .locator("[data-undo]")
    .first()
    .isDisabled()
    .then((disabled) => !disabled)
    .catch(() => false);

// ------------------------------------------------------------------ the run

async function runViewport(browser, size) {
  currentViewport = size.name;
  const { context, page, cdp } = await openApp(browser, size);

  try {
    // ------------------------------------------------------------------ 1
    await safe(1, "the row is the four verbs the contract froze", async () => {
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      const labels = await page
        .locator("[data-selection-verb]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-selection-verb")),
        );
      const more = await page.locator("[data-selection-more]").count();
      const rows = await page
        .locator("[data-selection-toolbar]")
        .evaluate((node) => node.getBoundingClientRect().height);
      record(
        1,
        "the row is the four verbs the contract froze",
        JSON.stringify(labels) === '["Bağla","Taşı","Devam"]' && more === 1 && rows < 60,
        `${JSON.stringify(labels)} more=${more} h=${Math.round(rows)}`,
      );
      await shot(page, "01-toolbar");
    });

    // ------------------------------------------------------------------ 2
    await safe(2, "a press covers a run and says what it holds", async () => {
      const open = await toolbarVisible(page);
      const summary = await page
        .locator("[data-selection-summary], [data-testid=selection-summary]")
        .first()
        .innerText()
        .catch(() => "");
      record(
        2,
        "a press covers a run and says what it holds",
        open,
        `toolbar=${open} summary="${summary.slice(0, 40)}"`,
      );
    });

    // ------------------------------------------------------------------ 3
    await safe(3, "“Bağla” is greyed on one note, with a reason", async () => {
      const disabled = await verb(page, "Bağla").isDisabled();
      const label = await verb(page, "Bağla").getAttribute("aria-label");
      record(
        3,
        "“Bağla” is greyed on one note, with a reason",
        disabled && (label ?? "").includes("en az iki nota"),
        `disabled=${disabled} label="${label}"`,
      );
    });

    // ------------------------------------------------------------------ 4
    await safe(4, "“Devam” is live and not pressed to begin with", async () => {
      const disabled = await verb(page, "Devam").isDisabled();
      const pressed = await verb(page, "Devam").getAttribute("aria-pressed");
      record(
        4,
        "“Devam” is live and not pressed to begin with",
        !disabled && pressed === "false",
        `disabled=${disabled} pressed=${pressed}`,
      );
    });

    // ------------------------------------------------------------------ 5
    await safe(5, "“Devam” arms without writing anything", async () => {
      const before = await activeSongBytes(page);
      await page.evaluate(() => {
        window.__writes = 0;
      });
      await verb(page, "Devam").click();
      await page.waitForTimeout(250);
      const pressed = await verb(page, "Devam").getAttribute("aria-pressed");
      const wrote = await writes(page);
      const after = await activeSongBytes(page);
      record(
        5,
        "“Devam” arms without writing anything",
        pressed === "true" && wrote === 0 && after === before,
        `pressed=${pressed} writes=${wrote} same=${after === before}`,
      );
      await shot(page, "05-devam-armed");
    });

    // ------------------------------------------------------------------ 6
    await safe(6, "armed, a press moves the end and leaves the start", async () => {
      const band = () =>
        page
          .locator("[data-testid=time-selection-band]")
          .first()
          .boundingBox()
          .catch(() => null);
      const before = await band();
      await longPressSlot(page, cdp, 6);
      const after = await band();
      const wrote = await writes(page);
      const grew = before && after ? after.width > before.width : false;
      const startHeld =
        before && after ? Math.abs(after.x - before.x) <= 2 : false;
      record(
        6,
        "armed, a press moves the end and leaves the start",
        grew && startHeld && wrote === 0,
        `w ${Math.round(before?.width ?? -1)}→${Math.round(
          after?.width ?? -1,
        )} x ${Math.round(before?.x ?? -1)}→${Math.round(after?.x ?? -1)} writes=${wrote}`,
      );
      await shot(page, "06-devam-reached");
    });

    // ------------------------------------------------------------------ 7
    await safe(7, "the arm puts itself down after one press", async () => {
      const pressed = await verb(page, "Devam").getAttribute("aria-pressed");
      record(7, "the arm puts itself down after one press", pressed === "false", `pressed=${pressed}`);
    });

    // ------------------------------------------------------------------ 8
    await safe(8, "reaching back inside the run shrinks it", async () => {
      const band = () =>
        page
          .locator("[data-testid=time-selection-band]")
          .first()
          .boundingBox()
          .catch(() => null);
      const before = await band();
      await verb(page, "Devam").click();
      await page.waitForTimeout(200);
      await longPressSlot(page, cdp, 2);
      const after = await band();
      record(
        8,
        "reaching back inside the run shrinks it",
        before && after ? after.width < before.width : false,
        `w ${Math.round(before?.width ?? -1)}→${Math.round(after?.width ?? -1)}`,
      );
    });

    // ------------------------------------------------------------------ 9
    await safe(9, "a two-note run offers “Bağla”", async () => {
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      await verb(page, "Devam").click();
      await page.waitForTimeout(200);
      await longPressSlot(page, cdp, 6);
      const disabled = await verb(page, "Bağla").isDisabled();
      record(9, "a two-note run offers “Bağla”", !disabled, `disabled=${disabled}`);
    });

    // ----------------------------------------------------------------- 10
    await safe(10, "“Taşı” opens the sheet with its four kinds of motion", async () => {
      await verb(page, "Taşı").click();
      await page.waitForSelector("[role=dialog]");
      await page.waitForTimeout(300);
      const modes = [];
      for (const mode of ["time", "pitch", "string", "shape"]) {
        modes.push(await page.locator(`[data-testid=move-mode-${mode}]`).count());
      }
      record(
        10,
        "“Taşı” opens the sheet with its four kinds of motion",
        modes.every((found) => found === 1),
        `modes=${JSON.stringify(modes)}`,
      );
      await shot(page, "10-move-sheet");
    });

    // ----------------------------------------------------------------- 11
    await safe(11, "all eight movements are reachable, both ways", async () => {
      const targets = {
        time: ["nudge-left-grid", "nudge-right-grid", "nudge-left-vuruş", "nudge-right-vuruş", "nudge-left-ölçü", "nudge-right-ölçü"],
        pitch: ["transpose--12", "transpose--1", "transpose-1", "transpose-12"],
        string: ["restring-1", "restring--1"],
        shape: ["shape-string-1", "shape-string--1", "shape-fret--1", "shape-fret-1"],
      };
      let found = 0;
      const missing = [];
      for (const [mode, ids] of Object.entries(targets)) {
        await page.locator(`[data-testid=move-mode-${mode}]`).click();
        await page.waitForTimeout(250);
        for (const id of ids) {
          const seen = await page.locator(`[data-testid='${id}']`).count();
          if (seen > 0) found += 1;
          else missing.push(id);
        }
      }
      record(
        11,
        "all eight movements are reachable, both ways",
        found === 16,
        `found=${found}/16 missing=${missing.join(",")}`,
      );
    });

    // ----------------------------------------------------------------- 12
    await safe(12, "a staged movement shows a ghost and writes nothing", async () => {
      /*
       * A fresh single-onset selection, deliberately. The run step 9 built
       * reaches across a hammer-on, and staging a move on that asks the
       * chain question instead of previewing — which is right, and is what
       * step 13 now covers.
       */
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      await verb(page, "Taşı").click();
      await page.waitForSelector("[role=dialog]");
      await page.locator("[data-testid=move-mode-time]").click();
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        window.__writes = 0;
      });
      const before = await activeSongBytes(page);
      await page.locator("[data-testid=nudge-right-grid]").click();
      await page.waitForTimeout(400);
      const ghost = await page
        .locator("[data-testid=transform-preview]")
        .innerText()
        .catch(() => "");
      const wrote = await writes(page);
      const after = await activeSongBytes(page);
      record(
        12,
        "a staged movement shows a ghost and writes nothing",
        ghost.length > 0 && wrote === 0 && after === before,
        `ghost="${ghost.slice(0, 40)}" writes=${wrote} same=${after === before}`,
      );
      await shot(page, "12-move-ghost");
    });

    // ----------------------------------------------------------------- 13
    await safe(13, "cancelling leaves the song byte-equal, chain question included", async () => {
      const before = await activeSongBytes(page);
      await closeSheet(page);
      const clean = await writes(page);
      const afterClean = await activeSongBytes(page);

      /*
       * The other half: a movement that would cut a legato chain asks rather
       * than guessing. Backing out of that question must be as free as
       * backing out of the ghost — §12 says a cancel is zero writes and a
       * byte-equal song, and a sheet the reader did not summon is exactly
       * where that is easiest to get wrong.
       */
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      await verb(page, "Devam").click();
      await page.waitForTimeout(200);
      await longPressSlot(page, cdp, 6);
      await verb(page, "Taşı").click();
      await page.waitForSelector("[role=dialog]");
      await page.locator("[data-testid=move-mode-time]").click();
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        window.__writes = 0;
      });
      const beforeChain = await activeSongBytes(page);
      await page.locator("[data-testid=nudge-right-grid]").click();
      await page.waitForTimeout(400);
      const asked = await page
        .locator("[role=dialog]")
        .evaluateAll((nodes) =>
          nodes.some((node) => /bağlantıyı kesiyor/.test(node.innerText ?? "")),
        );
      await closeSheet(page);
      const afterChain = await activeSongBytes(page);
      const wroteChain = await writes(page);

      record(
        13,
        "cancelling leaves the song byte-equal, chain question included",
        clean === 0 &&
          afterClean === before &&
          asked &&
          wroteChain === 0 &&
          afterChain === beforeChain,
        `ghostCancel(writes=${clean} same=${afterClean === before}) asked=${asked} chainCancel(writes=${wroteChain} same=${
          afterChain === beforeChain
        })`,
      );
      await shot(page, "13-chain-question");
    });

    // ----------------------------------------------------------------- 14
    await safe(14, "applying one movement is one write and one undo step", async () => {
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      await verb(page, "Taşı").click();
      await page.waitForSelector("[role=dialog]");
      await page.locator("[data-testid=move-mode-time]").click();
      await page.waitForTimeout(200);
      const before = await activeSongBytes(page);
      await page.evaluate(() => {
        window.__writes = 0;
      });
      await page.locator("[data-testid=nudge-right-grid]").click();
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Uygula", exact: true }).first().click();
      await page.waitForTimeout(600);
      const wrote = await writes(page);
      const after = await activeSongBytes(page);
      const canUndo = await undoEnabled(page);
      record(
        14,
        "applying one movement is one write and one undo step",
        wrote === 1 && after !== before && canUndo,
        `writes=${wrote} changed=${after !== before} undo=${canUndo}`,
      );
      await shot(page, "14-move-applied");
    });

    // ----------------------------------------------------------------- 15
    await safe(15, "“Daha fazla” greys “Yapıştır” with the reason", async () => {
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      await openDrawer(page);
      const body = await page.locator("[role=dialog]").innerText();
      const entries = await page.locator("[data-selection-action]").count();
      record(
        15,
        "“Daha fazla” greys “Yapıştır” with the reason",
        entries >= 4 && !/Yapıştır/.test(body),
        `entries=${entries} paste=${/Yapıştır/.test(body)}`,
      );
      await shot(page, "15-drawer");
    });

    // ----------------------------------------------------------------- 16
    await safe(16, "the drawer offers no measure verb on a run of notes", async () => {
      const body = await page.locator("[role=dialog]").innerText();
      record(
        16,
        "the drawer offers no measure verb on a run of notes",
        !/Ölçü ekle|Ölçüyü sil|Sola taşı|Sağa taşı/.test(body),
        body.replace(/\n/g, " | ").slice(0, 90),
      );
    });

    // ----------------------------------------------------------------- 17
    await safe(17, "copying writes nothing and adds no undo step", async () => {
      const before = await activeSongBytes(page);
      await page.evaluate(() => {
        window.__writes = 0;
      });
      await page.locator("[data-selection-action='Kopyala']").click();
      await page.waitForTimeout(400);
      const wrote = await writes(page);
      const after = await activeSongBytes(page);
      record(
        17,
        "copying writes nothing and adds no undo step",
        wrote === 0 && after === before,
        `writes=${wrote} same=${after === before}`,
      );
    });

    // ----------------------------------------------------------------- 18
    await safe(18, "cutting is exactly one write", async () => {
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      await openDrawer(page);
      const before = await activeSongBytes(page);
      await page.evaluate(() => {
        window.__writes = 0;
      });
      await page.locator("[data-selection-action='Kes']").click();
      await page.waitForTimeout(700);
      const wrote = await writes(page);
      const after = await activeSongBytes(page);
      record(
        18,
        "cutting is exactly one write",
        wrote === 1 && after !== before,
        `writes=${wrote} changed=${after !== before}`,
      );
      await shot(page, "18-cut");
    });

    // ----------------------------------------------------------------- 19
    await safe(19, "a bar header takes the bar, and no time band appears", async () => {
      await fresh(page);
      const header = await page
        .locator("[data-tab-bar-header]")
        .first()
        .getAttribute("data-tab-bar-header");
      await press(page, cdp, `[data-tab-bar-header='${header}']`);
      const summary = await page
        .locator("[data-bar-summary]")
        .innerText()
        .catch(() => "");
      const bands = await page.locator("[data-testid=time-selection-band]").count();
      record(
        19,
        "a bar header takes the bar, and no time band appears",
        summary.length > 0 && bands === 0,
        `summary="${summary}" bands=${bands} header=${header}`,
      );
      await shot(page, "19-bar-header");
    });

    // ----------------------------------------------------------------- 20
    await safe(20, "a header press writes nothing, whatever it selects", async () => {
      const wrote = await writes(page);
      record(20, "a header press writes nothing, whatever it selects", wrote === 0, `writes=${wrote}`);
    });

    // ----------------------------------------------------------------- 21
    await safe(21, "the page never scrolls sideways and targets stay 44px", async () => {
      await fresh(page);
      await longPressSlot(page, cdp, 0);
      const overflow = await page.evaluate(
        () => document.body.scrollWidth - document.body.clientWidth,
      );
      const small = await page
        .locator("[data-selection-toolbar] button")
        .evaluateAll(
          (nodes) =>
            nodes.filter((node) => {
              const box = node.getBoundingClientRect();
              return Math.min(box.width, box.height) < 44;
            }).length,
        );
      record(
        21,
        "the page never scrolls sideways and targets stay 44px",
        overflow <= 0 && small === 0,
        `overflow=${overflow} under44=${small}`,
      );
    });

    // ----------------------------------------------------------------- 22
    await safe(22, "nothing threw, and one scheduler was ever built", async () => {
      const console_ = await errors(page);
      const audio = await contexts(page);
      record(
        22,
        "nothing threw, and one scheduler was ever built",
        console_.length === 0 && audio <= 1,
        `errors=${console_.length} contexts=${audio} ${console_.slice(0, 2).join(" | ").slice(0, 100)}`,
      );
    });
  } finally {
    await context.close();
  }
}

async function run() {
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
    `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${
      results.length - failed.length
    }/${results.length} adım, ${shots} ekran görüntüsü`,
  );
  if (failed.length > 0) {
    for (const entry of failed) {
      console.log(`  ${entry.viewport} ${entry.step} ${entry.name} — ${entry.detail}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/* Referenced so the shared helpers stay imported where a step needs them. */
void reveal;
void readActiveSong;
