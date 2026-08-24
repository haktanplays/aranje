/**
 * What the app does about chords *before* 2O-B (§1).
 *
 * Run against production code, changing nothing. Its job is to record the
 * starting point honestly — including the two places where this checkpoint's
 * brief and the codebase's standing decisions do not line up, so neither is
 * discovered halfway through and quietly worked around.
 *
 *   npx tsx eval/chord/baseline.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import {
  bass,
  capoGuitar,
  dadgadGuitar,
  drums,
  dropDGuitar,
  guitar,
  piano,
  songOf,
  stringsEnsemble,
  synth,
} from "./fixtures";

import { samplePackFor } from "@/lib/audio/packs";
import {
  coreInstruments,
  listInstruments,
} from "@/lib/instruments/registry";
import { candidateVoicings } from "@/lib/music/voicing";
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";
import { applyEdit, isEditableTrack } from "@/lib/song/edit";
import { rangeSupportFor } from "@/lib/validators/range";
import { errorsOnly, runValidators } from "@/lib/validators";
import { songSchema, type NoteEvent, type Track } from "@/lib/song/schema";

const OUT = "eval/chord/artifacts";
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------ what a track can do today */

const TRACKS: readonly { label: string; track: Track }[] = [
  { label: "electric_guitar", track: guitar() },
  { label: "electric_bass", track: bass() },
  { label: "piano", track: piano() },
  { label: "synth", track: synth() },
  { label: "strings", track: stringsEnsemble() },
  { label: "drum_kit", track: drums() },
];

const trackAbilities = TRACKS.map(({ label, track }) => {
  const support = rangeSupportFor(track);
  return {
    instrumentId: label,
    hasFretboard: track.fretboard !== undefined,
    /** Whether the tab editor will accept an edit on this track at all. */
    editableInTab: isEditableTrack(track),
    rangeSupport: support.kind,
    /** Whether a reader can put this instrument in a song from the UI. */
    offeredInTrackManager: coreInstruments().some(
      (entry) => entry.id === track.instrumentId,
    ),
    samplePack: samplePackFor(track.instrumentId, track.presetId)?.id ?? null,
  };
});

/* --------------------------------------- writing a chord the hard way, today */

/**
 * The only way to get Am7 into a song right now: five separate single-note
 * edits, each its own command, each its own commit at the caller.
 */
const AM7_OPEN: readonly { string: number; fret: number }[] = [
  { string: 1, fret: 0 },
  { string: 2, fret: 2 },
  { string: 3, fret: 0 },
  { string: 4, fret: 1 },
  { string: 5, fret: 0 },
];

function writeAm7TheHardWay() {
  let song = songOf([guitar()]);
  const edits: string[] = [];
  for (const spot of AM7_OPEN) {
    const result = applyEdit(song, {
      kind: "set_note",
      target: { sectionId: "s1", trackId: "gtr", barIndex: 0, slotIndex: 0 },
      stringIndex: spot.string,
      fret: spot.fret,
    });
    if (!result.ok) {
      edits.push(`FAILED ${spot.string}/${spot.fret}: ${result.error.code}`);
      break;
    }
    song = result.song;
    edits.push(`ok ${spot.string}/${spot.fret}`);
  }
  const slot = song.sections[0]?.bars[0]?.slots.gtr?.[0];
  const notes =
    slot && !Array.isArray(slot) && slot !== null && slot !== "-" ? slot.notes : [];
  return {
    commandsNeeded: edits.length,
    edits,
    pitches: notes.map((note) => note.pitch),
  };
}

/* ------------------------------- what the existing search already knows how to do */

/** The existing enumerator, handed the five sounding pitches of open Am7. */
function existingSearchOnAm7() {
  const board = { tuning: guitar().fretboard!.tuning, capo: 0 };
  const notes: NoteEvent[] = ["A2", "E3", "A3", "C4", "E4"].map((pitch) => ({
    pitch,
  }));
  const result = candidateVoicings(board, notes);
  return {
    kind: result.kind,
    count: result.kind === "placed" ? result.voicings.length : 0,
    first:
      result.kind === "placed"
        ? result.voicings[0]?.notes.map((note) => `${note.stringIndex}:${note.fret}`)
        : null,
    note: "candidateVoicings needs concrete pitches; it does not know a chord formula",
  };
}

/* ------------------------------------------- can a keyboard song even validate? */

function keyboardSongState() {
  const song = songOf([piano()]);
  const withNotes = structuredClone(song);
  const slots = withNotes.sections[0]!.bars[0]!.slots.piano as unknown[];
  slots[0] = {
    notes: [{ pitch: "C4" }, { pitch: "E4" }, { pitch: "G4" }, { pitch: "B4" }],
  };
  const parsed = songSchema.safeParse(withNotes);
  return {
    schemaAccepts: parsed.success,
    validatorErrors: parsed.success
      ? errorsOnly(runValidators(parsed.data)).map((issue) => issue.code)
      : ["schema_failed"],
    editorAccepts: isEditableTrack(piano()),
  };
}

/* ------------------------------------------------------ tunings, as they sound */

function openStrings(track: Track) {
  const board = track.fretboard;
  if (!board) return null;
  return board.tuning.map((pitch, index) => {
    const midi = pitchToMidi(pitch);
    return {
      stringIndex: index,
      written: pitch,
      soundingAtFret0:
        midi === null ? null : midiToPitch(midi + board.capo),
    };
  });
}

const baseline = {
  measuredOn: "desktop Node — not a phone, and not evidence about one",
  question: "what does Aranje do about chords before 2O-B?",
  trackAbilities,
  writingAm7Today: writeAm7TheHardWay(),
  existingSearch: existingSearchOnAm7(),
  keyboardSong: keyboardSongState(),
  tunings: {
    standard: openStrings(guitar()),
    drop_d: openStrings(dropDGuitar()),
    capo_2: openStrings(capoGuitar(2)),
    dadgad: openStrings(dadgadGuitar()),
    bass: openStrings(bass()),
  },
  registry: {
    all: listInstruments().map((entry) => entry.id),
    core: coreInstruments().map((entry) => entry.id),
    packs: listInstruments().flatMap((entry) =>
      entry.presets
        .map((preset) => samplePackFor(entry.id, preset.id)?.id)
        .filter((id): id is string => id !== undefined),
    ),
  },
  /*
   * Two places where this checkpoint's brief meets a standing decision in the
   * codebase. Recorded before any production code is touched, so the report
   * can say what was found rather than what was assumed.
   */
  contradictions: [
    {
      id: "no_numeric_range_for_non_fretted",
      brief: "2O-B §7/§10: keyboard voicings must stay inside the track range",
      codebase:
        "range.ts deliberately defers non-fretted instruments: 'a range is " +
        "not something to invent'. There is no numeric range for piano, " +
        "electric piano, organ, synth or strings anywhere in the repo.",
    },
    {
      id: "no_editing_surface_for_non_fretted",
      brief: "2O-B §7/§26: piano, synth and strings chord scenarios in the UI",
      codebase:
        "isEditableTrack() requires a fretboard, the tab draws string rows, " +
        "and the track manager only offers core instruments — so a reader " +
        "cannot create, see or edit a keyboard track today.",
    },
  ],
};

writeFileSync(`${OUT}/BASELINE.json`, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(JSON.stringify(baseline, null, 2));
