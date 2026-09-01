/**
 * The production event channel, and the rule that keeps it production
 * (2V-B.1 §13).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  canonicalBytes,
  publishWorkspaceEdit,
  songFingerprint,
  subscribeWorkspaceEdits,
  workspaceEditObserverCount,
  type WorkspaceEdit,
} from "@/lib/song/workspace-events";

const edit: WorkspaceEdit = {
  action: "paste",
  scope: "notes",
  mutating: true,
  songBefore: "a",
  songAfter: "b",
  sectionId: "s1",
  trackIds: ["gtr"],
  startTicks: 0,
  endTicks: 192,
  barKeys: [],
};

describe("the fingerprint", () => {
  it("changes when the music does, and not otherwise", () => {
    expect(songFingerprint(SAMPLE_SONG)).toBe(songFingerprint(SAMPLE_SONG));
    expect(songFingerprint(SAMPLE_SONG)).not.toBe(songFingerprint(editorFixture()));
    expect(songFingerprint({ ...SAMPLE_SONG, bpm: SAMPLE_SONG.bpm + 1 })).not.toBe(
      songFingerprint(SAMPLE_SONG),
    );
  });

  it("does not depend on the order the object's keys were written in", () => {
    /*
     * The same music reaches two places in two orders — the store holds a
     * schema-parsed object, the project record holds whatever wrote it — and
     * a fingerprint that inherited `JSON.stringify`'s insertion order said
     * `wrong_song` about a Song that had not changed. Measured in the
     * 2V-B.1 browser run, on every writing step.
     */
    const reordered = {
      sections: SAMPLE_SONG.sections,
      tracks: SAMPLE_SONG.tracks,
      key: SAMPLE_SONG.key,
      bpm: SAMPLE_SONG.bpm,
      title: SAMPLE_SONG.title,
      version: SAMPLE_SONG.version,
    } as typeof SAMPLE_SONG;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(SAMPLE_SONG));
    expect(songFingerprint(reordered)).toBe(songFingerprint(SAMPLE_SONG));
  });
});

describe("canonical bytes", () => {
  it("makes the same music compare equal whatever order it was written in", () => {
    const one = '{"bpm":96,"title":"x","tracks":[{"id":"gtr","name":"G"}]}';
    const other = '{"tracks":[{"name":"G","id":"gtr"}],"title":"x","bpm":96}';
    expect(canonicalBytes(one)).toBe(canonicalBytes(other));
  });

  it("still refuses a single changed note", () => {
    expect(canonicalBytes('{"bpm":96}')).not.toBe(canonicalBytes('{"bpm":97}'));
  });

  it("keeps array order, because in music the order is the music", () => {
    expect(canonicalBytes('{"n":[1,2]}')).not.toBe(canonicalBytes('{"n":[2,1]}'));
  });

  it("hands back bytes it cannot parse, rather than losing them", () => {
    expect(canonicalBytes("not json")).toBe("not json");
  });
});

describe("publishing", () => {
  it("costs nothing and reaches nobody when there is no observer", () => {
    expect(workspaceEditObserverCount()).toBe(0);
    expect(() => publishWorkspaceEdit(edit)).not.toThrow();
  });

  it("reaches every observer, and stops when they unsubscribe", () => {
    const seen: WorkspaceEdit[] = [];
    const stop = subscribeWorkspaceEdits((event) => seen.push(event));
    expect(workspaceEditObserverCount()).toBe(1);

    publishWorkspaceEdit(edit);
    expect(seen).toEqual([edit]);

    stop();
    publishWorkspaceEdit(edit);
    expect(seen).toHaveLength(1);
    expect(workspaceEditObserverCount()).toBe(0);
  });

  it("does not let a broken observer break the editor", () => {
    const seen: WorkspaceEdit[] = [];
    const stopBad = subscribeWorkspaceEdits(() => {
      throw new Error("observer bug");
    });
    const stopGood = subscribeWorkspaceEdits((event) => seen.push(event));

    expect(() => publishWorkspaceEdit(edit)).not.toThrow();
    /* And the good one still heard it: observing is not a chain of trust. */
    expect(seen).toEqual([edit]);
    stopBad();
    stopGood();
  });
});

describe("the production commands stay production (§13)", () => {
  const transform = readFileSync("src/lib/song/use-transform.ts", "utf8");
  const bars = readFileSync("src/lib/song/use-bar-transform.ts", "utf8");
  const channel = readFileSync("src/lib/song/workspace-events.ts", "utf8");

  it("publishes from the two command paths and nowhere else", () => {
    for (const source of [transform, bars]) {
      expect(source).toContain("publishWorkspaceEdit(");
    }
  });

  it("has no acceptance branch in either command path", () => {
    /*
     * The trap this rule exists to close: a command that behaves differently
     * "when a test is watching" is a command whose acceptance proves nothing
     * about the product. Neither path may name the acceptance layer, the
     * session, or the observer count.
     */
    for (const source of [transform, bars, channel]) {
      expect(source).not.toContain("@/lib/acceptance/");
      expect(source).not.toMatch(/\bacceptanceSession\b/);
      expect(source).not.toMatch(/if\s*\([^)]*observer/i);
    }
  });

  it("announces a write only after the commit landed", () => {
    /*
     * A refused write changed nothing, and an event for it would let a step
     * pass on music that was never saved. Both paths capture the commit's
     * own answer and publish inside the branch that took it.
     */
    for (const source of [transform, bars]) {
      expect(source).toMatch(/const committed = store\.commit\(/);
      expect(source).toMatch(/if \(committed\) \{/);
    }
  });

  it("carries no build sha of its own", () => {
    /* See the module's own note: an emitter and an observer in one bundle
       share one build, so a sha written here could not disagree with
       anything — and a number that cannot disagree cannot catch a stale
       deploy. The gate that can lives in `build-id.ts`. */
    expect(channel).not.toContain("BUILD_SHA");
    expect(channel).not.toContain("NEXT_PUBLIC_ARANJE_BUILD_SHA");
  });
});
