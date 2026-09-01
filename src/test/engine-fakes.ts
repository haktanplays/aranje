/**
 * A typed stand-in for the engine's expressive layer (2V-B.1 §7).
 *
 * Three controller tests each grew their own object literal and each handed
 * it to the controller through `as unknown as Engine`. That cast is what let
 * `resumeAt` be added to `ExpressionRuntime` without a single one of them
 * failing to compile: a cast through `unknown` will accept anything, so the
 * fakes were free to fall silently behind the interface they were standing in
 * for, and a test suite that cannot notice a missing method is not testing the
 * seam it thinks it is.
 *
 * So the runtime part is built here and **annotated** as `ExpressionRuntime`.
 * The annotation is the point: the next method added to that type breaks this
 * file, once, instead of quietly turning three fakes into liars. The rest of
 * the engine — the transport, the metronome, the channels — is still faked at
 * each call site, because each of those tests needs a different transport.
 */
import { buildExpressionPlan, type ExpressionPlan } from "@/lib/audio/expression-plan";
import type { ExpressionRuntime } from "@/lib/audio/engine";
import { buildTempoMap, type TempoMap } from "@/lib/audio/tempo";
import type { PlaybackWindow } from "@/lib/playback/selection-playback";
import type { Song } from "@/lib/song/schema";

/** What the controller asked the expressive layer to do, in order. */
export type ExpressionLog = {
  stops: number;
  plans: number;
  disposals: number;
  /** Every `resumeAt`, with the arguments it was given. */
  resumes: {
    ticks: number;
    audioTime: number;
    window: PlaybackWindow | null | undefined;
  }[];
  /** Chains the scheduler asked for, by id. */
  chains: string[];
};

export type FakeExpression = ExpressionRuntime & { readonly log: ExpressionLog };

/**
 * An expressive layer with no audio in it that counts what it was asked.
 *
 * `resumeAt` records rather than pretends: it returns the number of voices
 * `activeVoicesAt` would have found, so a test can tell "the controller asked
 * for a resume" from "the resume had something to restore".
 */
export function fakeExpressionRuntime(song: Song): FakeExpression {
  let plan: ExpressionPlan = buildExpressionPlan(song);
  let tempo: TempoMap = buildTempoMap(song);
  const log: ExpressionLog = {
    stops: 0,
    plans: 0,
    disposals: 0,
    resumes: [],
    chains: [],
  };

  const runtime: ExpressionRuntime = {
    setPlan(next, nextTempo) {
      plan = next;
      tempo = nextTempo;
      log.plans += 1;
    },
    getPlan: () => plan,
    getTempoMap: () => tempo,
    play: () => false,
    playChain: (chain) => {
      log.chains.push(chain.chainId);
      return false;
    },
    resumeAt(ticks, audioTime, window) {
      log.resumes.push({ ticks, audioTime, window });
      return 0;
    },
    stopAll() {
      log.stops += 1;
    },
    counts: {
      active: 0,
      started: 0,
      disposed: 0,
      primary: 0,
      auxiliaryTransient: 0,
      resumed: 0,
    },
    fetchedUrls: 0,
    dispose() {
      log.disposals += 1;
    },
  };

  return Object.assign(runtime, { log });
}
