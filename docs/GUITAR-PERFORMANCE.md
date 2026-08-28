# Guitar Performance v2 — what was measured, changed, and left open

Written during 2T §10. Every number here comes from a render through the
production chain, not from listening. Nothing in this file claims the guitar
sounds organic: that is a judgement about timbre, it needs ears, and it is
Haktan's to make.

## 1. The hard transient had a measured cause

The founder heard the guitar "firing a gun". The obvious move is to lengthen
an attack envelope until it stops sounding like that, which treats a symptom
nobody has located. `eval/chord-audio/artifacts/HEADROOM.json`, rendered
offline through the production chain in 2O-B.1, had already located it:

| case | notes | peak | clipped samples |
|---|---|---|---|
| two-note power chord, −6 dB | 2 | −9.95 dBFS | 0 |
| six-note chord, tracks at −6 dB | 6 | −0.85 dBFS | 0 |
| six-note chord, tracks at 0 dB | 6 | **+5.15 dBFS** | **1576** |
| two guitars | 12 | **+4.17 dBFS** | **644** |
| six notes, hard panned | 6 | **+2.16 dBFS** | **18** |

The master was a unity `Gain` wired straight at the destination, with nothing
between it and the speaker. Samples sum linearly, so ordinary material went
over full scale and the output clipped. **Clipping is a hard transient** — it
is a square edge where a decaying string should be. And the case that does not
clip has eight tenths of a decibel spare, which is not headroom, it is luck.

## 2. What changed

Two stages, doing different jobs (`src/lib/audio/master-bus.ts`):

- **Headroom, −3 dB.** A fixed linear trim. No timbre change, no dynamics
  change; it only moves everything down so a ceiling is reachable. −3 rather
  than −5 because a trim big enough to rescue the pathological cases on its
  own would spend that on every quiet passage too.
- **A ceiling at −1 dBFS.** Catches what is still above it. It should be idle
  on ordinary material — a limiter that is always working is a compressor
  nobody asked for. Below zero rather than at it, because a sample-peak
  ceiling at 0 still lets the peak *between* two samples go over on
  conversion, which is what makes an otherwise clean mix crackle on a phone.

This is a dynamics change to every render and export. It needs listening
before it can be called an improvement.

## 3. Hammer-on and pull-off: the plan was already right

The founder's finding was that a written hammer-on does not read as one by
ear. Before touching anything, `src/lib/audio/hopo-probe.test.ts` asks what
the planner already says, and the answer is that it says the right thing:

- a legato chain is **one struck note** followed by targets that are never
  struck — `noteIds.length === transitions.length + 1`;
- hammer-on and pull-off are carried as different transition kinds;
- a slide travels and a hammer arrives — the slide's transition carries more
  pitch points than the hammer's.

So this is not a scheduling defect. What reaches the ear is a single sampled
note whose pitch moves, and one sample per pitch cannot supply the fret impact
that makes a hammer-on legible. That is an asset problem, described next.

## 4. The asset boundary — round-robin is not possible today

§10 asks that repeated notes not sound like a machine gun, "mümkünse mevcut
lisanslı asset'lerle round-robin". It is not possible. The whole electric
guitar is **seven files**:

```
public/samples/electric_guitar/high_gain/
  A2.mp3 A3.mp3 C3.mp3 C4.mp3 E2.mp3 E3.mp3 E4.mp3
```

One sample per pitch, seven pitches, every other note produced by pitch-
shifting a neighbour. There are no alternates to rotate between, so a
round-robin has nothing to round-robin over, and no amount of code creates
one. Downloading more is out of scope by §17.

**What is needed, as a specification rather than a wish:**

| need | why | minimum |
|---|---|---|
| round-robin picked notes | stops the identical-buffer repeat | 3 alternates per sampled pitch |
| sampled pitch coverage | less pitch-shifting per note | one per 3 semitones across E2–E5 |
| velocity layers | a soft note is not a quiet loud note | 2 layers (soft, hard) |
| fret-impact / hammer layer | what makes a hammer-on legible | one short noise-plus-body sample per string region |
| release / pull-off layer | what makes a pull-off legible | one short pluck-release sample per string region |
| palm-mute samples | a real mute is a timbre, not a short note | one per sampled pitch |

Licence terms must permit redistribution in a web app. Until those exist, the
performance *semantics* are correct and the *timbre* is limited by seven
files, and no amount of envelope shaping changes that.

## 5. Status

- Headroom and ceiling: **implemented, measured cause, unlistened.**
- Legato planning: **already correct, verified by test.**
- Legato timbre, round-robin, velocity layers, palm-mute timbre:
  **blocked on assets**, specified above.
- Physical audio verdict: **Haktan müzikal ve fiziksel kabulünü bekliyor.**
