"use client";

/**
 * The hammer-on and pull-off arcs over one bar's staff (2S-A §4).
 *
 * View only: every coordinate comes from `buildLegatoArcs`, which is where the
 * question "where does this curve go" is answered. What is left here is an
 * `<svg>` and a colour.
 *
 * The layer takes **no pointer events**. An arc says something about two
 * notes; it is not a control, and a finger that lands on one has to reach the
 * cell underneath it.
 */
import type { LegatoArc } from "@/lib/tab/legato-arc";

export function LegatoArcLayer({
  arcs,
  width,
  height,
  showEndpoints = false,
}: {
  arcs: readonly LegatoArc[];
  width: number;
  height: number;
  /** True while the pair is selected or a decision about it is pending. */
  showEndpoints?: boolean;
}) {
  if (arcs.length === 0) return null;

  return (
    <svg
      data-legato-arcs={arcs.length}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={width}
      height={height}
      aria-hidden={false}
      role="img"
      aria-label={arcs.map((arc) => arc.label).join(", ")}
    >
      {arcs.map((arc) => (
        <g key={`${arc.stringIndex}-${arc.fromSlot}-${arc.toSlot}`}>
          <path
            d={arc.path}
            fill="none"
            className="stroke-muted"
            strokeWidth={1}
            strokeLinecap="round"
          />
          <text
            x={arc.markX}
            y={arc.markY - 1}
            textAnchor="middle"
            className="fill-muted"
            style={{ fontSize: 8 }}
          >
            {arc.mark}
          </text>
          {showEndpoints
            ? arc.endpoints.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={1.6}
                  className="fill-accept"
                />
              ))
            : null}
        </g>
      ))}
    </svg>
  );
}
