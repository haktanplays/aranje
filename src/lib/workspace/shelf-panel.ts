/**
 * What the editor shelf is showing, as a value (2V-B.4 §4, §17).
 *
 * ## The measurement this replaces
 *
 * At `c11a758`, tapping a cell opened a bottom sheet — `fixed inset-0 z-30`,
 * a panel up to 85% of the screen — headed **"Bar 1 · slot 1 · tel 1"**. It
 * covered the grid at all six measured viewports, in both the tap and the
 * long-press state, and it carried nine note-value names and two competing
 * calls to action. The grid, which is supposed to be the loudest thing on the
 * screen, was not on the screen at all.
 *
 * Everything that sheet did now happens **in the shelf**: below the grid in
 * portrait, beside it in landscape, scrolling inside itself when it needs to.
 * A panel is a region of the ordinary layout, so opening one cannot cover the
 * music by construction rather than by care.
 *
 * ## Why the open panel is a value and not component state
 *
 * Because three different things open panels — a cell tap, a dock group, a
 * selection verb — and the rule "only one is open, and it belongs to the four
 * groups the reader already knows" has to hold across all three. A boolean in
 * each component would be three rules that agree until one of them is edited.
 */
import type { DockGroup } from "@/lib/workspace/editor-dock";

export const SHELF_PANEL_IDS = [
  "note",
  "chord",
  "fast_sequence",
  "duration",
  "playing",
  "transpose",
  "phrase",
] as const;

export type ShelfPanelId = (typeof SHELF_PANEL_IDS)[number];

/** What the panel is called, and which of the four groups it belongs to. */
export type ShelfPanelMeta = {
  readonly id: ShelfPanelId;
  readonly label: string;
  readonly group: DockGroup;
  /** One line under the title. Never a second paragraph. */
  readonly hint: string;
};

export const SHELF_PANELS: Readonly<Record<ShelfPanelId, ShelfPanelMeta>> = {
  note: {
    id: "note",
    label: "Nota",
    group: "ses",
    hint: "Bu notanın perdesi ve süresi.",
  },
  chord: {
    id: "chord",
    label: "Akor",
    group: "ses",
    hint: "Kök, tür ve süre seç; telleri tek tek doldurma.",
  },
  fast_sequence: {
    id: "fast_sequence",
    label: "Hızlı dizi",
    group: "ritim",
    hint: "Aynı süreye birkaç nota sığdır.",
  },
  duration: {
    id: "duration",
    label: "Süre",
    group: "ritim",
    hint: "Ne kadar sürsün?",
  },
  playing: {
    id: "playing",
    label: "Bend / Kaydır",
    group: "calim",
    hint: "Teli bük ya da notaya kayarak gir.",
  },
  transpose: {
    id: "transpose",
    label: "Taşı",
    group: "calim",
    hint: "Sesi taşı ya da tonu değiştir.",
  },
  phrase: {
    id: "phrase",
    label: "Cümle",
    group: "secim",
    hint: "Seçili müziği bir fikir olarak adlandır.",
  },
};

/** The panels a group offers, in the order the shelf draws them. */
export function panelsOfGroup(group: DockGroup): readonly ShelfPanelMeta[] {
  return SHELF_PANEL_IDS.map((id) => SHELF_PANELS[id]).filter(
    (panel) => panel.group === group,
  );
}

/**
 * Which panel a gesture opens.
 *
 * The whole of §4's "tap and long press must not open two different UI
 * systems": both come here, both get a panel of the same shell, and what
 * differs is only which one and what it is about.
 */
export function panelForGesture(input: {
  /** A cell was tapped: one note is the subject. */
  readonly cellSelected: boolean;
  /** A range is held: several events are the subject. */
  readonly rangeSelected: boolean;
}): ShelfPanelId | null {
  if (input.cellSelected) return "note";
  if (input.rangeSelected) return "duration";
  return null;
}

/**
 * Is this panel usable right now, and if not, why?
 *
 * The reason travels with the control rather than appearing after a press:
 * a grey button that explains itself teaches, and one that stays silent
 * reads as broken (§17).
 */
export type PanelAvailability = {
  readonly state: "available" | "disabled";
  readonly reason?: string;
};

export function panelAvailability(
  id: ShelfPanelId,
  context: {
    readonly hasCell: boolean;
    readonly hasSelection: boolean;
    readonly fretted: boolean;
    readonly canEdit: boolean;
  },
): PanelAvailability {
  if (!context.canEdit) {
    return { state: "disabled", reason: "Bu şarkı şu an düzenlenemiyor." };
  }
  switch (id) {
    case "note":
      return context.hasCell
        ? { state: "available" }
        : { state: "disabled", reason: "Önce bir nota seç." };
    case "chord":
      return context.fretted
        ? { state: "available" }
        : { state: "disabled", reason: "Bu enstrümana akor yazılamıyor." };
    case "fast_sequence":
      return context.hasCell || context.hasSelection
        ? { state: "available" }
        : { state: "disabled", reason: "Önce bir nota ya da alan seç." };
    case "duration":
      return context.hasCell || context.hasSelection
        ? { state: "available" }
        : { state: "disabled", reason: "Önce bir nota ya da alan seç." };
    case "playing":
      /*
       * A bend needs a string to bend and a note to bend it on. Both halves
       * are said, because "select a note" and "this instrument has no
       * strings" are different problems with different fixes.
       */
      if (!context.fretted) {
        return { state: "disabled", reason: "Bu enstrümanda tel yok." };
      }
      return context.hasCell
        ? { state: "available" }
        : { state: "disabled", reason: "Önce bir nota seç." };
    case "transpose":
      return { state: "available" };
    case "phrase":
      /* A phrase is made *of* held music; there is nothing to name without
         one, and an existing phrase is reached by touching its band. */
      return context.hasSelection
        ? { state: "available" }
        : { state: "disabled", reason: "Önce adlandıracağın alanı seç." };
  }
}
