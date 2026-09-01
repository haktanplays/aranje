/**
 * What the device's own store holds, as one comparable string.
 *
 * The guided Android test has to be able to prove it changed nothing, and the
 * only honest proof is the bytes before and the bytes after. That reading has
 * to come from the *device's* store rather than the fixture's — the fixture is
 * expected to change, that is what editing does — so it is the one place in
 * this feature that reaches for the real thing.
 *
 * It lives here rather than in the watching component because no component
 * owns storage (spec 13.21 §8): a screen that reads a key is a screen that can
 * be given a second, quieter way to write one.
 */
import { STORAGE_PREFIX } from "@/lib/song/storage";

function snapshotWhere(include: (key: string) => boolean): string {
  if (typeof window === "undefined") return "";
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null && include(key)) keys.push(key);
    }
    keys.sort();
    return JSON.stringify(keys.map((key) => [key, store.getItem(key)]));
  } catch {
    // A browser that refuses storage cannot have had it changed either.
    return "unavailable";
  }
}

export function deviceStorageSnapshot(): string {
  return snapshotWhere(() => true);
}

/** Production Aranjé bytes only; browser or unrelated app keys are excluded. */
export function deviceProjectSnapshot(): string {
  return snapshotWhere((key) => key.startsWith(STORAGE_PREFIX));
}

/** Stable comparison hash. The bytes remain the authority; this is report-sized. */
export function storageHash(bytes: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `b${bytes.length}h${hash.toString(36)}`;
}

export type DeviceStorageWatch = {
  readonly available: boolean;
  readonly initialBytes: string;
  readonly initialHash: string;
  writes(): number;
  finish(): {
    readonly initialBytes: string;
    readonly finalBytes: string;
    readonly initialHash: string;
    readonly finalHash: string;
    readonly writes: number;
    readonly unchanged: boolean;
  };
};

/**
 * Count same-document writes to production storage during one acceptance run.
 *
 * A before/after diff alone misses a write that restores the old value. The
 * watcher therefore observes the browser Storage methods, but counts only
 * calls made on this window's `localStorage` and only Aranjé keys. The
 * original methods are restored by `finish`, even when the run fails.
 */
export function watchDeviceProjectStorage(): DeviceStorageWatch {
  const initialBytes = deviceProjectSnapshot();
  const initialHash = storageHash(initialBytes);
  if (typeof window === "undefined" || initialBytes === "unavailable") {
    return {
      available: false,
      initialBytes,
      initialHash,
      writes: () => 0,
      finish: () => ({
        initialBytes,
        finalBytes: deviceProjectSnapshot(),
        initialHash,
        finalHash: storageHash(deviceProjectSnapshot()),
        writes: 0,
        unchanged: initialBytes === deviceProjectSnapshot(),
      }),
    };
  }

  const store = window.localStorage;
  const prototype = window.Storage.prototype;
  const setItem = prototype.setItem;
  const removeItem = prototype.removeItem;
  const clear = prototype.clear;
  let count = 0;
  let closed = false;

  prototype.setItem = function watchedSetItem(key: string, value: string) {
    if (this === store && key.startsWith(STORAGE_PREFIX)) count += 1;
    return Reflect.apply(setItem, this, [key, value]);
  };
  prototype.removeItem = function watchedRemoveItem(key: string) {
    if (this === store && key.startsWith(STORAGE_PREFIX)) count += 1;
    return Reflect.apply(removeItem, this, [key]);
  };
  prototype.clear = function watchedClear() {
    if (this === store) {
      for (let index = 0; index < store.length; index += 1) {
        if (store.key(index)?.startsWith(STORAGE_PREFIX)) count += 1;
      }
    }
    return Reflect.apply(clear, this, []);
  };

  const finish = () => {
    if (!closed) {
      prototype.setItem = setItem;
      prototype.removeItem = removeItem;
      prototype.clear = clear;
      closed = true;
    }
    const finalBytes = deviceProjectSnapshot();
    return {
      initialBytes,
      finalBytes,
      initialHash,
      finalHash: storageHash(finalBytes),
      writes: count,
      unchanged: initialBytes === finalBytes,
    };
  };

  return {
    available: true,
    initialBytes,
    initialHash,
    writes: () => count,
    finish,
  };
}
