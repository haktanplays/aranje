/**
 * The founder's Android run, reproduced on the build they were given (§3).
 *
 * `384×692`, Android Chrome UA, five touch points, the production Workspace,
 * real long-press and drag, the real drawer, the real handlers and the real
 * audio engine. Nothing is mounted directly and no pure model is called: the
 * only way in is the way they came.
 *
 * What it records, separately (§4):
 *
 * - the **device's own** store, before the route mounts and after it closes;
 * - the **eval fixture**, which is expected to change and to come back;
 * - which keys moved, by name, so "Proje değişmedi: HAYIR" can be attributed
 *   to a writer rather than guessed at.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3114";
const SHA = process.env.SHA ?? "26bd505";
const ROUTE = `${BASE}/eval/editor-action-batch`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const NAME = process.env.OUT_NAME ?? "BASELINE";

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const notes = [];
const record = (name, value, detail = "") => {
  notes.push({ name, value, detail });
  console.log(`${name}: ${value}${detail ? `  — ${detail}` : ""}`);
};

/** Every key the device's own store holds, as a comparable object. */
const deviceStore = (page) =>
  page.evaluate(() => {
    const out = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null) out[key] = window.localStorage.getItem(key) ?? "";
    }
    return out;
  });

const fixture = (page) =>
  page.evaluate(() => ({
    bytes: window.__aranjeAcceptance?.bytes() ?? null,
    revision: window.__aranjeAcceptance?.revision() ?? null,
  }));

async function stringSpot(page, fromSlot = 0) {
  return page.evaluate(({ fromSlot }) => {
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
      for (const y of lines) {
        const hit = document.elementFromPoint(start, y);
        if (hit && hit.closest("[data-tab-content]")) return { x: start, y, width };
      }
    }
    return null;
  }, { fromSlot });
}

async function select(page, slots = 4, fromSlot = 0) {
  const spot = await stringSpot(page, fromSlot);
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

const act = async (page, id) => {
  const button = page.locator(`[data-selection-action-id='${id}']`).first();
  if (!(await button.count())) return false;
  await button.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(420);
  return true;
};

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 384, height: 692 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: ANDROID,
  });
  await context.addInitScript(`window.__consoleErrors = [];`);
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((t) => window.__consoleErrors.push(t), message.text()).catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((t) => window.__consoleErrors.push(t), String(error)).catch(() => {});
  });

  /* A reader who has already used the app: their own project is in the store. */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.setItem("aranje.sentinel", "the reader's own");
  });
  await page.waitForTimeout(600);
  const before = await deviceStore(page);

  /* Now the founder opens the link they were sent. */
  await page.goto(`${ROUTE}?sha=${SHA}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const touch = await page.evaluate(() => navigator.maxTouchPoints);
  const shown = await page.evaluate(
    () => document.querySelector("[data-batch-sha]")?.textContent ?? "",
  );
  record("route opened", `${shown} · touch=${touch}`);

  /* --- what the guide covers, and what it covers it with (§7, §10) --- */
  const layout = await page.evaluate(() => {
    const guide = document.querySelector("[data-batch-guide]");
    const staff = document.querySelector("[data-tab-content]");
    const box = guide?.getBoundingClientRect();
    return {
      guideHeight: box ? Math.round(box.height) : 0,
      guideShare: box ? Math.round((box.height / window.innerHeight) * 100) : 0,
      viewport: window.innerHeight,
      strings: document.querySelectorAll("[data-string-line]").length,
      staffHeight: staff ? Math.round(staff.getBoundingClientRect().height) : 0,
    };
  });
  record("guide covers", `${layout.guideShare}% of the screen`, JSON.stringify(layout));

  await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
  await page.waitForSelector("[data-tab-content]").catch(() => {});
  await page.waitForTimeout(300);

  const afterTab = await page.evaluate(() => ({
    strings: document.querySelectorAll("[data-string-line]").length,
    guide: Math.round(
      document.querySelector("[data-batch-guide]")?.getBoundingClientRect().height ?? 0,
    ),
    main: window.innerHeight,
  }));
  record("strings visible on the task screen", `${afterTab.strings}`, JSON.stringify(afterTab));

  const start = await fixture(page);
  record("fixture at the start", `revision=${start.revision}`, `bytes=${start.bytes?.length}`);

  /* --- the founder's own steps 6-10, in the order the guide asks --- */
  const ledger = [];
  const step = async (label, run) => {
    const was = await fixture(page);
    const ok = await run();
    const now = await fixture(page);
    ledger.push({
      action: label,
      ran: ok,
      revisionBefore: was.revision,
      revisionAfter: now.revision,
      bytesMoved: was.bytes !== now.bytes,
    });
    console.log(
      `  ${label}: ran=${ok} revision ${was.revision}→${now.revision} bytes ${
        was.bytes === now.bytes ? "same" : "moved"
      }`,
    );
  };

  await step("Çoğalt", async () => (await select(page, 4)) && act(page, "duplicate"));
  await step("Sil", async () => (await select(page, 4)) && act(page, "delete"));

  /* Listening, which is what the founder said cut out. */
  await step("Seçimi dinle", async () => {
    if (!(await select(page, 4))) return false;
    if (!(await act(page, "more"))) return false;
    const once = page.locator("[role=dialog] [data-selection-action-id='listen_once']");
    if (!(await once.count())) return false;
    await once.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(900);
    return true;
  });

  await step("Seçimden döngü, sonra kapat", async () => {
    if (!(await act(page, "more"))) return false;
    const loop = page.locator("[role=dialog] [data-selection-action-id='listen_loop']");
    if (!(await loop.count())) return false;
    await loop.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await act(page, "more");
    const again = page.locator("[role=dialog] [data-selection-action-id='listen_loop']");
    const label = (await again.count())
      ? await again.first().getAttribute("aria-label")
      : null;
    if (await again.count()) await again.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
    ledger.push({ action: "loop label on second press", ran: true, label });
    return true;
  });

  /* Whatever is still running once the reader thinks they stopped it. */
  const running = await page.evaluate(() => ({
    status: window.__aranjeDebug?.status?.() ?? null,
    loop: window.__aranjeDebug?.loop?.() ?? null,
    ticks: window.__aranjeDebug?.ticks?.() ?? null,
  }));
  record("transport after closing the loop", JSON.stringify(running));

  const afterEdits = await fixture(page);
  record(
    "fixture after the writing steps",
    `revision=${afterEdits.revision}`,
    afterEdits.bytes === start.bytes ? "byte-equal to the start" : "DIFFERENT from the start",
  );

  /* --- walk the whole guide, as the founder did, and read the block --- */
  /*
   * The drawer is closed first. A production sheet left open covers the
   * guide, and every press on "Sonraki" then lands on the sheet's backdrop —
   * which is itself worth writing down: the two surfaces share a screen and
   * fight over it (§7).
   */
  for (const name of ["Vazgeç", "Kapat"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count()) {
      await button.first().click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
  let screens = 0;
  for (let index = 0; index < 14; index += 1) {
    if ((await page.locator("[data-batch-step]").count()) === 0) break;
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
    await page.waitForTimeout(180);
  }
  const block = await page.evaluate(
    () => document.querySelector("[data-batch-result]")?.textContent ?? "",
  );
  const unchangedLine = /Proje değişmedi: (\S+)/.exec(block)?.[1] ?? "?";
  const verdict = /Verdict: (\w+)/.exec(block)?.[1] ?? "?";
  const failedSteps = (block.match(/KALDI/g) ?? []).length;
  record("guide walked", `${screens}/12 screens`);
  record("block says «Proje değişmedi»", unchangedLine, `verdict=${verdict} KALDI=${failedSteps}`);
  notes.push({ name: "result block", value: block });

  /* --- the device's own store, while the route is still open --- */
  const during = await deviceStore(page);
  const grown = Object.keys(during).filter((key) => !(key in before));
  const changed = Object.keys(during).filter(
    (key) => key in before && before[key] !== during[key],
  );
  record(
    "device store while the route is open",
    grown.length + changed.length === 0 ? "unchanged" : "CHANGED",
    `added=${JSON.stringify(grown)} changed=${JSON.stringify(changed)}`,
  );

  /* --- and after the route is closed and the app reopened --- */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const after = await deviceStore(page);
  const grownAfter = Object.keys(after).filter((key) => !(key in before));
  const changedAfter = Object.keys(after).filter(
    (key) => key in before && before[key] !== after[key],
  );
  record(
    "device store after closing and reopening",
    grownAfter.length + changedAfter.length === 0 ? "unchanged" : "CHANGED",
    `added=${JSON.stringify(grownAfter)} changed=${JSON.stringify(changedAfter)}`,
  );

  const errors = await page.evaluate(() => window.__consoleErrors?.slice() ?? []);
  record("console errors", `${errors.length}`, JSON.stringify(errors.slice(0, 3)));

  writeFileSync(
    `${OUT}/${NAME}.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        route: "/eval/editor-action-batch",
        sha: SHA,
        viewport: "384x692 + Android Chrome UA",
        deviceStoreBefore: before,
        deviceStoreDuring: during,
        deviceStoreAfter: after,
        addedWhileOpen: grown,
        changedWhileOpen: changed,
        addedAfterClose: grownAfter,
        changedAfterClose: changedAfter,
        layout,
        ledger,
        notes,
      },
      null,
      2,
    )}\n`,
  );

  await browser.close();
};

main();
