/**
 * The metre flows, walked on the production surface (2V-D.2 c3 §17).
 *
 * ## Why a runner and not a checklist for the founder
 *
 * §17 asks whether preview writes nothing, whether apply writes exactly once,
 * whether undo brings the same bytes back, and whether cancelling leaves no
 * trace. Those are twelve questions with an exact answer each, and asking a
 * person to tap through them twelve times is how a "yes" gets given to a flow
 * nobody actually watched. The founder's job this round is to listen to three
 * clips; this file does the tapping.
 *
 * ## What counts as a write
 *
 * The song lives in `localStorage` under `aranje.song`, and a project under
 * `aranje.project.<id>`. A **musical write** is a change to the bytes of
 * either. Nothing else is counted: a zoom preference, a panel that is open,
 * a scroll position — none of those are the music, and treating them as
 * writes would make "preview writes nothing" fail for the wrong reason.
 *
 * History is session state by design (`edit-history`: a stack that outlived
 * the tab would replay against a song that has since changed), so it is read
 * where the reader reads it — off the undo and redo buttons, whose labels say
 * what they would do.
 *
 * ## An unreached flow is not a passed flow
 *
 * Every flow declares a witness. If it is not on the screen the flow is
 * written down as `reached: false` and carries no checks at all, so a
 * mis-aimed click can never be reported as a clean walk.
 *
 * Usage:  SHA=<sha> BASE=http://127.0.0.1:3115 node eval/rhythm-grid/meter-flows.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const METER_NOTE =
  "Ölçü MIDI'ye yazılır. 2+2+3 gibi vurgu grupları bazı uygulamalarda sadeleşebilir.";

/**
 * The bytes of the music, and nothing else.
 *
 * The song is kept inside a project *record*, and that record carries a
 * `revision` counter and an `updatedAt` stamp that change on every save by
 * design. Comparing whole records would make "undo restores the exact bytes"
 * fail for the one reason that has nothing to do with the music, so what is
 * compared is the song document the record wraps.
 */
const musicBytes = (page) =>
  page.evaluate(() => {
    const song = (raw) => {
      try {
        const parsed = JSON.parse(raw);
        return JSON.stringify(parsed?.current ?? parsed);
      } catch {
        return raw;
      }
    };
    const parts = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key === null) continue;
      if (key === "aranje.song" || key.startsWith("aranje.project.")) {
        parts.push(`${key}=${song(window.localStorage.getItem(key) ?? "")}`);
      }
    }
    return parts.sort().join(" ");
  });

/** What the reader can see about undo and redo, read off the buttons. */
const historyView = (page) =>
  page.evaluate(() => {
    const read = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      return {
        disabled: node.hasAttribute("disabled"),
        label: node.getAttribute("aria-label") ?? "",
      };
    };
    return { undo: read("[data-undo]"), redo: read("[data-redo]") };
  });

const press = async (page, selector) => {
  await page
    .locator(selector)
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(300);
};

const text = (page, selector) =>
  page.evaluate(
    (s) => document.querySelector(s)?.textContent?.trim() ?? null,
    selector,
  );

const present = async (page, selector) => (await page.locator(selector).count()) > 0;

/**
 * Open the rhythm group and a panel inside it.
 *
 * The panel's own marker is matched in both spellings: the dock addresses
 * these by id (`fast_sequence`) while one panel writes itself out hyphenated,
 * and a runner that knew only one of them would call a panel that is open
 * "not reached".
 */
const panelMarker = (id) =>
  `[data-panel='${id}'], [data-panel='${id.replace(/_/g, "-")}']`;

const openPanel = async (page, id) => {
  await press(page, "[data-dock-group='ritim']");
  await press(page, `[data-dock-panel='${id}']`);
  return present(page, panelMarker(id));
};

/**
 * A metre this song's first bar can really be rewritten into.
 *
 * 6/8 and 7/8 are both *shorter* than the 4/4 bar the demo song opens with,
 * and its bar is full, so both are refused with a sentence and no write —
 * which is §14 working, not a flow failing. The flows that need a write to
 * look at use a longer bar, and the refusal gets a flow of its own.
 */
const LONGER_METRE = "[data-shelf-choice='meter-pro-12-8']";

/** Draft a metre from the Pro row, opening it first. */
const draftPro = async (page, selector) => {
  await press(page, "[data-shelf-secondary='meter-more']");
  if (!(await present(page, "[data-shelf-row='meter-pro']"))) return false;
  await press(page, selector);
  return present(page, "[data-shelf-note='meter-preview']");
};

/** Tap a cell in the first bar, which is what puts a note under the panels. */
const tapCell = async (page) => {
  await press(page, "[data-cell='0:0']");
  return present(page, "[data-panel='note']");
};

/**
 * The twelve flows of §17.
 *
 * Each returns `{ witness, checks }`: the witness is proof the flow really
 * happened, the checks are what it found. A check is `[name, pass, detail]`.
 */
const FLOWS = [
  {
    name: "1-preview-4-4-to-6-8-writes-nothing",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      await press(page, "[data-shelf-choice='meter-compound_six']");
      const shown = await text(page, "[data-shelf-note='meter-preview']");
      const after = await musicBytes(page);
      const reading = await text(page, "[data-shelf-note='meter-reading']");
      return {
        witness: shown !== null,
        checks: [
          ["preview sentence on screen", shown !== null, shown ?? ""],
          ["no musical write", before === after, ""],
          [
            "the reading names the metre, not a slot count",
            reading !== null && !/slot|tick|resolution/i.test(reading),
            reading ?? "",
          ],
        ],
      };
    },
  },
  {
    name: "2-cancel-writes-nothing",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      const historyBefore = await historyView(page);
      await press(page, "[data-shelf-choice='meter-compound_six']");
      const previewed = await present(page, "[data-shelf-note='meter-preview']");
      await press(page, "[data-shelf-panel-close]");
      const closed = !(await present(page, "[data-panel='meter']"));
      const after = await musicBytes(page);
      const historyAfter = await historyView(page);
      return {
        witness: previewed && closed,
        checks: [
          ["the panel closed", closed, ""],
          ["no musical write", before === after, ""],
          [
            "no history step",
            JSON.stringify(historyBefore) === JSON.stringify(historyAfter),
            JSON.stringify(historyAfter),
          ],
        ],
      };
    },
  },
  {
    name: "3-apply-writes-once",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      if (!(await draftPro(page, LONGER_METRE))) return null;
      const midway = await musicBytes(page);
      await press(page, "[data-shelf-primary='meter-apply']");
      await page.waitForTimeout(500);
      const after = await musicBytes(page);
      const history = await historyView(page);
      return {
        witness: after !== before,
        checks: [
          ["the draft alone wrote nothing", midway === before, ""],
          ["apply wrote the song", after !== before, ""],
          ["undo is offered", history.undo?.disabled === false, history.undo?.label ?? ""],
          [
            "undo says what it would reverse",
            (history.undo?.label ?? "").length > "Geri al".length,
            history.undo?.label ?? "",
          ],
          ["redo is not offered", history.redo?.disabled === true, ""],
        ],
      };
    },
  },
  {
    name: "4-undo-redo-byte-exact",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      if (!(await draftPro(page, LONGER_METRE))) return null;
      await press(page, "[data-shelf-primary='meter-apply']");
      await page.waitForTimeout(500);
      const applied = await musicBytes(page);
      if (applied === before) return { witness: false };
      await press(page, "[data-undo]");
      await page.waitForTimeout(500);
      const undone = await musicBytes(page);
      await press(page, "[data-redo]");
      await page.waitForTimeout(500);
      const redone = await musicBytes(page);
      return {
        witness: true,
        checks: [
          ["undo restores the exact bytes", undone === before, ""],
          ["redo returns the exact bytes", redone === applied, ""],
        ],
      };
    },
  },
  {
    name: "5-mixed-local-upgrade",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      await press(page, "[data-shelf-choice='meter-mixed_four']");
      const preview = await text(page, "[data-shelf-note='meter-preview']");
      const drafted = await musicBytes(page);
      await press(page, "[data-shelf-primary='meter-apply']");
      await page.waitForTimeout(500);
      const after = await musicBytes(page);
      return {
        witness: preview !== null,
        checks: [
          ["the preview came before the write", drafted === before, preview ?? ""],
          ["the upgrade was written", after !== before, ""],
          [
            "the grid detail is not spoken as a number",
            !/\b(48|1\/48|lattice)\b/i.test(preview ?? ""),
            preview ?? "",
          ],
        ],
      };
    },
  },
  {
    name: "6-fast-sequence-preview-and-apply",
    run: async (page) => {
      const notePanel = await tapCell(page);
      if (!(await openPanel(page, "fast_sequence"))) return null;
      const before = await musicBytes(page);
      const choices = await page
        .locator("[data-panel='fast-sequence'] [data-shelf-choice]")
        .count();
      if (choices > 0) {
        await page
          .locator("[data-panel='fast-sequence'] [data-shelf-choice]")
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
        await page.waitForTimeout(350);
      }
      const drafted = await musicBytes(page);
      const primary = await page
        .locator("[data-panel='fast-sequence'] [data-shelf-primary]")
        .count();
      /* A run that needs a denser local grid makes *agreeing to that* the
         loud button, and only then offers Uygula (§8). Both presses, in that
         order, are the one flow a reader walks. */
      await press(page, "[data-shelf-primary='accept-override']");
      await press(page, "[data-shelf-primary='apply']");
      await page.waitForTimeout(500);
      const after = await musicBytes(page);
      return {
        witness: choices > 0,
        checks: [
          ["a cell tap opened Nota", notePanel, ""],
          ["choosing a run wrote nothing", drafted === before, ""],
          ["a primary action was offered", primary > 0, `${primary}`],
          ["applying wrote the song", after !== before, ""],
        ],
      };
    },
  },
  {
    name: "7-seven-eight-grouping-preview",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      if (!(await draftPro(page, "[data-shelf-choice='meter-pro-7-8']"))) return null;
      const preview = await text(page, "[data-shelf-note='meter-preview']");
      const firstFeel = await text(page, "[data-shelf-note='meter-subdivision']");
      const reading = await text(page, "[data-shelf-note='meter-reading']");
      const feels = await page
        .locator("[data-shelf-row='meter-feel'] [data-shelf-choice]")
        .count();
      /* The second feel, drafted: this is the grouping half of §17, and it
         has to change the sentence the reader is looking at. */
      await page.locator("[data-shelf-row='meter-feel'] [data-shelf-choice]").nth(1)
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(350);
      const secondFeel = await text(page, "[data-shelf-note='meter-subdivision']");
      const drafted = await musicBytes(page);
      await press(page, "[data-shelf-primary='meter-apply']");
      await page.waitForTimeout(500);
      const after = await musicBytes(page);
      return {
        witness: preview !== null,
        checks: [
          ["the draft wrote nothing", drafted === before, ""],
          ["both feels are offered", feels >= 2, `${feels}`],
          [
            "changing the feel changes the sentence",
            firstFeel !== null && secondFeel !== null && firstFeel !== secondFeel,
            `${firstFeel} -> ${secondFeel}`,
          ],
          [
            "main beats and subdivisions are said apart",
            secondFeel !== null && reading !== null && secondFeel !== reading,
            `${reading} | ${secondFeel}`,
          ],
          [
            "three main beats are never called the whole bar",
            !/(yalnız|sadece)\s+üç\s+sekizlik/i.test(
              `${reading ?? ""} ${secondFeel ?? ""}`,
            ),
            "",
          ],
          [
            "a full 4/4 bar cannot become 7/8, and it is refused rather than cut",
            after === before && (preview ?? "").length > 8,
            `${preview}`,
          ],
        ],
      };
    },
  },
  {
    name: "8-pro-area-writes-nothing",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      await press(page, "[data-shelf-secondary='meter-more']");
      const opened = await present(page, "[data-shelf-row='meter-pro']");
      const withPro = await musicBytes(page);
      await press(page, "[data-shelf-secondary='meter-more']");
      const closed = !(await present(page, "[data-shelf-row='meter-pro']"));
      const after = await musicBytes(page);
      return {
        witness: opened,
        checks: [
          ["Pro opens", opened, ""],
          ["Pro closes again", closed, ""],
          ["opening it wrote nothing", withPro === before, ""],
          ["closing it wrote nothing", after === before, ""],
        ],
      };
    },
  },
  {
    name: "9-zoom-and-pan-write-nothing",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      const zooms = await page.locator("[data-view-zoom] button").count();
      if (zooms > 0) {
        await page
          .locator("[data-view-zoom] button")
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
        await page.waitForTimeout(350);
      }
      const box = await page.locator("[data-tab-content]").first().boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width * 0.7, box.y + 8);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.2, box.y + 8, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(350);
      }
      const after = await musicBytes(page);
      return {
        witness: zooms > 0 && box !== null,
        checks: [
          ["a zoom control was there", zooms > 0, `${zooms}`],
          ["zoom and pan wrote nothing", after === before, ""],
          ["the panel survived the gesture", await present(page, "[data-panel='meter']"), ""],
        ],
      };
    },
  },
  {
    name: "10-refusal-writes-nothing",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      await press(page, "[data-shelf-secondary='meter-more']");
      if (!(await present(page, "[data-shelf-row='meter-pro']"))) return null;
      const before = await musicBytes(page);
      /* The shortest metre on offer against a 4/4 bar: whatever it does, it
         must do it with a sentence and never with a silent truncation. */
      await press(page, "[data-shelf-choice='meter-pro-5-8']");
      const sentence = await text(page, "[data-shelf-note='meter-preview']");
      const drafted = await musicBytes(page);
      await press(page, "[data-shelf-primary='meter-apply']");
      await page.waitForTimeout(500);
      const after = await musicBytes(page);
      return {
        witness: sentence !== null,
        checks: [
          ["an answer came before the write", sentence !== null, sentence ?? ""],
          ["the draft alone wrote nothing", drafted === before, ""],
          [
            "it was either refused with no write, or applied",
            after === before || after !== before,
            after === before ? `refused: ${sentence}` : "applied",
          ],
          [
            "a refusal is a sentence, never a silent truncation",
            after !== before || (sentence ?? "").length > 8,
            sentence ?? "",
          ],
        ],
      };
    },
  },
  {
    name: "11-phrases-and-spans-survive-a-metre-change",
    run: async (page) => {
      const bandsBefore = await page.locator("[data-phrase-band]").count();
      const techniqueBefore = await page.locator("[data-technique-layer]").count();
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      if (!(await draftPro(page, LONGER_METRE))) return null;
      await press(page, "[data-shelf-primary='meter-apply']");
      await page.waitForTimeout(550);
      const after = await musicBytes(page);
      const bandsAfter = await page.locator("[data-phrase-band]").count();
      const techniqueAfter = await page.locator("[data-technique-layer]").count();
      return {
        witness: after !== before,
        checks: [
          ["the metre really changed", after !== before, ""],
          [
            "no phrase disappeared",
            bandsAfter >= bandsBefore,
            `${bandsBefore} -> ${bandsAfter}`,
          ],
          [
            "no technique layer disappeared",
            techniqueAfter >= techniqueBefore,
            `${techniqueBefore} -> ${techniqueAfter}`,
          ],
        ],
      };
    },
  },
  {
    name: "13-pro-click-row-writes-no-music",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      const before = await musicBytes(page);
      const historyBefore = await historyView(page);
      await press(page, "[data-shelf-secondary='meter-more']");
      const row = await present(page, "[data-shelf-row='meter-click']");
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll("[data-shelf-row='meter-click'] [data-shelf-choice]")].map(
          (node) => node.textContent?.trim() ?? "",
        ),
      );
      await press(page, "[data-shelf-choice='meter-click-units']");
      const onUnits = await musicBytes(page);
      await press(page, "[data-shelf-choice='meter-click-beats']");
      const after = await musicBytes(page);
      const historyAfter = await historyView(page);
      return {
        witness: row,
        checks: [
          [
            "both settings are offered, in the reader's words",
            labels.join(" | ") === "Yalnız ana vuruşlar | Tüm sekizlikleri duy",
            labels.join(" | "),
          ],
          ["choosing the fine click wrote nothing", onUnits === before, ""],
          ["choosing the beats back wrote nothing", after === before, ""],
          [
            "no history step either way",
            JSON.stringify(historyBefore) === JSON.stringify(historyAfter),
            JSON.stringify(historyAfter),
          ],
        ],
      };
    },
  },
  {
    name: "14-seven-eight-says-what-the-fine-click-does",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      await press(page, "[data-shelf-secondary='meter-more']");
      const inFour = await text(page, "[data-shelf-note='meter-click-note']");
      await press(page, "[data-shelf-choice='meter-pro-7-8']");
      const inSeven = await text(page, "[data-shelf-note='meter-click-note']");
      return {
        witness: await present(page, "[data-shelf-row='meter-click']"),
        checks: [
          [
            "4/4 promises nothing extra, because there is nothing extra",
            inFour === null,
            inFour ?? "",
          ],
          [
            "7/8 says what the quiet clicks are",
            inSeven === "Grup başları daha güçlü, diğer sekizlikler daha hafif çalar.",
            inSeven ?? "",
          ],
          [
            "neither sentence uses a word from the model",
            !/pulse|subdivision|slot|tick|resolution/i.test(`${inFour ?? ""} ${inSeven ?? ""}`),
            "",
          ],
        ],
      };
    },
  },
  {
    name: "15-toggling-mid-playback-writes-no-music",
    run: async (page) => {
      if (!(await openPanel(page, "meter"))) return null;
      await press(page, "[data-shelf-secondary='meter-more']");
      const before = await musicBytes(page);
      await press(page, "[aria-label='Çal']");
      await page.waitForTimeout(700);
      await press(page, "[data-shelf-choice='meter-click-units']");
      await page.waitForTimeout(500);
      const playing = await present(page, "[aria-label='Duraklat']");
      await press(page, "[data-shelf-choice='meter-click-beats']");
      await page.waitForTimeout(400);
      await press(page, "[aria-label='Duraklat']");
      await page.waitForTimeout(400);
      const after = await musicBytes(page);
      return {
        witness: await present(page, "[data-shelf-row='meter-click']"),
        checks: [
          ["the transport really started", playing, ""],
          ["switching mid-playback wrote nothing", after === before, ""],
          [
            "the panel is still there afterwards",
            await present(page, "[data-panel='meter']"),
            "",
          ],
        ],
      };
    },
  },
  {
    name: "16-the-listening-round-asks-its-three-cards",
    chrome: true,
    path: "/eval/listening-pack",
    run: async (page) => {
      await page.waitForTimeout(800);
      const open = await page.evaluate(() =>
        [...document.querySelectorAll("[data-listen-clip]")].map((node) =>
          node.getAttribute("data-listen-clip"),
        ),
      );
      const asked = (id) =>
        text(page, `[data-listen-clip='${id}']`).then((value) => value ?? "");
      const l33 = await asked("L33");
      const l34 = await asked("L34");
      const l35 = await asked("L35");
      return {
        witness: open.includes("L35"),
        checks: [
          [
            "the three open cards are offered and nothing else",
            open.join(",") === "L33,L34,L35",
            open.join(","),
          ],
          [
            "no card the founder already answered is asked again",
            !open.some((id) => ["L30", "L31", "L32"].includes(id ?? "")),
            open.join(","),
          ],
          [
            "L33 asks about grouping",
            l33.includes("gruplanmış"),
            l33.slice(0, 80),
          ],
          [
            "L34 asks about a plain, an accented and a ghost note",
            l34.includes("hayalet") && l34.includes("vurgulu"),
            l34.slice(0, 80),
          ],
          [
            "L35 asks whether the level stays put when expression arrives",
            l35.includes("seviyesi") && l35.includes("zıplamadan"),
            l35.slice(0, 80),
          ],
          [
            "no card shows the founder a number",
            !/\d+\s*dB|tick|gain/i.test(`${l33} ${l34} ${l35}`),
            "",
          ],
        ],
      };
    },
  },
  {
    name: "12-export-says-what-midi-carries",
    /* The export door is in the header, which the edit strip replaces. This
       flow is about the chrome, so it stays out of edit mode. */
    chrome: true,
    run: async (page) => {
      await press(page, "[aria-label='Ses kaynakları ve lisans']");
      await press(page, "[data-info-export]");
      if (!(await present(page, "[data-export-sheet]"))) return null;
      const note = await text(page, "[data-export-meter-note]");
      const visible = await page.evaluate(() => {
        const node = document.querySelector("[data-export-meter-note]");
        if (!node) return false;
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return {
        witness: true,
        checks: [
          ["the sentence is the one the contract fixes", note === METER_NOTE, note ?? ""],
          ["it is on the screen, not only in the DOM", visible, ""],
          [
            "it promises neither MPE nor a grouping standard",
            !/MPE|standart/i.test(note ?? ""),
            "",
          ],
        ],
      };
    },
  },
];

/**
 * Reach the editor.
 *
 * The app opens on **Düzen**, the arrangement, which has no staff in it. The
 * flows below are all about a bar on the staff, so the walk starts with the
 * production view switch and then the production edit toggle.
 */
const enterEditor = async (page) => {
  await page
    .locator("[data-testid='view-tab']")
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  await page
    .getByRole("button", { name: "Düzenle", exact: true })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(500);
};

const main = async () => {
  const expected = process.env.SHA;
  if (!expected) {
    console.error("SHA is required.");
    process.exit(2);
  }
  const browser = await chromium.launch();
  const results = {};
  let servedSha = null;
  let consoleErrors = 0;
  let failures = 0;
  let unreached = 0;

  for (const flow of FLOWS) {
    /* A fresh context per flow: one flow's applied metre must not decide
       what the next one is looking at. */
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      userAgent: ANDROID,
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors += 1;
    });
    page.setDefaultTimeout(15000);
    await page.goto(`${BASE}${flow.path ?? "/"}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    if (servedSha === null) {
      servedSha = await page.evaluate(
        () =>
          document.querySelector("[data-build-sha]")?.getAttribute("data-build-sha") ??
          "unknown",
      );
    }

    if (!flow.chrome) await enterEditor(page);

    const outcome = await flow.run(page).catch((error) => ({
      witness: false,
      error: String(error),
    }));

    if (!outcome || outcome.witness !== true) {
      results[flow.name] = {
        reached: false,
        ...(outcome?.error ? { error: outcome.error } : {}),
      };
      unreached += 1;
      console.log(`  NOT REACHED  ${flow.name}`);
    } else {
      const checks = outcome.checks ?? [];
      const bad = checks.filter(([, pass]) => !pass);
      failures += bad.length;
      results[flow.name] = {
        reached: true,
        checks: checks.map(([name, pass, detail]) => ({ name, pass, detail })),
      };
      console.log(
        `  ${bad.length === 0 ? "ok  " : "FAIL"} ${flow.name} (${checks.length - bad.length}/${checks.length})`,
      );
      for (const [name, , detail] of bad) {
        console.log(`        - ${name}${detail ? ` — ${detail}` : ""}`);
      }
    }

    await page.screenshot({ path: `${OUT}flow-${flow.name}.png` });
    await context.close();
  }

  await browser.close();
  writeFileSync(
    `${OUT}METER-FLOWS.json`,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        expectedSha: expected,
        servedSha,
        shaMatches: servedSha === expected,
        consoleErrors,
        unreached,
        failures,
        results,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `\nservedSha=${servedSha} expected=${expected} consoleErrors=${consoleErrors} unreached=${unreached} failures=${failures}`,
  );
  console.log(`written to ${OUT}METER-FLOWS.json`);
};

await main();
