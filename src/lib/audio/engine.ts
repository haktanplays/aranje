/**
 * Tone.js signal graph and transport wiring (spec 8).
 *
 * The engine never touches Tone's module-level `Transport` or `Destination`
 * exports. Those are bound to whichever context existed when the module was
 * first imported, so under an offline render they point at the wrong graph and
 * nothing sounds. Everything here comes from a context that is handed in:
 * nodes are constructed with `{ context }`, the master gain lands on
 * `context.destination`, and events are placed on `context.transport`.
 *
 * Online and offline use the same code and the same scheduling core. The only
 * difference is which context is injected.
 *
 * Only the proven nodes are used: Sampler, MembraneSynth, NoiseSynth, Filter,
 * Channel, Gain, Limiter, Destination and Meter (spec 8.1).
 *
 * `Limiter` joined that list in 2T §10, and not for a tone: the master was a
 * unity gain wired straight at the destination, and a measured six-note chord
 * peaked at +5.15 dBFS with 1576 clipped samples. Clipping is a square edge
 * where a decaying string should be, which is what "firing a gun" sounds
 * like. See `master-bus.ts` for the measurements and for why the trim and the
 * ceiling are two stages rather than one.
 */
import type * as Tone from "tone";

import { MASTER_CEILING_DB, masterGain } from "@/lib/audio/master-bus";
import {
  audioPresetAvailability,
  silentTracks,
  type SilentTrack,
} from "@/lib/audio/preset-availability";
import { acquireBank, type BankHandle } from "@/lib/audio/buffer-bank";
import {
  buildExpressionPlan,
  type ExpressionPlan,
  type ExpressiveNotePlan,
} from "@/lib/audio/expression-plan";
import type { LegatoChain } from "@/lib/audio/legato-chain";
import {
  ExpressiveVoicePool,
  type VoiceHost,
  type VoicePoolCounts,
} from "@/lib/audio/expressive-voice";
import { metronomeClicks } from "@/lib/audio/position";
import { sampleEntries, type SampleEntry } from "@/lib/audio/sample-map";
import { buildSongPlan, ticks, type SongPlan } from "@/lib/audio/schedule";
import type { DrumPiece, Song, Track } from "@/lib/song/schema";
import type { TempoMap } from "@/lib/audio/tempo";

/**
 * Tone reaches for `window` as soon as it is imported, so it is pulled in on
 * demand rather than at module scope. That keeps this file importable during
 * the server render while the audio itself stays client-only (spec 8.3).
 */
type ToneModule = typeof import("tone");

let tonePromise: Promise<ToneModule> | null = null;

/**
 * Finds the real module behind the import.
 *
 * Tone's package.json points its `browser` field at a UMD bundle, so a client
 * build resolves the dynamic import to a file that publishes itself on the
 * global object and hands back an empty namespace. Other bundlers give the ESM
 * namespace directly, or wrap it under `default`. All three shapes are checked
 * rather than assumed, which also keeps the offline render and the app on the
 * same loader.
 */
function unwrapTone(loaded: unknown): ToneModule {
  const candidate = loaded as ToneModule & { default?: ToneModule };
  if (typeof candidate?.start === "function") return candidate;
  if (typeof candidate?.default?.start === "function") return candidate.default;

  const global = (globalThis as { Tone?: ToneModule }).Tone;
  if (typeof global?.start === "function") return global;

  const keys = Object.keys(candidate ?? {}).slice(0, 20).join(", ");
  throw new Error(
    `Tone.js yüklendi ama beklenen arayüzü sağlamıyor. Gelen anahtarlar: ${keys || "(bos namespace)"}`,
  );
}

export async function loadTone(): Promise<ToneModule> {
  tonePromise ??= import("tone").then(unwrapTone);
  return tonePromise;
}

/** Anything that can host the graph: a live context or an offline one. */
export type AudioRuntime = Tone.BaseContext;

export type DrumVoices = {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.NoiseSynth;
  cymbal: Tone.NoiseSynth;
  filters: Tone.Filter[];
};

/** Click voice for the metronome, on the same context as everything else. */
export type MetronomeVoice = { click: Tone.NoiseSynth; filter: Tone.Filter };

export type TrackVoice =
  | {
      kind: "sampler";
      trackId: string;
      /** Which pack this voice plays, so shared banks are counted once. */
      packId: string;
      sampler: Tone.Sampler;
      channel: Tone.Channel;
      bufferCount: number;
      /**
       * The decoded samples, held once **per pack and context**. The sampler
       * plays from this bank, so does every expressive voice, and so does any
       * other track on the same preset — a note with a bend costs no extra
       * download and no extra decode, and neither does a second guitar
       * (spec 8.5, 8.1, K-28).
       */
      buffers: Tone.ToneAudioBuffers;
      /** This voice's claim on the shared bank; released on dispose. */
      bank: BankHandle;
      entries: readonly SampleEntry[];
      /** The pack's level correction as a linear factor (spec 7.1). */
      trimGain: number;
    }
  | { kind: "drums"; trackId: string; drums: DrumVoices; channel: Tone.Channel };

/** The expressive layer of one engine (spec 8.5). */
export type ExpressionRuntime = {
  /** Replace the plan, for instance when the practice speed changes. */
  setPlan(plan: ExpressionPlan): void;
  getPlan(): ExpressionPlan;
  /** Start one note in a voice of its own. False when it cannot be played. */
  play(note: ExpressiveNotePlan, time: number): boolean;
  /** Start a whole legato chain on one voice (spec 8.5, K-22). */
  playChain(chain: LegatoChain, time: number): boolean;
  /** Every voice currently sounding, gone. */
  stopAll(): void;
  readonly counts: VoicePoolCounts;
  /** How many sample URLs this engine asked for, and how many it decoded. */
  readonly fetchedUrls: number;
  dispose(): void;
};

export type Engine = {
  context: AudioRuntime;
  /**
   * Tracks this graph has no sound for (2O-B.1 §2).
   *
   * Empty in every normal song. When it is not empty the engine has still
   * built successfully — the rest of the music plays — and it is the caller's
   * job to tell the reader which of their tracks will be silent.
   */
  silentTracks: readonly SilentTrack[];
  master: Tone.Gain;
  metronome: MetronomeVoice;
  voices: Map<string, TrackVoice>;
  meters: Map<string, Tone.Meter>;
  plan: SongPlan;
  expression: ExpressionRuntime;
  /** How many sample buffers this graph expects, and how many arrived. */
  expectedBuffers: number;
  loadedBuffers: number;
  dispose(): void;
};

export type CreateEngineOptions = {
  debug?: boolean;
  /** Whole percent of the song's own tempo the plan is built at (spec 13.8). */
  practicePercent?: number;
  /** Tracks to leave out of the graph entirely, for isolated renders. */
  excludeTrackIds?: readonly string[];
  /** Called as each sample pack finishes decoding. */
  onProgress?: (loadedBuffers: number, totalBuffers: number) => void;
};

/** A sample pack that could not be fetched or decoded. */
export class SampleLoadError extends Error {
  constructor(
    readonly packId: string,
    readonly reason: unknown,
  ) {
    super(`Ses paketi yüklenemedi: ${packId}`);
    this.name = "SampleLoadError";
  }
}

function buildMetronome(
  tone: ToneModule,
  context: AudioRuntime,
  destination: Tone.InputNode,
): MetronomeVoice {
  const filter = new tone.Filter({
    context,
    frequency: 2400,
    type: "highpass",
  });
  filter.connect(destination);
  const click = new tone.NoiseSynth({
    context,
    volume: -20,
    envelope: { attack: 0.001, decay: 0.02, sustain: 0 },
  });
  click.connect(filter);
  return { click, filter };
}

/** Kick, snare, hats and cymbals from the allowed synth nodes (spec 8.1). */
function buildDrums(
  tone: ToneModule,
  context: AudioRuntime,
  destination: Tone.InputNode,
): DrumVoices {
  const kick = new tone.MembraneSynth({
    context,
    volume: -5,
    pitchDecay: 0.04,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0 },
  });
  kick.connect(destination);

  const snareFilter = new tone.Filter({
    context,
    frequency: 1800,
    type: "highpass",
  });
  snareFilter.connect(destination);
  const snare = new tone.NoiseSynth({
    context,
    volume: -11,
    envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
  });
  snare.connect(snareFilter);

  const hatFilter = new tone.Filter({
    context,
    frequency: 7000,
    type: "highpass",
  });
  hatFilter.connect(destination);
  const hat = new tone.NoiseSynth({
    context,
    volume: -21,
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  });
  hat.connect(hatFilter);

  const cymbalFilter = new tone.Filter({
    context,
    frequency: 5200,
    type: "highpass",
  });
  cymbalFilter.connect(destination);
  const cymbal = new tone.NoiseSynth({
    context,
    volume: -19,
    envelope: { attack: 0.002, decay: 1.1, sustain: 0 },
  });
  cymbal.connect(cymbalFilter);

  return {
    kick,
    snare,
    hat,
    cymbal,
    filters: [snareFilter, hatFilter, cymbalFilter],
  };
}

/**
 * A track's graph, and how to finish it.
 *
 * Drums are ready immediately; a sampled track has to wait for its bank, so it
 * hands back a `build` to run once the samples are in.
 */
/** The branch of the availability answer that can actually build a voice. */
type PlayablePreset = Extract<
  ReturnType<typeof audioPresetAvailability>,
  { status: "available" }
>;

type VoiceBuild = {
  channel: Tone.Channel;
  /** The pack this voice will play, or null for the synthesised drum kit. */
  packId: string | null;
  bufferCount: number;
  build: () => TrackVoice;
  loaded: Promise<void>;
};

/**
 * Builds the graph for one track, plus a promise for its samples.
 *
 * The caller has already asked whether this preset can be heard at all, and
 * hands the answer in. That keeps one decision in one place: this function
 * does not get to reach a different conclusion about the same track, and a
 * track with no sound never arrives here.
 */
function buildVoice(
  tone: ToneModule,
  context: AudioRuntime,
  track: Track,
  master: Tone.Gain,
  availability: PlayablePreset,
): VoiceBuild {
  const channel = new tone.Channel({ context, volume: track.volumeDb });
  if (track.pan !== undefined) channel.pan.value = track.pan;
  /*
   * The contract's phase-0 `muted`/`soloed` flags are deliberately *not*
   * read here (2M-A §0). Until this checkpoint a song carrying `muted: true`
   * — from an old file, or hand-edited — silenced its track in the live
   * engine and would have silenced it in an export, with no control anywhere
   * in the product able to see or undo it. Audibility now has exactly one
   * owner: `setTrackAudibility`, fed by the session audition (13.18) or by
   * the export's explicit content choice. The fields stay in the schema and
   * still round-trip through a project file; they simply decide nothing.
   */
  channel.connect(master);

  if (availability.source === "synthesised") {
    const drums = buildDrums(tone, context, channel);
    return {
      channel,
      packId: null,
      bufferCount: 0,
      build: () => ({ kind: "drums", trackId: track.id, drums, channel }),
      // Synthesised, so there is nothing to download.
      loaded: Promise.resolve(),
    };
  }

  const pack = availability.pack;

  /*
   * One bank, every reader.
   *
   * Before phase 2F the Sampler fetched and decoded the pack itself; 2F gave
   * a track's Sampler and its expressive voices one shared bank. 2G finished
   * the job: the bank is now shared across *tracks* too, keyed by the pack
   * rather than by the track, so two guitars on the same preset decode the
   * same seven files once (spec 8.1, K-28).
   */
  const bank = acquireBank(tone, context, pack, () => {});
  const buffers = bank.buffers;
  const loaded = bank.loaded.catch((error) => {
    throw new SampleLoadError(pack.id, error);
  });

  const noteNames = Object.keys(pack.urls);

  return {
    channel,
    packId: pack.id,
    bufferCount: noteNames.length,
    // The sampler is built from the bank once the bank has decoded. Handing it
    // buffers that have not arrived yet would copy an empty one and never fill.
    build: () => {
      const sampler = new tone.Sampler({
        context,
        // Buffer objects, not URLs: nothing is requested a second time.
        urls: Object.fromEntries(noteNames.map((note) => [note, buffers.get(note)])),
        volume: pack.trimDb,
      });
      sampler.connect(channel);
      return {
        kind: "sampler",
        trackId: track.id,
        packId: pack.id,
        sampler,
        channel,
        bufferCount: noteNames.length,
        buffers,
        bank,
        entries: sampleEntries(noteNames),
        trimGain: Math.pow(10, pack.trimDb / 20),
      };
    },
    loaded,
  };
}

/**
 * Builds the graph on the given context and waits for every sample of every
 * sampler to decode. Nothing is scheduled here; the caller schedules once this
 * resolves.
 */
export async function createEngine(
  song: Song,
  context: AudioRuntime,
  options: CreateEngineOptions = {},
): Promise<Engine> {
  const excluded = new Set(options.excludeTrackIds ?? []);

  const tone = await loadTone();
  /*
   * Headroom, then a ceiling, then out. The trim is linear and changes no
   * timbre; the ceiling should be idle on ordinary material and is there for
   * the dense chord and the second guitar that were measured going over.
   */
  const master = new tone.Gain({ context, gain: masterGain() });
  const ceiling = new tone.Limiter({ context, threshold: MASTER_CEILING_DB });
  master.connect(ceiling);
  ceiling.connect(context.destination);
  const metronome = buildMetronome(tone, context, master);

  const voices = new Map<string, TrackVoice>();
  const meters = new Map<string, Tone.Meter>();
  const builds: { trackId: string; build: VoiceBuild }[] = [];

  for (const track of song.tracks) {
    if (excluded.has(track.id)) continue;
    const availability = audioPresetAvailability(track.instrumentId, track.presetId);
    // A preset with nothing behind it used to be skipped here without a word,
    // and every layer above reported success (2O-B.1 §1, §2). It is now a
    // fact the engine carries, so a caller can say so instead of the reader
    // discovering it by hearing nothing.
    if (availability.status === "unavailable") continue;
    const built = buildVoice(tone, context, track, master, availability);
    builds.push({ trackId: track.id, build: built });

    if (options.debug) {
      const meter = new tone.Meter({ context, smoothing: 0.6 });
      built.channel.connect(meter);
      meters.set(track.id, meter);
    }
  }

  /*
   * Counted per **pack**, not per track (spec 8.1, K-28).
   *
   * Two guitars on the same preset share one decoded bank, so counting each
   * track's files would promise the interface twice as many buffers as will
   * ever arrive — a progress bar that stops at half.
   */
  const packSizes = new Map<string, number>();
  for (const entry of builds) {
    if (entry.build.packId === null) continue;
    packSizes.set(entry.build.packId, entry.build.bufferCount);
  }
  const expectedBuffers = [...packSizes.values()].reduce((a, b) => a + b, 0);

  // Await these banks, not a global download registry. Progress is reported as
  // each pack lands so the interface can show something truthful.
  const landed = new Set<string>();
  let decoded = 0;
  options.onProgress?.(0, expectedBuffers);
  await Promise.all(
    builds.map((entry) =>
      entry.build.loaded.then(() => {
        const packId = entry.build.packId;
        if (packId === null || landed.has(packId)) return;
        landed.add(packId);
        decoded += packSizes.get(packId) ?? 0;
        options.onProgress?.(decoded, expectedBuffers);
      }),
    ),
  );

  // Every bank has decoded, so the samplers can be built from them.
  for (const entry of builds) {
    voices.set(entry.trackId, entry.build.build());
  }

  // Also per pack: two tracks sharing a bank loaded one bank, not two.
  const loadedPacks = new Map<string, number>();
  for (const voice of voices.values()) {
    if (voice.kind !== "sampler" || !voice.sampler.loaded) continue;
    loadedPacks.set(voice.packId, voice.bufferCount);
  }
  const loadedBuffers = [...loadedPacks.values()].reduce((a, b) => a + b, 0);

  const hosts = new Map<string, VoiceHost>();
  for (const voice of voices.values()) {
    if (voice.kind !== "sampler") continue;
    hosts.set(voice.trackId, {
      buffers: voice.buffers,
      entries: voice.entries,
      destination: voice.channel,
      trimGain: voice.trimGain,
    });
  }

  const pool = new ExpressiveVoicePool(tone, context, hosts);
  let expressionPlan = buildExpressionPlan(song, {
    ...(options.practicePercent === undefined
      ? {}
      : { practicePercent: options.practicePercent }),
  });

  const expression: ExpressionRuntime = {
    setPlan(next) {
      expressionPlan = next;
      // The old automation belongs to the old timing; it does not carry over.
      pool.stopAll();
    },
    getPlan: () => expressionPlan,
    play: (note, time) => pool.play(note.trackId, note, time),
    playChain: (chain, time) => pool.playChain(chain, time),
    stopAll: () => pool.stopAll(),
    get counts() {
      return pool.counts;
    },
    get fetchedUrls() {
      return expectedBuffers;
    },
    dispose: () => pool.dispose(),
  };

  return {
    context,
    // Only among the tracks this graph was asked to carry: a track left out
    // on purpose is a choice, not a gap to warn anybody about.
    silentTracks: silentTracks(song).filter((track) => !excluded.has(track.trackId)),
    master,
    metronome,
    voices,
    meters,
    plan: buildSongPlan(song),
    expression,
    expectedBuffers,
    loadedBuffers,
    dispose() {
      pool.dispose();
      for (const voice of voices.values()) {
        if (voice.kind === "sampler") {
          voice.sampler.dispose();
          // The bank may be another track's too, so it is released rather
          // than disposed; the last consumer out turns the lights off.
          voice.bank.release();
        } else {
          voice.drums.kick.dispose();
          voice.drums.snare.dispose();
          voice.drums.hat.dispose();
          voice.drums.cymbal.dispose();
          for (const filter of voice.drums.filters) filter.dispose();
        }
        voice.channel.dispose();
      }
      for (const meter of meters.values()) meter.dispose();
      metronome.click.dispose();
      metronome.filter.dispose();
      master.dispose();
      ceiling.dispose();
    },
  };
}

/**
 * Starts the audio context from a user gesture and builds the engine on it.
 * This is the only entry point the interface should use.
 */
export async function createLiveEngine(
  song: Song,
  options: CreateEngineOptions = {},
): Promise<Engine> {
  const tone = await loadTone();
  // Spec 8.3: the context may only be started inside a user gesture.
  await tone.start();
  return createEngine(song, tone.getContext(), options);
}

export type ScheduleOptions = {
  /**
   * Read at click time rather than baked in, so the metronome can be toggled
   * without rescheduling the music.
   */
  metronomeEnabled?: () => boolean;
  /** Fired on the drawing clock when the transport reaches the last bar line. */
  onEnded?: () => void;
};

/**
 * Places every event of the plan on the engine's own transport. Times are
 * ticks derived from note values, so a tempo change rescales them for free.
 *
 * This runs once per engine. Play and pause never reschedule.
 */
/**
 * Write a song's tempo timeline onto a transport (spec 8.3, K-25).
 *
 * Every event is placed in **ticks**, and Tone's transport derives its own
 * tick-to-time mapping from this automation, so a step change here moves all
 * the later events without any of them being rewritten. That is the whole
 * reason the scheduler was built in ticks in the first place.
 *
 * The first segment is a plain value, so the transport is already at the
 * right tempo before it runs; the rest are scheduled at the second their
 * section begins. Previous automation is cancelled first, because this is
 * also what a practice-rate change calls — and a rate change must replace
 * the curve, not layer a second one on top of it.
 */
export function applyTempoMap(
  transport: Tone.BaseContext["transport"],
  tempo: TempoMap,
): void {
  transport.bpm.cancelScheduledValues(0);
  const first = tempo.segments[0];
  if (first) transport.bpm.value = first.bpm;
  for (const segment of tempo.segments.slice(1)) {
    transport.bpm.setValueAtTime(segment.bpm, segment.startSeconds);
  }
}

export function scheduleSong(
  engine: Engine,
  tempo: TempoMap,
  options: ScheduleOptions = {},
): number {
  const transport = engine.context.transport;
  transport.cancel();
  transport.PPQ = 192;

  // Tempo is set before anything is scheduled (spec 8.3).
  applyTempoMap(transport, tempo);

  /*
   * Notes come from the expression plan and drums from the song plan. Both are
   * built from the same timeline, so the note set is the same either way; what
   * the expression plan adds is what each note should *do*. Scheduling notes
   * from it is what makes online and offline share one path (spec 8.5).
   */
  const plan = engine.expression.getPlan();

  /*
   * A legato chain is one voice, so it is scheduled once, at the note that is
   * actually struck. Its targets are still notes of the song and still in the
   * plan; they are simply not struck again (spec 8.5, K-22).
   */
  for (const chain of plan.chains) {
    const voice = engine.voices.get(chain.trackId);
    if (!voice || voice.kind !== "sampler") continue;
    const chainId = chain.chainId;

    transport.schedule((time) => {
      const current = engine.expression
        .getPlan()
        .chains.find((entry) => entry.chainId === chainId);
      if (current) engine.expression.playChain(current, time);
    }, ticks(chain.startTicks));
  }

  for (const note of plan.notes) {
    // The chain plays this one.
    if (note.chainId !== undefined) continue;

    const voice = engine.voices.get(note.trackId);
    if (!voice || voice.kind !== "sampler") continue;

    const { sampler } = voice;
    const duration = ticks(note.durationTicks);
    const noteId = note.id;

    transport.schedule((time) => {
      // Read at trigger time, so a speed change reaches notes that have not
      // sounded yet without rebuilding anything.
      const currentPlan = engine.expression.getPlan();
      const current =
        currentPlan.notes.find((entry) => entry.id === noteId) ?? note;

      // A speed change can rebuild the plan; if this note has since joined a
      // chain, the chain owns it.
      if (current.chainId !== undefined) return;

      if (current.expressive) {
        const played = engine.expression.play(current, time);
        if (played) return;
      }
      sampler.triggerAttackRelease(current.pitch, duration, time, current.gain);
    }, ticks(note.timeTicks));
  }

  for (const event of engine.plan.events) {
    if (event.kind !== "drum") continue;
    const voice = engine.voices.get(event.trackId);
    if (!voice || voice.kind !== "drums") continue;

    const { drums } = voice;
    transport.schedule((time) => {
      playDrum(drums, event.piece, time, event.gain);
    }, ticks(event.time));
  }

  // The metronome sits on the same transport and the same context as the
  // music, so it cannot drift away from it.
  const { click } = engine.metronome;
  for (const beat of metronomeClicks(engine.plan)) {
    transport.schedule((time) => {
      if (!options.metronomeEnabled?.()) return;
      click.triggerAttackRelease(0.02, time, beat.downbeat ? 1 : 0.55);
    }, ticks(beat.time));
  }

  if (options.onEnded) {
    const notify = options.onEnded;
    transport.schedule((time) => {
      // Drawn on the visual clock, so the state flips when the listener hears
      // the end rather than at the scheduler's look-ahead.
      engine.context.draw.schedule(() => notify(), time);
    }, ticks(engine.plan.totalTicks));
  }

  return engine.plan.totalTicks;
}

/** Maps a drum piece onto the synthesised voices. */
/**
 * Write one track's persisted mix onto the graph that is already playing
 * (spec 13.18, 2L-C §7).
 *
 * The whole point is what it does *not* do: no engine is built, no event is
 * rescheduled, no sample is fetched or decoded, and the transport does not
 * move. It sets two parameters on the channel this track already owns.
 *
 * Because every one of a track's sources — the sampler, the drum voices and
 * every expressive/legato voice — is connected to that same channel, one
 * write reaches all of them, and a voice that starts a moment later arrives
 * at the level already set. Nothing here can reach another track's channel.
 */
export function setTrackMix(
  engine: Engine,
  trackId: string,
  volumeDb: number,
  pan: number,
): boolean {
  const voice = engine.voices.get(trackId);
  if (!voice) return false;
  voice.channel.volume.value = volumeDb;
  voice.channel.pan.value = pan;
  return true;
}

/**
 * Who is heard, as the session's audition decided (spec 13.18, §5, §7).
 *
 * Audibility is a mute on each track's own channel, never a level: a track
 * put back on comes back to the volume it had, because that volume was never
 * touched. The metronome is not in `voices` — it hangs off the master — so
 * no combination of mutes and solos can silence it.
 */
export function setTrackAudibility(
  engine: Engine,
  audibleTrackIds: readonly string[],
): void {
  const audible = new Set(audibleTrackIds);
  for (const [trackId, voice] of engine.voices) {
    voice.channel.mute = !audible.has(trackId);
  }
}

export function playDrum(
  drums: DrumVoices,
  piece: DrumPiece,
  time: number,
  gain: number,
) {
  switch (piece) {
    case "kick":
      drums.kick.triggerAttackRelease("C1", 0.08, time, gain);
      return;
    case "snare":
      drums.snare.triggerAttackRelease(0.12, time, gain);
      return;
    case "closed_hat":
      drums.hat.triggerAttackRelease(0.03, time, gain);
      return;
    case "open_hat":
      drums.hat.triggerAttackRelease(0.18, time, gain * 0.9);
      return;
    case "crash":
    case "china":
    case "ride":
      drums.cymbal.triggerAttackRelease(0.9, time, gain);
      return;
    default:
      // Toms use the membrane voice at different pitches.
      drums.kick.triggerAttackRelease(
        piece === "tom_high" ? "G2" : piece === "tom_mid" ? "D2" : "A1",
        0.2,
        time,
        gain,
      );
  }
}
