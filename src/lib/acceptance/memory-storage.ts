/**
 * A storage the guided acceptance page owns, and nothing else can see.
 *
 * The Android acceptance route runs the **real** workspace — the real tab, the
 * real transport, the real audio engine — on a fixed riff. What it must not do
 * is touch the reader's own music: not a key written, not a history step, not
 * a project renamed, and nothing at all surviving a refresh.
 *
 * The app already asks for its storage rather than reaching for
 * `window.localStorage` in five places, so the honest way to get that is to
 * hand it one made of a `Map`. Every write the workspace makes during the test
 * lands here and dies with the tab.
 */
export type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
  /** What the page wrote, for the acceptance run to report. */
  snapshot(): Record<string, string>;
  /** Every physical mutation, in order. Reads and equal-value writes are not hidden. */
  journal(): readonly MemoryStorageMutation[];
  /**
   * Return the disposable fixture to an exact checkpoint without pretending
   * the cleanup was a production Song write.
   */
  restore(snapshot: Readonly<Record<string, string>>): void;
};

export type MemoryStorageMutation = {
  readonly kind: "set" | "remove";
  readonly key: string;
  readonly before: string | null;
  readonly after: string | null;
};

export function createMemoryStorage(
  seed: Readonly<Record<string, string>> = {},
): MemoryStorage {
  const entries = new Map<string, string>(Object.entries(seed));
  const mutations: MemoryStorageMutation[] = [];
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      const next = String(value);
      mutations.push({
        kind: "set",
        key,
        before: entries.get(key) ?? null,
        after: next,
      });
      entries.set(key, next);
    },
    removeItem: (key) => {
      mutations.push({
        kind: "remove",
        key,
        before: entries.get(key) ?? null,
        after: null,
      });
      entries.delete(key);
    },
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    snapshot: () => Object.fromEntries(entries),
    journal: () => mutations.map((entry) => ({ ...entry })),
    restore: (snapshot) => {
      entries.clear();
      for (const [key, value] of Object.entries(snapshot)) entries.set(key, value);
    },
  };
}
