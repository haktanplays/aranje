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

import { expressionPresets } from "@/lib/audio/expression";
import type { ExpressiveNotePlan } from "@/lib/audio/expression-plan";
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
};

export type VoicePoolCounts = {
  /** Voices alive right now. Must be 0 once everything has stopped. */
  active: number;
  /** Every voice ever started, so a leak shows up as a rising floor. */
  started: number;
  disposed: number;
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
    if (plan.filterPreset === "palm_mute") {
      filter = new this.tone.Filter({
        context: this.context,
        type: "lowpass",
        frequency: expressionPresets.palmMute.filterHz,
        Q: expressionPresets.palmMute.filterQ,
      });
      filter.connect(gain);
    }

    const source = new this.tone.ToneBufferSource({
      context: this.context,
      url: host.buffers.get(sample.note),
      playbackRate: baseRate,
    });
    source.connect(filter ?? gain);

    const voice: Voice = { source, gain, filter, ended: false, disposed: false };

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
