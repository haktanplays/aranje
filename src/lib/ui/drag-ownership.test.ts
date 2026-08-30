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
  followTick,
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

describe("one tick of the follow", () => {
  /** A scroller that only remembers where it has been scrolled to. */
  const scroller = (left: number, right: number) => ({
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left, right }),
  });

  it("moves the view and asks again what is under the finger", () => {
    /*
     * The pair, not the scroll. Moving without asking again is invisible from
     * the outside and is the whole of the founder-facing bug it prevents: the
     * picture slides, the next bar arrives under a thumb that has not moved,
     * and the range still says one bar because nothing asked.
     */
    const node = scroller(0, 412);
    const asked: number[][] = [];
    const kept = followTick(node, { x: 400, y: 300 }, (x, y) => {
      asked.push([x, y]);
    });
    expect(kept).toBe(true);
    expect(node.scrollLeft).toBe(EDGE_STEP_PX);
    expect(asked).toEqual([[400, 300]]);
  });

  it("asks with the finger's own position, not with the new scroll", () => {
    // The finger has not moved; the content under it has. The caller resolves
    // the point against the view as it is *now*, so passing anything but the
    // real coordinate would name a slot the reader is not over.
    const node = scroller(0, 412);
    node.scrollLeft = 900;
    const asked: number[] = [];
    followTick(node, { x: 8, y: 120 }, (x) => {
      asked.push(x);
    });
    expect(asked).toEqual([8]);
  });

  it("travels left from the left band", () => {
    const node = scroller(0, 412);
    node.scrollLeft = 500;
    followTick(node, { x: 8, y: 120 }, () => {});
    expect(node.scrollLeft).toBe(500 - EDGE_STEP_PX);
  });

  it("stops, and does not ask, once the finger has left the band", () => {
    const node = scroller(0, 412);
    let asked = 0;
    const kept = followTick(node, { x: 206, y: 300 }, () => (asked += 1));
    expect(kept).toBe(false);
    expect(node.scrollLeft).toBe(0);
    expect(asked).toBe(0);
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
    /*
     * And the browser's other two ways of taking a pointer. On a mouse,
     * dragging across bar numbers starts a native drag: `dragstart`, then
     * `pointercancel`, and the range dies mid-reach with the button still
     * down. Measured on the 1363px run before this was added.
     */
    expect(source).toContain('document.addEventListener("dragstart", block);');
    expect(source).toContain('document.addEventListener("selectstart", block);');
    // The registering effect takes no dependencies: one that depended on the
    // ownership would re-register at exactly the moment it stops working.
    const registering = source.slice(source.indexOf("const block ="));
    expect(registering).toMatch(/removeEventListener\("selectstart", block\);\s*\};\s*\}, \[\]\);/);
  });

  it("both gestures tell a lift apart from an interruption", () => {
    // They tear down identically and mean opposite things. Pointing both at
    // one handler is how the difference disappears — and it disappears
    // silently, because a cancelled drag that behaves like a finished one
    // leaves a selection on screen that nobody chose.
    for (const path of hooks) {
      expect(read(path), path).toContain("onPointerUp: finish");
      expect(read(path), path).toContain("onPointerCancel: abandon");
    }
  });

  it("neither gesture can miss its own ending", () => {
    // The element the handlers are on can be unmounted mid-drag by horizontal
    // windowing, and React takes its listeners with it. Measured on 320px as
    // an edge-follow interval still ticking after the finger had lifted.
    const source = read("src/lib/ui/drag-ownership.ts");
    expect(source).toContain('document.addEventListener("pointerup", lifted);');
    expect(source).toContain('document.addEventListener("pointercancel", taken);');
    for (const path of hooks) {
      expect(read(path), path).toMatch(
        /useGestureEnd\(owning, \{ onUp: finish, onCancel: abandon \}\)/,
      );
    }
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
