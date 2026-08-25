/**
 * The viewed section is its own fact (spec 13.20 §3, 2N-A).
 *
 * The defect these pin was measured in `eval/tab/DEFECTS.json`: pressing
 * "Sonraki bölüm: Ana Riff" moved the tab and left the stepper saying Intro
 * Riff, because "which section" was read off the transport's bar. Every test
 * here is written so that reintroducing that derivation fails it.
 */
import { describe, expect, it } from "vitest";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { buildSongAxis, xAtTicks } from "@/lib/tab/song-axis";
import {
  initialSectionView,
  nextSectionView,
  sectionNeighbours,
  type SectionView,
} from "@/lib/workspace/section-navigation";

const SECTIONS = ["intro", "main", "outro"];

const view = (target: SectionView, event: Parameters<typeof nextSectionView>[1]) =>
  nextSectionView(target, event, SECTIONS);

describe("94. choosing a section is the authority", () => {
  it("starts on the first section, following the transport", () => {
    expect(initialSectionView(SECTIONS)).toEqual({
      viewedSectionId: "intro",
      followsPlayback: true,
    });
  });

  it("moves to the section that was asked for", () => {
    const after = view(initialSectionView(SECTIONS), {
      kind: "choose_section",
      sectionId: "main",
    });
    expect(after.viewedSectionId).toBe("main");
  });

  it("takes over from the transport, so playback cannot pull it back", () => {
    /*
     * The regression in one test. A reader who steps to the chorus while the
     * verse is playing must stay there; deriving the view from the transport
     * would drag them back on the very next frame.
     */
    const chosen = view(initialSectionView(SECTIONS), {
      kind: "choose_section",
      sectionId: "outro",
    });
    expect(chosen.followsPlayback).toBe(false);

    const later = view(chosen, { kind: "playback_moved", barKey: "intro:3" });
    expect(later.viewedSectionId).toBe("outro");
  });

  it("lets the transport carry the view until somebody takes over", () => {
    // Following is the default, and it is what makes the tab move with the
    // music for a reader who is just listening.
    const following = view(initialSectionView(SECTIONS), {
      kind: "playback_moved",
      barKey: "main:0",
    });
    expect(following.viewedSectionId).toBe("main");
    expect(following.followsPlayback).toBe(true);
  });

  it("hands the view back when a bar is pointed at", () => {
    const chosen = view(initialSectionView(SECTIONS), {
      kind: "choose_section",
      sectionId: "outro",
    });
    const tapped = view(chosen, { kind: "open_bar", barKey: "main:2" });
    expect(tapped).toEqual({ viewedSectionId: "main", followsPlayback: true });
  });

  it("ignores a transport with nowhere to be", () => {
    const stopped = view(initialSectionView(SECTIONS), {
      kind: "playback_moved",
      barKey: null,
    });
    expect(stopped.viewedSectionId).toBe("intro");
  });

  it("forgets everything about a song that has been replaced", () => {
    const chosen = view(initialSectionView(SECTIONS), {
      kind: "choose_section",
      sectionId: "outro",
    });
    expect(view(chosen, { kind: "song_replaced" })).toEqual({
      viewedSectionId: "intro",
      followsPlayback: true,
    });
  });
});

describe("95. the viewed section is always a section that exists", () => {
  it("falls back when the section it named has been deleted", () => {
    const chosen: SectionView = { viewedSectionId: "main", followsPlayback: false };
    const after = nextSectionView(chosen, { kind: "playback_moved", barKey: null }, [
      "intro",
      "outro",
    ]);
    expect(after.viewedSectionId).toBe("intro");
  });

  it("refuses to hold a section a choice named but the song does not have", () => {
    const after = nextSectionView(
      initialSectionView(SECTIONS),
      { kind: "choose_section", sectionId: "ghost" },
      SECTIONS,
    );
    expect(after.viewedSectionId).toBe("intro");
  });

  it("survives a song with no sections at all without inventing one", () => {
    expect(initialSectionView([]).viewedSectionId).toBe("");
  });
});

describe("96. the stepper's two arrows", () => {
  it("names the section either side", () => {
    expect(sectionNeighbours(SECTIONS, "main")).toEqual({
      previous: "intro",
      next: "outro",
    });
  });

  it("has no step past either end", () => {
    expect(sectionNeighbours(SECTIONS, "intro").previous).toBeNull();
    expect(sectionNeighbours(SECTIONS, "outro").next).toBeNull();
  });
});

describe("97. the playhead is where the music is, whatever is being read", () => {
  /*
   * This describe used to assert the opposite: that a playhead outside the
   * section being read is hidden. That rule existed because a surface drew one
   * section, so a playhead two sections away had nowhere honest to be.
   *
   * Both reading surfaces now draw the whole song on one axis (2Q-C §4), so
   * the honest place exists and the line is put there. What is asserted here
   * is that the axis really does have a place for every tick of the song —
   * the property the removal rests on.
   */
  const axis = buildSongAxis(SAMPLE_SONG, 34);

  it("has a position for the first and last tick of every section", () => {
    for (const section of axis.sections) {
      expect(xAtTicks(axis, section.startTicks), section.sectionId).not.toBeNull();
      expect(xAtTicks(axis, section.endTicks - 1), section.sectionId).not.toBeNull();
    }
  });

  it("puts later sections further right, so nothing has to be hidden", () => {
    const lefts = axis.sections.map((section) => section.leftPx);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    expect(new Set(lefts).size).toBe(lefts.length);
  });

  it("still says nothing is playing when nothing is", () => {
    // The one case the old rule got right, and it is arithmetic now: a tick
    // outside the song has no x, rather than being clamped to an edge.
    expect(xAtTicks(axis, -1)).toBeNull();
    expect(xAtTicks(axis, axis.totalTicks + 1)).toBeNull();
  });

  it("keeps the two questions apart, which is what did survive", () => {
    // Reading elsewhere while the transport plays on is still a state the
    // model can be in: the view is the reader's and the bar key is the
    // transport's, and neither overwrites the other.
    const elsewhere: SectionView = { viewedSectionId: "outro", followsPlayback: false };
    expect(nextSectionView(elsewhere, { kind: "playback_moved", barKey: "intro:0" }, SECTIONS))
      .toEqual(elsewhere);
  });
});
