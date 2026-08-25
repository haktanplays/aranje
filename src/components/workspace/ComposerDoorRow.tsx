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
      className="border-line flex flex-wrap items-center gap-2 border-t px-3 py-1"
    >
      {DOORS.map((door) => (
        <button
          key={door}
          type="button"
          data-composer-door={door}
          aria-pressed={held === door}
          onClick={() => onOpen(door)}
          className={`min-h-11 min-w-0 flex-1 basis-16 rounded-lg border px-2 text-sm ${
            held === door
              ? "border-bronze bg-bronze/15 text-bronze font-medium"
              : "border-line text-muted"
          }`}
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
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
