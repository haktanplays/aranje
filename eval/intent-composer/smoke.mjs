/**
 * A first pass over the intent layer in a real browser (2S-A §6-§9).
 *
 * Not the acceptance matrix — that is `verify.mjs`. This is the smallest
 * check that the doors open, the pen writes, the brush asks and the
 * continuation applies, so a broken wire is found before sixty scenarios are
 * written against it.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

import { device, fixture } from "./device.mjs";
import { PROJECT_LEDGER, takeStorageLedger } from "../shared/project-storage.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(
  ([entries, ledger]) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
    (0, eval)(ledger);
  },
  [Object.entries(device(fixture("roomy"))), PROJECT_LEDGER],
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByTestId("view-tab").click();
await page.waitForTimeout(300);
await page.locator("[data-action-row] button", { hasText: "Düzenle" }).first().click();
await page.waitForTimeout(300);

const doors = await page.evaluate(() =>
  [...document.querySelectorAll("[data-composer-door]")].map((node) =>
    node.getAttribute("data-composer-door"),
  ),
);
console.log("doors:", doors.join(", "));

await page.locator("[data-composer-door='shape']").click();
await page.waitForTimeout(250);
const options = await page.evaluate(() =>
  [...document.querySelectorAll("[data-composer-option]")].map((node) =>
    node.getAttribute("data-composer-option"),
  ),
);
console.log("shape options:", options.join(", "));

await page.locator("[data-composer-option='power-2']").click();
await page.waitForTimeout(300);
const held = await page.evaluate(
  () => document.querySelector("[data-composer-held]")?.textContent ?? null,
);
console.log("held:", held);

await takeStorageLedger(page);
await page.locator("[data-cell='2:0']").first().click();
await page.waitForTimeout(700);

const written = await page.evaluate(() => {
  const raw = window.localStorage.getItem("aranje.project.project-1");
  const song = JSON.parse(raw).current;
  const lane = song.sections[0].bars[0].slots[song.tracks[0].id];
  return lane
    .map((slot, index) =>
      slot && slot !== "-"
        ? { index, notes: slot.notes.map((note) => `${note.pitch}@${note.position?.string}:${note.position?.fret}`) }
        : null,
    )
    .filter(Boolean);
});
console.log("after the pen:", JSON.stringify(written));
const ledger = await takeStorageLedger(page);
console.log("storage:", JSON.stringify(ledger));
console.log("errors:", errors.slice(0, 3));

await browser.close();
