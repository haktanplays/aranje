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
  totalBars: 16, // phase 2.5: 64
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
