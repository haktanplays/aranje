/**
 * The block the founder copies out, and the verdict the page may give
 * (2U-A handoff §6).
 *
 * ## The one rule this file exists to enforce
 *
 * The page may say the machine found nothing wrong. It may never say the
 * founder accepted anything. Those are different claims, and only one of them
 * is the page's to make — so `automatedVerdict` returns `PASS`, `FAIL` or
 * `PARTIAL`, and the founder line is a constant that says the founder has not
 * filled it in. There is no argument, no flag and no code path that turns
 * clean automation into a founder pass.
 *
 * `PARTIAL` is the interesting one. Automation clean but a question
 * unanswered is not a pass, because the questions are the half of the test a
 * machine cannot run: "did you understand what Devam would do" has no
 * measurement, and a report that quietly dropped it would be a report about
 * the easy half.
 */
import { BRAND_NAME } from "@/lib/brand";
import {
  EDITOR_STEPS,
  stepVerdict,
  type Check,
  type StepId,
} from "@/lib/acceptance/editor-steps";
import { shortSha, type VersionGate } from "@/lib/acceptance/build-id";

export type EditorAnswers = Readonly<Record<string, string | null>>;

export type EditorDevice = {
  readonly date: string;
  readonly viewport: string;
  readonly platform: string;
  readonly touchPoints: number;
  readonly userAgent: string;
};

export type EditorObservations = {
  readonly checks: Readonly<Record<string, Check>>;
  readonly consoleErrors: readonly string[];
  /** The device's own store, before and after. Must be identical. */
  readonly userStorageBefore: string;
  readonly userStorageAfter: string;
};

export type AutomatedVerdict = "PASS" | "FAIL" | "PARTIAL";

/** Every question the seven steps ask, flattened, in order. */
export const ALL_QUESTIONS = EDITOR_STEPS.flatMap((step) =>
  step.questions.map((question) => ({ step: step.id, ...question })),
);

/**
 * What the automation alone is entitled to say.
 *
 * `FAIL` the moment anything measured came back false, or the device's own
 * store moved, or the page threw. `PARTIAL` when the measurements are clean
 * but something is still unanswered — an unreached step or an unanswered
 * question. `PASS` only when everything measurable passed and every question
 * has an answer, and even then it is a statement about the machine's half.
 */
export function automatedVerdict(
  observations: EditorObservations,
  answers: EditorAnswers,
): AutomatedVerdict {
  if (observations.userStorageBefore !== observations.userStorageAfter) return "FAIL";
  if (observations.consoleErrors.length > 0) return "FAIL";

  const verdicts = EDITOR_STEPS.map((step) => stepVerdict(step, observations.checks));
  if (verdicts.includes("fail")) return "FAIL";
  if (verdicts.includes("pending")) return "PARTIAL";
  if (ALL_QUESTIONS.some((question) => !answers[question.id])) return "PARTIAL";
  return "PASS";
}

const MARK: Readonly<Record<string, string>> = {
  pass: "PASS",
  fail: "FAIL",
  pending: "—",
};

/** One line per row of the handoff's own result format. */
const ROW_KEYS: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
  {
    label: "Devam",
    keys: [
      "extendSelected",
      "extendArmed",
      "extendGrew",
      "extendShrank",
      "extendComposerClosed",
      "patternToolReachable",
    ],
  },
  {
    label: "Kopyala/yapıştır",
    keys: [
      "copyNoWrite",
      "pasteTargetPicked",
      "pasteCancelled",
      "pasteApplied",
    ],
  },
  {
    label: "Undo/redo",
    keys: ["historyMarked", "undoByteEqual", "redoByteEqual"],
  },
  { label: "Zamanda taşı", keys: ["moveSelected", "moveTimeRight", "moveTimeLeft"] },
  {
    label: "Perde taşı",
    keys: ["movePitchUp", "movePitchDown", "moveOctaveUp", "moveOctaveDown"],
  },
  {
    label: "Telde taşı",
    keys: ["moveStringThin", "moveStringThick", "moveKeptSoundingPitch", "moveNoOverwrite"],
  },
  {
    label: "Nota/ölçü ayrımı",
    keys: [
      "scopeNoteSelected",
      "scopeMeasureSelected",
      "noteHidesMeasureVerbs",
      "measureOffersMeasureVerbs",
    ],
  },
  {
    label: "Ölçü işlemleri",
    keys: [
      "measureInserted",
      "measureDuplicated",
      "measureMovedRight",
      "measureMovedLeft",
      "measureDeleted",
      "measureAllTracksAligned",
      "measureOtherTrackKept",
    ],
  },
  {
    label: "Çoklu ölçü",
    keys: ["multiMarked", "multiRepeatOneHistory", "multiUndoByteEqual"],
  },
  {
    label: "UI Contract",
    keys: [
      "sixStringsVisible",
      "noNewToolbarRow",
      "noBodyOverflow",
      "noStaffScroller",
      "noTruncatedLabel",
      "allTargets44",
      "contractLooked",
    ],
  },
];

function rowMark(
  keys: readonly string[],
  checks: Readonly<Record<string, Check>>,
): string {
  const values = keys.map((key) => checks[key] ?? null);
  if (values.some((value) => value === false)) {
    const failed = keys.filter((key) => checks[key] === false);
    return `FAIL (${failed.join(", ")})`;
  }
  if (values.some((value) => value === null)) return "—";
  return "PASS";
}

const gateLine = (gate: VersionGate): string => {
  switch (gate.kind) {
    case "match":
      return `${shortSha(gate.actual)} (beklenen sürüm doğrulandı)`;
    case "unpinned":
      return `${shortSha(gate.actual)} (beklenen sürüm verilmedi)`;
    case "mismatch":
      return `${shortSha(gate.actual)} — ${gate.message}`;
    case "unknown":
      return `bilinmiyor — ${gate.message}`;
  }
};

export function formatEditorResult(input: {
  readonly gate: VersionGate;
  readonly device: EditorDevice;
  readonly observations: EditorObservations;
  readonly answers: EditorAnswers;
  readonly notes: string;
}): string {
  const { gate, device, observations, answers, notes } = input;
  const verdict = automatedVerdict(observations, answers);
  const said = (id: string): string => answers[id] ?? "—";

  const stepLine = (id: StepId): string => {
    const step = EDITOR_STEPS.find((entry) => entry.id === id)!;
    return MARK[stepVerdict(step, observations.checks)] ?? "—";
  };

  return [
    `${BRAND_NAME} Faz 2U-A Founder Editor Acceptance`,
    "",
    `Build SHA: ${gateLine(gate)}`,
    `Tarih: ${device.date}`,
    `Viewport: ${device.viewport}`,
    `Platform: ${device.platform || "—"}`,
    `Touch: ${device.touchPoints}`,
    "",
    ...ROW_KEYS.map(
      (row) => `${row.label}: ${rowMark(row.keys, observations.checks)}`,
    ),
    `User storage unchanged: ${
      observations.userStorageBefore === observations.userStorageAfter ? "PASS" : "FAIL"
    }`,
    `Console errors: ${
      observations.consoleErrors.length === 0
        ? "0"
        : `${observations.consoleErrors.length} — ${observations.consoleErrors
            .slice(0, 3)
            .join(" | ")}`
    }`,
    "",
    `Devam anlaşılır mı: ${said("extendClear")}`,
    `Taşı anlaşılır mı: ${said("moveClear")}`,
    `UI tanıdık kaldı mı: ${said("familiar")}`,
    `Beklenmedik bir şey oldu mu: ${said("surprise")}`,
    `Notlar: ${notes.trim() === "" ? "—" : notes.trim()}`,
    "",
    `Adımlar: ${EDITOR_STEPS.map((step) => `${step.title.split(" ")[0]}=${stepLine(step.id)}`).join(" ")}`,
    "",
    `Automated verdict: ${verdict}`,
    /*
     * A constant. The page has no way to write anything else here, because
     * the only thing that could fill it in is a person who is not the page.
     */
    "Founder verdict: Haktan doldurmadı",
  ].join("\n");
}
