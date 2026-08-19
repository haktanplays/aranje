import { describe, expect, it } from "vitest";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { MelodicSlot, Song } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  silentDrumSlots,
  song,
} from "@/lib/song/fixtures";
import {
  buildTrackTimeline,
  drumRhythm,
  frettedRhythm,
  sectionRuns,
} from "@/lib/tab/timeline";

function fretted(subject: Song, trackId: string) {
  const timeline = buildTrackTimeline(subject, trackId);
  if (timeline.kind !== "fretted") throw new Error("expected a fretted track");
  return timeline;
}

function drums(subject: Song, trackId: string) {
  const timeline = buildTrackTimeline(subject, trackId);
  if (timeline.kind !== "drums") throw new Error("expected a drum track");
  return timeline;
}

describe("track timeline shape", () => {
  it("reads the fretboard from the track", () => {
    const timeline = fretted(SAMPLE_SONG, "gtr");
    expect(timeline.strings).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
    expect(timeline.capo).toBe(0);
  });

  it("gives the bass four strings", () => {
    expect(fretted(SAMPLE_SONG, "bass").strings).toHaveLength(4);
  });

  it("numbers bars across the whole song", () => {
    const bars = fretted(SAMPLE_SONG, "gtr").bars;
    expect(bars).toHaveLength(8);
    expect(bars.map((bar) => bar.barNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("marks the first bar of each section", () => {
    const bars = fretted(SAMPLE_SONG, "gtr").bars;
    expect(bars.filter((bar) => bar.isSectionStart).map((bar) => bar.barNumber)).toEqual([1, 5]);
    expect(bars[0]?.sectionName).toBe("Intro Riff");
    expect(bars[4]?.sectionName).toBe("Ana Riff");
  });

  it("derives the slot count from the meter", () => {
    for (const bar of fretted(SAMPLE_SONG, "gtr").bars) {
      expect(bar.slotCount).toBe(8);
    }
  });

  it("refuses a track that is not in the song", () => {
    const timeline = buildTrackTimeline(SAMPLE_SONG, "nope");
    expect(timeline.kind).toBe("unsupported");
  });

  it("refuses a melodic track with no fretboard", () => {
    const subject = song([guitarTrack({ fretboard: undefined })], []);
    const timeline = buildTrackTimeline(subject, "gtr");
    expect(timeline.kind).toBe("unsupported");
  });
});

describe("silent bars (spec 5.5)", () => {
  it("marks a bar the track does not write to as silent", () => {
    const bars = fretted(SAMPLE_SONG, "acc").bars;
    expect(bars.slice(0, 4).every((bar) => bar.silent)).toBe(true);
    expect(bars.slice(4).every((bar) => !bar.silent)).toBe(true);
  });

  it("draws nothing in a silent bar", () => {
    const bar = fretted(SAMPLE_SONG, "acc").bars[0];
    expect(bar?.spans).toEqual([]);
    expect(bar?.rests).toEqual([]);
  });
});

describe("notes, rests and ties", () => {
  it("places a written position without moving it", () => {
    const bar = fretted(SAMPLE_SONG, "gtr").bars[0];
    const first = bar?.spans.find((span) => span.startSlot === 0);
    expect(first?.pitch).toBe("E2");
    expect(first?.stringIndex).toBe(0);
    expect(first?.fret).toBe(0);
  });

  it("computes a position when the note has none", () => {
    const slots = restSlots(8);
    slots[0] = { notes: [{ pitch: "C3" }] };
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", slots)])],
    );
    const span = fretted(subject, "gtr").bars[0]?.spans[0];
    expect(span?.stringIndex).toBe(1);
    expect(span?.fret).toBe(3);
  });

  it("records rests separately from notes", () => {
    const bar = fretted(SAMPLE_SONG, "gtr").bars[3];
    expect(bar?.rests).toEqual([7]);
  });

  it("extends a span over the slots a tie covers", () => {
    const slots = restSlots(8);
    slots[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    slots[1] = "-";
    slots[2] = "-";
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", slots)])],
    );
    const span = fretted(subject, "gtr").bars[0]?.spans[0];
    expect(span?.startSlot).toBe(0);
    expect(span?.endSlot).toBe(2);
    expect(span?.openStart).toBe(false);
  });

  it("ends a span when a rest arrives", () => {
    const slots: MelodicSlot[] = restSlots(8);
    slots[0] = { notes: [{ pitch: "E2" }] };
    slots[1] = "-";
    slots[2] = null;
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", slots)])],
    );
    const bars = fretted(subject, "gtr").bars;
    expect(bars[0]?.spans[0]?.endSlot).toBe(1);
    expect(bars[0]?.rests).toContain(2);
  });

  it("keeps every note of a chord as its own span", () => {
    const bar = fretted(SAMPLE_SONG, "gtr").bars[4];
    const atZero = bar?.spans.filter((span) => span.startSlot === 0) ?? [];
    expect(atZero).toHaveLength(2);
    expect(atZero.map((span) => span.pitch).sort()).toEqual(["B2", "E2"]);
  });

  it("carries a tie across a bar line", () => {
    const first = restSlots(8);
    first[7] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    const second = restSlots(8);
    second[0] = "-";
    second[1] = "-";

    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", first), melodicBar("gtr", second)])],
    );
    const bars = fretted(subject, "gtr").bars;

    expect(bars[0]?.spans[0]?.openEnd).toBe(true);
    const carried = bars[1]?.spans[0];
    expect(carried?.openStart).toBe(true);
    expect(carried?.pitch).toBe("E2");
    expect(carried?.startSlot).toBe(0);
    expect(carried?.endSlot).toBe(1);
  });

  it("carries a tie across a section boundary", () => {
    const first = restSlots(8);
    first[7] = { notes: [{ pitch: "E2" }] };
    const second = restSlots(8);
    second[0] = "-";

    const subject = song(
      [guitarTrack()],
      [
        section([melodicBar("gtr", first)], { id: "s1" }),
        section([melodicBar("gtr", second)], { id: "s2" }),
      ],
    );
    const bars = fretted(subject, "gtr").bars;
    expect(bars[1]?.spans[0]?.openStart).toBe(true);
  });

  it("does not carry into a bar that starts with a note", () => {
    const first = restSlots(8);
    first[7] = { notes: [{ pitch: "E2" }] };
    const second = restSlots(8);
    second[0] = { notes: [{ pitch: "G2" }] };

    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", first), melodicBar("gtr", second)])],
    );
    const bars = fretted(subject, "gtr").bars;
    expect(bars[0]?.spans[0]?.openEnd).toBe(false);
    expect(bars[1]?.spans[0]?.openStart).toBe(false);
  });

  it("keeps the articulation the note carries", () => {
    const bar = fretted(SAMPLE_SONG, "gtr").bars[0];
    expect(bar?.spans[0]?.articulation).toBe("palm_mute");
  });
});

describe("drum lanes", () => {
  it("shows only the pieces the song uses, in notation order", () => {
    expect(drums(SAMPLE_SONG, "drums").lanes).toEqual([
      "crash",
      "closed_hat",
      "snare",
      "kick",
    ]);
  });

  it("puts several hits of one slot on their own lanes", () => {
    const timeline = drums(SAMPLE_SONG, "drums");
    const firstSlot = timeline.bars[0]?.marks.filter(
      (mark) => mark.slotIndex === 0,
    );
    expect(firstSlot?.map((mark) => mark.piece).sort()).toEqual([
      "closed_hat",
      "crash",
      "kick",
    ]);
  });

  it("records an empty drum slot as a rest", () => {
    const bar = drums(SAMPLE_SONG, "drums").bars[7];
    expect(bar?.rests).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("marks a silent drum bar", () => {
    const subject = song(
      [drumTrack(), guitarTrack()],
      [section([melodicBar("gtr", restSlots(8))])],
    );
    expect(drums(subject, "drums").bars[0]?.silent).toBe(true);
  });

  it("has no lanes when the drum track never plays", () => {
    const subject = song(
      [drumTrack()],
      [
        section([
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { drums: silentDrumSlots(8) },
          },
        ]),
      ],
    );
    expect(drums(subject, "drums").lanes).toEqual([]);
  });
});

describe("section runs", () => {
  it("reports where each section starts and how long it is", () => {
    expect(sectionRuns(SAMPLE_SONG)).toEqual([
      {
        sectionId: "intro-riff",
        name: "Intro Riff",
        status: "fixed",
        firstBar: 1,
        barCount: 4,
      },
      {
        sectionId: "main-riff",
        name: "Ana Riff",
        status: "fixed",
        firstBar: 5,
        barCount: 4,
      },
    ]);
  });
});

describe("rhythm strip", () => {
  it("tells an onset, a sustain and a rest apart", () => {
    const slots = restSlots(8);
    slots[0] = { notes: [{ pitch: "E2" }] };
    slots[1] = "-";
    slots[2] = null;
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", slots)])],
    );
    const bar = fretted(subject, "gtr").bars[0];
    expect(bar && frettedRhythm(bar)).toEqual([
      "onset",
      "sustain",
      "rest",
      "rest",
      "rest",
      "rest",
      "rest",
      "rest",
    ]);
  });

  it("counts a carried tie as sustain, not as a new onset", () => {
    const first = restSlots(8);
    first[7] = { notes: [{ pitch: "E2" }] };
    const second = restSlots(8);
    second[0] = "-";
    const subject = song(
      [guitarTrack()],
      [section([melodicBar("gtr", first), melodicBar("gtr", second)])],
    );
    const bar = fretted(subject, "gtr").bars[1];
    expect(bar && frettedRhythm(bar)[0]).toBe("sustain");
  });

  it("leaves a silent bar empty", () => {
    const bar = fretted(SAMPLE_SONG, "acc").bars[0];
    expect(bar && frettedRhythm(bar).every((state) => state === "empty")).toBe(
      true,
    );
  });

  it("marks drum onsets and rests", () => {
    const bar = drums(SAMPLE_SONG, "drums").bars[7];
    expect(bar && drumRhythm(bar)).toEqual([
      "onset",
      "rest",
      "rest",
      "rest",
      "rest",
      "rest",
      "rest",
      "rest",
    ]);
  });
});
