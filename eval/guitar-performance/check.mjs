/**
 * The nine thresholds of `THRESHOLDS.md`, checked mechanically (2T-C §10).
 *
 * Written after the thresholds and before the patch, so nothing here can be
 * quietly widened to fit a result. It reads both files and reports each
 * threshold on the baseline and on the current render, because a threshold
 * that was already passing and one the patch fixed are different claims and
 * the report has to be able to tell them apart.
 *
 *   node eval/guitar-performance/check.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "eval/guitar-performance";
const baseline = JSON.parse(readFileSync(`${OUT}/BASELINE.json`, "utf8")).fixtures;
const current = JSON.parse(readFileSync(`${OUT}/MEASUREMENTS.json`, "utf8")).fixtures;

const PICKS = ["pick-up", "pick-down"];
const LEGATO = ["hammer-on", "pull-off", "slide"];
const ALL = [...PICKS, ...LEGATO];

const db = (set) => set["hammer-on"].transientWindow.changeDb;
const pull = (set) => set["pull-off"].transientWindow.changeDb;

/** Each threshold: what it claims, and how it is read off a measurement set. */
const THRESHOLDS = [
  {
    id: "T1",
    claim: "mızrap yeniden vurur (2 onset), legato vurmaz (1 onset)",
    read: (set) => ({
      pass:
        PICKS.every((name) => set[name].onsetCount === 2) &&
        LEGATO.every((name) => set[name].onsetCount === 1),
      detail: ALL.map((name) => `${name}=${set[name].onsetCount}`).join(" "),
    }),
  },
  {
    id: "T2",
    claim: "hammer-on ile pull-off arasındaki seviye farkı ≥ 2 dB",
    read: (set) => {
      const gap = Math.abs(db(set) - pull(set));
      return { pass: gap >= 2, detail: `${gap.toFixed(2)} dB` };
    },
  },
  {
    id: "T3",
    claim: "hammer-on'ın bir iniş anı var (fiziksel kaynak ≥ 2)",
    read: (set) => ({
      pass: set["hammer-on"].voices.physical >= 2,
      detail: `${set["hammer-on"].voices.physical} kaynak`,
    }),
  },
  {
    id: "T4",
    claim: "tepe ≤ −1 dBFS ve kırpılan örnek yok",
    read: (set) => ({
      pass: ALL.every(
        (name) => set[name].peakDbfs <= -1 && set[name].clippedSamples === 0,
      ),
      detail: ALL.map((name) => `${name}=${set[name].peakDbfs.toFixed(1)}`).join(" "),
    }),
  },
  {
    id: "T5",
    claim: "yazılan perde ±25 sent içinde çalınıyor",
    read: (set) => ({
      pass: ALL.every((name) => Math.abs(set[name].pitch.settledCents ?? 999) <= 25),
      detail: ALL.map(
        (name) => `${name}=${(set[name].pitch.settledCents ?? NaN).toFixed(1)}c`,
      ).join(" "),
    }),
  },
  {
    id: "T6",
    claim: "slide yola önceden çıkar (≤ −80 ms), parmak inişleri çıkmaz (≥ −40 ms)",
    read: (set) => {
      const slide = set.slide.pitch.departureSeconds;
      const fingers = ["hammer-on", "pull-off"].map(
        (name) => set[name].pitch.departureSeconds,
      );
      return {
        pass: slide <= -0.08 && fingers.every((value) => value >= -0.04),
        detail: `slide=${(slide * 1000).toFixed(0)}ms parmak=${fingers
          .map((value) => `${(value * 1000).toFixed(0)}ms`)
          .join("/")}`,
      };
    },
  },
  {
    id: "T7",
    claim: "render bittiğinde çalan ses kalmıyor",
    read: (set) => ({
      pass: ALL.every((name) => set[name].voices.activeAfterDispose === 0),
      detail: ALL.map((name) => set[name].voices.activeAfterDispose).join(" "),
    }),
  },
  {
    id: "T8",
    claim: "legato çifti tek mantıksal ses olarak kalıyor",
    read: (set) => ({
      pass:
        LEGATO.every((name) => set[name].voices.logical === 1) &&
        PICKS.every((name) => set[name].voices.logical === 2),
      detail: ALL.map((name) => `${name}=${set[name].voices.logical}`).join(" "),
    }),
  },
  {
    id: "T9",
    claim: "hammer-on ile pull-off parlaklıkta ≥ %15 ayrışıyor",
    read: (set) => {
      const hammer = set["hammer-on"].transitionCentroidHz;
      const pulled = set["pull-off"].transitionCentroidHz;
      const ratio = Math.abs(pulled - hammer) / Math.min(hammer, pulled);
      return {
        pass: ratio >= 0.15,
        detail: `${hammer.toFixed(0)} Hz vs ${pulled.toFixed(0)} Hz — %${(ratio * 100).toFixed(1)}`,
      };
    },
  },
];

const rows = THRESHOLDS.map((threshold) => {
  const before = threshold.read(baseline);
  const after = threshold.read(current);
  return {
    id: threshold.id,
    claim: threshold.claim,
    baseline: before,
    current: after,
    fixedByPatch: !before.pass && after.pass,
    brokenByPatch: before.pass && !after.pass,
  };
});

for (const row of rows) {
  const mark = row.current.pass ? "PASS" : "FAIL";
  const moved = row.fixedByPatch
    ? " (yama düzeltti)"
    : row.brokenByPatch
      ? " (YAMA BOZDU)"
      : "";
  console.log(
    `${mark}  ${row.id}  ${row.claim}${moved}\n` +
      `        baseline: ${row.baseline.pass ? "geçti" : "kaldı"} — ${row.baseline.detail}\n` +
      `        şimdi:    ${row.current.pass ? "geçti" : "kaldı"} — ${row.current.detail}`,
  );
}

const failed = rows.filter((row) => !row.current.pass);
const broken = rows.filter((row) => row.brokenByPatch);
console.log(
  `\n${rows.length - failed.length}/${rows.length} eşik geçti` +
    `${broken.length > 0 ? ` · ${broken.length} eşik yamayla bozuldu` : ""}`,
);

writeFileSync(
  `${OUT}/RESULT.json`,
  `${JSON.stringify({ checkedAt: new Date().toISOString(), thresholds: rows }, null, 2)}\n`,
);
if (failed.length > 0) process.exitCode = 1;
