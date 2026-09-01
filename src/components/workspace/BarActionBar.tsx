"use client";

/**
 * What you can do with a range of bars (spec 13.12, K-43).
 *
 * The same seven primary actions as the note selection, because they are the
 * same seven verbs and a reader should not have to learn two vocabularies for
 * one idea. What differs is the summary line, which says out loud which of the
 * two scopes is in play — "Ritim Gitar · 2 ölçü" and "Tüm enstrümanlar · 2
 * ölçü" are different enough operations that guessing is not acceptable.
 *
 * ## Only what works, and a door only where there is something behind it
 *
 * The "Daha fazla" sheet lists operations valid in the current scope and
 * nothing else. A menu of greyed-out entries is a menu that spends the
 * reader's attention on things they cannot do — and, worse, teaches them that
 * some of this app's controls are decorative.
 *
 * Which is why the door itself is conditional (2U-B §6). "Only what works"
 * used to be true of the sheet and false of the button that opened it: on one
 * instrument's bar with an empty clipboard every entry was filtered out and
 * the door still stood there, so the reader was invited into an empty dialog.
 * Both now read `bar-menu.ts` — one list, so the door cannot promise contents
 * the sheet does not have.
 *
 * ## The verbs are named for the scope they act in
 *
 * "Sil" means two different things here. On one instrument's bars it empties
 * a lane and the section keeps its length; on a whole measure it takes a bar
 * out of the song. One word for both is how a reader ends up doing the second
 * while believing they did the first, so each scope says which it is.
 *
 * Every mutation stages rather than commits. The strip below the buttons says
 * what would happen; "Uygula" is the single place a bar operation becomes a
 * write, and "Vazgeç" leaves the song exactly as it was found.
 *
 * ## Why the refusal is not in here
 *
 * A refusal can take the selection away with it — a chain that leaves the
 * section is refused at the selection itself, so there is nothing left to hold.
 * An error rendered inside this component would be destroyed by the very event
 * it exists to explain, and the reader would watch their selection vanish in
 * silence. So it is raised one level, where it outlives the thing that failed.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  onSurface,
  type SelectionActionId,
  type SelectionActionOffer,
} from "@/lib/song/selection-action-canon";
import {
  barMoreDoorShown,
  barMoreEntries,
  type BarMoreAction,
} from "@/lib/song/bar-menu";
import type { BarPreview } from "@/lib/song/use-bar-transform";
import type { BarSelection } from "@/lib/song/bar-selection";

export type { BarMoreAction };

/**
 * What a press means. The canon's ids, so this row and the area that wires it
 * cannot name the same control two ways (2V-B §3).
 */
export type BarAction = SelectionActionId;

/**
 * How many times "Tekrarla" repeats.
 *
 * Small whole numbers, plus — on a track selection only — filling what is left
 * of the section. Filling a *full* selection is not offered because it has no
 * answer: adding bars moves the end it is measured against, so the request
 * cannot be turned into a number of repeats without inventing one.
 */
const REPEAT_COUNTS = [2, 3, 4] as const;

export type BarRepeatChoice =
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "fill_to_section_end" };

export function BarActionBar({
  selection,
  actions,
  summary,
  notice,
  preview,
  hasClipboard,
  clipboardScope,
  moreOpen,
  moveOpen,
  repeatOpen,
  onAction,
  onMore,
  onRepeat,
  onCloseMore,
  onMoveLeft,
  onMoveRight,
  onApply,
  onReplace,
  onCancel,
  onClear,
  onScope,
}: {
  selection: BarSelection;
  /**
   * What this run of bars offers, placed and labelled by the canon (§3).
   *
   * The seven buttons here used to be a hard-coded list with three verbs and
   * four blanks behind it — nothing asked the model whether "Taşı" had
   * anywhere to go, so on a one-bar section it stood live and opened two dead
   * arrows. They are drawn from the model's answer now, in the scope's own
   * words, and greyed with the model's own sentence.
   */
  actions: readonly SelectionActionOffer[];
  summary: string;
  notice: string | null;
  preview: BarPreview | null;
  hasClipboard: boolean;
  clipboardScope: "track" | "full" | null;
  moreOpen: boolean;
  moveOpen: boolean;
  repeatOpen: boolean;
  onAction: (action: BarAction) => void;
  onMore: (action: BarMoreAction) => void;
  onRepeat: (choice: BarRepeatChoice) => void;
  onCloseMore: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onApply: () => void;
  onReplace: () => void;
  onCancel: () => void;
  onClear: () => void;
  /** Switch between one instrument's content and the whole measure (§6). */
  onScope: (scope: "track" | "full") => void;
}) {
  const full = selection.scope === "full";
  /*
   * A clipboard from the other scope is not offered at all. The two are never
   * silently converted, so a track clipboard has nothing to say to a full
   * selection and the reader is not asked to find that out by trying.
   */
  const canPaste = hasClipboard && clipboardScope === selection.scope;

  /*
   * What is behind "Daha fazla" (2U-B §6). The door below and the sheet at
   * the bottom read this same list, which is what makes an empty dialog
   * unreachable rather than merely unlikely.
   */
  const moreEntries = barMoreEntries(selection.scope, canPaste);
  /*
   * And the two listening intents, which are selection actions rather than
   * bar-structure ones and so come from the canon (2V-B §6). The capability
   * model has offered them on a run of bars since 2V-A; until now no surface
   * drew them, which is the "available but hidden" state §4 forbids.
   */
  const listen = onSurface(actions, "more_sheet");
  const primary = onSurface(actions, "measure_primary");

  return (
    <div
      data-bar-action-bar
      className="border-app bg-app safe-bottom border-t"
      role="toolbar"
      aria-label="Ölçü işlemleri"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <p data-bar-summary className="text-muted truncate text-sm">
          {summary}
        </p>
        <button
          type="button"
          onClick={onClear}
          aria-label="Ölçü seçimini iptal et"
          className="text-muted shrink-0 px-2 text-sm underline"
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        >
          İptal
        </button>
      </div>

      {/*
        Which of the two this selection is, and the way to the other one
        (2U-B §6).

        The scopes used to be told apart only by *which gesture made them* — a
        press on the tab meant one instrument, a press in the arrangement meant
        the whole bar — so from the tab the whole-measure scope was simply
        unreachable, and with it every verb that only exists there. Adding a
        bar was a thing the app could do and the reader could not get to.

        Two radio buttons rather than a toggle, because "Gitar" and "Tüm
        enstrümanlar" are two states a reader should be able to see at once
        rather than infer from the label of a button that will change it.
      */}
      <div
        role="radiogroup"
        aria-label="Seçim kapsamı"
        className="flex items-center gap-1 px-3 pt-2"
      >
        {(
          [
            { scope: "track" as const, label: "Bu enstrüman" },
            { scope: "full" as const, label: "Tüm enstrümanlar" },
          ]
        ).map((entry) => {
          const on = selection.scope === entry.scope;
          return (
            <button
              key={entry.scope}
              type="button"
              role="radio"
              aria-checked={on}
              data-bar-scope={entry.scope}
              onClick={() => onScope(entry.scope)}
              className={`min-w-0 flex-1 truncate rounded-md border px-2 text-xs ${
                on ? "border-bronze text-bronze" : "border-line text-muted"
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {notice ? (
        <p data-bar-notice role="status" className="text-muted px-3 pt-1 text-sm">
          {notice}
        </p>
      ) : null}

      {/* The ghost, and the only place a bar operation becomes a write. */}
      {preview ? (
        <div className="border-line mx-3 mt-2 rounded-lg border px-3 py-2">
          <p
            data-bar-preview
            className={`text-sm ${preview.ok ? "text-muted" : "text-reject"}`}
          >
            {preview.text}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-muted border-line flex-1 rounded-lg border text-sm"
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              Vazgeç
            </button>
            {!preview.ok && preview.canReplace ? (
              <button
                type="button"
                data-bar-replace
                onClick={onReplace}
                className="border-bronze text-bronze flex-1 rounded-lg border text-sm font-medium"
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              >
                {full ? "Bütün ölçünün içeriğini değiştir" : "Yerine koy"}
              </button>
            ) : (
              <button
                type="button"
                data-bar-apply
                onClick={onApply}
                disabled={!preview.ok}
                className="border-bronze text-bronze flex-1 rounded-lg border text-sm font-medium disabled:opacity-40"
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              >
                Uygula
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/*
        Move is two steps rather than a sheet: one bar left, one bar right.
        Shown only while "Taşı" is the chosen action, because a control that is
        always on screen and only sometimes meaningful is a control a reader
        has to keep re-reading.
      */}
      {moveOpen ? (
        <div className="flex items-center gap-2 px-3 pt-2">
          <button
            type="button"
            data-bar-move-left
            onClick={onMoveLeft}
            aria-label="Bir ölçü sola taşı"
            className="text-muted border-line flex-1 rounded-lg border text-sm"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            <span aria-hidden>&#8592;</span> Sola
          </button>
          <button
            type="button"
            data-bar-move-right
            onClick={onMoveRight}
            aria-label="Bir ölçü sağa taşı"
            className="text-muted border-line flex-1 rounded-lg border text-sm"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Sağa <span aria-hidden>&#8594;</span>
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-1 p-2">
        {primary
          .filter(
            /* A door with nothing behind it is not drawn at all (2U-B §6). */
            (entry) =>
              entry.id !== "more" ||
              barMoreDoorShown(selection.scope, canPaste) ||
              listen.length > 0,
          )
          .map((entry) => {
            const off = entry.availability === "disabled";
            return (
              <button
                key={entry.id}
                type="button"
                data-bar-action={entry.id}
                /* The canon's id, on every surface that draws one (§10). */
                data-selection-action-id={entry.id}
                onClick={() => onAction(entry.id)}
                disabled={off}
                title={off ? entry.reason : undefined}
                aria-label={off ? `${entry.label} — ${entry.reason}` : entry.label}
                className={`flex flex-col items-center justify-center rounded-md border px-0.5 text-[10px] leading-tight ${
                  off ? "border-app/50 text-muted/40" : "border-app"
                }`}
                style={{
                  minHeight: MIN_TOUCH_TARGET_PX,
                  minWidth: MIN_TOUCH_TARGET_PX,
                }}
              >
                <span className="truncate">{entry.label}</span>
              </button>
            );
          })}
      </div>

      <Sheet
        open={repeatOpen}
        title="Kaç kez tekrarlansın?"
        onClose={onCloseMore}
        labelledBy="bar-repeat-title"
      >
        <div className="flex flex-col gap-2">
          {REPEAT_COUNTS.map((count) => (
            <SheetButton
              key={count}
              onClick={() => onRepeat({ kind: "count", count })}
            >
              {count} kez
            </SheetButton>
          ))}
          {!full ? (
            <SheetButton onClick={() => onRepeat({ kind: "fill_to_section_end" })}>
              Bölüm sonuna kadar
            </SheetButton>
          ) : null}
        </div>
      </Sheet>

      <Sheet
        open={moreOpen}
        title={full ? "Ölçü işlemleri" : "Bu enstrümanın ölçüsü"}
        onClose={onCloseMore}
        labelledBy="bar-more-title"
      >
        <div className="flex flex-col gap-2">
          {/*
            "Ölçü ve ritim" sits first because it is the question a reader
            arrives with — "why does this bar have eight cells" — rather than
            something they go looking for after deciding to edit. It is in the
            list above, in the order the list gives.
          */}
          {moreEntries.map((entry) => (
            <SheetButton
              key={entry.action}
              data-testid={`bar-more-${entry.action}`}
              onClick={() => onMore(entry.action)}
            >
              {entry.label}
            </SheetButton>
          ))}
          {listen.map((entry) => {
            const off = entry.availability === "disabled";
            return (
              <SheetButton
                key={entry.id}
                data-testid={`bar-more-${entry.id}`}
                data-selection-action-id={entry.id}
                disabled={off}
                onClick={() => onAction(entry.id)}
              >
                {entry.label}
              </SheetButton>
            );
          })}
        </div>
      </Sheet>

    </div>
  );
}
