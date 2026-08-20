/**
 * The style card examples as playable songs (spec 11.7).
 *
 * The cards carry their examples in the narrow `arrange_track` output shape,
 * which is a patch and not a song. To hear one, it needs a song to be applied
 * to: the right kind of track, the right number of bars, in the key the cards
 * are written in.
 *
 * The host is built from Core Lite instruments that already have sample packs
 * (spec 7.1), so nothing new is vendored and no synth stands in for anything.
 *
 * Pure: the card bodies are passed in. The offline renderer runs in a browser
 * and cannot read a file, so whoever has the filesystem reads them.
 */
import { applyPatch } from "@/lib/copilot/apply";
import { modelPatchSchema, type ModelPatch } from "@/lib/copilot/contract";
import { STYLE_CARD_IDS, extractExamples } from "@/lib/copilot/style-cards";
import { songSchema, type Bar, type Song, type Track } from "@/lib/song/schema";

const GUITAR_TUNING = ["E2", "A2", "D3", "G3", "B3", "E4"];
const BASS_TUNING = ["E1", "A1", "D2", "G2"];

/** The three tracks the cards' examples aim at, as real Core Lite voices. */
const HOST_TRACKS: readonly Track[] = [
  {
    id: "ornek-gitar",
    name: "Ornek gitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    volumeDb: -6,
    fretboard: { tuning: [...GUITAR_TUNING], capo: 0 },
  },
  {
    id: "ornek-bas",
    name: "Ornek bas",
    instrumentId: "electric_bass",
    presetId: "finger",
    volumeDb: -5,
    fretboard: { tuning: [...BASS_TUNING], capo: 0 },
  },
  {
    id: "ornek-davul",
    name: "Ornek davul",
    instrumentId: "drum_kit",
    presetId: "rock",
    volumeDb: -4,
  },
];

export type StyleExample = {
  /** File-safe identity, used for the WAV name. */
  id: string;
  cardId: string;
  /** 1-based, as the report names them. */
  exampleIndex: number;
  targetTrackId: string;
  song: Song;
};

function hostSong(patch: ModelPatch): Song {
  const bars: Bar[] = patch.bars.map(() => ({
    timeSignature: [4, 4],
    resolution: 8,
    slots: {},
  }));

  const parsed = songSchema.safeParse({
    version: 2,
    title: "Stil karti ornegi",
    bpm: 110,
    key: "E minor",
    tracks: HOST_TRACKS,
    sections: [{ id: patch.sectionId, name: "Ornek", status: "fixed", bars }],
  });
  if (!parsed.success) throw new Error("style example host does not parse");
  return parsed.data;
}

/** Every card example, in card then example order, as a playable song. */
export function styleExampleSongs(
  bodies: Readonly<Record<string, string>>,
): StyleExample[] {
  const examples: StyleExample[] = [];

  for (const cardId of STYLE_CARD_IDS) {
    const body = bodies[cardId];
    if (body === undefined) continue;
    extractExamples(body).forEach((raw, index) => {
      const patch = modelPatchSchema.parse(raw);
      const applied = applyPatch(hostSong(patch), { id: "ornek", ...patch });
      if (!applied.ok) throw new Error(`${cardId} example ${index + 1} does not apply`);
      examples.push({
        id: `${cardId}-${index + 1}`,
        cardId,
        exampleIndex: index + 1,
        targetTrackId: patch.targetTrackId,
        song: applied.song,
      });
    });
  }

  return examples;
}
