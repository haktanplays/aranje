/**
 * The click a spent gesture leaves behind (2U-C §2).
 *
 * Worth its own test because both of its failure modes are silent. A listener
 * that is never registered lets the seek through — the founder's «arkadaki tab
 * yüzeyi kayıyor», arriving one frame after the drag. A listener that is never
 * removed swallows the *next* real tap instead, which reads as the app having
 * frozen. Neither shows up in a typecheck, and neither shows up in a test that
 * only asserts the function was called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLICK_AFTER_PRESS_MS } from "@/lib/ui/interaction";
import { swallowNextClick } from "@/lib/ui/swallow-click";

type Registration = {
  readonly type: string;
  readonly listener: (event: Event) => void;
  readonly options: unknown;
};

/** A document that only records, so the two halves can be checked apart. */
function recorder() {
  const added: Registration[] = [];
  const removed: Registration[] = [];
  return {
    added,
    removed,
    addEventListener(type: string, listener: unknown, options: unknown) {
      added.push({ type, listener: listener as (event: Event) => void, options });
    },
    removeEventListener(type: string, listener: unknown, options: unknown) {
      removed.push({
        type,
        listener: listener as (event: Event) => void,
        options,
      });
    },
  };
}

let restore: (() => void) | null = null;

function install(doc: unknown): ReturnType<typeof recorder> {
  const had = "document" in globalThis;
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = doc;
  restore = () => {
    if (had) (globalThis as { document?: unknown }).document = previous;
    else delete (globalThis as { document?: unknown }).document;
  };
  return doc as ReturnType<typeof recorder>;
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  restore?.();
  restore = null;
});

describe("swallowNextClick", () => {
  it("catches the click in the capture phase, before any handler runs", () => {
    const doc = install(recorder());
    swallowNextClick();

    expect(doc.added).toHaveLength(1);
    expect(doc.added[0]?.type).toBe("click");
    // Capture, or React's root listener has already handed the click on.
    expect(doc.added[0]?.options).toMatchObject({ capture: true, once: true });
  });

  it("stops the click it catches from reaching anything", () => {
    const doc = install(recorder());
    swallowNextClick();

    let defaultPrevented = false;
    let propagationStopped = false;
    doc.added[0]?.listener({
      preventDefault: () => (defaultPrevented = true),
      stopPropagation: () => (propagationStopped = true),
    } as unknown as Event);

    expect(defaultPrevented).toBe(true);
    expect(propagationStopped).toBe(true);
  });

  it("is still listening for the click that is about to arrive", () => {
    const doc = install(recorder());
    swallowNextClick();

    // A click follows its touch within a frame or two. A window that closed
    // before then would be a fix that only works on a fast phone.
    vi.advanceTimersByTime(CLICK_AFTER_PRESS_MS - 1);
    expect(doc.removed).toHaveLength(0);
  });

  it("gives the click back once that window has passed", () => {
    const doc = install(recorder());
    swallowNextClick();

    vi.advanceTimersByTime(CLICK_AFTER_PRESS_MS);
    expect(doc.removed).toHaveLength(1);
    // The same listener, and capturing: removal has to match registration or
    // it silently removes nothing at all.
    expect(doc.removed[0]?.listener).toBe(doc.added[0]?.listener);
    expect(doc.removed[0]?.options).toMatchObject({ capture: true });
  });

  it("does nothing at all where there is no document", () => {
    install(undefined);
    expect(() => swallowNextClick()).not.toThrow();
  });
});
