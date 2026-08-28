import { describe, expect, it } from "vitest";

import { soundingSpans, writtenSpans, barOffsets } from "@/lib/song/sounding";
import { songSchema, type Bar, type MelodicSlot } from "@/lib/song/schema";
import { ticksPerSlot } from "@/lib/music/timing";

const TRACK = "t1";

const note = (pitch: string, over: Record<string, unknown> = {}) => ({ pitch, ...over });

const bar = (slots: MelodicSlot[], resolution: 4 | 8 | 16 | 32 = 16): Bar => ({
  timeSignature: [4, 4],
  resolution,
  slots: { [TRACK]: slots },
});

/** 16 slots of rest, with the given ones filled in. */
const line = (
  filled: Record<number, MelodicSlot>,
  resolution: 4 | 8 | 16 | 32 = 16,
): Bar => {
  const count = { 4: 4, 8: 8, 16: 16, 32: 32 }[resolution];
  const slots: MelodicSlot[] = Array.from({ length: count }, () => null);
  for (const [index, slot] of Object.entries(filled)) slots[Number(index)] = slot;
  return bar(slots, resolution);
};

describe("writtenSpans — what the score says", () => {
  it("gives a lone sixteenth the length of its slot", () => {
    const spans = writtenSpans([line({ 0: { notes: [note("E2")] } })], TRACK);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ startTicks: 0, writtenTicks: 48, explicit: false });
  });

  /*
   * The old rule, kept exactly. A song with no durations has to read the same
   * as it always did, or the migration is not silent — it is a rewrite.
   */
  it("reads a tie run the way it always did", () => {
    const spans = writtenSpans(
      [line({ 0: { notes: [note("E2")] }, 1: "-", 2: "-" })],
      TRACK,
    );
    expect(spans[0]!.writtenTicks).toBe(48 * 3);
    expect(spans[0]!.explicit).toBe(false);
  });

  it("ties across a bar line, adding the slots each bar actually has", () => {
    const first = line({ 15: { notes: [note("E2")] } });
    const second = line({ 0: "-", 1: "-" }, 32);
    const spans = writtenSpans([first, second], TRACK);
    /* one sixteenth, then two thirty-seconds */
    expect(spans[0]!.writtenTicks).toBe(48 + 24 + 24);
  });

  it("lets a note state its own length instead", () => {
    const spans = writtenSpans(
      [line({ 0: { notes: [note("E2", { durationTicks: 288 })] } })],
      TRACK,
    );
    expect(spans[0]).toMatchObject({ writtenTicks: 288, explicit: true });
  });

  /*
   * The founder's §2.7 and §3.3 in one assertion: a note written long stays
   * long even though another note starts underneath it. Nothing on another
   * string may shorten what the score says.
   */
  it("does not shorten a written length because something else starts", () => {
    const spans = writtenSpans(
      [
        line({
          0: { notes: [note("E2", { durationTicks: 768 })] },
          4: { notes: [note("B3")] },
          8: { notes: [note("D4")] },
        }),
      ],
      TRACK,
    );
    expect(spans[0]!.writtenTicks).toBe(768);
    expect(spans[1]!.startTicks).toBe(48 * 4);
    expect(spans[2]!.startTicks).toBe(48 * 8);
  });

  it("carries every note of a chord stack from one onset", () => {
    const spans = writtenSpans(
      [line({ 0: { notes: [note("E2"), note("B2"), note("E3")] } })],
      TRACK,
    );
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.startTicks)).toEqual([0, 0, 0]);
    expect(spans.map((s) => s.noteIndex)).toEqual([0, 1, 2]);
  });

  it("skips a track the bar does not carry", () => {
    expect(writtenSpans([line({ 0: { notes: [note("E2")] } })], "other")).toEqual([]);
  });

  it("places bars end to end, whatever grid each is on", () => {
    expect(barOffsets([line({}, 16), line({}, 32), line({}, 8)])).toEqual([0, 768, 1536]);
  });
});

describe("soundingSpans — what is heard", () => {
  const onString = (index: number) => () => index;

  it("leaves a note alone when its string is never struck again", () => {
    const written = writtenSpans([line({ 0: { notes: [note("E2")] } })], TRACK);
    const heard = soundingSpans(written, onString(0));
    expect(heard[0]).toMatchObject({ soundingTicks: 48, cutByRestrike: false });
  });

  /*
   * One string, one note. This is the guitar, not a policy — and it is the
   * *only* thing in this module that shortens anything.
   */
  it("ends a note when the same string is struck again", () => {
    const written = writtenSpans(
      [
        line({
          0: { notes: [note("E2", { durationTicks: 768 })] },
          4: { notes: [note("G2")] },
        }),
      ],
      TRACK,
    );
    const heard = soundingSpans(written, onString(0));
    expect(heard[0]).toMatchObject({ soundingTicks: 192, cutByRestrike: true });
    expect(heard[0]!.writtenTicks).toBe(768);
  });

  /*
   * The dirty arpeggio. Six strings, six independent lives: a note on string
   * 5 is untouched by anything happening on string 0, which is exactly what
   * the previous model could not express.
   */
  it("lets different strings ring over each other", () => {
    const written = writtenSpans(
      [
        line({
          0: { notes: [note("E2", { durationTicks: 768 })] },
          4: { notes: [note("B3", { durationTicks: 576 })] },
          8: { notes: [note("E4", { durationTicks: 384 })] },
        }),
      ],
      TRACK,
    );
    const heard = soundingSpans(written, (span) => span.slotIndex / 4);
    expect(heard.map((s) => s.soundingTicks)).toEqual([768, 576, 384]);
    expect(heard.every((s) => !s.cutByRestrike)).toBe(true);
  });

  it("honours a note that asked to ring on through its own string", () => {
    const written = writtenSpans(
      [
        line({
          0: { notes: [note("E2", { durationTicks: 768, letRing: true })] },
          4: { notes: [note("G2")] },
        }),
      ],
      TRACK,
    );
    const heard = soundingSpans(written, onString(0));
    expect(heard[0]).toMatchObject({ soundingTicks: 768, cutByRestrike: false });
  });

  it("never lengthens a note past what the score wrote", () => {
    const written = writtenSpans(
      [line({ 0: { notes: [note("E2")] }, 8: { notes: [note("G2")] } })],
      TRACK,
    );
    const heard = soundingSpans(written, onString(0));
    expect(heard[0]!.soundingTicks).toBe(48);
  });

  it("leaves a note nothing could place out of the competition entirely", () => {
    const written = writtenSpans(
      [
        line({
          0: { notes: [note("E2", { durationTicks: 768 })] },
          4: { notes: [note("G2")] },
        }),
      ],
      TRACK,
    );
    const heard = soundingSpans(written, () => null);
    expect(heard.map((s) => s.soundingTicks)).toEqual([768, 48]);
    expect(heard.every((s) => s.stringIndex === null)).toBe(true);
  });

  it("keeps the score event even when the sound was cut short", () => {
    const written = writtenSpans(
      [
        line({
          0: { notes: [note("E2", { durationTicks: 768 })] },
          2: { notes: [note("G2")] },
        }),
      ],
      TRACK,
    );
    const heard = soundingSpans(written, onString(0));
    expect(heard).toHaveLength(2);
    expect(heard[1]!.note.pitch).toBe("G2");
  });
});

describe("the contract itself", () => {
  it("accepts a note carrying its own duration and a let-ring flag", () => {
    const song = {
      version: 3,
      title: "t",
      bpm: 120,
      key: "E minor",
      tracks: [
        {
          id: TRACK,
          name: "Gitar",
          instrumentId: "electric_guitar",
          presetId: "high_gain",
          volumeDb: -6,
        },
      ],
      sections: [
        {
          id: "s1",
          name: "A",
          status: "fixed" as const,
          bars: [
            line({
              0: { notes: [{ pitch: "E2", durationTicks: 768, letRing: true }] },
            }),
          ],
        },
      ],
    };
    expect(songSchema.safeParse(song).success).toBe(true);
  });

  it("still accepts a version 2 song, unchanged", () => {
    const song = {
      version: 2,
      title: "t",
      bpm: 120,
      key: "E minor",
      tracks: [
        {
          id: TRACK,
          name: "Gitar",
          instrumentId: "electric_guitar",
          presetId: "high_gain",
          volumeDb: -6,
        },
      ],
      sections: [
        {
          id: "s1",
          name: "A",
          status: "fixed" as const,
          bars: [line({ 0: { notes: [{ pitch: "E2" }] } })],
        },
      ],
    };
    expect(songSchema.safeParse(song).success).toBe(true);
  });

  it("refuses a duration that is not a whole number of ticks", () => {
    const slot = { notes: [{ pitch: "E2", durationTicks: 48.5 }] };
    expect(songSchema.shape.sections.safeParse([
      { id: "s1", name: "A", status: "fixed", bars: [line({ 0: slot as never })] },
    ]).success).toBe(false);
  });

  it("keeps a slot length exact for every grid", () => {
    for (const resolution of [4, 8, 12, 16, 24, 32]) {
      expect(Number.isInteger(ticksPerSlot(resolution))).toBe(true);
    }
  });
});
