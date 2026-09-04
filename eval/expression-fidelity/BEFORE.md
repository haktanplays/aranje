# What the four unhappy cards did before 2V-C.2

Measured with `trace.ts` against `buildExpressionPlan` — the same plan the app
schedules from — on the gesture note of each listening take (E3, 1.149089 s, at
the fixture's 15.000 s). No adjectives here: the fixes in this batch each
answer one of these numbers.

## L11 → L17 · bend that comes back

| | shipped |
|---|---|
| leaves the written pitch | 0.077 s |
| reaches +200 c | 0.288 s (rise 0.211 s) |
| plateau at the target | 0.723 s |
| release starts | 1.011 s |
| back at the written pitch | **1.149089 s — the note's last sample** |
| release duration | **0.138 s for 200 c, 1.5× faster than the rise** |
| gain points | 0 |

Two defects, both mechanical. The descent is quicker than the ascent, which no
hand does. And it lands on the written pitch at the instant the note stops, so
there is no moment at which the note is heard *back*. The founder's sentence —
"geri indir tam tatmin etmedi" — describes a movement with no arrival, and
that is exactly what these two rows are.

The hold side was not shown to be wrong and is not being changed.

## L12 → L18 · pre-bend

| | shipped |
|---|---|
| first automation point | `{ t: 0, cents: 200, curve: "step" }` |
| pitch at t = 0 | **+200 c** |
| departs from that pitch | never |
| points | 2 |

The plan is correct: the first audible frame is already at the target and
there is no rise to leak. The engine agrees — `expressive-voice` writes the
t = 0 step with `setValueAtTime` at exactly the `start()` time, so the
constructor's flat rate never sounds.

So L12 was not unmeasured because the audio was wrong. It was unmeasured
because the **card** was: it asked the founder to tell "pre-bend hold" from
"pre-bend release", two takes that are identical for the first 88% of the note
and differ only in a tail. L18 compares a normal bend against a pre-bend
instead, which is a difference in the first frame. That is a card fix, not a
playback fix, and it is recorded as one.

## L13 → L19 · shift slide

| | shipped |
|---|---|
| source note (D3 @ 15.000 s) | ordinary, flat, **not chained**, ends 0.576 s in |
| target note (E3 @ 15.625 s) | struck at **−200 c**, i.e. at the *source* pitch |
| target reaches its written pitch | 0.192 s **after** its own onset |
| chains built | 2 (against the legato take's 3) |

This is the defect §9 predicted, and the C.1 report's sentence describing it
as "an ordinary onset that carries the travel on its own automation" described
the code correctly while describing the music wrongly. Striking the target
buffer at the source pitch and gliding up is not re-striking the target: it is
re-striking the *source*, at the target's time, and arriving late. Nothing
travels during the source note at all.

## L14 → L20 · slide in and out

| | slide-in (2 st below) | slide-out (3 st down) |
|---|---|---|
| starts at | −200 c, t = 0, step | 0 c |
| travel | 0 → 0.192 s (16.7% of the note) | 1.031 → 1.149 s (last 10.3%) |
| at the written pitch for | 83.3% of the note | — |
| gain points | 0 | **0** |

The entry is broadly right: one onset, no jump, and the note spends its
audible majority at the written pitch. The exit is not. It travels 300 cents
in 0.118 s — 2540 cents per second — at full gain, and then the note simply
stops. Pitch and level are both discontinuous at the end, which is why it
reads as an effect rather than as a hand leaving the string.
