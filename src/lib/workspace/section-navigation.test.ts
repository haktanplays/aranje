/**
 * The viewed section is its own fact (spec 13.20 §3, 2N-A).
 *
 * The defect these pin was measured in `eval/tab/DEFECTS.json`: pressing
 * "Sonraki bölüm: Ana Riff" moved the tab and left the stepper saying Intro
 * Riff, because "which section" was read off the transport's bar. Every test
 * here is written so that reintroducing that derivation fails it.
 */
import { describe, expect, it } from "vitest";

import {
  initialSectionView,
  nextSectionView,
  playheadBelongsHere,
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

describe("97. the playhead is drawn only over the music it plays", () => {
  it("is shown when the transport is in the section being read", () => {
    const following: SectionView = { viewedSectionId: "main", followsPlayback: true };
    expect(playheadBelongsHere(following, "main:2")).toBe(true);
  });

  it("is hidden while the reader is somewhere else", () => {
    /*
     * A line sliding across a section the transport is nowhere near is not a
     * playhead; it is a decoration that lies about where the sound is.
     */
    const elsewhere: SectionView = { viewedSectionId: "outro", followsPlayback: false };
    expect(playheadBelongsHere(elsewhere, "intro:0")).toBe(false);
  });

  it("is hidden when nothing is playing", () => {
    const anywhere: SectionView = { viewedSectionId: "intro", followsPlayback: true };
    expect(playheadBelongsHere(anywhere, null)).toBe(false);
  });
});
