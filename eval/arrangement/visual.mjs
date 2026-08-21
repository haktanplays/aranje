/**
 * Faz 2J-P visual measurement.
 *
 * Six screenshots and the pixel budget behind them, at both viewports, from the
 * same fixture — so "before" and "after" are the same song on the same screen
 * and the difference is the work rather than the setup.
 *
 * The measurements are the point. A screenshot shows that a header looks
 * cramped; only a bounding-box comparison says the brand text is *underneath*
 * the close button, and only a height budget says where the screen went.
 *
 *   VISUAL_OUT=eval/arrangement/artifacts/before node eval/arrangement/visual.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.VISUAL_OUT ?? "eval/arrangement/artifacts/after";
mkdirSync(OUT, { recursive: true });

const FIXTURE = readFileSync("eval/arrangement/fixture-song.json", "utf8").trim();

/**
 * Do two boxes actually cover each other?
 *
 * Text that starts underneath a button is the defect this exists to catch, and
 * it is invisible to every check that only asks whether an element is present.
 */
function overlap(a, b) {
  if (!a || !b) return 0;
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > 0 && y > 0 ? Math.round(x * y) : 0;
}

const measure = (page) =>
  page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const scrollers = [...document.querySelectorAll("*")].filter(
      (node) =>
        node.scrollWidth > node.clientWidth + 1 &&
        ["auto", "scroll"].includes(getComputedStyle(node).overflowX),
    );

    const targets = [
      ...document.querySelectorAll("button, [role=tab], [role=button]"),
    ]
      .filter((node) => node.getBoundingClientRect().height > 0)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          id: (node.getAttribute("data-testid") ??
            node.getAttribute("aria-label") ??
            node.textContent ??
            "?").slice(0, 28),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      });

    const lanes = [...document.querySelectorAll("[data-arr-track]")]
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.height > 0);
    const scroller = document.querySelector("[data-arrangement-scroller]");
    const visibleLanes = scroller
      ? lanes.filter((rect) => {
          const view = scroller.getBoundingClientRect();
          return rect.top >= view.top - 1 && rect.bottom <= view.bottom + 1;
        }).length
      : 0;

    return {
      viewport: { w: innerWidth, h: innerHeight },
      header: box("header"),
      brand: box("header p"),
      title: box("header h1"),
      headerActions: [...document.querySelectorAll("header button")].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          id: node.getAttribute("aria-label") ?? "?",
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
      viewSwitch: box("[role=tablist][aria-label=Görünüm]"),
      sectionNav: box("[data-section-nav]"),
      work: box("main"),
      trackColumn: box("[data-arr-track]"),
      trackControl: box("[data-track-control]"),
      actionRow: box("[data-action-row]"),
      transport: box("footer"),
      status: box("[data-transport-status]"),
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      scrollers: scrollers.length,
      small: targets.filter((t) => t.w < 43.5 || t.h < 43.5),
      visibleLanes,
      silentWords: [...document.querySelectorAll("[data-arr-cell] span")].filter(
        (node) => node.textContent === "Sessiz",
      ).length,
      instrumentIds: document.body.innerText.match(
        /electric_guitar|steel_acoustic|nylon_guitar|electric_bass|drum_kit|high_gain|crunch|clean|finger|warm|metal/g,
      )?.length ?? 0,
      englishLabels:
        document.body.innerText.match(
          /Electric guitar|Steel string|Nylon guitar|Electric bass|Drum kit/g,
        )?.length ?? 0,
    };
  });

async function openApp(browser, size) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
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
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.setDefaultTimeout(5000);
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("main");
  await page.waitForTimeout(400);
  return { context, page, errors };
}

const report = {};

const browser = await chromium.launch();

for (const [label, size] of [
  ["390x844", { width: 390, height: 844 }],
  ["320x700", { width: 320, height: 700 }],
]) {
  const { context, page, errors } = await openApp(browser, size);

  // ---- 1 and 2: the arrangement, still and playing
  const arrange = await measure(page);
  await page.screenshot({ path: `${OUT}/${label}-arrange.png` });

  await page.locator("[aria-label=Çal]").first().click().catch(() => {});
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${label}-arrange-playing.png` });
  const playing = await measure(page);
  await page.locator("[aria-label=Duraklat]").first().click().catch(() => {});
  await page.waitForTimeout(300);

  // ---- 3: the tab
  await page.locator("[data-testid=view-tab]").click();
  await page.waitForTimeout(400);
  const tab = await measure(page);
  await page.screenshot({ path: `${OUT}/${label}-tab.png` });

  // ---- 4: the tab with the track sheet open
  const control = page.locator("[data-track-control]").first();
  const opened = await control.isVisible().catch(() => false);
  if (opened) {
    await control.click();
  } else {
    // Before the polish there is no single control: the whole grid is the
    // selector, so open the details sheet that exists today instead.
    await page
      .locator("[aria-label='Track ayrıntıları']")
      .first()
      .click()
      .catch(() => {});
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${label}-tab-tracks.png` });

  /*
   * Measured with the sheet open, because that is where the instrument names
   * went. Checking only the two main screens made "no English label reaches
   * the reader" true by the labels not being anywhere at all — which is not
   * the same claim, and a probe that removed a Turkish name from the table
   * proved it by staying green.
   */
  const sheet = await measure(page);

  report[label] = {
    arrange,
    playing: { visibleLanes: playing.visibleLanes },
    tab,
    sheet: { englishLabels: sheet.englishLabels, instrumentIds: sheet.instrumentIds },
    headerOverlap: {
      brandUnderLeading: Math.max(
        ...arrange.headerActions.map((action) => overlap(arrange.brand, action)),
        0,
      ),
      titleUnderLeading: Math.max(
        ...arrange.headerActions.map((action) => overlap(arrange.title, action)),
        0,
      ),
    },
    errors: errors.slice(0, 3),
  };

  await context.close();
}

await browser.close();

/*
 * The acceptance targets, as checks.
 *
 * A measurement file is evidence and a check is a claim, and only a claim can
 * be broken on purpose to find out whether anyone was watching. Every line
 * here is one of the visual goals this checkpoint was given, phrased so that
 * the number it depends on is printed next to the verdict.
 */
const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

for (const [label, entry] of Object.entries(report)) {
  const a = entry.arrange;
  const t = entry.tab;
  const columnLimit = a.viewport.w <= 320 ? 116 : 124;

  /*
   * Two halves of the same promise, and the first one is the one that was
   * broken. Overlap with our own buttons only guards the trailing side; the
   * leading side has no element to collide with, because what sits there is
   * the host shell's close control. So the leading edge is checked as
   * geometry: the text has to start at or after the reserved column, whether
   * or not anything is drawn in it today.
   */
  const leadingEdge = (a.header?.x ?? 0) + 44;
  record(
    `[${label}] header text starts after the leading slot`,
    (a.title?.x ?? 0) >= leadingEdge && (a.brand?.x ?? 0) >= leadingEdge,
    `title x=${a.title?.x} brand x=${a.brand?.x} (reserved to ${leadingEdge})`,
  );
  record(
    `[${label}] header text does not overlap an action`,
    entry.headerOverlap.brandUnderLeading === 0 &&
      entry.headerOverlap.titleUnderLeading === 0,
    `brand ${entry.headerOverlap.brandUnderLeading}px² title ${entry.headerOverlap.titleUnderLeading}px²`,
  );
  record(
    `[${label}] the view switch is a strip, not two cards`,
    (a.viewSwitch?.height ?? 999) <= 48,
    `${a.viewSwitch?.height}px`,
  );
  record(
    `[${label}] Düzen shows no section chip strip`,
    a.sectionNav === null,
    a.sectionNav ? `${a.sectionNav.height}px` : "none",
  );
  record(
    `[${label}] Tab keeps a one-row section navigator`,
    t.sectionNav !== null && t.sectionNav.height <= 52,
    `${t.sectionNav?.height ?? "missing"}px`,
  );
  record(
    `[${label}] the track column leaves the timeline its width`,
    (a.trackColumn?.width ?? 999) <= columnLimit,
    `${a.trackColumn?.width}px of ${a.viewport.w} (limit ${columnLimit})`,
  );
  record(
    `[${label}] at least six lanes are on screen in Düzen`,
    a.visibleLanes >= 6,
    `${a.visibleLanes} lanes`,
  );
  record(
    `[${label}] the tab is the biggest thing on the tab screen`,
    (t.work?.height ?? 0) >
      (t.trackControl?.height ?? 0) + (t.actionRow?.height ?? 0),
    `${t.work?.height} vs ${(t.trackControl?.height ?? 0) + (t.actionRow?.height ?? 0)}`,
  );
  record(
    `[${label}] the action row is one row`,
    (t.actionRow?.height ?? 999) <= 52,
    `${t.actionRow?.height}px`,
  );
  record(
    `[${label}] the transport is one row`,
    (a.transport?.height ?? 999) <= 60,
    `${a.transport?.height}px`,
  );
  record(
    `[${label}] no cell prints the word "Sessiz"`,
    a.silentWords === 0,
    `${a.silentWords} cells`,
  );
  record(
    `[${label}] no English instrument label reaches the screen`,
    a.englishLabels === 0 && t.englishLabels === 0 && entry.sheet.englishLabels === 0,
    `düzen ${a.englishLabels} · tab ${t.englishLabels} · sheet ${entry.sheet.englishLabels}`,
  );
  record(
    `[${label}] no technical id reaches the screen`,
    a.instrumentIds === 0 && t.instrumentIds === 0 && entry.sheet.instrumentIds === 0,
    `düzen ${a.instrumentIds} · tab ${t.instrumentIds} · sheet ${entry.sheet.instrumentIds}`,
  );
  record(`[${label}] no body overflow in Düzen`, a.bodyOverflow <= 0, `${a.bodyOverflow}px`);
  record(`[${label}] no body overflow in Tab`, t.bodyOverflow <= 0, `${t.bodyOverflow}px`);
  record(`[${label}] one horizontal scroller in Düzen`, a.scrollers === 1, `${a.scrollers}`);
  record(`[${label}] one horizontal scroller in Tab`, t.scrollers === 1, `${t.scrollers}`);
  record(
    `[${label}] every target is 44px or more`,
    a.small.length === 0 && t.small.length === 0,
    [...a.small, ...t.small].slice(0, 3).map((s) => `${s.id} ${s.w}x${s.h}`).join(", ") || "none",
  );
  record(`[${label}] no console or page errors`, entry.errors.length === 0, entry.errors[0] ?? "");
}

const failed = results.filter((entry) => !entry.pass);
writeFileSync(
  `${OUT}/MEASUREMENTS.json`,
  `${JSON.stringify({ ...report, checks: results, failed: failed.length }, null, 2)}\n`,
);
console.log(`\n${results.length - failed.length}/${results.length} visual checks passed`);
if (failed.length > 0) process.exitCode = 1;

for (const [label, entry] of Object.entries(report)) {
  const a = entry.arrange;
  const t = entry.tab;
  console.log(`\n== ${label}`);
  console.log(
    `  header ${a.header?.height} · switch ${a.viewSwitch?.height} · sectionNav(tab) ${t.sectionNav?.height ?? "-"} · ` +
      `arrange work ${a.work?.height} · tab work ${t.work?.height} · ` +
      `actionRow ${a.actionRow?.height ?? "-"} · transport ${a.transport?.height}`,
  );
  console.log(
    `  track column ${a.trackColumn?.width}px · track control ${t.trackControl?.height ?? "-"} · visible lanes ${a.visibleLanes} · ` +
      `playing lanes ${entry.playing.visibleLanes}`,
  );
  console.log(
    `  header overlap brand=${entry.headerOverlap.brandUnderLeading}px² title=${entry.headerOverlap.titleUnderLeading}px²`,
  );
  console.log(
    `  overflow ${a.bodyOverflow}px · scrollers arrange ${a.scrollers} tab ${t.scrollers} · ` +
      `under 44px ${a.small.length}/${t.small.length}`,
  );
  console.log(
    `  "Sessiz" words ${a.silentWords} · english labels ${a.englishLabels} · raw ids ${a.instrumentIds} · errors ${entry.errors.length}`,
  );
}
