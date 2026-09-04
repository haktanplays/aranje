# L19's "biraz kusurlu" handoff, measured

`handoff.ts` reads the production plan and measures the moment the two voices
of a struck slide meet. Source note D3 at 15.000 s, target E3 at 15.625 s,
2 semitones up, on the fixture's own guitar.

## What §3 asked about, and what the numbers say

| hypothesis | measurement | verdict |
|---|---|---|
| the source outstays the target | `overlapSeconds` **0** | ruled out |
| two full voices double up into chorus/comb | `overlapSeconds` **0** | ruled out |
| the target starts at the source's pitch | `targetFirstCents` **0** | ruled out |
| the glide is cut before it arrives | `arrivalErrorCents` **0** | ruled out |
| a microscopic silence at the seam | `gapSeconds` **0** | ruled out |
| a second attack, or a missing one | `attacks` **2** (one each) | correct |
| **an amplitude step at the seam** | `sourceGainAtHandover` **0.7559**, `targetGainAtOnset` **0.7559**, ratio **1.00** | **this is it** |

## The defect, stated plainly

The timeline is right. C.2 fixed that, and this card confirmed it: both sides
arrive together and the target is struck at its own pitch.

What is wrong is the seam. The source has been travelling for ~105 ms and is
still at **full level** at the instant it stops — and it stops instantly,
because nothing shapes its tail. At that same sample a second full-level
attack begins. So the waveform has a step discontinuity in it: one voice
truncated at full amplitude, another starting at full amplitude, at the same
moment. That is a click, and "vurarak biraz kusurlu duruyor" is what a click
at the seam sounds like when it is small enough not to be obviously a click.

Physically it is also wrong. A sliding finger arriving at a fret and the pick
striking it does not leave the old vibration at full strength; the string is
damped by the arriving contact and by the pick itself. The old sound decays
*into* the strike.

## What was changed, and what was not

The target is not touched. Its attack is the thing the card is about, and
faking or softening it would answer the complaint by removing the subject.
The chains are not touched either — a legato slide must not gain a target
attack from a fix aimed at the struck one.

Only the source's tail is shaped: it fades across its travel and arrives at a
fraction of its level, so the seam is a handover rather than a cut. The
arrival stays clearly audible — the ear has to hear the hand reach the target,
which is the whole gesture — and the target's own attack lands at full
strength immediately after.

## After

| | before | after |
|---|---|---|
| source gain at the handover | 0.7559 | 0.3402 |
| source ÷ target at the seam | **1.00** | **0.45** |
| gain points on the source | 0 | 3 |
| overlap | 0 s | 0 s |
| arrival error | 0 c | 0 c |
| target's first pitch | 0 c | 0 c |
| attacks across the pair | 2 | 2 |
| legato slide's target attacks | 0 | 0 |

Both voices of the two-string shape (L24) hand over at the same instant with
the same numbers, so the fix is per-voice and does not introduce a flam.
