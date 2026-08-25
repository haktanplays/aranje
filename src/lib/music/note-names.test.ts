/**
 * A pitch in the reader's own words (2Q-B §7.2, §14).
 *
 * The claim under test is not "the table is spelled right" — it is that the
 * helper never re-spells the song: an enharmonic is reported as it was
 * written, because the reader's file said one of the two.
 */
import { describe, expect, it } from "vitest";

import { describePitch, spokenPitch } from "@/lib/music/note-names";

describe("220. saying a pitch out loud", () => {
  it("says the natural letters in solfege", () => {
    expect(spokenPitch("A3")?.spoken).toBe("La");
    expect(spokenPitch("C4")?.spoken).toBe("Do");
    expect(spokenPitch("G2")?.spoken).toBe("Sol");
  });

  it("keeps the accidental the song wrote, and never re-spells it", () => {
    expect(spokenPitch("A#3")?.spoken).toBe("La diyez");
    expect(spokenPitch("Bb3")?.spoken).toBe("Si bemol");
    // Same key on a keyboard, different notes on a page.
    expect(spokenPitch("A#3")?.spoken).not.toBe(spokenPitch("Bb3")?.spoken);
  });

  it("reports the technical name unchanged, because that is what is stored", () => {
    expect(spokenPitch("C#4")?.technical).toBe("C#4");
    expect(spokenPitch("C#4")?.octave).toBe(4);
  });

  it("reads the contract's lowest octave rather than treating it as invalid", () => {
    expect(spokenPitch("C-1")?.octave).toBe(-1);
  });

  it("refuses anything that is not a pitch", () => {
    expect(spokenPitch("H4")).toBeNull();
    expect(spokenPitch("A")).toBeNull();
    expect(spokenPitch("")).toBeNull();
    expect(describePitch("nope")).toBeNull();
  });

  it("writes the one line the note sheet shows", () => {
    expect(describePitch("A3")).toBe("Nota: La · Teknik: A3 · Oktav: 3");
    expect(describePitch("Eb2")).toBe("Nota: Mi bemol · Teknik: Eb2 · Oktav: 2");
  });
});
