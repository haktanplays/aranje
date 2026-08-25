/**
 * A hit written by tapping is the same hit (2Q-B §11).
 *
 * The point of putting cross-instrument entry behind one command core was
 * that the music it produces has to be indistinguishable from the same music
 * arriving any other way — typed in, imported from a file, or written by the
 * Copilot. "Indistinguishable" is not a feeling: it is byte equality of the
 * Song, and identical output from every consumer downstream of it.
 *
 * So these tests take a song written by hand and a song written by command,
 * and compare them through the five things that read a Song and can tell:
 * playback's plan, the MIDI plan, the project file, the Copilot fingerprint,
 * and the history's own sameness check.
 */
import { describe, expect, it } from "vitest";

import { buildSongPlan } from "@/lib/audio/schedule";
import { DRUM_PIECES } from "@/lib/instruments/registry";
import { requestFingerprint } from "@/lib/copilot/fingerprint";
import { buildMidiPlan } from "@/lib/export/midi-plan";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { insertDrumHit, insertPitchedNote } from "@/lib/song/event-entry";
import { sameSong } from "@/lib/song/edit-history";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { ticksPerSlot } from "@/lib/music/timing";
import {
  songSchema,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Song,
} from "@/lib/song/schema";

const SECTION = SAMPLE_SONG.sections[0]!.id;
const BAR0 = SAMPLE_SONG.sections[0]!.bars[0]!;
const PER_SLOT = ticksPerSlot(BAR0.resolution);
/** A beat the sample song already plays a hat on: a hit joins it, it is not replaced. */
const SLOT = 5;

const KEYS = {
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
} as const;

function withKeys(): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  next.tracks = [...next.tracks, { ...KEYS }];
  for (const section of next.sections) {
    for (const bar of section.bars) {
      bar.slots[KEYS.id] = bar.slots["gtr"]!.map(() => null) as Bar["slots"][string];
    }
  }
  return songSchema.parse(next);
}

/**
 * The same music, written straight into the slots.
 *
 * The hat that is already on this beat stays, and the two hits are laid in
 * kit order — which is what the command does, and what serialising the same
 * music twice has to produce if a fingerprint is to mean anything.
 */
function drumByHand(): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  const lane = next.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[];
  const hit = { piece: "snare" as const, velocity: 120, articulation: "accent" as const };
  lane[SLOT] = [...(lane[SLOT] ?? []), hit].sort(
    (left, right) => DRUM_PIECES.indexOf(left.piece) - DRUM_PIECES.indexOf(right.piece),
  );
  return songSchema.parse(next);
}

function pitchedByHand(): Song {
  const next = withKeys();
  const lane = next.sections[0]!.bars[0]!.slots[KEYS.id] as MelodicSlot[];
  lane[SLOT] = { notes: [{ pitch: "A3" }] };
  return songSchema.parse(next);
}

const drumByCommand = (): Song => {
  const result = insertDrumHit(
    SAMPLE_SONG,
    { sectionId: SECTION, trackId: "drums", ticks: PER_SLOT * SLOT },
    { piece: "snare", velocity: 120, articulation: "accent" },
  );
  expect(result.ok).toBe(true);
  return result.ok ? result.song : SAMPLE_SONG;
};

const pitchedByCommand = (): Song => {
  const result = insertPitchedNote(
    withKeys(),
    { sectionId: SECTION, trackId: KEYS.id, ticks: PER_SLOT * SLOT },
    { pitch: "A3" },
  );
  expect(result.ok).toBe(true);
  return result.ok ? result.song : withKeys();
};

const PAIRS: readonly (readonly [string, () => Song, () => Song])[] = [
  ["davul vuruşu", drumByHand, drumByCommand],
  ["perdesiz nota", pitchedByHand, pitchedByCommand],
];

describe("226. what the entry commands write is the same music", () => {
  for (const [name, byHand, byCommand] of PAIRS) {
    it(`${name}: the Song itself is byte-identical`, () => {
      expect(JSON.stringify(byCommand())).toBe(JSON.stringify(byHand()));
    });

    it(`${name}: history sees no difference between them`, () => {
      expect(sameSong(byCommand(), byHand())).toBe(true);
    });

    it(`${name}: playback schedules exactly the same events`, () => {
      expect(buildSongPlan(byCommand())).toEqual(buildSongPlan(byHand()));
    });

    it(`${name}: the MIDI plan is the same plan`, () => {
      const written = buildMidiPlan(byCommand());
      const hand = buildMidiPlan(byHand());
      expect(written.ok).toBe(true);
      expect(written).toEqual(hand);
    });

    it(`${name}: the project file is byte-identical`, () => {
      const written = exportProject(byCommand());
      const hand = exportProject(byHand());
      expect(written.ok && hand.ok).toBe(true);
      if (!written.ok || !hand.ok) return;
      expect(written.text).toBe(hand.text);
    });

    it(`${name}: and that file reads back as the same song`, () => {
      /*
       * Round-tripping is asserted separately from parity because they are
       * different claims: the file being the same file says the write is
       * indistinguishable, and reading it back says nothing was lost on the
       * way. The order of keys in the read-back song is the schema's, which
       * is why this compares to a round trip rather than to the song in hand.
       */
      const written = exportProject(byCommand());
      const handFile = exportProject(byHand());
      expect(written.ok && handFile.ok).toBe(true);
      if (!written.ok || !handFile.ok) return;
      const parsed = parseProjectText(written.text);
      const hand = parseProjectText(handFile.text);
      expect(parsed.ok && hand.ok).toBe(true);
      if (!parsed.ok || !hand.ok) return;
      expect(JSON.stringify(parsed.song)).toBe(JSON.stringify(hand.song));
      expect(buildSongPlan(parsed.song)).toEqual(buildSongPlan(byCommand()));
    });

    it(`${name}: the Copilot fingerprint is the same fingerprint`, async () => {
      const ask = (song: Song) =>
        requestFingerprint({
          operation: "arrange_track",
          skill: "drums",
          sectionId: SECTION,
          targetTrackId: "drums",
          lockedTrackIds: [],
          subjectId: "parity",
          idempotencyKey: "parity",
          song,
        });
      expect(await ask(byCommand())).toBe(await ask(byHand()));
    });
  }

  it("adds exactly one event to the plan and moves nothing else", () => {
    const before = buildSongPlan(SAMPLE_SONG).events;
    const after = buildSongPlan(drumByCommand()).events;
    expect(after).toHaveLength(before.length + 1);
    // Every event that was there is still there, unchanged.
    for (const event of before) expect(after).toContainEqual(event);
  });

  it("is not vacuous: a different hit is a different plan", () => {
    const other = insertDrumHit(
      SAMPLE_SONG,
      { sectionId: SECTION, trackId: "drums", ticks: PER_SLOT * SLOT },
      { piece: "kick", velocity: 120, articulation: "accent" },
    );
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(buildSongPlan(other.song)).not.toEqual(buildSongPlan(drumByHand()));
  });
});
