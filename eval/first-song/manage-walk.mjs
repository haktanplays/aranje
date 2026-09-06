/**
 * Track and section management, walked on the production route (2V-E.1 §10–§15).
 *
 * Every step drives the real controls a reader would touch and reports what
 * it found, including how many musical writes it cost. A capability the
 * domain has and the screen cannot reach is written down as missing.
 *
 *   BASE=http://127.0.0.1:3123 node eval/first-song/manage-walk.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3123";
const OUT = "eval/first-song/artifacts";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.setDefaultTimeout(8000);

/** The bytes of the music, so a step can be told what it cost. */
const music = () =>
  page.evaluate(() => {
    const song = (raw) => {
      try {
        const parsed = JSON.parse(raw);
        return JSON.stringify(parsed?.current ?? parsed);
      } catch {
        return raw;
      }
    };
    const parts = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null) continue;
      if (key.startsWith("aranje.project.")) {
        parts.push(`${key}=${song(localStorage.getItem(key) ?? "")}`);
      }
    }
    return parts.sort().join(" ");
  });

const press = async (selector) => {
  await page.locator(selector).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(320);
};
const count = (selector) => page.locator(selector).count();

/** Sheets stack — the manager opens over the picker — so close until none. */
const closeSheets = async () => {
  for (let i = 0; i < 4; i += 1) {
    if ((await count("[aria-label='Kapat']")) === 0) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
};
const text = (selector) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, selector);

const rows = [];
const step = async (name, run) => {
  const before = await music();
  let detail = "";
  try {
    detail = (await run()) ?? "";
  } catch (error) {
    detail = `threw: ${String(error).slice(0, 80)}`;
  }
  const after = await music();
  const wrote = before !== after;
  rows.push({ name, wrote, detail });
  console.log(`  ${wrote ? "WROTE" : "  -  "}  ${name}${detail ? ` — ${detail}` : ""}`);
};

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await press("[data-home-start]");

/* --------------------------------------------------------------- tracks */

/*
 * The doors, as the first run of this walk found them.
 *
 * Both live on the reading surfaces and neither exists on the arrangement:
 * `TrackControl` renders only when the view is not "arrange", and the section
 * stepper is deliberately absent there because the arrangement draws every
 * section already. The first run opened on the arrangement and every step
 * below reached nothing — which is recorded in the artefact rather than
 * papered over, because it is the finding, not the harness's mistake.
 */
const toTab = async () => {
  if ((await count("[data-track-control]")) === 0) await press("[data-testid='view-tab']");
};

const openTracks = async () => {
  if ((await count("[data-track-row]")) > 0) return;
  await toTab();
  await press("[data-track-control]");
  await press("[data-track-manage]");
};

await step("open the track manager", async () => {
  await openTracks();
  return `${await count("[data-track-row]")} track rows`;
});

await step("add an instrument", async () => {
  /* "Yeni track" opens a setup form over the list; the row appears on apply. */
  await press("[data-track-add]");
  const form = await count("[data-track-instrument]");
  await press("[data-track-apply]");
  await page.waitForTimeout(400);
  return `${form} instrument choosers, ${await count("[data-track-row]")} rows now`;
});

await step("the second track is named for its instrument", async () =>
  (await page.locator("[data-track-row]").last().textContent())
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 60),
);

await step("change the second track's instrument, tuning and capo", async () => {
  await press("[data-track-row]:nth-child(2)");
  await press("[data-track-action='setup']");
  const tunings = await count("[data-track-tuning]");
  const capos = await count("[data-track-capo]");
  await press("[data-track-apply]");
  await page.waitForTimeout(400);
  if ((await count("[data-track-confirm-destructive]")) > 0) {
    await press("[data-track-confirm-destructive]");
  }
  return `${tunings} tuning, ${capos} capo controls`;
});

await step("duplicate a track", async () => {
  await press("[data-track-row]");
  await press("[data-track-action='duplicate']");
  await page.waitForTimeout(400);
  return `${await count("[data-track-row]")} rows`;
});

await step("reorder a track", async () => {
  const before = await page.locator("[data-track-row]").first().getAttribute("data-track-row");
  await press("[data-track-row]");
  await press("[data-track-action='down']");
  const after = await page.locator("[data-track-row]").first().getAttribute("data-track-row");
  return `first row ${before} → ${after}`;
});

await step("delete a track", async () => {
  const before = await count("[data-track-row]");
  await press("[data-track-row]");
  await press("[data-track-action='delete']");
  const confirm = await count("[data-track-confirm-delete]");
  if (confirm > 0) await press("[data-track-confirm-delete]");
  await page.waitForTimeout(400);
  return `${confirm > 0 ? "confirmed" : "no confirmation"}, ${before} → ${await count("[data-track-row]")} rows`;
});

await step("the track limit is refused in words", async () => {
  /* Add until the app stops us, then read what it said and come back to the
     list — a walk that leaves a sheet in a half-filled form is measuring its
     own state from then on rather than the app's. */
  let added = 0;
  for (let i = 0; i < 10; i += 1) {
    if ((await count("[data-track-add]")) === 0) break;
    await press("[data-track-add]");
    await press("[data-track-apply]");
    await page.waitForTimeout(250);
    if ((await count("[data-track-row]")) > 0) added += 1;
    else break;
  }
  const refusal = (await text("[data-lifecycle-error]")) ?? (await text("[role='alert']"));
  if ((await count("[data-track-row]")) === 0) await press("button:has-text('Vazgeç')");
  await openTracks();
  const rowsNow = await count("[data-track-row]");
  return `${added} added, ${rowsNow} rows, refusal: ${refusal ?? "(none)"}`;
});

await closeSheets();

/* -------------------------------------------------------------- sections */

const openSections = async () => {
  if ((await count("[data-section-row]")) > 0) return;
  await toTab();
  /* The stepper's middle button is the list: a jump of more than one step. */
  await press("[data-section-nav] button:nth-child(2)");
  await press("[data-section-manage]");
};

await step("open the section manager", async () => {
  await openSections();
  return `${await count("[data-section-row]")} section rows`;
});

await step("add a section", async () => {
  await press("[data-section-add]");
  const named = await count("[data-section-name]");
  const bars = await count("[data-section-bars]");
  const meter = await count("[data-section-meter]");
  await press("[data-section-apply]");
  await page.waitForTimeout(400);
  return `create form: ${named} name, ${bars} bar count, ${meter} meter; ${await count("[data-section-row]")} rows now`;
});

await step("duplicate a section", async () => {
  await press("[data-section-row]");
  await press("[data-section-action='duplicate']");
  await page.waitForTimeout(400);
  return `${await count("[data-section-row]")} rows`;
});

await step("rename a section", async () => {
  await press("[data-section-row]");
  await press("[data-section-action='rename']");
  await page.locator("input[data-section-name]").first().fill("Nakarat").catch(() => {});
  await press("[data-section-apply]");
  await page.waitForTimeout(400);
  const names = await page.locator("[data-section-row]").allTextContents();
  return names.map((n) => n.replace(/\s+/g, " ").trim().split(" ")[0]).join(", ");
});

await step("reorder a section", async () => {
  const before = await page.locator("[data-section-row]").first().getAttribute("data-section-row");
  await press("[data-section-row]");
  await press("[data-section-action='down']");
  const after = await page.locator("[data-section-row]").first().getAttribute("data-section-row");
  return `first row ${before} → ${after}`;
});

await step("make a section longer after it exists", async () => {
  await press("[data-section-row]");
  await press("[data-section-action='length']");
  const field = await count("input[data-section-length]");
  await page.locator("input[data-section-length]").first().fill("6").catch(() => {});
  await press("[data-section-apply]");
  await page.waitForTimeout(400);
  return `${field} length fields, rows now: ${(await page.locator("[data-section-row]").first().textContent())?.replace(/\s+/g, " ").trim()}`;
});

await step("shortening warns before it drops music", async () => {
  await press("[data-section-row]");
  await press("[data-section-action='length']");
  await page.locator("input[data-section-length]").first().fill("2").catch(() => {});
  await page.waitForTimeout(250);
  const warning = await text("[data-section-length-warning]");
  await press("[data-section-apply]");
  await page.waitForTimeout(400);
  return `warning: ${warning ?? "(none)"}`;
});

await step("set a section's own tempo", async () => {
  await openSections();
  await press("[data-section-row]");
  await press("[data-section-action='tempo']");
  await page.locator("input[data-section-tempo]").first().fill("96").catch(() => {});
  await press("[data-section-apply]");
  await page.waitForTimeout(400);
  return `${await count("[data-section-row]")} rows`;
});

await step("delete a section", async () => {
  const before = await count("[data-section-row]");
  await press("[data-section-row]");
  await press("[data-section-action='delete']");
  const confirm = await count("[data-section-confirm-delete]");
  if (confirm > 0) await press("[data-section-confirm-delete]");
  await page.waitForTimeout(400);
  return `${confirm > 0 ? "confirmed" : "no confirmation"}, ${before} → ${await count("[data-section-row]")} rows`;
});

await closeSheets();

/* ---------------------------------------------------------------- export */

await step("reach export", async () => {
  const direct = await count("[data-open-export]");
  if (direct > 0) {
    await press("[data-open-export]");
  } else {
    await press("[data-open-song-menu]");
    await press("[data-info-export]");
  }
  const sheet = await count("[data-export-meter-note], [data-export-format]");
  return `${direct > 0 ? "one door" : "behind the song menu"}, ${sheet} export controls`;
});

await browser.close();
writeFileSync(
  `${OUT}/MANAGE-WALK.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), pageErrors: errors, rows }, null, 2)}\n`,
);
console.log(`\npage errors: ${errors.length}`);
if (errors.length > 0) console.log(errors.slice(0, 4).join("\n"));
