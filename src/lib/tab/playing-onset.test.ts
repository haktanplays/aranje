/**
 * Marking the onset the playhead is on, without a render (2S-A §4).
 */
import { describe, expect, it } from "vitest";

import {
  PLAYING_ATTRIBUTE,
  markPlayingOnset,
  onsetKey,
} from "@/lib/tab/playing-onset";

/** A tiny stand-in for the tab's DOM: two bars, three slots each. */
function fakeRoot() {
  const marked = new Set<string>();
  const nodes = new Map<string, { setAttribute: () => void; removeAttribute: () => void }>();
  const queries: string[] = [];

  const nodeFor = (id: string) => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const node = {
      setAttribute: () => marked.add(id),
      removeAttribute: () => marked.delete(id),
    };
    nodes.set(id, node);
    return node;
  };

  const root = {
    querySelectorAll(selector: string) {
      queries.push(selector);
      if (selector === `[${PLAYING_ATTRIBUTE}]`) {
        return [...marked].map((id) => nodeFor(id));
      }
      const match = /\[data-bar-key="(.+)"\] \[data-glyph-slot="(\d+)"\]/.exec(selector);
      if (!match) return [];
      return [nodeFor(`${match[1]}:${match[2]}`)];
    },
  } as unknown as ParentNode;

  return { root, marked, queries };
}

describe("300. the seventh glyph state costs no render", () => {
  it("has no key when nothing is playing", () => {
    expect(onsetKey({ barKey: null, slotIndex: 0 })).toBeNull();
  });

  it("marks the glyph at the transport's own slot", () => {
    const { root, marked } = fakeRoot();
    markPlayingOnset(root, { barKey: "s1:0", slotIndex: 3 }, null);
    expect([...marked]).toEqual(["s1:0:3"]);
  });

  it("moves the mark rather than leaving two", () => {
    const { root, marked } = fakeRoot();
    const first = markPlayingOnset(root, { barKey: "s1:0", slotIndex: 3 }, null);
    markPlayingOnset(root, { barKey: "s1:0", slotIndex: 4 }, first);
    expect([...marked]).toEqual(["s1:0:4"]);
  });

  it("touches nothing at all while the transport stays inside one slot", () => {
    const { root, queries } = fakeRoot();
    const key = markPlayingOnset(root, { barKey: "s1:0", slotIndex: 3 }, null);
    const after = queries.length;
    for (let frame = 0; frame < 60; frame += 1) {
      markPlayingOnset(root, { barKey: "s1:0", slotIndex: 3 }, key);
    }
    expect(queries.length).toBe(after);
  });

  it("clears the mark when the transport is nowhere", () => {
    const { root, marked } = fakeRoot();
    const key = markPlayingOnset(root, { barKey: "s1:0", slotIndex: 3 }, null);
    markPlayingOnset(root, { barKey: null, slotIndex: 0 }, key);
    expect([...marked]).toEqual([]);
  });

  it("still reports the key when there is no DOM to mark", () => {
    expect(markPlayingOnset(null, { barKey: "s1:0", slotIndex: 3 }, null)).toBe(
      "s1:0:3",
    );
  });
});
