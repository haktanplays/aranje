/**
 * The founder acceptance route, tested as a route (2U-A handoff §8).
 *
 * This does **not** test the editor. The editor was tested in
 * `eval/editor-parity`, and the operations in the seven steps need a person
 * doing long presses on particular notes. What this asks is whether the
 * *route* is fit to be handed to that person:
 *
 * - can all seven steps be reached on a 320px phone and on a desktop;
 * - does going back keep what was already answered;
 * - does restart give a clean session;
 * - is the reader's own store byte-identical afterwards;
 * - does it ask for no permission and call nothing outside the origin;
 * - does a link carrying the wrong commit refuse to start;
 * - and — the one that matters most — does a run where **nothing was done**
 *   report that honestly rather than passing.
 *
 * That last one is why this harness walks the steps without performing the
 * operations. A route that reported PASS for a founder who pressed "Yaptım"
 * seven times without touching the staff would be worse than no route.
 *
 *   PORT=3104 ./eval/chord-audio/serve.sh
 *   BASE_URL=http://127.0.0.1:3104 node eval/editor-handoff/verify.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3104";
const ROUTE = "/eval/editor-acceptance";
const OUT = process.env.HANDOFF_OUT ?? "eval/editor-handoff/artifacts";
mkdirSync(OUT, { recursive: true });

const ONLY = process.env.HANDOFF_ONLY ?? "";
const VIEWPORTS = [
  { name: "320x700", width: 320, height: 700 },
  { name: "390x844", width: 390, height: 844 },
  {
    name: "412x915",
    width: 412,
    height: 915,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  },
  { name: "1363x936", width: 1363, height: 936, desktop: true },
];

const results = [];
let shots = 0;
let viewport = "";
let lastPage = null;

const flush = () =>
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      { results, failed: results.filter((entry) => !entry.pass).length, shots },
      null,
      2,
    )}\n`,
  );

const record = (step, name, pass, detail = "") => {
  results.push({ viewport, step, name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${viewport} ${step} ${name}${detail ? `  — ${detail}` : ""}`,
  );
  flush();
};

async function safe(step, name, fn) {
  try {
    await fn();
  } catch (error) {
    await lastPage?.screenshot({ path: `${OUT}/failed-${viewport}-${step}.png` }).catch(() => {});
    record(step, name, false, String(error).split("\n")[0].slice(0, 110));
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${viewport}-${name}.png` });
  shots += 1;
}

/**
 * Seed the device's own store before the route loads.
 *
 * Without something in it, "the reader's own music was not touched" is a
 * claim about an empty store — which is true of a route that wipes it. The
 * value is written from the harness, so what the route must preserve is
 * something it never wrote.
 */
const SEED = { "aranje.projects": '{"seeded":true}', "not.aranje": "keep me" };

async function openRoute(browser, size, query = "") {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: !size.desktop,
    isMobile: !size.desktop,
    deviceScaleFactor: size.desktop ? 1 : 2,
    ...(size.userAgent ? { userAgent: size.userAgent } : {}),
    /* Any prompt would be an automatic failure; refuse them all up front. */
    permissions: [],
  });
  await context.addInitScript((entries) => {
    try {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    } catch {
      /* a private window is not a reason to fail the run */
    }
    window.__requests = [];
    window.__permissionAsks = 0;
    const origin = window.location.origin;
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        const url = new URL(String(input instanceof Request ? input.url : input), origin);
        if (url.origin !== origin) window.__requests.push(url.href);
      } catch {
        /* an unparseable url is not an outward request */
      }
      return originalFetch.call(this, input, init);
    };
    if (navigator.permissions?.query) {
      const original = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (...args) => {
        window.__permissionAsks += 1;
        return original(...args);
      };
    }
  }, Object.entries(SEED));

  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${BASE}${ROUTE}${query}`, { waitUntil: "networkidle" });
  /*
   * Wait for the route to have decided what it is showing — a task, a refused
   * version, or a blocked session. Pressing before that is pressing at a tree
   * that is still mounting the workspace underneath, and the button moves.
   */
  await page
    .waitForSelector(
      "[data-acceptance-task], [data-acceptance-wrong-version], [data-acceptance-blocked]",
    )
    .catch(() => {});
  await page.waitForTimeout(900);
  return { context, page, errors };
}

/**
 * Press a guide control the way a finger does.
 *
 * The guide scrolls, so a control can be below its own fold — and a click
 * aimed at an element that is not in view is a click that times out for a
 * reason that has nothing to do with the product. Waiting for it and
 * scrolling it into view first is what a person does without thinking.
 */
async function press(page, selector) {
  const target = page.locator(selector).first();
  await target.waitFor({ state: "visible" });
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.waitForTimeout(150);
}

const text = (page, selector) =>
  page.locator(selector).first().innerText().catch(() => "");

const deviceStore = (page) =>
  page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null) keys.push(key);
    }
    keys.sort();
    return JSON.stringify(keys.map((key) => [key, localStorage.getItem(key)]));
  });

/** Press "Yaptım" until the run ends, without performing any operation. */
async function walkAllSteps(page) {
  const seen = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const did = page.locator("[data-acceptance-action=did]");
    if ((await did.count()) === 0) break;
    seen.push(await text(page, "[data-acceptance-step]"));
    await did.scrollIntoViewIfNeeded();
    await did.click();
    await page.waitForTimeout(120);
  }
  return seen;
}

async function runViewport(browser, size) {
  viewport = size.name;
  const { context, page, errors } = await openRoute(browser, size);
  const before = await deviceStore(page);

  try {
    await safe(1, "the route opens and names the build", async () => {
      const header = await text(page, "[data-acceptance-header]");
      const sha = await text(page, "[data-acceptance-sha]");
      record(
        1,
        "the route opens and names the build",
        header.includes("Editör kabulü") && sha.length >= 7,
        `sha=${sha} header="${header.replace(/\n/g, " ")}"`,
      );
      await shot(page, "01-open");
    });

    await safe(2, "it promises not to touch the reader's music, on screen", async () => {
      const safety = await text(page, "[data-acceptance-safety]");
      record(
        2,
        "it promises not to touch the reader's music, on screen",
        safety.includes("gerçek projeni değiştirmez"),
        safety,
      );
    });

    await safe(3, "the real workspace is mounted under the guide", async () => {
      const surfaces = await page
        .locator("[data-arrangement-scroller], [data-tab-content]")
        .count();
      const guide = await page.locator("[data-acceptance-guide]").count();
      record(
        3,
        "the real workspace is mounted under the guide",
        surfaces >= 1 && guide === 1,
        `surfaces=${surfaces} guide=${guide}`,
      );
    });

    await safe(4, "one task is on screen, not seven", async () => {
      const tasks = await page.locator("[data-acceptance-task]").count();
      const task = await text(page, "[data-acceptance-task]");
      record(4, "one task is on screen, not seven", tasks === 1 && task.length > 8, `"${task}"`);
    });

    await safe(5, "every step is reachable, and the last one ends the run", async () => {
      const seen = await walkAllSteps(page);
      const stepsNamed = new Set(seen.map((line) => line.split("·")[0]?.trim()));
      const finished = (await page.locator("[data-acceptance-result]").count()) === 1;
      record(
        5,
        "every step is reachable, and the last one ends the run",
        stepsNamed.size === 7 && finished,
        `steps=${stepsNamed.size} screens=${seen.length} finished=${finished}`,
      );
      await shot(page, "05-result");
    });

    /*
     * The one that matters most. Nothing was done, so nothing may pass.
     */
    await safe(6, "a run where nothing was done does not report a pass", async () => {
      const block = await page.locator("[data-acceptance-result]").inputValue();
      const verdict = /Automated verdict: (\w+)/.exec(block)?.[1] ?? "?";
      record(
        6,
        "a run where nothing was done does not report a pass",
        verdict === "FAIL" || verdict === "PARTIAL",
        `verdict=${verdict}`,
      );
    });

    await safe(7, "the founder line is never filled in by the page", async () => {
      const block = await page.locator("[data-acceptance-result]").inputValue();
      record(
        7,
        "the founder line is never filled in by the page",
        block.includes("Founder verdict: Haktan doldurmadı"),
        (/Founder verdict:.*/.exec(block) ?? ["missing"])[0],
      );
    });

    await safe(8, "the block carries every row the handoff asks for", async () => {
      const block = await page.locator("[data-acceptance-result]").inputValue();
      const rows = [
        "Devam:",
        "Kopyala/yapıştır:",
        "Undo/redo:",
        "Zamanda taşı:",
        "Perde taşı:",
        "Telde taşı:",
        "Nota/ölçü ayrımı:",
        "Ölçü işlemleri:",
        "Çoklu ölçü:",
        "UI Contract:",
        "User storage unchanged:",
        "Console errors:",
      ];
      const missing = rows.filter((row) => !block.includes(row));
      record(8, "the block carries every row the handoff asks for", missing.length === 0, missing.join(","));
    });

    await safe(9, "the questions are asked, and an answer sticks", async () => {
      const buttons = page.locator("[data-acceptance-answer]");
      const count = await buttons.count();
      if (count > 0) await press(page, "[data-acceptance-answer]");
      const pressed = await buttons.first().getAttribute("aria-pressed");
      record(
        9,
        "the questions are asked, and an answer sticks",
        count >= 9 && pressed === "true",
        `options=${count} pressed=${pressed}`,
      );
    });

    await safe(10, "a note can be typed and reaches the block", async () => {
      await page.locator("[data-acceptance-notes]").fill("dokunma testi notu");
      await page.waitForTimeout(150);
      const block = await page.locator("[data-acceptance-result]").inputValue();
      record(
        10,
        "a note can be typed and reaches the block",
        block.includes("dokunma testi notu"),
        block.includes("dokunma testi notu") ? "" : "not in block",
      );
    });

    await safe(11, "the result is there to copy even without clipboard rights", async () => {
      const value = await page.locator("[data-acceptance-result]").inputValue();
      const copy = await page.locator("[data-acceptance-action=copy]").count();
      record(
        11,
        "the result is there to copy even without clipboard rights",
        value.length > 200 && copy === 1,
        `chars=${value.length} button=${copy}`,
      );
    });

    await safe(12, "going back keeps the answer that was already given", async () => {
      const fresh = await openRoute(browser, size);
      await press(fresh.page, "[data-acceptance-action=did]");
      const second = await text(fresh.page, "[data-acceptance-task]");
      await press(fresh.page, "[data-acceptance-action=back]");
      const first = await text(fresh.page, "[data-acceptance-task]");
      await press(fresh.page, "[data-acceptance-action=did]");
      const again = await text(fresh.page, "[data-acceptance-task]");
      record(
        12,
        "going back keeps the answer that was already given",
        first !== second && again === second,
        `back="${first.slice(0, 24)}" forward="${again.slice(0, 24)}"`,
      );
      await fresh.context.close();
    });

    await safe(13, "restart gives a clean session", async () => {
      const fresh = await openRoute(browser, size);
      await walkAllSteps(fresh.page);
      /* The restart control only exists once the run has actually ended. */
      await fresh.page.waitForSelector("[data-acceptance-result]");
      await press(fresh.page, "[data-acceptance-action=restart]");
      await fresh.page.waitForLoadState("networkidle");
      await fresh.page.waitForTimeout(700);
      const step = await text(fresh.page, "[data-acceptance-step]");
      const back = (await fresh.page.locator("[data-acceptance-result]").count()) === 0;
      record(
        13,
        "restart gives a clean session",
        step.includes("1/") && back,
        `step="${step}" resultGone=${back}`,
      );
      await fresh.context.close();
    });

    await safe(14, "the device's own store is byte-identical afterwards", async () => {
      const after = await deviceStore(page);
      record(
        14,
        "the device's own store is byte-identical afterwards",
        after === before,
        after === before ? "" : `before=${before.slice(0, 60)} after=${after.slice(0, 60)}`,
      );
    });

    await safe(15, "nothing was asked of the network or the device", async () => {
      const outward = await page.evaluate(() => window.__requests ?? []);
      const asks = await page.evaluate(() => window.__permissionAsks ?? 0);
      record(
        15,
        "nothing was asked of the network or the device",
        outward.length === 0 && asks === 0,
        `outward=${outward.length} permissions=${asks} ${outward.slice(0, 2).join(",")}`,
      );
    });

    await safe(16, "the page never scrolls sideways", async () => {
      const overflow = await page.evaluate(
        () => document.body.scrollWidth - document.body.clientWidth,
      );
      record(16, "the page never scrolls sideways", overflow <= 0, `overflow=${overflow}`);
    });

    await safe(17, "every guide control is a 44px target", async () => {
      const small = await page
        .locator("[data-acceptance-action], [data-acceptance-answer]")
        .evaluateAll(
          (nodes) =>
            nodes.filter((node) => {
              const box = node.getBoundingClientRect();
              return box.width > 0 && Math.min(box.width, box.height) < 44;
            }).length,
        );
      record(17, "every guide control is a 44px target", small === 0, `under44=${small}`);
    });

    await safe(18, "a link carrying the wrong commit refuses to start", async () => {
      const wrong = await openRoute(browser, size, "?sha=deadbee");
      const message = await text(wrong.page, "[data-acceptance-wrong-version]");
      const started = await wrong.page.locator("[data-acceptance-task]").count();
      record(
        18,
        "a link carrying the wrong commit refuses to start",
        message.includes("Yanlış sürüm") && started === 0,
        `"${message}" tasks=${started}`,
      );
      await shot(wrong.page, "18-wrong-version");
      await wrong.context.close();
    });

    await safe(19, "the right commit is allowed through", async () => {
      const sha = await text(page, "[data-acceptance-sha]");
      const right = await openRoute(browser, size, `?sha=${sha}`);
      const started = await right.page.locator("[data-acceptance-task]").count();
      const block = await right.page.locator("[data-acceptance-wrong-version]").count();
      record(
        19,
        "the right commit is allowed through",
        started === 1 && block === 0,
        `sha=${sha} tasks=${started}`,
      );
      await right.context.close();
    });

    /*
     * A desktop has no touch, and a desktop run is not a phone run. The route
     * may not turn one into the other by reporting a pass that reads like a
     * physical acceptance.
     */
    await safe(20, "a run without touch does not read as a physical pass", async () => {
      const block = await page.locator("[data-acceptance-result]").inputValue();
      const touchLine = /Touch: (\d+)/.exec(block)?.[1] ?? "?";
      const founder = block.includes("Founder verdict: Haktan doldurmadı");
      record(
        20,
        "a run without touch does not read as a physical pass",
        founder && touchLine === (size.desktop ? "0" : touchLine),
        `touch=${touchLine} founderOpen=${founder}`,
      );
    });

    await safe(21, "nothing threw while all of that happened", async () => {
      record(21, "nothing threw while all of that happened", errors.length === 0, errors.slice(0, 2).join(" | "));
    });
  } finally {
    await context.close();
  }
}

async function run() {
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
    `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${
      results.length
    } adım, ${shots} ekran görüntüsü`,
  );
  if (failed.length > 0) {
    for (const entry of failed) {
      console.log(`  ${entry.viewport} ${entry.step} ${entry.name} — ${entry.detail}`);
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
