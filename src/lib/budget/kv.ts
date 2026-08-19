/**
 * The counter store, behind an interface (spec 12.2, K-7).
 *
 * Spec 12.2 puts spend counters, per-user quota, rate-limit windows and the
 * prompt cache in a shared KV store, and says in as many words that it is not
 * a database, not auth and not where songs live.
 *
 * The one operation that cannot be faked with get-then-set is `transact`.
 * Spec 12.3: the daily and monthly budgets are checked and incremented "aynı
 * transaction / Lua script'i içinde", with no window between the check and the
 * increment. That is why the interface exposes an atomic read-modify-write
 * over a named key set rather than a plain get and set: a Redis backend
 * implements it as one Lua script, and a test backend implements it as a
 * queue, but callers cannot write the racy version by accident.
 *
 * Unreachable is not the same as empty. Spec 12.3: "KV erişilemiyorsa AI
 * çağrısı yapılmaz." Implementations throw `KvUnavailableError`, and the
 * pipeline turns that into a refusal, never into "no limit found".
 */

export class KvUnavailableError extends Error {
  constructor(message = "counter store unreachable") {
    super(message);
    this.name = "KvUnavailableError";
  }
}

export type KvWrite =
  | { key: string; value: string; ttlSeconds?: number }
  | { key: string; delete: true };

export type KvTransaction<T> = (
  current: ReadonlyMap<string, string | null>,
) => { writes: readonly KvWrite[]; result: T };

export type KvStore = {
  get(key: string): Promise<string | null>;
  /**
   * Read `keys`, decide, and write — atomically with respect to every other
   * `transact` on this store. The callback must be pure: it may be replayed.
   */
  transact<T>(keys: readonly string[], run: KvTransaction<T>): Promise<T>;
};
