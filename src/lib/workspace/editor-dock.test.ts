/**
 * The one shelf, and the vocabulary on it (2W §8, §9).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DOCK_GROUPS,
  DOCK_GROUP_LABEL,
  dockGroupItems,
  dockReason,
  editorDock,
} from "@/lib/workspace/editor-dock";
import { NO_TOOL } from "@/lib/workspace/composer-tool";
import type { SelectionActionOffer } from "@/lib/song/selection-action-canon";

const offer = (
  id: SelectionActionOffer["id"],
  over: Partial<SelectionActionOffer> = {},
): SelectionActionOffer =>
  ({
    id,
    label: id,
    hint: "",
    verb: null,
    placement: "row",
    availability: "available",
    opens: "immediate",
    ...over,
  }) as SelectionActionOffer;

describe("the four words", () => {
  it("never changes them and never adds a fifth", () => {
    expect(DOCK_GROUPS).toEqual(["ses", "ritim", "calim", "secim"]);
    expect(Object.values(DOCK_GROUP_LABEL)).toEqual(["Ses", "Ritim", "Çalım", "Seçim"]);
  });

  it("shows the same four with nothing held and with a run held", () => {
    /*
     * The property the two-row design could not have: the shelf keeps its
     * identity across the gesture. Before this, tapping gave four doors and
     * long-pressing replaced them with seven unrelated verbs.
     */
    const empty = editorDock({ offers: [], tool: NO_TOOL, hasSelection: false });
    const holding = editorDock({
      offers: [offer("copy"), offer("delete"), offer("listen_once")],
      tool: NO_TOOL,
      hasSelection: true,
    });
    expect(empty.groups).toEqual(["ses", "ritim", "calim"]);
    expect(holding.groups).toEqual(["ses", "ritim", "calim", "secim"]);
    /* The doors never leave; the selection shelf is added beside them. */
    for (const group of empty.groups) expect(holding.groups).toContain(group);
  });
});

describe("where each tool lives", () => {
  const model = editorDock({
    offers: [
      offer("copy"),
      offer("cut"),
      offer("duplicate"),
      offer("repeat"),
      offer("move"),
      offer("delete"),
      offer("extend"),
      offer("connect"),
      offer("paste"),
      offer("listen_once"),
      offer("listen_loop"),
      offer("more"),
    ],
    tool: NO_TOOL,
    hasSelection: true,
  });

  const idsIn = (group: Parameters<typeof dockGroupItems>[1]) =>
    dockGroupItems(model, group).map((item) => item.id);

  it("puts making a sound under Ses", () => {
    expect(idsIn("ses")).toEqual(["door:note", "door:shape"]);
  });

  it("puts how long and how often under Ritim", () => {
    expect(idsIn("ritim")).toContain("door:rhythm");
    expect(idsIn("ritim")).toContain("action:extend");
    expect(idsIn("ritim")).toContain("action:repeat");
  });

  it("puts how it is played under Çalım", () => {
    expect(idsIn("calim")).toContain("door:connect");
    expect(idsIn("calim")).toContain("action:connect");
  });

  it("puts what to do with the held run under Seçim", () => {
    for (const id of ["copy", "cut", "duplicate", "move", "delete", "paste", "listen_once", "listen_loop"]) {
      expect(idsIn("secim"), id).toContain(`action:${id}`);
    }
  });

  it("gives every item exactly one group", () => {
    const counted = model.items.map((item) => item.id);
    expect(new Set(counted).size).toBe(counted.length);
    const across = DOCK_GROUPS.flatMap((group) => idsIn(group));
    expect(across.length).toBe(model.items.length);
  });
});

describe("what opens first", () => {
  it("opens the held tool's own shelf", () => {
    const model = editorDock({
      offers: [],
      tool: { kind: "continue_pattern", mode: "exact" } as never,
      hasSelection: false,
    });
    expect(model.suggested).toBe("ritim");
  });

  it("opens Seçim when a run is held and no tool is", () => {
    const model = editorDock({
      offers: [offer("copy")],
      tool: NO_TOOL,
      hasSelection: true,
    });
    expect(model.suggested).toBe("secim");
  });

  it("opens Ses on a blank bar with nothing held", () => {
    expect(editorDock({ offers: [], tool: NO_TOOL, hasSelection: false }).suggested).toBe(
      "ses",
    );
  });
});

describe("a greyed control always says why", () => {
  it("carries the model's own sentence", () => {
    const model = editorDock({
      offers: [
        offer("paste", { availability: "disabled", reason: "Panoda bir şey yok." }),
      ],
      tool: NO_TOOL,
      hasSelection: true,
    });
    const paste = model.items.find((item) => item.id === "action:paste")!;
    expect(paste.state).toBe("disabled");
    expect(dockReason(paste)).toBe("Panoda bir şey yok.");
  });

  it("never leaves a disabled control silent", () => {
    /* The state §14 forbids: grey, and no explanation anywhere. */
    const model = editorDock({
      offers: [offer("move", { availability: "disabled" })],
      tool: NO_TOOL,
      hasSelection: true,
    });
    const move = model.items.find((item) => item.id === "action:move")!;
    expect(dockReason(move)).not.toBeNull();
    expect(dockReason(move)!.length).toBeGreaterThan(0);
  });

  it("says nothing about an available control", () => {
    const model = editorDock({ offers: [offer("copy")], tool: NO_TOOL, hasSelection: true });
    expect(dockReason(model.items.find((item) => item.id === "action:copy")!)).toBeNull();
  });
});

describe("the words the reader reads", () => {
  it("never says slot, tick or a verb id", () => {
    const model = editorDock({
      offers: [offer("copy", { label: "Kopyala" }), offer("more", { label: "Daha fazla" })],
      tool: NO_TOOL,
      hasSelection: true,
    });
    for (const item of model.items) {
      expect(item.label.toLowerCase()).not.toContain("slot");
      expect(item.label.toLowerCase()).not.toContain("tick");
      expect(item.label).not.toMatch(/^(copy|cut|paste|delete|move)$/i);
    }
  });

  it("no longer offers a door called Şekil", () => {
    /*
     * "Şekil" named nothing musical. What is behind it — the power chord pen
     * and the chord builder — are sounds, so it lives under Ses and the
     * reader meets a word that means something.
     */
    const model = editorDock({ offers: [], tool: NO_TOOL, hasSelection: false });
    const shape = model.items.find((item) => item.id === "door:shape")!;
    expect(shape.group).toBe("ses");
  });
});

describe("the shelf never covers the music", () => {
  it("is drawn in the flow, with no way to float over the grid", () => {
    /*
     * A source rule rather than a screenshot, because the invariant is
     * structural: a shelf that is `fixed` or `absolute` sits over the staff
     * whatever its height, and the reader loses the notes they are editing.
     * The browser check measures the same thing with `elementFromPoint`; this
     * one fails at the moment somebody types the class.
     */
    const source = readFileSync("src/components/workspace/EditorDock.tsx", "utf8");
    for (const banned of ["fixed", "absolute", "inset-0", "z-50", "backdrop"]) {
      expect(source, banned).not.toMatch(new RegExp(`className=[^\\n]*\\b${banned}\\b`));
    }
  });

  it("keeps its open group's controls on one scrolling row", () => {
    /* Wrapping is how a six-control group would push the grid up. */
    const source = readFileSync("src/components/workspace/EditorDock.tsx", "utf8");
    expect(source).toContain("overflow-x-auto");
    expect(source).not.toContain("flex-wrap gap-1.5\"");
  });
});
