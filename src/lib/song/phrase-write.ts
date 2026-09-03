/**
 * Naming an idea (2V-B.4 §10, §11).
 *
 * A phrase is a *permanent musical region*: this stretch of music is one
 * idea, and it stays that whether or not anyone is looking at it. A selection
 * is the opposite — a range the reader is holding for a moment. The two are
 * different things (§11), and the only place they touch is here, where a
 * reader turns the range they are holding into a region that outlives it.
 *
 * ## Deliberately small
 *
 * There is no phrase editor this round. What a reader can do is name the
 * music they are holding and take a name back off it. Everything else the
 * model supports — overlapping ideas, nested ideas, renaming, dragging a
 * boundary — is left undone rather than half-done.
 *
 * ## What it refuses
 *
 * Two phrases that overlap are a contradiction the model has no reading for,
 * so a range that crosses an existing phrase is refused by name rather than
 * being trimmed to fit: trimming would silently produce a region the reader
 * did not ask for.
 *
 * Pure. A Song goes in and a Song or a typed refusal comes out.
 */
import { overlappingPhrases } from "@/lib/song/phrase";
import type { Phrase, Song } from "@/lib/song/schema";

export type PhraseWriteResult =
  | { readonly ok: true; readonly song: Song; readonly phraseId: string }
  | { readonly ok: false; readonly reason: string };

/** `Cümle 1`, `Cümle 2`, … — the first number this section is not using. */
export function nextPhraseName(existing: readonly Phrase[] | undefined): string {
  const used = new Set((existing ?? []).map((phrase) => phrase.name));
  for (let index = 1; index <= 128; index += 1) {
    const candidate = `Cümle ${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `Cümle ${(existing?.length ?? 0) + 1}`;
}

function withPhrases(song: Song, sectionId: string, phrases: readonly Phrase[]): Song {
  return {
    ...song,
    sections: song.sections.map((section) =>
      section.id === sectionId ? { ...section, phrases: [...phrases] } : section,
    ),
  };
}

/**
 * Name the held range, so it becomes a region rather than a moment.
 *
 * The range is taken exactly as given. A phrase may be shorter than a
 * measure and it may run across several, because an idea is not obliged to
 * agree with the meter — that is the distinction §11 exists to keep.
 */
export function namePhrase(
  song: Song,
  input: {
    readonly sectionId: string;
    readonly fromTicks: number;
    readonly toTicks: number;
    readonly name?: string;
  },
): PhraseWriteResult {
  const section = song.sections.find((entry) => entry.id === input.sectionId);
  if (!section) return { ok: false, reason: "Bu bölüm bulunamadı." };
  if (input.toTicks <= input.fromTicks) {
    return { ok: false, reason: "Önce bir alan seç." };
  }

  const existing = section.phrases ?? [];
  const phrase: Phrase = {
    id: `phrase-${input.sectionId}-${input.fromTicks}-${input.toTicks}`,
    name: input.name ?? nextPhraseName(existing),
    startTicks: input.fromTicks,
    endTicks: input.toTicks,
  };
  if (existing.some((entry) => entry.id === phrase.id)) {
    return { ok: false, reason: "Bu alan zaten adlandırılmış." };
  }
  const next = [...existing, phrase];
  if (overlappingPhrases(next)) {
    return { ok: false, reason: "Burası başka bir cümlenin içinde kalıyor." };
  }
  return { ok: true, song: withPhrases(song, input.sectionId, next), phraseId: phrase.id };
}

/** Take the name back off. The music itself is untouched either way. */
export function removePhrase(
  song: Song,
  input: { readonly sectionId: string; readonly phraseId: string },
): PhraseWriteResult {
  const section = song.sections.find((entry) => entry.id === input.sectionId);
  if (!section) return { ok: false, reason: "Bu bölüm bulunamadı." };
  const existing = section.phrases ?? [];
  if (!existing.some((entry) => entry.id === input.phraseId)) {
    return { ok: false, reason: "Burada adlandırılmış bir cümle yok." };
  }
  const next = existing.filter((entry) => entry.id !== input.phraseId);
  return {
    ok: true,
    song: withPhrases(song, input.sectionId, next),
    phraseId: input.phraseId,
  };
}
