# 2S-A vacuity probes (§17)

Ninety mutations, each one a way a guarantee this checkpoint claims could be
quietly untrue, run against the tests that are supposed to hold it.

| Kind | Script | Probes | Red | Vacuous |
|---|---|---:|---:|---:|
| unit / AST | `probes.sh` | 72 | 70 | 2 |
| browser | `browser-probes.sh` | 12 | 12 | 0 |
| real audio / render | `audio-probes.sh` | 6 | 6 | 0 |
| **total** | | **90** | **88** | **2** |

Every mutation is the *dangerous behaviour*, never a syntax error. Three of the
first drafts only broke compilation or added dead code — they were rewritten
into real behaviour changes rather than counted, because a probe that only
breaks the build proves nothing about the test.

## What the first round found green, and what was done about it

Seventeen unit probes and six browser probes came back green the first time
they were run. None of them is hidden here; each is either a test that did not
exist and now does, or an equivalent mutation with the reason written down.

### Real gaps, now closed by a named test

| Probe | What was missing | Test added |
|---|---|---|
| 2 the room is measured on the note the finger leaves | the reported fixture puts the target one slot in, where the two readings are the same number | `expression-plan.test.ts` — "takes the travel from the note it lands on, not from the one it leaves" (target four slots in) |
| 6 negative room counts as room | nothing called `transitionSeconds` with a negative room | "treats a note with no room left as no room at all" |
| 19 the arc direction is read off the fret | on one string the fret order and the pitch order always agree — until a song says otherwise | `legato-arc.test.ts` — "believes the sounding pitch over the fret number" |
| 23 an arc crosses the bar line | `openStart` was never exercised | "draws nothing across a bar line" |
| 24 a silent bar still draws its arcs | `silent` was never exercised | "draws nothing in a bar that has no sound in it" |
| 26 the curve peaks at half the rise it claims | the path's control point was never read | "peaks at the rise it reports, not at half of it" |
| 35 a shape with a lower note under the finger | only one string and one size were checked | `power-chord-pen.test.ts` — "puts nothing under the finger, whichever string it lands on" |
| 42 an unreachable root is refused as an unrelated error | the refusal was asserted, its code was not | added to "refuses a root the fretboard cannot build a fifth above" |
| 45 auto reads the direction off the fret | the cross-string case refuses for a different reason first | `legato-brush.test.ts` — "follows the sounding pitch when the written fret disagrees with it" |
| 56 a count of nothing quietly does nothing | only `ok === false` was asserted | code and message added to "refuses a count of nothing" |
| 58 the shape move is done by transposing pitches | with `stringDelta: 0` the two produce the same song | `continue-pattern.test.ts` — "moves the hand across the strings even when the fret does not change" |
| 71 a 1/32 group is beamed as a 1/16 one | the label was only checked on a 1/16 group | `rhythm-guide.test.ts` — "says a thirty-second group is a thirty-second group" |
| 72 a group takes the deepest level | every note in the fixture had the same duration | "beams a mixed group at the shallowest note in it" |
| B5 the digit is painted into the 44px hit target | the cell was measured, the glyph's own box was not | acceptance scenario 62 — "the glyph's own box is smaller than the finger's" |
| B8/B9/B10 the row is sized in rem again | the layout tour ran at 390px only, and the clipping is a 320px fact | the browser probes now run the full viewport matrix |
| A5 a repeated pitch is dropped as inaudible | the arrival check had no claim about how many targets a fixture has | `check-audio.mjs` — "the slur it is written with is still a slur" |

### Equivalent mutations, kept and labelled

Two probes stay green because the mutation cannot change behaviour. Neither is
removed: a probe that is honestly equivalent is a fact about the code, and
deleting it would hide that fact from the next reader.

- **27 the chain depth never resets after a broken link.** The reset it removes
  is in the `no previous note on this string` branch. Reaching that branch means
  no arc has been drawn on that string yet, so the depth is already `0` and
  setting it to `0` changes nothing. The *other* reset — after a link whose
  direction disagrees with the pitch — is a real one, and probe 20 holds it red.
- **57 a move of zero takes a different path from an exact repeat.** The
  short-circuit it removes is an optimisation: `translate_fret_shape` with
  `0/0` gives back the same song the fast path does. The test that matters —
  "treats a move of zero as an exact repeat" — compares the two results byte
  for byte and would catch a real divergence.

### Rewritten rather than counted

Three first drafts were not valid probes and were replaced:

- `B7` first replaced `<LegatoArcLayer>` with an undefined component, which
  only broke the build. It now makes the layer render nothing.
- `A5` and `A6` first added an unused constant to `schedule.ts`, which changes
  nothing at all. They now filter repeated pitches out of the expression plan
  and turn a written slur into an ordinary attack — the two shortcuts §3
  forbids by name.

## Hygiene

- `.probebak` collision protection in all three scripts: a leftover backup
  aborts the run rather than racing another one.
- No parallel probe scripts; each mutates one file at a time and restores it
  before the next.
- `audio-probes.sh` rebuilds the render bundle after its last probe, so the
  bundle on disk is the committed sources' bundle rather than the last
  mutation's.
- After the runs: `git status --porcelain` shows only the intended files, no
  `*.probebak` exists anywhere, and `rg -n "PROBE" src scripts eval content`
  finds only `eval/shared/project-storage.mjs`'s own ledger key, which predates
  this phase.
