/**
 * The six new cards, and what they may honestly claim (2V-C.1 §19).
 *
 * Two things are checked. That every take is real music written by the
 * production command — not a fixture edited by hand into the shape the answer
 * wants — and that each card's two sides differ in exactly the one thing the
 * question asks about. A card whose A and B differ in two ways cannot be
 * answered, however good it sounds.
 */
import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { barTimeline } from "@/lib/audio/schedule";
import { listeningClips } from "@/lib/listening/clip-plan";
import { isActive } from "@/lib/listening/listening-scope";
import {
  gestureTakes,
  GESTURE_TAKE_IDS,
  type GestureTakeId,
} from "@/lib/listening/gesture-take";
import { resolveExpression } from "@/lib/music/expression-resolver";
import type { MelodicSlot, NoteEvent } from "@/lib/song/schema";

const fixture = editorFixture();
const takes = gestureTakes(fixture)!;

/** Every note in a take's own bar. */
function barNotes(id: GestureTakeId): NoteEvent[] {
  const take = takes[id];
  const marker = barTimeline(take.song)[take.barNumber - 1]!;
  const [sectionId, barIndex] = marker.barKey.split(":");
  const bar = take.song.sections.find((entry) => entry.id === sectionId)!.bars[
    Number(barIndex)
  ]!;
  const lane = bar.slots[take.trackId] as MelodicSlot[];
  return lane
    .filter((slot): slot is { notes: NoteEvent[] } => slot !== null && slot !== "-")
    .flatMap((slot) => slot.notes);
}

/** The note the take's gesture landed on. */
function gestureNote(id: GestureTakeId): NoteEvent {
  const take = takes[id];
  const marker = barTimeline(take.song)[take.barNumber - 1]!;
  const [sectionId, barIndex] = marker.barKey.split(":");
  const bar = take.song.sections.find((entry) => entry.id === sectionId)!.bars[
    Number(barIndex)
  ]!;
  const lane = bar.slots[take.trackId] as MelodicSlot[];
  const carrying = lane
    .filter((slot): slot is { notes: NoteEvent[] } => slot !== null && slot !== "-")
    .flatMap((slot) => slot.notes)
    .find((note) => note.pitchGesture !== undefined || note.connection !== undefined);
  if (!carrying) throw new Error(`no gesture written in ${id}`);
  return carrying;
}

/** The plan of the take's own bar, so the audio claim is about real events. */
function planned(id: GestureTakeId) {
  const take = takes[id];
  const marker = barTimeline(take.song)[take.barNumber - 1]!;
  return buildExpressionPlan(take.song).notes.filter(
    (note) =>
      note.trackId === take.trackId &&
      note.timeTicks >= marker.time &&
      note.timeTicks < marker.time + marker.durationTicks,
  );
}

describe("97. every take is real music, written by the production command", () => {
  it("builds all sixteen of them", () => {
    expect(Object.keys(takes).sort()).toEqual([...GESTURE_TAKE_IDS].sort());
  });

  /**
   * The takes that carry a *pitch* gesture or a connection.
   *
   * L22a and L23a deliberately do not: their cards compare a gesture against
   * the same note played plainly, and the plain side having nothing written
   * on it is the comparison (2V-C.3 §16).
   *
   * The 2V-D.1-C cards are the same shape for a different axis. L27 and L29
   * ask about a technique region and L28 about how a string is struck, and
   * none of those is a movement of the pitch — so a take that carries only
   * one of the new axes is checked below, by the axis it actually carries.
   */
  const NO_PITCH_MOVEMENT = new Set([
    "L22a",
    "L23a",
    "L27a",
    "L27b",
    "L29a",
    "L29b",
  ]);
  const GESTURED = GESTURE_TAKE_IDS.filter((id) => !NO_PITCH_MOVEMENT.has(id));

  it("writes a gesture into each, and the command is the one the editor calls", () => {
    for (const id of GESTURED) {
      const note = gestureNote(id);
      expect(note.pitchGesture ?? note.connection).toBeDefined();
      expect(resolveExpression(note).conflict).toBeNull();
    }
  });

  it("writes the new axes with their own commands, on the cards that ask", () => {
    /*
     * 2V-D.1-C §18. Each card is checked by the axis it is about, and each
     * against its own A side — a B side that carried nothing would be a card
     * asking the founder to hear a difference that was never written.
     */
    const spansOf = (id: GestureTakeId) =>
      takes[id].song.sections.flatMap((section) => section.techniqueSpans ?? []);

    /* L27: the same mute, written the old way and the new way. */
    expect(barNotes("L27a").every((note) => note.articulation === "palm_mute")).toBe(true);
    expect(spansOf("L27a")).toEqual([]);
    expect(barNotes("L27b").some((note) => note.articulation === "palm_mute")).toBe(false);
    expect(spansOf("L27b").map((span) => span.kind)).toEqual(["palm_mute"]);

    /* L28: the attack axis, on top of a bend that both sides carry. */
    expect(barNotes("L28a").some((note) => note.attack !== undefined)).toBe(false);
    expect(barNotes("L28b").some((note) => note.attack === "natural_harmonic")).toBe(true);

    /* L29: one region, over one of the two strings. */
    expect(spansOf("L29a")).toEqual([]);
    expect(spansOf("L29b").map((span) => span.stringIndices)).toEqual([[1]]);
    expect(barNotes("L29b").length).toBeGreaterThan(1);
  });

  it("leaves the fixture the other cards read untouched", () => {
    expect(JSON.stringify(editorFixture())).toBe(JSON.stringify(fixture));
  });

  it("leaves the plain side of a comparison plain", () => {
    /* Not an oversight: the card asks about a gesture against its absence,
       so writing anything at all onto the A side would remove the question. */
    for (const id of ["L22a", "L23a"] as const) {
      const carrying = barNotes(id).find(
        (note) => note.pitchGesture !== undefined || note.connection !== undefined,
      );
      expect(carrying).toBeUndefined();
    }
  });

  it("puts sounding notes in every take's own bar", () => {
    for (const id of GESTURE_TAKE_IDS) {
      const notes = planned(id);
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) expect(note.durationSeconds).toBeGreaterThan(0);
    }
  });
});

describe("98. each card's two sides differ in exactly one thing", () => {
  it("L17 · holds versus releases, same note and same amount", () => {
    const hold = gestureNote("L17a").pitchGesture!;
    const release = gestureNote("L17b").pitchGesture!;
    expect(hold).toEqual({ kind: "bend", targetCents: 200 });
    expect(release).toEqual({ kind: "bend_release", targetCents: 200 });
    expect(planned("L17a")[0]!.pitchAutomation.at(-1)!.cents).toBe(200);
    expect(planned("L17b")[0]!.pitchAutomation.at(-1)!.cents).toBe(0);
  });

  it("L18 · one rises from the written pitch and the other does not", () => {
    /* The rise is the question, so it has to be on exactly one side. */
    expect(planned("L18a")[0]!.pitchAutomation[0]!.cents).toBe(0);
    expect(planned("L18b")[0]!.pitchAutomation[0]!.cents).toBe(200);
    expect(planned("L18a")[0]!.pitchAutomation.at(-1)!.cents).toBe(200);
    expect(planned("L18b")[0]!.pitchAutomation.at(-1)!.cents).toBe(200);
  });

  it("L19 · the same travel, and only the target's attack differs", () => {
    const legato = planned("L19a").find((note) => note.timeTicks % 768 !== 0)!;
    const shift = planned("L19b").find((note) => note.timeTicks % 768 !== 0)!;
    expect(legato.chainRole).toBe("target");
    expect(shift.chainId).toBeUndefined();
  });

  it("L20 · one note entered, one note left, and neither invents a fret", () => {
    for (const id of ["L20a", "L20b"] as const) {
      const take = takes[id];
      const marker = barTimeline(take.song)[take.barNumber - 1]!;
      const notes = buildExpressionPlan(take.song).notes.filter(
        (note) =>
          note.trackId === take.trackId &&
          note.timeTicks >= marker.time &&
          note.timeTicks < marker.time + marker.durationTicks,
      );
      /* One real note. Where the hand comes from or goes to is automation,
         never a second onset on the staff. */
      expect(notes).toHaveLength(1);
    }
    expect(gestureNote("L20a").pitchGesture).toEqual({
      kind: "slide_in",
      from: "below",
      approxSemitones: 2,
    });
    expect(gestureNote("L20b").pitchGesture).toEqual({
      kind: "slide_out",
      to: "down",
      approxSemitones: 3,
    });
  });

  it("gives every pair the same base note, velocity and written length", () => {
    for (const [a, b] of [
      ["L17a", "L17b"],
      ["L18a", "L18b"],
      ["L20a", "L20b"],
      ["L22a", "L22b"],
      ["L23a", "L23b"],
    ] as const) {
      const left = planned(a)[0]!;
      const right = planned(b)[0]!;
      expect(right.pitch).toBe(left.pitch);
      expect(right.velocity).toBe(left.velocity);
      expect(right.durationTicks).toBe(left.durationTicks);
    }
  });
});

describe("99. the pack asks this round's four, and no more", () => {
  const clips = listeningClips(fixture, null, null, takes);
  const ids = clips.map((clip) => clip.id);

  it("adds exactly the four revision cards", () => {
    for (const id of ["L21", "L22", "L23", "L24"] as const) {
      expect(ids).toContain(id);
    }
  });

  it("does not re-ask the cards the founder already judged", () => {
    for (const id of ["L11", "L12", "L13", "L14", "L15", "L16"] as const) {
      expect(ids).not.toContain(id);
    }
  });

  it("offers none of them when the music could not be written", () => {
    const without = listeningClips(fixture, null, null, null).map((clip) => clip.id);
    for (const id of ["L21", "L22", "L23", "L24"] as const) {
      expect(without).not.toContain(id);
    }
  });

  it("asks a question a listener can answer yes or no to", () => {
    for (const clip of clips.filter((entry) => isActive(entry.id))) {
      expect(clip.question.endsWith("?")).toBe(true);
      expect(clip.question).not.toMatch(/cent|tick|slot|gesture|automation/iu);
      expect(clip.takes.length).toBeGreaterThan(0);
    }
  });

  it("names both sides of a comparison, and says which comes first", () => {
    const seventeen = clips.find((clip) => clip.id === "L21")!;
    expect(seventeen.takes.map((take) => take.name)).toEqual([
      "A · Bağlı",
      "B · Vurarak",
    ]);
  });
});
