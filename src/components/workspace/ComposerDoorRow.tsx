"use client";

/**
 * The four doors of the edit surface (2S-A §6, §11).
 *
 * Nota, Şekil, Ritim, Bağla. A door is a place, not a mode: it opens a sheet
 * with the things behind it, and behind each one there is at least one thing
 * that works. A door that opened onto nothing would be worse than a missing
 * one, which is why the model asserts every door has a tool.
 *
 * The chip on the right says what is being held, in Turkish and about music —
 * "Power chord · 2 ses · 5. perde", not an identifier — so the reader can see
 * at a glance that the next tap will not be an ordinary tap.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  DOOR_LABELS,
  doorOf,
  isArmed,
  toolLabel,
  type ComposerDoor,
  type ComposerTool,
} from "@/lib/workspace/composer-tool";

const DOORS: readonly ComposerDoor[] = ["note", "shape", "rhythm", "connect"];

export function ComposerDoorRow({
  tool,
  onOpen,
  onRelease,
}: {
  tool: ComposerTool;
  onOpen: (door: ComposerDoor) => void;
  onRelease: () => void;
}) {
  const held = doorOf(tool);

  return (
    <div
      data-composer-doors
      /*
       * No border and no vertical padding of its own: the action row under it
       * already draws one, and on a 320px screen at 150% text every rule and
       * every eight pixels is taken from the music (2S-A §11).
       */
      className="flex flex-wrap items-center gap-1.5 px-3 pt-1"
    >
      {DOORS.map((door) => (
        <button
          key={door}
          type="button"
          data-composer-door={door}
          aria-pressed={held === door}
          onClick={() => onOpen(door)}
          /*
           * The label never wraps inside its own button. With `min-w-0` it
           * would, and a four-door row would silently become two lines tall
           * without the row itself wrapping — which reads as a bug and costs
           * the music the same height either way. Let the *row* wrap instead,
           * where the reader can see why.
           */
          className={`min-h-11 min-w-0 flex-1 rounded-lg border px-1.5 text-sm whitespace-nowrap ${
            held === door
              ? "border-bronze bg-bronze/15 text-bronze font-medium"
              : "border-line text-muted"
          }`}
          /*
           * The basis is pixels, not rem. A rem basis grows with the reader's
           * text setting, and four doors that each want 3.5rem stop fitting a
           * 320px row at 125% — so the row wrapped for a reason that had
           * nothing to do with the words in it. How wide a phone is does not
           * change with the text size.
           */
          style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: 56 }}
        >
          {DOOR_LABELS[door]}
        </button>
      ))}
      {isArmed(tool) ? (
        <button
          type="button"
          data-composer-held
          onClick={onRelease}
          aria-label={`${toolLabel(tool)} — bırak`}
          /* The held tool takes the whole line: it is a statement, not a door. */
          className="border-bronze text-bronze flex min-h-11 basis-full items-center justify-between rounded-lg border px-3 text-xs"
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        >
          <span className="truncate">{toolLabel(tool)}</span>
          <span aria-hidden className="pl-2">
            ✕
          </span>
        </button>
      ) : null}
    </div>
  );
}
