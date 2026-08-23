/**
 * What each command does, and what it refuses to do (2O-A §23).
 *
 * The load-bearing claim of the whole checkpoint is **isolation**: editing one
 * project cannot change another's bytes. So most of these tests take a
 * snapshot of every project's payload, run something, and compare — because
 * "A is unchanged" is a statement about bytes, not about intent.
 */
import { describe, expect, it } from "vitest";

import { legacySong, otherSong } from "../../../eval/projects/fixtures";

import {
  createProject,
  deleteProject,
  duplicateProject,
  importProjectAsNew,
  openProject,
  type ProjectEnv,
} from "@/lib/projects/project-commands";
import {
  initialCatalog,
  serializeCatalog,
  type ProjectCatalogV1,
} from "@/lib/projects/project-catalog";
import {
  CATALOG_KEY,
  PENDING_KEY,
  projectKey,
  readRecord,
} from "@/lib/projects/project-storage";
import { nextRecord, serializeRecord } from "@/lib/projects/project-record";
import { sameSong } from "@/lib/song/edit-history";
import { SONG_TEMPLATES } from "@/lib/song/song-templates";
import type { Song } from "@/lib/song/schema";

const NOW = 1_700_000_000_000;

type Op = { readonly op: "get" | "set" | "remove"; readonly key: string };

function world(
  songs: Record<string, Song>,
  activeId: string,
  failOn?: (op: Op) => boolean,
) {
  const data = new Map<string, string>();
  for (const [id, song] of Object.entries(songs)) {
    data.set(projectKey(id)!, serializeRecord(nextRecord(id, song, { kind: "empty" }, NOW)));
  }
  const ids = Object.keys(songs);
  const catalog: ProjectCatalogV1 = {
    ...initialCatalog(ids[0]!),
    projectIds: ids,
    activeProjectId: activeId,
    nextProjectNumber: ids.length + 1,
  };
  data.set(CATALOG_KEY, serializeCatalog(catalog));

  const ops: Op[] = [];
  const guard = (op: Op) => {
    ops.push(op);
    if (failOn?.(op)) throw new Error("refused");
  };
  const storage = {
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
  };
  const env: ProjectEnv = { storage, catalog, now: NOW };
  return { env, storage, data, ops, catalog };
}

/** Every project payload, as bytes, for an isolation comparison. */
const payloads = (data: Map<string, string>) =>
  JSON.stringify(
    [...data.entries()]
      .filter(([key]) => key.startsWith("aranje.project."))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const names = (ops: readonly Op[]) => ops.map((entry) => `${entry.op} ${entry.key}`);

describe("128. a new project never costs the reader the one they have", () => {
  it("creates each of the three templates and leaves the open project alone", () => {
    for (const template of SONG_TEMPLATES) {
      const { env, data } = world({ "project-1": legacySong() }, "project-1");
      const before = data.get(projectKey("project-1")!);
      const result = createProject(env, template.id);

      expect(result.ok, template.id).toBe(true);
      if (!result.ok) continue;
      expect(result.activeProjectId).toBe("project-2");
      expect(result.catalog.projectIds).toEqual(["project-1", "project-2"]);
      expect(data.get(projectKey("project-1")!)).toBe(before);
    }
  });

  it("writes the payload before the catalog, so an interruption leaves an orphan", () => {
    const { env, ops } = world({ "project-1": legacySong() }, "project-1");
    createProject(env, "empty");
    const order = names(ops);
    expect(order.indexOf("set aranje.project.project-2")).toBeLessThan(
      order.indexOf(`set ${CATALOG_KEY}`),
    );
  });

  it("names new projects deterministically and without colliding", () => {
    const { env, data } = world({ "project-1": legacySong() }, "project-1");
    const first = createProject(env, "empty");
    expect(first.ok && first.song.title).toBe("Yeni Şarkı");

    const second = createProject(
      { ...env, catalog: first.ok ? first.catalog : env.catalog },
      "empty",
    );
    expect(second.ok && second.song.title).toBe("Yeni Şarkı 2");
    expect(data.size).toBeGreaterThan(2);
  });

  it("produces byte-equal candidates five times over", () => {
    const bytes = Array.from({ length: 5 }, () => {
      const { env } = world({ "project-1": legacySong() }, "project-1");
      const result = createProject(env, "rock_band");
      return result.ok ? JSON.stringify(result.song) : "failed";
    });
    for (const line of bytes) expect(line).toBe(bytes[0]);
    expect(bytes[0]).not.toBe("failed");
  });

  it("changes nothing at all when the payload write is refused", () => {
    const { env, data, catalog } = world({ "project-1": legacySong() }, "project-1", (op) =>
      op.op === "set" && op.key === "aranje.project.project-2",
    );
    const before = payloads(data);
    const result = createProject(env, "empty");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("project_storage_write_failed");
    expect(payloads(data)).toBe(before);
    expect(data.get(CATALOG_KEY)).toBe(serializeCatalog(catalog));
  });

  it("reports quota as quota, and keeps the library", () => {
    const quota = () => {
      const error = new Error("QuotaExceededError: full");
      return error;
    };
    const { env, catalog, data } = world({ "project-1": legacySong() }, "project-1", (op) => {
      if (op.op === "set" && op.key === "aranje.project.project-2") throw quota();
      return false;
    });
    const result = createProject(env, "empty");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("project_storage_quota_exceeded");
    expect(data.get(CATALOG_KEY)).toBe(serializeCatalog(catalog));
  });

  it("leaves the reader where they were when the catalog write fails", () => {
    const { env, data, catalog } = world({ "project-1": legacySong() }, "project-1", (op) =>
      op.op === "set" && op.key === CATALOG_KEY,
    );
    const result = createProject(env, "empty");
    expect(result.ok).toBe(false);
    // The catalog still names one project, and it is still the open one.
    expect(data.get(CATALOG_KEY)).toBe(serializeCatalog(catalog));
    // The new payload survives, ready to be adopted rather than lost.
    expect(readRecord(env.storage, "project-2").kind).toBe("record");
  });
});

describe("129. opening a project moves the reader and nothing else", () => {
  it("opens another project and hands back its song", () => {
    const { env, data } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const before = payloads(data);
    const result = openProject(env, "project-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sameSong(result.song, otherSong())).toBe(true);
    expect(result.catalog.activeProjectId).toBe("project-2");
    /* Opening writes no music: only the catalog moved. */
    expect(payloads(data)).toBe(before);
  });

  it("costs exactly one catalog write and no payload write", () => {
    const { env, ops } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    openProject(env, "project-2");
    const sets = names(ops).filter((name) => name.startsWith("set "));
    expect(sets).toEqual([`set ${CATALOG_KEY}`]);
  });

  it("refuses a project that is not in the library", () => {
    const { env } = world({ "project-1": legacySong() }, "project-1");
    const result = openProject(env, "project-9");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("project_not_found");
  });

  it("does not move the catalog when the target cannot be read", () => {
    const { env, data, catalog } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    data.set(projectKey("project-2")!, "{ruined");
    const result = openProject(env, "project-2");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("project_corrupt");
    expect(data.get(CATALOG_KEY)).toBe(serializeCatalog(catalog));
  });

  it("leaves a future-version project closed and untouched", () => {
    const { env, data } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const raw = JSON.stringify({ format: "aranje.project-record", version: 9 });
    data.set(projectKey("project-2")!, raw);
    const result = openProject(env, "project-2");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("project_future_version");
    expect(data.get(projectKey("project-2")!)).toBe(raw);
  });
});

describe("130. a duplicate is a new project, not a second pointer at an old one", () => {
  it("copies the music and never touches the source", () => {
    const { env, data } = world({ "project-1": legacySong() }, "project-1");
    const before = data.get(projectKey("project-1")!);
    const result = duplicateProject(env, "project-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activeProjectId).toBe("project-2");
    expect(data.get(projectKey("project-1")!)).toBe(before);
    expect(result.song.title).toBe("Eski Şarkı kopyası");
    expect(result.song.sections).toEqual(legacySong().sections);
  });

  it("gives the copy no recovery rung of its own", () => {
    /*
     * A duplicate that inherited `previous` would let an undo inside the copy
     * produce a song that belongs to the original's history.
     */
    const { env } = world({ "project-1": legacySong() }, "project-1");
    const result = duplicateProject(env, "project-1");
    expect(result.ok).toBe(true);
    const copy = readRecord(env.storage, "project-2");
    expect(copy.kind).toBe("record");
    if (copy.kind !== "record") return;
    expect(copy.previous).toBeNull();
    expect(copy.revision).toBe(1);
  });

  it("does not invent slot arrays for tracks a bar never wrote", () => {
    const sparse: Song = {
      ...legacySong(),
      sections: legacySong().sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar) => ({ ...bar, slots: {} })),
      })),
    };
    const { env } = world({ "project-1": sparse }, "project-1");
    const result = duplicateProject(env, "project-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const section of result.song.sections) {
      for (const bar of section.bars) expect(Object.keys(bar.slots)).toEqual([]);
    }
  });
});

describe("131. importing a file adds a project and changes no other", () => {
  it("adds the imported song as a new project", () => {
    const { env, data } = world({ "project-1": legacySong() }, "project-1");
    const before = data.get(projectKey("project-1")!);
    const result = importProjectAsNew(env, otherSong());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sameSong(result.song, otherSong())).toBe(true);
    expect(data.get(projectKey("project-1")!)).toBe(before);
  });

  it("accepts a second project with the same title", () => {
    // Titles are not identity. Ids are, and these have different ones.
    const { env } = world({ "project-1": legacySong() }, "project-1");
    const result = importProjectAsNew(env, legacySong());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.title).toBe("Eski Şarkı");
    expect(result.catalog.projectIds).toEqual(["project-1", "project-2"]);
  });

  it("refuses a song the validators reject, atomically", () => {
    const broken = { ...legacySong(), tracks: [] } as unknown as Song;
    const { env, data, catalog } = world({ "project-1": legacySong() }, "project-1");
    const before = payloads(data);
    const result = importProjectAsNew(env, broken);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("project_validation_failed");
    expect(payloads(data)).toBe(before);
    expect(data.get(CATALOG_KEY)).toBe(serializeCatalog(catalog));
  });
});

describe("132. deleting is permanent, guarded, and never leaves an unreachable payload", () => {
  it("refuses to remove the last project", () => {
    const { env, data } = world({ "project-1": legacySong() }, "project-1");
    const before = payloads(data);
    const result = deleteProject(env, "project-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("cannot_delete_last_project");
    expect(payloads(data)).toBe(before);
  });

  it("removes an inactive project without moving the reader", () => {
    const { env, data } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const result = deleteProject(env, "project-2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activeProjectId).toBe("project-1");
    expect(data.has(projectKey("project-2")!)).toBe(false);
    expect(data.has(PENDING_KEY)).toBe(false);
  });

  it("picks the survivor deterministically when the open project goes", () => {
    /*
     * The project that takes the deleted one's index, or the one before it —
     * the same rule sections and tracks already use.
     */
    const three = () =>
      world(
        {
          "project-1": legacySong(),
          "project-2": otherSong(),
          "project-3": legacySong(),
        },
        "project-2",
      );
    const middle = three();
    const afterMiddle = deleteProject(middle.env, "project-2");
    expect(afterMiddle.ok && afterMiddle.activeProjectId).toBe("project-3");

    const last = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-2",
    );
    const afterLast = deleteProject(last.env, "project-2");
    expect(afterLast.ok && afterLast.activeProjectId).toBe("project-1");
  });

  it("writes the note, then the catalog, then removes the payload", () => {
    const { env, ops } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    deleteProject(env, "project-2");
    const order = names(ops).filter(
      (name) => name.includes(PENDING_KEY) || name.includes(CATALOG_KEY) || name.includes("project.project-2"),
    );
    expect(order).toEqual([
      `set ${PENDING_KEY}`,
      `set ${CATALOG_KEY}`,
      `get ${CATALOG_KEY}`,
      "remove aranje.project.project-2",
      `remove ${PENDING_KEY}`,
    ]);
  });

  it("keeps both projects when the catalog write fails", () => {
    const { env, data, catalog } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
      (op) => op.op === "set" && op.key === CATALOG_KEY,
    );
    const result = deleteProject(env, "project-2");
    expect(result.ok).toBe(false);
    expect(data.has(projectKey("project-2")!)).toBe(true);
    expect(data.get(CATALOG_KEY)).toBe(serializeCatalog(catalog));
    expect(data.has(PENDING_KEY)).toBe(false);
  });

  it("says the operation is incomplete when the payload cannot be removed", () => {
    const { env, data } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
      (op) => op.op === "remove" && op.key === "aranje.project.project-2",
    );
    const result = deleteProject(env, "project-2");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("project_operation_incomplete");
    /* The bytes are still there and will be adopted back rather than stranded. */
    expect(data.has(projectKey("project-2")!)).toBe(true);
  });

  it("refuses when the survivor cannot be opened", () => {
    const { env, data } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-2",
    );
    data.set(projectKey("project-1")!, "{ruined");
    const before = payloads(data);
    const result = deleteProject(env, "project-2");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("cannot_delete_active_without_survivor");
    expect(payloads(data)).toBe(before);
  });
});

describe("133. one project's edits never reach another's bytes", () => {
  it("keeps A byte-equal across a full round trip through B", () => {
    const { env, data } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const aBefore = data.get(projectKey("project-1")!);

    const opened = openProject(env, "project-2");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const back = openProject({ ...env, catalog: opened.catalog }, "project-1");
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    expect(data.get(projectKey("project-1")!)).toBe(aBefore);
    expect(sameSong(back.song, legacySong())).toBe(true);
  });

  it("touches only the new key when a project is added", () => {
    const { env, ops } = world(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    createProject(env, "empty");
    const written = names(ops).filter((name) => name.startsWith("set aranje.project."));
    expect(written).toEqual(["set aranje.project.project-3"]);
  });
});
