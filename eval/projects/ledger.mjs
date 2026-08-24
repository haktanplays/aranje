/**
 * The physical storage ledger, installed before the app's first line
 * (spec 13.21 §24, 2O-A).
 *
 * The rule this file exists to enforce on the report: **"write" is not one
 * number.** Creating a project is a payload write and a catalog write;
 * deleting one is two writes and two removes; the capability probe is a write
 * and a remove of its own. Collapsing those into "3 writes" hides exactly the
 * thing a reader of the report needs to check — the *order*, which is what
 * makes an interrupted operation recoverable.
 *
 * So every operation is recorded with its key, and the counts are reported by
 * kind. Nothing is inferred from the UI.
 */
export const LEDGER = `
  window.__ops = [];
  window.__consoleErrors = [];
  window.__audioContexts = 0;
  (() => {
    const proto = Storage.prototype;
    const get = proto.getItem, set = proto.setItem, remove = proto.removeItem;
    proto.getItem = function (key) { window.__ops.push(["get", key]); return get.call(this, key); };
    proto.setItem = function (key, value) {
      window.__ops.push(["set", key, String(value).length]);
      return set.call(this, key, value);
    };
    proto.removeItem = function (key) { window.__ops.push(["remove", key]); return remove.call(this, key); };
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const Original = window[name];
      if (!Original) continue;
      window[name] = new Proxy(Original, {
        construct(target, args) {
          window.__audioContexts += 1;
          return Reflect.construct(target, args);
        },
      });
    }
  })();
`;

/** Which kind of thing a key is, for counting honestly. */
export function kindOf(key) {
  if (key === "aranje.projects") return "catalog";
  if (key === "aranje.project-pending") return "pending";
  if (key === "aranje.song") return "legacySong";
  if (key === "aranje.probe") return "probe";
  if (key.startsWith("aranje.corrupt.")) return "quarantine";
  if (key.startsWith("aranje.project.")) return "projectPayload";
  if (key === "aranje.settings") return "settings";
  return "other";
}

/** Read the ledger and reset it, so each scenario measures only itself. */
export async function takeLedger(page) {
  const ops = await page.evaluate(() => {
    const taken = window.__ops;
    window.__ops = [];
    return taken;
  });
  const counts = {};
  for (const [op, key] of ops) {
    const bucket = `${op}:${kindOf(key)}`;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return {
    ops: ops.map(([op, key]) => `${op} ${key}`),
    counts,
    /** How many times a kind was written or removed, 0 when never. */
    n: (bucket) => counts[bucket] ?? 0,
  };
}
