/**
 * The block a founder copies back (2V-A.1 §9).
 *
 * Every row the brief names, in Turkish, on one screen and in one paste. It
 * says what was measured, what was heard, and — first and last — what kind of
 * evidence this is: a run on a device, or a run on a desktop that can never
 * be one.
 */
import { shortSha } from "@/lib/acceptance/build-id";
import {
  ALL_LISTENING_QUESTIONS,
  isHedged,
  listeningVerdict,
  type ListeningAnswers,
  type ListeningEnvironment,
} from "@/lib/acceptance/listening-steps";

export type ListeningDevice = {
  readonly date: string;
  readonly viewport: string;
  readonly platform: string;
  readonly touchPoints: number;
  readonly userAgent: string;
};

/** The label each row of the block carries, keyed by the question behind it. */
const ROWS: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
  { label: "Seçim", keys: ["selectionOpened"] },
  { label: "Tek dinleme", keys: ["auditionStart", "auditionScope", "auditionEnd"] },
  { label: "Üç loop turu", keys: ["loopGap", "loopDoubleAttack", "loopTempo"] },
  { label: "Duraklat/devam", keys: ["pauseResumed", "pauseSingleVoice"] },
  { label: "İptal temizliği", keys: ["cancelStopped", "cancelClean"] },
  { label: "Tek enstrüman kapsamı", keys: ["trackScopeOnly"] },
  { label: "Tüm enstrüman kapsamı", keys: ["allScopeTogether"] },
];

const answerFor = (answers: ListeningAnswers, key: string): string =>
  answers[key] ?? "—";

/**
 * What the environment is, said plainly.
 *
 * A desktop is named as one. The brief's rule — a `touch=0` environment can
 * never be a physical PASS — is not a footnote to be read past; it is the
 * first thing this line says.
 */
function environmentLine(device: ListeningDevice): string {
  return device.touchPoints === 0
    ? `masaüstü tarayıcı (dokunma 0) — fiziksel cihaz kanıtı değildir`
    : `dokunmatik cihaz (dokunma ${device.touchPoints})`;
}

export function formatListeningResult(input: {
  readonly buildSha: string;
  readonly device: ListeningDevice;
  readonly environment: ListeningEnvironment;
  readonly answers: ListeningAnswers;
  readonly note: string;
}): string {
  const verdict = listeningVerdict(input.environment, input.answers);
  const unanswered = ALL_LISTENING_QUESTIONS.filter(
    (question) => !input.answers[question.id],
  ).length;
  const hedged = ALL_LISTENING_QUESTIONS.filter((question) =>
    isHedged(input.answers[question.id] ?? null),
  ).length;

  const lines: string[] = [
    "ARANJÉ · Seçimi dinle kabulü (2V-A)",
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
    "Listening",
  ];

  for (const row of ROWS) {
    const answers = row.keys.map((key) => `${key}=${answerFor(input.answers, key)}`);
    lines.push(`  ${row.label}: ${answers.join(", ")}`);
  }

  lines.push(
    "",
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

  /* Nothing here says how it sounded. It says what was reported. */
  return lines.join("\n");
}
