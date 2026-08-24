/**
 * Defects B and C, measured on the build that has them (2Q-A §0).
 *
 * Production code is untouched. Every number is read off the running app: the
 * transport is measured control by control from its own bounding boxes, and
 * "how many notations can I see at once" is counted from the DOM rather than
 * argued from the source.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/multitrack/measure-baseline.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { device, seed } from "./device.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/multitrack/artifacts";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "320x700", width: 320, height: 700 },
];

/** Every control the transport is required to show, by accessible name. */
const TRANSPORT_CONTROLS = [
  "Başa dön",
  "Çal",
  "Duraklat",
  "Bölüm döngüsü",
  "Mikser",
  "Metronom",
];

async function boot(browser, viewport, storage) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([entries]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      window.__audioContexts = 0;
      for (const name of ["AudioContext", "webkitAudioContext"]) {
        const Original = window[name];
        if (!Original) continue;
        // A Proxy, not a subclass: subclassing the constructor breaks Tone's
        // decoder and turns the measurement into one of the instrument.
        window[name] = new Proxy(Original, {
          construct(target, args) {
            window.__audioContexts += 1;
            return Reflect.construct(target, args);
          },
        });
      }
    },
    [Object.entries(storage)],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 15000 });
  return { context, page, errors };
}

/* ---------------------------------------------------------------- defect B */

async function transportBounds(page) {
  return page.evaluate((names) => {
    const footer = document.querySelector("footer");
    if (!footer) return { error: "no footer" };
    // The control row is the flex line inside the footer, not the footer
    // itself: the footer also holds the status line and the notice band.
    const row =
      footer.querySelector(":scope > div.flex") ?? footer.querySelector(":scope > div");
    const rowBox = row?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;

    const buttons = [...footer.querySelectorAll("button")];
    const controls = buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const label = button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
      // How much of the control is actually inside the viewport.
      const visibleLeft = Math.max(box.left, 0);
      const visibleRight = Math.min(box.right, viewportWidth);
      const visibleWidth = Math.max(0, visibleRight - visibleLeft);
      return {
        label,
        text: (button.textContent ?? "").trim(),
        left: Math.round(box.left * 10) / 10,
        right: Math.round(box.right * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        visibleWidth: Math.round(visibleWidth * 10) / 10,
        clippedPx: Math.round((box.width - visibleWidth) * 10) / 10,
        fullyVisible: visibleWidth >= box.width - 0.5,
        meetsTouchTarget: box.width >= 44 - 0.5 && box.height >= 44 - 0.5,
        fontSizePx: Math.round(parseFloat(getComputedStyle(button).fontSize) * 10) / 10,
      };
    });

    // What the row would need if nothing were compressed: the sum of the
    // children's own widths plus the gaps and the row's horizontal padding.
    const style = row ? getComputedStyle(row) : null;
    const children = row ? [...row.children] : [];
    const gap = style ? parseFloat(style.columnGap || style.gap || "0") || 0 : 0;
    const padding = style
      ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      : 0;
    const contentWidth = children.reduce(
      (total, child) => total + child.getBoundingClientRect().width,
      0,
    );
    const required =
      contentWidth + gap * Math.max(0, children.length - 1) + padding;

    const root = document.documentElement;
    const body = document.body;
    return {
      viewportWidth,
      rowWidth: rowBox ? Math.round(rowBox.width * 10) / 10 : null,
      rowScrollWidth: row ? row.scrollWidth : null,
      requiredWidth: Math.round(required * 10) / 10,
      availableWidth: rowBox ? Math.round(rowBox.width * 10) / 10 : null,
      overflowPx: Math.round(Math.max(0, required - (rowBox?.width ?? 0)) * 10) / 10,
      rootOverflowX: getComputedStyle(root).overflowX,
      // Which ancestor is really doing the clipping. "the root hides it" was
      // the guess; this asks the box tree instead.
      clippingAncestors: (() => {
        const out = [];
        let node = row;
        while (node && node !== document.documentElement) {
          const s = getComputedStyle(node);
          if (s.overflowX === "hidden" || s.overflowX === "clip") {
            out.push({
              tag: node.tagName.toLowerCase(),
              cls: (node.className || "").toString().slice(0, 60),
              overflowX: s.overflowX,
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
            });
          }
          node = node.parentElement;
        }
        return out;
      })(),
      bodyOverflowX: getComputedStyle(body).overflowX,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyOverflowPx: Math.max(0, body.scrollWidth - body.clientWidth),
      controls,
      missing: names.filter(
        (name) => !controls.some((control) => control.label.startsWith(name)),
      ),
      practicePill: controls.find((control) =>
        control.label.startsWith("Çalışma hızı"),
      ) ?? null,
      // Deliberate horizontal scrollers on the page, whatever the surface.
      intentionalScrollers: [...document.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return (
          (s.overflowX === "auto" || s.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1
        );
      }).length,
    };
  }, TRANSPORT_CONTROLS);
}

/* ---------------------------------------------------------------- baseline C */

async function tabReach(page) {
  // Open the Tab surface, which is where a reader reads notation today.
  await page.getByTestId("view-tab").click();
  await page.waitForTimeout(250);

  return page.evaluate(() => {
    const content = document.querySelector("[data-tab-content]");
    const scroller = content?.parentElement ?? null;
    const bars = document.querySelectorAll("[data-bar-key]");
    // The tab is built for exactly one track, so the honest count is how many
    // separate notations are drawn, which is how many tab contents exist.
    return {
      tabContents: document.querySelectorAll("[data-tab-content]").length,
      barElements: bars.length,
      trackControlLabel:
        document.querySelector("[data-track-control]")?.textContent?.trim() ?? null,
      scrollLeft: scroller ? Math.round(scroller.scrollLeft) : null,
      scrollWidth: scroller ? scroller.scrollWidth : null,
      clientWidth: scroller ? scroller.clientWidth : null,
      horizontalScrollers: [...document.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return s.overflowX === "auto" || s.overflowX === "scroll";
      }).length,
    };
  });
}

/** How many taps it takes to look at another track's notation. */
async function actionsToSwitchTrack(page) {
  const steps = [];
  const scrollBefore = await page.evaluate(() => {
    const content = document.querySelector("[data-tab-content]");
    const scroller = content?.parentElement;
    if (!scroller) return null;
    scroller.scrollLeft = Math.min(240, scroller.scrollWidth - scroller.clientWidth);
    return Math.round(scroller.scrollLeft);
  });
  await page.waitForTimeout(120);

  const control = page.locator("[data-track-control]").first();
  if ((await control.count()) === 0) {
    return { actions: null, note: "track control not found", scrollBefore };
  }
  await control.click();
  steps.push("track kontrolü");
  await page.waitForTimeout(200);

  const rows = page.locator("[data-track-option]");
  const count = await rows.count();
  if (count < 2) {
    await page.keyboard.press("Escape");
    return { actions: null, note: `only ${count} track options`, scrollBefore };
  }
  await rows.nth(1).click();
  steps.push("track satırı");
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const content = document.querySelector("[data-tab-content]");
    const scroller = content?.parentElement ?? null;
    return {
      scrollLeft: scroller ? Math.round(scroller.scrollLeft) : null,
      trackControlLabel:
        document.querySelector("[data-track-control]")?.textContent?.trim() ?? null,
    };
  });
  return {
    actions: steps.length,
    steps,
    scrollBefore,
    scrollAfter: after.scrollLeft,
    horizontalPositionKept:
      scrollBefore !== null && after.scrollLeft !== null
        ? Math.abs(after.scrollLeft - scrollBefore) <= 2
        : null,
    trackAfter: after.trackControlLabel,
  };
}

/**
 * What changing track does to playback.
 *
 * Asked with the transport actually running, because the question is whether
 * the tick and the audio survive — which a stopped player cannot answer.
 */
async function trackSwitchDuringPlayback(page) {
  // Scoped to the transport: "Çalışma hızı…" also starts with "Çal".
  const play = page.locator("footer button[aria-label='Çal']");
  if ((await play.count()) === 0) return { note: "play control not found" };
  await play.click();
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => ({
    status: document.querySelector("footer button[aria-label='Duraklat']") ? "playing" : "not playing",
    contexts: window.__audioContexts ?? null,
  }));

  const control = page.locator("[data-track-control]").first();
  if ((await control.count()) > 0) {
    await control.click();
    await page.waitForTimeout(200);
    const options = page.locator("[data-track-option]");
    if ((await options.count()) > 1) await options.nth(1).click();
    await page.waitForTimeout(600);
  }

  const after = await page.evaluate(() => ({
    status: document.querySelector("footer button[aria-label='Duraklat']") ? "playing" : "not playing",
    contexts: window.__audioContexts ?? null,
    trackControlLabel:
      document.querySelector("[data-track-control]")?.textContent?.trim() ?? null,
  }));
  const pause = page.locator("footer button[aria-label='Duraklat']");
  if ((await pause.count()) > 0) await pause.click();
  return { before, after, playbackSurvived: before.status === "playing" && after.status === "playing" };
}

/* -------------------------------------------------------------------- run */

const browser = await chromium.launch();
const report = { what: "2Q-A §0 — B ve C kusurlarinin gercek build uzerindeki olcumu", viewports: {} };

for (const viewport of VIEWPORTS) {
  const { context, page, errors } = await boot(
    browser,
    viewport,
    device(seed("fourPart")),
  );
  const transport = await transportBounds(page);
  const tab = await tabReach(page);
  const switching = await actionsToSwitchTrack(page);
  const duringPlayback = await trackSwitchDuringPlayback(page);
  report.viewports[viewport.name] = {
    transport,
    tab,
    switching,
    duringPlayback,
    pageErrors: errors,
  };
  console.log(`--- ${viewport.name}`);
  console.log(
    `  transport: gereken ${transport.requiredWidth}px / kullanilabilir ${transport.availableWidth}px` +
      ` · tasma ${transport.overflowPx}px · root overflow-x ${transport.rootOverflowX}` +
      ` · body tasma ${transport.bodyOverflowPx}px`,
  );
  for (const control of transport.controls) {
    console.log(
      `    ${control.label.slice(0, 28).padEnd(28)} ${String(control.width).padStart(6)}x${String(control.height).padEnd(5)}` +
        ` gorunur ${String(control.visibleWidth).padStart(6)} kirpilan ${String(control.clippedPx).padStart(5)}` +
        ` 44px ${control.meetsTouchTarget ? "evet" : "HAYIR"}`,
    );
  }
  console.log(
    `  tab: ekranda ${tab.tabContents} track notasyonu · bar ogesi ${tab.barElements}` +
      ` · yatay scroller ${tab.horizontalScrollers}`,
  );
  console.log(
    `  track degistirme: ${switching.actions ?? "?"} eylem · yatay konum korundu ${switching.horizontalPositionKept}` +
      ` (${switching.scrollBefore} → ${switching.scrollAfter})`,
  );
  await context.close();
}

await browser.close();
writeFileSync(
  `${OUT}/BASELINE-BROWSER.json`,
  `${JSON.stringify({ ...report, measuredOn: "masaustu Chromium — telefon degil" }, null, 2)}\n`,
);
console.log(`\n${OUT}/BASELINE-BROWSER.json yazildi`);
