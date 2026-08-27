/**
 * The guided Android route, verified before anyone is asked to open it (§8).
 *
 * This proves the *harness*, not the phone. Everything a desktop Chromium can
 * be honest about is measured here — every step reachable, back and forward
 * navigation, a complete result block, a working copy button, not one byte
 * written to the reader's own storage, the route absent from ordinary
 * navigation, no console error, no body overflow, no control under 44×44 —
 * and everything that genuinely needs a physical device is left for the
 * physical device.
 *
 * Three contexts, because the two things that break a guided flow are a small
 * screen and a mobile user agent:
 *
 *   320×700  the narrowest screen the product is measured at
 *   390×844  the ordinary phone
 *   412×915  the same flow behind an Android Chrome user agent
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
  { name: "320x700", viewport: { width: 320, height: 700 } },
  { name: "390x844", viewport: { width: 390, height: 844 } },
  { name: "412x915-android-ua", viewport: { width: 412, height: 915 }, ua: ANDROID_UA },
];

/**
 * The reader's own music, on the device before the test opens.
 *
 * Without this the storage proof would be vacuous: an empty `localStorage`
 * cannot be shown to have survived anything.
 */
const READER_STORAGE = device(fixture("techniques"));

async function boot(browser, shape) {
  const context = await browser.newContext({
    viewport: shape.viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
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
  /* A permission asked for is a permission this route must not need (§3). */
  const permissions = [];
  page.on("dialog", (dialog) => {
    permissions.push(dialog.message());
    dialog.dismiss().catch(() => undefined);
  });
  /* Any request off this origin is a provider call or a tracker (§3). */
  const offOrigin = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(BASE) && !request.url().startsWith("data:")) {
      offOrigin.push(request.url());
    }
  });
  return { context, page, errors, permissions, offOrigin };
}

const step = (page) =>
  page.evaluate(() =>
    Number(document.querySelector("[data-acceptance-step]")?.getAttribute("data-acceptance-step") ?? -1),
  );

/**
 * Tap a control, or report that it was not there.
 *
 * Returns false rather than throwing, because a missing control is the exact
 * thing several probes remove — and a harness that crashes on the mutation it
 * was built to catch exits non-zero for the wrong reason, which is
 * indistinguishable from a broken build.
 */
const tap = async (page, id) => {
  const button = page.locator(`[data-acceptance-action='${id}']`).first();
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.click();
  await page.waitForTimeout(150);
  return true;
};

/** Every control on screen, and the smallest box any of them occupies. */
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

/**
 * What the reader's device holds, computed from the seed rather than read
 * back from the page.
 *
 * The obvious version — snapshot on arrival, snapshot at the end — was
 * vacuous, and the probe caught it: the route installs its storage while it
 * mounts, so a write made *during* that mount was already in the "before"
 * picture and compared equal to itself. The seed is deterministic, so the
 * baseline is arithmetic, and anything the page adds, removes or edits shows
 * up as a difference.
 */
const seededBaseline = () =>
  JSON.stringify(
    Object.keys(READER_STORAGE)
      .sort()
      .map((key) => [key, READER_STORAGE[key]]),
  );

const storageSnapshot = (page) =>
  page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      keys.push(localStorage.key(index));
    }
    keys.sort();
    return JSON.stringify(keys.map((key) => [key, localStorage.getItem(key)]));
  });

/**
 * Walk all seven steps the way the reader is told to.
 *
 * Stops at the first control that is not there, so the step list itself
 * records how far a reader could actually get.
 */
async function walkForward(page, record) {
  for (const id of [
    "start",
    "visual-ok",
    "selection-next",
    "ghost-ok",
    "transport-next",
  ]) {
    if (!(await tap(page, id))) return false;
    record.push({ at: await step(page), small: await smallControls(page) });
  }

  /* Six listening questions, one screen each. */
  for (let index = 0; index < 6; index += 1) {
    if (!(await tap(page, "listen-clear"))) return false;
  }
  record.push({ at: await step(page), small: await smallControls(page) });
  return true;
}

async function run(browser, shape) {
  const { context, page, errors, permissions, offOrigin } = await boot(browser, shape);
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-acceptance-step]", { timeout: 20000 });

  const readerBefore = seededBaseline();
  const sessionRefused = await page
    .locator("[role='alert']")
    .first()
    .textContent()
    .catch(() => null);

  const seen = [];
  const overflow = [];
  overflow.push(await bodyOverflow(page));
  const steps = [await step(page)];

  const walked = await walkForward(page, seen);
  for (const entry of seen) steps.push(entry.at);
  overflow.push(await bodyOverflow(page));

  const readResult = () =>
    page
      .locator("[data-acceptance-result]")
      .textContent()
      .catch(() => null);

  /* Back, then forward again: the answers must survive the round trip. */
  const resultAtFirstArrival = walked ? await readResult() : null;
  const wentBack = walked ? await tap(page, "back") : false;
  const steppedBack = await step(page);
  if (wentBack) await tap(page, "listen-clear");
  const returned = await step(page);
  const resultAfterReturn = wentBack ? await readResult() : null;

  /* The note is part of the result, so typing into it must reach the block. */
  if (walked) {
    await page.locator("[data-acceptance-note]").fill("harness notu");
    await page.waitForTimeout(200);
  }
  const withNote = walked ? await readResult() : null;

  const copied = walked ? await tap(page, "copy") : false;
  await page.waitForTimeout(250);
  const clipboard = copied
    ? await page.evaluate(() => navigator.clipboard.readText()).catch(() => "")
    : "";
  const copyLabel = copied
    ? await page.locator("[data-acceptance-action='copy']").textContent()
    : "";

  const readerAfter = await storageSnapshot(page);

  /* A refresh must return a clean start, not a half-finished test (§3). */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-acceptance-step]", { timeout: 20000 });
  const afterReload = await step(page);
  const readerAfterReload = await storageSnapshot(page);

  /* The route must not be reachable from the app the reader normally opens. */
  await page.goto(BASE, { waitUntil: "networkidle" });
  const linked = await page.evaluate(() =>
    [...document.querySelectorAll("a[href], button[data-href]")].filter((node) =>
      (node.getAttribute("href") ?? node.getAttribute("data-href") ?? "").includes(
        "android-acceptance",
      ),
    ).length,
  );

  await context.close();

  const smallest = seen.flatMap((entry) => entry.small);
  const lines = (withNote ?? "").split("\n");

  return {
    context: shape.name,
    userAgent: shape.ua ?? "desktop-chromium",
    stepsSeen: steps,
    stepsReachable: steps.join(",") === "0,1,2,3,4,5,6",
    sessionRefused: sessionRefused ?? null,
    steppedBack,
    returned,
    backRestoresForward: wentBack && steppedBack === 5 && returned === 6,
    answersSurviveBack:
      resultAtFirstArrival !== null && resultAtFirstArrival === resultAfterReturn,
    resultLines: lines.length,
    resultComplete:
      lines[0] === "ARANJÉ ANDROID PHYSICAL ACCEPTANCE" &&
      ["HO/PO", "Slide", "Bend ½", "Bend 1", "Vibrato", "Palm mute"].every((title) =>
        lines.some((line) => line.startsWith(`${title}:`)),
      ) &&
      lines.some((line) => line.startsWith("Overall: ")) &&
      lines.some((line) => line === "User note: harness notu"),
    copyWorked: clipboard.startsWith("ARANJÉ ANDROID PHYSICAL ACCEPTANCE"),
    copyLabel: (copyLabel ?? "").trim(),
    clipboardMatchesBlock: clipboard.trim() === (withNote ?? "").trim(),
    readerStorageUnchanged: readerBefore === readerAfter,
    readerStorageUnchangedAfterReload: readerBefore === readerAfterReload,
    reloadReturnsToStart: afterReload === 0,
    routeLinkedFromApp: linked,
    permissionsAsked: permissions,
    offOriginRequests: [...new Set(offOrigin)],
    bodyOverflow: Math.max(...overflow),
    controlsUnder44: smallest,
    consoleErrors: errors,
  };
}

/**
 * What has to hold for this harness to have found nothing.
 *
 * Written as a list so a mutation can be traced to the sentence it broke,
 * rather than to a boolean that says only "red".
 */
function gate(entry) {
  const failures = [];
  if (!entry.stepsReachable) failures.push(`steps ${entry.stepsSeen.join(",")}`);
  if (entry.sessionRefused) failures.push(`session: ${entry.sessionRefused}`);
  if (!entry.backRestoresForward) {
    failures.push(`back/forward ${entry.steppedBack}→${entry.returned}`);
  }
  if (!entry.answersSurviveBack) failures.push("answers lost on back");
  if (!entry.resultComplete) failures.push(`result incomplete (${entry.resultLines} lines)`);
  if (!entry.copyWorked) failures.push("copy did not reach the clipboard");
  if (!entry.clipboardMatchesBlock) failures.push("clipboard differs from the block");
  if (!entry.readerStorageUnchanged) failures.push("reader storage mutated");
  if (!entry.readerStorageUnchangedAfterReload) {
    failures.push("reader storage mutated by the reload");
  }
  if (!entry.reloadReturnsToStart) failures.push(`reload landed on step ${entry.reloadReturnsToStart}`);
  if (entry.routeLinkedFromApp > 0) failures.push("route linked from the app");
  if (entry.permissionsAsked.length > 0) failures.push(`asked: ${entry.permissionsAsked.join("|")}`);
  if (entry.offOriginRequests.length > 0) {
    failures.push(`off-origin: ${entry.offOriginRequests.slice(0, 2).join("|")}`);
  }
  if (entry.bodyOverflow > 0) failures.push(`body overflow ${entry.bodyOverflow}px`);
  if (entry.controlsUnder44.length > 0) {
    failures.push(
      `under 44: ${entry.controlsUnder44
        .map((c) => `${c.label} ${c.width}×${c.height}`)
        .join(", ")}`,
    );
  }
  if (entry.consoleErrors.length > 0) {
    failures.push(`console: ${entry.consoleErrors.slice(0, 2).join(" | ")}`);
  }
  return failures;
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
