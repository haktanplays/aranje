/**
 * What leaves the app, and what it claims about itself (2V-D.1-C §15).
 *
 * Three exports, three different honest answers. The project file carries
 * everything, because it is the song. The WAV carries the sound the app makes,
 * which now includes a span-held palm mute — proved by a real offline render
 * whose numbers are read back here rather than restated. The MIDI file carries
 * notes and timing and says so; the failure worth guarding is not that it
 * drops the shading but that it might stop admitting it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { buildMidiPlan } from "@/lib/export/midi-plan";
import {
  MIDI_ARTICULATION_NOTE,
  PICKING_NOTATION_NOTE,
} from "@/lib/export/export-messages";
import { exportProject, parseProjectText } from "@/lib/project/project-file";
import { AXIS_CAPABILITY } from "@/lib/music/expression-resolver";
import { pitchAt } from "@/lib/song/edit";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";

const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;

const note = (extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, 1, 3)!,
    position: { string: 1, fret: 3 },
    ...extra,
  }) as NoteEvent;

const SPAN: TechniqueSpan = {
  id: "pm1",
  kind: "palm_mute",
  trackId: TRACK,
  startTicks: 0,
  endTicks: 768,
  stringIndices: [1],
};

/** One bar carrying all three new axes at once. */
function song(): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [note({ attack: "accent", picking: "down" })] };
  lane[4] = { notes: [note({ attack: "pinch_harmonic", picking: "up" })] };
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        techniqueSpans: [SPAN],
      },
    ],
  } satisfies Song);
}

describe("337. what each export carries, and what it says", () => {
  it("round-trips every new axis through the project file", () => {
    const before = song();
    const exported = exportProject(before);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const back = parseProjectText(exported.text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.stringify(back.song)).toBe(JSON.stringify(before));
  });

  it("keeps the span on the section it was written on", () => {
    const exported = exportProject(song());
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const back = parseProjectText(exported.text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.song.sections[0]?.techniqueSpans).toEqual([SPAN]);
  });

  it("carries the notes into MIDI and admits what it left behind", () => {
    const plan = buildMidiPlan(song());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    /* The notes are there; the shading is not, and the sentence beside the
       button says so in words a reader can act on. */
    const events = plan.plan.tracks.flatMap((track) => track.events);
    expect(events.some((event) => event.kind === "noteOn")).toBe(true);
    expect(MIDI_ARTICULATION_NOTE).toContain("vuruş sertliği");
    expect(MIDI_ARTICULATION_NOTE).toContain("avuç susturma");
  });

  it("says out loud that picking direction is not heard", () => {
    /* The model already says so; the reader has to be told the same thing.
       An axis the app cannot play must never be sold as one it can. */
    expect(AXIS_CAPABILITY.picking).toBe("notation_only");
    expect(PICKING_NOTATION_NOTE).toContain("duyulmaz");
  });

  it("claims nothing about picking that the sample bank could not deliver", () => {
    expect(PICKING_NOTATION_NOTE).not.toContain("duyulur");
    expect(MIDI_ARTICULATION_NOTE).not.toContain("pena yönü");
  });

  it("has a rendered WAV measurement, and it says the span was audible", () => {
    /*
     * Read back rather than restated. `eval/technique-spans/measure.mjs`
     * renders the legacy mute, the span mute and an unmuted control through
     * the production engine on an offline context — the same path the WAV
     * export uses — and writes what came out. If that file goes stale or its
     * verdicts flip, this fails rather than quietly passing on prose.
     */
    const measured = JSON.parse(
      readFileSync("eval/technique-spans/MEASUREMENTS.json", "utf8"),
    ) as {
      fixtures: Record<string, { peak: number; firstStrikeDecaySeconds: number }>;
      verdicts: Record<string, boolean>;
    };
    expect(measured.verdicts.spanIsAudible).toBe(true);
    expect(measured.verdicts.spanMatchesLegacy).toBe(true);
    /* The control: a mute that changed nothing would make the two above
       true for the wrong reason. */
    expect(measured.verdicts.muteChangesTheSound).toBe(true);
    expect(measured.fixtures.plain!.firstStrikeDecaySeconds).toBeGreaterThan(
      measured.fixtures.span!.firstStrikeDecaySeconds,
    );
  });
});
