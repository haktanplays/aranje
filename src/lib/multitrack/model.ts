/**
 * Every instrument of the whole song, on one time axis (2Q-A §5, 2Q-C §4).
 *
 * The question this answers is the one a single-track tab cannot: *what is
 * everybody playing here*. Until now the tab was built for exactly one track
 * id, so comparing the bass against the riff meant two taps, a re-read and a
 * memory (`eval/multitrack/BASELINE.json`).
 *
 * ## Why the whole song, and not a section
 *
 * It was one section until 2Q-C, and that was the reason the Çoklu view reset
 * itself every time the music crossed a boundary: a new section meant a new
 * model, a new axis, a new scroll content and a scroll position that meant
 * something else than it had a frame earlier. The baseline measured the
 * result as a 700px jump in a single frame at the boundary.
 *
 * A surface that is meant to be read *while playing* cannot be rebuilt while
 * playing. So the model is the whole song, every section in one bar list, and
 * a section boundary becomes what it is musically — a line between two bars —
 * rather than a change of surface. Which section the reader is looking at is
 * still a fact, but it is a fact about the scroll position now, not about
 * what has been built.
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
 * slot count. Each lane's bars line up with that list by index — which is why
 * no lane can drift, and why there is nothing to keep in step at scroll time.
 *
 * Turning the bar list into pixels is `lib/tab/song-axis.ts`, which the tab
 * uses too. There is one axis in the app rather than one per surface.
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
  SectionStatus,
  Song,
  TimeSignature,
  Track,
} from "@/lib/song/schema";

/**
 * One bar of the song, as every lane sees it.
 *
 * `startTicks` is measured from the start of the **song**, which is the unit
 * the transport reports in, so a playhead position needs no per-section
 * arithmetic to be placed and a section boundary needs no rebasing.
 */
export type MultiBar = {
  readonly key: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly sectionStatus: SectionStatus;
  /** True for the first bar of its section: where the marker is drawn. */
  readonly isSectionStart: boolean;
  /** 0-based inside the section, matching the validator issue path. */
  readonly barIndex: number;
  /** 1-based across the whole song, which is what a reader counts in. */
  readonly barNumber: number;
  readonly timeSignature: TimeSignature;
  readonly resolution: Resolution;
  readonly slotCount: number;
  /** From the start of the song. */
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
  /** True when this track is written in no bar of the song at all. */
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
  /** Registry order. A silent track keeps its place; it does not drop out. */
  readonly lanes: readonly MultiTrackLane[];
  /** Every bar of the song, in order, sections one after another. */
  readonly bars: readonly MultiBar[];
  readonly totalTicks: number;
};

/** How wide a pitched lane's range is allowed to get before it stops growing. */
const PITCH_AXIS_MIN_SEMITONES = 12;

/** Every bar of the song, in order, with ticks counted from its start. */
function songBars(song: Song): { bars: MultiBar[]; totalTicks: number } {
  let songTicks = 0;
  let barNumber = 0;
  const bars: MultiBar[] = [];

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      barNumber += 1;
      const count = slotsInBar(bar.timeSignature, bar.resolution);
      const durationTicks = count * ticksPerSlot(bar.resolution);
      bars.push({
        key: `${section.id}:${barIndex}`,
        sectionId: section.id,
        sectionName: section.name,
        sectionStatus: section.status,
        isSectionStart: barIndex === 0,
        barIndex,
        barNumber,
        timeSignature: bar.timeSignature,
        resolution: bar.resolution,
        slotCount: count,
        startTicks: songTicks,
        durationTicks,
      });
      songTicks += durationTicks;
    });
  }

  return { bars, totalTicks: songTicks };
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
 * Computed once from every note in the song, so the axis does not move when
 * the reader scrolls from a low bar to a high one, or from one section into
 * the next — an axis that rescales as the surface moves makes two bars of the
 * same melody look like two different melodies. A minimum span keeps a lane
 * holding one repeated note from becoming a single line.
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
  bars: readonly MultiBar[],
): { bars: PitchedBar[]; axis: PitchAxis } {
  const sections = new Map(song.sections.map((entry) => [entry.id, entry]));
  const out: PitchedBar[] = [];
  let carried: PitchedNote[] = [];

  for (const bar of bars) {
    const slots = sections.get(bar.sectionId)?.bars[bar.barIndex]?.slots[track.id];
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
 * Every instrument of the whole song, ready to draw.
 *
 * `activeTrackId` names the one lane a command may change. It is a view fact
 * and never reaches the song.
 *
 * There is no section argument. Which section is being read is a scroll
 * position, and rebuilding this for it would be rebuilding the surface the
 * reader is reading.
 */
export function buildMultiTrackModel(
  song: Song,
  activeTrackId: string,
): MultiTrackModel {
  const { bars, totalTicks } = songBars(song);
  const sections = new Map(song.sections.map((entry) => [entry.id, entry]));

  const lanes = song.tracks.map((track): MultiTrackLane => {
    const base: LaneBase = {
      trackId: track.id,
      label: track.name,
      instrumentFamily: instrumentLabel(track.instrumentId),
      active: track.id === activeTrackId,
      silentThroughout: bars.every(
        (bar) =>
          !Object.prototype.hasOwnProperty.call(
            sections.get(bar.sectionId)?.bars[bar.barIndex]?.slots ?? {},
            track.id,
          ),
      ),
    };

    const kind: LaneKind = laneKindOf(track);
    if (kind === "pitched") {
      const { bars: pitched, axis } = pitchedLane(song, track, bars);
      return { ...base, kind: "pitched", axis, bars: pitched };
    }

    // Fretted and drum lanes come from the timeline the tab already uses, so
    // there is one placement search, one tie reading and one drum lane order
    // in the app rather than two that can disagree. It is the whole song, so
    // nothing is filtered out of it either.
    const timeline = buildTrackTimeline(song, track.id);
    if (kind === "drums" && timeline.kind === "drums") {
      return { ...base, kind: "drums", pieces: timeline.lanes, bars: timeline.bars };
    }
    if (timeline.kind === "fretted") {
      return {
        ...base,
        kind: "fretted",
        strings: timeline.strings,
        capo: timeline.capo,
        bars: timeline.bars,
      };
    }
    /*
     * A track the tab cannot build and that is not a kit: nothing is invented
     * for it. It appears as a pitched lane with no notes rather than being
     * dropped, because a track the reader can see they have is better than a
     * track that silently is not there.
     */
    const { bars: pitched, axis } = pitchedLane(song, track, bars);
    return { ...base, kind: "pitched", axis, bars: pitched };
  });

  return { lanes, bars, totalTicks };
}
