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
  /** Production workspace events seen so far, of any kind. */
  readonly commandCount: number;
  /**
   * Of those, the ones that committed a Song (2V-B.1 §5).
   *
   * Copy is the reason this is a second number. It is a real production
   * command and it publishes a real event, so `commandCount` moves by one —
   * and it must leave every mutation channel at zero, which only
   * `mutatingCommandCount` can say. One counter would have to choose between
   * calling copy a command that changed nothing and calling it no command at
   * all, and both of those are untrue.
   */
  readonly mutatingCommandCount: number;
};

export type ActionLedger = {
  readonly action: LedgerAction;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly revisionDelta: number;
  readonly historyBefore: number;
  readonly historyAfter: number;
  readonly commandCount: number;
  readonly mutatingCommandCount: number;
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
  mutatingCommandCount = commandCount,
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
    mutatingCommandCount,
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
  /*
   * Named failures, never one word (2V-B.1 §5).
   *
   * "KALDI" told the last round that something was wrong with six steps and
   * nothing about what. Every string pushed here says which invariant broke
   * and, where a number is involved, what was expected and what arrived — so
   * a report can be read once and acted on, rather than read once and
   * re-derived by hand.
   */
  const failures: string[] = [];
  const commands = after.commandCount - before.commandCount;
  const mutating = after.mutatingCommandCount - before.mutatingCommandCount;
  const writes = after.evalSongWrites - before.evalSongWrites;
  const revisionDelta = after.revision - before.revision;
  const historyDelta = after.historyLength - before.historyLength;
  const unchanged = after.songBytes === before.songBytes;

  /* Exactly one production event, whatever the action was. Two means the
     surface ran the command twice; zero means the founder never reached it. */
  if (commands !== 1) {
    failures.push(`command_count_expected_1_received_${commands}`);
  }

  if (input.refusal === true) {
    if (!unchanged) failures.push("refusal_changed_song");
    if (mutating !== 0) {
      failures.push(`refusal_mutating_commands_expected_0_received_${mutating}`);
    }
    if (writes !== 0) failures.push(`refusal_wrote_storage_${writes}`);
    if (revisionDelta !== 0) failures.push(`refusal_moved_revision_${revisionDelta}`);
    if (historyDelta !== 0) failures.push(`refusal_added_history_step_${historyDelta}`);
  } else if (action === "copy") {
    if (mutating !== 0) {
      failures.push(`copy_mutating_commands_expected_0_received_${mutating}`);
    }
    if (!unchanged) failures.push("copy_changed_song");
    if (writes !== 0) failures.push(`copy_storage_writes_expected_0_received_${writes}`);
    if (revisionDelta !== 0) {
      failures.push(`copy_revision_delta_expected_0_received_${revisionDelta}`);
    }
    if (historyDelta !== 0) {
      failures.push(`copy_history_delta_expected_0_received_${historyDelta}`);
    }
  } else {
    if (mutating !== 1) {
      failures.push(`mutating_command_expected_1_received_${mutating}`);
    }
    if (unchanged) failures.push("song_hash_unchanged");
    if (writes !== 1) failures.push(`storage_writes_expected_1_received_${writes}`);
    if (revisionDelta !== 1) {
      failures.push(`revision_delta_expected_1_received_${revisionDelta}`);
    }
    if (historyDelta !== 1) {
      failures.push(`history_delta_expected_1_received_${historyDelta}`);
    }
    if (!input.undo) failures.push("undo_checkpoint_missing");
    else if (input.undo.songBytes !== before.songBytes) failures.push("undo_hash_mismatch");
    if (!input.redo) failures.push("redo_checkpoint_missing");
    else if (input.redo.songBytes !== after.songBytes) failures.push("redo_hash_mismatch");
  }

  if (cleanup.songBytes !== before.songBytes) failures.push("cleanup_hash_mismatch");
  for (const [name, pass] of Object.entries(input.semantic ?? {})) {
    if (!pass) failures.push(name);
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
    mutatingCommandCount: mutating,
    storageWriteCount: writes,
    undoHash: input.undo?.songHash ?? null,
    redoHash: input.redo?.songHash ?? null,
    cleanupHash: cleanup.songHash,
    result,
    failures,
  };
}

/**
 * The named musical invariants a write action has to survive (§5).
 *
 * Spelled here so a report and a probe use the same words. The value is the
 * failure name: `semantic` is keyed by these, and a `false` puts the key
 * straight into `failures`, which is why they read as defects rather than as
 * properties.
 */
export const LEDGER_INVARIANTS = {
  clipboardAttached: "paste_clipboard_not_detached",
  halfMoved: "move_exposed_partial_song",
  lostRest: "repeat_lost_rest",
  lostTie: "repeat_lost_tie",
  lostDuration: "repeat_lost_duration",
  lostArticulation: "repeat_lost_articulation",
  lostLetRing: "repeat_lost_let_ring",
  lostStrum: "repeat_lost_strum",
  lostPolyphony: "repeat_lost_polyphony",
} as const;
