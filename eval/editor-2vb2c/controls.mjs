/**
 * The two browser controls this round exists to make possible (2V-B.2c §3
 * steps 14 and 15).
 *
 * `acceptance.mjs` next door is the **positive** control: it performs every
 * step with real gestures on real production surfaces and requires all
 * thirteen to advance. This is the **negative** one, and it is the newer
 * half — because on `b039d9c` a run exactly like the one below reported
 * "Editör kanıtı geldi." on step 1 to a reader who had touched nothing, and
 * eight steps' worth of the same.
 *
 * Three runs, each a different way of getting something for nothing:
 *
 * 1. **Idle.** Load the round, touch nothing, look at step 1.
 * 2. **Answers only.** Answer every question on the screen as well as it can
 *    be answered, and press "Sonraki adım".
 * 3. **Restart.** Do step 1 for real, then press "Baştan başla" and check
 *    that what comes back is a new round rather than the old one with its
 *    counters zeroed.
 *
 * Usage:  SHA=<short sha> node eval/editor-2vb2c/controls.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const checks = [];
let failures = 0;
const check = (name, pass, detail = "") => {
  checks.push({ name, pass, detail });
  if (!pass) failures += 1;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const wait = (page, ms) => page.waitForTimeout(ms);

const screenState = (page) =>
  page.evaluate(() => ({
    step: document.querySelector("[data-batch-step]")?.textContent ?? "",
    session: document.querySelector("[data-batch-session]")?.textContent ?? "",
    evidence:
      document
        .querySelector("[data-batch-evidence]")
        ?.getAttribute("data-batch-evidence") ?? "",
    shortfall: document.querySelector("[data-batch-evidence]")?.textContent ?? "",
    checklist: [...document.querySelectorAll("[data-batch-evidence-item]")].map((node) =>
      node.getAttribute("data-batch-evidence-item"),
    ),
    hint: document.querySelector("[data-batch-hint]")?.textContent ?? "",
    nextDisabled:
      document.querySelector("[data-batch-action='next']")?.hasAttribute("disabled") ??
      null,
    states:
      document
        .querySelector("[data-batch-measured]")
        ?.getAttribute("data-batch-measured") ?? "{}",
    counter: document.querySelector("[data-batch-measured]")?.textContent ?? "",
  }));

/** Answer every question the screen asks, with the option that is not broken. */
async function answerAll(page) {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-batch-answer]")].map((node) =>
      node.getAttribute("data-batch-answer"),
    ),
  );
  const seen = new Set();
  for (const id of ids) {
    const question = id.split(":")[0];
    if (seen.has(question)) continue;
    seen.add(question);
    await page
      .locator(`[data-batch-answer='${id}']`)
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await wait(page, 80);
  }
  return seen.size;
}

async function openRound(context, sha) {
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(`${BASE}/eval/editor-action-batch?sha=${sha}`, {
    waitUntil: "networkidle",
  });
  await wait(page, 900);
  await toTask(page);
  return { page, consoleErrors };
}

/* ------------------------------------------------------------ the gestures */

async function staffSpot(page, barIndex = 0, slots = 4, fromSlot = 0) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const spot = await page.evaluate(
      ({ barIndex, slots, fromSlot }) => {
        const width = window.innerWidth;
        const node = document.querySelector(`[data-bar-drag-index="${barIndex}"]`);
        if (!node) return { found: false };
        const box = node.getBoundingClientRect();
        const start = box.left + 17 + 34 * fromSlot;
        const end = start + 34 * slots;
        if (start < 8 || end > width - 6) {
          let scroller = node.parentElement;
          while (scroller && scroller.scrollWidth <= scroller.clientWidth) {
            scroller = scroller.parentElement;
          }
          if (scroller) {
            scroller.scrollLeft += start - width / 6;
            return { found: true, scrolled: true };
          }
          return { found: true, scrolled: false };
        }
        const lines = [...document.querySelectorAll("[data-string-line]")]
          .map((line) => {
            const at = line.getBoundingClientRect();
            return at.top + at.height / 2;
          })
          .sort((a, b) => a - b);
        for (const y of lines) {
          const hit = document.elementFromPoint(start, y);
          if (hit && hit.closest("[data-tab-content]")) return { found: true, x: start, y, width };
        }
        return { found: true };
      },
      { barIndex, slots, fromSlot },
    );
    if (!spot.found) return null;
    if (typeof spot.x === "number") return spot;
    await wait(page, 300);
  }
  return null;
}

/**
 * The question screen.
 *
 * Named and used everywhere rather than assumed: the round shows the song
 * after every advance, and a check that read the gate without coming back
 * here would be reading an empty document and calling it evidence — which is
 * the family of mistake this whole runner is about.
 */
async function toTask(page) {
  await page.locator("[data-batch-action='to-task']").first().click().catch(() => {});
  await wait(page, 450);
}

async function toSong(page) {
  await page.locator("[data-batch-action='to-song']").first().click().catch(() => {});
  await wait(page, 350);
  await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
  await page.waitForSelector("[data-tab-content]").catch(() => {});
  await wait(page, 400);
}

/** Step 1, done for real: select, arm "Devam", reach the end forward. */
async function performExtend(page) {
  await toSong(page);
  const spot = await staffSpot(page, 0, 2);
  if (spot === null) return false;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await wait(page, 750);
  await page.mouse.move(Math.min(spot.x + 68, spot.width - 6), spot.y, { steps: 8 });
  await page.mouse.up();
  await wait(page, 350);
  const extend = page.locator("[data-selection-action-id='extend']").first();
  if (await extend.count()) {
    await extend.click({ timeout: 4000 }).catch(() => {});
    await wait(page, 400);
  }
  const far = await staffSpot(page, 0, 6);
  if (far) {
    await page.mouse.move(Math.min(far.x + 34 * 6, far.width - 6), far.y);
    await page.mouse.down();
    await wait(page, 750);
    await page.mouse.up();
    await wait(page, 400);
  }
  await toTask(page);
  return true;
}

/* ------------------------------------------------------------- the controls */

async function idleRun(context, sha, index) {
  const { page, consoleErrors } = await openRound(context, sha);
  const state = await screenState(page);
  const tag = `idle#${index}`;
  check(
    `${tag}: a step nobody touched reports no evidence`,
    state.evidence === "missing",
    state.shortfall.trim(),
  );
  check(
    `${tag}: "Sonraki adım" is drawn disabled`,
    state.nextDisabled === true,
    `disabled=${state.nextDisabled}`,
  );
  check(
    `${tag}: every checklist line is unticked`,
    state.checklist.length > 0 && state.checklist.every((line) => line.endsWith(":no")),
    state.checklist.join(", "),
  );
  check(
    `${tag}: the gate names this step, not "an event"`,
    state.shortfall.includes("bu adıma ait kanıt gelmedi"),
    state.shortfall.trim(),
  );
  check(
    `${tag}: nothing is counted as measured`,
    state.states === "{}" && state.counter.includes("0/13"),
    `${state.states} · ${state.counter.trim()}`,
  );

  /* And answering does not change any of that. */
  const answered = await answerAll(page);
  const afterAnswers = await screenState(page);
  check(
    `${tag}: answering every question passes nothing`,
    answered > 0 &&
      afterAnswers.evidence === "missing" &&
      afterAnswers.nextDisabled === true,
    `answered=${answered} evidence=${afterAnswers.evidence} disabled=${afterAnswers.nextDisabled}`,
  );
  await page
    .locator("[data-batch-action='next']")
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await wait(page, 500);
  const afterPress = await screenState(page);
  check(
    `${tag}: pressing the disabled button does not advance`,
    afterPress.step === state.step,
    `${state.step.trim()} → ${afterPress.step.trim()}`,
  );

  /* End honestly, and read what the round hands back. */
  await toTask(page);
  await page
    .locator("[data-batch-action='end-early']")
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await wait(page, 800);
  const block = await page.evaluate(
    () => document.querySelector("[data-batch-result]")?.textContent ?? "",
  );
  check(`${tag}: the result is BLOCKED`, block.includes("Verdict: BLOCKED"), "");
  check(
    `${tag}: no step claims its evidence arrived`,
    block.includes("eylem kanıtı: geldi") === false,
    "",
  );
  const untried = (block.match(/eylem kanıtı: denenmedi/g) ?? []).length;
  const notNeeded = (block.match(/eylem kanıtı: gerekmiyor/g) ?? []).length;
  check(
    `${tag}: every acting step is reported as never attempted`,
    /* Twelve steps ask for a gesture; the thirteenth asks only a question. */
    untried === 12 && notNeeded === 1,
    `denenmedi=${untried} gerekmiyor=${notNeeded}`,
  );
  check(
    `${tag}: no hearing is reported, because nobody was asked`,
    block.includes("İkinci enstrüman duyuldu: ölçülmedi"),
    "",
  );
  check(
    `${tag}: the block does not contradict itself`,
    block.includes("Tutarsızlık:") === false,
    "",
  );
  check(`${tag}: console errors is 0`, consoleErrors.length === 0, consoleErrors.join(" | "));
  await page.close();
}

async function restartRun(context, sha) {
  const { page } = await openRound(context, sha);
  const first = await screenState(page);
  const performed = await performExtend(page);
  const done = await screenState(page);
  check(
    "restart: step 1 really was performed first",
    performed && done.evidence === "ready",
    `${done.evidence} · ${done.shortfall.trim()}`,
  );

  /*
   * Walk forward until a step will not complete, which is the only place
   * "Burada bitir" is offered — a reader whose evidence is in is asked to
   * finish the step, not to abandon it. Step 3 wants a real audition, and
   * this runner deliberately performs none.
   */
  for (let index = 0; index < 3; index += 1) {
    await toTask(page);
    if ((await page.locator("[data-batch-action='end-early']").count()) > 0) break;
    await answerAll(page);
    await page.locator("[data-batch-action='next']").first().click().catch(() => {});
    await wait(page, 600);
  }
  await toTask(page);
  const beforeRestart = await screenState(page);
  check(
    "restart: the round really had measured something before it restarted",
    beforeRestart.states.includes("\"extend\""),
    beforeRestart.states,
  );
  await page.locator("[data-batch-action='end-early']").first().click().catch(() => {});
  await wait(page, 700);
  await page.locator("[data-batch-action='restart']").first().click().catch(() => {});
  await wait(page, 900);
  await toTask(page);

  const fresh = await screenState(page);
  check(
    "restart: the round comes back at step 1 with nothing measured",
    fresh.states === "{}" && fresh.counter.includes("0/13"),
    `${fresh.states} · ${fresh.counter.trim()}`,
  );
  check(
    "restart: it comes back at step 1 itself",
    fresh.step.includes("1/13"),
    fresh.step.trim(),
  );
  /*
   * The transition, specifically. A selection the reader is still holding is
   * real and is reported — the editor is not reset, and it must not be — but
   * "the end moved forward" happened in the abandoned attempt, and a round
   * that inherited it would let one gesture pay for two runs (§2 rule 7).
   */
  check(
    "restart: last run's extension is not inherited",
    fresh.evidence === "missing" &&
      fresh.checklist.includes("extended:no") &&
      fresh.nextDisabled === true,
    `${fresh.evidence} · ${fresh.checklist.join(", ")}`,
  );
  check(
    "restart: it is a new session, so a stale event cannot satisfy it",
    fresh.session !== "" && fresh.session !== first.session,
    `${first.session} → ${fresh.session}`,
  );
  await page.close();
}

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }
  const runs = Number(process.env.RUNS ?? "10");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 384, height: 692 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: ANDROID,
  });

  for (let index = 1; index <= runs; index += 1) await idleRun(context, sha, index);
  await restartRun(context, sha);

  await browser.close();
  const passed = checks.length - failures;
  writeFileSync(
    `${OUT}CONTROLS.json`,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sha,
        idleRuns: runs,
        passed,
        failed: failures,
        checks,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n${passed}/${checks.length} checks · ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
