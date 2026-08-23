/**
 * Faz 2L-C browser verification: the mixer, end to end.
 *
 * Thirty-five scenarios in two viewports, against the real production build.
 *
 * Sound is never argued from the DOM here. Every audio claim is a count off
 * the real Web Audio graph: `AudioParam.value` writes are captured per node
 * kind, so a slider that "previews" has to have written a gain, and a pan
 * that moves has to have written a panner. Storage writes are counted on the
 * real `Storage.prototype.setItem`, engines on the real `AudioContext`
 * constructor, and sample traffic on the real network.
 *
 *   rm -rf .next && NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true npm run build
 *   npx next start -p 3100
 *   node eval/mixer/verify.mjs              # both viewports
 *   ONE_VIEWPORT=1 node eval/mixer/verify.mjs
 */
import { chromium } from "playwright";
import { layoutProbe, targetEdges, unwrapStoredSong } from "../shared/harness.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.MIXER_OUT ?? "eval/mixer/artifacts";
mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- fixtures */

const GUITAR = ["E2", "A2", "D3", "G3", "B3", "E4"];

const track = (id, name, extra = {}) => ({
  id,
  name,
  instrumentId: "electric_guitar",
  // The preset that actually has a sample pack, so every track builds a voice.
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: GUITAR, capo: 0 },
  ...extra,
});

/** Eight tracks, so the list has to scroll on a phone. */
const eightTrackSong = () => ({
  version: 2,
  title: "Sekiz Kanal",
  bpm: 120,
  key: "E minor",
  tracks: [
    track("t1", "Ritim Gitar"),
    track("t2", "Solo Gitar"),
    track("t3", "Akustik", { instrumentId: "steel_acoustic", presetId: "finger" }),
    track("t4", "Bas", {
      instrumentId: "electric_bass",
      presetId: "finger",
      fretboard: { tuning: ["E1", "A1", "D2", "G2"], capo: 0 },
    }),
    { id: "t5", name: "Davul", instrumentId: "drum_kit", presetId: "rock", volumeDb: -4 },
    track("t6", "Gitar Üç"),
    track("t7", "Gitar Dört"),
    track("t8", "Gitar Beş"),
  ],
  sections: [
    {
      id: "s1",
      name: "Giriş",
      status: "fixed",
      bars: [
        {
          timeSignature: [4, 4],
          resolution: 8,
          slots: {
            t1: [
              { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] },
              null, null, null, null, null, null, null,
            ],
          },
        },
      ],
    },
  ],
});

/**
 * Three tracks carrying the ids a new "Rock grubu" song will also use.
 *
 * Deliberate: if a new song's tracks had fresh ids, dropping the audition
 * would be indistinguishable from pruning ids that no longer exist, and the
 * scenario would pass without the clearing ever happening.
 */
const numberedSong = () => ({
  ...eightTrackSong(),
  title: "Numaralı",
  tracks: [
    track("track-1", "Ritim Gitar"),
    track("track-2", "Solo Gitar"),
    track("track-3", "Bas", {
      instrumentId: "electric_bass",
      presetId: "finger",
      fretboard: { tuning: ["E1", "A1", "D2", "G2"], capo: 0 },
    }),
  ],
  sections: [
    {
      id: "s1",
      name: "Giriş",
      status: "fixed",
      bars: [{ timeSignature: [4, 4], resolution: 8, slots: {} }],
    },
  ],
});

/**
 * The eight-track song with one id kept from the song it will replace.
 *
 * Same reason as above: an import whose every id is new would have its
 * audition pruned away, so the scenario could not tell "different music, put
 * the audition down" from "that track no longer exists".
 */
const overlappingSong = () => {
  const song = eightTrackSong();
  return {
    ...song,
    title: "Örtüşen",
    tracks: song.tracks.map((entry, index) =>
      index === 0 ? { ...entry, id: "track-2" } : entry,
    ),
    sections: song.sections.map((section) => ({
      ...section,
      bars: section.bars.map((bar) => {
        const slots = { ...bar.slots };
        if ("t1" in slots) {
          slots["track-2"] = slots.t1;
          delete slots.t1;
        }
        return { ...bar, slots };
      }),
    })),
  };
};

const projectFile = (song) =>
  JSON.stringify({ format: "aranje.project", version: 1, song });

/* ---------------------------------------------------------------- harness */

const results = [];
const measurements = {};

const flush = () =>
  writeFileSync(
    `${OUT}/RESULTS.json`,
    `${JSON.stringify(
      { results, measurements, failed: results.filter((e) => !e.pass).length },
      null,
      2,
    )}\n`,
  );

const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  flush();
};

let lastPage = null;

async function safe(name, fn) {
  try {
    return await fn();
  } catch (error) {
    const first = String(error).split("\n")[0].slice(0, 110);
    await lastPage
      ?.screenshot({ path: `${OUT}/failed-${name.replaceAll(" ", "-").slice(0, 36)}.png` })
      .catch(() => {});
    record(name, false, first);
    return undefined;
  }
}

/*
 * Instrumented before any app code runs.
 *
 * The `AudioParam.value` hook is what makes an audio claim a measurement:
 * every gain and pan node is tagged at construction, so a write to one is
 * attributable. Nothing else in the app writes those two kinds of param
 * outside the engine's own graph.
 */
const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  window.__audioContexts = 0;
  window.__providerCalls = 0;
  window.__gainWrites = [];
  window.__panWrites = [];

  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSet.call(this, key, value);
    if (key === "aranje.song") window.__writes += 1;
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    if (url.includes("/api/copilot")) window.__providerCalls += 1;
    return originalFetch(input, init);
  };

  /*
   * Tone writes a param by scheduling it, not by assigning \`.value\`, so the
   * assignment hook alone would report an honest zero for a preview that
   * really did reach the graph. Both routes are captured, and the *value*
   * is kept rather than a count: a volume preview has to land the exact
   * linear gain the dB asks for, and a pan preview the exact position.
   */
  const record = (param, next) => {
    if (param.__aranjeKind === "gain") window.__gainWrites.push(next);
    if (param.__aranjeKind === "pan") window.__panWrites.push(next);
  };
  for (const method of [
    "setValueAtTime",
    "linearRampToValueAtTime",
    "exponentialRampToValueAtTime",
    "setTargetAtTime",
  ]) {
    const original = AudioParam.prototype[method];
    AudioParam.prototype[method] = function (...args) {
      record(this, args[0]);
      return original.apply(this, args);
    };
  }
  const paramValue = Object.getOwnPropertyDescriptor(
    AudioParam.prototype,
    "value",
  );
  Object.defineProperty(AudioParam.prototype, "value", {
    configurable: true,
    get() {
      return paramValue.get.call(this);
    },
    set(next) {
      record(this, next);
      return paramValue.set.call(this, next);
    },
  });

  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args) {
        window.__audioContexts += 1;
        const context = Reflect.construct(target, args);
        for (const [method, kind] of [
          ["createGain", "gain"],
          ["createStereoPanner", "pan"],
        ]) {
          const original = context[method].bind(context);
          context[method] = (...rest) => {
            const node = original(...rest);
            const param = kind === "gain" ? node.gain : node.pan;
            param.__aranjeKind = kind;
            return node;
          };
        }
        return context;
      },
    });
  }
`;

const REFUSE_WRITE_CHECK = `
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "aranje.probe") {
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    }
    originalSet.call(this, key, value);
  };
`;

async function openApp(browser, size, options = {}) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  if (options.seed) {
    await context.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* a private window is not a reason to fail the run */
        }
      },
      ["aranje.song", JSON.stringify(options.seed)],
    );
  }
  await context.addInitScript(INSTRUMENT);
  if (options.refuseWriteCheck) await context.addInitScript(REFUSE_WRITE_CHECK);

  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(8000);
  const sampleRequests = [];
  const external = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/samples/")) sampleRequests.push(url);
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      external.push(url);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      page.evaluate((t) => window.__consoleErrors.push(t), message.text()).catch(() => {});
    }
  });
  page.on("pageerror", (error) => {
    page.evaluate((t) => window.__consoleErrors.push(t), String(error)).catch(() => {});
  });
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-arrangement-scroller]");
  return { context, page, sampleRequests, external };
}

/* ----------------------------------------------------------- observations */

const writes = (page) => page.evaluate(() => window.__writes);
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const providerCalls = (page) => page.evaluate(() => window.__providerCalls);
const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors);
const gainWrites = (page) => page.evaluate(() => window.__gainWrites.slice());
const panWrites = (page) => page.evaluate(() => window.__panWrites.slice());
const clearAudioWrites = (page) =>
  page.evaluate(() => {
    window.__gainWrites.length = 0;
    window.__panWrites.length = 0;
  });

/** The linear gain a dB value has to land on the channel. */
const gainOf = (db) => 10 ** (db / 20);
const wrote = (list, value) =>
  list.some((entry) => Math.abs(entry - value) < 1e-6);
const stored = async (page) =>
  unwrapStoredSong(await page.evaluate(() => localStorage.getItem("aranje.song")));
const debug = (page) =>
  page.evaluate(() => ({
    status: window.__aranjeDebug?.status() ?? null,
    ticks: window.__aranjeDebug?.ticks() ?? null,
    loop: window.__aranjeDebug?.loop() ?? null,
  }));

/* --------------------------------------------------------------- gestures */

/*
 * A real graph, standing still.
 *
 * The engine is built lazily on the first play, so a mixer preview measured
 * on a page that never played would have no node to write to — an honest
 * zero that proves nothing. Playing briefly and then pausing leaves the very
 * graph the app uses, with the note envelopes no longer firing, so every
 * later param write is attributable to the mixer alone.
 */
const warmEngine = async (page) => {
  await page.locator("[aria-label='Çal']").click();
  await page.waitForTimeout(1100);
  await page.locator("[aria-label='Duraklat']").click();
  await page.waitForTimeout(500);
  await clearAudioWrites(page);
};

const openMixer = async (page) => {
  await page.locator("[data-open-mixer]").click();
  await page.waitForSelector("[data-mixer-sheet]");
};

const closeMixerByCancel = async (page) => {
  await page.locator("[data-mixer-cancel]").click();
  await page.waitForTimeout(250);
};

const setRange = async (page, selector, value) => {
  await page.locator(selector).fill(String(value));
  await page.waitForTimeout(120);
};

const pressed = (page, selector) =>
  page.locator(selector).getAttribute("aria-pressed");

const openInfo = async (page) => {
  await page.locator("[aria-label='Ses kaynakları ve lisans']").click();
  await page.waitForSelector("[data-info-new-song]");
};

const showTab = async (page) => {
  await page.locator("[data-view-switch] button").nth(1).click();
  await page.waitForTimeout(200);
};

/* ------------------------------------------------------------------- runs */

async function run(browser, size, label) {
  const at = (name) => `${label} ${name}`;

  /* ------------------------------- 1-8: opening, staging, applying, cancel */
  {
    const { context, page, sampleRequests } = await openApp(browser, size, {
      seed: eightTrackSong(),
    });
    // Build the graph and stop it, so a preview writes into a real, quiet engine.
    await warmEngine(page);

    await safe(at("01 Mikser açılır"), async () => {
      await openMixer(page);
      const rows = await page.locator("[data-mixer-row]").count();
      const scope = await page.locator("[role=dialog]").innerText();
      record(
        at("01 Mikser açılır"),
        rows === 8 && scope.includes("bütün bölümlerdeki"),
        `rows=${rows}`,
      );
    });

    await safe(at("02 Sekiz track dikey kaydırmayla erişilir"), async () => {
      const last = page.locator("[data-mixer-row='t8']");
      await last.scrollIntoViewIfNeeded();
      const box = await last.boundingBox();
      const layout = await layoutProbe(page);
      record(
        at("02 Sekiz track dikey kaydırmayla erişilir"),
        box !== null &&
          box.y >= 0 &&
          box.y < size.height &&
          layout.bodyOverflow === 0,
        `y=${Math.round(box?.y ?? -1)} overflow=${layout.bodyOverflow}`,
      );
      await page.locator("[data-mixer-row='t1']").scrollIntoViewIfNeeded();
    });

    await safe(at("03 Ses önizlemesi gerçek gain düğümüne yazar"), async () => {
      await clearAudioWrites(page);
      await setRange(page, "[data-mixer-volume='t1']", -18);
      const written = await gainWrites(page);
      const text = await page.locator("[data-mixer-volume-text='t1']").textContent();
      record(
        at("03 Ses önizlemesi gerçek gain düğümüne yazar"),
        wrote(written, gainOf(-18)) &&
          text?.trim() === "-18 dB" &&
          (await writes(page)) === 0,
        `gain wrote ${written.map((v) => v.toFixed(4)).join(",")}, ` +
          `expected ${gainOf(-18).toFixed(4)}, text=${text?.trim()}`,
      );
    });

    await safe(at("04 Stereo önizlemesi gerçek panner'a yazar"), async () => {
      await clearAudioWrites(page);
      await setRange(page, "[data-mixer-pan='t1']", -0.5);
      const list = await panWrites(page);
      const text = await page.locator("[data-mixer-pan-text='t1']").textContent();
      record(
        at("04 Stereo önizlemesi gerçek panner'a yazar"),
        list.at(-1) === -0.5 &&
          text?.trim() === "Sol %50" &&
          (await writes(page)) === 0,
        `pan wrote ${list.join(",")} text=${text?.trim()}`,
      );
    });

    await safe(at("05 Uygula tam bir yazım"), async () => {
      const before = await writes(page);
      await page.locator("[data-mixer-apply]").click();
      await page.waitForTimeout(400);
      const song = await stored(page);
      record(
        at("05 Uygula tam bir yazım"),
        (await writes(page)) === before + 1 &&
          song?.tracks[0]?.volumeDb === -18 &&
          song?.tracks[0]?.pan === -0.5 &&
          (await page.locator("[data-mixer-sheet]").count()) === 0,
        `writes +${(await writes(page)) - before}`,
      );
    });

    await safe(at("06 Uygula tek history adımı"), async () => {
      const label = await page.locator("[data-undo]").getAttribute("aria-label");
      const redoDisabled = await page.locator("[data-redo]").isDisabled();
      await page.locator("[data-undo]").click();
      await page.waitForTimeout(300);
      const undone = await stored(page);
      record(
        at("06 Uygula tek history adımı"),
        label === "Geri al: Track miksini değiştirme" &&
          redoDisabled &&
          undone?.tracks[0]?.volumeDb === -6 &&
          (await page.locator("[data-undo]").isDisabled()),
        `label=${label}`,
      );
      await page.locator("[data-redo]").click();
      await page.waitForTimeout(300);
    });

    await safe(at("07 Vazgeç sıfır yazım, runtime geri döner"), async () => {
      await openMixer(page);
      const before = await writes(page);
      await clearAudioWrites(page);
      await setRange(page, "[data-mixer-volume='t2']", -22);
      const staged = await gainWrites(page);
      await clearAudioWrites(page);
      await closeMixerByCancel(page);
      const restored = await gainWrites(page);
      const song = await stored(page);
      record(
        at("07 Vazgeç sıfır yazım, runtime geri döner"),
        (await writes(page)) === before &&
          song?.tracks[1]?.volumeDb === -6 &&
          wrote(staged, gainOf(-22)) &&
          wrote(restored, gainOf(-6)),
        `writes +${(await writes(page)) - before}, staged ${gainOf(-22).toFixed(4)}=` +
          `${wrote(staged, gainOf(-22))}, restored ${gainOf(-6).toFixed(4)}=` +
          `${wrote(restored, gainOf(-6))}`,
      );
    });

    await safe(at("08 Backdrop kapanışı da vazgeçtir"), async () => {
      await openMixer(page);
      const before = await writes(page);
      await setRange(page, "[data-mixer-volume='t2']", -20);
      await page
        .locator("[aria-label='Kapat']")
        .first()
        .click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(300);
      const song = await stored(page);
      record(
        at("08 Backdrop kapanışı da vazgeçtir"),
        (await writes(page)) === before &&
          song?.tracks[1]?.volumeDb === -6 &&
          (await page.locator("[data-mixer-sheet]").count()) === 0,
      );
    });

    measurements[`${label}-samples`] = sampleRequests.length;
    measurements[`${label}-console-1`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------------- 9-15: the audition truth table */
  {
    const { context, page } = await openApp(browser, size, {
      seed: eightTrackSong(),
    });
    await warmEngine(page);
    await openMixer(page);

    /* Every gain a gesture wrote, with the graph otherwise standing still. */
    const gainsAfter = async (fn) => {
      await clearAudioWrites(page);
      await fn();
      await page.waitForTimeout(250);
      return gainWrites(page);
    };

    await safe(at("09 Tek sustur"), async () => {
      const written = await gainsAfter(() =>
        page.locator("[data-mixer-mute='t1']").click(),
      );
      record(
        at("09 Tek sustur"),
        (await pressed(page, "[data-mixer-mute='t1']")) === "true" &&
          // Exactly the muted track's channel goes to silence; no other moves.
          written.length === 1 &&
          written[0] === 0 &&
          (await writes(page)) === 0,
        `gain wrote [${written.join(",")}]`,
      );
    });

    await safe(at("10 Çoklu sustur"), async () => {
      await page.locator("[data-mixer-mute='t2']").click();
      await page.waitForTimeout(150);
      record(
        at("10 Çoklu sustur"),
        (await pressed(page, "[data-mixer-mute='t1']")) === "true" &&
          (await pressed(page, "[data-mixer-mute='t2']")) === "true" &&
          (await writes(page)) === 0,
      );
      await page.locator("[data-mixer-mute='t1']").click();
      await page.locator("[data-mixer-mute='t2']").click();
      await page.waitForTimeout(150);
    });

    await safe(at("11 Tek dinle"), async () => {
      const written = await gainsAfter(() =>
        page.locator("[data-mixer-solo='t3']").click(),
      );
      record(
        at("11 Tek dinle"),
        (await pressed(page, "[data-mixer-solo='t3']")) === "true" &&
          // Seven of the eight channels fall silent; the soloed one is untouched.
          written.length === 7 &&
          written.every((value) => value === 0) &&
          (await writes(page)) === 0,
        `gain wrote [${written.join(",")}]`,
      );
    });

    await safe(at("12 Çoklu tek dinle"), async () => {
      await page.locator("[data-mixer-solo='t4']").click();
      await page.waitForTimeout(150);
      record(
        at("12 Çoklu tek dinle"),
        (await pressed(page, "[data-mixer-solo='t3']")) === "true" &&
          (await pressed(page, "[data-mixer-solo='t4']")) === "true",
      );
    });

    await safe(at("13 Sustur, tek dinle'ye üstün gelir"), async () => {
      // t3 is soloed; muting it must silence it even so.
      await page.locator("[data-mixer-mute='t3']").click();
      await page.waitForTimeout(150);
      record(
        at("13 Sustur, tek dinle'ye üstün gelir"),
        (await pressed(page, "[data-mixer-mute='t3']")) === "true" &&
          (await pressed(page, "[data-mixer-solo='t3']")) === "true" &&
          (await writes(page)) === 0,
      );
      // Back to a clean slate for the next scenario.
      await page.locator("[data-mixer-mute='t3']").click();
      await page.locator("[data-mixer-solo='t3']").click();
      await page.locator("[data-mixer-solo='t4']").click();
      await page.waitForTimeout(150);
    });

    await safe(at("14 Bütün track'ler susturulabilir"), async () => {
      for (const id of ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]) {
        await page.locator(`[data-mixer-mute='${id}']`).click();
      }
      await page.waitForTimeout(250);
      const allPressed = await page.evaluate(() =>
        [...document.querySelectorAll("[data-mixer-mute]")].every(
          (node) => node.getAttribute("aria-pressed") === "true",
        ),
      );
      record(
        at("14 Bütün track'ler susturulabilir"),
        allPressed &&
          (await writes(page)) === 0 &&
          (await consoleErrors(page)).length === 0,
      );
    });

    await safe(at("15 Metronom mute/solo'dan etkilenmez"), async () => {
      // Everything is muted; the metronome control is still live and its own
      // state is untouched by the audition.
      await closeMixerByCancel(page);
      const before = await pressed(page, "[aria-label='Metronom']");
      await page.locator("[aria-label='Metronom']").click();
      await page.waitForTimeout(200);
      const after = await pressed(page, "[aria-label='Metronom']");
      record(
        at("15 Metronom mute/solo'dan etkilenmez"),
        before === "false" && after === "true" && (await writes(page)) === 0,
        `metronome ${before} -> ${after}`,
      );
    });

    measurements[`${label}-console-2`] = await consoleErrors(page);
    await context.close();
  }

  /* --------------------------- 16-20: while playing, and what stays constant */
  {
    const { context, page, sampleRequests } = await openApp(browser, size);

    await safe(at("16 Çalarken ses değişimi kesinti yapmaz"), async () => {
      await page.locator("[aria-label='Çal']").click();
      await page.waitForTimeout(1200);
      const before = await debug(page);
      const samplesBefore = sampleRequests.length;
      const contextsBefore = await contexts(page);

      await openMixer(page);
      await setRange(page, "[data-mixer-volume='gtr']", -14);
      await page.waitForTimeout(500);
      const after = await debug(page);

      measurements[`${label}-play-volume`] = { before, after };
      record(
        at("16 Çalarken ses değişimi kesinti yapmaz"),
        before.status === "playing" &&
          after.status === "playing" &&
          after.ticks > before.ticks &&
          (await contexts(page)) === contextsBefore &&
          sampleRequests.length === samplesBefore,
        `status ${before.status}->${after.status}, ticks ${before.ticks}->${after.ticks}`,
      );
    });

    await safe(at("17 Çalarken stereo değişimi kesinti yapmaz"), async () => {
      const before = await debug(page);
      await setRange(page, "[data-mixer-pan='gtr']", 0.6);
      await page.waitForTimeout(400);
      const after = await debug(page);
      const list = await panWrites(page);
      record(
        at("17 Çalarken stereo değişimi kesinti yapmaz"),
        after.status === "playing" &&
          after.ticks > before.ticks &&
          list.at(-1) === 0.6,
        `ticks ${before.ticks}->${after.ticks}, last pan ${list.at(-1)}`,
      );
    });

    await safe(at("18 Mix commit motoru yeniden kurmaz"), async () => {
      const samplesBefore = sampleRequests.length;
      const contextsBefore = await contexts(page);
      const before = await debug(page);
      await page.locator("[data-mixer-apply]").click();
      await page.waitForTimeout(600);
      const after = await debug(page);
      measurements[`${label}-commit-constancy`] = {
        contexts: contextsBefore,
        samplesBefore,
        samplesAfter: sampleRequests.length,
      };
      record(
        at("18 Mix commit motoru yeniden kurmaz"),
        (await contexts(page)) === contextsBefore &&
          after.status === "playing" &&
          after.ticks > before.ticks,
        `contexts=${contextsBefore}, status ${after.status}`,
      );
    });

    await safe(at("19 AudioContext bir kaldı"), async () => {
      record(
        at("19 AudioContext bir kaldı"),
        (await contexts(page)) === 1,
        `contexts=${await contexts(page)}`,
      );
    });

    await safe(at("20 Sample istekleri değişmedi"), async () => {
      const before = sampleRequests.length;
      await openMixer(page);
      await setRange(page, "[data-mixer-volume='bass']", -10);
      await page.locator("[data-mixer-apply]").click();
      await page.waitForTimeout(500);
      record(
        at("20 Sample istekleri değişmedi"),
        sampleRequests.length === before && before > 0,
        `samples ${before} -> ${sampleRequests.length}`,
      );
    });

    measurements[`${label}-console-3`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------------- 21-22: history and the audition */
  {
    const { context, page } = await openApp(browser, size);

    await safe(at("21 Undo ve redo miksi geri getirir"), async () => {
      await openMixer(page);
      await setRange(page, "[data-mixer-volume='gtr']", -16);
      await page.locator("[data-mixer-apply]").click();
      await page.waitForTimeout(400);
      const applied = (await stored(page))?.tracks[0]?.volumeDb;

      await page.locator("[data-undo]").click();
      await page.waitForTimeout(300);
      const undone = (await stored(page))?.tracks[0]?.volumeDb;

      await page.locator("[data-redo]").click();
      await page.waitForTimeout(300);
      const redone = (await stored(page))?.tracks[0]?.volumeDb;

      record(
        at("21 Undo ve redo miksi geri getirir"),
        applied === -16 && undone === -6 && redone === -16,
        `${applied} -> ${undone} -> ${redone}`,
      );
    });

    await safe(at("22 Undo sustur/tek dinle'ye dokunmaz"), async () => {
      await openMixer(page);
      await page.locator("[data-mixer-mute='acc']").click();
      await page.locator("[data-mixer-solo='gtr']").click();
      await page.waitForTimeout(200);
      await closeMixerByCancel(page);

      await page.locator("[data-undo]").click();
      await page.waitForTimeout(300);
      await openMixer(page);
      record(
        at("22 Undo sustur/tek dinle'ye dokunmaz"),
        (await pressed(page, "[data-mixer-mute='acc']")) === "true" &&
          (await pressed(page, "[data-mixer-solo='gtr']")) === "true",
      );
      await closeMixerByCancel(page);
    });

    measurements[`${label}-console-4`] = await consoleErrors(page);
    await context.close();
  }

  /* --------------------------- 23-27: lifecycle and project integration */
  {
    const { context, page } = await openApp(browser, size, {
      seed: numberedSong(),
    });

    const armAudition = async () => {
      await openMixer(page);
      await page.locator("[data-mixer-mute='track-1']").click();
      await page.waitForTimeout(150);
      await closeMixerByCancel(page);
    };

    await safe(at("23 Yeni şarkı dinleme durumunu temizler"), async () => {
      await armAudition();
      await openInfo(page);
      await page.locator("[data-info-new-song]").click();
      await page.waitForSelector("[data-new-song-create]");
      await page.locator("[data-new-song-template='rock_band']").click();
      await page.locator("[data-new-song-create]").click();
      await page.waitForTimeout(500);
      await openMixer(page);
      const anyPressed = await page.evaluate(() =>
        [...document.querySelectorAll("[data-mixer-mute],[data-mixer-solo]")].some(
          (node) => node.getAttribute("aria-pressed") === "true",
        ),
      );
      // The muted id exists in the new song too, so only a real clearing
      // can have unmuted it — pruning would have left it alone.
      const survivor = await pressed(page, "[data-mixer-mute='track-1']");
      record(
        at("23 Yeni şarkı dinleme durumunu temizler"),
        anyPressed === false &&
          survivor === "false" &&
          (await page.locator("[data-mixer-row]").count()) === 3,
        `track-1 pressed=${survivor}`,
      );
      await closeMixerByCancel(page);
    });

    await safe(at("24 Import önizlemesi dinleme durumunu korur"), async () => {
      await openMixer(page);
      await page.locator("[data-mixer-mute='track-2']").click();
      await page.waitForTimeout(150);
      await closeMixerByCancel(page);

      const path = join(tmpdir(), "aranje-2lc-import.aranje.json");
      writeFileSync(path, projectFile(overlappingSong()), "utf8");
      await openInfo(page);
      await page.locator("[data-info-project-open]").click();
      await page.waitForSelector("[data-project-sheet]");
      await page.locator("[data-project-file-input]").setInputFiles(path);
      await page.waitForSelector("[data-project-preview]");

      // Preview only: nothing applied yet, so the audition must still stand.
      await page.locator("[data-project-cancel]").click();
      await page.waitForTimeout(200);
      await page
        .locator("[aria-label='Kapat']")
        .first()
        .click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(200);
      await openMixer(page);
      record(
        at("24 Import önizlemesi dinleme durumunu korur"),
        (await pressed(page, "[data-mixer-mute='track-2']")) === "true",
      );
      await closeMixerByCancel(page);
    });

    await safe(at("25 Import uygulaması dinleme durumunu temizler"), async () => {
      const path = join(tmpdir(), "aranje-2lc-import.aranje.json");
      await openInfo(page);
      await page.locator("[data-info-project-open]").click();
      await page.waitForSelector("[data-project-sheet]");
      await page.locator("[data-project-file-input]").setInputFiles(path);
      await page.waitForSelector("[data-project-preview]");
      await page.locator("[data-project-apply]").click();
      await page.waitForTimeout(500);

      await openMixer(page);
      const anyPressed = await page.evaluate(() =>
        [...document.querySelectorAll("[data-mixer-mute],[data-mixer-solo]")].some(
          (node) => node.getAttribute("aria-pressed") === "true",
        ),
      );
      // `track-2` is in the opened project as well, so a surviving mute
      // could only have been cleared deliberately, not pruned away.
      const survivor = await pressed(page, "[data-mixer-mute='track-2']");
      record(
        at("25 Import uygulaması dinleme durumunu temizler"),
        anyPressed === false &&
          survivor === "false" &&
          (await page.locator("[data-mixer-row]").count()) === 8,
        `track-2 pressed=${survivor}`,
      );
      await closeMixerByCancel(page);
    });

    await safe(at("26 Track silinince o ID'nin durumu gider"), async () => {
      await openMixer(page);
      await page.locator("[data-mixer-mute='t8']").click();
      await page.waitForTimeout(150);
      await closeMixerByCancel(page);

      await showTab(page);
      await page.locator("[data-track-control]").click();
      await page.waitForSelector("[data-track-manage]");
      await page.locator("[data-track-manage]").click();
      await page.waitForSelector("[data-track-add]");
      await page.locator("[data-track-row='t8']").click();
      await page.locator("[data-track-action=delete]").click();
      await page.locator("[data-track-confirm-delete]").click();
      await page.waitForTimeout(400);
      await page.locator("[role=dialog] button", { hasText: "Kapat" }).first().click();
      await page.waitForTimeout(200);

      // Undo brings the track back; it must come back audible.
      await page.locator("[data-undo]").click();
      await page.waitForTimeout(400);
      await openMixer(page);
      record(
        at("26 Track silinince o ID'nin durumu gider"),
        (await page.locator("[data-mixer-row='t8']").count()) === 1 &&
          (await pressed(page, "[data-mixer-mute='t8']")) === "false",
      );
      await closeMixerByCancel(page);
    });

    await safe(at("27 Ad ve sıra değişimi durumu korur"), async () => {
      await openMixer(page);
      await page.locator("[data-mixer-mute='t2']").click();
      await page.waitForTimeout(150);
      await closeMixerByCancel(page);

      await page.locator("[data-track-control]").click();
      await page.locator("[data-track-manage]").click();
      await page.waitForSelector("[data-track-add]");
      await page.locator("[data-track-row='t2']").click();
      await page.locator("[data-track-action=rename]").click();
      await page.locator("[data-track-name]").fill("Yeni Ad");
      await page.locator("[data-track-apply]").click();
      await page.waitForTimeout(300);
      await page.locator("[data-track-row='t2']").click();
      await page.locator("[data-track-action=down]").click();
      await page.waitForTimeout(300);
      await page.locator("[role=dialog] button", { hasText: "Kapat" }).first().click();
      await page.waitForTimeout(200);

      await openMixer(page);
      record(
        at("27 Ad ve sıra değişimi durumu korur"),
        (await pressed(page, "[data-mixer-mute='t2']")) === "true",
      );
      await closeMixerByCancel(page);
    });

    measurements[`${label}-console-5`] = await consoleErrors(page);
    await context.close();
  }

  /* --------------------------------- 28-30: closed storage, export, Copilot */
  {
    const { context, page } = await openApp(browser, size, {
      refuseWriteCheck: true,
    });

    await safe(at("28 canPersist kapalı: Uygula kapalı, dinleme açık"), async () => {
      // Storage is closed; the song still plays, so the graph still exists.
      await warmEngine(page);
      await openMixer(page);
      const applyDisabled = await page.locator("[data-mixer-apply]").isDisabled();
      const sliderDisabled = await page.locator("[data-mixer-volume='gtr']").isDisabled();
      const note = await page.locator("[data-mixer-session-note]").count();
      await clearAudioWrites(page);
      await page.locator("[data-mixer-mute='gtr']").click();
      await page.waitForTimeout(250);
      const written = await gainWrites(page);
      record(
        at("28 canPersist kapalı: Uygula kapalı, dinleme açık"),
        applyDisabled &&
          sliderDisabled &&
          note === 1 &&
          (await pressed(page, "[data-mixer-mute='gtr']")) === "true" &&
          // The session audition still reaches the graph with storage closed.
          written.length === 1 &&
          written[0] === 0 &&
          (await writes(page)) === 0,
        `apply=${applyDisabled} note=${note} gain [${written.join(",")}]`,
      );
      await closeMixerByCancel(page);
    });

    await context.close();
  }

  {
    const { context, page, external } = await openApp(browser, size);

    await safe(at("29 Proje dosyası yalnız commit edilmiş miksi taşır"), async () => {
      await openMixer(page);
      await setRange(page, "[data-mixer-volume='gtr']", -9);
      await setRange(page, "[data-mixer-pan='gtr']", 0.25);
      await page.locator("[data-mixer-apply]").click();
      await page.waitForTimeout(400);
      // Something audible only in the session, which must not travel.
      await openMixer(page);
      await page.locator("[data-mixer-mute='bass']").click();
      await page.waitForTimeout(150);
      await closeMixerByCancel(page);

      await openInfo(page);
      const waiting = page.waitForEvent("download");
      await page.locator("[data-info-project-backup]").click();
      const download = await waiting;
      const text = await page
        .evaluate(() => null)
        .then(() => import("node:fs"))
        .then(async (fs) => fs.readFileSync(await download.path(), "utf8"));
      const parsed = JSON.parse(text);
      const gtr = parsed.song.tracks.find((entry) => entry.id === "gtr");
      record(
        at("29 Proje dosyası yalnız commit edilmiş miksi taşır"),
        gtr.volumeDb === -9 &&
          gtr.pan === 0.25 &&
          !text.includes("muted") &&
          !text.includes("soloed"),
        `volumeDb=${gtr.volumeDb} pan=${gtr.pan}`,
      );
      await page
        .locator("[aria-label='Kapat']")
        .first()
        .click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(200);
    });

    await safe(at("30 Copilot mikser durumunu bozamaz, provider 0"), async () => {
      await openMixer(page);
      await page.locator("[data-mixer-solo='drums']").click();
      await page.waitForTimeout(150);
      await closeMixerByCancel(page);

      await showTab(page);
      await page.locator("button", { hasText: "Aranje et" }).click();
      await page.waitForTimeout(500);
      await page
        .locator("[role=dialog] button", { hasText: "Vazgeç" })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);

      await openMixer(page);
      record(
        at("30 Copilot mikser durumunu bozamaz, provider 0"),
        (await pressed(page, "[data-mixer-solo='drums']")) === "true" &&
          (await providerCalls(page)) === 0,
        `provider=${await providerCalls(page)}`,
      );
      await closeMixerByCancel(page);
    });

    measurements[`${label}-external`] = external.slice();
    measurements[`${label}-console-6`] = await consoleErrors(page);
    await context.close();
  }

  /* ---------------------------------- 31-35: odd meters, layout, quiet, network */
  {
    const { context, page, external } = await openApp(browser, size);

    const addSection = async (meter, name) => {
      await showTab(page);
      await page.locator("[aria-label*='Tüm bölümler']").click();
      await page.waitForSelector("[data-section-manage]");
      await page.locator("[data-section-manage]").click();
      await page.waitForSelector("[data-section-add]");
      await page.locator("[data-section-add]").click();
      await page.locator("[data-section-name]").fill(name);
      await page.locator("[data-section-meter]").selectOption({ label: meter });
      await page.locator("[data-section-bars]").fill("2");
      const before = await writes(page);
      await page.locator("[data-section-apply]").click();
      await page.waitForTimeout(400);
      const delta = (await writes(page)) - before;
      await page.locator("[role=dialog] button", { hasText: "Kapat" }).first().click();
      await page.waitForTimeout(200);
      return delta;
    };

    await safe(at("31 3/4 bölüm oluşturulur"), async () => {
      const delta = await addSection("3/4", "Vals");
      const song = await stored(page);
      const created = song?.sections.find((entry) => entry.name === "Vals");
      record(
        at("31 3/4 bölüm oluşturulur"),
        delta === 1 &&
          JSON.stringify(created?.bars[0]?.timeSignature) === "[3,4]" &&
          created?.bars.length === 2,
        `meter=${JSON.stringify(created?.bars[0]?.timeSignature)}`,
      );
    });

    await safe(at("32 7/8 bölüm oluşturulur"), async () => {
      const delta = await addSection("7/8", "Yedi Sekiz");
      const song = await stored(page);
      const created = song?.sections.find((entry) => entry.name === "Yedi Sekiz");
      const grids = await page.evaluate(() => null);
      void grids;
      record(
        at("32 7/8 bölüm oluşturulur"),
        delta === 1 &&
          JSON.stringify(created?.bars[0]?.timeSignature) === "[7,8]" &&
          created?.bars.length === 2,
        `meter=${JSON.stringify(created?.bars[0]?.timeSignature)}`,
      );
    });

    await safe(at("33 Yerleşim ve 44px hedefleri"), async () => {
      await openMixer(page);
      const layout = await layoutProbe(page);
      const edges = await targetEdges(page, [
        "[data-mixer-mute='gtr']",
        "[data-mixer-solo='gtr']",
        "[data-mixer-volume-down='gtr']",
        "[data-mixer-volume-up='gtr']",
        "[data-mixer-pan-center='gtr']",
        "[data-mixer-apply]",
        "[data-mixer-cancel]",
        "[data-open-mixer]",
      ]);
      const sheetBox = await page
        .locator("[role=dialog] section")
        .first()
        .boundingBox();
      measurements[`${label}-layout`] = { layout, edges };
      record(
        at("33 Yerleşim ve 44px hedefleri"),
        layout.bodyOverflow === 0 &&
          layout.scrollers === 1 &&
          edges.every((edge) => edge >= 44) &&
          sheetBox !== null &&
          sheetBox.y >= 0 &&
          sheetBox.y + sheetBox.height <= size.height + 1,
        `overflow=${layout.bodyOverflow} scrollers=${layout.scrollers} edges=${edges.join(",")}`,
      );
      await closeMixerByCancel(page);
    });

    await safe(at("34 Konsol sessiz kaldı"), async () => {
      const all = Object.entries(measurements)
        .filter(([key]) => key.startsWith(`${label}-console`))
        .flatMap(([, value]) => value);
      const here = await consoleErrors(page);
      record(
        at("34 Konsol sessiz kaldı"),
        all.length === 0 && here.length === 0,
        all.concat(here).slice(0, 2).join(" | "),
      );
    });

    await safe(at("35 Dış ağ isteği yok"), async () => {
      const previous = measurements[`${label}-external`] ?? [];
      record(
        at("35 Dış ağ isteği yok"),
        external.length === 0 && previous.length === 0,
        `${external.concat(previous).slice(0, 2).join(" | ")}`,
      );
    });

    await context.close();
  }
}

/* -------------------------------------------------------------------- main */

const browser = await chromium.launch();
await run(browser, { width: 390, height: 844 }, "@390x844");
if (!process.env.ONE_VIEWPORT) {
  await run(browser, { width: 320, height: 700 }, "@320x700");
}
await browser.close();

const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
flush();
process.exit(failed.length === 0 ? 0 : 1);
