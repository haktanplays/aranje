/**
 * Getting an existing song into the library, and every way that can go wrong
 * (2O-A §9, §10, §23).
 *
 * The claim is narrow and total: **whatever fails, the musician's bytes are
 * still there.** So every test here injects a failure at a real physical
 * operation and then asks the only question that matters — can the song still
 * be found? A migration that reported success while dropping a key would pass
 * a "did it return ok" test and fail this one.
 */
import { describe, expect, it } from "vitest";

import { legacySong, otherSong } from "../../../eval/projects/fixtures";

import {
  FIRST_PROJECT_ID,
  settleProjects,
} from "@/lib/projects/project-migration";
import { initialCatalog, serializeCatalog } from "@/lib/projects/project-catalog";
import {
  CATALOG_KEY,
  PENDING_KEY,
  projectKey,
  readRecord,
} from "@/lib/projects/project-storage";
import { nextRecord, serializeRecord } from "@/lib/projects/project-record";
import { sameSong } from "@/lib/song/edit-history";
import { SONG_KEY } from "@/lib/song/storage";
import {
  SONG_ENVELOPE_FORMAT,
  SONG_ENVELOPE_VERSION,
} from "@/lib/song/storage-envelope";
import type { Song } from "@/lib/song/schema";

const NOW = 1_700_000_000_000;
const clock = () => NOW;

type Op = { readonly op: "get" | "set" | "remove"; readonly key: string };

/**
 * A storage that records every physical operation and can be told to refuse
 * one of them.
 *
 * `failOn` is given the operation *before* it happens, so a refusal leaves the
 * store exactly as it was — which is what a real quota rejection does.
 */
function fakeStorage(
  seed: Record<string, string> = {},
  failOn?: (op: Op, index: number) => boolean,
) {
  const data = new Map(Object.entries(seed));
  const ops: Op[] = [];
  const guard = (op: Op) => {
    const index = ops.length;
    ops.push(op);
    if (failOn?.(op, index)) throw new Error("refused");
  };
  return {
    ops,
    data,
    storage: {
      get length() {
        return data.size;
      },
      key: (index: number) => [...data.keys()][index] ?? null,
      getItem: (key: string) => {
        guard({ op: "get", key });
        return data.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        guard({ op: "set", key });
        data.set(key, value);
      },
      removeItem: (key: string) => {
        guard({ op: "remove", key });
        data.delete(key);
      },
    },
  };
}

/** Every place the song could still be found, as raw text. */
const allText = (data: Map<string, string>) => [...data.values()].join("\n");

const envelope = (current: unknown, previous: unknown, revision = 2) =>
  JSON.stringify({
    format: SONG_ENVELOPE_FORMAT,
    version: SONG_ENVELOPE_VERSION,
    revision,
    current,
    previous,
  });

const storedProject = (id: string, song: Song, revision = 1) =>
  serializeRecord(nextRecord(id, song, { kind: "empty" }, NOW)).replace(
    '"revision":1',
    `"revision":${revision}`,
  );

describe("124. every start state settles into a library or leaves everything alone", () => {
  it("makes a first project out of nothing", () => {
    const { storage, data } = fakeStorage();
    const outcome = settleProjects(storage, clock);
    expect(outcome.catalog?.projectIds).toEqual([FIRST_PROJECT_ID]);
    expect(outcome.canPersist).toBe(true);
    expect(data.has(SONG_KEY)).toBe(false);
  });

  it("carries a legacy raw song into project-1 and only then drops the key", () => {
    const { storage, data, ops } = fakeStorage({
      [SONG_KEY]: JSON.stringify(legacySong()),
    });
    const outcome = settleProjects(storage, clock);

    expect(outcome.canPersist).toBe(true);
    expect(sameSong(outcome.song, legacySong())).toBe(true);

    const stored = readRecord(storage, FIRST_PROJECT_ID);
    expect(stored.kind).toBe("record");
    if (stored.kind !== "record") return;
    expect(sameSong(stored.song, legacySong())).toBe(true);

    /*
     * The order is the guarantee: the payload is written and read back before
     * the old key is removed, so there is no instant at which the song exists
     * in neither place.
     */
    const names = ops.map((entry) => `${entry.op} ${entry.key}`);
    const payloadWrite = names.indexOf(`set ${projectKey(FIRST_PROJECT_ID)}`);
    const legacyRemove = names.indexOf(`remove ${SONG_KEY}`);
    const catalogWrite = names.indexOf(`set ${CATALOG_KEY}`);
    expect(payloadWrite).toBeGreaterThanOrEqual(0);
    expect(catalogWrite).toBeGreaterThan(payloadWrite);
    expect(legacyRemove).toBeGreaterThan(catalogWrite);
    expect(data.has(SONG_KEY)).toBe(false);
  });

  it("carries an existing envelope across, keeping the current song", () => {
    const { storage } = fakeStorage({
      [SONG_KEY]: envelope(legacySong(), otherSong()),
    });
    const outcome = settleProjects(storage, clock);
    expect(sameSong(outcome.song, legacySong())).toBe(true);
  });

  it("migrates the rescued song when the current slot is broken", () => {
    const { storage } = fakeStorage({
      [SONG_KEY]: envelope({ broken: true }, otherSong()),
    });
    const outcome = settleProjects(storage, clock);
    expect(sameSong(outcome.song, otherSong())).toBe(true);
  });

  it("keeps unreadable bytes and still opens something", () => {
    for (const raw of [envelope({ a: 1 }, { b: 2 }), "{not json"]) {
      const { storage, data } = fakeStorage({ [SONG_KEY]: raw });
      const outcome = settleProjects(storage, clock);
      // The raw value was quarantined, not thrown away.
      expect(allText(data)).toContain(raw.slice(0, 12));
      expect(outcome.catalog).not.toBeNull();
    }
  });

  it("refuses to migrate a file from a newer version, and touches nothing", () => {
    const raw = JSON.stringify({
      format: SONG_ENVELOPE_FORMAT,
      version: 42,
      whatever: true,
    });
    const { storage, data, ops } = fakeStorage({ [SONG_KEY]: raw });
    const outcome = settleProjects(storage, clock);

    expect(outcome.canPersist).toBe(false);
    expect(outcome.notice).toBe("project_future_version");
    expect(data.get(SONG_KEY)).toBe(raw);
    expect(ops.some((entry) => entry.op === "set" && entry.key.startsWith("aranje.project")))
      .toBe(false);
  });

  it("cannot migrate without storage, and says so instead of pretending", () => {
    expect(settleProjects(null, clock)).toMatchObject({
      canPersist: false,
      notice: "project_storage_unavailable",
      catalog: null,
    });
  });

  it("leaves everything in place when the write probe fails", () => {
    const raw = JSON.stringify(legacySong());
    const { storage, data } = fakeStorage({ [SONG_KEY]: raw }, (op) => op.op === "set");
    const outcome = settleProjects(storage, clock);
    expect(outcome.canPersist).toBe(false);
    expect(data.get(SONG_KEY)).toBe(raw);
    /* The song is still handed back: it can be played and backed up (§2.18). */
    expect(sameSong(outcome.song, legacySong())).toBe(true);
  });

  it("survives a getItem that throws", () => {
    const { storage } = fakeStorage({}, (op) => op.op === "get" && op.key === CATALOG_KEY);
    expect(() => settleProjects(storage, clock)).not.toThrow();
  });
});

describe("125. a failed migration is never reported as a finished one", () => {
  const legacyRaw = JSON.stringify(legacySong());

  it("keeps the old key when the payload write is refused", () => {
    const { storage, data } = fakeStorage({ [SONG_KEY]: legacyRaw }, (op) =>
      op.op === "set" && op.key === projectKey(FIRST_PROJECT_ID),
    );
    const outcome = settleProjects(storage, clock);
    expect(outcome.notice).toBe("project_migration_failed");
    expect(outcome.canPersist).toBe(false);
    expect(data.get(SONG_KEY)).toBe(legacyRaw);
  });

  it("keeps the old key when the catalog write is refused", () => {
    const { storage, data } = fakeStorage({ [SONG_KEY]: legacyRaw }, (op) =>
      op.op === "set" && op.key === CATALOG_KEY,
    );
    const outcome = settleProjects(storage, clock);
    expect(outcome.notice).toBe("project_migration_failed");
    expect(data.get(SONG_KEY)).toBe(legacyRaw);
    /* The payload landed. It is an orphan, and orphans are adoptable. */
    expect(readRecord(storage, FIRST_PROJECT_ID).kind).toBe("record");
  });

  it("counts the migration as done when only the cleanup fails", () => {
    /*
     * Both halves verified, so the song exists twice. The old key staying is
     * untidy, not lost — and the second load must not migrate again.
     */
    const { storage, data } = fakeStorage({ [SONG_KEY]: legacyRaw }, (op) =>
      op.op === "remove" && op.key === SONG_KEY,
    );
    const first = settleProjects(storage, clock);
    expect(first.canPersist).toBe(true);
    expect(first.catalog?.projectIds).toEqual([FIRST_PROJECT_ID]);
    expect(data.get(SONG_KEY)).toBe(legacyRaw);

    const second = settleProjects(storage, clock);
    expect(second.catalog?.projectIds).toEqual([FIRST_PROJECT_ID]);
  });

  it("is a no-op on the second, third, fourth and fifth run", () => {
    const { storage } = fakeStorage({ [SONG_KEY]: legacyRaw });
    const first = settleProjects(storage, clock);
    for (let run = 0; run < 4; run += 1) {
      const again = settleProjects(storage, clock);
      expect(again.catalog).toEqual(first.catalog);
      expect(sameSong(again.song, first.song)).toBe(true);
    }
  });

  it("finishes a migration that was interrupted before the catalog", () => {
    /*
     * What a device that died mid-create leaves: a payload with no catalog.
     * The next load adopts it rather than starting a second project.
     */
    const { storage } = fakeStorage({
      [projectKey(FIRST_PROJECT_ID)!]: storedProject(FIRST_PROJECT_ID, legacySong()),
    });
    const outcome = settleProjects(storage, clock);
    expect(outcome.catalog?.projectIds).toEqual([FIRST_PROJECT_ID]);
    expect(sameSong(outcome.song, legacySong())).toBe(true);
  });
});

describe("126. a damaged catalog never costs anybody a project", () => {
  it("rebuilds from the payloads that verified", () => {
    const { storage } = fakeStorage({
      [CATALOG_KEY]: "{ruined",
      [projectKey("project-1")!]: storedProject("project-1", legacySong()),
      [projectKey("project-4")!]: storedProject("project-4", otherSong()),
    });
    const outcome = settleProjects(storage, clock);
    expect(outcome.catalog?.projectIds).toEqual(["project-1", "project-4"]);
    expect(outcome.catalog?.nextProjectNumber).toBe(5);
    expect(outcome.notice).toBe("project_catalog_invalid");
  });

  it("deletes no payload while rebuilding", () => {
    const payload = storedProject("project-2", legacySong());
    const { storage, data, ops } = fakeStorage({
      [CATALOG_KEY]: JSON.stringify({ format: "aranje.project-catalog", version: 1 }),
      [projectKey("project-2")!]: payload,
    });
    settleProjects(storage, clock);
    expect(data.get(projectKey("project-2")!)).toBe(payload);
    expect(ops.some((entry) => entry.op === "remove" && entry.key.includes("project-2")))
      .toBe(false);
  });

  it("leaves a catalog from a newer version completely alone", () => {
    const raw = JSON.stringify({ format: "aranje.project-catalog", version: 5, x: 1 });
    const { storage, data, ops } = fakeStorage({
      [CATALOG_KEY]: raw,
      [projectKey("project-1")!]: storedProject("project-1", legacySong()),
    });
    const outcome = settleProjects(storage, clock);

    expect(outcome.canPersist).toBe(false);
    expect(outcome.notice).toBe("project_catalog_future_version");
    expect(data.get(CATALOG_KEY)).toBe(raw);
    expect(ops.some((entry) => entry.op === "set" && entry.key === CATALOG_KEY)).toBe(false);
    /*
     * Nothing is removed except the write probe, which is the app asking
     * whether it may write at all. It is a real physical operation and is
     * named here rather than folded into "no writes".
     */
    expect(
      ops.filter((entry) => entry.op === "remove").map((entry) => entry.key),
    ).toEqual(["aranje.probe"]);
  });

  it("adopts an orphan payload into a healthy catalog", () => {
    const { storage } = fakeStorage({
      [CATALOG_KEY]: serializeCatalog(initialCatalog("project-1")),
      [projectKey("project-1")!]: storedProject("project-1", legacySong()),
      [projectKey("project-3")!]: storedProject("project-3", otherSong()),
    });
    const outcome = settleProjects(storage, clock);
    expect(outcome.catalog?.projectIds).toEqual(["project-1", "project-3"]);
    /* Adoption does not move the reader: the open project stays open. */
    expect(outcome.catalog?.activeProjectId).toBe("project-1");
  });

  it("does not adopt a payload it cannot read", () => {
    const { storage } = fakeStorage({
      [CATALOG_KEY]: serializeCatalog(initialCatalog("project-1")),
      [projectKey("project-1")!]: storedProject("project-1", legacySong()),
      [projectKey("project-3")!]: "{broken",
    });
    const outcome = settleProjects(storage, clock);
    expect(outcome.catalog?.projectIds).toEqual(["project-1"]);
    /* And it is not deleted either — it is somebody's, however broken. */
    expect(storage.getItem(projectKey("project-3")!)).toBe("{broken");
  });
});

describe("127. an interrupted delete resolves one way, deterministically", () => {
  const twoProjects = () => ({
    [CATALOG_KEY]: serializeCatalog({
      format: "aranje.project-catalog" as const,
      version: 1 as const,
      activeProjectId: "project-1",
      projectIds: ["project-1", "project-2"],
      nextProjectNumber: 3,
    }),
    [projectKey("project-1")!]: storedProject("project-1", legacySong()),
    [projectKey("project-2")!]: storedProject("project-2", otherSong()),
  });

  it("finishes the delete when the catalog already dropped the project", () => {
    const { storage, data } = fakeStorage({
      [CATALOG_KEY]: serializeCatalog(initialCatalog("project-1")),
      [projectKey("project-1")!]: storedProject("project-1", legacySong()),
      [projectKey("project-2")!]: storedProject("project-2", otherSong()),
      [PENDING_KEY]: JSON.stringify({ kind: "delete", projectId: "project-2" }),
    });
    settleProjects(storage, clock);
    expect(data.has(projectKey("project-2")!)).toBe(false);
    expect(data.has(PENDING_KEY)).toBe(false);
  });

  it("abandons the delete towards keeping the music when the catalog still lists it", () => {
    /*
     * The note landed and the catalog write did not. Resolving *towards
     * keeping* is the only safe direction: the reader can ask again, and
     * asking again costs them a tap. The other direction costs them a song.
     */
    const seed = { ...twoProjects(), [PENDING_KEY]: JSON.stringify({ kind: "delete", projectId: "project-2" }) };
    const { storage, data } = fakeStorage(seed);
    const outcome = settleProjects(storage, clock);
    expect(data.has(projectKey("project-2")!)).toBe(true);
    expect(outcome.catalog?.projectIds).toEqual(["project-1", "project-2"]);
    expect(data.has(PENDING_KEY)).toBe(false);
  });

  it("ignores a note it cannot read rather than deleting on a guess", () => {
    const { storage, data } = fakeStorage({ ...twoProjects(), [PENDING_KEY]: "{junk" });
    settleProjects(storage, clock);
    expect(data.has(projectKey("project-2")!)).toBe(true);
  });
});

describe("128. a write is not believed until it has been read back", () => {
  /**
   * The failure mode this whole migration is shaped around.
   *
   * `setItem` returning without throwing is not evidence. A storage that
   * accepts a write and then hands back something else — a quota that silently
   * truncates, an extension rewriting a key, a device with a dying flash cell
   * — is exactly the case where "it saved fine" and "the song is gone" are
   * both true. Nothing above can catch it; only reading the bytes back can.
   */
  const lyingStorage = (seed: Record<string, string>) => {
    const data = new Map(Object.entries(seed));
    return {
      data,
      storage: {
        get length() {
          return data.size;
        },
        key: (index: number) => [...data.keys()][index] ?? null,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          /* Accepts the project payload, stores something else. */
          data.set(key, key.startsWith("aranje.project.") ? "{swallowed" : value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
      },
    };
  };

  it("keeps the old key when the payload written is not the payload read", () => {
    const legacyRaw = JSON.stringify(legacySong());
    const { storage, data } = lyingStorage({ [SONG_KEY]: legacyRaw });
    const outcome = settleProjects(storage, clock);

    expect(outcome.notice).toBe("project_migration_failed");
    expect(outcome.canPersist).toBe(false);
    // The one copy of the reader's song is still exactly where it was.
    expect(data.get(SONG_KEY)).toBe(legacyRaw);
  });

  it("refuses to migrate into a first slot holding unreadable bytes", () => {
    /*
     * Not ours to write over. The bytes are somebody's, however broken, and
     * the reader's song is still under the old key — so the safe move is to
     * do nothing and say so.
     */
    const legacyRaw = JSON.stringify(legacySong());
    const occupied = "{someone else's broken record";
    const { storage, data } = fakeStorage({
      [SONG_KEY]: legacyRaw,
      [projectKey(FIRST_PROJECT_ID)!]: occupied,
    });
    const outcome = settleProjects(storage, clock);

    expect(outcome.canPersist).toBe(false);
    expect(data.get(SONG_KEY)).toBe(legacyRaw);
    expect(data.get(projectKey(FIRST_PROJECT_ID)!)).toBe(occupied);
  });

  it("does not migrate on top of a library that already has projects", () => {
    /*
     * A legacy key beside a real library happens after a cleanup that failed.
     * Migrating again would make a second copy of an old song and, worse,
     * could take a live project's key.
     */
    const { storage } = fakeStorage({
      [SONG_KEY]: JSON.stringify(legacySong()),
      [projectKey("project-1")!]: storedProject("project-1", otherSong()),
    });
    const outcome = settleProjects(storage, clock);
    expect(outcome.catalog?.projectIds).toEqual(["project-1"]);
    expect(sameSong(outcome.song, otherSong())).toBe(true);
  });

  it("removes no unreadable payload while rebuilding a broken catalog", () => {
    /*
     * The rebuild leaves out what it cannot verify — and *leaving out* is not
     * *deleting*. A project the app cannot read today may be readable by the
     * version that wrote it, or by a repair later; destroying it because a
     * list about it was damaged is the loss this path exists to prevent.
     */
    const broken = "{unreadable but somebody's";
    const { storage, data } = fakeStorage({
      [CATALOG_KEY]: "{ruined",
      [projectKey("project-1")!]: storedProject("project-1", legacySong()),
      [projectKey("project-2")!]: broken,
    });
    const outcome = settleProjects(storage, clock);

    expect(outcome.catalog?.projectIds).toEqual(["project-1"]);
    expect(data.get(projectKey("project-2")!)).toBe(broken);
  });

  it("acts on no pending note it could not read", () => {
    const { storage, data } = fakeStorage({
      [CATALOG_KEY]: serializeCatalog(initialCatalog("project-1")),
      [projectKey("project-1")!]: storedProject("project-1", legacySong()),
      [projectKey("project-2")!]: storedProject("project-2", otherSong()),
      [PENDING_KEY]: "{not a note",
    });
    settleProjects(storage, clock);
    // Nothing was deleted on a guess. The note itself is left alone: it is
    // not a delete instruction if it cannot be read as one.
    expect(data.has(projectKey("project-2")!)).toBe(true);
  });
});
