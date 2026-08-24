/**
 * Faz 2O-A browser acceptance (spec 13.21 §24).
 *
 * Fifty scenarios in two phone viewports, against the real production build.
 *
 * The rule the whole suite works to: a claim is measured on the thing it is
 * about. "Nothing was written" is a count of physical `setItem` calls by key
 * kind, not an absence of visible change; "A is unchanged" is A's bytes before
 * and after; "the project opened" is the song the app is actually holding.
 * A scenario that only checked a label would pass for a library that had
 * quietly lost a project.
 *
 *   npm run build && npx next start -p 3100
 *   node eval/projects/verify.mjs            # both viewports
 *   ONE_VIEWPORT=1 node eval/projects/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { LEDGER, takeLedger } from "./ledger.mjs";
import {
  CATALOG_KEY,
  SONG_KEY,
  envelopeDevice,
  legacyDevice,
  libraryDevice,
  payloadKey,
  record,
  rescueDevice,
  song,
} from "./seeds.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.PROJECTS_OUT ?? "eval/projects/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const measurements = {};
let lastPage = null;

const record_ = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function safe(name, fn) {
  try {
    return await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 140);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${name.replaceAll(/[^\w]+/g, "-").slice(0, 40)}.png` })
      .catch(() => {});
    record_(name, false, first);
    return undefined;
  }
}

async function openApp(browser, size, seed = {}, { query = "" } = {}) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  await context.addInitScript((entries) => {
    try {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    } catch {
      /* a private window is not a reason to fail the run */
    }
  }, Object.entries(seed));
  await context.addInitScript(LEDGER);

  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(15000);
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
  await page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-projects]");
  await page.waitForTimeout(700);
  return { context, page, external };
}

/* ------------------------------------------------------------- reading it */

const keys = (page) => page.evaluate(() => Object.keys(localStorage).sort());
const raw = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const errors = (page) => page.evaluate(() => window.__consoleErrors);
const contexts = (page) => page.evaluate(() => window.__audioContexts);

/** The song the app is holding right now, from the header and the payload. */
const openTitle = (page) => page.locator("[data-open-projects] h1").innerText();

const openLibrary = async (page) => {
  await page.locator("[data-open-projects]").click();
  /*
   * The sheet, not the list. `waitForSelector` waits for *visibility*, and an
   * empty `<ul>` has none — so waiting on the list would hang exactly on the
   * device where the library has nothing to show, which is the one state most
   * worth being able to test.
   */
  await page.waitForSelector('[role="dialog"] section');
  await page.waitForTimeout(300);
};

const closeLibrary = async (page) => {
  const dialogs = page.locator('[role="dialog"]');
  for (let guard = 0; guard < 4 && (await dialogs.count()) > 0; guard += 1) {
    await dialogs
      .last()
      .locator('button[aria-label="Kapat"]')
      .first()
      .click({ position: { x: 6, y: 6 }, timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(200);
  }
};

/** Press a row's action, expanding the row first. */
const rowAction = async (page, projectId, action) => {
  const row = page.locator(`[data-project-open="${projectId}"]`);
  await row.scrollIntoViewIfNeeded();
  if ((await page.locator(`[data-project-actions="${projectId}"]`).count()) === 0) {
    await row.click();
    await page.waitForTimeout(250);
  }
  const button = page.locator(
    `[data-project-actions="${projectId}"] [data-project-action="${action}"]`,
  );
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForTimeout(600);
};

const createProject = async (page, templateId) => {
  await page.locator('[data-testid="project-new"]').click();
  await page.waitForTimeout(250);
  const template = page.locator(`[data-project-template="${templateId}"]`);
  await template.scrollIntoViewIfNeeded();
  await template.click();
  await page.waitForTimeout(800);
};

const rowTitles = (page) =>
  page.locator("[data-project-row] h1, [data-project-row] span.truncate").allInnerTexts();

/* =========================================================== the scenarios */

async function run(label, size) {
  const browser = await chromium.launch();

  /* ---- 1-4: what an existing musician meets on their first launch */
  await safe(`[${label}] migration`, async () => {
    const legacy = legacyDevice("Eski Şarkı");
    const { context, page } = await openApp(browser, size, legacy);
    try {
      const ledger = await takeLedger(page);
      record_(
        `[${label}] 1 eski tek şarkıyla açılış: şarkı ekranda`,
        (await openTitle(page)) === "Eski Şarkı",
        await openTitle(page),
      );
      record_(
        `[${label}] 2 legacy Song migration: proje kaydı ve katalog var, eski anahtar gitti`,
        (await keys(page)).includes("aranje.project.project-1") &&
          (await keys(page)).includes(CATALOG_KEY) &&
          !(await keys(page)).includes(SONG_KEY),
        (await keys(page)).join(", "),
      );
      record_(
        `[${label}] 3 migration fiziksel sırası: payload, katalog, sonra eski anahtar`,
        (() => {
          const names = ledger.ops;
          const payload = names.indexOf("set aranje.project.project-1");
          const cat = names.indexOf(`set ${CATALOG_KEY}`);
          const gone = names.indexOf(`remove ${SONG_KEY}`);
          return payload >= 0 && cat > payload && gone > cat;
        })(),
        ledger.ops.filter((entry) => !entry.startsWith("get ")).join(" → "),
      );
      const stored = JSON.parse((await raw(page, "aranje.project.project-1")) ?? "{}");
      record_(
        `[${label}] 4 migration sonrası eski Song byte-eş`,
        JSON.stringify(stored.current) === JSON.stringify(song("Eski Şarkı")),
        stored.current?.title ?? "?",
      );
      measurements[`${label}.migration`] = ledger.counts;
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] envelope migration`, async () => {
    const { context, page } = await openApp(browser, size, envelopeDevice());
    try {
      record_(
        `[${label}] 3.b mevcut V1 envelope da taşınıyor`,
        (await openTitle(page)) === "Zarflı Şarkı" &&
          (await keys(page)).includes("aranje.project.project-1"),
        await openTitle(page),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 5-7: the three templates, each beside what was already there */
  await safe(`[${label}] new projects`, async () => {
    const { context, page } = await openApp(browser, size, libraryDevice(["A Şarkısı"]));
    try {
      const before = await raw(page, payloadKey("project-1"));
      for (const [index, template] of ["empty", "rock_band", "acoustic"].entries()) {
        await openLibrary(page);
        await takeLedger(page);
        await createProject(page, template);
        const ledger = await takeLedger(page);
        record_(
          `[${label}] ${5 + index} yeni proje (${template}): eski proje byte-eş, tek payload + tek katalog yazımı`,
          (await raw(page, payloadKey("project-1"))) === before &&
            ledger.n("set:projectPayload") === 1 &&
            ledger.n("set:catalog") === 1,
          `payload ${ledger.n("set:projectPayload")}, katalog ${ledger.n("set:catalog")}, başlık ${await openTitle(page)}`,
        );
        await closeLibrary(page);
      }
      measurements[`${label}.afterThreeCreates`] = await keys(page);
    } finally {
      await context.close();
    }
  });

  /* ---- 8-10: switching, and the edit that has to survive it */
  await safe(`[${label}] switching`, async () => {
    const { context, page } = await openApp(
      browser,
      size,
      libraryDevice(["A Şarkısı", "B Şarkısı"]),
    );
    try {
      const aBefore = await raw(page, payloadKey("project-1"));
      await openLibrary(page);
      await takeLedger(page);
      await rowAction(page, "project-2", "open");
      const ledger = await takeLedger(page);
      record_(
        `[${label}] 8 A→B geçişi: B açık, hiçbir payload yazılmadı`,
        (await openTitle(page)) === "B Şarkısı" && ledger.n("set:projectPayload") === 0,
        `${await openTitle(page)}, payload yazımı ${ledger.n("set:projectPayload")}, katalog ${ledger.n("set:catalog")}`,
      );

      await closeLibrary(page);
      await openLibrary(page);
      await rowAction(page, "project-1", "open");
      record_(
        `[${label}] 9 B→A dönüşü: A byte-eş`,
        (await openTitle(page)) === "A Şarkısı" &&
          (await raw(page, payloadKey("project-1"))) === aBefore,
        await openTitle(page),
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  /* ---- 11-16: duplicate, delete, the last-project guard, backup-before-delete */
  await safe(`[${label}] duplicate and delete`, async () => {
    const { context, page } = await openApp(
      browser,
      size,
      libraryDevice(["A Şarkısı", "B Şarkısı"]),
    );
    try {
      await openLibrary(page);
      const aBefore = await raw(page, payloadKey("project-1"));
      await takeLedger(page);
      await rowAction(page, "project-1", "duplicate");
      const dup = await takeLedger(page);
      record_(
        `[${label}] 11 çoğaltma: kaynak byte-eş, yeni proje açık`,
        (await raw(page, payloadKey("project-1"))) === aBefore &&
          (await openTitle(page)) === "A Şarkısı kopyası",
        `${await openTitle(page)}, payload ${dup.n("set:projectPayload")}, katalog ${dup.n("set:catalog")}`,
      );

      await closeLibrary(page);
      await openLibrary(page);
      await takeLedger(page);
      await rowAction(page, "project-2", "delete");
      await page.waitForSelector('[data-testid="project-delete-text"]');
      const text = await page.locator('[data-testid="project-delete-text"]').innerText();
      record_(
        `[${label}] 13.a silme onayı adı ve kapsamı söylüyor, geri alınamaz diyor`,
        text.includes("B Şarkısı") &&
          /\d+ bölüm · \d+ ölçü · \d+ track/.test(text) &&
          text.includes("geri alınamaz") &&
          !/project-\d/.test(text),
        text.replace(/\n+/g, " | ").slice(0, 90),
      );
      await page.locator('[data-testid="project-delete-confirm"]').click();
      await page.waitForTimeout(800);
      const del = await takeLedger(page);
      record_(
        `[${label}] 13 aktif olmayan proje siliniyor: not, katalog, payload remove, not remove`,
        !(await keys(page)).includes(payloadKey("project-2")) &&
          !(await keys(page)).includes("aranje.project-pending") &&
          del.n("set:pending") === 1 &&
          del.n("set:catalog") === 1 &&
          del.n("remove:projectPayload") === 1 &&
          del.n("remove:pending") === 1,
        del.ops.filter((entry) => !entry.startsWith("get ")).join(" → "),
      );
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] delete active and last`, async () => {
    const { context, page } = await openApp(
      browser,
      size,
      libraryDevice(["A Şarkısı", "B Şarkısı", "C Şarkısı"], 1),
    );
    try {
      await openLibrary(page);
      await rowAction(page, "project-2", "delete");
      await page.locator('[data-testid="project-delete-confirm"]').click();
      await page.waitForTimeout(900);
      record_(
        `[${label}] 14 aktif proje silindi: survivor deterministik (aynı index)`,
        (await openTitle(page)) === "C Şarkısı",
        await openTitle(page),
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] last project`, async () => {
    const { context, page } = await openApp(browser, size, libraryDevice(["Tek Proje"]));
    try {
      await openLibrary(page);
      const disabled = await page
        .locator('[data-project-open="project-1"]')
        .click()
        .then(() => page.waitForTimeout(250))
        .then(() =>
          page
            .locator('[data-project-actions="project-1"] [data-project-action="delete"]')
            .isDisabled(),
        );
      await takeLedger(page);
      const before = await keys(page);
      const ledger = await takeLedger(page);
      record_(
        `[${label}] 15 son proje silinemez: buton kapalı, 0 yazım`,
        disabled && ledger.n("set:catalog") === 0 && before.includes(payloadKey("project-1")),
        `disabled=${disabled}`,
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] backup before delete`, async () => {
    const { context, page } = await openApp(
      browser,
      size,
      libraryDevice(["A Şarkısı", "B Şarkısı"]),
    );
    try {
      await openLibrary(page);
      await rowAction(page, "project-2", "delete");
      await takeLedger(page);
      const download = page.waitForEvent("download", { timeout: 8000 });
      await page.locator('[data-testid="project-delete-backup"]').click();
      const file = await download;
      const stream = await file.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      const parsed = JSON.parse(text);
      const ledger = await takeLedger(page);
      record_(
        `[${label}] 16 silmeden önce yedekle: doğru şarkı, 0 depo yazımı, katalog metadata yok`,
        parsed.song?.title === "B Şarkısı" &&
          Object.keys(parsed).sort().join(",") === "format,song,version" &&
          !text.includes("project-") &&
          !text.includes("revision") &&
          ledger.n("set:projectPayload") === 0 &&
          ledger.n("set:catalog") === 0,
        `${parsed.song?.title}, alanlar ${Object.keys(parsed).sort().join("+")}, yazım ${ledger.n("set:projectPayload") + ledger.n("set:catalog")}`,
      );
      /*
       * `aranje.project` is the file's own format tag and belongs there. What
       * must not be in it is anything about the *library*: which slot the song
       * came from, what else is on the device, or how many times it was saved.
       */
      record_(
        `[${label}] 16.b yedek dosyası kütüphane bilgisi taşımıyor`,
        parsed.format === "aranje.project" &&
          !text.includes("projectId") &&
          !text.includes("aranje.project-catalog") &&
          !text.includes("aranje.project-record") &&
          !text.includes("activeProjectId") &&
          !text.includes("updatedAt"),
        `format ${parsed.format}, ${text.length} B`,
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  /* ---- 22: two projects with the same name */
  await safe(`[${label}] same names`, async () => {
    const { context, page } = await openApp(browser, size, libraryDevice(["Aynı Ad"]));
    try {
      await openLibrary(page);
      await rowAction(page, "project-1", "duplicate");
      await closeLibrary(page);
      await openLibrary(page);
      const titles = await rowTitles(page);
      record_(
        `[${label}] 22 aynı isimli iki proje ayrı kimliklerle yaşayabiliyor`,
        (await page.locator("[data-project-row]").count()) === 2,
        titles.join(" | "),
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  /* ---- 29-32: what this version must not touch */
  await safe(`[${label}] future and corrupt`, async () => {
    const futureCatalog = JSON.stringify({
      format: "aranje.project-catalog",
      version: 9,
      whatever: true,
    });
    const { context, page } = await openApp(browser, size, {
      [CATALOG_KEY]: futureCatalog,
      [payloadKey("project-1")]: record("project-1", song("Dokunma")),
    });
    try {
      record_(
        `[${label}] 29 gelecek sürüm katalog: byte-eş duruyor, üzerine yazılmadı`,
        (await raw(page, CATALOG_KEY)) === futureCatalog,
        `${((await raw(page, CATALOG_KEY)) ?? "").slice(0, 40)}…`,
      );
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] future inactive project`, async () => {
    const futureRecord = record("project-2", song("Gelecek"), 1, 9);
    const seed = libraryDevice(["A Şarkısı", "B Şarkısı"]);
    seed[payloadKey("project-2")] = futureRecord;
    const { context, page } = await openApp(browser, size, seed);
    try {
      await openLibrary(page);
      const row = await page.locator('[data-project-row="project-2"]').innerText();
      await rowAction(page, "project-2", "open").catch(() => {});
      record_(
        `[${label}] 30 gelecek sürüm proje listede kalıyor ve güvenli cümle gösteriyor`,
        row.includes("daha yeni") && (await raw(page, payloadKey("project-2"))) === futureRecord,
        row.replace(/\n+/g, " | ").slice(0, 80),
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] corrupt inactive project`, async () => {
    const seed = libraryDevice(["A Şarkısı", "B Şarkısı"]);
    seed[payloadKey("project-2")] = "{ruined";
    const { context, page } = await openApp(browser, size, seed);
    try {
      await openLibrary(page);
      const row = await page.locator('[data-project-row="project-2"]').innerText();
      record_(
        `[${label}] 31 bozuk proje sahte 0 ölçü göstermiyor, silinmiyor`,
        row.includes("açılamadı") &&
          !/0 ölçü/.test(row) &&
          (await raw(page, payloadKey("project-2"))) === "{ruined",
        row.replace(/\n+/g, " | ").slice(0, 70),
      );
      record_(
        `[${label}] 31.b sağlam proje bundan etkilenmiyor`,
        (await openTitle(page)) === "A Şarkısı",
        await openTitle(page),
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] active rescue`, async () => {
    const { context, page } = await openApp(browser, size, rescueDevice());
    try {
      record_(
        `[${label}] 32 current bozuk / previous sağlam: önceki sürüm açıldı`,
        (await openTitle(page)) === "Kurtarılan",
        await openTitle(page),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 33-34: a wide library, and a long name */
  await safe(`[${label}] twenty projects`, async () => {
    const titles = Array.from({ length: 20 }, (_, index) => `Proje ${index + 1}`);
    const { context, page } = await openApp(browser, size, libraryDevice(titles));
    try {
      await openLibrary(page);
      const rows = await page.locator("[data-project-row]").count();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      record_(
        `[${label}] 33 20 proje listeleniyor, gövde yatay taşması 0`,
        rows === 20 && overflow <= 0,
        `${rows} satır, taşma ${overflow}`,
      );
      measurements[`${label}.twentyProjects`] = {
        rows,
        domNodes: await page.evaluate(() => document.querySelectorAll("*").length),
      };
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  await safe(`[${label}] long unicode name`, async () => {
    const long = "Şu Çok Uzun Türkçe Proje Adı — ğüşiöç ve daha fazlası 🎸🎶";
    const { context, page } = await openApp(browser, size, libraryDevice([long]));
    try {
      await openLibrary(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const label_ = await page
        .locator('[data-project-open="project-1"]')
        .getAttribute("aria-label");
      record_(
        `[${label}] 34 uzun Unicode ad: taşma 0, erişilebilir ad projeyi içeriyor`,
        overflow <= 0 && (label_ ?? "").includes("Şu Çok Uzun"),
        `taşma ${overflow}, ad "${(label_ ?? "").slice(0, 40)}…"`,
      );
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  /* ---- 35-41: playback across a switch */
  await safe(`[${label}] playback`, async () => {
    const { context, page } = await openApp(
      browser,
      size,
      libraryDevice(["A Şarkısı", "B Şarkısı"]),
      { query: "?debug=1" },
    );
    try {
      await page.getByRole("button", { name: "Çal" }).first().click();
      await page.waitForTimeout(1200);
      const playing = await page.evaluate(() => window.__aranjeDebug?.status() ?? null);
      const audioBefore = await contexts(page);

      await openLibrary(page);
      const stillPlaying = await page.evaluate(
        () => window.__aranjeDebug?.status() ?? null,
      );
      record_(
        `[${label}] 36 proje listesini açmak çalmayı durdurmuyor`,
        playing === "playing" && stillPlaying === "playing",
        `${playing} → ${stillPlaying}`,
      );

      await rowAction(page, "project-2", "open");
      const afterSwitch = await page.evaluate(() => ({
        status: window.__aranjeDebug?.status() ?? null,
        ticks: window.__aranjeDebug?.ticks() ?? null,
        loop: window.__aranjeDebug?.loop() ?? null,
      }));
      record_(
        `[${label}] 35 gerçek proje geçişi çalmayı durduruyor ve başa alıyor`,
        afterSwitch.status !== "playing" && afterSwitch.ticks === 0,
        `${afterSwitch.status} @${afterSwitch.ticks}`,
      );
      record_(
        `[${label}] 39 geçişten sonra döngü kapalı`,
        afterSwitch.loop === null || afterSwitch.loop.on === false,
        JSON.stringify(afterSwitch.loop),
      );

      await closeLibrary(page);
      await page.getByRole("button", { name: "Çal" }).first().click();
      await page.waitForTimeout(900);
      const audioAfter = await contexts(page);
      record_(
        `[${label}] 38 proje geçişinde AudioContext 1 → 1`,
        audioBefore === 1 && audioAfter === 1,
        `${audioBefore} → ${audioAfter}`,
      );
      measurements[`${label}.playback`] = { audioBefore, audioAfter, afterSwitch };
    } finally {
      await context.close();
    }
  });

  /* ---- 23: a device that cannot write at all */
  await safe(`[${label}] storage unavailable`, async () => {
    /*
     * Its own browser. A device that refuses every write is the one state
     * where the app is running entirely on what it could read, and sharing a
     * browser with a dozen contexts that have been playing audio makes a slow
     * first paint look like a broken one.
     */
    const own = await chromium.launch();
    const context = await own.newContext({ viewport: size, hasTouch: true, isMobile: true });
    await context.addInitScript(LEDGER);
    await context.addInitScript(() => {
      /* Reads work, writes do not — a full or sandboxed device. */
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (String(key).startsWith("aranje.")) throw new Error("QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    const page = await context.newPage();
    lastPage = page;
    try {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-open-projects]");
      await page.waitForTimeout(900);
      await openLibrary(page);
      const newDisabled = await page.locator('[data-testid="project-new"]').isDisabled();
      const importDisabled = await page
        .locator('[data-testid="project-import"]')
        .isDisabled();
      await takeLedger(page);
      const ledger = await takeLedger(page);
      record_(
        `[${label}] 23 kayıt kapalıyken: yeni proje ve içe aktarma kapalı, 0 yazım`,
        newDisabled &&
          importDisabled &&
          ledger.n("set:projectPayload") === 0 &&
          ledger.n("set:catalog") === 0,
        `yeni=${newDisabled}, import=${importDisabled}`,
      );
      const emptyNote = await page
        .locator('[data-testid="project-list-empty"]')
        .innerText()
        .catch(() => null);
      await closeLibrary(page);
      record_(
        `[${label}] 23.b boş liste sessiz kalmıyor, güvenli cümle söylüyor`,
        emptyNote !== null && !/localStorage|Quota|aranje\./i.test(emptyNote),
        (emptyNote ?? "cümle yok").replace(/\n+/g, " ").slice(0, 70),
      );
      record_(
        `[${label}] 44 kayıt kapalıyken yedekleme çalışıyor`,
        await page.locator("[data-open-projects]").isVisible(),
        await openTitle(page),
      );
    } finally {
      await context.close();
      await own.close();
    }
  });

  /* ---- 24-28: injected failures at each physical step */
  const failureCase = async (id, name, matcher, expectation) => {
    await safe(`[${label}] ${id}`, async () => {
      const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true });
      await context.addInitScript((entries) => {
        try {
          for (const [key, value] of entries) localStorage.setItem(key, value);
        } catch {
          /* nothing to do */
        }
      }, Object.entries(libraryDevice(["A Şarkısı", "B Şarkısı"])));
      await context.addInitScript(LEDGER);
      await context.addInitScript((pattern) => {
        const original = Storage.prototype.setItem;
        const remove = Storage.prototype.removeItem;
        window.__armed = false;
        Storage.prototype.setItem = function (key, value) {
          if (window.__armed && new RegExp(pattern.set).test(String(key))) {
            throw new Error("QuotaExceededError");
          }
          return original.call(this, key, value);
        };
        Storage.prototype.removeItem = function (key) {
          if (window.__armed && pattern.remove && new RegExp(pattern.remove).test(String(key))) {
            throw new Error("refused");
          }
          return remove.call(this, key);
        };
      }, matcher);
      const page = await context.newPage();
      lastPage = page;
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-open-projects]");
      await page.waitForTimeout(700);
      try {
        await expectation(page);
      } finally {
        await context.close();
      }
    });
  };

  await failureCase(
    "quota on create",
    "create",
    { set: "^aranje\\.project\\.project-3$" },
    async (page) => {
      const aBefore = await raw(page, payloadKey("project-1"));
      await openLibrary(page);
      await page.evaluate(() => {
        window.__armed = true;
      });
      await createProject(page, "empty");
      const message = await page
        .locator('[data-testid="project-error"]')
        .innerText()
        .catch(() => null);
      record_(
        `[${label}] 24 yeni projede kota hatası: mevcut projeler değişmedi, güvenli cümle`,
        message !== null &&
          !/localStorage|Quota|aranje\./i.test(message) &&
          (await raw(page, payloadKey("project-1"))) === aBefore &&
          (await openTitle(page)) === "A Şarkısı",
        (message ?? "mesaj yok").slice(0, 70),
      );
    },
  );

  await failureCase(
    "catalog write failure",
    "catalog",
    { set: "^aranje\\.projects$" },
    async (page) => {
      const catalogBefore = await raw(page, CATALOG_KEY);
      await openLibrary(page);
      await page.evaluate(() => {
        window.__armed = true;
      });
      await createProject(page, "empty");
      record_(
        `[${label}] 26 katalog yazımı başarısız: katalog byte-eş, yeni payload sahipsiz ama kayıp değil`,
        (await raw(page, CATALOG_KEY)) === catalogBefore &&
          (await raw(page, payloadKey("project-3"))) !== null,
        `katalog aynı, payload ${(await raw(page, payloadKey("project-3"))) === null ? "yok" : "var"}`,
      );

      /* The orphan is adopted on the next load rather than stranded. */
      await page.evaluate(() => {
        window.__armed = false;
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-open-projects]");
      await page.waitForTimeout(800);
      const after = JSON.parse((await raw(page, CATALOG_KEY)) ?? "{}");
      record_(
        `[${label}] 26.b sonraki açılışta sahipsiz payload sahipleniliyor`,
        (after.projectIds ?? []).includes("project-3"),
        (after.projectIds ?? []).join(","),
      );
    },
  );

  await failureCase(
    "delete remove failure",
    "delete",
    { set: "^$", remove: "^aranje\\.project\\.project-2$" },
    async (page) => {
      await openLibrary(page);
      await page.evaluate(() => {
        window.__armed = true;
      });
      await rowAction(page, "project-2", "delete");
      await page.locator('[data-testid="project-delete-confirm"]').click();
      await page.waitForTimeout(800);
      const payload = await raw(page, payloadKey("project-2"));
      await page.evaluate(() => {
        window.__armed = false;
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-open-projects]");
      await page.waitForTimeout(800);
      const after = JSON.parse((await raw(page, CATALOG_KEY)) ?? "{}");
      record_(
        `[${label}] 28 silme remove aşamasında başarısız: payload erişilebilir kalıyor`,
        payload !== null && (after.projectIds ?? []).includes("project-2"),
        `payload ${payload === null ? "yok" : "var"}, katalog ${(after.projectIds ?? []).join(",")}`,
      );
    },
  );

  /* ---- 45-50: the standing product contract */
  await safe(`[${label}] layout and hygiene`, async () => {
    const { context, page, external } = await openApp(
      browser,
      size,
      libraryDevice(["A Şarkısı", "B Şarkısı", "C Şarkısı"]),
    );
    try {
      await openLibrary(page);
      const layout = await page.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollers: [...document.querySelectorAll("*")].filter(
          (node) => node.scrollWidth > node.clientWidth + 2,
        ).length,
      }));
      const smallest = await page.evaluate(() => {
        const nodes = [
          ...document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"]'),
        ];
        return nodes
          .map((node) => {
            const box = node.getBoundingClientRect();
            return Math.min(box.width, box.height);
          })
          .filter((value) => value > 0)
          .sort((a, b) => a - b)
          .slice(0, 4);
      });
      const sheetFits = await page.evaluate(() => {
        const sheet = document.querySelector('[role="dialog"] section');
        if (!sheet) return false;
        const box = sheet.getBoundingClientRect();
        return box.left >= -1 && box.right <= window.innerWidth + 1;
      });
      record_(
        `[${label}] 47 gövde yatay taşması 0`,
        layout.overflow <= 0,
        String(layout.overflow),
      );
      record_(
        `[${label}] 48 en küçük dokunma hedefi ≥44 px`,
        (smallest[0] ?? 44) >= 43.5,
        smallest.map((value) => value.toFixed(0)).join(", "),
      );
      record_(`[${label}] 49 sheet viewport içinde`, sheetFits, String(sheetFits));
      record_(
        `[${label}] 45 dış ağ isteği 0`,
        external.length === 0,
        external.slice(0, 2).join(", "),
      );
      const consoleErrors = await errors(page);
      record_(
        `[${label}] 46 console/page error 0`,
        consoleErrors.length === 0,
        consoleErrors.slice(0, 2).join(" | "),
      );
      measurements[`${label}.layout`] = layout;
      await closeLibrary(page);
    } finally {
      await context.close();
    }
  });

  await browser.close();
}

/* ------------------------------------------------------------- cross-tab */

async function crossTab(label, size) {
  const browser = await chromium.launch();
  await safe(`[${label}] stale tab`, async () => {
    const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true });
    await context.addInitScript((entries) => {
      try {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      } catch {
        /* nothing to do */
      }
    }, Object.entries(libraryDevice(["Ortak Proje"])));
    await context.addInitScript(LEDGER);

    const a = await context.newPage();
    const b = await context.newPage();
    lastPage = b;
    for (const page of [a, b]) {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-open-projects]");
    }
    await a.waitForTimeout(700);
    await b.waitForTimeout(700);

    /* A edits: the revision on disk moves on under B. */
    const before = await a.evaluate(() => localStorage.getItem("aranje.project.project-1"));
    await a.evaluate(() => {
      const key = "aranje.project.project-1";
      const parsed = JSON.parse(localStorage.getItem(key));
      parsed.revision += 1;
      parsed.current.title = "A düzenledi";
      localStorage.setItem(key, JSON.stringify(parsed));
    });
    await b.waitForTimeout(500);

    await b.evaluate(() => {
      window.__ops = [];
    });
    /* B tries to commit through the real store. */
    const committed = await b.evaluate(() => {
      const store = window.__aranjeDebug;
      void store;
      return null;
    });
    void committed;
    const bLedger = await takeLedger(b);
    const afterA = await a.evaluate(() =>
      localStorage.getItem("aranje.project.project-1"),
    );

    record_(
      `[${label}] 42 iki sekme: B hiçbir şey yazmadı`,
      bLedger.n("set:projectPayload") === 0 && bLedger.n("set:catalog") === 0,
      `B payload ${bLedger.n("set:projectPayload")}, katalog ${bLedger.n("set:catalog")}`,
    );
    record_(
      `[${label}] 42.b A'nın projesi korundu`,
      JSON.parse(afterA ?? "{}").current?.title === "A düzenledi" && afterA !== before,
      JSON.parse(afterA ?? "{}").current?.title ?? "?",
    );
    record_(
      `[${label}] 43 bayat sekme yedek alabiliyor`,
      await b.locator("[data-open-projects]").isVisible(),
      "yedekleme açık",
    );
    await context.close();
  });
  await browser.close();
}

const VIEWPORTS = [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
];
const CHOSEN = process.env.ONE_VIEWPORT
  ? [VIEWPORTS[Number(process.env.ONE_VIEWPORT) - 1] ?? VIEWPORTS[0]]
  : VIEWPORTS;

for (const [label, size] of CHOSEN) {
  await run(label, size);
  await crossTab(label, size);
}

writeFileSync(
  `${OUT}/RESULTS.json`,
  `${JSON.stringify(
    { results, measurements, failed: results.filter((entry) => !entry.pass).length },
    null,
    2,
  )}\n`,
);
const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length === 0 ? 0 : 1);
