/**
 * Six different questions that were all being called "rhythm" (2V-D.2 §3).
 *
 * A reader looking at one bar can be asking any of six things, and the app
 * had a habit of answering a different one:
 *
 *   1. How much music is in this box?          → **Ölçü**
 *   2. Where is the weight felt?               → **His**
 *   3. How finely can a note be placed?        → **Grid**
 *   4. When does the next note start?          → **Sonraki nota**
 *   5. How long does this one ring?            → **Nota süresi**
 *   6. How much of it is on screen?            → **Zoom**
 *
 * They are independent. A bar can change its grid without changing its
 * length, change its feel without changing a note, and be zoomed without
 * changing anything at all. Treating any two of them as the same word is how
 * "make the rhythm finer" ends up meaning four different things depending on
 * which control the reader touched.
 *
 * ## Why the words live here and not in the components
 *
 * Every surface — the panel, the refusal, the screen reader, the preview
 * sentence — asks this module. That is what stops the same concept appearing
 * as "Ritim" in one place, "Çözünürlük" in another and "Slot" in a third,
 * which is the state §17 exists to end. A test walks the whole table and
 * checks that no two concepts share a name and that no name is a unit.
 *
 * ## What is stored and what is only looked through
 *
 * Four of the six are properties of the music and live in the Song. One —
 * onset spacing — is *derived*: it is the distance to the next onset, not a
 * field, which is exactly why it was so easy to confuse with duration. And
 * zoom is a camera: it is session state, it never reaches the Song, and
 * `owner: "view"` is the machine-readable form of that promise.
 */

export type RhythmConceptId =
  | "meter"
  | "feel"
  | "grid"
  | "spacing"
  | "duration"
  | "zoom";

/** Where the answer lives, which decides whether an edit is a transaction. */
export type RhythmConceptOwner =
  /** A field of the Song. Changing it is an edit. */
  | "song"
  /** Read off the music rather than stored. Changing it changes notes. */
  | "derived"
  /** Session state. Changing it is a camera move and never an edit. */
  | "view";

export type RhythmConcept = {
  readonly id: RhythmConceptId;
  /** What the control is called. One name, everywhere. */
  readonly label: string;
  /** The reader's own question, in their words. */
  readonly question: string;
  /** One sentence on what it does. Never a unit, never an identifier. */
  readonly hint: string;
  readonly owner: RhythmConceptOwner;
  /** The concepts this one is most often mistaken for. */
  readonly notThe: readonly RhythmConceptId[];
};

export const RHYTHM_CONCEPTS: readonly RhythmConcept[] = [
  {
    id: "meter",
    label: "Ölçü",
    question: "Bu kutuda toplam ne kadar müzik var?",
    hint: "Bir ölçünün uzunluğunu belirler. Değiştirince kutu büyür ya da küçülür.",
    owner: "song",
    notThe: ["grid", "duration"],
  },
  {
    id: "feel",
    label: "His",
    question: "Vurgu nerelerde hissediliyor?",
    hint: "Ölçünün içindeki ana vuruşların nereye düştüğünü söyler. Notaları değiştirmez.",
    owner: "song",
    notThe: ["meter", "grid"],
  },
  {
    id: "grid",
    label: "Grid",
    question: "Nota başlangıcı ne kadar ince yerleştirilebilir?",
    hint: "Notaların hangi noktalara oturabileceğini belirler. Ölçünün süresi değişmez.",
    owner: "song",
    notThe: ["meter", "duration", "zoom"],
  },
  {
    id: "spacing",
    label: "Sonraki nota",
    question: "Sonraki nota ne zaman başlıyor?",
    hint: "Bu notadan sonrakinin ne kadar beklediğini söyler.",
    owner: "derived",
    notThe: ["duration"],
  },
  {
    id: "duration",
    label: "Nota süresi",
    question: "Bu nota ne kadar çınlıyor?",
    hint: "Tek bir notanın ne kadar sürdüğünü söyler. Ölçüyü ya da gridi değiştirmez.",
    owner: "song",
    notThe: ["spacing", "grid", "meter"],
  },
  {
    id: "zoom",
    label: "Zoom",
    question: "Ekranda ne kadarını görüyorsun?",
    hint: "Yalnız görüntüyü yakınlaştırır. Müziğe hiçbir şey yapmaz.",
    owner: "view",
    notThe: ["grid", "meter"],
  },
];

const BY_ID = new Map(RHYTHM_CONCEPTS.map((concept) => [concept.id, concept]));

export function rhythmConcept(id: RhythmConceptId): RhythmConcept {
  return BY_ID.get(id)!;
}

/** The one name this concept goes by, wherever it appears. */
export function conceptLabel(id: RhythmConceptId): string {
  return rhythmConcept(id).label;
}

/**
 * Whether changing this concept is an edit to the music.
 *
 * The single question every caller actually has: does touching this open a
 * transaction, or is it a camera move? A `view` concept that ever answered
 * yes would be zoom writing to the Song, which is the one thing §4 forbids.
 */
export function isMusicalEdit(id: RhythmConceptId): boolean {
  return rhythmConcept(id).owner !== "view";
}

/**
 * The sentence shown when a reader is about to be surprised.
 *
 * Said before the change rather than after it, and only for the pairs that
 * actually get confused — a grid change that leaves the bar the same length
 * looks like a bug to someone who expected the box to grow.
 */
export const REASSURANCE: Readonly<Partial<Record<RhythmConceptId, string>>> = {
  grid: "Bu ölçü daha ayrıntılı görünecek; süresi değişmeyecek.",
  feel: "Vurgular yer değiştirecek; notalar ve süre aynı kalacak.",
  zoom: "Yalnız görünüm değişiyor; müziğe hiçbir şey olmuyor.",
};
