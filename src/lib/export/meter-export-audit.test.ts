/**
 * What actually leaves the app, for the metres this round added
 * (2V-D.2 c3 §8, §9, §10, §11).
 *
 * ## Why the MIDI half re-parses bytes
 *
 * The exporter's own plan is not evidence about the exporter. A test that
 * asks `buildMidiPlan` what it intended and then agrees with it proves that
 * one function is self-consistent, which was never in doubt. So the MIDI
 * assertions below run the real writer, take the bytes it produced, and read
 * them back with a parser written here that knows nothing about the plan —
 * the same position a DAW is in.
 *
 * ## What this file does not claim
 *
 * It does not verify rendered PCM. WAV rendering needs an audio context and
 * the shared sample bank, neither of which exists in this environment, so the
 * WAV section checks the **timeline** the renderer is handed — bar starts,
 * bar ends, meter-change boundaries, the loop endpoint, the notated end and
 * the tail — from the same planners the renderer reads. Where an onset
 * actually lands in the samples is not measured here and is named as an open
 * debt rather than implied.
 */
import { describe, expect, it } from "vitest";

import { barTimeline } from "@/lib/audio/schedule";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { renderDuration } from "@/lib/export/export-plan";
import { MIDI_METER_NOTE } from "@/lib/export/export-messages";
import { buildMidiPlan, microsecondsPerQuarter } from "@/lib/export/midi-plan";
import { writeMidiFile } from "@/lib/export/midi-writer";
import { groupingLabel } from "@/lib/music/meter-beats";
import { PPQ, barTicks, type Resolution, type TimeSignature } from "@/lib/music/timing";
import { exportProject, parseProjectText } from "@/lib/project/project-file";

/** The project file's text, with the export's own refusal surfaced first. */
function projectText(song: Song, where: string): string {
  const result = exportProject(song);
  expect(result.ok, `${where}: ${result.ok ? "" : result.code}`).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.text;
}
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";
import { REST, TRACK_ID, song as songOf } from "@/test/move-fixtures";

/* ------------------------------------------------------------- fixtures */

const note = (pitch: string, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string: 1, fret } }],
});

/** One bar in a given metre, filled with rests and a note on beat one. */
function meterBar(
  meter: TimeSignature,
  resolution: Resolution,
  grouping?: readonly number[],
): Bar {
  const count = (meter[0] * resolution) / meter[1];
  return {
    timeSignature: [meter[0], meter[1]] as Bar["timeSignature"],
    resolution,
    ...(grouping ? { grouping: [...grouping] } : {}),
    slots: {
      [TRACK_ID]: [
        note("A3", 12),
        ...Array.from({ length: count - 1 }, () => REST),
      ],
    },
  };
}

const withBars = (bars: readonly Bar[]): Song => {
  const base = songOf([...bars]);
  return {
    ...base,
    sections: base.sections.map((section, index) =>
      index === 0 ? { ...section, bars: [...bars] } : section,
    ),
  };
};

/** Every metre the brief names, each on a grid that can write it exactly. */
const METERS: readonly {
  readonly name: string;
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping: readonly number[];
}[] = [
  { name: "4/4", meter: [4, 4], resolution: 16, grouping: [1, 1, 1, 1] },
  { name: "6/8", meter: [6, 8], resolution: 16, grouping: [3, 3] },
  { name: "5/8 2+3", meter: [5, 8], resolution: 16, grouping: [2, 3] },
  { name: "7/8 2+2+3", meter: [7, 8], resolution: 16, grouping: [2, 2, 3] },
  { name: "7/8 3+2+2", meter: [7, 8], resolution: 16, grouping: [3, 2, 2] },
  { name: "9/8 3+3+3", meter: [9, 8], resolution: 16, grouping: [3, 3, 3] },
  { name: "12/8", meter: [12, 8], resolution: 16, grouping: [3, 3, 3, 3] },
  { name: "5/4 3+2", meter: [5, 4], resolution: 16, grouping: [3, 2] },
];

/* --------------------------------------------------- an independent reader */

type ParsedMeta = {
  readonly kind: "timeSignature" | "tempo";
  readonly tick: number;
  readonly numerator?: number;
  /** The *denominator itself*, recovered from the power byte. */
  readonly denominator?: number;
  readonly microsecondsPerQuarter?: number;
};

/**
 * Read the meta events out of real MIDI bytes.
 *
 * Deliberately naive and self-contained: it walks chunks, decodes variable
 * length quantities and recognises `FF 58` and `FF 51`. It shares no code
 * with the writer, so agreement between them is evidence rather than a
 * tautology.
 */
function readMeta(bytes: Uint8Array): { ppq: number; events: ParsedMeta[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
  const ppq = view.getUint16(12);

  const events: ParsedMeta[] = [];
  let at = 14;
  while (at < bytes.length) {
    const tag = String.fromCharCode(...bytes.slice(at, at + 4));
    const length = view.getUint32(at + 4);
    const start = at + 8;
    const end = start + length;
    at = end;
    if (tag !== "MTrk") continue;

    let cursor = start;
    let tick = 0;
    let running = 0;
    while (cursor < end) {
      let delta = 0;
      for (;;) {
        const byte = bytes[cursor]!;
        cursor += 1;
        delta = (delta << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) break;
      }
      tick += delta;

      let status = bytes[cursor]!;
      if ((status & 0x80) === 0) status = running;
      else cursor += 1;
      if (status < 0xf0) running = status;

      if (status === 0xff) {
        const type = bytes[cursor]!;
        cursor += 1;
        let size = 0;
        for (;;) {
          const byte = bytes[cursor]!;
          cursor += 1;
          size = (size << 7) | (byte & 0x7f);
          if ((byte & 0x80) === 0) break;
        }
        const data = bytes.slice(cursor, cursor + size);
        cursor += size;
        if (type === 0x58) {
          events.push({
            kind: "timeSignature",
            tick,
            numerator: data[0]!,
            /* The format stores log2 of the denominator, so a quarter is 2
               and an eighth is 3. Recovering it is the whole point. */
            denominator: 2 ** data[1]!,
          });
        }
        if (type === 0x51) {
          events.push({
            kind: "tempo",
            tick,
            microsecondsPerQuarter: (data[0]! << 16) | (data[1]! << 8) | data[2]!,
          });
        }
        continue;
      }

      /* Channel events: two data bytes except program change and aftertouch. */
      const twoData = (status & 0xf0) !== 0xc0 && (status & 0xf0) !== 0xd0;
      cursor += twoData ? 2 : 1;
    }
  }
  return { ppq, events };
}

function midiBytesOf(song: Song): Uint8Array {
  const plan = buildMidiPlan(song);
  expect(plan.ok, plan.ok ? "" : `${plan.code}: ${plan.detail ?? ""}`).toBe(true);
  if (!plan.ok) throw new Error("plan failed");
  const written = writeMidiFile({ ppq: plan.plan.ppq, tracks: plan.plan.tracks });
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error("write failed");
  return written.bytes;
}

/* ------------------------------------------------------------------ §8 */

describe("373. the project file carries the whole rhythm back", () => {
  it("round-trips every metre with its feel intact", () => {
    for (const entry of METERS) {
      const before = withBars([meterBar(entry.meter, entry.resolution, entry.grouping)]);
      const parsed = parseProjectText(projectText(before, entry.name));
      expect(parsed.ok, entry.name).toBe(true);
      if (!parsed.ok) continue;
      const bar = parsed.song.sections[0]?.bars[0];
      expect(bar?.timeSignature, entry.name).toEqual([entry.meter[0], entry.meter[1]]);
      expect(bar?.resolution, entry.name).toBe(entry.resolution);
      expect(bar?.grouping, entry.name).toEqual([...entry.grouping]);
    }
  });

  it("keeps 7/8 felt 2+2+3 and 3+2+2 different bytes on the way out", () => {
    /*
     * The fact the whole grouping field exists for. Before it, these two were
     * the same file, and a reader who wrote one and opened the other had no
     * way to tell — including the app itself.
     */
    const a = projectText(withBars([meterBar([7, 8], 16, [2, 2, 3])]), "2+2+3");
    const b = projectText(withBars([meterBar([7, 8], 16, [3, 2, 2])]), "3+2+2");
    expect(a).not.toBe(b);

    const parsedA = parseProjectText(a);
    const parsedB = parseProjectText(b);
    expect(parsedA.ok && parsedB.ok).toBe(true);
    if (!parsedA.ok || !parsedB.ok) return;
    expect(groupingLabel(parsedA.song.sections[0]!.bars[0]!.grouping!)).toBe("2+2+3");
    expect(groupingLabel(parsedB.song.sections[0]!.bars[0]!.grouping!)).toBe("3+2+2");
  });

  it("round-trips consecutive bars in different metres", () => {
    const mixed = withBars([
      meterBar([5, 8], 16, [2, 3]),
      meterBar([7, 8], 16, [2, 2, 3]),
      meterBar([6, 8], 16, [3, 3]),
    ]);
    const parsed = parseProjectText(projectText(mixed, "mixed"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.song.sections[0]?.bars.map((bar) => `${bar.timeSignature[0]}/${bar.timeSignature[1]}`),
    ).toEqual(["5/8", "7/8", "6/8"]);
    expect(parsed.song.sections[0]?.bars.map((bar) => bar.grouping)).toEqual([
      [2, 3],
      [2, 2, 3],
      [3, 3],
    ]);
  });

  it("carries a phrase and a technique span across a metre change", () => {
    const base = withBars([meterBar([7, 8], 16, [2, 2, 3]), meterBar([6, 8], 16, [3, 3])]);
    const source: Song = {
      ...base,
      sections: base.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              phrases: [{ id: "p1", startTicks: PPQ, endTicks: PPQ * 4 }],
              techniqueSpans: [
                {
                  id: "sp1",
                  kind: "palm_mute" as const,
                  trackId: TRACK_ID,
                  startTicks: 0,
                  endTicks: PPQ * 3,
                  stringIndices: [4, 5],
                },
              ],
            }
          : section,
      ),
    };
    const parsed = parseProjectText(projectText(source, "marks"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.song.sections[0]?.phrases).toEqual([
      { id: "p1", startTicks: PPQ, endTicks: PPQ * 4 },
    ]);
    expect(parsed.song.sections[0]?.techniqueSpans?.[0]?.endTicks).toBe(PPQ * 3);
  });

  it("survives a second trip unchanged, byte for byte", () => {
    /* Semantic equality, not merely schema validity: the second export of a
       parsed song has to be the first export. */
    for (const entry of METERS) {
      const once = projectText(
        withBars([meterBar(entry.meter, entry.resolution, entry.grouping)]),
        entry.name,
      );
      const parsed = parseProjectText(once);
      expect(parsed.ok, entry.name).toBe(true);
      if (!parsed.ok) continue;
      expect(projectText(parsed.song, entry.name), entry.name).toBe(once);
    }
  });
});

/* ------------------------------------------------------------------ §9 */

describe("374. the timeline the WAV renderer is handed", () => {
  /**
   * Bar starts, ends and seconds for one song, from the production planners.
   *
   * This is the table the renderer schedules against. It is not a
   * measurement of rendered samples — see the file header.
   */
  const boundaries = (song: Song) => {
    const bars = barTimeline(song);
    const map = buildTempoMap(song);
    return bars.map((bar, index) => ({
      bar: index + 1,
      meter: `${bar.timeSignature[0]}/${bar.timeSignature[1]}`,
      startTicks: bar.time,
      endTicks: bar.time + bar.durationTicks,
      startSeconds: secondsAtTicks(map, bar.time),
      nextStartTicks: bars[index + 1]?.time ?? null,
    }));
  };

  it("starts every bar exactly where the one before it ended", () => {
    const mixed = withBars([
      meterBar([5, 8], 16, [2, 3]),
      meterBar([7, 8], 16, [2, 2, 3]),
      meterBar([6, 8], 16, [3, 3]),
    ]);
    for (const row of boundaries(mixed)) {
      if (row.nextStartTicks === null) continue;
      expect(row.nextStartTicks, `bar ${row.bar} → ${row.bar + 1}`).toBe(row.endTicks);
    }
  });

  it("gives each bar the length its own metre says, with no drift", () => {
    for (const entry of METERS) {
      const one = withBars([meterBar(entry.meter, entry.resolution, entry.grouping)]);
      const [row] = boundaries(one);
      expect(row?.endTicks, entry.name).toBe(
        barTicks({ timeSignature: entry.meter, resolution: entry.resolution }),
      );
      expect(Number.isInteger(row?.endTicks), entry.name).toBe(true);
    }
  });

  it("ends the notated render on the last bar line and not on the tail", () => {
    /*
     * The failure this catches is a renderer that treats the decay allowance
     * as part of the music: the song would gain a phantom partial bar every
     * time it was exported.
     */
    const mixed = withBars([
      meterBar([7, 8], 16, [2, 2, 3]),
      meterBar([6, 8], 16, [3, 3]),
    ]);
    const rows = boundaries(mixed);
    const lastEnd = rows[rows.length - 1]!.endTicks;
    const map = buildTempoMap(mixed);
    const duration = renderDuration(mixed);

    expect(duration.notatedSeconds).toBeCloseTo(secondsAtTicks(map, lastEnd), 9);
    expect(duration.tailSeconds).toBeGreaterThan(0);
    expect(duration.totalSeconds).toBeCloseTo(
      duration.notatedSeconds + duration.expressionSeconds + duration.tailSeconds,
      9,
    );
    /*
     * And the tail is not *content*. It is deliberately allowed to be longer
     * than a bar — a three-second decay over a one-and-a-half-second 6/8 bar
     * is a correct render, not a phantom bar — so the invariant is about
     * where the music ends, not about how much silence follows it: the
     * timeline holds exactly the bars that were written, and the notated end
     * is the last bar line rather than anything the tail moved.
     */
    expect(rows).toHaveLength(2);
    expect(duration.notatedSeconds).toBeLessThan(duration.totalSeconds);
    expect(duration.expressionSeconds).toBe(0);
  });

  it("puts the loop endpoint on the exact sum of the bar lengths", () => {
    const mixed = withBars([
      meterBar([5, 8], 16, [2, 3]),
      meterBar([7, 8], 16, [2, 2, 3]),
      meterBar([6, 8], 16, [3, 3]),
    ]);
    const rows = boundaries(mixed);
    const summed = rows.reduce((total, row) => total + (row.endTicks - row.startTicks), 0);
    expect(rows[rows.length - 1]!.endTicks).toBe(summed);
    /* 5/8 + 7/8 + 6/8 at PPQ 192: 480 + 672 + 576. */
    expect(summed).toBe(480 + 672 + 576);
  });

  it("keeps seconds monotonic across a metre change", () => {
    const mixed = withBars([
      meterBar([7, 8], 16, [2, 2, 3]),
      meterBar([5, 8], 16, [2, 3]),
      meterBar([12, 8], 16, [3, 3, 3, 3]),
    ]);
    const rows = boundaries(mixed);
    for (const [index, row] of rows.entries()) {
      if (index === 0) continue;
      expect(row.startSeconds, `bar ${row.bar}`).toBeGreaterThan(rows[index - 1]!.startSeconds);
    }
    expect(rows.every((row) => Number.isFinite(row.startSeconds))).toBe(true);
  });
});

/* ----------------------------------------------------------- §10 and §11 */

describe("375. the MIDI bytes, read back by something that did not write them", () => {
  it("writes one time-signature event per metre, at the right tick", () => {
    const mixed = withBars([
      meterBar([7, 8], 16, [2, 2, 3]),
      meterBar([5, 8], 16, [2, 3]),
      meterBar([6, 8], 16, [3, 3]),
    ]);
    const { ppq, events } = readMeta(midiBytesOf(mixed));
    expect(ppq).toBe(PPQ);

    const signatures = events.filter((event) => event.kind === "timeSignature");
    expect(signatures.map((event) => `${event.numerator}/${event.denominator}`)).toEqual([
      "7/8",
      "5/8",
      "6/8",
    ]);
    /* 7/8 is 672 ticks, so 5/8 starts there and 6/8 at 672 + 480. */
    expect(signatures.map((event) => event.tick)).toEqual([0, 672, 672 + 480]);
  });

  it("encodes the denominator as its power of two, for every metre", () => {
    /*
     * The one field a hand-rolled writer gets wrong. `FF 58 04 nn dd ..`
     * stores *log2* of the denominator, so an eighth is the byte 3 and not
     * the byte 8. Reading it back turns the byte into 8 again; a writer that
     * had put 8 there would come back as 256.
     */
    for (const entry of METERS) {
      const one = withBars([meterBar(entry.meter, entry.resolution, entry.grouping)]);
      const signature = readMeta(midiBytesOf(one)).events.find(
        (event) => event.kind === "timeSignature",
      );
      expect(signature?.numerator, entry.name).toBe(entry.meter[0]);
      expect(signature?.denominator, entry.name).toBe(entry.meter[1]);
    }
  });

  it("writes a tempo that means the same quarter the app means", () => {
    /*
     * §11's authority check, end to end: the stored BPM is quarters per
     * minute, the MIDI tempo is microseconds per quarter, and the two are the
     * same statement or one of them is lying.
     */
    const one = withBars([meterBar([6, 8], 16, [3, 3])]);
    const tempo = readMeta(midiBytesOf(one)).events.find((event) => event.kind === "tempo");
    expect(tempo?.microsecondsPerQuarter).toBe(
      Math.round(microsecondsPerQuarter(one.bpm)),
    );
    expect(tempo?.microsecondsPerQuarter).toBe(Math.round(60_000_000 / one.bpm));

    /* And the playback clock agrees: PPQ ticks take one quarter's worth. */
    const map = buildTempoMap(one);
    expect(secondsAtTicks(map, PPQ)).toBeCloseTo(60 / one.bpm, 9);
  });

  it("writes exactly one time signature where consecutive bars agree", () => {
    /* Three identical 6/8 bars are one metre, not three. A player reading a
       fresh event on every bar line is being told the metre changed. */
    const same = withBars([
      meterBar([6, 8], 16, [3, 3]),
      meterBar([6, 8], 16, [3, 3]),
      meterBar([6, 8], 16, [3, 3]),
    ]);
    const signatures = readMeta(midiBytesOf(same)).events.filter(
      (event) => event.kind === "timeSignature",
    );
    expect(signatures).toHaveLength(1);
    expect(signatures[0]?.tick).toBe(0);
  });

  it("says out loud that the grouping may not travel", () => {
    /*
     * The disclosure is the other half of the byte-level fact below. Without
     * it the app would be exporting a 7/8 that loses its feel and saying
     * nothing, which is the failure mode this round set out to end.
     */
    expect(MIDI_METER_NOTE).toContain("Ölçü MIDI'ye yazılır");
    expect(MIDI_METER_NOTE).toContain("2+2+3");
    expect(MIDI_METER_NOTE).toContain("sadeleşebilir");
    /* And it never claims support. */
    expect(MIDI_METER_NOTE).not.toMatch(/destekl|korunur|taşınır/i);
  });

  it("writes a tempo that is not the fixture's accidental default", () => {
    /*
     * At 120 bpm a quarter is exactly 500000 µs, which is also what a broken
     * hardcoded writer would emit — so the honest check needs a tempo that is
     * not the round number.
     */
    const one = withBars([meterBar([7, 8], 16, [2, 2, 3])]);
    const odd: Song = { ...one, bpm: 132 };
    const tempo = readMeta(midiBytesOf(odd)).events.find(
      (event) => event.kind === "tempo",
    );
    expect(tempo?.microsecondsPerQuarter).toBe(Math.round(60_000_000 / 132));
    expect(tempo?.microsecondsPerQuarter).not.toBe(500_000);
  });

  it("does not pretend the grouping survived", () => {
    /*
     * The honesty boundary the brief names. A standard time-signature event
     * carries 7/8 and has nowhere to say `2+2+3`, so the two feels of a 7/8
     * export to **identical** meta events — which is the truth, and is why
     * the disclosure has to say so rather than the test quietly asserting
     * that grouping "works" in MIDI.
     */
    const a = readMeta(midiBytesOf(withBars([meterBar([7, 8], 16, [2, 2, 3])])));
    const b = readMeta(midiBytesOf(withBars([meterBar([7, 8], 16, [3, 2, 2])])));
    expect(a.events).toEqual(b.events);

    /* Two differently felt bars in *one* song are still one metre, so the
       file carries one event rather than a change nothing changed. */
    const both = withBars([
      meterBar([7, 8], 16, [2, 2, 3]),
      meterBar([7, 8], 16, [3, 2, 2]),
    ]);
    expect(
      readMeta(midiBytesOf(both)).events.filter(
        (event) => event.kind === "timeSignature",
      ),
    ).toHaveLength(1);

    /* And nothing writes a private marker claiming otherwise. */
    const bytes = midiBytesOf(withBars([meterBar([7, 8], 16, [2, 2, 3])]));
    const text = String.fromCharCode(...bytes);
    expect(text).not.toContain("2+2+3");
  });
});
