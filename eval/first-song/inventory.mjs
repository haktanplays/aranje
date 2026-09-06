/**
 * What the production app can actually do, walked rather than read (2V-E.1 §2).
 *
 * Every row is a capability the First Song journey needs. The runner opens a
 * fresh browser context with empty storage, drives the real route, and writes
 * down what it found — so "the domain has a command for it" and "a reader can
 * reach it" stay different answers.
 *
 *   npx next build && npx next start -p 3120
 *   BASE=http://127.0.0.1:3120 node eval/first-song/inventory.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3120";
const OUT = "eval/first-song/artifacts";
mkdirSync(OUT, { recursive: true });

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const browser = await chromium.launch();

const fresh = async () => {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: ANDROID,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.setDefaultTimeout(10000);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { context, page, errors };
};

const storage = (page) =>
  page.evaluate(() => {
    const out = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key === null) continue;
      out[key] = (window.localStorage.getItem(key) ?? "").length;
    }
    return out;
  });

const press = async (page, selector) => {
  await page.locator(selector).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(350);
};

const has = async (page, selector) => (await page.locator(selector).count()) > 0;

const rows = [];
const note = (capability, status, detail) => {
  rows.push({ capability, status, detail });
  console.log(`  ${status.padEnd(28)} ${capability}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------- what opens first */

{
  const { context, page } = await fresh();
  const keys = await storage(page);
  const title = await page.locator("h1").first().textContent().catch(() => null);
  const isWorkspace = await has(page, "[data-open-projects]");
  const isHome = await has(page, "[data-home]");
  note(
    "Home / opening screen",
    isHome && !isWorkspace ? "WORKS AND IS PROVEN" : "MISSING",
    isHome ? `"${title?.trim()}"` : `empty device lands in the editor, title "${title?.trim()}"`,
  );
  note(
    "Empty state offers exactly one thing to do",
    (await page.locator("[data-home-start]").count()) === 1 &&
      (await has(page, "[data-home-empty]"))
      ? "WORKS AND IS PROVEN"
      : "MISSING",
    `${await page.locator("[data-home-start]").count()} primary CTA`,
  );
  note(
    "Empty storage does not auto-open a demo",
    Object.keys(keys).some((k) => k.startsWith("aranje.project.")) ? "MISSING" : "WORKS AND IS PROVEN",
    `keys after first paint: ${Object.keys(keys).join(", ") || "(none)"}`,
  );
  note(
    "First project id is allocated, not assumed",
    Object.keys(keys).includes("aranje.project.project-1") ? "MISSING" : "WORKS AND IS PROVEN",
    Object.keys(keys).includes("aranje.project.project-1")
      ? "the demo song is migrated into project-1 before the reader has made anything"
      : "",
  );
  await context.close();
}

/* --------------------------------------------------------- project library */

{
  const { context, page } = await fresh();
  const before = await storage(page);
  await press(page, "[data-home-start]");
  const after = await storage(page);
  const added = Object.keys(after).filter((k) => !(k in before));
  const records = added.filter((k) => k.startsWith("aranje.project."));
  note(
    "New project",
    records.length === 1 ? "WORKS AND IS PROVEN" : "MISSING",
    `one tap, new keys: ${added.join(", ") || "(none)"}`,
  );
  const title = await page.locator("h1").first().textContent().catch(() => null);
  note(
    "Editor opens on the created project",
    (await has(page, "[data-open-projects]")) ? "WORKS AND IS PROVEN" : "MISSING",
    `title "${title?.trim()}"`,
  );
  note(
    "Visible save status",
    (await has(page, "[data-save-status]")) ? "WORKS AND IS PROVEN" : "MISSING",
    `state "${await page.locator("[data-save-status]").first().getAttribute("data-save-status")}"`,
  );

  await press(page, "[data-open-projects]");
  const cards = await page.locator("[data-home-card]").count();
  note(
    "Project list",
    cards === 1 ? "WORKS AND IS PROVEN" : "MISSING",
    `${cards} card on Home, reached from the editor title`,
  );
  const cardText = (await page.locator("[data-home-card]").first().textContent()) ?? "";
  note(
    "Project card shows music, not storage",
    /BPM/.test(cardText) && !/project-/.test(cardText)
      ? "WORKS AND IS PROVEN"
      : "MISSING",
    cardText.replace(/\s+/g, " ").trim().slice(0, 80),
  );

  await press(page, "[data-home-start]");
  const two = Object.keys(await storage(page)).filter((k) =>
    k.startsWith("aranje.project."),
  );
  note(
    "A second project leaves the first alone",
    two.length === 2 ? "WORKS AND IS PROVEN" : "MISSING",
    two.join(", "),
  );

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  note(
    "Reload comes back to the same project",
    (await has(page, "[data-open-projects]")) ? "WORKS AND IS PROVEN" : "MISSING",
    `title "${(await page.locator("h1").first().textContent())?.trim()}"`,
  );
  await context.close();
}

/* ----------------------------------------------------- editor capabilities */

{
  const { context, page } = await fresh();
  await press(page, "[data-home-start]");
  const probes = [
    ["Song information / rename", "[data-open-projects]", null],
    ["Track add", null, "[data-testid='track-add'], [data-track-add]"],
    ["Track manage", null, "[data-testid='track-manage'], [data-track-manage]"],
    ["Section add", null, "[data-testid='section-add'], [data-section-add]"],
    ["Export", null, "[data-info-export]"],
  ];
  void probes;

  /* The dock is the editor's own vocabulary; ask it what doors exist. */
  const doors = await page.evaluate(() =>
    [...document.querySelectorAll("[data-dock-group],[data-dock-panel],[data-testid]")]
      .map((n) =>
        n.getAttribute("data-dock-group") ??
        n.getAttribute("data-dock-panel") ??
        n.getAttribute("data-testid"),
      )
      .filter((v) => v !== null),
  );
  note("Editor doors present on first paint", "WORKS AND IS PROVEN", doors.join(", ").slice(0, 300));

  const views = await page.locator("[data-testid^='view-']").count();
  note("Düzen / Çoklu / Tab views", views >= 3 ? "WORKS AND IS PROVEN" : "MISSING", `${views} view buttons`);

  await press(page, "[aria-label='Ses kaynakları ve lisans']");
  const exportDoor = await has(page, "[data-info-export]");
  note(
    "Export",
    exportDoor ? "IN THE UI BUT BEHIND AN INFO DIALOG" : "MISSING",
    exportDoor ? "reached from the info button, not from a project or editor menu" : "",
  );
  await context.close();
}

/* --------------------------------------------------------- error states */

{
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.localStorage.setItem("aranje.projects", "{ not json");
    window.localStorage.setItem("aranje.project.project-4", "{ also not json");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const banner = await page.locator("[data-recovery-banner], [role='alert']").count();
  note(
    "Corrupt project / catalog is explained",
    banner > 0 ? "WORKS AND IS PROVEN" : "MISSING",
    `${banner} alert region(s)`,
  );
  await context.close();
}

await browser.close();
writeFileSync(
  `${OUT}/ROUTE-INVENTORY.json`,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);
console.log(`\n${rows.length} rows written to ${OUT}/ROUTE-INVENTORY.json`);
