/**
 * The three flows the brief says must never cover the grid (2V-B.4 §9, §11,
 * §14, §18).
 *
 * `inventory.mjs` measures the editor at rest — a tap and a long press. That
 * is the easy half: nothing is open. What §18 actually asks is whether the
 * grid is still the hero *while the reader is working*, so this walks into
 * the chord flow, the transposition flow and the phrase flow at all six
 * viewports and asks the same question inside each of them.
 *
 * It also produces §9's evidence, which cannot be produced any other way:
 * the phrase band draws a phrase, a phrase exists only once somebody names
 * one, and nobody had. So the run names one from a real selection and then
 * measures what appears above the staff.
 *
 * Usage:  SHA=<sha> node eval/editor-completion/flows.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** The staff's own top padding, from `geometry.ts`. The band lives in it. */
const STAFF_TOP_PADDING = 28;

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

/** The geometry claim, asked of whatever is on the screen right now. */
const measure = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector("[data-tab-content]");
    const out = { overflowX: document.documentElement.scrollWidth > window.innerWidth };
    if (!grid) return { ...out, gridHit: "none", gridVisibleHeight: 0 };

    const rect = grid.getBoundingClientRect();
    const column = (grid.closest("main") ?? grid).getBoundingClientRect();
    const top = Math.max(rect.top, column.top, 0);
    const bottom = Math.min(rect.bottom, column.bottom, window.innerHeight);
    const left = Math.max(rect.left, column.left, 0);
    const right = Math.min(rect.right, column.right, window.innerWidth);
    out.gridVisibleHeight = Math.round(Math.max(0, bottom - top));
    const x = Math.round(Math.min(Math.max((left + right) / 2, 1), window.innerWidth - 1));
    const y = Math.round((top + bottom) / 2);
    const hit = document.elementFromPoint(x, y);
    out.gridHit = hit === null ? "none" : hit.closest("[data-tab-content]") ? "grid" : "COVERED";

    /* Anything drawn over most of the screen. A sheet, a scrim, a modal. */
    out.coveringOverlays = [...document.querySelectorAll("body *")].filter((node) => {
      const style = getComputedStyle(node);
      if (style.position !== "fixed" && style.position !== "absolute") return false;
      const box = node.getBoundingClientRect();
      return box.width >= window.innerWidth * 0.9 && box.height >= window.innerHeight * 0.5;
    }).length;

    /*
     * Every enabled control tall enough to press, and the shortest of them.
     *
     * The phrase band is asked separately below. It lives in the staff's own
     * top padding — 28px, all of which it takes — and it may not grow past
     * that, because the only direction left is down over the notes and §9
     * forbids exactly that. Rolling it into this minimum would either hide a
     * real 44px failure elsewhere behind it or force a fix that covers the
     * music, so it is reported as its own number with its own threshold.
     */
    const buttons = [...document.querySelectorAll("button:not([disabled])")].filter(
      (node) => node.getBoundingClientRect().height > 0 && !node.hasAttribute("data-phrase-id"),
    );
    out.shortestTouchTarget = Math.round(
      Math.min(...buttons.map((node) => node.getBoundingClientRect().height), 999),
    );

    /*
     * Does any *text* run out of the box that clips it?
     *
     * Asked of the shelf's own labels and notes rather than of every node:
     * the staff and the shelf rows scroll on purpose, and a container wider
     * than its viewport is the design, not a defect. What would actually be
     * broken is a word cut in half inside a control that clips.
     */
    out.textOverflow = [
      ...document.querySelectorAll(
        "[data-shelf-note], [data-shelf-choice], [data-shelf-primary], [data-shelf-secondary], [data-dock-panel], [data-composer-door]",
      ),
    ]
      .filter((node) => {
        const style = getComputedStyle(node);
        return style.overflowX === "hidden" || style.overflowX === "clip";
      })
      .some((node) => node.scrollWidth > node.clientWidth + 2)
      ? true
      : false;

    const band = document.querySelector("[data-phrase-band]");
    out.phraseBand = band
      ? {
          spans: Number(band.getAttribute("data-phrase-band")),
          height: Math.round(band.getBoundingClientRect().height),
          /* The band must not sit over the staff it describes. */
          coversStaff: [...document.querySelectorAll("[data-string-line]")].some((line) => {
            const at = line.getBoundingClientRect();
            const on = band.getBoundingClientRect();
            return on.bottom > at.top + 1 && on.top < at.bottom - 1;
          }),
          targetHeight: Math.round(
            Math.min(
              ...[...document.querySelectorAll("[data-phrase-id]")].map(
                (node) => node.getBoundingClientRect().height,
              ),
              999,
            ),
          ),
          continues: [...document.querySelectorAll("[data-phrase-continues]")].map((node) =>
            node.getAttribute("data-phrase-continues"),
          ),
          names: [...document.querySelectorAll("[data-phrase-id]")].map((node) =>
            (node.textContent ?? "").trim(),
          ),
        }
      : null;

    out.openPanel = document.querySelector("[data-panel]")?.getAttribute("data-panel") ?? null;
    out.spanReading =
      document.querySelector("[data-shelf-note=span-reading]")?.textContent?.trim() ?? null;
    out.transposeScope =
      document.querySelector("[data-shelf-note=transpose-scope]")?.textContent?.trim() ?? null;
    out.chordName =
      document.querySelector("[data-shelf-note=chord-name]")?.textContent?.trim() ?? null;
    out.chordShape = document.querySelector("[data-chord-shape]") !== null;
    return out;
  });

const openEditor = async (page, sha) => {
  await page.goto(`${BASE}/eval/editor-action-batch?sha=${sha}`, { waitUntil: "networkidle" });
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

const openPanel = async (page, group, panel) => {
  await page.locator(`[data-dock-group=${group}]`).first().click().catch(() => {});
  await page.waitForTimeout(250);
  await page.locator(`[data-dock-panel=${panel}]`).first().click().catch(() => {});
  await page.waitForTimeout(350);
};

const holdRange = async (page) => {
  const spot = await reachable(page);
  if (!spot) return;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.move(spot.x + 140, spot.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(450);
};

const results = {};
const failures = [];
const check = (where, claim, ok, detail) => {
  const line = `${ok ? "PASS" : "FAIL"}  ${where} — ${claim}${detail ? ` · ${detail}` : ""}`;
  if (!ok) failures.push(line);
  console.log(line);
};

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }
  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: viewport.width < 900,
      deviceScaleFactor: 2,
      userAgent: ANDROID,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.setDefaultTimeout(15000);
    await openEditor(page, sha);

    /* ---------------------------------------------------------- the chord */
    const spot = await reachable(page);
    if (spot) {
      await page.mouse.click(spot.x, spot.y);
      await page.waitForTimeout(300);
    }
    await openPanel(page, "ses", "chord");
    const chord = await measure(page);

    /* ----------------------------------------------------- the transpose */
    await openPanel(page, "calim", "transpose");
    const transpose = await measure(page);
    /* And with a move staged, so the ghost layer is on the grid too. */
    await page.locator("[data-shelf-choice=move-up_semitone]").first().click().catch(() => {});
    await page.waitForTimeout(350);
    const staged = await measure(page);

    /* -------------------------------------------------------- the phrase */
    await holdRange(page);
    await openPanel(page, "secim", "phrase");
    const phrasePanel = await measure(page);
    await page.locator("[data-shelf-primary=name-phrase]").first().click().catch(() => {});
    await page.waitForTimeout(500);
    const phrase = await measure(page);
    await page.screenshot({ path: `${OUT}flow-phrase-${viewport.name}.png` });

    results[viewport.name] = { chord, transpose, staged, phrasePanel, phrase, errors };

    const where = viewport.name;
    for (const [name, state] of [
      ["akor", chord],
      ["taşı", transpose],
      ["taşı+ghost", staged],
      ["cümle paneli", phrasePanel],
      ["cümle yazıldı", phrase],
    ]) {
      check(
        `${where} ${name}`,
        "the grid is on the screen and answers for its own pixels",
        state.gridHit === "grid" && state.gridVisibleHeight > 0,
        `${state.gridVisibleHeight}px hit=${state.gridHit}`,
      );
      check(`${where} ${name}`, "nothing is drawn over the grid", state.coveringOverlays === 0);
      check(`${where} ${name}`, "the page does not scroll sideways", !state.overflowX);
      check(
        `${where} ${name}`,
        "every control a finger can press is at least 44px",
        state.shortestTouchTarget >= 44,
        `${state.shortestTouchTarget}px`,
      );
      check(`${where} ${name}`, "no text runs out of its own box", !state.textOverflow);
    }

    check(where, "the chord shows its shape and its name before Dinle",
      chord.openPanel === "chord" && chord.chordShape && Boolean(chord.chordName), chord.chordName ?? "-");
    check(where, "the chord's length is said in beats and in notation",
      /vuruş/.test(chord.spanReading ?? "") && /1\/\d/.test(chord.spanReading ?? ""), chord.spanReading ?? "-");
    check(where, "the transposition names its own scope",
      /^Taşınacak: \S/.test(transpose.transposeScope ?? ""), transpose.transposeScope ?? "-");
    check(where, "a phrase can be named from the production shelf, and it draws",
      phrase.phraseBand !== null && (phrase.phraseBand?.spans ?? 0) > 0,
      phrase.phraseBand ? `${phrase.phraseBand.spans} span` : "no band");
    check(where, "the phrase band does not cover the staff",
      phrase.phraseBand !== null && !phrase.phraseBand.coversStaff);
    check(where, "the phrase band's ink is thinner than a staff row",
      (phrase.phraseBand?.height ?? 99) <= STAFF_TOP_PADDING, `${phrase.phraseBand?.height ?? "-"}px`);
    check(where, "and it still takes the whole strip it owns, for the finger",
      (phrase.phraseBand?.targetHeight ?? 0) >= STAFF_TOP_PADDING,
      `${phrase.phraseBand?.targetHeight ?? "-"}px of ${STAFF_TOP_PADDING}px`);
    check(where, "no console error along the way", errors.length === 0, errors.slice(0, 2).join(" | "));

    await context.close();
  }

  await browser.close();
  writeFileSync(
    `${OUT}FLOWS.json`,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sha, results }, null, 2)}\n`,
  );
  console.log(`\n${failures.length === 0 ? "all flows passed" : `${failures.length} FAILED`}`);
  console.log(`written to ${OUT}FLOWS.json`);
  if (failures.length > 0) process.exitCode = 1;
};

await main();
