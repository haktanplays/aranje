/**
 * The song, rendered offline into sample data (spec 13.19, 2M-A §6).
 *
 * The only impure module in `lib/export`, and it is impure for exactly one
 * reason: it needs an audio context. Everything musical is borrowed —
 * `createEngine`, `scheduleSong`, the expression planner and the shared
 * sample bank are the same ones playback uses. There is no second note path,
 * no second articulation timing and no export-only scheduler, which is what
 * makes "the WAV sounds like the app" a structural fact rather than a hope.
 *
 * The one thing this module decides is *audibility*, and only because the
 * user was asked: `audibleTrackIds` is passed in when they chose "Şu anda
 * duyduklarım", and omitted entirely when they chose "Tüm track'ler". The
 * phase-0 `muted`/`soloed` contract flags are never consulted (§0).
 */
import {
  createEngine,
  scheduleSong,
  setTrackAudibility,
  type Engine,
} from "@/lib/audio/engine";
import { buildTempoMap } from "@/lib/audio/tempo";
import { audioExportLimits } from "@/lib/limits";
import { renderDuration, type RenderDuration } from "@/lib/export/export-plan";
import type { Song } from "@/lib/song/schema";

/** What `Tone.Offline` hands back, narrowed to what this module reads. */
type RenderedBuffer = {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  toArray(): Float32Array | Float32Array[];
};

type OfflineRenderer = (
  build: (context: never) => Promise<void> | void,
  seconds: number,
  channels: number,
  sampleRate: number,
) => Promise<RenderedBuffer>;

export type RenderedSong = {
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
  readonly frames: number;
  readonly duration: RenderDuration;
  /** How many voices were still sounding after teardown; must be zero. */
  readonly activeAfterDispose: number;
};

export type RenderOptions = {
  /**
   * Who to render. Omit for "every track", which is the default and which
   * ignores the session audition completely.
   *
   * Passing this is how "Şu anda duyduklarım" is expressed: the caller has
   * already asked the user, and the list is the answer.
   */
  readonly audibleTrackIds?: readonly string[];
  /** Injected for tests; the real one is `Tone.Offline`. */
  readonly offline?: OfflineRenderer;
};

async function toneOffline(): Promise<OfflineRenderer> {
  const Tone = await import("tone");
  return (build, seconds, channels, sampleRate) =>
    Tone.Offline(build as never, seconds, channels, sampleRate) as unknown as Promise<RenderedBuffer>;
}

/**
 * Render the whole song to stereo sample data.
 *
 * Always at the song's own tempo: `scheduleSong` is given no practice
 * percent, so the file runs at what the piece is written at rather than at
 * whatever speed someone happened to be rehearsing it.
 *
 * The engine is kept until after the buffer resolves and only then torn
 * down. Disposing inside the render callback would silence samplers that
 * still had events to fire — and would prove nothing about teardown, because
 * the transport would never have reached them.
 */
export async function renderSongToBuffer(
  song: Song,
  options: RenderOptions = {},
): Promise<RenderedSong> {
  const duration = renderDuration(song);
  const offline = options.offline ?? (await toneOffline());

  let built: Engine | null = null;

  const buffer = await offline(
    async (context) => {
      const engine = await createEngine(song, context);
      built = engine;

      scheduleSong(engine, buildTempoMap(song), {
        // The metronome is a rehearsal click, never part of the record.
        metronomeEnabled: () => false,
      });

      if (options.audibleTrackIds !== undefined) {
        setTrackAudibility(engine, options.audibleTrackIds);
      }

      (context as { transport: { start(at: number): void } }).transport.start(0);
    },
    duration.totalSeconds,
    audioExportLimits.channels,
    audioExportLimits.sampleRate,
  );

  const raw = buffer.toArray();
  const planar = Array.isArray(raw) ? raw : [raw];
  // A mono context would be a bug upstream, but a file that claims stereo and
  // carries one channel is worse than one that duplicates honestly.
  const channels =
    planar.length >= audioExportLimits.channels
      ? planar.slice(0, audioExportLimits.channels)
      : [planar[0]!, planar[0]!];

  const engine = built as Engine | null;
  let activeAfterDispose = -1;
  if (engine) {
    engine.expression.stopAll();
    engine.dispose();
    activeAfterDispose = engine.expression.counts.active;
  }

  return {
    channels,
    sampleRate: buffer.sampleRate,
    frames: channels[0]?.length ?? 0,
    duration,
    activeAfterDispose,
  };
}
