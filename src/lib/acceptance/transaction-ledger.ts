/**
 * The shared, named ledger for selection writes (2V-B.1 A/B).
 *
 * This does not infer a command from a changed Song. The acceptance observer
 * supplies the production event count, the disposable store supplies physical
 * writes, the project record supplies its revision, and the Song store
 * supplies history. A row passes only when all four tell the same story.
 */
import { storageHash } from "@/lib/acceptance/device-storage";
import { readFixture } from "@/lib/acceptance/fixture-read";
import {
  ACCEPTANCE_PROJECT_ID,
  type AcceptanceSession,
} from "@/lib/acceptance/session";
import { projectKey } from "@/lib/projects/project-storage";

export type LedgerAction =
  | "copy"
  | "paste"
  | "duplicate"
  | "move"
  | "repeat"
  | "delete";

export type TransactionPoint = {
  readonly songBytes: string;
  readonly songHash: string;
  readonly revision: number;
  readonly historyLength: number;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly evalSongWrites: number;
  readonly commandCount: number;
};

export type ActionLedger = {
  readonly action: LedgerAction;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly revisionDelta: number;
  readonly historyBefore: number;
  readonly historyAfter: number;
  readonly commandCount: number;
  readonly storageWriteCount: number;
  readonly undoHash: string | null;
  readonly redoHash: string | null;
  readonly cleanupHash: string;
  readonly result: "read_only" | "atomic" | "refused" | "failed";
  readonly failures: readonly string[];
};

export function transactionPoint(
  session: AcceptanceSession,
  journalStart: number,
  commandCount: number,
): TransactionPoint {
  const fixture = readFixture(session.storage);
  const snapshot = session.store?.getSnapshot();
  const key = projectKey(ACCEPTANCE_PROJECT_ID);
  const writes = session.storage
    .journal()
    .slice(journalStart)
    .filter((entry) => entry.kind === "set" && entry.key === key).length;
  return {
    songBytes: fixture.song,
    songHash: storageHash(fixture.song),
    revision: fixture.revision,
    historyLength: snapshot ? snapshot.undoDepth + snapshot.redoDepth + 1 : 0,
    undoDepth: snapshot?.undoDepth ?? 0,
    redoDepth: snapshot?.redoDepth ?? 0,
    evalSongWrites: writes,
    commandCount,
  };
}

export function judgeActionLedger(input: {
  readonly action: LedgerAction;
  readonly before: TransactionPoint;
  readonly after: TransactionPoint;
  readonly undo?: TransactionPoint | null;
  readonly redo?: TransactionPoint | null;
  readonly cleanup: TransactionPoint;
  /** Typed refusal text was drawn by the production surface. */
  readonly refusal?: boolean;
  /** Named musical invariants, already asked of the before/after Songs. */
  readonly semantic?: Readonly<Record<string, boolean>>;
}): ActionLedger {
  const { action, before, after, cleanup } = input;
  const failures: string[] = [];
  const commands = after.commandCount - before.commandCount;
  const writes = after.evalSongWrites - before.evalSongWrites;
  const revisionDelta = after.revision - before.revision;
  const historyDelta = after.historyLength - before.historyLength;
  const unchanged = after.songBytes === before.songBytes;

  if (commands !== 1) failures.push(`commandCount=${commands}, expected=1`);

  if (input.refusal === true) {
    if (!unchanged) failures.push("typed refusal changed Song bytes");
    if (writes !== 0) failures.push(`typed refusal storageWrites=${writes}`);
    if (revisionDelta !== 0) failures.push(`typed refusal revisionDelta=${revisionDelta}`);
    if (historyDelta !== 0) failures.push(`typed refusal historyDelta=${historyDelta}`);
  } else if (action === "copy") {
    if (!unchanged) failures.push("copy changed Song bytes");
    if (writes !== 0) failures.push(`copy storageWrites=${writes}`);
    if (revisionDelta !== 0) failures.push(`copy revisionDelta=${revisionDelta}`);
    if (historyDelta !== 0) failures.push(`copy historyDelta=${historyDelta}`);
  } else {
    if (unchanged) failures.push("Song hash did not change");
    if (writes !== 1) failures.push(`storageWrites=${writes}, expected=1`);
    if (revisionDelta !== 1) failures.push(`revisionDelta=${revisionDelta}, expected=1`);
    if (historyDelta !== 1) failures.push(`historyDelta=${historyDelta}, expected=1`);
    if (!input.undo) failures.push("undo checkpoint missing");
    else if (input.undo.songBytes !== before.songBytes) failures.push("undo bytes differ");
    if (!input.redo) failures.push("redo checkpoint missing");
    else if (input.redo.songBytes !== after.songBytes) failures.push("redo bytes differ");
  }

  if (cleanup.songBytes !== before.songBytes) failures.push("cleanup hash differs");
  for (const [name, pass] of Object.entries(input.semantic ?? {})) {
    if (!pass) failures.push(`semantic:${name}`);
  }

  const result =
    failures.length > 0
      ? "failed"
      : input.refusal === true
        ? "refused"
        : action === "copy"
          ? "read_only"
          : "atomic";

  return {
    action,
    beforeHash: before.songHash,
    afterHash: after.songHash,
    revisionDelta,
    historyBefore: before.historyLength,
    historyAfter: after.historyLength,
    commandCount: commands,
    storageWriteCount: writes,
    undoHash: input.undo?.songHash ?? null,
    redoHash: input.redo?.songHash ?? null,
    cleanupHash: cleanup.songHash,
    result,
    failures,
  };
}
