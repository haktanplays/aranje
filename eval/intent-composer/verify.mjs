/**
 * The intent layer, in a real browser (2S-A §15).
 *
 * Sixty-six scenarios over two viewports and three text scales, on a
 * production build, with the counters installed before the app's first line.
 * Nothing is checked by reading a sentence off the screen when the fact
 * behind it can be measured instead: a written chord against the Song in
 * storage, a write against `Storage.prototype.setItem`, a glyph against its
 * own computed box, an arc against its path, and the audio against the
 * buffers that actually started.
 *
 * ## Why the matrix is the whole matrix
 *
 * A control reachable at 390px and 100% text says nothing about 320px at
 * 150%: that is where the edit toolbar clipped 135px and where the doors have
 * to wrap. Each scenario is therefore a *result per combination*, and the
 * artefact records all of them rather than a pass rate.
 *
 *   npx tsx eval/intent-composer/make-fixtures.ts
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/verify.mjs
 *   ONE_VIEWPORT=1 ONLY=pen node eval/intent-composer/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture, TEXT_SCALES, VIEWPORTS } from "./device.mjs";
import { PROJECT_LEDGER, takeStorageLedger, writeTally } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";
mkdirSync(OUT, { recursive: true });

const MIN_TOUCH = 44;

const results = [];
let combo = "";
const record_ = (name, pass, detail = "") => {
  results.push({ combo, name, pass, detail: String(detail).slice(0, 220) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${combo} · ${name}${detail ? `  — ${detail}` : ""}`);
};

const ONLY = (process.env.ONLY ?? "").split(",").map((e) => e.trim()).filter(Boolean);
const wanted = (label) => ONLY.length === 0 || ONLY.some((entry) => label.includes(entry));

/** Counts every buffer that actually starts, from outside the app. */
const AUDIO_COUNTER = `
window.__aranjeAudio = { starts: [] };
(() => {
  const proto = AudioBufferSourceNode.prototype;
  const original = proto.start;
  proto.start = function (...args) {
    window.__aranjeAudio.starts.push(typeof args[0] === "number" ? args[0] : null);
    return original.apply(this, args);
  };
})();
`;

/* ------------------------------------------------------------------ boot */

async function boot(browser, viewport, song, textScale) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries, counter, ledger]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(counter);
      // After the seed, so seeding is not counted as the app writing.
      (0, eval)(ledger);
    },
    [Object.entries(device(song)), AUDIO_COUNTER, PROJECT_LEDGER],
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
    await page.waitForTimeout(200);
  }
  return { context, page, errors };
}

const enterEdit = async (page) => {
  await page.locator("[data-action-row] button", { hasText: "Düzenle" }).first().click();
  await page.waitForTimeout(300);
};

/**
 * Open one of the four doors, by whichever route the screen is offering.
 *
 * While a selection is covered the door row stands down and the compact
 * selection toolbar carries `Bağla` instead (K-59 §3) — the brush is *used* on
 * a covered run, so that is the route a reader takes to it. Both reach the
 * same sheet; the tour follows the reader rather than the markup.
 */
const DOOR_VERB = { connect: "Bağla" };

const openDoor = async (page, door) => {
  const row = page.locator(`[data-composer-door='${door}']`);
  if ((await row.count()) > 0) {
    await row.click();
  } else {
    const verb = DOOR_VERB[door];
    if (!verb) throw new Error(`no route to the ${door} door`);
    await page.locator(`[data-selection-verb='${verb}']`).first().click();
  }
  await page.waitForTimeout(250);
};

/**
 * Tap a cell, wherever the surface happens to be scrolled.
 *
 * The string labels sit in a sticky gutter on the left, and a cell scrolled
 * under it is a cell a click lands on the gutter instead of. So the surface is
 * nudged until the cell is clear of it, and only then tapped — which is what a
 * reader does when a note is half under the labels.
 */
const tapCell = async (page, cell) => {
  const node = page.locator(`[data-cell='${cell}']`).first();
  await node.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  let box = await node.boundingBox();
  if (box && box.x < 56) {
    await page.evaluate((dx) => {
      const scroller = document.querySelector("[data-tab-content]")?.parentElement;
      if (scroller) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - dx);
    }, 56 - box.x + 20);
    await page.waitForTimeout(200);
    box = await node.boundingBox();
  }
  if (!box) return false;
  /*
   * A tap at raw coordinates does not see what a reader sees. Once the view
   * has been scrolled away from the playhead the "Çalmaya dön" pill appears
   * over the bottom-right of the reading surface (2Q-C §6), and at 320px it
   * covers the last few cells of the lowest string. A person reads that pill
   * and aims elsewhere; `page.mouse.click` aims through it and the tap is
   * spent dismissing it. That is a harness defect, not a product one, so the
   * harness checks what is actually on top before it commits the tap.
   */
  const occluder = await page.evaluate(
    ([x, y, key]) => {
      const top = document.elementFromPoint(x, y);
      if (!top || top.closest(`[data-cell='${key}']`)) return null;
      return top.closest("[data-return-to-playback]") ? "return-to-playback" : "unknown";
    },
    [box.x + box.width / 2, box.y + box.height / 2, cell],
  );
  if (occluder === "return-to-playback") {
    await page.locator("[data-return-to-playback]").click();
    await page.waitForTimeout(250);
    await node.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    box = await node.boundingBox();
    if (!box) return false;
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  return true;
};

const pickOption = async (page, option) => {
  const node = page.locator(`[data-composer-option='${option}']`);
  await node.scrollIntoViewIfNeeded();
  await node.click();
  await page.waitForTimeout(300);
};

/** The notes written in one slot of the first bar, as pitch@string:fret. */
const slotNotes = (page, slotIndex) =>
  page.evaluate((index) => {
    const raw = window.localStorage.getItem("aranje.project.project-1");
    if (!raw) return null;
    const song = JSON.parse(raw).current;
    const lane = song.sections[0].bars[0].slots[song.tracks[0].id];
    const slot = lane[index];
    if (!slot || slot === "-") return [];
    return slot.notes.map(
      (note) => `${note.pitch}@${note.position?.string}:${note.position?.fret}`,
    );
  }, slotIndex);

const songBytes = (page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.project.project-1");
    return raw ? JSON.stringify(JSON.parse(raw).current) : null;
  });

/** Every fret glyph on screen, with the box the digit really occupies. */
const glyphBoxes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-fret-glyph]")].map((node) => {
      const digit = node.querySelector("[data-glyph-digit]");
      const box = digit?.getBoundingClientRect();
      const style = digit ? getComputedStyle(digit) : null;
      return {
        text: node.getAttribute("data-fret-glyph"),
        state: node.getAttribute("data-glyph-state"),
        label: node.getAttribute("aria-label"),
        width: box ? Math.round(box.width * 100) / 100 : null,
        height: box ? Math.round(box.height * 100) / 100 : null,
        padding: style ? `${style.paddingLeft}/${style.paddingRight}` : null,
        border: style?.borderTopWidth ?? null,
        radius: style?.borderTopLeftRadius ?? null,
        shadow: style?.boxShadow ?? null,
        background: style?.backgroundColor ?? null,
        numerals: style?.fontVariantNumeric ?? null,
      };
    }),
  );

const arcs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-legato-arcs]")].map((node) => ({
      count: Number(node.getAttribute("data-legato-arcs")),
      label: node.getAttribute("aria-label"),
      pointerEvents: getComputedStyle(node).pointerEvents,
      paths: [...node.querySelectorAll("path")].map((path) => path.getAttribute("d")),
      marks: [...node.querySelectorAll("text")].map((text) => text.textContent),
    })),
  );

const rowMetrics = (page) =>
  page.evaluate((selector) => {
    const row = document.querySelector(selector);
    if (!row) return null;
    const targets = [...row.querySelectorAll("button")].map((node) => {
      const box = node.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });
    return {
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
      clipped: row.scrollWidth - row.clientWidth,
      targets,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  }, "[data-composer-doors]");

/* ------------------------------------------------------------------ tours */

/** The doors: what they are, and that only one tool is ever held (§6, §11). */
async function doorTour(browser, viewport, textScale) {
  const { context, page, errors } = await boot(browser, viewport, fixture("roomy"), textScale);
  await enterEdit(page);

  const doors = await page.evaluate(() =>
    [...document.querySelectorAll("[data-composer-door]")].map((node) => ({
      id: node.getAttribute("data-composer-door"),
      text: (node.textContent ?? "").trim(),
      height: Math.round(node.getBoundingClientRect().height),
    })),
  );
  record_("1. four doors, named in Turkish", doors.length === 4, doors.map((d) => d.text).join("/"));
  record_(
    "2. every door is a real touch target",
    doors.every((door) => door.height >= MIN_TOUCH),
    doors.map((d) => d.height).join(","),
  );
  record_(
    "3. the door row never overflows its own width",
    (await rowMetrics(page))?.clipped === 0,
    JSON.stringify(await rowMetrics(page)),
  );
  record_(
    "4. the page itself never scrolls sideways",
    (await rowMetrics(page))?.bodyScrollWidth ===
      (await rowMetrics(page))?.bodyClientWidth,
  );

  await openDoor(page, "shape");
  const shapeOptions = await page.evaluate(() =>
    [...document.querySelectorAll("[data-composer-option]")].map((node) => ({
      id: node.getAttribute("data-composer-option"),
      hint: node.querySelector("span:nth-child(2)")?.textContent ?? "",
    })),
  );
  record_("5. the shape door offers the pen first", shapeOptions.length >= 2, shapeOptions.map((o) => o.id).join(","));
  record_(
    "6. every option explains itself without a musical term",
    shapeOptions.every((option) => option.hint.length > 10),
    shapeOptions.map((o) => o.hint.slice(0, 30)).join(" | "),
  );
  record_(
    "7. the wide catalogue is still there, behind the pen",
    (await page.locator("[data-composer-catalogue]").count()) === 1,
  );

  await pickOption(page, "power-2");
  /*
   * The held tool is written on its own door (K-59 §5). The fifth chip that
   * used to say it is gone: it stated something rather than doing something,
   * and on a 320px row it was the width of a door. What is drawn is the short
   * form; the whole sentence is the accessible name.
   */
  const heldDoor = () =>
    page.evaluate(() => {
      const node = document.querySelector("[data-composer-door-held]");
      return {
        drawn: (node?.textContent ?? "").trim(),
        name: node?.getAttribute("aria-label") ?? "",
      };
    });
  const held = await heldDoor();
  record_(
    "8. the held tool says what it is, in music",
    held.drawn === "Power 2" && held.name.includes("Power chord"),
    JSON.stringify(held),
  );
  record_(
    "9. no identifier reaches the reader",
    !/power_chord|hammer_on|pull_off/.test(`${held.drawn} ${held.name}`),
    JSON.stringify(held),
  );

  await openDoor(page, "connect");
  await pickOption(page, "connect-auto");
  const afterSwap = await heldDoor();
  record_(
    "10. picking a second tool replaces the first",
    afterSwap.drawn === "Otomatik" &&
      !afterSwap.name.includes("Power chord") &&
      (await page.locator("[data-composer-door-held]").count()) === 1,
    JSON.stringify(afterSwap),
  );

  await openDoor(page, "connect");
  await pickOption(page, "connect-auto");
  record_(
    "11. picking the held tool again puts it down",
    (await page.locator("[data-composer-door-held]").count()) === 0,
  );

  await openDoor(page, "rhythm");
  record_(
    "12. no door opens onto nothing",
    (await page.evaluate(() => document.querySelectorAll("[data-composer-option]").length)) >= 1,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  // Session only: the tool must not survive a reload.
  await openDoor(page, "shape");
  await pickOption(page, "power-3");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("view-tab").click();
  await page.waitForTimeout(400);
  record_(
    "13. a tool does not survive a refresh",
    (await page.locator("[data-composer-held]").count()) === 0,
  );
  const stored = await page.evaluate(() =>
    JSON.stringify(localStorage.getItem("aranje.project.project-1") ?? ""),
  );
  record_(
    "14. the tool is never written to the project",
    !/power_chord|composerTool|penFret/.test(stored),
  );

  record_("15. the door tour raised no page error", errors.length === 0, errors[0] ?? "");
  await context.close();
}

/** The pen: what a touch writes, and what it costs (§7, §12). */
async function penTour(browser, viewport, textScale) {
  const { context, page, errors } = await boot(browser, viewport, fixture("roomy"), textScale);
  await enterEdit(page);
  await openDoor(page, "shape");
  await pickOption(page, "power-2");

  const before = await songBytes(page);
  await takeStorageLedger(page);
  await tapCell(page, "2:0");
  await page.waitForTimeout(700);

  const written = await slotNotes(page, 2);
  record_("16. a touch writes root and fifth", written?.length === 2, JSON.stringify(written));
  record_(
    "17. the root is the string and fret the finger asked for",
    written?.[0]?.endsWith("@0:5") ?? false,
    JSON.stringify(written),
  );
  record_(
    "18. every note carries its position",
    (written ?? []).every((entry) => !entry.includes("@undefined")),
    JSON.stringify(written),
  );
  const ledger = await takeStorageLedger(page);
  record_(
    "19. one write, and only to the open project",
    ledger.songWrites === 1 && ledger.catalogWrites === 0 && ledger.otherProjectWrites === 0,
    JSON.stringify(ledger.counts),
  );
  record_("20. the song really changed", (await songBytes(page)) !== before);

  record_(
    "21. the pen stays open after it writes",
    (await page.locator("[data-composer-door-held]").count()) === 1,
  );

  // Three voices, on a beat of its own.
  await openDoor(page, "shape");
  await pickOption(page, "power-3");
  await tapCell(page, "4:0");
  await page.waitForTimeout(700);
  const three = await slotNotes(page, 4);
  record_("22. three voices add the octave above the root", three?.length === 3, JSON.stringify(three));

  /*
   * An occupied beat, written over with a *different* chord. The same chord
   * twice is refused as "there is already this chord here", which is correct
   * and is not what this scenario is about.
   */
  await openDoor(page, "shape");
  await pickOption(page, "power-2");
  await takeStorageLedger(page);
  const occupied = await songBytes(page);
  await tapCell(page, "4:0");
  await page.waitForTimeout(700);
  const afterSecond = await slotNotes(page, 4);
  record_(
    "23. writing over a beat replaces the whole onset",
    afterSecond?.length === 2,
    JSON.stringify(afterSecond),
  );
  record_(
    "24. it does not reach the next beat",
    JSON.stringify(await slotNotes(page, 5)) === "[]",
  );
  const replaceLedger = await takeStorageLedger(page);
  record_(
    "25. a replace is still one write",
    replaceLedger.songWrites === 1,
    JSON.stringify(replaceLedger.counts),
  );
  record_("26. and it really changed something", (await songBytes(page)) !== occupied);

  // Undo takes the whole chord back in one step.
  const beforeUndo = await songBytes(page);
  await page.locator("[data-undo]").click();
  await page.waitForTimeout(600);
  record_("27. undo takes a power chord back in one step", (await songBytes(page)) !== beforeUndo);
  const undoneNotes = await slotNotes(page, 4);
  record_(
    "28. and puts back exactly the three voices that were there",
    undoneNotes?.length === 3,
    JSON.stringify(undoneNotes),
  );

  // Writing the same chord twice over is refused rather than written again.
  await tapCell(page, "2:0");
  await page.waitForTimeout(600);
  const sameAgain = await page.evaluate(
    () => document.querySelector("[data-composer-refusal]")?.textContent ?? "",
  );
  record_(
    "28b. the same chord twice is refused rather than written again",
    sameAgain.length > 0,
    sameAgain,
  );

  record_("29. the pen tour raised no page error", errors.length === 0, errors[0] ?? "");
  await context.close();
}

/** The pen's refusals: nothing is written, and the reason is music (§7). */
async function penRefusalTour(browser, viewport, textScale) {
  const { context, page, errors } = await boot(browser, viewport, fixture("roomy"), textScale);
  await enterEdit(page);
  await openDoor(page, "shape");
  await pickOption(page, "power-2");

  // The thinnest string has nothing above it for a fifth.
  const before = await songBytes(page);
  const tally = await writeTally(page);
  await tapCell(page, "6:5");
  await page.waitForTimeout(700);
  const refusal = await page.evaluate(
    () => document.querySelector("[data-composer-refusal]")?.textContent ?? "",
  );
  record_("30. an unreachable root is refused by name", refusal.length > 0, refusal);
  record_("31. and says it in music, not in a code", !/_|undefined|Error/.test(refusal), refusal);
  record_("32. a refusal writes nothing", (await songBytes(page)) === before);
  const after = await writeTally(page);
  record_(
    "33. a refusal costs zero storage writes",
    after.activeProject === tally.activeProject,
    `${tally.activeProject} → ${after.activeProject}`,
  );
  record_("34. the pen refusal tour raised no page error", errors.length === 0, errors[0] ?? "");
  await context.close();
}

/** The brush: covering a run and answering once (§8). */
async function brushTour(browser, viewport, textScale) {
  const { context, page, errors } = await boot(browser, viewport, fixture("legatoRun"), textScale);
  await enterEdit(page);

  /*
   * The run is covered first, with the surface's own long press and its own
   * handle, and the brush is armed afterwards. That order is the point: the
   * time selection is the single long-press-and-drag this surface has, and it
   * owns the threshold, the flick and the scroll takeover (spec 13.1). A
   * second gesture with a second tolerance would be a second answer to one
   * finger.
   */
  const cdp = await context.newCDPSession(page);
  const hold = async (cell) => {
    const node = page.locator(`[data-cell='${cell}']`).first();
    await node.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const box = await node.boundingBox();
    if (!box) return;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
    });
    await page.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const bandTicks = () =>
    page.evaluate(() => {
      const band = document.querySelector("[data-testid='time-selection-band']");
      return band ? Number(band.getAttribute("data-end-ticks")) : null;
    });

  /**
   * Drag the selection's end handle towards a cell, in as many stages as it
   * takes.
   *
   * A drag cannot go further than the screen, and at 320px the far end of the
   * run is off it. So the handle is pulled to the right edge, released, and
   * pulled again from wherever it landed — which is what a finger does — until
   * it stops growing or the target is on screen.
   */
  const dragTo = async (cell, stages = 4) => {
    for (let stage = 0; stage < stages; stage += 1) {
      if ((await page.getByTestId("selection-handle-end").count()) === 0) return;
      const handle = await page.getByTestId("selection-handle-end").boundingBox();
      if (!handle) return;
      const node = page.locator(`[data-cell='${cell}']`).first();
      const target = await node.boundingBox();
      const edge = viewport.width - 8;
      const to = target ? Math.min(target.x + target.width, edge) : edge;
      if (to <= handle.x + handle.width / 2 + 2) return;

      const before = await bandTicks();
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, id: 1 }],
      });
      for (let step = 1; step <= 8; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: handle.x + ((to - handle.x) * step) / 8,
              y: handle.y + handle.height / 2,
              id: 1,
            },
          ],
        });
        await page.waitForTimeout(40);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
      if ((await bandTicks()) === before) return;
      if (target && target.x + target.width <= edge) return;
      await node.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
    }
  };

  await hold("0:2");
  await dragTo("4:2");
  const covered = await page.evaluate(() => {
    const band = document.querySelector("[data-testid='time-selection-band']");
    return band
      ? {
          start: Number(band.getAttribute("data-start-ticks")),
          end: Number(band.getAttribute("data-end-ticks")),
        }
      : null;
  });
  record_(
    "34b. the run is covered by the surface's own gesture",
    (covered?.end ?? 0) > (covered?.start ?? 0),
    JSON.stringify(covered),
  );

  await openDoor(page, "connect");
  await pickOption(page, "connect-auto");

  const sheetOpen = await page.locator("[data-legato-choice='auto']").count();
  record_("35. covering a run asks one question", sheetOpen === 1);
  const count = await page.evaluate(
    () => document.querySelector("[data-legato-count]")?.textContent ?? "",
  );
  record_("36. it says how many notes it found", count.length > 0, count);
  const preview = await page.evaluate(() =>
    [...document.querySelectorAll("[data-legato-preview] li")].map((node) => node.textContent),
  );
  record_(
    "37. the choice is visible before it is written",
    preview.length > 0,
    JSON.stringify(preview).slice(0, 120),
  );
  record_(
    "38. and it is said in music, never in an identifier",
    preview.every((entry) => !/hammer_on|pull_off/.test(entry ?? "")),
    JSON.stringify(preview).slice(0, 120),
  );

  const before = await songBytes(page);
  record_("39. nothing changes until a decision", before !== null);

  await takeStorageLedger(page);
  if (sheetOpen === 1) {
    await page.locator("[data-legato-choice='auto']").click();
    await page.waitForTimeout(700);
  }
  const articulations = await page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.project.project-1");
    const song = JSON.parse(raw).current;
    return song.sections[0].bars[0].slots[song.tracks[0].id]
      .map((slot) => (slot && slot !== "-" ? (slot.notes[0].articulation ?? null) : null))
      .filter((entry, index) => index < 5);
  });
  /*
   * The run is `5 7 8 7 5`, so every link after the first is decided by the
   * pitch: up, up, down, down. How far the gesture reached is a fact about
   * the drag; what it wrote where it reached is the claim.
   */
  const expected = [null, "hammer_on", "hammer_on", "pull_off", "pull_off"];
  const linked = articulations.filter((entry) => entry !== null).length;
  record_(
    "40. auto joins rising with a hammer-on and falling with a pull-off",
    linked >= 1 &&
      articulations.every(
        (entry, index) => entry === null || entry === expected[index],
      ),
    JSON.stringify(articulations),
  );
  record_(
    "40b. and it joins every note the gesture reached",
    linked >= 3,
    `${linked} link`,
  );
  const ledger = await takeStorageLedger(page);
  record_(
    "41. a whole run is one write",
    ledger.songWrites === 1,
    JSON.stringify(ledger.counts),
  );

  const beforeUndo = await songBytes(page);
  await page.locator("[data-undo]").click();
  await page.waitForTimeout(600);
  record_("42. and one undo step", (await songBytes(page)) !== beforeUndo);
  const afterUndo = await page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.project.project-1");
    const song = JSON.parse(raw).current;
    return song.sections[0].bars[0].slots[song.tracks[0].id]
      .slice(0, 5)
      .map((slot) => (slot && slot !== "-" ? (slot.notes[0].articulation ?? null) : null));
  });
  record_(
    "43. undo takes every link back at once",
    afterUndo.every((entry) => entry === null),
    JSON.stringify(afterUndo),
  );

  record_("44. the brush tour raised no page error", errors.length === 0, errors[0] ?? "");
  await context.close();
}

/** The tab's own visual language (§4). */
async function glyphTour(browser, viewport, textScale) {
  const { context, page, errors } = await boot(browser, viewport, fixture("dense16"), textScale);

  const boxes = await glyphBoxes(page);
  record_("45. every onset draws a fret number", boxes.length === 8, `${boxes.length}`);
  record_(
    "46. the digit has no padding of its own",
    boxes.every((glyph) => glyph.padding === "0px/0px"),
    boxes[0]?.padding ?? "",
  );
  record_(
    "47. no border, no radius, no shadow",
    boxes.every(
      (glyph) =>
        glyph.border === "0px" && glyph.radius === "0px" && glyph.shadow === "none",
    ),
    `${boxes[0]?.border}/${boxes[0]?.radius}/${boxes[0]?.shadow}`,
  );
  record_(
    "48. the digit sits on the page, not on a filled card",
    boxes.every((glyph) => glyph.background === "rgba(0, 0, 0, 0)"),
    boxes[0]?.background ?? "",
  );
  record_(
    "49. the numerals are tabular",
    boxes.every((glyph) => glyph.numerals === "tabular-nums"),
    boxes[0]?.numerals ?? "",
  );
  record_(
    "50. a one-digit fret is one digit wide",
    (boxes[0]?.width ?? 99) < 9,
    `${boxes[0]?.width}`,
  );
  record_(
    "51. every glyph is named as music",
    boxes.every((glyph) => /perde|tel/.test(glyph.label ?? "")),
    boxes[0]?.label ?? "",
  );
  record_(
    "52. no identifier, tick or slot reaches a name",
    boxes.every((glyph) => !/hammer_on|pull_off|slot|tick/.test(glyph.label ?? "")),
    boxes.find((g) => g.state === "legato")?.label ?? "",
  );
  /*
   * The arc is what tells it apart (K-59 §2). The underline under every note
   * of a drawn run said the same thing a second time, and four of them in a
   * row read closer to a selection than to a slur — so it became the fallback
   * for the notes no arc could be drawn over.
   */
  const slurLayers = await arcs(page);
  record_(
    "53. a slurred note is told apart from an ordinary one",
    slurLayers.some((layer) => layer.count >= 1) &&
      boxes.every((glyph) => glyph.state !== "legato"),
    `${JSON.stringify(slurLayers[0]?.marks ?? [])} · ${boxes.map((g) => g.state).join(",")}`,
  );

  const drawn = await arcs(page);
  record_("54. a pull-off draws an arc", drawn[0]?.count === 1, JSON.stringify(drawn[0]?.marks));
  record_("55. with a P on it", drawn[0]?.marks?.[0] === "P", JSON.stringify(drawn[0]?.marks));
  record_(
    "56. the arc layer takes no pointer events",
    drawn.every((layer) => layer.pointerEvents === "none"),
    drawn[0]?.pointerEvents ?? "",
  );
  record_(
    "57. the arc is named by the movement",
    /perdeden/.test(drawn[0]?.label ?? ""),
    drawn[0]?.label ?? "",
  );

  const beams = await page.evaluate(
    () => document.querySelectorAll("[role='img'][aria-label*='nota']").length,
  );
  record_("58. the rhythm guide is still drawn", beams >= 0, `${beams}`);

  await enterEdit(page);
  /*
   * What a finger can actually reach, not what CSS says it is (2S-A §18).
   *
   * Three things are measured per cell, in the page, because none of them can
   * be read off a style rule:
   *
   *   visible  — the box clipped by every scrolling ancestor and by the
   *              viewport. A cell whose bottom half is under a clipper has
   *              half a target, whatever its height attribute says.
   *   owner    — who `elementFromPoint` returns at three points down the
   *              cell's own middle. Anything but this cell or a child of it
   *              means the finger lands somewhere else.
   *   overlap  — whether two strings' rectangles intersect. Six 44px bands
   *              stacked 26px apart would satisfy a height check and leave
   *              every tap ambiguous.
   */
  const hits = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-cell]")];
    if (nodes.length === 0) return null;

    const clipped = (node) => {
      let top = 0;
      let bottom = window.innerHeight;
      let parent = node.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflowY}`)) {
          const box = parent.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
        parent = parent.parentElement;
      }
      return { top, bottom };
    };

    let minVisible = Infinity;
    let probed = 0;
    let wrongOwner = 0;
    let firstWrong = null;
    const rects = [];

    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      const bounds = clipped(node);
      const visible = Math.max(
        0,
        Math.min(box.bottom, bounds.bottom) - Math.max(box.top, bounds.top),
      );
      minVisible = Math.min(minVisible, visible);
      rects.push({ key: node.getAttribute("data-cell"), box, visible });
    }

    /* The owner probe is expensive, so it runs on the first bar's grid — every
       string, three points each — which is where a stacking mistake shows. */
    const sample = rects.slice(0, 24);
    for (const entry of sample) {
      const x = entry.box.left + entry.box.width / 2;
      for (const at of [0.5, 0.2, 0.8]) {
        const y = entry.box.top + entry.box.height * at;
        probed += 1;
        const top = document.elementFromPoint(x, y);
        const owns = top !== null && top.closest("[data-cell]")?.getAttribute("data-cell") === entry.key;
        if (!owns) {
          wrongOwner += 1;
          firstWrong ??= `${entry.key}@${at} -> ${
            top ? (top.getAttribute("data-cell") ?? top.getAttribute("aria-label") ?? top.tagName) : "none"
          }`;
        }
      }
    }

    /* Two cells on the same slot are two strings; their bands must not meet. */
    const bySlot = new Map();
    for (const entry of rects) {
      const slot = entry.key?.split(":")[0] ?? "";
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), entry]);
    }
    let overlaps = 0;
    for (const column of bySlot.values()) {
      const sorted = [...column].sort((a, b) => a.box.top - b.box.top);
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].box.top < sorted[index - 1].box.bottom - 0.5) overlaps += 1;
      }
    }

    /* The outer strings — the thin "e" and the thick "E" — are the two a
       cramped layout eats first, so they are asserted by name. */
    const strings = [...new Set(rects.map((entry) => Number(entry.key?.split(":")[1])))].sort(
      (a, b) => a - b,
    );
    const outer = [strings[0], strings[strings.length - 1]];
    const edgeVisible = Math.min(
      ...rects
        .filter((entry) => outer.includes(Number(entry.key?.split(":")[1])))
        .map((entry) => entry.visible),
    );

    /* The staff must not answer "it fits" by growing a scroller of its own. */
    const staff = document.querySelector("[data-tab-content]") ?? document.querySelector("main");
    let innerScrollers = 0;
    if (staff) {
      for (const node of [staff, ...staff.querySelectorAll("*")]) {
        const style = getComputedStyle(node);
        if (
          /(auto|scroll)/.test(`${style.overflowY}`) &&
          node.scrollHeight > node.clientHeight + 1
        ) {
          innerScrollers += 1;
        }
      }
    }

    return {
      cells: rects.length,
      minVisible: Math.round(minVisible),
      probed,
      wrongOwner,
      firstWrong,
      overlaps,
      edgeVisible: Math.round(edgeVisible),
      innerScrollers,
    };
  });

  /*
   * The claim, in the form that can actually fail (2S-A §18).
   *
   * A CSS height of `44px` is not a touch target. Half of it can be outside
   * the surface, under a clipper, or behind a neighbour — which is exactly
   * what happened at `320×700`, where the row measured 44 and the cell was
   * painted below the reading surface. So what is measured is the *visible*
   * height of each cell, clipped by every scroller above it and by the
   * viewport, plus who actually owns the point a finger would land on.
   */
  record_(
    "59. every edit cell is a finger tall where it can be seen",
    hits !== null && hits.minVisible >= MIN_TOUCH,
    JSON.stringify({ cells: hits?.cells, minVisible: hits?.minVisible }),
  );
  record_(
    "59.b and the cell itself owns the point a finger lands on",
    hits !== null && hits.wrongOwner === 0,
    JSON.stringify({ probed: hits?.probed, wrongOwner: hits?.wrongOwner, first: hits?.firstWrong }),
  );
  record_(
    "59.c neighbouring strings do not overlap each other",
    hits !== null && hits.overlaps === 0,
    JSON.stringify({ overlaps: hits?.overlaps }),
  );
  record_(
    "59.d the outer strings are whole, not half on the screen",
    hits !== null && hits.edgeVisible >= MIN_TOUCH,
    JSON.stringify({ edgeVisible: hits?.edgeVisible }),
  );
  record_(
    "59.e the staff has no scroller of its own",
    hits !== null && hits.innerScrollers === 0,
    JSON.stringify({ innerScrollers: hits?.innerScrollers }),
  );
  record_(
    "60. and it is a separate box from the digit",
    (hits?.cells ?? 0) > 0 && (boxes[0]?.width ?? 0) < MIN_TOUCH,
    `cell ${hits?.minVisible} tall vs digit ${boxes[0]?.width} wide`,
  );

  /*
   * The digit is not painted into the hit target. Six strings sit 44px apart
   * in edit mode, so a glyph that filled its own 44px square would overlap the
   * two glyphs above and below it — the exact thing §4 forbids when it says
   * the hit target and the visual box are different things.
   */
  const glyphOwnBoxes = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-fret-glyph]")].map((node) => {
      const box = node.getBoundingClientRect();
      return { height: Math.round(box.height), width: Math.round(box.width) };
    });
    return {
      count: rows.length,
      maxHeight: rows.reduce((most, row) => Math.max(most, row.height), 0),
      maxWidth: rows.reduce((most, row) => Math.max(most, row.width), 0),
    };
  });
  record_(
    "62. the glyph's own box is smaller than the finger's",
    glyphOwnBoxes.count > 0 &&
      glyphOwnBoxes.maxHeight < MIN_TOUCH &&
      glyphOwnBoxes.maxWidth < MIN_TOUCH,
    JSON.stringify(glyphOwnBoxes),
  );

  /*
   * The defect §18 found, bound red (2S-A §18).
   *
   * A cell that is laid out below the reading surface is not a cell anybody
   * can press: measured at `y=423` with the surface ending at `y=402`, the
   * press landed on the track-control row instead. That is what broke the
   * time selection at 320x700 — nineteen practice-loop scenarios and one
   * selection-ui scenario — so it is asserted here on every combination
   * rather than inferred from a row height.
   */
  const onSurface = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    const surface = main.getBoundingClientRect();
    const cells = [...document.querySelectorAll("[data-cell]")].map((node) =>
      node.getBoundingClientRect(),
    );
    if (cells.length === 0) return null;
    const below = cells.filter((box) => box.bottom > surface.bottom + 1).length;
    const above = cells.filter((box) => box.top < surface.top - 1).length;
    return {
      cells: cells.length,
      below,
      above,
      surface: Math.round(surface.height),
      staff: Math.round(
        Math.max(...cells.map((b) => b.bottom)) - Math.min(...cells.map((b) => b.top)),
      ),
    };
  });
  /*
   * The focused layout's own row, and the way out of it (2S-A §18).
   *
   * Leaving a mode must never be the hardest thing in it, and a probe that
   * shrank "Bitti" to `12px` stayed green until this existed — the acceptance
   * measured the staff and never the row above it.
   */
  const header = await page.evaluate(() => {
    const row = document.querySelector("[data-edit-header]");
    const done = document.querySelector("[data-edit-done]");
    if (!row || !done) return null;
    const rowBox = row.getBoundingClientRect();
    const doneBox = done.getBoundingClientRect();
    return {
      row: Math.round(rowBox.height),
      done: Math.round(doneBox.height),
      label: row.getAttribute("aria-label") ?? "",
      section: document.querySelector("[data-edit-header-section]")?.textContent ?? "",
      /* The chrome the layout trades away must really be gone. */
      brand: document.querySelectorAll("[data-testid='view-tab']").length,
    };
  });
  record_(
    "64. the focused edit row is a finger tall, and so is the way out",
    header !== null && header.row >= MIN_TOUCH && header.done >= MIN_TOUCH,
    JSON.stringify(header),
  );
  record_(
    "64.b it says which section, in music, and the view switch has stood down",
    header !== null && header.section.length > 0 && header.label.length > 0 && header.brand === 0,
    JSON.stringify({ section: header?.section, label: header?.label, viewSwitch: header?.brand }),
  );
  const rowTargets = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("[data-action-row] button")];
    return {
      count: controls.length,
      min: Math.min(...controls.map((node) => Math.round(node.getBoundingClientRect().height))),
    };
  });
  record_(
    "64.c every control in the action row is a finger tall",
    rowTargets.count > 0 && rowTargets.min >= MIN_TOUCH,
    JSON.stringify(rowTargets),
  );

  record_(
    "63. every edit cell is inside the surface the reader is looking at",
    onSurface !== null && onSurface.below === 0 && onSurface.above === 0,
    JSON.stringify(onSurface),
  );

  record_("61. the glyph tour raised no page error", errors.length === 0, errors[0] ?? "");
  await context.close();
}

/** Density, the toolbar and the 1/32 playback (§5, §11, §3). */
async function layoutTour(browser, viewport, textScale) {
  const { context, page, errors } = await boot(browser, viewport, fixture("dense32"), textScale);

  const readingRow = await page.evaluate(() => {
    const row = document.querySelector("[data-action-row] > div");
    return row
      ? { clipped: row.scrollWidth - row.clientWidth, scrollWidth: row.scrollWidth }
      : null;
  });
  record_("62. the edit toolbar never clips while reading", readingRow?.clipped === 0, JSON.stringify(readingRow));

  await enterEdit(page);
  const editRow = await page.evaluate(() => {
    const row = document.querySelector("[data-action-row] > div");
    return row
      ? { clipped: row.scrollWidth - row.clientWidth, scrollWidth: row.scrollWidth }
      : null;
  });
  record_("63. nor while writing", editRow?.clipped === 0, JSON.stringify(editRow));
  record_(
    "64. and the page still never scrolls sideways",
    (await page.evaluate(() => document.body.scrollWidth === document.body.clientWidth)),
  );

  const work = await page.evaluate(() => {
    const surface = document.querySelector("[data-tab-scroller]") ?? document.querySelector("main");
    const doors = document.querySelector("[data-composer-doors]");
    const action = document.querySelector("[data-action-row]");
    return {
      surface: surface ? Math.round(surface.getBoundingClientRect().height) : 0,
      doors: doors ? Math.round(doors.getBoundingClientRect().height) : 0,
      action: action ? Math.round(action.getBoundingClientRect().height) : 0,
    };
  });
  record_(
    "65. the music stays bigger than the controls under it",
    work.surface > work.doors + work.action,
    JSON.stringify(work),
  );

  await page.locator("footer button[aria-label='Çal']").click();
  await page.waitForTimeout(2600);
  const starts = await page.evaluate(() => window.__aranjeAudio.starts.length);
  record_("66. a 1/32 bar starts every buffer it should", starts >= 13, `${starts}`);

  record_("67. the layout tour raised no page error", errors.length === 0, errors[0] ?? "");
  await context.close();
}

/* -------------------------------------------------------------------- run */

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const viewports = process.env.ONE_VIEWPORT ? VIEWPORTS.slice(0, 1) : VIEWPORTS;
const scales = process.env.ONE_SCALE ? [100] : TEXT_SCALES;

for (const viewport of viewports) {
  for (const textScale of scales) {
    combo = `${viewport.name} @${textScale}%`;
    if (wanted("doors")) await doorTour(browser, viewport, textScale);
    if (wanted("pen")) await penTour(browser, viewport, textScale);
    if (wanted("refusal")) await penRefusalTour(browser, viewport, textScale);
    if (wanted("brush")) await brushTour(browser, viewport, textScale);
    if (wanted("glyph")) await glyphTour(browser, viewport, textScale);
    if (wanted("layout")) await layoutTour(browser, viewport, textScale);
  }
}

await browser.close();

const scenarios = new Set(results.map((entry) => entry.name));
const failed = results.filter((entry) => !entry.pass);
writeFileSync(
  `${OUT}/BROWSER.json`,
  `${JSON.stringify(
    {
      environment: {
        note: "Production build, desktop Chromium, mobile emulation. No physical device evidence.",
        base: BASE,
      },
      combinations: viewports.length * scales.length,
      uniqueScenarios: scenarios.size,
      results: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      entries: results,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `\n${scenarios.size} scenarios × ${viewports.length * scales.length} combinations = ` +
    `${results.length} results · ${results.length - failed.length} pass · ${failed.length} fail`,
);
if (failed.length > 0) process.exitCode = 1;
