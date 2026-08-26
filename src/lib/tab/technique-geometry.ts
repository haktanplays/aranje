/**
 * How a note is *played*, drawn (Technique Notation Grammar v1).
 *
 * The Song Contract has been able to say `hammer_on`, `pull_off`, `slide`,
 * `bend_half`, `bend_full`, `vibrato` and `palm_mute` since 2F, and the audio
 * engine has played all seven since 2P-A. The tab did not show them: a run of
 * six slurred notes came out as four separate little arcs, a bend was the
 * characters `b1` beside the number, a slide was a `/` and a palm mute wrote
 * `PM` again over every single note of a muted passage. This module is where
 * that becomes notation.
 *
 * ## What lives here and what does not
 *
 * Everything that is a *decision* lives here: which notes belong to one
 * gesture, how much horizontal room that gesture owns, which band of the staff
 * it may draw in, and the exact path of the mark. `TechniqueLayer` places what
 * comes back and decides nothing, so a technique cannot come out looking like
 * one thing on the Tab surface and another thing in the Çoklu view.
 *
 * ## The two shared measurements
 *
 * - **The owner slot.** A mark belongs to one note, and the room it may use is
 *   the room between that note and its neighbours on the same string — the two
 *   midpoints, inset, clipped at the bar line. Neither neighbour can dispute a
 *   midpoint, so no mark can reach into another number's space, and a mark that
 *   does not fit is *clipped* rather than answered by opening note spacing.
 * - **The annotation lane.** The vertical band between the owning string and
 *   the one above it, kept clear of both lines. It is the gap the staff already
 *   has: nothing here changes a row height, a string spacing or a note's x or
 *   y, and none of these primitives is measured by the layout.
 *
 * ## What is deliberately absent
 *
 * Let ring, natural harmonics, pinch harmonics and the tremolo arm are drawn
 * nowhere, because the Song Contract has no field for any of them. Borrowing
 * a tie, a vibrato or a bend to stand in for one would put a claim on the page
 * that the data cannot support; they are written down as visual-spec debt
 * instead (`docs/TECHNIQUE-NOTATION.md`).
 */
import { pitchToMidi } from "@/lib/music/pitch";
import { glyphText, legatoLabel, maskWidthFor } from "@/lib/tab/glyph-model";
import type { FrettedBar, TabSpan } from "@/lib/tab/timeline";

export type TechniqueLayout = {
  readonly slotWidth: number;
  readonly stringRowHeight: number;
  readonly stringCount: number;
  /** Top of a string's row, in the bar's own pixel space. */
  readonly rowTop: (stringIndex: number) => number;
};

/** A horizontal span in the bar's own pixel space. */
export type Extent = { readonly left: number; readonly right: number };
/** A vertical band in the bar's own pixel space. */
export type Lane = { readonly top: number; readonly bottom: number };

/** How far inside its own room a mark has to stay, on each side. */
export const SLOT_INSET_PX = 4;
/** How far a mark keeps clear of the string lines above and below it. */
export const LANE_CLEAR_PX = 4;

const ARC_OVERHANG_PX = 5;
const ARC_RISE_PX = 7;
const SLIDE_TILT_PX = 3;
const SLIDE_MAX_PX = 14;
const BEND_RUN_PX = 8;
const BEND_RISE_PX = 10;
const BEND_HEAD_PX = 2.6;
const VIBRATO_AMPLITUDE_PX = 2;
const VIBRATO_CYCLES = 3;
const VIBRATO_BASE_PX = 12;
const VIBRATO_PER_SLOT_PX = 6;
const VIBRATO_FLOOR_PX = 8;
/** "PM" at the 9px technique size, from the same advance the digits use. */
const LABEL_ADVANCE_PX = 5.42;
const PM_LABEL_PX = LABEL_ADVANCE_PX * 2;
const PM_CAP_PX = 4;

const round = (value: number): number => Math.round(value * 100) / 100;

export type LegatoMark = {
  readonly text: "H" | "P";
  readonly x: number;
  readonly y: number;
  readonly fromSlot: number;
  readonly toSlot: number;
  readonly fromFret: number | null;
  readonly toFret: number | null;
  readonly label: string;
};

export type LegatoPhrase = {
  readonly stringIndex: number;
  /** Every onset under the arc, source note first. Always two or more. */
  readonly slots: readonly number[];
  /** One shallow quadratic over the whole run. */
  readonly path: string;
  readonly marks: readonly LegatoMark[];
  readonly extent: Extent;
  readonly label: string;
};

export type SlideMark = {
  readonly stringIndex: number;
  readonly slot: number;
  /** True when the *sounding pitch* rises, whatever the fret numbers do. */
  readonly rising: boolean;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly label: string;
};

export type BendMark = {
  readonly stringIndex: number;
  readonly slot: number;
  /** The same short curve for every bend: length never encodes amount. */
  readonly path: string;
  readonly head: string;
  /** The real amount the contract carries, or null when it carries none. */
  readonly amount: "½" | "1" | null;
  readonly labelX: number;
  readonly labelY: number;
  readonly labelAnchor: "start" | "end";
  readonly label: string;
};

export type VibratoMark = {
  readonly stringIndex: number;
  readonly slot: number;
  readonly path: string;
  readonly extent: Extent;
  readonly label: string;
};

export type PalmMuteRange = {
  readonly stringIndex: number;
  readonly slots: readonly number[];
  readonly labelX: number;
  readonly labelY: number;
  readonly railY: number;
  readonly rail: Extent;
  /** The short upright that closes the range, after the last muted note. */
  readonly capX: number;
  readonly capTop: number;
  readonly capBottom: number;
  readonly label: string;
};

export type TechniquePrimitives = {
  readonly legato: readonly LegatoPhrase[];
  readonly slides: readonly SlideMark[];
  readonly bends: readonly BendMark[];
  readonly vibratos: readonly VibratoMark[];
  readonly palmMutes: readonly PalmMuteRange[];
  /**
   * `string:slot` for every onset this layer drew a mark for.
   *
   * A written articulation the geometry could *not* honour — a hammer-on with
   * nothing to hammer from, a slide that moves nowhere — is absent from this
   * set, so the small character mark beside the number stays as the fallback
   * and an impossible articulation never becomes an invisible one.
   */
  readonly annotated: ReadonlySet<string>;
  readonly count: number;
};

const EMPTY: TechniquePrimitives = {
  legato: [],
  slides: [],
  bends: [],
  vibratos: [],
  palmMutes: [],
  annotated: new Set<string>(),
  count: 0,
};

const noteKey = (stringIndex: number, slot: number): string =>
  `${stringIndex}:${slot}`;

const centreOf = (slot: number, layout: TechniqueLayout): number =>
  slot * layout.slotWidth + layout.slotWidth / 2;

const lineY = (stringIndex: number, layout: TechniqueLayout): number =>
  layout.rowTop(stringIndex) + layout.stringRowHeight / 2;

/** Onsets of one string, in reading order, ignoring what carried in. */
function stringOnsets(bar: FrettedBar, stringIndex: number): TabSpan[] {
  return bar.spans
    .filter((span) => span.stringIndex === stringIndex && !span.openStart)
    .sort((a, b) => a.startSlot - b.startSlot);
}

/**
 * The room one note's marks may use, from the midpoints of its neighbours.
 *
 * Same-string neighbours only: a number on another string is on another row,
 * and a mark that shrank for it would be answering a collision that is not
 * there. The bar line is the outer bound, since a mark may no more cross it
 * than a beam may.
 */
export function ownerSlot(
  bar: FrettedBar,
  span: TabSpan,
  layout: TechniqueLayout,
): Extent {
  const siblings = stringOnsets(bar, span.stringIndex);
  const centre = centreOf(span.startSlot, layout);
  let left = 0;
  let right = bar.slotCount * layout.slotWidth;

  for (const other of siblings) {
    if (other.startSlot < span.startSlot) {
      left = Math.max(left, (centreOf(other.startSlot, layout) + centre) / 2);
    }
    if (other.startSlot > span.startSlot) {
      right = Math.min(right, (centre + centreOf(other.startSlot, layout)) / 2);
    }
  }

  const inset = { left: left + SLOT_INSET_PX, right: right - SLOT_INSET_PX };
  if (inset.right <= inset.left) return { left: centre, right: centre };
  return inset;
}

/**
 * The band a string's marks are drawn in.
 *
 * It is the gap the staff already leaves above this string's line, minus the
 * clearance either side. For the top string that gap is the staff's own top
 * padding, which is wider than one row, so the same arithmetic holds and the
 * staff does not grow by a pixel.
 */
export function annotationLane(
  stringIndex: number,
  layout: TechniqueLayout,
): Lane {
  const y = lineY(stringIndex, layout);
  return {
    top: y - layout.stringRowHeight + LANE_CLEAR_PX,
    bottom: y - LANE_CLEAR_PX,
  };
}

/**
 * Where the numerals of one onset actually start and stop.
 *
 * From the glyph model rather than from the slot, because `12` is wider than
 * `7` and a mark that assumed a slot-wide number would cross one of them.
 */
export function digitBounds(span: TabSpan, layout: TechniqueLayout): Extent {
  const half = maskWidthFor(glyphText(span.fret)) / 2;
  const centre = centreOf(span.startSlot, layout);
  return { left: centre - half, right: centre + half };
}

/** Whether the pair moves the way the articulation says, by sounding pitch. */
function movesAsWritten(
  previous: TabSpan,
  span: TabSpan,
  kind: "hammer_on" | "pull_off",
): boolean {
  const from = pitchToMidi(previous.pitch);
  const to = pitchToMidi(span.pitch);
  if (from === null || to === null) return false;
  return kind === "hammer_on" ? to > from : to < from;
}

/** True when nothing at all happened on this string in between. */
const contiguous = (previous: TabSpan, span: TabSpan): boolean =>
  previous.endSlot + 1 === span.startSlot;

const isLegato = (span: TabSpan): span is TabSpan & {
  articulation: "hammer_on" | "pull_off";
} => span.articulation === "hammer_on" || span.articulation === "pull_off";

/**
 * Runs of notes that are one gesture, per string.
 *
 * A run keeps going while each next onset is slurred from the one before it,
 * sits immediately after it, and moves the way it claims to. It ends at a
 * re-pick, a rest, a note on another string, a note that is not slurred at
 * all, and at anything the articulation-context validator would already call
 * a broken link (spec 10.3).
 */
function legatoRuns(bar: FrettedBar, stringIndex: number): TabSpan[][] {
  const runs: TabSpan[][] = [];
  let run: TabSpan[] = [];
  let previous: TabSpan | undefined;

  for (const span of stringOnsets(bar, stringIndex)) {
    const joins =
      previous !== undefined &&
      isLegato(span) &&
      contiguous(previous, span) &&
      movesAsWritten(previous, span, span.articulation);

    if (joins && previous !== undefined) {
      if (run.length === 0) run = [previous];
      run.push(span);
    } else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    previous = span;
  }

  if (run.length > 1) runs.push(run);
  return runs;
}

function buildLegato(
  bar: FrettedBar,
  layout: TechniqueLayout,
): LegatoPhrase[] {
  const phrases: LegatoPhrase[] = [];

  for (let stringIndex = 0; stringIndex < layout.stringCount; stringIndex += 1) {
    for (const run of legatoRuns(bar, stringIndex)) {
      const first = run[0] as TabSpan;
      const last = run[run.length - 1] as TabSpan;
      const lane = annotationLane(stringIndex, layout);
      const baseY = lane.bottom;
      const rise = Math.min(ARC_RISE_PX, (baseY - lane.top) / 2);

      const left = Math.max(
        0,
        centreOf(first.startSlot, layout) - ARC_OVERHANG_PX,
      );
      const right = Math.min(
        bar.slotCount * layout.slotWidth,
        centreOf(last.startSlot, layout) + ARC_OVERHANG_PX,
      );
      const midX = (left + right) / 2;
      const controlY = baseY - rise * 2;

      const marks = run.slice(1).map((span, index) => {
        const from = run[index] as TabSpan;
        const x =
          (centreOf(from.startSlot, layout) + centreOf(span.startSlot, layout)) /
          2;
        const t = right === left ? 0 : (x - left) / (right - left);
        const curveY = baseY + 2 * t * (1 - t) * (controlY - baseY);
        const kind = span.articulation === "hammer_on" ? "hammer_on" : "pull_off";
        return {
          text: (kind === "hammer_on" ? "H" : "P") as "H" | "P",
          x: round(x),
          y: round(curveY - 2),
          fromSlot: from.startSlot,
          toSlot: span.startSlot,
          fromFret: from.fret,
          toFret: span.fret,
          label: legatoLabel(from.fret, span.fret, kind),
        };
      });

      phrases.push({
        stringIndex,
        slots: run.map((span) => span.startSlot),
        path: `M ${round(left)} ${round(baseY)} Q ${round(midX)} ${round(controlY)} ${round(right)} ${round(baseY)}`,
        marks,
        extent: { left: round(left), right: round(right) },
        label: `${run.length} notalık bağlı geçiş: ${marks
          .map((mark) => mark.label)
          .join(", ")}`,
      });
    }
  }

  return phrases;
}

function buildSlides(bar: FrettedBar, layout: TechniqueLayout): SlideMark[] {
  const marks: SlideMark[] = [];

  for (let stringIndex = 0; stringIndex < layout.stringCount; stringIndex += 1) {
    const onsets = stringOnsets(bar, stringIndex);
    onsets.forEach((span, index) => {
      if (span.articulation !== "slide") return;
      const previous = onsets[index - 1];
      if (!previous) return;
      const from = pitchToMidi(previous.pitch);
      const to = pitchToMidi(span.pitch);
      if (from === null || to === null || from === to) return;

      const bounds = {
        left: digitBounds(previous, layout).right,
        right: digitBounds(span, layout).left,
      };
      const gap = bounds.right - bounds.left;
      if (gap < 1) return;

      const width = Math.min(SLIDE_MAX_PX, gap);
      const centre = (bounds.left + bounds.right) / 2;
      const y = lineY(stringIndex, layout);
      const rising = to > from;

      marks.push({
        stringIndex,
        slot: span.startSlot,
        rising,
        x1: round(centre - width / 2),
        y1: round(rising ? y + SLIDE_TILT_PX : y - SLIDE_TILT_PX),
        x2: round(centre + width / 2),
        y2: round(rising ? y - SLIDE_TILT_PX : y + SLIDE_TILT_PX),
        label: `${previous.fret ?? "?"}. perdeden ${span.fret ?? "?"}. perdeye kaydırma`,
      });
    });
  }

  return marks;
}

/** The amount the contract actually carries. Nothing is inferred. */
function bendAmount(articulation: string): "½" | "1" | null {
  if (articulation === "bend_half") return "½";
  if (articulation === "bend_full") return "1";
  return null;
}

function buildBends(bar: FrettedBar, layout: TechniqueLayout): BendMark[] {
  const marks: BendMark[] = [];

  for (const span of [...bar.spans].sort((a, b) => a.startSlot - b.startSlot)) {
    if (span.openStart) continue;
    const amount = bendAmount(span.articulation ?? "");
    if (amount === null) continue;

    const slot = ownerSlot(bar, span, layout);
    const lane = annotationLane(span.stringIndex, layout);
    const digits = digitBounds(span, layout);

    const startX = Math.max(
      slot.left,
      Math.min(digits.right, slot.right - BEND_RUN_PX),
    );
    const run = Math.max(0, Math.min(BEND_RUN_PX, slot.right - startX));
    const tipX = startX + run;
    const baseY = lane.bottom;
    const rise = Math.min(BEND_RISE_PX, baseY - lane.top);
    const tipY = baseY - rise;

    const labelWidth = LABEL_ADVANCE_PX + 1;
    const fits = tipX + 2 + labelWidth <= slot.right;

    marks.push({
      stringIndex: span.stringIndex,
      slot: span.startSlot,
      path: `M ${round(startX)} ${round(baseY)} Q ${round(tipX)} ${round(baseY)} ${round(tipX)} ${round(tipY)}`,
      head: `${round(tipX - BEND_HEAD_PX)},${round(tipY + BEND_HEAD_PX)} ${round(tipX + BEND_HEAD_PX)},${round(tipY + BEND_HEAD_PX)} ${round(tipX)},${round(tipY)}`,
      amount,
      labelX: round(fits ? tipX + 2 : tipX - 2),
      labelY: round(tipY + 3),
      labelAnchor: fits ? "start" : "end",
      label: amount === "½" ? "Yarım ses büküm" : "Bir ses büküm",
    });
  }

  return marks;
}

/** A smooth three-cycle wave, drawn left to right from `x` at `y`. */
function wavePath(x: number, y: number, width: number): string {
  const halves = VIBRATO_CYCLES * 2;
  const step = width / halves;
  let path = `M ${round(x)} ${round(y)}`;
  for (let index = 0; index < halves; index += 1) {
    const lift = (index % 2 === 0 ? -1 : 1) * VIBRATO_AMPLITUDE_PX * 2;
    path += ` q ${round(step / 2)} ${round(lift)} ${round(step)} 0`;
  }
  return path;
}

function buildVibratos(
  bar: FrettedBar,
  layout: TechniqueLayout,
): VibratoMark[] {
  const marks: VibratoMark[] = [];

  for (let stringIndex = 0; stringIndex < layout.stringCount; stringIndex += 1) {
    const onsets = stringOnsets(bar, stringIndex);
    onsets.forEach((span, index) => {
      if (span.articulation !== "vibrato") return;

      const slot = ownerSlot(bar, span, layout);
      const lane = annotationLane(stringIndex, layout);
      const next = onsets[index + 1];
      const ceiling = next
        ? Math.min(slot.right, digitBounds(next, layout).left - 2)
        : slot.right;

      // Length follows how long the note is held, and is then clipped by the
      // room the note owns. A held note may not reach into the next number.
      const wanted =
        VIBRATO_BASE_PX +
        VIBRATO_PER_SLOT_PX * (span.endSlot - span.startSlot);
      let startX = digitBounds(span, layout).right + 2;
      if (ceiling - startX < VIBRATO_FLOOR_PX) {
        startX = Math.max(slot.left, ceiling - VIBRATO_FLOOR_PX);
      }
      const width = Math.max(0, Math.min(wanted, ceiling - startX));
      if (width <= 0) return;

      const y = lane.bottom - VIBRATO_AMPLITUDE_PX - 1;
      marks.push({
        stringIndex,
        slot: span.startSlot,
        path: wavePath(startX, y, width),
        extent: { left: round(startX), right: round(startX + width) },
        label: "Vibrato",
      });
    });
  }

  return marks;
}

function palmMuteRuns(bar: FrettedBar, stringIndex: number): TabSpan[][] {
  const runs: TabSpan[][] = [];
  let run: TabSpan[] = [];
  let previous: TabSpan | undefined;

  for (const span of stringOnsets(bar, stringIndex)) {
    if (span.articulation !== "palm_mute") {
      if (run.length > 0) runs.push(run);
      run = [];
      previous = span;
      continue;
    }
    if (
      run.length > 0 &&
      previous !== undefined &&
      contiguous(previous, span)
    ) {
      run.push(span);
    } else {
      if (run.length > 0) runs.push(run);
      run = [span];
    }
    previous = span;
  }

  if (run.length > 0) runs.push(run);
  return runs;
}

function buildPalmMutes(
  bar: FrettedBar,
  layout: TechniqueLayout,
  arcs: readonly LegatoPhrase[],
): PalmMuteRange[] {
  const ranges: PalmMuteRange[] = [];

  for (let stringIndex = 0; stringIndex < layout.stringCount; stringIndex += 1) {
    for (const run of palmMuteRuns(bar, stringIndex)) {
      const first = run[0] as TabSpan;
      const last = run[run.length - 1] as TabSpan;
      const lane = annotationLane(stringIndex, layout);
      const start = ownerSlot(bar, first, layout);
      const end = ownerSlot(bar, last, layout);

      const railLeft = Math.min(start.left + PM_LABEL_PX + 2, end.right);
      // Two deterministic micro-lanes: the rail moves to the top of the band
      // when a slur is already using it over the same notes.
      const clash = arcs.some(
        (arc) =>
          arc.stringIndex === stringIndex &&
          arc.extent.left < end.right &&
          arc.extent.right > start.left,
      );
      const railY = clash ? lane.top + 3 : lane.bottom - 3;

      ranges.push({
        stringIndex,
        slots: run.map((span) => span.startSlot),
        labelX: round(start.left),
        labelY: round(railY + 3),
        railY: round(railY),
        rail: { left: round(railLeft), right: round(end.right) },
        capX: round(end.right),
        capTop: round(railY - PM_CAP_PX / 2),
        capBottom: round(railY + PM_CAP_PX / 2),
        label:
          run.length === 1
            ? "Avuç susturma"
            : `${run.length} nota boyunca avuç susturma`,
      });
    }
  }

  return ranges.sort(
    (a, b) => (a.slots[0] ?? 0) - (b.slots[0] ?? 0) || a.stringIndex - b.stringIndex,
  );
}

/**
 * Every technique mark of one bar, in one pass over the bar's own spans.
 *
 * The bar is read and never written: the same bar handed in five times gives
 * the same primitives five times, which is what lets the render layer be a
 * pure function of the Song.
 */
export function buildTechniquePrimitives(
  bar: FrettedBar,
  layout: TechniqueLayout,
): TechniquePrimitives {
  if (bar.silent) return EMPTY;

  const legato = buildLegato(bar, layout);
  const slides = buildSlides(bar, layout);
  const bends = buildBends(bar, layout);
  const vibratos = buildVibratos(bar, layout);
  const palmMutes = buildPalmMutes(bar, layout, legato);

  const annotated = new Set<string>();
  for (const phrase of legato) {
    for (const slot of phrase.slots) annotated.add(noteKey(phrase.stringIndex, slot));
  }
  for (const mark of slides) annotated.add(noteKey(mark.stringIndex, mark.slot));
  for (const mark of bends) annotated.add(noteKey(mark.stringIndex, mark.slot));
  for (const mark of vibratos) annotated.add(noteKey(mark.stringIndex, mark.slot));
  for (const range of palmMutes) {
    for (const slot of range.slots) annotated.add(noteKey(range.stringIndex, slot));
  }

  return {
    legato,
    slides,
    bends,
    vibratos,
    palmMutes,
    annotated,
    count:
      legato.length +
      slides.length +
      bends.length +
      vibratos.length +
      palmMutes.length,
  };
}

/** The key `annotated` uses, so a caller cannot invent a second spelling. */
export const techniqueNoteKey = noteKey;

export const __testing = { legatoRuns, palmMuteRuns, bendAmount };
