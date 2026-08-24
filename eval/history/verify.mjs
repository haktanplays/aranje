/**
 * Faz 2K-A browser verification.
 *
 * Sixteen scenarios about a thing that only exists while the app is running:
 * a session's edit history. A unit test can prove the reducer walks a list
 * correctly; only the real app can show that the tab and the arrangement are
 * walking the *same* list, that a ghost left no step behind, that a keystroke
 * inside a text field went to the text field, and that the transport did not
 * come back on by itself after the music under it changed.
 *
 * Instrumented before any app code runs:
 *
 * - `Storage.prototype.setItem`, so "one write" is a count.
 * - `AudioContext`, so "no second engine" is a count.
 * - console and page errors, collected rather than sampled.
 *
 * `node eval/history/verify.mjs`
 */
import { chromium } from "playwright";
import { press, reveal } from "../shared/harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deviceWith, readActiveSong } from "../shared/project-storage.mjs";
/*
 * 2Q-B §1.3: the seed is a project device and the song is read back out of
 * the project record. Seeding `aranje.song` sent every run through the
 * legacy migration first, and counting writes on that key counted a key the
 * product has not used since K-52.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.HISTORY_OUT ?? "eval/history/artifacts";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/bar-ops/fixture-song.json", "utf8").trim();

const results = [];
const measurements = {};

function flush() {
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      { results, measurements, failed: results.filter((e) => !e.pass).length },
      null,
      2,
    )}\n`,
  );
}

const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  flush();
};

let lastPage = null;

async function safe(name, fn) {
  try {
    return await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 90);
    const state = await lastPage
      ?.evaluate(() => ({
        undo: document.querySelector("[data-undo]")?.getAttribute("aria-label"),
        redo: document.querySelector("[data-redo]")?.getAttribute("aria-label"),
        sheet: document.querySelectorAll("[role=dialog]").length,
        actionBar: document.querySelectorAll("[data-bar-action-bar]").length,
      }))
      .catch(() => null);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${name.split(" ")[0]}.png` })
      .catch(() => {});
    record(name, false, `${first} :: ${JSON.stringify(state)}`);
    return undefined;
  }
}

const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key.indexOf("aranje.project.") === 0) window.__writes += 1;
    return originalSet.call(this, key, value);
  };
  window.__audioContexts = 0;
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args) {
        window.__audioContexts += 1;
        return Reflect.construct(target, args);
      },
    });
  }
`;

async function openApp(browser, size = { width: 390, height: 844 }) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  /*
   * The fixture goes in *before* the counter is wrapped, so seeding the song
   * is not counted as an edit. Instrumenting first made every run start at
   * one write, which is the harness measuring itself.
   */
  await context.addInitScript(
    (entries) => {
      try {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      } catch {
        /* a private window is not a reason to fail the run */
      }
    },
    Object.entries(deviceWith(JSON.parse(FIXTURE))),
  );
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(6000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((t) => window.__consoleErrors.push(t), message.text()).catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((t) => window.__consoleErrors.push(t), String(error)).catch(() => {});
  });
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

/* --------------------------------------------------------------- gestures */



/* ----------------------------------------------------------------- probes */

const writes = (page) => page.evaluate(() => window.__writes);
const contexts = (page) => page.evaluate(() => window.__audioContexts ?? 0);
const errors = (page) => page.evaluate(() => window.__consoleErrors ?? []);
const storedSong = async (page) =>
  readActiveSong(page);
const debugPosition = (page) =>
  page.evaluate(() => window.__aranjeDebug?.position() ?? null);
const debugLoop = (page) => page.evaluate(() => window.__aranjeDebug?.loop() ?? null);
const status = (page) => page.evaluate(() => window.__aranjeDebug?.status() ?? null);

/** What the two history controls say, and whether they can be pressed. */
const historyState = (page) =>
  page.evaluate(() => {
    const undo = document.querySelector("[data-undo]");
    const redo = document.querySelector("[data-redo]");
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    };
    return {
      undoLabel: undo?.getAttribute("aria-label") ?? null,
      redoLabel: redo?.getAttribute("aria-label") ?? null,
      canUndo: undo ? !undo.disabled : false,
      canRedo: redo ? !redo.disabled : false,
      undoBox: box(undo),
      redoBox: box(redo),
    };
  });

const clickUndo = async (page) => {
  await page.locator("[data-undo]").click();
  await page.waitForTimeout(400);
};
const clickRedo = async (page) => {
  await page.locator("[data-redo]").click();
  await page.waitForTimeout(400);
};

const cell = (trackId, barKey) => `[data-arr-cell='${trackId}|${barKey}']`;
const barHeader = (barKey) => `[data-arr-bar='${barKey}']`;

async function closeSheet(page) {
  const close = page.locator("[role=dialog] [aria-label=Kapat]");
  if (await close.count()) await close.first().click();
  await page.waitForTimeout(300);
}

async function clearBarSelection(page) {
  await closeSheet(page);
  const cancel = page.locator("[data-bar-action-bar] [aria-label='Ölçü seçimini iptal et']");
  if (await cancel.count()) await cancel.first().click();
  await page.waitForTimeout(200);
}

/** Delete one track's bar, all the way to committed. */
async function deleteTrackBar(page, cdp, barKey = "intro:0") {
  await clearBarSelection(page);
  await press(page, cdp, cell("rhythm", barKey));
  await page.locator("[data-bar-action=delete]").click();
  await page.waitForTimeout(300);
  await page.locator("[data-bar-apply]").click();
  await page.waitForTimeout(500);
}

/** Delete a whole bar, all the way to committed. */
async function deleteFullBar(page, cdp, barKey = "intro:1") {
  await clearBarSelection(page);
  await press(page, cdp, barHeader(barKey));
  await page.locator("[data-bar-action=delete]").click();
  await page.waitForTimeout(300);
  await page.locator("[data-bar-apply]").click();
  await page.waitForTimeout(600);
}

const barCount = async (page, sectionId) => {
  const song = await storedSong(page);
  return song?.sections.find((s) => s.id === sectionId)?.bars.length ?? -1;
};

/* -------------------------------------------------------------- scenarios */

async function run() {
  const browser = await chromium.launch();

  for (const [label, size] of [
    ["390x844", { width: 390, height: 844 }],
    ["320x700", { width: 320, height: 700 }],
  ]) {
    const { context, page, cdp } = await openApp(browser, size);
    const at = (name) => `${name} @${label}`;

    // ------------------------------------------------------------------ 1
    await safe(at("1 nothing to undo at the start"), async () => {
      const state = await historyState(page);
      record(
        at("1 nothing to undo at the start"),
        state.canUndo === false &&
          state.canRedo === false &&
          state.undoLabel === "Geri al" &&
          state.redoLabel === "Yinele" &&
          (await writes(page)) === 0,
        `${state.undoLabel} / ${state.redoLabel}, writes ${await writes(page)}`,
      );
    });

    // ------------------------------------------------------------------ 2
    await safe(at("2 a track-bar delete undoes and redoes"), async () => {
      const before = JSON.stringify(await storedSong(page));
      const writesBefore = await writes(page);
      await deleteTrackBar(page, cdp);
      const afterEdit = JSON.stringify(await storedSong(page));
      const state = await historyState(page);

      await clickUndo(page);
      const afterUndo = JSON.stringify(await storedSong(page));
      await clickRedo(page);
      const afterRedo = JSON.stringify(await storedSong(page));

      record(
        at("2 a track-bar delete undoes and redoes"),
        afterEdit !== before &&
          afterUndo === before &&
          afterRedo === afterEdit &&
          state.undoLabel === "Geri al: Track içeriğini silme" &&
          (await writes(page)) === writesBefore + 3,
        `${state.undoLabel}, writes +${(await writes(page)) - writesBefore}`,
      );
    });

    // ------------------------------------------------------------------ 3
    await safe(at("3 a full-bar delete undoes and redoes"), async () => {
      const bars = await barCount(page, "intro");
      await deleteFullBar(page, cdp);
      const afterEdit = await barCount(page, "intro");
      const state = await historyState(page);
      await clickUndo(page);
      const afterUndo = await barCount(page, "intro");
      await clickRedo(page);
      const afterRedo = await barCount(page, "intro");
      record(
        at("3 a full-bar delete undoes and redoes"),
        afterEdit === bars - 1 &&
          afterUndo === bars &&
          afterRedo === bars - 1 &&
          state.undoLabel === "Geri al: Ölçüleri silme",
        `${bars} -> ${afterEdit} -> ${afterUndo} -> ${afterRedo}, ${state.undoLabel}`,
      );
    });

    // ------------------------------------------------------------------ 4
    await safe(at("4 three edits undo and redo in order"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      const start = JSON.stringify(await storedSong(p));
      await deleteTrackBar(p, d, "intro:0");
      const one = JSON.stringify(await storedSong(p));
      await deleteTrackBar(p, d, "intro:3");
      const two = JSON.stringify(await storedSong(p));
      await deleteFullBar(p, d, "intro:4");
      const three = JSON.stringify(await storedSong(p));

      await clickUndo(p);
      const backOne = JSON.stringify(await storedSong(p));
      await clickUndo(p);
      const backTwo = JSON.stringify(await storedSong(p));
      await clickUndo(p);
      const backThree = JSON.stringify(await storedSong(p));
      const atStart = await historyState(p);

      await clickRedo(p);
      await clickRedo(p);
      await clickRedo(p);
      const forward = JSON.stringify(await storedSong(p));

      record(
        at("4 three edits undo and redo in order"),
        backOne === two &&
          backTwo === one &&
          backThree === start &&
          atStart.canUndo === false &&
          forward === three,
        `back to start=${backThree === start}, forward=${forward === three}`,
      );
      await c.close();
      lastPage = page;
    });

    // ------------------------------------------------------------------ 5
    await safe(at("5 an edit after two undos drops the redo branch"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await deleteTrackBar(p, d, "intro:0");
      await deleteTrackBar(p, d, "intro:3");
      await deleteFullBar(p, d, "intro:4");
      await clickUndo(p);
      await clickUndo(p);
      const hadRedo = (await historyState(p)).canRedo;

      await deleteTrackBar(p, d, "chorus:1");
      const state = await historyState(p);
      record(
        at("5 an edit after two undos drops the redo branch"),
        hadRedo === true && state.canRedo === false && state.canUndo === true,
        `redo before=${hadRedo} after=${state.canRedo}`,
      );
      await c.close();
      lastPage = page;
    });

    // ------------------------------------------------------------------ 6
    await safe(at("6 a ghost leaves no step behind"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await deleteTrackBar(p, d, "intro:0");
      const before = { ...(await historyState(p)), writes: await writes(p) };

      await clearBarSelection(p);
      await press(p, d, barHeader("intro:2"));
      await p.locator("[data-bar-action=delete]").click();
      await p.waitForTimeout(400);
      const ghostShown = (await p.locator("[data-bar-preview]").count()) === 1;
      await p.locator("[data-bar-action-bar] button", { hasText: "Vazgeç" }).click();
      await p.waitForTimeout(300);

      const after = { ...(await historyState(p)), writes: await writes(p) };
      record(
        at("6 a ghost leaves no step behind"),
        ghostShown &&
          after.writes === before.writes &&
          after.undoLabel === before.undoLabel &&
          after.canRedo === before.canRedo,
        `ghost=${ghostShown}, writes ${before.writes}->${after.writes}`,
      );
      await c.close();
      lastPage = page;
    });

    // ------------------------------------------------------------------ 7
    await safe(at("7 a refused edit leaves no step behind"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await deleteTrackBar(p, d, "intro:0");
      const before = { ...(await historyState(p)), writes: await writes(p) };

      // The triplet bar onto an eighth-note bar: refused, never rounded.
      await clearBarSelection(p);
      await press(p, d, cell("rhythm", "intro:2"));
      await p.locator("[data-bar-action=copy]").click();
      await p.waitForTimeout(300);
      await clearBarSelection(p);
      await press(p, d, cell("rhythm", "intro:4"));
      await p.locator("[data-bar-action=more]").click();
      await p.waitForTimeout(300);
      await p.locator("[role=dialog] button", { hasText: "Buraya yapıştır" }).click();
      await p.waitForTimeout(400);
      const refused = await p
        .locator("[data-bar-preview]")
        .textContent()
        .catch(() => null);
      const applyDisabled = await p.locator("[data-bar-apply]").isDisabled();

      const after = { ...(await historyState(p)), writes: await writes(p) };
      record(
        at("7 a refused edit leaves no step behind"),
        /tam oturmuyor/.test(refused ?? "") &&
          applyDisabled &&
          after.writes === before.writes &&
          after.undoLabel === before.undoLabel,
        `refused="${(refused ?? "").slice(0, 40)}", writes ${before.writes}->${after.writes}`,
      );
      await c.close();
      lastPage = page;
    });

    // ------------------------------------------------------------------ 8
    await safe(at("8 the surfaces share one history"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await deleteFullBar(p, d, "intro:1");
      const inArrange = await historyState(p);

      await p.locator("[data-testid=view-tab]").click();
      await p.waitForTimeout(400);
      const inTab = await historyState(p);

      await clickUndo(p);
      const afterUndoInTab = await barCount(p, "intro");
      await p.locator("[data-testid=view-arrange]").click();
      await p.waitForTimeout(400);
      const stillThere = await historyState(p);

      record(
        at("8 the surfaces share one history"),
        inTab.undoLabel === inArrange.undoLabel &&
          inTab.canUndo === true &&
          afterUndoInTab === 5 &&
          stillThere.canRedo === true,
        `arrange="${inArrange.undoLabel}" tab="${inTab.undoLabel}" redoAfter=${stillThere.canRedo}`,
      );
      await c.close();
      lastPage = page;
    });

    // ------------------------------------------------------------------ 9
    await safe(at("9 undo puts the editing surfaces down"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await deleteFullBar(p, d, "intro:1");
      // Hold a selection, then undo with it on screen.
      await press(p, d, barHeader("intro:2"));
      const held = await p.locator("[data-bar-action-bar]").count();
      await clickUndo(p);
      const afterBar = await p.locator("[data-bar-action-bar]").count();
      const afterGhost = await p.locator("[data-bar-preview]").count();
      record(
        at("9 undo puts the editing surfaces down"),
        held === 1 && afterBar === 0 && afterGhost === 0,
        `selection ${held} -> ${afterBar}`,
      );
      await c.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 10
    await safe(at("10 the clipboard survives an undo"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await press(p, d, cell("rhythm", "intro:0"));
      await p.locator("[data-bar-action=copy]").click();
      await p.waitForTimeout(300);
      await deleteTrackBar(p, d, "intro:3");
      await clickUndo(p);

      // Still offered, which is only true if the clipboard is still there.
      await clearBarSelection(p);
      await press(p, d, cell("rhythm", "intro:1"));
      await p.locator("[data-bar-action=more]").click();
      await p.waitForTimeout(400);
      const body = await p.locator("[role=dialog]").innerText();
      record(
        at("10 the clipboard survives an undo"),
        /Buraya yapıştır/.test(body),
        body.replace(/\n/g, " | ").slice(0, 60),
      );
      await c.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 11
    await safe(at("11 storage and the screen agree after undo and redo"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await deleteFullBar(p, d, "intro:1");
      await clickUndo(p);
      const undoneStored = await barCount(p, "intro");
      const undoneShown = await p.locator("[data-arr-bar]").count();
      await clickRedo(p);
      const redoneStored = await barCount(p, "intro");
      const redoneShown = await p.locator("[data-arr-bar]").count();
      record(
        at("11 storage and the screen agree after undo and redo"),
        // The fixture has three sections; the strip draws every bar of all of
        // them, so the totals move together with the section that changed.
        undoneShown - redoneShown === 1 &&
          undoneStored - redoneStored === 1,
        `stored ${undoneStored}->${redoneStored}, drawn ${undoneShown}->${redoneShown}`,
      );
      await c.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 12
    await safe(at("12 playing stops for a structural edit and does not resume"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await p.locator("[aria-label=Çal]").first().click();
      await p.waitForTimeout(1100);
      const playing = await status(p);
      const built = await contexts(p);

      await deleteFullBar(p, d, "intro:1");
      const afterEdit = await status(p);
      await clickUndo(p);
      const afterUndo = await status(p);
      const contextsAfter = await contexts(p);

      measurements[`audioContexts-${label}`] = { built, after: contextsAfter };
      record(
        at("12 playing stops for a structural edit and does not resume"),
        playing === "playing" &&
          afterEdit !== "playing" &&
          afterUndo !== "playing" &&
          contextsAfter === built,
        `${playing} -> ${afterEdit} -> ${afterUndo}, contexts ${built} -> ${contextsAfter}`,
      );
      await c.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 13
    await safe(at("13 the playhead stays on a bar that exists"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      // Put the transport in the section that is about to lose a bar, on the
      // last bar of it — the one an unclamped index would fall off.
      await reveal(p, barHeader("intro:4"));
      await p.locator(barHeader("intro:4")).click();
      await p.waitForTimeout(300);
      await p.locator("[aria-label=Çal]").first().click();
      await p.waitForTimeout(800);
      const before = await debugPosition(p);
      await p.locator("[aria-label=Duraklat]").first().click();
      await p.waitForTimeout(300);

      await deleteFullBar(p, d, "intro:4");
      await p.locator("[aria-label=Çal]").first().click();
      await p.waitForTimeout(500);
      const after = await debugPosition(p);
      const song = await storedSong(p);
      const keys = new Set(
        song.sections.flatMap((s) => s.bars.map((_, i) => `${s.id}:${i}`)),
      );
      measurements[`playhead-${label}`] = { before, after };
      record(
        at("13 the playhead stays on a bar that exists"),
        before?.barKey === "intro:4" &&
          after?.barKey != null &&
          keys.has(after.barKey) &&
          /*
           * The clamp, exactly: Giriş had five bars and the playhead was on
           * the last one, which has just been removed — so the nearest bar it
           * still has is the new last one. "Somewhere in Giriş" would not do
           * as a check, because a transport that lost its place entirely
           * would be sitting on Giriş bar one and pass it.
           */
          after.barKey === "intro:3",
        `${before?.barKey} -> ${after?.barKey}`,
      );
      await c.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 14
    await safe(at("14 a loop survives an edit that leaves it intact"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await reveal(p, barHeader("intro:0"));
      await p.locator(barHeader("intro:0")).click();
      await p.waitForTimeout(300);
      await p.locator("[aria-label='Bölüm döngüsü']").first().click();
      await p.waitForTimeout(200);
      await p.locator("[aria-label=Çal]").first().click();
      await p.waitForTimeout(900);
      const before = await debugLoop(p);
      await p.locator("[aria-label=Duraklat]").first().click();
      await p.waitForTimeout(300);

      await deleteFullBar(p, d, "intro:1");
      await p.locator("[aria-label=Çal]").first().click();
      await p.waitForTimeout(700);
      const after = await debugLoop(p);
      measurements[`loop-${label}`] = { before, after };
      record(
        at("14 a loop survives an edit that leaves it intact"),
        before?.on === true &&
          after?.on === true &&
          // Its end moved, because the section is one bar shorter now.
          after.endTicks < before.endTicks &&
          after.startTicks === before.startTicks,
        `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      );
      await c.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 15
    await safe(at("15 keyboard undo and redo"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      const start = JSON.stringify(await storedSong(p));
      await deleteTrackBar(p, d, "intro:0");
      const edited = JSON.stringify(await storedSong(p));

      await p.keyboard.press("Control+z");
      await p.waitForTimeout(400);
      const undone = JSON.stringify(await storedSong(p));
      await p.keyboard.press("Control+Shift+z");
      await p.waitForTimeout(400);
      const redoneShift = JSON.stringify(await storedSong(p));
      await p.keyboard.press("Control+z");
      await p.waitForTimeout(400);
      await p.keyboard.press("Control+y");
      await p.waitForTimeout(400);
      const redoneY = JSON.stringify(await storedSong(p));

      record(
        at("15 keyboard undo and redo"),
        undone === start && redoneShift === edited && redoneY === edited,
        `ctrl+z=${undone === start} shift=${redoneShift === edited} ctrl+y=${redoneY === edited}`,
      );
      await c.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 16
    await safe(at("16 a shortcut inside a text field is the field's"), async () => {
      const { context: c, page: p, cdp: d } = await openApp(browser, size);
      await deleteTrackBar(p, d, "intro:0");
      const edited = JSON.stringify(await storedSong(p));

      // The Copilot sheet carries the one text field on this screen.
      await p.locator("text=Aranje et").first().click();
      await p.waitForTimeout(600);
      const field = p.locator("[role=dialog] textarea, [role=dialog] input[type=text]").first();
      const hasField = (await field.count()) > 0;
      if (hasField) {
        await field.click();
        await field.type("deneme");
        await p.keyboard.press("Control+z");
        await p.waitForTimeout(400);
      }
      const afterTyping = JSON.stringify(await storedSong(p));
      record(
        at("16 a shortcut inside a text field is the field's"),
        hasField && afterTyping === edited,
        `field=${hasField}, song untouched=${afterTyping === edited}`,
      );
      await c.close();
      lastPage = page;
    });

    // --------------------------------------------------------- geometry
    await safe(at("17 both controls are real targets"), async () => {
      const state = await historyState(page);
      const layout = await page.evaluate(() => {
        const scrollers = [...document.querySelectorAll("*")].filter(
          (node) =>
            node.scrollWidth > node.clientWidth + 1 &&
            ["auto", "scroll"].includes(getComputedStyle(node).overflowX),
        );
        return {
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          scrollers: scrollers.length,
        };
      });
      measurements[`layout-${label}`] = { ...layout, ...state };
      record(
        at("17 both controls are real targets"),
        (state.undoBox?.h ?? 0) >= 43.5 &&
          (state.undoBox?.w ?? 0) >= 43.5 &&
          (state.redoBox?.h ?? 0) >= 43.5 &&
          (state.redoBox?.w ?? 0) >= 43.5 &&
          layout.bodyOverflow === 0 &&
          layout.scrollers === 1,
        `undo ${JSON.stringify(state.undoBox)} redo ${JSON.stringify(state.redoBox)}, overflow ${layout.bodyOverflow}, scrollers ${layout.scrollers}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-history.png` });
    });

    const consoleErrors = await errors(page);
    record(
      at("console stayed quiet"),
      consoleErrors.length === 0,
      consoleErrors.slice(0, 2).join(" | ").slice(0, 100),
    );

    await context.close();
  }

  await browser.close();
  const failed = results.filter((entry) => !entry.pass).length;
  console.log(`\n${results.length - failed}/${results.length} pass`);
  flush();
  process.exit(failed === 0 ? 0 : 1);
}

await run();
