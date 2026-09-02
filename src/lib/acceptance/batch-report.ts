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
  buildStepRows,
  reportInvariants,
  EVIDENCE_TEXT,
  HUMAN_TEXT,
  ISOLATION_TEXT,
  type StepRow,
  type StepState,
} from "@/lib/acceptance/step-rows";
import {
  ALL_BATCH_QUESTIONS,
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

/**
 * The founder's own answer to 11B, mapped to the report's vocabulary.
 *
 * Unanswered is "ölçülmedi" and never anything else — the whole defect was a
 * missing answer being filled in from elsewhere.
 */
function heardAnswer(answers: BatchAnswers): string {
  const given = answers.allScopeTogether;
  if (given === undefined || given === null || given === "") return "ölçülmedi";
  if (given === "Evet") return "evet";
  if (given === "Hayır") return "HAYIR";
  return given.toLocaleLowerCase("tr");
}

/**
 * One step, as three lines that cannot be collapsed into each other.
 *
 * `eylem kanıtı`, `izolasyon` and `cevap` are three different questions with
 * three different answers, and the block that produced the false green had
 * written them as one: "ölçüm: yazma yok → geçti" said an isolation
 * invariant, called it a measurement, and concluded a pass — in a step whose
 * action had never been performed (2V-B.2c §3 step 11).
 */
function stepLines(row: StepRow): readonly string[] {
  return [
    `  ${row.title}`,
    `    beklenen: ${row.required}`,
    `    eylem kanıtı: ${row.survey ? "gerekmiyor" : EVIDENCE_TEXT[row.evidence]}`,
    `    izolasyon: ${ISOLATION_TEXT[row.isolation]}`,
    `    cevap: ${HUMAN_TEXT[row.human]} (${row.answers})`,
  ];
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
  /**
   * What the round recorded about each step, keyed by step id (2V-B.2c §3).
   *
   * Optional so a caller that only has answers still produces a readable
   * block — every step it omits is `blocked` and `not_measured`, which is the
   * honest reading of "this round never told us".
   */
  readonly states?: Readonly<Record<string, StepState | undefined>>;
}): string {
  const rows = buildStepRows({ states: input.states ?? {}, answers: input.answers });
  const verdict = batchVerdict(input.environment, input.answers);
  const unanswered = ALL_BATCH_QUESTIONS.filter(
    (question) => !input.answers[question.id],
  ).length;
  const hedged = ALL_BATCH_QUESTIONS.filter((question) =>
    isBatchHedged(input.answers[question.id] ?? null),
  ).length;
  /*
   * Counted off the rows, never off a second source (§2 rule 8). This line
   * used to read `environment.measured`, which is the same shape but a
   * different value, and "eight adım ölçülmedi" beside eight rows saying
   * "geçti" is exactly the contradiction that made the block untrustworthy.
   */
  const unproven = rows.filter((row) => row.evidence !== "valid").length;
  const unreached = rows.filter((row) => row.evidence === "blocked").length;

  const heard = heardAnswer(input.answers);

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
    /*
     * Hearing is whatever the founder said, and nothing else (2V-B.2c §12).
     *
     * This line used to read `environment.secondTrackAudible`, which the page
     * computed from the fixture having two tracks. So a run that correctly
     * reported `BLOCKED`, with 11B unanswered and its row showing "—", also
     * announced "İkinci enstrüman duyuldu: evet" — a perception nobody
     * supplied, in the same report that said nobody had been asked.
     *
     * The technical fact is still worth having and is printed above as the
     * 11B filter: that says which instruments were *planned*, which is a
     * different claim from which instruments were *heard*.
     */
    `  İkinci enstrüman duyuldu: ${heard}`,
    "",
    "Adımlar (sayfanın ölçtüğü · senin söylediğin)",
  ];

  for (const row of rows) lines.push(...stepLines(row));

  lines.push(
    "",
    `Kanıtı gelmemiş adım: ${unproven}`,
    `Hiç denenmemiş adım: ${unreached}`,
    `Cevaplanmamış soru: ${unanswered}`,
    `Kararsız cevap: ${hedged}`,
    `Kullanıcı notu: ${input.note.trim() === "" ? "—" : input.note.trim()}`,
    "",
    `Verdict: ${verdict}`,
  );

  /*
   * The block checks itself before a founder is asked to trust it (§3 step
   * 13). Each name is a way this report has been, or could be, internally
   * contradictory — a pass with an unproven step, a hearing nobody supplied.
   * On `b039d9c` the last of those was printed silently; here it is printed
   * as a defect of the report, in the report.
   */
  const violations = reportInvariants({ rows, verdict, heard });
  if (violations.length > 0) {
    lines.push(
      `Tutarsızlık: ${violations.join(", ")}` +
        " — bu blok kendi içinde çelişiyor, sonucunu geçerli sayma.",
    );
  }

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
