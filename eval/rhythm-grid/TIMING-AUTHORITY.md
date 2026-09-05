# Who owns musical time (2V-D.2 §2)

Taken from the code at `7f1fe36`, before anything in this round was written.
Each row names the module that actually decides, not the one that sounds like
it should. Where two modules answer the same question, the row says so and
`src/lib/music/timing-authority.test.ts` holds a named test that demonstrates
the disagreement rather than quietly picking a winner.

| Question | Authority | Notes |
|---|---|---|
| Tick unit | `music/timing.ts` — `PPQ = 192`, `TICKS_PER_WHOLE = 768` | Single. Ticks per **quarter**; everything musical is in ticks. |
| Bar length in ticks | `music/timing.ts` — `ticksPerBar` | **Contested.** Nine modules recompute `slotCount() * ticksPerSlot()` inline instead of calling it. |
| Time signature | `music/timing.ts` — `TIME_SIGNATURES` | Single list; the schema validates against it. Four entries before this round. |
| `Bar.notation` | `song/schema.ts` + `music/timing.ts` — `readingResolution` | The grid the reader reads, when the stored one is a lattice. Optional; absent means the stored resolution is the reading grid. |
| Stored resolution / lattice | `music/timing.ts` — `STORED_RESOLUTIONS`, `LATTICE_RESOLUTIONS = [48]` | Single. 48 exists only so straight and triplet share a bar. |
| Offered resolution | `music/timing.ts` — `RESOLUTIONS` | Single. What a reader may choose; never includes a lattice. |
| Rhythm profiles | `music/rhythm-profile.ts` — `RHYTHM_PROFILES` | Five **grid** profiles (straight 8/16/32, triplet 8/16). Not meters, not feels. |
| Availability | `music/rhythm-availability.ts` — `rhythmAvailability` | Single gate, three states: `available`, `requires_local_override` (the brief's `available_with_local_upgrade`), `unavailable`. Already the only answer to "may I write this here". |
| Regrid | `song/bar-regrid.ts` | Single. Refuses rather than rounds. |
| Sequence write | `song/sequence-write.ts` | Single. Computes its own `barTicks` inline (see the contested row). |
| Note duration | `song/schema.ts` — `NoteEvent.durationTicks` + `song/sounding.ts` | Written length vs sounding length are two different questions and two modules. |
| Onset spacing | derived — the next onset in `sectionSlotStream` | Not stored. This is why duration and spacing can be confused. |
| Tuplet / grouping | `song/schema.ts` — `Bar.grouping`; `music/rhythm-profile.ts` — `GROUPING_PRESETS`, `defaultGrouping` | **Was contested; now persisted and single.** Optional on the bar; absent means the metre's ordinary feel. |
| Phrase tick ranges | `tab/phrase-band.ts` + the phrase model | Section-relative ticks. |
| Technique span ticks | `song/schema.ts` — `TechniqueSpan` | Section-relative, half-open, string-scoped. |
| Zoom / view state | `tab/song-axis.ts`, `ui/*` view state | Camera only. Never written to the Song. |
| Metronome accent | `audio/position.ts` — `metronomeClicks` → `music/meter-beats.ts` — `meterBeats` | **Was contested; now single.** A list with per-beat strength; the beat lines, beams, count-in and spoken reading all read the same list. |
| MIDI / WAV timing | `export/midi-plan.ts`, `export/render-wav.ts` → `audio/tempo.ts` | Both read the same tempo map. No second scheduler. |

## The three real conflicts

**1 · Bar length has one formula and ten spellings.** `ticksPerBar` exists and
nine other modules open-code the same product. They agree today because the
formula is the same; nothing makes them keep agreeing, and the next meter added
has to be right in ten places or wrong in one.

**2 · "Where is the beat" has two incompatible answers.** `slotsPerFeltBeat`
returns a **number** — one beat length for the whole bar — and `BeatGrouping`
returns a **list**. For 4/4, 3/4 and 6/8 they agree. For 7/8 they cannot: the
scalar says seven equal eighths, and a 7/8 felt `2+2+3` has three beats of
unequal length. Everything that clicks, draws a beat line, counts in or reads
the rhythm aloud goes to the scalar; nothing reads the grouping.

**3 · Grouping cannot be written down.** `Bar` has no field for it, so 5/8 felt
`2+3` and 5/8 felt `3+2` are the same bytes. They are different music, the notes
cannot tell them apart, and the format has nowhere to record which one the
reader meant.

## What is already exact, and therefore not being rebuilt

6/8 with sixteenth-triplets needs **no new schema**. Measured:

```
6/8 @  8  slots=6  slotTicks=96  bar=576
6/8 @ 16  slots=12 slotTicks=48  bar=576     straight sixteenths
6/8 @ 24  slots=18 slotTicks=32  bar=576     sixteenth triplets
6/8 @ 48  slots=36 slotTicks=16  bar=576     both at once
gcd(48, 32) = 16 -> the lattice already shipped is the exact common grid
```

Every bar length is 576 ticks. Straight sixteenths fall on every third lattice
slot, sixteenth-triplets on every second, and neither is rounded. §11 says to
measure before writing a new representation; this is the measurement, and the
answer is that the representation is already there.

## Tempo, measured

`audio/tempo.ts` computes `secondsPerTick = 60 / (bpm * PPQ)` and `PPQ` is ticks
per quarter, so **stored BPM counts quarter notes per minute**. `midi-plan.ts`
writes `60_000_000 / bpm` microseconds per quarter — the same statement. Playback
and export therefore already agree, and no migration is needed. What is missing
is only the *reading*: in 6/8 the felt beat is the dotted quarter, so a reader
shown "132" is being shown a number that is true and not the one they count.


## What each conflict became (2V-D.2, closing)

The three above were written before anything was changed, and they are left
standing so a reader can see what was wrong rather than only that something
moved. This is what each one is now.

**1 · Bar length — still ten spellings, still agreeing.** Not fixed this round.
`timing-authority.test.ts` describe 344 asserts that every open-coded product
equals `ticksPerBar` for every metre and grid in the contract, and greps the
seven files that carry one. The duplication remains; what changed is that it
can no longer drift silently. Recorded as an open debt.

**2 · Where is the beat — one list.** `music/meter-beats.ts` answers with a
`MeterBeat[]`: slot, length and strength, derived from the bar's grouping. The
five surfaces that used to ask the scalar now ask the list — the metronome
(`audio/position.ts`), the beam guide (`tab/rhythm-guide.ts`), the beat lines
(`tab/rhythm-tail.ts`), the count-in (`practice/count-in.ts`) and the spoken
reading (`music/rhythm-language.ts`) — and describe 345 greps all five. The
scalar `slotsPerFeltBeat` still exists and is still right for the metres it can
describe; it is no longer asked where a beat is.

Two knock-on changes are worth naming because they change what the app says:

- `defaultGrouping([7, 8])` was seven single eighths and is now `[2, 2, 3]`.
- `readRhythm([7, 8], 16)` said `"7 sekizlik · 14 adım"` and now says
  `"3 ana vuruş · 14 adım"`. The old sentence was the honest one while the
  format had no field for a feel. It has one now, so saying "7 sekizlik" while
  the metronome clicks three would be the conflict again, quieter.

**3 · Grouping can be written down.** `Bar.grouping` is an optional array of
positive integers, refused by the schema unless it sums to the numerator. 5/8
felt `2+3` and felt `3+2` are now different bytes. Absent means the metre's
ordinary feel, so no song written before this changes, and no migration runs.

## What else this round measured rather than assumed

- **Bars that changed length carried their notes and lost their marks.** A
  phrase or technique span is a section-relative tick range, so shortening an
  earlier bar left it over different music. `song/timeline-transform.ts` remaps
  both in the same transaction as the bars, or refuses the whole change.
- **The Copilot's slot cap moved on its own.** `MAX_SLOTS_PER_BAR` is derived
  from `TIME_SIGNATURES × RESOLUTIONS`, so adding 12/8 took it from 32 to 48
  (twelve eighths at a 1/32 grid). The answer schema's `maxItems` follows it,
  and `copilot/mixed-grid-contract.test.ts` holds the two together.
