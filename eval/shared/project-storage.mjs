/**
 * How a harness reads and counts the storage the product actually uses
 * (2Q-B §1.2).
 *
 * ## Why this file exists
 *
 * Until K-52 there was one song under one key, so "did the app write?" and
 * "did the song change?" were the same question and `aranje.song` answered
 * both. Since the project library there are three kinds of key — the
 * catalog, one record per project, and a pending-operation marker — and the
 * old question has three different answers depending on which key moved.
 *
 * Nine acceptance suites kept asking the old question. They were not
 * measuring a broken product; they were measuring a key the product stopped
 * using, and they reported `writes=0` for every successful edit. This module
 * is the one place that knows the current shape, so a suite counts what
 * happened rather than what used to happen.
 *
 * ## What it will not do
 *
 * It does not re-implement the loader. `decideRecordShape` reproduces the
 * production decision *table* — same branches, same order — and
 * `project-storage.test.ts` runs both over the same fixtures and fails if
 * they ever disagree. A browser cannot import the production module, so the
 * choice is between a cross-checked table and a guess.
 *
 * Nothing here is product code, and nothing in `src/` may import it.
 */

export const CATALOG_KEY = "aranje.projects";
export const PENDING_KEY = "aranje.project-pending";
export const PROJECT_PREFIX = "aranje.project.";
export const LEGACY_SONG_KEY = "aranje.song";
export const PROBE_KEY = "aranje.probe";
export const QUARANTINE_PREFIX = "aranje.corrupt.";

/**
 * Every physical storage operation, recorded before the app's first line.
 *
 * Ops are recorded raw — key and kind — and classified later, because which
 * project is *active* is a fact about the catalog at read time and not
 * something the recorder can know while the write is happening.
 */
export const PROJECT_LEDGER = `
  window.__ops = [];
  window.__allOps = [];
  window.__consoleErrors = [];
  window.__audioContexts = 0;
  (() => {
    const proto = Storage.prototype;
    const get = proto.getItem, set = proto.setItem, remove = proto.removeItem;
    const note = (op, key, size) => {
      window.__ops.push([op, key, size]);
      window.__allOps.push([op, key, size]);
    };
    proto.getItem = function (key) { note("get", key, 0); return get.call(this, key); };
    proto.setItem = function (key, value) {
      note("set", key, String(value).length);
      return set.call(this, key, value);
    };
    proto.removeItem = function (key) { note("remove", key, 0); return remove.call(this, key); };
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

/**
 * Which class a key belongs to, given which project is open.
 *
 * `active_project` and `other_project` are deliberately separate: "the song I
 * am editing was written" and "some project's bytes moved" are different
 * claims, and a suite that adds them up cannot tell a save from a leak into
 * somebody else's project.
 */
export function writeClassOf(key, activeProjectId) {
  if (key === CATALOG_KEY) return "catalog";
  if (key === PENDING_KEY) return "pending_delete";
  if (key === LEGACY_SONG_KEY) return "legacy_song";
  if (key === PROBE_KEY) return "probe";
  if (key.startsWith(QUARANTINE_PREFIX)) return "quarantine";
  if (key.startsWith(PROJECT_PREFIX)) {
    const id = key.slice(PROJECT_PREFIX.length);
    return activeProjectId !== null && id === activeProjectId
      ? "active_project"
      : "other_project";
  }
  return "unknown";
}

export const projectKey = (id) => `${PROJECT_PREFIX}${id}`;

/** The catalog as the app left it, or null when there is none to read. */
export async function readCatalog(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return { corrupt: true };
    }
  }, CATALOG_KEY);
}

/** Which project the reader has open, or null when the catalog cannot say. */
export async function activeProjectId(page) {
  const catalog = await readCatalog(page);
  if (!catalog || catalog.corrupt) return null;
  return typeof catalog.activeProjectId === "string" ? catalog.activeProjectId : null;
}

/**
 * The production decision table for one project record, reproduced.
 *
 * Branch order matters and is the order `decideRecord` uses: parse, format
 * and version tag, shell, then the envelope's current/previous rule. A song
 * is judged only by whether it is an object — the Song Contract itself is not
 * re-implemented here, and no suite should be asking this module to.
 */
export function decideRecordShape(raw) {
  if (raw === null || raw === undefined) return { kind: "empty" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt" };
  }
  if (parsed === null || typeof parsed !== "object") return { kind: "corrupt" };
  if (parsed.format !== "aranje.project-record") return { kind: "corrupt" };
  if (typeof parsed.version !== "number" || !Number.isInteger(parsed.version)) {
    return { kind: "corrupt" };
  }
  if (parsed.version !== 1) return { kind: "future_version", version: parsed.version };
  if (
    typeof parsed.projectId !== "string" ||
    typeof parsed.revision !== "number" ||
    typeof parsed.updatedAt !== "number"
  ) {
    return { kind: "corrupt" };
  }
  const usable = (song) => song !== null && typeof song === "object" && !Array.isArray(song);
  if (usable(parsed.current)) {
    return {
      kind: "record",
      projectId: parsed.projectId,
      revision: parsed.revision,
      song: parsed.current,
    };
  }
  if (usable(parsed.previous)) {
    return {
      kind: "recovered_previous",
      projectId: parsed.projectId,
      revision: parsed.revision,
      song: parsed.previous,
    };
  }
  return { kind: "corrupt" };
}

/** One project's record, decided rather than assumed. */
export async function readRecord(page, id) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), projectKey(id));
  return decideRecordShape(raw);
}

/** The song the reader is editing, or null when nothing readable is there. */
export async function readActiveSong(page) {
  const id = await activeProjectId(page);
  if (id === null) return null;
  const decision = await readRecord(page, id);
  return decision.kind === "record" || decision.kind === "recovered_previous"
    ? decision.song
    : null;
}

/** The active song's exact bytes, for byte-equal claims. */
export async function activeSongBytes(page) {
  const song = await readActiveSong(page);
  return song === null ? null : JSON.stringify(song);
}

/**
 * The legacy single-song key.
 *
 * Only the migration scenarios have any business reading this: for every
 * other suite a value here means the app wrote somewhere it should not.
 */
export async function legacySongRaw(page) {
  return page.evaluate((key) => localStorage.getItem(key), LEGACY_SONG_KEY);
}

/**
 * Read the ledger and reset it, so each scenario measures only itself.
 *
 * The counts are keyed `op:class` — `set:active_project`, `remove:catalog` —
 * and `songWrites` is deliberately only the active project's payload. A
 * suite that wants "any localStorage write at all" can still have it through
 * `total`, but it has to ask for it by that name.
 */
export async function takeStorageLedger(page) {
  const activeId = await activeProjectId(page);
  const ops = await page.evaluate(() => {
    const taken = window.__ops;
    window.__ops = [];
    return taken;
  });
  const counts = {};
  for (const [op, key] of ops) {
    const bucket = `${op}:${writeClassOf(key, activeId)}`;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const writes = ops.filter(([op]) => op === "set");
  return {
    activeProjectId: activeId,
    ops: ops.map(([op, key]) => `${op} ${key}`),
    counts,
    n: (bucket) => counts[bucket] ?? 0,
    songWrites: counts["set:active_project"] ?? 0,
    catalogWrites: counts["set:catalog"] ?? 0,
    otherProjectWrites: counts["set:other_project"] ?? 0,
    legacyWrites: counts["set:legacy_song"] ?? 0,
    total: writes.length,
  };
}

/**
 * The running total, for suites that measure a single action as a difference.
 *
 * `takeStorageLedger` answers "what happened just now" and resets; this
 * answers "how much has happened since the page loaded" and does not. A
 * before/after pair around one tap is the older style and is still the
 * clearest way to say "this action wrote exactly once".
 *
 * `activeProject` is the payload of the project open *at read time*;
 * `anyProject` counts every project payload, which is what a scenario that
 * creates or switches projects actually means by "a song was written".
 */
export async function writeTally(page) {
  const activeId = await activeProjectId(page);
  const ops = await page.evaluate(() => window.__allOps ?? []);
  const tally = {
    activeProject: 0,
    anyProject: 0,
    catalog: 0,
    pending: 0,
    legacy: 0,
    quarantine: 0,
    other: 0,
    total: 0,
  };
  for (const [op, key] of ops) {
    if (op !== "set") continue;
    tally.total += 1;
    const kind = writeClassOf(key, activeId);
    if (kind === "active_project") {
      tally.activeProject += 1;
      tally.anyProject += 1;
    } else if (kind === "other_project") {
      tally.anyProject += 1;
    } else if (kind === "catalog") tally.catalog += 1;
    else if (kind === "pending_delete") tally.pending += 1;
    else if (kind === "legacy_song") tally.legacy += 1;
    else if (kind === "quarantine") tally.quarantine += 1;
    else tally.other += 1;
  }
  return tally;
}

/** A device holding one project with this song, seeded before the app boots. */
export function deviceWith(song, id = "project-1", { updatedAt = 1_700_000_000_000 } = {}) {
  return {
    [projectKey(id)]: JSON.stringify({
      format: "aranje.project-record",
      version: 1,
      projectId: id,
      revision: 1,
      updatedAt,
      current: song,
      previous: null,
    }),
    [CATALOG_KEY]: JSON.stringify({
      format: "aranje.project-catalog",
      version: 1,
      activeProjectId: id,
      projectIds: [id],
      nextProjectNumber: 2,
    }),
  };
}

/** A device holding two projects, so isolation can be measured. */
export function deviceWithTwo(first, second) {
  return {
    ...deviceWith(first, "project-1"),
    [projectKey("project-2")]: JSON.stringify({
      format: "aranje.project-record",
      version: 1,
      projectId: "project-2",
      revision: 1,
      updatedAt: 1_700_000_000_000,
      current: second,
      previous: null,
    }),
    [CATALOG_KEY]: JSON.stringify({
      format: "aranje.project-catalog",
      version: 1,
      activeProjectId: "project-1",
      projectIds: ["project-1", "project-2"],
      nextProjectNumber: 3,
    }),
  };
}

/** Seed a context's storage before the app's first line. */
export async function seedStorage(context, entries) {
  await context.addInitScript((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, Object.entries(entries));
}
