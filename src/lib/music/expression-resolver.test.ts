/**
 * One reading of a note, and what it protects (2V-C.1 §2, §3, §4).
 *
 * Two things are checked here and they pull in opposite directions, which is
 * the point. The new fields have to be able to say things the old enum could
 * not — bend up and stay there, slide and strike the target — and a song that
 * carries none of them has to come back byte-identical and sound exactly as
 * it did, because a reader who opens an old file on the day a field was added
 * did not ask for their music to change.
 */
import { describe, expect, it } from "vitest";

import {
  CONFLICT_MESSAGE,
  endingCents,
  movesPitchAway,
  resolveExpression,
  restrikesTarget,
  transitionOf,
} from "@/lib/music/expression-resolver";
import {
  articulationSchema,
  noteConnectionSchema,
  noteEventSchema,
  pitchGestureSchema,
  songSchema,
  type MelodicSlot,
  type Song,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";

describe("78. the note is read once, on three axes", () => {
  it("lets an accent and a bend live on one note", () => {
    /* The whole reason the fields exist: the old enum held one value, so an
       accented bend was two things a note could not both be. */
    const read = resolveExpression({
      articulation: "accent",
      pitchGesture: { kind: "bend", targetCents: 200 },
    });
    expect(read.conflict).toBeNull();
    expect(read.attack).toBe("accent");
    expect(read.pitch).toEqual({
      source: "gesture",
      gesture: { kind: "bend", targetCents: 200 },
    });
  });

  it("does not report a connection as if it were an attack", () => {
    /* `slide` is not a way of striking a string, so it answers exactly one
       question and is not repeated on the attack axis. */
    const read = resolveExpression({ articulation: "slide" });
    expect(read.attack).toBeUndefined();
    expect(read.connection).toEqual({ source: "legacy", articulation: "slide" });
    expect(read.pitch).toBeNull();
  });

  it("reads a plain note as nothing at all", () => {
    expect(resolveExpression({})).toEqual({
      attack: undefined,
      pitch: null,
      connection: null,
      conflict: null,
    });
  });

  it("refuses two answers on one axis instead of picking a winner", () => {
    const pitch = resolveExpression({
      articulation: "bend_full",
      pitchGesture: { kind: "prebend", targetCents: 100 },
    });
    expect(pitch.conflict).toBe("pitch_axis_conflict");
    expect(pitch.pitch).toBeNull();

    const joined = resolveExpression({
      articulation: "hammer_on",
      connection: { kind: "shift_slide" },
    });
    expect(joined.conflict).toBe("connection_axis_conflict");
    expect(joined.connection).toBeNull();
  });

  it("says why, in words a musician can act on", () => {
    for (const message of Object.values(CONFLICT_MESSAGE)) {
      expect(message).toMatch(/\S/u);
      expect(message).not.toMatch(/pitchGesture|articulation|enum|null|undefined/u);
    }
  });

  it("keeps a vibrato on the pitch axis, not the attack one", () => {
    const read = resolveExpression({ articulation: "vibrato" });
    expect(read.pitch).toEqual({ source: "legacy", articulation: "vibrato" });
    expect(read.attack).toBeUndefined();
  });
});

describe("79. the two slides differ in one thing, and it is the attack", () => {
  it("travels the same way for both", () => {
    const legato = resolveExpression({ connection: { kind: "legato_slide" } });
    const shift = resolveExpression({ connection: { kind: "shift_slide" } });
    expect(transitionOf(legato.connection)).toBe("slide");
    expect(transitionOf(shift.connection)).toBe("slide");
  });

  it("strikes the target for a shift slide and never for a legato one", () => {
    expect(
      restrikesTarget(resolveExpression({ connection: { kind: "shift_slide" } }).connection),
    ).toBe(true);
    expect(
      restrikesTarget(
        resolveExpression({ connection: { kind: "legato_slide" } }).connection,
      ),
    ).toBe(false);
  });

  it("leaves the legacy slide unstruck, which is what it has always been", () => {
    /* 2P-A measured today's `slide`: no attack at the target. So a song full
       of them cannot start restriking on the day shift slides became
       expressible. */
    expect(restrikesTarget(resolveExpression({ articulation: "slide" }).connection)).toBe(
      false,
    );
  });

  it("maps hammer-on and pull-off to themselves, from either source", () => {
    expect(
      transitionOf(resolveExpression({ articulation: "hammer_on" }).connection),
    ).toBe("hammer_on");
    expect(
      transitionOf(resolveExpression({ connection: { kind: "pull_off" } }).connection),
    ).toBe("pull_off");
  });
});

describe("80. where a bend ends is a fact about the bend", () => {
  it("ends bent when it was told to stay there", () => {
    expect(endingCents(resolveExpression({
      pitchGesture: { kind: "bend", targetCents: 200 },
    }).pitch)).toBe(200);
    expect(endingCents(resolveExpression({
      pitchGesture: { kind: "prebend", targetCents: 100 },
    }).pitch)).toBe(100);
  });

  it("ends where it started when it was told to come back", () => {
    expect(endingCents(resolveExpression({
      pitchGesture: { kind: "bend_release", targetCents: 200 },
    }).pitch)).toBe(0);
    expect(endingCents(resolveExpression({
      pitchGesture: { kind: "prebend_release", targetCents: 200 },
    }).pitch)).toBe(0);
  });

  it("ends where it started for a legacy bend, which always released", () => {
    expect(endingCents(resolveExpression({ articulation: "bend_full" }).pitch)).toBe(0);
  });

  it("knows which gestures leave the written fret", () => {
    expect(movesPitchAway(resolveExpression({ articulation: "vibrato" }).pitch)).toBe(false);
    expect(
      movesPitchAway(
        resolveExpression({ pitchGesture: { kind: "slide_out", to: "down" } }).pitch,
      ),
    ).toBe(false);
    expect(
      movesPitchAway(resolveExpression({ pitchGesture: { kind: "bend", targetCents: 100 } }).pitch),
    ).toBe(true);
  });
});

describe("81. the contract is additive, and an old song stays an old song", () => {
  const legacy = (): Song => {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
    lane[0] = {
      notes: [{ pitch: "A2", position: { string: 1, fret: 0 }, articulation: "bend_full" }],
    };
    lane[2] = {
      notes: [{ pitch: "B2", position: { string: 1, fret: 2 }, articulation: "slide" }],
    };
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
  };

  it("opens a song with neither field and adds neither", () => {
    const before = legacy();
    const reopened = songSchema.parse(JSON.parse(JSON.stringify(before)));
    expect(JSON.stringify(reopened)).toBe(JSON.stringify(before));
    const note = (reopened.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[])[0];
    const keys = note && note !== "-" ? Object.keys(note.notes[0]!).sort() : [];
    expect(keys).toEqual(["articulation", "pitch", "position"]);
    expect(keys).not.toContain("pitchGesture");
    expect(keys).not.toContain("connection");
  });

  it("carries both fields through a file round-trip when they are written", () => {
    const written = noteEventSchema.parse({
      pitch: "E3",
      position: { string: 2, fret: 9 },
      pitchGesture: {
        kind: "bend",
        targetCents: 200,
        vibrato: { startAfterTarget: true, depthCents: 18, rateHz: 5.5 },
      },
      connection: { kind: "shift_slide" },
    });
    expect(noteEventSchema.parse(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it("bounds the bend rather than enumerating it", () => {
    /* A number, so the next interval a guitarist asks for costs a bound and
       not a schema migration — but bounded, so a file cannot claim 90000. */
    for (const cents of [25, 50, 100, 200, 400]) {
      expect(pitchGestureSchema.safeParse({ kind: "bend", targetCents: cents }).success).toBe(
        true,
      );
    }
    for (const cents of [0, -100, 24, 401, 1.5]) {
      expect(pitchGestureSchema.safeParse({ kind: "bend", targetCents: cents }).success).toBe(
        false,
      );
    }
  });

  it("takes exactly the four connections and no free text", () => {
    for (const kind of ["hammer_on", "pull_off", "legato_slide", "shift_slide"]) {
      expect(noteConnectionSchema.safeParse({ kind }).success).toBe(true);
    }
    for (const kind of ["slide", "bend", "", "SHIFT_SLIDE"]) {
      expect(noteConnectionSchema.safeParse({ kind }).success).toBe(false);
    }
  });

  it("did not widen the old articulation enum to cover the new words", () => {
    /* The two axes stay separate. If `shift_slide` had been added to the
       enum instead, every reader of `articulation` would have silently
       gained a value it does not understand. */
    for (const word of ["shift_slide", "legato_slide", "prebend", "bend_release"]) {
      expect(articulationSchema.safeParse(word).success).toBe(false);
    }
  });
});
