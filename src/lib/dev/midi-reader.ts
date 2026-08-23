/**
 * A small, bounded Standard MIDI File reader — for tests, never for the app
 * (2M-A.1 §4).
 *
 * ## Why this exists
 *
 * The claim "this file writes no pitch bend" was previously checked by
 * scanning the raw bytes for anything in `0xE0…0xEF`. That is not a claim
 * about MIDI events at all: those byte values occur constantly inside
 * *data* — a UTF-8 track name, a delta time, a tempo payload, a note number.
 * A file could carry a real pitch bend and pass, or carry none and fail,
 * depending on what someone happened to name a track.
 *
 * So the evidence moves to the right seam: parse the file the way a reader
 * does — chunk boundaries, variable-length delta times, meta lengths, SysEx
 * lengths, running status, the fixed data-byte count of each channel
 * message — and count *events*. Then "no pitch bend" means no pitch-bend
 * status was ever decoded, which is the thing that was actually promised.
 *
 * Deliberately strict: anything it cannot account for is an error rather than
 * a skipped byte, because a reader that shrugs would let a malformed file
 * look well-formed.
 *
 * Test-support only, which is why it sits in `lib/dev` beside the AST probes:
 * product code never imports it, and a boundary test holds that.
 */

export type MidiMetaEvent =
  | { kind: "tempo"; tick: number; microsecondsPerQuarter: number }
  | { kind: "timeSignature"; tick: number; numerator: number; denominator: number }
  | { kind: "trackName"; tick: number; text: string }
  | { kind: "endOfTrack"; tick: number }
  | { kind: "otherMeta"; tick: number; type: number; length: number };

export type MidiChannelEvent = {
  kind:
    | "noteOff"
    | "noteOn"
    | "polyAftertouch"
    | "controlChange"
    | "programChange"
    | "channelAftertouch"
    | "pitchBend";
  tick: number;
  channel: number;
  data: readonly number[];
};

export type MidiSysExEvent = { kind: "sysex"; tick: number; length: number };

export type MidiParsedEvent = MidiMetaEvent | MidiChannelEvent | MidiSysExEvent;

export type MidiParsed = {
  readonly format: number;
  readonly trackCount: number;
  readonly ppq: number;
  readonly tracks: readonly (readonly MidiParsedEvent[])[];
  /** Every channel event in the file, flattened. */
  readonly channelEvents: readonly MidiChannelEvent[];
  /** True when the reader had to fall back on running status anywhere. */
  readonly usedRunningStatus: boolean;
};

export class MidiParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} (offset ${offset})`);
    this.name = "MidiParseError";
  }
}

/** How many data bytes each channel message carries. Fixed by the protocol. */
const DATA_BYTES: Readonly<Record<number, number>> = {
  0x80: 2, // note off
  0x90: 2, // note on
  0xa0: 2, // polyphonic aftertouch
  0xb0: 2, // control change
  0xc0: 1, // program change
  0xd0: 1, // channel aftertouch
  0xe0: 2, // pitch bend
};

const KIND: Readonly<Record<number, MidiChannelEvent["kind"]>> = {
  0x80: "noteOff",
  0x90: "noteOn",
  0xa0: "polyAftertouch",
  0xb0: "controlChange",
  0xc0: "programChange",
  0xd0: "channelAftertouch",
  0xe0: "pitchBend",
};

export function parseMidiFile(bytes: Uint8Array): MidiParsed {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;

  const need = (count: number, what: string) => {
    if (at + count > bytes.length) throw new MidiParseError(`truncated ${what}`, at);
  };

  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  const readVlq = (): number => {
    let value = 0;
    for (let index = 0; index < 4; index += 1) {
      need(1, "variable-length quantity");
      const byte = bytes[at]!;
      at += 1;
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new MidiParseError("variable-length quantity longer than four bytes", at);
  };

  need(14, "header");
  if (ascii(0, 4) !== "MThd") throw new MidiParseError("missing MThd", 0);
  const headerLength = view.getUint32(4, false);
  if (headerLength !== 6) {
    throw new MidiParseError(`MThd length ${headerLength}, expected 6`, 4);
  }
  const format = view.getUint16(8, false);
  const trackCount = view.getUint16(10, false);
  const division = view.getUint16(12, false);
  if ((division & 0x8000) !== 0) {
    // SMPTE division: valid MIDI, but not what this app writes, and reading
    // it as PPQ would silently misreport every tick.
    throw new MidiParseError("SMPTE time division is not supported here", 12);
  }
  at = 14;

  const tracks: MidiParsedEvent[][] = [];
  const channelEvents: MidiChannelEvent[] = [];
  let usedRunningStatus = false;

  for (let index = 0; index < trackCount; index += 1) {
    need(8, "MTrk header");
    if (ascii(at, 4) !== "MTrk") throw new MidiParseError("missing MTrk", at);
    const length = view.getUint32(at + 4, false);
    at += 8;
    const end = at + length;
    if (end > bytes.length) throw new MidiParseError("MTrk runs past the file", at);

    const events: MidiParsedEvent[] = [];
    let tick = 0;
    let running: number | null = null;
    let sawEndOfTrack = false;

    while (at < end) {
      tick += readVlq();
      need(1, "event status");
      let status = bytes[at]!;

      if ((status & 0x80) !== 0) {
        at += 1;
        // A status byte cancels running status unless it is a channel message.
        running = status < 0xf0 ? status : null;
      } else {
        // Running status: the previous channel status is reused.
        if (running === null) {
          throw new MidiParseError("data byte with no running status", at);
        }
        usedRunningStatus = true;
        status = running;
      }

      if (status === 0xff) {
        need(1, "meta type");
        const type = bytes[at]!;
        at += 1;
        const metaLength = readVlq();
        need(metaLength, "meta payload");
        const payload = bytes.subarray(at, at + metaLength);
        at += metaLength;

        if (type === 0x51 && metaLength === 3) {
          events.push({
            kind: "tempo",
            tick,
            microsecondsPerQuarter:
              (payload[0]! << 16) | (payload[1]! << 8) | payload[2]!,
          });
        } else if (type === 0x58 && metaLength >= 2) {
          events.push({
            kind: "timeSignature",
            tick,
            numerator: payload[0]!,
            denominator: 2 ** payload[1]!,
          });
        } else if (type === 0x03) {
          /*
           * Decoded as Latin-1, because that is what the writer encodes:
           * every character up to U+00FF becomes its own byte and anything
           * above becomes "?". Decoding as UTF-8 instead would turn a
           * perfectly round-trippable name like "Gitar ç" into replacement
           * characters and make this reader disagree with the file it is
           * reading. (This is a reader for *these* files, not a general one.)
           */
          events.push({
            kind: "trackName",
            tick,
            text: String.fromCharCode(...payload),
          });
        } else if (type === 0x2f) {
          events.push({ kind: "endOfTrack", tick });
          sawEndOfTrack = true;
        } else {
          events.push({ kind: "otherMeta", tick, type, length: metaLength });
        }
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const sysexLength = readVlq();
        need(sysexLength, "SysEx payload");
        at += sysexLength;
        events.push({ kind: "sysex", tick, length: sysexLength });
        continue;
      }

      const high = status & 0xf0;
      const count = DATA_BYTES[high];
      const kind = KIND[high];
      if (count === undefined || kind === undefined) {
        throw new MidiParseError(`unknown status byte 0x${status.toString(16)}`, at);
      }
      need(count, "channel data");
      const data = [...bytes.subarray(at, at + count)];
      at += count;
      for (const byte of data) {
        if ((byte & 0x80) !== 0) {
          throw new MidiParseError("data byte with the high bit set", at);
        }
      }
      const event: MidiChannelEvent = { kind, tick, channel: status & 0x0f, data };
      events.push(event);
      channelEvents.push(event);
    }

    if (at !== end) throw new MidiParseError("MTrk did not end on its boundary", at);
    if (!sawEndOfTrack) throw new MidiParseError("MTrk has no end-of-track", at);
    tracks.push(events);
  }

  if (at !== bytes.length) {
    throw new MidiParseError("trailing bytes after the last track", at);
  }

  return { format, trackCount, ppq: division, tracks, channelEvents, usedRunningStatus };
}

/**
 * How many pitch-bend events the file really contains.
 *
 * The whole point of the reader: this counts decoded events, so a `0xEn` byte
 * sitting inside a track name or a delta time cannot inflate it, and a real
 * bend cannot hide behind one.
 */
export function pitchBendCount(parsed: MidiParsed): number {
  return parsed.channelEvents.filter((event) => event.kind === "pitchBend").length;
}
