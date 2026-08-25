/**
 * The files the 2Q-B acceptance opens (§15).
 *
 * Two of the three fixtures here are *files*, not seeded storage, and that is
 * the whole point. The pitched surface is reachable in production only by
 * opening a project that already contains a fretless track — `create_track`
 * refuses those instruments, because none of them has a sound yet — so an
 * acceptance run that seeded such a track straight into `localStorage` would
 * be proving the surface works on a device state no reader can produce.
 *
 * So the pitched fixture is written as a real `.aranje.json`, through the
 * production exporter, and the harness opens it through the production
 * import flow: picker, preview, apply. If the export gate would refuse it,
 * this script fails rather than writing a file the app cannot read.
 *
 *   npx tsx eval/cross-instrument/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { exportProject } from "@/lib/project/project-file";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { slotCount, type Resolution } from "@/lib/music/timing";
import {
  songSchema,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Song,
  type TimeSignature,
  type Track,
} from "@/lib/song/schema";
import { errorsOnly, runValidators } from "@/lib/validators";

const OUT = "eval/cross-instrument/fixtures";
mkdirSync(OUT, { recursive: true });

const E_STANDARD = [...TUNING_PRESETS.e_standard!.tuning];

const guitar = (): Track => ({
  id: "gtr",
  name: "Ritim Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: [...E_STANDARD], capo: 0 },
});

const drums = (): Track => ({
  id: "drums",
  name: "Davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -6,
});

/** A fretless instrument, exactly as one arrives in somebody's project file. */
const keys = (): Track => ({
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
});

const SIG: TimeSignature = [4, 4];
const RES: Resolution = 8;
const COUNT = slotCount(SIG, RES);

const rests = (): MelodicSlot[] => Array.from({ length: COUNT }, () => null);
const silentKit = (): DrumSlot[] => Array.from({ length: COUNT }, () => []);

/** A bar carrying exactly the lanes it is given, and no others. */
function bar(slots: Bar["slots"]): Bar {
  return { timeSignature: [...SIG] as TimeSignature, resolution: RES, slots };
}

function song(title: string, tracks: readonly Track[], bars: readonly Bar[]): Song {
  const candidate = {
    version: 2 as const,
    title,
    bpm: 120,
    key: "E minor",
    tracks: tracks.map((track) => ({ ...track })),
    sections: [
      { id: "verse", name: "Verse", status: "fixed" as const, bars: bars.map((entry) => entry) },
      { id: "chorus", name: "Chorus", status: "fixed" as const, bars: bars.map((entry) => entry) },
    ],
  };
  const parsed = songSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`${title}: schema refused it`);
  const issues = errorsOnly(runValidators(parsed.data));
  if (issues.length > 0) {
    throw new Error(`${title}: ${issues.map((issue) => issue.code).join(", ")}`);
  }
  return parsed.data;
}

/**
 * A project with a pitched track that has never been written in, plus one
 * that has. Both states matter: the first is the K-55 case (a lane that does
 * not exist yet), the second is the one where a note can be replaced.
 */
const pitched = song(
  "Piyano Taslak",
  [guitar(), keys()],
  [
    bar({ gtr: rests() }),
    bar({ gtr: rests(), keys: rests() }),
  ],
);

/**
 * A song with no kit at all.
 *
 * The kit tour adds one through the track manager, so it has to start from a
 * song that does not already have one — otherwise "a kit exists now" would be
 * true before the tour did anything.
 */
const plain = song("Tek Gitar", [guitar()], [bar({ gtr: rests() }), bar({ gtr: rests() })]);

/** A kit that is silent everywhere: something to write the first hit into. */
const kit = song(
  "Davul Taslak",
  [guitar(), drums()],
  [bar({ gtr: rests(), drums: silentKit() }), bar({ gtr: rests(), drums: silentKit() })],
);

for (const [name, candidate] of [
  ["pitched", pitched],
  ["kit", kit],
] as const) {
  const exported = exportProject(candidate);
  if (!exported.ok) throw new Error(`${name}: export refused it (${exported.code})`);
  writeFileSync(`${OUT}/${name}.aranje.json`, exported.text);
  console.log(`${name}.aranje.json — ${exported.text.length} bayt`);
}

/* The kit song is also seeded directly, for the scenarios that are about the
   grid rather than about how the project arrived. */
writeFileSync(
  `${OUT}/songs.json`,
  `${JSON.stringify({ pitched, kit, plain }, null, 2)}\n`,
);
