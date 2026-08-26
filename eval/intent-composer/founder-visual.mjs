/**
 * Twelve screens a person can look at, and the numbers under each one
 * (2S-A kapanış §4).
 *
 * The geometry tests pass. That is not the same as "it looks natural", and no
 * automatic metric can close that gap — so this produces the pictures, and
 * measures the things a picture cannot be trusted about: what really owns each
 * touch, whether neighbouring strings overlap, whether a glyph and a beam or
 * an arc are drawn on top of one another.
 *
 * It approves nothing. The measurements are recorded as measurements and the
 * founder decision stays open.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/founder-visual.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture } from "./device.mjs";
import { PROJECT_LEDGER } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer/artifacts/founder";
mkdirSync(OUT, { recursive: true });

const screens = [];

async function boot(browser, viewport, song, textScale) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries, ledger]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(ledger);
    },
    [Object.entries(device(song)), PROJECT_LEDGER],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  await page.getByTestId("view-tab").click();
  await page.waitForTimeout(350);
  if (textScale !== 100) {
    await page.addStyleTag({
      content: `html { font-size: ${Math.round(16 * (textScale / 100))}px }`,
    });
    await page.waitForTimeout(250);
  }
  return { context, page, errors };
}

const enterEdit = async (page) => {
  const edit = page.locator("[data-action-row] button", { hasText: "Düzenle" }).first();
  if (await edit.isVisible().catch(() => false)) {
    await edit.click();
    await page.waitForTimeout(350);
  }
};

const openDoor = async (page, door) => {
  await page.locator(`[data-composer-door='${door}']`).click();
  await page.waitForTimeout(300);
};

const pickOption = async (page, option) => {
  await page.locator(`[data-composer-option='${option}']`).first().click();
  await page.waitForTimeout(300);
};

/**
 * Everything a picture cannot be trusted about.
 *
 * Visible height is clipped by the viewport and by every scrolling or hiding
 * ancestor, so a row that is 44px tall and half off the surface is measured as
 * what it really is. Ownership is asked of the document at three points down
 * each cell, because a cell whose middle answers correctly and whose edges
 * answer with the neighbour is not a target, it is a coin toss.
 */
const measure = (page) =>
  page.evaluate(() => {
    const round = (value) => Math.round(value * 10) / 10;

    const clippedHeight = (element) => {
      let top = element.getBoundingClientRect().top;
      let bottom = element.getBoundingClientRect().bottom;
      top = Math.max(top, 0);
      bottom = Math.min(bottom, window.innerHeight);
      let node = element.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
          const box = node.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
        node = node.parentElement;
      }
      return Math.max(0, bottom - top);
    };

    const cells = [...document.querySelectorAll("[data-cell]")];
    let minVisible = Infinity;
    let wrongOwner = 0;
    let handedToAControl = 0;
    let probes = 0;
    const strangers = [];
    for (const cell of cells.slice(0, 24)) {
      const height = clippedHeight(cell);
      if (height > 0) minVisible = Math.min(minVisible, height);
      const box = cell.getBoundingClientRect();
      for (const at of [0.2, 0.5, 0.8]) {
        const y = box.top + box.height * at;
        if (y < 0 || y > window.innerHeight) continue;
        probes += 1;
        const owner = document.elementFromPoint(box.left + box.width / 2, y);
        if (owner && (cell === owner || cell.contains(owner) || owner.contains(cell))) continue;
        /*
         * A selection handle sitting on the edge of the run is not a stolen
         * target: it is a control with a name, drawn there so a finger can
         * move the edge, and it is meant to win that point. Counted apart
         * from a cell whose touch goes somewhere with no answer.
         */
        const control = owner?.closest("button,[role='button']") ?? null;
        const named = control?.getAttribute("aria-label") ?? null;
        if (named) {
          handedToAControl += 1;
          continue;
        }
        wrongOwner += 1;
        if (strangers.length < 4) {
          strangers.push({
            cell: cell.getAttribute("data-cell"),
            owner: owner ? owner.tagName.toLowerCase() : null,
          });
        }
      }
    }

    /*
     * Two cells on neighbouring strings in the same bar must not overlap.
     *
     * Sorted by where they are drawn rather than by string number: string 0 is
     * the thickest and is drawn at the *bottom*, so ordering by index and
     * comparing "a.bottom > b.top" called every abutting pair an overlap — 80
     * of them, all of them 44px boxes sitting exactly edge to edge.
     */
    const bySlot = new Map();
    for (const cell of cells) {
      const [slot, string] = (cell.getAttribute("data-cell") ?? "").split(":");
      if (slot === undefined || string === undefined) continue;
      const bar = cell.closest("[data-bar-key]")?.getAttribute("data-bar-key") ?? "?";
      const key = `${bar}|${slot}`;
      const list = bySlot.get(key) ?? [];
      list.push(cell.getBoundingClientRect());
      bySlot.set(key, list);
    }
    let neighbourOverlap = 0;
    let deadGround = 0;
    for (const list of bySlot.values()) {
      list.sort((a, b) => a.top - b.top);
      for (let index = 0; index + 1 < list.length; index += 1) {
        const gap = list[index + 1].top - list[index].bottom;
        if (gap < -0.5) neighbourOverlap += 1;
        if (gap > 0.5) deadGround += 1;
      }
    }

    /*
     * The six strings of one bar, all of them, at once.
     *
     * `minVisibleHeight` over every cell includes ones the reader has scrolled
     * past, which is normal. What §18 is about is whether the staff a reader
     * is looking at is whole, so this measures one bar's six strings and says
     * how much of the shortest is really on screen.
     */
    const firstBar = document.querySelector("[data-bar-key]");
    const column = firstBar
      ? [...firstBar.querySelectorAll("[data-cell]")].filter((cell) =>
          (cell.getAttribute("data-cell") ?? "").startsWith("0:"),
        )
      : [];
    const columnHeights = column.map((cell) => round(clippedHeight(cell)));
    const stringsWhole = columnHeights.length > 0 && columnHeights.every((h) => h >= 44);

    const overlaps = (a, b) => {
      const one = a.getBoundingClientRect();
      const two = b.getBoundingClientRect();
      return !(
        one.right <= two.left + 0.5 ||
        two.right <= one.left + 0.5 ||
        one.bottom <= two.top + 0.5 ||
        two.bottom <= one.top + 0.5
      );
    };
    const count = (selectorA, selectorB) => {
      const listA = [...document.querySelectorAll(selectorA)];
      const listB = [...document.querySelectorAll(selectorB)];
      let total = 0;
      for (const a of listA) for (const b of listB) if (overlaps(a, b)) total += 1;
      return total;
    };

    const glyphs = [...document.querySelectorAll("[data-fret-glyph]")];
    const style = (element) => {
      const computed = getComputedStyle(element);
      return {
        border: computed.borderTopWidth,
        radius: computed.borderTopLeftRadius,
        background: computed.backgroundColor,
      };
    };

    const scrollers = [...document.querySelectorAll("*")].filter((node) => {
      const computed = getComputedStyle(node);
      return (
        (computed.overflowX === "auto" || computed.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      );
    });
    const staffVertical = [...document.querySelectorAll("[data-bar-key] *")].filter((node) => {
      const computed = getComputedStyle(node);
      return (
        (computed.overflowY === "auto" || computed.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight + 1
      );
    });

    /*
     * A sheet is meant to be in the way. With one open, `elementFromPoint`
     * over the staff correctly answers "the backdrop", and reading that as a
     * stolen touch target would make every sheet screen look broken. The
     * state is recorded instead, and ownership is only a claim when nothing
     * is covering the surface.
     */
    const sheetOpen = document.querySelectorAll('[role="dialog"]').length > 0;

    return {
      sheetOpen,
      cells: cells.length,
      hitProbes: probes,
      minVisibleHeight: minVisible === Infinity ? null : round(minVisible),
      wrongOwner,
      handedToAControl,
      strangers,
      neighbourOverlap,
      deadGround,
      columnHeights,
      stringsWhole,
      glyphBeamOverlap: count("[data-fret-glyph]", '[aria-label^="Ritim grubu"]'),
      glyphArcOverlap: count("[data-fret-glyph]", "[data-legato-arcs] path"),
      playheadGlyphOverlap: count('div[aria-hidden][style*="will-change"]', "[data-fret-glyph]"),
      bodyOverflow: round(document.body.scrollWidth - document.body.clientWidth),
      horizontalScrollers: scrollers.length,
      staffVerticalScrollers: staffVertical.length,
      glyphStyle: glyphs[0] ? style(glyphs[0]) : null,
      glyphCount: glyphs.length,
      beams: document.querySelectorAll('[aria-label^="Ritim grubu"]').length,
      arcs: [...document.querySelectorAll("[data-legato-arcs]")].reduce(
        (total, node) => total + Number(node.getAttribute("data-legato-arcs") ?? 0),
        0,
      ),
      openString: [...document.querySelectorAll("[data-fret-glyph]")].some(
        (node) => node.textContent?.trim() === "0",
      ),
      doubleDigit: [...document.querySelectorAll("[data-fret-glyph]")].some(
        (node) => (node.textContent?.trim().length ?? 0) > 1,
      ),
    };
  });

async function shot(page, errors, name, note) {
  const numbers = await measure(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  screens.push({
    name,
    note,
    ...numbers,
    consoleErrors: errors.length,
    firstError: errors[0] ?? null,
  });
  console.log(
    `${name}  visible=${numbers.minVisibleHeight} wrongOwner=${numbers.wrongOwner}/${numbers.hitProbes} handle=${numbers.handedToAControl} ` +
      `overlap=${numbers.neighbourOverlap}/${numbers.deadGround} strings=${
        numbers.stringsWhole ? "whole" : JSON.stringify(numbers.columnHeights)
      } scrollers=${numbers.horizontalScrollers}/${numbers.staffVerticalScrollers} ` +
      `errors=${errors.length}`,
  );
}

/** A run covered with the surface's own long press, then a drag of the handle. */
async function coverRun(page, context) {
  const cdp = await context.newCDPSession(page);
  const node = page.locator("[data-cell='0:2']").first();
  await node.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await node.boundingBox();
  if (!box) return cdp;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
  });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);

  for (let stage = 0; stage < 4; stage += 1) {
    if ((await page.getByTestId("selection-handle-end").count()) === 0) break;
    const handle = await page.getByTestId("selection-handle-end").boundingBox();
    if (!handle) break;
    const target = await page.locator("[data-cell='4:2']").first().boundingBox();
    const edge = page.viewportSize().width - 8;
    const to = target ? Math.min(target.x + target.width, edge) : edge;
    if (to <= handle.x + handle.width / 2 + 2) break;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, id: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: handle.x + ((to - handle.x) * step) / 8, y: handle.y + handle.height / 2, id: 1 },
        ],
      });
      await page.waitForTimeout(40);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(400);
    if (target && target.x + target.width <= edge) break;
  }
  return cdp;
}

const browser = await chromium.launch();

for (const [label, viewport] of [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
]) {
  // 1 / 6 — reading.
  {
    const { context, page, errors } = await boot(browser, viewport, fixture("legatoRun"), 100);
    await shot(page, errors, `${label}-1-reading`, "Normal Tab okuma");
    await context.close();
  }
  // 2 / 7 — the focused edit layout.
  {
    const { context, page, errors } = await boot(browser, viewport, fixture("legatoRun"), 100);
    await enterEdit(page);
    await shot(page, errors, `${label}-2-focused-edit`, "Focused Edit Layout");
    await context.close();
  }
  // 3 / 8 — the power chord pen, held, before anything is written.
  {
    const { context, page, errors } = await boot(browser, viewport, fixture("roomy"), 100);
    await enterEdit(page);
    await openDoor(page, "shape");
    await pickOption(page, "power-2");
    await shot(page, errors, `${label}-3-power-pen-ghost`, "Power Chord Kalemi ghost preview");
    await context.close();
  }
  // 4 / 9 — five notes covered, the brush's question open.
  {
    const { context, page, errors } = await boot(browser, viewport, fixture("legatoRun"), 100);
    await enterEdit(page);
    await coverRun(page, context);
    await openDoor(page, "connect");
    await pickOption(page, "connect-auto");
    await shot(page, errors, `${label}-4-legato-preview`, "Bes notalik HO/PO secim preview");
    await context.close();
  }
  // 5 / 10 — after the decision, the arcs on the staff.
  {
    const { context, page, errors } = await boot(browser, viewport, fixture("legatoRun"), 100);
    await enterEdit(page);
    await coverRun(page, context);
    await openDoor(page, "connect");
    await pickOption(page, "connect-auto");
    const choice = page.locator("[data-legato-choice='auto']");
    if ((await choice.count()) === 1) {
      await choice.click();
      await page.waitForTimeout(800);
    }
    await shot(page, errors, `${label}-5-arcs-committed`, "Commit sonrasi H/P yaylari");
    await context.close();
  }
}

// 11, 12 — the narrow screen at the largest text.
{
  const { context, page, errors } = await boot(
    browser,
    { width: 320, height: 700 },
    fixture("legatoRun"),
    150,
  );
  await enterEdit(page);
  await shot(page, errors, "320x700-150-11-focused-edit", "320x700 · %150 · Focused Edit Layout");
  await openDoor(page, "connect");
  await shot(page, errors, "320x700-150-12-connect-controls", "320x700 · %150 · Bagla kontrolleri");
  await context.close();
}

/* ------------------------------------------------- §2 in a real browser */

const articulationRun = async () => {
  const viewport = { width: 390, height: 844 };
  const { context, page, errors } = await boot(browser, viewport, fixture("legatoRun"), 100);
  await enterEdit(page);
  await coverRun(page, context);
  await openDoor(page, "connect");
  await pickOption(page, "connect-auto");
  const choice = page.locator("[data-legato-choice='auto']");
  if ((await choice.count()) === 1) {
    await choice.click();
    await page.waitForTimeout(800);
  }

  const readSong = () =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem("aranje.projects");
      if (!raw) return null;
      const id = JSON.parse(raw).activeProjectId;
      const record = window.localStorage.getItem(`aranje.project.${id}`);
      return record ? (JSON.parse(record).current ?? null) : null;
    });

  const linked = (song) => {
    const found = [];
    for (const section of song?.sections ?? []) {
      for (const [barIndex, bar] of (section.bars ?? []).entries()) {
        for (const [trackId, lane] of Object.entries(bar.slots ?? {})) {
          for (const [slotIndex, slot] of (lane ?? []).entries()) {
            if (!slot || slot === "-" || !slot.notes) continue;
            for (const note of slot.notes) {
              if (note.articulation === "hammer_on" || note.articulation === "pull_off") {
                found.push({ trackId, barIndex, slotIndex, articulation: note.articulation });
              }
            }
          }
        }
      }
    }
    return found;
  };

  const before = linked(await readSong());
  const arcCount = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-legato-arcs]")].reduce(
        (total, node) => total + Number(node.getAttribute("data-legato-arcs") ?? 0),
        0,
      ),
    );
  const arcsBefore = await arcCount();

  // The reader now changes one fret of a note inside the chain.
  const target = before[0];
  let updated = null;
  if (target) {
    const cellNode = page.locator(`[data-cell='${target.slotIndex}:2']`).first();
    await cellNode.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
    await cellNode.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const input = page.locator("#fret-input");
    if ((await input.count()) === 1) {
      const current = Number(await input.inputValue());
      // One fret in the direction that keeps a rising hammer-on rising.
      const next = Math.max(0, current - 1);
      await input.fill(String(next));
      await page.locator("[data-fret-commit]").first().click().catch(async () => {
        await page.getByRole("button", { name: "Güncelle", exact: true }).first().click();
      });
      await page.waitForTimeout(700);
      updated = { from: current, to: next };
    }
  }

  const after = linked(await readSong());
  const arcsAfter = await arcCount();
  await page.screenshot({ path: `${OUT}/390x844-13-after-pitch-update.png` });

  const result = {
    name: "390x844-13-after-pitch-update",
    note: "Legato zinciri yazildi, sonra bir perde degistirildi",
    linksBefore: before.length,
    linksAfter: after.length,
    arcsBefore,
    arcsAfter,
    updated,
    consoleErrors: errors.length,
  };
  screens.push(result);
  console.log(
    `articulation run  links ${before.length} -> ${after.length}  arcs ${arcsBefore} -> ${arcsAfter}  ` +
      `update=${JSON.stringify(updated)}`,
  );
  await context.close();
  return result;
};

const articulation = await articulationRun();
await browser.close();

/*
 * A verdict per screen, so the artefact says which of these are claims and
 * which are records.
 *
 * A sheet is meant to cover the staff, so ownership and whole-staff are only
 * asserted where nothing is covering it. The one state that fails with
 * nothing covering it is named rather than averaged away.
 */
const verdicts = screens
  .filter((screen) => screen.cells !== undefined)
  .map((screen) => ({
    name: screen.name,
    covered: screen.sheetOpen === true,
    ok:
      screen.sheetOpen === true ||
      screen.cells === 0 ||
      (screen.stringsWhole === true &&
        screen.wrongOwner === 0 &&
        screen.neighbourOverlap === 0 &&
        screen.bodyOverflow <= 0 &&
        screen.staffVerticalScrollers === 0 &&
        screen.consoleErrors === 0),
  }));
const failed = verdicts.filter((entry) => !entry.ok);
console.log(
  `\n${verdicts.length - failed.length}/${verdicts.length} screens meet every claim` +
    (failed.length > 0 ? `; open: ${failed.map((entry) => entry.name).join(", ")}` : ""),
);

writeFileSync(
  "eval/intent-composer/FOUNDER-VISUAL.json",
  `${JSON.stringify(
    {
      what: "2S-A kapanış §4 — founder görsel kabul paketi",
      measuredOn:
        "Masaüstü Chromium, mobil emülasyon, production build. Fiziksel telefon kanıtı yoktur.",
      approves:
        "Hiçbir şey. Sayılar ölçümdür; 'doğal görünüyor' kararı insana aittir ve K-59 açık kalır.",
      verdicts,
      screens,
      articulation,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${screens.length} screen recorded`);
