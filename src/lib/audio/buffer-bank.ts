/**
 * One decoded copy of each sample pack, per audio context (spec 8.1, K-28).
 *
 * Phase 2F made a track's Sampler and its expressive voices share one decoded
 * bank, which stopped the *same track* fetching everything twice. The S-01
 * rehearsal showed the other half was still there: two guitars on the same
 * high-gain preset made two banks and decoded the identical seven files
 * twice — 22 requests for 15 distinct URLs in the full mix. HTTP caching
 * hides the second fetch; it does not hide the second decode, and decoded
 * audio is the expensive thing to hold on a phone.
 *
 * So the cache is keyed by **pack**, not by track. Two tracks that sound the
 * same share the recordings, which is what "they sound the same" means.
 *
 * ## Why reference counting
 *
 * A bank now outlives the track that asked for it first. Disposing it when
 * any one consumer goes away would silence whoever else was still playing
 * from it, so each consumer takes a handle and releases it, and the last
 * release disposes. That is not premature generality: preview and playback
 * engines exist at the same time and share nothing else.
 *
 * ## Why per context
 *
 * A `ToneAudioBuffer` belongs to the context that decoded it. An offline
 * render and the live engine must never hand each other buffers, so the
 * cache is a `WeakMap` on the context: separate contexts get separate banks,
 * and a context that goes away takes its entry with it.
 */
import type * as Tone from "tone";

import type { SamplePack } from "@/lib/audio/packs";
/** The Tone namespace, passed in so this module loads nothing itself. */
type ToneModule = typeof import("tone");

export type BankHandle = {
  /** The shared, decoded recordings. Never dispose these directly. */
  buffers: Tone.ToneAudioBuffers;
  /** Resolves when every file of the pack has decoded. */
  loaded: Promise<void>;
  bufferCount: number;
  /** How many consumers hold this bank right now, for diagnostics and tests. */
  consumers(): number;
  /** Give it back. The last one out disposes the bank. */
  release(): void;
};

type Entry = {
  buffers: Tone.ToneAudioBuffers;
  loaded: Promise<void>;
  bufferCount: number;
  refs: number;
};

/** Per context, per pack id. */
const CACHE = new WeakMap<object, Map<string, Entry>>();

function packsFor(context: object): Map<string, Entry> {
  const existing = CACHE.get(context);
  if (existing) return existing;
  const fresh = new Map<string, Entry>();
  CACHE.set(context, fresh);
  return fresh;
}

/**
 * Take a handle on this pack's decoded bank, making it if nobody has yet.
 *
 * `onError` is only called for a bank this call actually created; a caller
 * joining an existing one learns about failure through `loaded` rejecting.
 */
export function acquireBank(
  tone: ToneModule,
  context: Tone.BaseContext,
  pack: SamplePack,
  onError: (error: unknown) => void,
): BankHandle {
  const packs = packsFor(context as unknown as object);
  let entry = packs.get(pack.id);

  if (!entry) {
    let settle: () => void = () => {};
    let fail: (error: unknown) => void = () => {};
    const loaded = new Promise<void>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

    const buffers = new tone.ToneAudioBuffers({
      urls: pack.urls,
      baseUrl: pack.baseUrl,
      onload: () => settle(),
      onerror: (error: unknown) => {
        fail(error);
        onError(error);
      },
    });

    entry = {
      buffers,
      loaded,
      bufferCount: Object.keys(pack.urls).length,
      refs: 0,
    };
    packs.set(pack.id, entry);
  }

  const held = entry;
  held.refs += 1;
  let released = false;

  return {
    buffers: held.buffers,
    loaded: held.loaded,
    bufferCount: held.bufferCount,
    consumers: () => held.refs,
    release() {
      // Releasing twice must not take someone else's reference with it.
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs > 0) return;
      packs.delete(pack.id);
      held.buffers.dispose();
    },
  };
}

/** How many packs this context currently holds. Tests and diagnostics only. */
export function banksHeld(context: Tone.BaseContext): number {
  return packsFor(context as unknown as object).size;
}
