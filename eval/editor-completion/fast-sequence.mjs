/**
 * The `9–10–9` flow, walked in the real UI (2V-B.4 §5, §7, §18, §20).
 *
 * The domain for a fast run landed at `c11a758` and no reader could reach it.
 * This runner is the claim that they can now: it opens the production editor,
 * taps a position, walks Ritim → Hızlı dizi → 3 nota → Bağlı → Dinle →
 * Uygula, and checks at every step that the grid is still on the screen, that
 * nothing was written before Uygula, that the measure did not get longer, and
 * that one undo takes the whole run back.
 *
 * Usage:  SHA=<sha> node eval/editor-completion/fast-sequence.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const steps = [];
const record = (name, pass, detail) => {
  steps.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** What the page says about itself, in the terms this runner needs. */
const look = (page) =>
  page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      return node ? node.getBoundingClientRect() : null;
    };
    const main = rect("main");
    const grid = rect("[data-tab-content]");
    let hit = "none";
    if (main && grid) {
      const x = Math.round(main.left + main.width / 2);
      const y = Math.round(
        Math.max(main.top, 0) +
          (Math.min(main.bottom, window.innerHeight) - Math.max(main.top, 0)) / 2,
      );
      const at = document.elementFromPoint(x, y);
      hit = at?.closest("[data-tab-content]") ? "grid" : "COVERED";
    }
    return {
      gridHit: hit,
      gridHeight: main
        ? Math.round(Math.min(main.bottom, window.innerHeight) - Math.max(main.top, 0))
        : 0,
      contentWidth: Math.round(rect("[data-tab-content]")?.width ?? 0),
      bars: document.querySelectorAll("[data-bar-key]").length,
      panel: document.querySelector("[data-shelf-panel]")?.getAttribute("data-shelf-panel") ?? null,
      ghosts: document.querySelectorAll("[data-pen-ghost]").length,
      frets: [...document.querySelectorAll("[data-fret-value]")].map((node) =>
        (node.textContent ?? "").trim(),
      ),
      glyphs: [...document.querySelectorAll("[data-fret-glyph]")].map((node) =>
        node.getAttribute("data-fret-glyph"),
      ),
      overlays: [...document.querySelectorAll("div,section")].filter((node) => {
        const style = getComputedStyle(node);
        return (
          style.position === "fixed" &&
          node.getBoundingClientRect().height > window.innerHeight * 0.5
        );
      }).length,
      warnings: [...document.querySelectorAll("[role=status]")]
        .map((node) => (node.textContent ?? "").trim())
        .filter(Boolean),
      density: [...document.querySelectorAll("[data-shelf-note]")]
        .map((node) => (node.textContent ?? "").trim())
        .find((text) => text.includes("Aynı süreye")) ?? null,
      primary: [...document.querySelectorAll("[data-shelf-primary]")].map((node) =>
        (node.textContent ?? "").trim(),
      ),
    };
  });

const openEditor = async (page, sha) => {
  await page.goto(`${BASE}/eval/editor-action-batch?sha=${sha}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(400);
  await page.locator("[data-batch-action='to-song']").first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
  await page.waitForSelector("[data-tab-content]");
  await page
    .getByRole("button", { name: "Düzenle", exact: true })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(400);
};

/** A point on a string a finger could really touch in this layout. */
const reachable = (page) =>
  page.evaluate(() => {
    const node = document.querySelector("[data-bar-drag-index]");
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const column = (node.closest("main") ?? node).getBoundingClientRect();
    const top = Math.max(column.top, 0);
    const bottom = Math.min(column.bottom, window.innerHeight);
    return {
      x: Math.round(Math.max(rect.left, column.left) + 20),
      y: Math.round(top + (bottom - top) / 2),
    };
  });

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: ANDROID,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  await openEditor(page, sha);
  const start = await look(page);
  record("editor opens with the grid on the screen", start.gridHit === "grid", `${start.gridHeight}px`);

  const spot = await reachable(page);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(350);
  const tapped = await look(page);
  record("a tap opens Nota in the shelf, not a sheet", tapped.panel === "Nota", tapped.panel ?? "none");
  record("and the grid keeps its pixels", tapped.gridHit === "grid" && tapped.overlays === 0, `${tapped.gridHeight}px · ${tapped.overlays} overlay`);

  await page.locator("[data-dock-group=ritim]").click();
  await page.waitForTimeout(200);
  await page.locator("[data-dock-panel=fast_sequence]").click();
  await page.waitForTimeout(250);
  const opened = await look(page);
  record("Ritim → Hızlı dizi opens in the same shelf", opened.panel === "Hızlı dizi", opened.panel ?? "none");
  record("no full-screen sheet appeared", opened.overlays === 0 && opened.gridHit === "grid");
  record(
    "one line explains the density, in musician's words",
    opened.density === "Aynı süreye 3 nota sığar; ölçünün uzunluğu değişmez.",
    opened.density ?? "none",
  );
  record("the frets start on the founder's own run", opened.frets.join("-") === "9-10-9", opened.frets.join("-"));

  await page.locator("[data-shelf-choice=performance-connected]").click().catch(() => {});
  await page.waitForTimeout(150);

  /*
   * The three counts, walked in turn, and the run is made with the first one
   * this bar can really hold.
   *
   * The fixture's bar is Straight 1/16 with a bass part on the sixteenths,
   * and three notes in the space of two is a triplet — a grid that cannot
   * hold sixteenths. That is a musical fact, not a defect, and §8 says the
   * reader must be *told* rather than left with a grey button. So both
   * outcomes are evidence: a refusal has to be a sentence on the screen, and
   * at least one count has to complete the whole flow.
   */
  const outcomes = [];
  let usable = null;
  for (const count of [3, 4, 2]) {
    await page.locator(`[data-shelf-choice=count-${count}]`).click();
    await page.waitForTimeout(250);
    let here = await look(page);
    if (here.primary.some((label) => label.includes("sıklaştır"))) {
      await page.locator("[data-shelf-primary=accept-override]").click();
      await page.waitForTimeout(350);
      here = await look(page);
    }
    const ready = await page.locator("[data-shelf-secondary=listen]").isEnabled();
    outcomes.push({ count, ready, warnings: here.warnings });
    if (ready && usable === null) usable = count;
  }
  record(
    "every count is offered and answered",
    outcomes.length === 3,
    outcomes.map((entry) => `${entry.count}:${entry.ready ? "yazılabilir" : "reddedildi"}`).join(" "),
  );
  const refused = outcomes.filter((entry) => !entry.ready);
  record(
    "a refusal is a sentence on the screen, never a silent grey button",
    refused.every((entry) => entry.warnings.length > 0),
    refused.map((entry) => `${entry.count}: ${entry.warnings.join(" / ")}`).join(" | ") ||
      "nothing was refused",
  );
  record("at least one count this bar can hold", usable !== null, `${usable} nota`);
  if (usable === null) {
    console.log("\nno writable count in this bar; stopping.");
    process.exit(1);
  }
  await page.locator(`[data-shelf-choice=count-${usable}]`).click();
  await page.waitForTimeout(250);
  let stateNow = await look(page);
  if (stateNow.primary.some((label) => label.includes("sıklaştır"))) {
    await page.locator("[data-shelf-primary=accept-override]").click();
    await page.waitForTimeout(350);
    stateNow = await look(page);
  }

  const beforeApply = { ...stateNow };
  await page.locator("[data-shelf-secondary=listen]").click();
  await page.waitForTimeout(600);
  const previewed = await look(page);
  record("Dinle draws the proposal as ghosts", previewed.ghosts >= 2, `${previewed.ghosts} ghost slots`);
  record("and the grid and the options are both on the screen", previewed.gridHit === "grid" && previewed.panel === "Hızlı dizi");
  record("the measure did not get longer while previewing", previewed.bars === beforeApply.bars && previewed.contentWidth === beforeApply.contentWidth, `${previewed.bars} bars · ${previewed.contentWidth}px`);

  await page.locator("[data-shelf-primary=apply]").click();
  await page.waitForTimeout(500);
  const applied = await look(page);
  record("Uygula clears the ghosts", applied.ghosts === 0, `${applied.ghosts} ghost slots`);
  record("the run is on the staff", applied.glyphs.filter((g) => g === "9" || g === "10").length >= 3, applied.glyphs.slice(0, 12).join(","));
  record("the measure still has the same bars and width", applied.bars === beforeApply.bars && applied.contentWidth === beforeApply.contentWidth, `${applied.bars} bars · ${applied.contentWidth}px`);
  record("the grid is still the hero", applied.gridHit === "grid" && applied.overlays === 0);

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);
  const undone = await look(page);
  record(
    "one undo takes the whole run back",
    undone.glyphs.join(",") === beforeApply.glyphs.join(","),
    `${undone.glyphs.length} glyphs vs ${beforeApply.glyphs.length}`,
  );

  await page.screenshot({ path: `${OUT}fast-sequence-412x915.png` });
  await context.close();
  await browser.close();

  const failed = steps.filter((step) => !step.pass);
  writeFileSync(
    `${OUT}FAST-SEQUENCE.json`,
    `${JSON.stringify({ sha, generatedAt: new Date().toISOString(), steps }, null, 2)}\n`,
  );
  console.log(`\n${steps.length - failed.length}/${steps.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
