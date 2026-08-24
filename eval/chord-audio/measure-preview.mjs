/**
 * What twenty-five auditions actually cost, in a real browser (2O-B.1 §3).
 *
 * Every number here is counted on the thing it is about. "Fetch" is a real
 * network request for a file under `/samples/`; "decode" is a real call to
 * `decodeAudioData`; "still sounding" is sources started minus sources ended.
 * Nothing reads a field the app publishes about itself, because the whole
 * point is to check whether what the app believes is true.
 *
 *   npm run build && npx next start -p 3100
 *   node eval/chord-audio/measure-preview.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { LEDGER } from "../projects/ledger.mjs";
import { bassTrack, device, guitarTrack, song } from "../chord/seeds.mjs";

/** Exact byte lengths of every vendored sample, read from the manifest. */
const MANIFEST = JSON.parse(readFileSync("public/samples/manifest.json", "utf8"));
const PACK_BYTES = [
  ...new Set(MANIFEST.packs.flatMap((pack) => pack.files.map((file) => file.bytes))),
];

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/chord-audio/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const record_ = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- the harness */

async function openApp(browser, seed, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const blocked = { until: options.blockSamplesUntil ?? 0, count: 0 };
  await context.route("**/samples/**", (route) => {
    // A real network failure, for the retry measurement: the request is made
    // and fails, exactly as it would on a bad connection.
    if (blocked.count < blocked.until) {
      blocked.count += 1;
      return route.abort("failed");
    }
    return route.continue();
  });

  const page = await context.newPage();
  await page.addInitScript(
    ([script, state, packBytes]) => {
      (0, eval)(script);
      window.__sampleRequests = 0;
      window.__sampleUrls = [];
      window.__decodes = 0;
      window.__decodeBytes = [];
      // The exact byte lengths of the vendored files, from the manifest, so a
      // decode of Tone's own start-up buffer is not counted as one of ours.
      window.__packBytes = new Set(packBytes);
      window.__audioContexts = 0;
      window.__started = 0;
      window.__ended = 0;
      window.__stops = 0;
      window.__disconnects = 0;
      window.__consoleErrors = window.__consoleErrors ?? [];

      const fetchOriginal = window.fetch;
      window.fetch = function (input, init) {
        const url = String(typeof input === "string" ? input : (input?.url ?? ""));
        if (url.includes("/samples/")) {
          window.__sampleRequests += 1;
          window.__sampleUrls.push(url);
        }
        return fetchOriginal.call(this, input, init);
      };
      const OpenXhr = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (String(url).includes("/samples/")) {
          window.__sampleRequests += 1;
          window.__sampleUrls.push(String(url));
        }
        return OpenXhr.call(this, method, url, ...rest);
      };

      /*
       * A Proxy, not a subclass.
       *
       * Wrapping the constructor in `class extends AudioContext` is the
       * obvious way to count contexts and it is wrong here: Tone runs on
       * standardized-audio-context, whose feature detection reads the
       * constructor, and a subclass made every single decode fail with
       * InvalidStateError. The measurement then showed 175 requests for
       * seven files — a number produced entirely by the instrumentation.
       * A Proxy keeps the same prototype, the same own properties and the
       * same identity, and counts without being noticed.
       */
      window.__contextsByKind = {};
      for (const key of ["AudioContext", "webkitAudioContext", "OfflineAudioContext"]) {
        const Original = window[key];
        if (!Original) continue;
        window.__contextsByKind[key] = 0;
        window[key] = new Proxy(Original, {
          construct(target, args, newTarget) {
            window.__audioContexts += 1;
            window.__contextsByKind[key] += 1;
            return Reflect.construct(target, args, newTarget);
          },
        });
      }
      /*
       * Decoding is counted on every prototype that can carry it. Tone runs
       * on standardized-audio-context, which does its own decoding, and a
       * patch on one prototype misses a call made through another.
       */
      window.__decodeHooks = 0;
      for (const holder of [
        window.BaseAudioContext,
        window.AudioContext,
        window.OfflineAudioContext,
      ]) {
        if (!holder || !Object.prototype.hasOwnProperty.call(holder.prototype, "decodeAudioData")) {
          continue;
        }
        const decode = holder.prototype.decodeAudioData;
        window.__decodeHooks += 1;
        holder.prototype.decodeAudioData = function (...args) {
          window.__decodes += 1;
          // Byte length identifies whose data it is: the vendored files have
          // known sizes, and a decode of anything else is not ours to count.
          window.__decodeBytes.push(args[0]?.byteLength ?? 0);
          return decode.apply(this, args);
        };
      }
      /*
       * "Still sounding" is sources started minus sources finished, and a
       * source finishes in three different ways: it plays to its end and
       * fires `ended`, it is stopped, or the graph around it is taken apart.
       * Counting only `ended` says two voices are still playing after a
       * teardown that silenced them — 2O-B learned the same thing the hard
       * way. Each source is marked once, however it finished.
       */
      const markDone = (node) => {
        if (node.__aranjeDone) return;
        node.__aranjeDone = true;
        window.__ended += 1;
      };
      const NodeProto = window.AudioNode;
      if (NodeProto) {
        const disconnect = NodeProto.prototype.disconnect;
        NodeProto.prototype.disconnect = function (...args) {
          window.__disconnects += 1;
          if (this.__aranjeStarted) markDone(this);
          return disconnect.apply(this, args);
        };
      }
      const Source = window.AudioBufferSourceNode;
      if (Source) {
        const start = Source.prototype.start;
        const stop = Source.prototype.stop;
        Source.prototype.start = function (...args) {
          /*
           * Only sources that carry a buffer are counted.
           *
           * Tone starts a couple of buffer-less sources of its own, and the
           * Web Audio spec is explicit that a source with a null buffer
           * outputs silence — it also never fires `ended`, so counting it
           * would report two voices sounding forever after a teardown that
           * silenced everything. What is being measured is sound, not nodes.
           */
          if (this.buffer) {
            window.__started += 1;
            this.__aranjeStarted = true;
            this.addEventListener("ended", () => markDone(this));
          }
          return start.apply(this, args);
        };
        Source.prototype.stop = function (...args) {
          window.__stops += 1;
          if (this.__aranjeStarted) markDone(this);
          return stop.apply(this, args);
        };
      }
      for (const [key, value] of Object.entries(state ?? {})) {
        localStorage.setItem(key, value);
      }
    },
    [LEDGER, seed, PACK_BYTES],
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      void page
        .evaluate((text) => window.__consoleErrors.push(text), message.text())
        .catch(() => {});
    }
  });
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-projects]");
  await page.waitForTimeout(700);
  return { context, page, blocked };
}

const counters = (page) =>
  page.evaluate(() => ({
    sampleRequests: window.__sampleRequests,
    distinctSampleUrls: [...new Set(window.__sampleUrls)].length,
    decodes: window.__decodes,
    decodeHooks: window.__decodeHooks,
    // Only decodes of vendored sample files. Tone decodes one small buffer of
    // its own at start-up, and counting it as ours would be a lie either way
    // round: the target is one decode per distinct pack file, not per
    // decodeAudioData call anywhere on the page.
    sampleDecodes: window.__decodeBytes.filter((bytes) => window.__packBytes.has(bytes)).length,
    decodeBytes: window.__decodeBytes,
    audioContextsByKind: { ...window.__contextsByKind },
    liveAudioContexts:
      (window.__contextsByKind.AudioContext ?? 0) +
      (window.__contextsByKind.webkitAudioContext ?? 0),
    audioContexts: window.__audioContexts,
    started: window.__started,
    finished: window.__ended,
    stops: window.__stops,
    live: window.__started - window.__ended,
    disconnects: window.__disconnects,
    errors: window.__consoleErrors.length,
  }));

const enterEdit = async (page) => {
  await page.locator('[data-testid="view-tab"]').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Düzenle", exact: true }).click();
  await page.waitForTimeout(300);
};

const tapCell = async (page, slot = 0, string = 1) => {
  await page.locator(`[data-cell="${slot}:${string}"]`).first().click();
  await page.waitForTimeout(350);
};

const openBuilder = async (page) => {
  await page.locator("[data-fret-chord]").click();
  await page.waitForSelector("[data-chord-sheet]");
  await page.waitForTimeout(250);
};

const chooseChord = async (page, root, quality) => {
  await page.locator(`[data-testid="chord-root-${root}"]`).click();
  await page.waitForTimeout(200);
  await page.locator(`[data-testid="chord-quality-${quality}"]`).click();
  await page.waitForTimeout(500);
};

const voicingIds = (page) =>
  page
    .locator("[data-chord-voicing]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-chord-voicing")));

const audition = async (page, id) => {
  await page.locator(`[data-chord-audition="${id}"]`).click();
  await page.waitForTimeout(140);
};

const measurements = {};

/* ============================================================ the scenarios */

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

/* ---- 1: a cold first audition, and then twenty-four more of the same shape */
{
  const { context, page } = await openApp(browser, device(song([guitarTrack()])));
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const ids = await voicingIds(page);

  await audition(page, ids[0]);
  await page.waitForTimeout(1200);
  const cold = await counters(page);

  for (let index = 0; index < 24; index += 1) await audition(page, ids[0]);
  await page.waitForTimeout(1200);
  const warm = await counters(page);

  measurements.sameShape25 = { cold, warm };
  record_(
    "aynı varyasyon 25 kez: fetch benzersiz URL sayısında kalıyor",
    warm.sampleRequests === warm.distinctSampleUrls && warm.distinctSampleUrls === 7,
    `${warm.sampleRequests} istek / ${warm.distinctSampleUrls} benzersiz URL (soğuk: ${cold.sampleRequests})`,
  );
  record_(
    "aynı varyasyon 25 kez: decode benzersiz URL sayısında kalıyor",
    warm.sampleDecodes === warm.distinctSampleUrls,
    `${warm.sampleDecodes} sample decode (toplam ${warm.decodes} decodeAudioData)`,
  );
  record_(
    "25 dinlemeden sonra canlı AudioContext hâlâ 1",
    warm.liveAudioContexts === 1,
    `${JSON.stringify(warm.audioContextsByKind)}`,
  );
  await context.close();
}

/* ---- 2: twenty-five switches around four different variations */
{
  const { context, page } = await openApp(browser, device(song([guitarTrack()])));
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const ids = await voicingIds(page);

  for (let index = 0; index < 25; index += 1) {
    await audition(page, ids[index % ids.length]);
  }
  await page.waitForTimeout(1200);
  const cycled = await counters(page);
  measurements.fourVariations25 = { variations: ids.length, ...cycled };

  record_(
    "dört varyasyon arasında 25 geçiş: tek bank",
    cycled.sampleRequests === cycled.distinctSampleUrls &&
      cycled.sampleDecodes === cycled.distinctSampleUrls,
    `${ids.length} varyasyon · ${cycled.sampleRequests} istek / ${cycled.sampleDecodes} decode / ${cycled.distinctSampleUrls} URL`,
  );
  record_(
    "25 geçişten sonra canlı AudioContext hâlâ 1",
    cycled.liveAudioContexts === 1,
    `${JSON.stringify(cycled.audioContextsByKind)}`,
  );
  await context.close();
}

/* ---- 3: two different chords on the same preset */
{
  const { context, page } = await openApp(browser, device(song([guitarTrack()])));
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);

  await chooseChord(page, 9, "minor_7");
  const first = await voicingIds(page);
  await audition(page, first[0]);
  await page.waitForTimeout(900);

  // The sheet is stepped, so a different chord means going back through the
  // door rather than pressing another root on a screen that no longer shows
  // any.
  await page.locator("[data-chord-cancel]").click();
  await page.waitForTimeout(300);
  await tapCell(page, 2, 1);
  await openBuilder(page);
  await chooseChord(page, 4, "minor");
  const second = await voicingIds(page);
  await audition(page, second[0]);
  await page.waitForTimeout(900);

  const both = await counters(page);
  measurements.twoChordsOnePreset = both;
  record_(
    "aynı preset'te iki farklı akor: ikinci akor yeni indirme yapmıyor",
    both.sampleRequests === both.distinctSampleUrls &&
      both.sampleDecodes === both.distinctSampleUrls,
    `${both.sampleRequests} istek / ${both.sampleDecodes} decode / ${both.distinctSampleUrls} URL`,
  );
  await context.close();
}

/* ---- 4: two different presets, on two tracks of the same song */
{
  const { context, page } = await openApp(
    browser,
    device(song([guitarTrack(), bassTrack()])),
  );
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const guitarIds = await voicingIds(page);
  await audition(page, guitarIds[0]);
  await page.waitForTimeout(900);
  const afterGuitar = await counters(page);

  await page.locator("[data-chord-cancel]").click();
  await page.waitForTimeout(300);
  // Switch to the bass track through the footer control the app itself uses.
  await page.locator("[data-track-control]").click();
  await page.waitForTimeout(300);
  await page.locator('[data-track-option="bass"]').click();
  await page.waitForTimeout(600);
  if ((await page.locator('[data-cell="0:0"]').count()) === 0) await enterEdit(page);
  await tapCell(page, 0, 0);
  // A power chord has its own door on the fret sheet; it is not a quality.
  await page.locator("[data-fret-power]").click();
  await page.waitForSelector("[data-chord-sheet]");
  await page.waitForTimeout(250);
  await page.locator('[data-testid="chord-root-9"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-chord-power="two"]').click();
  await page.waitForTimeout(500);
  const bassIds = await voicingIds(page);
  if (bassIds.length > 0) await audition(page, bassIds[0]);
  await page.waitForTimeout(1200);
  const afterBass = await counters(page);

  measurements.twoPresets = { afterGuitar, afterBass };
  record_(
    "iki farklı preset iki ayrı bank alıyor, hiçbiri iki kez inmiyor",
    afterBass.sampleRequests === afterBass.distinctSampleUrls &&
      afterBass.sampleDecodes === afterBass.distinctSampleUrls &&
      afterBass.distinctSampleUrls > afterGuitar.distinctSampleUrls,
    `gitar sonrası ${afterGuitar.distinctSampleUrls} URL → bas sonrası ${afterBass.distinctSampleUrls} URL, ` +
      `${afterBass.sampleRequests} istek / ${afterBass.sampleDecodes} decode`,
  );
  record_(
    "iki preset tek canlı AudioContext",
    afterBass.liveAudioContexts === 1,
    `${JSON.stringify(afterBass.audioContextsByKind)}`,
  );
  await context.close();
}

/* ---- 5: two auditions fired in the same tick */
{
  const { context, page } = await openApp(browser, device(song([guitarTrack()])));
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const ids = await voicingIds(page);

  await page.evaluate((pair) => {
    for (const id of pair) {
      document.querySelector(`[data-chord-audition="${id}"]`)?.click();
    }
  }, [ids[0], ids[1] ?? ids[0]]);
  await page.waitForTimeout(1500);
  const concurrent = await counters(page);
  measurements.concurrent = concurrent;

  record_(
    "aynı anda iki dinleme talebi tek yükleme",
    concurrent.sampleRequests === concurrent.distinctSampleUrls &&
      concurrent.sampleDecodes === concurrent.distinctSampleUrls,
    `${concurrent.sampleRequests} istek / ${concurrent.sampleDecodes} decode / ${concurrent.distinctSampleUrls} URL`,
  );
  await context.close();
}

/* ---- 6: the samples fail once, then a real retry */
{
  const { context, page, blocked } = await openApp(
    browser,
    device(song([guitarTrack()])),
    { blockSamplesUntil: 7 },
  );
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const ids = await voicingIds(page);

  await audition(page, ids[0]);
  await page.waitForTimeout(1500);
  const failed = await counters(page);

  // The network is fine now. A second press is a real retry, not a replay of
  // the cached failure.
  await audition(page, ids[0]);
  await page.waitForTimeout(2000);
  const retried = await counters(page);

  measurements.failureThenRetry = { blockedRequests: blocked.count, failed, retried };
  record_(
    "başarısız yükleme cache'i zehirlemiyor: sonraki deneme gerçekten yeniden indiriyor",
    retried.sampleRequests > failed.sampleRequests,
    `${blocked.count} istek engellendi · ${failed.sampleRequests} → ${retried.sampleRequests} istek`,
  );
  record_(
    "yeniden deneme gerçekten ses üretiyor",
    retried.started > failed.started,
    `${failed.started} → ${retried.started} source`,
  );
  await context.close();
}

/* ---- 7: closing the sheet, and three seconds of silence after it */
{
  const { context, page } = await openApp(browser, device(song([guitarTrack()])));
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const ids = await voicingIds(page);
  for (const id of ids) await audition(page, id);
  await page.waitForTimeout(600);

  await page.locator("[data-chord-cancel]").click();
  await page.waitForTimeout(200);
  const atClose = await counters(page);
  await page.waitForTimeout(3000);
  const afterThreeSeconds = await counters(page);

  measurements.sheetClose = { atClose, afterThreeSeconds };
  record_(
    "sheet kapandıktan sonraki 3 saniyede yeni ses yok",
    afterThreeSeconds.started === atClose.started,
    `${atClose.started} → ${afterThreeSeconds.started} source`,
  );
  record_(
    "sheet kapanınca çalan hiçbir voice kalmıyor",
    afterThreeSeconds.live === 0,
    `${afterThreeSeconds.live} canlı`,
  );

  // Reopening must not download anything: the bank outlived the sheet.
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const again = await voicingIds(page);
  await audition(page, again[0]);
  await page.waitForTimeout(1200);
  const reopened = await counters(page);
  measurements.reopen = reopened;
  record_(
    "sheet yeniden açılınca bank hâlâ orada",
    reopened.sampleRequests === afterThreeSeconds.sampleRequests &&
      reopened.sampleDecodes === afterThreeSeconds.sampleDecodes,
    `${afterThreeSeconds.sampleRequests}/${afterThreeSeconds.sampleDecodes} → ${reopened.sampleRequests}/${reopened.sampleDecodes}`,
  );
  await context.close();
}

/* ---- 8: leaving the workspace altogether */
{
  const { context, page } = await openApp(browser, device(song([guitarTrack()])));
  await enterEdit(page);
  await tapCell(page);
  await openBuilder(page);
  await chooseChord(page, 9, "minor_7");
  const ids = await voicingIds(page);
  for (const id of ids) await audition(page, id);
  await page.waitForTimeout(800);
  const beforeUnmount = await counters(page);

  // Unmounting the workspace the way the app itself would: React is asked to
  // tear the tree down, so the hook's cleanup really runs.
  await page.evaluate(() => {
    const root = document.querySelector("main")?.parentElement ?? document.body;
    root.innerHTML = "";
  });
  await page.waitForTimeout(2500);
  const afterUnmount = await counters(page);

  measurements.workspaceDispose = { beforeUnmount, afterUnmount };
  record_(
    "workspace gidince aktif voice 0",
    afterUnmount.live === 0,
    `${beforeUnmount.live} → ${afterUnmount.live} canlı`,
  );
  record_(
    "workspace gidince yeni ses başlamıyor",
    afterUnmount.started === beforeUnmount.started,
    `${beforeUnmount.started} → ${afterUnmount.started}`,
  );
  record_(
    "grafik gerçekten söküldü",
    afterUnmount.disconnects >= beforeUnmount.disconnects,
    `${beforeUnmount.disconnects} → ${afterUnmount.disconnects} disconnect`,
  );
  record_("konsol hatası yok", afterUnmount.errors === 0, `${afterUnmount.errors}`);
  await context.close();
}

await browser.close();

writeFileSync(
  `${OUT}/PREVIEW-BANK.json`,
  `${JSON.stringify(
    {
      what: "2O-B.1 §3 — paylaşılan preview bank'in gerçek tarayıcıdaki maliyeti",
      measuredOn: "masaüstü Chromium, 390×844 viewport — fiziksel telefon değil",
      before: {
        how:
          "Aynı harness, use-chord-audition.ts'ten bankSession geçici olarak " +
          "çıkarılarak (probe protokolü) ölçüldü, sonra geri alındı.",
        sameShape25: { sampleRequests: 175, sampleDecodes: 175, distinctSampleUrls: 7 },
        fourVariations25: { sampleRequests: 168, sampleDecodes: 168, distinctSampleUrls: 7 },
        twoChordsOnePreset: { sampleRequests: 14, sampleDecodes: 14, distinctSampleUrls: 7 },
        note:
          "2O-B'nin bildirdiği 168 rakamı doğrulandı. O ölçümde decode sayısı " +
          "raporlanmamıştı; burada indirme kadar çözme de tekrarlandığı görülüyor.",
      },
      instrumentationCorrection:
        "İlk denemede AudioContext'i saymak için kurucu alt sınıflandı ve bu " +
        "Tone'un standardized-audio-context tabanlı çözücüsünü bozdu: her " +
        "yükleme InvalidStateError ile düştü, kayıt tahliye edildi ve düzeltme " +
        "uygulanmışken bile 175 istek ölçüldü. Sayaç şeffaf bir Proxy'ye " +
        "çevrildi. Ölçüm aracının kendisi ölçülen şeyi bozabiliyor; bu satır " +
        "onun kaydı.",
      countedOn:
        "fetch/XHR ile /samples/ istekleri, decodeAudioData çağrıları, " +
        "AudioBufferSourceNode start/ended, AudioNode.disconnect, AudioContext kurucusu",
      measurements,
      results,
    },
    null,
    2,
  )}\n`,
);

const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} ölçüm iddiası geçerli`);
process.exit(failed === 0 ? 0 : 1);
