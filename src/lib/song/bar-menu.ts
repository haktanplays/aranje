/**
 * What is behind "Daha fazla" on a bar selection (2U-B §6).
 *
 * ## Why this is not a list of `&&`s in the sheet
 *
 * The founder held one instrument's bar, opened "Daha fazla", and got a
 * titled dialog with nothing in it. Every entry the sheet drew was guarded by
 * `full` or by `canPaste`; the door that opened the sheet was guarded by
 * nothing. On a track selection with an empty clipboard both guards were
 * false and the door still stood there, so the reader was invited into a
 * screen that had been carefully emptied for them.
 *
 * The bug was not a missing guard on the door. It was that the door and the
 * sheet were two lists, so one could be empty while the other believed
 * otherwise. Here they are one list: what the door leads to *is* what the
 * sheet draws, and "is there anything behind this door" is `length > 0`.
 *
 * ## Why the track scope has so little in it
 *
 * Because adding and removing bars are not things one instrument can do.
 * A bar inserted into the guitar and not the bass is not a longer song, it is
 * two songs of different lengths — so those verbs belong to the whole-measure
 * scope, and `selection-capability.ts` refuses them in the track scope for
 * exactly the same reason. What a track selection *can* do to its content —
 * empty it, copy it, nudge it — is already on the row of primary buttons,
 * named as content rather than as bars.
 *
 * Nothing here writes, refuses or previews. It names what may be offered.
 */

/** The entries the "Daha fazla" sheet can hold, in the order it draws them. */
export type BarMoreAction =
  /** Open the meter-and-rhythm sheet for this bar (spec 13.20 §6). */
  | "timing"
  | "paste"
  | "blank_before"
  | "blank_after"
  | "insert_before"
  | "insert_after";

export type BarMoreEntry = {
  readonly action: BarMoreAction;
  readonly label: string;
};

/**
 * What this selection may be offered behind the door.
 *
 * `canPaste` is already the answer to "is there a clipboard, and is it from
 * this same scope" — the two are never silently converted, so a track
 * clipboard has nothing to say to a whole-measure selection and the reader is
 * not asked to discover that by trying.
 */
export function barMoreEntries(
  scope: "track" | "full",
  canPaste: boolean,
): readonly BarMoreEntry[] {
  const full = scope === "full";
  return [
    /*
     * First, because it is the question a reader arrives with — "why does
     * this bar have eight cells" — rather than something they go looking for
     * after deciding to edit. A bar's metre and grid are properties of the
     * bar, shared by every track written in it, so it is whole-measure work.
     */
    ...(full ? [{ action: "timing" as const, label: "Ölçü ve ritim" }] : []),
    ...(canPaste ? [{ action: "paste" as const, label: "Buraya yapıştır" }] : []),
    ...(full
      ? [
          { action: "blank_before" as const, label: "Önüne ölçü ekle" },
          { action: "blank_after" as const, label: "Arkasına ölçü ekle" },
        ]
      : []),
    ...(full && canPaste
      ? [
          {
            action: "insert_before" as const,
            label: "Kopyalanan ölçüleri önüne ekle",
          },
          {
            action: "insert_after" as const,
            label: "Kopyalanan ölçüleri arkasına ekle",
          },
        ]
      : []),
  ];
}

/**
 * Whether the door should be drawn at all.
 *
 * The one rule the empty dialog broke: a door the reader can open must lead
 * somewhere. Expressed against the same list the sheet renders, so the two
 * cannot disagree.
 */
export function barMoreDoorShown(
  scope: "track" | "full",
  canPaste: boolean,
): boolean {
  return barMoreEntries(scope, canPaste).length > 0;
}
