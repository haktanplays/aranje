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

const strokeOf = (tone: Tone) =>
  tone === "preview" ? "stroke-bronze" : "stroke-muted";
const fillOf = (tone: Tone) => (tone === "preview" ? "fill-bronze" : "fill-muted");

function Legato({ phrase, tone }: { phrase: LegatoPhrase; tone: Tone }) {
  return (
    <g
      data-technique="legato"
      data-technique-string={phrase.stringIndex}
      data-technique-tone={tone}
    >
      <path
        d={phrase.path}
        fill="none"
        className={strokeOf(tone)}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      {phrase.marks.map((mark) => (
        <text
          key={`${mark.fromSlot}-${mark.toSlot}`}
          x={mark.x}
          y={mark.y}
          textAnchor="middle"
          className={fillOf(tone)}
          style={{ fontSize: LABEL_PX }}
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
      data-technique="slide"
      data-technique-string={mark.stringIndex}
      data-technique-tone={tone}
      x1={mark.x1}
      y1={mark.y1}
      x2={mark.x2}
      y2={mark.y2}
      className={strokeOf(tone)}
      strokeWidth={STROKE}
      strokeLinecap="round"
    />
  );
}

function Bend({ mark, tone }: { mark: BendMark; tone: Tone }) {
  return (
    <g
      data-technique="bend"
      data-technique-string={mark.stringIndex}
      data-technique-tone={tone}
    >
      <path
        d={mark.path}
        fill="none"
        className={strokeOf(tone)}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <polygon points={mark.head} className={fillOf(tone)} />
      {mark.amount === null ? null : (
        <text
          x={mark.labelX}
          y={mark.labelY}
          textAnchor={mark.labelAnchor === "end" ? "end" : "start"}
          className={fillOf(tone)}
          style={{ fontSize: LABEL_PX }}
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
      data-technique="vibrato"
      data-technique-string={mark.stringIndex}
      data-technique-tone={tone}
      d={mark.path}
      fill="none"
      className={strokeOf(tone)}
      strokeWidth={STROKE}
      strokeLinecap="round"
    />
  );
}

function PalmMute({ range, tone }: { range: PalmMuteRange; tone: Tone }) {
  return (
    <g
      data-technique="palm-mute"
      data-technique-string={range.stringIndex}
      data-technique-tone={tone}
    >
      <text
        x={range.labelX}
        y={range.labelY}
        className={fillOf(tone)}
        style={{ fontSize: LABEL_PX }}
      >
        PM
      </text>
      {range.rail.right > range.rail.left ? (
        <line
          x1={range.rail.left}
          y1={range.railY}
          x2={range.rail.right}
          y2={range.railY}
          className={strokeOf(tone)}
          strokeWidth={STROKE}
          strokeDasharray="2 2"
        />
      ) : null}
      <line
        x1={range.capX}
        y1={range.capTop}
        x2={range.capX}
        y2={range.capBottom}
        className={strokeOf(tone)}
        strokeWidth={STROKE}
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

  const labels = [
    ...primitives.legato.map((phrase) => phrase.label),
    ...primitives.slides.map((mark) => mark.label),
    ...primitives.bends.map((mark) => mark.label),
    ...primitives.vibratos.map((mark) => mark.label),
    ...primitives.palmMutes.map((range) => range.label),
  ];

  return (
    <svg
      data-technique-layer={primitives.count}
      data-legato-arcs={primitives.legato.length}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={width}
      height={height}
      role="img"
      aria-label={labels.join(", ")}
    >
      {primitives.legato.map((phrase) => (
        <Legato
          key={`legato-${phrase.stringIndex}-${phrase.slots[0]}`}
          phrase={phrase}
          tone={toneFor(phrase.stringIndex, phrase.slots)}
        />
      ))}
      {primitives.slides.map((mark) => (
        <Slide
          key={`slide-${mark.stringIndex}-${mark.slot}`}
          mark={mark}
          tone={toneFor(mark.stringIndex, [mark.slot])}
        />
      ))}
      {primitives.bends.map((mark) => (
        <Bend
          key={`bend-${mark.stringIndex}-${mark.slot}`}
          mark={mark}
          tone={toneFor(mark.stringIndex, [mark.slot])}
        />
      ))}
      {primitives.vibratos.map((mark) => (
        <Vibrato
          key={`vibrato-${mark.stringIndex}-${mark.slot}`}
          mark={mark}
          tone={toneFor(mark.stringIndex, [mark.slot])}
        />
      ))}
      {primitives.palmMutes.map((range) => (
        <PalmMute
          key={`pm-${range.stringIndex}-${range.slots[0]}`}
          range={range}
          tone={toneFor(range.stringIndex, range.slots)}
        />
      ))}
    </svg>
  );
}
