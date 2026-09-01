/**
 * The one block a founder copies back (2V-B §9, §18).
 *
 * Two columns for every step, because two parties measured it: what the page
 * saw in the project record, and what the person saw and heard. A row where
 * they disagree is the most useful line in the block — it is either a defect
 * the measurement missed or an impression the bytes contradict — so neither is
 * allowed to stand in for the other.
 */
import { shortSha } from "@/lib/acceptance/build-id";
import {
  ALL_BATCH_QUESTIONS,
  BATCH_STEPS,
  batchVerdict,
  isBatchHedged,
  type BatchAnswers,
  type BatchEnvironment,
} from "@/lib/acceptance/batch-steps";

export type BatchDevice = {
  readonly date: string;
  readonly viewport: string;
  readonly platform: string;
  readonly touchPoints: number;
  readonly userAgent: string;
};

/** What each step's measurement is called in the block. */
const MEASURED: Readonly<Record<string, string>> = {
  extend: "yazma yok",
  openMore: "yazma yok",
  listenOnce: "yazma yok",
  listenLoop: "yazma yok",
  pauseResume: "yazma yok",
  copyPaste: "tek yazma + geri al + ileri al bayt-eş",
  duplicate: "tek atomik yazma",
  move: "tek atomik yazma",
  repeat: "tek atomik yazma",
  deleteUndo: "tek yazma + geri al bayt-eş",
  measureScopes: "yazma yok",
  finish: "yazma yok",
};

const mark = (value: boolean | null | undefined): string =>
  value === true ? "geçti" : value === false ? "KALDI" : "ölçülmedi";

/**
 * What the environment is, said plainly.
 *
 * The rule — a `touch=0` environment can never be a physical PASS — is not a
 * footnote to be read past; it is the first thing this line says.
 */
function environmentLine(device: BatchDevice): string {
  return device.touchPoints === 0
    ? "masaüstü tarayıcı (dokunma 0) — fiziksel cihaz kanıtı değildir"
    : `dokunmatik cihaz (dokunma ${device.touchPoints})`;
}

export function formatBatchResult(input: {
  readonly buildSha: string;
  readonly device: BatchDevice;
  readonly environment: BatchEnvironment;
  readonly answers: BatchAnswers;
  readonly note: string;
}): string {
  const verdict = batchVerdict(input.environment, input.answers);
  const unanswered = ALL_BATCH_QUESTIONS.filter(
    (question) => !input.answers[question.id],
  ).length;
  const hedged = ALL_BATCH_QUESTIONS.filter((question) =>
    isBatchHedged(input.answers[question.id] ?? null),
  ).length;
  const unmeasured = BATCH_STEPS.filter(
    (step) => input.environment.measured[step.id] == null,
  ).length;

  const lines: string[] = [
    "ARANJÉ · Editör eylem kabulü (2V-B)",
    `Build: ${shortSha(input.buildSha)}`,
    `Tarih: ${input.device.date}`,
    `Ekran: ${input.device.viewport}`,
    `Dokunma noktası: ${input.device.touchPoints}`,
    `Ortam: ${environmentLine(input.device)}`,
    "",
    "Functional",
    `  Proje değişmedi: ${
      input.environment.userStorageBefore === input.environment.userStorageAfter
        ? "evet"
        : "HAYIR"
    }`,
    `  Uygulama konsol hatası: ${input.environment.consoleErrors.length}`,
    "",
    "Adımlar (sayfanın ölçtüğü · senin söylediğin)",
  ];

  for (const step of BATCH_STEPS) {
    const said = step.questions
      .map((question) => `${question.id}=${input.answers[question.id] ?? "—"}`)
      .join(", ");
    lines.push(
      `  ${step.title}`,
      `    ölçüm: ${MEASURED[step.id] ?? "—"} → ${mark(
        input.environment.measured[step.id],
      )}`,
      `    cevap: ${said === "" ? "—" : said}`,
    );
  }

  lines.push(
    "",
    `Ölçülmemiş adım: ${unmeasured}`,
    `Cevaplanmamış soru: ${unanswered}`,
    `Kararsız cevap: ${hedged}`,
    `Kullanıcı notu: ${input.note.trim() === "" ? "—" : input.note.trim()}`,
    "",
    `Verdict: ${verdict}`,
  );

  if (verdict === "PARTIAL" && input.device.touchPoints === 0) {
    lines.push(
      "Not: Bu ortam dokunmatik değil. Fiziksel kabul yalnız gerçek cihazda verilebilir.",
    );
  }

  /* Nothing here says how it sounded. It says what was measured and reported. */
  return lines.join("\n");
}
