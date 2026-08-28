import {
  BAR_HEADER_HEIGHT,
  GUTTER_WIDTH,
  RHYTHM_ROW_HEIGHT,
} from "@/components/workspace/geometry";

/**
 * The sticky column of string or lane names.
 *
 * It stays put while the bars scroll past, so the reader can always tell
 * which row is which — and it has to be exactly as tall as the staff beside
 * it, which is why the bar header and the rhythm row are spacers here rather
 * than a margin somewhere else.
 *
 * Its own file since 2T-B §6, when the tab canvas needed room for the
 * duration gesture. This is a coherent piece — one column, one job, no state
 * — and pulling it out left the canvas doing only what a canvas does.
 */
export function TabGutter({
  labels,
  rowHeight,
  bodyHeight,
}: {
  labels: readonly string[];
  rowHeight: number;
  bodyHeight: number;
}) {
  return (
    <div
      className="bg-app sticky left-0 z-10 shrink-0"
      style={{ width: GUTTER_WIDTH }}
    >
      <div style={{ height: BAR_HEADER_HEIGHT }} />
      <div className="relative" style={{ height: bodyHeight }}>
        {labels.map((label, index) => (
          <span
            key={index}
            className="text-muted/80 absolute flex items-center justify-center font-mono text-[10px]"
            style={{ top: index * rowHeight, height: rowHeight, width: GUTTER_WIDTH }}
          >
            {label}
          </span>
        ))}
      </div>
      <div style={{ height: RHYTHM_ROW_HEIGHT }} />

      {/* Notes scrolling past the labels disappear under this strip instead of
          being sliced in half at the gutter edge. A fret glyph is about 14px
          wide, so the solid part alone is wider than any glyph can be. */}
      <span
        aria-hidden
        className="bg-app pointer-events-none absolute inset-y-0 left-full w-2.5"
      />
      <span
        aria-hidden
        className="from-app pointer-events-none absolute inset-y-0 w-4 bg-gradient-to-r to-transparent"
        style={{ left: "calc(100% + 0.625rem)" }}
      />
    </div>
  );
}
