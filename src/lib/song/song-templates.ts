/**
 * Launch templates for a new song (spec 13.17, 2L-B §4).
 *
 * One table. Every musical default a new song starts from — title, key,
 * tempo, meter, grid, section shape — is written here once, and the three
 * templates differ only in which instruments they stand up. No component
 * carries an instrument id, a preset id or a BPM of its own; a sheet that
 * wants to offer templates asks for this list and shows the labels.
 *
 * Everything about an instrument is *resolved from the registry* at
 * materialisation: the preset is the instrument's first core preset **that
 * can actually be heard**, the tuning (and with it the string count) is the
 * registry's default tuning preset, and the capo starts at zero. The table
 * names instruments; the registry says what they are.
 *
 * The audibility filter is not a musical preference (2O-B.1 §2). Until this
 * checkpoint the choice was simply the first core preset, which for an
 * electric guitar is `clean` — a preset with no vendored sample pack behind
 * it — so `empty` and `rock_band` handed a new reader a guitar that made no
 * sound at all. A launch template exists to give somebody something to play
 * with, and a silent first track fails at exactly that. `clean` keeps its
 * meaning and its place in the registry; it is simply not something a
 * template may choose while nothing is vendored for it.
 *
 * Deterministic by construction: no timestamp, no UUID, no randomness —
 * materialising the same template five times yields byte-identical songs.
 *
 * ## Why the bars carry keys, and empty ones
 *
 * Until 2O-B.1 a template's bars carried no track keys at all, on the
 * reasoning that a missing key *is* silence (spec 5.5) while an empty slot
 * array is a claim the track plays nothing there. Both halves of that are
 * true, and the conclusion was still wrong for a template.
 *
 * A missing key does not only mean silence. It also means *this track is not
 * written in this bar*, and the write path refuses a note there — "«Ritim
 * Gitar» bu barda yazılı değil; önce bu bara eklenmeli". The browser
 * acceptance run found what that costs: a brand-new song could not receive
 * its first note at all, from any surface, because nothing anywhere adds a
 * track to a bar. Every seed the evaluation harnesses use writes its slot
 * arrays out in full, so the gap had never been exercised.
 *
 * A template's own tracks are written in a template's own bars. The empty
 * array is the accurate statement: this lane exists here and currently plays
 * nothing. Drum tracks get the drum slot shape, because the two shapes are
 * different things (spec 5.4).
 */
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { playableCorePresets } from "@/lib/audio/preset-availability";
import { getInstrument, isDrumInstrument } from "@/lib/instruments/registry";
import { nextNumberedId } from "@/lib/song/lifecycle-ids";
import { slotCount } from "@/lib/music/timing";
import type {
  Bar,
  DrumSlot,
  MelodicSlot,
  Song,
  TimeSignature,
  Track,
} from "@/lib/song/schema";
import type { Resolution } from "@/lib/music/timing";

/** The defaults every template shares (spec 2L-B §4). */
export const TEMPLATE_DEFAULTS = {
  title: "Yeni Şarkı",
  key: "E minor",
  bpm: 120,
  timeSignature: [4, 4] as TimeSignature,
  resolution: 16 as Resolution,
  sectionName: "Bölüm 1",
  barCount: 4,
} as const;

/**
 * Where a brand-new track's volume starts.
 *
 * The schema requires a volume even though this checkpoint shows no volume
 * control (mixer is 2L-C); −6 dB is what every track of the demo song sits
 * at, so a created track is neither louder nor quieter than the music
 * around it.
 */
export const DEFAULT_TRACK_VOLUME_DB = -6;

export type SongTemplateId = "empty" | "rock_band" | "acoustic";

export type SongTemplate = {
  readonly id: SongTemplateId;
  readonly label: string;
  /** What the reader is choosing, in one sentence. */
  readonly description: string;
  /** Instrument and reader-facing name of each track, in track order. */
  readonly trackPlans: readonly {
    readonly instrumentId: string;
    readonly name: string;
  }[];
};

export const SONG_TEMPLATES: readonly SongTemplate[] = [
  {
    id: "empty",
    label: "Boş başlangıç",
    description: "Tek ritim gitarıyla sessiz bir başlangıç.",
    trackPlans: [{ instrumentId: "electric_guitar", name: "Ritim Gitar" }],
  },
  {
    id: "rock_band",
    label: "Rock grubu",
    description: "Ritim gitarı, bas ve davulla klasik üçlü.",
    trackPlans: [
      { instrumentId: "electric_guitar", name: "Ritim Gitar" },
      { instrumentId: "electric_bass", name: "Bas" },
      { instrumentId: "drum_kit", name: "Davul" },
    ],
  },
  {
    id: "acoustic",
    label: "Akustik",
    description: "Tek çelik telli akustik gitar.",
    trackPlans: [{ instrumentId: "steel_acoustic", name: "Akustik Gitar" }],
  },
];

export function getSongTemplate(id: string): SongTemplate | undefined {
  return SONG_TEMPLATES.find((template) => template.id === id);
}

/**
 * One track, entirely from the registry.
 *
 * Returns null when the registry cannot answer — an unknown instrument, an
 * instrument with no core preset that can be heard, or a fretted instrument
 * whose default tuning preset is missing. A template that trips this is a
 * broken table, and the caller refuses rather than guessing: a template that
 * cannot be made audible is not quietly materialised anyway.
 */
function materializeTrack(
  plan: SongTemplate["trackPlans"][number],
  id: string,
): Track | null {
  const instrument = getInstrument(plan.instrumentId);
  const preset = playableCorePresets(plan.instrumentId)[0];
  if (!instrument || !preset) return null;

  const base: Track = {
    id,
    name: plan.name,
    instrumentId: instrument.id,
    presetId: preset.id,
    volumeDb: DEFAULT_TRACK_VOLUME_DB,
  };
  if (isDrumInstrument(instrument.id)) return base;

  const tuningPresetId = instrument.defaultTuningPresetId;
  const tuningPreset = tuningPresetId ? TUNING_PRESETS[tuningPresetId] : undefined;
  // A melodic instrument without a default tuning (piano, synth) has no
  // fretboard — that is a statement, not a gap to fill in.
  if (!tuningPreset) return base;
  return { ...base, fretboard: { tuning: [...tuningPreset.tuning], capo: 0 } };
}

/**
 * The whole song a template stands for, or null when the table and the
 * registry disagree (which is a bug the tests catch, not a runtime path).
 */
export function materializeTemplate(templateId: string): Song | null {
  const template = getSongTemplate(templateId);
  if (!template) return null;

  const tracks: Track[] = [];
  for (const plan of template.trackPlans) {
    const track = materializeTrack(
      plan,
      nextNumberedId(tracks.map((t) => t.id), "track"),
    );
    if (!track) return null;
    tracks.push(track);
  }

  const count = slotCount(TEMPLATE_DEFAULTS.timeSignature, TEMPLATE_DEFAULTS.resolution);
  const bars: Bar[] = Array.from({ length: TEMPLATE_DEFAULTS.barCount }, () => {
    const slots: Bar["slots"] = {};
    for (const track of tracks) {
      slots[track.id] = isDrumInstrument(track.instrumentId)
        ? Array.from({ length: count }, (): DrumSlot => [])
        : Array.from({ length: count }, (): MelodicSlot => null);
    }
    return {
      timeSignature: TEMPLATE_DEFAULTS.timeSignature,
      resolution: TEMPLATE_DEFAULTS.resolution,
      slots,
    };
  });

  return {
    version: 2,
    title: TEMPLATE_DEFAULTS.title,
    bpm: TEMPLATE_DEFAULTS.bpm,
    key: TEMPLATE_DEFAULTS.key,
    tracks,
    sections: [
      {
        id: nextNumberedId([], "section"),
        name: TEMPLATE_DEFAULTS.sectionName,
        status: "fixed",
        bars,
      },
    ],
  };
}
