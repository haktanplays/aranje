/**
 * The five facts 2S-A §2 asks to reproduce, on a production build.
 *
 * Nothing here changes product code. Everything is measured through the app
 * as a reader would meet it: the fixtures are seeded into localStorage in the
 * project shapes the product itself writes, the audio is counted by wrapping
 * `AudioBufferSourceNode.prototype.start` before the first line of the app
 * runs, and the geometry is read back off real elements.
 *
 *   npx tsx eval/intent-composer/make-fixtures.ts
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/baseline.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { device, fixture, VIEWPORTS, TEXT_SCALES } from "./device.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";
/** `FILE=AFTER-UI.json` writes an after-the-fix run beside the baseline. */
const FILE = process.env.FILE ?? "BASELINE.json";
mkdirSync(`${OUT}/shots`, { recursive: true });

/**
 * Counts every buffer that actually starts, from outside the app.
 *
 * A sampler note, an expressive voice and a legato chain are all
 * `AudioBufferSourceNode`s in the end, so one wrapper counts all three without
 * the product knowing it is being watched. The metronome is a `NoiseSynth`
 * and never appears here.
 */
const AUDIO_COUNTER = `
window.__aranjeAudio = { starts: [] };
(() => {
  const proto = AudioBufferSourceNode.prototype;
  const original = proto.start;
  proto.start = function (...args) {
    window.__aranjeAudio.starts.push({
      when: typeof args[0] === "number" ? args[0] : null,
      offset: typeof args[1] === "number" ? args[1] : null,
      duration: typeof args[2] === "number" ? args[2] : null,
    });
    return original.apply(this, args);
  };
})();
`;

async function boot(browser, song, viewport = VIEWPORTS[0], textScale = 100) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries, counter]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(counter);
    },
    [Object.entries(device(song)), AUDIO_COUNTER],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  // The tab is where every one of these five facts lives; the app opens on
  // the arrangement, so the harness goes there first rather than measuring
  // the surface that happens to be up.
  await page.getByTestId("view-tab").click();
  await page.waitForTimeout(350);
  if (textScale !== 100) {
    await page.addStyleTag({
      content: `html { font-size: ${Math.round(16 * (textScale / 100))}px }`,
    });
    await page.waitForTimeout(200);
  }
  return { context, page, errors };
}

const findings = {};

/* ------------------------------------------- A · the 1/32 playback report */

async function playbackFact(browser, name, song, seconds) {
  const { context, page, errors } = await boot(browser, song);
  await page.locator("footer button[aria-label='Çal']").click();
  await page.waitForTimeout(seconds * 1000);
  const audio = await page.evaluate(() => window.__aranjeAudio.starts);
  // The project write is durable rather than synchronous; give it its moment
  // before reading the device, or the harness measures its own impatience.
  await page.waitForTimeout(1200);
  const written = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-bar-key]")];
    return nodes.length;
  });
  await context.close();
  return { starts: audio.length, detail: audio, mountedBars: written, errors };
}

/* ------------------------------------------------- B · the fret glyph box */

async function glyphFact(browser, song) {
  const { context, page, errors } = await boot(browser, song);
  const measured = await page.evaluate(() => {
    const glyphs = [...document.querySelectorAll("span")].filter(
      (node) =>
        node.className.includes("tabular-nums") &&
        node.className.includes("font-mono") &&
        /^\d+$/.test(node.textContent ?? ""),
    );
    const strings = [...document.querySelectorAll("div")].filter((node) =>
      node.className.includes("bg-line") && node.className.includes("h-px"),
    );
    const read = (node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        text: node.textContent,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
        left: Math.round(box.left * 100) / 100,
        top: Math.round(box.top * 100) / 100,
        background: style.backgroundColor,
        border: style.borderTopWidth,
        radius: style.borderTopLeftRadius,
        shadow: style.boxShadow,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        fontSize: style.fontSize,
        fontVariantNumeric: style.fontVariantNumeric,
        fontFamily: style.fontFamily.split(",")[0],
      };
    };
    return {
      glyphCount: glyphs.length,
      glyphs: glyphs.slice(0, 10).map(read),
      stringLines: strings.length,
      // The cell a finger has to hit, which is a different box from the digit.
      cells: [...document.querySelectorAll("[data-cell]")].slice(0, 4).map((node) => {
        const box = node.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height) };
      }),
      /* 2S-A §4: the slur arcs, and the names the tab gives its numbers. */
      arcLayers: [...document.querySelectorAll("[data-legato-arcs]")].map((node) => ({
        count: Number(node.getAttribute("data-legato-arcs")),
        label: node.getAttribute("aria-label"),
        pointerEvents: getComputedStyle(node).pointerEvents,
        paths: [...node.querySelectorAll("path")].map((path) => path.getAttribute("d")),
        marks: [...node.querySelectorAll("text")].map((text) => text.textContent),
      })),
      glyphNames: [...document.querySelectorAll("[data-fret-glyph]")]
        .slice(0, 10)
        .map((node) => node.getAttribute("aria-label")),
      glyphStates: [...document.querySelectorAll("[data-fret-glyph]")]
        .slice(0, 10)
        .map((node) => node.getAttribute("data-glyph-state")),
    };
  });
  await page.screenshot({
    path: `${OUT}/shots/${FILE === "BASELINE.json" ? "before" : "after"}-tab-390.png`,
  });

  // The hit target is a different box from the digit, so it is measured in
  // the mode it exists in rather than assumed from the reading surface.
  await page.locator("[data-action-row] button", { hasText: "Düzenle" }).first().click();
  await page.waitForTimeout(300);
  const editMode = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("[data-cell]")];
    const boxes = cells.map((node) => {
      const box = node.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });
    const staff = document.querySelector("[data-bar-key] > div:nth-child(2)");
    return {
      cellCount: cells.length,
      smallestCell: boxes.reduce(
        (small, box) => ({
          width: Math.min(small.width, box.width),
          height: Math.min(small.height, box.height),
        }),
        { width: Infinity, height: Infinity },
      ),
      staffHeight: staff ? Math.round(staff.getBoundingClientRect().height) : null,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });
  await page.screenshot({
    path: `${OUT}/shots/${FILE === "BASELINE.json" ? "before" : "after"}-tab-edit-390.png`,
  });
  await context.close();
  return { ...measured, editMode, errors };
}

/* ------------------------------- C · what writing a power chord costs now */

/** Every control the open sheet offers, and whether it needs a scroll to reach. */
const readSheet = () => {
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return null;
  const panel = dialog.querySelector(".overflow-y-auto") ?? dialog;
  const box = panel.getBoundingClientRect();
  return {
    title: dialog.querySelector("h2")?.textContent ?? null,
    buttons: [...dialog.querySelectorAll("button")]
      .map((node) => ({
        label: (node.textContent ?? "").trim(),
        belowFold: node.getBoundingClientRect().top > box.bottom,
      }))
      .filter((entry) => entry.label),
    scrollHeight: panel.scrollHeight,
    clientHeight: panel.clientHeight,
  };
};

async function powerChordFact(browser, song) {
  const { context, page, errors } = await boot(browser, song);
  const steps = [];
  const tap = async (locator, label) => {
    await locator.click();
    steps.push(label);
    await page.waitForTimeout(300);
  };

  await tap(page.locator("[data-action-row] button", { hasText: "Düzenle" }).first(), "Düzenle");
  await tap(page.locator("[data-cell='0:4']").first(), "hücreye dokun");
  const fretSheet = await page.evaluate(readSheet);
  await tap(page.locator("[data-fret-power]"), "Power chord");
  const builderType = await page.evaluate(readSheet);
  // The builder opens on its type step; power was already chosen, so the next
  // question is the root — and it is asked by *name*, not by string and fret.
  const roots = await page.evaluate(() =>
    [...document.querySelectorAll("[data-chord-roots] button")].map((node) =>
      (node.textContent ?? "").trim(),
    ),
  );
  let rootStep = null;
  if (roots.length > 0) {
    rootStep = roots;
    // Pitch class 9 is A — the root of the fifth-fret shape on this string.
    await tap(page.getByTestId("chord-root-9"), "kök: La (perde adı, tel/perde değil)");
  }
  const powerForms = await page.evaluate(() =>
    [...document.querySelectorAll("[data-chord-power-forms] button")].map((node) =>
      (node.textContent ?? "").trim(),
    ),
  );
  if (powerForms.length > 0) {
    await tap(page.locator("[data-chord-power='two']"), "2 ses");
  }
  const voicings = await page.evaluate(() => ({
    cards: [...document.querySelectorAll("[data-chord-voicing]")].length,
    labels: [...document.querySelectorAll("[data-chord-voicing]")]
      .slice(0, 6)
      .map((node) => (node.textContent ?? "").trim().slice(0, 60)),
  }));
  const final = await page.evaluate(readSheet);
  await context.close();
  return {
    steps,
    tapsBeforeAnyNoteIsWritten: steps.length,
    fretSheetButtons: fretSheet?.buttons.length ?? 0,
    fretSheetBelowFold: fretSheet?.buttons.filter((b) => b.belowFold).map((b) => b.label) ?? [],
    builderTitle: builderType?.title ?? null,
    rootStep,
    powerForms,
    voicings,
    finalButtons: final?.buttons.map((b) => b.label) ?? [],
    note: "The root is chosen by pitch-class name; no step asks which string and fret the finger is on.",
    errors,
  };
}

/* --------------------------------- D · what linking five notes costs now */

async function legatoFact(browser, song) {
  const { context, page, errors } = await boot(browser, song);
  await page.locator("[data-action-row] button", { hasText: "Düzenle" }).first().click();
  await page.waitForTimeout(250);

  const perNote = [];
  // Four links across five notes on one string; each one is its own errand.
  // The run sits on string index 2, which is where its cells are.
  for (const [slot, wanted] of [[1, "Hammer-on"], [2, "Hammer-on"], [3, "Pull-off"], [4, "Pull-off"]]) {
    const taps = [];
    await page.locator(`[data-cell='${slot}:2']`).first().click();
    taps.push("hücreye dokun");
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(readSheet);
    const button = page.locator("[role='dialog'] button", { hasText: wanted }).first();
    const before = await page.evaluate(() => document.querySelector("[role='dialog'] .overflow-y-auto")?.scrollTop ?? 0);
    /*
     * The articulation buttons sit under the sheet's footer at this height, so
     * reaching one is a scroll before it is a tap. The scroll is counted: it
     * is part of what the errand costs.
     */
    const scrolled = await page.evaluate((label) => {
      const panel = document.querySelector("[role='dialog'] .overflow-y-auto");
      const node = [...document.querySelectorAll("[role='dialog'] button")].find(
        (entry) => (entry.textContent ?? "").trim() === label,
      );
      if (!panel || !node) return false;
      const before = panel.scrollTop;
      node.scrollIntoView({ block: "center" });
      return panel.scrollTop !== before;
    }, wanted);
    if (scrolled) taps.push("kaydır");
    await page.waitForTimeout(150);
    await button.click();
    taps.push(wanted);
    await page.waitForTimeout(300);
    const applied = page
      .locator("[role='dialog'] button")
      .filter({ hasText: /^(Ekle|Güncelle)$/ })
      .first();
    const canApply = (await applied.count()) > 0 && (await applied.isEnabled());
    if (canApply) {
      await applied.click();
      taps.push("Güncelle");
      await page.waitForTimeout(350);
    }
    // Whatever happened, the sheet is still up: closing it is part of the cost.
    if (await page.locator("[role='dialog']").count()) {
      await page.keyboard.press("Escape");
      taps.push("Kapat");
      await page.waitForTimeout(350);
    }
    perNote.push({
      slot,
      wanted,
      taps,
      sheetButtons: sheet?.buttons.length ?? 0,
      belowFold: sheet?.buttons.filter((b) => b.belowFold).map((b) => b.label) ?? [],
      sheetScroll: sheet ? { scrollHeight: sheet.scrollHeight, clientHeight: sheet.clientHeight } : null,
      scrollTopBefore: before,
    });
  }
  // The project write is durable rather than synchronous; give it its moment
  // before reading the device, or the harness measures its own impatience.
  await page.waitForTimeout(1200);
  const written = await page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.project.project-1");
    if (!raw) return null;
    const song = JSON.parse(raw).current;
    const track = song.tracks[0].id;
    return song.sections[0].bars[0].slots[track]
      .map((slot, index) =>
        slot && slot !== "-" ? { index, articulation: slot.notes[0].articulation ?? null } : null,
      )
      .filter(Boolean);
  });
  await context.close();
  return {
    perNote,
    totalTaps: perNote.reduce((total, entry) => total + entry.taps.length, 0) + 1,
    written,
    note: "One errand per link: nothing lets the reader say 'join these five'.",
    errors,
  };
}

/* ------------------------------- E · the 320 px edit toolbar, measured */

async function toolbarFact(browser, song) {
  const rows = [];
  for (const viewport of VIEWPORTS) {
    for (const textScale of TEXT_SCALES) {
      for (const editing of [false, true]) {
        const { context, page, errors } = await boot(browser, song, viewport, textScale);
        if (editing) {
          await page
            .locator("[data-action-row] button", { hasText: "Düzenle" })
            .first()
            .click();
          await page.waitForTimeout(250);
        }
        const measured = await page.evaluate(() => {
          const row = document.querySelector("[data-action-row] > div");
          if (!row) return null;
          const box = row.getBoundingClientRect();
          const children = [...row.children].map((node) => {
            const child = node.getBoundingClientRect();
            return {
              label: (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().slice(0, 24),
              width: Math.round(child.width * 10) / 10,
              height: Math.round(child.height * 10) / 10,
              right: Math.round(child.right * 10) / 10,
            };
          });
          return {
            rowWidth: Math.round(box.width * 10) / 10,
            scrollWidth: row.scrollWidth,
            clientWidth: row.clientWidth,
            children,
            bodyScrollWidth: document.body.scrollWidth,
            bodyClientWidth: document.body.clientWidth,
          };
        });
        rows.push({
          viewport: viewport.name,
          textScale,
          editing,
          ...measured,
          clipped: measured ? measured.scrollWidth - measured.clientWidth : null,
          errors,
        });
        if (viewport.width === 320 && textScale === 100 && editing) {
          await page.screenshot({ path: `${OUT}/shots/${FILE === "BASELINE.json" ? "before" : "after"}-toolbar-320.png` });
        }
        await context.close();
      }
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ run */

const ONLY = (process.env.ONLY ?? "").split(",").map((e) => e.trim()).filter(Boolean);
const wanted = (label) => ONLY.length === 0 || ONLY.includes(label);

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const previous = (() => {
  try {
    return JSON.parse(readFileSync(`${OUT}/${FILE}`, "utf8")).findings ?? {};
  } catch {
    return {};
  }
})();

const dense32 = fixture("dense32");
const dense16 = fixture("dense16");

if (wanted("A")) {
console.log("A · playback");
findings.playback = {
  dense32: await playbackFact(browser, "dense32", dense32, 3),
  dense16: await playbackFact(browser, "dense16", dense16, 3),
  expectedBufferStarts: 8,
  note: "dense32 and dense16 carry the same eight onsets; only the grid differs.",
};
console.log(
  `   dense32 buffer starts ${findings.playback.dense32.starts}` +
    ` · dense16 ${findings.playback.dense16.starts}`,
);
} else findings.playback = previous.playback;

if (wanted("B")) {
console.log("B · glyph");
findings.glyph = await glyphFact(browser, dense16);
console.log(
  `   ${findings.glyph.glyphCount} glyphs, first box ` +
    `${findings.glyph.glyphs[0]?.width}×${findings.glyph.glyphs[0]?.height}` +
    ` bg ${findings.glyph.glyphs[0]?.background}`,
);
} else findings.glyph = previous.glyph;

if (wanted("C")) {
console.log("C · power chord");
findings.powerChord = await powerChordFact(browser, fixture("roomy"));
console.log(`   taps before a note exists: ${findings.powerChord.tapsBeforeAnyNoteIsWritten}, voicing cards: ${findings.powerChord.voicings.cards}`);
} else findings.powerChord = previous.powerChord;

if (wanted("D")) {
console.log("D · legato");
findings.legato = await legatoFact(browser, fixture("legatoRun"));
console.log(`   taps to link four pairs: ${findings.legato.totalTaps}`);
} else findings.legato = previous.legato;

if (wanted("E")) {
console.log("E · toolbar");
findings.toolbar = await toolbarFact(browser, dense16);
for (const row of findings.toolbar) {
  if (row.clipped > 0) {
    console.log(
      `   CLIPPED ${row.viewport} ${row.textScale}% editing=${row.editing}: ` +
        `${row.scrollWidth}/${row.clientWidth}`,
    );
  }
}
} else findings.toolbar = previous.toolbar;

await browser.close();

writeFileSync(
  `${OUT}/${FILE}`,
  `${JSON.stringify(
    {
      environment: {
        note: "Production build, desktop Chromium, mobile emulation. No physical device evidence.",
        base: BASE,
      },
      findings,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${OUT}/BASELINE.json`);
