/**
 * The editor's vertical budget, measured rather than remembered (2W §7, §17).
 *
 * The consolidation this batch ships is a claim about pixels, so the pixels
 * are read off the running app at five viewports: which rows exist, how tall
 * each is, how much of the column the grid gets, and whether anything is
 * drawn on top of it.
 *
 * Usage:  SHA=<sha> LABEL=before node eval/listening-pack/editor-geometry.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const LABEL = process.env.LABEL ?? "now";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "384x692", width: 384, height: 692 },
  { name: "412x915", width: 412, height: 915 },
  { name: "landscape-740x360", width: 740, height: 360 },
  /* A common phone in landscape, added in 2V-B.3 §8: 740x360 is the narrow
     end and this is what most readers who rotate actually have. */
  { name: "landscape-844x390", width: 844, height: 390 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
];

/** Rows the editor column is made of, by the attribute each one carries. */
const ROWS = [
  ["editHeader", "[data-edit-header]"],
  ["grid", "[data-tab-content]"],
  ["trackControls", "[data-track-strip]"],
  ["doorRow", "[data-composer-doors]"],
  ["actionRow", "[data-selection-toolbar]"],
  ["dock", "[data-editor-dock]"],
  ["zoomControls", "[data-view-zoom]"],
  /* The side inspector, which in portrait is simply the flow (§8). */
  ["shelf", ".workspace-shelf"],
  ["transport", "footer"],
  ["stage", "main"],
];

const measure = (page) =>
  page.evaluate((rows) => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      };
    };
    const out = {};
    for (const [name, selector] of rows) out[name] = box(selector);
    out.overflowX = document.documentElement.scrollWidth > window.innerWidth;
    out.innerHeight = window.innerHeight;

    /* Is anything drawn on top of the grid? Asked of the browser rather than
       of the stylesheet: `elementFromPoint` at the grid's own centre. */
    const grid = document.querySelector("[data-tab-content]");
    if (grid) {
      const rect = grid.getBoundingClientRect();
      /*
       * A point inside the part of the grid that is actually on screen. The
       * element's own centre can sit below the fold on a short phone, and
       * `elementFromPoint` outside the viewport returns null — which would
       * read as "covered" when nothing is covering anything.
       */
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, window.innerHeight);
      const x = Math.round(Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1));
      const y = Math.round((top + bottom) / 2);
      out.gridVisibleHeight = Math.round(Math.max(0, bottom - top));
      const hit = document.elementFromPoint(x, y);
      out.gridHitOwner =
        hit === null ? "none" : hit.closest("[data-tab-content]") ? "grid" : "COVERED";
      if (out.gridHitOwner === "COVERED") {
        /* Name the thing precisely: its own attributes, then its ancestors,
           so the report can say what is on top rather than "a div". */
        const trail = [];
        let node = hit;
        for (let step = 0; node && step < 6; step += 1) {
          const attrs = [...node.attributes]
            .filter((a) => a.name.startsWith("data-") || a.name === "class")
            .map((a) => `${a.name}=${a.value.slice(0, 60)}`);
          trail.push(`${node.tagName}[${attrs.join(" ")}]`);
          node = node.parentElement;
        }
        out.gridCoveredBy = trail.join(" < ");
      } else {
        out.gridCoveredBy = "";
      }
    }
    return out;
  }, rows());

function rows() {
  return ROWS;
}

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }
  const browser = await chromium.launch();
  const results = {};

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.width < 900,
      deviceScaleFactor: 2,
      userAgent: ANDROID,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${BASE}/eval/editor-action-batch?sha=${sha}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(500);
    await page.locator("[data-batch-action='to-song']").first().click().catch(() => {});
    await page.waitForTimeout(300);
    await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
    await page.waitForSelector("[data-tab-content]").catch(() => {});
    await page.waitForTimeout(400);

    /* Reading mode has no local tools at all; the rows this batch is about
       only exist once the reader is editing. */
    await page.getByRole("button", { name: "Düzenle", exact: true }).first()
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    const idle = await measure(page);

    /* And with a selection open, which is when the action row exists. */
    const spot = await page.evaluate(() => {
      const node = document.querySelector("[data-bar-drag-index]");
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const lines = [...document.querySelectorAll("[data-string-line]")].map((line) => {
        const at = line.getBoundingClientRect();
        return at.top + at.height / 2;
      });
      const y = lines[Math.floor(lines.length / 2)];
      const x = rect.left + 20;
      return y === undefined ? null : { x, y };
    });
    if (spot) {
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.down();
      await page.waitForTimeout(750);
      await page.mouse.move(spot.x + 68, spot.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(450);
    }
    const selected = await measure(page);

    results[viewport.name] = { idle, selected };
    await page.screenshot({
      path: `${OUT}editor-${LABEL}-${viewport.name}.png`,
      fullPage: false,
    });
    const line = (label, m) =>
      `  ${label.padEnd(9)} grid=${m.grid?.height ?? "-"} visible=${m.gridVisibleHeight ?? "-"} doors=${m.doorRow?.height ?? "-"} actions=${m.actionRow?.height ?? "-"} dock=${m.dock?.height ?? "-"} overflowX=${m.overflowX} gridHit=${m.gridHitOwner ?? "-"}${m.gridCoveredBy ? ` (${m.gridCoveredBy})` : ""}`;
    console.log(viewport.name);
    console.log(line("idle", idle));
    console.log(line("selected", selected));
    await context.close();
  }

  await browser.close();
  writeFileSync(
    `${OUT}GEOMETRY-${LABEL}.json`,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sha, label: LABEL, results }, null, 2)}\n`,
  );
  console.log(`\nwritten to ${OUT}GEOMETRY-${LABEL}.json`);
};

await main();
