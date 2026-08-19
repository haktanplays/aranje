import { describe, expect, it } from "vitest";

import { createFakeClock, dayWindow, monthWindow } from "@/lib/budget/clock";
import { usdToMicros } from "@/lib/budget/cost";
import { dayBudgetKey, monthBudgetKey, quotaKey, TTL } from "@/lib/budget/keys";
import { KvUnavailableError } from "@/lib/budget/kv";
import { createMemoryKv } from "@/lib/budget/memory-kv";
import {
  markSpent,
  readSpend,
  reconcileVerified,
  releaseLock,
  reserve,
  type BudgetDeps,
} from "@/lib/budget/reservation";
import { FIXED_NOW } from "@/test/copilot-fixtures";

const LIMITS = {
  dailyBudgetUsd: 2,
  monthlyBudgetUsd: 20,
  freePatchesPerUserPerDay: 3,
};

function setup(limits = LIMITS) {
  const clock = createFakeClock(FIXED_NOW);
  const kv = createMemoryKv(clock);
  const deps: BudgetDeps = { kv, clock, limits };
  return { clock, kv, deps };
}

const SUBJECT = "subject-hash-1";

describe("atomic reservation (spec 12.3)", () => {
  it("takes the money, the quota slot and the lock in one step", async () => {
    const { kv, clock, deps } = setup();
    const result = await reserve(deps, {
      subjectHash: SUBJECT,
      requestId: "req-1",
      amountMicros: 840_000,
    });

    expect(result.ok).toBe(true);
    expect(await readSpend(deps)).toEqual({
      dayMicros: 840_000,
      monthMicros: 840_000,
    });
    expect(kv.raw(quotaKey(SUBJECT, dayWindow(clock)))).toBe("1");
    expect(kv.keys()).toContain(`aranje:v1:lock:${SUBJECT}`);
  });

  it("refuses the second of two concurrent requests when only one fits", async () => {
    // A daily budget that covers exactly one worst-case reservation.
    const { deps } = setup({ ...LIMITS, dailyBudgetUsd: 0.84 });

    const [first, second] = await Promise.all([
      reserve(deps, { subjectHash: "a", requestId: "req-1", amountMicros: 840_000 }),
      reserve(deps, { subjectHash: "b", requestId: "req-2", amountMicros: 840_000 }),
    ]);

    const outcomes = [first.ok, second.ok].sort();
    expect(outcomes).toEqual([false, true]);
    const refused = first.ok ? second : first;
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe("budget_exhausted");

    // The winner's money is there once, not twice.
    expect((await readSpend(deps)).dayMicros).toBe(840_000);
  });

  it("never lets concurrent requests overspend, however many arrive", async () => {
    const { deps } = setup({ ...LIMITS, dailyBudgetUsd: 1 });
    const attempts = Array.from({ length: 10 }, (_, index) =>
      reserve(deps, {
        subjectHash: `subject-${index}`,
        requestId: `req-${index}`,
        amountMicros: 300_000,
      }),
    );
    const results = await Promise.all(attempts);
    const granted = results.filter((result) => result.ok).length;

    expect(granted).toBe(3); // 3 x 300_000 fits in 1_000_000; a fourth does not
    expect((await readSpend(deps)).dayMicros).toBeLessThanOrEqual(
      usdToMicros(1),
    );
  });

  it("holds one request per subject at a time (spec 12.4)", async () => {
    const { deps } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 1000 });
    const second = await reserve(deps, {
      subjectHash: SUBJECT,
      requestId: "req-2",
      amountMicros: 1000,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("concurrent_request");
  });

  it("stops a subject at the free patch limit (spec 12.1)", async () => {
    const { deps } = setup();
    for (let index = 0; index < LIMITS.freePatchesPerUserPerDay; index += 1) {
      const granted = await reserve(deps, {
        subjectHash: SUBJECT,
        requestId: `req-${index}`,
        amountMicros: 1000,
      });
      expect(granted.ok).toBe(true);
      await releaseLock(deps, SUBJECT, `req-${index}`);
    }

    const overQuota = await reserve(deps, {
      subjectHash: SUBJECT,
      requestId: "req-x",
      amountMicros: 1000,
    });
    expect(overQuota.ok).toBe(false);
    if (overQuota.ok) return;
    expect(overQuota.code).toBe("quota_exhausted");
  });

  it("checks the monthly window as well as the daily one", async () => {
    const { deps } = setup({ ...LIMITS, monthlyBudgetUsd: 0.5 });
    const result = await reserve(deps, {
      subjectHash: SUBJECT,
      requestId: "req-1",
      amountMicros: 840_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("budget_exhausted");
  });

  it("refuses when the store cannot be reached, rather than assuming no limit", async () => {
    const { kv, deps } = setup();
    kv.setAvailable(false);
    await expect(
      reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 1000 }),
    ).rejects.toBeInstanceOf(KvUnavailableError);
  });
});

describe("settlement (spec 12.3, K-16)", () => {
  it("reconciles down to verified usage and returns the difference", async () => {
    const { deps } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });

    const settled = await reconcileVerified(deps, "req-1", 12_000);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.refundedMicros).toBe(828_000);
    expect(settled.record.state).toBe("reconciled");
    expect(settled.record.settledMicros).toBe(12_000);
    expect((await readSpend(deps)).dayMicros).toBe(12_000);
  });

  it("never reconciles upward", async () => {
    const { deps } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 100_000 });

    // A real cost above the worst case would mean the ceilings are wrong. The
    // counter does not move up; the fact is recorded instead.
    const settled = await reconcileVerified(deps, "req-1", 500_000);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.refundedMicros).toBe(0);
    expect(settled.record.exceededReservation).toBe(true);
    expect((await readSpend(deps)).dayMicros).toBe(100_000);
  });

  it("spends the whole reservation when usage cannot be verified", async () => {
    const { deps } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });

    const settled = await markSpent(deps, "req-1", "provider_timeout");
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.refundedMicros).toBe(0);
    expect(settled.record.state).toBe("spent");
    expect(settled.record.settledMicros).toBe(840_000);
    expect((await readSpend(deps)).dayMicros).toBe(840_000);
  });

  it("settles once, however often it is asked", async () => {
    const { deps } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });
    await reconcileVerified(deps, "req-1", 10_000);

    const again = await reconcileVerified(deps, "req-1", 10_000);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("already_settled");
    expect((await readSpend(deps)).dayMicros).toBe(10_000);
  });

  it("releases the lock without releasing the money", async () => {
    const { deps, kv } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });
    await markSpent(deps, "req-1", "provider_timeout");
    await releaseLock(deps, SUBJECT, "req-1");

    expect(kv.raw(`aranje:v1:lock:${SUBJECT}`)).toBeNull();
    expect((await readSpend(deps)).dayMicros).toBe(840_000);
  });

  it("lets only the holder release the lock", async () => {
    const { deps, kv } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 1000 });
    await releaseLock(deps, SUBJECT, "someone-else");
    expect(kv.raw(`aranje:v1:lock:${SUBJECT}`)).toBe("req-1");
  });

  it("frees a crashed request's lock by TTL, and only the lock", async () => {
    const { deps, clock, kv } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });

    clock.advance((TTL.lockSeconds + 1) * 1000);
    expect(kv.raw(`aranje:v1:lock:${SUBJECT}`)).toBeNull();
    // The reservation is untouched: spec 12.3 has no TTL that releases money.
    expect((await readSpend(deps)).dayMicros).toBe(840_000);
  });
});

describe("budget windows (spec 12.3)", () => {
  it("starts a new counter when the day rolls over", async () => {
    const { deps, clock } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });
    expect((await readSpend(deps)).dayMicros).toBe(840_000);

    clock.advance(24 * 60 * 60 * 1000);
    // A different key: nothing had to be refunded for the counter to reset.
    expect((await readSpend(deps)).dayMicros).toBe(0);
  });

  it("keeps the old day's key out of the new day", async () => {
    const { deps, clock, kv } = setup();
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });
    const oldKey = dayBudgetKey(dayWindow(clock));

    clock.advance(24 * 60 * 60 * 1000);
    const newKey = dayBudgetKey(dayWindow(clock));
    expect(newKey).not.toBe(oldKey);

    await reserve(deps, { subjectHash: "other", requestId: "req-2", amountMicros: 5_000 });
    expect(kv.raw(newKey)).toBe("5000");
    expect(kv.raw(oldKey)).toBe("840000");
  });

  it("refunds into the window the spend came from, not the current one", async () => {
    const { deps, clock, kv } = setup();
    const oldDay = dayBudgetKey(dayWindow(clock));
    const oldMonth = monthBudgetKey(monthWindow(clock));
    await reserve(deps, { subjectHash: SUBJECT, requestId: "req-1", amountMicros: 840_000 });

    // The answer arrives after midnight.
    clock.advance(24 * 60 * 60 * 1000);
    const newDay = dayBudgetKey(dayWindow(clock));
    await reconcileVerified(deps, "req-1", 40_000);

    expect(kv.raw(oldDay)).toBe("40000");
    expect(kv.raw(oldMonth)).toBe("40000");
    // The new day never saw this request at all, and is not credited with it.
    expect(kv.raw(newDay)).toBeNull();
    expect((await readSpend(deps)).dayMicros).toBe(0);
  });

  it("frees the quota when the day rolls over", async () => {
    const { deps, clock } = setup();
    for (let index = 0; index < LIMITS.freePatchesPerUserPerDay; index += 1) {
      await reserve(deps, {
        subjectHash: SUBJECT,
        requestId: `req-${index}`,
        amountMicros: 1000,
      });
      await releaseLock(deps, SUBJECT, `req-${index}`);
    }
    const blocked = await reserve(deps, {
      subjectHash: SUBJECT,
      requestId: "req-x",
      amountMicros: 1000,
    });
    expect(blocked.ok).toBe(false);

    clock.advance(24 * 60 * 60 * 1000);
    const fresh = await reserve(deps, {
      subjectHash: SUBJECT,
      requestId: "req-y",
      amountMicros: 1000,
    });
    expect(fresh.ok).toBe(true);
  });
});
