/**
 * The articulation matrix, read out of the code (2P-A §8).
 *
 * The *names* of the techniques come from the checkpoint's own brief, which
 * lists what is to be evaluated. Everything else — whether the Song Contract
 * carries it, whether a reader can write it, whether the tab draws it,
 * whether playback does anything with it, whether MIDI carries it — is
 * answered by asking the production modules, not by remembering.
 *
 * That distinction is the point of the section. A hand-written inventory of
 * what the app supports is a list of what somebody believed on the day they
 * wrote it, and this one has to survive being wrong.
 *
 *   npx tsx eval/expression-benchmark/matrix.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { articulationMark } from "@/components/workspace/ArticulationGlyph";
import {
  EXPRESSIVE_ARTICULATIONS,
  isExpressive,
  movesPitch,
  needsPrevious,
} from "@/lib/audio/expression";
import { isChainArticulation } from "@/lib/song/articulation-roles";
import { articulationSchema, type Articulation } from "@/lib/song/schema";
import { articulationLabel } from "@/lib/validators";

const OUT = "eval/expression-benchmark";
mkdirSync(OUT, { recursive: true });

/** Every articulation the one enum admits. Read from the schema itself. */
const CONTRACT: readonly Articulation[] = articulationSchema.options;

/**
 * Whether the riff editor offers this articulation to a reader.
 *
 * Asked of the component's own source rather than of a copy of its list: the
 * question is what the sheet actually renders.
 */
const EDITOR_SOURCE = readFileSync("src/components/workspace/FretSheet.tsx", "utf8");
const CHORD_SHEET_SOURCE = readFileSync(
  "src/components/workspace/ChordBuilderSheet.tsx",
  "utf8",
);
const MIDI_SOURCE = readFileSync("src/lib/export/midi-plan.ts", "utf8");

/** What MIDI export carries. One answer for every articulation, from one place. */
const MIDI_CARRIES_ARTICULATIONS = /articulation/.test(
  MIDI_SOURCE.split("*/").slice(1).join("*/"),
);

type Layer =
  | "note_attack"
  | "picking_gesture"
  | "pitch_gesture"
  | "note_connection"
  | "technique_span"
  | "ornament"
  | "notation_only";

type Family = "guitar_bass" | "drums" | "keyboard" | "strings";

type Row = {
  technique: string;
  family: Family;
  /** The enum member, when the contract has one at all. */
  contractName: Articulation | null;
  inSongContract: boolean;
  writableInUi: boolean;
  drawnInTab: boolean;
  heardInPlayback: boolean;
  carriedToMidi: boolean;
  heardInWav: boolean;
  /** Which layer of a v2 contract this belongs in. */
  layer: Layer;
  combinable: boolean;
  legacyMigration: string;
  priority: "launch" | "near_term" | "later";
};

/** The techniques the brief asks about, in the order it asks about them. */
const BRIEF: readonly { technique: string; family: Family; contractName?: Articulation; layer: Layer; combinable: boolean; priority: Row["priority"] }[] = [
  { technique: "normal", family: "guitar_bass", contractName: "normal", layer: "note_attack", combinable: false, priority: "launch" },
  { technique: "accent", family: "guitar_bass", contractName: "accent", layer: "note_attack", combinable: true, priority: "launch" },
  { technique: "heavy accent", family: "guitar_bass", layer: "note_attack", combinable: true, priority: "near_term" },
  { technique: "staccato", family: "guitar_bass", contractName: "staccato", layer: "note_attack", combinable: true, priority: "launch" },
  { technique: "sustain / let ring (nota)", family: "guitar_bass", contractName: "sustain", layer: "note_attack", combinable: true, priority: "launch" },
  { technique: "palm mute", family: "guitar_bass", contractName: "palm_mute", layer: "technique_span", combinable: true, priority: "launch" },
  { technique: "let ring (span)", family: "guitar_bass", layer: "technique_span", combinable: true, priority: "near_term" },
  { technique: "ghost note", family: "guitar_bass", layer: "note_attack", combinable: true, priority: "near_term" },
  { technique: "dead note", family: "guitar_bass", layer: "note_attack", combinable: true, priority: "near_term" },
  { technique: "upstroke / downstroke", family: "guitar_bass", layer: "picking_gesture", combinable: true, priority: "near_term" },
  { technique: "natural harmonic", family: "guitar_bass", layer: "note_attack", combinable: false, priority: "later" },
  { technique: "artificial harmonic", family: "guitar_bass", layer: "note_attack", combinable: false, priority: "later" },
  { technique: "pinch harmonic", family: "guitar_bass", layer: "note_attack", combinable: true, priority: "later" },
  { technique: "tapping", family: "guitar_bass", layer: "note_attack", combinable: false, priority: "later" },
  { technique: "left-hand tapping", family: "guitar_bass", layer: "note_attack", combinable: false, priority: "later" },
  { technique: "hammer-on", family: "guitar_bass", contractName: "hammer_on", layer: "note_connection", combinable: true, priority: "launch" },
  { technique: "pull-off", family: "guitar_bass", contractName: "pull_off", layer: "note_connection", combinable: true, priority: "launch" },
  { technique: "legato slide", family: "guitar_bass", contractName: "slide", layer: "note_connection", combinable: true, priority: "launch" },
  { technique: "shift slide", family: "guitar_bass", layer: "note_connection", combinable: true, priority: "near_term" },
  { technique: "slide-in below", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "slide-in above", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "slide-out down", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "slide-out up", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "bend (half)", family: "guitar_bass", contractName: "bend_half", layer: "pitch_gesture", combinable: true, priority: "launch" },
  { technique: "bend (full)", family: "guitar_bass", contractName: "bend_full", layer: "pitch_gesture", combinable: true, priority: "launch" },
  { technique: "bend / release", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "prebend", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "prebend / release", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "bend + vibrato", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "vibrato (normal)", family: "guitar_bass", contractName: "vibrato", layer: "pitch_gesture", combinable: true, priority: "launch" },
  { technique: "vibrato (wide)", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "near_term" },
  { technique: "tremolo picking", family: "guitar_bass", layer: "technique_span", combinable: true, priority: "later" },
  { technique: "trill", family: "guitar_bass", layer: "ornament", combinable: true, priority: "later" },
  { technique: "grace note", family: "guitar_bass", layer: "ornament", combinable: true, priority: "later" },
  { technique: "slap / pop", family: "guitar_bass", layer: "note_attack", combinable: true, priority: "later" },
  { technique: "brush / arpeggio / rake", family: "guitar_bass", layer: "picking_gesture", combinable: true, priority: "later" },
  { technique: "whammy / tremolo bar", family: "guitar_bass", layer: "pitch_gesture", combinable: true, priority: "later" },

  { technique: "accent", family: "drums", contractName: "accent", layer: "note_attack", combinable: true, priority: "launch" },
  { technique: "ghost hit", family: "drums", layer: "note_attack", combinable: true, priority: "launch" },
  { technique: "flam", family: "drums", layer: "ornament", combinable: true, priority: "near_term" },
  { technique: "drag / ruff", family: "drums", layer: "ornament", combinable: true, priority: "later" },
  { technique: "roll", family: "drums", layer: "technique_span", combinable: true, priority: "later" },
  { technique: "rimshot", family: "drums", layer: "note_attack", combinable: false, priority: "near_term" },
  { technique: "cross-stick", family: "drums", layer: "note_attack", combinable: false, priority: "later" },
  { technique: "choke", family: "drums", layer: "note_attack", combinable: true, priority: "later" },
  { technique: "closed / half-open / open hi-hat", family: "drums", layer: "note_attack", combinable: true, priority: "near_term" },
  { technique: "cymbal bell / bow / edge", family: "drums", layer: "note_attack", combinable: false, priority: "later" },

  { technique: "sustain pedal (span)", family: "keyboard", layer: "technique_span", combinable: true, priority: "later" },
  { technique: "pedal up / down", family: "keyboard", layer: "technique_span", combinable: true, priority: "later" },
  { technique: "staccato", family: "keyboard", contractName: "staccato", layer: "note_attack", combinable: true, priority: "later" },
  { technique: "tenuto", family: "keyboard", layer: "note_attack", combinable: true, priority: "later" },
  { technique: "accent", family: "keyboard", contractName: "accent", layer: "note_attack", combinable: true, priority: "later" },
  { technique: "dynamics", family: "keyboard", layer: "notation_only", combinable: true, priority: "later" },

  { technique: "arco", family: "strings", layer: "technique_span", combinable: false, priority: "later" },
  { technique: "pizzicato", family: "strings", layer: "note_attack", combinable: false, priority: "later" },
  { technique: "tremolo", family: "strings", layer: "technique_span", combinable: true, priority: "later" },
  { technique: "spiccato", family: "strings", layer: "note_attack", combinable: false, priority: "later" },
  { technique: "marcato", family: "strings", layer: "note_attack", combinable: true, priority: "later" },
  { technique: "legato", family: "strings", layer: "note_connection", combinable: true, priority: "later" },
];

/**
 * Whether a reader can write this articulation today.
 *
 * A guitar/bass articulation is offered by the fret sheet; the chord builder
 * offers its own five. Nothing else in the product writes one.
 */
function writable(name: Articulation | null, family: Family): boolean {
  if (name === null) return false;
  if (family !== "guitar_bass") {
    // Drum hits carry their own three-value articulation, and the keyboard
    // and string families have no editor of their own at all.
    return family === "drums" && (name === "accent" || name === "normal");
  }
  return EDITOR_SOURCE.includes(`"${name}"`) || CHORD_SHEET_SOURCE.includes(`"${name}"`);
}

const rows: Row[] = BRIEF.map((entry) => {
  const name = entry.contractName ?? null;
  const inContract = name !== null && CONTRACT.includes(name);
  const expressive = name !== null && isExpressive(name);
  return {
    technique: entry.technique,
    family: entry.family,
    contractName: name,
    inSongContract: inContract,
    writableInUi: writable(name, entry.family),
    drawnInTab: name !== null && articulationMark(name) !== null,
    // "normal" is in the contract and is deliberately never written; it is
    // also, deliberately, not a sound of its own.
    heardInPlayback: expressive,
    carriedToMidi: inContract && MIDI_CARRIES_ARTICULATIONS,
    heardInWav: expressive,
    layer: entry.layer,
    combinable: entry.combinable,
    legacyMigration:
      inContract && name !== null
        ? `\`${name}\` okunmaya devam eder; v2 katmanına birebir çevrilir`
        : "geçmiş dosyalarda yok; migration gerekmiyor",
    priority: entry.priority,
  };
});

/* --------------------------------------------------------------- the roles */

const roles = CONTRACT.map((name) => ({
  articulation: name,
  label: articulationLabel(name),
  expressive: isExpressive(name),
  movesPitch: movesPitch(name),
  needsPreviousNote: needsPrevious(name),
  bondsToNeighbour: isChainArticulation(name),
  tabMark: articulationMark(name),
}));

const yes = (value: boolean) => (value ? "evet" : "hayır");

const LAYER_LABEL: Readonly<Record<Layer, string>> = {
  note_attack: "nota atağı",
  picking_gesture: "vuruş yönü/hareketi",
  pitch_gesture: "perde hareketi",
  note_connection: "iki nota arası bağ",
  technique_span: "zaman aralığı",
  ornament: "süsleme",
  notation_only: "yalnız notasyon",
};

const lines: string[] = [
  "# Artikülasyon matrisi — 2P-A §8",
  "",
  "Teknik adları bu checkpoint'in kendi listesinden; geri kalan her sütun",
  "üretim kodundan okundu (`npx tsx eval/expression-benchmark/matrix.ts`).",
  "",
  `Song Contract'taki artikülasyon sayısı: **${CONTRACT.length}**.`,
  `Bunlardan çalarken gerçekten farklı duyulan: **${EXPRESSIVE_ARTICULATIONS.length}**.`,
  "",
  "## Bugünkü sözleşmenin rolleri",
  "",
  "| Artikülasyon | Etiket | Expressive | Perdeyi oynatır | Önceki notaya ihtiyaç duyar | Komşuya bağlanır | Tab işareti |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...roles.map(
    (role) =>
      `| \`${role.articulation}\` | ${role.label} | ${yes(role.expressive)} | ${yes(role.movesPitch)} | ${yes(role.needsPreviousNote)} | ${yes(role.bondsToNeighbour)} | ${role.tabMark ?? "—"} |`,
  ),
  "",
  "## Teknik matrisi",
  "",
  "| Teknik | Aile | Sözleşmede | UI'da yazılabilir | Tab'da çizilir | Playback'te duyulur | MIDI'ye taşınır | WAV'da duyulur | Katman | Birleşebilir | Legacy migration | Öncelik |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (row) =>
      `| ${row.technique} | ${row.family} | ${row.contractName ? `\`${row.contractName}\`` : "yok"} | ${yes(row.writableInUi)} | ${yes(row.drawnInTab)} | ${yes(row.heardInPlayback)} | ${yes(row.carriedToMidi)} | ${yes(row.heardInWav)} | ${LAYER_LABEL[row.layer]} | ${yes(row.combinable)} | ${row.legacyMigration} | ${row.priority} |`,
  ),
  "",
  "## Sayılar",
  "",
  `- Değerlendirilen teknik: **${rows.length}**`,
  `- Song Contract'ta karşılığı olan: **${rows.filter((row) => row.inSongContract).length}**`,
  `- Playback'te gerçekten duyulan: **${rows.filter((row) => row.heardInPlayback).length}**`,
  `- MIDI'ye taşınan: **${rows.filter((row) => row.carriedToMidi).length}**`,
  `- Hiçbir katmanda karşılığı olmayan: **${rows.filter((row) => !row.inSongContract).length}**`,
  "",
  "## Tek `articulation` alanının yetmediği yer",
  "",
  "Matristeki `Katman` sütunu tek başına cevabı veriyor: bugünkü alan",
  ["nota atağı", "perde hareketi", "iki nota arası bağ", "zaman aralığı"]
    .map((entry) => `**${entry}**`)
    .join(", ") + " gibi birbirinden bağımsız şeyleri tek bir enum'a",
  "sıkıştırıyor. Bir nota aynı anda hem vurgulu hem palm mute olabilir, hem",
  "bend hem vibrato olabilir; tek alan bunlardan birini seçmek zorunda.",
  `Bugün \`combinable\` işaretli **${rows.filter((row) => row.combinable).length}**`,
  "teknik var ve hiçbiri diğeriyle birlikte yazılamıyor.",
  "",
  "## Bu belge ne değildir",
  "",
  "Bir yol haritası değil. `Öncelik` sütunu bu checkpoint'in önerisidir ve",
  "founder kararı değildir. Hiçbir teknik bu turda mevcut enum'a eklenmedi.",
  "",
];

writeFileSync(`${OUT}/ARTICULATION-MATRIX.md`, `${lines.join("\n")}\n`);
console.log(
  `techniques=${rows.length} inContract=${rows.filter((r) => r.inSongContract).length} ` +
    `heard=${rows.filter((r) => r.heardInPlayback).length} midi=${rows.filter((r) => r.carriedToMidi).length}`,
);
