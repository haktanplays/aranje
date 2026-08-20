# Shadow Eval S-01 — musical blueprint

Written before any notes, so the turns can be judged against an intention
rather than against whatever came out.

## Frame

| | |
|---|---|
| Tempo | 64 BPM, 4/4 |
| Grid | 1/16 → one slot = 0.234375 s, one bar = 3.75 s |
| Length | 16 bars = **60.000 s** exactly |
| Key | D minor — core D E F G A Bb C (0 2 3 5 7 8 10) |
| Electrics | Drop D: D2 A2 D3 G3 B3 E4 |
| Acoustic | E standard: E2 A2 D3 G3 B3 E4 |

Slot 0/4/8/12 are the four beats. Everything syncopated is stated against
those.

## The motif

One rhythmic cell carries the whole piece. It is **3+3+2+…** against the
sixteenth grid — onsets on 0, 3, 6, 10, 12 — which pushes against the beat
twice and lands back on beat 4. It is written on the open low D so the
guitar's lowest string does the work, and it leaves slots 1–2, 4–5, 7–9, 11
and 13–15 empty. The silence is the riff as much as the notes are.

    M:  0   3   6      10  12
        D>  D.  D>     D.  D>          > accent   . palm mute

Every later section is this cell moved, thickened or thinned.

## Break (bars 1–4)

- Bars 1 and 3: **M** unchanged. Heavy, wide open, nothing on the upbeats
  the ear expects.
- Bars 2 and 4: **M′** — the same first three attacks, then a chromatic tail
  F2 → Eb2 → D2 on the low string. Eb is the one colour tone, and it is a
  passing note into the tonic, not a riff built on it. The bar stays a
  D-minor bar by a clear majority.
- Bar 4 ends on a held D2 so the Bridge has something to cut into.

Drums: half-time backbone — snare on beat 3, kick following the accents on 0
and 12 but **not** the palm-muted sixteenths, hat marking the beats. Crash
only at bar 1 and at the turn into bar 4.

## Heavy Bridge (bars 5–8)

The same cell, recognisably, but tightening:

- The 0/3/6 attacks stay, so the ear hears the Break.
- The gaps fill in from bar 6 onward: the 10 and 12 attacks become a pair.
- Tension arrives as **Ab2**, the tritone from D, and as a chromatic descent
  A2 → Ab2 → G2.
- **The slide** lives here: F2 → Ab2 on the low string. Both pitches are
  playable at exactly one place on a Drop D guitar (F2 = string 0 fret 3,
  Ab2 = string 0 fret 6 — A2 open is already 45, so neither can sit
  anywhere else), so the two are on the same string whatever the placement
  engine decides. The source is held into the slide, so there is no rest
  between them and the hand has a full sixteenth to travel.
- Bar 8 stops on a held Ab2 → the unresolved tritone is the landing the solo
  answers.

Drums: busier, sixteenth kick pairs, a fill across bar 8 into the solo.

## Solo (bars 9–12)

**Rhythm guitar** thins to a backing: long palm-muted D2 pedals on the
downbeats and one accent per bar. It keeps the pulse without occupying the
register the lead needs.

**Lead** stays in one hand position around the 3rd–8th fret of the top three
strings, so the slurred pairs cannot be split across strings by placement:

- Bar 9 — statement. The motif's 0/3/6 rhythm, transposed into melody:
  D4 · F4 · E4. Ends with a **hammer-on** D4→E4 and a **bend_half** on F4.
- Bar 10 — answer. Same shape a third higher, with a **pull-off** G4→F4 and a
  **slide** up to A4.
- Bar 11 — the peak. A **bend_full** on A4, held, with **vibrato** on the
  note it lands on. This is the only bar that goes above the staff, so it
  reads as a climax rather than as noodling.
- Bar 12 — descent and landing on **D4, sustain**. That D is the common tone
  the acoustic takes over.

No scale runs: every bar is the same three-note contour re-voiced.

Drums: most active here, but pulling back through bar 12 — the second half
of bar 12 is silent so the acoustic has air to start in.

## Acoustic Outro (bars 13–16)

Only the acoustic guitar is written in this section. The other three tracks
have no key in the bar at all, which is how the Song Contract spells silence
(spec 5.5) — not an array of nulls, which would be a different statement.

- Opens on **D4**, the note the solo ended on, in the top voice of a
  Dm(add9) arpeggio over the open D string.
- Bars 13–14: open-string pedal, arpeggios rolling D3 · A3 · D4 · F4 · E4.
  Dark, but tonally continuous with everything before it.
- Bar 15: the shadow of the motif — the 0/3/6 attack pattern returns, quietly,
  on plucked open strings. It is the same rhythm as the Break's opening, so
  the piece closes the circle without restating the riff.
- Bar 16: Dsus2 resolving to Dm, arpeggiated and left ringing. Resolved,
  but the minor third in the last voice keeps it from being cheerful.

## Articulation plan

| Technique | Where it belongs musically |
|---|---|
| palm_mute | Break/Bridge low-string pedal; solo backing |
| accent | The motif's downbeat hits, every section |
| staccato | Bridge stop-start stabs |
| sustain | Break bar 4 landing; solo bar 12 landing; outro |
| slide | Bridge F2→Ab2 (forced same string) |
| hammer_on | Solo bar 9, D4→E4 |
| pull_off | Solo bar 10, G4→F4 |
| bend_half | Solo bar 9, F4 |
| bend_full | Solo bar 11, A4 peak |
| vibrato | Solo bar 11, the note the full bend lands on |

Nothing is placed to fill a box. If a technique cannot be written where it
belongs, it is reported missing rather than written somewhere it does not
belong.
