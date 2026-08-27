/**
 * One tool at a time, and it never leaves the session (2S-A §6).
 */
import { describe, expect, it } from "vitest";

import {
  DOOR_LABELS,
  NO_TOOL,
  activate,
  doorAccessibleName,
  doorLabel,
  doorOf,
  hintKey,
  isArmed,
  releasedOn,
  sameTool,
  toolHint,
  toolLabel,
  type ComposerTool,
  type ToolReleaseReason,
} from "@/lib/workspace/composer-tool";

const EVERY_TOOL: readonly ComposerTool[] = [
  { kind: "note" },
  { kind: "power_chord", voices: 2, fret: 5 },
  { kind: "power_chord", voices: 3, fret: 5 },
  { kind: "connect", connection: "auto" },
  { kind: "connect", connection: "hammer_on" },
  { kind: "connect", connection: "pull_off" },
  { kind: "continue_pattern", mode: "repeat" },
  { kind: "continue_pattern", mode: "shape" },
  { kind: "continue_pattern", mode: "pitch" },
];

describe("302. exactly one tool is held", () => {
  it("starts holding nothing", () => {
    expect(isArmed(NO_TOOL)).toBe(false);
    expect(doorOf(NO_TOOL)).toBeNull();
  });

  it("replaces the tool rather than adding to it", () => {
    let held: ComposerTool = NO_TOOL;
    for (const tool of EVERY_TOOL) {
      held = activate(held, tool);
      expect(held).toEqual(tool);
    }
  });

  it("puts a tool down when it is picked up again", () => {
    for (const tool of EVERY_TOOL) {
      expect(activate(tool, tool)).toEqual(NO_TOOL);
    }
  });

  it("tells two frets of the same pen apart", () => {
    const fifth: ComposerTool = { kind: "power_chord", voices: 2, fret: 5 };
    const seventh: ComposerTool = { kind: "power_chord", voices: 2, fret: 7 };
    expect(sameTool(fifth, seventh)).toBe(false);
    expect(activate(fifth, seventh)).toEqual(seventh);
  });

  it("tells two settings of the same tool apart", () => {
    const two: ComposerTool = { kind: "power_chord", voices: 2, fret: 5 };
    const three: ComposerTool = { kind: "power_chord", voices: 3, fret: 5 };
    expect(sameTool(two, three)).toBe(false);
    expect(activate(two, three)).toEqual(three);
  });

  it("lets go on every reason a tool must not survive", () => {
    const reasons: readonly ToolReleaseReason[] = [
      "track_changed",
      "section_changed",
      "project_changed",
      "editing_ended",
    ];
    for (const reason of reasons) {
      expect(releasedOn(reason), reason).toEqual(NO_TOOL);
    }
  });
});

describe("303. every tool came through a door, and no door is empty", () => {
  it("puts each tool behind exactly one door", () => {
    for (const tool of EVERY_TOOL) {
      const door = doorOf(tool);
      expect(door, toolLabel(tool)).not.toBeNull();
      expect(DOOR_LABELS[door!]).toBeTruthy();
    }
  });

  it("names the four doors in Turkish", () => {
    expect(DOOR_LABELS).toEqual({
      note: "Nota",
      shape: "Şekil",
      rhythm: "Ritim",
      connect: "Bağla",
    });
  });

  it("has at least one tool behind every door", () => {
    const doors = new Set(EVERY_TOOL.map((tool) => doorOf(tool)));
    expect(doors).toEqual(new Set(["note", "shape", "connect", "rhythm"]));
  });
});

describe("304. what a tool says to somebody who does not read notation", () => {
  it("names every tool in Turkish, about music", () => {
    for (const tool of EVERY_TOOL) {
      const label = toolLabel(tool);
      expect(label, tool.kind).toBeTruthy();
      expect(label).not.toMatch(/hammer_on|pull_off|continue_pattern|power_chord/);
    }
  });

  it("says nothing at all when nothing is held", () => {
    expect(toolLabel(NO_TOOL)).toBe("");
  });

  it("explains what will happen, without a musical term to look up", () => {
    expect(toolHint({ kind: "connect", connection: "hammer_on" })).toBe(
      "Sağ elinle tekrar vurmadan daha yüksek notaya geç.",
    );
    expect(toolHint({ kind: "power_chord", voices: 2, fret: 5 })).toBe(
      "Bastığın perde kök olur, üstüne beşlisi eklenir.",
    );
  });

  it("has an explanation for every tool a door can hand out", () => {
    for (const tool of EVERY_TOOL) {
      if (tool.kind === "note") continue;
      expect(toolHint(tool), hintKey(tool)).toBeTruthy();
    }
  });

  it("never lets an identifier into an explanation", () => {
    for (const tool of EVERY_TOOL) {
      const hint = toolHint(tool);
      if (hint) expect(hint).not.toMatch(/hammer_on|pull_off|_|tick|slot/i);
    }
  });
});

describe("K-59: a held tool is written on its own door", () => {
  it("leaves an unheld door its own name", () => {
    for (const door of ["note", "shape", "rhythm", "connect"] as const) {
      expect(doorLabel(door, NO_TOOL)).toBe(DOOR_LABELS[door]);
      expect(doorAccessibleName(door, NO_TOOL)).toBe(DOOR_LABELS[door]);
    }
  });

  it("names the held tool on the door it came through, and nowhere else", () => {
    const pen: ComposerTool = { kind: "power_chord", voices: 3, fret: 5 };
    expect(doorLabel("shape", pen)).toBe("Power 3");
    expect(doorLabel("note", pen)).toBe("Nota");
    expect(doorLabel("rhythm", pen)).toBe("Ritim");
    expect(doorLabel("connect", pen)).toBe("Bağla");
  });

  it("says the whole sentence to a screen reader", () => {
    const brush: ComposerTool = { kind: "connect", connection: "auto" };
    expect(doorLabel("connect", brush)).toBe("Otomatik");
    expect(doorAccessibleName("connect", brush)).toBe("Bağla: Otomatik bağla");
  });

  it("keeps every short label short enough for the narrowest door", () => {
    /*
     * Four doors share a 320px row. A label that had to be truncated would be
     * a tool the reader cannot identify, which is worse than the door's own
     * name — so the short forms are bounded here rather than by a CSS ellipsis.
     */
    const tools: ComposerTool[] = [
      { kind: "note" },
      { kind: "power_chord", voices: 2, fret: 0 },
      { kind: "power_chord", voices: 3, fret: 12 },
      { kind: "connect", connection: "auto" },
      { kind: "connect", connection: "hammer_on" },
      { kind: "connect", connection: "pull_off" },
      { kind: "continue_pattern", mode: "repeat" },
      { kind: "continue_pattern", mode: "shape" },
      { kind: "continue_pattern", mode: "pitch" },
    ];
    for (const tool of tools) {
      const door = doorOf(tool);
      if (!door) continue;
      expect(doorLabel(door, tool).length).toBeLessThanOrEqual(8);
      expect(doorAccessibleName(door, tool)).toContain(toolLabel(tool));
    }
  });
});
