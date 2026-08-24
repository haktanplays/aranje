/**
 * Central limits (spec 6). Limits are never inlined elsewhere in the codebase;
 * every check reads them from here.
 *
 * A "voice" is every NoteEvent/DrumHit that starts or is still sounding at the
 * same time, which counts chords and simultaneous drum pieces correctly.
 *
 * There is deliberately no `definedTracks` and no `activeTracksPerSection`
 * limit: all eight tracks may sound in the same section.
 */
export const songLimits = {
  maxTracks: 8,
  totalBars: 32, // phase 2.5: 64
  barsPerSection: 8,
  barsPerPatch: 8,
  maxVoicesPerSlot: 32,
} as const;

/** Song-level tempo bounds (spec 5.1). */
export const bpmRange = { min: 40, max: 260 } as const;

/** Track volume bounds in dB (spec 5.2). */
export const volumeDbRange = { min: -60, max: 6 } as const;

/** MIDI velocity bounds (spec 5.4). */
export const velocityRange = { min: 1, max: 127 } as const;

/**
 * Hand-position warning thresholds (spec 10.3, K-17).
 *
 * A jump larger than this between two neighbouring onsets is unusual but
 * playable, so it is a warning and never a block. The numbers live here with
 * the other limits rather than inside the validator, so there is one place to
 * change them and no magic number scattered through the check.
 *
 * They are a visible flag for a known risk, not an ergonomic model: a real
 * placement engine that minimises hand travel is a later quality checkpoint
 * (spec 9.2, K-4).
 */
export const handPositionLimits = {
  /** Physical frets a guitarist may shift between neighbouring onsets. */
  guitarMaxShift: 7,
  /** The same for a bass, whose frets are further apart. */
  bassMaxShift: 5,
} as const;

/**
 * Ergonomic placement search (spec 9.2, K-19).
 *
 * `beamWidth` is how many partial placements the search keeps alive at each
 * onset. It lives here, with the other limits, for the same reason they do:
 * one place to change it, and no way for a deployment to quietly widen or
 * narrow the search. It is deliberately not an environment variable — the same
 * song must place the same way everywhere, including on a phone.
 *
 * 64 is wide enough that the reference width of 256 finds nothing better on
 * the fixtures (see the phase 2D report), and narrow enough that a bar of
 * dense chords stays cheap.
 */
export const placementLimits = {
  beamWidth: 64,
  /** Reference width used only by tests, to check 64 is not too narrow. */
  referenceBeamWidth: 256,
} as const;

/**
 * Session edit history (spec 5.6, 13.13, K-44).
 *
 * How many undoable transitions the session keeps. Fifty is generous enough
 * that a working session is never truncated in practice and small enough that
 * a phone is not asked to hold a hundred copies of a thirty-two bar song —
 * each snapshot is a whole `Song`, because that is what makes undo exact.
 *
 * It lives here with the other limits for the same reason they do: one place
 * to change it, and no component carrying its own opinion about how far back
 * "back" goes.
 */
export const historyLimits = {
  maxUndoSteps: 50,
} as const;

/**
 * Portable project files (spec 13.15, 2L-A).
 *
 * `maxImportBytes` is a client file-input safety bound, not a musical limit:
 * the heaviest supported Song measured 2K-B serialises to roughly 799 KB, so
 * two MiB is more than double the worst legitimate file. A byte count rather
 * than a parse attempt, because the whole point is to refuse before reading.
 *
 * `maxFileNameChars` bounds the *title-derived stem* of an exported file name.
 * Sixty is long enough for any reasonable song title and short enough that no
 * filesystem or download UI truncates it into ambiguity.
 */
export const projectFileLimits = {
  maxImportBytes: 2 * 1024 * 1024,
  maxFileNameChars: 60,
} as const;

/**
 * The mixer's own bounds (spec 13.18, 2L-C).
 *
 * The Song Contract already bounds `volumeDb` at `volumeDbRange` (-60..+6),
 * which is what a *file* may legally hold. These are the narrower bounds the
 * mixer offers a person: -60 dB is not a level anyone reaches for on a
 * slider, it is silence with extra steps, and mute is the honest control for
 * that. -24 keeps the whole usable range under the thumb.
 *
 * `step` is what one nudge moves. Bounds are enforced by the pure core;
 * the step is a control affordance and is not enforced there, because a
 * value that arrives from an imported file has every right to sit between
 * two steps.
 *
 * Mute is deliberately absent: it is an audibility decision, never
 * "volume at minus infinity" (spec 13.18 §4).
 */
export const mixerLimits = {
  volumeDb: { min: -24, max: 6, step: 0.5 },
  pan: { min: -1, max: 1, step: 0.05, center: 0 },
} as const;

/**
 * Practice speed (spec 13.8, phase 2E).
 *
 * This is a **playback** setting, not a property of the music: the song keeps
 * its own `bpm` as the tempo the piece is written at, and this scales what the
 * transport runs at. Everything is kept in whole percent so a step never lands
 * on a number nobody asked for: 100 is the song's real tempo, and the bounds
 * are wide enough to slow a fast riff right down without turning the sample
 * playback into something unrecognisable.
 */
export const practiceRateLimits = {
  minPercent: 50,
  maxPercent: 150,
  stepPercent: 5,
  defaultPercent: 100,
} as const;

/**
 * Audio and MIDI export (spec 13.19, phase 2M-A).
 *
 * `sampleRate` and `bitDepth` are the contract of the file that leaves the
 * app, not a rendering preference: a listener's player has to accept it
 * everywhere, and 44.1 kHz / 16-bit PCM is the format that does.
 *
 * `tailSeconds` is the one place the render knows to keep going after the
 * last written note. A sample decays, a release envelope finishes, and a
 * fixed guess in a component would cut whichever song happened to end on a
 * long ring. It is stated once here and derived from the engine's own
 * longest release, so a change to the instruments moves it in one edit.
 */
export const audioExportLimits = {
  sampleRate: 44100,
  bitDepth: 16,
  channels: 2,
  maxChannels: 2,
  tailSeconds: 3,
} as const;

/**
 * Chord voicing search (spec 13.22, phase 2O-B).
 *
 * What a hand can hold, and how much of the search a reader is shown. These
 * are the numbers a component would otherwise carry as literals — a "4 fret
 * stretch" typed into a sheet is a second definition of playable, and the two
 * would disagree the first time one moved.
 *
 * `maxFretSpan` counts fretted notes only: an open string is held by the other
 * hand and costs no stretch, which is why an open chord can reach across the
 * neck and a barre chord cannot. Two is where a shape stops being a chord
 * shape and starts being a stretch, and it is not a guess: every one of the
 * eleven qualities, at all twelve roots, still has playable shapes on standard
 * tuning, Drop D, capo 2, DADGAD and a four-string bass — 660 combinations,
 * none of them emptied by the limit. Both fifth-position A minor sevenths fit
 * inside it, spanning two frets and none.
 *
 * `maxInteriorSkips` is one because real shapes need exactly that much: the
 * fifth-position A minor 7 played `5 x 5 5 5 x` skips one inner string and is
 * an ordinary thing to play. Two or more inner skips start to describe shapes
 * a hand cannot mute cleanly, and the search does not offer them.
 *
 * `maxVariations` and `maxPerRegion` are about the reader rather than the
 * hand: four cards is what a phone can show without a scroll, and two from the
 * same neck position is where a list stops teaching and starts listing.
 */
export const voicingLimits = {
  maxFretSpan: 2,
  maxInteriorSkips: 1,
  maxVariations: 4,
  maxPerRegion: 2,
  /** A chord needs at least this many sounding strings to be one. */
  minNotes: 2,
} as const;

/**
 * Chord voicings for instruments with no fretboard (spec 13.22, phase 2O-B).
 *
 * **These are not an instrument's range.** Aranje deliberately has no numeric
 * range for a piano, an organ, a synth or a string section: `range.ts` defers
 * them rather than inventing bounds, and this checkpoint does not overturn
 * that decision. What is written here is about *writing*, not about playing.
 *
 * `lowestMidi` and `highestMidi` are the pitches the Song Contract can spell
 * at all — scientific pitch notation runs from octave -1 to octave 9, and
 * anything outside that cannot be written down whatever instrument is holding
 * it.
 *
 * There is deliberately **no** "register span" limit here. One was written and
 * then removed: an inversion lifts the lowest note by exactly an octave, so
 * every inversion of a V1 chord already sits within an octave and a seventh of
 * the note the reader picked, and a ceiling measured against all eleven
 * qualities at all twelve roots in every writable octave cut none of the 4,040
 * stacks. Keeping it would have meant carrying a number that decided nothing.
 */
export const keyboardVoicingLimits = {
  lowestMidi: 0,
  highestMidi: 127,
  maxVariations: 4,
} as const;

/**
 * Hearing a chord before choosing it (spec 13.22 §16, phase 2O-B).
 *
 * `referenceVoices` is how many notes an audition is scaled against: at or
 * below it nothing changes, and above it the preview is quietened in
 * proportion so six strings do not clip where one note did not.
 *
 * This is a **preview-only** number. It never reaches the velocity written
 * into a Song, the mixer, or an exported file — an audition that flattered
 * the chord would be telling the reader something the song does not say.
 */
export const chordPreviewLimits = {
  referenceVoices: 3,
} as const;
