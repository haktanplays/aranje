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

/** Source with its comments taken out, for rules about what the code *does*. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

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
    // The call site, not just the import: a function nobody calls is not a
    // fix, and a probe that deletes the call has to be able to turn this red.
    // What the call then *does* is `swallow-click.test.ts`, which can watch it
    // register and unregister rather than read that it says it will.
    expect(hook).toContain('from "@/lib/ui/swallow-click"');
    expect(hook).toMatch(/if \(spent\) swallowNextClick\(\);/);
  });

  it("a cancelled gesture is not treated as a spent one", () => {
    const hook = read("src/lib/ui/use-long-press.ts");
    expect(hook).toMatch(/onPointerCancel: cancel/);
  });
});

/**
 * The declaration that decides the gesture on Android (2U-C §1).
 *
 * A wiring property, so no pure test can reach it: `declaredTouchAction` can
 * be entirely correct while a component writes its own string next to the call
 * and wins. That is not hypothetical — it is exactly how the header came to
 * declare `pan-x` while the ownership ranking said the drag owned the pointer.
 */
describe("the bar header reserves the axis its gesture needs", () => {
  const HEADERS = ["FrettedBarBlock.tsx", "DrumBarBlock.tsx"] as const;

  it("asks the ownership ranking rather than writing the value itself", () => {
    for (const name of HEADERS) {
      const block = read(`${COMPONENTS}/${name}`);
      expect(block, name).toContain("declaredTouchAction(headerOwner)");
      expect(block, name).toContain('from "@/lib/tab/pointer-ownership"');
    }
  });

  it("no component hands the horizontal pan away any more", () => {
    // The regression itself. `pan-x` on a surface this gesture starts from is
    // the compositor being promised the axis before the page can ask for it.
    // Comments are stripped first, because the reason it must not come back is
    // written in one of them and would otherwise fail its own rule.
    for (const source of sources) {
      expect(code(source.text), source.name).not.toContain("pan-x");
    }
  });

  it("nothing switches scrolling off wholesale", () => {
    // §2: no global `touch-action: none`. The duration handle declares it on
    // itself through a Tailwind class on its own 44px grab area; a scroller,
    // a canvas or a page-level element doing the same would be the blunt fix
    // this round is not allowed to take.
    for (const source of sources) {
      if (source.name === "DurationControl.tsx") continue;
      expect(code(source.text), source.name).not.toMatch(/touchAction:\s*"none"/);
    }
    // The one exception, and it is conditional on the handle owning the drag
    // rather than declared for the element outright.
    const handle = read(`${COMPONENTS}/DurationControl.tsx`);
    expect(handle).toMatch(/stopsPageScroll\(owner\) \? "none" : undefined/);
    const scroller = read(`${COMPONENTS}/TabCanvas.tsx`);
    expect(scroller).not.toContain("touch-none");
  });
});

/**
 * The seek a finished drag would otherwise leave behind (2U-C §2).
 *
 * A bar block is a `<button>` that seeks, and a touch that ends produces a
 * click. Holding bar 1 and reaching to bar 3 therefore ended with the playhead
 * jumping to whatever the finger lifted over, and `open_bar` carrying the view
 * there — the founder's moving surface, arriving after the gesture rather than
 * during it, and out of reach of any `touch-action`.
 */
describe("a bar-range drag does not seek the bar it ends on", () => {
  const hook = read("src/lib/ui/use-bar-range-drag.ts");

  it("disowns the click, and only when the drag really took hold", () => {
    expect(hook).toContain('from "@/lib/ui/swallow-click"');
    expect(hook).toMatch(/if \(release\(\)\) swallowNextClick\(\);/);
  });

  it("the two endings are not the same handler", () => {
    // They differ in what they owe the reader: a lift stands, an interruption
    // is taken back. Pointing both at one function is how the difference
    // disappears.
    expect(hook).toContain("onPointerUp: finish");
    expect(hook).toContain("onPointerCancel: abandon");
    expect(hook).toMatch(/if \(release\(\)\) latest\.current\.onCancel\?\.\(\);/);
  });

  it("a cancelled drag gives back the bars it had selected", () => {
    const session = read("src/lib/workspace/use-selection-session.ts");
    expect(session).toMatch(/onCancel: clearBars,/);
  });

  it("the click hook and the drag share one implementation", () => {
    // Two copies of a 400ms window is two windows the day one is tuned.
    const press = read("src/lib/ui/use-long-press.ts");
    expect(press).toContain('from "@/lib/ui/swallow-click"');
    expect(press).not.toContain("function swallowNextClick");
    expect(hook).not.toContain("function swallowNextClick");
  });
});

/**
 * The staff's press became a drag (2U-C §3).
 *
 * Wiring, so no pure test can see it: the hook can be perfect while the canvas
 * still spreads the old fire-and-forget long press onto the staff, and the
 * reader gets a selection that will not grow.
 */
describe("holding a note and reaching across its slots", () => {
  const canvas = read(`${COMPONENTS}/TabCanvas.tsx`);

  it("the staff carries the drag, not a press that forgets", () => {
    expect(canvas).toContain("noteRange.handlers");
    expect(canvas).not.toContain("useLongPress");
  });

  it("the pen still takes the press before the drag can arm", () => {
    expect(canvas).toMatch(/owner !== "pen"/);
    expect(canvas).toContain("noteRangeOwning: noteRange?.owning === true");
  });

  it("the reach is refused unless the press really opened a range", () => {
    // Mid-paste a press names a destination and with "Devam" armed it moves
    // an edge; in both the finger is still down with nothing to reach with,
    // and dragging would resize a selection nobody is holding.
    const session = read("src/lib/workspace/use-selection-session.ts");
    expect(session).toMatch(/rangeLive\.current = x !== null && onSlotLongPress\(x\);/);
    expect(session).toMatch(/if \(!rangeLive\.current\) return;/);
  });

  it("a cancelled note drag gives back the notes it had selected", () => {
    const session = read("src/lib/workspace/use-selection-session.ts");
    expect(session).toMatch(/onCancel: clearTime,/);
  });

  it("the reach reads the tab's coordinates fresh every time", () => {
    // The edge follow moves the content under a finger that is not moving, so
    // a rect measured once at press time names the wrong slot from the second
    // tick onwards.
    const session = read("src/lib/workspace/use-selection-session.ts");
    expect(session).toMatch(/const contentX = useCallback\(/);
    expect(session).toMatch(/getBoundingClientRect\(\)\.left - GUTTER_WIDTH/);
  });
});
