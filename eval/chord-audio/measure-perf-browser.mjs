/**
 * What the audible work costs, in a real browser (2P-A §18).
 *
 * Median / p95 / max, over twenty rounds for the interactions and five for
 * the ones that build a whole audio graph — a cold audition downloads and
 * decodes a pack, and twenty of those would measure the container's disk
 * cache rather than the app. The round count is reported with every number
 * so nobody has to guess which kind it was.
 *
 * Desktop Chromium. Not a phone, and not evidence about one.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/chord-audio/measure-perf-browser.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { LEDGER } from "../projects/ledger.mjs";
import { device, guitarTrack, song } from "../chord/seeds.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/chord-audio/artifacts";
mkdirSync(OUT, { recursive: true });

const timings = [];
const record_ = (name, samples, rounds, note) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] * 100) / 100;
  const entry = {
    name,
    rounds,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    ...(note ? { note } : {}),
  };
  timings.push(entry);
  console.log(
    `${name.padEnd(44)} n=${String(rounds).padStart(2)}  median ${entry.medianMs}ms  p95 ${entry.p95Ms}ms  max ${entry.maxMs}ms`,
  );
};

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

async function open(size = { width: 390, height: 844 }, seed = device(song([guitarTrack()]))) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  await page.addInitScript(
    ([ledger, state]) => {
      (0, eval)(ledger);
      window.__sampleRequests = 0;
      window.__sampleUrls = [];
      window.__decodes = 0;
      window.__objectUrls = 0;
      window.__started = 0;
      const fetchOriginal = window.fetch;
      window.fetch = function (input, init) {
        const url = String(typeof input === "string" ? input : (input && input.url) || "");
        if (url.indexOf("/samples/") !== -1) {
          window.__sampleRequests += 1;
          window.__sampleUrls.push(url);
        }
        return fetchOriginal.call(this, input, init);
      };
      const Base = window.BaseAudioContext;
      if (Base && Object.prototype.hasOwnProperty.call(Base.prototype, "decodeAudioData")) {
        const decode = Base.prototype.decodeAudioData;
        Base.prototype.decodeAudioData = function (...args) {
          window.__decodes += 1;
          return decode.apply(this, args);
        };
      }
      const create = URL.createObjectURL;
      URL.createObjectURL = function (...args) {
        window.__objectUrls += 1;
        return create.apply(this, args);
      };
      const Source = window.AudioBufferSourceNode;
      const start = Source.prototype.start;
      Source.prototype.start = function (...args) {
        if (this.buffer) window.__started += 1;
        return start.apply(this, args);
      };
      for (const [key, value] of Object.entries(state ?? {})) {
        localStorage.setItem(key, value);
      }
    },
    [LEDGER, seed],
  );
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-projects]");
  await page.waitForTimeout(700);
  return { context, page };
}

const enterEdit = async (page) => {
  await page.locator('[data-testid="view-tab"]').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Düzenle", exact: true }).click();
  await page.waitForTimeout(300);
};
const openChord = async (page) => {
  await page.locator('[data-cell="0:1"]').first().click();
  await page.waitForTimeout(350);
  await page.locator("[data-fret-chord]").click();
  await page.waitForSelector("[data-chord-sheet]");
  await page.locator('[data-testid="chord-root-9"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="chord-quality-minor_7"]').click();
  await page.waitForTimeout(500);
  return page
    .locator("[data-chord-voicing]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-chord-voicing")));
};

/** Time from the press to the first buffer source that carried audio. */
const timeToSound = async (page, press) => {
  const before = await page.evaluate(() => window.__started);
  const started = Date.now();
  await press();
  await page.waitForFunction((count) => window.__started > count, before, { timeout: 15000 });
  return Date.now() - started;
};

/* ---- cold first audition: five rounds, each in a fresh context */
{
  const cold = [];
  const counts = [];
  for (let round = 0; round < 5; round += 1) {
    const { context, page } = await open();
    await enterEdit(page);
    const ids = await openChord(page);
    cold.push(
      await timeToSound(page, () =>
        page.locator(`[data-chord-audition="${ids[0]}"]`).click(),
      ),
    );
    await page.waitForTimeout(600);
    counts.push(await page.evaluate(() => ({
      requests: window.__sampleRequests,
      distinct: [...new Set(window.__sampleUrls)].length,
      decodes: window.__decodes,
      contexts: window.__audioContexts,
    })));
    await context.close();
  }
  record_(
    "ilk (soğuk) akor dinlemesi",
    cold,
    5,
    "her tur taze bir context: paket indiriliyor ve çözülüyor, bu yüzden 5 tur",
  );
  console.log(`   soğuk sayaçlar: ${JSON.stringify(counts[0])}`);
  timings.push({
    name: "soğuk dinleme sayaçları",
    rounds: 5,
    counts,
  });
}

/* ---- warm auditions and the twenty-five switch run */
{
  const { context, page } = await open();
  await enterEdit(page);
  const ids = await openChord(page);
  await page.locator(`[data-chord-audition="${ids[0]}"]`).click();
  await page.waitForTimeout(1500);

  const warm = [];
  for (let round = 0; round < 20; round += 1) {
    warm.push(
      await timeToSound(page, () =>
        page.locator(`[data-chord-audition="${ids[round % ids.length]}"]`).click(),
      ),
    );
    await page.waitForTimeout(120);
  }
  record_("ısınmış dinleme", warm, 20);

  const before = await page.evaluate(() => window.__sampleRequests);
  const startedAt = Date.now();
  for (let index = 0; index < 25; index += 1) {
    await page.locator(`[data-chord-audition="${ids[index % ids.length]}"]`).click();
    await page.waitForTimeout(60);
  }
  const switchRun = Date.now() - startedAt;
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => ({
    requests: window.__sampleRequests,
    distinct: [...new Set(window.__sampleUrls)].length,
    decodes: window.__decodes,
    contexts: window.__audioContexts,
    objectUrls: window.__objectUrls,
  }));
  record_(
    "25 varyasyon değişimi (toplam)",
    [switchRun],
    1,
    `${after.requests - before} yeni sample isteği · ${after.distinct} benzersiz URL · AudioContext ${after.contexts}`,
  );
  timings.push({ name: "25 değişim sonrası sayaçlar", rounds: 1, counts: [after] });

  const closes = [];
  for (let round = 0; round < 20; round += 1) {
    await page.locator(`[data-chord-audition="${ids[0]}"]`).click();
    await page.waitForTimeout(120);
    const startedClose = Date.now();
    await page.locator("[data-chord-cancel]").click();
    await page.waitForSelector("[data-chord-sheet]", { state: "detached" });
    closes.push(Date.now() - startedClose);
    await page.locator('[data-cell="0:1"]').first().click();
    await page.waitForTimeout(200);
    await page.locator("[data-fret-chord]").click();
    await page.waitForSelector("[data-chord-sheet]");
    await page.locator('[data-testid="chord-root-9"]').click();
    await page.waitForTimeout(120);
    await page.locator('[data-testid="chord-quality-minor_7"]').click();
    await page.waitForTimeout(250);
  }
  record_("sheet kapatma ve dispose", closes, 20);
  record_(
    "ObjectURL etkisi",
    [after.objectUrls],
    1,
    after.objectUrls === 0
      ? "dinleme yolu hiç ObjectURL üretmiyor — 0"
      : `${after.objectUrls} ObjectURL`,
  );
  await context.close();
}

/* ---- a brand-new song: how long until its first track makes a sound */
{
  const first = [];
  for (let round = 0; round < 5; round += 1) {
    const { context, page } = await open({ width: 390, height: 844 }, null);
    await page.locator("[data-open-projects]").click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="project-new"]').click();
    await page.waitForTimeout(250);
    await page.locator('[data-project-template="empty"]').click();
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "Kapat" }).first().click();
    await page.waitForTimeout(400);
    await enterEdit(page);
    const ids = await openChord(page);
    first.push(
      await timeToSound(page, () =>
        page.locator(`[data-chord-audition="${ids[0]}"]`).click(),
      ),
    );
    await context.close();
  }
  record_(
    "varsayılan şablonun ilk sesi",
    first,
    5,
    "proje oluşturmadan ilk duyulan sese kadar; her tur taze context",
  );
}

/* ---- scanning a rendered buffer for its peak, on the real export length */
{
  const { context, page } = await open();
  const scans = await page.evaluate(() => {
    const frames = 44100 * 12;
    const channel = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      channel[index] = Math.sin(index / 50) * 0.4;
    }
    const samples = [];
    for (let round = 0; round < 20; round += 1) {
      const started = performance.now();
      let peak = 0;
      for (let index = 0; index < frames; index += 1) {
        const value = Math.abs(channel[index]);
        if (value > peak) peak = value;
      }
      samples.push(performance.now() - started);
    }
    return samples;
  });
  record_("WAV tepe taraması (12 sn, tek kanal)", scans, 20);
  await context.close();
}

await browser.close();

writeFileSync(
  `${OUT}/PERFORMANCE-BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2P-A §18 — gerçek tarayıcıda duyulur işin maliyeti",
      measuredOn:
        "masaüstü Chromium, 390×844 viewport — fiziksel telefon DEĞİL ve " +
        "telefon hakkında kanıt değil",
      method:
        "etkileşimler 20 tur; ses grafiği kuran ölçümler 5 tur, çünkü soğuk " +
        "bir dinleme paketi indirip çözüyor ve yirmi tur uygulamayı değil " +
        "container'ın disk önbelleğini ölçerdi",
      noThresholds: "Bu dosyada eşik yok; sayılar ileride bir bütçenin zeminidir.",
      timings,
    },
    null,
    2,
  )}\n`,
);
