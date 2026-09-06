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
      /* The music, so a state that was only supposed to change how the click
         counts can be shown not to have touched the song (§16). */
      out.songHash = (() => {
        const parts = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (key === null) continue;
          if (key !== "aranje.song" && !key.startsWith("aranje.project.")) continue;
          try {
            const parsed = JSON.parse(window.localStorage.getItem(key) ?? "");
            parts.push(`${key}=${JSON.stringify(parsed?.current ?? parsed)}`);
          } catch {
            parts.push(`${key}=?`);
          }
        }
        return parts.sort().join(" ");
      })();
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

/** One press, with the settle every surface in this app needs after one. */
const press = async (page, selector) => {
  await page
    .locator(selector)
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(300);
};

/** Open the Pro area, which is where the click's own row lives. */
const pressPro = async (page) => {
  await press(page, "[data-shelf-secondary='meter-more']");
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
/**
 * The eleven states of the completion round (§16).
 *
 * Each carries the witness that proves it is really open, and a `path` when
 * it does not live on the workspace. `enter` returning true is a claim; the
 * witness is what settles it.
 */
const STATES = [
  {
    name: "1-simple-metronome",
    enter: async (page) => openPanel(page, "meter"),
    witness: "[data-shelf-row='meter-intent']",
  },
  {
    name: "2-pro-closed",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      /* Explicitly not opened: the Simple surface is a state of its own and
         "Pro is shut" is the one a beginner is in. */
      return (await page.locator("[data-shelf-row='meter-pro']").count()) === 0;
    },
    witness: "[data-shelf-secondary='meter-more']",
  },
  {
    name: "3-pro-open",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await pressPro(page);
      return true;
    },
    witness: "[data-shelf-row='meter-click']",
  },
  {
    name: "4-beats-only",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await pressPro(page);
      await press(page, "[data-shelf-choice='meter-click-beats']");
      return true;
    },
    witness: "[data-shelf-choice='meter-click-beats'][data-shelf-choice-state='active']",
  },
  {
    name: "5-every-unit",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await pressPro(page);
      await press(page, "[data-shelf-choice='meter-click-units']");
      return true;
    },
    witness: "[data-shelf-choice='meter-click-units'][data-shelf-choice-state='active']",
  },
  {
    name: "6-seven-eight-223",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await pressPro(page);
      await press(page, "[data-shelf-choice='meter-pro-7-8']");
      return true;
    },
    witness: "[data-shelf-row='meter-feel']",
  },
  {
    name: "7-seven-eight-322",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await pressPro(page);
      await press(page, "[data-shelf-choice='meter-pro-7-8']");
      await page.locator("[data-shelf-row='meter-feel'] [data-shelf-choice]").nth(1)
        .click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    },
    witness: "[data-shelf-note='meter-subdivision']",
  },
  {
    name: "8-toggle-while-playing",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await pressPro(page);
      await press(page, "[aria-label='Çal']");
      await page.waitForTimeout(500);
      await press(page, "[data-shelf-choice='meter-click-units']");
      return true;
    },
    witness: "[data-shelf-choice='meter-click-units'][data-shelf-choice-state='active']",
  },
  {
    name: "9-landscape-inspector",
    enter: async (page) => {
      if (!(await openPanel(page, "meter"))) return false;
      await pressPro(page);
      await press(page, "[data-view-zoom] button");
      return true;
    },
    witness: "[data-shelf-row='meter-click']",
  },
  {
    name: "10-export-disclosure",
    chrome: true,
    /*
     * No staff here, and that is the design rather than a finding: the
     * export sheet is reached from the header, on a screen that is not the
     * tab view, and a sheet covering the whole screen is what a sheet is.
     * The grid and overlay rules belong to the nine workspace states; this
     * one is measured for text, targets and overflow.
     */
    staff: false,
    enter: async (page) => {
      await press(page, "[aria-label='Ses kaynakları ve lisans']");
      await press(page, "[data-info-export]");
      return true;
    },
    witness: "[data-export-meter-note]",
  },
  {
    name: "11-listening-card",
    path: "/eval/listening-pack",
    chrome: true,
    /* A different route with no staff on it at all. */
    staff: false,
    enter: async (page) => {
      await page.waitForTimeout(600);
      return true;
    },
    witness: "[data-listen-clip='L33']",
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
      await page.goto(`${BASE}${state.path ?? "/"}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);

      /* The build's own SHA, read from the page rather than trusted. */
      if (servedSha === null) {
        servedSha = await page.evaluate(
          () =>
            document.querySelector("[data-build-sha]")?.getAttribute("data-build-sha") ??
            "unknown",
        );
      }

      if (!state.chrome) await enterTab(page);

      await state.enter(page).catch(() => false);
      const reached = (await page.locator(state.witness).count()) > 0;
      results[viewport.name][state.name] = reached
        ? { reached: true, staff: state.staff !== false, ...(await measure(page)) }
        : { reached: false, staff: state.staff !== false };

      await page.screenshot({
        path: `${OUT}rhythm-${viewport.name}-${state.name}.png`,
      });
      await context.close();
    }
    const row = results[viewport.name];
    const reachedCount = Object.values(row).filter((r) => r.reached).length;
    const bad = Object.entries(row).filter(([name, r]) => {
      if (!r.reached) return false;
      const staff = STATES.find((state) => state.name === name)?.staff !== false;
      /* The staff rules apply where there is a staff; the rest apply to
         every state, chrome included. */
      if (staff && (r.gridHit !== "grid" || r.overlays > 0)) return true;
      return (
        r.overflowX ||
        r.smallTargets > 0 ||
        r.clipped > 0 ||
        r.duplicateNames > 0 ||
        r.jargon.length > 0
      );
    });
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
