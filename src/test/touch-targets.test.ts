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
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Interactive strips whose buttons a thumb has to hit. */
const STRIPS = [
  "src/components/workspace/SectionChips.tsx",
  "src/components/workspace/SelectionBar.tsx",
  "src/components/workspace/PracticeRateControl.tsx",
  "src/components/workspace/TransportBar.tsx",
  "src/components/workspace/EditToolbar.tsx",
  "src/components/workspace/TrackSelector.tsx",
  "src/components/workspace/FretSheet.tsx",
];

/** Tailwind heights smaller than 44px. `min-h-11` is 44px. */
const TOO_SMALL = /\bmin-h-(?:[0-9]|10)\b/g;

describe("every strip a thumb uses", () => {
  STRIPS.forEach((path) => {
    it(`${path.split("/").pop()}: asks for at least 44px`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("min-h-11");
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
