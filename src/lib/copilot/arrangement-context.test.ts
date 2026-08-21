/**
 * What a turn can see of the rest of the piece (spec 11.5, K-32).
 *
 * The rule is unchanged in spirit — a role sees what it needs and nothing
 * else — and changed in reach: it now sees the *shape* of the piece, which is
 * the input S-01 was missing when it was asked to develop a motif it had no
 * way to look at.
 */
import { describe, expect, it } from "vitest";

import { buildArrangementContext } from "@/lib/copilot/arrangement-context";
import { ARRANGE_SKILLS, type ArrangeSkill } from "@/lib/copilot/contract";
import { songSchema, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const GUITAR = SAMPLE_SONG.tracks.find((t) => t.id === "gtr");
const DRUMS = SAMPLE_SONG.tracks.find((t) => t.id === "drums");
const BASS = SAMPLE_SONG.tracks.find((t) => t.id === "bass");
if (!GUITAR || !DRUMS || !BASS) throw new Error("fixture");

const note = (pitch: string) => ({ notes: [{ pitch }] });

/** Two sections: the first has a guitar and drums, the second only guitar. */
function twoSections(): Song {
  const melodic = (pitches: readonly string[]) =>
    Array.from({ length: 8 }, (_, i) =>
      pitches[i] === undefined ? null : note(pitches[i]!),
    );
  const drumSlots = () =>
    Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? [{ piece: "kick" }] : []));

  const parsed = songSchema.safeParse({
    version: 2,
    title: "context fixture",
    bpm: 120,
    key: "E minor",
    tracks: [GUITAR, DRUMS, BASS],
    sections: [
      {
        id: "one",
        name: "One",
        status: "fixed",
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: melodic(["E2", "G2"]), drums: drumSlots() },
          },
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: melodic(["A2", "B2"]), drums: drumSlots() },
          },
        ],
      },
      {
        id: "two",
        name: "Two",
        status: "fixed",
        bpmOverride: 90,
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: melodic(["D3"]), drums: drumSlots() },
          },
        ],
      },
    ],
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

const context = (role: ArrangeSkill, sectionId: string, trackId: string) =>
  buildArrangementContext(twoSections(), sectionId, trackId, role);

describe("the shape of the piece", () => {
  it("lists every section, with its own tempo and which one is the target", () => {
    const ctx = context("drums", "two", "drums");
    expect(ctx?.form.map((f) => f.id)).toEqual(["one", "two"]);
    expect(ctx?.form.map((f) => f.bpm)).toEqual([120, 90]);
    expect(ctx?.form.filter((f) => f.target).map((f) => f.id)).toEqual(["two"]);
  });

  it("says how long the piece is and where this section starts", () => {
    const ctx = context("drums", "two", "drums");
    // Two bars at 120 = 4s, then one at 90.
    expect(ctx?.targetStartSeconds).toBeCloseTo(4, 6);
    expect(ctx?.totalSeconds).toBeCloseTo(4 + (4 * 60) / 90, 6);
  });

  it("shows where the previous section landed", () => {
    const ctx = context("acoustic_guitar", "two", "gtr");
    // The last bar of the previous section, from the guitar that played it.
    expect(ctx?.previousLanding.join(" ")).toContain("A2");
    expect(ctx?.previousLanding.join(" ")).toContain("B2");
    // Not the whole section: only its last bar.
    expect(ctx?.previousLanding.join(" ")).not.toContain("E2");
  });

  it("shows how the target track itself left off", () => {
    const ctx = context("rhythm_guitar", "two", "gtr");
    expect(ctx?.targetPreviously.join(" ")).toContain("A2");
  });

  it("gives the first section no previous landing to lean on", () => {
    const ctx = context("rhythm_guitar", "one", "gtr");
    expect(ctx?.previousLanding).toEqual([]);
    expect(ctx?.targetPreviously).toEqual([]);
  });
});

describe("who may read what (data minimisation)", () => {
  it("never gives a drum turn a pitch", () => {
    const ctx = context("drums", "one", "drums");
    const text = JSON.stringify(ctx?.sources);
    for (const pitch of ["E2", "G2", "A2", "B2", "D3"]) {
      expect(text).not.toContain(pitch);
    }
    // But it does get the rhythm it has to sit on.
    expect(text).toContain("ritim (gtr)");
  });

  it("gives a rhythm turn the groove and not the lead's detail", () => {
    const ctx = context("rhythm_guitar", "one", "gtr");
    const labels = ctx?.sources.map((s) => s.label) ?? [];
    expect(labels).toEqual(["ritim (drums)"]);
  });

  it("gives a lead turn what it plays over", () => {
    const ctx = context("lead_guitar", "one", "bass");
    const labels = ctx?.sources.map((s) => s.label) ?? [];
    expect(labels).toContain("gitar (gtr)");
  });

  it("gives a bass turn the guitar's pitches and the drums' rhythm", () => {
    const ctx = context("bass", "one", "bass");
    const labels = ctx?.sources.map((s) => s.label) ?? [];
    expect(labels).toEqual(["gitar (gtr)", "ritim (drums)"]);
  });

  it("never shows a track itself as its own source", () => {
    for (const role of ARRANGE_SKILLS) {
      const ctx = context(role, "one", "gtr");
      const labels = ctx?.sources.map((s) => s.label) ?? [];
      expect(labels.some((l) => l.includes("(gtr)"))).toBe(false);
    }
  });

  it("never carries a whole other section's content", () => {
    // The landing is one bar, and nothing else from elsewhere travels.
    for (const role of ARRANGE_SKILLS) {
      const ctx = context(role, "two", "gtr");
      expect(ctx?.previousLanding.length).toBeLessThanOrEqual(1);
      expect(ctx?.targetPreviously.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("refusals", () => {
  it("returns nothing for a section that is not in the song", () => {
    expect(context("drums", "nowhere", "drums")).toBeNull();
  });

  it("returns nothing for a track that is not in the song", () => {
    expect(context("drums", "one", "nobody")).toBeNull();
  });
});

describe("source context comes from what is actually sounding (K-35)", () => {
  /**
   * A song whose second guitar exists but plays nothing in the section.
   *
   * This is the shape S-03 hit: `guitars.slice(0, 1)` handed the harmony turn
   * a guitar that was silent for the whole section and told it not to cover a
   * part it could not hear. The fixture has to contain that silent track, or
   * the test proves nothing.
   */
  function withSilentGuitar(): Song {
    const acoustic = { ...GUITAR!, id: "acc", instrumentId: "steel_acoustic" };
    const base = twoSections();
    return songSchema.parse({
      ...base,
      tracks: [...base.tracks, acoustic],
    });
  }

  const sourcesFrom = (skill: ArrangeSkill, targetTrackId: string) =>
    buildArrangementContext(withSilentGuitar(), "one", targetTrackId, skill)
      ?.sources.map((source) => source.label) ?? [];

  it("the fixture really does carry a silent second guitar", () => {
    const song = withSilentGuitar();
    expect(song.tracks.some((track) => track.id === "acc")).toBe(true);
    const section = song.sections.find((s) => s.id === "one");
    expect(section?.bars.every((bar) => bar.slots.acc === undefined)).toBe(true);
  });

  it("never offers a track that is silent in the target section", () => {
    for (const [skill, target] of [
      ["lead_guitar", "gtr"],
      ["rhythm_guitar", "gtr"],
      ["harmony", "gtr"],
      ["bass", "bass"],
    ] as const) {
      expect(sourcesFrom(skill, target)).not.toContain("gitar (acc)");
    }
  });

  it("still keeps pitch away from a drum turn", () => {
    const ctx = buildArrangementContext(withSilentGuitar(), "one", "drums", "drums");
    const text = JSON.stringify(ctx?.sources);
    for (const pitch of ["E2", "G2", "A2", "B2", "D3"]) {
      expect(text).not.toContain(pitch);
    }
  });

  it("gives a riff turn the groove", () => {
    expect(sourcesFrom("rhythm_guitar", "gtr")).toContain("ritim (drums)");
  });
});
