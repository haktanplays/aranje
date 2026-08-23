/**
 * Faz 2M-A browser verification: WAV, MIDI and the project file, end to end.
 *
 * Thirty-six scenarios in two viewports, against the real production build.
 *
 * The rule this suite exists to obey: a download event is not a result. Every
 * file claim reads the **bytes that actually arrived** — the RIFF and fmt
 * fields out of the WAV header, the MThd/MTrk structure and decoded events
 * out of the MIDI, the UTF-8 text out of the attribution file. A suite that
 * only checked that a download fired would pass for a zero-byte file.
 *
 *   rm -rf .next && NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true npm run build
 *   npx next start -p 3100
 *   node eval/export/verify.mjs              # both viewports
 *   ONE_VIEWPORT=1 node eval/export/verify.mjs
 */
import { chromium } from "playwright";
import { layoutProbe, targetEdges, unwrapStoredSong } from "../shared/harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.EXPORT_OUT ?? "eval/export/artifacts";
mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- fixtures */

const GUITAR = ["E2", "A2", "D3", "G3", "B3", "E4"];

const track = (id, name, extra = {}) => ({
  id,
  name,
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: GUITAR, capo: 0 },
  ...extra,
});

const hit = (pitch, fret = 0) => ({
  notes: [{ pitch, position: { string: 0, fret } }],
});

const rest = (count) => Array.from({ length: count }, () => null);

/**
 * A song with everything the MIDI assertions need: two melodic tracks with
 * different levels and pans, a drum track, two metres and a tempo change.
 */
const richSong = () => ({
  version: 2,
  title: "Dışa Aktarma Testi",
  bpm: 120,
  key: "E minor",
  tracks: [
    track("gtr", "Ritim Gitar", { volumeDb: -6, pan: -0.5 }),
    track("lead", "Solo Gitar", { volumeDb: -12, pan: 0.5 }),
    { id: "drums", name: "Davul", instrumentId: "drum_kit", presetId: "rock", volumeDb: -4 },
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
            gtr: [hit("E2"), null, hit("E2"), ...rest(5)],
            /* A drum slot is an array of hits; an empty array is a rest. */
            drums: [
              [{ piece: "kick" }],
              [],
              [{ piece: "snare" }],
              [{ piece: "closed_hat" }],
              [],
              [],
              [],
              [],
            ],
          },
        },
      ],
    },
    {
      id: "s2",
      name: "Yedi Sekiz",
      status: "fixed",
      bpmOverride: 90,
      bars: [
        {
          timeSignature: [7, 8],
          resolution: 8,
          slots: { lead: [hit("B2", 7), ...rest(6)] },
        },
      ],
    },
    {
      id: "s3",
      name: "Uc Dort",
      status: "fixed",
      bars: [
        {
          timeSignature: [3, 4],
          resolution: 8,
          slots: { gtr: [hit("E2"), ...rest(5)] },
        },
      ],
    },
  ],
});

/** A title full of things a filesystem refuses, to prove the cleaning. */
const awkwardTitleSong = () => ({
  ...richSong(),
  title: 'Gece/Yürüyüşü: "büyük" *ç*  ',
});

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
 * Storage writes, AudioContext constructions and Object-URL lifecycle are all
 * counted on the real APIs: "the export wrote nothing" and "the URL was
 * revoked" are claims about what the browser was actually asked to do.
 */
const INSTRUMENT = `
  window.__writes = 0;
  window.__consoleErrors = [];
  window.__audioContexts = 0;
  window.__offlineContexts = 0;
  window.__urlsCreated = [];
  window.__urlsRevoked = [];

  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSet.call(this, key, value);
    if (key === "aranje.song") window.__writes += 1;
  };

  /*
   * Only the blobs the export mints are counted. The framework makes its own
   * Object URLs for lazily loaded chunks, and counting those would turn a
   * correct lifecycle into a phantom leak.
   */
  const EXPORT_TYPES = ["audio/wav", "audio/midi", "application/json", "text/plain"];
  const createUrl = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = createUrl(blob);
    const type = String(blob?.type ?? "");
    if (EXPORT_TYPES.some((known) => type.startsWith(known))) {
      window.__urlsCreated.push(url);
    }
    return url;
  };
  const revokeUrl = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    if (window.__urlsCreated.includes(url)) window.__urlsRevoked.push(url);
    return revokeUrl(url);
  };

  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args) {
        window.__audioContexts += 1;
        return Reflect.construct(target, args);
      },
    });
  }
  for (const name of ["OfflineAudioContext", "webkitOfflineAudioContext"]) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args) {
        window.__offlineContexts += 1;
        return Reflect.construct(target, args);
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

/** Makes the WAV render throw, to exercise the error path honestly. */
const BREAK_RENDER = `
  for (const name of ["OfflineAudioContext", "webkitOfflineAudioContext"]) {
    if (!window[name]) continue;
    window[name] = new Proxy(window[name], {
      construct() {
        throw new Error("offline render unavailable");
      },
    });
  }
`;

async function openApp(browser, size, options = {}) {
  const context = await browser.newContext({
    viewport: size,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    acceptDownloads: true,
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
  if (options.breakRender) await context.addInitScript(BREAK_RENDER);

  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(20000);
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
const offlineContexts = (page) => page.evaluate(() => window.__offlineContexts);
const consoleErrors = (page) => page.evaluate(() => window.__consoleErrors);
const urls = (page) =>
  page.evaluate(() => ({
    created: window.__urlsCreated.slice(),
    revoked: window.__urlsRevoked.slice(),
  }));
const stored = async (page) =>
  unwrapStoredSong(await page.evaluate(() => localStorage.getItem("aranje.song")));
const debug = (page) =>
  page.evaluate(() => ({
    status: window.__aranjeDebug?.status() ?? null,
    ticks: window.__aranjeDebug?.ticks() ?? null,
  }));

/* --------------------------------------------------------- byte inspection */

/** The WAV header, read out of the bytes that were downloaded. */
function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, length) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  const dataBytes = view.getUint32(40, true);
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    data: ascii(36, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitDepth: view.getUint16(34, true),
    dataBytes,
    fileBytes: bytes.length,
    headerMatchesFile: dataBytes + 44 === bytes.length,
    riffSizeCorrect: view.getUint32(4, true) === bytes.length - 8,
    seconds: dataBytes / (view.getUint32(24, true) * view.getUint16(32, true)),
    /** Loudest sample in the file, so "there is audio here" is a number. */
    peak: (() => {
      let peak = 0;
      for (let at = 44; at + 1 < bytes.length; at += 2) {
        peak = Math.max(peak, Math.abs(view.getInt16(at, true)));
      }
      return peak / 32768;
    })(),
  };
}

/** MThd/MTrk structure plus the events, decoded from the downloaded bytes. */
function readMidi(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, length) =>
    String.fromCharCode(...bytes.subarray(at, at + length));

  const header = ascii(0, 4);
  const format = view.getUint16(8, false);
  const trackCount = view.getUint16(10, false);
  const ppq = view.getUint16(12, false);

  const tracks = [];
  let cursor = 14;
  let sawPitchBend = false;
  for (let index = 0; index < trackCount && cursor < bytes.length; index += 1) {
    if (ascii(cursor, 4) !== "MTrk") break;
    const length = view.getUint32(cursor + 4, false);
    let at = cursor + 8;
    const end = at + length;
    let tick = 0;
    const events = [];
    while (at < end) {
      let delta = 0;
      for (;;) {
        const byte = bytes[at];
        at += 1;
        delta = (delta << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) break;
      }
      tick += delta;
      const status = bytes[at];
      at += 1;
      if (status === 0xff) {
        const meta = bytes[at];
        at += 1;
        let metaLength = 0;
        for (;;) {
          const byte = bytes[at];
          at += 1;
          metaLength = (metaLength << 7) | (byte & 0x7f);
          if ((byte & 0x80) === 0) break;
        }
        const payload = bytes.subarray(at, at + metaLength);
        at += metaLength;
        if (meta === 0x51) {
          events.push({
            tick,
            type: "tempo",
            bpm: Math.round(
              60000000 / ((payload[0] << 16) | (payload[1] << 8) | payload[2]),
            ),
          });
        } else if (meta === 0x58) {
          events.push({ tick, type: "meter", n: payload[0], d: 2 ** payload[1] });
        } else if (meta === 0x03) {
          events.push({ tick, type: "name", text: String.fromCharCode(...payload) });
        } else if (meta === 0x2f) {
          events.push({ tick, type: "end" });
        }
        continue;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (kind === 0xe0) sawPitchBend = true;
      if (kind === 0xc0) {
        events.push({ tick, type: "program", channel, a: bytes[at] });
        at += 1;
      } else {
        const a = bytes[at];
        const b = bytes[at + 1];
        at += 2;
        const type =
          kind === 0x90 ? "on" : kind === 0x80 ? "off" : kind === 0xb0 ? "cc" : "other";
        events.push({ tick, type, channel, a, b });
      }
    }
    tracks.push(events);
    cursor = end;
  }
  return { header, format, trackCount, ppq, tracks, sawPitchBend, bytes: bytes.length };
}

/**
 * Click a download control and hand back the bytes that arrived.
 *
 * The name is read from the control the app rendered, not from Playwright's
 * `suggestedFilename`: headless Chromium rewrites the suggested name to
 * "download" whenever a blob download carries non-ASCII characters, which is
 * a browser-mode quirk rather than anything the app did. The `download`
 * attribute is what a real browser saves the file as, so that is what the
 * naming scenarios assert — and the bytes still come from the real download.
 */
async function downloadBytes(page, selector) {
  const offered = await page.locator(selector).getAttribute("download");
  const pending = page.waitForEvent("download", { timeout: 60000 });
  await page.locator(selector).click();
  const download = await pending;
  const path = await download.path();
  return {
    name: offered ?? download.suggestedFilename(),
    suggested: download.suggestedFilename(),
    bytes: new Uint8Array(readFileSync(path)),
  };
}

/* --------------------------------------------------------------- gestures */

const openExport = async (page) => {
  await page.locator("[aria-label='Ses kaynakları ve lisans']").click();
  await page.waitForSelector("[data-info-export]");
  await page.locator("[data-info-export]").click();
  await page.waitForSelector("[data-export-sheet]");
};

/** Start one export and wait for the file whose name ends the right way. */
const produce = async (page, selector, extension) => {
  await page.locator(selector).click();
  await page
    .locator("[data-export-file-name]")
    .filter({ hasText: extension })
    .waitFor({ timeout: 180000 });
};

const chooseScope = async (page, scope) => {
  await page.locator(`[data-export-scope='${scope}'] input`).check();
  await page.waitForTimeout(120);
};

const openMixer = async (page) => {
  await page.locator("[data-open-mixer]").click();
  await page.waitForSelector("[data-mixer-sheet]");
};

const closeMixer = async (page) => {
  await page.locator("[data-mixer-cancel]").click();
  await page.waitForTimeout(200);
};

/* ------------------------------------------------------------------- runs */

async function run(browser, size, label) {
  const at = (name) => `${label} ${name}`;

  /* ------------------------------- 1-9: the surface, the WAV and its bytes */
  {
    const { context, page, sampleRequests } = await openApp(browser, size, {
      seed: richSong(),
    });

    await safe(at("01 Export yüzeyi açılır"), async () => {
      await openExport(page);
      const text = await page.locator("[data-export-sheet]").innerText();
      record(
        at("01 Export yüzeyi açılır"),
        (await page.locator("[data-export-project]").count()) === 1 &&
          (await page.locator("[data-export-wav]").count()) === 1 &&
          (await page.locator("[data-export-midi]").count()) === 1 &&
          text.includes("düzenlemek için") &&
          text.includes("Dinlemek ve paylaşmak"),
        `three formats, one surface`,
      );
    });

    await safe(at("02 Proje export'u 2L-A yolunda kalır"), async () => {
      const before = await writes(page);
      const file = await (async () => {
        await produce(page, "[data-export-project]", ".json");
        return downloadBytes(page, "[data-export-download]");
      })();
      const text = new TextDecoder().decode(file.bytes);
      const parsed = JSON.parse(text);
      const song = await stored(page);
      record(
        at("02 Proje export'u 2L-A yolunda kalır"),
        parsed.format === "aranje.project" &&
          parsed.version === 1 &&
          parsed.song.title === richSong().title &&
          text.endsWith("\n") &&
          file.name.endsWith(".aranje.json") &&
          (await writes(page)) === before &&
          song?.title === richSong().title,
        `${file.name}, ${file.bytes.length} B, writes +${(await writes(page)) - before}`,
      );
    });

    await safe(at("03 Tam miks WAV üretilir"), async () => {
      await page.locator("[data-export-new]").click();
      await chooseScope(page, "all");
      await produce(page, "[data-export-wav]", ".wav");
      const file = await downloadBytes(page, "[data-export-download]");
      const wav = readWav(file.bytes);
      measurements[`${label}-wav-all`] = wav;
      record(
        at("03 Tam miks WAV üretilir"),
        wav.riff === "RIFF" && wav.wave === "WAVE" && wav.peak > 0.001,
        `${file.name} ${wav.fileBytes} B peak ${wav.peak.toFixed(4)}`,
      );
    });

    await safe(at("07 WAV stereo, 44.1 kHz, 16-bit ve tutarlı"), async () => {
      const wav = measurements[`${label}-wav-all`];
      record(
        at("07 WAV stereo, 44.1 kHz, 16-bit ve tutarlı"),
        wav.audioFormat === 1 &&
          wav.channels === 2 &&
          wav.sampleRate === 44100 &&
          wav.bitDepth === 16 &&
          wav.blockAlign === 4 &&
          wav.byteRate === 44100 * 4 &&
          wav.headerMatchesFile &&
          wav.riffSizeCorrect,
        `${wav.channels}ch ${wav.sampleRate}Hz ${wav.bitDepth}bit, ` +
          `data ${wav.dataBytes}+44=${wav.fileBytes}`,
      );
    });

    await safe(at("08 WAV gerçekten indirilir ve boş değildir"), async () => {
      const wav = measurements[`${label}-wav-all`];
      record(
        at("08 WAV gerçekten indirilir ve boş değildir"),
        wav.fileBytes > 44 && wav.dataBytes > 0 && wav.seconds > 1,
        `${wav.fileBytes} B, ${wav.seconds.toFixed(2)} s`,
      );
    });

    await safe(at("18 Export çalmayı duraklatır"), async () => {
      await page.locator("[aria-label='Kapat']").first().click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(200);
      await page.locator("[aria-label='Çal']").click();
      await page.waitForTimeout(1200);
      const before = await debug(page);

      await openExport(page);
      await page.locator("[data-export-new]").click();
      await produce(page, "[data-export-wav]", ".wav");
      const after = await debug(page);

      record(
        at("18 Export çalmayı duraklatır"),
        before.status === "playing" && after.status !== "playing",
        `status ${before.status} -> ${after.status}`,
      );
      measurements[`${label}-pause`] = { before, after };
    });

    await safe(at("19 Playhead başa sarmaz"), async () => {
      const after = await debug(page);
      const before = measurements[`${label}-pause`].before;
      record(
        at("19 Playhead başa sarmaz"),
        after.ticks > 0 && Math.abs(after.ticks - before.ticks) < before.ticks,
        `ticks ${before.ticks} -> ${after.ticks}`,
      );
    });

    await safe(at("20 Online AudioContext sayısı değişmez"), async () => {
      const online = await contexts(page);
      const offline = await offlineContexts(page);
      record(
        at("20 Online AudioContext sayısı değişmez"),
        online === 1 && offline >= 1,
        `online ${online}, offline ${offline}`,
      );
    });

    await safe(at("21 Sample istekleri beklenen sayıda"), async () => {
      const before = sampleRequests.length;
      await page.locator("[data-export-new]").click();
      await produce(page, "[data-export-midi]", ".mid");
      record(
        at("21 Sample istekleri beklenen sayıda"),
        before > 0 && sampleRequests.length === before,
        `samples ${before} -> ${sampleRequests.length} (MIDI ses istemez)`,
      );
      measurements[`${label}-samples`] = sampleRequests.length;
    });

    await safe(at("26 Depo, history ve fingerprint değişmez"), async () => {
      /*
       * The song is the one that was seeded, byte for byte: this context has
       * exported a project file, two WAVs and a MIDI, and none of them may
       * have touched the stored song, the write count or the history.
       */
      const song = await stored(page);
      const seeded = richSong();
      record(
        at("26 Depo, history ve fingerprint değişmez"),
        (await writes(page)) === 0 &&
          (await page.locator("[data-undo]").isDisabled()) &&
          song !== null &&
          song.title === seeded.title &&
          song.tracks.length === seeded.tracks.length &&
          song.tracks[0]?.volumeDb === seeded.tracks[0].volumeDb &&
          song.tracks[0]?.pan === seeded.tracks[0].pan,
        `writes ${await writes(page)}, undo disabled, şarkı seed ile aynı`,
      );
    });

    measurements[`${label}-console-1`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------- 4-6: the two WAV content choices */
  {
    const { context, page } = await openApp(browser, size, { seed: richSong() });

    await safe(at("05 Mute edilen track yalnız ikinci seçenekte düşer"), async () => {
      await openMixer(page);
      await page.locator("[data-mixer-mute='gtr']").click();
      await page.waitForTimeout(150);
      await closeMixer(page);

      await openExport(page);
      await chooseScope(page, "all");
      await produce(page, "[data-export-wav]", ".wav");
      const full = readWav((await downloadBytes(page, "[data-export-download]")).bytes);

      await page.locator("[data-export-new]").click();
      await chooseScope(page, "audible");
      await produce(page, "[data-export-wav]", ".wav");
      const audible = readWav(
        (await downloadBytes(page, "[data-export-download]")).bytes,
      );

      measurements[`${label}-scope-mute`] = { full: full.peak, audible: audible.peak };
      record(
        at("05 Mute edilen track yalnız ikinci seçenekte düşer"),
        full.peak > audible.peak && audible.peak >= 0 && full.peak > 0.001,
        `full peak ${full.peak.toFixed(4)}, audible peak ${audible.peak.toFixed(4)}`,
      );
    });

    await safe(at("04 “Şu anda duyduklarım” WAV'ı üretilir"), async () => {
      const scope = measurements[`${label}-scope-mute`];
      record(
        at("04 “Şu anda duyduklarım” WAV'ı üretilir"),
        scope !== undefined && scope.audible !== scope.full,
        `two distinct files, peaks ${scope?.full.toFixed(4)} vs ${scope?.audible.toFixed(4)}`,
      );
    });

    await safe(at("06 Solo edilen track yalnız ikinci seçenekte belirleyici"), async () => {
      await page.locator("[aria-label='Kapat']").first().click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(200);
      await openMixer(page);
      await page.locator("[data-mixer-mute='gtr']").click(); // unmute
      await page.locator("[data-mixer-solo='lead']").click();
      await page.waitForTimeout(150);
      await closeMixer(page);

      await openExport(page);
      await chooseScope(page, "all");
      await produce(page, "[data-export-wav]", ".wav");
      const full = readWav((await downloadBytes(page, "[data-export-download]")).bytes);

      await page.locator("[data-export-new]").click();
      await chooseScope(page, "audible");
      await produce(page, "[data-export-wav]", ".wav");
      const soloed = readWav(
        (await downloadBytes(page, "[data-export-download]")).bytes,
      );

      record(
        at("06 Solo edilen track yalnız ikinci seçenekte belirleyici"),
        full.peak !== soloed.peak && full.peak > 0.001,
        `full ${full.peak.toFixed(4)}, solo only ${soloed.peak.toFixed(4)}`,
      );
    });

    measurements[`${label}-console-2`] = await consoleErrors(page);
    await context.close();
  }

  /* --------------------------------- 10-17: the MIDI file and its contents */
  {
    const { context, page } = await openApp(browser, size, { seed: richSong() });

    await safe(at("10 MIDI üretilir"), async () => {
      await openExport(page);
      await produce(page, "[data-export-midi]", ".mid");
      const file = await downloadBytes(page, "[data-export-download]");
      const midi = readMidi(file.bytes);
      measurements[`${label}-midi`] = {
        format: midi.format,
        trackCount: midi.trackCount,
        ppq: midi.ppq,
        bytes: midi.bytes,
        sawPitchBend: midi.sawPitchBend,
      };
      measurements[`${label}-midi-name`] = file.name;
      measurements[`${label}-midi-tracks`] = midi.tracks;
      record(
        at("10 MIDI üretilir"),
        midi.header === "MThd" && midi.format === 1 && midi.trackCount === 4,
        `${file.name} format ${midi.format}, ${midi.trackCount} track, ${midi.bytes} B`,
      );
    });

    await safe(at("11 MIDI gerçekten indirilir ve yapısı bütündür"), async () => {
      const midi = measurements[`${label}-midi`];
      const tracks = measurements[`${label}-midi-tracks`];
      record(
        at("11 MIDI gerçekten indirilir ve yapısı bütündür"),
        midi.bytes > 40 &&
          tracks.length === midi.trackCount &&
          tracks.every((events) => events.at(-1)?.type === "end"),
        `${midi.bytes} B, ${tracks.length} MTrk, hepsi end-of-track ile bitiyor`,
      );
    });

    await safe(at("13 Tempo değişimleri MIDI'de"), async () => {
      const conductor = measurements[`${label}-midi-tracks`][0];
      const tempos = conductor.filter((event) => event.type === "tempo");
      record(
        at("13 Tempo değişimleri MIDI'de"),
        tempos.length >= 2 &&
          tempos.some((event) => event.bpm === 120) &&
          tempos.some((event) => event.bpm === 90),
        `tempos ${tempos.map((event) => `${event.bpm}@${event.tick}`).join(", ")}`,
      );
    });

    await safe(at("14 3/4 ve 7/8 ölçüleri MIDI'de"), async () => {
      const conductor = measurements[`${label}-midi-tracks`][0];
      const meters = conductor
        .filter((event) => event.type === "meter")
        .map((event) => `${event.n}/${event.d}`);
      record(
        at("14 3/4 ve 7/8 ölçüleri MIDI'de"),
        meters.includes("4/4") && meters.includes("7/8") && meters.includes("3/4"),
        `meters ${meters.join(", ")}`,
      );
    });

    await safe(at("15 Davul track'i MIDI'de ve doğru kanalda"), async () => {
      const tracks = measurements[`${label}-midi-tracks`];
      const drums = tracks.find((events) =>
        events.some((event) => event.type === "name" && event.text === "Davul"),
      );
      const notes = drums?.filter((event) => event.type === "on") ?? [];
      record(
        at("15 Davul track'i MIDI'de ve doğru kanalda"),
        notes.length >= 2 &&
          notes.every((event) => event.channel === 9) &&
          new Set(notes.map((event) => event.a)).size >= 2 &&
          (drums?.filter((event) => event.type === "program").length ?? 0) === 0,
        `${notes.length} hits on channel ${notes[0]?.channel}, ` +
          `pieces ${[...new Set(notes.map((event) => event.a))].join("/")}`,
      );
    });

    await safe(at("16 Kalıcı volume/pan MIDI controller'larında"), async () => {
      const tracks = measurements[`${label}-midi-tracks`];
      const named = (name) =>
        tracks.find((events) =>
          events.some((event) => event.type === "name" && event.text === name),
        );
      const cc = (events, controller) =>
        events?.find((event) => event.type === "cc" && event.a === controller)?.b;

      const rhythm = named("Ritim Gitar");
      const lead = named("Solo Gitar");
      // -6 dB and -12 dB differ; pan -0.5 is left of centre, +0.5 right.
      record(
        at("16 Kalıcı volume/pan MIDI controller'larında"),
        cc(rhythm, 7) > cc(lead, 7) &&
          cc(rhythm, 10) < 64 &&
          cc(lead, 10) > 64 &&
          cc(rhythm, 7) > 0,
        `rhythm cc7=${cc(rhythm, 7)} cc10=${cc(rhythm, 10)}, ` +
          `lead cc7=${cc(lead, 7)} cc10=${cc(lead, 10)}`,
      );
    });

    await safe(at("17 Articulation uyarısı görünür ve bend yazılmaz"), async () => {
      const text = await page.locator("[data-export-midi-note]").innerText();
      record(
        at("17 Articulation uyarısı görünür ve bend yazılmaz"),
        text.includes("Bend") &&
          text.includes("aynı duyulmayabilir") &&
          measurements[`${label}-midi`].sawPitchBend === false,
        `uyarı var, pitch bend event ${measurements[`${label}-midi`].sawPitchBend}`,
      );
    });

    await safe(at("22 İkinci export bloklanır"), async () => {
      await page.locator("[data-export-new]").click();
      // Fire two WAV requests back to back; the second must be refused.
      await page.locator("[data-export-wav]").click();
      await page.waitForTimeout(60);
      const disabled = await page.locator("[data-export-wav]").isDisabled();
      await page
        .locator("[data-export-file-name]")
        .filter({ hasText: ".wav" })
        .waitFor({ timeout: 180000 });
      const ready = await page.locator("[data-export-ready]").count();
      record(
        at("22 İkinci export bloklanır"),
        disabled && ready === 1,
        `çalışırken buton kapalı=${disabled}, tek sonuç kartı=${ready === 1}`,
      );
    });

    await safe(at("25 ObjectURL revoke edilir"), async () => {
      const { created, revoked } = await urls(page);
      measurements[`${label}-urls`] = { created: created.length, revoked: revoked.length };
      /*
       * Every export URL but the one currently on offer has been revoked, and
       * the survivor is that one — not some earlier file still holding memory
       * and still clickable.
       */
      const outstanding = created.filter((url) => !revoked.includes(url));
      const offered = await page.locator("[data-export-download]").getAttribute("href");
      record(
        at("25 ObjectURL revoke edilir"),
        created.length >= 2 &&
          revoked.length === created.length - 1 &&
          outstanding.length === 1 &&
          outstanding[0] === offered,
        `created ${created.length}, revoked ${revoked.length}, ` +
          `açıkta kalan tek URL sunulan dosya = ${outstanding[0] === offered}`,
      );
    });

    measurements[`${label}-console-3`] = await consoleErrors(page);
    await context.close();
  }

  /* ---------------------------- 9, 12, 34: names, and a title full of traps */
  {
    const { context, page } = await openApp(browser, size, {
      seed: awkwardTitleSong(),
    });

    await safe(at("09 WAV dosya adı güvenli"), async () => {
      await openExport(page);
      await produce(page, "[data-export-wav]", ".wav");
      const file = await downloadBytes(page, "[data-export-download]");
      record(
        at("09 WAV dosya adı güvenli"),
        file.name.endsWith(".wav") &&
          !/[/\\?%*:|"<>]/.test(file.name) &&
          file.name.includes("Yürüyüşü"),
        `teklif edilen ad "${file.name}" (tarayıcı önerisi: "${file.suggested}")`,
      );
      measurements[`${label}-wav-name`] = file.name;
    });

    await safe(at("12 MIDI dosya adı güvenli ve aynı kökten"), async () => {
      await page.locator("[data-export-new]").click();
      await produce(page, "[data-export-midi]", ".mid");
      const file = await downloadBytes(page, "[data-export-download]");
      const wavStem = measurements[`${label}-wav-name`].replace(/\.wav$/, "");
      record(
        at("12 MIDI dosya adı güvenli ve aynı kökten"),
        file.name.endsWith(".mid") &&
          !/[/\\?%*:|"<>]/.test(file.name) &&
          file.name.replace(/\.mid$/, "") === wavStem,
        `"${file.name}" ve "${measurements[`${label}-wav-name`]}"`,
      );
    });

    await safe(at("34 Uzun dosya adı yerleşimi taşırmaz"), async () => {
      const layout = await layoutProbe(page);
      const box = await page.locator("[data-export-file-name]").boundingBox();
      record(
        at("34 Uzun dosya adı yerleşimi taşırmaz"),
        layout.bodyOverflow === 0 && box !== null && box.width <= size.width,
        `overflow ${layout.bodyOverflow}, ad genişliği ${Math.round(box?.width ?? -1)}px`,
      );
    });

    measurements[`${label}-console-4`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------- 23-24: the error path and retrying */
  {
    const { context, page } = await openApp(browser, size, {
      seed: richSong(),
      breakRender: true,
    });

    await safe(at("23 Hata güvenli mesaj verir"), async () => {
      await openExport(page);
      // A MIDI first, so there is a previous file that must not be re-offered.
      await produce(page, "[data-export-midi]", ".mid");
      const before = await page.locator("[data-export-file-name]").textContent();

      await page.locator("[data-export-wav]").click();
      await page.waitForSelector("[data-export-error]", { timeout: 60000 });
      const message = await page.locator("[data-export-error]").textContent();
      const stillOffering = await page.locator("[data-export-ready]").count();

      record(
        at("23 Hata güvenli mesaj verir"),
        message?.includes("Dışa aktarma tamamlanamadı") &&
          !/Error|Exception|undefined|\{/.test(message ?? "") &&
          stillOffering === 0 &&
          before?.endsWith(".mid") === true &&
          (await writes(page)) === 0,
        `"${message?.trim()}", bayat dosya kartı ${stillOffering}`,
      );
    });

    await safe(at("24 Hatadan sonra yeniden denenebilir"), async () => {
      // The still-working format proves the machine is not stuck in error.
      await produce(page, "[data-export-midi]", ".mid");
      const name = await page.locator("[data-export-file-name]").textContent();
      const file = await downloadBytes(page, "[data-export-download]");
      const midi = readMidi(file.bytes);
      record(
        at("24 Hatadan sonra yeniden denenebilir"),
        (await page.locator("[data-export-error]").count()) === 0 &&
          name?.endsWith(".mid") === true &&
          midi.header === "MThd",
        `yeniden üretildi: ${file.name}, ${file.bytes.length} B`,
      );
    });

    measurements[`${label}-console-5`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------------------ 27: storage closed, all three */
  {
    const { context, page } = await openApp(browser, size, {
      seed: richSong(),
      refuseWriteCheck: true,
    });

    await safe(at("27 canPersist false üç export'u da kullanır"), async () => {
      await openExport(page);
      const note = await page.locator("[data-export-read-only]").count();

      await produce(page, "[data-export-project]", ".json");
      const project = await downloadBytes(page, "[data-export-download]");

      await page.locator("[data-export-new]").click();
      await produce(page, "[data-export-midi]", ".mid");
      const midi = await downloadBytes(page, "[data-export-download]");

      await page.locator("[data-export-new]").click();
      await produce(page, "[data-export-wav]", ".wav");
      const wav = await downloadBytes(page, "[data-export-download]");

      record(
        at("27 canPersist false üç export'u da kullanır"),
        note === 1 &&
          JSON.parse(new TextDecoder().decode(project.bytes)).format ===
            "aranje.project" &&
          readMidi(midi.bytes).header === "MThd" &&
          readWav(wav.bytes).riff === "RIFF" &&
          (await writes(page)) === 0,
        `not ${note}, üç dosya da geçerli, writes ${await writes(page)}`,
      );
    });

    measurements[`${label}-console-6`] = await consoleErrors(page);
    await context.close();
  }

  /* ------------------------------- 28-33, 35-36: attribution, layout, quiet */
  {
    const { context, page, external } = await openApp(browser, size, {
      seed: richSong(),
    });

    await safe(at("28 Atıf metni kopyalanır"), async () => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await openExport(page);
      const shown = await page.locator("[data-export-attribution-line]").innerText();
      await page.locator("[data-export-attribution-copy]").click();
      await page.waitForTimeout(250);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      record(
        at("28 Atıf metni kopyalanır"),
        copied.trim() === shown.trim() &&
          copied.includes("FluidR3") &&
          copied.includes("CC BY 3.0 US"),
        `"${copied.slice(0, 60)}…"`,
      );
    });

    await safe(at("29 Atıf dosyası indirilir"), async () => {
      const file = await downloadBytes(page, "[data-export-attribution-file]");
      const text = new TextDecoder("utf-8").decode(file.bytes);
      record(
        at("29 Atıf dosyası indirilir"),
        file.name.endsWith(".txt") &&
          text.includes("FluidR3") &&
          text.includes("midi-js-soundfonts") &&
          text.includes("CC BY 3.0 US") &&
          text.includes("creativecommons.org") &&
          text.includes("dönüştürülmüştür"),
        `${file.name}, ${file.bytes.length} B`,
      );
    });

    await safe(at("30 MIDI'de WAV atfı zorunluymuş gibi gösterilmez"), async () => {
      const text = await page.locator("[data-export-midi-license]").innerText();
      record(
        at("30 MIDI'de WAV atfı zorunluymuş gibi gösterilmez"),
        text.includes("ses örneği içermez") && text.includes("yalnız WAV"),
        `"${text.trim()}"`,
      );
    });

    await safe(at("31 320/390 taşma 0"), async () => {
      const layout = await layoutProbe(page);
      record(
        at("31 320/390 taşma 0"),
        layout.bodyOverflow === 0,
        `overflow ${layout.bodyOverflow}`,
      );
    });

    await safe(at("32 Kasıtlı scroller sayısı değişmez"), async () => {
      /*
       * The app's own deliberate horizontal scroller is the arrangement's,
       * and how many there are depends on the song. What this checkpoint is
       * responsible for is that the export surface adds none of its own — so
       * the count is measured with the sheet closed and again with it open.
       */
      await page.locator("[aria-label='Kapat']").first().click({ position: { x: 8, y: 8 } });
      await page.waitForTimeout(250);
      const closed = await layoutProbe(page);
      await openExport(page);
      const open = await layoutProbe(page);
      record(
        at("32 Kasıtlı scroller sayısı değişmez"),
        open.scrollers === closed.scrollers && open.scrollers <= 1,
        `kapalıyken ${closed.scrollers}, açıkken ${open.scrollers}`,
      );
    });

    await safe(at("33 44px altı hedef 0"), async () => {
      const edges = await targetEdges(page, [
        "[data-export-project]",
        "[data-export-wav]",
        "[data-export-midi]",
        "[data-export-attribution-copy]",
        "[data-export-attribution-file]",
        "[data-export-scope='all']",
        "[data-export-scope='audible']",
      ]);
      record(
        at("33 44px altı hedef 0"),
        edges.length > 0 && edges.every((edge) => edge >= 44),
        `edges ${edges.join(",")}`,
      );
    });

    await safe(at("35 Console/page error 0"), async () => {
      const all = [
        ...(measurements[`${label}-console-1`] ?? []),
        ...(measurements[`${label}-console-2`] ?? []),
        ...(measurements[`${label}-console-3`] ?? []),
        ...(measurements[`${label}-console-4`] ?? []),
        ...(measurements[`${label}-console-5`] ?? []),
        ...(measurements[`${label}-console-6`] ?? []),
        ...(await consoleErrors(page)),
      ];
      record(at("35 Console/page error 0"), all.length === 0, all.slice(0, 2).join(" | "));
    });

    await safe(at("36 Dış ağ isteği 0"), async () => {
      record(at("36 Dış ağ isteği 0"), external.length === 0, external.slice(0, 2).join(", "));
    });

    await context.close();
  }
}

/* ------------------------------------------------------------------- main */

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const sizes = process.env.ONE_VIEWPORT
  ? [{ width: 390, height: 844 }]
  : [
      { width: 390, height: 844 },
      { width: 320, height: 700 },
    ];

for (const size of sizes) {
  await run(browser, size, `@${size.width}x${size.height}`);
}

await browser.close();

const failed = results.filter((entry) => !entry.pass);
flush();
console.log(`\n${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length === 0 ? 0 : 1);
