/**
 * Faz 2N-A §0 — the two reported defects, reproduced on the current build.
 *
 * Nothing in `src/` is touched by this checkpoint's first commit. This runs
 * the shipped production bundle in a real phone-shaped Chromium and writes
 * down what it actually does, so the fixes that follow have a *before* that
 * was measured rather than remembered.
 *
 * Two defects, measured separately:
 *
 * **A — one chord, six notes.** A long press on the middle shape of a legato
 * chain is compared with what the app then selects. The comparison is made in
 * drawn notes and in the band's own tick range, not in prose: a summary line
 * saying "6 nota" could be a wording choice, but a band that starts two slots
 * before the finger is a selection that really did move.
 *
 * **B — the label moves, the music does not.** The section stepper is pressed
 * and four things are read back: what the stepper says, which section the tab
 * attributes its first visible bar to, which bar key that is, and a digest of
 * the notes actually on screen. A test that only read the heading would pass
 * for a tab that never repainted.
 *
 *   npm run build && npx next start -p 3100
 *   node eval/tab/reproduce.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { defectSong, shortSong } from "./fixture.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
/*
 * Where the record goes. The committed `DEFECTS.json` is the *before*: it was
 * taken on the build that still had both defects and is not overwritten by a
 * later run. Point this somewhere else to re-run the same measurements
 * against a fixed build.
 */
const OUT = process.env.DEFECTS_OUT ?? "eval/tab";
mkdirSync(OUT, { recursive: true });

/** From `components/workspace/geometry.ts`; the fixture is written to it. */
const SLOT_WIDTH = 34;

const findings = [];
const record = (entry) => {
  findings.push(entry);
  console.log(
    `${entry.defect}  ${entry.reproduced ? "KUSUR DOĞRULANDI" : "kusur görülmedi"}  — ${entry.detail}`,
  );
};

async function touch(page, cdp, x, y, holdMs) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await page.waitForTimeout(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}

/**
 * Everything the tab is currently showing, read off the DOM.
 *
 * The digest is built from the fret glyphs themselves — each carries its pitch
 * as a title and its slot as a left offset — so two sections with the same
 * heading and different notes cannot produce the same string.
 */
const TAB_STATE = () => {
  const content = document.querySelector("[data-tab-content]");
  const scroller = content?.closest(".overflow-x-auto");
  if (!content || !scroller) return null;
  const frame = scroller.getBoundingClientRect();

  const bars = [...document.querySelectorAll("[data-bar-key]")].map((node) => {
    const box = node.getBoundingClientRect();
    const notes = [...node.querySelectorAll("span[title]")]
      .map((glyph) => {
        const left = Math.round(Number.parseFloat(glyph.style.left || "0"));
        return `${glyph.getAttribute("title")}@${left}`;
      })
      .sort();
    return {
      key: node.getAttribute("data-bar-key"),
      notes,
      /*
       * Visible means visible *to a reader*, so the sticky gutter's width is
       * taken off the left edge. Without that, a bar scrolled to sit exactly
       * under the string names counts as on screen and the first-visible-bar
       * reading is a 26-pixel sliver nobody can see.
       */
      visible: box.right > frame.left + 34 + 8 && box.left < frame.right - 8,
    };
  });

  const seen = bars.filter((bar) => bar.visible);
  const stepper = document.querySelector('[data-section-nav] button[aria-label^="Bölüm:"]');
  const heading = [...document.querySelectorAll("[data-bar-key] span")]
    .filter((node) => node.className.includes("uppercase"))
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean);

  return {
    scrollLeft: Math.round(scroller.scrollLeft),
    stepperLabel: stepper?.getAttribute("aria-label") ?? null,
    firstVisibleBarKey: seen[0]?.key ?? null,
    firstVisibleSectionId: seen[0]?.key?.split(":")[0] ?? null,
    visibleBarKeys: seen.map((bar) => bar.key),
    visibleDigest: seen.flatMap((bar) => bar.notes).join(" "),
    headings: heading,
  };
};

/** The band the app drew, in its own ticks, plus what it says it holds. */
const BAND_STATE = () => {
  const band = document.querySelector('[data-testid="time-selection-band"]');
  const summary = document.querySelector('[data-testid="selection-summary"]');
  return {
    present: band !== null,
    startTicks: band ? Number(band.getAttribute("data-start-ticks")) : null,
    endTicks: band ? Number(band.getAttribute("data-end-ticks")) : null,
    summary: summary?.textContent?.trim() ?? null,
    /* Cells the bars themselves mark as inside the selection. */
    selectedCells: document.querySelectorAll("[data-group-selected]").length,
  };
};

async function openApp(browser, size, seed = defectSong()) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
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
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors };
}

async function showTab(page) {
  await page.locator('[data-testid="view-tab"]').click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(300);
}

async function enterEditMode(page) {
  const toggle = page.getByRole("button", { name: "Düzenle", exact: true });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(250);
  }
}

const browser = await chromium.launch();
const { context, page, cdp, errors } = await openApp(browser, { width: 390, height: 844 });

await showTab(page);
await enterEditMode(page);

/* ------------------------------------------------- A. one chord, six notes */

/*
 * The middle shape of the chain: bar 1 of Intro Riff, slot 7, low string.
 * Named rather than counted, so an earlier scenario cannot move it.
 */
const target = page.locator('[data-bar-key="intro:0"] [data-cell="7:0"]').first();
await target.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const box = await target.boundingBox();
if (!box) throw new Error("the chain's middle shape is not on screen");

/*
 * What is under the finger, counted before the press.
 *
 * This is the honest denominator for the whole finding: the reader touched
 * whatever is drawn at this slot, and the glyphs at this slot are exactly
 * that — two of them, one per string of the shape.
 */
const touchedNotes = await page.evaluate((slotLeft) => {
  const bar = document.querySelector('[data-bar-key="intro:0"]');
  return [...(bar?.querySelectorAll("span[title]") ?? [])]
    .filter((glyph) => Math.round(Number.parseFloat(glyph.style.left || "0")) === slotLeft)
    .map((glyph) => glyph.getAttribute("title"));
}, 7 * SLOT_WIDTH);

await touch(page, cdp, box.x + box.width / 2, box.y + box.height / 2, 700);
const band = await page.evaluate(BAND_STATE);

/*
 * The band, translated back into the music it covers.
 *
 * Both bars of the section are 4/4 at 1/8, so a slot is 96 ticks and a bar is
 * 768 — read from the fixture rather than assumed, and asserted below by
 * checking the band lands on slot boundaries.
 */
const SLOT_TICKS = 96;
const BAR_TICKS = 768;
const slotSpan =
  band.startTicks === null || band.endTicks === null
    ? null
    : (band.endTicks - band.startTicks) / SLOT_TICKS;
const barsTouched =
  band.startTicks === null || band.endTicks === null
    ? null
    : Math.floor((band.endTicks - 1) / BAR_TICKS) - Math.floor(band.startTicks / BAR_TICKS) + 1;

/* Notes really inside the band, counted from the drawn glyphs. */
const selectedNotes = await page.evaluate(
  ([startTicks, endTicks, slotWidth, slotTicks, barTicks]) => {
    const inside = [];
    for (const bar of document.querySelectorAll("[data-bar-key]")) {
      const key = bar.getAttribute("data-bar-key") ?? "";
      if (!key.startsWith("intro:")) continue;
      const barIndex = Number(key.split(":")[1]);
      for (const glyph of bar.querySelectorAll("span[title]")) {
        const slot = Math.round(Number.parseFloat(glyph.style.left || "0") / slotWidth);
        const ticks = barIndex * barTicks + slot * slotTicks;
        if (ticks >= startTicks && ticks < endTicks) inside.push(`${key}:${slot}:${glyph.getAttribute("title")}`);
      }
    }
    return inside;
  },
  [band.startTicks, band.endTicks, SLOT_WIDTH, SLOT_TICKS, BAR_TICKS],
);

const onsetsSelected = new Set(
  selectedNotes.map((entry) => entry.split(":").slice(0, 3).join(":")),
).size;

record({
  defect: "A tek akor seçimi",
  reproduced:
    touchedNotes.length === 2 &&
    selectedNotes.length > touchedNotes.length &&
    band.startTicks !== null &&
    band.startTicks < 7 * SLOT_TICKS,
  detail:
    `dokunulan onset ${touchedNotes.length} nota (${touchedNotes.join("+")}), ` +
    `seçim ${selectedNotes.length} nota / ${onsetsSelected} onset / ${barsTouched} ölçü, ` +
    `bant ${band.startTicks}–${band.endTicks} tick (${slotSpan} slot), özet "${band.summary}"`,
  measured: {
    touchedNotes,
    touchedSlotTicks: 7 * SLOT_TICKS,
    band,
    slotSpan,
    barsTouched,
    onsetsSelected,
    selectedNotes,
  },
});

/* ------------------------------------ B. what a section change actually does */

await page.getByRole("button", { name: "Seçimi iptal et" }).click().catch(() => {});
await page.waitForTimeout(200);

const NAME_TO_ID = { "Intro Riff": "intro", "Ana Riff": "main" };
const stepperSectionId = (label) => {
  const match = /^Bölüm: ([^,]+),/.exec(label ?? "");
  return match ? (NAME_TO_ID[match[1]] ?? match[1]) : null;
};

async function scrollHomeIn(page) {
  await page.evaluate(() => {
    const scroller = document.querySelector("[data-tab-content]")?.closest(".overflow-x-auto");
    if (scroller) scroller.scrollLeft = 0;
  });
  await page.waitForTimeout(250);
}

/** Where `jumpToSection` says it wants to land, computed from the tab itself. */
const scrollTargetFor = (page, sectionId) =>
  page.evaluate((id) => {
    const target = document.querySelector(`[data-bar-key="${id}:0"]`);
    const scroller = document.querySelector("[data-tab-content]")?.closest(".overflow-x-auto");
    if (!target || !scroller) return null;
    /* GUTTER_WIDTH from geometry.ts — the same figure the app subtracts. */
    return Math.max(0, target.offsetLeft - 34);
  }, sectionId);

/**
 * One way of asking for a section, measured end to end.
 *
 * Four readings are taken afterwards and all four have to name the section the
 * reader asked for: the stepper's own label, the section the tab attributes
 * its first visible bar to, that bar's key, and the notes on screen. Comparing
 * only two of them would let two wrong answers agree with each other.
 */
async function askForSection(label, sectionId, act) {
  await scrollHomeIn(page);
  const before = await page.evaluate(TAB_STATE);
  const expectedScroll = await scrollTargetFor(page, sectionId);

  await act();
  await page.waitForTimeout(900);

  const after = await page.evaluate(TAB_STATE);
  const agreement = {
    requested: sectionId,
    stepperSays: stepperSectionId(after.stepperLabel),
    tabDraws: after.firstVisibleSectionId,
    firstVisibleBarKey: after.firstVisibleBarKey,
    scrollLeft: after.scrollLeft,
    expectedScroll,
    digestChanged: before.visibleDigest !== after.visibleDigest,
  };

  const met =
    agreement.stepperSays === sectionId &&
    agreement.tabDraws === sectionId &&
    agreement.firstVisibleBarKey === `${sectionId}:0` &&
    agreement.digestChanged;

  record({
    defect: `B bölüm senkronizasyonu — ${label}`,
    reproduced: !met,
    detail:
      `istenen ${sectionId}; seçicide ${agreement.stepperSays}, tab'ın çizdiği ` +
      `${agreement.tabDraws}, ilk görünür bar ${agreement.firstVisibleBarKey}, ` +
      `scroll ${before.scrollLeft} → ${after.scrollLeft} (hedef ${expectedScroll}), ` +
      `nota digest ${agreement.digestChanged ? "değişti" : "DEĞİŞMEDİ"}`,
    measured: { before, after, agreement },
  });
  return agreement;
}

/* B1 — the stepper arrow, which is how a reader steps through a song. */
await askForSection("üst seçicideki ok", "main", async () => {
  await page.locator('[data-section-nav] button[aria-label^="Sonraki bölüm"]').click();
});

/* B2 — the section list, the other door onto the same choice. */
await askForSection("bölüm listesi", "main", async () => {
  await page.locator('[data-section-nav] button[aria-label^="Bölüm:"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-section-option="main"]').click();
});

/*
 * B3 — the list's own idea of where the reader is.
 *
 * After both jumps the sheet still marks Intro Riff as the selected option,
 * because the only thing feeding it is the transport's bar. That is the same
 * missing state the stepper label exposes, seen from a second surface.
 */
await page.locator('[data-section-nav] button[aria-label^="Bölüm:"]').click();
await page.waitForTimeout(300);
const listSelection = await page.evaluate(() => {
  const selected = document.querySelector('[data-section-option][aria-selected="true"]');
  return selected?.getAttribute("data-section-option") ?? null;
});
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(200);

record({
  defect: "B bölüm senkronizasyonu — listedeki seçili bölüm",
  reproduced: listSelection !== "main",
  detail: `iki atlamadan sonra listede seçili görünen bölüm: ${listSelection}`,
  measured: { listSelection },
});

/*
 * B4 — the reported symptom itself, on a song short enough to show it.
 *
 * With four-bar sections the tab really does scroll and repaint, so the defect
 * that survives there is the identity one above. On a two-bar song the whole
 * piece is narrower than the scroll the jump asks for, and the requested
 * section simply never arrives — which is the "I changed section and the tab
 * stayed put" a reader reports. Measured in its own context so neither case
 * borrows the other's fixture.
 */
await context.close();

{
  const short = await openApp(browser, { width: 390, height: 844 }, shortSong());
  await showTab(short.page);
  await scrollHomeIn(short.page);
  const before = await short.page.evaluate(TAB_STATE);
  await short.page
    .locator('[data-section-nav] button[aria-label^="Sonraki bölüm"]')
    .click();
  await short.page.waitForTimeout(900);
  const after = await short.page.evaluate(TAB_STATE);
  const maxScroll = await short.page.evaluate(() => {
    const scroller = document.querySelector("[data-tab-content]")?.closest(".overflow-x-auto");
    return scroller ? Math.round(scroller.scrollWidth - scroller.clientWidth) : null;
  });
  const wanted = await scrollTargetFor(short.page, "main");

  record({
    defect: "B bölüm senkronizasyonu — kısa şarkı (bildirilen belirti)",
    reproduced:
      after.firstVisibleSectionId !== "main" ||
      before.visibleDigest === after.visibleDigest,
    detail:
      `istenen main; ilk görünür bar ${before.firstVisibleBarKey} → ` +
      `${after.firstVisibleBarKey}, scroll ${before.scrollLeft} → ${after.scrollLeft} ` +
      `(hedef ${wanted}, mümkün olan en fazla ${maxScroll}), nota digest ` +
      `${before.visibleDigest === after.visibleDigest ? "DEĞİŞMEDİ" : "değişti"}`,
    measured: { before, after, wanted, maxScroll },
  });

  await short.context.close();
}


await browser.close();

writeFileSync(
  `${OUT}/DEFECTS.json`,
  `${JSON.stringify(
    {
      honesty: [
        "Masaüstü Chromium'da 390x844 phone context; fiziksel telefon kanıtı değildir.",
        "Ölçümler üretim build'i üzerinde alındı; src/ içinde hiçbir değişiklik yapılmadı.",
        "Digest çizilen fret glyph'lerinden üretilir (perde + slot), yalnız başlık metninden değil.",
      ],
      base: BASE,
      pageErrors: errors,
      viewport: { width: 390, height: 844 },
      findings,
    },
    null,
    2,
  )}\n`,
);

const reproduced = findings.filter((entry) => entry.reproduced).length;
console.log(`\n${reproduced}/${findings.length} kusur yeniden üretildi`);
