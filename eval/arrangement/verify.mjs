/**
 * Faz 2J browser verification.
 *
 * The seventeen scenarios that cannot be answered from a unit test, because
 * every one of them is about something that only exists once the app is
 * running: which engine is playing, which scroller is live, what a tap seeks
 * to, whether a pending edit survived a view change.
 *
 * Three things are instrumented before a line of app code runs:
 *
 * - `Storage.prototype.setItem`, so "this never writes" is a count and not an
 *   impression of one.
 * - `AudioContext`, so "the view switch does not rebuild the engine" is a
 *   count of how many were ever constructed, rather than a guess from the fact
 *   that sound kept coming out.
 * - console and page errors, collected rather than sampled.
 *
 * `node eval/arrangement/verify.mjs`
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { activeSongBytes, deviceWith } from "../shared/project-storage.mjs";
/*
 * 2Q-B §1.3: the seed is a project device and the song is read back out of
 * the project record. Seeding `aranje.song` sent every run through the
 * legacy migration first, and counting writes on that key counted a key the
 * product has not used since K-52.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.ARRANGEMENT_OUT ?? "eval/arrangement/artifacts";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/arrangement/fixture-song.json", "utf8").trim();

const results = [];
const measurements = {};

function flush() {
  const failed = results.filter((entry) => !entry.pass);
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify({ results, measurements, failed: failed.length }, null, 2)}\n`,
  );
}

const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  flush();
};

/** One scenario may fail without taking the rest of the run down with it. */
async function safe(name, fn) {
  try {
    return await fn();
  } catch (error) {
    record(name, false, String(error).split("\n")[0].slice(0, 90));
    return undefined;
  }
}

const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key && String(key).includes("aranje")) window.__writes += 1;
    return originalSet.call(this, key, value);
  };
  /*
   * How many audio engines this page has ever built. One is correct for a
   * whole session however many times the view is switched; two would mean the
   * transport was torn down and rebuilt behind the reader's back.
   */
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

async function openApp(browser, size) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(INSTRUMENT);
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
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page
        .evaluate((text) => window.__consoleErrors.push(text), message.text())
        .catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page
      .evaluate((text) => window.__consoleErrors.push(text), String(error))
      .catch(() => {});
  });
  // `?debug=1` exposes the transport's own clock, which is how a seek is
  // checked against the tick it was supposed to land on.
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  return { context, page };
}

const writes = (page) => page.evaluate(() => window.__writes);
const contexts = (page) => page.evaluate(() => window.__audioContexts ?? 0);
const songJson = (page) => activeSongBytes(page);
const debugTicks = (page) =>
  page.evaluate(() => window.__aranjeDebug?.ticks() ?? null);
const debugPosition = (page) =>
  page.evaluate(() => window.__aranjeDebug?.position() ?? null);

const arrangeScroller = (page) => page.locator("[data-arrangement-scroller]");
const inArrange = (page) =>
  page
    .locator("[data-testid=view-arrange]")
    .getAttribute("aria-selected")
    .then((value) => value === "true")
    .catch(() => false);

async function goArrange(page) {
  await page.locator("[data-testid=view-arrange]").click();
  await page.waitForTimeout(250);
}

async function goTab(page) {
  await page.locator("[data-testid=view-tab]").click();
  await page.waitForTimeout(250);
}

/** Layout facts that several scenarios ask about. */
const layout = (page) =>
  page.evaluate(() => {
    const scrollers = [...document.querySelectorAll("*")].filter(
      (node) =>
        node.scrollWidth > node.clientWidth + 1 &&
        ["auto", "scroll"].includes(getComputedStyle(node).overflowX),
    );
    const targets = [
      ...document.querySelectorAll(
        "[data-arr-cell], [data-arr-track], [data-arr-section], [data-testid^=view-]",
      ),
    ].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id:
          node.getAttribute("data-arr-cell") ??
          node.getAttribute("data-arr-track") ??
          node.getAttribute("data-arr-section") ??
          node.getAttribute("data-testid"),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    });
    return {
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      scrollers: scrollers.length,
      cells: document.querySelectorAll("[data-arr-cell]").length,
      lanes: document.querySelectorAll("[data-arr-track]").length,
      small: targets.filter((t) => t.w < 43.5 || t.h < 43.5),
      targets: targets.length,
    };
  });

async function run() {
  const browser = await chromium.launch();

  for (const [label, size] of [
    ["390x844", { width: 390, height: 844 }],
    ["320x700", { width: 320, height: 700 }],
  ]) {
    const { context, page } = await openApp(browser, size);
    try {
      // ---------------------------------------------------------------- 19
      record(`[${label}] 19 opens on the arrangement`, await inArrange(page));
      record(
        `[${label}] 19 the tab is not merely hidden`,
        (await page.locator("[data-tab-content]").count()) === 0,
      );

      // ---------------------------------------------------------------- 31
      const first = await layout(page);
      measurements[label] = { ...first, small: first.small.length };
      record(
        `[${label}] 31 renders 32 bars across 8 tracks`,
        first.cells === 256 && first.lanes === 8,
        `${first.cells} cells, ${first.lanes} lanes`,
      );

      // ------------------------------------------------------------ 32, 33
      record(
        `[${label}] 32 no body overflow in Düzen`,
        first.bodyOverflow <= 0,
        `${first.bodyOverflow}px`,
      );
      record(
        `[${label}] 33 one horizontal scroller in Düzen`,
        first.scrollers === 1,
        `${first.scrollers}`,
      );

      // ---------------------------------------------------------------- 34
      record(
        `[${label}] 34 every arrangement target is 44px or more`,
        first.small.length === 0,
        first.small.length
          ? first.small.map((t) => `${t.id} ${t.w}x${t.h}`).slice(0, 3).join(", ")
          : `${first.targets} targets`,
      );

      await page.screenshot({ path: `${OUT}/${label}-arrange.png` });

      // ---------------------------------------------------------------- 21
      // A section header scrolls the view. It does not seek: glancing at the
      // structure must not move the music.
      await safe(`[${label}] 21 a section header only scrolls`, async () => {
        const scroller = arrangeScroller(page);
        await scroller.evaluate((node) => (node.scrollLeft = 0));
        await page.waitForTimeout(120);
        const ticksBefore = await debugTicks(page);
        const beforeWrites = await writes(page);
        await page.locator('[data-arr-section="bridge"]').click();
        await page.waitForTimeout(600);
        const scrolled = await scroller.evaluate((node) => node.scrollLeft);
        record(`[${label}] 21 a section header scrolls`, scrolled > 100, `${Math.round(scrolled)}px`);
        record(
          `[${label}] 21 a section header does not seek`,
          (await debugTicks(page)) === ticksBefore,
          `${ticksBefore} -> ${await debugTicks(page)}`,
        );
        record(
          `[${label}] 21 a section header writes nothing`,
          (await writes(page)) === beforeWrites,
        );
      });

      // ------------------------------------------------------------ 22, 23
      // A bar cell is the one navigation that crosses both surfaces.
      await safe(`[${label}] 22 a bar cell navigates`, async () => {
        const beforeWrites = await writes(page);
        // Bar 3 of the fourth section: a real tick, far from zero, on a track
        // that is not the one currently selected.
        await page
          .locator('[data-arr-cell="lead|outro:2"]')
          .scrollIntoViewIfNeeded();
        await page.locator('[data-arr-cell="lead|outro:2"]').click();
        await page.waitForTimeout(500);

        record(`[${label}] 22 the tap opens the tab`, !(await inArrange(page)));
        /*
         * Against the tick, not against the reported bar.
         *
         * `position()` describes where the *playhead* is, and a stopped
         * transport is not in any bar, so it answers null however well the
         * seek worked. The transport's own clock is the thing the tap is
         * supposed to move: intro and chorus are eight 4/4 bars each (6144
         * ticks apiece) and the bridge is eight 6/8 bars (4608), so the third
         * bar of the final section begins at 18432.
         */
        const OUTRO_BAR_3_TICKS = 6144 + 6144 + 4608 + 2 * 768;
        const ticks = await debugTicks(page);
        record(
          `[${label}] 22 the tap seeks to that bar's tick`,
          ticks === OUTRO_BAR_3_TICKS,
          `${ticks} (want ${OUTRO_BAR_3_TICKS})`,
        );
        /*
         * The active track now has one control that says which it is, rather
         * than a grid of eight where the selected one is marked. Reading the
         * control is reading the same state.
         */
        const activeTrack = await page
          .locator("[data-track-control]")
          .first()
          .innerText()
          .catch(() => "?");
        record(
          `[${label}] 22 the tap activates that track`,
          activeTrack.includes("Solo"),
          activeTrack,
        );
        record(`[${label}] 22 navigation writes nothing`, (await writes(page)) === beforeWrites);

        // ------------------------------------------------------------ 23
        const target = page.locator('[data-bar-key="outro:2"]').first();
        const visible = await target.isVisible().catch(() => false);
        if (!visible) {
          record(`[${label}] 23 the tab scrolled to that bar`, false, "bar not in the tab");
          return;
        }
        const box = await target.boundingBox();
        const viewport = await page.evaluate(() => window.innerWidth);
        record(
          `[${label}] 23 the tab scrolled to that bar`,
          box !== null && box.x > -20 && box.x < viewport,
          `x=${Math.round(box?.x ?? -999)} of ${viewport}`,
        );
      });

      // ------------------------------------------------------------ 32, 33
      const tabLayout = await layout(page);
      record(
        `[${label}] 32 no body overflow in Tab`,
        tabLayout.bodyOverflow <= 0,
        `${tabLayout.bodyOverflow}px`,
      );
      record(
        `[${label}] 33 one horizontal scroller in Tab`,
        tabLayout.scrollers === 1,
        `${tabLayout.scrollers}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-tab.png` });

      // ---------------------------------------------------------------- 20
      // Switching surfaces is a view change, not an audio event.
      await safe(`[${label}] 20 the view switch leaves the engine alone`, async () => {
        await page.locator("[aria-label=Çal]").first().click();
        await page.waitForTimeout(700);
        const built = await contexts(page);
        const ticksBefore = await debugTicks(page);
        await goArrange(page);
        await goTab(page);
        await goArrange(page);
        await page.waitForTimeout(400);
        record(
          `[${label}] 20 no second engine is built`,
          (await contexts(page)) === built,
          `${built} -> ${await contexts(page)}`,
        );
        record(
          `[${label}] 20 playback is not stopped by the switch`,
          (await page.evaluate(() => window.__aranjeDebug?.status())) === "playing",
          await page.evaluate(() => window.__aranjeDebug?.status()),
        );
        record(
          `[${label}] 20 the transport clock keeps running`,
          (await debugTicks(page)) > ticksBefore,
          `${ticksBefore} -> ${await debugTicks(page)}`,
        );
        record(
          `[${label}] 20 practice rate survives the switch`,
          (await page.locator("text=%100").first().isVisible().catch(() => false)),
        );
      });

      // ---------------------------------------------------------------- 24
      await safe(`[${label}] 24 playback moves the active bar`, async () => {
        /*
         * The state attribute, not the class.
         *
         * This used to grep for `bg-steel/10`, which is a styling decision and
         * changed the moment the cell got a ring as well as a tint. What the
         * check is about is which cell the transport is in, and the cell says
         * so in an attribute meant for exactly that.
         */
        const before = await page
          .locator("[data-arr-cell][data-arr-selected]")
          .count();
        await page.waitForTimeout(1600);
        const position = await debugPosition(page);
        const highlighted = await page
          .locator("[data-arr-cell][data-arr-selected]")
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-arr-cell")));
        record(
          `[${label}] 24 the playing bar is marked across the lanes`,
          highlighted.length >= 8 &&
            highlighted.every((id) => id?.endsWith(position?.barKey ?? "!")),
          `${before} -> ${highlighted.length} cells on ${position?.barKey}`,
        );
      });

      // ---------------------------------------------------------------- 25
      // A deliberate scroll outranks the convenience of following the music.
      await safe(`[${label}] 25 a manual scroll is not undone`, async () => {
        const scroller = arrangeScroller(page);
        await scroller.evaluate((node) => (node.scrollLeft = 2200));
        await page.waitForTimeout(1800);
        const after = await scroller.evaluate((node) => node.scrollLeft);
        record(
          `[${label}] 25 the view stays where it was put`,
          Math.abs(after - 2200) < 40,
          `2200 -> ${Math.round(after)}`,
        );
      });

      await page.locator("[aria-label=Duraklat]").first().click().catch(() => {});
      await page.waitForTimeout(300);

      // ---------------------------------------------------------------- 26
      await safe(`[${label}] 26 tapping a track name writes nothing`, async () => {
        const beforeWrites = await writes(page);
        const beforeSong = await songJson(page);
        await page.locator('[data-arr-track="bass"]').click();
        await page.waitForTimeout(300);
        record(
          `[${label}] 26 tapping a track name writes nothing`,
          (await writes(page)) === beforeWrites && (await songJson(page)) === beforeSong,
          `${beforeWrites} -> ${await writes(page)}`,
        );
        record(
          `[${label}] 26 tapping a track name selects it`,
          (await page
            .locator('[data-arr-track="bass"]')
            .getAttribute("aria-pressed")) === "true",
        );
      });

      // -------------------------------------------------------- 27, 28, 29
      // What a selection and a staged command do when the surface changes.
      await safe(`[${label}] 27 leaving for Düzen clears the selection`, async () => {
        await goTab(page);
        const edit = page.getByRole("button", { name: "Düzenle", exact: true });
        if (!(await edit.isVisible().catch(() => false))) {
          record(`[${label}] 27 leaving for Düzen clears the selection`, false, "no edit control");
          return;
        }
        await edit.click();
        await page.waitForTimeout(250);

        const cells = page.locator("[data-cell][data-onset]");
        if ((await cells.count()) === 0) {
          record(`[${label}] 27 leaving for Düzen clears the selection`, false, "no onset");
          return;
        }
        const cell = cells.first();
        await cell.scrollIntoViewIfNeeded();
        const box = await cell.boundingBox();
        if (!box) {
          record(`[${label}] 27 leaving for Düzen clears the selection`, false, "no box");
          return;
        }
        // A real long press: the selection gesture is the one under test.
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
        });
        await page.waitForTimeout(700);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(350);

        const selected = await page
          .locator("[data-testid=time-selection-band]")
          .isVisible()
          .catch(() => false);
        if (!selected) {
          record(`[${label}] 27 leaving for Düzen clears the selection`, false, "no selection made");
          return;
        }

        // 28 — the clipboard is not tied to a surface.
        await page.locator("[data-testid=selection-action-copy]").click();
        await page.waitForTimeout(200);

        // 29 — stage a move but do not apply it.
        await page.locator("[data-testid=selection-action-move]").click();
        await page.waitForSelector("[data-testid=move-mode-time]");
        await page.locator("[data-testid=nudge-right-grid]").click();
        await page.waitForTimeout(200);

        const beforeWrites = await writes(page);
        const beforeSong = await songJson(page);

        await goArrange(page);

        record(
          `[${label}] 27 leaving for Düzen clears the selection`,
          !(await page
            .locator("[data-testid=time-selection-band]")
            .isVisible()
            .catch(() => false)),
        );
        record(
          `[${label}] 29 the staged move is dropped, not committed`,
          (await writes(page)) === beforeWrites && (await songJson(page)) === beforeSong,
          `${beforeWrites} -> ${await writes(page)}`,
        );
        record(
          `[${label}] 29 the sheet is closed`,
          (await page.locator("[role=dialog]").count()) === 0,
        );

        // 28 — back in the tab, the clipboard is still there.
        await goTab(page);
        await page.waitForTimeout(250);
        const cell2 = page.locator("[data-cell][data-onset]").first();
        await cell2.scrollIntoViewIfNeeded();
        const box2 = await cell2.boundingBox();
        if (!box2) {
          record(`[${label}] 28 the clipboard survives the trip`, false, "no box");
          return;
        }
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box2.x + box2.width / 2, y: box2.y + box2.height / 2, id: 1 }],
        });
        await page.waitForTimeout(700);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(350);
        await page.locator("[data-testid=selection-action-more]").click();
        await page.waitForTimeout(250);
        record(
          `[${label}] 28 the clipboard survives the trip`,
          await page
            .getByRole("button", { name: "Yapıştır", exact: true })
            .first()
            .isVisible()
            .catch(() => false),
        );
        await page.getByRole("button", { name: "Vazgeç", exact: true }).first().click().catch(() => {});
        await page.waitForTimeout(200);
      });

      // ---------------------------------------------------------------- 30
      // The arrangement is a function of the song, so an edit has to show in
      // it and an undo has to take it back.
      await safe(`[${label}] 30 undo updates the arrangement`, async () => {
        /*
         * Count the marks, not the labels.
         *
         * A cell's accessible name says which track and bar it is and whether
         * it is silent — none of which changes when one note leaves a bar that
         * still has others. The marks are what is drawn from the notes, so
         * they are what an edit moves.
         */
        const marks = () =>
          page
            .locator("[data-arr-cell]")
            .evaluateAll((nodes) =>
              nodes.reduce((sum, node) => sum + node.querySelectorAll("span[aria-hidden]").length, 0),
            );

        await goArrange(page);
        const before = await marks();

        await goTab(page);
        await page.waitForTimeout(250);
        const cells = page.locator("[data-cell][data-onset]");
        if ((await cells.count()) === 0) {
          record(`[${label}] 30 undo updates the arrangement`, false, "no onset to edit");
          return;
        }
        const cell = cells.first();
        await cell.scrollIntoViewIfNeeded();
        const box = await cell.boundingBox();
        if (!box) {
          record(`[${label}] 30 undo updates the arrangement`, false, "no box");
          return;
        }
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
        });
        await page.waitForTimeout(700);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(350);

        const del = page.locator("[data-testid=selection-action-delete]");
        if (!(await del.isEnabled().catch(() => false))) {
          record(`[${label}] 30 undo updates the arrangement`, false, "no delete control");
          return;
        }
        const songBefore = await songJson(page);
        await del.click();
        await page.waitForTimeout(450);
        const songAfter = await songJson(page);
        record(
          `[${label}] 30 the edit reached the song`,
          songAfter !== songBefore,
        );

        await goArrange(page);
        const afterEdit = await marks();
        record(
          `[${label}] 30 an edit changes the arrangement`,
          afterEdit < before,
          `${before} -> ${afterEdit} marks`,
        );

        const undo = /*
         * The undo control is found by its role attribute, not by a fixed
         * accessible name. K-44 made that name say *what* would be undone
         * ("Geri al: Nota düzenleme"), so the old exact-name lookup matched
         * nothing and reported the control as missing.
         */
        page.locator("[data-undo]").first();
        if (!(await undo.isEnabled().catch(() => false))) {
          record(
            `[${label}] 30 undo updates the arrangement`,
            false,
            `undo not usable (visible=${await undo.isVisible().catch(() => false)})`,
          );
          return;
        }
        await undo.click();
        await page.waitForTimeout(450);
        record(
          `[${label}] 30 undo updates the arrangement`,
          (await marks()) === before && (await songJson(page)) === songBefore,
          `${afterEdit} -> ${await marks()} marks (want ${before})`,
        );
      });

      // ---------------------------------------------------------------- 35
      const errors = await page.evaluate(() => window.__consoleErrors ?? []).catch(() => []);
      record(
        `[${label}] 35 no console or page errors`,
        errors.length === 0,
        errors.slice(0, 2).join(" | "),
      );

      record(`[${label}] viewport pass completed`, true);
    } catch (error) {
      record(
        `[${label}] viewport pass completed`,
        false,
        String(error).split("\n")[0].slice(0, 90),
      );
      await page.screenshot({ path: `${OUT}/${label}-aborted.png` }).catch(() => {});
    } finally {
      await context.close();
    }
  }

  await browser.close();
  flush();

  const failed = results.filter((entry) => !entry.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
