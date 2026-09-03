"use client";

/**
 * How much music is on the screen, as six small controls (2V-B.3 §10).
 *
 * ## What these are not
 *
 * They are not a rhythm control, and the labels are the reason the distinction
 * survives contact with a reader: "2 ölçü" is a statement about the *screen*,
 * and no arrangement of these buttons can be read as choosing a note value.
 * Nothing here can change a tick, a duration or the grid a bar is written on —
 * the presses become `ZoomCommand`s, and a command has nowhere else to go.
 *
 * ## In the flow, never over the grid
 *
 * It sits inside the editor shelf: below the staff in portrait, in the side
 * inspector in landscape (§8). One line, scrollable sideways at 320px rather
 * than wrapping into a block, because the one thing a zoom control must never
 * do is take height from the thing it is zooming.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { ZOOM_PRESET_LABELS, type ViewZoom } from "@/lib/ui/use-view-zoom";
import { ZOOM_PRESET_BARS, canStepZoom } from "@/lib/ui/view-zoom";

export function ViewZoomControls({
  zoom,
  /** Which preset the current magnification really is, or null after a pinch. */
  activeBars,
  /** False when nothing is held, which is when "Seçime sığdır" has no range. */
  canFitSelection,
}: {
  zoom: ViewZoom;
  activeBars: 1 | 2 | 4 | null;
  canFitSelection: boolean;
}) {
  return (
    <div
      data-view-zoom
      className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-1"
      role="group"
      aria-label="Görünüm yakınlığı"
    >
      <ZoomButton
        label="−"
        title="Uzaklaş"
        disabled={!canStepZoom(zoom.zoom, "out")}
        onPress={() => zoom.request({ kind: "step", direction: "out" })}
      />
      {ZOOM_PRESET_BARS.map((bars) => (
        <ZoomButton
          key={bars}
          label={ZOOM_PRESET_LABELS[bars]}
          title={`Ekrana ${bars} ölçü sığdır`}
          active={activeBars === bars}
          onPress={() => zoom.request({ kind: "bars", bars })}
        />
      ))}
      <ZoomButton
        label="+"
        title="Yakınlaş"
        disabled={!canStepZoom(zoom.zoom, "in")}
        onPress={() => zoom.request({ kind: "step", direction: "in" })}
      />
      <ZoomButton
        label="Seçime sığdır"
        title={
          canFitSelection
            ? "Seçili bölümü ekrana sığdır"
            : "Önce bir bölüm seç: sığdıracak bir aralık yok"
        }
        disabled={!canFitSelection}
        onPress={() => zoom.request({ kind: "fit" })}
      />
    </div>
  );
}

function ZoomButton({
  label,
  title,
  active = false,
  disabled = false,
  onPress,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onPress}
      style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
      className={[
        "shrink-0 rounded-md border px-2 text-xs whitespace-nowrap",
        /* Steel is the palette's "selected" (spec 13.6), which is what an
           active preset is: the view is currently at that many measures. */
        active ? "border-steel text-steel bg-steel/10" : "border-line text-muted",
        disabled ? "opacity-40" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
