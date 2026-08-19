/**
 * A deterministic stand-in for a provider.
 *
 * This checkpoint proves the validation, budget, idempotency and error
 * semantics *before* a provider is wired, so the adapter under test has to be
 * able to produce, on demand, every answer a real one can: a good patch, a
 * broken one, a timeout, a dropped connection, and — the case that decides how
 * the budget behaves — a success whose token usage cannot be read back.
 *
 * It has no network, no timers that depend on wall-clock drift and no
 * randomness. A scenario list is played back in order, so a test that runs the
 * pipeline three times knows exactly what the third call answers.
 */
import type {
  Adapter,
  AdapterRequest,
  AdapterResult,
  AdapterUsage,
} from "@/lib/ai/adapter";

export type FakeScenario =
  /** A well-formed answer with verified usage. */
  | { kind: "success"; raw: string; usage: AdapterUsage }
  /** Billed, but the usage could not be read back (spec 12.3). */
  | { kind: "success_unverified_usage"; raw: string; reason: string }
  /** Answered, but not with anything that parses. */
  | { kind: "invalid_output"; raw: string; usage?: AdapterUsage }
  | { kind: "timeout" }
  | { kind: "network_error"; diagnostic?: string }
  | { kind: "aborted" }
  | { kind: "provider_error"; diagnostic?: string };

export type FakeAdapter = Adapter & {
  /** Every request the adapter was asked to make, in order. */
  readonly calls: readonly AdapterRequest[];
  /** How many scenarios are still queued. */
  remaining(): number;
};

const DEFAULT_USAGE: AdapterUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function createFakeAdapter(
  scenarios: readonly FakeScenario[],
  options: {
    id?: string;
    /**
     * Awaited before the scenario is answered. A test that needs a call to be
     * genuinely in flight while another request arrives holds it here, rather
     * than hoping the microtask order comes out a particular way.
     */
    beforeAnswer?: () => Promise<void>;
  } = {},
): FakeAdapter {
  const queue = [...scenarios];
  const calls: AdapterRequest[] = [];

  return {
    id: options.id ?? "fake",
    calls,
    remaining: () => queue.length,
    async call(request) {
      calls.push(request);

      // An abort that has already happened is answered as an abort, whatever
      // the queued scenario says: that is what a real client disconnect does.
      if (request.signal?.aborted) {
        return { ok: false, kind: "aborted" };
      }

      if (options.beforeAnswer) await options.beforeAnswer();

      const scenario = queue.shift();
      if (!scenario) {
        throw new Error(
          `fake adapter called ${calls.length} times but only ${scenarios.length} scenarios were queued`,
        );
      }

      return resolve(scenario);
    },
  };
}

function resolve(scenario: FakeScenario): AdapterResult {
  switch (scenario.kind) {
    case "success":
      return { ok: true, raw: scenario.raw, usage: scenario.usage };
    case "success_unverified_usage":
      return {
        ok: true,
        raw: scenario.raw,
        usage: null,
        usageUnverifiedReason: scenario.reason,
      };
    case "invalid_output":
      return {
        ok: true,
        raw: scenario.raw,
        usage: scenario.usage ?? DEFAULT_USAGE,
      };
    case "timeout":
      return { ok: false, kind: "timeout" };
    case "network_error":
      return {
        ok: false,
        kind: "network",
        ...(scenario.diagnostic === undefined
          ? {}
          : { diagnostic: scenario.diagnostic }),
      };
    case "aborted":
      return { ok: false, kind: "aborted" };
    case "provider_error":
      return {
        ok: false,
        kind: "provider_error",
        ...(scenario.diagnostic === undefined
          ? {}
          : { diagnostic: scenario.diagnostic }),
      };
  }
}

/** Usage a test can reach for when the numbers themselves do not matter. */
export function fakeUsage(overrides: Partial<AdapterUsage> = {}): AdapterUsage {
  return { ...DEFAULT_USAGE, ...overrides };
}

/**
 * The adapter a build with no provider wired must use. It refuses every call,
 * so "no provider configured" can never look like "the model said nothing".
 */
export const unavailableAdapter: Adapter = {
  id: "unavailable",
  async call() {
    return {
      ok: false,
      kind: "provider_error",
      diagnostic: "no provider adapter is wired in this build",
    };
  },
};
