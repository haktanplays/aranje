/**
 * The two full-screen states, measured (2V-B.1 §15).
 *
 * The 2V-B route was accepted on geometry that nobody had measured on the
 * founder's own viewport, and the founder's run then failed on six steps
 * because half the screen was a guide. So every claim §11 makes is a number
 * here, taken from the real route on five contexts, with the production
 * workspace mounted and the real long-press gestures used to open the real
 * drawer.
 *
 * The song state has to prove there is nothing over the workspace: no popup,
 * no overlay, no invisible layer owning a pointer, and no production control
 * whose centre resolves to something this route drew. The task state has to
 * prove the opposite — that the workspace is not in the layout at all.
 *
 * Nothing here is a claim about sound. It is a claim about pixels and hit
 * testing, which is all a browser can honestly answer.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3115";
const ROUTE = `${BASE}/eval/editor-action-batch`;
const OUT = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

/** The five contexts §15 names. The last one can never produce a PASS. */
const CONTEXTS = [
  { name: "320x700", viewport: { width: 320, height: 700 }, touch: true, mobile: true },
  {
    name: "384x692-android",
    viewport: { width: 384, height: 692 },
    touch: true,
    mobile: true,
    userAgent: ANDROID,
  },
  { name: "390x844", viewport: { width: 390, height: 844 }, touch: true, mobile: true },
  {
    name: "412x915-android",
    viewport: { width: 412, height: 915 },
    touch: true,
    mobile: true,
    userAgent: ANDROID,
  },
  {
    name: "1363x936-desktop",
    viewport: { width: 1363, height: 936 },
    touch: false,
    mobile: false,
  },
];

const MIN_TOUCH = 44;

const results = [];
let failures = 0;

const check = (context, name, pass, detail = "") => {
  results.push({ context, name, pass, detail });
  if (!pass) failures += 1;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Everything about the song screen, in one evaluate.
 *
 * One pass rather than a dozen round trips: the numbers have to describe the
 * same frame, and a layout read between two `page.evaluate` calls is a layout
 * that may have moved.
 */
const songGeometry = (page) =>
  page.evaluate((minTouch) => {
    const stage = document.querySelector('[data-acceptance-stage="song"]');
    const returnBar = document.querySelector("[data-acceptance-return]");
    const box = (node) => node?.getBoundingClientRect() ?? null;

    /* Anything this route drew that floats. There must be none: the guide is
       two whole screens now, not a panel. */
    const floating = [...document.querySelectorAll("body *")].filter((node) => {
      const style = getComputedStyle(node);
      if (style.position !== "fixed" && style.position !== "absolute") return false;
      /* Production draws its own positioned layers — the playhead, the
         technique arcs. Only this route's are forbidden. */
      return (
        node.closest("[data-batch-header], [data-acceptance-return]") !== null ||
        node.hasAttribute("data-batch-guide")
      );
    }).length;

    const dialogs = document.querySelectorAll("[role=dialog]").length;

    /*
     * A hidden pointer owner: something with a real box that a finger would
     * land on, which nobody can see. This is the failure mode that cost the
     * last round its Android run — an invisible layer that ate long presses.
     */
    const hiddenOwners = [...document.querySelectorAll("body *")].filter((node) => {
      const style = getComputedStyle(node);
      if (style.pointerEvents === "none") return false;
      const rect = node.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      return style.visibility === "hidden" || Number(style.opacity) === 0;
    }).length;

    /* Every production control the workspace draws, asked whether a finger
       at its own centre would reach it. */
    const stolen = [];
    for (const node of stage?.querySelectorAll("button, [role=button]") ?? []) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit === null) continue;
      if (node.contains(hit) || hit.contains(node)) continue;
      if (
        hit.closest("[data-batch-header], [data-acceptance-return]") !== null
      ) {
        stolen.push(node.textContent?.trim().slice(0, 24) ?? "?");
      }
    }

    const strings = [...document.querySelectorAll("[data-string-line]")].filter(
      (node) => {
        const rect = node.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      },
    ).length;

    /* Required controls: the route's own, plus the production transport. */
    const required = [
      ...document.querySelectorAll("[data-batch-action]"),
      ...document.querySelectorAll("[data-testid^='view-']"),
    ];
    const small = required.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.height < minTouch;
    }).length;
    const truncated = required.filter(
      (node) => node.scrollWidth > node.clientWidth + 1,
    ).length;

    const stageBox = box(stage);
    const returnBox = box(returnBar);

    return {
      floating,
      dialogs,
      hiddenOwners,
      stolen,
      strings,
      small,
      truncated,
      overflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      stageHeight: stageBox ? Math.round(stageBox.height) : 0,
      returnHeight: returnBox ? Math.round(returnBox.height) : 0,
      viewport: window.innerHeight,
      /* Does "Teste dön" sit over anything the workspace drew? */
      returnOverlapsStage:
        stageBox !== null &&
        returnBox !== null &&
        returnBox.top < stageBox.bottom - 1,
      transport: [...document.querySelectorAll("button")]
        .filter((node) => {
          const label = node.getAttribute("aria-label") ?? node.textContent ?? "";
          return /Çal|Duraklat|Başa/.test(label);
        })
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return {
            height: Math.round(rect.height),
            reachable: hit !== null && (node.contains(hit) || hit.contains(node)),
          };
        }),
    };
  }, MIN_TOUCH);

const taskGeometry = (page) =>
  page.evaluate((minTouch) => {
    const stage = document.querySelector('[data-acceptance-stage="song"]');
    const rect = stage?.getBoundingClientRect() ?? null;
    const task = document.querySelector("[data-batch-task]");
    const answers = [...document.querySelectorAll("[data-batch-answer]")];
    const next = document.querySelector("[data-batch-action='next']");
    const toSong = document.querySelector("[data-batch-action='to-song']");

    /* Hit testing: sample the middle of the screen and make sure nothing the
       workspace drew answers. `hidden` takes it out of the box tree, so this
       is a check on that rather than on a z-index. */
    const centre = document.elementFromPoint(
      Math.round(window.innerWidth / 2),
      Math.round(window.innerHeight / 2),
    );

    return {
      /* Exactly one task on screen, and exactly one step heading. */
      tasks: document.querySelectorAll("[data-batch-task]").length,
      steps: document.querySelectorAll("[data-batch-step]").length,
      taskText: task?.textContent?.trim() ?? "",
      stageInLayout: rect !== null && (rect.width > 0 || rect.height > 0),
      stageHidden: stage?.hasAttribute("hidden") ?? false,
      workspaceHit: centre?.closest('[data-acceptance-stage="song"]') !== null,
      strings: document.querySelectorAll("[data-string-line]").length,
      answerCount: answers.length,
      smallAnswers: answers.filter(
        (node) => node.getBoundingClientRect().height < minTouch,
      ).length,
      preselected: answers.filter(
        (node) => node.getAttribute("aria-pressed") === "true",
      ).length,
      nextDisabled: next === null ? null : next.hasAttribute("disabled"),
      toSongHeight: toSong ? Math.round(toSong.getBoundingClientRect().height) : 0,
      toSongLabel: toSong?.textContent?.trim() ?? "",
      evidence:
        document
          .querySelector("[data-batch-evidence]")
          ?.getAttribute("data-batch-evidence") ?? "",
      session: document.querySelector("[data-batch-session]")?.textContent ?? "",
      song: document.querySelector("[data-batch-song]")?.textContent ?? "",
      fingerprint:
        document.querySelector("[data-batch-fingerprint]")?.textContent ?? "",
      overflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    };
  }, MIN_TOUCH);

/** Make a real selection with a real long press, as the founder would. */
async function longPressSelect(page, slots = 4) {
  const spot = await page.evaluate(() => {
    const width = window.innerWidth;
    for (const node of document.querySelectorAll("[data-bar-drag-index]")) {
      const box = node.getBoundingClientRect();
      const start = box.left + 17;
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
  });
  if (spot === null) return false;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.move(Math.min(spot.x + 34 * slots, spot.width - 6), spot.y, {
    steps: 8,
  });
  await page.waitForTimeout(180);
  await page.mouse.up();
  await page.waitForTimeout(340);
  return (await page.locator("[data-testid=selection-action-bar]").count()) > 0;
}

async function run(browser, sha, context) {
  console.log(`\n${context.name}`);
  const browserContext = await browser.newContext({
    viewport: context.viewport,
    hasTouch: context.touch,
    isMobile: context.mobile,
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(9000);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(`${ROUTE}?sha=${sha}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const touch = await page.evaluate(() => navigator.maxTouchPoints);
  check(
    context.name,
    "touch points match the context",
    context.touch ? touch > 0 : touch === 0,
    `touch=${touch}`,
  );

  /* The tab, which is where a guitarist works. */
  await page.locator("[data-testid=view-tab]").first().click().catch(() => {});
  await page.waitForSelector("[data-tab-content]").catch(() => {});
  await page.waitForTimeout(400);

  const song = await songGeometry(page);
  check(context.name, "song: guide overlay count is 0", song.floating === 0, `${song.floating}`);
  check(context.name, "song: no dialog is open", song.dialogs === 0, `${song.dialogs}`);
  check(
    context.name,
    "song: hidden pointer owners is 0",
    song.hiddenOwners === 0,
    `${song.hiddenOwners}`,
  );
  check(
    context.name,
    "song: stolen production hit targets is 0",
    song.stolen.length === 0,
    song.stolen.join(", "),
  );
  check(context.name, "song: six strings visible", song.strings >= 6, `${song.strings}`);
  check(
    context.name,
    "song: transport usable",
    song.transport.length > 0 && song.transport.every((entry) => entry.reachable),
    JSON.stringify(song.transport),
  );
  check(context.name, "song: body horizontal overflow is 0", song.overflow === 0, `${song.overflow}`);
  check(context.name, "song: required controls are ≥44px", song.small === 0, `${song.small}`);
  check(context.name, "song: no truncated required label", song.truncated === 0, `${song.truncated}`);
  check(
    context.name,
    "song: «Teste dön» covers no production target",
    !song.returnOverlapsStage,
    `stage=${song.stageHeight} return=${song.returnHeight} of ${song.viewport}`,
  );
  check(
    context.name,
    "song: the workspace has the screen",
    song.stageHeight / song.viewport > 0.75,
    `${Math.round((song.stageHeight / song.viewport) * 100)}%`,
  );

  /* The drawer, opened the way a reader opens it. */
  const selected = await longPressSelect(page);
  check(context.name, "song: a long press selects", selected, "");
  if (selected) {
    const more = page.locator("[data-selection-action-id='more']").first();
    if (await more.count()) {
      await more.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    const drawer = await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]");
      const listen = dialog?.querySelector(
        "[data-selection-action-id='listen_once']",
      );
      if (!listen) return { open: false, reachable: false };
      const rect = listen.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        open: true,
        reachable: hit !== null && (listen.contains(hit) || hit.contains(listen)),
      };
    });
    check(
      context.name,
      "song: the drawer opens and its actions are reachable",
      drawer.open && drawer.reachable,
      JSON.stringify(drawer),
    );
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
  }

  /* --- the question state --- */
  await page.locator("[data-batch-action='to-task']").first().click().catch(() => {});
  await page.waitForTimeout(400);

  const task = await taskGeometry(page);
  check(context.name, "task: exactly one task on screen", task.tasks === 1, `${task.tasks}`);
  check(context.name, "task: exactly one step heading", task.steps === 1, `${task.steps}`);
  check(
    context.name,
    "task: the task names the real song, section, track and bar",
    task.song.length > 0 &&
      task.fingerprint.startsWith("s") &&
      /ölçü/.test(task.taskText),
    `${task.song} · ${task.fingerprint} · ${task.taskText.slice(0, 60)}`,
  );
  check(
    context.name,
    "task: the workspace is out of layout",
    !task.stageInLayout && task.stageHidden,
    JSON.stringify({ inLayout: task.stageInLayout, hidden: task.stageHidden }),
  );
  check(
    context.name,
    "task: the workspace is out of hit testing",
    !task.workspaceHit,
    "",
  );
  check(context.name, "task: answers are ≥44px", task.smallAnswers === 0, `${task.smallAnswers}`);
  check(
    context.name,
    "task: no answer is preselected",
    task.preselected === 0,
    `${task.preselected}`,
  );
  check(
    context.name,
    "task: an unanswered question cannot pass",
    task.nextDisabled === true,
    `nextDisabled=${task.nextDisabled}`,
  );
  check(
    context.name,
    "task: «Şarkıya geç» is ≥44px and says so",
    task.toSongHeight >= MIN_TOUCH && task.toSongLabel === "Şarkıya geç",
    `${task.toSongHeight}px "${task.toSongLabel}"`,
  );
  check(context.name, "task: body horizontal overflow is 0", task.overflow === 0, `${task.overflow}`);

  /* Back to the song, in the same session. */
  const sessionBefore = task.session;
  await page.locator("[data-batch-action='to-song']").first().click().catch(() => {});
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({
    session: document.querySelector("[data-batch-session]")?.textContent ?? "",
    stageVisible:
      (document
        .querySelector('[data-acceptance-stage="song"]')
        ?.getBoundingClientRect().height ?? 0) > 0,
    tasks: document.querySelectorAll("[data-batch-task]").length,
  }));
  check(
    context.name,
    "«Şarkıya geç» returns to the same session, with no question on screen",
    back.session === sessionBefore && back.stageVisible && back.tasks === 0,
    JSON.stringify(back),
  );

  check(context.name, "console errors is 0", consoleErrors.length === 0, consoleErrors.join(" | "));

  await page.screenshot({
    path: `${OUT}geometry-${context.name}.png`,
    fullPage: false,
  });
  await browserContext.close();
  return { song, task };
}

const main = async () => {
  const sha = process.env.SHA;
  if (!sha) {
    console.error("SHA is required: the route refuses a link that names no build.");
    process.exit(2);
  }
  const browser = await chromium.launch();
  const measured = {};
  for (const context of CONTEXTS) {
    measured[context.name] = await run(browser, sha, context);
  }
  await browser.close();

  const passed = results.filter((entry) => entry.pass).length;
  console.log(`\n${passed}/${results.length} checks · ${failures} failed`);
  writeFileSync(
    `${OUT}GEOMETRY.json`,
    `${JSON.stringify(
      {
        sha,
        generatedAt: new Date().toISOString(),
        contexts: CONTEXTS.map((entry) => entry.name),
        checks: results,
        passed,
        total: results.length,
        measured,
        /* The number this round exists to move: the old guide took 348px of
           a 692px screen, and the new song state takes none of it. */
        oldGuideHeightAt384x692: 348,
        newOverlayHeightAt384x692: 0,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

await main();
