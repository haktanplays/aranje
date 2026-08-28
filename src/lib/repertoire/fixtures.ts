/**
 * Three short original figures that exercise what a real guitar part needs
 * (2T §6).
 *
 * These are not copies of anything. Each was written to carry one cluster of
 * capabilities the previous model could not hold, so that "the score can
 * express this now" is a thing a test can assert rather than a claim.
 *
 * ## What the previous model could not write, and why
 *
 * A track's bar was one array of slots, and a slot was an onset for *every*
 * string at once. Three consequences, and all three are in these fixtures:
 *
 * - **No independent durations.** A tie extended everything that was open, so
 *   two strings could not hold different lengths from the same beat.
 * - **No overlap.** Any onset closed every open note, so a bass string could
 *   not ring under a melody — fixture B is exactly that and was unwritable.
 * - **No partial re-attack.** A chord could not have two of its six strings
 *   struck again while the other four kept ringing, because striking anything
 *   ended everything. Fixture C is that, and was unwritable.
 *
 * Rests, syncopation and mixed note values were writable before, at the cost
 * of choosing the finest grid in the bar; fixture A holds those to make sure
 * making the other two possible did not break them.
 */
import { SONG_VERSION, type MelodicSlot, type Song, type Track } from "@/lib/song/schema";

const GUITAR: Track = {
  id: "gtr",
  name: "Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
};

function song(
  title: string,
  bars: Song["sections"][number]["bars"],
  bpm = 120,
): Song {
  return {
    version: SONG_VERSION,
    title,
    bpm,
    key: "E minor",
    tracks: [GUITAR],
    sections: [{ id: "s1", name: "Ana Riff", status: "fixed", bars }],
  };
}

const empty = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => null);

/* --------------------------------------------------------------- fixture A */

/**
 * **Syncopated palm-muted double stops.**
 *
 * Two open strings struck together, real rests between the figures, the
 * accent landing off the beat, two separate palm-mute spans and a short
 * hammer-on at the end. Written at 1/16 because that is the finest value it
 * contains; every eighth is two slots and every eighth rest is two empty
 * ones, which is how a single-grid bar writes mixed values.
 */
export function fixtureA(): Song {
  const bar1 = empty(16);
  const stop = (fret: number, extra: Record<string, unknown> = {}): MelodicSlot => ({
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 }, articulation: "palm_mute", ...extra },
      { pitch: "A2", position: { string: 1, fret: 0 }, articulation: "palm_mute", ...extra },
    ],
  });
  bar1[0] = stop(0);
  bar1[2] = stop(0);
  /* Off the beat: the accent lands on the second sixteenth of beat two. */
  bar1[5] = stop(0, { velocity: 112 });
  bar1[8] = stop(0);
  bar1[11] = stop(0, { velocity: 112 });

  const bar2 = empty(16);
  bar2[0] = {
    notes: [{ pitch: "G3", position: { string: 2, fret: 5 } }],
  };
  bar2[2] = {
    notes: [{ pitch: "A3", position: { string: 2, fret: 7 }, articulation: "hammer_on" }],
  };
  bar2[8] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 }, articulation: "palm_mute" },
      { pitch: "A2", position: { string: 1, fret: 0 }, articulation: "palm_mute" },
    ],
  };

  return song("A — senkoplu PM double-stop", [
    { timeSignature: [4, 4], resolution: 16, slots: { gtr: bar1 } },
    { timeSignature: [4, 4], resolution: 16, slots: { gtr: bar2 } },
  ], 132);
}

/* --------------------------------------------------------------- fixture B */

/**
 * **Pedal string under fast legato.**
 *
 * An open low E struck once and left ringing for the whole bar while the
 * third string plays a 9–10–9 hammer/pull cell in thirty-seconds, then a
 * string change and a vibrato to finish. Sixteenths and thirty-seconds inside
 * the same beat; the pedal keeps sounding through every one of them.
 *
 * **This bar was unwritable before.** The pedal's duration would have been
 * ended by the first legato onset, because an onset closed every open note.
 */
export function fixtureB(): Song {
  const bar = empty(32);
  /* Struck once, ringing through everything that follows. */
  bar[0] = {
    notes: [
      {
        pitch: "E2",
        position: { string: 0, fret: 0 },
        durationTicks: 768,
        letRing: true,
        velocity: 104,
      },
    ],
  };
  /* The 32nd legato cell: 9 – 10 – 9 on the third string. */
  bar[8] = { notes: [{ pitch: "B3", position: { string: 2, fret: 9 }, durationTicks: 24 }] };
  bar[9] = {
    notes: [
      { pitch: "C4", position: { string: 2, fret: 10 }, articulation: "hammer_on", durationTicks: 24 },
    ],
  };
  bar[10] = {
    notes: [
      { pitch: "B3", position: { string: 2, fret: 9 }, articulation: "pull_off", durationTicks: 24 },
    ],
  };
  /* A sixteenth in the same beat as those thirty-seconds. */
  bar[12] = { notes: [{ pitch: "A3", position: { string: 2, fret: 7 }, durationTicks: 48 }] };
  /* String change, and the phrase ends on a vibrato. */
  bar[20] = {
    notes: [
      {
        pitch: "E4",
        position: { string: 3, fret: 9 },
        articulation: "vibrato",
        durationTicks: 288,
      },
    ],
  };

  return song("B — pedal tel + hızlı legato", [
    { timeSignature: [4, 4], resolution: 32, slots: { gtr: bar } },
  ], 96);
}

/* --------------------------------------------------------------- fixture C */

/** The sixteenth the top two strings are taken again on. */
const C_RESTRIKE_SLOT = 10;

/**
 * **Six-string ringing arpeggio with a partial re-attack.**
 *
 * A six-string voicing rolled out one string at a time, every string left
 * ringing, and then two of the six struck again while the other four keep
 * sounding.
 *
 * **This bar was unwritable before**, twice over: the strings could not hold
 * their own lengths, and re-striking two of them would have ended all six.
 *
 * The four strings nobody comes back to ring to the end of the bar. The two
 * that are taken again are written to end exactly where the second attack
 * begins (2T-B §3.1) — a string is not playing two frets at once, and the
 * score should not claim it is. The arpeggio is still dirty: four voices are
 * overlapping when the re-attack lands, and six are overlapping before it.
 */
export function fixtureC(): Song {
  const bar = empty(16);
  const restrikeTicks = C_RESTRIKE_SLOT * 48;
  const voicing = [
    { pitch: "E2", string: 0, fret: 0 },
    { pitch: "B2", string: 1, fret: 2 },
    { pitch: "E3", string: 2, fret: 2 },
    { pitch: "G3", string: 3, fret: 0 },
    { pitch: "B3", string: 4, fret: 0 },
    { pitch: "E4", string: 5, fret: 0 },
  ];
  const retaken = new Set([4, 5]);

  /* Rolled out, a sixteenth apart, each ringing until its string is needed. */
  voicing.forEach((voice, index) => {
    const startTicks = index * 48;
    const endTicks = retaken.has(voice.string) ? restrikeTicks : 768;
    bar[index] = {
      notes: [
        {
          pitch: voice.pitch,
          position: { string: voice.string, fret: voice.fret },
          durationTicks: endTicks - startTicks,
          letRing: true,
        },
      ],
    };
  });

  /* Two of the six taken again while the other four keep ringing. */
  bar[C_RESTRIKE_SLOT] = {
    notes: [
      {
        pitch: "B3",
        position: { string: 4, fret: 0 },
        durationTicks: 768 - restrikeTicks,
        letRing: true,
      },
      {
        pitch: "E4",
        position: { string: 5, fret: 0 },
        durationTicks: 768 - restrikeTicks,
        letRing: true,
      },
    ],
  };

  return song("C — altı telli çınlayan arpej", [
    { timeSignature: [4, 4], resolution: 16, slots: { gtr: bar } },
  ], 84);
}

export const REPERTOIRE = { fixtureA, fixtureB, fixtureC } as const;
