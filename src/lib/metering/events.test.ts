import { describe, expect, it } from "vitest";

import { createFakeAdapter } from "@/lib/ai/fake-adapter";
import { createFakeClock } from "@/lib/budget/clock";
import { createMemoryKv } from "@/lib/budget/memory-kv";
import { runCopilot } from "@/lib/copilot/pipeline";
import {
  createMemoryMeter,
  emitMeteringEvent,
  latencyClassFor,
  meteringEventSchema,
  type MeteringEvent,
} from "@/lib/metering/events";
import { arrangeAnswer } from "@/lib/ai/fake-skills";
import {
  FIXED_NOW,
  TEST_SONG,
  arrangeRequest,
  mainSection,
  testConfig,
  usage,
} from "@/test/copilot-fixtures";

/** What the drum skill would answer for the fixture's main section. */
function modelAnswer(): string {
  const section = mainSection();
  const target = TEST_SONG.tracks.find((track) => track.id === "drums");
  if (!target) throw new Error("fixture has no drum track");
  return arrangeAnswer({
    song: TEST_SONG,
    section,
    target,
    skill: "drums",
    sectionId: section.id,
  });
}

const SAMPLE: MeteringEvent = {
  requestId: "req-1",
  subjectHash: "0123456789abcdef0123456789abcdef",
  idempotency: "fresh",
  adapterRoute: "default",
  adapterId: "fake",
  model: "claude-sonnet-5",
  priceTableVersion: "test-placeholder-1",
  reservedMicros: 840_000,
  verifiedUsage: {
    inputTokens: 1000,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  settledMicros: 30_000,
  refundedMicros: 810_000,
  unverifiedReason: null,
  cache: "miss",
  rounds: 1,
  totalRoundCostMicros: 30_000,
  validation: "passed",
  validationErrorCodes: [],
  latencyClass: "fast",
  outcome: "success",
  errorCode: null,
};

describe("metering event model (spec 12.4)", () => {
  it("covers every field the operator needs to read a request back", () => {
    expect(Object.keys(meteringEventSchema.shape).sort()).toEqual([
      "adapterId",
      "adapterRoute",
      "cache",
      "errorCode",
      "idempotency",
      "latencyClass",
      "model",
      "outcome",
      "priceTableVersion",
      "refundedMicros",
      "requestId",
      "reservedMicros",
      "rounds",
      "settledMicros",
      "subjectHash",
      "totalRoundCostMicros",
      "unverifiedReason",
      "validation",
      "validationErrorCodes",
      "verifiedUsage",
    ]);
  });

  it("refuses a field that was never meant to be metered", () => {
    const smuggled = { ...SAMPLE, prompt: "Opeth tarzi akustik pasaj ekle" };
    expect(() => emitMeteringEvent(() => {}, smuggled as MeteringEvent)).toThrow();
  });

  it("classifies latency without inventing a spec figure", () => {
    expect(latencyClassFor(10)).toBe("fast");
    expect(latencyClassFor(3000)).toBe("normal");
    expect(latencyClassFor(20_000)).toBe("slow");
  });

  it("keeps song content, prompts and identities out of the row", async () => {
    const clock = createFakeClock(FIXED_NOW);
    const kv = createMemoryKv(clock);
    const meter = createMemoryMeter();
    const request = arrangeRequest("drums");

    await runCopilot(
      {
        config: testConfig(),
        kv,
        clock,
        adapter: createFakeAdapter([
          { kind: "success", raw: modelAnswer(), usage: usage() },
        ]),
        meter,
        newRequestId: () => "req-1",
        newPatchId: () => "patch-1",
      },
      request,
    );

    const serialised = JSON.stringify(meter.events);
    expect(meter.events).toHaveLength(1);

    for (const secret of [
      request.instruction ?? "",
      request.subjectId,
      request.idempotencyKey,
      TEST_SONG.title,
      TEST_SONG.key,
      "E2",
      "kick",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("names the failure reason in fixed words, never the provider's", async () => {
    const clock = createFakeClock(FIXED_NOW);
    const meter = createMemoryMeter();

    await runCopilot(
      {
        config: testConfig(),
        kv: createMemoryKv(clock),
        clock,
        adapter: createFakeAdapter([
          { kind: "network_error", diagnostic: "ECONNRESET key=sk-live-xyz" },
        ]),
        meter,
        newRequestId: () => "req-1",
        newPatchId: () => "patch-1",
      },
      arrangeRequest("drums"),
    );

    const serialised = JSON.stringify(meter.events);
    expect(serialised).not.toContain("ECONNRESET");
    expect(serialised).not.toContain("sk-live");
    expect(meter.events[0]?.unverifiedReason).toBe("provider_network_error");
  });
});
