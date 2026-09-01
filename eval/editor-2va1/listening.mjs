/**
 * The 2V-A founder route, driven through its own controls (2V-A.1 §11).
 *
 * ## What this run is for
 *
 * Not to hear anything — a browser cannot. It is to establish that a founder
 * standing in front of this page can *reach* all eight steps, that each one
 * is bound to the production surface it names, that the block at the end is
 * complete, and that the page refuses a build it was not sent to.
 *
 * The listening itself is the founder's, and the block says so.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3114";
const ROUTE = `${BASE}/eval/selection-playback`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ONLY = process.env.ONLY ?? "";

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
    `${OUT}/LISTENING.json`,
    `${JSON.stringify(
      {
        kind: "browser emulation — not a physical device",
        route: "/eval/selection-playback",
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
      ?.screenshot({ path: `${OUT}/failed-listening-${currentViewport}-${step}.png` })
      .catch(() => {});
    record(step, name, false, `threw: ${first}`);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/listening-${currentViewport}-${name}.png` });
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

/**
 * Do what the guide's first step tells the reader to do: go to the Tab.
 *
 * The workspace opens on the arrangement, so a run that looked for strings
 * before pressing "Tab" would be reporting that the staff is missing when
 * what is missing is the reader's first tap. "Tab" is a shipped control on
 * the production view switch, which is the point.
 */
async function toTab(page) {
  const tab = page.locator("[data-testid=view-tab]");
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForSelector("[data-tab-content]").catch(() => {});
    await page.waitForTimeout(200);
  }
}

/* ------------------------------------------------------------ measuring */

const stepLine = (page) =>
  page.evaluate(() => document.querySelector("[data-listening-step]")?.textContent ?? null);

const taskLine = (page) =>
  page.evaluate(() => document.querySelector("[data-listening-task]")?.textContent ?? null);

const resultBlock = (page) =>
  page.evaluate(
    () => document.querySelector("[data-listening-result]")?.textContent ?? null,
  );

const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors.slice());

/** Answer every question on this screen with its first (good) option. */
async function answerAll(page) {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-listening-answer]")].map((node) =>
      node.getAttribute("data-listening-answer"),
    ),
  );
  const seen = new Set();
  for (const id of ids) {
    const [question] = id.split(":");
    if (seen.has(question)) continue;
    seen.add(question);
    await page.locator(`[data-listening-answer='${id}']`).click();
  }
  return seen.size;
}

const next = (page) => page.locator("[data-listening-action=next]").click();

/* ------------------------------------------------------------- the run */

async function runViewport(browser, size) {
  currentViewport = size.name;
  const { context, page } = await open(browser, size);

  await safe(1, "the route opens, isolated, on the real workspace", async () => {
    await toTab(page);
    const strings = await page.locator("[data-string-line]").count();
    const safety = await page.evaluate(
      () => document.querySelector("[data-listening-safety]")?.textContent ?? "",
    );
    record(1, "the route opens, isolated, on the real workspace",
      strings >= 6 && safety.includes("değiştirmez"),
      `strings=${strings} · "${safety}"`);
    await shot(page, "01-open");
  });

  await safe(2, "it says which build and which device it is on", async () => {
    const header = await page.evaluate(() => ({
      sha: document.querySelector("[data-listening-sha]")?.textContent ?? null,
      viewport: document.querySelector("[data-listening-viewport]")?.textContent ?? null,
      touch: document.querySelector("[data-listening-touch]")?.textContent ?? null,
    }));
    record(2, "it says which build and which device it is on",
      (header.sha ?? "").length >= 7 &&
        (header.viewport ?? "").includes("×") &&
        (header.touch ?? "").startsWith("dokunma"),
      JSON.stringify(header));
  });

  await safe(3, "the production drawer is one tap from a selection", async () => {
    /*
     * The route carries no playback control of its own, so the only way to
     * hear anything is the drawer the product ships. This checks it is
     * reachable from here rather than pressing it — a run that pressed play
     * would be the page testing itself.
     */
    /*
     * With something held, because the drawer belongs to a selection. The
     * press is the guide's own step 1 — hold some notes — made by the same
     * long press a reader makes.
     */
    const bar = await page.locator("[data-bar-drag-index='0']").first().boundingBox();
    if (bar) {
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
      }, bar.x + 17);
      if (y !== null) {
        await page.mouse.move(bar.x + 17, y);
        await page.mouse.down();
        await page.waitForTimeout(750);
        await page.mouse.up();
        await page.waitForTimeout(360);
      }
    }
    const more = await page.getByRole("button", { name: "Daha fazla", exact: true }).count();
    const own = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-listening-action]")].map(
          (node) => (node.textContent ?? "").trim(),
        ),
    );
    record(3, "the production drawer is one tap from a selection",
      more >= 1 && !own.some((label) => /dinle|döngü/i.test(label)),
      `«Daha fazla»=${more} · guide controls=${JSON.stringify(own)}`);
  });

  await safe(4, "all eight steps are reachable, one task each", async () => {
    const seen = [];
    for (let index = 0; index < 8; index += 1) {
      const line = await stepLine(page);
      const task = await taskLine(page);
      seen.push({ line, task });
      await answerAll(page);
      if (index === 7) break;
      await next(page);
      await page.waitForTimeout(160);
    }
    page.__steps = seen;
    record(4, "all eight steps are reachable, one task each",
      seen.length === 8 &&
        seen.every((entry) => (entry.task ?? "").length > 0) &&
        /8\/8/.test(seen[7].line ?? ""),
      seen.map((entry) => entry.line).join(" | "));
    await shot(page, "04-last-step");
  });

  await safe(5, "each step names a production control, not a test one", async () => {
    const tasks = (page.__steps ?? []).map((entry) => entry.task ?? "");
    const named = tasks.filter((task) =>
      /Daha fazla|Seçimi dinle|Seçimden döngü|Seçimi iptal et|Düzen|Tab/.test(task),
    ).length;
    record(5, "each step names a production control, not a test one",
      named >= 5 && !tasks.some((task) => /test|harness|debug/i.test(task)),
      `${named} of ${tasks.length} name a shipped control`);
  });

  await safe(6, "no step speaks the app's own vocabulary", async () => {
    const tasks = (page.__steps ?? []).map((entry) => entry.task ?? "").join(" ");
    const leak = /tick|slot|descriptor|scheduler|schema|validator|commit/i.exec(tasks);
    record(6, "no step speaks the app's own vocabulary", leak === null,
      leak ? `found "${leak[0]}"` : "none");
  });

  await safe(7, "every answer is a real target with a readable name", async () => {
    const found = await page.evaluate(() =>
      [...document.querySelectorAll("[data-listening-answer], [data-listening-action]")].map(
        (node) => {
          const box = node.getBoundingClientRect();
          return {
            label: (node.textContent ?? "").trim(),
            height: Math.round(box.height),
            width: Math.round(box.width),
            clipped: node.scrollWidth > node.clientWidth + 1,
          };
        },
      ),
    );
    const small = found.filter((entry) => entry.height < 44);
    const clipped = found.filter((entry) => entry.clipped);
    record(7, "every answer is a real target with a readable name",
      found.length > 0 && small.length === 0 && clipped.length === 0,
      `controls=${found.length} under44=${small.length} truncated=${clipped.length}`);
  });

  await safe(8, "the block is complete and carries every row", async () => {
    await next(page);
    await page.waitForTimeout(300);
    const block = await resultBlock(page);
    const rows = [
      "Build:",
      "Ekran:",
      "Dokunma noktası:",
      "Ortam:",
      "Functional",
      "Listening",
      "Seçim:",
      "Tek dinleme:",
      "Üç loop turu:",
      "Duraklat/devam:",
      "İptal temizliği:",
      "Tek enstrüman kapsamı:",
      "Tüm enstrüman kapsamı:",
      "Kullanıcı notu:",
      "Verdict:",
    ];
    const missing = rows.filter((row) => !(block ?? "").includes(row));
    page.__block = block;
    record(8, "the block is complete and carries every row", missing.length === 0,
      missing.length === 0 ? `${(block ?? "").split("\n").length} lines` : `missing ${JSON.stringify(missing)}`);
    await shot(page, "08-result");
  });

  await safe(9, "a touch=0 environment never reports a physical pass", async () => {
    /*
     * The rule this whole round turns on. On the desktop context the block
     * must say PARTIAL and say why, however cleanly every step ran.
     */
    const block = page.__block ?? "";
    const verdict = /Verdict: (\w+)/.exec(block)?.[1] ?? "?";
    const desktop = size.desktop === true;
    record(9, "a touch=0 environment never reports a physical pass",
      desktop
        ? verdict === "PARTIAL" && block.includes("fiziksel cihaz kanıtı değildir")
        : verdict === "PASS",
      `${desktop ? "touch=0" : "touch device"} → ${verdict}`);
  });

  await safe(10, "the block claims nothing about how it sounded", async () => {
    const block = (page.__block ?? "").toLowerCase();
    const hits = ["organik", "kalite", "daha iyi", "daha güzel", "zengin"].filter((word) =>
      block.includes(word),
    );
    record(10, "the block claims nothing about how it sounded", hits.length === 0,
      hits.join(", ") || "no quality claim");
  });

  await safe(11, "the app wrote nothing to the console", async () => {
    const errors = (await consoleErrors(page)).filter(
      (text) => !/favicon|AudioContext was not allowed/i.test(text),
    );
    record(11, "the app wrote nothing to the console", errors.length === 0,
      errors.slice(0, 2).join(" | ").slice(0, 200));
  });

  await context.close();

  /* ------------------------------------- the gate, on its own page load */

  await safe(12, "a link for another build refuses to start the test", async () => {
    const wrong = await open(browser, size, "?sha=0000000");
    const blocked = await wrong.page
      .locator("[data-listening-wrong-version]")
      .count()
      .catch(() => 0);
    const started = await wrong.page.locator("[data-string-line]").count();
    record(12, "a link for another build refuses to start the test",
      blocked === 1 && started === 0,
      `refusal=${blocked} staff drawn=${started}`);
    await shot(wrong.page, "12-wrong-sha");
    await wrong.context.close();
  });

  await safe(13, "and the right build's link starts it", async () => {
    /* The sha the page itself reports, so the pair is a real comparison. */
    const probe = await open(browser, size);
    const sha = await probe.page.evaluate(
      () => document.querySelector("[data-listening-sha]")?.textContent ?? "",
    );
    await probe.context.close();
    const right = await open(browser, size, `?sha=${sha}`);
    const blocked = await right.page.locator("[data-listening-wrong-version]").count();
    await toTab(right.page);
    const started = await right.page.locator("[data-string-line]").count();
    record(13, "and the right build's link starts it",
      blocked === 0 && started >= 6, `sha=${sha} refusal=${blocked} strings=${started}`);
    await right.context.close();
  });

  await safe(14, "the reader's own project was never written to", async () => {
    /*
     * Seeded before the page's first line and read back after a whole run,
     * because "this test does not change your music" is the promise printed
     * on its own header.
     */
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: !size.desktop,
      isMobile: !size.desktop,
      ...(size.ua ? { userAgent: size.ua } : {}),
    });
    const sentinel = JSON.stringify({ sentinel: "founder's own project" });
    await context.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* a private window is not a reason to fail the run */
        }
      },
      ["aranje.project.1", sentinel],
    );
    const page = await context.newPage();
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    for (let index = 0; index < 8; index += 1) {
      await answerAll(page);
      await page.locator("[data-listening-action=next]").click();
      await page.waitForTimeout(140);
    }
    const kept = await page.evaluate((key) => localStorage.getItem(key), "aranje.project.1");
    record(14, "the reader's own project was never written to", kept === sentinel,
      kept === sentinel ? "sentinel intact" : `now ${String(kept).slice(0, 60)}`);
    await context.close();
  });
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
