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
  formatIsolationTruth,
  type IsolationTruth,
} from "@/lib/acceptance/isolation-truth";
import type { ActionLedger } from "@/lib/acceptance/transaction-ledger";
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
  copyPaste: "üretim olayı + tek yazma + geri al + ileri al bayt-eş",
  duplicate: "üretim olayı + tek atomik yazma",
  move: "üretim olayı + tek atomik yazma",
  repeat: "üretim olayı + tek atomik yazma",
  deleteUndo: "üretim olayı + tek yazma + geri al bayt-eş",
  trackScope: "yazma yok",
  measureScope: "yazma yok",
  finish: "yazma yok",
};

/**
 * One ledger row, as a line (2V-B.1 §5).
 *
 * Every number the round measured about one action, and — when something
 * broke — the names of exactly what broke. "KALDI" appears nowhere.
 */
function ledgerLine(ledger: ActionLedger): string {
  const numbers = [
    `komut=${ledger.commandCount}`,
    `yazan komut=${ledger.mutatingCommandCount}`,
    `depo yazma=${ledger.storageWriteCount}`,
    `revizyon=${ledger.revisionDelta}`,
    `geçmiş=${ledger.historyBefore}→${ledger.historyAfter}`,
  ].join(" · ");
  const hashes = [
    `önce=${ledger.beforeHash}`,
    `sonra=${ledger.afterHash}`,
    `geri=${ledger.undoHash ?? "—"}`,
    `ileri=${ledger.redoHash ?? "—"}`,
    `temizlik=${ledger.cleanupHash}`,
  ].join(" · ");
  const outcome =
    ledger.failures.length === 0
      ? ledger.result
      : `${ledger.result}: ${ledger.failures.join(", ")}`;
  return `  ${ledger.action} → ${outcome}\n    ${numbers}\n    ${hashes}`;
}

const scopeText = (filter: readonly string[] | null | undefined): string =>
  filter === undefined || filter === null ? "ölçülmedi" : filter.join("+");

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
  /** The four state domains, measured apart (§4). Null before the run ends. */
  readonly isolation?: IsolationTruth | null;
  /** One row per write action, plus the read-only copy evidence (§5). */
  readonly ledgers?: readonly ActionLedger[];
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
    "Editör eylem kabulü (2V-B.1)",
    `Build: ${shortSha(input.buildSha)}`,
    `Tarih: ${input.device.date}`,
    `Ekran: ${input.device.viewport}`,
    `Dokunma noktası: ${input.device.touchPoints}`,
    `Ortam: ${environmentLine(input.device)}`,
    "",
    /*
     * Four domains, not one sentence (§4). "Proje değişmedi" used to stand
     * in for four different questions with four different answers, which is
     * how a run could report a clean device while the clone never came back.
     */
    "İzolasyon",
    ...(input.isolation
      ? formatIsolationTruth(input.isolation)
          .split("\n")
          .map((line) => `  ${line}`)
      : [
          `  Cihaz deposu (ham bayt): ${
            input.environment.userStorageBefore ===
            input.environment.userStorageAfter
              ? "aynı"
              : "DEĞİŞTİ"
          }`,
          "  (Tam izolasyon bloğu koşu bitince yazılır.)",
        ]),
    `  Uygulama konsol hatası: ${input.environment.consoleErrors.length}`,
    "",
    "İşlem defteri",
    ...(input.ledgers && input.ledgers.length > 0
      ? input.ledgers.flatMap((ledger) => ledgerLine(ledger).split("\n"))
      : ["  (Henüz yazan bir işlem ölçülmedi.)"]),
    "",
    "Dinleme kapsamı",
    `  11A filtresi: ${scopeText(input.environment.trackScopeFilter)}`,
    `  11B filtresi: ${scopeText(input.environment.measureScopeFilter)}`,
    `  İkinci enstrüman duyuldu: ${
      input.environment.secondTrackAudible === true
        ? "evet"
        : input.environment.secondTrackAudible === false
          ? "HAYIR"
          : "ölçülmedi"
    }`,
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

  if (verdict === "BLOCKED") {
    /*
     * Why the run stopped, said in the report rather than left for whoever
     * reads the missing steps and guesses (2V-B.2 §3). A blocked run is the
     * most valuable report the round can produce — it is the only one that
     * names a place the product would not let a person through — so it says
     * so plainly instead of looking like an abandoned session.
     */
    lines.push(
      "Not: Test yarıda bırakıldı. Okuyucu «Burada bitir» ile durdu;" +
        " ölçülmemiş adımlar denenmedi, geçmiş sayılmaz.",
    );
  }

  if (verdict === "PARTIAL" && input.device.touchPoints === 0) {
    lines.push(
      "Not: Bu ortam dokunmatik değil. Fiziksel kabul yalnız gerçek cihazda verilebilir.",
    );
  }

  /* Nothing here says how it sounded. It says what was measured and reported. */
  return lines.join("\n");
}
