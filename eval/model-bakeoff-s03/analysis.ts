/**
 * Phrase-level measurements for the bake-off (spec 11.6, §21).
 *
 * Evaluation only, and deliberately outside `src/`: none of this is a
 * validator, none of it refuses anything, and this checkpoint adds no
 * production capability. It reads a finished Song and counts things two
 * candidates can be compared on.
 *
 * Every rule below is a **stated heuristic**, not a definition. "A melodic
 * sequence" is a thing a musician recognises; what is counted here is "the
 * same interval pattern appearing again at another pitch level", which is
 * something that can be counted the same way twice. Where the two disagree,
 * the musician is right and the number is still useful, because it is the
 * same number for both candidates.
 *
 * Nothing here produces a score, a rank or a winner. A higher count is not a
 * better piece, and a candidate that uses one grid well beats one that uses
 * five badly.
 */
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan } from "@/lib/audio/schedule";
import { buildTempoMap, sectionBpm } from "@/lib/audio/tempo";
import { buildTrackTimeline, type TabSpan } from "@/lib/tab/timeline";
import { instrumentFamily } from "@/lib/instruments/registry";
import { pitchToMidi } from "@/lib/music/pitch";
import { ticksPerSlot } from "@/lib/music/timing";
import {
  gridDistribution,
  scalarRunCandidates,
  speedReport,
  type GridDistribution,
  type ScalarRunCandidate,
  type SpeedReport,
} from "@/lib/copilot/rhythm-report";
import type { Song } from "@/lib/song/schema";

/** Onsets of one fretted track, in playing order, with placement. */
type Onset = {
  barNumber: number;
  sectionId: string;
  startSlot: number;
  absTicks: number;
  pitch: string;
  midi: number;
  stringIndex: number;
  articulation?: string;
};

function frettedOnsets(song: Song, trackId: string): Onset[] {
  const timeline = buildTrackTimeline(song, trackId);
  if (timeline.kind !== "fretted") return [];
  const plan = buildSongPlan(song);
  const barStart = new Map(plan.bars.map((bar) => [bar.barKey, bar.time]));

  const onsets: Onset[] = [];
  for (const bar of timeline.bars) {
    if (bar.silent) continue;
    const step = ticksPerSlot(bar.resolution);
    const base = barStart.get(bar.key) ?? 0;
    for (const span of bar.spans) {
      if (span.openStart) continue;
      const midi = pitchToMidi(span.pitch);
      if (midi === null) continue;
      onsets.push({
        barNumber: bar.barNumber,
        sectionId: bar.sectionId,
        startSlot: span.startSlot,
        absTicks: base + span.startSlot * step,
        pitch: span.pitch,
        midi,
        stringIndex: span.stringIndex,
        ...(span.articulation === undefined ? {} : { articulation: span.articulation }),
      });
    }
  }
  return onsets.sort((a, b) => a.absTicks - b.absTicks || a.stringIndex - b.stringIndex);
}

/** One onset per moment: a chord is one event, not several. */
function monophonic(onsets: readonly Onset[]): Onset[] {
  const byTick = new Map<number, Onset>();
  for (const onset of onsets) {
    const existing = byTick.get(onset.absTicks);
    if (!existing || onset.midi > existing.midi) byTick.set(onset.absTicks, onset);
  }
  return [...byTick.values()].sort((a, b) => a.absTicks - b.absTicks);
}

export type MelodicSequence = {
  trackId: string;
  /** Intervals in semitones, the cell that repeats. */
  cell: number[];
  /** Where each occurrence starts, in bar numbers. */
  atBars: number[];
  /** 0 means an exact repeat; anything else is the transposition. */
  transpositions: number[];
  kind: "exact_repeat" | "transposed";
};

/**
 * The same interval cell appearing again at another pitch level.
 *
 * Cell length three intervals (four notes) or more; the two occurrences must
 * not overlap. An exact repeat is reported separately from a transposed one,
 * because "said it twice" and "developed it" are different things and the
 * musician asked for the second.
 */
export function melodicSequences(song: Song, trackId: string): MelodicSequence[] {
  const notes = monophonic(frettedOnsets(song, trackId));
  if (notes.length < 8) return [];

  const intervals: number[] = [];
  for (let index = 1; index < notes.length; index += 1) {
    intervals.push((notes[index]?.midi ?? 0) - (notes[index - 1]?.midi ?? 0));
  }

  const found: MelodicSequence[] = [];
  const claimed = new Set<number>();

  for (let length = Math.min(6, intervals.length); length >= 3; length -= 1) {
    for (let start = 0; start + length <= intervals.length; start += 1) {
      if ([...Array(length).keys()].some((offset) => claimed.has(start + offset))) continue;
      const cell = intervals.slice(start, start + length);
      // A flat cell is not a sequence; it is a repeated note.
      if (cell.every((step) => step === 0)) continue;

      const atBars: number[] = [notes[start]?.barNumber ?? 0];
      const transpositions: number[] = [0];
      let cursor = start + length;
      while (cursor + length <= intervals.length) {
        const next = intervals.slice(cursor, cursor + length);
        if (!next.every((step, offset) => step === cell[offset])) {
          cursor += 1;
          continue;
        }
        atBars.push(notes[cursor]?.barNumber ?? 0);
        transpositions.push((notes[cursor]?.midi ?? 0) - (notes[start]?.midi ?? 0));
        for (let offset = 0; offset < length; offset += 1) claimed.add(cursor + offset);
        cursor += length;
      }

      if (atBars.length < 2) continue;
      for (let offset = 0; offset < length; offset += 1) claimed.add(start + offset);
      found.push({
        trackId,
        cell,
        atBars,
        transpositions,
        kind: transpositions.slice(1).every((step) => step === 0) ? "exact_repeat" : "transposed",
      });
    }
  }

  return found;
}

export type ArpeggioCandidate = {
  trackId: string;
  barNumber: number;
  length: number;
  pitches: string[];
  distinctPitchClasses: number;
  /** How many different strings the passage is spread over. */
  stringsUsed: number;
  stringCrossing: boolean;
};

/**
 * A broken-chord figure: three or more consecutive onsets, mostly leaping,
 * outlining at most four pitch classes.
 *
 * "Mostly leaping" is what separates it from a scale walk: at least half the
 * steps are three semitones or more. String spread is reported separately,
 * because a broken chord on one string and one across four strings are not
 * the same guitar idea.
 */
export function arpeggioCandidates(song: Song, trackId: string): ArpeggioCandidate[] {
  const timeline = buildTrackTimeline(song, trackId);
  if (timeline.kind !== "fretted") return [];
  const found: ArpeggioCandidate[] = [];

  for (const bar of timeline.bars) {
    if (bar.silent) continue;
    const spans = bar.spans
      .filter((span) => !span.openStart)
      .sort((a, b) => a.startSlot - b.startSlot);

    let run: TabSpan[] = [];
    let previousEnd: number | null = null;

    const flush = () => {
      if (run.length >= 3) {
        const midis = run.map((span) => pitchToMidi(span.pitch));
        if (!midis.some((value) => value === null)) {
          const steps: number[] = [];
          for (let index = 1; index < midis.length; index += 1) {
            steps.push(Math.abs((midis[index] ?? 0) - (midis[index - 1] ?? 0)));
          }
          const leaps = steps.filter((step) => step >= 3).length;
          const classes = new Set(midis.map((value) => (value ?? 0) % 12));
          const strings = new Set(run.map((span) => span.stringIndex));
          if (leaps >= steps.length / 2 && classes.size <= 4 && classes.size >= 2) {
            found.push({
              trackId,
              barNumber: bar.barNumber,
              length: run.length,
              pitches: run.map((span) => span.pitch),
              distinctPitchClasses: classes.size,
              stringsUsed: strings.size,
              stringCrossing: strings.size >= 2,
            });
          }
        }
      }
      run = [];
    };

    for (const span of spans) {
      if (previousEnd !== null && span.startSlot > previousEnd + 1) flush();
      run.push(span);
      previousEnd = span.endSlot;
    }
    flush();
  }

  return found;
}

export type RegisterShift = {
  trackId: string;
  fromBar: number;
  toBar: number;
  semitones: number;
};

/**
 * A move between registers, measured bar to bar on median pitch.
 *
 * Seven semitones is the threshold — a fifth — because below that a line is
 * still moving inside one place on the neck.
 */
export function registerShifts(song: Song, trackId: string): RegisterShift[] {
  const notes = frettedOnsets(song, trackId);
  const byBar = new Map<number, number[]>();
  for (const note of notes) {
    const list = byBar.get(note.barNumber) ?? [];
    list.push(note.midi);
    byBar.set(note.barNumber, list);
  }

  const medians = [...byBar.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([barNumber, midis]) => {
      const sorted = [...midis].sort((a, b) => a - b);
      return { barNumber, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
    });

  const shifts: RegisterShift[] = [];
  for (let index = 1; index < medians.length; index += 1) {
    const from = medians[index - 1];
    const to = medians[index];
    if (!from || !to) continue;
    const semitones = to.median - from.median;
    if (Math.abs(semitones) >= 7) {
      shifts.push({ trackId, fromBar: from.barNumber, toBar: to.barNumber, semitones });
    }
  }
  return shifts;
}

export type SlideReport = {
  trackId: string;
  fromPitch: string;
  toPitch: string;
  semitones: number;
  width: "short" | "medium" | "wide";
  sameString: boolean;
  startsAtSeconds: number;
  arrivesAtSeconds: number;
  glideSeconds: number;
};

/**
 * Every slide that became a chain, with how far it travels.
 *
 * The width bands are for this report only and are not a limit anywhere:
 * short 1-2, medium 3-5, wide 6-12 semitones. A wide slide is worth calling
 * out because the current engine moves one source voice's pitch, so a long
 * travel can be heard as a bend rather than as a slide — an engine limit
 * recorded in HUMAN_ACCEPTANCE.md, not something measured away here.
 */
export function slideReport(song: Song): SlideReport[] {
  const plan = buildExpressionPlan(song);
  const found: SlideReport[] = [];
  for (const chain of plan.chains) {
    for (const transition of chain.transitions) {
      if (transition.kind !== "slide") continue;
      const semitones = Math.round(transition.intervalCents / 100);
      const size = Math.abs(semitones);
      found.push({
        trackId: chain.trackId,
        fromPitch: transition.fromPitch,
        toPitch: transition.toPitch,
        semitones,
        width: size <= 2 ? "short" : size <= 5 ? "medium" : "wide",
        // A chain only forms on one string, so this is a check, not a guess.
        sameString: true,
        startsAtSeconds: chain.startSeconds + transition.atSeconds,
        arrivesAtSeconds: chain.startSeconds + transition.arrivesAtSeconds,
        glideSeconds: transition.transitionSeconds,
      });
    }
  }
  return found;
}

export type DrumSectionReport = {
  sectionId: string;
  sectionName: string;
  bars: number;
  hits: number;
  distinctKickPatterns: number;
  distinctSnarePatterns: number;
  backbeatBars: number;
  fillBars: number;
  tomHits: number;
  cymbalPieces: string[];
  identicalRepeatedBars: number;
  /** Share of drum onsets that land exactly on a guitar onset. */
  guitarCopyRatio: number;
};

/**
 * What the drums are actually doing, per section.
 *
 * Hit count is deliberately not the headline. A fill bar is one whose hit
 * count is at least half again the section's median, or which uses a tom;
 * a backbeat bar has a snare on beats two and four. "Identical repeated bars"
 * counts bars whose pattern is byte-equal to the one before, which is the
 * shape of a copied loop.
 */
export function drumReport(song: Song): DrumSectionReport[] {
  const drumTrack = song.tracks.find(
    (track) => instrumentFamily(track.instrumentId) === "drums",
  );
  if (!drumTrack) return [];
  const guitarTracks = song.tracks.filter(
    (track) => instrumentFamily(track.instrumentId) === "guitar",
  );

  const plan = buildSongPlan(song);
  const guitarTicks = new Set(
    plan.events
      .filter((event) => guitarTracks.some((track) => track.id === event.trackId))
      .map((event) => event.time),
  );

  const reports: DrumSectionReport[] = [];

  for (const section of song.sections) {
    const barsWritten = section.bars.filter((bar) => bar.slots[drumTrack.id] !== undefined);
    if (barsWritten.length === 0) continue;

    const perBar: string[] = [];
    const kickShapes = new Set<string>();
    const snareShapes = new Set<string>();
    let hits = 0;
    let tomHits = 0;
    let backbeatBars = 0;
    const cymbals = new Set<string>();
    const barHitCounts: number[] = [];
    const barsWithTom: boolean[] = [];

    for (const bar of barsWritten) {
      const slots = bar.slots[drumTrack.id];
      if (!Array.isArray(slots)) continue;
      const kick: number[] = [];
      const snare: number[] = [];
      let barHits = 0;
      let barHasTom = false;

      slots.forEach((slot, index) => {
        if (!Array.isArray(slot)) return;
        for (const hit of slot) {
          const piece = (hit as { piece?: string }).piece;
          if (!piece) continue;
          barHits += 1;
          hits += 1;
          if (piece === "kick") kick.push(index);
          if (piece === "snare") snare.push(index);
          if (piece.startsWith("tom")) {
            tomHits += 1;
            barHasTom = true;
          }
          if (["crash", "ride", "china", "open_hat", "closed_hat"].includes(piece)) {
            cymbals.add(piece);
          }
        }
      });

      kickShapes.add(kick.join(","));
      snareShapes.add(snare.join(","));
      perBar.push(JSON.stringify(slots));
      barHitCounts.push(barHits);
      barsWithTom.push(barHasTom);

      const perBeat = slots.length / bar.timeSignature[0];
      const onTwo = snare.includes(Math.round(perBeat));
      const onFour = snare.includes(Math.round(perBeat * 3));
      if (onTwo && onFour) backbeatBars += 1;
    }

    const sorted = [...barHitCounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const fillBars = barHitCounts.filter(
      (count, index) => count >= median * 1.5 || barsWithTom[index] === true,
    ).length;

    let identical = 0;
    for (let index = 1; index < perBar.length; index += 1) {
      if (perBar[index] === perBar[index - 1]) identical += 1;
    }

    const drumEvents = plan.events.filter(
      (event) => event.trackId === drumTrack.id && event.kind === "drum",
    );
    const sectionBarKeys = new Set(
      plan.bars.filter((bar) => bar.sectionId === section.id).map((bar) => bar.time),
    );
    const inSection = drumEvents.filter((event) =>
      [...sectionBarKeys].some((start) => event.time >= start && event.time < start + 768 * 2),
    );
    const copied = inSection.filter((event) => guitarTicks.has(event.time)).length;

    reports.push({
      sectionId: section.id,
      sectionName: section.name,
      bars: barsWritten.length,
      hits,
      distinctKickPatterns: kickShapes.size,
      distinctSnarePatterns: snareShapes.size,
      backbeatBars,
      fillBars,
      tomHits,
      cymbalPieces: [...cymbals].sort(),
      identicalRepeatedBars: identical,
      guitarCopyRatio: inSection.length === 0 ? 0 : copied / inSection.length,
    });
  }

  return reports;
}

export type SectionSimilarity = {
  a: string;
  b: string;
  /** Onset positions inside the bar, as a share of the union. */
  onsetJaccard: number;
  identicalBars: number;
  densityRatio: number;
  registerShiftSemitones: number;
};

/** How alike two sections are, for the "bridge is a copy of the break" question. */
export function sectionSimilarity(
  song: Song,
  trackId: string,
  sectionA: string,
  sectionB: string,
): SectionSimilarity | null {
  const first = song.sections.find((entry) => entry.id === sectionA);
  const second = song.sections.find((entry) => entry.id === sectionB);
  if (!first || !second) return null;

  const shape = (section: typeof first) => {
    const positions = new Set<number>();
    const bars: string[] = [];
    const midis: number[] = [];
    for (const bar of section.bars) {
      const slots = bar.slots[trackId];
      if (!Array.isArray(slots)) continue;
      const step = ticksPerSlot(bar.resolution);
      const barPositions: number[] = [];
      slots.forEach((slot, index) => {
        if (slot === null || slot === "-" || Array.isArray(slot)) return;
        positions.add(index * step);
        barPositions.push(index * step);
        for (const note of (slot as { notes: { pitch: string }[] }).notes) {
          const midi = pitchToMidi(note.pitch);
          if (midi !== null) midis.push(midi);
        }
      });
      bars.push(JSON.stringify(slots));
    }
    const sortedMidis = [...midis].sort((a, b) => a - b);
    return {
      positions,
      bars,
      onsets: bars.length === 0 ? 0 : positions.size,
      median: sortedMidis[Math.floor(sortedMidis.length / 2)] ?? 0,
      count: midis.length,
    };
  };

  const left = shape(first);
  const right = shape(second);
  const union = new Set([...left.positions, ...right.positions]);
  const intersection = [...left.positions].filter((value) => right.positions.has(value));
  const identicalBars = left.bars.filter((bar) => right.bars.includes(bar)).length;

  return {
    a: sectionA,
    b: sectionB,
    onsetJaccard: union.size === 0 ? 0 : intersection.length / union.size,
    identicalBars,
    densityRatio: left.count === 0 ? 0 : right.count / left.count,
    registerShiftSemitones: right.median - left.median,
  };
}

export type TempoStep = {
  fromSection: string;
  toSection: string;
  fromBpm: number;
  toBpm: number;
  changePercent: number;
  halved: boolean;
};

export function tempoSteps(song: Song): TempoStep[] {
  const steps: TempoStep[] = [];
  for (let index = 1; index < song.sections.length; index += 1) {
    const previous = song.sections[index - 1];
    const current = song.sections[index];
    if (!previous || !current) continue;
    const from = sectionBpm(song, previous.id);
    const to = sectionBpm(song, current.id);
    if (from === to) continue;
    steps.push({
      fromSection: previous.name,
      toSection: current.name,
      fromBpm: from,
      toBpm: to,
      changePercent: ((to - from) / from) * 100,
      halved: Math.abs(to * 2 - from) < 0.001,
    });
  }
  return steps;
}

export type ArticulationCount = Record<string, number>;

export function articulationCounts(song: Song): { counts: ArticulationCount; pitched: number } {
  const counts: ArticulationCount = {};
  let pitched = 0;
  for (const section of song.sections) {
    for (const bar of section.bars) {
      for (const slots of Object.values(bar.slots)) {
        if (!Array.isArray(slots)) continue;
        for (const slot of slots) {
          if (slot === null || slot === "-" || Array.isArray(slot)) continue;
          for (const note of (slot as { notes: { articulation?: string }[] }).notes) {
            pitched += 1;
            const key = note.articulation ?? "(none)";
            counts[key] = (counts[key] ?? 0) + 1;
          }
        }
      }
    }
  }
  return { counts, pitched };
}

export type CandidateAnalysis = {
  grid: GridDistribution;
  speed: SpeedReport[];
  scalarRuns: ScalarRunCandidate[];
  sequences: MelodicSequence[];
  arpeggios: ArpeggioCandidate[];
  registerShifts: RegisterShift[];
  slides: SlideReport[];
  drums: DrumSectionReport[];
  tempo: TempoStep[];
  articulation: { counts: ArticulationCount; pitched: number };
  expression: { expressiveNotes: number; chains: number; fallbacks: number };
  durationSeconds: number;
  totalBars: number;
};

export function analyseCandidate(song: Song): CandidateAnalysis {
  const fretted = song.tracks.filter(
    (track) => instrumentFamily(track.instrumentId) !== "drums",
  );
  const expression = buildExpressionPlan(song);
  const plan = buildSongPlan(song);

  return {
    grid: gridDistribution(song),
    speed: song.tracks.map((track) => speedReport(song, track.id)),
    scalarRuns: fretted.flatMap((track) => scalarRunCandidates(song, track.id)),
    sequences: fretted.flatMap((track) => melodicSequences(song, track.id)),
    arpeggios: fretted.flatMap((track) => arpeggioCandidates(song, track.id)),
    registerShifts: fretted.flatMap((track) => registerShifts(song, track.id)),
    slides: slideReport(song),
    drums: drumReport(song),
    tempo: tempoSteps(song),
    articulation: articulationCounts(song),
    expression: {
      expressiveNotes: expression.expressiveNotes,
      chains: expression.chains.length,
      fallbacks: expression.fallbacks,
    },
    durationSeconds: buildTempoMap(song).totalSeconds,
    totalBars: plan.bars.length,
  };
}
