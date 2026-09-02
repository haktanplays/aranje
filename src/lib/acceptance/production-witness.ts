/**
 * What the product was observed doing, reduced from production state (§4).
 *
 * ## Why this exists
 *
 * Eight of the round's thirteen steps ask the reader to *do* something that
 * writes nothing — draw a selection, reach it forward, open the actions,
 * audition once, loop, pause and resume. Those steps were judged by the only
 * fact the harness had about them: that no write had happened. That is an
 * isolation invariant and it is true of a step nobody has touched, so on a
 * fresh session all eight reported "Editör kanıtı geldi." before the reader
 * had done anything at all. Codex measured exactly that on `b039d9c`, in a
 * new session, with two presses of "Evet" advancing the round.
 *
 * The fix is not a stricter no-write check. There is no stricter version of
 * "nothing happened". What a read-only step needs is *positive* evidence, and
 * the only honest source of it is the product's own state.
 *
 * ## Where the samples come from, and why that is not a back door
 *
 * `window.__aranjeDebug` already exists, is armed only on `/eval/` routes and
 * on `?debug=1`, and is reading-only by construction — its own file says so
 * and explains why: a harness cannot ask the screen where an audition began,
 * because the drawer closes when it starts. This module consumes samples of
 * that surface. Nothing here changes what the editor or the engine does, no
 * production component learns that a test is watching, and no code path
 * branches on acceptance. The measurement is a witness, not a participant.
 *
 * ## Why a reducer over samples rather than callbacks
 *
 * Because it is testable without a browser, and because the facts a step
 * needs are *transitions* — "the end moved forward while the start stayed",
 * "the tick did not move while paused" — which no single reading can show.
 * The page polls; this turns a list of readings into the handful of things
 * the contracts actually ask about, and every one of those derivations is
 * pinned by a test in the node suite.
 */

/** One reading of the product's own state, as the debug surface reports it. */
export type ProductionSample = {
  readonly status: string;
  readonly ticks: number;
  readonly loop: {
    readonly on: boolean;
    readonly startTicks: number;
    readonly endTicks: number;
  } | null;
  /** The audition currently sounding, or null. */
  readonly selection: {
    readonly startTicks: number;
    readonly endTicks: number;
    readonly trackIds: readonly string[];
    readonly mode: string;
    readonly onsetCount: number;
  } | null;
  /** What the *editor* is holding, which is a different thing from the above. */
  readonly editorSelection: {
    readonly sectionId: string;
    readonly startTicks: number;
    readonly endTicks: number;
    readonly trackIds: readonly string[];
    /** How many listening verbs the surface is offering on it right now. */
    readonly listenVerbs: number;
  } | null;
};

/**
 * The facts a step contract may ask about.
 *
 * Deliberately small and deliberately literal. Each one is a thing that was
 * seen to happen, never a thing that failed to happen — "did not write" lives
 * in the isolation record and has no entry here, which is the whole point.
 */
export type WitnessFacts = {
  /** A selection was held at some moment during this attempt. */
  readonly selectionHeld: boolean;
  /** Its end moved forward while its start stayed where it was. */
  readonly selectionExtended: boolean;
  /** The surface offered both listening verbs on a real range. */
  readonly listenOffered: boolean;
  /** A one-shot audition was heard starting. */
  readonly auditionStarted: boolean;
  /** …and was heard finishing, rather than being left sounding. */
  readonly auditionEnded: boolean;
  /** A selection loop was heard starting, with the transport looping. */
  readonly loopStarted: boolean;
  /** The playhead was seen to come back round inside the loop. */
  readonly loopTraversed: boolean;
  /** …and the loop was explicitly turned off afterwards. */
  readonly loopStopped: boolean;
  /** The transport was seen playing. */
  readonly played: boolean;
  /** …then paused. */
  readonly paused: boolean;
  /** The tick did not drift across two readings while paused. */
  readonly tickHeldWhilePaused: boolean;
  /** …and playing resumed from at or after the tick it was paused at. */
  readonly resumedForward: boolean;
  /** Every track filter an audition actually used, in the order heard. */
  readonly listenFilters: readonly (readonly string[])[];
};

export const EMPTY_WITNESS: WitnessFacts = {
  selectionHeld: false,
  selectionExtended: false,
  listenOffered: false,
  auditionStarted: false,
  auditionEnded: false,
  loopStarted: false,
  loopTraversed: false,
  loopStopped: false,
  played: false,
  paused: false,
  tickHeldWhilePaused: false,
  resumedForward: false,
  listenFilters: [],
};

const sameTracks = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * Reduce a run of readings into the facts above.
 *
 * Pure, and order-sensitive on purpose: "paused then played" and "played then
 * paused" are different runs, and only the second one is a pause.
 */
export function witnessFrom(samples: readonly ProductionSample[]): WitnessFacts {
  const facts = { ...EMPTY_WITNESS };
  const filters: string[][] = [];

  /* The selection the reader was last seen holding, so a later reading can be
     compared against it rather than against the very first one — a reader may
     draw several selections before reaching one of them forward. */
  let heldStart: number | null = null;
  let heldEnd: number | null = null;
  let heldSection: string | null = null;

  let sounding: ProductionSample["selection"] = null;
  let pausedAt: number | null = null;
  let loopLow: number | null = null;
  let lastLoopTick: number | null = null;

  for (const sample of samples) {
    /* ---------------------------------------------- the editor's selection */
    const editor = sample.editorSelection;
    if (editor) {
      facts.selectionHeld = true;
      if (editor.listenVerbs >= 2 && editor.endTicks > editor.startTicks) {
        facts.listenOffered = true;
      }
      const continues =
        heldSection === editor.sectionId && heldStart === editor.startTicks;
      if (continues && heldEnd !== null && editor.endTicks > heldEnd) {
        /* Same start, later end: the reader reached it forward, which is what
           «Devam» does and what dragging a fresh selection does not. */
        facts.selectionExtended = true;
      }
      heldSection = editor.sectionId;
      heldStart = editor.startTicks;
      heldEnd = editor.endTicks;
    }

    /* ------------------------------------------------------- the audition */
    const plan = sample.selection;
    if (plan && !sounding) {
      facts.auditionStarted = true;
      filters.push([...plan.trackIds]);
      if (plan.mode === "loop") facts.loopStarted = true;
    }
    if (!plan && sounding) {
      /* It stopped. Which kind of stop it was depends on what was running. */
      if (sounding.mode === "loop") facts.loopStopped = true;
      else facts.auditionEnded = true;
    }
    sounding = plan;

    /* --------------------------------------------------------- the loop */
    if (sample.loop?.on === true) {
      loopLow = sample.loop.startTicks;
      if (
        lastLoopTick !== null &&
        sample.ticks < lastLoopTick &&
        sample.ticks >= loopLow
      ) {
        /* The playhead went backwards inside the loop's own bounds: it came
           round. A seek would land outside them or stop the loop. */
        facts.loopTraversed = true;
      }
      lastLoopTick = sample.ticks;
    } else {
      lastLoopTick = null;
    }

    /* ---------------------------------------------------- pause / resume */
    if (sample.status === "playing") {
      facts.played = true;
      if (pausedAt !== null && sample.ticks >= pausedAt) facts.resumedForward = true;
      pausedAt = null;
    }
    if (sample.status === "paused" && facts.played) {
      if (pausedAt !== null && sample.ticks === pausedAt) {
        facts.tickHeldWhilePaused = true;
      }
      facts.paused = true;
      pausedAt = sample.ticks;
    }
  }

  return { ...facts, listenFilters: filters };
}

/**
 * Did any audition in this attempt use exactly this set of instruments?
 *
 * The question 11A and 11B are really asking. Comparing the *filter the
 * engine was given* rather than counting tracks in the fixture is what keeps
 * "did you hear one instrument" from being answered by the song happening to
 * have two.
 */
export function heardWithTracks(
  facts: WitnessFacts,
  trackIds: readonly string[],
): boolean {
  return facts.listenFilters.some((filter) => sameTracks(filter, trackIds));
}
