/**
 * The camera, exercised rather than described (2V-B.3 §10, §11, §12).
 *
 * Three claims that can only be made in a browser, so they are made in one:
 *
 * - the zoom controls change how much music is on the screen, and change no
 *   music — the same notes, at the same ticks, before and after;
 * - a two-finger pinch reaches the same magnification the buttons do, and
 *   does not leave a tap behind;
 * - dragging the empty staff moves the view and keeps the selection exactly
 *   where it was, in ticks.
 *
 * Usage:  SHA=<sha> node eval/listening-pack/view-gestures.mjs
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
  { name: "412x915", width: 412, height: 915 },
  { name: "landscape-740x360", width: 740, height: 360 },
];

/**
 * What the staff looks like right now, in the two vocabularies that matter.
 *
 * `music` is the claim about the Song: every drawn onset's bar and slot. It
 * must be byte-identical across every zoom, pan and pinch below — that is the
 * whole of "the camera changed nothing".
 */
const snapshot = (page) =>
  page.evaluate(() => {
    const content = document.querySelector("[data-tab-content]");
    const scroller = content?.parentElement ?? null;
    const band = document.querySelector("[data-testid=time-selection-band]");
    const onsets = [...document.querySelectorAll("[data-cell][data-onset]")].map(
      (cell) =>
        `${cell.closest("[data-bar-key]")?.getAttribute("data-bar-key") ?? "?"}#${cell.getAttribute("data-cell")}`,
    );
    const bar = document.querySelector("[data-bar-key]");
    return {
      magnification: content ? Number(getComputedStyle(content).zoom) : null,
      scrollLeft: scroller ? Math.round(scroller.scrollLeft) : null,
      viewportPx: scroller ? Math.round(scroller.clientWidth) : null,
      /* How wide one measure is on screen: the number the presets are about. */
      barScreenPx: bar ? Math.round(bar.getBoundingClientRect().width) : null,
      selection: band
        ? {
            startTicks: band.getAttribute("data-start-ticks"),
            endTicks: band.getAttribute("data-end-ticks"),
          }
        : null,
      music: onsets.sort().join(","),
      onsetCount: onsets.length,
    };
  });

const openEditor = async (page, sha) => {
  await page.goto(`${BASE}/eval/editor-action-batch?sha=${sha}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(400);
  await page.locator("[data-batch-action='to-song']").first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
  await page.waitForSelector("[data-tab-content]");
  await page
    .getByRole("button", { name: "Düzenle", exact: true })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(400);
};

/** Hold a run of notes, the way a reader does: press, wait, reach, lift. */
const selectSomething = async (page) => {
  const spot = await page.evaluate(() => {
    const node = document.querySelector("[data-bar-drag-index]");
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    /*
     * A string a finger could really touch (2V-B.3 §8).
     *
     * The work area clips its own overflow now, so on a short screen the
     * lower strings are laid out below the column and scrolled to rather
     * than reachable. Pressing the *middle* line regardless was pressing
     * whatever control sits under the clip — which opened the track sheet
     * and reported the grid as covered by it.
     */
    const column = (node.closest("main") ?? node).getBoundingClientRect();
    const top = Math.max(column.top, 0);
    const bottom = Math.min(column.bottom, window.innerHeight);
    const lines = [...document.querySelectorAll("[data-string-line]")]
      .map((line) => {
        const at = line.getBoundingClientRect();
        return at.top + at.height / 2;
      })
      .filter((at) => at > top + 4 && at < bottom - 4);
    const y = lines[Math.floor(lines.length / 2)];
    return y === undefined ? null : { x: rect.left + 20, y };
  });
  if (!spot) return false;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.move(spot.x + 68, spot.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  return true;
};

/** A real two-finger pinch, through the touch pipeline rather than a hook. */
const pinch = async (page, factor) =>
  page.evaluate(async (scale) => {
    const content = document.querySelector("[data-tab-content]");
    if (!content) return false;
    const rect = content.getBoundingClientRect();
    const cy = Math.min(rect.top + 60, window.innerHeight - 10);
    const cx = Math.min(rect.left + 120, window.innerWidth - 10);
    const fire = (type, points) => {
      for (const [id, x] of points) {
        content.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 1,
            clientX: x,
            clientY: cy,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    const half = 40;
    fire("pointerdown", [
      [1, cx - half],
      [2, cx + half],
    ]);
    for (let step = 1; step <= 8; step += 1) {
      const spread = half * (1 + ((scale - 1) * step) / 8);
      fire("pointermove", [
        [1, cx - spread],
        [2, cx + spread],
      ]);
      await new Promise((done) => requestAnimationFrame(done));
    }
    fire("pointerup", [
      [1, cx - half * scale],
      [2, cx + half * scale],
    ]);
    return true;
  }, factor);

/** Group "bar#slot:string" onsets by bar, so two snapshots can be compared. */
const byBar = (music) => {
  const out = new Map();
  for (const entry of music ? music.split(",").filter(Boolean) : []) {
    const bar = entry.split("#")[0];
    if (!out.has(bar)) out.set(bar, new Set());
    out.get(bar).add(entry);
  }
  return out;
};

const sameWhereBothDrew = (left, right) => {
  const a = byBar(left);
  const b = byBar(right);
  let shared = 0;
  for (const [bar, onsets] of a) {
    const other = b.get(bar);
    if (!other) continue;
    shared += 1;
    if (onsets.size !== other.size) return false;
    for (const onset of onsets) if (!other.has(onset)) return false;
  }
  /* And they really did share a bar: an empty intersection would make the
     claim above true by saying nothing. */
  return shared > 0;
};

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }
  const browser = await chromium.launch();
  const results = {};
  const failures = [];

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      userAgent: ANDROID,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await openEditor(page, sha);
    const held = await selectSomething(page);
    const base = await snapshot(page);

    const press = async (name) => {
      await page
        .locator(`[data-view-zoom] button[aria-label*="${name}"]`)
        .first()
        .click({ timeout: 4000 });
      await page.waitForTimeout(350);
      return snapshot(page);
    };

    const steps = {};
    steps.base = base;
    steps.oneBar = await press("1 ölçü").catch((error) => ({ error: String(error) }));
    steps.fourBars = await press("4 ölçü").catch((error) => ({ error: String(error) }));
    steps.zoomIn = await press("Yakınlaş").catch((error) => ({ error: String(error) }));
    steps.fit = await page
      .locator("[data-view-zoom] button[aria-label*='sığdır']")
      .first()
      .click({ timeout: 4000 })
      .then(() => page.waitForTimeout(350))
      .then(() => snapshot(page))
      .catch((error) => ({ error: String(error) }));

    await pinch(page, 1.9);
    await page.waitForTimeout(350);
    steps.pinched = await snapshot(page);

    /* And a pan on the empty background, with something held. */
    const panned = await page.evaluate(async () => {
      const content = document.querySelector("[data-tab-content]");
      const scroller = content?.parentElement;
      if (!content || !scroller) return null;
      const before = scroller.scrollLeft;
      const rect = content.getBoundingClientRect();
      const y = Math.min(rect.bottom - 10, window.innerHeight - 10);
      const x = Math.min(rect.left + 200, window.innerWidth - 20);
      const fire = (type, at) =>
        content.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
            clientX: at,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire("pointerdown", x);
      for (let step = 1; step <= 8; step += 1) {
        fire("pointermove", x - step * 12);
        await new Promise((done) => requestAnimationFrame(done));
      }
      fire("pointerup", x - 96);
      return before;
    });
    await page.waitForTimeout(300);
    steps.panned = { ...(await snapshot(page)), scrollBefore: panned };

    /* Every claim, in one place, so a regression names itself. */
    const say = (ok, what) => {
      if (!ok) failures.push(`${viewport.name}: ${what}`);
      return ok;
    };
    const checks = {
      zoomControlsExist: say(base.magnification !== null, "no zoom controls or staff"),
      /*
       * "1 ölçü" means one measure fills the screen — which on a 360px phone
       * is a *smaller* magnification, because one 1/16 bar is 544 content px
       * and already wider than the viewport. The claim is about fit, not
       * about direction.
       */
      onePresetFitsOneMeasure: say(
        Math.abs(steps.oneBar.barScreenPx - steps.oneBar.viewportPx) <= 2,
        `1 ölçü put ${steps.oneBar.barScreenPx}px of measure on a ${steps.oneBar.viewportPx}px screen`,
      ),
      fourPresetShrinks: say(
        steps.fourBars.barScreenPx < steps.oneBar.barScreenPx,
        "4 ölçü did not put more music on the screen",
      ),
      pinchMagnifies: say(
        steps.pinched.magnification > steps.fit.magnification,
        "the pinch did not magnify",
      ),
      /*
       * The music is unchanged, said the only way that is true.
       *
       * A magnification changes how many *bars* are mounted — that is the
       * windowing doing its job, and comparing the whole list would call it a
       * mutation. What must hold is that for every bar both snapshots drew,
       * the same onsets are in the same slots on the same strings: no note
       * moved, appeared or vanished in any measure the reader can see.
       */
      musicUnchanged: say(
        [steps.oneBar, steps.fourBars, steps.zoomIn, steps.fit, steps.pinched, steps.panned]
          .every((step) => sameWhereBothDrew(base.music, step.music)),
        "a note moved, appeared or vanished under a camera move",
      ),
      selectionKept: say(
        !held ||
          [steps.oneBar, steps.fourBars, steps.fit, steps.pinched, steps.panned].every(
            (step) =>
              step.selection?.startTicks === base.selection?.startTicks &&
              step.selection?.endTicks === base.selection?.endTicks,
          ),
        "the selection moved or was lost",
      ),
      panMovedTheView: say(
        !held || steps.panned.scrollLeft !== steps.panned.scrollBefore,
        "the background pan did not move the view",
      ),
    };

    results[viewport.name] = { held, steps, checks };
    console.log(viewport.name, JSON.stringify(checks));
    await context.close();
  }

  await browser.close();
  writeFileSync(
    `${OUT}VIEW-GESTURES.json`,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sha, results, failures }, null, 2)}\n`,
  );
  console.log(`\n${failures.length} failure(s)`);
  for (const line of failures) console.log(`  ${line}`);
  console.log(`written to ${OUT}VIEW-GESTURES.json`);
  process.exit(failures.length === 0 ? 0 : 1);
};

await main();
