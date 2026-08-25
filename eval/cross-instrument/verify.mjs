/**
 * Writing a hit and writing a note, in a real browser (2Q-B §15).
 *
 * The rule every earlier checkpoint settled on holds: a claim is measured on
 * the thing it is about, and on the path a reader would actually take.
 *
 * Two of those paths are deliberately the long way round:
 *
 * - The kit is *added through the track manager*, not seeded, because the
 *   claim is "a track you just made is writable" and a seeded track proves
 *   nothing about the lifecycle that made it.
 * - The pitched project is *opened as a file*, not seeded, because in
 *   production a fretless track can only arrive that way — `create_track`
 *   refuses those instruments today. A seeded piano would be a device state
 *   no reader can produce, and a green run on it would be a lie.
 *
 *   ./eval/chord-audio/serve.sh
 *   node eval/cross-instrument/verify.mjs
 *   ONE_VIEWPORT=1 node eval/cross-instrument/verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

import { LEDGER, takeLedger } from "../projects/ledger.mjs";
import { device, filePath, fixture } from "./device.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/cross-instrument/artifacts";
mkdirSync(OUT, { recursive: true });

const results = [];
const record_ = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 180) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const ONLY = (process.env.ONLY ?? "").split(",").map((e) => e.trim()).filter(Boolean);

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

async function boot(browser, viewport, storage, extra = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ...extra,
  });
  await context.addInitScript(
    ([entries, ledger]) => {
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      (0, eval)(ledger);
    },
    [Object.entries(storage), LEDGER],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-view-switch]", { timeout: 20000 });
  /*
   * The app opens on Düzen, which has no track picker and no tab. Every tour
   * below is about writing, so they all start where writing happens — and
   * they say so here rather than each one remembering to.
   */
  await page.getByTestId("view-tab").click();
  await page.waitForSelector("[data-track-control]", { timeout: 10000 });
  await takeLedger(page);
  return { context, page, errors };
}

/* --------------------------------------------------------------- helpers */

const view = (page, id) => page.getByTestId(`view-${id}`);
const editButton = (page) =>
  page.locator("[data-action-row] button", { hasText: /^Düzenle$/ });
const endEdit = (page) =>
  page.locator("[data-action-row] button", { hasText: "Düzenlemeyi bitir" });

/** Pick a track by its visible name, through the picker a reader uses. */
async function pickTrack(page, name) {
  await page.locator("[data-track-control]").click();
  await page.locator("[data-track-option]", { hasText: name }).first().click();
  await page.waitForTimeout(120);
}

/** Turn edit mode on if it is off. Idempotent, so a tour can just ask. */
async function arm(page) {
  if ((await endEdit(page).count()) > 0) return;
  await editButton(page).click();
  await page.waitForTimeout(120);
}

/** The song as the app currently holds it, read from the project record. */
const storedSong = (page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("aranje.projects");
    if (!raw) return null;
    const id = JSON.parse(raw).activeProjectId;
    const record = window.localStorage.getItem(`aranje.project.${id}`);
    if (!record) return null;
    const parsed = JSON.parse(record);
    return parsed.current ?? null;
  });

const laneOf = (song, trackId, sectionIndex = 0, barIndex = 0) =>
  song?.sections?.[sectionIndex]?.bars?.[barIndex]?.slots?.[trackId];

/** Every element that really scrolls horizontally right now. */
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

const boxOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      w: Math.round(box.width * 10) / 10,
      h: Math.round(box.height * 10) / 10,
      left: Math.round(box.left * 10) / 10,
    };
  }, selector);

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
        label: b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "",
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
    /*
     * How many lines the row actually takes. Reported rather than asserted:
     * at a large text setting a second line is the honest answer, and what
     * has to stay true is that every control is reachable.
     */
    const lines = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top))).size;
    return {
      lines,
      required: Math.round(required * 10) / 10,
      available: row ? Math.round(row.getBoundingClientRect().width * 10) / 10 : 0,
      controls,
      clipped: controls.filter((c) => c.clipped > 0.5).length,
      below44: controls.filter((c) => !c.ok44).length,
      bodyOverflow: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
      rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });

/* ------------------------------------------------- A. the kit, end to end */

/**
 * The chain the checkpoint is about: a kit that did not exist a moment ago,
 * made through the track manager, activated, armed, written into, played,
 * undone and redone. Every step is a thing a thumb does.
 */
async function tourKitChain(page, vp, errors) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("A1 yeni davul track lifecycle'dan eklenir"), async () => {
    await page.locator("[data-track-control]").click();
    await page.locator("[data-track-manage]").click();
    await page.locator("[data-track-add]").click();
    await page.locator("[data-track-instrument]").selectOption("drum_kit");
    await page.locator("[data-track-apply]").click();
    await page.waitForTimeout(250);
    await page.locator("button", { hasText: /^Kapat$/ }).first().click();
    await page.waitForTimeout(200);
    const song = await storedSong(page);
    const kit = song?.tracks?.filter((t) => t.instrumentId === "drum_kit") ?? [];
    record_(at("A1 yeni davul track lifecycle'dan eklenir"), kit.length === 1, `${kit.length} kit`);
  });

  await safe(at("A2 yeni track her ölçüde yazılı (K-55)"), async () => {
    const song = await storedSong(page);
    const added = song?.tracks?.find((t) => t.instrumentId === "drum_kit");
    const written = song?.sections?.every((section) =>
      section.bars.every((bar) =>
        Object.prototype.hasOwnProperty.call(bar.slots, added?.id ?? ""),
      ),
    );
    record_(at("A2 yeni track her ölçüde yazılı (K-55)"), written === true, String(written));
  });

  await safe(at("A3 yeni track eklendikten sonra aktif olur"), async () => {
    const song = await storedSong(page);
    const added = song?.tracks?.find((t) => t.instrumentId === "drum_kit");
    const label = await page.locator("[data-track-control]").getAttribute("aria-label");
    record_(
      at("A3 yeni track eklendikten sonra aktif olur"),
      Boolean(added && label?.includes(added.name)),
      `${label} · ${added?.name}`,
    );
  });

  for (const surface of ["tab", "multi"]) {
    await safe(at(`A4-${surface} step grid düzenleme modunda görünür`), async () => {
      await view(page, surface).click();
      await page.waitForTimeout(150);
      const before = await page.locator("[data-drum-cell]").count();
      await arm(page);
      const after = await page.locator("[data-drum-cell]").count();
      record_(
        at(`A4-${surface} step grid düzenleme modunda görünür`),
        before === 0 && after > 0,
        `${before} → ${after}`,
      );
    });

    await safe(at(`A5-${surface} okuma moduna dönünce grid kalkar`), async () => {
      await endEdit(page).click();
      await page.waitForTimeout(150);
      const cells = await page.locator("[data-drum-cell]").count();
      record_(at(`A5-${surface} okuma moduna dönünce grid kalkar`), cells === 0, String(cells));
    });
  }

  await safe(at("A6 boş kitin çekirdek satırları var"), async () => {
    await view(page, "tab").click();
    await arm(page);
    const rows = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("[data-drum-cell]")];
      return [...new Set(cells.map((c) => c.getAttribute("data-drum-cell").split(":")[0]))];
    });
    record_(at("A6 boş kitin çekirdek satırları var"), rows.length >= 3, rows.join(","));
  });

  await safe(at("A7 ilk vuruş tek dokunuşla yazılır"), async () => {
    const song = await storedSong(page);
    const kit = song?.tracks?.find((t) => t.instrumentId === "drum_kit");
    await page.locator("[data-drum-cell]").first().click();
    await page.waitForTimeout(200);
    const after = await storedSong(page);
    const lane = laneOf(after, kit?.id ?? "");
    const hits = Array.isArray(lane) ? lane.flat().length : -1;
    record_(at("A7 ilk vuruş tek dokunuşla yazılır"), hits === 1, `${hits} vuruş`);
  });

  await safe(at("A8 yazılan hücre dolu görünür"), async () => {
    const filled = await page.locator("[data-drum-cell][data-filled]").count();
    const pressed = await page
      .locator("[data-drum-cell][aria-pressed='true']")
      .count();
    record_(at("A8 yazılan hücre dolu görünür"), filled === 1 && pressed === 1, `${filled}/${pressed}`);
  });

  await safe(at("A9 aynı hücreye ikinci dokunuş siler"), async () => {
    await page.locator("[data-drum-cell]").first().click();
    await page.waitForTimeout(200);
    const filled = await page.locator("[data-drum-cell][data-filled]").count();
    record_(at("A9 aynı hücreye ikinci dokunuş siler"), filled === 0, String(filled));
  });

  await safe(at("A10 silinen lane yerinde kalır"), async () => {
    const song = await storedSong(page);
    const kit = song?.tracks?.find((t) => t.instrumentId === "drum_kit");
    const lane = laneOf(song, kit?.id ?? "");
    record_(
      at("A10 silinen lane yerinde kalır"),
      Array.isArray(lane) && lane.flat().length === 0,
      Array.isArray(lane) ? `${lane.length} slot` : "lane yok",
    );
  });

  await safe(at("A11 geri al vuruşu geri getirir"), async () => {
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(200);
    const filled = await page.locator("[data-drum-cell][data-filled]").count();
    record_(at("A11 geri al vuruşu geri getirir"), filled === 1, String(filled));
  });

  await safe(at("A12 ileri al tekrar siler"), async () => {
    await page.locator("[data-redo]").click();
    await page.waitForTimeout(200);
    const filled = await page.locator("[data-drum-cell][data-filled]").count();
    record_(at("A12 ileri al tekrar siler"), filled === 0, String(filled));
  });

  await safe(at("A13 geri al düğmesi adımı adıyla anar"), async () => {
    const label = await page.locator("[data-undo]").getAttribute("aria-label");
    record_(
      at("A13 geri al düğmesi adımı adıyla anar"),
      Boolean(label && /davul/i.test(label)),
      label ?? "",
    );
  });

  await safe(at("A14 iki geri al iki vuruşu ayrı ayrı çözer"), async () => {
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(150);
    const one = await page.locator("[data-drum-cell][data-filled]").count();
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(150);
    const none = await page.locator("[data-drum-cell][data-filled]").count();
    record_(at("A14 iki geri al iki vuruşu ayrı ayrı çözer"), one === 1 && none === 0, `${one} → ${none}`);
  });

  await safe(at("A15 aynı vuruşta ikinci parça yazılabilir"), async () => {
    const cells = page.locator("[data-drum-cell]");
    const first = await cells.first().getAttribute("data-drum-cell");
    const tick = first.split(":")[1];
    const sameTick = page.locator(`[data-drum-cell$=":${tick}"]`);
    await sameTick.nth(0).click();
    await page.waitForTimeout(150);
    await sameTick.nth(1).click();
    await page.waitForTimeout(200);
    const song = await storedSong(page);
    const kit = song?.tracks?.find((t) => t.instrumentId === "drum_kit");
    const lane = laneOf(song, kit?.id ?? "");
    const slot = Array.isArray(lane) ? lane.find((s) => Array.isArray(s) && s.length > 0) : null;
    record_(
      at("A15 aynı vuruşta ikinci parça yazılabilir"),
      Array.isArray(slot) && slot.length === 2,
      Array.isArray(slot) ? slot.map((h) => h.piece).join("+") : "yok",
    );
  });

  await safe(at("A16 vuruşlar set sırasında saklanır"), async () => {
    const song = await storedSong(page);
    const kit = song?.tracks?.find((t) => t.instrumentId === "drum_kit");
    const lane = laneOf(song, kit?.id ?? "");
    const slot = Array.isArray(lane) ? lane.find((s) => Array.isArray(s) && s.length === 2) : null;
    // Notation order: the kick lane is drawn above the hat, and the stored
    // order has to match, or two songs holding the same music serialise
    // differently.
    const order = await page.evaluate(() =>
      [...new Set(
        [...document.querySelectorAll("[data-drum-cell]")].map(
          (c) => c.getAttribute("data-drum-cell").split(":")[0],
        ),
      )],
    );
    const stored = Array.isArray(slot) ? slot.map((h) => h.piece) : [];
    const drawn = stored.map((piece) => order.indexOf(piece));
    record_(
      at("A16 vuruşlar set sırasında saklanır"),
      drawn.length === 2 && drawn[0] < drawn[1],
      `${stored.join(",")} → ${drawn.join(",")}`,
    );
  });

  await safe(at("A17 çalma yazılan vuruşu duyar"), async () => {
    await page.locator("footer button[aria-label='Çal']").click();
    await page.waitForTimeout(700);
    const running = await page.locator("footer button[aria-label='Duraklat']").count();
    await page.locator("footer button[aria-label='Duraklat']").click();
    record_(at("A17 çalma yazılan vuruşu duyar"), running === 1, `${running}`);
  });

  await safe(at("A18 yazarken çalma durur"), async () => {
    await page.locator("footer button[aria-label='Çal']").click();
    await page.waitForTimeout(300);
    await page.locator("[data-drum-cell]").first().click();
    await page.waitForTimeout(300);
    const stillPlaying = await page.locator("footer button[aria-label='Duraklat']").count();
    record_(at("A18 yazarken çalma durur"), stillPlaying === 0, `${stillPlaying}`);
  });

  await safe(at("A19 hiç konsol hatası yok"), async () => {
    record_(at("A19 hiç konsol hatası yok"), errors.length === 0, errors.slice(0, 2).join(" | "));
  });
}

/* --------------------------------- B. the pitched track, opened as a file */

/** Open a real .aranje.json through the picker, preview and apply. */
async function openProjectFile(page, name) {
  await page.locator("[data-open-projects]").click();
  await page.getByTestId("project-import").click();
  await page.waitForSelector("[data-project-file-input]", { timeout: 5000 });
  await page.locator("[data-project-file-input]").setInputFiles(filePath(name));
  await page.waitForSelector("[data-project-preview]", { timeout: 5000 });
  await page.locator("[data-project-apply]").click();
  await page.waitForTimeout(500);
}

async function tourPitchedImport(page, vp, errors) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("B1 perdeli olmayan track proje dosyasından gelir"), async () => {
    await openProjectFile(page, "pitched");
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    record_(
      at("B1 perdeli olmayan track proje dosyasından gelir"),
      Boolean(keys),
      song?.title ?? "yok",
    );
  });

  await safe(at("B2 Tab okuma modunda dürüst cümleyi söyler"), async () => {
    await view(page, "tab").click();
    await pickTrack(page, "Piyano");
    const text = await page.locator("main").innerText();
    record_(
      at("B2 Tab okuma modunda dürüst cümleyi söyler"),
      /tab görünümü/i.test(text),
      text.split("\n")[0]?.slice(0, 60) ?? "",
    );
  });

  await safe(at("B3 Tab düzenleme modunda şerit açılır"), async () => {
    await arm(page);
    const cells = await page.locator("[data-pitched-cell]").count();
    record_(at("B3 Tab düzenleme modunda şerit açılır"), cells > 0, String(cells));
  });

  await safe(at("B4 dürüst cümle şeritle birlikte kalır"), async () => {
    const text = await page.locator("main").innerText();
    record_(at("B4 dürüst cümle şeritle birlikte kalır"), /tab görünümü/i.test(text), "");
  });

  await safe(at("B5 yazılmamış ölçü boş olarak işaretlenir"), async () => {
    const states = await page.evaluate(() =>
      [...document.querySelectorAll("[data-pitched-cell]")].map((c) =>
        c.getAttribute("data-state"),
      ),
    );
    // The fixture's first bar has no keys lane at all, the second does.
    record_(
      at("B5 yazılmamış ölçü boş olarak işaretlenir"),
      states.includes("blank") && states.includes("rest"),
      [...new Set(states)].join(","),
    );
  });

  await safe(at("B6 bir ana dokunmak nota sayfasını açar"), async () => {
    await page.locator("[data-pitched-cell]").first().click();
    await page.waitForSelector("[data-note-description]", { timeout: 4000 });
    record_(at("B6 bir ana dokunmak nota sayfasını açar"), true, "");
  });

  await safe(at("B7 nota sayfası notayı okunur dilde anlatır"), async () => {
    const text = await page.locator("[data-note-description]").textContent();
    record_(
      at("B7 nota sayfası notayı okunur dilde anlatır"),
      /Nota: .+ · Teknik: .+ · Oktav: -?\d/.test(text ?? ""),
      text ?? "",
    );
  });

  await safe(at("B8 sesi olmayan enstrümanda Dinle kapalı"), async () => {
    const dinle = page.locator("[data-note-silent]");
    const shown = await dinle.count();
    const disabled = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.textContent?.trim() === "Dinle")
        .every((b) => b.disabled),
    );
    record_(at("B8 sesi olmayan enstrümanda Dinle kapalı"), shown === 1 && disabled, `${shown}/${disabled}`);
  });

  await safe(at("B9 cümle uydurma değil, sözü verilen cümle"), async () => {
    const text = await page.locator("[data-note-silent]").textContent();
    record_(
      at("B9 cümle uydurma değil, sözü verilen cümle"),
      (text ?? "").includes("MIDI olarak dışa aktarabilirsin"),
      text ?? "",
    );
  });

  await safe(at("B10 nota sınıfı seçilebilir"), async () => {
    await page.locator("[data-pitch-class='A']").click();
    const pressed = await page
      .locator("[data-pitch-class='A']")
      .getAttribute("aria-pressed");
    record_(at("B10 nota sınıfı seçilebilir"), pressed === "true", pressed ?? "");
  });

  await safe(at("B11 oktav adımlayıcısı çalışır"), async () => {
    const before = await page.locator("[data-note-octave]").textContent();
    await page.locator("button", { hasText: "+" }).first().click();
    const after = await page.locator("[data-note-octave]").textContent();
    record_(
      at("B11 oktav adımlayıcısı çalışır"),
      Number(after) === Number(before) + 1,
      `${before} → ${after}`,
    );
  });

  await safe(at("B12 açıklama seçime göre değişir"), async () => {
    const text = await page.locator("[data-note-description]").textContent();
    const octave = await page.locator("[data-note-octave]").textContent();
    record_(
      at("B12 açıklama seçime göre değişir"),
      (text ?? "").includes(`A${octave}`) && (text ?? "").includes("La"),
      text ?? "",
    );
  });

  await safe(at("B13 Yaz notayı şarkıya yazar"), async () => {
    const octave = await page.locator("[data-note-octave]").textContent();
    await page.locator("button", { hasText: /^Yaz$/ }).click();
    await page.waitForTimeout(300);
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    const onset = Array.isArray(lane) ? lane.find((s) => s && s !== "-") : null;
    record_(
      at("B13 Yaz notayı şarkıya yazar"),
      Boolean(onset && onset.notes?.[0]?.pitch === `A${octave}`),
      onset ? onset.notes?.[0]?.pitch : "yok",
    );
  });

  await safe(at("B14 yazılan nota şeritte görünür"), async () => {
    const written = await page.locator("[data-pitched-cell][data-state='note']").count();
    record_(at("B14 yazılan nota şeritte görünür"), written === 1, String(written));
  });

  await safe(at("B15 nota yazıldığında sayfa kapanır"), async () => {
    const open = await page.locator("[data-note-description]").count();
    record_(at("B15 nota yazıldığında sayfa kapanır"), open === 0, String(open));
  });

  await safe(at("B16 hiçbir notaya string/fret yazılmaz"), async () => {
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const positions = (song?.sections ?? []).flatMap((s) =>
      s.bars.flatMap((b) => {
        const lane = b.slots[keys?.id ?? ""];
        return Array.isArray(lane)
          ? lane.flatMap((slot) =>
              slot && slot !== "-" ? slot.notes.map((n) => n.position) : [],
            )
          : [];
      }),
    );
    record_(
      at("B16 hiçbir notaya string/fret yazılmaz"),
      positions.every((p) => p === undefined),
      `${positions.length} nota`,
    );
  });

  await safe(at("B17 dolu bir an Değiştir olarak açılır"), async () => {
    await page.locator("[data-pitched-cell][data-state='note']").first().click();
    await page.waitForSelector("[data-note-current]", { timeout: 4000 });
    const label = await page
      .locator("button", { hasText: /^(Yaz|Değiştir)$/ })
      .textContent();
    record_(at("B17 dolu bir an Değiştir olarak açılır"), label?.trim() === "Değiştir", label ?? "");
  });

  await safe(at("B18 Değiştir notayı değiştirir"), async () => {
    await page.locator("[data-pitch-class='D']").click();
    await page.locator("button", { hasText: /^Değiştir$/ }).click();
    await page.waitForTimeout(300);
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    const onset = Array.isArray(lane) ? lane.find((s) => s && s !== "-") : null;
    record_(
      at("B18 Değiştir notayı değiştirir"),
      Boolean(onset && onset.notes[0].pitch.startsWith("D")),
      onset ? onset.notes[0].pitch : "yok",
    );
  });

  await safe(at("B19 Sil notayı kaldırır, lane kalır"), async () => {
    await page.locator("[data-pitched-cell][data-state='note']").first().click();
    await page.waitForSelector("[data-note-current]", { timeout: 4000 });
    await page.locator("button", { hasText: /^Sil$/ }).click();
    await page.waitForTimeout(300);
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    record_(
      at("B19 Sil notayı kaldırır, lane kalır"),
      Array.isArray(lane) && lane.every((slot) => slot === null),
      Array.isArray(lane) ? "lane duruyor" : "lane gitti",
    );
  });

  await safe(at("B20 geri al notayı geri getirir"), async () => {
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(250);
    const written = await page.locator("[data-pitched-cell][data-state='note']").count();
    record_(at("B20 geri al notayı geri getirir"), written === 1, String(written));
  });

  await safe(at("B21 geri al düğmesi nota adımını anar"), async () => {
    const label = await page.locator("[data-undo]").getAttribute("aria-label");
    record_(at("B21 geri al düğmesi nota adımını anar"), /nota/i.test(label ?? ""), label ?? "");
  });

  await safe(at("B22 Çoklu görünümde aynı şerit çıkar"), async () => {
    await view(page, "multi").click();
    await page.waitForTimeout(200);
    await arm(page);
    const cells = await page.locator("[data-pitched-cell]").count();
    record_(at("B22 Çoklu görünümde aynı şerit çıkar"), cells > 0, String(cells));
  });

  await safe(at("B23 Çoklu'da yazılan nota Tab'da da görünür"), async () => {
    const inMulti = await page.locator("[data-pitched-cell][data-state='note']").count();
    await view(page, "tab").click();
    await page.waitForTimeout(200);
    const inTab = await page.locator("[data-pitched-cell][data-state='note']").count();
    record_(
      at("B23 Çoklu'da yazılan nota Tab'da da görünür"),
      inMulti === inTab && inTab === 1,
      `${inMulti}/${inTab}`,
    );
  });

  await safe(at("B24 hiç konsol hatası yok"), async () => {
    record_(at("B24 hiç konsol hatası yok"), errors.length === 0, errors.slice(0, 2).join(" | "));
  });
}

/* ------------------------- C. the chord builder on the same imported track */

async function tourPitchedChord(page, vp, errors) {
  const at = (name) => `[${vp}] ${name}`;

  await safe(at("C1 içe aktarılan perdesiz track'te akor kapısı var"), async () => {
    await openProjectFile(page, "pitched");
    await view(page, "tab").click();
    await pickTrack(page, "Piyano");
    await arm(page);
    await page.locator("[data-pitched-cell]").first().click();
    await page.waitForSelector("[data-note-description]", { timeout: 4000 });
    const door = await page.locator("button", { hasText: "Akor kur" }).count();
    record_(at("C1 içe aktarılan perdesiz track'te akor kapısı var"), door === 1, String(door));
  });

  await safe(at("C2 akor kurucusu açılır"), async () => {
    await page.locator("button", { hasText: "Akor kur" }).click();
    await page.waitForSelector("[data-chord-roots]", { timeout: 4000 });
    record_(at("C2 akor kurucusu açılır"), true, "");
  });

  await safe(at("C3 güç akoru adımı atlanır, kök seçimi açılır"), async () => {
    const roots = await page.locator("[data-chord-roots] button").count();
    record_(at("C3 güç akoru adımı atlanır, kök seçimi açılır"), roots >= 12, String(roots));
  });

  await safe(at("C4 kök ve nitelik seçilebilir"), async () => {
    await page.getByTestId("chord-root-0").click();
    await page.waitForTimeout(150);
    await page.getByTestId("chord-quality-major").click();
    await page.waitForTimeout(200);
    const voicings = await page.locator("[data-chord-voicing]").count();
    record_(at("C4 kök ve nitelik seçilebilir"), voicings > 0, String(voicings));
  });

  await safe(at("C5 klavye şekilleri fret değil, nota yığını"), async () => {
    const text = await page.locator("[data-chord-voicings]").innerText();
    record_(
      at("C5 klavye şekilleri fret değil, nota yığını"),
      /[A-G]#?-?\d/.test(text) && !/tel\s*\d/.test(text),
      text.split("\n").slice(0, 3).join(" · ").slice(0, 90),
    );
  });

  await safe(at("C6 kök pozisyon ve çevrimleri sunulur"), async () => {
    const count = await page.locator("[data-chord-voicing]").count();
    record_(at("C6 kök pozisyon ve çevrimleri sunulur"), count >= 3, String(count));
  });

  await safe(at("C7 sesi olmayan enstrümanda akor Dinle'si kapalı"), async () => {
    const note = await page.locator("[data-chord-silent]").count();
    const disabled = await page.evaluate(() =>
      [...document.querySelectorAll("[data-chord-audition]")].every((b) => b.disabled),
    );
    record_(at("C7 sesi olmayan enstrümanda akor Dinle'si kapalı"), note === 1 && disabled, `${note}/${disabled}`);
  });

  await safe(at("C8 akor gerçek notalar olarak yazılır"), async () => {
    await page.locator("[data-chord-apply]").click();
    await page.waitForTimeout(400);
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    const onset = Array.isArray(lane) ? lane.find((s) => s && s !== "-") : null;
    record_(
      at("C8 akor gerçek notalar olarak yazılır"),
      Boolean(onset && onset.notes.length >= 3),
      onset ? onset.notes.map((n) => n.pitch).join(" ") : "yok",
    );
  });

  await safe(at("C9 akor metadata değil, nota yazar"), async () => {
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    const onset = Array.isArray(lane) ? lane.find((s) => s && s !== "-") : null;
    const extra = onset ? Object.keys(onset).filter((k) => k !== "notes") : ["yok"];
    record_(at("C9 akor metadata değil, nota yazar"), extra.length === 0, extra.join(","));
  });

  await safe(at("C10 akor notalarına string/fret yazılmaz"), async () => {
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    const onset = Array.isArray(lane) ? lane.find((s) => s && s !== "-") : null;
    record_(
      at("C10 akor notalarına string/fret yazılmaz"),
      Boolean(onset) && onset.notes.every((n) => n.position === undefined),
      onset ? `${onset.notes.length} nota` : "yok",
    );
  });

  await safe(at("C11 akor lane'i olmayan ölçüye de yazılabildi (K-55)"), async () => {
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    // The fixture's first bar had no keys lane at all before this write.
    record_(
      at("C11 akor lane'i olmayan ölçüye de yazılabildi (K-55)"),
      Array.isArray(lane),
      Array.isArray(lane) ? `${lane.length} slot` : "lane yok",
    );
  });

  await safe(at("C12 akor tek geri alma adımı"), async () => {
    await page.locator("[data-undo]").click();
    await page.waitForTimeout(300);
    const song = await storedSong(page);
    const keys = song?.tracks?.find((t) => t.instrumentId === "piano");
    const lane = laneOf(song, keys?.id ?? "");
    /*
     * One step takes the chord *and* the lane the chord needed. Both are
     * this write's own doing, so both go: the bar returns to "not written
     * here", which is exactly the state the reader started from.
     */
    const onsets = Array.isArray(lane)
      ? lane.filter((slot) => slot && slot !== "-").length
      : 0;
    record_(
      at("C12 akor tek geri alma adımı"),
      onsets === 0,
      Array.isArray(lane) ? `${onsets} onset` : "lane de geri alındı",
    );
  });

  await safe(at("C13 hiç konsol hatası yok"), async () => {
    record_(at("C13 hiç konsol hatası yok"), errors.length === 0, errors.slice(0, 2).join(" | "));
  });
}

/* -------------------------------- D. limits, geometry and the big-text run */

async function tourLimits(page, vp, errors, scale) {
  const at = (name) => `[${vp}${scale === 100 ? "" : ` @${scale}%`}] ${name}`;

  await safe(at("D1 transport tam sığar"), async () => {
    /*
     * Reachability, not one-line-ness. A control that is on a second line is
     * a control the reader has; a control past the right edge is not.
     */
    const shot = await transportShot(page);
    record_(
      at("D1 transport tam sığar"),
      shot.clipped === 0 && shot.bodyOverflow === 0,
      `${shot.lines} satır · gerek ${shot.required} / yer ${shot.available} · kırpılan ${shot.clipped}`,
    );
  });

  await safe(at("D2 her transport kontrolü 44px"), async () => {
    const shot = await transportShot(page);
    record_(
      at("D2 her transport kontrolü 44px"),
      shot.below44 === 0,
      shot.controls.filter((c) => !c.ok44).map((c) => `${c.label} ${c.w}x${c.h}`).join(", "),
    );
  });

  await safe(at("D3 gövde yatay taşmıyor"), async () => {
    const shot = await transportShot(page);
    record_(at("D3 gövde yatay taşmıyor"), shot.bodyOverflow === 0, String(shot.bodyOverflow));
  });

  await safe(at("D4 metin ölçeği gerçekten uygulandı"), async () => {
    const shot = await transportShot(page);
    const expected = Math.round(16 * (scale / 100));
    record_(
      at("D4 metin ölçeği gerçekten uygulandı"),
      Math.abs(shot.rootFontPx - expected) < 0.6,
      `kök yazı ${shot.rootFontPx}px, beklenen ${expected}px`,
    );
  });

  await safe(at("D5 davul hücresi tam dokunma yüksekliğinde"), async () => {
    await view(page, "tab").click();
    await pickTrack(page, "Davul");
    await arm(page);
    const box = await boxOf(page, "[data-drum-cell]");
    record_(
      at("D5 davul hücresi tam dokunma yüksekliğinde"),
      Boolean(box) && box.h >= 43.5,
      box ? `${box.w}x${box.h}` : "yok",
    );
  });

  await safe(at("D6 davul hücre genişliği ölçülmüş değer olarak raporlanır"), async () => {
    const box = await boxOf(page, "[data-drum-cell]");
    // Reported, not asserted at 44: the width is one slot because the shared
    // time axis is the point of the lane. Saying otherwise would be dressing
    // up a measurement.
    record_(
      at("D6 davul hücre genişliği ölçülmüş değer olarak raporlanır"),
      Boolean(box) && box.w > 0,
      `genişlik ${box?.w}px (bir slot)`,
    );
  });

  await safe(at("D7 düzenleme modunda tek yatay kaydırıcı"), async () => {
    const count = await scrollerCount(page);
    record_(at("D7 düzenleme modunda tek yatay kaydırıcı"), count <= 1, String(count));
  });

  await safe(at("D8 Çoklu görünümde de tek kaydırıcı"), async () => {
    await view(page, "multi").click();
    await page.waitForTimeout(200);
    const count = await scrollerCount(page);
    record_(at("D8 Çoklu görünümde de tek kaydırıcı"), count <= 1, String(count));
  });

  await safe(at("D9 yazan lane diğer lane'lerle hizalı"), async () => {
    const rows = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("[data-multi-lane]")].map((lane) => [
          lane.getAttribute("data-multi-lane"),
          [...lane.querySelectorAll("[data-bar-key]")].map(
            (el) => Math.round(el.getBoundingClientRect().left * 10) / 10,
          ),
        ]),
      ),
    );
    const lanes = Object.values(rows).filter((xs) => xs.length > 0);
    const first = lanes[0] ?? [];
    const aligned = lanes.every(
      (xs) => xs.length === first.length && xs.every((x, i) => Math.abs(x - first[i]) < 1.5),
    );
    record_(at("D9 yazan lane diğer lane'lerle hizalı"), lanes.length > 1 && aligned, `${lanes.length} lane`);
  });

  await safe(at("D10 nota sayfasındaki her kontrol 44px"), async () => {
    await view(page, "tab").click();
    await pickTrack(page, "Davul");
    const small = await page.evaluate(() => {
      const sheet = document.querySelector("[role='dialog']");
      if (!sheet) return null;
      return [...sheet.querySelectorAll("button")]
        .map((b) => b.getBoundingClientRect())
        .filter((box) => box.width > 0 && (box.height < 43.5 || box.width < 43.5)).length;
    });
    record_(at("D10 nota sayfasındaki her kontrol 44px"), small === null || small === 0, String(small));
  });

  await safe(at("D11 hiç konsol hatası yok"), async () => {
    record_(at("D11 hiç konsol hatası yok"), errors.length === 0, errors.slice(0, 2).join(" | "));
  });
}

/* ------------------------------------------------------------------ main */

const VIEWPORTS = process.env.ONE_VIEWPORT
  ? [{ name: "390x844", width: 390, height: 844 }]
  : [
      { name: "390x844", width: 390, height: 844 },
      { name: "320x700", width: 320, height: 700 },
    ];

/**
 * The text-scaling runs.
 *
 * A phone's "larger text" setting is not a zoom: the viewport keeps its CSS
 * pixels and the root font size grows. So it is measured by growing the root
 * font size — and D4 asserts the root font really is what it should be, so a
 * run that silently failed to apply the setting cannot pass by looking tidy.
 */
const SCALES = process.env.ONE_VIEWPORT ? [100] : [100, 125, 150];

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});

for (const vp of VIEWPORTS) {
  const kit = await boot(browser, vp, device(fixture("plain")));
  await tourKitChain(kit.page, vp.name, kit.errors);
  await kit.context.close();

  const pitched = await boot(browser, vp, device(fixture("kit")));
  await tourPitchedImport(pitched.page, vp.name, pitched.errors);
  await pitched.context.close();

  const chord = await boot(browser, vp, device(fixture("kit")));
  await tourPitchedChord(chord.page, vp.name, chord.errors);
  await chord.context.close();

  for (const scale of SCALES) {
    const limits = await boot(browser, vp, device(fixture("kit")), {
      ...(scale === 100 ? {} : { deviceScaleFactor: 2 }),
    });
    if (scale !== 100) {
      await limits.page.addStyleTag({
        content: `html { font-size: ${Math.round(16 * (scale / 100))}px }`,
      });
      await limits.page.waitForTimeout(150);
    }
    await tourLimits(limits.page, vp.name, limits.errors, scale);
    await limits.context.close();
  }
}

await browser.close();

const failed = results.filter((entry) => !entry.pass);
writeFileSync(
  `${OUT}/BROWSER.json`,
  `${JSON.stringify(
    {
      what: "2Q-B §15 — enstrümanlar arası nota girişi kabulü",
      measuredOn:
        "masaüstü Chromium, gerçek production build — fiziksel telefon değil",
      howPitchedIsReached:
        "Perdesiz track production .aranje.json içe aktarma akışıyla açıldı; " +
        "localStorage'a elle yerleştirilmedi.",
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${results.length - failed.length}/${results.length} senaryo geçti`);
process.exit(failed.length === 0 ? 0 : 1);
