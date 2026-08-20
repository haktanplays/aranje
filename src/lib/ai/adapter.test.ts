import { describe, expect, it } from "vitest";

import {
  CeilingError,
  checkCeilings,
  withCeilings,
  type AdapterRequest,
} from "@/lib/ai/adapter";
import { createFakeAdapter, fakeUsage } from "@/lib/ai/fake-adapter";

const CEILINGS = { maxInputTokens: 8000, maxOutputTokens: 4000 };

function request(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    model: "claude-sonnet-5",
    system: ["fixed"],
    userMessage: "variable",
    responseSchema: { type: "object", additionalProperties: false },
    maxOutputTokens: 4000,
    estimatedInputTokens: 1000,
    timeoutMs: 30_000,
    ...overrides,
  };
}

describe("adapter token ceilings (spec 11.3)", () => {
  it("accepts a request inside both ceilings", () => {
    expect(checkCeilings(request(), CEILINGS)).toBeNull();
  });

  it("rejects an oversized input before the provider is reached", async () => {
    const adapter = createFakeAdapter([
      { kind: "success", raw: "{}", usage: fakeUsage() },
    ]);
    const guarded = withCeilings(adapter, CEILINGS);

    await expect(
      guarded.call(request({ estimatedInputTokens: 8001 })),
    ).rejects.toBeInstanceOf(CeilingError);

    // The point of the check: nothing was sent.
    expect(adapter.calls).toHaveLength(0);
    expect(adapter.remaining()).toBe(1);
  });

  it("accepts exactly the ceiling", async () => {
    const adapter = createFakeAdapter([
      { kind: "success", raw: "{}", usage: fakeUsage() },
    ]);
    const guarded = withCeilings(adapter, CEILINGS);
    await guarded.call(request({ estimatedInputTokens: 8000 }));
    expect(adapter.calls).toHaveLength(1);
  });

  it("requires an output ceiling on the request itself", async () => {
    const adapter = createFakeAdapter([
      { kind: "success", raw: "{}", usage: fakeUsage() },
    ]);
    const guarded = withCeilings(adapter, CEILINGS);

    // Asking the model to be brief in the prompt is not a limit; the limit is
    // a request parameter, and a call without one does not leave the process.
    await expect(
      guarded.call(request({ maxOutputTokens: 0 })),
    ).rejects.toBeInstanceOf(CeilingError);
    await expect(
      guarded.call(request({ maxOutputTokens: Number.NaN })),
    ).rejects.toBeInstanceOf(CeilingError);
    expect(adapter.calls).toHaveLength(0);
  });

  it("rejects an output ceiling above the configured maximum", () => {
    const violation = checkCeilings(
      request({ maxOutputTokens: 4001 }),
      CEILINGS,
    );
    expect(violation).toEqual({
      kind: "output_ceiling_too_high",
      requested: 4001,
      ceiling: 4000,
    });
  });

  it("passes the declared ceiling through to the provider request", async () => {
    const adapter = createFakeAdapter([
      { kind: "success", raw: "{}", usage: fakeUsage() },
    ]);
    await withCeilings(adapter, CEILINGS).call(request());
    expect(adapter.calls[0]?.maxOutputTokens).toBe(4000);
  });
});

describe("fake adapter scenarios", () => {
  it("plays scenarios back in order", async () => {
    const adapter = createFakeAdapter([
      { kind: "timeout" },
      { kind: "success", raw: "ok", usage: fakeUsage() },
    ]);
    expect((await adapter.call(request())).ok).toBe(false);
    const second = await adapter.call(request());
    expect(second.ok).toBe(true);
  });

  it("reports a success whose usage cannot be verified", async () => {
    const adapter = createFakeAdapter([
      { kind: "success_unverified_usage", raw: "ok", reason: "no usage block" },
    ]);
    const result = await adapter.call(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // null, not zero: a zeroed usage would read as a free call.
    expect(result.usage).toBeNull();
    expect(result.usageUnverifiedReason).toBe("no usage block");
  });

  it("answers an already-aborted signal as an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createFakeAdapter([
      { kind: "success", raw: "ok", usage: fakeUsage() },
    ]);
    const result = await adapter.call(request({ signal: controller.signal }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("aborted");
  });

  it("keeps provider wording out of the success path entirely", async () => {
    const adapter = createFakeAdapter([
      { kind: "provider_error", diagnostic: "sk-secret leaked in provider text" },
    ]);
    const result = await adapter.call(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // It exists, on the server, for a log. Whether it may be sent to a client
    // is decided in errors.ts, not here.
    expect(result.diagnostic).toContain("sk-secret");
  });
});
