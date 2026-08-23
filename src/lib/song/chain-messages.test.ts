/**
 * The words the chain decision is made in (spec 13.20 §2).
 *
 * A reader who does not read music has nothing to check these sentences
 * against except the sentence itself, so the thing being pinned is that each
 * one describes **this** command rather than commands in general. The bug this
 * file exists to prevent already happened once: a single generic line said the
 * connection "moves together" under a button that deletes.
 */
import { describe, expect, it } from "vitest";

import {
  chainDetachExplain,
  chainImpactTitle,
  chainIncludeExplain,
  chainOptionLabel,
} from "@/lib/song/chain-messages";
import type { ChainImpact, ChainImpactKind } from "@/lib/song/chain-preflight";
import type { TransformCommand } from "@/lib/song/transform";

const KINDS: TransformCommand["kind"][] = [
  "copy_selection",
  "cut_selection",
  "delete_selection",
  "paste_selection",
  "duplicate_selection",
  "move_selection_time",
  "repeat_selection",
  "transpose_pitch",
  "restring_same_pitch",
  "translate_fret_shape",
];

const impact = (
  kind: ChainImpactKind,
  boundaryKinds: ("tie" | "legato")[] = ["legato"],
): ChainImpact => ({
  kind,
  boundaries: boundaryKinds.map((entry) => ({
    kind: entry,
    side: "start" as const,
    crossesSection: false,
    inside: { barIndex: 0, slotIndex: 1 },
    outside: { barIndex: 0, slotIndex: 0 },
  })),
  selection: { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: 96 },
  expanded: { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: 192 },
  startsInsideTie: false,
  detach: [],
});

describe("92. the whole-chain sentence describes the command it sits under", () => {
  it("says what will happen, in this command's own verb", () => {
    expect(chainIncludeExplain("delete_selection", "6 nota · 2 ölçü")).toBe(
      "Bağlantının tamamı birlikte silinir: 6 nota · 2 ölçü.",
    );
    expect(chainIncludeExplain("move_selection_time", "6 nota · 2 ölçü")).toBe(
      "Bağlantının tamamı birlikte taşınır: 6 nota · 2 ölçü.",
    );
    expect(chainIncludeExplain("copy_selection", "6 nota")).toBe(
      "Bağlantının tamamı kopyalanır: 6 nota.",
    );
    expect(chainIncludeExplain("transpose_pitch", "6 nota")).toBe(
      "Bağlantının tamamının sesi değişir: 6 nota.",
    );
    expect(chainIncludeExplain("translate_fret_shape", "6 nota")).toBe(
      "Bağlantının tamamının şekli taşınır: 6 nota.",
    );
  });

  it("never promises movement under a command that does not move anything", () => {
    /*
     * The exact regression. "Hareket eder" under Sil told a reader their music
     * would end up somewhere else; it ends up nowhere.
     */
    for (const kind of ["delete_selection", "copy_selection", "transpose_pitch"] as const) {
      expect(chainIncludeExplain(kind, "x"), kind).not.toContain("hareket");
    }
  });

  it("has a distinct sentence for every command, and none of them is empty", () => {
    const sentences = KINDS.map((kind) => chainIncludeExplain(kind, "x"));
    for (const sentence of sentences) {
      expect(sentence.length).toBeGreaterThan(20);
      expect(sentence.endsWith("x.")).toBe(true);
    }
    // Deleting and cutting are genuinely different acts, and so are the three
    // that all read "taşı" on their buttons; the explanations separate them.
    expect(new Set(sentences).size).toBeGreaterThanOrEqual(9);
  });

  it("always says how much music it means", () => {
    // The real widened scope, not a reassurance that the option is safe.
    expect(chainIncludeExplain("delete_selection", "3 nota · 1 ölçü")).toContain(
      "3 nota · 1 ölçü",
    );
  });
});

describe("93. the option labels read as Turkish, and say what is held", () => {
  it("calls a chord a chord and anything else a selection", () => {
    expect(chainOptionLabel("detach_boundary", "move_selection_time", true)).toBe(
      "Yalnız akoru taşı",
    );
    expect(chainOptionLabel("detach_boundary", "move_selection_time", false)).toBe(
      "Yalnız seçimi taşı",
    );
    expect(chainOptionLabel("include_chain", "delete_selection", true)).toBe(
      "Bağlantıyla birlikte sil",
    );
  });

  it("names the connections that would be removed, not just 'connections'", () => {
    const legato = chainDetachExplain(impact("crosses_legato_boundary"), true);
    expect(legato).toContain("slide");
    expect(legato).toContain("hammer-on");
    expect(legato).toContain("pull-off");

    const tie = chainDetachExplain(impact("crosses_tie_boundary", ["tie"]), true);
    expect(tie).toContain("uzatma");
    expect(tie).not.toContain("slide");

    const both = chainDetachExplain(
      impact("crosses_multiple_boundaries", ["tie", "legato"]),
      false,
    );
    expect(both).toContain("uzatma");
    expect(both).toContain("slide");
    expect(both).toContain("seçim");
  });

  it("has a heading for every impact that can reach the screen", () => {
    for (const kind of [
      "crosses_tie_boundary",
      "crosses_legato_boundary",
      "crosses_multiple_boundaries",
      "crosses_section_boundary",
    ] as const) {
      expect(chainImpactTitle(impact(kind)).length, kind).toBeGreaterThan(10);
    }
    // Nothing is being cut, so there is nothing to head.
    expect(chainImpactTitle(impact("no_chain_impact"))).toBe("");
  });

  it("leaks no code, tick or internal name into any sentence", () => {
    const all = [
      ...KINDS.map((kind) => chainIncludeExplain(kind, "3 nota")),
      chainDetachExplain(impact("crosses_multiple_boundaries", ["tie", "legato"]), true),
      chainImpactTitle(impact("crosses_legato_boundary")),
    ];
    for (const sentence of all) {
      expect(sentence).not.toMatch(/crosses_|_boundary|_selection|tick|slot/);
    }
  });
});
