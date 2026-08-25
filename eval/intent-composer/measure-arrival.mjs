/**
 * Whether a slurred note's own pitch is ever sounded (2S-A §3).
 *
 *   npx vite build --config eval/intent-composer/vite.intent.config.mts
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/measure-arrival.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";
/** `FILE=AFTER.json` writes the after-the-fix run beside the baseline. */
const FILE = process.env.FILE ?? "AUDIO.json";
const NAMES = (process.env.NAMES ?? [
  "reported-8-40", "reported-8-132", "reported-8-260",
  "reported-16-40", "reported-16-132", "reported-16-260",
  "reported-24-132", "reported-24-260",
  "reported-32-40", "reported-32-132", "reported-32-260",
  "technique-hammer_on-32", "technique-pull_off-32", "technique-slide-32",
  "dropd-32", "capo3-32", "section-seam-32",
].join(",")).split(",");

const bundle = readFileSync(`${OUT}/.render/intent-render.js`, "utf8");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const arrivals = {};
for (const name of NAMES) {
  const report = await page.evaluate(
    (fixture) => window.AranjeIntentRender.measureArrivalNamed(fixture),
    name,
  );
  arrivals[name] = report;
  for (const target of report.targets) {
    console.log(
      `  ${name} · ${target.kind} → ${target.pitch}: travel ` +
        `${(target.transitionSeconds * 1000).toFixed(1)}ms, arrives ` +
        `${(target.arrivesAtSeconds * 1000).toFixed(1)}ms, voice ends ` +
        `${(target.chainEndsAtSeconds * 1000).toFixed(1)}ms, held ` +
        `${(target.heldSeconds * 1000).toFixed(1)}ms` +
        `${target.stopsBeforeArrival ? "  ← NEVER ARRIVES" : ""}` +
        ` | cents off onset ${target.centsOffAtOnset} end ${target.centsOffAtSlotEnd}`,
    );
  }
}

await browser.close();
const existing = JSON.parse(readFileSync(`${OUT}/${FILE}`, "utf8"));
writeFileSync(
  `${OUT}/${FILE}`,
  `${JSON.stringify(
    {
      ...existing,
      arrivalMethod: [
        "For every legato target: the planned travel time, when the plan says the pitch arrives, when the chain's one voice stops, and the measured fundamental in the target's own window.",
        "`stopsBeforeArrival` is arithmetic on the plan; `centsOff*` is measured off the rendered audio.",
      ],
      arrivals,
      arrivalPageErrors: errors,
    },
    null,
    2,
  )}\n`,
);
console.log("wrote arrival measurements");
