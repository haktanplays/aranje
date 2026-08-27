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
export function deviceStorageSnapshot(): string {
  if (typeof window === "undefined") return "";
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null) keys.push(key);
    }
    keys.sort();
    return JSON.stringify(keys.map((key) => [key, store.getItem(key)]));
  } catch {
    // A browser that refuses storage cannot have had it changed either.
    return "unavailable";
  }
}
