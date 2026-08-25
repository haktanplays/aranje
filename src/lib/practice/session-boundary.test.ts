/**
 * What a practice session may never reach (2R-A §VII, §XI, §XII).
 *
 * The rule is one sentence: a practice loop is something the reader is doing
 * right now, not something the song *is*. So none of it — the range, the
 * count-in, the speed plan, the completed-pass count — may appear in the Song
 * Contract, in storage, in a project file, in an export, in a fingerprint, in
 * history or in a Copilot request.
 *
 * These are structural checks, not greps. The first group reads the actual
 * exported shapes and asks whether a practice field could even be represented;
 * the second runs real edits through the real gate and compares bytes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { songSchema, type Song } from "@/lib/song/schema";
import { settle } from "@/lib/song/edit";
import { insertDrumHit } from "@/lib/song/event-entry";
import { canonicalJson } from "@/lib/copilot/fingerprint";
import { createEditHistory, recordEdit, currentSong } from "@/lib/song/edit-history";
import { NO_LOOP, loopBounds, planOf, practiceRange } from "@/lib/practice/range";
import { DEFAULT_COUNT_IN } from "@/lib/practice/count-in";
import { drumTrack, guitarTrack, section, song } from "@/lib/song/fixtures";
import { slotCount } from "@/lib/music/timing";
import type { Bar, Resolution, TimeSignature } from "@/lib/song/schema";

const kitBar = (meter: TimeSignature = [4, 4], resolution: Resolution = 8): Bar => ({
  timeSignature: meter,
  resolution,
  slots: {
    gtr: Array.from({ length: slotCount(meter, resolution) }, () => null),
    drums: Array.from({ length: slotCount(meter, resolution) }, () => []),
  },
});

const SONG: Song = songSchema.parse(
  song([guitarTrack(), drumTrack()], [
    section([kitBar(), kitBar(), kitBar(), kitBar()], { id: "one", name: "Bir" }),
    section([kitBar([3, 4], 16), kitBar([3, 4], 16)], { id: "two", name: "İki" }),
  ]),
);

/** Every word a practice session knows, that the contract must not. */
const PRACTICE_FIELDS = [
  "practiceRange",
  "practiceStart",
  "practiceEnd",
  "countIn",
  "countInBars",
  "progressive",
  "progressiveRate",
  "repeatsPerStep",
  "completedLoops",
  "loopsAtThisSpeed",
  "practiceActive",
  "clip",
  "loopStart",
  "loopEnd",
] as const;

describe("276. the Song Contract has no room for a practice session", () => {
  it("rejects every practice field the schema could be asked to carry", () => {
    /*
     * The schema is strict, so an unknown key is a parse failure rather than
     * something quietly dropped. That is the guarantee: a practice field
     * cannot be written to a song even by accident.
     */
    for (const field of PRACTICE_FIELDS) {
      const contaminated = { ...SONG, [field]: 1 };
      expect(songSchema.safeParse(contaminated).success, field).toBe(false);
    }
  });

  it("rejects them on a section and on a bar too", () => {
    for (const field of PRACTICE_FIELDS) {
      const onSection = {
        ...SONG,
        sections: [{ ...SONG.sections[0]!, [field]: 1 }, ...SONG.sections.slice(1)],
      };
      expect(songSchema.safeParse(onSection).success, `section.${field}`).toBe(false);

      const bars = SONG.sections[0]!.bars;
      const onBar = {
        ...SONG,
        sections: [
          { ...SONG.sections[0]!, bars: [{ ...bars[0]!, [field]: 1 }, ...bars.slice(1)] },
          ...SONG.sections.slice(1),
        ],
      };
      expect(songSchema.safeParse(onBar).success, `bar.${field}`).toBe(false);
    }
  });

  it("keeps the practice modules out of the contract's own file", () => {
    /*
     * A structural check on the dependency direction: the schema is the
     * contract, and a contract that imported the practice session would be
     * one that could grow a field for it.
     */
    const source = readFileSync("src/lib/song/schema.ts", "utf8");
    expect(source).not.toContain("@/lib/practice");
  });
});

describe("277. a practice session changes no byte of the song", () => {
  const range = (() => {
    const made = practiceRange(SONG, "one:1", "one:2");
    if (!made.ok) throw new Error("fixture");
    return made.range;
  })();

  it("leaves the song identical after a range, a loop and a plan", () => {
    const before = JSON.stringify(SONG);
    loopBounds(planOf(SONG), { kind: "practice_range", range });
    loopBounds(planOf(SONG), { kind: "section", sectionId: "two" });
    loopBounds(planOf(SONG), NO_LOOP);
    expect(JSON.stringify(SONG)).toBe(before);
  });

  it("leaves the canonical form the fingerprint is taken from identical", () => {
    /*
     * `requestFingerprint` hashes `canonicalJson`, so the canonical text is
     * what a fingerprint can possibly differ on. Comparing it directly is
     * both cheaper and stricter than comparing two hashes.
     */
    const before = canonicalJson(SONG);
    loopBounds(planOf(SONG), { kind: "practice_range", range });
    expect(canonicalJson(SONG)).toBe(before);
    for (const field of PRACTICE_FIELDS) {
      expect(before, field).not.toContain(`"${field}"`);
    }
  });

  it("adds no history step", () => {
    const history = createEditHistory(SONG);
    loopBounds(planOf(SONG), { kind: "practice_range", range });
    expect(history.snapshots).toHaveLength(1);
    expect(history.cursor).toBe(0);
    expect(currentSong(history)).toBe(SONG);
  });

  it("does not change what an ordinary edit commits", () => {
    /*
     * The claim that matters for the reader: practising does not alter what
     * an edit *is*. The same command on the same song produces the same bytes
     * whether or not a loop is set, because the loop is not an input to it.
     */
    const target = { trackId: "drums", sectionId: "one", ticks: 0 };
    const plain = insertDrumHit(SONG, target, { piece: "kick" });
    loopBounds(planOf(SONG), { kind: "practice_range", range });
    const whilePractising = insertDrumHit(SONG, target, { piece: "kick" });
    expect(plain.ok && whilePractising.ok).toBe(true);
    if (plain.ok && whilePractising.ok) {
      expect(JSON.stringify(whilePractising.song)).toBe(JSON.stringify(plain.song));
    }
  });

  it("still writes exactly one history step for that edit", () => {
    const target = { trackId: "drums", sectionId: "one", ticks: 0 };
    const result = insertDrumHit(SONG, target, { piece: "kick" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const settled = settle(result.song);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    const history = recordEdit(createEditHistory(SONG), settled.song, {
      kind: "drum_entry",
      command: "insert",
    });
    expect(history.snapshots).toHaveLength(2);
    expect(history.cursor).toBe(1);
  });

  it("carries nothing practice-shaped into the committed song", () => {
    const target = { trackId: "drums", sectionId: "one", ticks: 0 };
    const result = insertDrumHit(SONG, target, { piece: "kick" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.song);
    for (const field of PRACTICE_FIELDS) {
      expect(text, field).not.toContain(`"${field}"`);
    }
  });
});

describe("278. one loop at a time, and it is typed", () => {
  const range = (() => {
    const made = practiceRange(SONG, "one:0", "one:1");
    if (!made.ok) throw new Error("fixture");
    return made.range;
  })();
  const plan = planOf(SONG);

  it("cannot be a section and a practice range at once", () => {
    /*
     * Not by convention: by construction. `PlaybackLoop` is a union, so there
     * is no value that is both — which is the whole reason it replaced a
     * nullable section id and a would-be second flag.
     */
    const asSection = { kind: "section", sectionId: "one" } as const;
    const asRange = { kind: "practice_range", range } as const;
    expect(asSection.kind).not.toBe(asRange.kind);
    expect(loopBounds(plan, asSection)).not.toEqual(loopBounds(plan, asRange));
  });

  it("gives the section loop the whole section and the range only its bars", () => {
    const whole = loopBounds(plan, { kind: "section", sectionId: "one" });
    const part = loopBounds(plan, { kind: "practice_range", range });
    expect(whole).not.toBeNull();
    expect(part).not.toBeNull();
    expect(part!.endTicks).toBeLessThan(whole!.endTicks);
    expect(part!.startTicks).toBe(whole!.startTicks);
  });

  it("has exactly one way to mean no loop", () => {
    expect(loopBounds(plan, NO_LOOP)).toBeNull();
    expect(NO_LOOP.kind).toBe("none");
  });

  it("starts a session with no loop and no count-in", () => {
    expect(NO_LOOP.kind).toBe("none");
    expect(DEFAULT_COUNT_IN).toBe(0);
  });
});
