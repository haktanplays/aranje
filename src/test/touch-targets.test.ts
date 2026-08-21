/**
 * Touch targets stay 44px (spec 13.5, 13.6).
 *
 * A measurement in a browser is the real proof, and the mobile smoke does that.
 * This is the part a browser cannot do: catch the token going back to a smaller
 * one in a component nobody reopened, in the suite rather than in a screenshot.
 *
 * The tab's own cells are the documented exception: dense notation is a grid of
 * strings and slots, and a 44px cell would make one bar wider than a phone.
 * They are excluded here by name rather than by silence.
 *
 * Two ways of asking for the minimum count, because there are two and the newer
 * one is the better one. `min-h-11` is the Tailwind class; `MIN_TOUCH_TARGET_PX`
 * is the shared constant that class was always meant to mirror, and a component
 * reading the constant cannot drift from it the way a literal class can.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Interactive strips whose buttons a thumb has to hit. */
const STRIPS = [
  "src/components/workspace/SectionNavigator.tsx",
  "src/components/workspace/SelectionBar.tsx",
  "src/components/workspace/PracticeRateControl.tsx",
  "src/components/workspace/TransportBar.tsx",
  "src/components/workspace/EditToolbar.tsx",
  "src/components/workspace/SectionSheet.tsx",
  "src/components/workspace/TrackSheet.tsx",
  "src/components/workspace/ViewSwitch.tsx",
  "src/components/workspace/FretSheet.tsx",
];

/** Tailwind heights smaller than 44px. `min-h-11` is 44px. */
const TOO_SMALL = /\bmin-h-(?:[0-9]|10)\b/g;

describe("every strip a thumb uses", () => {
  STRIPS.forEach((path) => {
    it(`${path.split("/").pop()}: asks for at least 44px`, () => {
      const source = readFileSync(path, "utf8");
      const asksForTheMinimum =
        source.includes("min-h-11") || source.includes("MIN_TOUCH_TARGET_PX");
      expect(asksForTheMinimum, `${path} names no touch minimum`).toBe(true);
      expect(source.match(TOO_SMALL)).toBeNull();
    });
  });

  it("names the one place a smaller target is deliberate", () => {
    // The tab grid. If this ever stops being the only exception, the list
    // above is where the new one has to be argued for.
    const source = readFileSync(
      "src/components/workspace/FrettedBarBlock.tsx",
      "utf8",
    );
    expect(source).toContain("STRING_ROW_HEIGHT");
    expect(source.match(TOO_SMALL)).toBeNull();
  });
});
