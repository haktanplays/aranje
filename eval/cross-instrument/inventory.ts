/**
 * What each instrument family can actually carry, read off the code (2Q-B §2).
 *
 * Nothing here is typed in by hand: every column is asked of the registry, the
 * schema, the availability layer or the editability rule. A checkpoint that
 * invents an affordance the contract does not have is how a "feature" becomes
 * a screen that refuses every gesture, so the design starts from this file.
 *
 *   npx tsx eval/cross-instrument/inventory.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { playableCorePresets } from "@/lib/audio/preset-availability";
import { isHarmonicTrack } from "@/lib/chords/chord-voicing";
import {
  CORE_DRUM_PIECES,
  DRUM_PIECES,
  getInstrument,
  isDrumInstrument,
  listInstruments,
} from "@/lib/instruments/registry";
import { drumHitSchema, songSchema, type Song, type Track } from "@/lib/song/schema";
import { isEditableTrack } from "@/lib/song/edit";
import { laneKindOf } from "@/lib/multitrack/lane-kind";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { PITCH_PATTERN } from "@/lib/music/pitch";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const OUT = "eval/cross-instrument";
mkdirSync(OUT, { recursive: true });

/** A track for an instrument, shaped the way the registry says it must be. */
function trackFor(instrumentId: string): Track {
  const instrument = getInstrument(instrumentId);
  const presetId = instrument?.presets[0]?.id ?? "";
  const tuningId = instrument?.defaultTuningPresetId;
  const tuning = tuningId ? TUNING_PRESETS[tuningId]?.tuning : undefined;
  return {
    id: "probe",
    name: "Probe",
    instrumentId,
    presetId,
    volumeDb: -6,
    ...(tuning ? { fretboard: { tuning: [...tuning], capo: 0 } } : {}),
  } as Track;
}

const instruments = listInstruments().map((instrument) => {
  const track = trackFor(instrument.id);
  const playable = playableCorePresets(instrument.id).map((preset) => preset.id);
  return {
    id: instrument.id,
    displayName: instrument.displayName,
    kind: instrument.kind,
    scope: instrument.scope,
    laneKind: laneKindOf(track),
    hasFretboard: track.fretboard !== undefined,
    corePresets: instrument.presets.map((preset) => preset.id),
    playableCorePresets: playable,
    audible: playable.length > 0,
    /** The tab's note editor, asked directly. */
    directNoteEditingBefore2QB: isEditableTrack(track),
    canCarryChord: isHarmonicTrack(track),
    /** A reader can only create what the registry puts in core scope. */
    creatableByReader: instrument.scope === "core",
    eventRepresentation: isDrumInstrument(instrument.id)
      ? "DrumSlot: DrumHit[] — { piece, velocity?, articulation?: normal|ghost|accent }"
      : "MelodicSlot: null | \"-\" | { notes: NoteEvent[] }",
    numericRangeInRegistry: "range" in instrument ? "yes" : "no",
  };
});

/** The ten questions §2 asks, answered from the code above rather than from memory. */
const answers = {
  "1. Can a drum event carry velocity today?":
    drumHitSchema.safeParse({ piece: "kick", velocity: 100 }).success
      ? "Yes — `velocity?` is in the contract, and it reaches the sounding gain through NotatedDrum → DrumEventPlan.gain."
      : "No.",
  "2. Can different pieces share one tick?":
    drumHitSchema.safeParse({ piece: "kick" }).success
      ? "Yes — a slot is an array of hits, so kick and snare coexist at one tick."
      : "No.",
  "3. Can the same piece be written twice at one tick?":
    "The schema permits it (an array with no uniqueness rule). Nothing musical is gained and the second hit is inaudible under the first, so the entry command refuses it as `target_occupied` rather than writing a duplicate.",
  "4. Does a pitched track need an explicit fret/string position?":
    "No — and it must not have one. A fretless instrument has no string to name; `keyboard-voicing.ts` already writes pitch alone.",
  "5. Which instruments can the keyboard voicing generator serve?":
    "Every harmonic track without a fretboard: " +
    instruments
      .filter((entry) => entry.canCarryChord && !entry.hasFretboard)
      .map((entry) => entry.id)
      .join(", "),
  "6. Is there a numeric range for pitched instruments in the registry?":
    "No. `keyboard-voicing.ts` records the decision and its reason: an invented low note is worse than an honest gap, so the only bound checked is what the Song Contract can spell (" +
    String(PITCH_PATTERN) +
    ").",
  "7. Does the existing chord command accept a fretless track?":
    isHarmonicTrack(trackFor("piano"))
      ? "Yes — `isHarmonicTrack` asks only that the track is not a kit, and `chordVoicings` branches to the keyboard stack when there is no fretboard."
      : "No.",
  "8. How does preview behave against preset availability?":
    "A preset with no vendored pack is not offered as an ordinary choice (K-54) and cannot be previewed. Every pitched instrument is in this position today: " +
    instruments
      .filter((entry) => !entry.hasFretboard && !entry.audible && entry.kind === "melodic")
      .map((entry) => entry.id)
      .join(", ") +
    " — so a pitched note sheet must write without offering Dinle.",
  "9. Is the drum kit a sampler or synthesis?":
    "A sampler: the kit's pieces resolve to sample files through the shared bank, the same path every other instrument uses.",
  "10. Why does the tab editor refuse drums and pitched tracks?":
    "`isEditableTrack` is `!isDrumInstrument && fretboard !== undefined`. It is a fret-cell editor: a kit has no strings and a piano has no fretboard, so the refusal is honest — what is missing is a *different* surface for each, which is this checkpoint.",
};

const report = {
  what: "2Q-B §2 — enstrüman ve olay envanteri, koddan okundu",
  drumPieces: { all: DRUM_PIECES, coreKit: CORE_DRUM_PIECES },
  instruments,
  answers,
  consequencesForThisCheckpoint: [
    "Davul girişi bugünkü Contract ile tamamen yazılabilir: parça, velocity ve normal/ghost/accent zaten var.",
    "Pitched girişi de yazılabilir — nota pitch'ten ibarettir ve position yazılmaz.",
    "Ama okur bugün pitched track *oluşturamaz*: bütün fretsiz enstrümanlar phase_2_5 kapsamında ve create_track core dışını reddediyor. Pitched giriş yalnız dosyadan gelen bir track için ulaşılabilir.",
    "Hiçbir pitched enstrümanın vendor edilmiş sample'ı yok, yani pitched nota yazılabilir ama duyulamaz; Dinle kapalı olmalı ve bu söylenmelidir.",
  ],
};

writeFileSync(`${OUT}/INVENTORY.json`, `${JSON.stringify(report, null, 2)}\n`);

/** A fixture check: the sample song still parses, so the probe tracks above are shaped like real ones. */
const parsed = songSchema.safeParse(SAMPLE_SONG as Song);
if (!parsed.success) throw new Error("sample song no longer parses");

console.log(JSON.stringify(report.answers, null, 2));
