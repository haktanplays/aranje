/**
 * The first project on a device that has none (2V-E.1 §4, §6).
 */
import { describe, expect, it } from "vitest";

import { createFirstProject } from "@/lib/projects/project-commands";
import { createProjectSession } from "@/lib/projects/project-session";
import { readCatalog, readRecord, type EnumerableStorage } from "@/lib/projects/project-storage";
import { materializeTemplate } from "@/lib/song/song-templates";
import type { Song } from "@/lib/song/schema";

const NOW = Date.UTC(2026, 8, 6, 12);

function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage: EnumerableStorage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  } as EnumerableStorage;
  return { storage, data };
}

const song = (): Song => {
  const made = materializeTemplate("empty");
  if (!made) throw new Error("the empty template did not materialise");
  return made;
};

describe("400. a device with nothing on it", () => {
  it("settles with no library and no song, and writes nothing", () => {
    const { storage, data } = fakeStorage();
    const session = createProjectSession(storage, () => NOW);
    expect(session.catalog).toBeNull();
    expect(data.size).toBe(0);
  });

  it("does not put the demo song in front of the reader as a project", () => {
    /* The whole of §4's first rule: what opens is what the reader made, and
       on a new device that is nothing at all. */
    const { storage, data } = fakeStorage();
    createProjectSession(storage, () => NOW);
    expect([...data.keys()].some((key) => key.startsWith("aranje.project."))).toBe(false);
  });
});

describe("401. making the first project", () => {
  it("writes one record and one catalog, both read back", () => {
    const { storage, data } = fakeStorage();
    const result = createFirstProject({ storage, now: NOW }, song());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(data.size).toBe(2);
    expect(readRecord(storage, result.activeProjectId).kind).toBe("record");
    const decision = readCatalog(storage);
    expect(decision.kind).toBe("catalog");
    if (decision.kind !== "catalog") return;
    expect(decision.catalog.projectIds).toEqual([result.activeProjectId]);
    expect(decision.catalog.activeProjectId).toBe(result.activeProjectId);
  });

  it("allocates its id above whatever is already on disk", () => {
    /*
     * Not `project-1` by assumption (§6). A record left behind by an
     * interrupted create, or written by a fixture, is stepped over — writing
     * on top of it would be this command destroying music to take a number.
     */
    const { storage } = fakeStorage({
      "aranje.project.project-4": "{ not a record }",
    });
    const result = createFirstProject({ storage, now: NOW }, song());
    expect(result.ok && result.activeProjectId).toBe("project-5");
  });

  it("leaves nothing behind when the device refuses the write", () => {
    const { storage, data } = fakeStorage();
    const failing: EnumerableStorage = {
      ...storage,
      setItem: () => {
        throw new Error("full");
      },
    } as EnumerableStorage;
    const result = createFirstProject({ storage: failing, now: NOW }, song());
    expect(result.ok).toBe(false);
    expect(data.size).toBe(0);
  });

  it("refuses a song the contract will not accept, before writing anything", () => {
    const { storage, data } = fakeStorage();
    /* A track referenced by no lane at all: the settle refuses it, and the
       refusal has to happen before the first byte is written. */
    const broken = { ...song(), tracks: [] } as unknown as Song;
    expect(createFirstProject({ storage, now: NOW }, broken).ok).toBe(false);
    expect(data.size).toBe(0);
  });
});

describe("402. the session can write to the project it just made", () => {
  it("turns the store from read-only into writable when the first opens", () => {
    /*
     * The defect this pins: a session built on an empty device had no port,
     * so the project it created could be written *once* by the command and
     * never again by the editor. Opening is what gives it one.
     */
    const { storage } = fakeStorage();
    const session = createProjectSession(storage, () => NOW);
    expect(session.store.getSnapshot().canPersist).toBe(false);

    const made = createFirstProject({ storage, now: NOW }, song());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    session.openProject(made.activeProjectId, made.song, made.catalog);

    expect(session.store.getSnapshot().canPersist).toBe(true);
    expect(session.canPersist).toBe(true);

    /* And a real edit lands on the device, through the ordinary path. */
    const edited = { ...made.song, title: "İlk Riffim" };
    expect(session.store.commit(edited, { kind: "lifecycle", command: "update_song_info" })).toBe(
      true,
    );
    const back = readRecord(storage, made.activeProjectId);
    expect(back.kind === "record" && back.song.title).toBe("İlk Riffim");
  });

  it("still reports a device that cannot be written to as read-only", () => {
    const { storage } = fakeStorage();
    const failing: EnumerableStorage = {
      ...storage,
      setItem: () => {
        throw new Error("blocked");
      },
    } as EnumerableStorage;
    const session = createProjectSession(failing, () => NOW);
    expect(session.canPersist).toBe(false);
    expect(session.store.getSnapshot().canPersist).toBe(false);
  });
});
