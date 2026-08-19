/**
 * Atomic budget reservation (spec 12.3, K-12, K-16).
 *
 * The order "check, then call, then record the cost" overspends the moment two
 * requests arrive together: both pass the check, both reach the provider. So
 * the money is taken *first*, at its worst-case size, in one atomic step that
 * also takes the per-subject quota and the one-request-at-a-time lock. What
 * comes back afterwards can only ever give money back.
 *
 * The three settlement rules, from spec 12.3, are the whole state machine:
 *
 * - **Verified usage** -> the reservation is reduced to what was really used
 *   and the difference returns to the window. Down only. A real cost above the
 *   reservation never raises the counter, because the reservation was already
 *   the worst case; it is recorded instead, since it would mean the ceilings
 *   are wrong.
 * - **Usage that cannot be verified** -> the reservation counts as fully
 *   spent. Timeout, network failure, a dropped connection, an unknown outcome:
 *   the provider may well have billed the call, and treating an unverifiable
 *   call as free is exactly how a budget is quietly exceeded.
 * - **An uncertain reservation is not released early.** The only way out is
 *   verified, downward reconciliation. When the window closes the counter is a
 *   new key anyway, so nothing has to be given back and nothing may be.
 *
 * That last rule is why there is no expiry sweep in this file. A TTL exists on
 * the lock, so a crashed request does not lock a musician out for the day, but
 * no TTL anywhere releases a reservation.
 */
import type { Clock } from "@/lib/budget/clock";
import {
  dayWindow,
  monthWindow,
  secondsToEndOfDay,
  secondsToEndOfMonth,
} from "@/lib/budget/clock";
import { usdToMicros } from "@/lib/budget/cost";
import {
  TTL,
  dayBudgetKey,
  lockKey,
  monthBudgetKey,
  quotaKey,
  reservationKey,
} from "@/lib/budget/keys";
import type { KvStore, KvWrite } from "@/lib/budget/kv";

export type ReservationState = "reserved" | "reconciled" | "spent";

export type ReservationRecord = {
  requestId: string;
  subjectHash: string;
  /** Worst-case amount taken up front. */
  amountMicros: number;
  /** The exact counters this reservation was taken from. */
  dayKey: string;
  monthKey: string;
  state: ReservationState;
  /** What it finally cost. Equal to `amountMicros` when unverified. */
  settledMicros?: number;
  /** Why the usage could not be verified, when it could not. */
  unverifiedReason?: string;
  /** Set when verified usage came back above the worst case: a ceiling bug. */
  exceededReservation?: boolean;
};

export type BudgetLimits = {
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  freePatchesPerUserPerDay: number;
};

export type BudgetDeps = {
  kv: KvStore;
  clock: Clock;
  limits: BudgetLimits;
};

export type ReserveParams = {
  subjectHash: string;
  requestId: string;
  amountMicros: number;
};

export type ReserveOutcome =
  | { ok: true; reservation: ReservationRecord }
  | {
      ok: false;
      code: "concurrent_request" | "quota_exhausted" | "budget_exhausted";
      /** Server-side detail; never sent to a client. */
      diagnostic: string;
    };

function counterOf(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRecord(value: string | null): ReservationRecord | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as ReservationRecord;
  } catch {
    return null;
  }
}

/**
 * Take the worst-case amount, the quota slot and the lock in one step.
 *
 * Refusal order is lock, then quota, then budget: the most specific and most
 * quickly fixable reason first, so a musician who is simply mid-request is not
 * told the global budget is gone.
 */
export async function reserve(
  deps: BudgetDeps,
  params: ReserveParams,
): Promise<ReserveOutcome> {
  const { kv, clock, limits } = deps;
  const day = dayWindow(clock);
  const month = monthWindow(clock);

  const dayKey = dayBudgetKey(day);
  const monthKey = monthBudgetKey(month);
  const subjectQuotaKey = quotaKey(params.subjectHash, day);
  const subjectLockKey = lockKey(params.subjectHash);
  const recordKey = reservationKey(params.requestId);

  const dailyLimit = usdToMicros(limits.dailyBudgetUsd);
  const monthlyLimit = usdToMicros(limits.monthlyBudgetUsd);

  return kv.transact(
    [dayKey, monthKey, subjectQuotaKey, subjectLockKey, recordKey],
    (current): { writes: KvWrite[]; result: ReserveOutcome } => {
      const held = current.get(subjectLockKey) ?? null;
      if (held !== null && held !== params.requestId) {
        return {
          writes: [],
          result: {
            ok: false,
            code: "concurrent_request",
            diagnostic: `subject already holds request ${held}`,
          },
        };
      }

      const used = counterOf(current.get(subjectQuotaKey) ?? null);
      if (used >= limits.freePatchesPerUserPerDay) {
        return {
          writes: [],
          result: {
            ok: false,
            code: "quota_exhausted",
            diagnostic: `${used}/${limits.freePatchesPerUserPerDay} used on ${day}`,
          },
        };
      }

      const daySpent = counterOf(current.get(dayKey) ?? null);
      const monthSpent = counterOf(current.get(monthKey) ?? null);
      const nextDay = daySpent + params.amountMicros;
      const nextMonth = monthSpent + params.amountMicros;

      if (nextDay > dailyLimit || nextMonth > monthlyLimit) {
        return {
          writes: [],
          result: {
            ok: false,
            code: "budget_exhausted",
            diagnostic:
              `day ${daySpent}+${params.amountMicros}/${dailyLimit}, ` +
              `month ${monthSpent}+${params.amountMicros}/${monthlyLimit}`,
          },
        };
      }

      const reservation: ReservationRecord = {
        requestId: params.requestId,
        subjectHash: params.subjectHash,
        amountMicros: params.amountMicros,
        dayKey,
        monthKey,
        state: "reserved",
      };

      return {
        writes: [
          {
            key: dayKey,
            value: String(nextDay),
            ttlSeconds: secondsToEndOfDay(clock, TTL.budgetGraceSeconds),
          },
          {
            key: monthKey,
            value: String(nextMonth),
            ttlSeconds: secondsToEndOfMonth(clock, TTL.budgetGraceSeconds),
          },
          {
            key: subjectQuotaKey,
            value: String(used + 1),
            ttlSeconds: secondsToEndOfDay(clock, TTL.budgetGraceSeconds),
          },
          {
            key: subjectLockKey,
            value: params.requestId,
            ttlSeconds: TTL.lockSeconds,
          },
          {
            key: recordKey,
            value: JSON.stringify(reservation),
            // Reservation records live on the budget clock, not the retry
            // clock, so a late reconciliation can still find one.
            ttlSeconds: secondsToEndOfMonth(clock, TTL.budgetGraceSeconds),
          },
        ],
        result: { ok: true, reservation },
      };
    },
  );
}

export type SettleOutcome =
  | { ok: true; record: ReservationRecord; refundedMicros: number }
  | { ok: false; reason: "unknown_reservation" | "already_settled" };

type Settlement =
  | { kind: "verified"; actualMicros: number }
  | { kind: "unverified"; reason: string };

async function settle(
  deps: BudgetDeps,
  requestId: string,
  settlement: Settlement,
): Promise<SettleOutcome> {
  const { kv } = deps;
  const recordKey = reservationKey(requestId);

  return kv.transact(
    [recordKey],
    (current): { writes: KvWrite[]; result: SettleOutcome } => {
      const record = parseRecord(current.get(recordKey) ?? null);
      if (!record) {
        return { writes: [], result: { ok: false, reason: "unknown_reservation" } };
      }
      // Settling twice must not refund twice.
      if (record.state !== "reserved") {
        return { writes: [], result: { ok: false, reason: "already_settled" } };
      }

      if (settlement.kind === "unverified") {
        const spent: ReservationRecord = {
          ...record,
          state: "spent",
          settledMicros: record.amountMicros,
          unverifiedReason: settlement.reason,
        };
        return {
          writes: [{ key: recordKey, value: JSON.stringify(spent) }],
          result: { ok: true, record: spent, refundedMicros: 0 },
        };
      }

      // Down only. A verified cost above the worst case cannot raise the
      // counter; it is flagged, because it would mean the ceilings are wrong.
      const exceeded = settlement.actualMicros > record.amountMicros;
      const refund = Math.max(0, record.amountMicros - settlement.actualMicros);

      const reconciled: ReservationRecord = {
        ...record,
        state: "reconciled",
        settledMicros: exceeded ? record.amountMicros : settlement.actualMicros,
        ...(exceeded ? { exceededReservation: true } : {}),
      };

      const writes: KvWrite[] = [
        { key: recordKey, value: JSON.stringify(reconciled) },
      ];

      return {
        writes,
        result: { ok: true, record: reconciled, refundedMicros: refund },
      };
    },
  );
}

/**
 * Verified usage came back: reduce the reservation to the real cost and return
 * the difference to the same counters it was taken from.
 *
 * The refund is applied to the exact day and month keys recorded at
 * reservation time. If the window has since rolled over, those keys are no
 * longer the live counters, so the refund lands where the spend was and cannot
 * credit a new window with money it never spent.
 */
export async function reconcileVerified(
  deps: BudgetDeps,
  requestId: string,
  actualMicros: number,
): Promise<SettleOutcome> {
  const outcome = await settle(deps, requestId, {
    kind: "verified",
    actualMicros,
  });
  if (!outcome.ok || outcome.refundedMicros === 0) return outcome;

  const { dayKey, monthKey } = outcome.record;
  await deps.kv.transact([dayKey, monthKey], (current) => ({
    writes: [
      {
        key: dayKey,
        value: String(
          Math.max(0, counterOf(current.get(dayKey) ?? null) - outcome.refundedMicros),
        ),
        ttlSeconds: secondsToEndOfDay(deps.clock, TTL.budgetGraceSeconds),
      },
      {
        key: monthKey,
        value: String(
          Math.max(
            0,
            counterOf(current.get(monthKey) ?? null) - outcome.refundedMicros,
          ),
        ),
        ttlSeconds: secondsToEndOfMonth(deps.clock, TTL.budgetGraceSeconds),
      },
    ],
    result: undefined,
  }));

  return outcome;
}

/**
 * The outcome could not be verified: the reservation stands, in full, until
 * its window closes (spec 12.3).
 */
export async function markSpent(
  deps: BudgetDeps,
  requestId: string,
  reason: string,
): Promise<SettleOutcome> {
  return settle(deps, requestId, { kind: "unverified", reason });
}

/**
 * Release the one-at-a-time lock. This frees the *subject*, not the money:
 * whatever was reserved stays reserved until it is reconciled or its window
 * closes. Only the holder may release, so a lock that already expired and was
 * retaken by a newer request is left alone.
 */
export async function releaseLock(
  deps: BudgetDeps,
  subjectHash: string,
  requestId: string,
): Promise<void> {
  const key = lockKey(subjectHash);
  await deps.kv.transact([key], (current) => {
    if ((current.get(key) ?? null) !== requestId) {
      return { writes: [], result: undefined };
    }
    return { writes: [{ key, delete: true as const }], result: undefined };
  });
}

/** Current spend for a window, for metering and for tests. */
export async function readSpend(
  deps: BudgetDeps,
): Promise<{ dayMicros: number; monthMicros: number }> {
  const day = await deps.kv.get(dayBudgetKey(dayWindow(deps.clock)));
  const month = await deps.kv.get(monthBudgetKey(monthWindow(deps.clock)));
  return { dayMicros: counterOf(day), monthMicros: counterOf(month) };
}
