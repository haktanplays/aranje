import { describe, expect, it } from "vitest";

import { acceptanceRiff } from "@/lib/acceptance/riff";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";

/**
 * The founder's third finding: a hammer-on is written but does not read as
 * one by ear. Before touching a sample or an envelope, the question is
 * whether the *plan* already says the right thing — and it does, which is why
 * this is a listening problem and not a scheduling one.
 */
describe("what the planner already says about legato (2T §10)", () => {
  const plan = buildExpressionPlan(acceptanceRiff(), { practicePercent: 100 });

  it("plans a hammer-on as one voice, with the targets never struck", () => {
    const legato = plan.chains.filter((chain) =>
      chain.transitions.some((transition) => transition.kind !== "slide"),
    );
    expect(legato.length).toBeGreaterThan(0);
    for (const chain of legato) {
      /* One struck note at the head, then every target carried by it. */
      expect(chain.noteIds.length).toBe(chain.transitions.length + 1);
      expect(chain.transitions.length).toBeGreaterThan(0);
    }
  });

  /*
   * §14 asks for the two to be planned differently, and they are: a hammer-on
   * and a pull-off carry different articulations into the same chain, which
   * is what the voice reads to shape the transition. Whether the *result*
   * reads as a hammer or a pull by ear is a listening question.
   */
  it("keeps a hammer-on and a pull-off distinguishable in the plan", () => {
    const kinds = new Set(
      plan.chains.flatMap((chain) => chain.transitions.map((t) => t.kind)),
    );
    expect(kinds.has("hammer_on")).toBe(true);
    expect(kinds.has("pull_off")).toBe(true);
  });

  /*
   * A slide travels; a hammer-on and a pull-off arrive. That difference is
   * already in the plan, in the number of pitch points a transition carries.
   */
  it("plans a travelling slide differently from an arriving hammer", () => {
    const slides = plan.chains.flatMap((chain) =>
      chain.transitions.filter((t) => t.kind === "slide"),
    );
    const hammers = plan.chains.flatMap((chain) =>
      chain.transitions.filter((t) => t.kind === "hammer_on"),
    );
    expect(slides.length).toBeGreaterThan(0);
    expect(hammers.length).toBeGreaterThan(0);
    expect(Math.max(...slides.map((t) => t.points.length))).toBeGreaterThan(
      Math.max(...hammers.map((t) => t.points.length)),
    );
  });
});
