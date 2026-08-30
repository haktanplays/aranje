/**
 * What owning a drag costs the page (2U-C §2, §4).
 *
 * Two of these are arithmetic and one is a wiring rule that cost a working
 * gesture, so all three are here rather than trusted to the browser run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  EDGE_BAND_PX,
  EDGE_STEP_PX,
  EDGE_TICK_MS,
  edgeDirection,
} from "@/lib/ui/drag-ownership";

/* A scroller that fills a 412px phone, as the tab does. */
const LEFT = 0;
const RIGHT = 412;

describe("when the view follows the finger", () => {
  it("stays still while the finger is anywhere in the middle", () => {
    expect(edgeDirection(206, LEFT, RIGHT)).toBe(0);
    expect(edgeDirection(LEFT + EDGE_BAND_PX + 1, LEFT, RIGHT)).toBe(0);
    expect(edgeDirection(RIGHT - EDGE_BAND_PX - 1, LEFT, RIGHT)).toBe(0);
  });

  it("travels toward whichever edge the finger has reached", () => {
    expect(edgeDirection(RIGHT - 4, LEFT, RIGHT)).toBe(1);
    expect(edgeDirection(LEFT + 4, LEFT, RIGHT)).toBe(-1);
  });

  it("measures each band from its own edge, not from the viewport", () => {
    // A scroller that does not start at x=0 — the tab under a sticky gutter,
    // or a desktop window. Measuring from the viewport would put the left
    // band inside the gutter and the right one short of the screen.
    const left = 120;
    const right = 900;
    expect(edgeDirection(left + 4, left, right)).toBe(-1);
    expect(edgeDirection(right - 4, left, right)).toBe(1);
    expect(edgeDirection(4, left, right)).toBe(-1);
    expect(edgeDirection(500, left, right)).toBe(0);
  });

  it("keeps a band a thumb can find and a speed a reader can stop on", () => {
    // 44px is the touch-target minimum: a band narrower than a thumb has to
    // be aimed at, and this one is reached by accident on purpose.
    expect(EDGE_BAND_PX).toBeGreaterThanOrEqual(44);
    // ~750px/s. A bar of sixteenths is 544px wide, so a bar takes about
    // three quarters of a second — fast enough to be worth doing, slow
    // enough to stop on the bar you meant.
    const perSecond = (EDGE_STEP_PX / EDGE_TICK_MS) * 1000;
    expect(perSecond).toBeGreaterThan(300);
    expect(perSecond).toBeLessThan(1200);
  });

  it("leaves no room for a scroller narrower than two bands", () => {
    // Both bands claim the same finger on a very narrow scroller. Right wins,
    // and that is stated rather than discovered: a reader on a 320px screen
    // with a 60px scroller would otherwise get a direction that depends on
    // the order of two ifs.
    expect(edgeDirection(40, 0, 80)).toBe(-1);
  });
});

describe("the ownership costs are wired to outlast a render", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const hooks = [
    "src/lib/ui/use-bar-range-drag.ts",
    "src/lib/ui/use-note-range-drag.ts",
  ];

  it("the edge follow hands back one object for the life of the hook", () => {
    // This is not tidiness. A fresh object every render makes every callback
    // that closes over it fresh, and a teardown effect depending on one of
    // those runs its cleanup on every render — releasing the gesture a frame
    // after recognising it. Measured: the press opened a selection and the
    // twenty pointer moves that followed reached a drag that had let go.
    const source = read("src/lib/ui/drag-ownership.ts");
    expect(source).toMatch(/return useMemo\(\(\) => \(\{ attach, track, stop \}\)/);
  });

  it("neither gesture tears itself down on anything but unmount", () => {
    for (const path of hooks) {
      expect(read(path), path).toMatch(
        /useEffect\(\(\) => \(\) => void teardown\.current\(\), \[\]\);/,
      );
    }
  });

  it("the scroll suppression is listening before the gesture starts", () => {
    // Chrome decides at touchstart which listeners may block a gesture, so a
    // non-passive listener added when the long press is recognised is treated
    // as passive for that whole sequence. Registered at mount, consulted
    // through a ref.
    const source = read("src/lib/ui/drag-ownership.ts");
    expect(source).toMatch(
      /document\.addEventListener\("touchmove", block, \{ passive: false \}\);/,
    );
    expect(source).toMatch(/if \(live\.current\) event\.preventDefault\(\);/);
    // The registering effect takes no dependencies: one that depended on the
    // ownership would re-register at exactly the moment it stops working.
    const registering = source.slice(source.indexOf("const block ="));
    expect(registering).toMatch(/removeEventListener\("touchmove", block\);\s*\}, \[\]\);/);
  });

  it("both gestures pay the same costs, from the same place", () => {
    for (const path of hooks) {
      const source = read(path);
      expect(source, path).toContain("useScrollSuppression(owning)");
      expect(source, path).toContain("useEdgeFollow(reachTo)");
      expect(source, path).toContain('from "@/lib/ui/swallow-click"');
    }
  });
});
