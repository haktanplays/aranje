/**
 * What the request path is allowed to reach at run time.
 *
 * This checkpoint deliberately wires no provider and no counter store. Spec
 * 12.3 says an unreachable counter store means the request is refused, and a
 * build with no adapter has nothing to ask, so `resolveRuntime` returns a
 * reason rather than improvising.
 *
 * An in-process counter would be worse than none. Spec 12.2: "serverless'ta
 * in-memory sayaç her instance'ta sıfırlanır ve fail-closed garantisi kâğıt
 * üstünde kalır." So there is no in-memory fallback here; the fake store lives
 * in the tests, where it is honest.
 */
import type { Adapter } from "@/lib/ai/adapter";
import type { Clock } from "@/lib/budget/clock";
import type { KvStore } from "@/lib/budget/kv";
import type { CopilotErrorCode } from "@/lib/copilot/errors";

export type Runtime = { kv: KvStore; adapter: Adapter; clock: Clock };

export type RuntimeResolution =
  | { ok: true; runtime: Runtime }
  | { ok: false; code: CopilotErrorCode; diagnostic: string };

type RuntimeFactory = () => RuntimeResolution;

let factory: RuntimeFactory = () => ({
  ok: false,
  code: "provider_unavailable",
  diagnostic:
    "no provider adapter and no counter store are wired in this build",
});

/** Registered by a deployment that has a real store and a real adapter. */
export function registerRuntimeFactory(next: RuntimeFactory): void {
  factory = next;
}

export function resolveRuntime(): RuntimeResolution {
  return factory();
}
