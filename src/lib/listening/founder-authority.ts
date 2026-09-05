/**
 * What the founder has already decided, and what a session may not undo
 * (2V-C.2 §1, §4).
 *
 * ## Two different things were being counted as one
 *
 * The pack's summary said "Cevaplanmamış: 13/16", which reads as a statement
 * about the product and is not one. It counted the answers *this browser
 * session* happens to hold — so a card the founder judged on a real phone two
 * builds ago, on a device this session has never seen, was reported as
 * unmeasured. A reload said the same thing again.
 *
 * So there are two registers now and they never mix:
 *
 * - **This module** is the archive: physical results, recorded when the
 *   founder gave them, append-only, and never written by the route.
 * - **The session** is what is being decided right now, and it only ever
 *   covers the round's own active cards.
 *
 * The route reads this and shows it; it does not store into it. A verdict
 * arrives here the way every other accepted fact does — through a commit,
 * with the delta report saying who said it.
 *
 * ## `unmeasured` is not a failure and not a pass
 *
 * L12 and L13 were never answered. That is recorded as exactly that. A card
 * with actionable negative feedback and no formal verdict — L14 — is recorded
 * as `needs_polish` with the founder's own sentence, because calling it a
 * conditional pass would be inventing a decision nobody made.
 *
 * ## A conditional pass with no sentence stays silent
 *
 * L20 came back conditional and said nothing else. The card had asked about
 * sliding *into* a note and *out of* one in the same question, so there is no
 * way to know which half was the reservation — and a note here reading "the
 * exit needed work" would be a guess wearing the founder's voice. The row
 * carries the verdict and no note, and 2V-C.3 asks the two halves separately
 * instead (§6).
 *
 * ## An inconclusive card with a description is a lead, not a verdict
 *
 * L21 and L24 came back `inconclusive` — not a pass and not a failure — with
 * a sentence describing a small gap between the two sounds. That sentence is
 * the most valuable thing in this file: it is a physical observation about
 * rendered audio that no event-level measurement had caught, and 2V-C.4
 * exists because of it. It is recorded word for word, and the row is not
 * upgraded when the fix lands. Only the founder moves a verdict.
 */

export type FounderVerdict =
  | "pass"
  | "conditional_pass"
  | "inconclusive"
  | "needs_polish"
  | "unmeasured";

/** What each verdict is called on the page. Never an enum id. */
export const VERDICT_LABEL: Readonly<Record<FounderVerdict, string>> = {
  pass: "Olmuş",
  conditional_pass: "Şartlı geçti",
  inconclusive: "Sonuçsuz",
  needs_polish: "Cila gerekiyor",
  unmeasured: "Ölçülmedi",
};

export type ArchivedCard = {
  readonly id: string;
  /** The descriptive title. The same string every surface shows (§5). */
  readonly title: string;
  readonly verdict: FounderVerdict;
  /** The founder's own words, when they gave any. Never paraphrased. */
  readonly note?: string;
};

/**
 * The physical listening record, oldest first.
 *
 * Append-only. A later round adds rows; it does not rewrite them, and it
 * certainly does not turn a recorded result back into "unmeasured" because a
 * new session has not heard it.
 */
export const FOUNDER_AUTHORITY: readonly ArchivedCard[] = [
  { id: "L1", title: "Yalnız gitar", verdict: "pass" },
  { id: "L2", title: "Yalnız bas", verdict: "pass" },
  { id: "L3", title: "Ortadan başlama", verdict: "pass" },
  {
    id: "L4",
    title: "Duraklat ve devam et",
    verdict: "inconclusive",
    note: "Pilotu bloke etmez.",
  },
  {
    id: "L5",
    title: "Kaydırma",
    verdict: "conditional_pass",
    note: "Cila borcu.",
  },
  { id: "L6", title: "Vibrato", verdict: "pass" },
  {
    id: "L7",
    title: "Hammer-on / pull-off",
    verdict: "conditional_pass",
    note: "Cila borcu.",
  },
  { id: "L8", title: "Power chord ve normal akor", verdict: "pass" },
  { id: "L9", title: "Uzayan akorun loop dönüşü", verdict: "pass" },
  { id: "L10", title: "Hızlı bağlı dizi", verdict: "pass" },
  {
    id: "L11",
    title: "Bend: tut / geri indir",
    verdict: "needs_polish",
    note: "Geri indir tam tatmin etmedi.",
  },
  { id: "L12", title: "Önceden bükme: tut / geri indir", verdict: "unmeasured" },
  { id: "L13", title: "Bağlı / vurarak kaydırma", verdict: "unmeasured" },
  {
    id: "L14",
    title: "Kayarak girme / çıkma",
    /*
     * No formal verdict was given and one is not invented here. What exists
     * is an actionable sentence, so the row says that and nothing more.
     */
    verdict: "needs_polish",
    note: "Bu biraz daha iyileştirilmeli.",
  },
  { id: "L15", title: "Bend + tepede vibrato", verdict: "pass" },
  { id: "L16", title: "Bükülmüş sesin devamı", verdict: "pass" },
  /* 2V-C.2's round. L11 and L12 are answered by L17 and L18; the two slide
     cards came back conditional and their polish is 2V-C.3's work. */
  { id: "L17", title: "Bend geri dönüşü", verdict: "pass" },
  { id: "L18", title: "Normal bend / önceden bükme", verdict: "pass" },
  {
    id: "L19",
    title: "Bağlı / vurarak kaydırma",
    verdict: "conditional_pass",
    note: "Vurarak biraz kusurlu duruyor.",
  },
  {
    id: "L20",
    title: "Kayarak girme / çıkma",
    /*
     * Conditional, with no sentence saying which half. The card asked about
     * entering *and* leaving in one question, so the result cannot be
     * attributed to either — which is why 2V-C.3 splits them into L22 and L23
     * rather than guessing. Recorded as it was given: no note, because none
     * was given, and inventing one would be worse than the silence.
     */
    verdict: "conditional_pass",
  },
  /*
   * 2V-C.3's round. Two cards came back inconclusive with the same
   * description, which is itself the finding: L24 is L21 on two strings, and
   * the founder heard the same thing on both.
   */
  {
    id: "L21",
    title: "Vurarak slide handoff",
    verdict: "inconclusive",
    note: "Vurarak da iki ses arasında minik bir boşluk var sanki o bozuyor.",
  },
  { id: "L22", title: "Kayarak giriş", verdict: "pass" },
  {
    id: "L23",
    title: "Kayarak çıkış",
    verdict: "conditional_pass",
    note: "Kabul edebilirim, gelişmesi gerekebilir ileride ne kadar geliştirilebilirse ondan da emin değilim.",
  },
  {
    id: "L24",
    title: "İki telli şekil slide'ı",
    verdict: "inconclusive",
    note: "21'in aynısı.",
  },

  /*
   * 2V-C.4's round, and the end of the slide phase.
   *
   * L25 and L26 are the two gestures L21 and L24 asked about, after the
   * handoff was rebuilt on rendered PCM rather than on the event list. Both
   * came back clean, which closes the seam for this engine: no curve round
   * follows it, and the exit policy the round shipped with (§13.37.6) says so
   * in the spec rather than in anyone's memory.
   *
   * L21 and L24 stay inconclusive above. A later card passing is not the
   * founder revisiting an earlier one, and rewriting the older rows to agree
   * with the newer ones would delete the only record of what was wrong.
   */
  { id: "L25", title: "Tek telli vurarak slide", verdict: "pass" },
  { id: "L26", title: "İki telli şekil slide'ı", verdict: "pass" },
];

const BY_ID = new Map(FOUNDER_AUTHORITY.map((card) => [card.id, card]));

export function archivedCard(id: string): ArchivedCard | null {
  return BY_ID.get(id) ?? null;
}

/** True when this card's result is already decided and is not being re-asked. */
export function isArchived(id: string): boolean {
  return BY_ID.has(id);
}

/** One line per archived card, for the paste block's history section. */
export function archiveLines(): string[] {
  return FOUNDER_AUTHORITY.map((card) => {
    const verdict = VERDICT_LABEL[card.verdict];
    return `${card.id} ${card.title}: ${verdict}${card.note ? ` — ${card.note}` : ""}`;
  });
}
