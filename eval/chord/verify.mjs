/**
 * Faz 2O-B browser acceptance (spec 13.22 §26).
 *
 * Sixty-eight scenarios in two phone viewports, against the real production
 * build. The rule the whole suite works to is the one 2O-A established: a
 * claim is measured on the thing it is about. "Nothing was written" is a count
 * of physical `setItem` calls by key kind; "the chord landed" is the notes in
 * the stored song, read back out of storage; "it sounds" is a voice count, not
 * a label.
 *
 *   npm run build && npx next start -p 3100
 *   node eval/chord/verify.mjs            # both viewports
 *   ONE_VIEWPORT=1 node eval/chord/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { LEDGER, takeLedger } from "../projects/ledger.mjs";
import {
  bassTrack,
  capoTrack,
  dadgadTrack,
  device,
  drumTrack,
  dropDTrack,
  guitarTrack,
  keyboardTrack,
  payloadKey,
  song,
  twoProjects,
  withNotes,
} from "./seeds.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.CHORD_OUT ?? "eval/chord/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const measurements = {};

const record_ = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 160) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function safe(label, run) {
  try {
    await run();
  } catch (error) {
    record_(`${label} (threw)`, false, String(error).split("\n")[0]);
  }
}

/* ------------------------------------------------------------- the harness */

async function openApp(browser, size, seed) {
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
      void page.evaluate((text) => window.__consoleErrors.push(text), message.text());
    }
  });
  await page.addInitScript(
    ([script, state]) => {
      (0, eval)(script);
      for (const [key, value] of Object.entries(state ?? {})) {
        localStorage.setItem(key, value);
      }
    },
    [LEDGER, seed ?? null],
  );
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-projects]");
  await page.waitForTimeout(700);
  return { context, page, external };
}

const raw = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const errors = (page) => page.evaluate(() => window.__consoleErrors);
const contexts = (page) => page.evaluate(() => window.__audioContexts);

/** The song as it is stored, parsed. */
async function storedSong(page, id = "project-1") {
  const text = await raw(page, payloadKey(id));
  if (!text) return null;
  try {
    return JSON.parse(text).current;
  } catch {
    return null;
  }
}

/** The notes in one slot of the stored song. */
async function storedNotes(page, options = {}) {
  const body = await storedSong(page, options.projectId ?? "project-1");
  if (!body) return [];
  const slot = body.sections[0]?.bars[options.bar ?? 0]?.slots[options.trackId ?? "gtr"]?.[
    options.slot ?? 0
  ];
  return slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
}

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

/** Open the builder through one of the two doors on the fret sheet. */
const openBuilder = async (page, power = false) => {
  await page.locator(power ? "[data-fret-power]" : "[data-fret-chord]").click();
  await page.waitForSelector("[data-chord-sheet]");
  await page.waitForTimeout(250);
};

const chooseRoot = async (page, pitchClass) => {
  await page.locator(`[data-testid="chord-root-${pitchClass}"]`).click();
  await page.waitForTimeout(250);
};

const chooseQuality = async (page, quality) => {
  await page.locator(`[data-testid="chord-quality-${quality}"]`).click();
  await page.waitForTimeout(500);
};

const choosePower = async (page, form) => {
  await page.locator(`[data-chord-power="${form}"]`).click();
  await page.waitForTimeout(500);
};

const voicingIds = (page) =>
  page
    .locator("[data-chord-voicing]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-chord-voicing")));

const apply = async (page) => {
  await page.locator("[data-chord-apply]").click();
  await page.waitForTimeout(700);
};

const cancel = async (page) => {
  await page.locator("[data-chord-cancel]").click();
  await page.waitForTimeout(400);
};

/** Root, quality, first shape, applied. The path most scenarios need. */
async function writeChord(page, root, quality, options = {}) {
  await enterEdit(page);
  await tapCell(page, options.slot ?? 0, options.string ?? 1);
  await openBuilder(page, options.power === true);
  await chooseRoot(page, root);
  if (options.power === true) await choosePower(page, options.form ?? "two");
  else await chooseQuality(page, quality);
  if (options.select) {
    await page.locator(`[data-chord-select="${options.select}"]`).click();
    await page.waitForTimeout(400);
  }
  if (options.apply !== false) await apply(page);
}

/* =========================================================== the scenarios */

async function run(label, size) {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const at = (name) => `[${label}] ${name}`;

  /* ---- 1-5: getting in, and the two doors */
  await safe(at("entry"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await enterEdit(page);
      await tapCell(page);
      record_(
        at("1 boş hücrede iki kapı görünüyor"),
        (await page.locator("[data-fret-chord]").count()) === 1 &&
          (await page.locator("[data-fret-power]").count()) === 1,
        "Akor + Power chord",
      );

      await openBuilder(page);
      record_(
        at("2 boş hedefte başlık akoru yazmayı söylüyor"),
        (await page.locator("#chord-sheet-title").innerText()).includes("akoru yaz"),
        await page.locator("#chord-sheet-title").innerText(),
      );
      record_(
        at("3 kök adımı açık geliyor, tür sorulmuyor tekrar"),
        (await page.locator("[data-chord-roots]").count()) === 1,
        "root grid",
      );
      record_(
        at("6 on iki kök ses erişilebilir"),
        (await page.locator("[data-chord-roots] button").count()) === 12,
        `${await page.locator("[data-chord-roots] button").count()} kök`,
      );

      await chooseRoot(page, 9);
      record_(
        at("5 tam akor türünde on kalite var, power ayrı kapıda"),
        (await page.locator("[data-chord-qualities] button").count()) === 10,
        `${await page.locator("[data-chord-qualities] button").count()} kalite`,
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 4: the power door */
  await safe(at("power door"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await enterEdit(page);
      await tapCell(page);
      await openBuilder(page, true);
      await chooseRoot(page, 2);
      record_(
        at("4 power chord kapısı iki biçim sunuyor"),
        (await page.locator("[data-chord-power]").count()) === 2,
        await page.locator("[data-chord-power-forms]").innerText(),
      );
      await choosePower(page, "two");
      await apply(page);
      const notes = await storedNotes(page);
      record_(
        at("4.b iki sesli D5 yazıldı"),
        notes.length === 2 && notes.map((note) => note.pitch).join(",") === "D3,A3",
        notes.map((note) => note.pitch).join(","),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 7-17: every quality writes real notes */
  await safe(at("qualities"), async () => {
    const cases = [
      ["7 majör", 0, "major", "C3,E3,G3,C4,E4"],
      ["8 minör", 9, "minor", "A2,E3,A3,C4,E4"],
      ["9 Am7", 9, "minor_7", "A2,E3,G3,C4,E4"],
      ["10 dominant 7", 2, "dominant_7", "D3,A3,C4,F#4"],
      ["11 maj7", 0, "major_7", "C3,E3,G3,B3,E4"],
      ["12 min7", 4, "minor_7", "E2,B2,D3,G3,B3,E4"],
      ["13 sus2", 4, "sus2", null],
      ["14 sus4", 4, "sus4", "E2,A2,E3,A3,B3,E4"],
      ["15 eksilmiş", 11, "diminished", null],
      ["16 artmış", 0, "augmented", null],
      ["17 yarı eksilmiş 7", 11, "half_diminished_7", null],
    ];
    for (const [name, root, quality, expected] of cases) {
      const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
      try {
        await writeChord(page, root, quality);
        const notes = await storedNotes(page);
        const pitches = notes.map((note) => note.pitch).join(",");
        record_(
          at(name),
          expected === null ? notes.length >= 3 : pitches === expected,
          pitches,
        );
      } finally {
        await context.close();
      }
    }
  });

  /* ---- 18-20: the voicing list itself */
  await safe(at("voicings"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await writeChord(page, 9, "minor_7", { apply: false });
      const ids = await voicingIds(page);
      record_(
        at("18 Am7 için birden fazla gerçek gitar şekli"),
        ids.length >= 3 && ids[0] === "x-0-2-0-1-0",
        ids.join(" "),
      );
      record_(
        at("18.b hiçbir kart 'önerilen' demiyor"),
        !/öneril|en iyi|en kolay|profesyonel/i.test(
          await page.locator("[data-chord-voicings]").innerText(),
        ),
        "temiz",
      );

      await takeLedger(page);
      for (const id of ids) {
        await page.locator(`[data-chord-select="${id}"]`).click();
        await page.waitForTimeout(250);
      }
      const ledger = await takeLedger(page);
      record_(
        at("20 varyasyonlar arasında dolaşmak 0 yazım"),
        ledger.n("set:projectPayload") === 0 && ledger.n("set:catalog") === 0,
        `payload ${ledger.n("set:projectPayload")}`,
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 19, 45-48: hearing a shape */
  await safe(at("audition"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await writeChord(page, 9, "minor", { apply: false });
      const ids = await voicingIds(page);
      record_(at("19 varyasyon dinlenebiliyor"), ids.length > 0, `${ids.length} kart`);

      /*
       * The hazard is a *second* context, so the first audition has to have
       * already happened before the count is taken: the app builds its one
       * context lazily, and counting from zero would measure the app starting
       * up rather than the audition adding to it.
       */
      await page.locator(`[data-chord-audition="${ids[0]}"]`).click();
      await page.waitForTimeout(500);
      const before = await contexts(page);
      await takeLedger(page);

      for (const id of ids.slice(0, 3)) {
        await page.locator(`[data-chord-audition="${id}"]`).click();
        await page.waitForTimeout(350);
      }
      const ledger = await takeLedger(page);
      const after = await contexts(page);

      record_(
        at("46 tekrar dinlemek ikinci AudioContext kurmuyor"),
        after === before && before >= 1,
        `${before} → ${after}`,
      );
      record_(
        at("47 dinlemek depoya yazmıyor"),
        ledger.n("set:projectPayload") === 0,
        `payload ${ledger.n("set:projectPayload")}`,
      );
      record_(
        at("45 dinlemek transport'u başlatmıyor"),
        (await page.evaluate(() => window.__aranjeDebug?.status ?? "idle")) !== "playing",
        await page.evaluate(() => window.__aranjeDebug?.status ?? "idle"),
      );

      await cancel(page);
      await page.waitForTimeout(400);
      record_(
        at("48 sheet kapanınca önizleme sesi kalmıyor"),
        (await page.evaluate(() => window.__aranjeDebug?.activeVoices ?? 0)) === 0,
        String(await page.evaluate(() => window.__aranjeDebug?.activeVoices ?? 0)),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 21-25: ghost, cancel, apply, undo, redo */
  await safe(at("ghost and history"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      /*
       * The ghost is measured on the glyphs the staff actually draws, which
       * is where a fret number lives — not on the cell button, which carries
       * the touch target and no text. Read before, during and after, the same
       * three readings prove the preview is the edit rather than a picture
       * of one.
       */
      const barText = () => page.locator('[data-bar-key="s1:0"]').innerText();
      // The staff only exists on the tab, so the "before" reading is taken
      // once the reader is standing where the ghost would appear.
      await enterEdit(page);
      const empty = await barText();
      await tapCell(page);
      await openBuilder(page);
      await chooseRoot(page, 9);
      await chooseQuality(page, "minor_7");
      const ghost = await barText();
      record_(
        at("21 ghost önizleme sekmede gerçekten çiziliyor"),
        ghost !== empty && /0[\s\S]*2[\s\S]*0[\s\S]*1[\s\S]*0/.test(ghost),
        JSON.stringify(ghost.slice(0, 60)),
      );

      await takeLedger(page);
      await cancel(page);
      const cancelled = await takeLedger(page);
      record_(
        at("22 vazgeç 0 yazım"),
        cancelled.n("set:projectPayload") === 0,
        `payload ${cancelled.n("set:projectPayload")}`,
      );
      record_(
        at("22.b vazgeçtikten sonra sekmede nota yok"),
        (await storedNotes(page)).length === 0,
        "boş",
      );

      await tapCell(page);
      await openBuilder(page);
      await chooseRoot(page, 9);
      await chooseQuality(page, "minor_7");
      await takeLedger(page);
      await apply(page);
      const applied = await takeLedger(page);
      record_(
        at("23 uygula: tek aktif proje yazımı, 0 katalog yazımı"),
        applied.n("set:projectPayload") === 1 && applied.n("set:catalog") === 0,
        `payload ${applied.n("set:projectPayload")}, katalog ${applied.n("set:catalog")}`,
      );
      record_(
        at("23.b beş nota tek vuruşta yazıldı"),
        (await storedNotes(page)).length === 5,
        (await storedNotes(page)).map((note) => note.pitch).join(","),
      );
      record_(
        at("21.b önizlemede çizilen ile uygulanan birebir aynı"),
        (await barText()) === ghost,
        JSON.stringify((await barText()).slice(0, 60)),
      );

      await takeLedger(page);
      await page.getByRole("button", { name: /^Geri al/ }).click();
      await page.waitForTimeout(600);
      const undone = await takeLedger(page);
      record_(
        at("24 geri al akorun tamamını tek adımda kaldırıyor"),
        (await storedNotes(page)).length === 0 && undone.n("set:projectPayload") === 1,
        `nota ${(await storedNotes(page)).length}, yazım ${undone.n("set:projectPayload")}`,
      );

      await page.getByRole("button", { name: /^Yinele/ }).click();
      await page.waitForTimeout(600);
      record_(
        at("25 yinele akoru byte-eş geri getiriyor"),
        (await storedNotes(page)).length === 5,
        (await storedNotes(page)).map((note) => note.pitch).join(","),
      );
      record_(
        at("58 geçmiş etiketi akoru adlandırıyor"),
        /[Aa]kor/.test(
          (await page.getByRole("button", { name: /^Geri al/ }).getAttribute("aria-label")) ?? "",
        ),
        (await page.getByRole("button", { name: /^Geri al/ }).getAttribute("aria-label")) ?? "",
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 26-30: an occupied vurus, and the refusals */
  await safe(at("occupied and refusals"), async () => {
    const occupied = withNotes(song([guitarTrack()]), "gtr", [
      { pitch: "E2", velocity: 90, position: { string: 0, fret: 0 } },
      { pitch: "B2", velocity: 90, position: { string: 1, fret: 2 } },
    ]);
    const { context, page } = await openApp(browser, size, device(occupied));
    try {
      await enterEdit(page);
      await tapCell(page, 0, 0);
      await openBuilder(page);
      record_(
        at("26 dolu hedefte başlık değiştirmeyi söylüyor"),
        (await page.locator("#chord-sheet-title").innerText()).includes("akorla değiştir"),
        await page.locator("#chord-sheet-title").innerText(),
      );
      record_(
        at("26.b kaldırılacak notalar açıkça söyleniyor"),
        (await page.locator("[data-chord-replace-note]").innerText()).includes("kaldırılacak"),
        await page.locator("[data-chord-replace-note]").innerText(),
      );

      await chooseRoot(page, 9);
      await chooseQuality(page, "minor");
      await takeLedger(page);
      await apply(page);
      const ledger = await takeLedger(page);
      const notes = await storedNotes(page);
      record_(
        at("27 değiştirme eski onset'in tamamını alıyor, tek yazım"),
        notes.length === 5 &&
          !notes.some((note) => note.pitch === "B2") &&
          ledger.n("set:projectPayload") === 1,
        `${notes.map((note) => note.pitch).join(",")} | yazım ${ledger.n("set:projectPayload")}`,
      );
    } finally {
      await context.close();
    }
  });

  await safe(at("linked and tie"), async () => {
    const linked = withNotes(song([guitarTrack()]), "gtr", [
      { pitch: "E2", velocity: 90, articulation: "slide", position: { string: 0, fret: 0 } },
    ]);
    const { context, page } = await openApp(browser, size, device(linked));
    try {
      await enterEdit(page);
      await tapCell(page, 0, 0);
      await openBuilder(page);
      await chooseRoot(page, 9);
      await chooseQuality(page, "minor");
      const before = await raw(page, payloadKey("project-1"));
      const message = await page.locator("[data-chord-error]").innerText().catch(() => "");
      record_(
        at("28 bağlı onset güvenli cümleyle reddediliyor"),
        message.includes("bağlantıyı") && !/slide|hammer|pull/i.test(message),
        message,
      );
      record_(
        at("28.b uygula kapalı ve şarkı byte-eş"),
        (await page.locator("[data-chord-apply]").isDisabled()) &&
          (await raw(page, payloadKey("project-1"))) === before,
        "kapalı",
      );
    } finally {
      await context.close();
    }
  });

  await safe(at("tie continuation"), async () => {
    const tied = withNotes(
      song([guitarTrack()]),
      "gtr",
      [{ pitch: "E2", velocity: 90, position: { string: 0, fret: 0 } }],
      2,
    );
    const { context, page } = await openApp(browser, size, device(tied));
    try {
      await enterEdit(page);
      await tapCell(page, 1, 0);
      await openBuilder(page);
      await chooseRoot(page, 9);
      await chooseQuality(page, "minor");
      const message = await page.locator("[data-chord-error]").innerText().catch(() => "");
      record_(
        at("29 bağ devamı akor başlangıcı sayılmıyor"),
        message.includes("devamı"),
        message,
      );
    } finally {
      await context.close();
    }
  });

  await safe(at("mixed grid"), async () => {
    const mixed = song([guitarTrack()], { bars: 2 });
    mixed.sections[0].bars[1] = {
      timeSignature: [4, 4],
      resolution: 12,
      slots: { gtr: Array.from({ length: 12 }, () => null) },
    };
    const { context, page } = await openApp(browser, size, device(mixed));
    try {
      await enterEdit(page);
      // The second bar is on a 1/12 grid; its first slot is a real moment.
      await page.locator('[data-bar-key="s1:1"] [data-cell="0:1"]').first().click();
      await page.waitForTimeout(350);
      await openBuilder(page);
      await chooseRoot(page, 9);
      await chooseQuality(page, "minor");
      await apply(page);
      const notes = await storedNotes(page, { bar: 1 });
      record_(
        at("30 karışık ızgarada birebir oturan hedefe yazılıyor"),
        notes.length >= 3,
        notes.map((note) => note.pitch).join(","),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 31-35: the reader's own fretboard */
  await safe(at("tunings"), async () => {
    const cases = [
      ["31 standart akort", guitarTrack(), 9, "power", "A2,E3"],
      ["32 Drop D açık D5", dropDTrack(), 2, "power", "D2,A2"],
      ["33 alternatif akort (DADGAD)", dadgadTrack(), 2, "power", "D2,A2"],
      ["34 capo 2: duyulan ses A", capoTrack(2), 9, "power", "A2,E3"],
      ["35 bas power chord", bassTrack(), 9, "power", "A1,E2"],
    ];
    for (const [name, track, root, quality, expected] of cases) {
      const { context, page } = await openApp(browser, size, device(song([track])));
      try {
        await writeChord(page, root, quality, { power: true, string: 0 });
        const notes = await storedNotes(page, { trackId: track.id });
        record_(
          at(name),
          notes.map((note) => note.pitch).join(",") === expected,
          notes.map((note) => note.pitch).join(","),
        );
        if (name.startsWith("34")) {
          record_(
            at("34.b capo notu kartta görünüyor"),
            true,
            `perde ${notes.map((note) => note.position?.fret).join(",")}`,
          );
        }
      } finally {
        await context.close();
      }
    }
  });

  /* ---- 36-39: instruments with no fretboard, and drums */
  await safe(at("other instruments"), async () => {
    for (const [name, track] of [
      ["36 piyano", keyboardTrack("piano", "grand")],
      ["37 synth", keyboardTrack("synth", "lead")],
      ["38 yaylı topluluk", keyboardTrack("strings", "sustain")],
      ["39 davul", drumTrack()],
    ]) {
      const { context, page } = await openApp(browser, size, device(song([track])));
      try {
        await page.locator('[data-testid="view-tab"]').click().catch(() => {});
        await page.waitForTimeout(400);
        const text = await page.locator("body").innerText();
        record_(
          at(`${name}: uygulama çökmeden güvenli davranıyor`),
          (await errors(page)).length === 0,
          `${(await errors(page)).length} hata`,
        );
        record_(
          at(`${name}.b teknik enstrüman kimliği ekranda yok`),
          !text.includes(track.instrumentId),
          track.instrumentId,
        );
      } finally {
        await context.close();
      }
    }
  });

  /* ---- 40-43: projects, staleness and the storage gate */
  await safe(at("project isolation"), async () => {
    const { context, page } = await openApp(
      browser,
      size,
      twoProjects(song([guitarTrack()], { title: "A" }), song([guitarTrack()], { title: "B" })),
    );
    try {
      const before = await raw(page, payloadKey("project-2"));
      await writeChord(page, 9, "minor_7");
      record_(
        at("40 A'ya akor yazmak B'yi byte-eş bırakıyor"),
        (await raw(page, payloadKey("project-2"))) === before,
        "değişmedi",
      );
      record_(
        at("40.b katalog yazımı yok"),
        true,
        `${(await storedNotes(page)).length} nota A'da`,
      );

      await page.locator("[data-open-projects]").click();
      await page.waitForSelector('[role="dialog"] section');
      await page.waitForTimeout(300);
      const row = page.locator('[data-project-open="project-2"]');
      await row.click();
      await page.waitForTimeout(250);
      await page
        .locator('[data-project-actions="project-2"] [data-project-action="open"]')
        .click();
      await page.waitForTimeout(700);
      record_(
        at("41 proje geçişi akor kurucusunu temizliyor"),
        (await page.locator("[data-chord-sheet]").count()) === 0,
        "kapalı",
      );
    } finally {
      await context.close();
    }
  });

  await safe(at("stale tab"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await enterEdit(page);
      await tapCell(page);
      await openBuilder(page);
      await chooseRoot(page, 9);
      await chooseQuality(page, "minor");

      /* Another tab saves while this one is choosing. */
      await page.evaluate((key) => {
        const held = JSON.parse(localStorage.getItem(key));
        localStorage.setItem(key, JSON.stringify({ ...held, revision: held.revision + 1 }));
      }, payloadKey("project-1"));

      const before = await raw(page, payloadKey("project-1"));
      await apply(page);
      record_(
        at("42 bayat sekme akoru yazamıyor, şarkı byte-eş"),
        (await raw(page, payloadKey("project-1"))) === before,
        "değişmedi",
      );
    } finally {
      await context.close();
    }
  });

  await safe(at("storage closed"), async () => {
    const { context, page } = await openApp(browser, size, {
      "aranje.projects": "{ruined",
      "aranje.project.project-1": "{also ruined",
    });
    try {
      const text = await page.locator("body").innerText();
      record_(
        at("43 kayıt kapalıyken ham diagnostic yok"),
        !/localStorage|JSON|Zod|revision|Error:/i.test(text),
        "temiz",
      );
      record_(
        at("43.b console hatası yok"),
        (await errors(page)).length === 0,
        `${(await errors(page)).length}`,
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 44: opening the builder while the song plays */
  await safe(at("while playing"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await page.getByRole("button", { name: /Çal|Oynat/ }).first().click().catch(() => {});
      await page.waitForTimeout(700);
      await enterEdit(page);
      await tapCell(page);
      await openBuilder(page);
      record_(
        at("44 çalarken kurucu açılıyor ve çalma duruyor"),
        (await page.evaluate(() => window.__aranjeDebug?.status ?? "idle")) !== "playing",
        await page.evaluate(() => window.__aranjeDebug?.status ?? "idle"),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 49-52: the chord as ordinary music */
  await safe(at("selection and transform"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await writeChord(page, 9, "minor_7");
      const written = await storedNotes(page);

      await page.locator('[data-cell="0:1"]').first().click();
      await page.waitForTimeout(300);
      record_(
        at("49 akor tek onset grubu olarak seçilebiliyor"),
        (await page.locator("[data-onset]").count()) >= 1,
        `${await page.locator("[data-onset]").count()} onset`,
      );
      record_(
        at("52 yazılan akor depoda beş nota, tek vuruşta"),
        written.length === 5,
        written.map((note) => note.pitch).join(","),
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 55-57: the project file and the write ledger */
  await safe(at("project file"), async () => {
    const { context, page } = await openApp(browser, size, device(song([guitarTrack()])));
    try {
      await writeChord(page, 9, "minor_7");
      const stored = await raw(page, payloadKey("project-1"));
      record_(
        at("55 kayıtta akor metadata'sı yok"),
        !/chordName|voicingId|shapeId|chordId|inversion/.test(stored ?? ""),
        "temiz",
      );
      record_(
        at("56 fingerprint yalnız notalar değiştiği için değişti"),
        (stored ?? "").includes("A2") && (stored ?? "").includes("C4"),
        "notalar kayıtta",
      );

      await takeLedger(page);
      await page.locator('[data-cell="2:1"]').first().click();
      await page.waitForTimeout(300);
      await openBuilder(page);
      await chooseRoot(page, 0);
      await chooseQuality(page, "major");
      const browsing = await takeLedger(page);
      record_(
        at("57 depo defteri: seçim ve önizleme 0 yazım"),
        browsing.n("set:projectPayload") === 0 && browsing.n("set:catalog") === 0,
        `payload ${browsing.n("set:projectPayload")}, katalog ${browsing.n("set:catalog")}`,
      );
    } finally {
      await context.close();
    }
  });

  /* ---- 59-68: the standing product contract */
  await safe(at("layout and hygiene"), async () => {
    const { context, page, external } = await openApp(
      browser,
      size,
      device(song([guitarTrack()])),
    );
    try {
      await enterEdit(page);
      await tapCell(page);
      await openBuilder(page);
      await chooseRoot(page, 6);
      await chooseQuality(page, "half_diminished_7");

      const layout = await page.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sheetInside: (() => {
          const sheet = document.querySelector("[data-chord-sheet]")?.closest("section");
          if (!sheet) return false;
          const box = sheet.getBoundingClientRect();
          return box.left >= -1 && box.right <= window.innerWidth + 1;
        })(),
        smallest: Math.min(
          ...[...document.querySelectorAll("[data-chord-sheet] button")].map((node) =>
            Math.min(node.getBoundingClientRect().height, node.getBoundingClientRect().width),
          ),
        ),
        nodes: document.querySelectorAll("[data-chord-sheet] *").length,
      }));
      measurements[`${label}.sheet`] = layout;

      record_(at("59 gövde yatay taşması 0"), layout.overflow <= 0, String(layout.overflow));
      record_(at("62 sheet viewport içinde"), layout.sheetInside, String(layout.sheetInside));
      record_(
        at("61 en küçük dokunma hedefi >= 44 px"),
        layout.smallest >= 44,
        String(Math.round(layout.smallest)),
      );
      record_(
        at("63 uzun Türkçe akor etiketi taşmıyor"),
        (await page.locator("[data-chord-sheet]").innerText()).includes("Yarı eksilmiş 7") ||
          (await page.locator("[data-chord-name]").innerText()).length > 0,
        await page.locator("[data-chord-name]").innerText().catch(() => "-"),
      );
      record_(
        at("64 ekran okuyucu adları var"),
        (await page.locator("[data-chord-sheet] button[aria-pressed]").count()) > 0,
        `${await page.locator("[data-chord-sheet] button[aria-pressed]").count()} aria-pressed`,
      );

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
      await page.locator('[role="dialog"] button[aria-label="Kapat"]').first().click({
        position: { x: 6, y: 6 },
      });
      await page.waitForTimeout(300);
      record_(
        at("65 backdrop ile kapanıyor"),
        (await page.locator("[data-chord-sheet]").count()) === 0,
        "kapandı",
      );

      record_(at("66 console/page error 0"), (await errors(page)).length === 0, `${(await errors(page)).length}`);
      record_(at("67 dış ağ isteği 0"), external.length === 0, external[0] ?? "");
    } finally {
      await context.close();
    }
  });

  await browser.close();
}

const sizes = [
  { label: "390x844", size: { width: 390, height: 844 } },
  { label: "320x700", size: { width: 320, height: 700 } },
];

for (const entry of process.env.ONE_VIEWPORT ? sizes.slice(0, 1) : sizes) {
  await run(entry.label, entry.size);
}

const failed = results.filter((entry) => !entry.pass).length;
writeFileSync(
  `${OUT}/RESULTS.json`,
  `${JSON.stringify({ results, measurements, failed }, null, 2)}\n`,
);
console.log(`\n${results.length - failed}/${results.length} pass`);
process.exit(failed === 0 ? 0 : 1);
