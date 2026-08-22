/**
 * The worst-case write, actually attempted (2K-B.1).
 *
 * `BYTES.json` says how big the file is; this says whether a production
 * Chromium will take it. One real `setItem` with the full worst-case envelope
 * — success or the exception's name, recorded either way, and the test key
 * removed afterwards.
 *
 * This is a Chromium data point, not a quota guarantee and not a physical
 * iOS Safari acceptance; that one stays open. The write path fails closed at
 * runtime regardless of what this says.
 *
 *   WORST_OUT=/tmp/worst.json npx tsx eval/storage/measure.ts
 *   node eval/storage/quota-check.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const PAYLOAD_PATH = process.env.WORST_PAYLOAD ?? "/tmp/aranje-worst-envelope.json";

const payload = readFileSync(PAYLOAD_PATH, "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

const outcome = await page.evaluate((value) => {
  const key = "aranje.quota-check";
  try {
    localStorage.setItem(key, value);
    const readBack = localStorage.getItem(key);
    localStorage.removeItem(key);
    return {
      ok: true,
      roundTrip: readBack === value,
      codeUnits: value.length,
    };
  } catch (error) {
    return {
      ok: false,
      errorName: error instanceof Error ? error.name : String(error),
      codeUnits: value.length,
    };
  }
}, payload);

const report = {
  browser: browser.version(),
  payloadCodeUnits: payload.length,
  result: outcome,
};
writeFileSync(
  "eval/storage/QUOTA.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
