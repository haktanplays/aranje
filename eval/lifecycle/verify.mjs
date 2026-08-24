/**
 * Faz 2L-B browser verification: new song, section and track lifecycle.
 *
 * Thirty-two scenarios in two viewports, against the real production build.
 * Storage writes are counted on the real `Storage.prototype.setItem`,
 * AudioContexts on the real constructor, provider calls on the real
 * `fetch` — every "one apply, one write" and "changes nothing" claim is a
 * measured number.
 *
 * **2Q-B §1.3.** This suite used to count writes to `aranje.song` and read
 * the song back from that key. The product stopped using it at K-52: a song
 * now lives in its project's record, named by the catalog. Every scenario
 * here was therefore reading `undefined` and reporting `writes=0` for edits
 * that had in fact been saved — a stale instrument, not a broken feature
 * (proved by running this suite unchanged against a pre-2Q-A build:
 * identical scores, `eval/multitrack/artifacts/REGRESSION.json`). The reads
 * and the counter now go through `eval/shared/project-storage.mjs`, which
 * classifies a write by *which* key moved.
 *
 * The Copilot-target scenario uses the client-side demo, which is baked in
 * at build time:
 *
 *   rm -rf .next && NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true npm run build
 *   npx next start -p 3100
 *   node eval/lifecycle/verify.mjs            # both viewports
 *   ONE_VIEWPORT=1 node eval/lifecycle/verify.mjs
 */
import { chromium } from "playwright";
import { layoutProbe, targetEdges } from "../shared/harness.mjs";
import {
  PROJECT_LEDGER,
  activeSongBytes,
  legacySongRaw,
  readActiveSong,
  writeTally,
} from "../shared/project-storage.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.LIFECYCLE_OUT ?? "eval/lifecycle/artifacts";
mkdirSync(OUT, { recursive: true });

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
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${name.replaceAll(" ", "-").slice(0, 40)}.png` })
      .catch(() => {});
    record(name, false, first);
    return undefined;
  }
}

const INSTRUMENT = PROJECT_LEDGER + `
  window.__providerCalls = 0;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    if (url.includes("/api/copilot")) window.__providerCalls += 1;
    return originalFetch(input, init);
  };
  window.__lastDownloadName = null;
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download")) window.__lastDownloadName = this.download;
    return originalClick.call(this);
  };
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
  await context.addInitScript(INSTRUMENT);
  if (options.refuseWriteCheck) await context.addInitScript(REFUSE_WRITE_CHECK);

  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(8000);
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
  return { context, page };
}

/* ----------------------------------------------------------- observations */

/**
 * How many song payloads have been written since the page loaded.
 *
 * `anyProject` rather than `activeProject`, because half of this suite's
 * scenarios *create* a project: the write that matters there lands on a key
 * that only becomes the active one afterwards. Scenarios about isolation ask
 * for the narrower number by name.
 */
const writes = async (page) => (await writeTally(page)).anyProject;
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const providerCalls = (page) => page.evaluate(() => window.__providerCalls);
const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors);
const stored = (page) => readActiveSong(page);
/** The exact bytes of the open project's song, for byte-equal claims. */
const currentBytes = (page) => activeSongBytes(page);
const debug = (page) =>
  page.evaluate(() => ({
    status: window.__aranjeDebug?.status() ?? null,
    loop: window.__aranjeDebug?.loop() ?? null,
    ticks: window.__aranjeDebug?.ticks() ?? null,
    totalTicks: window.__aranjeDebug?.totalTicks() ?? null,
  }));
const text = (page, selector) =>
  page
    .locator(selector)
    .first()
    .textContent()
    .then((value) => (value ?? "").trim())
    .catch(() => null);

/* --------------------------------------------------------------- gestures */

const openInfo = async (page) => {
  await page.locator("[aria-label='Ses kaynakları ve lisans']").click();
  await page.waitForSelector("[data-info-new-song]");
};

const openNewSong = async (page) => {
  await openInfo(page);
  await page.locator("[data-info-new-song]").click();
  await page.waitForSelector("[data-new-song-create]");
};

const openSongInfo = async (page) => {
  await openInfo(page);
  await page.locator("[data-info-song-info]").click();
  await page.waitForSelector("[data-song-info-apply]");
};

const showTab = async (page) => {
  await page.locator("[data-view-switch] button").nth(1).click();
  await page.waitForTimeout(250);
};

const openSectionManager = async (page) => {
  await showTab(page);
  await page.locator("[aria-label*='Tüm bölümler']").click();
  await page.waitForSelector("[data-section-manage]");
  await page.locator("[data-section-manage]").click();
  await page.waitForSelector("[data-section-add]");
};

const openTrackManager = async (page) => {
  await showTab(page);
  await page.locator("[data-track-control]").click();
  await page.waitForSelector("[data-track-manage]");
  await page.locator("[data-track-manage]").click();
  await page.waitForSelector("[data-track-add]");
};

const closeSheet = async (page) => {
  const kapat = page.locator("[role=dialog] button", { hasText: "Kapat" });
  if (await kapat.count()) await kapat.first().click();
  await page.waitForTimeout(200);
};

const createFromTemplate = async (page, templateId) => {
  await openNewSong(page);
  await page.locator(`[data-new-song-template='${templateId}']`).click();
  const before = await writes(page);
  await page.locator("[data-new-song-create]").click();
  await page.waitForTimeout(400);
  return (await writes(page)) - before;
};

/* ------------------------------------------------------------------- runs */

async function run(browser, size, label) {
  const at = (name) => `${label} ${name}`;

  /* ---------------------------------------------- 1-6: the new-song flow */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("01 Boş başlangıç oluşturur"), async () => {
      const delta = await createFromTemplate(page, "empty");
      const song = await stored(page);
      record(
        at("01 Boş başlangıç oluşturur"),
        delta === 1 &&
          song?.title === "Yeni Şarkı" &&
          song?.bpm === 120 &&
          song?.key === "E minor" &&
          song?.tracks.length === 1 &&
          song?.tracks[0]?.instrumentId === "electric_guitar" &&
          song?.sections.length === 1 &&
          song?.sections[0]?.bars.length === 4 &&
          /*
           * K-54 changed what a launch template leaves behind. It used to
           * leave no key at all, which read as "this track is not written in
           * this bar" and made the new song's first note impossible to
           * write. Every bar now carries one empty lane per track: written
           * here, saying nothing.
           */
          song?.sections[0]?.bars.every((bar) => {
            const lane = bar.slots[song.tracks[0].id];
            return (
              Object.keys(bar.slots).length === 1 &&
              Array.isArray(lane) &&
              lane.every((slot) => slot === null)
            );
          }) &&
          (await text(page, "h1")) === "Yeni Şarkı",
        `writes=${delta} tracks=${song?.tracks.length}`,
      );
    });

    await safe(at("02 Rock grubu oluşturur"), async () => {
      const delta = await createFromTemplate(page, "rock_band");
      const song = await stored(page);
      record(
        at("02 Rock grubu oluşturur"),
        delta === 1 &&
          song?.tracks.map((track) => track.instrumentId).join(",") ===
            "electric_guitar,electric_bass,drum_kit" &&
          song?.tracks.map((track) => track.id).join(",") ===
            "track-1,track-2,track-3",
        `writes=${delta} ids=${song?.tracks.map((t) => t.id).join(",")}`,
      );
    });

    await safe(at("03 Akustik oluşturur"), async () => {
      const delta = await createFromTemplate(page, "acoustic");
      const song = await stored(page);
      record(
        at("03 Akustik oluşturur"),
        delta === 1 &&
          song?.tracks.length === 1 &&
          song?.tracks[0]?.instrumentId === "steel_acoustic" &&
          song?.tracks[0]?.fretboard?.tuning.length === 6,
        `writes=${delta}`,
      );
    });

    await safe(at("04 Yeni şarkı öncesi yedek iner"), async () => {
      await openNewSong(page);
      const before = await writes(page);
      const waiting = page.waitForEvent("download");
      await page.locator("[data-new-song-backup]").click();
      const download = await waiting;
      const asked = await page.evaluate(() => window.__lastDownloadName);
      record(
        at("04 Yeni şarkı öncesi yedek iner"),
        download !== null &&
          (await writes(page)) === before &&
          typeof asked === "string" &&
          asked.endsWith(".aranje.json"),
        `asked=${asked}`,
      );
    });

    await safe(at("05 Yeni şarkı vazgeç hiçbir şey yazmaz"), async () => {
      // The sheet is still open from 04, with a template selected.
      await page.locator("[data-new-song-template='rock_band']").click();
      const before = await writes(page);
      const bytes = await currentBytes(page);
      await page.locator("[data-new-song-cancel]").click();
      await page.waitForTimeout(250);
      record(
        at("05 Yeni şarkı vazgeç hiçbir şey yazmaz"),
        (await writes(page)) === before &&
          (await currentBytes(page)) === bytes &&
          (await page.locator("[data-new-song-create]").count()) === 0,
      );
    });

    await safe(at("06 Yeni şarkı yeni proje açar, eskisine dokunmaz"), async () => {
      /*
       * This scenario used to press undo and expect "Geri al: Yeni şarkı
       * oluşturma". That behaviour no longer exists and should not: K-52
       * removed `create_song` and made "Yeni şarkı" open a *new project*.
       * A new project starts with its own empty history, so there is nothing
       * to undo — the control is disabled rather than offering to undo an
       * edit in a song the reader is no longer looking at. The old song is
       * not rolled back either; it is still there, under its own key.
       */
      const before = await page.evaluate(() => {
        const catalog = JSON.parse(localStorage.getItem("aranje.projects"));
        const id = catalog.activeProjectId;
        return { id, ids: catalog.projectIds.length, bytes: localStorage.getItem(`aranje.project.${id}`) };
      });
      const delta = await createFromTemplate(page, "rock_band");
      const after = await page.evaluate((previousId) => {
        const catalog = JSON.parse(localStorage.getItem("aranje.projects"));
        return {
          id: catalog.activeProjectId,
          ids: catalog.projectIds.length,
          previousBytes: localStorage.getItem(`aranje.project.${previousId}`),
        };
      }, before.id);
      const canUndo = await page.locator("[data-undo]").isEnabled();
      record(
        at("06 Yeni şarkı yeni proje açar, eskisine dokunmaz"),
        delta === 1 &&
          after.id !== before.id &&
          after.ids === before.ids + 1 &&
          after.previousBytes === before.bytes &&
          canUndo === false,
        `proje ${before.ids}→${after.ids} · eski bayt-eş ${after.previousBytes === before.bytes} · undo ${canUndo}`,
      );
    });

    measurements[`${label}-console-1`] = await consoleErrors(page);
    await context.close();
  }

  /* -------------------------------------------- 7-8: song info metadata */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("07 Başlık, tonalite ve tempo değişir"), async () => {
      await openSongInfo(page);
      await page.locator("[data-song-info-title]").fill("Gece Yolu");
      await page.locator("[data-song-info-tonic]").selectOption("A");
      await page.locator("[data-song-info-mode]").selectOption("minor");
      await page.locator("[data-song-info-bpm]").fill("96");
      const before = await writes(page);
      await page.locator("[data-song-info-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("07 Başlık, tonalite ve tempo değişir"),
        (await writes(page)) === before + 1 &&
          song?.title === "Gece Yolu" &&
          song?.key === "A minor" &&
          song?.bpm === 96 &&
          (await text(page, "h1")) === "Gece Yolu",
        `writes+${(await writes(page)) - before}`,
      );
    });

    await safe(at("08 Temel tempo değişince override korunur"), async () => {
      // Give the first section its own tempo through the manager...
      await openSectionManager(page);
      await page.locator("[data-section-action=tempo]").click();
      await page.locator("[data-section-tempo]").fill("90");
      await page.locator("[data-section-apply]").click();
      await page.waitForTimeout(300);
      await closeSheet(page);
      // ...then change the base tempo through the info sheet.
      await openSongInfo(page);
      await page.locator("[data-song-info-bpm]").fill("180");
      await page.locator("[data-song-info-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("08 Temel tempo değişince override korunur"),
        song?.bpm === 180 && song?.sections[0]?.bpmOverride === 90,
        `bpm=${song?.bpm} override=${song?.sections[0]?.bpmOverride}`,
      );
    });

    await safe(at("08b Aralık dışı tempo atomik reddedilir"), async () => {
      await openSongInfo(page);
      await page.locator("[data-song-info-bpm]").fill("999");
      const before = await writes(page);
      await page.locator("[data-song-info-apply]").click();
      await page.waitForTimeout(250);
      const message = await text(page, "[data-lifecycle-error]");
      const song = await stored(page);
      record(
        at("08b Aralık dışı tempo atomik reddedilir"),
        (await writes(page)) === before &&
          message !== null &&
          message.includes("Tempo") &&
          song?.bpm === 180,
        `msg=${message}`,
      );
      await page.locator("[role=dialog] button", { hasText: "Vazgeç" }).click();
    });

    measurements[`${label}-console-2`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------------ 9-16: the section manager */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("09 Bölüm sona eklenir"), async () => {
      await openSectionManager(page);
      await page.locator("[data-section-add]").click();
      await page.locator("[data-section-name]").fill("Final");
      await page.locator("[data-section-position]").selectOption("end");
      await page.locator("[data-section-bars]").fill("2");
      const before = await writes(page);
      await page.locator("[data-section-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      const created = song?.sections.at(-1);
      record(
        at("09 Bölüm sona eklenir"),
        (await writes(page)) === before + 1 &&
          created?.name === "Final" &&
          created?.bars.length === 2 &&
          created?.bars.every((bar) => Object.keys(bar.slots).length === 0),
        `sections=${song?.sections.length}`,
      );
    });

    await safe(at("10 Bölüm araya eklenir"), async () => {
      // The first section is the selected row by default.
      await page.locator("[data-section-row]").first().click();
      await page.locator("[data-section-add]").click();
      await page.locator("[data-section-name]").fill("Ara Bölüm");
      await page.locator("[data-section-position]").selectOption("after");
      await page.locator("[data-section-bars]").fill("1");
      const before = await writes(page);
      await page.locator("[data-section-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("10 Bölüm araya eklenir"),
        (await writes(page)) === before + 1 &&
          song?.sections[1]?.name === "Ara Bölüm" &&
          song?.sections[1]?.bars.length === 1,
        `order=${song?.sections.map((s) => s.name).join("|")}`,
      );
    });

    await safe(at("11 Bölüm yeniden adlandırılır"), async () => {
      const song0 = await stored(page);
      await page
        .locator(`[data-section-row='${song0.sections[1].id}']`)
        .click();
      await page.locator("[data-section-action=rename]").click();
      await page.locator("[data-section-name]").fill("Köprü");
      const before = await writes(page);
      await page.locator("[data-section-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("11 Bölüm yeniden adlandırılır"),
        (await writes(page)) === before + 1 &&
          song?.sections[1]?.name === "Köprü" &&
          song?.sections[1]?.id === song0.sections[1].id,
      );
    });

    await safe(at("12 Bölüm çoğaltılır, içerik byte-eş"), async () => {
      const song0 = await stored(page);
      const source = song0.sections[0];
      await page.locator(`[data-section-row='${source.id}']`).click();
      const before = await writes(page);
      await page.locator("[data-section-action=duplicate]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      const copy = song?.sections[1];
      record(
        at("12 Bölüm çoğaltılır, içerik byte-eş"),
        (await writes(page)) === before + 1 &&
          copy?.id === `${source.id}-copy` &&
          copy?.name === `${source.name} kopyası` &&
          JSON.stringify(copy?.bars) === JSON.stringify(source.bars),
        `copy=${copy?.id}`,
      );
    });

    await safe(at("13 Bölüm sırası değişir, ID'ler kalır"), async () => {
      const song0 = await stored(page);
      const mover = song0.sections[1];
      await page.locator(`[data-section-row='${mover.id}']`).click();
      const before = await writes(page);
      await page.locator("[data-section-action=down]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("13 Bölüm sırası değişir, ID'ler kalır"),
        (await writes(page)) === before + 1 &&
          song?.sections[2]?.id === mover.id &&
          JSON.stringify([...(song?.sections ?? [])].map((s) => s.id).sort()) ===
            JSON.stringify(song0.sections.map((s) => s.id).sort()),
        `order=${song?.sections.map((s) => s.id).join(",")}`,
      );
    });

    await safe(at("14 Bölüm silinir, onay adı ve ölçüyü söyler"), async () => {
      const song0 = await stored(page);
      const victim = song0.sections[1];
      await page.locator(`[data-section-row='${victim.id}']`).click();
      await page.locator("[data-section-action=delete]").click();
      const confirmation = await page.locator("[role=dialog]").innerText();
      const before = await writes(page);
      await page.locator("[data-section-confirm-delete]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("14 Bölüm silinir, onay adı ve ölçüyü söyler"),
        confirmation.includes(`"${victim.name}"`) &&
          confirmation.includes(`${victim.bars.length} ölçü`) &&
          (await writes(page)) === before + 1 &&
          song?.sections.every((section) => section.id !== victim.id),
        `sections=${song?.sections.length}`,
      );
    });

    await safe(at("15 Son bölüm silinemez"), async () => {
      // Delete down to one, then ask once more.
      for (;;) {
        const song = await stored(page);
        if (song.sections.length <= 1) break;
        await page
          .locator(`[data-section-row='${song.sections[0].id}']`)
          .click();
        await page.locator("[data-section-action=delete]").click();
        await page.locator("[data-section-confirm-delete]").click();
        await page.waitForTimeout(300);
      }
      const before = await writes(page);
      await page.locator("[data-section-action=delete]").click();
      await page.locator("[data-section-confirm-delete]").click();
      await page.waitForTimeout(250);
      const message = await text(page, "[data-lifecycle-error]");
      record(
        at("15 Son bölüm silinemez"),
        (await writes(page)) === before &&
          message === "Son kalan bölüm silinemez." &&
          (await stored(page)).sections.length === 1,
        `msg=${message}`,
      );
      // Leave the confirmation politely.
      await page.locator("[role=dialog] button", { hasText: "Vazgeç" }).click();
    });

    await safe(at("16 Bölüm temposu kurulur ve kaldırılır"), async () => {
      await page.locator("[data-section-action=tempo]").click();
      await page.locator("[data-section-tempo]").fill("72");
      const before = await writes(page);
      await page.locator("[data-section-apply]").click();
      await page.waitForTimeout(300);
      const withOverride = (await stored(page)).sections[0]?.bpmOverride;
      await page.locator("[data-section-action=tempo]").click();
      await page.locator("[data-section-clear-tempo]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("16 Bölüm temposu kurulur ve kaldırılır"),
        withOverride === 72 &&
          (await writes(page)) === before + 2 &&
          song?.sections[0]?.bpmOverride === undefined,
        `override=${withOverride}`,
      );
    });

    measurements[`${label}-console-3`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------------- 17-22: the track manager */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("17 Track eklenir"), async () => {
      await openTrackManager(page);
      await page.locator("[data-track-add]").click();
      await page.locator("[data-track-name]").fill("Yeni Kanal");
      const before = await writes(page);
      await page.locator("[data-track-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      const created = song?.tracks.at(-1);
      record(
        at("17 Track eklenir"),
        (await writes(page)) === before + 1 &&
          created?.name === "Yeni Kanal" &&
          created?.id === "track-1" &&
          /*
           * K-55: a new track is somewhere you can write. Every bar gains an
           * empty lane for it — silent by the same rule as a missing key,
           * and unlike a missing key, writable. The old expectation here
           * (no key anywhere) was the defect 2Q-A closed.
           */
          song?.sections.every((section) =>
            section.bars.every((bar) => {
              const lane = bar.slots[created.id];
              return Array.isArray(lane) && lane.every((slot) => slot === null);
            }),
          ),
        `tracks=${song?.tracks.length}`,
      );
    });

    await safe(at("18 Track yeniden adlandırılır"), async () => {
      await page.locator("[data-track-row='track-1']").click();
      await page.locator("[data-track-action=rename]").click();
      await page.locator("[data-track-name]").fill("Kanal İki");
      const before = await writes(page);
      await page.locator("[data-track-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("18 Track yeniden adlandırılır"),
        (await writes(page)) === before + 1 &&
          song?.tracks.find((track) => track.id === "track-1")?.name ===
            "Kanal İki",
      );
    });

    await safe(at("19 Track çoğaltılır, tüm bölüm içeriğiyle"), async () => {
      const song0 = await stored(page);
      await page.locator("[data-track-row='gtr']").click();
      const before = await writes(page);
      await page.locator("[data-track-action=duplicate]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      const copy = song?.tracks.find((track) => track.id === "gtr-copy");
      const contentFollows = song?.sections.every((section, sectionIndex) =>
        section.bars.every((bar, barIndex) => {
          const source =
            song0.sections[sectionIndex]?.bars[barIndex]?.slots["gtr"];
          const copied = bar.slots["gtr-copy"];
          if (source === undefined) return copied === undefined;
          return JSON.stringify(copied) === JSON.stringify(source);
        }),
      );
      record(
        at("19 Track çoğaltılır, tüm bölüm içeriğiyle"),
        (await writes(page)) === before + 1 &&
          copy?.name === "Gitar 1 kopyası" &&
          contentFollows === true,
        `copy=${copy?.id}`,
      );
    });

    await safe(at("20 Track sırası değişir, ID ve içerik kalır"), async () => {
      const song0 = await stored(page);
      await page.locator("[data-track-row='gtr']").click();
      const before = await writes(page);
      await page.locator("[data-track-action=down]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("20 Track sırası değişir, ID ve içerik kalır"),
        (await writes(page)) === before + 1 &&
          JSON.stringify([...(song?.tracks ?? [])].map((t) => t.id).sort()) ===
            JSON.stringify(song0.tracks.map((t) => t.id).sort()) &&
          song?.tracks[0]?.id !== "gtr" &&
          JSON.stringify(song?.sections) === JSON.stringify(song0.sections),
        `order=${song?.tracks.map((t) => t.id).join(",")}`,
      );
    });

    await safe(at("21 Track silinir, anahtarlarıyla birlikte"), async () => {
      await page.locator("[data-track-row='gtr']").click();
      await page.locator("[data-track-action=delete]").click();
      const confirmation = await page.locator("[role=dialog]").innerText();
      const before = await writes(page);
      await page.locator("[data-track-confirm-delete]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("21 Track silinir, anahtarlarıyla birlikte"),
        confirmation.includes("silinecek") &&
          (await writes(page)) === before + 1 &&
          song?.tracks.every((track) => track.id !== "gtr") &&
          song?.sections.every((section) =>
            section.bars.every((bar) => !("gtr" in bar.slots)),
          ),
        `tracks=${song?.tracks.length}`,
      );
    });

    await safe(at("22 Son track silinemez"), async () => {
      for (;;) {
        const song = await stored(page);
        if (song.tracks.length <= 1) break;
        await page.locator(`[data-track-row='${song.tracks[0].id}']`).click();
        await page.locator("[data-track-action=delete]").click();
        await page.locator("[data-track-confirm-delete]").click();
        await page.waitForTimeout(300);
      }
      const before = await writes(page);
      await page.locator("[data-track-action=delete]").click();
      await page.locator("[data-track-confirm-delete]").click();
      await page.waitForTimeout(250);
      const message = await text(page, "[data-lifecycle-error]");
      record(
        at("22 Son track silinemez"),
        (await writes(page)) === before &&
          message === "Son kalan track silinemez." &&
          (await stored(page)).tracks.length === 1,
        `msg=${message}`,
      );
      await page.locator("[role=dialog] button", { hasText: "Vazgeç" }).click();
    });

    measurements[`${label}-console-4`] = await consoleErrors(page);
    await context.close();
  }

  /* --------------------------------- 23-26: setup safety, the two roads */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("23 Uyumlu setup değişimi içerikle uygulanır"), async () => {
      await openTrackManager(page);
      await page.locator("[data-track-row='gtr']").click();
      await page.locator("[data-track-action=setup]").click();
      /*
       * This used to switch the preset to `clean`, and that change is no
       * longer offered: K-54 stopped listing a preset with no sound behind
       * it, and the electric guitar has exactly one playable core preset.
       *
       * Nor is the tuning a substitute — it is the *incompatible* axis by
       * design: every written note carries an explicit pitch and position,
       * so re-tuning the string under it is refused atomically rather than
       * silently re-pitching the music (that refusal is scenario 24).
       *
       * What remains compatible through this form is the part of the setup
       * that no note depends on. The claim under test is unchanged: a
       * compatible change commits once and keeps every note.
       */
      await page.locator("[data-track-name]").fill("Ritim Gitar");
      const before = await writes(page);
      await page.locator("[data-track-apply]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      // Nothing is on disk before the first commit, so "content kept" is
      // read off the committed song: the guitar lane still carries music.
      const keepsContent = song?.sections.some((section) =>
        section.bars.some((bar) => {
          const slots = bar.slots["gtr"];
          return Array.isArray(slots) && slots.some((slot) => slot !== null);
        }),
      );
      record(
        at("23 Uyumlu setup değişimi içerikle uygulanır"),
        (await writes(page)) === before + 1 &&
          song?.tracks[0]?.name === "Ritim Gitar" &&
          song?.tracks[0]?.fretboard?.tuning[0] === "E2" &&
          keepsContent === true,
        `name=${song?.tracks[0]?.name}`,
      );
    });

    await safe(at("24 Uyumsuz setup atomik reddedilir"), async () => {
      await page.locator("[data-track-action=setup]").click();
      // A drum kit cannot carry the guitar's written notes.
      await page.locator("[data-track-instrument]").selectOption("drum_kit");
      const before = await writes(page);
      const bytes = await currentBytes(page);
      await page.locator("[data-track-apply]").click();
      await page.waitForTimeout(250);
      const message = await text(page, "[data-lifecycle-error]");
      record(
        at("24 Uyumsuz setup atomik reddedilir"),
        (await writes(page)) === before &&
          (await currentBytes(page)) === bytes &&
          message !== null &&
          message.includes("içeriği temizleyerek"),
        `msg=${message?.slice(0, 60)}`,
      );
    });

    await safe(at("25 İçeriği temizleyerek değiştirme ayrı yoldur"), async () => {
      // Still on the setup form with the drum kit chosen.
      await page.locator("[data-track-destructive]").click();
      const confirmation = await page.locator("[role=dialog]").innerText();
      const before = await writes(page);
      await page.locator("[data-track-confirm-destructive]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("25 İçeriği temizleyerek değiştirme ayrı yoldur"),
        confirmation.includes("notaları silinecek") &&
          (await writes(page)) === before + 1 &&
          song?.tracks[0]?.instrumentId === "drum_kit" &&
          song?.tracks[0]?.fretboard === undefined &&
          /*
           * The content goes; the track's place in the bar does not. Under
           * K-55 an emptied lane is an empty *drum* lane — the shape follows
           * the new instrument — rather than a missing key, which would make
           * the track unwritable again.
           */
          song?.sections.every((section) =>
            section.bars.every((bar) => {
              const lane = bar.slots["gtr"];
              return (
                Array.isArray(lane) &&
                lane.every((slot) => Array.isArray(slot) && slot.length === 0)
              );
            }),
          ),
        `instrument=${song?.tracks[0]?.instrumentId}`,
      );
    });

    await safe(at("26 Yıkıcı işlem undo ile byte-eş döner"), async () => {
      // 23's committed song is the state before the destructive change.
      const undoLabel = await page
        .locator("[data-undo]")
        .getAttribute("aria-label");
      await closeSheet(page);
      const before = await writes(page);
      await page.locator("[data-undo]").click();
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("26 Yıkıcı işlem undo ile byte-eş döner"),
        undoLabel === "Geri al: Track içeriğini temizleyip ayar değiştirme" &&
          (await writes(page)) === before + 1 &&
          song?.tracks[0]?.instrumentId === "electric_guitar" &&
          song?.sections.some((section) =>
            section.bars.some((bar) => "gtr" in bar.slots),
          ),
        `undoLabel=${undoLabel}`,
      );
    });

    measurements[`${label}-console-5`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------- 27-28: playback under structural ops */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("27 Çalarken yapısal işlem: güvenli durma, tek motor"), async () => {
      await page.locator("[aria-label='Çal']").click();
      await page.waitForTimeout(800);
      const playing = (await debug(page)).status;
      await openSectionManager(page);
      await page.locator("[data-section-action=duplicate]").click();
      await page.waitForTimeout(400);
      const after = await debug(page);
      record(
        at("27 Çalarken yapısal işlem: güvenli durma, tek motor"),
        playing === "playing" &&
          after.status !== "playing" &&
          (await contexts(page)) === 1,
        `status ${playing} -> ${after.status}, contexts=${await contexts(page)}`,
      );
      await closeSheet(page);
    });

    await safe(at("28 Silinen döngü hedefi: loop kapanır, playhead geçerli"), async () => {
      // Loop the first section (the default target), then delete it.
      await page.locator("[aria-label='Bölüm döngüsü']").click();
      await page.waitForTimeout(200);
      const loopedOn = (await debug(page)).loop?.on === true;
      const firstId = (await stored(page)).sections[0].id;
      await openSectionManager(page);
      await page.locator(`[data-section-row='${firstId}']`).click();
      await page.locator("[data-section-action=delete]").click();
      await page.locator("[data-section-confirm-delete]").click();
      await page.waitForTimeout(400);
      const after = await debug(page);
      /*
       * The engine clears the transport loop for an unknown section on its
       * own, so the *state* is asserted too: a loop button still pressed for
       * a section that no longer exists would be the UI lying.
       */
      const buttonPressed = await page
        .locator("[aria-label='Bölüm döngüsü']")
        .getAttribute("aria-pressed");
      record(
        at("28 Silinen döngü hedefi: loop kapanır, playhead geçerli"),
        loopedOn &&
          (after.loop === null || after.loop.on === false) &&
          buttonPressed === "false" &&
          after.ticks !== null &&
          after.totalTicks !== null &&
          after.ticks >= 0 &&
          after.ticks <= after.totalTicks,
        `loop=${JSON.stringify(after.loop)} pressed=${buttonPressed} ticks=${after.ticks}/${after.totalTicks}`,
      );
      await closeSheet(page);
    });

    measurements[`${label}-console-6`] = await consoleErrors(page);
    await context.close();
  }

  /* --------------------------------------------- 29: writing is closed */
  {
    const { context, page } = await openApp(browser, size, {
      refuseWriteCheck: true,
    });

    await safe(at("29 canPersist kapalı: oluşturma kapalı, yedek çalışır"), async () => {
      await openNewSong(page);
      const disabled = await page.locator("[data-new-song-create]").isDisabled();
      const waiting = page.waitForEvent("download");
      await page.locator("[data-new-song-backup]").click();
      const download = await waiting;
      const playEnabled = await page
        .locator("[aria-label='Çal']")
        .isEnabled()
        .catch(() => false);
      record(
        at("29 canPersist kapalı: oluşturma kapalı, yedek çalışır"),
        disabled && download !== null && (await writes(page)) === 0 && playEnabled,
        `disabled=${disabled} writes=${await writes(page)}`,
      );
    });

    measurements[`${label}-console-7`] = await consoleErrors(page);
    await context.close();
  }

  /* -------------------------- 30-31: project boundary, Copilot targets */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("30 Yeni şarkı proje dosyasıyla gidip gelir"), async () => {
      // A template song exported...
      await createFromTemplate(page, "rock_band");
      await openInfo(page);
      const waiting = page.waitForEvent("download");
      await page.locator("[data-info-project-backup]").click();
      const download = await waiting;
      const path = await download.path();
      // The backdrop is under the panel at its centre; the corner is real.
      await page
        .locator("[aria-label='Kapat']")
        .first()
        .click({ position: { x: 8, y: 8 } });
      // ...the song replaced by another template...
      await createFromTemplate(page, "acoustic");
      // ...and the export opened back over it.
      await openInfo(page);
      await page.locator("[data-info-project-open]").click();
      await page.waitForSelector("[data-project-sheet]");
      await page.locator("[data-project-file-input]").setInputFiles(path);
      await page.waitForSelector("[data-project-preview]");
      const before = await writes(page);
      await page.locator("[data-project-apply]").click();
      await page.waitForTimeout(400);
      const song = await stored(page);
      record(
        at("30 Yeni şarkı proje dosyasıyla gidip gelir"),
        (await writes(page)) === before + 1 &&
          song?.tracks.length === 3 &&
          song?.tracks[2]?.instrumentId === "drum_kit",
        `tracks=${song?.tracks.length}`,
      );
    });

    await safe(at("31 Copilot hedef listesi yeni track'i görür, provider 0"), async () => {
      await openTrackManager(page);
      await page.locator("[data-track-add]").click();
      await page.locator("[data-track-name]").fill("Hedef Testi");
      await page.locator("[data-track-apply]").click();
      await page.waitForTimeout(300);
      await closeSheet(page);
      await page.locator("button", { hasText: "Aranje et" }).click();
      await page.waitForTimeout(400);
      const sheet = await page.locator("[role=dialog]").innerText();
      record(
        at("31 Copilot hedef listesi yeni track'i görür, provider 0"),
        sheet.includes("Hedef Testi") && (await providerCalls(page)) === 0,
        `provider=${await providerCalls(page)}`,
      );
      await page.locator("[role=dialog] button", { hasText: "Vazgeç" }).first().click().catch(() => {});
    });

    measurements[`${label}-console-8`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------------------- 32: layout and 44px */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("32 Sheet'ler viewport içinde, hedefler 44px"), async () => {
      await openTrackManager(page);
      const layout = await layoutProbe(page);
      const edges = await targetEdges(page, [
        "[data-track-add]",
        "[data-track-action=rename]",
        "[data-track-action=delete]",
        "[data-track-row='gtr']",
      ]);
      const sheetBox = await page
        .locator("[role=dialog] section")
        .first()
        .boundingBox();
      const inViewport =
        sheetBox !== null &&
        sheetBox.y >= 0 &&
        sheetBox.y + sheetBox.height <= size.height + 1;
      measurements[`${label}-layout`] = { layout, edges };
      record(
        at("32 Sheet'ler viewport içinde, hedefler 44px"),
        layout.bodyOverflow === 0 &&
          layout.scrollers === 1 &&
          edges.every((edge) => edge >= 44) &&
          inViewport,
        `overflow=${layout.bodyOverflow} scrollers=${layout.scrollers} edges=${edges.join(",")}`,
      );
    });

    await safe(at("33 Konsol sessiz kaldı"), async () => {
      const all = Object.entries(measurements)
        .filter(([key]) => key.startsWith(`${label}-console`))
        .flatMap(([, value]) => value);
      const here = await consoleErrors(page);
      record(
        at("33 Konsol sessiz kaldı"),
        all.length === 0 && here.length === 0,
        all.concat(here).slice(0, 2).join(" | "),
      );
    });

    await context.close();
  }
}

/* -------------------------------------------------------------------- main */

const browser = await chromium.launch();
await run(browser, { width: 390, height: 844 }, "@390x844");
if (!process.env.ONE_VIEWPORT) {
  await run(browser, { width: 320, height: 700 }, "@320x700");
}
await browser.close();

const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
flush();
process.exit(failed.length === 0 ? 0 : 1);
