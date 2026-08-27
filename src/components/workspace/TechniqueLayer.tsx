"use client";

/**
 * Every technique mark over one bar's staff (Technique Notation Grammar v1).
 *
 * View only. Each coordinate comes from `buildTechniquePrimitives`, which is
 * where "which notes are one gesture" and "how much room may this mark use"
 * are answered; what is left here is an `<svg>`, two colours and a font size.
 *
 * The layer takes **no pointer events** and adds nothing to the layout. It is
 * absolutely positioned over a staff that was already measured, so no mark can
 * move a note, grow a row or open the spacing between two strings — a mark
 * that does not fit is clipped by the geometry instead.
 *
 * Colour carries no meaning on its own: read mode is the neutral grey the rest
 * of the notation uses, and the bronze accent appears only while the notes
 * under a mark are being previewed. Permanent notation is never bronze.
 */
import type {
  BendMark,
  LegatoPhrase,
  PalmMuteRange,
  SlideMark,
  TechniquePrimitives,
  VibratoMark,
} from "@/lib/tab/technique-geometry";

/** Small enough to stay out of the way, large enough to read at 320px. */
const LABEL_PX = 9;
const STROKE = 1;

type Tone = "read" | "preview";

/**
 * What every mark says about itself in the DOM.
 *
 * Which technique it is, which string owns it, whether it is in the accent,
 * and the horizontal room the pure model allowed it — the last of which is
 * what lets an acceptance run compare a *painted* box against the geometry
 * rather than trusting the path arithmetic.
 */
const markProps = (
  kind: string,
  mark: { stringIndex: number; owner: { left: number; right: number } },
  tone: Tone,
) => ({
  "data-technique": kind,
  "data-technique-string": mark.stringIndex,
  "data-technique-tone": tone,
  "data-owner": `${mark.owner.left},${mark.owner.right}`,
});

const fillOf = (tone: Tone) => (tone === "preview" ? "fill-bronze" : "fill-muted");

/** One stroke for the whole grammar: same weight, same cap, one colour rule. */
const strokeProps = (tone: Tone) => ({
  fill: "none" as const,
  className: tone === "preview" ? "stroke-bronze" : "stroke-muted",
  strokeWidth: STROKE,
  strokeLinecap: "round" as const,
});

/** One label rule too, so no mark can invent its own size. */
const labelProps = (tone: Tone) => ({
  className: fillOf(tone),
  style: { fontSize: LABEL_PX },
});

function Legato({ phrase, tone }: { phrase: LegatoPhrase; tone: Tone }) {
  return (
    <g {...markProps("legato", phrase, tone)}>
      <path d={phrase.path} {...strokeProps(tone)} />
      {phrase.marks.map((mark) => (
        <text
          key={`${mark.fromSlot}-${mark.toSlot}`}
          x={mark.x}
          y={mark.y}
          textAnchor="middle"
          {...labelProps(tone)}
        >
          {mark.text}
        </text>
      ))}
    </g>
  );
}

function Slide({ mark, tone }: { mark: SlideMark; tone: Tone }) {
  return (
    <line
      {...markProps("slide", mark, tone)}
      x1={mark.x1}
      y1={mark.y1}
      x2={mark.x2}
      y2={mark.y2}
      {...strokeProps(tone)}
    />
  );
}

function Bend({ mark, tone }: { mark: BendMark; tone: Tone }) {
  return (
    <g {...markProps("bend", mark, tone)}>
      <path d={mark.path} {...strokeProps(tone)} />
      <polygon points={mark.head} className={fillOf(tone)} />
      {mark.amount === null ? null : (
        <text
          x={mark.labelX}
          y={mark.labelY}
          textAnchor={mark.labelAnchor === "end" ? "end" : "start"}
          {...labelProps(tone)}
        >
          {mark.amount}
        </text>
      )}
    </g>
  );
}

function Vibrato({ mark, tone }: { mark: VibratoMark; tone: Tone }) {
  return (
    <path
      {...markProps("vibrato", mark, tone)}
      d={mark.path}
      {...strokeProps(tone)}
    />
  );
}

function PalmMute({ range, tone }: { range: PalmMuteRange; tone: Tone }) {
  return (
    <g {...markProps("palm-mute", range, tone)}>
      <text x={range.labelX} y={range.labelY} {...labelProps(tone)}>
        PM
      </text>
      {range.rail.right > range.rail.left ? (
        <line
          x1={range.rail.left}
          y1={range.railY}
          x2={range.rail.right}
          y2={range.railY}
          {...strokeProps(tone)}
          strokeDasharray="2 2"
        />
      ) : null}
      <line
        x1={range.capX}
        y1={range.capTop}
        x2={range.capX}
        y2={range.capBottom}
        {...strokeProps(tone)}
      />
    </g>
  );
}

export function TechniqueLayer({
  primitives,
  width,
  height,
  preview,
}: {
  primitives: TechniquePrimitives;
  width: number;
  height: number;
  /**
   * Whether one note is the one under the reader's hand right now.
   *
   * Asked per note rather than handed a set, because the two things that can
   * put a note under a hand — the selected cell and the group selection —
   * are keyed differently, and flattening them into one set here would mean
   * building six keys per slot for every bar on screen.
   */
  preview?: (stringIndex: number, slot: number) => boolean;
}) {
  if (primitives.count === 0) return null;

  const toneFor = (stringIndex: number, slots: readonly number[]): Tone =>
    preview && slots.some((slot) => preview(stringIndex, slot))
      ? "preview"
      : "read";

  const { legato, slides, bends, vibratos, palmMutes } = primitives;
  const labels = [legato, slides, bends, vibratos, palmMutes]
    .flat()
    .map((mark) => mark.label);

  return (
    <svg
      data-technique-layer={primitives.count}
      data-legato-arcs={legato.length}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={width}
      height={height}
      role="img"
      aria-label={labels.join(", ")}
    >
      {legato.map((phrase) => (
        <Legato
          key={`legato-${phrase.stringIndex}-${phrase.slots[0]}`}
          phrase={phrase}
          tone={toneFor(phrase.stringIndex, phrase.slots)}
        />
      ))}
      {slides.map((mark) => (
        <Slide
          key={`slide-${mark.stringIndex}-${mark.slot}`}
          mark={mark}
          tone={toneFor(mark.stringIndex, [mark.slot])}
        />
      ))}
      {bends.map((mark) => (
        <Bend
          key={`bend-${mark.stringIndex}-${mark.slot}`}
          mark={mark}
          tone={toneFor(mark.stringIndex, [mark.slot])}
        />
      ))}
      {vibratos.map((mark) => (
        <Vibrato
          key={`vibrato-${mark.stringIndex}-${mark.slot}`}
          mark={mark}
          tone={toneFor(mark.stringIndex, [mark.slot])}
        />
      ))}
      {palmMutes.map((range) => (
        <PalmMute
          key={`pm-${range.stringIndex}-${range.slots[0]}`}
          range={range}
          tone={toneFor(range.stringIndex, range.slots)}
        />
      ))}
    </svg>
  );
}
