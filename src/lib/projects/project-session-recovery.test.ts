/**
 * The reader is told when their last save did not come back (2Q-B §1.3).
 *
 * K-45 bought a promise with the two-slot envelope: a broken save costs the
 * last edit and not the song, and the banner says so. K-52 put a project
 * around that envelope — and the news stopped travelling. A device whose
 * last save was unreadable opened the *previous* version silently, and a
 * file written by a newer Aranje said "this device cannot save" instead of
 * saying what was actually true.
 *
 * A recovery nobody is told about is the failure the banner exists to
 * prevent: the reader keeps working on an older song believing it is theirs.
 */
import { describe, expect, it } from "vitest";

import { createProjectSession } from "@/lib/projects/project-session";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { EnumerableStorage } from "@/lib/projects/project-storage";
import type { Song } from "@/lib/song/schema";

function memory(entries: Record<string, string> = {}): EnumerableStorage {
  const data = new Map(Object.entries(entries));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
  };
}

const older: Song = { ...SAMPLE_SONG, title: "Bir önceki sürüm" };

const legacyEnvelope = (current: unknown, previous: unknown, version = 1) =>
  JSON.stringify({ format: "aranje.song", version, revision: 4, current, previous });

const projectRecord = (current: unknown, previous: unknown, version = 1) =>
  JSON.stringify({
    format: "aranje.project-record",
    version,
    projectId: "project-1",
    revision: 4,
    updatedAt: 1_700_000_000_000,
    current,
    previous,
  });

const catalog = JSON.stringify({
  format: "aranje.project-catalog",
  version: 1,
  activeProjectId: "project-1",
  projectIds: ["project-1"],
  nextProjectNumber: 2,
});

describe("214. a recovery is news, and news travels", () => {
  it("says so when the last save was unreadable and the one before came back", () => {
    const session = createProjectSession(
      memory({ "aranje.song": legacyEnvelope(null, older) }),
    );
    expect(session.store.getSnapshot().song.title).toBe("Bir önceki sürüm");
    expect(session.store.getSnapshot().recovery).toBe("recovered_previous");
    expect(session.store.getSnapshot().recoveryMessage).toContain("önceki");
  });

  it("says so when nothing readable was left at all", () => {
    const session = createProjectSession(
      memory({ "aranje.song": legacyEnvelope(null, null) }),
    );
    expect(session.store.getSnapshot().recovery).toBe("corrupt_fallback");
  });

  it("names a newer version as a newer version, not as a broken device", () => {
    const session = createProjectSession(
      memory({ "aranje.song": legacyEnvelope(SAMPLE_SONG, null, 99) }),
    );
    expect(session.store.getSnapshot().recovery).toBe("unsupported_version");
  });

  it("carries the same news out of a project record", () => {
    const session = createProjectSession(
      memory({
        "aranje.projects": catalog,
        "aranje.project.project-1": projectRecord(null, older),
      }),
    );
    expect(session.store.getSnapshot().song.title).toBe("Bir önceki sürüm");
    expect(session.store.getSnapshot().recovery).toBe("recovered_previous");
  });

  it("names a newer project record as a newer version", () => {
    const session = createProjectSession(
      memory({
        "aranje.projects": catalog,
        "aranje.project.project-1": projectRecord(SAMPLE_SONG, null, 99),
      }),
    );
    expect(session.store.getSnapshot().recovery).toBe("unsupported_version");
  });

  it("says nothing when there is nothing to say", () => {
    const session = createProjectSession(
      memory({
        "aranje.projects": catalog,
        "aranje.project.project-1": projectRecord(SAMPLE_SONG, null),
      }),
    );
    expect(session.store.getSnapshot().recovery).toBeNull();
    expect(session.store.getSnapshot().recoveryMessage).toBeNull();
  });

  it("still says the device cannot save when it cannot", () => {
    const session = createProjectSession(null);
    expect(session.store.getSnapshot().recovery).toBe("storage_unavailable");
  });
});
