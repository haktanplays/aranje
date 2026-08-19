/**
 * The KV key schema (spec 12.2).
 *
 * Two rules shape every name here.
 *
 * 1. **No user data in a key.** Spec 12.2 keeps songs and identities out of
 *    the counter store, so the caller's id and its idempotency key are hashed
 *    before they are ever concatenated into a key. What is stored is a
 *    pseudonym, not a device id.
 * 2. **A key belongs to exactly one window.** Budget counters carry the UTC
 *    day or month they count, so a window closing is a new key rather than a
 *    cleanup job. Spec 12.3: "Pencere kapandığında sayaç zaten sıfırlandığı
 *    için ayrıca bir geri verme işlemi gerekmez."
 *
 * The version segment lets the schema change without reading a stale counter
 * as if it were a current one.
 */
const PREFIX = "aranje:v1";

/**
 * SHA-256, truncated. Not a secret and not reversible-proof for a small input
 * space; its job is to keep raw identifiers out of the store and to give a
 * stable, collision-resistant key.
 */
export async function stableHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Spend counter for one UTC day. */
export const dayBudgetKey = (day: string) => `${PREFIX}:budget:day:${day}`;

/** Spend counter for one UTC month. */
export const monthBudgetKey = (month: string) => `${PREFIX}:budget:month:${month}`;

/** Free patches used by one subject on one UTC day (spec 12.1). */
export const quotaKey = (subjectHash: string, day: string) =>
  `${PREFIX}:quota:${subjectHash}:${day}`;

/** One AI patch request per subject at a time (spec 12.4). */
export const lockKey = (subjectHash: string) => `${PREFIX}:lock:${subjectHash}`;

/** Idempotency record: retry window, not budget window. */
export const idempotencyKey = (subjectHash: string, keyHash: string) =>
  `${PREFIX}:idem:${subjectHash}:${keyHash}`;

/** Reservation record, kept as long as its budget window can be adjusted. */
export const reservationKey = (requestId: string) =>
  `${PREFIX}:reservation:${requestId}`;

/**
 * TTLs, with the reason each one is what it is (spec 12.3 keeps these two
 * clocks apart on purpose).
 */
export const TTL = {
  /** Long enough to outlive its window; the window itself does the resetting. */
  budgetGraceSeconds: 2 * 24 * 60 * 60,
  /**
   * A crashed request must not lock a musician out for the rest of the day.
   * This releases the *lock*, never the reservation: spec 12.3 says an
   * unverified reservation stays spent until its budget window closes.
   */
  lockSeconds: 120,
  /**
   * The client retry window (spec 12.3: "dakikalar"). It has nothing to do
   * with the budget window and must never be used to expire a reservation.
   */
  idempotencySeconds: 10 * 60,
} as const;
