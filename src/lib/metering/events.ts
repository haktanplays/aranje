/**
 * Metering (spec 12.4).
 *
 * "Request öncesi tahmini token kontrolü; request sonrası gerçek
 * input/output/cache token ve tahmini USD maliyeti kaydı yapılır." This is
 * that record, and it is a local, pure data model: no analytics service is
 * attached and none is contacted.
 *
 * What is not here is as deliberate as what is. There is no field for the
 * prompt, the song, a section, a note list, a title, an API key or a raw
 * caller id — and because the event is written through a `strictObject`, one
 * cannot be added by accident on the way past. The caller is present only as
 * the hashed subject the counters already use.
 *
 * Costs are micro-dollars, from the one cost model in `@/lib/budget/cost`, so
 * a metering row and a budget counter can never disagree about what a request
 * cost.
 */
import { z } from "zod";

import { COPILOT_ERROR_CODES } from "@/lib/copilot/errors";

export const LATENCY_CLASSES = ["fast", "normal", "slow", "timeout"] as const;
export type LatencyClass = (typeof LATENCY_CLASSES)[number];

/** Operational buckets for dashboards, not a spec figure. */
export function latencyClassFor(ms: number): LatencyClass {
  if (ms < 1500) return "fast";
  if (ms < 5000) return "normal";
  return "slow";
}

const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
});

export const meteringEventSchema = z.strictObject({
  requestId: z.string().min(1),
  /** Hashed caller, the same pseudonym the counters use. Never the raw id. */
  subjectHash: z.string().min(1),
  idempotency: z.enum(["fresh", "replay", "in_flight", "conflict"]),
  adapterRoute: z.enum(["default", "cheap", "none"]),
  adapterId: z.string().min(1),
  model: z.string(),
  priceTableVersion: z.string(),
  /** Worst case taken up front (spec 12.3). */
  reservedMicros: z.number().int().nonnegative(),
  /** Summed real usage, or null when it could not be verified. */
  verifiedUsage: usageSchema.nullable(),
  /** What the reservation was finally settled at. */
  settledMicros: z.number().int().nonnegative().nullable(),
  /** Returned to the window; zero whenever usage was unverifiable. */
  refundedMicros: z.number().int().nonnegative(),
  /** Why usage could not be verified, in fixed words, never provider text. */
  unverifiedReason: z
    .enum([
      "provider_reported_no_usage",
      "provider_timeout",
      "provider_network_error",
      "request_aborted",
      "provider_error",
    ])
    .nullable(),
  cache: z.enum(["hit", "miss"]),
  /** Model calls actually made, 0..3 (spec 11.4). */
  rounds: z.number().int().min(0).max(3),
  /** Sum of the rounds' real costs (spec 18), not rounds x average. */
  totalRoundCostMicros: z.number().int().nonnegative(),
  validation: z.enum(["passed", "passed_with_warnings", "failed", "not_run"]),
  validationErrorCodes: z.array(z.string()),
  latencyClass: z.enum(LATENCY_CLASSES),
  outcome: z.enum(["success", "refused", "failed"]),
  errorCode: z.enum(COPILOT_ERROR_CODES).nullable(),
});

export type MeteringEvent = z.infer<typeof meteringEventSchema>;

export type MeteringSink = (event: MeteringEvent) => void;

/**
 * The only way an event is emitted. Parsing through the schema drops nothing
 * silently — an unexpected field throws here rather than being written out.
 */
export function emitMeteringEvent(sink: MeteringSink, event: MeteringEvent): void {
  sink(meteringEventSchema.parse(event));
}

/** Collects events in memory, for tests and for a local `?debug=1` view. */
export function createMemoryMeter(): MeteringSink & {
  events: MeteringEvent[];
} {
  const events: MeteringEvent[] = [];
  const sink = ((event: MeteringEvent) => {
    events.push(event);
  }) as MeteringSink & { events: MeteringEvent[] };
  sink.events = events;
  return sink;
}
