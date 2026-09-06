# `budget-race` — the flake, its cause, and its fix (2V-D.2 c3 §2–§4)

## Symptom

One full-suite run failed with `Test timed out in 5000ms` in
`src/lib/copilot/budget-race.test.ts > holds the first call open and refuses
the second before it is made`. That run took 97s against a usual 40s, which
made "slow machine" the obvious reading. It was the wrong one.

## Reproduction, before any change

| Attempt | Runs | Result |
| --- | --- | --- |
| File alone | 20 | 20 green |
| Concurrent-digest ordering probe, idle | 300 | **10 inversions (3.3%)** |
| Concurrent-digest ordering probe, under load | 300 | **23 inversions (7.7%)** |
| Controlled reproducer (callers started in inverted order) | 1 | **failed, `timed out in 5000ms`** |

The file alone never failed, which is why "run it again" never found it. The
ordering probe (`crypto.subtle.digest` × 3 per caller, started A-then-B) is
where the non-determinism actually lives, and the controlled reproducer turns
that into the exact observed failure on demand.

## Root cause, in one sentence

`withStore` awaits three `crypto.subtle.digest` calls — subject, idempotency
key, request fingerprint — before it reserves the budget, and those resolve on
libuv's threadpool in an order that is **not** the order they were started, so
on roughly 3–8% of runs the caller started *second* won the reservation,
reached the adapter barrier the test was deliberately holding, and the test's
`await second` waited on a promise nothing would ever settle.

## Why it was not a timeout problem

The test never needed time to pass. It needed one of two callers to be
refused, which happens synchronously with respect to the budget. Raising the
limit would have made the failure rarer and left a test that hangs whenever
the scheduler inverts — a slower way to be wrong.

## The fix

The claim was never about *which* caller wins: it is that one is refused,
before any provider call, while the other is still in flight. `Promise.race`
states exactly that — the winner is held at the barrier by construction and
cannot settle, so the race can only yield the loser, whichever caller it was.

Two assertions were **added**, not removed:

- the winner really is still pending at the moment the loser is refused,
  checked with a macrotask sentinel (an ordering guarantee from the language,
  not a wait);
- the caller that was pending is the one that ends up succeeding.

Nothing was skipped, retried, serialised, slept on, or given a longer timeout.
The global timeout is unchanged at its default.

## After the fix

| Gate | Result |
| --- | --- |
| Controlled reproducer (previously deterministic failure) | green |
| File alone, 30 consecutive runs | **30/30 green** |
| Test duration p50 | 2150 ms |
| Test duration p95 | 2300 ms |
| Test duration max | 2350 ms |
| Limit | 5000 ms, unchanged |

Reproduce the ordering probe with:

```
node eval/rhythm-grid/digest-order.mjs        # idle
node eval/rhythm-grid/digest-order.mjs 64     # under load
```
