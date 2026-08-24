/**
 * Every instrument of one section, on one time axis (2Q-A §5).
 *
 * The question this answers is the one a single-track tab cannot: *what is
 * everybody playing here*. Until now the tab was built for exactly one track
 * id, so comparing the bass against the riff meant two taps, a re-read and a
 * memory (`eval/multitrack/BASELINE.json`).
 *
 * ## What it is not
 *
 * It is not a mixer. There is no level, no pan, no mute and no solo in this
 * model, and adding one would make a listening tool out of a reading surface.
 *
 * It is not a cross-track editor either. It says which lane is **active**,
 * and that is the only track a command built from this model may change
 * (§8). Showing four instruments at once and editing four instruments at
 * once are different promises, and only the first one is made here.
 *
 * ## The shared axis
 *
 * Every lane is laid over **one** bar list. That is not a convention this
 * module maintains by hand: a bar's meter and resolution belong to the *bar*,
 * not to a track, so every track written in a given bar has exactly the same
 * slot count. The bar geometry is therefore computed once, from the section,
 * and each lane's bars line up with it by index — which is why no lane can
 * drift, and why there is nothing to keep in step at scroll time.
 *
 * ## Pure
 *
 * No React, no audio, no storage, no pixels. Ticks and slot counts go out;
 * turning those into x positions is `geometry.ts`, and turning them into DOM
 * is the canvas. The song is read and never written.
 */
import { instrumentLabel } from "@/lib/instruments/registry";
import { pitchToMidi } from "@/lib/music/pitch";
import { slotCount as slotsInBar, ticksPerSlot } from "@/lib/music/timing";
import { laneKindOf, type LaneKind } from "@/lib/multitrack/lane-kind";
import { buildTrackTimeline, type DrumBar, type FrettedBar } from "@/lib/tab/timeline";
import type { DrumPiece } from "@/lib/instruments/registry";
import type {
  Articulation,
  MelodicSlot,
  Resolution,
  Song,
  TimeSignature,
  Track,
} from "@/lib/song/schema";

/**
 * One bar of the section, as every lane sees it.
 *
 * `startTicks` is measured from the start of the *section*, not of the song:
 * the multi view draws one section at a time, and a section that begins at
 * bar 40 should not begin 40 bars along its own axis.
 */
export type MultiBar = {
  readonly key: string;
  /** 0-based inside the section, matching the validator issue path. */
  readonly barIndex: number;
  /** 1-based across the whole song, which is what a reader counts in. */
  readonly barNumber: number;
  readonly timeSignature: TimeSignature;
  readonly resolution: Resolution;
  readonly slotCount: number;
  readonly startTicks: number;
  readonly durationTicks: number;
};

/** One note of a pitched lane: a pitch and a place in time. Nothing else. */
export type PitchedNote = {
  readonly pitch: string;
  /** null when the pitch is not one the pitch helper can read. */
  readonly midi: number | null;
  readonly startSlot: number;
  /** Inclusive, so a note held across ties is one note. */
  readonly endSlot: number;
  readonly velocity?: number;
  readonly articulation?: Articulation;
  /** Already sounding when the bar began. */
  readonly openStart: boolean;
};

export type PitchedBar = {
  readonly key: string;
  readonly barIndex: number;
  readonly silent: boolean;
  readonly notes: readonly PitchedNote[];
};

/** The vertical range a pitched lane draws over. Stable for the whole model. */
export type PitchAxis = {
  readonly lowMidi: number;
  readonly highMidi: number;
  /** Always at least one, so a lane with one note is not zero pixels tall. */
  readonly span: number;
};

type LaneBase = {
  readonly trackId: string;
  /** The name the reader gave the track. */
  readonly label: string;
  /** The instrument in the reader's language. Never an id. */
  readonly instrumentFamily: string;
  readonly active: boolean;
  /** True when this track is written in no bar of this section at all. */
  readonly silentThroughout: boolean;
};

export type MultiTrackLane = LaneBase &
  (
    | {
        readonly kind: "fretted";
        readonly strings: readonly string[];
        readonly capo: number;
        readonly bars: readonly FrettedBar[];
      }
    | {
        readonly kind: "drums";
        readonly pieces: readonly DrumPiece[];
        readonly bars: readonly DrumBar[];
      }
    | {
        readonly kind: "pitched";
        readonly axis: PitchAxis;
        readonly bars: readonly PitchedBar[];
      }
  );

export type MultiTrackModel = {
  readonly sectionId: string;
  readonly sectionName: string;
  /** Registry order. A silent track keeps its place; it does not drop out. */
  readonly lanes: readonly MultiTrackLane[];
  readonly bars: readonly MultiBar[];
  readonly sectionStartTicks: number;
  readonly sectionEndTicks: number;
};

/** How wide a pitched lane's range is allowed to get before it stops growing. */
const PITCH_AXIS_MIN_SEMITONES = 12;

/**
 * The bars of one section, with ticks counted from the song's start and from
 * the section's.
 */
function sectionBars(song: Song, sectionId: string): {
  bars: MultiBar[];
  startTicks: number;
  endTicks: number;
} {
  let songTicks = 0;
  let barNumber = 0;
  let startTicks = 0;
  let endTicks = 0;
  const bars: MultiBar[] = [];

  for (const section of song.sections) {
    const isTarget = section.id === sectionId;
    if (isTarget) startTicks = songTicks;
    section.bars.forEach((bar, barIndex) => {
      barNumber += 1;
      const count = slotsInBar(bar.timeSignature, bar.resolution);
      const durationTicks = count * ticksPerSlot(bar.resolution);
      if (isTarget) {
        bars.push({
          key: `${section.id}:${barIndex}`,
          barIndex,
          barNumber,
          timeSignature: bar.timeSignature,
          resolution: bar.resolution,
          slotCount: count,
          // From the start of the section: this axis begins here.
          startTicks: songTicks - startTicks,
          durationTicks,
        });
      }
      songTicks += durationTicks;
    });
    if (isTarget) endTicks = songTicks;
  }

  return { bars, startTicks, endTicks };
}

/**
 * The notes of one pitched bar.
 *
 * Read straight off the melodic slots, exactly as the tab timeline reads a
 * fretted track: a `-` continues whatever was sounding, a `null` is a rest,
 * and a chord is one slot carrying several notes — one onset, not several.
 */
function pitchedBar(
  slots: readonly MelodicSlot[] | undefined,
  key: string,
  barIndex: number,
  carried: readonly PitchedNote[],
): { bar: PitchedBar; open: PitchedNote[] } {
  if (slots === undefined) {
    // Not written here: a genuine gap, and it ends any carry (spec 5.5).
    return { bar: { key, barIndex, silent: true, notes: [] }, open: [] };
  }

  const notes: PitchedNote[] = [];
  let open: PitchedNote[] = [];

  const close = () => {
    for (const note of open) notes.push(note);
    open = [];
  };

  slots.forEach((slot, slotIndex) => {
    if (slot === null) {
      close();
      return;
    }
    if (slot === "-") {
      if (open.length === 0 && slotIndex === 0 && carried.length > 0) {
        open = carried.map((note) => ({
          ...note,
          startSlot: 0,
          endSlot: 0,
          openStart: true,
        }));
      }
      // A tie extends what is sounding. It is not a new onset.
      open = open.map((note) => ({ ...note, endSlot: slotIndex }));
      return;
    }
    close();
    open = slot.notes.map((note) => ({
      pitch: note.pitch,
      midi: pitchToMidi(note.pitch),
      startSlot: slotIndex,
      endSlot: slotIndex,
      ...(note.velocity === undefined ? {} : { velocity: note.velocity }),
      ...(note.articulation === undefined ? {} : { articulation: note.articulation }),
      openStart: false,
    }));
  });

  const stillOpen = open;
  close();
  return { bar: { key, barIndex, silent: false, notes }, open: stillOpen };
}

/**
 * The vertical range a pitched lane draws over.
 *
 * Computed once from every note in the section, so the axis does not move
 * when the reader scrolls from a low bar to a high one — an axis that
 * rescales per bar makes two bars of the same melody look like two different
 * melodies. A minimum span keeps a lane holding one repeated note from
 * becoming a single line.
 */
function pitchAxisOf(bars: readonly PitchedBar[]): PitchAxis {
  const midis = bars
    .flatMap((bar) => bar.notes)
    .map((note) => note.midi)
    .filter((midi): midi is number => midi !== null);
  if (midis.length === 0) {
    // Middle C either side: an empty lane still has somewhere to draw.
    return { lowMidi: 60 - 6, highMidi: 60 + 6, span: PITCH_AXIS_MIN_SEMITONES };
  }
  const low = Math.min(...midis);
  const high = Math.max(...midis);
  const span = Math.max(high - low, PITCH_AXIS_MIN_SEMITONES);
  const pad = Math.floor((span - (high - low)) / 2);
  return { lowMidi: low - pad, highMidi: low - pad + span, span };
}

function pitchedLane(
  song: Song,
  track: Track,
  sectionId: string,
  bars: readonly MultiBar[],
): { bars: PitchedBar[]; axis: PitchAxis } {
  const section = song.sections.find((entry) => entry.id === sectionId);
  const out: PitchedBar[] = [];
  let carried: PitchedNote[] = [];

  for (const bar of bars) {
    const slots = section?.bars[bar.barIndex]?.slots[track.id];
    const melodic = Array.isArray(slots) && !Array.isArray(slots[0])
      ? (slots as readonly MelodicSlot[])
      : undefined;
    const built = pitchedBar(melodic, bar.key, bar.barIndex, carried);
    out.push(built.bar);
    // A note still sounding at the bar line carries only if the next bar
    // opens with a tie, which `pitchedBar` decides for itself.
    carried = built.open;
  }

  return { bars: out, axis: pitchAxisOf(out) };
}

/**
 * Every instrument of one section, ready to draw.
 *
 * `activeTrackId` names the one lane a command may change. It is a view fact
 * and never reaches the song.
 */
export function buildMultiTrackModel(
  song: Song,
  sectionId: string,
  activeTrackId: string,
): MultiTrackModel {
  const section =
    song.sections.find((entry) => entry.id === sectionId) ?? song.sections[0];
  const resolvedId = section?.id ?? sectionId;
  const { bars, startTicks, endTicks } = sectionBars(song, resolvedId);

  const lanes = song.tracks.map((track): MultiTrackLane => {
    const base: LaneBase = {
      trackId: track.id,
      label: track.name,
      instrumentFamily: instrumentLabel(track.instrumentId),
      active: track.id === activeTrackId,
      silentThroughout: bars.every(
        (bar) =>
          !Object.prototype.hasOwnProperty.call(
            section?.bars[bar.barIndex]?.slots ?? {},
            track.id,
          ),
      ),
    };

    const kind: LaneKind = laneKindOf(track);
    if (kind === "pitched") {
      const { bars: pitched, axis } = pitchedLane(song, track, resolvedId, bars);
      return { ...base, kind: "pitched", axis, bars: pitched };
    }

    // Fretted and drum lanes come from the timeline the tab already uses, so
    // there is one placement search, one tie reading and one drum lane order
    // in the app rather than two that can disagree.
    const timeline = buildTrackTimeline(song, track.id);
    if (kind === "drums" && timeline.kind === "drums") {
      return {
        ...base,
        kind: "drums",
        pieces: timeline.lanes,
        bars: timeline.bars.filter((bar) => bar.sectionId === resolvedId),
      };
    }
    if (timeline.kind === "fretted") {
      return {
        ...base,
        kind: "fretted",
        strings: timeline.strings,
        capo: timeline.capo,
        bars: timeline.bars.filter((bar) => bar.sectionId === resolvedId),
      };
    }
    /*
     * A track the tab cannot build and that is not a kit: nothing is invented
     * for it. It appears as a pitched lane with no notes rather than being
     * dropped, because a track the reader can see they have is better than a
     * track that silently is not there.
     */
    const { bars: pitched, axis } = pitchedLane(song, track, resolvedId, bars);
    return { ...base, kind: "pitched", axis, bars: pitched };
  });

  return {
    sectionId: resolvedId,
    sectionName: section?.name ?? "",
    lanes,
    bars,
    sectionStartTicks: startTicks,
    sectionEndTicks: endTicks,
  };
}
