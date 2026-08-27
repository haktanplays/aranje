# Technique Notation Grammar v1

What the tab draws when the music says *how* a note is played, what it
deliberately does not draw, and why.

Companion to `src/lib/tab/technique-geometry.ts`, which owns every decision
described here, and to `eval/intent-composer/TECHNIQUE-VISUAL.json`, which is
the measurement of what the browser actually drew.

## 1. Support matrix

"In contract" means the Song Contract's `articulationSchema` already carries
the value. "Data available" means the geometry can be derived from the Song
alone, with no new field.

| Technique | In contract | Data available | Rendered in v1 |
| --- | --- | --- | --- |
| Hammer-on | `hammer_on` | previous onset on the string + sounding pitch | **yes** — one phrase arc |
| Pull-off | `pull_off` | same | **yes** — same arc |
| Slide | `slide` | previous onset + sounding pitch gives direction | **yes** — leaning connector |
| Bend amount | `bend_half`, `bend_full` | the enum *is* the amount | **yes** — `½` and `1` |
| Vibrato | `vibrato` | `startSlot`/`endSlot` give the duration | **yes** — three-cycle wave |
| Palm mute | `palm_mute` | per-note, grouped into runs | **yes** — `PM` + dashed rail |
| Let ring | — | — | no — §3 |
| Natural harmonic | — | — | no — §3 |
| Pinch harmonic | — | — | no — §3 |
| Tremolo arm | — | — | no — §3 |

Nothing was added to the Song Contract or to the Expression Contract for this
round, and no existing articulation was borrowed to stand in for a missing one.

## 2. The two shared measurements

Every mark is placed by exactly two numbers, so no technique can invent its own
idea of how much room it owns.

**The owner slot** is the horizontal room one note's marks may use: the
midpoints between that note and its neighbours *on the same string*, inset by
`SLOT_INSET_PX`, clipped at the bar's own edges. Neither neighbour can dispute
a midpoint. A mark that does not fit inside it is clipped — note spacing is
never opened to make room for an annotation, because that would pull this
lane's bar lines away from every other lane's (K-57).

**The annotation lane** is the vertical band a string's marks are drawn in: the
gap the staff already leaves above that string's line. Its ceiling keeps
`LANE_CLEAR_PX` clear of the line above; its floor keeps clear of the *numeral*
rather than of the line, because a digit is centred on its line and is taller
than the line's own clearance. For the top string the gap is the staff's
existing top padding, so the same arithmetic holds and the staff does not grow
by a pixel. Row heights, string spacing and every note's x and y are the same
with the marks as without them, measured on six screens.

Overlays take no pointer events, own no hit target, and are not measured by the
layout.

## 3. Techniques with a drawing but no data

These four have a visual specification and **no production code**, because the
Song Contract has no field for any of them. Writing them today would mean
either extending a contract this round was told not to touch, or dressing up an
existing articulation as something it is not — a claim on the page that the
data cannot support, and one that would survive into MIDI, WAV, the project
file and Copilot's context.

- **Let ring.** `LR` at the start of the range, then a straight (not dashed)
  horizontal rail. The rail is broken by the next attack on the same string,
  which is exactly the semantics the contract cannot express: "keep sounding
  through the following notes" is a property of the *note*, and today a note's
  sounding length is a tie, which stops the next attack instead of overlapping
  it. Needs an overlap-capable duration, not a new enum value.
- **Natural harmonic.** A thin hollow diamond hugging the numeral, not
  replacing it. Needs a flag on the note; it cannot be inferred from the fret,
  because 5, 7 and 12 are ordinary frets as well as harmonic nodes.
- **Pinch harmonic.** The same diamond plus a small `PH`. Needs its own flag:
  it is a right-hand technique and shares no data with the natural harmonic.
- **Tremolo arm dive.** A short downward curve with the real amount beside it
  (`−1`, `−2`), the arrow's length **not** encoding the amount — the same rule
  the bend already follows. Needs a signed semitone amount and a target, and it
  is a whole-instrument gesture rather than a per-note one, so it does not fit
  the single `articulation` field even if a value were added.

Recorded as visual-spec debt, alongside `sus`, dead notes, ghost notes, muted
strums and stroke direction in `eval/intent-composer/EXPRESSION-GAPS.md`.

## 4. What each drawn technique claims

- **Legato is a phrase, not a link.** An uninterrupted run of slurred notes on
  one string is a single shallow arc that starts slightly left of the first
  source note and ends slightly right of the last target, with every note of
  the run under it and an `H` or a `P` at each transition's mathematical
  centre. No endpoints, no hooks, no dots, and no second arc for a second
  transition. A run breaks at a re-pick, a rest, a change of string, a note
  that is not slurred, and at any pair whose sounding pitch moves the wrong way
  — the last of which is the same rule the articulation-context validator uses,
  so the tab and the validator cannot disagree.
- **A slide is a movement between two numerals.** Both digits stay on their own
  string line at their own y; nothing is nudged up or down to suggest the
  movement. A thin connector between the two digit bounds leans up for a rise
  and down for a fall, read from the **sounding pitch** rather than from the
  fret numbers, which on a fretboard can point opposite ways. No `S`, no
  sentence, nothing written into the tab.
- **A bend says its amount in words, not in length.** Every bend arrow is the
  same short curve with the same curvature; only the label differs. Half step is
  `½`, whole step is `1`, and there is no third value to write because the
  contract carries no third amount. Bend-release and pre-bend are not drawn:
  they are not separate semantics today, and a mark for them would be a guess.
- **Vibrato is a wave.** Three gentle oscillations immediately above the note.
  The height is fixed and says nothing about intensity, which the contract does
  not carry. The length follows how long the note is held and is then clipped by
  the owner slot, so a long vibrato stops before the next number rather than
  reaching into it.
- **Palm mute is a range.** One `PM`, one dashed rail across the run, one end
  cap after the last muted note and before the first unmuted note's own slot.
  `PM` is not repeated per note. A range breaks at an unmuted note, a rest, a
  gap and a change of string.

## 5. Colour

Read mode is the neutral grey the rest of the notation uses. The bronze accent
appears only while a mark's notes are under the reader's hand. Permanent
notation is never bronze, and no mark is told by colour alone: every one of
them is a shape.

## 6. Known limitation

The legato run's notes still carry the underline the `legato` glyph state has
drawn since 2S-A §4. With the phrase arc above them saying the same thing, four
underlines in a row read closer to a selection than to a slur. The glyph state
is 2S-A's and was not changed unilaterally; removing it is one line in
`FrettedBarBlock`'s `stateOf`.
