/**
 * Every editor action, driven through the production path (2V-B §8).
 *
 * ## What is measured, and by what
 *
 * Not "did a button exist" — this round already has a harness for that. This
 * one presses the buttons and asks the *project record* what happened: the
 * bytes it holds and the revision the app bumps once per committed edit. One
 * history step and one storage write are the same event, said by the thing
 * that did them, so a revision that moved by exactly one is the whole of
 * "atomic".
 *
 * The non-writing actions are held to the mirror image: the reach, the two
 * listening intents, the scope switch and cancelling a selection must leave
 * the bytes and the revision exactly where they were.
 *
 * ## Why this cannot pass vacuously
 *
 * Every "nothing changed" claim is made in a run that also makes something
 * change. If the harness were pressing air, the writing steps would report
 * zero too — and they are checked first.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3114";
const ROUTE = `${BASE}/eval/editor-action-batch`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700 },
  { name: "384x740", width: 384, height: 740, ua: ANDROID },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915, ua: ANDROID },
  { name: "1363x936", width: 1363, height: 936, desktop: true },
];

const results = [];
let currentViewport = "";
let lastPage = null;

const flush = () =>
  writeFileSync(
    `${OUT}/FUNCTIONAL.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        route: "/eval/editor-action-batch",
        measured: "project record bytes + revision, through the production controls",
        results,
        failed: results.filter((entry) => !entry.pass).length,
      },
      null,
      2,
    )}\n`,
  );

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
      ?.screenshot({ path: `${OUT}/failed-functional-${currentViewport}-${step}.png` })
      .catch(() => {});
    record(step, name, false, `threw: ${first}`);
  }
}

async function open(browser, size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: !size.desktop,
    isMobile: !size.desktop,
    deviceScaleFactor: size.desktop ? 1 : 2,
    ...(size.ua ? { userAgent: size.ua } : {}),
  });
  await context.addInitScript(`window.__consoleErrors = [];`);
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(9000);
  page.on("pageerror", (error) => {
    page.evaluate((t) => window.__consoleErrors.push(t), String(error)).catch(() => {});
  });
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  return { context, page };
}

/** The record, as the app's own storage holds it. */
const reading = (page) =>
  page.evaluate(() => ({
    bytes: window.__aranjeAcceptance?.bytes() ?? null,
    revision: window.__aranjeAcceptance?.revision() ?? null,
  }));

async function toTab(page) {
  const tab = page.locator("[data-testid=view-tab]");
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForSelector("[data-tab-content]").catch(() => {});
    await page.waitForTimeout(220);
  }
}

async function stringY(page, atX) {
  return page.evaluate((x) => {
    const lines = [...document.querySelectorAll("[data-string-line]")]
      .map((node) => {
        const box = node.getBoundingClientRect();
        return box.top + box.height / 2;
      })
      .sort((a, b) => a - b);
    for (const y of lines) {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest("[data-tab-content]")) return y;
    }
    return null;
  }, atX);
}

/**
 * Hold an onset that is actually on screen, and drag right.
 *
 * Not "the first bar": the tab is windowed horizontally (2Q-C), so after a
 * move or a repeat the run the reader is looking at may be bar three, and bar
 * zero may be at a negative x — where a press lands outside the window and
 * quietly does nothing. That is how the staged steps below once reported "no
 * dialog" for a sheet that opens perfectly well.
 */
async function select(page, slots = 4, fromSlot = 0) {
  const spot = await page.evaluate(({ fromSlot }) => {
    const width = window.innerWidth;
    for (const node of document.querySelectorAll("[data-bar-drag-index]")) {
      const box = node.getBoundingClientRect();
      const start = box.left + 17 + 34 * fromSlot;
      if (box.left < 0 || start < 8 || start + 34 > width) continue;
      const lines = [...document.querySelectorAll("[data-string-line]")]
        .map((line) => {
          const at = line.getBoundingClientRect();
          return at.top + at.height / 2;
        })
        .sort((a, b) => a - b);
      const x = start;
      for (const y of lines) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest("[data-tab-content]")) return { x, y, width };
      }
    }
    return null;
  }, { fromSlot });
  if (spot === null) return false;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  if (slots > 0) {
    await page.mouse.move(Math.min(spot.x + 34 * slots, spot.width - 6), spot.y, {
      steps: 8,
    });
    await page.waitForTimeout(180);
  }
  await page.mouse.up();
  await page.waitForTimeout(340);
  return (await page.locator("[data-testid=selection-action-bar]").count()) > 0;
}

/** Press a production action on the reading grid, by its canon id. */
async function act(page, id) {
  const button = page.locator(`[data-selection-action-id='${id}']`).first();
  if (!(await button.count())) return false;
  await button.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(420);
  return true;
}

/** Leave no sheet open behind a step: the next one starts from the staff. */
async function dismiss(page) {
  for (const name of ["Vazgeç", "Kapat"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count()) {
      await button.first().click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

/**
 * Stop the transport if it is running, and bring the view home.
 *
 * The tab follows the playhead (2Q-C). A step that played anything leaves the
 * window somewhere down the song, and every later press then lands where the
 * music is not — which is what emptied the staff in the middle of this run.
 * Both controls are the shipped ones.
 */
async function fresh(browser, size, fn) {
  /*
   * A page of its own for each of the staged steps.
   *
   * The tab is windowed horizontally and follows the playhead (2Q-C), so a
   * step that moved a run or played one leaves the window somewhere down the
   * song — and the next step's long press then lands where the music is not.
   * Fighting that with scroll resets measures the harness's patience; a fresh
   * page measures the product. Each step is still a real cold start on the
   * real route, and the record it reads is that page's own.
   */
  const opened = await open(browser, size);
  await toTab(opened.page);
  try {
    await fn(opened.page);
  } finally {
    await opened.context.close();
  }
}

async function quiet(page) {
  const pause = page.getByRole("button", { name: "Duraklat" });
  if (await pause.count()) {
    await pause.first().click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(320);
  }
  await page
    .getByRole("button", { name: "Başa dön" })
    .first()
    .click({ timeout: 2500 })
    .catch(() => {});
  await page.waitForTimeout(420);
}

const undo = (page) =>
  page
    .getByRole("button", { name: /Geri al/ })
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});

const redo = (page) =>
  page
    .getByRole("button", { name: /Yinele/ })
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});

async function runViewport(browser, size) {
  currentViewport = size.name;

  /**
   * Every step on a page of its own.
   *
   * The tab is windowed horizontally and follows the playhead (2Q-C), and a
   * selection outlives a view switch — so a step that moved a run, played one
   * or held some bars leaves the next step pressing where the music is not.
   * Chaining them measures the harness's bookkeeping; a cold start per step
   * measures the product, and each step's before/after is that page's own
   * record.
   */
  const step = (number, name, fn) =>
    safe(number, name, () =>
      fresh(browser, size, async (page) => {
        await fn(page, number, name);
      }),
    );

  await step(1, "the record is readable before anything is pressed", async (page, n, name) => {
    const now = await reading(page);
    record(n, name,
      typeof now.bytes === "string" && now.bytes.length > 10 && now.revision >= 1,
      `revision=${now.revision} bytes=${now.bytes?.length}`);
  });

  /* ------------------------------------------------ the writing actions */

  for (const [number, id, label] of [
    [2, "duplicate", "Çoğalt"],
    [3, "delete", "Sil"],
    [4, "cut", "Kes"],
  ]) {
    await step(number, `«${label}» is one atomic write, and undo/redo is byte-exact`,
      async (page, n, name) => {
        const held = await select(page, 4);
        const before = await reading(page);
        const pressed = await act(page, id);
        const after = await reading(page);

        await undo(page);
        await page.waitForTimeout(460);
        const back = await reading(page);
        await redo(page);
        await page.waitForTimeout(460);
        const forward = await reading(page);

        record(n, name,
          held &&
            pressed &&
            after.revision === before.revision + 1 &&
            after.bytes !== before.bytes &&
            back.bytes === before.bytes &&
            forward.bytes === after.bytes,
          `revision ${before.revision}→${after.revision} · undo ${
            back.bytes === before.bytes ? "byte-equal" : "DIFFERENT"
          } · redo ${forward.bytes === after.bytes ? "byte-equal" : "DIFFERENT"}`);
      });
  }

  const staged = [
    [5, "move", "Taşı", 4, 0, async (page) => {
      const nudge = page.locator("[data-testid^='nudge-right-']").first();
      if (await nudge.count()) await nudge.click({ timeout: 3000 }).catch(() => {});
    }],
    [6, "repeat", "Tekrarla", 1, 0, async (page) => {
      const twice = page.locator("[data-testid='repeat-count-1']").first();
      if (await twice.count()) await twice.click({ timeout: 3000 }).catch(() => {});
    }],
  ];

  for (const [number, id, label, slots, from, stage] of staged) {
    await step(number, `«${label}» stages, «Uygula» writes once, «Geri al» undoes it`,
      async (page, n, name) => {
        const held = await select(page, slots, from);
        const before = await reading(page);
        await act(page, id);
        await page.waitForTimeout(280);
        await stage(page);
        await page.waitForTimeout(320);
        /* The preview must not have written: staging is not committing. */
        const previewed = await reading(page);
        await page
          .getByRole("button", { name: "Uygula", exact: true })
          .first()
          .click({ timeout: 4000 })
          .catch(() => {});
        await page.waitForTimeout(540);
        const after = await reading(page);
        await undo(page);
        await page.waitForTimeout(480);
        const back = await reading(page);
        record(n, name,
          held &&
            previewed.revision === before.revision &&
            after.revision === before.revision + 1 &&
            after.bytes !== before.bytes &&
            back.bytes === before.bytes,
          `held=${held} staged ${before.revision}→${previewed.revision} · applied →${
            after.revision
          } · undo ${back.bytes === before.bytes ? "byte-equal" : "DIFFERENT"}`);
      });
  }

  await step(7, "«Yapıştır» stages from the clipboard and writes once",
    async (page, n, name) => {
      /*
       * The target is made rather than hunted for. Pasting onto notes is
       * refused by the core with its own sentence — correctly — and which
       * beats of the fixture happen to be free depends on how much of a bar
       * fits on the screen. So: copy a run, delete it, and paste it back into
       * the space that leaves. Deterministic at every width, and every press
       * is a production one.
       */
      const held = await select(page, 4);
      await act(page, "copy");
      await page.waitForTimeout(300);
      const original = await reading(page);
      await act(page, "delete");
      await page.waitForTimeout(480);
      const emptied = await reading(page);

      await select(page, 1);
      const before = await reading(page);
      await act(page, "more");
      await page.waitForTimeout(280);
      const paste = page.locator("[role=dialog] [data-selection-action-id='paste']");
      const offered = (await paste.count()) > 0;
      if (offered) await paste.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(440);
      const staging = await reading(page);
      const preview = await page.evaluate(
        () => document.querySelector("[data-testid=transform-preview]")?.textContent ?? "",
      );
      await page
        .getByRole("button", { name: "Uygula", exact: true })
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
      await page.waitForTimeout(560);
      const after = await reading(page);
      await undo(page);
      await page.waitForTimeout(500);
      const back = await reading(page);

      record(n, name,
        held &&
          offered &&
          emptied.bytes !== original.bytes &&
          staging.revision === before.revision &&
          after.revision === before.revision + 1 &&
          after.bytes !== before.bytes &&
          back.bytes === before.bytes,
        `offered=${offered} preview="${preview}" revision ${before.revision}→${
          staging.revision
        }→${after.revision} · undo ${
          back.bytes === before.bytes ? "byte-equal" : "DIFFERENT"
        }`);
    });

  await step(8, "the clipboard holds a copy, not a view of the song",
    async (page, n, name) => {
      /*
       * Aliasing, asked the only way a browser can: copy a run, delete the
       * very notes it was copied from, and paste it back where they were. If
       * the clipboard held a reference into the song rather than a structure
       * of its own, what came back would be the deletion — and the bytes
       * would not return to what the copy captured.
       */
      await select(page, 4);
      await act(page, "copy");
      await page.waitForTimeout(300);
      const original = await reading(page);
      await act(page, "delete");
      await page.waitForTimeout(480);
      const emptied = await reading(page);

      await select(page, 1);
      await act(page, "more");
      await page.waitForTimeout(280);
      const paste = page.locator("[role=dialog] [data-selection-action-id='paste']");
      const offered = (await paste.count()) > 0;
      if (offered) await paste.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(440);
      await page
        .getByRole("button", { name: "Uygula", exact: true })
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
      await page.waitForTimeout(560);
      const restored = await reading(page);

      record(n, name,
        offered &&
          emptied.bytes !== original.bytes &&
          restored.bytes !== emptied.bytes &&
          restored.bytes === original.bytes,
        `deleted then pasted back: ${
          restored.bytes === original.bytes ? "byte-identical to the copy" : "DIFFERENT"
        } · revision ${original.revision}→${emptied.revision}→${restored.revision}`);
    });

  /* ------------------------------------------------ the reading actions */

  await step(9, "«Kopyala» writes nothing at all", async (page, n, name) => {
    const held = await select(page, 4);
    const before = await reading(page);
    const pressed = await act(page, "copy");
    const after = await reading(page);
    /* And the clipboard really filled: the paste entry stops being greyed. */
    await act(page, "more");
    await page.waitForTimeout(280);
    const paste = await page.evaluate(() => {
      const node = document.querySelector(
        "[role=dialog] [data-selection-action-id='paste']",
      );
      return node ? { enabled: !node.disabled } : null;
    });
    record(n, name,
      held &&
        pressed &&
        after.bytes === before.bytes &&
        after.revision === before.revision &&
        paste?.enabled === true,
      `revision ${before.revision}→${after.revision} · paste enabled=${paste?.enabled}`);
  });

  await step(10, "«Devam» arms the reach and writes nothing", async (page, n, name) => {
    const held = await select(page, 2);
    const before = await reading(page);
    const pressed = await act(page, "extend");
    const armed = await page.evaluate(
      () =>
        document
          .querySelector("[data-selection-action-id='extend']")
          ?.getAttribute("aria-pressed") === "true",
    );
    const after = await reading(page);
    record(n, name,
      held && pressed && armed &&
        after.bytes === before.bytes &&
        after.revision === before.revision,
      `armed=${armed} revision ${before.revision}→${after.revision}`);
  });

  await step(11, "both listening actions write nothing, and the loop closes",
    async (page, n, name) => {
      await select(page, 4);
      const before = await reading(page);

      await act(page, "more");
      await page.waitForTimeout(260);
      const once = page.locator("[role=dialog] [data-selection-action-id='listen_once']");
      const heardOnce = (await once.count()) > 0;
      if (heardOnce) {
        await once.first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(650);
      }

      const pressLoop = async () => {
        await act(page, "more");
        await page.waitForTimeout(280);
        const button = page.locator(
          "[role=dialog] [data-selection-action-id='listen_loop']",
        );
        if (!(await button.count())) return null;
        const label = await button.first().getAttribute("aria-label");
        await button.first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(520);
        return label;
      };
      const started = await pressLoop();
      const stopping = await pressLoop();
      await dismiss(page);
      const after = await reading(page);
      record(n, name,
        heardOnce &&
          after.bytes === before.bytes &&
          after.revision === before.revision &&
          started === "Seçimden döngü" &&
          stopping === "Seçim döngüsünü kapat",
        `revision ${before.revision}→${after.revision} · "${started}" then "${stopping}"`);
    });

  await step(12, "cancelling a selection writes nothing", async (page, n, name) => {
    const held = await select(page, 4);
    const before = await reading(page);
    await page
      .getByRole("button", { name: "Seçimi iptal et" })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await page.waitForTimeout(320);
    const gone = (await page.locator("[data-testid=selection-action-bar]").count()) === 0;
    const after = await reading(page);
    record(n, name,
      held && gone && after.bytes === before.bytes &&
        after.revision === before.revision,
      `cleared=${gone} revision ${before.revision}→${after.revision}`);
  });

  await step(13, "switching the measure scope writes nothing", async (page, n, name) => {
    await page.locator("[data-testid=view-arrange]").first().click().catch(() => {});
    await page.waitForSelector("[data-arr-cell]", { timeout: 4000 }).catch(() => {});
    const box = await page.locator("[data-arr-cell]").first().boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(750);
      await page.mouse.up();
      await page.waitForTimeout(340);
    }
    const held = (await page.locator("[data-bar-action-bar]").count()) > 0;
    const before = await reading(page);
    const scopes = [];
    for (const scope of ["full", "track"]) {
      const chip = page.locator(`[data-bar-scope='${scope}']`);
      if (await chip.count()) {
        await chip.first().click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(300);
        scopes.push(
          await page.evaluate(
            () =>
              document
                .querySelector("[data-bar-scope][aria-checked=true]")
                ?.getAttribute("data-bar-scope") ?? null,
          ),
        );
      }
    }
    const after = await reading(page);
    record(n, name,
      held &&
        scopes.join(",") === "full,track" &&
        after.bytes === before.bytes &&
        after.revision === before.revision,
      `held=${held} scopes=${scopes.join(",")} revision ${before.revision}→${after.revision}`);
  });

  await step(14, "the app wrote nothing to the console", async (page, n, name) => {
    await select(page, 4);
    await act(page, "more");
    await page.waitForTimeout(300);
    await dismiss(page);
    const errors = await page.evaluate(() => window.__consoleErrors.slice());
    record(n, name, errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  });
}

const main = async () => {
  const browser = await chromium.launch();
  const only = process.env.ONLY ?? "";
  for (const size of VIEWPORTS) {
    if (only && size.name !== only) continue;
    await runViewport(browser, size);
  }
  await browser.close();
  const failed = results.filter((entry) => !entry.pass).length;
  console.log(`\n${results.length - failed}/${results.length} · failed=${failed}`);
  flush();
  process.exit(failed > 0 ? 1 : 0);
};

main();
