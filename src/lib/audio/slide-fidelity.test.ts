/**
 * The handoff, the two open slides, and a shape moving as one (2V-C.3 §4, §7,
 * §8, §11).
 *
 * L19 came back "vurarak biraz kusurlu duruyor" — a sentence about the moment
 * the two voices meet, not about the travel, which the same card confirmed
 * arrives on time. `eval/expression-fidelity/HANDOFF.md` is the measurement
 * that found what was actually wrong there; these are the invariants that
 * keep it fixed.
 */
import { describe, expect, it } from "vitest";

import { buildExpressionPlan, type ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import {
  MAX_OVERLAP_SECONDS,
  MIN_OVERLAP_SECONDS,
} from "@/lib/audio/handoff-envelope";
import { openSlideTravelSeconds } from "@/lib/audio/pitch-gesture";
import { expressionPresets } from "@/lib/audio/expression";
import { SLIDE_DISTANCES } from "@/lib/music/slide-distance";
import { centsAt } from "@/lib/audio/pitch-gesture";
import { valueAt } from "@/lib/audio/automation";
import {
  songSchema,
  type MelodicSlot,
  type NoteConnection,
  type NoteEvent,
  type PitchGesture,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const LONG = 1.149089;

const note = (
  string: number,
  fret: number,
  pitch: string,
  extra: Partial<NoteEvent> = {},
): NoteEvent => ({ pitch, position: { string, fret }, ...extra }) as NoteEvent;

function laneSong(lane: MelodicSlot[]): Song {
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
      },
    ],
  } satisfies Song);
}

/** Two notes on one string, joined however the caller says. */
function pair(connection: NoteConnection): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [note(2, 5, "G3")] };
  lane[1] = { notes: [note(2, 7, "A3", { connection })] };
  return laneSong(lane);
}

/** A double stop that moves, both strings the same way. */
function shapePair(connection: NoteConnection): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [note(2, 5, "G3"), note(3, 5, "C4")] };
  lane[1] = {
    notes: [note(2, 7, "A3", { connection }), note(3, 7, "D4", { connection })],
  };
  return laneSong(lane);
}

const planOf = (song: Song) => buildExpressionPlan(song);
const at = (song: Song, ticks: number, string: number) =>
  planOf(song).notes.find(
    (entry) => entry.timeTicks === ticks && entry.position?.stringIndex === string,
  )!;

/** The level a note is at, this far into itself. */
const gainAt = (
  note: ReturnType<typeof at>,
  elapsed: number,
): number =>
  note.gainEnvelope.length === 0
    ? note.gain
    : valueAt(note.gainEnvelope, note.gainEnvelope.map((point) => point.value), elapsed);

describe("118. the two voices of a struck slide hand over rather than collide", () => {
  /** Where the target lands, from the source's own onset. */
  const seamOf = (source: ExpressiveNotePlan, target: ExpressiveNotePlan): number =>
    target.startSeconds - source.startSeconds;

  it("brings the source down before the target is struck", () => {
    const song = pair({ kind: "shift_slide" });
    const source = at(song, 0, 2);
    const target = at(song, 96, 2);
    const seam = seamOf(source, target);
    const handover = gainAt(source, seam);
    /* The defect: both at full level at the same sample, a step in the
       waveform between two full-amplitude events. */
    expect(handover).toBeLessThan(gainAt(target, 0));
    expect(handover / gainAt(target, 0)).toBeLessThan(0.75);
  });

  it("does not fade the source to silence before the target arrives", () => {
    const song = pair({ kind: "shift_slide" });
    const source = at(song, 0, 2);
    const target = at(song, 96, 2);
    expect(gainAt(source, seamOf(source, target))).toBeGreaterThan(0.2 * source.gain);
  });

  it("keeps the source sounding past the onset, and takes it to silence", () => {
    /*
     * 2V-C.4. Ending at the onset is right about the event and wrong about
     * the sound: the source's release runs out a few milliseconds later
     * while the target's recording is still climbing, and the rendered
     * waveform dips into the hole between them. So the tail continues, and
     * it ends at zero rather than at a level, because a voice stopped at a
     * level is a step in the waveform.
     */
    const song = pair({ kind: "shift_slide" });
    const source = at(song, 0, 2);
    const target = at(song, 96, 2);
    const seam = seamOf(source, target);
    expect(source.durationSeconds).toBeGreaterThan(seam);
    expect(source.durationSeconds - seam).toBeGreaterThanOrEqual(MIN_OVERLAP_SECONDS);
    expect(source.durationSeconds - seam).toBeLessThanOrEqual(MAX_OVERLAP_SECONDS);
    expect(source.gainEnvelope.at(-1)!.value).toBe(0);
    expect(source.gainEnvelope.at(-1)!.timeSeconds).toBeCloseTo(source.durationSeconds, 6);
  });

  it("holds the target's pitch through the tail rather than sliding past it", () => {
    /* The overlap is the old string still ringing at the new fret. At any
       other pitch it would be a second note under the target, and two pitches
       a few cents apart is exactly what beats. */
    const song = pair({ kind: "shift_slide" });
    const source = at(song, 0, 2);
    const target = at(song, 96, 2);
    expect(centsAt(source.pitchAutomation, seamOf(source, target))).toBe(200);
    expect(centsAt(source.pitchAutomation, source.durationSeconds)).toBe(200);
  });

  it("holds the source at full level until the hand actually moves", () => {
    const song = pair({ kind: "shift_slide" });
    const source = at(song, 0, 2);
    const hold = source.gainEnvelope.find((point) => point.timeSeconds > 0)!;
    expect(hold.value).toBeCloseTo(source.gain, 6);
    /* And at that moment the pitch has not yet left the written note. */
    expect(centsAt(source.pitchAutomation, hold.timeSeconds)).toBe(0);
  });

  it("leaves the target's own attack alone", () => {
    /* The card is about the strike. Softening it would answer the complaint
       by deleting its subject. */
    const song = pair({ kind: "shift_slide" });
    const target = at(song, 96, 2);
    expect(target.gainEnvelope).toEqual([]);
    expect(target.chainRole).toBeUndefined();
    expect(centsAt(target.pitchAutomation, 0)).toBe(0);
  });

  it("still arrives exactly when the target is struck", () => {
    /*
     * The claim C.3 made here was "no overlap and no gap", checked by the
     * source ending at the target's onset. C.4 measured that in rendered PCM
     * and it was a hole, so the claim is now the one it was standing in for:
     * the *pitch* arrives exactly on time, and the level is well down by
     * then. Zero overlap was never the goal — an uninterrupted sound was.
     */
    const song = pair({ kind: "shift_slide" });
    const source = at(song, 0, 2);
    const target = at(song, 96, 2);
    const seam = target.startSeconds - source.startSeconds;
    const arrival = source.pitchAutomation.find((point) => point.cents === 200)!;
    expect(arrival.timeSeconds).toBeCloseTo(seam, 6);
    expect(gainAt(source, seam)).toBeLessThan(0.75 * source.gain);
    /* And the overlap stays short: a tail, not a second voice. */
    expect(source.startSeconds + source.durationSeconds - target.startSeconds)
      .toBeLessThanOrEqual(MAX_OVERLAP_SECONDS);
  });

  it("gives a legato slide no handoff fade and no target attack", () => {
    /* Its chain owns the string; a fix aimed at the struck slide must not
       reach into it. */
    const song = pair({ kind: "legato_slide" });
    const source = at(song, 0, 2);
    const target = at(song, 96, 2);
    expect(source.chainRole).toBe("source");
    expect(target.chainRole).toBe("target");
    expect(source.gainEnvelope).toEqual([]);
  });
});

describe("119. an open slide's three distances are one movement going further", () => {
  it("travels at the same rate whatever the distance", () => {
    const rates = SLIDE_DISTANCES.map((entry) => {
      const gesture: PitchGesture = {
        kind: "slide_in",
        from: "below",
        approxSemitones: entry.semitones,
      };
      return (entry.semitones * 100) / openSlideTravelSeconds(gesture, LONG);
    });
    /* The defect: "Kısa" and "Belirgin" both took the note-to-note floor of
       120 ms for 100 and 200 cents, so the longer one moved twice as fast. */
    for (const rate of rates) expect(rate).toBeCloseTo(rates[0]!, 0);
  });

  it("takes longer for a longer distance, in order", () => {
    const times = SLIDE_DISTANCES.map((entry) =>
      openSlideTravelSeconds(
        { kind: "slide_in", from: "below", approxSemitones: entry.semitones },
        LONG,
      ),
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(3);
  });

  it("never turns into a whammy dive, even at the longest", () => {
    const longest = SLIDE_DISTANCES.at(-1)!;
    const travel = openSlideTravelSeconds(
      { kind: "slide_in", from: "below", approxSemitones: longest.semitones },
      LONG,
    );
    /* A pitch-wheel sweep is what happens above roughly two thousand cents a
       second; a hand does not move that fast on a fretboard. */
    expect((longest.semitones * 100) / travel).toBeLessThan(2000);
  });

  it("still lets a short note shorten the travel rather than overrun", () => {
    const short = 0.3;
    const travel = openSlideTravelSeconds(
      { kind: "slide_in", from: "below", approxSemitones: 4 },
      short,
    );
    expect(travel).toBeLessThan(short * 0.45);
  });

  it("keeps the target pitch for the audible majority of a slide-in", () => {
    for (const entry of SLIDE_DISTANCES) {
      const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
      lane[0] = {
        notes: [
          note(2, 5, "G3", {
            pitchGesture: {
              kind: "slide_in",
              from: "below",
              approxSemitones: entry.semitones,
            },
          }),
        ],
      };
      const first = at(laneSong(lane), 0, 2);
      const arrival = first.pitchAutomation.find((point) => point.cents === 0)!;
      expect(arrival.timeSeconds).toBeLessThan(first.durationSeconds * 0.45);
      expect(centsAt(first.pitchAutomation, first.durationSeconds)).toBe(0);
    }
  });

  it("keeps a slide-out's exit late and its fade with it", () => {
    for (const entry of SLIDE_DISTANCES) {
      const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
      lane[0] = {
        notes: [
          note(2, 5, "G3", {
            pitchGesture: {
              kind: "slide_out",
              to: "down",
              approxSemitones: entry.semitones,
            },
          }),
        ],
      };
      const first = at(laneSong(lane), 0, 2);
      const leaves = first.pitchAutomation.find((point) => point.cents !== 0)!;
      expect(leaves.timeSeconds).toBeGreaterThan(first.durationSeconds * 0.5);
      /* And the level is going with it: the exit is the sound leaving. */
      expect(gainAt(first, first.durationSeconds)).toBeLessThan(first.gain);
    }
  });

  it("gives a slide-in no fade, because it lands into a note that goes on", () => {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = {
      notes: [
        note(2, 5, "G3", {
          pitchGesture: { kind: "slide_in", from: "below", approxSemitones: 2 },
        }),
      ],
    };
    expect(at(laneSong(lane), 0, 2).gainEnvelope).toEqual([]);
  });
});

describe("120. a shape moves as one hand", () => {
  it("strikes no target at all when the shape is legato", () => {
    const plan = planOf(shapePair({ kind: "legato_slide" }));
    const targets = plan.notes.filter((entry) => entry.timeTicks === 96);
    expect(targets).toHaveLength(2);
    for (const target of targets) expect(target.chainRole).toBe("target");
  });

  it("strikes exactly one attack per voice when the shape is struck", () => {
    const plan = planOf(shapePair({ kind: "shift_slide" }));
    const targets = plan.notes.filter((entry) => entry.timeTicks === 96);
    expect(targets).toHaveLength(2);
    /* An ordinary onset each: two voices, two picks, no chain swallowing one
       and no third voice appearing from anywhere. */
    for (const target of targets) expect(target.chainRole).toBeUndefined();
    expect(plan.notes.filter((entry) => entry.chainRole === undefined)).toHaveLength(4);
  });

  it("arrives on every string at the same instant", () => {
    const song = shapePair({ kind: "shift_slide" });
    const arrivals = [2, 3].map((string) => {
      const source = at(song, 0, string);
      /* The first point at the interval, not the last point written: since
         2V-C.4 the automation holds that pitch through the tail, so the last
         point is where the tail ends rather than where the hand landed. */
      const climb = Math.max(...source.pitchAutomation.map((point) => point.cents));
      return (
        source.startSeconds +
        source.pitchAutomation.find((point) => point.cents === climb)!.timeSeconds
      );
    });
    expect(arrivals[0]).toBeCloseTo(arrivals[1]!, 9);
  });

  it("leaves every string at the same instant, so there is no flam", () => {
    const song = shapePair({ kind: "shift_slide" });
    const departures = [2, 3].map(
      (string) => at(song, 0, string).pitchAutomation.find((point) => point.cents !== 0)!
        .timeSeconds,
    );
    expect(departures[0]).toBeCloseTo(departures[1]!, 9);
  });

  it("hands every string over with the same policy", () => {
    /*
     * The strings play different recordings with different attacks, so the
     * shape shares one answer: the group takes the longest attack among its
     * voices and every string is handed over on that schedule. Otherwise a
     * chord would be released one string at a time.
     */
    const song = shapePair({ kind: "shift_slide" });
    const sources = [2, 3].map((string) => at(song, 0, string));
    const target = at(song, 96, 2);
    const ratios = sources.map(
      (source) => gainAt(source, target.startSeconds - source.startSeconds) / source.gain,
    );
    expect(ratios[0]).toBeCloseTo(ratios[1]!, 9);
    /* And the shared level stays inside the policy's own two bounds, rather
       than being whatever one recording happened to ask for. */
    const preset = expressionPresets.slide;
    expect(ratios[0]).toBeGreaterThanOrEqual(preset.handoverGainFraction - 1e-6);
    expect(ratios[0]).toBeLessThanOrEqual(preset.handoverSlowFraction + 1e-6);
  });

  it("does not cut one voice before the others", () => {
    const song = shapePair({ kind: "shift_slide" });
    const ends = [2, 3].map((string) => {
      const source = at(song, 0, string);
      return source.startSeconds + source.durationSeconds;
    });
    expect(ends[0]).toBeCloseTo(ends[1]!, 9);
  });

  it("adds no imaginary note to the song for either shape", () => {
    for (const kind of ["legato_slide", "shift_slide"] as const) {
      const plan = planOf(shapePair({ kind }));
      expect(plan.notes.filter((entry) => entry.trackId === TRACK)).toHaveLength(4);
    }
  });
});
