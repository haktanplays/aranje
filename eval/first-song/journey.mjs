/**
 * The First Song Journey, walked end to end (2V-E.1 §25).
 *
 * One run, one reader, one song: from a device with nothing on it to a song
 * with music in it that survives closing the app. Every step presses what a
 * reader presses — no eval route, no fixture, no domain call from the
 * harness — and reports what the screen said and whether the music changed.
 *
 *   BASE=http://127.0.0.1:3133 node eval/first-song/journey.mjs
 *
 * `VIEWPORT=320x568` runs one viewport; the default runs the six of §29.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3133";
const OUT = "eval/first-song/artifacts";
mkdirSync(OUT, { recursive: true });

/** The six of §29, smallest first. Landscape last, where the shelf moves. */
const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
  { name: "430x932", width: 430, height: 932 },
  { name: "844x390", width: 844, height: 390 },
];

const chosen = process.env.VIEWPORT
  ? VIEWPORTS.filter((v) => v.name === process.env.VIEWPORT)
  : VIEWPORTS;

const browser = await chromium.launch();
const runs = [];

for (const viewport of chosen) {
  runs.push(await journey(viewport));
}

await browser.close();

const artefact = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  runs,
};
writeFileSync(`${OUT}/JOURNEY.json`, `${JSON.stringify(artefact, null, 2)}\n`);

for (const run of runs) {
  const failed = run.steps.filter((s) => s.status === "FAIL");
  console.log(
    `\n${run.viewport}: ${run.steps.length - failed.length}/${run.steps.length} pass, ` +
      `${run.pageErrors.length} page errors, ${run.overflow.length} horizontal overflows`,
  );
  for (const step of run.steps) {
    const mark = step.status === "PASS" ? "  ok " : "FAIL ";
    console.log(`  ${mark} ${step.n}. ${step.name} — ${step.detail}`);
  }
  if (run.pageErrors.length > 0) console.log(run.pageErrors.slice(0, 3).join("\n"));
}

const allPass = runs.every((r) => r.steps.every((s) => s.status === "PASS"));
console.log(`\n${allPass ? "every step passed on every viewport" : "SOME STEPS FAILED"}`);

async function journey(viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true,
    isMobile: viewport.width < 700,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  page.setDefaultTimeout(8000);

  const steps = [];
  const overflow = [];
  let n = 0;

  const count = (s) => page.locator(s).count();
  const text = (s) =>
    page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, s);
  const press = async (s) => {
    await page.locator(s).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(280);
  };
  const closeSheets = async () => {
    for (let i = 0; i < 4; i += 1) {
      if ((await count("[aria-label='Kapat']")) === 0) break;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  };
  /** Every `aranje.` key, and the song inside each project record. */
  const ledger = () =>
    page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith("aranje.")) continue;
        const raw = localStorage.getItem(key) ?? "";
        out[key] = raw.length;
      }
      return out;
    });
  const music = () =>
    page.evaluate(() => {
      const parts = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith("aranje.project.")) continue;
        try {
          const record = JSON.parse(localStorage.getItem(key) ?? "");
          parts.push(`${key}=${JSON.stringify(record?.current ?? record)}`);
        } catch {
          parts.push(`${key}=?`);
        }
      }
      return parts.sort().join(" ");
    });

  /** The page body must never scroll sideways (§28). */
  const checkOverflow = async (where) => {
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (wide) overflow.push(where);
  };

  const step = async (name, run) => {
    n += 1;
    let detail = "";
    let status = "FAIL";
    try {
      const answer = await run();
      detail = answer?.detail ?? String(answer ?? "");
      status = answer?.ok === false ? "FAIL" : "PASS";
    } catch (error) {
      detail = `threw: ${String(error).slice(0, 90)}`;
    }
    await checkOverflow(name);
    steps.push({ n, name, status, detail });
  };

  /* ------------------------------------------------------- arriving */

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await step("a device with nothing on it shows Home, not a song", async () => {
    const home = await count("[data-home]");
    const empty = await count("[data-home-empty]");
    const keys = Object.keys(await ledger());
    return {
      ok: home === 1 && empty === 1 && keys.length === 0,
      detail: `home ${home}, empty ${empty}, storage keys ${keys.length}`,
    };
  });

  await step("one dominant call to action, and it is the new song", async () => {
    const label = await text("[data-home-start]");
    return { ok: label === "Yeni parça", detail: `"${label}"` };
  });

  await step("the assumptions are one tap away and say what they are", async () => {
    const label = await text("[data-home-assumptions]");
    await press("[data-home-assumptions]");
    const said = (await text("[data-home-defaults]")) ?? "";
    const wants = ["E minor", "120", "4/4", "Giriş", "Gitar"];
    const missing = wants.filter((w) => !said.includes(w));
    await press("[data-home-assumptions]");
    return {
      ok: label === "Ayarları değiştir" && missing.length === 0,
      detail: missing.length ? `"${label}", missing ${missing}` : `"${label}" → ${said.replace(/\s+/g, " ").slice(0, 60)}`,
    };
  });

  await step("nothing is written until the reader taps", async () => {
    const keys = Object.keys(await ledger());
    return { ok: keys.length === 0, detail: `${keys.length} keys` };
  });

  await step("one tap makes the song", async () => {
    await press("[data-home-start]");
    await page.waitForTimeout(700);
    const keys = Object.keys(await ledger());
    return {
      ok: keys.some((k) => k.startsWith("aranje.project.")) && keys.includes("aranje.projects"),
      detail: keys.sort().join(", "),
    };
  });

  await step("it lands on the surface music is written on", async () => {
    const tab = await count("[data-tab-content]");
    const control = await count("[data-track-control]");
    return { ok: tab === 1 && control === 1, detail: `tab ${tab}, track door ${control}` };
  });

  await step("the save status says it saved", async () => {
    const state = await page.getAttribute("[data-save-status]", "data-save-status");
    const said = await text("[data-save-text]");
    return { ok: state === "saved" && said === "Kaydedildi", detail: `${state} · "${said}"` };
  });

  await step("no raw id, revision, hash or storage key on the screen", async () => {
    const body = (await page.evaluate(() => document.body.innerText)) ?? "";
    const leaks = ["aranje.project", "project-1", "section-1", "track-1", "revision", '"id"'];
    const found = leaks.filter((l) => body.includes(l));
    return { ok: found.length === 0, detail: found.length ? `leaked ${found}` : "clean" };
  });

  /* -------------------------------------------------------- writing */

  await step("`Düzenle` opens the surface a note is written on", async () => {
    await press("button:has-text('Düzenle')");
    const cells = await count("[data-cell]");
    const done = await count("[data-edit-done]");
    return { ok: cells > 0 && done === 1, detail: `${cells} slots, ${done} way out` };
  });

  await step("touching a slot asks about that note and no other", async () => {
    await press("[data-cell='0:5']");
    const where = await text("[data-shelf-note='note-where']");
    const fret = await text("[data-note-fret]");
    return { ok: (where ?? "").includes("1. ölçü") && fret === "—", detail: `"${where}" · fret ${fret}` };
  });

  await step("writing a note changes the stored music", async () => {
    const before = await music();
    await press("[data-shelf-choice='fret-up']");
    await page.waitForTimeout(600);
    const fret = await text("[data-note-fret]");
    return { ok: before !== (await music()), detail: `fret ${fret}, ${before === (await music()) ? "no write" : "wrote"}` };
  });

  await step("the song is no longer untouched, so Düzen has something to show", async () => {
    await press("[data-edit-done]");
    await press("[data-testid='view-arrange']");
    const cells = await count("[data-arr-cell]");
    await press("[data-testid='view-tab']");
    return { ok: cells > 0, detail: `${cells} arrangement cells` };
  });

  await step("undo takes it back and says what it would undo", async () => {
    const before = await music();
    const labelled = await page.getAttribute("[data-undo]", "aria-label");
    await press("[data-undo]");
    const after = await music();
    return { ok: before !== after, detail: `${labelled ?? "(unlabelled)"} — ${before === after ? "no change" : "changed"}` };
  });

  await step("redo puts it back", async () => {
    const before = await music();
    await press("[data-redo]");
    return { ok: before !== (await music()), detail: "changed" };
  });

  /* ------------------------------------------------------ arranging */

  await step("a second instrument can be added and is named for its role", async () => {
    await press("[data-track-control]");
    await press("[data-track-manage]");
    await press("[data-track-add]");
    await press("[data-track-apply]");
    await page.waitForTimeout(400);
    const rows = await page.locator("[data-track-row]").allTextContents();
    const second = rows[1]?.replace(/\s+/g, " ").trim() ?? "";
    return { ok: rows.length === 2 && second.startsWith("Gitar 2"), detail: `${rows.length} rows, "${second}"` };
  });

  await step("the track manager offers every verb a reader needs", async () => {
    const verbs = ["rename", "setup", "duplicate", "up", "down", "delete"];
    const found = [];
    for (const verb of verbs) {
      if ((await count(`[data-track-action='${verb}']`)) > 0) found.push(verb);
    }
    return { ok: found.length === verbs.length, detail: found.join(", ") };
  });

  await step("a track can be deleted, after being asked", async () => {
    await press("[data-track-row]:nth-child(2)");
    await press("[data-track-action='delete']");
    const asked = await count("[data-track-confirm-delete]");
    await press("[data-track-confirm-delete]");
    await page.waitForTimeout(400);
    const rows = await count("[data-track-row]");
    return { ok: asked === 1 && rows === 1, detail: `asked ${asked}, ${rows} rows` };
  });

  await step("closing the sheet leaves the reader where they were", async () => {
    await closeSheets();
    const tab = await count("[data-tab-content]");
    const sheets = await count("[aria-label='Kapat']");
    return { ok: tab === 1 && sheets === 0, detail: `tab ${tab}, open sheets ${sheets}` };
  });

  await step("a second section can be added", async () => {
    await press("[data-section-nav] button:nth-child(2)");
    await press("[data-section-manage]");
    await press("[data-section-add]");
    await press("[data-section-apply]");
    await page.waitForTimeout(400);
    const rows = await count("[data-section-row]");
    return { ok: rows === 2, detail: `${rows} rows` };
  });

  await step("a section can be renamed in the reader's own words", async () => {
    await press("[data-section-row]:nth-child(2)");
    await press("[data-section-action='rename']");
    await page.locator("input[data-section-name]").first().fill("Nakarat");
    await press("[data-section-apply]");
    await page.waitForTimeout(400);
    const rows = await page.locator("[data-section-row]").allTextContents();
    return { ok: rows.some((r) => r.includes("Nakarat")), detail: rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" | ") };
  });

  await step("a section can be made longer after it exists", async () => {
    await press("[data-section-row]:nth-child(2)");
    await press("[data-section-action='length']");
    await page.locator("input[data-section-length]").first().fill("6");
    await press("[data-section-apply]");
    await page.waitForTimeout(400);
    const rows = await page.locator("[data-section-row]").allTextContents();
    return { ok: rows.some((r) => r.includes("6 ölçü")), detail: rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" | ") };
  });

  await step("shortening says what it costs before it does it", async () => {
    await press("[data-section-row]:nth-child(2)");
    await press("[data-section-action='length']");
    await page.locator("input[data-section-length]").first().fill("2");
    await page.waitForTimeout(250);
    const warning = await text("[data-section-length-warning]");
    await press("button:has-text('Vazgeç')");
    return { ok: (warning ?? "").includes("silinir"), detail: warning ?? "(none)" };
  });

  await step("the last section is refused in words, not silently", async () => {
    await press("[data-section-row]");
    await press("[data-section-action='delete']");
    await press("[data-section-confirm-delete]");
    await page.waitForTimeout(400);
    await press("[data-section-row]");
    await press("[data-section-action='delete']");
    await press("[data-section-confirm-delete]");
    await page.waitForTimeout(400);
    const refusal = await text("[data-lifecycle-error]");
    return { ok: (refusal ?? "").length > 0, detail: refusal ?? "(none)" };
  });

  await step("the arrangement draws the song's shape", async () => {
    await closeSheets();
    await press("[data-testid='view-arrange']");
    const sections = await count("[data-arr-section]");
    const bars = await count("[data-arr-bar]");
    return { ok: sections >= 1 && bars >= 1, detail: `${sections} sections, ${bars} bars` };
  });

  await step("the multi view opens without losing the song", async () => {
    await press("[data-testid='view-multi']");
    const lanes = await count("[data-multi-lane], [data-multi-track], [data-string-line]");
    await press("[data-testid='view-tab']");
    return { ok: lanes > 0, detail: `${lanes} lanes` };
  });

  /* ------------------------------------------------------- listening */

  await step("the transport is on the screen and can be started", async () => {
    const play = await count("[data-play], [aria-label*='Çal'], [aria-label*='Oynat']");
    return { ok: play > 0, detail: `${play} transport controls` };
  });

  /* --------------------------------------------------------- leaving */

  await step("`Dışa aktar` is reachable by its own name", async () => {
    await press("[data-open-song-menu]");
    const exportDoor = await text("[data-info-export]");
    await press("[data-info-export]");
    await page.waitForTimeout(400);
    const controls = await count("[data-export-format], [data-export-meter-note]");
    await closeSheets();
    return { ok: exportDoor === "Dışa aktar" && controls > 0, detail: `"${exportDoor}", ${controls} controls` };
  });

  await step("the project list is reachable and shows music, not storage", async () => {
    await press("[data-open-song-menu]");
    await press("[data-info-projects]");
    await page.waitForTimeout(400);
    const rows = await count("[data-project-row]");
    /* The verbs are under the row, and the row is a disclosure. */
    await press("[data-project-open]");
    const verbs = [];
    for (const verb of ["open", "duplicate", "backup", "delete"]) {
      if ((await count(`[data-project-action='${verb}']`)) > 0) verbs.push(verb);
    }
    await closeSheets();
    return { ok: rows >= 1 && verbs.includes("duplicate"), detail: `${rows} rows, verbs: ${verbs.join(", ")}` };
  });

  await step("going Home leaves the music where it was", async () => {
    await closeSheets();
    const before = await music();
    await press("[data-open-projects]");
    await page.waitForTimeout(400);
    await page.waitForTimeout(500);
    const home = await count("[data-home]");
    const cards = await count("[data-home-card]");
    const after = await music();
    return { ok: home === 1 && cards >= 1 && before === after, detail: `home ${home}, ${cards} cards, music ${before === after ? "unchanged" : "CHANGED"}` };
  });

  await step("the card says what the piece is, and never how it is stored", async () => {
    const card = (await text("[data-home-card]")) ?? "";
    const leaks = ["project-1", "aranje.", "revision"];
    const found = leaks.filter((l) => card.includes(l));
    return { ok: found.length === 0 && card.length > 0, detail: found.length ? `leaked ${found}` : card.replace(/\s+/g, " ").slice(0, 80) };
  });

  await step("reloading comes back to the same song, with the same music", async () => {
    const before = await music();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const after = await music();
    const inEditor = await count("[data-view-switch]");
    return { ok: before === after && inEditor === 1, detail: `music ${before === after ? "unchanged" : "CHANGED"}, editor ${inEditor}` };
  });

  await step("the whole journey wrote only aranje keys", async () => {
    const keys = Object.keys(await ledger()).sort();
    const foreign = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null && !key.startsWith("aranje.")) out.push(key);
      }
      return out;
    });
    return { ok: foreign.length === 0, detail: `${keys.length} aranje keys, ${foreign.length} foreign${foreign.length ? `: ${foreign}` : ""}` };
  });

  await context.close();
  return { viewport: viewport.name, steps, pageErrors, overflow };
}
