/**
 * The eight things a founder is asked to listen for (2V-A.1 §8, §9).
 *
 * ## Why this is a separate guide from the editor's
 *
 * `/eval/editor-acceptance` is the general editor test: thirty-six phases
 * over selection, clipboard, undo, movement and rhythm. It is not the
 * listening test, and running it and calling the result a listening result is
 * how a round comes to be "accepted" without anybody having heard anything.
 *
 * So this is its own route with its own eight steps, and every one of them is
 * a question only a pair of ears can answer.
 *
 * ## One task per screen, in the reader's own words
 *
 * No step says "tick", "scope", "descriptor" or "scheduler". A founder is
 * asked to hold some notes, press a named control, and say what they heard —
 * and the questions are the ones a musician would ask anyway: did it start in
 * the right place, was there a gap, did anything play twice, did the tempo
 * wander.
 */

export type ListeningStepId =
  | "select"
  | "audition"
  | "loop"
  | "pause"
  | "cancel"
  | "trackScope"
  | "allScope"
  | "finish";

export type ListeningQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly string[];
  /**
   * Whether a "no" here means the round is broken rather than unfinished.
   *
   * The listening questions are: a "Hayır" is a FAIL, because it is a founder
   * saying the music did the wrong thing. The clarity questions are not — a
   * reader finding a control confusing is a real finding and not a break.
   */
  readonly breaking: boolean;
};

export type ListeningStep = {
  readonly id: ListeningStepId;
  readonly title: string;
  /** What to do, in one sentence. */
  readonly task: string;
  /** What to listen for while doing it. */
  readonly listenFor: string;
  readonly questions: readonly ListeningQuestion[];
};

const YES_NO: readonly string[] = ["Evet", "Kısmen", "Hayır"];

export const LISTENING_STEPS: readonly ListeningStep[] = [
  {
    id: "select",
    title: "1 · Bir yer seç",
    task: "Tab'da birkaç notaya basılı tutup parmağını sağa sürükle.",
    listenFor: "Seçim açıldı ve tuttuğun yer işaretlendi mi?",
    questions: [
      {
        id: "selectionOpened",
        prompt: "Seçim istediğin yerde açıldı mı?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "audition",
    title: "2 · Seçimi bir kez dinle",
    task: "«Daha fazla» → «Seçimi dinle».",
    listenFor:
      "Seçtiğin yerin başından başlasın, yalnız seçtiğin yeri çalsın ve bir kez bitsin.",
    questions: [
      {
        id: "auditionStart",
        prompt: "Ses seçimin başından mı başladı?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "auditionScope",
        prompt: "Yalnız seçtiğin yer mi çaldı?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "auditionEnd",
        prompt: "Seçimin sonunda tek seferde durdu mu?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "loop",
    title: "3 · Seçimden döngü",
    task: "«Daha fazla» → «Seçimden döngü». En az üç tur dinle.",
    listenFor: "Turlar arasında boşluk, çift atak veya hızlanma/yavaşlama var mı?",
    questions: [
      {
        id: "loopGap",
        prompt: "Turlar arasında boşluk var mıydı?",
        options: ["Yok", "Biraz", "Var"],
        breaking: true,
      },
      {
        id: "loopDoubleAttack",
        prompt: "Baştaki nota iki kez mi çalıyordu?",
        options: ["Hayır", "Emin değilim", "Evet"],
        breaking: true,
      },
      {
        id: "loopTempo",
        prompt: "Tempo turdan tura kaydı mı?",
        options: ["Kaymadı", "Emin değilim", "Kaydı"],
        breaking: true,
      },
    ],
  },
  {
    id: "pause",
    title: "4 · Duraklat ve devam et",
    task: "Döngü çalarken duraklat, sonra tekrar başlat.",
    listenFor: "Aynı yerden devam etsin; ikinci bir ses başlamasın.",
    questions: [
      {
        id: "pauseResumed",
        prompt: "Aynı yerden devam etti mi?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "pauseSingleVoice",
        prompt: "Üst üste binen ikinci bir ses duydun mu?",
        options: ["Hayır", "Emin değilim", "Evet"],
        breaking: true,
      },
    ],
  },
  {
    id: "cancel",
    title: "5 · Seçimi iptal et",
    task: "«Seçimi iptal et»e dokun.",
    listenFor: "Ses hemen ve temiz dursun; arkada bir şey kalmasın.",
    questions: [
      {
        id: "cancelStopped",
        prompt: "Ses hemen durdu mu?",
        options: YES_NO,
        breaking: true,
      },
      {
        id: "cancelClean",
        prompt: "Arkada çalmaya devam eden bir şey kaldı mı?",
        options: ["Kalmadı", "Emin değilim", "Kaldı"],
        breaking: true,
      },
    ],
  },
  {
    id: "trackScope",
    title: "6 · İki ölçü, bu enstrüman",
    task: "Düzen görünümünde iki ölçü seç, «Bu enstrüman» kapsamıyla dinle.",
    listenFor: "Yalnız o enstrüman duyulsun.",
    questions: [
      {
        id: "trackScopeOnly",
        prompt: "Yalnız seçtiğin enstrüman mı çaldı?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "allScope",
    title: "7 · Aynı ölçüler, tüm enstrümanlar",
    task: "Aynı iki ölçüyü «Tüm enstrümanlar» kapsamıyla dinle.",
    listenFor: "Bütün enstrümanlar birlikte ve aynı yerden duyulsun.",
    questions: [
      {
        id: "allScopeTogether",
        prompt: "Enstrümanlar birlikte ve aynı yerden mi çaldı?",
        options: YES_NO,
        breaking: true,
      },
    ],
  },
  {
    id: "finish",
    title: "8 · Sonuç",
    task: "Aşağıdaki bloğu kopyala ve gönder.",
    listenFor: "",
    questions: [
      {
        id: "editListenFlow",
        prompt: "Yazarken durup dinlemek işine yaradı mı?",
        options: YES_NO,
        breaking: false,
      },
    ],
  },
];

/** Every question the eight steps ask, flattened, in order. */
export const ALL_LISTENING_QUESTIONS = LISTENING_STEPS.flatMap((step) =>
  step.questions.map((question) => ({ step: step.id, ...question })),
);

/**
 * Which answer to a breaking question means the music did the wrong thing.
 *
 * The last option of each breaking question, by construction — "Hayır" where
 * the good answer is yes, "Var"/"Evet"/"Kaydı"/"Kaldı" where the good answer
 * is the absence of something. Written out rather than inferred from the
 * position, because a question whose options are reordered one day should
 * break a test rather than quietly invert a verdict.
 */
const BROKEN: Readonly<Record<string, string>> = {
  selectionOpened: "Hayır",
  auditionStart: "Hayır",
  auditionScope: "Hayır",
  auditionEnd: "Hayır",
  loopGap: "Var",
  loopDoubleAttack: "Evet",
  loopTempo: "Kaydı",
  pauseResumed: "Hayır",
  pauseSingleVoice: "Evet",
  cancelStopped: "Hayır",
  cancelClean: "Kaldı",
  trackScopeOnly: "Hayır",
  allScopeTogether: "Hayır",
};

export type ListeningAnswers = Readonly<Record<string, string | null>>;

export type ListeningEnvironment = {
  /** `navigator.maxTouchPoints`. Zero is a desktop, whatever else it says. */
  readonly touchPoints: number;
  /** Whether the page threw, or the app wrote to the console. */
  readonly consoleErrors: readonly string[];
  /** The device's own store, before and after. Must be identical. */
  readonly userStorageBefore: string;
  readonly userStorageAfter: string;
};

export type ListeningVerdict = "PASS" | "FAIL" | "PARTIAL";

/**
 * What this run is entitled to claim.
 *
 * `FAIL` the moment a founder says the music did the wrong thing, or the
 * device's own store moved, or the page threw — measured breakage outranks
 * everything.
 *
 * `PARTIAL` when nothing is broken but something is unanswered, **and** when
 * the environment has no touch. A desktop browser can run every step of this
 * and hear every note; what it cannot do is be a phone, and this round exists
 * because a phone found what four green viewports did not.
 *
 * `PASS` only on a real touch device with every listening question answered
 * and none of them answered badly.
 */
export function listeningVerdict(
  environment: ListeningEnvironment,
  answers: ListeningAnswers,
): ListeningVerdict {
  if (environment.userStorageBefore !== environment.userStorageAfter) return "FAIL";
  if (environment.consoleErrors.length > 0) return "FAIL";

  const breaking = ALL_LISTENING_QUESTIONS.filter((question) => question.breaking);
  if (breaking.some((question) => answers[question.id] === BROKEN[question.id])) {
    return "FAIL";
  }
  if (ALL_LISTENING_QUESTIONS.some((question) => !answers[question.id])) return "PARTIAL";
  /* Everything answered and nothing broken — but a desktop is not a device. */
  if (environment.touchPoints === 0) return "PARTIAL";
  return "PASS";
}

/** Whether an answer is one of the middle, non-committal ones. */
const HEDGED: readonly string[] = ["Kısmen", "Emin değilim", "Biraz"];

export function isHedged(answer: string | null): boolean {
  return answer !== null && HEDGED.includes(answer);
}
