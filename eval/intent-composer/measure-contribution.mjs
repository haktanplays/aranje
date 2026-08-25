/**
 * What each onset actually contributes to the sound (2S-A §3).
 *
 * Renders a fixture whole, then once per onset with that onset turned into a
 * rest, and subtracts. The difference is exactly the sound the onset was
 * responsible for, so "this note is silent" becomes an arithmetic fact rather
 * than a reading of an envelope.
 *
 *   npx vite build --config eval/intent-composer/vite.intent.config.mts
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/measure-contribution.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";
mkdirSync(`${OUT}/wav`, { recursive: true });

const NAMES = (process.env.NAMES ?? [
  "reported-8-132",
  "reported-16-132",
  "reported-24-132",
  "reported-32-132",
  "reported-32-260",
  "reported-32-40",
  "repeat-32-132",
  "repeat-32-260",
  "alternate-32-260",
  "technique-hammer_on-32",
  "dropd-32",
  "capo3-32",
].join(",")).split(",");

const bundle = readFileSync(`${OUT}/.render/intent-render.js`, "utf8");
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const contributions = {};
for (const name of NAMES) {
  process.stdout.write(`  ${name} ... `);
  const report = await page.evaluate(
    (fixture) => window.AranjeIntentRender.measureContributionNamed(fixture),
    name,
  );
  contributions[name] = report;
  process.stdout.write(
    report.onsets
      .map((onset) => `${onset.index}:${onset.peak.toFixed(4)}${onset.chainMember ? "*" : ""}`)
      .join(" ") + "\n",
  );
}

const envelopes = {};
for (const name of ["reported-32-132", "reported-32-260", "repeat-32-260"]) {
  const result = await page.evaluate(
    (fixture) => window.AranjeIntentRender.envelopeFor(fixture),
    name,
  );
  writeFileSync(`${OUT}/wav/${name}.wav`, Buffer.from(result.wav, "base64"));
  envelopes[name] = result.windows;
}

await browser.close();

const existing = JSON.parse(readFileSync(`${OUT}/AUDIO.json`, "utf8"));
writeFileSync(
  `${OUT}/AUDIO.json`,
  `${JSON.stringify(
    {
      ...existing,
      contributionMethod: [
        "full render minus the same render with one onset turned into a rest.",
        "`chainMember: true` onsets carry their whole legato chain in the difference, not one note; their number is read as the chain's contribution.",
      ],
      contributions,
      envelopes,
      contributionPageErrors: errors,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${OUT}/AUDIO.json contributions (${NAMES.length} fixtures)`);
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
