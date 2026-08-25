/**
 * The two layers node cannot honestly measure (§16).
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/measure-perf-browser.mjs
 *
 * `measure-node.ts` times the pure stations a command passes through. Two of
 * the five only exist in a browser:
 *
 *   render (React)  — what the surface costs between the tap and the frame
 *                     that shows the chord, which is React's commit and the
 *                     browser's layout, not the geometry model
 *   sample audio    — decoding the instrument and starting the first buffer,
 *                     which is where a phone's first press actually waits
 *
 * Both are stamped from inside the page: `Storage.prototype.setItem`,
 * `AudioBufferSourceNode.prototype.start` and `BaseAudioContext.prototype
 * .decodeAudioData` are wrapped before the app's first line, so nothing here
 * depends on the app agreeing to be measured.
 *
 * Desktop Chromium under mobile emulation. There is no physical phone in this
 * measurement and none of these numbers is a claim about one.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { device, fixture } from "./device.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";
const ROUNDS = Number(process.env.ROUNDS ?? 12);
const WARMUP = Number(process.env.WARMUP ?? 3);
mkdirSync(OUT, { recursive: true });

const round = (value, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    rounds: sorted.length,
    median: round(sorted[Math.floor(sorted.length / 2)]),
    p95: round(sorted[Math.floor(sorted.length * 0.95)]),
    max: round(sorted[sorted.length - 1]),
  };
};

/** Wrapped before the app loads, so the app is never asked to cooperate. */
const STAMPS = `
window.__perf = { writes: [], starts: [], decodes: [] };
(() => {
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (String(key).startsWith("aranje.project.")) {
      window.__perf.writes.push(performance.now());
    }
    return setItem.call(this, key, value);
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.__perf.starts.push(performance.now());
    return start.apply(this, args);
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (...args) {
    const began = performance.now();
    const done = decode.apply(this, args);
    Promise.resolve(done).then(
      () => window.__perf.decodes.push(performance.now() - began),
      () => {},
    );
    return done;
  };
})();
`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(
  ([entries, stamps]) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
    (0, eval)(stamps);
  },
  [Object.entries(device(fixture("roomy"))), STAMPS],
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByTestId("view-tab").click();
await page.waitForTimeout(400);
await page.locator("[data-action-row] button", { hasText: "Düzenle" }).first().click();
await page.waitForTimeout(300);

/* ------------------------------------------------- a pen write, end to end */

/*
 * Idempotent on purpose. The pen stays in the hand after it writes (§7), and
 * picking the same option again would put it back down — which would turn the
 * next round into an ordinary cell tap and measure nothing.
 */
const armPen = async () => {
  const armed = await page.evaluate(
    () => document.querySelector("[data-composer-held]") !== null,
  );
  if (armed) return;
  await page.locator("[data-composer-door='shape']").click();
  await page.waitForTimeout(200);
  await page.locator("[data-composer-option='power-2']").click();
  await page.waitForTimeout(300);
};

const tapAt = async (cell) => {
  const node = page.locator(`[data-cell='${cell}']`).first();
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox();
  if (!box) throw new Error(`no cell ${cell}`);
  const occluded = await page.evaluate(
    ([x, y, key]) => {
      const top = document.elementFromPoint(x, y);
      return !top || top.closest(`[data-cell='${key}']`) ? null : "occluded";
    },
    [box.x + box.width / 2, box.y + box.height / 2, cell],
  );
  if (occluded) {
    await page.locator("[data-return-to-playback]").click();
    await page.waitForTimeout(200);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const undo = async () => {
  await page.locator("[data-undo]").click();
  await page.waitForTimeout(250);
};

const write = [];
const paint = [];
for (let index = 0; index < WARMUP + ROUNDS; index += 1) {
  await armPen();
  const slot = 3 + (index % 4);
  const point = await tapAt(`${slot}:0`);
  await page.evaluate(() => {
    window.__perf.writes.length = 0;
    window.__perf.tap = null;
    window.__perf.painted = null;
  });
  // The stamp is taken inside the page, so the CDP round trip is not counted.
  await page.evaluate(([x, y]) => {
    window.__perf.tap = performance.now();
    const target = document.elementFromPoint(x, y);
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__perf.painted = performance.now();
      });
    });
  }, [point.x, point.y]);
  await page.waitForTimeout(450);
  const sample = await page.evaluate(() => ({
    tap: window.__perf.tap,
    firstWrite: window.__perf.writes[0] ?? null,
    painted: window.__perf.painted,
    writes: window.__perf.writes.length,
  }));
  if (sample.firstWrite === null) throw new Error(`round ${index}: nothing was written`);
  if (sample.writes !== 1) throw new Error(`round ${index}: ${sample.writes} writes`);
  if (index >= WARMUP) {
    write.push(sample.firstWrite - sample.tap);
    paint.push(sample.painted - sample.tap);
  }
  await undo();
}

/* -------------------------------------------------------- the sample audio */

await page.evaluate(() => {
  window.__perf.starts.length = 0;
  window.__perf.decodes.length = 0;
  window.__perf.play = null;
});
await page.evaluate(() => {
  window.__perf.play = performance.now();
});
await page.locator("footer button[aria-label='Çal']").click();
await page.waitForTimeout(4000);
const audio = await page.evaluate(() => ({
  play: window.__perf.play,
  firstStart: window.__perf.starts[0] ?? null,
  starts: window.__perf.starts.length,
  decodes: window.__perf.decodes.length,
  decodeTotal: window.__perf.decodes.reduce((sum, value) => sum + value, 0),
  decodeMax: window.__perf.decodes.length ? Math.max(...window.__perf.decodes) : null,
}));

await context.close();
await browser.close();

/* ------------------------------------------------------------ the artefact */

const existing = JSON.parse(readFileSync(`${OUT}/PERFORMANCE.json`, "utf8"));
existing.browser = {
  measuredOn:
    "Masaüstü Chromium, 390×844 mobil emülasyonu, production build. Fiziksel telefon kanıtı yoktur.",
  method: `${WARMUP} ısınma turu, ardından ${ROUNDS} zamanlanmış tur. Damgalar sayfanın içinden alındı: CDP gidiş-dönüşü sayılmıyor.`,
  notes: [
    "Her tur gerçekten yazdığı ve tam olarak bir kez yazdığı doğrulanarak zamanlandı; yazmayan bir tur ölçümü bozup hızlı gösterirdi.",
    "«ilk boyanmış kare» iki rAF sonrasıdır: React'in commit'i ve tarayıcının layout'u dâhil, tek bir kare değil.",
    "Örnek sesin maliyeti ilk basışta ödenir; ikinci basış aynı tamponları bulur ve bu sayı onu temsil etmez.",
  ],
  layers: {
    "render: tap to the storage write": stats(write),
    "render: tap to the first painted frame": stats(paint),
    "sample audio: play to the first buffer": {
      rounds: 1,
      firstBufferMs: audio.firstStart === null ? null : round(audio.firstStart - audio.play),
      buffersStarted: audio.starts,
      decodeCalls: audio.decodes,
      decodeTotalMs: round(audio.decodeTotal),
      decodeMaxMs: audio.decodeMax === null ? null : round(audio.decodeMax),
    },
  },
  pageErrors: errors,
};
writeFileSync(`${OUT}/PERFORMANCE.json`, `${JSON.stringify(existing, null, 2)}\n`);
console.log(JSON.stringify(existing.browser.layers, null, 2));
if (errors.length > 0) console.log("page errors:", errors);
