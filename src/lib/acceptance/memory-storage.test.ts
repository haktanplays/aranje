import { describe, expect, it } from "vitest";

import { deviceStorageSnapshot } from "@/lib/acceptance/device-storage";
import { createMemoryStorage } from "@/lib/acceptance/memory-storage";

/*
 * The whole point of this storage is that it is not the reader's. These tests
 * hold it to the parts of the `Storage` shape the app actually reaches for —
 * including `length`/`key`, which the orphan scan walks.
 */
describe("createMemoryStorage", () => {
  it("starts empty and reads back what it was given", () => {
    const storage = createMemoryStorage();
    expect(storage.length).toBe(0);
    expect(storage.getItem("aranje.song")).toBeNull();

    storage.setItem("aranje.song", "{}");
    expect(storage.getItem("aranje.song")).toBe("{}");
    expect(storage.length).toBe(1);
  });

  it("seeds from a plain object without sharing it", () => {
    const seed = { "aranje.projects": "catalog" };
    const storage = createMemoryStorage(seed);
    storage.setItem("aranje.projects", "changed");
    expect(seed["aranje.projects"]).toBe("catalog");
    expect(storage.getItem("aranje.projects")).toBe("changed");
  });

  it("removes a key and forgets it entirely", () => {
    const storage = createMemoryStorage({ a: "1", b: "2" });
    storage.removeItem("a");
    expect(storage.getItem("a")).toBeNull();
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe("b");
  });

  it("can be walked by index, like the orphan scan walks localStorage", () => {
    const storage = createMemoryStorage();
    storage.setItem("aranje.project.project-1", "one");
    storage.setItem("aranje.project.project-2", "two");
    const keys = [storage.key(0), storage.key(1), storage.key(2)];
    expect(keys).toEqual([
      "aranje.project.project-1",
      "aranje.project.project-2",
      null,
    ]);
  });

  it("stores values as strings, the way a real Storage does", () => {
    const storage = createMemoryStorage();
    (storage as { setItem(key: string, value: unknown): void }).setItem("n", 7);
    expect(storage.getItem("n")).toBe("7");
  });

  it("snapshots a copy, so a later write cannot change a taken snapshot", () => {
    const storage = createMemoryStorage({ a: "1" });
    const before = storage.snapshot();
    storage.setItem("b", "2");
    expect(before).toEqual({ a: "1" });
    expect(storage.snapshot()).toEqual({ a: "1", b: "2" });
  });
});

describe("deviceStorageSnapshot", () => {
  /*
   * Node has no `window`, which is the case that matters here: a snapshot
   * taken where there is no store must be a value the comparison can use, not
   * a throw that would take the whole watcher down.
   */
  it("is a comparable value even where there is no store at all", () => {
    const first = deviceStorageSnapshot();
    expect(typeof first).toBe("string");
    expect(deviceStorageSnapshot()).toBe(first);
  });
});
