import { describe, expect, it } from "vitest";

import {
  CHEAP_ROUTING_WHITELIST,
  selectRoute,
  type CopilotTask,
  type RoutingConfig,
} from "@/lib/ai/routing";

const BASE: RoutingConfig = {
  modelDefault: "claude-sonnet-5",
  modelCheap: "claude-haiku-4-5-20251001",
  enableCheapRouting: false,
};

const ALL_TASKS: CopilotTask[] = [
  "musical_patch",
  "intent_classification",
  "style_selection",
  "context_summary",
];

describe("model routing (spec 11.2, K-1)", () => {
  it("sends every task to the default model while the flag is off", () => {
    for (const task of ALL_TASKS) {
      const route = selectRoute(task, BASE);
      expect(route.route).toBe("default");
      expect(route.model).toBe(BASE.modelDefault);
    }
  });

  it("never routes musical work cheaply, whatever the flag says", () => {
    const route = selectRoute("musical_patch", {
      ...BASE,
      enableCheapRouting: true,
      cheapModelVerifiedAt: "2026-08-19T00:00:00Z",
    });
    expect(route.route).toBe("default");
    expect(route.reason).toBe("musical_task");
  });

  it("has no cheap-first fallback to fall back from", () => {
    // K-1 removed "try the cheap model, then escalate". A single call to
    // selectRoute is the whole decision: there is no second attempt to make.
    const first = selectRoute("musical_patch", BASE);
    const second = selectRoute("musical_patch", BASE);
    expect(first).toEqual(second);
  });

  it("keeps the whitelist to the three non-creative helper tasks", () => {
    expect([...CHEAP_ROUTING_WHITELIST].sort()).toEqual([
      "context_summary",
      "intent_classification",
      "style_selection",
    ]);
    expect(CHEAP_ROUTING_WHITELIST).not.toContain("musical_patch");
  });

  it("refuses the cheap model until its dated id has been verified", () => {
    const unverified = selectRoute("intent_classification", {
      ...BASE,
      enableCheapRouting: true,
    });
    expect(unverified.route).toBe("default");
    expect(unverified.reason).toBe("cheap_model_unverified");
  });

  it("routes a whitelisted task cheaply once flag and verification are both in place", () => {
    const route = selectRoute("intent_classification", {
      ...BASE,
      enableCheapRouting: true,
      cheapModelVerifiedAt: "2026-08-19T00:00:00Z",
    });
    expect(route.route).toBe("cheap");
    expect(route.model).toBe(BASE.modelCheap);
  });
});
