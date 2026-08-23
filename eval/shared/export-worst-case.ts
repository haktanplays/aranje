/**
 * The two worst cases an export actually has, derived from the limits
 * (spec 13.19, 2M-A.1 §1).
 *
 * They are deliberately *two*, because "worst case" is two different
 * questions and answering them with one fixture hides whichever pressure the
 * fixture happens not to apply:
 *
 * - **Longest duration** decides how many frames a WAV holds, and therefore
 *   how many bytes and how much memory. It wants the slowest tempo and the
 *   longest bars, and it does not care how many notes there are.
 * - **Heaviest event load** decides how much work the scheduler, the
 *   expression planner and the voice pool do. It wants every track, the
 *   finest grid and real onsets, and it does not care how slow the song is.
 *
 * Every number below is read from the central limits rather than typed in,
 * so a change to `songLimits`, `bpmRange` or the meter table moves the
 * fixtures with it instead of leaving a stale constant behind.
 */
import { bpmRange, songLimits } from "@/lib/limits";
import {
  RESOLUTIONS,
  TICKS_PER_WHOLE,
  TIME_SIGNATURES,
  ticksPerBar,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";
import { songSchema, type Song } from "@/lib/song/schema";

const asMeter = (meter: readonly [number, number]) =>
  [meter[0], meter[1]] as TimeSignature;

/**
 * The meter whose bar lasts longest, chosen by asking the timing core.
 *
 * At a fixed tempo a bar's length is its tick count, and `ticksPerBar` is the
 * one thing that knows it — so the "longest bar" is measured, not asserted.
 * (Today that is 4/4 at 768 ticks, against 672 for 7/8 and 576 for 3/4 and
 * 6/8, but nothing here depends on that staying true.)
 */
export function longestMeter(): { meter: TimeSignature; ticks: number } {
  let best = { meter: asMeter(TIME_SIGNATURES[0]), ticks: 0 };
  for (const entry of TIME_SIGNATURES) {
    const meter = asMeter(entry);
    // Any grid the meter can be written at gives the same bar length.
    const grid = RESOLUTIONS.find((resolution) => {
      try {
        ticksPerBar(meter, resolution);
        return true;
      } catch {
        return false;
      }
    });
    if (grid === undefined) continue;
    const ticks = ticksPerBar(meter, grid);
    if (ticks > best.ticks) best = { meter, ticks };
  }
  return best;
}

/** The finest grid a meter can actually be written at. */
export function finestGridFor(meter: TimeSignature): Resolution {
  const usable = RESOLUTIONS.filter((resolution) => {
    try {
      ticksPerBar(meter, resolution);
      return true;
    } catch {
      return false;
    }
  });
  return usable[usable.length - 1]!;
}

export type DerivedWorstCase = {
  readonly bars: number;
  readonly bpm: number;
  readonly meter: TimeSignature;
  readonly ticksPerBar: number;
  readonly secondsPerBar: number;
  readonly notatedSeconds: number;
};

/**
 * The longest song the product's own limits permit, as arithmetic.
 *
 * `secondsPerTick` is `60 / (bpm * PPQ)`, which is what the tempo map uses;
 * a bar is its tick count times that. Stated here so the report can show the
 * derivation rather than a number someone has to trust.
 */
export function derivedLongestDuration(): DerivedWorstCase {
  const { meter, ticks } = longestMeter();
  const bpm = bpmRange.min;
  const ticksPerQuarter = TICKS_PER_WHOLE / 4;
  const secondsPerTick = 60 / (bpm * ticksPerQuarter);
  const secondsPerBar = ticks * secondsPerTick;
  return {
    bars: songLimits.totalBars,
    bpm,
    meter,
    ticksPerBar: ticks,
    secondsPerBar,
    notatedSeconds: songLimits.totalBars * secondsPerBar,
  };
}

/* ---------------------------------------------------------------- pieces */

const GUITAR = ["E2", "A2", "D3", "G3", "B3", "E4"] as const;
const BASS = ["E1", "A1", "D2", "G2"] as const;

/** Pitch/fret pairs that agree, so the validators have nothing to refuse. */
const LOW_E = [
  { pitch: "E2", fret: 0 },
  { pitch: "G2", fret: 3 },
  { pitch: "A2", fret: 5 },
  { pitch: "B2", fret: 7 },
] as const;

const melodicTrack = (id: string, name: string, volumeDb: number, pan?: number) => ({
  id,
  name,
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb,
  ...(pan === undefined ? {} : { pan }),
  fretboard: { tuning: [...GUITAR], capo: 0 },
});

const bassTrack = (id: string, name: string) => ({
  id,
  name,
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -4,
  fretboard: { tuning: [...BASS], capo: 0 },
});

const drumTrack = (id: string, name: string) => ({
  id,
  name,
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -4,
});

/** Sections of at most `barsPerSection` bars, adding up to `totalBars`. */
function sectionsOf(
  bars: number,
  build: (barIndex: number) => unknown,
  meter: TimeSignature,
  resolution: Resolution,
  bpmOverride?: number,
) {
  const sections: unknown[] = [];
  let made = 0;
  let index = 0;
  while (made < bars) {
    const count = Math.min(songLimits.barsPerSection, bars - made);
    sections.push({
      id: `s${index + 1}`,
      name: `Bolum ${index + 1}`,
      status: "fixed",
      ...(bpmOverride === undefined ? {} : { bpmOverride }),
      bars: Array.from({ length: count }, (_, barIndex) => ({
        timeSignature: meter,
        resolution,
        slots: build(made + barIndex),
      })),
    });
    made += count;
    index += 1;
  }
  return sections;
}

/* ------------------------------------------------------- the two fixtures */

/**
 * Every bar the contract allows, at the slowest tempo, in the longest meter.
 *
 * One audible note in the **final** bar, so the render cannot be shortened by
 * noticing there is nothing left to play — and so the tail is exercised on a
 * note that really is at the end of the song.
 */
export function longestDurationSong(): Song {
  const { meter } = longestMeter();
  const resolution: Resolution = 8;
  const slots = (meter[0] * resolution) / meter[1];
  const last = songLimits.totalBars - 1;

  return songSchema.parse({
    version: 2,
    title: "En Uzun Sure",
    bpm: bpmRange.min,
    key: "E minor",
    tracks: [melodicTrack("gtr", "Gitar", 0)],
    sections: sectionsOf(
      songLimits.totalBars,
      (barIndex) =>
        barIndex === last
          ? {
              gtr: [
                ...Array.from({ length: slots - 1 }, () => null),
                {
                  notes: [
                    {
                      pitch: LOW_E[0].pitch,
                      position: { string: 0, fret: LOW_E[0].fret },
                    },
                  ],
                },
              ],
            }
          : {},
      meter,
      resolution,
    ),
  });
}

/**
 * Every track and every bar, on the finest grid, carrying real onsets.
 *
 * Not the same song as the duration fixture and not meant to be: this one
 * runs at an ordinary tempo, because what it is measuring is how much work
 * the scheduler and the expression planner do per second, and a slow tempo
 * would only spread the same events over more time.
 *
 * The melodic content includes hammer-ons and pull-offs so the expression
 * planner and the legato chains are exercised, and ties so the tie-merging
 * traversal is too — all in pitch/fret pairs the validators accept.
 */
export function heaviestEventSong(): Song {
  const meter = asMeter(TIME_SIGNATURES[0]);
  const resolution = finestGridFor(meter);
  const slots = (meter[0] * resolution) / meter[1];

  const melodicIds = ["g1", "g2", "g3", "g4", "g5"];
  const tracks = [
    ...melodicIds.map((id, index) =>
      melodicTrack(id, `Gitar ${index + 1}`, -6 - index, index * 0.25 - 0.5),
    ),
    melodicTrack("lead", "Solo", -8, 0.4),
    bassTrack("bass", "Bas"),
    drumTrack("drums", "Davul"),
  ];
  if (tracks.length !== songLimits.maxTracks) {
    throw new Error(
      `heaviest fixture must use every track: ${tracks.length} of ${songLimits.maxTracks}`,
    );
  }

  /**
   * A dense but playable line: an onset every other slot walking the four
   * low-string positions, a real legato pair, and a tie.
   *
   * The legato note sits in the slot **immediately after** its source, which
   * is what the articulation-context validator requires and what makes the
   * expression planner build an actual chain rather than fall back to a plain
   * strike. Direction decides the articulation: up is a hammer-on, down is a
   * pull-off, so the pair is always something a hand could really do.
   */
  const step = (index: number) => LOW_E[index % LOW_E.length]!;

  const melodicBar = (offset: number) =>
    Array.from({ length: slots }, (_, slot) => {
      // A tie, so the tie-merging traversal has work to do.
      if (slot % 8 === 7) return "-";

      if (slot % 8 === 5) {
        /*
         * Legato, onto the note struck in the slot just before this one, and
         * always to a neighbouring position: wrapping from the top of the
         * cycle back to the open string would be a seven-fret jump, which the
         * planner rightly refuses as too wide and plays plain instead — a
         * fixture full of refused legato would be measuring the fallback.
         */
        const fromIndex = 4 / 2 + offset;
        const at = fromIndex % LOW_E.length;
        const from = step(fromIndex);
        const to = step(at === LOW_E.length - 1 ? fromIndex - 1 : fromIndex + 1);
        return {
          notes: [
            {
              pitch: to.pitch,
              position: { string: 0, fret: to.fret },
              articulation:
                to.fret > from.fret ? ("hammer_on" as const) : ("pull_off" as const),
            },
          ],
        };
      }

      if (slot % 2 !== 0) return null;
      const here = step(slot / 2 + offset);
      return {
        notes: [
          {
            pitch: here.pitch,
            position: { string: 0, fret: here.fret },
            velocity: 80 + ((slot + offset) % 40),
          },
        ],
      };
    });

  const bassBar = () =>
    Array.from({ length: slots }, (_, slot) =>
      slot % 4 === 0
        ? { notes: [{ pitch: "E1", position: { string: 0, fret: 0 } }] }
        : null,
    );

  const drumBar = () =>
    Array.from({ length: slots }, (_, slot) => {
      const hits: { piece: string }[] = [];
      if (slot % 8 === 0) hits.push({ piece: "kick" });
      if (slot % 8 === 4) hits.push({ piece: "snare" });
      if (slot % 2 === 0) hits.push({ piece: "closed_hat" });
      return hits;
    });

  return songSchema.parse({
    version: 2,
    title: "En Yogun Olay",
    bpm: 138,
    key: "E minor",
    tracks,
    sections: sectionsOf(
      songLimits.totalBars,
      (barIndex) => ({
        ...Object.fromEntries(
          melodicIds.map((id, index) => [id, melodicBar(barIndex + index)]),
        ),
        lead: melodicBar(barIndex + 5),
        bass: bassBar(),
        drums: drumBar(),
      }),
      meter,
      resolution,
    ),
  });
}
