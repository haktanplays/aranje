/**
 * One founder round for the whole editor action set (2V-B §9).
 *
 * ## Why this replaces the per-defect link
 *
 * Three rounds in a row ended by sending a founder a new URL for one control:
 * the clipboard link, the "Devam" link, the listening link. Each was answered
 * honestly and each found the next defect somewhere the link did not go — the
 * listening round could not even reach step 2, because the sheet it named held
 * one unrelated verb.
 *
 * So this is one route over every selection action the editor has, in the
 * order a musician would meet them, and it ends with one block.
 *
 * ## Who answers what
 *
 * The founder answers what only a person can: did it sound right, did the
 * control do what its name said, was it findable. Bytes, history and storage
 * are not questions for a human — the page measures those itself, from the
 * project record the app writes, and a step whose measurement failed is a
 * FAIL whatever the founder ticked.
 *
 * That division is the point. A guide that asks "did undo restore your music"
 * is asking someone to eyeball a diff; a guide that measures the bytes and
 * asks "did it feel instant" is asking each party what it can actually know.
 */

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
  | "measureScopes"
  | "finish";

/**
 * What the page checks for itself while a step is on screen.
 *
 * Judged against the trace of the project record — the bytes it holds and the
 * revision it carries — sampled while the founder works, not against a count
 * this page keeps.
 */
export type BatchExpectation =
  /** Nothing may be written: one state, and the revision never moves. */
  | { readonly kind: "no_write" }
  /** Exactly one committed edit: one new state, revision up by one. */
  | { readonly kind: "one_write" }
  /** Written, then taken back: ends byte-identical to where it started. */
  | { readonly kind: "undo_restores" }
  /** Written, taken back, put forward again: ends on the written bytes. */
  | { readonly kind: "redo_returns" };

export type BatchQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly string[];
  /** Whether the last option means the product did the wrong thing. */
  readonly breaking: boolean;
};

export type BatchStep = {
  readonly id: BatchStepId;
  readonly title: string;
  /** What to do, in one sentence. */
  readonly task: string;
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
    task: "İlk akora basılı tut, sonra «Devam»a dokun ve ileride bir yere uzun bas.",
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
    task: "Birkaç notaya basılı tutup sağa sürükle, sonra «Daha fazla»ya dokun.",
    watchFor: "Açılan listede «Seçimi dinle» ve «Seçimden döngü» olsun.",
    expect: { kind: "no_write" },
    questions: [
      {
        id: "moreHasListen",
        prompt: "Listede «Seçimi dinle» ve «Seçimden döngü» var mıydı?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "moreNoDuplicate",
        prompt: "Aynı işlem hem ızgarada hem listede tekrar ediyor muydu?",
        options: NONE_SOME,
        breaking: true,
      },
    ],
  },
  {
    id: "listenOnce",
    title: "3 · Seçimi dinle",
    task: "«Seçimi dinle»ye dokun.",
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
    task: "«Seçimden döngü»ye dokun ve en az üç tur dinle.",
    watchFor: "Turlar arasında boşluk, çift atak veya tempo kayması var mı?",
    expect: { kind: "no_write" },
    questions: [
      { id: "loopGap", prompt: "Turlar arasında boşluk var mıydı?", options: ["Yok", "Biraz", "Var"], breaking: true },
      { id: "loopDouble", prompt: "Baştaki nota iki kez mi çalıyordu?", options: NONE_SOME, breaking: true },
      { id: "loopTempo", prompt: "Tempo turdan tura kaydı mı?", options: ["Kaymadı", "Emin değilim", "Kaydı"], breaking: true },
    ],
  },
  {
    id: "pauseResume",
    title: "5 · Duraklat, devam et, döngüyü kapat",
    task: "Döngü çalarken duraklat, devam ettir, sonra «Seçim döngüsünü kapat»a dokun.",
    watchFor: "Aynı yerden devam etsin; kapatınca ses hemen ve temiz dursun.",
    expect: { kind: "no_write" },
    questions: [
      { id: "resumedSamePlace", prompt: "Aynı yerden devam etti mi?", options: YES_NO, breaking: true },
      { id: "loopStoppedClean", prompt: "Kapatınca arkada çalan bir şey kaldı mı?", options: ["Kalmadı", "Emin değilim", "Kaldı"], breaking: true },
    ],
  },
  {
    id: "copyPaste",
    title: "6 · Kopyala, yapıştır, geri al, ileri al",
    task: "«Kopyala»ya dokun, başka bir yer seçip «Yapıştır» ile uygula; sonra «Geri al», sonra «İleri al».",
    watchFor: "Yapıştırılan yer doğru olsun; geri alınca eski hâline dönsün.",
    expect: { kind: "redo_returns" },
    questions: [
      { id: "pasteLanded", prompt: "Yapıştırdığın şey doğru yere mi geldi?", options: YES_NO, breaking: true },
      { id: "undoFelt", prompt: "«Geri al» müziği eski hâline döndürdü mü?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "duplicate",
    title: "7 · Çoğalt",
    task: "Bir seçim yap ve «Çoğalt»a dokun.",
    watchFor: "Kopya hemen ardına gelsin, üstüne binmesin.",
    expect: { kind: "one_write" },
    questions: [
      { id: "duplicatePlaced", prompt: "Kopya hemen ardına mı geldi?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "move",
    title: "8 · Taşı",
    task: "Bir seçim yap, «Taşı» ile bir adım sağa taşı ve uygula.",
    watchFor: "Seçim bir adım kaysın; başka bir şey değişmesin.",
    expect: { kind: "one_write" },
    questions: [
      { id: "moveStepped", prompt: "Seçim istediğin kadar mı kaydı?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "repeat",
    title: "9 · Tekrarla",
    task: "Bir seçim yap, «Tekrarla» ile iki kez tekrarla ve uygula.",
    watchFor: "Tekrar, seçimin içindeki sessizlikleri de taşısın.",
    expect: { kind: "one_write" },
    questions: [
      { id: "repeatKeptRests", prompt: "Tekrar, aradaki sessizlikleri de taşıdı mı?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "deleteUndo",
    title: "10 · Sil, sonra geri al",
    task: "Bir seçim yapıp «Sil»e dokun, sonra «Geri al».",
    watchFor: "Silinen yer geri gelsin.",
    expect: { kind: "undo_restores" },
    questions: [
      { id: "deleteCameBack", prompt: "«Geri al» sildiğin yeri geri getirdi mi?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "measureScopes",
    title: "11 · İki ölçüyü iki kapsamda dinle",
    task: "İki ölçü seç; «Bu enstrüman» ile dinle, sonra «Tüm enstrümanlar» ile dinle.",
    watchFor: "İlkinde tek enstrüman, ikincisinde hepsi duyulsun.",
    expect: { kind: "no_write" },
    questions: [
      { id: "trackScopeOnly", prompt: "«Bu enstrüman»da yalnız o enstrüman mı çaldı?", options: YES_NO, breaking: true },
      { id: "allScopeTogether", prompt: "«Tüm enstrümanlar»da hepsi birlikte mi çaldı?", options: YES_NO, breaking: true },
    ],
  },
  {
    id: "finish",
    title: "12 · Sonuç",
    task: "Aşağıdaki bloğu kopyala ve gönder.",
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

/** Every question the twelve steps ask, flattened, in order. */
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
  moreNoDuplicate: "Evet",
  onceStart: "Hayır",
  onceScope: "Hayır",
  onceEnd: "Hayır",
  loopGap: "Var",
  loopDouble: "Evet",
  loopTempo: "Kaydı",
  resumedSamePlace: "Hayır",
  loopStoppedClean: "Kaldı",
  pasteLanded: "Hayır",
  undoFelt: "Hayır",
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
 * The app writes the record once per committed edit, so a revision that moved
 * by one is one history step and one storage write — said by the thing that
 * did them rather than by a counter this page keeps.
 */
export type BatchTrace = {
  readonly states: readonly string[];
  readonly revisions: readonly number[];
};

export function judgeBatchStep(expect: BatchExpectation, trace: BatchTrace): boolean {
  const states = trace.states;
  const first = states[0];
  const last = states[states.length - 1];
  const moved =
    (trace.revisions[trace.revisions.length - 1] ?? 0) - (trace.revisions[0] ?? 0);
  if (first === undefined || last === undefined) return false;

  switch (expect.kind) {
    case "no_write":
      return states.length === 1 && moved === 0;
    case "one_write":
      /* One new state and one commit — not two, and not a preview only. */
      return states.length === 2 && last !== first && moved === 1;
    case "undo_restores":
      /*
       * Something really happened and was really taken back. Pressing nothing
       * leaves one state and fails here, which is the whole point: a step that
       * can be passed by pressing "Yaptım" is not a step.
       */
      return states.length >= 3 && last === first && moved >= 2;
    case "redo_returns":
      /*
       * Start, written, back to start, written again — and the fourth state
       * must be byte-identical to the second, or "İleri al" did not put back
       * what "Geri al" took.
       */
      return (
        states.length >= 4 && last !== first && last === states[1] && moved >= 3
      );
  }
}

export type BatchAnswers = Readonly<Record<string, string | null>>;

export type BatchEnvironment = {
  /** `navigator.maxTouchPoints`. Zero is a desktop, whatever else it says. */
  readonly touchPoints: number;
  readonly consoleErrors: readonly string[];
  /** The device's own store, before and after. Must be identical. */
  readonly userStorageBefore: string;
  readonly userStorageAfter: string;
  /** Which steps the page measured as passing, by id. */
  readonly measured: Readonly<Record<string, boolean | null>>;
};

export type BatchVerdict = "PASS" | "FAIL" | "PARTIAL";

/**
 * What this run is entitled to claim.
 *
 * `FAIL` the moment something measured breaks — a step's own trace, the
 * device's store, the console — or a founder says the product did the wrong
 * thing. Measured breakage outranks everything.
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

  const breaking = ALL_BATCH_QUESTIONS.filter((question) => question.breaking);
  if (breaking.some((question) => answers[question.id] === BATCH_BROKEN[question.id])) {
    return "FAIL";
  }

  /* A step that was skipped was not measured, and a skip is never a pass. */
  if (BATCH_STEPS.some((step) => environment.measured[step.id] == null)) return "PARTIAL";
  if (ALL_BATCH_QUESTIONS.some((question) => !answers[question.id])) return "PARTIAL";
  if (environment.touchPoints === 0) return "PARTIAL";
  return "PASS";
}

/** Whether an answer is one of the middle, non-committal ones. */
const HEDGED: readonly string[] = ["Kısmen", "Emin değilim", "Biraz"];

export function isBatchHedged(answer: string | null): boolean {
  return answer !== null && HEDGED.includes(answer);
}
