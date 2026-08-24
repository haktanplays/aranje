/**
 * Renders the 2P-A bend and slide benchmark and writes what it measured
 * (§10, §11, §12, §14).
 *
 * The listening files are named **blindly** — `bend/a01.wav`, not
 * `bend/plain-hold-is-better.wav`. Which file is which candidate lives in
 * `KEY.json`, so a person can listen without being told the answer first.
 *
 *   npx vite build --config eval/expression-benchmark/vite.expression.config.mts
 *   ./eval/chord-audio/serve.sh
 *   node eval/expression-benchmark/measure.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const OUT = "eval/expression-benchmark";
mkdirSync(`${OUT}/wav/bend`, { recursive: true });
mkdirSync(`${OUT}/wav/slide`, { recursive: true });
mkdirSync(`${OUT}/wav/timbre`, { recursive: true });

const bundle = readFileSync(`${OUT}/.render/expression-render.js`, "utf8");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ content: bundle });

const names = await page.evaluate(() => window.AranjeExpressionRender.fixtureNames());
const measurements = {};
const key = { bend: {}, slide: {}, timbre: {} };
const counters = { bend: 0, slide: 0, timbre: 0 };

/** a01, a02, … — no adjective, no verdict, nothing to read into the name. */
const blindName = (group) => {
  counters[group] += 1;
  return `${String.fromCharCode(97 + Math.floor((counters[group] - 1) / 99))}${String(
    counters[group],
  ).padStart(2, "0")}`;
};

for (const name of names) {
  process.stdout.write(`  ${name} ... `);
  const rendered = await page.evaluate(
    (fixture) =>
      window.AranjeExpressionRender.renderFixture(fixture).then((result) => {
        const wav = result.wavBase64;
        return { wav, measurement: { ...result, wavBase64: undefined } };
      }),
    name,
  );
  const blind = blindName(rendered.measurement.group);
  writeFileSync(
    `${OUT}/wav/${rendered.measurement.group}/${blind}.wav`,
    Buffer.from(rendered.wav, "base64"),
  );
  delete rendered.measurement.wavBase64;
  measurements[name] = rendered.measurement;
  key[rendered.measurement.group][`${blind}.wav`] = {
    fixture: name,
    what: rendered.measurement.what,
    isProductionBaseline: rendered.measurement.isProductionBaseline,
  };
  const pitch = rendered.measurement.pitch;
  process.stdout.write(
    pitch?.reachedCents === null || pitch === null
      ? "no pitch\n"
      : `reached ${pitch.reachedCents.toFixed(1)}c, ends ${pitch.centsAtNoteEnd?.toFixed(1)}c\n`,
  );
}

await browser.close();

/* ---------------------------------------------------------------- claims */

const results = [];
const claim = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 220) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const at = (name) => measurements[name];
const ends = (name) => at(name).pitch?.centsAtNoteEnd ?? null;
const reached = (name) => at(name).pitch?.reachedCents ?? null;

claim(
  "bugünkü bend nota sonunda sıfıra dönüyor",
  Math.abs(ends("bend-01-current-half")) < 15 && Math.abs(ends("bend-02-current-full")) < 15,
  `yarım ${ends("bend-01-current-half").toFixed(1)}c · tam ${ends("bend-02-current-full").toFixed(1)}c`,
);
claim(
  "düz tutulan aday dönmüyor",
  ends("bend-03-plain-hold-100") > 85 && ends("bend-04-plain-hold-200") > 180,
  `+100 → ${ends("bend-03-plain-hold-100").toFixed(1)}c · +200 → ${ends("bend-04-plain-hold-200").toFixed(1)}c`,
);
claim(
  "bend/release adayı gerçekten iniyor",
  Math.abs(ends("bend-05-release-100")) < 20 && Math.abs(ends("bend-06-release-200")) < 20,
  `${ends("bend-05-release-100").toFixed(1)}c · ${ends("bend-06-release-200").toFixed(1)}c`,
);
claim(
  "prebend ilk duyulan anda hedefte",
  at("bend-07-prebend-200").pitch.reachedAtSeconds < 0.06,
  `${at("bend-07-prebend-200").pitch.reachedAtSeconds}s, ${reached("bend-07-prebend-200").toFixed(1)}c`,
);
claim(
  "prebend/release hedefte başlayıp iniyor",
  reached("bend-08-prebend-release-200") > 180 &&
    Math.abs(ends("bend-08-prebend-release-200")) < 25,
  `${reached("bend-08-prebend-release-200").toFixed(1)}c → ${ends("bend-08-prebend-release-200").toFixed(1)}c`,
);
claim(
  "bend + vibrato hedefe vardıktan sonra sallanıyor",
  at("bend-09-vibrato-200").automationPoints >
    at("bend-04-plain-hold-200").automationPoints,
  `${at("bend-04-plain-hold-200").automationPoints} → ${at("bend-09-vibrato-200").automationPoints} otomasyon noktası`,
);
claim(
  "tie boyunca aday perde sıfırlanmıyor",
  ends("bend-12-tie-hold") > 180,
  `${ends("bend-12-tie-hold").toFixed(1)}c`,
);
claim(
  "akordaki sabit tel modüle edilmiyor",
  at("bend-14-chord-one-string").steadyVoiceAutomationPoints <= 1,
  `${at("bend-14-chord-one-string").steadyVoiceAutomationPoints} nokta`,
);

claim(
  "bugünkü slide hedefte yeniden vurmuyor",
  at("slide-02-current-up-4").targetAttackRatio <
    at("slide-01-normal-restrike").targetAttackRatio,
  `restrike ${at("slide-01-normal-restrike").targetAttackRatio.toFixed(2)} vs slide ${at("slide-02-current-up-4").targetAttackRatio.toFixed(2)}`,
);
claim(
  "legato adayı bugünküyle aynı ses — çünkü bugünkü zaten legato",
  at("slide-06-legato-up-4").targetAttackRatio ===
    at("slide-02-current-up-4").targetAttackRatio,
  `${at("slide-02-current-up-4").targetAttackRatio.toFixed(4)} = ${at("slide-06-legato-up-4").targetAttackRatio.toFixed(4)}`,
);
claim(
  "shift adayı hedefte gerçekten yeni bir atak taşıyor",
  at("slide-09-shift-up-4-attack-060").targetAttackRatio >
    at("slide-02-current-up-4").targetAttackRatio,
  `legato ${at("slide-02-current-up-4").targetAttackRatio.toFixed(2)} → shift ${at("slide-09-shift-up-4-attack-060").targetAttackRatio.toFixed(2)}`,
);
claim(
  "shift adayının atak seviyesi monoton bir sürekliliğe oturuyor",
  at("slide-08-shift-up-4-attack-035").targetAttackRatio <
    at("slide-09-shift-up-4-attack-060").targetAttackRatio &&
    at("slide-09-shift-up-4-attack-060").targetAttackRatio <
      at("slide-09b-shift-up-4-attack-100").targetAttackRatio,
  `legato ${at("slide-06-legato-up-4").targetAttackRatio.toFixed(2)} · 0.35 → ${at("slide-08-shift-up-4-attack-035").targetAttackRatio.toFixed(2)} · 0.60 → ${at("slide-09-shift-up-4-attack-060").targetAttackRatio.toFixed(2)} · 1.00 → ${at("slide-09b-shift-up-4-attack-100").targetAttackRatio.toFixed(2)}`,
);
claim(
  "shift adayı ikinci bir fiziksel kaynak kullanıyor ve bunu gizlemiyor",
  at("slide-09-shift-up-4-attack-060").physicalSources >
    at("slide-06-legato-up-4").physicalSources,
  `legato ${at("slide-06-legato-up-4").logicalVoices}/${at("slide-06-legato-up-4").physicalSources} · shift ${at("slide-09-shift-up-4-attack-060").logicalVoices}/${at("slide-09-shift-up-4-attack-060").physicalSources} (mantıksal/fiziksel)`,
);
claim(
  "geniş slide hedefe gerçekten varıyor",
  Math.abs(ends("slide-11-wide-legato-7")) < 30 && Math.abs(ends("slide-12-wide-legato-12")) < 40,
  `+7 → ${ends("slide-11-wide-legato-7")?.toFixed(1)}c · +12 → ${ends("slide-12-wide-legato-12")?.toFixed(1)}c`,
);
claim(
  "slide-in yazılan notaya iniyor, başka bir notaya değil",
  Math.abs(ends("slide-13-slide-in-below")) < 25 && Math.abs(ends("slide-14-slide-in-above")) < 25,
  `aşağıdan ${ends("slide-13-slide-in-below")?.toFixed(1)}c · yukarıdan ${ends("slide-14-slide-in-above")?.toFixed(1)}c`,
);
claim(
  "slide-out notadan ayrılıyor ve yön doğru",
  ends("slide-15-slide-out-down") < -100 && ends("slide-16-slide-out-up") > 100,
  `aşağı ${ends("slide-15-slide-out-down")?.toFixed(1)}c · yukarı ${ends("slide-16-slide-out-up")?.toFixed(1)}c`,
);
claim(
  "akordaki sabit tel slide sırasında da modüle edilmiyor",
  at("slide-18-chord-one-string").steadyVoiceAutomationPoints <= 1,
  `${at("slide-18-chord-one-string").steadyVoiceAutomationPoints} nokta`,
);

claim(
  "fret gürültüsü adayı gürültü bandında ölçülebilir enerji ekliyor",
  at("timbre-02-fret-noise-quiet-7").noiseBandEnergy >
    at("timbre-01-single-sample-7").noiseBandEnergy,
  `${at("timbre-01-single-sample-7").noiseBandEnergy.toFixed(2)} → ${at("timbre-02-fret-noise-quiet-7").noiseBandEnergy.toFixed(2)} → ${at("timbre-03-fret-noise-louder-7").noiseBandEnergy.toFixed(2)}`,
);
claim(
  "fret gürültüsü hedefte tam bir yeniden vuruşa dönüşmüyor",
  at("timbre-03-fret-noise-louder-7").targetAttackRatio <
    at("slide-01-normal-restrike").targetAttackRatio,
  `gürültü ${at("timbre-03-fret-noise-louder-7").targetAttackRatio.toFixed(2)} < restrike ${at("slide-01-normal-restrike").targetAttackRatio.toFixed(2)}`,
);
claim(
  "crossfade adayı iki fiziksel kaynak kullanıyor ve bunu bildiriyor",
  at("timbre-04-crossfade-7").extraSources === 1 &&
    at("timbre-04-crossfade-7").physicalSources >
      at("timbre-01-single-sample-7").physicalSources,
  `tek sample ${at("timbre-01-single-sample-7").logicalVoices}/${at("timbre-01-single-sample-7").physicalSources} · crossfade ${at("timbre-04-crossfade-7").logicalVoices}/${at("timbre-04-crossfade-7").physicalSources}`,
);
claim(
  "her render kendi context'ini kapattı",
  Object.values(measurements).every((entry) => entry.activeAfterDispose === 0),
  "0",
);
claim(
  "hiçbir fixture kırpılmadı",
  Object.values(measurements).every((entry) => entry.clippedSamples === 0),
  Object.values(measurements)
    .filter((entry) => entry.clippedSamples > 0)
    .map((entry) => entry.name)
    .join(",") || "temiz",
);
claim("sayfa hatası yok", errors.length === 0, errors[0] ?? "temiz");

/* ------------------------------------------------------------- artefacts */

writeFileSync(
  `${OUT}/MEASUREMENTS.json`,
  `${JSON.stringify(
    {
      what: "2P-A §10-§12 — bend ve slide adaylarının gerçek render ölçümü",
      measuredOn: "masaüstü Chromium, offline render — fiziksel telefon değil",
      productionUnchanged:
        "Bugünkü bend/slide davranışı değiştirilmedi. Adaylar yalnız render " +
        "planının pitch otomasyonunu değiştirerek üretildi; Song Contract'a " +
        "hiçbir alan eklenmedi.",
      instrument: {
        pitch:
          "normalize edilmiş autocorrelation + çok-periyotlu parabolik " +
          "iyileştirme; sentetik tonlara karşı ölçülen hata gitar aralığında " +
          "< 2.5 cent (eval/expression-benchmark/analysis.test.ts)",
        plateauNote:
          "reachedCents plato medyanı; peakCents tek en uç çerçeve. İkisi " +
          "arasındaki fark takipçinin gerçek sample üzerindeki gürültüsüdür, " +
          "overshoot değildir.",
        attack:
          "hedef anının 12 ms öncesi ve sonrasının RMS oranı; legato ≈ 1, " +
          "yeniden vuruş > 1",
        chordFixturesHaveNoF0:
          "Perde takipçisi monofonik. Akor fixture'larında voicedFrames 0 " +
          "olabilir ve bu bir ölçüm boşluğu değil, aracın sınırıdır: bir " +
          "akorda tek bir F0 raporlamak, bir parçalıya kilitlenip ona nota " +
          "demek olurdu. O fixture'larda iddia sesten değil plandan okunuyor " +
          "(steadyVoiceAutomationPoints).",
        referenceAudioAvailable: false,
      },
      fixtures: measurements,
      claims: results,
      consoleErrors: errors,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  `${OUT}/KEY.json`,
  `${JSON.stringify(
    {
      what: "Hangi dosya hangi aday — 2P-A §14",
      why:
        "Dosya adları kör: a01, a02… Bir dinleyici hangisinin 'düzeltilmiş' " +
        "olduğunu bilerek dinlerse ölçtüğü şey kendi beklentisidir.",
      files: key,
    },
    null,
    2,
  )}\n`,
);

const failed = results.filter((entry) => !entry.pass).length;
console.log(`\n${results.length - failed}/${results.length} ölçüm iddiası geçerli`);
process.exit(failed === 0 ? 0 : 1);
