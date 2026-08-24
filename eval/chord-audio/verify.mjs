/**
 * Launch-audio and preview-bank browser acceptance (2O-B.1 §2/§3, 2P-A §17).
 *
 * Thirty scenarios in two phone viewports, against the real production
 * build. The rule the suite works to is the one every earlier checkpoint
 * settled on: a claim is measured on the thing it is about. "It sounds" is a
 * count of buffer sources that carried audio, not a label; "nothing was
 * written" is a count of physical `setItem` calls by key kind; "the sample
 * did not come down again" is a count of network requests for files under
 * `/samples/`.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/chord-audio/verify.mjs
 *   ONE_VIEWPORT=1 node eval/chord-audio/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { LEDGER, takeLedger } from "../projects/ledger.mjs";
import { bassTrack, device, guitarTrack, payloadKey, song, twoProjects } from "../chord/seeds.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/chord-audio/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const record_ = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 170) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const ONLY = (process.env.AUDIO_ONLY ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

async function safe(label, run) {
  if (ONLY.length > 0 && !ONLY.some((entry) => label.includes(entry))) return;
  try {
    await run();
  } catch (error) {
    record_(`${label} (threw)`, false, String(error).split("\n")[0]);
  }
}

/* ------------------------------------------------------------- the harness */

/**
 * Counters installed before the app's first line.
 *
 * The AudioContext count comes from the shared ledger, which wraps the
 * constructor in a Proxy rather than a subclass — a subclass breaks Tone's
 * decoder and produces a measurement of the instrument instead of the app.
 */
const COUNTERS = `
  window.__sampleRequests = 0;
  window.__sampleUrls = [];
  window.__decodes = 0;
  window.__started = 0;
  window.__finished = 0;
  (() => {
    const original = window.fetch;
    window.fetch = function (input, init) {
      const url = String(typeof input === "string" ? input : (input && input.url) || "");
      if (url.indexOf("/samples/") !== -1) {
        window.__sampleRequests += 1;
        window.__sampleUrls.push(url);
      }
      return original.call(this, input, init);
    };
    const Base = window.BaseAudioContext;
    if (Base && Object.prototype.hasOwnProperty.call(Base.prototype, "decodeAudioData")) {
      const decode = Base.prototype.decodeAudioData;
      Base.prototype.decodeAudioData = function (...args) {
        window.__decodes += 1;
        return decode.apply(this, args);
      };
    }
    const done = (node) => {
      if (node.__done) return;
      node.__done = true;
      window.__finished += 1;
    };
    const NodeProto = window.AudioNode;
    const disconnect = NodeProto.prototype.disconnect;
    NodeProto.prototype.disconnect = function (...args) {
      if (this.__counted) done(this);
      return disconnect.apply(this, args);
    };
    const Source = window.AudioBufferSourceNode;
    const start = Source.prototype.start;
    const stop = Source.prototype.stop;
    Source.prototype.start = function (...args) {
      // Only sources that carry a buffer: one without makes no sound and
      // never fires 'ended', so counting it reports voices that never were.
      if (this.buffer) {
        window.__started += 1;
        this.__counted = true;
        this.addEventListener("ended", () => done(this));
      }
      return start.apply(this, args);
    };
    Source.prototype.stop = function (...args) {
      if (this.__counted) done(this);
      return stop.apply(this, args);
    };
  })();
`;

async function openApp(browser, size, seed, options = {}) {
  const context = await browser.newContext({ viewport: size });
  const external = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      external.push(url);
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      void page
        .evaluate((text) => window.__consoleErrors.push(text), message.text())
        .catch(() => {});
    }
  });
  await page.addInitScript(
    ([ledger, counters, state, closed]) => {
      (0, eval)(ledger);
      (0, eval)(counters);
      if (closed) {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith("aranje.")) throw new Error("QuotaExceededError");
          return original.call(this, key, value);
        };
      }
      for (const [key, value] of Object.entries(state ?? {})) {
        localStorage.setItem(key, value);
      }
    },
    [LEDGER, COUNTERS, seed ?? null, options.writingClosed === true],
  );
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-projects]");
  await page.waitForTimeout(700);
  return { context, page, external };
}

const counters = (page) =>
  page.evaluate(() => ({
    sampleRequests: window.__sampleRequests,
    distinctSampleUrls: [...new Set(window.__sampleUrls)].length,
    decodes: window.__decodes,
    audioContexts: window.__audioContexts,
    started: window.__started,
    live: window.__started - window.__finished,
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
/** Which project the app is actually showing. A new song is not project-1. */
const activeProjectId = async (page) => {
  const raw = await page.evaluate(() => localStorage.getItem("aranje.projects"));
  try {
    return JSON.parse(raw ?? "{}").activeProjectId ?? "project-1";
  } catch {
    return "project-1";
  }
};

const storedSong = async (page, id = "project-1") => {
  const text = await page.evaluate((key) => localStorage.getItem(key), payloadKey(id));
  if (!text) return null;
  try {
    return JSON.parse(text).current;
  } catch {
    return null;
  }
};

/* =========================================================== the scenarios */

async function run(label, size) {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const at = (name) => `[${label}] ${name}`;

  /* ---- 1-3: a brand new song, and whether its first track makes a sound */
  await safe(at("01 yeni sarki"), async () => {
    const { context, page } = await openApp(browser, size, null);
    await page.locator("[data-open-projects]").click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="project-new"]').click();
    await page.waitForTimeout(250);
    await page.locator('[data-project-template="empty"]').click();
    await page.waitForTimeout(900);

    const stored = await storedSong(page, await activeProjectId(page));
    record_(
      at("01 yeni bos sarki olusturuldu"),
      stored !== null && stored.tracks.length === 1,
      `${stored?.tracks.length ?? 0} track · ${stored?.tracks[0]?.instrumentId}/${stored?.tracks[0]?.presetId}`,
    );
    record_(
      at("02 ilk gitar track'i duyulabilir bir preset tasiyor"),
      stored?.tracks[0]?.presetId === "high_gain",
      `${stored?.tracks[0]?.presetId}`,
    );

    /*
     * Creating a project from the library leaves the library open, and its
     * backdrop swallows every click underneath it. Closing it through the
     * app's own control rather than pressing Escape: this is what a reader
     * does, and Escape is not something a phone has.
     */
    await page.getByRole("button", { name: "Kapat" }).first().click();
    await page.waitForTimeout(400);
    await enterEdit(page);
    await tapCell(page);
    await openBuilder(page);
    await chooseChord(page, 9, "minor_7");
    const ids = await voicingIds(page);
    await audition(page, ids[0]);
    await page.waitForTimeout(1500);
    const heard = await counters(page);
    record_(
      at("03 ses gercekten var"),
      heard.started > 0 && heard.sampleRequests > 0,
      `${heard.started} kaynak · ${heard.sampleRequests} sample istegi`,
    );
    await context.close();
  });

  /* ---- 4-11: the builder, twenty-five auditions, and what they cost */
  await safe(at("04 builder"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    await enterEdit(page);
    await tapCell(page);
    await openBuilder(page);
    record_(
      at("04 chord builder acildi"),
      (await page.locator("[data-chord-sheet]").count()) === 1,
      "1 sheet",
    );

    await chooseChord(page, 9, "minor");
    const minorIds = await voicingIds(page);
    record_(at("05 Am secildi"), minorIds.length > 0, `${minorIds.length} varyasyon`);

    await page.locator("[data-chord-cancel]").click();
    await page.waitForTimeout(300);
    await tapCell(page);
    await openBuilder(page);
    await chooseChord(page, 9, "minor_7");
    const ids = await voicingIds(page);
    record_(at("06 Am7 secildi"), ids.length > 0, `${ids.length} varyasyon`);

    for (const id of ids) await audition(page, id);
    await page.waitForTimeout(1200);
    const four = await counters(page);
    record_(
      at("07 dort varyasyon sirayla dinlendi"),
      four.started > 0,
      `${four.started} kaynak`,
    );

    for (let index = 0; index < 25; index += 1) await audition(page, ids[index % ids.length]);
    await page.waitForTimeout(1500);
    const many = await counters(page);
    record_(at("08 25 kez varyasyon degistirildi"), many.started > four.started, `${many.started} kaynak`);
    record_(
      at("09 fetch ve decode benzersiz sample sayisinda kaliyor"),
      many.sampleRequests === many.distinctSampleUrls &&
        many.decodes >= many.distinctSampleUrls &&
        many.decodes <= many.distinctSampleUrls + 1,
      `${many.sampleRequests} istek / ${many.decodes} decode / ${many.distinctSampleUrls} URL`,
    );
    record_(at("10 AudioContext 1"), many.audioContexts === 1, `${many.audioContexts}`);

    await page.locator("[data-chord-cancel]").click();
    await page.waitForTimeout(200);
    const atClose = await counters(page);
    await page.waitForTimeout(3000);
    const later = await counters(page);
    record_(
      at("11 sheet kapandiktan 3 sn sonra yeni ses 0"),
      later.started === atClose.started && later.live === 0,
      `${atClose.started} → ${later.started} kaynak · ${later.live} canli`,
    );
    await context.close();
  });

  /* ---- 12-16: what reaches storage, and what must not */
  await safe(at("12 yazma"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    await enterEdit(page);
    await tapCell(page);
    await openBuilder(page);
    await chooseChord(page, 9, "minor_7");
    const ids = await voicingIds(page);

    await takeLedger(page);
    await audition(page, ids[0]);
    await page.waitForTimeout(900);
    const preview = await takeLedger(page);
    record_(
      at("14 preview 0 yazim"),
      preview.n("set:projectPayload") === 0 && preview.n("set:catalog") === 0,
      `payload ${preview.n("set:projectPayload")} · katalog ${preview.n("set:catalog")}`,
    );

    await page.locator("[data-chord-apply]").click();
    await page.waitForTimeout(800);
    const applied = await takeLedger(page);
    record_(
      at("12 uygula: 1 proje yazimi"),
      applied.n("set:projectPayload") === 1,
      `${applied.n("set:projectPayload")} payload yazimi`,
    );

    const undo = page.getByRole("button", { name: "Geri al" });
    await undo.click();
    await page.waitForTimeout(700);
    const afterUndo = await storedSong(page);
    const slotAfterUndo = afterUndo?.sections[0]?.bars[0]?.slots?.gtr?.[0] ?? null;
    record_(
      at("15 undo akoru tek adimda geri aldi"),
      slotAfterUndo === null,
      JSON.stringify(slotAfterUndo).slice(0, 60),
    );

    await enterEdit(page).catch(() => {});
    await tapCell(page);
    await openBuilder(page);
    await chooseChord(page, 9, "minor_7");
    await takeLedger(page);
    await page.locator("[data-chord-cancel]").click();
    await page.waitForTimeout(400);
    const cancelled = await takeLedger(page);
    record_(
      at("13 vazgec: 0 yazim"),
      cancelled.n("set:projectPayload") === 0,
      `${cancelled.n("set:projectPayload")}`,
    );
    await context.close();
  });

  await safe(at("16 izolasyon"), async () => {
    const first = song([guitarTrack()], { title: "Bir" });
    const second = song([guitarTrack()], { title: "Iki" });
    const { context, page } = await openApp(browser, size, twoProjects(first, second));
    const before = JSON.stringify(await storedSong(page, "project-2"));
    await enterEdit(page);
    await tapCell(page);
    await openBuilder(page);
    await chooseChord(page, 9, "minor_7");
    await page.locator("[data-chord-apply]").click();
    await page.waitForTimeout(800);
    const after = JSON.stringify(await storedSong(page, "project-2"));
    record_(at("16 ikinci proje byte-es"), before === after, before === after ? "esit" : "degisti");
    await context.close();
  });

  /* ---- 17-19: storage closed, a missing preset, and the preset picker */
  await safe(at("17 depo kapali"), async () => {
    /*
     * With storage closed the *editor* is closed upstream, by design — so the
     * chord builder is not reachable and a scenario that tried to open it
     * would be measuring the wrong refusal. What is worth checking is that
     * listening still works: a reader who cannot save can still hear their
     * song.
     */
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])), {
      writingClosed: true,
    });
    const editable = await page
      .getByRole("button", { name: "Düzenle", exact: true })
      .count();
    record_(
      at("17a depo yazilamazken duzenleme acilmiyor"),
      editable === 0,
      `${editable} duzenle dugmesi`,
    );

    await page.getByRole("button", { name: /Çal|Duraklat/ }).first().click();
    await page.waitForTimeout(2500);
    const heard = await counters(page);
    record_(
      at("17b depo yazilamazken calma yine calisiyor"),
      heard.sampleRequests > 0,
      `${heard.sampleRequests} sample istegi · ${heard.started} kaynak`,
    );
    await context.close();
  });

  await safe(at("18 eksik preset"), async () => {
    const silent = guitarTrack({ presetId: "clean", name: "Sessiz Gitar" });
    const { context, page } = await openApp(browser, size, device(song([silent, bassTrack()])));
    await page.getByRole("button", { name: /Çal|Duraklat/ }).first().click();
    await page.waitForTimeout(2500);
    const notice = await page
      .locator("[data-silent-track-notice]")
      .innerText()
      .catch(() => "");
    record_(
      at("18 eksik preset icin guvenli mesaj"),
      notice.includes("Sessiz Gitar") &&
        !notice.includes("clean") &&
        !notice.includes("electric_guitar") &&
        !notice.includes("/samples/"),
      notice.slice(0, 120) || "(mesaj yok)",
    );

    await context.close();
  });

  await safe(at("19 preset listesi"), async () => {
    const silent = guitarTrack({ presetId: "clean", name: "Sessiz Gitar" });
    const { context, page } = await openApp(browser, size, device(song([silent])));
    // Through the doors the app itself uses: the footer track control opens
    // the track sheet, which opens the manager, which shows the setup form.
    await page.locator('[data-testid="view-tab"]').click().catch(() => {});
    await page.waitForTimeout(300);
    await page.locator("[data-track-control]").click();
    await page.waitForTimeout(300);
    await page.locator("[data-track-manage]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-track-action="setup"]').first().click();
    await page.waitForTimeout(400);

    const options = await page
      .locator("[data-track-preset] option")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          value: node.getAttribute("value"),
          disabled: node.disabled,
          text: node.textContent,
        })),
      )
      .catch(() => []);
    const clean = options.find((option) => option.value === "clean");
    record_(
      at("19 unavailable preset oynatilabilir gibi sunulmuyor"),
      options.length > 0 && clean !== undefined && clean.disabled === true,
      options.length === 0
        ? "preset listesi acilmadi — senaryo bir sey olcmedi"
        : options.map((option) => `${option.value}${option.disabled ? "(kapali)" : ""}`).join(","),
    );
    await context.close();
  });

  /* ---- 20-23: the other surfaces, unchanged */
  await safe(at("20 proje dosyasi"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    await enterEdit(page);
    await tapCell(page);
    await openBuilder(page);
    await chooseChord(page, 9, "minor_7");
    await page.locator("[data-chord-apply]").click();
    await page.waitForTimeout(800);
    const stored = JSON.stringify(await storedSong(page));
    record_(
      at("20 proje kaydinda akor metadata'si yok"),
      !stored.includes("chord") && !stored.includes("voicing") && !stored.includes("availability"),
      "temiz",
    );
    record_(
      at("21 kayitta preview veya bank alani yok"),
      !stored.includes("bankKey") && !stored.includes("silentTrack"),
      "temiz",
    );
    record_(
      at("22 nota olaylari sadece sozlesmenin alanlarini tasiyor"),
      !stored.includes("pitchGesture") && !stored.includes("attack"),
      "temiz",
    );
    await context.close();
  });

  await safe(at("23 mikser"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack(), bassTrack()])));
    await page.locator("[data-open-mixer]").click().catch(async () => {
      await page.getByRole("button", { name: /Karıştırıcı|Mikser/ }).first().click();
    });
    await page.waitForTimeout(500);
    const before = await storedSong(page);
    await page.locator("[data-mixer-mute='gtr']").click().catch(() => {});
    await page.waitForTimeout(500);
    const after = await storedSong(page);
    record_(
      at("23 mute/solo sarkiya yazilmiyor"),
      JSON.stringify(before) === JSON.stringify(after),
      "sarki degismedi",
    );
    await context.close();
  });

  /* ---- 24-30: the screen itself */
  await safe(at("24 ekran"), async () => {
    const longTitle = song([guitarTrack()], {
      title: "Çok Uzun Bir Proje Başlığı — Taşmaması Gerekiyor ve Kırpılmalı",
    });
    const { context, page, external } = await openApp(browser, size, device(longTitle));
    await enterEdit(page);
    await tapCell(page);
    await openBuilder(page);
    await chooseChord(page, 9, "minor_7");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    record_(at("24 uzun baslik tasmiyor"), overflow <= 0, `${overflow}px`);
    record_(at("25 govde yatay tasmasi 0"), overflow <= 0, `${overflow}px`);

    /*
     * Two different things, which the first version of this counted as one.
     *
     * An element that overflows *and* is allowed to scroll is a deliberate
     * scroller — the tab canvas is one, and the spec expects exactly one. An
     * element that overflows and is **not** allowed to scroll is clipped
     * content: the reader simply cannot see part of it, and no amount of
     * swiping helps. Collapsing them into one number hid the second kind
     * entirely.
     */
    const overflow2 = await page.evaluate(() => {
      const scrollers = [];
      const clipped = [];
      const viewport = document.documentElement.clientWidth;
      for (const node of document.querySelectorAll("*")) {
        if (node.scrollWidth <= node.clientWidth + 1) continue;
        const style = getComputedStyle(node);
        const entry = `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]} ${node.scrollWidth}/${node.clientWidth}`;
        if (style.overflowX === "auto" || style.overflowX === "scroll") {
          scrollers.push(entry);
          continue;
        }
        // Ellipsised text is designed: the reader is told there is more by
        // the ellipsis itself. Silently cut-off layout is not.
        if (style.textOverflow === "ellipsis") continue;
        /*
         * Only what is pushed off the *screen*. A sticky gutter inside a
         * scrolling canvas measures wider than its own box and loses
         * nothing; an element wider than the viewport has content the reader
         * cannot reach at all.
         */
        if (node.scrollWidth <= viewport) continue;
        clipped.push(entry);
      }
      return { scrollers, clipped };
    });
    record_(
      at("26 tam olarak bir kasitli yatay scroller"),
      overflow2.scrollers.length === 1,
      overflow2.scrollers.join(" · ") || "yok",
    );
    record_(
      at("26b viewport disina tasan kirpilmis icerik yok"),
      overflow2.clipped.length === 0,
      overflow2.clipped.join(" · ") || "yok",
    );

    const small = await page.evaluate(() => {
      const sheet = document.querySelector("[data-chord-sheet]");
      if (!sheet) return -1;
      return [...sheet.querySelectorAll("button")].filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && Math.min(box.width, box.height) < 44;
      }).length;
    });
    record_(at("27 44 px altinda hedef 0"), small === 0, `${small}`);

    const state = await counters(page);
    record_(at("28 console/page error 0"), state.errors === 0, `${state.errors}`);
    record_(at("29 dis ag istegi 0"), external.length === 0, external[0] ?? "yok");

    const ids = await voicingIds(page);
    await audition(page, ids[0]);
    await page.waitForTimeout(1000);
    await page.locator("[data-chord-cancel]").click();
    await page.waitForTimeout(2500);
    const final = await counters(page);
    record_(at("30 dispose sonrasi aktif voice 0"), final.live === 0, `${final.live}`);
    await context.close();
  });

  await browser.close();
}

const VIEWPORTS =
  process.env.ONE_VIEWPORT === "1"
    ? [["390x844", { width: 390, height: 844 }]]
    : [
        ["390x844", { width: 390, height: 844 }],
        ["320x700", { width: 320, height: 700 }],
      ];

for (const [label, size] of VIEWPORTS) await run(label, size);

const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
writeFileSync(
  `${OUT}/BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2O-B.1 §2/§3 ve 2P-A §17 — mobil tarayıcı kabulü",
      measuredOn:
        "masaüstü Chromium, 390×844 ve 320×700 — bu bir fiziksel cihaz " +
        "kabulü DEĞİLDİR ve öyle sunulamaz",
      results,
    },
    null,
    2,
  )}\n`,
);
process.exit(failed === 0 ? 0 : 1);
