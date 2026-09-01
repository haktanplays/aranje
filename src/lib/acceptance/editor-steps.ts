/**
 * The seven things the founder is asked to do, and what the page watches
 * while they do them (2U-A handoff §5).
 *
 * ## Why the steps are data
 *
 * A guided test is a sequence of screens, and a sequence of screens written as
 * a switch inside a component is a sequence nobody can count, reorder or test.
 * Here each step is a value: what it asks for, in the reader's words, and what
 * must be true of the app afterwards. The conductor renders whatever it is
 * given, and a test can ask "are there seven, and does each one measure
 * something" without opening a browser.
 *
 * ## Why a step is made of phases
 *
 * "Copy, then paste, then cancel, then paste again" is four operations, and
 * the interesting facts about them are *different* for each: copying must
 * write nothing, cancelling must write nothing, applying must write exactly
 * once. Measured across the whole step those four collapse into one number
 * and the report can no longer tell a clean run from a copy that wrote.
 *
 * So each phase is its own screen with its own "Yaptım", and the page takes a
 * snapshot at every boundary. That is also what the handoff asks for on its
 * own terms — one task per screen — so the honest measurement and the kind
 * instruction turn out to be the same design.
 *
 * ## What a measurement is, and what it is not
 *
 * Every expectation below is answered from what the app *did*: the fixture's
 * own bytes, the revision the project record carries, the selection band's
 * shape on screen. Nothing here calls an internal command to make an
 * operation happen — the reader performs each one through the real production
 * control, and this only watches.
 *
 * A check is `null` until its phase has run. Three states, not two: passed,
 * failed, and not yet attempted — because a founder who stops at step four
 * has not failed steps five to seven, and a report that said so would be
 * lying about them.
 */

export type StepId =
  | "extend"
  | "clipboard"
  | "history"
  | "move"
  | "scope"
  | "measures"
  | "contract";

/**
 * What must be true of the app across one phase.
 *
 * `revision` is the project record's own counter: the app writes the record
 * once per committed edit, so a revision that moved by one is one history step
 * and one storage write, said by the thing that did them rather than by a
 * count this page keeps for itself.
 */
export type PhaseExpectation =
  /** Nothing may be written: same song bytes, same revision. */
  | { readonly kind: "no_write" }
  /**
   * The reach is armed, and nothing was written arming it (2V-A.1 §6).
   *
   * `no_write` alone would pass this phase for a reader who pressed "Yaptım"
   * without pressing anything else, because doing nothing writes nothing —
   * which is exactly how a guide comes to certify a control that is not on
   * screen. This asks the app what state the press left behind.
   */
  | { readonly kind: "armed" }
  /** Exactly one edit: the song changed and the revision moved by one. */
  | { readonly kind: "one_write" }
  /** A selection moved and nothing was written. */
  | { readonly kind: "selection_only"; readonly band: "wider" | "narrower" | "any" }
  /**
   * Undo or redo: the song returns to bytes it held before.
   *
   * `distinctFrom` names a second mark the first must *differ* from, and it
   * is what keeps this from passing vacuously (2U-B §4). If the edit under
   * test never happened, the "before" and "after" marks hold the same bytes,
   * and returning to either is satisfied by doing nothing at all — which is
   * exactly how the live run reported "Undo/redo: PASS" for a paste that was
   * never applied.
   */
  | {
      readonly kind: "returns_to";
      readonly mark: string;
      readonly distinctFrom?: string;
    }
  /** Remember the current bytes under a name, for a later `returns_to`. */
  | { readonly kind: "mark"; readonly mark: string }
  /** Navigation or looking. Nothing is asserted about the song. */
  | { readonly kind: "free" };

export type Phase = {
  /** Stable id; also the check key this phase answers. */
  readonly id: string;
  /** The one thing the reader is asked to do on this screen. */
  readonly text: string;
  readonly expect: PhaseExpectation;
  /**
   * Checks that must already have passed for this phase to mean anything
   * (2U-B §4, §11).
   *
   * A phase whose subject never happened cannot be judged by looking at the
   * song: "did undo restore the bytes" has no content when nothing was
   * written, and the honest answer is not "yes". Naming the dependency makes
   * the failure land on the phase that is actually unproven, rather than on
   * a neighbour that happens to look clean.
   */
  readonly requires?: readonly string[];
};

export type FounderQuestion = {
  readonly id: string;
  readonly prompt: string;
  /** Three answers, always. A scale invites a shrug; two invites a lie. */
  readonly options: readonly string[];
};

export type EditorStep = {
  readonly id: StepId;
  /** The step's own heading, short enough for a 320px screen. */
  readonly title: string;
  readonly phases: readonly Phase[];
  /**
   * Checks this step reports that no single phase owns — a fact about the
   * whole app rather than about one gesture.
   */
  readonly standingChecks: readonly string[];
  /** What only a person can answer. Empty where the machine sees everything. */
  readonly questions: readonly FounderQuestion[];
};

const CLARITY: readonly string[] = ["Evet", "Kısmen", "Hayır"];

export const EDITOR_STEPS: readonly EditorStep[] = [
  {
    id: "extend",
    title: "1 · Seçim ve Devam",
    phases: [
      {
        id: "extendSelected",
        text: "İlk ölçüdeki akora basılı tut. Seçim açılsın.",
        expect: { kind: "selection_only", band: "any" },
      },
      {
        id: "extendArmed",
        text: "«Devam»a dokun.",
        /*
         * Armed, not merely "nothing broke" (2V-A.1 §6). This is the phase the
         * founder could not complete — there was no "Devam" on the bar in
         * front of them — and a phase that passes when nothing was pressed
         * could never have told anyone that.
         */
        expect: { kind: "armed" },
      },
      {
        id: "extendGrew",
        text: "Motifin son notasına basılı tut. Seçim oraya kadar uzasın.",
        expect: { kind: "selection_only", band: "wider" },
      },
      {
        id: "extendShrank",
        text: "«Devam»a tekrar dokun, sonra daha yakın bir notaya bas. Seçim küçülsün.",
        expect: { kind: "selection_only", band: "narrower" },
      },
    ],
    standingChecks: [
      /* "Devam" must not be the old composer tool wearing its name. */
      "extendComposerClosed",
      /* And that tool must still be reachable where it lives. */
      "patternToolReachable",
    ],
    questions: [
      {
        id: "extendClear",
        prompt: "«Devam»ın seçimi uzattığı anlaşılır mıydı?",
        options: CLARITY,
      },
    ],
  },
  {
    id: "clipboard",
    title: "2 · Kopyala ve yapıştır",
    phases: [
      {
        id: "copyNoWrite",
        text: "«Daha fazla» → «Kopyala». Şarkı değişmemeli.",
        expect: { kind: "no_write" },
      },
      {
        id: "pasteTargetPicked",
        text: "Boş ikinci ölçüye basılı tut; hedefi seç.",
        expect: { kind: "selection_only", band: "any" },
      },
      {
        id: "pasteCancelled",
        text: "«Daha fazla» → «Yapıştır». Önizlemeyi gör ve vazgeç.",
        expect: { kind: "no_write" },
      },
      {
        id: "pasteApplied",
        text: "Aynı yolu tekrar aç ve bu kez uygula.",
        expect: { kind: "one_write" },
      },
    ],
    standingChecks: [],
    questions: [],
  },
  {
    id: "history",
    title: "3 · Geri al ve ileri al",
    phases: [
      {
        id: "historyMarked",
        text: "Bir şey yapma. Sadece devam et — bu hâli işaretliyoruz.",
        expect: { kind: "mark", mark: "pasted" },
      },
      {
        id: "undoByteEqual",
        text: "«Geri al»a dokun.",
        /*
         * Tied to the paste in three ways at once (2U-B §4): the bytes must
         * be the ones from before it, those bytes must differ from the ones
         * after it, and the paste itself must have been measured as a real
         * write. The live run reported PASS here for a paste that never
         * happened — with nothing written, "before" and "after" were the same
         * song, and pressing an inert «Geri al» satisfied both.
         */
        expect: {
          kind: "returns_to",
          mark: "beforePaste",
          distinctFrom: "pasted",
        },
        requires: ["pasteApplied"],
      },
      {
        id: "redoByteEqual",
        text: "«İleri al»a dokun.",
        expect: {
          kind: "returns_to",
          mark: "pasted",
          distinctFrom: "beforePaste",
        },
        requires: ["pasteApplied", "undoByteEqual"],
      },
    ],
    standingChecks: [],
    questions: [],
  },
  {
    id: "move",
    title: "4 · Taşı",
    phases: [
      {
        id: "moveSelected",
        text: "İlk ölçüdeki motifi yeniden seç.",
        expect: { kind: "selection_only", band: "any" },
      },
      {
        id: "moveTimeRight",
        text: "«Taşı» → Zaman → bir grid sağa. Uygula.",
        expect: { kind: "one_write" },
      },
      {
        id: "moveTimeLeft",
        text: "«Taşı» → Zaman → bir grid sola. Uygula.",
        expect: { kind: "one_write" },
      },
      {
        id: "movePitchUp",
        text: "«Taşı» → Ses → +1 yarım. Uygula.",
        expect: { kind: "one_write" },
      },
      {
        id: "movePitchDown",
        text: "«Taşı» → Ses → −1 yarım. Uygula.",
        expect: { kind: "one_write" },
      },
      {
        id: "moveOctaveUp",
        text: "«Taşı» → Ses → +1 oktav. Uygula.",
        expect: { kind: "one_write" },
      },
      {
        id: "moveOctaveDown",
        text: "«Taşı» → Ses → −1 oktav. Uygula.",
        expect: { kind: "one_write" },
      },
      {
        /*
         * A different motif for the string moves, and this is the whole of
         * 2U-B §5 (2U-B §5).
         *
         * Bar 1 opens on an open low E. There is no thinner string that can
         * sound an E2 — the A string's lowest note is three semitones above
         * it — and there is no thicker string at all, so *neither* direction
         * was possible and the guide was asking for a movement the fretboard
         * does not have. The app was right to refuse; the instruction was
         * wrong. Bar 3 sits in the middle of the neck, where both moves are
         * real, and the impossible case is kept as its own step below rather
         * than quietly dropped.
         */
        id: "restringSelected",
        text: "Üçüncü ölçüdeki notaları seç (boş ölçüden bir öncekiler).",
        expect: { kind: "selection_only", band: "any" },
      },
      {
        id: "moveStringThin",
        text: "«Taşı» → Tel → ince tele. Uygula.",
        expect: { kind: "one_write" },
        requires: ["restringSelected"],
      },
      {
        id: "moveStringThick",
        text: "«Taşı» → Tel → kalın tele. Uygula.",
        expect: { kind: "one_write" },
        requires: ["restringSelected"],
      },
      {
        /*
         * The other half of §5. A refusal is a feature, and a package that
         * only ever exercised the movements that work would say nothing about
         * whether the guard exists.
         */
        id: "restringRefused",
        text: "İlk ölçüdeki akoru seç, «Taşı» → Tel → ince tele. Bu kez uygulanmamalı.",
        expect: { kind: "no_write" },
      },
    ],
    /* Answered from the music itself by `editor-invariants.ts`. */
    standingChecks: [
      "moveKeptSoundingPitch",
      "moveNoOverwrite",
      /* The refusal was typed and said so, rather than silently doing nothing. */
      "stringRefusalTyped",
    ],
    questions: [
      {
        id: "moveClear",
        prompt: "«Taşı» seçeneklerinin ne yapacağı uygulanmadan önce anlaşılır mıydı?",
        options: CLARITY,
      },
    ],
  },
  {
    id: "scope",
    title: "5 · Üç seçim, üç fiil kümesi",
    /*
     * Three scopes, not two (2U-B §6, §10).
     *
     * A note range, one instrument's bars, and the bars themselves with every
     * track in them. The live report said "Nota/ölçü ayrımı: —", which was
     * honest and useless: the measure half was only ever claimed when a sheet
     * showed measure words, and on a track-scope selection that sheet was
     * empty, so nothing was ever measured. Each scope now has a screen, and
     * each is measured twice — what it draws, and what it can actually run.
     */
    phases: [
      {
        id: "scopeNoteSelected",
        text: "Porte içindeki bir notaya basılı tut, «Daha fazla»yı aç ve bak.",
        expect: { kind: "no_write" },
      },
      {
        id: "scopeTrackBarSelected",
        text: "Kapat. Ölçü başlığına basılı tut: «Bu enstrüman» seçili olmalı.",
        expect: { kind: "no_write" },
      },
      {
        id: "scopeWholeMeasureSelected",
        text: "«Tüm enstrümanlar»a dokun, sonra «Daha fazla»yı aç.",
        expect: { kind: "no_write" },
      },
    ],
    standingChecks: [
      /* What a note range must not offer, and what it must. */
      "noteHidesMeasureVerbs",
      "noteOffersPaste",
      /* One instrument's bars: content verbs, and never a bar-adding one. */
      "trackBarHidesInsert",
      /* The whole measure: the structural verbs, and runnable. */
      "wholeMeasureRunsInsert",
      /* No path may open a dialog with nothing in it. */
      "noEmptyDialog",
      /* A one-track song cannot falsify "covers every track". */
      "fixtureHasTwoTracks",
    ],
    questions: [],
  },
  {
    id: "measures",
    title: "6 · Ölçü ve çoklu ölçü",
    phases: [
      {
        id: "measureInserted",
        text: "«Tüm enstrümanlar» kapsamındayken «Daha fazla» → «Arkasına ölçü ekle».",
        expect: { kind: "one_write" },
        /* Adding a bar only exists in the whole-measure scope (2U-B §6). */
        requires: ["scopeWholeMeasureSelected"],
      },
      {
        id: "measureDuplicated",
        text: "Bir ölçü seç ve çoğalt.",
        expect: { kind: "one_write" },
      },
      {
        id: "measureMovedRight",
        text: "Aynı ölçüyü sağa taşı.",
        expect: { kind: "one_write" },
      },
      {
        id: "measureMovedLeft",
        text: "Sola taşı.",
        expect: { kind: "one_write" },
      },
      {
        /*
         * Moving onto an occupied bar (2U-B §7).
         *
         * The founder was offered "Yerine koy" here and pressing it did
         * nothing: the dialog stayed open and the same warning was rewritten
         * underneath. A move's collision has no overwrite that answers it, so
         * what must be on screen now is a refusal that says so — and no
         * button promising otherwise.
         */
        id: "moveIntoOccupiedRefused",
        text: "Dolu bir komşusu olan ölçüyü onun üzerine taşımayı dene.",
        expect: { kind: "no_write" },
      },
      {
        id: "multiSelectedByDrag",
        /*
         * The gesture itself, and the reason this step exists (2U-B §8).
         * Pressing one bar and then pressing another used to replace the
         * selection rather than widen it, so "two adjacent bars" was not
         * something a reader could reach at all.
         */
        text: "Bir ölçüye basılı tut ve parmağını komşusuna sürükle. İki ölçü seçilsin.",
        expect: { kind: "selection_only", band: "any" },
      },
      {
        id: "multiMarked",
        text: "Bir şey yapma — bu hâli işaretliyoruz.",
        expect: { kind: "mark", mark: "beforeRepeat" },
        requires: ["multiSelectedByDrag"],
      },
      {
        id: "multiRepeatOneHistory",
        text: "Seçili iki ölçüyü tekrarla.",
        expect: { kind: "one_write" },
        requires: ["multiSelectedByDrag"],
      },
      {
        id: "multiUndoByteEqual",
        text: "Tek «Geri al» ile tekrarı geri al.",
        expect: { kind: "returns_to", mark: "beforeRepeat" },
        requires: ["multiRepeatOneHistory"],
      },
      {
        id: "measureDeleted",
        text: "Uygun bir ölçüyü sil.",
        expect: { kind: "one_write" },
      },
    ],
    standingChecks: [
      /* These two come from the music itself. */
      "measureAllTracksAligned",
      "measureOtherTrackKept",
      /* And this from the screen: two bars were really held, not one. */
      "twoBarsHeld",
      /* A refusal that offered no button it could not honour. */
      "noUnhonouredReplace",
    ],
    questions: [],
  },
  {
    id: "contract",
    title: "7 · Yerleşim ve sonuç",
    phases: [
      {
        id: "contractLooked",
        text: "Ekranı son bir kez gözden geçir.",
        expect: { kind: "free" },
      },
    ],
    standingChecks: [
      "sixStringsVisible",
      "noNewToolbarRow",
      "noBodyOverflow",
      "noStaffScroller",
      "noTruncatedLabel",
      "allTargets44",
      "noConsoleError",
      "userStorageUnchanged",
    ],
    questions: [
      {
        id: "familiar",
        prompt: "Editörün ana yerleşimi tanıdık kaldı mı?",
        options: CLARITY,
      },
      {
        id: "surprise",
        prompt: "Herhangi bir işlem beklemediğin bir şey yaptı mı?",
        options: ["Hayır", "Belki", "Evet"],
      },
    ],
  },
];

/** Every check key the seven steps own, in report order. */
export const ALL_CHECK_KEYS: readonly string[] = EDITOR_STEPS.flatMap((step) => [
  ...step.phases.map((phase) => phase.id),
  ...step.standingChecks,
]);

/** One thing measured while a step runs. `null` means "not attempted yet". */
export type Check = boolean | null;

/** A fresh sheet: nothing attempted, nothing claimed. */
export function emptyChecks(): Record<string, Check> {
  return Object.fromEntries(ALL_CHECK_KEYS.map((key) => [key, null]));
}

export type StepVerdict = "pass" | "fail" | "pending";

/**
 * How one step stands.
 *
 * A single false is a failure however many checks passed beside it — an
 * operation that wrote twice is not three-quarters correct. Anything still
 * `null` and nothing false is `pending`, which is the honest word for a step
 * the reader has not reached.
 */
export function stepVerdict(
  step: EditorStep,
  checks: Readonly<Record<string, Check>>,
): StepVerdict {
  const keys = [...step.phases.map((phase) => phase.id), ...step.standingChecks];
  const values = keys.map((key) => checks[key] ?? null);
  if (values.some((value) => value === false)) return "fail";
  if (values.some((value) => value === null)) return "pending";
  return "pass";
}

/** What the page saw across one phase, taken at its two boundaries. */
export type PhaseDiff = {
  readonly songBefore: string;
  readonly songAfter: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  /** The selection band's width, or null when nothing was selected. */
  readonly bandBefore: number | null;
  readonly bandAfter: number | null;
  /**
   * Whether "Devam" is waiting for a target, read from the control itself.
   *
   * From `aria-pressed` on the button a reader would press, so the phase is
   * answered by the same thing the reader is looking at rather than by a
   * field the page keeps for itself.
   */
  readonly armedAfter: boolean;
  /** Bytes remembered under a name by an earlier `mark` phase. */
  readonly marks: Readonly<Record<string, string>>;
};

/**
 * Whether a phase did what it said it would.
 *
 * Deliberately strict about `one_write`: the song must have changed *and* the
 * revision must have moved by exactly one. Either alone would let something
 * through — a revision that moved twice is two writes for one gesture, and a
 * revision that did not move at all with the song changed is an atomicity
 * fault, which is worse than either.
 */
export function judgePhase(expect: PhaseExpectation, diff: PhaseDiff): boolean {
  const changed = diff.songAfter !== diff.songBefore;
  const revisionMoved = diff.revisionAfter - diff.revisionBefore;

  switch (expect.kind) {
    case "free":
      return true;
    case "mark":
    case "no_write":
      return !changed && revisionMoved === 0;
    case "armed":
      return !changed && revisionMoved === 0 && diff.armedAfter;
    case "one_write":
      return changed && revisionMoved === 1;
    case "selection_only": {
      if (changed || revisionMoved !== 0) return false;
      if (expect.band === "any") return diff.bandAfter !== null;
      if (diff.bandBefore === null || diff.bandAfter === null) return false;
      return expect.band === "wider"
        ? diff.bandAfter > diff.bandBefore
        : diff.bandAfter < diff.bandBefore;
    }
    case "returns_to": {
      const remembered = diff.marks[expect.mark];
      if (remembered === undefined || diff.songAfter !== remembered) return false;
      if (expect.distinctFrom === undefined) return true;
      /*
       * The two marks must be different pieces of music, or "it came back" is
       * a sentence about nothing (2U-B §4).
       */
      const other = diff.marks[expect.distinctFrom];
      return other !== undefined && other !== remembered;
    }
  }
}

/**
 * Whether a phase's dependencies are satisfied.
 *
 * Kept apart from `judgePhase` because it is a different kind of question:
 * `judgePhase` asks what the app did, this asks whether asking was meaningful.
 * A dependency that is `null` — never attempted — blocks just as firmly as one
 * that failed; "we did not check" is not evidence that it worked.
 */
export function phaseBlockedBy(
  phase: Phase,
  checks: Readonly<Record<string, Check>>,
): readonly string[] {
  return (phase.requires ?? []).filter((key) => checks[key] !== true);
}
