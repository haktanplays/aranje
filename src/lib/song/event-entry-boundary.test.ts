/**
 * Where writing one event is allowed to live (2Q-B §13).
 *
 * The tab already had a shape of defect this checkpoint had to avoid
 * repeating: a command that knew about strings, living close enough to the
 * component that a second surface grew its own copy. So the rules below are
 * about *place*, not about wording, and every one of them reads the syntax
 * tree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { identifiersOf, valueImportsOf } from "@/lib/dev/ast";

const CORE = "src/lib/song/event-entry.ts";
const MESSAGES = "src/lib/song/event-entry-messages.ts";
const DRUM_MODEL = "src/lib/tab/drum-step-model.ts";
const PITCHED_MODEL = "src/lib/tab/pitched-step-model.ts";
const CONTROLLER = "src/lib/workspace/use-event-entry.ts";
const DRUM_LANE = "src/components/workspace/DrumStepLane.tsx";
const PITCHED_LANE = "src/components/workspace/PitchedStepLane.tsx";
const SHEET = "src/components/workspace/NoteEntrySheet.tsx";

const lineCount = (path: string) => {
  const text = readFileSync(path, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

describe("224. the entry core stays a core", () => {
  it("keeps React out of the commands and the models", () => {
    for (const path of [CORE, MESSAGES, DRUM_MODEL, PITCHED_MODEL]) {
      const imports = valueImportsOf(path);
      expect(imports.some((entry) => entry.startsWith("react")), path).toBe(false);
    }
  });

  it("keeps storage, files and the DOM out of them too", () => {
    for (const path of [CORE, MESSAGES, DRUM_MODEL, PITCHED_MODEL]) {
      const names = identifiersOf(path);
      for (const forbidden of ["localStorage", "document", "window", "fetch", "Blob"]) {
        expect(names.has(forbidden), `${path}: ${forbidden}`).toBe(false);
      }
    }
  });

  it("settles every candidate through the app's one gate", () => {
    // `settle` is the schema-then-validators gate the tab uses. A command
    // that skipped it could put music in the song no other path could.
    expect(valueImportsOf(CORE)).toContain("@/lib/song/edit");
    expect(identifiersOf(CORE).has("settle")).toBe(true);
  });

  it("gives the refusals exactly one table, and the core does not hold it", () => {
    /*
     * The core returns codes; the sentences live next door. A core that knew
     * the Turkish for a refusal would be a core that had to change when the
     * wording did.
     *
     * That every code *has* a sentence is not asserted here because it cannot
     * be broken: the table is a `Record` over the code union, so a code
     * without one is a compile error rather than a blank line in front of
     * somebody. What is asserted is the direction of the dependency.
     */
    expect(identifiersOf(CORE).has("EVENT_ENTRY_MESSAGES")).toBe(false);
    expect(valueImportsOf(MESSAGES)).toEqual([]);
  });
});

describe("225. the surfaces stay surfaces", () => {
  it("keeps the lanes and the sheet off the command core", () => {
    for (const path of [DRUM_LANE, PITCHED_LANE, SHEET]) {
      const imports = valueImportsOf(path);
      expect(imports.includes("@/lib/song/event-entry"), path).toBe(false);
      expect(imports.includes("@/lib/song/edit"), path).toBe(false);
    }
  });

  it("keeps them off storage and off history", () => {
    for (const path of [DRUM_LANE, PITCHED_LANE, SHEET]) {
      const names = identifiersOf(path);
      for (const forbidden of ["localStorage", "commit", "settle"]) {
        expect(names.has(forbidden), `${path}: ${forbidden}`).toBe(false);
      }
    }
  });

  it("builds no model of its own inside a component", () => {
    // Two answers to "what is on this beat" is exactly how a grid and the
    // music it claims to draw come apart.
    for (const path of [DRUM_LANE, PITCHED_LANE]) {
      const names = identifiersOf(path);
      expect(names.has("buildDrumStepModel"), path).toBe(false);
      expect(names.has("buildPitchedStepModel"), path).toBe(false);
    }
  });

  it("gives the controller the only door onto the models", () => {
    const imports = valueImportsOf(CONTROLLER);
    expect(imports).toContain("@/lib/tab/drum-step-model");
    expect(imports).toContain("@/lib/tab/pitched-step-model");
    expect(imports).toContain("@/lib/song/event-entry");
  });

  it("holds the entry surface inside a budget rather than discovering one later", () => {
    expect(lineCount(CORE)).toBeLessThanOrEqual(400);
    expect(lineCount(CONTROLLER)).toBeLessThanOrEqual(290);
    expect(lineCount(DRUM_LANE)).toBeLessThanOrEqual(200);
    expect(lineCount(PITCHED_LANE)).toBeLessThanOrEqual(200);
    expect(lineCount(SHEET)).toBeLessThanOrEqual(220);
  });
});
