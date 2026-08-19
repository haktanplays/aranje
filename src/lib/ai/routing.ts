/**
 * Which model answers which task (spec 11.2, K-1).
 *
 * The rule that matters is the one that was reversed in K-1: there is no
 * "try the cheap model first and fall back". Every musical patch goes straight
 * to `ARANJE_MODEL_DEFAULT`. Starting cheap and climbing back costs more,
 * takes longer and gets rejected more often.
 *
 * The cheap model exists only for future non-creative helper tasks, only
 * behind `ARANJE_ENABLE_CHEAP_ROUTING=true`, and only for the tasks named in
 * spec 11.2/3. On top of that, spec 11.2/4 requires the dated cheap model id
 * to have been verified against the Models API before the flag may be turned
 * on, so an unverified id fails closed to the default model rather than
 * silently routing somewhere unproven.
 */

export type CopilotTask =
  /** Anything musical: riffs, harmony, bass, drums (spec 11.2/1). */
  | "musical_patch"
  /** The helper tasks spec 11.2/3 names, and nothing beyond them. */
  | "intent_classification"
  | "style_selection"
  | "context_summary";

/** Spec 11.2/3, written out so the list cannot grow by accident. */
export const CHEAP_ROUTING_WHITELIST: readonly CopilotTask[] = [
  "intent_classification",
  "style_selection",
  "context_summary",
];

export type RoutingConfig = {
  modelDefault: string;
  modelCheap: string;
  enableCheapRouting: boolean;
  /**
   * Set only once the dated cheap id has been checked with
   * `GET /v1/models/{id}` (spec 11.2/4). Absent means unverified.
   */
  cheapModelVerifiedAt?: string;
};

export type Route = {
  model: string;
  route: "default" | "cheap";
  /** Why this route, for metering and for reading a log later. */
  reason:
    | "musical_task"
    | "cheap_routing_disabled"
    | "task_not_whitelisted"
    | "cheap_model_unverified"
    | "cheap_whitelisted";
};

export function selectRoute(task: CopilotTask, config: RoutingConfig): Route {
  const fallback = (reason: Route["reason"]): Route => ({
    model: config.modelDefault,
    route: "default",
    reason,
  });

  // Musical work never leaves the default model, whatever the flag says.
  if (task === "musical_patch") return fallback("musical_task");
  if (!config.enableCheapRouting) return fallback("cheap_routing_disabled");
  if (!CHEAP_ROUTING_WHITELIST.includes(task)) {
    return fallback("task_not_whitelisted");
  }
  if (!config.cheapModelVerifiedAt) return fallback("cheap_model_unverified");

  return { model: config.modelCheap, route: "cheap", reason: "cheap_whitelisted" };
}
