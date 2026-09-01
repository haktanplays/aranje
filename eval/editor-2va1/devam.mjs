/**
 * The step the founder could not complete, measured (2V-A.1 §6, §11).
 *
 * ## What is being reproduced
 *
 * A real Android phone, `384×740`, `dokunma 5`, on
 * `/eval/editor-acceptance?sha=057f405`. The guide said «2/36 · «Devam»a
 * dokun.», the selection read «1 power chord · 3 nota», and the seven buttons
 * on screen were `Kopyala · Kes · Çoğalt · Tekrarla · Taşı · Sil · Daha fazla`.
 *
 * That screen is reached without ever pressing "Düzenle": a long press on the
 * staff opens a time selection and the *reading* surface draws its own action
 * bar. This run does exactly that, on the production route, through the
 * production controls.
 *
 * ## What it refuses to accept as a pass
 *
 * Finding the word "Devam" on the page. The reach is measured by the
 * selection band actually widening — the descriptor growing, seen through the
 * thing that draws it — and by the guide advancing from 2/36 to 3/36 on the
 * app's own judgement rather than on a press of "Yaptım". A run that pressed
 * nothing would fail step 5 and step 8, by construction.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3114";
const ROUTE = `${BASE}/eval/editor-acceptance`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ONLY = process.env.ONLY ?? "";

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700 },
  /* The founder's own screen, and its own user-agent. */
  { name: "384x740", width: 384, height: 740, ua: ANDROID },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915, ua: ANDROID },
  { name: "1363x936", width: 1363, height: 936, desktop: true },
];

const results = [];
let currentViewport = "";
let shots = 0;
let lastPage = null;

function flush() {
  writeFileSync(
    `${OUT}/DEVAM.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        reproduces: "384x740 · Android UA · «1 power chord · 3 nota» · 2/36",
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

async function safe(step, name, fn) {
  try {
    await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 160);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-devam-${currentViewport}-${step}.png` })
      .catch(() => {});
    record(step, name, false, `threw: ${first}`);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/devam-${currentViewport}-${name}.png` });
  shots += 1;
}

const INSTRUMENT = `window.__consoleErrors = [];`;

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

/** The stored Song and the record's revision, from the page's own reading. */
const stored = (page) =>
  page.evaluate(() => {
    const handle = window.__aranjeAcceptance;
    return handle ? { bytes: handle.bytes(), revision: handle.revision() } : null;
  });

/**
 * Where the selection band starts and how wide it is. The descriptor, seen.
 *
 * Both, because "it got wider" is not the claim. The reach moves the *end*
 * edge and leaves the start alone, so a band that grew by sliding sideways
 * would be a different gesture wearing this one's result.
 */
const band = (page) =>
  page.evaluate(() => {
    const node = document.querySelector('[data-testid="time-selection-band"]');
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return box.width > 0
      ? { left: Math.round(box.left), width: Math.round(box.width) }
      : null;
  });

/** How many notes the summary says are held. */
const heldNotes = (text) => {
  const match = /(\d+)\s+nota/.exec(text ?? "");
  return match ? Number(match[1]) : 0;
};

const summary = (page) =>
  page.evaluate(
    () => document.querySelector("[data-testid=selection-summary]")?.textContent ?? null,
  );

/** Every action the reading surface's own bar is drawing, in order. */
const barActions = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid^='selection-action-']")].map((node) => ({
      label: (node.textContent ?? "").trim(),
      disabled: node.disabled,
      pressed: node.getAttribute("aria-pressed"),
      width: Math.round(node.getBoundingClientRect().width),
      height: Math.round(node.getBoundingClientRect().height),
    })),
  );

const guideStep = (page) =>
  page.evaluate(
    () => document.querySelector("[data-acceptance-step]")?.textContent ?? null,
  );

/** What the page itself recorded about each phase it has judged. */
const guideChecks = (page) =>
  page.evaluate(() => {
    const raw = document
      .querySelector("[data-acceptance-guide]")
      ?.getAttribute("data-acceptance-checks");
    return raw ? JSON.parse(raw) : null;
  });

const guideTask = (page) =>
  page.evaluate(
    () => document.querySelector("[data-acceptance-task]")?.textContent ?? null,
  );

/**
 * Where the staff sits, and how far anything behind it has scrolled.
 *
 * The walk stops at the workspace's own root — the first ancestor that fills
 * the screen — because the guided page scrolls its own step list and that is a
 * page doing its job, not the background sliding.
 */
const surface = (page) =>
  page.evaluate(() => {
    const tab = document.querySelector("[data-tab-content]")?.parentElement ?? null;
    let worstTop = 0;
    for (let node = tab; node !== null; node = node.parentElement) {
      worstTop = Math.max(worstTop, node.scrollTop);
      if (node.clientHeight >= window.innerHeight) break;
    }
    return { left: tab?.scrollLeft ?? -1, top: worstTop };
  });

const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors.slice());

/* ------------------------------------------------------------- gestures */

async function longPress(page, cdp, x, y, hold = 750) {
  if (cdp === null) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(hold);
    await page.mouse.up();
  } else {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await page.waitForTimeout(hold);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.waitForTimeout(380);
}

/** Into the tab, reading — which is where the founder was. */
async function toTab(page) {
  await page.locator("[data-acceptance-action]").first().click();
  await page.waitForTimeout(400);
  await page.locator("[data-testid=view-tab]").click();
  await page.waitForSelector("[data-tab-content]");
  await page.waitForTimeout(220);
}

/**
 * A point inside bar `index`, up to `slots` slots along — and on the screen.
 *
 * Clamped, because a bar of sixteenths is 544px wide and the narrowest phone
 * this pilot supports is 320. Aiming at slot 8 there lands three pixels past
 * the right edge, the press goes nowhere, and the step reports that the reach
 * does not work when what does not work is the harness's arithmetic.
 */
async function slotPoint(page, index, slots) {
  const bar = await page.locator(`[data-bar-drag-index='${index}']`).first().boundingBox();
  if (!bar) throw new Error(`bar ${index} is not drawn`);
  const size = page.viewportSize() ?? { width: 400, height: 800 };
  const fits = Math.floor((size.width - 24 - bar.x - 17) / 34);
  const at = Math.max(0, Math.min(slots, fits));
  if (slots > 0 && at < 2) throw new Error(`only ${at} slots of bar ${index} on screen`);
  /*
   * Vertically, a string the press can actually reach — asked of the page,
   * not computed from the tab's height.
   *
   * At 320×700 the reading surface's action bar sits over the lower half of
   * the staff once a selection is open, so a press aimed at the tab's
   * midpoint lands on that bar's "İptal" link and the reach silently does
   * nothing. It worked at 384 and failed at 320, which is a harness reporting
   * that the app is broken when what is wrong is where it aimed. So the point
   * is chosen by asking `elementFromPoint` which string is still the staff at
   * this x — the same question a finger answers by landing somewhere.
   */
  const x = bar.x + at * 34 + 17;
  const y = await page.evaluate((atX) => {
    const lines = [...document.querySelectorAll("[data-string-line]")]
      .map((node) => {
        const box = node.getBoundingClientRect();
        return box.top + box.height / 2;
      })
      .sort((a, b) => a - b);
    for (const candidate of lines) {
      const hit = document.elementFromPoint(atX, candidate);
      if (hit && hit.closest("[data-tab-content]")) return candidate;
    }
    return null;
  }, x);
  if (y === null) throw new Error("no string is reachable at this x");
  return { x, y, slots: at };
}

const devam = (page) => page.getByRole("button", { name: "Devam", exact: true });

/* ------------------------------------------------------------- the run */

async function runViewport(browser, size) {
  currentViewport = size.name;
  const { context, page, cdp } = await open(browser, size);

  await safe(1, "the fixture opens on the tab, reading", async () => {
    await toTab(page);
    page.__before = await stored(page);
    page.__surfaceBefore = await surface(page);
    const strings = await page.locator("[data-string-line]").count();
    record(1, "the fixture opens on the tab, reading", strings >= 6,
      `strings=${strings} guide="${await guideStep(page)}"`);
  });

  await safe(2, "a long press on the first chord opens a selection", async () => {
    const point = await slotPoint(page, 0, 0);
    await longPress(page, cdp, point.x, point.y);
    const text = await summary(page);
    page.__bandBefore = await band(page);
    record(2, "a long press on the first chord opens a selection",
      text !== null && page.__bandBefore !== null,
      `summary="${text}" band=${JSON.stringify(page.__bandBefore)}`);
    await shot(page, "02-selection");
  });

  await safe(3, "the selection is the power chord the guide names", async () => {
    const text = await summary(page);
    record(3, "the selection is the power chord the guide names",
      text === "1 power chord · 3 nota", `summary="${text}"`);
  });

  await safe(4, "«Devam» is on the bar in front of the reader", async () => {
    /*
     * The whole live FAIL. Not "somewhere on the page": on the bar this
     * selection drew, which is the surface the founder was looking at.
     */
    const actions = await barActions(page);
    const labels = actions.map((entry) => entry.label);
    const entry = actions.find((item) => item.label === "Devam");
    record(4, "«Devam» is on the bar in front of the reader",
      entry !== undefined && !entry.disabled,
      `actions=${JSON.stringify(labels)} disabled=${entry?.disabled}`);
  });

  await safe(5, "it is a real target, and its name is not cut", async () => {
    const entry = (await barActions(page)).find((item) => item.label === "Devam");
    const clipped = await page.evaluate(() => {
      const node = [...document.querySelectorAll("button")].find(
        (button) => (button.textContent ?? "").trim() === "Devam",
      );
      return node ? node.scrollWidth > node.clientWidth + 1 : true;
    });
    record(5, "it is a real target, and its name is not cut",
      (entry?.width ?? 0) >= 44 && (entry?.height ?? 0) >= 44 && !clipped,
      `${entry?.width}×${entry?.height} truncated=${clipped}`);
  });

  await safe(6, "pressing it arms the reach rather than writing", async () => {
    await devam(page).first().click();
    await page.waitForTimeout(320);
    const entry = (await barActions(page)).find((item) => item.label === "Devam");
    const now = await stored(page);
    record(6, "pressing it arms the reach rather than writing",
      entry?.pressed === "true" &&
        now !== null &&
        now.bytes === page.__before?.bytes &&
        now.revision === page.__before?.revision,
      `aria-pressed=${entry?.pressed} revision ${page.__before?.revision} → ${now?.revision}`);
    await shot(page, "06-armed");
  });

  await safe(7, "the next press grows the run from its own start", async () => {
    /*
     * The reach measured as a reach. Finding the button was step 4; this says
     * the button does the thing — and says it precisely: the far edge moved
     * and the near one did not, so the chord the reader started from is still
     * inside the run rather than dragged off the front of it.
     *
     * The summary stops saying "power chord" here, and that is correct: a run
     * of five notes across nine slots is a range, not one chord. What must
     * survive is the chord's three voices, which is why the count is checked
     * rather than the wording.
     */
    const point = await slotPoint(page, 0, 8);
    await longPress(page, cdp, point.x, point.y);
    const after = await band(page);
    const text = await summary(page);
    const before = page.__bandBefore;
    page.__bandAfter = after;
    record(7, "the next press grows the run from its own start",
      after !== null &&
        before !== null &&
        after.width > before.width &&
        after.left === before.left &&
        heldNotes(text) >= 3,
      `reached slot ${point.slots}: band ${JSON.stringify(before)} → ${JSON.stringify(after)}, summary="${text}"`);
    await shot(page, "07-grown");
  });

  await safe(8, "the guide's own judgement moves 2/36 to 3/36", async () => {
    /*
     * Replayed through the guide rather than asserted about it. The page
     * judges each phase from what the app did, so this is the app's answer to
     * "was the reach armed", not the harness's.
     */
    const done = page.getByRole("button", { name: "Yaptım", exact: true });
    await done.first().click();
    await page.waitForTimeout(420);
    const first = await guideStep(page);
    /* Phase 2: press "Devam", then say it was done. */
    if (await devam(page).count()) await devam(page).first().click();
    await page.waitForTimeout(260);
    await done.first().click();
    await page.waitForTimeout(420);
    const second = await guideStep(page);
    const checks = await guideChecks(page);
    /*
     * The counter alone is not the claim: it moves whether the phase passed
     * or failed. `extendArmed` is the page's own recorded answer to "was the
     * reach waiting for a target when they said they had done it", which is
     * the phase a reader with no "Devam" on screen cannot satisfy.
     */
    record(8, "the guide's own judgement moves 2/36 to 3/36",
      /2\/36/.test(first ?? "") &&
        /3\/36/.test(second ?? "") &&
        checks?.extendSelected === true &&
        checks?.extendArmed === true,
      `"${first}" → "${second}" · extendSelected=${checks?.extendSelected} extendArmed=${checks?.extendArmed} · task="${await guideTask(page)}"`);
    await shot(page, "08-guide");
  });

  await safe(9, "the song is byte-identical to before any of it", async () => {
    const now = await stored(page);
    record(9, "the song is byte-identical to before any of it",
      now !== null && now.bytes === page.__before?.bytes,
      `${page.__before?.bytes.length} bytes, identical=${now?.bytes === page.__before?.bytes}`);
  });

  await safe(10, "no history step and no storage write happened", async () => {
    const now = await stored(page);
    record(10, "no history step and no storage write happened",
      now !== null && now.revision === page.__before?.revision,
      `revision ${page.__before?.revision} → ${now?.revision} (one per committed edit)`);
  });

  await safe(11, "and the same reading would have seen a real edit", async () => {
    /*
     * The vacuity control for 9 and 10. One real edit through a production
     * control, both readings required to move, then undone — without which
     * two zeroes above are a constant wearing a measurement's clothes.
     */
    if ((await summary(page)) === null) {
      const point = await slotPoint(page, 0, 0);
      await longPress(page, cdp, point.x, point.y);
    }
    /* "Sil" is a primary action on this bar; no drawer stands between them. */
    await page.locator("[data-testid=selection-action-delete]").first().click();
    await page.waitForTimeout(700);
    const edited = await stored(page);
    const moved =
      edited !== null &&
      edited.bytes !== page.__before?.bytes &&
      edited.revision > (page.__before?.revision ?? 0);
    const undo = page.getByRole("button", { name: /^Geri al/ });
    if (await undo.count()) {
      await undo.first().click();
      await page.waitForTimeout(500);
    }
    const back = await stored(page);
    record(11, "and the same reading would have seen a real edit", moved,
      `bytes moved=${edited?.bytes !== page.__before?.bytes}, revision ${page.__before?.revision} → ${edited?.revision}, restored=${back?.bytes === page.__before?.bytes}`);
  });

  await safe(12, "the staff is where it was, and nothing behind it drifted", async () => {
    const now = await surface(page);
    const before = page.__surfaceBefore;
    const settled = now.left === before.left && now.top === before.top;
    /* And the reading can see the surface move, or it is a constant. */
    await page.evaluate((left) => {
      const scroller = document.querySelector("[data-tab-content]")?.parentElement;
      if (scroller) scroller.scrollLeft = left;
    }, before.left + 120);
    await page.waitForTimeout(200);
    const nudged = await surface(page);
    await page.evaluate((left) => {
      const scroller = document.querySelector("[data-tab-content]")?.parentElement;
      if (scroller) scroller.scrollLeft = left;
    }, before.left);
    record(12, "the staff is where it was, and nothing behind it drifted",
      settled && nudged.left !== before.left,
      `scrollLeft ${before.left} → ${now.left} (a nudge reads ${nudged.left}); behind it ${before.top} → ${now.top}`);
  });

  await safe(13, "no control shrank, and nothing overflowed", async () => {
    const found = await page.evaluate(() => {
      const small = [...document.querySelectorAll("button, [role=button]")]
        .filter((node) => {
          if (node.hasAttribute("data-cell")) return false;
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
        })
        .map((node) => ((node.textContent ?? "?").trim()).slice(0, 30));
      return { small, overflow: document.body.scrollWidth - document.body.clientWidth };
    });
    record(13, "no control shrank, and nothing overflowed",
      found.small.length === 0 && found.overflow <= 0,
      `under44=${JSON.stringify(found.small.slice(0, 4))} overflow=${found.overflow}`);
  });

  await safe(14, "the app wrote nothing to the console", async () => {
    const errors = (await consoleErrors(page)).filter(
      (text) => !/favicon|AudioContext was not allowed/i.test(text),
    );
    record(14, "the app wrote nothing to the console", errors.length === 0,
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
