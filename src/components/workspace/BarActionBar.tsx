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
 * ## Only what works
 *
 * The "Daha fazla" sheet lists operations valid in the current scope and
 * nothing else. A menu of greyed-out entries is a menu that spends the
 * reader's attention on things they cannot do — and, worse, teaches them that
 * some of this app's controls are decorative.
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
import type { BarPreview } from "@/lib/song/use-bar-transform";
import type { BarSelection } from "@/lib/song/bar-selection";

export type BarAction =
  | "copy"
  | "cut"
  | "duplicate"
  | "repeat"
  | "move"
  | "delete"
  | "more";

const PRIMARY: readonly { readonly action: BarAction; readonly label: string }[] = [
  { action: "copy", label: "Kopyala" },
  { action: "cut", label: "Kes" },
  { action: "duplicate", label: "Çoğalt" },
  { action: "repeat", label: "Tekrarla" },
  { action: "move", label: "Taşı" },
  { action: "delete", label: "Sil" },
  { action: "more", label: "Daha fazla" },
];

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

export type BarMoreAction =
  | "paste"
  | "blank_before"
  | "blank_after"
  | "insert_before"
  | "insert_after";

export function BarActionBar({
  selection,
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
}: {
  selection: BarSelection;
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
}) {
  const full = selection.scope === "full";
  /*
   * A clipboard from the other scope is not offered at all. The two are never
   * silently converted, so a track clipboard has nothing to say to a full
   * selection and the reader is not asked to find that out by trying.
   */
  const canPaste = hasClipboard && clipboardScope === selection.scope;

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
        {PRIMARY.map((entry) => (
          <button
            key={entry.action}
            type="button"
            data-bar-action={entry.action}
            onClick={() => onAction(entry.action)}
            aria-label={entry.label}
            className="border-app flex flex-col items-center justify-center rounded-md border px-0.5 text-[10px] leading-tight"
            style={{
              minHeight: MIN_TOUCH_TARGET_PX,
              minWidth: MIN_TOUCH_TARGET_PX,
            }}
          >
            <span className="truncate">{entry.label}</span>
          </button>
        ))}
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
        title="Ölçü işlemleri"
        onClose={onCloseMore}
        labelledBy="bar-more-title"
      >
        <div className="flex flex-col gap-2">
          {canPaste ? (
            <SheetButton onClick={() => onMore("paste")}>Buraya yapıştır</SheetButton>
          ) : null}
          {/*
            Structural operations belong to the whole bar. Offering them on a
            single track's selection would be offering to change every other
            track without saying so.
          */}
          {full ? (
            <>
              <SheetButton onClick={() => onMore("blank_before")}>
                Önüne boş ölçü ekle
              </SheetButton>
              <SheetButton onClick={() => onMore("blank_after")}>
                Arkasına boş ölçü ekle
              </SheetButton>
            </>
          ) : null}
          {full && canPaste ? (
            <>
              <SheetButton onClick={() => onMore("insert_before")}>
                Kopyalanan ölçüleri önüne ekle
              </SheetButton>
              <SheetButton onClick={() => onMore("insert_after")}>
                Kopyalanan ölçüleri arkasına ekle
              </SheetButton>
            </>
          ) : null}
        </div>
      </Sheet>

    </div>
  );
}
