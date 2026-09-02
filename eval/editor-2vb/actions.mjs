/**
 * Every selection surface, through real gestures on the production DOM (§11).
 *
 * ## What this run is and is not
 *
 * It is not a listening test — a browser cannot hear. It measures what a
 * founder can *reach*: which actions each surface draws, whether the sheets
 * hold what the canon placed there, whether anything is drawn twice, and
 * whether every control is a target a finger could hit at 320px.
 *
 * Nothing is mounted directly and no state is injected. Selections are made
 * with a real long press and drag on the staff the product draws, and every
 * sheet is opened by pressing the visible door.
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
let shots = 0;
let lastPage = null;

function flush() {
  writeFileSync(
    `${OUT}/ACTIONS.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        route: "/eval/editor-action-batch",
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
      ?.screenshot({ path: `${OUT}/failed-actions-${currentViewport}-${step}.png` })
      .catch(() => {});
    record(step, name, false, `threw: ${first}`);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/actions-${currentViewport}-${name}.png` });
  shots += 1;
}

async function open(browser, size, query = "") {
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
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((t) => window.__consoleErrors.push(t), message.text()).catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((t) => window.__consoleErrors.push(t), String(error)).catch(() => {});
  });
  await page.goto(`${ROUTE}${query}`, { waitUntil: "networkidle" });
  return { context, page };
}

/* ---------------------------------------------------------- the gestures */

/** Step 1 of the guide: go to the Tab, using the shipped view switch. */
async function toTab(page) {
  const tab = page.locator("[data-testid=view-tab]");
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForSelector("[data-tab-content]").catch(() => {});
    await page.waitForTimeout(220);
  }
}

/**
 * A string line that is really inside the staff at this x.
 *
 * At 320px the tab's vertical midpoint is under the selection action bar, so
 * a run that aimed there would press "İptal" and silently do nothing — which
 * is exactly how the 2V-A.1 harness passed at 384 and did nothing at 320.
 */
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

/** Hold the first onset, optionally dragging right by `slots` slots. */
async function select(page, slots = 0) {
  const bar = await page.locator("[data-bar-drag-index='0']").first().boundingBox();
  if (!bar) return false;
  const x0 = Math.min(bar.x + 17, page.viewportSize().width - 8);
  const y = await stringY(page, x0);
  if (y === null) return false;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  if (slots > 0) {
    const to = Math.min(x0 + 34 * slots, page.viewportSize().width - 6);
    await page.mouse.move(to, y, { steps: 8 });
    await page.waitForTimeout(180);
  }
  await page.mouse.up();
  await page.waitForTimeout(340);
  return true;
}

/** Press the visible "Daha fazla" and wait for the sheet. */
async function openMore(page) {
  const door = page.getByRole("button", { name: "Daha fazla", exact: true });
  if (!(await door.count())) return false;
  await door.first().click();
  await page.waitForSelector("[role=dialog]", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(260);
  return (await page.locator("[role=dialog]").count()) > 0;
}

/** A real long press on the arrangement's first cell: a whole-bar selection. */
async function holdCell(page) {
  const box = await page.locator("[data-arr-cell]").first().boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(340);
  return true;
}

const closeSheet = (page) =>
  page
    .getByRole("button", { name: "Kapat", exact: true })
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});

/** Every action button on screen, with its state, by canon id. */
const drawn = (page) =>
  page.evaluate(() => {
    const seen = [];
    const push = (node, where) => {
      const label = (node.getAttribute("aria-label") ?? node.textContent ?? "").trim();
      seen.push({
        where,
        id: node.getAttribute("data-selection-action-id") ?? null,
        label,
        enabled: !node.disabled && node.getAttribute("aria-disabled") !== "true",
        width: Math.round(node.getBoundingClientRect().width),
        height: Math.round(node.getBoundingClientRect().height),
        clipped: node.scrollWidth > node.clientWidth + 1,
      });
    };
    for (const node of document.querySelectorAll(
      "[data-testid=selection-action-bar] button[data-testid^='selection-action-']",
    )) {
      push(node, "read_primary");
    }
    for (const node of document.querySelectorAll("[data-selection-toolbar] button")) {
      push(node, "edit_primary");
    }
    for (const node of document.querySelectorAll("[data-bar-action-bar] button[data-bar-action]")) {
      push(node, "measure_primary");
    }
    const sheet = document.querySelector("[role=dialog]");
    if (sheet) {
      for (const node of sheet.querySelectorAll("button")) push(node, "more_sheet");
    }
    return seen;
  });

const geometry = (page) =>
  page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].filter(
      (node) => node.getBoundingClientRect().width > 0,
    );
    return {
      tooSmall: buttons.filter((node) => {
        const box = node.getBoundingClientRect();
        return box.height < 43.5 || box.width < 43.5;
      }).length,
      truncated: buttons.filter((node) => node.scrollWidth > node.clientWidth + 1).length,
      bodyOverflow: Math.max(
        0,
        document.body.scrollWidth - document.documentElement.clientWidth,
      ),
      strings: document.querySelectorAll("[data-string-line]").length,
      toolbarRows: (() => {
        const bar = document.querySelector("[data-testid=selection-action-bar] .grid");
        if (!bar) return 0;
        const tops = new Set(
          [...bar.children].map((node) => Math.round(node.getBoundingClientRect().top)),
        );
        return tops.size;
      })(),
    };
  });

const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors.slice());

/* ---------------------------------------------------------------- the run */

async function runViewport(browser, size) {
  currentViewport = size.name;
  const sha = process.env.SHA ?? "";
  const { context, page } = await open(browser, size, sha ? `?sha=${sha}` : "");

  await safe(1, "the batched route opens on the real workspace", async () => {
    await toTab(page);
    const strings = await page.locator("[data-string-line]").count();
    const safety = await page.evaluate(
      () => document.querySelector("[data-batch-safety]")?.textContent ?? "",
    );
    record(1, "the batched route opens on the real workspace",
      strings >= 6 && safety.includes("değiştirmez"),
      `strings=${strings} · "${safety}"`);
    await shot(page, "01-open");
  });

  await safe(2, "the reading grid draws the eight, none of them clipped", async () => {
    await select(page, 4);
    const seen = (await drawn(page)).filter((entry) => entry.where === "read_primary");
    const ids = seen.map((entry) => entry.id);
    const small = seen.filter((entry) => entry.height < 43.5 || entry.width < 43.5);
    const cut = seen.filter((entry) => entry.clipped);
    record(2, "the reading grid draws the eight, none of them clipped",
      ids.length === 8 &&
        ["copy", "cut", "duplicate", "repeat", "move", "extend", "delete", "more"].every(
          (id) => ids.includes(id),
        ) &&
        small.length === 0 &&
        cut.length === 0,
      `ids=${JSON.stringify(ids)} small=${small.length} clipped=${cut.length}`);
    await shot(page, "02-grid");
  });

  await safe(3, "«Devam» is on the grid and enabled", async () => {
    const seen = (await drawn(page)).filter((entry) => entry.where === "read_primary");
    const extend = seen.filter((entry) => entry.id === "extend");
    record(3, "«Devam» is on the grid and enabled",
      extend.length === 1 && extend[0].enabled === true,
      `rendered=${extend.length} enabled=${extend[0]?.enabled}`);
  });

  await safe(4, "the sheet behind «Daha fazla» holds both listening actions", async () => {
    const opened = await openMore(page);
    const seen = (await drawn(page)).filter((entry) => entry.where === "more_sheet");
    const listen = seen.filter((entry) => entry.label.startsWith("Seçimi dinle"));
    const loop = seen.filter((entry) => entry.label.startsWith("Seçimden döngü"));
    record(4, "the sheet behind «Daha fazla» holds both listening actions",
      opened &&
        listen.length === 1 &&
        loop.length === 1 &&
        listen[0].enabled &&
        loop[0].enabled,
      `opened=${opened} listen=${listen.length} loop=${loop.length} · ${JSON.stringify(
        seen.map((entry) => entry.label),
      )}`);
    await shot(page, "04-sheet");
  });

  await safe(5, "the sheet does not repeat what the grid already has", async () => {
    const seen = await drawn(page);
    const grid = seen
      .filter((entry) => entry.where === "read_primary")
      .map((entry) => entry.label);
    const sheet = seen
      .filter((entry) => entry.where === "more_sheet")
      .map((entry) => entry.label.split(" — ")[0]);
    const both = grid.filter((label) => sheet.includes(label));
    /* An empty screen must not pass this: both lists have to be there. */
    record(5, "the sheet does not repeat what the grid already has",
      grid.length === 8 && sheet.length >= 3 &&
        both.length === 0 && !sheet.includes("Seçimi sil"),
      `overlap=${JSON.stringify(both)} sheet=${JSON.stringify(sheet)}`);
  });

  await safe(6, "the clipboard action is reachable and says why it is greyed", async () => {
    const seen = (await drawn(page)).filter((entry) => entry.where === "more_sheet");
    const paste = seen.filter((entry) => entry.label.startsWith("Yapıştır"));
    const grid = (await drawn(page)).filter(
      (entry) => entry.where === "read_primary" && entry.id === "copy",
    );
    record(6, "the clipboard action is reachable and says why it is greyed",
      paste.length === 1 &&
        (paste[0].enabled || paste[0].label.includes("Panoda bir şey yok.")) &&
        grid.length === 1 && grid[0].enabled,
      `paste="${paste[0]?.label}" enabled=${paste[0]?.enabled} copy=${grid[0]?.enabled}`);
    await closeSheet(page);
  });

  await safe(7, "no action is drawn twice in one context", async () => {
    await openMore(page);
    const seen = await drawn(page);
    const labels = seen
      .filter((entry) => entry.id !== null || entry.where === "more_sheet")
      .map((entry) => `${entry.where}:${entry.label.split(" — ")[0]}`);
    const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index);
    record(7, "no action is drawn twice in one context",
      labels.length >= 11 && duplicates.length === 0,
      `drawn=${labels.length} duplicates=${JSON.stringify(duplicates)}`);
    await closeSheet(page);
  });

  await safe(8, "every drawn action is pressable or greyed with a reason", async () => {
    await openMore(page);
    const seen = await drawn(page);
    const silent = seen.filter(
      (entry) =>
        !entry.enabled && !entry.label.includes(" — ") && entry.label !== "Kapat",
    );
    record(8, "every drawn action is pressable or greyed with a reason",
      seen.length >= 11 && silent.length === 0,
      `silent=${JSON.stringify(silent.map((entry) => entry.label))}`);
    await closeSheet(page);
  });

  await safe(9, "the measure bar draws its verbs in the scope's own words", async () => {
    /*
     * Through the shipped view switch and a real long press on the
     * arrangement's own cell — the way a reader reaches a run of whole bars.
     */
    await page.locator("[data-testid=view-arrange]").first().click().catch(() => {});
    await page.waitForSelector("[data-arr-cell]", { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(280);
    await holdCell(page);
    const seen = (await drawn(page)).filter((entry) => entry.where === "measure_primary");
    const labels = seen.map((entry) => entry.label.split(" — ")[0]);
    record(9, "the measure bar draws its verbs in the scope's own words",
      seen.length >= 6 &&
        labels.some((label) => label.includes("çoğalt") || label.includes("Çoğalt")),
      `labels=${JSON.stringify(labels)}`);
    await shot(page, "09-measures");
  });

  await safe(10, "and offers listening on a run of bars, in both scopes", async () => {
    let found = { track: null, full: null };
    for (const scope of ["track", "full"]) {
      const chip = page.locator(`[data-bar-scope='${scope}']`);
      if (await chip.count()) {
        await chip.first().click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(280);
      }
      await openMore(page);
      const seen = (await drawn(page)).filter((entry) => entry.where === "more_sheet");
      found[scope] = {
        once: seen.filter((entry) => entry.label.startsWith("Seçimi dinle")).length,
        loop: seen.filter((entry) => entry.label.startsWith("Seçimden döngü")).length,
      };
      await closeSheet(page);
    }
    record(10, "and offers listening on a run of bars, in both scopes",
      found.track?.once === 1 && found.track?.loop === 1 &&
        found.full?.once === 1 && found.full?.loop === 1,
      JSON.stringify(found));
    await shot(page, "10-measure-sheet");
  });

  await safe(11, "the geometry the UI contract froze is intact", async () => {
    await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
    await page.waitForTimeout(280);
    await select(page, 4);
    const box = await geometry(page);
    record(11, "the geometry the UI contract froze is intact",
      box.tooSmall === 0 &&
        box.truncated === 0 &&
        box.bodyOverflow === 0 &&
        box.strings >= 6 &&
        box.toolbarRows === 2,
      JSON.stringify(box));
    await shot(page, "11-geometry");
  });

  await safe(12, "background scroll never drifts while the sheets open", async () => {
    const before = await page.evaluate(() => window.scrollY);
    const opened = await openMore(page);
    await closeSheet(page);
    const after = await page.evaluate(() => window.scrollY);
    record(12, "background scroll never drifts while the sheets open",
      opened && before === after, `opened=${opened} · ${before} → ${after}`);
  });

  await safe(13, "the guide runs cold-start to a complete result block", async () => {
    /*
     * Every step answered and finished, so the block is complete. The page's
     * own measurements are *not* forced: a browser cannot make a real edit
     * happen for the steps that need one, and the block says so by counting
     * the steps that failed measurement rather than by hiding them.
     */
    const total = await page.evaluate(
      () => document.querySelector("[data-batch-step]")?.textContent ?? "",
    );
    let screens = 0;
    for (let index = 0; index < 14; index += 1) {
      const step = await page.locator("[data-batch-step]").count();
      if (step === 0) break;
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
        await page.locator(`[data-batch-answer='${id}']`).click().catch(() => {});
      }
      screens += 1;
      await page.locator("[data-batch-action=next]").click().catch(() => {});
      await page.waitForTimeout(160);
    }
    const block = await page.evaluate(
      () => document.querySelector("[data-batch-result]")?.textContent ?? "",
    );
    record(13, "the guide runs cold-start to a complete result block",
      screens === 12 &&
        block.includes("Verdict:") &&
        block.includes("Kanıtı gelmemiş adım:") &&
        block.includes("eylem kanıtı:") &&
        /* Isolation is its own line now, never a step's conclusion. */
        block.includes("izolasyon:"),
      `first="${total.trim()}" screens=${screens} block=${block.length}`);
    await shot(page, "13-result");
  });

  await safe(14, "a run that pressed nothing is never a PASS", async () => {
    /*
     * The vacuity control (§12). Every question answered well and not one
     * edit made: the writing steps' traces hold a single state, so the block
     * must not say PASS however green the answers look.
     */
    const block = await page.evaluate(
      () => document.querySelector("[data-batch-result]")?.textContent ?? "",
    );
    const verdict = /Verdict: (\w+)/.exec(block)?.[1] ?? "";
    const failed = (block.match(/KALDI/g) ?? []).length;
    record(14, "a run that pressed nothing is never a PASS",
      verdict !== "PASS" && failed >= 5,
      `verdict=${verdict} failedSteps=${failed}`);
  });

  await safe(15, "the app wrote nothing to the console", async () => {
    const errors = await consoleErrors(page);
    record(15, "the app wrote nothing to the console", errors.length === 0,
      JSON.stringify(errors.slice(0, 3)));
  });

  await context.close();

  await safe(16, "a link for another build refuses to start the test", async () => {
    const wrong = await open(browser, size, "?sha=0000000");
    const blocked = await wrong.page.locator("[data-batch-wrong-version]").count();
    const started = await wrong.page.locator("[data-string-line]").count();
    record(16, "a link for another build refuses to start the test",
      blocked === 1 && started === 0, `refusal=${blocked} staff drawn=${started}`);
    await wrong.context.close();
  });

  await safe(17, "the reader's own project was never written to", async () => {
    const probe = await open(browser, size);
    await probe.page.evaluate(() =>
      window.localStorage.setItem("aranje.sentinel", "kept"),
    );
    await toTab(probe.page);
    await select(probe.page, 4);
    await openMore(probe.page);
    await closeSheet(probe.page);
    const kept = await probe.page.evaluate(() => ({
      sentinel: window.localStorage.getItem("aranje.sentinel"),
      keys: Object.keys(window.localStorage).filter((key) => key.startsWith("aranje.")),
    }));
    record(17, "the reader's own project was never written to",
      kept.sentinel === "kept" && kept.keys.length === 1,
      JSON.stringify(kept));
    await probe.context.close();
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
