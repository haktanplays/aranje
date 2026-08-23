/**
 * Faz 2N-A browser acceptance (spec 13.20 §9).
 *
 * Thirty-three scenarios plus the thirteen extra measurements the review
 * asked for, in two phone viewports, against the real production build.
 *
 * The rule this suite works to: a claim is measured on the thing it is about.
 * "The selection is one chord" is the band's own tick range and the notes
 * really drawn inside it, not a summary string; "nothing was written" is a
 * count of `localStorage.setItem` calls; "the tab changed" is a digest of the
 * fret glyphs on screen. A scenario that only checked a label would pass for a
 * surface that never repainted — which is exactly the defect §0 measured.
 *
 *   rm -rf .next && npm run build && npx next start -p 3100
 *   node eval/tab/verify.mjs            # both viewports
 *   ONE_VIEWPORT=1 node eval/tab/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { layoutProbe, targetEdges, unwrapStoredSong } from "../shared/harness.mjs";
import {
  rhythmSong,
  selectionSong,
  shortTwoSections,
  tiedSong,
  timingSong,
  twoSections,
} from "./songs.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.TAB_OUT ?? "eval/tab/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const measurements = {};

const flush = () =>
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      { results, measurements, failed: results.filter((entry) => !entry.pass).length },
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
    const first = String(error).split("\n")[0].slice(0, 120);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${name.replaceAll(/[^\w]+/g, "-").slice(0, 40)}.png` })
      .catch(() => {});
    record(name, false, first);
    return undefined;
  }
}

/*
 * Counted on the real APIs, before any app code runs.
 *
 * Writes and AudioContexts are the two things every "nothing happened" claim
 * in this suite rests on, so neither is inferred from the UI.
 */
const INSTRUMENT = `
  window.__writes = 0;
  window.__audioContexts = 0;
  window.__consoleErrors = [];
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

/*
 * Press one control, and say which one if it cannot be pressed.
 *
 * A bare `locator.click()` that times out reports only "click timed out",
 * which in a sequence of eight presses is not a diagnosis. Naming the step
 * turns a fifteen-second silence into the selector that was actually stuck.
 */
async function press(page, selector, { settle = 300 } = {}) {
  const control = page.locator(selector).first();
  try {
    await control.scrollIntoViewIfNeeded({ timeout: 5000 });
    await control.click({ timeout: 8000 });
  } catch (error) {
    const count = await page.locator(selector).count();
    const dialogs = await page.locator('[role="dialog"]').count();
    throw new Error(
      `press(${selector}) failed: ${count} eşleşme, ${dialogs} açık sheet — ${
        String(error).split("\n")[0]
      }`,
    );
  }
  await page.waitForTimeout(settle);
}

/*
 * Close every open sheet, topmost first.
 *
 * Each sheet paints a full-screen backdrop, so one left open silently swallows
 * every press aimed at the surface behind it: the control stays present,
 * findable and unclickable at once, and the run stalls on a button that is
 * really there. Closing the *last* dialog dismisses the one actually on top
 * rather than whichever backdrop matched first.
 *
 * The press lands near the backdrop's top-left corner rather than its centre.
 * The panel is bottom-anchored and up to 85dvh tall, so in a short viewport it
 * covers the middle of its own backdrop; a centre click is then intercepted by
 * the panel and never resolves — a property of the viewport, not of the app.
 * The top strip is free at every height this suite runs.
 */
async function closeSheets(page) {
  for (let guard = 0; guard < 4; guard += 1) {
    const dialogs = page.locator('[role="dialog"]');
    if ((await dialogs.count()) === 0) return;
    await dialogs
      .last()
      .locator('button[aria-label="Kapat"]')
      .first()
      .click({ position: { x: 6, y: 6 }, timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function openApp(browser, size, seed, { debug = false } = {}) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* a private window is not a reason to fail the run */
      }
    },
    ["aranje.song", JSON.stringify(seed)],
  );
  await context.addInitScript(INSTRUMENT);

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
      page.evaluate((text) => window.__consoleErrors.push(text), message.text()).catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((text) => window.__consoleErrors.push(text), String(error)).catch(() => {});
  });
  await page.goto(`${BASE}/${debug ? "?debug=1" : ""}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, external };
}

/* ------------------------------------------------------------ observations */

const writes = (page) => page.evaluate(() => window.__writes);
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors);
/*
 * The song as it really is on disk.
 *
 * Unwrapped by the shared helper rather than by a guess about the envelope:
 * reading the wrapper as if it were the song is how the first run of this
 * suite reported "resolution undefined" for a change that had applied
 * perfectly well.
 */
const stored = async (page) =>
  unwrapStoredSong(await page.evaluate(() => localStorage.getItem("aranje.song")));

/**
 * A song as a string that depends on its content and not on key order.
 *
 * The seeded song is written straight into storage in the fixture's key order;
 * once the app has committed once it is the schema's order. Comparing the raw
 * strings would call those two different songs, which they are not — so the
 * comparison is made canonical rather than made weaker.
 */
const canonical = (value) =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );

/** The band the app drew, in its own ticks, and what it says it holds. */
const band = (page) =>
  page.evaluate(() => {
    const node = document.querySelector('[data-testid="time-selection-band"]');
    const summary = document.querySelector('[data-testid="selection-summary"]');
    return {
      present: node !== null,
      startTicks: node ? Number(node.getAttribute("data-start-ticks")) : null,
      endTicks: node ? Number(node.getAttribute("data-end-ticks")) : null,
      summary: summary?.textContent?.trim() ?? null,
    };
  });

/** Fret glyphs really on screen, as pitch@slot per bar. */
const digest = (page) =>
  page.evaluate(() => {
    const content = document.querySelector("[data-tab-content]");
    const scroller = content?.closest(".overflow-x-auto");
    if (!scroller) return { first: null, text: "", viewed: null };
    const frame = scroller.getBoundingClientRect();
    const seen = [...document.querySelectorAll("[data-bar-key]")].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.right > frame.left + 34 + 8 && box.left < frame.right - 8;
    });
    return {
      first: seen[0]?.getAttribute("data-bar-key") ?? null,
      viewed: content?.getAttribute("data-viewed-section") ?? null,
      text: seen
        .flatMap((node) =>
          [...node.querySelectorAll("span[title]")].map(
            (glyph) =>
              `${glyph.getAttribute("title")}@${Math.round(
                Number.parseFloat(glyph.style.left || "0"),
              )}`,
          ),
        )
        .join(" "),
    };
  });

/** Every beam group drawn, with the bar it belongs to. */
const beams = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-bar-key] [role="img"][aria-label^="Ritim grubu"]')].map(
      (node) => ({
        bar: node.closest("[data-bar-key]")?.getAttribute("data-bar-key") ?? null,
        label: node.getAttribute("aria-label"),
        lines: node.querySelectorAll("span.h-px").length,
        triplets: [...node.querySelectorAll("span")].filter(
          (span) => span.textContent === "3",
        ).length,
      }),
    ),
  );

/** Overlaps between the beam boxes and everything they must not cover. */
const overlaps = (page) =>
  page.evaluate(() => {
    const hits = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const boxes = (selector) =>
      [...document.querySelectorAll(selector)].map((node) => node.getBoundingClientRect());
    const beamBoxes = boxes('[aria-label^="Ritim grubu"]');
    const count = (selector) => {
      let total = 0;
      for (const beam of beamBoxes) {
        for (const other of boxes(selector)) if (hits(beam, other)) total += 1;
      }
      return total;
    };
    return {
      fret: count("[data-bar-key] span[title]"),
      articulation: count("[data-bar-key] [data-articulation]"),
      selection: count('[data-testid="time-selection-band"]'),
      playhead: count("[data-tab-content] .z-20"),
    };
  });

/* --------------------------------------------------------------- gestures */

async function touch(page, cdp, x, y, holdMs) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await page.waitForTimeout(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(450);
}

async function showTab(page) {
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(250);
}

async function enterEditMode(page) {
  const toggle = page.getByRole("button", { name: "Düzenle", exact: true });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(250);
  }
}

/** Long press a named cell of a named bar. */
async function pressCell(page, cdp, barKey, cell) {
  const target = page.locator(`[data-bar-key="${barKey}"] [data-cell="${cell}"]`).first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await target.boundingBox();
  if (!box) throw new Error(`no box for ${barKey} ${cell}`);
  await touch(page, cdp, box.x + box.width / 2, box.y + box.height / 2, 700);
}

const clearSelection = async (page) => {
  await page
    .getByRole("button", { name: "Seçimi iptal et" })
    .click()
    .catch(() => {});
  await page.waitForTimeout(200);
};

/* ------------------------------------------------------------- the run */

async function run(label, size) {
  const browser = await chromium.launch();

  /* ---- 1-8: selection and the chain decision */
  await safe(`[${label}] selection`, async () => {
    const { context, page, cdp } = await openApp(browser, size, selectionSong());
    try {
      await showTab(page);
      await enterEditMode(page);

      // 1. an unconnected single note
      await pressCell(page, cdp, "intro:0", "0:0");
      let held = await band(page);
      record(
        `[${label}] 1 bağlantısız tek nota → 1 onset`,
        held.endTicks - held.startTicks === 96 && /1 nota/.test(held.summary ?? ""),
        `${held.startTicks}-${held.endTicks} "${held.summary}"`,
      );
      await clearSelection(page);

      // 2. a two-note power chord
      await pressCell(page, cdp, "intro:0", "2:0");
      held = await band(page);
      record(
        `[${label}] 2 power chord → yalnız 2 nota`,
        held.endTicks - held.startTicks === 96 && /2 nota/.test(held.summary ?? ""),
        `${held.startTicks}-${held.endTicks} "${held.summary}"`,
      );
      await clearSelection(page);

      // 3. the middle of the chain
      await pressCell(page, cdp, "intro:0", "5:0");
      held = await band(page);
      record(
        `[${label}] 3 zincir ortası → başlangıçta yalnız akor`,
        held.startTicks === 480 && held.endTicks === 576,
        `${held.startTicks}-${held.endTicks} "${held.summary}"`,
      );
      measurements[`${label}.chainPress`] = held;

      // 4-6. the three decisions
      const writesBefore = await writes(page);
      await page.locator('[data-testid="selection-action-delete"]').click();
      await page.waitForTimeout(400);
      const includeLabel = await page
        .locator('[data-testid="chain-option-include_chain"]')
        .innerText();
      const detachLabel = await page
        .locator('[data-testid="chain-option-detach_boundary"]')
        .innerText();
      record(
        `[${label}] 4 "bağlantıyla birlikte" gerçek kapsamı gösteriyor`,
        // Three shapes of two notes each: the summary counts notes, and the
        // sentence is the delete verb rather than a generic one.
        /6 nota/.test(includeLabel) && /silinir/.test(includeLabel),
        includeLabel.replaceAll("\n", " · "),
      );
      record(
        `[${label}] 5 "yalnız akor" ne kaldıracağını söylüyor`,
        /Yalnız akoru sil/.test(detachLabel) && /hammer-on/.test(detachLabel),
        detachLabel.replaceAll("\n", " · "),
      );
      await page.locator('[data-testid="chain-option-cancel"]').click();
      await page.waitForTimeout(300);
      record(
        `[${label}] 6 vazgeç → 0 yazım`,
        (await writes(page)) === writesBefore,
        `${await writes(page)} yazım`,
      );

      // 7. apply detach: one write
      const beforeEdit = canonical(await stored(page));
      await pressCell(page, cdp, "intro:0", "5:0");
      await page.locator('[data-testid="selection-action-delete"]').click();
      await page.waitForTimeout(400);
      const beforeApply = await writes(page);
      await page.locator('[data-testid="chain-option-detach_boundary"]').click();
      await page.waitForTimeout(700);
      record(
        `[${label}] 7 uygula → 1 yazım`,
        (await writes(page)) - beforeApply === 1,
        `${(await writes(page)) - beforeApply}`,
      );

      // 8. undo restores the chain byte for byte
      const afterApply = canonical(await stored(page));
      await page.getByRole("button", { name: /Geri al/ }).first().click();
      await page.waitForTimeout(700);
      const back = await stored(page);
      const afterUndo = canonical(back);
      /*
       * Byte-equal against the song as it was on disk before the edit, not
       * merely "different from the edited one" — and the hammer-on named
       * explicitly, so an undo that restored the notes without their bond
       * would still fail.
       */
      const slot = back?.sections?.[0]?.bars?.[0]?.slots?.gtr?.[5];
      record(
        `[${label}] 8 undo → zincir byte-eş geri`,
        afterUndo !== afterApply &&
          afterUndo === beforeEdit &&
          slot?.notes?.[0]?.articulation === "hammer_on",
        JSON.stringify(slot ?? null).slice(0, 70),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 9-11: sections */
  await safe(`[${label}] sections`, async () => {
    const { context, page } = await openApp(browser, size, twoSections(), {
      debug: true,
    });
    try {
      await showTab(page);
      const before = await digest(page);
      await page.locator('[data-section-nav] button[aria-label^="Sonraki bölüm"]').click();
      await page.waitForTimeout(800);
      const after = await digest(page);
      record(
        `[${label}] 9 Intro → Ana: tab digest gerçekten değişiyor`,
        after.viewed === "main" && after.first === "main:0" && after.text !== before.text,
        `${before.first} → ${after.first}, digest ${before.text === after.text ? "aynı" : "değişti"}`,
      );

      /*
       * 11. A bar tap is an explicit seek.
       *
       * Measured in transport ticks rather than in `position().barKey`, which
       * is null while nothing is playing — a stopped transport still has a
       * position, and that is exactly what a seek moves. `main:2` is the
       * seventh bar of eight 4/4 bars at 1/8, so its start is 6 × 768.
       */
      const ticksBefore = await page.evaluate(() => window.__aranjeDebug?.ticks() ?? null);
      const cell = page.locator('[data-tab-bar-header="main:2"]').first();
      await cell.scrollIntoViewIfNeeded();
      await cell.click();
      await page.waitForTimeout(600);
      const ticksAfter = await page.evaluate(() => window.__aranjeDebug?.ticks() ?? null);
      record(
        `[${label}] 11 bar dokunuşu açık seek`,
        ticksAfter === 6 * 768 && ticksAfter !== ticksBefore,
        `${ticksBefore} → ${ticksAfter} tick`,
      );
      measurements[`${label}.audioContexts`] = await contexts(page);
    } finally {
      await context.close();
    }
  });

  /* ---- 10: leaving the playhead behind, in its own context */
  await safe(`[${label}] playing section`, async () => {
    /*
     * Its own context on purpose. The scenario is about stepping *away* from
     * the section the transport is in, and that only means something from a
     * state where the view is still following it — which an earlier jump in
     * a shared context would already have ended.
     */
    const { context, page } = await openApp(browser, size, twoSections(), { debug: true });
    try {
      await showTab(page);
      await page.getByRole("button", { name: /Çal/ }).first().click();
      await page.waitForTimeout(2200);
      const playing = await page.evaluate(() => ({
        status: window.__aranjeDebug?.status() ?? null,
        bar: window.__aranjeDebug?.position?.().barKey ?? null,
        playhead: (() => {
          const node = document.querySelector("[data-tab-content] .z-20");
          return node ? getComputedStyle(node).opacity : null;
        })(),
      }));
      record(
        `[${label}] 10.a çalınan bölüm görünürken playhead çiziliyor`,
        playing.status === "playing" && playing.playhead === "1",
        `${playing.bar} · opacity ${playing.playhead}`,
      );

      await page.locator('[data-section-nav] button[aria-label^="Sonraki bölüm"]').click();
      await page.waitForTimeout(800);
      const stepped = await page.evaluate(() => ({
        status: window.__aranjeDebug?.status() ?? null,
        bar: window.__aranjeDebug?.position?.().barKey ?? null,
        viewed: document.querySelector("[data-tab-content]")?.getAttribute("data-viewed-section"),
        playhead: (() => {
          const node = document.querySelector("[data-tab-content] .z-20");
          return node ? getComputedStyle(node).opacity : null;
        })(),
      }));
      record(
        `[${label}] 10 çalarken bölüm değişimi gizli seek yapmıyor`,
        stepped.status === "playing" &&
          (stepped.bar ?? "").startsWith("intro:") &&
          stepped.viewed === "main" &&
          stepped.playhead === "0",
        `transport ${stepped.bar}, viewed ${stepped.viewed}, playhead ${stepped.playhead}`,
      );
      measurements[`${label}.playbackStep`] = { playing, stepped };
    } finally {
      await context.close();
    }
  });

  /* ---- 12-15: the rhythm language */
  await safe(`[${label}] rhythm text`, async () => {
    const { context, page } = await openApp(browser, size, rhythmSong());
    try {
      await showTab(page);
      const cells = await page.evaluate(
        () =>
          [
            ...new Set(
              [...document.querySelectorAll('[data-bar-key="grids:0"] [data-cell]')].map((node) =>
                node.getAttribute("data-cell").split(":")[0],
              ),
            ),
          ].length,
      );
      await enterEditMode(page);
      const drawn = await page.evaluate(
        () =>
          [
            ...new Set(
              [...document.querySelectorAll('[data-bar-key="grids:0"] [data-cell]')].map((node) =>
                node.getAttribute("data-cell").split(":")[0],
              ),
            ),
          ].length,
      );
      record(
        `[${label}] 12 4/4 · 1/4 barı 4 hücre çiziyor`,
        drawn === 4,
        `${drawn} hücre (edit dışı ${cells})`,
      );

      // 13-15: the readings, from the section form
      await page.locator('[data-section-nav] button[aria-label^="Bölüm:"]').click();
      await page.waitForTimeout(300);
      await page.locator("[data-section-manage]").click();
      await page.waitForTimeout(400);
      await page.locator('[data-section-action="timing"]').click();
      await page.waitForTimeout(400);
      await page.locator('[data-testid="timing-grid"]').selectOption("16");
      await page.waitForTimeout(250);
      const sixteen = await page.locator('[data-testid="timing-draft-plain"]').innerText();
      record(
        `[${label}] 13 4/4 · 1/16 açıklaması`,
        sixteen.trim() === "4 ana vuruş · 16 adım",
        sixteen.trim(),
      );

      await page.locator('[data-testid="timing-meter"]').selectOption("6/8");
      await page.waitForTimeout(250);
      const compound = await page.locator('[data-testid="timing-draft-plain"]').innerText();
      record(
        `[${label}] 14 6/8 felt-beat kaynağıyla doğru`,
        /^2 ana vuruş · \d+ adım$/.test(compound.trim()),
        compound.trim(),
      );

      await page.locator('[data-testid="timing-meter"]').selectOption("7/8");
      await page.waitForTimeout(250);
      const odd = await page.locator('[data-testid="timing-draft-plain"]').innerText();
      record(
        `[${label}] 15 7/8 uydurma grouping göstermiyor`,
        /sekizlik/.test(odd) && !/ana vuruş/.test(odd) && !odd.includes("+"),
        odd.trim(),
      );
      await page.locator('[data-testid="timing-cancel"]').click();
      await page.waitForTimeout(250);
    } finally {
      await context.close();
    }
  });

  /* ---- 16-22 + the timing measurements */
  await safe(`[${label}] timing change`, async () => {
    const { context, page, cdp } = await openApp(browser, size, timingSong(), {
      debug: true,
    });
    try {
      const openBarTiming = async (barKey) => {
        await page.locator('[data-testid="view-arrange"]').click();
        await page.waitForSelector("[data-arrangement-scroller]");
        await page.waitForTimeout(250);
        const cell = page.locator(`[data-arr-bar="${barKey}"]`).first();
        await cell.scrollIntoViewIfNeeded();
        const box = await cell.boundingBox();
        await touch(page, cdp, box.x + box.width / 2, box.y + box.height / 2, 700);
        /*
         * The action bar's fourth column wraps to a second row at 320px, so
         * the control has to be brought into view before it can be pressed.
         * Without this the narrow run stalls on a button that is laid out,
         * findable and off the bottom of the screen.
         */
        const more = page.locator('[data-bar-action="more"]');
        await more.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await more.click();
        await page.waitForTimeout(300);
        const entry = page.locator('[data-testid="bar-more-timing"]');
        await entry.scrollIntoViewIfNeeded();
        await entry.click();
        await page.waitForTimeout(350);
      };

      // 16. one bar 1/16 → 1/8 with content that survives it
      await openBarTiming("s1:0");
      const openWrites = await writes(page);
      await page.locator('[data-testid="timing-grid"]').selectOption("8");
      await page.waitForTimeout(250);
      record(
        `[${label}] 16.a önizleme 0 yazım yapıyor`,
        (await writes(page)) === openWrites,
        `${(await writes(page)) - openWrites}`,
      );
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(700);
      const applied = await stored(page);
      record(
        `[${label}] 16 tek bar 1/16 → 1/8 tam temsil edilebilen içerikle geçiyor`,
        applied?.sections?.[0]?.bars?.[0]?.resolution === 8 &&
          (await writes(page)) - openWrites === 1,
        `resolution ${applied?.sections?.[0]?.bars?.[0]?.resolution}, ${
          (await writes(page)) - openWrites
        } yazım`,
      );

      // undo / redo, one write each
      const beforeUndo = await writes(page);
      await page.getByRole("button", { name: /Geri al/ }).first().click();
      await page.waitForTimeout(600);
      const undoWrites = (await writes(page)) - beforeUndo;
      const undone = await stored(page);
      await page.getByRole("button", { name: /İleri al|Yinele/ }).first().click();
      await page.waitForTimeout(600);
      const redoWrites = (await writes(page)) - beforeUndo - undoWrites;
      const redone = await stored(page);
      record(
        `[${label}] 16.b undo 1 yazım, redo 1 yazım, ikisi de byte-eş`,
        undoWrites === 1 &&
          redoWrites === 1 &&
          undone?.sections?.[0]?.bars?.[0]?.resolution === 16 &&
          JSON.stringify(redone) === JSON.stringify(applied),
        `undo ${undoWrites} / redo ${redoWrites}`,
      );

      /*
       * 17. A transformation that cannot be represented.
       *
       * On bar 1, whose eighths fall between triplet slots. Bar 0's quarters
       * would convert to a triplet grid perfectly well — the first run of this
       * suite used it and measured a success it had labelled a refusal.
       */
      await openBarTiming("s1:1");
      const beforeRefusal = await writes(page);
      await page.locator('[data-testid="timing-grid"]').selectOption("12");
      await page.waitForTimeout(250);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(600);
      const refusal = await page.locator('[data-testid="timing-error"]').innerText();
      record(
        `[${label}] 17 temsil edilemeyen dönüşüm reddediliyor`,
        (await writes(page)) === beforeRefusal && refusal.length > 10,
        `${refusal.slice(0, 60)} · ${(await writes(page)) - beforeRefusal} yazım`,
      );
      record(
        `[${label}] 17.b reddedilen işlemde sheet açık kalıyor, yarım state yok`,
        (await page.locator('[data-testid="timing-apply"]').isVisible()) &&
          !/[_{}]|Error|Zod/.test(refusal),
        refusal.slice(0, 60),
      );
      await page.locator('[data-testid="timing-cancel"]').click();
      await page.waitForTimeout(250);

      // 18. 4/4 → 3/4 with content that fits
      await openBarTiming("s1:0");
      await page.locator('[data-testid="timing-meter"]').selectOption("3/4");
      await page.waitForTimeout(250);
      const before34 = await writes(page);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(700);
      const shortened = await stored(page);
      const err34 = await page
        .locator('[data-testid="timing-error"]')
        .innerText()
        .catch(() => null);
      record(
        `[${label}] 18 4/4 → 3/4 sığan içerikle geçiyor`,
        err34 === null &&
          shortened?.sections?.[0]?.bars?.[0]?.timeSignature?.[0] === 3 &&
          (await writes(page)) - before34 === 1,
        `${JSON.stringify(shortened?.sections?.[0]?.bars?.[0]?.timeSignature)} · ${err34 ?? "hata yok"}`,
      );
      measurements[`${label}.shortenedBar`] = shortened?.sections?.[0]?.bars?.[0] ?? null;

      // 19. content that does not fit is refused atomically
      await openBarTiming("s1:1");
      await page.waitForTimeout(100);
      const beforeOverflow = await writes(page);
      const barOneBefore = JSON.stringify((await stored(page))?.sections?.[0]?.bars?.[1]);
      await page.locator('[data-testid="timing-meter"]').selectOption("3/4");
      await page.waitForTimeout(250);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(600);
      const overflowError = await page.locator('[data-testid="timing-error"]').innerText();
      record(
        `[${label}] 19 sığmayan içerik atomik reddediliyor`,
        (await writes(page)) === beforeOverflow &&
          JSON.stringify((await stored(page))?.sections?.[0]?.bars?.[1]) === barOneBefore,
        overflowError.slice(0, 60),
      );
      await page.locator('[data-testid="timing-cancel"]').click();
      await page.waitForTimeout(250);

      // 21-22. a tie across the line, and a legato bond, are protected
      await openBarTiming("s1:2");
      const beforeChain = await writes(page);
      await page.locator('[data-testid="timing-meter"]').selectOption("4/4");
      await page.waitForTimeout(250);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(600);
      const chainError = await page.locator('[data-testid="timing-error"]').innerText();
      record(
        `[${label}] 21 tie sınırı korunuyor veya açıkça reddediliyor`,
        (await writes(page)) === beforeChain && chainError.length > 10,
        chainError.slice(0, 70),
      );
      await page.locator('[data-testid="timing-cancel"]').click();
      await page.waitForTimeout(250);

      /*
       * 20. The whole section, in one commit.
       *
       * Section "Dönüşen" rather than "Ölçüler": the first one holds the bars
       * that exist to be refused, and running the section case there would
       * measure a refusal while claiming to measure a conversion.
       */
      await closeSheets(page);
      await page.locator('[data-testid="view-tab"]').click();
      await page.waitForSelector("[data-tab-content]");
      await page.locator('[data-section-nav] button[aria-label^="Bölüm:"]').click();
      await page.waitForTimeout(300);
      await page.locator('[data-section-option="s2"]').click();
      await page.waitForTimeout(500);
      await page.locator('[data-section-nav] button[aria-label^="Bölüm:"]').click();
      await page.waitForTimeout(300);
      await page.locator("[data-section-manage]").click();
      await page.waitForTimeout(400);
      await page.locator('[data-section-action="timing"]').click();
      await page.waitForTimeout(400);
      const beforeSection = await writes(page);
      await page.locator('[data-testid="timing-meter"]').selectOption("4/4");
      await page.waitForTimeout(200);
      await page.locator('[data-testid="timing-grid"]').selectOption("16");
      await page.waitForTimeout(250);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(900);
      const sectionApplied = await stored(page);
      const sectionError = await page
        .locator('[data-testid="timing-error"]')
        .innerText()
        .catch(() => null);
      const converted = sectionApplied?.sections?.find((entry) => entry.id === "s2");
      const grids = (converted?.bars ?? []).map((bar) => bar.resolution);
      record(
        `[${label}] 20 bölümün bütün ölçülerine timing değişimi tek commit`,
        sectionError === null
          ? grids.every((grid) => grid === 16) && (await writes(page)) - beforeSection === 1
          : (await writes(page)) === beforeSection,
        sectionError ? `reddedildi: ${sectionError.slice(0, 50)}` : `gridler ${grids.join(",")}`,
      );
      measurements[`${label}.sectionTiming`] = {
        error: sectionError,
        grids,
        writes: (await writes(page)) - beforeSection,
      };
      /*
       * A section-scope refusal keeps the sheet open with a readable sentence
       * and nothing half-done: the reader can change their pick and try again
       * without having to find the door a second time.
       */
      /* The section manager is still open behind the applied sheet. */
      await closeSheets(page);
      await press(page, '[data-section-nav] button[aria-label^="Bölüm:"]', { settle: 250 });
      await press(page, '[data-section-option="s1"]', { settle: 400 });
      await press(page, '[data-section-nav] button[aria-label^="Bölüm:"]', { settle: 250 });
      await press(page, "[data-section-manage]", { settle: 350 });
      await press(page, '[data-section-action="timing"]', { settle: 350 });
      const beforeSectionFail = await writes(page);
      await page.locator('[data-testid="timing-grid"]').selectOption("12");
      await page.waitForTimeout(200);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(700);
      const sectionRefusal = await page
        .locator('[data-testid="timing-error"]')
        .innerText()
        .catch(() => null);
      record(
        `[${label}] 20.c bölüm dönüşümü başarısızsa sheet açık kalıyor, yarım state yok`,
        sectionRefusal !== null &&
          (await writes(page)) === beforeSectionFail &&
          (await page.locator('[data-testid="timing-apply"]').isVisible()) &&
          (await page.locator('[data-testid="timing-current-plain"]').isVisible()) &&
          !/[_{}]|Error|Zod|undefined/.test(sectionRefusal),
        `${(sectionRefusal ?? "hata yok").slice(0, 55)} · ${
          (await writes(page)) - beforeSectionFail
        } yazım`,
      );
      await page.locator('[data-testid="timing-cancel"]').click();
      await page.waitForTimeout(250);

      record(
        `[${label}] 20.b AudioContext 1 → 1, ikinci scheduler yok`,
        (await contexts(page)) <= 1,
        `${await contexts(page)}`,
      );
    } finally {
      await context.close();
    }
  });

  /* ---- the timing change under a loop, and under playback */
  await safe(`[${label}] timing under transport`, async () => {
    const { context, page, cdp } = await openApp(browser, size, timingSong(), {
      debug: true,
    });
    try {
      const readLoop = () =>
        page.evaluate(() => ({
          loop: window.__aranjeDebug?.loop() ?? null,
          total: window.__aranjeDebug?.totalTicks() ?? null,
        }));

      const openBarTiming = async (barKey) => {
        await page.locator('[data-testid="view-arrange"]').click();
        await page.waitForSelector("[data-arrangement-scroller]");
        await page.waitForTimeout(250);
        const cell = page.locator(`[data-arr-bar="${barKey}"]`).first();
        await cell.scrollIntoViewIfNeeded();
        const box = await cell.boundingBox();
        await touch(page, cdp, box.x + box.width / 2, box.y + box.height / 2, 700);
        /*
         * The action bar's fourth column wraps to a second row at 320px, so
         * the control has to be brought into view before it can be pressed.
         * Without this the narrow run stalls on a button that is laid out,
         * findable and off the bottom of the screen.
         */
        const more = page.locator('[data-bar-action="more"]');
        await more.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await more.click();
        await page.waitForTimeout(300);
        const entry = page.locator('[data-testid="bar-more-timing"]');
        await entry.scrollIntoViewIfNeeded();
        await entry.click();
        await page.waitForTimeout(350);
      };

      /*
       * A loop over the section the reader is on, then one of its bars gets
       * shorter. Bar `s1:0` is the conversion scenario 18 already proved
       * lands, so what is being measured here is the loop rather than the
       * command.
       */
      await showTab(page);
      await page.getByRole("button", { name: "Bölüm döngüsü" }).first().click();
      await page.waitForTimeout(400);
      const loopBefore = await readLoop();

      await openBarTiming("s1:0");
      await page.locator('[data-testid="timing-meter"]').selectOption("3/4");
      await page.waitForTimeout(200);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(900);
      const shortenError = await page
        .locator('[data-testid="timing-error"]')
        .innerText()
        .catch(() => null);
      const loopAfter = await readLoop();
      measurements[`${label}.loop`] = { loopBefore, loopAfter, shortenError };
      record(
        `[${label}] L1 döngü sınırı yeni bar uzunluğundan türüyor, eski tick'te kalmıyor`,
        shortenError === null &&
          loopBefore.loop !== null &&
          loopAfter.loop !== null &&
          loopBefore.loop.endTicks - loopAfter.loop.endTicks === 192 &&
          loopBefore.total - loopAfter.total === 192,
        shortenError
          ? `reddedildi: ${shortenError.slice(0, 40)}`
          : `${loopBefore.loop?.startTicks}-${loopBefore.loop?.endTicks} → ` +
            `${loopAfter.loop?.startTicks}-${loopAfter.loop?.endTicks}, toplam ` +
            `${loopBefore.total} → ${loopAfter.total}`,
      );
      if (shortenError !== null) {
        await page.locator('[data-testid="timing-cancel"]').click();
        await page.waitForTimeout(200);
      }

      /* Now while playing. The behaviour is measured and stated, not assumed. */
      await page.locator('[data-testid="view-tab"]').click();
      await page.waitForSelector("[data-tab-content]");
      await page.getByRole("button", { name: "Çal" }).first().click();
      await page.waitForTimeout(2000);
      const playing = await page.evaluate(() => ({
        status: window.__aranjeDebug?.status() ?? null,
        ticks: window.__aranjeDebug?.ticks() ?? null,
      }));
      const contextsBefore = await contexts(page);

      await openBarTiming("s1:1");
      await page.locator('[data-testid="timing-grid"]').selectOption("16");
      await page.waitForTimeout(200);
      await page.locator('[data-testid="timing-apply"]').click();
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => ({
        status: window.__aranjeDebug?.status() ?? null,
        ticks: window.__aranjeDebug?.ticks() ?? null,
        total: window.__aranjeDebug?.totalTicks() ?? null,
        at: window.__aranjeDebug?.position?.() ?? null,
      }));
      measurements[`${label}.timingWhilePlaying`] = { playing, after };
      /*
       * The measured behaviour, stated rather than tolerated.
       *
       * A timing change is a different song, so `usePlayback` builds a fresh
       * controller and carries the position across with `seekToNearestBar`
       * (spec 13.13, K-44). The transport therefore **stops** and the playhead
       * lands on a bar line of the *new* plan — not on the tick it happened to
       * be at, which after a bar changed length is a different musical moment.
       */
      /*
       * Where the bar lines are in the song that is now on disk.
       *
       * A bar lasts `numerator × (768 / denominator)` ticks — the whole-note
       * tick count over the meter's own note value — so the starts are a
       * running sum of that. Derived from the stored song rather than written
       * down, or the check would still pass if the transport landed on a bar
       * line of the song that used to be there.
       */
      const barStarts = (song) => {
        const starts = [];
        let ticks = 0;
        for (const section of song?.sections ?? []) {
          for (const bar of section.bars) {
            starts.push(ticks);
            ticks += bar.timeSignature[0] * (768 / bar.timeSignature[1]);
          }
        }
        return starts;
      };
      const lines = barStarts(await stored(page));
      record(
        `[${label}] L2 çalarken timing değişimi: transport duruyor, playhead yeni plandaki bar başında`,
        playing.status === "playing" &&
          after.status !== "playing" &&
          after.ticks !== null &&
          lines.includes(after.ticks) &&
          after.total !== null &&
          after.ticks <= after.total,
        `${playing.status}@${playing.ticks} → ${after.status}@${after.ticks} ` +
          `(bar çizgileri ${lines.slice(0, 5).join(",")}…, toplam ${after.total})`,
      );
      record(
        `[${label}] L3 AudioContext 1 → 1, ikinci scheduler kurulmuyor`,
        (await contexts(page)) === contextsBefore && contextsBefore <= 1,
        `${contextsBefore} → ${await contexts(page)}`,
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 23-28: the rhythm guide */
  await safe(`[${label}] rhythm guide`, async () => {
    const { context, page, cdp } = await openApp(browser, size, rhythmSong());
    try {
      await showTab(page);
      const drawn = await beams(page);
      measurements[`${label}.beams`] = drawn;
      const inBar = (key) => drawn.filter((group) => group.bar === key);

      record(
        `[${label}] 23 beam'de chord tek onset`,
        inBar("grids:1").length > 0 &&
          inBar("grids:1").every((group) => /\d+ nota/.test(group.label ?? "")),
        inBar("grids:1")
          .map((group) => group.label)
          .join(" | "),
      );
      record(
        `[${label}] 24 rest beam'i kesiyor`,
        inBar("grids:1").length === 2,
        inBar("grids:1")
          .map((group) => group.label)
          .join(" | "),
      );
      record(
        `[${label}] 26 triplet "3" işareti görünüyor`,
        inBar("grids:2").length === 4 &&
          inBar("grids:2").every((group) => group.triplets === 1),
        `${inBar("grids:2").length} grup, ${inBar("grids:2").reduce(
          (sum, group) => sum + group.triplets,
          0,
        )} işaret`,
      );
      record(
        `[${label}] 27 1/32 üç beam seviyesi gösteriyor`,
        inBar("grids:3").length === 1 && inBar("grids:3")[0]?.lines === 3,
        `${inBar("grids:3")[0]?.lines} çizgi`,
      );
      record(
        `[${label}] 27.b 1/4 barı hiç beam almıyor`,
        inBar("grids:0").length === 0,
        `${inBar("grids:0").length} grup`,
      );

      // 28. overlaps, each measured on its own
      await enterEditMode(page);
      await pressCell(page, cdp, "grids:1", "0:0");
      const clash = await overlaps(page);
      measurements[`${label}.overlaps`] = clash;
      record(
        `[${label}] 28 beam ↔ fret/articulation/selection/playhead çakışması 0`,
        clash.fret === 0 &&
          clash.articulation === 0 &&
          clash.selection === 0 &&
          clash.playhead === 0,
        JSON.stringify(clash),
      );

      // beams take no touch target and no listener
      const inert = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[aria-label^="Ritim grubu"]')];
        return {
          count: nodes.length,
          buttons: nodes.filter((node) => node.closest("button") !== null).length,
          pointerEvents: nodes.filter(
            (node) => getComputedStyle(node).pointerEvents !== "none",
          ).length,
          handlers: nodes.filter((node) =>
            Object.keys(node).some((key) => key.startsWith("__reactProps"))
              ? Object.entries(node[Object.keys(node).find((key) => key.startsWith("__reactProps"))] ?? {}).some(
                  ([key, value]) => key.startsWith("on") && typeof value === "function",
                )
              : false,
          ).length,
        };
      });
      record(
        `[${label}] 28.b beam işaretleri dokunma hedefi/listener oluşturmuyor`,
        inert.count > 0 && inert.pointerEvents === 0 && inert.handlers === 0,
        JSON.stringify(inert),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 25: a tie makes no second onset */
  await safe(`[${label}] tie and beams`, async () => {
    const { context, page } = await openApp(browser, size, tiedSong());
    try {
      await showTab(page);
      const drawn = await beams(page);
      record(
        `[${label}] 25 tie yeni beam onset'i oluşturmuyor`,
        drawn.length === 2 &&
          drawn.every((group) => /2 nota, 1\/8/.test(group.label ?? "")),
        drawn.map((group) => group.label).join(" | "),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- the tail, and the three invariants asked for */
  await safe(`[${label}] tail`, async () => {
    const { context, page, cdp } = await openApp(browser, size, shortTwoSections(), {
      debug: true,
    });
    try {
      await showTab(page);
      const before = await digest(page);
      await page.locator('[data-section-nav] button[aria-label^="Sonraki bölüm"]').click();
      await page.waitForTimeout(800);
      const after = await digest(page);
      record(
        `[${label}] 9.b kısa şarkıda da seçilen bölüm görünür yüzeyin kaynağı`,
        after.first === "main:0" && after.text !== before.text,
        `${before.first} → ${after.first}`,
      );

      const tail = await page.evaluate(() => {
        const node = document.querySelector("[data-tab-tail]");
        const box = node?.getBoundingClientRect();
        return {
          exists: node !== null,
          isBar: node?.hasAttribute("data-bar-key") ?? false,
          hasCells: (node?.querySelectorAll("[data-cell]").length ?? 0) > 0,
          bars: document.querySelectorAll("[data-bar-key]").length,
          box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
        };
      });
      record(
        `[${label}] T1 data-tab-tail müzikal bar veya seçim hedefi değil`,
        tail.exists && !tail.isBar && !tail.hasCells && tail.bars === 2,
        JSON.stringify(tail),
      );

      // Touching the tail must do nothing at all.
      const stateBefore = await page.evaluate(() => ({
        writes: window.__writes,
        bar: window.__aranjeDebug?.position?.().barKey ?? null,
      }));
      if (tail.box && tail.box.w > 10) {
        await touch(page, cdp, tail.box.x + tail.box.w / 2, tail.box.y + tail.box.h / 2, 700);
      }
      const afterTouch = await page.evaluate(() => ({
        writes: window.__writes,
        bar: window.__aranjeDebug?.position?.().barKey ?? null,
        band: document.querySelector('[data-testid="time-selection-band"]') !== null,
      }));
      record(
        `[${label}] T2 boş alana dokunmak 0 seek, 0 seçim, 0 yazım`,
        afterTouch.writes === stateBefore.writes &&
          afterTouch.bar === stateBefore.bar &&
          afterTouch.band === false,
        JSON.stringify(afterTouch),
      );

      /*
       * T3. The tail is not music, so it must be absent from every count the
       * product makes of the music: the song, the arrangement's own bar cells,
       * and anything that leaves the app.
       */
      const song = await stored(page);
      const bars = song?.sections?.reduce((sum, entry) => sum + entry.bars.length, 0);
      await page.locator('[data-testid="view-arrange"]').click();
      await page.waitForSelector("[data-arrangement-scroller]");
      await page.waitForTimeout(300);
      const arrangementBars = await page.evaluate(
        () => document.querySelectorAll("[data-arr-bar]").length,
      );
      /* The project file is what leaves the app; it is the export's own text. */
      const exported = await page.evaluate(() => JSON.stringify(
        JSON.parse(localStorage.getItem("aranje.song") ?? "null"),
      ));
      record(
        `[${label}] T3 tail şarkıya, arrangement bar sayısına veya export'a girmiyor`,
        bars === 2 &&
          arrangementBars === 2 &&
          !exported.includes("tail") &&
          !exported.includes("spacer"),
        `${bars} bar, arrangement ${arrangementBars} hücre`,
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 29-33: the standing layout claims */
  await safe(`[${label}] layout`, async () => {
    const { context, page, external } = await openApp(browser, size, rhythmSong());
    try {
      await showTab(page);
      await enterEditMode(page);
      const layout = await layoutProbe(page);
      record(`[${label}] 29 body yatay taşma 0`, layout.bodyOverflow <= 0, `${layout.bodyOverflow}`);
      record(`[${label}] 30 kasıtlı yatay scroller 1`, layout.scrollers === 1, `${layout.scrollers}`);

      const edges = await targetEdges(page, [
        '[data-section-nav] button[aria-label^="Bölüm:"]',
        '[data-section-nav] button[aria-label^="Sonraki bölüm"]',
        '[data-testid="view-tab"]',
        '[data-testid="view-arrange"]',
      ]);
      record(
        `[${label}] 31 44 px altı etkileşim hedefi 0`,
        edges.every((edge) => edge >= 44),
        edges.join(","),
      );

      const errors = await consoleErrors(page);
      record(`[${label}] 32 console/page error 0`, errors.length === 0, errors.slice(0, 2).join(" | "));
      record(
        `[${label}] 33 dış ağ isteği 0`,
        external.length === 0,
        external.slice(0, 2).join(" | "),
      );
      measurements[`${label}.layout`] = layout;
    } finally {
      await context.close();
    }
  });

  await browser.close();
}

const VIEWPORTS = [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
];

/* ONE_VIEWPORT=1 runs the first, =2 the second; unset runs both. */
const CHOSEN = process.env.ONE_VIEWPORT
  ? [VIEWPORTS[Number(process.env.ONE_VIEWPORT) - 1] ?? VIEWPORTS[0]]
  : VIEWPORTS;

for (const [label, size] of CHOSEN) {
  await run(label, size);
}

flush();
const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length === 0 ? 0 : 1);
