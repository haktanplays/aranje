/**
 * The three choices, in words (spec 13.20 §2).
 *
 * One table, like `transform-messages.ts` beside it, and for the same reason:
 * a reader is being asked to decide something about their music, and the
 * decision has to be readable without knowing what `crosses_legato_boundary`
 * is. Nothing from the core's vocabulary reaches the screen through here — no
 * code, no tick, no articulation identifier.
 *
 * The wording is deliberately about *what will happen to the music*, not about
 * what the software will do. "Bağlantıyla birlikte taşı" and "Yalnız akoru
 * taşı" are two different musical outcomes, and the reader is the only one who
 * knows which of them they meant.
 */
import type { ChainImpact, ChainPolicy } from "@/lib/song/chain-preflight";
import type { TransformCommand } from "@/lib/song/transform";

type CommandKind = TransformCommand["kind"];

/** What the command does, as the verb a button can end with. */
const VERBS: Readonly<Record<CommandKind, string>> = {
  copy_selection: "kopyala",
  cut_selection: "kes",
  delete_selection: "sil",
  paste_selection: "yapıştır",
  duplicate_selection: "çoğalt",
  move_selection_time: "taşı",
  repeat_selection: "tekrarla",
  transpose_pitch: "aktar",
  restring_same_pitch: "taşı",
  translate_fret_shape: "taşı",
};

export function chainVerb(kind: CommandKind): string {
  return VERBS[kind];
}

/**
 * What the reader is holding, in the accusative, so a label reads as Turkish.
 *
 * "akoru" when the selection really is one chord, "seçimi" otherwise — a
 * single note or a range of several onsets is not an "akor", and calling it
 * one would be describing something the reader can see is not there.
 */
export function chainSubject(isChord: boolean): { bare: string; accusative: string } {
  return isChord ? { bare: "akor", accusative: "akoru" } : { bare: "seçim", accusative: "seçimi" };
}

/** The heading: what is about to be cut, said plainly. */
export function chainImpactTitle(impact: ChainImpact): string {
  switch (impact.kind) {
    case "crosses_tie_boundary":
      return "Bu seçim uzayan bir sesi kesiyor";
    case "crosses_legato_boundary":
      return "Bu seçim bir bağlantıyı kesiyor";
    case "crosses_multiple_boundaries":
      return "Bu seçim hem bir bağlantıyı hem uzayan bir sesi kesiyor";
    case "crosses_section_boundary":
      return "Bu bağlantı bir sonraki bölüme uzanıyor";
    case "no_chain_impact":
      return "";
  }
}

export function chainOptionLabel(
  policy: ChainPolicy,
  kind: CommandKind,
  isChord: boolean,
): string {
  const verb = chainVerb(kind);
  if (policy === "include_chain") return `Bağlantıyla birlikte ${verb}`;
  return `Yalnız ${chainSubject(isChord).accusative} ${verb}`;
}

/**
 * What "only this" will really do, listed rather than summarised.
 *
 * The sentence names the four things that can be removed because the reader
 * has to be able to look at their tab and see which of them applies. A vaguer
 * "bağlantılar temizlenecek" would be true and useless.
 */
export function chainDetachExplain(impact: ChainImpact, isChord: boolean): string {
  const subject = chainSubject(isChord).bare;
  const kinds = new Set(impact.boundaries.map((boundary) => boundary.kind));
  if (kinds.size === 1 && kinds.has("tie")) {
    return `Bu ${subject} dışında kalan uzatma bağlantısı kaldırılacak.`;
  }
  if (kinds.size === 1 && kinds.has("legato")) {
    return `Bu ${subject} dışındaki slide, hammer-on veya pull-off bağlantısı kaldırılacak.`;
  }
  return `Bu ${subject} dışındaki slide, hammer-on, pull-off veya uzatma bağlantısı kaldırılacak.`;
}

/** Why the whole-chain option is the safe one, and what it will really touch. */
export function chainIncludeExplain(scopeText: string): string {
  return `Bağlantının tamamı birlikte hareket eder: ${scopeText}.`;
}

/** Said when neither answer is available, so the reader is not left guessing. */
export const CHAIN_SECTION_BLOCKED =
  "Bu sürümde bölüm sınırını aşan bir bağlantı buradan düzenlenemiyor. " +
  "Seçimi bu bölümün içinde tut.";
