/**
 * The whole round, driven through the real route (2V-B.1 §17).
 *
 * Every step is done the way a guitarist would do it: a long press on the
 * staff, a press on a production control, a press on the transport. Nothing
 * is mounted directly, no pure model is called, and no acceptance-only
 * control does what a production control does.
 *
 * The strongest thing this runner proves is structural rather than musical.
 * "Sonraki adım" is drawn **disabled** until the production workspace has
 * published the event the step asked for and the founder's question has been
 * answered; so a run that walks all thirteen screens is a run in which every
 * writing step really happened, in the editor, and was really observed. A
 * harness that pressed a button and moved on could not produce that.
 *
 * What it cannot do is listen. Every question about sound is answered here
 * with a placeholder so the walk can continue, and the artifact records that
 * plainly: `browserEmulation: true`, and the verdict is data rather than an
 * acceptance. The founder's ear is the only thing that closes this round.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const ROUTE = `${BASE}/eval/editor-action-batch`;
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

/** The record, as the read-only acceptance window reports it. */
const fixture = (page) =>
  page.evaluate(() => ({
    bytes: window.__aranjeAcceptance?.bytes() ?? null,
    revision: window.__aranjeAcceptance?.revision() ?? null,
  }));

const deviceStore = (page) =>
  page.evaluate(() => {
    const out = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null) out[key] = window.localStorage.getItem(key) ?? "";
    }
    return out;
  });

const transport = (page) =>
  page.evaluate(() => ({
    status: window.__aranjeDebug?.status?.() ?? null,
    ticks: window.__aranjeDebug?.ticks?.() ?? null,
    loop: window.__aranjeDebug?.loop?.() ?? null,
    selection: window.__aranjeDebug?.selection?.() ?? null,
  }));

/**
 * Where on the staff a finger can land, in the bar that was asked for.
 *
 * A 4/4 bar at 1/16 is 544 px wide and the founder's screen is 384, so
 * "wait for a fully visible bar" finds none — the mistake the first version
 * of this runner made, which then reported every write step as evidence that
 * never arrived. What is needed is a *point* inside the bar that is on
 * screen, and the tab is scrolled until there is one.
 */
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
          /* Bring it into view through the tab's own scroller, the way a
             reader's own drag would. */
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
          if (hit && hit.closest("[data-tab-content]")) {
            return { found: true, x: start, y, width };
          }
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

async function select(page, { slots = 4, bar = 0, fromSlot = 0 } = {}) {
  const spot = await staffSpot(page, bar, slots, fromSlot);
  if (spot === null) return false;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await wait(page, 750);
  if (slots > 0) {
    await page.mouse.move(Math.min(spot.x + 34 * slots, spot.width - 6), spot.y, {
      steps: 8,
    });
    await wait(page, 180);
  }
  await page.mouse.up();
  await wait(page, 340);
  return (await page.locator("[data-testid=selection-action-bar]").count()) > 0;
}

/**
 * A long press on the bar **heading**, then the whole-instrument scope (11B).
 *
 * The header strip, not the staff underneath it: the bar-range gesture is
 * attached to the block but only the header starts it, so a press in the
 * middle of the block makes an ordinary note selection — which is how the
 * first version of this runner measured the same filter twice and reported
 * two scopes that were really one.
 */
async function selectMeasure(page) {
  const spot = await page.evaluate(() => {
    const width = window.innerWidth;
    for (const node of document.querySelectorAll("[data-bar-drag-index]")) {
      const box = node.getBoundingClientRect();
      if (box.right < 24 || box.left > width - 24) continue;
      const x = Math.max(16, Math.min(box.left + box.width / 2, width - 16));
      return { x, y: box.top + 10 };
    }
    return null;
  });
  if (spot === null) return false;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await wait(page, 800);
  await page.mouse.up();
  await wait(page, 400);
  if ((await page.locator("[data-bar-action-bar]").count()) === 0) return false;
  /* "Tüm enstrümanlar": the scope that contains both audible tracks, which
     is what makes 11B a different question from 11A rather than the same
     one asked twice. */
  const full = page.locator("[data-bar-scope='full']").first();
  if (await full.count()) {
    await full.click({ timeout: 4000 }).catch(() => {});
    await wait(page, 350);
  }
  return true;
}

const act = async (page, id) => {
  const button = page.locator(`[data-selection-action-id='${id}']`).first();
  if (!(await button.count())) return false;
  await button.click({ timeout: 4000 }).catch(() => {});
  await wait(page, 420);
  return true;
};

const drawerAct = async (page, id) => {
  if (!(await act(page, "more"))) return false;
  const item = page.locator(`[role=dialog] [data-selection-action-id='${id}']`).first();
  if (!(await item.count())) return false;
  await item.click({ timeout: 4000 }).catch(() => {});
  await wait(page, 500);
  return true;
};

const pressNamed = async (page, name) => {
  const button = page.getByRole("button", { name, exact: true }).first();
  if (!(await button.count())) return false;
  await button.click({ timeout: 4000 }).catch(() => {});
  await wait(page, 420);
  return true;
};

/** Press the sheet's own apply, whichever sheet is open. */
const applySheet = async (page) => {
  const apply = page.getByRole("button", { name: "Uygula", exact: true }).first();
  if (!(await apply.count())) return false;
  await apply.click({ timeout: 4000 }).catch(() => {});
  await wait(page, 500);
  return true;
};

const undo = (page) =>
  page
    .locator("button[aria-label^='Geri al']")
    .first()
    .click({ timeout: 4000 })
    .then(() => wait(page, 450))
    .then(() => true)
    .catch(() => false);

const redo = (page) =>
  page
    .locator("button[aria-label^='Yinele']")
    .first()
    .click({ timeout: 4000 })
    .then(() => wait(page, 450))
    .then(() => true)
    .catch(() => false);

/**
 * Try each way of doing a write until the record actually moves.
 *
 * The song accumulates across the round — every write step now ends with an
 * undo *and* a redo, so its edit stays — and a repeat or a paste into a bar
 * that filled up two steps ago is refused, correctly, by the production
 * command. A founder in that position tries somewhere else; so does this.
 *
 * A refused attempt writes nothing, so it leaves no state in the step's trace
 * and cannot make an atomic write look like two.
 */
async function untilWritten(page, attempts) {
  for (const attempt of attempts) {
    const before = await fixture(page);
    await attempt();
    await closeSheets(page);
    const after = await fixture(page);
    if (after.revision !== before.revision) return true;
  }
  return false;
}

/** Close whatever production sheet is open, without leaving the round. */
async function closeSheets(page) {
  for (let index = 0; index < 3; index += 1) {
    if ((await page.locator("[role=dialog]").count()) === 0) return;
    await page.keyboard.press("Escape").catch(() => {});
    await wait(page, 250);
  }
}

/** Answer every question this screen asks, with the option that is not the
 *  broken one. The harness has no ear; this is a placeholder, recorded. */
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
    await wait(page, 90);
  }
  return seen.size;
}

/** What the question screen is showing about this step. */
const screenState = (page) =>
  page.evaluate(() => ({
    step: document.querySelector("[data-batch-step]")?.textContent ?? "",
    task: document.querySelector("[data-batch-task]")?.textContent ?? "",
    evidence:
      document.querySelector("[data-batch-evidence]")?.getAttribute("data-batch-evidence") ??
      "",
    refused: document.querySelector("[data-batch-refused]")?.textContent ?? "",
    shortfall: document.querySelector("[data-batch-evidence]")?.textContent ?? "",
    nextDisabled:
      document.querySelector("[data-batch-action='next']")?.hasAttribute("disabled") ??
      null,
    measured:
      document.querySelector("[data-batch-measured]")?.getAttribute("data-batch-measured") ??
      "{}",
  }));

/** The song screen: do the step, then go and answer it. */
async function doStep(page, id, run) {
  await page.locator("[data-batch-action='to-song']").first().click().catch(() => {});
  await wait(page, 350);
  const before = await fixture(page);
  const extra = (await run()) ?? {};
  await closeSheets(page);
  await page.locator("[data-batch-action='to-task']").first().click().catch(() => {});
  await wait(page, 400);
  const beforeAnswer = await screenState(page);
  const answered = await answerAll(page);
  const ready = await screenState(page);
  /* Press "Sonraki adım". It is drawn disabled until the production evidence
     and the answer are both in, so a step that has not really happened
     simply does not move — which is the check, not the click. */
  await page
    .locator("[data-batch-action='next']")
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await wait(page, 600);
  const state = await screenState(page);
  const after = await fixture(page);
  return { id, before, after, answered, beforeAnswer, ready, state, ...extra };
}

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required.");
    process.exit(2);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 384, height: 692 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: ANDROID,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  /* A reader who has already used the app: their own project is in the store. */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.setItem("aranje.sentinel", "the reader's own");
  });
  await wait(page, 700);
  const deviceBefore = await deviceStore(page);

  await page.goto(`${ROUTE}?sha=${sha}`, { waitUntil: "networkidle" });
  await wait(page, 600);
  await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
  await page.waitForSelector("[data-tab-content]").catch(() => {});
  await wait(page, 400);

  const opened = await page.evaluate(() => ({
    sha: document.querySelector("[data-batch-sha]")?.textContent ?? "",
    session: document.querySelector("[data-batch-session]")?.textContent ?? "",
    song: document.querySelector("[data-batch-song]")?.textContent ?? "",
    fingerprint: document.querySelector("[data-batch-fingerprint]")?.textContent ?? "",
    blocked: document.querySelector("[data-batch-blocked]") !== null,
  }));
  check("the route started on the build the link named", !opened.blocked, JSON.stringify(opened));

  const fixtureStart = await fixture(page);
  const steps = [];
  const evidence = { pauseResume: null, loop: null, scopes: {} };

  /* 1 · Devam */
  steps.push(
    await doStep(page, "extend", async () => {
      await select(page, { slots: 2 });
      await act(page, "extend");
      const spot = await staffSpot(page, 0, 6);
      if (spot) {
        await page.mouse.move(Math.min(spot.x + 34 * 6, spot.width - 6), spot.y);
        await page.mouse.down();
        await wait(page, 750);
        await page.mouse.up();
        await wait(page, 350);
      }
    }),
  );

  /* 2 · Daha fazla */
  steps.push(
    await doStep(page, "openMore", async () => {
      await select(page, { slots: 4 });
      await act(page, "more");
      const listens = await page.evaluate(() =>
        [
          ...document.querySelectorAll("[role=dialog] [data-selection-action-id]"),
        ].map((node) => node.getAttribute("data-selection-action-id")),
      );
      check(
        "the drawer offers both listening actions",
        listens.includes("listen_once") && listens.includes("listen_loop"),
        listens.join(", "),
      );
    }),
  );

  /* 3 · Seçimi dinle */
  steps.push(
    await doStep(page, "listenOnce", async () => {
      await select(page, { slots: 4 });
      await drawerAct(page, "listen_once");
      const heard = await transport(page);
      await wait(page, 900);
      return { transport: heard };
    }),
  );

  /* 4 · Seçimden döngü, then close it */
  steps.push(
    await doStep(page, "listenLoop", async () => {
      await select(page, { slots: 4 });
      await drawerAct(page, "listen_loop");
      await wait(page, 1400);
      const looping = await transport(page);
      await drawerAct(page, "listen_loop");
      await wait(page, 600);
      const after = await transport(page);
      evidence.loop = { looping, after };
      check(
        "the loop is running while it is on",
        looping.loop !== null && looping.loop.on === true,
        JSON.stringify(looping.loop),
      );
      check(
        "closing the loop stops it, synchronously and completely",
        after.loop === null || after.loop.on === false,
        JSON.stringify(after),
      );
      return {};
    }),
  );

  /* 5 · Duraklat / devam et */
  steps.push(
    await doStep(page, "pauseResume", async () => {
      /*
       * The whole song, through the production transport, rather than a
       * selection loop. A loop's playhead wraps, so "did it carry on from
       * where it stopped" is modular arithmetic on a 48-tick window and
       * cannot be read off two samples; over the six bars of the fixture the
       * question has a plain answer.
       */
      await pressNamed(page, "Çal");
      await wait(page, 1500);
      const playing = await transport(page);
      await pressNamed(page, "Duraklat");
      const paused = await transport(page);
      await wait(page, 500);
      const stillPaused = await transport(page);
      await pressNamed(page, "Çal");
      await wait(page, 400);
      const resumed = await transport(page);
      await pressNamed(page, "Duraklat");
      evidence.pauseResume = { playing, paused, stillPaused, resumed };
      check(
        "the playhead does not move while paused",
        paused.ticks !== null && paused.ticks === stillPaused.ticks,
        `${paused.ticks} → ${stillPaused.ticks}`,
      );
      check(
        "resuming carries on from the tick it was paused at",
        resumed.ticks !== null &&
          stillPaused.ticks !== null &&
          resumed.ticks > stillPaused.ticks,
        `${stillPaused.ticks} → ${resumed.ticks}`,
      );
      check(
        "the transport really was playing before the pause",
        playing.status === "playing" && (playing.ticks ?? 0) > 0,
        JSON.stringify(playing),
      );
      return {};
    }),
  );

  /* 6 · Kopyala, yapıştır, geri al, ileri al */
  steps.push(
    await doStep(page, "copyPaste", async () => {
      await select(page, { slots: 4, bar: 0 });
      await act(page, "copy");
      const pasted = await untilWritten(page, [
        async () => {
          await select(page, { slots: 4, bar: 1 });
          /* "Yapıştır" lives in the drawer, not on the row: the canon puts
             the four sheet-opening actions there and the row carries the
             rest. */
          await drawerAct(page, "paste");
          await applySheet(page);
        },
        async () => {
          await select(page, { slots: 4, bar: 3 });
          await drawerAct(page, "paste");
          await applySheet(page);
        },
      ]);
      check("the paste landed somewhere free", pasted, "");
      await undo(page);
      await redo(page);
    }),
  );

  /* 7 · Çoğalt */
  steps.push(
    await doStep(page, "duplicate", async () => {
      const done = await untilWritten(page, [
        async () => {
          await select(page, { slots: 2, bar: 0 });
          await act(page, "duplicate");
        },
        async () => {
          await select(page, { slots: 2, bar: 2 });
          await act(page, "duplicate");
        },
      ]);
      check("the duplicate landed", done, "");
      await undo(page);
      await redo(page);
    }),
  );

  /* 8 · Taşı */
  steps.push(
    await doStep(page, "move", async () => {
      const nudge = async (bar) => {
        await select(page, { slots: 2, bar });
        await act(page, "move");
        await page
          .locator("[data-testid^='nudge-right-']")
          .first()
          .click({ timeout: 4000 })
          .catch(() => {});
        await wait(page, 300);
        await applySheet(page);
      };
      const done = await untilWritten(page, [
        () => nudge(0),
        () => nudge(2),
        () => nudge(4),
      ]);
      check("the move landed", done, "");
      await undo(page);
      await redo(page);
    }),
  );

  /* 9 · Tekrarla */
  steps.push(
    await doStep(page, "repeat", async () => {
      /*
       * A repeat needs free slots after the run it copies, and by this point
       * in the round four earlier steps have left their edits in place. The
       * end of a bar is the part nothing else has reached, so that is where
       * this asks — and it asks in four different bars before giving up.
       */
      const twice = async (bar, fromSlot) => {
        await select(page, { slots: 1, bar, fromSlot });
        await act(page, "repeat");
        await page
          .locator("[data-testid='repeat-count-1']")
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
        await wait(page, 250);
        await applySheet(page);
      };
      const done = await untilWritten(page, [
        () => twice(0, 12),
        () => twice(2, 10),
        () => twice(5, 12),
        () => twice(4, 8),
      ]);
      check("the repeat landed", done, "");
      await undo(page);
      await redo(page);
    }),
  );

  /* 10 · Sil, sonra geri al */
  steps.push(
    await doStep(page, "deleteUndo", async () => {
      const done = await untilWritten(page, [
        async () => {
          await select(page, { slots: 2, bar: 0 });
          await act(page, "delete");
        },
        async () => {
          await select(page, { slots: 2, bar: 2 });
          await act(page, "delete");
        },
      ]);
      check("the delete landed", done, "");
      await undo(page);
      await redo(page);
    }),
  );

  /* 11A · one instrument's row */
  steps.push(
    await doStep(page, "trackScope", async () => {
      await select(page, { slots: 4, bar: 0 });
      await drawerAct(page, "listen_once");
      const heard = await transport(page);
      evidence.scopes.track = heard.selection;
      await wait(page, 900);
      return {};
    }),
  );

  /* 11B · the measure heading, which is every instrument */
  steps.push(
    await doStep(page, "measureScope", async () => {
      const measured = await selectMeasure(page);
      check("the bar heading opens the whole-measure scope", measured, "");
      await drawerAct(page, "listen_once");
      const heard = await transport(page);
      evidence.scopes.measure = heard.selection;
      await wait(page, 900);
      return {};
    }),
  );

  /* 12 · Sonuç */
  steps.push(await doStep(page, "finish", async () => {}));

  await wait(page, 900);

  const block = await page.evaluate(
    () => document.querySelector("[data-batch-result]")?.textContent ?? "",
  );
  const deviceAfter = await deviceStore(page);
  const fixtureEnd = await fixture(page);

  /* --- what the walk itself proved --- */
  const advanced = steps.filter((entry) => entry.state.step !== entry.beforeAnswer.step);
  check(
    "every step advanced on production evidence, not on a press",
    advanced.length === steps.length,
    `${advanced.length}/${steps.length}`,
  );
  for (const entry of steps) {
    check(
      `${entry.id}: production evidence was in before the step advanced`,
      entry.ready.evidence === "ready" && entry.ready.nextDisabled === false,
      `evidence=${entry.ready.evidence} disabled=${entry.ready.nextDisabled} · ${entry.ready.shortfall} · ${entry.ready.refused}`,
    );
  }

  check(
    "the device's own store is byte-identical",
    JSON.stringify(deviceBefore) === JSON.stringify(deviceAfter),
    `${Object.keys(deviceBefore).length} keys`,
  );
  check(
    "the fixture came back to the bytes it started on",
    fixtureEnd.bytes === fixtureStart.bytes,
    `${fixtureStart.revision} → ${fixtureEnd.revision}`,
  );
  check(
    "the two listening scopes used different filters",
    evidence.scopes.track !== null &&
      evidence.scopes.measure !== null &&
      JSON.stringify(evidence.scopes.track?.trackIds ?? []) !==
        JSON.stringify(evidence.scopes.measure?.trackIds ?? []),
    JSON.stringify(evidence.scopes),
  );
  check(
    "the result block carries the four isolation domains",
    block.includes("İzolasyon") &&
      block.includes("Cihaz hash: device:") &&
      block.includes("Kopya hash: fixture:"),
    "",
  );
  check(
    "the result block carries a ledger row for every write action",
    ["paste", "duplicate", "move", "repeat", "delete"].every((name) =>
      block.includes(`  ${name} →`),
    ),
    "",
  );
  check(
    "every ledger row is atomic, with byte-exact undo and redo",
    ["paste", "duplicate", "move", "repeat", "delete"].every((name) =>
      block.includes(`  ${name} → atomic`),
    ),
    (block.match(/^ {2}\w+ → .*$/gm) ?? []).join(" | "),
  );
  check("console errors is 0", consoleErrors.length === 0, consoleErrors.join(" | "));

  await page.screenshot({ path: `${OUT}acceptance-result.png` });

  writeFileSync(
    `${OUT}ACCEPTANCE.json`,
    `${JSON.stringify(
      {
        sha,
        generatedAt: new Date().toISOString(),
        /* Said in the artifact, not only in a report: desktop Chromium with
           emulated touch is not a phone, and this run is not a physical
           acceptance however green it is. */
        browserEmulation: true,
        physicalAcceptance: false,
        viewport: "384x692",
        opened,
        fixtureStart,
        fixtureEnd,
        deviceKeys: Object.keys(deviceBefore),
        deviceUnchanged: JSON.stringify(deviceBefore) === JSON.stringify(deviceAfter),
        steps: steps.map((entry) => ({
          id: entry.id,
          answered: entry.answered,
          evidenceBeforeAnswering: entry.beforeAnswer.evidence,
          nextDisabledBeforeAnswering: entry.beforeAnswer.nextDisabled,
          nextDisabledAfterAnswering: entry.ready.nextDisabled,
          refused: entry.beforeAnswer.refused,
          revision: `${entry.before.revision}→${entry.after.revision}`,
          task: entry.beforeAnswer.task,
        })),
        evidence,
        resultBlock: block,
        checks,
        passed: checks.filter((entry) => entry.pass).length,
        total: checks.length,
        consoleErrors,
      },
      null,
      2,
    )}\n`,
  );

  await browser.close();
  console.log(
    `\n${checks.filter((entry) => entry.pass).length}/${checks.length} checks · ${failures} failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

await main();
