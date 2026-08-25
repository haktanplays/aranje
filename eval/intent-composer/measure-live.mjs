/**
 * The live audio path, recorded while it plays (2S-A §2 A, §3).
 *
 *   npx vite build --config eval/intent-composer/vite.intent.config.mts
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/measure-live.mjs
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";
const NAMES = (process.env.NAMES ?? [
  "reported-8-132",
  "reported-16-132",
  "reported-24-132",
  "reported-32-132",
  "reported-32-260",
  "repeat-32-132",
  "repeat-32-260",
  "alternate-32-132",
].join(",")).split(",");

const bundle = readFileSync(`${OUT}/.render/intent-render.js`, "utf8");
const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
  ],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const LOADS = (process.env.LOADS ?? "0,8").split(",").map(Number);
const STARTS = (process.env.STARTS ?? "plain").split(",");
const SEEK = Number(process.env.SEEK ?? 0);
const live = {};
for (const name of NAMES) {
  for (const loadMs of LOADS) {
   for (const start of STARTS) {
    const key = `${name}${loadMs === 0 ? "" : `@load${loadMs}`}${start === "plain" ? "" : `@${start}`}`;
    process.stdout.write(`  ${key} ... `);
    const report = await page.evaluate(
      ([fixture, load, mode, seek]) =>
        window.AranjeIntentRender.captureLiveNamed(fixture, load, mode, seek),
      [name, loadMs, start, SEEK],
    );
    live[key] = report;
    process.stdout.write(
      `median late ${(report.medianLatenessSeconds * 1000).toFixed(1)}ms` +
        ` worst ${(report.worstLatenessSeconds * 1000).toFixed(1)}ms` +
        ` note ${(report.onsets[0]?.playedSeconds * 1000).toFixed(1)}ms` +
        ` dead ${report.deadOnArrivalCount}/${report.onsets.length} | ` +
        report.onsets.map((o) => o.peakInSlot.toFixed(3)).join(" ") + "\n",
    );
   }
  }
}

await browser.close();

const existing = JSON.parse(readFileSync(`${OUT}/AUDIO.json`, "utf8"));
writeFileSync(
  `${OUT}/AUDIO.json`,
  `${JSON.stringify(
    {
      ...existing,
      liveMethod: [
        "Real (online) AudioContext, production createEngine + scheduleSong, played in real time.",
        "Samples captured off the engine's own master with a ScriptProcessorNode.",
        "`lateCallbacks` counts transport callbacks that ran after the moment they were handed.",
      ],
      live,
      livePageErrors: errors,
    },
    null,
    2,
  )}\n`,
);
console.log("wrote live capture");
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
