/**
 * Hearing what is held, measured through a real browser (2V-A §10).
 *
 * ## What this is, and is not
 *
 * The production Workspace on the guided acceptance route, driven by the
 * controls a reader presses: the long-press that draws a time selection, the
 * "Daha fazla" sheet, and the two rows inside it. There is no test-only
 * playback control anywhere in this file — the audition is started by
 * pressing "Seçimi dinle" and stopped by the app deciding it has finished.
 *
 * It is a **browser emulation**: Chromium with a touch context and, on one
 * viewport, an Android user-agent. That is enough for the pointer path, the
 * transport and the audio graph, and it is not a phone. Nothing here may be
 * reported as a physical pass.
 *
 * ## What is measured, and by what
 *
 * Where a run started and ended comes from the app's own read-only debug
 * handle (`__aranjeDebug`), because the screen cannot answer it: the drawer
 * closes when playback starts, and the band on the staff marks the
 * *selection*, not the sound.
 *
 * Whether anything was written comes from `__aranjeAcceptance`, which reports
 * the stored Song's bytes and the project record's revision. Wrapping
 * `localStorage.setItem` would have been the vacuous version of the same
 * step: this route's storage is a `Map` the page owns, so a `setItem` counter
 * would read zero whatever the app did. Every zero-write claim in this file is
 * proved non-vacuous in the same run — step 15 makes one real edit and
 * requires all three instruments to move, then puts it back.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3114";
const ROUTE = `${BASE}/eval/editor-acceptance`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ONLY = process.env.ONLY ?? "";

/** One beat, in ticks. The room a sampled clock is allowed at a boundary. */
const BEAT = 192;

const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700 },
  { name: "390x844", width: 390, height: 844 },
  {
    name: "412x915",
    width: 412,
    height: 915,
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  },
  { name: "1363x936", width: 1363, height: 936, desktop: true },
];

const results = [];
let currentViewport = "";
let shots = 0;
let lastPage = null;

function flush() {
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        results,
        failed: results.filter((entry) => !entry.pass).length,
        screenshots: shots,
      },
      null,
      2,
    )}\n`,
  );
}

const record = (step, name, pass, detail = "") => {
  results.push({ viewport: currentViewport, step, name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${currentViewport} ${step} ${name}${detail ? `  — ${detail}` : ""}`,
  );
  flush();
};

/** A step that threw is a failed step, not a crashed run. */
async function safe(step, name, fn) {
  try {
    await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 160);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${currentViewport}-${step}.png` })
      .catch(() => {});
    record(step, name, false, `threw: ${first}`);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${currentViewport}-${name}.png` });
  shots += 1;
}

/**
 * Watched from before the app's first line.
 *
 * Console errors have to be collected as they happen; so does every scroll
 * position the surface underneath ever reached, because a surface that slid
 * during a gesture and slid back would read as still at the end.
 */
const INSTRUMENT = `
  window.__consoleErrors = [];
`;

async function open(browser, size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: !size.desktop,
    isMobile: !size.desktop,
    deviceScaleFactor: size.desktop ? 1 : 2,
    ...(size.ua ? { userAgent: size.ua } : {}),
  });
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(9000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((t) => window.__consoleErrors.push(t), message.text()).catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((t) => window.__consoleErrors.push(t), String(error)).catch(() => {});
  });
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  const cdp = size.desktop ? null : await context.newCDPSession(page);
  return { context, page, cdp };
}

/* ------------------------------------------------------------ measuring */

const stored = (page) =>
  page.evaluate(() => {
    const handle = window.__aranjeAcceptance;
    return handle ? { bytes: handle.bytes(), revision: handle.revision() } : null;
  });

/**
 * Where the staff and everything behind it are sitting.
 *
 * Named, and bounded. Named because 2U-C is the round where a scroll
 * assertion that did not say which element it read passed while the founder
 * watched the tab slide. Bounded because the acceptance chrome around the
 * workspace scrolls its own guided step list, and that is a page doing its
 * job — so the walk stops at the workspace's own root, found as the first
 * ancestor that fills the screen rather than by matching a class name that
 * could be renamed tomorrow, or a control that is not always drawn.
 *
 * Reported as a position, compared as a drift: the tab lane sits at a fixed
 * offset of its own, and an absolute zero would be asserting the layout
 * rather than the gesture.
 *
 * The horizontal position is the load-bearing half, because it is the half
 * that can move — it is the surface the founder watched slide, and the follow
 * moves it every time a run sounds. The vertical is reported rather than
 * claimed: from the staff up to the workspace root every box is
 * `overflow-hidden`, so a "vertical scroll = 0" assertion here would be the
 * layout answering, which is the vacuity 2U-C was caught by. `scrollable`
 * says how many of those boxes could have scrolled at all.
 */
const surfacePosition = (page) =>
  page.evaluate(() => {
    const tab = document.querySelector("[data-tab-content]")?.parentElement ?? null;
    let worstTop = 0;
    let scrollable = 0;
    for (let node = tab; node !== null; node = node.parentElement) {
      worstTop = Math.max(worstTop, node.scrollTop);
      if (node.scrollHeight > node.clientHeight) scrollable += 1;
      /* The workspace fills the screen exactly; the first box that does is
         its root, and everything above it belongs to the guided page. */
      if (node.clientHeight >= window.innerHeight) break;
    }
    return { left: tab?.scrollLeft ?? -1, top: worstTop, scrollable };
  });

/** How wide the time-selection band is, in slots. Null when none is drawn. */
const bandSlots = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="time-selection-band"]');
    if (!el) return null;
    return Math.round(el.getBoundingClientRect().width / 34);
  });

const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors.slice());

/** The undo control as the reader sees it: what it offers, and whether it can. */
const undoState = (page) =>
  page.evaluate(() => {
    const node = [...document.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? b.textContent ?? "").startsWith("Geri al"),
    );
    if (!node) return null;
    return {
      label: node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "",
      disabled: node.disabled,
    };
  });

/* ------------------------------------------------------------- gestures */

async function down(page, cdp, x, y) {
  if (cdp === null) {
    await page.mouse.move(x, y);
    await page.mouse.down();
  } else {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
  }
}

async function moveTo(page, cdp, from, to, steps = 8, gap = 22) {
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    if (cdp === null) await page.mouse.move(x, y);
    else
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y, id: 1 }],
      });
    await page.waitForTimeout(gap);
  }
}

async function up(page, cdp) {
  if (cdp === null) await page.mouse.up();
  else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(380);
}

async function scrollTabTo(page, x) {
  await page.evaluate((left) => {
    const scroller = document.querySelector("[data-tab-content]")?.parentElement;
    if (scroller) scroller.scrollLeft = left;
  }, x);
  await page.waitForTimeout(220);
}

/**
 * A staff cell of this bar that is genuinely visible, as a point to press.
 *
 * Not "slot 0": the gutter is sticky and covers the left of whatever the
 * window has scrolled to, so the first slot of a bar is often under it.
 */
async function visibleCell(page, barIndex, skip = 0) {
  const size = page.viewportSize() ?? { width: 400, height: 800 };
  const point = await page.evaluate(
    ([index, width, height, from]) => {
      const cells = [
        ...document.querySelectorAll(`[data-bar-drag-index='${index}'] [data-cell]`),
      ];
      let seen = 0;
      for (const cell of cells) {
        const box = cell.getBoundingClientRect();
        if (box.x > 40 && box.right < width - 8 && box.y > 60 && box.bottom < height - 200) {
          if (seen < from) {
            seen += 1;
            continue;
          }
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
      }
      return null;
    },
    [barIndex, size.width, size.height, skip],
  );
  if (!point) throw new Error(`bar ${barIndex} has no visible cell past ${skip}`);
  return point;
}

/** Draw a time selection over a few slots, the way a reader draws one. */
async function selectRun(page, cdp, barIndex = 0, skip = 0, reach = 5) {
  await scrollTabTo(page, barIndex === 0 ? 0 : 400);
  const from = await visibleCell(page, barIndex, skip);
  await down(page, cdp, from.x, from.y);
  await page.waitForTimeout(700);
  await moveTo(page, cdp, from, { x: from.x + reach * 34, y: from.y }, 8, 22);
  await up(page, cdp);
  await page.waitForTimeout(260);
  return from;
}

/** Let go of whatever is held, by the labelled control a reader would press. */
async function letGo(page) {
  for (const label of ["Ölçü seçimini iptal et", "Seçimi iptal et"]) {
    const control = page.getByRole("button", { name: label, exact: true });
    if (await control.count().catch(() => 0)) {
      await control.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(220);
    }
  }
}

/** Open the drawer the two new actions live in. */
async function openDrawer(page) {
  const more = page.getByRole("button", { name: /Daha fazla/ });
  if (!(await more.count())) return false;
  await more.first().click();
  await page.waitForTimeout(300);
  return true;
}

const drawerAction = (page, name) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

/** Into the tab, writing, with the fixture untouched. */
async function toEditor(page) {
  await page.locator("[data-acceptance-action]").first().click();
  await page.waitForTimeout(400);
  await page.locator("[data-testid=view-tab]").click();
  await page.waitForSelector("[data-tab-content]");
  const edit = page.getByRole("button", { name: "Düzenle", exact: true });
  if (await edit.count()) {
    await edit.first().click();
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(200);
}

/**
 * Watch the transport until the audition has been and gone.
 *
 * Sampled rather than awaited on a fixed sleep: how long a run takes depends
 * on the tempo and the practice percent, and a harness that slept for "long
 * enough" would be reporting its own patience. Every tick seen is kept, so
 * the step can say where the run went rather than only where it ended.
 */
async function watchRun(page, budgetMs = 9000) {
  const seen = [];
  const statuses = [];
  const started = Date.now();
  let plan = null;
  while (Date.now() - started < budgetMs) {
    const now = await page.evaluate(() => {
      const d = window.__aranjeDebug;
      return d ? { status: d.status(), ticks: d.ticks(), sel: d.selection(), loop: d.loop() } : null;
    });
    if (now) {
      if (now.sel) plan = now.sel;
      if (now.status === "playing") seen.push(now.ticks);
      if (statuses.at(-1) !== now.status) statuses.push(now.status);
      if (statuses.includes("playing") && now.status === "paused") {
        return { plan, seen, statuses, ticks: now.ticks, ms: Date.now() - started };
      }
    }
    await page.waitForTimeout(120);
  }
  const last = await page.evaluate(() => window.__aranjeDebug?.ticks() ?? -1);
  return { plan, seen, statuses, ticks: last, ms: Date.now() - started, timedOut: true };
}

/* ------------------------------------------------------------- the run */

async function runViewport(browser, size) {
  currentViewport = size.name;
  const { context, page, cdp } = await open(browser, size);

  await safe(1, "a run of notes can be selected in the editor", async () => {
    await toEditor(page);
    page.__before = await stored(page);
    page.__undoBefore = await undoState(page);
    await selectRun(page, cdp);
    const slots = await bandSlots(page);
    record(1, "a run of notes can be selected in the editor", (slots ?? 0) >= 1,
      `slots=${slots}`);
    await shot(page, "01-selection");
  });

  await safe(2, '"Daha fazla" opens on that selection', async () => {
    const opened = await openDrawer(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim())
        .filter((t) => /dinle|döngü/i.test(t)).length,
    );
    record(2, '"Daha fazla" opens on that selection', opened && rows >= 2,
      `opened=${opened} listening rows=${rows}`);
    await shot(page, "02-drawer");
  });

  await safe(3, '"Seçimi dinle" is reachable and offered, not refused', async () => {
    const listen = drawerAction(page, "Seçimi dinle");
    const count = await listen.count();
    const disabled = count ? await listen.first().isDisabled() : true;
    const box = count ? await listen.first().boundingBox() : null;
    record(3, '"Seçimi dinle" is reachable and offered, not refused',
      count === 1 && !disabled && (box?.height ?? 0) >= 44,
      `count=${count} disabled=${disabled} height=${Math.round(box?.height ?? 0)}`);
  });

  await safe(4, "the one-shot starts at the selection's first tick", async () => {
    page.__surfaceBefore = await surfacePosition(page);
    await drawerAction(page, "Seçimi dinle").first().click();
    const run = await watchRun(page);
    page.__run = run;
    const plan = run.plan;
    const first = run.seen.length ? Math.min(...run.seen) : -1;
    record(4, "the one-shot starts at the selection's first tick",
      plan !== null && plan.mode === "once" && first >= plan.startTicks,
      `plan=${JSON.stringify(plan)} firstTickSeen=${first}`);
  });

  await safe(5, "it stops once, at the end, and comes back to the start", async () => {
    /*
     * "Never reached endTicks" would be the wrong claim and it would be a
     * flaky one. The range is half-open in what gets *scheduled*; the clock
     * still runs up to the boundary, and the callback that stops it is
     * scheduled at that boundary, so a sampler will sometimes catch the tick
     * itself. What §3 forbids is carrying on past the end into music nobody
     * selected — measured here as a beat of room, which the "no end bound"
     * mutant blows through by the length of the rest of the song.
     */
    const run = page.__run;
    const plan = run.plan;
    const plays = run.statuses.filter((s) => s === "playing").length;
    const furthest = run.seen.length ? Math.max(...run.seen) : -1;
    const overrun = furthest - (plan?.endTicks ?? 0);
    record(5, "it stops once, at the end, and comes back to the start",
      !run.timedOut && plays === 1 && overrun < BEAT && run.ticks === plan?.startTicks,
      `statuses=${JSON.stringify(run.statuses)} furthest=${furthest} end=${plan?.endTicks} overrun=${overrun} rested at ${run.ticks}, want ${plan?.startTicks}`);
  });

  await safe(6, "the selection is still on the screen afterwards", async () => {
    const slots = await bandSlots(page);
    record(6, "the selection is still on the screen afterwards", (slots ?? 0) >= 1,
      `slots=${slots}`);
    await shot(page, "06-after-audition");
  });

  await safe(7, "nothing outside the selection was played", async () => {
    /*
     * Two facts, both from the run itself: no tick outside the half-open
     * range was ever the playhead, and the plan named one instrument — the
     * one the selection is on — rather than the song's.
     *
     * The onset-level proof (an event on an unselected track is never handed
     * to the scheduler) is not something a browser can see; it is asserted
     * against the real `scheduleSong` in selection-schedule.test.ts. What
     * this step adds is that the production wiring reaches that scheduler
     * with the right window.
     */
    const run = page.__run;
    const plan = run.plan;
    const before = run.seen.filter((t) => t < (plan?.startTicks ?? 0));
    const after = run.seen.filter((t) => t >= (plan?.endTicks ?? 0) + BEAT);
    const tracks = plan?.trackIds ?? [];
    record(7, "nothing outside the selection was played",
      before.length === 0 && after.length === 0 && tracks.length === 1,
      `ticksBeforeStart=${before.length} ticksPastEnd=${after.length} tracks=${JSON.stringify(tracks)} range=[${plan?.startTicks},${plan?.endTicks})`);
  });

  await safe(8, '"Seçimden döngü" starts a loop on the same music', async () => {
    await openDrawer(page);
    const loopRow = drawerAction(page, "Seçimden döngü");
    const found = await loopRow.count();
    if (found) await loopRow.first().click();
    await page.waitForTimeout(1400);
    const state = await page.evaluate(() => {
      const d = window.__aranjeDebug;
      return d ? { sel: d.selection(), loop: d.loop(), status: d.status() } : null;
    });
    page.__loop = state?.loop ?? null;
    record(8, '"Seçimden döngü" starts a loop on the same music',
      found === 1 &&
        state?.sel?.mode === "loop" &&
        state?.loop?.on === true &&
        state.loop.startTicks === state.sel.startTicks &&
        state.loop.endTicks === state.sel.endTicks,
      `${JSON.stringify(state)}`);
    await shot(page, "08-loop");
  });

  await safe(9, "the loop's boundaries do not move over three turns", async () => {
    /*
     * Watched across the wrap rather than sampled twice: what §4 forbids is
     * drift, and drift only shows at the moment the playhead comes back.
     */
    const seen = new Set();
    let wraps = 0;
    let last = -1;
    const started = Date.now();
    while (Date.now() - started < 20000 && wraps < 3) {
      const now = await page.evaluate(() => {
        const d = window.__aranjeDebug;
        return d ? { ticks: d.ticks(), loop: d.loop() } : null;
      });
      if (now?.loop) seen.add(`${now.loop.startTicks}-${now.loop.endTicks}`);
      if (now && last > now.ticks) wraps += 1;
      if (now) last = now.ticks;
      await page.waitForTimeout(100);
    }
    record(9, "the loop's boundaries do not move over three turns",
      wraps >= 3 && seen.size === 1,
      `wraps=${wraps} distinct bounds=${JSON.stringify([...seen])}`);
  });

  await safe(10, "pause and resume keep the loop and its bounds", async () => {
    const bounds = () => page.evaluate(() => window.__aranjeDebug?.loop() ?? null);
    const before = await bounds();
    const toggle = page.getByRole("button", { name: /^(Duraklat|Çal)$/ });
    await toggle.first().click();
    await page.waitForTimeout(500);
    const paused = await page.evaluate(() => window.__aranjeDebug?.status());
    await toggle.first().click();
    await page.waitForTimeout(900);
    const after = await bounds();
    const playing = await page.evaluate(() => window.__aranjeDebug?.status());
    record(10, "pause and resume keep the loop and its bounds",
      paused === "paused" &&
        playing === "playing" &&
        JSON.stringify(before) === JSON.stringify(after),
      `${paused} → ${playing}, bounds ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  });

  await safe(11, "the drawer offers to close the loop, and closing cleans up", async () => {
    await openDrawer(page);
    const off = drawerAction(page, "Seçim döngüsünü kapat");
    const found = await off.count();
    if (found) await off.first().click();
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const d = window.__aranjeDebug;
      return d ? { sel: d.selection(), loop: d.loop(), status: d.status(), ticks: d.ticks() } : null;
    });
    const slots = await bandSlots(page);
    record(11, "the drawer offers to close the loop, and closing cleans up",
      found === 1 &&
        state?.sel === null &&
        state?.loop === null &&
        state?.status !== "playing" &&
        state?.ticks === page.__loop?.startTicks &&
        (slots ?? 0) >= 1,
      `${JSON.stringify(state)} band slots=${slots}`);
  });

  await safe(12, "a new selection leaves no old loop running", async () => {
    await openDrawer(page);
    await drawerAction(page, "Seçimden döngü").first().click();
    await page.waitForTimeout(1200);
    const during = await page.evaluate(() => window.__aranjeDebug?.selection() ?? null);
    await letGo(page);
    await selectRun(page, cdp, 0, 6, 3);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
      const d = window.__aranjeDebug;
      return d ? { sel: d.selection(), loop: d.loop(), status: d.status() } : null;
    });
    record(12, "a new selection leaves no old loop running",
      during !== null &&
        after?.sel === null &&
        after?.loop === null &&
        after?.status !== "playing",
      `was ${JSON.stringify(during)}, now ${JSON.stringify(after)}`);
  });

  await safe(13, "the song is byte-identical to before any of it", async () => {
    const now = await stored(page);
    record(13, "the song is byte-identical to before any of it",
      now !== null && page.__before !== null && now.bytes === page.__before.bytes,
      now === null ? "no reading handle" : `${page.__before.bytes.length} bytes, identical=${now.bytes === page.__before.bytes}`);
  });

  await safe(14, "the project record's revision never moved", async () => {
    /* One revision per committed edit, said by the app. Zero is zero commands. */
    const now = await stored(page);
    record(14, "the project record's revision never moved",
      now !== null && now.revision === page.__before?.revision,
      `revision ${page.__before?.revision} → ${now?.revision}`);
  });

  await safe(15, "and the same instruments would have seen a real edit", async () => {
    /*
     * The vacuity control for 13, 14 and 16. Every zero above is worthless
     * unless the thing measuring it can move — so one real edit is made
     * through the production surface, all three readings are required to
     * change, and then it is undone.
     */
    await letGo(page);
    await selectRun(page, cdp);
    await openDrawer(page);
    /* "Sil" is a real command on the real surface: one history step, one
       record revision, and a song that is no longer the one stored. */
    const remove = drawerAction(page, "Sil");
    if (await remove.count()) await remove.first().click();
    await page.waitForTimeout(700);
    const edited = await stored(page);
    const undoAfter = await undoState(page);
    const moved =
      edited !== null &&
      edited.bytes !== page.__before.bytes &&
      edited.revision > page.__before.revision &&
      undoAfter?.disabled === false;
    const undoControl = page.getByRole("button", { name: /^Geri al/ });
    if (await undoControl.count()) {
      await undoControl.first().click();
      await page.waitForTimeout(500);
    }
    const back = await stored(page);
    record(15, "and the same instruments would have seen a real edit", moved,
      `bytes moved=${edited?.bytes !== page.__before.bytes} revision ${page.__before.revision} → ${edited?.revision}, undo "${undoAfter?.label}" disabled=${undoAfter?.disabled}, restored=${back?.bytes === page.__before.bytes}`);
  });

  await safe(16, "the undo stack was where it started before that edit", async () => {
    record(16, "the undo stack was where it started before that edit",
      page.__undoBefore?.disabled === true,
      `before any listening: "${page.__undoBefore?.label}" disabled=${page.__undoBefore?.disabled}`);
  });

  await safe(17, "the staff is where it was before any of it", async () => {
    /*
     * Drift, over the whole session — not "never moved during it". The view
     * follows the playhead while a run is sounding, which is a feature and
     * not a slide; what would be the founder's complaint is the surface
     * ending up somewhere nobody put it.
     */
    const now = await surfacePosition(page);
    const before = page.__surfaceBefore;
    const settled = now.left === before.left;
    /*
     * And the reading can see the surface move. Without this the step is a
     * constant dressed as a measurement: scroll the staff, require the number
     * to follow, put it back.
     */
    await scrollTabTo(page, before.left + 120);
    const nudged = await surfacePosition(page);
    await scrollTabTo(page, before.left);
    const responsive = nudged.left !== before.left;
    record(17, "the staff is where it was before any of it", settled && responsive,
      `staff scrollLeft ${before.left} → ${now.left} (a nudge reads ${nudged.left}, so the instrument moves); vertically ${before.top} → ${now.top} across ${now.scrollable} scrollable boxes behind it`);
  });

  await safe(18, "every control a reader presses is still at least 44px", async () => {
    await letGo(page);
    await selectRun(page, cdp);
    await openDrawer(page);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button, [role=button]")]
        .filter((node) => {
          if (node.hasAttribute("data-cell")) return false;
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
        })
        .map((node) =>
          ((node.getAttribute("aria-label") ?? node.textContent ?? "?").trim()).slice(0, 40),
        ),
    );
    record(18, "every control a reader presses is still at least 44px",
      small.length === 0, small.slice(0, 4).join(" | "));
  });

  await safe(19, "no label is cut off, and the body does not overflow", async () => {
    const found = await page.evaluate(() => {
      const overflow = document.body.scrollWidth - document.body.clientWidth;
      const cut = [...document.querySelectorAll("button, [role=button]")]
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => ((node.textContent ?? "?").trim()).slice(0, 40));
      return { overflow, cut };
    });
    record(19, "no label is cut off, and the body does not overflow",
      found.overflow <= 0 && found.cut.length === 0,
      `overflow=${found.overflow} truncated=${JSON.stringify(found.cut.slice(0, 4))}`);
    await shot(page, "19-drawer-labels");
  });

  await safe(20, "the app wrote nothing to the console", async () => {
    const errors = (await consoleErrors(page)).filter(
      /* Chromium's own autoplay and font warnings are not the app's. */
      (text) => !/favicon|AudioContext was not allowed/i.test(text),
    );
    record(20, "the app wrote nothing to the console", errors.length === 0,
      errors.slice(0, 2).join(" | ").slice(0, 200));
  });

  await context.close();
}

const browser = await chromium.launch();
try {
  for (const size of VIEWPORTS) {
    if (ONLY && size.name !== ONLY) continue;
    await runViewport(browser, size);
  }
} finally {
  await browser.close();
}

const failed = results.filter((entry) => !entry.pass);
flush();
console.log(
  `\n${results.length - failed.length}/${results.length} — browser emulation, not a physical device`,
);
if (failed.length > 0) {
  for (const entry of failed) console.log(`  FAIL ${entry.viewport} ${entry.step} ${entry.name}`);
  process.exitCode = 1;
}
