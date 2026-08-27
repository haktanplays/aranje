import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_PROJECT_ID,
  startAcceptanceSession,
} from "@/lib/acceptance/session";
import { isProjectId } from "@/lib/projects/project-id";
import { readCatalog, readRecord } from "@/lib/projects/project-storage";
import { songSchema } from "@/lib/song/schema";

/*
 * The guided route's one safety property: it runs the real workspace, and the
 * real workspace writes — so everything it writes has to land somewhere the
 * reader does not keep their music. These tests check that the fixture is
 * genuinely readable back out of the page's own storage, because a session
 * that silently failed to write would leave the route showing the sample song
 * and the test would be measuring the wrong music.
 */
describe("startAcceptanceSession", () => {
  it("names the fixture with an id the storage layer will actually key", () => {
    expect(isProjectId(ACCEPTANCE_PROJECT_ID)).toBe(true);
  });

  it("writes the riff into its own storage and says so", () => {
    const session = startAcceptanceSession();
    expect(session.ok).toBe(true);
    expect(session.reason).toBeNull();

    const record = readRecord(session.storage, ACCEPTANCE_PROJECT_ID);
    expect(record.kind).toBe("record");
    if (record.kind !== "record") return;
    expect(record.projectId).toBe(ACCEPTANCE_PROJECT_ID);
    expect(songSchema.safeParse(record.song).success).toBe(true);
  });

  it("points the catalog at the fixture, so the workspace opens it", () => {
    const session = startAcceptanceSession();
    const catalog = readCatalog(session.storage);
    expect(catalog.kind).toBe("catalog");
    if (catalog.kind !== "catalog") return;
    expect(catalog.catalog.activeProjectId).toBe(ACCEPTANCE_PROJECT_ID);
    expect(catalog.catalog.projectIds).toEqual([ACCEPTANCE_PROJECT_ID]);
  });

  it("touches only its own keys — nothing outside the project namespace", () => {
    const session = startAcceptanceSession();
    for (const key of Object.keys(session.storage.snapshot())) {
      expect(key.startsWith("aranje.")).toBe(true);
    }
  });

  it("is byte-identical between runs, so a storage diff means something", () => {
    const first = startAcceptanceSession().storage.snapshot();
    const second = startAcceptanceSession().storage.snapshot();
    expect(second).toEqual(first);
  });

  /*
   * The project session is a module singleton, so by the time this runs every
   * earlier test in the file has already installed one. That is the condition
   * under test: a second install must be refused out loud rather than silently
   * leaving the route pointed at `localStorage`.
   */
  it("refuses rather than falling back when a session already exists", () => {
    const second = startAcceptanceSession();
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/zaten kurulmuş/);
  });
});
