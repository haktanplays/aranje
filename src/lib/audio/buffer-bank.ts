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
 * So the cache is keyed by the **decoded asset set**, not by track and not by
 * preset name: `SamplePack.bankKey` names where the files are and which files
 * they are. Two tracks that sound the same share the recordings, which is
 * what "they sound the same" means, and two presets can never collide however
 * they are named.
 *
 * ## Why reference counting
 *
 * A bank now outlives the track that asked for it first. Disposing it when
 * any one consumer goes away would silence whoever else was still playing
 * from it, so each consumer takes a handle and releases it, and the last
 * release disposes. That is not premature generality: preview and playback
 * engines exist at the same time and share nothing else.
 *
 * ## Why retention
 *
 * Refcounting alone was not enough for the chord builder (2O-B.1 §3). An
 * audition builds a whole engine, plays one chord and throws the engine
 * away, so the count reached zero *between* auditions and the next one
 * decoded the same seven files again: twenty-five auditions of one preset
 * measured 168 sample requests. A decoded bank is immutable and expensive,
 * and the session that is doing the auditioning has not gone anywhere. So a
 * session may open **retention** on a context: when the last consumer
 * releases, the bank is handed to the retention instead of being disposed,
 * and it is disposed when the retention itself is — not once per audition.
 *
 * Retention is opened by an owner and closed by that owner. Nothing opens it
 * implicitly, and an offline render never does, so an export still tears its
 * banks down with its context.
 *
 * ## Why per context
 *
 * A `ToneAudioBuffer` belongs to the context that decoded it. An offline
 * render and the live engine must never hand each other buffers, so the
 * cache is a `WeakMap` on the context: separate contexts get separate banks,
 * and a context that goes away takes its entry with it. The context is
 * deliberately *not* folded into the key string — an identity cannot be
 * spelled wrong, and a string can.
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
  /** Give it back. The last one out disposes the bank, unless it is retained. */
  release(): void;
};

/** What a loader hands back: the buffers, and a promise for their arrival. */
export type LoadedBank = {
  buffers: Tone.ToneAudioBuffers;
  loaded: Promise<void>;
  bufferCount: number;
};

type Entry = LoadedBank & { refs: number };

type Retention = {
  held: Map<string, BankHandle>;
  disposed: boolean;
};

type ContextState = {
  banks: Map<string, Entry>;
  retention: Retention | null;
};

const CACHE = new WeakMap<object, ContextState>();

function stateFor(context: Tone.BaseContext): ContextState {
  const key = context as unknown as object;
  const existing = CACHE.get(key);
  if (existing) return existing;
  const fresh: ContextState = { banks: new Map(), retention: null };
  CACHE.set(key, fresh);
  return fresh;
}

function handleFor(state: ContextState, bankKey: string, entry: Entry): BankHandle {
  entry.refs += 1;
  let released = false;
  return {
    buffers: entry.buffers,
    loaded: entry.loaded,
    bufferCount: entry.bufferCount,
    consumers: () => entry.refs,
    release() {
      // Releasing twice must not take someone else's reference with it.
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;

      // A bank that failed to load has already been evicted; there is
      // nothing worth keeping and nothing that would ever be asked for
      // again under this key.
      if (state.banks.get(bankKey) === entry) {
        const retention = state.retention;
        if (retention && !retention.disposed) {
          // The last consumer is going; the session is not. Retention takes
          // a real handle, so the count reflects who is actually holding on.
          retention.held.set(bankKey, handleFor(state, bankKey, entry));
          return;
        }
        state.banks.delete(bankKey);
      }
      entry.buffers.dispose();
    },
  };
}

/**
 * The bank for this asset set on this context, loading it if nobody has yet.
 *
 * `load` is called **only** when there is nothing to share, so two callers
 * asking at the same moment produce one fetch, one decode and one promise.
 * A load that fails is evicted rather than remembered: a cached rejection
 * would turn one bad network moment into a preset that can never be played
 * again for the rest of the session, so the next real attempt starts a real
 * load.
 */
export function getOrLoad(
  context: Tone.BaseContext,
  bankKey: string,
  load: () => LoadedBank,
): BankHandle {
  const state = stateFor(context);
  const existing = state.banks.get(bankKey);
  if (existing) return handleFor(state, bankKey, existing);

  const entry: Entry = { ...load(), refs: 0 };
  state.banks.set(bankKey, entry);
  entry.loaded.catch(() => {
    // Guarded on identity: a retry that has already replaced this entry must
    // not be evicted by the failure of the one it replaced.
    if (state.banks.get(bankKey) === entry) state.banks.delete(bankKey);
  });
  return handleFor(state, bankKey, entry);
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
  return getOrLoad(context, pack.bankKey, () => {
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
    return { buffers, loaded, bufferCount: Object.keys(pack.urls).length };
  });
}

/** Keeps decoded banks alive across the engines that come and go on one context. */
export type BankRetention = {
  /** How many banks it is currently holding on nobody else's behalf. */
  retained(): number;
  /** Let them all go. The banks are disposed unless somebody else still holds one. */
  dispose(): void;
};

/**
 * Open retention on this context, so a bank outlives the engine that loaded it.
 *
 * Opening twice returns the retention already open: a context has one, and
 * whoever opened it owns it.
 */
export function openBankRetention(context: Tone.BaseContext): BankRetention {
  const state = stateFor(context);
  const retention: Retention = state.retention ?? { held: new Map(), disposed: false };
  state.retention = retention;
  return {
    retained: () => retention.held.size,
    dispose() {
      if (retention.disposed) return;
      retention.disposed = true;
      const held = [...retention.held.values()];
      retention.held.clear();
      // Marked disposed first, so each release falls through to the real
      // teardown instead of handing the bank straight back to us.
      for (const handle of held) handle.release();
      if (state.retention === retention) state.retention = null;
    },
  };
}

/** How many packs this context currently holds. Tests and diagnostics only. */
export function banksHeld(context: Tone.BaseContext): number {
  return stateFor(context).banks.size;
}
