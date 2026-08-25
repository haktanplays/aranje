/**
 * A deferred value is still the same value (2R-A §IV, §XIII).
 *
 * The claim that matters is the negative one: making a model lazy must not
 * change what the model is, only when it is built. So these tests check that
 * the work happens at most once, that it happens not at all until asked, and
 * that the answer is identical to the eager one.
 */
import { describe, expect, it } from "vitest";

import { lazily } from "@/lib/ui/lazy-value";

describe("267. a lazy value is built once, on demand, and is the same value", () => {
  it("does not run the builder until somebody reads it", () => {
    let runs = 0;
    lazily(() => (runs += 1));
    expect(runs).toBe(0);
  });

  it("runs it exactly once however many times it is read", () => {
    let runs = 0;
    const value = lazily(() => {
      runs += 1;
      return { built: runs };
    });
    expect(value()).toBe(value());
    expect(value()).toBe(value());
    expect(runs).toBe(1);
  });

  it("returns what the eager call would have returned", () => {
    const build = (n: number) => ({ doubled: n * 2 });
    expect(lazily(() => build(21))()).toEqual(build(21));
  });

  it("keeps a falsy result rather than rebuilding it", () => {
    /*
     * The trap in every "cache if not already cached" one-liner: `??=` on the
     * value itself would rebuild `undefined`, `null`, `0` and `""` on every
     * read. The cache holds a box, so the box is what is missing or not.
     */
    for (const empty of [undefined, null, 0, "", false, Number.NaN]) {
      let runs = 0;
      const value = lazily(() => {
        runs += 1;
        return empty;
      });
      value();
      value();
      value();
      expect(runs).toBe(1);
    }
  });

  it("gives each wrapper its own cache", () => {
    let runs = 0;
    const build = () => (runs += 1);
    expect(lazily(build)()).toBe(1);
    expect(lazily(build)()).toBe(2);
  });
});
