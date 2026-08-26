/**
 * The multi-track view, the writable new track and the mobile transport,
 * measured in a real browser (2Q-A §16).
 *
 * The rule every earlier checkpoint settled on holds here: a claim is
 * measured on the thing it is about. "One scroller" is a count of elements
 * that actually scroll horizontally; "one write" is a count of physical
 * `setItem` calls by key kind; "the lanes line up" is a comparison of
 * bounding boxes, not of the model that produced them.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/multitrack/verify.mjs
 *   ONE_VIEWPORT=1 node eval/multitrack/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { LEDGER, takeLedger } from "../projects/ledger.mjs";
import { leaveEditing } from "../shared/harness.mjs";
import { device, seed, twoProjects } from "./device.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/multitrack/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const record_ = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 180) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const ONLY = (process.env.MULTI_ONLY ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

async function safe(label, run) {
  if (ONLY.length > 0 && !ONLY.some((entry) => label.includes(entry))) return;
  try {
    await run();
  } catch (error) {
    const lines = String(error).split("\n");
    const where = lines.find((l) => l.includes("waiting for")) ?? "";
    record_(`${label} (threw)`, false, `${lines[0]} ${where}`.trim());
  }
}

/**
 * Counters installed before the app's first line.
 *
 * The AudioContext count comes through a Proxy on the constructor rather
 * than a subclass — a subclass breaks Tone's decoder and measures the
 * instrument instead of the app (2O-B.1 §3).
 */
const COUNTERS = `
  window.__playheadProbe = { scheduled: {}, drawn: {}, live: {} };
  window.__sampleRequests = 0;
  window.__externalRequests = [];
  (() => {
    const original = window.fetch;
    window.fetch = function (input, init) {
      const url = String(typeof input === "string" ? input : (input && input.url) || "");
      if (url.indexOf("/samples/") !== -1) window.__sampleRequests += 1;
      if (/^https?:\\/\\//.test(url) && url.indexOf(location.origin) !== 0) {
        window.__externalRequests.push(url);
      }
      return original.call(this, input, init);
    };
  })();
`;

async function boot(browser, viewport, storage) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries, ledger, counters]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(ledger);
      (0, eval)(counters);
    },
    [Object.entries(storage), LEDGER, COUNTERS],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  await takeLedger(page);
  return { context, page, errors };
}

/* ----------------------------------------------------------- measurements */

const view = (page, id) => page.getByTestId(`view-${id}`);
/**
 * Change surface the way a reader does (2S-A §18).
 *
 * The view switch stands down while a bar is being edited so the six-string
 * staff can own rows a finger can hit; "Bitti" brings it back. Reaching for
 * the switch without coming out first waits on a withdrawn control.
 */
async function toView(page, id) {
  await leaveEditing(page);
  await view(page, id).click();
}
const play = (page) => page.locator("footer button[aria-label='Çal']");
const pause = (page) => page.locator("footer button[aria-label='Duraklat']");

/** Every element on the page that really scrolls horizontally right now. */
const scrollerCount = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return (
          (s.overflowX === "auto" || s.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1
        );
      }).length,
  );

/** Every element declaring itself a horizontal scroller, scrolling or not. */
const declaredScrollers = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return s.overflowX === "auto" || s.overflowX === "scroll";
      }).length,
  );

const laneBarX = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-multi-lane]")].map((lane) => [
        lane.getAttribute("data-multi-lane"),
        [...lane.querySelectorAll("[data-bar-key]")].map((el) =>
          Math.round(el.getBoundingClientRect().left * 10) / 10,
        ),
      ]),
    ),
  );

const transportShot = (page) =>
  page.evaluate(() => {
    const footer = document.querySelector("footer");
    const row = footer?.querySelector(":scope > div.flex");
    const vw = document.documentElement.clientWidth;
    const buttons = [...(footer?.querySelectorAll("button") ?? [])];
    const controls = buttons.map((b) => {
      const box = b.getBoundingClientRect();
      const visible = Math.max(0, Math.min(box.right, vw) - Math.max(box.left, 0));
      return {
        label: b.getAttribute("aria-label") ?? "",
        w: Math.round(box.width * 10) / 10,
        h: Math.round(box.height * 10) / 10,
        clipped: Math.round((box.width - visible) * 10) / 10,
        ok44: box.width >= 43.5 && box.height >= 43.5,
      };
    });
    const style = row ? getComputedStyle(row) : null;
    const kids = row ? [...row.children] : [];
    const gap = style ? parseFloat(style.columnGap || style.gap || "0") || 0 : 0;
    const pad = style
      ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      : 0;
    const required =
      kids.reduce((t, k) => t + k.getBoundingClientRect().width, 0) +
      gap * Math.max(0, kids.length - 1) +
      pad;
    return {
      required: Math.round(required * 10) / 10,
      available: row ? Math.round(row.getBoundingClientRect().width * 10) / 10 : 0,
      controls,
      clipped: controls.filter((c) => c.clipped > 0.5).length,
      below44: controls.filter((c) => !c.ok44).length,
      bodyOverflow: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
      count: controls.length,
    };
  });

const probeLive = (page) =>
  page.evaluate(() => {
    const live = window.__playheadProbe?.live ?? {};
    return Object.values(live).reduce((total, n) => total + (n ?? 0), 0);
  });

const contexts = (page) => page.evaluate(() => window.__audioContexts ?? 0);

/* ------------------------------------------------------------- the tour */

async function run(page, errors, vp) {
  const at = (name) => `[${vp}] ${name}`;

  /* -- 1..4 the three surfaces ------------------------------------------ */
  await safe(at("1 açılış varsayılan Düzen"), async () => {
    const selected = await page.evaluate(() =>
      document.querySelector("[data-view-switch] button[aria-selected='true']")
        ?.textContent?.trim(),
    );
    record_(at("1 açılış varsayılan Düzen"), selected === "Düzen", selected);
  });

  await safe(at("2 Çoklu görünüm açılır"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(250);
    const lanes = await page.locator("[data-multi-lane]").count();
    record_(at("2 Çoklu görünüm açılır"), lanes === 4, `${lanes} şerit`);
  });

  await safe(at("3 Tab açılır"), async () => {
    await toView(page, "tab");
    await page.waitForTimeout(200);
    const n = await page.locator("[data-tab-content]").count();
    record_(at("3 Tab açılır"), n === 1, `${n} tab içeriği`);
  });

  await safe(at("4 üç görünüm arasında geçiş"), async () => {
    const seen = [];
    for (const id of ["arrange", "multi", "tab", "multi", "arrange"]) {
      await view(page, id).click();
      await page.waitForTimeout(150);
      seen.push(
        await page.evaluate(
          () =>
            document.querySelector("[data-view-switch] button[aria-selected='true']")
              ?.getAttribute("data-testid"),
        ),
      );
    }
    record_(
      at("4 üç görünüm arasında geçiş"),
      seen.join(",") === "view-arrange,view-multi,view-tab,view-multi,view-arrange",
      seen.join(","),
    );
  });

  /* -- 5..12 lifecycle -------------------------------------------------- */
  await safe(at("5 AudioContext 1"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(150);
    await play(page).click();
    await page.waitForTimeout(1200);
    const n = await contexts(page);
    record_(at("5 AudioContext 1"), n === 1, String(n));
  });

  await safe(at("7 çalarken canlı rAF 1"), async () => {
    const live = await probeLive(page);
    record_(at("7 çalarken canlı rAF 1"), live === 1, String(live));
  });

  await safe(at("9 tick ilerliyor"), async () => {
    const first = await page.evaluate(() =>
      document.querySelector("[data-multi-content] > div[aria-hidden]")?.getAttribute("style"),
    );
    await page.waitForTimeout(700);
    const second = await page.evaluate(() =>
      document.querySelector("[data-multi-content] > div[aria-hidden]")?.getAttribute("style"),
    );
    record_(at("9 tick ilerliyor"), Boolean(first) && first !== second, "playhead hareket etti");
  });

  /*
   * §6's follow etiquette, measured rather than assumed. A real wheel
   * gesture, because the question is what happens when the *reader* moves
   * the view: a scroll the surface makes on their behalf must not count.
   */
  const headStyle = (page) =>
    page.evaluate(
      () =>
        document
          .querySelector("[data-multi-content] > div[aria-hidden]")
          ?.getAttribute("style") ?? "",
    );
  const multiScroll = (page) =>
    page.evaluate(() =>
      Math.round(document.querySelector("[data-multi-scroll]").scrollLeft),
    );

  await safe(at("51 manuel kaydırma takibi durdurur"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(200);
    if ((await pause(page).count()) === 0) {
      await play(page).click();
      await page.waitForTimeout(900);
    }
    const box = await page.locator("[data-multi-scroll]").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(600, 0);
    await page.waitForTimeout(250);
    const moved = await multiScroll(page);
    const first = await headStyle(page);
    await page.waitForTimeout(900);
    const after = await multiScroll(page);
    const second = await headStyle(page);
    record_(
      at("51 manuel kaydırma takibi durdurur"),
      moved > 40 && Math.abs(after - moved) <= 2 && first !== second,
      `${moved}→${after} · playhead ${first !== second ? "ilerledi" : "durdu"}`,
    );
  });

  await safe(at("52 tekrar Çal takibi geri verir"), async () => {
    const before = await multiScroll(page);
    if ((await pause(page).count()) > 0) await pause(page).click();
    await page.waitForTimeout(250);
    await play(page).click();
    await page.waitForTimeout(900);
    const after = await multiScroll(page);
    record_(
      at("52 tekrar Çal takibi geri verir"),
      before > 40 && after < before,
      `${before}→${after}`,
    );
  });

  await safe(at("8 çalarken üç görünüm geçişi"), async () => {
    const before = await contexts(page);
    for (const id of ["tab", "arrange", "multi"]) {
      await view(page, id).click();
      await page.waitForTimeout(250);
    }
    const after = await contexts(page);
    const stillPlaying = (await pause(page).count()) > 0;
    const live = await probeLive(page);
    record_(
      at("8 çalarken üç görünüm geçişi"),
      before === after && stillPlaying && live === 1,
      `context ${before}→${after} · çalıyor ${stillPlaying} · canlı rAF ${live}`,
    );
  });

  await safe(at("53 görünüm değişimi yeni örnek isteği doğurmuyor"), async () => {
    /*
     * The sample bank is shared, so reading the same music on another
     * surface must not fetch a single buffer again (§11). Counted at the
     * fetch, not inferred from the bank's own bookkeeping.
     */
    await toView(page, "multi");
    await page.waitForTimeout(200);
    if ((await pause(page).count()) === 0) {
      await play(page).click();
      await page.waitForTimeout(1500);
    }
    const before = await page.evaluate(() => window.__sampleRequests);
    const contextsBefore = await contexts(page);
    for (const id of ["tab", "arrange", "multi", "tab", "multi"]) {
      await view(page, id).click();
      await page.waitForTimeout(200);
    }
    const after = await page.evaluate(() => window.__sampleRequests);
    const contextsAfter = await contexts(page);
    record_(
      at("53 görünüm değişimi yeni örnek isteği doğurmuyor"),
      after === before && contextsAfter === contextsBefore && before > 0,
      `örnek ${before}→${after} · context ${contextsBefore}→${contextsAfter}`,
    );
  });

  await safe(at("10 döngü korunur"), async () => {
    const loop = page.locator("footer button[aria-label='Bölüm döngüsü']");
    await loop.click();
    await page.waitForTimeout(200);
    const before = await page.evaluate(() =>
      document.querySelector("[data-transport-status]")?.textContent ?? "",
    );
    await toView(page, "tab");
    await page.waitForTimeout(150);
    await toView(page, "multi");
    await page.waitForTimeout(200);
    const after = await page.evaluate(() =>
      document.querySelector("[data-transport-status]")?.textContent ?? "",
    );
    record_(at("10 döngü korunur"), before === after && before.includes("Döngü"), after);
    await loop.click();
  });

  await safe(at("50 dispose sonrası aktif ses 0"), async () => {
    if ((await pause(page).count()) > 0) await pause(page).click();
    await page.waitForTimeout(400);
    const live = await probeLive(page);
    record_(at("50 dispose sonrası aktif ses 0"), live === 0, `canlı rAF ${live}`);
  });

  await safe(at("6 boşta canlı rAF 0"), async () => {
    await toView(page, "arrange");
    await page.waitForTimeout(300);
    await toView(page, "multi");
    await page.waitForTimeout(300);
    const live = await probeLive(page);
    record_(at("6 boşta canlı rAF 0"), live === 0, String(live));
  });

  await safe(at("11 bakılan bölüm korunur"), async () => {
    const before = await page.evaluate(() =>
      document.querySelector("[data-multi-content]")?.getAttribute("data-viewed-section"),
    );
    await toView(page, "tab");
    await page.waitForTimeout(150);
    await toView(page, "multi");
    await page.waitForTimeout(200);
    const after = await page.evaluate(() =>
      document.querySelector("[data-multi-content]")?.getAttribute("data-viewed-section"),
    );
    record_(at("11 bakılan bölüm korunur"), before === after && Boolean(before), `${before}`);
  });

  /* -- 13..21 the axis and the lanes ------------------------------------ */
  await safe(at("13 Çoklu tek yatay scroller"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(200);
    const n = await declaredScrollers(page);
    const multi = await page.locator("[data-multi-scroll]").count();
    record_(at("13 Çoklu tek yatay scroller"), n === 1 && multi === 1, `${n} bildirilen`);
  });

  await safe(at("14 lane başına scroller 0"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(200);
    const n = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-multi-lane] *")].filter((el) => {
          const s = getComputedStyle(el);
          return s.overflowX === "auto" || s.overflowX === "scroll";
        }).length,
    );
    record_(at("14 lane başına scroller 0"), n === 0, String(n));
  });

  await safe(at("15 dört track aynı bar çizgisinde"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(200);
    const x = await laneBarX(page);
    const rows = Object.values(x);
    const same =
      rows.length === 4 && rows.every((row) => row.join(",") === rows[0].join(","));
    record_(at("15 dört track aynı bar çizgisinde"), same, JSON.stringify(rows[0]));
  });

  for (const [n, id, marker] of [
    [16, "gtr", "data-multi-fretted"],
    [17, "bass", "data-multi-fretted"],
    [18, "drums", "data-multi-drums"],
  ]) {
    await safe(at(`${n} ${id} şeridi`), async () => {
      const found = await page.locator(`[${marker}="${id}"]`).count();
      const bars = await page.locator(`[${marker}="${id}"] [data-bar-key]`).count();
      record_(at(`${n} ${id} şeridi`), found === 1 && bars === 4, `${bars} bar`);
    });
  }

  await safe(at("22 track header dokunuşu aktif eder"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(250);
    const before = await page.evaluate(() =>
      document.querySelector("[data-multi-lane][data-active]")?.getAttribute("data-multi-lane"),
    );
    const scrollBefore = await page.evaluate(() => {
      const el = document.querySelector("[data-multi-scroll]");
      el.scrollLeft = 120;
      return Math.round(el.scrollLeft);
    });
    const sectionBefore = await page.evaluate(() =>
      document.querySelector("[data-multi-content]")?.getAttribute("data-viewed-section"),
    );
    await page.locator("[data-multi-lane-header='bass']").click();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      active: document
        .querySelector("[data-multi-lane][data-active]")
        ?.getAttribute("data-multi-lane"),
      scroll: Math.round(document.querySelector("[data-multi-scroll]").scrollLeft),
      section: document
        .querySelector("[data-multi-content]")
        ?.getAttribute("data-viewed-section"),
    }));
    const ledger = await takeLedger(page);
    record_(
      at("22 track header dokunuşu aktif eder"),
      before !== "bass" &&
        after.active === "bass" &&
        after.scroll === scrollBefore &&
        after.section === sectionBefore &&
        ledger.n("set:projectPayload") === 0,
      `${before}→${after.active} · kaydırma ${scrollBefore}→${after.scroll} · yazma ${ledger.n("set:projectPayload")}`,
    );
  });

  await safe(at("54 şerit başlığı kaydırınca ekranda kalır"), async () => {
    /*
     * The header is the only way to tell which lane is which, so it stays at
     * the left edge while the notation scrolls under it (§6). Measured as a
     * box on screen rather than as a class name.
     */
    await toView(page, "multi");
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.querySelector("[data-multi-scroll]").scrollLeft = 0;
    });
    await page.waitForTimeout(120);
    const before = await page.evaluate(
      () =>
        document.querySelector("[data-multi-lane-header]").getBoundingClientRect().left,
    );
    await page.evaluate(() => {
      document.querySelector("[data-multi-scroll]").scrollLeft = 500;
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const rect = document
        .querySelector("[data-multi-lane-header]")
        .getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });
    const scrolled = await page.evaluate(() =>
      Math.round(document.querySelector("[data-multi-scroll]").scrollLeft),
    );
    record_(
      at("54 şerit başlığı kaydırınca ekranda kalır"),
      scrolled >= 400 && Math.abs(after.left - before) <= 2 && after.width > 40,
      `kaydırma ${scrolled} · başlık ${Math.round(before)}→${Math.round(after.left)}`,
    );
    await page.evaluate(() => {
      document.querySelector("[data-multi-scroll]").scrollLeft = 0;
    });
  });

  await safe(at("20 sessiz track listeden düşmez"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(200);
    const lanes = await page.evaluate(() =>
      [...document.querySelectorAll("[data-multi-lane]")].map((l) =>
        l.getAttribute("data-multi-lane"),
      ),
    );
    record_(at("20 sessiz track listeden düşmez"), lanes.length === 4, lanes.join(","));
  });

  /* -- 43..47 the transport, in every view ------------------------------ */
  for (const [n, id, label] of [
    [43, "multi", "Çoklu"],
    [43.1, "tab", "Tab"],
    [43.2, "arrange", "Düzen"],
  ]) {
    await safe(at(`${n} transport bütün kontroller görünür (${label})`), async () => {
      await view(page, id).click();
      await page.waitForTimeout(200);
      const shot = await transportShot(page);
      record_(
        at(`${n} transport bütün kontroller görünür (${label})`),
        shot.clipped === 0 && shot.count === 6 && shot.required <= shot.available + 0.5,
        `${shot.required}/${shot.available}px · kırpılan ${shot.clipped} · ${shot.count} kontrol`,
      );
    });
  }

  await safe(at("44 practice pill görünür"), async () => {
    const shot = await transportShot(page);
    const pill = shot.controls.find((c) => c.label.startsWith("Çalışma hızı"));
    const text = await page.evaluate(
      () =>
        document.querySelector("footer button[aria-label^='Çalışma hızı']")?.textContent ??
        "",
    );
    record_(
      at("44 practice pill görünür"),
      Boolean(pill) && pill.clipped === 0 && pill.w >= 43.5 && text.trim() === "%100",
      `${pill?.w}px · "${text.trim()}"`,
    );
  });

  await safe(at("45 44 px altı hedef 0"), async () => {
    const shot = await transportShot(page);
    record_(at("45 44 px altı hedef 0"), shot.below44 === 0, String(shot.below44));
  });

  await safe(at("46 body taşması 0"), async () => {
    const shot = await transportShot(page);
    record_(at("46 body taşması 0"), shot.bodyOverflow === 0, `${shot.bodyOverflow}px`);
  });

  await safe(at("47 kasıtlı yatay scroller 1"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(200);
    const n = await scrollerCount(page);
    record_(at("47 kasıtlı yatay scroller 1"), n === 1, String(n));
  });

  await safe(at("43.3 sheet açıkken transport bozulmuyor"), async () => {
    await page.locator("footer button[aria-label='Mikser']").click();
    await page.waitForTimeout(300);
    const shot = await transportShot(page);
    await dismiss(page);
    record_(
      at("43.3 sheet açıkken transport bozulmuyor"),
      shot.clipped === 0 && shot.below44 === 0 && shot.bodyOverflow === 0,
      `kırpılan ${shot.clipped} · <44 ${shot.below44} · body ${shot.bodyOverflow}`,
    );
  });

  /* -- 48..49 hygiene --------------------------------------------------- */
  await safe(at("48 konsol/sayfa hatası 0"), async () => {
    record_(at("48 konsol/sayfa hatası 0"), errors.length === 0, errors[0] ?? "temiz");
  });

  await safe(at("49 dış ağ isteği 0"), async () => {
    const external = await page.evaluate(() => window.__externalRequests ?? []);
    record_(at("49 dış ağ isteği 0"), external.length === 0, external[0] ?? "yok");
  });
}


/* ------------------------------------------------- tour B: two sections */

/**
 * A playhead is drawn where the music is, or nowhere.
 *
 * This needs a song with somewhere *else* in it: on a one-section fixture
 * "the transport is not in this section" is a state that cannot happen, and
 * a scenario that asserted the column was hidden while idle would be
 * asserting the opposite of the rule — a paused transport still has a
 * position and the line belongs at it.
 */
async function tourSections(page, vp) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("12 başka bölüm okunurken sahte playhead yok"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(250);
    const first = await page.evaluate(() => ({
      section: document
        .querySelector("[data-multi-content]")
        ?.getAttribute("data-viewed-section"),
      opacity: getComputedStyle(
        document.querySelector("[data-multi-content] > div[aria-hidden]"),
      ).opacity,
    }));
    // Move the reader to the other section while the transport stays put.
    const next = page.locator("[data-section-nav] button[aria-label^='Sonraki bölüm']");
    if ((await next.count()) === 0) {
      record_(at("12 başka bölüm okunurken sahte playhead yok"), false, "bölüm ileri yok");
      return;
    }
    await next.click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      section: document
        .querySelector("[data-multi-content]")
        ?.getAttribute("data-viewed-section"),
      opacity: getComputedStyle(
        document.querySelector("[data-multi-content] > div[aria-hidden]"),
      ).opacity,
    }));
    record_(
      at("12 başka bölüm okunurken sahte playhead yok"),
      first.section !== after.section && after.opacity === "0",
      `${first.section}(${first.opacity}) → ${after.section}(${after.opacity})`,
    );
  });

  await safe(at("11.b bölüm değişince eksen yeniden hizalanır"), async () => {
    const x = await laneBarX(page);
    const rows = Object.values(x);
    const same = rows.length > 0 && rows.every((r) => r.join(",") === rows[0].join(","));
    record_(at("11.b bölüm değişince eksen yeniden hizalanır"), same, JSON.stringify(rows[0]));
  });
}

/* -------------------------------------------- tour C: grids and meters */

/**
 * Bar lines land together whatever the counting is.
 *
 * Meter and resolution belong to the bar, so every lane in a bar has the
 * same slot count — the claim is that this really is what the screen does,
 * across a section whose bars deliberately do not share a grid.
 */
async function tourGrids(page, vp, label) {
  const at = (name) => `[${vp}] ${name}`;
  await safe(at(`15.${label} bar çizgileri hizalı (${label})`), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(300);
    const x = await laneBarX(page);
    const rows = Object.values(x).filter((row) => row.length > 0);
    const same = rows.length >= 3 && rows.every((r) => r.join(",") === rows[0].join(","));
    record_(
      at(`15.${label} bar çizgileri hizalı (${label})`),
      same,
      `${rows.length} şerit · ${JSON.stringify(rows[0])}`,
    );
  });
}

/* ----------------------------------------------- tour D: the pitched lane */

async function tourPitched(page, vp) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("19 perde şeridi"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(300);
    const shot = await page.evaluate(() => {
      const lane = document.querySelector("[data-multi-pitched='keys']");
      const notes = lane ? [...lane.querySelectorAll("span")] : [];
      return {
        present: Boolean(lane),
        notes: notes.length,
        labels: notes.map((n) => n.textContent).filter(Boolean).slice(0, 3),
        // Nothing that looks like a fretboard may appear in this lane.
        text: lane?.textContent ?? "",
      };
    });
    record_(
      at("19 perde şeridi"),
      shot.present && shot.notes > 0 && /^[A-G]/.test(shot.labels[0] ?? ""),
      `${shot.notes} nota · ${shot.labels.join(",")}`,
    );
  });

  await safe(at("19.b perde şeridinde tel/perde uydurulmuyor"), async () => {
    const frets = await page.evaluate(() => {
      const lane = document.querySelector("[data-multi-pitched='keys']");
      if (!lane) return -1;
      // A fret glyph is a bare number; a pitch label always starts with a
      // note letter. Anything numeric here would be an invented fretboard.
      return [...lane.querySelectorAll("span")].filter((n) =>
        /^\d+$/.test((n.textContent ?? "").trim()),
      ).length;
    });
    record_(at("19.b perde şeridinde tel/perde uydurulmuyor"), frets === 0, String(frets));
  });
}

/* ------------------------------- tour E: eight tracks, scroll and collapse */

async function tourScale(page, vp) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("21 sekiz track dikey scroll ile erişilebilir"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(400);
    const shot = await page.evaluate(() => {
      const scroller = document.querySelector("[data-multi-scroll]");
      const lanes = [...document.querySelectorAll("[data-multi-lane]")];
      scroller.scrollTop = scroller.scrollHeight;
      return {
        lanes: lanes.length,
        canScroll: scroller.scrollHeight > scroller.clientHeight,
        scrolled: Math.round(scroller.scrollTop),
      };
    });
    await page.waitForTimeout(150);
    const lastVisible = await page.evaluate(() => {
      const lanes = [...document.querySelectorAll("[data-multi-lane]")];
      const last = lanes.at(-1);
      if (!last) return false;
      const box = last.getBoundingClientRect();
      return box.top < window.innerHeight && box.bottom > 0;
    });
    record_(
      at("21 sekiz track dikey scroll ile erişilebilir"),
      shot.lanes === 8 && lastVisible,
      `${shot.lanes} şerit · son şerit görünür ${lastVisible}`,
    );
  });

  await safe(at("21.b lane daraltma yüksekliği geri veriyor"), async () => {
    const before = await page.evaluate(
      () => document.querySelector("[data-multi-scroll]").scrollHeight,
    );
    const collapse = page.locator("[data-multi-lane-collapse]").first();
    const box = await collapse.boundingBox();
    await collapse.click();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      height: document.querySelector("[data-multi-scroll]").scrollHeight,
      collapsed: document.querySelectorAll("[data-multi-lane][data-collapsed]").length,
      digest: document.querySelectorAll("[data-multi-lane-digest]").length,
      lanes: document.querySelectorAll("[data-multi-lane]").length,
    }));
    record_(
      at("21.b lane daraltma yüksekliği geri veriyor"),
      after.height < before &&
        after.collapsed === 1 &&
        after.digest === 1 &&
        after.lanes === 8 &&
        (box?.width ?? 0) >= 43.5 &&
        (box?.height ?? 0) >= 43.5,
      `${before}→${after.height}px · daraltılan ${after.collapsed} · hedef ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`,
    );
  });

  await safe(at("24.c daraltma Song'a veya depoya girmiyor"), async () => {
    const ledger = await takeLedger(page);
    record_(
      at("24.c daraltma Song'a veya depoya girmiyor"),
      ledger.n("set:projectPayload") === 0 && ledger.n("set:catalog") === 0,
      `payload ${ledger.n("set:projectPayload")} · katalog ${ledger.n("set:catalog")}`,
    );
  });

  await safe(at("21.c daraltılan lane açılabiliyor"), async () => {
    await page.locator("[data-multi-lane-collapse]").first().click();
    await page.waitForTimeout(250);
    const n = await page.locator("[data-multi-lane][data-collapsed]").count();
    record_(at("21.c daraltılan lane açılabiliyor"), n === 0, String(n));
  });
}


/* ------------------------------------------- tour F: editing on one lane */

const editToggle = (page) =>
  page.locator("[data-action-row] button[aria-pressed]").first();

/**
 * Close whatever sheet is on screen.
 *
 * A sheet's backdrop covers the workspace at z-30, so a scenario that starts
 * with one open does not measure what it thinks it measures — it measures
 * the backdrop. Each scenario gets a known ground first.
 */
/**
 * The fret sheet's commit control.
 *
 * Scoped to the dialog and matched exactly. `button:has-text("Ekle")` is a
 * substring match over the whole page, so `.first()` can land on some other
 * control that merely contains the word — which looks like a click that did
 * nothing and reads as a product failure.
 */
const commitFret = (page) =>
  page.locator("[role='dialog'] button").filter({ hasText: /^(Ekle|Güncelle)$/ });

async function dismiss(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const open = await page.evaluate(
      () => document.querySelectorAll("[role='dialog']").length,
    );
    if (open === 0) return;
    /*
     * A sheet closes through its own backdrop, which carries the accessible
     * name "Kapat". There is no Escape handler, so pressing it does nothing
     * and every click after it lands on the backdrop instead of the
     * workspace — which is a harness failure that reads exactly like a
     * product one.
     */
    const closed = await page.evaluate(() => {
      const backdrop = document.querySelector(
        "[role='dialog'] button[aria-label='Kapat']",
      );
      if (!backdrop) return false;
      backdrop.click();
      return true;
    });
    if (!closed) return;
    await page.waitForTimeout(250);
  }
}

/** Open the multi view with edit mode on and a known active track. */
async function enterEditing(page, trackId) {
  await dismiss(page);
  await toView(page, "multi");
  await page.waitForTimeout(250);
  await page.locator(`[data-multi-lane-header='${trackId}']`).click();
  await page.waitForTimeout(200);
  const pressed = await editToggle(page).getAttribute("aria-pressed");
  if (pressed !== "true") {
    await editToggle(page).click();
    await page.waitForTimeout(250);
  }
}

async function tourEditing(page, vp) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("23 pasif şeritteki nota dokunuşu önce aktif eder"), async () => {
    await enterEditing(page, "gtr");
    const before = await page.evaluate(() =>
      document.querySelector("[data-multi-lane][data-active]")?.getAttribute("data-multi-lane"),
    );
    // The bass lane is not active, so its bars are plain seek buttons.
    await page.locator("[data-multi-fretted='bass'] [data-bar-key]").first().click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      document.querySelector("[data-multi-lane][data-active]")?.getAttribute("data-multi-lane"),
    );
    const ledger = await takeLedger(page);
    record_(
      at("23 pasif şeritteki nota dokunuşu önce aktif eder"),
      before === "gtr" && after === "bass" && ledger.n("set:projectPayload") === 0,
      `${before}→${after} · yazma ${ledger.n("set:projectPayload")}`,
    );
  });

  await safe(at("30 hücre ızgarası yalnız aktif şeritte"), async () => {
    await enterEditing(page, "gtr");
    const shot = await page.evaluate(() => {
      const cellsIn = (id) =>
        document.querySelectorAll(`[data-multi-lane='${id}'] [data-cell]`).length;
      return { gtr: cellsIn("gtr"), bass: cellsIn("bass"), lead: cellsIn("lead") };
    });
    record_(
      at("30 hücre ızgarası yalnız aktif şeritte"),
      shot.gtr > 0 && shot.bass === 0 && shot.lead === 0,
      JSON.stringify(shot),
    );
  });

  await safe(at("24 edit sheet açılır"), async () => {
    await enterEditing(page, "gtr");
    await page.locator("[data-multi-lane='gtr'] [data-cell]").first().click();
    await page.waitForTimeout(300);
    const open = await page.locator("#fret-input").count();
    record_(at("24 edit sheet açılır"), open === 1, `${open} fret alanı`);
  });

  await safe(at("25 nota yazımı tek write, tek history"), async () => {
    await takeLedger(page);
    await page.fill("#fret-input", "7");
    await commitFret(page).click();
    await page.waitForTimeout(500);
    const ledger = await takeLedger(page);
    const undoEnabled = await page.evaluate(() => {
      const b = [...document.querySelectorAll("[data-action-row] button")].find((el) =>
        (el.getAttribute("aria-label") ?? "").startsWith("Geri al"),
      );
      return b ? !b.disabled : null;
    });
    record_(
      at("25 nota yazımı tek write, tek history"),
      ledger.n("set:projectPayload") === 1 && undoEnabled === true,
      `payload ${ledger.n("set:projectPayload")} · katalog ${ledger.n("set:catalog")} · geri alınabilir ${undoEnabled}`,
    );
  });

  await safe(at("26 geri al / yinele"), async () => {
    await dismiss(page);
    // Self-contained: this scenario makes the edit it then undoes, so it
    // measures the same thing whether or not 25 ran before it.
    await enterEditing(page, "gtr");
    await page.locator("[data-multi-lane='gtr'] [data-cell]").nth(3).click();
    await page.waitForTimeout(300);
    await page.fill("#fret-input", "9");
    await commitFret(page).click();
    await page.waitForTimeout(500);
    await dismiss(page);
    const undo = page.locator("[data-action-row] button[aria-label^='Geri al']");
    const redo = page.locator("[data-action-row] button[aria-label^='Yinele']");
    await takeLedger(page);
    await undo.click();
    await page.waitForTimeout(400);
    const afterUndo = await takeLedger(page);
    await redo.click();
    await page.waitForTimeout(400);
    const afterRedo = await takeLedger(page);
    record_(
      at("26 geri al / yinele"),
      afterUndo.n("set:projectPayload") === 1 && afterRedo.n("set:projectPayload") === 1,
      `geri ${afterUndo.n("set:projectPayload")} · yinele ${afterRedo.n("set:projectPayload")}`,
    );
  });

  await safe(at("27 uzun basış onset seçimi açar"), async () => {
    await dismiss(page);
    await enterEditing(page, "gtr");
    const onset = page.locator("[data-multi-lane='gtr'] [data-cell][data-onset]").first();
    const box = await onset.boundingBox();
    if (!box) {
      record_(at("27 uzun basış onset seçimi açar"), false, "onset bulunamadı");
      return;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const selected = await page.locator("[data-group-selected]").count();
    record_(at("27 uzun basış onset seçimi açar"), selected > 0, `${selected} hücre seçili`);
  });

  await safe(at("28 akor tek onset olarak seçilir"), async () => {
    const shot = await page.evaluate(() => {
      const selected = [...document.querySelectorAll("[data-group-selected]")];
      const slots = new Set(
        selected.map((el) => (el.getAttribute("data-cell") ?? "").split(":")[0]),
      );
      return { cells: selected.length, slots: slots.size };
    });
    // A chord is several strings of one slot: one onset, not several.
    record_(
      at("28 akor tek onset olarak seçilir"),
      shot.slots === 1 && shot.cells >= 1,
      `${shot.cells} hücre · ${shot.slots} slot`,
    );
  });

  await safe(at("31 seçim yalnız ilgili şeritte çizilir"), async () => {
    const shot = await page.evaluate(() => {
      const inLane = (id) =>
        document.querySelectorAll(`[data-multi-lane='${id}'] [data-group-selected]`).length;
      return {
        gtr: inLane("gtr"),
        bass: inLane("bass"),
        lead: inLane("lead"),
        drums: inLane("drums"),
      };
    });
    record_(
      at("31 seçim yalnız ilgili şeritte çizilir"),
      shot.gtr > 0 && shot.bass === 0 && shot.lead === 0 && shot.drums === 0,
      JSON.stringify(shot),
    );
  });

  await safe(at("29 seçim çubuğu ve taşıma kontrolleri açılıyor"), async () => {
    /*
     * The chain decision itself belongs to a *move*, and a move is what the
     * selection bar offers. What is checked here is that the same bar the tab
     * shows appears for a selection made on a lane — the three-decision sheet
     * behind it is the one the move already goes through (2N-A §2), reused
     * rather than rebuilt.
     */
    // Self-contained: make a selection, then look for the bar it opens.
    await dismiss(page);
    await enterEditing(page, "gtr");
    const onset = page.locator("[data-multi-lane='gtr'] [data-cell][data-onset]").first();
    const box = await onset.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    const clear = page.locator("button[aria-label='Seçimi temizle']");
    const moves = await page.locator("button[aria-label^='Seçimi bir']").count();
    const present = (await clear.count()) > 0;
    record_(
      at("29 seçim çubuğu ve taşıma kontrolleri açılıyor"),
      present && moves >= 2,
      present ? `${moves} taşıma kontrolü` : "seçim çubuğu yok",
    );
  });

  await safe(at("32 yatay kaydırma seçim açmaz"), async () => {
    await enterEditing(page, "gtr");
    await page.evaluate(() => {
      document.querySelector("[data-multi-scroll]").scrollLeft = 0;
    });
    const onset = page.locator("[data-multi-lane='gtr'] [data-cell][data-onset]").first();
    const box = await onset.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 90, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const selected = await page.locator("[data-group-selected]").count();
    record_(at("32 yatay kaydırma seçim açmaz"), selected === 0, `${selected} seçili`);
  });

  await safe(at("33 dikey kaydırma seçim açmaz"), async () => {
    const onset = page.locator("[data-multi-lane='gtr'] [data-cell][data-onset]").first();
    const box = await onset.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const selected = await page.locator("[data-group-selected]").count();
    record_(at("33 dikey kaydırma seçim açmaz"), selected === 0, `${selected} seçili`);
  });

  await safe(at("34 akor kurucu aktif fretted şeritte açılır"), async () => {
    await enterEditing(page, "gtr");
    await page.locator("[data-multi-lane='gtr'] [data-cell]").first().click();
    await page.waitForTimeout(300);
    const door = page.locator("[data-fret-chord]");
    if ((await door.count()) === 0) {
      record_(at("34 akor kurucu aktif fretted şeritte açılır"), false, "akor kapısı yok");
      return;
    }
    await door.click();
    await page.waitForTimeout(400);
    const open = await page.locator("[data-chord-sheet]").count();
    record_(at("34 akor kurucu aktif fretted şeritte açılır"), open === 1, `${open} akor sheet`);
    const cancel = page.locator("[data-chord-cancel]");
    if ((await cancel.count()) > 0) await cancel.click();
    await page.waitForTimeout(250);
  });

  await safe(at("35 davulda akor kurucu sunulmuyor"), async () => {
    await dismiss(page);
    await toView(page, "multi");
    await page.waitForTimeout(250);
    await page.locator("[data-multi-lane-header='drums']").click();
    await page.waitForTimeout(300);
    /*
     * What this scenario owns is that a kit gets no chord builder — a kit
     * has no pitches to voice — and it still owns exactly that.
     *
     * It used to *also* assert that the edit toggle was disabled on a kit,
     * and that half is gone at 2Q-B: a kit is now written on a step grid, so
     * a disabled toggle would be the defect rather than the guarantee. The
     * scenario was rebound rather than deleted, and rebound to the claim in
     * its own title: no fret cells, no fret sheet, no chord door on a kit,
     * *while editing is open*. That is a stronger reading than the old one,
     * because the old one was satisfied by editing being impossible.
     */
    const pressed = await editToggle(page).getAttribute("aria-pressed");
    if (pressed !== "true") {
      await editToggle(page).click();
      await page.waitForTimeout(250);
    }
    const shot = await page.evaluate(() => ({
      cells: document.querySelectorAll("[data-multi-lane='drums'] [data-cell]").length,
      chordDoor: document.querySelectorAll("[data-fret-chord]").length,
      chordSheet: document.querySelectorAll("[data-chord-sheet]").length,
      stepCells: document.querySelectorAll("[data-drum-cell]").length,
    }));
    record_(
      at("35 davulda akor kurucu sunulmuyor"),
      shot.cells === 0 &&
        shot.chordDoor === 0 &&
        shot.chordSheet === 0 &&
        shot.stepCells > 0,
      JSON.stringify(shot),
    );
  });
}

/* ------------------------------- tour G: a new track, and the first note */

async function tourNewTrack(page, vp) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("36 yeni track oluşturuluyor"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(200);
    await page.locator("[data-track-control]").click();
    await page.waitForTimeout(250);
    await page.locator("[data-track-manage]").click();
    await page.waitForTimeout(300);
    await page.locator("[data-track-add]").click();
    await page.waitForTimeout(250);
    await page.fill("[data-track-name]", "Yeni Gitar");
    await takeLedger(page);
    await page.locator("[data-track-apply]").click();
    await page.waitForTimeout(600);
    const ledger = await takeLedger(page);
    const lanes = await page.locator("[data-multi-lane]").count();
    record_(
      at("36 yeni track oluşturuluyor"),
      lanes === 5 && ledger.n("set:projectPayload") === 1,
      `${lanes} şerit · payload ${ledger.n("set:projectPayload")}`,
    );
  });

  await safe(at("37 yeni track'in ızgarası görünüyor"), async () => {
    const shot = await page.evaluate(() => {
      const lanes = [...document.querySelectorAll("[data-multi-lane]")];
      const fresh = lanes.at(-1);
      const id = fresh?.getAttribute("data-multi-lane") ?? "";
      return {
        id,
        bars: fresh?.querySelectorAll("[data-bar-key]").length ?? 0,
        collapsed: fresh?.hasAttribute("data-collapsed") ?? true,
      };
    });
    record_(
      at("37 yeni track'in ızgarası görünüyor"),
      shot.bars === 4 && shot.collapsed === false,
      `${shot.id} · ${shot.bars} bar · açık ${!shot.collapsed}`,
    );
  });

  await safe(at("38 ilk nota yazılıyor"), async () => {
    const id = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-multi-lane]")]
          .at(-1)
          ?.getAttribute("data-multi-lane") ?? "",
    );
    await enterEditing(page, id);
    const cells = await page.locator(`[data-multi-lane='${id}'] [data-cell]`).count();
    if (cells === 0) {
      record_(at("38 ilk nota yazılıyor"), false, "hücre yok");
      return;
    }
    await page.locator(`[data-multi-lane='${id}'] [data-cell]`).first().click();
    await page.waitForTimeout(300);
    await takeLedger(page);
    await page.fill("#fret-input", "5");
    await commitFret(page).click();
    await page.waitForTimeout(500);
    const ledger = await takeLedger(page);
    const notes = await page.evaluate(
      (trackId) =>
        document.querySelectorAll(`[data-multi-lane='${trackId}'] [data-group-selected], [data-multi-lane='${trackId}'] [data-cell][data-onset]`)
          .length,
      id,
    );
    record_(
      at("38 ilk nota yazılıyor"),
      ledger.n("set:projectPayload") === 1 && notes > 0,
      `payload ${ledger.n("set:projectPayload")} · onset ${notes}`,
    );
  });

  await safe(at("40 başarısız ilk nota 0 write"), async () => {
    const id = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-multi-lane]")]
          .at(-1)
          ?.getAttribute("data-multi-lane") ?? "",
    );
    await enterEditing(page, id);
    await page.locator(`[data-multi-lane='${id}'] [data-cell]`).nth(6).click();
    await page.waitForTimeout(300);
    await takeLedger(page);
    await page.fill("#fret-input", "99");
    const commit = commitFret(page);
    const disabled = await commit.isDisabled();
    if (!disabled) await commit.click();
    await page.waitForTimeout(400);
    const ledger = await takeLedger(page);
    record_(
      at("40 başarısız ilk nota 0 write"),
      ledger.n("set:projectPayload") === 0,
      `payload ${ledger.n("set:projectPayload")} · buton kapalı ${disabled}`,
    );
    await dismiss(page);
  });

  await safe(at("41 track silme"), async () => {
    await page.locator("[data-track-control]").click();
    await page.waitForTimeout(250);
    await page.locator("[data-track-manage]").click();
    await page.waitForTimeout(300);
    const rows = page.locator("[data-track-row]");
    const count = await rows.count();
    await rows.nth(count - 1).click();
    await page.waitForTimeout(200);
    await page.locator("[data-track-action='delete']").click();
    await page.waitForTimeout(300);
    const confirm = page.locator("button:has-text('Sil')").last();
    await takeLedger(page);
    await confirm.click();
    await page.waitForTimeout(600);
    const ledger = await takeLedger(page);
    const escape = page.locator("button:has-text('Kapat')").first();
    if ((await escape.count()) > 0) await escape.click();
    await page.waitForTimeout(250);
    const lanes = await page.locator("[data-multi-lane]").count();
    record_(
      at("41 track silme"),
      lanes === 4 && ledger.n("set:projectPayload") === 1,
      `${lanes} şerit · payload ${ledger.n("set:projectPayload")}`,
    );
  });

  await safe(at("42 track silme geri alınabiliyor"), async () => {
    await page.locator("[data-action-row] button[aria-label^='Geri al']").click();
    await page.waitForTimeout(600);
    const lanes = await page.locator("[data-multi-lane]").count();
    record_(at("42 track silme geri alınabiliyor"), lanes === 5, `${lanes} şerit`);
  });
}

/* --------------------------------------- tour H: two projects, one state */

async function tourProjects(page, vp) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("39 proje değişince şerit durumu sıfırlanır"), async () => {
    await toView(page, "multi");
    await page.waitForTimeout(300);
    await page.locator("[data-multi-lane-collapse]").first().click();
    await page.waitForTimeout(250);
    const collapsedBefore = await page.locator("[data-multi-lane][data-collapsed]").count();

    await page.locator("[data-open-projects]").click();
    await page.waitForTimeout(400);
    /*
     * The row expands; the open action is behind it. Clicking the row alone
     * changes nothing, which is a door this harness had to walk rather than
     * assume — the first version measured the first project twice.
     */
    const row = page.locator("[data-project-open='project-2']");
    if ((await row.count()) === 0) {
      record_(at("39 proje değişince şerit durumu sıfırlanır"), false, "ikinci proje yok");
      return;
    }
    await row.click();
    await page.waitForTimeout(300);
    await page.locator("[data-project-actions='project-2'] [data-project-action='open']").click();
    await page.waitForTimeout(1000);
    await dismiss(page);
    await toView(page, "multi");
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      collapsed: document.querySelectorAll("[data-multi-lane][data-collapsed]").length,
      lanes: [...document.querySelectorAll("[data-multi-lane]")].map((l) =>
        l.getAttribute("data-multi-lane"),
      ),
    }));
    // The lane list proves the project really changed; without it a reset
    // that never happened and a switch that never happened look the same.
    record_(
      at("39 proje değişince şerit durumu sıfırlanır"),
      collapsedBefore === 1 && after.collapsed === 0 && after.lanes.includes("keys"),
      `${collapsedBefore} → ${after.collapsed} · ${after.lanes.join(",")}`,
    );
  });
}

/* ------------------------------------------------------------------ main */

const VIEWPORTS = process.env.ONE_VIEWPORT
  ? [{ name: "390x844", width: 390, height: 844 }]
  : [
      { name: "390x844", width: 390, height: 844 },
      { name: "320x700", width: 320, height: 700 },
    ];

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

for (const vp of VIEWPORTS) {
  const main = await boot(browser, vp, device(seed("fourPart")));
  await run(main.page, main.errors, vp.name);
  await main.context.close();

  const sections = await boot(browser, vp, device(seed("fourPartTwoSections")));
  await tourSections(sections.page, vp.name);
  await sections.context.close();

  for (const [label, fixture] of [
    ["karışık grid", "mixedGrid"],
    ["3/4", "threeFour"],
    ["7/8", "sevenEight"],
  ]) {
    const grids = await boot(browser, vp, device(seed(fixture)));
    await tourGrids(grids.page, vp.name, label);
    await grids.context.close();
  }

  const pitched = await boot(browser, vp, device(seed("withKeys")));
  await tourPitched(pitched.page, vp.name);
  await pitched.context.close();

  const scale = await boot(browser, vp, device(seed("maxTracks")));
  await tourScale(scale.page, vp.name);
  await scale.context.close();

  const editing = await boot(browser, vp, device(seed("fourPart")));
  await tourEditing(editing.page, vp.name);
  await editing.context.close();

  const fresh = await boot(browser, vp, device(seed("fourPart")));
  await tourNewTrack(fresh.page, vp.name);
  await fresh.context.close();

  const projects = await boot(
    browser,
    vp,
    twoProjects(seed("fourPart"), seed("withKeys")),
  );
  await tourProjects(projects.page, vp.name);
  await projects.context.close();
}

await browser.close();

const failed = results.filter((entry) => !entry.pass);
writeFileSync(
  `${OUT}/BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2Q-A §16 — Çoklu görünüm, yazılabilir track ve mobil transport kabulü",
      measuredOn: "masaüstü Chromium, gerçek production build — fiziksel telefon değil",
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${results.length - failed.length}/${results.length} senaryo geçti`);
process.exit(failed.length === 0 ? 0 : 1);
