/**
 * The 2V-B live FAIL, on the build the founder was given (§1, §12).
 *
 * The founder opened `/eval/selection-playback?sha=4d4deb3` on a real Android
 * phone, made a selection, and pressed the "Daha fazla" the product draws.
 * Behind it: "Seçimi sil", and nothing else. The guide's step 2 asks for
 * "Seçimi dinle", so the whole listening round stops there.
 *
 * This run reproduces that on the same route, with a real pointer selection
 * and the real visible door. Nothing is mounted directly, no state is
 * injected, and no test-only control is used: the only way in is the way the
 * founder came.
 *
 * It is written to be RED on `4d4deb3`. A green first run would mean the
 * measurement missed the surface again, which is the whole reason this file
 * exists — the previous round's 70/70 was taken with "Düzenle" pressed, and
 * so it measured the compact edit toolbar's drawer instead of the sheet the
 * founder actually opened.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3114";
const SHA = process.env.SHA ?? "4d4deb3";
const ROUTE = `${BASE}/eval/selection-playback?sha=${SHA}`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
/*
 * The red run's artefact is evidence and must not be overwritten by the green
 * one that follows it. `OUT_NAME=AFTER` writes the confirmation beside it.
 */
const NAME = process.env.OUT_NAME ?? "BASELINE";
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/** The y of a string line that is really inside the staff at this x. */
async function stringY(page, atX) {
  return page.evaluate((x) => {
    const lines = [...document.querySelectorAll("[data-string-line]")]
      .map((node) => {
        const box = node.getBoundingClientRect();
        return box.top + box.height / 2;
      })
      .sort((a, b) => a - b);
    for (const y of lines) {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest("[data-tab-content]")) return y;
    }
    return null;
  }, atX);
}

/** What the opened sheet actually offers, by accessible name. */
const sheetLabels = (page) =>
  page.evaluate(() => {
    const sheet = document.querySelector("[role=dialog]");
    if (!sheet) return null;
    return [...sheet.querySelectorAll("button")]
      .map((node) => (node.getAttribute("aria-label") ?? node.textContent ?? "").trim())
      .filter((text) => text.length > 0);
  });

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 384, height: 740 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: ANDROID,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  await page.goto(ROUTE, { waitUntil: "networkidle" });

  /* Step 1 of the founder's own guide: go to the Tab. */
  await page.locator("[data-testid=view-tab]").first().click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(250);

  /* A real note-range selection: hold the first onset and drag right. */
  const first = await page.locator("[data-bar-drag-index='0']").first().boundingBox();
  const x0 = first.x + 17;
  const y = await stringY(page, x0);
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.move(x0 + 34 * 4, y, { steps: 8 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(360);

  const summary = await page
    .locator("[data-testid=selection-summary]")
    .first()
    .textContent()
    .catch(() => null);
  record("a real pointer selection exists", Boolean(summary), summary ?? "none");

  /* The visible production door, pressed by name. */
  const more = page.getByRole("button", { name: "Daha fazla", exact: true });
  const doors = await more.count();
  record("the production «Daha fazla» is visible", doors > 0, `count=${doors}`);
  if (doors > 0) {
    await more.first().click();
    await page.waitForTimeout(320);
  }

  const labels = await sheetLabels(page);
  await page.screenshot({ path: `${OUT}/${NAME.toLowerCase()}-more-sheet.png` });

  const has = (name) => (labels ?? []).filter((text) => text.startsWith(name)).length;
  const once = has("Seçimi dinle");
  const loop = has("Seçimden döngü");

  record(
    "listen_once rendered count === 1 in the sheet the founder opened",
    once === 1,
    `rendered=${once} · sheet=${JSON.stringify(labels)}`,
  );
  record(
    "listen_loop rendered count === 1 in the sheet the founder opened",
    loop === 1,
    `rendered=${loop} · sheet=${JSON.stringify(labels)}`,
  );

  const failed = results.filter((entry) => !entry.pass).length;
  writeFileSync(
    `${OUT}/${NAME}.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        route: "/eval/selection-playback",
        sha: SHA,
        viewport: "384x740 + Android Chrome UA",
        method:
          "real pointer long-press drag on the production staff, then the visible «Daha fazla»",
        sheet: labels,
        results,
        failed,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n${results.length - failed}/${results.length} · failed=${failed}`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
};

main();
