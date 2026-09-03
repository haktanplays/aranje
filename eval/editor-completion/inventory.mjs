/**
 * What the founder editor actually is, measured rather than remembered
 * (2V-B.4 §3).
 *
 * Six viewports, two gestures each — a tap on a cell and a long press that
 * opens a selection — and for every one of the twelve the same twelve
 * questions. The point is not the screenshots: it is that "the grid is the
 * hero", "one primary action", "one design per job" and "nothing covers the
 * music" are claims about pixels, and a batch that changes them has to be able
 * to show the numbers before and after.
 *
 * Usage:  SHA=<sha> LABEL=before node eval/editor-completion/inventory.mjs
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
  { name: "740x360", width: 740, height: 360 },
  { name: "844x390", width: 844, height: 390 },
  { name: "1280x800", width: 1280, height: 800 },
];

/**
 * Words a beginner is not supposed to meet on the first surface (§6).
 *
 * Searched as whole words where that matters — "slot" would otherwise match
 * inside Turkish words that have nothing to do with the grid.
 */
const JARGON = [
  ["tick", /\btick\b/i],
  ["ppq", /\bppq\b/i],
  ["slot", /\bslot\b/i],
  ["subdivision", /\bsubdivision\b/i],
  ["1/32", /1\/32/],
  ["resolution", /\bresolution\b/i],
  ["bar-n", /\bbar\s*\d/i],
  ["velocity", /\bvelocity\b/i],
  ["duration-ticks", /durationTicks/i],
];

const measure = (page) =>
  page.evaluate((jargon) => {
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
    out.grid = box("[data-tab-content]");
    out.shelf = box(".workspace-shelf");
    out.stage = box("main");
    out.dock = box("[data-editor-dock]");
    out.zoom = box("[data-view-zoom]");
    out.phraseBand = box("[data-phrase-band]");
    out.transport = box("footer");
    out.innerHeight = window.innerHeight;
    out.overflowX = document.documentElement.scrollWidth > window.innerWidth;

    /* How much of the grid a finger can actually reach: its own box clipped
       by the column that scrolls it and by the window. */
    const grid = document.querySelector("[data-tab-content]");
    if (grid) {
      const rect = grid.getBoundingClientRect();
      const column = (grid.closest("main") ?? grid).getBoundingClientRect();
      const top = Math.max(rect.top, column.top, 0);
      const bottom = Math.min(rect.bottom, column.bottom, window.innerHeight);
      const left = Math.max(rect.left, column.left, 0);
      const right = Math.min(rect.right, column.right, window.innerWidth);
      out.gridVisibleHeight = Math.round(Math.max(0, bottom - top));
      out.gridVisibleWidth = Math.round(Math.max(0, right - left));
      const x = Math.round(Math.min(Math.max((left + right) / 2, 1), window.innerWidth - 1));
      const y = Math.round((top + bottom) / 2);
      const hit = document.elementFromPoint(x, y);
      out.gridHit =
        hit === null ? "none" : hit.closest("[data-tab-content]") ? "grid" : "COVERED";
      if (out.gridHit === "COVERED") {
        const trail = [];
        let node = hit;
        for (let step = 0; node && step < 5; step += 1) {
          const attrs = [...node.attributes]
            .filter((a) => a.name.startsWith("data-") || a.name === "class")
            .map((a) => `${a.name}=${a.value.slice(0, 48)}`);
          trail.push(`${node.tagName}[${attrs.join(" ")}]`);
          node = node.parentElement;
        }
        out.gridCoveredBy = trail.join(" < ");
      }
    }

    /* Anything drawn over the whole screen: a modal, a scrim, a sheet. */
    const overlays = [...document.querySelectorAll("body *")].filter((node) => {
      const style = getComputedStyle(node);
      if (style.position !== "fixed" && style.position !== "absolute") return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.5;
    });
    out.coveringOverlays = overlays.map((node) =>
      `${node.tagName}[${node.className}]`.slice(0, 90),
    );

    /* Primary calls to action: the loud ones. A screen is supposed to have
       one, and counting them is the only way to know whether it does. */
    const buttons = [...document.querySelectorAll("button:not([disabled])")].filter(
      (node) => node.getBoundingClientRect().height > 0,
    );
    out.primaryCta = buttons
      .filter((node) => /bg-bronze|bg-steel|bg-accept/.test(node.className))
      .map((node) => (node.textContent ?? "").trim())
      .filter(Boolean);

    /*
     * Every visible control's **name**, so two designs for one job show up as
     * the same name twice in two different places.
     *
     * The accessible name, not the glyph. A "−" beside "Perde" and a "−"
     * beside "1 ölçü" are not two designs for one job — they are two steppers
     * whose group says what they step — and counting the character would
     * report a collision that a reader never experiences. What §17 forbids is
     * two controls a person would *call* the same thing, which is exactly
     * what the accessible name is.
     */
    const labels = buttons
      .map((node) =>
        (node.getAttribute("aria-label") ?? node.textContent ?? "").trim(),
      )
      .filter((text) => text.length > 0 && text.length < 60);
    out.controlLabels = labels;
    const seen = new Map();
    for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1);
    out.duplicateLabels = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([label, count]) => `${label}×${count}`);

    /* Which of the four jobs are reachable at all from here. */
    const text = document.body.innerText;
    out.paths = {
      chord: /Akor/.test(text),
      powerChord: /Power|5'li/i.test(text),
      rhythm: /Ritim/.test(text),
      fastSequence: /Hızlı dizi/i.test(text),
      playing: /Çalım/.test(text),
      selection: /Seçim/.test(text),
      transpose: /Sesi taşı|Tonu değiştir|Transpo/i.test(text),
      phrase: /\bCümle\b/.test(text),
    };

    out.jargon = jargon
      .filter(([, pattern]) => new RegExp(pattern.source, pattern.flags).test(text))
      .map(([name]) => name);

    /* Warning lines, and whether the same one is repeated. */
    const notices = [...document.querySelectorAll("[role=status], [role=alert]")]
      .map((node) => (node.textContent ?? "").trim())
      .filter(Boolean);
    out.notices = notices;
    out.repeatedNotices = notices.length !== new Set(notices).size;

    return out;
  }, jargonSource());

function jargonSource() {
  return JARGON.map(([name, pattern]) => [
    name,
    { source: pattern.source, flags: pattern.flags },
  ]);
}

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
    const lines = [...document.querySelectorAll("[data-string-line]")]
      .map((line) => {
        const at = line.getBoundingClientRect();
        return at.top + at.height / 2;
      })
      .filter((at) => at > top + 4 && at < bottom - 4);
    const y = lines[Math.floor(lines.length / 2)];
    return y === undefined ? null : { x: rect.left + 20, y };
  });

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
    await openEditor(page, sha);

    /* A tap on a cell: the "nothing held" state. */
    const spot = await reachable(page);
    if (spot) {
      await page.mouse.click(spot.x, spot.y);
      await page.waitForTimeout(350);
    }
    const tap = await measure(page);

    /*
     * And a long press that opens a selection.
     *
     * The point is asked for again rather than reused. The tap opens a shelf
     * panel in the flow, which moves the staff; pressing the old coordinate
     * would be pressing whatever is there now, and the run would report a
     * covered grid because the runner missed rather than because anything
     * covers it.
     */
    const held = await reachable(page);
    if (held) {
      await page.mouse.move(held.x, held.y);
      await page.mouse.down();
      await page.waitForTimeout(750);
      await page.mouse.move(held.x + 68, held.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(450);
    }
    const longPress = await measure(page);

    results[viewport.name] = { tap, longPress };
    await page.screenshot({ path: `${OUT}editor-${LABEL}-${viewport.name}.png` });

    const line = (name, m) =>
      `  ${name.padEnd(10)} grid=${m.gridVisibleHeight ?? "-"}x${m.gridVisibleWidth ?? "-"} hit=${m.gridHit} shelf=${m.shelf?.height ?? "-"} cta=${m.primaryCta.length} dup=${m.duplicateLabels.length} jargon=${m.jargon.join("|") || "-"} overlays=${m.coveringOverlays.length}${m.gridCoveredBy ? ` (${m.gridCoveredBy})` : ""}`;
    console.log(viewport.name);
    console.log(line("tap", tap));
    console.log(line("longPress", longPress));
    await context.close();
  }

  await browser.close();
  writeFileSync(
    `${OUT}INVENTORY-${LABEL}.json`,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sha, label: LABEL, results }, null, 2)}\n`,
  );
  console.log(`\nwritten to ${OUT}INVENTORY-${LABEL}.json`);
};

await main();
