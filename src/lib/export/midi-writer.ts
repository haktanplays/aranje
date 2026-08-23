/**
 * A Standard MIDI File, written byte by byte (spec 13.19, 2M-A §8).
 *
 * Pure and Song-unaware on purpose: this module knows chunks, variable-length
 * quantities and running order, and nothing about bars, ties or instruments.
 * What to write is decided next door in `midi-plan.ts`; this decides only how
 * it is spelled. The split is what makes "the same song produces the same
 * bytes" a testable sentence rather than a hope.
 *
 * Format 1 — a conductor track carrying tempo and metre, then one track per
 * part — because that is the shape every DAW and notation program opens
 * without asking questions.
 */

/** The largest delta a variable-length quantity can carry: 4 bytes, 28 bits. */
export const MAX_VLQ = 0x0fffffff;

export type MetaEvent =
  | { readonly kind: "tempo"; readonly microsecondsPerQuarter: number }
  | {
      readonly kind: "timeSignature";
      readonly numerator: number;
      /** The real denominator (4, 8); the power-of-two byte is derived here. */
      readonly denominator: number;
    }
  | { readonly kind: "trackName"; readonly text: string }
  | { readonly kind: "endOfTrack" };

export type ChannelEvent =
  | { readonly kind: "programChange"; readonly channel: number; readonly program: number }
  | {
      readonly kind: "controlChange";
      readonly channel: number;
      readonly controller: number;
      readonly value: number;
    }
  | {
      readonly kind: "noteOn";
      readonly channel: number;
      readonly note: number;
      readonly velocity: number;
    }
  | {
      readonly kind: "noteOff";
      readonly channel: number;
      readonly note: number;
    };

export type MidiEvent = (MetaEvent | ChannelEvent) & {
  /** Absolute tick from the start of the file. */
  readonly tick: number;
  /**
   * Tie-break inside one tick, smaller first.
   *
   * Ordering at a shared tick is not cosmetic: a note-off has to reach the
   * synth before the note-on that re-strikes the same pitch, or the second
   * strike is cut by the first note's release. The plan assigns these; the
   * writer only obeys them.
   */
  readonly order: number;
};

export type MidiTrackInput = {
  readonly events: readonly MidiEvent[];
};

export type MidiWriteErrorCode =
  | "midi_no_tracks"
  | "midi_delta_out_of_range"
  | "midi_value_out_of_range"
  | "midi_tick_not_integer";

export type MidiWriteResult =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly code: MidiWriteErrorCode };

/* ------------------------------------------------------------- byte tools */

/** Canonical VLQ: the shortest encoding, high bit set on all but the last. */
export function encodeVariableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

const ascii = (text: string): number[] => {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    // Meta text is Latin-1 in practice; anything above stays out of the file
    // rather than arriving as a mangled multi-byte sequence.
    const code = text.charCodeAt(index);
    bytes.push(code > 0xff ? 0x3f : code);
  }
  return bytes;
};

const inData = (value: number) => Number.isInteger(value) && value >= 0 && value <= 127;
const inChannel = (value: number) => Number.isInteger(value) && value >= 0 && value <= 15;

/** The power-of-two byte a MIDI time signature carries: 4 → 2, 8 → 3. */
function denominatorPower(denominator: number): number {
  return Math.round(Math.log2(denominator));
}

function eventBytes(event: MetaEvent | ChannelEvent): number[] | null {
  switch (event.kind) {
    case "tempo": {
      const value = Math.round(event.microsecondsPerQuarter);
      if (!Number.isInteger(value) || value <= 0 || value > 0xffffff) return null;
      return [0xff, 0x51, 0x03, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
    }
    case "timeSignature": {
      const power = denominatorPower(event.denominator);
      if (!Number.isInteger(event.numerator) || event.numerator <= 0) return null;
      if (!Number.isInteger(power) || power < 0 || power > 7) return null;
      /*
       * 24 clocks per metronome click and 8 32nds per quarter are the values
       * every sequencer writes and every reader ignores; they are part of the
       * event's fixed shape, not a musical choice this app is making.
       */
      return [0xff, 0x58, 0x04, event.numerator, power, 24, 8];
    }
    case "trackName": {
      const text = ascii(event.text);
      return [0xff, 0x03, ...encodeVariableLength(text.length), ...text];
    }
    case "endOfTrack":
      return [0xff, 0x2f, 0x00];
    case "programChange":
      if (!inChannel(event.channel) || !inData(event.program)) return null;
      return [0xc0 | event.channel, event.program];
    case "controlChange":
      if (!inChannel(event.channel)) return null;
      if (!inData(event.controller) || !inData(event.value)) return null;
      return [0xb0 | event.channel, event.controller, event.value];
    case "noteOn":
      if (!inChannel(event.channel)) return null;
      if (!inData(event.note) || !inData(event.velocity)) return null;
      return [0x90 | event.channel, event.note, event.velocity];
    case "noteOff":
      if (!inChannel(event.channel) || !inData(event.note)) return null;
      // Velocity 0 on a note-off is the value sequencers agree on.
      return [0x80 | event.channel, event.note, 0];
  }
}

const chunk = (id: string, body: number[]): number[] => {
  const length = body.length;
  return [
    ...ascii(id),
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ];
};

/* ----------------------------------------------------------- the whole file */

/**
 * Write one `.mid` file.
 *
 * Events are sorted by `(tick, order)` with a stable index tie-break, so two
 * calls on the same plan produce the same bytes down to the last delta. No
 * running status: a byte saved is not worth a file that a stricter reader
 * refuses.
 */
export function writeMidiFile(input: {
  readonly ppq: number;
  readonly tracks: readonly MidiTrackInput[];
}): MidiWriteResult {
  const { ppq, tracks } = input;
  if (tracks.length === 0) return { ok: false, code: "midi_no_tracks" };

  const header = chunk("MThd", [
    0x00,
    0x01, // format 1
    (tracks.length >>> 8) & 0xff,
    tracks.length & 0xff,
    (ppq >>> 8) & 0xff,
    ppq & 0xff,
  ]);

  const body: number[] = [];
  for (const track of tracks) {
    const ordered = track.events
      .map((event, index) => ({ event, index }))
      .sort(
        (a, b) =>
          a.event.tick - b.event.tick ||
          a.event.order - b.event.order ||
          a.index - b.index,
      );

    const trackBytes: number[] = [];
    let previousTick = 0;
    for (const { event } of ordered) {
      if (!Number.isInteger(event.tick) || event.tick < 0) {
        return { ok: false, code: "midi_tick_not_integer" };
      }
      const delta = event.tick - previousTick;
      if (delta < 0 || delta > MAX_VLQ) {
        return { ok: false, code: "midi_delta_out_of_range" };
      }
      const encoded = eventBytes(event);
      if (encoded === null) return { ok: false, code: "midi_value_out_of_range" };
      trackBytes.push(...encodeVariableLength(delta), ...encoded);
      previousTick = event.tick;
    }
    body.push(...chunk("MTrk", trackBytes));
  }

  return { ok: true, bytes: Uint8Array.from([...header, ...body]) };
}
