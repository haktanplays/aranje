/**
 * Faz 2L-R browser regression: the same app, after the decomposition.
 *
 * Twenty scenarios in two viewports over every flow the refactor touched —
 * navigation, playback across view switches, both selection models, note
 * editing, undo/redo, the Copilot demo loop, the project file, recovery and
 * the storage gate. Console and page errors are asserted at the end of every
 * viewport: a refactor that logs is a refactor that broke something quietly.
 *
 *   NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true next build && next start on :3100
 *   node eval/orchestration-refactor/verify.mjs
 *
 * The demo flag is baked at build time; scenario 11 exercises the Copilot's
 * deterministic demo loop and needs it.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectPageErrors,
  layoutProbe,
  makeRecorder,
  mobileContext,
  press,
  targetEdges,
} from "../shared/harness.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/orchestration-refactor/artifacts";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/bar-ops/fixture-song.json", "utf8").trim();
const FIXTURE_SONG = JSON.parse(FIXTURE);

const importFile = join(tmpdir(), "aranje-2lr-import.aranje.json");
writeFileSync(
  importFile,
  JSON.stringify({
    format: "aranje.project",
    version: 1,
    song: { ...FIXTURE_SONG, title: "Regresyon Projesi" },
  }),
  "utf8",
);

const { measurements, record, flush, results } = makeRecorder(
  writeFileSync,
  `${OUT}/RESULTS.json`,
);

let lastPage = null;
async function safe(name, fn) {
  try {
    return await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 110);
    await lastPage?.screenshot({ path: `${OUT}/failed-${name.split(" ")[0]}.png` }).catch(() => {});
    record(name, false, first);
    return undefined;
  }
}

const INSTRUMENT = `
  window.__writes = 0;
  window.__audioContexts = 0;
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSet.call(this, key, value);
    if (key === "aranje.song") window.__writes += 1;
  };
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

const REFUSE_WRITE_CHECK = `
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "aranje.probe") {
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    }
    originalSet.call(this, key, value);
  };
`;

async function openApp(browser, size, options = {}) {
  const context = await mobileContext(browser, size);
  await context.addInitScript(
    ([key, value]) => {
      try {
        if (sessionStorage.getItem("aranje.harness.seeded") === "1") return;
        sessionStorage.setItem("aranje.harness.seeded", "1");
        localStorage.setItem(key, value);
      } catch {
        /* private windows do not fail the run */
      }
    },
    ["aranje.song", options.seed ?? FIXTURE],
  );
  await context.addInitScript(INSTRUMENT);
  if (options.refuseWriteCheck) await context.addInitScript(REFUSE_WRITE_CHECK);
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(9000);
  const errors = collectPageErrors(page);
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors };
}

/** Put down anything a failed scenario may have left on the screen. */
async function settle(page) {
  for (const selector of [
    "[role=dialog] [aria-label=Kapat]",
    "[aria-label='Seçimi iptal et']",
    "[aria-label='Ölçü seçimini iptal et']",
  ]) {
    const control = page.locator(selector);
    if (await control.count()) {
      await control.first().click({ position: { x: 8, y: 8 } }).catch(() => {});
    }
  }
  await page.waitForTimeout(200);
}

/** A long press at explicit page coordinates, through CDP touch events. */
async function pressAt(page, cdp, x, y, ms = 700) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(550);
}

const writes = (page) => page.evaluate(() => window.__writes);
const title = (page) => page.locator("h1").first().textContent();
const debug = (page) =>
  page.evaluate(() => ({
    status: window.__aranjeDebug?.status() ?? null,
    ticks: window.__aranjeDebug?.ticks() ?? null,
    position: window.__aranjeDebug?.position() ?? null,
    loop: window.__aranjeDebug?.loop() ?? null,
  }));

async function switchView(page, id) {
  await page.locator(`[data-testid=view-${id}]`).click();
  await page.waitForSelector(
    id === "tab" ? "[data-tab-content]" : "[data-arrangement-scroller]",
  );
  await page.waitForTimeout(200);
}

async function run(browser, size, label) {
  const at = (name) => `${label} ${name}`;
  const { context, page, cdp, errors } = await openApp(browser, size);

  /* 1 — first open: the arrangement, the song, no banner, no error. */
  await safe(at("01 opening lands on the arrangement"), async () => {
    record(
      at("01 opening lands on the arrangement"),
      (await title(page)) === "Ölçü İşlemleri Fikstürü" &&
        (await page.locator("[data-recovery-banner]").count()) === 0 &&
        (await page.locator("[data-arr-track]").count()) > 0,
    );
  });

  /* 2 — view switching, both directions. */
  await safe(at("02 tab and arrangement swap cleanly"), async () => {
    await switchView(page, "tab");
    const tabShown = (await page.locator("[data-tab-content]").count()) === 1;
    const arrGone = (await page.locator("[data-arrangement-scroller]").count()) === 0;
    await switchView(page, "arrange");
    record(
      at("02 tab and arrangement swap cleanly"),
      tabShown && arrGone &&
        (await page.locator("[data-arrangement-scroller]").count()) === 1,
    );
  });

  /* 3 — three view switches during playback: one context, still playing. */
  await safe(at("03 playback survives three view switches"), async () => {
    await page.locator("[aria-label='Çal']").click();
    await page.waitForFunction(() => window.__aranjeDebug?.status() === "playing", null, {
      timeout: 30000,
    });
    await switchView(page, "tab");
    await switchView(page, "arrange");
    await switchView(page, "tab");
    const state = await debug(page);
    const contexts = await page.evaluate(() => window.__audioContexts);
    await switchView(page, "arrange");
    record(
      at("03 playback survives three view switches"),
      state.status === "playing" && contexts === 1,
      `status ${state.status}, contexts ${contexts}`,
    );
    await page.locator("[aria-label='Duraklat']").click();
  });

  /* 4 — section navigation scrolls the structure without seeking. */
  await safe(at("04 section navigation scrolls, does not seek"), async () => {
    const before = await debug(page);
    const scrolled = await page.evaluate(() => {
      const scroller = document.querySelector("[data-arrangement-scroller]");
      const start = scroller.scrollLeft;
      return { start };
    });
    const sections = page.locator("[data-arr-section]");
    await sections.last().click();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({
      left: document.querySelector("[data-arrangement-scroller]").scrollLeft,
    }));
    const now = await debug(page);
    record(
      at("04 section navigation scrolls, does not seek"),
      after.left > scrolled.start && now.ticks === before.ticks,
      `scroll ${scrolled.start} → ${after.left}`,
    );
    await page.evaluate(() => {
      document.querySelector("[data-arrangement-scroller]").scrollLeft = 0;
    });
  });

  /* 5 — a bar-number tap moves the transport and stays here. */
  await safe(at("05 a bar tap seeks the transport"), async () => {
    await page.locator("[data-arr-bar='intro:1']").click();
    await page.waitForTimeout(300);
    const state = await debug(page);
    record(
      at("05 a bar tap seeks the transport"),
      state.position?.barKey === "intro:1" &&
        (await page.locator("[data-arrangement-scroller]").count()) === 1,
      JSON.stringify(state.position),
    );
  });

  /* 6 — track selection. */
  await safe(at("06 selecting a track marks it"), async () => {
    await page.locator("[data-arr-track='lead']").click();
    await page.waitForTimeout(200);
    record(
      at("06 selecting a track marks it"),
      (await page.locator("[data-arr-track='lead']").getAttribute("aria-pressed")) ===
        "true",
    );
    await page.locator("[data-arr-track='rhythm']").click();
    await page.waitForTimeout(200);
  });

  /* 7 — a note edit through the fret sheet is one write. */
  await safe(at("07 a note edit commits once"), async () => {
    await switchView(page, "tab");
    await page.locator("[data-action-row] button:has-text('Düzenle')").click();
    await page.waitForTimeout(300);
    // An empty slot, so a written fret is always a change, never a no-op.
    await page
      .locator("[data-bar-key='intro:0'] [data-cell]:not([data-onset])")
      .first()
      .click();
    await page.waitForSelector("#fret-input");
    const before = await writes(page);
    await page.locator("#fret-input").fill("3");
    await page.locator("button:has-text('Ekle'), button:has-text('Güncelle')").first().click();
    await page.waitForTimeout(500);
    const after = await writes(page);
    record(
      at("07 a note edit commits once"),
      after === before + 1 && !(await page.locator("[data-undo]").isDisabled()),
      `writes ${before} → ${after}`,
    );
    await page.locator("[role=dialog] button:has-text('Kapat')").first().click();
    await page.waitForTimeout(200);
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(300);
    await page
      .locator("[data-action-row] button:has-text('Düzenlemeyi bitir')")
      .click();
    await page.waitForTimeout(200);
  });

  /* 8 — a time selection opens its action bar; delete applies and undoes. */
  await safe(at("08 time selection and transform"), async () => {
    // The first slot of the first bar: the fixture writes music there, so a
    // delete has something to delete and is never a refusal.
    const bar = await page.locator("[data-bar-key='intro:0']").first().boundingBox();
    await pressAt(page, cdp, bar.x + 8, bar.y + bar.height * 0.6);
    await page.waitForSelector("[data-testid=selection-action-bar]");
    const before = await writes(page);
    await page.locator("[data-testid=selection-action-delete]").click();
    await page.waitForTimeout(400);
    record(
      at("08 time selection and transform"),
      (await writes(page)) === before + 1,
    );
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(300);
    await settle(page);
  });

  /* 9-10 — a full-bar delete, then undo/redo with surfaces down. */
  await safe(at("09 full-bar operation applies"), async () => {
    await switchView(page, "arrange");
    const barsBefore = await page.locator("[data-arr-bar]").count();
    await press(page, cdp, "[data-arr-bar='intro:2']");
    await page.waitForSelector("[data-bar-action-bar]");
    await page.locator("[data-bar-action=delete]").click();
    await page.waitForTimeout(300);
    const before = await writes(page);
    await page.locator("[data-bar-apply]").click();
    await page.waitForTimeout(500);
    record(
      at("09 full-bar operation applies"),
      (await writes(page)) === before + 1 &&
        (await page.locator("[data-arr-bar]").count()) === barsBefore - 1,
    );

    const undoLabel = await page.locator("[data-undo]").getAttribute("aria-label");
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(400);
    const restored = (await page.locator("[data-arr-bar]").count()) === barsBefore;
    // The selection surfaces go down with the undo (2L-R probe target).
    const surfacesDown =
      (await page.locator("[data-bar-action-bar]").count()) === 0 &&
      (await page.locator("[data-testid=selection-action-bar]").count()) === 0;
    await page.locator("[data-redo]").click();
    await page.waitForTimeout(400);
    record(
      at("10 undo and redo carry the structure"),
      restored &&
        surfacesDown &&
        undoLabel === "Geri al: Ölçüleri silme" &&
        (await page.locator("[data-arr-bar]").count()) === barsBefore - 1,
      `label ${undoLabel}`,
    );
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(400);
  });

  /* 11 — the Copilot demo: request, preview, reject; request, apply, undo. */
  await safe(at("11 copilot demo previews, rejects and applies"), async () => {
    await settle(page);
    await switchView(page, "tab");
    const requestSuggestion = async () => {
      await page.locator("[data-action-row] button:has-text('Aranje et')").click();
      await page.waitForSelector("text=Öneri iste");
      // The form drafts against the song it first mounted with; picking the
      // section and the target explicitly is the same pair of taps a reader
      // makes.
      await page.getByRole("button", { name: "Giriş", exact: true }).click();
      await page.getByRole("button", { name: "Ritim Gitar", exact: true }).click();
      await page.locator("button:has-text('Öneri iste')").click();
    };

    await requestSuggestion();
    await page.waitForSelector("button:has-text('Uygula')", { timeout: 20000 });
    await page.locator("button:has-text('Reddet')").click();
    await page.waitForTimeout(400);
    const rejected = (await page.locator("button:has-text('Uygula')").count()) === 0;

    await requestSuggestion();
    await page.waitForSelector("button:has-text('Uygula')", { timeout: 20000 });
    const before = await writes(page);
    await page.locator("button:has-text('Uygula')").click();
    await page.waitForTimeout(600);
    const applied = (await writes(page)) === before + 1;
    const undoLabel = await page.locator("[data-undo]").getAttribute("aria-label");
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(400);
    record(
      at("11 copilot demo previews, rejects and applies"),
      rejected && applied && undoLabel === "Geri al: Aranje önerisini uygulama",
      `rejected ${rejected}, applied ${applied}, ${undoLabel}`,
    );
  });

  /* 12 — project backup downloads. */
  await safe(at("12 the project backup downloads"), async () => {
    await settle(page);
    await switchView(page, "arrange");
    await page.locator("[aria-label='Ses kaynakları ve lisans']").click();
    await page.waitForSelector("[data-info-project-backup]");
    const waiting = page.waitForEvent("download");
    await page.locator("[data-info-project-backup]").click();
    const download = await waiting;
    const text = readFileSync(await download.path(), "utf8");
    record(
      at("12 the project backup downloads"),
      JSON.parse(text).format === "aranje.project",
    );
  });

  /* 13 — import: preview, cancel, apply. */
  await safe(at("13 project import previews, cancels, applies"), async () => {
    await page.locator("[data-info-project-open]").click();
    await page.waitForSelector("[data-project-sheet]");
    await page.locator("[data-project-file-input]").setInputFiles(importFile);
    await page.waitForSelector("[data-project-preview]");
    await page.locator("[data-project-cancel]").click();
    await page.waitForTimeout(200);
    const cancelled = (await page.locator("[data-project-preview]").count()) === 0;

    await page.locator("[data-project-file-input]").setInputFiles(importFile);
    await page.waitForSelector("[data-project-preview]");
    await page.locator("[data-project-apply]").click();
    await page.waitForTimeout(600);
    record(
      at("13 project import previews, cancels, applies"),
      cancelled && (await title(page)) === "Regresyon Projesi",
    );
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(400);
  });

  /* 16 — loop arms on the active section and disarms. */
  await safe(at("16 the loop arms and disarms"), async () => {
    await settle(page);
    await page.locator("[aria-label='Bölüm döngüsü']").click();
    await page.waitForTimeout(300);
    const on = (await debug(page)).loop;
    await page.locator("[aria-label='Bölüm döngüsü']").click();
    await page.waitForTimeout(300);
    record(
      at("16 the loop arms and disarms"),
      on !== null && (await debug(page)).loop === null,
      JSON.stringify(on),
    );
  });

  /* 17 — practice rate: a step from the sheet reaches the transport pill. */
  await safe(at("17 practice rate steps from its sheet"), async () => {
    await settle(page);
    const pill = () =>
      page.locator("[aria-label*='Çalışma hızı yüzde']").getAttribute("aria-label");
    const before = await pill();
    await page.locator("[aria-label*='Çalışma hızı yüzde']").click();
    await page.waitForSelector("[role=group][aria-label='Çalışma hızı']");
    await page.locator("[aria-label^='Çalışma hızını yüzde'][aria-label$='azalt']").click();
    await page.waitForTimeout(300);
    const stepped = await pill();
    await page
      .locator("[aria-label*='Çalışma hızını yüzde'][aria-label$='yap']")
      .click();
    await page.waitForTimeout(200);
    await page.locator("[role=dialog] [aria-label=Kapat]").first().click();
    await page.waitForTimeout(200);
    record(
      at("17 practice rate steps from its sheet"),
      before !== null && stepped !== null && stepped !== before,
      `${before} → ${stepped}`,
    );
  });

  /* 18 — sheets open and close: track, section. */
  await safe(at("18 sheets open and close"), async () => {
    await settle(page);
    await switchView(page, "tab");
    await page.locator("[data-track-control]").click();
    await page.waitForTimeout(300);
    const trackSheet = (await page.locator("[role=dialog]").count()) > 0;
    await page.locator("[role=dialog] [aria-label=Kapat]").first().click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(200);
    await page.locator("[aria-label$='Tüm bölümler']").click();
    await page.waitForTimeout(300);
    const sectionSheet = (await page.locator("[role=dialog]").count()) > 0;
    await page.locator("[role=dialog] [aria-label=Kapat]").first().click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(200);
    await switchView(page, "arrange");
    record(at("18 sheets open and close"), trackSheet && sectionSheet);
  });

  /* 19/20 — layout on this viewport. */
  await safe(at("19 layout holds"), async () => {
    const layout = await layoutProbe(page);
    const targets = await targetEdges(page, [
      "[data-testid=view-arrange]",
      "[data-testid=view-tab]",
      "[aria-label='Çal']",
      "[data-undo]",
      "[data-redo]",
    ]);
    measurements[`${label}-layout`] = { ...layout, targets };
    record(
      at("19 layout holds"),
      layout.bodyOverflow === 0 && layout.scrollers === 1 &&
        targets.every((edge) => edge >= 43.5),
      JSON.stringify({ ...layout, targets }),
    );
    await page.screenshot({ path: `${OUT}/regression-${label}.png` });
  });

  /* Console and page errors, across everything above. */
  await safe(at("20 zero console and page errors"), async () => {
    record(at("20 zero console and page errors"), errors().length === 0, errors()[0] ?? "");
  });

  await context.close();

  /* 14 — a corrupt file shows the recovery banner, dismissibly. */
  await safe(at("14 recovery banner on a corrupt file"), async () => {
    const broken = await openApp(browser, size, { seed: "bozuk {" });
    lastPage = broken.page;
    const state = await broken.page.evaluate(() =>
      document.querySelector("[data-recovery-banner]")?.getAttribute("data-recovery-banner"),
    );
    const dismissible =
      (await broken.page.locator("[data-recovery-dismiss]").count()) === 1;
    await broken.page.locator("[data-recovery-dismiss]").click();
    await broken.page.waitForTimeout(200);
    record(
      at("14 recovery banner on a corrupt file"),
      state === "corrupt_fallback" &&
        dismissible &&
        (await broken.page.locator("[data-recovery-banner]").count()) === 0,
      String(state),
    );
    await broken.context.close();
  });

  /* 15 — no storage: read-only, playable, non-dismissible banner. */
  await safe(at("15 the storage gate closes editing only"), async () => {
    const gated = await openApp(browser, size, { refuseWriteCheck: true });
    lastPage = gated.page;
    const state = await gated.page.evaluate(() =>
      document.querySelector("[data-recovery-banner]")?.getAttribute("data-recovery-banner"),
    );
    record(
      at("15 the storage gate closes editing only"),
      state === "storage_unavailable" &&
        (await gated.page.locator("[data-recovery-dismiss]").count()) === 0 &&
        (await gated.page.locator("[data-undo]").isDisabled()) &&
        !(await gated.page.locator("[aria-label='Çal']").isDisabled()),
      String(state),
    );
    await gated.context.close();
  });
}

const browser = await chromium.launch();
for (const [label, size] of [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
]) {
  console.log(`\n=== ${label} ===`);
  await run(browser, size, label);
}
await browser.close();
flush();
const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
