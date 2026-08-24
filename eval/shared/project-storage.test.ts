/**
 * The harness's decision table, cross-checked against production (2Q-B §1.2).
 *
 * A browser cannot import `@/lib/projects/project-record`, so the acceptance
 * harness carries its own copy of the *decision* — which record is readable,
 * which one falls back to the previous slot, which one is a future version
 * and which one is simply corrupt. A copy that drifts is worse than no copy
 * at all: it would let a suite report a clean read of a record the app itself
 * refuses.
 *
 * So both are run over the same fixtures here, and any disagreement is a
 * failing test rather than a surprise in a report.
 */
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const harness = require("./project-storage.mjs") as {
  decideRecordShape(raw: string | null): { kind: string; version?: number };
  writeClassOf(key: string, activeProjectId: string | null): string;
};

import { decideRecord } from "@/lib/projects/project-record";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const record = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: "aranje.project-record",
    version: 1,
    projectId: "project-1",
    revision: 3,
    updatedAt: 1_700_000_000_000,
    current: SAMPLE_SONG,
    previous: null,
    ...over,
  });

const CASES: readonly (readonly [string, string | null])[] = [
  ["nothing there", null],
  ["not json", "{"],
  ["json but not a record", JSON.stringify({ hello: "world" })],
  ["a bare song", JSON.stringify(SAMPLE_SONG)],
  ["a song envelope, not a project record", JSON.stringify({
    format: "aranje.song",
    version: 1,
    revision: 1,
    current: SAMPLE_SONG,
    previous: null,
  })],
  ["a healthy record", record()],
  ["a future version", record({ version: 2 })],
  ["a broken current, healthy previous", record({ current: null, previous: SAMPLE_SONG })],
  ["both slots broken", record({ current: null, previous: null })],
  ["a missing revision", record({ revision: undefined })],
  ["an id that is not a string", record({ projectId: 7 })],
];

describe("212. the harness decides a record the way production does", () => {
  it.each(CASES)("agrees on %s", (_label, raw) => {
    const mine = harness.decideRecordShape(raw);
    const theirs = decideRecord(raw);
    expect(mine.kind, `${_label}: ${mine.kind} vs ${theirs.kind}`).toBe(theirs.kind);
    if (theirs.kind === "future_version" && mine.kind === "future_version") {
      expect(mine.version).toBe(theirs.version);
    }
  });

  it("returns the song production would have returned", () => {
    const healthy = harness.decideRecordShape(record()) as { song?: unknown };
    const theirs = decideRecord(record());
    expect(theirs.kind).toBe("record");
    if (theirs.kind !== "record") return;
    /*
     * Structural equality, not byte equality: production hands back a
     * schema-parsed song and the harness hands back the raw JSON, so the two
     * can differ in key order while saying exactly the same thing. Suites
     * that need byte equality compare two raw reads with each other, which
     * is a different and still honest question.
     */
    expect(healthy.song).toEqual(theirs.song);
  });

  it("recovers the previous slot exactly where production does", () => {
    const raw = record({ current: null, previous: SAMPLE_SONG });
    const mine = harness.decideRecordShape(raw) as { kind: string; song?: unknown };
    const theirs = decideRecord(raw);
    expect(theirs.kind).toBe("recovered_previous");
    expect(mine.kind).toBe("recovered_previous");
    if (theirs.kind !== "recovered_previous") return;
    expect(mine.song).toEqual(theirs.song);
  });

  it("is not a test that would pass against a stub", () => {
    // A table that answered "corrupt" to everything would agree nowhere.
    const kinds = new Set(CASES.map(([, raw]) => harness.decideRecordShape(raw).kind));
    expect(kinds.size).toBeGreaterThan(3);
  });
});

describe("213. a write is classified by which project it touched", () => {
  it("separates the open project from every other one", () => {
    expect(harness.writeClassOf("aranje.project.project-1", "project-1")).toBe(
      "active_project",
    );
    expect(harness.writeClassOf("aranje.project.project-2", "project-1")).toBe(
      "other_project",
    );
    // With no catalog to say which is open, no payload may claim to be it.
    expect(harness.writeClassOf("aranje.project.project-1", null)).toBe("other_project");
  });

  it("names the catalog, the pending marker and the legacy key apart", () => {
    expect(harness.writeClassOf("aranje.projects", "project-1")).toBe("catalog");
    expect(harness.writeClassOf("aranje.project-pending", "project-1")).toBe(
      "pending_delete",
    );
    expect(harness.writeClassOf("aranje.song", "project-1")).toBe("legacy_song");
    expect(harness.writeClassOf("aranje.probe", "project-1")).toBe("probe");
    expect(harness.writeClassOf("aranje.corrupt.project-1.1", "project-1")).toBe(
      "quarantine",
    );
    expect(harness.writeClassOf("aranje.settings", "project-1")).toBe("unknown");
  });
});
