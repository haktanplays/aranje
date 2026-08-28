/**
 * The matrix walked end to end (2T-C §9).
 *
 * "Bir özellik yalnız glyph çiziyorsa desteklenmiş sayılmaz." So this file
 * refuses to take the table's word for anything. Every row claiming `playback`
 * is planned here beside a plain note and has to come out measurably
 * different — a different length, a different level, a different attack, a
 * different pitch, or a voice of its own. A row that quietly stops changing
 * the sound fails here rather than on a listener.
 */
import { describe, expect, it } from "vitest";

import { expressionPresets } from "@/lib/audio/expression";
import {
  buildExpressionPlan,
  type ExpressiveNotePlan,
} from "@/lib/audio/expression-plan";
import {
  FAMILY_LABELS,
  TECHNIQUE_MATRIX,
  familyRows,
  matrixArticulations,
  type TechniqueRow,
} from "@/lib/song/technique-matrix";
import { applyEdit } from "@/lib/song/edit";
import {
  articulationSchema,
  songSchema,
  type Articulation,
  type Song,
} from "@/lib/song/schema";
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";
import { articulationLabel } from "@/lib/validators";
import { soundingSpans, writtenSpans } from "@/lib/song/sounding";
import { bar, note, slots, song, TIE } from "@/test/expression-fixtures";

const TRACK = "gtr";

/** String 1 at three frets, so a legato pair has somewhere to come from. */
const G3 = (articulation?: Articulation) => note("G3", 1, 10, articulation);
const A3 = (articulation?: Articulation) => note("A3", 1, 12, articulation);
const B3 = (articulation?: Articulation) => note("B3", 1, 14, articulation);

/**
 * A bar written so that this articulation has everything it asks for, and the
 * slot its note lands on. A hammer-on with nothing before it is a fallback,
 * not a hammer-on, and comparing a fallback with a plain note would prove the
 * opposite of what this file is for.
 */
function fixtureFor(
  id: Articulation,
  articulation: Articulation | undefined,
): { song: Song; slotIndex: number } {
  if (id === "hammer_on") {
    return { song: song([bar(slots([G3(), A3(articulation)]))]), slotIndex: 1 };
  }
  if (id === "pull_off") {
    return { song: song([bar(slots([A3(), G3(articulation)]))]), slotIndex: 1 };
  }
  if (id === "slide") {
    /* The hand needs room to travel, so the source is held under a tie run. */
    return {
      song: song([bar(slots([A3(), TIE, TIE, TIE, B3(articulation)]))]),
      slotIndex: 4,
    };
  }
  return { song: song([bar(slots([A3(articulation)]))]), slotIndex: 0 };
}

function planAt(target: Song, slotIndex: number): ExpressiveNotePlan {
  const found = buildExpressionPlan(target).notes.find(
    (plan) => plan.slotIndex === slotIndex && plan.barKey === "s1:0",
  );
  if (!found) throw new Error(`no plan at slot ${slotIndex}`);
  return found;
}

/** Everything about a plan that a listener could hear. */
function heard(plan: ExpressiveNotePlan): string {
  return JSON.stringify({
    durationTicks: plan.durationTicks,
    durationSeconds: plan.durationSeconds,
    gain: plan.gain,
    gainEnvelope: plan.gainEnvelope,
    pitchAutomation: plan.pitchAutomation,
    filterPreset: plan.filterPreset ?? null,
    expressive: plan.expressive,
    /* A chain member is played by its chain, which is a different sound. */
    chained: plan.chainId !== undefined,
    chainRole: plan.chainRole ?? null,
    strumOffsetSeconds: plan.strumOffsetSeconds ?? null,
  });
}

const articulationRows = TECHNIQUE_MATRIX.filter(
  (row) => row.field === "articulation",
);

describe("the matrix and the contract say the same thing", () => {
  it("names every articulation the contract has except the plain one", () => {
    const contract = articulationSchema.options.filter((value) => value !== "normal");
    expect([...matrixArticulations()].sort()).toEqual([...contract].sort());
  });

  it("invents nothing the contract cannot store", () => {
    for (const value of matrixArticulations()) {
      expect(articulationSchema.safeParse(value).success).toBe(true);
    }
  });

  it("puts every row in a family that has a label", () => {
    for (const row of TECHNIQUE_MATRIX) {
      expect(FAMILY_LABELS[row.family]).toBeTruthy();
    }
    const grouped = (Object.keys(FAMILY_LABELS) as TechniqueRow["family"][]).flatMap(
      (family) => familyRows(family),
    );
    expect(grouped).toHaveLength(TECHNIQUE_MATRIX.length);
  });

  it("gives every row a name of its own and something to draw", () => {
    const labels = new Set(TECHNIQUE_MATRIX.map((row) => row.label));
    expect(labels.size).toBe(TECHNIQUE_MATRIX.length);
    for (const row of TECHNIQUE_MATRIX) {
      expect(row.label.length).toBeGreaterThan(1);
      expect(row.notation.length).toBeGreaterThan(0);
    }
  });

  /*
   * One mark is shared, and it is shared in printed tablature too: a
   * hammer-on and a pull-off are both a slur between two frets, and what
   * tells them apart is which way the frets go. Every other mark stands
   * alone, so a reader never has to guess which of two techniques a glyph
   * meant.
   */
  it("shares a mark only where the notation itself does", () => {
    const byNotation = new Map<string, string[]>();
    for (const row of TECHNIQUE_MATRIX) {
      byNotation.set(row.notation, [...(byNotation.get(row.notation) ?? []), row.id]);
    }
    const shared = [...byNotation.values()].filter((ids) => ids.length > 1);
    expect(shared).toEqual([["hammer_on", "pull_off"]]);
  });

  it("claims playback for every row, because a drawn-only row is not support", () => {
    expect(TECHNIQUE_MATRIX.every((row) => row.playback)).toBe(true);
  });
});

describe("every articulation in the matrix is heard, not only drawn", () => {
  it.each(articulationRows.map((row) => [row.id, row] as const))(
    "%s is planned differently from a plain note",
    (_id, row) => {
      const articulation = row.id as Articulation;
      const written = fixtureFor(articulation, articulation);
      const plain = fixtureFor(articulation, undefined);
      expect(heard(planAt(written.song, written.slotIndex))).not.toBe(
        heard(planAt(plain.song, plain.slotIndex)),
      );
    },
  );

  it("keeps the written pitch and the written string in every case", () => {
    for (const row of articulationRows) {
      const articulation = row.id as Articulation;
      const { song: target, slotIndex } = fixtureFor(articulation, articulation);
      const plan = planAt(target, slotIndex);
      const plain = planAt(...([
        fixtureFor(articulation, undefined).song,
        slotIndex,
      ] as const));
      expect(plan.pitch).toBe(plain.pitch);
      expect(plan.position).toEqual(plain.position);
    }
  });
});

/*
 * The five added in 2T-C, each said as the number a render can be measured
 * against. The point of writing them out rather than only diffing plans is
 * that a diff proves *something* changed; these say what.
 */
describe("the five new techniques, in numbers", () => {
  const planOf = (articulation: Articulation) =>
    planAt(song([bar(slots([A3(articulation)]))]), 0);
  const plain = planAt(song([bar(slots([A3()]))]), 0);

  it("a ghost note is quieter than the note it shadows, and stops earlier", () => {
    const ghost = planOf("ghost");
    expect(ghost.gainEnvelope[0]!.value).toBeLessThan(plain.gain);
    expect(ghost.gainEnvelope[0]!.value).toBeCloseTo(
      plain.gain * expressionPresets.ghost.gainMultiplier,
      5,
    );
    expect(ghost.durationSeconds).toBeLessThan(plain.durationSeconds);
  });

  it("a dead note is a short damped knock, not a quiet note", () => {
    const dead = planOf("dead");
    expect(dead.durationSeconds).toBeLessThanOrEqual(
      expressionPresets.dead.holdSeconds,
    );
    expect(dead.filterPreset).toBe("dead");
    /* It ends at zero rather than being cut, so there is no click after it. */
    expect(dead.gainEnvelope.at(-1)!.value).toBe(0);
  });

  it("a tapped note arrives instead of landing", () => {
    const tapped = planOf("tapping");
    expect(tapped.gainEnvelope[0]).toEqual({ timeSeconds: 0, value: 0 });
    expect(tapped.gainEnvelope[1]!.timeSeconds).toBeGreaterThan(0);
    expect(tapped.gainEnvelope[1]!.timeSeconds).toBeLessThanOrEqual(
      expressionPresets.tapping.attackSeconds,
    );
    /* And it is not simply the plain note with a ramp painted on it. */
    expect(plain.gainEnvelope).toEqual([]);
  });

  it("a natural harmonic sounds the node, an octave above the stopped note", () => {
    const harmonic = planOf("natural_harmonic");
    expect(harmonic.pitch).toBe("A3");
    expect(harmonic.pitchAutomation[0]!.cents).toBe(
      expressionPresets.harmonic.naturalCents,
    );
    expect(harmonic.gainEnvelope[0]!.value).toBeLessThan(plain.gain);
  });

  it("a pinch harmonic squeals up a moment after the pick", () => {
    const pinch = planOf("pinch_harmonic");
    expect(pinch.pitchAutomation[0]!.cents).toBe(0);
    expect(pinch.pitchAutomation[1]!.cents).toBe(
      expressionPresets.harmonic.pinchCents,
    );
    expect(pinch.pitchAutomation[1]!.timeSeconds).toBeGreaterThan(0);
    expect(pinch.pitchAutomation[1]!.timeSeconds).toBeLessThanOrEqual(
      expressionPresets.harmonic.pinchRiseSeconds,
    );
    expect(pinch.gainEnvelope[0]!.value).toBeGreaterThan(
      planOf("natural_harmonic").gainEnvelope[0]!.value,
    );
  });
});

/*
 * The two rows that are not articulations. They live in fields of their own,
 * so they are proved on their own terms: one against what is heard, the other
 * against when each string is struck.
 */
describe("let ring is heard, not only written", () => {
  const withRing = (ring: boolean): Song =>
    song([
      bar([
        { notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, ...(ring ? { letRing: true } : {}) }] },
        { notes: [{ pitch: "A2", position: { string: 1, fret: 0 } }] },
        ...slots([], 6),
      ]),
    ]);

  const soundingOf = (target: Song) => {
    const spans = soundingSpans(
      writtenSpans(target.sections[0]!.bars, TRACK),
      (span) => span.note.position?.string ?? null,
    );
    return spans.find((span) => span.startTicks === 0)!;
  };

  it("keeps the low string ringing under the string struck after it", () => {
    const ringing = soundingOf(withRing(true));
    const stopped = soundingOf(withRing(false));
    expect(ringing.soundingTicks).toBeGreaterThan(stopped.soundingTicks);
    expect(ringing.cutByRestrike).toBe(false);
  });
});

describe("a strum is a hand crossing the strings", () => {
  const chordAt = (strum?: "down" | "up"): Song =>
    song([
      bar([
        {
          notes: [0, 1, 2].map((string) => ({
            pitch: ["E2", "A2", "D3"][string]!,
            position: { string, fret: 0 },
            ...(strum === undefined ? {} : { strum }),
          })),
        },
        ...slots([], 7),
      ]),
    ]);

  const offsets = (strum?: "down" | "up") => {
    const notes = buildExpressionPlan(chordAt(strum)).notes;
    return [0, 1, 2].map(
      (string) =>
        notes.find((plan) => plan.position?.stringIndex === string)!
          .strumOffsetSeconds ?? null,
    );
  };

  it("strikes a block chord's strings together", () => {
    expect(offsets(undefined)).toEqual([null, null, null]);
  });

  it("crosses from the thickest string downwards", () => {
    const [low, middle, high] = offsets("down");
    expect(low).toBe(0);
    expect(middle!).toBeGreaterThan(low!);
    expect(high!).toBeGreaterThan(middle!);
    expect(high!).toBeCloseTo(2 * expressionPresets.strum.perStringSeconds, 5);
  });

  it("crosses back the other way going up", () => {
    const [low, middle, high] = offsets("up");
    expect(high).toBe(0);
    expect(middle!).toBeGreaterThan(high!);
    expect(low!).toBeGreaterThan(middle!);
  });

  it("moves when the strings are struck without moving what is written", () => {
    const down = buildExpressionPlan(chordAt("down")).notes;
    const block = buildExpressionPlan(chordAt(undefined)).notes;
    /* One written onset either way: the score is untouched. */
    expect(new Set(down.map((plan) => plan.timeTicks))).toEqual(
      new Set(block.map((plan) => plan.timeTicks)),
    );
    /* But not one moment of striking. */
    expect(new Set(down.map((plan) => plan.startSeconds)).size).toBe(3);
    expect(new Set(block.map((plan) => plan.startSeconds)).size).toBe(1);
  });

  it("fits the crossing inside a chord too short to hold all of it", () => {
    const short = song(
      [
        {
          timeSignature: [4, 4],
          resolution: 32,
          slots: {
            gtr: [
              {
                notes: [0, 1, 2].map((string) => ({
                  pitch: ["E2", "A2", "D3"][string]!,
                  position: { string, fret: 0 },
                  strum: "down" as const,
                })),
              },
              ...Array.from({ length: 31 }, () => null),
            ],
          },
        },
      ],
      [],
      240,
    );
    const notes = buildExpressionPlan(short).notes;
    const shortest = Math.min(...notes.map((plan) => plan.durationSeconds));
    const spread = Math.max(...notes.map((plan) => plan.strumOffsetSeconds ?? 0));
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThanOrEqual(
      shortest * expressionPresets.strum.maxSpreadFraction + 1e-6,
    );
    expect(spread).toBeLessThan(2 * expressionPresets.strum.perStringSeconds);
  });
});

/*
 * The middle three links: written by the real command, kept by the schema and
 * by storage, and taken back byte for byte. A technique that survives the
 * planner but not a reload is not a technique anyone can use.
 */
describe("every technique survives writing, storing and undoing", () => {
  const start = song([bar(slots([A3()]))]);
  const target = { sectionId: "s1", trackId: TRACK, barIndex: 0, slotIndex: 0 };

  const write = (command: Parameters<typeof applyEdit>[1]): Song => {
    const result = applyEdit(start, command);
    if (!result.ok) throw new Error(result.error.message);
    return result.song;
  };

  it.each(articulationRows.map((row) => [row.id] as const))(
    "%s is written, parsed and stored unchanged",
    (id) => {
      const articulation = id as Articulation;
      const after = write({
        kind: "set_articulation",
        target,
        stringIndex: 1,
        articulation,
      });

      const parsed = songSchema.safeParse(after);
      expect(parsed.success).toBe(true);

      const raw = JSON.stringify(nextEnvelope(after, { kind: "empty" }));
      const back = decideLoad(raw);
      expect(back.kind).toBe("envelope");
      if (back.kind !== "envelope") return;
      expect(back.song).toEqual(songSchema.parse(after));

      const slot = back.song.sections[0]!.bars[0]!.slots[TRACK]![0];
      if (slot === null || slot === undefined || slot === "-" || Array.isArray(slot)) {
        throw new Error("lost");
      }
      expect(slot.notes[0]!.articulation).toBe(articulation);
    },
  );

  it.each(articulationRows.map((row) => [row.id] as const))(
    "%s is taken back to the exact bytes it started from",
    (id) => {
      const after = write({
        kind: "set_articulation",
        target,
        stringIndex: 1,
        articulation: id as Articulation,
      });
      const cleared = applyEdit(after, {
        kind: "set_articulation",
        target,
        stringIndex: 1,
        articulation: null,
      });
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) return;
      /* Normal is the absence of the field, not a value written into it. */
      expect(JSON.stringify(cleared.song)).toBe(JSON.stringify(start));
    },
  );

  it("writes and clears let ring the same way", () => {
    const rung = write({
      kind: "set_let_ring",
      target,
      stringIndex: 1,
      letRing: true,
    });
    const slot = rung.sections[0]!.bars[0]!.slots[TRACK]![0];
    if (slot === null || slot === undefined || slot === "-" || Array.isArray(slot)) {
      throw new Error("lost");
    }
    expect(slot.notes[0]!.letRing).toBe(true);

    const off = applyEdit(rung, {
      kind: "set_let_ring",
      target,
      stringIndex: 1,
      letRing: false,
    });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(JSON.stringify(off.song)).toBe(JSON.stringify(start));
  });

  it("gives every technique a reader-facing name, never an enum value", () => {
    for (const row of TECHNIQUE_MATRIX) {
      if (row.field !== "articulation") continue;
      expect(articulationLabel(row.id)).toBe(row.label);
      expect(row.label).not.toMatch(/_/);
    }
  });
});
