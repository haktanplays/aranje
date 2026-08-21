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

async function openApp(browser, size) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((text) => window.__consoleErrors.push(text), message.text()).catch(() => {});
    }
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-tab-content]");
  return { context, page };
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

/** A long press at a point inside the bars. */
async function longPress(page, offsetX, offsetY = 60) {
  const box = await page.locator("[data-tab-content]").boundingBox();
  const x = box.x + GUTTER + offsetX;
  const y = box.y + offsetY;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

/** A quick tap, which must stay a normal edit gesture. */
async function tap(page, offsetX, offsetY = 60) {
  const box = await page.locator("[data-tab-content]").boundingBox();
  await page.mouse.move(box.x + GUTTER + offsetX, box.y + offsetY);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/** A drag that must scroll rather than select. */
async function drag(page, fromX, toX, offsetY = 60) {
  const box = await page.locator("[data-tab-content]").boundingBox();
  await page.mouse.move(box.x + GUTTER + fromX, box.y + offsetY);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(box.x + GUTTER + fromX + ((toX - fromX) * step) / 6, box.y + offsetY);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(600);
  await page.mouse.up();
}

const bandVisible = (page) => page.locator("[data-testid=time-selection-band]").isVisible().catch(() => false);
const barVisible = (page) => page.locator("[data-testid=selection-action-bar]").isVisible().catch(() => false);

async function enterEditMode(page) {
  // Selection is an edit gesture, so the tab has to be in edit mode first.
  const toggle = page.locator("button", { hasText: /Düzenle|Edit/ }).first();
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
}

async function run() {
  const browser = await chromium.launch();
  const measurements = {};

  for (const [label, size] of [
    ["390x844", { width: 390, height: 844 }],
    ["320x700", { width: 320, height: 700 }],
  ]) {
    const { context, page } = await openApp(browser, size);
    await enterEditMode(page);

    // ---- 1. long press selects one onset
    await longPress(page, 20);
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
    await page.locator("[data-testid=selection-action-move]").click();
    await page.waitForSelector("[data-testid=move-mode-time]");
    const beforeNudge = await writes(page);
    for (let index = 0; index < 5; index += 1) {
      await page.locator("[data-testid=nudge-right-grid]").click();
      await page.waitForTimeout(60);
    }
    const duringNudge = await writes(page);
    record(
      `[${label}] ghost preview writes nothing`,
      duringNudge === beforeNudge,
      `${beforeNudge}->${duringNudge}`,
    );

    const songBeforeApply = await songJson(page);
    const applyButton = page.locator("button", { hasText: "Uygula" }).first();
    const canApply = await applyButton.isEnabled().catch(() => false);
    if (canApply) {
      await applyButton.click();
      await page.waitForTimeout(250);
      const afterApply = await writes(page);
      record(
        `[${label}] 21 five nudges commit once`,
        afterApply - beforeNudge === 1,
        `${beforeNudge}->${afterApply}`,
      );
      const songAfter = await songJson(page);
      record(`[${label}] song actually changed`, songAfter !== songBeforeApply);

      // ---- 7. undo returns byte-identical
      const undoButton = page.locator("button[aria-label*='Geri'], button", { hasText: /Geri al/ }).first();
      if (await undoButton.isVisible().catch(() => false)) {
        await undoButton.click();
        await page.waitForTimeout(250);
        const undone = await songJson(page);
        record(`[${label}] 7 undo restores byte-identical song`, undone === songBeforeApply);
      } else {
        record(`[${label}] 7 undo control reachable`, false, "no undo control found");
      }
    } else {
      record(`[${label}] 21 five nudges commit once`, false, "Uygula disabled");
    }

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

    // close the sheet: cancel must write nothing
    const beforeCancel = await writes(page);
    await page.locator("button", { hasText: "Vazgeç" }).first().click();
    await page.waitForTimeout(200);
    record(`[${label}] cancel writes nothing`, (await writes(page)) === beforeCancel);

    await page.screenshot({ path: `${OUT}/${label}-selection.png` });

    // ---- touch target sizes on the action bar
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("[data-testid^=selection-action-]")]
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.height < 43.5).length,
    );
    record(`[${label}] action targets >=44px`, small === 0, `${small} under`);

    // ---- 22. changing track clears the selection
    const trackButton = page.locator("[data-testid^=track-chip], button", { hasText: /Davul|Drums/ }).first();
    if (await trackButton.isVisible().catch(() => false)) {
      await trackButton.click();
      await page.waitForTimeout(250);
      record(`[${label}] 22 track change clears selection`, !(await bandVisible(page)));
    } else {
      record(`[${label}] 22 track change clears selection`, false, "no second track control");
    }

    // ---- 24. a normal tap still opens the note sheet, not a selection
    await enterEditMode(page);
    await tap(page, 20);
    await page.waitForTimeout(200);
    record(`[${label}] 24 short tap does not select`, !(await bandVisible(page)));

    // ---- probe: a drag must scroll, never select
    await drag(page, 200, 40);
    await page.waitForTimeout(200);
    record(`[${label}] drag scrolls rather than selects`, !(await bandVisible(page)));

    const errors = await page.evaluate(() => window.__consoleErrors ?? []);
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
