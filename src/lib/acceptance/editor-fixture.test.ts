/**
 * That the fixture can carry the seven steps (2U-A handoff §3).
 *
 * A fixture is only as good as the steps it makes possible. Each test here
 * names a step that would be impossible without the shape it checks — a paste
 * with no empty target, a measure move with no free neighbour, a
 * "reaches every track" claim on a song with one track.
 */
import { describe, expect, it } from "vitest";

import {
  EDITOR_BASS_ID,
  EDITOR_GUITAR_ID,
  EDITOR_LANDMARKS,
  EDITOR_STRING_NAMES,
  editorFixture,
} from "@/lib/acceptance/editor-fixture";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { songSchema } from "@/lib/song/schema";
import { runValidators, SONG_VALIDATORS } from "@/lib/validators";
import { errorsOnly } from "@/lib/validators/types";
import { applyTransform } from "@/lib/song/transform";
import { ticksPerBar } from "@/lib/music/timing";

const slotsOf = (barIndex: number, trackId: string) =>
  editorFixture().sections[0]!.bars[barIndex]!.slots[trackId]!;

const struck = (barIndex: number, trackId: string) =>
  slotsOf(barIndex, trackId).filter(
    (slot) => slot !== null && slot !== "-" && !Array.isArray(slot),
  );

describe("the fixture is a song the app would accept", () => {
  it("passes the schema", () => {
    expect(songSchema.safeParse(editorFixture()).success).toBe(true);
  });

  it("raises no hard validation error", () => {
    expect(errorsOnly(runValidators(editorFixture(), SONG_VALIDATORS))).toEqual([]);
  });

  it("hands out a new song every time, sharing nothing", () => {
    const first = editorFixture();
    const second = editorFixture();
    expect(first).not.toBe(second);
    expect(first.sections[0]!.bars[0]).not.toBe(second.sections[0]!.bars[0]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("what each step needs is already there", () => {
  /*
   * Step 5 and step 6 claim an operation reaches every track. On a one-track
   * song that claim cannot be false, so it would be measuring nothing.
   */
  it("has two tracks, both written in", () => {
    const song = editorFixture();
    expect(song.tracks.map((track) => track.id)).toEqual([
      EDITOR_GUITAR_ID,
      EDITOR_BASS_ID,
    ]);
    expect(struck(0, EDITOR_GUITAR_ID).length).toBeGreaterThan(0);
    expect(struck(0, EDITOR_BASS_ID).length).toBeGreaterThan(0);
  });

  it("has at least three bars", () => {
    expect(editorFixture().sections[0]!.bars.length).toBeGreaterThanOrEqual(3);
  });

  /* Step 1 selects a motif; step 4 moves it in three different ways. */
  it("opens with a chord and follows it with single notes", () => {
    const first = slotsOf(0, EDITOR_GUITAR_ID);
    const chord = first[EDITOR_LANDMARKS.motifStart.slotIndex];
    expect(chord && typeof chord === "object" && !Array.isArray(chord)).toBe(true);
    if (!chord || chord === "-" || Array.isArray(chord)) return;
    expect(chord.notes.length).toBeGreaterThanOrEqual(3);

    const last = first[EDITOR_LANDMARKS.motifEnd.slotIndex];
    expect(last && last !== "-" && !Array.isArray(last) && last.notes).toHaveLength(1);
  });

  /* A string move needs somewhere to go in both directions. */
  it("spreads the motif over more than one string, away from the edges", () => {
    const strings = new Set<number>();
    for (const slot of struck(0, EDITOR_GUITAR_ID)) {
      if (!slot || slot === "-" || Array.isArray(slot)) continue;
      for (const note of slot.notes) {
        if (note.position) strings.add(note.position.string);
      }
    }
    expect(strings.size).toBeGreaterThanOrEqual(3);
    /* Not on the outermost string only: a move needs a neighbour each way. */
    expect([...strings].some((index) => index > 0 && index < 5)).toBe(true);
  });

  /* Step 2 pastes. A paste into occupied space is a refusal, not a paste. */
  it("keeps the paste target empty on every track", () => {
    for (const trackId of [EDITOR_GUITAR_ID, EDITOR_BASS_ID]) {
      expect(struck(EDITOR_LANDMARKS.emptyTarget.barIndex, trackId)).toEqual([]);
    }
  });

  /* Step 6 moves a bar right and duplicates it. Both need free space. */
  it("puts a written bar next to a free one", () => {
    expect(struck(EDITOR_LANDMARKS.movableBar, EDITOR_GUITAR_ID).length).toBeGreaterThan(0);
    expect(struck(EDITOR_LANDMARKS.freeBar, EDITOR_GUITAR_ID)).toEqual([]);
    expect(EDITOR_LANDMARKS.freeBar).toBe(EDITOR_LANDMARKS.movableBar + 1);
  });

  it("gives the multi-measure step two adjacent bars", () => {
    const { start, end } = EDITOR_LANDMARKS.multiBars;
    expect(end).toBe(start + 1);
    expect(end).toBeLessThan(editorFixture().sections[0]!.bars.length);
  });

  /*
   * The claim the guide makes, measured rather than asserted (2U-B §5).
   *
   * The last round's step told the reader to move the bar-1 motif to a
   * thinner string. That motif opens on an open low E, which no thinner
   * string can sound and which has no thicker string beside it, so the guide
   * was asking for a movement the fretboard does not have and the run failed
   * on both directions. A comment saying "bar 3 works" would be the same
   * mistake one file along, so it is run through the real command instead.
   */
  describe("the string-move landmarks are what they claim", () => {
    const barTicks = () => {
      const bar = editorFixture().sections[0]!.bars[0]!;
      return ticksPerBar(bar.timeSignature, bar.resolution);
    };
    const restring = (barIndex: number, stringDelta: number) => {
      const song = editorFixture();
      const width = barTicks();
      return applyTransform(
        song,
        {
          sectionId: EDITOR_LANDMARKS.sectionId,
          trackId: EDITOR_GUITAR_ID,
          startTicks: barIndex * width,
          endTicks: (barIndex + 1) * width,
        },
        { kind: "restring_same_pitch", stringDelta },
      );
    };

    it("can move the restring motif to a thinner string", () => {
      expect(restring(EDITOR_LANDMARKS.restringBar, 1).ok).toBe(true);
    });

    it("can move it to a thicker string too", () => {
      expect(restring(EDITOR_LANDMARKS.restringBar, -1).ok).toBe(true);
    });

    it("keeps a selection that genuinely cannot be restrung", () => {
      /*
       * Both directions, because the negative step must stay negative however
       * the reader reaches it.
       */
      const thinner = restring(EDITOR_LANDMARKS.unplayableRestring.barIndex, 1);
      const thicker = restring(EDITOR_LANDMARKS.unplayableRestring.barIndex, -1);
      expect(thinner.ok).toBe(false);
      expect(thicker.ok).toBe(false);
      if (thinner.ok || thicker.ok) return;
      /* Typed, and with something a reader can act on. */
      expect(thinner.error.code).toBe("out_of_range");
      expect(thinner.error.message.length).toBeGreaterThan(10);
    });

    it("refuses without touching the song it was given", () => {
      const song = editorFixture();
      const before = JSON.stringify(song);
      const width = barTicks();
      applyTransform(
        song,
        {
          sectionId: EDITOR_LANDMARKS.sectionId,
          trackId: EDITOR_GUITAR_ID,
          startTicks: 0,
          endTicks: width,
        },
        { kind: "restring_same_pitch", stringDelta: 1 },
      );
      expect(JSON.stringify(song)).toBe(before);
    });
  });
});
/**
 * The techniques the round has to make audible (2V-B.1 §10).
 *
 * Written through the **real** expression planner rather than read off the
 * slots. A fixture can draw a slide and the planner can decline to play it —
 * no room to glide, wrong string, too wide an interval — and a task that
 * names a passage the engine falls back on is a task the founder cannot
 * answer honestly. So each of these asks the planner what it will actually
 * do, which is the same question the engine asks when the reader presses
 * play.
 */
describe("every technique the round names is really in the song", () => {
  const plan = () => buildExpressionPlan(editorFixture());
  /* The track matters: two instruments share a slot, and the first match in
     the plan is whichever one the traversal reached first. */
  const noteAt = (barIndex: number, slotIndex: number, trackId = EDITOR_GUITAR_ID) =>
    plan().notes.find(
      (entry) =>
        entry.barKey === `s1:${barIndex}` &&
        entry.slotIndex === slotIndex &&
        entry.trackId === trackId,
    );

  it("plans the 5→7 slide as a chain rather than falling back", () => {
    const { barIndex, targetSlot, stringIndex, fromFret, toFret } =
      EDITOR_LANDMARKS.slide;
    const target = noteAt(barIndex, targetSlot);
    expect(target?.articulation).toBe("slide");
    /* The whole claim: no fallback reason, and a chain to belong to. */
    expect(target?.fallbackReason).toBeUndefined();
    expect(target?.chainId).toBeDefined();
    expect(target?.chainRole).toBe("target");

    const chain = plan().chains.find((entry) => entry.chainId === target?.chainId);
    expect(chain?.transitions.map((entry) => entry.kind)).toEqual(["slide"]);
    expect(chain?.stringIndex).toBe(stringIndex);

    /* And the frets a task would say out loud are the frets that are there. */
    const source = noteAt(barIndex, EDITOR_LANDMARKS.slide.sourceSlot);
    expect(source?.position).toEqual({ stringIndex, fret: fromFret });
    expect(target?.position).toEqual({ stringIndex, fret: toFret });
    expect(EDITOR_STRING_NAMES[stringIndex]).toBe("Re");
  });

  it("plans a vibrato with pitch that actually moves", () => {
    const { barIndex, slotIndex } = EDITOR_LANDMARKS.vibrato;
    const note = noteAt(barIndex, slotIndex);
    expect(note?.articulation).toBe("vibrato");
    expect(note?.expressive).toBe(true);
    expect(note?.fallbackReason).toBeUndefined();
    /* More than one written point, and not all at the same cents: a vibrato
       that planned flat would be an ordinary sustain with a glyph on it. */
    const cents = note?.pitchAutomation.map((point) => point.cents) ?? [];
    expect(cents.length).toBeGreaterThan(4);
    expect(new Set(cents).size).toBeGreaterThan(2);
  });

  it("plans the hammer-on and the pull-off as one continuing chain each", () => {
    const hammer = noteAt(
      EDITOR_LANDMARKS.hammerOn.barIndex,
      EDITOR_LANDMARKS.hammerOn.targetSlot,
    );
    const pull = noteAt(
      EDITOR_LANDMARKS.pullOff.barIndex,
      EDITOR_LANDMARKS.pullOff.targetSlot,
    );
    expect(hammer?.articulation).toBe("hammer_on");
    expect(pull?.articulation).toBe("pull_off");
    expect(hammer?.fallbackReason).toBeUndefined();
    expect(pull?.fallbackReason).toBeUndefined();
    /* One chain carrying both gestures: the string never stops sounding. */
    expect(hammer?.chainId).toBeDefined();
    expect(pull?.chainId).toBe(hammer?.chainId);
    const chain = plan().chains.find((entry) => entry.chainId === hammer?.chainId);
    expect(chain?.transitions.map((entry) => entry.kind)).toEqual([
      "hammer_on",
      "pull_off",
    ]);
  });

  it("holds the opening power chord instead of letting it stop at the next note", () => {
    const { barIndex, slotIndex, stringIndexes } = EDITOR_LANDMARKS.heldPowerChord;
    const slot = slotsOf(barIndex, EDITOR_GUITAR_ID)[slotIndex];
    expect(slot && slot !== "-" && !Array.isArray(slot)).toBe(true);
    if (!slot || slot === "-" || Array.isArray(slot)) return;

    expect(slot.notes.map((note) => note.position?.string)).toEqual(stringIndexes);
    for (const note of slot.notes) {
      expect(note.durationTicks).toBeGreaterThan(0);
      expect(note.letRing).toBe(true);
      expect(note.strum).toBe("down");
    }
    /* And the planner honours it: the chord is still sounding when the next
       note is struck, which is what "held" means. */
    const chord = noteAt(barIndex, slotIndex);
    const next = noteAt(barIndex, 4);
    expect(chord).toBeDefined();
    expect(next).toBeDefined();
    expect(chord!.startSeconds + chord!.durationSeconds).toBeGreaterThan(
      next!.startSeconds,
    );
  });

  it("keeps everything a repeat has to carry inside one bar", () => {
    const written = slotsOf(EDITOR_LANDMARKS.strummedChord.barIndex, EDITOR_GUITAR_ID);
    expect(written.some((slot) => slot === null)).toBe(true);
    expect(written.some((slot) => slot === "-")).toBe(true);

    const chord = written[EDITOR_LANDMARKS.strummedChord.slotIndex];
    expect(chord && chord !== "-" && !Array.isArray(chord)).toBe(true);
    if (!chord || chord === "-" || Array.isArray(chord)) return;
    /* Polyphony, strum, let-ring and an explicit length, all at once. */
    expect(chord.notes.length).toBeGreaterThanOrEqual(3);
    expect(chord.notes.every((note) => note.strum === "down")).toBe(true);
    expect(chord.notes.every((note) => note.letRing === true)).toBe(true);
    expect(chord.notes.every((note) => (note.durationTicks ?? 0) > 0)).toBe(true);

    /* And an articulation somewhere in the same bar, so a repeat that dropped
       articulations would have something to drop. */
    expect(
      written.some(
        (slot) =>
          slot !== null &&
          slot !== "-" &&
          !Array.isArray(slot) &&
          slot.notes.some((note) => note.articulation !== undefined),
      ),
    ).toBe(true);
  });

  it("has both instruments sounding in the same bar, and neither silent", () => {
    const song = editorFixture();
    /* Asked of the plan the engine plays, not of the slots: a note written
       into a bar and then swallowed by a tie run is drawn but not struck. */
    const notes = plan().notes;
    const bar = `s1:${EDITOR_LANDMARKS.bothTracksBar}`;
    const inBar = notes.filter((note) => note.barKey === bar);

    expect(new Set(inBar.map((note) => note.trackId))).toEqual(
      new Set([EDITOR_GUITAR_ID, EDITOR_BASS_ID]),
    );
    /* Across the whole song too: a "second track" that is written but never
       struck is a second track a listener cannot hear. */
    for (const trackId of [EDITOR_GUITAR_ID, EDITOR_BASS_ID]) {
      expect(notes.filter((note) => note.trackId === trackId).length)
        .toBeGreaterThan(0);
    }
    expect(song.tracks.map((track) => track.name)).toEqual(["Gitar", "Bas"]);
    expect(song.sections[0]!.name).toBe("Kabul");
  });
});
