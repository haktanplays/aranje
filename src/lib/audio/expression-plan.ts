/**
 * What each note should actually do, worked out before any audio node exists
 * (spec 8.5, K-21).
 *
 * This is the whole of the expression logic. It takes a song and returns, for
 * every note, when it starts, how long it sounds, how loud it is and how its
 * pitch and level move while it sounds. It knows nothing about Tone, about
 * contexts, or about whether it is being played live or rendered offline —
 * which is exactly why both use it, and why a bend can be tested by reading
 * numbers instead of by listening.
 *
 * Two conventions worth stating once:
 *
 * - **Automation times are relative to the note's own start.** A voice that
 *   begins at 12.4 seconds does not want to do arithmetic to find out when its
 *   vibrato starts.
 * - **The logical pitch never moves.** `pitch` is what is written; the cents in
 *   `pitchAutomation` are a deviation applied while playing, and nothing here
 *   writes back to the song.
 */
import { velocityGain } from "@/lib/audio/schedule";
import {
  buildTempoMap,
  durationSeconds as tempoDurationSeconds,
  secondsAtTicks,
  type TempoMap,
} from "@/lib/audio/tempo";
import {
  DEFAULT_PRACTICE_PERCENT,
  effectiveBpm,
} from "@/lib/audio/practice-rate";
import {
  bendTargetCents,
  expressionPresets,
  isExpressive,
} from "@/lib/audio/expression";
import {
  buildLegatoChains,
  type ChainBuildResult,
  type ChainRole,
  type LegatoChain,
} from "@/lib/audio/legato-chain";
import {
  legatoLink,
  trackLegatoOnsets,
  type LegatoOnset,
} from "@/lib/music/legato";
import type { Articulation, Song } from "@/lib/song/schema";

export type AutomationCurve = "step" | "linear" | "sine";

export type PitchPoint = {
  /** Seconds from the note's own start. */
  timeSeconds: number;
  /** Deviation from the written pitch. 0 is the pitch as written. */
  cents: number;
  curve: AutomationCurve;
};

export type GainPoint = { timeSeconds: number; value: number };

/**
 * Why an articulation could not be played as asked. The playback falls back to
 * an ordinary onset; the reason is a fixed identifier, never free text and
 * never anything a provider or a musician typed.
 */
export type ExpressionFallbackReason =
  | "no_previous_note"
  | "previous_note_other_string"
  | "wrong_direction"
  | "interval_too_wide"
  | "not_fretted"
  /** Slide only: the notes are too close together to hear the hand travel. */
  | "no_room_to_glide";

export type ExpressiveNotePlan = {
  /** Stable and independent of placement: track, tick and pitch. */
  id: string;
  trackId: string;
  pitch: string;
  startSeconds: number;
  durationSeconds: number;
  /** The same moment in ticks, so the transport can schedule it. */
  timeTicks: number;
  /** Exactly what the ordinary scheduler would play, in ticks. */
  durationTicks: number;
  velocity: number;
  /** Linear gain, before any articulation shaping. */
  gain: number;
  articulation?: Articulation;
  position?: { stringIndex: number; fret: number };
  pitchAutomation: PitchPoint[];
  gainEnvelope: GainPoint[];
  filterPreset?: "palm_mute";
  fallbackReason?: ExpressionFallbackReason;
  /** True when this note needs a voice of its own rather than the sampler. */
  expressive: boolean;
  /**
   * Set when this note is part of a legato chain (spec 8.5, K-22).
   *
   * A `source` is struck and starts the chain's voice. A `target` is **not**
   * struck at all: the chain moves the pitch of the voice that is already
   * ringing. The note stays in the plan either way — it is still a note of the
   * song — but a target is rendered by its chain rather than on its own.
   */
  chainId?: string;
  chainRole?: ChainRole;
  /** Where it is, for a diagnostic that has to point at something. */
  barKey: string;
  slotIndex: number;
};

export type ExpressionPlan = {
  notes: ExpressiveNotePlan[];
  /** Every legato chain, in playing order (spec 8.5, K-22). */
  chains: LegatoChain[];
  /** Notes that asked for something the context could not give them. */
  fallbacks: number;
  /** Notes that will be played by a voice of their own. */
  expressiveNotes: number;
};

/**
 * Ways of planning that exist **only** so a render can be compared with
 * another render (spec 8.5, K-22).
 *
 * None of these is reachable from the interface, and there is no setting for
 * any of them. A selectable "old engine" in the product would mean shipping
 * two answers to the same question and having to defend both; what is wanted
 * is one engine and a way to hear what changed.
 */
export type ExpressionComparisonOptions = {
  /** Phase 2F's hammer-on and pull-off: a quieter restrike, no chain. */
  legacyLegato?: boolean;
  /** Phase 2F's bend curve: fixed percentages of the note. */
  legacyBend?: boolean;
  /** Phase 2F's slide: an 80ms ramp at the start of the target note. */
  legacySlide?: boolean;
  /** Off renders a pull-off with no finger click at all. */
  pullOffAuxiliary?: boolean;
};

export type ExpressionPlanOptions = {
  /** Whole percent of the song's own tempo (spec 13.8). */
  practicePercent?: number;
  /**
   * Which bend character to plan. `tight` is what ships; `expressive` exists
   * for the listening renders and is not reachable from the interface.
   */
  bendProfile?: BendProfile;
  /** Render-only comparisons. Never set by the app (see the type above). */
  comparison?: ExpressionComparisonOptions;
};

function noteSeconds(ticks: number, secondsPerTick: number): number {
  return ticks * secondsPerTick;
}

/** Rounded so a plan compares equal across runs without float noise. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function flatPitch(): PitchPoint[] {
  return [{ timeSeconds: 0, cents: 0, curve: "step" }];
}

/**
 * A sine written out as points.
 *
 * The alternative is an LFO node per voice, which would mean another node type
 * on the allow-list and one more thing to dispose. Points are also the only
 * form a test can read back and check.
 */
export function vibratoAutomation(durationSeconds: number): PitchPoint[] {
  const { depthCents, rateHz, maxDelaySeconds, delayFraction, pointsPerCycle } =
    expressionPresets.vibrato;

  const delay = Math.min(maxDelaySeconds, durationSeconds * delayFraction);
  const moving = durationSeconds - delay;
  // Nothing to shake: a note shorter than its own delay stays straight rather
  // than getting a single lurch at the end.
  if (moving <= 0) return flatPitch();

  const points: PitchPoint[] = [
    { timeSeconds: 0, cents: 0, curve: "step" },
    { timeSeconds: round(delay), cents: 0, curve: "linear" },
  ];

  const step = 1 / (rateHz * pointsPerCycle);
  for (let time = step; time <= moving + 1e-9; time += step) {
    points.push({
      timeSeconds: round(delay + time),
      cents: round(depthCents * Math.sin(2 * Math.PI * rateHz * time)),
      curve: "sine",
    });
  }

  return points;
}

/**
 * The four stages of a bend, in seconds (spec 8.5, K-22).
 *
 * Exported because the render harness reports them and the tests read them
 * back: a bend that arrives in 280ms rather than 1.2s is the whole point of
 * v2, and "how long did the rise take" has to be answerable without listening.
 */
export type BendStages = {
  settleSeconds: number;
  riseSeconds: number;
  holdSeconds: number;
  releaseSeconds: number;
  /** When the target pitch is first reached, from the note's start. */
  reachedAtSeconds: number;
};

/**
 * How long each stage lasts.
 *
 * The rise and the release scale with the note but are clamped into a range a
 * hand can actually do. When the note is too short to hold all three, they are
 * squeezed **proportionally** — deterministic, and never producing a negative
 * hold or automation that runs off the end of the note.
 *
 * `timeScale` is the practice-speed factor: at half speed the musical gesture
 * is twice as long, so its real-time floors and ceilings stretch with it.
 */
export function bendStages(
  durationSeconds: number,
  timeScale = 1,
): BendStages {
  const preset = expressionPresets.bend;

  let settle = Math.min(
    preset.settleSeconds * timeScale,
    durationSeconds * preset.settleMaxFraction,
  );
  let rise = Math.min(
    preset.riseMaxSeconds * timeScale,
    Math.max(preset.riseMinSeconds * timeScale, durationSeconds * preset.riseFraction),
  );
  let release = Math.min(
    preset.releaseMaxSeconds * timeScale,
    Math.max(
      preset.releaseMinSeconds * timeScale,
      durationSeconds * preset.releaseFraction,
    ),
  );

  const needed = settle + rise + release;
  if (needed > durationSeconds && needed > 0) {
    const squeeze = durationSeconds / needed;
    settle *= squeeze;
    rise *= squeeze;
    release *= squeeze;
  }

  const hold = Math.max(0, durationSeconds - settle - rise - release);

  return {
    settleSeconds: round(settle),
    riseSeconds: round(rise),
    holdSeconds: round(hold),
    releaseSeconds: round(release),
    reachedAtSeconds: round(settle + rise),
  };
}

/** Fast away from the start, controlled as it arrives. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Gentle at both ends, so the return does not snap. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/**
 * Phase 2F's bend, kept only so a listener can hear what v2 changed.
 *
 * Fixed percentages of the note: on a long sustain the rise alone took over a
 * second, which is the fault v2 exists to fix. Nothing in the app can select
 * this.
 */
export function legacyBendAutomation(
  durationSeconds: number,
  articulation: Articulation,
): PitchPoint[] {
  const target = bendTargetCents(articulation);
  const rise = durationSeconds * 0.55;
  const hold = durationSeconds * 0.85;

  return [
    { timeSeconds: 0, cents: 0, curve: "step" },
    { timeSeconds: round(rise), cents: target, curve: "linear" },
    { timeSeconds: round(hold), cents: target, curve: "linear" },
    { timeSeconds: round(durationSeconds), cents: 0, curve: "linear" },
  ];
}

/**
 * Phase 2F's slide, kept only so a listener can hear what v2 changed.
 *
 * A short ramp at the **start** of the target note, hidden under the target's
 * own attack — which is exactly why it did not sound like a slide. Nothing in
 * the app can select this.
 */
export function legacySlideAutomation(
  durationSeconds: number,
  fromMidi: number,
  toMidi: number,
): PitchPoint[] {
  const glide = Math.min(0.16, durationSeconds * 0.35);
  return [
    { timeSeconds: 0, cents: round((fromMidi - toMidi) * 100), curve: "step" },
    { timeSeconds: round(glide), cents: 0, curve: "linear" },
  ];
}

/**
 * Phase 2F's hammer-on and pull-off, kept for the same reason: the target was
 * struck again, only quieter. Render comparisons only.
 */
export function legacyLegatoGain(
  durationSeconds: number,
  gain: number,
): GainPoint[] {
  const transition = Math.min(0.045, durationSeconds * 0.2);
  return [
    { timeSeconds: 0, value: round(gain * 0.55) },
    { timeSeconds: round(transition), value: round(gain) },
  ];
}

/** Which character a bend is played with. Tight is what ships (spec 8.5). */
export type BendProfile = "tight" | "expressive";

/**
 * Settle, rise, hold, release (spec 8.5, K-22).
 *
 * The target is exact: a half bend arrives at +100 cents and a full one at
 * +200, never at 97 or 205. The shape between the corners is eased; the
 * corners themselves are the numbers.
 */
export function bendAutomation(
  durationSeconds: number,
  articulation: Articulation,
  options: { timeScale?: number; profile?: BendProfile } = {},
): PitchPoint[] {
  const target = bendTargetCents(articulation);
  const timeScale = options.timeScale ?? 1;
  const profile = options.profile ?? "tight";
  const stages = bendStages(durationSeconds, timeScale);
  const { curvePoints, top } = expressionPresets.bend;

  const points: PitchPoint[] = [{ timeSeconds: 0, cents: 0, curve: "step" }];

  if (stages.settleSeconds > 0) {
    points.push({ timeSeconds: round(stages.settleSeconds), cents: 0, curve: "linear" });
  }

  for (let step = 1; step <= curvePoints; step += 1) {
    const t = step / curvePoints;
    points.push({
      timeSeconds: round(stages.settleSeconds + stages.riseSeconds * t),
      cents: round(target * easeOut(t)),
      curve: "linear",
    });
  }

  const holdEnd = stages.reachedAtSeconds + stages.holdSeconds;

  if (profile === "expressive" && stages.holdSeconds > top.startDelaySeconds * timeScale) {
    // The hand does not sit perfectly still on the target, but it does arrive
    // there first: the movement starts after the delay and stops when the
    // release does.
    const delay = top.startDelaySeconds * timeScale;
    points.push({
      timeSeconds: round(stages.reachedAtSeconds + delay),
      cents: target,
      curve: "linear",
    });
    const step = 1 / (top.rateHz * top.pointsPerCycle * (1 / timeScale));
    const moving = stages.holdSeconds - delay;
    for (let time = step; time <= moving + 1e-9; time += step) {
      points.push({
        timeSeconds: round(stages.reachedAtSeconds + delay + time),
        cents: round(
          target + top.depthCents * Math.sin((2 * Math.PI * top.rateHz * time) / timeScale),
        ),
        curve: "sine",
      });
    }
  }

  if (holdEnd > stages.reachedAtSeconds) {
    points.push({ timeSeconds: round(holdEnd), cents: target, curve: "linear" });
  }

  for (let step = 1; step <= curvePoints; step += 1) {
    const t = step / curvePoints;
    points.push({
      timeSeconds: round(holdEnd + stages.releaseSeconds * t),
      cents: round(target * (1 - easeInOut(t))),
      curve: "linear",
    });
  }

  return points;
}

/** Choked, and released quickly (spec 8.5). */
export function palmMuteGain(
  durationSeconds: number,
  gain: number,
): GainPoint[] {
  const { releaseSeconds } = expressionPresets.palmMute;
  const release = Math.min(releaseSeconds, durationSeconds * 0.5);

  return [
    { timeSeconds: 0, value: round(gain) },
    { timeSeconds: round(Math.max(0, durationSeconds - release)), value: round(gain) },
    { timeSeconds: round(durationSeconds), value: 0 },
  ];
}

export function palmMuteSeconds(durationSeconds: number): number {
  return round(Math.min(durationSeconds, expressionPresets.palmMute.maxHoldSeconds));
}

export function accentGain(gain: number): number {
  return round(Math.min(1, gain * expressionPresets.accent.gainMultiplier));
}

function planFor(
  onset: LegatoOnset,
  allOnsets: readonly LegatoOnset[],
  index: number,
  tempo: TempoMap,
  options: {
    timeScale: number;
    profile: BendProfile;
    comparison: ExpressionComparisonOptions;
  },
): ExpressiveNotePlan {
  // Asked of the timeline rather than multiplied out, so a note held across a
  // tempo change lasts the sum of its two halves (spec 8.3, K-25).
  const startSeconds = round(secondsAtTicks(tempo, onset.timeTicks));
  let durationSeconds = round(
    tempoDurationSeconds(tempo, onset.timeTicks, onset.durationTicks),
  );
  const gain = velocityGain(onset.velocity);

  const base: ExpressiveNotePlan = {
    // Filled in by the caller, which knows the track.
    id: "",
    trackId: "",
    pitch: onset.pitch,
    startSeconds,
    durationSeconds,
    timeTicks: onset.timeTicks,
    durationTicks: onset.durationTicks,
    velocity: onset.velocity,
    gain,
    ...(onset.articulation === undefined ? {} : { articulation: onset.articulation }),
    ...(onset.fret === null
      ? {}
      : { position: { stringIndex: onset.stringIndex, fret: onset.fret } }),
    pitchAutomation: flatPitch(),
    gainEnvelope: [],
    expressive: false,
    barKey: onset.barKey,
    slotIndex: onset.slotIndex,
  };

  const articulation = onset.articulation;
  if (!isExpressive(articulation)) return base;

  // Anything expressive on a note with no string under it is not something to
  // guess at; it falls back and says so.
  if (onset.fret === null || onset.midi === null) {
    return { ...base, fallbackReason: "not_fretted" };
  }

  if (articulation === "accent") {
    return {
      ...base,
      expressive: true,
      gainEnvelope: [{ timeSeconds: 0, value: accentGain(gain) }],
    };
  }

  if (articulation === "palm_mute") {
    durationSeconds = palmMuteSeconds(durationSeconds);
    return {
      ...base,
      expressive: true,
      durationSeconds,
      gainEnvelope: palmMuteGain(durationSeconds, gain),
      filterPreset: "palm_mute",
    };
  }

  if (articulation === "vibrato") {
    return {
      ...base,
      expressive: true,
      pitchAutomation: vibratoAutomation(durationSeconds),
    };
  }

  if (articulation === "bend_half" || articulation === "bend_full") {
    return {
      ...base,
      expressive: true,
      pitchAutomation: options.comparison.legacyBend
        ? legacyBendAutomation(durationSeconds, articulation)
        : bendAutomation(durationSeconds, articulation, {
            timeScale: options.timeScale,
            profile: options.profile,
          }),
    };
  }

  // Hammer-on, pull-off and slide are not decided here: they belong to a
  // chain, and the chain builder is what knows whether one can form (spec 8.5,
  // K-22, K-23). The one exception is the render comparison, which reproduces
  // the older shapes.
  if (options.comparison.legacySlide && articulation === "slide") {
    const link = legatoLink(allOnsets, index);
    if (link.kind !== "joined") {
      return {
        ...base,
        fallbackReason:
          link.kind === "other_string"
            ? "previous_note_other_string"
            : "no_previous_note",
      };
    }
    const previous = link.previous;
    if (previous.midi === null) return { ...base, fallbackReason: "no_previous_note" };
    return {
      ...base,
      expressive: true,
      pitchAutomation: legacySlideAutomation(
        durationSeconds,
        previous.midi,
        onset.midi,
      ),
    };
  }

  if (options.comparison.legacyLegato && articulation !== "slide") {
    const link = legatoLink(allOnsets, index);
    if (link.kind !== "joined") {
      return {
        ...base,
        fallbackReason:
          link.kind === "other_string"
            ? "previous_note_other_string"
            : "no_previous_note",
      };
    }
    const previous = link.previous;
    if (previous.midi === null) return { ...base, fallbackReason: "no_previous_note" };
    const rising = onset.midi > previous.midi;
    if (
      (articulation === "hammer_on" && !rising) ||
      (articulation === "pull_off" && onset.midi >= previous.midi)
    ) {
      return { ...base, fallbackReason: "wrong_direction" };
    }
    return {
      ...base,
      expressive: true,
      gainEnvelope: legacyLegatoGain(durationSeconds, gain),
    };
  }

  return base;
}

/**
 * Every note of the song, with what it should do while it sounds.
 *
 * The song is read, never written. Practice speed is applied here, so the same
 * plan describes the same music at whatever speed it is being worked at.
 */
export function buildExpressionPlan(
  song: Song,
  options: ExpressionPlanOptions = {},
): ExpressionPlan {
  const percent = options.practicePercent ?? DEFAULT_PRACTICE_PERCENT;
  // One timeline, section tempos included. There is no global-bpm shortcut
  // here any more: a song may run at several tempos (spec 8.3, K-25).
  const tempo = buildTempoMap(song, percent);
  // A gesture is musical, so at half speed it takes twice as long in seconds.
  const timeScale = DEFAULT_PRACTICE_PERCENT / percent;
  const profile = options.bendProfile ?? "tight";
  const comparison = options.comparison ?? {};

  const notes: ExpressiveNotePlan[] = [];
  const chains: LegatoChain[] = [];

  for (const track of song.tracks) {
    const onsets = trackLegatoOnsets(song, track.id);
    const noteIds = onsets.map(
      (onset) => `${track.id}:${onset.timeTicks}:${onset.stringIndex}:${onset.pitch}`,
    );
    const planned = onsets.map((onset, index) => ({
      ...planFor(onset, onsets, index, tempo, {
        timeScale,
        profile,
        comparison,
      }),
      trackId: track.id,
      id: noteIds[index] ?? "",
    }));

    const built: ChainBuildResult = comparison.legacyLegato
      ? { chains: [], membership: new Map(), refusals: new Map() }
      : buildLegatoChains({
          skipSlides: comparison.legacySlide ?? false,
          trackId: track.id,
          onsets,
          tempo,
          timeScale,
          noteIds,
          gains: planned.map((note) => note.gain),
          withAuxiliary: comparison.pullOffAuxiliary ?? true,
        });
    chains.push(...built.chains);

    planned.forEach((note, index) => {
      const member = built.membership.get(index);
      const refusal = built.refusals.get(index);

      if (member) {
        notes.push({
          ...note,
          // A source is struck by its chain; a target is not struck at all.
          expressive: true,
          chainId: member.chainId,
          chainRole: member.role,
        });
        return;
      }

      notes.push(refusal ? { ...note, fallbackReason: refusal } : note);
    });
  }

  notes.sort(
    (a, b) => a.startSeconds - b.startSeconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  chains.sort(
    (a, b) =>
      a.startSeconds - b.startSeconds ||
      (a.chainId < b.chainId ? -1 : a.chainId > b.chainId ? 1 : 0),
  );

  return {
    notes,
    chains,
    fallbacks: notes.filter((note) => note.fallbackReason !== undefined).length,
    expressiveNotes: notes.filter((note) => note.expressive).length,
  };
}
