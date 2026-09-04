/**
 * The gesture panel's new controls, measured on six screens (2V-C.2 §17).
 *
 * This batch added two things to the shelf: how far an open slide comes from,
 * and how to take a written gesture off again. Both are claims about pixels —
 * that they fit, that they are pressable, and that adding them did not push
 * anything over the grid — and a claim about pixels is only worth what a
 * browser says about it.
 *
 * Usage:  SHA=<sha> node eval/expression-fidelity/panel-geometry.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "384x692", width: 384, height: 692 },
  { name: "412x915", width: 412, height: 915 },
  { name: "landscape-740x360", width: 740, height: 360 },
  { name: "landscape-844x390", width: 844, height: 390 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
];

const MIN_TOUCH = 44;
/* The phrase band's accepted exception (2V-B.4). Unchanged by this batch. */
const PHRASE_BAND_PX = 28;

const measure = (page) =>
  page.evaluate(
    ({ minTouch, bandPx }) => {
      const box = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      };

      const out = {
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        panel: box("[data-panel='playing']"),
        distanceRow: box("[data-shelf-row='distance']"),
        removeRow: box("[data-shelf-row='remove']"),
        current: box("[data-shelf-note='playing-current']"),
      };

      /* Every option the panel is now offering, and whether a finger fits. */
      const controls = [...document.querySelectorAll("[data-panel='playing'] button")];
      out.controlCount = controls.length;
      out.tooSmall = controls
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            name: node.getAttribute("data-testid") ?? node.textContent?.trim() ?? "?",
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          };
        })
        .filter((entry) => entry.h > 0 && entry.h < minTouch);

      /* Raw engineering words the reader must never be shown. */
      const text = document.querySelector("[data-panel='playing']")?.textContent ?? "";
      out.jargon = ["cent", "semiton", "approx", "slide_in", "slide_out", "bend_release"]
        .filter((word) => text.toLowerCase().includes(word));
      /* A number on the main surface would be the raw field §12 forbids; the
         disclosure is allowed to speak one, so it is measured while closed. */
      /* Where a number is legitimate: the bar it is in, and the fret it is
         on. Both name the music rather than the gesture. */
      out.surfaceText = text;
      out.digitsOnSurface = /\d/.test(
        text.replace(/\d+\.\s*(?:perde|ölçü)/gi, ""),
      );

      /* Is anything drawn on top of the grid? */
      const grid = document.querySelector("[data-tab-content]");
      if (grid) {
        const rect = grid.getBoundingClientRect();
        const column = (grid.closest("main") ?? grid).getBoundingClientRect();
        const top = Math.max(rect.top, column.top, 0);
        const bottom = Math.min(rect.bottom, column.bottom, window.innerHeight);
        const left = Math.max(rect.left, column.left, 0);
        const right = Math.min(rect.right, column.right, window.innerWidth);
        const x = Math.round(
          Math.min(Math.max((left + right) / 2, 1), window.innerWidth - 1),
        );
        const y = Math.round((top + bottom) / 2);
        out.gridVisibleHeight = Math.round(Math.max(0, bottom - top));
        const hit = document.elementFromPoint(x, y);
        out.gridHit =
          hit === null ? "none" : hit.closest("[data-tab-content]") ? "grid" : "COVERED";
        if (out.gridHit === "COVERED") {
          /* Name it, so the report can say what is on top rather than "a div". */
          const trail = [];
          let node = hit;
          for (let step = 0; node && step < 5; step += 1) {
            const attrs = [...node.attributes]
              .filter((a) => a.name.startsWith("data-") || a.name === "class")
              .map((a) => `${a.name}=${a.value.slice(0, 40)}`);
            trail.push(`${node.tagName}[${attrs.join(" ")}]`);
            node = node.parentElement;
          }
          out.gridCoveredBy = trail.join(" < ");
        }
      }

      /* The phrase band keeps its accepted 28px, no more and no less. */
      const band = document.querySelector("[data-phrase-band]");
      out.phraseBand = band ? Math.round(band.getBoundingClientRect().height) : null;
      out.phraseBandExpected = bandPx;
      return out;
    },
    { minTouch: MIN_TOUCH, bandPx: PHRASE_BAND_PX },
  );

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }
  const browser = await chromium.launch();
  const results = {};
  let failures = 0;

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
    await page.waitForTimeout(400);
    await page.locator("[data-batch-action='to-song']").first().click().catch(() => {});
    await page.waitForTimeout(300);
    await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
    await page.waitForSelector("[data-tab-content]").catch(() => {});
    await page.getByRole("button", { name: "Düzenle", exact: true }).first()
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(400);

    /*
     * Put the cursor on a note that is actually written.
     *
     * The Çalım door is disabled until there is a fretted cell under the
     * cursor — which is correct, and is why the door has to be reached this
     * way rather than pressed first. A written glyph is found on screen and
     * clicked at its own centre.
     */
    const onNote = await page.evaluate(() => {
      /* A cell that actually holds an onset: the door is disabled without
         one, correctly, and clicking empty air proves nothing. */
      const glyphs = [...document.querySelectorAll("[data-cell][data-onset]")];
      /*
       * On a short screen the grid clips its own overflow, so most cells are
       * laid out below the column and scrolled to rather than reachable.
       * Scrolling the first one into view is what makes this work in
       * landscape as well as in portrait.
       */
      const first = glyphs[0];
      if (!first) return null;
      first.scrollIntoView({ block: "center", inline: "center" });
      for (const glyph of glyphs) {
        const rect = glyph.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.top > 0 &&
          rect.bottom < window.innerHeight &&
          rect.left > 0 &&
          rect.right < window.innerWidth
        ) {
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            /* Its identity, so the same note can be found again after the
               layout has moved — "the first visible cell" is a different
               note once the grid has scrolled. */
            cell: glyph.getAttribute("data-cell"),
          };
        }
      }
      return null;
    });
    if (onNote) {
      await page.mouse.click(onNote.x, onNote.y);
      await page.waitForTimeout(400);
    }

    /*
     * Çalım is a *group*; the panel behind it is one more press ("Bend /
     * Kaydır"), beside "Taşı". Both presses are needed, and the group may
     * already be the open one, so pressing it is guarded rather than assumed.
     */
    const group = page
      .locator("[data-editor-dock] button, [data-composer-doors] button")
      .filter({ hasText: "Çalım" })
      .first();
    if ((await group.getAttribute("aria-pressed")) !== "true") {
      await group.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    await page
      .locator("[data-editor-dock] button")
      .filter({ hasText: "Bend / Kaydır" })
      .first()
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    const opened = await page.locator("[data-panel='playing']").count();
    await page.locator("[data-shelf-choice='door-slide']").first().click().catch(() => {});
    await page.waitForTimeout(250);

    /*
     * Whichever open slide this note can actually take.
     *
     * Which ones are offered depends on where the note is: near the end of a
     * string, entering from below has nowhere to come from, and the panel
     * greys that option with the write command's own sentence — which is the
     * behaviour this batch added and not something to work around. So the
     * runner takes the first live one instead of insisting on a particular
     * direction.
     */
    for (const option of ["in_below", "in_above", "out_down", "out_up"]) {
      const choice = page.locator(`[data-shelf-choice='slide-${option}']`).first();
      if ((await choice.getAttribute("data-shelf-choice-state")) === "disabled") continue;
      await choice.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      if ((await page.locator("[data-shelf-row='distance']").count()) > 0) break;
    }
    await page.waitForTimeout(200);

    const seen = await measure(page);
    seen.panelOpened = opened > 0;

    /*
     * And then the other half of §13: write it, come back, and take it off.
     *
     * The remove row cannot exist before something is written — that is the
     * point of offering it only when there is something to remove — so it has
     * to be reached by actually applying a gesture first.
     */
    await page
      .locator("[data-shelf-primary='apply']")
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await page.waitForTimeout(600);
    /*
     * Nothing is pressed again.
     *
     * The panel stays open after Uygula and redraws with what the note now
     * says — which is the behaviour being checked. Reopening it "to be sure"
     * presses a toggle and closes it, and re-selecting the cell clears the
     * cursor: both were runner bugs that read as missing product behaviour.
     */
    await page.waitForTimeout(400);
    const after = await measure(page);
    seen.afterApply = {
      current: after.current,
      removeRow: after.removeRow,
      currentText: await page
        .locator("[data-shelf-note='playing-current']")
        .first()
        .textContent()
        .catch(() => null),
      removeChoices: await page.evaluate(() =>
        [...document.querySelectorAll("[data-shelf-row='remove'] button")].map((node) => ({
          name: node.getAttribute("data-shelf-choice"),
          h: Math.round(node.getBoundingClientRect().height),
        })),
      ),
      overflowX: after.overflowX,
      gridHit: after.gridHit,
      gridCoveredBy: after.gridCoveredBy ?? "",
      tooSmall: after.tooSmall,
    };

    const problems = [];
    if (!seen.panelOpened) problems.push("panel did not open");
    if (seen.overflowX) problems.push("page scrolls sideways");
    if (seen.gridHit === "COVERED") problems.push("something is over the grid");
    if (seen.tooSmall.length > 0) {
      problems.push(`targets under ${MIN_TOUCH}px: ${seen.tooSmall.map((e) => `${e.name}=${e.h}`).join(", ")}`);
    }
    if (seen.jargon.length > 0) problems.push(`jargon: ${seen.jargon.join(", ")}`);
    if (seen.digitsOnSurface) problems.push("a raw number is on the main surface");
    if (seen.phraseBand !== null && seen.phraseBand !== PHRASE_BAND_PX) {
      problems.push(`phrase band is ${seen.phraseBand}px, not ${PHRASE_BAND_PX}`);
    }
    if (seen.panelOpened && seen.distanceRow === null) {
      problems.push("no distance row after choosing an open slide");
    }
    const back = seen.afterApply;
    if (back.current === null) problems.push("panel does not say what the note now does");
    if (back.removeRow === null) problems.push("no way to take the gesture off again");
    if (back.removeChoices.length === 0) problems.push("remove row is empty");
    if (back.removeChoices.some((entry) => entry.h > 0 && entry.h < MIN_TOUCH)) {
      problems.push("a remove control is under 44px");
    }
    if (back.overflowX) problems.push("page scrolls sideways after applying");
    if (back.gridHit === "COVERED") problems.push("something covers the grid after applying");
    if (problems.length > 0) failures += 1;

    results[viewport.name] = { ...seen, problems };
    await page.screenshot({ path: `${OUT}panel-${viewport.name}.png` });
    console.log(
      `${viewport.name.padEnd(18)} panel=${seen.panelOpened} distance=${seen.distanceRow?.height ?? "-"} remove=${seen.afterApply.removeRow?.height ?? "-"} current="${(seen.afterApply.currentText ?? "-").slice(0, 34)}" gridHit=${seen.gridHit ?? "-"} overflowX=${seen.overflowX} band=${seen.phraseBand ?? "n/a"} ${problems.length === 0 ? "OK" : `FAIL: ${problems.join(" · ")}`}`,
    );
    await context.close();
  }

  await browser.close();
  writeFileSync(
    `${OUT}PANEL-GEOMETRY.json`,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sha, results }, null, 2)}\n`,
  );
  console.log(`\n${failures === 0 ? "all six clean" : `${failures} viewport(s) with problems`}`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
