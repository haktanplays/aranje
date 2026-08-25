/**
 * Renders the 2S-A playback fixtures and writes what it measured (§2 A, §3).
 *
 * The whole point is attribution rather than a verdict: for every onset it
 * records whether the timeline had it, whether the scheduler placed it,
 * whether a voice was triggered for it, and whether the render carries any
 * energy at its moment. A silent note is then a fact about one named layer.
 *
 *   npx vite build --config eval/intent-composer/vite.intent.config.mts
 *   ./eval/chord-audio/serve.sh
 *   node eval/intent-composer/measure-audio.mjs [--only reported-1-32]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/intent-composer";
const ONLY = process.env.ONLY ?? null;
mkdirSync(`${OUT}/wav`, { recursive: true });

const bundle = readFileSync(`${OUT}/.render/intent-render.js`, "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const names = await page.evaluate(() => window.AranjeIntentRender.fixtureNames());
const wanted = ONLY ? names.filter((name) => name.includes(ONLY)) : names;

const fixtures = {};
for (const name of wanted) {
  process.stdout.write(`  ${name} ... `);
  const report = await page.evaluate(
    (fixture) => window.AranjeIntentRender.measureNamed(fixture),
    name,
  );
  fixtures[name] = report;
  process.stdout.write(
    `${report.onsets.length} onset, ${report.silentOnsets.length} silent` +
      ` [${report.silentOnsets.join(",")}]\n`,
  );
}

let envelope = null;
if (!ONLY || ONLY === "reported-1-32") {
  process.stdout.write("  envelope ... ");
  const result = await page.evaluate(() =>
    window.AranjeIntentRender.reportedEnvelope(),
  );
  writeFileSync(`${OUT}/wav/reported-1-32.wav`, Buffer.from(result.wav, "base64"));
  envelope = result.windows;
  process.stdout.write(`${result.windows.length} windows\n`);
}

await browser.close();

const existing = (() => {
  try {
    return JSON.parse(readFileSync(`${OUT}/AUDIO.json`, "utf8"));
  } catch {
    return {};
  }
})();

writeFileSync(
  `${OUT}/AUDIO.json`,
  `${JSON.stringify(
    {
      ...existing,
      environment: {
        note: "Desktop Chromium, offline render. No physical device evidence.",
        base: BASE,
      },
      method: [
        "Production createEngine + scheduleSong on an offline context.",
        "sampler.triggerAttackRelease, expression.play, expression.playChain and transport.schedule are wrapped, never replaced.",
        "An onset counts as silent when its peak is under 12% of the run's loudest onset AND the level did not rise by 25% at its own moment.",
        "A legato chain target is exempt: it is not meant to be struck.",
      ],
      pageErrors: errors,
      fixtures: { ...(existing.fixtures ?? {}), ...fixtures },
      ...(envelope ? { reportedEnvelope: envelope } : {}),
    },
    null,
    2,
  )}\n`,
);

console.log(`wrote ${OUT}/AUDIO.json (${Object.keys(fixtures).length} fixtures)`);
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
