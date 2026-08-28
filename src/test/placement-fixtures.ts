/**
 * The songs the placement quality claim is measured on (spec 9.2, K-19).
 *
 * Four of them are the product's own: the demo song's guitar and bass, the
 * visual fret fixture, and variants of the demo with a capo and an alternate
 * tuning. Two are made for the purpose: one full of written positions, and one
 * that is deliberately hard for a memoryless rule.
 *
 * The synthetic one is not a straw man. It is a line whose pitches each have a
 * comfortable low position of their own but no low position *together* — which
 * is exactly the shape the old rule handles badly, and exactly the shape a
 * guitarist would play in one place.
 */
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Bar, type MelodicSlot, type Song, SONG_VERSION } from "@/lib/song/schema";
import visualFixture from "@/lib/song/visual-fixture.json";

function parse(candidate: unknown, label: string): Song {
  const result = songSchema.safeParse(candidate);
  if (!result.success) throw new Error(`${label} does not parse`);
  return result.data;
}

export const VISUAL_FIXTURE = parse(visualFixture, "visual fixture");

/** The demo song, capo 3 on the electric guitar. */
export const CAPO_FIXTURE: Song = {
  ...SAMPLE_SONG,
  tracks: SAMPLE_SONG.tracks.map((track) =>
    track.id === "gtr" && track.fretboard
      ? { ...track, fretboard: { ...track.fretboard, capo: 3 } }
      : track,
  ),
};

/** The demo song in drop D. */
export const DROP_D_FIXTURE: Song = {
  ...SAMPLE_SONG,
  tracks: SAMPLE_SONG.tracks.map((track) =>
    track.id === "gtr" && track.fretboard
      ? {
          ...track,
          fretboard: {
            ...track.fretboard,
            tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
          },
        }
      : track,
  ),
};

function guitarBar(slots: readonly MelodicSlot[]): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 8,
    slots: { gtr: [...slots] },
  };
}

function note(pitch: string): MelodicSlot {
  return { notes: [{ pitch }] };
}

function placed(pitch: string, string: number, fret: number): MelodicSlot {
  return { notes: [{ pitch, position: { string, fret } }] };
}

const GUITAR_TRACK = SAMPLE_SONG.tracks.find((track) => track.id === "gtr");
if (!GUITAR_TRACK) throw new Error("demo song has no guitar");

function guitarSong(bars: readonly Bar[], id: string): Song {
  return parse(
    {
      version: SONG_VERSION,
      title: `Fixture ${id}`,
      bpm: 120,
      key: "E minor",
      tracks: [GUITAR_TRACK],
      sections: [{ id, name: id, status: "fixed", bars }],
    },
    id,
  );
}

/**
 * A line that lives around the sixteenth fret, with free notes between written
 * anchors that each have a comfortable position near the nut.
 *
 * This is precisely where a memoryless rule fails: it takes the lowest
 * position for every free note on its own, so the hand is thrown from the
 * anchor down to the nut and back for every note in between. A guitarist plays
 * the whole phrase in one position.
 *
 * B4 at string 3, fret 16 is the anchor. G4, E4 and A4 all have positions
 * within a few frets of it, and all have lower ones elsewhere.
 */
export const CROSS_NECK_FIXTURE = guitarSong(
  [
    guitarBar([
      placed("B4", 3, 16),
      note("G4"),
      note("E4"),
      placed("B4", 3, 16),
      note("A4"),
      note("G4"),
      placed("B4", 3, 16),
      null,
    ]),
    guitarBar([
      placed("A4", 3, 14),
      note("E4"),
      note("G4"),
      placed("A4", 3, 14),
      note("B4"),
      note("G4"),
      placed("A4", 3, 14),
      null,
    ]),
  ],
  "cross-neck",
);

/** Mostly written positions, with a few notes left for the engine. */
export const EXPLICIT_HEAVY_FIXTURE = guitarSong(
  [
    guitarBar([
      placed("A3", 2, 7),
      placed("C4", 2, 10),
      note("B3"),
      placed("E4", 3, 14),
      placed("A3", 2, 7),
      note("D4"),
      placed("G3", 3, 5),
      placed("E3", 3, 2),
    ]),
  ],
  "explicit-heavy",
);

/**
 * The demo song's guitar with every written position removed.
 *
 * The demo carries positions on every note, so the engine has nothing to
 * decide there. This is the shape the engine actually meets in the product:
 * anything the copilot writes, and anything a musician adds without touching
 * the fret field, arrives without a position.
 */
export const UNPOSITIONED_DEMO: Song = {
  ...SAMPLE_SONG,
  sections: SAMPLE_SONG.sections.map((section) => ({
    ...section,
    bars: section.bars.map((bar) => ({
      ...bar,
      slots: Object.fromEntries(
        Object.entries(bar.slots).map(([trackId, slots]) => [
          trackId,
          slots.map((slot) => {
            if (Array.isArray(slot) || slot === null || slot === "-") return slot;
            return {
              notes: slot.notes.map((note) => {
                const stripped: Record<string, unknown> = { ...note };
                delete stripped.position;
                return stripped;
              }),
            };
          }),
        ]),
      ),
    })),
  })),
} as Song;

export type PlacementFixture = {
  id: string;
  song: Song;
  trackId: string;
};

export const PLACEMENT_FIXTURES: readonly PlacementFixture[] = [
  { id: "demo guitar", song: SAMPLE_SONG, trackId: "gtr" },
  { id: "demo bass", song: SAMPLE_SONG, trackId: "bass" },
  { id: "demo acoustic", song: SAMPLE_SONG, trackId: "acc" },
  { id: "visual fret fixture", song: VISUAL_FIXTURE, trackId: "gtr" },
  { id: "capo 3", song: CAPO_FIXTURE, trackId: "gtr" },
  { id: "drop D", song: DROP_D_FIXTURE, trackId: "gtr" },
  { id: "demo guitar, no positions", song: UNPOSITIONED_DEMO, trackId: "gtr" },
  { id: "demo bass, no positions", song: UNPOSITIONED_DEMO, trackId: "bass" },
  { id: "explicit heavy", song: EXPLICIT_HEAVY_FIXTURE, trackId: "gtr" },
  { id: "cross-neck (synthetic)", song: CROSS_NECK_FIXTURE, trackId: "gtr" },
];
