/**
 * Where a palm mute's length actually comes from (2V-D.1-C §2).
 *
 * The previous round left an eight-millisecond difference between a mute
 * written on the note and the same mute written as a span, and two sentences
 * about why. Two sentences are not a measurement, and "about eight
 * milliseconds" is not a root cause — so this walks one note through every
 * stage that touches its length and prints what each one did.
 *
 * It is a measurement, not a gate: the assertions are only there so a silent
 * failure cannot masquerade as a reading.
 */
import { describe, expect, it } from "vitest";

import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { trackLegatoOnsets } from "@/lib/music/legato";
import { pitchAt } from "@/lib/song/edit";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;

const note = (fret: number, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, 5, fret)!,
    position: { string: 5, fret },
    ...extra,
  }) as NoteEvent;

function build(extra: Partial<NoteEvent>, spans?: TechniqueSpan[]): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [note(3, extra)] };
  lane[4] = { notes: [note(5, extra)] };
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        ...(spans ? { techniqueSpans: spans } : {}),
      },
    ],
  } satisfies Song);
}

const PM_SPAN: TechniqueSpan = {
  id: "pm1",
  kind: "palm_mute",
  trackId: TRACK,
  startTicks: 0,
  endTicks: 768,
  stringIndices: [5],
};

type Row = {
  readonly label: string;
  /** What the score says, before anything shortens it. */
  readonly writtenTicks: number;
  /** What the timeline handed the planner, in ticks. */
  readonly gatedTicks: number;
  /** The same, in seconds, as the planner received it. */
  readonly gatedSeconds: number;
  /** What the plan finally says the note sounds for. */
  readonly plannedSeconds: number;
  /** When the level starts falling, and when it reaches nothing. */
  readonly releaseStartSeconds: number | null;
  readonly releaseEndSeconds: number | null;
  readonly filterPreset: string | undefined;
};

function measure(label: string, built: Song): Row {
  const onsets = trackLegatoOnsets(built, TRACK);
  const onset = onsets.find((entry) => entry.timeTicks === 0)!;
  const plan = buildExpressionPlan(built).notes.find((entry) => entry.timeTicks === 0)!;
  const envelope = plan.gainEnvelope;
  const falling = envelope.findIndex(
    (point, index) => index > 0 && point.value < envelope[index - 1]!.value,
  );
  return {
    label,
    /* Two beats between onsets on an eighth grid: 384 ticks. */
    writtenTicks: 384,
    gatedTicks: onset.durationTicks,
    gatedSeconds: Math.round((onset.durationTicks / 384) * 1000) / 1000,
    plannedSeconds: plan.durationSeconds,
    releaseStartSeconds: falling > 0 ? envelope[falling - 1]!.timeSeconds : null,
    releaseEndSeconds: falling > 0 ? envelope[falling]!.timeSeconds : null,
    filterPreset: plan.filterPreset,
  };
}

/**
 * What the first run said, before anything was changed:
 *
 *   plain note            written=384 gated=88 planned=0.208333s filter=-
 *   legacy articulation   written=384 gated=43 planned=0.101799s filter=palm_mute
 *   technique span        written=384 gated=88 planned=0.09375s  filter=palm_mute
 *
 * `gated` is what the timeline handed the planner. The legacy note is gated
 * **in ticks** by `articulationHold`, which reads the enum: 96 × 0.45 → 43.
 * The span was invisible to the timeline, so it arrived gated at the ordinary
 * 0.92 — 96 × 0.92 → 88 — and the planner then applied 0.45 to *that*.
 *
 * So the difference was never a rounding. It was **0.92 × 0.45 = 0.414**
 * against **0.45**: the span was gated twice and the legacy note once. And
 * `palmMuteSeconds` is not the second gate — it is an absolute 180 ms ceiling
 * that does not even bind at this tempo. The two stages do two different
 * jobs, and the fix is to let the timeline see the span rather than to delete
 * either of them.
 */
describe("317. where a palm mute's length comes from", () => {
  it("prints the stage-by-stage timeline for all three cases", () => {
    const rows = [
      measure("plain note", build({})),
      measure("legacy articulation", build({ articulation: "palm_mute" })),
      measure("technique span", build({}, [PM_SPAN])),
    ];
    /* Printed rather than asserted: this test exists to be read. */
    for (const row of rows) {
      console.log(
        `${row.label.padEnd(22)}written=${row.writtenTicks} gated=${row.gatedTicks} ` +
          `planned=${row.plannedSeconds}s release=${row.releaseStartSeconds}→${row.releaseEndSeconds} ` +
          `filter=${row.filterPreset ?? "-"}`,
      );
    }
    /* Non-vacuity: a plain note must differ from both mutes, or the reading
       says nothing about muting. */
    expect(rows[0]!.plannedSeconds).not.toBe(rows[1]!.plannedSeconds);
    expect(rows[0]!.filterPreset).toBeUndefined();
    expect(rows[1]!.filterPreset).toBe("palm_mute");
    expect(rows[2]!.filterPreset).toBe("palm_mute");
  });
});
