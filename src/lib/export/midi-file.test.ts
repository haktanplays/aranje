/**
 * The MIDI file, asserted as bytes and as music (spec 13.19, 2M-A §8-§10, §16).
 *
 * Two layers are checked together because both have to be right for a `.mid`
 * to be worth anything: the chunk/VLQ spelling, and the musical decisions —
 * which tick a note starts on, how long a tie makes it, which channel a drum
 * lands on, and what a reader is told about tempo and metre.
 *
 * The events are decoded back out of the real bytes rather than read off the
 * plan. A plan that says the right thing and a writer that spells it wrongly
 * would pass a plan-only test and produce a file nothing opens.
 */
import { describe, expect, it } from "vitest";

import { PPQ } from "@/lib/music/timing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";
import {
  MIDI_CC,
  MIDI_DRUM_CHANNEL,
  MIDI_DRUM_NOTES,
  MIDI_PROGRAMS,
  midiDrumNoteFor,
  midiProgramFor,
  panToCc10,
  volumeDbToCc7,
} from "@/lib/export/midi-map";
import { buildMidiPlan, microsecondsPerQuarter } from "@/lib/export/midi-plan";
import {
  encodeVariableLength,
  writeMidiFile,
  type MidiEvent,
} from "@/lib/export/midi-writer";
import { parseMidiFile, pitchBendCount } from "@/lib/dev/midi-reader";

/* ------------------------------------------------------------- decoding */

/*
 * The file is read back with the strict reader in `lib/dev`, which walks
 * chunks, delta times, meta and SysEx lengths and running status exactly as a
 * player would. Assertions are therefore about decoded *events*, not about
 * bytes that happen to look like events.
 */
type Decoded = {
  format: number;
  ppq: number;
  tracks: DecodedEvent[][];
};

type DecodedEvent = {
  tick: number;
  type: string;
  channel?: number;
  a?: number;
  b?: number;
  text?: string;
};

/** The parsed events, flattened into the shape these assertions read. */
function decodeMidi(bytes: Uint8Array): Decoded {
  const parsed = parseMidiFile(bytes);
  const tracks = parsed.tracks.map((events) =>
    events.map((event): DecodedEvent => {
      switch (event.kind) {
        case "tempo":
          return { tick: event.tick, type: "tempo", a: event.microsecondsPerQuarter };
        case "timeSignature":
          return {
            tick: event.tick,
            type: "timeSignature",
            a: event.numerator,
            b: event.denominator,
          };
        case "trackName":
          return { tick: event.tick, type: "trackName", text: event.text };
        case "endOfTrack":
          return { tick: event.tick, type: "endOfTrack" };
        case "otherMeta":
          return { tick: event.tick, type: "otherMeta", a: event.type };
        case "sysex":
          return { tick: event.tick, type: "sysex", a: event.length };
        case "noteOn":
          return {
            tick: event.tick,
            type: "noteOn",
            channel: event.channel,
            a: event.data[0],
            b: event.data[1],
          };
        case "noteOff":
          return {
            tick: event.tick,
            type: "noteOff",
            channel: event.channel,
            a: event.data[0],
            b: event.data[1],
          };
        case "controlChange":
          return {
            tick: event.tick,
            type: "controlChange",
            channel: event.channel,
            a: event.data[0],
            b: event.data[1],
          };
        case "programChange":
          return {
            tick: event.tick,
            type: "programChange",
            channel: event.channel,
            a: event.data[0],
          };
        default:
          return { tick: event.tick, type: event.kind, channel: event.channel };
      }
    }),
  );
  // Nothing this app writes needs running status, and a file that used it
  // would be harder for a strict reader to accept.
  expect(parsed.usedRunningStatus).toBe(false);
  return { format: parsed.format, ppq: parsed.ppq, tracks };
}

/**
 * Put one real pitch-bend message at the end of the first track.
 *
 * Written by hand because the writer has no pitch-bend event kind — which is
 * the point of the design, and the reason a test needs another way to produce
 * one. The MTrk length is corrected so the result is a file a strict reader
 * accepts rather than a broken one it happens to reject.
 */
function injectPitchBend(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trackLength = view.getUint32(18, false);
  const bodyStart = 22;
  const bodyEnd = bodyStart + trackLength;

  // delta 0, pitch bend on channel 0, LSB 0, MSB 0x50.
  const message = [0x00, 0xe0, 0x00, 0x50];
  // The end-of-track meta is the last four bytes: delta + FF 2F 00.
  const endOfTrack = [...bytes.subarray(bodyEnd - 4, bodyEnd)];
  const body = [
    ...bytes.subarray(bodyStart, bodyEnd - 4),
    ...message,
    ...endOfTrack,
  ];

  const out = new Uint8Array(bodyStart + body.length);
  out.set(bytes.subarray(0, bodyStart), 0);
  out.set(body, bodyStart);
  new DataView(out.buffer).setUint32(18, body.length, false);
  return out;
}

const written = (song: Song) => {
  const plan = buildMidiPlan(song);
  if (!plan.ok) throw new Error(`plan refused: ${plan.code} ${plan.detail}`);
  const file = writeMidiFile(plan.plan);
  if (!file.ok) throw new Error(`write refused: ${file.code}`);
  return { bytes: file.bytes, decoded: decodeMidi(file.bytes), plan: plan.plan };
};

/* ------------------------------------------------------------- fixtures */

const GUITAR = ["E2", "A2", "D3", "G3", "B3", "E4"];

const guitarTrack = (id: string, name: string) => ({
  id,
  name,
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: 0,
  fretboard: { tuning: GUITAR, capo: 0 },
});

const note = (pitch: string, fret = 0) => ({
  notes: [{ pitch, position: { string: 0, fret } }],
});

const rest = (count: number) => Array.from({ length: count }, () => null);

/** One track, one section, bars given as slot arrays. */
function oneTrackSong(
  bars: { timeSignature: [number, number]; resolution: number; slots: unknown[] }[],
  overrides: Partial<Song> = {},
): Song {
  return songSchema.parse({
    version: 2,
    title: "MIDI",
    bpm: 120,
    key: "E minor",
    tracks: [guitarTrack("gtr", "Gitar")],
    sections: [
      {
        id: "s1",
        name: "Bölüm",
        status: "fixed",
        bars: bars.map((bar) => ({
          timeSignature: bar.timeSignature,
          resolution: bar.resolution,
          slots: { gtr: bar.slots },
        })),
      },
    ],
    ...overrides,
  });
}

describe("67. the MIDI file's shape", () => {
  it("is format 1 with a conductor track and one track per part", () => {
    const { decoded } = written(SAMPLE_SONG);
    expect(decoded.format).toBe(1);
    expect(decoded.tracks.length).toBe(SAMPLE_SONG.tracks.length + 1);
  });

  it("takes its PPQ from the app's own tick model", () => {
    // Not a copied constant: a second one would drift the day the grid does.
    const { decoded, plan } = written(SAMPLE_SONG);
    expect(decoded.ppq).toBe(PPQ);
    expect(plan.ppq).toBe(PPQ);
  });

  it("ends every track with exactly one end-of-track, last", () => {
    const { decoded } = written(SAMPLE_SONG);
    for (const track of decoded.tracks) {
      const ends = track.filter((event) => event.type === "endOfTrack");
      expect(ends.length).toBe(1);
      expect(track[track.length - 1]?.type).toBe("endOfTrack");
    }
  });

  it("names the song and every track", () => {
    const { decoded } = written(SAMPLE_SONG);
    expect(decoded.tracks[0]?.[0]).toMatchObject({
      type: "trackName",
      text: SAMPLE_SONG.title,
    });
    SAMPLE_SONG.tracks.forEach((track, index) => {
      expect(decoded.tracks[index + 1]?.[0]).toMatchObject({
        type: "trackName",
        text: track.name,
      });
    });
  });

  it("writes canonical variable-length quantities", () => {
    // The boundary cases from the MIDI spec's own table.
    expect(encodeVariableLength(0)).toEqual([0x00]);
    expect(encodeVariableLength(127)).toEqual([0x7f]);
    expect(encodeVariableLength(128)).toEqual([0x81, 0x00]);
    expect(encodeVariableLength(8192)).toEqual([0xc0, 0x00]);
    expect(encodeVariableLength(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });

  it("refuses a delta or a data byte it cannot spell", () => {
    const base: MidiEvent[] = [{ kind: "endOfTrack", tick: 0, order: 9 }];
    expect(writeMidiFile({ ppq: PPQ, tracks: [] })).toEqual({
      ok: false,
      code: "midi_no_tracks",
    });

    const huge = writeMidiFile({
      ppq: PPQ,
      tracks: [{ events: [{ kind: "endOfTrack", tick: 0x10000000, order: 9 }] }],
    });
    expect(!huge.ok && huge.code).toBe("midi_delta_out_of_range");

    const bad = writeMidiFile({
      ppq: PPQ,
      tracks: [
        {
          events: [
            { kind: "noteOn", channel: 0, note: 200, velocity: 64, tick: 0, order: 4 },
            ...base,
          ],
        },
      ],
    });
    expect(!bad.ok && bad.code).toBe("midi_value_out_of_range");
  });

  it("gives the same bytes five runs in a row", () => {
    const runs = Array.from({ length: 5 }, () =>
      [...written(SAMPLE_SONG).bytes].join(","),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("68. the conductor track carries tempo and metre", () => {
  it("writes a tempo event for the song and for every section that changes it", () => {
    const song: Song = {
      ...SAMPLE_SONG,
      bpm: 120,
      sections: SAMPLE_SONG.sections.map((section, index) =>
        index === 1 ? { ...section, bpmOverride: 90 } : section,
      ),
    };
    const tempos = written(song).decoded.tracks[0]!.filter(
      (event) => event.type === "tempo",
    );
    expect(tempos.length).toBeGreaterThanOrEqual(2);
    expect(tempos[0]?.a).toBe(microsecondsPerQuarter(120));
    expect(tempos.some((event) => event.a === microsecondsPerQuarter(90))).toBe(true);
  });

  it("writes one time signature per real change, not one per bar", () => {
    const song = oneTrackSong([
      { timeSignature: [4, 4], resolution: 8, slots: [note("E2"), ...rest(7)] },
      { timeSignature: [4, 4], resolution: 8, slots: rest(8) },
      { timeSignature: [7, 8], resolution: 8, slots: rest(7) },
      { timeSignature: [7, 8], resolution: 8, slots: rest(7) },
      { timeSignature: [3, 4], resolution: 8, slots: rest(6) },
    ]);
    const meters = written(song).decoded.tracks[0]!.filter(
      (event) => event.type === "timeSignature",
    );
    expect(meters.map((event) => [event.a, event.b])).toEqual([
      [4, 4],
      [7, 8],
      [3, 4],
    ]);
    // ...and at the tick the metre actually changes.
    expect(meters[1]?.tick).toBe(2 * 4 * PPQ);
  });

  it("writes the written tempo, never a practice rate", () => {
    // Practice speed is a rehearsal aid. A file that carried it would be a
    // different piece of music to everyone who opened it.
    const tempos = written({ ...SAMPLE_SONG, bpm: 100 }).decoded.tracks[0]!.filter(
      (event) => event.type === "tempo",
    );
    expect(tempos[0]?.a).toBe(microsecondsPerQuarter(100));
  });
});

describe("69. the notes are the score, not the performance", () => {
  it("puts a note on its written tick with its written velocity", () => {
    const song = oneTrackSong([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [
          null,
          { notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, velocity: 40 }] },
          ...rest(6),
        ],
      },
    ]);
    const events = written(song).decoded.tracks[1]!;
    const on = events.find((event) => event.type === "noteOn")!;
    expect(on.tick).toBe(PPQ / 2); // one 1/8 slot in
    expect(on.b).toBe(40);
    expect(on.a).toBe(40); // E2 is MIDI note 40
  });

  it("gives a tied note its whole merged length, not the shortened one", () => {
    /*
     * Playback lifts the finger early (`articulationHold`). A score reader
     * must be told the length the note is *written* to last, or every tie in
     * the file arrives visibly short.
     */
    const song = oneTrackSong([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [note("E2"), "-", "-", "-", ...rest(4)],
      },
    ]);
    const events = written(song).decoded.tracks[1]!;
    const on = events.find((event) => event.type === "noteOn")!;
    const off = events.find((event) => event.type === "noteOff")!;
    expect(off.tick - on.tick).toBe(4 * (PPQ / 2));
  });

  it("does not re-strike a tied note", () => {
    const song = oneTrackSong([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [note("E2"), "-", "-", "-", ...rest(4)],
      },
    ]);
    const events = written(song).decoded.tracks[1]!;
    expect(events.filter((event) => event.type === "noteOn").length).toBe(1);
  });

  it("carries a tie across a bar line as one note", () => {
    const song = oneTrackSong([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [...rest(7), note("E2")],
      },
      { timeSignature: [4, 4], resolution: 8, slots: ["-", ...rest(7)] },
    ]);
    const events = written(song).decoded.tracks[1]!;
    const ons = events.filter((event) => event.type === "noteOn");
    const offs = events.filter((event) => event.type === "noteOff");
    expect(ons.length).toBe(1);
    expect(offs[0]!.tick - ons[0]!.tick).toBe(2 * (PPQ / 2));
  });

  it("closes a note before the same pitch is struck again", () => {
    /*
     * Ordering inside a tick is not cosmetic: a note-on that reached the
     * synth before the previous note's off would be cut by that off.
     */
    const song = oneTrackSong([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [note("E2"), note("E2"), ...rest(6)],
      },
    ]);
    const events = written(song).decoded.tracks[1]!.filter(
      (event) => event.type === "noteOn" || event.type === "noteOff",
    );
    const secondOnIndex = events.findIndex(
      (event, index) => index > 0 && event.type === "noteOn",
    );
    const firstOffIndex = events.findIndex((event) => event.type === "noteOff");
    expect(firstOffIndex).toBeGreaterThanOrEqual(0);
    expect(firstOffIndex).toBeLessThan(secondOnIndex);
  });

  it("keeps a mixed grid's ticks exact", () => {
    const song = oneTrackSong([
      { timeSignature: [4, 4], resolution: 12, slots: [note("E2"), ...rest(11)] },
      { timeSignature: [4, 4], resolution: 8, slots: [note("E2"), ...rest(7)] },
    ]);
    const ons = written(song).decoded.tracks[1]!.filter(
      (event) => event.type === "noteOn",
    );
    expect(ons.map((event) => event.tick)).toEqual([0, 4 * PPQ]);
  });

  it("writes no pitch bend, for any articulation", () => {
    /*
     * §9, and the reason it is a rule: MIDI's channel-wide bend would detune
     * every other note sounding on that channel. Bend, slide and vibrato are
     * heard in the WAV; the MIDI carries the notes underneath them.
     */
    const song = oneTrackSong([
      {
        timeSignature: [4, 4],
        resolution: 8,
        slots: [
          { notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, articulation: "bend_full" }] },
          {
            notes: [
              { pitch: "G2", position: { string: 0, fret: 3 }, articulation: "hammer_on" },
            ],
          },
          {
            notes: [{ pitch: "A2", position: { string: 0, fret: 5 }, articulation: "vibrato" }],
          },
          ...rest(5),
        ],
      },
    ]);
    const { bytes } = written(song);
    const parsed = parseMidiFile(bytes);

    // Decoded events, not bytes that look like events (2M-A.1 §4).
    expect(pitchBendCount(parsed)).toBe(0);
    expect(
      parsed.channelEvents.map((event) => event.kind).filter((kind) => kind === "pitchBend"),
    ).toEqual([]);
    // Nor any of the other channel-wide gestures a bend could hide behind.
    for (const event of parsed.channelEvents) {
      expect(event.kind).not.toBe("channelAftertouch");
      expect(event.kind).not.toBe("polyAftertouch");
    }
  });

  it("counts events, not bytes: a name full of 0xE0 is still bend-free", () => {
    /*
     * The non-vacuity fixture for the check above.
     *
     * A raw scan for `0xE0…0xEF` is not a statement about MIDI events: those
     * byte values appear constantly inside data. The writer encodes meta text
     * as Latin-1, so "à" (U+00E0) becomes the single byte `0xE0` — which is
     * literally a pitch-bend status byte — and "ç" (U+00E7) becomes `0xE7`.
     * A Turkish song title is enough to plant several of them.
     *
     * So: the raw bytes really do contain 0xE0-range bytes, the parser really
     * does report zero pitch bends, and the next test proves the parser is not
     * simply blind to them.
     */
    const song: Song = {
      ...SAMPLE_SONG,
      title: "Àçaì Càfè çà",
      tracks: SAMPLE_SONG.tracks.map((track, index) =>
        index === 0 ? { ...track, name: "Gitar çà" } : track,
      ),
    };
    const { bytes } = written(song);

    // The byte a naive scan would trip over is genuinely in the file.
    expect([...bytes].some((byte) => (byte & 0xf0) === 0xe0)).toBe(true);
    expect([...bytes].filter((byte) => (byte & 0xf0) === 0xe0).length).toBeGreaterThan(1);

    // And the file still carries no pitch-bend event.
    const parsed = parseMidiFile(bytes);
    expect(pitchBendCount(parsed)).toBe(0);

    // The names survive the round trip, so the fixture is doing what it says.
    const names = parsed.tracks
      .flat()
      .filter((event) => event.kind === "trackName")
      .map((event) => (event as { text: string }).text);
    // Every character here is inside Latin-1, so the round trip is exact and
    // the fixture cannot be passing by accident of replacement characters.
    expect(names[0]).toBe("Àçaì Càfè çà");
    expect(names).toContain("Gitar çà");
  });

  it("sees a pitch bend when there really is one", () => {
    /*
     * The other half of the non-vacuity argument: a parser that always
     * answered zero would pass every test above. One real bend, written
     * through the same writer, has to be found.
     */
    const withBend = writeMidiFile({
      ppq: PPQ,
      tracks: [
        {
          events: [
            { kind: "trackName", text: "Bend", tick: 0, order: 0 },
            {
              kind: "controlChange",
              channel: 0,
              controller: 7,
              value: 100,
              tick: 0,
              order: 2,
            },
            { kind: "endOfTrack", tick: 10, order: 9 },
          ],
        },
      ],
    });
    expect(withBend.ok).toBe(true);
    if (!withBend.ok) return;

    // Splice a real pitch-bend message into the track, adjusting the chunk
    // length so the file stays well-formed for a strict reader.
    const injected = injectPitchBend(withBend.bytes);
    const parsed = parseMidiFile(injected);
    expect(pitchBendCount(parsed)).toBe(1);
    expect(parsed.channelEvents.find((event) => event.kind === "pitchBend")).toMatchObject(
      { channel: 0, data: [0, 0x50] },
    );
  });
});

describe("70. instruments, drums and the persisted mix", () => {
  it("sends one program change per melodic track, and none for drums", () => {
    const { decoded } = written(SAMPLE_SONG);
    SAMPLE_SONG.tracks.forEach((track, index) => {
      const events = decoded.tracks[index + 1]!;
      const programs = events.filter((event) => event.type === "programChange");
      if (track.instrumentId === "drum_kit") {
        // On channel 10 a program change picks a different *kit*, not an
        // instrument: sending one would quietly change the sound.
        expect(programs.length, track.id).toBe(0);
      } else {
        expect(programs.length, track.id).toBe(1);
        expect(programs[0]?.a).toBe(MIDI_PROGRAMS[track.instrumentId]);
      }
    });
  });

  it("puts the drum track on the GM percussion channel and melodic tracks off it", () => {
    const { decoded } = written(SAMPLE_SONG);
    SAMPLE_SONG.tracks.forEach((track, index) => {
      const sounding = decoded.tracks[index + 1]!.filter(
        (event) => event.type === "noteOn",
      );
      if (sounding.length === 0) return;
      for (const event of sounding) {
        if (track.instrumentId === "drum_kit") {
          expect(event.channel, track.id).toBe(MIDI_DRUM_CHANNEL);
        } else {
          expect(event.channel, track.id).not.toBe(MIDI_DRUM_CHANNEL);
        }
      }
    });
  });

  it("keeps kick, snare, hats, cymbals and toms apart", () => {
    const notes = Object.values(MIDI_DRUM_NOTES);
    expect(new Set(notes).size).toBe(notes.length);
    expect(MIDI_DRUM_NOTES.kick).not.toBe(MIDI_DRUM_NOTES.snare);
    expect(MIDI_DRUM_NOTES.closed_hat).not.toBe(MIDI_DRUM_NOTES.open_hat);
    expect(MIDI_DRUM_NOTES.tom_high).not.toBe(MIDI_DRUM_NOTES.tom_floor);
  });

  it("refuses an instrument or a drum piece it has no honest mapping for", () => {
    // Silence beats a lie: a bass exported as a piano is worse than a refusal.
    const unknown = midiProgramFor("theremin");
    expect(!unknown.ok && unknown.code).toBe("midi_instrument_unsupported");
    expect(!unknown.ok && unknown.detail).toBe("theremin");

    const drum = midiDrumNoteFor("cowbell");
    expect(!drum.ok && drum.code).toBe("midi_drum_unsupported");

    const song: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track, index) =>
        index === 0 ? { ...track, instrumentId: "theremin" } : track,
      ),
    };
    const plan = buildMidiPlan(song);
    expect(!plan.ok && plan.code).toBe("midi_instrument_unsupported");
  });

  it("writes the persisted level and stereo position as CC7 and CC10", () => {
    const song: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track, index) =>
        index === 0 ? { ...track, volumeDb: -6, pan: -1 } : track,
      ),
    };
    const events = written(song).decoded.tracks[1]!;
    const volume = events.find(
      (event) => event.type === "controlChange" && event.a === MIDI_CC.volume,
    );
    const pan = events.find(
      (event) => event.type === "controlChange" && event.a === MIDI_CC.pan,
    );
    expect(volume?.b).toBe(volumeDbToCc7(-6));
    expect(pan?.b).toBe(panToCc10(-1));
    expect(pan?.b).toBe(0); // hard left is a true zero
    expect(volume?.tick).toBe(0);
  });

  it("converts level and position deterministically, clamping only at MIDI's wall", () => {
    expect(volumeDbToCc7(0)).toBe(127);
    expect(volumeDbToCc7(-6)).toBe(64); // about half amplitude
    expect(volumeDbToCc7(6)).toBe(127); // above full scale: MIDI has no more
    expect(volumeDbToCc7(-200)).toBe(0);

    expect(panToCc10(0)).toBe(64); // exact centre, never 63
    expect(panToCc10(-1)).toBe(0);
    expect(panToCc10(1)).toBe(127);
    expect(panToCc10(-0.5)).toBe(32);
    expect(panToCc10(5)).toBe(127);
  });

  it("never consults the session audition or the legacy contract flags", () => {
    /*
     * MIDI is the song. Two songs that differ only in the phase-0
     * `muted`/`soloed` flags must produce identical files (§0), and there is
     * no audition parameter to pass in the first place.
     */
    const flagged: Song = {
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track, index) =>
        index === 0 ? { ...track, muted: true, soloed: true } : track,
      ),
    };
    expect([...written(flagged).bytes]).toEqual([...written(SAMPLE_SONG).bytes]);
  });
});
