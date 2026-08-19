/**
 * Time, as a dependency.
 *
 * Budget windows, TTLs and retry semantics all turn on what time it is, and a
 * test that has to wait for midnight is not a test. Everything that needs the
 * time takes a `Clock`.
 */
export type Clock = {
  /** Milliseconds since the epoch, UTC. */
  now(): number;
};

export const systemClock: Clock = { now: () => Date.now() };

export type FakeClock = Clock & {
  advance(ms: number): void;
  set(ms: number): void;
};

export function createFakeClock(startMs: number): FakeClock {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (ms) => {
      current = ms;
    },
  };
}

/** Budget windows are UTC calendar windows, so they are the same everywhere. */
export function dayWindow(clock: Clock): string {
  return new Date(clock.now()).toISOString().slice(0, 10);
}

export function monthWindow(clock: Clock): string {
  return new Date(clock.now()).toISOString().slice(0, 7);
}

/** Seconds left in the current UTC day, plus a grace margin. */
export function secondsToEndOfDay(clock: Clock, graceSeconds = 0): number {
  const now = new Date(clock.now());
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.ceil((end - clock.now()) / 1000) + graceSeconds;
}

/** Seconds left in the current UTC month, plus a grace margin. */
export function secondsToEndOfMonth(clock: Clock, graceSeconds = 0): number {
  const now = new Date(clock.now());
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.ceil((end - clock.now()) / 1000) + graceSeconds;
}
