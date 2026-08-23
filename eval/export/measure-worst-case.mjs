/**
 * The two real worst cases, rendered for real (spec 13.19, 2M-A.1 §2).
 *
 * A five-second song's render time is not a worst-case acceptance, so this
 * runs the two fixtures that are: the longest file the product's limits
 * permit, and the heaviest event load they permit. Both go through
 * `renderSongToBuffer` and `encodeWav` — the functions the export button
 * calls — in a real desktop Chromium.
 *
 * **Desktop Chromium, labelled as such.** Not an Android or iOS measurement;
 * device latency stays open at the release gate.
 *
 * Rounds: three by default, so a median and a max mean something. If a render
 * fails — out of memory, a timeout, a context the browser refuses — that is
 * recorded as a finding and reported as a release risk. The limits are not
 * quietly reduced to make the number look better.
 *
 *   npx vite build --config eval/export/vite.render.config.mts
 *   npx next start -p 3100
 *   node eval/export/measure-worst-case.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/export";
const ROUNDS = Number(process.env.WORST_ROUNDS ?? 3);
/** Generous, because the point is to find out, not to time out early. */
const TIMEOUT_MS = Number(process.env.WORST_TIMEOUT_MS ?? 300_000);

mkdirSync(OUT, { recursive: true });
const bundle = readFileSync("eval/export/.render/export-render.js", "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc"],
});
const page = await browser.newPage();
page.setDefaultTimeout(TIMEOUT_MS);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("crash", () => pageErrors.push("PAGE CRASHED"));

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

/*
 * Object URLs the *export* mints, counted on the real API.
 *
 * The render adapter deliberately makes none: turning bytes into a download
 * is the controller's job, and the full create/revoke lifecycle is proven in
 * `verify.mjs` against the running app. What is checked here is the narrower
 * claim that a render — even a three-minute one — leaks no URL of its own.
 * The framework's own blob chunks are filtered out, or a correct lifecycle
 * would read as a phantom leak.
 */
await page.evaluate(() => {
  window.__urls = { created: 0, revoked: 0 };
  const EXPORT_TYPES = ["audio/wav", "audio/midi", "application/json", "text/plain"];
  const isExport = (blob) =>
    EXPORT_TYPES.some((known) => String(blob?.type ?? "").startsWith(known));
  const created = new Set();
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    if (isExport(blob)) {
      created.add(url);
      window.__urls.created += 1;
    }
    return url;
  };
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    if (created.has(url)) window.__urls.revoked += 1;
    return revoke(url);
  };
});

const CASES = [
  {
    key: "worst-longest-duration",
    label: "En uzun süre (32 bar, 4/4, 40 BPM)",
    pressure: "süre ve bellek",
  },
  {
    key: "worst-heaviest-events",
    label: "En yoğun olay (8 track, 32 bar, 1/32)",
    pressure: "scheduler, expression planner, voice pool",
  },
];

const stats = (samples) => {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return {
    rounds: sorted.length,
    medianMs: Math.round(at(0.5)),
    maxMs: Math.round(sorted[sorted.length - 1]),
  };
};

const results = {};
const findings = [];

for (const entry of CASES) {
  console.log(`\n=== ${entry.label}`);
  const totals = [];
  const renders = [];
  const encodes = [];
  let shape = null;
  let failure = null;

  for (let round = 0; round < ROUNDS; round += 1) {
    const started = Date.now();
    try {
      const measurement = await page.evaluate(
        (key) => window.AranjeExportRender.renderExportCase(key),
        entry.key,
      );
      const total = Date.now() - started;
      totals.push(total);
      encodes.push(measurement.encodeMillis);
      renders.push(Math.max(0, total - measurement.encodeMillis));
      shape = measurement;
      console.log(
        `  tur ${round + 1}: toplam ${total} ms ` +
          `(encode ${measurement.encodeMillis} ms), ` +
          `${measurement.seconds}s, ${(measurement.wavBytes / 1048576).toFixed(2)} MiB`,
      );
    } catch (error) {
      /*
       * Recorded rather than smoothed over. An out-of-memory render or a
       * timeout at the product's own limits is a release risk, and the answer
       * to it is not to shrink the limits until the number looks acceptable.
       */
      failure = String(error).split("\n")[0].slice(0, 200);
      console.log(`  tur ${round + 1}: BAŞARISIZ — ${failure}`);
      findings.push({
        case: entry.key,
        label: entry.label,
        round: round + 1,
        failure,
        severity: "release-risk",
      });
      break;
    }
  }

  results[entry.key] = {
    label: entry.label,
    pressure: entry.pressure,
    total: stats(totals),
    render: stats(renders),
    encode: stats(encodes),
    failure,
    shape: shape && {
      seconds: shape.seconds,
      notatedSeconds: shape.notatedSeconds,
      tailSeconds: shape.tailSeconds,
      frames: shape.frames,
      estimatedFrames: shape.estimatedFrames,
      estimatedBytes: shape.estimatedBytes,
      /* The estimate rounds frames up, so it is an upper bound, never low. */
      estimateOverBytes: shape.estimatedBytes - shape.wavBytes,
      wavBytes: shape.wavBytes,
      wavMiB: Number((shape.wavBytes / 1048576).toFixed(2)),
      wavChannels: shape.wavChannels,
      wavSampleRate: shape.wavSampleRate,
      wavBitDepth: shape.wavBitDepth,
      wavDataBytes: shape.wavDataBytes,
      headerMatchesFile: shape.headerMatchesFile,
      peak: shape.peak,
      rms: shape.rms,
      tailRms: shape.tailRms,
      activeAfterDispose: shape.activeAfterDispose,
      heapBeforeBytes: shape.heapBeforeBytes,
      heapAfterBytes: shape.heapAfterBytes,
      heapDeltaMiB:
        shape.heapBeforeBytes === null || shape.heapAfterBytes === null
          ? null
          : Number(
              ((shape.heapAfterBytes - shape.heapBeforeBytes) / 1048576).toFixed(2),
            ),
    },
  };
}

/*
 * A render that takes longer than the music it renders is a finding.
 *
 * Not a failure — the file is correct and complete — but a real-time factor
 * above 1 on a desktop is a warning about phones, and the honest response is
 * to write it down rather than to quietly shrink what the product allows.
 */
for (const entry of CASES) {
  const result = results[entry.key];
  if (!result.shape || !result.total) continue;
  const factor = result.total.medianMs / 1000 / result.shape.seconds;
  result.realTimeFactor = Number(factor.toFixed(2));
  if (factor > 1) {
    findings.push({
      case: entry.key,
      label: entry.label,
      severity: "release-risk",
      realTimeFactor: Number(factor.toFixed(2)),
      finding:
        `Masaüstü Chromium'da ${result.shape.seconds.toFixed(1)} saniyelik ses ` +
        `${(result.total.medianMs / 1000).toFixed(1)} saniyede render ediliyor ` +
        `(gerçek zamanın ${factor.toFixed(1)} katı). Telefonda daha yavaş olması ` +
        "beklenir; sınırlar küçültülmedi, risk kayda geçirildi.",
    });
  }
}

/* The download lifecycle these renders caused, on the real API. */
const urls = await page.evaluate(() => window.__urls);

await browser.close();

/* ------------------------------------------------------------- the claims */

const checks = [];
const claim = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
};

console.log("");

for (const entry of CASES) {
  const result = results[entry.key];
  const shape = result.shape;
  claim(
    `${entry.key} renders at the product's real limits`,
    result.failure === null && shape !== null,
    result.failure ?? `${result.total?.medianMs} ms median, ${result.total?.maxMs} ms max`,
  );
  if (!shape) continue;

  claim(
    `${entry.key} file matches the formula to the byte`,
    shape.wavBytes === 44 + shape.frames * 2 * 2 && shape.headerMatchesFile,
    `44 + ${shape.frames} × 2 × 2 = ${44 + shape.frames * 2 * 2}, file ${shape.wavBytes}`,
  );

  claim(
    `${entry.key} pre-flight estimate is an upper bound, never an under-count`,
    shape.estimatedBytes >= shape.wavBytes &&
      shape.estimatedBytes - shape.wavBytes <= 2 * 2 * 2,
    `estimate ${shape.estimatedBytes} B vs file ${shape.wavBytes} B ` +
      `(+${shape.estimatedBytes - shape.wavBytes} B, ` +
      `${shape.estimatedFrames - shape.frames} frame rounding)`,
  );

  claim(
    `${entry.key} leaves no voice sounding after dispose`,
    shape.activeAfterDispose === 0,
    `active after dispose: ${shape.activeAfterDispose}`,
  );

  claim(
    `${entry.key} carries audio, not silence`,
    shape.peak > 1e-4,
    `peak ${shape.peak}, rms ${shape.rms}`,
  );
}

claim(
  "a render mints no Object URL of its own",
  urls.created === 0 && urls.revoked === 0,
  `export blobs created ${urls.created}, revoked ${urls.revoked} ` +
    `(the download lifecycle itself is proven in verify.mjs)`,
);

claim("the page stayed alive and quiet", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

const failed = checks.filter((entry) => !entry.pass);

writeFileSync(
  `${OUT}/WORST-CASE.json`,
  `${JSON.stringify(
    {
      honesty: [
        "Bu ölçümler masaüstü Chromium'dur; fiziksel Android/iOS kanıtı değildir.",
        `Her fixture ${ROUNDS} turda ölçüldü; tur sayısı burada yazılıdır.`,
        "Süre baskısı ile olay baskısı ayrı fixture'lardır ve tek 'worst case' kelimesinde birleştirilmemiştir.",
        "Heap okuması Chromium'un kaba performance.memory değeridir; allocation profili değildir.",
      ],
      rounds: ROUNDS,
      timeoutMs: TIMEOUT_MS,
      results,
      objectUrls: urls,
      checks,
      failed: failed.length,
      findings,
    },
    null,
    2,
  )}\n`,
);

if (findings.length > 0) {
  console.log("\n--- RELEASE RISK");
  for (const finding of findings) {
    console.log(`  ${finding.label}: ${finding.finding ?? finding.failure}`);
  }
}

console.log(`\n${checks.length - failed.length}/${checks.length} worst-case claims hold`);
process.exit(failed.length === 0 ? 0 : 1);
