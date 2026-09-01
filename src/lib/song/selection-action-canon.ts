/**
 * One authority for what a selection offers, and where (2V-B §3).
 *
 * ## Why this file exists
 *
 * Twice now the same defect has shipped. In 2U-B the capability model offered
 * "Yapıştır" and the drawer's own hard-coded list did not carry it. In 2V-A.1
 * the model offered `extend` and the reading surface's hard-coded list did not
 * carry it. Both were fixed where they were found, and both times the fix was
 * one more entry in one more list.
 *
 * Then a founder opened the listening route, pressed the "Daha fazla" the
 * product draws, and found "Seçimi sil" and nothing else — because the read
 * surface's sheet is a *third* hard-coded list, and the two listening verbs
 * had only ever been added to the edit drawer's. The acceptance run that
 * called this green had pressed "Düzenle" first, so it had been reading the
 * other surface entirely.
 *
 * A verb offered by the model and absent from a list that draws is not a
 * missing button. It is the fourth state 2U-A §3 forbids, reached from the
 * far side, and it will keep happening for as long as "what may be done to
 * this selection" is answered once per surface.
 *
 * So it is answered here, once, for every surface: which actions exist, which
 * surface each belongs to in the mode the reader is in, whether it is live,
 * and — when it is not — the sentence they are shown instead.
 *
 * ## What this file is not
 *
 * It is not a second capability model. Whether a verb *applies* is still
 * `selectionCapabilities`' answer and this file never overrules it: an action
 * whose verb is `hidden` is not here, and one whose verb is `disabled` keeps
 * the model's own reason word for word. What this adds is the half that was
 * never written down — placement, label, and which handler runs it.
 *
 * It writes nothing, stages nothing and refuses nothing.
 */
import { type SelectionVerb, type VerbOffer } from "@/lib/song/selection-capability";

/**
 * Where an action is drawn.
 *
 * Four surfaces rather than the five components that exist, because the two
 * "Daha fazla" sheets are one surface asked in two modes: a sheet holds what
 * the row in front of it could not, and which row that is follows the mode.
 */
export type SelectionSurface =
  | "read_primary"
  | "edit_primary"
  | "more_sheet"
  | "measure_primary";

/**
 * Which row the reader is looking at.
 *
 * Not a preference and not a viewport: a note selection made while reading
 * has a tall two-row bar, the same selection made while writing has the
 * compact row, and a run of whole bars has the measure bar. The three are
 * different rows over the same question.
 */
export type SelectionMode = "read" | "edit" | "measure";

/** Every action the editor can put in front of a selection. */
export type SelectionActionId =
  | "copy"
  | "cut"
  | "duplicate"
  | "repeat"
  | "move"
  | "delete"
  | "extend"
  | "connect"
  | "paste"
  | "listen_once"
  | "listen_loop"
  /** The door. Not a verb — it opens whatever the sheet has left to offer. */
  | "more";

export type SelectionActionOffer = {
  readonly id: SelectionActionId;
  readonly label: string;
  /** The one line under the label in a sheet. Rows have no room for it. */
  readonly hint: string;
  /** Which capability answer this action is bound to; null only for `more`. */
  readonly verb: SelectionVerb | null;
  readonly placement: SelectionSurface;
  readonly availability: "available" | "disabled";
  /** The model's own sentence, present exactly when `disabled`. */
  readonly reason?: string;
};

/* ------------------------------------------------------------ the words */

type Words = { readonly label: string; readonly hint: string };

/**
 * What each action is called, and what it promises.
 *
 * One vocabulary for every surface. "Kopyala" meant the same thing in three
 * files before this and was written out in three files, which is three
 * chances for it to stop meaning the same thing.
 */
const WORDS: Readonly<Record<SelectionActionId, Words>> = {
  copy: { label: "Kopyala", hint: "Seçimi panoya alır; şarkı değişmez." },
  cut: { label: "Kes", hint: "Seçimi panoya alır ve yerinden kaldırır." },
  duplicate: { label: "Çoğalt", hint: "Seçimin bir kopyasını hemen ardına koyar." },
  repeat: { label: "Tekrarla", hint: "Seçimi kaç kez tekrarlayacağını sorar." },
  move: { label: "Taşı", hint: "Seçimi zamanda, seste, telde veya şekilde taşır." },
  delete: { label: "Sil", hint: "Seçili notaları kaldırır." },
  extend: { label: "Devam", hint: "Seçimi bulunduğu yerden ileri uzatır." },
  connect: { label: "Bağla", hint: "Notaları birbirine bağlar." },
  paste: { label: "Yapıştır", hint: "Panodakini buraya koyar; onaylamadan yazmaz." },
  listen_once: {
    label: "Seçimi dinle",
    hint: "Seçili yeri bir kez çalar; şarkı değişmez.",
  },
  listen_loop: {
    label: "Seçimden döngü",
    hint: "Seçili yeri baştan sona tekrar eder.",
  },
  more: { label: "Daha fazla", hint: "Bu seçimin geri kalan işlemleri." },
};

/**
 * The loop control says what pressing it would do (2V-A §4, §9).
 *
 * A label rather than a badge beside one: the reader learns that this is the
 * way out of the loop from the words on the thing they would press.
 */
const LOOP_RUNNING: Words = {
  label: "Seçim döngüsünü kapat",
  hint: "Döngüyü durdurur ve seçim yerinde kalır.",
};

/**
 * What the bar verbs are called in the scope they act in (2U-B §6).
 *
 * "Sil" means two things on a run of bars: on one instrument's bars it empties
 * a lane and the section keeps its length; on a whole measure it takes a bar
 * out of the song. One word for both is how a reader does the second believing
 * they did the first.
 */
const MEASURE_WORDS: Readonly<
  Record<"track" | "full", Partial<Record<SelectionActionId, Words>>>
> = {
  track: {
    duplicate: { label: "İçeriği çoğalt", hint: "Bu enstrümanın içeriğini çoğaltır." },
    move: { label: "İçeriği taşı", hint: "Bu enstrümanın içeriğini kaydırır." },
    delete: { label: "İçeriği sil", hint: "Bu enstrümanın notalarını boşaltır." },
  },
  full: {
    duplicate: { label: "Ölçüyü çoğalt", hint: "Ölçüleri olduğu gibi çoğaltır." },
    move: { label: "Ölçüyü taşı", hint: "Ölçüleri bir sıra ileri veya geri alır." },
    delete: { label: "Ölçüyü kaldır", hint: "Ölçüleri şarkıdan çıkarır." },
  },
};

/* -------------------------------------------------------- the placement */

/**
 * Which capability answer each action reads. `more` reads none.
 *
 * Two bindings, because "Sil" on a run of notes and "Sil" on a run of bars are
 * different commands with different rules — one empties a range, the other can
 * take the last bar out of a song. The model has always kept them apart; this
 * is where the two rows say which of the two they are asking about.
 */
const VERB_OF: Readonly<Record<SelectionActionId, SelectionVerb | null>> = {
  copy: "copy",
  cut: "cut",
  duplicate: "duplicate",
  repeat: "repeat",
  move: "move_time",
  delete: "delete",
  extend: "extend",
  connect: "connect",
  paste: "paste",
  listen_once: "audition",
  listen_loop: "loop_selection",
  more: null,
};

/** The same actions on a run of bars, bound to the bar commands. */
const MEASURE_VERB_OF: Readonly<Partial<Record<SelectionActionId, SelectionVerb>>> = {
  copy: "copy_bar",
  cut: "cut_bar",
  duplicate: "duplicate_bar",
  repeat: "repeat_bar",
  move: "move_bars",
  delete: "delete_bar",
  listen_once: "audition",
  listen_loop: "loop_selection",
};

function verbFor(mode: SelectionMode, id: SelectionActionId): SelectionVerb | null {
  if (mode === "measure") return MEASURE_VERB_OF[id] ?? null;
  return VERB_OF[id];
}

/**
 * Which surface holds what, per mode.
 *
 * The rows are frozen where UI Contract v1 froze them and this table says so
 * out loud. `read_primary` is the eight targets of 2V-A.1 §5 in the order a
 * finger finds them; `edit_primary` is K-59's three verbs and the door;
 * `measure_primary` is 2U-B's seven. What changes between modes is only which
 * of the two lists an action falls into — never whether it exists.
 *
 * No action appears in both lists of a mode. A verb drawn twice in one context
 * is two controls the reader has to choose between for one outcome, and the
 * one they do not press teaches them the wrong thing about the one they do.
 */
const LAYOUT: Readonly<
  Record<
    SelectionMode,
    { readonly primary: readonly SelectionActionId[]; readonly sheet: readonly SelectionActionId[] }
  >
> = {
  read: {
    primary: ["copy", "cut", "duplicate", "repeat", "move", "extend", "delete", "more"],
    /*
     * "Sil" is not repeated here. It is on the grid in front of this sheet,
     * and a sheet whose only entry is a verb already on the row behind it is
     * what the founder opened (2V-B §6).
     */
    sheet: ["paste", "listen_once", "listen_loop"],
  },
  edit: {
    primary: ["connect", "move", "extend", "more"],
    sheet: ["copy", "cut", "paste", "duplicate", "repeat", "delete", "listen_once", "listen_loop"],
  },
  measure: {
    primary: ["copy", "cut", "duplicate", "repeat", "move", "delete", "more"],
    /*
     * The bar-structure entries — "Ölçü ve ritim", inserting and pasting whole
     * bars — are not selection actions and stay in `bar-menu.ts`, which is
     * already one list for that sheet and its door. What belongs here is what
     * a *selection* offers, and a run of bars is very much a thing to listen
     * to: the capability model has said so since 2V-A and no surface has ever
     * drawn it.
     */
    sheet: ["listen_once", "listen_loop"],
  },
};

/** Which surface a mode's primary row is. */
const PRIMARY_SURFACE: Readonly<Record<SelectionMode, SelectionSurface>> = {
  read: "read_primary",
  edit: "edit_primary",
  measure: "measure_primary",
};

/** Every action, in the canon's own order. Nothing may be offered outside it. */
export const ALL_SELECTION_ACTIONS: readonly SelectionActionId[] = [
  "copy",
  "cut",
  "duplicate",
  "repeat",
  "move",
  "delete",
  "extend",
  "connect",
  "paste",
  "listen_once",
  "listen_loop",
  "more",
];

/** Where this mode draws an action, or null when the mode has no place for it. */
export function placementOf(
  mode: SelectionMode,
  id: SelectionActionId,
): SelectionSurface | null {
  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];
  if (layout.sheet.includes(id)) return "more_sheet";
  return null;
}

export type CanonInput = {
  readonly mode: SelectionMode;
  /** The capability model's answer for this selection, unmodified. */
  readonly offers: readonly VerbOffer[];
  /**
   * Which actions this surface has a production handler wired for.
   *
   * An action with no handler is not drawn. A button that runs nothing is the
   * fourth state again — drawn, pressed, and nothing happens — and it is worse
   * than the refusal because there is not even a sentence.
   *
   * The matrix test then asserts the other half of the rule: a handler set
   * that fails to cover an available capability is a defect in the wiring,
   * not a licence for this function to hide the verb quietly.
   */
  readonly handlers: ReadonlySet<SelectionActionId>;
  /** True while *this* selection is the one looping, for the loop's label. */
  readonly looping?: boolean;
  /** Which bar scope is held, for the measure vocabulary. */
  readonly barScope?: "track" | "full" | null;
};

/**
 * What this selection offers, where, and in what state.
 *
 * Hidden verbs are absent. Everything else is present with the model's own
 * answer carried through: `available`, or `disabled` with the model's
 * sentence. The order is the canon's, so a surface that renders what it is
 * given cannot put "Daha fazla" in the middle of the row.
 */
export function selectionActionCanon(
  input: CanonInput,
): readonly SelectionActionOffer[] {
  const stateOf = (verb: SelectionVerb) =>
    input.offers.find((offer) => offer.verb === verb)?.state ?? null;

  const wordsFor = (id: SelectionActionId): Words => {
    if (id === "listen_loop" && input.looping) return LOOP_RUNNING;
    if (input.mode === "measure" && input.barScope) {
      const scoped = MEASURE_WORDS[input.barScope][id];
      if (scoped) return scoped;
    }
    return WORDS[id];
  };

  const built: SelectionActionOffer[] = [];
  /*
   * In the order the row draws them, not in the order the vocabulary is
   * written. "Devam" sits beside "Taşı" and "Daha fazla" is last, and a list
   * sorted by the union's declaration order puts "Sil" between them.
   */
  const layout = LAYOUT[input.mode];
  for (const id of [...layout.primary, ...layout.sheet]) {
    const placement = placementOf(input.mode, id);
    if (placement === null) continue;
    if (!input.handlers.has(id)) continue;

    const verb = verbFor(input.mode, id);
    /*
     * The door is not a verb and has no capability of its own. Whether it is
     * worth drawing is a question about what the sheet holds, and only the
     * caller knows that — so it is offered here and the surface drops it when
     * the sheet came back empty, the way `bar-menu.ts` already does.
     */
    if (verb === null) {
      built.push({ id, ...wordsFor(id), verb: null, placement, availability: "available" });
      continue;
    }

    const state = stateOf(verb);
    if (state === null || state.kind === "hidden") continue;

    built.push({
      id,
      ...wordsFor(id),
      verb,
      placement,
      ...(state.kind === "disabled"
        ? { availability: "disabled" as const, reason: state.reason }
        : { availability: "available" as const }),
    });
  }
  return built;
}

/** Just what one surface draws, in canon order. */
export function onSurface(
  actions: readonly SelectionActionOffer[],
  surface: SelectionSurface,
): readonly SelectionActionOffer[] {
  return actions.filter((action) => action.placement === surface);
}
