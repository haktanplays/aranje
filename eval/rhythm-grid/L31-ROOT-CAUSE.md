# L31 — why the two groupings sounded the same

**Founder's verdict:** `FAIL` — "İkisi arasında belirgin bir fark yok".

Everything below is measured in **rendered PCM**, through
`renderSongToBuffer` — the export button's own renderer — in a real Chromium
against the running app, so the sample URLs resolve exactly as they do for a
reader. Reproduce with:

```sh
npx vite build --config eval/rhythm-grid/vite.rhythm-render.config.mts
npx next build && npx next start -p 3115
node eval/rhythm-grid/measure-audio.mjs
```

---

## 1. The fixture did what it claimed

L31's two takes were checked against the song and against the production
plan before anything else was considered, because "the accent is surely
there" is the assumption that would have wasted the round.

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

So **hypothesis A is eliminated**: the accents are on the right ticks, the
two takes differ only in where they are, the grouping reaches the production
resolver, and the plan applies exactly the preset the contract declares.

## 2. What the render actually delivers

An eight-note control bar — one pitch, one string, one duration, one
velocity — rendered three times: every note plain, every note accented, and
alternating.

| Render | plan gain | plan envelope | PCM peak | dBFS |
|---|---|---|---|---|
| all plain | 0.755906 | *(none)* | 0.0353 | −29.0 |
| all accent | 0.755906 | 0.891969 | 0.1307 | −17.7 |

- The preset says an accent is **×1.18**, which is **+1.44 dB**.
- The render delivers **×3.70**, which is **+11.4 dB**.
- The gap is **×3.133**, or **+9.92 dB**.

That gap is not noise and not a property of the accent. Repeating the
measurement with `ghost`, whose preset is **×0.45**, gives a delivered
**×1.410** — and `1.410 / 0.45 = 3.133`, the same constant to three decimals.
A note that carries **any** attack is played by a voice of its own
(`expressive: true` in the plan); a note that carries none goes through the
shared sampler; and for the same nominal gain those two paths are **9.92 dB
apart**.

| attack | preset | delivered ÷ plain | implied path offset |
|---|---|---|---|
| accent | 1.18 | 3.697 | **3.133** |
| ghost | 0.45 | 1.410 | **3.133** |
| tapping | 0.85 | 2.556 | 3.007 ¹ |
| dead | 0.55 | 1.192 | 2.167 ¹ |
| natural harmonic | 0.70 | 2.577 | 3.682 ¹ |
| pinch harmonic | 0.95 | 3.444 | 3.625 ¹ |

¹ These four also change the filter, the hold or the playback rate, so their
peaks move for reasons besides level; only `accent` and `ghost` are pure gain
changes and only they isolate the offset.

## 3. The root cause, in one sentence

An accented note is delivered about **eleven decibels** above an unaccented
one instead of the one and a half the preset declares — because an attack
moves the note onto the expressive-voice path, which sits **9.92 dB** above
the sampler path for the same gain — so in L31 the *unaccented* eighths fall
far enough below the accents to stop functioning as a pulse, and with no
audible pulse there is nothing for `2+2+3` and `3+2+2` to be different
*against*.

This is the brief's **hypothesis B**, with the sign inverted: the plan's ratio
does not survive into the PCM, and it does not survive by being exceeded
rather than by being erased.

## 4. A second, independent defect in the fixture

L31's riff runs frets **5-6-7-5-6-7-5**. That contour repeats every three
notes, so it proposes a grouping of its own — and one that agrees with
neither `2+2+3` nor `3+2+2`. A pitch pattern is a far stronger grouping cue
than a level change, so even with a working accent this riff was asking a
listener to hear an accent grouping through a contradicting contour grouping.

Both defects point the same way, and the founder's ear was right about both.

## 5. What was and was not changed

**Not changed: the path offset.** Levelling the expressive voice against the
sampler is a one-constant change with a very large blast radius — it moves
every technique in the app, including L25, L26, L27, L28 and L29, which the
founder has already judged. Re-levelling them inside a completion round would
silently rewrite audio that has a recorded verdict, and no measurement in
this round can stand in for those ears. It is written here as the round's
first open debt, with the number needed to fix it and the command that
reproduces it.

**Changed: the card.** L33 asks the same musical question with both defects
removed from the fixture rather than from the engine:

- **One repeated pitch**, so nothing but the striking can group it.
- **Every eighth authored** — accents on the group starts, `ghost` on the
  rest — so both kinds of note travel the same rendering path and what a
  listener compares is the ratio the presets own.

Measured on the rendered L33 takes:

| | accent mean peak | ghost mean peak | ratio | dB |
|---|---|---|---|---|
| L33a `2+2+3` | 0.15195 | 0.05822 | 2.610 | **+8.33** |
| L33b `3+2+2` | 0.15151 | 0.05835 | 2.597 | **+8.29** |

Both takes carry three accents and four ghosts per bar, the same pitch, the
same onsets and the same total loudness. Only where the accents fall differs.

**No per-card gain, EQ or transient was added, no second voice was
introduced, the master limiter was not touched and no note was quietened to
manufacture a contrast.** The difference L33 offers is the one the presets
already declare, on a fixture that lets it be heard.
