/**
 * The musical promises, and the fixture that can falsify them
 * (2U-A handoff §5).
 *
 * The point of each test here is that it could fail. A "the other track came
 * too" check on a one-track song is a check that passes whatever happens, so
 * every case below runs against the real two-track fixture.
 */
import { describe, expect, it } from "vitest";

import {
  EDITOR_BASS_ID,
  EDITOR_GUITAR_ID,
  editorFixture,
} from "@/lib/acceptance/editor-fixture";
import {
  barCount,
  invariantChecks,
  noteCount,
  soundingPitches,
} from "@/lib/acceptance/editor-invariants";
import type { Song } from "@/lib/song/schema";

const clone = (song: Song): Song => JSON.parse(JSON.stringify(song)) as Song;

/** Move every guitar note one string thinner, keeping the written pitch. */
function restrungKeepingPitch(song: Song): Song {
  const next = clone(song);
  for (const bar of next.sections[0]!.bars) {
    for (const slot of bar.slots[EDITOR_GUITAR_ID] ?? []) {
      if (!slot || slot === "-" || Array.isArray(slot)) continue;
      for (const note of slot.notes) {
        if (note.position) note.position.string += 1;
      }
    }
  }
  return next;
}

/** The same move, but the pitch follows the string — the failure to catch. */
function restrungChangingPitch(song: Song): Song {
  const next = restrungKeepingPitch(song);
  for (const bar of next.sections[0]!.bars) {
    for (const slot of bar.slots[EDITOR_GUITAR_ID] ?? []) {
      if (!slot || slot === "-" || Array.isArray(slot)) continue;
      for (const note of slot.notes) note.pitch = "C9";
    }
  }
  return next;
}

/** A duplicated bar that took only the guitar with it. */
function duplicatedGuitarOnly(song: Song): Song {
  const next = clone(song);
  const source = next.sections[0]!.bars[0]!;
  next.sections[0]!.bars.splice(1, 0, {
    ...source,
    slots: { [EDITOR_GUITAR_ID]: JSON.parse(JSON.stringify(source.slots[EDITOR_GUITAR_ID])) },
  });
  return next;
}

/** A duplicated bar that took everything, which is what should happen. */
function duplicatedWhole(song: Song): Song {
  const next = clone(song);
  next.sections[0]!.bars.splice(1, 0, clone(song).sections[0]!.bars[0]!);
  return next;
}

describe("reading the music", () => {
  it("counts every sounding pitch, in a stable order", () => {
    const pitches = soundingPitches(editorFixture());
    expect(pitches.length).toBeGreaterThan(5);
    expect([...pitches]).toEqual([...pitches].sort());
  });

  it("counts one track's notes separately from the whole song", () => {
    const song = editorFixture();
    const bass = noteCount(song, EDITOR_BASS_ID);
    expect(bass).toBeGreaterThan(0);
    expect(noteCount(song)).toBeGreaterThan(bass);
  });

  it("counts the bars the section has", () => {
    /* Six since 2V-B.1 §10: the four the editor steps need, plus the slide
       and vibrato bar and the legato bar the listening steps need. */
    expect(barCount(editorFixture())).toBe(6);
  });
});

describe("a string move keeps what is heard", () => {
  it("passes when only the position moved", () => {
    const before = editorFixture();
    const checks = invariantChecks(
      "moveStringThick",
      before,
      restrungKeepingPitch(before),
      EDITOR_BASS_ID,
    );
    expect(checks.moveKeptSoundingPitch).toBe(true);
    expect(checks.moveNoOverwrite).toBe(true);
  });

  /* The silent failure: one write, one history step, different music. */
  it("fails when the pitch followed the string", () => {
    const before = editorFixture();
    const checks = invariantChecks(
      "moveStringThin",
      before,
      restrungChangingPitch(before),
      EDITOR_BASS_ID,
    );
    expect(checks.moveKeptSoundingPitch).toBe(false);
  });

  it("fails when a note was overwritten on the way", () => {
    const before = editorFixture();
    const after = clone(before);
    after.sections[0]!.bars[0]!.slots[EDITOR_GUITAR_ID]![4] = null;
    expect(
      invariantChecks("moveTimeRight", before, after, EDITOR_BASS_ID).moveNoOverwrite,
    ).toBe(false);
  });
});

describe("a measure operation takes every track with it", () => {
  it("passes when the whole bar was duplicated", () => {
    const before = editorFixture();
    const checks = invariantChecks(
      "measureDuplicated",
      before,
      duplicatedWhole(before),
      EDITOR_BASS_ID,
    );
    expect(checks.measureAllTracksAligned).toBe(true);
    expect(checks.measureOtherTrackKept).toBe(true);
  });

  /*
   * The failure the bass exists to catch: the section got longer, so a
   * bar-count check alone is happy, and the bass simply is not there.
   */
  it("fails when the duplicate left the bass behind", () => {
    const before = editorFixture();
    const checks = invariantChecks(
      "measureDuplicated",
      before,
      duplicatedGuitarOnly(before),
      EDITOR_BASS_ID,
    );
    expect(checks.measureAllTracksAligned).toBe(true);
    expect(checks.measureOtherTrackKept).toBe(false);
  });

  it("wants a move to change nothing but the order", () => {
    const before = editorFixture();
    const after = clone(before);
    const [bar] = after.sections[0]!.bars.splice(2, 1);
    after.sections[0]!.bars.splice(3, 0, bar!);
    const checks = invariantChecks("measureMovedRight", before, after, EDITOR_BASS_ID);
    expect(checks.measureAllTracksAligned).toBe(true);
    expect(checks.measureOtherTrackKept).toBe(true);
  });

  it("wants a delete to leave one bar fewer", () => {
    const before = editorFixture();
    const after = clone(before);
    after.sections[0]!.bars.splice(3, 1);
    expect(
      invariantChecks("measureDeleted", before, after, EDITOR_BASS_ID)
        .measureAllTracksAligned,
    ).toBe(true);
  });
});

/*
 * A phase with no musical promise gets nothing rather than a `true`: a PASS
 * for a question nobody asked is the quietest way to inflate a report.
 */
describe("a phase that promises nothing musical", () => {
  it("answers with an empty record", () => {
    const song = editorFixture();
    expect(invariantChecks("copyNoWrite", song, song, EDITOR_BASS_ID)).toEqual({});
    expect(invariantChecks("extendGrew", song, song, EDITOR_BASS_ID)).toEqual({});
  });
});
