/**
 * What the workspace actually did, announced once (2V-B.1 §13).
 *
 * ## The defect this exists to close
 *
 * The last acceptance round decided a step had been completed because the
 * founder pressed a button on the guide. That is not evidence of anything: a
 * reader who cannot find "Yapıştır" can still press "Yaptım", and the round
 * comes back green with a step that never happened. The round before that
 * inferred an edit from "the Song bytes changed", which is a shade better and
 * still wrong — it cannot tell one command from two, it cannot tell a paste
 * from a delete, and it counts an undo as an edit.
 *
 * So a production edit says so, in its own words, from the place it happened.
 *
 * ## Why this is not an acceptance feature
 *
 * There is no branch here that asks whether a test is running, and there is
 * none at any call site either. The workspace publishes what it did the same
 * way on every route; with nobody subscribed, publishing is a walk over an
 * empty set. A command that behaved differently "when being observed" would
 * be a command whose acceptance proves nothing about the product — which is
 * the whole trap this module is built to avoid falling into.
 *
 * ## What is deliberately missing
 *
 * **The build sha**, and **the revision and history depth.** Those are
 * stamped by the observer, from the record and the store, at the moment it
 * receives the event. Two reasons, and both are about who is entitled to say
 * what:
 *
 * - The sha's job is to catch a *stale deploy*. An emitter and an observer in
 *   the same bundle share one build by construction, so a sha the emitter
 *   wrote in would be a number that cannot disagree — which is a number that
 *   cannot catch anything. The gate that matters compares the link's sha with
 *   the running bundle's, and that comparison already exists.
 * - The revision and the history depth belong to the project record and the
 *   song store. An emitter reporting them would be a second opinion about
 *   numbers those two already own, and the point of the ledger is that all
 *   the sources agree rather than that one of them speaks for the rest.
 */
import type { Song } from "@/lib/song/schema";

/**
 * Which editor action produced this, in the words the canon uses.
 *
 * `other` is honest rather than lazy: a note written with the pen, a Copilot
 * apply and a lifecycle command are all real edits that this channel does not
 * yet describe, and calling one of them "delete" to fit the enum would be
 * worse than saying it was something else.
 */
export type WorkspaceEditAction =
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "move"
  | "repeat"
  | "delete"
  | "other";

/** A run of notes on one track, or a run of whole bars. */
export type WorkspaceEditScope = "notes" | "measures";

export type WorkspaceEdit = {
  readonly action: WorkspaceEditAction;
  readonly scope: WorkspaceEditScope;
  /**
   * True when the Song was committed, false when the action only read it.
   *
   * Copy is the one that matters: it is a real production command with a real
   * event, and it must leave every mutation channel at zero. Without this
   * flag an observer would have to guess from the fingerprints, and "the
   * bytes did not change" is exactly the inference §13 forbids.
   */
  readonly mutating: boolean;
  /** The Song this action was performed against. */
  readonly songBefore: string;
  /** The Song it produced. Equal to `songBefore` for a read-only action. */
  readonly songAfter: string;
  readonly sectionId: string;
  /** Whose music moved. One track for a run of notes; every track for a
   *  full-scope measure command. */
  readonly trackIds: readonly string[];
  /** Ticks from the start of the section. Inclusive. */
  readonly startTicks: number;
  /** Exclusive. */
  readonly endTicks: number;
  /** Bars the action covered, `sectionId:index`, when it was measure-scoped. */
  readonly barKeys: readonly string[];
};

/**
 * The Song's bytes with every key in one order, at every depth.
 *
 * `JSON.stringify` writes keys in insertion order, and the same music reaches
 * two places in two different orders: the store holds a schema-parsed object
 * whose keys follow the schema's declaration, while the project record holds
 * the bytes whatever wrote it happened to produce. Two fingerprints of the
 * same song then disagree — measured, and it made every writing step of the
 * round report `wrong_song` while the edit had plainly happened.
 *
 * So the ordering is decided here rather than inherited. Arrays keep their
 * order, because in music the order of the notes *is* the music.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
}

/**
 * The same ordering rule, applied to bytes that were already written.
 *
 * The project record holds the Song in whatever order wrote it, and the store
 * holds it in the schema's order; the first commit of a session therefore
 * rewrites the record's bytes without changing a note. An undo compared byte
 * for byte across that moment reports a mismatch about key order and calls it
 * a defect (measured in the 2V-B.1 browser run: `undo_hash_mismatch` on a
 * paste whose music came back exactly). Comparing canonical bytes asks the
 * question a reader means — is this the same music — and still refuses a
 * single changed note.
 *
 * Unparseable bytes are returned as they are: they are still comparable, and
 * a hash of them is still a hash of them.
 */
export function canonicalBytes(json: string): string {
  try {
    return JSON.stringify(canonical(JSON.parse(json)));
  } catch {
    return json;
  }
}

/**
 * A short, comparable stand-in for a whole Song.
 *
 * The same FNV-1a the storage evidence uses, over the canonical bytes. Not a
 * security hash: a cheap one that changes when the music does, so an event
 * can name the Song it acted on without carrying it.
 */
export function songFingerprint(song: Song): string {
  const bytes = JSON.stringify(canonical(song));
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `s${bytes.length}h${hash.toString(36)}`;
}

type Listener = (edit: WorkspaceEdit) => void;

const listeners = new Set<Listener>();

/**
 * Say what just happened.
 *
 * Called **after** the production behaviour succeeded, never before and never
 * instead. A refused command publishes nothing, because nothing happened.
 *
 * A listener that throws does not take the editor down with it: an observer
 * is a bystander, and a bystander's bug is not the reader's problem.
 */
export function publishWorkspaceEdit(edit: WorkspaceEdit): void {
  for (const listener of [...listeners]) {
    try {
      listener(edit);
    } catch {
      /* Observing is not allowed to break editing. */
    }
  }
}

export function subscribeWorkspaceEdits(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How many observers there are. Zero on every ordinary route. */
export function workspaceEditObserverCount(): number {
  return listeners.size;
}
