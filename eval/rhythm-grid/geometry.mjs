/**
 * The rhythm surface at six viewports, in the states it actually has
 * (2V-D.2 c3 §16).
 *
 * ## Why an unreached state is recorded, not measured
 *
 * A runner that clicks its way toward "Pro 7/8" and misses will happily
 * measure whatever is on screen and report it clean — which is the worst
 * possible outcome, because a green table then means nothing. So every state
 * declares a **witness**: a selector that only exists once the state is
 * really open. If the witness is absent the row is written as
 * `reached: false` and carries no measurements at all.
 *
 * The SHA is read off the running app, not passed in and trusted: a stale
 * build cannot pass by being pointed at with the right argument.
 *
 * Usage:  SHA=<sha> BASE=http://127.0.0.1:3115 node eval/rhythm-grid/geometry.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "384x692", width: 384, height: 692 },
  { name: "412x915", width: 412, height: 915 },
  { name: "740x360", width: 740, height: 360 },
  { name: "844x390", width: 844, height: 390 },
  { name: "1280x800", width: 1280, height: 800 },
];

/** Words a beginner must never meet on the rhythm surface (§16, §21). */
const JARGON = [
  /\bslot\b/i,
  /\btick\b/i,
  /çözünürlük/i,
  /\bresolution\b/i,
  /\bPPQ\b/i,
  /\blattice\b/i,
  /\bnumerator\b/i,
  /\bdenominator\b/i,
];

const measure = (page) =>
  page.evaluate(
    (jargonSources) => {
      const jargon = jargonSources.map((s) => new RegExp(s.source, s.flags));
      const box = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return {
          top: Math.round(r.top),
          height: Math.round(r.height),
          width: Math.round(r.width),
        };
      };

      const out = {};
      out.grid = box("[data-tab-content]");
      out.shelf = box(".workspace-shelf");
      out.overflowX = document.documentElement.scrollWidth > window.innerWidth;

      /* Who owns the pixel at the middle of the grid's visible box? */
      const grid = document.querySelector("[data-tab-content]");
      if (grid) {
        const r = grid.getBoundingClientRect();
        const column = (grid.closest("main") ?? grid).getBoundingClientRect();
        const top = Math.max(r.top, column.top, 0);
        const bottom = Math.min(r.bottom, column.bottom, window.innerHeight);
        const left = Math.max(r.left, column.left, 0);
        const right = Math.min(r.right, column.right, window.innerWidth);
        const x = Math.round(
          Math.min(Math.max((left + right) / 2, 1), window.innerWidth - 1),
        );
        const y = Math.round((top + bottom) / 2);
        out.gridVisible = Math.round(Math.max(0, bottom - top));
        const hit = document.elementFromPoint(x, y);
        out.gridHit =
          hit === null ? "none" : hit.closest("[data-tab-content]") ? "grid" : "COVERED";
      } else {
        out.gridHit = "none";
        out.gridVisible = 0;
      }

      /* Anything positioned over the whole screen is an overlay by
         construction, whatever it calls itself. */
      out.overlays = [...document.querySelectorAll("body *")].filter((node) => {
        const style = getComputedStyle(node);
        if (style.position !== "fixed" || style.display === "none") return false;
        const r = node.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.5;
      }).length;

      /*
       * Touch targets, and the two things that are not controls.
       *
       * The phrase band is the documented exception. The staff cells are the
       * second, and for the same reason rather than a new one: a position on
       * the grid is *the music*, addressed by where it is, and 44px each
       * would make one bar 700px wide. They are counted and reported
       * separately rather than dropped, so the number stays visible.
       */
      const inGrid = (node) => node.closest("[data-tab-content]") !== null;
      const undersized = [...document.querySelectorAll("button, [role=button]")].filter(
        (node) => {
          if (node.closest("[data-phrase-band]")) return false;
          const r = node.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return r.height < 44 || r.width < 44;
        },
      );
      const small = undersized.filter((node) => !inGrid(node));
      out.smallTargets = small.length;
      out.smallTargetNames = small.slice(0, 4).map((n) => n.textContent?.trim() ?? "");
      out.gridCells = undersized.length - small.length;

      /* Clipped text: a box whose content is wider than it and not scrollable. */
      out.clipped = [...document.querySelectorAll(".workspace-shelf button, .workspace-shelf p")]
        .filter((node) => {
          const style = getComputedStyle(node);
          if (style.overflowX === "auto" || style.overflowX === "scroll") return false;
          return node.scrollWidth > node.clientWidth + 1;
        }).length;

      /* Duplicate accessible names inside the shelf. */
      const names = [...document.querySelectorAll(".workspace-shelf button")]
        .map((n) => (n.getAttribute("aria-label") ?? n.textContent ?? "").trim())
        .filter(Boolean);
      out.duplicateNames = names.length - new Set(names).size;

      /* Raw jargon anywhere the reader can see it. */
      const text = document.querySelector(".workspace-shelf")?.textContent ?? "";
      out.jargon = jargon.filter((re) => re.test(text)).map((re) => re.source);

      return out;
    },
    JARGON.map((re) => ({ source: re.source, flags: re.flags })),
  );

/**
 * Reach the surface the rhythm states live on.
 *
 * The app opens on **Düzen**, which is the arrangement and has no tab grid in
 * it at all. Every state below is about the staff, so getting there is two
 * gestures — the view switch, then the edit toggle — and both are the
 * production ones a reader uses.
 */
const enterTab = async (page) => {
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

/**
 * The panel's own marker, in both spellings the app uses.
 *
 * The dock addresses panels by id (`fast_sequence`) while one of them writes
 * itself out hyphenated; a runner that knew only one would call an open panel
 * "not reached", which is exactly the lie the witnesses exist to prevent.
 */
const panelMarker = (id) =>
  `[data-panel='${id}'], [data-panel='${id.replace(/_/g, "-")}']`;

/** Tap a cell, which is what gives the note-shaped panels something to be about. */
const tapCell = async (page) => {
  await page
    .locator("[data-cell='0:0']")
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(300);
};

/** Open the rhythm group and the named panel; return true if it really opened. */
const openPanel = async (page, id) => {
  await page
    .locator("[data-dock-group='ritim']")
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(250);
  await page
    .locator(`[data-dock-panel='${id}']`)
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(350);
  return (await page.locator(panelMarker(id)).count()) > 0;
};

/**
 * The ten states, each with the witness that proves it is really open.
 *
 * `enter` returns true when it believes it arrived; the witness is checked
 * independently afterwards, so a hopeful `enter` cannot make a row green.
 */
const STATES = [
  {
    name: "1-resting",
    enter: async () => true,
    witness: "[data-tab-content]",
  },
  {
    name: "2-simple-4-4",
    enter: async (page) => openPanel(page, "meter"),
    witness: "[data-shelf-row='meter-intent']",
  },
  {
    name: "3-simple-6-8",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await page.locator("[data-shelf-choice='meter-compound_six']").first()
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    },
    witness: "[data-shelf-note='meter-preview']",
  },
  {
    name: "4-mixed-upgrade-preview",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await page.locator("[data-shelf-choice='meter-mixed_four']").first()
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(350);
      return true;
    },
    witness: "[data-shelf-note='meter-preview']",
  },
  {
    name: "5-fast-sequence-preview",
    enter: async (page) => {
      await tapCell(page);
      return openPanel(page, "fast_sequence");
    },
    witness: "[data-panel='fast-sequence']",
  },
  {
    name: "6-pro-7-8",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await page.locator("[data-shelf-secondary='meter-more']").first()
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(250);
      await page.locator("[data-shelf-choice='meter-pro-7-8']").first()
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    },
    witness: "[data-shelf-row='meter-pro']",
  },
  {
    name: "7-pro-feel-row",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await page.locator("[data-shelf-secondary='meter-more']").first()
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    },
    witness: "[data-shelf-row='meter-feel']",
  },
  {
    name: "8-meter-refusal",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await page.locator("[data-shelf-choice='meter-waltz_three']").first()
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(350);
      return true;
    },
    witness: "[data-shelf-note='meter-preview']",
  },
  {
    name: "9-duration-panel",
    enter: async (page) => {
      await tapCell(page);
      return openPanel(page, "duration");
    },
    witness: "[data-panel='duration']",
  },
  {
    name: "10-zoom-and-panel",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await page.locator("[data-view-zoom] button").first()
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    },
    witness: "[data-shelf-row='meter-intent']",
  },
];

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

  for (const viewport of VIEWPORTS) {
    results[viewport.name] = {};
    for (const state of STATES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: true,
        isMobile: viewport.width < 900,
        deviceScaleFactor: 2,
        userAgent: ANDROID,
      });
      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors += 1;
      });
      page.setDefaultTimeout(15000);
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);

      /* The build's own SHA, read from the page rather than trusted. */
      if (servedSha === null) {
        servedSha = await page.evaluate(
          () =>
            document.querySelector("[data-build-sha]")?.getAttribute("data-build-sha") ??
            "unknown",
        );
      }

      await enterTab(page);

      await state.enter(page).catch(() => false);
      const reached = (await page.locator(state.witness).count()) > 0;
      results[viewport.name][state.name] = reached
        ? { reached: true, ...(await measure(page)) }
        : { reached: false };

      await page.screenshot({
        path: `${OUT}rhythm-${viewport.name}-${state.name}.png`,
      });
      await context.close();
    }
    const row = results[viewport.name];
    const reachedCount = Object.values(row).filter((r) => r.reached).length;
    const bad = Object.entries(row).filter(
      ([, r]) =>
        r.reached &&
        (r.gridHit !== "grid" ||
          r.overflowX ||
          r.overlays > 0 ||
          r.smallTargets > 0 ||
          r.clipped > 0 ||
          r.duplicateNames > 0 ||
          r.jargon.length > 0),
    );
    console.log(
      `${viewport.name}: ${reachedCount}/${STATES.length} states reached, ${bad.length} with findings` +
        (bad.length ? ` -> ${bad.map(([n]) => n).join(", ")}` : ""),
    );
  }

  await browser.close();
  writeFileSync(
    `${OUT}GEOMETRY.json`,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        expectedSha: expected,
        servedSha,
        shaMatches: servedSha === expected,
        consoleErrors,
        results,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nservedSha=${servedSha} expected=${expected} consoleErrors=${consoleErrors}`);
  console.log(`written to ${OUT}GEOMETRY.json`);
};

await main();
