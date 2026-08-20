/**
 * Shadow eval S-01 seed song. **Not** a product fixture.
 *
 * Production Copilot cannot create sections (spec 11.1, K-18: the only public
 * operation is `arrange_track`), so an evaluation that wants four sections has
 * to start from a song that already has them. This is that scaffold and
 * nothing else: sixteen empty bars with the right shape, the right tracks and
 * the right silences, waiting to be filled one track-section at a time.
 *
 * Everything here is deliberate:
 *
 * - **64 BPM, 4/4, 16 bars** is exactly 60.0 seconds, which is the target.
 * - **1/16** is the finest resolution the Song Contract allows, and a
 *   stop-start riff needs sixteenths to be written at all.
 * - **No bass track**, anywhere — not in a section, not in the track list.
 * - **Acoustic Outro carries only the acoustic key.** The other three tracks
 *   are not written in it, which is how spec 5.5 spells silence. Writing an
 *   array of nulls would be a different statement: "this track plays nothing
 *   here", rather than "this track is not in this section".
 *
 * No artist, band or song name appears in this file, in the Song title, or in
 * anything sent to a model.
 */
import { songSchema, type Bar, type Section, type Song } from "@/lib/song/schema";
import { TUNING_PRESETS } from "@/lib/music/fretboard";

export const TRACK_IDS = {
  rhythm: "rhythm_gtr",
  lead: "lead_gtr",
  drums: "drums",
  acoustic: "acoustic_gtr",
} as const;

export const SECTION_IDS = {
  break: "break",
  bridge: "heavy_bridge",
  solo: "solo",
  outro: "acoustic_outro",
} as const;

const DROP_D = TUNING_PRESETS.drop_d?.tuning ?? [];
const E_STANDARD = TUNING_PRESETS.e_standard?.tuning ?? [];

/** 4/4 at 1/16 is sixteen slots; every one of them starts empty. */
const SLOTS_PER_BAR = 16;

function emptyMelodic(): null[] {
  return Array.from({ length: SLOTS_PER_BAR }, () => null);
}

function emptyDrums(): never[][] {
  return Array.from({ length: SLOTS_PER_BAR }, () => []);
}

/** One bar, written for exactly the tracks this section contains. */
function emptyBar(trackIds: readonly string[]): Bar {
  const slots: Bar["slots"] = {};
  for (const id of trackIds) {
    slots[id] = id === TRACK_IDS.drums ? emptyDrums() : emptyMelodic();
  }
  return { timeSignature: [4, 4], resolution: 16, slots };
}

function section(id: string, name: string, trackIds: readonly string[]): Section {
  return {
    id,
    name,
    status: "fixed",
    bars: Array.from({ length: 4 }, () => emptyBar(trackIds)),
  };
}

const HEAVY = [TRACK_IDS.rhythm, TRACK_IDS.drums] as const;
const SOLO = [TRACK_IDS.rhythm, TRACK_IDS.lead, TRACK_IDS.drums] as const;
const OUTRO = [TRACK_IDS.acoustic] as const;

const parsed = songSchema.safeParse({
  version: 2,
  title: "Shadow Eval S-01",
  bpm: 64,
  key: "D minor",
  tracks: [
    {
      id: TRACK_IDS.rhythm,
      name: "Rhythm Guitar",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: -3,
      pan: -0.3,
      fretboard: { tuning: [...DROP_D], capo: 0 },
    },
    {
      id: TRACK_IDS.lead,
      name: "Lead Guitar",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: -4,
      pan: 0.25,
      fretboard: { tuning: [...DROP_D], capo: 0 },
    },
    {
      id: TRACK_IDS.drums,
      name: "Drums",
      instrumentId: "drum_kit",
      presetId: "rock",
      volumeDb: -5,
    },
    {
      id: TRACK_IDS.acoustic,
      name: "Acoustic Guitar",
      instrumentId: "steel_acoustic",
      presetId: "finger",
      volumeDb: -2,
      fretboard: { tuning: [...E_STANDARD], capo: 0 },
    },
  ],
  sections: [
    section(SECTION_IDS.break, "Break", HEAVY),
    section(SECTION_IDS.bridge, "Heavy Bridge", HEAVY),
    section(SECTION_IDS.solo, "Solo", SOLO),
    section(SECTION_IDS.outro, "Acoustic Outro", OUTRO),
  ],
});

if (!parsed.success) {
  throw new Error(`seed song does not parse: ${parsed.error.message}`);
}

export const SEED_SONG: Song = parsed.data;
