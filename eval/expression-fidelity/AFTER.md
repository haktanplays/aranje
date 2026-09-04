# The same four cards, measured again

Same method, same fixture, same note (E3, 1.149089 s). Read against
`BEFORE.md`; every row that moved is a row a test now pins.

## L17 · bend that comes back

| | before | after |
|---|---|---|
| leaves the written pitch | 0.077 s | 0.077 s |
| reaches +200 c | 0.288 s | 0.288 s |
| plateau at the target | 0.723 s | 0.433 s |
| release starts | 1.011 s | 0.720 s |
| release duration | 0.138 s | 0.291 s |
| release ÷ rise | **0.65×** | **1.38×** |
| back at the written pitch | **1.149089 s (last sample)** | **1.011 s** |
| heard settled at the written pitch for | **0 s** | **0.138 s** |
| points past the note | 0 | 0 |
| gain points | 0 | 0 |

The arrival is deliberately unchanged — nothing said the way up was wrong.
What changed is that letting go is now slower than pushing, and that the note
is the note again for a stretch the ear can sit in before it stops. On short
notes every stage is squeezed by one shared factor, so the hold reaches zero
but never goes negative and no point is written past the note; four lengths
down to 40 ms are checked, plus 50/75/100/150% practice rates.

## L18 · pre-bend

Unchanged, and confirmed: first automation point `{ t: 0, +200 c, step }`, the
pitch is +200 at all 64 sampled moments, one onset in the song. The card is
what changed — L18 compares a normal bend against a pre-bend, so the
difference is in the first frame rather than in a tail.

## L19 · shift slide

| | before | after |
|---|---|---|
| source note | flat, ends 0.576 s in | travels, ends 0.625 s in |
| source leaves its pitch at | never | 0.520 s |
| source arrives at +200 c | — | **0.625 s** |
| target onset | 0.625 s after the source | 0.625 s after the source |
| target struck at | **−200 c (the source's pitch)** | **0 c (its own pitch)** |
| target reaches its written pitch | 0.192 s late | at its onset |

`glideStart < targetOnset` (0.520 < 0.625), `glideArrival == targetOnset`
exactly, the target's attack is an ordinary engine onset at the written pitch,
and the legato slide still has no target attack at all. Two voices, both notes
the reader wrote; no auxiliary click, no second scheduler, no added onset. A
source that already belongs to a legato chain is skipped rather than given two
owners.

## L20 · slide in and out

| | before | after |
|---|---|---|
| slide-in start / arrival / dwell | −200 c, 0.192 s, 83.3% | unchanged |
| slide-in gain points | 0 | 0 |
| slide-out travel begins | 1.031 s (89.7%) | unchanged |
| slide-out gain points | **0** | **3** |
| level during the exit | full to the last sample | held to 1.014 s, then to 12% |

The entry was already right and was left alone. The exit fades as it goes,
which is the asymmetry §11 asked to be justified rather than mirrored: an
entry lands *into* a note that carries on, an exit is the sound leaving.
