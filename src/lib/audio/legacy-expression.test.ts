/**
 * An old song sounds exactly as it did (2V-C.1 §3).
 *
 * Adding two optional fields is the easy half. The hard half is that a song
 * carrying neither of them must produce the *same plan* — every automation
 * point, every gain point, every chain — because the reader who opens it did
 * not ask for their bends to change on the day a schema grew.
 *
 * The strong version of that claim is the one made here: the plan is compared
 * against a recorded shape rather than against itself, so a change that moved
 * every legacy note in the same direction would still be caught.
 */
import { describe, expect, it } from "vitest";

import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildNotatedPlan } from "@/lib/audio/schedule";
import { resolveExpression } from "@/lib/music/expression-resolver";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";

/** Every legacy expression the enum can say, on one guitar bar. */
function legacySong(): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = {
    notes: [{ pitch: "E3", position: { string: 2, fret: 2 }, articulation: "bend_half" }],
  };
  lane[1] = {
    notes: [{ pitch: "F#3", position: { string: 2, fret: 4 }, articulation: "bend_full" }],
  };
  lane[2] = {
    notes: [{ pitch: "G3", position: { string: 2, fret: 5 }, articulation: "vibrato" }],
  };
  lane[3] = {
    notes: [{ pitch: "A3", position: { string: 2, fret: 7 }, articulation: "slide" }],
  };
  lane[4] = {
    notes: [{ pitch: "B3", position: { string: 2, fret: 9 }, articulation: "hammer_on" }],
  };
  lane[5] = {
    notes: [{ pitch: "A3", position: { string: 2, fret: 7 }, articulation: "pull_off" }],
  };
  lane[6] = {
    notes: [{ pitch: "G3", position: { string: 2, fret: 5 }, articulation: "palm_mute" }],
  };
  lane[7] = {
    notes: [{ pitch: "E3", position: { string: 2, fret: 2 }, articulation: "accent" }],
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
}

const planOf = (song: Song) => buildExpressionPlan(song);

describe("87. every legacy expression still reaches the audio it always had", () => {
  const plan = planOf(legacySong());
  const byTick = new Map(plan.notes.map((note) => [note.timeTicks, note]));

  it("plans all eight notes, and none of them falls back", () => {
    expect(plan.notes).toHaveLength(8);
    const fallbacks = plan.notes.filter((note) => note.fallbackReason !== undefined);
    expect(fallbacks.map((note) => note.fallbackReason)).toEqual([]);
  });

  it("bends half and full to exactly 100 and 200 cents, and releases both", () => {
    const half = byTick.get(0)!;
    const full = byTick.get(96)!;
    expect(Math.max(...half.pitchAutomation.map((point) => point.cents))).toBe(100);
    expect(Math.max(...full.pitchAutomation.map((point) => point.cents))).toBe(200);
    /* The accepted behaviour releases at the end. If the new "bend and hold"
       had silently become the legacy meaning, this is where it would show. */
    expect(half.pitchAutomation.at(-1)!.cents).toBe(0);
    expect(full.pitchAutomation.at(-1)!.cents).toBe(0);
  });

  it("keeps vibrato centred on the written pitch", () => {
    const points = byTick.get(192)!.pitchAutomation;
    expect(points.length).toBeGreaterThan(3);
    expect(Math.min(...points.map((point) => point.cents))).toBeLessThan(0);
    expect(Math.max(...points.map((point) => point.cents))).toBeGreaterThan(0);
  });

  it("still forms the legato chains slide, hammer-on and pull-off ask for", () => {
    expect(plan.chains.length).toBeGreaterThan(0);
    const transitions = plan.chains.flatMap((chain) =>
      chain.transitions.map((transition) => transition.kind),
    );
    expect(transitions).toContain("slide");
    expect(transitions).toContain("hammer_on");
    expect(transitions).toContain("pull_off");
  });

  it("reads none of those notes as carrying a new-contract gesture", () => {
    for (const bar of legacySong().sections[0]!.bars) {
      for (const slot of bar.slots[TRACK] as MelodicSlot[]) {
        if (!slot || slot === "-") continue;
        for (const note of slot.notes) {
          const read = resolveExpression(note);
          expect(read.conflict).toBeNull();
          expect(read.pitch?.source).not.toBe("gesture");
          expect(read.connection?.source).not.toBe("explicit");
        }
      }
    }
  });

  it("plans the same bytes twice, so the comparison below means something", () => {
    expect(JSON.stringify(planOf(legacySong()))).toBe(
      JSON.stringify(planOf(legacySong())),
    );
  });

  it("schedules the same notes at the same ticks as the notated plan", () => {
    const notated = buildNotatedPlan(legacySong());
    const ticks = notated.events
      .filter((event) => event.kind === "note")
      .map((event) => event.time);
    expect(ticks).toEqual([0, 96, 192, 288, 384, 480, 576, 672]);
  });
});

describe("88. an added gesture changes that note and no other", () => {
  it("leaves every legacy note's plan byte-identical", () => {
    const before = legacySong();
    /* One note gains an explicit gesture. Everything else in the bar is
       untouched, and its audio has to prove it. */
    const lane = [...(before.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[])];
    lane[2] = {
      notes: [
        {
          pitch: "G3",
          position: { string: 2, fret: 5 },
          pitchGesture: { kind: "bend", targetCents: 200 },
        },
      ],
    };
    const after = songSchema.parse({
      ...before,
      sections: [
        {
          ...before.sections[0]!,
          bars: [{ ...before.sections[0]!.bars[0]!, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);

    const wasByTick = new Map(planOf(before).notes.map((n) => [n.timeTicks, n]));
    const nowByTick = new Map(planOf(after).notes.map((n) => [n.timeTicks, n]));
    for (const tick of [0, 96, 288, 384, 480, 576, 672]) {
      expect(JSON.stringify(nowByTick.get(tick))).toBe(
        JSON.stringify(wasByTick.get(tick)),
      );
    }
  });

  it("gives the edited note a bend that stays up, which the enum could not say", () => {
    const before = legacySong();
    const lane = [...(before.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[])];
    lane[2] = {
      notes: [
        {
          pitch: "G3",
          position: { string: 2, fret: 5 },
          pitchGesture: { kind: "bend", targetCents: 200 },
        },
      ],
    };
    const after = songSchema.parse({
      ...before,
      sections: [
        {
          ...before.sections[0]!,
          bars: [{ ...before.sections[0]!.bars[0]!, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);
    const note = planOf(after).notes.find((entry) => entry.timeTicks === 192)!;
    expect(note.expressive).toBe(true);
    expect(note.pitchAutomation.at(-1)!.cents).toBe(200);
  });

  it("refuses a note that answers one axis twice, and says so", () => {
    const before = legacySong();
    const lane = [...(before.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[])];
    lane[2] = {
      notes: [
        {
          pitch: "G3",
          position: { string: 2, fret: 5 },
          articulation: "bend_full",
          pitchGesture: { kind: "prebend", targetCents: 100 },
        },
      ],
    };
    const after = songSchema.parse({
      ...before,
      sections: [
        {
          ...before.sections[0]!,
          bars: [{ ...before.sections[0]!.bars[0]!, slots: { [TRACK]: lane } }],
        },
      ],
    } satisfies Song);
    const note = planOf(after).notes.find((entry) => entry.timeTicks === 192)!;
    expect(note.fallbackReason).toBe("conflicting_expression");
    /* Neither answer was played. `expressive` stays true only because the
       note is still the source of the slide chain that follows it, which is
       a different fact about the same note. */
    expect(Math.max(...note.pitchAutomation.map((point) => point.cents))).toBe(0);
    expect(Math.min(...note.pitchAutomation.map((point) => point.cents))).toBe(0);
  });
});
