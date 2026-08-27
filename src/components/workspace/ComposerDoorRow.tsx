"use client";

/**
 * The four doors of the edit surface (2S-A §6, §11; K-59 §5).
 *
 * Nota, Şekil, Ritim, Bağla. A door is a place, not a mode: it opens a sheet
 * with the things behind it, and behind each one there is at least one thing
 * that works. A door that opened onto nothing would be worse than a missing
 * one, which is why the model asserts every door has a tool.
 *
 * ## The held tool has no chip of its own
 *
 * It used to. A fifth strip beside the four doors said "Power chord · 3 ses ·
 * 5. perde", which is a control that states something rather than doing
 * something, and on a 320px row it was the width of a door — a door the
 * reader might actually want. What the reader needs to know is which door is
 * holding something and what; so the door says it, and `Şekil` reads `Power 3`
 * while the pen is up.
 *
 * The short form is what is *drawn*. The whole sentence is the accessible
 * name, so nothing is cut for a reader who cannot see the row, and no door
 * has to truncate to fit four of them on the narrowest screen this pilot
 * supports.
 *
 * Letting go is the same gesture as picking up: choosing the held tool again
 * inside its own sheet releases it (`activate`), which is one rule rather
 * than a control that only exists while something is held.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  doorAccessibleName,
  doorLabel,
  doorOf,
  type ComposerDoor,
  type ComposerTool,
} from "@/lib/workspace/composer-tool";

const DOORS: readonly ComposerDoor[] = ["note", "shape", "rhythm", "connect"];

export function ComposerDoorRow({
  tool,
  onOpen,
}: {
  tool: ComposerTool;
  onOpen: (door: ComposerDoor) => void;
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
          data-composer-door-held={held === door ? "" : undefined}
          aria-pressed={held === door}
          aria-label={doorAccessibleName(door, tool)}
          onClick={() => onOpen(door)}
          /*
           * The label never wraps inside its own button. With `min-w-0` it
           * would, and a four-door row would silently become two lines tall
           * without the row itself wrapping — which reads as a bug and costs
           * the music the same height either way. Let the *row* wrap instead,
           * where the reader can see why.
           */
          className={`min-h-11 min-w-0 flex-1 rounded-lg border px-1.5 whitespace-nowrap ${
            held === door
              ? "border-bronze bg-bronze/15 text-bronze text-xs font-medium"
              : "border-line text-muted text-sm"
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
          <span data-composer-door-label aria-hidden>
            {doorLabel(door, tool)}
          </span>
        </button>
      ))}
    </div>
  );
}
