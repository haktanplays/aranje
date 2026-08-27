/**
 * The guided Android route, driven the way a reader drives it (§10).
 *
 * The first version of this file clicked "Yaptım — sonraki" through all seven
 * steps and pronounced the route clean. It was measuring the *conductor*, not
 * the test: it never selected a run, never armed the pen, never pressed play —
 * so when a person ran the same route on a real browser, four defects the
 * harness had never asked about came back at once.
 *
 * So this one does the work. It long-presses a note, drags the handle, opens
 * the more sheet, cancels, arms the power pen, holds a beat, drags off the
 * staff, releases, then plays, pauses, plays, seeks, loops, changes the speed
 * and rewinds — and reads the result block the reader would copy.
 *
 * Four contexts, because the two failure modes are a small screen and a
 * browser that is not a phone at all:
 *
 *   320×700   the narrowest screen the product is measured at
 *   390×844   the ordinary phone
 *   412×915   the same flow behind an Android Chrome user agent
 *   1363×936  a desktop with no touch — the machine the live run used, kept
 *             so the physical verdict can be shown never to reach PASS there
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/android/harness.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, fixture } from "../intent-composer/device.mjs";
import { PROJECT_LEDGER } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const ROUTE = `${BASE}/eval/android-acceptance`;
const OUT = "eval/android/artifacts";
mkdirSync(OUT, { recursive: true });

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.6478.71 Mobile Safari/537.36";

const CONTEXTS = [
  { name: "320x700", viewport: { width: 320, height: 700 }, touch: true },
  { name: "390x844", viewport: { width: 390, height: 844 }, touch: true },
  {
    name: "412x915-android-ua",
    viewport: { width: 412, height: 915 },
    touch: true,
    ua: ANDROID_UA,
  },
  {
    /* The live run's machine. Functional checks apply; physical must not. */
    name: "1363x936-desktop-notouch",
    viewport: { width: 1363, height: 936 },
    touch: false,
  },
];

/** The reader's own music, on the device before the test opens. */
const READER_STORAGE = device(fixture("techniques"));

const seededBaseline = () =>
  JSON.stringify(
    Object.keys(READER_STORAGE)
      .sort()
      .map((key) => [key, READER_STORAGE[key]]),
  );

async function boot(browser, shape) {
  const context = await browser.newContext({
    viewport: shape.viewport,
    deviceScaleFactor: 2,
    isMobile: shape.touch,
    hasTouch: shape.touch,
    ...(shape.ua ? { userAgent: shape.ua } : {}),
  });
  await context.addInitScript(
    ([entries, ledger]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(ledger);
    },
    [Object.entries(READER_STORAGE), PROJECT_LEDGER],
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const permissions = [];
  page.on("dialog", (dialog) => {
    permissions.push(dialog.message());
    dialog.dismiss().catch(() => undefined);
  });
  const offOrigin = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      offOrigin.push(request.url());
    }
  });
  return { context, page, errors, permissions, offOrigin };
}

/* ------------------------------------------------------------- gestures */

/**
 * One press, either finger or mouse.
 *
 * Both paths are exercised because the pen and the selection listen to
 * pointer events, and a pointer that came from a mouse takes a different road
 * through the browser than one that came from a touchscreen (§5).
 */
async function pressAt(page, cdp, box, options = {}) {
  const { hold = 700, end = "release", drift = null, touch = true } = options;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await page.waitForTimeout(hold);
    if (drift) {
      for (let step = 1; step <= 6; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: x + (drift.dx * step) / 6, y: y + (drift.dy * step) / 6, id: 1 },
          ],
        });
        await page.waitForTimeout(40);
      }
    }
    if (end === "cancel") {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    } else {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(hold);
    if (drift) {
      for (let step = 1; step <= 6; step += 1) {
        await page.mouse.move(x + (drift.dx * step) / 6, y + (drift.dy * step) / 6);
        await page.waitForTimeout(40);
      }
    }
    await page.mouse.up();
  }
  await page.waitForTimeout(450);
}

/**
 * The box of the first match, scrolled into view first.
 *
 * At 320px the fourth slot of the first bar is off the right edge, so a press
 * measured without scrolling lands on nothing — which is a harness fault, not
 * a product one, and it read as "long press opened no selection".
 */
const boxOf = async (page, selector) => {
  const node = page.locator(selector).first();
  if ((await node.count()) === 0) return null;
  await node.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(250);
  return node.boundingBox();
};

const tap = async (page, id) => {
  const button = page.locator(`[data-acceptance-action='${id}']`).first();
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.click();
  await page.waitForTimeout(200);
  return true;
};

const clickLabel = async (page, label) => {
  const node = page.locator(`[aria-label='${label}']`).first();
  if (!(await node.isVisible().catch(() => false))) return false;
  await node.click();
  await page.waitForTimeout(350);
  return true;
};

const step = (page) =>
  page.evaluate(() =>
    Number(
      document
        .querySelector("[data-acceptance-step]")
        ?.getAttribute("data-acceptance-step") ?? -1,
    ),
  );

const smallControls = (page) =>
  page.evaluate(() => {
    const inside = document.querySelector("[data-acceptance-step]");
    if (!inside) return [];
    return [...inside.querySelectorAll("button, textarea, [role='button']")]
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          label: (node.getAttribute("data-acceptance-action") ?? node.textContent ?? "")
            .trim()
            .slice(0, 24),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      })
      .filter((entry) => entry.width > 0 && (entry.width < 44 || entry.height < 44));
  });

const bodyOverflow = (page) =>
  page.evaluate(() => document.body.scrollWidth - document.body.clientWidth);

const deviceStorage = (page) =>
  page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      keys.push(localStorage.key(index));
    }
    keys.sort();
    return JSON.stringify(keys.map((key) => [key, localStorage.getItem(key)]));
  });

/** The fixture's own bytes, straight out of the page's memory storage. */
const fixtureBytes = (page) =>
  page.evaluate(() => {
    const node = document.querySelector("[data-acceptance-fixture]");
    return node?.getAttribute("data-acceptance-fixture") ?? "";
  });

/*
 * Strings are counted from the drawn lines, not from the cells: the cells are
 * an edit-mode affordance and the viewing step is deliberately read-only.
 */
const strings = (page) =>
  page.evaluate(
    () =>
      new Set(
        [...document.querySelectorAll("[data-string-line]")].map((node) =>
          node.getAttribute("data-string-line"),
        ),
      ).size,
  );

const visibleStrings = (page) =>
  page.evaluate(() => {
    const rows = new Set();
    for (const node of document.querySelectorAll("[data-string-line]")) {
      const box = node.getBoundingClientRect();
      if (box.top >= 0 && box.bottom <= window.innerHeight) {
        rows.add(node.getAttribute("data-string-line"));
      }
    }
    return rows.size;
  });

/* ---------------------------------------------------------------- the run */

async function run(browser, shape) {
  const { context, page, errors, permissions, offOrigin } = await boot(browser, shape);
  const cdp = shape.touch ? await context.newCDPSession(page) : null;
  const touch = shape.touch;

  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-acceptance-step]", { timeout: 20000 });

  const readerBefore = seededBaseline();
  const songAtOpen = await fixtureBytes(page);
  const sessionRefused = await page
    .locator("[role='alert']")
    .first()
    .textContent()
    .catch(() => null);

  const overflow = [await bodyOverflow(page)];
  const small = [];
  const steps = [await step(page)];

  /* ---- step 1 → 2: the route must already be on the tab (§3) ---- */
  await tap(page, "start");
  steps.push(await step(page));
  const tabOnArrival = (await page.locator("[data-tab-content]").count()) > 0;
  const stringsOnArrival = await strings(page);
  const stringsVisible = await visibleStrings(page);
  const arrangementOnArrival =
    (await page.locator("[data-arrangement-scroller]").count()) > 0;
  small.push(...(await smallControls(page)));

  await tap(page, "visual-ok");
  steps.push(await step(page));

  /* ---- step 3: a real selection, the more sheet, and a cancel ---- */
  const editingAtSelect = await page.evaluate(
    () => document.querySelector("[data-composer-door]") !== null,
  );
  let selectionCells = 0;
  const firstCell = await boxOf(page, "[data-cell='4:2']");
  if (firstCell) await pressAt(page, cdp, firstCell, { hold: 700, touch });
  const selectionAfterPress = await page.locator("[data-selection-toolbar]").count();

  /*
   * Pull the end handle toward the right edge until the band stops growing.
   *
   * Aiming at a target cell was the obvious approach and failed at 320px,
   * where the fifth note of the run is off the screen entirely: the drag had
   * nowhere to aim, covered one slot, and read as a product defect. Dragging
   * to the edge lets the surface scroll under the finger, which is what a
   * reader's finger does.
   */
  const bandSlots = () =>
    page.evaluate(() => {
      const band = document.querySelector("[data-testid='time-selection-band']");
      return band ? Math.round(band.getBoundingClientRect().width / 34) : 0;
    });
  let widest = await bandSlots();
  for (let pull = 0; pull < 8; pull += 1) {
    const handle = await boxOf(page, "[data-testid='selection-handle-end']");
    if (!handle) break;
    const goal = page.viewportSize().width - 10;
    if (goal <= handle.x + handle.width / 2 + 2) break;
    await pressAt(page, cdp, handle, {
      hold: 60,
      touch,
      drift: { dx: goal - (handle.x + handle.width / 2), dy: 0 },
    });
    const now = await bandSlots();
    if (now <= widest) break;
    widest = now;
    if (widest >= 5) break;
  }
  /*
   * A time selection is a band with two handles, not a set of marked cells —
   * so its breadth is measured in slots of band, and five notes of the run is
   * four slot widths or more.
   */
  selectionCells = await page.evaluate(() => {
    const band = document.querySelector("[data-testid='time-selection-band']");
    return band ? Math.round(band.getBoundingClientRect().width / 34) : 0;
  });
  const verbsShown = await page.locator("[data-selection-verb]").count();
  await page
    .locator("button", { hasText: "Daha fazla" })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(400);
  const moreSheet = await page.locator("[data-selection-action='Kopyala']").count();
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: "İptal" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const selectionAfterCancel = await page.locator("[data-selection-toolbar]").count();
  small.push(...(await smallControls(page)));

  /*
   * Leave a selection open on the way out.
   *
   * The reader on the live run tapped "next" with a selection still up, and
   * the step after inherited it. Tidying up here would test the harness's
   * manners rather than the step's contract, so the mess is deliberate and
   * the next step is measured on having cleared it.
   */
  const untidy = await boxOf(page, "[data-cell='4:2']");
  if (untidy) await pressAt(page, cdp, untidy, { hold: 700, touch });
  const selectionLeftOpen = await page.locator("[data-selection-toolbar]").count();

  await tap(page, "selection-next");
  steps.push(await step(page));
  const inheritedSelection = await page.locator("[data-selection-toolbar]").count();

  /* ---- step 4: the pen owns the press; the ghost writes nothing ---- */
  const penArmed = await page.evaluate(
    () => document.querySelector("[data-composer-door-held]")?.textContent ?? "",
  );
  const songBefore = await fixtureBytes(page);
  /*
   * Slot 3 of the first bar is the rest after the three chugs, and string 1
   * has room above it for a fifth and an octave. Slot 2 was tried first and
   * carries a chug: the pen refuses an occupied beat, which is correct
   * behaviour and a useless place to photograph a ghost.
   */
  const empty = await boxOf(page, "[data-cell='3:1']");
  let ghostVoices = 0;
  let selectionDuringGhost = 0;
  if (empty) {
    /* Hold, read the ghost while the finger is still down, then drag off. */
    const x = empty.x + empty.width / 2;
    const y = empty.y + empty.height / 2;
    if (touch) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
    }
    await page.waitForTimeout(800);
    ghostVoices = Number(
      (await page
        .locator("[data-pen-ghost]")
        .first()
        .getAttribute("data-pen-ghost")
        .catch(() => "0")) ?? "0",
    );
    selectionDuringGhost = await page.locator("[data-selection-toolbar]").count();
    /* Off the staff, and release there: a drag away must write nothing. */
    if (touch) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - 260, id: 1 }],
      });
      await page.waitForTimeout(120);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, y - 260);
      await page.waitForTimeout(120);
      await page.mouse.up();
    }
    await page.waitForTimeout(500);
  }
  /*
   * The third road a press can end by: cancelled, not released. A phone takes
   * the pointer away whenever a scroll wins or a call arrives, and an
   * abandoned gesture must abandon its preview too — with nothing written and
   * no ghost left on screen.
   */
  let ghostDuringCancel = 0;
  let ghostAfterCancel = 0;
  /*
   * Slot 9 of the first bar is the rest after the hammer/pull run. Slot 7 was
   * tried first and sits under the run: the pen refuses an occupied beat, so
   * there was never a ghost to abandon and the check proved nothing.
   */
  const cancelCell = await boxOf(page, "[data-cell='9:1']");
  if (cancelCell && touch) {
    const cx = cancelCell.x + cancelCell.width / 2;
    const cy = cancelCell.y + cancelCell.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cx, y: cy, id: 1 }],
    });
    await page.waitForTimeout(600);
    ghostDuringCancel = Number(
      (await page
        .locator("[data-pen-ghost]")
        .first()
        .getAttribute("data-pen-ghost")
        .catch(() => "0")) ?? "0",
    );
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.waitForTimeout(500);
    ghostAfterCancel = await page.locator("[data-pen-ghost]").count();
  }

  const songAfterGhost = await fixtureBytes(page);
  const selectionAfterGhost = await page.locator("[data-selection-toolbar]").count();
  const undoOffered = await page.evaluate(() => {
    const node = document.querySelector("[data-undo]");
    return node !== null && !node.hasAttribute("disabled");
  });
  small.push(...(await smallControls(page)));

  await tap(page, "ghost-ok");
  steps.push(await step(page));

  /* ---- step 5: a clean start, then every transport control ---- */
  const cleanStart = await page.evaluate(() => ({
    selection: document.querySelectorAll("[data-selection-toolbar]").length,
    doors: document.querySelectorAll("[data-composer-door]").length,
    held: document.querySelectorAll("[data-composer-door-held]").length,
  }));

  await clickLabel(page, "Çal");
  await page.waitForTimeout(1400);
  await clickLabel(page, "Duraklat");
  await page.waitForTimeout(600);
  await clickLabel(page, "Çal");
  await page.waitForTimeout(1200);
  await clickLabel(page, "Duraklat");
  await page.waitForTimeout(500);

  /*
   * Back to the start, and only then to the second bar. Playing for two and a
   * half seconds at 100bpm already carries the playhead into bar two, so a
   * "seek" issued from there moves nothing and is indistinguishable from a
   * seek that did not work.
   */
  await clickLabel(page, "Başa dön");
  await page.waitForTimeout(600);
  /*
   * The tab is scrolled right by now — the selection drag took it there — so
   * the second bar's header has to be brought into view before it can be
   * tapped, exactly as a reader would scroll to it. Without this the click
   * silently missed and the seek looked like a product failure.
   */
  const header = page.locator("[data-tab-bar-header]").nth(1);
  await header.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await header.click({ timeout: 3000, force: true }).catch(() => {});
  await page.waitForTimeout(700);
  const seekedTo = await page.evaluate(
    () => window.__aranjeDebug?.position()?.barIndex ?? -1,
  );

  await clickLabel(page, "Bölüm döngüsü");
  await page.waitForTimeout(500);

  /* The practice pill opens a sheet; one step down is enough. */
  await page
    .locator("[aria-label^='Çalışma hızı yüzde']")
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(500);
  await page
    .locator("button", { hasText: "−" })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(300);
  await page
    .locator("button", { hasText: "Uygula" })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  await clickLabel(page, "Başa dön");
  await page.waitForTimeout(600);

  overflow.push(await bodyOverflow(page));
  await tap(page, "transport-next");
  steps.push(await step(page));

  /* ---- step 6: the six listening answers ---- */
  for (let index = 0; index < 6; index += 1) {
    if (!(await tap(page, "listen-clear"))) break;
  }
  steps.push(await step(page));
  small.push(...(await smallControls(page)));

  /* ---- step 7: the block, the back trip and the copy ---- */
  const readResult = () =>
    page
      .locator("[data-acceptance-result]")
      .textContent()
      .catch(() => null);
  const atArrival = await readResult();
  const wentBack = await tap(page, "back");
  const steppedBack = await step(page);
  if (wentBack) await tap(page, "listen-clear");
  const returned = await step(page);
  const afterReturn = await readResult();

  await page.locator("[data-acceptance-note]").fill("harness notu");
  await page.waitForTimeout(250);
  const block = (await readResult()) ?? "";

  await tap(page, "copy");
  await page.waitForTimeout(300);
  const clipboard = await page
    .evaluate(() => navigator.clipboard.readText())
    .catch(() => "");

  const songAtEnd = await fixtureBytes(page);
  const readerAfter = await deviceStorage(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-acceptance-step]", { timeout: 20000 });
  const afterReload = await step(page);
  const readerAfterReload = await deviceStorage(page);

  await page.goto(BASE, { waitUntil: "networkidle" });
  const linked = await page.evaluate(
    () =>
      [...document.querySelectorAll("a[href], button[data-href]")].filter((node) =>
        (node.getAttribute("href") ?? node.getAttribute("data-href") ?? "").includes(
          "android-acceptance",
        ),
      ).length,
  );

  await context.close();

  const line = (prefix) =>
    block.split("\n").find((row) => row.startsWith(prefix))?.slice(prefix.length) ?? "";

  return {
    context: shape.name,
    touchEnvironment: shape.touch,
    userAgent: shape.ua ?? "desktop-chromium",
    sessionRefused: sessionRefused ?? null,
    stepsSeen: steps,
    stepsReachable: steps.join(",") === "0,1,2,3,4,5,6",

    /* §3 — the route's starting contract */
    tabOnArrival,
    arrangementOnArrival,
    stringsOnArrival,
    stringsVisible,

    /* §4/§10 — a real selection */
    editingAtSelect,
    selectionAfterPress,
    selectionCells,
    verbsShown,
    moreSheet,
    selectionAfterCancel,
    selectionLeftOpen,
    inheritedSelection,
    ghostDuringCancel,
    ghostAfterCancel,

    /* §5/§6 — the pen owns the press and writes nothing */
    penHeld: penArmed.trim(),
    ghostVoices,
    selectionDuringGhost,
    selectionAfterGhost,
    songUnchangedByGhost: songBefore !== "" && songBefore === songAfterGhost,
    songUnchangedOverall: songAtOpen !== "" && songAtOpen === songAtEnd,
    undoOffered,

    /* §4 — the listening step starts clean */
    cleanStart,

    /* §7 — the transport, as the block reports it */
    playPause: line("Play-pause: ").trim(),
    seek: line("Seek: ").trim(),
    loop: line("Loop: ").trim(),
    tempo: line("Tempo: ").trim(),
    rewind: line("Rewind: ").trim(),
    order: line("Transport sırası: ").trim(),
    seekedTo,
    ghostLine: line("Power ghost: ").trim(),
    mutationLine: line("Storage/history mutation: ").trim(),

    /* §8 — three verdicts */
    functional: line("Functional: ").trim(),
    listening: line("Listening: ").trim(),
    physical: line("Physical environment: ").trim(),
    overall: line("Overall: ").trim(),

    /* the flow itself */
    steppedBack,
    returned,
    backRestoresForward: wentBack && steppedBack === 5 && returned === 6,
    answersSurviveBack: atArrival !== null && atArrival === afterReturn,
    copyWorked: clipboard.startsWith("ARANJÉ ANDROID PHYSICAL ACCEPTANCE"),
    clipboardMatchesBlock: clipboard.trim() === block.trim(),
    noteInBlock: block.includes("User note: harness notu"),

    /* isolation and layout */
    readerStorageUnchanged: readerBefore === readerAfter,
    readerStorageUnchangedAfterReload: readerBefore === readerAfterReload,
    reloadReturnsToStart: afterReload === 0,
    routeLinkedFromApp: linked,
    permissionsAsked: permissions,
    offOriginRequests: [...new Set(offOrigin)],
    bodyOverflow: Math.max(...overflow),
    controlsUnder44: small,
    consoleErrors: errors,
  };
}

/** What has to hold for this harness to have found nothing. */
function gate(entry) {
  const bad = [];
  const need = (ok, why) => {
    if (!ok) bad.push(why);
  };

  need(entry.stepsReachable, `steps ${entry.stepsSeen.join(",")}`);
  need(!entry.sessionRefused, `session: ${entry.sessionRefused}`);

  /* §3 */
  need(entry.tabOnArrival, "route did not open on the tab");
  need(!entry.arrangementOnArrival, "arrangement was on screen");
  need(entry.stringsOnArrival === 6, `${entry.stringsOnArrival} strings drawn`);
  need(entry.stringsVisible === 6, `${entry.stringsVisible} strings visible`);

  /* §4 selection */
  need(entry.editingAtSelect, "selection step did not open the editor");
  need(entry.selectionAfterPress > 0, "long press opened no selection");
  need(entry.selectionCells >= 4, `selection covered ${entry.selectionCells} slots`);
  need(entry.verbsShown === 3, `${entry.verbsShown} verbs shown`);
  need(entry.moreSheet > 0, "more sheet did not open");
  need(entry.selectionAfterCancel === 0, "selection survived the cancel");
  need(entry.selectionLeftOpen > 0, "the harness failed to leave a selection open");
  need(entry.inheritedSelection === 0, "the next step inherited a selection");

  /* §5/§6 ghost */
  need(entry.penHeld.length > 0, "pen was not held at the ghost step");
  need(entry.ghostVoices === 3, `ghost showed ${entry.ghostVoices}/3 voices`);
  need(entry.selectionDuringGhost === 0, "a time selection opened under the pen");
  need(entry.selectionAfterGhost === 0, "an empty selection was left behind");
  need(entry.songUnchangedByGhost, "the ghost changed the song");
  /*
   * Nothing in the whole guided run may change the music. The ghost window is
   * the narrow version of this question; this is the wide one, and it is what
   * catches a write that happens at some other step entirely.
   */
  need(entry.songUnchangedOverall, "the guided run changed the song");
  need(!entry.undoOffered, "undo was offered after a preview");
  if (entry.touchEnvironment) {
    need(entry.ghostDuringCancel === 3, `cancel gesture drew ${entry.ghostDuringCancel}/3`);
  }
  need(entry.ghostAfterCancel === 0, "a cancelled press left its ghost behind");
  need(/yazma yok/.test(entry.ghostLine), `ghost line: ${entry.ghostLine}`);
  need(entry.mutationLine === "none", `mutation line: ${entry.mutationLine}`);

  /* §4 clean listening start */
  need(entry.cleanStart.selection === 0, "listening step inherited a selection");
  need(entry.cleanStart.held === 0, "listening step inherited a held tool");
  need(entry.cleanStart.doors === 0, "listening step opened in edit mode");

  /* §7 transport */
  need(entry.playPause === "PASS", `play-pause ${entry.playPause}`);
  need(entry.seek.startsWith("PASS"), `seek ${entry.seek}`);
  need(entry.loop === "PASS", `loop ${entry.loop}`);
  need(entry.tempo.startsWith("PASS"), `tempo ${entry.tempo}`);
  need(entry.rewind === "PASS", `rewind ${entry.rewind}`);

  /* §8 verdicts */
  need(entry.functional === "PASS", `functional ${entry.functional}`);
  need(entry.listening === "PASS", `listening ${entry.listening}`);
  need(entry.seekedTo === 1, `seek landed on bar index ${entry.seekedTo}`);
  /*
   * Only the context that is *both* Android and touch may reach a physical
   * PASS. The two mobile viewports without an Android user agent are phones
   * in size only, and the block must say so.
   */
  if (entry.userAgent.includes("Android")) {
    need(entry.physical.startsWith("PASS"), `physical ${entry.physical}`);
  } else if (entry.touchEnvironment) {
    need(
      entry.physical.startsWith("PARTIAL"),
      `non-Android context claimed physical ${entry.physical}`,
    );
  } else {
    /* The whole point of the desktop row: it must never claim a phone. */
    need(
      entry.physical.startsWith("PARTIAL"),
      `desktop claimed physical ${entry.physical}`,
    );
    need(entry.overall !== "PASS", "desktop reported an overall PASS");
  }

  /* the flow */
  need(entry.backRestoresForward, `back/forward ${entry.steppedBack}→${entry.returned}`);
  need(entry.answersSurviveBack, "answers lost on back");
  need(entry.noteInBlock, "the note never reached the block");
  need(entry.copyWorked, "copy did not reach the clipboard");
  need(entry.clipboardMatchesBlock, "clipboard differs from the block");

  /* isolation and layout */
  need(entry.readerStorageUnchanged, "reader storage mutated");
  need(entry.readerStorageUnchangedAfterReload, "reader storage mutated by the reload");
  need(entry.reloadReturnsToStart, `reload landed on step ${entry.reloadReturnsToStart}`);
  need(entry.routeLinkedFromApp === 0, "route linked from the app");
  need(entry.permissionsAsked.length === 0, `asked: ${entry.permissionsAsked.join("|")}`);
  need(
    entry.offOriginRequests.length === 0,
    `off-origin: ${entry.offOriginRequests.slice(0, 2).join("|")}`,
  );
  need(entry.bodyOverflow === 0, `body overflow ${entry.bodyOverflow}px`);
  need(
    entry.controlsUnder44.length === 0,
    `under 44: ${entry.controlsUnder44.map((c) => `${c.label} ${c.width}×${c.height}`).join(", ")}`,
  );
  need(
    entry.consoleErrors.length === 0,
    `console: ${entry.consoleErrors.slice(0, 2).join(" | ")}`,
  );
  return bad;
}

const browser = await chromium.launch();
const results = [];
for (const shape of CONTEXTS) {
  results.push(await run(browser, shape));
}
await browser.close();

const report = results.map((entry) => ({ ...entry, failures: gate(entry) }));
writeFileSync(`${OUT}/HARNESS.json`, `${JSON.stringify(report, null, 2)}\n`);

let red = 0;
for (const entry of report) {
  if (entry.failures.length === 0) {
    console.log(`PASS ${entry.context}`);
  } else {
    red += 1;
    console.log(`FAIL ${entry.context}: ${entry.failures.join("; ")}`);
  }
}
console.log(`\n${report.length - red}/${report.length} contexts clean`);
process.exit(red === 0 ? 0 : 1);
