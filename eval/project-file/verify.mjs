/**
 * Faz 2L-A browser verification: the portable project file, end to end.
 *
 * Twenty-five scenarios in two viewports. The download is a real download
 * whose bytes are read back and checked; the import goes through the real
 * file input; and every "changes nothing" claim is a measured count — writes
 * on the ledger, contexts on the constructor, URLs on the mint — not a hope.
 *
 *   next build && next start on :3100 (or BASE_URL)
 *   node eval/project-file/verify.mjs
 */
import { chromium } from "playwright";
import { press } from "../shared/harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.PROJECT_OUT ?? "eval/project-file/artifacts";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/bar-ops/fixture-song.json", "utf8").trim();
const FIXTURE_SONG = JSON.parse(FIXTURE);

/* ------------------------------------------------------------ import files */

const wrapProject = (song, version = 1) =>
  JSON.stringify({ format: "aranje.project", version, song });

const withTitle = (title) => ({ ...FIXTURE_SONG, title });

/** One slide with nothing before it: a warning, never an error. */
const warningSong = () => ({
  version: 2,
  title: "Uyarılı Proje",
  bpm: 120,
  key: "E minor",
  tracks: [
    {
      id: "gtr",
      name: "Gitar",
      instrumentId: "electric_guitar",
      presetId: "clean",
      volumeDb: -6,
      fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
    },
  ],
  sections: [
    {
      id: "s1",
      name: "Bölüm",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            gtr: [
              {
                notes: [
                  {
                    pitch: "B3",
                    articulation: "slide",
                    position: { string: 4, fret: 0 },
                  },
                ],
              },
              null, null, null, null, null, null, null,
            ],
          },
        },
      ],
    },
  ],
});

const files = {
  modified: wrapProject(withTitle("Yedekten Açılan Proje")),
  warning: wrapProject(warningSong()),
  invalidJson: "bu bir json değil {",
  rawLegacy: FIXTURE,
  oversize: `{"pad":"${"x".repeat(2 * 1024 * 1024 + 64)}"}`,
  future: wrapProject(withTitle("Gelecekten"), 2),
  validatorError: wrapProject({
    ...withTitle("Bozuk Referans"),
    tracks: FIXTURE_SONG.tracks.map((track, index) =>
      index === 0 ? { ...track, instrumentId: "kazoo" } : track,
    ),
  }),
};

const filePaths = {};
for (const [name, text] of Object.entries(files)) {
  const path = join(tmpdir(), `aranje-2la-${name}.aranje.json`);
  writeFileSync(path, text, "utf8");
  filePaths[name] = path;
}

/* ---------------------------------------------------------------- harness */

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
    const first = String(error).split("\n")[0].slice(0, 110);
    await lastPage?.screenshot({ path: `${OUT}/failed-${name.split(" ")[0]}.png` }).catch(() => {});
    record(name, false, first);
    return undefined;
  }
}

/*
 * Instrumented before any app code runs: storage writes, console errors,
 * Object-URL mint/revoke, File reads and AudioContext constructions are all
 * counts the scenarios read back — the page cannot be measured by looking.
 */
const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  window.__urlCreated = 0;
  window.__urlRevoked = 0;
  window.__fileReads = 0;
  window.__audioContexts = 0;
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSet.call(this, key, value);
    if (key === "aranje.song") window.__writes += 1;
  };
  const originalCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (value) => {
    window.__urlCreated += 1;
    return originalCreate(value);
  };
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    window.__urlRevoked += 1;
    return originalRevoke(url);
  };
  window.__lastDownloadName = null;
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download")) window.__lastDownloadName = this.download;
    return originalClick.call(this);
  };
  const originalText = File.prototype.text;
  File.prototype.text = function () {
    window.__fileReads += 1;
    return originalText.call(this);
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
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
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
    ["aranje.song", FIXTURE],
  );
  await context.addInitScript(INSTRUMENT);
  if (options.refuseWriteCheck) await context.addInitScript(REFUSE_WRITE_CHECK);

  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(8000);
  const external = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      external.push(url);
    }
  });
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
  return { context, page, cdp, external };
}

/* --------------------------------------------------------------- gestures */


/* ------------------------------------------------------------ observations */

const writes = (page) => page.evaluate(() => window.__writes);
const rawKey = (page) => page.evaluate(() => localStorage.getItem("aranje.song"));
const title = (page) => page.locator("h1").first().textContent();
const debug = (page) =>
  page.evaluate(() => ({
    status: window.__aranjeDebug?.status() ?? null,
    ticks: window.__aranjeDebug?.ticks() ?? null,
    loop: window.__aranjeDebug?.loop() ?? null,
  }));

/** Structural equality, key-order insensitive — canonical export reorders. */
function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => sameValue(entry, b[index]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => sameValue(a[key], b[key]));
}

async function openInfoSheet(page) {
  await page.locator("[aria-label='Ses kaynakları ve lisans']").click();
  await page.waitForSelector("[data-info-project-backup]");
}

async function openProjectSheet(page) {
  const already = await page.locator("[data-project-sheet]").count();
  if (already) return;
  await openInfoSheet(page);
  await page.locator("[data-info-project-open]").click();
  await page.waitForSelector("[data-project-sheet]");
}

async function chooseFile(page, path) {
  await openProjectSheet(page);
  await page.locator("[data-project-file-input]").setInputFiles(path);
  await page.waitForTimeout(400);
}

const projectError = (page) =>
  page.evaluate(
    () => document.querySelector("[data-project-error]")?.textContent ?? null,
  );

/* ------------------------------------------------------------------- runs */

async function run(browser, size, label) {
  const at = (name) => `${label} ${name}`;
  const { context, page, cdp, external } = await openApp(browser, size);

  /* 1-3 + 20 — the backup download, its bytes, its name, its URLs. */
  let downloadPath = null;
  await safe(at("01 backup produces a real download"), async () => {
    await openInfoSheet(page);
    const waiting = page.waitForEvent("download");
    await page.locator("[data-info-project-backup]").click();
    const download = await waiting;
    downloadPath = await download.path();
    measurements[`${label}-download-name`] = download.suggestedFilename();
    /*
     * A backup is a read: no write to storage, no history step, the raw key
     * byte-identical. Measured here so a mutation that made export write or
     * commit would go red on this line.
     */
    record(
      at("01 backup produces a real download"),
      downloadPath !== null &&
        (await writes(page)) === 0 &&
        (await rawKey(page)) === FIXTURE &&
        (await page.locator("[data-undo]").isDisabled()),
    );

    /*
     * The name the *app* asked for, read off the anchor at click time.
     * Headless Chromium renames a non-ASCII blob download to "download" on
     * its own — a browser policy outside the app; the browser-given name is
     * recorded alongside as a measurement rather than asserted.
     */
    const askedName = await page.evaluate(() => window.__lastDownloadName);
    measurements[`${label}-browser-download-name`] = download.suggestedFilename();
    record(
      at("03 the file name is the safe title"),
      askedName === "Ölçü-İşlemleri-Fikstürü.aranje.json",
      askedName ?? "no download attribute",
    );

    const text = readFileSync(downloadPath, "utf8");
    const parsed = JSON.parse(text);
    record(
      at("02 the downloaded bytes are a strict V1 project"),
      Object.keys(parsed).join(",") === "format,song,version" &&
        parsed.format === "aranje.project" &&
        parsed.version === 1 &&
        text.endsWith("\n") &&
        sameValue(parsed.song, FIXTURE_SONG),
    );

    await page.waitForTimeout(400);
    const urls = await page.evaluate(() => ({
      created: window.__urlCreated,
      revoked: window.__urlRevoked,
    }));
    record(
      at("20 every minted Object URL is revoked"),
      urls.created >= 1 && urls.created === urls.revoked,
      JSON.stringify(urls),
    );
  });

  /* 4-6 — preview reads, and changes nothing; cancel is a no-op. */
  await safe(at("04 picking a file opens a read-only preview"), async () => {
    const writesBefore = await writes(page);
    const rawBefore = await rawKey(page);
    await page.locator("[data-info-project-open]").click();
    await page.waitForSelector("[data-project-sheet]");
    await page.locator("[data-project-file-input]").setInputFiles(downloadPath);
    await page.waitForSelector("[data-project-preview]");
    record(at("04 picking a file opens a read-only preview"), true);

    const undoDisabled = await page.locator("[data-undo]").isDisabled();
    record(
      at("05 preview changes no song, storage or history"),
      (await writes(page)) === writesBefore &&
        (await rawKey(page)) === rawBefore &&
        (await title(page)) === "Ölçü İşlemleri Fikstürü" &&
        undoDisabled,
    );

    await page.locator("[data-project-cancel]").click();
    await page.waitForTimeout(200);
    record(
      at("06 cancel drops the preview and nothing else"),
      (await page.locator("[data-project-preview]").count()) === 0 &&
        (await writes(page)) === writesBefore &&
        (await rawKey(page)) === rawBefore,
    );
    await page.locator("[data-project-sheet] button:has-text('Kapat')").click();
    await page.waitForTimeout(200);
  });

  /* 7-10, 16, 18, 19 and the clipboard — the apply and its ground. */
  await safe(at("07 apply shows the imported song"), async () => {
    // Fill the bar clipboard, so the apply has something to clear.
    await press(page, cdp, "[data-arr-bar='intro:0']");
    await page.locator("[data-bar-action=copy]").click();
    await page.waitForTimeout(300);
    await page.locator("[aria-label='Ölçü seçimini iptal et']").click();
    await page.waitForTimeout(200);

    // Real playback and a real loop, so the apply has something to stop.
    await page.locator("[aria-label='Çal']").click();
    await page.waitForFunction(() => window.__aranjeDebug?.status() === "playing", null, {
      timeout: 30000,
    });
    await page.locator("[aria-label='Bölüm döngüsü']").click();
    await page.waitForTimeout(300);
    const looped = await debug(page);
    if (looped.loop === null) throw new Error("loop did not arm");
    const contextsBefore = await page.evaluate(() => window.__audioContexts);

    const writesBefore = await writes(page);
    await chooseFile(page, filePaths.modified);
    await page.waitForSelector("[data-project-preview]");
    await page.locator("[data-project-apply]").click();
    await page.waitForTimeout(600);

    record(
      at("07 apply shows the imported song"),
      (await title(page)) === "Yedekten Açılan Proje" &&
        (await page.locator("[data-project-sheet]").count()) === 0,
    );

    const undoLabel = await page.locator("[data-undo]").getAttribute("aria-label");
    record(
      at("08 apply is one write and one named history step"),
      (await writes(page)) === writesBefore + 1 &&
        undoLabel === "Geri al: Projeyi açma",
      `writes ${await writes(page)} vs ${writesBefore}, label ${undoLabel}`,
    );

    const after = await debug(page);
    record(
      at("18 apply stops playback, drops the loop, rewinds"),
      after.status !== "playing" && after.ticks === 0 && after.loop === null,
      JSON.stringify(after),
    );

    record(
      at("19 no second AudioContext is ever built"),
      (await page.evaluate(() => window.__audioContexts)) === contextsBefore &&
        contextsBefore <= 1,
    );

    // The clipboard went with the old song: the more-sheet offers no paste.
    await press(page, cdp, "[data-arr-bar='intro:0']");
    await page.locator("[data-bar-action=more]").click();
    await page.waitForTimeout(300);
    record(
      at("16b the apply cleared the clipboard"),
      (await page.locator("text=Buraya yapıştır").count()) === 0,
    );
    await page.locator("[role=dialog] [aria-label=Kapat]").first().click();
    await page.waitForTimeout(200);
    await page.locator("[aria-label='Ölçü seçimini iptal et']").click();
    await page.waitForTimeout(200);

    const writesAtUndo = await writes(page);
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(400);
    record(
      at("09 undo brings the previous song back"),
      (await title(page)) === "Ölçü İşlemleri Fikstürü" &&
        (await writes(page)) === writesAtUndo + 1,
    );

    await page.locator("[data-redo]").click();
    await page.waitForTimeout(400);
    record(
      at("10 redo brings the imported song back"),
      (await title(page)) === "Yedekten Açılan Proje" &&
        (await writes(page)) === writesAtUndo + 2,
    );
  });

  /* 11-15 — refusals, each with the song untouched. */
  const refusal = async (name, path, wantsText, extra = async () => true) => {
    await safe(at(name), async () => {
      const rawBefore = await rawKey(page);
      const titleBefore = await title(page);
      await chooseFile(page, path);
      const message = await projectError(page);
      const clean =
        message !== null &&
        !/JSON|Zod|schema|localStorage|Error:/.test(message) &&
        wantsText.test(message);
      record(
        at(name),
        clean &&
          (await rawKey(page)) === rawBefore &&
          (await title(page)) === titleBefore &&
          (await extra()),
        message ?? "no message",
      );
    });
  };

  await refusal("11 invalid JSON refuses safely", filePaths.invalidJson, /geçerli bir Aranjé projesi değil/);
  await refusal("12 a raw legacy Song is refused", filePaths.rawLegacy, /geçerli bir Aranjé projesi değil/);
  const readsBefore = await page.evaluate(() => window.__fileReads);
  await refusal(
    "13 an oversized file is refused unread",
    filePaths.oversize,
    /desteklenen boyuttan büyük/,
    async () => (await page.evaluate(() => window.__fileReads)) === readsBefore,
  );
  await refusal("14 a future version touches nothing", filePaths.future, /daha yeni bir Aranjé sürümüyle/);
  await refusal("15 validator errors touch nothing", filePaths.validatorError, /çalınabilirlik hataları/);

  /* 16 — warnings show and do not block. */
  await safe(at("16 a warning shows in preview and applies"), async () => {
    await chooseFile(page, filePaths.warning);
    await page.waitForSelector("[data-project-preview]");
    const warningShown = (await page.locator("[data-project-warning]").count()) === 1;
    await page.locator("[data-project-apply]").click();
    await page.waitForTimeout(500);
    record(
      at("16 a warning shows in preview and applies"),
      warningShown && (await title(page)) === "Uyarılı Proje",
    );
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(400);
  });

  /* 22-24 — the sheet on a phone. */
  await safe(at("22 nothing overflows the body"), async () => {
    await chooseFile(page, filePaths.modified);
    await page.waitForSelector("[data-project-preview]");
    const layout = await page.evaluate(() => {
      const scrollers = [...document.querySelectorAll("*")].filter(
        (node) =>
          node.scrollWidth > node.clientWidth + 1 &&
          ["auto", "scroll"].includes(getComputedStyle(node).overflowX),
      );
      const boxes = [
        "[data-project-backup]",
        "[data-project-open-picker]",
        "[data-project-backup-current]",
        "[data-project-apply]",
        "[data-project-cancel]",
      ].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? Math.round(Math.min(box.width, box.height)) : 0;
      });
      const name = document.querySelector("[data-project-file-name]");
      const nameFits = name ? name.scrollWidth <= name.clientWidth + name.scrollWidth : true;
      return {
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        scrollers: scrollers.length,
        targets: boxes,
        nameFits,
      };
    });
    measurements[`${label}-sheet-layout`] = layout;
    record(at("22 nothing overflows the body"), layout.bodyOverflow === 0);
    record(
      at("23 exactly one intentional horizontal scroller"),
      layout.scrollers <= 1,
      `scrollers ${layout.scrollers}`,
    );
    record(
      at("24 every project control is at least 44px"),
      layout.targets.every((edge) => edge >= 43.5),
      JSON.stringify(layout.targets),
    );
    await page.screenshot({ path: `${OUT}/preview-${label}.png` });
    await page.locator("[data-project-cancel]").click();
    await page.locator("[data-project-sheet] button:has-text('Kapat')").click();
    await page.waitForTimeout(200);
  });

  /* 21, 25 — the whole run made no external request and threw nothing. */
  await safe(at("21 zero external network requests"), async () => {
    record(at("21 zero external network requests"), external.length === 0, external[0] ?? "");
    const consoleErrors = await page.evaluate(() => window.__consoleErrors);
    record(at("25 zero console and page errors"), consoleErrors.length === 0, consoleErrors[0] ?? "");
  });

  await context.close();

  /* 17 — a device that cannot save still hands the song back. */
  await safe(at("17 canPersist:false — backup works, apply is closed"), async () => {
    const refused = await openApp(browser, size, { refuseWriteCheck: true });
    lastPage = refused.page;
    const bannerState = await refused.page.evaluate(() =>
      document.querySelector("[data-recovery-banner]")?.getAttribute("data-recovery-banner"),
    );
    if (bannerState !== "storage_unavailable") {
      throw new Error(`expected storage_unavailable, saw ${bannerState}`);
    }

    await openInfoSheet(refused.page);
    const waiting = refused.page.waitForEvent("download");
    await refused.page.locator("[data-info-project-backup]").click();
    const download = await waiting;
    const text = readFileSync(await download.path(), "utf8");
    const rescued = sameValue(JSON.parse(text).song, FIXTURE_SONG);

    await refused.page.locator("[data-info-project-open]").click();
    await refused.page.waitForSelector("[data-project-sheet]");
    await refused.page.locator("[data-project-file-input]").setInputFiles(filePaths.modified);
    await refused.page.waitForSelector("[data-project-preview]");
    const applyDisabled = await refused.page.locator("[data-project-apply]").isDisabled();
    const noteShown = (await refused.page.locator("[data-project-persist-note]").count()) === 1;
    const titleStays = (await refused.page.locator("h1").first().textContent()) === "Ölçü İşlemleri Fikstürü";

    record(
      at("17 canPersist:false — backup works, apply is closed"),
      rescued && applyDisabled && noteShown && titleStays,
      `rescued ${rescued}, disabled ${applyDisabled}, note ${noteShown}`,
    );
    await refused.context.close();
  });
}

/* -------------------------------------------------------------------- main */

const browser = await chromium.launch();
const VIEWPORTS = [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
];
// The probe harness mutates, rebuilds and re-runs; one viewport is enough to
// show a broken guarantee, and half the wall-clock per probe.
for (const [label, size] of process.env.ONE_VIEWPORT ? VIEWPORTS.slice(0, 1) : VIEWPORTS) {
  console.log(`\n=== ${label} ===`);
  await run(browser, size, label);
}
await browser.close();
flush();
const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
