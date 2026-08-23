/**
 * The single-song storage behaviour, measured rather than described (2O-A §0).
 *
 * Before anything is built on top of it, this records what the app *actually*
 * does today for each of the start states in `fixtures.ts`: the outcome, the
 * recovery banner, whether writing stays open, and the exact ordered list of
 * physical storage operations — including the capability probe, which is a
 * real `setItem` and a real `removeItem` and is never folded into "no writes".
 *
 * Everything here reads production code through a recording storage double.
 * No production file is modified.
 *
 *   npx tsx eval/projects/measure-baseline.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";

import { START_STATES } from "./fixtures";

import { loadSong, saveSong, type StorageLike } from "@/lib/song/storage";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

type Op = { readonly op: "get" | "set" | "remove"; readonly key: string };

/** A storage that records every physical operation, in order. */
function recording(seed: Record<string, string> = {}, fail?: (op: Op) => boolean) {
  const data = new Map(Object.entries(seed));
  const ops: Op[] = [];
  const guard = (op: Op) => {
    ops.push(op);
    if (fail?.(op)) throw new Error("refused");
  };
  const storage: StorageLike = {
    getItem: (key) => {
      guard({ op: "get", key });
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      guard({ op: "set", key });
      data.set(key, value);
    },
    removeItem: (key) => {
      guard({ op: "remove", key });
      data.delete(key);
    },
  };
  return { storage, ops, data };
}

/** A fixed clock, so a quarantine key is the same on every run. */
const clock = () => 1_700_000_000_000;

const rows = START_STATES.map((state) => {
  const seed: Record<string, string> =
    state.raw === null ? {} : { "aranje.song": state.raw };
  const { storage, ops, data } = recording(seed);
  const result = loadSong(storage, clock);

  /* A commit straight after the load, to see what one edit really costs. */
  const after = recording(Object.fromEntries(data));
  const edit = { ...result.song, title: `${result.song.title} +` };
  const saved = result.canPersist ? saveSong(edit, after.storage) : null;

  return {
    id: state.id,
    what: state.what,
    load: {
      outcome: result.outcome,
      recovery: result.recovery ?? null,
      canPersist: result.canPersist,
      isSample: result.song === SAMPLE_SONG,
      title: result.song.title,
      backupKey: result.backupKey ?? null,
      ops: ops.map((entry) => `${entry.op} ${entry.key}`),
    },
    commit: saved === null
      ? { skipped: "canPersist false" }
      : {
          ok: saved.ok,
          ...(saved.ok ? { revision: saved.revision } : { reason: saved.reason }),
          ops: after.ops.map((entry) => `${entry.op} ${entry.key}`),
        },
  };
});

const report = {
  measuredOn: "desktop Node against production storage.ts — not a phone",
  keys: {
    song: "aranje.song",
    settings: "aranje.settings",
    quarantine: "aranje.corrupt.<ms>[.n]",
    writeProbe: "aranje.probe",
    copilotSubject: "written by use-co-arranger, not part of the song envelope",
  },
  envelope: {
    shape: "{ format: 'aranje.song', version: 1, revision, current, previous }",
    revision: "disk revision + 1; legacy/empty/corrupt start at 1",
    previous: "whatever was readable ON DISK a moment ago, re-read per save",
    writesPerCommit: 1,
  },
  states: rows,
};

mkdirSync("eval/projects/artifacts", { recursive: true });
writeFileSync(
  "eval/projects/artifacts/BASELINE-STORAGE.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
for (const row of rows) {
  console.log(
    `${row.id.padEnd(15)} ${row.load.outcome.padEnd(10)} persist=${String(row.load.canPersist).padEnd(5)} ` +
      `recovery=${String(row.load.recovery).padEnd(20)} load[${row.load.ops.join(", ")}]`,
  );
  console.log(`${" ".repeat(16)}commit ${JSON.stringify(row.commit)}`);
}
