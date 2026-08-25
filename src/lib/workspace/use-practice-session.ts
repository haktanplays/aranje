"use client";

/**
 * The practice loop, for as long as this session lasts (2R-A §13, §15).
 *
 * Three session-only facts live here and nowhere else: which bars are being
 * practised, how many bars are counted in, and whether the speed is climbing.
 * None of them is written to storage, none reaches a project file or an
 * export, and none survives a reload. That is the boundary, and it is the
 * whole reason this is a hook rather than a store: a reader who comes back
 * tomorrow is a reader arriving fresh, not one resuming a drill they set at
 * midnight.
 *
 * ## What it does not decide
 *
 * The arithmetic is `lib/practice/`: what a range is, what its edges cut,
 * what the count-in counts, when the speed steps. This file holds the state
 * those functions are applied to and connects them to the transport. It
 * computes no ticks, reads no slots and makes no musical judgement.
 *
 * ## The one input the speed is allowed to move on
 *
 * A completed pass of the loop, reported by the transport. Not a timer, not a
 * guess, and above all not a measurement of playing — the app does not listen
 * (§12).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_COUNT_IN,
  type CountInBars,
} from "@/lib/practice/count-in";
import {
  NO_LOOP,
  rangeIsLive,
  type PlaybackLoop,
  type PracticeRange,
} from "@/lib/practice/range";
import {
  rangeFromBar,
  rangeFromBarPair,
  rangeFromTimeSelection,
  type EntryRefusal,
  type EntryResult,
  type RangeSource,
} from "@/lib/practice/range-entry";
import {
  rangePreflight,
  type RangePreflight,
} from "@/lib/practice/range-preflight";
import {
  afterLoop,
  afterManualChange,
  isRunning,
  progressivePlan,
  startProgressive,
  type PlanRefusal,
  type ProgressiveState,
} from "@/lib/practice/progressive-rate";
import { barTimeline } from "@/lib/audio/schedule";
import type { PlaybackController } from "@/lib/audio/playback";
import type { TimeSelection } from "@/lib/song/time-selection";
import type { Song } from "@/lib/song/schema";

export type PracticeSession = {
  /** The bars being practised, or null when nothing is. */
  readonly range: PracticeRange | null;
  /** What this range's edges cut, or null when there is no range. */
  readonly preflight: RangePreflight | null;
  /** Why the last attempt to set a range was refused, or null. */
  readonly refusal: EntryRefusal | null;
  /** Which of the three doors the current range came through (§V). */
  readonly source: RangeSource | null;
  readonly countInBars: CountInBars;
  readonly progressive: ProgressiveState | null;
  /** The bar a two-tap range selection is waiting on, or null. */
  readonly pendingBarKey: string | null;
  readonly sheetOpen: boolean;
  /**
   * The range said in bar numbers and a section name, or null.
   *
   * Derived here rather than in the sheet: the numbers come from the same
   * timeline the transport plays, so what the reader is told a loop covers
   * and what the loop actually covers cannot come apart.
   */
  readonly view: PracticeRangeView | null;
  openSheet(): void;
  closeSheet(): void;

  /** Practise exactly this bar (§9.2). */
  selectBar(barKey: string): void;
  /** The bar the single-bar entry would take, or null when there is none. */
  readonly currentBarKey: string | null;
  /**
   * The two-tap entry: the first tap arms, the second completes (§9.1).
   *
   * A separate door from `selectBar` because they mean different things to
   * the reader, and a single "smart" one would have to guess which was meant.
   */
  extendTo(barKey: string): void;
  /** Practise the whole run between these two bars. */
  setRange(startBarKey: string, endBarKey: string): void;
  /**
   * Practise the bars a time selection covers, if it covers whole ones.
   *
   * Refused by name when it does not. Nothing is rounded and nothing is
   * snapped: a selection that starts mid-bar is a different piece of music,
   * and looping it would be the app choosing bars the reader did not (§V).
   */
  setFromTimeSelection(selection: TimeSelection): void;
  /**
   * Whether that would work, asked before the action is offered.
   *
   * The same function decides both, so an action cannot appear and then
   * refuse.
   */
  offersFromSelection(selection: TimeSelection): boolean;
  /** Take the offer the preflight computed. Never happens on its own (§10). */
  acceptWidened(): void;
  clear(): void;
  setCountIn(bars: CountInBars): void;
  /**
   * Start climbing from here to there, one step every `repeatsPerStep` passes.
   *
   * Returns why it was refused, or null when it started. Named rather than
   * boolean: "the target is not above the start" and "that repeat count is
   * not a whole number" are different things to tell the reader (§IX).
   */
  startProgressiveRate(input: {
    fromPercent: number;
    toPercent: number;
    incrementPercent?: number;
    repeatsPerStep?: number;
  }): PlanRefusal | null;
  stopProgressiveRate(): void;
  /** The reader moved the speed by hand: automation ends (§12). */
  reportManualRate(percent: number): void;
  /**
   * The transport's section-loop button.
   *
   * Here rather than beside it because there is one question — what is
   * looping — and two controls that answer it. Two owners is how a reader
   * ends up with a section loop and a practice range both believing they are
   * in charge.
   */
  toggleSectionLoop(): void;
};

/** What the sheet shows about the range: bars and a section, never keys. */
export type PracticeRangeView = {
  readonly firstBarNumber: number;
  readonly lastBarNumber: number;
  readonly sectionName: string;
  readonly widened: { firstBarNumber: number; lastBarNumber: number } | null;
};

export function usePracticeSession(options: {
  readonly song: Song;
  readonly controller: PlaybackController;
  /** The rate the app is at, so a hand change can be told from ours. */
  readonly practicePercent: number;
  readonly setPracticePercent: (percent: number) => void;
  /** The section the reader is looking at: what the loop button loops. */
  readonly viewedSectionId: string;
  /**
   * The bar the transport is on, or null before it has played.
   *
   * The single-bar entry's subject (§9.2): "practise this one" has to mean a
   * specific bar, and the bar the playhead is in is the one the reader is
   * looking at when they reach for it.
   */
  readonly activeBarKey: string | null;
}): PracticeSession {
  const { song, controller, practicePercent, setPracticePercent } = options;
  const { viewedSectionId, activeBarKey } = options;

  const [range, setRangeState] = useState<PracticeRange | null>(null);
  const [refusal, setRefusal] = useState<EntryRefusal | null>(null);
  const [source, setSource] = useState<RangeSource | null>(null);
  const [countInBars, setCountInBars] = useState<CountInBars>(DEFAULT_COUNT_IN);
  const [progressive, setProgressive] = useState<ProgressiveState | null>(null);
  const [pendingBarKey, setPendingBarKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  /*
   * A range whose bars have gone stops being a range. Checked here rather
   * than repaired: the reader chose specific bars, and a range that quietly
   * moved to whatever slid into those indices would loop music they did not
   * pick. Adjusted during render because it is derived from the song, which
   * is a prop, not from an external system to synchronise with.
   */
  if (range !== null && !rangeIsLive(song, range)) {
    setRangeState(null);
    setPendingBarKey(null);
    setSource(null);
  }

  const preflight = useMemo(
    () => (range === null ? null : rangePreflight(song, range)),
    [song, range],
  );

  const view = useMemo<PracticeRangeView | null>(() => {
    if (range === null) return null;
    const bars = barTimeline(song);
    const numberOf = (barKey: string) =>
      bars.find((bar) => bar.barKey === barKey)?.barNumber ?? null;
    const first = numberOf(range.startBarKey);
    const last = numberOf(range.endBarKey);
    if (first === null || last === null) return null;
    const offer = preflight?.widened ?? null;
    const offerFirst = offer ? numberOf(offer.startBarKey) : null;
    const offerLast = offer ? numberOf(offer.endBarKey) : null;
    return {
      firstBarNumber: first,
      lastBarNumber: last,
      sectionName:
        song.sections.find((entry) => entry.id === range.sectionId)?.name ?? "",
      widened:
        offerFirst === null || offerLast === null
          ? null
          : { firstBarNumber: offerFirst, lastBarNumber: offerLast },
    };
  }, [preflight, range, song]);

  /* ---------------------------------------------------- the loop itself */

  const loop: PlaybackLoop = useMemo(
    () => (range === null ? NO_LOOP : { kind: "practice_range", range }),
    [range],
  );

  useEffect(() => {
    /*
     * Only the practice range's own loop is written here. A reader who turned
     * the *section* loop on from the transport has a loop this hook did not
     * set, and clearing it because no practice range exists would be one
     * control silently undoing another.
     */
    if (range !== null) controller.setLoop(loop);
    else if (controller.getState().loop.kind === "practice_range") {
      controller.setLoop(NO_LOOP);
    }
  }, [controller, loop, range]);

  useEffect(() => {
    controller.setCountIn(countInBars);
  }, [controller, countInBars]);

  /* -------------------------------------------- the speed, one pass at a time */

  /*
   * The rate the app is at because *we* set it. Anything else the reader does
   * to the rate is a hand change, and telling the two apart is what makes
   * "manual change stops the automation" a rule rather than a guess.
   */
  const ourPercent = useRef<number | null>(null);

  useEffect(() => {
    if (!isRunning(progressive)) return;
    return controller.onLoopPass(() => {
      setProgressive((current) => {
        if (current === null || !isRunning(current)) return current;
        const next = afterLoop(current);
        ourPercent.current = next.percent;
        setPracticePercent(next.percent);
        return next;
      });
    });
  }, [controller, progressive, setPracticePercent]);

  useEffect(() => {
    if (progressive === null || !isRunning(progressive)) return;
    if (ourPercent.current === practicePercent) return;
    /*
     * The rate is not where we left it, so somebody else moved it. That is
     * the reader's hand, and their hand wins — the automation stops at the
     * speed they chose and does not resume (§12).
     */
    setProgressive((current) =>
      current === null ? current : afterManualChange(current, practicePercent),
    );
  }, [practicePercent, progressive]);

  /* --------------------------------------------------------- the doors in */

  /**
   * One place a result becomes state, whichever door produced it.
   *
   * Three entries and one landing: a range set from a pair and a range set
   * from a selection are the same range, so they must also leave the session
   * in the same condition.
   */
  const land = useCallback((result: EntryResult, from: RangeSource) => {
    if (!result.ok) {
      setRefusal(result.reason);
      return;
    }
    setRefusal(null);
    setRangeState(result.range);
    setSource(from);
    setPendingBarKey(null);
  }, []);

  const apply = useCallback(
    (a: string, b: string) => land(rangeFromBarPair(song, a, b), "bar_pair"),
    [land, song],
  );

  const selectBar = useCallback(
    (barKey: string) => {
      setPendingBarKey(null);
      land(rangeFromBar(song, barKey), "single_bar");
    },
    [land, song],
  );

  const offersFromSelection = useCallback(
    (selection: TimeSelection) => rangeFromTimeSelection(song, selection).ok,
    [song],
  );

  const setFromTimeSelection = useCallback(
    (selection: TimeSelection) =>
      land(rangeFromTimeSelection(song, selection), "time_selection"),
    [land, song],
  );

  const extendTo = useCallback(
    (barKey: string) => {
      const from = pendingBarKey ?? range?.startBarKey ?? null;
      if (from === null) {
        setPendingBarKey(barKey);
        setRefusal(null);
        return;
      }
      apply(from, barKey);
    },
    [apply, pendingBarKey, range],
  );

  const setRange = useCallback(
    (startBarKey: string, endBarKey: string) => apply(startBarKey, endBarKey),
    [apply],
  );

  const acceptWidened = useCallback(() => {
    const offer = preflight?.widened;
    if (!offer) return;
    setRangeState(offer);
    setRefusal(null);
  }, [preflight]);

  const clear = useCallback(() => {
    setRangeState(null);
    setPendingBarKey(null);
    setRefusal(null);
    setSource(null);
  }, []);

  const startProgressiveRate = useCallback(
    (input: {
      fromPercent: number;
      toPercent: number;
      incrementPercent?: number;
      repeatsPerStep?: number;
    }) => {
      const made = progressivePlan(
        input.fromPercent,
        input.toPercent,
        input.incrementPercent,
        input.repeatsPerStep,
      );
      if (!made.ok) return made.reason;
      const started = startProgressive(made.plan);
      ourPercent.current = started.percent;
      setProgressive(started);
      setPracticePercent(started.percent);
      return null;
    },
    [setPracticePercent],
  );

  const stopProgressiveRate = useCallback(() => {
    setProgressive(null);
    ourPercent.current = null;
  }, []);

  const toggleSectionLoop = useCallback(() => {
    /*
     * A practice range is the other kind of loop, and pressing the section
     * button while one is set replaces it rather than stacking on it. The
     * range itself stays chosen — the reader can put it back — but what the
     * transport loops is one thing at a time.
     */
    const state = controller.getState();
    controller.setLoop(
      state.loop.kind === "section"
        ? NO_LOOP
        : { kind: "section", sectionId: viewedSectionId },
    );
    if (state.loop.kind !== "section") setRangeState(null);
  }, [controller, viewedSectionId]);

  const reportManualRate = useCallback((percent: number) => {
    setProgressive((current) =>
      current === null ? current : afterManualChange(current, percent),
    );
  }, []);

  return {
    range,
    preflight,
    refusal,
    source,
    countInBars,
    progressive,
    pendingBarKey,
    currentBarKey: activeBarKey,
    sheetOpen,
    view,
    openSheet: useCallback(() => setSheetOpen(true), []),
    closeSheet: useCallback(() => setSheetOpen(false), []),
    selectBar,
    extendTo,
    setRange,
    setFromTimeSelection,
    offersFromSelection,
    acceptWidened,
    clear,
    setCountIn: setCountInBars,
    startProgressiveRate,
    stopProgressiveRate,
    reportManualRate,
    toggleSectionLoop,
  };
}
