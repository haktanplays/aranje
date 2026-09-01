/**
 * One voice per note (spec 8.5, K-21).
 *
 * This exists for a single invariant, and everything about its shape follows
 * from it: **a note's vibrato, bend or slide must not move any other note.**
 * The obvious implementation — detuning the track's sampler — bends the whole
 * chord, which is not what a guitarist does and not what the tab says. So an
 * expressive note gets its own source, its own gain and, if it needs one, its
 * own filter, and the modulation is written on that source alone.
 *
 * Nothing new is downloaded for this. The decoded buffers are the same ones
 * the track's sampler plays from; the bank is built once and handed to both.
 *
 * The context is injected, as everywhere else in the engine. There is no
 * `Tone.Transport`, no `Tone.Destination`, no `.toDestination()` and no
 * `setTimeout` here: the caller passes the transport's own time in, and every
 * automation point is placed against it.
 */
import type * as Tone from "tone";

import type {
  ContinuationPlan,
  ContinuationVoice,
} from "@/lib/audio/active-voices";
import { expressionPresets } from "@/lib/audio/expression";
import type { ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import type { LegatoChain, LegatoTransition } from "@/lib/audio/legato-chain";
import { nearestSample, playbackRateFor, type SampleEntry } from "@/lib/audio/sample-map";
import { pitchToMidi } from "@/lib/music/pitch";

type ToneModule = typeof import("tone");

/** What a track offers a note: its samples and where to send the sound. */
export type VoiceHost = {
  buffers: Tone.ToneAudioBuffers;
  entries: readonly SampleEntry[];
  destination: Tone.InputNode;
  /**
   * The pack's level correction, as a linear factor.
   *
   * The sampler applies this as its own volume, and an expressive voice goes
   * around the sampler — so without it the same note would be quieter merely
   * for having a bend on it. This is an engine concern, exactly as the trim
   * is: the volumes written in the song are untouched (spec 7.1).
   */
  trimGain: number;
};

type Voice = {
  source: Tone.ToneBufferSource;
  gain: Tone.Gain;
  filter: Tone.Filter | null;
  /** The note has finished sounding. */
  ended: boolean;
  /** Its nodes have been freed. */
  disposed: boolean;
  /**
   * A struck note or chain, the short click of a pull-off, or the rest of a
   * sound that a pause interrupted (2V-B.1 §7).
   */
  kind: "primary" | "auxiliary" | "continuation";
};

export type VoicePoolCounts = {
  /** Voices alive right now. Must be 0 once everything has stopped. */
  active: number;
  /** Every voice ever started, so a leak shows up as a rising floor. */
  started: number;
  disposed: number;
  /** Sources **struck** to carry a note or a whole legato chain (spec 8.5, K-22). */
  primary: number;
  /** Short pull-off clicks. Counted apart so they are never mistaken for one. */
  auxiliaryTransient: number;
  /**
   * Voices put back after a pause (2V-B.1 §7).
   *
   * Its own number, and not folded into `primary`, because the claim the
   * round has to be able to make is "the hammer-on came back as one
   * continuing voice and gained no attack" — which is `resumed` up by one
   * with `auxiliaryTransient` unchanged. One counter cannot say that.
   */
  resumed: number;
};

/**
 * Holds the live voices and guarantees they all go away.
 *
 * A voice removes itself when its source ends; `stopAll` is the other way out,
 * used by pause, seek, a loop wrap, a speed change and dispose. Disposing the
 * same voice twice is safe, because those two paths can race.
 */
export class ExpressiveVoicePool {
  private readonly voices = new Set<Voice>();
  /**
   * Voices that have finished but whose nodes are still in the graph.
   *
   * This exists for the offline renderer. It walks the timeline first and
   * writes the audio afterwards, so a node freed the moment its note "ends"
   * is gone before the sound it made is rendered — and the result is silence.
   * Tone's own one-shot sources skip their auto-dispose offline for exactly
   * this reason. Freeing them is left to `stopAll`, which runs after.
   */
  private readonly spent = new Set<Voice>();
  private started = 0;
  private disposedCount = 0;
  private primaryCount = 0;
  private auxiliaryCount = 0;
  private resumedCount = 0;
  private closed = false;

  constructor(
    private readonly tone: ToneModule,
    private readonly context: Tone.BaseContext,
    private readonly hosts: ReadonlyMap<string, VoiceHost>,
  ) {}

  get counts(): VoicePoolCounts {
    return {
      active: this.voices.size,
      started: this.started,
      disposed: this.disposedCount,
      primary: this.primaryCount,
      auxiliaryTransient: this.auxiliaryCount,
      resumed: this.resumedCount,
    };
  }


  /**
   * Start one note at the transport time it was scheduled for.
   *
   * Returns false when the track has no samples to play it with, so the caller
   * can fall back rather than silently drop the note.
   */
  play(trackId: string, plan: ExpressiveNotePlan, time: number): boolean {
    if (this.closed) return false;

    const host = this.hosts.get(trackId);
    if (!host) return false;

    const targetMidi = pitchToMidi(plan.pitch);
    if (targetMidi === null) return false;

    const sample = nearestSample(host.entries, targetMidi);
    if (!sample || !host.buffers.has(sample.note)) return false;

    const baseRate = playbackRateFor(sample.midi, targetMidi);

    const level = host.trimGain;
    const gain = new this.tone.Gain({
      context: this.context,
      gain: (plan.gainEnvelope[0]?.value ?? plan.gain) * level,
    });
    gain.connect(host.destination);

    let filter: Tone.Filter | null = null;
    if (plan.filterPreset !== undefined) {
      /* Two presets, one node. A dead note is rolled off harder than a palm
         mute, because there is no note left in it to keep (2T-C §9). */
      const preset =
        plan.filterPreset === "dead"
          ? expressionPresets.dead
          : expressionPresets.palmMute;
      filter = new this.tone.Filter({
        context: this.context,
        type: "lowpass",
        frequency: preset.filterHz,
        Q: preset.filterQ,
      });
      filter.connect(gain);
    }

    const source = new this.tone.ToneBufferSource({
      context: this.context,
      url: host.buffers.get(sample.note),
      playbackRate: baseRate,
    });
    source.connect(filter ?? gain);

    const voice: Voice = {
      source,
      gain,
      filter,
      ended: false,
      disposed: false,
      kind: "primary",
    };

    // Pitch: written on this source's own rate, never on a shared node.
    plan.pitchAutomation.forEach((point, index) => {
      const rate = playbackRateFor(sample.midi, targetMidi, point.cents);
      const at = time + point.timeSeconds;
      if (index === 0 || point.curve === "step") {
        source.playbackRate.setValueAtTime(rate, at);
      } else {
        source.playbackRate.linearRampToValueAtTime(rate, at);
      }
    });

    plan.gainEnvelope.forEach((point, index) => {
      const at = time + point.timeSeconds;
      const value = point.value * level;
      if (index === 0) gain.gain.setValueAtTime(value, at);
      else gain.gain.linearRampToValueAtTime(value, at);
    });

    source.onended = () => this.finish(voice);
    source.start(time, 0, plan.durationSeconds);

    this.voices.add(voice);
    this.started += 1;
    this.primaryCount += 1;
    return true;
  }

  /**
   * Play a whole legato chain on **one** voice (spec 8.5, K-22).
   *
   * The source is struck once. Each transition moves that voice's own pitch to
   * the target and steps its level down; no second sample is started, because
   * a hammer-on is not a second attack. A pull-off may add one short, quiet,
   * filtered click, which is counted separately so it can never be mistaken
   * for the note itself.
   */
  playChain(chain: LegatoChain, time: number): boolean {
    if (this.closed) return false;

    const host = this.hosts.get(chain.trackId);
    if (!host) return false;

    const sourceMidi = pitchToMidi(chain.sourcePitch);
    if (sourceMidi === null) return false;

    const sample = nearestSample(host.entries, sourceMidi);
    if (!sample || !host.buffers.has(sample.note)) return false;

    const level = host.trimGain;
    const gain = new this.tone.Gain({
      context: this.context,
      gain: chain.gain * level,
    });
    gain.connect(host.destination);

    const source = new this.tone.ToneBufferSource({
      context: this.context,
      url: host.buffers.get(sample.note),
      playbackRate: playbackRateFor(sample.midi, sourceMidi),
    });
    source.connect(gain);

    const voice: Voice = {
      source,
      gain,
      filter: null,
      ended: false,
      disposed: false,
      kind: "primary",
    };

    source.playbackRate.setValueAtTime(
      playbackRateFor(sample.midi, sourceMidi),
      time,
    );
    gain.gain.setValueAtTime(chain.gain * level, time);

    let carried = 1;
    for (const transition of chain.transitions) {
      const at = time + transition.atSeconds;
      const settled = time + transition.arrivesAtSeconds;

      // The travel is planned, not improvised here: the pool replays exactly
      // the points the planner wrote, on this source and nothing else.
      for (const point of transition.points) {
        const rate = playbackRateFor(sample.midi, sourceMidi, point.cents);
        const when = time + point.timeSeconds;
        if (point.curve === "step") source.playbackRate.setValueAtTime(rate, when);
        else source.playbackRate.linearRampToValueAtTime(rate, when);
      }

      // Hold the level it had until the finger lands, then step down. The
      // value is tracked here rather than read back off the param: a param
      // reports where it is *now*, not where it will be at `at`.
      gain.gain.setValueAtTime(chain.gain * carried * level, at);
      carried *= transition.levelAfter;
      gain.gain.linearRampToValueAtTime(chain.gain * carried * level, settled);

      if (transition.auxiliary) {
        this.playAuxiliary(host, transition, settled, chain.gain);
      }
    }

    source.onended = () => this.finish(voice);
    source.start(time, 0, chain.endSeconds - chain.startSeconds);

    this.voices.add(voice);
    this.started += 1;
    this.primaryCount += 1;
    return true;
  }

  /** The click of a finger coming off the string. Never a note on its own. */
  private playAuxiliary(
    host: VoiceHost,
    transition: LegatoTransition,
    time: number,
    chainGain: number,
  ): void {
    const auxiliary = transition.auxiliary;
    if (!auxiliary) return;

    const targetMidi = pitchToMidi(transition.toPitch);
    if (targetMidi === null) return;

    const sample = nearestSample(host.entries, targetMidi);
    if (!sample || !host.buffers.has(sample.note)) return;

    const gain = new this.tone.Gain({
      context: this.context,
      gain: auxiliary.gain * chainGain * host.trimGain,
    });
    gain.connect(host.destination);

    const filter = new this.tone.Filter({
      context: this.context,
      type: "lowpass",
      frequency: auxiliary.filterHz,
      Q: 0.7,
    });
    filter.connect(gain);

    const source = new this.tone.ToneBufferSource({
      context: this.context,
      url: host.buffers.get(sample.note),
      playbackRate: playbackRateFor(sample.midi, targetMidi),
    });
    source.connect(filter);

    const voice: Voice = {
      source,
      gain,
      filter,
      ended: false,
      disposed: false,
      kind: "auxiliary",
    };

    source.onended = () => this.finish(voice);
    source.start(time, 0, auxiliary.durationSeconds);

    this.voices.add(voice);
    this.started += 1;
    this.auxiliaryCount += 1;
  }

  /**
   * Put back what a pause left in the air (2V-B.1 §7).
   *
   * The plan comes from `activeVoicesAt`, which has already worked out which
   * sounds were mid-flight and exactly where each one had got to. This turns
   * that into audio, and it does so **through this pool** — the same context,
   * the same decoded buffers, the same per-track destination. There is no
   * second synth and no preview engine here; a continuation that went through
   * its own graph would be a different instrument playing the second half of
   * the note.
   *
   * Two things it deliberately does not do:
   *
   * - It never starts the buffer at zero. The offset is where the sound had
   *   reached in its own sample, so what comes back is the tail of a note
   *   rather than a fresh pick attack on the same pitch.
   * - It never produces an auxiliary transient. A resumed hammer-on is one
   *   continuing voice; the click of the finger belongs to the moment the
   *   finger moved, which is behind the playhead.
   *
   * Returns how many voices actually came back, so a caller can report a
   * number it measured rather than the number it hoped for.
   */
  resume(plan: ContinuationPlan, time: number): number {
    if (this.closed) return 0;
    let restored = 0;
    for (const voice of plan.voices) {
      if (this.resumeOne(voice, time)) restored += 1;
    }
    return restored;
  }

  private resumeOne(continuation: ContinuationVoice, time: number): boolean {
    const host = this.hosts.get(continuation.trackId);
    if (!host) return false;

    const targetMidi = pitchToMidi(continuation.sourcePitch);
    if (targetMidi === null) return false;

    const sample = nearestSample(host.entries, targetMidi);
    if (!sample || !host.buffers.has(sample.note)) return false;

    const baseRate = playbackRateFor(sample.midi, targetMidi);
    /*
     * How far into the buffer the sound had got. Approximated at the base
     * rate rather than integrated over the pitch automation: a bend moves the
     * rate by a fraction of a percent over a note, and integrating it would
     * be arithmetic nobody can check against a number that matters. What
     * matters is that this is not zero.
     */
    const offset = continuation.elapsedSeconds * baseRate;
    const buffer = host.buffers.get(sample.note) as { duration?: number };
    const bufferSeconds =
      typeof buffer.duration === "number" ? buffer.duration : Number.POSITIVE_INFINITY;
    /* The sample ran out while the transport was stopped; there is no sound
       left to continue, and inventing one would be a note nobody played. */
    if (offset >= bufferSeconds) return false;
    if (continuation.remainingSeconds <= 0) return false;

    const level = host.trimGain;
    const gain = new this.tone.Gain({ context: this.context, gain: 0 });
    gain.connect(host.destination);

    let filter: Tone.Filter | null = null;
    if (continuation.filterPreset !== undefined) {
      const preset =
        continuation.filterPreset === "dead"
          ? expressionPresets.dead
          : expressionPresets.palmMute;
      filter = new this.tone.Filter({
        context: this.context,
        type: "lowpass",
        frequency: preset.filterHz,
        Q: preset.filterQ,
      });
      filter.connect(gain);
    }

    const source = new this.tone.ToneBufferSource({
      context: this.context,
      url: host.buffers.get(sample.note),
      playbackRate: playbackRateFor(sample.midi, targetMidi, continuation.currentCents),
    });
    source.connect(filter ?? gain);

    const voice: Voice = {
      source,
      gain,
      filter,
      ended: false,
      disposed: false,
      kind: "continuation",
    };

    /* The pitch it had, then the travel it had not finished. Point zero is
       the current value, written by `activeVoicesAt`, so a slide picks up
       from where the hand actually was. */
    continuation.pitchAutomation.forEach((point, index) => {
      const rate = playbackRateFor(sample.midi, targetMidi, point.cents);
      const at = time + point.timeSeconds;
      if (index === 0 || point.curve === "step") {
        source.playbackRate.setValueAtTime(rate, at);
      } else {
        source.playbackRate.linearRampToValueAtTime(rate, at);
      }
    });

    /*
     * The seam. A buffer opened mid-sample at full level clicks, so the level
     * is reached over a ramp far shorter than any attack in the pack. This is
     * a splice, not a shape: it says nothing about how the resume sounds, and
     * nothing in this repository has listened to it.
     */
    const fade = expressionPresets.resume.fadeSeconds;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(continuation.currentGain * level, time + fade);
    for (const point of continuation.gainEnvelope) {
      if (point.timeSeconds <= fade) continue;
      gain.gain.linearRampToValueAtTime(point.value * level, time + point.timeSeconds);
    }

    source.onended = () => this.finish(voice);
    source.start(time, offset, continuation.remainingSeconds);

    this.voices.add(voice);
    this.started += 1;
    this.resumedCount += 1;
    return true;
  }

  /** Everything currently sounding, gone. Safe to call when there is nothing. */
  stopAll(): void {
    for (const voice of [...this.voices]) {
      voice.ended = true;
      this.voices.delete(voice);
      voice.source.onended = () => {};
      this.free(voice);
    }
    for (const voice of [...this.spent]) {
      this.spent.delete(voice);
      this.free(voice);
    }
  }

  dispose(): void {
    this.closed = true;
    this.stopAll();
  }

  /** The note finished on its own. */
  private finish(voice: Voice): void {
    // Ending and stopping can both reach the same voice; the second one is a
    // no-op rather than a crash.
    if (voice.ended) return;
    voice.ended = true;
    this.voices.delete(voice);
    voice.source.onended = () => {};

    if (this.context.isOffline) {
      this.spent.add(voice);
      return;
    }
    this.free(voice);
  }

  /** Give the nodes back. Idempotent: the two ways out can race. */
  private free(voice: Voice): void {
    if (voice.disposed) return;
    voice.disposed = true;
    this.disposedCount += 1;

    try {
      voice.source.stop();
    } catch {
      // Already stopped, or never started. Nothing to undo.
    }
    voice.source.dispose();
    voice.filter?.dispose();
    voice.gain.dispose();
  }
}
