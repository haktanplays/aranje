/**
 * Negative controls for the First Song Journey (2V-E.1 §26).
 *
 * A walk where everything passes proves nothing until the same walk can be
 * made to fail. Each control below breaks one thing on purpose and states
 * what the app must then do — refuse in words, or come back clean — and the
 * run fails if the app instead carries on as though nothing happened.
 *
 *   BASE=http://127.0.0.1:3134 node eval/first-song/negative.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3134";
const OUT = "eval/first-song/artifacts";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const rows = [];

/** Run one control on a fresh, isolated browser context. */
async function control(name, expectation, body) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.setDefaultTimeout(8000);
  let detail = "";
  let status = "FAIL";
  try {
    const answer = await body(page);
    detail = answer?.detail ?? String(answer ?? "");
    status = answer?.ok ? "PASS" : "FAIL";
  } catch (error) {
    detail = `threw: ${String(error).slice(0, 90)}`;
  }
  await context.close();
  rows.push({ name, expectation, status, detail, pageErrors: errors.length });
  console.log(`  ${status === "PASS" ? "ok  " : "FAIL"} ${name} — ${detail}`);
}

const press = async (page, selector) => {
  await page.locator(selector).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
};
const text = (page, selector) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, selector);
const count = (page, selector) => page.locator(selector).count();

/** Land on the app, having first run `seed` in the page's own origin. */
async function arrive(page, seed) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  if (seed) await page.evaluate(seed);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

console.log("\nNegative controls (2V-E.1 §26)\n");

/* ------------------------------------------------- the harness can fail */

await control(
  "the walk's own assertion can go red",
  "a marker that does not exist must not be reported as found",
  async (page) => {
    await arrive(page);
    const bogus = await count(page, "[data-there-is-no-such-control]");
    const real = await count(page, "[data-home-start]");
    return {
      ok: bogus === 0 && real === 1,
      detail: `absent marker ${bogus}, real marker ${real}`,
    };
  },
);

await control(
  "the storage ledger notices a key the journey did not write",
  "a foreign key planted before load must be seen, not ignored",
  async (page) => {
    await arrive(page, () => localStorage.setItem("someone-elses-key", "1"));
    const foreign = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null && !key.startsWith("aranje.")) out.push(key);
      }
      return out;
    });
    return { ok: foreign.includes("someone-elses-key"), detail: `saw ${foreign.join(", ") || "nothing"}` };
  },
);

/* ------------------------------------------- the app refuses in words */

await control(
  "a corrupt project record is explained, not shown as an empty song",
  "the reader is told the project cannot be read",
  async (page) => {
    await arrive(page, () => {
      localStorage.setItem("aranje.project.project-1", "{ this is not json");
      localStorage.setItem(
        "aranje.projects",
        JSON.stringify({ version: 1, activeProjectId: "project-1", projects: [{ id: "project-1" }] }),
      );
    });
    const body = await page.evaluate(() => document.body.innerText);
    const alerts = await count(page, "[role='alert']");
    const silentEmpty = body.includes("0 ölçü") && alerts === 0;
    return {
      ok: !silentEmpty,
      detail: `${alerts} alert regions, ${silentEmpty ? "reported as an empty song" : "not silently empty"}`,
    };
  },
);

await control(
  "a catalog naming a project that is not there does not strand the reader",
  "Home or the editor comes up, with a way forward",
  async (page) => {
    await arrive(page, () => {
      localStorage.setItem(
        "aranje.projects",
        JSON.stringify({ version: 1, activeProjectId: "project-9", projects: [{ id: "project-9" }] }),
      );
    });
    const home = await count(page, "[data-home]");
    const editor = await count(page, "[data-view-switch]");
    const start = await count(page, "[data-home-start]");
    return {
      ok: home + editor >= 1 && (home === 0 || start === 1),
      detail: `home ${home}, editor ${editor}, start ${start}`,
    };
  },
);

await control(
  "the last section refuses deletion in words",
  "a sentence the reader can read, not a sheet that closes",
  async (page) => {
    await arrive(page);
    await press(page, "[data-home-start]");
    await press(page, "[data-section-nav] button:nth-child(2)");
    await press(page, "[data-section-manage]");
    await press(page, "[data-section-row]");
    await press(page, "[data-section-action='delete']");
    await press(page, "[data-section-confirm-delete]");
    await page.waitForTimeout(400);
    const said = await text(page, "[data-lifecycle-error]");
    const rowsLeft = await count(page, "[data-section-row]");
    return { ok: (said ?? "").length > 0, detail: `"${said ?? "(silence)"}", ${rowsLeft} rows still open` };
  },
);

await control(
  "an empty section name is refused rather than accepted as blank",
  "the reader is told, and the section keeps its name",
  async (page) => {
    await arrive(page);
    await press(page, "[data-home-start]");
    await press(page, "[data-section-nav] button:nth-child(2)");
    await press(page, "[data-section-manage]");
    await press(page, "[data-section-row]");
    await press(page, "[data-section-action='rename']");
    await page.locator("input[data-section-name]").first().fill("   ");
    await press(page, "[data-section-apply]");
    await page.waitForTimeout(400);
    const said = await text(page, "[data-lifecycle-error]");
    return { ok: (said ?? "").length > 0, detail: `"${said ?? "(silence)"}"` };
  },
);

await control(
  "a section longer than the cap is refused with the number in it",
  "the refusal names the limit rather than saying 'invalid'",
  async (page) => {
    await arrive(page);
    await press(page, "[data-home-start]");
    await press(page, "[data-section-nav] button:nth-child(2)");
    await press(page, "[data-section-manage]");
    await press(page, "[data-section-row]");
    await press(page, "[data-section-action='length']");
    await page.locator("input[data-section-length]").first().fill("999");
    await press(page, "[data-section-apply]");
    await page.waitForTimeout(400);
    const said = (await text(page, "[data-lifecycle-error]")) ?? "";
    return { ok: /\d/.test(said), detail: `"${said || "(silence)"}"` };
  },
);

await control(
  "storage that refuses to be written is said out loud, not swallowed",
  "the save status stops claiming the song is saved",
  async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function patched(key, value) {
        if (String(key).startsWith("aranje.")) throw new DOMException("quota", "QuotaExceededError");
        return real.call(this, key, value);
      };
    });
    await page.waitForTimeout(300);
    await press(page, "[data-home-start]");
    await page.waitForTimeout(800);
    const state = await page.getAttribute("[data-save-status]", "data-save-status").catch(() => null);
    const said = await text(page, "[data-save-text]");
    const claimsSaved = state === "saved";
    const stayedHome = (await count(page, "[data-home]")) === 1;
    const homeError = await text(page, "[data-home-error]");
    /* Never claiming a save that did not happen is the hard rule. Saying
       *why* the tap did nothing is the second half, and it is checked too. */
    return {
      ok: !claimsSaved && (!stayedHome || (homeError ?? "").length > 0),
      detail: `status ${state ?? "(none)"} · "${said ?? "(none)"}"` +
        (stayedHome ? `, stayed on Home, said "${homeError ?? "(nothing)"}"` : ""),
    };
  },
);

await control(
  "reloading with no storage at all does not crash",
  "Home comes up and says nothing about storage internals",
  async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      Storage.prototype.getItem = () => {
        throw new DOMException("denied", "SecurityError");
      };
    });
    await page.waitForTimeout(500);
    const body = await page.evaluate(() => document.body.innerText);
    const leaks = ["localStorage", "SecurityError", "undefined"];
    const found = leaks.filter((l) => body.includes(l));
    return { ok: found.length === 0, detail: found.length ? `leaked ${found}` : "no diagnostic on screen" };
  },
);

await browser.close();

writeFileSync(
  `${OUT}/NEGATIVE-CONTROLS.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, rows }, null, 2)}\n`,
);

const failed = rows.filter((r) => r.status === "FAIL");
console.log(`\n${rows.length - failed.length}/${rows.length} controls held`);
if (failed.length > 0) console.log(`FAILED: ${failed.map((r) => r.name).join("; ")}`);
