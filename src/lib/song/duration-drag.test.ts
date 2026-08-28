import { describe, expect, it } from "vitest";

import {
  beginDurationDrag,
  commitDurationDrag,
  dragAtLimit,
  dragChanged,
  durationDragLabel,
  moveDurationDrag,
  ticksLabel,
} from "@/lib/song/duration-drag";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";
const SLOT = 20; // pixels per grid step, for the arithmetic

const rest = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => null);

function fixture(slots: MelodicSlot[]): Song {
  return song(
    [guitarTrack()],
    [section([melodicBar(TRACK, slots, { resolution: 16 })])],
  );
}

const oneNote = () => {
  const slots = rest(16);
  slots[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
  slots[4] = { notes: [{ pitch: "A2", position: { string: 1, fret: 0 } }] };
  return fixture(slots);
};

const target = {
  sectionId: "s1",
  barIndex: 0,
  trackId: TRACK,
  slotIndex: 0,
  noteIndex: 0,
};

const start = (subject: Song = oneNote()) => {
  const drag = beginDurationDrag(subject, target);
  if (drag === null) throw new Error("no drag");
  return drag;
};

describe("beginDurationDrag", () => {
  it("starts from the length the note is already drawn at", () => {
    expect(start()).toMatchObject({ startTicks: 48, steps: 0, ticks: 48 });
  });

  /* A tie run is what the tab draws, so it is what the handle grabs. */
  it("starts from the tie run when the note states no length", () => {
    const slots = rest(16);
    slots[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    slots[1] = "-";
    slots[2] = "-";
    expect(start(fixture(slots)).startTicks).toBe(144);
  });

  it("starts from the note's own length when it has one", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, durationTicks: 288 }],
    };
    expect(start(fixture(slots)).startTicks).toBe(288);
  });

  it("gives nothing for a target that is not a note", () => {
    expect(
      beginDurationDrag(oneNote(), { ...target, slotIndex: 9 }),
    ).toMatchObject({ startTicks: 48 });
  });
});

describe("moveDurationDrag", () => {
  const subject = oneNote();

  it("turns pixels into whole grid steps", () => {
    expect(moveDurationDrag(subject, start(subject), SLOT * 3, SLOT)).toMatchObject({
      steps: 3,
      ticks: 48 * 4,
    });
  });

  it("rounds to the nearest step rather than truncating", () => {
    expect(moveDurationDrag(subject, start(subject), SLOT * 1.6, SLOT).steps).toBe(2);
  });

  /*
   * Measured from the gesture's origin, not accumulated. A finger that
   * wanders out and comes back lands exactly where it started, and a length
   * that drifts is a wrong note.
   */
  it("lands back on the original length when the finger comes back", () => {
    const drag = start(subject);
    const out = moveDurationDrag(subject, drag, SLOT * 5, SLOT);
    const back = moveDurationDrag(subject, out, 0, SLOT);
    expect(back.ticks).toBe(drag.startTicks);
    expect(dragChanged(back)).toBe(false);
  });

  it("stops at the end of the music instead of running past it", () => {
    const far = moveDurationDrag(subject, start(subject), SLOT * 500, SLOT);
    expect(far.ticks).toBe(768);
    expect(dragAtLimit(subject, far)).toBe(true);
  });

  it("stops at one grid step instead of going shorter than one", () => {
    const short = moveDurationDrag(subject, start(subject), -SLOT * 500, SLOT);
    expect(short.ticks).toBe(48);
  });

  it("does nothing at all when the grid has no width", () => {
    const drag = start(subject);
    expect(moveDurationDrag(subject, drag, 999, 0)).toBe(drag);
  });

  /*
   * 2T-C §11. The `+` and `−` buttons ask for whole steps rather than for
   * pixels, and the controller hands them one pixel per step. That is only
   * sound if the core reads the ratio and nothing else — which it does, and
   * this says so, because the buttons now depend on it.
   *
   * The buttons used to perform a drag instead. Measured through the real
   * UI, a reader tapping `+` fifteen times got seven steps and the first tap
   * did nothing: the release read a drag React had not rendered yet. A tap
   * is one command, so it is one command now.
   */
  it("reads the ratio, so one pixel a step is the same as a wide drag", () => {
    for (const steps of [1, 2, 5, -1, -3]) {
      expect(moveDurationDrag(subject, start(subject), steps, 1).ticks).toBe(
        moveDurationDrag(subject, start(subject), steps * SLOT, SLOT).ticks,
      );
    }
  });

  it("asks for one step and gets one step, never two and never none", () => {
    const from = start(subject);
    expect(moveDurationDrag(subject, from, 1, 1).ticks).toBe(from.startTicks + 48);
    expect(moveDurationDrag(subject, from, -1, 1).ticks).toBe(
      Math.max(48, from.startTicks - 48),
    );
  });
});

describe("what the reader is told", () => {
  it("names a plain value", () => {
    expect(ticksLabel(192)).toBe("dörtlük");
    expect(ticksLabel(144)).toBe("noktalı sekizlik");
  });

  it("names a length that needs two values as a tie", () => {
    expect(ticksLabel(240)).toBe("dörtlük + on altılık (bağlı)");
  });

  it("says the value and how far it moved", () => {
    const subject = oneNote();
    const drag = moveDurationDrag(subject, start(subject), SLOT * 3, SLOT);
    expect(durationDragLabel(drag)).toBe("dörtlük · 3 adım uzun");
  });

  it("says so when the finger has not asked for anything", () => {
    expect(durationDragLabel(start())).toBe("on altılık · değişmedi");
  });
});

describe("commitDurationDrag", () => {
  it("writes the new length and nothing else", () => {
    const subject = oneNote();
    const before = JSON.stringify(subject);
    const drag = moveDurationDrag(subject, start(subject), SLOT * 3, SLOT);
    const result = commitDurationDrag(subject, drag);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /* The input song is untouched. */
    expect(JSON.stringify(subject)).toBe(before);

    const slots = result.song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
    const first = slots[0];
    if (first === null || first === undefined || first === "-") throw new Error("lost");
    expect(first.notes[0]!.durationTicks).toBe(192);
    /* The note in the next slot is exactly where it was. */
    expect(slots[4]).toEqual({
      notes: [{ pitch: "A2", position: { string: 1, fret: 0 } }],
    });
  });

  /* A tap on the handle is not an edit, and must not enter the history. */
  it("refuses a drag that did not move", () => {
    expect(commitDurationDrag(oneNote(), start())).toMatchObject({ ok: false });
  });

  it("takes the field back off when the note returns to one step", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, durationTicks: 192 }],
    };
    const subject = fixture(slots);
    const drag = moveDurationDrag(subject, start(subject), -SLOT * 3, SLOT);
    const result = commitDurationDrag(subject, drag);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = result.song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
    const first = written[0];
    if (first === null || first === undefined || first === "-") throw new Error("lost");
    expect(first.notes[0]).toEqual({ pitch: "E2", position: { string: 0, fret: 0 } });
  });
});
