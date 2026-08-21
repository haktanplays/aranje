/**
 * Render model for the tab workspace.
 *
 * A pure transform from the Song Contract to what the tab view draws. It owns
 * no layout numbers and no React; the view decides pixels.
 *
 * Positions come from the note itself when written out, otherwise from the
 * ergonomic placement engine (spec 9.2, K-19), which reads the whole track in
 * time rather than one chord at a time. A tie chain that reaches the first
 * slot of a bar continues the previous bar, so sounding state is carried
 * across bars exactly as the voice counter does (spec 6).
 *
 * This is the only place placement happens. The tab, the validators, the
 * copilot preview and the audio scheduler all read the timeline, so they
 * cannot disagree about where a note is played.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import type { Fretboard } from "@/lib/music/fretboard";
import { maxShiftFor } from "@/lib/music/hand-position";
import {
  placeTrack,
  type PlacementDiagnostics,
} from "@/lib/music/placement";
import { trackPlacementInput } from "@/lib/tab/placement-input";
import { slotCount } from "@/lib/music/timing";
import type {
  Articulation,
  Bar,
  DrumPiece,
  DrumSlot,
  MelodicSlot,
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
  resolution: Resolution;
  slotCount: number;
  /** The track writes nothing in this bar, so it is silent here (spec 5.5). */
  silent: boolean;
};

export type TabSpan = {
  stringIndex: number;
  /** null when no playable placement exists for the written pitch. */
  fret: number | null;
  pitch: string;
  velocity?: number;
  articulation?: Articulation;
  startSlot: number;
  /** Inclusive. */
  endSlot: number;
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

type OpenSpan = {
  stringIndex: number;
  fret: number | null;
  pitch: string;
  velocity?: number;
  articulation?: Articulation;
  startSlot: number;
  endSlot: number;
  openStart: boolean;
};

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
          slotCount: slotCount(bar.timeSignature, bar.resolution),
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

  // What is still sounding when the previous bar ended.
  let carried: Omit<OpenSpan, "startSlot" | "endSlot" | "openStart">[] = [];

  metas.forEach((entry, index) => {
    const slots = entry.bar.slots[track.id];
    const rest = entry.meta;

    if (slots === undefined) {
      bars.push({ ...rest, silent: true, spans: [], rests: [] });
      carried = [];
      return;
    }

    const spans: TabSpan[] = [];
    const rests: number[] = [];
    let open: OpenSpan[] = [];

    const closeOpen = () => {
      for (const span of open) {
        spans.push({ ...span, openEnd: false });
      }
      open = [];
    };

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex];
      if (!isMelodicSlot(slot)) continue; // shape errors are the validator's job

      if (slot === null) {
        closeOpen();
        rests.push(slotIndex);
        continue;
      }

      if (slot === "-") {
        if (open.length === 0 && slotIndex === 0 && carried.length > 0) {
          open = carried.map((span) => ({
            ...span,
            startSlot: 0,
            endSlot: 0,
            openStart: true,
          }));
        }
        for (const span of open) span.endSlot = slotIndex;
        continue;
      }

      closeOpen();
      const outcome = placement.byOnset.get(`${entry.meta.key}:${slotIndex}`);
      // A partial outcome still carries its written positions; only the notes
      // that found no string come back without one.
      const placed =
        outcome?.kind === "placed" || outcome?.kind === "partial"
          ? outcome.voicing.notes
          : null;

      open = slot.notes.map((note, noteIndex) => {
        const position = placed?.find((entry) => entry.noteIndex === noteIndex);
        return {
          // An onset the engine could not place keeps its pitch and loses only
          // its position; `unplaceable` reports it (spec 10.3).
          stringIndex: position?.stringIndex ?? -1,
          fret: position?.fret ?? null,
          pitch: note.pitch,
          velocity: note.velocity,
          articulation: note.articulation,
          startSlot: slotIndex,
          endSlot: slotIndex,
          openStart: false,
        };
      });
    }

    // Anything still open runs to the end of the bar.
    const stillOpen = open;
    const nextEntry = metas[index + 1];
    const nextSlots = nextEntry?.bar.slots[track.id];
    const continues = nextSlots !== undefined && nextSlots[0] === "-";

    for (const span of stillOpen) {
      spans.push({ ...span, openEnd: continues });
    }

    carried = continues
      ? stillOpen.map(
          ({ stringIndex, fret, pitch, velocity, articulation }) => ({
            stringIndex,
            fret,
            pitch,
            velocity,
            articulation,
          }),
        )
      : [];

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
