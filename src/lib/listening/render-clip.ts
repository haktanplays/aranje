/**
 * A listening clip, rendered through the production audio path (2W §4, §5).
 *
 * ## The one claim this file has to earn
 *
 * "The founder heard the real thing." Everything else in the listening pack
 * is presentation; this is the part that could quietly become a lie. So there
 * is no synthesis here, no oscillator, no second scheduler and no clip-only
 * timing. Every sound comes from four functions that playback itself calls:
 *
 * - `createEngine` — the instruments, the FX chain and the sample bank
 * - `scheduleSong` — the one traversal that turns a Song into events
 * - `setTrackAudibility` — how the app already silences a track
 * - `expression.resumeAt` — the continuation path a pause and a mid-note
 *   selection both use
 *
 * The only thing this module owns is *which window* and *how long*, and both
 * of those come from `clip-plan.ts`, which is pure and tested.
 *
 * ## Why offline
 *
 * `Tone.Offline` is the same renderer the WAV export runs on. Rendering means
 * the founder taps once and hears the clip immediately on every replay, that
 * the same build always produces the same clip, and — the reason it matters
 * most here — that the audio can be *measured* before it is offered. A page
 * that played live could not tell whether it had just played silence.
 *
 * ## The seam between segments
 *
 * A take with two segments is rendered twice and joined sample-to-sample. The
 * second segment opens with `continueSustained`, which is the production
 * continuation: whatever was ringing at that tick keeps ringing, from the
 * pitch and phase it had reached, with no new attack. That is precisely what
 * a pause and resume does to a held note, minus the human variable of when
 * the button was pressed — so the question "did it get struck again?" is
 * asked about the engine's answer rather than about someone's timing.
 */
import {
  createEngine,
  loadTone,
  scheduleSong,
  setTrackAudibility,
  type Engine,
} from "@/lib/audio/engine";
import { buildTempoMap } from "@/lib/audio/tempo";
import { audioExportLimits } from "@/lib/limits";
import { auditClip, type ClipAudit } from "@/lib/listening/clip-audit";
import { segmentSeconds, type ClipSegment, type ClipTake } from "@/lib/listening/clip-plan";
import type { Song } from "@/lib/song/schema";

type RenderedBuffer = {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  toArray(): Float32Array | Float32Array[];
};

export type OfflineRenderer = (
  build: (context: never) => Promise<void> | void,
  seconds: number,
  channels: number,
  sampleRate: number,
) => Promise<RenderedBuffer>;

export type RenderedTake = {
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
  readonly audit: ClipAudit;
  /** Voices still sounding after teardown, summed across segments. Must be 0. */
  readonly activeAfterDispose: number;
};

/**
 * The renderer, through the app's own Tone loader.
 *
 * Deliberately the same three-shape-aware `loadTone` the export uses: a bare
 * `import("tone")` resolves to a UMD bundle in a client build and hands back
 * a namespace with no `Offline` on it.
 */
async function toneOffline(): Promise<OfflineRenderer> {
  const tone = await loadTone();
  return (build, seconds, channels, sampleRate) =>
    tone.Offline(build as never, seconds, channels, sampleRate) as unknown as Promise<RenderedBuffer>;
}

type TransportLike = {
  ticks: number;
  start(at: number): void;
};

/** One segment, rendered exactly the way the app plays a selection. */
async function renderSegment(
  song: Song,
  segment: ClipSegment,
  offline: OfflineRenderer,
  practicePercent: number | undefined,
): Promise<{ channels: Float32Array[]; sampleRate: number; active: number }> {
  /*
   * One percent, two users. The tempo map places the notes and the engine
   * builds the plan; if they were given different rates the render would put
   * gestures where no note is. Defaulting to the written tempo keeps every
   * existing caller — the Listening Pack included — rendering exactly as it
   * did before this parameter existed.
   */
  const tempo =
    practicePercent === undefined ? buildTempoMap(song) : buildTempoMap(song, practicePercent);
  const seconds = segmentSeconds(segment, tempo);
  let built: Engine | null = null;

  const buffer = await offline(
    async (context) => {
      const engine = await createEngine(song, context, {
        ...(practicePercent === undefined ? {} : { practicePercent }),
      });
      built = engine;

      /* The window is the whole point: `scheduleSong` fires only the onsets
         inside it, on the tracks inside it. This is the same call the live
         selection audition makes. */
      scheduleSong(engine, tempo, {
        window: segment.window,
        metronomeEnabled: () => false,
      });
      setTrackAudibility(engine, segment.window.trackIds);

      const transport = (context as unknown as { transport: TransportLike }).transport;
      /* Start *at* the window, so the buffer opens on the first thing the
         founder is meant to hear rather than on however much silence sits
         between the song's start and the clip's. */
      transport.ticks = segment.window.startTicks;
      transport.start(0);

      if (segment.continueSustained) {
        /*
         * Whatever was already ringing, continued (2V-B.1 §6). The lower
         * bound is dropped and the track filter kept, exactly as
         * `resumeSustainedInto` does: a continuation from before the segment
         * is what is being asked for; one from another instrument is not.
         */
        engine.expression.resumeAt(segment.window.startTicks, 0, {
          startTicks: 0,
          endTicks: segment.window.endTicks,
          trackIds: segment.window.trackIds,
        });
      }
    },
    seconds,
    audioExportLimits.channels,
    audioExportLimits.sampleRate,
  );

  const raw = buffer.toArray();
  const planar = Array.isArray(raw) ? raw : [raw];
  const channels =
    planar.length >= audioExportLimits.channels
      ? planar.slice(0, audioExportLimits.channels)
      : [planar[0]!, planar[0]!];

  const engine = built as Engine | null;
  let active = 0;
  if (engine) {
    engine.expression.stopAll();
    engine.dispose();
    active = engine.expression.counts.active;
  }

  return { channels, sampleRate: buffer.sampleRate, active };
}

/** Join segments end to end. A pause of zero length is exactly a butt join. */
function concat(parts: readonly Float32Array[][]): Float32Array[] {
  const channelCount = parts[0]?.length ?? audioExportLimits.channels;
  const total = parts.reduce((sum, part) => sum + (part[0]?.length ?? 0), 0);
  const out: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    const merged = new Float32Array(total);
    let offset = 0;
    for (const part of parts) {
      const data = part[channel] ?? part[0];
      if (data) {
        merged.set(data, offset);
        offset += data.length;
      }
    }
    out.push(merged);
  }
  return out;
}

export async function renderTake(
  song: Song,
  take: ClipTake,
  options: {
    readonly offline?: OfflineRenderer;
    /**
     * Whole percent of the song's own tempo to render at (spec 13.8).
     *
     * Omitted, the clip sounds at its written tempo, which is what every
     * listening card wants. Given, the plan and the timeline are both built
     * at that rate — the practice speed is a property of the performance and
     * not of a playback knob, so a slowed render has to go through the
     * planner rather than around it.
     */
    readonly practicePercent?: number;
  } = {},
): Promise<RenderedTake> {
  const offline = options.offline ?? (await toneOffline());
  const parts: Float32Array[][] = [];
  let sampleRate: number = audioExportLimits.sampleRate;
  let activeAfterDispose = 0;

  for (const segment of take.segments) {
    const rendered = await renderSegment(song, segment, offline, options.practicePercent);
    parts.push(rendered.channels);
    sampleRate = rendered.sampleRate;
    activeAfterDispose += rendered.active;
  }

  const channels = parts.length === 1 ? parts[0]! : concat(parts);
  return {
    channels,
    sampleRate,
    audit: auditClip(channels, sampleRate),
    activeAfterDispose,
  };
}
