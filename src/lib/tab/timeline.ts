/**
 * Render model for the tab workspace.
 *
 * A pure transform from the Song Contract to what the tab view draws. It owns
 * no layout numbers and no React; the view decides pixels.
 *
 * Positions come from the note itself when written out, otherwise from the
 * ergonomic placement engine (spec 9.2, K-19), which reads the whole track in
 * time rather than one chord at a time.
 *
 * This is the only place placement happens. The tab, the validators, the
 * copilot preview and the audio scheduler all read the timeline, so they
 * cannot disagree about where a note is played.
 *
 * ## How long a span is (2T-B §4)
 *
 * It used to be the tie run: a span opened on an onset and every open span
 * closed at the next one, whatever string that one was on. That is where the
 * tab and the scheduler both got their lengths, which meant a note's own
 * `durationTicks` reached neither the screen nor the speakers — Score Truth
 * knew about it and the reader never found out.
 *
 * A span's extent is now what `soundingSpans` says is heard: the written
 * length, which is the note's own if it has one and the tie run if it does
 * not, capped where its own string is taken again. A song with no written
 * durations therefore slices to exactly the spans it always did — that is
 * what makes this a correction rather than a rewrite — and a song with them
 * finally draws and plays what it says.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import type { Fretboard } from "@/lib/music/fretboard";
import { maxShiftFor } from "@/lib/music/hand-position";
import {
  placeTrack,
  type PlacementDiagnostics,
} from "@/lib/music/placement";
import { trackPlacementInput } from "@/lib/tab/placement-input";
import { sliceSpan } from "@/lib/tab/span-extent";
import { indexSpans } from "@/lib/music/technique-span";
import {
  barOffsets,
  sectionTicks,
  soundingSpans,
  writtenSpans,
  type WrittenSpan,
} from "@/lib/song/sounding";
import {
  readingResolution,
  slotCount,
  slotsPerReadingSlot,
} from "@/lib/music/timing";
import type {
  Articulation,
  Bar,
  DrumPiece,
  DrumSlot,
  MelodicSlot,
  NoteAttack,
  NoteConnection,
  PickingDirection,
  PitchGesture,
  Resolution,
  SectionStatus,
  Song,
  TimeSignature,
  Track,
} from "@/lib/song/schema";

/**
 * Top-to-bottom lane order, following drum notation habit.
 *
 * Exported because the arrangement overview draws its drum cells against the
 * same order. A second copy of this list is how the tab and the overview end
 * up disagreeing about whether the kick is above or below the snare.
 */
export const DRUM_LANE_ORDER: readonly DrumPiece[] = [
  "crash",
  "china",
  "ride",
  "open_hat",
  "closed_hat",
  "tom_high",
  "tom_mid",
  "tom_floor",
  "snare",
  "kick",
];

export type BarMeta = {
  key: string;
  /** 1-based, counted across the whole song. */
  barNumber: number;
  /** 0-based, counted inside its own section; the validator issue path. */
  barIndex: number;
  sectionId: string;
  sectionName: string;
  sectionStatus: SectionStatus;
  isSectionStart: boolean;
  timeSignature: TimeSignature;
  /** The grid the bar is stored on. May be a lattice (§5). */
  resolution: Resolution;
  /**
   * The grid the reader is reading and tapping on.
   *
   * The same as `resolution` in every ordinary bar. It differs only where a
   * local write raised this one bar to a lattice so a triplet could live
   * beside straight sixteenths: the notes are drawn at their exact lattice
   * positions and the cells, the label and the counting stay where the reader
   * left them (2V-B.4 Completion §5, §7).
   */
  notation: Resolution;
  slotCount: number;
  /** Lattice slots per reading cell. One in every ordinary bar. */
  slotsPerCell: number;
  /** The track writes nothing in this bar, so it is silent here (spec 5.5). */
  silent: boolean;
};

export type TabSpan = {
  stringIndex: number;
  /**
   * Which voice of the onset this is — a chord's notes each have their own
   * length, so anything aiming an edit at one of them needs to say which.
   */
  noteIndex: number;
  /** null when no playable placement exists for the written pitch. */
  fret: number | null;
  pitch: string;
  velocity?: number;
  articulation?: Articulation;
  /**
   * What the pitch does and how the note is joined (2V-C.1 §2).
   *
   * Carried rather than interpreted. The span is a drawing and a scheduling
   * fact; what these two *mean* is `expression-resolver`'s answer, asked once
   * by whoever needs it.
   */
  pitchGesture?: PitchGesture;
  connection?: NoteConnection;
  /**
   * How the string was struck and which way the pick crossed it (2V-D.1 §3).
   *
   * Carried rather than interpreted, exactly like the two above: everything
   * downstream — the drawing, the plan, the reader's summary — asks the
   * resolver what they mean, and a span that dropped them would be a note
   * whose expression stops at the edge of the model.
   */
  attack?: NoteAttack;
  picking?: PickingDirection;
  /** Whether this note rings past the next attack on its own string. */
  letRing?: boolean;
  /** The picking hand's direction across a chord, when the reader wrote one. */
  strum?: "down" | "up";
  startSlot: number;
  /** Inclusive. */
  endSlot: number;
  /**
   * The note's written value in ticks — its own `durationTicks` if it stated
   * one, otherwise the tie run under it. This is what a stem, its beams and
   * its dot are claims about, and it is exact where `endSlot` is rounded to
   * the grid: a dotted sixteenth covers two sixteenth slots but is 72 ticks,
   * not 96, and only one of those two numbers may be drawn as a value.
   */
  writtenTicks: number;
  /** Already sounding when the bar began. */
  openStart: boolean;
  /** Still sounding when the bar ended. */
  openEnd: boolean;
};

export type DrumMark = {
  slotIndex: number;
  laneIndex: number;
  piece: DrumPiece;
  velocity?: number;
  articulation?: "normal" | "ghost" | "accent";
};

export type FrettedBar = BarMeta & { spans: TabSpan[]; rests: number[] };
export type DrumBar = BarMeta & { marks: DrumMark[]; rests: number[] };

export type TrackTimeline =
  | {
      kind: "fretted";
      trackId: string;
      strings: readonly string[];
      capo: number;
      bars: FrettedBar[];
      /** What the placement search did. Never written to the Song (K-19). */
      placement: PlacementDiagnostics;
    }
  | { kind: "drums"; trackId: string; lanes: DrumPiece[]; bars: DrumBar[] }
  | { kind: "unsupported"; trackId: string; reason: string };

function isMelodicSlot(
  slot: MelodicSlot | DrumSlot | undefined,
): slot is MelodicSlot {
  return !Array.isArray(slot);
}

type MetaEntry = { meta: Omit<BarMeta, "silent">; bar: Bar };

function barMeta(song: Song): MetaEntry[] {
  const entries: MetaEntry[] = [];
  let barNumber = 0;

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      barNumber += 1;
      entries.push({
        bar,
        meta: {
          key: `${section.id}:${barIndex}`,
          barNumber,
          barIndex,
          sectionId: section.id,
          sectionName: section.name,
          sectionStatus: section.status,
          isSectionStart: barIndex === 0,
          timeSignature: bar.timeSignature,
          resolution: bar.resolution,
          notation: readingResolution(bar),
          slotCount: slotCount(bar.timeSignature, bar.resolution),
          slotsPerCell: slotsPerReadingSlot(bar),
        },
      });
    });
  }

  return entries;
}

function buildFretted(
  song: Song,
  track: Track,
  fretboard: Fretboard,
): { bars: FrettedBar[]; diagnostics: PlacementDiagnostics } {
  const metas = barMeta(song);
  const bars: FrettedBar[] = [];

  // Placement happens once, over the whole track, before any span is built.
  const { onsets, bars: placementBars, slurs } = trackPlacementInput(song, track.id);
  const placement = placeTrack({
    fretboard,
    onsets,
    bars: placementBars,
    // Slurred pairs are placed together rather than checked afterwards
    // (spec 8.5, 9.2, K-27).
    slurs,
    // A family with no threshold still needs a number to compare against;
    // the guitar's is the safe one to fall back on.
    maxShift: maxShiftFor(track.instrumentId) ?? maxShiftFor("electric_guitar") ?? 7,
  });

  /*
   * Which string each written note ended up on, so occlusion can be asked.
   * A note the engine could not place has no string, and a note with no
   * string competes with nothing.
   */
  const flatBars = metas.map((entry) => entry.bar);
  const placedNotes = (span: WrittenSpan) => {
    const outcome = placement.byOnset.get(
      `${metas[span.barIndex]!.meta.key}:${span.slotIndex}`,
    );
    // A partial outcome still carries its written positions; only the notes
    // that found no string come back without one.
    const placed =
      outcome?.kind === "placed" || outcome?.kind === "partial"
        ? outcome.voicing.notes
        : null;
    return placed?.find((note) => note.noteIndex === span.noteIndex);
  };

  /*
   * Where each section starts, so a span's section-relative ticks can be
   * compared with a note's place in the whole track (2V-D.1 §6).
   *
   * `TechniqueSpan` is addressed from the start of its own section for the
   * same reason a phrase is; the timeline counts from the start of the song.
   * The offset is the only thing between the two, and it is computed here
   * rather than stored, so there is nothing to fall out of step with.
   */
  const offsets = barOffsets(flatBars);
  const sectionStart = new Map<string, number>();
  metas.forEach((entry, index) => {
    if (entry.meta.isSectionStart) {
      sectionStart.set(entry.meta.sectionId, offsets[index] ?? 0);
    }
  });
  const spansBySection = new Map(
    song.sections.map((section) => [section.id, indexSpans(section.techniqueSpans)]),
  );

  const heard = soundingSpans(
    writtenSpans(flatBars, track.id),
    (span) => placedNotes(span)?.stringIndex ?? null,
    sectionTicks(flatBars),
    (span, stringIndex) => {
      if (span.note.letRing === true) return true;
      const meta = metas[span.barIndex]?.meta;
      if (!meta) return false;
      const index = spansBySection.get(meta.sectionId);
      if (!index) return false;
      const at = span.startTicks - (sectionStart.get(meta.sectionId) ?? 0);
      return index
        .at({ trackId: track.id, timeTicks: at, stringIndex })
        .some((held) => held.kind === "let_ring");
    },
  );

  const perBar: TabSpan[][] = metas.map(() => []);
  for (const span of heard) {
    const position = placedNotes(span);
    for (const slice of sliceSpan(flatBars, span.startTicks, span.soundingTicks)) {
      perBar[slice.barIndex]!.push({
        // An onset the engine could not place keeps its pitch and loses only
        // its position; `unplaceable` reports it (spec 10.3).
        stringIndex: position?.stringIndex ?? -1,
        noteIndex: span.noteIndex,
        fret: position?.fret ?? null,
        pitch: span.note.pitch,
        velocity: span.note.velocity,
        articulation: span.note.articulation,
        pitchGesture: span.note.pitchGesture,
        connection: span.note.connection,
        attack: span.note.attack,
        picking: span.note.picking,
        letRing: span.note.letRing,
        strum: span.note.strum,
        writtenTicks: span.writtenTicks,
        startSlot: slice.startSlot,
        endSlot: slice.endSlot,
        openStart: slice.openStart,
        openEnd: slice.openEnd,
      });
    }
  }

  metas.forEach((entry, index) => {
    const slots = entry.bar.slots[track.id];
    const rest = entry.meta;

    if (slots === undefined) {
      bars.push({ ...rest, silent: true, spans: [], rests: [] });
      return;
    }

    const spans = perBar[index]!;
    const rests: number[] = [];

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex];
      if (!isMelodicSlot(slot)) continue; // shape errors are the validator's job
      if (slot === null) rests.push(slotIndex);
    }

    bars.push({ ...rest, silent: false, spans, rests });
  });

  return { bars, diagnostics: placement.diagnostics };
}

function buildDrums(song: Song, track: Track): {
  lanes: DrumPiece[];
  bars: DrumBar[];
} {
  const metas = barMeta(song);

  // Lanes are the pieces the song actually uses, in notation order. Adding
  // lanes through the UI is phase 2.5; this only mirrors the data.
  const used = new Set<DrumPiece>();
  for (const entry of metas) {
    const slots = entry.bar.slots[track.id];
    if (slots === undefined) continue;
    for (const slot of slots) {
      if (!Array.isArray(slot)) continue;
      for (const hit of slot) used.add(hit.piece);
    }
  }
  const lanes = DRUM_LANE_ORDER.filter((piece) => used.has(piece));
  const laneIndex = new Map(lanes.map((piece, index) => [piece, index]));

  const bars: DrumBar[] = metas.map((entry) => {
    const slots = entry.bar.slots[track.id];
    const rest = entry.meta;

    if (slots === undefined) {
      return { ...rest, silent: true, marks: [], rests: [] };
    }

    const marks: DrumMark[] = [];
    const rests: number[] = [];

    slots.forEach((slot, slotIndex) => {
      if (!Array.isArray(slot)) return; // shape errors are the validator's job
      if (slot.length === 0) {
        rests.push(slotIndex);
        return;
      }
      for (const hit of slot) {
        const lane = laneIndex.get(hit.piece);
        if (lane === undefined) continue;
        marks.push({
          slotIndex,
          laneIndex: lane,
          piece: hit.piece,
          velocity: hit.velocity,
          articulation: hit.articulation,
        });
      }
    });

    return { ...rest, silent: false, marks, rests };
  });

  return { lanes, bars };
}

/** Build what the workspace draws for one track. */
export function buildTrackTimeline(
  song: Song,
  trackId: string,
): TrackTimeline {
  const track = song.tracks.find((entry) => entry.id === trackId);
  if (!track) {
    return {
      kind: "unsupported",
      trackId,
      reason: "Bu track şarkıda bulunmuyor.",
    };
  }

  if (isDrumInstrument(track.instrumentId)) {
    const { lanes, bars } = buildDrums(song, track);
    return { kind: "drums", trackId, lanes, bars };
  }

  if (!track.fretboard) {
    return {
      kind: "unsupported",
      trackId,
      reason: "Bu enstrüman için tab görünümü sonraki fazda geliyor.",
    };
  }

  const fretted = buildFretted(song, track, track.fretboard);
  return {
    kind: "fretted",
    trackId,
    strings: track.fretboard.tuning,
    capo: track.fretboard.capo,
    bars: fretted.bars,
    placement: fretted.diagnostics,
  };
}

/** Section runs across the flattened bar stream, for the chip row. */
/**
 * One section, as a strip of the song.
 *
 * Named here because this is where it is made. It used to be declared by the
 * chip component that happened to draw it first, which meant a navigator and a
 * sheet both imported a type from a component neither of them rendered.
 */
export type SectionRun = {
  sectionId: string;
  name: string;
  status: SectionStatus;
  /** 1-based bar number this section starts on, counted across the song. */
  firstBar: number;
  barCount: number;
};

export function sectionRuns(song: Song): SectionRun[] {
  let barNumber = 0;
  return song.sections.map((section) => {
    const firstBar = barNumber + 1;
    barNumber += section.bars.length;
    return {
      sectionId: section.id,
      name: section.name,
      status: section.status,
      firstBar,
      barCount: section.bars.length,
    };
  });
}

/**
 * What each slot of a bar does, for the rhythm strip under the staff. This is
 * how a rest is told apart from a sustained note and from an empty grid cell.
 */
export type SlotState = "onset" | "sustain" | "rest" | "empty";

export function frettedRhythm(bar: FrettedBar): SlotState[] {
  const states: SlotState[] = Array.from(
    { length: bar.slotCount },
    () => "empty",
  );
  if (bar.silent) return states;

  for (const span of bar.spans) {
    for (let slot = span.startSlot; slot <= span.endSlot; slot += 1) {
      if (slot < 0 || slot >= states.length) continue;
      const isOnset = slot === span.startSlot && !span.openStart;
      if (isOnset) {
        states[slot] = "onset";
      } else if (states[slot] !== "onset") {
        states[slot] = "sustain";
      }
    }
  }

  for (const slot of bar.rests) {
    if (slot >= 0 && slot < states.length && states[slot] === "empty") {
      states[slot] = "rest";
    }
  }

  return states;
}

export function drumRhythm(bar: DrumBar): SlotState[] {
  const states: SlotState[] = Array.from(
    { length: bar.slotCount },
    () => "empty",
  );
  if (bar.silent) return states;

  for (const mark of bar.marks) {
    if (mark.slotIndex >= 0 && mark.slotIndex < states.length) {
      states[mark.slotIndex] = "onset";
    }
  }
  for (const slot of bar.rests) {
    if (slot >= 0 && slot < states.length && states[slot] === "empty") {
      states[slot] = "rest";
    }
  }

  return states;
}

export const __testing = { DRUM_LANE_ORDER };
