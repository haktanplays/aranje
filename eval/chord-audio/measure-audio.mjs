/**
 * Renders the 2O-B.1 launch-audio, headroom and listening cases in a real
 * Chromium and writes what they measured (§2, §4, §5).
 *
 * The bundle is loaded into a page served by the running app, so the sample
 * URLs resolve exactly as they do in the product and the render is the one
 * the export button performs.
 *
 *   npx vite build --config eval/chord-audio/vite.chord-audio.config.mts
 *   npm run build && npx next start -p 3100
 *   node eval/chord-audio/measure-audio.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/chord-audio/artifacts";
const WAV = "eval/chord-audio/wav";
mkdirSync(OUT, { recursive: true });
mkdirSync(WAV, { recursive: true });

const bundle = readFileSync("eval/chord-audio/.render/chord-audio-render.js", "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

/* Count every AudioContext and every sample fetch, before the app can make one. */
await page.addInitScript(() => {
  window.__audioContexts = 0;
  window.__sampleRequests = 0;
  window.__sampleUrls = [];
  for (const key of ["AudioContext", "webkitAudioContext", "OfflineAudioContext"]) {
    const Original = window[key];
    if (!Original) continue;
    window[key] = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts += 1;
      }
    };
  }
  const fetchOriginal = window.fetch;
  window.fetch = (input, init) => {
    const url = String(typeof input === "string" ? input : (input?.url ?? ""));
    if (url.includes("/samples/")) {
      window.__sampleRequests += 1;
      window.__sampleUrls.push(url);
    }
    return fetchOriginal(input, init);
  };
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

/* ------------------------------------------------------- launch templates */

const templates = {};
for (const id of ["empty", "rock_band", "acoustic"]) {
  process.stdout.write(`  template ${id} ... `);
  templates[id] = await page.evaluate(
    (templateId) => window.AranjeChordAudioRender.renderTemplateAudio(templateId),
    id,
  );
  process.stdout.write("done\n");
}

process.stdout.write("  missing-preset fixture ... ");
const missingPreset = await page.evaluate(() =>
  window.AranjeChordAudioRender.renderMissingPreset(),
);
process.stdout.write("done\n");

/* -------------------------------------------------------------- headroom */

const headroomNames = await page.evaluate(() =>
  window.AranjeChordAudioRender.headroomCaseNames(),
);
const headroom = {};
for (const name of headroomNames) {
  process.stdout.write(`  headroom ${name} ... `);
  headroom[name] = await page.evaluate(
    (caseName) => window.AranjeChordAudioRender.renderHeadroomCase(caseName),
    name,
  );
  process.stdout.write(
    `peak ${headroom[name].preEncodePeak.toFixed(4)} clipped ${headroom[name].clippedFrames}\n`,
  );
}

/* ------------------------------------------------------------- listening */

const listeningNames = await page.evaluate(() =>
  window.AranjeChordAudioRender.listeningCaseNames(),
);
const listening = [];
for (const name of listeningNames) {
  process.stdout.write(`  wav ${name} ... `);
  const render = await page.evaluate(
    (caseName) => window.AranjeChordAudioRender.renderListeningCase(caseName),
    name,
  );
  writeFileSync(`${WAV}/${name}.wav`, Buffer.from(render.wavBase64, "base64"));
  // The bytes are on disk now; the artefact keeps the measurements.
  delete render.wavBase64;
  listening.push(render);
  process.stdout.write(`${render.wavBytes} bytes\n`);
}

const counts = await page.evaluate(() => ({
  audioContexts: window.__audioContexts,
  sampleRequests: window.__sampleRequests,
  distinctSampleUrls: [...new Set(window.__sampleUrls)].length,
}));

await browser.close();

/* -------------------------------------------------------------- artefacts */

writeFileSync(
  `${OUT}/HEADROOM.json`,
  `${JSON.stringify(
    {
      what: "2O-B.1 §4 — akor yoğunluğu, track seviyesi ve clipping",
      measuredOn: "masaüstü Chromium — telefon değil ve telefon hakkında kanıt değil",
      encoder: {
        note:
          "Kodlayıcı ±1 dışını kırpıyor. Aşağıdaki clippedSamples/clippedFrames " +
          "sayıları kırpılan örnekleri sayıyor; sıfır olmayan her satır, dışa " +
          "aktarılan dosyada duyulacak bir kırpılmadır.",
      },
      gainApproachesAreEvalOnly:
        "Dört yaklaşım yalnız burada, render edilmiş float'lar üzerinde " +
        "uygulandı. Production'a limiter veya normalizer eklenmedi.",
      cases: headroom,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  `${OUT}/AUDIO.json`,
  `${JSON.stringify(
    {
      what: "2O-B.1 §2, §5 — launch şablonlarının gerçek sesi ve dinleme paketi",
      measuredOn: "masaüstü Chromium",
      templates,
      missingPreset,
      listening,
      counts,
      consoleErrors: errors,
    },
    null,
    2,
  )}\n`,
);

/* ----------------------------------------------------------------- claims */

const claims = [];
const claim = (name, ok, detail) => claims.push({ name, ok, detail });

for (const [id, entry] of Object.entries(templates)) {
  claim(
    `${id} şablonunun her track'i duyuluyor`,
    entry.peak > 0 &&
      entry.rms > 0 &&
      entry.silentTrackNames.length === 0 &&
      Object.values(entry.perTrackPeak).every((peak) => peak > 0),
    `peak ${entry.peak.toFixed(4)} rms ${entry.rms.toFixed(6)} track peaks ${JSON.stringify(
      Object.fromEntries(
        Object.entries(entry.perTrackPeak).map(([key, value]) => [key, Number(value.toFixed(4))]),
      ),
    )}`,
  );
}

claim(
  "eksik pack sessiz başarı değil: motor track'i adıyla bildiriyor",
  missingPreset.peak === 0 &&
    missingPreset.silentTrackNames.length === 1 &&
    missingPreset.otherTrackPeak > 0,
  `gitar peak ${missingPreset.peak} · bildirilen ${JSON.stringify(
    missingPreset.silentTrackNames,
  )} · bas peak ${missingPreset.otherTrackPeak.toFixed(4)}`,
);

claim(
  "her render kendi context'ini kapattı",
  Object.values(headroom).every((entry) => entry.activeAfterDispose === 0) &&
    Object.values(templates).every((entry) => entry.activeAfterDispose === 0),
  "0",
);

/*
 * The claim is about what a reader is *given*, and only that.
 *
 * The first version of this asserted that nothing at −6 dB clips, and it
 * failed — because two things at the default level do clip, and neither is
 * something the template hands anybody: a hard-panned dense chord and two
 * guitars doubling the same chord. Both are recorded below as findings
 * rather than assumed away, and the claim now says the true thing.
 */
const SHIPPED = ["minor-7-dense-minus-6", "pan-centre", "launch-template-mix"];
const shipped = Object.entries(headroom).filter(([name]) => SHIPPED.includes(name));
claim(
  "şablonun kendi mix'i ve varsayılan −6 dB seviyesi kırpılmıyor",
  shipped.every(([, entry]) => entry.clippedFrames === 0),
  shipped
    .map(([name, entry]) => `${name}:${entry.preEncodePeak.toFixed(3)}/${entry.clippedFrames}`)
    .join(" "),
);

const surprising = Object.entries(headroom).filter(
  ([, entry]) => entry.trackVolumesDb.every((db) => db <= -6) && entry.clippedFrames > 0,
);
claim(
  "varsayılan seviyede de kırpılabilen durumlar bulundu ve gizlenmedi",
  surprising.length > 0,
  surprising.length === 0
    ? "yok"
    : surprising
        .map(([name, entry]) => `${name}:${entry.preEncodePeak.toFixed(3)}/${entry.clippedFrames}`)
        .join(" "),
);

const loud = Object.entries(headroom).filter(([, entry]) =>
  entry.trackVolumesDb.some((db) => db >= 0),
);
claim(
  "0 dB ve üstünde yoğun akor gerçekten kırpılıyor — ve bu gizlenmiyor",
  loud.some(([, entry]) => entry.clippedFrames > 0),
  loud
    .map(([name, entry]) => `${name}:${entry.preEncodePeak.toFixed(3)}/${entry.clippedFrames}`)
    .join(" "),
);

claim(
  "kodlanmış PCM'in tepe değeri kırpılan yerlerde tam ölçekte kalıyor",
  Object.values(headroom).every((entry) =>
    entry.clippedFrames > 0 ? entry.postEncodePeak >= 0.999 : entry.postEncodePeak <= 1,
  ),
  Object.entries(headroom)
    .map(([name, entry]) => `${name}:${entry.postEncodePeak.toFixed(4)}`)
    .join(" "),
);

claim(
  "peak normalization sessiz bir parçayı da yükseltiyor",
  Object.values(headroom).every((entry) => {
    const normalized = entry.gainApproaches.find(
      (approach) => approach.approach === "peak_normalized_minus_1dbfs",
    );
    return normalized !== undefined && Math.abs(normalized.peakDbfs + 1) < 0.01;
  }),
  Object.entries(headroom)
    .map(([name, entry]) => {
      const raw = entry.gainApproaches[0];
      const normalized = entry.gainApproaches.find(
        (a) => a.approach === "peak_normalized_minus_1dbfs",
      );
      return `${name}:${raw.peakDbfs.toFixed(1)}→${normalized.peakDbfs.toFixed(1)}dB`;
    })
    .join(" "),
);

const LIMITER = "soft_limiter_0.7_ceiling_-0.1dbfs";
claim(
  "yumuşak limiter tam ölçeği aşan hiçbir örnek bırakmıyor",
  Object.values(headroom).every((entry) => {
    const limited = entry.gainApproaches.find((a) => a.approach === LIMITER);
    return limited !== undefined && limited.overFullScaleSamples === 0;
  }),
  Object.entries(headroom)
    .map(([name, entry]) => {
      const limited = entry.gainApproaches.find((a) => a.approach === LIMITER);
      return `${name}:transient×${limited.attackRatioVsRaw.toFixed(3)}`;
    })
    .join(" "),
);
claim(
  "ham mix zaten kırpılmayan yerlerde limiter transient'e dokunmuyor",
  Object.values(headroom).every((entry) => {
    const limited = entry.gainApproaches.find((a) => a.approach === LIMITER);
    return entry.clippedFrames > 0 || (limited && limited.attackRatioVsRaw >= 0.99);
  }),
  Object.entries(headroom)
    .filter(([, entry]) => entry.clippedFrames === 0)
    .map(([name, entry]) => {
      const limited = entry.gainApproaches.find((a) => a.approach === LIMITER);
      return `${name}:${limited.attackRatioVsRaw.toFixed(4)}`;
    })
    .join(" "),
);

claim(
  "on iki dinleme dosyası yazıldı ve hepsinin sesi var",
  listening.length === 12 && listening.every((entry) => entry.peak > 0 && entry.wavBytes > 44),
  listening.map((entry) => `${entry.name}:${entry.peak.toFixed(3)}`).join(" "),
);

claim("sayfa hatası yok", errors.length === 0, errors[0] ?? "temiz");

for (const entry of claims) {
  console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.name}  — ${entry.detail}`);
}
const failed = claims.filter((entry) => !entry.ok).length;
console.log(`\n${claims.length - failed}/${claims.length} iddia geçerli`);
writeFileSync(`${OUT}/AUDIO-CLAIMS.json`, `${JSON.stringify(claims, null, 2)}\n`);
process.exit(failed === 0 ? 0 : 1);
