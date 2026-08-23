/**
 * The catalog contract, and the things it refuses to believe (2O-A §23).
 *
 * A catalog is the one structure that can point at a project's payload, so
 * every way it could point at nothing — a duplicate id, an active project
 * that is not in the list, a counter that would hand out a name already
 * taken — is a refusal rather than something the rest of the system has to
 * defend against later.
 */
import { describe, expect, it } from "vitest";

import {
  PROJECT_CATALOG_FORMAT,
  PROJECT_CATALOG_VERSION,
  allocateProjectId,
  decideCatalog,
  initialCatalog,
  rebuildCatalog,
  serializeCatalog,
  type ProjectCatalogV1,
} from "@/lib/projects/project-catalog";
import {
  PROJECT_ID_PATTERN,
  highestProjectNumber,
  isProjectId,
  projectNumber,
} from "@/lib/projects/project-id";

const valid = (over: Partial<ProjectCatalogV1> = {}): ProjectCatalogV1 => ({
  format: PROJECT_CATALOG_FORMAT,
  version: PROJECT_CATALOG_VERSION,
  activeProjectId: "project-2",
  projectIds: ["project-1", "project-2"],
  nextProjectNumber: 3,
  ...over,
});

const raw = (value: unknown) => JSON.stringify(value);

describe("117. a catalog is read strictly or not at all", () => {
  it("accepts a well-formed catalog and keeps every field", () => {
    const decision = decideCatalog(raw(valid()));
    expect(decision.kind).toBe("catalog");
    if (decision.kind !== "catalog") return;
    expect(decision.catalog).toEqual(valid());
  });

  it("refuses an unknown key rather than dropping it", () => {
    // Dropping it silently would mean the next write deletes whatever a newer
    // build put there, which is data loss disguised as tolerance.
    const decision = decideCatalog(raw({ ...valid(), extra: 1 }));
    expect(decision.kind).toBe("invalid");
    if (decision.kind !== "invalid") return;
    expect(decision.issues).toEqual(["shape_invalid"]);
  });

  it("refuses a duplicate project id", () => {
    const decision = decideCatalog(
      raw(valid({ projectIds: ["project-1", "project-1"] , activeProjectId: "project-1" })),
    );
    expect(decision.kind).toBe("invalid");
    if (decision.kind !== "invalid") return;
    expect(decision.issues).toContain("duplicate_project_id");
  });

  it("refuses an active project that is not in the list", () => {
    const decision = decideCatalog(raw(valid({ activeProjectId: "project-9" })));
    expect(decision.kind).toBe("invalid");
    if (decision.kind !== "invalid") return;
    expect(decision.issues).toContain("active_project_missing");
  });

  it("refuses a counter that would hand out a name already taken", () => {
    // `nextProjectNumber: 2` with `project-2` present would name the next
    // project after one that exists, and write it over that project's payload.
    const decision = decideCatalog(raw(valid({ nextProjectNumber: 2 })));
    expect(decision.kind).toBe("invalid");
    if (decision.kind !== "invalid") return;
    expect(decision.issues).toContain("counter_would_reuse_an_id");
  });

  it("refuses an empty list, because the last project cannot be deleted", () => {
    const decision = decideCatalog(raw(valid({ projectIds: [] })));
    expect(decision.kind).toBe("invalid");
  });

  it("refuses ids that are not ours", () => {
    for (const id of ["project-0", "project-01", "project-1 ", "../x", "", "song-1"]) {
      expect(isProjectId(id), id).toBe(false);
      const decision = decideCatalog(
        raw(valid({ projectIds: [id], activeProjectId: id })),
      );
      expect(decision.kind, id).toBe("invalid");
    }
    expect(PROJECT_ID_PATTERN.test("project-12")).toBe(true);
  });

  it("says nothing at all about an empty key", () => {
    expect(decideCatalog(null)).toEqual({ kind: "empty" });
  });

  it("calls unreadable text invalid, not a catalog", () => {
    expect(decideCatalog("{oops")).toEqual({ kind: "invalid", issues: ["not_json"] });
    expect(decideCatalog(raw({ hello: 1 }))).toEqual({
      kind: "invalid",
      issues: ["not_a_catalog"],
    });
  });
});

describe("118. a newer version's catalog is not ours to touch", () => {
  it("reports the version instead of calling it corrupt", () => {
    const decision = decideCatalog(
      raw({ format: PROJECT_CATALOG_FORMAT, version: 7, anything: true }),
    );
    expect(decision).toEqual({ kind: "future_version", version: 7 });
  });

  it("does not need the rest of the shape to make that call", () => {
    /*
     * The tag is read first on purpose: a V7 catalog may have no
     * `projectIds` at all, and judging it by the V1 shape would report
     * "corrupt" about a file that is simply newer.
     */
    const decision = decideCatalog(
      raw({ format: PROJECT_CATALOG_FORMAT, version: 2, projects: {} }),
    );
    expect(decision.kind).toBe("future_version");
  });
});

describe("119. ids count up and are never handed out twice", () => {
  it("allocates the next number and advances the counter with it", () => {
    const first = allocateProjectId(valid());
    expect(first.id).toBe("project-3");
    expect(first.catalog.nextProjectNumber).toBe(4);
  });

  it("never reuses a deleted project's number", () => {
    // project-2 deleted; the counter still remembers it was handed out.
    const after = valid({ projectIds: ["project-1"], activeProjectId: "project-1" });
    expect(allocateProjectId(after).id).toBe("project-3");
  });

  it("clears every id present even if the counter has fallen behind", () => {
    const patched = { ...valid(), nextProjectNumber: 1 } as ProjectCatalogV1;
    expect(allocateProjectId(patched).id).toBe("project-3");
  });

  it("carries no clock and no randomness", () => {
    // Five runs, same catalog, same answer: nothing here reads a clock.
    const results = Array.from({ length: 5 }, () => allocateProjectId(valid()));
    for (const result of results) expect(result.id).toBe(results[0]!.id);
    expect(projectNumber("project-42")).toBe(42);
    expect(highestProjectNumber(["project-2", "nope", "project-40"])).toBe(40);
  });

  it("does not mutate the catalog it was given", () => {
    const catalog = valid();
    const snapshot = JSON.stringify(catalog);
    allocateProjectId(catalog);
    expect(JSON.stringify(catalog)).toBe(snapshot);
  });
});

describe("120. the same catalog is always the same bytes", () => {
  it("serializes identically five times", () => {
    const bytes = Array.from({ length: 5 }, () => serializeCatalog(valid()));
    for (const line of bytes) expect(line).toBe(bytes[0]);
  });

  it("round-trips through its own reader", () => {
    const decision = decideCatalog(serializeCatalog(valid()));
    expect(decision.kind).toBe("catalog");
    if (decision.kind !== "catalog") return;
    expect(serializeCatalog(decision.catalog)).toBe(serializeCatalog(valid()));
  });

  it("starts a first library with one open project", () => {
    const first = initialCatalog("project-1");
    expect(first.projectIds).toEqual(["project-1"]);
    expect(first.activeProjectId).toBe("project-1");
    expect(decideCatalog(serializeCatalog(first)).kind).toBe("catalog");
  });
});

describe("121. a rebuilt catalog names only payloads that were found", () => {
  it("keeps the preferred active project when it verified", () => {
    const rebuilt = rebuildCatalog(["project-1", "project-4"], "project-4");
    expect(rebuilt?.activeProjectId).toBe("project-4");
    expect(rebuilt?.nextProjectNumber).toBe(5);
  });

  it("falls back to the first when the preferred one did not", () => {
    /*
     * The active project's payload is the one thing a rebuild cannot invent:
     * if it did not verify, pointing at it anyway would produce a library
     * whose open project does not exist.
     */
    const rebuilt = rebuildCatalog(["project-1", "project-4"], "project-9");
    expect(rebuilt?.activeProjectId).toBe("project-1");
  });

  it("refuses to build a library out of nothing", () => {
    expect(rebuildCatalog([], "project-1")).toBeNull();
  });

  it("produces a catalog its own reader accepts", () => {
    const rebuilt = rebuildCatalog(["project-2", "project-7"], "project-7");
    expect(rebuilt).not.toBeNull();
    if (!rebuilt) return;
    expect(decideCatalog(serializeCatalog(rebuilt)).kind).toBe("catalog");
  });
});
