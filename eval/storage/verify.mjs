/**
 * Faz 2K-B browser verification.
 *
 * Twenty scenarios about durability, and durability is the one property that
 * cannot be tested without actually reloading a real page. A unit test can
 * prove the decoder reads a broken envelope correctly; only the browser can
 * prove that an edit made a moment ago is still there after a hard reload,
 * that nothing writes on the way out, and that a quota error leaves the
 * screen showing what is genuinely on disk.
 *
 * Instrumented before any app code runs:
 *
 * - `Storage.prototype.setItem`, so "one write" is a count and a quota error
 *   can be injected on demand.
 * - console and page errors, collected rather than sampled.
 *
 * `node eval/storage/verify.mjs`
 */
import { chromium } from "playwright";
import { press } from "../shared/harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.STORAGE_OUT ?? "eval/storage/artifacts";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/bar-ops/fixture-song.json", "utf8").trim();

const results = [];
const measurements = {};

const flush = () =>
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      { results, measurements, failed: results.filter((e) => !e.pass).length },
      null,
      2,
    )}\n`,
  );

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
        banner: document
          .querySelector("[data-recovery-banner]")
          ?.getAttribute("data-recovery-banner"),
        text: document.querySelector("[data-recovery-banner] p")?.textContent,
      }))
      .catch(() => null);
    await lastPage?.screenshot({ path: `${OUT}/failed-${name.split(" ")[0]}.png` }).catch(() => {});
    record(name, false, `${first} :: ${JSON.stringify(state)}`);
    return undefined;
  }
}

/*
 * The wrapper is an init script, so it exists before the first line of app
 * code runs — the physical operations of the *load itself* are on the ledger,
 * not just the ones made after the harness got around to looking.
 *
 * `__refuse` modes: false (normal), true (every write throws), "song-only"
 * (only the song key throws — the shape of a big value hitting quota that a
 * one-byte probe slid under).
 */
const INSTRUMENT = `
  window.__writes = 0;
  window.__ops = [];
  window.__consoleErrors = [];
  window.__refuse = false;
  const refused = (key) =>
    window.__refuse === true || (window.__refuse === "song-only" && key === "aranje.song");
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key, value) {
    if (refused(key)) {
      window.__ops.push({ op: "set", key, ok: false });
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    }
    originalSet.call(this, key, value);
    window.__ops.push({ op: "set", key, ok: true });
    if (key === "aranje.song") window.__writes += 1;
  };
  Storage.prototype.removeItem = function (key) {
    originalRemove.call(this, key);
    window.__ops.push({ op: "remove", key, ok: true });
  };
`;

/**
 * Open the app with a given value already under the song key.
 *
 * `seed` is written before the counter is wrapped, so seeding is never
 * counted as an edit — the harness must not measure itself.
 */
async function openApp(browser, size, seed = FIXTURE, options = {}) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  if (seed !== null) {
    /*
     * Seed once per context, not once per navigation.
     *
     * `addInitScript` runs on *every* document, so a reload would put the
     * fixture back and every "is the edit still there?" scenario would be
     * measuring the harness instead of the app. The marker lives in
     * sessionStorage, which survives a reload and dies with the context.
     */
    await context.addInitScript(
      ([key, value]) => {
        try {
          if (sessionStorage.getItem("aranje.harness.seeded") === "1") return;
          sessionStorage.setItem("aranje.harness.seeded", "1");
          localStorage.setItem(key, value);
        } catch {
          /* a private window is not a reason to fail the run */
        }
      },
      ["aranje.song", seed],
    );
  }
  await context.addInitScript(INSTRUMENT);
  if (options.refuseFromStart) {
    await context.addInitScript(
      (mode) => {
        window.__refuse = mode;
      },
      options.refuseFromStart,
    );
  }
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

/** A real reload: same context, same storage, fresh page. */
async function hardReload(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  await page.waitForTimeout(400);
}

/* --------------------------------------------------------------- gestures */



const cell = (trackId, barKey) => `[data-arr-cell='${trackId}|${barKey}']`;
const barHeader = (barKey) => `[data-arr-bar='${barKey}']`;

async function clearBarSelection(page) {
  const close = page.locator("[role=dialog] [aria-label=Kapat]");
  if (await close.count()) await close.first().click();
  await page.waitForTimeout(200);
  const cancel = page.locator("[data-bar-action-bar] [aria-label='Ölçü seçimini iptal et']");
  if (await cancel.count()) await cancel.first().click();
  await page.waitForTimeout(200);
}

async function deleteTrackBar(page, cdp, barKey = "intro:0") {
  await clearBarSelection(page);
  await press(page, cdp, cell("rhythm", barKey));
  await page.locator("[data-bar-action=delete]").click();
  await page.waitForTimeout(300);
  await page.locator("[data-bar-apply]").click();
  await page.waitForTimeout(500);
}

async function deleteFullBar(page, cdp, barKey = "intro:1") {
  await clearBarSelection(page);
  await press(page, cdp, barHeader(barKey));
  await page.locator("[data-bar-action=delete]").click();
  await page.waitForTimeout(300);
  await page.locator("[data-bar-apply]").click();
  await page.waitForTimeout(600);
}

/* ----------------------------------------------------------------- probes */

const writes = (page) => page.evaluate(() => window.__writes);
const errors = (page) => page.evaluate(() => window.__consoleErrors ?? []);
const rawKey = (page) => page.evaluate(() => localStorage.getItem("aranje.song"));

/** The song on disk, unwrapped the same way the app unwraps it. */
const storedSong = async (page) => {
  const raw = await rawKey(page);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    return value?.format === "aranje.song" ? (value.current ?? null) : value;
  } catch {
    return null;
  }
};

const envelope = async (page) => {
  const raw = await rawKey(page);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const banner = (page) =>
  page.evaluate(() => {
    const node = document.querySelector("[data-recovery-banner]");
    if (!node) return null;
    const dismiss = node.querySelector("[data-recovery-dismiss]");
    const box = dismiss?.getBoundingClientRect();
    return {
      state: node.getAttribute("data-recovery-banner"),
      text: node.querySelector("p")?.textContent ?? "",
      dismissBox: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
    };
  });

const historyState = (page) =>
  page.evaluate(() => {
    const undo = document.querySelector("[data-undo]");
    const redo = document.querySelector("[data-redo]");
    return { canUndo: undo ? !undo.disabled : false, canRedo: redo ? !redo.disabled : false };
  });

const barCount = async (page, sectionId) => {
  const song = await storedSong(page);
  return song?.sections.find((s) => s.id === sectionId)?.bars.length ?? -1;
};

const drawnBars = (page) => page.locator("[data-arr-bar]").count();

/* --------------------------------------------------------- broken fixtures */

const FIXTURE_SONG = JSON.parse(FIXTURE);

const wrap = (current, previous, revision = 4, version = 1) =>
  JSON.stringify({ format: "aranje.song", version, revision, current, previous });

const RESCUED = { ...FIXTURE_SONG, title: "Kurtarılan sürüm" };

/* -------------------------------------------------------------- scenarios */

async function run() {
  const browser = await chromium.launch();

  for (const [label, size] of [
    ["390x844", { width: 390, height: 844 }],
    ["320x700", { width: 320, height: 700 }],
  ]) {
    const at = (name) => `${name} @${label}`;

    // ------------------------------------------------------------------ 1
    await safe(at("1 a note edit survives a hard reload"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await deleteTrackBar(page, cdp, "intro:0");
      const before = JSON.stringify(await storedSong(page));
      await hardReload(page);
      const after = JSON.stringify(await storedSong(page));
      const drawn = await drawnBars(page);
      record(
        at("1 a note edit survives a hard reload"),
        before === after && drawn > 0,
        `identical=${before === after}, bars drawn ${drawn}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 2
    await safe(at("2 a structural edit survives a hard reload"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      const before = await barCount(page, "intro");
      await deleteFullBar(page, cdp, "intro:1");
      const edited = await barCount(page, "intro");
      await hardReload(page);
      const reloaded = await barCount(page, "intro");
      const drawnAfter = await drawnBars(page);
      record(
        at("2 a structural edit survives a hard reload"),
        edited === before - 1 && reloaded === edited && drawnAfter === 10,
        `${before} -> ${edited} -> ${reloaded}, drawn ${drawnAfter}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 3
    await safe(at("3 an undo survives a hard reload"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      const start = JSON.stringify(await storedSong(page));
      await deleteFullBar(page, cdp, "intro:1");
      await page.locator("[data-undo]").click();
      await page.waitForTimeout(500);
      const undone = JSON.stringify(await storedSong(page));
      await hardReload(page);
      const reloaded = JSON.stringify(await storedSong(page));
      const history = await historyState(page);
      record(
        at("3 an undo survives a hard reload"),
        // Byte-identical to before the edit, and it is what reloads.
        undone === start && reloaded === undone && !history.canUndo && !history.canRedo,
        `undone==start:${undone === start}, reload matches:${reloaded === undone}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 4
    await safe(at("4 a redo survives a hard reload"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await deleteFullBar(page, cdp, "intro:1");
      const edited = JSON.stringify(await storedSong(page));
      await page.locator("[data-undo]").click();
      await page.waitForTimeout(500);
      await page.locator("[data-redo]").click();
      await page.waitForTimeout(500);
      const redone = JSON.stringify(await storedSong(page));
      await hardReload(page);
      const reloaded = JSON.stringify(await storedSong(page));
      record(
        at("4 a redo survives a hard reload"),
        redone === edited && reloaded === redone,
        `redo==edit:${redone === edited}, reload matches:${reloaded === redone}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 5
    await safe(at("5 the history and clipboard do not survive a reload"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await press(page, cdp, cell("rhythm", "intro:0"));
      await page.locator("[data-bar-action=copy]").click();
      await page.waitForTimeout(300);
      await deleteTrackBar(page, cdp, "intro:3");
      const before = await historyState(page);

      await hardReload(page);
      const after = await historyState(page);
      // The clipboard is gone too: a paste is not offered any more.
      await press(page, cdp, cell("rhythm", "intro:1"));
      await page.locator("[data-bar-action=more]").click();
      await page.waitForTimeout(400);
      const body = await page.locator("[role=dialog]").innerText();

      record(
        at("5 the history and clipboard do not survive a reload"),
        before.canUndo === true &&
          after.canUndo === false &&
          after.canRedo === false &&
          !/Buraya yapıştır/.test(body),
        `undo ${before.canUndo}->${after.canUndo}, paste offered=${/Buraya yapıştır/.test(body)}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 6
    await safe(at("6 a ghost is not on disk when the page closes"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await deleteTrackBar(page, cdp, "intro:0");
      const committed = JSON.stringify(await storedSong(page));

      await clearBarSelection(page);
      await press(page, cdp, barHeader("intro:2"));
      await page.locator("[data-bar-action=delete]").click();
      await page.waitForTimeout(400);
      const ghostShown = (await page.locator("[data-bar-preview]").count()) === 1;
      const writesBefore = await writes(page);

      await hardReload(page);
      const afterReload = JSON.stringify(await storedSong(page));
      record(
        at("6 a ghost is not on disk when the page closes"),
        ghostShown && afterReload === committed,
        `ghost=${ghostShown}, disk unchanged=${afterReload === committed}, writes ${writesBefore}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 7
    await safe(at("7 closing the page writes nothing extra"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await deleteTrackBar(page, cdp, "intro:0");
      const afterEdit = await writes(page);

      // Everything a browser does on the way out, short of actually leaving.
      await page.evaluate(() => {
        window.dispatchEvent(new Event("beforeunload"));
        window.dispatchEvent(new Event("pagehide"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(400);
      const afterUnload = await writes(page);

      measurements[`writesPerEdit-${label}`] = afterEdit;
      record(
        at("7 closing the page writes nothing extra"),
        afterEdit === 1 && afterUnload === afterEdit,
        `edit=${afterEdit}, after unload events=${afterUnload}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 8
    await safe(at("8 a legacy song opens and becomes an envelope on first edit"), async () => {
      const { context, page, cdp } = await openApp(browser, size, FIXTURE);
      const raw = await rawKey(page);
      const openedLegacy = !raw.includes('"format"');
      const writesAtLoad = await writes(page);

      await deleteTrackBar(page, cdp, "intro:0");
      const file = await envelope(page);

      record(
        at("8 a legacy song opens and becomes an envelope on first edit"),
        openedLegacy &&
          writesAtLoad === 0 &&
          file?.format === "aranje.song" &&
          file?.version === 1 &&
          file?.revision === 1 &&
          JSON.stringify(file?.previous) === JSON.stringify(FIXTURE_SONG),
        `legacy at load=${openedLegacy}, writes at load=${writesAtLoad}, rev=${file?.revision}`,
      );
      await context.close();
    });

    // ------------------------------------------------------------------ 9
    await safe(at("9 a broken current slot opens the previous one"), async () => {
      const { context, page } = await openApp(
        browser,
        size,
        wrap({ half: "written" }, RESCUED, 6),
      );
      const shown = await banner(page);
      const song = await storedSong(page);
      const backups = await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith("aranje.corrupt.")),
      );
      record(
        at("9 a broken current slot opens the previous one"),
        shown?.state === "recovered_previous" &&
          shown.text === "Son kayıt açılamadı. Bir önceki sağlam sürüm geri yüklendi." &&
          song?.title === "Kurtarılan sürüm" &&
          backups.length === 1,
        `${shown?.state}, title=${song?.title}, backups=${backups.length}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-recovered.png` });
      await context.close();
    });

    // ----------------------------------------------------------------- 10
    await safe(at("10 both slots broken falls back and keeps the file"), async () => {
      const raw = wrap({ a: 1 }, { b: 2 }, 3);
      const { context, page } = await openApp(browser, size, raw);
      const shown = await banner(page);
      const backups = await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith("aranje.corrupt."));
        return keys.map((key) => localStorage.getItem(key));
      });
      record(
        at("10 both slots broken falls back and keeps the file"),
        shown?.state === "corrupt_fallback" &&
          shown.text === "Kaydedilmiş şarkı açılamadı. Bozuk veri korundu ve örnek şarkı açıldı." &&
          backups.length === 1 &&
          backups[0] === raw,
        `${shown?.state}, preserved=${backups[0] === raw}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-corrupt.png` });
      await context.close();
    });

    // ----------------------------------------------------------------- 11
    await safe(at("11 malformed text does not crash the app"), async () => {
      const { context, page } = await openApp(browser, size, "{not json at all");
      const shown = await banner(page);
      const drawn = await drawnBars(page);
      const consoleErrors = await errors(page);
      record(
        at("11 malformed text does not crash the app"),
        shown?.state === "corrupt_fallback" && drawn > 0 && consoleErrors.length === 0,
        `${shown?.state}, bars drawn ${drawn}, console ${consoleErrors.length}`,
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 12
    await safe(at("12 a newer version is left byte-identical and locks editing"), async () => {
      const raw = JSON.stringify({
        format: "aranje.song",
        version: 2,
        chunks: [{ kind: "song" }],
      });
      const { context, page } = await openApp(browser, size, raw);
      const shown = await banner(page);
      const stillThere = await rawKey(page);
      const backups = await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("aranje.corrupt.")),
      );
      // The edit toggle only exists on the tab; the arrangement has no staff
      // for it to act on. So look where the control actually lives.
      await page.locator("[data-testid=view-tab]").click();
      await page.waitForTimeout(400);
      const editDisabled = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll("button")];
        const edit = nodes.find((n) => /Düzenle/.test(n.textContent ?? ""));
        const arrange = nodes.find((n) => /Aranje et/.test(n.textContent ?? ""));
        return { edit: edit?.disabled ?? null, arrange: arrange?.disabled ?? null };
      });
      record(
        at("12 a newer version is left byte-identical and locks editing"),
        shown?.state === "unsupported_version" &&
          stillThere === raw &&
          backups.length === 0 &&
          shown.dismissBox === null &&
          editDisabled.edit === true &&
          editDisabled.arrange === true,
        `${shown?.state}, untouched=${stillThere === raw}, edit disabled=${editDisabled.edit}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-future.png` });
      await context.close();
    });

    // ----------------------------------------------------------------- 13
    await safe(at("13 a refused write leaves the screen showing the disk"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await deleteTrackBar(page, cdp, "intro:0");
      const onDisk = JSON.stringify(await storedSong(page));
      const barsBefore = await drawnBars(page);

      await page.evaluate(() => {
        window.__refuse = true;
      });
      await deleteFullBar(page, cdp, "intro:1");

      const shown = await banner(page);
      const barsAfter = await drawnBars(page);
      const diskAfter = JSON.stringify(await storedSong(page));

      record(
        at("13 a refused write leaves the screen showing the disk"),
        shown?.state === "storage_write_failed" &&
          shown.text === "Şarkı cihazına kaydedilemedi. Cihazda alan açıp tekrar dene." &&
          barsAfter === barsBefore &&
          diskAfter === onDisk,
        `${shown?.state}, drawn ${barsBefore}->${barsAfter}, disk unchanged=${diskAfter === onDisk}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-quota.png` });
      await context.close();
    });

    // ----------------------------------------------------------------- 14
    await safe(at("14 an undo during the same failure does not move"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await deleteTrackBar(page, cdp, "intro:0");
      await deleteTrackBar(page, cdp, "intro:3");
      const onScreen = await drawnBars(page);
      const onDisk = JSON.stringify(await storedSong(page));

      await page.evaluate(() => {
        window.__refuse = true;
      });
      await page.locator("[data-undo]").click();
      await page.waitForTimeout(500);

      const stillUndoable = (await historyState(page)).canUndo;
      record(
        at("14 an undo during the same failure does not move"),
        stillUndoable === true &&
          (await drawnBars(page)) === onScreen &&
          JSON.stringify(await storedSong(page)) === onDisk,
        `undo still offered=${stillUndoable}`,
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 15
    await safe(at("15 dismissing the banner writes nothing"), async () => {
      const { context, page } = await openApp(
        browser,
        size,
        wrap({ half: "written" }, RESCUED, 2),
      );
      const before = await rawKey(page);
      const writesBefore = await writes(page);

      await page.locator("[data-recovery-dismiss]").click();
      await page.waitForTimeout(300);

      record(
        at("15 dismissing the banner writes nothing"),
        (await banner(page)) === null &&
          (await rawKey(page)) === before &&
          (await writes(page)) === writesBefore,
        `banner gone=${(await banner(page)) === null}, writes ${writesBefore}`,
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 16
    await safe(at("16 the practice setting is untouched by a recovery"), async () => {
      const context = await browser.newContext({
        viewport: size,
        hasTouch: true,
        isMobile: true,
      });
      await context.addInitScript(
        ([songKey, songValue, settingsKey, settingsValue]) => {
          try {
            localStorage.setItem(songKey, songValue);
            localStorage.setItem(settingsKey, settingsValue);
          } catch {
            /* ignore */
          }
        },
        [
          "aranje.song",
          "{not json",
          "aranje.settings",
          JSON.stringify({ practiceRatePercent: 75 }),
        ],
      );
      const page = await context.newPage();
      lastPage = page;
      await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-arrangement-scroller]");
      await page.waitForTimeout(400);

      const settings = await page.evaluate(() => localStorage.getItem("aranje.settings"));
      const pill = await page.locator("[aria-label*='Çalışma hızı']").first().textContent();
      record(
        at("16 the practice setting is untouched by a recovery"),
        settings === JSON.stringify({ practiceRatePercent: 75 }) && /75/.test(pill ?? ""),
        `settings=${settings}, pill=${(pill ?? "").trim()}`,
      );
      await context.close();
      lastPage = page;
    });

    // ----------------------------------------------------------------- 17
    await safe(at("17 the envelope keeps one rung behind every step"), async () => {
      const { context, page, cdp } = await openApp(browser, size);
      await deleteTrackBar(page, cdp, "intro:0");
      const first = await envelope(page);
      await deleteTrackBar(page, cdp, "intro:3");
      const second = await envelope(page);
      await page.locator("[data-undo]").click();
      await page.waitForTimeout(500);
      const afterUndo = await envelope(page);

      measurements[`revisions-${label}`] = [
        first?.revision,
        second?.revision,
        afterUndo?.revision,
      ];
      record(
        at("17 the envelope keeps one rung behind every step"),
        first?.revision === 1 &&
          second?.revision === 2 &&
          afterUndo?.revision === 3 &&
          // What the undo left behind is what was on disk a moment before it.
          JSON.stringify(afterUndo?.previous) === JSON.stringify(second?.current),
        `revisions ${first?.revision}/${second?.revision}/${afterUndo?.revision}`,
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 18
    await safe(at("18 a normal open shows no banner at all"), async () => {
      const { context, page } = await openApp(browser, size);
      const shown = await banner(page);
      const consoleErrors = await errors(page);
      record(
        at("18 a normal open shows no banner at all"),
        shown === null && consoleErrors.length === 0,
        `banner=${shown === null ? "none" : shown.state}, console ${consoleErrors.length}`,
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 19
    await safe(at("19 a banner fits the screen and has a real target"), async () => {
      const { context, page } = await openApp(
        browser,
        size,
        wrap({ half: "written" }, RESCUED, 2),
      );
      const shown = await banner(page);
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
      measurements[`layout-${label}`] = { ...layout, dismiss: shown?.dismissBox };
      record(
        at("19 a banner fits the screen and has a real target"),
        (shown?.dismissBox?.w ?? 0) >= 43.5 &&
          (shown?.dismissBox?.h ?? 0) >= 43.5 &&
          layout.bodyOverflow === 0 &&
          layout.scrollers === 1,
        `dismiss ${JSON.stringify(shown?.dismissBox)}, overflow ${layout.bodyOverflow}, scrollers ${layout.scrollers}`,
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 20
    await safe(at("20 no technical word reaches the reader"), async () => {
      const forbidden = /JSON|Zod|schema|localStorage|autosave|undefined|Error:/i;
      const seeds = [
        wrap({ half: "written" }, RESCUED, 2),
        wrap({ a: 1 }, { b: 2 }, 2),
        "{not json",
        JSON.stringify({ format: "aranje.song", version: 2 }),
      ];
      const seen = [];
      for (const seed of seeds) {
        const { context, page } = await openApp(browser, size, seed);
        const shown = await banner(page);
        seen.push(shown?.text ?? "");
        await context.close();
      }
      record(
        at("20 no technical word reaches the reader"),
        seen.length === 4 && seen.every((text) => text.length > 0 && !forbidden.test(text)),
        seen.map((t) => t.slice(0, 24)).join(" | "),
      );
    });
  }

  for (const [label, size] of [
    ["390x844", { width: 390, height: 844 }],
    ["320x700", { width: 320, height: 700 }],
  ]) {
    const at = (name) => `${name} @${label}`;

    // ----------------------------------------------------------------- 21
    await safe(at("21 no storage at all opens read-only, still playable"), async () => {
      const context = await browser.newContext({
        viewport: size,
        hasTouch: true,
        isMobile: true,
      });
      // Storage denied before anything else exists: every access throws.
      await context.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("denied", "SecurityError");
          },
        });
      });
      const page = await context.newPage();
      lastPage = page;
      page.setDefaultTimeout(6000);
      const consoleErrors = [];
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-arrangement-scroller]");
      await page.waitForTimeout(400);

      const shown = await banner(page);
      // Play still works: the music is not storage's hostage.
      await page.locator("[aria-label=Çal]").first().click();
      await page.waitForTimeout(1100);
      const playing = await page.evaluate(() => window.__aranjeDebug?.status());
      await page.locator("[aria-label=Duraklat]").first().click();
      // Navigation still works.
      await page.locator("[data-testid=view-tab]").click();
      await page.waitForTimeout(400);
      const controls = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll("button")];
        const find = (text) => buttons.find((n) => (n.textContent ?? "").includes(text));
        return {
          edit: find("Düzenle")?.disabled ?? null,
          arrange: find("Aranje et")?.disabled ?? null,
          undo: document.querySelector("[data-undo]")?.disabled ?? null,
          redo: document.querySelector("[data-redo]")?.disabled ?? null,
        };
      });
      const layout = await page.evaluate(() => ({
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        scrollers: [...document.querySelectorAll("*")].filter(
          (node) =>
            node.scrollWidth > node.clientWidth + 1 &&
            ["auto", "scroll"].includes(getComputedStyle(node).overflowX),
        ).length,
      }));

      record(
        at("21 no storage at all opens read-only, still playable"),
        shown?.state === "storage_unavailable" &&
          shown.text ===
            "Cihazda kayıt açılamadı. Çalışmanı kaybetmemek için düzenleme kapatıldı; şarkıyı dinlemeye devam edebilirsin." &&
          shown.dismissBox === null &&
          playing === "playing" &&
          controls.edit === true &&
          controls.arrange === true &&
          controls.undo === true &&
          controls.redo === true &&
          layout.bodyOverflow === 0 &&
          layout.scrollers === 1 &&
          consoleErrors.length === 0,
        `${shown?.state}, playing=${playing}, controls=${JSON.stringify(controls)}, errors=${consoleErrors.length}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-unavailable.png` });
      await context.close();
    });

    // ----------------------------------------------------------------- 22
    await safe(at("22 a refused probe shows the real song, read-only"), async () => {
      const { context, page, cdp } = await openApp(browser, size, FIXTURE, {
        refuseFromStart: true,
      });
      const shown = await banner(page);
      const title = await page.evaluate(
        () => document.querySelector("header h1")?.textContent ?? "",
      );

      // A long press arms no selection: the gesture is not offered at all.
      await press(page, cdp, cell("rhythm", "intro:0"));
      const actionBar = await page.locator("[data-bar-action-bar]").count();
      await press(page, cdp, barHeader("intro:1"));
      const actionBarFull = await page.locator("[data-bar-action-bar]").count();

      record(
        at("22 a refused probe shows the real song, read-only"),
        shown?.state === "storage_unavailable" &&
          shown.dismissBox === null &&
          /Fikstür/.test(title) &&
          actionBar === 0 &&
          actionBarFull === 0,
        `${shown?.state}, title="${title}", actionBars ${actionBar}/${actionBarFull}`,
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 23
    await safe(at("23 the malformed-JSON ledger, in order"), async () => {
      const { context, page } = await openApp(browser, size, "{not json");
      const ops = await page.evaluate(() => window.__ops);
      const expected = [
        { op: "set", key: "aranje.probe", ok: true },
        { op: "remove", key: "aranje.probe", ok: true },
        { op: "set", key: ops[2]?.key ?? "", ok: true }, // aranje.corrupt.<now>
        { op: "remove", key: "aranje.song", ok: true },
      ];
      const corruptKeyed = (ops[2]?.key ?? "").startsWith("aranje.corrupt.");
      measurements[`ledger-malformed-${label}`] = ops;
      record(
        at("23 the malformed-JSON ledger, in order"),
        JSON.stringify(ops) === JSON.stringify(expected) && corruptKeyed,
        JSON.stringify(ops),
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 24
    await safe(at("24 the rescued-previous ledger, in order"), async () => {
      const { context, page } = await openApp(
        browser,
        size,
        wrap({ half: "written" }, RESCUED, 6),
      );
      const ops = await page.evaluate(() => window.__ops);
      const shape = ops.map((entry) => `${entry.op}:${entry.key}:${entry.ok}`);
      const corrupt = ops[2]?.key ?? "";
      measurements[`ledger-rescue-${label}`] = ops;
      record(
        at("24 the rescued-previous ledger, in order"),
        shape.length === 4 &&
          shape[0] === "set:aranje.probe:true" &&
          shape[1] === "remove:aranje.probe:true" &&
          corrupt.startsWith("aranje.corrupt.") &&
          shape[2] === `set:${corrupt}:true` &&
          shape[3] === "set:aranje.song:true",
        JSON.stringify(shape),
      );
      await context.close();
    });

    // ----------------------------------------------------------------- 25
    await safe(at("25 a failed repair leaves the file alone and editing closed"), async () => {
      const raw = wrap({ half: "written" }, RESCUED, 6);
      const { context, page, cdp } = await openApp(browser, size, raw, {
        refuseFromStart: "song-only",
      });
      const shown = await banner(page);
      const title = await page.evaluate(
        () => document.querySelector("header h1")?.textContent ?? "",
      );
      const still = await rawKey(page);

      // The rescued song is on screen but nothing can mutate it.
      await press(page, cdp, cell("rhythm", "intro:0"));
      const actionBar = await page.locator("[data-bar-action-bar]").count();

      record(
        at("25 a failed repair leaves the file alone and editing closed"),
        shown?.state === "storage_write_failed" &&
          /Kurtarılan/.test(title) &&
          still === raw &&
          actionBar === 0,
        `${shown?.state}, title="${title}", file untouched=${still === raw}, actionBar=${actionBar}`,
      );
      await page.screenshot({ path: `${OUT}/${label}-repair-failed.png` });
      await context.close();
    });
  }

  await browser.close();
  const failed = results.filter((entry) => !entry.pass).length;
  console.log(`\n${results.length - failed}/${results.length} pass`);
  flush();
  process.exit(failed === 0 ? 0 : 1);
}

await run();
