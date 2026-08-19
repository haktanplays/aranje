import { describe, expect, it } from "vitest";

import { createFakeClock } from "@/lib/budget/clock";
import { TTL } from "@/lib/budget/keys";
import { createMemoryKv } from "@/lib/budget/memory-kv";
import { canonicalJson, requestFingerprint } from "@/lib/copilot/fingerprint";
import { claim, complete, fail, release } from "@/lib/copilot/idempotency";
import { FIXED_NOW, TEST_SONG, generationRequest } from "@/test/copilot-fixtures";

function setup() {
  const clock = createFakeClock(FIXED_NOW);
  const kv = createMemoryKv(clock);
  return { clock, kv, deps: { kv } };
}

const KEY = { subjectHash: "subject-1", keyHash: "key-1" };

describe("request fingerprint", () => {
  it("ignores the order object keys happen to be written in", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: [1, { d: 4, c: 3 }] })).toBe(
      '{"a":[1,{"c":3,"d":4}]}',
    );
  });

  it("is the same for the same question", async () => {
    const first = await requestFingerprint(generationRequest());
    const second = await requestFingerprint(generationRequest());
    expect(first).toBe(second);
  });

  it("changes when the prompt, the anchor or the song changes", async () => {
    const base = await requestFingerprint(generationRequest());
    expect(await requestFingerprint(generationRequest({ prompt: "baska" }))).not.toBe(base);
    expect(
      await requestFingerprint(
        generationRequest({ song: { ...TEST_SONG, bpm: TEST_SONG.bpm + 1 } }),
      ),
    ).not.toBe(base);
  });

  it("does not change when only the label or the caller changes", async () => {
    const base = await requestFingerprint(generationRequest());
    expect(
      await requestFingerprint(generationRequest({ idempotencyKey: "idem-key-9999" })),
    ).toBe(base);
    expect(
      await requestFingerprint(generationRequest({ subjectId: "device-zzz" })),
    ).toBe(base);
  });

  it("is a hash, so no song text is carried into a key", async () => {
    const print = await requestFingerprint(generationRequest());
    expect(print).toMatch(/^[0-9a-f]{32}$/);
    expect(print).not.toContain(TEST_SONG.title);
  });
});

describe("idempotency records (spec 12.3)", () => {
  it("lets the first caller claim the key", async () => {
    const { deps } = setup();
    const outcome = await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-1" });
    expect(outcome.outcome).toBe("claimed");
  });

  it("gives a duplicate in-flight caller nothing to run", async () => {
    const { deps } = setup();
    await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-1" });
    const second = await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-2" });
    expect(second.outcome).toBe("in_flight");
    if (second.outcome !== "in_flight") return;
    expect(second.requestId).toBe("req-1");
  });

  it("resolves a concurrent claim race to exactly one winner", async () => {
    const { deps } = setup();
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        claim(deps, { ...KEY, fingerprint: "fp", requestId: `req-${index}` }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.outcome === "claimed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.outcome === "in_flight")).toHaveLength(4);
  });

  it("reports a conflict when the same key carries a different payload", async () => {
    const { deps } = setup();
    await claim(deps, { ...KEY, fingerprint: "fp-a", requestId: "req-1" });
    const clash = await claim(deps, { ...KEY, fingerprint: "fp-b", requestId: "req-2" });
    expect(clash.outcome).toBe("conflict");
  });

  it("replays a finished answer", async () => {
    const { deps } = setup();
    await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-1" });
    await complete(deps, { ...KEY, fingerprint: "fp", requestId: "req-1", response: '{"a":1}' });

    const replay = await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-2" });
    expect(replay.outcome).toBe("replay");
    if (replay.outcome !== "replay") return;
    expect(replay.record.state).toBe("done");
  });

  it("replays a failure too, so a possibly billed call is not re-run free", async () => {
    const { deps } = setup();
    await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-1" });
    await fail(deps, {
      ...KEY,
      fingerprint: "fp",
      requestId: "req-1",
      code: "provider_timeout",
      billed: true,
    });

    const replay = await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-2" });
    expect(replay.outcome).toBe("replay");
    if (replay.outcome !== "replay") return;
    expect(replay.record.state).toBe("failed");
    if (replay.record.state !== "failed") return;
    expect(replay.record.code).toBe("provider_timeout");
    expect(replay.record.billed).toBe(true);
  });

  it("frees the key again when nothing was ever called", async () => {
    const { deps } = setup();
    await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-1" });
    await release(deps, { ...KEY, requestId: "req-1" });
    const again = await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-2" });
    expect(again.outcome).toBe("claimed");
  });

  it("only lets the holder release the claim", async () => {
    const { deps } = setup();
    await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-1" });
    await release(deps, { ...KEY, requestId: "someone-else" });
    const again = await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-2" });
    expect(again.outcome).toBe("in_flight");
  });

  it("expires on the client retry clock, in minutes", async () => {
    const { deps, clock } = setup();
    await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-1" });
    await complete(deps, { ...KEY, fingerprint: "fp", requestId: "req-1", response: "{}" });

    clock.advance((TTL.idempotencySeconds - 1) * 1000);
    expect((await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-2" })).outcome).toBe(
      "replay",
    );

    clock.advance(2000);
    // Past the retry window the key is free again — and a fresh attempt costs
    // a fresh reservation, which is the honest price of a real retry.
    expect((await claim(deps, { ...KEY, fingerprint: "fp", requestId: "req-3" })).outcome).toBe(
      "claimed",
    );
  });

  it("keeps the retry clock far shorter than the budget window", () => {
    // Spec 12.3 keeps these apart on purpose: minutes against days.
    expect(TTL.idempotencySeconds).toBeLessThan(60 * 60);
    expect(TTL.budgetGraceSeconds).toBeGreaterThan(24 * 60 * 60);
  });
});
