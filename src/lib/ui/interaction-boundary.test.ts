/**
 * One finger, one threshold, one answer (spec 13.1, K-38).
 *
 * Two things went wrong here that no unit test of a pure function could have
 * seen, because both are properties of the *wiring* rather than of any
 * function:
 *
 * - The chord-group pick in `FrettedBarBlock` kept its own 400ms threshold
 *   while the time selection used the shared 500ms one. Held on an onset, a
 *   single press armed both, so one finger produced a green group ring over
 *   six cells and a time band — two selection models answering at once.
 * - Nothing said which of them owned the gesture where both were live.
 *
 * Read from disk, like the transform boundary test, for the same reason: this
 * is exactly the kind of rule that decays the moment someone needs a hold
 * "just here", and it decays silently.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const COMPONENTS = "src/components/workspace";

const read = (path: string) => readFileSync(path, "utf8");

const sources = readdirSync(COMPONENTS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, text: read(`${COMPONENTS}/${name}`) }));

describe("the long-press threshold has one source", () => {
  it("has components to check", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it("interaction.ts is the only place the number is written", () => {
    const owner = read("src/lib/ui/interaction.ts");
    expect(owner).toMatch(/export const LONG_PRESS_MS = \d+;/);
    for (const source of sources) {
      expect(source.text, source.name).not.toMatch(/LONG_PRESS_MS\s*=\s*\d/);
    }
  });

  it("a component that holds a press imports the shared threshold", () => {
    const block = read(`${COMPONENTS}/FrettedBarBlock.tsx`);
    expect(block).toContain("setTimeout");
    expect(block).toContain('from "@/lib/ui/interaction"');
    expect(block).toContain("LONG_PRESS_MS");
  });
});

describe("only one selection model answers a hold", () => {
  it("the chord pick stands down when the time selection is listening", () => {
    const block = read(`${COMPONENTS}/FrettedBarBlock.tsx`);
    // The gate is the first thing the hold does, before it looks at onsets.
    expect(block).toMatch(/if \(timeSelectionOwnsPress\) return;/);
  });

  it("the canvas is what decides, from whether a press handler exists", () => {
    const canvas = read(`${COMPONENTS}/TabCanvas.tsx`);
    expect(canvas).toContain(
      "timeSelectionOwnsPress={onSlotLongPress !== undefined}",
    );
  });
});

describe("a spent press does not leave a live click behind", () => {
  it("the hook disowns the click that follows a press it fired", () => {
    const hook = read("src/lib/ui/use-long-press.ts");
    expect(hook).toContain("swallowNextClick");
    // The call site, not just the definition: a function nobody calls is not
    // a fix, and a probe that deletes the call has to be able to turn this red.
    expect(hook).toMatch(/if \(spent\) swallowNextClick\(\);/);
    // Capture phase, or React's root listener has already handed it on.
    expect(hook).toMatch(/addEventListener\("click", stop, \{ capture: true/);
    expect(hook).toContain("stopPropagation");
    // And it has to expire on its own: a touch does not always click.
    expect(hook).toContain("removeEventListener");
    expect(hook).toContain("CLICK_AFTER_PRESS_MS");
  });

  it("a cancelled gesture is not treated as a spent one", () => {
    const hook = read("src/lib/ui/use-long-press.ts");
    expect(hook).toMatch(/onPointerCancel: cancel/);
  });
});
