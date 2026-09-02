/**
 * One founder round, bound to the song actually on screen (2V-B.1 §12–§14).
 *
 * ## What changed, and why
 *
 * The 2V-B version of this file hard-coded twelve instructions. That is the
 * defect the founder's Android run exposed from the other end: a step said
 * "listen to the slide" on a fixture that had no slide, and there was nothing
 * in the system that could notice. Instructions are now **generated from a
 * descriptor** built by reading the Song — its title, its section, its bar
 * numbers, its track names, and which techniques the planner will really
 * play. A passage the Song does not have produces a typed unsupported result
 * instead of a question nobody can answer honestly.
 *
 * ## Who says a step is done
 *
 * Not the founder, and not a button. A step that changes the music is
 * completed by a **production workspace event** — the editor saying what it
 * did, after it did it (§13). "Yaptım" is gone: pressing a control on the
 * guide cannot advance a step whose evidence has not arrived, and the screen
 * says which evidence is still missing rather than letting the reader guess.
 *
 * The founder still answers what only a person can: did it sound right, did
 * the control do what its name said. Those answers start **empty**, are keyed
 * to the step that asked, and are required before a step with a physical
 * question can pass (§14).
 */
import type { WorkspaceEditAction } from "@/lib/song/workspace-events";

export type BatchStepId =
  | "extend"
  | "openMore"
  | "listenOnce"
  | "listenLoop"
  | "pauseResume"
  | "copyPaste"
  | "duplicate"
  | "move"
  | "repeat"
  | "deleteUndo"
  /** 11A: one instrument's row. */
  | "trackScope"
  /** 11B: the measure heading, which is every instrument. */
  | "measureScope"
  | "finish";

/**
 * What the page checks for itself while a step is on screen.
 *
 * Judged against the trace of the project record and against the production
 * events the workspace published — never against "the bytes changed".
 */
export type BatchExpectation =
  /** Nothing may be written: one state, and the revision never moves. */
  | { readonly kind: "no_write" }
  /** Exactly one committed edit: one new state, revision up by one. */
  | { readonly kind: "one_write"; readonly action: WorkspaceEditAction }
  /** Written, then taken back: ends byte-identical to where it started. */
  | { readonly kind: "undo_restores"; readonly action: WorkspaceEditAction }
  /** Written, taken back, put forward again: ends on the written bytes. */
  | { readonly kind: "redo_returns"; readonly action: WorkspaceEditAction };

export type BatchQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly string[];
  /** Whether the last option means the product did the wrong thing. */
  readonly breaking: boolean;
};

/**
 * Which passage of the Song a step needs.
 *
 * The descriptor builder reads this and refuses the step when the Song has
 * no such passage, rather than generating an instruction about music that is
 * not there (§12).
 */
export type BatchPassage =
  | "any_written_bar"
  | "held_power_chord"
  | "slide"
  | "vibrato"
  | "legato"
  | "shared_bar"
  | "none";

export type BatchStep = {
  readonly id: BatchStepId;
  readonly title: string;
  /** What the step needs the Song to contain. */
  readonly passage: BatchPassage;
  /** What to notice while doing it. */
  readonly watchFor: string;
  readonly expect: BatchExpectation;
  readonly questions: readonly BatchQuestion[];
};

const YES_NO: readonly string[] = ["Evet", "Kısmen", "Hayır"];
const NONE_SOME: readonly string[] = ["Hayır", "Emin değilim", "Evet"];

export const BATCH_STEPS: readonly BatchStep[] = [
  {
    id: "extend",
    title: "1 · Power chord seç, «Devam»a dokun",
    passage: "held_power_chord",
    watchFor: "Seçim başladığı yerden ileri uzasın; başı kaymasın.",
    expect: { kind: "no_write" },
    questions: [
      {
        id: "extendVisible",
        prompt: "«Devam» ekranda görünür ve basılabilir miydi?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "extendGrew",
        prompt: "Seçim ileri doğru uzadı mı?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "openMore",
    title: "2 · Nota aralığı seç, «Daha fazla»yı aç",
    passage: "any_written_bar",
    watchFor: "Açılan listede «Seçimi dinle» ve «Seçimden döngü» olsun.",
    expect: { kind: "no_write" },
    questions: [
      {
        id: "moreHasListen",
        prompt: "Listede «Seçimi dinle» ve «Seçimden döngü» var mıydı?",
        options: YES_NO,
        breaking: true,
      },
      /*
       * The duplicate-ownership question is gone (2V-B.1 §14). Whether one
       * verb appears on both the row and the drawer is a fact about
       * `selection-action-canon.ts`, which a matrix test already asserts —
       * asking a guitarist to audit it was asking the wrong party, and a
       * wrong answer would have failed a run for a defect that is not there.
       */
    ],
  },
  {
    id: "listenOnce",
    title: "3 · Seçimi bir kez dinle",
    passage: "any_written_bar",
    watchFor: "Seçimin başından başlasın, yalnız seçimi çalsın, bir kez bitsin.",
    expect: { kind: "no_write" },
    questions: [
      {
        id: "onceStart",
        prompt: "Ses seçimin başından mı başladı?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "onceScope",
        prompt: "Yalnız seçtiğin yer mi çaldı?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "onceEnd",
        prompt: "Seçimin sonunda tek seferde durdu mu?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "listenLoop",
    title: "4 · Seçimden döngü",
    passage: "any_written_bar",
    watchFor: "Turlar arasında boşluk, çift atak veya tempo kayması var mı?",
    expect: { kind: "no_write" },
    questions: [
      {
        id: "loopGap",
        prompt: "Turlar arasında boşluk var mıydı?",
        options: ["Yok", "Biraz", "Var"],
        breaking: true,
      },
      { id: "loopDouble", prompt: "Baştaki nota iki kez mi çalıyordu?", options: NONE_SOME, breaking: true },
      {
        id: "loopClosed",
        prompt: "«Seçim döngüsünü kapat»a dokununca döngü hemen bitti mi?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "pauseResume",
    title: "5 · Slide'ın ortasında duraklat, sonra devam et",
    passage: "slide",
    watchFor: "Aynı yerden devam etsin; nota baştan çalınmasın.",
    expect: { kind: "no_write" },
    questions: [
      { id: "resumedSamePlace", prompt: "Aynı yerden mi devam etti?", options: YES_NO, breaking: true },
      {
        id: "resumedWithoutRestrike",
        prompt: "Devam ederken nota baştan çalınmış gibi oldu mu?",
        options: NONE_SOME,
        breaking: true,
      },
    ],
  },
  {
    id: "copyPaste",
    title: "6 · Kopyala, yapıştır, geri al, ileri al",
    passage: "any_written_bar",
    watchFor: "Yapıştırılan yer doğru olsun; geri alınca eski hâline dönsün.",
    expect: { kind: "redo_returns", action: "paste" },
    questions: [
      { id: "pasteLanded", prompt: "Yapıştırdığın şey doğru yere mi geldi?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "duplicate",
    title: "7 · Çoğalt",
    passage: "any_written_bar",
    watchFor: "Kopya hemen ardına gelsin; Geri al ve İleri al aynı müziği versin.",
    expect: { kind: "redo_returns", action: "duplicate" },
    questions: [
      { id: "duplicatePlaced", prompt: "Kopya hemen ardına mı geldi?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "move",
    title: "8 · Taşı",
    passage: "any_written_bar",
    watchFor: "Seçim bir adım kaysın; Geri al ve İleri al aynı müziği versin.",
    expect: { kind: "redo_returns", action: "move" },
    questions: [
      { id: "moveStepped", prompt: "Seçim istediğin kadar mı kaydı?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "repeat",
    title: "9 · Tekrarla",
    passage: "any_written_bar",
    watchFor: "Tekrar sessizlikleri taşısın; Geri al ve İleri al aynı müziği versin.",
    expect: { kind: "redo_returns", action: "repeat" },
    questions: [
      { id: "repeatKeptRests", prompt: "Tekrar, aradaki sessizlikleri de taşıdı mı?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "deleteUndo",
    title: "10 · Sil, sonra geri al",
    passage: "any_written_bar",
    watchFor: "Silinen notalar aynı yere geri gelsin; sonra İleri al'a dokun.",
    expect: { kind: "redo_returns", action: "delete" },
    questions: [
      {
        /*
         * The wording §14 asks for, word for word. The old version asked
         * "did undo bring back what you deleted", which a reader can answer
         * "yes" to while looking at notes that came back somewhere else.
         */
        id: "deleteCameBack",
        prompt: "Aynı notalar aynı yere geri geldi mi?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    /*
     * 11A and 11B were one step, and that is why the last round could not
     * tell whether the two scopes were different (§14). One step asked two
     * questions about two gestures and recorded one measurement; split, each
     * has its own filter, and the page compares the two itself.
     */
    id: "trackScope",
    title: "11A · Bir enstrümanın satırını dinle",
    passage: "any_written_bar",
    watchFor: "Yalnız o enstrüman duyulsun.",
    expect: { kind: "no_write" },
    questions: [
      { id: "trackScopeOnly", prompt: "Yalnız gitarı mı duydun?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "measureScope",
    title: "11B · Ölçü başlığını dinle",
    passage: "shared_bar",
    watchFor: "Gitar ve bas birlikte duyulsun.",
    expect: { kind: "no_write" },
    questions: [
      {
        /*
         * Asked about what a phone speaker can actually settle (2V-B.2 §5).
         *
         * "Did you hear them together" is unanswerable when one of the two is
         * below what the speaker radiates: the founder's honest report was
         * "maybe, in headphones" — which is neither a pass nor a fail, and a
         * question that cannot be answered wrongly cannot be answered rightly
         * either. The bass was rewritten into a register the device can
         * reproduce; the question now names the device it is answered on.
         */
        id: "allScopeTogether",
        prompt:
          "Gitarın yanında ikinci, daha kalın partiyi telefon hoparlöründe ayırt edebildin mi?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "finish",
    title: "12 · Sonuç",
    passage: "none",
    watchFor: "",
    expect: { kind: "no_write" },
    questions: [
      {
        id: "actionsFindable",
        prompt: "Aradığın işlemi bulmak kolay mıydı?",
        options: YES_NO,
        breaking: false,
      },
    ],
  },
];

/** Every question the steps ask, flattened, in order. */
export const ALL_BATCH_QUESTIONS = BATCH_STEPS.flatMap((step) =>
  step.questions.map((question) => ({ step: step.id, ...question })),
);

/**
 * Which answer means the product did the wrong thing.
 *
 * Written out rather than taken from the option's position, because a question
 * whose options are reordered one day should break a test rather than quietly
 * invert a verdict.
 */
export const BATCH_BROKEN: Readonly<Record<string, string>> = {
  extendVisible: "Hayır",
  extendGrew: "Hayır",
  moreHasListen: "Hayır",
  onceStart: "Hayır",
  onceScope: "Hayır",
  onceEnd: "Hayır",
  loopGap: "Var",
  loopDouble: "Evet",
  loopClosed: "Hayır",
  resumedSamePlace: "Hayır",
  resumedWithoutRestrike: "Evet",
  pasteLanded: "Hayır",
  duplicatePlaced: "Hayır",
  moveStepped: "Hayır",
  repeatKeptRests: "Hayır",
  deleteCameBack: "Hayır",
  trackScopeOnly: "Hayır",
  allScopeTogether: "Hayır",
};

/**
 * What the project record did while a step was on screen.
 *
 * `states` is the record's bytes, consecutive duplicates collapsed, in the
 * order they were seen; `revisions` is the revision at each of those moments.
 * `events` is what the production workspace actually said it did — the
 * difference between "the bytes changed" and "the editor pasted" (§13).
 */
export type BatchTrace = {
  readonly states: readonly string[];
  readonly revisions: readonly number[];
  /**
   * The history's depth at each of those moments, and the writes the
   * disposable store had taken by then (2V-B.1 §5).
   *
   * Sampled beside the bytes rather than reconstructed afterwards. A ledger
   * that filled these in from what it expected would be a ledger measuring
   * its own expectations — which is the shape of every wrong-green this
   * round exists to remove.
   */
  readonly histories?: readonly number[];
  readonly writes?: readonly number[];
  /** Production edit events seen while this step was on screen, in order. */
  readonly events: readonly {
    readonly action: WorkspaceEditAction;
    readonly mutating: boolean;
  }[];
};

/** Why a step has not passed yet, in words the screen can show. */
export type BatchShortfall =
  | "no_production_event"
  | "wrong_action"
  | "no_write_expected"
  | "write_not_atomic"
  | "undo_did_not_restore"
  | "redo_did_not_return"
  | "unanswered";

export type BatchJudgement = {
  readonly passed: boolean;
  readonly shortfalls: readonly BatchShortfall[];
};

/**
 * Did this step really happen?
 *
 * Both halves have to agree. The record says how many committed edits there
 * were and whether undo came back byte-exact; the event stream says the
 * editor performed the action the step asked for. A step that has one without
 * the other has not passed — which is precisely what makes pressing a button
 * on the guide unable to advance anything (§13).
 */
export function judgeBatchStep(
  expect: BatchExpectation,
  trace: BatchTrace,
): BatchJudgement {
  const shortfalls: BatchShortfall[] = [];
  const states = trace.states;
  const first = states[0];
  const last = states[states.length - 1];
  const moved =
    (trace.revisions[trace.revisions.length - 1] ?? 0) - (trace.revisions[0] ?? 0);

  if (first === undefined || last === undefined) {
    return { passed: false, shortfalls: ["no_production_event"] };
  }

  if (expect.kind === "no_write") {
    /*
     * A reading step. There is no production event to wait for — listening
     * and selecting produce none — so what is measured is that nothing was
     * written, and the founder's answer carries the rest.
     */
    if (!(states.length === 1 && moved === 0)) shortfalls.push("no_write_expected");
    return { passed: shortfalls.length === 0, shortfalls };
  }

  const mutations = trace.events.filter((event) => event.mutating);
  const matching = mutations.filter((event) => event.action === expect.action);
  if (mutations.length === 0) shortfalls.push("no_production_event");
  else if (matching.length === 0) shortfalls.push("wrong_action");

  switch (expect.kind) {
    case "one_write":
      /* One new state and one commit — not two, and not a preview only. */
      if (!(states.length === 2 && last !== first && moved === 1)) {
        shortfalls.push("write_not_atomic");
      }
      break;
    case "undo_restores":
      /*
       * Something really happened and was really taken back. Pressing
       * nothing leaves one state and fails here, which is the whole point.
       */
      if (!(states.length >= 3 && last === first && moved >= 2)) {
        shortfalls.push("undo_did_not_restore");
      }
      break;
    case "redo_returns":
      /*
       * Start, written, back to start, written again — and the fourth state
       * must be byte-identical to the second, or "İleri al" did not put back
       * what "Geri al" took.
       */
      if (!(states.length >= 4 && last !== first && last === states[1] && moved >= 3)) {
        shortfalls.push("redo_did_not_return");
      }
      break;
  }

  return { passed: shortfalls.length === 0, shortfalls };
}

/**
 * Answers, keyed by question id.
 *
 * `null` and absent both mean unanswered, and both are the state a question
 * starts in. Nothing is ever preselected: an answer the reader did not give
 * is an answer the report may not carry (§14).
 */
export type BatchAnswers = Readonly<Record<string, string | null>>;

/** True when every question this step asks has a real answer. */
export function stepAnswered(stepId: BatchStepId, answers: BatchAnswers): boolean {
  const step = BATCH_STEPS.find((entry) => entry.id === stepId);
  if (!step) return false;
  return step.questions.every((question) => {
    const given = answers[question.id];
    return given !== undefined && given !== null && given !== "";
  });
}

export type BatchEnvironment = {
  /** `navigator.maxTouchPoints`. Zero is a desktop, whatever else it says. */
  readonly touchPoints: number;
  readonly consoleErrors: readonly string[];
  /** The device's own store, before and after. Must be identical. */
  readonly userStorageBefore: string;
  readonly userStorageAfter: string;
  /** Which steps the page measured as passing, by id. */
  readonly measured: Readonly<Record<string, boolean | null>>;
  /**
   * Which track filter each of the two listening scopes actually used (§14).
   *
   * Measured rather than asked. "Did you hear only the guitar" and "did you
   * hear both" can both be answered yes by a run in which the two gestures
   * sent the same thing to the engine, and no founder can tell the
   * difference from the sound alone.
   */
  readonly trackScopeFilter?: readonly string[] | null;
  readonly measureScopeFilter?: readonly string[] | null;
  /** Whether the second instrument in the shared bar really made a sound. */
  readonly secondTrackAudible?: boolean | null;
  /**
   * The reader pressed "Burada bitir" rather than reaching the end (§3).
   *
   * A separate fact from "some steps were not measured", which is what
   * `measured` already records. Both are true of an early finish; only this
   * one says the reader was *stuck*, and that is the sentence a defect report
   * is built from.
   */
  readonly endedEarly?: boolean;
};

export type BatchVerdict = "PASS" | "FAIL" | "PARTIAL" | "BLOCKED";

/**
 * What this run is entitled to claim.
 *
 * `FAIL` the moment something measured breaks — a step's own trace, the
 * device's store, the console, the two scopes turning out to be one — or a
 * founder says the product did the wrong thing. Measured breakage outranks
 * everything.
 *
 * `PARTIAL` when nothing is broken but a step was never measured or a question
 * never answered, **and** when the environment has no touch. A desktop browser
 * can run every step of this; what it cannot do is be a phone, and this round
 * exists because a phone found what ten green runs did not.
 */
export function batchVerdict(
  environment: BatchEnvironment,
  answers: BatchAnswers,
): BatchVerdict {
  if (environment.userStorageBefore !== environment.userStorageAfter) return "FAIL";
  if (environment.consoleErrors.length > 0) return "FAIL";
  if (BATCH_STEPS.some((step) => environment.measured[step.id] === false)) return "FAIL";

  /*
   * The two scopes, compared by the page (§14). Equal filters mean the
   * measure heading and the track row asked the engine for the same music,
   * and every "yes" the founder gave about hearing a difference was about
   * something else.
   */
  const track = environment.trackScopeFilter;
  const measure = environment.measureScopeFilter;
  if (track && measure && sameFilter(track, measure)) return "FAIL";
  if (environment.secondTrackAudible === false) return "FAIL";

  const breaking = ALL_BATCH_QUESTIONS.filter((question) => question.breaking);
  if (breaking.some((question) => answers[question.id] === BATCH_BROKEN[question.id])) {
    return "FAIL";
  }

  /*
   * The reader stopped because they could not go on (2V-B.2 §3).
   *
   * Below every measured break and above every unfinished-run outcome. Below,
   * because a device store that moved is a defect whether or not the founder
   * was stuck, and a `BLOCKED` that swallowed it would be this escape hatch
   * quietly destroying evidence. Above `PARTIAL`, because "ran out of steps"
   * and "was stopped by the product" are different facts and only the second
   * one is a bug report. What it can never be is `PASS`: every return of that
   * value is below this line.
   */
  if (environment.endedEarly === true) return "BLOCKED";

  /* A step that was skipped was not measured, and a skip is never a pass. */
  if (BATCH_STEPS.some((step) => environment.measured[step.id] == null)) return "PARTIAL";
  if (ALL_BATCH_QUESTIONS.some((question) => !answers[question.id])) return "PARTIAL";
  if (track === undefined || measure === undefined) return "PARTIAL";
  if (track === null || measure === null) return "PARTIAL";
  if (environment.touchPoints === 0) return "PARTIAL";
  return "PASS";
}

function sameFilter(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().join("|") === [...right].sort().join("|")
  );
}

/** Whether an answer is one of the middle, non-committal ones. */
const HEDGED: readonly string[] = ["Kısmen", "Emin değilim", "Biraz"];

export function isBatchHedged(answer: string | null): boolean {
  return answer !== null && HEDGED.includes(answer);
}
