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
import {
  gestureTakes,
  GESTURE_TAKE_IDS,
  type GestureTakeId,
} from "@/lib/listening/gesture-take";
import { resolveExpression } from "@/lib/music/expression-resolver";
import type { MelodicSlot, NoteEvent } from "@/lib/song/schema";

const fixture = editorFixture();
const takes = gestureTakes(fixture)!;

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
  it("builds all ten of them", () => {
    expect(Object.keys(takes).sort()).toEqual([...GESTURE_TAKE_IDS].sort());
  });

  it("writes a gesture into each, and the command is the one the editor calls", () => {
    for (const id of GESTURE_TAKE_IDS) {
      const note = gestureNote(id);
      expect(note.pitchGesture ?? note.connection).toBeDefined();
      expect(resolveExpression(note).conflict).toBeNull();
    }
  });

  it("leaves the fixture the other cards read untouched", () => {
    expect(JSON.stringify(editorFixture())).toBe(JSON.stringify(fixture));
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
  it("L11 · holds versus releases, same note and same amount", () => {
    const hold = gestureNote("L11a").pitchGesture!;
    const release = gestureNote("L11b").pitchGesture!;
    expect(hold).toEqual({ kind: "bend", targetCents: 200 });
    expect(release).toEqual({ kind: "bend_release", targetCents: 200 });
    /* And the audio really diverges at the ending, which is the question. */
    expect(planned("L11a")[0]!.pitchAutomation.at(-1)!.cents).toBe(200);
    expect(planned("L11b")[0]!.pitchAutomation.at(-1)!.cents).toBe(0);
  });

  it("L12 · both start bent, and only the second comes down", () => {
    expect(planned("L12a")[0]!.pitchAutomation[0]!.cents).toBe(200);
    expect(planned("L12b")[0]!.pitchAutomation[0]!.cents).toBe(200);
    expect(planned("L12a")[0]!.pitchAutomation.at(-1)!.cents).toBe(200);
    expect(planned("L12b")[0]!.pitchAutomation.at(-1)!.cents).toBe(0);
  });

  it("L13 · the same travel, and only the target's attack differs", () => {
    const legato = planned("L13a").find((note) => note.timeTicks % 768 !== 0)!;
    const shift = planned("L13b").find((note) => note.timeTicks % 768 !== 0)!;
    /* The legato target belongs to a chain, so nothing strikes it; the shift
       target does not, so the transport fires it like any other onset. */
    expect(legato.chainRole).toBe("target");
    expect(shift.chainId).toBeUndefined();
  });

  it("L14 · one note entered, one note left, and neither invents a fret", () => {
    for (const id of ["L14a", "L14b"] as const) {
      const take = takes[id];
      const marker = barTimeline(take.song)[take.barNumber - 1]!;
      const notes = buildExpressionPlan(take.song).notes.filter(
        (note) =>
          note.trackId === take.trackId &&
          note.timeTicks >= marker.time &&
          note.timeTicks < marker.time + marker.durationTicks,
      );
      /* One real note. The place the hand comes from or goes to is
         automation, never a second onset on the staff. */
      expect(notes).toHaveLength(1);
    }
    expect(gestureNote("L14a").pitchGesture).toEqual({
      kind: "slide_in",
      from: "below",
    });
    expect(gestureNote("L14b").pitchGesture).toEqual({ kind: "slide_out", to: "down" });
  });

  it("L15 · arrives at the target before it starts shaking", () => {
    const points = planned("L15")[0]!.pitchAutomation;
    const arrival = points.findIndex((point) => point.cents === 200);
    expect(arrival).toBeGreaterThan(0);
    for (const point of points.slice(0, arrival)) {
      expect(point.cents).toBeLessThanOrEqual(200);
    }
    /* And it really shakes: something goes above the target afterwards. */
    expect(Math.max(...points.map((point) => point.cents))).toBeGreaterThan(200);
  });

  it("L16 · is one note that outlives its own measure", () => {
    const take = takes.L16;
    const marker = barTimeline(take.song)[take.barNumber - 1]!;
    const notes = buildExpressionPlan(take.song).notes.filter(
      (note) => note.trackId === take.trackId && note.timeTicks === marker.time,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.pitchAutomation.at(-1)!.cents).toBe(200);
  });
});

describe("99. the pack offers the cards, and offers none of them half-built", () => {
  const clips = listeningClips(fixture, null, null, takes);
  const ids = clips.map((clip) => clip.id);

  it("adds exactly the six new cards", () => {
    for (const id of ["L11", "L12", "L13", "L14", "L15", "L16"] as const) {
      expect(ids).toContain(id);
    }
  });

  it("keeps every earlier card", () => {
    for (const id of ["L1", "L5", "L9"] as const) expect(ids).toContain(id);
  });

  it("offers none of them when the music could not be written", () => {
    const without = listeningClips(fixture, null, null, null).map((clip) => clip.id);
    for (const id of ["L11", "L12", "L13", "L14", "L15", "L16"] as const) {
      expect(without).not.toContain(id);
    }
  });

  it("asks a question a listener can answer yes or no to", () => {
    for (const clip of clips.filter((entry) => entry.id.startsWith("L1") && entry.id > "L10")) {
      expect(clip.question.endsWith("?")).toBe(true);
      expect(clip.question).not.toMatch(/cent|tick|slot|gesture|automation/iu);
      expect(clip.takes.length).toBeGreaterThan(0);
    }
  });

  it("names both sides of a comparison so they can be told apart", () => {
    const eleven = clips.find((clip) => clip.id === "L11")!;
    expect(eleven.takes.map((take) => take.name)).toEqual([
      "Yukarıda tut",
      "Geri indir",
    ]);
  });
});
