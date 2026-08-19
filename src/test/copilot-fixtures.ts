/**
 * Shared fixtures for the copilot tests.
 *
 * The price table here is a **placeholder**, not a quotation. Spec 12.4 keeps
 * real prices in a versioned backend configuration and this checkpoint does
 * not choose a provider, so the numbers below are deliberately round and
 * deliberately unlike any published price: they exist to make the arithmetic
 * checkable, and nothing may read them as a real cost.
 */
import type { AdapterUsage } from "@/lib/ai/adapter";
import type { CopilotConfig } from "@/lib/config/copilot";
import type { PriceTable } from "@/lib/budget/pricing";
import type { CopilotRequest, PatchSection } from "@/lib/copilot/contract";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Bar, Song } from "@/lib/song/schema";

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

export function emptyBar(trackId: string): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 8,
    slots: { [trackId]: Array.from({ length: 8 }, () => null) },
  };
}

/** A section a model could plausibly return: silent, valid, in key. */
export function pendingSection(bars = 2, id = "ai-1"): PatchSection {
  return {
    id,
    name: "AI bolum",
    status: "pending",
    bars: Array.from({ length: bars }, () => emptyBar("gtr")),
  };
}

export function generationRequest(
  overrides: Partial<Extract<CopilotRequest, { kind: "generation" }>> = {},
): CopilotRequest {
  const anchor = TEST_SONG.sections[0];
  if (!anchor) throw new Error("sample song has no sections");
  return {
    kind: "generation",
    afterSectionId: anchor.id,
    subjectId: "device-abc",
    idempotencyKey: "idem-key-0001",
    prompt: "Opeth tarzi akustik pasaj ekle",
    song: TEST_SONG,
    ...overrides,
  };
}

export function modelAnswer(section: PatchSection = pendingSection()): string {
  const anchor = TEST_SONG.sections[0];
  return JSON.stringify({
    action: "insert_section",
    afterSectionId: anchor?.id ?? "intro",
    section,
    explanation: "Iki barlik sakin bir gecis.",
  });
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
