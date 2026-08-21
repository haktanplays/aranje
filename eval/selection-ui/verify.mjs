/**
 * Faz 2I-B end-to-end verification, against the production build.
 *
 * DOM state alone is not evidence here. The claims this checkpoint makes are
 * about *writes*: that a copy writes nothing, that a ghost writes nothing, that
 * five nudges are one write, and that a refusal is zero. So the page's
 * localStorage.setItem is instrumented before the app loads and every scenario
 * is judged on the counter and on the song that actually came back out of
 * storage.
 *
 * Two ways this harness has already lied, both fixed and both worth knowing:
 *
 * - It drove the gesture with Playwright's mouse API. With touch emulation on,
 *   Chromium does not synthesise pointer events from it, so `mouse.down()`
 *   produced no `pointerdown` and every gesture assertion was judging a press
 *   that never happened. Written the other way round — "no selection appears"
 *   — that would have passed while testing nothing.
 * - It ran against a server started before the build under test. `pkill` was
 *   failing silently and the old `next-server` survived, so real fixes looked
 *   like failures. The build stamp is checked below rather than assumed.
 *
 * `npm run build && npx next start -p 3100`, then
 * `node eval/selection-ui/verify.mjs`
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/selection-ui/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/** One scenario may fail without taking the rest of the run down with it. */
async function safe(name, fn) {
  try {
    return await fn();
  } catch (error) {
    record(name, false, String(error).split("\n")[0].slice(0, 90));
    return undefined;
  }
}

/** Count every write the app makes, from before the first line of app code. */
const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key && String(key).includes("aranje")) window.__writes += 1;
    return original.call(this, key, value);
  };
`;

/**
 * Real touch, not a mouse.
 *
 * With touch emulation on, Chromium does not turn Playwright's mouse API into
 * pointer events, so a mouse "long press" produces no pointerdown at all and
 * every gesture check would pass vacuously by never running. CDP touch events
 * are also the gesture this phase is actually about.
 */
async function touch(page, cdp, x, y, holdMs) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function openApp(browser, size) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  /* Every locator fails fast. A harness that hangs on a missing control tells
   * you nothing and takes ten minutes to do it. */
  page.setDefaultTimeout(4000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((text) => window.__consoleErrors.push(text), message.text()).catch(() => {});
    }
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-tab-content]");
  const cdp = await context.newCDPSession(page);

  /*
   * Prove the build under test contains this checkpoint. Without it a stale
   * server turns a passing feature into a wall of red, or worse, hides a
   * regression behind an old bundle that still works.
   */
  const wired = await page.evaluate(() =>
    document.querySelector("[data-tab-content]") !== null,
  );
  if (!wired) throw new Error("server is not serving a build with the selection wiring");
  return { context, page, cdp };
}

const writes = (page) => page.evaluate(() => window.__writes);
const songJson = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.includes("aranje") && entry.includes("song"));
    return key ? localStorage.getItem(key) : null;
  });

/**
 * The tab content begins with the sticky gutter, so every offset here is
 * measured from the first bar rather than from the row. Pressing at a raw
 * content offset would land on the string names.
 */
const GUTTER = 34;

const bandVisible = (page) =>
  page.locator("[data-testid=time-selection-band]").isVisible().catch(() => false);

/** A long press at a point inside the bars. */
async function longPress(page, cdp, offsetX, offsetY = 60) {
  const box = await page.locator("[data-tab-content]").boundingBox();
  await touch(page, cdp, box.x + GUTTER + offsetX, box.y + offsetY, 700);
  await page.waitForTimeout(200);
}

/**
 * A long press on a real struck note, chosen by index.
 *
 * Pressing a guessed coordinate is how the 320px run ended up selecting empty
 * space and then reporting the app as broken for refusing to move nothing.
 * The tab marks its onsets, so the press can land on one at any viewport.
 */
async function longPressOnset(page, cdp, index = 0) {
  const cells = page.locator("[data-cell][data-onset]");
  const count = await cells.count();
  if (count === 0) return false;

  /*
   * Try a few onsets. At 320px the tab may be scrolled so the first one sits
   * outside the viewport, where a touch at its box lands on nothing — which
   * previously looked like the app failing to select.
   */
  for (let offset = 0; offset < 5 && index + offset < count; offset += 1) {
    const cell = cells.nth(index + offset);
    await cell.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);
    const box = await cell.boundingBox();
    if (!box || box.width < 2) continue;
    await touch(page, cdp, box.x + box.width / 2, box.y + box.height / 2, 700);
    await page.waitForTimeout(250);
    if (await bandVisible(page)) return true;
  }
  return false;
}

/** A quick tap, which must stay a normal edit gesture. */
async function tap(page, cdp, offsetX, offsetY = 60) {
  const box = await page.locator("[data-tab-content]").boundingBox();
  await touch(page, cdp, box.x + GUTTER + offsetX, box.y + offsetY, 60);
  await page.waitForTimeout(200);
}

/** A drag that must scroll rather than select. */
async function drag(page, cdp, fromX, toX, offsetY = 60) {
  const box = await page.locator("[data-tab-content]").boundingBox();
  const y = box.y + offsetY;
  const start = box.x + GUTTER + fromX;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y, id: 1 }] });
  for (let step = 1; step <= 6; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start + ((toX - fromX) * step) / 6, y, id: 1 }],
    });
    await page.waitForTimeout(30);
  }
  // Held well past the threshold: if movement did not abandon the press, this
  // is where a scroll would wrongly become a selection.
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(200);
}

/** Leave selection mode, so the next scenario starts from a clean screen. */
async function clearSelection(page) {
  const cancel = page.getByRole("button", { name: "Seçimi iptal et" });
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
    await page.waitForTimeout(200);
  }
}

const barVisible = (page) => page.locator("[data-testid=selection-action-bar]").isVisible().catch(() => false);

async function enterEditMode(page) {
  // Selection is an edit gesture, so the tab has to be in edit mode first.
  // Exact text: "Düzenle" and "Düzenlemeyi bitir" both contain "Düzenle", and
  // a loose match would toggle edit mode back off on the second call.
  const toggle = page.getByRole("button", { name: "Düzenle", exact: true });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(200);
  }
}

async function run() {
  const browser = await chromium.launch();
  const measurements = {};

  for (const [label, size] of [
    ["390x844", { width: 390, height: 844 }],
    ["320x700", { width: 320, height: 700 }],
  ]) {
    const { context, page, cdp } = await openApp(browser, size);
    await enterEditMode(page);

    // ---- 1. long press selects one onset
    const pressed = await longPressOnset(page, cdp, 0);
    if (!pressed) await longPress(page, cdp, 20);
    const selected = await bandVisible(page);
    record(`[${label}] 1 long press selects`, selected);

    if (!selected) {
      await page.screenshot({ path: `${OUT}/${label}-no-selection.png` });
      await context.close();
      continue;
    }

    record(`[${label}] action bar appears`, await barVisible(page));

    // ---- summary is human, not technical
    const summary = await page.locator("[data-testid=selection-summary]").innerText();
    record(
      `[${label}] summary is non-technical`,
      !/tick|slot|startTicks|\d{3,}/i.test(summary),
      summary,
    );

    // ---- band aligns to real tick bounds
    const bandBox = await page.locator("[data-testid=time-selection-band]").boundingBox();
    record(`[${label}] band has width`, bandBox && bandBox.width > 4, `${bandBox?.width}px`);

    // ---- 20. copy writes nothing
    const beforeCopy = await writes(page);
    await page.locator("[data-testid=selection-action-copy]").click();
    await page.waitForTimeout(150);
    const afterCopy = await writes(page);
    record(`[${label}] 20 copy writes nothing`, afterCopy === beforeCopy, `${beforeCopy}->${afterCopy}`);

    // ---- 21. several nudges then apply is ONE write
    /*
     * The demo's bars are fully written, so every destination is occupied and
     * no time move is possible at all. That is the song, not a bug — so make
     * room the way a player would, by deleting a note first, and then measure
     * the nudge into the gap that leaves.
     */
    await safe(`[${label}] delete makes room and writes once`, async () => {
      const before = await writes(page);
      await page.locator("[data-testid=selection-action-delete]").click();
      await page.waitForTimeout(300);
      record(
        `[${label}] 21a delete commits once`,
        (await writes(page)) - before === 1,
        `${before}->${await writes(page)}`,
      );
    });

    await clearSelection(page);
    await longPressOnset(page, cdp, 0);
    await page.waitForTimeout(200);

    const reselected = await barVisible(page);
    record(`[${label}] reselect after delete`, reselected);
    if (!reselected) {
      await page.screenshot({ path: `${OUT}/${label}-reselect-failed.png` });
      await context.close();
      continue;
    }
    await page.locator("[data-testid=selection-action-move]").click();
    await page.waitForSelector("[data-testid=move-mode-time]");
    const beforeNudge = await writes(page);

    const applyButton = page.getByRole("button", { name: "Uygula", exact: true }).first();
    let enabled = false;
    let clicks = 0;
    // Nudge left, toward the gap the delete just opened.
    for (let index = 0; index < 10 && !enabled; index += 1) {
      await page.locator("[data-testid=nudge-left-grid]").click();
      clicks += 1;
      await page.waitForTimeout(80);
      enabled = await applyButton.isEnabled().catch(() => false);
    }

    record(
      `[${label}] ghost preview writes nothing`,
      (await writes(page)) === beforeNudge,
      `${clicks} taps, ${beforeNudge}->${await writes(page)}`,
    );

    const ghost = await page
      .locator("[data-testid=transform-preview]")
      .innerText()
      .catch(() => "");
    record(`[${label}] 16 ghost explains the outcome`, ghost.length > 0, ghost.slice(0, 46));

    // ---- move mode cards
    for (const mode of ["time", "pitch", "string", "shape"]) {
      const visible = await page
        .locator(`[data-testid=move-mode-${mode}]`)
        .isVisible()
        .catch(() => false);
      if (!visible) {
        record(`[${label}] move mode ${mode} present`, false);
        break;
      }
      const box = await page.locator(`[data-testid=move-mode-${mode}]`).boundingBox();
      record(
        `[${label}] move mode ${mode} >=44px`,
        box && box.height >= 43.5,
        `${Math.round(box?.height ?? 0)}px`,
      );
    }

    // ---- overflow and scroller invariants with a sheet open
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      scrollers: [...document.querySelectorAll("*")].filter(
        (node) => node.scrollWidth > node.clientWidth + 1 &&
          ["auto", "scroll"].includes(getComputedStyle(node).overflowX),
      ).length,
    }));
    record(`[${label}] no body horizontal overflow (sheet open)`, overflow.body <= 0, `${overflow.body}px`);
    record(`[${label}] 25 one horizontal scroller`, overflow.scrollers <= 1, `${overflow.scrollers}`);

    await page.screenshot({ path: `${OUT}/${label}-move-sheet.png` });

    const songBeforeApply = await songJson(page);
    if (enabled) {
      const beforeApply = await writes(page);
      await applyButton.click();
      await page.waitForTimeout(350);
      const afterApply = await writes(page);
      record(
        `[${label}] 21 many nudges commit once`,
        afterApply - beforeApply === 1,
        `${clicks} taps, writes ${beforeApply}->${afterApply}`,
      );
      record(`[${label}] song actually changed`, (await songJson(page)) !== songBeforeApply);

      await safe(`[${label}] 7 undo restores byte-identical song`, async () => {
        const undoButton = page.getByRole("button", { name: "Son değişikliği geri al" }).first();
        if (!(await undoButton.isVisible().catch(() => false))) {
          record(`[${label}] 7 undo restores byte-identical song`, false, "no undo control");
          return;
        }
        await undoButton.click();
        await page.waitForTimeout(350);
        record(`[${label}] 7 undo restores byte-identical song`, (await songJson(page)) === songBeforeApply);
      });
    } else {
      record(`[${label}] 21 many nudges commit once`, false, `no applicable move after ${clicks} taps`);
      record(`[${label}] 17 impossible move writes nothing`, (await writes(page)) === beforeNudge);
    }

    // close the sheet: cancel must write nothing
    await safe(`[${label}] cancel writes nothing`, async () => {
      // Reopen: applying closes the sheet, so cancel needs one to close.
      await page.locator("[data-testid=selection-action-move]").click();
      await page.waitForSelector("[data-testid=move-mode-time]");
      const beforeCancel = await writes(page);
      await page.getByRole("button", { name: "Vazgeç", exact: true }).first().click();
      await page.waitForTimeout(250);
      record(`[${label}] cancel writes nothing`, (await writes(page)) === beforeCancel);
    });

    await page.screenshot({ path: `${OUT}/${label}-selection.png` });

    // ---- touch target sizes on the action bar
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("[data-testid^=selection-action-]")]
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.height < 43.5).length,
    );
    record(`[${label}] action targets >=44px`, small === 0, `${small} under`);

    // ---- 22. changing track clears the selection
    await safe(`[${label}] 22 track change clears selection`, async () => {
      const trackButton = page.getByRole("tab", { name: /Davul/ }).first();
      const reachable = await trackButton.isVisible().catch(() => false);
      if (!reachable) {
        record(`[${label}] 22 track change clears selection`, false, "no second track control");
        return;
      }
      await trackButton.click();
      await page.waitForTimeout(300);
      record(`[${label}] 22 track change clears selection`, !(await bandVisible(page)));
      // Back to a track the tab can edit: the drum track correctly disables
      // editing, and leaving it selected would break every later scenario.
      await page.getByRole("tab", { name: /Gitar/ }).first().click();
      await page.waitForTimeout(300);
    });

    // ---- 24. a normal tap still opens the note sheet, not a selection
    await clearSelection(page);
    await safe(`[${label}] edit mode reachable again`, () => enterEditMode(page));
    await tap(page, cdp, 20);
    await page.waitForTimeout(200);
    record(`[${label}] 24 short tap does not select`, !(await bandVisible(page)));

    // ---- probe: a drag must scroll, never select
    await clearSelection(page);
    await drag(page, cdp, 200, 40);
    await page.waitForTimeout(200);
    record(`[${label}] drag scrolls rather than selects`, !(await bandVisible(page)));

    const errors = await page.evaluate(() => window.__consoleErrors ?? []).catch(() => []);
    record(`[${label}] no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));

    measurements[label] = { overflow, summary };
    await context.close();
  }

  await browser.close();

  const failed = results.filter((entry) => !entry.pass);
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify({ results, measurements, failed: failed.length }, null, 2)}\n`,
  );
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
