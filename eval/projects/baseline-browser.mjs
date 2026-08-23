/**
 * What keys the app really creates on a first run, before 2O-A exists.
 *
 * The point is the *ledger*, not the screenshot: every physical localStorage
 * operation the app performs between the first line of its own code and a
 * settled first paint, in order. Recorded here so the migration's cost can be
 * stated as a difference from a measured baseline rather than from memory.
 *
 *   npm run build && npx next start -p 3100
 *   node eval/projects/baseline-browser.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/projects/artifacts";
mkdirSync(OUT, { recursive: true });

/* Installed before any app code: the ledger has to see the first operation. */
const LEDGER = `
  window.__ops = [];
  window.__consoleErrors = [];
  const proto = Storage.prototype;
  const get = proto.getItem, set = proto.setItem, remove = proto.removeItem;
  proto.getItem = function (key) { window.__ops.push("get " + key); return get.call(this, key); };
  proto.setItem = function (key, value) {
    window.__ops.push("set " + key + " (" + value.length + "B)");
    return set.call(this, key, value);
  };
  proto.removeItem = function (key) { window.__ops.push("remove " + key); return remove.call(this, key); };
`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
await context.addInitScript(LEDGER);
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") {
    page.evaluate((t) => window.__consoleErrors.push(t), message.text()).catch(() => {});
  }
});
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const report = await page.evaluate(() => ({
  opsOnFirstLoad: window.__ops,
  keys: Object.keys(localStorage).sort(),
  consoleErrors: window.__consoleErrors,
}));

await browser.close();
writeFileSync(`${OUT}/BASELINE-BROWSER.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
