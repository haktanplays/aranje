/**
 * Idempotency (spec 12.3).
 *
 * "Aynı key ile gelen retry ikinci kez rezervasyon yapmaz; var olan
 * rezervasyonu ve varsa sonucunu kullanır."
 *
 * The record also closes a hole that is easy to leave open. A call that timed
 * out, or came back without verifiable usage, may already have been billed by
 * the provider. If a retry with the same key simply ran again, the second call
 * would be free to the caller and paid for twice by us. So failures are
 * recorded too, and replaying a recorded failure returns the same failure
 * without touching the provider. Genuinely retrying means a new idempotency
 * key, and a new key means a new reservation — which is the honest price.
 *
 * The TTL here is the client retry window, measured in minutes (spec 12.3).
 * It is deliberately unrelated to the budget window, and it must never be used
 * to expire a reservation: an expired idempotency record leaves the money
 * exactly where it was.
 */
import { TTL, idempotencyKey } from "@/lib/budget/keys";
import type { KvStore, KvWrite } from "@/lib/budget/kv";
import type { CopilotErrorCode } from "@/lib/copilot/errors";

export type IdempotencyRecord =
  | { state: "in_flight"; fingerprint: string; requestId: string }
  | {
      state: "done";
      fingerprint: string;
      requestId: string;
      /** The response body as it was sent, verbatim. */
      response: string;
    }
  | {
      state: "failed";
      fingerprint: string;
      requestId: string;
      code: CopilotErrorCode;
      /** True when a provider call may already have been paid for. */
      billed: boolean;
    };

export type ClaimOutcome =
  | { outcome: "claimed" }
  /** Same key, different payload (spec 12.3). */
  | { outcome: "conflict"; heldFingerprint: string }
  /** Same key and payload, still running: only one may reach the provider. */
  | { outcome: "in_flight"; requestId: string }
  /** Same key and payload, already answered. */
  | { outcome: "replay"; record: IdempotencyRecord };

export type IdempotencyDeps = { kv: KvStore };

function parse(value: string | null): IdempotencyRecord | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as IdempotencyRecord;
  } catch {
    return null;
  }
}

export async function claim(
  deps: IdempotencyDeps,
  params: {
    subjectHash: string;
    keyHash: string;
    fingerprint: string;
    requestId: string;
  },
): Promise<ClaimOutcome> {
  const key = idempotencyKey(params.subjectHash, params.keyHash);

  return deps.kv.transact(
    [key],
    (current): { writes: KvWrite[]; result: ClaimOutcome } => {
      const held = parse(current.get(key) ?? null);

      if (held && held.fingerprint !== params.fingerprint) {
        return {
          writes: [],
          result: { outcome: "conflict", heldFingerprint: held.fingerprint },
        };
      }

      if (held?.state === "in_flight") {
        return {
          writes: [],
          result: { outcome: "in_flight", requestId: held.requestId },
        };
      }

      if (held) {
        return { writes: [], result: { outcome: "replay", record: held } };
      }

      const record: IdempotencyRecord = {
        state: "in_flight",
        fingerprint: params.fingerprint,
        requestId: params.requestId,
      };
      return {
        writes: [
          {
            key,
            value: JSON.stringify(record),
            ttlSeconds: TTL.idempotencySeconds,
          },
        ],
        result: { outcome: "claimed" },
      };
    },
  );
}

async function write(
  deps: IdempotencyDeps,
  subjectHash: string,
  keyHash: string,
  record: IdempotencyRecord,
): Promise<void> {
  const key = idempotencyKey(subjectHash, keyHash);
  await deps.kv.transact([key], () => ({
    writes: [
      { key, value: JSON.stringify(record), ttlSeconds: TTL.idempotencySeconds },
    ],
    result: undefined,
  }));
}

export async function complete(
  deps: IdempotencyDeps,
  params: {
    subjectHash: string;
    keyHash: string;
    fingerprint: string;
    requestId: string;
    response: string;
  },
): Promise<void> {
  await write(deps, params.subjectHash, params.keyHash, {
    state: "done",
    fingerprint: params.fingerprint,
    requestId: params.requestId,
    response: params.response,
  });
}

export async function fail(
  deps: IdempotencyDeps,
  params: {
    subjectHash: string;
    keyHash: string;
    fingerprint: string;
    requestId: string;
    code: CopilotErrorCode;
    billed: boolean;
  },
): Promise<void> {
  await write(deps, params.subjectHash, params.keyHash, {
    state: "failed",
    fingerprint: params.fingerprint,
    requestId: params.requestId,
    code: params.code,
    billed: params.billed,
  });
}

/**
 * Drop the claim. Used only when the request never reached the provider — a
 * refused reservation, an exhausted quota — so the same key may be tried again
 * later. It is never used after a provider call: that is what `fail` is for.
 */
export async function release(
  deps: IdempotencyDeps,
  params: { subjectHash: string; keyHash: string; requestId: string },
): Promise<void> {
  const key = idempotencyKey(params.subjectHash, params.keyHash);
  await deps.kv.transact([key], (current) => {
    const held = parse(current.get(key) ?? null);
    if (held?.state !== "in_flight" || held.requestId !== params.requestId) {
      return { writes: [], result: undefined };
    }
    return { writes: [{ key, delete: true as const }], result: undefined };
  });
}
