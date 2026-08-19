import { describe, expect, it } from "vitest";

import { arrangeAnswer } from "@/lib/ai/fake-skills";
import { parseArrangePatch } from "@/lib/copilot/arrange";
import type { CopilotPatch, CopilotRequest } from "@/lib/copilot/contract";
import {
  buildCandidate,
  diffSummary,
  touchesOnlyTarget,
} from "@/lib/copilot/preview";
import {
  canApply,
  initialPreviewState,
  isStale,
  previewReducer,
  type PreviewState,
} from "@/lib/copilot/preview-machine";
import type { ArrangeSkill } from "@/lib/copilot/contract";
import type { Song, Track } from "@/lib/song/schema";
import {
  HARMONY_SONG,
  TEST_SONG,
  arrangeRequest,
  mainSection,
} from "@/test/copilot-fixtures";

const SECTION_ID = mainSection().id;
const TARGETS: Readonly<Record<ArrangeSkill, string>> = {
  drums: "drums",
  bass: "bass",
  harmony: "gtr2",
};

function songFor(skill: ArrangeSkill): Song {
  return skill === "harmony" ? HARMONY_SONG : TEST_SONG;
}

function trackOf(song: Song, id: string): Track {
  const track = song.tracks.find((entry) => entry.id === id);
  if (!track) throw new Error(`fixture has no ${id}`);
  return track;
}

let patchCounter = 0;

function patchFor(skill: ArrangeSkill, request: CopilotRequest): CopilotPatch {
  const song = songFor(skill);
  const section = song.sections.find((entry) => entry.id === SECTION_ID);
  if (!section) throw new Error("fixture section missing");

  const raw = arrangeAnswer({
    song,
    section,
    target: trackOf(song, TARGETS[skill]),
    skill,
    sectionId: SECTION_ID,
  });
  const parsed = parseArrangePatch(raw, request, () => `patch-${(patchCounter += 1)}`);
  if (!parsed.ok) throw new Error(`fake answer did not parse: ${parsed.diagnostic}`);
  return parsed.patch;
}

describe("building a candidate", () => {
  for (const skill of ["drums", "bass", "harmony"] as ArrangeSkill[]) {
    it(`${skill}: builds a candidate that touches only the target track`, () => {
      const request = arrangeRequest(skill);
      const baseline = songFor(skill);
      const result = buildCandidate(baseline, request, patchFor(skill, request));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        touchesOnlyTarget(baseline, result.candidate, SECTION_ID, TARGETS[skill]),
      ).toBe(true);
      expect(result.diff.trackId).toBe(TARGETS[skill]);
      expect(result.diff.sectionId).toBe(SECTION_ID);
      expect(result.diff.errorCount).toBe(0);
    });
  }

  it("does not touch the baseline song", () => {
    const request = arrangeRequest("drums");
    const before = JSON.stringify(TEST_SONG);
    buildCandidate(TEST_SONG, request, patchFor("drums", request));
    expect(JSON.stringify(TEST_SONG)).toBe(before);
  });

  it("counts the bars and onsets the musician is being asked to accept", () => {
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);
    const result = buildCandidate(TEST_SONG, request, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diff.changedBars).toBeGreaterThan(0);
    expect(result.diff.addedOnsets + result.diff.removedOnsets).toBeGreaterThan(0);
    expect(result.diff.trackName).toBe(trackOf(TEST_SONG, "drums").name);
    expect(result.diff.sectionName).toBe(mainSection().name);
  });

  it("blocks a patch that is out of scope", () => {
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);
    const wrongSection: CopilotPatch = { ...patch, bars: patch.bars.slice(0, 1) };
    const result = buildCandidate(TEST_SONG, request, wrongSection);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.reason).toBe("out_of_scope");
  });

  it("blocks a patch that touches too many bars", () => {
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);
    const repeated: CopilotPatch = {
      ...patch,
      bars: [...patch.bars, ...patch.bars],
    };
    const result = buildCandidate(TEST_SONG, request, repeated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Out of scope first: the bar list no longer matches the section.
    expect(["out_of_scope", "too_large"]).toContain(result.block.reason);
  });

  it("blocks a candidate whose song fails a hard check", () => {
    // Two notes on one string in the same slot is a stringCollision error.
    const request = arrangeRequest("harmony");
    const patch = patchFor("harmony", request);
    const clashing: CopilotPatch = {
      ...patch,
      bars: patch.bars.map((bar, index) =>
        index === 0
          ? {
              barIndex: 0,
              slots: [
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
                { notes: [{ pitch: "F3" }, { pitch: "G#3" }, { pitch: "Bb3" }] },
              ],
            }
          : bar,
      ),
    };
    const result = buildCandidate(HARMONY_SONG, request, clashing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.reason).toBe("invalid_song");
  });

  it("blocks a candidate that reaches past the target track", () => {
    // A patch aimed at a different track than the request named.
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);
    const elsewhere: CopilotPatch = { ...patch, targetTrackId: "gtr" };
    const result = buildCandidate(TEST_SONG, request, elsewhere);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.reason).toBe("out_of_scope");
  });

  it("reports a diff that reaches past the target as not target-only", () => {
    const tampered: Song = {
      ...TEST_SONG,
      sections: TEST_SONG.sections.map((section) =>
        section.id === SECTION_ID
          ? {
              ...section,
              bars: section.bars.map((bar) => ({
                ...bar,
                slots: { ...bar.slots, gtr: Array.from({ length: 8 }, () => null) },
              })),
            }
          : section,
      ),
    };
    expect(touchesOnlyTarget(TEST_SONG, tampered, SECTION_ID, "drums")).toBe(false);
  });

  it("refuses an apply that reaches outside the target track", () => {
    // Defence in depth: the schema cannot say "and change the guitar too" and
    // the real apply writes to one place, so the guard is proved against an
    // apply built to misbehave.
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);

    const sabotage = (song: Song) => ({
      ok: true as const,
      song: {
        ...song,
        sections: song.sections.map((section) =>
          section.id === SECTION_ID
            ? {
                ...section,
                name: "Hacked",
                bars: section.bars.map((bar) => ({
                  ...bar,
                  slots: { ...bar.slots, gtr: Array.from({ length: 8 }, () => null) },
                })),
              }
            : section,
        ),
      },
    });

    const result = buildCandidate(TEST_SONG, request, patch, sabotage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.reason).toBe("locked_surface");
    if (result.block.reason !== "locked_surface") return;
    expect(result.block.fields).toContain(`section:${SECTION_ID}`);
    expect(result.block.fields).toContain(`content:${SECTION_ID}::gtr`);
  });

  it("refuses an apply that writes into another section", () => {
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);
    const other = TEST_SONG.sections.find((entry) => entry.id !== SECTION_ID);
    if (!other) throw new Error("fixture needs two sections");

    const sabotage = (song: Song) => ({
      ok: true as const,
      song: {
        ...song,
        sections: song.sections.map((section) =>
          section.id === other.id
            ? {
                ...section,
                bars: section.bars.map((bar) => ({
                  ...bar,
                  slots: { ...bar.slots, drums: Array.from({ length: 8 }, () => []) },
                })),
              }
            : section,
        ),
      },
    });

    const result = buildCandidate(TEST_SONG, request, patch, sabotage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.reason).toBe("locked_surface");
  });

  it("refuses an apply that changes global track metadata", () => {
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);
    const sabotage = (song: Song) => ({
      ok: true as const,
      song: {
        ...song,
        tracks: song.tracks.map((track) =>
          track.id === "gtr" && track.fretboard
            ? { ...track, fretboard: { ...track.fretboard, capo: 4 } }
            : track,
        ),
      },
    });

    const result = buildCandidate(TEST_SONG, request, patch, sabotage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.reason).toBe("locked_surface");
  });

  it("counts warnings without blocking", () => {
    const request = arrangeRequest("harmony");
    const patch = patchFor("harmony", request);
    // E2 and F2 live only on the thickest string: a spec 10.3 warning.
    const warned: CopilotPatch = {
      ...patch,
      bars: patch.bars.map((bar, index) =>
        index === 0
          ? {
              barIndex: 0,
              slots: [
                { notes: [{ pitch: "E2" }, { pitch: "F2" }] },
                { notes: [{ pitch: "G2" }] },
                { notes: [{ pitch: "B2" }] },
                null,
                null,
                null,
                null,
                null,
              ],
            }
          : bar,
      ),
    };
    const result = buildCandidate(HARMONY_SONG, request, warned);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diff.warningCount).toBeGreaterThan(0);
    expect(result.warnings.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("summarises a diff on its own too", () => {
    const request = arrangeRequest("drums");
    const patch = patchFor("drums", request);
    const built = buildCandidate(TEST_SONG, request, patch);
    if (!built.ok) return;
    expect(diffSummary(TEST_SONG, built.candidate, patch, [])).toMatchObject({
      trackId: "drums",
      sectionId: SECTION_ID,
      warningCount: 0,
      errorCount: 0,
    });
  });
});

describe("the preview state machine", () => {
  const request = arrangeRequest("drums");

  function submitted(): PreviewState {
    return previewReducer(
      previewReducer(initialPreviewState, { type: "open" }),
      { type: "submit", request, baseline: TEST_SONG, source: "demo" },
    );
  }

  function ready(): PreviewState {
    const patch = patchFor("drums", request);
    const built = buildCandidate(TEST_SONG, request, patch);
    if (!built.ok) throw new Error("fixture candidate did not build");
    return previewReducer(submitted(), {
      type: "resolved",
      patch,
      candidate: built.candidate,
      diff: built.diff,
      warnings: built.warnings,
    });
  }

  it("walks the states in order", () => {
    expect(initialPreviewState.status).toBe("closed");
    const open = previewReducer(initialPreviewState, { type: "open" });
    expect(open.status).toBe("editing_request");
    expect(submitted().status).toBe("submitting");
    expect(ready().status).toBe("preview_ready");
    expect(previewReducer(ready(), { type: "play" }).status).toBe("preview_playing");
    expect(previewReducer(ready(), { type: "apply" }).status).toBe("applying");
  });

  it("remembers the song as it was when the request was sent", () => {
    const state = submitted();
    expect(state.baseline).toBe(TEST_SONG);
    expect(state.baselineDigest).not.toBeNull();
  });

  it("refuses a second request while one is in flight", () => {
    const state = submitted();
    const again = previewReducer(state, {
      type: "submit",
      request: arrangeRequest("bass"),
      baseline: TEST_SONG,
      source: "demo",
    });
    expect(again).toBe(state);
  });

  it("refuses a second request while a preview is open", () => {
    const state = ready();
    const again = previewReducer(state, {
      type: "submit",
      request: arrangeRequest("bass"),
      baseline: TEST_SONG,
      source: "demo",
    });
    expect(again).toBe(state);
  });

  it("keeps the sheet as it is when open is pressed again mid-preview", () => {
    const state = ready();
    expect(previewReducer(state, { type: "open" })).toBe(state);
  });

  it("throws the candidate away on close, and changes nothing else", () => {
    const closed = previewReducer(ready(), { type: "close" });
    expect(closed).toEqual(initialPreviewState);
    expect(closed.candidate).toBeNull();
  });

  it("records a failure with a safe message", () => {
    const failed = previewReducer(submitted(), {
      type: "failed",
      error: { code: "provider_unavailable", message: "AI bagli degil." },
    });
    expect(failed.status).toBe("error");
    expect(failed.candidate).toBeNull();
    expect(failed.error?.message).toBe("AI bagli degil.");
  });

  it("lets a failed request be tried again without reopening", () => {
    const failed = previewReducer(submitted(), {
      type: "failed",
      error: { code: "provider_error", message: "x" },
    });
    const retried = previewReducer(failed, {
      type: "submit",
      request,
      baseline: TEST_SONG,
      source: "demo",
    });
    expect(retried.status).toBe("submitting");
  });

  it("will not apply a candidate once the song has moved", () => {
    const state = ready();
    expect(canApply(state, TEST_SONG)).toBe(true);
    expect(isStale(state, TEST_SONG)).toBe(false);

    const moved: Song = { ...TEST_SONG, bpm: TEST_SONG.bpm + 1 };
    expect(isStale(state, moved)).toBe(true);
    expect(canApply(state, moved)).toBe(false);
  });

  it("will not apply from any state but a ready preview", () => {
    expect(canApply(initialPreviewState, TEST_SONG)).toBe(false);
    expect(canApply(submitted(), TEST_SONG)).toBe(false);
    expect(canApply(previewReducer(ready(), { type: "play" }), TEST_SONG)).toBe(true);
  });

  it("returns to closed once the candidate has been written", () => {
    const applying = previewReducer(ready(), { type: "apply" });
    expect(previewReducer(applying, { type: "applied" })).toEqual(initialPreviewState);
  });

  it("does not close in the middle of writing", () => {
    const applying = previewReducer(ready(), { type: "apply" });
    expect(previewReducer(applying, { type: "close" })).toBe(applying);
  });

  it("ignores events that do not belong to the current state", () => {
    expect(previewReducer(initialPreviewState, { type: "play" }).status).toBe("closed");
    expect(previewReducer(initialPreviewState, { type: "apply" }).status).toBe("closed");
    expect(previewReducer(ready(), { type: "stop" }).status).toBe("preview_ready");
  });
});
