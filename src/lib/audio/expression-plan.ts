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
import { PPQ, velocityGain } from "@/lib/audio/schedule";
import {
  DEFAULT_PRACTICE_PERCENT,
  effectiveBpm,
} from "@/lib/audio/practice-rate";
import {
  bendTargetCents,
  expressionPresets,
  isExpressive,
  needsPrevious,
} from "@/lib/audio/expression";
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
  | "not_fretted";

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
  /** Where it is, for a diagnostic that has to point at something. */
  barKey: string;
  slotIndex: number;
};

export type ExpressionPlan = {
  notes: ExpressiveNotePlan[];
  /** Notes that asked for something the context could not give them. */
  fallbacks: number;
  /** Notes that will be played by a voice of their own. */
  expressiveNotes: number;
};

export type ExpressionPlanOptions = {
  /** Whole percent of the song's own tempo (spec 13.8). */
  practicePercent?: number;
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

/** Rise to the target, sit on it, then come back down (spec 8.5). */
export function bendAutomation(
  durationSeconds: number,
  articulation: Articulation,
): PitchPoint[] {
  const target = bendTargetCents(articulation);
  const { riseFraction, holdFraction } = expressionPresets.bend;

  const rise = durationSeconds * riseFraction;
  const hold = durationSeconds * (riseFraction + holdFraction);

  return [
    { timeSeconds: 0, cents: 0, curve: "step" },
    { timeSeconds: round(rise), cents: target, curve: "linear" },
    { timeSeconds: round(hold), cents: target, curve: "linear" },
    { timeSeconds: round(durationSeconds), cents: 0, curve: "linear" },
  ];
}

/** Start where the last note was and arrive at this one (spec 8.5). */
export function slideAutomation(
  durationSeconds: number,
  fromMidi: number,
  toMidi: number,
): PitchPoint[] {
  const { maxGlideSeconds, glideFraction } = expressionPresets.slide;
  const glide = Math.min(maxGlideSeconds, durationSeconds * glideFraction);

  return [
    {
      timeSeconds: 0,
      cents: round((fromMidi - toMidi) * 100),
      curve: "step",
    },
    { timeSeconds: round(glide), cents: 0, curve: "linear" },
  ];
}

/** No new pick attack: the note rises out of the one before it. */
export function legatoGain(durationSeconds: number, gain: number): GainPoint[] {
  const { maxTransitionSeconds, transitionFraction, attackGain } =
    expressionPresets.legato;
  const transition = Math.min(
    maxTransitionSeconds,
    durationSeconds * transitionFraction,
  );

  return [
    { timeSeconds: 0, value: round(gain * attackGain) },
    { timeSeconds: round(transition), value: round(gain) },
  ];
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
  onsets: readonly LegatoOnset[],
  index: number,
  secondsPerTick: number,
): ExpressiveNotePlan {
  const startSeconds = round(noteSeconds(onset.timeTicks, secondsPerTick));
  let durationSeconds = round(noteSeconds(onset.durationTicks, secondsPerTick));
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
      pitchAutomation: bendAutomation(durationSeconds, articulation),
    };
  }

  if (!needsPrevious(articulation)) return base;

  const link = legatoLink(onsets, index);
  if (link.kind !== "joined") {
    return {
      ...base,
      fallbackReason:
        link.kind === "other_string" ? "previous_note_other_string" : "no_previous_note",
    };
  }

  const previous = link.previous;
  if (previous.midi === null) {
    return { ...base, fallbackReason: "no_previous_note" };
  }

  if (articulation === "slide") {
    const interval = Math.abs(previous.midi - onset.midi);
    if (interval > expressionPresets.slide.maxIntervalSemitones) {
      return { ...base, fallbackReason: "interval_too_wide" };
    }
    return {
      ...base,
      expressive: true,
      pitchAutomation: slideAutomation(durationSeconds, previous.midi, onset.midi),
    };
  }

  const rising = onset.midi > previous.midi;
  if ((articulation === "hammer_on" && !rising) ||
      (articulation === "pull_off" && onset.midi >= previous.midi)) {
    return { ...base, fallbackReason: "wrong_direction" };
  }

  return {
    ...base,
    expressive: true,
    gainEnvelope: legatoGain(durationSeconds, gain),
  };
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
  const bpm = effectiveBpm(song.bpm, percent);
  const secondsPerTick = 60 / (bpm * PPQ);

  const notes: ExpressiveNotePlan[] = [];

  for (const track of song.tracks) {
    const onsets = trackLegatoOnsets(song, track.id);
    onsets.forEach((onset, index) => {
      const plan = planFor(onset, onsets, index, secondsPerTick);
      notes.push({
        ...plan,
        trackId: track.id,
        id: `${track.id}:${onset.timeTicks}:${onset.stringIndex}:${onset.pitch}`,
      });
    });
  }

  notes.sort((a, b) => a.startSeconds - b.startSeconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    notes,
    fallbacks: notes.filter((note) => note.fallbackReason !== undefined).length,
    expressiveNotes: notes.filter((note) => note.expressive).length,
  };
}
