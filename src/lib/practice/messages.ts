/**
 * What the practice loop says, in Turkish, about music (2R-A §14).
 *
 * One place, so the sheet, the transport and any notice cannot drift into
 * three ways of saying the same thing. Pure strings from pure values: nothing
 * here reads a song, a transport or a clock.
 *
 * ## Two rules the words obey
 *
 * The vocabulary is a musician's. A reader is never shown "range", "loop
 * bounds", "tick", "preflight" or "chain" — those are this codebase's words
 * for its own bookkeeping, and 2Q-C already fixed the same rule for the
 * reading surface.
 *
 * And nothing here claims anything about how the reader played. The app does
 * not listen, so "tur" is a pass of the loop and never a clean repetition.
 */
import type { EntryRefusal } from "@/lib/practice/range-entry";
import type { RangeSource } from "@/lib/practice/range-entry";
import type { RangeEdgeKind } from "@/lib/practice/range-preflight";

/** What the reader is practising, said as bars rather than as keys. */
export function rangeSummary(
  firstBarNumber: number,
  lastBarNumber: number,
  sectionName: string,
): string {
  const bars =
    firstBarNumber === lastBarNumber
      ? `${firstBarNumber}. ölçü`
      : `${firstBarNumber}–${lastBarNumber}. ölçüler`;
  return `${sectionName}, ${bars}`;
}

/** Why a gesture could not become a practice range (§V). */
export function refusalMessage(reason: EntryRefusal): string {
  switch (reason) {
    case "different_sections":
      /*
       * Said as a fact about the music rather than as a restriction. Tempo
       * and meter belong to the section, so a loop across two would change
       * length depending on where in it you asked — which is a worse thing to
       * discover by ear than to be told.
       */
      return "Çalışma döngüsü tek bir bölüm içinde kalır. İki ölçüyü aynı bölümden seç.";
    case "too_many_bars":
      return "Bir bölümün alabileceğinden fazla ölçü seçildi.";
    case "unknown_bar":
      return "Seçilen ölçü artık burada değil.";
    case "chain_crosses_section":
      return "Bu bağlantı bölüm sınırını aştığı için çalışma alanı oluşturulamıyor.";
    case "requires_full_bars":
      /*
       * Not an error and not phrased as one: the selection is perfectly good
       * for what selections are for. It is simply not a practice loop, and
       * saying so is better than quietly looping bars nobody chose.
       */
      return "Çalışma döngüsü tam ölçülerden oluşur. Seçimi ölçü başına ve ölçü sonuna getir.";
  }
}

/** Which door this range came through, said plainly (§V). */
export function sourceLabel(source: RangeSource): string {
  switch (source) {
    case "single_bar":
      return "Tek ölçü";
    case "bar_pair":
      return "Seçilen iki ölçü arası";
    case "time_selection":
      return "Zaman seçiminden";
  }
}

/** The half-finished pair: one end chosen, waiting for the other. */
export const PAIR_PENDING_MESSAGE =
  "İlk ölçü seçildi. Aynı bölümden ikinci bir ölçü seç.";

/** The action a time selection offers, when it sits on bar lines. */
export const PRACTICE_FROM_SELECTION_LABEL = "Çalışma döngüsü yap";

/**
 * What the loop's edges cut, and what the reader can do about it.
 *
 * Never a warning about a mistake: the reader has not made one. It is a
 * description of what they will hear, so they can decide whether they meant
 * it — a loop that starts inside a held note is a perfectly reasonable thing
 * to practise on purpose.
 */
export function edgeMessage(kind: RangeEdgeKind): string | null {
  switch (kind) {
    case "safe":
      return null;
    case "start_continues_tie":
      return "Döngü, önceki ölçüde başlayan bir sesin ortasından başlıyor.";
    case "end_cuts_sustain":
      return "Döngünün sonunda hâlâ süren bir ses var; her turda kesilecek.";
    case "legato_boundary":
      return "Bağlantılı notalar çalışma alanının dışında kalıyor.";
    case "crosses_section":
      return "Bu bağlantı bölüm sınırını aştığı için çalışma alanı oluşturulamıyor.";
  }
}

/** The offer, and the only way the range ever grows (§10). */
export const INCLUDE_CHAIN_LABEL = "Bağlantıyı da dahil et";

/** What that offer would do, said in bars. */
export function includeChainDetail(
  firstBarNumber: number,
  lastBarNumber: number,
): string {
  return firstBarNumber === lastBarNumber
    ? `Döngü ${firstBarNumber}. ölçüye genişler.`
    : `Döngü ${firstBarNumber}–${lastBarNumber}. ölçülere genişler.`;
}

export const PRACTICE_SHEET_TITLE = "Çalışma döngüsü";
export const COUNT_IN_LABEL = "Sayarak başla";
export const PROGRESSIVE_LABEL = "Kademeli hızlanma";

/**
 * How the progressive control describes itself before it is started.
 *
 * It says what moves the speed, because the honest answer is not what a
 * reader would assume: the loop coming round, not how the pass went.
 */
export const PROGRESSIVE_EXPLAINER =
  "Her tamamlanan turda bir kademe hızlanır. Uygulama çalımını dinlemez.";

export const CLEAR_RANGE_LABEL = "Döngüyü kaldır";
