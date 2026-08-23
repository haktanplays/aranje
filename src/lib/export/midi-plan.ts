/**
 * A Song as Standard MIDI File events (spec 13.19, 2M-A §8, §9).
 *
 * The musical half of MIDI export: what a `.mid` should say about this song.
 * Spelling those events as bytes is `midi-writer.ts`'s job, and reading the
 * score is `buildNotatedPlan`'s — this module owns neither, which is how the
 * export stays free of a second timing model.
 *
 * **What V1 carries, and why that is the whole list.** Pitch, onset, the
 * tie-merged length, velocity, tempo, metre, track identity, a GM program and
 * the persisted level and stereo position. Every one of those means the same
 * thing in every program that opens the file.
 *
 * **What V1 deliberately does not carry.** Bend, slide, vibrato, hammer-on and
 * pull-off are *heard* in the WAV and are not invented here. The honest reason
 * is that MIDI's only channel-level tool for them is pitch bend, which moves
 * every note sounding on that channel: writing a bend for one note of a chord
 * would detune the other notes of that chord in the reader's DAW. A file that
 * quietly detunes a chord is worse than a file that says it carries notes and
 * timing — so no MPE, no per-track bend, no invented convention. The export
 * sheet says this in the user's own words.
 */
import { buildNotatedPlan } from "@/lib/audio/schedule";
import { buildTempoMap } from "@/lib/audio/tempo";
import { isDrumInstrument } from "@/lib/instruments/registry";
import { PPQ } from "@/lib/music/timing";
import { pitchToMidi } from "@/lib/music/pitch";
import { trackPan } from "@/lib/song/track-mix";
import type { Song } from "@/lib/song/schema";
import {
  MIDI_CC,
  MIDI_DRUM_CHANNEL,
  midiDrumNoteFor,
  midiProgramFor,
  panToCc10,
  volumeDbToCc7,
  type MidiMapErrorCode,
} from "@/lib/export/midi-map";
import type { MidiEvent, MidiTrackInput } from "@/lib/export/midi-writer";

/**
 * Order inside a shared tick.
 *
 * Named rather than numbered at the call sites, because the *reason* for the
 * order is the point: setup reaches the synth before anything sounds, and a
 * note-off lands before a note-on that re-strikes the same pitch — otherwise
 * the second strike is cut short by the first note's release.
 */
const ORDER = {
  meta: 0,
  program: 1,
  controller: 2,
  noteOff: 3,
  noteOn: 4,
  endOfTrack: 9,
} as const;

/** Microseconds per quarter note, the unit a MIDI tempo event carries. */
export function microsecondsPerQuarter(bpm: number): number {
  return Math.round(60_000_000 / bpm);
}

export type MidiPlanErrorCode = MidiMapErrorCode | "midi_unplayable_pitch";

export type MidiPlan = {
  readonly ppq: number;
  readonly tracks: readonly MidiTrackInput[];
  /** For the pre-export estimate: how many events the file will carry. */
  readonly eventCount: number;
  readonly totalTicks: number;
};

export type MidiPlanResult =
  | { readonly ok: true; readonly plan: MidiPlan }
  | { readonly ok: false; readonly code: MidiPlanErrorCode; readonly detail: string };

/**
 * Channels for the melodic tracks.
 *
 * Channel 10 (index 9) belongs to percussion in GM and is skipped, so a
 * ninth melodic track does not land on the drum channel and turn into
 * cymbals. The contract caps a song at eight tracks, so the sixteen channels
 * are never exhausted; the skip is here because correctness should not depend
 * on that cap staying where it is.
 */
function melodicChannels(count: number): number[] {
  const channels: number[] = [];
  for (let channel = 0; channels.length < count && channel < 16; channel += 1) {
    if (channel === MIDI_DRUM_CHANNEL) continue;
    channels.push(channel);
  }
  return channels;
}

/**
 * The conductor track: tempo, metre and the song's name.
 *
 * A tempo event at every section that states a different tempo, and a time
 * signature at every tick where the metre actually changes — not one per bar,
 * which would be noise, and not one at the top, which would be a lie about a
 * song that changes metre halfway through.
 */
function conductorTrack(song: Song): MidiTrackInput {
  const events: MidiEvent[] = [
    { kind: "trackName", text: song.title, tick: 0, order: ORDER.meta },
  ];

  const tempo = buildTempoMap(song);
  let lastBpm: number | null = null;
  for (const segment of tempo.segments) {
    // The *written* tempo: practice rate is a rehearsal aid, never the file.
    if (segment.writtenBpm === lastBpm) continue;
    events.push({
      kind: "tempo",
      microsecondsPerQuarter: microsecondsPerQuarter(segment.writtenBpm),
      tick: segment.startTicks,
      order: ORDER.meta,
    });
    lastBpm = segment.writtenBpm;
  }

  const plan = buildNotatedPlan(song);
  let lastMeter: string | null = null;
  for (const bar of plan.bars) {
    const key = `${bar.timeSignature[0]}/${bar.timeSignature[1]}`;
    if (key === lastMeter) continue;
    events.push({
      kind: "timeSignature",
      numerator: bar.timeSignature[0],
      denominator: bar.timeSignature[1],
      tick: bar.time,
      order: ORDER.meta,
    });
    lastMeter = key;
  }

  events.push({ kind: "endOfTrack", tick: plan.totalTicks, order: ORDER.endOfTrack });
  return { events };
}

/**
 * Build the whole file's events.
 *
 * Session mute and solo are not a parameter here and never will be: MIDI
 * carries the song, and how someone happened to be listening is not part of
 * it. The phase-0 `muted`/`soloed` contract flags are likewise never read
 * (2M-A §0) — they decide nothing anywhere.
 */
export function buildMidiPlan(song: Song): MidiPlanResult {
  const notated = buildNotatedPlan(song);
  const melodic = song.tracks.filter(
    (track) => !isDrumInstrument(track.instrumentId),
  );
  const channels = melodicChannels(melodic.length);
  const channelOf = new Map<string, number>();
  melodic.forEach((track, index) => channelOf.set(track.id, channels[index]!));

  const tracks: MidiTrackInput[] = [conductorTrack(song)];

  for (const track of song.tracks) {
    const drums = isDrumInstrument(track.instrumentId);
    const channel = drums ? MIDI_DRUM_CHANNEL : channelOf.get(track.id)!;
    const events: MidiEvent[] = [
      { kind: "trackName", text: track.name, tick: 0, order: ORDER.meta },
    ];

    /*
     * A drum track gets no program change: in GM the kit is chosen by being
     * on channel 10, and a program change there would pick a *different kit*
     * rather than an instrument. Sending one would be the sort of plausible
     * extra byte that quietly changes the sound.
     */
    if (!drums) {
      const program = midiProgramFor(track.instrumentId);
      if (!program.ok) return { ok: false, code: program.code, detail: program.detail };
      events.push({
        kind: "programChange",
        channel,
        program: program.program,
        tick: 0,
        order: ORDER.program,
      });
    }

    // The persisted mix, which is project data and travels. Session audition
    // is a different thing and is not consulted.
    events.push(
      {
        kind: "controlChange",
        channel,
        controller: MIDI_CC.volume,
        value: volumeDbToCc7(track.volumeDb),
        tick: 0,
        order: ORDER.controller,
      },
      {
        kind: "controlChange",
        channel,
        controller: MIDI_CC.pan,
        value: panToCc10(trackPan(track)),
        tick: 0,
        order: ORDER.controller,
      },
    );

    for (const event of notated.events) {
      if (event.trackId !== track.id) continue;

      if (event.kind === "drum") {
        const note = midiDrumNoteFor(event.piece);
        if (!note.ok) return { ok: false, code: note.code, detail: note.detail };
        /*
         * A percussion hit has no length worth writing: the sample decides
         * how long it rings. One tick keeps note-on and note-off in the right
         * order without pretending to a duration the score never stated.
         */
        events.push(
          {
            kind: "noteOn",
            channel,
            note: note.program,
            velocity: event.velocity,
            tick: event.time,
            order: ORDER.noteOn,
          },
          {
            kind: "noteOff",
            channel,
            note: note.program,
            tick: event.time + 1,
            order: ORDER.noteOff,
          },
        );
        continue;
      }

      const note = pitchToMidi(event.pitch);
      if (note === null || note < 0 || note > 127) {
        return { ok: false, code: "midi_unplayable_pitch", detail: event.pitch };
      }
      events.push(
        {
          kind: "noteOn",
          channel,
          note,
          velocity: event.velocity,
          tick: event.time,
          order: ORDER.noteOn,
        },
        {
          // The whole tie-merged length, not the shortened one playback uses:
          // a score reader is being told how long the note is written to last.
          kind: "noteOff",
          channel,
          note,
          tick: event.time + Math.max(1, event.durationTicks),
          order: ORDER.noteOff,
        },
      );
    }

    events.push({
      kind: "endOfTrack",
      tick: Math.max(
        notated.totalTicks,
        ...events.map((entry) => entry.tick),
      ),
      order: ORDER.endOfTrack,
    });
    tracks.push({ events });
  }

  return {
    ok: true,
    plan: {
      ppq: PPQ,
      tracks,
      eventCount: tracks.reduce((sum, track) => sum + track.events.length, 0),
      totalTicks: notated.totalTicks,
    },
  };
}
