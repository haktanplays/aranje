/**
 * The open project's store: one write, one history, one tab (2O-A §23).
 *
 * Four claims, and each of them is about a *count* or a byte rather than a
 * feeling: a commit costs exactly one project-slot write, a project switch
 * leaves no undo step behind that could reach across it, a tab whose project
 * moved under it writes nothing at all, and a project whose record went
 * unreadable is left exactly as it is rather than finished off.
 */
import { describe, expect, it } from "vitest";

import { legacySong, otherSong } from "../../../eval/projects/fixtures";

import { createActiveProjectPort } from "@/lib/projects/active-project";
import { createProjectSession } from "@/lib/projects/project-session";
import {
  CATALOG_KEY,
  projectKey,
  readRecord,
} from "@/lib/projects/project-storage";
import { initialCatalog, serializeCatalog } from "@/lib/projects/project-catalog";
import { nextRecord, serializeRecord } from "@/lib/projects/project-record";
import { createSongStore } from "@/lib/song/song-store";
import { sameSong } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";

const NOW = 1_700_000_000_000;
const now = () => NOW;

type Op = { readonly op: "get" | "set" | "remove"; readonly key: string };

function library(songs: Record<string, Song>, activeId: string) {
  const data = new Map<string, string>();
  for (const [id, song] of Object.entries(songs)) {
    data.set(projectKey(id)!, serializeRecord(nextRecord(id, song, { kind: "empty" }, NOW)));
  }
  const ids = Object.keys(songs);
  data.set(
    CATALOG_KEY,
    serializeCatalog({
      ...initialCatalog(ids[0]!),
      projectIds: ids,
      activeProjectId: activeId,
      nextProjectNumber: ids.length + 1,
    }),
  );
  const ops: Op[] = [];
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => {
      ops.push({ op: "get", key });
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      ops.push({ op: "set", key });
      data.set(key, value);
    },
    removeItem: (key: string) => {
      ops.push({ op: "remove", key });
      data.delete(key);
    },
  };
  return { storage, data, ops };
}

const retitle = (song: Song, title: string): Song => ({ ...song, title });

describe("134. a commit writes one project slot and no other key", () => {
  it("saves the open project and touches nothing else", () => {
    const { storage, ops } = library(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const session = createProjectSession(storage, now);
    ops.length = 0;

    const changed = session.store.commit(retitle(legacySong(), "Yeni Ad"), {
      kind: "lifecycle",
      command: "update_song_info",
    });
    expect(changed).toBe(true);

    const sets = ops.filter((entry) => entry.op === "set").map((entry) => entry.key);
    expect(sets).toEqual(["aranje.project.project-1"]);
  });

  it("leaves the other project byte-equal", () => {
    const { storage, data } = library(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const before = data.get(projectKey("project-2")!);
    const session = createProjectSession(storage, now);
    session.store.commit(retitle(legacySong(), "Yeni Ad"), { kind: "lifecycle", command: "update_song_info" });
    expect(data.get(projectKey("project-2")!)).toBe(before);
  });

  it("keeps the rung below it, per project", () => {
    const { storage } = library({ "project-1": legacySong() }, "project-1");
    const session = createProjectSession(storage, now);
    session.store.commit(retitle(legacySong(), "Bir"), { kind: "lifecycle", command: "update_song_info" });
    session.store.commit(retitle(legacySong(), "İki"), { kind: "lifecycle", command: "update_song_info" });

    const record = readRecord(storage, "project-1");
    expect(record.kind).toBe("record");
    if (record.kind !== "record") return;
    expect(record.song.title).toBe("İki");
    expect(record.previous?.title).toBe("Bir");
  });
});

describe("135. undo and redo cannot cross a project boundary", () => {
  it("starts the new project with nothing behind it", () => {
    const { storage } = library(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const session = createProjectSession(storage, now);

    session.store.commit(retitle(legacySong(), "A düzenlendi"), { kind: "lifecycle", command: "update_song_info" });
    expect(session.store.getSnapshot().canUndo).toBe(true);

    const record = readRecord(storage, "project-2");
    if (record.kind !== "record") throw new Error("fixture");
    session.openProject("project-2", record.song, {
      ...initialCatalog("project-1"),
      projectIds: ["project-1", "project-2"],
      activeProjectId: "project-2",
      nextProjectNumber: 3,
    });

    const snapshot = session.store.getSnapshot();
    expect(sameSong(snapshot.song, otherSong())).toBe(true);
    expect(snapshot.canUndo).toBe(false);
    expect(snapshot.undoDepth).toBe(0);
    expect(snapshot.redoDepth).toBe(0);
  });

  it("cannot undo its way back into the project it left", () => {
    const { storage, data } = library(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const session = createProjectSession(storage, now);
    session.store.commit(retitle(legacySong(), "A düzenlendi"), { kind: "lifecycle", command: "update_song_info" });

    const record = readRecord(storage, "project-2");
    if (record.kind !== "record") throw new Error("fixture");
    session.openProject("project-2", record.song, {
      ...initialCatalog("project-1"),
      projectIds: ["project-1", "project-2"],
      activeProjectId: "project-2",
      nextProjectNumber: 3,
    });

    const aAfterSwitch = data.get(projectKey("project-1")!);
    session.store.undo();
    session.store.undo();
    /* A's bytes are exactly what B's session found them as. */
    expect(data.get(projectKey("project-1")!)).toBe(aAfterSwitch);
    expect(sameSong(session.store.getSnapshot().song, otherSong())).toBe(true);
  });

  it("writes the edit into the project that is now open, not the old one", () => {
    const { storage } = library(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const session = createProjectSession(storage, now);
    const record = readRecord(storage, "project-2");
    if (record.kind !== "record") throw new Error("fixture");
    session.openProject("project-2", record.song, {
      ...initialCatalog("project-1"),
      projectIds: ["project-1", "project-2"],
      activeProjectId: "project-2",
      nextProjectNumber: 3,
    });

    session.store.commit(retitle(otherSong(), "B düzenlendi"), { kind: "lifecycle", command: "update_song_info" });

    const a = readRecord(storage, "project-1");
    const b = readRecord(storage, "project-2");
    expect(a.kind === "record" && a.song.title).toBe("Eski Şarkı");
    expect(b.kind === "record" && b.song.title).toBe("B düzenlendi");
  });
});

describe("136. a tab whose project moved under it writes nothing", () => {
  it("refuses the commit when the revision on disk has advanced", () => {
    const { storage, data } = library({ "project-1": legacySong() }, "project-1");
    const port = createActiveProjectPort({ storage, id: "project-1", revision: 1, now });
    const store = createSongStore(
      { song: legacySong(), outcome: "stored", canPersist: true },
      storage,
      port,
    );

    /* Another tab saves. The revision on disk is now 2, this tab still holds 1. */
    data.set(
      projectKey("project-1")!,
      serializeRecord(nextRecord("project-1", otherSong(), { kind: "empty" }, NOW)).replace(
        '"revision":1',
        '"revision":2',
      ),
    );
    const before = data.get(projectKey("project-1")!);

    const changed = store.commit(retitle(legacySong(), "Bayat sekme"), {
      kind: "lifecycle",
      command: "update_song_info",
    });

    expect(changed).toBe(false);
    expect(data.get(projectKey("project-1")!)).toBe(before);
    expect(port.isStale()).toBe(true);
  });

  it("says nothing is stale while this tab is the only writer", () => {
    const { storage } = library({ "project-1": legacySong() }, "project-1");
    const port = createActiveProjectPort({ storage, id: "project-1", revision: 1, now });
    const store = createSongStore(
      { song: legacySong(), outcome: "stored", canPersist: true },
      storage,
      port,
    );
    expect(port.isStale()).toBe(false);
    expect(store.commit(retitle(legacySong(), "Bir"), { kind: "lifecycle", command: "update_song_info" })).toBe(true);
    expect(port.isStale()).toBe(false);
    expect(store.commit(retitle(legacySong(), "İki"), { kind: "lifecycle", command: "update_song_info" })).toBe(true);
    expect(port.isStale()).toBe(false);
  });

  it("does not call an unreadable record stale", () => {
    /*
     * Telling a reader to refresh will not help if the record is broken, and
     * it would hide the real problem behind the wrong sentence.
     */
    const { storage, data } = library({ "project-1": legacySong() }, "project-1");
    const port = createActiveProjectPort({ storage, id: "project-1", revision: 1, now });
    data.set(projectKey("project-1")!, "{ruined");
    expect(port.isStale()).toBe(false);
  });
});

describe("145. a project whose record went bad is not written over", () => {
  /*
   * The record is the only copy of that project's music. If it becomes
   * unreadable while the tab is open — a truncated write, a device that
   * mangled a key — the next commit must not finish the loss by putting a
   * fresh song where the broken bytes are. Recovery has to be a decision the
   * reader is shown, not a side effect of typing one more note.
   */
  const broken = '{"format":"aranje.project","version":1,"song":{"tit';

  it("refuses the commit and leaves the broken bytes exactly as they are", () => {
    const { storage, data } = library({ "project-1": legacySong() }, "project-1");
    const port = createActiveProjectPort({ storage, id: "project-1", revision: 1, now });
    const store = createSongStore(
      { song: legacySong(), outcome: "stored", canPersist: true },
      storage,
      port,
    );

    data.set(projectKey("project-1")!, broken);

    const changed = store.commit(retitle(legacySong(), "Bozuk kayıt"), {
      kind: "lifecycle",
      command: "update_song_info",
    });

    expect(changed).toBe(false);
    expect(data.get(projectKey("project-1")!)).toBe(broken);
  });

  it("keeps the reader's song on screen and says the write did not land", () => {
    const { storage, data } = library({ "project-1": legacySong() }, "project-1");
    const port = createActiveProjectPort({ storage, id: "project-1", revision: 1, now });
    const store = createSongStore(
      { song: legacySong(), outcome: "stored", canPersist: true },
      storage,
      port,
    );
    data.set(projectKey("project-1")!, broken);
    store.commit(retitle(legacySong(), "Bozuk kayıt"), {
      kind: "lifecycle",
      command: "update_song_info",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.persisted).toBe(false);
    expect(sameSong(snapshot.song, legacySong())).toBe(true);
    /* A full-device message would be a lie, and a stack trace is not a message. */
    expect(snapshot.recoveryMessage ?? "").not.toContain("project");
    expect(snapshot.recoveryMessage ?? "").not.toContain("JSON");
  });

  it("does not touch any other key while refusing", () => {
    const { storage, data, ops } = library(
      { "project-1": legacySong(), "project-2": otherSong() },
      "project-1",
    );
    const port = createActiveProjectPort({ storage, id: "project-1", revision: 1, now });
    const store = createSongStore(
      { song: legacySong(), outcome: "stored", canPersist: true },
      storage,
      port,
    );
    data.set(projectKey("project-1")!, broken);
    ops.length = 0;

    store.commit(retitle(legacySong(), "Bozuk kayıt"), {
      kind: "lifecycle",
      command: "update_song_info",
    });

    expect(ops.filter((entry) => entry.op === "set")).toEqual([]);
    expect(ops.filter((entry) => entry.op === "remove")).toEqual([]);
  });
});
