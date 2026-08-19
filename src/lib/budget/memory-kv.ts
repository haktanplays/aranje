/**
 * An in-memory counter store for tests (spec 12.2's interface, not its
 * deployment).
 *
 * Two properties matter and both are deliberate:
 *
 * - `transact` really is serialised. Calls queue behind one another, so a test
 *   that fires two requests at once exercises the same contention a Lua script
 *   would, and a racy caller fails here rather than in production.
 * - TTLs are read from the injected clock, so "the day rolled over" is a
 *   single `advance()` rather than a wait.
 *
 * `failing` makes the store unreachable, which is the only way to test the
 * fail-closed rule of spec 12.3.
 */
import type { Clock } from "@/lib/budget/clock";
import {
  KvUnavailableError,
  type KvStore,
  type KvTransaction,
} from "@/lib/budget/kv";

type Entry = { value: string; expiresAtMs: number | null };

export type MemoryKv = KvStore & {
  /** Turn the store on and off, to prove the fail-closed path. */
  setAvailable(available: boolean): void;
  /** Every key currently held, for assertions about the key schema. */
  keys(): string[];
  raw(key: string): string | null;
  /** How many transactions have run, for concurrency assertions. */
  transactionCount(): number;
};

export function createMemoryKv(clock: Clock): MemoryKv {
  const store = new Map<string, Entry>();
  let available = true;
  let transactions = 0;
  // One promise chain: every transaction waits for the previous one to finish.
  let queue: Promise<unknown> = Promise.resolve();

  const live = (key: string): string | null => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= clock.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  };

  const run = <T>(keys: readonly string[], body: KvTransaction<T>): T => {
    if (!available) throw new KvUnavailableError();
    transactions += 1;

    const current = new Map<string, string | null>();
    for (const key of keys) current.set(key, live(key));

    const { writes, result } = body(current);
    for (const write of writes) {
      if ("delete" in write) {
        store.delete(write.key);
        continue;
      }
      store.set(write.key, {
        value: write.value,
        expiresAtMs:
          write.ttlSeconds === undefined
            ? null
            : clock.now() + write.ttlSeconds * 1000,
      });
    }
    return result;
  };

  return {
    async get(key) {
      if (!available) throw new KvUnavailableError();
      return live(key);
    },
    transact<T>(keys: readonly string[], body: KvTransaction<T>): Promise<T> {
      const next = queue.then(
        () => run(keys, body),
        () => run(keys, body),
      );
      // Keep the chain alive even when a caller lets a rejection through.
      queue = next.catch(() => undefined);
      return next;
    },
    setAvailable(value) {
      available = value;
    },
    keys() {
      return [...store.keys()]
        .filter((key) => live(key) !== null)
        .sort();
    },
    raw(key) {
      return live(key);
    },
    transactionCount: () => transactions,
  };
}
