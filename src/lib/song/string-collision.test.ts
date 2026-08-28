import { describe, expect, it } from "vitest";

import {
  collisionMessage,
  collisionsIntroduced,
  stringCollisions,
} from "@/lib/song/string-collision";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";

const rest = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => null);

function fixture(slots: MelodicSlot[]): Song {
  return song(
    [guitarTrack()],
    [section([melodicBar(TRACK, slots, { resolution: 16 })])],
  );
}

const clean = () => {
  const slots = rest(16);
  slots[0] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "B2", position: { string: 1, fret: 2 } },
    ],
  };
  return fixture(slots);
};

const collided = (slotIndex = 0) => {
  const slots = rest(16);
  slots[slotIndex] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "F2", position: { string: 0, fret: 1 } },
    ],
  };
  return fixture(slots);
};

describe("stringCollisions", () => {
  it("finds nothing in a chord that uses one string each", () => {
    expect(stringCollisions(clean())).toEqual([]);
  });

  it("finds a string asked for twice at one instant", () => {
    const found = stringCollisions(collided());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      stringIndex: 0,
      slotIndex: 0,
      pitches: ["E2", "F2"],
    });
  });

  /* The message has to point at a beat, because a reader counts beats. */
  it("says which beat, not which slot", () => {
    const found = stringCollisions(collided(8));
    expect(found[0]!.beat).toBe(3);
    expect(collisionMessage(found[0]!)).toContain("3. vuruş");
    expect(collisionMessage(found[0]!)).toContain("1. tel");
    expect(collisionMessage(found[0]!)).toContain("E2");
  });

  it("does not use the model's words for the reader", () => {
    const message = collisionMessage(stringCollisions(collided())[0]!);
    for (const word of ["tick", "slot", "stringIndex", "onset"]) {
      expect(message.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  /*
   * Two notes on one string a beat apart is an ordinary re-attack, and the
   * sounding model shortens the first one. Nothing here is wrong with it.
   */
  it("says nothing about the same string struck twice at different times", () => {
    const slots = rest(16);
    slots[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    slots[4] = { notes: [{ pitch: "F2", position: { string: 0, fret: 1 } }] };
    expect(stringCollisions(fixture(slots))).toEqual([]);
  });

  it("skips a note nothing could place, which competes for no string", () => {
    const slots = rest(16);
    slots[0] = { notes: [{ pitch: "E2" }, { pitch: "F2" }] };
    expect(stringCollisions(fixture(slots))).toEqual([]);
  });

  it("can be asked about one track", () => {
    expect(stringCollisions(collided(), "other")).toEqual([]);
    expect(stringCollisions(collided(), TRACK)).toHaveLength(1);
  });
});

describe("collisionsIntroduced", () => {
  it("reports a collision an edit added", () => {
    expect(collisionsIntroduced(clean(), collided())).toHaveLength(1);
  });

  /*
   * The whole rule is the difference. A song that arrived with a problem
   * keeps it until somebody chooses to fix it; an edit may not add one.
   */
  it("says nothing about a collision the song already had", () => {
    expect(collisionsIntroduced(collided(), collided())).toEqual([]);
  });

  it("still catches a second collision beside an inherited one", () => {
    const before = collided(0);
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "F2", position: { string: 0, fret: 1 } },
      ],
    };
    slots[8] = {
      notes: [
        { pitch: "B3", position: { string: 4, fret: 0 } },
        { pitch: "C4", position: { string: 4, fret: 1 } },
      ],
    };
    const added = collisionsIntroduced(before, fixture(slots));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ slotIndex: 8, stringIndex: 4 });
  });

  it("says nothing when an edit removed one", () => {
    expect(collisionsIntroduced(collided(), clean())).toEqual([]);
  });
});
