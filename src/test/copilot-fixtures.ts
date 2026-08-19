/**
 * Shared fixtures for the copilot tests.
 *
 * The price table here is a **placeholder**, not a quotation. Spec 12.4 keeps
 * real prices in a versioned backend configuration and this checkpoint does
 * not choose a provider, so the numbers below are deliberately round and
 * deliberately unlike any published price: they exist to make the arithmetic
 * checkable, and nothing may read them as a real cost.
 *
 * `HARMONY_SONG` is a separate fixture with a second guitar already on it. The
 * demo song is what phase 1 was accepted on and it is not given a new track
 * just so a test has somewhere to write (K-18).
 */
import type { AdapterUsage } from "@/lib/ai/adapter";
import type { CopilotConfig } from "@/lib/config/copilot";
import type { PriceTable } from "@/lib/budget/pricing";
import type { ArrangeSkill, CopilotRequest } from "@/lib/copilot/contract";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Section, Song, Track } from "@/lib/song/schema";

export const PLACEHOLDER_PRICE_TABLE: PriceTable = {
  version: "test-placeholder-1",
  models: {
    "claude-sonnet-5": {
      inputPerMTokUsd: 10,
      outputPerMTokUsd: 50,
      cacheReadPerMTokUsd: 1,
      cacheWritePerMTokUsd: 12,
    },
    "claude-haiku-4-5-20251001": {
      inputPerMTokUsd: 1,
      outputPerMTokUsd: 5,
      cacheReadPerMTokUsd: 1,
      cacheWritePerMTokUsd: 2,
    },
  },
};

export function testConfig(overrides: Partial<CopilotConfig> = {}): CopilotConfig {
  return {
    modelDefault: "claude-sonnet-5",
    modelCheap: "claude-haiku-4-5-20251001",
    modelEscalation: "",
    enableCheapRouting: false,
    maxInputTokens: 8000,
    maxOutputTokens: 4000,
    dailyBudgetUsd: 2,
    monthlyBudgetUsd: 20,
    freePatchesPerUserPerDay: 3,
    priceTable: PLACEHOLDER_PRICE_TABLE,
    ...overrides,
  };
}

/** 2026-08-19T12:00:00Z, well inside a day and a month. */
export const FIXED_NOW = Date.UTC(2026, 7, 19, 12, 0, 0);

export const TEST_SONG: Song = SAMPLE_SONG;

/** The section every arrange test works inside: the one with the full band. */
export function mainSection(song: Song = TEST_SONG): Section {
  const section = song.sections.find((entry) =>
    entry.bars.some((bar) => bar.slots.drums !== undefined),
  );
  if (!section) throw new Error("fixture has no section with drums");
  return section;
}

/** A second guitar, for the harmony skill. Added to a copy, never to the demo. */
export const HARMONY_TRACK: Track = {
  id: "gtr2",
  name: "Armoni gitar",
  instrumentId: "electric_guitar",
  presetId: "clean",
  volumeDb: -8,
  fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
};

/**
 * The demo song plus an empty harmony guitar. The track is silent everywhere
 * (spec 5.5), which is exactly the state a musician would be in before asking
 * for a harmony part.
 */
export const HARMONY_SONG: Song = {
  ...TEST_SONG,
  tracks: [...TEST_SONG.tracks, HARMONY_TRACK],
};

export type RequestOverrides = Partial<CopilotRequest>;

const TARGET_BY_SKILL: Readonly<Record<ArrangeSkill, string>> = {
  drums: "drums",
  bass: "bass",
  harmony: "gtr2",
};

export function arrangeRequest(
  skill: ArrangeSkill,
  overrides: RequestOverrides = {},
): CopilotRequest {
  const song = overrides.song ?? (skill === "harmony" ? HARMONY_SONG : TEST_SONG);
  const targetTrackId = overrides.targetTrackId ?? TARGET_BY_SKILL[skill];
  const sectionId = overrides.sectionId ?? mainSection(song).id;

  return {
    operation: "arrange_track",
    skill,
    sectionId,
    targetTrackId,
    lockedTrackIds: song.tracks
      .map((track) => track.id)
      .filter((id) => id !== targetTrackId),
    subjectId: "device-abc",
    idempotencyKey: "idem-key-0001",
    instruction: "Bolumu daha nefes alan bir sekilde duzenle",
    ...overrides,
    song,
  };
}

export function usage(overrides: Partial<AdapterUsage> = {}): AdapterUsage {
  return {
    inputTokens: 1000,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  };
}
