/**
 * Faz 2J.1 browser verification.
 *
 * Twenty-four scenarios that a unit test cannot answer, because every one is
 * about something that exists only while the app is running: which gesture
 * woke which selection, how many times storage was written, whether a ghost
 * left a trace, where the transport ended up after the bars underneath it
 * moved.
 *
 * Three things are instrumented before any app code runs:
 *
 * - `Storage.prototype.setItem`, so "one apply, one write" is a count.
 * - `AudioContext`, so "no second scheduler" is a count of how many were ever
 *   constructed rather than an impression from sound still coming out.
 * - console and page errors, collected rather than sampled.
 *
 * `node eval/bar-ops/verify.mjs`
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.BAR_OPS_OUT ?? "eval/bar-ops/artifacts";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/bar-ops/fixture-song.json", "utf8").trim();

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

async function safe(name, fn) {
  try {
    return await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 90);
    // What the app looked like when it went wrong, so a timeout says which
    // control was missing rather than only that something was.
    const state = await lastPage
      ?.evaluate(() => ({
        actionBar: document.querySelectorAll("[data-bar-action-bar]").length,
        sheet: document.querySelectorAll("[role=dialog]").length,
        error: document.querySelector("[data-bar-error]")?.textContent ?? null,
        summary: document.querySelector("[data-bar-summary]")?.textContent ?? null,
      }))
      .catch(() => null);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${name.split(" ")[0]}.png` })
      .catch(() => {});
    record(name, false, `${first} :: ${JSON.stringify(state)}`);
    return undefined;
  }
}

/** The page a scenario is working on, for the diagnostic above. */
let lastPage = null;

const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key && String(key).includes("aranje")) window.__writes += 1;
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
  await context.addInitScript(INSTRUMENT);
  await context.addInitScript(
    ([key, songJson]) => {
      try {
        localStorage.setItem(key, songJson);
      } catch {
        /* a private window is not a reason to fail the run */
      }
    },
    ["aranje.song", FIXTURE],
  );
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

/*
 * A real long press.
 *
 * Playwright's mouse API produces no `pointerdown` under touch emulation, so
 * every press here goes through CDP — the same reason the 2I-B and 2J
 * harnesses do.
 */
async function press(page, cdp, selector, ms = 700) {
  await reveal(page, selector);
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box: ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  /*
   * Longer than the app's own post-press click window (400ms), because a
   * finished press arms a one-shot click swallower and a test click issued
   * inside that window would be eaten by it. A person cannot tap that fast;
   * a script can, and the resulting flake is the harness's, not the app's.
   */
  await page.waitForTimeout(550);
}

/**
 * Bring a bar into view before touching it.
 *
 * The arrangement is wider than the phone, so a bar in the third section has a
 * bounding box off the side of the glass. A touch dispatched at those
 * coordinates lands on nothing at all.
 */
async function reveal(page, selector) {
  await page.evaluate((sel) => {
    document
      .querySelector(sel)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, selector);
  await page.waitForTimeout(300);
}

/** Drag a selection handle by whole bars. */
async function dragHandle(page, cdp, edge, dx) {
  const box = await page.locator(`[data-arr-handle=${edge}]`).boundingBox();
  if (!box) throw new Error(`no handle: ${edge}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  /*
   * Small steps on purpose. A handle only ever lands on the bar it is over, so
   * a drag that jumps a whole section in one move lands on nothing and the
   * edge stays where the last usable step put it — which is a property of the
   * gesture, not of the code under test, and would make this measure the
   * harness instead.
   */
  const steps = Math.max(6, Math.ceil(Math.abs(dx) / 24));
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * step) / steps, y }],
    });
    await page.waitForTimeout(12);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
}

const writes = (page) => page.evaluate(() => window.__writes);
const contexts = (page) => page.evaluate(() => window.__audioContexts ?? 0);
const errors = (page) => page.evaluate(() => window.__consoleErrors ?? []);
const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("aranje.song") ?? "null"));
const debugPosition = (page) =>
  page.evaluate(() => window.__aranjeDebug?.position() ?? null);

const text = (page, selector) =>
  page
    .locator(selector)
    .first()
    .textContent()
    .then((value) => (value ?? "").trim())
    .catch(() => null);

const count = (page, selector) => page.locator(selector).count();

const canUndo = (page) =>
  page
    .locator("[aria-label='Son değişikliği geri al']")
    .first()
    .isDisabled()
    .then((disabled) => !disabled)
    .catch(() => false);

const barCount = async (page, sectionId) => {
  const song = await stored(page);
  return song?.sections.find((s) => s.id === sectionId)?.bars.length ?? -1;
};

const cell = (trackId, barKey) => `[data-arr-cell='${trackId}|${barKey}']`;
const barHeader = (barKey) => `[data-arr-bar='${barKey}']`;

/** Dismiss an open sheet through the control a reader would use. */
async function closeSheet(page) {
  const close = page.locator("[role=dialog] [aria-label=Kapat]");
  if (await close.count()) await close.first().click();
  await page.waitForTimeout(300);
}

/** Let go of whatever is held, so the next scenario starts clean. */
async function clearSelection(page) {
  await closeSheet(page);
  const cancel = page.locator(
    "[data-bar-action-bar] [aria-label='Ölçü seçimini iptal et']",
  );
  if (await cancel.count()) await cancel.first().click();
  await page.waitForTimeout(150);
}

async function run() {
  const browser = await chromium.launch();
  const { context, page, cdp } = await openApp(browser);

  // ---------------------------------------------------------------- 1
  await safe("1 a cell press selects that track's bar", async () => {
    await press(page, cdp, cell("rhythm", "intro:0"));
    const summary = await text(page, "[data-bar-summary]");
    record(
      "1 a cell press selects that track's bar",
      summary === "Ritim Gitar · 1 ölçü",
      summary ?? "no action bar",
    );
  });

  // ---------------------------------------------------------------- 2
  await safe("2 no time selection wakes with it", async () => {
    const bands = await count(page, "[data-time-selection]");
    const otherBar = await count(page, "[data-selection-action-bar]");
    record(
      "2 no time selection wakes with it",
      bands === 0 && otherBar === 0,
      `band=${bands} otherBar=${otherBar}`,
    );
  });

  // ---------------------------------------------------------------- 3
  await safe("3 a track selection offers no structural entries", async () => {
    await page.locator("[data-bar-action=more]").click();
    await page.waitForTimeout(300);
    const body = await page.locator("[role=dialog]").innerText();
    const structural = /boş ölçü ekle|Kopyalanan ölçüleri/.test(body);
    record(
      "3 a track selection offers no structural entries",
      !structural,
      body.replace(/\n/g, " | ").slice(0, 80),
    );
    await closeSheet(page);
  });

  // ---------------------------------------------------------------- 4
  await safe("4 a bar-number press selects the whole bar", async () => {
    await clearSelection(page);
    await press(page, cdp, barHeader("intro:0"));
    const summary = await text(page, "[data-bar-summary]");
    record(
      "4 a bar-number press selects the whole bar",
      summary === "Tüm enstrümanlar · 1 ölçü",
      summary ?? "no action bar",
    );
  });

  // ---------------------------------------------------------------- 5
  await safe("5 a handle extends the range by whole bars", async () => {
    const before = await text(page, "[data-bar-summary]");
    // Half a bar to the right: a bar selection has no half-bar to land on.
    await dragHandle(page, cdp, "end", 50);
    const after = await text(page, "[data-bar-summary]");
    record(
      "5 a handle extends the range by whole bars",
      before === "Tüm enstrümanlar · 1 ölçü" && after === "Tüm enstrümanlar · 2 ölçü",
      `${before} -> ${after}`,
    );
  });

  // ---------------------------------------------------------------- 6
  await safe("6 a handle stops at the section boundary", async () => {
    await dragHandle(page, cdp, "end", 1500);
    const after = await text(page, "[data-bar-summary]");
    const error = await text(page, "[data-bar-error]");
    record(
      "6 a handle stops at the section boundary",
      // Giriş has five bars and no chains: the drag runs out of section, and
      // stops there rather than taking the next one.
      after === "Tüm enstrümanlar · 5 ölçü" && error === null,
      `${after} error="${error ?? ""}"`,
    );
  });

  // ---------------------------------------------------------------- 7
  await safe("7 a preview writes nothing at all", async () => {
    await clearSelection(page);
    await press(page, cdp, cell("rhythm", "intro:0"));
    const before = { writes: await writes(page), undo: await canUndo(page) };
    await page.locator("[data-bar-action=cut]").click();
    await page.waitForTimeout(300);
    const preview = await text(page, "[data-bar-preview]");
    const after = { writes: await writes(page), undo: await canUndo(page) };
    record(
      "7 a preview writes nothing at all",
      preview !== null &&
        after.writes === before.writes &&
        after.undo === before.undo,
      `preview="${preview}" writes ${before.writes}->${after.writes}`,
    );
  });

  // ---------------------------------------------------------------- 8
  await safe("8 cancelling leaves the song exactly as found", async () => {
    const before = await stored(page);
    await page.locator("[data-bar-action-bar] button", { hasText: "Vazgeç" }).click();
    await page.waitForTimeout(250);
    const after = await stored(page);
    const previews = await count(page, "[data-bar-preview]");
    record(
      "8 cancelling leaves the song exactly as found",
      previews === 0 && JSON.stringify(before) === JSON.stringify(after),
      `preview gone=${previews === 0}`,
    );
  });

  // ---------------------------------------------------------------- 9
  await safe("9 copy alone never writes", async () => {
    const before = await writes(page);
    await page.locator("[data-bar-action=copy]").click();
    await page.waitForTimeout(300);
    const notice = await text(page, "[data-bar-notice]");
    record(
      "9 copy alone never writes",
      (await writes(page)) === before,
      `notice="${notice}"`,
    );
  });

  // ---------------------------------------------------------------- 10
  await safe("10 pasting into an empty bar is one write, one undo", async () => {
    await clearSelection(page);
    await press(page, cdp, cell("rhythm", "intro:1"));
    const before = await writes(page);
    await page.locator("[data-bar-action=more]").click();
    await page.waitForTimeout(300);
    await page.locator("[role=dialog] button", { hasText: "Buraya yapıştır" }).click();
    await page.waitForTimeout(300);
    await page.locator("[data-bar-apply]").click();
    await page.waitForTimeout(400);
    const song = await stored(page);
    const written = song?.sections[0]?.bars[1]?.slots?.rhythm ?? null;
    record(
      "10 pasting into an empty bar is one write, one undo",
      (await writes(page)) === before + 1 && Array.isArray(written) && (await canUndo(page)),
      `writes ${before}->${await writes(page)} rhythm=${written ? "written" : "absent"}`,
    );
  });

  // ---------------------------------------------------------------- 11
  await safe("11 an occupied target asks before overwriting", async () => {
    await clearSelection(page);
    await press(page, cdp, cell("rhythm", "intro:3"));
    await page.locator("[data-bar-action=more]").click();
    await page.waitForTimeout(300);
    const offered = await count(page, "[role=dialog] button:has-text('Buraya yapıştır')");
    if (offered) {
      await page.locator("[role=dialog] button", { hasText: "Buraya yapıştır" }).click();
    }
    await page.waitForTimeout(300);
    const preview = await text(page, "[data-bar-preview]");
    const replace = await count(page, "[data-bar-replace]");
    const apply = await count(page, "[data-bar-apply]");
    record(
      "11 an occupied target asks before overwriting",
      preview === "Hedefte içerik var." && replace === 1 && apply === 0,
      `preview="${preview}" replace=${replace} apply=${apply}`,
    );
  });

  // ---------------------------------------------------------------- 12
  await safe("12 the answer is one write, not two", async () => {
    const before = await writes(page);
    await page.locator("[data-bar-replace]").click();
    await page.waitForTimeout(400);
    record(
      "12 the answer is one write, not two",
      (await writes(page)) === before + 1,
      `writes ${before}->${await writes(page)}`,
    );
  });

  // ---------------------------------------------------------------- 13
  await safe("13 a grid the target cannot write is refused, not rounded", async () => {
    await clearSelection(page);
    // The triplet bar, copied on to an eighth-note bar.
    await press(page, cdp, cell("rhythm", "intro:2"));
    await page.locator("[data-bar-action=copy]").click();
    await page.waitForTimeout(300);
    await clearSelection(page);
    await press(page, cdp, cell("rhythm", "intro:4"));
    await page.locator("[data-bar-action=more]").click();
    await page.waitForTimeout(300);
    await page.locator("[role=dialog] button", { hasText: "Buraya yapıştır" }).click();
    await page.waitForTimeout(300);
    const preview = await text(page, "[data-bar-preview]");
    const apply = await count(page, "[data-bar-apply]");
    const replace = await count(page, "[data-bar-replace]");
    record(
      "13 a grid the target cannot write is refused, not rounded",
      preview === "Kopyalanan ölçü hedef ölçünün ritim aralığına tam oturmuyor." &&
        replace === 0 &&
        apply === 1,
      `preview="${preview}"`,
    );
  });

  // ---------------------------------------------------------------- 14
  await safe("14 a chain widens the selection and says so", async () => {
    await clearSelection(page);
    await press(page, cdp, cell("rhythm", "chorus:1"));
    const summary = await text(page, "[data-bar-summary]");
    const notice = await text(page, "[data-bar-notice]");
    record(
      "14 a chain widens the selection and says so",
      summary === "Ritim Gitar · 2 ölçü" &&
        notice === "Bağlantılı notalar nedeniyle seçim 2 ölçüye genişletildi.",
      `${summary} / ${notice}`,
    );
  });

  // ---------------------------------------------------------------- 15
  await safe("15 a chain out of the section is refused outright", async () => {
    await clearSelection(page);
    const before = {
      writes: await writes(page),
      undo: await canUndo(page),
      song: JSON.stringify(await stored(page)),
    };
    await press(page, cdp, cell("rhythm", "outro:0"));
    const error = await text(page, "[data-bar-error]");
    const bar = await count(page, "[data-bar-action-bar]");
    const after = {
      writes: await writes(page),
      undo: await canUndo(page),
      song: JSON.stringify(await stored(page)),
    };
    record(
      "15 a chain out of the section is refused outright",
      /Bölüm sınırını aşan ölçü taşıma henüz desteklenmiyor/.test(error ?? "") &&
        bar === 0 &&
        after.writes === before.writes &&
        after.undo === before.undo &&
        after.song === before.song,
      `error="${(error ?? "").slice(0, 60)}" actionBar=${bar}`,
    );
  });

  // ---------------------------------------------------------------- 16
  await safe("16 a track delete empties the bar and keeps it", async () => {
    await clearSelection(page);
    const bars = await barCount(page, "chorus");
    await press(page, cdp, cell("rhythm", "chorus:0"));
    await page.locator("[data-bar-action=delete]").click();
    await page.waitForTimeout(300);
    await page.locator("[data-bar-apply]").click();
    await page.waitForTimeout(400);
    const song = await stored(page);
    const slots = song?.sections[1]?.bars[0]?.slots ?? {};
    const rhythm = slots.rhythm ?? [];
    const sounding = rhythm.filter((slot) => slot && slot !== "-").length;
    record(
      "16 a track delete empties the bar and keeps it",
      (await barCount(page, "chorus")) === bars &&
        sounding === 0 &&
        Array.isArray(slots.drums),
      `bars ${bars} sounding=${sounding} drums kept=${Array.isArray(slots.drums)}`,
    );
  });

  // ---------------------------------------------------------------- 17
  await safe("17 a full delete removes the bar", async () => {
    await clearSelection(page);
    const bars = await barCount(page, "chorus");
    await press(page, cdp, barHeader("chorus:0"));
    await page.locator("[data-bar-action=delete]").click();
    await page.waitForTimeout(300);
    await page.locator("[data-bar-apply]").click();
    await page.waitForTimeout(500);
    const now = await barCount(page, "chorus");
    record("17 a full delete removes the bar", now === bars - 1, `${bars} -> ${now}`);
  });

  // ---------------------------------------------------------------- 18
  await safe("18 a structural edit pauses and starts no second engine", async () => {
    await clearSelection(page);
    /*
     * Somewhere that is not the top of the song, and not in the section about
     * to change. "The playhead survived" is not a claim you can test from bar
     * one: bar one is also where a transport that lost its place would be.
     */
    await reveal(page, barHeader("chorus:1"));
    await page.locator(barHeader("chorus:1")).click();
    await page.waitForTimeout(300);
    await page.locator("[aria-label=Çal]").first().click();
    await page.waitForTimeout(900);
    const built = await contexts(page);
    const playing = await page.evaluate(() => window.__aranjeDebug?.status());
    measurements.playheadBefore = await debugPosition(page);
    await press(page, cdp, barHeader("intro:1"));
    await page.locator("[data-bar-action=more]").click();
    await page.waitForTimeout(300);
    await page.locator("[role=dialog] button", { hasText: "Önüne boş ölçü ekle" }).click();
    await page.waitForTimeout(300);
    await page.locator("[data-bar-apply]").click();
    await page.waitForTimeout(700);
    const status = await page.evaluate(() => window.__aranjeDebug?.status());
    const after = await contexts(page);
    measurements.audioContexts = { before: built, after };
    record(
      "18 a structural edit pauses and starts no second engine",
      playing === "playing" && status !== "playing" && after === built,
      `status ${playing} -> ${status}, contexts ${built} -> ${after}`,
    );
  });

  // ---------------------------------------------------------------- 19
  await safe("19 a blank bar carries no track keys", async () => {
    const song = await stored(page);
    const blank = song?.sections[0]?.bars[1];
    const keys = Object.keys(blank?.slots ?? {});
    const neighbour = song?.sections[0]?.bars[0];
    record(
      "19 a blank bar carries no track keys",
      keys.length === 0 &&
        blank?.resolution === neighbour?.resolution &&
        JSON.stringify(blank?.timeSignature) === JSON.stringify(neighbour?.timeSignature) &&
        blank?.bpmOverride === undefined,
      `keys=[${keys}] res=${blank?.resolution} ts=${JSON.stringify(blank?.timeSignature)}`,
    );
  });

  // ---------------------------------------------------------------- 20
  await safe("20 the playhead lands on a bar that exists", async () => {
    /*
     * The transport has no engine between a song change and the next play, so
     * the question is not where the playhead *is* — it is where the music
     * resumes from. That is the moment the normalisation has to have survived.
     */
    await page.locator("[aria-label=Çal]").first().click();
    await page.waitForTimeout(400);
    const at = await debugPosition(page);
    const song = await stored(page);
    const keys = new Set(
      song.sections.flatMap((section) =>
        section.bars.map((_, index) => `${section.id}:${index}`),
      ),
    );
    const was = measurements.playheadBefore;
    measurements.playheadAfter = at;
    record(
      "20 the playhead lands on a bar that exists",
      at?.barKey != null &&
        keys.has(at.barKey) &&
        /*
         * The bar it was on, give or take the one the music has moved on to
         * while resuming — the playhead was deliberately left in a *different*
         * section from the edit, so a transport that lost its place would come
         * back at the top of the song and fail this outright.
         */
        at.barKey.split(":")[0] === was?.barKey?.split(":")[0] &&
        Math.abs(
          Number(at.barKey.split(":")[1]) - Number(was?.barKey?.split(":")[1]),
        ) <= 1,
      `${was?.barKey} -> ${at?.barKey}`,
    );
    await page.locator("[aria-label=Duraklat]").first().click().catch(() => {});
    await page.waitForTimeout(300);
  });

  // ---------------------------------------------------------------- 21
  await safe("21 a section can never be emptied", async () => {
    await clearSelection(page);
    const { context: c2, page: p2, cdp: d2 } = await openApp(browser);
    // Take the whole of Giriş: four bars, which is all of it.
    await press(p2, d2, barHeader("intro:0"));
    await dragHandle(p2, d2, "end", 1500);
    const held = await text(p2, "[data-bar-summary]");
    await p2.locator("[data-bar-action=delete]").click();
    await p2.waitForTimeout(300);
    const preview = await text(p2, "[data-bar-preview]");
    const apply = await count(p2, "[data-bar-apply]");
    const disabled = apply
      ? await p2.locator("[data-bar-apply]").isDisabled()
      : false;
    record(
      "21 a section can never be emptied",
      held === "Tüm enstrümanlar · 5 ölçü" &&
        preview === "Bir bölüm en az bir ölçü taşımalı." &&
        disabled,
      `held=${held} preview="${preview}" applyDisabled=${disabled}`,
    );
    await c2.close();
  });

  // ---------------------------------------------------------------- 22
  await safe("22 a tab bar-header press selects the active track", async () => {
    const { context: c3, page: p3, cdp: d3 } = await openApp(browser);
    await p3.locator("[data-testid=view-tab]").click();
    await p3.waitForTimeout(400);
    const header = await p3.locator("[data-tab-bar-header]").first().getAttribute("data-tab-bar-header");
    await press(p3, d3, `[data-tab-bar-header='${header}']`);
    const summary = await text(p3, "[data-bar-summary]");
    const bands = await count(p3, "[data-time-selection]");
    record(
      "22 a tab bar-header press selects the active track",
      summary === "Ritim Gitar · 1 ölçü" && bands === 0,
      `summary=${summary} bands=${bands} header=${header}`,
    );
    await c3.close();
  });

  // ---------------------------------------------------------------- 23
  await safe("23 a full selection is never offered a track clipboard", async () => {
    const { context: c4, page: p4, cdp: d4 } = await openApp(browser);
    await press(p4, d4, cell("rhythm", "intro:0"));
    await p4.locator("[data-bar-action=copy]").click();
    await p4.waitForTimeout(300);
    await clearSelection(p4);
    await press(p4, d4, barHeader("intro:1"));
    await p4.locator("[data-bar-action=more]").click();
    await p4.waitForTimeout(300);
    const body = await p4.locator("[role=dialog]").innerText();
    record(
      "23 a full selection is never offered a track clipboard",
      !/Buraya yapıştır|Kopyalanan ölçüleri/.test(body),
      body.replace(/\n/g, " | ").slice(0, 80),
    );
    await c4.close();
  });

  // ---------------------------------------------------------------- 24
  await safe("24 the reader's words, from the one table", async () => {
    const { context: c5, page: p5 } = await openApp(browser);
    await p5.locator("[data-testid=view-tab]").click();
    await p5.waitForTimeout(300);
    await p5.locator("[data-track-control]").click();
    await p5.waitForTimeout(400);
    const body = await p5.locator("[role=dialog]").innerText();
    const heading = await p5.locator("#track-sheet-title").textContent().catch(() => null);
    record(
      "24 the reader's words, from the one table",
      heading?.trim() === "Enstrümanlar" &&
        /High gain/.test(body) &&
        !/Yüksek gain/.test(body),
      `title="${heading?.trim()}" highGain=${/High gain/.test(body)}`,
    );
    await p5.screenshot({ path: `${OUT}/390x844-tracks.png` });
    await c5.close();
  });

  // ---------------------------------------------------------------- 25
  await safe("25 the drum lane is a track like any other", async () => {
    const { context: c6, page: p6, cdp: d6 } = await openApp(browser);
    await press(p6, d6, cell("drums", "intro:0"));
    const summary = await text(p6, "[data-bar-summary]");
    await p6.locator("[data-bar-action=copy]").click();
    await p6.waitForTimeout(300);
    const notice = await text(p6, "[data-bar-notice]");
    const before = await writes(p6);
    await clearSelection(p6);
    await press(p6, d6, cell("drums", "intro:1"));
    await p6.locator("[data-bar-action=more]").click();
    await p6.waitForTimeout(300);
    await p6.locator("[role=dialog] button", { hasText: "Buraya yapıştır" }).click();
    await p6.waitForTimeout(300);
    await p6.locator("[data-bar-replace]").click().catch(async () => {
      await p6.locator("[data-bar-apply]").click();
    });
    await p6.waitForTimeout(400);
    const song = await stored(p6);
    const target = song?.sections[0]?.bars[1]?.slots?.drums ?? null;
    record(
      "25 the drum lane is a track like any other",
      summary === "Davul · 1 ölçü" &&
        notice === "Ölçüler kopyalandı." &&
        (await writes(p6)) === before + 1 &&
        Array.isArray(target) &&
        target.some((slot) => slot.length > 0),
      `summary=${summary} pasted=${Array.isArray(target)}`,
    );
    await c6.close();
  });

  // ---------------------------------------------------------------- 26
  await safe("26 a track repeat fills without growing the section", async () => {
    const { context: c7, page: p7, cdp: d7 } = await openApp(browser);
    const bars = await barCount(p7, "intro");
    await press(p7, d7, cell("rhythm", "intro:0"));
    await p7.locator("[data-bar-action=repeat]").click();
    await p7.waitForTimeout(300);
    const offered = await p7.locator("[role=dialog]").innerText();
    await p7.locator("[role=dialog] button", { hasText: "Bölüm sonuna kadar" }).click();
    await p7.waitForTimeout(300);
    const preview = await text(p7, "[data-bar-preview]");
    // Bar 4 of Giriş already carries the rhythm, so filling collides with it —
    // which is the honest answer, not a silent overwrite.
    record(
      "26 a track repeat fills without growing the section",
      /Bölüm sonuna kadar/.test(offered) &&
        preview === "Hedefte içerik var." &&
        (await barCount(p7, "intro")) === bars,
      `preview="${preview}" bars=${bars}`,
    );
    await c7.close();
  });

  // ---------------------------------------------------------------- 27
  await safe("27 a preview does not stop the music", async () => {
    const { context: c8, page: p8, cdp: d8 } = await openApp(browser);
    await press(p8, d8, barHeader("intro:1"));
    await p8.locator("[aria-label=Çal]").first().click();
    await p8.waitForTimeout(900);
    const before = {
      status: await p8.evaluate(() => window.__aranjeDebug?.status()),
      writes: await writes(p8),
    };
    await p8.locator("[data-bar-action=delete]").click();
    await p8.waitForTimeout(500);
    const preview = await text(p8, "[data-bar-preview]");
    const after = {
      status: await p8.evaluate(() => window.__aranjeDebug?.status()),
      writes: await writes(p8),
    };
    record(
      "27 a preview does not stop the music",
      before.status === "playing" &&
        preview !== null &&
        after.status === "playing" &&
        after.writes === before.writes,
      `status ${before.status} -> ${after.status}, preview="${preview}"`,
    );
    await c8.close();
  });

  // ---------------------------------------------------- screenshots
  await safe("screenshots", async () => {
    for (const [label, size] of [
      ["390x844", { width: 390, height: 844 }],
      ["320x700", { width: 320, height: 700 }],
    ]) {
      const { context: cs, page: ps, cdp: ds } = await openApp(browser, size);
      await ps.screenshot({ path: `${OUT}/${label}-arrange.png` });

      await press(ps, ds, cell("rhythm", "intro:0"));
      await ps.screenshot({ path: `${OUT}/${label}-track-selection.png` });
      await clearSelection(ps);

      await press(ps, ds, barHeader("intro:1"));
      await dragHandle(ps, ds, "end", 50);
      await ps.screenshot({ path: `${OUT}/${label}-full-selection.png` });

      await ps.locator("[data-bar-action=delete]").click();
      await ps.waitForTimeout(300);
      await ps.screenshot({ path: `${OUT}/${label}-ghost.png` });

      await ps.locator("[data-bar-action-bar] button", { hasText: "Vazgeç" }).click();
      await ps.locator("[data-bar-action=more]").click();
      await ps.waitForTimeout(400);
      await ps.screenshot({ path: `${OUT}/${label}-more.png` });

      measurements[`layout-${label}`] = await ps.evaluate(() => {
        const box = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return { h: Math.round(rect.height), w: Math.round(rect.width) };
        };
        return {
          work: box("main"),
          actionBar: box("[data-bar-action-bar]"),
          barStrip: box("[data-arr-bar]"),
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          small: [
            ...document.querySelectorAll(
              "[data-bar-action], [data-arr-handle], [data-arr-bar], [data-bar-apply], [data-bar-replace]",
            ),
          ]
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return {
                id:
                  node.getAttribute("data-bar-action") ??
                  node.getAttribute("data-arr-handle") ??
                  node.getAttribute("data-arr-bar") ??
                  "apply",
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              };
            })
            .filter((entry) => entry.h < 43.5),
        };
      });
      await cs.close();
    }
    record(
      "screenshots and measurements",
      Object.keys(measurements).filter((key) => key.startsWith("layout-")).length === 2,
      JSON.stringify(measurements["layout-320x700"]?.work ?? null),
    );
  });

  // ------------------------------------------------------------ errors
  const consoleErrors = await errors(page);
  record(
    "console stayed quiet",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(" | ").slice(0, 100),
  );

  await context.close();
  await browser.close();

  const failed = results.filter((entry) => !entry.pass).length;
  console.log(`\n${results.length - failed}/${results.length} pass`);
  flush();
  process.exit(failed === 0 ? 0 : 1);
}

await run();
