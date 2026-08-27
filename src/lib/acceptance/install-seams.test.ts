import { describe, expect, it } from "vitest";

import { createMemoryStorage } from "@/lib/acceptance/memory-storage";
import {
  getProjectSession,
  installProjectSession,
} from "@/lib/projects/project-session";
import {
  getSettingsStore,
  installSettingsStore,
} from "@/lib/settings/use-settings";

/*
 * Two singletons, and the whole storage isolation of the guided Android route
 * rests on both of them accepting an install and then refusing every later
 * one. The refusal is the load-bearing half: an installer that quietly
 * returned the existing session would let the acceptance page believe it was
 * running on its own `Map` while the real workspace wrote to `localStorage`.
 *
 * Each installer is tested in its own file-scoped process, because a module
 * singleton cannot be un-installed — that is the property, not a limitation.
 */
describe("installProjectSession", () => {
  const storage = createMemoryStorage();

  it("takes the storage it is given when nothing has claimed the session", () => {
    expect(installProjectSession(storage, () => 1_700_000_000_000)).toBe(true);
  });

  it("hands that same session to every later reader", () => {
    const session = getProjectSession();
    session.store.replaceBaseline(session.store.getSnapshot().song);
    expect(getProjectSession()).toBe(session);
  });

  it("refuses a second install rather than swapping underneath the app", () => {
    const other = createMemoryStorage();
    expect(installProjectSession(other, () => 1)).toBe(false);
    expect(other.length).toBe(0);
  });
});

describe("installSettingsStore", () => {
  const storage = createMemoryStorage();

  it("takes the storage it is given when nothing has claimed the store", () => {
    expect(installSettingsStore(storage)).toBe(true);
  });

  it("writes the practice speed to that storage and nowhere else", () => {
    const store = getSettingsStore();
    store.setPracticeRatePercent(70);
    expect(store.getSnapshot().practiceRatePercent).toBe(70);
    expect(Object.keys(storage.snapshot()).length).toBeGreaterThan(0);
  });

  it("refuses a second install", () => {
    const other = createMemoryStorage();
    expect(installSettingsStore(other)).toBe(false);
    expect(other.length).toBe(0);
  });
});
