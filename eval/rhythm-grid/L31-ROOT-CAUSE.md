# L31 — why the two groupings sounded the same

**Founder's verdict:** `FAIL` — "İkisi arasında belirgin bir fark yok".
Unchanged, and not raised by anything in this file.

Everything below is measured in **rendered PCM**, through
`renderSongToBuffer` — the export button's own renderer — in a real Chromium
against the running app, so the sample URLs resolve exactly as they do for a
reader. Reproduce with:

```sh
npx vite build --config eval/audio-parity/vite.parity.config.mts
npx next build && npx next start -p 3117
node eval/audio-parity/measure-parity.mjs      # writes eval/audio-parity/artifacts/PARITY.json

npx vite build --config eval/rhythm-grid/vite.rhythm-render.config.mts
node eval/rhythm-grid/measure-audio.mjs        # writes eval/rhythm-grid/artifacts/AUDIO.json
```

---

## 1. The fixture did what it claimed

L31's two takes were checked against the song and against the production
plan before anything else was considered.

| | L31a | L31b |
|---|---|---|
| Metre | 7/8 `2+2+3` | 7/8 `3+2+2` |
| Onset ticks | 6144 … 6720, every 96 | identical |
| Pitches | D3 D#3 E3 D3 D#3 E3 D3 | identical |
| Duration each | 88 ticks | identical |
| Velocity each | 96 | identical |
| Accented eighths | 0, 2, 4 | 0, 3, 5 |
| Plan gain | 0.755906 on every note | identical |
| Plan envelope peak on an accent | 0.891969 | identical |
| Applied ratio | 1.18 | 1.18 |

The accents are on the right ticks, the two takes differ only in where they
are, the grouping reaches the production resolver, and the plan applies
exactly the preset the contract declares.

## 2. The first round's answer was wrong, and this is what replaced it

The c1 round measured an accented note about **11.4 dB** above an unaccented
one where the preset declares **1.44 dB**, saw the same ×3.133 residue when
it repeated the measurement with `ghost`, and concluded that the
expressive-voice path sits a constant **9.92 dB** above the shared sampler.

That conclusion does not survive being measured directly. `neutralParity()`
renders one note — one buffer, one pitch, one onset, one duration, one
nominal gain, no automation, no filter, no attack multiplier — down both
production paths and reads the peak after every stage of the graph:

| stage | plain peak | expressive peak | expressive ÷ plain |
|---|---|---|---|
| source only | 0.102654 | 0.102654 | **×1.000 — 0.000 dB** |
| + pack trim (+14 dB) | 0.514491 | 0.514491 | **×1.000 — 0.000 dB** |
| + track channel | 0.363800 | 0.363800 | **×1.000 — 0.000 dB** |
| + master headroom (−3 dB) | 0.257551 | 0.257551 | **×1.000 — 0.000 dB** |
| + ceiling limiter (−1 dBFS) | 0.257693 | 0.257693 | **×1.000 — 0.000 dB** |

There is no gain-routing offset. The two paths are level to the last digit at
every node: one connection each to the same `Channel`, one master, one
ceiling, the pack's trim applied exactly once on both sides.

## 3. The real mechanical cause: the two paths disagree about *which recording*

A note without an articulation is played by the track's shared
`Tone.Sampler`, which chooses its own recording from the pitch. A note that
carries one is played by an expressive voice, which asks `nearestSample`.
Those two choosers had different tie-breaking rules, and this pack has ties.

`sampleChoices()` asks both — the sampler's answer read off a **real**
`Tone.Sampler` node rather than from a second copy of the arithmetic — for
every semitone the guitar pack covers (E2…E4, 25 semitones):

| midi | expressive plays | at rate | sampler plays | at rate |
|---|---|---|---|---|
| **50 (D3)** | C3 | 1.122462 | **E3** | 0.890899 |
| **62 (D4)** | C4 | 1.122462 | **E4** | 0.890899 |

23 of 25 agreed. Two did not, and both are exactly halfway between two
recordings: the pack holds E2 A2 C3 E3 A3 C4 E4, so D3 is two semitones from
C3 and two from E3. `nearestSample` broke the tie **down** and played the
lower recording sped up; `Tone.Sampler._findClosest` searches upward first
and so breaks the tie **up**, playing the higher recording slowed down.

**L31 is written on string 1, fret 5 — which is D3.** So is the c1 A/B
control that produced the ×3.133 number. The same written note was coming
from two different recordings, at two different stretches, depending only on
whether it carried an accent.

A sped-up recording reaches its transient sooner. The c1 measurement read a
**25 ms window from the onset**, and this pack does not peak until about
**66 ms** — so that window measured how fast the note rose, not how loud it
was. That is where 9.92 dB came from:

| pitch | peak, plain ÷ expressive | first 25 ms, plain ÷ expressive |
|---|---|---|
| C3 (recorded) | ×1.000 — 0.000 dB | ×1.000 — 0.000 dB |
| **D3 (a tie)** | ×1.078 — 0.655 dB | **×4.900 — 13.804 dB** |
| E3 (recorded) | ×1.000 — 0.000 dB | ×1.000 — 0.000 dB |
| **D4 (a tie)** | ×0.922 — −0.704 dB | ×0.864 — −1.269 dB |
| F3 (stretched) | ×1.000 — 0.000 dB | ×1.000 — 0.000 dB |

So the founder's ear was right and the c1 number was an artefact of two
things at once: a fixture written on one of the only two pitches where the
paths disagree, and a window shorter than the sample's own attack.

## 4. What the contract actually delivers, through the product

Eight identical notes, one attack each, rendered by `renderSongToBuffer` and
measured over each note's whole sounding window — peak, transient RMS
(0–60 ms) and sustain RMS (200–400 ms) reported apart, because a peak alone
cannot tell a level change from a shape change.

**On fret 3 (C3 — a recorded pitch, where the paths already agreed):**

| | accent ÷ plain | ghost ÷ plain | accent ÷ ghost |
|---|---|---|---|
| peak | ×1.1800 — **+1.438 dB** | ×0.4425 — −7.082 dB | ×2.6667 — +8.520 dB |
| transient RMS | ×1.1714 — +1.374 dB | ×0.4467 — −7.000 dB | ×2.6223 — +8.374 dB |
| declared | ×1.18 — +1.438 dB | ×0.45 — −6.936 dB | ×2.6222 — +8.373 dB |

The presets already arrive intact, and the ordering **accent > plain >
ghost** already holds. `ghost` is not louder than a plain note: it is less
than half of one.

**On fret 5 (D3 — the tie), before and after the fix:**

| | before | after | declared |
|---|---|---|---|
| accent ÷ plain, peak | ×1.2600 — +2.007 dB | ×1.1738 — **+1.392 dB** | +1.438 dB |
| ghost ÷ plain, peak | ×0.4723 — −6.516 dB | ×0.4477 — **−6.981 dB** | −6.936 dB |
| accent ÷ ghost, peak | ×2.6679 — +8.523 dB | ×2.6222 — **+8.373 dB** | +8.373 dB |
| accent ÷ ghost, sustain RMS | ×3.5222 — +10.936 dB | ×3.3371 — +10.467 dB | — |

The sustain figures stay above the peak figures for a reason that is
semantic rather than a level error: `ghost` also shortens the note
(`holdFraction` 0.6), so a window 200–400 ms in catches its release. That is
the preset doing what it says, not a routing residue.

## 5. The fix

One line, in one place, and it removes a divergence rather than adding a
compensation: `nearestSample` now reports **the shared sampler's** choice —
an equally close recording only wins if it is the higher one.

The sampler is the authority rather than the other way round because the
plain path is the one the founder has already passed by ear (L1), and moving
*it* would be re-levelling audio that has a recorded verdict.

After the change, 0 of 25 semitones disagree, and D3 and D4 measure ×1.000 —
0.000 dB between the paths on both the note's peak and its first 25 ms.

No per-card gain, no EQ, no second transient or sample, no change to any
attack preset, no change to the master or the limiter, and no sample asset
was edited.

## 6. The second, independent defect in the fixture

L31's riff runs frets **5-6-7-5-6-7-5**. That contour repeats every three
notes, so it proposes a grouping of its own — and one that agrees with
neither `2+2+3` nor `3+2+2`. A pitch pattern is a far stronger grouping cue
than a level change, so even with a working accent this riff was asking a
listener to hear an accent grouping through a contradicting contour grouping.

Both defects point the same way, and the founder's ear was right about both.
