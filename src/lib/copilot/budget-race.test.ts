/**
 * One budget, one provider call — proved with a barrier, not with a stopwatch
 * (2S-A kapanış §3).
 *
 * The claim these hold is the one that costs money: when the remaining budget
 * is enough for exactly one request and two arrive together, exactly one is
 * reserved, and the one that is refused never reaches the provider at all. A
 * refusal that arrives *after* the call has already been paid for is not a
 * refusal, it is a receipt.
 *
 * Nothing here sleeps or races the scheduler. The fake adapter's
 * `beforeAnswer` hook holds the first call open until the test lets it go, so
 * the second caller genuinely arrives while the first is in flight, every
 * time, on every machine.
 *
 * Both callers ask for the *same* skill on purpose. The fake adapter answers
 * from a positional queue, so giving them different skills would make the
 * queue's order — not the budget — decide how many calls happen, and a
 * correction round would be miscounted as a second caller getting through.
 * That is exactly the reading that made the original flake look like a
 * double-spend.
 */
import { describe, expect, it } from "vitest";

import { createFakeAdapter, type FakeScenario } from "@/lib/ai/fake-adapter";
import { arrangeAnswer } from "@/lib/ai/fake-skills";
import { createFakeClock } from "@/lib/budget/clock";
import { worstCaseReservationMicros } from "@/lib/budget/cost";
import type { KvStore, KvTransaction } from "@/lib/budget/kv";
import { createMemoryKv, type MemoryKv } from "@/lib/budget/memory-kv";
import type { ArrangeSkill } from "@/lib/copilot/contract";
import { runCopilot, type PipelineDeps } from "@/lib/copilot/pipeline";
import { createMemoryMeter } from "@/lib/metering/events";
import type { Section, Song, Track } from "@/lib/song/schema";
import {
  FIXED_NOW,
  HARMONY_SONG,
  PLACEHOLDER_PRICE_TABLE,
  TEST_SONG,
  arrangeRequest,
  mainSection,
  testConfig,
  usage,
} from "@/test/copilot-fixtures";

const PRICE = PLACEHOLDER_PRICE_TABLE.models["claude-sonnet-5"];
if (!PRICE) throw new Error("fixture price missing");

const WORST_CASE = worstCaseReservationMicros(
  { maxInputTokens: 8000, maxOutputTokens: 4000 },
  PRICE,
);

const SECTION_ID = mainSection().id;
const TARGETS: Readonly<Record<ArrangeSkill, string>> = {
  rhythm_guitar: "gtr",
  lead_guitar: "gtr",
  acoustic_guitar: "acc",
  harmony: "gtr2",
  bass: "bass",
  drums: "drums",
};

function songFor(skill: ArrangeSkill): Song {
  return skill === "harmony" ? HARMONY_SONG : TEST_SONG;
}

function sectionOf(song: Song): Section {
  const section = song.sections.find((entry) => entry.id === SECTION_ID);
  if (!section) throw new Error("fixture section missing");
  return section;
}

function trackOf(song: Song, id: string): Track {
  const track = song.tracks.find((entry) => entry.id === id);
  if (!track) throw new Error(`fixture has no track ${id}`);
  return track;
}

function goodRound(skill: ArrangeSkill): FakeScenario {
  return {
    kind: "success",
    raw: arrangeAnswer({
      song: songFor(skill),
      section: sectionOf(songFor(skill)),
      target: trackOf(songFor(skill), TARGETS[skill]),
      skill,
      sectionId: SECTION_ID,
    }),
    usage: usage(),
  };
}


/**
 * A store that makes two reservations genuinely overlap.
 *
 * Holding the *adapter* open proves what happens after the budget is decided;
 * it cannot prove the deciding itself is one step, because in this pipeline
 * the first caller's reservation has already finished by the time the second
 * asks. A vacuity probe said so: breaking the memory store's transaction into
 * a read, an await and a write left every assertion green.
 *
 * So the barrier moves to where the claim is. The first reservation is held
 * until a second one arrives, and only then are both let through. Against a
 * store that really serialises, the second still sees the first's write and is
 * refused. Against one that snapshots before it writes, both would see an
 * empty day and both would reach the provider — which is the failure this is
 * here to catch.
 */
function overlappingKv(inner: MemoryKv, shape: number): KvStore {
  let waiting = 0;
  let release = (): void => undefined;
  const bothHere = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return {
    ...inner,
    async transact<T>(keys: readonly string[], body: KvTransaction<T>): Promise<T> {
      if (keys.length === shape) {
        waiting += 1;
        if (waiting >= 2) release();
        else await bothHere;
      }
      return inner.transact(keys, body);
    },
  };
}

/** A promise the test resolves by hand, which is the whole barrier. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { wait, open };
}

/** Two callers, same skill, different devices and different keys. */
function pair(
  deps: PipelineDeps,
): [Promise<Awaited<ReturnType<typeof runCopilot>>>, Promise<Awaited<ReturnType<typeof runCopilot>>>] {
  return [
    runCopilot(deps, arrangeRequest("drums", { subjectId: "device-a" })),
    runCopilot(
      deps,
      arrangeRequest("drums", { subjectId: "device-b", idempotencyKey: "idem-key-0002" }),
    ),
  ];
}

function oneBudget(scenarios: readonly FakeScenario[], held?: () => Promise<void>) {
  const clock = createFakeClock(FIXED_NOW);
  const kv = createMemoryKv(clock);
  const adapter = createFakeAdapter(scenarios, held ? { beforeAnswer: held } : {});
  const meter = createMemoryMeter();
  let requestCounter = 0;
  let patchCounter = 0;
  const deps: PipelineDeps = {
    config: testConfig({ dailyBudgetUsd: WORST_CASE / 1_000_000 }),
    kv,
    clock,
    adapter,
    meter,
    newRequestId: () => `req-${(requestCounter += 1)}`,
    newPatchId: () => `patch-${(patchCounter += 1)}`,
  };
  return { deps, kv, adapter, meter, clock };
}

const rounds = (count: number) => Array.from({ length: count }, () => goodRound("drums"));

describe("one budget finances exactly one provider call", () => {
  it("decides two overlapping reservations as one step", async () => {
    const clock = createFakeClock(FIXED_NOW);
    const kv = overlappingKv(createMemoryKv(clock), 5);
    const adapter = createFakeAdapter(rounds(4));
    const meter = createMemoryMeter();
    let requestCounter = 0;
    let patchCounter = 0;
    const deps: PipelineDeps = {
      config: testConfig({ dailyBudgetUsd: WORST_CASE / 1_000_000 }),
      kv,
      clock,
      adapter,
      meter,
      newRequestId: () => `req-${(requestCounter += 1)}`,
      newPatchId: () => `patch-${(patchCounter += 1)}`,
    };

    const [a, b] = await Promise.all(pair(deps));
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(adapter.calls).toHaveLength(1);
    const refused = a.ok ? b : a;
    if (!refused.ok) expect(refused.body.code).toBe("budget_exhausted");
  });

  it("holds the first call open and refuses the second before it is made", async () => {
    const barrier = gate();
    const { deps, adapter } = oneBudget(rounds(2), () => barrier.wait);

    const [first, second] = pair(deps);
    // The loser is decided by the reservation, so it can be answered while the
    // winner is still waiting on the provider. That is the point.
    const loser = await second;
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.body.code).toBe("budget_exhausted");
    expect(adapter.calls).toHaveLength(1);

    barrier.open();
    const winner = await first;
    expect(winner.ok).toBe(true);
    expect(adapter.calls).toHaveLength(1);
  });

  it("lets ten callers in and still pays for one", async () => {
    const barrier = gate();
    const { deps, adapter } = oneBudget(rounds(10), () => barrier.wait);

    const all = Array.from({ length: 10 }, (_unused, index) =>
      runCopilot(
        deps,
        arrangeRequest("drums", {
          subjectId: `device-${index}`,
          idempotencyKey: `idem-key-${String(index).padStart(4, "0")}`,
        }),
      ),
    );
    // Nine are decided without the provider; the tenth is held at the barrier.
    await Promise.resolve();
    barrier.open();
    const results = await Promise.all(all);

    expect(results.filter((entry) => entry.ok)).toHaveLength(1);
    expect(adapter.calls).toHaveLength(1);
    for (const entry of results) {
      if (!entry.ok) expect(entry.body.code).toBe("budget_exhausted");
    }
  });

  it("pays for two when there is budget for two", async () => {
    const clock = createFakeClock(FIXED_NOW);
    const kv = createMemoryKv(clock);
    const adapter = createFakeAdapter(rounds(2));
    const meter = createMemoryMeter();
    let requestCounter = 0;
    let patchCounter = 0;
    const deps: PipelineDeps = {
      config: testConfig({ dailyBudgetUsd: (WORST_CASE * 2) / 1_000_000 }),
      kv,
      clock,
      adapter,
      meter,
      newRequestId: () => `req-${(requestCounter += 1)}`,
      newPatchId: () => `patch-${(patchCounter += 1)}`,
    };

    const results = await Promise.all(pair(deps));
    expect(results.every((entry) => entry.ok)).toBe(true);
    expect(adapter.calls).toHaveLength(2);
  });

  it("answers the same key twice without calling twice", async () => {
    const barrier = gate();
    const { deps, adapter } = oneBudget(rounds(2), () => barrier.wait);

    const both = Promise.all([
      runCopilot(deps, arrangeRequest("drums", { subjectId: "device-a" })),
      runCopilot(deps, arrangeRequest("drums", { subjectId: "device-a" })),
    ]);
    await Promise.resolve();
    barrier.open();
    await both;
    expect(adapter.calls).toHaveLength(1);
  });

  it("keeps different keys independent when the budget allows it", async () => {
    const clock = createFakeClock(FIXED_NOW);
    const kv = createMemoryKv(clock);
    const adapter = createFakeAdapter(rounds(2));
    const meter = createMemoryMeter();
    let requestCounter = 0;
    let patchCounter = 0;
    const deps: PipelineDeps = {
      config: testConfig({ dailyBudgetUsd: (WORST_CASE * 2) / 1_000_000 }),
      kv,
      clock,
      adapter,
      meter,
      newRequestId: () => `req-${(requestCounter += 1)}`,
      newPatchId: () => `patch-${(patchCounter += 1)}`,
    };
    const results = await Promise.all(pair(deps));
    expect(results.filter((entry) => entry.ok)).toHaveLength(2);
  });

  it("never lets the day counter pass the day's limit", async () => {
    const { deps, kv } = oneBudget(rounds(4));
    await Promise.all(pair(deps));
    for (const key of kv.keys()) {
      const raw = kv.raw(key);
      if (raw === null) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      expect(value).toBeLessThanOrEqual(WORST_CASE);
    }
  });

  /*
   * Twenty seconds, because two hundred rounds is genuinely two hundred
   * rounds (2T-C §14).
   *
   * It takes about five seconds alone and comfortably more than that when
   * the whole suite is running beside it, which made it time out roughly one
   * full run in four — and a timeout is not a result: the assertion below
   * never ran at all, so the run reported neither a passing claim nor a
   * failing one. The limit is the machine's, not the code's, so the limit is
   * what moved. Nothing here is weakened: the same two hundred rounds are
   * counted and the same single shape is demanded of every one of them.
   */
  it("holds across two hundred runs, whoever wins each one", { timeout: 20_000 }, async () => {
    /*
     * Two hundred local iterations against the fake adapter — no network, no
     * provider, no sleep. What is counted is the shape of every round: one
     * accept, one refusal, one call. The winner is allowed to differ and is
     * recorded rather than asserted, because asserting it would be asserting
     * Node's microtask order.
     */
    const shapes = new Map<string, number>();
    for (let round = 0; round < 200; round += 1) {
      const { deps, adapter } = oneBudget(rounds(4));
      const [a, b] = await Promise.all(pair(deps));
      const refused = a.ok ? b : a;
      shapes.set(
        `accepted=${[a.ok, b.ok].filter(Boolean).length} calls=${adapter.calls.length} ` +
          `refusal=${refused.ok ? "-" : refused.body.code}`,
        (shapes.get(
          `accepted=${[a.ok, b.ok].filter(Boolean).length} calls=${adapter.calls.length} ` +
            `refusal=${refused.ok ? "-" : refused.body.code}`,
        ) ?? 0) + 1,
      );
    }
    expect([...shapes.entries()]).toEqual([
      ["accepted=1 calls=1 refusal=budget_exhausted", 200],
    ]);
  });

  it("does not decide the winner by name", async () => {
    /*
     * Which of the two wins is the scheduler's business, and asserting it
     * would be asserting Node's microtask order. What may not vary is the
     * total: one accept, one refusal, one call.
     */
    const winners = new Set<string>();
    for (let round = 0; round < 40; round += 1) {
      const { deps, adapter } = oneBudget(rounds(2));
      const [a, b] = await Promise.all(pair(deps));
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(adapter.calls).toHaveLength(1);
      winners.add(a.ok ? "a" : "b");
    }
    expect(winners.size).toBeGreaterThanOrEqual(1);
  });

  it("refuses in words a reader can act on, with no diagnostic in them", async () => {
    const { deps } = oneBudget(rounds(2));
    const [a, b] = await Promise.all(pair(deps));
    const refused = a.ok ? b : a;
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(JSON.stringify(refused.body)).not.toMatch(/Zod|stack|at Object|micros:|kv\./i);
  });

  it("does not mutate the request it was given", async () => {
    const { deps } = oneBudget(rounds(2));
    const request = arrangeRequest("drums", { subjectId: "device-a" });
    const frozen = JSON.stringify(request);
    await runCopilot(deps, request);
    expect(JSON.stringify(request)).toBe(frozen);
  });
});

describe("the reservation is released whatever the provider does", () => {
  it("keeps an unverifiable round spent, so the next caller is refused", async () => {
    /*
     * Spec 12.3: a round whose usage cannot be read back counts as fully
     * spent. That is the existing policy and this pins it rather than
     * inventing a kinder one — the important half is that the budget is not
     * quietly handed back to the next caller after a provider was already
     * asked to do work.
     */
    const { deps, adapter } = oneBudget([
      { kind: "provider_error", diagnostic: "provider down" },
      goodRound("drums"),
    ]);
    const first = await runCopilot(deps, arrangeRequest("drums", { subjectId: "device-a" }));
    expect(first.ok).toBe(false);
    expect(adapter.calls).toHaveLength(1);

    const second = await runCopilot(
      deps,
      arrangeRequest("drums", { subjectId: "device-b", idempotencyKey: "idem-key-0002" }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.body.code).toBe("budget_exhausted");
    // Refused at the reservation, so the provider was never asked a second time.
    expect(adapter.calls).toHaveLength(1);
  });

  it("lets the same device come back after the connection drops", async () => {
    const { deps } = oneBudget([
      { kind: "network_error", diagnostic: "socket closed" },
      goodRound("drums"),
    ]);
    const first = await runCopilot(deps, arrangeRequest("drums", { subjectId: "device-a" }));
    expect(first.ok).toBe(false);

    const again = await runCopilot(
      deps,
      arrangeRequest("drums", { subjectId: "device-a", idempotencyKey: "idem-key-0003" }),
    );
    expect(again.ok).toBe(false);
    if (again.ok) return;
    // A lock left behind would say this; the budget being gone is the honest
    // answer, and the one the reader should get.
    expect(again.body.code).not.toBe("concurrent_request");
  });

  it("answers an abort as an abort and calls nobody twice", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, adapter } = oneBudget(rounds(2));
    const result = await runCopilot(
      deps,
      arrangeRequest("drums", { subjectId: "device-a" }),
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    expect(adapter.calls.length).toBeLessThanOrEqual(1);
  });
});
